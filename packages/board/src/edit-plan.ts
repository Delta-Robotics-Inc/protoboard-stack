/**
 * Planners of the Phase 2 editing operations (contract docs/specs/pcb-editor/phase2-editing.md, section 2.1). Each is
 * a pure function from a document to the records an operation writes; the operations apply exactly what they return
 * and the interactive kernel calls the same functions for its live preview, so a draft and its commit agree.
 */
import { copperLayers, type BoardDocument } from "./document.js";
import { CopperIndex, copperOf, otherNet, pointGap, primGap, trackPrim, type CopperPiece, type Prim } from "./copper-geom.js";
import { inflate } from "./geometry.js";
import { edited, need, OpError, type ApplyContext } from "./ops/registry.js";
import type { BoardRecord, CopperLayer, FootprintRec, Point, TrackRec, ViaRec } from "./schema.js";

/** What a planner needs of an operation's context. */
export type PlanContext = Pick<ApplyContext, "actor" | "issueId" | "edited" | "provenance">;

export interface Detached {
  /** The track or via left where it was. */
  track: string;
  /** The pad (or via) it was attached to. */
  pad: string;
  reason: "short" | "locked";
  /** The other net's object it would have shorted. */
  with?: string;
}

export interface FootprintMovePlan {
  puts: BoardRecord[];
  removes: string[];
  /** Tracks and vias that moved rigidly with the footprints. */
  followed: string[];
  /** Tracks whose attached end moved (with a new corner when needed). */
  stretched: string[];
  detached: Detached[];
}

const isOcti = (dx: number, dy: number) => dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const restricted = (ctx: PlanContext) => ctx.actor.kind === "agent" || ctx.actor.kind === "router";

/**
 * The two corners of a two-segment path from `from` to `to` at a posture: for 45, a diagonal leg and a straight leg
 * (either first); for 90, horizontal then vertical or the reverse. Ordered so the first leg from `from` runs closest
 * to `prefer` (a direction); corners equal to an end are dropped (the path is then one segment).
 */
export function postureCorners(from: Point, to: Point, posture: "45" | "90", prefer?: { x: number; y: number }): Point[] {
  const ddx = to.x - from.x,
    ddy = to.y - from.y;
  let ks: Point[];
  if (posture === "90") ks = [{ x: to.x, y: from.y }, { x: from.x, y: to.y }];
  else {
    const m = Math.min(Math.abs(ddx), Math.abs(ddy));
    const diag = { x: sgn(ddx) * m, y: sgn(ddy) * m };
    ks = [{ x: from.x + diag.x, y: from.y + diag.y }, { x: from.x + ddx - diag.x, y: from.y + ddy - diag.y }];
  }
  if (prefer && (prefer.x || prefer.y)) {
    const score = (k: Point) => {
      const lx = k.x - from.x,
        ly = k.y - from.y;
      const l = Math.hypot(lx, ly) || 1;
      return (lx * prefer.x + ly * prefer.y) / (l * (Math.hypot(prefer.x, prefer.y) || 1));
    };
    ks.sort((a, b) => score(b) - score(a));
  }
  const out: Point[] = [];
  for (const k of ks) if (!same(k, from) && !same(k, to) && !out.some((o) => same(o, k))) out.push(k);
  return out;
}

/** A track's other-net conflicts against an index and extra pieces, ignoring `ignore` owners and `friends` pieces. */
function firstShort(t: TrackRec, prim: Prim, index: CopperIndex, extra: readonly CopperPiece[], ignore: ReadonlySet<string>, friends: ReadonlySet<string>): string | undefined {
  let hit: string | undefined;
  const conflict = (p: CopperPiece) => p.layer === t.layer && !ignore.has(p.owner) && !friends.has(p.id) && otherNet(t, p) && p.kind !== "hole" && primGap(prim, p.prim) <= 0;
  index.near(inflate(boxOf(prim), 1), t.layer, (p) => {
    if (conflict(p)) {
      hit = p.id;
      return false;
    }
  });
  if (hit) return hit;
  for (const p of extra) if (conflict(p)) return p.id;
  return undefined;
}

function boxOf(p: Prim) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < p.pts.length; i += 2) {
    minX = Math.min(minX, p.pts[i]);
    maxX = Math.max(maxX, p.pts[i]);
    minY = Math.min(minY, p.pts[i + 1]);
    maxY = Math.max(maxY, p.pts[i + 1]);
  }
  return { minX: minX - p.r, minY: minY - p.r, maxX: maxX + p.r, maxY: maxY + p.r };
}

/** Whether a point lies on a piece's copper. */
const onPiece = (pt: Point, p: CopperPiece) => pointGap(pt.x, pt.y, p.prim) <= 0;

/**
 * `footprint.move` with attached copper (contract 2.1.1): footprints translate; tracks with both ends on moved pads
 * and vias on moved pads follow rigidly; tracks with one end attached stretch (two segments at 45 degrees when the
 * stretch would leave an octilinear segment off-angle); anything that would short another net is detached and
 * reported, as is locked copper for agents and routers.
 */
export function planFootprintMove(doc: BoardDocument, ids: readonly string[], dx: number, dy: number, ctx: PlanContext, index: CopperIndex = CopperIndex.build(doc)): FootprintMovePlan {
  const fps = ids.map((id) => need(doc, id, ["footprint"]));
  const moved = new Set(ids);
  const movedFps: FootprintRec[] = fps.map((fp) => edited({ ...fp, x: fp.x + dx, y: fp.y + dy }, ctx));
  const plan: FootprintMovePlan = { puts: [...movedFps], removes: [], followed: [], stretched: [], detached: [] };
  if (dx === 0 && dy === 0) return plan;
  const stack = copperLayers(doc);
  const padsBefore = fps.flatMap((fp) => index.of(fp.id).filter((p) => p.kind === "pad"));
  const padsAfter = movedFps.flatMap((fp) => copperOf(doc, fp, stack).filter((p) => p.kind === "pad"));

  // vias on moved pads (same net) follow rigidly
  const viaOn = new Map<string, CopperPiece>();
  const trackEnds = new Map<string, { rec: TrackRec; start?: CopperPiece; end?: CopperPiece }>();
  for (const pad of padsBefore) {
    index.near(pad.box, pad.layer, (p) => {
      if (p.kind === "via" && !viaOn.has(p.owner)) {
        const v = doc.records.get(p.owner) as ViaRec;
        if (v.net === pad.net && onPiece({ x: v.x, y: v.y }, pad)) viaOn.set(v.id, pad);
      } else if (p.kind === "track") {
        const t = doc.records.get(p.owner) as TrackRec;
        if (t.net !== pad.net) return;
        const e = trackEnds.get(t.id) ?? { rec: t };
        if (!e.start && onPiece(t.start, pad)) e.start = pad;
        if (!e.end && onPiece(t.end, pad)) e.end = pad;
        if (e.start || e.end) trackEnds.set(t.id, e);
      }
    });
  }
  // vias: move unless locked for this actor or shorting
  const movingVias = new Map<string, ViaRec>();
  const ignore = new Set<string>([...moved]);
  for (const [vid, pad] of [...viaOn].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const v = doc.records.get(vid) as ViaRec;
    if (v.locked && restricted(ctx)) {
      plan.detached.push({ track: vid, pad: pad.id, reason: "locked" });
      continue;
    }
    const nv = edited({ ...v, x: v.x + dx, y: v.y + dy }, ctx);
    ignore.add(vid);
    const pieces = copperOf(doc, nv, stack);
    let short: string | undefined;
    for (const p of pieces) {
      index.near(p.box, p.layer, (q) => {
        if (!ignore.has(q.owner) && otherNet(nv, q) && q.kind !== "hole" && primGap(p.prim, q.prim) <= 0) {
          short = q.id;
          return false;
        }
      });
      for (const q of padsAfter) if (!short && q.layer === p.layer && otherNet(nv, q) && primGap(p.prim, q.prim) <= 0) short = q.id;
      if (short) break;
    }
    if (short) {
      ignore.delete(vid);
      plan.detached.push({ track: vid, pad: pad.id, reason: "short", with: short });
      continue;
    }
    movingVias.set(vid, v);
    plan.puts.push(nv);
    plan.followed.push(vid);
  }
  // tracks on moving vias are attached too
  for (const [vid, v] of movingVias) {
    for (const vp of index.of(vid)) {
      index.near(vp.box, vp.layer, (p) => {
        if (p.kind !== "track") return;
        const t = doc.records.get(p.owner) as TrackRec;
        if (t.net !== v.net || t.layer !== vp.layer) return;
        const e = trackEnds.get(t.id) ?? { rec: t };
        if (!e.start && onPiece(t.start, vp)) e.start = vp;
        if (!e.end && onPiece(t.end, vp)) e.end = vp;
        if (e.start || e.end) trackEnds.set(t.id, e);
      });
    }
  }
  for (const id of trackEnds.keys()) ignore.add(id);
  const accepted: CopperPiece[] = [...padsAfter];
  for (const [vid] of movingVias) {
    const nv = plan.puts.find((r) => r.id === vid) as ViaRec;
    accepted.push(...copperOf(doc, nv, stack));
  }
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  for (const [tid, e] of [...trackEnds].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const t = e.rec;
    const pad = (e.start ?? e.end)!;
    // the pads this track is attached to are its friends (an unassigned track on an unassigned pad)
    const friends = new Set<string>([e.start?.id, e.end?.id].filter((x): x is string => !!x));
    if (t.locked && restricted(ctx)) {
      ignore.delete(tid);
      plan.detached.push({ track: tid, pad: pad.id, reason: "locked" });
      continue;
    }
    const variants: TrackRec[][] = [];
    if (e.start && e.end) variants.push([{ ...t, start: move(t.start), end: move(t.end) }]);
    else {
      const startMoves = !!e.start;
      const fixed = startMoves ? t.end : t.start;
      const oldEnd = startMoves ? t.start : t.end;
      const newEnd = move(oldEnd);
      const straight: TrackRec = startMoves ? { ...t, start: newEnd } : { ...t, end: newEnd };
      if (t.sweep === undefined && isOcti(oldEnd.x - fixed.x, oldEnd.y - fixed.y) && !isOcti(newEnd.x - fixed.x, newEnd.y - fixed.y)) {
        for (const k of postureCorners(fixed, newEnd, "45", { x: oldEnd.x - fixed.x, y: oldEnd.y - fixed.y })) {
          // the original record keeps its fixed end; a new segment joins the corner to the moved end
          const keep: TrackRec = startMoves ? { ...t, start: k } : { ...t, end: k };
          const add: TrackRec = { ...t, id: "", start: startMoves ? newEnd : k, end: startMoves ? k : newEnd };
          variants.push([keep, add]);
        }
      }
      if (!same(straight.start, straight.end)) variants.push([straight]);
    }
    let chosen: TrackRec[] | undefined;
    let shortWith: string | undefined;
    for (const v of variants) {
      let bad: string | undefined;
      for (const seg of v) {
        bad = firstShort(seg, trackPrim(seg), index, accepted, ignore, friends);
        if (bad) break;
      }
      if (!bad) {
        chosen = v;
        break;
      }
      shortWith ??= bad;
    }
    if (!chosen) {
      ignore.delete(tid);
      plan.detached.push({ track: tid, pad: pad.id, reason: "short", ...(shortWith ? { with: shortWith } : {}) });
      continue;
    }
    for (const seg of chosen) {
      const rec = seg.id ? edited(seg, ctx) : edited({ ...seg, id: ctx.issueId("track") }, ctx);
      plan.puts.push(rec);
      accepted.push(...copperOf(doc, rec, stack));
    }
    (e.start && e.end ? plan.followed : plan.stretched).push(tid);
  }
  plan.followed.sort();
  plan.stretched.sort();
  plan.detached.sort((a, b) => (a.track < b.track ? -1 : a.track > b.track ? 1 : 0));
  return plan;
}

// ---------------------------------------------------------------- track.drag

export interface TrackDragPlan {
  puts: BoardRecord[];
  removes: string[];
  moved: string[];
  added: string[];
  removed: string[];
}

/** 1 um: track ends this close are connected for dragging. */
const JOIN_NM = 1000;
const near = (a: Point, b: Point, tol = JOIN_NM) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** Where two lines meet (each through a point with a direction), or undefined when they are parallel. */
function intersect(p: Point, u: Point, q: Point, v: Point): Point | undefined {
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < 1e-9 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) return undefined;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / den;
  return { x: Math.round(p.x + t * u.x), y: Math.round(p.y + t * u.y) };
}

/**
 * `track.drag` (contract 2.1.2): a segment slides along its normal and its neighbors re-form their corners; a via
 * moves and each attached segment re-forms at the posture. Throws an OpError when the result would short another net.
 */
export function planTrackDrag(doc: BoardDocument, id: string, dx: number, dy: number, posture: "45" | "90", ctx: PlanContext, index: CopperIndex = CopperIndex.build(doc)): TrackDragPlan {
  const rec = need(doc, id, ["track", "via"]);
  const stack = copperLayers(doc);
  const out = new Map<string, BoardRecord>();
  const removed = new Set<string>();
  const added: string[] = [];
  const moved: string[] = [];
  const addSeg = (base: TrackRec, a: Point, b: Point) => {
    if (same(a, b)) return;
    const nid = ctx.issueId("track");
    const r = edited({ ...base, id: nid, start: a, end: b }, ctx);
    out.set(nid, r);
    added.push(nid);
  };
  const neighbors = (pt: Point, layer: CopperLayer, net: string | undefined, self: string): TrackRec[] => {
    const list: TrackRec[] = [];
    index.near({ minX: pt.x - JOIN_NM, minY: pt.y - JOIN_NM, maxX: pt.x + JOIN_NM, maxY: pt.y + JOIN_NM }, layer, (p) => {
      if (p.kind !== "track" || p.owner === self) return;
      const t = doc.records.get(p.owner) as TrackRec;
      if (t.net === net && (near(t.start, pt) || near(t.end, pt)) && !list.some((x) => x.id === t.id)) list.push(t);
    });
    return list.sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  if (rec.kind === "via") {
    const nv = edited({ ...rec, x: rec.x + dx, y: rec.y + dy }, ctx);
    out.set(rec.id, nv);
    moved.push(rec.id);
    const at = { x: nv.x, y: nv.y };
    for (const l of stack) {
      if (!index.of(rec.id).some((p) => p.layer === l)) continue;
      for (const t of neighbors({ x: rec.x, y: rec.y }, l, rec.net, rec.id)) {
        if (out.has(t.id)) continue;
        const startOn = near(t.start, { x: rec.x, y: rec.y });
        const far = startOn ? t.end : t.start;
        const old = startOn ? t.start : t.end;
        if (t.sweep !== undefined) {
          // an arc keeps its sweep; only its end moves
          out.set(t.id, edited(startOn ? { ...t, start: at } : { ...t, end: at }, ctx));
          moved.push(t.id);
          continue;
        }
        const ks = isOcti(at.x - far.x, at.y - far.y) ? [] : postureCorners(far, at, posture, { x: old.x - far.x, y: old.y - far.y });
        const k = ks[0];
        if (!k) {
          if (same(far, at)) {
            removed.add(t.id);
            continue;
          }
          out.set(t.id, edited(startOn ? { ...t, start: at } : { ...t, end: at }, ctx));
        } else {
          out.set(t.id, edited(startOn ? { ...t, start: k } : { ...t, end: k }, ctx));
          addSeg(t, startOn ? at : k, startOn ? k : at);
        }
        moved.push(t.id);
      }
    }
  } else {
    const t = rec;
    if (t.sweep !== undefined) throw new OpError(`${t.id} is an arc; drag its ends' via or segments instead`);
    const ux = t.end.x - t.start.x,
      uy = t.end.y - t.start.y;
    const len = Math.hypot(ux, uy);
    const nx = -uy / len,
      ny = ux / len;
    let v: Point;
    if (ux === 0) v = { x: dx, y: 0 };
    else if (uy === 0) v = { x: 0, y: dy };
    else if (Math.abs(ux) === Math.abs(uy)) {
      // a diagonal keeps its angle exactly: shift by (k, -k) or (k, k)
      if (sgn(ux) === sgn(uy)) {
        const k = Math.round((dx - dy) / 2);
        v = { x: k, y: -k };
      } else {
        const k = Math.round((dx + dy) / 2);
        v = { x: k, y: k };
      }
    } else {
      const d = dx * nx + dy * ny;
      v = { x: Math.round(nx * d), y: Math.round(ny * d) };
    }
    if (v.x === 0 && v.y === 0) return { puts: [], removes: [], moved: [], added: [], removed: [] };
    let ns: Point = { x: t.start.x + v.x, y: t.start.y + v.y };
    let ne: Point = { x: t.end.x + v.x, y: t.end.y + v.y };
    const dir = { x: ux, y: uy };
    for (const which of ["start", "end"] as const) {
      const pt = which === "start" ? t.start : t.end;
      const list = neighbors(pt, t.layer, t.net, t.id);
      const shifted = which === "start" ? ns : ne;
      let done = false;
      if (list.length === 1 && list[0].sweep === undefined) {
        const n = list[0];
        const shareStart = near(n.start, pt);
        const q = shareStart ? n.end : n.start;
        const nd = { x: pt.x - q.x, y: pt.y - q.y };
        const x = intersect(q, nd, shifted, dir);
        // the neighbor keeps its direction from q; it may shorten but not reverse
        if (x && (x.x - q.x) * nd.x + (x.y - q.y) * nd.y > 0) {
          out.set(n.id, edited(shareStart ? { ...n, start: x } : { ...n, end: x }, ctx));
          moved.push(n.id);
          if (which === "start") ns = x;
          else ne = x;
          done = true;
        }
      }
      if (!done && (list.length > 0 || isAnchored(doc, index, pt, t))) {
        // keep the junction where it is and join it to the moved segment
        const mid = postureCorners(pt, shifted, posture, { x: v.x, y: v.y })[0];
        if (mid) {
          addSeg(t, pt, mid);
          addSeg(t, mid, shifted);
        } else addSeg(t, pt, shifted);
      }
    }
    if (same(ns, ne)) removed.add(t.id);
    else {
      out.set(t.id, edited({ ...t, start: ns, end: ne }, ctx));
      moved.push(t.id);
    }
  }
  // degenerate leftovers go
  for (const [rid, r] of out) if (r.kind === "track" && same(r.start, r.end)) {
    out.delete(rid);
    if (doc.records.has(rid)) removed.add(rid);
    const ai = added.indexOf(rid);
    if (ai >= 0) added.splice(ai, 1);
  }
  // never a short
  const ignore = new Set<string>([...out.keys(), ...removed, id]);
  const pieces = [...out.values()].flatMap((r) => copperOf(doc, r, stack));
  for (const r of out.values()) {
    for (const p of copperOf(doc, r, stack)) {
      let hit: string | undefined;
      index.near(inflate(p.box, 1), p.layer, (q) => {
        if (!ignore.has(q.owner) && q.kind !== "hole" && otherNet({ net: (r as TrackRec).net }, q) && primGap(p.prim, q.prim) <= 0) {
          hit = q.id;
          return false;
        }
      });
      if (!hit) for (const q of pieces) if (q.owner !== r.id && q.layer === p.layer && otherNet({ net: (r as TrackRec).net }, q) && primGap(p.prim, q.prim) <= 0) hit = q.id;
      if (hit) throw new OpError(`dragging ${id} would short ${r.id} with ${hit}`);
    }
  }
  return { puts: [...out.values()], removes: [...removed].filter((x) => doc.records.has(x)), moved: [...new Set(moved)].filter((x) => !removed.has(x)).sort(), added, removed: [...removed].sort() };
}

/** Whether a segment's end sits on a pad or via of its net (a fixed anchor a drag must keep). */
function isAnchored(doc: BoardDocument, index: CopperIndex, pt: Point, t: TrackRec): boolean {
  let hit = false;
  index.near({ minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y }, t.layer, (p) => {
    if ((p.kind === "pad" || p.kind === "via") && p.net === t.net && onPiece(pt, p)) {
      hit = true;
      return false;
    }
  });
  return hit;
}

// ---------------------------------------------------------------- track.route

export interface RouteInput {
  net: string;
  width: number;
  points: { x: number; y: number; layer: CopperLayer }[];
  via?: { outer_diameter: number; hole_diameter: number };
  viaSpan?: "through" | "pair";
  handle?: string;
  locked?: boolean;
}

/** DEFAULT: the via of a route when the input gives none (nm). */
export const ROUTE_VIA_DEFAULT = { outer_diameter: 600_000, hole_diameter: 300_000 } as const;

/** The records of a route: a segment per pair of points on one layer, a via per layer change at one point. */
export function planRoute(doc: BoardDocument, input: RouteInput, ctx: PlanContext): { records: (TrackRec | ViaRec)[]; created: Record<string, string> } {
  const stack = copperLayers(doc);
  const h = input.handle ?? "r";
  const records: (TrackRec | ViaRec)[] = [];
  const created: Record<string, string> = {};
  let s = 0,
    v = 0;
  const pts = input.points;
  for (const p of pts) if (!stack.includes(p.layer)) throw new OpError(`layer ${p.layer} is not in this board's stackup (${stack.join(", ")})`);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if (a.layer === b.layer) {
      if (a.x === b.x && a.y === b.y) throw new OpError(`points ${i} and ${i + 1} are the same point on one layer`);
      const id = ctx.issueId("track");
      created[`${h}_s${s++}`] = id;
      records.push({ kind: "track", id, net: input.net, layer: a.layer, width: input.width, start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, provenance: ctx.provenance });
    } else {
      if (a.x !== b.x || a.y !== b.y) throw new OpError(`points ${i} and ${i + 1} change layer at different places (a via joins two points at the same x, y)`);
      const ia = stack.indexOf(a.layer),
        ib = stack.indexOf(b.layer);
      const span = input.viaSpan ?? "through";
      const from = span === "through" ? stack[0] : stack[Math.min(ia, ib)];
      const to = span === "through" ? stack[stack.length - 1] : stack[Math.max(ia, ib)];
      const via = input.via ?? ROUTE_VIA_DEFAULT;
      if (via.hole_diameter >= via.outer_diameter) throw new OpError("the via's hole must be smaller than its outer diameter");
      const id = ctx.issueId("via");
      created[`${h}_v${v++}`] = id;
      records.push({ kind: "via", id, net: input.net, x: a.x, y: a.y, outer_diameter: via.outer_diameter, hole_diameter: via.hole_diameter, from_layer: from, to_layer: to, provenance: ctx.provenance });
    }
  }
  if (!s) throw new OpError("a route needs at least one segment");
  return { records, created };
}

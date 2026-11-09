/**
 * The interactive routing session (contract phase2-editing.md, section 7). A draft that reads one snapshot: each
 * cursor move re-plans the head from the last fixed point in walk-around mode (direct postures first, then a
 * time-budgeted grid search around obstacles pulled taut into 45 and 90 degree segments), every returned segment
 * verified with exact geometry. Nothing is written until `finish()` hands back one `track.route` call.
 */
import { parsePadId, postureCorners, segmentPrim, type BoardDocument, type CopperLayer, type CopperPiece, type OpCall, type RuleTier, type Transaction, type TrackRec, type ViaRec } from "@protoboardai/board/browser";
import type { Resolved } from "./rules.js";
import type { LayerContext, RouteWorld, Slack } from "./world.js";

export interface Pt {
  x: number;
  y: number;
}
export interface DraftPoint extends Pt {
  layer: CopperLayer;
}

export type RouteStart = { pad: string } | { via: string } | { track: string; end: "start" | "end" } | { x: number; y: number; layer: CopperLayer };

export interface RouteOptions {
  from: RouteStart;
  net?: string;
  layer?: CopperLayer;
  width?: number;
  mode?: "walkaround" | "highlight";
  posture?: "45" | "90";
}

export interface CopperRef {
  kind: "pad" | "via" | "track";
  id: string;
}

export interface RouteCandidate {
  ok: boolean;
  points: DraftPoint[];
  head: DraftPoint[];
  layer: CopperLayer;
  net: string;
  snapped?: CopperRef & Pt;
  reached?: CopperRef;
  width: { value: number; rule?: string; tier?: RuleTier; source: "rule" | "default" | "given" };
  clearance: { value: number; rule?: string; tier?: RuleTier; source: "rule" | "default" };
  limiting?: { check: Slack["check"]; rule?: string; tier?: RuleTier; required: number; actual: number; against: string };
  length: { total: number; head: number };
  collisions: { id: string; layer: CopperLayer; required: number; actual: number; rule?: string }[];
  stuck?: { at: Pt; blockers: string[] };
  timing: { ms: number; budgetHit: boolean; expanded: number };
}

export interface RouteFinish {
  call: OpCall;
  tx: Transaction;
  complete: boolean;
}

/** A head planner (walk-around and highlight are built in; a shove planner would plug in here). */
export interface HeadPlan {
  pts: Pt[];
  ok: boolean;
  stuck?: { at: Pt; blockers: string[] };
  budgetHit: boolean;
  expanded: number;
  collisions: Slack[];
}
export interface HeadPlanner {
  plan(ctx: PlanInput, from: Pt, to: Pt): HeadPlan;
}
export interface PlanInput {
  layer: LayerContext;
  posture: "45" | "90";
  /** Slack a segment may not go below (0, or the start's own slack when the start already sits closer than the rules). */
  floor: number;
  deadline: number;
  prefer?: Pt;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const isOcti = (a: Pt, b: Pt) => a.x === b.x || a.y === b.y || Math.abs(a.x - b.x) === Math.abs(a.y - b.y);
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function segOk(ctx: PlanInput, a: Pt, b: Pt): boolean {
  if (same(a, b)) return true;
  const s = ctx.layer.primSlack(segmentPrim(a.x, a.y, b.x, b.y, ctx.layer.r));
  return !s || s.slack >= ctx.floor;
}
function pathOk(ctx: PlanInput, pts: Pt[]): boolean {
  for (let i = 0; i + 1 < pts.length; i++) if (!segOk(ctx, pts[i], pts[i + 1])) return false;
  return true;
}

/** Direct postures from a to b: one segment when octilinear, else the two corners. */
function directPaths(a: Pt, b: Pt, posture: "45" | "90", prefer?: Pt): Pt[][] {
  if (same(a, b)) return [[a]];
  const out: Pt[][] = [];
  if (posture === "45" ? isOcti(a, b) : a.x === b.x || a.y === b.y) out.push([a, b]);
  for (const k of postureCorners(a, b, posture, prefer)) out.push([a, k, b]);
  return out;
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const k = this.k,
      p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (p[u] <= p[i]) break;
      [k[u], k[i]] = [k[i], k[u]];
      [p[u], p[i]] = [p[i], p[u]];
      i = u;
    }
  }
  pop(): number {
    const k = this.k,
      p = this.p;
    const top = k[0];
    const lk = k.pop()!,
      lp = p.pop()!;
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Walk-around: direct postures, else a grid search around obstacles, pulled taut at the posture. */
export class WalkaroundPlanner implements HeadPlanner {
  /** Grid free-cell cache per (layer, net, radius, origin, step). */
  private cache = new Map<string, Map<number, boolean>>();

  constructor(private readonly step: number) {}

  reset(): void {
    this.cache.clear();
  }

  plan(ctx: PlanInput, from: Pt, to: Pt): HeadPlan {
    const base = { budgetHit: false, expanded: 0, collisions: [] };
    for (const p of directPaths(from, to, ctx.posture, ctx.prefer)) if (pathOk(ctx, p)) return { ...base, pts: p, ok: true };
    const h = this.step;
    const key = `${ctx.layer.layer}|${ctx.layer.net}|${ctx.layer.r}|${from.x},${from.y}|${h}|${ctx.floor}`;
    let free = this.cache.get(key);
    if (!free) {
      if (this.cache.size > 64) this.cache.clear();
      this.cache.set(key, (free = new Map()));
    }
    const OFF = 1 << 14,
      SPAN = 1 << 15;
    const id = (i: number, j: number) => (i + OFF) * SPAN + (j + OFF);
    const margin = 0.75 * h;
    const freeAt = (i: number, j: number): boolean => {
      if (i === 0 && j === 0) return true;
      const k = id(i, j);
      let v = free!.get(k);
      if (v === undefined) {
        v = ctx.layer.pointSlack(from.x + i * h, from.y + j * h, margin + ctx.floor) >= margin + ctx.floor;
        free!.set(k, v);
      }
      return v;
    };
    const ti = Math.round((to.x - from.x) / h),
      tj = Math.round((to.y - from.y) / h);
    // the goal: the target cell, or the free cell nearest it
    let gi = ti,
      gj = tj;
    if (!freeAt(gi, gj)) {
      let found = false;
      const R = Math.ceil(2_000_000 / h);
      for (let rad = 1; rad <= R && !found; rad++) {
        let best: [number, number, number] | undefined;
        for (let di = -rad; di <= rad; di++)
          for (const dj of Math.abs(di) === rad ? Array.from({ length: 2 * rad + 1 }, (_, k) => k - rad) : [-rad, rad]) {
            if (!freeAt(ti + di, tj + dj)) continue;
            const d = di * di + dj * dj;
            if (!best || d < best[2]) best = [ti + di, tj + dj, d];
          }
        if (best) {
          [gi, gj] = best;
          found = true;
        }
        if (now() > ctx.deadline) break;
      }
      if (!found) return { ...base, pts: [from], ok: true, stuck: { at: to, blockers: [] }, budgetHit: now() > ctx.deadline };
    }
    const win = Math.max(Math.abs(gi), Math.abs(gj)) + Math.max(40, Math.ceil(0.6 * Math.max(Math.abs(gi), Math.abs(gj))));
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const heap = new MinHeap();
    const hz = (i: number, j: number) => {
      const dx = Math.abs(i - gi),
        dy = Math.abs(j - gj);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * 1.15;
    };
    const s0 = id(0, 0),
      goal = id(gi, gj);
    g.set(s0, 0);
    heap.push(s0, hz(0, 0));
    let best = s0,
      bestH = hz(0, 0);
    let expanded = 0,
      budgetHit = false,
      found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === goal) {
        found = true;
        break;
      }
      const ci = Math.floor(cur / SPAN) - OFF,
        cj = (cur % SPAN) - OFF;
      const hc = hz(ci, cj);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (++expanded % 64 === 0 && now() > ctx.deadline) {
        budgetHit = true;
        break;
      }
      const gc = g.get(cur)!;
      for (const [di, dj, c] of STEPS) {
        const i = ci + di,
          j = cj + dj;
        if (Math.abs(i) > win || Math.abs(j) > win) continue;
        const nb = id(i, j);
        if (closed.has(nb) || !freeAt(i, j)) continue;
        if (di && dj && (!freeAt(ci + di, cj) || !freeAt(ci, cj + dj))) continue;
        const t = gc + c;
        if (t < (g.get(nb) ?? Infinity)) {
          g.set(nb, t);
          came.set(nb, cur);
          heap.push(nb, t + hz(i, j));
        }
      }
    }
    const end = found ? goal : best;
    const cells: Pt[] = [];
    for (let c: number | undefined = end; c !== undefined; c = came.get(c)) cells.push({ x: from.x + (Math.floor(c / SPAN) - OFF) * h, y: from.y + ((c % SPAN) - OFF) * h });
    cells.reverse();
    cells[0] = from;
    // corners only (runs of one direction collapse)
    const corners: Pt[] = [cells[0]];
    for (let k = 1; k < cells.length; k++) {
      const a = corners[corners.length - 1],
        b = cells[k],
        c = cells[k + 1];
      if (!c) {
        corners.push(b);
        break;
      }
      const d1 = [Math.sign(b.x - a.x), Math.sign(b.y - a.y)],
        d2 = [Math.sign(c.x - b.x), Math.sign(c.y - b.y)];
      if (d1[0] !== d2[0] || d1[1] !== d2[1]) corners.push(b);
    }
    const reachedTarget = found && gi === ti && gj === tj;
    if (reachedTarget && !same(corners[corners.length - 1], to)) corners.push(to);
    const pts = this.pull(ctx, corners);
    const ok = pathOk(ctx, pts);
    return { pts, ok, budgetHit, expanded, collisions: [], ...(found && reachedTarget ? {} : { stuck: { at: pts[pts.length - 1], blockers: [] } }) };
  }

  /** Pull a corner path taut: from each point, jump to the farthest later point a legal direct posture reaches. */
  private pull(ctx: PlanInput, c: Pt[]): Pt[] {
    const out: Pt[] = [c[0]];
    let i = 0;
    while (i < c.length - 1) {
      let moved = false;
      for (let j = c.length - 1; j > i; j--) {
        let path: Pt[] | undefined;
        for (const p of directPaths(c[i], c[j], ctx.posture)) if (pathOk(ctx, p)) {
          path = p;
          break;
        }
        if (!path && j === i + 1) path = [c[i], c[j]];
        if (path) {
          for (const p of path.slice(1)) out.push(p);
          i = j;
          moved = true;
          break;
        }
        if (now() > ctx.deadline + 4) {
          // out of time: keep the rest as the grid gave it
          for (const p of c.slice(i + 1)) out.push(p);
          return out;
        }
      }
      if (!moved) break;
    }
    return out;
  }
}

/** Highlight collisions: straight to the cursor at the posture, listing what it breaks. */
export function highlightPlan(ctx: PlanInput, from: Pt, to: Pt): HeadPlan {
  const pts = directPaths(from, to, ctx.posture, ctx.prefer)[0] ?? [from, to];
  const collisions: Slack[] = [];
  for (let i = 0; i + 1 < pts.length; i++) if (!same(pts[i], pts[i + 1])) collisions.push(...ctx.layer.violations(segmentPrim(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, ctx.layer.r)));
  return { pts, ok: !collisions.length, budgetHit: false, expanded: 0, collisions };
}

const centerOf = (p: CopperPiece): Pt => {
  const n = p.prim.pts.length / 2;
  let x = 0,
    y = 0;
  for (let i = 0; i < n; i++) {
    x += p.prim.pts[2 * i];
    y += p.prim.pts[2 * i + 1];
  }
  return { x: Math.round(x / n), y: Math.round(y / n) };
};

export interface SessionHost {
  world: RouteWorld;
  doc: BoardDocument;
  epoch: string;
  seq: number;
  budgetMs: number;
  sessionId: string;
}

export class RouteSession {
  readonly net: string;
  private layer: CopperLayer;
  private width: RouteCandidate["width"];
  private mode: "walkaround" | "highlight";
  private posture: "45" | "90";
  private fixed: DraftPoint[] = [];
  private marks: number[] = [];
  private head: DraftPoint[] = [];
  private cursor?: Pt;
  private start: CopperRef | undefined;
  private last?: RouteCandidate;
  private readonly planner: WalkaroundPlanner;
  private serial = 0;
  private readonly givenWidth: boolean;
  private done = false;

  constructor(private readonly host: SessionHost, opts: RouteOptions) {
    const doc = host.doc;
    const s = this.resolveStart(doc, opts.from);
    const net = opts.net ?? s.net;
    if (!net) throw new Error("a route needs a net: start on a pad, via or track of a net, or pass net");
    if (s.net && opts.net && s.net !== opts.net) throw new Error(`the start is on net ${s.net}, not ${opts.net}`);
    this.net = net;
    this.layer = opts.layer ?? s.layer;
    if (!host.world.stack.includes(this.layer)) throw new Error(`layer ${this.layer} is not in this board's stackup`);
    if (s.layers && !s.layers.includes(this.layer)) throw new Error(`the start has no copper on ${this.layer}`);
    this.mode = opts.mode ?? "walkaround";
    this.posture = opts.posture ?? "45";
    this.givenWidth = opts.width !== undefined;
    this.width = opts.width !== undefined ? { value: opts.width, source: "given" } : this.resolvedWidth();
    this.start = s.ref;
    this.fixed = [{ x: s.at.x, y: s.at.y, layer: this.layer }];
    this.planner = new WalkaroundPlanner(this.gridStep());
  }

  private resolvedWidth(): RouteCandidate["width"] {
    const w = this.host.world.rules.width(this.net, this.layer);
    return { value: w.value, ...(w.rule ? { rule: w.rule } : {}), ...(w.tier ? { tier: w.tier } : {}), source: w.source };
  }

  private gridStep(): number {
    const c = this.host.world.rules.clearance(this.net, undefined, this.layer, "track").value;
    return Math.max(25_000, Math.min(200_000, Math.round((this.width.value / 2 + c) / 3 / 1000) * 1000));
  }

  private resolveStart(doc: BoardDocument, from: RouteStart): { at: Pt; layer: CopperLayer; net?: string; ref?: CopperRef; layers?: CopperLayer[] } {
    const world = this.host.world;
    if ("pad" in from) {
      const pid = parsePadId(from.pad);
      const fp = pid ? doc.records.get(pid.footprint) : undefined;
      if (!pid || fp?.kind !== "footprint") throw new Error(`no pad ${from.pad} on this board`);
      const pieces = world.index.of(fp.id).filter((p) => p.id === from.pad && p.kind === "pad");
      if (!pieces.length) throw new Error(`pad ${from.pad} has no copper`);
      const net = doc.padNets.get(from.pad);
      return { at: centerOf(pieces[0]), layer: pieces[0].layer, ...(net ? { net } : {}), ref: { kind: "pad", id: from.pad }, layers: pieces.map((p) => p.layer) };
    }
    if ("via" in from) {
      const v = doc.records.get(from.via) as ViaRec | undefined;
      if (v?.kind !== "via") throw new Error(`no via ${from.via} on this board`);
      const layers = world.index.of(v.id).map((p) => p.layer);
      return { at: { x: v.x, y: v.y }, layer: v.from_layer, ...(v.net ? { net: v.net } : {}), ref: { kind: "via", id: v.id }, layers };
    }
    if ("track" in from) {
      const t = doc.records.get(from.track) as TrackRec | undefined;
      if (t?.kind !== "track") throw new Error(`no track ${from.track} on this board`);
      const at = from.end === "start" ? t.start : t.end;
      return { at: { ...at }, layer: t.layer, ...(t.net ? { net: t.net } : {}), ref: { kind: "track", id: t.id }, layers: [t.layer] };
    }
    return { at: { x: from.x, y: from.y }, layer: from.layer };
  }

  /** Same-net copper near the cursor on the current layer: pad and via centers, track ends. */
  private snap(c: Pt): (CopperRef & Pt) | undefined {
    const world = this.host.world;
    const R = Math.max(500_000, 2 * this.width.value);
    let best: (CopperRef & Pt & { d: number }) | undefined;
    const consider = (ref: CopperRef, p: Pt) => {
      const d = dist(p, c);
      if (d <= R && (!best || d < best.d)) best = { ...ref, ...p, d };
    };
    world.index.near({ minX: c.x - R, minY: c.y - R, maxX: c.x + R, maxY: c.y + R }, this.layer, (p) => {
      if (p.net !== this.net) return;
      if (p.kind === "pad") consider({ kind: "pad", id: p.id }, centerOf(p));
      else if (p.kind === "via") consider({ kind: "via", id: p.id }, centerOf(p));
      else if (p.kind === "track") {
        const t = this.host.doc.records.get(p.owner) as TrackRec;
        consider({ kind: "track", id: t.id }, t.start);
        consider({ kind: "track", id: t.id }, t.end);
      }
    });
    if (!best) return undefined;
    const { d: _d, ...out } = best;
    return out;
  }

  private ctxFor(deadline: number, from: Pt, to?: Pt): PlanInput {
    const layer = this.host.world.context(this.net, this.layer, this.width.value / 2);
    // a start (or a snapped end) already closer than the rules allow does not make every route illegal
    let floor = Math.min(0, layer.pointSlack(from.x, from.y));
    if (to) floor = Math.min(floor, layer.pointSlack(to.x, to.y));
    const prev = this.fixed.length >= 2 ? this.fixed[this.fixed.length - 2] : undefined;
    const prefer = prev && prev.layer === this.layer ? { x: from.x - prev.x, y: from.y - prev.y } : undefined;
    return { layer, posture: this.posture, floor: floor < 0 ? floor - 1 : 0, deadline, ...(prefer ? { prefer } : {}) };
  }

  /** Re-plan the head to the cursor. */
  move(cursor: Pt): RouteCandidate {
    this.live();
    const t0 = now();
    this.cursor = { x: Math.round(cursor.x), y: Math.round(cursor.y) };
    const from = this.fixed[this.fixed.length - 1];
    const snapped = this.snap(this.cursor);
    const target = snapped ? { x: snapped.x, y: snapped.y } : this.cursor;
    const ctx = this.ctxFor(t0 + this.host.budgetMs, from, snapped ? target : undefined);
    const plan = this.mode === "highlight" ? highlightPlan(ctx, from, target) : this.planner.plan(ctx, from, target);
    // walk-around never hands out an illegal head: keep the last legal one
    if (this.mode === "walkaround" && !plan.ok && this.last && this.last.ok && this.last.layer === this.layer) {
      this.last = { ...this.last, timing: { ms: round2(now() - t0), budgetHit: plan.budgetHit, expanded: plan.expanded } };
      return this.last;
    }
    this.head = plan.pts.slice(1).map((p) => ({ x: p.x, y: p.y, layer: this.layer }));
    const endsAt = plan.pts[plan.pts.length - 1];
    const reached = snapped && same(endsAt, target) && !(this.start && snapped.id === this.start.id && same(target, this.fixed[0])) ? { kind: snapped.kind, id: snapped.id } : undefined;
    this.last = this.candidate(ctx, plan, snapped, reached, t0);
    return this.last;
  }

  private candidate(ctx: PlanInput, plan: HeadPlan, snapped: (CopperRef & Pt) | undefined, reached: CopperRef | undefined, t0: number): RouteCandidate {
    const points = [...this.fixed, ...this.head];
    let total = 0,
      head = 0;
    for (let i = 0; i + 1 < points.length; i++) if (points[i].layer === points[i + 1].layer) total += dist(points[i], points[i + 1]);
    const hp = [this.fixed[this.fixed.length - 1], ...this.head];
    for (let i = 0; i + 1 < hp.length; i++) head += dist(hp[i], hp[i + 1]);
    let limiting: RouteCandidate["limiting"];
    if (hp.length >= 2) {
      const a = hp[hp.length - 2],
        b = hp[hp.length - 1];
      const s = ctx.layer.primSlack(segmentPrim(a.x, a.y, b.x, b.y, ctx.layer.r));
      if (s) limiting = { check: s.check, ...(s.rule ? { rule: s.rule } : {}), ...(s.tier ? { tier: s.tier } : {}), required: Math.round(s.required), actual: Math.round(s.gap), against: s.against };
    }
    const cl: Resolved = this.host.world.rules.clearance(this.net, undefined, this.layer, "track");
    return {
      ok: plan.ok,
      points: points.map((p) => ({ ...p })),
      head: this.head.map((p) => ({ ...p })),
      layer: this.layer,
      net: this.net,
      ...(snapped ? { snapped } : {}),
      ...(reached ? { reached } : {}),
      width: { ...this.width },
      clearance: { value: cl.value, ...(cl.rule ? { rule: cl.rule } : {}), ...(cl.tier ? { tier: cl.tier } : {}), source: cl.source },
      ...(limiting ? { limiting } : {}),
      length: { total: Math.round(total), head: Math.round(head) },
      collisions: plan.collisions.map((c) => ({ id: c.against, layer: this.layer, required: Math.round(c.required), actual: Math.round(c.gap), ...(c.rule ? { rule: c.rule } : {}) })),
      ...(plan.stuck ? { stuck: plan.stuck } : {}),
      timing: { ms: round2(now() - t0), budgetHit: plan.budgetHit, expanded: plan.expanded },
    };
  }

  /** Fix the head up to the cursor; later moves start there. */
  click(cursor?: Pt): RouteCandidate {
    this.live();
    const c = cursor ? this.move(cursor) : this.last ?? this.move(this.fixed[this.fixed.length - 1]);
    if ((c.ok || this.mode === "highlight") && this.head.length) {
      this.marks.push(this.fixed.length);
      this.fixed.push(...this.head);
      this.head = [];
    }
    return c;
  }

  /** Place a via at the head's end (or the nearest legal spot) and continue on `layer`. */
  changeLayer(layer?: CopperLayer): { ok: boolean; via?: Pt; reason?: string } {
    this.live();
    const stack = this.host.world.stack as CopperLayer[];
    const next = layer ?? (this.layer === stack[0] ? stack[stack.length - 1] : stack[0]);
    if (!stack.includes(next)) return { ok: false, reason: `layer ${next} is not in this board's stackup` };
    if (next === this.layer) return { ok: false, reason: `the route is already on ${next}` };
    if (this.head.length && this.last?.ok) {
      this.marks.push(this.fixed.length);
      this.fixed.push(...this.head);
      this.head = [];
    }
    const e = this.fixed[this.fixed.length - 1];
    const via = this.host.world.rules.via();
    const r = via.outer / 2;
    const legalVia = (p: Pt) => stack.every((l) => this.host.world.context(this.net, l, r, "via").pointSlack(p.x, p.y) >= 0);
    const here = this.host.world.context(this.net, this.layer, this.width.value / 2);
    let spot: Pt | undefined = legalVia(e) ? e : undefined;
    if (!spot) {
      const h = Math.max(25_000, Math.round(via.outer / 8));
      const cands: Pt[] = [];
      const R = Math.ceil((2 * via.outer) / h);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (i || j) cands.push({ x: e.x + i * h, y: e.y + j * h });
      cands.sort((a, b) => dist(a, e) - dist(b, e));
      const deadline = now() + this.host.budgetMs;
      for (const p of cands) {
        if (dist(p, e) > 2 * via.outer) break;
        if (!legalVia(p)) continue;
        const ctx: PlanInput = { layer: here, posture: this.posture, floor: Math.min(0, here.pointSlack(e.x, e.y)), deadline };
        const path = directPaths(e, p, this.posture).find((q) => pathOk(ctx, q));
        if (path) {
          spot = p;
          this.marks.push(this.fixed.length);
          for (const q of path.slice(1)) this.fixed.push({ x: q.x, y: q.y, layer: this.layer });
          break;
        }
        if (now() > deadline) break;
      }
    }
    if (!spot) return { ok: false, reason: `no legal spot for a ${via.outer} nm via within ${2 * via.outer} nm of the head` };
    if (spot === e) this.marks.push(this.fixed.length);
    this.fixed.push({ x: spot.x, y: spot.y, layer: next });
    this.layer = next;
    if (!this.givenWidth) this.width = this.resolvedWidth();
    this.planner.reset();
    this.last = undefined;
    return { ok: true, via: { ...spot } };
  }

  /** Retract the last fixed piece (and its via). */
  back(): RouteCandidate | undefined {
    this.live();
    const m = this.marks.pop();
    if (m === undefined) return this.last;
    this.fixed.length = Math.max(1, m);
    this.layer = this.fixed[this.fixed.length - 1].layer;
    if (!this.givenWidth) this.width = this.resolvedWidth();
    this.head = [];
    this.last = undefined;
    this.planner.reset();
    return this.cursor ? this.move(this.cursor) : undefined;
  }

  setWidth(w: number): void {
    this.width = { value: Math.round(w), source: "given" };
    this.planner.reset();
    this.last = undefined;
  }
  setMode(m: "walkaround" | "highlight"): void {
    this.mode = m;
    this.last = undefined;
  }
  flipPosture(): void {
    this.posture = this.posture === "45" ? "90" : "45";
    this.last = undefined;
  }

  /** The draft as one `track.route` call and a transaction refused if its neighborhood changed. */
  finish(): RouteFinish | { error: string } {
    this.live();
    const pts = [...this.fixed, ...(this.last && (this.last.ok || this.mode === "highlight") ? this.head : [])];
    const clean: DraftPoint[] = [];
    for (const p of pts) {
      const q = clean[clean.length - 1];
      if (q && q.x === p.x && q.y === p.y && q.layer === p.layer) continue;
      clean.push(p);
    }
    // a via as the last step leads nowhere
    while (clean.length >= 2 && same(clean[clean.length - 1], clean[clean.length - 2])) clean.pop();
    if (clean.length < 2) return { error: "the route has no segment yet" };
    const via = this.host.world.rules.via();
    const handle = "r";
    const call: OpCall = { op: "track.route", net: this.net, width: this.width.value, points: clean.map((p) => ({ x: p.x, y: p.y, layer: p.layer })), via: { outer_diameter: via.outer, hole_diameter: via.hole }, handle };
    const reach = this.host.world.maxClearance + Math.max(this.width.value, via.outer);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of clean) {
      box.minX = Math.min(box.minX, p.x - reach);
      box.minY = Math.min(box.minY, p.y - reach);
      box.maxX = Math.max(box.maxX, p.x + reach);
      box.maxY = Math.max(box.maxY, p.y + reach);
    }
    const layers = clean.some((p, i) => i > 0 && same(p, clean[i - 1])) ? [...this.host.world.stack] : [...new Set(clean.map((p) => p.layer))];
    const tx: Transaction = {
      batchId: `route.${this.host.sessionId}.${++this.serial}`,
      label: `route ${this.net.replace(/\s+/g, "_")} by hand`.slice(0, 120),
      ops: [call],
      expectEpoch: this.host.epoch,
      expectRegion: { box: { minX: Math.floor(box.minX), minY: Math.floor(box.minY), maxX: Math.ceil(box.maxX), maxY: Math.ceil(box.maxY) }, layers, seq: this.host.seq },
    };
    this.done = true;
    return { call, tx, complete: !!this.last?.reached };
  }

  cancel(): void {
    this.done = true;
  }

  get state(): { points: DraftPoint[]; layer: CopperLayer; width: number; mode: string; posture: string } {
    return { points: [...this.fixed, ...this.head], layer: this.layer, width: this.width.value, mode: this.mode, posture: this.posture };
  }

  private live(): void {
    if (this.done) throw new Error("this route session has ended");
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Group frames: a frame around the parts of each UHD group on each side, with a title.
 *
 * The frame is the outline of a region: the group's courtyards' box grown by `frame.offset`, less other parts'
 * courtyards (grown by `frame.clearance.part`) and frames already drawn (grown by `frame.clearance.frame`), plus the
 * members' own courtyards (members always stay inside), cut to the board area inset by `silk.clearance.edge`. Where
 * the region runs along the board edge the frame stays open. Convex corners get the theme's corner (45 degree
 * chamfer, round, bracket or square), as deep as `frame.chamfer` allows without cutting into a member. Lines break
 * where they would come within `silk.clearance.pad` of a pad, via or hole. Titles are knockout tags on a top edge
 * (or another edge) where they clear pads and other silk, else plain text beside the frame, else none (logged).
 */
import { mm, recordsOfKind, type BoardDocument, type Side } from "@protoboardai/board";
import { pointInPoly, polyCore, segShape, shape, shapeGap, type Shape } from "@protoboardai/board-checks";
import { grow } from "@protoboardai/board-fill";
import { changeSet, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { difference, intersection, knockoutTag, nm, ringsOf, simplifyRing, union, type Polygon, type Ring } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace, clearPieces, ringShape, strokeShape } from "../space.js";
import { boardInset, cased, courtyardRing, groupsOf, ringBox, silkClearances, silkLayer, sidesOf, textBox, textClassNm, textShape, vertices, type DrawOptions } from "./common.js";

export interface FramesOptions extends DrawOptions {
  /** Explicit groups instead of UHD paths. */
  groups?: { key: string; title?: string; members: string[] }[];
  /** Titles by group key. */
  titles?: Record<string, string>;
}

type Pt = [number, number];

const TAG_PAD = 200_000;

export function styleFrames(doc: BoardDocument, style: ResolvedStyle, o: FramesOptions = {}): StyleChangeSet {
  const frameStyle = tok<string>(style, "frame.style");
  const skipped: Skipped[] = [];
  const notes: string[] = [];
  const desired: Desired[] = [];
  const framesReport: { group: string; side: Side; title?: string; titleAs?: string; open: boolean; pieces: number; members: string[] }[] = [];
  if (frameStyle === "none") return changeSet("frames", "Remove group frames (theme draws none)", "remove group frames", doc, [], { notes: ["frame.style is none"], ...(o.force ? { force: true } : {}) });

  const space = new BoardSpace(doc, { ignoreSilk: ignoredByTool(doc, "frames") });
  const line = nm(tokNum(style, "silk.line"));
  const offset = nm(tokNum(style, "frame.offset"));
  const partClr = nm(tokNum(style, "frame.clearance.part"));
  const frameClr = nm(tokNum(style, "frame.clearance.frame"));
  const edgeClr = nm(tokNum(style, "silk.clearance.edge"));
  const [cMin, cMax] = tok<number[]>(style, "frame.chamfer").map(nm);
  const minParts = tokNum(style, "frame.minParts");
  const titleMode = tok<string>(style, "frame.title");
  const tcls = textClassNm(style, "type.class.groupTitle");
  const clr = silkClearances(style, { silk: true });
  const inset = boardInset(doc, edgeClr + line / 2);
  const insetR = ringsOf(inset);
  const claimed: Ring[] = [];
  const groups = groupsOf(doc, tokNum(style, "frame.groupDepth"), o.groups);

  for (const side of sidesOf(style, "frame.sides")) {
    const layer = silkLayer(side);
    for (const g of groups) {
      const members = g.members.filter((f) => f.side === side);
      if (members.length < minParts) {
        if (members.length) skipped.push({ what: `${g.key} (${side})`, reason: `${members.length} part${members.length === 1 ? "" : "s"} on this side, fewer than frame.minParts (${minParts})`, objects: members.map((m) => m.id) });
        continue;
      }
      const memberIds = new Set(members.map((m) => m.id));
      const courts = members.map(courtyardRing);
      const b = courts.map(ringBox).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }));
      const base: Ring = [b.minX - offset, b.minY - offset, b.maxX + offset, b.minY - offset, b.maxX + offset, b.maxY + offset, b.minX - offset, b.maxY + offset];
      const others = recordsOfKind(doc, "footprint").filter((f) => f.side === side && !memberIds.has(f.id));
      const blockRings = ringsOf(grow(union(others.map(courtyardRing)), partClr + line / 2, 20_000));
      const claimedR = claimed.length ? ringsOf(grow(union(claimed), frameClr + line / 2, 20_000)) : [];
      let region = difference([base], [...blockRings, ...claimedR]);
      const keep = ringsOf(grow(union(courts), Math.min(offset, line / 2 + 50_000), 20_000));
      region = union([...ringsOf(region), ...keep]);
      if (insetR.length) region = intersection(ringsOf(region), insetR);
      const centers = members.map((m) => [m.x, m.y] as Pt);
      const comps = region.filter((p) => centers.some(([x, y]) => pointInPoly(polyCore([p.outer]), x, y)));
      if (!comps.length) {
        skipped.push({ what: `${g.key} (${side})`, reason: "no room for a frame inside the board area", objects: [...memberIds] });
        continue;
      }
      if (comps.length > 1) notes.push(`${g.key} (${side}): other parts split the group, so it has ${comps.length} frames`);
      const enclosed = others.filter((f) => comps.some((p) => p.holes.length && pointInPoly(polyCore([p.outer]), f.x, f.y)));
      if (enclosed.length) notes.push(`${g.key} (${side}): the frame goes around ${enclosed.map((f) => f.ref).join(", ")}, which ${enclosed.length === 1 ? "is" : "are"} not in the group`);
      const memberShapes = courts.map((r) => shape(polyCore([r]), 0));
      let tagged = false;
      comps.sort((a, b2) => area(b2) - area(a));
      comps.forEach((comp, ci) => {
        const outer = simplifyRing(comp.outer, 50);
        claimed.push(outer);
        const open = openEdges(outer, space, edgeClr + line / 2);
        const runs = cornered(outer, open, frameStyle, cMin, cMax, line, memberShapes);
        // title (on the largest component only)
        let tagRing: Ring | undefined;
        let titleAs: string | undefined;
        const title = cased(o.titles?.[g.key] ?? g.title, tcls.cls);
        if (ci === 0 && titleMode !== "none" && title) {
          const t = placeTitle(outer, open, title, side, titleMode, tcls.height, tcls.stroke, line, space, clr, memberIds);
          if (t) {
            titleAs = t.as;
            tagged = true;
            if (t.as === "tag") {
              tagRing = t.ring;
              for (const c of t.contours) desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pairs(c)), stroke_width: 0, filled: true });
              space.addSilk(`tag:${g.key}`, side, [ringShape(t.ring)]);
            } else {
              desired.push({ kind: "text", layer, text: title, x: t.x, y: t.y, height: tcls.height, stroke_width: tcls.stroke, anchor: "left", ...(side === "bottom" ? { mirrored: true as const } : {}) });
              space.addSilk(`title:${g.key}`, side, [t.shape]);
            }
          } else skipped.push({ what: `${g.key} (${side}) title`, reason: "no spot on or beside the frame clears pads and other silk" });
        }
        let pieces = 0;
        for (const run of runs) {
          const cut = tagRing ? cutByBox(run, ringBox(tagRing), line) : [run];
          for (const c of cut) {
            const ps = clearPieces(space, c, line, side, { pad: clr.pad, edge: 0 }, { footprints: memberIds });
            for (const piece of ps) {
              const closed = runs.length === 1 && cut.length === 1 && ps.length === 1 && piece.length > 3 && same(piece[0], piece[piece.length - 1]);
              desired.push(closed ? { kind: "graphic", layer, shape: "polygon", points: vertices(piece.slice(0, -1)), stroke_width: line } : { kind: "graphic", layer, shape: "path", points: vertices(piece), stroke_width: line });
              space.addSilk(`frame:${g.key}`, side, piece.slice(1).map((p, i) => strokeShape(piece[i][0], piece[i][1], p[0], p[1], line)));
              pieces++;
            }
          }
        }
        framesReport.push({ group: g.key, side, ...(ci === 0 ? { title } : {}), ...(titleAs ? { titleAs } : {}), open: open.some(Boolean), pieces, members: [...memberIds].sort() });
      });
      if (!tagged && titleMode !== "none") notes.push(`${g.key} (${side}): framed without a title`);
    }
  }
  return changeSet("frames", `Frame ${framesReport.length} groups in the ${style.theme.name} style`, "draw group frames and titles", doc, desired, { skipped, notes, report: { frames: framesReport }, ...(o.force ? { force: true } : {}) });
}

const area = (p: Polygon) => Math.abs(ringArea(p.outer));
function ringArea(r: Ring): number {
  let s = 0;
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return s / 2;
}
const pairs = (r: Ring): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  return out;
};
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Which edges of a ring run along the board edge (no frame line there). */
function openEdges(r: Ring, space: BoardSpace, inset: number): boolean[] {
  const pts = pairs(r);
  const tol = 30_000;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const probe = (t: number) => {
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const s = segShape(x, y, x, y, 0);
      let d = Infinity;
      for (const e of space.model.edges) d = Math.min(d, shapeGap(s, e.shape, inset + tol * 2));
      return Math.abs(d - inset) <= tol;
    };
    return probe(0.25) && probe(0.5) && probe(0.75);
  });
}

/**
 * The frame's drawn runs: the ring with its corners treated, split where edges are open. Corners: chamfer45 cuts
 * convex corners at 45 degrees (on square corners) as deep as allowed in [min, max] without crossing a member's
 * courtyard; round replaces them by an arc of that radius (as short segments); bracket keeps only arms at convex
 * corners; rect keeps them square.
 */
function cornered(r: Ring, open: boolean[], style: string, cMin: number, cMax: number, line: number, members: Shape[]): Pt[][] {
  const pts = pairs(r);
  const n = pts.length;
  const corner: Pt[][] = pts.map((p) => [p]);
  const clearOfMembers = (a: Pt, b: Pt) => members.every((m) => shapeGap(strokeShape(a[0], a[1], b[0], b[1], line), m, 0) > 0);
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]);
    const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
    if (cross <= 0 || open[(i + n - 1) % n] || open[i]) continue; // concave, or at an open edge
    if (style === "rect" || style === "bracket") continue;
    const u1: Pt = [(v[0] - p[0]) / l1, (v[1] - p[1]) / l1];
    const u2: Pt = [(q[0] - v[0]) / l2, (q[1] - v[1]) / l2];
    let d = Math.min(cMax, 0.4 * l1, 0.4 * l2);
    let chosen: Pt[] | undefined;
    while (d >= cMin - 1) {
      const a: Pt = [Math.round(v[0] - u1[0] * d), Math.round(v[1] - u1[1] * d)];
      const b: Pt = [Math.round(v[0] + u2[0] * d), Math.round(v[1] + u2[1] * d)];
      let path: Pt[];
      if (style === "round") {
        // tangent points at distance d from the corner: the arc's radius follows from the turn angle
        const turn = Math.atan2(cross, (v[0] - p[0]) * (q[0] - v[0]) + (v[1] - p[1]) * (q[1] - v[1]));
        const rad = d / Math.tan(turn / 2);
        const cx = a[0] - u1[1] * rad;
        const cy = a[1] + u1[0] * rad;
        const a0 = Math.atan2(a[1] - cy, a[0] - cx);
        const steps = Math.max(3, Math.ceil(turn / (Math.PI / 16)));
        path = [];
        for (let k = 0; k <= steps; k++) {
          const ang = a0 + (turn * k) / steps;
          path.push([Math.round(cx + rad * Math.cos(ang)), Math.round(cy + rad * Math.sin(ang))]);
        }
      } else path = [a, b];
      const ok = path.slice(1).every((pt, k) => clearOfMembers(path[k], pt));
      if (ok) {
        chosen = path;
        break;
      }
      d -= 50_000;
    }
    if (chosen) corner[i] = chosen;
  }
  if (style === "bracket") {
    const arm = cMax * 2;
    const runs: Pt[][] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[(i + n - 1) % n];
      const v = pts[i];
      const q = pts[(i + 1) % n];
      const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
      if (cross <= 0) continue;
      const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]);
      const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
      const a1 = Math.min(arm, 0.3 * l1);
      const a2 = Math.min(arm, 0.3 * l2);
      const run: Pt[] = [];
      if (!open[(i + n - 1) % n]) run.push([Math.round(v[0] - ((v[0] - p[0]) / l1) * a1), Math.round(v[1] - ((v[1] - p[1]) / l1) * a1)]);
      run.push(v);
      if (!open[i]) run.push([Math.round(v[0] + ((q[0] - v[0]) / l2) * a2), Math.round(v[1] + ((q[1] - v[1]) / l2) * a2)]);
      if (run.length >= 2) runs.push(run);
    }
    return runs;
  }
  // walk the ring; an open edge ends a run
  const firstOpen = open.findIndex(Boolean);
  if (firstOpen < 0) {
    const loop = corner.flat();
    return [[...loop, loop[0]]];
  }
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (firstOpen + k) % n;
    cur.push(...corner[i]);
    if (open[i]) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** Remove the parts of a polyline inside a box (grown by `margin`). */
function cutByBox(run: Pt[], b: { minX: number; minY: number; maxX: number; maxY: number }, margin: number): Pt[][] {
  const bx = { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const inside = (p: Pt) => p[0] > bx.minX && p[0] < bx.maxX && p[1] > bx.minY && p[1] < bx.maxY;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1];
    const c = run[i];
    // Liang-Barsky: the part of a-c inside the box
    let t0 = 0;
    let t1 = 1;
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const clipT = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    const hit = clipT(-dx, a[0] - bx.minX) && clipT(dx, bx.maxX - a[0]) && clipT(-dy, a[1] - bx.minY) && clipT(dy, bx.maxY - a[1]) && t1 > t0;
    if (!hit) {
      if (!cur.length) cur.push(a);
      cur.push(c);
      continue;
    }
    const p0: Pt = [Math.round(a[0] + dx * t0), Math.round(a[1] + dy * t0)];
    const p1: Pt = [Math.round(a[0] + dx * t1), Math.round(a[1] + dy * t1)];
    if (t0 > 0) {
      if (!cur.length) cur.push(a);
      cur.push(p0);
    }
    if (cur.length >= 2) out.push(cur);
    cur = [];
    if (t1 < 1 && !inside(c)) cur.push(p1, c);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/**
 * Where the title goes: a knockout tag centered on a top-facing drawn edge (then bottom-facing, then side edges),
 * sliding from the left; falling back to plain text just outside a top or bottom edge.
 */
function placeTitle(outer: Ring, open: boolean[], title: string, side: Side, mode: string, height: number, stroke: number, line: number, space: BoardSpace, clr: { pad: number; edge: number; silk?: number }, members: Set<string>): { as: "tag"; ring: Ring; contours: Ring[] } | { as: "plain"; x: number; y: number; shape: Shape } | undefined {
  const pts = pairs(outer);
  const n = pts.length;
  type Edge = { a: Pt; b: Pt; dir: "top" | "bottom" | "left" | "right" };
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    if (open[i]) continue;
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a[1] === b[1]) edges.push({ a, b, dir: b[0] < a[0] ? "top" : "bottom" }); // counterclockwise: top edges run right to left
    else if (a[0] === b[0]) edges.push({ a, b, dir: b[1] > a[1] ? "right" : "left" });
  }
  const order = { top: 0, bottom: 1, left: 2, right: 3 };
  edges.sort((e, f) => order[e.dir] - order[f.dir] || Math.max(f.a[1], f.b[1]) - Math.max(e.a[1], e.b[1]));
  const mirrored = side === "bottom";
  const ignore = { footprints: members };
  const flat = edges.filter((x) => x.dir === "top" || x.dir === "bottom");
  // left ends of the title along an edge: from just past the corner, overhanging the far end by up to the title's width
  const lefts = (e: Edge, w: number): number[] => {
    const lo = Math.min(e.a[0], e.b[0]) + mm(0.9);
    const hi = Math.max(lo, Math.max(e.a[0], e.b[0]) - mm(0.9) - w * 0.5);
    const out: number[] = [];
    for (let x = lo; x <= hi; x += mm(0.25)) out.push(x);
    return mirrored ? out.map((x) => lo + hi - x) : out;
  };
  if (mode === "tag") {
    const probe = knockoutTag(title, { x: 0, y: 0, height, stroke, pad: TAG_PAD });
    // a tab standing on the frame line first, then centered on it
    for (const where of ["tab", "center"] as const)
      for (const e of flat)
        for (const left of lefts(e, probe.w)) {
          const cx = Math.round(left + probe.w / 2);
          const out = e.dir === "top" ? 1 : -1;
          const cy = where === "tab" ? Math.round(e.a[1] + out * (probe.h / 2 - line / 2)) : e.a[1];
          const s = textShape(cx, cy, probe.w, probe.h);
          if (space.blocker(s, side, { pad: clr.pad, edge: clr.edge }, ignore)) continue;
          if (otherSilk(space, s, side, members)) continue;
          const t = knockoutTag(title, { x: cx, y: cy, height, stroke, pad: TAG_PAD, ...(mirrored ? { mirrored: true } : {}) });
          return { as: "tag", ring: t.ring, contours: t.contours };
        }
  }
  const box = textBox(title, height, stroke);
  for (const e of flat) {
    const y = e.dir === "top" ? e.a[1] + line / 2 + mm(0.25) + box.h / 2 : e.a[1] - line / 2 - mm(0.25) - box.h / 2;
    for (const x of lefts(e, box.w)) {
      const s = textShape(Math.round(x + box.w / 2), Math.round(y), box.w, box.h);
      if (space.blocker(s, side, { ...clr, courtyard: 50_000 }, ignore)) continue;
      return { as: "plain", x: mirrored ? Math.round(x + box.w) : Math.round(x), y: Math.round(y), shape: s };
    }
  }
  return undefined;
}

/** Silk a tag may not cover: anything on the side except the group's own parts' silk. */
function otherSilk(space: BoardSpace, s: Shape, side: Side, members: Set<string>): boolean {
  return space.near(s.box, side, ["silk"]).some((o) => !(o.footprint && members.has(o.footprint)) && shapeGap(s, o.shape, 0) === 0);
}

export const _test = { cornered, cutByBox, openEdges };

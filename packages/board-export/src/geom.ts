/**
 * Geometry shared by the writers: contours with arc edges, polygon areas, fracturing a polygon with holes into one
 * contour with cut-ins (so a Gerber region is drawn once, dark only), and silkscreen text as strokes.
 */
import { arcCenter, arcPoints, footprintToWorld, rotatePoint, type FootprintRec, type Vertex } from "@protoboardai/board";
import { textPath } from "@protoboardai/board-scene";

export interface Pt {
  x: number;
  y: number;
}

/** A path element: a point, and optionally the arc (signed sweep, millidegrees) from the previous point to it. */
export interface PathPt extends Pt {
  /** Sweep of the arc that ends here (from the previous point); absent: a straight segment. */
  sweep?: number;
}

/** A contour's vertices as a closed path of `PathPt` (the arc of vertex i goes to vertex i + 1), ending on its start. */
export function contourPath(vs: readonly Vertex[]): PathPt[] {
  const out: PathPt[] = [{ x: vs[0].x, y: vs[0].y }];
  for (let i = 0; i < vs.length; i++) {
    const next = vs[(i + 1) % vs.length];
    const sweep = vs[i].sweep;
    out.push(sweep !== undefined ? { x: next.x, y: next.y, sweep } : { x: next.x, y: next.y });
  }
  return out;
}

/** An open path of vertices (`sweep` on a vertex is the arc to the next one). */
export function openPath(vs: readonly Vertex[]): PathPt[] {
  const out: PathPt[] = [{ x: vs[0].x, y: vs[0].y }];
  for (let i = 1; i < vs.length; i++) {
    const s = vs[i - 1].sweep;
    out.push(s !== undefined ? { x: vs[i].x, y: vs[i].y, sweep: s } : { x: vs[i].x, y: vs[i].y });
  }
  return out;
}

/** The arc's center rounded to whole nanometers (Gerber and DXF need it explicitly). */
export function arcCenterNm(a: Pt, b: Pt, sweep: number): Pt {
  const c = arcCenter(a, b, sweep);
  return { x: Math.round(c.x), y: Math.round(c.y) };
}

/** A path flattened to points (arcs within `maxSagitta` nm). */
export function flattenPath(path: readonly PathPt[], maxSagitta = 1000): Pt[] {
  const out: Pt[] = [{ x: path[0].x, y: path[0].y }];
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    if (p.sweep !== undefined) {
      const pts = arcPoints(path[i - 1], p, p.sweep, maxSagitta);
      for (let k = 1; k < pts.length; k++) out.push({ x: Math.round(pts[k].x), y: Math.round(pts[k].y) });
    } else out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** A contour flattened to a ring of points (not repeating the first). */
export function flattenContour(vs: readonly Vertex[], maxSagitta = 1000): Pt[] {
  const pts = flattenPath(contourPath(vs), maxSagitta);
  pts.pop();
  return pts;
}

/** Signed area of a ring (counterclockwise positive), square nanometers. */
export function ringArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  return a / 2;
}

/** Flat `x0, y0, x1, y1, ...` to points. */
export function ringOf(flat: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointInTriangle(a: Pt, b: Pt, c: Pt, p: Pt): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const orient = (r: Pt[], ccw: boolean): Pt[] => ((ringArea(r) > 0) === ccw ? r : [...r].reverse());

/**
 * One contour for a polygon with holes: each hole is joined to the outline (or to an earlier joined hole) by a cut-in,
 * a pair of coincident segments, as the Gerber specification allows for regions with holes. The outline is made
 * counterclockwise and the holes clockwise. Bridges run from a hole's rightmost vertex to the right, to the nearest
 * outline edge it sees, then to a vertex of that edge visible from it (the usual hole-elimination method of polygon
 * triangulation). Holes are taken rightmost first.
 */
export function fracture(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt[] {
  let ring = orient([...outer], true);
  const hs = holes.filter((h) => h.length >= 3).map((h) => orient([...h], false));
  // rightmost vertex of each hole, holes sorted by it, descending
  const items = hs.map((h) => {
    let k = 0;
    for (let i = 1; i < h.length; i++) if (h[i].x > h[k].x || (h[i].x === h[k].x && h[i].y < h[k].y)) k = i;
    return { h, k };
  });
  items.sort((a, b) => b.h[b.k].x - a.h[a.k].x || a.h[a.k].y - b.h[b.k].y);
  for (const { h, k } of items) {
    const m = h[k];
    const j = bridgeVertex(ring, m);
    if (j < 0) continue; // a hole the outline does not enclose: dropped (the caller compares areas and reports it)
    const p = ring[j];
    const hole = [...h.slice(k), ...h.slice(0, k), m];
    ring = [...ring.slice(0, j + 1), ...hole, p, ...ring.slice(j + 1)];
  }
  return ring;
}

/** The index of a vertex of `ring` that can be joined to `m` (lying inside the ring) by a segment crossing nothing. */
function bridgeVertex(ring: Pt[], m: Pt): number {
  let best = Infinity;
  let edge = -1;
  let ix = 0;
  const n = ring.length;
  // the nearest edge crossing the ray from m towards +x
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (a.y === b.y || Math.min(a.y, b.y) > m.y || Math.max(a.y, b.y) < m.y) continue;
    const x = a.x + ((m.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x >= m.x && x - m.x < best) {
      best = x - m.x;
      edge = i;
      ix = x;
    }
  }
  if (edge < 0) return -1;
  const a = ring[edge];
  const b = ring[(edge + 1) % n];
  if (ix === m.x) return a.y === m.y ? edge : (edge + 1) % n;
  let cand = a.x > b.x ? edge : (edge + 1) % n;
  if (ring[cand].x === ix && ring[cand].y === m.y) return cand;
  // any reflex vertex inside the triangle (m, hit, candidate) blocks the view: take the one with the smallest angle
  const hit = { x: ix, y: m.y };
  const c = ring[cand];
  let bestTan = Infinity;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    if (i === cand || p.x < m.x) continue;
    if (p.x === c.x && p.y === c.y) continue;
    if (!pointInTriangle(m, hit, c, p)) continue;
    const tan = Math.abs(p.y - m.y) / Math.max(1e-9, p.x - m.x);
    if (tan < bestTan || (tan === bestTan && p.x < ring[cand].x)) {
      bestTan = tan;
      cand = i;
    }
  }
  return cand;
}

// ------------------------------------------------------------------- text as strokes

export interface TextSpec {
  text: string;
  /** Anchor point, board frame (nm). */
  x: number;
  y: number;
  /** Cap height (nm). */
  height: number;
  /** Counterclockwise, millidegrees, seen from the top. */
  rotation?: number;
  anchor?: "center" | "left" | "right";
  /** Read mirrored from the top (bottom-side text). */
  mirrored?: boolean;
}

/** Glyph strokes of a text in its own frame (y up, anchor at the origin), from the stack's single-stroke font. */
function glyphStrokes(text: string, height: number, anchor: "center" | "left" | "right"): Pt[][] {
  // the font's path data is in screen coordinates (y down) with two decimals; in nanometers that is exact enough
  const d = textPath(text, 0, 0, height, anchor, 0);
  const strokes: Pt[][] = [];
  for (const m of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
    const p = { x: Math.round(Number(m[2])), y: -Math.round(Number(m[3])) };
    if (m[1] === "M") strokes.push([p]);
    else strokes[strokes.length - 1].push(p);
  }
  return strokes.filter((s) => s.length >= 2);
}

/** A board-level text as world strokes. */
export function textStrokes(t: TextSpec): Pt[][] {
  return glyphStrokes(t.text, t.height, t.anchor ?? "center").map((s) =>
    s.map((g) => {
      const m = t.mirrored ? { x: -g.x, y: g.y } : g;
      const r = rotatePoint(m, t.rotation ?? 0);
      return { x: Math.round(t.x + r.x), y: Math.round(t.y + r.y) };
    }),
  );
}

/** A footprint text (footprint frame) as world strokes: rotated in the frame, then through the footprint transform. */
export function footprintTextStrokes(fp: Pick<FootprintRec, "x" | "y" | "rotation" | "side">, t: { text: string; x: number; y: number; height: number; rotation?: number; anchor?: "center" | "left" | "right" }): Pt[][] {
  return glyphStrokes(t.text, t.height, t.anchor ?? "center").map((s) =>
    s.map((g) => {
      const r = rotatePoint(g, t.rotation ?? 0);
      const w = footprintToWorld(fp, { x: t.x + r.x, y: t.y + r.y });
      return { x: Math.round(w.x), y: Math.round(w.y) };
    }),
  );
}

/** Box of a set of points. */
export function boxOf(pts: Iterable<Pt>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Board shapes as a core grown by a radius (a Minkowski sum with a disc): a pad, a track, a via, a fill polygon
 * or a silkscreen stroke is `{ core, r }` where the core is a point, a segment, an arc or a filled polygon with
 * holes. The distance between two grown shapes is the distance between their cores less both radii, which is
 * exact for every pair:
 *
 * | Board object | Core | Radius |
 * |---|---|---|
 * | circle pad, via, round hole | point | radius |
 * | track segment, oval pad, slot | segment | half width |
 * | arc track | arc | half width |
 * | rectangle pad (any rotation) | polygon (4 corners) | 0 |
 * | rounded rectangle pad | the rectangle shrunk by the corner radius | corner radius |
 * | polygon pad, zone fill, courtyard | polygon with holes | 0 |
 *
 * Polygon rings are straight-edged. Arcs inside a contour (a polygon pad's or a fill's `sweep`) are flattened
 * with at most `FLATTEN_TOL` deviation before they become a ring; arc tracks, arc edges of the board outline and
 * round shapes are never flattened.
 */
import type { Box } from "@protoboardai/board";
import { arcCenter, type Vertex } from "@protoboardai/board";
import { closest, makeArc, primBox, primDist, type ArcPrim, type Closest, type Prim, type PtPrim, type SegPrim } from "./prims.js";

/** Largest deviation, in nanometers, of a flattened contour arc from the true arc. */
export const FLATTEN_TOL = 500;

export interface PolyCore {
  t: "poly";
  /** Ring 0 is the outer boundary, the rest are holes; each is flat x, y pairs, implicitly closed. */
  rings: Float64Array[];
  box: Box;
  /** Built on first use: the edges, and for large polygons a grid of edges and y bands for containment. */
  edges?: SegPrim[];
  edgeBoxes?: Box[];
  grid?: EdgeGrid;
}
export type Core = PtPrim | SegPrim | ArcPrim | PolyCore;

export interface Shape {
  core: Core;
  r: number;
  /** The grown shape's box. */
  box: Box;
}

// ---------------------------------------------------------------- construction

export function boxOfCore(c: Core): Box {
  if (c.t === "poly") return c.box;
  return primBox(c);
}
const grow = (b: Box, r: number): Box => ({ minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r });

export function shape(core: Core, r = 0): Shape {
  return { core, r, box: grow(boxOfCore(core), r) };
}
export const pointShape = (x: number, y: number, r: number): Shape => shape({ t: "pt", x, y }, r);
export const segShape = (ax: number, ay: number, bx: number, by: number, r: number): Shape =>
  ax === bx && ay === by ? pointShape(ax, ay, r) : shape({ t: "seg", ax, ay, bx, by }, r);

/** An arc stroke from its stored endpoints and signed sweep (millidegrees). */
export function arcShape(start: { x: number; y: number }, end: { x: number; y: number }, sweepMdeg: number, r: number): Shape {
  const c = arcCenter(start as never, end as never, sweepMdeg);
  if (!(c.r > 0) || !Number.isFinite(c.r)) return segShape(start.x, start.y, end.x, end.y, r);
  return shape(makeArc(c.x, c.y, c.r, start.x, start.y, end.x, end.y, (sweepMdeg / 1000) * (Math.PI / 180)), r);
}

/** A full circle outline (a stroked circle). */
export function circleOutline(cx: number, cy: number, radius: number, r: number): Shape {
  return shape(makeArc(cx, cy, radius, cx + radius, cy, cx + radius, cy, Math.PI * 2), r);
}

export function polyCore(rings: readonly (readonly number[] | Float64Array)[]): PolyCore {
  const rs = rings.filter((r) => r.length >= 6).map((r) => (r instanceof Float64Array ? r : Float64Array.from(r)));
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rs)
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < box.minX) box.minX = r[i];
      if (r[i] > box.maxX) box.maxX = r[i];
      if (r[i + 1] < box.minY) box.minY = r[i + 1];
      if (r[i + 1] > box.maxY) box.maxY = r[i + 1];
    }
  return { t: "poly", rings: rs, box };
}

/** Cosine and sine of an angle in radians, exact at multiples of a quarter turn (no 6e-17 noise on rotated pads). */
export function cosSinRad(rot: number): [number, number] {
  const q = rot / (Math.PI / 2);
  const k = Math.round(q);
  if (Math.abs(q - k) < 1e-12) {
    const m = ((k % 4) + 4) % 4;
    return m === 0 ? [1, 0] : m === 1 ? [0, 1] : m === 2 ? [-1, 0] : [0, -1];
  }
  return [Math.cos(rot), Math.sin(rot)];
}

/** A rectangle of `w` by `h` centered on (cx, cy), rotated by `rot` radians, grown by `r` (a rounded rectangle). */
export function rectShape(cx: number, cy: number, w: number, h: number, rot: number, r = 0): Shape {
  const [c, s] = cosSinRad(rot);
  const hw = w / 2;
  const hh = h / 2;
  if (hw <= 0 && hh <= 0) return pointShape(cx, cy, r);
  if (hw <= 0 || hh <= 0) {
    // a degenerate rectangle is a segment
    const lx = hw > 0 ? hw : 0;
    const ly = hh > 0 ? hh : 0;
    return segShape(cx - lx * c + ly * s, cy - lx * s - ly * c, cx + lx * c - ly * s, cy + lx * s + ly * c, r);
  }
  const pts: number[] = [];
  for (const [x, y] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ])
    pts.push(cx + x * c - y * s, cy + x * s + y * c);
  return shape(polyCore([pts]), r);
}

/** A stadium: an oval of `w` by `h` (the shorter side is the diameter) centered on (cx, cy), rotated by `rot`. */
export function ovalShape(cx: number, cy: number, w: number, h: number, rot: number): Shape {
  const [c, s] = cosSinRad(rot);
  if (w >= h) {
    const l = (w - h) / 2;
    return segShape(cx - l * c, cy - l * s, cx + l * c, cy + l * s, h / 2);
  }
  const l = (h - w) / 2;
  return segShape(cx + l * s, cy - l * c, cx - l * s, cy + l * c, w / 2);
}

/**
 * A contour's points with arc edges flattened (deviation at most `tol`), as a flat x, y array, after `map` (the
 * footprint transform, say). Arcs are flattened in the contour's own frame, so a rigid map keeps the bound.
 */
export function flattenContour(vertices: readonly Vertex[], map?: (x: number, y: number) => [number, number], closed = true, tol = FLATTEN_TOL): number[] {
  const out: number[] = [];
  const push = (x: number, y: number) => {
    if (map) [x, y] = map(x, y);
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) return;
    out.push(x, y);
  };
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    push(v.x, v.y);
    const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    if (v.sweep === undefined || !next) continue;
    const c = arcCenter(v as never, next as never, v.sweep);
    if (!(c.r > 0)) continue;
    const sw = (v.sweep / 1000) * (Math.PI / 180);
    // the step whose sagitta r(1 - cos(step/2)) is the tolerance
    const step = c.r > tol ? 2 * Math.acos(1 - tol / c.r) : Math.PI / 2;
    const n = Math.max(1, Math.ceil(Math.abs(sw) / step));
    const a0 = Math.atan2(v.y - c.y, v.x - c.x);
    for (let k = 1; k < n; k++) {
      const a = a0 + (sw * k) / n;
      push(c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a));
    }
  }
  if (closed && out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

/** The curve primitives of a contour: its segments and true arcs (for the board outline's edges). */
export function contourPrims(vertices: readonly Vertex[], closed = true): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    if (!next) break;
    if (v.sweep !== undefined) {
      const c = arcCenter(v as never, next as never, v.sweep);
      if (c.r > 0) {
        out.push(makeArc(c.x, c.y, c.r, v.x, v.y, next.x, next.y, (v.sweep / 1000) * (Math.PI / 180)));
        continue;
      }
    }
    if (v.x !== next.x || v.y !== next.y) out.push({ t: "seg", ax: v.x, ay: v.y, bx: next.x, by: next.y });
  }
  return out;
}

/** Twice the signed area of a flat ring (positive counterclockwise). */
export function ringArea2(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a;
}

// ---------------------------------------------------------------- polygon edges, grid, containment

interface EdgeGrid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  cells: Int32Array[];
  /** Edges per y band (bands are grid rows) for the containment ray. */
  bands: Int32Array[];
  stamp: Int32Array;
  tick: number;
}

/** Polygons with more edges than this get an edge grid. */
const GRID_EDGES = 48;

function ensureEdges(p: PolyCore): void {
  if (p.edges) return;
  const edges: SegPrim[] = [];
  const boxes: Box[] = [];
  for (const r of p.rings) {
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const e: SegPrim = { t: "seg", ax: r[i], ay: r[i + 1], bx: r[j], by: r[j + 1] };
      if (e.ax === e.bx && e.ay === e.by) continue;
      edges.push(e);
      boxes.push({ minX: Math.min(e.ax, e.bx), minY: Math.min(e.ay, e.by), maxX: Math.max(e.ax, e.bx), maxY: Math.max(e.ay, e.by) });
    }
  }
  p.edges = edges;
  p.edgeBoxes = boxes;
  if (edges.length > GRID_EDGES) p.grid = buildGrid(p.box, boxes);
}

function buildGrid(box: Box, boxes: Box[]): EdgeGrid {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const target = Math.max(1, Math.sqrt(boxes.length));
  const cell = Math.max(w, h) / target;
  const nx = Math.max(1, Math.ceil(w / cell));
  const ny = Math.max(1, Math.ceil(h / cell));
  const lists: number[][] = Array.from({ length: nx * ny }, () => []);
  const bandLists: number[][] = Array.from({ length: ny }, () => []);
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - box.minX) / cell)));
  const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - box.minY) / cell)));
  boxes.forEach((b, i) => {
    const x0 = cx(b.minX),
      x1 = cx(b.maxX),
      y0 = cy(b.minY),
      y1 = cy(b.maxY);
    for (let y = y0; y <= y1; y++) {
      bandLists[y].push(i);
      for (let x = x0; x <= x1; x++) lists[y * nx + x].push(i);
    }
  });
  return { x0: box.minX, y0: box.minY, cell, nx, ny, cells: lists.map((l) => Int32Array.from(l)), bands: bandLists.map((l) => Int32Array.from(l)), stamp: new Int32Array(boxes.length), tick: 0 };
}

/** Call `fn` with the index of each edge whose box meets `q` (each edge once). */
function edgesNear(p: PolyCore, q: Box, fn: (i: number) => void): void {
  ensureEdges(p);
  const boxes = p.edgeBoxes!;
  const g = p.grid;
  if (!g) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.minX <= q.maxX && q.minX <= b.maxX && b.minY <= q.maxY && q.minY <= b.maxY) fn(i);
    }
    return;
  }
  if (q.maxX < p.box.minX || q.minX > p.box.maxX || q.maxY < p.box.minY || q.minY > p.box.maxY) return;
  const x0 = Math.max(0, Math.floor((q.minX - g.x0) / g.cell)),
    x1 = Math.min(g.nx - 1, Math.floor((q.maxX - g.x0) / g.cell)),
    y0 = Math.max(0, Math.floor((q.minY - g.y0) / g.cell)),
    y1 = Math.min(g.ny - 1, Math.floor((q.maxY - g.y0) / g.cell));
  const t = ++g.tick;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (const i of g.cells[y * g.nx + x]) {
        if (g.stamp[i] === t) continue;
        g.stamp[i] = t;
        const b = boxes[i];
        if (b.minX <= q.maxX && q.minX <= b.maxX && b.minY <= q.maxY && q.minY <= b.maxY) fn(i);
      }
}

/** Even-odd containment of a point in a polygon with holes (a point on an edge may go either way). */
export function pointInPoly(p: PolyCore, x: number, y: number): boolean {
  if (x < p.box.minX || x > p.box.maxX || y < p.box.minY || y > p.box.maxY) return false;
  ensureEdges(p);
  const edges = p.edges!;
  let inside = false;
  const test = (e: SegPrim) => {
    if (e.ay > y !== e.by > y) {
      const xi = e.ax + ((y - e.ay) * (e.bx - e.ax)) / (e.by - e.ay);
      if (xi > x) inside = !inside;
    }
  };
  const g = p.grid;
  if (g) {
    const band = Math.min(g.ny - 1, Math.max(0, Math.floor((y - g.y0) / g.cell)));
    for (const i of g.bands[band]) test(edges[i]);
  } else for (const e of edges) test(e);
  return inside;
}

/** A point on the core (its start), for containment tests. */
function repPoint(c: Core): [number, number] {
  switch (c.t) {
    case "pt":
      return [c.x, c.y];
    case "seg":
      return [c.ax, c.ay];
    case "arc":
      return [c.sx, c.sy];
    case "poly":
      return [c.rings[0][0], c.rings[0][1]];
  }
}

// ---------------------------------------------------------------- distance

export interface Gap {
  /** The gap between the grown shapes: 0 when they touch or overlap. */
  gap: number;
  /** A point between the shapes where the gap is measured (on both when they touch). */
  x: number;
  y: number;
}

const boxGap = (a: Box, b: Box): number => {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
};

const scratch = closest();
const bestPair = closest();

/** The primitives of a core near a box (all of a point, segment or arc; the nearby edges of a polygon). */
function forPrims(c: Core, q: Box, fn: (p: Prim, b: Box) => void): void {
  if (c.t !== "poly") {
    fn(c, boxOfCore(c));
    return;
  }
  ensureEdges(c);
  edgesNear(c, q, (i) => fn(c.edges![i], c.edgeBoxes![i]));
}

/**
 * The gap between two shapes, exact when it is at most `limit` (nanometers). A larger gap returns some value
 * above `limit` (possibly Infinity) without the work of measuring it. Containment counts as touching.
 */
export function shapeGap(A: Shape, B: Shape, limit = Infinity, out?: Gap): number {
  const res = out ?? ({ gap: 0, x: 0, y: 0 } as Gap);
  const lim = limit + A.r + B.r;
  const ca = A.core;
  const cb = B.core;
  const ba = boxOfCore(ca);
  const bb = boxOfCore(cb);
  if (boxGap(ba, bb) > lim) {
    res.gap = Infinity;
    return Infinity;
  }
  if (ca.t === "poly") {
    const [x, y] = repPoint(cb);
    if (pointInPoly(ca, x, y)) return touch(res, x, y);
  }
  if (cb.t === "poly") {
    const [x, y] = repPoint(ca);
    if (pointInPoly(cb, x, y)) return touch(res, x, y);
  }
  let best = Infinity;
  const qa = grow(bb, Number.isFinite(lim) ? lim : 1e18);
  const qb = grow(ba, Number.isFinite(lim) ? lim : 1e18);
  const primsB: { p: Prim; b: Box }[] = [];
  forPrims(cb, qb, (p, b) => primsB.push({ p, b }));
  if (!primsB.length) {
    res.gap = Infinity;
    return Infinity;
  }
  forPrims(ca, qa, (pa, boxA) => {
    if (best === 0) return;
    for (const { p: pb, b: boxB } of primsB) {
      const bound = Math.min(best, lim);
      if (boxGap(boxA, boxB) > bound) continue;
      const d = primDist(pa, pb, scratch);
      if (d < best) {
        best = d;
        bestPair.ax = scratch.ax;
        bestPair.ay = scratch.ay;
        bestPair.bx = scratch.bx;
        bestPair.by = scratch.by;
        if (d === 0) return;
      }
    }
  });
  if (best > lim) {
    res.gap = Infinity;
    return Infinity;
  }
  const gap = Math.max(0, best - A.r - B.r);
  res.gap = gap;
  if (best > 0) {
    const ux = (bestPair.bx - bestPair.ax) / best;
    const uy = (bestPair.by - bestPair.ay) / best;
    const along = Math.min(best, A.r + gap / 2);
    res.x = bestPair.ax + ux * along;
    res.y = bestPair.ay + uy * along;
  } else {
    res.x = bestPair.ax;
    res.y = bestPair.ay;
  }
  return gap;
}

function touch(res: Gap, x: number, y: number): number {
  res.gap = 0;
  res.x = x;
  res.y = y;
  return 0;
}

/** The distance between two cores (no radii), for tests and callers that want the raw value. */
export function coreDistance(a: Core, b: Core): number {
  return shapeGap(shape(a, 0), shape(b, 0));
}

// ---------------------------------------------------------------- positive-area overlap of polygons

/**
 * Whether two polygons overlap with positive area (touching edges or corners do not count). Complete for
 * straight-edged polygons: every edge of each is cut at every point where it meets the other's boundary, and the
 * midpoint of each piece is tested for lying strictly inside the other (more than `eps` from its boundary). Two
 * regions that overlap always have such a piece unless their boundaries coincide, which the centroid test covers.
 * Returns a point inside the overlap, or undefined.
 */
export function polygonsOverlap(a: PolyCore, b: PolyCore, eps = 1): { x: number; y: number } | undefined {
  if (a.box.maxX <= b.box.minX || b.box.maxX <= a.box.minX || a.box.maxY <= b.box.minY || b.box.maxY <= a.box.minY) return undefined;
  ensureEdges(a);
  ensureEdges(b);
  const strictlyInside = (q: PolyCore, x: number, y: number) => pointInPoly(q, x, y) && shapeGap(pointShape(x, y, 0), shape(edgesOnly(q), 0), eps) > eps;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const e of p.edges!) {
      const dx = e.bx - e.ax;
      const dy = e.by - e.ay;
      const l2 = dx * dx + dy * dy;
      const ts = [0, 1];
      edgesNear(q, { minX: Math.min(e.ax, e.bx) - eps, minY: Math.min(e.ay, e.by) - eps, maxX: Math.max(e.ax, e.bx) + eps, maxY: Math.max(e.ay, e.by) + eps }, (i) => {
        const f = q.edges![i];
        const fx = f.bx - f.ax;
        const fy = f.by - f.ay;
        const den = dx * fy - dy * fx;
        const wx = f.ax - e.ax;
        const wy = f.ay - e.ay;
        if (Math.abs(den) > 1e-9 * Math.sqrt(l2 * (fx * fx + fy * fy))) {
          const t = (wx * fy - wy * fx) / den;
          const u = (wx * dy - wy * dx) / den;
          if (t > 0 && t < 1 && u >= -1e-12 && u <= 1 + 1e-12) ts.push(t);
        }
        // the other edge's ends where they lie on this edge (collinear overlaps and T contacts)
        for (const [px, py] of [
          [f.ax, f.ay],
          [f.bx, f.by],
        ]) {
          const t = ((px - e.ax) * dx + (py - e.ay) * dy) / l2;
          if (t <= 0 || t >= 1) continue;
          const cx = e.ax + t * dx - px;
          const cy = e.ay + t * dy - py;
          if (cx * cx + cy * cy <= eps * eps) ts.push(t);
        }
      });
      ts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-12) continue;
        const t = (ts[k] + ts[k + 1]) / 2;
        const x = e.ax + t * dx;
        const y = e.ay + t * dy;
        if (strictlyInside(q, x, y)) return { x, y };
      }
    }
  }
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    const c = centroid(p.rings[0]);
    if (c && pointInPoly(p, c.x, c.y) && strictlyInside(q, c.x, c.y)) return c;
  }
  return undefined;
}

/** A polygon's boundary as a "polygon" with no interior: the same edges, used to measure distance to the boundary. */
const boundaryCache = new WeakMap<PolyCore, PolyCore>();
function edgesOnly(p: PolyCore): PolyCore {
  let b = boundaryCache.get(p);
  if (!b) {
    // a ring pair with opposite winding cancels the interior under even-odd: the containment test never fires
    b = { t: "poly", rings: [...p.rings, ...p.rings], box: p.box };
    boundaryCache.set(p, b);
  }
  return b;
}

function centroid(r: Float64Array): { x: number; y: number } | undefined {
  const a = ringArea2(r);
  if (a === 0) return undefined;
  let cx = 0,
    cy = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const f = r[i] * r[j + 1] - r[j] * r[i + 1];
    cx += (r[i] + r[j]) * f;
    cy += (r[i + 1] + r[j + 1]) * f;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Whether a point lies inside a shape (within its grown region). */
export function pointInShape(s: Shape, x: number, y: number): boolean {
  if (s.core.t === "poly" && pointInPoly(s.core, x, y)) return true;
  return shapeGap(pointShape(x, y, 0), s, 0) === 0;
}

export type { Closest };

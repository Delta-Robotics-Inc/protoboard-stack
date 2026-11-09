/**
 * Drawing geometry in millimeters (+Y up): the few primitive parts every board object is drawn from, their boxes,
 * exact hit tests, and their flattening into instanced rounded boxes for the GPU. The document is integer
 * nanometers; this is the one place that converts (`NM`).
 *
 * Parts:
 *   seg   round-capped segment (tracks, lines); width 0 is a one-pixel hairline
 *   path  round-joined polyline (arcs, outlines), optionally closed
 *   box   rotated rounded box (pads); `a` radians counterclockwise, `c` corner radius
 *   ring  disk (ri = 0) or annulus (vias, round pads, holes)
 *   poly  filled polygon, even-odd over its rings (polygon pads, zone fills, the board itself)
 *   text  stroke-font text (its strokes)
 */
import { arcCenter } from "./board.js";

export const NM = 1e-6;

export type Part =
  | { k: "seg"; x1: number; y1: number; x2: number; y2: number; w: number }
  | { k: "path"; pts: number[]; w: number; closed: boolean }
  | { k: "box"; cx: number; cy: number; hx: number; hy: number; a: number; c: number }
  | { k: "ring"; cx: number; cy: number; r: number; ri: number }
  | { k: "poly"; rings: number[][] }
  | { k: "text"; paths: number[][]; w: number };

/** [minX, minY, maxX, maxY] in millimeters. */
export type Rect = [number, number, number, number];

export const EMPTY_RECT = (): Rect => [Infinity, Infinity, -Infinity, -Infinity];
export function growRect(r: Rect, b: Rect): Rect {
  if (b[0] < r[0]) r[0] = b[0];
  if (b[1] < r[1]) r[1] = b[1];
  if (b[2] > r[2]) r[2] = b[2];
  if (b[3] > r[3]) r[3] = b[3];
  return r;
}
export const rectsMeet = (a: Rect, b: Rect): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export const rectInside = (inner: Rect, outer: Rect): boolean => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
export const rectEmpty = (r: Rect): boolean => !(r[0] <= r[2] && r[1] <= r[3]);

// ---------------------------------------------------------------- tessellation

/** Degrees of arc per piece when an arc is drawn as a polyline. */
export const ARC_STEP_DEG = 4;

/**
 * The points of an arc from `start` to `end` (nanometers) with a signed sweep (millidegrees), in millimeters, both
 * ends included, flat [x, y, ...].
 */
export function arcPoints(start: { x: number; y: number }, end: { x: number; y: number }, sweep: number, stepDeg = ARC_STEP_DEG): number[] {
  const c = arcCenter(start, end, sweep);
  if (c.r === 0) return [start.x * NM, start.y * NM, end.x * NM, end.y * NM];
  const t0 = Math.atan2(start.y - c.y, start.x - c.x);
  const sw = ((sweep / 1000) * Math.PI) / 180;
  const n = Math.max(2, Math.ceil(Math.abs(sweep / 1000) / stepDeg));
  const out = [start.x * NM, start.y * NM];
  for (let i = 1; i < n; i++) {
    const t = t0 + (sw * i) / n;
    out.push((c.x + c.r * Math.cos(t)) * NM, (c.y + c.r * Math.sin(t)) * NM);
  }
  out.push(end.x * NM, end.y * NM);
  return out;
}

/**
 * A contour or open path (vertices in nanometers, `sweep` the arc to the next vertex) as flat millimeter points.
 * A closed contour does not repeat its first point.
 */
export function contourPoints(vertices: readonly { x: number; y: number; sweep?: number }[], closed = true): number[] {
  const out: number[] = [];
  vertices.forEach((v, i) => {
    const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    if (v.sweep !== undefined && next) {
      const a = arcPoints(v, next, v.sweep);
      out.push(...a.slice(0, -2));
    } else out.push(v.x * NM, v.y * NM);
  });
  return out;
}

/** Map every point of a flat list. */
export function mapPoints(pts: number[], f: (x: number, y: number) => { x: number; y: number }): number[] {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    const p = f(pts[i], pts[i + 1]);
    out[i] = p.x;
    out[i + 1] = p.y;
  }
  return out;
}

// ---------------------------------------------------------------- boxes

function flatRect(lists: number[][], grow = 0): Rect {
  const r = EMPTY_RECT();
  for (const l of lists)
    for (let i = 0; i < l.length; i += 2) {
      if (l[i] < r[0]) r[0] = l[i];
      if (l[i] > r[2]) r[2] = l[i];
      if (l[i + 1] < r[1]) r[1] = l[i + 1];
      if (l[i + 1] > r[3]) r[3] = l[i + 1];
    }
  return [r[0] - grow, r[1] - grow, r[2] + grow, r[3] + grow];
}

export function partRect(p: Part): Rect {
  switch (p.k) {
    case "seg": {
      const h = p.w / 2;
      return [Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h];
    }
    case "box": {
      const c = Math.abs(Math.cos(p.a));
      const s = Math.abs(Math.sin(p.a));
      const ex = p.hx * c + p.hy * s;
      const ey = p.hx * s + p.hy * c;
      return [p.cx - ex, p.cy - ey, p.cx + ex, p.cy + ey];
    }
    case "ring":
      return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
    case "poly":
      return flatRect(p.rings);
    case "text":
      return flatRect(p.paths, p.w / 2);
    case "path":
      return flatRect([p.pts], p.w / 2);
  }
}

export function partsRect(parts: readonly Part[]): Rect {
  const r = EMPTY_RECT();
  for (const p of parts) growRect(r, partRect(p));
  return r;
}

// ---------------------------------------------------------------- hit tests

export function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** Even-odd point in polygon over flat rings. */
export function inRings(px: number, py: number, rings: readonly number[][]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i];
      const yi = r[i + 1];
      const xj = r[j];
      const yj = r[j + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Distance from a point to the edges of flat rings (closed). */
export function ringsEdgeDist(px: number, py: number, rings: readonly number[][]): number {
  let d = Infinity;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) d = Math.min(d, segDist(px, py, r[j], r[j + 1], r[i], r[i + 1]));
  return d;
}

function pathDist(px: number, py: number, q: readonly number[], closed: boolean): number {
  let d = Infinity;
  for (let i = 0; i + 3 < q.length; i += 2) d = Math.min(d, segDist(px, py, q[i], q[i + 1], q[i + 2], q[i + 3]));
  if (closed && q.length >= 4) d = Math.min(d, segDist(px, py, q[q.length - 2], q[q.length - 1], q[0], q[1]));
  return d;
}

/** Signed distance from a point to a part's shape (negative inside; strokes measured from their edge). */
export function partDistance(p: Part, x: number, y: number): number {
  switch (p.k) {
    case "seg":
      return segDist(x, y, p.x1, p.y1, p.x2, p.y2) - p.w / 2;
    case "path":
      return pathDist(x, y, p.pts, p.closed) - p.w / 2;
    case "box": {
      const c = Math.cos(-p.a);
      const s = Math.sin(-p.a);
      const lx = (x - p.cx) * c - (y - p.cy) * s;
      const ly = (x - p.cx) * s + (y - p.cy) * c;
      const cr = Math.min(p.c, p.hx, p.hy);
      const qx = Math.abs(lx) - p.hx + cr;
      const qy = Math.abs(ly) - p.hy + cr;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr;
    }
    case "ring": {
      const d = Math.hypot(x - p.cx, y - p.cy);
      return p.ri > 0 ? Math.max(d - p.r, p.ri - d) : d - p.r;
    }
    case "poly": {
      const e = ringsEdgeDist(x, y, p.rings);
      return inRings(x, y, p.rings) ? -e : e;
    }
    case "text": {
      let d = Infinity;
      for (const q of p.paths) d = Math.min(d, pathDist(x, y, q, false));
      return d - p.w / 2;
    }
  }
}

/** Whether a part covers (x, y), with a tolerance in millimeters. */
export const partHit = (p: Part, x: number, y: number, tol = 0): boolean => partDistance(p, x, y) <= tol;

// ---------------------------------------------------------------- hatching

/**
 * Hatch lines inside a polygon (even-odd over flat rings): parallel lines at `angle` radians, `spacing` apart,
 * clipped to the polygon. Returns segments as flat [x1, y1, x2, y2, ...].
 */
export function hatchLines(rings: readonly number[][], spacing: number, angle = Math.PI / 4): number[] {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  // rotate so the hatch lines are horizontal
  const rot = rings.map((r) => mapPoints(r as number[], (x, y) => ({ x: x * c - y * s, y: x * s + y * c })));
  const b = flatRect(rot);
  const out: number[] = [];
  const ci = Math.cos(angle);
  const si = Math.sin(angle);
  const back = (x: number, y: number) => [x * ci - y * si, x * si + y * ci];
  const start = Math.ceil(b[1] / spacing) * spacing;
  for (let ky = start; ky <= b[3]; ky += spacing) {
    const xs: number[] = [];
    for (const r of rot)
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const y1 = r[j + 1];
        const y2 = r[i + 1];
        if (y1 > ky !== y2 > ky) xs.push(r[j] + ((ky - y1) * (r[i] - r[j])) / (y2 - y1));
      }
    xs.sort((a, z) => a - z);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push(...back(xs[i], ky), ...back(xs[i + 1], ky));
  }
  return out;
}

// ---------------------------------------------------------------- instances

/** Floats per instance: A (cx, cy, hx, hy), B (angle, corner, ring inner, net), C (object, footprint, flags, min scale). */
export const INSTANCE_FLOATS = 12;
/** Floats per triangle vertex: x, y, net, footprint, object, flags. */
export const VERTEX_FLOATS = 6;

/** Per-instance style flags (bit values; the shaders test them). */
export const FLAG = {
  /** Copper a person drew and locked: a fine center line. */
  HAND: 1,
  /** Copper a router made (it may move): drawn flat and lighter. */
  AUTO: 2,
  /** Dashed stroke (ratsnest, unfilled zone outlines). */
  DASHED: 4,
  /** A filled area under strokes on the same layer (zone fills): a shade darker. */
  FILL: 8,
  /** A blind or buried via: a dark band inside the ring. */
  PARTIAL: 16,
} as const;

export interface InstanceMeta {
  net: number;
  fp: number;
  obj: number;
  flags: number;
  /** Shown only at or above this many pixels per millimeter (0: always). */
  minScale: number;
}

function pushBox(out: number[], cx: number, cy: number, hx: number, hy: number, a: number, c: number, ri: number, m: InstanceMeta): void {
  out.push(cx, cy, hx, hy, a, c, ri, m.net, m.obj, m.fp, m.flags, m.minScale);
}

function pushSeg(out: number[], x1: number, y1: number, x2: number, y2: number, w: number, m: InstanceMeta): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const h = w / 2;
  pushBox(out, (x1 + x2) / 2, (y1 + y2) / 2, len / 2 + h, h, Math.atan2(dy, dx), h, 0, m);
}

function pushPath(out: number[], q: readonly number[], w: number, closed: boolean, m: InstanceMeta): void {
  for (let i = 0; i + 3 < q.length; i += 2) pushSeg(out, q[i], q[i + 1], q[i + 2], q[i + 3], w, m);
  if (closed && q.length >= 6) pushSeg(out, q[q.length - 2], q[q.length - 1], q[0], q[1], w, m);
}

/**
 * Flatten a part into instanced rounded boxes (`boxes`, INSTANCE_FLOATS each) and triangles (`tris`, VERTEX_FLOATS
 * per vertex). Polygons are triangulated by `triangulate` (earcut: flat outer ring then holes) and get a hairline
 * edge so their edges are antialiased without multisampling.
 */
export function flattenPart(p: Part, m: InstanceMeta, boxes: number[], tris: number[], triangulate: (flat: number[], holes: number[]) => number[]): void {
  switch (p.k) {
    case "seg":
      pushSeg(boxes, p.x1, p.y1, p.x2, p.y2, p.w, m);
      return;
    case "path":
      pushPath(boxes, p.pts, p.w, p.closed, m);
      return;
    case "text":
      for (const q of p.paths) pushPath(boxes, q, p.w, false, m);
      return;
    case "box":
      pushBox(boxes, p.cx, p.cy, p.hx, p.hy, p.a, Math.min(p.c, p.hx, p.hy), 0, m);
      return;
    case "ring":
      pushBox(boxes, p.cx, p.cy, p.r, p.r, 0, p.r, p.ri, m);
      return;
    case "poly": {
      if (!p.rings.length || p.rings[0].length < 6) return;
      const flat: number[] = [];
      const holes: number[] = [];
      p.rings.forEach((r, i) => {
        if (i > 0) holes.push(flat.length / 2);
        for (const v of r) flat.push(v);
      });
      const idx = triangulate(flat, holes);
      for (const k of idx) tris.push(flat[2 * k], flat[2 * k + 1], m.net, m.fp, m.obj, m.flags);
      for (const r of p.rings) pushPath(boxes, r, 0, true, { ...m, flags: m.flags & ~FLAG.FILL });
      return;
    }
  }
}

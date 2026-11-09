/**
 * Small geometry and ordering helpers. Everything in this package works in millimeters (floats) after the board
 * model converts the core's integer nanometers once; output numbers are rounded to micrometers.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A box in millimeters, world coordinates (+Y up). */
export interface BoxMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Round to micrometers (3 decimals), never -0. */
export function r3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}
/** Round to 10 micrometers (2 decimals), never -0. */
export function r2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}
/** A box as `[minX, minY, maxX, maxY]`, rounded to micrometers. */
export const boxArr = (b: BoxMm): [number, number, number, number] => [r3(b.minX), r3(b.minY), r3(b.maxX), r3(b.maxY)];
export const ptArr = (p: Pt): [number, number] => [r3(p.x), r3(p.y)];

/** Code-unit order (deterministic across locales). */
export const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Natural order for reference designators and pad numbers: U2 before U10, then code-unit order. */
export function natCmp(a: string, b: string): number {
  const ra = a.match(/(\d+|\D+)/g) ?? [];
  const rb = b.match(/(\d+|\D+)/g) ?? [];
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const x = ra[i];
    const y = rb[i];
    if (x === y) continue;
    const dx = /^\d/.test(x);
    const dy = /^\d/.test(y);
    if (dx && dy) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      return x.length - y.length;
    }
    return byStr(x, y);
  }
  return ra.length - rb.length || byStr(a, b);
}

// ---------------------------------------------------------------- boxes

export const emptyBoxMm = (): BoxMm => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const isEmpty = (b: BoxMm): boolean => !(b.minX <= b.maxX && b.minY <= b.maxY);
export function grow(b: BoxMm, x: number, y: number, r = 0): BoxMm {
  if (x - r < b.minX) b.minX = x - r;
  if (y - r < b.minY) b.minY = y - r;
  if (x + r > b.maxX) b.maxX = x + r;
  if (y + r > b.maxY) b.maxY = y + r;
  return b;
}
export const boxOfPoints = (pts: readonly Pt[], r = 0): BoxMm => {
  const b = emptyBoxMm();
  for (const p of pts) grow(b, p.x, p.y, r);
  return b;
};
export const unite = (a: BoxMm, b: BoxMm): BoxMm => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
export const inflateBox = (b: BoxMm, d: number): BoxMm => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
export const overlaps = (a: BoxMm, b: BoxMm): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
export const intersectBox = (a: BoxMm, b: BoxMm): BoxMm => ({ minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) });
export const centerOf = (b: BoxMm): Pt => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
export const inBox = (b: BoxMm, p: Pt): boolean => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
/** Edge-to-edge distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: BoxMm, b: BoxMm): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dy = Math.max(0, b.minY - a.maxY, a.minY - b.maxY);
  return Math.hypot(dx, dy);
}
export function toBoxMm(v: BoxMm | readonly [number, number, number, number]): BoxMm {
  if (Array.isArray(v)) {
    const [a, b, c, d] = v as readonly number[];
    return { minX: Math.min(a, c), minY: Math.min(b, d), maxX: Math.max(a, c), maxY: Math.max(b, d) };
  }
  return { ...(v as BoxMm) };
}

// ---------------------------------------------------------------- points and segments

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from `p` to the segment `a`-`b`. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to a polyline. */
export function polyDist(p: Pt, pts: readonly Pt[]): number {
  if (pts.length === 1) return dist(p, pts[0]);
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(p, pts[i], pts[i + 1]));
  return d;
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Where two segments meet, if they do (touching counts). */
export function segIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = cross(rx, ry, sx, sy);
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  if (Math.abs(den) < 1e-12) {
    // parallel: collinear overlap counts as meeting at the first shared point
    if (Math.abs(cross(qx, qy, rx, ry)) > 1e-9) return undefined;
    const l2 = rx * rx + ry * ry;
    if (l2 === 0) return segDist(a, c, d) < 1e-9 ? { ...a } : undefined;
    const t0 = (qx * rx + qy * ry) / l2;
    const t1 = t0 + (sx * rx + sy * ry) / l2;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    return lo <= hi ? { x: a.x + lo * rx, y: a.y + lo * ry } : undefined;
  }
  const t = cross(qx, qy, sx, sy) / den;
  const u = cross(qx, qy, rx, ry) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return undefined;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/** The smallest distance between two segments. */
export function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segIntersection(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

/** The smallest distance between two polylines. */
export function polyPolyDist(p: readonly Pt[], q: readonly Pt[]): number {
  let best = Infinity;
  if (p.length === 1 && q.length === 1) return dist(p[0], q[0]);
  if (p.length === 1) return polyDist(p[0], q);
  if (q.length === 1) return polyDist(q[0], p);
  for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < q.length; j++) best = Math.min(best, segSegDist(p[i], p[i + 1], q[j], q[j + 1]));
  return best;
}

/** Distance from a segment to a box (0 when the segment enters it). */
export function segBoxDist(a: Pt, b: Pt, box: BoxMm): number {
  if (inBox(box, a) || inBox(box, b)) return 0;
  const c = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  let d = Infinity;
  for (let i = 0; i < 4; i++) d = Math.min(d, segSegDist(a, b, c[i], c[(i + 1) % 4]));
  return d;
}

/** The part of a segment inside a box (Liang-Barsky), if any. */
export function clipSegment(a: Pt, b: Pt, box: BoxMm): [Pt, Pt] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** Even-odd point in polygon. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Signed area of a closed polygon (positive counterclockwise). */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return -s / 2;
}

/** Polyline length. */
export function polyLength(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += dist(pts[i], pts[i + 1]);
  return s;
}

/** The point halfway along a polyline. */
export function polyMidpoint(pts: readonly Pt[]): Pt {
  const half = polyLength(pts) / 2;
  let run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (run + l >= half && l > 0) {
      const t = (half - run) / l;
      return { x: pts[i].x + t * (pts[i + 1].x - pts[i].x), y: pts[i].y + t * (pts[i + 1].y - pts[i].y) };
    }
    run += l;
  }
  return { ...pts[0] };
}

/** Drop interior points that lie on the straight line through their neighbors (within `eps`). */
export function simplifyCollinear(pts: readonly Pt[], eps = 1e-6): Pt[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (dist(a, b) < eps) continue;
    if (segDist(b, a, c) > eps) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Ramer-Douglas-Peucker simplification. */
export function rdp(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  let worst = -1;
  let far = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > far) {
      far = d;
      worst = i;
    }
  }
  if (far <= eps) return [{ ...pts[0] }, { ...pts[pts.length - 1] }];
  const a = rdp(pts.slice(0, worst + 1), eps);
  const b = rdp(pts.slice(worst), eps);
  return [...a.slice(0, -1), ...b];
}

// ---------------------------------------------------------------- arcs

/** Points along an arc from `start` to `end` with a signed sweep in degrees (counterclockwise positive), every `stepDeg`. */
export function arcPoints(start: Pt, end: Pt, sweepDeg: number, stepDeg = 5): Pt[] {
  const theta = (sweepDeg * Math.PI) / 180;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [{ ...start }];
  const h = chord / 2 / Math.tan(theta / 2);
  const cx = mx + (-dy / chord) * h;
  const cy = my + (dx / chord) * h;
  const r = Math.hypot(start.x - cx, start.y - cy);
  const a0 = Math.atan2(start.y - cy, start.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(sweepDeg) / stepDeg));
  const out: Pt[] = [{ ...start }];
  for (let i = 1; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  out.push({ ...end });
  return out;
}

// ---------------------------------------------------------------- deterministic pseudo-random numbers

/** mulberry32: a small seeded generator for synthetic fixtures. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

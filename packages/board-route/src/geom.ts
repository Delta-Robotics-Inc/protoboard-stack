/** Small 2D helpers in nanometers: distances, arcs flattened to polylines, polygons. */
import { arcCenter, type Box, type Point, type TrackRec, type Vertex } from "@protoboardai/board";

export interface P {
  x: number;
  y: number;
}

export const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from point p to segment ab. */
export function pointSegDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const orient = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether segments ab and cd cross or touch. */
export function segmentsIntersect(a: P, b: P, c: P, d: P): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && pointSegDist(c, a, b) === 0) || (o2 === 0 && pointSegDist(d, a, b) === 0) || (o3 === 0 && pointSegDist(a, c, d) === 0) || (o4 === 0 && pointSegDist(b, c, d) === 0);
}

/** Distance between segments ab and cd. */
export function segSegDist(a: P, b: P, c: P, d: P): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

export function pointInPolygon(p: P, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from segment ab to a closed polygon's boundary (0 when it crosses it). */
export function segPolygonEdgeDist(a: P, b: P, poly: readonly P[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = segSegDist(a, b, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/** Distance from segment ab to a filled polygon (0 when it touches or enters it). */
export function segPolygonDist(a: P, b: P, poly: readonly P[]): number {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0;
  return segPolygonEdgeDist(a, b, poly);
}

export function boxPolygon(b: Box): P[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

/** Distance from segment ab to a box (0 when it touches or enters it). */
export const segBoxDist = (a: P, b: P, box: Box): number => segPolygonDist(a, b, boxPolygon(box));

/** Points along an arc from start to end with a signed sweep (millidegrees), at most `stepDeg` apart, start and end included. */
export function arcPoints(start: Point, end: Point, sweep: number, stepDeg = 5): P[] {
  const c = arcCenter(start, end, sweep);
  if (c.r === 0) return [start, end];
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const s = ((sweep / 1000) * Math.PI) / 180;
  const n = Math.max(1, Math.ceil(Math.abs(sweep / 1000) / stepDeg));
  const out: P[] = [{ x: start.x, y: start.y }];
  for (let i = 1; i < n; i++) {
    const a = a0 + (s * i) / n;
    out.push({ x: Math.round(c.x + c.r * Math.cos(a)), y: Math.round(c.y + c.r * Math.sin(a)) });
  }
  out.push({ x: end.x, y: end.y });
  return out;
}

/** A contour with arc edges flattened to straight edges; `approximated` is true when any arc was flattened. */
export function flattenContour(vertices: readonly Vertex[], stepDeg = 5): { points: P[]; approximated: boolean } {
  const points: P[] = [];
  let approximated = false;
  vertices.forEach((v, i) => {
    const next = vertices[(i + 1) % vertices.length];
    if (v.sweep !== undefined) {
      approximated = true;
      const pts = arcPoints(v, next, v.sweep, stepDeg);
      points.push(...pts.slice(0, -1));
    } else points.push({ x: v.x, y: v.y });
  });
  return { points, approximated };
}

/** A track as straight pieces (an arc flattened). */
export function trackPieces(t: Pick<TrackRec, "start" | "end" | "sweep">, stepDeg = 5): [P, P][] {
  if (t.sweep === undefined) return [[t.start, t.end]];
  const pts = arcPoints(t.start, t.end, t.sweep, stepDeg);
  const out: [P, P][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
  return out;
}

/** A track's centerline length (an arc by its arc length), nanometers. */
export function trackLength(t: Pick<TrackRec, "start" | "end" | "sweep">): number {
  if (t.sweep === undefined) return dist(t.start, t.end);
  const c = arcCenter(t.start, t.end, t.sweep);
  return c.r * Math.abs(((t.sweep / 1000) * Math.PI) / 180);
}

export function polygonBox(points: readonly P[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}

/** Whether a closed polygon is an axis-aligned rectangle. */
export function isAxisRect(points: readonly P[]): boolean {
  if (points.length !== 4) return false;
  const b = polygonBox(points);
  return points.every((p) => (p.x === b.minX || p.x === b.maxX) && (p.y === b.minY || p.y === b.maxY));
}

/**
 * Geometry shared by the importers: arcs from three points, contours (closed vertex lists whose `sweep` is the arc
 * to the next vertex), tessellation for areas and containment, and joining loose edges into closed loops. All
 * coordinates are nanometers, +Y up.
 */
import { arcCenter, type Point, type Vertex } from "@protoboardai/board";

/** The signed sweep (millidegrees, counterclockwise positive) of the arc from `s` through `m` to `e`, or undefined when the three points are collinear or repeat. */
export function arcSweep(s: Point, m: Point, e: Point): number | undefined {
  const ux = m.x - s.x;
  const uy = m.y - s.y;
  const vx = e.x - s.x;
  const vy = e.y - s.y;
  if (Math.abs(ux * vy - uy * vx) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) return undefined;
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const cx = (sq(s) * (m.y - e.y) + sq(m) * (e.y - s.y) + sq(e) * (s.y - m.y)) / d;
  const cy = (sq(s) * (e.x - m.x) + sq(m) * (s.x - e.x) + sq(e) * (m.x - s.x)) / d;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return undefined;
  const TAU = 2 * Math.PI;
  const ang = (p: Point) => Math.atan2(p.y - cy, p.x - cx);
  const ccw = (a: number, b: number) => (((b - a) % TAU) + TAU) % TAU;
  const a0 = ang(s);
  const toEnd = ccw(a0, ang(e));
  const toMid = ccw(a0, ang(m));
  const rad = toMid <= toEnd ? toEnd : toEnd - TAU;
  const mdeg = Math.round((rad * 180_000) / Math.PI);
  if (mdeg === 0 || mdeg <= -360_000 || mdeg > 360_000) return undefined;
  return mdeg;
}

/** Points along an arc from `start` to `end` with `sweep`, excluding `start`, at most `stepDeg` apart. */
export function arcPoints(start: Point, end: Point, sweep: number, stepDeg = 5): Point[] {
  const c = arcCenter(start, end, sweep);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const total = (sweep / 1000) * (Math.PI / 180);
  const n = Math.max(1, Math.ceil(Math.abs(sweep / 1000) / stepDeg));
  const out: Point[] = [];
  for (let k = 1; k < n; k++) {
    const a = a0 + (total * k) / n;
    out.push({ x: c.x + c.r * Math.cos(a), y: c.y + c.r * Math.sin(a) });
  }
  out.push({ x: end.x, y: end.y });
  return out;
}

/** A contour as a polyline (arcs tessellated), closed implicitly. */
export function tessellate(contour: readonly Vertex[], stepDeg = 5): Point[] {
  const out: Point[] = [];
  contour.forEach((v, i) => {
    out.push({ x: v.x, y: v.y });
    const next = contour[(i + 1) % contour.length];
    if (v.sweep !== undefined) out.push(...arcPoints(v, next, v.sweep, stepDeg).slice(0, -1));
  });
  return out;
}

/** Signed area of a closed polyline (counterclockwise positive), in square nanometers. */
export function polygonArea(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Whether a point is inside a closed polyline (even-odd). */
export function pointInPolygon(p: Point, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The same contour traversed the other way (each arc moves to the vertex it now starts from, sweep negated). */
export function reverseContour(c: readonly Vertex[]): Vertex[] {
  const n = c.length;
  const out: Vertex[] = [];
  for (let k = 0; k < n; k++) {
    // new vertex k is old vertex (n - k) % n; its edge goes to old vertex (n - k - 1), which was old edge (n - k - 1)
    const v = c[(n - k) % n];
    const edge = c[(n - k - 1 + n) % n];
    out.push(edge.sweep !== undefined ? { x: v.x, y: v.y, sweep: -edge.sweep } : { x: v.x, y: v.y });
  }
  return out;
}

/** The contour turned counterclockwise. */
export function ccwContour(c: readonly Vertex[]): Vertex[] {
  return polygonArea(tessellate(c)) < 0 ? reverseContour(c) : [...c];
}

/** A full circle as a contour of three 120 degree arcs, counterclockwise. */
export function circleContour(cx: number, cy: number, r: number): Vertex[] {
  return [0, 120, 240].map((a) => ({ x: Math.round(cx + r * Math.cos((a * Math.PI) / 180)), y: Math.round(cy + r * Math.sin((a * Math.PI) / 180)), sweep: 120_000 }));
}

/** Drop repeated consecutive vertices (a repeated vertex keeps the arc of whichever copy has one). */
export function dedupeContour(c: readonly Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  for (const v of c) {
    const last = out[out.length - 1];
    if (last && last.x === v.x && last.y === v.y) {
      if (v.sweep !== undefined) out[out.length - 1] = v;
      continue;
    }
    out.push(v);
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) {
    const last = out.pop()!;
    if (last.sweep !== undefined && out[0].sweep === undefined) out[0] = { ...out[0], sweep: last.sweep };
  }
  return out;
}

/** An edge for loop joining: straight, or an arc with a sweep. */
export interface Edge {
  a: Point;
  b: Point;
  sweep?: number;
  source?: string;
}

export interface JoinResult {
  /** Closed loops as contours. */
  loops: { contour: Vertex[]; sources: string[] }[];
  /** Edges that could not be closed into a loop, grouped by chain. */
  open: Edge[][];
  /** The largest gap closed between two joined ends, nanometers (0: every joint matched exactly). */
  maxGap: number;
  /** Joints closed with a gap above zero. */
  gaps: number;
}

/** Join edges into closed loops by matching end points within `tolerance` nanometers. */
export function joinEdges(edges: readonly Edge[], tolerance = 1000): JoinResult {
  const cell = Math.max(1, tolerance);
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const index = new Map<string, number[]>();
  const put = (p: Point, i: number) => {
    const k = key(p.x, p.y);
    const l = index.get(k);
    if (l) l.push(i);
    else index.set(k, [i]);
  };
  edges.forEach((e, i) => {
    put(e.a, i);
    put(e.b, i);
  });
  const used = new Uint8Array(edges.length);
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  /** The nearest unused edge with an end within tolerance of p: [edge, reversed, gap]. */
  const near = (p: Point): [number, boolean, number] | undefined => {
    let best: [number, boolean, number] | undefined;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of index.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used[i]) continue;
          const e = edges[i];
          const da = dist(p, e.a);
          const db = dist(p, e.b);
          if (da <= tolerance && (!best || da < best[2])) best = [i, false, da];
          if (db <= tolerance && (!best || db < best[2])) best = [i, true, db];
        }
    return best;
  };
  const flip = (e: Edge): Edge => ({ a: e.b, b: e.a, ...(e.sweep !== undefined ? { sweep: -e.sweep } : {}), ...(e.source ? { source: e.source } : {}) });
  const out: JoinResult = { loops: [], open: [], maxGap: 0, gaps: 0 };
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const chain: Edge[] = [edges[s]];
    let closed = false;
    const joints: number[] = [];
    for (;;) {
      const end = chain[chain.length - 1].b;
      const startGap = dist(end, chain[0].a);
      const n = near(end);
      if (chain.length > 1 && startGap <= tolerance && (!n || startGap <= n[2])) {
        joints.push(startGap);
        closed = true;
        break;
      }
      if (!n) break;
      used[n[0]] = 1;
      joints.push(n[2]);
      chain.push(n[1] ? flip(edges[n[0]]) : edges[n[0]]);
    }
    if (!closed) {
      // extend backwards from the start so the reported open chain is whole
      for (;;) {
        const n = near(chain[0].a);
        if (!n) break;
        used[n[0]] = 1;
        chain.unshift(n[1] ? edges[n[0]] : flip(edges[n[0]]));
      }
      out.open.push(chain);
      continue;
    }
    for (const g of joints) {
      if (g > 0) out.gaps++;
      if (g > out.maxGap) out.maxGap = g;
    }
    const contour = dedupeContour(chain.map((e) => (e.sweep !== undefined ? { x: e.a.x, y: e.a.y, sweep: e.sweep } : { x: e.a.x, y: e.a.y })));
    if (contour.length >= 2) out.loops.push({ contour, sources: chain.map((e) => e.source ?? "").filter(Boolean) });
  }
  return out;
}

/** A contour with fewer than three vertices made valid (two arcs become a circle of three arcs; anything else is dropped). */
export function validContour(c: Vertex[]): Vertex[] | undefined {
  if (c.length >= 3) return c;
  if (c.length === 2 && c[0].sweep !== undefined && c[1].sweep !== undefined) {
    // a closed shape of two arcs: split the first arc at its middle
    const mid = arcPoints(c[0], c[1], c[0].sweep, Math.abs(c[0].sweep / 2000))[0];
    const half = Math.trunc(c[0].sweep / 2);
    return [
      { x: c[0].x, y: c[0].y, sweep: half },
      { x: Math.round(mid.x), y: Math.round(mid.y), sweep: c[0].sweep - half },
      c[1],
    ];
  }
  return undefined;
}

/**
 * The EasyEDA Pro polygon notation (PCB format, "polygon system"), in source units (format units, +Y up):
 *
 * - a single polygon is `[x, y, "L", x, y, x, y, ..., "ARC", angle, x, y, "C", x2, y2, x3, y3, x4, y4, ...]`: a start
 *   point, then commands, each followed by as many groups of numbers as there are; `ARC` and `CARC` take
 *   `angle, endX, endY` (counterclockwise positive), `C` takes three control points of a cubic Bezier;
 * - `["R", x, y, width, height, rotation, round]` is a rectangle from its top-left corner (`isCCW` may sit before
 *   `round` in a seven-value form); `["CIRCLE", cx, cy, r]` is a circle;
 * - a complex polygon is an array of single polygons: the first is the outer boundary, the rest are holes. Some
 *   writers give a single polygon where a complex one is expected; both are accepted.
 */
import type { Json } from "./project.js";

export interface PVertex {
  x: number;
  y: number;
  /** Degrees, counterclockwise positive: the arc from this vertex to the next. */
  sweep?: number;
}

export type Shape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ring"; pts: PVertex[]; closed: boolean };

export interface ParseNotes {
  /** Cubic Bezier spans flattened to straight segments. */
  beziers: number;
  /** Rectangles with a rotation (taken about the top-left corner, which the documentation does not state). */
  rotatedRects: number;
  /** Tokens that could not be read. */
  bad: number;
}

export const newNotes = (): ParseNotes => ({ beziers: 0, rotatedRects: 0, bad: 0 });

const isNum = (v: Json | undefined): v is number => typeof v === "number" && Number.isFinite(v);

const BEZIER_STEPS = 16;

function rectShape(a: Json[], notes: ParseNotes): Shape {
  const nums = a.slice(1).map((v) => (isNum(v) ? v : 0));
  const [x, y, w, h] = nums;
  const rot = nums[4] ?? 0;
  const round = nums.length >= 7 ? (nums[6] ?? 0) : (nums[5] ?? 0);
  const r = Math.max(0, Math.min(round, Math.abs(w) / 2, Math.abs(h) / 2));
  // top-left corner at (x, y), +Y up: the rectangle spans x..x+w and y-h..y; counterclockwise from bottom-left
  const x0 = x;
  const x1 = x + w;
  const y0 = y - h;
  const y1 = y;
  let pts: PVertex[];
  if (r > 0) {
    pts = [
      { x: x0 + r, y: y0 },
      { x: x1 - r, y: y0, sweep: 90 },
      { x: x1, y: y0 + r },
      { x: x1, y: y1 - r, sweep: 90 },
      { x: x1 - r, y: y1 },
      { x: x0 + r, y: y1, sweep: 90 },
      { x: x0, y: y1 - r },
      { x: x0, y: y0 + r, sweep: 90 },
    ];
  } else
    pts = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  if (rot) {
    notes.rotatedRects++;
    const c = Math.cos((rot * Math.PI) / 180);
    const s = Math.sin((rot * Math.PI) / 180);
    pts = pts.map((p) => ({ ...p, x: x + (p.x - x) * c - (p.y - y) * s, y: y + (p.x - x) * s + (p.y - y) * c }));
  }
  return { kind: "ring", pts, closed: true };
}

/** One single polygon. */
export function parseSingle(path: Json, notes: ParseNotes = newNotes()): Shape | undefined {
  if (!Array.isArray(path) || !path.length) return undefined;
  if (path[0] === "CIRCLE") {
    const [cx, cy, r] = path.slice(1);
    if (!isNum(cx) || !isNum(cy) || !isNum(r) || r <= 0) {
      notes.bad++;
      return undefined;
    }
    return { kind: "circle", cx, cy, r };
  }
  if (path[0] === "R") return rectShape(path, notes);
  const pts: PVertex[] = [];
  let i = 0;
  if (!isNum(path[0]) || !isNum(path[1])) {
    notes.bad++;
    return undefined;
  }
  pts.push({ x: path[0], y: path[1] });
  i = 2;
  let mode = "L";
  while (i < path.length) {
    const t = path[i];
    if (typeof t === "string") {
      mode = t;
      i++;
      continue;
    }
    if (mode === "L") {
      if (!isNum(path[i]) || !isNum(path[i + 1])) {
        notes.bad++;
        break;
      }
      pts.push({ x: path[i] as number, y: path[i + 1] as number });
      i += 2;
    } else if (mode === "ARC" || mode === "CARC") {
      const [angle, x, y] = [path[i], path[i + 1], path[i + 2]];
      if (!isNum(angle) || !isNum(x) || !isNum(y)) {
        notes.bad++;
        break;
      }
      if (angle !== 0) pts[pts.length - 1].sweep = angle;
      pts.push({ x, y });
      i += 3;
    } else if (mode === "C") {
      const v = path.slice(i, i + 6);
      if (v.length < 6 || !v.every(isNum)) {
        notes.bad++;
        break;
      }
      const p0 = pts[pts.length - 1];
      const [x1, y1, x2, y2, x3, y3] = v as number[];
      for (let k = 1; k <= BEZIER_STEPS; k++) {
        const t2 = k / BEZIER_STEPS;
        const u = 1 - t2;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * t2 * x1 + 3 * u * t2 * t2 * x2 + t2 * t2 * t2 * x3,
          y: u * u * u * p0.y + 3 * u * u * t2 * y1 + 3 * u * t2 * t2 * y2 + t2 * t2 * t2 * y3,
        });
      }
      notes.beziers++;
      i += 6;
    } else {
      notes.bad++;
      break;
    }
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = pts.length > 2 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6;
  if (closed) {
    // the closing vertex repeats the first; its sweep (if any) is the last edge's
    const end = pts.pop()!;
    void end;
  }
  return { kind: "ring", pts, closed };
}

/** A complex polygon: the outer boundary first, then holes. */
export function parseComplex(path: Json, notes: ParseNotes = newNotes()): Shape[] {
  if (!Array.isArray(path) || !path.length) return [];
  const parts = Array.isArray(path[0]) ? path : [path];
  const out: Shape[] = [];
  for (const p of parts) {
    const s = parseSingle(p, notes);
    if (s) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- arcs

/** The center and radius of the arc from `a` to `b` sweeping `sweepDeg` (counterclockwise positive). */
export function arcCenter(a: { x: number; y: number }, b: { x: number; y: number }, sweepDeg: number): { cx: number; cy: number; r: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = Math.hypot(dx, dy);
  const half = (sweepDeg * Math.PI) / 360;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (c === 0 || Math.abs(Math.sin(half)) < 1e-12) return { cx: mx, cy: my, r: c / 2 };
  const r = Math.abs(c / (2 * Math.sin(half)));
  const d = c / 2 / Math.tan(half);
  // left normal of the chord
  return { cx: mx - (dy / c) * d, cy: my + (dx / c) * d, r };
}

/** Points along an arc (end included, start excluded), `stepDeg` apart at most. */
export function arcPoints(a: { x: number; y: number }, b: { x: number; y: number }, sweepDeg: number, stepDeg = 5): { x: number; y: number }[] {
  const { cx, cy, r } = arcCenter(a, b, sweepDeg);
  const n = Math.max(1, Math.ceil(Math.abs(sweepDeg) / stepDeg));
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const out: { x: number; y: number }[] = [];
  for (let k = 1; k < n; k++) {
    const t = a0 + ((sweepDeg * Math.PI) / 180) * (k / n);
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  out.push({ x: b.x, y: b.y });
  return out;
}

/** A closed shape as a polyline ring (arcs and circles flattened). */
export function flatten(s: Shape, stepDeg = 5): { x: number; y: number }[] {
  if (s.kind === "circle") {
    const n = Math.max(8, Math.ceil(360 / stepDeg));
    return Array.from({ length: n }, (_, k) => ({ x: s.cx + s.r * Math.cos((2 * Math.PI * k) / n), y: s.cy + s.r * Math.sin((2 * Math.PI * k) / n) }));
  }
  const out: { x: number; y: number }[] = [];
  const n = s.pts.length;
  for (let i = 0; i < n; i++) {
    const p = s.pts[i];
    if (i === 0) out.push({ x: p.x, y: p.y });
    const q = s.pts[(i + 1) % n];
    if (i === n - 1 && !s.closed) break;
    if (p.sweep) out.push(...arcPoints(p, q, p.sweep, stepDeg));
    else out.push({ x: q.x, y: q.y });
  }
  if (s.closed && out.length > 1) out.pop(); // the closing point repeats the first
  return out;
}

/** Twice the signed area (positive: counterclockwise). */
export function signedArea2(pts: readonly { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

export function pointInRing(p: { x: number; y: number }, ring: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A circle as a closed contour of four quarter arcs (counterclockwise). */
export function circleRing(cx: number, cy: number, r: number): PVertex[] {
  return [
    { x: cx + r, y: cy, sweep: 90 },
    { x: cx, y: cy + r, sweep: 90 },
    { x: cx - r, y: cy, sweep: 90 },
    { x: cx, y: cy - r, sweep: 90 },
  ];
}

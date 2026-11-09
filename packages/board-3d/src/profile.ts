/**
 * Planar profiles: closed loops of straight and circular edges, in millimeters. A loop is its corner points and, per
 * edge, an optional arc (`arcs[i]` is the edge from `pts[i]` to `pts[i + 1]`). A full circle is two half arcs, so every
 * edge has distinct end points (what a B-rep needs).
 */
import { arcCenter, toMm, type Vertex } from "@protoboardai/board";
import type { Vec2 } from "./math.js";

export interface Arc {
  center: Vec2;
  radius: number;
  /** True when the edge runs counterclockwise about the center (seen from +Z). */
  ccw: boolean;
}
export interface Loop {
  pts: Vec2[];
  arcs: (Arc | undefined)[];
}
/** An area: one outer loop (counterclockwise) and holes (clockwise) after `orient`. */
export interface Region {
  outer: Loop;
  holes: Loop[];
}

const TWO_PI = Math.PI * 2;

/** Signed sweep (radians) of an arc edge from a to b. */
export function arcSweep(a: Vec2, b: Vec2, arc: Arc): number {
  const a0 = Math.atan2(a[1] - arc.center[1], a[0] - arc.center[0]);
  const a1 = Math.atan2(b[1] - arc.center[1], b[0] - arc.center[0]);
  let s = a1 - a0;
  if (arc.ccw) {
    while (s <= 1e-12) s += TWO_PI;
  } else {
    while (s >= -1e-12) s -= TWO_PI;
  }
  return s;
}

/** Number of straight pieces for an arc of radius r and sweep s at chord tolerance tol. */
export function arcPieces(r: number, sweep: number, tol: number, maxStepDeg = 15): number {
  const byTol = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 2;
  const step = Math.min(byTol, (maxStepDeg * Math.PI) / 180);
  return Math.max(1, Math.ceil(Math.abs(sweep) / step - 1e-9));
}

/** The loop as a polyline (corner points included, arcs divided), without the closing point. */
export function tessellateLoop(loop: Loop, tol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  const n = loop.pts.length;
  for (let i = 0; i < n; i++) {
    const a = loop.pts[i];
    out.push(a);
    const arc = loop.arcs[i];
    if (!arc) continue;
    const b = loop.pts[(i + 1) % n];
    const s = arcSweep(a, b, arc);
    const k = arcPieces(arc.radius, s, tol);
    const a0 = Math.atan2(a[1] - arc.center[1], a[0] - arc.center[0]);
    for (let j = 1; j < k; j++) {
      const t = a0 + (s * j) / k;
      out.push([arc.center[0] + arc.radius * Math.cos(t), arc.center[1] + arc.radius * Math.sin(t)]);
    }
  }
  return out;
}

export function polygonArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
export const loopArea = (loop: Loop): number => polygonArea(tessellateLoop(loop, 0.005));

export function reverseLoop(loop: Loop): Loop {
  const n = loop.pts.length;
  const pts: Vec2[] = [];
  const arcs: (Arc | undefined)[] = [];
  for (let i = n - 1; i >= 0; i--) {
    pts.push(loop.pts[i]);
    // the edge from pts[i] to pts[i - 1] is the old edge i - 1 reversed
    const old = loop.arcs[(i - 1 + n) % n];
    arcs.push(old ? { ...old, ccw: !old.ccw } : undefined);
  }
  return { pts, arcs };
}

/** Outer counterclockwise, holes clockwise. */
export function orient(region: Region): Region {
  const outer = loopArea(region.outer) < 0 ? reverseLoop(region.outer) : region.outer;
  const holes = region.holes.map((h) => (loopArea(h) > 0 ? reverseLoop(h) : h));
  return { outer, holes };
}

export function rectLoop(w: number, h: number, cx = 0, cy = 0): Loop {
  const x = w / 2;
  const y = h / 2;
  return {
    pts: [
      [cx - x, cy - y],
      [cx + x, cy - y],
      [cx + x, cy + y],
      [cx - x, cy + y],
    ],
    arcs: [undefined, undefined, undefined, undefined],
  };
}

export function circleLoop(r: number, cx = 0, cy = 0): Loop {
  const c: Vec2 = [cx, cy];
  return {
    pts: [
      [cx + r, cy],
      [cx - r, cy],
    ],
    arcs: [
      { center: c, radius: r, ccw: true },
      { center: c, radius: r, ccw: true },
    ],
  };
}

/** A rectangle with rounded corners (radius clamped to half the short side), counterclockwise. */
export function roundRectLoop(w: number, h: number, r: number, cx = 0, cy = 0): Loop {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-6) return rectLoop(w, h, cx, cy);
  const x = w / 2;
  const y = h / 2;
  if (Math.abs(rr - w / 2) < 1e-9 && Math.abs(rr - h / 2) < 1e-9) return circleLoop(rr, cx, cy);
  if (Math.abs(rr - Math.min(w, h) / 2) < 1e-9) return stadiumLoop(w, h, cx, cy);
  const pts: Vec2[] = [
    [cx - x + rr, cy - y],
    [cx + x - rr, cy - y],
    [cx + x, cy - y + rr],
    [cx + x, cy + y - rr],
    [cx + x - rr, cy + y],
    [cx - x + rr, cy + y],
    [cx - x, cy + y - rr],
    [cx - x, cy - y + rr],
  ];
  const arc = (ox: number, oy: number): Arc => ({ center: [cx + ox, cy + oy], radius: rr, ccw: true });
  return { pts, arcs: [undefined, arc(x - rr, -y + rr), undefined, arc(x - rr, y - rr), undefined, arc(-x + rr, y - rr), undefined, arc(-x + rr, -y + rr)] };
}

/** An oval (slot): a w x h box with fully rounded short ends, counterclockwise. */
export function stadiumLoop(w: number, h: number, cx = 0, cy = 0): Loop {
  if (Math.abs(w - h) < 1e-9) return circleLoop(w / 2, cx, cy);
  if (w > h) {
    const r = h / 2;
    const d = w / 2 - r;
    return {
      pts: [
        [cx - d, cy - r],
        [cx + d, cy - r],
        [cx + d, cy + r],
        [cx - d, cy + r],
      ],
      arcs: [undefined, { center: [cx + d, cy], radius: r, ccw: true }, undefined, { center: [cx - d, cy], radius: r, ccw: true }],
    };
  }
  const r = w / 2;
  const d = h / 2 - r;
  return {
    pts: [
      [cx + r, cy - d],
      [cx + r, cy + d],
      [cx - r, cy + d],
      [cx - r, cy - d],
    ],
    arcs: [undefined, { center: [cx, cy + d], radius: r, ccw: true }, undefined, { center: [cx, cy - d], radius: r, ccw: true }],
  };
}

/** A straight stroke from a to b of width w with round caps (a track or a silkscreen line). */
export function strokeLoop(a: Vec2, b: Vec2, w: number): Loop {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const r = w / 2;
  if (l < 1e-9) return circleLoop(r, a[0], a[1]);
  const nx = (-dy / l) * r;
  const ny = (dx / l) * r;
  return {
    pts: [
      [a[0] - nx, a[1] - ny],
      [b[0] - nx, b[1] - ny],
      [b[0] + nx, b[1] + ny],
      [a[0] + nx, a[1] + ny],
    ],
    arcs: [undefined, { center: b, radius: r, ccw: true }, undefined, { center: a, radius: r, ccw: true }],
  };
}

/** A stroke along an arc (center, radius, start angle, signed sweep in radians) of width w with round caps. */
export function arcStrokeLoop(center: Vec2, radius: number, a0: number, sweep: number, w: number): Loop {
  const r = w / 2;
  const s = sweep >= 0 ? sweep : -sweep;
  const start = sweep >= 0 ? a0 : a0 + sweep;
  if (radius <= r + 1e-6 || s < 1e-9) return circleLoop(radius + r, center[0], center[1]);
  const p = (rad: number, t: number): Vec2 => [center[0] + rad * Math.cos(t), center[1] + rad * Math.sin(t)];
  const e = start + s;
  // outer arc counterclockwise from start to end, cap, inner arc clockwise back, cap
  return {
    pts: [p(radius + r, start), p(radius + r, e), p(radius - r, e), p(radius - r, start)],
    arcs: [
      { center, radius: radius + r, ccw: true },
      { center: p(radius, e), radius: r, ccw: true },
      { center, radius: radius - r, ccw: false },
      { center: p(radius, start), radius: r, ccw: true },
    ],
  };
}

/** A board contour (nanometers, vertex sweeps in millidegrees) as a loop in millimeters, offset by `origin`. */
export function loopFromVertices(vs: readonly Vertex[], origin: Vec2 = [0, 0]): Loop {
  const pts: Vec2[] = [];
  const arcs: (Arc | undefined)[] = [];
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const v = vs[i];
    const w = vs[(i + 1) % n];
    pts.push([toMm(v.x) - origin[0], toMm(v.y) - origin[1]]);
    if (v.sweep) {
      if (Math.abs(v.sweep) >= 360_000) {
        // a full circle from one vertex: split it into two halves through the opposite point
        const c = arcCenter(v, w, v.sweep);
        const ox = c.x - (v.x - c.x);
        const oy = c.y - (v.y - c.y);
        const center: Vec2 = [toMm(c.x) - origin[0], toMm(c.y) - origin[1]];
        const ccw = v.sweep > 0;
        arcs.push({ center, radius: toMm(c.r), ccw });
        pts.push([toMm(ox) - origin[0], toMm(oy) - origin[1]]);
        arcs.push({ center, radius: toMm(c.r), ccw });
        continue;
      }
      const c = arcCenter(v, w, v.sweep);
      arcs.push({ center: [toMm(c.x) - origin[0], toMm(c.y) - origin[1]], radius: toMm(c.r), ccw: v.sweep > 0 });
    } else arcs.push(undefined);
  }
  return dedupeLoop({ pts, arcs });
}

/** Drop repeated points (zero-length edges). */
export function dedupeLoop(loop: Loop): Loop {
  const pts: Vec2[] = [];
  const arcs: (Arc | undefined)[] = [];
  const n = loop.pts.length;
  for (let i = 0; i < n; i++) {
    const p = loop.pts[i];
    const q = loop.pts[(i + 1) % n];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7) continue;
    pts.push(p);
    arcs.push(loop.arcs[i]);
  }
  return { pts, arcs };
}

/** Is a point inside a polygon (even-odd)? */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Map every point and arc center through a 2D affine function (rigid: rotations and translations; mirror flips arcs). */
export function mapLoop(loop: Loop, f: (p: Vec2) => Vec2, mirrored = false): Loop {
  return {
    pts: loop.pts.map(f),
    arcs: loop.arcs.map((a) => (a ? { center: f(a.center), radius: a.radius, ccw: mirrored ? !a.ccw : a.ccw } : undefined)),
  };
}

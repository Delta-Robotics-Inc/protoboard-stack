/**
 * Exact distances between the three curve primitives every board shape is built from: a point, a straight
 * segment and a circular arc. Coordinates are nanometers held in doubles (a board's integers are exact in a
 * double; products stay well inside its 53-bit mantissa after translating to a local origin where it matters).
 *
 * Each function returns the distance and writes the closest pair into `out` (`ax, ay` on the first primitive,
 * `bx, by` on the second). The arc cases are complete: the minimum is always among the candidates listed in
 * each function's comment, so no sampling is involved.
 */

export interface PtPrim {
  t: "pt";
  x: number;
  y: number;
}
export interface SegPrim {
  t: "seg";
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
/**
 * A circular arc from `s` to `e` about `c`, radius `r`, starting at angle `a0` (radians) and sweeping `sw` radians
 * (signed: positive is counterclockwise). `|sw| >= 2π` is a full circle.
 */
export interface ArcPrim {
  t: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  sw: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}
export type Prim = PtPrim | SegPrim | ArcPrim;

export interface Closest {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
export const closest = (): Closest => ({ ax: 0, ay: 0, bx: 0, by: 0 });

const TAU = Math.PI * 2;
/** Angular slack when testing whether a direction lies inside an arc's span (about 1e-12 rad). */
const ANG_EPS = 1e-12;

function set(out: Closest, ax: number, ay: number, bx: number, by: number): void {
  out.ax = ax;
  out.ay = ay;
  out.bx = bx;
  out.by = by;
}

/** Build an arc from its center, radius, start point, end point and signed sweep (radians). */
export function makeArc(cx: number, cy: number, r: number, sx: number, sy: number, ex: number, ey: number, sw: number): ArcPrim {
  return { t: "arc", cx, cy, r, a0: Math.atan2(sy - cy, sx - cx), sw, sx, sy, ex, ey };
}

/** Whether the direction from the arc's center to (x, y) lies within the arc's span. */
export function inSpan(a: ArcPrim, x: number, y: number): boolean {
  if (Math.abs(a.sw) >= TAU - ANG_EPS) return true;
  const ang = Math.atan2(y - a.cy, x - a.cx);
  let rel = a.sw >= 0 ? ang - a.a0 : a.a0 - ang;
  rel %= TAU;
  if (rel < 0) rel += TAU;
  // a direction just before the start wraps to almost a full turn
  if (rel > TAU - ANG_EPS) rel = 0;
  return rel <= Math.abs(a.sw) + ANG_EPS;
}

export function ptPt(px: number, py: number, qx: number, qy: number, out: Closest): number {
  set(out, px, py, qx, qy);
  return Math.hypot(px - qx, py - qy);
}

/** Point to segment; the closest point on the segment goes to `out.bx, by`. */
export function ptSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number, out: Closest): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  set(out, px, py, qx, qy);
  return Math.hypot(px - qx, py - qy);
}

/**
 * Point to arc. If the point's direction from the center is inside the span the nearest arc point is the radial
 * projection (`| |p - c| - r |`); otherwise it is the nearer endpoint.
 */
export function ptArc(px: number, py: number, a: ArcPrim, out: Closest): number {
  const dx = px - a.cx;
  const dy = py - a.cy;
  const g = Math.hypot(dx, dy);
  let best = Infinity;
  if (g === 0) {
    // every point of the arc is r away
    set(out, px, py, a.sx, a.sy);
    return a.r;
  }
  if (inSpan(a, px, py)) {
    const qx = a.cx + (dx / g) * a.r;
    const qy = a.cy + (dy / g) * a.r;
    best = Math.abs(g - a.r);
    set(out, px, py, qx, qy);
  }
  const ds = Math.hypot(px - a.sx, py - a.sy);
  if (ds < best) {
    best = ds;
    set(out, px, py, a.sx, a.sy);
  }
  const de = Math.hypot(px - a.ex, py - a.ey);
  if (de < best) {
    best = de;
    set(out, px, py, a.ex, a.ey);
  }
  return best;
}

/** Twice the signed area of (a, b, c): positive when counterclockwise. */
export const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const tmp = closest();

/** Segment to segment: zero where they cross, else the least of the four endpoint-to-segment distances. */
export function segSeg(s: SegPrim, u: SegPrim, out: Closest): number {
  // translate to a local origin so the orientation products stay small
  const ox = s.ax;
  const oy = s.ay;
  const ax = 0,
    ay = 0,
    bx = s.bx - ox,
    by = s.by - oy,
    cx = u.ax - ox,
    cy = u.ay - oy,
    dx = u.bx - ox,
    dy = u.by - oy;
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    const x = ox + ax + t * (bx - ax);
    const y = oy + ay + t * (by - ay);
    set(out, x, y, x, y);
    return 0;
  }
  let best = ptSeg(s.ax, s.ay, u.ax, u.ay, u.bx, u.by, out);
  let d = ptSeg(s.bx, s.by, u.ax, u.ay, u.bx, u.by, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.ax, tmp.ay, tmp.bx, tmp.by);
  }
  d = ptSeg(u.ax, u.ay, s.ax, s.ay, s.bx, s.by, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  d = ptSeg(u.bx, u.by, s.ax, s.ay, s.bx, s.by, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  return best;
}

/**
 * Segment to arc. Along the segment, the distance to the arc's full circle is `|g(t) - r|` with `g` the convex
 * distance to the center, so its minima are at the segment's ends, at the foot of the perpendicular from the
 * center (when outside the circle), or where the segment crosses the circle (zero). A minimum whose arc point is
 * not interior to the span sits at an arc endpoint. Candidates: both segment ends to the arc, both arc ends to
 * the segment, the foot, and the crossings, each kept only when its direction lies in the span.
 */
export function segArc(s: SegPrim, a: ArcPrim, out: Closest): number {
  let best = ptArc(s.ax, s.ay, a, out);
  let d = ptArc(s.bx, s.by, a, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.ax, tmp.ay, tmp.bx, tmp.by);
  }
  d = ptSeg(a.sx, a.sy, s.ax, s.ay, s.bx, s.by, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  d = ptSeg(a.ex, a.ey, s.ax, s.ay, s.bx, s.by, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  // local frame at the center
  const ax = s.ax - a.cx;
  const ay = s.ay - a.cy;
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  if (l2 > 0) {
    // the foot of the perpendicular from the center
    const t = -(ax * dx + ay * dy) / l2;
    if (t > 0 && t < 1) {
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const g = Math.hypot(qx, qy);
      if (g > a.r && g - a.r < best && inSpan(a, qx + a.cx, qy + a.cy)) {
        best = g - a.r;
        set(out, qx + a.cx, qy + a.cy, a.cx + (qx / g) * a.r, a.cy + (qy / g) * a.r);
      }
    }
    // crossings: |p + t d|^2 = r^2
    if (best > 0) {
      const B = 2 * (ax * dx + ay * dy);
      const C = ax * ax + ay * ay - a.r * a.r;
      const disc = B * B - 4 * l2 * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t2 of [(-B - sq) / (2 * l2), (-B + sq) / (2 * l2)]) {
          if (t2 < 0 || t2 > 1) continue;
          const x = s.ax + t2 * dx;
          const y = s.ay + t2 * dy;
          if (inSpan(a, x, y)) {
            set(out, x, y, x, y);
            return 0;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Arc to arc. An interior-to-interior minimum joins two points whose normals coincide, so it lies on the line
 * through both centers (or the arcs cross: zero). Candidates: each arc's ends to the other arc, the four
 * center-line points, and the circles' intersections. Concentric arcs: `|r1 - r2|` where the spans overlap.
 */
export function arcArc(p: ArcPrim, q: ArcPrim, out: Closest): number {
  let best = ptArc(p.sx, p.sy, q, out);
  let d = ptArc(p.ex, p.ey, q, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.ax, tmp.ay, tmp.bx, tmp.by);
  }
  d = ptArc(q.sx, q.sy, p, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  d = ptArc(q.ex, q.ey, p, tmp);
  if (d < best) {
    best = d;
    set(out, tmp.bx, tmp.by, tmp.ax, tmp.ay);
  }
  const vx = q.cx - p.cx;
  const vy = q.cy - p.cy;
  const D = Math.hypot(vx, vy);
  if (D < 1e-9) {
    // concentric: the gap is |r1 - r2| at any shared direction
    const dirs: [number, number][] = [
      [q.sx - q.cx, q.sy - q.cy],
      [q.ex - q.cx, q.ey - q.cy],
      [p.sx - p.cx, p.sy - p.cy],
      [p.ex - p.cx, p.ey - p.cy],
    ];
    for (const [ux, uy] of dirs) {
      const l = Math.hypot(ux, uy);
      if (l === 0) continue;
      const x1 = p.cx + (ux / l) * p.r;
      const y1 = p.cy + (uy / l) * p.r;
      const x2 = q.cx + (ux / l) * q.r;
      const y2 = q.cy + (uy / l) * q.r;
      if (inSpan(p, x1, y1) && inSpan(q, x2, y2)) {
        const g = Math.abs(p.r - q.r);
        if (g < best) {
          best = g;
          set(out, x1, y1, x2, y2);
        }
        break;
      }
    }
    return best;
  }
  const ux = vx / D;
  const uy = vy / D;
  for (const s1 of [1, -1]) {
    const x1 = p.cx + s1 * ux * p.r;
    const y1 = p.cy + s1 * uy * p.r;
    if (!inSpan(p, x1, y1)) continue;
    for (const s2 of [1, -1]) {
      const x2 = q.cx + s2 * ux * q.r;
      const y2 = q.cy + s2 * uy * q.r;
      if (!inSpan(q, x2, y2)) continue;
      const g = Math.hypot(x1 - x2, y1 - y2);
      if (g < best) {
        best = g;
        set(out, x1, y1, x2, y2);
      }
    }
  }
  if (best > 0 && D <= p.r + q.r && D >= Math.abs(p.r - q.r)) {
    // the circles meet: distance along the center line to the chord, then half the chord
    const along = (D * D + p.r * p.r - q.r * q.r) / (2 * D);
    const h = Math.sqrt(Math.max(0, p.r * p.r - along * along));
    const mx = p.cx + ux * along;
    const my = p.cy + uy * along;
    for (const sg of [1, -1]) {
      const x = mx - sg * uy * h;
      const y = my + sg * ux * h;
      if (inSpan(p, x, y) && inSpan(q, x, y)) {
        set(out, x, y, x, y);
        return 0;
      }
    }
  }
  return best;
}

/** The distance between any two primitives (closest pair in `out`, first primitive's point first). */
export function primDist(a: Prim, b: Prim, out: Closest): number {
  switch (a.t) {
    case "pt":
      if (b.t === "pt") return ptPt(a.x, a.y, b.x, b.y, out);
      if (b.t === "seg") return ptSeg(a.x, a.y, b.ax, b.ay, b.bx, b.by, out);
      return ptArc(a.x, a.y, b, out);
    case "seg":
      if (b.t === "seg") return segSeg(a, b, out);
      if (b.t === "arc") return segArc(a, b, out);
      return swap(ptSeg(b.x, b.y, a.ax, a.ay, a.bx, a.by, out), out);
    case "arc":
      if (b.t === "arc") return arcArc(a, b, out);
      if (b.t === "seg") return swap(segArc(b, a, out), out);
      return swap(ptArc(b.x, b.y, a, out), out);
  }
}

function swap(d: number, out: Closest): number {
  const { ax, ay } = out;
  out.ax = out.bx;
  out.ay = out.by;
  out.bx = ax;
  out.by = ay;
  return d;
}

/** The box of a primitive (an arc's box includes the axis extremes it passes). */
export function primBox(p: Prim): { minX: number; minY: number; maxX: number; maxY: number } {
  if (p.t === "pt") return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  if (p.t === "seg") return { minX: Math.min(p.ax, p.bx), minY: Math.min(p.ay, p.by), maxX: Math.max(p.ax, p.bx), maxY: Math.max(p.ay, p.by) };
  const b = { minX: Math.min(p.sx, p.ex), minY: Math.min(p.sy, p.ey), maxX: Math.max(p.sx, p.ex), maxY: Math.max(p.sy, p.ey) };
  const axes: [number, number][] = [
    [p.r, 0],
    [0, p.r],
    [-p.r, 0],
    [0, -p.r],
  ];
  for (const [dx, dy] of axes) {
    const x = p.cx + dx;
    const y = p.cy + dy;
    if (inSpan(p, x, y)) {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

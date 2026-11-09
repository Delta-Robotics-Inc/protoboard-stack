/**
 * Exact copper shapes and their polygon approximations.
 *
 * A `Shape` is the exact geometry of a piece of copper, a hole or an area, in board nanometers (floating point, not
 * rounded): a disc, a capsule (a segment grown by a radius: tracks, oval pads, slots), an arc band (a track arc), or
 * a region (a closed contour of straight edges and arcs, counterclockwise) grown by a radius (rectangles, rounded
 * rectangles, polygon pads, keep-outs, the board outline).
 *
 * Approximation (`shapeRings`): curves become straight segments within a stated maximum error. Copper and holes to
 * keep away from are approximated from the outside (circumscribed polygons, which contain the true curve), areas
 * the fill must stay inside (the board, the zone outline) from the inside. Distances (`distSegShape`,
 * `distPointShape`) are exact: verification measures against the true curves, never against an approximation.
 */
import type { Ring } from "./clip.js";

export const TAU = Math.PI * 2;

export interface LineEdge {
  t: "line";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface ArcEdge {
  t: "arc";
  cx: number;
  cy: number;
  r: number;
  /** Start angle, radians. */
  a0: number;
  /** Signed sweep, radians (positive counterclockwise). */
  sweep: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type ContourEdge = LineEdge | ArcEdge;

export type Shape =
  | { t: "disc"; cx: number; cy: number; r: number }
  | { t: "capsule"; x0: number; y0: number; x1: number; y1: number; r: number }
  | { t: "arcband"; arc: ArcEdge; r: number }
  | { t: "region"; edges: ContourEdge[]; r: number; convex: boolean };

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------- construction

/** An arc edge from a start point, an end point and a signed sweep in radians. */
export function arcEdge(x0: number, y0: number, x1: number, y1: number, sweep: number): ArcEdge | LineEdge {
  const chord = Math.hypot(x1 - x0, y1 - y0);
  if (chord === 0 || sweep === 0) return { t: "line", x0, y0, x1, y1 };
  const h = chord / 2 / Math.tan(sweep / 2);
  const cx = (x0 + x1) / 2 + (-(y1 - y0) / chord) * h;
  const cy = (y0 + y1) / 2 + ((x1 - x0) / chord) * h;
  const r = Math.hypot(x0 - cx, y0 - cy);
  return { t: "arc", cx, cy, r, a0: Math.atan2(y0 - cy, x0 - cx), sweep, x0, y0, x1, y1 };
}

/** A full circle as one arc edge (start and end at angle 0). */
export const circleEdge = (cx: number, cy: number, r: number): ArcEdge => ({ t: "arc", cx, cy, r, a0: 0, sweep: TAU, x0: cx + r, y0: cy, x1: cx + r, y1: cy });

const reverseEdge = (e: ContourEdge): ContourEdge =>
  e.t === "line" ? { t: "line", x0: e.x1, y0: e.y1, x1: e.x0, y1: e.y0 } : { ...e, a0: e.a0 + e.sweep, sweep: -e.sweep, x0: e.x1, y0: e.y1, x1: e.x0, y1: e.y0 };

/** Signed area of a contour of edges (arcs included). */
export function contourArea(edges: readonly ContourEdge[]): number {
  let s = 0;
  for (const e of edges) {
    s += (e.x0 * e.y1 - e.x1 * e.y0) / 2;
    if (e.t === "arc") s += ((e.r * e.r) / 2) * (e.sweep - Math.sin(e.sweep));
  }
  return s;
}

/** A region shape from contour edges: oriented counterclockwise, convexity noted. */
export function regionShape(edges: ContourEdge[], r = 0): Shape {
  let es = edges;
  if (contourArea(es) < 0) es = [...es].reverse().map(reverseEdge);
  let convex = es.every((e) => e.t === "line");
  if (convex) {
    const n = es.length;
    for (let i = 0; i < n && convex; i++) {
      const a = es[i];
      const b = es[(i + 1) % n];
      const cr = (a.x1 - a.x0) * (b.y1 - b.y0) - (a.y1 - a.y0) * (b.x1 - b.x0);
      if (cr < 0) convex = false;
    }
  }
  return { t: "region", edges: es, r, convex };
}

/** A contour of vertices with optional sweeps (millidegrees) as edges, through a point map. */
export function contourEdges(vertices: readonly { x: number; y: number; sweep?: number }[], map: (p: { x: number; y: number }) => { x: number; y: number } = (p) => p, mirrored = false): ContourEdge[] {
  const n = vertices.length;
  const pts = vertices.map(map);
  const out: ContourEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sw = vertices[i].sweep;
    if (a.x === b.x && a.y === b.y) continue;
    if (sw === undefined) out.push({ t: "line", x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    else out.push(arcEdge(a.x, a.y, b.x, b.y, ((mirrored ? -sw : sw) / 1000) * (Math.PI / 180)));
  }
  return out;
}

// ---------------------------------------------------------------- approximation

/** Steps for an arc of `sweep` radians on radius r so that the polygon is within `err` of the curve. */
export function arcSteps(r: number, sweep: number, err: number): number {
  const a = Math.abs(sweep);
  if (r <= 0 || a === 0) return 1;
  const step = r <= err ? Math.PI / 2 : 2 * Math.acos(r / (r + err));
  return Math.max(1, Math.ceil(a / Math.min(step, Math.PI / 2) - 1e-9));
}

/**
 * Points of a circumscribed polyline of an arc (it lies on or outside the circle, tangent at both ends): the exact
 * start and end points and, between them, corners at radius r / cos(step / 2).
 */
export function arcOutside(out: number[], cx: number, cy: number, r: number, a0: number, sweep: number, err: number, start = true, end = true): void {
  const n = arcSteps(r, sweep, err);
  const d = sweep / n;
  if (start) out.push(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  const R = r / Math.cos(d / 2);
  for (let i = 1; i <= n; i++) {
    const a = a0 + (i - 0.5) * d;
    out.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
  if (end) out.push(cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep));
}

/** Points of an inscribed polyline of an arc (chords: on or inside the circle). */
export function arcInside(out: number[], cx: number, cy: number, r: number, a0: number, sweep: number, err: number, start = true, end = true): void {
  const n = arcSteps(r, sweep, err);
  const d = sweep / n;
  for (let i = start ? 0 : 1; i <= (end ? n : n - 1); i++) out.push(cx + r * Math.cos(a0 + i * d), cy + r * Math.sin(a0 + i * d));
}

/** Round a float ring onto the nanometer grid, dropping repeated points; counterclockwise when `ccw`. */
export function roundRing(pts: readonly number[], ccw = true): Ring {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = Math.round(pts[i]);
    const y = Math.round(pts[i + 1]);
    const n = out.length;
    if (n && out[n - 2] === x && out[n - 1] === y) continue;
    out.push(x, y);
  }
  while (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.splice(out.length - 2, 2);
  if (ccw && signedArea(out) < 0) return reverseRing(out);
  return out;
}

export function signedArea(r: readonly number[]): number {
  const n = r.length >> 1;
  if (n < 3) return 0;
  let s = 0;
  const x0 = r[0];
  const y0 = r[1];
  for (let i = 1; i < n - 1; i++) s += (r[2 * i] - x0) * (r[2 * i + 3] - y0) - (r[2 * i + 2] - x0) * (r[2 * i + 1] - y0);
  return s / 2;
}

export function reverseRing(r: readonly number[]): Ring {
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
  return out;
}

/** A contour approximated from outside (`outside`: contains the true region) or inside (contained in it). */
export function contourPoints(edges: readonly ContourEdge[], err: number, outside: boolean): number[] {
  const out: number[] = [];
  for (const e of edges) {
    if (e.t === "line") {
      out.push(e.x0, e.y0);
      continue;
    }
    // in a counterclockwise contour a positive sweep bulges out (convex), a negative one in
    const convex = e.sweep > 0;
    if (convex === outside) arcOutside(out, e.cx, e.cy, e.r, e.a0, e.sweep, err, true, false);
    else arcInside(out, e.cx, e.cy, e.r, e.a0, e.sweep, err, true, false);
  }
  return out;
}

function capsulePoints(x0: number, y0: number, x1: number, y1: number, r: number, err: number): number[] {
  const out: number[] = [];
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L === 0) {
    discPoints(out, x0, y0, r, err);
    return out;
  }
  const th = Math.atan2(y1 - y0, x1 - x0);
  arcOutside(out, x1, y1, r, th - Math.PI / 2, Math.PI, err);
  arcOutside(out, x0, y0, r, th + Math.PI / 2, Math.PI, err);
  return out;
}

function discPoints(out: number[], cx: number, cy: number, r: number, err: number): void {
  const n = Math.max(4, arcSteps(r, TAU, err));
  const d = TAU / n;
  const R = r / Math.cos(d / 2);
  for (let i = 0; i < n; i++) out.push(cx + R * Math.cos((i + 0.5) * d), cy + R * Math.sin((i + 0.5) * d));
}

/** A convex counterclockwise polygon grown by rho with round corners (circumscribed): one ring. */
function convexGrown(pts: readonly number[], rho: number, err: number): number[] {
  const n = pts.length >> 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const vx = pts[2 * i];
    const vy = pts[2 * i + 1];
    const a1 = Math.atan2(vy - pts[2 * p + 1], vx - pts[2 * p]) - Math.PI / 2;
    const a2 = Math.atan2(pts[2 * q + 1] - vy, pts[2 * q] - vx) - Math.PI / 2;
    let sw = a2 - a1;
    while (sw < 0) sw += TAU;
    while (sw >= TAU) sw -= TAU;
    if (sw < 1e-12) out.push(vx + rho * Math.cos(a1), vy + rho * Math.sin(a1));
    else arcOutside(out, vx, vy, rho, a1, sw, err);
  }
  return out;
}

/**
 * Rings whose union contains the shape grown by `grow` (nanometers), every curve approximated from the outside
 * within `err`. Counterclockwise, on the integer grid (rounding moves a point by at most 0.71 nm; callers add a
 * margin larger than that).
 */
export function shapeRings(s: Shape, grow: number, err: number): Ring[] {
  switch (s.t) {
    case "disc": {
      const out: number[] = [];
      discPoints(out, s.cx, s.cy, s.r + grow, err);
      return [roundRing(out)];
    }
    case "capsule":
      return [roundRing(capsulePoints(s.x0, s.y0, s.x1, s.y1, s.r + grow, err))];
    case "arcband": {
      const h = s.r + grow;
      const a = s.arc;
      const a0 = a.sweep > 0 ? a.a0 : a.a0 + a.sweep;
      const sw = Math.abs(a.sweep);
      const out: number[] = [];
      arcOutside(out, a.cx, a.cy, a.r + h, a0, sw, err);
      if (a.r - h > 0) arcInside(out, a.cx, a.cy, a.r - h, a0 + sw, -sw, err);
      else out.push(a.cx, a.cy);
      const e0: number[] = [];
      const e1: number[] = [];
      discPoints(e0, a.x0, a.y0, h, err);
      discPoints(e1, a.x1, a.y1, h, err);
      return [roundRing(out), roundRing(e0), roundRing(e1)];
    }
    case "region": {
      const rho = s.r + grow;
      const poly = contourPoints(s.edges, err, true);
      if (rho <= 0) return [roundRing(poly)];
      if (s.convex && poly.length >= 6) return [roundRing(convexGrown(poly, rho, err))];
      const rings = [roundRing(poly)];
      const n = poly.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        rings.push(roundRing(capsulePoints(poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1], rho, err)));
      }
      return rings;
    }
  }
}

/** A region approximated from the inside (for areas the fill must stay within), counterclockwise. */
export function regionInsideRing(s: Extract<Shape, { t: "region" }>, err: number): Ring {
  return roundRing(contourPoints(s.edges, err, false));
}

/** Capsule rings along every edge of a ring (its band of half width `rho`). */
export function edgeBandRings(ring: Ring, rho: number, err: number): Ring[] {
  const n = ring.length >> 1;
  const out: Ring[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(roundRing(capsulePoints(ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1], rho, err)));
  }
  return out;
}

// ---------------------------------------------------------------- boxes

export function shapeBox(s: Shape): Box {
  switch (s.t) {
    case "disc":
      return { minX: s.cx - s.r, minY: s.cy - s.r, maxX: s.cx + s.r, maxY: s.cy + s.r };
    case "capsule":
      return { minX: Math.min(s.x0, s.x1) - s.r, minY: Math.min(s.y0, s.y1) - s.r, maxX: Math.max(s.x0, s.x1) + s.r, maxY: Math.max(s.y0, s.y1) + s.r };
    case "arcband": {
      const a = s.arc;
      const R = a.r + s.r;
      return { minX: a.cx - R, minY: a.cy - R, maxX: a.cx + R, maxY: a.cy + R };
    }
    case "region": {
      const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const e of s.edges) {
        if (e.t === "line") {
          grow(b, e.x0, e.y0, 0);
        } else grow(b, e.cx, e.cy, e.r);
      }
      return { minX: b.minX - s.r, minY: b.minY - s.r, maxX: b.maxX + s.r, maxY: b.maxY + s.r };
    }
  }
}
function grow(b: Box, x: number, y: number, r: number): void {
  if (x - r < b.minX) b.minX = x - r;
  if (y - r < b.minY) b.minY = y - r;
  if (x + r > b.maxX) b.maxX = x + r;
  if (y + r > b.maxY) b.maxY = y + r;
}
export const boxesMeet = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
export const inflateBox = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });

// ---------------------------------------------------------------- exact distances

export function distPointSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - x0) * dx + (py - y0) * dy) / L2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function segsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

export function distSegSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(distPointSeg(ax, ay, cx, cy, dx, dy), distPointSeg(bx, by, cx, cy, dx, dy), distPointSeg(cx, cy, ax, ay, bx, by), distPointSeg(dx, dy, ax, ay, bx, by));
}

/** Whether angle `a` lies within the arc's sweep. */
function onArc(arc: ArcEdge, a: number): boolean {
  if (Math.abs(arc.sweep) >= TAU) return true;
  let d = a - arc.a0;
  if (arc.sweep > 0) {
    d = ((d % TAU) + TAU) % TAU;
    return d <= arc.sweep;
  }
  d = ((-d % TAU) + TAU) % TAU;
  return d <= -arc.sweep;
}

export function distPointArc(px: number, py: number, arc: ArcEdge): number {
  const a = Math.atan2(py - arc.cy, px - arc.cx);
  if (onArc(arc, a)) return Math.abs(Math.hypot(px - arc.cx, py - arc.cy) - arc.r);
  return Math.min(Math.hypot(px - arc.x0, py - arc.y0), Math.hypot(px - arc.x1, py - arc.y1));
}

export function distSegArc(ax: number, ay: number, bx: number, by: number, arc: ArcEdge): number {
  let best = Math.min(distPointArc(ax, ay, arc), distPointArc(bx, by, arc), distPointSeg(arc.x0, arc.y0, ax, ay, bx, by), distPointSeg(arc.x1, arc.y1, ax, ay, bx, by));
  // the segment's closest point to the center, when the segment lies outside the circle there
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 > 0) {
    let t = ((arc.cx - ax) * dx + (arc.cy - ay) * dy) / L2;
    if (t > 0 && t < 1) {
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const dc = Math.hypot(qx - arc.cx, qy - arc.cy);
      if (dc >= arc.r && onArc(arc, Math.atan2(qy - arc.cy, qx - arc.cx))) best = Math.min(best, dc - arc.r);
    }
    // crossings of the circle that lie on the arc
    const fx = ax - arc.cx;
    const fy = ay - arc.cy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - arc.r * arc.r;
    const disc = B * B - 4 * L2 * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const s of [(-B - sq) / (2 * L2), (-B + sq) / (2 * L2)]) {
        if (s < 0 || s > 1) continue;
        t = s;
        if (onArc(arc, Math.atan2(ay + t * dy - arc.cy, ax + t * dx - arc.cx))) return 0;
      }
    }
  }
  return best;
}

/** Distance from a point to a contour edge. */
export const distPointEdge = (px: number, py: number, e: ContourEdge): number => (e.t === "line" ? distPointSeg(px, py, e.x0, e.y0, e.x1, e.y1) : distPointArc(px, py, e));
/** Distance from a segment to a contour edge. */
export const distSegEdge = (ax: number, ay: number, bx: number, by: number, e: ContourEdge): number => (e.t === "line" ? distSegSeg(ax, ay, bx, by, e.x0, e.y0, e.x1, e.y1) : distSegArc(ax, ay, bx, by, e));

/** Even-odd containment in a contour, its arcs flattened to 1 nm (only decides points not on the boundary). */
export function pointInContour(edges: readonly ContourEdge[], px: number, py: number): boolean {
  let inside = false;
  const test = (ax: number, ay: number, bx: number, by: number) => {
    if (ay > py === by > py) return;
    const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
    if (px < x) inside = !inside;
  };
  for (const e of edges) {
    if (e.t === "line") test(e.x0, e.y0, e.x1, e.y1);
    else {
      // only arcs whose circle reaches the point's row matter
      if (py < e.cy - e.r - 1 || py > e.cy + e.r + 1) {
        test(e.x0, e.y0, e.x1, e.y1);
        continue;
      }
      const pts: number[] = [];
      arcInside(pts, e.cx, e.cy, e.r, e.a0, e.sweep, 1);
      for (let i = 0; i + 3 < pts.length; i += 2) test(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    }
  }
  return inside;
}

/** Distance from a point to a shape (negative inside: minus the depth for discs, capsules and bands; regions give 0 inside... see below). */
export function distPointShape(px: number, py: number, s: Shape): number {
  switch (s.t) {
    case "disc":
      return Math.hypot(px - s.cx, py - s.cy) - s.r;
    case "capsule":
      return distPointSeg(px, py, s.x0, s.y0, s.x1, s.y1) - s.r;
    case "arcband":
      return distPointArc(px, py, s.arc) - s.r;
    case "region": {
      if (pointInContour(s.edges, px, py)) return -s.r;
      let d = Infinity;
      for (const e of s.edges) d = Math.min(d, distPointEdge(px, py, e));
      return d - s.r;
    }
  }
}

/** Distance from a segment to a shape (0 or negative when they overlap). Exact for every shape kind. */
export function distSegShape(ax: number, ay: number, bx: number, by: number, s: Shape): number {
  switch (s.t) {
    case "disc":
      return distPointSeg(s.cx, s.cy, ax, ay, bx, by) - s.r;
    case "capsule":
      return distSegSeg(ax, ay, bx, by, s.x0, s.y0, s.x1, s.y1) - s.r;
    case "arcband":
      return distSegArc(ax, ay, bx, by, s.arc) - s.r;
    case "region": {
      if (pointInContour(s.edges, ax, ay) || pointInContour(s.edges, bx, by)) return -s.r;
      let d = Infinity;
      for (const e of s.edges) {
        d = Math.min(d, distSegEdge(ax, ay, bx, by, e));
        if (d === 0) break;
      }
      return d - s.r;
    }
  }
}

/** A point inside the shape (its center or first vertex region), for containment checks. */
export function shapeAnchor(s: Shape): { x: number; y: number } {
  switch (s.t) {
    case "disc":
      return { x: s.cx, y: s.cy };
    case "capsule":
      return { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 };
    case "arcband": {
      const a = s.arc.a0 + s.arc.sweep / 2;
      return { x: s.arc.cx + s.arc.r * Math.cos(a), y: s.arc.cy + s.arc.r * Math.sin(a) };
    }
    case "region": {
      // the centroid of the vertices when inside, else a point just inside the first edge
      let x = 0;
      let y = 0;
      for (const e of s.edges) {
        x += e.x0;
        y += e.y0;
      }
      x /= s.edges.length;
      y /= s.edges.length;
      if (pointInContour(s.edges, x, y)) return { x, y };
      const e = s.edges[0];
      const mx = (e.x0 + e.x1) / 2;
      const my = (e.y0 + e.y1) / 2;
      const L = Math.hypot(e.x1 - e.x0, e.y1 - e.y0) || 1;
      return { x: mx - ((e.y1 - e.y0) / L) * 1, y: my + ((e.x1 - e.x0) / L) * 1 };
    }
  }
}

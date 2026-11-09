/**
 * Triangulation of a polygon with holes by ear clipping, each hole joined to the outer ring by a bridge from its
 * leftmost point to a visible vertex on its left (the classic method). Points on an edge of a candidate ear block it,
 * so collinear corner points stay in the triangulation and the caps of a solid share every boundary point with its
 * side faces (no T-junctions). A uniform grid keeps the ear test close to linear.
 */
import type { Vec2 } from "./math.js";
import { polygonArea } from "./profile.js";

interface Node {
  i: number;
  x: number;
  y: number;
  prev: Node;
  next: Node;
  removed: boolean;
}

/** Twice the signed area of a, b, c: positive for a left turn (counterclockwise, Y up). */
const area2 = (a: Node, b: Node, c: Node): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: Node, b: Node): boolean => a.x === b.x && a.y === b.y;

function ring(points: readonly Vec2[], offset: number, ccw: boolean): Node {
  const idx = points.map((_, k) => k);
  if (polygonArea(points) > 0 !== ccw) idx.reverse();
  let first: Node | undefined;
  let last: Node | undefined;
  for (const k of idx) {
    const n = { i: offset + k, x: points[k][0], y: points[k][1], removed: false } as Node;
    if (!first) {
      first = n;
      n.prev = n;
      n.next = n;
    } else {
      n.prev = last!;
      n.next = last!.next;
      last!.next.prev = n;
      last!.next = n;
    }
    last = n;
  }
  return first!;
}

/** Inside or on the boundary of a counterclockwise triangle. */
function inCcwTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0 && (cx - bx) * (py - by) - (cy - by) * (px - bx) >= 0 && (ax - cx) * (py - cy) - (ay - cy) * (px - cx) >= 0;
}
/** Inside or on the boundary of a triangle of either orientation. */
function inTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return d >= 0 ? inCcwTri(ax, ay, bx, by, cx, cy, px, py) : inCcwTri(ax, ay, cx, cy, bx, by, px, py);
}

/** Whether the diagonal from a toward b starts inside the polygon at a. */
function locallyInside(a: Node, b: Node): boolean {
  return area2(a.prev, a, a.next) > 0 ? area2(a, b, a.next) <= 0 && area2(a, a.prev, b) <= 0 : area2(a, b, a.prev) > 0 || area2(a, a.next, b) > 0;
}

/** A vertex of the outer ring visible from the hole point h, found with a ray to -x. */
function findBridge(h: Node, outer: Node): Node | undefined {
  let p = outer;
  const hx = h.x;
  const hy = h.y;
  let qx = -Infinity;
  let m: Node | undefined;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return undefined;
  // a vertex inside the triangle (h, ray hit, m) would hide m: take the one at the smallest angle to the ray
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && inTri(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, h) && (tan < tanMin || (tan === tanMin && p.x > m.x))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

/** Bridge a (outer) to b (hole): a -> b ... hole ... b' -> a' -> a.next. */
function join(a: Node, b: Node): void {
  const a2 = { i: a.i, x: a.x, y: a.y, removed: false } as Node;
  const b2 = { i: b.i, x: b.x, y: b.y, removed: false } as Node;
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
}

function leftmost(h: Node): Node {
  let l = h;
  let p = h.next;
  do {
    if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p;
    p = p.next;
  } while (p !== h);
  return l;
}

/**
 * Triangulate `outer` with `holes`. Returns index triples into the concatenation [outer, ...holes], counterclockwise
 * seen from +Z when `ccw` is true, else clockwise. Ring orientation of the input does not matter.
 */
export function triangulate(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[] = [], ccw = true): number[] {
  const out: number[] = [];
  if (outer.length < 3) return out;
  let offset = outer.length;
  const root = ring(outer, 0, true);
  const hs: Node[] = [];
  for (const h of holes) {
    if (h.length >= 3) hs.push(leftmost(ring(h, offset, false)));
    offset += h.length;
  }
  hs.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const h of hs) {
    const v = findBridge(h, root);
    if (v) join(v, h);
  }
  clip(root, out);
  if (!ccw) for (let k = 0; k < out.length; k += 3) [out[k + 1], out[k + 2]] = [out[k + 2], out[k + 1]];
  return out;
}

function clip(start: Node, out: number[]): void {
  const nodes: Node[] = [];
  let p = start;
  do {
    nodes.push(p);
    p = p.next;
  } while (p !== start);
  let count = nodes.length;
  if (count < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const g = Math.max(1, Math.ceil(Math.sqrt(count / 2)));
  const cw = (maxX - minX) / g || 1;
  const ch = (maxY - minY) / g || 1;
  const ci = (x: number) => Math.min(g - 1, Math.max(0, Math.floor((x - minX) / cw)));
  const cj = (y: number) => Math.min(g - 1, Math.max(0, Math.floor((y - minY) / ch)));
  const grid: Node[][] = Array.from({ length: g * g }, () => []);
  for (const n of nodes) grid[ci(n.x) + cj(n.y) * g].push(n);

  const isEar = (e: Node): boolean => {
    const a = e.prev;
    const c = e.next;
    if (area2(a, e, c) <= 0) return false;
    const x0 = Math.min(a.x, e.x, c.x);
    const x1 = Math.max(a.x, e.x, c.x);
    const y0 = Math.min(a.y, e.y, c.y);
    const y1 = Math.max(a.y, e.y, c.y);
    for (let j = cj(y0), j1 = cj(y1); j <= j1; j++) {
      for (let i = ci(x0), i1 = ci(x1); i <= i1; i++) {
        for (const q of grid[i + j * g]) {
          if (q.removed || q === a || q === e || q === c || same(q, a) || same(q, e) || same(q, c)) continue;
          if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) continue;
          if (inCcwTri(a.x, a.y, e.x, e.y, c.x, c.y, q.x, q.y)) return false;
        }
      }
    }
    return true;
  };
  const unlink = (e: Node, emit: boolean) => {
    if (emit) out.push(e.prev.i, e.i, e.next.i);
    e.prev.next = e.next;
    e.next.prev = e.prev;
    e.removed = true;
    count--;
  };
  let ear = start;
  let stall = 0;
  // pass 0: clean ears; 1: any convex corner; 2: anything (bad input keeps going and still ends)
  let pass = 0;
  while (count > 2) {
    const next = ear.next;
    const turn = area2(ear.prev, ear, next);
    if ((pass === 0 && isEar(ear)) || (pass === 1 && turn > 0) || pass === 2) {
      unlink(ear, turn > 0 || pass < 2);
      ear = next;
      stall = 0;
      pass = 0;
      continue;
    }
    ear = next;
    if (++stall >= count) {
      pass = Math.min(2, pass + 1);
      stall = 0;
    }
  }
}

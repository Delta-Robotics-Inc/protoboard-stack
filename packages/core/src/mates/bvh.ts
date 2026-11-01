/**
 * A triangle bounding-volume hierarchy for static interference on the CLI
 * (PB-1185). Written here rather than taking three-mesh-bvh into core: that
 * package is a uhd-viewer dependency only, and core has no three.js (DEFAULT:
 * no new stack dependency; see dependencies.md, W4-E). The methods are the
 * textbook ones, written from their descriptions:
 *
 * - build: spatial-median split on the longest axis of the triangle centroids'
 *   bounds, leaves of at most LEAF triangles;
 * - two-tree overlap: both trees descended together, the other tree's boxes
 *   carried into this tree's frame by the relative transform (a conservative
 *   box), triangle pairs tested at the leaves;
 * - triangle-triangle: each triangle against the other's plane, then the two
 *   intervals on the planes' common line (the separating-plane method);
 *   coplanar pairs are tested in 2D (edge crossings, then containment);
 * - inside: parity of ray crossings, majority over three skew rays;
 * - closest distance: branch and bound over boxes, the closest point on each
 *   triangle by its Voronoi regions.
 *
 * Coordinates are whatever the caller gives (mm, Z up, body frame here).
 */
import type { M4 } from "./frames.js";

const LEAF = 8;
const EPS = 1e-9;

export class TriBVH {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Triangle ids in leaf order. */
  readonly order: Uint32Array;
  /** Per node: minx, miny, minz, maxx, maxy, maxz. */
  boxes: Float32Array;
  /** Per node: left child (inner) or first slot in `order` (leaf). */
  first: Uint32Array;
  /** Per node: 0 for an inner node (children `first` and `right`), else the leaf's triangle count. */
  count: Uint32Array;
  right: Uint32Array;
  nodes = 0;
  readonly triangles: number;

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions;
    this.indices = indices;
    const n = (this.triangles = indices.length / 3);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const cap = Math.max(16, Math.ceil((2 * n) / LEAF) + 16);
    this.boxes = new Float32Array(cap * 6);
    this.first = new Uint32Array(cap);
    this.count = new Uint32Array(cap);
    this.right = new Uint32Array(cap);
    const cen = new Float32Array(n * 3);
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) cen[t * 3 + k] = (positions[indices[t * 3] * 3 + k] + positions[indices[t * 3 + 1] * 3 + k] + positions[indices[t * 3 + 2] * 3 + k]) / 3;
    if (n) this.build(cen);
  }

  private grow() {
    const cap = this.first.length * 2;
    const b = new Float32Array(cap * 6);
    b.set(this.boxes);
    this.boxes = b;
    for (const k of ["first", "count", "right"] as const) {
      const a = new Uint32Array(cap);
      a.set(this[k]);
      this[k] = a;
    }
  }

  private build(cen: Float32Array) {
    const stack: [number, number, number][] = [[this.newNode(), 0, this.triangles]];
    while (stack.length) {
      const [node, start, end] = stack.pop()!;
      this.fitBox(node, start, end);
      const cnt = end - start;
      if (cnt <= LEAF) {
        this.first[node] = start;
        this.count[node] = cnt;
        continue;
      }
      // centroid bounds, longest axis, spatial median; a degenerate split falls back to halves
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++) {
        const t = this.order[i];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], cen[t * 3 + k]);
          hi[k] = Math.max(hi[k], cen[t * 3 + k]);
        }
      }
      const ax = hi[0] - lo[0] >= hi[1] - lo[1] && hi[0] - lo[0] >= hi[2] - lo[2] ? 0 : hi[1] - lo[1] >= hi[2] - lo[2] ? 1 : 2;
      const mid = (lo[ax] + hi[ax]) / 2;
      let i = start, j = end - 1;
      while (i <= j) {
        if (cen[this.order[i] * 3 + ax] < mid) i++;
        else {
          const tmp = this.order[i];
          this.order[i] = this.order[j];
          this.order[j] = tmp;
          j--;
        }
      }
      let split = i;
      if (split === start || split === end) split = (start + end) >> 1;
      const l = this.newNode();
      const r = this.newNode();
      this.first[node] = l;
      this.right[node] = r;
      this.count[node] = 0;
      stack.push([l, start, split], [r, split, end]);
    }
  }

  private newNode(): number {
    if (this.nodes >= this.first.length) this.grow();
    return this.nodes++;
  }

  private fitBox(node: number, start: number, end: number) {
    const b = this.boxes;
    const o = node * 6;
    b[o] = b[o + 1] = b[o + 2] = Infinity;
    b[o + 3] = b[o + 4] = b[o + 5] = -Infinity;
    const P = this.positions, I = this.indices;
    for (let i = start; i < end; i++) {
      const t = this.order[i];
      for (let c = 0; c < 3; c++) {
        const v = I[t * 3 + c] * 3;
        for (let k = 0; k < 3; k++) {
          if (P[v + k] < b[o + k]) b[o + k] = P[v + k];
          if (P[v + k] > b[o + 3 + k]) b[o + 3 + k] = P[v + k];
        }
      }
    }
  }

  /** The whole mesh's box: [minx, miny, minz, maxx, maxy, maxz]. */
  get bounds(): number[] {
    return this.nodes ? Array.from(this.boxes.subarray(0, 6)) : [0, 0, 0, 0, 0, 0];
  }

  tri(t: number, out: number[][]): number[][] {
    const P = this.positions, I = this.indices;
    for (let c = 0; c < 3; c++) {
      const v = I[t * 3 + c] * 3;
      out[c][0] = P[v];
      out[c][1] = P[v + 1];
      out[c][2] = P[v + 2];
    }
    return out;
  }

  /**
   * Triangle pairs where `other` (carried into this frame by `m`, row-major)
   * touches or crosses this mesh. Stops after `maxHits`. Returns the hits and
   * a point (this frame) at each.
   */
  intersects(other: TriBVH, m: M4, maxHits = 1): { hits: number; points: number[][]; pairs: number } {
    const points: number[][] = [];
    let hits = 0;
    let pairs = 0;
    if (!this.nodes || !other.nodes) return { hits, points, pairs };
    const box = new Float32Array(6);
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const stack: number[] = [0, 0];
    while (stack.length && hits < maxHits) {
      const nb = stack.pop()!;
      const na = stack.pop()!;
      transformBox(other.boxes, nb * 6, m, box);
      if (!overlap(this.boxes, na * 6, box)) continue;
      const leafA = this.count[na] > 0, leafB = other.count[nb] > 0;
      if (leafA && leafB) {
        for (let i = this.first[na]; i < this.first[na] + this.count[na] && hits < maxHits; i++) {
          this.tri(this.order[i], A);
          for (let j = other.first[nb]; j < other.first[nb] + other.count[nb]; j++) {
            other.tri(other.order[j], B);
            for (let c = 0; c < 3; c++) B[c] = applyRM(m, B[c]);
            pairs++;
            if (triTri(A[0], A[1], A[2], B[0], B[1], B[2])) {
              hits++;
              points.push([(A[0][0] + A[1][0] + A[2][0]) / 3, (A[0][1] + A[1][1] + A[2][1]) / 3, (A[0][2] + A[1][2] + A[2][2]) / 3]);
              if (hits >= maxHits) break;
            }
          }
        }
        continue;
      }
      // descend the bigger node (or the inner one)
      const volA = vol(this.boxes, na * 6), volB = vol(box, 0);
      if (!leafA && (leafB || volA >= volB)) stack.push(this.first[na], nb, this.right[na], nb);
      else stack.push(na, other.first[nb], na, other.right[nb]);
    }
    return { hits, points, pairs };
  }

  /** Number of crossings of the ray p + s d (s > 0). */
  private crossings(p: number[], d: number[]): number {
    let n = 0;
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (!rayBox(this.boxes, node * 6, p, inv)) continue;
      if (this.count[node] > 0) {
        for (let i = this.first[node]; i < this.first[node] + this.count[node]; i++) if (rayTri(p, d, this.tri(this.order[i], T))) n++;
      } else stack.push(this.first[node], this.right[node]);
    }
    return n;
  }

  /** Inside by ray parity, majority of three skew rays (robust to one ray grazing an edge). Meaningful for closed meshes. */
  inside(p: number[]): boolean {
    if (!this.nodes || !overlap(this.boxes, 0, new Float32Array([p[0], p[1], p[2], p[0], p[1], p[2]]))) return false;
    let odd = 0;
    for (const d of RAYS) if (this.crossings(p, d) % 2 === 1) odd++;
    return odd >= 2;
  }

  /** Distance from `p` to the mesh surface. */
  closest(p: number[], limit = Infinity): number {
    let best = limit;
    if (!this.nodes) return best;
    const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (boxDist(this.boxes, node * 6, p) >= best) continue;
      if (this.count[node] > 0) {
        for (let i = this.first[node]; i < this.first[node] + this.count[node]; i++) {
          const d = pointTriDist(p, this.tri(this.order[i], T));
          if (d < best) best = d;
        }
      } else {
        const l = this.first[node], r = this.right[node];
        const dl = boxDist(this.boxes, l * 6, p), dr = boxDist(this.boxes, r * 6, p);
        if (dl < dr) stack.push(r, l);
        else stack.push(l, r);
      }
    }
    return best;
  }
}

const RAYS = [
  [0.577, 0.5774, 0.5776],
  [-0.5771, 0.8165, 0.0023],
  [0.0031, -0.7071, -0.7071],
].map((d) => {
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
});

export const applyRM = (m: readonly number[], p: readonly number[]): number[] => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];

/** A box carried through a row-major affine matrix: the box of its image (centre and absolute-rotated extents). */
function transformBox(src: Float32Array, o: number, m: readonly number[], out: Float32Array) {
  const c = [(src[o] + src[o + 3]) / 2, (src[o + 1] + src[o + 4]) / 2, (src[o + 2] + src[o + 5]) / 2];
  const e = [(src[o + 3] - src[o]) / 2, (src[o + 4] - src[o + 1]) / 2, (src[o + 5] - src[o + 2]) / 2];
  for (let r = 0; r < 3; r++) {
    const cc = m[r * 4] * c[0] + m[r * 4 + 1] * c[1] + m[r * 4 + 2] * c[2] + m[r * 4 + 3];
    const ee = Math.abs(m[r * 4]) * e[0] + Math.abs(m[r * 4 + 1]) * e[1] + Math.abs(m[r * 4 + 2]) * e[2];
    out[r] = cc - ee;
    out[r + 3] = cc + ee;
  }
}
const overlap = (a: Float32Array, o: number, b: Float32Array) => a[o] <= b[3] && b[0] <= a[o + 3] && a[o + 1] <= b[4] && b[1] <= a[o + 4] && a[o + 2] <= b[5] && b[2] <= a[o + 5];
const vol = (a: Float32Array, o: number) => (a[o + 3] - a[o]) * (a[o + 4] - a[o + 1]) * (a[o + 5] - a[o + 2]);
function boxDist(b: Float32Array, o: number, p: number[]) {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = p[k] < b[o + k] ? b[o + k] - p[k] : p[k] > b[o + 3 + k] ? p[k] - b[o + 3 + k] : 0;
    s += d * d;
  }
  return Math.sqrt(s);
}
function rayBox(b: Float32Array, o: number, p: number[], inv: number[]) {
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    let a = (b[o + k] - p[k]) * inv[k], c = (b[o + 3 + k] - p[k]) * inv[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Ray (s > 0) against a triangle, by barycentric solve. */
function rayTri(p: number[], d: number[], t: number[][]): boolean {
  const e1 = sub(t[1], t[0]), e2 = sub(t[2], t[0]);
  const h = crs(d, e2);
  const a = dt(e1, h);
  if (Math.abs(a) < 1e-12) return false;
  const f = 1 / a;
  const s = sub(p, t[0]);
  const u = f * dt(s, h);
  if (u < 0 || u > 1) return false;
  const q = crs(s, e1);
  const v = f * dt(d, q);
  if (v < 0 || u + v > 1) return false;
  return f * dt(e2, q) > 1e-9;
}

/** Interval of a triangle on the line where it crosses the other plane: projections of the crossing points on axis `ax`. */
function interval(v: number[][], d: number[], ax: number): [number, number] | undefined {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (d[i] === 0) {
      lo = Math.min(lo, v[i][ax]);
      hi = Math.max(hi, v[i][ax]);
    }
    if ((d[i] < 0 && d[j] > 0) || (d[i] > 0 && d[j] < 0)) {
      const x = v[i][ax] + ((v[j][ax] - v[i][ax]) * d[i]) / (d[i] - d[j]);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** Signed distances of a triangle's corners to a plane, snapped to 0 within a size-relative epsilon. */
function sides(v: number[][], n: number[], d: number, scale: number): number[] {
  const out = v.map((p) => dt(n, p) + d);
  const eps = EPS * scale;
  return out.map((x) => (Math.abs(x) < eps ? 0 : x));
}

/** Do two triangles touch or cross? */
export function triTri(a0: number[], a1: number[], a2: number[], b0: number[], b1: number[], b2: number[]): boolean {
  const A = [a0, a1, a2], B = [b0, b1, b2];
  const nb = crs(sub(b1, b0), sub(b2, b0));
  const scaleB = Math.max(1e-12, Math.hypot(nb[0], nb[1], nb[2]));
  const da = sides(A, nb, -dt(nb, b0), scaleB * 1e3);
  if ((da[0] > 0 && da[1] > 0 && da[2] > 0) || (da[0] < 0 && da[1] < 0 && da[2] < 0)) return false;
  const na = crs(sub(a1, a0), sub(a2, a0));
  const scaleA = Math.max(1e-12, Math.hypot(na[0], na[1], na[2]));
  const db = sides(B, na, -dt(na, a0), scaleA * 1e3);
  if ((db[0] > 0 && db[1] > 0 && db[2] > 0) || (db[0] < 0 && db[1] < 0 && db[2] < 0)) return false;
  if (da[0] === 0 && da[1] === 0 && da[2] === 0) return coplanar(A, B, na);
  const L = crs(na, nb);
  const ax = Math.abs(L[0]) >= Math.abs(L[1]) && Math.abs(L[0]) >= Math.abs(L[2]) ? 0 : Math.abs(L[1]) >= Math.abs(L[2]) ? 1 : 2;
  const ia = interval(A, da, ax), ib = interval(B, db, ax);
  if (!ia || !ib) return false;
  return Math.max(ia[0], ib[0]) <= Math.min(ia[1], ib[1]);
}

function coplanar(A: number[][], B: number[][], n: number[]): boolean {
  // drop the normal's largest axis
  const k = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const [x, y] = k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
  const a = A.map((p) => [p[x], p[y]]), b = B.map((p) => [p[x], p[y]]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (segs(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3])) return true;
  return inTri2(a[0], b) || inTri2(b[0], a);
}
const orient = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
function segs(p1: number[], p2: number[], q1: number[], q2: number[]) {
  const d1 = orient(q1, q2, p1), d2 = orient(q1, q2, p2), d3 = orient(p1, p2, q1), d4 = orient(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function inTri2(p: number[], t: number[][]) {
  const s1 = orient(t[0], t[1], p), s2 = orient(t[1], t[2], p), s3 = orient(t[2], t[0], p);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/** Distance from a point to a triangle, by the region of the triangle's plane the point projects into. */
export function pointTriDist(p: number[], t: number[][]): number {
  const [a, b, c] = t;
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dt(ab, ap), d2 = dt(ac, ap);
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dt(ab, bp), d4 = dt(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
      } else {
        const cp = sub(p, c);
        const d5 = dt(ab, cp), d6 = dt(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den, w = vc * den;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

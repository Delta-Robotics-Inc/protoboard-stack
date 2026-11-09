/**
 * A polygon boolean engine on the integer nanometer grid, written for fill computation.
 *
 * Input: operands, each a set of rings (flat `x0, y0, x1, y1, ...` integer arrays, implicitly closed) read with a
 * fill rule (`nonzero`, or `positive` for raw offset curves). Output: the region where a predicate over the
 * operands' insideness holds, as polygons with a counterclockwise outer ring and clockwise holes.
 *
 * Method (standard computational geometry, no third-party code):
 * 1. every ring edge goes into a uniform grid; each pair sharing a cell is tested with exact orientation
 *    predicates; crossings are split at the intersection rounded to the nearest nanometer, touching and
 *    overlapping edges at the shared end points. Splitting repeats until no two edges cross (rounding can make a
 *    new crossing; a pass only retests edges that changed), so the arrangement is planar on the integer grid;
 * 2. identical edges merge and carry a winding change per operand;
 * 3. each edge's winding on both sides comes from a ray cast from its midpoint (down, or left for vertical
 *    edges) over a strip index, with exact predicates on doubled coordinates;
 * 4. edges whose two sides differ under the predicate are the result's boundary, directed with the result on
 *    their left; they are linked into rings by taking, at every vertex, the next edge clockwise, so rings that
 *    touch at a point come out as separate rings;
 * 5. rings with positive area are outer rings; each hole goes to the smallest outer ring that contains it.
 *
 * Rounding moves a vertex by at most half a nanometer per axis; callers expand clearances by a margin larger than
 * that, so the result never comes closer than they asked.
 */
import { crossSign, dotSign, orient } from "./exact.js";

/** A ring: x0, y0, x1, y1, ... integer nanometers, implicitly closed. */
export type Ring = number[];
export interface Polygon {
  /** Counterclockwise. */
  outer: Ring;
  /** Clockwise. */
  holes: Ring[];
}
export type FillRule = "nonzero" | "positive";
export interface Operand {
  rings: readonly Ring[];
  rule?: FillRule;
}

export class ClipError extends Error {
  /** The operands of the failing call, for diagnosis. */
  operands?: readonly Operand[];
}

interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  op: number;
  s: number;
  fresh: boolean;
}

function pushEdge(out: Edge[], x0: number, y0: number, x1: number, y1: number, op: number, s: number, fresh: boolean): void {
  if (x0 === x1 && y0 === y1) return;
  if (x0 < x1 || (x0 === x1 && y0 < y1)) out.push({ ax: x0, ay: y0, bx: x1, by: y1, op, s, fresh });
  else out.push({ ax: x1, ay: y1, bx: x0, by: y0, op, s: -s, fresh });
}

function addRing(out: Edge[], ring: readonly number[], op: number): void {
  const n = ring.length >> 1;
  if (n < 2) return;
  for (let i = 0; i < ring.length; i++) if (!Number.isSafeInteger(ring[i])) throw new ClipError(`ring coordinate ${ring[i]} is not an integer`);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushEdge(out, ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1], op, 1, true);
  }
}

/** Whether (px, py), known to lie on the edge's line, is strictly between its end points. */
const strictlyOn = (e: Edge, px: number, py: number): boolean => (px > e.ax || (px === e.ax && py > e.ay)) && (px < e.bx || (px === e.bx && py < e.by));

/** Whether (px, py) projects strictly inside the edge and is not one of its end points. */
function projectsInside(e: Edge, px: number, py: number): boolean {
  if ((px === e.ax && py === e.ay) || (px === e.bx && py === e.by)) return false;
  const dx = e.bx - e.ax;
  const dy = e.by - e.ay;
  const t = (px - e.ax) * dx + (py - e.ay) * dy;
  return t > 0 && t < dx * dx + dy * dy;
}

/** A uniform grid over edges: each edge sits in the cells its path crosses (with a nanometer of slack). */
interface EdgeGrid {
  grid: Map<number, number[]>;
  /** The cells an edge's path crosses. */
  cellsOf(e: Edge): number[];
  /** The cell of a point. */
  cellOf(x: number, y: number): number;
}

function edgeGrid(edges: readonly Edge[]): EdgeGrid {
  const n = edges.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumLen = 0;
  for (const e of edges) {
    if (e.ax < minX) minX = e.ax;
    if (e.bx > maxX) maxX = e.bx;
    const lo = e.ay < e.by ? e.ay : e.by;
    const hi = e.ay < e.by ? e.by : e.ay;
    if (lo < minY) minY = lo;
    if (hi > maxY) maxY = hi;
    sumLen += Math.max(e.bx - e.ax, hi - lo);
  }
  minX -= 2;
  minY -= 2;
  const W = maxX - minX + 3;
  const H = maxY - minY + 3;
  let cell = Math.max(4, (sumLen / Math.max(1, n)) * 2);
  const maxCells = 4 * n + 16;
  if ((W / cell) * (H / cell) > maxCells) cell = Math.sqrt((W * H) / maxCells);
  const rows = Math.floor(H / cell) + 1;
  const cellsOf = (e: Edge): number[] => {
    const out: number[] = [];
    const c0 = Math.floor((e.ax - 1 - minX) / cell);
    const c1 = Math.floor((e.bx + 1 - minX) / cell);
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    for (let c = c0; c <= c1; c++) {
      let ylo: number;
      let yhi: number;
      if (c0 === c1 || dx === 0) {
        ylo = Math.min(e.ay, e.by);
        yhi = Math.max(e.ay, e.by);
      } else {
        const xa = Math.min(e.bx, Math.max(e.ax, minX + c * cell));
        const xb = Math.max(e.ax, Math.min(e.bx, minX + (c + 1) * cell));
        const ya = e.ay + (dy * (xa - e.ax)) / dx;
        const yb = e.ay + (dy * (xb - e.ax)) / dx;
        ylo = Math.min(ya, yb);
        yhi = Math.max(ya, yb);
      }
      const r0 = Math.max(0, Math.floor((ylo - 1 - minY) / cell));
      const r1 = Math.min(rows - 1, Math.floor((yhi + 1 - minY) / cell));
      for (let r = r0; r <= r1; r++) out.push(c * rows + r);
    }
    return out;
  };
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    for (const key of cellsOf(edges[i])) {
      const l = grid.get(key);
      if (l) l.push(i);
      else grid.set(key, [i]);
    }
  }
  return { grid, cellsOf, cellOf: (x, y) => Math.floor((x - minX) / cell) * rows + Math.floor((y - minY) / cell) };
}

/**
 * Snap rounding: every edge end point and every crossing, rounded to the nanometer grid, is a hot pixel (the unit
 * square around it); every edge is replaced by the chain through the centers of the hot pixels it passes through,
 * in order. Rounded this way, edges meet only at pixel centers or run along each other, so the arrangement is
 * planar without the creeping that rounding one crossing at a time can cause near clusters of almost parallel
 * edges.
 */
function snapRound(edges: Edge[]): Edge[] {
  const n = edges.length;
  const g = edgeGrid(edges);
  // hot pixels by grid cell
  const pixels = new Map<number, number[]>();
  const seen = new Set<string>();
  const hot = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    const key = g.cellOf(x, y);
    const l = pixels.get(key);
    if (l) l.push(x, y);
    else pixels.set(key, [x, y]);
  };
  for (const e of edges) {
    hot(e.ax, e.ay);
    hot(e.bx, e.by);
  }
  for (const list of g.grid.values()) {
    const m = list.length;
    for (let a = 0; a < m - 1; a++) {
      const e = edges[list[a]];
      const eLo = e.ay < e.by ? e.ay : e.by;
      const eHi = e.ay < e.by ? e.by : e.ay;
      for (let b = a + 1; b < m; b++) {
        const f = edges[list[b]];
        if (e.bx < f.ax || f.bx < e.ax) continue;
        const fLo = f.ay < f.by ? f.ay : f.by;
        const fHi = f.ay < f.by ? f.by : f.ay;
        if (eHi < fLo || fHi < eLo) continue;
        const o1 = orient(e.ax, e.ay, e.bx, e.by, f.ax, f.ay);
        const o2 = orient(e.ax, e.ay, e.bx, e.by, f.bx, f.by);
        if (o1 === 0 || o2 === 0 || o1 === o2) continue;
        const o3 = orient(f.ax, f.ay, f.bx, f.by, e.ax, e.ay);
        const o4 = orient(f.ax, f.ay, f.bx, f.by, e.bx, e.by);
        if (o3 === 0 || o4 === 0 || o3 === o4) continue;
        const dxe = e.bx - e.ax;
        const dye = e.by - e.ay;
        const dxf = f.bx - f.ax;
        const dyf = f.by - f.ay;
        const den = dxe * dyf - dye * dxf;
        let t = ((f.ax - e.ax) * dyf - (f.ay - e.ay) * dxf) / den;
        if (!(t > 0)) t = 0;
        if (t > 1) t = 1;
        hot(Math.round(e.ax + t * dxe), Math.round(e.ay + t * dye));
      }
    }
  }
  // route every edge through the hot pixels it meets
  const out: Edge[] = [];
  const hits: { t: number; x: number; y: number }[] = [];
  const H = 0.5 - 1e-9;
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    hits.length = 0;
    const visited = new Set<number>();
    for (const key of g.cellsOf(e)) {
      if (visited.has(key)) continue;
      visited.add(key);
      const l = pixels.get(key);
      if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const px = l[k];
        const py = l[k + 1];
        if ((px === e.ax && py === e.ay) || (px === e.bx && py === e.by)) continue;
        if (px < e.ax - 1 || px > e.bx + 1 || py < Math.min(e.ay, e.by) - 1 || py > Math.max(e.ay, e.by) + 1) continue;
        // does the segment meet the square [px - H, px + H] x [py - H, py + H]?
        let t0 = 0;
        let t1 = 1;
        let ok = true;
        const pq: [number, number][] = [
          [-dx, e.ax - (px - H)],
          [dx, px + H - e.ax],
          [-dy, e.ay - (py - H)],
          [dy, py + H - e.ay],
        ];
        for (const [p, q] of pq) {
          if (p === 0) {
            if (q < 0) ok = false;
            continue;
          }
          const r = q / p;
          if (p < 0) {
            if (r > t1) ok = false;
            else if (r > t0) t0 = r;
          } else if (r < t0) ok = false;
          else if (r < t1) t1 = r;
        }
        if (!ok || t0 > t1) continue;
        hits.push({ t: (t0 + t1) / 2, x: px, y: py });
      }
    }
    if (!hits.length) {
      out.push(e);
      continue;
    }
    hits.sort((p, q) => p.t - q.t);
    let px = e.ax;
    let py = e.ay;
    for (const h of hits) {
      if (h.x === px && h.y === py) continue;
      pushEdge(out, px, py, h.x, h.y, e.op, e.s, true);
      px = h.x;
      py = h.y;
    }
    pushEdge(out, px, py, e.bx, e.by, e.op, e.s, true);
  }
  return out;
}

function splitPass(edges: Edge[], onlyFresh: boolean): { edges: Edge[]; changed: boolean } {
  const n = edges.length;
  const { grid } = edgeGrid(edges);
  const splits = new Map<number, number[]>();
  const add = (i: number, x: number, y: number) => {
    const l = splits.get(i);
    if (l) l.push(x, y);
    else splits.set(i, [x, y]);
  };
  for (const list of grid.values()) {
    const m = list.length;
    if (m < 2) continue;
    for (let a = 0; a < m - 1; a++) {
      const i = list[a];
      const e = edges[i];
      const eLo = e.ay < e.by ? e.ay : e.by;
      const eHi = e.ay < e.by ? e.by : e.ay;
      for (let b = a + 1; b < m; b++) {
        const j = list[b];
        const f = edges[j];
        if (onlyFresh && !e.fresh && !f.fresh) continue;
        if (e.bx < f.ax || f.bx < e.ax) continue;
        const fLo = f.ay < f.by ? f.ay : f.by;
        const fHi = f.ay < f.by ? f.by : f.ay;
        if (eHi < fLo || fHi < eLo) continue;
        const o1 = orient(e.ax, e.ay, e.bx, e.by, f.ax, f.ay);
        const o2 = orient(e.ax, e.ay, e.bx, e.by, f.bx, f.by);
        if (o1 === 0 && o2 === 0) {
          if (strictlyOn(e, f.ax, f.ay)) add(i, f.ax, f.ay);
          if (strictlyOn(e, f.bx, f.by)) add(i, f.bx, f.by);
          if (strictlyOn(f, e.ax, e.ay)) add(j, e.ax, e.ay);
          if (strictlyOn(f, e.bx, e.by)) add(j, e.bx, e.by);
          continue;
        }
        if (o1 === o2) continue;
        const o3 = orient(f.ax, f.ay, f.bx, f.by, e.ax, e.ay);
        const o4 = orient(f.ax, f.ay, f.bx, f.by, e.bx, e.by);
        if (o3 === o4) continue;
        if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
          if (o1 === 0 && strictlyOn(e, f.ax, f.ay)) add(i, f.ax, f.ay);
          if (o2 === 0 && strictlyOn(e, f.bx, f.by)) add(i, f.bx, f.by);
          if (o3 === 0 && strictlyOn(f, e.ax, e.ay)) add(j, e.ax, e.ay);
          if (o4 === 0 && strictlyOn(f, e.bx, e.by)) add(j, e.bx, e.by);
          continue;
        }
        // a proper crossing: split both at the rounded intersection
        const dxe = e.bx - e.ax;
        const dye = e.by - e.ay;
        const dxf = f.bx - f.ax;
        const dyf = f.by - f.ay;
        const den = dxe * dyf - dye * dxf;
        let t = ((f.ax - e.ax) * dyf - (f.ay - e.ay) * dxf) / den;
        if (!(t > 0)) t = 0;
        if (t > 1) t = 1;
        const px = Math.round(e.ax + t * dxe);
        const py = Math.round(e.ay + t * dye);
        const inE = projectsInside(e, px, py);
        const inF = projectsInside(f, px, py);
        if (inE && inF) {
          add(i, px, py);
          add(j, px, py);
        } else {
          // the crossing is within rounding of an end point: route the other edge through that end point
          const near = (g: Edge) => ((px - g.ax) ** 2 + (py - g.ay) ** 2 <= (px - g.bx) ** 2 + (py - g.by) ** 2 ? [g.ax, g.ay] : [g.bx, g.by]);
          if (inE) {
            const [qx, qy] = near(f);
            if (projectsInside(e, qx, qy)) add(i, qx, qy);
          } else if (inF) {
            const [qx, qy] = near(e);
            if (projectsInside(f, qx, qy)) add(j, qx, qy);
          } else {
            const [ex, ey] = near(e);
            const [fx, fy] = near(f);
            if (projectsInside(f, ex, ey)) add(j, ex, ey);
            if (projectsInside(e, fx, fy)) add(i, fx, fy);
          }
        }
      }
    }
  }
  if (!splits.size) {
    for (const e of edges) e.fresh = false;
    return { edges, changed: false };
  }
  const out: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const sp = splits.get(i);
    if (!sp) {
      e.fresh = false;
      out.push(e);
      continue;
    }
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const pts: { x: number; y: number; t: number }[] = [];
    for (let k = 0; k < sp.length; k += 2) pts.push({ x: sp[k], y: sp[k + 1], t: (sp[k] - e.ax) * dx + (sp[k + 1] - e.ay) * dy });
    pts.sort((p, q) => p.t - q.t || p.x - q.x || p.y - q.y);
    let px = e.ax;
    let py = e.ay;
    for (const p of pts) {
      if (p.x === px && p.y === py) continue;
      pushEdge(out, px, py, p.x, p.y, e.op, e.s, true);
      px = p.x;
      py = p.y;
    }
    pushEdge(out, px, py, e.bx, e.by, e.op, e.s, true);
  }
  return { edges: out, changed: true };
}

/** The region where `predicate` holds over the operands' insideness (operand i is inside when its winding passes its rule). */
export function clip(operands: readonly Operand[], predicate: (inside: readonly boolean[]) => boolean): Polygon[] {
  const k = operands.length;
  if (k < 1 || k > 12) throw new ClipError("between 1 and 12 operands");
  const table = new Uint8Array(1 << k);
  const ins: boolean[] = new Array<boolean>(k).fill(false);
  for (let m = 0; m < 1 << k; m++) {
    for (let i = 0; i < k; i++) ins[i] = ((m >> i) & 1) === 1;
    table[m] = predicate(ins) ? 1 : 0;
  }
  const positive = operands.map((o) => o.rule === "positive");
  let edges: Edge[] = [];
  for (let op = 0; op < k; op++) for (const ring of operands[op].rings) addRing(edges, ring, op);
  if (!edges.length) return table[0] ? unbounded() : [];
  edges = snapRound(edges);
  for (let pass = 0; ; pass++) {
    if (pass > 16) {
      const err = new ClipError("edge intersections did not settle after 16 passes");
      err.operands = operands;
      throw err;
    }
    const r = splitPass(edges, pass > 0);
    edges = r.edges;
    if (!r.changed) break;
  }

  // ---- merge identical edges; each carries its winding change per operand (along a->b)
  edges.sort((a, b) => a.ax - b.ax || a.ay - b.ay || a.bx - b.bx || a.by - b.by);
  const mx0: number[] = [];
  const my0: number[] = [];
  const mx1: number[] = [];
  const my1: number[] = [];
  let deltas: number[] = [];
  let prev: Edge | undefined;
  for (const e of edges) {
    if (!prev || prev.ax !== e.ax || prev.ay !== e.ay || prev.bx !== e.bx || prev.by !== e.by) {
      mx0.push(e.ax);
      my0.push(e.ay);
      mx1.push(e.bx);
      my1.push(e.by);
      for (let i = 0; i < k; i++) deltas.push(0);
      prev = e;
    }
    deltas[(mx0.length - 1) * k + e.op] += e.s;
  }
  // drop edges that change nothing
  let N = 0;
  const X0: number[] = [];
  const Y0: number[] = [];
  const X1: number[] = [];
  const Y1: number[] = [];
  const D: number[] = [];
  for (let m = 0; m < mx0.length; m++) {
    let any = false;
    for (let i = 0; i < k; i++) if (deltas[m * k + i] !== 0) any = true;
    if (!any) continue;
    X0.push(mx0[m]);
    Y0.push(my0[m]);
    X1.push(mx1[m]);
    Y1.push(my1[m]);
    for (let i = 0; i < k; i++) D.push(deltas[m * k + i]);
    N++;
  }
  deltas = [];
  if (!N) return table[0] ? unbounded() : [];

  // ---- winding on each side, by a sweep over x. The active edges (spanning the sweep line) stay sorted bottom to
  // top: they never cross. An edge's winding just below is the winding just above the active edge under its start;
  // a vertical edge's winding on its left is the winding just above the active edge under its midpoint.
  const above = new Int32Array(N * k);
  const nonVertical: number[] = [];
  const vertical: number[] = [];
  for (let m = 0; m < N; m++) (X0[m] === X1[m] ? vertical : nonVertical).push(m);
  const byStart = nonVertical.slice().sort((a, b) => X0[a] - X0[b] || Y0[a] - Y0[b] || -orient(X0[a], Y0[a], X1[a], Y1[a], X1[b], Y1[b]));
  const byEnd = nonVertical.slice().sort((a, b) => X1[a] - X1[b]);
  vertical.sort((a, b) => X0[a] - X0[b]);
  const active: number[] = [];
  const outFrom: number[] = [];
  const outTo: number[] = [];
  const maskAt = (base: number, d: number, sign: number) => {
    let mask = 0;
    for (let i = 0; i < k; i++) {
      const v = (base < 0 ? 0 : above[base * k + i]) + sign * (d < 0 ? 0 : D[d * k + i]);
      if (positive[i] ? v > 0 : v !== 0) mask |= 1 << i;
    }
    return mask;
  };
  const emit = (m: number, left: number, right: number) => {
    const inL = table[left] === 1;
    const inR = table[right] === 1;
    if (inL === inR) return;
    if (inL) {
      outFrom.push(X0[m], Y0[m]);
      outTo.push(X1[m], Y1[m]);
    } else {
      outFrom.push(X1[m], Y1[m]);
      outTo.push(X0[m], Y0[m]);
    }
  };
  let si = 0;
  let ei = 0;
  let vi = 0;
  const S = byStart.length;
  while (si < S || vi < vertical.length) {
    const x = vi < vertical.length && (si >= S || X0[vertical[vi]] <= X0[byStart[si]]) ? X0[vertical[vi]] : X0[byStart[si]];
    // edges that ended before x leave first
    while (ei < byEnd.length && X1[byEnd[ei]] < x) {
      const g = byEnd[ei++];
      const p = active.indexOf(g);
      if (p >= 0) active.splice(p, 1);
    }
    // vertical edges at x: the active set spans x - eps (nothing ending at x is removed yet, nothing starting at x is in)
    while (vi < vertical.length && X0[vertical[vi]] === x) {
      const m = vertical[vi++];
      const PX = 2 * x;
      const PY = Y0[m] + Y1[m];
      let lo = 0;
      let hi = active.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const g = active[mid];
        if (orient(2 * X0[g], 2 * Y0[g], 2 * X1[g], 2 * Y1[g], PX, PY) > 0) lo = mid + 1;
        else hi = mid;
      }
      const below = lo > 0 ? active[lo - 1] : -1;
      // left of an upward edge is the region the sweep came from; right = left minus its change
      emit(m, maskAt(below, -1, 0), maskAt(below, m, -1));
    }
    while (ei < byEnd.length && X1[byEnd[ei]] <= x) {
      const g = byEnd[ei++];
      const p = active.indexOf(g);
      if (p >= 0) active.splice(p, 1);
    }
    while (si < S && X0[byStart[si]] === x) {
      const e = byStart[si++];
      let lo = 0;
      let hi = active.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const g = active[mid];
        const gAbove = X0[g] === X0[e] && Y0[g] === Y0[e] ? orient(X0[e], Y0[e], X1[e], Y1[e], X1[g], Y1[g]) > 0 : orient(X0[g], Y0[g], X1[g], Y1[g], X0[e], Y0[e]) < 0;
        if (gAbove) hi = mid;
        else lo = mid + 1;
      }
      const below = lo > 0 ? active[lo - 1] : -1;
      for (let i = 0; i < k; i++) above[e * k + i] = (below < 0 ? 0 : above[below * k + i]) + D[e * k + i];
      active.splice(lo, 0, e);
      // left of an edge going +x is above it
      emit(e, maskAt(e, -1, 0), maskAt(below, -1, 0));
    }
  }
  if (table[0]) throw new ClipError("the predicate holds outside every operand: the result is unbounded");
  return assemble(outFrom, outTo);
}

function unbounded(): never {
  throw new ClipError("the predicate holds outside every operand: the result is unbounded");
}

/** Link directed boundary edges (result on the left) into rings and group them into polygons. */
function assemble(from: number[], to: number[]): Polygon[] {
  return groupRings(linkRings(from, to));
}

/**
 * Link directed edges (result on the left; every vertex has as many edges leaving as arriving) into rings, taking
 * at each vertex the next edge clockwise from the way back, so rings that touch at a point stay separate.
 */
export function linkRings(from: readonly number[], to: readonly number[]): Ring[] {
  const E = from.length >> 1;
  if (!E) return [];
  // edges sorted by their start vertex; the edges leaving a vertex are a run found by binary search
  const order = new Int32Array(E);
  for (let e = 0; e < E; e++) order[e] = e;
  order.sort((a, b) => from[2 * a] - from[2 * b] || from[2 * a + 1] - from[2 * b + 1]);
  const cands: number[] = [];
  const leaving = (vx: number, vy: number): number[] => {
    let lo = 0;
    let hi = E;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = order[mid];
      if (from[2 * m] < vx || (from[2 * m] === vx && from[2 * m + 1] < vy)) lo = mid + 1;
      else hi = mid;
    }
    cands.length = 0;
    for (let i = lo; i < E; i++) {
      const m = order[i];
      if (from[2 * m] !== vx || from[2 * m + 1] !== vy) break;
      cands.push(m);
    }
    return cands;
  };
  const used = new Uint8Array(E);
  const rings: Ring[] = [];
  for (let s = 0; s < E; s++) {
    if (used[s]) continue;
    const ring: number[] = [];
    let e = s;
    for (let guard = 0; guard <= E; guard++) {
      used[e] = 1;
      ring.push(from[2 * e], from[2 * e + 1]);
      const vx = to[2 * e];
      const vy = to[2 * e + 1];
      const cands = leaving(vx, vy);
      if (!cands.length) throw new ClipError("an open boundary (no edge leaves a vertex)");
      let next = -1;
      if (cands.length === 1) next = cands[0];
      else {
        const rx = from[2 * e] - vx;
        const ry = from[2 * e + 1] - vy;
        let best = -1;
        let bestCat = 9;
        for (const c of cands) {
          const dx = to[2 * c] - vx;
          const dy = to[2 * c + 1] - vy;
          const cr = crossSign(rx, ry, dx, dy);
          const cat = cr < 0 ? 0 : cr > 0 ? 2 : dotSign(rx, ry, dx, dy) < 0 ? 1 : 3;
          if (best < 0 || cat < bestCat) {
            best = c;
            bestCat = cat;
            continue;
          }
          if (cat === bestCat && (cat === 0 || cat === 2)) {
            const bx = to[2 * best] - vx;
            const by = to[2 * best + 1] - vy;
            // c comes first when it is counterclockwise of best (best is clockwise from c)
            if (crossSign(dx, dy, bx, by) < 0) best = c;
          }
        }
        next = best;
      }
      if (next === s) break;
      if (used[next]) throw new ClipError("boundary edges do not close into rings");
      e = next;
    }
    const clean = removeCollinear(ring);
    if (clean.length >= 6) rings.push(clean);
  }
  return rings;
}

/** A ring's edges bucketed by rows of y, for fast containment tests of many points. */
class RingRows {
  private readonly rows: number[][];
  private readonly y0: number;
  private readonly h: number;
  constructor(private readonly ring: Ring) {
    const b = ringBox(ring);
    const n = ring.length >> 1;
    const R = Math.max(1, Math.min(4096, n >> 2));
    this.y0 = b[1];
    this.h = (b[3] - b[1] + 1) / R;
    this.rows = Array.from({ length: R }, () => []);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lo = Math.min(ring[2 * i + 1], ring[2 * j + 1]);
      const hi = Math.max(ring[2 * i + 1], ring[2 * j + 1]);
      const r0 = Math.max(0, Math.floor((lo - this.y0) / this.h));
      const r1 = Math.min(R - 1, Math.floor((hi - this.y0) / this.h));
      for (let r = r0; r <= r1; r++) this.rows[r].push(i);
    }
  }
  /** Even-odd containment of a point in doubled coordinates. */
  contains2(PX: number, PY: number): boolean {
    const r = Math.floor((PY / 2 - this.y0) / this.h);
    if (r < 0 || r >= this.rows.length) return false;
    const ring = this.ring;
    const n = ring.length >> 1;
    let inside = false;
    for (const i of this.rows[r]) {
      const j = (i + 1) % n;
      const ax = 2 * ring[2 * i];
      const ay = 2 * ring[2 * i + 1];
      const bx = 2 * ring[2 * j];
      const by = 2 * ring[2 * j + 1];
      if (ay > PY === by > PY) continue;
      const o = orient(ax, ay, bx, by, PX, PY);
      if (by > ay ? o > 0 : o < 0) inside = !inside;
    }
    return inside;
  }
}

/**
 * Group rings into polygons: positive-area rings are outer rings; each hole goes to the smallest outer ring that
 * contains it. `owner` may give a hole's outer ring directly (an index into `rings`) when it is already known.
 */
export function groupRings(rings: readonly Ring[], owner?: ReadonlyMap<number, number>): Polygon[] {
  const outers: { ring: Ring; area: number; box: [number, number, number, number]; holes: Ring[]; rows?: RingRows; tests: number }[] = [];
  const byIndex = new Map<number, (typeof outers)[number]>();
  const holes: { ring: Ring; box: [number, number, number, number]; index: number }[] = [];
  rings.forEach((r, index) => {
    const a = ringArea(r);
    if (a === 0) return;
    const box = ringBox(r);
    if (a > 0) {
      const o = { ring: r, area: a, box, holes: [] as Ring[], tests: 0 };
      outers.push(o);
      byIndex.set(index, o);
    } else holes.push({ ring: r, box, index });
  });
  for (const h of holes) {
    const known = owner?.get(h.index);
    const ko = known !== undefined ? byIndex.get(known) : undefined;
    if (ko) {
      ko.holes.push(h.ring);
      continue;
    }
    const PX = h.ring[0] + h.ring[2];
    const PY = h.ring[1] + h.ring[3];
    let best: (typeof outers)[number] | undefined;
    for (const o of outers) {
      if (o.box[0] > h.box[0] || o.box[1] > h.box[1] || o.box[2] < h.box[2] || o.box[3] < h.box[3]) continue;
      if (best && o.area >= best.area) continue;
      o.tests++;
      if (!o.rows && o.ring.length > 256 && o.tests > 4) o.rows = new RingRows(o.ring);
      if (o.rows ? o.rows.contains2(PX, PY) : pointInRing2(o.ring, PX, PY)) best = o;
    }
    if (best) best.holes.push(h.ring);
  }
  const polys: Polygon[] = outers.map((o) => ({ outer: startAtMin(o.ring), holes: o.holes.map(startAtMin).sort(cmpRing) }));
  polys.sort((a, b) => cmpRing(a.outer, b.outer));
  return polys;
}
/** Drop vertices that lie on the line through their neighbors (a stack pass, then the wrap-around). */
export function removeCollinear(ring: readonly number[]): number[] {
  const n = ring.length >> 1;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i];
    const y = ring[2 * i + 1];
    while (xs.length >= 2 && orient(xs[xs.length - 2], ys[ys.length - 2], xs[xs.length - 1], ys[ys.length - 1], x, y) === 0) {
      xs.pop();
      ys.pop();
    }
    xs.push(x);
    ys.push(y);
  }
  let start = 0;
  for (let changed = true; changed && xs.length - start >= 3; ) {
    changed = false;
    const L = xs.length;
    if (orient(xs[L - 2], ys[L - 2], xs[L - 1], ys[L - 1], xs[start], ys[start]) === 0) {
      xs.pop();
      ys.pop();
      changed = true;
    } else if (orient(xs[L - 1], ys[L - 1], xs[start], ys[start], xs[start + 1], ys[start + 1]) === 0) {
      start++;
      changed = true;
    }
  }
  const out: number[] = [];
  for (let i = start; i < xs.length; i++) out.push(xs[i], ys[i]);
  return out;
}

/** Signed area of a ring (positive counterclockwise), square nanometers. */
export function ringArea(r: readonly number[]): number {
  const n = r.length >> 1;
  if (n < 3) return 0;
  const x0 = r[0];
  const y0 = r[1];
  let s = 0;
  for (let i = 1; i < n - 1; i++) s += (r[2 * i] - x0) * (r[2 * i + 3] - y0) - (r[2 * i + 2] - x0) * (r[2 * i + 1] - y0);
  return s / 2;
}

/** Area of polygons with holes, square nanometers. */
export function polygonsArea(polys: readonly Polygon[]): number {
  let a = 0;
  for (const p of polys) {
    a += Math.abs(ringArea(p.outer));
    for (const h of p.holes) a -= Math.abs(ringArea(h));
  }
  return a;
}

export function ringBox(r: readonly number[]): [number, number, number, number] {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < a) a = r[i];
    if (r[i + 1] < b) b = r[i + 1];
    if (r[i] > c) c = r[i];
    if (r[i + 1] > d) d = r[i + 1];
  }
  return [a, b, c, d];
}

/** Even-odd containment of a point given in doubled coordinates (exact; the point must not lie on the ring). */
function pointInRing2(r: readonly number[], PX: number, PY: number): boolean {
  const n = r.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = 2 * r[2 * j];
    const ay = 2 * r[2 * j + 1];
    const bx = 2 * r[2 * i];
    const by = 2 * r[2 * i + 1];
    if (ay > PY === by > PY) continue;
    const o = orient(ax, ay, bx, by, PX, PY);
    if (by > ay ? o > 0 : o < 0) inside = !inside;
  }
  return inside;
}

/** Even-odd containment of a point in a ring (floating point; points on the boundary may go either way). */
export function pointInRing(r: readonly number[], px: number, py: number): boolean {
  const n = r.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = r[2 * j];
    const ay = r[2 * j + 1];
    const bx = r[2 * i];
    const by = r[2 * i + 1];
    if (ay > py === by > py) continue;
    const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
    if (px < x) inside = !inside;
  }
  return inside;
}

/** Whether a point is inside a polygon (in its outer ring and in none of its holes). */
export const pointInPolygon = (p: Polygon, x: number, y: number): boolean => pointInRing(p.outer, x, y) && !p.holes.some((h) => pointInRing(h, x, y));

function startAtMin(r: Ring): Ring {
  const n = r.length >> 1;
  let best = 0;
  for (let i = 1; i < n; i++) if (r[2 * i] < r[2 * best] || (r[2 * i] === r[2 * best] && r[2 * i + 1] < r[2 * best + 1])) best = i;
  if (!best) return r;
  return [...r.slice(2 * best), ...r.slice(0, 2 * best)];
}

function cmpRing(a: Ring, b: Ring): number {
  return a[0] - b[0] || a[1] - b[1] || a.length - b.length || a[2] - b[2] || a[3] - b[3];
}

/** Union of rings (nonzero). */
export const unionRings = (rings: readonly Ring[]): Polygon[] => clip([{ rings }], (i) => i[0]);

/** Flatten polygons back to rings (outer rings and holes), for use as an operand. */
export const polygonRings = (polys: readonly Polygon[]): Ring[] => polys.flatMap((p) => [p.outer, ...p.holes]);


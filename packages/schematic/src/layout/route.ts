/**
 * Layout stage 6: orthogonal routing on the grid (contract section 7). A* over grid points with a cost per step,
 * bend and crossing; symbol bodies, text, labels, power glyphs and other nets' pins are walls; another net's wire
 * may be crossed at right angles but never followed, bent on or ended on (no accidental merges, rule C06). A net
 * with several terminals grows a tree from its first terminal; later terminals join the tree with a T.
 *
 * The grid is dense typed arrays over the card's bounds (a point is an index), so a card of a few hundred units on
 * a side routes in milliseconds.
 */
import type { LBox } from "../symbols.ts";
import { dirVec, opposite, type Dir, type XY } from "../units.ts";

export const COST = { step: 1, bend: 4, cross: 6, near: 0.4 } as const;

const DIRS: Dir[] = ["right", "down", "left", "up"];
const BIT: Record<Dir, number> = { right: 1, down: 2, left: 4, up: 8 };
const DIR_IDX: Record<Dir, number> = { right: 0, down: 1, left: 2, up: 3 };

export interface Terminal {
  at: XY;
  /** the direction a wire leaves this terminal (a pin's lead direction); absent: any */
  exit?: Dir;
}

export interface RouteResult {
  /** one polyline per joined terminal (corners only) */
  paths: XY[][];
  /** terminals that could not be joined */
  failed: number[];
  /** most bends in one path */
  maxBends: number;
  /** the terminals joined to the tree (the first terminal always) */
  joined: number[];
}

/** The routing grid of one card: walls, other nets' wires, and the trees routed so far. */
export class Grid {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly w: number;
  readonly h: number;
  /** 1: wall; 2: near a wall */
  private flags: Uint8Array;
  /** points owned by a net (its pins, label and power anchors): walls to every other net (net id + 1, 0 = none) */
  private owned: Int32Array;
  /** wires: point -> list of [net id, direction bits] */
  private wires = new Map<number, number[]>();
  private netIds = new Map<string, number>();

  constructor(bounds: LBox) {
    this.x0 = Math.floor(bounds.x0);
    this.y0 = Math.floor(bounds.y0);
    this.x1 = Math.ceil(bounds.x1);
    this.y1 = Math.ceil(bounds.y1);
    this.w = this.x1 - this.x0 + 1;
    this.h = this.y1 - this.y0 + 1;
    this.flags = new Uint8Array(this.w * this.h);
    this.owned = new Int32Array(this.w * this.h);
  }
  idx(x: number, y: number): number {
    return (y - this.y0) * this.w + (x - this.x0);
  }
  netId(net: string): number {
    let i = this.netIds.get(net);
    if (i === undefined) this.netIds.set(net, (i = this.netIds.size + 1));
    return i;
  }

  /** Make every grid point inside the box (edges included, with `pad`) a wall. */
  wallBox(b: LBox, pad = 0): void {
    const xa = Math.max(this.x0, Math.ceil(b.x0 - pad));
    const xb = Math.min(this.x1, Math.floor(b.x1 + pad));
    const ya = Math.max(this.y0, Math.ceil(b.y0 - pad));
    const yb = Math.min(this.y1, Math.floor(b.y1 + pad));
    for (let y = Math.max(this.y0, ya - 1); y <= Math.min(this.y1, yb + 1); y++)
      for (let x = Math.max(this.x0, xa - 1); x <= Math.min(this.x1, xb + 1); x++) {
        const i = this.idx(x, y);
        this.flags[i] |= x >= xa && x <= xb && y >= ya && y <= yb ? 3 : 2;
      }
  }
  /** A point owned by a net (a pin, label or power anchor): only that net may use it. */
  own(p: XY, net: string): void {
    if (!this.inBounds(p[0], p[1])) return;
    this.owned[this.idx(p[0], p[1])] = this.netId(net);
  }
  isWall(x: number, y: number, net: string): boolean {
    const i = this.idx(x, y);
    const o = this.owned[i];
    if (o) return o !== this.netId(net);
    return (this.flags[i] & 1) === 1;
  }
  /** Record a routed polyline of `net`. */
  addWire(net: string, pts: XY[]): void {
    const id = this.netId(net);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const dx = Math.sign(b[0] - a[0]);
      const dy = Math.sign(b[1] - a[1]);
      const d: Dir = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
      let [x, y] = a;
      while (x !== b[0] || y !== b[1]) {
        this.mark(x, y, id, BIT[d]);
        x += dx;
        y += dy;
        this.mark(x, y, id, BIT[opposite(d)]);
      }
    }
  }
  private mark(x: number, y: number, id: number, bit: number) {
    if (!this.inBounds(x, y)) return;
    const k = this.idx(x, y);
    let l = this.wires.get(k);
    if (!l) this.wires.set(k, (l = []));
    for (let i = 0; i < l.length; i += 2)
      if (l[i] === id) {
        l[i + 1] |= bit;
        return;
      }
    l.push(id, bit);
  }
  /** Forget every wire of `net` (a route that is given up). */
  removeNet(net: string): void {
    const id = this.netId(net);
    for (const [k, l] of this.wires) {
      for (let i = l.length - 2; i >= 0; i -= 2) if (l[i] === id) l.splice(i, 2);
      if (!l.length) this.wires.delete(k);
    }
  }
  /** Direction bits of other nets' wires at a point, or-ed (0: none). */
  foreignBits(x: number, y: number, net: string): number {
    const l = this.wires.get(this.idx(x, y));
    if (!l) return 0;
    const id = this.netId(net);
    let bits = 0;
    for (let i = 0; i < l.length; i += 2) if (l[i] !== id) bits |= l[i + 1] || 16;
    return bits;
  }
  /** Other nets' wires at a point: their directions. */
  foreign(x: number, y: number, net: string): Set<Dir>[] {
    const l = this.wires.get(this.idx(x, y));
    if (!l) return [];
    const id = this.netId(net);
    const out: Set<Dir>[] = [];
    for (let i = 0; i < l.length; i += 2) if (l[i] !== id) out.push(new Set(DIRS.filter((d) => l[i + 1] & BIT[d])));
    return out;
  }
  isNear(x: number, y: number): boolean {
    return (this.flags[this.idx(x, y)] & 2) === 2;
  }
  inBounds(x: number, y: number): boolean {
    return x >= this.x0 && x <= this.x1 && y >= this.y0 && y <= this.y1;
  }
}

/** A small binary heap keyed by cost, ties by insertion order (deterministic). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  private n: number[] = [];
  private c = 0;
  private less(i: number, j: number) {
    return this.k[i] < this.k[j] || (this.k[i] === this.k[j] && this.n[i] < this.n[j]);
  }
  private swap(i: number, j: number) {
    [this.k[i], this.k[j]] = [this.k[j], this.k[i]];
    [this.v[i], this.v[j]] = [this.v[j], this.v[i]];
    [this.n[i], this.n[j]] = [this.n[j], this.n[i]];
  }
  push(k: number, v: number) {
    this.k.push(k);
    this.v.push(v);
    this.n.push(this.c++);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number | undefined {
    if (!this.k.length) return undefined;
    const top = this.v[0];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    const ln = this.n.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      this.n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

const bendCount = (pts: XY[]) => Math.max(0, pts.length - 2);

function simplify(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/**
 * Route one net's terminals as a tree. `tree` starts with the first terminal; each other terminal, nearest first,
 * is joined by the cheapest path that leaves it along its exit and meets the tree without overlapping it.
 */
export function routeNet(grid: Grid, net: string, terminals: Terminal[], maxExpand = 60_000, bendLimit = Infinity): RouteResult {
  const paths: XY[][] = [];
  const failed: number[] = [];
  const joined: number[] = [0];
  if (terminals.length < 2) return { paths, failed, maxBends: 0, joined };
  for (const t of terminals) grid.own(t.at, net);
  const tree = new Map<number, number>();
  const pts: XY[] = [];
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const addTree = (p: XY, d?: Dir) => {
    if (!grid.inBounds(p[0], p[1])) return;
    const k = grid.idx(p[0], p[1]);
    if (!tree.has(k)) {
      tree.set(k, 0);
      pts.push(p);
      bbox.x0 = Math.min(bbox.x0, p[0]);
      bbox.y0 = Math.min(bbox.y0, p[1]);
      bbox.x1 = Math.max(bbox.x1, p[0]);
      bbox.y1 = Math.max(bbox.y1, p[1]);
    }
    if (d) tree.set(k, tree.get(k)! | BIT[d]);
  };
  const first = terminals[0];
  addTree(first.at);
  // a pin's lead is taken: nothing joins it from the body's side
  const lead = (t: Terminal) => {
    if (t.exit) addTree(t.at, opposite(t.exit));
  };
  lead(first);
  const left = terminals.slice(1).map((t, i) => ({ t, i: i + 1, d: Infinity }));
  /** tree points already counted in each terminal's distance */
  let seenPts = 0;
  let maxBends = 0;
  while (left.length) {
    // nearest terminal to the tree (each terminal's distance is updated with the points added since)
    for (const e of left)
      for (let k = seenPts; k < pts.length; k++) {
        const v = Math.abs(pts[k][0] - e.t.at[0]) + Math.abs(pts[k][1] - e.t.at[1]);
        if (v < e.d) e.d = v;
      }
    seenPts = pts.length;
    let best = 0;
    let bestD = Infinity;
    left.forEach((e, j) => {
      if (e.d < bestD) {
        bestD = e.d;
        best = j;
      }
    });
    const { t, i } = left.splice(best, 1)[0];
    const pending = new Map<number, Dir | undefined>();
    for (const e of left) if (grid.inBounds(e.t.at[0], e.t.at[1])) pending.set(grid.idx(e.t.at[0], e.t.at[1]), e.t.exit);
    const path = grid.inBounds(t.at[0], t.at[1]) ? astar(grid, net, t, tree, bbox, maxExpand, pending) : undefined;
    if (!path || bendCount(simplify(path)) > bendLimit) {
      failed.push(i);
      continue;
    }
    joined.push(i);
    lead(t);
    // terminals the path ran through (across their lead axis) are joined too
    const onPath = new Set(path.map((p) => grid.idx(p[0], p[1])));
    for (let j = left.length - 1; j >= 0; j--) {
      if (!grid.inBounds(left[j].t.at[0], left[j].t.at[1]) || !onPath.has(grid.idx(left[j].t.at[0], left[j].t.at[1]))) continue;
      const e = left.splice(j, 1)[0];
      joined.push(e.i);
      lead(e.t);
    }
    const simple = simplify(path);
    paths.push(simple);
    maxBends = Math.max(maxBends, bendCount(simple));
    grid.addWire(net, simple);
    for (let s = 1; s < path.length; s++) {
      const a = path[s - 1];
      const b = path[s];
      const d: Dir = b[0] > a[0] ? "right" : b[0] < a[0] ? "left" : b[1] > a[1] ? "down" : "up";
      addTree(a, d);
      addTree(b, opposite(d));
    }
  }
  return { paths, failed, maxBends, joined };
}

const popcount = (b: number) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1) + ((b >> 3) & 1);

function astar(grid: Grid, net: string, from: Terminal, tree: Map<number, number>, bb: { x0: number; y0: number; x1: number; y1: number }, maxExpand: number, pending: Map<number, Dir | undefined>): XY[] | undefined {
  // distance to the tree's bounding box: admissible, O(1)
  const h = (x: number, y: number) => Math.max(0, bb.x0 - x, x - bb.x1) + Math.max(0, bb.y0 - y, y - bb.y1);
  const accepts = (k: number, x: number, y: number, d: Dir): boolean => {
    const used = tree.get(k);
    if (used === undefined) return false;
    if (grid.foreignBits(x, y, net)) return false;
    // arriving while moving d occupies the direction opposite(d) at the point
    if (used & BIT[opposite(d)]) return false;
    // never make a four-way junction
    if (popcount(used) >= 3) return false;
    return true;
  };
  // node state: point index * 5 + direction (4: none)
  const W = grid.w;
  const best = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  const sx = from.at[0];
  const sy = from.at[1];
  const s0 = grid.idx(sx, sy) * 5 + 4;
  best.set(s0, 0);
  heap.push(h(sx, sy), s0);
  let expanded = 0;
  const decode = (s: number): [number, number, number] => {
    const p = Math.floor(s / 5);
    return [(p % W) + grid.x0, Math.floor(p / W) + grid.y0, s % 5];
  };
  const back = (s: number, extra: XY): XY[] => {
    const path: XY[] = [extra];
    let c: number | undefined = s;
    while (c !== undefined) {
      const [x, y] = decode(c);
      path.push([x, y]);
      c = prev.get(c);
    }
    return path.reverse();
  };
  const closed = new Set<number>();
  while (heap.size) {
    const s = heap.pop()!;
    if (closed.has(s)) continue;
    closed.add(s);
    const g0 = best.get(s)!;
    if (++expanded > maxExpand) return undefined;
    const [nx, ny, di] = decode(s);
    const nd: Dir | undefined = di === 4 ? undefined : DIRS[di];
    const hereForeign = nd ? grid.foreignBits(nx, ny, net) : 0;
    for (const d of DIRS) {
      if (!nd && from.exit && d === opposite(from.exit)) continue; // never back over a pin's lead
      if (nd && d === opposite(nd)) continue;
      const [vx, vy] = dirVec(d);
      const x = nx + vx;
      const y = ny + vy;
      if (!grid.inBounds(x, y)) continue;
      // on another net's wire here: only straight through, perpendicular
      if (hereForeign && nd && d !== nd) continue;
      const k = grid.idx(x, y);
      if (accepts(k, x, y, d)) return back(s, [x, y]);
      if (tree.has(k)) continue; // the tree only as a goal
      if (pending.has(k)) {
        // another terminal of this net: only straight across its lead axis (it joins there)
        const e = pending.get(k);
        if (!e || d === e || d === opposite(e)) continue;
      }
      if (grid.isWall(x, y, net)) continue;
      const there = grid.foreignBits(x, y, net);
      let cost = COST.step;
      if (there) {
        const axis = d === "left" || d === "right" ? BIT.left | BIT.right : BIT.up | BIT.down;
        if (there & (axis | 16)) continue; // never along another wire
        cost += COST.cross;
      }
      if (nd && d !== nd) cost += COST.bend;
      if (!nd && from.exit && d !== from.exit) cost += COST.bend; // leave a pin straight when possible
      if (nd && pending.has(grid.idx(nx, ny)) && d !== nd) continue; // straight through a terminal
      if (grid.isNear(x, y)) cost += COST.near;
      const g = g0 + cost;
      const ns = k * 5 + DIR_IDX[d];
      if ((best.get(ns) ?? Infinity) <= g) continue;
      best.set(ns, g);
      prev.set(ns, s);
      heap.push(g + h(x, y), ns);
    }
  }
  return undefined;
}

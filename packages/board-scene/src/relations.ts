/**
 * Spatial relations computed for the agent: neighbors of each footprint by direction with edge-to-edge gaps, copper
 * of other nets under or beside a part, crossings between ratsnest lines and routed copper, congestion per grid cell,
 * and free corridors between two points on a layer.
 */
import type { RatLink } from "./connectivity.js";
import type { BoardModel, MFootprint, MTrack } from "./model.js";
import { centerOfPixel, distanceField, pixelOf, rasterize, resolutionFor, type Raster } from "./raster.js";
import { boxGap, byStr, centerOf, dist, inflateBox, natCmp, overlaps, polyDist, rdp, segBoxDist, segIntersection, simplifyCollinear, type BoxMm, type Pt } from "./util.js";

export type Direction = "left" | "right" | "up" | "down";
export const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];

export interface Neighbor {
  id: string;
  ref: string;
  /** Edge-to-edge gap between the footprints' boxes (courtyard, pads and graphics), mm. */
  gap: number;
  dir: Direction;
  /** Center offset from the footprint asked about to this one. */
  dx: number;
  dy: number;
  side: "top" | "bottom";
}

/**
 * The direction of `b` seen from `a`: by the offset between box centers, in 90 degree cones (left is -X, up is +Y).
 * A tie on the diagonal goes to left or right.
 */
export function directionOf(a: MFootprint, b: MFootprint): Direction {
  const ca = centerOf(a.box);
  const cb = centerOf(b.box);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy > 0 ? "up" : "down";
}

/** Every other footprint as a neighbor, nearest first (gap, then reference). */
export function neighborsOf(model: BoardModel, fp: MFootprint, candidates: readonly MFootprint[] = model.footprints): Neighbor[] {
  const ca = centerOf(fp.box);
  const out: Neighbor[] = [];
  for (const o of candidates) {
    if (o.id === fp.id) continue;
    const cb = centerOf(o.box);
    out.push({ id: o.id, ref: o.ref, gap: boxGap(fp.box, o.box), dir: directionOf(fp, o), dx: cb.x - ca.x, dy: cb.y - ca.y, side: o.side });
  }
  return out.sort((a, b) => a.gap - b.gap || natCmp(a.ref, b.ref));
}

/** The nearest footprint in each direction. */
export function nearestByDirection(model: BoardModel, fp: MFootprint, candidates?: readonly MFootprint[]): Partial<Record<Direction, Neighbor>> {
  const out: Partial<Record<Direction, Neighbor>> = {};
  for (const n of neighborsOf(model, fp, candidates)) if (!out[n.dir]) out[n.dir] = n;
  return out;
}

export interface CopperNear {
  net: string;
  layer: string;
  /** under: crosses the footprint's box on a layer the part has no pads on; through: crosses it on a pad layer; beside: within the beside distance. */
  rel: "under" | "through" | "beside";
  gap: number;
  ids: string[];
}

/** Tracks of nets the footprint does not use that cross its box or pass within `beside` mm of it. */
export function copperNear(model: BoardModel, fp: MFootprint, beside = 1.0, tracks: readonly MTrack[] = model.tracks): CopperNear[] {
  const groups = new Map<string, CopperNear>();
  const own = new Set(fp.nets);
  const near = inflateBox(fp.box, beside + 1);
  for (const t of tracks) {
    if (t.net && own.has(t.net)) continue;
    if (!overlaps(t.box, near)) continue;
    let gap = Infinity;
    for (let i = 0; i + 1 < t.pts.length; i++) gap = Math.min(gap, segBoxDist(t.pts[i], t.pts[i + 1], fp.box));
    gap = Math.max(0, gap - t.w / 2);
    if (gap > beside) continue;
    const rel: CopperNear["rel"] = gap > 0 ? "beside" : fp.copper.includes(t.layer) ? "through" : "under";
    const net = t.net ?? "(no net)";
    const key = `${rel}|${net}|${t.layer}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(t.id);
      g.gap = Math.min(g.gap, gap);
    } else groups.set(key, { net, layer: t.layer, rel, gap, ids: [t.id] });
  }
  const order = { under: 0, through: 1, beside: 2 } as const;
  return [...groups.values()].map((g) => ({ ...g, ids: g.ids.sort(byStr) })).sort((a, b) => order[a.rel] - order[b.rel] || byStr(a.net, b.net) || byStr(a.layer, b.layer));
}

export interface RatCrossing {
  rat: string;
  track: string;
  net: string;
  layer: string;
  at: Pt;
}

/** Where each ratsnest line crosses routed copper of another net (as seen from the top, any layer). */
export function ratCrossings(model: BoardModel, rats: readonly RatLink[]): RatCrossing[] {
  const out: RatCrossing[] = [];
  for (const r of rats) {
    const rb = { minX: Math.min(r.from.at.x, r.to.at.x), minY: Math.min(r.from.at.y, r.to.at.y), maxX: Math.max(r.from.at.x, r.to.at.x), maxY: Math.max(r.from.at.y, r.to.at.y) };
    for (const t of model.tracks) {
      if (t.net === r.net || !overlaps(t.box, rb)) continue;
      for (let i = 0; i + 1 < t.pts.length; i++) {
        const p = segIntersection(r.from.at, r.to.at, t.pts[i], t.pts[i + 1]);
        if (p) {
          out.push({ rat: r.id, track: t.id, net: t.net ?? "(no net)", layer: t.layer, at: p });
          break;
        }
      }
    }
  }
  return out.sort((a, b) => byStr(a.rat, b.rat) || byStr(a.track, b.track));
}

// ---------------------------------------------------------------- congestion

export interface CongestionLayer {
  /** Copper share of the board area in each cell, percent, rows from the top (max Y) down, columns left to right. */
  copper: number[][];
  /** Tracks of the planned width and clearance that could cross each cell left to right / bottom to top. */
  hFree: number[][];
  vFree: number[][];
}

export interface Congestion {
  box: BoxMm;
  cell: number;
  cols: number;
  rows: number;
  res: number;
  width: number;
  clearance: number;
  layers: Record<string, CongestionLayer>;
}

const NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
/** A round cell size giving about `target` cells along the longer side. */
export function niceCell(box: BoxMm, target = 8): number {
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY) / target;
  return NICE.find((n) => n >= span) ?? 100;
}

function runsToChannels(free: boolean[], res: number, pitch: number): number {
  let total = 0;
  let run = 0;
  const flush = () => {
    if (run > 0) total += Math.floor(((run - 1) * res + 1e-9) / pitch) + 1;
    run = 0;
  };
  for (const f of free) {
    if (f) run++;
    else flush();
  }
  flush();
  return total;
}

/** Copper density and free channels per cell and layer. */
export function congestion(model: BoardModel, box: BoxMm, options: { cell?: number; layers?: string[]; width?: number; clearance?: number; res?: number } = {}): Congestion {
  const cell = options.cell ?? niceCell(box);
  const width = options.width ?? model.rules.trackWidth;
  const clearance = options.clearance ?? model.rules.clearance;
  const cols = Math.max(1, Math.ceil((box.maxX - box.minX) / cell - 1e-9));
  const rows = Math.max(1, Math.ceil((box.maxY - box.minY) / cell - 1e-9));
  const grid: BoxMm = { minX: box.minX, minY: box.minY, maxX: box.minX + cols * cell, maxY: box.minY + rows * cell };
  const res = resolutionFor(grid, options.res ?? Math.min(0.05, cell / 20), 1_500_000);
  const need = width / 2 + clearance;
  const pitch = width + clearance;
  const layers: Record<string, CongestionLayer> = {};
  for (const layer of options.layers ?? model.copper) {
    const r = rasterize(model, layer, grid, { res });
    const d = distanceField(r);
    const copper: number[][] = [];
    const hFree: number[][] = [];
    const vFree: number[][] = [];
    for (let row = rows - 1; row >= 0; row--) {
      const cr: number[] = [];
      const hr: number[] = [];
      const vr: number[] = [];
      for (let col = 0; col < cols; col++) {
        const i0 = Math.floor((col * cell) / r.res);
        const i1 = Math.min(r.nx, Math.floor(((col + 1) * cell) / r.res));
        const j0 = Math.floor((row * cell) / r.res);
        const j1 = Math.min(r.ny, Math.floor(((row + 1) * cell) / r.res));
        let inBoard = 0;
        let cu = 0;
        for (let j = j0; j < j1; j++)
          for (let i = i0; i < i1; i++) {
            const o = r.occ[i + j * r.nx];
            if (o !== 2) inBoard++;
            if (o === 1) cu++;
          }
        cr.push(inBoard ? Math.round((100 * cu) / inBoard) : 0);
        // a row is a channel when every pixel across the cell keeps the track's clearance
        const rowsFree: boolean[] = [];
        for (let j = j0; j < j1; j++) {
          let ok = i1 > i0;
          for (let i = i0; i < i1 && ok; i++) if (d[i + j * r.nx] < need) ok = false;
          rowsFree.push(ok);
        }
        const colsFree: boolean[] = [];
        for (let i = i0; i < i1; i++) {
          let ok = j1 > j0;
          for (let j = j0; j < j1 && ok; j++) if (d[i + j * r.nx] < need) ok = false;
          colsFree.push(ok);
        }
        hr.push(runsToChannels(rowsFree, r.res, pitch));
        vr.push(runsToChannels(colsFree, r.res, pitch));
      }
      copper.push(cr);
      hFree.push(hr);
      vFree.push(vr);
    }
    layers[layer] = { copper, hFree, vFree };
  }
  return { box: grid, cell, cols, rows, res, width, clearance, layers };
}

// ---------------------------------------------------------------- corridors

export interface CorridorQuery {
  /** A point (mm, `[x, y]`) or an object id (pad, via, footprint: its center). */
  from: [number, number] | string;
  to: [number, number] | string;
  layer: string;
  /** Default: the board's target track width. */
  width?: number;
  /** Default: the board's target clearance. */
  clearance?: number;
  /** The net the route would carry: its own copper is not an obstacle. Default: the net of `from` or `to` when they are pads or vias. */
  net?: string;
}

export interface Corridor {
  from: Pt;
  to: Pt;
  layer: string;
  net?: string;
  width: number;
  clearance: number;
  found: boolean;
  /** Path length, mm. */
  length?: number;
  /** The centerline, simplified. */
  path?: Pt[];
  /** The widest track that fits along the whole path at this clearance, mm. */
  maxWidth?: number;
  /** When not found: the reachable point nearest the goal and the objects around it. */
  stuckAt?: Pt;
  blockedBy?: string[];
  /** How far the start or end had to move to reach free space, mm (0 when it was free). */
  startShift: number;
  endShift: number;
  res: number;
}

function anchorPoint(model: BoardModel, v: [number, number] | string): { at: Pt; net?: string } {
  if (Array.isArray(v)) return { at: { x: v[0], y: v[1] } };
  const pad = model.padById.get(v);
  if (pad) return { at: { x: pad.x, y: pad.y }, ...(pad.net ? { net: pad.net } : {}) };
  const via = model.viaById.get(v);
  if (via) return { at: { x: via.x, y: via.y }, ...(via.net ? { net: via.net } : {}) };
  const fp = model.fpById.get(v);
  if (fp) return { at: { x: fp.x, y: fp.y } };
  throw new Error(`corridor end ${v} is not a point, pad, via or footprint`);
}

class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, pri: number): void {
    const k = this.k;
    const p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (p[u] < p[i] || (p[u] === p[i] && k[u] <= k[i])) break;
      [k[u], k[i]] = [k[i], k[u]];
      [p[u], p[i]] = [p[i], p[u]];
      i = u;
    }
  }
  pop(): number {
    const k = this.k;
    const p = this.p;
    const top = k[0];
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && (p[l] < p[m] || (p[l] === p[m] && k[l] < k[m]))) m = l;
        if (r < k.length && (p[r] < p[m] || (p[r] === p[m] && k[r] < k[m]))) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Nearest pixel to `p` that is free for the route, searching outward up to `maxShift` mm. */
function nearestFree(r: Raster, ok: (idx: number) => boolean, p: Pt, maxShift: number): { idx: number; shift: number } | undefined {
  const [ci, cj] = pixelOf(r, p);
  const R = Math.ceil(maxShift / r.res);
  let best: { idx: number; shift: number } | undefined;
  for (let dj = -R; dj <= R; dj++)
    for (let di = -R; di <= R; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= r.nx || j >= r.ny) continue;
      const idx = i + j * r.nx;
      if (!ok(idx)) continue;
      const d = dist(centerOfPixel(r, i, j), p);
      if (d <= maxShift && (!best || d < best.shift - 1e-12 || (Math.abs(d - best.shift) <= 1e-12 && idx < best.idx))) best = { idx, shift: d };
    }
  return best;
}

/** Look for a free corridor between two points on one layer (A* on the raster, 8 directions). */
export function findCorridor(model: BoardModel, q: CorridorQuery): Corridor {
  const a = anchorPoint(model, q.from);
  const b = anchorPoint(model, q.to);
  const net = q.net ?? a.net ?? b.net;
  const width = q.width ?? model.rules.trackWidth;
  const clearance = q.clearance ?? model.rules.clearance;
  const need = width / 2 + clearance;
  const span = Math.max(Math.abs(a.at.x - b.at.x), Math.abs(a.at.y - b.at.y));
  const margin = Math.max(3, span * 0.5);
  const box = { minX: Math.min(a.at.x, b.at.x) - margin, minY: Math.min(a.at.y, b.at.y) - margin, maxX: Math.max(a.at.x, b.at.x) + margin, maxY: Math.max(a.at.y, b.at.y) + margin };
  const clip = model.box;
  const area = { minX: Math.max(box.minX, clip.minX - 1), minY: Math.max(box.minY, clip.minY - 1), maxX: Math.min(box.maxX, clip.maxX + 1), maxY: Math.min(box.maxY, clip.maxY + 1) };
  const r = rasterize(model, q.layer, area, { ...(net ? { excludeNet: net } : {}), res: 0.05, maxPixels: 1_500_000 });
  const d = distanceField(r);
  const ok = (idx: number) => d[idx] >= need;
  const base = { from: a.at, to: b.at, layer: q.layer, ...(net ? { net } : {}), width, clearance, res: r.res };
  const s = nearestFree(r, ok, a.at, Math.max(1, need * 2));
  const g = nearestFree(r, ok, b.at, Math.max(1, need * 2));
  if (!s || !g) {
    const at = !s ? a.at : b.at;
    return { ...base, found: false, stuckAt: at, blockedBy: blockersAt(model, q.layer, at, need + 0.3, net), startShift: s?.shift ?? 0, endShift: g?.shift ?? 0 };
  }
  const n = r.nx * r.ny;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gi = g.idx % r.nx;
  const gj = Math.floor(g.idx / r.nx);
  const h = (idx: number) => {
    const dx = Math.abs((idx % r.nx) - gi);
    const dy = Math.abs(Math.floor(idx / r.nx) - gj);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * r.res;
  };
  const heap = new Heap();
  gScore[s.idx] = 0;
  heap.push(s.idx, h(s.idx));
  let bestIdx = s.idx;
  let bestH = h(s.idx);
  const steps: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === g.idx) {
      found = true;
      break;
    }
    const hc = h(cur);
    if (hc < bestH) {
      bestH = hc;
      bestIdx = cur;
    }
    const ci = cur % r.nx;
    const cj = Math.floor(cur / r.nx);
    for (const [di, dj, c] of steps) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= r.nx || j >= r.ny) continue;
      const nb = i + j * r.nx;
      if (closed[nb] || !ok(nb)) continue;
      // no corner cutting between two blocked pixels
      if (di && dj && (!ok(ci + di + cj * r.nx) || !ok(ci + (cj + dj) * r.nx))) continue;
      const t = gScore[cur] + c * r.res;
      if (t < gScore[nb]) {
        gScore[nb] = t;
        came[nb] = cur;
        heap.push(nb, t + h(nb));
      }
    }
  }
  if (!found) {
    const at = centerOfPixel(r, bestIdx % r.nx, Math.floor(bestIdx / r.nx));
    return { ...base, found: false, stuckAt: at, blockedBy: blockersAt(model, q.layer, at, need + 2 * r.res + 0.3, net), startShift: s.shift, endShift: g.shift };
  }
  const cells: number[] = [];
  for (let c = g.idx; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  let minD = Infinity;
  for (const c of cells) minD = Math.min(minD, d[c]);
  const raw = [a.at, ...cells.map((c) => centerOfPixel(r, c % r.nx, Math.floor(c / r.nx))), b.at];
  const path = rdp(simplifyCollinear(raw, r.res / 4), r.res);
  let length = 0;
  for (let i = 0; i + 1 < path.length; i++) length += dist(path[i], path[i + 1]);
  return { ...base, found: true, length, path, maxWidth: Math.max(0, Math.floor(((minD - clearance) * 2) / 0.01) * 0.01), startShift: s.shift, endShift: g.shift };
}

/** Objects on a layer within `radius` of a point (other nets only, when a net is given). */
export function blockersAt(model: BoardModel, layer: string, p: Pt, radius: number, net?: string): string[] {
  const out: string[] = [];
  for (const pad of model.pads) {
    if (!pad.layers.includes(layer) && pad.type !== "np") continue;
    if (net && pad.net === net) continue;
    if (Math.max(0, dist(p, { x: pad.x, y: pad.y }) - Math.max(pad.w, pad.h) / 2) <= radius) out.push(pad.id);
  }
  for (const t of model.tracks) if (t.layer === layer && (!net || t.net !== net) && polyDist(p, t.pts) - t.w / 2 <= radius) out.push(t.id);
  for (const v of model.vias) if (v.layers.includes(layer) && (!net || v.net !== net) && dist(p, v) - v.d / 2 <= radius) out.push(v.id);
  for (const k of model.keepouts) if (k.blocks?.tracks && k.layers.includes(layer) && overlaps(inflateBox({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, radius), k.box)) out.push(k.id);
  if (model.outline.length && !(p.x > model.box.minX + radius && p.x < model.box.maxX - radius && p.y > model.box.minY + radius && p.y < model.box.maxY - radius)) out.push("outline");
  return [...new Set(out)].sort(byStr);
}

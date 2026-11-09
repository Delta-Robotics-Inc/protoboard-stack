/**
 * A per-layer occupancy raster: copper (pads, tracks, vias, holes), and hard obstacles (outside the outline, cutouts,
 * keep-outs that block tracks on the layer). A Euclidean distance transform over it gives, at each pixel, the
 * distance to the nearest obstacle, which answers "can a track of width w with clearance c pass here". Pixels are
 * tested at their centers, so every distance is good to about half a pixel; the resolution is reported.
 */
import type { BoardModel } from "./model.js";
import { padSdf } from "./model.js";
import { polyDist, type BoxMm, type Pt } from "./util.js";

export const FREE = 0;
export const COPPER = 1;
export const HARD = 2;

export interface Raster {
  layer: string;
  box: BoxMm;
  res: number;
  nx: number;
  ny: number;
  /** FREE, COPPER or HARD per pixel; index i + j * nx, j = 0 at the bottom (min y). */
  occ: Uint8Array;
  /** Distance (mm) from each pixel center to the nearest obstacle pixel center; set by `distanceField`. */
  dist?: Float32Array;
}

export interface RasterOptions {
  /** Leave this net's copper out (a route for that net may touch it). */
  excludeNet?: string;
  /** Default 0.05 mm; coarsened so the raster stays under `maxPixels`. */
  res?: number;
  maxPixels?: number;
}

/** Pixel size that keeps a box under the pixel cap. */
export function resolutionFor(box: BoxMm, res = 0.05, maxPixels = 2_000_000): number {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  let r = res;
  while ((w / r) * (h / r) > maxPixels) r *= 1.25;
  return r;
}

function scanlineFill(r: Raster, poly: readonly Pt[], inside: (idx: number) => void, outside?: (idx: number) => void): void {
  const xs: number[] = [];
  for (let j = 0; j < r.ny; j++) {
    const y = r.box.minY + (j + 0.5) * r.res;
    xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const p = poly[a];
      const q = poly[b];
      if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    }
    xs.sort((m, n) => m - n);
    let k = 0;
    let isIn = false;
    for (let i = 0; i < r.nx; i++) {
      const x = r.box.minX + (i + 0.5) * r.res;
      while (k < xs.length && xs[k] <= x) {
        isIn = !isIn;
        k++;
      }
      const idx = i + j * r.nx;
      if (isIn) inside(idx);
      else outside?.(idx);
    }
  }
}

/** Mark pixels whose centers satisfy `test`, within a box. */
function markBox(r: Raster, b: BoxMm, value: number, test: (p: Pt) => boolean): void {
  const i0 = Math.max(0, Math.floor((b.minX - r.box.minX) / r.res));
  const i1 = Math.min(r.nx - 1, Math.ceil((b.maxX - r.box.minX) / r.res));
  const j0 = Math.max(0, Math.floor((b.minY - r.box.minY) / r.res));
  const j1 = Math.min(r.ny - 1, Math.ceil((b.maxY - r.box.minY) / r.res));
  const p = { x: 0, y: 0 };
  for (let j = j0; j <= j1; j++) {
    p.y = r.box.minY + (j + 0.5) * r.res;
    for (let i = i0; i <= i1; i++) {
      const idx = i + j * r.nx;
      if (r.occ[idx] === HARD) continue;
      p.x = r.box.minX + (i + 0.5) * r.res;
      if (test(p)) r.occ[idx] = value;
    }
  }
}

/** Rasterize one copper layer of a box. */
export function rasterize(model: BoardModel, layer: string, box: BoxMm, options: RasterOptions = {}): Raster {
  const res = resolutionFor(box, options.res, options.maxPixels);
  const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / res));
  const ny = Math.max(1, Math.ceil((box.maxY - box.minY) / res));
  const r: Raster = { layer, box: { minX: box.minX, minY: box.minY, maxX: box.minX + nx * res, maxY: box.minY + ny * res }, res, nx, ny, occ: new Uint8Array(nx * ny) };
  // hard: outside the outline, inside cutouts, keep-outs that block tracks here
  if (model.outline.length) scanlineFill(r, model.outline, () => {}, (idx) => (r.occ[idx] = HARD));
  for (const c of model.cutouts) scanlineFill(r, c, (idx) => (r.occ[idx] = HARD));
  for (const k of model.keepouts) if (k.blocks?.tracks && k.layers.includes(layer)) scanlineFill(r, k.outline, (idx) => (r.occ[idx] = HARD));
  const ex = options.excludeNet;
  const within = (b: BoxMm) => !(b.maxX < r.box.minX || b.minX > r.box.maxX || b.maxY < r.box.minY || b.minY > r.box.maxY);
  for (const p of model.pads) {
    const holeOnly = p.type === "np";
    if (!holeOnly && !p.layers.includes(layer)) continue;
    if (ex && p.net === ex) continue;
    if (!within(p.box)) continue;
    markBox(r, p.box, COPPER, (q) => padSdf(p.shape, q) <= 0);
  }
  for (const t of model.tracks) {
    if (t.layer !== layer || (ex && t.net === ex) || !within(t.box)) continue;
    const hw = t.w / 2;
    markBox(r, t.box, COPPER, (q) => polyDist(q, t.pts) <= hw);
  }
  for (const v of model.vias) {
    if (!v.layers.includes(layer) || (ex && v.net === ex) || !within(v.box)) continue;
    const rr = v.d / 2;
    markBox(r, v.box, COPPER, (q) => (q.x - v.x) ** 2 + (q.y - v.y) ** 2 <= rr * rr);
  }
  return r;
}

const INF = 1e20;
/** Felzenszwalb and Huttenlocher's 1D squared distance transform. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Fill `r.dist`: millimeters from each pixel center to the nearest obstacle (copper or hard). */
export function distanceField(r: Raster): Float32Array {
  const { nx, ny } = r;
  const n = Math.max(nx, ny);
  const grid = new Float64Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) grid[i] = r.occ[i] !== FREE ? 0 : INF;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = grid[i + j * nx];
    edt1d(f, ny, d, v, z);
    for (let j = 0; j < ny; j++) grid[i + j * nx] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = grid[i + j * nx];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) grid[i + j * nx] = d[i];
  }
  const out = new Float32Array(nx * ny);
  // a board with no obstacle at all reads as very far
  for (let i = 0; i < nx * ny; i++) out[i] = grid[i] >= INF / 2 ? 1e6 : Math.sqrt(grid[i]) * r.res;
  r.dist = out;
  return out;
}

export const pixelOf = (r: Raster, p: Pt): [number, number] => [Math.floor((p.x - r.box.minX) / r.res), Math.floor((p.y - r.box.minY) / r.res)];
export const centerOfPixel = (r: Raster, i: number, j: number): Pt => ({ x: r.box.minX + (i + 0.5) * r.res, y: r.box.minY + (j + 0.5) * r.res });

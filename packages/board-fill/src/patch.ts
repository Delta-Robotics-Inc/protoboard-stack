/**
 * Replacing the part of a fill inside an axis-aligned window with a new local fill, without a boolean operation
 * over the whole fill: the result is (old minus window) united with the local fill (which lies inside the window).
 *
 * Old rings that stay clear of the window are kept as they are. Old edges that cross the window boundary are cut
 * at the boundary (the cut point rounded onto the boundary line, so it stays exactly on it); along the boundary,
 * between consecutive cut points and local vertices, an edge of the result runs where exactly one side has
 * copper: the old fill just outside, or the local fill just inside. The touched pieces are linked into rings again
 * and holes go back to their outer rings. The window's sides are moved by whole nanometers until no old vertex
 * lies on them and no old edge passes through a corner, so every crossing is a clean one.
 */
import { orient } from "./exact.js";
import { groupRings, linkRings, ringBox, type Polygon, type Ring } from "./clip.js";

export interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A window around `box` (integers) moved outward until no old vertex lies on its sides and no old edge passes a corner. */
export function cleanWindow(polys: readonly Polygon[], box: { minX: number; minY: number; maxX: number; maxY: number }): Window {
  const w: Window = { x0: Math.floor(box.minX), y0: Math.floor(box.minY), x1: Math.ceil(box.maxX), y1: Math.ceil(box.maxY) };
  for (let guard = 0; guard < 64; guard++) {
    let bad: "x0" | "x1" | "y0" | "y1" | undefined;
    for (const p of polys) {
      for (const r of [p.outer, ...p.holes]) {
        const b = ringBox(r);
        if (b[2] < w.x0 || b[0] > w.x1 || b[3] < w.y0 || b[1] > w.y1) continue;
        const n = r.length >> 1;
        for (let i = 0; i < n && !bad; i++) {
          const x = r[2 * i];
          const y = r[2 * i + 1];
          if (y >= w.y0 && y <= w.y1) {
            if (x === w.x0) bad = "x0";
            else if (x === w.x1) bad = "x1";
          }
          if (!bad && x >= w.x0 && x <= w.x1) {
            if (y === w.y0) bad = "y0";
            else if (y === w.y1) bad = "y1";
          }
          if (bad) break;
          const j = (i + 1) % n;
          const qx = r[2 * j];
          const qy = r[2 * j + 1];
          for (const [cx, cy, side] of [
            [w.x0, w.y0, "x0"],
            [w.x1, w.y0, "x1"],
            [w.x1, w.y1, "x1"],
            [w.x0, w.y1, "x0"],
          ] as const) {
            if (cx < Math.min(x, qx) || cx > Math.max(x, qx) || cy < Math.min(y, qy) || cy > Math.max(y, qy)) continue;
            if (orient(x, y, qx, qy, cx, cy) === 0) {
              bad = side;
              break;
            }
          }
        }
        if (bad) break;
      }
      if (bad) break;
    }
    if (!bad) return w;
    if (bad === "x0") w.x0--;
    else if (bad === "x1") w.x1++;
    else if (bad === "y0") w.y0--;
    else w.y1++;
  }
  throw new Error("no clean window found");
}

/** (old minus window) united with `local` (which must lie inside the window). */
export function patchPolygons(old: readonly Polygon[], w: Window, local: readonly Polygon[]): Polygon[] {
  const W = w.x1 - w.x0;
  const H = w.y1 - w.y0;
  const P = 2 * (W + H);
  const inside = (x: number, y: number) => x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1;
  /** Perimeter parameter of a point on the window boundary, counterclockwise from (x0, y0). */
  const param = (x: number, y: number): number => {
    if (y === w.y0 && x >= w.x0 && x <= w.x1) return x - w.x0;
    if (x === w.x1) return W + (y - w.y0);
    if (y === w.y1) return W + H + (w.x1 - x);
    return (2 * W + H + (w.y1 - y)) % P;
  };
  const pointAt = (t: number): [number, number] => {
    t = ((t % P) + P) % P;
    if (t <= W) return [w.x0 + t, w.y0];
    if (t <= W + H) return [w.x1, w.y0 + (t - W)];
    if (t <= 2 * W + H) return [w.x1 - (t - W - H), w.y1];
    return [w.x0, w.y1 - (t - 2 * W - H)];
  };
  const from: number[] = [];
  const to: number[] = [];
  const emit = (ax: number, ay: number, bx: number, by: number) => {
    if (ax === bx && ay === by) return;
    from.push(ax, ay);
    to.push(bx, by);
  };
  const crossings: number[] = [];
  const kept: Ring[] = [];
  /** For a kept hole, the kept index of its kept outer ring. */
  const keptOwner = new Map<number, number>();

  /** Where a segment crosses into or out of the window: the parameter range inside (Liang-Barsky), or undefined. */
  const clipRange = (ax: number, ay: number, bx: number, by: number): [number, number] | undefined => {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - w.x0, w.x1 - ax, ay - w.y0, w.y1 - ay];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return undefined;
        continue;
      }
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return undefined;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return undefined;
        if (r < t1) t1 = r;
      }
    }
    return t0 < t1 ? [t0, t1] : undefined;
  };
  /** The point at parameter t of a segment, put exactly onto the window side it crosses. */
  const onBoundary = (ax: number, ay: number, bx: number, by: number, t: number): [number, number] => {
    const x = ax + t * (bx - ax);
    const y = ay + t * (by - ay);
    const dx0 = Math.abs(x - w.x0);
    const dx1 = Math.abs(x - w.x1);
    const dy0 = Math.abs(y - w.y0);
    const dy1 = Math.abs(y - w.y1);
    const m = Math.min(dx0, dx1, dy0, dy1);
    const cy = (v: number) => Math.min(w.y1, Math.max(w.y0, Math.round(v)));
    const cx = (v: number) => Math.min(w.x1, Math.max(w.x0, Math.round(v)));
    if (m === dx0) return [w.x0, cy(y)];
    if (m === dx1) return [w.x1, cy(y)];
    if (m === dy0) return [cx(x), w.y0];
    return [cx(x), w.y1];
  };

  for (const p of old) {
    let outerKept = -1;
    const rings = [p.outer, ...p.holes];
    rings.forEach((r, ri) => {
      const b = ringBox(r);
      const n = r.length >> 1;
      let touched = false;
      if (!(b[2] < w.x0 || b[0] > w.x1 || b[3] < w.y0 || b[1] > w.y1)) {
        for (let i = 0; i < n && !touched; i++) {
          const j = (i + 1) % n;
          if (inside(r[2 * i], r[2 * i + 1]) || clipRange(r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1])) touched = true;
        }
      }
      if (!touched) {
        kept.push(r);
        if (ri === 0) outerKept = kept.length - 1;
        else if (outerKept >= 0) keptOwner.set(kept.length - 1, outerKept);
        return;
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[2 * i];
        const ay = r[2 * i + 1];
        const bx = r[2 * j];
        const by = r[2 * j + 1];
        const ain = inside(ax, ay);
        const bin = inside(bx, by);
        if (ain && bin) continue;
        const range = clipRange(ax, ay, bx, by);
        if (!range) {
          emit(ax, ay, bx, by);
          continue;
        }
        if (!ain) {
          const [ex, ey] = onBoundary(ax, ay, bx, by, range[0]);
          emit(ax, ay, ex, ey);
          crossings.push(param(ex, ey));
        }
        if (!bin) {
          const [xx, xy] = onBoundary(ax, ay, bx, by, range[1]);
          emit(xx, xy, bx, by);
          crossings.push(param(xx, xy));
        }
      }
    });
  }

  // local fill: its edges inside the window stay; its edges along the boundary become covered intervals
  const covered: [number, number][] = [];
  const breaks: number[] = [0, W, W + H, 2 * W + H];
  const onSide = (ax: number, ay: number, bx: number, by: number) =>
    (ax === bx && (ax === w.x0 || ax === w.x1)) || (ay === by && (ay === w.y0 || ay === w.y1));
  for (const q of local)
    for (const r of [q.outer, ...q.holes]) {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[2 * i];
        const ay = r[2 * i + 1];
        const bx = r[2 * j];
        const by = r[2 * j + 1];
        if (((ax === w.x0 || ax === w.x1) && ay >= w.y0 && ay <= w.y1) || ((ay === w.y0 || ay === w.y1) && ax >= w.x0 && ax <= w.x1)) breaks.push(param(ax, ay));
        if (onSide(ax, ay, bx, by)) {
          let ta = param(ax, ay);
          let tb = param(bx, by);
          if (tb === 0 && ta > 0) tb = P;
          if (ta > tb) [ta, tb] = [tb, ta];
          covered.push([ta, tb]);
          breaks.push(ta, tb % P);
        } else emit(ax, ay, bx, by);
      }
    }
  for (const t of crossings) breaks.push(t);
  const ts = [...new Set(breaks.map((t) => ((t % P) + P) % P))].sort((a, b) => a - b);
  crossings.sort((a, b) => a - b);
  // old copper just outside the boundary at the first interval's midpoint, then toggled at each crossing
  const mid0 = ts.length > 1 ? (ts[0] + ts[1]) / 2 : ts[0] + P / 2;
  const [mx, my] = pointAt(mid0);
  let oldIn = pointInPolygons(old, mx, my);
  const isCovered = (t: number) => covered.some(([a, b]) => t > a && t < b);
  let ci = 0;
  while (ci < crossings.length && crossings[ci] < mid0) ci++;
  for (let k = 0; k < ts.length; k++) {
    const ta = ts[k];
    const tb = k + 1 < ts.length ? ts[k + 1] : ts[0] + P;
    const mid = (ta + tb) / 2;
    if (k > 0) {
      // toggle for crossings at the start of this interval
      while (ci < crossings.length && crossings[ci] <= ta) {
        oldIn = !oldIn;
        ci++;
      }
    }
    const localIn = isCovered(mid) || isCovered(mid + P) || isCovered(mid - P);
    if (oldIn === localIn) continue;
    const [ax, ay] = pointAt(ta);
    const [bx, by] = pointAt(tb);
    if (localIn) emit(ax, ay, bx, by);
    else emit(bx, by, ax, ay);
  }

  const linked = linkRings(from, to);
  const all = [...kept, ...linked];
  return groupRings(all, keptOwner);
}

/** Even-odd containment of a point in a polygon set (floating point; the point must not be on a boundary). */
export function pointInPolygons(polys: readonly Polygon[], px: number, py: number): boolean {
  let inside = false;
  for (const p of polys)
    for (const r of [p.outer, ...p.holes]) {
      const b = ringBox(r);
      if (py < b[1] || py > b[3] || px > b[2]) continue;
      const n = r.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ay = r[2 * j + 1];
        const by = r[2 * i + 1];
        if (ay > py === by > py) continue;
        const ax = r[2 * j];
        const bx = r[2 * i];
        const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
        if (px < x) inside = !inside;
      }
    }
  return inside;
}

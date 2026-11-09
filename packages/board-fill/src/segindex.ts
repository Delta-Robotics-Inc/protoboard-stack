/** A uniform grid over the edges of polygon rings, for nearest-edge and overlap queries. */
import type { Polygon } from "./clip.js";
import type { Box } from "./shapes.js";

export class SegIndex {
  /** x0, y0, x1, y1 per segment. */
  readonly segs: number[] = [];
  /** The polygon each segment belongs to. */
  readonly owner: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private stamp = 0;
  private readonly seen: Uint32Array;

  constructor(polys: readonly Polygon[], cell?: number) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    polys.forEach((p, pi) => {
      for (const r of [p.outer, ...p.holes]) {
        const n = r.length >> 1;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          this.segs.push(r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]);
          this.owner.push(pi);
          minX = Math.min(minX, r[2 * i]);
          minY = Math.min(minY, r[2 * i + 1]);
          maxX = Math.max(maxX, r[2 * i]);
          maxY = Math.max(maxY, r[2 * i + 1]);
        }
      }
    });
    const n = this.owner.length;
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;
    const W = Math.max(1, maxX - minX);
    const H = Math.max(1, maxY - minY);
    this.cell = cell ?? Math.max(1000, Math.sqrt((W * H) / Math.max(1, n)) * 2);
    this.cols = Math.floor(W / this.cell) + 2;
    this.seen = new Uint32Array(n);
    for (let s = 0; s < n; s++) {
      const x0 = this.segs[4 * s];
      const y0 = this.segs[4 * s + 1];
      const x1 = this.segs[4 * s + 2];
      const y1 = this.segs[4 * s + 3];
      const c0 = this.cx(Math.min(x0, x1));
      const c1 = this.cx(Math.max(x0, x1));
      const r0 = this.cy(Math.min(y0, y1));
      const r1 = this.cy(Math.max(y0, y1));
      for (let c = c0; c <= c1; c++)
        for (let r = r0; r <= r1; r++) {
          const k = r * this.cols + c;
          const l = this.cells.get(k);
          if (l) l.push(s);
          else this.cells.set(k, [s]);
        }
    }
  }

  private cx(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cell)));
  }
  private cy(y: number): number {
    return Math.max(0, Math.floor((y - this.minY) / this.cell));
  }

  /** Even-odd containment of a point in the indexed rings (a ray to +x over the cells of its row). */
  contains(px: number, py: number): boolean {
    let inside = false;
    const g = this.segs;
    this.query({ minX: px, minY: py, maxX: Infinity, maxY: py }, (s) => {
      const ay = g[4 * s + 1];
      const by = g[4 * s + 3];
      if (ay > py === by > py) return;
      const ax = g[4 * s];
      const bx = g[4 * s + 2];
      const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
      if (px < x) inside = !inside;
    });
    return inside;
  }

  /** Call `fn` once for each segment whose cell meets the box. */
  query(b: Box, fn: (s: number) => void | boolean): void {
    if (!this.owner.length) return;
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const c0 = this.cx(b.minX);
    const c1 = this.cx(b.maxX);
    const r0 = this.cy(b.minY);
    const r1 = Math.floor((b.maxY - this.minY) / this.cell);
    if (r1 < 0) return;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const l = this.cells.get(r * this.cols + c);
        if (!l) continue;
        for (const s of l) {
          if (this.seen[s] === this.stamp) continue;
          this.seen[s] = this.stamp;
          if (fn(s) === true) return;
        }
      }
  }
}

/**
 * A uniform grid over item boxes with insert and remove, for the checks' neighbor queries. Items are small
 * integers (indexes into the caller's array). An item covering more than `maxCells` cells goes in a short list
 * that every query checks directly (zone fills, the board outline). Insert and remove keep the grid exact, so a
 * later incremental recheck (Phase 2) can move one object and query its neighborhood without a rebuild.
 */
import type { Box } from "@protoboardai/board";

export class GridIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly large = new Set<number>();
  private readonly boxes: (Box | undefined)[] = [];
  private stamp = new Int32Array(64);
  private tick = 0;

  constructor(
    readonly cell: number,
    private readonly maxCells = 1024,
  ) {
    if (!(cell > 0)) throw new Error("grid cell size must be positive");
  }

  private key(x: number, y: number): number {
    // cells within +-2^20 of the origin: 1 mm cells cover +-1 km
    return (x + 1_048_576) * 2_097_152 + (y + 1_048_576);
  }

  private span(b: Box): [number, number, number, number] {
    const c = this.cell;
    return [Math.floor(b.minX / c), Math.floor(b.minY / c), Math.floor(b.maxX / c), Math.floor(b.maxY / c)];
  }

  insert(item: number, box: Box): void {
    if (this.boxes[item]) this.remove(item);
    this.boxes[item] = box;
    if (item >= this.stamp.length) {
      const s = new Int32Array(Math.max(item + 1, this.stamp.length * 2));
      s.set(this.stamp);
      this.stamp = s;
    }
    const [x0, y0, x1, y1] = this.span(box);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.maxCells) {
      this.large.add(item);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
  }

  remove(item: number): void {
    const box = this.boxes[item];
    if (!box) return;
    this.boxes[item] = undefined;
    if (this.large.delete(item)) return;
    const [x0, y0, x1, y1] = this.span(box);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const list = this.cells.get(k);
        if (!list) continue;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.cells.delete(k);
      }
  }

  /** Call `fn` once with each item whose box meets `q`, in no particular order. */
  query(q: Box, fn: (item: number) => void): void {
    const t = ++this.tick;
    if (t === 0x7fffffff) {
      this.stamp.fill(0);
      this.tick = 1;
    }
    const tick = this.tick;
    const visit = (i: number) => {
      if (this.stamp[i] === tick) return;
      this.stamp[i] = tick;
      const b = this.boxes[i];
      if (b && b.minX <= q.maxX && q.minX <= b.maxX && b.minY <= q.maxY && q.minY <= b.maxY) fn(i);
    };
    for (const i of this.large) visit(i);
    const [x0, y0, x1, y1] = this.span(q);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const list of this.cells.values()) for (const i of list) visit(i);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(this.key(x, y));
        if (list) for (const i of list) visit(i);
      }
  }

  /** The items whose boxes meet `q`, sorted. */
  search(q: Box): number[] {
    const out: number[] = [];
    this.query(q, (i) => out.push(i));
    return out.sort((a, b) => a - b);
  }

  get size(): number {
    let n = 0;
    for (const b of this.boxes) if (b) n++;
    return n;
  }
}

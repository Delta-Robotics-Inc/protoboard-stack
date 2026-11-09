/**
 * Derived zone fill: the copper a zone (or a Circuit JSON copper pour) was filled with when the source was saved.
 * The type, its schema, its input hash and its cache read and write live in the board core
 * (`@protoboardai/board`, derived.ts; contract section 4.3) so importers, checks and renderers share one
 * definition. This module keeps its earlier names as aliases and adds the KiCad-specific helpers (`unfracture`,
 * `shiftFill`).
 */
import {
  boardKey,
  readZoneFill,
  writeZoneFill,
  zoneFillInputHash,
  zoneFillIsCurrent,
  zoneFillPath,
  ZONE_FILL_FILE,
  ZONE_FILL_SCHEMA,
  type DerivedZoneFill,
  type Point,
  type ZoneFillEntry,
  type ZoneFillPolygon,
} from "@protoboardai/board";
import { polygonArea } from "./geom.js";

export const FILL_SCHEMA = ZONE_FILL_SCHEMA;
export const FILL_FILE = ZONE_FILL_FILE;
export type FillPolygon = ZoneFillPolygon;
export type FillEntry = ZoneFillEntry;
export type DerivedFill = DerivedZoneFill;
export { boardKey, zoneFillInputHash };

/** Whether a fill still matches the document's zones. */
export const fillIsCurrent = zoneFillIsCurrent;

/** Where a board's derived fill is cached (the core's `zoneFillPath`). */
export const derivedFillPath = (projectRoot: string, boardDir: string): string => zoneFillPath(boardDir, projectRoot);

/** Write the fill to the build cache; returns the file written (the core's `writeZoneFill`). */
export const writeDerivedFill = (projectRoot: string, boardDir: string, fill: DerivedFill): string => writeZoneFill(boardDir, fill, projectRoot);

/** Read and validate a cached fill (the core's `readZoneFill`). */
export const readDerivedFill = (path: string): DerivedFill => readZoneFill(path);

const flat = (pts: readonly Point[]): number[] => pts.flatMap((p) => [p.x, p.y]);
const orient = (pts: Point[], ccw: boolean): Point[] => (polygonArea(pts) >= 0 === ccw ? pts : [...pts].reverse());

/**
 * Split a fractured polygon (one ring with each hole joined to the outside by a zero-width bridge, as KiCad writes
 * fills) into an outer ring and holes. Bridges are pairs of edges that run between the same two points in opposite
 * directions; without any, the ring is returned as it is.
 */
export function unfracture(ring: readonly Point[]): FillPolygon {
  const pts: Point[] = [];
  for (const p of ring) {
    const l = pts[pts.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) pts.push(p);
  }
  while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  const n = pts.length;
  if (n < 3) return { outer: flat(pts), holes: [] };
  const k = (p: Point) => `${p.x},${p.y}`;
  const edgeKey = (i: number) => `${k(pts[i])}>${k(pts[(i + 1) % n])}`;
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = edgeKey(i);
    const l = byKey.get(key);
    if (l) l.push(i);
    else byKey.set(key, [i]);
  }
  const removed = new Uint8Array(n);
  let bridges = 0;
  for (let i = 0; i < n; i++) {
    if (removed[i]) continue;
    const back = byKey.get(`${k(pts[(i + 1) % n])}>${k(pts[i])}`)?.find((j) => !removed[j] && j !== i);
    if (back === undefined) continue;
    removed[i] = 1;
    removed[back] = 1;
    bridges++;
  }
  if (!bridges) return { outer: flat(orient(pts, true)), holes: [] };
  // trace the remaining edges into rings
  const out = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (removed[i]) continue;
    const key = k(pts[i]);
    const l = out.get(key);
    if (l) l.push(i);
    else out.set(key, [i]);
  }
  const done = new Uint8Array(n);
  const rings: Point[][] = [];
  for (let s = 0; s < n; s++) {
    if (removed[s] || done[s]) continue;
    const r: Point[] = [];
    let i = s;
    while (!done[i]) {
      done[i] = 1;
      r.push(pts[i]);
      const nextKey = k(pts[(i + 1) % n]);
      const cands = out.get(nextKey) ?? [];
      const j = cands.find((c) => !done[c]);
      if (j === undefined) break;
      i = j;
    }
    if (r.length >= 3) rings.push(r);
  }
  if (!rings.length) return { outer: flat(orient(pts, true)), holes: [] };
  let outerIndex = 0;
  let best = -1;
  rings.forEach((r, i) => {
    const a = Math.abs(polygonArea(r));
    if (a > best) {
      best = a;
      outerIndex = i;
    }
  });
  return { outer: flat(orient(rings[outerIndex], true)), holes: rings.filter((_, i) => i !== outerIndex).map((r) => flat(orient(r, false))) };
}

/** Move every point of a fill by (-dx, -dy) (recentering). */
export function shiftFill(fills: FillEntry[], dx: number, dy: number): void {
  const sh = (a: number[]) => {
    for (let i = 0; i < a.length; i += 2) {
      a[i] -= dx;
      a[i + 1] -= dy;
    }
  };
  for (const f of fills)
    for (const p of f.polygons) {
      sh(p.outer);
      for (const h of p.holes) sh(h);
    }
}

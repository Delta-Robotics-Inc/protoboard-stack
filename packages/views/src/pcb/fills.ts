/**
 * Zone fill from the core's shared derived type (`protoboard.zone-fill/v1`: flat nanometer rings, outer
 * counterclockwise and holes clockwise) to the scene's polygons of points. Fill without a zone record (a Circuit
 * JSON pour) has no zone to draw it under: it is counted in `unplaced` and left out, and the caller says so.
 */
import type { ZoneFillEntry } from "./board.js";
import type { ZoneFill } from "./types.js";

const ring = (flat: readonly number[]): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

export function zoneFillsFromEntries(entries: readonly ZoneFillEntry[] | undefined): { fills: ZoneFill[]; unplaced: number } {
  const fills: ZoneFill[] = [];
  let unplaced = 0;
  for (const e of entries ?? []) {
    if (!e.zone) {
      unplaced++;
      continue;
    }
    fills.push({ zone: e.zone, layer: e.layer, polygons: e.polygons.map((p) => [ring(p.outer), ...p.holes.map(ring)]) });
  }
  return { fills, unplaced };
}

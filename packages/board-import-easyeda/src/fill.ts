/**
 * Derived zone fill: the copper EasyEDA computed for each pour (POURED records) and the copper of FILL shapes,
 * which this importer turns into zones. The shape is the board core's shared `protoboard.zone-fill/v1`
 * (`@protoboardai/board`, derived.ts; contract section 4.3) with `source: "easyeda-pro"`; this module keeps its
 * earlier names as aliases and adds `ringsToPolygons`.
 */
import { zoneFillInputHash, ZONE_FILL_SCHEMA, type DerivedZoneFill, type ZoneFillEntry, type ZoneFillPolygon } from "@protoboardai/board";
import { pointInRing, signedArea2 } from "./path.js";

export const FILL_SCHEMA = ZONE_FILL_SCHEMA;
export type FillPolygon = ZoneFillPolygon;
export type FillEntry = ZoneFillEntry;
export type DerivedFill = DerivedZoneFill;
export { zoneFillInputHash };

type P = { x: number; y: number };

/** Group rings (any orientation) into polygons with holes by nesting depth: even depth is an outer ring, odd a hole. */
export function ringsToPolygons(rings: P[][]): FillPolygon[] {
  const rs = rings.filter((r) => r.length >= 3 && signedArea2(r) !== 0);
  const boxes = rs.map((r) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  });
  const area = rs.map((r) => Math.abs(signedArea2(r)));
  const containers = rs.map((r, i) => {
    const p = r[0];
    const out: number[] = [];
    rs.forEach((o, j) => {
      if (j === i || area[j] <= area[i]) return;
      const b = boxes[j];
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return;
      if (pointInRing(p, o)) out.push(j);
    });
    return out;
  });
  const flat = (r: P[], ccw: boolean): number[] => {
    const o = signedArea2(r) > 0 === ccw ? r : [...r].reverse();
    return o.flatMap((p) => [p.x, p.y]);
  };
  const polys = new Map<number, FillPolygon>();
  rs.forEach((r, i) => {
    if (containers[i].length % 2 === 0) polys.set(i, { outer: flat(r, true), holes: [] });
  });
  rs.forEach((r, i) => {
    if (containers[i].length % 2 === 0) return;
    // the smallest container is the outer ring this hole belongs to
    const parent = containers[i].reduce((best, j) => (best < 0 || area[j] < area[best] ? j : best), -1);
    polys.get(parent)?.holes.push(flat(r, false));
  });
  return [...polys.values()];
}

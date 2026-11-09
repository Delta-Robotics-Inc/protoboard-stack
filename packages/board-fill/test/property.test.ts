/**
 * Property tests on random boards: every fill passes verifyFill (exact distances), and removing any obstacle of
 * another net only grows the fill (the old fill minus the new one has no area beyond grid rounding).
 */
import { describe, expect, it } from "vitest";
import { withChanges, type BoardDocument } from "@protoboardai/board";
import { clip, fillZones, polygonRings, polygonsArea, verifyFill, type Polygon } from "../src/index.js";
import { prng, randomBoard } from "./helpers.js";

const polysOf = (d: BoardDocument): Polygon[] => (fillZones(d).fill.fills[0]?.polygons ?? []) as Polygon[];
const perimeter = (ps: Polygon[]) => {
  let s = 0;
  for (const r of polygonRings(ps)) for (let i = 0; i < r.length; i += 2) s += Math.hypot(r[(i + 2) % r.length] - r[i], r[(i + 3) % r.length] - r[i + 1]);
  return s;
};

describe("property: random pads and tracks", () => {
  for (const minWidth of [undefined, 0.2]) {
    it(`every fill verifies and removing an obstacle only grows it${minWidth ? " (minimum width)" : ""}`, () => {
      let checkedRemovals = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const { doc, obstacles } = randomBoard(seed * 97 + (minWidth ? 5 : 0), minWidth);
        const r = fillZones(doc);
        const v = verifyFill(doc, r.fill);
        expect(v.violations, `seed ${seed}`).toEqual([]);
        const before = (r.fill.fills[0]?.polygons ?? []) as Polygon[];
        const rnd = prng(seed);
        for (let k = 0; k < 3 && obstacles.length; k++) {
          const id = obstacles[Math.floor(rnd() * obstacles.length)];
          const after = polysOf(withChanges(doc, [], [id]));
          const lost = polygonsArea(clip([{ rings: polygonRings(before) }, { rings: polygonRings(after) }], (i) => i[0] && !i[1]));
          // grid rounding: under 2 nm along the boundary
          expect(lost, `seed ${seed} removing ${id}`).toBeLessThanOrEqual(2 * perimeter(before) + 1);
          expect(polygonsArea(after)).toBeGreaterThanOrEqual(polygonsArea(before) - 2 * perimeter(before));
          checkedRemovals++;
        }
      }
      expect(checkedRemovals).toBeGreaterThan(20);
    });
  }
});

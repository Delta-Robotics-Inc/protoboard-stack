/**
 * Timing on a synthetic six-layer board (100 x 80 mm, about 1,000 tracks, 230 vias, 6 large zones): a full fill
 * (target under 2 s) and an incremental refill after moving one via (target well under 200 ms). The numbers are
 * logged; the assertions allow three times the targets so a loaded machine does not fail the suite.
 */
import { describe, expect, it } from "vitest";
import { withChanges, type BoardDocument, type ViaRec } from "@protoboardai/board";
import { fillZones, refillZones, verifyFill, type FillZonesResult } from "../src/index.js";
import { synthetic6 } from "./helpers.js";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe("performance: synthetic six-layer board", () => {
  for (const minWidth of [undefined, 0.2]) {
    it(`full fill and incremental refill${minWidth ? " (minimum width 0.2 mm on every zone)" : ""}`, () => {
      const doc = synthetic6({ ...(minWidth ? { minWidth } : {}) });
      const counts = { tracks: 0, vias: 0, zones: 0 };
      for (const rec of doc.records.values()) if (rec.kind === "track") counts.tracks++;
      else if (rec.kind === "via") counts.vias++;
      else if (rec.kind === "zone") counts.zones++;
      expect(counts).toEqual({ tracks: 1000, vias: 230, zones: 6 });
      const cold = performance.now();
      let r: FillZonesResult = fillZones(doc);
      const coldMs = performance.now() - cold;
      const fulls: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        r = fillZones(doc);
        fulls.push(performance.now() - t);
      }
      const incs: number[] = [];
      let cur: BoardDocument = doc;
      for (let i = 0; i < 5; i++) {
        const v = cur.records.get(`via:v${10 + i}`) as ViaRec;
        const next = withChanges(cur, [{ ...v, x: v.x + 250_000 }]);
        const t = performance.now();
        r = refillZones(next, r, [v.id]);
        incs.push(performance.now() - t);
        cur = next;
      }
      const v = verifyFill(cur, r.fill);
      console.log(`[board-fill] synthetic 6-layer${minWidth ? `, min width ${minWidth} mm` : ""}: full fill ${coldMs.toFixed(0)} ms cold, ${median(fulls).toFixed(0)} ms warm (median of 3); incremental refill after moving one via ${median(incs).toFixed(0)} ms (median of 5, ${r.recomputed.length} zone layers patched); verify ${v.ok}`);
      expect(v.violations).toEqual([]);
      expect(median(fulls)).toBeLessThan(6000);
      expect(median(incs)).toBeLessThan(600);
    });
  }
});

/**
 * Time a full fill and an incremental refill of the synthetic six-layer board (see test/perf.test.ts), with a
 * warm-up run and the median of several runs; also checks the refilled result with verifyFill.
 *
 *   npx tsx packages/board-fill/scripts/time-synthetic.ts
 */
import { withChanges, type BoardDocument, type ViaRec } from "@protoboardai/board";
import { fillZones, refillZones, verifyFill, type FillZonesResult } from "../src/index.js";
import { synthetic6 } from "../test/helpers.js";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const minWidth of [undefined, 0.2]) {
  const doc = synthetic6({ ...(minWidth ? { minWidth } : {}) });
  fillZones(doc); // warm up
  const fulls: number[] = [];
  let r!: FillZonesResult;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    r = fillZones(doc);
    fulls.push(performance.now() - t);
  }
  const incs: number[] = [];
  let cur: BoardDocument = doc;
  let res = r;
  for (let i = 0; i < 7; i++) {
    const v = cur.records.get(`via:v${5 + i}`) as ViaRec;
    const next = withChanges(cur, [{ ...v, x: v.x + 300_000 }]);
    const t = performance.now();
    res = refillZones(next, res, [v.id]);
    incs.push(performance.now() - t);
    cur = next;
  }
  const ver = verifyFill(cur, res.fill);
  console.log(`minWidth=${minWidth ?? "none"} full median ${median(fulls).toFixed(0)} ms (${fulls.map((x) => x.toFixed(0)).join(", ")}); incremental median ${median(incs).toFixed(0)} ms (${incs.map((x) => x.toFixed(0)).join(", ")}); patched layers ${res.recomputed.length}; verify ${ver.ok} (${ver.violations.length})`);
}

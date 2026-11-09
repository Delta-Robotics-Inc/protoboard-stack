/**
 * Profile the synthetic board and print the functions taking the most time (self time).
 *   npx tsx packages/board-fill/scripts/profile.ts [minWidthMm] [full|refill]
 */
import { Session } from "node:inspector/promises";
import { withChanges, type ViaRec } from "@protoboardai/board";
import { fillZones, refillZones } from "../src/index.js";
import { synthetic6 } from "../test/helpers.js";

const minWidth = process.argv[2] && Number(process.argv[2]) > 0 ? Number(process.argv[2]) : undefined;
const mode = process.argv[3] ?? "full";
const doc = synthetic6({ ...(minWidth ? { minWidth } : {}) });
const first = fillZones(doc);
const v = doc.records.get("via:v5") as ViaRec;
const moved = withChanges(doc, [{ ...v, x: v.x + 300_000 }]);
const run = () => (mode === "full" ? fillZones(doc) : refillZones(moved, first, [v.id]));
for (let i = 0; i < 3; i++) run(); // warm up
const s = new Session();
s.connect();
await s.post("Profiler.enable");
await s.post("Profiler.start");
const t0 = performance.now();
const N = mode === "full" ? 3 : 20;
for (let i = 0; i < N; i++) run();
console.log("ms per run", ((performance.now() - t0) / N).toFixed(1));
const { profile } = await s.post("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
let total = 0;
for (const id of profile.samples ?? []) {
  const n = byId.get(id)!;
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + 1);
  total++;
}
for (const [k, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${((100 * c) / total).toFixed(1)}% ${k}`);

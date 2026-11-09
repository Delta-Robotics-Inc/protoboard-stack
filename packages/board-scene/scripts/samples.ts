/**
 * Write sample scenes and images for review, and measure what each level costs.
 *
 *   npx tsx packages/board-scene/scripts/samples.ts <out dir>
 *
 * Writes <name>.json (the compact JSON an agent receives), <name>.svg, <name>.png per sample and sizes.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingId, HUMAN, mm, openBoardService, type Finding } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { syntheticSixLayer } from "../src/fixtures/synthetic.js";
import { buildModel, describeBoard, describeWalkthrough, diffScene, svgToPng, type DescribeOptions, type DescribeResult } from "../src/index.js";

const out = process.argv[2];
if (!out) throw new Error("usage: samples.ts <out dir>");
mkdirSync(out, { recursive: true });

const sizes: Record<string, unknown>[] = [];
function save(name: string, r: DescribeResult, ms: number): void {
  writeFileSync(join(out, `${name}.json`), r.json);
  if (r.svg) writeFileSync(join(out, `${name}.svg`), r.svg);
  if (r.svg) writeFileSync(join(out, `${name}.png`), svgToPng(r.svg).png);
  sizes.push({ name, detail: r.scene.detail, ...r.stats, truncated: (r.scene.budget as { truncated?: string[] }).truncated ?? [], ms });
  console.log(`${name.padEnd(34)} ${String(r.stats.jsonChars).padStart(6)} chars  ~${String(r.stats.estTokens).padStart(5)} tok  image ${r.stats.imageWidth}x${r.stats.imageHeight} ~${r.stats.estImageTokens} tok  ${ms} ms`);
}
function run(name: string, input: Parameters<typeof describeBoard>[0], o: DescribeOptions): void {
  const t = Date.now();
  const r = describeBoard(input, o);
  save(name, r, Date.now() - t);
}

// Airnode C3
const air = airnodeC3();
const finding: Finding = {
  id: findingId("clearance", "rule:target.clearance", ["pad:mcu/module:4", "trk:f.i2c_sda.2"], { x: mm(3.6), y: mm(4.1), layer: "top" }),
  check: "clearance",
  rule: "rule:target.clearance",
  tier: "target",
  severity: "warning",
  objects: ["pad:mcu/module:4", "trk:f.i2c_sda.2"],
  location: { x: mm(3.6), y: mm(4.1), layer: "top" },
  measured: mm(0.15),
  required: mm(0.2),
  message: "sample finding (made up for the sample): clearance 0.15 mm, target 0.2 mm",
};
run("airnode-1-overview", air, {});
run("airnode-2-region-sensor", air, { region: [-18, 4, 0, 14], corridors: [{ from: "pad:sensor/r_sda:2", to: "pad:sensor/ic:1", layer: "top" }] });
run("airnode-3-object-U3", air, { object: "fp:sensor/ic" });
run("airnode-4-net-I2C_SCL", air, { net: "I2C_SCL" });
run("airnode-5-finding", air, { finding: finding.id, findings: [finding] });
run("airnode-6-top-layer-only", air, { layers: ["top"] });
run("airnode-7-corridor-blocked", air, { region: [-2, -8, 18, 8], corridors: [{ from: "pad:mcu/c_bulk:2", to: [14, 12.5], layer: "top" }] });
for (const t of describeWalkthrough(air, { cols: 3, rows: 2 })) save(`airnode-tile-${t.tile.name}`, t.result, 0);

// a change: move U3 and add a segment, then diff
const svc = openBoardService({ document: airnodeC3() });
const before = svc.snapshot();
svc.apply(
  {
    batchId: "sample-1",
    label: "move sensor and add pull-up segment",
    ops: [
      { op: "footprint.move", ids: ["fp:sensor/ic"], dx: mm(1), dy: mm(-0.5), tracks: "stay" },
      { op: "track.add", segments: [{ handle: "a", net: "I2C_SDA", layer: "top", width: mm(0.2), start: { x: mm(-7.02), y: mm(9.5) }, end: { x: mm(-5.5), y: mm(9.5) } }] },
    ],
  },
  HUMAN,
);
const d = diffScene(before, svc.snapshot(), { image: "svg" });
writeFileSync(join(out, "airnode-diff.json"), d.json);
writeFileSync(join(out, "airnode-diff.svg"), d.svg!);
writeFileSync(join(out, "airnode-diff.png"), svgToPng(d.svg!).png);
sizes.push({ name: "airnode-diff", jsonChars: d.json.length, estTokens: Math.ceil(d.json.length / 3) });
console.log(`airnode-diff ${d.json.length} chars`);
svc.close();

// the synthetic six-layer board
const t0 = Date.now();
const syn = buildModel(syntheticSixLayer().doc);
console.log(`synthetic model: ${syn.tracks.length} tracks, ${syn.vias.length} vias, ${syn.footprints.length} footprints, ${syn.nets.length} nets, ${Date.now() - t0} ms`);
run("synthetic-1-overview", syn, {});
run("synthetic-2-region", syn, { region: [-40, 5, -20, 25] });
run("synthetic-3-object-U2", syn, { object: "fp:U2" });
run("synthetic-4-net-SIG010", syn, { net: "SIG010" });
run("synthetic-5-inner2-only", syn, { layers: ["inner2"] });
run("synthetic-6-corridor", syn, { region: [-20, -5, 20, 25], corridors: [{ from: "pad:U1:9", to: "pad:U2:9", layer: "inner3" }] });

writeFileSync(join(out, "sizes.json"), `${JSON.stringify(sizes, null, 1)}\n`);

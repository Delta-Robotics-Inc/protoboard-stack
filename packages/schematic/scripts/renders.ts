/**
 * Lay out the Airnode C3 sample and write what a person or an agent looks at: both themes as SVG and PNG, the
 * defect overlay, the 5 V fault variant with its markers, a card crop, the agent scene, and the flat KiCad export
 * (verified with kicad-cli when it is installed).
 *
 *   npx tsx packages/schematic/scripts/renders.ts <output folder>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { circuitNetlist, describeSchematic, electricalChecks, exportKicad, findKicadCli, netlistsEqual, readKicadNetlist, renderSchematicSvg, scoreSchematic, svgToPng } from "../src/index.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: renders.ts <output folder>");
mkdirSync(out, { recursive: true });
const write = (name: string, svg: string, width?: number) => {
  writeFileSync(join(out, `${name}.svg`), svg);
  writeFileSync(join(out, `${name}.png`), svgToPng(svg, width ? { width } : {}).png);
};

const ok = await airnodeSchematic("ok");
const score = scoreSchematic(ok);
console.log(`Airnode C3: score ${score.score}, presentable ${score.presentable}, gates open ${score.gates.open}`);
for (const r of score.rules.filter((x) => x.count)) console.log(`  ${r.id} ${r.severity} ${r.count}/${r.opportunities}`);
write("airnode-c3-dark", renderSchematicSvg(ok, { theme: "dark", scale: 20 }));
write("airnode-c3-paper", renderSchematicSvg(ok, { theme: "paper", scale: 20, notes: ["Inside a card, wires; across cards, labels; ground and rails are symbols.", `Readability ${score.score} (rules C01 to C30); gates C01 to C06 clear.`, "Printed from the same drawing as the screen; only the theme tokens differ."] }));
write("airnode-c3-defects", renderSchematicSvg(ok, { theme: "dark", scale: 20, markers: score.defects.map((d) => ({ n: d.n, at: d.at, severity: d.severity })) }));

const fault = await airnodeSchematic("fault");
const findings = electricalChecks(fault.circuit, fault);
for (const f of findings.filter((x) => x.severity !== "info")) console.log(`fault: ${f.severity} ${f.check}: ${f.message}`);
const scene = describeSchematic(fault, { image: "svg", scale: 20 });
write("airnode-c3-fault-markers", scene.svg!);
writeFileSync(join(out, "airnode-c3-fault-scene.json"), `${JSON.stringify(scene.json, null, 1)}\n`);
const crop = describeSchematic(ok, { card: "card:sensor", image: "svg", scale: 32 });
write("airnode-c3-sensor-crop", crop.svg!);
writeFileSync(join(out, "airnode-c3-sensor-scene.json"), `${JSON.stringify(crop.json, null, 1)}\n`);
write("airnode-c3-highlight-i2c-sda", renderSchematicSvg(ok, { theme: "dark", scale: 20, highlight: "I2C_SDA" }));

const kdir = join(out, "kicad");
const ex = exportKicad(ok, { dir: kdir, project: "airnode" });
console.log(`KiCad export: ${Object.keys(ex.files).length} files; ${ex.notes.join("; ")}`);
const cli = findKicadCli();
if (cli) {
  execFileSync(cli, ["sch", "export", "netlist", "--format", "kicadsexpr", "-o", join(kdir, "airnode.net"), join(kdir, ex.root)]);
  const eq = netlistsEqual(readKicadNetlist(readFileSync(join(kdir, "airnode.net"), "utf8")), circuitNetlist(ok));
  execFileSync(cli, ["sch", "export", "svg", "-o", join(kdir, "svg"), join(kdir, ex.root)]);
  execFileSync(cli, ["sch", "erc", "--format", "json", "-o", join(kdir, "erc.json"), join(kdir, ex.root)]);
  const erc = JSON.parse(readFileSync(join(kdir, "erc.json"), "utf8")) as { sheets: { violations: { severity: string }[] }[] };
  const v = erc.sheets.flatMap((s) => s.violations);
  console.log(`kicad-cli: netlist equal ${eq.equal} (${circuitNetlist(ok).length} nets); ERC ${v.filter((x) => x.severity === "error").length} errors, ${v.filter((x) => x.severity === "warning").length} warnings`);
} else console.log("kicad-cli not found: the export was written but not verified");

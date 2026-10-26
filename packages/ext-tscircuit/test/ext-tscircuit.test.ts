/**
 * @protoboardai/ext-tscircuit end to end on a real UHD board (test/fixtures/
 * imu-tile: RP2040 + BMI270 + TPS63020 (test copies of UHD library parts, test/fixtures/uhd-parts), passives,
 * inductor and header authored in the project):
 *
 *   - the provider contract: generate → export → extract → check, all clean
 *   - the native source and its name map stay keyed to UHD instance paths
 *   - Gerber, drill, BOM, PnP, GLB, STEP, manifest and netlist are inspected,
 *     not just validated: outline, holes, placements, bodies, nets
 *   - check catches a netlist fault seeded in the native source (two nets
 *     swapped), a stale source, and layout faults (keep-out, outline,
 *     moved part, unrouted net)
 *
 * One routed build takes about 35 s and 1.2 GB; the suite builds twice.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boardNetlist,
  checkExcellon,
  checkGerber,
  checkGlb,
  checkStep,
  loadProject,
  moduleDigest,
  parseCsv,
  runCapabilityOperation,
  runProviderContract,
  type ContractReport,
  type NetlistReport,
  type Project,
} from "@protoboardai/core";
import { checkBoard } from "../lib/checks.ts";
import { readConstraints } from "../lib/config.ts";
import { boardDigest, boardProjection } from "../lib/fingerprint.ts";
import { inputsDigest, readNative, sourceDigest } from "../lib/native.ts";
import { refusedRequests } from "../lib/runtime.ts";
import { makeProject } from "./fixture.ts";
import { stepBodies } from "./step.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp");
const BOARD = "imu-tile-board";
const DIR = "src/boards/imu";
const OUT = `${DIR}/out`;
const NATIVE = `${DIR}/tscircuit`;

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let root: string;
let p: Project;
let report: ContractReport;
const read = (rel: string) => readFileSync(join(root, rel));
const text = (rel: string) => read(rel).toString("utf8");

function glbJson(bytes: Buffer) {
  const len = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString("utf8", 20, 20 + len));
}

/** Column-major 4×4 times a point. */
const apply = (m: number[], [x, y, z]: number[]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

beforeAll(async () => {
  root = await makeProject(join(TMP, "imu-tile"));
  p = await loadProject(root);
  report = await runProviderContract(p, "circuit", BOARD, { record: false });
}, 600_000);

describe("the circuit provider contract on the IMU tile board", () => {
  it("loads the project with the provider selected by circuit.config.ts only", () => {
    expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(p.capabilities.map((b) => [b.module, b.provider, b.native, b.problem])).toEqual([[BOARD, "@protoboardai/ext-tscircuit", NATIVE, undefined]]);
  });

  it("passes generate, export, extract and check with no contract problems", () => {
    expect(report.steps.map((s) => [s.operation, s.status])).toEqual([
      ["generate", "succeeded"],
      ["export", "succeeded"],
      ["extract", "succeeded"],
      ["check", "succeeded"],
    ]);
    expect(report.steps.flatMap((s) => s.problems)).toEqual([]);
    expect(report.passed).toBe(true);
    // the only findings: the fixture's land patterns that have no verification record (its RP2040 QFN-56, and
    // passives, inductor and connector on the built-in strings or from makers with no table entry)
    const findings = report.steps[3].record.diagnostics ?? [];
    expect(findings.filter((d) => d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED")).toEqual([]);
    expect(findings.every((d) => d.severity === "warning")).toBe(true);
    expect(findings.map((d) => d.message).join("\n")).toMatch(/land pattern qfn-56-7x7-p0\.4-ep3\.2 \(provider table\) for u1 is not verified: no verification record/);
    // the TPS63020's and the BMI270's land patterns are verified
    expect(findings.map((d) => d.message).join("\n")).not.toMatch(/vson-14-dsj|lga-14-3x2\.5/);
  });

  it("never reached for the network", () => {
    expect(refusedRequests).toEqual([]);
  });
});

describe("generate", () => {
  it("records a designator per instance and prints designators on the silkscreen, not instance paths (F07, F14)", () => {
    const refdes = JSON.parse(text(`${NATIVE}/refdes.json`)).assigned as Record<string, string>;
    expect(Object.values(refdes).every((d) => /^[A-Z]+\d+$/.test(d))).toBe(true);
    const silk = (JSON.parse(text(`${NATIVE}/circuit.json`)) as { type: string; text?: string }[]).filter((e) => e.type === "pcb_silkscreen_text" && /^pcb_silkscreen_text_ref_/.test((e as { pcb_silkscreen_text_id?: string }).pcb_silkscreen_text_id ?? ""));
    expect(silk.length).toBeGreaterThan(0);
    for (const t of silk) expect(Object.values(refdes)).toContain(t.text);
  });

  it("writes a source keyed to the UHD board, and leaves hand-owned files alone", () => {
    const src = text(`${NATIVE}/board.gen.tsx`);
    expect(src).toMatch(/^\/\/ @ts-nocheck\n\/\/ GENERATED by @protoboardai\/ext-tscircuit/);
    expect(src).not.toMatch(/https?:|kicad:|standard="usb_c"|auto_cloud/);
    // each part with a body carries it as a cadModel, relative to this folder (the stripped copy in models/), never a machine path
    expect(src).toContain('cadModel={{"stepUrl":"./models/bosch-bmi270-cad_step.step"');
    expect(src).not.toContain(root);
    expect(existsSync(join(root, NATIVE, "models/bosch-bmi270-cad_step.step"))).toBe(true);
    expect(src).toContain('autorouter="auto_local"');
    // every UHD pin joins its net by name
    expect(src).toContain('<trace from=".u2 > .pin14" to="net.sda" />');
    expect(src).toContain('<trace from=".u1 > .pin57" to="net.gnd" />');
    expect(src).toContain('<trace from=".u3 > .pin15" to="net.gnd" />'); // the TPS63020 exposed pad "EP" → pad 15
    expect(text(`${NATIVE}/board.tsx`)).toContain('export { default } from "./board.gen.tsx"');
    // the fixture's hand layout and land-pattern override are inputs, not outputs
    const written = report.steps[0].record.outputs.map((o) => o.path);
    expect(written).not.toContain(`${NATIVE}/layout.json`);
    expect(written).not.toContain(`${NATIVE}/footprints.json`);
  });

  it("records which land pattern and placement each instance got", () => {
    const build = JSON.parse(text(`${NATIVE}/build.json`));
    const c = build.map.components;
    expect(Object.keys(c).length).toBe(21);
    expect([c.u1.footprint, c.u1.footprintFrom, c.u2.footprint, c.u3.footprint, c.l1.footprint, c.l1.footprintFrom, c.r1.footprint]).toEqual([
      "qfn-56-7x7-p0.4-ep3.2",
      "provider",
      "lga-14-3x2.5-p0.5-bosch",
      "vson-14-dsj-4x3-p0.5",
      "xfl4020-fixture",
      "project",
      "builtin-0402",
    ]);
    expect([c.j1.placement, c.u2.placement, c.u1.placement]).toEqual(["fixed", "fixed", "layout"]);
    expect(c.u3.ports["15"]).toBe("pgnd");
    expect(c.u1.ports["57"]).toBe("pad_gnd");
    expect(build.tscircuit.core).toBe("0.0.2056");
  });

  it("routes every net", () => {
    const cj = JSON.parse(text(`${NATIVE}/circuit.json`)) as { type: string }[];
    expect(cj.filter((e) => /_error$/.test(e.type))).toEqual([]);
    expect(cj.filter((e) => e.type === "pcb_trace").length).toBeGreaterThan(40);
  });
});

describe("export", () => {
  it("writes every standard output and the three renders, under fixed names", () => {
    const files = readdirSync(join(root, OUT)).sort();
    expect(files).toEqual(["board.glb", "board.manifest.json", "board.step", "bom.csv", "gerber", "netlist.json", "pcb-bottom.svg", "pcb-top.svg", "pnp.csv", "schematic.svg"]);
    for (const f of ["schematic.svg", "pcb-top.svg", "pcb-bottom.svg"]) expect(text(`${OUT}/${f}`)).toMatch(/^<svg/);
  });

  it("is reproducible: the same inputs give the same board.step and board.glb, and check finds no drift (PB-869)", async () => {
    const before = ["board.step", "board.glb", "netlist.json", "gerber/F_Cu.gbr"].map((f) => read(`${OUT}/${f}`));
    const rec = JSON.parse(text(`${NATIVE}/export.json`));
    expect(rec.schema).toBe("protoboard.tscircuit-export/v0");
    expect(Object.keys(rec.inputs)).toEqual(["circuit", "board", "constraints", "models", "provider", "converters"]);
    expect(rec.inputs.models["bosch-bmi270#cad_step"]).toMatch(/^sha256:/);
    expect((await runCapabilityOperation(p, "circuit", "export", BOARD, {}, { record: false })).status).toBe("succeeded");
    const after = ["board.step", "board.glb", "netlist.json", "gerber/F_Cu.gbr"].map((f) => read(`${OUT}/${f}`));
    after.forEach((b, i) => expect(b.equals(before[i])).toBe(true));
    const stale = (await loadProject(root)).diagnostics.filter((d) => d.code === "CIRCUIT_STALE");
    expect(stale).toEqual([]);
  }, 300_000);

  it("names the input that changed since the export, or says the export kept no record (PB-869)", async () => {
    const file = join(root, NATIVE, "export.json");
    const original = readFileSync(file, "utf8");
    const rec = JSON.parse(original);
    rec.inputs.provider = "sha256:0";
    rec.inputs.models["bosch-bmi270#cad_step"] = "sha256:0";
    rec.inputs.converters["circuit-json-to-step"] = "0.0.1";
    writeFileSync(file, JSON.stringify(rec));
    const drift = (await loadProject(root)).diagnostics.filter((d) => d.code === "CIRCUIT_STALE").map((d) => d.message);
    rmSync(file);
    const none = (await loadProject(root)).diagnostics.filter((d) => d.code === "CIRCUIT_STALE").map((d) => d.message);
    writeFileSync(file, original);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatch(/out\/ was exported from other inputs than the current ones \(the body bosch-bmi270#cad_step; the provider's export code \(@protoboardai\/ext-tscircuit\); circuit-json-to-step 0\.0\.1 → [\d.]+\): a re-export will change its outputs/);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatch(/has no record of the inputs it was exported from/);
  }, 300_000);

  it("fingerprints what the board depends on, not a description or a price; an older record is told apart, not called stale (PB-1018)", async () => {
    const stale = async () => (await loadProject(root)).diagnostics.filter((d) => d.code === "CIRCUIT_STALE" || d.code === "CIRCUIT_FINGERPRINT_FORMAT").map((d) => `${d.severity}:${d.code}: ${d.message}`);
    // (project sources are imported once per process, so the board is changed in memory here, as a reload would see it)
    const def = p.definitions.get(BOARD)!.def;
    const projection = (d: typeof def, lookup: typeof p.lookup) => {
      const netlist = boardNetlist(d, lookup);
      return boardDigest(boardProjection(netlist, {}, Object.fromEntries(netlist.components.map((c) => [c.part, (lookup(c.part)?.interfaces ?? []).map((i) => i.id)]))));
    };
    const r1 = p.lookup("fx-r-1m-0402")!;
    // documentation and commerce: the board's description, a part's description, a price
    const documented = { ...def, description: "Described again." };
    const repriced = (id: string) => (id === "fx-r-1m-0402" ? ({ ...r1, description: "A 1 MΩ resistor, described again.", domains: [...(r1.domains ?? []), { domain: "commercial", unit_price_usd: 0.002 }] } as typeof r1) : p.lookup(id));
    expect(projection(documented, repriced)).toBe(projection(def, p.lookup));
    // the fingerprint before 0.1.7 (the whole module and every definition it reaches) called that a change
    expect(moduleDigest(documented, repriced)).not.toBe(moduleDigest(def, p.lookup));
    // a pin moved to another net, a package, a part's pins: the board
    const scl = def.links!.find((l) => [l.a, l.b].some((e) => "child" in e && e.child === "r4" && e.interfaceId === "pin_2"))!;
    expect(projection({ ...def, links: def.links!.filter((l) => l !== scl) }, p.lookup)).not.toBe(projection(def, p.lookup));
    const repackaged = (id: string) => (id === "fx-r-1m-0402" ? ({ ...r1, domains: (r1.domains ?? []).map((d) => (d.domain === "mechanical" && d.package ? { ...d, package: { ...d.package, name: "0603" } } : d)) } as typeof r1) : p.lookup(id));
    expect(projection(def, repackaged)).not.toBe(projection(def, p.lookup));
    expect(await stale()).toEqual([]);
    // a record written before 0.1.7 (the whole module's digest): one info, no false stale, until the next export
    const file = join(root, NATIVE, "export.json");
    const original = readFileSync(file, "utf8");
    const old = JSON.parse(original);
    const { board: _board, ...rest } = old.inputs;
    writeFileSync(file, JSON.stringify({ ...old, inputs: { circuit: rest.circuit, module: "sha256:whole-module", ...rest } }));
    const told = await stale();
    writeFileSync(file, original);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^info:CIRCUIT_FINGERPRINT_FORMAT: .*export\.json was written by an earlier provider, which fingerprinted the whole UHD module/);
  }, 300_000);

  it("Gerber layers carry the 30 mm round outline and copper on both sides", () => {
    const layers = readdirSync(join(root, `${OUT}/gerber`)).filter((f) => f.endsWith(".gbr")).sort();
    expect(layers).toEqual(["B_Cu.gbr", "B_Mask.gbr", "B_Paste.gbr", "B_SilkScreen.gbr", "Edge_Cuts.gbr", "F_Cu.gbr", "F_Mask.gbr", "F_Paste.gbr", "F_SilkScreen.gbr"]);
    for (const l of layers) expect(checkGerber(read(`${OUT}/gerber/${l}`)).filter((x) => x.severity !== "warning")).toEqual([]);
    const edge = text(`${OUT}/gerber/Edge_Cuts.gbr`);
    expect(edge).toContain("%TF.FileFunction,Profile,NP*%");
    // %FSLAX46Y46: coordinates in 1e-6 mm; every outline vertex lies on r = 15 mm
    const pts = [...edge.matchAll(/X(-?\d+)Y(-?\d+)D0[12]\*/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2])) / 1e6);
    expect(pts.length).toBeGreaterThanOrEqual(32);
    for (const r of pts) expect(r).toBeCloseTo(15, 2);
    expect(text(`${OUT}/gerber/F_Cu.gbr`)).toContain("%TF.FileFunction,Copper,L1,Top*%");
    expect(text(`${OUT}/gerber/B_Cu.gbr`)).toMatch(/%TF.FileFunction,Copper,L2,Bot\*%[\s\S]*D01\*/); // traces on the bottom too
    expect(edge).not.toMatch(/CreationDate/); // timestamps removed: reproducible files
  });

  it("drill files hold the two Ø2.2 mm mounting holes and one hole per via", () => {
    const npth = text(`${OUT}/gerber/drill_npth.drl`);
    const pth = text(`${OUT}/gerber/drill-L1-L2.drl`);
    for (const d of [npth, pth]) expect(checkExcellon(Buffer.from(d))).toEqual([]);
    expect(npth).toMatch(/T\d+C2\.2/);
    const holes = [...npth.matchAll(/^X(-?[\d.]+)Y(-?[\d.]+)/gm)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(holes).toEqual([
      [-11, -6],
      [11, -6],
    ]);
    const cj = JSON.parse(text(`${NATIVE}/circuit.json`)) as { type: string }[];
    expect([...pth.matchAll(/^X-?[\d.]+Y-?[\d.]+$/gm)].length).toBe(cj.filter((e) => e.type === "pcb_via").length);
    expect(pth).toMatch(/T\d+C0\.3/); // the config's 0.3 mm via drill
  });

  it("BOM and pick-and-place are keyed by UHD instance path, with each part's MPN", () => {
    const bom = parseCsv(text(`${OUT}/bom.csv`)).rows;
    expect(bom[0]).toEqual(["instance", "part", "name", "kind", "manufacturer", "mpn", "value", "package", "quantity", "lcsc", "supplier_part_numbers"]);
    expect(bom.length).toBe(22);
    const row = (i: string) => bom.find((r) => r[0] === i)!;
    expect(row("u1").slice(0, 8)).toEqual(["u1", "rp2040", "MCU", "ic", "Raspberry Pi", "RP2040", "", "QFN-56"]);
    expect(row("l1").slice(4, 8)).toEqual(["Coilcraft", "XFL4020-152ME", "1.5 µH", "XFL4020"]);
    expect(row("r3")[6]).toBe("4.7 kΩ");
    expect(row("c3")[6]).toBe("22 µF");
    const pnp = parseCsv(text(`${OUT}/pnp.csv`)).rows;
    const at = (i: string) => pnp.find((r) => r[0] === i)!.slice(1, 5);
    expect(at("u2")).toEqual(["5", "5", "0", "top"]);
    expect(at("u1")).toEqual(["-4", "2", "0", "top"]);
    expect(at("c3")).toEqual(["4.3", "0.3", "90", "top"]);
  });

  it("board.glb: glTF metres, Y up; one node per instance placed where the PnP says, with the part's own body or a package box", () => {
    const glb = read(`${OUT}/board.glb`);
    expect(checkGlb(glb)).toEqual([]);
    const j = glbJson(glb);
    const rootNode = j.nodes[j.scenes[0].nodes[0]];
    expect(rootNode.name).toBe("board");
    const named = new Map<string, { translation: number[]; mesh: number }>(j.nodes.filter((n: { name?: string }) => n.name).map((n: { name: string }) => [n.name, n]));
    for (const i of ["u1", "u2", "u3", "l1", "j1", "c12", "r4"]) expect(named.has(i)).toBe(true);
    // the viewer's mapping back to CAD: (x, -z, y) × 1000
    const world = (i: string) => {
      const [x, y, z] = apply(rootNode.matrix, named.get(i)!.translation);
      return [x * 1000, -z * 1000, y * 1000].map((v) => Math.round(v * 1000) / 1000);
    };
    expect(world("u2")).toEqual([5, 5, 0.5]);
    expect(world("u1")).toEqual([-4, 2, 0.5]);
    const size = (i: string) => {
      const prim = j.meshes[named.get(i)!.mesh].primitives[0];
      const a = j.accessors[prim.attributes.POSITION];
      return a.max.map((v: number, k: number) => Math.round((v - a.min[k]) * 100) / 100);
    };
    expect(size("u1")).toEqual([7, 0.9, 7]); // box from the RP2040's package facts (7 × 7 × 0.9)
    expect(size("u2")).toEqual([3, 0.83, 2.5]); // the BMI270's own STEP body, without its 0.25 mm pcb_mount feature shapes
    expect(size("l1")).toEqual([4, 2.1, 4]);
    expect(report.steps[1].record.data).toMatchObject({ bodies: { u2: "part", u3: "part", u1: "box", r1: "box", j1: "box" } });
  });

  it("board.step: every body sits on the board top at its footprint origin, named by instance path", () => {
    const step = text(`${OUT}/board.step`);
    expect(checkStep(Buffer.from(step))).toEqual([]);
    expect(step).toContain("MANIFOLD_SOLID_BREP('PCB'");
    const items = [...step.matchAll(/MAPPED_ITEM\('([^']*)'/g)].map((m) => m[1]).sort();
    expect(items).toEqual(p.definitions.get(BOARD)!.def.children!.map((c) => c.id).sort());

    // world bounding boxes of the bodies, resolved through each mapped item's placement
    const bodies = stepBodies(step);
    const r3 = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000);
    const board = bodies.get("PCB")!;
    expect(r3([board.min[2], board.max[2]])).toEqual([-0.5, 0.5]); // 1.0 mm board, mid-plane at z = 0
    const top = board.max[2];
    const pnp = parseCsv(text(`${OUT}/pnp.csv`)).rows;
    expect(pnp.length - 1).toBe(items.length);
    // each body's origin (these bodies are centred on theirs) goes to the footprint origin, pcbX/pcbY, which
    // differs from the pick-and-place (pad bounding-box) centre when the pads are not centred (j1's tabs)
    const cj = JSON.parse(text(`${NATIVE}/circuit.json`)) as { type: string; name?: string; source_component_id?: string; display_offset_x?: number; display_offset_y?: number }[];
    const names = new Map(cj.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e.name]));
    const origin = new Map(cj.filter((e) => e.type === "pcb_component").map((e) => [names.get(e.source_component_id), [e.display_offset_x!, e.display_offset_y!]]));
    for (const [instance, x, y] of pnp.slice(1)) {
      const b = bodies.get(instance)!;
      const o = origin.get(instance)!;
      expect([instance, ...r3(b.centre.slice(0, 2)), r3([b.min[2]])[0]]).toEqual([instance, ...r3(o), top]);
      expect(Math.hypot(o[0] - Number(x), o[1] - Number(y))).toBeLessThan(0.05); // and, here, close to the pick-and-place centre
    }
    // sizes: the package box (u1), the parts' own bodies (u2, u3), a box turned 90° (c3)
    expect(r3(bodies.get("u1")!.size)).toEqual([7, 7, 0.9]);
    expect(r3(bodies.get("u2")!.size)).toEqual([3, 2.5, 0.83]);
    expect(r3(bodies.get("u3")!.size)).toEqual([4, 3, 0.9]);
    expect(r3(bodies.get("c3")!.size)).toEqual([1.25, 2, 0.85]);

    // models are named machine-independently, and the header date is fixed
    const reps = [...step.matchAll(/ADVANCED_BREP_SHAPE_REPRESENTATION\('([^']*)'/g)].map((m) => m[1]);
    expect(reps).toEqual(expect.arrayContaining(["bosch-bmi270#cad_step", "ti-tps63020dsjr#cad_step", `${NATIVE}/models/box-7x7x0.9.step`]));
    expect(step).not.toContain(root);
    expect(step).not.toMatch(/node_modules|\/home\/|\/tmp\//);
    expect(step).toMatch(/FILE_NAME\('PCB','1970-01-01T00:00:00'/);
  });

  it("board.manifest.json: outline, holes, a frame per component and per board export", () => {
    const m = JSON.parse(text(`${OUT}/board.manifest.json`));
    expect(m).toMatchObject({ artifact: "board.glb", tool: "tscircuit", toolVersion: "@tscircuit/core@0.0.2056", units: "mm" });
    expect(m.features.outline.area_mm2).toBeCloseTo(Math.PI * 15 ** 2, -1);
    expect(m.features.outline.centroid.map((v: number) => Math.round(v * 100) / 100)).toEqual([0, 0, -0.5]);
    expect(m.features.outline.normal).toEqual([0, 0, -1]);
    expect(m.features.mount_left.centroid).toEqual([-11, -6, -0.5]);
    expect(m.features.mount_right.area_mm2).toBeCloseTo(Math.PI * 1.1 ** 2, 3);
    for (const c of p.definitions.get(BOARD)!.def.children!) expect(m.features[c.id]).toBeDefined();
    expect(m.features.u2.frame).toEqual({ origin: [5, 5, 0.5], normal: [0, 0, 1], xAxis: [1, 0, 0] });
    // the header's mouth faces the board edge it sits at (+Y)
    expect(m.features.j1.normal).toEqual([0, 1, 0]);
    expect(m.features.port.frame).toEqual(m.features.j1.frame);
    expect(m.features.swd.frame.origin).toEqual([-4, 2, 0.5]);
  });

  it("netlist.json: the copper joins exactly the UHD nets", () => {
    const laid = JSON.parse(text(`${OUT}/netlist.json`)) as NetlistReport;
    const intended = boardNetlist(p.definitions.get(BOARD)!.def, p.lookup).nets;
    expect(laid.nets.map((n) => [n.id, [...n.pins].sort()])).toEqual(intended.map((n) => [n.id, [...n.pins].sort()]));
  });

  it("is reproducible: a second export writes the same fabrication files", async () => {
    const before = Object.fromEntries(["gerber/F_Cu.gbr", "gerber/Edge_Cuts.gbr", "gerber/drill-L1-L2.drl", "bom.csv", "pnp.csv", "netlist.json", "board.manifest.json", "board.step"].map((f) => [f, text(`${OUT}/${f}`)]));
    const again = await runCapabilityOperation(p, "circuit", "export", BOARD, {}, { record: false });
    expect(again.status).toBe("succeeded");
    for (const [f, t] of Object.entries(before)) expect(text(`${OUT}/${f}`)).toBe(t);
  }, 120_000);
});

describe("extract", () => {
  it("returns frames for the board's exports and the artifacts to reference", () => {
    const facts = report.steps[2].record.data as { frames: Record<string, { origin: number[]; normal: number[] }>; artifacts: { id: string; filePath: string; role?: string; format?: string }[]; geometry: { components: Record<string, { at: number[] }> } };
    expect(Object.keys(facts.frames).sort()).toEqual(["port", "swd"]);
    expect(facts.frames.port.normal).toEqual([0, 1, 0]);
    expect(facts.artifacts.map((a) => a.id)).toEqual(expect.arrayContaining(["board_glb", "board_step", "board_manifest", "board_gerber", "board_bom", "board_pnp", "board_netlist", "board_schematic", "board_pcb_top", "board_pcb_bottom", "board_source", "board_routed", "board_build"]));
    expect(facts.artifacts.find((a) => a.id === "board_source")).toMatchObject({ role: "source", format: "tscircuit", filePath: `${NATIVE}/board.tsx` });
    expect(facts.artifacts.find((a) => a.id === "board_manifest")).toMatchObject({ provenance: { tool: "tscircuit", generatedFrom: "board_glb" } });
    expect(facts.geometry.components.j1.at).toEqual([0, 11.5]);
  });

  it("the board's outputs reach it by themselves: a fresh load attaches what extract reports, from the manifest's one list (PB-1030)", async () => {
    const facts = report.steps[2].record.data as { artifacts: { id: string; filePath: string }[] };
    const q = await loadProject(root);
    const def = q.definitions.get(BOARD)!.def;
    expect(def.artifacts!.map((a) => `${a.id}=${a.filePath}`).sort()).toEqual(facts.artifacts.map((a) => `${a.id}=${a.filePath}`).sort());
    expect(q.capabilities.find((b) => b.module === BOARD)!.attached).toEqual(expect.arrayContaining(["board_schematic", "board_pcb_top", "board_routed", "board_glb"]));
    // not locked: no KiCad project is attached
    expect(def.artifacts!.some((a) => a.id === "board_kicad")).toBe(false);
    expect(q.diagnostics.map((d) => d.code)).not.toContain("PB_VIEW_UNREACHABLE");
  });
});

describe("check", () => {
  const input = (native = readNative(root, NATIVE)) => {
    const def = p.definitions.get(BOARD)!.def;
    const netlist = boardNetlist(def, p.lookup);
    const { constraints } = readConstraints(p.capabilities[0].constraints, netlist.envelope);
    const raw = p.capabilities[0].constraints;
    return { native, netlist, netlistDigest: native!.build.netlistDigest, sourceDigest: sourceDigest(root, NATIVE), inputsDigest: inputsDigest(root, NATIVE, raw), constraints, file: `${NATIVE}/board.gen.tsx`, module: BOARD };
  };
  /** The built board with `edit` applied to a copy of its circuit JSON. */
  const edited = (edit: (cj: Record<string, any>[]) => void) => {
    const n = readNative(root, NATIVE)!;
    const cj = structuredClone(n.circuitJson);
    edit(cj);
    return { ...n, circuitJson: cj };
  };
  // land-pattern verification has its own tests (units.test.ts); these are about the built board
  const codes = async (native = readNative(root, NATIVE)) => (await checkBoard(input(native))).filter((d) => d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED").map((d) => `${d.severity}:${d.code}`);
  const sourceComponent = (cj: Record<string, any>[], name: string) => cj.find((e) => e.type === "source_component" && e.name === name)!;
  const pcbComponent = (cj: Record<string, any>[], name: string) => cj.find((e) => e.type === "pcb_component" && e.source_component_id === sourceComponent(cj, name).source_component_id)!;

  it("finds layout faults: copper in the keep-out, a pad off the board, a moved header, an unrouted net", async () => {
    const pad = (cj: Record<string, any>[], name: string) => cj.find((e) => e.type === "pcb_smtpad" && e.pcb_component_id === pcbComponent(cj, name).pcb_component_id)!;
    expect(await codes(edited((cj) => Object.assign(pad(cj, "c2"), { x: 0, y: -12 })))).toContain("error:CIRCUIT_KEEPOUT");
    expect(await codes(edited((cj) => Object.assign(pad(cj, "r2"), { x: 16, y: 0 })))).toContain("error:CIRCUIT_OUTSIDE_OUTLINE");
    expect(await codes(edited((cj) => Object.assign(pcbComponent(cj, "j1"), { display_offset_x: 0.5 })))).toContain("error:CIRCUIT_PLACEMENT_MOVED");
    const unrouted = await checkBoard(
      input(
        edited((cj) => {
          // delete the copper of IMU_INT1: its traces and their vias
          const net = cj.find((e) => e.type === "source_net" && e.name === "imu_int1")!.source_net_id;
          const traces = new Set(cj.filter((e) => e.type === "pcb_trace" && e.connection_name === net).map((e) => e.pcb_trace_id));
          expect(traces.size).toBeGreaterThan(0);
          const keep = cj.filter((e) => !(e.type === "pcb_trace" && traces.has(e.pcb_trace_id)) && !(e.type === "pcb_via" && traces.has(e.pcb_trace_id)));
          cj.splice(0, cj.length, ...keep);
        }),
      ),
    );
    expect(unrouted.map((d) => d.message).join("\n")).toMatch(/imu_int1 is not routed/);
  });

  it("reports a source edited after the build as stale, without building", async () => {
    const gen = join(root, NATIVE, "board.gen.tsx");
    const original = readFileSync(gen, "utf8");
    writeFileSync(gen, original + "\n// edited\n");
    const stale = input();
    writeFileSync(gen, original);
    expect((await checkBoard(stale)).map((d) => d.code).filter((c) => c !== "CIRCUIT_FOOTPRINT_UNVERIFIED")).toEqual(["CIRCUIT_STALE"]);
  });

  it("reports a hand edit to layout.json as stale until generate runs (generate bakes the layout into the source)", async () => {
    const layout = join(root, NATIVE, "layout.json");
    const original = readFileSync(layout, "utf8");
    const moved = JSON.parse(original);
    moved.u1.at = [moved.u1.at[0] + 1, moved.u1.at[1]];
    writeFileSync(layout, JSON.stringify(moved, null, 2) + "\n");
    const stale = input();
    writeFileSync(layout, original);
    const found = (await checkBoard(stale)).filter((d) => d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED");
    expect(found.map((d) => d.code)).toEqual(["CIRCUIT_STALE"]);
    expect(found[0].message).toMatch(/layout\.json.*run circuit:generate/);
    expect(await codes()).toEqual([]);
  });

  it("catches two nets swapped in the native source, through `protoboard check`", async () => {
    // a copy of the project, so the clean board above stays as it is
    const faulty = join(TMP, "imu-tile-fault");
    rmSync(faulty, { recursive: true, force: true });
    cpSync(root, faulty, { recursive: true });
    const gen = join(faulty, NATIVE, "board.gen.tsx");
    const src = readFileSync(gen, "utf8");
    const sda = '<trace from=".u2 > .pin14" to="net.sda" />';
    const scl = '<trace from=".u2 > .pin13" to="net.scl" />';
    expect(src).toContain(sda);
    expect(src).toContain(scl);
    writeFileSync(gen, src.replace(sda, "@@SDA@@").replace(scl, sda.replace("pin14", "pin13")).replace("@@SDA@@", scl.replace("pin13", "pin14")));

    // loading runs the checks; check is pure, so before a rebuild it can only say the source is stale
    const q = await loadProject(faulty);
    expect(q.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-tscircuit/circuit:check" && d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED").map((d) => d.code)).toEqual(["CIRCUIT_STALE"]);

    // export rebuilds the edited source; then check compares its copper with UHD
    const rebuilt = await runCapabilityOperation(q, "circuit", "export", BOARD, {}, { record: false });
    expect(rebuilt.status).toBe("succeeded");
    const r = await loadProject(faulty);
    const found = r.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-tscircuit/circuit:check" && d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED");
    expect(found.every((d) => d.entity.id === BOARD && d.source?.file === `${NATIVE}/board.gen.tsx`)).toBe(true);
    const msgs = found.map((d) => `${d.code}: ${d.message}`).join("\n");
    expect(msgs).toMatch(/CIRCUIT_NET_SHORT: copper joins nets scl \+ sda/);
    expect(msgs).toMatch(/CIRCUIT_NET_OPEN: sda is split into 2 copper pieces/);
    expect(msgs).toMatch(/CIRCUIT_NET_OPEN: scl is split into 2 copper pieces/);
    expect(r.checks.find((c) => c.validator === "ext:@protoboardai/ext-tscircuit/circuit:check")).toMatchObject({ status: "ran", subject: BOARD });
    // the laid-out netlist now names the merged pieces honestly
    const laid = JSON.parse(readFileSync(join(faulty, OUT, "netlist.json"), "utf8")) as NetlistReport;
    expect(laid.nets.map((n) => n.id)).toContain("scl+sda");
    expect(existsSync(join(faulty, OUT, "board.glb"))).toBe(true);
  }, 300_000);
});

/**
 * Export completeness and routing controls (PB-1013, owner's scope for 0.1.7), on
 * boards small enough to build in a second:
 *
 *   - cadModel in the generated source for every part with a body (STEP, else GLB or OBJ),
 *     relative to the board's source folder; board.glb draws a GLB-only part's mesh
 *   - supplier part numbers (LCSC first) from the project's offers, in the source, BOM and PnP
 *   - land patterns by package family, and a mismatch reported instead of a guess
 *   - routing off, per-net and per-class trace widths, the via policy, hole-to-copper clearance
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv, type BoardNetlist } from "@protoboardai/core";
import { checkBoard, holeClearanceFaults, narrowestTraces, viasTouchingPads } from "../lib/checks.ts";
import { readConstraints, type BoardConstraints } from "../lib/config.ts";
import { packageFamily, resolveFootprint } from "../lib/footprints.ts";
import { applyBodies, boxStep, cadModels, withMeshes, type ComponentBody } from "../lib/models.ts";
import { BUILD_SCHEMA, joinPads } from "../lib/native.ts";
import { boardGlb, bomCsv, pnpCsv } from "../lib/outputs.ts";
import { buildCircuit, type CircuitElement } from "../lib/runtime.ts";
import { generateSource, type NameMap } from "../lib/source.ts";
import { supplierNumbers, supplierKey } from "../lib/suppliers.ts";
import { componentFields, lcscNumbers } from "../lib/kicad/fields.ts";
import { UHD_PARTS } from "./fixture.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-controls");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const netlist: BoardNetlist = {
  schema: "protoboard.board-netlist/v0",
  board: "b",
  components: [
    { instance: "u1", part: "x", name: "X", kind: "ic", mpn: "X-1", package: { name: "TRIPAD", pin_count: 2, exposed_pad: true }, pins: [{ interface: "gnd", pin: "1", name: "GND", kind: "ground" }, { interface: "sig", pin: "2", name: "SIG", kind: "signal" }], bodies: [] },
    { instance: "r1", part: "r", name: "R", kind: "resistor", mpn: "RC0402FR-071KL", value: { value: 1e3, unit: "Ω" }, package: { name: "0402", pin_count: 2, exposed_pad: false }, pins: [{ interface: "pin_1", pin: "1", name: "1", kind: "passive" }, { interface: "pin_2", pin: "2", name: "2", kind: "passive" }], bodies: [] },
  ],
  nets: [
    { id: "gnd", name: "GND", kind: "ground", pins: ["r1:pin_1", "u1:gnd"], links: [] },
    { id: "s", name: "S", kind: "signal", pins: ["r1:pin_2", "u1:sig"], links: [] },
  ],
  edge: [],
  problems: [],
};
const tripad = { id: "tripad", match: { package: "TRIPAD" }, pads: [{ pin: "1", x: -2, y: 0, w: 1, h: 1 }, { pin: "1", x: 0, y: 0, w: 1, h: 1 }, { pin: "1", x: 2, y: 0, w: 1, h: 1 }, { pin: "2", x: 0, y: 2, w: 0.6, h: 0.6 }], source: "test", verified: false as const };
const layout = { u1: { at: [0, -3] as [number, number], rotation_deg: 0, side: "top" as const }, r1: { at: [0, 4] as [number, number], rotation_deg: 0, side: "top" as const } };
const constraintsOf = (raw: Record<string, unknown> = {}) => {
  const r = readConstraints({ outline: { rect: { width_mm: 16, height_mm: 16 } }, ...raw });
  expect(r.problems).toEqual([]);
  return r.constraints!;
};

/** Build a source as the provider does (the multi-pad joins laid after routing, native.ts joinPads). */
async function build(name: string, source: string, map?: NameMap) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "board.tsx"), source);
  const b = await buildCircuit(join(dir, "board.tsx"));
  expect(b.circuitJson.filter((e) => /_error$/.test(e.type))).toEqual([]);
  return map ? joinPads(b.circuitJson, map) : b.circuitJson;
}

const check = (cj: CircuitElement[], map: NameMap, constraints: BoardConstraints, nl = netlist) =>
  checkBoard({ native: { circuitJson: cj, build: { schema: BUILD_SCHEMA, map, sourceDigest: "s", netlistDigest: "n", inputsDigest: "i", tscircuit: { core: "x" }, build_ms: 0, log: [] } }, netlist: nl, netlistDigest: "n", sourceDigest: "s", inputsDigest: "i", constraints, file: "board.gen.tsx", module: "b", overrides: { packages: [tripad] } }).then((ds) => ds.filter((d) => d.code !== "CIRCUIT_FOOTPRINT_UNVERIFIED"));

describe("bodies in the generated board (cadModel)", () => {
  const root = join(TMP, "project");
  const native = "src/boards/b/tscircuit";
  const step = join(root, "parts/local/x/out/body.step");
  const glb = join(root, "parts/catalog/r/body.glb");
  const bodies: ComponentBody[] = [
    { instance: "u1", source: "part", step, label: "x#cad_step", artifact: "cad_step", mountOrigin: [0, 0, -0.1] },
    { instance: "r1", source: "part", artifact: "cad_glb", mesh: { format: "glb", path: glb, label: "r#cad_glb", units: "m" }, box: { path: `${native}/models/box-1x0.5x0.35.step`, size: [1, 0.5, 0.35] }, label: `${native}/models/box-1x0.5x0.35.step` },
  ];

  it("writes each part's body as a path relative to the board's source folder, the same on every OS", () => {
    const models = cadModels(root, native, bodies);
    expect(models).toEqual({
      u1: { stepUrl: "../../../../parts/local/x/out/body.step", modelOriginPosition: { x: 0, y: 0, z: -0.1 } },
      r1: { glbUrl: "../../../../parts/catalog/r/body.glb", modelUnitToMmScale: 1000, modelBoardNormalDirection: "y+" },
    });
    const g = generateSource({ netlist, constraints: constraintsOf(), overrides: { packages: [tripad] }, layout, models });
    expect(g.source).toContain('cadModel={{"stepUrl":"../../../../parts/local/x/out/body.step","modelOriginPosition":{"x":0,"y":0,"z":-0.1}}}');
    expect(g.source).toContain('cadModel={{"glbUrl":"../../../../parts/catalog/r/body.glb","modelUnitToMmScale":1000,"modelBoardNormalDirection":"y+"}}');
  });

  it("builds with the models in place, and board.glb draws a GLB-only part's mesh instead of its box", async () => {
    mkdirSync(join(root, "parts/local/x/out"), { recursive: true });
    mkdirSync(join(root, "parts/catalog/r"), { recursive: true });
    mkdirSync(join(root, native, "models"), { recursive: true });
    writeFileSync(step, boxStep("x", [5, 3, 1]));
    copyFileSync(join(UHD_PARTS, "files/library/parts/bosch-bmi270/artifacts/cad/bosch-bmi270-lga14.glb"), glb);
    writeFileSync(join(root, bodies[1].box!.path), boxStep("box", [1, 0.5, 0.35]));
    const g = generateSource({ netlist, constraints: constraintsOf(), overrides: { packages: [tripad] }, layout, models: cadModels(root, native, bodies) });
    mkdirSync(join(root, native), { recursive: true });
    writeFileSync(join(root, native, "board.tsx"), g.source);
    const cj = (await buildCircuit(join(root, native, "board.tsx"))).circuitJson;
    expect(cj.filter((e) => /_error$/.test(e.type))).toEqual([]);
    const cad = cj.filter((e) => e.type === "cad_component");
    expect(cad.map((c) => c.model_step_url ?? c.model_glb_url).sort()).toEqual(["../../../../parts/catalog/r/body.glb", "../../../../parts/local/x/out/body.step"]);
    // the provider's exports set absolute paths on a copy: the STEP, the box for board.step, the mesh for board.glb
    const { circuitJson: withBodies, used } = applyBodies(cj, g.map, bodies, root);
    expect(used).toEqual({ u1: "part", r1: "part" });
    expect(withBodies.filter((e) => e.type === "cad_component").map((c) => c.model_step_url).sort()).toEqual([join(root, bodies[1].box!.path), step].sort());
    const meshed = withMeshes(withBodies, g.map, bodies).filter((e) => e.type === "cad_component");
    expect(meshed.map((c) => c.model_glb_url ?? c.model_step_url).sort()).toEqual([glb, step].sort());
    const withMesh = await boardGlb(withMeshes(withBodies, g.map, bodies), g.map);
    const boxed = await boardGlb(withBodies, g.map);
    expect(withMesh.failed).toEqual([]);
    expect(boxed.failed).toEqual([]);
    expect(withMesh.glb.length).toBeGreaterThan(boxed.glb.length);
  }, 120_000);
});

describe("supplier part numbers", () => {
  const root = join(TMP, "suppliers");
  it("reads LCSC first, then DigiKey and Mouser, from the library's offers and the project's sourcing record, for the component's own MPN", () => {
    mkdirSync(join(root, "parts/evidence/x"), { recursive: true });
    writeFileSync(join(root, "parts/offers.json"), JSON.stringify({ schema: "protoboard.offers/v0", parts: { r: [{ supplier: "Mouser", sku: "603-RC0402FR-071KL", mpn: "RC0402FR-071KL" }, { supplier: "LCSC", sku: "C11702", mpn: "RC0402FR-071KL" }, { supplier: "LCSC", sku: "C25744", mpn: "RC0402FR-0710KL" }, { supplier: "Arrow", sku: "A1" }] } }));
    writeFileSync(join(root, "parts/evidence/x/sourcing.json"), JSON.stringify({ schema: "protoboard.sourcing/v0", part: "x", mpn: "X-1", offers: [{ supplier: "LCSC / JLCPCB assembly", supplier_sku: "C2860939" }, { supplier: "DigiKey", supplier_sku: "296-X-1-ND", mpn: "X-1" }] }));
    expect(supplierKey("LCSC / JLCPCB assembly")).toBe("lcsc");
    expect(supplierKey("Digi-Key")).toBe("digikey");
    const s = supplierNumbers(root, netlist.components);
    expect(s).toEqual({ u1: { lcsc: ["C2860939"], digikey: ["296-X-1-ND"] }, r1: { lcsc: ["C11702"], mouser: ["603-RC0402FR-071KL"] } });
    expect(Object.keys(s.r1)).toEqual(["lcsc", "mouser"]);
    // the KiCad fields written at lock read the same offers (PB-1033): the project part's evidence, the library part's offers
    const lcsc = lcscNumbers(root);
    expect(netlist.components.map((c) => componentFields(c, lcsc).LCSC)).toEqual(["C2860939", "C11702"]);
    const g = generateSource({ netlist, constraints: constraintsOf(), overrides: { packages: [tripad] }, layout, suppliers: s });
    expect(g.source).toContain('supplierPartNumbers={{"lcsc":["C2860939"],"digikey":["296-X-1-ND"]}}');
    const bom = parseCsv(bomCsv(netlist, s));
    expect(bom.rows[0].slice(-2)).toEqual(["lcsc", "supplier_part_numbers"]);
    expect(bom.rows.slice(1).map((r) => [r[0], r[9], r[10]])).toEqual([
      ["u1", "C2860939", "lcsc:C2860939 digikey:296-X-1-ND"],
      ["r1", "C11702", "lcsc:C11702 mouser:603-RC0402FR-071KL"],
    ]);
    const pnp = parseCsv(pnpCsv(netlist, { components: [{ instance: "r1", center: [0, 4], rotation_deg: 0, side: "top", part: "r" }] } as never, s));
    expect(pnp.rows[0].at(-1)).toBe("lcsc");
    expect(pnp.rows[1].at(-1)).toBe("C11702");
  });
});

describe("land patterns by package family", () => {
  it("reads the same package in different words as one family", () => {
    expect(["SOT-23-5", "SOT23-5", "SOT23-5L", "sot 23-5"].map((n) => packageFamily(n, 5))).toEqual(["sot23-5", "sot23-5", "sot23-5", "sot23-5"]);
    expect(packageFamily("SOT23 leads (SMD)", 3)).toBe("sot23");
    expect(packageFamily("SOT-23", 3)).toBe("sot23");
    expect(packageFamily("0402 (1005 metric) chip", 2)).toBe("chip-0402");
    expect(packageFamily("1608 metric", 2)).toBe("chip-0603");
    expect(["QFN-32-EP", "VQFN-32", "WQFN32"].map((n) => packageFamily(n, 32))).toEqual(["qfn-32", "qfn-32", "qfn-32"]);
    expect(packageFamily("VSSOP-10", 10)).toBe("msop-10");
    expect(packageFamily("ESP32-C3-MINI-1 module, 53 pins", 53)).toBeUndefined();
  });

  it("picks an entry by family when its facts agree, and says so in check", async () => {
    const r = resolveFootprint("u3", { name: "SOT23-5L", pin_count: 5 });
    expect(r).toMatchObject({ from: "provider", by: "family", entry: { id: "builtin-sot23_5" } });
    expect(resolveFootprint("u3", { name: "SOT-23-5", pin_count: 5 })).toMatchObject({ by: "name", entry: { id: "builtin-sot23_5" } });
    expect(resolveFootprint("r9", { name: "0402 (1005 metric) chip", pin_count: 2, manufacturer: "Yageo" })).toMatchObject({ by: "family", entry: { id: "yageo-rc0402-reflow" } });
    const nl: BoardNetlist = { ...netlist, components: [{ instance: "u3", part: "ldo", name: "LDO", kind: "ic", package: { name: "SOT23-5L", pin_count: 5, exposed_pad: false }, pins: [], bodies: [] }], nets: [] };
    const found = await checkBoard({ netlist: nl, netlistDigest: "n", sourceDigest: "s", inputsDigest: "i", file: "f", module: "b" });
    expect(found.filter((d) => d.code === "CIRCUIT_FOOTPRINT_FAMILY").map((d) => [d.severity, d.message])).toEqual([["info", 'u3 (ldo): package "SOT23-5L" has land pattern builtin-sot23_5 by its family sot23-5 (the entry says "SOT-23-5"); its pin count agree']]);
  });

  it("reports a package that entries of its name or family do not fit, instead of picking one", async () => {
    const qfn = { name: "QFN-56-EP", pin_count: 56, pitch_mm: 0.5, size_mm: { length: 7, width: 7 } };
    const r = resolveFootprint("u1", qfn);
    expect(r.entry).toBeUndefined();
    expect(r.near).toEqual(["qfn-56-7x7-p0.4-ep3.2 (family qfn-56): pitch 0.4 mm, the part 0.5 mm"]);
    const nl: BoardNetlist = { ...netlist, components: [{ instance: "u1", part: "mcu", name: "MCU", kind: "ic", package: { ...qfn, exposed_pad: true }, pins: [], bodies: [] }], nets: [] };
    expect(generateSource({ netlist: nl, constraints: constraintsOf() }).problems).toEqual(["u1 (mcu): no land pattern for package QFN-56-EP (56 pins, 0.5 mm pitch); entries of that package do not fit its facts: qfn-56-7x7-p0.4-ep3.2 (family qfn-56): pitch 0.4 mm, the part 0.5 mm; add one to tscircuit/footprints.json"]);
    const found = await checkBoard({ netlist: nl, netlistDigest: "n", sourceDigest: "s", inputsDigest: "i", file: "f", module: "b" });
    expect(found.filter((d) => d.code === "CIRCUIT_FOOTPRINT_MISMATCH").map((d) => d.severity)).toEqual(["error"]);
  });
});

describe("routing controls", () => {
  it("routing off: no autorouting, placement only; unrouted nets are information", async () => {
    const c = constraintsOf({ routing: "off" });
    const g = generateSource({ netlist, constraints: c, overrides: { packages: [tripad] }, layout });
    expect(g.source).toMatch(/\n\s+routingDisabled\n/);
    const cj = await build("routing-off", g.source);
    expect(cj.filter((e) => e.type === "pcb_trace")).toEqual([]);
    const found = await check(cj, g.map, c);
    expect(found.filter((d) => d.severity === "error")).toEqual([]);
    expect(found.filter((d) => d.code === "CIRCUIT_UNROUTED").map((d) => d.severity)).toEqual(["info", "info"]);
    expect(found.filter((d) => d.code === "CIRCUIT_UNROUTED").map((d) => [d.location?.nets, d.location?.components?.sort()])).toEqual([[["gnd"], ["r1", "u1"]], [["s"], ["r1", "u1"]]]);
    expect(readConstraints({ routing: "maybe", outline: { rect: { width_mm: 5, height_mm: 5 } } }).problems).toEqual(['routing must be "on" or "off" (got "maybe")']);
  }, 120_000);

  it("trace widths per net, else per class, else the rules; check reports a net routed narrower", async () => {
    const c = constraintsOf({ trace_widths: { nets: { gnd: 0.5 }, classes: { signal: 0.2 } } });
    const g = generateSource({ netlist, constraints: c, overrides: { packages: [tripad] }, layout });
    expect(g.source).toContain('<net name="gnd" isGroundNet nominalTraceWidth="0.5mm" />');
    expect(g.source).toContain('<net name="s" nominalTraceWidth="0.2mm" />');
    expect(generateSource({ netlist, constraints: constraintsOf(), overrides: { packages: [tripad] }, layout }).source).toContain('<net name="gnd" isGroundNet nominalTraceWidth="0.3mm" />');
    expect(generateSource({ netlist, constraints: constraintsOf({ trace_widths: { nets: { vbat: 1 } } }), overrides: { packages: [tripad] }, layout }).problems).toEqual(["trace_widths.nets.vbat: the board has no net vbat"]);
    const cj = await build("widths", g.source, g.map);
    expect(Object.fromEntries(narrowestTraces(cj, g.map, netlist))).toEqual({ gnd: 0.5, s: 0.2 });
    expect((await check(cj, g.map, c)).filter((d) => d.severity !== "info")).toEqual([]);
    const necked = cj.map((e) => (e.type === "pcb_trace" ? { ...e, route: e.route.map((p: Record<string, unknown>) => (p.route_type === "wire" ? { ...p, width: Math.min(p.width as number, 0.25) } : p)) } : e));
    expect((await check(necked, g.map, c)).filter((d) => d.code === "CIRCUIT_TRACE_WIDTH").map((d) => [d.severity, d.message.split(" (")[0]])).toEqual([["warning", "net gnd has traces 0.25 mm wide; trace_widths asks for 0.5 mm"]]);
    expect(readConstraints({ outline: { rect: { width_mm: 5, height_mm: 5 } }, trace_widths: { classes: { bus: 0.2 }, nets: { gnd: -1 } } }).problems).toEqual(["trace_widths.nets.gnd must be a positive number (mm)", "trace_widths.classes.bus is not a net class (signal, power, ground)"]);
  }, 120_000);

  it("the via policy: none touching a pad, none under a body, each checked when the config asks", async () => {
    const g = generateSource({ netlist, constraints: constraintsOf(), overrides: { packages: [tripad] }, layout });
    const cj = await build("vias", g.source);
    const pad = cj.find((e) => e.type === "pcb_smtpad" && e.port_hints?.includes("pin2") && e.width === 0.6)!;
    // a via whose 0.6 mm ring overlaps the 0.6 mm pad's edge, its centre outside; and one under u1's courtyard
    const touching = { type: "pcb_via", pcb_via_id: "v_touch", x: pad.x + 0.5, y: pad.y, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] };
    const under = { type: "pcb_via", pcb_via_id: "v_under", x: pad.x - 1, y: pad.y - 1, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] };
    expect(viasTouchingPads([...cj, touching])).toHaveLength(1);
    const strict = constraintsOf({ via_touching_pad: "avoid", via_under_body: "avoid" });
    const codes = async (extra: CircuitElement[], c: BoardConstraints) => (await check([...cj, ...extra], g.map, c)).filter((d) => d.severity === "error").map((d) => d.code);
    expect(await codes([touching], strict)).toContain("CIRCUIT_VIA_TOUCHING_PAD");
    const located = (await check([...cj, touching, under], g.map, strict)).filter((d) => d.code.startsWith("CIRCUIT_VIA_"));
    expect(located.find((d) => d.code === "CIRCUIT_VIA_TOUCHING_PAD")!.location).toMatchObject({ at: [pad.x + 0.5, pad.y], items: ["v_touch"], pads: [pad.pcb_smtpad_id] });
    const underLoc = located.find((d) => d.code === "CIRCUIT_VIA_UNDER_BODY")!.location!;
    expect(underLoc.components).toEqual(["u1"]);
    expect(underLoc.items).toContain("v_under");
    expect(underLoc.points).toContainEqual([pad.x - 1, pad.y - 1]);
    expect(await codes([under], strict)).toContain("CIRCUIT_VIA_UNDER_BODY");
    // the defaults allow both (the router has no such rule); a via in a pad stays an error
    expect(await codes([touching, under], constraintsOf())).not.toContain("CIRCUIT_VIA_TOUCHING_PAD");
    expect(await codes([touching, under], constraintsOf())).not.toContain("CIRCUIT_VIA_UNDER_BODY");
    expect(await codes([{ ...touching, x: pad.x }], constraintsOf())).toContain("CIRCUIT_VIA_IN_PAD");
    expect(readConstraints({ outline: { rect: { width_mm: 5, height_mm: 5 } }, via_under_body: "never" }).problems).toEqual(['via_under_body must be "avoid" or "allow" (got "never")']);
  }, 120_000);

  it("hole-to-copper clearance: a round hole is a circle, not its bounding box", () => {
    const hole = { type: "pcb_hole", pcb_hole_id: "h1", hole_shape: "circle", hole_diameter: 2, x: 0, y: 0 };
    // a pad off the hole's diagonal: inside the hole's bounding box grown by 0.3 mm, 0.31 mm from its circle
    const corner = 1 + 0.31;
    const diagonal = { type: "pcb_smtpad", pcb_smtpad_id: "p_diag", shape: "rect", x: corner / Math.SQRT2 + 0.25, y: corner / Math.SQRT2 + 0.25, width: 0.5, height: 0.5, layer: "top" };
    expect(holeClearanceFaults([hole, diagonal], 0.3)).toEqual([]);
    // a trace 0.2 mm from the wall, and a via in the hole
    const trace = { type: "pcb_trace", pcb_trace_id: "t1", route: [{ route_type: "wire", x: -3, y: 1.3, width: 0.2, layer: "top" }, { route_type: "wire", x: 3, y: 1.3, width: 0.2, layer: "top" }] };
    expect(holeClearanceFaults([hole, trace], 0.3)).toMatchObject([{ hole: "h1", at: [0, 0], what: "trace t1", gap: expect.closeTo(0.2, 6), id: "t1", layer: "top" }]);
    expect(holeClearanceFaults([hole, trace], 0.1)).toEqual([]);
    const via = { type: "pcb_via", pcb_via_id: "v1", x: 0.9, y: 0, outer_diameter: 0.6 };
    // its ring reaches from 0.6 to 1.2 mm off the centre: 0.4 mm of it inside the 1 mm radius
    expect(holeClearanceFaults([hole, via], 0)[0]).toMatchObject({ what: "via v1", gap: expect.closeTo(-0.4, 6) });
    // a pour that fills the hole's place
    const pour = { type: "pcb_copper_pour", pcb_copper_pour_id: "pour1", layer: "top", brep_shape: { outer_ring: { vertices: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }] }, inner_rings: [] } };
    expect(holeClearanceFaults([hole, pour], 0.2)[0]).toMatchObject({ what: "copper pour pour1 (top)" });
    const cut = { ...pour, brep_shape: { ...pour.brep_shape, inner_rings: [{ vertices: [{ x: -1.5, y: -1.5 }, { x: 1.5, y: -1.5 }, { x: 1.5, y: 1.5 }, { x: -1.5, y: 1.5 }] }] } };
    expect(holeClearanceFaults([hole, cut], 0.2)).toEqual([]);
    expect(readConstraints({ outline: { rect: { width_mm: 5, height_mm: 5 } }, rules: { hole_clearance_mm: 0.25 } }).constraints!.rules.hole_clearance_mm).toBe(0.25);
  });
});

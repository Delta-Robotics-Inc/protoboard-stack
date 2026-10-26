/**
 * The provider's pieces without a build: constraints, the land-pattern table
 * (checked against the cited drawings' numbers), the source writer, the box
 * body and the GLB reframing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Net, defineModule, netLinks, type ModuleDef } from "@deltarobotics/uhd";
import { boardNetlist, checkGlb, checkStep, parseCsv, type BoardNetlist } from "@protoboardai/core";
import { circlePolygon, polygonArea, readConstraints } from "../lib/config.ts";
import { FOOTPRINTS, boardLands, entryProblems, resolveFootprint, verifyEntry, type FootprintEntry, type LandPad } from "../lib/footprints.ts";
import { viasInPads } from "../lib/checks.ts";
import { applyPaste } from "../lib/paste.ts";
import { addSilkscreen } from "../lib/silk.ts";
import { withRotatedPaste } from "../lib/outputs.ts";
import { applyBodies, boxStep } from "../lib/models.ts";
import { bomCsv, formatValue, placePartFrame, reframeGlb } from "../lib/outputs.ts";
import { generateSource, pastePlan, safeName, type NameMap } from "../lib/source.ts";
import { stepEntities, withoutShapes } from "../lib/stepfile.ts";
import { UHD_PARTS } from "./fixture.ts";
import { entities } from "./step.ts";
import { catalogPart } from "../../core/test/catalog.ts";

describe("constraints", () => {
  it("reads a circle outline, holes, fixed placements, keep-outs and rules", () => {
    const { constraints, problems } = readConstraints({
      layers: 4,
      thickness_mm: 0.8,
      outline: { circle: { diameter_mm: 36 } },
      mounting_holes: [{ id: "h1", at: [0, 14], diameter_mm: 2.2 }],
      placements: { j1: { at: [0, -16], rotation_deg: 180, side: "bottom" } },
      keepouts: [{ name: "antenna", circle: { at: [10, 10], diameter_mm: 6 }, layers: ["top"] }],
      rules: { trace_width_mm: 0.2 },
    });
    expect(problems).toEqual([]);
    expect(constraints!.outlineKind).toBe("circle");
    expect(Math.abs(polygonArea(constraints!.outline))).toBeCloseTo(Math.PI * 18 ** 2, -1);
    expect(constraints!.placements.j1).toEqual({ at: [0, -16], rotation_deg: 180, side: "bottom" });
    expect(constraints!.rules).toMatchObject({ trace_width_mm: 0.2, via_drill_mm: 0.3 });
    expect(constraints!.autorouter).toBe("auto_local");
  });

  it("falls back to the board's design envelope in its own frame: UHD's example, corner origin, antenna keep-out on both layers", () => {
    // docs/boards-and-nets.md "Design requirements"
    const envelope = { max_mm: { length: 30, width: 20, height: 5 }, keep_outs: [{ name: "antenna", region: { min: [24, 0, -1] as [number, number, number], max: [30, 20, 5] as [number, number, number] }, reason: "no copper under the antenna" }] };
    const { constraints, notes } = readConstraints({}, envelope);
    expect(constraints!.outline).toEqual([[0, 0], [30, 0], [30, 20], [0, 20]]);
    expect(constraints!.keepouts).toEqual([{ name: "antenna", shape: { rect: { at: [27, 10], size: [6, 20] } }, layers: ["top", "bottom"], reason: "no copper under the antenna", from: "envelope" }]);
    expect(notes).toEqual([]);
  });

  it("applies an envelope keep-out to the copper layers its z range reaches", () => {
    const keepout = (z: [number, number]) => ({ max_mm: { length: 30, width: 20 }, keep_outs: [{ name: "k", region: { min: [24, 0, z[0]] as [number, number, number], max: [30, 20, z[1]] as [number, number, number] } }] });
    // 1.6 mm board: top copper at z = +0.8, bottom at −0.8
    expect(readConstraints({}, keepout([0, 5])).constraints!.keepouts[0].layers).toEqual(["top"]);
    expect(readConstraints({}, keepout([-5, 0])).constraints!.keepouts[0].layers).toEqual(["bottom"]);
    const between = readConstraints({}, keepout([-0.1, 0.1]));
    expect(between.constraints!.keepouts).toEqual([]);
    expect(between.notes[0]).toMatch(/reaches neither copper layer/);
  });

  it("warns about a keep-out that misses the board (stated in another frame)", () => {
    // the UHD example's antenna keep-out, against a 20 mm round board centred on the origin
    const envelope = { max_mm: { length: 30, width: 20 }, keep_outs: [{ name: "antenna", region: { min: [24, 0, -1] as [number, number, number], max: [30, 20, 5] as [number, number, number] } }] };
    const { constraints, notes } = readConstraints({ outline: { circle: { diameter_mm: 20 } }, keepouts: [{ name: "inside", circle: { at: [0, 9.5], diameter_mm: 2 } }] }, envelope);
    expect(constraints).toBeDefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/keep-out antenna \(design_envelope\) lies entirely outside the board outline/);
  });

  it("refuses cloud routing, an outline larger than the envelope, and malformed entries", () => {
    expect(readConstraints({ outline: { rect: { width_mm: 10, height_mm: 10 } }, autorouter: "auto_cloud" }).problems.join("\n")).toMatch(/not a local preset.*never used/);
    expect(readConstraints({ outline: { circle: { diameter_mm: 40 } } }, { max_mm: { length: 32, width: 32 } }).problems.join("\n")).toMatch(/exceeds the board's design envelope 32 × 32 mm/);
    expect(readConstraints({ outline: { polygon: [[0, 0], [1, 1]] }, placements: { u1: { at: [1] } }, rules: { clearance: 1 } }).problems).toEqual([
      "outline.polygon needs at least three [x, y] points (mm)",
      "placements.u1 needs at: [x, y] (mm)",
      "rules.clearance is not a rule (rules: trace_width_mm, power_trace_width_mm, via_drill_mm, via_pad_mm, edge_clearance_mm, hole_clearance_mm)",
    ]);
  });

  it("validates the fabrication-order keys", () => {
    const rect = { rect: { width_mm: 10, height_mm: 10 } };
    expect(readConstraints({ outline: rect, copper_oz: 2, finish: "ENIG", solder_mask: "black", silkscreen: "white", assembly: "hand" }).problems).toEqual([]);
    expect(readConstraints({ outline: rect, copper_oz: "2oz", finish: "", solder_mask: 3, assembly: "Fab" }).problems).toEqual([
      'copper_oz must be a positive number (oz/ft² of the outer layers; got "2oz")',
      'finish must be a non-empty string (got "")',
      "solder_mask must be a non-empty string (got 3)",
      'assembly must be "fab" or "hand" (got "Fab")',
    ]);
    expect(readConstraints({ outline: rect, copper_oz: -1 }).problems).toHaveLength(1);
  });

  it("keeps circle polygons within 0.01 mm of the circle", () => {
    const n = circlePolygon(30).length;
    expect(15 * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(0.01);
  });
});

describe("land-pattern table", () => {
  const ext = (pads: LandPad[], k: "x" | "y", s: "w" | "h") => Math.max(...pads.map((p) => Math.abs(p[k]) + p[s] / 2));
  /** Inner edge of the left and right pad rows (pads longer in X than in Y). */
  const inner = (pads: LandPad[]) => Math.min(...pads.filter((p) => p.w > p.h).map((p) => Math.abs(p.x) - p.w / 2));
  const entry = (id: string) => FOOTPRINTS.find((e) => e.id === id)!;

  it("RP2040 QFN-56 matches datasheet Figure 167: 7.75 mm outside, 6.00 inside, 0.20 × 0.875 pads, 3.20 centre pad", () => {
    const pads = entry("qfn-56-7x7-p0.4-ep3.2").pads!;
    const perimeter = pads.filter((p) => p.pin !== "57");
    expect(perimeter.length).toBe(56);
    expect(2 * ext(perimeter, "x", "w")).toBeCloseTo(7.75, 6);
    expect(2 * inner(perimeter)).toBeCloseTo(6.0, 6);
    expect(pads.find((p) => p.pin === "57")).toEqual({ pin: "57", x: 0, y: 0, w: 3.2, h: 3.2 });
    // pin 1 at the top of the left side, numbered counter-clockwise; 0.4 mm pitch
    expect(pads.find((p) => p.pin === "1")).toMatchObject({ x: -3.4375, y: 2.6, w: 0.875, h: 0.2 });
    expect(pads.find((p) => p.pin === "15")).toMatchObject({ x: -2.6, y: -3.4375 });
    expect(pads.find((p) => p.pin === "29")).toMatchObject({ x: 3.4375, y: -2.6 });
    expect(pads.find((p) => p.pin === "43")).toMatchObject({ x: 2.6, y: 3.4375 });
    expect(pads.find((p) => p.pin === "2")!.y).toBeCloseTo(2.2, 6);
  });

  it("BMI270 LGA-14 matches §8.3: 0.475 × 0.25 pads, inner edges 0.925 and 0.675 from the centre", () => {
    const pads = entry("lga-14-3x2.5-p0.5-bosch").pads!;
    const side = pads.filter((p) => Math.abs(p.x) > 1);
    const ends = pads.filter((p) => Math.abs(p.x) <= 1);
    expect(side.every((p) => Math.abs(Math.abs(p.x) - p.w / 2 - 0.925) < 1e-9 && p.w === 0.475 && p.h === 0.25)).toBe(true);
    expect(ends.every((p) => Math.abs(Math.abs(p.y) - p.h / 2 - 0.675) < 1e-9 && p.w === 0.25 && p.h === 0.475)).toBe(true);
    expect(pads.map((p) => p.pin).sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
    expect(pads.find((p) => p.pin === "1")).toMatchObject({ x: -1.1625, y: 0.75 });
    expect(pads.find((p) => p.pin === "12")).toMatchObject({ x: 0.5, y: 0.9125 });
  });

  it("TPS63020 DSJ VSON-14 matches 4210895-2/E: 0.24 × 0.6 pads at 0.5 pitch, rows 2.8 apart, 2.85 × 1.58 thermal pad", () => {
    const pads = entry("vson-14-dsj-4x3-p0.5").pads!;
    expect(new Set(pads.filter((p) => p.pin !== "EP").map((p) => Math.abs(p.y)))).toEqual(new Set([1.4]));
    expect(pads.find((p) => p.pin === "1")).toMatchObject({ x: -1.5, y: -1.4, w: 0.24, h: 0.6 });
    expect(pads.find((p) => p.pin === "14")).toMatchObject({ x: -1.5, y: 1.4 });
    expect(pads.find((p) => p.pin === "EP")).toMatchObject({ w: 2.85, h: 1.58 });
  });

  it("matches parts by their stated package facts; a project entry wins over the provider's", () => {
    expect(resolveFootprint("u1", { name: "QFN-56", pin_count: 56, pitch_mm: 0.4, size_mm: { length: 7, width: 7 } }).entry?.id).toBe("qfn-56-7x7-p0.4-ep3.2");
    // a different body size is a different land pattern
    expect(resolveFootprint("u1", { name: "QFN-56", pin_count: 56, pitch_mm: 0.4, size_mm: { length: 8, width: 8 } }).entry).toBeUndefined();
    expect(resolveFootprint("r1", { name: "0402", pin_count: 2 }).entry?.footprinter).toBe("0402");
    const mine = { id: "my-0402", match: { package: "0402", pin_count: 2 }, footprinter: "0402_p0.6mm", source: "house rule", verified: false as const };
    expect(resolveFootprint("r1", { name: "0402", pin_count: 2 }, { packages: [mine] })).toEqual({ entry: mine, from: "project", by: "name" });
    expect(resolveFootprint("r1", { name: "0402", pin_count: 2 }, { instances: { r1: mine } }).from).toBe("instance");
    for (const e of FOOTPRINTS) expect(e.source.length).toBeGreaterThan(10);
  });

  it("matches SOT-23 entries on pin count, and reads package names without case, spaces or dashes", () => {
    expect(resolveFootprint("q1", { name: "SOT-23", pin_count: 3 }).entry?.footprinter).toBe("sot23");
    expect(resolveFootprint("u1", { name: "sot 23-5", pin_count: 5 }).entry?.footprinter).toBe("sot23_5");
    expect(resolveFootprint("u1", { name: "SOT-23", pin_count: 6 }).entry).toBeUndefined();
    // "x" is a letter like any other: only "×" reads as "x"
    const lga = { id: "lga-3x3", match: { package: "LGA 3 × 3" }, footprinter: "0402", source: "test", verified: false as const };
    expect(resolveFootprint("u1", { name: "LGA-3x3", pin_count: 2 }, { packages: [lga] }).entry?.id).toBe("lga-3x3");
    const xtal = { id: "xtal", match: { package: "XTAL" }, footprinter: "0402", source: "test", verified: false as const };
    expect(resolveFootprint("y1", { name: "TAL", pin_count: 2 }, { packages: [xtal] }).entry).toBeUndefined();
  });
});

describe("source writer", () => {
  const netlist: BoardNetlist = {
    schema: "protoboard.board-netlist/v0",
    board: "b",
    components: [
      { instance: "r1", part: "r", name: "R", kind: "resistor", value: { value: 1e3, unit: "Ω" }, package: { name: "0402", pin_count: 2, exposed_pad: false }, pins: [{ interface: "pin_1", pin: "1", name: "1", kind: "passive" }, { interface: "pin_2", pin: "2", name: "2", kind: "passive" }], bodies: [] },
      { instance: "u9", part: "x", name: "X", kind: "ic", package: { name: "WLCSP-9", pin_count: 9, exposed_pad: false }, pins: [], bodies: [] },
      { instance: "u8", part: "y", name: "Y", kind: "ic", pins: [], bodies: [] },
    ],
    nets: [{ id: "3v3", name: "3V3", kind: "power", pins: ["r1:pin_1"], links: [] }],
    edge: [],
    problems: [],
  };
  const { constraints } = readConstraints({ outline: { rect: { width_mm: 10, height_mm: 10 } }, placements: { q1: { at: [0, 0] } } });

  it("says which package has no land pattern and which part states none, instead of guessing", () => {
    const g = generateSource({ netlist, constraints: constraints! });
    expect(g.problems).toEqual([
      "u9 (x): no land pattern for package WLCSP-9 (9 pins); add one to tscircuit/footprints.json",
      "u8 (y): the part states no package (UHD mechanical domain `package`), so no land pattern can be chosen; add the package fact to the part, or an instance entry to tscircuit/footprints.json",
      "placements.q1: the board has no component q1",
    ]);
    expect(g.source).toContain('<resistor\n        name="r1"');
    expect(g.source).toContain('<net name="N_3v3" isPowerNet nominalTraceWidth="0.3mm" />');
    expect(g.map.nets).toEqual({ N_3v3: "3v3" });
  });

  it("checks that a built-in land pattern has a pad for every pin designator", () => {
    const six: BoardNetlist = {
      ...netlist,
      components: [{ instance: "q1", part: "q", name: "Q", kind: "ic", package: { name: "SOT-23-5", pin_count: 5, exposed_pad: false }, pins: ["1", "2", "3", "4", "5", "6"].map((pin) => ({ interface: `pin_${pin}`, pin, name: `P${pin}`, kind: "signal" as const })), bodies: [] }],
      nets: [],
    };
    const g = generateSource({ netlist: six, constraints: readConstraints({ outline: { rect: { width_mm: 10, height_mm: 10 } } }).constraints!, overrides: { instances: { q1: { id: "builtin-sot23_5", match: { package: "SOT-23-5" }, footprinter: "sot23_5", source: "test", verified: false } } } });
    expect(g.problems).toEqual(['q1: land pattern builtin-sot23_5 (built-in "sot23_5", pads 1, 2, 3, 4, 5) has no pad 6 for pin 6 (P6)']);
  });

  it("writes plated slots and non-plated holes of an authored land pattern (a USB-C shell's stakes, its locating pegs)", () => {
    const usb: BoardNetlist = {
      ...netlist,
      components: [{ instance: "j1", part: "usb", name: "USB", kind: "connector", package: { name: "USB-X", pin_count: 2, exposed_pad: false }, pins: [{ interface: "a1", pin: "A1", name: "GND", kind: "ground" }, { interface: "shell", pin: "SHELL", name: "SHELL", kind: "ground" }], bodies: [] }],
      nets: [],
    };
    const entry = {
      id: "usb-x",
      match: { package: "USB-X" },
      pads: [{ pin: "A1", x: -3, y: 3.7, w: 0.3, h: 1.15 }, { pin: "SHELL", x: -4.32, y: -1.1, w: 1.0, h: 1.6, drill: { w: 0.6, h: 1.0 } }, { pin: "SHELL", x: 1, y: 1, w: 1.2, h: 1.2, drill: { w: 0.7, h: 0.7 } }],
      holes: [{ x: -2.89, y: 2.6, diameter_mm: 0.65 }],
      source: "test",
      verified: false as const,
    };
    expect(entryProblems(entry)).toEqual([]);
    const g = generateSource({ netlist: usb, constraints: readConstraints({ outline: { rect: { width_mm: 20, height_mm: 20 } } }).constraints!, overrides: { packages: [entry] } });
    expect(g.problems).toEqual([]);
    expect(g.source).toContain('<platedhole shape="pill" outerWidth="1mm" outerHeight="1.6mm" holeWidth="0.6mm" holeHeight="1mm" pcbX="-4.32mm" pcbY="-1.1mm" portHints={["pin2"]} />');
    expect(g.source).toContain('<platedhole shape="circle" outerDiameter="1.2mm" holeDiameter="0.7mm" pcbX="1mm" pcbY="1mm" portHints={["pin2"]} />');
    expect(g.source).toContain('<hole diameter="0.65mm" pcbX="-2.89mm" pcbY="2.6mm" />');
    expect(entryProblems({ ...entry, pads: [{ pin: "1", x: 0, y: 0, w: 1, h: 1, drill: { w: 1.2, h: 0.5 } }], holes: [{ x: 0, y: 0, diameter_mm: 0 }] })).toEqual([
      'pad {"pin":"1","x":0,"y":0,"w":1,"h":1,"drill":{"w":1.2,"h":0.5}}: drill needs positive w, h smaller than the pad',
      'hole {"x":0,"y":0,"diameter_mm":0} needs x, y and a positive diameter_mm',
    ]);
  });

  it("makes tscircuit-safe names", () => {
    expect([safeName("u1", "c_"), safeName("3v3", "N_"), safeName("a/b-c", "c_")]).toEqual(["u1", "N_3v3", "a_b_c"]);
  });

  it("formats passive values for the BOM", () => {
    expect([formatValue({ value: 4.7e3, unit: "Ω" }), formatValue({ value: 1e-7, unit: "F" }), formatValue({ value: 1.5e-6, unit: "H" }), formatValue({ value: 1e6, unit: "Ω" })]).toEqual(["4.7 kΩ", "100 nF", "1.5 µH", "1 MΩ"]);
  });
});

describe("per-placement passive values", () => {
  // the catalog's Yageo RC0402 series part (a test copy) at two values on one board
  const RC0402 = catalogPart("yageo-rc0402");
  const BOARD: ModuleDef = defineModule({
    id: "fx-divider",
    name: "Divider",
    interfaces: [Net({ id: "vin", name: "VIN" }), Net({ id: "mid", name: "MID" }), Net({ id: "gnd", name: "GND" })],
    children: [
      { id: "r1", moduleDefId: "yageo-rc0402", overrides: { resistance: 4700 } },
      { id: "r2", moduleDefId: "yageo-rc0402", overrides: { resistance: 1e6, tolerance: 0.05 } },
      { id: "r3", moduleDefId: "yageo-rc0402" },
    ],
    links: [...netLinks("vin", ["r1:pin_1", "r3:pin_1"]), ...netLinks("mid", ["r1:pin_2", "r2:pin_1"]), ...netLinks("gnd", ["r2:pin_2", "r3:pin_2"])],
  });
  const netlist = boardNetlist(BOARD, (id) => [RC0402, BOARD].find((d) => d.id === id));

  it("the generated BOM shows each placement's value and MPN", () => {
    expect(netlist.problems).toEqual([]);
    const rows = parseCsv(bomCsv(netlist)).rows;
    expect(rows.slice(1).map((r) => [r[0], r[5], r[6]])).toEqual([
      ["r1", "RC0402FR-074K7L", "4.7 kΩ"],
      ["r2", "RC0402JR-071ML", "1 MΩ"],
      ["r3", "RC0402FR-0710KL", "10 kΩ"],
    ]);
  });

  it("the tscircuit source places each resistor at its own value and MPN", () => {
    const g = generateSource({ netlist, constraints: readConstraints({ outline: { rect: { width_mm: 10, height_mm: 10 } } }).constraints! });
    expect(g.problems).toEqual([]);
    const block = (name: string) => g.source.slice(g.source.indexOf(`name="${name}"`), g.source.indexOf("/>", g.source.indexOf(`name="${name}"`)));
    expect(block("r1")).toMatch(/manufacturerPartNumber="RC0402FR-074K7L"[\s\S]*resistance=\{4700\}/);
    expect(block("r2")).toMatch(/manufacturerPartNumber="RC0402JR-071ML"[\s\S]*resistance=\{1000000\}/);
    expect(block("r3")).toMatch(/resistance=\{10000\}/);
  });
});

describe("bodies and frames", () => {
  it("places a part's stated mating frame like its body: mount origin on the footprint origin, rotated, mirrored on the bottom", () => {
    // a USB-C receptacle: mouth at (0, 0, 1.73) facing -Y in part coordinates, mounting origin 3.675 mm behind it
    const usb = { frame: { origin: [0, 0, 1.73] as [number, number, number], normal: [0, -1, 0] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number] }, mount: [0, 3.675, 0] as [number, number, number] };
    expect(placePartFrame(usb, { origin: [-16.775, 0], rotation_deg: 270, side: "top" }, 0.4)).toEqual({ origin: [-20.45, 0, 2.13], normal: [-1, 0, 0], xAxis: [0, -1, 0] });
    expect(placePartFrame(usb, { origin: [5, 5], rotation_deg: 0, side: "top" }, 0.4)).toEqual({ origin: [5, 1.325, 2.13], normal: [0, -1, 0], xAxis: [1, 0, 0] });
    // the same part on the bottom copper: X and Z mirrored
    expect(placePartFrame(usb, { origin: [5, 5], rotation_deg: 0, side: "bottom" }, 0.4)).toEqual({ origin: [5, 1.325, -2.13], normal: [0, -1, 0], xAxis: [-1, 0, 0] });
  });


  it("writes a valid STEP box sitting on z = 0", () => {
    const s = boxStep("box 7 x 7 x 0.9 mm", [7, 7, 0.9]);
    expect(checkStep(Buffer.from(s))).toEqual([]);
    expect(s.match(/ADVANCED_FACE/g)?.length).toBe(6);
    expect(s.match(/EDGE_CURVE/g)?.length).toBe(12);
    expect(s.match(/VERTEX_POINT/g)?.length).toBe(8);
    const z = [...s.matchAll(/CARTESIAN_POINT\('',\(([^)]*)\)\)/g)].map((m) => Number(m[1].split(",")[2]));
    expect([Math.min(...z), Math.max(...z)]).toEqual([0, 0.9]);
  });

  it("strips a UHD body's interface feature shapes, leaving a valid STEP of the body alone", () => {
    const file = readFileSync(join(UHD_PARTS, "files/library/parts/bosch-bmi270/artifacts/cad/bosch-bmi270-lga14.step"), "utf8");
    const solids = (t: string) => [...stepEntities(t).values()].filter((b) => b.startsWith("MANIFOLD_SOLID_BREP")).length;
    expect(solids(file)).toBe(29); // package, 14 pads, 14 pcb_mount markers
    const { text, removed } = withoutShapes(file, ["pcb_mount", "vdd", "not_a_feature"]);
    expect(removed).toEqual(["pcb_mount"]);
    expect(checkStep(Buffer.from(text))).toEqual([]);
    expect(solids(text)).toBe(15);
    const e = entities(text);
    const dangling = [...e.values()].flatMap((b) => [...b.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))).filter((id) => !e.has(id));
    expect(dangling).toEqual([]);
    // what is left sits on the seating plane: 0 to 0.83 mm, 3.0 × 2.5 mm
    const z = [...text.matchAll(/VERTEX_POINT\('',#(\d+)\)/g)].map((m) => Number(e.get(Number(m[1]))!.split(",").pop()!.replace(/\)+$/, "")));
    expect([Math.min(...z), Math.max(...z)]).toEqual([0, 0.83]);
    expect(withoutShapes(file, ["nothing"]).text).toBe(file);
  });

  it("wraps a GLB in one root node that turns tscircuit's frame into glTF metres, Y up", () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "u1", translation: [-5, 0.5, 2] }] }) + " ");
    const pad = Buffer.from(" ".repeat((4 - (json.length % 4)) % 4));
    const body = Buffer.concat([json, pad]);
    const head = Buffer.alloc(20);
    head.write("glTF", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + body.length, 8);
    head.writeUInt32LE(body.length, 12);
    head.writeUInt32LE(0x4e4f534a, 16);
    const out = reframeGlb(Buffer.concat([head, body]), { schema: "protoboard.tscircuit-map/v0", board: "b", components: { u1: { instance: "u1", part: "p", ports: {}, footprint: "f", footprintFrom: "provider", placement: "auto" } }, nets: {} });
    expect(checkGlb(out)).toEqual([]);
    const j = JSON.parse(out.toString("utf8", 20, 20 + out.readUInt32LE(12)));
    const m = j.nodes[j.scenes[0].nodes[0]].matrix as number[];
    // tscircuit (x, y, z)glb = (−x, z, y)board in mm; the viewer reads CAD = (x, −z, y) × 1000
    const [gx, gy, gz] = [m[0] * -5, m[5] * 0.5, m[10] * 2];
    expect([gx * 1000, -gz * 1000, gy * 1000].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([5, 2, 0.5]);
  });
});

describe("bodies on land patterns whose pads are off the origin", () => {
  // a part whose pads all lie on one side of its origin (a module with its antenna past the pads,
  // a mid-mount connector): tscircuit centres the component on the pads, the body belongs at the origin
  const netlist: BoardNetlist = {
    schema: "protoboard.board-netlist/v0" as BoardNetlist["schema"],
    board: "fx",
    components: [{ instance: "u1", part: "m", name: "M", kind: "ic", package: { name: "OFFSET-2", pin_count: 2, exposed_pad: false }, pins: ["1", "2"].map((pin) => ({ interface: `pin_${pin}`, pin, name: `P${pin}`, kind: "signal" as const })), bodies: [] }],
    nets: [],
    edge: [],
    problems: [],
  };
  const pads: LandPad[] = [
    { pin: "1", x: -1, y: -3, w: 0.6, h: 1 },
    { pin: "2", x: 1, y: -3, w: 0.6, h: 1 },
  ];

  it("records the pads' centre and moves the body back to the pattern's origin, rotation included", () => {
    const { constraints } = readConstraints({ outline: { rect: { width_mm: 20, height_mm: 20 } }, placements: { u1: { at: [2, 1], rotation_deg: 90 } } });
    const g = generateSource({ netlist, constraints: constraints!, overrides: { instances: { u1: { id: "offset", match: { package: "OFFSET-2" }, pads, source: "test", verified: false } } } });
    expect(g.problems).toEqual([]);
    expect(g.map.components.u1.padCentre).toEqual([0, -3]);
    // as tscircuit reports it: the component centred on its pads, (0, -3) rotated 90° from (2, 1)
    const cj = [
      { type: "source_component", source_component_id: "s1", name: "u1" },
      { type: "cad_component", cad_component_id: "c1", source_component_id: "s1", position: { x: 5, y: 1, z: 0.8 }, rotation: { x: 0, y: 0, z: 90 } },
    ];
    const { circuitJson } = applyBodies(cj as never, g.map, [{ instance: "u1", source: "box", box: { path: "m.step", size: [1, 1, 1] } }], "/root");
    const cad = circuitJson.find((e) => e.type === "cad_component") as unknown as { position: { x: number; y: number }; model_origin_position: unknown };
    expect(cad.position.x).toBeCloseTo(2, 6);
    expect(cad.position.y).toBeCloseTo(1, 6);
    expect(cad.model_origin_position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("land-pattern verification against the makers' drawings", () => {
  const entry = (id: string) => structuredClone(FOOTPRINTS.find((e) => e.id === id)!);

  it("every authored entry with a record matches it; built-in strings and record-less entries are unverified", () => {
    for (const e of FOOTPRINTS) {
      if (e.verification) expect([e.id, verifyEntry(e)]).toEqual([e.id, []]);
      else expect(verifyEntry(e)[0]).toMatch(/no verification record/);
    }
    // the makers whose land patterns the example boards use
    for (const id of ["yageo-rc0402-reflow", "murata-grm15-reflow", "murata-grm18-reflow", "gct-usb4720-midmount", "gct-usb4105-topmount", "espressif-esp32-c3-mini-1", "raytac-mdbt50q", "ti-rsm0032b", "maxim-90-0065-tdfn8", "alps-skrt-guide-bosses"]) expect(entry(id).verification?.checked).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it("catches a pad, pitch, row, slot, hole, courtyard, paste or mask that differs from the drawing", () => {
    const usb = entry("gct-usb4720-midmount");
    usb.pads = usb.pads!.map((p) => (p.pin === "A5" ? { ...p, w: 0.25 } : p.pin === "SHELL" && p.y < 0 ? { ...p, drill: { w: 0.5, h: 1.4 } } : p));
    usb.holes = [{ x: 0, y: 0, diameter_mm: 0.6 }];
    usb.courtyard_mm = [10, 4];
    usb.paste = { margin_mm: -0.05 };
    usb.mask = { margin_mm: 0 };
    const problems = verifyEntry(usb).join("\n");
    expect(problems).toMatch(/pad A5 is 0.25 × 0.8 mm, the drawing 0.3 × 0.8/);
    expect(problems).toMatch(/slot at \(-5.65, -2\): drill 0.5 × 1.4/);
    expect(problems).toMatch(/1 non-plated hole\(s\), the drawing 0/);
    expect(problems).toMatch(/courtyard 10 × 4 mm/);
    expect(problems).toMatch(/reach outside the courtyard/);
    expect(problems).toMatch(/paste margin -0.05 mm, the record 0/);
    expect(problems).toMatch(/paste on plated holes: the entry prints none/);
    expect(problems).toMatch(/mask margin 0 mm, the record 0.05/);

    const qfn = entry("ti-rsm0032b");
    qfn.pads = qfn.pads!.map((p) => (Math.abs(p.x) > 1.9 ? { ...p, x: Math.sign(p.x) * 1.95 } : p));
    qfn.paste = { margin_mm: 0, pins: { "33": { windows: [{ x: 0, y: 0, w: 2.8, h: 2.8 }] } } };
    expect(verifyEntry(qfn).join("\n")).toMatch(/rows 3.85 and 3.9 mm apart, the drawing 3.85/);
    expect(verifyEntry(qfn).join("\n")).toMatch(/pin 33: 1 paste window\(s\), the drawing 4/);

    const r = entry("yageo-rc0402-reflow");
    r.pads = r.pads!.map((p) => ({ ...p, x: p.x * 0.9 }));
    expect(verifyEntry(r)).toEqual(["group 1 (1, 2): pad centres span 0.9 × 0 mm, the drawing's rows 1–1 apart"]);

    const raytac = entry("raytac-mdbt50q");
    raytac.pads = raytac.pads!.map((p) => (p.pin === "40" ? { ...p, y: p.y + 0.8 } : p));
    expect(verifyEntry(raytac).join("\n")).toMatch(/1 pad centre\(s\) of the drawing have no pad: \(3.75, -3.35\)/);

    // a slot, a plated hole or a peg hole moved off where the drawing puts it, its size unchanged
    const moved = entry("gct-usb4720-midmount");
    moved.pads = moved.pads!.map((p) => (p.pin === "SHELL" && p.x > 0 && p.y < 0 ? { ...p, y: -1.8 } : p.pin === "TAG" && p.x > 0 ? { ...p, x: 4.3 } : p));
    expect(verifyEntry(moved)).toEqual(["slots 0.5 × 1.65: none at (5.65, -2), where the drawing puts one", "plated holes Ø0.5: none at (4.1, 2.3), where the drawing puts one"]);
    const pegs = entry("gct-usb4105-topmount");
    pegs.holes = pegs.holes!.map((h) => ({ ...h, y: h.y + 0.1 }));
    expect(verifyEntry(pegs)).toEqual(["non-plated holes Ø0.65: none at (-2.89, 2.605), (2.89, 2.605), where the drawing puts them"]);
    const slots4105 = entry("gct-usb4105-topmount");
    slots4105.pads = slots4105.pads!.map((p) => (p.drill && p.y > 0 ? { ...p, y: 2.9 } : p));
    expect(verifyEntry(slots4105)).toEqual(["slots 0.6 × 1.7: none at (-4.32, 3.105), (4.32, 3.105), where the drawing puts them"]);

    const { verification: _, ...bare } = entry("st-sot23-6l");
    expect(verifyEntry(bare)).toEqual(["no verification record: not compared with the manufacturer's recommended land pattern"]);
  });

  it("the GCT receptacles: paired contacts on one land each, plated stake slots, the USB4720's plated tag holes and the USB4105's bare peg holes", () => {
    const u = entry("gct-usb4720-midmount");
    const at = (pin: string) => u.pads!.find((p) => p.pin === pin)!;
    // A1 and B12 together make the 0.65 mm land 3.28 from the centre line; the singles sit at 0.5 pitch out to 1.75
    expect(at("A1").x - at("A1").w / 2).toBeCloseTo(-3.28 - 0.325, 6);
    expect(at("B12").x + at("B12").w / 2).toBeCloseTo(-3.28 + 0.325, 6);
    expect([at("B8").x, at("B5").x, at("B8").h]).toEqual([-1.75, 1.75, 0.8]);
    const slots = u.pads!.filter((p) => p.drill && p.drill.w !== p.drill.h);
    expect(slots.map((p) => [p.x, p.y, p.w, p.h, p.drill!.w, p.drill!.h])).toEqual([[-5.65, -2, 1, 2.15, 0.5, 1.65], [-5.65, 2, 1, 2.15, 0.5, 1.65], [5.65, -2, 1, 2.15, 0.5, 1.65], [5.65, 2, 1, 2.15, 0.5, 1.65]]);
    expect(u.pads!.filter((p) => p.pin === "TAG").map((p) => [p.x, p.y, p.w, p.drill!.w])).toEqual([[-4.1, 2.3, 0.8, 0.5], [4.1, 2.3, 0.8, 0.5]]);
    const v = entry("gct-usb4105-topmount");
    expect(v.holes).toEqual([{ x: -2.89, y: 2.605, diameter_mm: 0.65 }, { x: 2.89, y: 2.605, diameter_mm: 0.65 }]);
    expect(v.pads!.filter((p) => p.drill).map((p) => [p.y, p.w, p.h, p.drill!.w, p.drill!.h])).toEqual([[-1.075, 1, 1.8, 0.6, 1.4], [-1.075, 1, 1.8, 0.6, 1.4], [3.105, 1, 2.1, 0.6, 1.7], [3.105, 1, 2.1, 0.6, 1.7]]);
  });

  it("chooses a maker's own land pattern by the part's manufacturer, else the built-in string", () => {
    const pkg = { name: "0402", pin_count: 2 };
    expect(resolveFootprint("c1", { ...pkg, manufacturer: "Murata" }).entry?.id).toBe("murata-grm15-reflow");
    expect(resolveFootprint("r1", { ...pkg, manufacturer: "Yageo" }).entry?.id).toBe("yageo-rc0402-reflow");
    expect(resolveFootprint("r1", { ...pkg, manufacturer: "Vishay" }).entry?.id).toBe("builtin-0402");
    expect(resolveFootprint("u1", { name: "SOT-23-5", pin_count: 5, manufacturer: "Microchip Technology" }).entry?.id).toBe("microchip-c04-2091-ot");
    expect(resolveFootprint("u1", { name: "SOT-23-5", pin_count: 5, manufacturer: "Texas Instruments" }).entry?.id).toBe("ti-dbv0005a");
    const lands = boardLands([
      { instance: "r1", manufacturer: "Yageo", package: { ...pkg, exposed_pad: false } as never },
      { instance: "r2", manufacturer: "Yageo", package: { ...pkg, exposed_pad: false } as never },
      { instance: "r3", manufacturer: "Vishay", package: { ...pkg, exposed_pad: false } as never },
    ]);
    expect(lands.map((l) => [l.entry.id, l.instances, l.problems.length > 0])).toEqual([["yageo-rc0402-reflow", ["r1", "r2"], false], ["builtin-0402", ["r3"], true]]);
  });
});

describe("the stencil from the land pattern", () => {
  const numbers = (e: FootprintEntry) => new Map((e.pads ?? []).map((p) => [p.pin, p.pin.replace(/\D/g, "") || "99"]));

  it("plans 1:1 apertures, a thermal pad's windows, pin-in-paste rings and pins with none", () => {
    const qfn = FOOTPRINTS.find((e) => e.id === "ti-rsm0032b")!;
    const plan = pastePlan(qfn, numbers(qfn));
    expect(plan.apertures).toHaveLength(32 + 4);
    expect(plan.apertures.find((a) => a.x === -1.925 && a.y === 1.4)).toEqual({ x: -1.925, y: 1.4, w: 0.55, h: 0.2 });
    expect(plan.apertures.filter((a) => a.w === 1.23).map((a) => [a.x, a.y])).toEqual([[-0.715, -0.715], [-0.715, 0.715], [0.715, -0.715], [0.715, 0.715]]);
    const usb = FOOTPRINTS.find((e) => e.id === "gct-usb4720-midmount")!;
    expect(pastePlan(usb, numbers(usb)).apertures.filter((a) => a.pill)).toHaveLength(6);
    const son = FOOTPRINTS.find((e) => e.id === "vson-14-dsj-4x3-p0.5")!;
    expect(pastePlan(son, numbers(son)).apertures.filter((a) => a.pill)).toHaveLength(14); // tscircuit prints none on pill pads
    const pads: FootprintEntry = { id: "t", match: { package: "T" }, pads: [{ pin: "1", x: 0, y: 0, w: 1, h: 1 }, { pin: "2", x: 2, y: 0, w: 1, h: 1 }], paste: { margin_mm: -0.1, pins: { "2": "none" } }, source: "t" };
    expect(pastePlan(pads, numbers(pads))).toEqual({ apertures: [{ x: 0, y: 0, w: 0.8, h: 0.8 }], anchor: { hint: "pin1", x: 0, y: 0 } });
  });

  it("replaces tscircuit's apertures with the plan, turned and mirrored with the part", () => {
    const map: NameMap = { schema: "protoboard.tscircuit-map/v0", board: "b", nets: {}, components: { U1: { instance: "u1", part: "p", ports: {}, footprint: "t", footprintFrom: "provider", placement: "fixed", paste: { apertures: [{ x: 2, y: 1, w: 1, h: 0.5 }, { x: 0, y: 0, w: 0.4, h: 0.4 }], anchor: { hint: "pin2", x: 0, y: 0 } } } } };
    const cj = (layer: string, rotation: number, pad: [number, number]) => [
      { type: "source_component", source_component_id: "s", name: "U1" },
      { type: "pcb_component", pcb_component_id: "c", source_component_id: "s", layer, rotation },
      { type: "pcb_smtpad", pcb_component_id: "c", port_hints: ["pin2"], x: pad[0], y: pad[1], width: 0.4, height: 0.4, layer },
      { type: "pcb_solder_paste", pcb_component_id: "c", x: pad[0], y: pad[1], width: 0.28, height: 0.28, shape: "rect", layer },
    ];
    const top = applyPaste(cj("top", 90, [0, 0]), map);
    const pastes = top.circuitJson.filter((e) => e.type === "pcb_solder_paste");
    expect(pastes.map((p) => [p.x, p.y, p.width, p.height, p.layer])).toEqual([[-1, 2, 0.5, 1, "top"], [0, 0, 0.4, 0.4, "top"]]);
    // on the bottom the pattern is mirrored in X before it turns (tscircuit's convention: (2, 1) → (-1, -2) at 90°)
    const bottom = applyPaste(cj("bottom", 90, [8, 0]), map).circuitJson.filter((e) => e.type === "pcb_solder_paste");
    expect(bottom.map((p) => [p.x, p.y, p.layer])).toEqual([[7, -2, "bottom"], [8, 0, "bottom"]]);
  });
});

describe("vias in pads", () => {
  it("is avoided unless the config asks the fab to fill and cap them", () => {
    const base = { outline: { rect: { width_mm: 10, height_mm: 10 } } };
    expect(readConstraints(base).constraints!.via_in_pad).toBe("avoid");
    expect(readConstraints({ ...base, via_in_pad: "fill_and_cap" }).constraints!.via_in_pad).toBe("fill_and_cap");
    expect(readConstraints({ ...base, via_in_pad: "yes" }).problems).toEqual(['via_in_pad must be "avoid" or "fill_and_cap" (got "yes")']);
    const g = generateSource({ netlist: { board: "b", components: [], nets: [], edge: [], problems: [] } as unknown as BoardNetlist, constraints: readConstraints({ ...base, via_in_pad: "fill_and_cap" }).constraints! });
    expect(g.source).toContain("isViaInPadAllowed");
    expect(generateSource({ netlist: { board: "b", components: [], nets: [], edge: [], problems: [] } as unknown as BoardNetlist, constraints: readConstraints(base).constraints! }).source).not.toContain("isViaInPadAllowed");
    const cj = [
      { type: "pcb_smtpad", pcb_component_id: "c", x: 0, y: 0, width: 1, height: 1, layer: "top" },
      { type: "pcb_via", x: 0.2, y: 0.1, layers: ["top", "bottom"] },
      { type: "pcb_via", x: 2, y: 0, layers: ["top", "bottom"] },
    ];
    expect(viasInPads(cj).map((v) => [v.via.x, v.via.y])).toEqual([[0.2, 0.1]]);
  });
});

describe("silkscreen and turned paste in the fabrication files", () => {
  it("sets a part's reference beside its courtyard, clear of every pad, and a pin-1 dot beside pin 1", () => {
    const map: NameMap = { schema: "protoboard.tscircuit-map/v0", board: "b", nets: {}, components: { U1: { instance: "u1", part: "p", ports: {}, footprint: "t", footprintFrom: "provider", placement: "fixed", paste: { apertures: [], anchor: { hint: "pin1", x: 0, y: 0 } } } } };
    const pad = (n: number, x: number) => ({ type: "pcb_smtpad", pcb_component_id: "c", port_hints: [`pin${n}`], x, y: 0, width: 0.4, height: 1, layer: "top", shape: "rect" });
    const cj = [
      { type: "pcb_board", outline: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] },
      { type: "source_component", source_component_id: "s", name: "U1" },
      { type: "pcb_component", pcb_component_id: "c", source_component_id: "s", layer: "top", rotation: 0 },
      { type: "pcb_courtyard_rect", pcb_component_id: "c", layer: "top", center: { x: 0, y: 0 }, width: 2.5, height: 1.5 },
      pad(1, -0.8), pad(2, 0), pad(3, 0.8),
    ];
    const s = addSilkscreen(cj, map);
    expect([s.references, s.marks, s.omitted]).toEqual([1, 1, []]);
    const text = s.circuitJson.find((e) => e.type === "pcb_silkscreen_text")!;
    expect(text).toMatchObject({ text: "u1", font_size: 0.8, layer: "top", anchor_position: { x: 0 } });
    expect(text.anchor_position.y).toBeGreaterThan(0.75); // above the courtyard, clear of the pads
    const dot = s.circuitJson.find((e) => e.type === "pcb_silkscreen_circle")!;
    expect(dot.center.x).toBeLessThan(-0.8); // beside pin 1, away from the part's centre
  });

  it("prints the designator when the board records one, not the instance path (F14)", () => {
    const map: NameMap = { schema: "protoboard.tscircuit-map/v0", board: "b", nets: {}, components: { USB_R5_02: { instance: "usb/usb_r5_02", part: "p", ports: {}, footprint: "t", footprintFrom: "provider", placement: "fixed", paste: { apertures: [], anchor: { hint: "pin1", x: 0, y: 0 } } } } };
    const cj = [
      { type: "pcb_board", outline: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] },
      { type: "source_component", source_component_id: "s", name: "USB_R5_02" },
      { type: "pcb_component", pcb_component_id: "c", source_component_id: "s", layer: "top", rotation: 0 },
      { type: "pcb_courtyard_rect", pcb_component_id: "c", layer: "top", center: { x: 0, y: 0 }, width: 1.6, height: 1 },
      { type: "pcb_smtpad", pcb_component_id: "c", port_hints: ["pin1"], x: -0.5, y: 0, width: 0.5, height: 0.6, layer: "top", shape: "rect" },
      { type: "pcb_smtpad", pcb_component_id: "c", port_hints: ["pin2"], x: 0.5, y: 0, width: 0.5, height: 0.6, layer: "top", shape: "rect" },
    ];
    expect(addSilkscreen(cj, map, { "usb/usb_r5_02": "R12" }).circuitJson.find((e) => e.type === "pcb_silkscreen_text")!.text).toBe("R12");
    // a component the record does not name keeps its instance path
    expect(addSilkscreen(cj, map).circuitJson.find((e) => e.type === "pcb_silkscreen_text")!.text).toBe("usb/usb_r5_02");
  });

  it("writes a paste aperture turned by an odd angle as a region (the converter flashes it unrotated)", () => {
    const text = withRotatedPaste("F_Paste", "G04 x*\nM02*\n", [{ type: "pcb_solder_paste", shape: "rotated_rect", layer: "top", x: 1, y: 2, width: 2, height: 1, ccw_rotation: 90 }]);
    expect(text).toContain("G36*");
    // the 2 × 1 aperture turned 90°: corners at (1 ± 0.5, 2 ± 1)
    expect(text).toContain("X1500000Y1000000D02*");
    expect(text.endsWith("G37*\nM02*\n")).toBe(true);
    expect(withRotatedPaste("B_Paste", "M02*\n", [{ type: "pcb_solder_paste", shape: "rotated_rect", layer: "top", x: 0, y: 0, width: 1, height: 1, ccw_rotation: 30 }])).toBe("M02*\n");
  });
});


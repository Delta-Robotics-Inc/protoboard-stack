/** The KiCad board importer on small hand-written boards: one test per construct. */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { arcCenter, footprintToWorld, netClassOf, normAngle, padsOf, recordsOfKind, type FootprintRec, type Pad } from "@protoboardai/board";
import { derivedFillPath, fillIsCurrent, importBoard, importKicadPcb, kicadImporter, parseLength, readDerivedFill, unfracture, type BoardImportResult } from "../src/index.js";
import { parseSexprAll } from "../src/sexpr.js";
import { kicadWorldPads, padWorldError, saveAndReload } from "./helpers.js";

const FIX = fileURLToPath(new URL("./fixtures/sample/", import.meta.url));
const SAMPLE = join(FIX, "sample.kicad_pcb");
const V10 = join(FIX, "sample-v10.kicad_pcb");

let cached: BoardImportResult | undefined;
const sample = async () => (cached ??= await importBoard({ path: SAMPLE }));
const fp = (r: BoardImportResult, ref: string) => recordsOfKind(r.document, "footprint").find((f) => f.ref === ref)!;
const pad = (f: FootprintRec, n: string) => f.pads.find((p) => p.number === n) as Pad;
const has = (r: BoardImportResult, level: string, text: string) => r.report.some((i) => i.level === level && i.message.includes(text));

describe("S-expressions", () => {
  it("reads strings with escapes, comments when asked, and line numbers", () => {
    const [a, b] = parseSexprAll('(a "x \\"y\\"\\nz" 1)\n# note\n(b (c 2))', { comments: true });
    expect([...a]).toEqual(["a", 'x "y"\nz', "1"]);
    expect(a.line).toBe(1);
    expect(b.line).toBe(3);
    expect(() => parseSexprAll("(a (b)")).toThrow(/not closed/);
  });
  it("reads lengths with units", () => {
    expect(parseLength("0.2mm")).toBe(200_000);
    expect(parseLength("8mil")).toBe(203_200);
    expect(parseLength("0.25")).toBe(250_000);
    expect(parseLength("2um")).toBe(2_000);
    expect(parseLength("wide")).toBeUndefined();
  });
});

describe("KiCad board: structure", () => {
  it("counts every construct of the sample", async () => {
    const r = await sample();
    expect(r.stats).toMatchObject({ footprints: 2, pads: 12, tracks: 3, arcs: 1, vias: 4, zones: 2, keepouts: 1, nets: 4, cutouts: 2, layers: 9, fillPolygons: 1 });
    expect(r.importer).toBe("kicad");
    expect(kicadImporter.accepts({ path: SAMPLE })).toBe(true);
  });

  it("maps the stackup top to bottom with materials", async () => {
    const r = await sample();
    const layers = recordsOfKind(r.document, "layer").sort((a, b) => a.order - b.order);
    expect(layers.map((l) => l.name)).toEqual(["top_mask", "top", "prepreg1", "inner1", "core2", "inner2", "prepreg3", "bottom", "bottom_mask"]);
    expect(layers.find((l) => l.name === "core2")).toMatchObject({ type: "dielectric", thickness: 1_000_000, material: "FR4", epsilon_r: 4.6, loss_tangent: 0.02 });
    const board = r.document.records.get("board");
    expect(board).toMatchObject({ thickness: 1_600_000, copper_layers: 4, origin: "center", provenance: { by: "imported" } });
  });

  it("joins Edge.Cuts into a centered outline with an arc, and holes into cutouts", async () => {
    const r = await sample();
    expect(r.offset).toEqual({ x: 115_000_000, y: -110_000_000 });
    const o = r.document.records.get("outline");
    if (o?.kind !== "outline") throw new Error("no outline");
    expect(o.outline).toHaveLength(5);
    const arc = o.outline.find((v) => v.sweep !== undefined)!;
    expect(arc).toMatchObject({ x: 15_000_000, y: 6_000_000, sweep: 90_000 });
    const c = arcCenter(arc, o.outline[(o.outline.indexOf(arc) + 1) % 5], arc.sweep!);
    expect(Math.round(c.x)).toBe(11_000_000);
    expect(Math.round(c.y)).toBe(6_000_000);
    const cutouts = recordsOfKind(r.document, "cutout");
    expect(cutouts.map((k) => k.outline.length).sort()).toEqual([3, 4]);
    expect(has(r, "approximated", "Edge.Cuts joint")).toBe(true);
  });

  it("drops what it cannot model and says so with counts", async () => {
    const r = await sample();
    expect(has(r, "dropped", "1 dimension")).toBe(true);
    expect(has(r, "dropped", "1 pad without copper")).toBe(true);
    expect(has(r, "dropped", "on layer F.Adhes")).toBe(true);
    expect(has(r, "dropped", "1 3D model reference")).toBe(true);
    expect(has(r, "info", "1 group")).toBe(true);
    expect(has(r, "approximated", "user layer")).toBe(true);
    expect(r.summary.dropped.dimension).toBe(1);
  });

  it("saves and reloads through the core's file format", async () => {
    const r = await sample();
    expect(saveAndReload(r).equal).toBe(true);
  });
});

describe("KiCad board: footprints and pads", () => {
  it("places top and bottom footprints so every pad lands where KiCad has it", async () => {
    const r = await sample();
    const e = padWorldError(r.document, r.offset, kicadWorldPads(readFileSync(SAMPLE, "utf8")));
    expect(e.checked).toBe(12);
    expect(e.maxNm).toBeLessThanOrEqual(1);
    expect(e.angleMismatches).toBe(0);
  });

  it("keeps an SMD pad on its footprint's other side, where KiCad has it", async () => {
    const text = readFileSync(SAMPLE, "utf8").replace('(pad "2" smd rect (at 0.8 0 90) (size 0.6 0.7) (layers "B.Cu" "B.Paste" "B.Mask")', '(pad "2" smd rect (at 0.8 0 90) (size 0.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask")');
    expect(text).toContain('(at 0.8 0 90) (size 0.6 0.7) (layers "F.Cu"');
    const r = importKicadPcb(text);
    const r1 = fp(r, "R1");
    expect(r1.side).toBe("bottom");
    expect(pad(r1, "1").layer).toBe("top");
    expect(pad(r1, "2").layer).toBe("bottom");
    expect(padsOf(r1).find((p) => p.pad.number === "2")!.layers).toEqual(["top"]);
    expect(has(r, "dropped", "off its footprint")).toBe(false);
    expect(has(r, "info", "SMD pad on its footprint's other side")).toBe(true);
    const e = padWorldError(r.document, r.offset, kicadWorldPads(text));
    expect(e.checked).toBe(r.stats.pads);
    expect(e.maxNm).toBeLessThanOrEqual(1);
    expect(e.angleMismatches).toBe(0);
  });

  it("maps fields, lock, supplier part, texts and courtyard", async () => {
    const r = await sample();
    const u1 = fp(r, "U1");
    expect(u1).toMatchObject({ id: "fp:U1", footprint: "Sample:MCU", value: "MCU", supplier_part: "C12345", side: "top", rotation: 0, locked: true, provenance: { by: "imported", tool: "kicad" } });
    expect(u1.texts?.map((t) => [t.role, t.layer, t.text])).toEqual([
      ["ref", "top_silkscreen", "U1"],
      ["ref", "top_fabrication", "${REFERENCE}"],
    ]);
    expect(u1.courtyard).toHaveLength(4);
    expect(u1.graphics?.map((g) => `${g.layer}:${g.shape}`).sort()).toEqual(["top_courtyard:rect", "top_fabrication:arc", "top_silkscreen:circle", "top_silkscreen:line", "top_silkscreen:polygon"]);
    const r1 = fp(r, "R1");
    expect(r1).toMatchObject({ side: "bottom", rotation: 270_000, value: "10k" });
    // bottom children land on the footprint's own side in its frame
    expect(r1.graphics?.[0].layer).toBe("top_silkscreen");
    expect(r1.texts?.find((t) => t.role === "ref")).toMatchObject({ layer: "top_silkscreen", rotation: 180_000 });
  });

  it("imports every pad shape KiCad writes", async () => {
    const u1 = fp(await sample(), "U1");
    expect(pad(u1, "1")).toMatchObject({ type: "smd", shape: "rect", width: 1_000_000, height: 600_000, layer: "top", mask_margin: 50_000, pin: "GND" });
    expect(pad(u1, "2")).toMatchObject({ shape: "roundrect", corner_radius: 150_000, rotation: 90_000 });
    expect(pad(u1, "3")).toMatchObject({ shape: "circle", radius: 400_000 });
    expect(pad(u1, "4")).toMatchObject({ shape: "oval", width: 1_200_000, height: 600_000 });
    expect(pad(u1, "5")).toMatchObject({ shape: "polygon" });
    expect(pad(u1, "5").points).toHaveLength(4);
    // custom: the circle anchor inside the polygon leaves the polygon
    expect(pad(u1, "6").points?.map((p) => [p.x, p.y]).sort()).toEqual([
      [-500_000, -300_000],
      [-500_000, 300_000],
      [500_000, -300_000],
      [500_000, 300_000],
    ]);
    // chamfered rounded rectangle: one chamfer (two straight corners) and three rounded corners (arcs)
    const p7 = pad(u1, "7");
    expect(p7.shape).toBe("polygon");
    expect(p7.points?.filter((v) => v.sweep !== undefined)).toHaveLength(3);
    expect(pad(u1, "8")).toMatchObject({ type: "th", shape: "circle", outer_diameter: 1_600_000, hole_diameter: 800_000 });
    expect(pad(u1, "9")).toMatchObject({ type: "th", shape: "oval", outer_width: 1_200_000, outer_height: 2_000_000, hole_width: 600_000, hole_height: 1_200_000 });
    expect(pad(u1, "_")).toMatchObject({ type: "np", hole_diameter: 1_000_000 });
    expect(u1.pads.find((p) => p.number === "10")).toBeUndefined();
  });

  it("builds the netlist from pad nets, header nets included", async () => {
    const r = await sample();
    expect(r.netlist.nets.map((n) => [n.name, n.pins])).toEqual([
      ["GND", ["U1.1", "U1.8"]],
      ["SIG", ["R1.2", "U1.3"]],
      ["UNUSED", []],
      ["VCC", ["R1.1", "U1.2"]],
    ]);
    const u1 = fp(r, "U1");
    const world = padsOf(u1);
    expect(r.document.padNets.get(world.find((w) => w.pad.number === "8")!.id)).toBe("GND");
  });
});

describe("KiCad board: copper, zones and keep-outs", () => {
  it("maps segments, arcs (Y negated, so the sweep turns clockwise) and locks", async () => {
    const r = await sample();
    const tracks = recordsOfKind(r.document, "track");
    const locked = tracks.filter((t) => t.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ net: "SIG", layer: "top", width: 250_000, start: { x: -11_000_000, y: 0 }, end: { x: -8_000_000, y: 0 } });
    const arc = tracks.find((t) => t.sweep !== undefined)!;
    expect(arc.sweep).toBeLessThan(0);
    expect(Math.abs(arc.sweep! + 106_260)).toBeLessThanOrEqual(2);
    expect(tracks.every((t) => /^trk:g\.[0-9a-f]{12}$/.test(t.id))).toBe(true);
  });

  it("maps through, blind, buried and micro vias", async () => {
    const r = await sample();
    const spans = recordsOfKind(r.document, "via").map((v) => `${v.from_layer}-${v.to_layer}`).sort();
    expect(spans).toEqual(["inner1-inner2", "top-bottom", "top-inner1", "top-inner1"]);
    for (const k of ["through", "blind", "buried", "micro"]) expect(has(r, "info", `1 ${k} via`)).toBe(true);
  });

  it("maps zone intent and carries the fill separately, holes recovered", async () => {
    const r = await sample();
    const zones = recordsOfKind(r.document, "zone");
    const gnd = zones.find((z) => z.net === "GND")!;
    expect(gnd).toMatchObject({ layers: ["top"], priority: 2, clearance: 300_000, min_width: 250_000, pad_connection: "thermal", thermal_gap: 400_000, thermal_spoke_width: 500_000, fill_mode: "solid", remove_islands: "below_area", island_min_area: 1.5e12, name: "ground pour" });
    const vcc = zones.find((z) => z.net === "VCC")!;
    expect(vcc).toMatchObject({ layers: ["inner1", "inner2"], pad_connection: "none", fill_mode: "hatch", hatch_width: 300_000, hatch_gap: 500_000, remove_islands: "never" });
    expect(r.fill.fills).toHaveLength(1);
    const f = r.fill.fills[0];
    expect(f).toMatchObject({ zone: gnd.id, net: "GND", layer: "top" });
    expect(f.polygons[0].holes).toHaveLength(1);
    expect(f.polygons[0].holes[0]).toHaveLength(8);
    expect(fillIsCurrent(r.fill, r.document)).toBe(true);
  });

  it("maps rule areas to keep-outs with what they block", async () => {
    const r = await sample();
    const [k] = recordsOfKind(r.document, "keepout");
    expect(k).toMatchObject({ layers: ["top", "bottom"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go" });
  });

  it("maps board graphics and texts", async () => {
    const r = await sample();
    const texts = recordsOfKind(r.document, "text");
    expect(texts.find((t) => t.text === "Rev A")).toMatchObject({ layer: "top_silkscreen", x: 10_000_000, y: -8_000_000, height: 1_000_000, anchor: "left" });
    expect(texts.find((t) => t.text === "Back")).toMatchObject({ layer: "bottom_silkscreen", mirrored: true });
    const g = recordsOfKind(r.document, "graphic");
    expect(g.find((x) => x.layer === "top_silkscreen")).toMatchObject({ shape: "line", locked: true });
  });
});

describe("KiCad board: net classes and rules", () => {
  it("maps net classes with KiCad's assignment order", async () => {
    const r = await sample();
    expect(recordsOfKind(r.document, "netclass").map((c) => [c.name, c.nets, c.patterns])).toEqual([
      ["Power_Rail", ["GND", "VCC"], ["VCC*"]],
      ["Signal", ["SIG"], ["S?G"]],
    ]);
    expect(netClassOf(r.document, "UNUSED")).toBe("default");
    expect(has(r, "dropped", "regular expression")).toBe(true);
  });

  it("maps board constraints to floors, class values to targets, simple custom rules to both", async () => {
    const r = await sample();
    const rules = new Map(recordsOfKind(r.document, "rule").map((x) => [x.id, x]));
    expect(rules.get("rule:kicad.board.min_clearance")).toMatchObject({ tier: "floor", check: "clearance", applies: {}, min: 100_000 });
    expect(rules.get("rule:kicad.board.min_copper_edge_clearance")).toMatchObject({ tier: "floor", check: "edge_clearance", min: 300_000 });
    expect(rules.get("rule:kicad.class.default.track_width")).toMatchObject({ tier: "target", applies: {}, min: 250_000 });
    expect(rules.get("rule:kicad.class.Power_Rail.via_hole")).toMatchObject({ tier: "target", applies: { classes: ["Power_Rail"] }, min: 400_000 });
    expect(rules.get("rule:kicad.dru.1.power_wide.track_width")).toMatchObject({ tier: "floor", min: 400_000, applies: { classes: ["Power_Rail"] } });
    expect(rules.get("rule:kicad.dru.1.power_wide.track_width.opt")).toMatchObject({ tier: "target", min: 600_000 });
    expect(rules.get("rule:kicad.dru.2.via_holes.via_hole")).toMatchObject({ tier: "floor", check: "via_hole", min: 250_000 });
    expect(rules.get("rule:kicad.dru.4.outer_clearance.clearance")).toMatchObject({ applies: { layers: ["top", "bottom"] }, min: 152_400 });
    expect(rules.get("rule:kicad.dru.7.edge.edge_clearance")).toMatchObject({ severity: "warning", min: 500_000 });
    // every rule that could not be mapped is reported, by name
    for (const s of ["min_silk_clearance", "max_error", "uvia_diameter", "diff_pair_width", "all holes", "courtyard area", "skew"]) expect(r.report.some((i) => i.level === "dropped" && (i.source ?? "").includes(s))).toBe(true);
  });

  it("says plainly when several custom rules give one check a minimum (combined by the largest)", () => {
    const dru = `(version 1)\n(rule "a" (layer outer) (constraint clearance (min 0.2mm)))\n(rule "b" (condition "A.NetName == 'GND'") (constraint clearance (min 0.3mm)))\n(rule "c" (constraint track_width (min 0.2mm)))\n`;
    const r = importKicadPcb(readFileSync(SAMPLE, "utf8"), { rules: dru });
    const line = r.report.find((i) => i.level === "approximated" && i.message.includes("combined by the largest minimum"));
    expect(line?.message).toContain("2 custom rules give clearance a minimum (a, b)");
    expect(line?.message).toContain("KiCad would use the last matching rule");
    expect(r.report.some((i) => i.message.includes("give track_width"))).toBe(false);
  });

  it("reports when the project and rules files are absent", async () => {
    const r = await importBoard({ text: readFileSync(SAMPLE, "utf8"), kind: "kicad_pcb" });
    expect(recordsOfKind(r.document, "rule")).toHaveLength(0);
    expect(has(r, "info", "project file")).toBe(true);
  });
});

describe("KiCad 10 files", () => {
  it("reads net names, renames repeated references, keeps footprint keep-outs, twins and zone arcs", async () => {
    const r = await importBoard({ path: V10 });
    expect(r.offset).toEqual({ x: 10_000_000, y: -10_000_000 });
    expect(r.netlist.nets.map((n) => n.name)).toEqual(["12", "LED_K"]);
    expect(recordsOfKind(r.document, "footprint").map((f) => f.ref)).toEqual(["D_1", "D_1_2"]);
    expect(has(r, "approximated", "footprint reference renamed")).toBe(true);
    const [k] = recordsOfKind(r.document, "keepout");
    expect(k.footprint).toBe("fp:D_1");
    const tracks = recordsOfKind(r.document, "track");
    expect(tracks).toHaveLength(2);
    expect(tracks.some((t) => t.id.endsWith("~2"))).toBe(true);
    const via = recordsOfKind(r.document, "via")[0];
    expect(via).toMatchObject({ net: "12", tented: "top" });
    const z = recordsOfKind(r.document, "zone")[0];
    expect(z).toMatchObject({ net: "12", layers: ["top", "bottom"], pad_connection: "solid", name: "numbered net" });
    expect(z.outline.some((v) => v.sweep !== undefined)).toBe(true);
    expect(has(r, "approximated", "zone corner smoothing")).toBe(true);
    // a 45 degree footprint: pads still land where KiCad has them
    const e = padWorldError(r.document, r.offset, kicadWorldPads(readFileSync(V10, "utf8")));
    expect(e.maxNm).toBeLessThanOrEqual(1);
    expect(e.angleMismatches).toBe(0);
    expect(saveAndReload(r).equal).toBe(true);
  });

  it("writes the derived fill to the board's build cache", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-board-import-cache-"));
    const boardDir = join(root, "src", "main", "board");
    const r = await importBoard({ path: V10 }, { cache: { projectRoot: root, boardDir } });
    const path = derivedFillPath(root, boardDir);
    expect(path.replace(/\\/g, "/")).toMatch(/\.protoboard\/build\/board\/src__main__board\/zone-fill\.json$/);
    expect(existsSync(path)).toBe(true);
    const fill = readDerivedFill(path);
    expect(fill.inputHash).toBe(r.fill.inputHash);
    expect(fill.fills[0]).toMatchObject({ layer: "bottom", net: "12" });
  });

  it("refuses a file that is not a board", () => {
    expect(() => importKicadPcb("(kicad_sch (version 1))")).toThrow(/not a KiCad board/);
  });
});

/**
 * Expected values read off kicad-cli's SVG export (KiCad 10.0) of a small hand-written board with these footprints:
 * pad corners and text angles as KiCad draws them, in KiCad's millimeters (Y down).
 */
describe("KiCad board: checked against kicad-cli output", () => {
  const head = readFileSync(SAMPLE, "utf8").split('  (net 0 "")')[0];
  const fpText = (lib: string, layer: string, at: string, body: string) => `  (footprint "T:${lib}" (layer "${layer}") (at ${at})
    (property "Reference" "${lib}" (at 0 -6 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1))))
${body}
  )
`;
  const board = `${head}  (net 0 "")
${[
    fpText("TA", "F.Cu", "50 50 0", '    (pad "1" smd trapezoid (at 0 0) (size 2 1) (rect_delta 0 0.6) (layers "F.Cu"))\n    (pad "2" smd trapezoid (at 5 0) (size 2 1) (rect_delta 0.6 0) (layers "F.Cu"))'),
    fpText("TB", "F.Cu", "70 50 30", '    (pad "1" smd trapezoid (at 0 0 30) (size 2 1) (rect_delta 0 0.6) (layers "F.Cu"))'),
    fpText("TC", "B.Cu", "90 50 0", '    (pad "1" smd trapezoid (at 0 0) (size 2 1) (rect_delta 0 0.6) (layers "B.Cu"))'),
    fpText("CA", "F.Cu", "50 70 45", '    (pad "1" smd custom (at 2 1 45) (size 0.5 0.5) (layers "F.Cu") (options (clearance outline) (anchor rect)) (primitives (gr_poly (pts (xy 0 0) (xy 3 0) (xy 3 0.6) (xy 0.6 0.6) (xy 0.6 2) (xy 0 2)) (width 0) (fill yes))))'),
    fpText("XA", "F.Cu", "50 90 90", '    (fp_text user "HHHH" (at 1 2 90) (layer "F.SilkS") (effects (font (size 1 1))))'),
    fpText("XE", "F.Cu", "125 60 0", '    (fp_text user "HHHH" (at 1 2 180) (layer "F.SilkS") (effects (font (size 1 1))))'),
    fpText("XF", "B.Cu", "125 80 0", '    (fp_text user "HHHH" (at 1 2 200) (layer "B.SilkS") (effects (font (size 1 1))))'),
    fpText("XG", "F.Cu", "60 60 90", '    (fp_text user "HHHH" (at 1 2 30) (unlocked yes) (layer "F.SilkS") (effects (font (size 1 1))))'),
    fpText("XH", "F.Cu", "60 80 0", '    (fp_text user "HHHH" (at 1 2 270) (layer "F.SilkS") (effects (font (size 1 1))))'),
  ].join("")})
`;
  const r = importKicadPcb(board, { recenter: false });
  const kicadMm = (p: { x: number; y: number }) => [Math.round(p.x / 100) / 1e4, Math.round(-p.y / 100) / 1e4];
  const corners = (ref: string, n: string) => {
    const f = fp(r, ref);
    const p = pad(f, n);
    return p.points!.map((v) => kicadMm(footprintToWorld(f, { x: p.x + v.x, y: p.y + v.y }))).map(([x, y]) => `${x},${y}`).sort();
  };
  const sorted = (l: number[][]) => l.map(([x, y]) => `${x},${y}`).sort();

  it("draws trapezoids as KiCad does: delta y widens the lower side, delta x the left side", () => {
    expect(corners("TA", "1")).toEqual(sorted([[48.7, 50.5], [51.3, 50.5], [50.7, 49.5], [49.3, 49.5]]));
    expect(corners("TA", "2")).toEqual(sorted([[54, 50.8], [56, 50.2], [56, 49.8], [54, 49.2]]));
    expect(corners("TB", "1")).toEqual(sorted([[69.1242, 51.083], [71.3758, 49.783], [70.3562, 49.217], [69.1438, 49.917]]));
    expect(corners("TC", "1")).toEqual(sorted([[88.7, 50.5], [91.3, 50.5], [90.7, 49.5], [89.3, 49.5]]));
  });

  it("builds a custom pad's outline from its anchor and primitives, turned with its footprint and pad", () => {
    const want = [[52.2981, 69.1161], [54.2426, 67.1716], [54.6669, 67.5958], [52.9698, 69.2929], [53.9598, 70.2828], [53.5355, 70.7071], [52.2981, 69.4697], [52.1213, 69.6464], [51.7678, 69.2929], [52.1213, 68.9393]];
    expect(corners("CA", "1")).toEqual(sorted(want));
  });

  it("reads footprint text angles as board angles and turns them upright as KiCad shows them", () => {
    const shown = (ref: string) => {
      const f = fp(r, ref);
      const t = f.texts!.find((x) => x.text === "HHHH")!;
      return { at: kicadMm(footprintToWorld(f, t)), deg: normAngle(f.side === "bottom" ? f.rotation - (t.rotation ?? 0) : f.rotation + (t.rotation ?? 0)) / 1000 };
    };
    expect(shown("XA")).toEqual({ at: [52, 89], deg: 90 });
    expect(shown("XE")).toEqual({ at: [126, 62], deg: 0 });
    expect(shown("XF")).toEqual({ at: [126, 82], deg: 20 });
    expect(shown("XG")).toEqual({ at: [62, 59], deg: 30 });
    expect(shown("XH")).toEqual({ at: [61, 82], deg: 90 });
    expect(has(r, "info", "footprint text turned upright")).toBe(true);
  });
});

describe("fill polygons", () => {
  it("leaves a ring without bridges whole and turns it counterclockwise", () => {
    const p = unfracture([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(p.holes).toEqual([]);
    expect(p.outer).toEqual([10, 0, 10, 10, 0, 10, 0, 0]);
  });
  it("footprintToWorld agrees with the frame used for bottom footprints", async () => {
    const r1 = fp(await sample(), "R1");
    const w = footprintToWorld(r1, { x: pad(r1, "1").x, y: pad(r1, "1").y });
    expect([Math.round(w.x), Math.round(w.y)]).toEqual([5_000_000, 3_200_000]);
  });
});

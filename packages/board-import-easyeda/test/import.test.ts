/** The EasyEDA Pro importer on hand-written synthetic exports (format 3 and format 2). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copperLayers,
  documentsEqual,
  loadBoardDir,
  mil,
  padsOf,
  recordsOfKind,
  writeBoardDir,
  writeNetlist,
  type FootprintRec,
  type KeepoutRec,
  type TrackRec,
  type ZoneRec,
} from "@protoboardai/board";
import { easyedaImporter, createEasyEdaImporter, importEasyEdaPro, listEasyEdaPcbs, parseLog } from "../src/index.js";
import { writeZip } from "../src/zip.js";
import { airnodeEpro, airnodeEpro2, airnodeLog } from "./samples.js";

const byRef = (doc: ReturnType<typeof importEasyEdaPro>["document"], ref: string) => recordsOfKind(doc, "footprint").find((f) => f.ref === ref) as FootprintRec;
// the synthetic outline spans 0..2000 by 0..1000 mils: the board is shifted by its center
const OX = mil(1000);
const OY = mil(500);
const at = (x: number, y: number) => ({ x: mil(x) - OX, y: mil(y) - OY });

describe("format 3 (.epro2)", () => {
  const r = importEasyEdaPro(airnodeEpro2());
  const doc = r.document;

  it("reads the project log with the eventual-consistency rules", () => {
    const docs = parseLog(airnodeLog());
    expect(docs.get("p2")?.deleted).toBe(true);
    const lines = docs.get("p1")!.records.get("LINE")!;
    expect(lines.get("t2")!.data.width).toBe(20); // the higher ticket wins
    expect(lines.has("t3")).toBe(false); // deleted by an empty inner record
    expect(listEasyEdaPcbs(airnodeEpro2()).map((p) => p.title)).toEqual(["Airnode C3 main"]);
  });

  it("recenters on the outline and keeps it closed", () => {
    expect(r.offset).toEqual({ x: OX, y: OY });
    const o = doc.records.get("outline");
    expect(o?.kind).toBe("outline");
    if (o?.kind !== "outline") return;
    const xs = o.outline.map((v) => v.x);
    const ys = o.outline.map((v) => v.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-OX, OX, -OY, OY]);
    expect(o.locked).toBe(true);
  });

  it("builds the stackup from the physical layer records", () => {
    const layers = recordsOfKind(doc, "layer").sort((a, b) => a.order - b.order);
    expect(layers.map((l) => l.name)).toEqual(["top_mask", "top", "dielectric1", "bottom"]);
    expect(layers.find((l) => l.name === "dielectric1")).toMatchObject({ type: "dielectric", material: "FR4", thickness: mil(59.449), epsilon_r: 4.5 });
    expect(copperLayers(doc)).toEqual(["top", "bottom"]);
    const board = doc.records.get("board");
    expect(board).toMatchObject({ kind: "board", name: "Airnode C3 main", copper_layers: 2, thickness: mil(0.394) + 2 * mil(1.378) + mil(59.449) });
  });

  it("places footprints so their pads land where the copper ends", () => {
    const r1 = byRef(doc, "R1");
    expect(r1).toMatchObject({ footprint: "R0603", rotation: 90_000, side: "top", supplier_part: "C25804", value: "10k", locked: true });
    const pad2 = padsOf(r1).find((p) => p.key === "2")!;
    const t1 = doc.records.get("trk:t1") as TrackRec;
    expect({ x: pad2.x, y: pad2.y }).toEqual(t1.start);
    // R2 is on the bottom: the format mirrors y, the board document mirrors x and turns 180 degrees
    const r2 = byRef(doc, "R2");
    expect(r2).toMatchObject({ side: "bottom", rotation: 180_000 });
    const pad1 = padsOf(r2).find((p) => p.key === "1")!;
    expect({ x: pad1.x, y: pad1.y }).toEqual(at(1470, 500));
    expect(pad1.layers).toEqual(["bottom"]);
    expect(r1.pads[0]).toMatchObject({ type: "smd", shape: "rect", width: mil(30), height: mil(35), layer: "top", mask_margin: mil(2) });
  });

  it("maps through-hole, slotted and non-plated pads", () => {
    const j1 = byRef(doc, "J1");
    expect(j1.pads[0]).toMatchObject({ type: "th", shape: "circle", outer_diameter: mil(60), hole_diameter: mil(40) });
    expect(j1.pads[1]).toMatchObject({ type: "th", shape: "oval", outer_width: mil(60), outer_height: mil(100), hole_width: mil(30), hole_height: mil(60) });
    expect(j1.pads[2]).toMatchObject({ type: "np", hole_diameter: mil(50), number: "_3" });
    expect(j1.texts?.find((t) => t.role === "user")?.text).toBe("1");
  });

  it("keeps the designator text in the footprint frame", () => {
    const r1 = byRef(doc, "R1");
    const ref = r1.texts?.find((t) => t.role === "ref");
    // placed 60 mils above a component turned 90 degrees: (60, 0) rotated back by -90 is (0, -60)... in the
    // footprint frame the text sits at R(-90) (0, 60) = (60, 0)
    expect(ref).toMatchObject({ text: "R1", layer: "top_silkscreen", x: mil(60), y: 0 });
    const r2 = byRef(doc, "R2");
    expect(r2.texts?.find((t) => t.role === "ref")).toMatchObject({ layer: "top_silkscreen", x: 0, y: -mil(60) });
  });

  it("imports copper, vias, zones, fills and keep-outs", () => {
    expect((doc.records.get("trk:t2") as TrackRec).width).toBe(mil(20));
    expect(doc.records.has("trk:t3")).toBe(false);
    const arc = doc.records.get("trk:a1") as TrackRec;
    expect(arc).toMatchObject({ layer: "bottom", net: "GND", sweep: 90_000 });
    expect(doc.records.get("via:v1")).toMatchObject({ net: "VCC", outer_diameter: mil(24), hole_diameter: mil(12), from_layer: "top", to_layer: "bottom", ...at(800, 530) });
    const pour = doc.records.get("zone:z1") as ZoneRec;
    expect(pour).toMatchObject({ net: "GND", layers: ["bottom"], priority: 2, min_width: mil(8), remove_islands: "always", fill_mode: "solid", name: "GND bottom" });
    const fill = doc.records.get("zone:f9") as ZoneRec;
    expect(fill).toMatchObject({ net: "GND", layers: ["top"], priority: 1000 });
    expect(fill.outline.every((v) => v.sweep === 90_000)).toBe(true);
    const pf = r.fill.fills.find((f) => f.zone === "zone:z1")!;
    expect(pf.polygons).toHaveLength(1);
    expect(pf.polygons[0].holes).toHaveLength(1);
    expect(r.fill.fills.find((f) => f.zone === "zone:f9")?.polygons).toHaveLength(1);
    const kp = doc.records.get("kpo:k1") as KeepoutRec;
    expect(kp).toMatchObject({ layers: ["top"], blocks: { tracks: true, vias: true, pours: false, footprints: false }, tier: "no_go", name: "no via here" });
    expect(doc.records.has("kpo:k2")).toBe(false);
    expect(doc.records.get("txt:s1")).toMatchObject({ text: "Airnode C3", anchor: "center", layer: "top_silkscreen", ...at(1000, 900) });
    expect(doc.records.get("txt:s1")).not.toHaveProperty("rotation");
  });

  it("builds the netlist and net classes", () => {
    const gnd = r.netlist.nets.find((n) => n.name === "GND")!;
    expect(gnd).toMatchObject({ class: "Power", pins: ["J1.1", "R1.1", "R2.2"] });
    expect(r.netlist.nets.find((n) => n.name === "VCC")?.pins).toEqual(["R1.2", "R2.1"]);
    expect(doc.records.get("class:Power")).toMatchObject({ nets: ["GND"] });
    for (const n of doc.nets.values()) expect(n.missing).toEqual([]);
  });

  it("reports what it dropped and approximated, with counts", () => {
    const msg = r.report.map((x) => `${x.level} ${x.message}`);
    expect(msg).toContain("dropped 1 DIMENSION records: dimensions are not modeled by the board document");
    expect(msg.some((m) => m.startsWith("dropped 1 RULE records"))).toBe(true);
    // counted per placed footprint: R1 and R2 share the footprint with one such shape
    expect(msg.some((m) => m.startsWith("dropped 2 footprint shapes on COMPONENT_SHAPE layers"))).toBe(true);
    expect(msg.some((m) => m.startsWith("dropped 1 regions without prohibitions"))).toBe(true);
    expect(msg.some((m) => m.startsWith("approximated 1 pour result strokes"))).toBe(true);
    expect(msg.some((m) => m.startsWith("info 1 board recentered") && m.includes(`(${-OX}, ${-OY})`))).toBe(true);
    expect(r.recordTypes.LINE).toEqual({ count: 2, handling: "mapped" });
    expect(r.recordTypes.CANVAS.handling).toBe("ignored");
  });

  it("saves and reloads through the board files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-easyeda-"));
    writeBoardDir(dir, doc);
    writeNetlist(dir, r.netlist);
    const back = loadBoardDir(dir);
    expect(documentsEqual(back.doc, doc)).toBe(true);
  });

  it("is an Importer", async () => {
    expect(easyedaImporter.accepts({ path: "x/board.epro2" })).toBe(true);
    expect(easyedaImporter.accepts({ path: "x/board.kicad_pcb" })).toBe(false);
    expect(easyedaImporter.accepts({ kind: "epro" })).toBe(true);
    const res = await easyedaImporter.import({ bytes: airnodeEpro2() }, {});
    expect(res.document?.records.size).toBe(doc.records.size);
    await expect(createEasyEdaImporter({ pcb: "nope" }).import({ bytes: airnodeEpro2() }, {})).rejects.toThrow(/no PCB "nope"/);
  });
});

describe("surface pads on a footprint's other side", () => {
  // the R0603 footprint with a third pad drawn on the bottom copper layer of the footprint document
  const log = airnodeLog().replace(
    /(\{"type":"PAD","id":"e2"[^\n]*\n)/,
    `$1${JSON.stringify({ type: "PAD", id: "e9", ticket: 9000 })}||${JSON.stringify({ layerId: 2, num: "3", centerX: 0, centerY: 40, padAngle: 0, hole: null, defaultPad: { padType: "RECT", width: 20, height: 20, radius: 0 }, specialPad: [], plated: true })}|\n`,
  );
  const r = importEasyEdaPro(writeZip({ "project2.json": JSON.stringify({ title: "Airnode C3" }), "Airnode C3.epru": log }, { deflate: true }));

  it("keeps them with layer bottom and lands them on the side opposite to the footprint", () => {
    expect(log).toContain('"id":"e9"');
    const r1 = byRef(r.document, "R1");
    const r2 = byRef(r.document, "R2");
    expect(r1.pads.find((p) => p.number === "3")).toMatchObject({ type: "smd", layer: "bottom", x: 0, y: mil(40) });
    const top3 = padsOf(r1).find((p) => p.key === "3")!;
    const bot3 = padsOf(r2).find((p) => p.key === "3")!;
    expect(top3.layers).toEqual(["bottom"]);
    expect(bot3.layers).toEqual(["top"]);
    // R1 (top, turned 90 degrees at 500, 500): (0, 40) lands at (460, 500); R2 (bottom at 1500, 500; the format mirrors y): (1500, 460)
    expect({ x: top3.x, y: top3.y }).toEqual(at(460, 500));
    expect({ x: bot3.x, y: bot3.y }).toEqual(at(1500, 460));
    expect(r.report.some((x) => x.level === "dropped" && /surface pads/.test(x.message))).toBe(false);
    expect(r.report.some((x) => x.level === "info" && x.message.startsWith("2 surface pads on the footprint's other side"))).toBe(true);
  });
});

describe("format 2 (.epro)", () => {
  const r = importEasyEdaPro(airnodeEpro());
  const doc = r.document;

  it("reads positional records into the same board", () => {
    expect(r.format).toBe(2);
    expect(r.pcb.title).toBe("Airnode C3 v2");
    const r1 = byRef(doc, "R1");
    expect(r1.pads.map((p) => p.number)).toEqual(["1", "2"]);
    expect(r1.texts?.find((t) => t.role === "ref")).toMatchObject({ anchor: "center", y: mil(60) });
    expect(doc.records.get("trk:e30")).toMatchObject({ net: "GND", locked: true, width: mil(10) });
    expect(doc.records.get("kpo:e32")).toMatchObject({ blocks: { tracks: true, vias: true, pours: false, footprints: false } });
    expect(doc.records.get("txt:e33")).toMatchObject({ text: "V2", anchor: "center" });
    expect(doc.records.get("zone:e34")).toMatchObject({ net: "GND", layers: ["bottom"], remove_islands: "never" });
    expect(doc.records.get("gfx:e35")).toMatchObject({ shape: "circle", filled: true, layer: "top_silkscreen" });
    expect(r.netlist.nets.map((n) => [n.name, n.pins])).toEqual([
      ["GND", ["R1.1"]],
      ["SIG", ["R1.2"]],
    ]);
  });

  it("chains outline lines and arcs into one counterclockwise contour", () => {
    const o = doc.records.get("outline");
    if (o?.kind !== "outline") throw new Error("no outline");
    expect(o.outline).toHaveLength(4);
    expect(o.outline.filter((v) => v.sweep).map((v) => v.sweep)).toEqual([90_000]);
    // the arc bulges outward: the outline's area is more than the 1000 x 1000 mil square
    let a = 0;
    for (let i = 0; i < o.outline.length; i++) {
      const p = o.outline[i];
      const q = o.outline[(i + 1) % o.outline.length];
      a += p.x * q.y - q.x * p.y;
    }
    expect(a).toBeGreaterThan(0);
  });

  it("uses the default stackup numbering and keeps unused inner layers out", () => {
    expect(copperLayers(doc)).toEqual(["top", "bottom"]);
    expect(recordsOfKind(doc, "layer").map((l) => l.name)).toEqual(["bottom", "dielectric1", "top"]);
  });
});

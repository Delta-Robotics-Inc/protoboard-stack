/** Test cases for the Phase 2 drawing, placement, rework, DXF and netlist operations (merged into OP_CASES). */
import { expect } from "vitest";
import { AIRNODE_C3_NETLIST } from "../src/fixtures/airnode-c3.js";
import { getOperation, provenanceFor, type BoardDocument, type BoardRecord, type CutoutRec, type FootprintRec, type GraphicRec, type OutlineRec, type TextRec, type TrackRec } from "../src/index.js";
import type { OpCase } from "./op-cases.js";

const rec = <T extends BoardRecord>(d: BoardDocument, id: string) => d.records.get(id) as T;

/** An operation's report (cases see only documents; this applies the call again on the same input). */
function reportOf(before: BoardDocument, call: Record<string, unknown> & { op: string }, kind: "human" | "agent" = "human"): Record<string, unknown> {
  const actor = { kind, id: kind };
  let n = 0;
  const def = getOperation(call.op)!;
  const { op: _o, ...args } = call;
  return def.apply(before, def.input.parse(args), { actor, issueId: (k) => `${k}:report.${++n}`, provenance: provenanceFor(actor), edited: kind === "human" ? "hand" : "agent", lockCopper: kind === "human" }).report ?? {};
}
const LF = "\n";

/** A DXF of LINE entities forming a closed polygon (millimeters). */
function dxfLines(points: [number, number][], layer = "0"): string {
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  points.forEach(([x, y], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    out.push("0", "LINE", "8", layer, "10", String(x), "20", String(y), "11", String(x2), "21", String(y2));
  });
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join(LF) + LF;
}

/** A 30 x 20 mm rectangle of LINEs with a 3 mm circle near one corner. */
const SQUARE_WITH_HOLE = dxfLines([
  [0, 0],
  [30, 0],
  [30, 20],
  [0, 20],
]).replace(`${LF}0${LF}ENDSEC`, [LF + "0", "CIRCLE", "8", "0", "10", "5", "20", "5", "40", "1.5", "0", "ENDSEC"].join(LF));

export const OP_CASES_P2: Record<string, OpCase[]> = {
  "text.add": [
    {
      name: "adds text with a handle",
      call: { op: "text.add", handle: "t", text: { layer: "bottom_silkscreen", text: "v1", x: 0, y: 0, height: 1_000_000, mirrored: true } },
      check(_b, a, created) {
        const t = rec<TextRec>(a, created.t);
        expect([t.kind, t.text, t.mirrored, t.provenance.by]).toEqual(["text", "v1", true, "hand"]);
      },
    },
    { name: "a copper layer outside the stackup", call: { op: "text.add", text: { layer: "inner2", text: "x", x: 0, y: 0, height: 1_000_000 } }, fails: "not in this board's stackup", check() {} },
  ],
  "text.edit": [
    {
      name: "patch and unset",
      call: { op: "text.edit", id: "txt:f.title", patch: { text: "Airnode", rotation: 90_000 }, unset: ["stroke_width"] },
      check(_b, a) {
        const t = rec<TextRec>(a, "txt:f.title");
        expect([t.text, t.rotation, t.stroke_width]).toEqual(["Airnode", 90_000, undefined]);
      },
    },
    { name: "the text itself stays", call: { op: "text.edit", id: "txt:f.title", patch: {}, unset: ["text"] }, fails: "cannot be removed", check() {} },
    { name: "only text", call: { op: "text.edit", id: "gfx:f.logo_box", patch: { text: "x" } }, fails: "not a text", check() {} },
  ],
  "text.delete": [
    { name: "removes", call: { op: "text.delete", ids: ["txt:f.title"] }, check: (_b, a) => expect(a.records.has("txt:f.title")).toBe(false) },
    { name: "not a graphic", call: { op: "text.delete", ids: ["gfx:f.logo_box"] }, fails: "not a text", check() {} },
  ],
  "graphic.add": [
    {
      name: "a circle on a copper layer",
      actor: "agent",
      call: { op: "graphic.add", handle: "c", graphic: { layer: "bottom", shape: "circle", center: { x: 0, y: 0 }, radius: 1_000_000, stroke_width: 100_000 } },
      check(_b, a, created) {
        const g = rec<GraphicRec>(a, created.c);
        expect([g.shape, g.layer, g.provenance.by]).toEqual(["circle", "bottom", "agent"]);
      },
    },
    { name: "an arc needs its sweep", call: { op: "graphic.add", graphic: { layer: "user_notes", shape: "arc", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stroke_width: 1 } }, fails: "needs sweep", check() {} },
    { name: "a polygon needs three points", call: { op: "graphic.add", graphic: { layer: "user_notes", shape: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], stroke_width: 1 } }, fails: "three points", check() {} },
  ],
  "graphic.edit": [
    {
      name: "patches a field",
      call: { op: "graphic.edit", id: "gfx:f.logo_box", patch: { height: 5_000_000, filled: true } },
      check(_b, a) {
        const g = rec<GraphicRec>(a, "gfx:f.logo_box");
        expect([g.height, g.filled]).toEqual([5_000_000, true]);
      },
    },
    { name: "a rect keeps its width", call: { op: "graphic.edit", id: "gfx:f.logo_box", patch: {}, unset: ["width"] }, fails: "needs width", check() {} },
  ],
  "graphic.delete": [{ name: "removes", call: { op: "graphic.delete", ids: ["gfx:f.logo_box"] }, check: (_b, a) => expect(a.records.has("gfx:f.logo_box")).toBe(false) }],
  "footprint.add": [
    {
      name: "by path; its pad joins the netlist's net",
      call: { op: "footprint.add", footprint: { ref: "TP1", path: "test/tp1", footprint: "Airnode:TestPoint", x: 0, y: 0, rotation: 0, side: "top", pads: [{ number: "1", type: "smd", shape: "circle", x: 0, y: 0, radius: 500_000 }] } },
      check(_b, a) {
        const f = rec<FootprintRec>(a, "fp:test/tp1");
        expect([f.ref, f.provenance.by]).toEqual(["TP1", "hand"]);
      },
    },
    {
      name: "by reference without a path",
      actor: "agent",
      call: { op: "footprint.add", footprint: { ref: "TP2", footprint: "Airnode:TestPoint", x: 0, y: 0, rotation: 0, side: "bottom", pads: [] } },
      check: (_b, a) => expect(rec<FootprintRec>(a, "fp:TP2").side).toBe("bottom"),
    },
    { name: "a reference already used", call: { op: "footprint.add", footprint: { ref: "U1", path: "other/u1", footprint: "x", x: 0, y: 0, rotation: 0, side: "top", pads: [] } }, fails: "already used by fp:mcu/module", check() {} },
    { name: "an id already used", call: { op: "footprint.add", footprint: { ref: "U9", path: "mcu/module", footprint: "x", x: 0, y: 0, rotation: 0, side: "top", pads: [] } }, fails: "already exists", check() {} },
  ],
  "footprint.remove": [
    {
      name: "keeps attached copper and reports it orphaned",
      call: { op: "footprint.remove", ids: ["fp:power/ldo"] },
      check(b, a) {
        expect(a.records.has("fp:power/ldo")).toBe(false);
        expect(a.records.has("trk:f.3v3.1")).toBe(true);
        expect(a.records.has("trk:f.vbus.2")).toBe(true);
        expect(reportOf(b, { op: "footprint.remove", ids: ["fp:power/ldo"] })).toEqual({ removed: ["fp:power/ldo"], keepouts: [], copper: "keep", orphaned: ["trk:f.3v3.1", "trk:f.vbus.2"], removedCopper: [], skippedLocked: [] });
      },
    },
    {
      name: "an agent removes unlocked copper and skips locked",
      actor: "agent",
      call: { op: "footprint.remove", ids: ["fp:power/ldo"], copper: "remove" },
      check(b, a) {
        expect(a.records.has("trk:f.3v3.1")).toBe(false);
        expect(a.records.has("trk:f.vbus.2")).toBe(true);
        const r = reportOf(b, { op: "footprint.remove", ids: ["fp:power/ldo"], copper: "remove" }, "agent");
        expect([r.removedCopper, r.skippedLocked, r.orphaned]).toEqual([["trk:f.3v3.1"], ["trk:f.vbus.2"], ["trk:f.vbus.2"]]);
      },
    },
    {
      name: "removes its keep-outs; a track on the other side is not attached",
      call: { op: "footprint.remove", ids: ["fp:mcu/module", "fp:sensor/ic"], copper: "remove" },
      check(_b, a) {
        expect(a.records.has("kpo:f.antenna")).toBe(false);
        expect(a.records.has("trk:f.i2c_sda.1")).toBe(false);
        expect(a.records.has("trk:f.i2c_sda.2")).toBe(false);
        // the SCL track runs on the bottom from top-side pads: not on their copper
        expect(a.records.has("trk:f.i2c_scl.1")).toBe(true);
      },
    },
    { name: "only footprints", call: { op: "footprint.remove", ids: ["trk:f.spare.1"] }, fails: "not a footprint", check() {} },
  ],
  "track.set_width": [
    {
      name: "by ids",
      call: { op: "track.set_width", ids: ["trk:f.spare.1"], width: 450_000 },
      check(b, a) {
        const t = rec<TrackRec>(a, "trk:f.spare.1");
        expect([t.width, t.locked]).toEqual([450_000, true]);
        // an agent setting a net's width skips its locked tracks
        expect(reportOf(b, { op: "track.set_width", net: "VBUS", width: 600_000 }, "agent")).toEqual({ changed: [], necked: [], skippedLocked: ["trk:f.vbus.1", "trk:f.vbus.2"] });
      },
    },
    {
      name: "a net with necks at narrow pads",
      call: { op: "track.set_width", net: "I2C_SDA", width: 500_000, neck: true },
      check(b, a) {
        const tracks = [...a.records.values()].filter((r): r is TrackRec => r.kind === "track" && r.net === "I2C_SDA");
        expect(tracks).toHaveLength(4);
        const t1 = rec<TrackRec>(a, "trk:f.i2c_sda.1");
        const t0 = rec<TrackRec>(b, "trk:f.i2c_sda.1");
        expect(t1.width).toBe(500_000);
        // the neck at U3.1 (0.5 x 0.4 mm): 0.4 mm wide over 0.5 mm
        expect(t1.start).toEqual({ x: t0.start.x, y: t0.start.y - 500_000 });
        const neck = tracks.find((t) => t.start.x === t0.start.x && t.start.y === t0.start.y)!;
        expect([neck.width, neck.end]).toEqual([400_000, t1.start]);
        const n2 = tracks.filter((t) => t.width === 400_000);
        expect(n2).toHaveLength(2);
        const r = reportOf(b, { op: "track.set_width", net: "I2C_SDA", width: 500_000, neck: true });
        expect(r.changed).toEqual(["trk:f.i2c_sda.1", "trk:f.i2c_sda.2"]);
        expect((r.necked as { pad: string }[]).map((n) => n.pad)).toEqual(["pad:sensor/ic:1", "pad:mcu/module:15"]);
      },
    },
    { name: "both ids and net", call: { op: "track.set_width", ids: ["trk:f.spare.1"], net: "GND", width: 1 }, fails: "exactly one", check() {} },
    { name: "an unknown net", call: { op: "track.set_width", net: "NOPE", width: 1 }, fails: "not in the netlist", check() {} },
  ],
  "copper.rip": [
    {
      name: "a net",
      call: { op: "copper.rip", nets: ["I2C_SDA", "GND"] },
      check(_b, a) {
        expect(a.records.has("trk:f.i2c_sda.1")).toBe(false);
        expect(a.records.has("via:f.gnd.3")).toBe(false);
        expect(a.records.has("zone:f.gnd_bottom")).toBe(true);
      },
    },
    {
      name: "a region on one layer; locked copper stays",
      call: { op: "copper.rip", region: [{ x: -13_000_000, y: -10_000_000 }, { x: -9_000_000, y: -10_000_000 }, { x: -9_000_000, y: -4_000_000 }, { x: -13_000_000, y: -4_000_000 }], layers: ["top"] },
      check(b, a) {
        expect(a.records.has("trk:f.vbus.1")).toBe(true);
        expect(a.records.has("trk:f.usb_dp.1")).toBe(false);
        expect(a.records.has("via:f.gnd.1")).toBe(false);
        expect(a.records.has("trk:f.i2c_scl.1")).toBe(true);
        const region = [{ x: -13_000_000, y: -10_000_000 }, { x: -9_000_000, y: -10_000_000 }, { x: -9_000_000, y: -4_000_000 }, { x: -13_000_000, y: -4_000_000 }];
        expect(reportOf(b, { op: "copper.rip", region, layers: ["top"] })).toEqual({ removed: ["trk:f.usb_dn.1", "trk:f.usb_dp.1", "via:f.gnd.1"], skippedLocked: ["trk:f.vbus.1", "trk:f.vbus.2"] });
      },
    },
    {
      name: "vias only",
      call: { op: "copper.rip", nets: ["GND"], kinds: ["via"] },
      check: (_b, a) => expect([...a.records.values()].filter((r) => r.kind === "via")).toHaveLength(0),
    },
    { name: "needs nets or a region", call: { op: "copper.rip", layers: ["top"] }, fails: "give nets, region", check() {} },
  ],
  "outline.import_dxf": [
    {
      name: "a rectangle with a hole, centered",
      call: { op: "outline.import_dxf", dxf: SQUARE_WITH_HOLE },
      check(b, a) {
        const o = rec<OutlineRec>(a, "outline");
        expect(o.outline.map((v) => [v.x, v.y])).toEqual([
          [-15_000_000, -10_000_000],
          [15_000_000, -10_000_000],
          [15_000_000, 10_000_000],
          [-15_000_000, 10_000_000],
        ]);
        const c = rec<CutoutRec>(a, "cutout:dxf.1");
        expect(c.outline.every((v) => v.sweep! < 0)).toBe(true);
        expect(c.outline[0]).toEqual({ x: -8_500_000, y: -5_000_000, sweep: -90_000 });
        expect(reportOf(b, { op: "outline.import_dxf", dxf: SQUARE_WITH_HOLE })).toMatchObject({ entities: 5, loops: 2, cutouts: 1, open: 0, units: "mm", skipped: [], outline: { vertices: 4, area: 600e12 } });
      },
    },
    {
      name: "existing cutouts are replaced",
      call: { op: "outline.import_dxf", dxf: dxfLines([[0, 0], [10, 0], [10, 10], [0, 10]]), origin: "keep", units: "in" },
      check(_b, a) {
        expect(rec<OutlineRec>(a, "outline").outline[2]).toEqual({ x: 254_000_000, y: 254_000_000 });
        expect(a.records.has("cutout:dxf.1")).toBe(false);
      },
    },
    { name: "an open drawing", call: { op: "outline.import_dxf", dxf: ["0", "SECTION", "2", "ENTITIES", "0", "LINE", "10", "0", "20", "0", "11", "1", "21", "0", "0", "ENDSEC", "0", "EOF"].join(LF) }, fails: "no closed loop", check() {} },
    { name: "not a DXF", call: { op: "outline.import_dxf", dxf: "hello" }, fails: "no ENTITIES section", check() {} },
  ],
  "netlist.sync": [
    {
      name: "a rename by pins follows the copper",
      actor: "host",
      call: { op: "netlist.sync", netlist: { source: "fixture", nets: AIRNODE_C3_NETLIST.nets.map((n) => (n.name === "I2C_SDA" ? { ...n, name: "SDA" } : n)) } },
      check(_b, a) {
        expect(rec<TrackRec>(a, "trk:f.i2c_sda.1").net).toBe("SDA");
        expect(a.netlist?.nets.some((n) => n.name === "SDA")).toBe(true);
        expect(a.nets.get("SDA")?.pads.length).toBe(3);
      },
    },
  ],
};

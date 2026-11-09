/**
 * The schematic screen's pure parts: the request envelope, orthogonal paths and the drag preview, a segment moved,
 * the facts with their status chips, the cross-probe's mapping, and the depth stops.
 */
import { describe, expect, it } from "vitest";
import { parseSchematicRequest } from "../../src/schematic/requests.js";
import { followPreview, moveSegment, orthogonal, orthogonalize, reattach, simplifyPath } from "../../src/schematic/paths.js";
import { netFacts, partFacts, pinFacts, voltageText } from "../../src/schematic/facts.js";
import { lodOf, LOD_STOPS } from "../../src/schematic/canvas.js";
import { lastProbe, onProbe, probeFromLayout, probeToLayout, publishProbe } from "../../src/shell/probe.js";
import type { PageDerived, PageNet, PagePart, XY } from "../../src/schematic/types.js";

describe("requests", () => {
  it("takes what a page may ask", () => {
    for (const r of [
      { method: "move", ids: ["sym:a"], dx: 2, dy: -1 },
      { method: "rotate", ids: ["sym:a"], angle: 90 },
      { method: "apply", tx: { batchId: "b1", label: "pin one part by hand", ops: [{ op: "pin", ids: ["sym:a"] }] } },
      { method: "drawWire", net: "SDA", card: "card:x", points: [[0, 0], [3, 0]] },
      { method: "cleanupPreview", budget: 30 },
      { method: "undo" },
    ])
      expect(parseSchematicRequest(r)).toMatchObject({ ok: true });
  });
  it("refuses an actor, a system operation, an unknown method and bad numbers", () => {
    expect(parseSchematicRequest({ method: "undo", actor: { kind: "human", id: "x" } })).toMatchObject({ ok: false });
    expect(parseSchematicRequest({ method: "apply", tx: { batchId: "b", label: "a b c", ops: [{ op: "record.put", records: [] }] } })).toMatchObject({ ok: false });
    expect(parseSchematicRequest({ method: "apply", tx: { batchId: "b", label: "a b c", ops: [{ op: "pin", ids: ["x"], provenance: {} }] } })).toMatchObject({ ok: false });
    expect(parseSchematicRequest({ method: "explode" })).toMatchObject({ ok: false });
    expect(parseSchematicRequest({ method: "move", ids: ["a"], dx: 0.5, dy: 0 })).toMatchObject({ ok: false });
    expect(parseSchematicRequest({ method: "rotate", ids: ["a"], angle: 45 })).toMatchObject({ ok: false });
  });
});

describe("paths", () => {
  it("drops repeated and collinear points", () => {
    expect(simplifyPath([[0, 0], [0, 0], [2, 0], [5, 0], [5, 3]])).toEqual([[0, 0], [5, 0], [5, 3]]);
    expect(simplifyPath([[0, 0], [4, 0], [2, 0]])).toEqual([[0, 0], [2, 0]]);
  });
  it("moves an end with one elbow along the pin's direction, staying orthogonal", () => {
    const r = reattach([[0, 0], [6, 0], [6, 4]], [1, 2], "left");
    expect(r[0]).toEqual([1, 2]);
    expect(orthogonal(r)).toBe(true);
    expect(r[r.length - 1]).toEqual([6, 4]);
    expect(reattach([[0, 0], [0, 5]], [3, 0], "down")).toEqual([[3, 0], [3, 5], [0, 5]]);
  });
  it("makes a hand-drawn path orthogonal on the grid", () => {
    const p = orthogonalize([[0, 0], [3.2, 2.9], [3, 6]]);
    expect(orthogonal(p)).toBe(true);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([3, 6]);
  });
  it("previews the wires on dragged pins: both ends move together, one end gets an elbow", () => {
    const moved = new Map<string, { to: XY; dir: "left" }>([
      ["0,0", { to: [2, 1], dir: "left" }],
      ["0,4", { to: [2, 5], dir: "left" }],
    ]);
    const out = followPreview(
      [
        { id: "w1", net: "A", points: [[0, 0], [0, 4]] },
        { id: "w2", net: "B", points: [[0, 0], [8, 0]] },
        { id: "w3", net: "C", points: [[10, 10], [12, 10]] },
      ],
      moved,
      [2, 1],
    );
    expect(out.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(out[0].points).toEqual([[2, 1], [2, 5]]);
    expect(out[1].points[0]).toEqual([2, 1]);
    expect(orthogonal(out[1].points)).toBe(true);
  });
  it("moves a segment across itself, keeping the ends on their pins", () => {
    const r = moveSegment([[0, 0], [4, 0], [4, 6], [9, 6]], 1, [2, 0]);
    expect(r).toEqual([[0, 0], [6, 0], [6, 6], [9, 6]]);
    const e = moveSegment([[0, 0], [5, 0]], 0, [0, 3]);
    expect(e).toEqual([[0, 0], [0, 3], [5, 3], [5, 0]]);
    expect(orthogonal(e)).toBe(true);
  });
});

const part: PagePart = {
  path: "mcu/module",
  ref: "U1",
  name: "ESP32-C3 module",
  part: "mod",
  class: "module",
  group: "mcu",
  pins: [
    { id: "pin_13", number: "13", name: "IO9", type: "io", voltage: { min: 0, max: 3.6 }, net: "BOOT" },
    { id: "pin_15", number: "15", name: "IO4", type: "io", voltage: { min: 0, max: 3.6 }, net: "SDA" },
  ],
  symbol: { source: "generated", id: "mcu" },
};
const nets: PageNet[] = [
  { name: "BOOT", shown: "BOOT", kind: "signal", cls: "digital", pins: ["mcu/module:pin_13"], cards: ["card:mcu"] },
  { name: "SDA", shown: "SDA", kind: "signal", cls: "i2c", pins: ["mcu/module:pin_15"], cards: ["card:mcu"] },
];
const derived: PageDerived = {
  seq: 1,
  score: 90,
  presentable: true,
  gates: { open: 0, rules: [] },
  rules: [],
  gateRules: [{ id: "C01", title: "drawn netlist equals UHD", count: 0 }],
  defects: [],
  findings: [{ id: "f1", check: "voltage", severity: "error", objects: ["net:BOOT", "pin:mcu/module:pin_13"], path: ["J1 VBUS (supply out, 5 V)", "VBUS", "R8 10k", "BOOT", "U1 pin 13 IO9 (max 3.6 V)"], message: "5 V on U1 pin 13 IO9" }],
  cards: {},
  ms: 3,
};

describe("facts and chips", () => {
  it("a pin with a voltage finding shows the conflict; another pin on a checked net is confirmed", () => {
    const io9 = pinFacts(part, "pin_13", { derived, nets });
    expect(io9.find((f) => f.label === "Voltage check")).toMatchObject({ chip: "conflict" });
    expect(io9.find((f) => f.label === "Net")).toMatchObject({ chip: "confirmed" });
    expect(io9.find((f) => f.label === "Type")).toMatchObject({ chip: "inferred" });
    const io4 = pinFacts(part, "pin_15", { derived, nets });
    expect(io4.find((f) => f.label === "Voltage check")).toMatchObject({ chip: "confirmed" });
    expect(pinFacts(part, "pin_15", { derived, nets, stale: true }).some((f) => f.chip === "stale")).toBe(true);
    expect(pinFacts(part, "pin_15", { derived, nets, proposed: true }).some((f) => f.chip === "proposed")).toBe(true);
  });
  it("a part and a net state where each fact comes from", () => {
    expect(partFacts(part, {}).find((f) => f.label === "Symbol")).toMatchObject({ chip: "inferred", value: "generated: mcu" });
    expect(netFacts(nets[0], { derived, parts: [part], cards: new Map() }).some((f) => f.chip === "conflict")).toBe(true);
    expect(voltageText({ min: 0, max: 3.6 })).toBe("0 V to 3.6 V");
    expect(voltageText({ nominal: 3.3 })).toBe("3.3 V");
  });
});

describe("cross-probe", () => {
  const recs = [
    { kind: "footprint", id: "fp:mcu/module", ref: "U1", path: "mcu/module" },
    { kind: "footprint", id: "fp:sensor/ic", ref: "U3", path: "sensor/ic" },
    { kind: "footprint", id: "fp:x", ref: "R9" },
    { kind: "track", id: "t1", net: "SDA" },
  ];
  it("maps parts by instance path, else by reference, and keeps nets by name", () => {
    expect(probeToLayout({ source: "schematic", parts: [{ path: "mcu/module", ref: "U1" }], nets: ["SDA"], at: 0 }, recs)).toEqual({ ids: ["fp:mcu/module"], nets: ["SDA"] });
    expect(probeToLayout({ source: "schematic", parts: [{ ref: "R9" }], nets: [], at: 0 }, recs).ids).toEqual(["fp:x"]);
    const m = new Map(recs.map((r) => [r.id, r]));
    expect(probeFromLayout(["fp:sensor/ic", "t1"], m)).toEqual({ source: "layout", parts: [{ path: "sensor/ic", ref: "U3" }], nets: ["SDA"] });
  });
  it("delivers a probe and keeps the last one for a screen that opens later", () => {
    const got: string[] = [];
    const off = onProbe((p) => got.push(p.source));
    publishProbe({ source: "layout", parts: [{ path: "a" }], nets: [] });
    off();
    expect(got).toEqual(["layout"]);
    expect(lastProbe()?.parts).toEqual([{ path: "a" }]);
  });
});

describe("depth stops", () => {
  it("blocks, then symbols, then pins and nets as the zoom grows", () => {
    expect(lodOf(LOD_STOPS.blocks - 0.1)).toBe(1);
    expect(lodOf(LOD_STOPS.blocks + 0.1)).toBe(2);
    expect(lodOf(LOD_STOPS.pins)).toBe(3);
  });
});

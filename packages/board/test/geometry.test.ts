/** Geometry and document helpers: the footprint transform, pads, nets, boxes, ids, units. */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { arcCenter, boundsOf, deg, deterministicKey, findingId, footprintToWorld, FindingSchema, mm, netClassOf, normAngle, padsOf, runChecks, toMm, type Check, type FootprintRec } from "../src/index.js";
import { openBoardService } from "../src/service.js";

describe("units", () => {
  it("converts and normalizes", () => {
    expect(mm(1.5)).toBe(1_500_000);
    expect(toMm(250_000)).toBe(0.25);
    expect(deg(90)).toBe(90_000);
    expect(normAngle(-90_000)).toBe(270_000);
    expect(normAngle(720_000)).toBe(0);
  });
});

describe("footprint transform", () => {
  const fp = { x: mm(10), y: mm(5), rotation: 90_000, side: "top" as const };
  it("rotates counterclockwise on top", () => expect(footprintToWorld(fp, { x: mm(1), y: 0 })).toEqual({ x: mm(10), y: mm(6) }));
  it("mirrors left to right on the bottom, then rotates", () => {
    expect(footprintToWorld({ ...fp, rotation: 0, side: "bottom" }, { x: mm(1), y: mm(2) })).toEqual({ x: mm(9), y: mm(7) });
  });
  it("puts a bottom footprint's smd pads on the bottom layer", () => {
    const doc = airnodeC3();
    const c4 = doc.records.get("fp:sensor/c_dec") as FootprintRec;
    expect(padsOf(c4)[0].layers).toEqual(["top"]);
    expect(padsOf({ ...c4, side: "bottom" })[0].layers).toEqual(["bottom"]);
    const usb = doc.records.get("fp:usb/connector") as FootprintRec;
    expect(padsOf(usb).map((p) => p.key).slice(-4)).toEqual(["S", "S~2", "S~3", "S~4"]);
    expect(padsOf(usb).at(-1)!.layers).toEqual(["top", "bottom"]);
  });
});

describe("arcs and boxes", () => {
  it("finds an arc's center from its ends and sweep", () => {
    const c = arcCenter({ x: mm(1), y: 0 }, { x: 0, y: mm(1) }, 90_000);
    expect(Math.abs(Math.round(c.x))).toBe(0);
    expect(Math.abs(Math.round(c.y))).toBe(0);
    expect(Math.round(c.r)).toBe(mm(1));
  });
  it("boxes the rounded outline to the board size", () => {
    const b = boundsOf(airnodeC3().records.get("outline")!)!;
    expect(b).toEqual({ minX: mm(-20), minY: mm(-15), maxX: mm(20), maxY: mm(15) });
  });
});

describe("nets from the netlist", () => {
  it("maps pins to pads and classes", () => {
    const doc = airnodeC3();
    expect(doc.padNets.get("pad:power/ldo:5")).toBe("+3V3");
    expect(doc.nets.get("GND")!.pads).toContain("pad:usb/connector:S~3");
    expect(doc.nets.get("GND")!.missing).toEqual([]);
    expect(netClassOf(doc, "USB_DP")).toBe("usb");
    expect(netClassOf(doc, "EN")).toBe("default");
  });
});

describe("ids and findings", () => {
  it("makes deterministic keys", () => {
    const a = deterministicKey("trk", { net: "GND", layer: "top", start: [0, 0], end: [1, 0] });
    expect(a).toMatch(/^trk:g\.[0-9a-f]{12}$/);
    expect(deterministicKey("trk", { end: [1, 0], start: [0, 0], layer: "top", net: "GND" })).toBe(a);
  });
  it("runs checks, validates findings and sorts them", () => {
    const svc = openBoardService({ document: airnodeC3() });
    const check: Check = {
      id: "spare-copper",
      title: "copper without a net",
      run: (snap) =>
        [...snap.doc.records.values()]
          .filter((r) => r.kind === "track" && !r.net)
          .map((r) => ({ id: findingId("spare-copper", undefined, [r.id], { x: 0, y: 0 }), check: "spare-copper", severity: "warning" as const, objects: [r.id], location: { x: 0, y: 0, layer: "bottom" }, message: "copper with no net" })),
    };
    const f = runChecks(svc.snapshot(), [check, check]);
    expect(f).toHaveLength(1);
    expect(FindingSchema.parse(f[0]).objects).toEqual(["trk:f.spare.1"]);
    expect(() => runChecks(svc.snapshot(), [{ ...check, run: () => [{ ...f[0], severity: "fatal" as never }] }])).toThrow(/malformed/);
    svc.close();
  });
});

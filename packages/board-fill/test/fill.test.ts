/** Hand-built boards for every fill feature, with known answers, each also proven by verifyFill. */
import { describe, expect, it } from "vitest";
import { createDocument, mm, recordsOfKind, type BoardDocument, type BoardRecord, type CopperLayer, type DerivedZoneFill, type KeepoutRec, type Netlist } from "@protoboardai/board";
import { fillZones, pointInPolygon, polygonsArea, verifyFill, type FillZonesResult, type Polygon } from "../src/index.js";
import { board, footprint, GEN, rect, rule, smd, track, via, zone } from "./helpers.js";

const M = 10; // default margin, nm
const MM2 = 1e12;
const err = 5000; // default curve error, nm

const polys = (r: FillZonesResult, z = "zone:z", layer: CopperLayer = "top"): Polygon[] => (r.fill.fills.find((f) => f.zone === z && f.layer === layer)?.polygons ?? []) as Polygon[];
const area = (r: FillZonesResult, z = "zone:z", layer: CopperLayer = "top") => polygonsArea(polys(r, z, layer)) / MM2;
const copperAt = (r: FillZonesResult, x: number, y: number, z = "zone:z", layer: CopperLayer = "top") => polys(r, z, layer).some((p) => pointInPolygon(p, mm(x), mm(y)));
const verified = (doc: BoardDocument, r: FillZonesResult) => {
  const v = verifyFill(doc, r.fill);
  expect(v.violations).toEqual([]);
  return v;
};
/** The 20 x 20 mm board's interior: inset by the 0.3 mm edge clearance and the margin. */
const BASE = (20 - 2 * (0.3 + M / 1e6)) ** 2;
const big = zone("z", "GND", ["top"], rect(30, 30));
const nets = (list: Record<string, string[]>): Netlist => ({ source: "fixture", nets: Object.entries(list).map(([name, pins]) => ({ name, pins })) });
/** Area of a disc approximated from outside: between the exact disc and one grown by the curve error. */
const discBounds = (rMm: number): [number, number] => [Math.PI * rMm ** 2 - 1e-6, Math.PI * (rMm + err / 1e6) ** 2 + 1e-6];

describe("fill: the board and its edge", () => {
  it("fills the board inside the edge clearance exactly when nothing is in the way", () => {
    const doc = board([big, via("g", "GND", 0, 0)]);
    const r = fillZones(doc);
    expect(area(r)).toBeCloseTo(BASE, 9);
    expect(polys(r)).toHaveLength(1);
    verified(doc, r);
  });
  it("keeps the zone inside its own outline", () => {
    const doc = board([zone("z", "GND", ["top"], rect(8, 6, 2, 1)), via("g", "GND", 2, 1)]);
    const r = fillZones(doc);
    expect(area(r)).toBeCloseTo(48, 9);
    verified(doc, r);
  });
  it("removes a cutout with the edge clearance around it", () => {
    const doc = board([big, via("g", "GND", 5, 5), { kind: "cutout", id: "cutout:c", outline: rect(2, 2), provenance: GEN }]);
    const r = fillZones(doc);
    const e = 0.3 + M / 1e6;
    const hole = 4 + 8 * e + Math.PI * e * e;
    expect(BASE - area(r)).toBeGreaterThan(hole - 1e-6);
    expect(BASE - area(r)).toBeLessThan(hole + 2 * Math.PI * e * (err / 1e6) + 1e-4);
    expect(copperAt(r, 0, 0)).toBe(false);
    verified(doc, r);
  });
});

describe("fill: copper of other nets", () => {
  it("clears a via of another net by the clearance (a disc approximated from outside)", () => {
    const doc = board([big, via("g", "GND", 5, 5), via("s", "SIG", 0, 0)]);
    const r = fillZones(doc);
    const [lo, hi] = discBounds(0.3 + 0.2 + M / 1e6);
    expect(BASE - area(r)).toBeGreaterThanOrEqual(lo);
    expect(BASE - area(r)).toBeLessThanOrEqual(hi);
    verified(doc, r);
  });
  it("leaves a via of its own net in the fill", () => {
    const doc = board([big, via("g", "GND", 0, 0)]);
    expect(area(fillZones(doc))).toBeCloseTo(BASE, 9);
  });
  it("clears a track as a stadium and an arc track as a band", () => {
    const doc = board([big, via("g", "GND", 5, 5), track("t", "SIG", "top", 0.25, -5, 0, 5, 0)]);
    const r = fillZones(doc);
    const R = 0.125 + 0.2 + M / 1e6;
    const exact = 10 * 2 * R + Math.PI * R * R;
    expect(BASE - area(r)).toBeGreaterThanOrEqual(exact - 1e-6);
    expect(BASE - area(r)).toBeLessThan(exact + 2 * Math.PI * R * (err / 1e6) + 1e-5);
    verified(doc, r);
    const arc = board([big, via("g", "GND", 5, 5), track("a", "SIG", "top", 0.25, -3, 0, 3, 0, -90_000)]);
    const ra = fillZones(arc);
    verified(arc, ra);
    // a clockwise quarter arc over a 6 mm chord: radius 4.243 about (0, -3), its middle at (0, 1.243)
    expect(copperAt(ra, 0, 1.243)).toBe(false);
    expect(copperAt(ra, 0, 1.243 + 0.125 + 0.21)).toBe(true);
    expect(copperAt(ra, 0, -1.243)).toBe(true);
  });
  it("clears rotated and rounded pads by their true shape", () => {
    const fp = footprint("U1", 0, 0, [smd("1", 0, 0, 2, 1, { rotation: 30_000 }), smd("2", 4, 0, 2, 1, { shape: "roundrect", corner_radius: mm(0.25) }), smd("3", -4, 0, 1.5, 0.6, { shape: "oval" })], { rotation: 15_000 });
    const doc = board([big, via("g", "GND", 6, 6), fp], { netlist: nets({ A: ["U1.1"], B: ["U1.2"], C: ["U1.3"] }) });
    const r = fillZones(doc);
    const c = 0.2 + M / 1e6;
    const rectHole = 2 * 1 + 2 * c * (2 + 1) + Math.PI * c * c;
    const rr = 0.25 + c;
    const roundHole = (2 - 0.5) * (1 - 0.5) + 2 * rr * (1.5 + 0.5) + Math.PI * rr * rr;
    const ro = 0.3 + c;
    const ovalHole = 2 * ro * 0.9 + Math.PI * ro * ro;
    const exact = rectHole + roundHole + ovalHole;
    expect(BASE - area(r)).toBeGreaterThanOrEqual(exact - 1e-6);
    expect(BASE - area(r)).toBeLessThan(exact + 3 * 2 * Math.PI * 1 * (err / 1e6));
    verified(doc, r);
  });
  it("mirrors pads of a footprint on the bottom side", () => {
    const fp = footprint("U1", 0, 0, [smd("1", 2, 0, 1, 1)], { side: "bottom" });
    const doc = board([zone("zb", "GND", ["bottom"], rect(30, 30)), zone("zt", "GND", ["top"], rect(30, 30)), via("g", "GND", 6, 6), fp], { netlist: nets({ A: ["U1.1"] }) });
    const r = fillZones(doc);
    expect(copperAt(r, -2, 0, "zone:zb", "bottom")).toBe(false);
    expect(copperAt(r, 2, 0, "zone:zb", "bottom")).toBe(true);
    expect(copperAt(r, -2, 0, "zone:zt", "top")).toBe(true);
    verified(doc, r);
  });
  it("honors the zone's clearance when larger than the rule, and the rule when larger", () => {
    const doc = board([zone("z", "GND", ["top"], rect(30, 30), { clearance: mm(0.4) }), via("g", "GND", 5, 5), via("s", "SIG", 0, 0)]);
    const [lo, hi] = discBounds(0.3 + 0.4 + M / 1e6);
    const r = fillZones(doc);
    expect(BASE - area(r)).toBeGreaterThanOrEqual(lo);
    expect(BASE - area(r)).toBeLessThanOrEqual(hi);
    const ruled = board([zone("z", "GND", ["top"], rect(30, 30), { clearance: mm(0.1) }), via("g", "GND", 5, 5), via("s", "SIG", 0, 0)]);
    const [lo2, hi2] = discBounds(0.3 + 0.2 + M / 1e6);
    const r2 = fillZones(ruled);
    expect(BASE - area(r2)).toBeGreaterThanOrEqual(lo2);
    expect(BASE - area(r2)).toBeLessThanOrEqual(hi2);
  });
  it("uses the most specific target rule and never goes below the floor", () => {
    const recs: BoardRecord[] = [big, via("g", "GND", 5, 5), via("s", "SIG", 0, 0), { kind: "netclass", id: "class:power", name: "power", nets: ["GND"] }, rule("power", "target", "clearance", mm(0.35), { classes: ["power"] })];
    const r = fillZones(board(recs));
    const [lo, hi] = discBounds(0.3 + 0.35 + M / 1e6);
    expect(BASE - area(r)).toBeGreaterThanOrEqual(lo);
    expect(BASE - area(r)).toBeLessThanOrEqual(hi);
    const floor = fillZones(board([...recs, rule("fab", "floor", "clearance", mm(0.45))]));
    const [lo2, hi2] = discBounds(0.3 + 0.45 + M / 1e6);
    expect(BASE - area(floor)).toBeGreaterThanOrEqual(lo2);
    expect(BASE - area(floor)).toBeLessThanOrEqual(hi2);
  });
  it("keeps the hole clearance from a non-plated hole", () => {
    const fp = footprint("H1", 0, 0, [{ number: "", type: "np", shape: "circle", x: 0, y: 0, hole_diameter: mm(1) }]);
    const doc = board([big, via("g", "GND", 5, 5), fp, rule("hole", "floor", "hole_clearance", mm(0.3))]);
    const r = fillZones(doc);
    const [lo, hi] = discBounds(0.5 + 0.3 + M / 1e6);
    expect(BASE - area(r)).toBeGreaterThanOrEqual(lo);
    expect(BASE - area(r)).toBeLessThanOrEqual(hi);
    verified(doc, r);
  });
  it("clears a via only on the layers it passes through", () => {
    const copper: CopperLayer[] = ["top", "inner1", "inner2", "bottom"];
    const zs = copper.map((l) => zone(`z${l}`, "GND", [l], rect(30, 30)));
    const doc = board([...zs, via("g", "GND", 5, 5), via("b", "SIG", 0, 0, 0.6, 0.3, "top", "inner1")], { copper });
    const r = fillZones(doc);
    expect(copperAt(r, 0, 0, "zone:ztop", "top")).toBe(false);
    expect(copperAt(r, 0, 0, "zone:zinner1", "inner1")).toBe(false);
    expect(copperAt(r, 0, 0, "zone:zinner2", "inner2")).toBe(true);
    expect(copperAt(r, 0, 0, "zone:zbottom", "bottom")).toBe(true);
    verified(doc, r);
  });
});

describe("fill: pads of the zone's net", () => {
  const pad = (x = 0, y = 0) => footprint("U1", x, y, [smd("1", 0, 0, 1, 1)]);
  const nl = nets({ GND: ["U1.1"] });
  it("connects with four thermal spokes, clipped where something is in the way", () => {
    const z = zone("z", "GND", ["top"], rect(30, 30), { thermal_gap: mm(0.3), thermal_spoke_width: mm(0.4) });
    const doc = board([z, pad()], { netlist: nl });
    const r = fillZones(doc);
    expect(r.stats["zone:z@top"].spokes).toBe(4);
    expect(copperAt(r, 0, 0)).toBe(true); // the spokes reach the pad center
    expect(copperAt(r, 0.6, 0.6)).toBe(false); // the relief gap at a corner
    verified(doc, r);
    const blocked = board([z, pad(), via("s", "SIG", 1.2, 0)], { netlist: nl });
    const rb = fillZones(blocked);
    expect(rb.stats["zone:z@top"].spokes).toBe(3);
    verified(blocked, rb);
  });
  it("drops a spoke that would not reach copper (a pad at the board edge)", () => {
    const z = zone("z", "GND", ["top"], rect(30, 30), { thermal_gap: mm(0.3), thermal_spoke_width: mm(0.4) });
    const doc = board([z, pad(9.2, 0)], { netlist: nl });
    const r = fillZones(doc);
    expect(r.stats["zone:z@top"].spokes).toBe(3);
    verified(doc, r);
  });
  it("covers a solid pad and clears a pad connected 'none'", () => {
    const solid = board([zone("z", "GND", ["top"], rect(30, 30), { pad_connection: "solid" }), pad()], { netlist: nl });
    expect(area(fillZones(solid))).toBeCloseTo(BASE, 9);
    const none = board([zone("z", "GND", ["top"], rect(30, 30), { pad_connection: "none" }), pad(), via("g", "GND", 5, 5)], { netlist: nl });
    const r = fillZones(none);
    const c = 0.2 + M / 1e6;
    const exact = 1 + 4 * c + Math.PI * c * c;
    expect(BASE - area(r)).toBeGreaterThanOrEqual(exact - 1e-6);
    expect(BASE - area(r)).toBeLessThan(exact + 2 * Math.PI * c * (err / 1e6) + 1e-6);
    verified(none, r);
  });
});

describe("fill: islands", () => {
  // a closed square of signal track walls off an area of the pour
  const wall = [track("w1", "SIG", "top", 0.3, -3, -3, 3, -3), track("w2", "SIG", "top", 0.3, 3, -3, 3, 3), track("w3", "SIG", "top", 0.3, 3, 3, -3, 3), track("w4", "SIG", "top", 0.3, -3, 3, -3, -3)];
  const z = (extra = {}) => zone("z", "GND", ["top"], rect(30, 30), extra);
  it("removes a piece that touches nothing of its net", () => {
    const doc = board([z(), ...wall, via("g", "GND", 6, 6)]);
    const r = fillZones(doc);
    expect(polys(r)).toHaveLength(1);
    expect(copperAt(r, 0, 0)).toBe(false);
    expect(r.stats["zone:z@top"].islandsRemoved).toBe(1);
    verified(doc, r);
  });
  it("keeps a piece connected by a via of its net, and keeps islands when told to", () => {
    expect(polys(fillZones(board([z(), ...wall, via("g", "GND", 6, 6), via("i", "GND", 0, 0)])))).toHaveLength(2);
    const never = board([z({ remove_islands: "never" }), ...wall, via("g", "GND", 6, 6)]);
    expect(polys(fillZones(never))).toHaveLength(2);
    verified(never, fillZones(never));
  });
  it("removes islands below an area and keeps larger ones", () => {
    const inner = (6 - 0.3 - 0.4) ** 2; // about 28 mm2
    const small = board([z({ remove_islands: "below_area", island_min_area: Math.round((inner + 5) * MM2) }), ...wall, via("g", "GND", 6, 6)]);
    expect(polys(fillZones(small))).toHaveLength(1);
    const large = board([z({ remove_islands: "below_area", island_min_area: Math.round((inner - 5) * MM2) }), ...wall, via("g", "GND", 6, 6)]);
    expect(polys(fillZones(large))).toHaveLength(2);
  });
  it("keeps every piece of a zone without a net", () => {
    expect(polys(fillZones(board([zone("z", undefined, ["top"], rect(30, 30)), ...wall])))).toHaveLength(2);
  });
});

describe("fill: zone priority", () => {
  const a = zone("a", "A", ["top"], rect(10, 20, -5, 0), { priority: 1 });
  const b = zone("b", "B", ["top"], rect(30, 30), { priority: 0 });
  const vias = [via("va", "A", -5, 0), via("vb", "B", 5, 0)];
  it("fills higher priority first; the lower zone keeps the zone clearance from that fill", () => {
    const doc = board([a, b, ...vias]);
    const r = fillZones(doc);
    expect(copperAt(r, -5, 0.5, "zone:a")).toBe(true);
    expect(copperAt(r, -5, 0.5, "zone:b")).toBe(false);
    expect(copperAt(r, 0.1, 0, "zone:b")).toBe(false); // within 0.2 of zone a's edge at x = 0
    expect(copperAt(r, 0.25, 0, "zone:b")).toBe(true);
    verified(doc, r);
    const swapped = board([{ ...a, priority: 0 }, { ...b, priority: 1 }, ...vias]);
    const rs = fillZones(swapped);
    // zone b now takes the whole board; zone a keeps only the disc over its own via, inside b's relief around it
    expect(area(rs, "zone:a")).toBeLessThan(Math.PI * (0.3 + err / 1e6) ** 2);
    expect(copperAt(rs, -5, 0, "zone:a")).toBe(true);
    expect(copperAt(rs, -5, 0.5, "zone:a")).toBe(false);
    verified(swapped, rs);
  });
  it("orders equal priorities by id, deterministically", () => {
    const doc = board([{ ...a, priority: 0 }, b, ...vias]);
    const r = fillZones(doc);
    expect(copperAt(r, -5, 0.5, "zone:a")).toBe(true);
    expect(copperAt(r, -5, 0.5, "zone:b")).toBe(false);
    expect(JSON.stringify(fillZones(doc).fill)).toBe(JSON.stringify(r.fill));
  });
  it("lets zones of the same net overlap", () => {
    const doc = board([zone("a", "GND", ["top"], rect(10, 20, -5, 0), { priority: 1 }), zone("b", "GND", ["top"], rect(30, 30)), via("g", "GND", 0, 0)]);
    const r = fillZones(doc);
    expect(area(r, "zone:b")).toBeCloseTo(BASE, 9);
    verified(doc, r);
  });
});

describe("fill: keep-outs", () => {
  const ko = (blocks: KeepoutRec["blocks"], layers: CopperLayer[] = ["top"]): KeepoutRec => ({ kind: "keepout", id: "kpo:k", outline: rect(4, 4), layers, blocks, tier: "no_go", provenance: GEN });
  it("removes the area of a keep-out that blocks pours, on its layers only", () => {
    const doc = board([zone("t", "GND", ["top"], rect(30, 30)), zone("b", "GND", ["bottom"], rect(30, 30)), via("g", "GND", 6, 6), ko({ tracks: false, vias: false, pours: true, footprints: false })]);
    const r = fillZones(doc);
    expect(BASE - area(r, "zone:t")).toBeGreaterThan(16);
    expect(BASE - area(r, "zone:t")).toBeLessThan(16 + 1e-3);
    expect(area(r, "zone:b", "bottom")).toBeCloseTo(BASE, 9);
    verified(doc, r);
  });
  it("ignores a keep-out that does not block pours", () => {
    const doc = board([big, via("g", "GND", 6, 6), ko({ tracks: true, vias: true, pours: false, footprints: false })]);
    expect(area(fillZones(doc))).toBeCloseTo(BASE, 9);
  });
});

describe("fill: minimum width", () => {
  // two vias of another net: their clearance rings leave a neck of copper between them
  const neck = (gapMm: number) => {
    const d = 0.6 + 2 * 0.2 + gapMm; // center distance for a neck of gapMm between clearance rings
    return [via("s1", "SIG", -d / 2, 0), via("s2", "SIG", d / 2, 0), via("g", "GND", 6, 6)];
  };
  const z = zone("z", "GND", ["top"], rect(30, 30), { min_width: mm(0.2) });
  it("removes a neck narrower than the minimum width", () => {
    const doc = board([z, ...neck(0.15)]);
    const r = fillZones(doc);
    expect(copperAt(r, 0, 0)).toBe(false);
    verified(doc, r);
  });
  it("keeps a neck at least the minimum width", () => {
    const doc = board([z, ...neck(0.25)]);
    const r = fillZones(doc);
    expect(copperAt(r, 0, 0)).toBe(true);
    verified(doc, r);
  });
  it("rounds the zone's corners and keeps every piece at least the width", () => {
    const doc = board([zone("z", "GND", ["top"], rect(8, 8), { min_width: mm(0.5) }), via("g", "GND", 0, 0), track("t", "SIG", "top", 0.2, -3, -3.7, 3, -3.7)]);
    const r = fillZones(doc);
    expect(copperAt(r, -3.98, -3.98)).toBe(false); // a sharp corner would be copper
    expect(copperAt(r, 0, -3.95)).toBe(false); // the sliver between the track and the zone edge is gone
    verified(doc, r);
  });
});

describe("fill: hatch", () => {
  it("cuts square openings and keeps a solid border of the hatch width", () => {
    const z = zone("z", "GND", ["top"], rect(30, 30), { fill_mode: "hatch", hatch_width: mm(0.5), hatch_gap: mm(1), min_width: mm(0.25) });
    const doc = board([z, via("g", "GND", 0.25, 0.25)]);
    const r = fillZones(doc);
    expect(area(r)).toBeLessThan(BASE * 0.7);
    expect(area(r)).toBeGreaterThan(BASE * 0.4);
    expect(copperAt(r, -9.5, 2.75)).toBe(true); // the border along the edge
    expect(copperAt(r, 1, 1)).toBe(false); // an opening (pitch 1.5 from the origin: 0.25 to 1.25)
    expect(copperAt(r, 0, 1)).toBe(true); // a hatch line
    verified(doc, r);
  });
});

describe("verifyFill: catches what is wrong", () => {
  const doc = board([zone("z", "GND", ["top"], rect(16, 16), { min_width: mm(0.2) }), via("g", "GND", 5, 5), via("s", "SIG", 0, 0), { kind: "keepout", id: "kpo:k", outline: rect(2, 2, -5, -5), layers: ["top"], blocks: { tracks: false, vias: false, pours: true, footprints: false }, tier: "no_go", provenance: GEN }, zone("o", "OTHER", ["top"], rect(2, 2, 5, -5), { priority: 1 })]);
  const sq = (cx: number, cy: number, s: number) => [mm(cx - s / 2), mm(cy - s / 2), mm(cx + s / 2), mm(cy - s / 2), mm(cx + s / 2), mm(cy + s / 2), mm(cx - s / 2), mm(cy + s / 2)];
  const fill = (rings: number[][], zoneId = "zone:z"): DerivedZoneFill => ({ schema: "protoboard.zone-fill/v1", source: "computed", inputHash: "0".repeat(64), units: { length: "nm" }, fills: [{ zone: zoneId, source: "test", net: "GND", layer: "top", polygons: rings.map((outer) => ({ outer, holes: [] })) }] });
  const kinds = (f: DerivedZoneFill) => [...new Set(verifyFill(doc, f).violations.map((v) => v.kind))].sort();
  it("copper over another net's via", () => expect(kinds(fill([sq(5, 5, 2), sq(0.6, 0, 0.6)]))).toContain("clearance"));
  it("copper past the board edge", () => expect(kinds(fill([sq(5, 5, 2), sq(9.95, 5, 1)]))).toEqual(expect.arrayContaining(["edge_clearance", "outside_zone"])));
  it("an island", () => expect(kinds(fill([sq(5, 5, 2), sq(-3, 3, 1)]))).toEqual(["island"]));
  it("copper in a keep-out", () => expect(kinds(fill([sq(5, 5, 2), sq(-5, -5, 1)]))).toContain("keepout"));
  it("a sliver narrower than the minimum width", () => expect(kinds(fill([sq(5, 5, 2), [mm(4), mm(2), mm(6), mm(2), mm(6), mm(2.05), mm(4), mm(2.05)]]))).toContain("min_width"));
  it("copper too close to another zone's fill", () => {
    const f = fill([sq(5, 5, 2), sq(5, -3.9, 0.15)]);
    f.fills.push({ zone: "zone:o", source: "test", net: "OTHER", layer: "top", polygons: [{ outer: sq(5, -5, 2), holes: [] }] });
    expect(kinds(f)).toContain("zone_clearance");
  });
  it("and passes a clean fill", () => expect(kinds(fill([sq(5, 5, 2)]))).toEqual([]));
});

describe("fill: documents without a netlist or with an empty one", () => {
  it("fills a zone on a board created without rules (defaults apply)", () => {
    const doc = createDocument([...recordsOfKind(board([]), "board"), ...recordsOfKind(board([]), "layer"), ...recordsOfKind(board([]), "outline"), big, via("g", "GND", 0, 0)]);
    const r = fillZones(doc);
    // default edge clearance 0.3 mm
    expect(area(r)).toBeCloseTo(BASE, 9);
  });
});

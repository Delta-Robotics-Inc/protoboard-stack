/** Connectivity on small hand-built boards with known answers. */
import { describe, expect, it } from "vitest";
import { mm } from "@protoboardai/board";
import { runBoardChecks, type ZoneFill } from "../src/index.js";
import { boardRecords, fp, makeDoc, rectV, rule, smd, th, trk, via, zone } from "./helpers.js";

/** Two footprints A (0, 0) and B (0, 5), each with pads 1 at x = -2 and 2 at x = +2 (0.8 mm squares). */
const pads = () => [fp("A", 0, 0, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)]), fp("B", 0, 5, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)])];
const NETS = { N1: ["A.1", "B.1"], N2: ["A.2", "B.2"] };

describe("connectivity", () => {
  it("a missing connection is one link, pad to pad, with locations", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), rule("clr", "floor", "clearance", 0.1)], NETS));
    expect(r.connectivity.unconnected).toBe(2);
    const l = r.connectivity.links.find((x) => x.net === "N1")!;
    expect([l.from.object, l.to.object].sort()).toEqual(["pad:A:1", "pad:B:1"]);
    expect(l.length).toBe(mm(5));
    expect({ x: l.from.x, y: Math.min(l.from.y, l.to.y) }).toEqual({ x: mm(-2), y: 0 });
    const f = r.findings.filter((x) => x.check === "unconnected");
    expect(f).toHaveLength(2);
    expect(f[0].severity).toBe("error");
    expect(r.summary.line).toBe("2 unconnected, 0 errors, 0 warnings");
  });

  it("a track joins two pads", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("t1", "N1", "top", 0.25, [-2, 0], [-2, 5])], NETS));
    expect(r.connectivity.links.map((l) => l.net)).toEqual(["N2"]);
    expect(r.connectivity.dangling).toEqual([]);
  });

  it("vias join layers they span, and only those", () => {
    const route = (blind: boolean) => [
      trk("a", "N1", "top", 0.25, [-2, 0], [-2, 2]),
      via("v1", "N1", -2, 2, 0.6, 0.3, "top", blind ? "inner1" : "bottom"),
      trk("b", "N1", "bottom", 0.25, [-2, 2], [-2, 4]),
      via("v2", "N1", -2, 4, 0.6, 0.3, "top", "bottom"),
      trk("c", "N1", "top", 0.25, [-2, 4], [-2, 5]),
    ];
    const ok = runBoardChecks(makeDoc([...boardRecords({ layers: 4 }), ...pads(), ...route(false)], NETS));
    expect(ok.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
    const blind = runBoardChecks(makeDoc([...boardRecords({ layers: 4 }), ...pads(), ...route(true)], NETS));
    expect(blind.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(1);
    // the blind via reaches inner1 only: the bottom track's end at it touches nothing
    expect(blind.connectivity.dangling.map((d) => d.object)).toContain("trk:b");
  });

  it("a plated through-hole pad joins top and bottom", () => {
    const recs = [...boardRecords(), fp("J", 0, 0, [th("1", 0, 0, 1.6, 0.8)]), fp("K", 5, 0, [smd("1", 0, 0, 1, 1)]), trk("t", "S", "bottom", 0.3, [0, 0], [5, -2]), via("v", "S", 5, -2), trk("u", "S", "top", 0.3, [5, -2], [5, 0])];
    const r = runBoardChecks(makeDoc(recs, { S: ["J.1", "K.1"] }));
    expect(r.connectivity.unconnected).toBe(0);
  });

  it("copper of two nets touching is a short", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("x", "N1", "top", 0.25, [-2, 0], [2, 0])], NETS));
    expect(r.connectivity.shorts).toHaveLength(1);
    expect(r.connectivity.shorts[0]).toMatchObject({ nets: ["N1", "N2"], objects: ["pad:A:2", "trk:x"], layer: "top" });
    const f = r.findings.find((x) => x.check === "short")!;
    expect(f.severity).toBe("error");
    expect(f.message).toContain("joining nets N1 and N2");
    expect(r.summary.errors).toBe(1);
  });

  it("copper without a net bridging two nets: a short through unassigned copper, and both contacts", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("nn", undefined, "top", 0.25, [-2, 0], [2, 0])], NETS));
    expect(r.connectivity.shorts).toEqual([expect.objectContaining({ nets: ["N1", "N2"], bridged: true, objects: ["trk:nn"] })]);
    expect(r.connectivity.unassigned.map((u) => `${u.object}>${u.net}`)).toEqual(["trk:nn>N1", "trk:nn>N2"]);
    // unassigned copper never joins islands
    expect(r.connectivity.unconnected).toBe(2);
  });

  it("dangling track ends and a via connected on one layer", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("d", "N1", "top", 0.25, [-2, 0], [-2, 2]), via("v", "N1", -2, 2)], NETS));
    expect(r.connectivity.dangling).toEqual([expect.objectContaining({ object: "via:v", kind: "via", connectedLayers: 1 })]);
    const r2 = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("d", "N1", "top", 0.25, [-2, 0], [-2, 2])], NETS));
    expect(r2.connectivity.dangling).toEqual([expect.objectContaining({ object: "trk:d", kind: "track", x: mm(-2), y: mm(2) })]);
    expect(r2.findings.filter((f) => f.check === "dangling")).toHaveLength(1);
  });

  it("the ratsnest is a minimum spanning tree", () => {
    const line = fp("L", 0, 0, [smd("1", 0, 0, 0.5, 0.5), smd("2", 1, 0, 0.5, 0.5), smd("3", 2, 0, 0.5, 0.5), smd("4", 10, 0, 0.5, 0.5)]);
    const r = runBoardChecks(makeDoc([...boardRecords({ w: 30 }), line], { N: ["L.1", "L.2", "L.3", "L.4"] }));
    expect(r.connectivity.links.map((l) => l.length).sort((a, b) => a - b)).toEqual([mm(1), mm(1), mm(8)]);
    const long = r.connectivity.links.find((l) => l.length === mm(8))!;
    expect([long.from.object, long.to.object].sort()).toEqual(["pad:L:3", "pad:L:4"]);
  });

  it("reports netlist pins with no pad", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads()], { ...NETS, N3: ["A.9", "C.1"] }));
    expect(r.connectivity.missingPins).toEqual(["A.9", "C.1"]);
  });
});

describe("zone fill", () => {
  const recs = () => [...boardRecords(), ...pads(), zone("z", "N1", ["top"], rectV(3, 8, -2, 2.5)), rule("clr", "floor", "clearance", 0.1)];
  const fillRect = (holes: { x: number; y: number }[][] = []): ZoneFill => ({ zone: "zone:z", layer: "top", polygons: [{ outline: rectV(1.2, 6, -2, 2.5), holes }] });

  it("without fill a zone connects nothing, and the result says so", () => {
    const r = runBoardChecks(makeDoc(recs(), NETS));
    expect(r.connectivity.zoneFill).toBe("absent");
    expect(r.connectivity.zonesWithoutFill).toEqual(["zone:z"]);
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(1);
    expect(r.summary.incomplete).toBe(true);
    expect(r.summary.line).toMatch(/incomplete/);
    expect(r.summary.caveats.join(" ")).toMatch(/1 zone without fill/);
  });

  it("with fill the zone joins the pads", () => {
    const r = runBoardChecks(makeDoc(recs(), NETS), { fills: [fillRect()] });
    expect(r.connectivity.zoneFill).toBe("provided");
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
    expect(r.summary.incomplete).toBe(false);
  });

  it("a hole in the fill around a pad leaves it unconnected", () => {
    const r = runBoardChecks(makeDoc(recs(), NETS), { fills: [fillRect([rectV(1, 1.2, -2, 5)])] });
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(1);
  });

  it("a fill polygon touching nothing of its net is isolated copper", () => {
    const fill: ZoneFill = { zone: "zone:z", layer: "top", polygons: [{ outline: rectV(1.2, 6, -2, 2.5) }, { outline: rectV(1, 1, -6, -6) }] };
    const r = runBoardChecks(makeDoc(recs(), NETS), { fills: [fill] });
    expect(r.connectivity.isolated).toHaveLength(1);
    expect(r.findings.filter((f) => f.check === "isolated_copper")).toHaveLength(1);
  });

  it("accepts the record form keyed by zone then layer, and points as arrays", () => {
    const r = runBoardChecks(makeDoc(recs(), NETS), { fills: { "zone:z": { top: [[rectV(1.2, 6, -2, 2.5)]] } } });
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
  });

  it("a track end inside an unfilled zone of its net is not called dangling", () => {
    const r = runBoardChecks(makeDoc([...recs(), trk("t", "N1", "top", 0.25, [-2, 0], [-2, 2])], NETS));
    expect(r.connectivity.dangling).toEqual([]);
    expect(r.connectivity.undecided).toBe(1);
  });

  it("is deterministic and keyed by its input", () => {
    const a = runBoardChecks(makeDoc(recs(), NETS), { fills: [fillRect()] });
    const b = runBoardChecks(makeDoc(recs(), NETS), { fills: [fillRect()] });
    expect(b.findings).toEqual(a.findings);
    expect(b.inputHash).toBe(a.inputHash);
    const c = runBoardChecks(makeDoc(recs(), NETS));
    expect(c.inputHash).not.toBe(a.inputHash);
  });
});



describe("join rules", () => {
  // pad A.1 at (-2, 0), 0.8 mm square; B.1 at (-2, 5)
  const route = (t: ReturnType<typeof trk>) => runBoardChecks(makeDoc([...boardRecords(), ...pads(), t, trk("main", "N1", "top", 0.25, [-2, 5], [-2, 1.5])], NETS));
  it("a track joins a pad by its end cap", () => {
    // ends 0.5 mm from the pad center: the end point is outside the pad, the 0.25 mm wide end cap reaches it
    expect(route(trk("t", "N1", "top", 0.25, [-2, 1.5], [-2, 0.5])).connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
  });
  it("a track grazing a pad along its length does not join it, by default; overlap joins it", () => {
    // runs past the pad's edge without ending in it or passing its center
    const graze = trk("t", "N1", "top", 0.25, [-1.5, 1.5], [-1.5, -1.5]);
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), graze, trk("main", "N1", "top", 0.25, [-2, 5], [-1.5, 1.5])], NETS));
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(1);
    expect(r.connectivity.touchingNotJoined).toBe(1);
    const o = runBoardChecks(makeDoc([...boardRecords(), ...pads(), graze, trk("main", "N1", "top", 0.25, [-2, 5], [-1.5, 1.5])], NETS), { join: "overlap" });
    expect(o.connectivity.join).toBe("overlap");
    expect(o.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
  });
  it("a track through a pad's center joins it", () => {
    expect(route(trk("t", "N1", "top", 0.25, [-2, 1.5], [-2, -1.5])).connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
  });
  it("copper without a net carries the one net it joins, and is still reported", () => {
    const r = runBoardChecks(makeDoc([...boardRecords(), ...pads(), trk("nn", undefined, "top", 0.25, [-2, 0], [-2, 5])], NETS));
    expect(r.connectivity.carried).toEqual({ "trk:nn": "N1" });
    expect(r.connectivity.nets.find((n) => n.net === "N1")!.missing).toBe(0);
    expect(r.connectivity.unassigned.map((u) => u.net)).toEqual(["N1"]);
  });
});

/** Relations on small hand-built boards with known answers: neighbors, crossings, corridors, connectivity, congestion. */
import { describe, expect, it } from "vitest";
import { buildModel, congestion, copperNear, estimateConnectivity, findCorridor, nearestByDirection, ratCrossings } from "../src/index.js";
import { board, chip, track, via } from "./boards.js";

describe("neighbors by direction", () => {
  // R1 at the origin; R3 3 mm left, R2 5 mm right, C1 4 mm up; courtyards 1.6 x 0.9
  const doc = board([30, 20], [chip("R1", 0, 0), chip("R2", 5, 0), chip("R3", -3, 0), chip("C1", 0, 4), chip("C2", 1, -6)]);
  const m = buildModel(doc);
  const r1 = m.fpById.get("fp:R1")!;
  it("finds the nearest part in each direction with edge-to-edge gaps", () => {
    const n = nearestByDirection(m, r1);
    expect(n.left?.ref).toBe("R3");
    expect(n.left?.gap).toBeCloseTo(3 - 1.6, 6);
    expect(n.right?.ref).toBe("R2");
    expect(n.right?.gap).toBeCloseTo(5 - 1.6, 6);
    expect(n.up?.ref).toBe("C1");
    expect(n.up?.gap).toBeCloseTo(4 - 0.9, 6);
    // C2 is 1 mm right and 6 mm down: down, and the gap is the vertical one (boxes overlap in x)
    expect(n.down?.ref).toBe("C2");
    expect(n.down?.gap).toBeCloseTo(6 - 0.9, 6);
  });
  it("is symmetric", () => {
    expect(nearestByDirection(m, m.fpById.get("fp:R3")!).right?.ref).toBe("R1");
    expect(nearestByDirection(m, m.fpById.get("fp:C1")!).down?.ref).toBe("R1");
  });
});

describe("copper near a part", () => {
  const doc = board(
    [30, 20],
    [chip("R1", 0, 0), track("under", "B", "bottom", 0.2, [-3, 0], [3, 0]), track("through", "C", "top", 0.2, [0, -3], [0, 3]), track("beside", "D", "top", 0.2, [-3, 0.95], [3, 0.95]), track("far", "E", "top", 0.2, [-3, 5], [3, 5])],
    { source: "fixture", nets: [{ name: "A", pins: ["R1.1", "R1.2"] }, { name: "B", pins: [] }, { name: "C", pins: [] }, { name: "D", pins: [] }, { name: "E", pins: [] }] },
  );
  it("separates under, through and beside, with gaps", () => {
    const m = buildModel(doc);
    const near = copperNear(m, m.fpById.get("fp:R1")!, 1.0);
    expect(near.map((c) => [c.rel, c.net, c.layer])).toEqual([
      ["under", "B", "bottom"],
      ["through", "C", "top"],
      ["beside", "D", "top"],
    ]);
    // the courtyard's top edge is at 0.45; the track's copper edge at 0.95 - 0.1
    expect(near[2].gap).toBeCloseTo(0.4, 6);
  });
});

describe("connectivity and ratsnest crossings", () => {
  const netlist = { source: "fixture", nets: [{ name: "SIG", pins: ["R1.2", "R2.1"] }, { name: "OTHER", pins: ["R3.1", "R3.2"] }] };
  it("does not join top pads through a bottom track without vias", () => {
    const m = buildModel(board([30, 20], [chip("R1", -5, 0), chip("R2", 5, 0), chip("R3", 0, 6), track("s", "SIG", "bottom", 0.2, [-4.52, 0], [4.52, 0])], netlist));
    const c = estimateConnectivity(m);
    expect(c.nets.get("SIG")).toMatchObject({ status: "partial", missing: 1 });
    expect(c.nets.get("SIG")!.floating).toEqual([["trk:s"]]);
  });
  it("joins them through vias", () => {
    const m = buildModel(
      board(
        [30, 20],
        [chip("R1", -5, 0), chip("R2", 5, 0), chip("R3", 0, 6), track("a", "SIG", "top", 0.2, [-4.52, 0], [-3, 0]), via("a", "SIG", -3, 0), track("b", "SIG", "bottom", 0.2, [-3, 0], [3, 0]), via("b", "SIG", 3, 0), track("c", "SIG", "top", 0.2, [3, 0], [4.52, 0])],
        netlist,
      ),
    );
    const c = estimateConnectivity(m);
    expect(c.nets.get("SIG")).toMatchObject({ status: "complete", missing: 0 });
    expect(c.rats.filter((r) => r.net === "SIG")).toEqual([]);
  });
  it("finds where a ratsnest line crosses another net's track", () => {
    // SIG unrouted from R1.2 (-4.52, 0) to R2.1 (4.52, 0); a vertical OTHER track at x = 1 crosses it at (1, 0)
    const m = buildModel(board([30, 20], [chip("R1", -5, 0), chip("R2", 5, 0), chip("R3", 0, 6), track("o", "OTHER", "bottom", 0.2, [1, -3], [1, 3])], netlist));
    const c = estimateConnectivity(m);
    const rat = c.rats.find((r) => r.net === "SIG")!;
    expect([rat.from.id, rat.to.id].sort()).toEqual(["pad:R1:2", "pad:R2:1"]);
    expect(rat.len).toBeCloseTo(9.04, 6);
    const x = ratCrossings(m, c.rats);
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ rat: rat.id, track: "trk:o", net: "OTHER", layer: "bottom" });
    expect(x[0].at.x).toBeCloseTo(1, 6);
    expect(x[0].at.y).toBeCloseTo(0, 6);
  });
});

describe("free corridors", () => {
  const netlist = { source: "fixture", nets: [{ name: "SIG", pins: ["R1.2", "R2.1"] }, { name: "WALL", pins: [] }] };
  it("goes through a gap in a wall and reports the widest track that fits", () => {
    // a wall of WALL copper at x = 0 from y = -10 to -0.6 and from 0.6 to 10: a 1.2 mm gap between copper centers,
    // 1.0 mm between copper edges (0.2 mm wide tracks)
    const m = buildModel(board([30, 20], [chip("R1", -5, 0), chip("R2", 5, 0), track("w1", "WALL", "top", 0.2, [0, -10], [0, -0.6]), track("w2", "WALL", "top", 0.2, [0, 0.6], [0, 10])], netlist));
    const c = findCorridor(m, { from: "pad:R1:2", to: "pad:R2:1", layer: "top" });
    expect(c.found).toBe(true);
    expect(c.net).toBe("SIG");
    expect(c.length!).toBeGreaterThan(9.0);
    expect(c.length!).toBeLessThan(9.3);
    // 1.0 mm edge to edge, less 0.2 mm clearance each side: 0.6 mm, to within two pixels
    expect(c.maxWidth!).toBeGreaterThan(0.6 - 2 * c.res - 1e-9);
    expect(c.maxWidth!).toBeLessThan(0.6 + 2 * c.res + 1e-9);
    // the path crosses x = 0 inside the gap
    const p = c.path!;
    const crossings = p.slice(1).flatMap((b, i) => {
      const a = p[i];
      if (Math.sign(a.x) === Math.sign(b.x) || a.x === b.x) return [];
      return [a.y + ((0 - a.x) * (b.y - a.y)) / (b.x - a.x)];
    });
    expect(crossings).toHaveLength(1);
    expect(Math.abs(crossings[0])).toBeLessThan(0.5);
    // a track wider than the gap does not fit
    expect(findCorridor(m, { from: "pad:R1:2", to: "pad:R2:1", layer: "top", width: 0.9 }).found).toBe(false);
  });
  it("names what blocks it when there is no way through", () => {
    const m = buildModel(board([30, 20], [chip("R1", -5, 0), chip("R2", 5, 0), track("w", "WALL", "top", 0.2, [0, -10], [0, 10])], netlist));
    const c = findCorridor(m, { from: "pad:R1:2", to: "pad:R2:1", layer: "top" });
    expect(c.found).toBe(false);
    expect(c.blockedBy).toContain("trk:w");
    // the bottom layer is free
    expect(findCorridor(m, { from: "pad:R1:2", to: "pad:R2:1", layer: "bottom" }).found).toBe(true);
  });
});

describe("congestion", () => {
  it("counts free channels in an empty cell", () => {
    const m = buildModel(board([20, 20], [chip("R1", 7.5, 7.5)]));
    const c = congestion(m, m.box, { cell: 5, layers: ["top"] });
    expect([c.cols, c.rows]).toEqual([4, 4]);
    // an inner cell (row 1, col 1 from the top left) has nothing in it: 5 mm / 0.05 mm = 100 rows of centerline
    // positions, so 4.95 mm of run, pitch 0.4 mm (0.2 width + 0.2 clearance): floor(4.95 / 0.4) + 1 = 13
    expect(c.layers.top.copper[1][1]).toBe(0);
    expect(c.layers.top.hFree[1][1]).toBe(13);
    expect(c.layers.top.vFree[2][2]).toBe(13);
    // the cell holding R1 (top right) has copper and fewer channels
    expect(c.layers.top.copper[0][3]).toBeGreaterThan(0);
    expect(c.layers.top.hFree[0][3]).toBeLessThan(13);
  });
});

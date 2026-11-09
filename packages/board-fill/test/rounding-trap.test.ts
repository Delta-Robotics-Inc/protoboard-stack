/**
 * The rounding trap: a pour whose outline is the board outline, where the board has curves given as many short
 * segments (or as true arcs), with default margins. A fill computed against the approximated edge, or rounded the
 * wrong way, fails its own edge-clearance check by a few nanometers. Ours is approximated from inside, grown by a
 * margin larger than the rounding, and checked with exact distances to the true outline at exactly the clearance.
 */
import { describe, expect, it } from "vitest";
import { createDocument, mm, type BoardRecord, type Vertex } from "@protoboardai/board";
import { fillZones, SegIndex, verifyFill, exact, type Polygon } from "../src/index.js";
import { GEN, rule, stackRecords, via, zone } from "./helpers.js";

/** A rounded rectangle whose corner arcs are given as `steps` straight segments each (vertices on the nm grid). */
function segmentedRoundRect(w: number, h: number, r: number, steps: number, rotateDeg = 0): Vertex[] {
  const pts: Vertex[] = [];
  const corners = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, 90],
    [-w / 2 + r, -h / 2 + r, 180],
    [w / 2 - r, -h / 2 + r, 270],
  ];
  const rot = (rotateDeg * Math.PI) / 180;
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (90 * i) / steps) * Math.PI) / 180;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      pts.push({ x: mm(x * Math.cos(rot) - y * Math.sin(rot)), y: mm(x * Math.sin(rot) + y * Math.cos(rot)) });
    }
  return pts;
}

/** The same rounded rectangle with true arcs (vertex sweeps). */
function arcRoundRect(w: number, h: number, r: number): Vertex[] {
  const x = w / 2;
  const y = h / 2;
  return [
    { x: mm(-x + r), y: mm(-y) },
    { x: mm(x - r), y: mm(-y), sweep: 90_000 },
    { x: mm(x), y: mm(-y + r) },
    { x: mm(x), y: mm(y - r), sweep: 90_000 },
    { x: mm(x - r), y: mm(y) },
    { x: mm(-x + r), y: mm(y), sweep: 90_000 },
    { x: mm(-x), y: mm(y - r) },
    { x: mm(-x), y: mm(-y + r), sweep: 90_000 },
  ];
}

function boardWith(outline: Vertex[], extra: BoardRecord[] = [], withRule = true) {
  return createDocument([
    ...stackRecords(["top", "bottom"]),
    { kind: "outline", id: "outline", outline, source: { kind: "board" }, provenance: GEN },
    ...(withRule ? [rule("edge", "floor", "edge_clearance", mm(0.3))] : []),
    // the default pour: the zone's outline is the board outline itself
    zone("pour", "GND", ["top"], outline),
    via("g", "GND", 0, 0),
    ...extra,
  ]);
}

/** The smallest exact distance from the fill's boundary to the board edges. */
function edgeDistance(polys: Polygon[], outline: Vertex[]): number {
  const ix = new SegIndex(polys);
  const g = ix.segs;
  let best = Infinity;
  for (const e of exact.contourEdges(outline)) {
    const b = e.t === "line" ? { minX: Math.min(e.x0, e.x1), minY: Math.min(e.y0, e.y1), maxX: Math.max(e.x0, e.x1), maxY: Math.max(e.y0, e.y1) } : { minX: e.cx - e.r, minY: e.cy - e.r, maxX: e.cx + e.r, maxY: e.cy + e.r };
    ix.query(exact.inflateBox(b, mm(0.5)), (s) => {
      best = Math.min(best, exact.distSegEdge(g[4 * s], g[4 * s + 1], g[4 * s + 2], g[4 * s + 3], e));
    });
  }
  return best;
}
describe("rounding trap: the default pour keeps its edge clearance exactly", () => {
  const cases: [string, Vertex[]][] = [
    ["corner arcs as 90 segments each", segmentedRoundRect(40, 30, 5, 90)],
    ["corner arcs as 720 segments each, rotated 17.3 degrees (no round coordinates)", segmentedRoundRect(40, 30, 5, 720, 17.3)],
    ["true corner arcs", arcRoundRect(40, 30, 5)],
    ["a tiny corner radius of 3 micrometers", arcRoundRect(40, 30, 0.003)],
  ];
  for (const [label, outline] of cases) {
    it(label, () => {
      const doc = boardWith(outline);
      const r = fillZones(doc);
      const polys = r.fill.fills[0].polygons as Polygon[];
      expect(polys.length).toBe(1);
      // checked at exactly the clearance: no tolerance
      const v = verifyFill(doc, r.fill, { tolerance: 0 });
      expect(v.violations).toEqual([]);
      const d = edgeDistance(polys, outline);
      expect(d).toBeGreaterThanOrEqual(mm(0.3));
      // and not far beyond it: the margin (10 nm) plus the curve approximation (5 um) at most
      expect(d).toBeLessThan(mm(0.3) + 5000 + 20);
    });
  }
  it("with the default edge clearance when the board has no rule", () => {
    const outline = segmentedRoundRect(40, 30, 5, 90);
    const doc = boardWith(outline, [], false);
    const r = fillZones(doc);
    expect(verifyFill(doc, r.fill, { tolerance: 0 }).violations).toEqual([]);
    expect(edgeDistance(r.fill.fills[0].polygons as Polygon[], outline)).toBeGreaterThanOrEqual(mm(0.3));
  });
  it("around a round cutout given as true arcs", () => {
    const outline = arcRoundRect(40, 30, 5);
    const hole: Vertex[] = [
      { x: mm(5), y: mm(3), sweep: 180_000 },
      { x: mm(5), y: mm(5), sweep: 180_000 },
    ];
    const doc = boardWith(outline, [{ kind: "cutout", id: "cutout:hole", outline: hole, provenance: GEN }]);
    const r = fillZones(doc);
    expect(verifyFill(doc, r.fill, { tolerance: 0 }).violations).toEqual([]);
    expect(edgeDistance(r.fill.fills[0].polygons as Polygon[], hole)).toBeGreaterThanOrEqual(mm(0.3));
  });
});

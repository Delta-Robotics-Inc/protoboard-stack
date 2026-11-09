/** The minimal DXF reader (src/dxf.ts): units, bulges, joining, loops, cutouts and the skipped report. */
import { describe, expect, it } from "vitest";
import { bulgeToSweep, contourArea, DxfError, dxfOutline, joinEdges, readDxf, reverseContour } from "../src/dxf.js";
import { contourBox } from "../src/geometry.js";

type Ent = (string | number)[];
/** A DXF text from entities (each a flat list: type, then code, value pairs) and optional $INSUNITS. */
function dxf(entities: Ent[], insunits?: number): string {
  const out: (string | number)[] = [];
  if (insunits !== undefined) out.push(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$INSUNITS", 70, insunits, 0, "ENDSEC");
  out.push(0, "SECTION", 2, "ENTITIES");
  for (const [type, ...rest] of entities) out.push(0, type, ...rest);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}
const line = (x1: number, y1: number, x2: number, y2: number, layer = "0"): Ent => ["LINE", 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0];
const rect = (x0: number, y0: number, x1: number, y1: number, layer = "0"): Ent[] => [line(x0, y0, x1, y0, layer), line(x1, y0, x1, y1, layer), line(x1, y1, x0, y1, layer), line(x0, y1, x0, y0, layer)];
const circle = (x: number, y: number, r: number, extra: Ent = []): Ent => ["CIRCLE", 8, "0", 10, x, 20, y, 40, r, ...extra];
const lwpoly = (pts: [number, number, number?][], closed: boolean): Ent => ["LWPOLYLINE", 8, "0", 90, pts.length, 70, closed ? 1 : 0, ...pts.flatMap(([x, y, b]) => [10, x, 20, y, ...(b ? [42, b] : [])])];

describe("reading", () => {
  it("takes $INSUNITS: inches, centimeters, meters; absent or unitless is millimeters", () => {
    expect(readDxf(dxf([line(0, 0, 1, 0)], 1)).edges[0].b).toEqual({ x: 25_400_000, y: 0 });
    expect(readDxf(dxf([line(0, 0, 1, 0)], 5)).edges[0].b.x).toBe(10_000_000);
    expect(readDxf(dxf([line(0, 0, 0.002, 0)], 6)).edges[0].b.x).toBeCloseTo(2_000_000, 3);
    const r = readDxf(dxf([line(0, 0, 1, 0)]));
    expect([r.units, r.edges[0].b.x]).toEqual(["mm", 1_000_000]);
    expect(readDxf(dxf([line(0, 0, 1, 0)], 0)).units).toBe("mm");
  });

  it("units given override the header; an unknown header code asks for them", () => {
    expect(readDxf(dxf([line(0, 0, 1, 0)], 4), { units: "in" }).edges[0].b.x).toBe(25_400_000);
    expect(() => readDxf(dxf([line(0, 0, 1, 0)], 2))).toThrow(DxfError);
    expect(readDxf(dxf([line(0, 0, 1, 0)], 2), { units: "mm" }).units).toBe("mm");
  });

  it("turns bulges into sweeps (bulge = tan(sweep / 4)), counterclockwise positive", () => {
    expect(bulgeToSweep(1)).toBe(180_000);
    expect(bulgeToSweep(-1)).toBe(-180_000);
    expect(bulgeToSweep(Math.tan(Math.PI / 8))).toBe(90_000);
    const r = readDxf(dxf([lwpoly([[0, 0, 1], [10, 0], [10, -5]], true)]));
    expect(r.edges.map((e) => e.sweep)).toEqual([180_000, undefined, undefined]);
    expect(r.edges).toHaveLength(3); // closed: the last vertex joins the first
  });

  it("reads POLYLINE with VERTEX and SEQEND, bulges and the closed flag", () => {
    const text = dxf([["POLYLINE", 8, "0", 66, 1, 70, 1], ["VERTEX", 8, "0", 10, 0, 20, 0, 42, -1], ["VERTEX", 8, "0", 10, 4, 20, 0], ["VERTEX", 8, "0", 10, 4, 20, 4], ["SEQEND", 8, "0"]]);
    const r = readDxf(text);
    expect(r.entities).toBe(1);
    expect(r.edges.map((e) => e.sweep)).toEqual([-180_000, undefined, undefined]);
    expect(r.skipped).toEqual([]);
  });

  it("reads ARC angles counterclockwise in degrees, across 0", () => {
    const r = readDxf(dxf([["ARC", 8, "0", 10, 0, 20, 0, 40, 2, 50, 270, 51, 90]]));
    expect(r.edges[0].sweep).toBe(180_000);
    expect(r.edges[0].a.x).toBeCloseTo(0, 6);
    expect(r.edges[0].a.y).toBeCloseTo(-2_000_000, 6);
  });

  it("mirrors entities whose extrusion is (0, 0, -1)", () => {
    const r = readDxf(dxf([circle(5, 0, 1, [210, 0, 220, 0, 230, -1])]));
    expect(r.edges[0].a.x).toBeCloseTo(-6_000_000, 6);
    expect(r.edges[0].sweep).toBe(-180_000);
  });

  it("counts what it does not use, with reasons, and filters by layer", () => {
    const r = readDxf(
      dxf([
        ...rect(0, 0, 10, 10, "EDGE"),
        line(0, 0, 5, 5, "NOTES"),
        ["TEXT", 8, "NOTES", 10, 0, 20, 0, 40, 1, 1, "hi"],
        ["SPLINE", 8, "EDGE"],
        ["INSERT", 8, "EDGE", 2, "LOGO", 10, 0, 20, 0],
        ["TEXT", 8, "EDGE", 10, 0, 20, 0, 40, 1, 1, "x"],
      ]),
      { layers: ["EDGE"] },
    );
    expect(r.entities).toBe(4);
    const by = Object.fromEntries(r.skipped.map((s) => [`${s.type}: ${s.reason}`, s.count]));
    expect(by["LINE: on a layer that was not selected"]).toBe(1);
    expect(by["TEXT: on a layer that was not selected"]).toBe(1);
    expect(Object.keys(by).find((k) => k.startsWith("SPLINE:"))).toBeTruthy();
    expect(Object.keys(by).find((k) => k.startsWith("INSERT:"))).toMatch(/block/);
    expect(Object.entries(by).find(([k]) => k.startsWith("TEXT: not an outline"))?.[1]).toBe(1);
  });

  it("refuses text that is not an ASCII DXF", () => {
    expect(() => readDxf("0\nSECTION\n2\nHEADER\n0\nENDSEC\n")).toThrow(/no ENTITIES/);
    expect(() => readDxf("zero\nSECTION\n")).toThrow(/group code/);
    expect(() => readDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(/binary/);
    expect(() => readDxf(dxf([["LINE", 10, "abc", 20, 0, 11, 1, 21, 0]]))).toThrow(/not a number/);
  });
});

describe("joining", () => {
  it("joins ends within the tolerance (default 10 um) and counts open chains", () => {
    // a 10 mm square whose corners miss by 5 um
    const gap = dxf([line(0, 0, 10, 0), line(10.005, 0, 10, 10), line(10, 10.005, 0, 10), line(0, 10, 0, 0.005)]);
    const r = dxfOutline(gap, { origin: "keep" });
    expect([r.report.loops, r.report.open]).toEqual([1, 0]);
    expect(r.outline).toHaveLength(4);
    expect(() => dxfOutline(gap, { tolerance: 1000 })).toThrow(/no closed loop.*open chain/);
    const j = joinEdges(readDxf(gap).edges, 1000);
    expect([j.loops.length, j.open]).toEqual([0, 3]);
  });

  it("an arc walked from its end keeps its curve (sweep negated)", () => {
    // a D shape listed so that the walk takes the arc backward
    const text = dxf([line(-10, -10, -10, 0), ["ARC", 8, "0", 10, 0, 20, 0, 40, 10, 50, 0, 51, 180], line(10, -10, 10, 0), line(-10, -10, 10, -10)]);
    const j = joinEdges(readDxf(text).edges, 10_000);
    expect(j.loops).toHaveLength(1);
    expect(j.loops[0].find((v) => v.sweep !== undefined)?.sweep).toBe(-180_000);
    const area = Math.abs(contourArea(j.loops[0]));
    expect(area / 1e12).toBeCloseTo(200 + 50 * Math.PI, 3);
    const r = dxfOutline(text, { origin: "keep" });
    expect(contourArea(r.outline)).toBeGreaterThan(0);
    expect(Math.abs(contourBox(r.outline).maxY - 10_000_000)).toBeLessThanOrEqual(1);
  });

  it("a circle becomes a closed loop of arcs with at least three vertices", () => {
    const r = dxfOutline(dxf([circle(0, 0, 5)]), { origin: "keep" });
    expect(r.outline.length).toBeGreaterThanOrEqual(3);
    expect(r.outline.reduce((s, v) => s + (v.sweep ?? 0), 0)).toBe(360_000);
    expect(r.report.outline.area / 1e12).toBeCloseTo(25 * Math.PI, 3);
  });

  it("reports junctions where more than two ends meet", () => {
    const j = joinEdges(readDxf(dxf([...rect(0, 0, 10, 10), line(0, 0, 5, 5)])).edges, 10_000);
    expect(j.skipped.find((s) => s.type === "junction")?.count).toBe(1);
  });
});

describe("outline and cutouts", () => {
  it("the largest loop is the outline (counterclockwise), loops inside are cutouts (clockwise) by decreasing area", () => {
    const text = dxf([...rect(0, 0, 40, 30).reverse(), circle(5, 5, 1), ...rect(20, 10, 30, 20), circle(35, 25, 1.5)]);
    const r = dxfOutline(text);
    expect(contourArea(r.outline)).toBeGreaterThan(0);
    expect(r.outline.map((v) => [v.x, v.y])).toContainEqual([-20_000_000, -15_000_000]);
    expect(r.cutouts).toHaveLength(3);
    const areas = r.cutouts.map(contourArea);
    expect(areas.every((a) => a < 0)).toBe(true);
    expect(-areas[0]).toBe(100e12);
    expect(-areas[1]).toBeGreaterThan(-areas[2]);
    expect(r.report).toMatchObject({ entities: 10, loops: 4, cutouts: 3, open: 0, units: "mm", outline: { vertices: 4, area: 1200e12 } });
  });

  it("skips loops outside, crossing the outline, inside a cutout, or all inner loops with cutouts: false", () => {
    const text = dxf([...rect(0, 0, 40, 30), ...rect(50, 0, 55, 5), ...rect(35, 10, 45, 15), ...rect(5, 5, 15, 15), circle(10, 10, 1), line(60, 60, 70, 70)]);
    const r = dxfOutline(text);
    expect(r.cutouts).toHaveLength(1);
    const reasons = r.report.skipped.filter((s) => s.type === "loop").map((s) => s.reason);
    expect(reasons).toEqual(expect.arrayContaining(["outside the outline", "crosses the outline", "inside another cutout (an island)"]));
    expect(r.report.open).toBe(1);
    const none = dxfOutline(text, { cutouts: false });
    expect(none.cutouts).toHaveLength(0);
    expect(none.report.skipped.find((s) => s.reason.includes("cutouts: false"))?.count).toBe(2);
  });

  it("origin center moves the outline's box center to (0, 0); keep leaves the drawing's coordinates", () => {
    const text = dxf(rect(100, 50, 140, 80));
    expect(contourBox(dxfOutline(text).outline)).toEqual({ minX: -20_000_000, minY: -15_000_000, maxX: 20_000_000, maxY: 15_000_000 });
    expect(contourBox(dxfOutline(text, { origin: "keep" }).outline).minX).toBe(100_000_000);
  });

  it("inches through the whole chain", () => {
    const r = dxfOutline(dxf([lwpoly([[0, 0], [2, 0], [2, 1], [0, 1]], true)], 1));
    expect(r.report.units).toBe("in");
    expect(contourBox(r.outline)).toEqual({ minX: -25_400_000, minY: -12_700_000, maxX: 25_400_000, maxY: 12_700_000 });
  });

  it("reversing a contour keeps its area's size and flips its sign", () => {
    const r = dxfOutline(dxf([lwpoly([[0, 0, 0.5], [10, 0], [10, 10, -0.3], [0, 10]], true)]), { origin: "keep" });
    const a = contourArea(r.outline);
    expect(contourArea(reverseContour(r.outline))).toBeCloseTo(-a, -3);
  });
});

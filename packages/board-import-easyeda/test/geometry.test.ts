/** The polygon notation, arcs and the ZIP reader. */
import { describe, expect, it } from "vitest";
import { arcCenter, flatten, parseComplex, parseSingle, reverseRing, ringsToPolygons, v2RecordToKeyed, writeZip, ZipReader } from "../src/index.js";

describe("polygon notation", () => {
  it("reads lines, arcs and the closing point", () => {
    const s = parseSingle([0, 0, "L", 100, 0, "ARC", 90, 100, 100, "L", 0, 100, 0, 0]);
    expect(s).toEqual({
      kind: "ring",
      closed: true,
      pts: [
        { x: 0, y: 0 },
        { x: 100, y: 0, sweep: 90 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    });
  });

  it("reads rectangles from their top-left corner, with rounded corners", () => {
    const s = parseSingle(["R", 10, 50, 40, 20, 0, 0]);
    expect(s?.kind === "ring" && s.pts).toEqual([
      { x: 10, y: 30 },
      { x: 50, y: 30 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ]);
    const r = parseSingle(["R", 0, 10, 10, 10, 0, 2]);
    expect(r?.kind === "ring" && r.pts.filter((p) => p.sweep === 90)).toHaveLength(4);
  });

  it("reads circles, Bezier spans, and single or complex polygons", () => {
    expect(parseSingle(["CIRCLE", 1, 2, 3])).toEqual({ kind: "circle", cx: 1, cy: 2, r: 3 });
    const b = parseSingle([0, 0, "C", 0, 10, 10, 10, 10, 0]);
    expect(b?.kind === "ring" && b.pts.length).toBe(17);
    expect(parseComplex(["CIRCLE", 0, 0, 1])).toHaveLength(1);
    expect(parseComplex([["CIRCLE", 0, 0, 1], ["CIRCLE", 0, 0, 0.5]])).toHaveLength(2);
  });

  it("puts the arc center on the left of the chord for counterclockwise sweeps", () => {
    const c = arcCenter({ x: 1, y: 0 }, { x: 0, y: 1 }, 90);
    expect(c.cx).toBeCloseTo(0);
    expect(c.cy).toBeCloseTo(0);
    expect(c.r).toBeCloseTo(1);
    const d = arcCenter({ x: 1, y: 0 }, { x: 0, y: 1 }, -270);
    expect(d.cx).toBeCloseTo(0);
    expect(d.cy).toBeCloseTo(0);
    const half = flatten({ kind: "ring", closed: false, pts: [{ x: 1, y: 0, sweep: 180 }, { x: -1, y: 0 }] });
    expect(half.every((p) => p.y >= -1e-9)).toBe(true); // counterclockwise from (1, 0): over the top
  });

  it("reverses rings with their sweeps", () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0, sweep: 90 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(reverseRing(ring)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10, sweep: -90 }, { x: 10, y: 0 }]);
  });

  it("groups fill rings into polygons with holes", () => {
    const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    const polys = ringsToPolygons([sq(0, 0, 100), sq(10, 10, 10), sq(200, 0, 10)]);
    expect(polys).toHaveLength(2);
    expect(polys[0].holes).toHaveLength(1);
  });
});

describe("format 2 records", () => {
  it("maps positions to keys and numbers to names", () => {
    const v = v2RecordToKeyed(["VIA", "e1", 0, "GND", "", 10, 20, 12, 24, 1, null, null, 1, []])!;
    expect(v).toMatchObject({ type: "VIA", id: "e1", data: { netName: "GND", centerX: 10, centerY: 20, viaType: "SUTURE", locked: 1 } });
    const r = v2RecordToKeyed(["REGION", "e2", 0, 1, 0.2, [1, 2], [], 0])!;
    expect(r.data.prohibitType).toEqual(["TRACK", "FILL", "COMPONENT"]);
    const p = v2RecordToKeyed(["PAD", "e3", 0, "", 12, "1", 0, 0, 0, ["ROUND", 30, 30], ["ELLIPSE", 60, 60], []])!;
    expect(p.data).toMatchObject({ hole: { holeType: "ROUND", width: 30, height: 30 }, defaultPad: { padType: "ELLIPSE", width: 60, height: 60 } });
  });
});

describe("zip", () => {
  it("reads stored and deflated entries", () => {
    for (const deflate of [false, true]) {
      const z = new ZipReader(writeZip({ "a.txt": "hello", "dir/b.json": '{"x":1}' }, { deflate }));
      expect(z.names()).toEqual(["a.txt", "dir/b.json"]);
      expect(z.text("dir/b.json")).toBe('{"x":1}');
    }
    expect(() => new ZipReader(new Uint8Array(30))).toThrow(/not a ZIP/);
  });
});

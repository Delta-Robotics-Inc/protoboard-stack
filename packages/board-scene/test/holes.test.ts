/** A ring keep-out and a zone with a hole: the SVG draws the holes (even-odd), and the area is the ring's. */
import { describe, expect, it } from "vitest";
import { mm, type BoardRecord } from "@protoboardai/board";
import { buildModel, describeBoard } from "../src/index.js";
import { board } from "./boards.js";

const sq = (h: number) => [
  { x: mm(-h), y: mm(-h) },
  { x: mm(h), y: mm(-h) },
  { x: mm(h), y: mm(h) },
  { x: mm(-h), y: mm(h) },
];
const P = { by: "hand" as const };

describe("areas with holes in the scene", () => {
  const doc = board([40, 40], [
    { kind: "keepout", id: "kpo:ring", layers: ["top"], outline: sq(10), holes: [sq(5)], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go", provenance: P } as BoardRecord,
    { kind: "zone", id: "zone:ring", net: "GND", layers: ["bottom"], outline: sq(8), holes: [sq(2)], priority: 0, fill_mode: "solid", pad_connection: "solid", provenance: P } as unknown as BoardRecord,
  ]);
  it("counts the ring's area", () => {
    const m = buildModel(doc);
    expect(m.areaById.get("kpo:ring")!.area).toBeCloseTo(400 - 100, 6);
    expect(m.areaById.get("zone:ring")!.area).toBeCloseTo(256 - 16, 6);
  });
  it("draws each hole as a subpath, filled even-odd", () => {
    const svg = describeBoard(doc, { image: "svg", layers: ["top", "bottom"] }).svg!;
    for (const id of ["kpo:ring", "zone:ring"]) {
      const el = new RegExp(`<path d="([^"]*)"[^>]*data-id="${id}"`).exec(svg);
      expect(el, id).toBeTruthy();
      expect(el![0]).toContain('fill-rule="evenodd"');
      expect(el![1].match(/M/g)!.length).toBe(2);
    }
  });
});

/** A KiCad schematic export read for its nets and parts (drawing/kicadSchematic.ts): the geometry, as data. */
import { describe, expect, it } from "vitest";
import { distance, isReference, partAt, segmentsOf, wireNets, type Label, type Segment } from "../src/drawing/kicadSchematic.js";

const seg = (a: [number, number], b: [number, number]): Segment => ({ a, b });

describe("a KiCad schematic's geometry", () => {
  it("reads the segments of the paths KiCad writes (absolute moves and lines, with or without commas, closed or not)", () => {
    expect(segmentsOf("M 688.7300,559.5398\n688.7300,562.2398\n")).toEqual([seg([688.73, 559.5398], [688.73, 562.2398])]);
    expect(segmentsOf("M1 2\nL3 4\nL5 6")).toHaveLength(2);
    expect(segmentsOf("M0 0 L1 0 L1 1 Z")).toHaveLength(3);
  });
  it("measures a point's distance to a segment", () => {
    expect(distance([5, 3], seg([0, 0], [10, 0]))).toBe(3);
    expect(distance([-4, 3], seg([0, 0], [10, 0]))).toBe(5);
  });
  it("joins wires that meet end to end or in a T, and names each network by the label on it", () => {
    const segs = [seg([0, 0], [10, 0]), seg([10, 0], [10, 10]), seg([5, 0], [5, -8]), seg([30, 0], [40, 0])];
    const labels: Label[] = [{ text: "vbat", at: [10, 10.2], end: [16, 10.2] }];
    const { segmentNet, labelNet } = wireNets(segs, labels);
    expect(segmentNet.slice(0, 3)).toEqual(["vbat", "vbat", "vbat"]);
    expect(segmentNet[3]).toMatch(/^~/);
    expect(labelNet).toEqual(["vbat"]);
  });
  it("makes networks with the same label one net, across the sheet", () => {
    const segs = [seg([0, 0], [10, 0]), seg([100, 100], [110, 100])];
    const labels: Label[] = [
      { text: "i2c0_sda", at: [2, 0], end: [8, 0] },
      { text: "i2c0_sda", at: [102, 100], end: [108, 100] },
    ];
    const { segmentNet } = wireNets(segs, labels);
    expect(segmentNet).toEqual(["i2c0_sda", "i2c0_sda"]);
  });
  it("leaves a label off any wire unattached", () => {
    expect(wireNets([seg([0, 0], [10, 0])], [{ text: "nc", at: [50, 50], end: [55, 50] }]).labelNet).toEqual([undefined]);
  });
  it("knows a reference designator from a value, a pin number or a power symbol's name", () => {
    for (const r of ["R20", "U5", "BT1", "SW1", "D23", "J2B"]) expect(isReference(r)).toBe(true);
    for (const t of ["523k", "4.7µF", "1", "gnd", "#PWR01", "TPS631000DRLR", "v3v3"]) expect(isReference(t)).toBe(false);
  });
  it("finds the part at a point: the body that holds it (the smallest), else the reference nearest it", () => {
    const parts = [
      { ref: "U1", at: [0, -2] as [number, number], els: [], box: [0, 0, 40, 60] as [number, number, number, number] },
      { ref: "U2", at: [10, 8] as [number, number], els: [], box: [8, 10, 6, 6] as [number, number, number, number] },
      { ref: "R1", at: [100, 100] as [number, number], els: [] },
    ];
    expect(partAt(parts, [10, 12])?.ref).toBe("U2");
    expect(partAt(parts, [30, 50])?.ref).toBe("U1");
    expect(partAt(parts, [101, 102])?.ref).toBe("R1");
    expect(partAt(parts, [200, 200])).toBeUndefined();
  });
});

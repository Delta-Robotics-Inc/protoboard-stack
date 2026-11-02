/**
 * Wave R1 gate (diff review): the board layer side comes from the layer's name before the substrate's mid-plane
 * (a module's own `_PCB` in the same part moved the mid-plane and put the top layers inside the board), and the
 * model-size check measures height from the board only when the remainder node is board-thin.
 */
import { describe, expect, it } from "vitest";
import { offsetLayers, layerClassOf, type LayerFace } from "../src/view-model/layers.js";
import type { Face, Mat4 } from "../src/view-model/geometry.js";
import { boardSlab, compareSize } from "../src/model-size.js";

/** A flat square sheet at height z (metres), normal +Z, as one face. */
const sheet = (z: number, size = 0.05): Face => ({
  feature: 0,
  material: "m",
  positions: new Float32Array([0, 0, z, size, 0, z, size, size, z, 0, size, z]),
  normals: null,
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});
const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as Mat4;
const zOf = (f: Face) => f.positions[2];

describe("board layers: the name decides the side", () => {
  it("keeps TopCopper above the main board when a module's own board in the same part lifts the mid-plane", () => {
    // main board 0 .. 1.6 mm, a module's PCB 3 .. 4 mm (its mid-plane alone would be 2.0 mm)
    const substrate = [sheet(0), sheet(0.0016), sheet(0.003, 0.01), sheet(0.004, 0.01)];
    expect(layerClassOf("ESP32-WROOM_PCB")).toEqual({ kind: "substrate" });
    const top: LayerFace = { face: sheet(0.0016101), layer: layerClassOf("TopCopper~X")! };
    const silk: LayerFace = { face: sheet(0.0016201), layer: layerClassOf("TopSilkscreen~X")! };
    const bottom: LayerFace = { face: sheet(-0.00001), layer: layerClassOf("BottomCopper~X")! };
    offsetLayers([top, silk, bottom], substrate, I);
    expect(zOf(top.face)).toBeGreaterThan(0.0016101);
    expect(zOf(silk.face)).toBeGreaterThan(zOf(top.face));
    expect(zOf(bottom.face)).toBeLessThan(-0.00001);
  });
  it("still uses the mid-plane for a layer whose name has no side", () => {
    const l: LayerFace = { face: sheet(-0.00002), layer: { kind: "copper" } };
    offsetLayers([l], [sheet(0), sheet(0.0016)], I);
    expect(zOf(l.face)).toBeLessThan(-0.00002);
  });
});

describe("model size: the board slab", () => {
  const idx = (yMin: number, yMax: number) => ({ nodes: [{ id: ".", bounds: { min: [0, yMin, 0], max: [0.1, yMax, 0.1] } }] }) as never;
  it("is the remainder node when it is board-thin", () => {
    expect(boardSlab(idx(0, 0.0016))).toEqual({ bottom: 0, top: 0.0016 });
  });
  it("is not used when the remainder also holds a tall unmapped component (no false height mismatch)", () => {
    expect(boardSlab(idx(0, 0.0146))).toBeUndefined();
    // a correct 8.5 mm header with 4.5 mm tails compared without a slab: sorted sides, within 1.5x
    const header = { min: [0, -0.0045, 0] as [number, number, number], max: [0.00254, 0.0101, 0.01] as [number, number, number] };
    expect(compareSize(header, { length: 10, width: 2.54, height: 8.5 }, boardSlab(idx(0, 0.0146))).off).toEqual([]);
  });
});

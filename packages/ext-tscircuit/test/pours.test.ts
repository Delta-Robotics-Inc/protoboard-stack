/**
 * Copper pours (a ground plane on the inner layers): the config, the pour areas
 * (the outline less every keep-out), and the Gerber regions written for them,
 * since circuit-json-to-gerber leaves pcb_copper_pour out.
 */
import { describe, expect, it } from "vitest";
import { circlePolygon, readConstraints } from "../lib/config.ts";
import { withPours } from "../lib/outputs.ts";
import { pourOutlines } from "../lib/source.ts";

const base = { layers: 4, thickness_mm: 0.8, outline: { circle: { diameter_mm: 40 } } };

describe("pours in circuit.config.ts", () => {
  it("takes a net on inner layers, and refuses a layer the board does not have", () => {
    const ok = readConstraints({ ...base, pours: [{ net: "gnd", layers: ["inner1", "inner2"] }] });
    expect(ok.problems).toEqual([]);
    expect(ok.constraints!.pours).toEqual([{ net: "gnd", layers: ["inner1", "inner2"] }]);
    const two = readConstraints({ ...base, layers: 2, pours: [{ net: "gnd", layers: ["inner1"] }] });
    expect(two.problems[0]).toMatch(/pours\[0\]\.layers must list layers of this board \(top, bottom\)/);
    expect(readConstraints({ ...base, pours: [{ layers: ["top"] }] }).problems[0]).toMatch(/needs net/);
  });

  it("keep-outs may name inner layers on a 4-layer board", () => {
    const r = readConstraints({ ...base, keepouts: [{ name: "antenna", rect: { at: [0, -18], size: [10, 4] }, layers: ["inner1", "inner2"] }] });
    expect(r.problems).toEqual([]);
    expect(r.constraints!.keepouts[0].layers).toEqual(["inner1", "inner2"]);
  });
});

describe("pour areas", () => {
  const outline = circlePolygon(40);
  it("leave out a keep-out at the edge: one ring, notched", () => {
    const r = pourOutlines({ outline, keepouts: [{ name: "antenna", shape: { rect: { at: [0, -19], size: [10, 4] } }, layers: ["top"] }] });
    expect(r.holes).toBe(false);
    expect(r.outlines).toHaveLength(1);
    const ring = r.outlines[0];
    // no vertex of the ring lies inside the keep-out
    expect(ring.some(([x, y]) => Math.abs(x) < 4.99 && y < -17.01)).toBe(false);
    expect(ring.some(([x, y]) => Math.abs(x - 5) < 1e-6 && Math.abs(y + 17) < 1e-6)).toBe(true);
  });

  it("report a keep-out wholly inside the board, which an outline cannot leave out", () => {
    expect(pourOutlines({ outline, keepouts: [{ name: "pad", shape: { circle: { at: [0, 0], diameter_mm: 3 } }, layers: ["top"] }] }).holes).toBe(true);
  });
});

describe("pours in the Gerber files", () => {
  const gerber = ["%FSLAX46Y46*%", "%MOMM*%", "G04 aperture START LIST*", "%ADD10C,0.2*%", "%TD*%", "G04 aperture END LIST*", "D10*", "X0Y0D03*", "M02*", ""].join("\n");
  const pour = {
    type: "pcb_copper_pour",
    layer: "inner1",
    shape: "brep",
    brep_shape: { outer_ring: { vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] }, inner_rings: [{ vertices: [{ x: -0.2, y: -0.2 }, { x: 0.2, y: -0.2 }, { x: 0.2, y: 0.2 }] }] },
  };

  it("are dark regions with their clearances cleared, before anything is drawn", () => {
    const out = withPours("In1_Cu", gerber, [pour]);
    const block = out.slice(out.indexOf("G04 aperture END LIST*"), out.indexOf("D10*"));
    expect(block).toMatch(/%LPD\*%\nG36\*\nX-1000000Y-1000000D02\*\nX1000000Y-1000000D01\*/);
    expect(block).toMatch(/%LPC\*%\nG36\*\nX-200000Y-200000D02\*/);
    expect(block.trim().endsWith("%LPD*%")).toBe(true);
    expect(out.indexOf("G36*")).toBeLessThan(out.indexOf("X0Y0D03*"));
  });

  it("go only on their own layer", () => {
    expect(withPours("In2_Cu", gerber, [pour])).toBe(gerber);
    expect(withPours("F_Cu", gerber, [pour])).toBe(gerber);
  });
});

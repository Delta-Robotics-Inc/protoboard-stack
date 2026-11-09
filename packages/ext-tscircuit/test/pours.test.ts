/**
 * Copper pours (a ground plane on the inner layers): the config, the pour areas
 * (the outline less every keep-out), and the Gerber regions circuit-json-to-gerber
 * writes for them, once each.
 */
import { describe, expect, it } from "vitest";
import { circlePolygon, readConstraints } from "../lib/config.ts";
import { fabricationFiles } from "../lib/outputs.ts";
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
  // circuit-json-to-gerber (0.0.111) writes pcb_copper_pour itself; the export must not add a second copy
  const ring = (h: number) => ({ vertices: [{ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h }] });
  const board = (layers: number) => ({ type: "pcb_board", pcb_board_id: "b", center: { x: 0, y: 0 }, width: 10, height: 10, thickness: 1.6, num_layers: layers });
  const pour = (layer: string) => ({ type: "pcb_copper_pour", pcb_copper_pour_id: `p_${layer}`, layer, shape: "brep", source_net_id: "gnd", brep_shape: { outer_ring: ring(4), inner_rings: [ring(0.5)] } });
  const pad = { type: "pcb_smtpad", pcb_smtpad_id: "pad1", shape: "rect", x: 2, y: 2, width: 0.6, height: 0.6, layer: "bottom", port_hints: ["1"] };
  const regions = (text: string) => (text.match(/^G36\*$/gm) ?? []).length;
  // a closed ring of the outer outline: its 4 corners and the closing point, at ±4 mm (the converter pads with zeros)
  const outer = /^X-?0*4000000Y-?0*4000000D0[12]\*$/gm;

  it("are drawn once: the outer ring dark, its clearance cleared, before the pads", () => {
    const b = fabricationFiles([board(2), pour("bottom"), pad] as never)["gerber/B_Cu.gbr"];
    expect(regions(b)).toBe(2); // the outer ring and one clearance, not twice that
    expect(b.match(outer)).toHaveLength(5);
    expect(b).not.toContain("G04 copper pours (ext-tscircuit)*");
    const clear = b.indexOf("%LPC*%");
    expect(clear).toBeGreaterThan(b.indexOf("G36*"));
    expect(b.lastIndexOf("G37*")).toBeLessThan(b.search(/X0*2000000Y0*2000000D03\*/)); // the pad is flashed after the pour
  });

  it("go only on their own layer, inner layers included", () => {
    const files = fabricationFiles([board(4), pour("inner1")] as never);
    expect(regions(files["gerber/In1_Cu.gbr"])).toBe(2);
    expect(files["gerber/In1_Cu.gbr"].match(outer)).toHaveLength(5);
    for (const other of ["F_Cu", "In2_Cu", "B_Cu"]) expect(regions(files[`gerber/${other}.gbr`])).toBe(0);
  });
});

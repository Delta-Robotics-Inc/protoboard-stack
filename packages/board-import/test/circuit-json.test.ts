/** The Circuit JSON adapter: import of each construct, export of the contract's elements, and a round trip. */
import { any_circuit_element } from "circuit-json";
import { describe, expect, it } from "vitest";
import { padsOf, recordsOfKind, type FootprintRec, type Pad } from "@protoboardai/board";
import { circuitJsonImporter, exportCircuitJson, importBoard, importCircuitJson, type BoardImportResult } from "../src/index.js";
import { SAMPLE_CIRCUIT } from "./fixtures/sample-circuit.js";
import { saveAndReload } from "./helpers.js";

const run = () => importCircuitJson(SAMPLE_CIRCUIT);
const fp = (r: BoardImportResult, ref: string) => recordsOfKind(r.document, "footprint").find((f) => f.ref === ref)!;
const pad = (f: FootprintRec, n: string) => f.pads.find((p) => p.number === n) as Pad;
const has = (r: BoardImportResult, level: string, text: string) => r.report.some((i) => i.level === level && i.message.includes(text));
/** A pad's world center in millimeters. */
const world = (f: FootprintRec, n: string) => {
  const w = padsOf(f).find((p) => p.pad.number === n)!;
  return [w.x / 1e6, w.y / 1e6];
};

describe("Circuit JSON import", () => {
  it("the sample is valid Circuit JSON", () => {
    for (const e of SAMPLE_CIRCUIT) expect(any_circuit_element.safeParse(e).success, (e as { type: string }).type).toBe(true);
  });

  it("counts every construct", () => {
    const r = run();
    expect(r.stats).toMatchObject({ footprints: 2, pads: 11, tracks: 3, vias: 1, keepouts: 1, cutouts: 2, nets: 3, texts: 1, graphics: 2, fillPolygons: 1 });
    expect(circuitJsonImporter.accepts({ path: "x.circuit.json" })).toBe(true);
  });

  it("keys footprints by component name, with provenance generated", () => {
    const r = run();
    expect(fp(r, "U1")).toMatchObject({ id: "fp:U1", supplier_part: "C2040", side: "top", x: 2_000_000, y: 1_000_000, rotation: 0, provenance: { by: "generated", tool: "circuit-json" } });
    expect(fp(r, "R1")).toMatchObject({ id: "fp:R1", value: "10k", side: "bottom", rotation: 90_000 });
    for (const t of recordsOfKind(r.document, "track")) expect(t.id).toMatch(/^trk:g\.[0-9a-f]{12}$/);
    expect(r.offset).toEqual({ x: 0, y: 0 });
  });

  it("imports each pad shape and keeps world positions", () => {
    const r = run();
    const u1 = fp(r, "U1");
    expect(pad(u1, "1")).toMatchObject({ type: "smd", shape: "rect", width: 600_000, height: 400_000 });
    expect(pad(u1, "2")).toMatchObject({ shape: "roundrect", rotation: 45_000, corner_radius: 50_000 });
    expect(pad(u1, "3")).toMatchObject({ shape: "circle", radius: 200_000 });
    expect(pad(u1, "4")).toMatchObject({ shape: "oval", width: 1_000_000, height: 500_000 });
    expect(pad(u1, "5").points).toHaveLength(5);
    expect(pad(u1, "6")).toMatchObject({ type: "th", shape: "circle", outer_diameter: 1_200_000, hole_diameter: 600_000 });
    expect(pad(u1, "7")).toMatchObject({ type: "th", shape: "oval", hole_width: 500_000, hole_height: 1_000_000 });
    expect(pad(u1, "8")).toMatchObject({ type: "th", shape: "rect", outer_width: 1_000_000, hole_diameter: 500_000 });
    expect(pad(u1, "_")).toMatchObject({ type: "np", hole_diameter: 800_000 });
    expect(world(u1, "1")).toEqual([1, 1]);
    const r1 = fp(r, "R1");
    expect(world(r1, "1")).toEqual([-3, -2.5]);
    expect(world(r1, "2")).toEqual([-3, -1.5]);
  });

  it("builds nets from source traces: named nets and port-to-port traces", () => {
    const r = run();
    expect(r.netlist.nets.map((n) => [n.name, n.pins])).toEqual([
      [".U1 > .pin3 to .R1 > .pin2", ["R1.2", "U1.3"]],
      ["GND", ["R1.1", "U1.1"]],
      ["VCC", ["U1.6"]],
    ]);
    const tracks = recordsOfKind(r.document, "track");
    expect(tracks.filter((t) => t.net === "GND").map((t) => t.layer).sort()).toEqual(["bottom", "top"]);
    expect(tracks.find((t) => t.layer === "top" && t.net !== "GND")?.net).toBe(".U1 > .pin3 to .R1 > .pin2");
    expect(recordsOfKind(r.document, "via")[0]).toMatchObject({ net: "GND", from_layer: "top", to_layer: "bottom", outer_diameter: 600_000 });
  });

  it("maps keep-outs, cutouts, drawings, the courtyard and board rules; pours only as fill", () => {
    const r = run();
    expect(recordsOfKind(r.document, "keepout")[0]).toMatchObject({ layers: ["top"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go", description: "antenna" });
    expect(recordsOfKind(r.document, "zone")).toHaveLength(0);
    expect(r.fill.fills[0]).toMatchObject({ source: "pour_0", net: "GND", layer: "bottom" });
    expect(r.fill.fills[0].zone).toBeUndefined();
    expect(r.fill.fills[0].polygons[0].holes).toHaveLength(1);
    const u1 = fp(r, "U1");
    expect(u1.courtyard).toHaveLength(4);
    expect(u1.graphics?.map((g) => g.shape).sort()).toEqual(["line", "rect"]);
    expect(u1.texts?.[0]).toMatchObject({ role: "ref", text: "U1", layer: "top_silkscreen" });
    expect(recordsOfKind(r.document, "text")[0]).toMatchObject({ text: "TOP", anchor: "left" });
    expect(recordsOfKind(r.document, "graphic").map((g) => `${g.layer}:${g.shape}`).sort()).toEqual(["bottom_silkscreen:circle", "top_silkscreen:path"]);
    const rules = recordsOfKind(r.document, "rule");
    expect(rules.find((x) => x.id === "rule:circuit-json.min_trace_width")).toMatchObject({ tier: "floor", check: "track_width", min: 150_000 });
    expect(r.report.some((i) => i.level === "dropped" && i.source === "min_same_net_trace_edge_to_trace_edge_clearance")).toBe(true);
    expect(has(r, "dropped", "pcb_solder_paste")).toBe(true);
    expect(has(r, "approximated", "board-level pcb_hole")).toBe(true);
  });

  it("places a component whose pads are all on the other side on the side of its pads", () => {
    const flipped = SAMPLE_CIRCUIT.map((e) => ((e as { pcb_component_id?: string; type: string }).type === "pcb_component" && (e as { pcb_component_id: string }).pcb_component_id === "pc_r1" ? { ...e, layer: "top" } : e));
    const r = importCircuitJson(flipped);
    expect(fp(r, "R1").side).toBe("bottom");
    expect(fp(r, "R1").pads).toHaveLength(2);
    expect(has(r, "approximated", "all its SMD pads on the other side")).toBe(true);
  });

  it("keeps a pad on the other side from its component, at its position, and exports it on that side", () => {
    const mixed = SAMPLE_CIRCUIT.map((e) => ((e as { pcb_smtpad_id?: string }).pcb_smtpad_id === "pad_r1_2" ? { ...e, layer: "top" } : e));
    const r = importCircuitJson(mixed);
    const r1 = fp(r, "R1");
    expect(r1.side).toBe("bottom");
    expect(pad(r1, "1").layer).toBe("top");
    expect(pad(r1, "2").layer).toBe("bottom");
    expect(padsOf(r1).map((p) => p.layers)).toEqual([["bottom"], ["top"]]);
    expect(world(r1, "2")).toEqual([-3, -1.5]);
    expect(has(r, "dropped", "other side")).toBe(false);
    expect(has(r, "info", "pcb_smtpad on the other side from its component")).toBe(true);
    const back = exportCircuitJson(r.document).elements.filter((e) => e.type === "pcb_smtpad") as { layer: string; x?: number; y?: number; port_hints?: string[] }[];
    expect(back.find((e) => e.port_hints?.[0] === "2" && Math.abs((e.x ?? 0) + 3) < 1e-9)?.layer).toBe("top");
    expect(saveAndReload(r).equal).toBe(true);
  });

  it("saves and reloads through the core's file format", () => {
    expect(saveAndReload(run()).equal).toBe(true);
  });
});

describe("Circuit JSON export", () => {
  it("writes valid Circuit JSON for the contract's elements", () => {
    const out = exportCircuitJson(run().document);
    const bad = out.elements.map((e) => [e.type, any_circuit_element.safeParse(e)] as const).filter(([, r]) => !r.success);
    expect(bad.map(([t, r]) => `${t}: ${JSON.stringify(r.error?.issues[0])}`)).toEqual([]);
    const types = new Set(out.elements.map((e) => e.type));
    for (const t of ["pcb_board", "source_component", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_trace", "pcb_via", "pcb_keepout", "pcb_cutout", "pcb_silkscreen_line", "pcb_silkscreen_path", "pcb_silkscreen_rect", "pcb_silkscreen_circle", "pcb_silkscreen_text", "source_net"]) expect(types.has(t as never), t).toBe(true);
  });

  it("round-trips: import, export, import gives the same board", async () => {
    const a = run();
    const out = exportCircuitJson(a.document);
    const b = await importBoard({ text: JSON.stringify(out.elements), kind: "circuit-json" });
    expect(b.stats).toMatchObject({ footprints: a.stats.footprints, pads: a.stats.pads, vias: a.stats.vias, keepouts: a.stats.keepouts, cutouts: a.stats.cutouts, nets: a.stats.nets });
    expect(b.netlist.nets.map((n) => [n.name, n.pins])).toEqual(a.netlist.nets.map((n) => [n.name, n.pins]));
    // pads land where they were
    for (const ref of ["U1", "R1"]) {
      const pa = padsOf(fp(a, ref)).map((p) => `${p.pad.number}@${Math.round(p.x / 1000)},${Math.round(p.y / 1000)}`).sort();
      const pb = padsOf(fp(b, ref)).map((p) => `${p.pad.number}@${Math.round(p.x / 1000)},${Math.round(p.y / 1000)}`).sort();
      expect(pb).toEqual(pa);
    }
    // connected segments of one net and layer chain into one trace
    const traces = out.elements.filter((e) => e.type === "pcb_trace");
    expect(traces).toHaveLength(3);
  });
});

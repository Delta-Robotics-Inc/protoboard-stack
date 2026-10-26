/**
 * Locked boards (PB-1027): the KiCad export's clean-up and the checks a
 * locked board gets, without KiCad: unique 3D model names (89 parts shared
 * body.step), empty footprints left out (F21), a keep-out's exception for its
 * own module in KiCad's custom rules (F23), the via rules as KiCad minimums
 * and as a check (F31), hand traces joining one pin's pads (F22), one DRC
 * count (F24, F25) and moves measured from where KiCad had a part at lock
 * (F26).
 */
import { describe, expect, it } from "vitest";
import type { Keepout } from "../lib/config.ts";
import { drcLine, summariseDrc } from "../lib/kicad/drc.ts";
import { customRules, emptyFootprint, keepoutExceptions, modelFileName } from "../lib/kicad/project.ts";
import { child, children, parse, text } from "../lib/kicad/sexpr.ts";
import { viasBelowRules } from "../lib/checks.ts";
import { handPadJoins } from "../lib/layout.ts";
import type { NameMap } from "../lib/source.ts";
import { movedSinceLock, readPosCsv } from "../ops/kicad.ts";

describe("3D model files (PB-1027: 89 parts shared body.step)", () => {
  it("names each body file by its part, and two files of one name apart", () => {
    const taken = new Map<string, string>();
    const a = modelFileName("/p/parts/esp32/cad/body.step", "esp32", taken);
    const b = modelFileName("/p/parts/sensor/cad/body.step", "sensor", taken);
    expect(a).toBe("3d/esp32-body.step");
    expect(b).toBe("3d/sensor-body.step");
    // the same file again keeps its name
    expect(modelFileName("/p/parts/esp32/cad/body.step", "esp32", taken)).toBe(a);
    // a file already named after its part keeps that name
    expect(modelFileName("/lib/yageo-rc0402-cad_step.step", "yageo-rc0402", taken)).toBe("3d/yageo-rc0402-cad_step.step");
    // another file that would take a used name gets its path's digest
    const c = modelFileName("/q/other/esp32/body.step", "esp32", taken);
    expect(c).toMatch(/^3d\/esp32-body-[0-9a-f]{8}\.step$/);
    expect(new Set([a, b, c]).size).toBe(3);
    // a box with no part
    expect(modelFileName("/p/box-1x1x1.step", undefined, taken)).toBe("3d/box-1x1x1.step");
  });
});

describe("empty footprints (F21)", () => {
  it("a footprint with no pad, drawing or model is empty; a mounting hole is not", () => {
    expect(emptyFootprint(parse('(footprint "tscircuit:Unknown" (layer "F.Cu") (at 100 100 0) (property "Reference" "" (at 0 0 0)))'))).toBe(true);
    expect(emptyFootprint(parse('(footprint "tscircuit:hole" (layer "F.Cu") (at 100 100 0) (pad "" np_thru_hole circle (at 0 0) (size 2.2 2.2) (drill 2.2) (layers "*.Cu" "*.Mask")))'))).toBe(false);
    expect(emptyFootprint(parse('(footprint "x" (at 0 0) (fp_line (start 0 0) (end 1 1) (layer "F.SilkS")))'))).toBe(false);
  });
});

const ZONE = (layer: string) => `(zone (layer "${layer}") (uuid "u-${layer}") (keepout (tracks not_allowed) (vias not_allowed) (pads not_allowed) (copperpour not_allowed) (footprints not_allowed)) (polygon (pts (xy 128.4 107) (xy 135.2 107) (xy 135.2 93) (xy 128.4 93))))`;

describe("a keep-out's exception for its own module (F23)", () => {
  const antenna: Keepout = { name: "antenna", shape: { rect: { at: [31.8, 0], size: [6.8, 14] } }, layers: ["top", "bottom"] as never, allow_bodies: ["u1"] };

  it("names the keep-out's areas, lets footprints in, and forbids all but the allowed module by a rule", () => {
    const pcb = parse(`(kicad_pcb ${ZONE("F.Cu")} ${ZONE("B.Cu")})`);
    const r = keepoutExceptions(pcb, [antenna], { u1: "U1" });
    expect(r.notes).toEqual([]);
    for (const z of children(pcb, "zone")) {
      expect(text(child(z, "name")?.items[1])).toBe("antenna");
      expect(text(child(child(z, "keepout")!, "footprints")?.items[1])).toBe("allowed");
      // copper stays out
      expect(text(child(child(z, "keepout")!, "pads")?.items[1])).toBe("not_allowed");
    }
    expect(r.rules).toContain("(constraint disallow footprint)");
    expect(r.rules).toContain(`(condition "A.intersectsArea('antenna') && A.Reference != 'U1'")`);
  });

  it("a keep-out with no exception is left as KiCad has it, and one whose area is not found says so", () => {
    const pcb = parse(`(kicad_pcb ${ZONE("F.Cu")})`);
    expect(keepoutExceptions(pcb, [{ ...antenna, allow_bodies: undefined }], {})).toEqual({ notes: [] });
    expect(text(child(child(children(pcb, "zone")[0], "keepout")!, "footprints")?.items[1])).toBe("not_allowed");
    const elsewhere = keepoutExceptions(pcb, [{ ...antenna, shape: { rect: { at: [0, 0], size: [2, 2] } } }], { u1: "U1" });
    expect(elsewhere.rules).toBeUndefined();
    expect(elsewhere.notes[0]).toContain("no KiCad keep-out area was found");
  });
});

describe("the via rules (F31)", () => {
  const rules = { trace_width_mm: 0.2, power_trace_width_mm: 0.3, via_pad_mm: 0.6, via_drill_mm: 0.3, edge_clearance_mm: 0.3 };

  it("are minimums in KiCad's custom rules, beside the keep-out rules", () => {
    const dru = customRules({ rules } as never, '\t(rule "keepout x")')!;
    expect(dru).toMatch(/^\(version 1\)/);
    expect(dru).toContain("(constraint via_diameter (min 0.6mm))");
    expect(dru).toContain("(constraint hole_size (min 0.3mm))");
    expect(dru).toContain('(rule "keepout x")');
    expect(customRules(undefined)).toBeUndefined();
  });

  it("check finds a via smaller than the rules (a hand via), not one that keeps to them", () => {
    const cj = [
      { type: "pcb_via", pcb_via_id: "ok", x: 0, y: 0, outer_diameter: 0.6, hole_diameter: 0.3 },
      { type: "pcb_via", pcb_via_id: "small_pad", x: 1, y: 2, outer_diameter: 0.45, hole_diameter: 0.3 },
      { type: "pcb_via", pcb_via_id: "small_drill", x: 3, y: 4, outer_diameter: 0.6, hole_diameter: 0.2 },
    ];
    expect(viasBelowRules(cj as never, rules)).toEqual([
      { via: "small_pad", at: [1, 2], what: "0.45 mm across its pad", want: 0.6 },
      { via: "small_drill", at: [3, 4], what: "drilled 0.2 mm", want: 0.3 },
    ]);
  });
});

describe("hand traces joining one pin's pads (F22)", () => {
  const map = { components: { u1: { instance: "u1", part: "esp32", ports: { "49": "gnd", "1": "en" } } } } as unknown as NameMap;
  const cj = [
    { type: "source_component", source_component_id: "sc1", name: "u1" },
    { type: "source_port", source_port_id: "p49", source_component_id: "sc1", name: "pin49", pin_number: 49 },
    { type: "source_port", source_port_id: "p49a", source_component_id: "sc1", name: "pin49_internal_1" },
    { type: "source_port", source_port_id: "p49b", source_component_id: "sc1", name: "pin49_internal_2" },
    { type: "source_port", source_port_id: "p1", source_component_id: "sc1", name: "pin1", pin_number: 1 },
    // generate's own join (in board.gen.tsx), a hand one (board.tsx), a trace to a net, one between two pins
    { type: "source_trace", source_trace_id: "t1", connected_source_port_ids: ["p49a", "p49"], connected_source_net_ids: [], display_name: ".u1 > .pin49_internal_1 to .u1 > .pin49" },
    { type: "source_trace", source_trace_id: "t2", connected_source_port_ids: ["p49b", "p49"], connected_source_net_ids: [], display_name: ".u1 > .pin49_internal_2 to .u1 > .pin49" },
    { type: "source_trace", source_trace_id: "t3", connected_source_port_ids: ["p49"], connected_source_net_ids: ["n"], display_name: ".u1 > .pin49 to net.gnd" },
    { type: "source_trace", source_trace_id: "t4", connected_source_port_ids: ["p1", "p49"], connected_source_net_ids: [], display_name: ".u1 > .pin1 to .u1 > .pin49" },
  ];
  const generated = `<trace from=".u1 > .pin49_internal_1" to=".u1 > .pin49" />\n<trace from=".u1 > .pin49" to="net.gnd" />`;

  it("names the trace written by hand, not generate's own, a net trace or one between two pins", () => {
    expect(handPadJoins(cj as never, map, generated)).toEqual([{ trace: ".u1 > .pin49_internal_2 to .u1 > .pin49", instance: "u1", pin: "gnd", ports: ["pin49_internal_2", "pin49"] }]);
    // a second copy of generate's own join, written by hand, is found too
    const twice = [...cj, { ...cj[5], source_trace_id: "t1b" }];
    expect(handPadJoins(twice as never, map, generated).map((h) => h.trace)).toEqual([".u1 > .pin49_internal_2 to .u1 > .pin49", ".u1 > .pin49_internal_1 to .u1 > .pin49"]);
  });
});

describe("one KiCad DRC count for export and check (F24, F25)", () => {
  it("counts errors and warnings by KiCad's severity, unconnected items and parity, and names the error types", () => {
    const s = summariseDrc({
      violations: [
        { severity: "error", type: "courtyards_overlap", description: "Courtyards overlap", items: [{ description: "Footprint J6" }, { description: "Footprint U1" }] },
        { severity: "error", type: "courtyards_overlap", description: "Courtyards overlap" },
        { severity: "error", type: "hole_clearance", description: "Hole clearance" },
        { severity: "warning", type: "holes_co_located", description: "Holes co-located" },
      ],
      unconnected_items: [{}],
      schematic_parity: [],
    });
    expect(s).toMatchObject({ errors: 3, warnings: 1, unconnected: 1, parity: 0, byType: [["courtyards_overlap", 2], ["hole_clearance", 1]] });
    expect(s.first[0]).toBe("courtyards_overlap: Courtyards overlap (Footprint J6, Footprint U1)");
    expect(drcLine(s)).toBe("KiCad DRC: 3 error(s) (2 courtyards_overlap, 1 hole_clearance), 1 warning(s), 1 unconnected, 0 schematic parity");
  });
});

describe("moves made in KiCad are measured from where KiCad had the part at lock (F26)", () => {
  it("reads KiCad's position file", () => {
    const pos = readPosCsv('Ref,Val,Package,PosX,PosY,Rot,Side\n"U1","ESP32","mini",22.8,0,270,top\n"R1","10k","0402",-3.25,4.5,-90,bottom\n');
    expect(pos.get("U1")).toEqual({ x: 22.8, y: 0, rot: 270, side: "top" });
    expect(pos.get("R1")).toEqual({ x: -3.25, y: 4.5, rot: 270, side: "bottom" });
  });

  it("a part KiCad has where it had it at lock did not move, whatever tscircuit's body origin", () => {
    const atLock = { x: 22.8, y: 0, rot: 270, side: "top" as const };
    // tscircuit's body origin is the land pattern's, 0.6 mm from the pads' centre KiCad places by
    const built = { origin: [22.2, 0], rotation_deg: 270 };
    expect(movedSinceLock(atLock, atLock, built)).toBeUndefined();
    expect(movedSinceLock({ ...atLock, x: 24.8 }, atLock, built)).toEqual({ from: [22.8, 0], to: [24.8, 0], turn: 0 });
    expect(movedSinceLock({ ...atLock, rot: 0 }, atLock, built)?.turn).toBe(90);
    // a record from before positions were kept: measured from tscircuit's, as before
    expect(movedSinceLock(atLock, undefined, built)).toEqual({ from: [22.2, 0], to: [22.8, 0], turn: 0 });
  });
});

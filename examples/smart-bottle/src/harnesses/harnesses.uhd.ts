/**
 * Harness modules of the smart bottle (PB-834): the physical carriers of its
 * links. Each is `kind: "harness"`.
 *
 * Wire harnesses (routed by @protoboardai/ext-harness-cad; each has a provider
 * directory src/harnesses/<id>/ with its cad.config.ts):
 *   - bottle-battery-leads: the LP503450's own two leads, bent from the PCM
 *     end down to the board's BAT pads;
 *   - bottle-probe-cable: the Adafruit 381 probe's own cable, cut to length,
 *     from the stiff end of its heat shrink to the board's probe pads.
 * Each end is a connector composite; the system links one end to the part's
 * leads and the other to the board's pads (link-scoped compositions), and
 * UHD traces power, ground and the 1-Wire line through the conductors.
 *
 * Mechanical harnesses (fastener stacks):
 *   - bottle-board-hardware: four M2 x 6 screws through the board into the
 *     heat-set inserts in the cap's bosses (carries the board's mount link);
 * The lid needs no hardware: it is a bayonet (the cap's lid_joint, D-B09).
 * The four inserts belong to the cap (bottle-cap-enclosure children): they
 * are set when the cap is printed, in its own unit, so final assembly only
 * drives the board's screws into them.
 *
 * Sources: the parts' own (cell: polybattery.com spec table and photo, the
 * LiPol 850 mAh drawing for the leads; probe: Adafruit 381 page), the
 * fastener parts (ruthex RX-M2x4, ISO 7045 M2 x 6), and the torque tables
 * cited below.
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/**
 * Installed lengths (mm): what each cable is fitted to. `protoboard run
 * harness-cad` reports the shortest clear route; a cut-to-length cable is set
 * from it (harness-cad SOP, step 4).
 */
export const BATTERY_LEAD_MM = 9;
export const PROBE_CABLE_MM = 16;

const SRC = {
  cell: "https://polybattery.com/product/1000mah-lipo-battery-lp503450-3-7-v-lithium-rechargeable-battery-cqc",
  cellPhoto: "https://polybattery.com/wp-content/uploads/2021/04/1000mah-lipo-battery-lp503450-3.7-v-lithium-rechargeable-battery-cqc.jpg",
  lipolDrawing: "https://www.lipolbattery.com/LiPo-Battery-Datahseet/LiPo_Battery_LP503450_3.7V_850mAh.pdf",
  probe: "https://www.adafruit.com/product/381",
  npf: "https://www.npfasteners.com/technical/tightening-torques.htm",
} as const;

/** Conductors between two ends: straight through (position k to position k). */
const wires = (a: string, b: string): InterfaceLink => ({ id: "wires", name: "Conductors", a: { self: true, interfaceId: a }, b: { self: true, interfaceId: b } });

const cable = (length_mm: number, conductors: number, extra: Record<string, unknown> = {}) => ({ type: "performance", params: { kind: "cable", length_mm, conductors, ...extra } });
const build = (params: { colors: string[]; bundle: "twisted" | "parallel"; od_mm: number; spacing_mm?: number; twist_pitch_mm?: number; note: string; source?: string | string[] }) => ({ type: "cable_build", params });
const assumption = (field: string, value: string, reason: string) => ({ type: "assumption", params: { field, value, reason } });

/** The cell's own leads, from its PCM end to the board's BAT pads. */
export const BOTTLE_BATTERY_LEADS: ModuleDef = routed({
  id: "bottle-battery-leads",
  name: "Cell leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "LiPoly Batteries Co., Ltd.",
  description: "The LP503450's red (+) and black (-) leads, bent down from the cell's PCM end and soldered to the board's BAT+ and BAT- pads; trimmed to length.",
  tags: ["harness", "power", "component-leads", "smart-bottle"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_cell", name: "Cell end (the leads leave the PCM)", connector: "integral", pins: ["+", "-"], note: "The leads are the cell's own." }),
    Connector({ id: "end_board", name: "Soldered end (BAT pads)", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_cell", "end_board")],
  traits: [
    cable(BATTERY_LEAD_MM, 2, { length_basis: "PCM end to pad, trimmed", supplied_length_note: "delivered about 50 mm (LiPol 850 mAh reference drawing, 50 ± 3 mm; assumption on lipol-lp503450)" }),
    { type: "usage_note", params: { note: "The cell's own leads: trim to length, tin, and solder red to BAT+ and black to BAT-. Never short them: the PCM is the only protection.", included_with: "lipol-lp503450", source: [SRC.cell, SRC.cellPhoto] } },
    build({ colors: ["red", "black"], bundle: "parallel", od_mm: 0.9, spacing_mm: 2.5, note: "Two AWG28 UL1571 leads, 2.5 mm apart as they leave the PCM.", source: SRC.lipolDrawing }),
    assumption("gauge and insulation", "AWG28 UL1571, Ø0.90 mm insulation", "The maker states no gauge; taken from the LiPol 850 mAh reference drawing (lipol-lp503450 assumption trait)."),
  ],
});

/** The probe's own cable, from the stiff end of its heat shrink to the board's probe pads. */
export const BOTTLE_PROBE_CABLE: ModuleDef = routed({
  id: "bottle-probe-cable",
  name: "Probe cable",
  kind: "harness",
  topology: "wire",
  manufacturer: "Adafruit Industries",
  description: "The Adafruit 381 probe's own three-wire cable, cut to length inside the cap: VDD (red), DQ (yellow/white), GND (black/blue) soldered to the board's probe pads.",
  tags: ["harness", "signal", "one-wire", "component-leads", "smart-bottle"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_probe", name: "Probe end (the cable leaves the heat shrink)", connector: "integral", pins: ["VDD", "DQ", "GND"], note: "The cable is the probe's own." }),
    Connector({ id: "end_board", name: "Soldered end (probe pads)", connector: "solder_leads", pins: ["VDD", "DQ", "GND"] }),
  ],
  links: [wires("end_probe", "end_board")],
  traits: [
    cable(PROBE_CABLE_MM, 3, { length_basis: "heat-shrink end to pad, cut from the probe's 91 cm cable" }),
    { type: "usage_note", params: { note: "Cut the probe's 91 cm cable to length, strip the jacket back 10 mm and the wires 2 mm, and solder VDD (red), DQ (yellow/white) and GND (black/blue) to the pads marked on the board. Only the stainless tube goes into the bottle; the PVC jacket stays in the dry compartment (OQ-B5).", included_with: "adafruit-381-ds18b20-probe", source: SRC.probe } },
    build({ colors: ["red", "yellow", "black"], bundle: "twisted", od_mm: 1.5, twist_pitch_mm: 30, note: "Drawn as the three insulated wires (Ø1.5 mm, read from Adafruit's photos) laid together; the Ø4 mm jacket and its heat shrink are not drawn.", source: SRC.probe }),
    assumption("drawn diameter", "three Ø1.5 mm wires; the jacket (Ø4 mm) and heat shrink (Ø4.8-6.3 mm) are not drawn", "ext-harness-cad routes conductors, not a jacket: the route's clearance is checked for the wires only, so the real cable is up to 6.3 mm thick where the heat shrink is."),
  ],
});

// ---------------------------------------------------------------------------
// Fastener stacks
// ---------------------------------------------------------------------------

const torque = (torqueNm: number, assumption: string) => ({
  torqueNm,
  assumption,
  reference: [{ torqueNm: 0.17, condition: "M2 steel class 4.6, 'generic reference values ... starting point'", source: SRC.npf }],
});

/** Four M2 x 6 screws through the 0.6 mm board into inserts in the cap's bosses. */
export const BOTTLE_BOARD_HARDWARE: ModuleDef = {
  id: "bottle-board-hardware",
  name: "Board hardware (M2)",
  kind: "harness",
  topology: "bus",
  description: "Four M2 x 6 pan-head screws (ISO 7045, A2) through the board's Ø2.2 mm holes into the ruthex RX-M2x4 heat-set inserts already set in the cap's bosses.",
  tags: ["harness", "mechanical", "fasteners", "smart-bottle"],
  display: { icon: "wrench" },
  children: [{ id: "screws", moduleDefId: "iso-7045-m2x6-a2", name: "M2 x 6 pan-head screw", quantity: 4 }],
  interfaces: [
    {
      id: "bolts",
      name: "4 x M2 on Ø54",
      domain: "mechanical",
      exposed: false,
      protocols: [{ type: "bolt_pattern", roles: ["component"] }],
      parameters: [
        { id: "bolt_circle_diameter", unit: "mm", value: 54 },
        { id: "fastener_diameter", unit: "mm", value: 2 },
      ],
    },
  ],
  // from the boss tops (z = 0, normal +Z): the cap's inserts sit flush with the boss tops (set with the cap);
  // the board 0-0.6; the screw's head on the board, its shank down 5.4 mm into the insert (4.0 mm of thread engaged, 1.4 mm below it in the 6.0 mm hole)
  fastenerStack: [
    { child: "screws", atMm: 0.6, direction: -1, torque: torque(0.15, "Snug: an A2 M2 screw into a brass heat-set insert in PETG, clamping a 0.6 mm board. Below the class 4.6 steel reference (0.17 N·m) because the insert's hold in the print, not the screw, is the limit; no maker states a torque.") },
  ],
  traits: [{ type: "usage_note", params: { note: "The inserts come set in the cap's bosses (cap unit). Tighten the screws snug, crosswise." } }],
};

export const HARNESSES: ModuleDef[] = [BOTTLE_BATTERY_LEADS, BOTTLE_PROBE_CABLE, BOTTLE_BOARD_HARDWARE];

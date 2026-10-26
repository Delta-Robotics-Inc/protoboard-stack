/**
 * Harnesses (from the iot template, as in the smart-bottle reference
 * project): the physical carriers of the system's links. Each is
 * `kind: "harness"`.
 *
 *   battery-leads   the LP503450's own two leads, soldered to the board's
 *                   BAT pads
 *
 * Each end is a connector composite; the system links one end to the part's
 * leads and the other to the board's pads (link-scoped compositions), and
 * UHD traces power and ground through the conductors. Routed by
 * @protoboardai/ext-harness-cad (`routed()`, src/harnesses/<id>/) once the
 * parts have their places.
 *
 * Sources: the cell's own (polybattery.com spec table and photo, the LiPol
 * 850 mAh drawing for the leads).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/** Installed length (mm): as supplied until the layout sets it (`protoboard run harness-cad` reports the shortest clear route). */
export const BATTERY_LEAD_MM = 50;

const SRC = {
  cell: "https://polybattery.com/product/1000mah-lipo-battery-lp503450-3-7-v-lithium-rechargeable-battery-cqc",
  cellPhoto: "https://polybattery.com/wp-content/uploads/2021/04/1000mah-lipo-battery-lp503450-3.7-v-lithium-rechargeable-battery-cqc.jpg",
  lipolDrawing: "https://www.lipolbattery.com/LiPo-Battery-Datahseet/LiPo_Battery_LP503450_3.7V_850mAh.pdf",
} as const;

/** Conductors between two ends: straight through (position k to position k). */
const wires = (a: string, b: string): InterfaceLink => ({ id: "wires", name: "Conductors", a: { self: true, interfaceId: a }, b: { self: true, interfaceId: b } });

const cable = (length_mm: number, conductors: number, extra: Record<string, unknown> = {}) => ({ type: "performance", params: { kind: "cable", length_mm, conductors, ...extra } });
const build = (params: { colors: string[]; bundle: "twisted" | "parallel"; od_mm: number; spacing_mm?: number; twist_pitch_mm?: number; note: string; source?: string | string[] }) => ({ type: "cable_build", params });
const assumption = (field: string, value: string, reason: string) => ({ type: "assumption", params: { field, value, reason } });

/** The cell's own leads, from its PCM end to the board's BAT pads. */
export const BATTERY_LEADS: ModuleDef = routed({
  id: "battery-leads",
  name: "Cell leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "LiPoly Batteries Co., Ltd.",
  description: "The LP503450's red (+) and black (-) leads, soldered to the board's BAT+ and BAT- pads.",
  tags: ["harness", "power", "component-leads"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_cell", name: "Cell end (the leads leave the PCM)", connector: "integral", pins: ["+", "-"], note: "The leads are the cell's own." }),
    Connector({ id: "end_board", name: "Soldered end (BAT pads)", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_cell", "end_board")],
  traits: [
    cable(BATTERY_LEAD_MM, 2, { length_basis: "as supplied, until the layout sets the routed length", supplied_length_note: "delivered about 50 mm (LiPol 850 mAh reference drawing, 50 ± 3 mm; assumption on lipol-lp503450)" }),
    { type: "usage_note", params: { note: "The cell's own leads: trim to length, tin, and solder red to BAT+ and black to BAT-. Never short them: the PCM is the only protection.", included_with: "lipol-lp503450", source: [SRC.cell, SRC.cellPhoto] } },
    build({ colors: ["red", "black"], bundle: "parallel", od_mm: 0.9, spacing_mm: 2.5, note: "Two AWG28 UL1571 leads, 2.5 mm apart as they leave the PCM.", source: SRC.lipolDrawing }),
    assumption("gauge and insulation", "AWG28 UL1571, Ø0.90 mm insulation", "The maker states no gauge; taken from the LiPol 850 mAh reference drawing (lipol-lp503450 assumption trait)."),
  ],
});

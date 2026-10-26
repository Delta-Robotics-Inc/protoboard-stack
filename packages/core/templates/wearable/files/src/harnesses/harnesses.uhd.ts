/**
 * Harnesses (from the wearable template, as in the wearable-watch reference
 * project): the physical carriers of the system's links. Each is
 * `kind: "harness"`.
 *
 *   battery-leads   the cell's own AWG30 leads, soldered to the board's
 *                   cell pads (J3)
 *
 * Each end is a connector composite, the conductors are an internal link,
 * and the system links the ends to link-scoped compositions of the cell's
 * leads and the board's pads, so UHD derives the power links through them.
 * Their routed geometry comes from @protoboardai/ext-harness-cad (`routed()`,
 * src/harnesses/<id>/) once the parts have their places.
 *
 * Sources: LiPol LP402030 drawing FD_2030_40 (leads AWG30 UL1007, red +,
 * black -, 50 +-3 mm); third-party UL1007 30 AWG tables for the insulation
 * diameter (parts/evidence/lipol-lp402030/sources.json).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/** Installed length (mm): as supplied until the layout sets the routed length (harness-cad reports the shortest clear route). */
export const BATTERY_LEAD_MM = 50;

const LIPOL = "https://www.li-polymer-battery.com/wp-content/uploads/2021/06/LP402030-Datasheet.pdf";

const wires = (a: string, b: string): InterfaceLink => ({ id: "wires", name: "Conductors", a: { self: true, interfaceId: a }, b: { self: true, interfaceId: b } });

export const BATTERY_LEADS: ModuleDef = routed({
  id: "battery-leads",
  name: "Cell leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "LiPol Battery Co.",
  description: "The LP402030's two AWG30 UL1007 leads (red +, black -), soldered to the board's cell pads J3 (+ to 1, - to 2).",
  tags: ["harness", "power", "component-leads"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_cell", name: "Cell end (the leads leave the PCM)", connector: "integral", pins: ["+", "-"], note: "The leads are the cell's own." }),
    Connector({ id: "end_board", name: "Soldered end (J3)", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_cell", "end_board")],
  traits: [
    { type: "performance", params: { kind: "cable", length_mm: BATTERY_LEAD_MM, conductors: 2, wire_gauge_awg: 30, length_basis: "as supplied (50 +- 3 mm); cut to the routed length once the cell has its place", supplied_length_mm: 50, source: LIPOL } },
    { type: "usage_note", params: { note: "The cell's own leads: strip 1.5 mm, tin, and solder + (red) to J3 pad 1 and - (black) to pad 2. Never let the bare ends touch: the cell's PCM trips at 1-2.5 A, but a short still heats the leads.", included_with: "lipol-lp402030", source: LIPOL } },
    { type: "cable_build", params: { colors: ["red", "black"], bundle: "parallel", od_mm: 1.1, spacing_mm: 2.2, note: "Two AWG30 UL1007 leads side by side, as they leave the PCM.", source: LIPOL } },
    { type: "assumption", params: { field: "lead insulation diameter", value: "1.1 mm", reason: "LiPol states AWG30 UL1007 only; UL1007 30 AWG tables give 1.09-1.13 mm (parts/evidence/lipol-lp402030/sources.json)." } },
  ],
});

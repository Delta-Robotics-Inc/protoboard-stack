/**
 * Harnesses of the wearable watch (PB-829, PB-830): the physical carriers of
 * the system's links. Each is `kind: "harness"`.
 *
 *   watch-battery-leads     the cell's own AWG30 leads, cut to length and
 *                           soldered to the board's rear-face pads (J3)
 *   watch-lra-leads         the LRA's own leads, soldered to the board's
 *                           top-face pads (J4)
 *   watch-back-cover-screws the four M2 screws and heat-set inserts that hold
 *                           the back cover (the case's back_joint)
 *
 * Cables follow the quadcopter's pattern (PB-805): each end is a connector
 * composite, the conductors are an internal link, and the system links the
 * ends to link-scoped compositions of the parts' leads and the board's pads,
 * so UHD derives the power links through them. Their routed geometry comes
 * from @protoboardai/ext-harness-cad (`routed()`, src/harnesses/<id>/).
 *
 * Sources: LiPol LP402030 drawing FD_2030_40 (leads AWG30 UL1007, red +,
 * black -, 50 +-3 mm); Vybronics VG0832012 datasheet §7 (leads + red,
 * - blue); third-party UL1007 30 AWG tables for the insulation diameter
 * (parts/evidence/lipol-lp402030/sources.json).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/**
 * Installed lengths (mm), from the end of each part's lead stub to its pad: the shortest clear route
 * harness-cad reports (about 6.0 mm cell, 4.3 mm LRA) plus slack it lays out clear of the parts at the
 * 2.5 mm minimum bend radius. Longer leads no longer fit the cavity at that radius (cad:generate reports
 * "not clear" from 8 mm for the cell and 8 mm for the LRA). Each is cut 1.5 mm longer for the stripped end.
 *   - cell: 7.5 mm. Soldered with the cell lying beside the board's +y edge (PCM end towards J3, up to about
 *     3 mm past the edge), then folded under the board's rear face; the slack takes up the fold (D-W7).
 *   - LRA: 6 mm, cut from the supplied 10 mm. Soldered with the LRA lying on the board's free region, then
 *     bonded to the back cover as the cover closes.
 */
export const BATTERY_LEAD_MM = 7.5;
export const LRA_LEAD_MM = 6;

const LIPOL = "https://www.li-polymer-battery.com/wp-content/uploads/2021/06/LP402030-Datasheet.pdf";
const VYBRONICS = "https://vybronics.hk/wp-content/uploads/datasheet-files/Vybronics-VG0832012-datasheet.pdf";

const wires = (a: string, b: string): InterfaceLink => ({ id: "wires", name: "Conductors", a: { self: true, interfaceId: a }, b: { self: true, interfaceId: b } });

export const WATCH_BATTERY_LEADS: ModuleDef = routed({
  id: "watch-battery-leads",
  name: "Cell leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "LiPol Battery Co.",
  description: "The LP402030's two AWG30 UL1007 leads (red +, black -), cut from the supplied 50 mm to 9 mm (7.5 mm installed, 1.5 mm stripped) and soldered to the board's rear-face pads J3 (+ to 1, - to 2) with the cell beside the board, then folded under it.",
  tags: ["harness", "power", "component-leads"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_cell", name: "Cell end (the leads leave the PCM)", connector: "integral", pins: ["+", "-"], note: "The leads are the cell's own." }),
    Connector({ id: "end_board", name: "Soldered end (J3)", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_cell", "end_board")],
  traits: [
    { type: "performance", params: { kind: "cable", length_mm: BATTERY_LEAD_MM, conductors: 2, wire_gauge_awg: 30, length_basis: "PCM end face to J3: the shortest route (about 6 mm) plus 1.5 mm slack for the fold; cut from the supplied 50 mm", supplied_length_mm: 50, source: LIPOL } },
    { type: "usage_note", params: { note: "The cell's own leads: cut to 9 mm, strip 1.5 mm, tin, and solder + (red) to J3 pad 1 and - (black) to pad 2 with the cell lying beside the board's +y edge, then fold the cell under the board's rear face. Never let the bare ends touch: the cell's PCM trips at 1-2.5 A, but a short still heats the leads.", included_with: "lipol-lp402030", source: LIPOL } },
    { type: "cable_build", params: { colors: ["red", "black"], bundle: "parallel", od_mm: 1.1, spacing_mm: 2.2, note: "Two AWG30 UL1007 leads side by side, as they leave the PCM.", source: LIPOL } },
    { type: "assumption", params: { field: "lead insulation diameter", value: "1.1 mm", reason: "LiPol states AWG30 UL1007 only; UL1007 30 AWG tables give 1.09-1.13 mm (parts/evidence/lipol-lp402030/sources.json)." } },
  ],
});

export const WATCH_LRA_LEADS: ModuleDef = routed({
  id: "watch-lra-leads",
  name: "LRA leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "Vybronics",
  description: "The VG0832012's two wire leads (+ red, - blue), cut from the supplied 10 mm to 7.5 mm (6 mm installed, 1.5 mm stripped) and soldered to the board's pads J4 (+ to 1, - to 2).",
  tags: ["harness", "actuator", "component-leads"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_lra", name: "LRA end (the leads leave the can)", connector: "integral", pins: ["+", "-"], note: "The leads are the LRA's own." }),
    Connector({ id: "end_board", name: "Soldered end (J4)", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_lra", "end_board")],
  traits: [
    { type: "performance", params: { kind: "cable", length_mm: LRA_LEAD_MM, conductors: 2, length_basis: "lead tab to J4: the route (about 4.3 mm) plus slack for soldering before the LRA is bonded to the back cover; cut from the supplied 10 +- 2 mm", source: VYBRONICS } },
    { type: "usage_note", params: { note: "The LRA's own leads: solder + (red) to J4 pad 1 and - (blue) to pad 2. The LRA is bonded to the back cover with its can face (the Z-axis vibration couples into the wrist).", included_with: "vybronics-vg0832012", source: VYBRONICS } },
    { type: "cable_build", params: { colors: ["red", "blue"], bundle: "parallel", od_mm: 0.6, spacing_mm: 1.15, note: "Two fine leads side by side.", source: VYBRONICS } },
    { type: "assumption", params: { field: "lead diameter", value: "0.6 mm", reason: "Vybronics states no wire gauge; the part's CAD draws the leads at about this size." } },
  ],
});

/** Screw positions in the back_joint frame (mm): the four column centres ±17.084 mm from the cavity centre. */
const BACK_JOINT_HOLES: [number, number][] = [
  [17.084, 17.084],
  [-17.084, 17.084],
  [-17.084, -17.084],
  [17.084, -17.084],
];

/** The back cover's fasteners: four M2 x 6 pan-head screws into ruthex M2 inserts in the case's screw columns. */
export const WATCH_BACK_COVER_SCREWS: ModuleDef = {
  id: "watch-back-cover-screws",
  name: "Back cover screws",
  kind: "harness",
  topology: "bus",
  description: "Four Accu SPP-M2-6-A2 pan-head screws through the back cover into four ruthex RX-M2x4 heat-set inserts pressed into the case's screw columns (the case's back_joint).",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [
    { id: "screws", moduleDefId: "iso-7045-m2x6-a2", name: "M2 x 6 pan-head screw", quantity: 4 },
    { id: "inserts", moduleDefId: "ruthex-rx-m2x4", name: "M2 heat-set insert", quantity: 4 },
  ],
  interfaces: [],
  // From the joint face (the case's back_joint frame: the split plane, normal towards the back cover): the
  // inserts flush with the face, going down into the base's columns; each screw's head on the 1.3 mm back cover,
  // its shank down through the cover into the insert. Hole positions: the columns the case provider reports
  // (build123d/watch-case.report.json, features.back_joint.columns), relative to the frame's origin.
  fastenerStack: [
    { child: "inserts", atMm: 0, direction: -1, positions: BACK_JOINT_HOLES },
    {
      child: "screws",
      atMm: 1.3,
      direction: -1,
      positions: BACK_JOINT_HOLES,
      torque: {
        torqueNm: 0.1,
        assumption:
          "Snug by hand. Neither ruthex (RX-M2x4) nor Accu (SPP-M2-6-A2) states a torque into a heat-set insert in printed PETG; 0.1 N·m keeps well under what would turn the insert in the plastic. Confirm on a printed case before the first build.",
      },
    },
  ],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "Press the inserts into the case columns with a soldering iron and insert tip (about 220 °C for PETG, ruthex's guidance), flush with the joint face; then close the back cover with the screws. The case provider sizes the columns, insert holes and screw reach from these parts (enclosure-cad report, back_joint).",
        torque: "hand tight: no maker states a torque into a heat-set insert in printed PETG (assumption)",
      },
    },
  ],
};

export const HARNESSES = [WATCH_BATTERY_LEADS, WATCH_LRA_LEADS, WATCH_BACK_COVER_SCREWS];

/**
 * GCT USB4105-GF-A USB Type-C receptacle for USB 2.0, SMT, PCB top mount
 * (gold flash, tape and reel, 0.95 mm shell stakes) — datasheet-honest UHD part.
 *
 * Sources (see ./gct-usb4105-gf-a/sources.json):
 *   - src_drawing: GCT USB4105 drawing rev B4 (18/12/23) — https://gct.co/files/drawings/usb4105.pdf
 *   - src_spec:    GCT USB4105 product specification rev A3 (27/02/23) — https://gct.co/files/specs/usb4105-spec.pdf
 *   - src_lcsc:    LCSC C3020560 product page (distributor: unit weight, lifecycle) —
 *                  https://www.lcsc.com/product-detail/C3020560.html
 *   - src_jlc:     JLCPCB catalog through jlcsearch (distributor: stock) —
 *                  https://jlcsearch.tscircuit.com/components/list.json?search=USB4105-GF-A
 *   - src_product: GCT product page (Cloudflare 403; not read) — https://gct.co/connector/usb4105
 *
 * Modelling notes:
 *   - Variant: USB4105 + GF (gold flash, standard) + A (tape and reel) + no
 *     suffix (shell stake length S = 0.95 mm), from the drawing's ordering
 *     grid. USB4105-GF-A-060 (0.60 mm) and -120 (1.20 mm) stakes and the 15 /
 *     30 u" gold platings are different parts and are not merged.
 *   - Leaves: one per contact, from the drawing's pin table: the 16 USB 2.0
 *     contacts (`pin_a1` .. `pin_b12`, designators A1 .. B12 as GCT prints
 *     them) plus `shell` (designator SHELL, the four stakes), which the pin
 *     table lists as GND. A connector contact neither sources nor sinks, so
 *     VBUS, CC and SBU contacts are `passive` terminals (capabilities
 *     `usb_vbus`, `usb_cc`, `usb_sbu`); D+/D- contacts also carry the `usb`
 *     protocol (capabilities `usb_dp` / `usb_dm`) as the Raytac module's USB
 *     pads do; GND contacts and the shell are `ground`. The board that uses
 *     J1 joins A4/A9/B4/B9, A6/B6, A7/B7 and the GND contacts on its nets.
 *   - Contact pairs A1/B12, A4/B9, B4/A9 and B1/A12 have separate tails
 *     (16x 0.20) in one 0.45 mm group each; GND and VBUS currents are rated
 *     collectively over their four contacts (§4.1), so the ratings are on the
 *     module (operating_conditions) and in each contact's usage note, not as
 *     per-pin `max_current` parameters.
 *   - `usb_c` is the receptacle as a connector composite: 24 positions in
 *     USB Type-C order A1..A12, B1..B12. The positions the pin table does
 *     not list (A2, A3, A10, A11, B2, B3, B10, B11) have no contact on this
 *     part and are unbound. A plug mates either way up (the specification's
 *     durability test rotates it 180°, §8 Group A-7), so the frame has
 *     symmetryDeg 180. The shell is not a numbered position; its plug-shell
 *     contact is the `shell` leaf.
 *   - Joining A6 with B6 and A7 with B7 on the board is an `assumption`
 *     trait (USB Type-C practice; GCT's sources only give the pin table).
 *   - No functional `usb` composite: the receptacle only passes conductors
 *     through. The USB function belongs to the nRF52840 (`usb`), and the
 *     board's nets join the two.
 *   - `pcb_mount` is the solder side: 16 tails, 4 shell stakes through the
 *     board and 2 locating pegs. The recommended PCB layout on the drawing
 *     (pad, slot and hole sizes) is land-pattern data and is not recorded.
 *   - Package: GCT names no package; `name` is the product series and the
 *     count is 17 terminals (16 contacts + SHELL) (package `assumption`).
 *   - Mass 0.68 g is LCSC's unit weight; GCT states none.
 *   - Contact count 16 (GCT) vs "12P" (LCSC, JLCPCB): `source_discrepancy`.
 *   - Geometry: generated from the drawing (no usable manufacturer CAD;
 *     `data_gap`), library/cad/py/catalog/gct-usb4105-gf-a.py. Shell wall,
 *     cavity, tongue, stake thickness and tail foot are not dimensioned and
 *     are an `assumption` trait.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { Connector, defineModule, pinTable } from "@deltarobotics/uhd";
import type { PinRow } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  drawing: "https://gct.co/files/drawings/usb4105.pdf",
  spec: "https://gct.co/files/specs/usb4105-spec.pdf",
  lcsc: "https://www.lcsc.com/product-detail/C3020560.html",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=USB4105-GF-A",
  product: "https://gct.co/connector/usb4105",
} as const;

const PIN_TABLE = `${SRC.drawing} (sheet 1 pin table: Pin, Signal, Mating Sequence)`;

const note = (text: string, source: string | string[]): TraitDef => ({ type: "usage_note", params: { note: text, source } });

const RATING_VBUS = note("VBUS contact: 5.00 A collectively for the VBUS pins A4, A9, B4 and B9 (not per pin); 48 V DC. Tie all four to the board's VBUS net.", `${SRC.spec} (§4.1, §4.2)`);
const RATING_GND = note("GND contact: 6.25 A collectively for the GND pins A1, A12, B1 and B12 (not per pin). Tie all four and the shell to ground.", `${SRC.spec} (§4.1)`);
const RATING_CC = note("CC contact (the specification calls A5/B5 VCONN): 1.25 A. The CC termination the board needs is set by the USB Type-C specification, which this part's sources do not cover.", `${SRC.spec} (§4.1)`);
const RATING_SIGNAL = note("0.25 A per pin.", `${SRC.spec} (§4.1)`);

type Row = [pin: string, name: string, kind: "gnd" | "vbus" | "cc" | "dp" | "dm" | "sbu", sequence: "First" | "Second"];

// Drawing pin table, A side then B side, as printed
const ROWS: Row[] = [
  ["A1", "GND", "gnd", "First"],
  ["A4", "VBUS", "vbus", "First"],
  ["A5", "CC1", "cc", "Second"],
  ["A6", "Dp1", "dp", "Second"],
  ["A7", "Dn1", "dm", "Second"],
  ["A8", "SBU1", "sbu", "Second"],
  ["A9", "VBUS", "vbus", "First"],
  ["A12", "GND", "gnd", "First"],
  ["B12", "GND", "gnd", "First"],
  ["B9", "VBUS", "vbus", "First"],
  ["B8", "SBU2", "sbu", "Second"],
  ["B7", "Dn2", "dm", "Second"],
  ["B6", "Dp2", "dp", "Second"],
  ["B5", "CC2", "cc", "Second"],
  ["B4", "VBUS", "vbus", "First"],
  ["B1", "GND", "gnd", "First"],
];

function row([pin, name, kind, sequence]: Row): PinRow {
  const base = { pin, name, id: `pin_${pin.toLowerCase()}`, description: `${pin}: ${name}, mating sequence ${sequence}` };
  switch (kind) {
    case "gnd":
      return { ...base, type: "ground", traits: [RATING_GND] };
    case "vbus":
      return { ...base, type: "passive", capabilities: ["usb_vbus"], traits: [RATING_VBUS] };
    case "cc":
      return { ...base, type: "passive", capabilities: ["usb_cc"], traits: [RATING_CC] };
    case "sbu":
      return { ...base, type: "passive", capabilities: ["usb_sbu"], traits: [RATING_SIGNAL, note("Sideband use contact (SBU1 A8, SBU2 B8 in the pin table); no USB 2.0 function is assigned to it in this part's sources.", PIN_TABLE)] };
    case "dp":
    case "dm":
      return {
        ...base,
        type: "passive",
        capabilities: [kind === "dp" ? "usb_dp" : "usb_dm"],
        protocols: [{ type: "usb", roles: ["bidirectional"] }],
        traits: [RATING_SIGNAL, note(`USB 2.0 ${kind === "dp" ? "D+" : "D-"}, one contact on each side (${kind === "dp" ? "Dp1 A6, Dp2 B6" : "Dn1 A7, Dn2 B7"}). The plug mates either way up (the durability test rotates it 180°); see the module's "D+/D- contacts on both sides" assumption.`, [PIN_TABLE, `${SRC.spec} (§8 Group A-7, durability with 180° rotation)`])],
      };
  }
}

const pins = pinTable(
  [
    ...ROWS.map(row),
    {
      pin: "SHELL",
      name: "SHELL",
      id: "shell",
      type: "ground",
      description: "SHELL: GND",
      traits: [note("Stainless steel shell, nickel plated; four stakes through the board (S = 0.95 ±0.15 mm below the seating plane for the blank stake suffix). The pin table assigns it to GND.", `${SRC.drawing} (pin table, Material, Plating, side view, ordering grid)`)],
    },
  ],
  { source: PIN_TABLE },
);

const pin = (p: string) => `pin_${p.toLowerCase()}`;
const USED = new Set(ROWS.map(([p]) => p));
const POSITIONS = [..."AB"].flatMap((side) => Array.from({ length: 12 }, (_, i) => `${side}${i + 1}`));

const usbC: InterfaceDef = Connector({
  id: "usb_c",
  name: "USB Type-C receptacle (USB 2.0)",
  connector: "usb_c",
  gender: "receptacle",
  pins: POSITIONS.map((p) => (USED.has(p) ? [p, pin(p)] : [p])),
  note: "USB Type-C positions A1-A12, B1-B12; the drawing's pin table has only the 16 USB 2.0 contacts, so A2, A3, A10, A11, B2, B3, B10 and B11 are unused. GND and VBUS mate first, CC, D and SBU second. Mating force 5-20 N, unmating 8-20 N (6-20 N after 20,000 cycles), 20,000 cycles. Opening 8.34 (+0.06/-0.02) x 2.56 ±0.04 mm on an axis 1.73 mm above the board. Sources: GCT drawing USB4105 rev B4 (pin table, front and side views), GCT specification rev A3 §6.2.",
  traits: [
    note(
      "Case opening: a mated plug's overmold is at most 6.5 mm high and stays at least 1.85 mm in front of the receptacle face, so a wall in front of J1 thicker than that keeps the plug from seating fully when the receptacle face is flush with the wall's inside.",
      `${SRC.drawing} (Plug and Receptacle Mating View)`,
    ),
  ],
});

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "Solder tails, shell stakes and locating pegs (SMT, top mount)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount", "board_edge"],
  traits: [
    note(
      "16 surface-mount tails 0.20 mm wide at 0.50 mm pitch (4 pairs in 0.45 mm groups, 6.40 mm outer span) ending 0.38 mm behind the body; 4 shell stakes on 8.64 mm through the board, front pair 2.60 mm behind the mating face, rear pair 4.18 mm further back, 0.80 / 1.10 mm wide; 2 plastic locating pegs Ø0.50 mm on 5.78 mm, 3.68 mm behind the front stakes, 0.60 mm below the seating plane. Coplanarity 0.10 mm. Mount with the mating face at the board edge (the drawing's layout shows the PCB edge under the front).",
      `${SRC.drawing} (bottom, side, front and rear views; recommended PCB layout)`,
    ),
    note("Lead-free reflow: peak 255 C (-0/+5), 60 s above 217 C, 50 s above 230 C, 5 s above 250 C, soak 2-3 min, ramp 2.5 C/s, cooling 5 C/s max.", `${SRC.spec} (§7.0)`),
  ],
};

const GCT_USB4105_GF_A_BASE: ModuleDef = defineModule({
  id: "gct-usb4105-gf-a",
  name: "GCT USB4105-GF-A USB-C receptacle (USB 2.0, top mount)",
  version: "1.0.0",
  manufacturer: "GCT",
  part_number: "USB4105-GF-A",
  description:
    "GCT USB4105 USB Type-C receptacle for USB 2.0, SMT, PCB top mount, horizontal: 16 contacts (GND, VBUS, CC1/CC2, D+/D- on both sides, SBU1/SBU2) plus a grounded stainless steel shell with four through-board stakes. VBUS 5 A and GND 6.25 A collectively, 48 V DC, 240 W, 20,000 mating cycles, -40 to 85 C. Gold flash contacts, tape and reel, 0.95 mm stakes. 8.94 x 7.35 x 3.31 mm.",
  tags: ["usb4105", "gct", "usb-c", "type-c", "usb-2.0", "receptacle", "connector", "smt", "top-mount"],
  categories: ["connector.usb"],

  interfaces: [...pins, usbC, pcbMount],

  domains: [
    {
      domain: "electrical",
      metadata: {
        current_rating_A: { vbus_collective: 5.0, gnd_collective: 6.25, vconn_a5_b5: 1.25, other_per_pin: 0.25 },
        voltage_rating_V_dc: 48,
        power_rating_W: 240,
        contact_resistance_mOhm: { initial_max: 40, after_test_max: 50 },
        dielectric_withstanding_V_ac: 100,
        insulation_resistance_MOhm_min: 100,
        temperature_rise_C_max: 30,
        source: `${SRC.spec} (§4, §6.1); ${SRC.drawing} (Electrical)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 7.73, width: 8.94, height: 3.31 },
      weight_g: 0.68,
      package: {
        name: "USB4105 (USB Type-C receptacle, USB 2.0, SMT top mount)",
        code: "GCT drawing USB4105 rev B4",
        pin_count: 17,
        pitch_mm: 0.5,
        exposed_pad: false,
        source: `${SRC.drawing} (pin table; top, side, front and bottom views)`,
        assumption: "GCT names no package; the name is the product series. pin_count counts the 16 contacts plus SHELL, which the pin table lists as a terminal (four stakes).",
      },
      metadata: {
        body_mm: "8.94 wide x 7.35 deep x 3.31 high above the seating plane; tails 0.38 behind the body (7.73 overall depth)",
        below_seating_plane_mm: { shell_stakes: 0.95, locating_pegs: 0.6 },
        mating_axis_height_mm: 1.73,
        opening_mm: { width: 8.34, height: 2.56 },
        mated_plug_envelope_mm: { overmold_height_max: 6.5, overmold_to_receptacle_face_min: 1.85 },
        material: { insulator: "LCP, UL 94V-0, black", contacts: "copper alloy", shell: "stainless steel", mid_plate: "stainless steel" },
        plating: { contact_area: "gold flash (GF)", solder_tails: "gold flash", underplating: "50 u\" min nickel all over", shell: "30 u\" min nickel" },
        mounting_method: "surface_mount, top mount, horizontal; shell stakes through the board",
        packaging: "tape and reel, 800 pcs per reel, 24.0 mm tape",
        weight_source: "LCSC unit weight (distributor); GCT states no mass",
        source: `${SRC.drawing}; ${SRC.lcsc}`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: { thermal_shock_test_C: [-55, 85], source: `${SRC.spec} (§4.4, §6.3.3)` },
    },
  ],

  traits: [
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-40, 85],
        voltage_rating_V_dc: 48,
        power_rating_W: 240,
        current_rating_A: { vbus_A4_A9_B4_B9_collective: 5.0, gnd_A1_A12_B1_B12_collective: 6.25, vconn_A5_B5: 1.25, other_per_pin: 0.25 },
        source: [`${SRC.spec} (§4)`, `${SRC.drawing} (Electrical; Mechanical & Environmental)`],
      },
    },
    {
      type: "performance",
      params: {
        kind: "connector",
        standard: "USB Type-C receptacle, USB 2.0 contacts only",
        durability_cycles: 20000,
        mating_force_N: [5, 20],
        unmating_force_N: { initial: [8, 20], after_20000_cycles: [6, 20] },
        contact_resistance_mOhm_max: { initial: 40, after_test: 50 },
        mating_sequence: { first: ["GND", "VBUS"], second: ["CC", "D+/D-", "SBU"] },
        source: [`${SRC.spec} (§6.1, §6.2)`, `${SRC.drawing} (pin table; Mechanical & Environmental)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Ordering code USB4105-XX-A-XXX: XX = contact plating (GF gold flash, standard; 15 or 30 u\" gold); A = tape and reel; XXX = shell stake length (blank 0.95 mm, 060 0.60 mm, 120 1.20 mm). This part is the blank (0.95 mm) stake. JLCPCB stocks the -060 and -120 variants as separate parts.",
        source: [`${SRC.drawing} (Ordering Grid)`, SRC.jlc],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "lifecycle",
        note: "GCT's product page could not be read (Cloudflare challenge). LCSC lists C3020560 with product cycle \"normal\"; JLCPCB had 11,505 in stock on 2026-10-03.",
        source: [SRC.lcsc, SRC.jlc, SRC.product],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "contact count",
        values: ["16 contacts (pin table; 16x 0.20 tails)", "12P"],
        sources: [SRC.drawing, SRC.lcsc, SRC.jlc],
        resolution: "Manufacturer: 16 contacts, each a leaf. The distributors count the 12 tail groups: A1/B12, A4/B9, B4/A9 and B1/A12 each share a 0.45 mm group.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "mass",
        note: "GCT's drawing and specification state no mass; weight_g is LCSC's unit weight (0.68 g).",
        source: [SRC.drawing, SRC.spec, SRC.lcsc],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "GCT links its 3D models from its product page, which answers every fetch with a Cloudflare challenge (HTTP 403), as do guessed STEP paths under gct.co/files/. SnapEDA and Ultra Librarian need a login and forbid redistribution. The community KiCad model is CC-BY-SA 4.0 and would bring share-alike terms into this library; not used. Geometry is generated from drawing USB4105 rev B4 (library/cad/py/catalog/gct-usb4105-gf-a.py).",
        source: [SRC.product, SRC.drawing, "https://www.kicad.org/libraries/license/"],
      },
    },
    {
      type: "assumption",
      params: {
        field: "D+/D- contacts on both sides",
        value: "the board joins A6 (Dp1) with B6 (Dp2) and A7 (Dn1) with B7 (Dn2)",
        reason: "The pin table gives a D+ and a D- contact on each side and the specification rotates the plug 180° in its durability test, but neither GCT source says how a USB 2.0 board wires them. Joining the pairs, so either plug orientation reaches the USB device, is USB Type-C practice and is not cited here.",
        source: [PIN_TABLE, `${SRC.spec} (§8 Group A-7)`],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD shell and internals",
        value: "outer shell a stadium 8.94 x 3.16 mm (0.30 mm wall around the 8.34 x 2.56 opening, bottom 0.15 mm above the seating plane) over the full 7.35 mm depth; cavity 4.85 mm deep; tongue 6.78 x 0.70 mm from 0.30 mm behind the face; stakes 0.30 mm thick centred on the 8.64 mm line; tail feet 0.75 mm long x 0.10 mm thick, pair tails 0.05 mm apart in their 0.45 mm group",
        reason: "The drawing dimensions the outline (8.94 x 7.35 x 3.31), axis height (1.73), opening, stake and peg positions and tail positions, but not the shell wall, cavity depth, tongue, stake thickness or tail foot; the representative model needs single values, scaled from the drawing's views.",
        source: SRC.drawing,
      },
    },
  ],

  artifacts: [
    { id: "art_drawing", name: "GCT USB4105 drawing rev B4", type: "datasheet", url: SRC.drawing },
    { id: "art_spec", name: "GCT USB4105 product specification rev A3", type: "datasheet", url: SRC.spec },
    { id: "art_lcsc", name: "LCSC C3020560 product page", type: "documentation", url: SRC.lcsc },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from drawing USB4105 rev B4. X across (A1/B12 tails at
// -X), Y from the mating face (Y = 0) to the rear, Z up from the seating plane.
// ---------------------------------------------------------------------------

const TAIL_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_a1: feature("pin_a1", { area_mm2: 0.15, centroid: [-3.325, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b12: feature("pin_b12", { area_mm2: 0.15, centroid: [-3.075, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a4: feature("pin_a4", { area_mm2: 0.15, centroid: [-2.525, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b9: feature("pin_b9", { area_mm2: 0.15, centroid: [-2.275, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b8: feature("pin_b8", { area_mm2: 0.15, centroid: [-1.75, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a5: feature("pin_a5", { area_mm2: 0.15, centroid: [-1.25, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b7: feature("pin_b7", { area_mm2: 0.15, centroid: [-0.75, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a6: feature("pin_a6", { area_mm2: 0.15, centroid: [-0.25, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a7: feature("pin_a7", { area_mm2: 0.15, centroid: [0.25, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b6: feature("pin_b6", { area_mm2: 0.15, centroid: [0.75, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a8: feature("pin_a8", { area_mm2: 0.15, centroid: [1.25, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b5: feature("pin_b5", { area_mm2: 0.15, centroid: [1.75, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b4: feature("pin_b4", { area_mm2: 0.15, centroid: [2.275, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a9: feature("pin_a9", { area_mm2: 0.15, centroid: [2.525, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b1: feature("pin_b1", { area_mm2: 0.15, centroid: [3.075, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a12: feature("pin_a12", { area_mm2: 0.15, centroid: [3.325, 7.355, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const GCT_USB4105_GF_A: ModuleDef = withGeometry(
  GCT_USB4105_GF_A_BASE,
  {
    ...Object.fromEntries(Object.entries(TAIL_FEATURES).map(([id, ref]) => [id, { refs: [ref, own(id)] }])),
    shell: { refs: [feature("shell", { area_mm2: 1.14, centroid: [0.0, 5.02, -0.95], normal: [0.0, 0.0, -1.0] }), own("shell")] },
    // a plug enters here: frame on the mating axis at the face, normal out of the opening;
    // the plug fits either way up
    usb_c: {
      frame: { origin: [0, 0, 1.73], normal: [0, -1, 0], xAxis: [1, 0, 0], symmetryDeg: 180 },
      refs: [feature("usb_c", { area_mm2: 6.163, centroid: [0.0, 0.0, 1.73], normal: [0.0, -1.0, 0.0] }), own("usb_c")],
    },
    // onto the board: frame on the seating plane under the body centre, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 3.675, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [
        feature("pcb_mount", { area_mm2: 3.54, centroid: [0.0, 6.603, -0.306], normal: [0.0, 0.0, -1.0] }),
        feature("locating_pegs", { area_mm2: 2.827, centroid: [0.0, 6.28, -0.15] }),
        own("pcb_mount"),
      ],
    },
  },
  cadArtifacts({
    dir: "library/parts/gct-usb4105-gf-a/artifacts/cad",
    name: "gct-usb4105",
    generator: "library/cad/py/catalog/gct-usb4105-gf-a.py",
    tool: "build123d 0.13.0",
    interfaces: ["usb_c", "pcb_mount", "shell", ...Object.keys(TAIL_FEATURES)],
  }),
);

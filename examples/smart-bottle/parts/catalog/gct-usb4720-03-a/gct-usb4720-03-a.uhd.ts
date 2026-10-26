/**
 * GCT USB4720-03-A USB Type-C receptacle for USB 2.0, SMT, mid-mount
 * horizontal, IP67 with a pre-fitted LIM gasket (3 u" gold, tape and reel) —
 * datasheet-honest UHD part.
 *
 * Sources (see ./gct-usb4720-03-a/sources.json):
 *   - src_drawing:      GCT USB4720 drawing rev B (02/01/25) — https://gct.co/files/drawings/usb4720.pdf
 *   - src_spec:         GCT USB4720 product specification rev A2 (12/02/26) — https://gct.co/files/specs/usb4720-spec.pdf
 *   - src_dk_highlight: DigiKey product highlight, USB4720 / USB4730 (distributor: grounding tags, LIM gasket) —
 *                       https://www.digikey.se/en/product-highlight/g/gct/usb4720-and-usb4730-ip67-usb-type-c-connectors-for-usb-2-0
 *   - src_rutronik:     Rutronik24 USB4720-03-A (distributor: lead time, reel) —
 *                       https://www.rutronik24.com/product/gct/usb472003a/25198718.html
 *   - src_jlc:          JLCPCB catalog through jlcsearch (distributor: not stocked) —
 *                       https://jlcsearch.tscircuit.com/components/list.json?search=USB4720
 *   - src_product:      GCT product page (Cloudflare 403; not read) — https://gct.co/connector/usb4720
 *
 * Modelling notes:
 *   - Variant: USB4720 + 03 (3 u" gold contact area) + A (tape and reel, 1300
 *     per reel), the only code in the drawing's ordering grid. USB4730 (top
 *     mount, separate gasket) and USB4715 (power only) are different parts.
 *   - Leaves: one per contact, from the drawing's pin table: the 16 USB 2.0
 *     contacts (`pin_a1` .. `pin_b12`, designators A1 .. B12 as GCT prints
 *     them) plus `shell` (designator SHELL, the four stake legs; the pin table
 *     lists it as GND) and `ground_tags` (the two grounding tags, which GCT ties
 *     to the mid-plate and to A1/B12/A12/B1). The pin table does not number the
 *     tags, so their designator TAG is ours (`assumption`). As on
 *     gct-usb4105-gf-a, VBUS, CC and SBU contacts are `passive` terminals
 *     (capabilities `usb_vbus`, `usb_cc`, `usb_sbu`), D+/D- contacts also carry
 *     the `usb` protocol, and GND contacts, the shell and the tags are `ground`.
 *   - The GND and VBUS currents are rated collectively (drawing Electrical,
 *     spec §4.1), so the ratings are module-level (`operating_conditions`) and
 *     in each contact's usage note, not per-pin `max_current` parameters. The
 *     spec names only A9/B9 and A12/B12 in §4.1: `source_discrepancy`.
 *   - `usb_c` is the receptacle as a connector composite: 24 positions in
 *     USB Type-C order A1..A12, B1..B12; A2, A3, A10, A11, B2, B3, B10 and B11
 *     have no contact and are unbound. The plug mates either way up (the
 *     spec's durability test rotates it 180°, §9 Group A-7), so the frame has
 *     symmetryDeg 180.
 *   - `pcb_mount` is the solder side. Mid-mount: the body drops into a board
 *     cut-out at the PCB edge (recommended board 0.6 ±0.10 mm), the 16 tails
 *     land on the board's top surface, four stake legs and two grounding tags
 *     go through it. The recommended PCB layout's pad, slot and hole sizes are
 *     land-pattern data and are not recorded.
 *   - `panel_seal` is the LIM gasket's front face, which seals against the
 *     inside of the enclosure wall around the plug opening; the drawing's
 *     recommended panel spec is in its usage note. The bottle cap's USB
 *     opening (OQ-B4) mates here. No seal protocol exists: `custom` (peer),
 *     logged in gaps.json (vocabulary).
 *   - IP67 is GCT's rating for the receptacle mounted in the specified
 *     enclosure (spec §6.3.8), mated or unmated (DigiKey highlight); the
 *     project's housing still has to meet the panel spec.
 *   - Package: GCT names no package; `name` is the product series and the
 *     count is 18 terminals (16 contacts + SHELL + TAG) (package `assumption`).
 *   - No mass: GCT and Rutronik give none (data_gap).
 *   - Geometry: generated from the drawing (no usable manufacturer CAD;
 *     `data_gap`), library/cad/py/catalog/gct-usb4720-03-a.py. Shell wall,
 *     gasket thickness and placement, cavity, wings, tails and tag length are
 *     an `assumption` trait.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { Connector, defineModule, pinTable } from "@deltarobotics/uhd";
import type { PinRow } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  drawing: "https://gct.co/files/drawings/usb4720.pdf",
  spec: "https://gct.co/files/specs/usb4720-spec.pdf",
  dkHighlight: "https://www.digikey.se/en/product-highlight/g/gct/usb4720-and-usb4730-ip67-usb-type-c-connectors-for-usb-2-0",
  rutronik: "https://www.rutronik24.com/product/gct/usb472003a/25198718.html",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=USB4720",
  product: "https://gct.co/connector/usb4720",
} as const;

const PIN_TABLE = `${SRC.drawing} (sheet 1 pin table: Pin, Signal, Mating Sequence)`;

const note = (text: string, source: string | string[]): TraitDef => ({ type: "usage_note", params: { note: text, source } });

const RATING_VBUS = note("VBUS contact: 5.00 A collectively for the VBUS pins A4, A9, B4 and B9 (not per pin); 48 V DC. Tie all four to the board's VBUS net.", [`${SRC.drawing} (Electrical)`, `${SRC.spec} (§4.1, §4.2)`]);
const RATING_GND = note("GND contact: 6.25 A collectively for the GND pins A1, A12, B1 and B12 (not per pin). Tie all four, the shell and the grounding tags to ground.", [`${SRC.drawing} (Electrical)`, `${SRC.spec} (§4.1)`]);
const RATING_CC = note("CC contact (the specification calls A5/B5 VCONN): 1.25 A. The CC termination the board needs is set by the USB Type-C specification, which this part's sources do not cover.", [`${SRC.drawing} (Electrical)`, `${SRC.spec} (§4.1)`]);
const RATING_SIGNAL = note("0.25 A per pin.", `${SRC.drawing} (Electrical)`);

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
        traits: [RATING_SIGNAL, note(`USB 2.0 ${kind === "dp" ? "D+" : "D-"}, one contact on each side (${kind === "dp" ? "Dp1 A6, Dp2 B6" : "Dn1 A7, Dn2 B7"}). The plug mates either way up (the durability test rotates it 180°); see the module's "D+/D- contacts on both sides" assumption.`, [PIN_TABLE, `${SRC.spec} (§9 Group A-7, durability with 180° rotation)`])],
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
      traits: [note("Stainless steel shell, mid plate and EMI plate; four stake legs 0.30 ±0.05 thick and 1.30 long through the board, 0.60 ±0.15 below the tail plane. The pin table assigns SHELL to GND.", `${SRC.drawing} (pin table, Material, front, side and rear views)`)],
    },
    {
      pin: "TAG",
      name: "Grounding tags",
      id: "ground_tags",
      type: "ground",
      description: "TAG: two grounding tags attached to the mid-plate and GND pins A1, B12, A12, B1",
      traits: [
        note("Two independent grounding tags attached to the mid-plate and pins A1, B12, A12 and B1, 8.20 ±0.10 apart on the tail row, 0.30 ±0.03 wide; the recommended PCB layout gives them two Ø0.50 holes with solder area. Designator TAG is this library's label (see the module's grounding-tag assumption).", [`${SRC.dkHighlight} (USB4720 features)`, `${SRC.drawing} (rear view; recommended PCB layout)`]),
      ],
    },
  ],
  { source: PIN_TABLE },
);

const pin = (p: string) => `pin_${p.toLowerCase()}`;
const USED = new Set(ROWS.map(([p]) => p));
const POSITIONS = [..."AB"].flatMap((side) => Array.from({ length: 12 }, (_, i) => `${side}${i + 1}`));

const usbC: InterfaceDef = Connector({
  id: "usb_c",
  name: "USB Type-C receptacle (USB 2.0, IP67)",
  connector: "usb_c",
  gender: "receptacle",
  pins: POSITIONS.map((p) => (USED.has(p) ? [p, pin(p)] : [p])),
  note: "USB Type-C positions A1-A12, B1-B12; the drawing's pin table has only the 16 USB 2.0 contacts, so A2, A3, A10, A11, B2, B3, B10 and B11 are unused. GND and VBUS mate first, CC, D and SBU second. Mating force 5-20 N, unmating 8-20 N (6-20 N after 20,000 cycles), 20,000 cycles. Opening 8.34 (+0.06/-0.02) x 2.56 ±0.04 mm on an axis 0.35 mm (ref) above the tail plane; the tongue stands 0.80 mm in front of the gasket face. Sources: GCT drawing USB4720 rev B (pin table, front, side and top views), GCT specification rev A2 §6.2.",
  traits: [
    note(
      "Case opening: a mated plug's overmold is at most 6.5 mm high and stands 2.2 mm (ref) in front of the panel's outer face when the gasket is against the panel's inside (mating view).",
      `${SRC.drawing} (sheet 2/3, Plug and Receptacle Mating View)`,
    ),
  ],
});

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "Solder tails, stake legs and grounding tags (SMT, mid-mount)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount", "mid_mount", "board_edge"],
  traits: [
    note(
      "Mid-mount at the board edge: the body sits in a cut-out (recommended board thickness 0.6 ±0.10 mm), 2.13 mm above and 1.13 mm (ref) below the tail plane. 16 surface-mount tails: 8 singles 0.25 ±0.05 wide at 0.50 mm pitch and 4 pair groups 0.60 ±0.05 wide (2x 0.85, outer groups 3.275 from the centreline), tail line 0.75 and tips 0.89 behind the body. 4 stake legs 0.30 thick x 1.30 long, 11.30 ±0.15 mm overall width, front pair 2.95 mm behind the tongue tip and rear pair 4.00 mm further back, 0.60 ±0.15 mm below the tail plane. 2 grounding tags 8.20 ±0.10 mm apart on the tail row. Coplanarity 0.10.",
      `${SRC.drawing} (top, bottom, front, side and rear views; recommended PCB layout)`,
    ),
    note("Lead-free reflow: peak 255 C (-0/+5), 60 s above 217 C, 50 s above 230 C, 5 s above 250 C, soak 2-3 min, ramp 2.5 C/s, cooling 5 C/s max.", `${SRC.spec} (§7.0)`),
    note("MSL 6 (non-JEDEC): bake at 60 C, <= 5% RH for 24 h before reflow; GCT warns that air leakage after reflow is affected if floor life and baking are not followed. Store at +5 to +30 C, 40-90% RH.", `${SRC.spec} (§8.1, §8.2)`),
  ],
};

const panelSeal: InterfaceDef = {
  id: "panel_seal",
  name: "LIM gasket face seal against the enclosure wall",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  max_instances: 1,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["panel_face_seal", "ip67"],
  traits: [
    note(
      "Pre-fitted LIM gasket (silicone rubber, Shore 60A), 9.54 wide x 3.75 high, compressed between the receptacle shell and the inside of the enclosure wall (0.20 min and 0.10 min in the drawing's compression view). Recommended panel: plug opening 8.44 ±0.03 x 2.66 ±0.03 mm (end radii R1.05 / R1.39 / R1.65), 10° draft, inside recess 9.14 / 9.64 ±0.03 mm wide and 3.35 / 3.86 ±0.03 mm high with R0.20, steps 0.67 ±0.03 and 0.50 ±0.03 mm, wall 1.80 mm (ref).",
      `${SRC.drawing} (Material; sheet 2/3 Recommended Panel Spec, Gasket compression between panel and shell)`,
    ),
    note(
      "IP67: 100% tested; rated mated or unmated. GCT's waterproof test immerses the receptacle mounted in the specified enclosure at 1 m for 30 minutes (IEC 60529:2013), and a 2 h dust test; the rating holds only for a housing built to the panel spec.",
      [`${SRC.spec} (§6.3.8, §6.3.9)`, `${SRC.dkHighlight} (USB4720 features)`],
    ),
  ],
};

const GCT_USB4720_03_A_BASE: ModuleDef = defineModule({
  id: "gct-usb4720-03-a",
  name: "GCT USB4720-03-A USB-C receptacle (USB 2.0, IP67, mid-mount)",
  version: "1.0.0",
  manufacturer: "GCT",
  part_number: "USB4720-03-A",
  description:
    "GCT USB4720 USB Type-C receptacle for USB 2.0, SMT, mid-mount horizontal, IP67 with a pre-fitted LIM gasket: 16 contacts (GND, VBUS, CC1/CC2, D+/D- on both sides, SBU1/SBU2), a grounded stainless steel shell with four through-board stake legs and two grounding tags. VBUS 5 A and GND 6.25 A collectively, 48 V DC, 240 W, 20,000 mating cycles, -30 to 85 C. 3 u\" gold, tape and reel. 7.60 x 11.30 x 3.75 mm; 2.13 mm above the board.",
  tags: ["usb4720", "gct", "usb-c", "type-c", "usb-2.0", "receptacle", "connector", "smt", "mid-mount", "ip67", "sealed"],
  categories: ["connector.usb"],

  interfaces: [...pins, usbC, pcbMount, panelSeal],

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
      dimensions_mm: { length: 7.6, width: 11.3, height: 3.75 },
      package: {
        name: "USB4720 (USB Type-C receptacle, USB 2.0, SMT mid-mount, IP67)",
        code: "GCT drawing USB4720 rev B",
        pin_count: 18,
        pitch_mm: 0.5,
        exposed_pad: false,
        source: `${SRC.drawing} (pin table; top, bottom, front, side and rear views)`,
        assumption: "GCT names no package; the name is the product series. pin_count counts the 16 contacts, SHELL (the pin table lists it as a terminal; four stake legs) and the two grounding tags as TAG.",
      },
      metadata: {
        body_mm: "7.60 (ref) deep from the tongue tip to the rear stake tabs, 6.50 to the body rear; 11.30 wide over the stake legs, 9.54 over the gasket; 3.75 high (gasket), 2.13 above and 1.13 (ref) below the tail plane",
        tongue_mm: { width: 6.69, thickness: 0.7, in_front_of_gasket: 0.8 },
        mating_axis_above_tail_plane_mm: 0.35,
        opening_mm: { width: 8.34, height: 2.56 },
        board_thickness_mm: { recommended: 0.6, tolerance: 0.1 },
        panel_mm: { opening: [8.44, 2.66], recess_outer: [9.64, 3.86], recess_inner: [9.14, 3.35], wall_ref: 1.8, draft_deg: 10 },
        mated_plug_envelope_mm: { overmold_height_max: 6.5, overmold_to_panel_outer_face_ref: 2.2 },
        material: { insulator: "PA9T, UL 94V-0, black", contacts: "copper alloy", shell: "stainless steel", mid_plate: "stainless steel", emi_plate: "stainless steel", gasket: "silicone rubber, Shore 60A" },
        plating: { contact_area: "3 u\" gold", solder_tails: "gold flash", underplating: "50 u\" min nickel", shell_tails: "gold flash over 50 u\" min nickel", mid_plate: "50 u\" min nickel", emi_plate: "clear" },
        mounting_method: "surface_mount, mid-mount horizontal in a board-edge cut-out; stake legs and grounding tags through the board",
        packaging: "tape and reel, 1300 pcs per reel, 24.0 mm tape, 10 reels per carton; moisture barrier bag",
        source: `${SRC.drawing}; ${SRC.spec} (§8)`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-30, 85],
      metadata: { thermal_shock_test_C: [-55, 85], source: `${SRC.spec} (§4.4, §6.3.3); ${SRC.drawing} (Mechanical & Environmental)` },
    },
  ],

  traits: [
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-30, 85],
        voltage_rating_V_dc: 48,
        power_rating_W: 240,
        current_rating_A: { vbus_A4_A9_B4_B9_collective: 5.0, gnd_A1_A12_B1_B12_collective: 6.25, vconn_A5_B5: 1.25, other_per_pin: 0.25 },
        ingress: "IP67, mated or unmated, mounted in an enclosure built to the drawing's panel spec",
        source: [`${SRC.spec} (§4, §6.3.8)`, `${SRC.drawing} (Electrical; Mechanical & Environmental)`, SRC.dkHighlight],
      },
    },
    {
      type: "performance",
      params: {
        kind: "connector",
        standard: "USB Type-C receptacle, USB 2.0 contacts only",
        ingress_protection: "IP67",
        durability_cycles: 20000,
        mating_force_N: [5, 20],
        unmating_force_N: { initial: [8, 20], after_20000_cycles: [6, 20] },
        contact_resistance_mOhm_max: { initial: 40, after_test: 50 },
        mating_sequence: { first: ["GND", "VBUS"], second: ["CC", "D+/D-", "SBU"] },
        source: [`${SRC.spec} (§6.1, §6.2, §6.3.8)`, `${SRC.drawing} (pin table; Mechanical & Environmental)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Ordering grid USB4720-03-A: 03 = 3 u\" gold contact plating; A = tape and reel (1300 per reel). USB4730 is the top-mount version with a separate gasket (USBTJ-04) fitted after soldering.",
        source: [`${SRC.drawing} (Ordering Grid)`, SRC.dkHighlight],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "lifecycle",
        note: "GCT's product page could not be read (Cloudflare challenge). Rutronik lists USB4720-03-A in reels of 1300 with a 15-week supplier lead time; it is not in the JLCPCB catalog (2026-10-03).",
        source: [SRC.rutronik, SRC.jlc, SRC.product],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "VBUS and GND pins named in the current rating",
        values: ["VBUS A4, A9, B4, B9 and GND A1, A12, B1, B12 (pin table)", "VBUS \"i.e., pins A9, B9\" and GND \"i.e., pins A12, B12\" (specification §4.1, §6.1.4)"],
        sources: [SRC.drawing, SRC.spec],
        resolution: "The drawing's pin table governs the pinout: four VBUS and four GND contacts. The collective ratings apply to each group tied together on the board.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "mass",
        note: "GCT's drawing and specification state no mass; Rutronik gives none, and the DigiKey, Mouser, element14 and Newark product pages could not be read.",
        source: [SRC.drawing, SRC.spec, SRC.rutronik],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "GCT links its 3D models from its product page, which answers every fetch with a Cloudflare challenge (HTTP 403), as do guessed STEP paths under gct.co/files/. SnapEDA and Ultra Librarian need a login and forbid redistribution. Geometry is generated from drawing USB4720 rev B (library/cad/py/catalog/gct-usb4720-03-a.py).",
        source: [SRC.product, SRC.drawing],
      },
    },
    {
      type: "assumption",
      params: {
        field: "D+/D- contacts on both sides",
        value: "the board joins A6 (Dp1) with B6 (Dp2) and A7 (Dn1) with B7 (Dn2)",
        reason: "The pin table gives a D+ and a D- contact on each side and the specification rotates the plug 180° in its durability test, but neither GCT source says how a USB 2.0 board wires them. Joining the pairs, so either plug orientation reaches the USB device, is USB Type-C practice and is not cited here.",
        source: [PIN_TABLE, `${SRC.spec} (§9 Group A-7)`],
      },
    },
    {
      type: "assumption",
      params: {
        field: "grounding-tag designator",
        value: "TAG, one ground leaf for both tags",
        reason: "The drawing's pin table lists the 16 contacts and SHELL but not the two grounding tags, which the recommended layout gives two plated holes. A board needs a designator to bind them; TAG is this library's label, not GCT's.",
        source: [PIN_TABLE, SRC.dkHighlight],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD body and internals",
        value: "shell a stadium 8.94 x 3.26 mm (0.30 mm wall around the 8.34 opening), Z -1.13 to 2.13 from the gasket to the body rear; gasket 1.40 mm thick with its top level with the shell (2.13), so 1.62 mm below the tail plane; cavity 4.30 mm deep; wings 0.30 mm thick, 0.15 mm above the tail plane; all four legs 0.60 mm below the tail plane; tails 0.10 mm thick, pair tails 0.25 mm wide and 0.10 mm apart in their 0.60 group; grounding tags Ø0.30 pins 0.60 mm below the tail plane",
        reason: "The drawing dimensions the outline (7.60 x 11.30 x 3.75), shell height (2.13 / 1.13 / 3.26), opening, tongue, gasket width and height, tail and leg positions, but not the shell wall, gasket thickness or vertical placement, cavity depth, wing or tail thickness or the tag length; the representative model needs single values, read from the drawing's views. The rear view's 0.60 and 0.75 leg dimensions are read as the same legs measured from the tail plane and from the wing.",
        source: SRC.drawing,
      },
    },
  ],

  artifacts: [
    { id: "art_drawing", name: "GCT USB4720 drawing rev B", type: "datasheet", url: SRC.drawing },
    { id: "art_spec", name: "GCT USB4720 product specification rev A2", type: "datasheet", url: SRC.spec },
    { id: "art_dk_highlight", name: "DigiKey USB4720 / USB4730 product highlight", type: "documentation", url: SRC.dkHighlight },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from drawing USB4720 rev B. X across (A1/B12 tails at
// -X), Y from the gasket's front face (Y = 0) to the rear, Z up from the tail
// plane (the board's top surface).
// ---------------------------------------------------------------------------

const TAIL_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_a1: feature("pin_a1", { area_mm2: 0.235, centroid: [-3.45, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b12: feature("pin_b12", { area_mm2: 0.235, centroid: [-3.1, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a4: feature("pin_a4", { area_mm2: 0.235, centroid: [-2.6, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b9: feature("pin_b9", { area_mm2: 0.235, centroid: [-2.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b8: feature("pin_b8", { area_mm2: 0.235, centroid: [-1.75, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a5: feature("pin_a5", { area_mm2: 0.235, centroid: [-1.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b7: feature("pin_b7", { area_mm2: 0.235, centroid: [-0.75, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a6: feature("pin_a6", { area_mm2: 0.235, centroid: [-0.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a7: feature("pin_a7", { area_mm2: 0.235, centroid: [0.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b6: feature("pin_b6", { area_mm2: 0.235, centroid: [0.75, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a8: feature("pin_a8", { area_mm2: 0.235, centroid: [1.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b5: feature("pin_b5", { area_mm2: 0.235, centroid: [1.75, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b4: feature("pin_b4", { area_mm2: 0.235, centroid: [2.25, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a9: feature("pin_a9", { area_mm2: 0.235, centroid: [2.6, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_b1: feature("pin_b1", { area_mm2: 0.235, centroid: [3.1, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_a12: feature("pin_a12", { area_mm2: 0.235, centroid: [3.45, 6.12, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const GCT_USB4720_03_A: ModuleDef = withGeometry(
  GCT_USB4720_03_A_BASE,
  {
    ...Object.fromEntries(Object.entries(TAIL_FEATURES).map(([id, ref]) => [id, { refs: [ref, own(id)] }])),
    shell: { refs: [feature("shell", { area_mm2: 1.56, centroid: [0.0, 4.15, -0.6], normal: [0.0, 0.0, -1.0] }), own("shell")] },
    ground_tags: { refs: [feature("ground_tags", { area_mm2: 0.141, centroid: [0.0, 6.45, -0.6], normal: [0.0, 0.0, -1.0] }), own("ground_tags")] },
    // a plug enters here: frame on the mating axis at the gasket face, normal out of the opening;
    // the plug fits either way up
    usb_c: {
      frame: { origin: [0, 0, 0.35], normal: [0, -1, 0], xAxis: [1, 0, 0], symmetryDeg: 180 },
      refs: [feature("usb_c", { area_mm2: 6.92, centroid: [0.0, 0.0, 0.932], normal: [0.0, -1.0, 0.0] }), own("usb_c")],
    },
    // the gasket face presses against the inside of the enclosure wall
    panel_seal: {
      frame: { origin: [0, 0, 0.35], normal: [0, -1, 0], xAxis: [1, 0, 0] },
      refs: [feature("panel_seal", { area_mm2: 5.893, centroid: [0.0, 0.0, -0.862], normal: [0.0, -1.0, 0.0] }), own("panel_seal")],
    },
    // onto the board: frame on the tail plane at the centre of the four stake legs, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 4.15, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 5.461, centroid: [0.0, 5.566, -0.187], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/gct-usb4720-03-a/artifacts/cad",
    name: "gct-usb4720",
    generator: "library/cad/py/catalog/gct-usb4720-03-a.py",
    tool: "build123d 0.13.0",
    interfaces: ["usb_c", "panel_seal", "pcb_mount", "shell", "ground_tags", ...ROWS.map(([p]) => pin(p))],
  }),
);

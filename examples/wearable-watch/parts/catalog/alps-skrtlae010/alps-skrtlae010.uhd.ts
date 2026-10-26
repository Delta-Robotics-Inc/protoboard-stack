/**
 * Alps Alpine SKRTLAE010 (SKRT series) 4.5 × 3.4 mm side-push SMD TACT
 * switch with guide bosses — datasheet-honest UHD part.
 *
 * Sources (see ./alps-skrtlae010/sources.json):
 *   - src_product: Alps SKRTLAE010 product information — https://tech.alpsalpine.com/e/products/detail/SKRTLAE010/
 *   - src_spec:    Alps product specifications KRT-701 (2017-07) — https://tech.alpsalpine.com/cms.media/product_spec_skrtlae010_en_1db35b7ed3.pdf
 *   - src_catalog: Alps SKRT series catalog page, Drawing No.1 (update 2510) — https://tech.alpsalpine.com/cms.media/product_catalog_ta_02_skrt_en_01ec237785.pdf
 *   - src_cad:     Alps 3D CAD archive (STEP; no licence stated, evidence only) — https://tech.alpsalpine.com/cms.media/product_3dcad_skrtlae010_en_0a8d627682.zip
 *   - src_jlc:     JLCPCB catalog via jlcsearch (distributor corroboration, stock) — https://jlcsearch.tscircuit.com/components/list.json?search=SKRTLAE010
 *
 * Modelling notes:
 *   - Variant: SKRTLAE010, with guide bosses. SKRTLBE010 is the same switch
 *     without them and is a different part. Supply status on the product page
 *     is "Standard" (mass-produced, recommended for new designs).
 *   - Three terminals, `pin_1`…`pin_3`, from the catalog drawing's bottom
 *     view and circuit diagram: 1 and 3 are joined inside the switch and the
 *     contact closes to 2. They are `passive` terminals: a switch contact has
 *     no logic level or supply of its own, so the board's nets decide what it
 *     connects. The 12 V DC 50 mA maximum rating is in `absolute_maximum`.
 *   - The package fact counts the 3 terminals. The two fixing legs and the two
 *     guide bosses belong to the metal frame, which the spec insulation-tests
 *     against the terminals, so they are not circuit pins: they are the
 *     mechanical `board_mount` interface (soldered legs plus bosses in two
 *     Φ0.9 board holes 4.25 mm apart).
 *   - `actuator` is the Φ2 stem the case plunger presses, parallel to the
 *     board. No builder covers a pressed actuator, so it is `custom` (role
 *     input, capability `push_actuator`), recorded as a vocabulary gap; its
 *     frame sits on the stem tip with the normal pointing out of the switch,
 *     towards the plunger. Force, travel and keying-tip guidance are in its
 *     `performance` and `usage_note` traits.
 *   - Which outer terminal is 1: assumption trait (terminal 1 at -X, the left
 *     looking at the stem). 1 and 3 are common, so a swap is electrically
 *     harmless.
 *   - Geometry: generated from the catalog drawing; the vendor STEP has no
 *     stated licence, so it is used only to measure what the drawing leaves
 *     out (terminal positions along the depth, boss and leg thickness). See
 *     the `data_gap` ("manufacturer CAD") and `assumption` traits.
 *   - Mass is not stated by any source (`data_gap`).
 *   - verify-part reports no bolt pattern: intended, an SMD switch is held by
 *     its solder joints and located by its guide bosses.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, withGeometry } from "./cad/artifacts.js";

const SRC = {
  product: "https://tech.alpsalpine.com/e/products/detail/SKRTLAE010/",
  spec: "https://tech.alpsalpine.com/cms.media/product_spec_skrtlae010_en_1db35b7ed3.pdf",
  catalog: "https://tech.alpsalpine.com/cms.media/product_catalog_ta_02_skrt_en_01ec237785.pdf",
  cad: "https://tech.alpsalpine.com/cms.media/product_3dcad_skrtlae010_en_0a8d627682.zip",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=SKRTLAE010",
} as const;

const DRAWING = `${SRC.catalog} (Drawing No.1)`;

const note = (text: string, source: string | string[], topic?: string): TraitDef => ({
  type: "usage_note",
  params: { ...(topic ? { topic } : {}), note: text, source },
});

const assumption = (field: string, value: string, reason: string, source?: string): TraitDef => ({
  type: "assumption",
  params: { field, value, reason, ...(source ? { source } : {}) },
});

const SMD_TERMINAL: TraitDef = {
  type: "connector",
  params: {
    connector_type: "solder_pad",
    note: "Surface-mount terminal, reflow soldered (no hand soldering, spec §10.1).",
    source: SRC.spec,
  },
};

// ---------------------------------------------------------------------------
// Terminals — Drawing No.1 bottom view and circuit diagram
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "1",
      type: "passive",
      description: "Terminal ① (0.65 mm wide). Joined to terminal ③ inside the switch; the contact closes it to terminal ②.",
      traits: [SMD_TERMINAL],
    },
    {
      pin: 2,
      name: "2",
      type: "passive",
      description: "Terminal ② (0.5 mm wide, centre). The moving contact side: closed to terminals ① and ③ while the stem is pressed.",
      traits: [SMD_TERMINAL],
    },
    {
      pin: 3,
      name: "3",
      type: "passive",
      description: "Terminal ③ (0.65 mm wide). Joined to terminal ① inside the switch; the contact closes it to terminal ②.",
      traits: [SMD_TERMINAL],
    },
  ],
  { source: `${DRAWING} bottom view and Circuit Diagram` },
);

// ---------------------------------------------------------------------------
// Mechanical: the stem the plunger presses, and the board mount
// ---------------------------------------------------------------------------

const actuator: InterfaceDef = {
  id: "actuator",
  name: "Side-push stem (Φ2, axis 1.7 mm above the board)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "custom", roles: ["input"] }],
  capabilities: ["push_actuator", "side_push"],
  max_instances: 1,
  traits: [
    {
      type: "performance",
      params: {
        kind: "switch",
        actuation: "side push, parallel to the mounting face, tactile (sharp feeling type)",
        stem_diameter_mm: 2,
        stem_axis_height_mm: 1.7,
        stem_projection_mm: 0.84,
        operating_force_N: { nominal: 1.6, tolerance: 0.5 },
        travel_mm: { nominal: 0.2, plus: 0.2, minus: 0.1 },
        return_force_N_min: 0.3,
        stop_strength_N: { force: 30, duration_s: 15 },
        operating_life_cycles: 100_000,
        life_test: "5 V DC 5 mA resistive, 2.1 N, 2-3 operations per s",
        bounce_ms_max: { on: 10, off: 10, after_life: 20 },
        source: [`${SRC.spec} (§3, §6.4, §7.1-7.4, §9.1)`, `${DRAWING} dimensions`, SRC.product],
      },
    },
    note(
      "Press the centre of the stem with a flat keying tip; a Φ2 mm cylinder is recommended, tilted 3° or less. Never load the stem from the side. Loads above the specified stress break the switch (D6; stop strength 30 N for 15 s, §7.4). Only the Japanese text of D6 adds that a stopper supporting the switch is recommended if loads above the rating, or constant high loads, can reach it (our translation). The switch is for human operation, not mechanical detection. Debounce in firmware (10 ms max bounce new, 20 ms after life).",
      `${SRC.spec} (B3, D3, D4, D5, D6 incl. its Japanese text, D8, D9, §6.4, §7.4)`,
      "plunger design",
    ),
  ],
};

const boardMount: InterfaceDef = {
  id: "board_mount",
  name: "Board mount (2 soldered fixing legs, 2 guide bosses)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount", "pcb_guide_bosses"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "solder_pad",
        note: "Two frame fixing legs (0.8 ± 0.1 mm wide) at the front corners, soldered to their own lands; two guide bosses (0.7 ± 0.05 mm wide, 0.45 mm long below the mounting face, 4.25 mm apart, 2.05 ± 0.1 mm behind the stem tip) located in 2 × Φ0.9 mm board holes. The land drawing marks the area between the leg lands as prohibited for copper tracks.",
        source: `${DRAWING} dimensions and Land Dimensions`,
      },
    },
    note(
      "Reflow only: 260 °C max for 3 s at the product surface, 150-180 °C preheat 120 s max, 40 s max above 230 °C, 2 reflows max, cream solder 0.1-0.15 mm. No flux on the terminals or board before soldering, and no washing. If the switch sits at the board edge, do not auto-dip after mounting (B4). Back-side dip soldering is otherwise allowed after reflow, but with no through holes under or around the switch (D2, §10.3(4)). Not sealed: keep dust, siloxane-emitting silicone and condensation away from it.",
      [`${SRC.spec} (§10, B4, D2, E1, E3, E4)`, SRC.product],
      "assembly",
    ),
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ALPS_SKRTLAE010_BASE: ModuleDef = defineModule({
  id: "alps-skrtlae010",
  name: "Alps Alpine SKRTLAE010 side-push TACT switch",
  version: "1.0.0",
  manufacturer: "Alps Alpine",
  part_number: "SKRTLAE010",
  description:
    "Alps Alpine SKRTLAE010 SKRT-series TACT switch: 4.5 × 3.4 × 3.3 mm, side push, surface mount, with guide bosses; SPST normally open (terminals 1 and 3 common, contact to 2), 1.6 ± 0.5 N, 0.2 mm travel, 100,000 cycles, 12 V DC 50 mA max, 500 mΩ max contact resistance, -40 to +90 °C.",
  tags: ["alps", "alps-alpine", "skrt", "tact-switch", "tactile-switch", "side-push", "right-angle", "smd", "button", "spst-no", "wearable"],
  categories: ["component.switch"],

  interfaces: [...pins, actuator, boardMount],

  domains: [
    { domain: "electrical" },
    {
      domain: "mechanical",
      dimensions_mm: { length: 3.4, width: 4.5, height: 3.3 },
      package: {
        name: "SMD side-push TACT switch, 4.5 × 3.4 mm, with guide bosses",
        code: "SKRT series, Drawing No.1",
        pin_count: 3,
        exposed_pad: false,
        source: `${DRAWING}; ${SRC.product} (Dimensions W×D×H 4.5×3.4×3.3)`,
        assumption: "Terminals 1-3 only; the two fixing legs are frame tabs, not terminals (they are on board_mount).",
      },
      metadata: {
        mounting_method: "surface_mount, reflow",
        depth_breakdown_mm: "0.84 stem beyond the front frame face + 2.56 body",
        guide_bosses: "2, 4.25 mm apart, into Φ0.9 board holes",
        flammability: "94HB",
        packing: "12 mm tape, 3,000 per reel",
        source: [DRAWING, `${SRC.spec} (G4)`, SRC.product],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 90],
      metadata: { storage_temperature_C: [-40, 90], reflow_peak_C: 260, source: `${SRC.spec} (§1.2, §1.3, §10.2)` },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: { voltage_V_dc: 12, current_mA: 50, note: "Maximum rating 12 V DC 50 mA, resistive DC load.", source: [`${SRC.spec} (§5.1, A2)`, SRC.product] },
    },
    {
      type: "operating_conditions",
      params: {
        minimum_rating: "1 V DC 10 µA",
        ambient_temperature_C: [-40, 90],
        contact_resistance_mOhm_max: 500,
        insulation_resistance_MOhm_min: 100,
        voltage_proof: "250 V AC for 1 min between all terminals and between the terminals and the frame",
        source: [`${SRC.spec} (§1.2, §5.2, §6.1-6.3)`, SRC.product],
      },
    },
    note(
      "Circuit: 1 pole 1 throw, normally open. Terminals 1 and 3 are joined internally; pressing the stem closes them to terminal 2.",
      [`${DRAWING} Circuit Diagram`, `${SRC.spec} (§4)`, `${SRC.jlc} (SPST-NO)`],
      "circuit",
    ),
    assumption(
      "typical wiring",
      "terminal 2 to a GPIO input with a pull-up; terminals 1 and 3 to GND",
      "Design intent, not from any source: a common way to read a normally-open switch. No source assigns these pins for the watch (SW1, SW2) or the bottle (SW1); the board design decides.",
    ),
    note(
      "Supply status Standard (mass-produced, recommended for new designs) on the Alps page, 2026-10-02. JLCPCB C110293, 33,262 in stock on 2026-10-02 (distributor mirror).",
      [SRC.product, SRC.jlc],
      "sourcing",
    ),
    assumption(
      "terminal 1 position",
      "terminal 1 at -X: the left terminal looking at the stem",
      "The drawing's bottom view numbers ①②③ left to right but does not say which way it is viewed; read as a third-angle bottom view, which keeps left and right of the front view. Terminals 1 and 3 are common, so a mirror changes nothing electrically.",
      DRAWING,
    ),
    assumption(
      "CAD dimensions not on the drawing",
      "terminal feet 0.15 mm thick, flat on the mounting face, 1.34-2.67 mm behind the frame face (terminal 2 from 1.54); bosses and legs 0.21 mm thick; legs 0.8 mm tall with their undersides on the mounting face; housing a plain 4.5 × 2.56 × 3.25 mm box 0.05 mm above the mounting face",
      "The drawing gives the outline, stem, boss and terminal widths but not these. Positions and thicknesses are measured from the vendor STEP (src_cad, evidence only). The drawing's side view does give one riser dimension: 0.5 mm, measured up from the mounting face at the rear terminal riser, and the STEP shows the terminal tabs rising at the rear, beyond the 2.56 mm body, to 2.71 mm behind the frame face. The model leaves the riser out (flat feet only). Terminal thickness and leg height are not dimensioned on the drawing.",
      `${DRAWING} side view (0.5); ${SRC.cad}`,
    ),
    {
      type: "source_discrepancy",
      params: {
        field: "overall height",
        values: ["3.3 mm (drawing, product page)", "3.35 mm terminal underside to top (vendor STEP)"],
        sources: [DRAWING, SRC.cad],
        resolution: "Drawing value used; the generated body is 3.3 mm high.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Alps publishes a STEP (SKRTLA.STEP in the product page's 3D CAD archive) but states no licence: the archive's 'Read me first.rtf' only explains the file formats and the Alps terms pages returned HTTP 403. It is not redistributed; geometry is generated from the catalog drawing (library/cad/py/catalog/alps-skrtlae010.py), with the STEP used only for measurements.",
        source: SRC.cad,
      },
    },
    { type: "data_gap", params: { field: "mass", note: "Not given on the product page, the catalog or the spec sheet." } },
  ],

  artifacts: [
    { id: "art_product", name: "Alps SKRTLAE010 product information", type: "documentation", url: SRC.product },
    { id: "art_spec", name: "Alps SKRTLAE010 product specifications KRT-701", type: "datasheet", url: SRC.spec },
    { id: "art_catalog", name: "Alps SKRT series catalog (Drawing No.1)", type: "datasheet", url: SRC.catalog },
  ],
});

// ---------------------------------------------------------------------------
// Geometry (PB-796): generated from Drawing No.1. z = 0 the mounting face,
// y = 0 the front frame face (stem towards -Y), terminal 1 at -X.
// ---------------------------------------------------------------------------

const PIN_FEATURES = {
  pin_1: feature("pin_1", { area_mm2: 0.851, centroid: [-1.18, 2.005, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.565, centroid: [0.0, 2.105, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.851, centroid: [1.18, 2.005, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const ALPS_SKRTLAE010: ModuleDef = withGeometry(
  ALPS_SKRTLAE010_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    // the plunger comes from -Y: frame on the stem tip, normal out of the switch
    actuator: {
      frame: { origin: [0, -0.84, 1.7], normal: [0, -1, 0], xAxis: [1, 0, 0] },
      refs: [feature("stem_tip", { area_mm2: 3.142, centroid: [0.0, -0.84, 1.7], normal: [0.0, -1.0, 0.0] })],
    },
    // onto the board: frame on the mounting face between the bosses, normal out of the underside
    board_mount: {
      frame: { origin: [0, 1.21, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [
        feature("guide_bosses", { area_mm2: 0.294, centroid: [0.0, 1.21, -0.45], normal: [0.0, 0.0, -1.0] }),
        feature("fixing_legs", { area_mm2: 0.336, centroid: [0.0, 0.105, 0.0], normal: [0.0, 0.0, -1.0] }),
      ],
    },
  },
  cadArtifacts({
    dir: "library/parts/alps-skrtlae010/artifacts/cad",
    name: "alps-skrtlae010",
    generator: "library/cad/py/catalog/alps-skrtlae010.py",
    tool: "build123d 0.13.0",
  }),
);

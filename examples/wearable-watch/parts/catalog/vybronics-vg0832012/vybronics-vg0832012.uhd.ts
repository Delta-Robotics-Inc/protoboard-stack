/**
 * Vybronics VG0832012 8 mm Z-axis coin LRA (linear resonant actuator, wire
 * leads, no adhesive tape) — datasheet-honest UHD part.
 *
 * Sources (see ./vybronics-vg0832012/sources.json):
 *   - src_datasheet: Vybronics VG0832012 product specification, version A/1
 *     (2020-07-01) — https://vybronics.hk/wp-content/uploads/datasheet-files/Vybronics-VG0832012-datasheet.pdf
 *     (the vybronics.com copy linked from the product page is byte-identical)
 *   - src_product: Vybronics VG0832012 product page — https://www.vybronics.com/coin-vibration-motors/lra/v-g0832012
 *   - src_cad: Vybronics 3D file (RAR; no licence stated, not used) —
 *     https://www.vybronics.com/wp-content/uploads/cad-files/Vybronics-VG0832012-3D-file.rar
 *   - src_terms: Vybronics Terms and Conditions — https://www.vybronics.com/terms-and-conditions
 *
 * Modelling notes:
 *   - Variant: VG0832012 (old p/n G0832012) has no tape on the bottom; the
 *     taped VG0832013D and the 205 Hz VG0832029D are separate parts.
 *   - Two leaves, one per lead, with the drawing's polarity labels as
 *     designators: `lead_pos` "+" (red) and `lead_neg` "-" (blue). The
 *     mechanical domain states the termination as a 2-terminal package
 *     (the datasheet names no package; see its `assumption`).
 *   - `drive` composes the pair as a `power` input of two `motor_in` leaves,
 *     mirroring sparkfun-rob-28633's brushed motor, so it pairs with
 *     ti-drv2605ldgs `actuator_output` (power output, OUT+ / OUT-). There is
 *     no LRA or AC-actuator vocabulary (gaps.json, vocabulary).
 *   - The drive is AC: rated 1.8 Vrms sine at 235 Hz, operating 0.1-1.85 Vrms.
 *     The `voltage` parameters carry that rms range; the power vocabulary has
 *     no rms or AC notion, so a usage_note says so. A driver whose output
 *     range is wider (the DRV2605L swings to VDD) must be programmed to the
 *     rated voltage (RATED_VOLTAGE / OD_CLAMP on the DRV2605L).
 *   - Current: max_current 0.08 A is the datasheet's rated current (max
 *     80 mArms); current_draw 0.058 A is the product page's typical current
 *     (no condition stated). Both are on `drive`; see the source_discrepancy
 *     trait.
 *   - `mount_face`: the can's bottom face (the face VG0832013D carries its
 *     tape on, and the lead-tab side), bonded to the housing; vibration is
 *     along its normal (Z). No holes, so no BoltPattern.
 *   - Pair DRC against ti-drv2605ldgs finds `drive` <-> `actuator_output` as
 *     a clean potential but does not auto-connect it: the driver's REG pin
 *     (a 1.83 V power output) is also voltage-compatible. The project
 *     harness (watch-lra-leads) binds the leads to OUT+ / OUT- explicitly.
 *   - Thickness: 3.2t (model-name size code) vs 3.25 mm (drawing) is a
 *     source_discrepancy trait; 3.25 mm is used.
 *   - Geometry: generated from the p.10 outline view
 *     (library/cad/py/catalog/vybronics-vg0832012.py). Vybronics links a 3D
 *     file but states no licence and its site terms reserve all rights
 *     (data_gap "manufacturer CAD"). Tab size, lead spacing and insulation
 *     OD are scaled from the drawing (assumption trait).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { connectorTrait, currentDrawA, defineModule, maxCurrentA, voltageRangeV } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://vybronics.hk/wp-content/uploads/datasheet-files/Vybronics-VG0832012-datasheet.pdf",
  product: "https://www.vybronics.com/coin-vibration-motors/lra/v-g0832012",
  cad: "https://www.vybronics.com/wp-content/uploads/cad-files/Vybronics-VG0832012-3D-file.rar",
  terms: "https://www.vybronics.com/terms-and-conditions",
} as const;

const DRIVE_VRMS: [number, number] = [0.1, 1.85]; // p.4 §2-2 operating voltage range (Vrms AC)
const RATED_A = 0.08; // p.5 §4-1 rated current MAX 80 mArms
const TYPICAL_A = 0.058; // product page "Typical Current (mA): 58"

const LEADS = connectorTrait("bare_wire_lead", {
  positions: 2,
  pinout: ["+ (red)", "- (blue)"],
  note: "Datasheet p.10: UL3302 AWG32 leads, tinned; 10 ± 2 mm beyond the lead tab (whose end is 5.6 mm from the can centre), stripped 1.5 ± 0.5 mm; UV adhesive over the exit. Product page: custom lead lengths and connectors are available.",
});

// ---------------------------------------------------------------------------
// Leaves: the two leads
// ---------------------------------------------------------------------------

function lead(id: string, pin: string, colour: string, description: string): InterfaceDef {
  return {
    id,
    name: `Lead ${pin} (${colour})`,
    pin,
    domain: "electrical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "power", roles: ["input"] }],
    capabilities: ["motor_in", "lra_in"],
    parameters: [voltageRangeV(DRIVE_VRMS[0], DRIVE_VRMS[1])],
    traits: [{ type: "pin_functions", params: { description, source: `${SRC.datasheet} (p.10 §7 Outside View)` } }],
  };
}

const leadPos = lead("lead_pos", "+", "red", "“+” POLARITY (RED); UL3302 AWG32, wires are tinned");
const leadNeg = lead("lead_neg", "-", "blue", "“–” POLARITY (BLUE); UL3302 AWG32, wires are tinned");

// ---------------------------------------------------------------------------
// Composed: the LRA drive pair
// ---------------------------------------------------------------------------

const drive: InterfaceDef = {
  id: "drive",
  name: "LRA drive (+ / -), 1.8 Vrms 235 Hz",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["input"] }],
  capabilities: ["lra_in", "haptic_actuator"],
  parameters: [voltageRangeV(DRIVE_VRMS[0], DRIVE_VRMS[1]), maxCurrentA(RATED_A), currentDrawA(TYPICAL_A)],
  slots: [
    { id: "pos", label: "+", required: true, match: { protocol: "power", role: "input", capability: "motor_in" } },
    { id: "neg", label: "-", required: true, match: { protocol: "power", role: "input", capability: "motor_in" } },
  ],
  profiles: [{ id: "default", label: "+ red / - blue", default_active: true, bindings: { pos: "lead_pos", neg: "lead_neg" } }],
  max_instances: 1,
  traits: [
    LEADS,
    {
      type: "usage_note",
      params: {
        topic: "drive",
        note: "AC drive: rated 1.8 Vrms sine at 235 Hz (235 ± 5 Hz), operating 0.1-1.85 Vrms; the voltage parameters are rms values. Drive it from an LRA driver with resonance tracking and program the driver's rated and overdrive voltages to these limits (a switching driver's output can swing to its supply). Coil resistance 22.5 Ω ± 10 %. Figure 1 currents: 30 / 50 / 70 / 80 mArms at 0.5 / 1.0 / 1.5 / 1.8 Vrms. Product page: 19 mA at 0.6 V gives 0.55 G. The datasheet allows the rated voltage and frequency to be changed to suit the customer's assembly.",
        source: [`${SRC.datasheet} (p.4 §2, p.5 §3-4, p.6 Figure 1, p.9 §6(6))`, SRC.product],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "drive current",
        values: ["MAX. 80 mArms at 1.8 Vrms (datasheet §4-1; Figure 1 legend)", "Typical Current (mA): 58 (product page, no condition)"],
        sources: [SRC.datasheet, SRC.product],
        resolution: "max_current 0.08 A from the datasheet; current_draw 0.058 A from the product page as the typical value. The two do not contradict each other, but they come from different documents and the 58 mA condition is unstated.",
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mechanical: the bonded face
// ---------------------------------------------------------------------------

const mountFace: InterfaceDef = {
  id: "mount_face",
  name: "Mounting face (can bottom, Z-axis vibration)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["adhesive_mount", "vibration_z"],
  traits: [
    {
      type: "usage_note",
      params: {
        topic: "mounting",
        note: "Vibrates along Z, perpendicular to its largest surface. No double-stick tape on the bottom (VG0832013D has it); bond the bottom face with adhesive or tape, or seat it on a foam pad (offered by Vybronics). Do not press with more than 0.5 kgf. Keep it away from liquids, corrosive gases and magnets. Acceleration 1.0-1.8 G is measured on a 100 g dummy jig, so the felt level depends on the mass it is bonded to.",
        source: [SRC.product, `${SRC.datasheet} (p.4 §2-3, p.5 §4-2, p.9 §6)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const assumption = (field: string, value: string, reason: string): TraitDef => ({ type: "assumption", params: { field, value, reason } });

const VYBRONICS_VG0832012_BASE: ModuleDef = defineModule({
  id: "vybronics-vg0832012",
  name: "Vybronics VG0832012 8 mm Z-axis coin LRA",
  version: "1.0.0",
  manufacturer: "Vybronics",
  part_number: "VG0832012",
  description:
    "Vybronics VG0832012 (old p/n G0832012) linear resonant actuator: Φ8 × 3.25 mm coin, Z-axis vibration, rated 1.8 Vrms sine at 235 Hz (operating 0.1-1.85 Vrms), 80 mArms max, 22.5 Ω, 1.0-1.8 G, 1.0 g, two tinned AWG32 leads (+ red, - blue), no adhesive tape.",
  tags: ["lra", "linear-resonant-actuator", "haptic", "vibration-motor", "coin", "z-axis", "wearable", "vybronics", "wire-leads"],
  categories: ["actuator.haptic"],

  interfaces: [leadPos, leadNeg, drive, mountFace],

  interfaceGroups: [{ id: "lead_pair", label: "+ and - drive one actuator", members: ["lead_pos", "lead_neg"], policy: "all_of" }],

  domains: [
    {
      domain: "electrical",
      metadata: {
        rated_voltage_Vrms: 1.8,
        operating_voltage_Vrms: DRIVE_VRMS,
        rated_frequency_Hz: 235,
        frequency_tolerance_Hz: 5,
        coil_resistance_ohm: 22.5,
        coil_resistance_tolerance_pct: 10,
        rated_current_max_mArms: 80,
        typical_current_mA: 58,
        insulation_resistance_min_Mohm: 10,
        insulation_test: "100 V DC between case and lead wire or PCB",
        source: [`${SRC.datasheet} (p.4 §2, p.5 §4)`, SRC.product],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 19.6, width: 8.0, height: 3.25 },
      weight_g: 1.0,
      package: {
        name: "Coin Φ8, 3.2t, 2 wire leads",
        code: "VG0832",
        pin_count: 2,
        exposed_pad: false,
        source: `${SRC.datasheet} (p.4 §1 'VG 0832 … SIZE SPEC.: Φ8, 3.2t'; p.10 §7 Outside View)`,
        assumption: "The datasheet names no package; the name is built from its size code. The two terminals are the tinned leads, designated by their polarity labels.",
      },
      metadata: {
        body_mm: "Φ8 ± 0.1 × 3.25 ± 0.1",
        lead_tab_end_from_centre_mm: 5.6,
        lead_length_mm: "10 ± 2 beyond the lead tab, strip 1.5 ± 0.5, tinned",
        lead_wire: "UL3302 AWG32",
        uv_adhesive_envelope_mm: { height_max: 1.8, beyond_can_edge_max: 2.1, width_max: 2.4 },
        dimensions_note: "overall, leads included: far can edge to the nominal lead end (4 + 5.6 + 10 mm) × can Φ8 × can height",
        weight_tolerance_g: 0.1,
        max_press_force_kgf: 0.5,
        mounting_method: "adhesive (no tape fitted)",
        packaging: "plastic tray, 100 per tray; 4000 per master box",
        source: [`${SRC.datasheet} (p.5 §4-7, p.9 §6(1), p.10 §7, p.11 §8)`, SRC.product],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-20, 60],
      metadata: { storage_C: [-30, 70], humidity_pct_RH: "65 ± 20", source: `${SRC.datasheet} (p.4 §2-5, §2-6)` },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "haptic_actuator",
        actuator_type: "LRA (linear resonant actuator), coin",
        vibration_axis: "Z (perpendicular to the largest surface)",
        rated_voltage_Vrms: 1.8,
        resonant_frequency_Hz: 235,
        acceleration_G: [1.0, 1.8],
        acceleration_condition: "1.8 Vrms, 235 Hz, 100 g dummy jig",
        vibration_force_Grms: 1.0,
        rise_time_ms_max: 50,
        rise_time_condition: "0-50 % of normal acceleration",
        fall_time_ms_max: 80,
        fall_time_condition: "100-50 % of normal acceleration",
        noise_dBA_max: 50,
        noise_condition: "10 cm from the microphone",
        life_cycles: 500000,
        life_condition: "1.8 Vrms 235 Hz sine, 2 s on / 1 s off; afterwards acceleration, resistance and current within ±30 % of initial",
        note: "Product page summary: vibration force 1.00 Grms, rise/fall times at 50 % of maximum G.",
        source: [`${SRC.datasheet} (p.5 §4, p.6 Figure 1, p.8 §5-7)`, SRC.product],
      },
    },
    {
      type: "operating_conditions",
      params: {
        drive_voltage_Vrms: DRIVE_VRMS,
        rated_voltage_Vrms: 1.8,
        drive_waveform: "AC sine",
        frequency_Hz: 235,
        ambient_temperature_C: [-20, 60],
        humidity_pct_RH: "65 ± 20",
        source: `${SRC.datasheet} (p.4 §2)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "compliance and variants",
        note: "RoHS 2.0, REACH and halogen-free (datasheet). Old part number G0832012. VG0832013D is the same size with double-stick tape on the bottom. ECCN EAR99, HTS 8501.10.4020, made in China (product page).",
        source: [`${SRC.datasheet} (p.9 §6(7))`, SRC.product],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "thickness",
        values: ["3.2t (§1 size spec; product page headline '8 mm x 3.2 mm')", "3.25 ± 0.1 mm (p.10 outline view; product page table 'Thickness (mm): 3.25')"],
        sources: [SRC.datasheet, SRC.product],
        resolution: "3.25 mm: the dimensioned drawing. 3.2t is the rounded size code in the model name.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["coil inductance", "resonant-frequency shift with mounting mass", "lead tab width and thickness", "lead spacing and insulation diameter"],
        note: "Neither Vybronics source states these.",
        source: [SRC.datasheet, SRC.product],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The product page links a 3D file (RAR) but states no licence, and the site terms say its content remains the exclusive property of Vybronics and its licensors, so it is not redistributed or used. Geometry is generated from the datasheet p.10 outline view (library/cad/py/catalog/vybronics-vg0832012.py).",
        source: [SRC.product, SRC.cad, SRC.terms],
      },
    },
    assumption(
      "generated geometry",
      "lead tab 2.4 mm wide, 0.25 mm thick, ending at x = 5.6; UV adhesive drawn at its maximum envelope (to x = 6.1, 1.8 high, 2.4 wide); lead centres 1.15 mm apart, 0.46 mm above the bottom face; insulation Ø0.45 mm, tinned conductor Ø0.20 mm (AWG32 nominal); nominal lead length (ends at x = 15.6, strip 1.5 mm)",
      "The drawing dimensions the can, the tab end, the adhesive maxima and the lead lengths only; the rest is scaled from the drawing.",
    ),
    assumption(
      "lead side",
      "red '+' at +Y and blue '-' at -Y with the leads along +X, seen from the top",
      "Read from the p.10 view below the side view, which in the drawing's first-angle projection is the top view; the drawing does not state the projection.",
    ),
  ],

  artifacts: [
    { id: "art_datasheet", name: "Vybronics VG0832012 product specification (A/1)", type: "datasheet", url: SRC.datasheet },
    { id: "art_product_page", name: "Vybronics VG0832012 product page", type: "documentation", url: SRC.product },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD from library/cad/py/catalog/vybronics-vg0832012.py
// (mm; can axis +Z, bottom face at z = 0, leads along +X, '+' at +Y).
// ---------------------------------------------------------------------------

const LEAD_POS = feature("lead_pos", { area_mm2: 0.942, centroid: [14.85, 0.575, 0.46] });
const LEAD_NEG = feature("lead_neg", { area_mm2: 0.942, centroid: [14.85, -0.575, 0.46] });

export const VYBRONICS_VG0832012: ModuleDef = withGeometry(
  VYBRONICS_VG0832012_BASE,
  {
    // bonded face: frame at the centre of the can bottom, normal out of it, x toward the leads
    mount_face: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("mount_face", { area_mm2: 50.265, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("mount_face")],
    },
    // tinned lead ends, where the harness or board pad is soldered: frame at the tip, normal along the lead
    lead_pos: { frame: { origin: [15.6, 0.575, 0.46], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_POS, own("lead_pos")] },
    lead_neg: { frame: { origin: [15.6, -0.575, 0.46], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_NEG, own("lead_neg")] },
    drive: { refs: [LEAD_POS, LEAD_NEG] },
  },
  cadArtifacts({
    dir: "library/parts/vybronics-vg0832012/artifacts/cad",
    name: "vybronics-vg0832012",
    generator: "library/cad/py/catalog/vybronics-vg0832012.py",
    tool: "build123d 0.13.0",
    interfaces: ["mount_face", "lead_pos", "lead_neg"],
  }),
);

/**
 * LiPol Battery Co., Ltd. LP402030 200 mAh 3.7 V lithium polymer cell with
 * protection circuit module (PCM), no NTC, two AWG30 leads — datasheet-honest
 * UHD part.
 *
 * Sources (see parts/evidence/lipol-lp402030/sources.json):
 *   - src_datasheet: LP402030 200mAh 3.7V with PCM specification and drawing
 *     (FD_2030_40, 28.06.2021) — https://www.li-polymer-battery.com/wp-content/uploads/2021/06/LP402030-Datasheet.pdf
 *   - src_product: LiPol LP402030 product page —
 *     https://li-polymer-battery.com/3-7v-rechargeable-li-polymer-battery-lp402030-200mah-with-pcm-and-wires/
 *   - src_size_table: LiPol standard-cell size table (on the LP502025 page) —
 *     https://li-polymer-battery.com/li-polymer-battery-lp502025-3-7v-200mah/
 *   - src_wire_wontex, src_wire_cnctech: third-party UL1007 30 AWG wire tables,
 *     used only for the assumed lead diameter in the generated CAD.
 *
 * Modelling notes:
 *   - Variant: the datasheet build, PCM fitted, no NTC, 50 mm bare leads, no
 *     connector. LiPol also sells it with a 10K NTC, 100 mm or custom leads
 *     and connectors (src_product); those are different builds. "402030" is a
 *     size code other makers use too; only LiPol's documents are evidence.
 *   - Two leaves, one per lead, with the drawing's polarity marks as
 *     designators: `lead_pos` "+" (red) and `lead_neg` "-" (black). The
 *     mechanical domain states the termination as a 2-terminal package (the
 *     datasheet names no package; see its `assumption`).
 *   - The + lead is both the discharge output and the charge input, so its
 *     leaf carries the power roles output and input. Two composites bind the
 *     same leads: `battery_out` (PowerOut, 2.75-4.20 V, 200 mA continuous,
 *     1 cell, 200 mAh) and `charge_in` (PowerIn, 4.2 V +-50 mV, 100 mA max).
 *     The `charge_in` range is the charge voltage only (4.15-4.25 V); the
 *     `lead_pos` leaf spans 2.75-4.25 V (discharge and charge).
 *     There is no rechargeable-cell builder (gaps.json, vocabulary).
 *   - All terminal values are at the PCM output, which is what the leads
 *     carry. The PCM thresholds (4.275 V, 2.75 V, 1-2.5 A) are in a usage_note;
 *     their release values are recorded as printed (see the data_gap).
 *   - `mount_face`: the bottom face of the cell and PCM zone, seated in a
 *     pocket or on tape. The cell has no holes, so there is no BoltPattern.
 *   - Pair DRC against microchip-mcp73831t-2aci-ot finds `charge_in` <->
 *     `battery_charge` compatible but does not auto-connect it: `battery_out`
 *     also overlaps the charger's VDD input (3.75-6 V) by voltage. The same
 *     holds for the MAX17048 supply and the TPS7A02 inputs (compatible,
 *     not auto-connected). The project harness (battery-leads) binds
 *     the leads explicitly. Program the charger at or below 100 mA (the
 *     main board here uses 83 mA, as the wearable watch does).
 *   - Geometry: generated from the drawing
 *     (parts/local/lipol-lp402030/lipol-lp402030.py); LiPol publishes no CAD
 *     (data_gap "manufacturer CAD"). The 30 mm length includes the PCM zone,
 *     as the drawing dimensions it. Lead positions, strip length and wire
 *     diameter are not dimensioned (assumption traits).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import {
  Ground,
  capacitymAh,
  cellCount,
  connectorTrait,
  defineModule,
  maxCurrentA,
  voltageRangeV,
} from "@deltarobotics/uhd";
import { feature, own, withGeometry } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which parts/local/cadkit/partkit.py follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  datasheet: "https://www.li-polymer-battery.com/wp-content/uploads/2021/06/LP402030-Datasheet.pdf",
  product: "https://li-polymer-battery.com/3-7v-rechargeable-li-polymer-battery-lp402030-200mah-with-pcm-and-wires/",
  sizeTable: "https://li-polymer-battery.com/li-polymer-battery-lp502025-3-7v-200mah/",
  wireWontex: "https://www.wontex.com/pdfdownload/UL%201007%20HOOK%20UP%20WIRE.pdf",
  wireCnctech: "https://www.cnctech.us/pdfs/1007-XX-1-2000-0XX-1-TS_.pdf",
} as const;

// src_datasheet "Electrical Specification" unless noted
const CAPACITY_MAH = 200; // "Rated Capacity 200mAh min, 200mAh typ."
const NOMINAL_V = 3.7; // "Nominal Voltage 3.7V"
const ENERGY_WH = 0.74; // "Wat-Hour Rating 0.74Wh"
const OPERATING_V: [number, number] = [2.75, 4.2]; // "Max. Operating Voltage Range 2.75V to 4.20V"
const CHARGE_V = 4.2; // "Max. Charge Voltage 4.2V ±50mV"
const CHARGE_TOL_V = 0.05;
const CHARGE_MAX_A = 0.1; // "Max. Charge Current 100mA"
const DISCHARGE_MAX_A = 0.2; // "Max. Continuous Discharge Current 200mA"
const CUTOFF_V = 2.75; // "Discharge Cut Off 2.75V"

const CHARGE_V_RANGE: [number, number] = [+(CHARGE_V - CHARGE_TOL_V).toFixed(2), +(CHARGE_V + CHARGE_TOL_V).toFixed(2)]; // 4.15-4.25 V
const LEAD_V_RANGE: [number, number] = [CUTOFF_V, CHARGE_V_RANGE[1]]; // 2.75-4.25 V: discharge and charge
const DS_SPEC = `${SRC.datasheet} (Electrical Specification)`;
const DS_DRAWING = `${SRC.datasheet} (drawing FD_2030_40; parts list items 50, 60)`;

const LEADS = connectorTrait("bare_wire_lead", {
  positions: 2,
  pinout: ["+ (red)", "- (black)"],
  note: "Datasheet drawing: wire red (+) and wire black (-), AWG30 UL1007, 50 +3.0/-3.0 mm beyond the body end, ends stripped (length not dimensioned), no connector. Product page: 50 mm, 100 mm or custom leads and connectors are available as other builds.",
});

const assumption = (field: string, value: string, reason: string): TraitDef => ({ type: "assumption", params: { field, value, reason } });

// ---------------------------------------------------------------------------
// Leaves: the two leads (PCM output terminals)
// ---------------------------------------------------------------------------

const leadPos: InterfaceDef = {
  id: "lead_pos",
  name: "Lead + (red, AWG30 UL1007)",
  pin: "+",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["output", "input"] }],
  capabilities: ["battery_out", "battery_charge_in", "li_ion_1s"],
  parameters: [voltageRangeV(LEAD_V_RANGE[0], LEAD_V_RANGE[1], NOMINAL_V)],
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "BAT+" }],
        description: "50 wire red (+) AWG30 UL1007; PCM output '+' (circuit diagram)",
        source: [DS_DRAWING, `${SRC.datasheet} (Circuit Diagram)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "voltage range",
        note: "The leaf range spans discharge and charge: 2.75 V cut-off up to the 4.2 V +-50 mV maximum charge voltage. The discharge range alone (2.75-4.20 V) is on battery_out.",
        source: DS_SPEC,
      },
    },
  ],
};

const leadNeg: InterfaceDef = {
  ...Ground({ id: "lead_neg", name: "Lead - (black, AWG30 UL1007)", pin: "-" }),
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "BAT-" }],
        description: "60 wire black (-) AWG30 UL1007; PCM output '-' (circuit diagram); carries the return current through the PCM switch",
        source: [DS_DRAWING, `${SRC.datasheet} (Circuit Diagram)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Composed: discharge output and charge input over the same leads
// ---------------------------------------------------------------------------

const batteryOut: InterfaceDef = {
  id: "battery_out",
  name: "Battery output (+ / -), 3.7 V 200 mAh",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["output"] }],
  capabilities: ["battery_out", "li_ion_1s"],
  parameters: [
    voltageRangeV(OPERATING_V[0], OPERATING_V[1], NOMINAL_V),
    maxCurrentA(DISCHARGE_MAX_A),
    cellCount(1),
    capacitymAh(CAPACITY_MAH),
  ],
  slots: [
    { id: "pos", label: "+", required: true, match: { protocol: "power", role: "output", capability: "battery_out" } },
    { id: "gnd", label: "-", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "default", label: "+ red / - black", default_active: true, bindings: { pos: "lead_pos", gnd: "lead_neg" } }],
  max_instances: 1,
  traits: [
    LEADS,
    {
      type: "usage_note",
      params: {
        topic: "discharge",
        note: "200 mA maximum continuous discharge (1C), cut-off 2.75 V, internal impedance < 500 mOhm. The PCM disconnects the cell at 2.75 V +-50 mV and above 1-2.5 A, so a system cut-off above 2.75 V (the watch uses 3.40 V in firmware) keeps the PCM from tripping in use. No pulse rating is stated.",
        source: [DS_SPEC, `${SRC.datasheet} (Cell Protection)`],
      },
    },
  ],
};

const chargeIn: InterfaceDef = {
  id: "charge_in",
  name: "Charge input (+ / -), 4.2 V CC/CV, 100 mA max",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["input"] }],
  capabilities: ["battery_charge", "li_ion_1s"],
  parameters: [voltageRangeV(CHARGE_V_RANGE[0], CHARGE_V_RANGE[1], CHARGE_V), maxCurrentA(CHARGE_MAX_A), cellCount(1)],
  slots: [
    { id: "vbat", label: "+", required: true, match: { protocol: "power", role: "input", capability: "battery_charge_in" } },
    { id: "gnd", label: "-", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "default", label: "+ red / - black", default_active: true, bindings: { vbat: "lead_pos", gnd: "lead_neg" } }],
  max_instances: 1,
  traits: [
    LEADS,
    {
      type: "usage_note",
      params: {
        topic: "charge",
        note: "Charge to 4.2 V +-50 mV at no more than 100 mA (0.5C), between 0 and +45 C. The cell has no NTC, so a charger cannot qualify the charge by temperature. The PCM opens the charge path at 4.275 V +-50 mV after 0.7-1.3 s.",
        source: [DS_SPEC, `${SRC.datasheet} (Ambient Conditions; Cell Protection; Mechanical Characteristics 'NTC No')`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mechanical: the face seated in the case pocket
// ---------------------------------------------------------------------------

const mountFace: InterfaceDef = {
  id: "mount_face",
  name: "Seating face (cell bottom, 20 x 30 mm)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["adhesive_mount", "pocket_mount"],
  traits: [
    {
      type: "usage_note",
      params: {
        topic: "mounting",
        note: "No mounting features: the pouch cell is located by a pocket or held with tape on one of its 20 x 30 mm faces. The folded PCM is held to the cell end with double-sided tape and wrapped in kapton (drawing items 20, 30, 40). Size tolerances: thickness 4.0 +-0.3, width 20 +-0.5, length 30 +-1.0 mm. No swelling allowance is stated.",
        source: `${SRC.datasheet} (drawing; parts list)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const LIPOL_LP402030_BASE: ModuleDef = defineModule({
  id: "lipol-lp402030",
  name: "LiPol LP402030 200 mAh 3.7 V LiPo with PCM",
  version: "1.0.0",
  manufacturer: "LiPol Battery Co., Ltd.",
  part_number: "LP402030",
  description:
    "LiPol Battery LP402030 lithium polymer cell, 1S1P, 200 mAh, 3.7 V nominal, 0.74 Wh, 2.75-4.20 V, with protection circuit module (no NTC): charge 4.2 V +-50 mV at 100 mA max, discharge 200 mA continuous max. 4.0 x 20 x 30 mm including the PCM, appr. 4.0 g, two AWG30 UL1007 leads (red +, black -) 50 mm long, no connector.",
  tags: ["lipo", "li-polymer", "battery", "1s", "200mah", "pcm", "protected", "wearable", "lipol", "wire-leads"],
  categories: ["power", "power.battery"],

  interfaces: [leadPos, leadNeg, batteryOut, chargeIn, mountFace],

  interfaceGroups: [{ id: "lead_pair", label: "+ and - leads are used together", members: ["lead_pos", "lead_neg"], policy: "all_of" }],

  artifacts: [
    { id: "art_datasheet", name: "LiPol LP402030 specification and drawing (FD_2030_40)", type: "datasheet", url: SRC.datasheet },
    { id: "art_product_page", name: "LiPol LP402030 product page", type: "documentation", url: SRC.product },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        {
          id: "cell",
          name: "1S cell at the PCM output",
          nominal_voltage_V: NOMINAL_V,
          voltage_range_V: OPERATING_V,
          max_current_mA: DISCHARGE_MAX_A * 1000,
          regulation_type: "unregulated",
        },
      ],
      metadata: {
        chemistry: "Li-polymer",
        configuration: "1S1P",
        capacity_mAh: { min: 200, typ: 200 },
        energy_Wh: ENERGY_WH,
        max_charge_voltage_V: { value: CHARGE_V, tolerance_V: CHARGE_TOL_V },
        max_charge_current_mA: 100,
        max_continuous_discharge_current_mA: 200,
        discharge_cutoff_V: CUTOFF_V,
        internal_impedance_max_mohm: 500,
        pcm: true,
        ntc: false,
        pcm_protection: {
          overcharge_detect_V: [4.225, 4.325],
          overcharge_delay_s: [0.7, 1.3],
          overdischarge_detect_V: [2.7, 2.8],
          overdischarge_delay_ms: [14, 26],
          overcurrent_detect_A: [1, 2.5],
          overcurrent_delay_ms: [8, 16],
        },
        lead_gauge_awg: 30,
        lead_wire: "UL1007",
        source: [`${SRC.datasheet} (Electrical Specification; Cell Protection; Mechanical Characteristics)`, SRC.product],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 80, width: 20, height: 4.0 },
      weight_g: 4.0,
      package: {
        name: "LiPo pouch 402030 with PCM, 2 wire leads",
        code: "LP402030",
        pin_count: 2,
        exposed_pad: false,
        source: `${SRC.datasheet} (drawing FD_2030_40; Mechanical Characteristics)`,
        assumption: "The datasheet names no package; the name is built from the part number's size code (4.0 x 20 x 30 mm). The two terminals are the leads, designated by their polarity marks.",
      },
      metadata: {
        body_mm: { thickness: "4.0 +-0.3", width: "20 +-0.5", length: "30 +-1.0 (includes the PCM zone)" },
        pcm_zone_mm: 3.2,
        lead_length_mm: "50 +-3.0 beyond the body end, ends stripped",
        lead_wire: "AWG30 UL1007, red (+), black (-)",
        dimensions_note: "overall, leads included: 30 mm body + 50 mm leads (nominal) x 20 x 4.0",
        weight_note: "appr. 4.0 g",
        general_tolerances_mm: { "up to 6": 0.1, "over 6 up to 30": 0.2, "over 30 up to 100": 0.3 },
        source: [`${SRC.datasheet} (drawing; Mechanical Characteristics)`, SRC.product, SRC.sizeTable],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-20, 60],
      metadata: {
        operating_note: "discharge range; charge 0 to +45 C",
        charge_C: [0, 45],
        discharge_C: [-20, 60],
        storage: [
          { duration: "1 year", range_C: [-20, 30], capacity_retained: ">70 %" },
          { duration: "3 months", range_C: [-20, 45], capacity_retained: ">70 %" },
          { duration: "1 month", range_C: [-20, 60], capacity_retained: ">70 %" },
        ],
        humidity_pct_RH: "65 +-20",
        source: `${SRC.datasheet} (Ambient Conditions)`,
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "battery",
        chemistry: "Li-polymer",
        cells: 1,
        configuration: "1S1P",
        capacity_mAh: CAPACITY_MAH,
        nominal_voltage_V: NOMINAL_V,
        energy_Wh: ENERGY_WH,
        max_charge_current_A: CHARGE_MAX_A,
        continuous_current_A: DISCHARGE_MAX_A,
        c_rating_charge_derived: 0.5,
        c_rating_continuous_derived: 1,
        c_rating_note: "Not stated as C rates; derived as 100 mA / 200 mAh and 200 mA / 200 mAh.",
        internal_impedance_max_mohm: 500,
        cycle_life: "500 cycles >= 80 % at 0.5C/0.5C, 23 +-5 C",
        source: [DS_SPEC, SRC.product],
      },
    },
    {
      type: "operating_conditions",
      params: {
        operating_voltage_V: OPERATING_V,
        charge_voltage_V: CHARGE_V,
        charge_voltage_tolerance_V: CHARGE_TOL_V,
        max_charge_current_A: CHARGE_MAX_A,
        max_continuous_discharge_current_A: DISCHARGE_MAX_A,
        discharge_cutoff_V: CUTOFF_V,
        charge_temperature_C: [0, 45],
        discharge_temperature_C: [-20, 60],
        humidity_pct_RH: "65 +-20",
        source: [DS_SPEC, `${SRC.datasheet} (Ambient Conditions)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "protection circuit",
        note: "PCM (no NTC): overcharge detection 4.275 V +-50 mV (0.7-1.3 s delay, release 4.275 V +-50 mV); overdischarge detection 2.75 V +-50 mV (14-26 ms delay, resume 2.50 V +-50 mV); overcurrent detection 1-2.5 A (8-16 ms delay). Values as printed.",
        source: `${SRC.datasheet} (Cell Protection)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "compliance and handling",
        note: "The maker states the battery meets the Battery Directives and its parts are IEC 62133 and RoHS compliant, and refers to its LiPo handling and safety precautions. Product page: MOQ 5 pieces; NTC, lead length and connectors can be specified as other builds.",
        source: [`${SRC.datasheet} (Environmental and Safety)`, SRC.product],
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["pulse discharge current", "swelling allowance", "self-discharge", "lead strip length", "lead position on the end face", "PCM IC and quiescent current"],
        note: "Not stated in the LiPol datasheet or product page. The PCM release values are printed oddly (overcharge release equals detection; over-discharge 'resume 2.50 V' is below the 2.75 V detection) and are recorded as printed, not corrected.",
        source: [SRC.datasheet, SRC.product],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The LiPol product page links only the datasheet, and the datasheet has no CAD link; a web search for an LP402030 STEP found only listings. Geometry is generated from the datasheet drawing (parts/local/lipol-lp402030/lipol-lp402030.py).",
        source: [SRC.product, SRC.datasheet],
      },
    },
    assumption(
      "length includes the PCM",
      "30 mm overall, of which the last 3.2 mm (along the length) is the folded PCM zone at full width and height",
      "The drawing's 30 +-1.0 dimension runs to the end of the PCM zone, and item 20 is labelled 'PCM (3.2mm)', but the depth of the PCM zone along the length is not dimensioned. Confirm on a sample before the case is frozen.",
    ),
    assumption(
      "lead side and order",
      "both leads leave the PCM end face next to the '+' side edge, red (+) outermost at y = +9.0 and black (-) at y = +6.8, at mid-thickness",
      "Read from the tab-side view and the assembled isometric view; the views are not to scale and the lead positions are not dimensioned.",
    ),
    {
      type: "assumption",
      params: {
        field: "generated lead geometry",
        value: "insulation O1.1 mm, conductor O0.30 mm; installed state: only a 1 mm stub of each lead is drawn, its last 0.5 mm bare, because the rest of the supplied 50 mm lead is cut to length and routed as the project harness battery-leads",
        reason: "LiPol states only AWG30 UL1007. Third-party UL1007 30 AWG tables give 1.09 +-0.08 mm overall with a 0.30 mm conductor (Wontex) and 1.13 +-0.10 mm (CNC Tech). The strip length is drawn but not dimensioned.",
        source: [SRC.wireWontex, SRC.wireCnctech],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD from parts/local/lipol-lp402030/lipol-lp402030.py
// (mm; body centred in X and Y, bottom face at z = 0, PCM end and leads at +X,
// '+' side edge at +Y).
// ---------------------------------------------------------------------------

const LEAD_POS = feature("lead_pos", { area_mm2: 0.471, centroid: [15.75, 9.0, 2.0] });
const LEAD_NEG = feature("lead_neg", { area_mm2: 0.471, centroid: [15.75, 6.8, 2.0] });

export const LIPOL_LP402030: ModuleDef = withGeometry(
  LIPOL_LP402030_BASE,
  {
    // seating face: frame at the centre of the bottom face, normal out of it, x toward the PCM end
    mount_face: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("mount_face", { area_mm2: 600.0, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("mount_face")],
    },
    // stripped lead ends, where the harness or board pad is soldered: frame at the tip, normal along the lead
    lead_pos: { frame: { origin: [16.0, 9.0, 2.0], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_POS, own("lead_pos")] },
    lead_neg: { frame: { origin: [16.0, 6.8, 2.0], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_NEG, own("lead_neg")] },
    battery_out: { refs: [LEAD_POS, LEAD_NEG] },
    charge_in: { refs: [LEAD_POS, LEAD_NEG] },
  },
  cadArtifacts({
    dir: "parts/local/lipol-lp402030",
    name: "lipol-lp402030",
    generator: "parts/local/lipol-lp402030/lipol-lp402030.py",
    tool: "build123d 0.13.0",
    interfaces: ["mount_face", "lead_pos", "lead_neg"],
  }),
);

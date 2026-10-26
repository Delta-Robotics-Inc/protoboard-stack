/**
 * LiPoly Batteries Co., Ltd. (polybattery.com) LP503450 1000 mAh 3.7 V lithium
 * polymer cell with protection circuit module (PCM), no NTC, two wire leads —
 * datasheet-honest UHD part.
 *
 * Project-researched part (parts/local; docs/specs/tool-integrations.md §6 in the
 * Protoboard Stack), copied from the parts library workspace (commit 9a80317) with
 * its evidence (parts/evidence/lipol-lp503450/) and generated CAD (parts/local/lipol-lp503450/).
 *
 * Sources (see parts/evidence/lipol-lp503450/sources.json):
 *   - src_product: polybattery.com "1000mAh Lipo Lithium Battery 3.7V - Model
 *     LP503450" (specification table) —
 *     https://polybattery.com/product/1000mah-lipo-battery-lp503450-3-7-v-lithium-rechargeable-battery-cqc
 *   - src_product_photo: the product photo on that page (leads, label, PCM).
 *   - src_product_gps: polybattery.com LP503450 1000 mAh application page with
 *     the same data sheet table (corroboration).
 *   - src_size_list: polybattery.com model list (rates LP503450 at 850 mAh; see
 *     the source_discrepancy trait).
 *   - src_about: polybattery.com About page (company name, PCM on every cell).
 *   - src_ref_lipol_850, src_ref_lipol_index: LiPol Battery Co., Ltd.'s own
 *     LP503450 (850 mAh) datasheet and drawing FD_3450_73. A different maker's
 *     cell of the same size code: used only for labelled assumptions.
 *   - src_wire_xinya, src_wire_ess: third-party UL1571 28 AWG wire tables,
 *     used only for the assumed lead diameter in the generated CAD.
 *
 * Modelling notes:
 *   - Maker: the brief names "LiPol Battery Co. (polybattery.com)". The site
 *     names itself LiPoly Batteries Co., Ltd. (footer "Polymer Battery Co.,
 *     Ltd"), Shenzhen. It is not LiPol Battery Co., Ltd. (lipolbattery.com),
 *     the maker of lipol-lp402030, whose LP503450 is an 850 mAh cell. The id
 *     `lipol-lp503450` is kept as assigned; `manufacturer` states the maker.
 *   - Evidence: the maker publishes a specification table and a photo, no
 *     datasheet PDF and no drawing. Every electrical value is from that table.
 *     There is no temperature range and no PCM threshold (data_gap); the
 *     charge/discharge temperatures are an assumption from the LiPol 850 mAh
 *     reference.
 *   - Variant: PCM fitted, no NTC, bare leads, no connector (photo). Custom
 *     lead lengths, JST/Molex connectors and an NTC are other builds
 *     (src_product, src_about).
 *   - Two leaves, one per lead, with the label's polarity marks as
 *     designators: `lead_pos` "+" (red) and `lead_neg` "-" (black). The
 *     mechanical domain states the termination as a 2-terminal package (the
 *     maker names no package; see its `assumption`).
 *   - The + lead is both the discharge output and the charge input, so its
 *     leaf carries the power roles output and input. Two composites bind the
 *     same leads: `battery_out` (PowerOut, 2.75-4.20 V, 1000 mA, 1 cell,
 *     1000 mAh) and `charge_in` (PowerIn, 4.2 V +-50 mV, 500 mA max). The
 *     `lead_pos` leaf spans 2.75-4.25 V (discharge and charge). There is no
 *     rechargeable-cell builder (as for lipol-lp402030).
 *   - "Discharge Current 1000mA" is not labelled continuous or maximum; it is
 *     modelled as the continuous maximum (`max_current`), with no burst
 *     rating (see the usage_note).
 *   - `mount_face`: the bottom face of the cell and PCM zone, seated in a
 *     pocket or on tape. The cell has no holes, so there is no BoltPattern.
 *   - Pair DRC against microchip-mcp73831t-2aci-mc finds `charge_in` <->
 *     `battery_charge` as a clean potential but does not auto-connect it:
 *     `battery_out` also overlaps the charger's VDD input by voltage. The
 *     same holds for the MAX17048 and TPS63020 (potentials, not
 *     auto-connected). The project harness (bottle-battery-leads) binds the
 *     leads explicitly. The bottle programs the charger to 303 mA, under the
 *     500 mA maximum.
 *   - Geometry: generated (parts/local/lipol-lp503450/lipol-lp503450.py); the
 *     maker publishes no CAD (data_gap "manufacturer CAD"). The 50 mm length
 *     includes the PCM zone, lead length, gauge and position are assumptions.
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
// the common generated-CAD layout (STEP, GLB, manifest), which the copied generator follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  product: "https://polybattery.com/product/1000mah-lipo-battery-lp503450-3-7-v-lithium-rechargeable-battery-cqc",
  photo: "https://polybattery.com/wp-content/uploads/2021/04/1000mah-lipo-battery-lp503450-3.7-v-lithium-rechargeable-battery-cqc.jpg",
  productGps: "https://polybattery.com/lp503450-1000mah-rechargeable-li-polymer-battery-used-for-gps-tracker",
  sizeList: "https://polybattery.com/lithium-polymer-batteries",
  about: "https://polybattery.com/about",
  refLipol850: "https://www.lipolbattery.com/LiPo-Battery-Datahseet/LiPo_Battery_LP503450_3.7V_850mAh.pdf",
  refLipolIndex: "https://li-polymer-battery.com/li-polymer-battery-datasheets/",
  wireXinya: "https://www.xinyawires.com/showroom/28awg-30v-80-degrees-pvc-ul1571-electric-cable-general-purpose-internal-wiring.html",
  wireEss: "https://www.esskabel.de/en/product/awg28-litze-ul1571/",
} as const;

// src_product "Lithium Battery Electrical Specification" unless noted
const CAPACITY_MAH = 1000; // "Rated Capacity 1000mAh min, 1010mAh typ."
const CAPACITY_TYP_MAH = 1010;
const NOMINAL_V = 3.7; // "Nominal Voltage 3.7V"
const ENERGY_WH = 3.7; // "Wat-Hour Rating 3.7Wh"
const OPERATING_V: [number, number] = [2.75, 4.2]; // "Max. Operating Voltage Range 2.75V to 4.20V"
const CHARGE_V = 4.2; // "Max. Charge Voltage 4.2V ±50mV"
const CHARGE_TOL_V = 0.05;
const CHARGE_MAX_A = 0.5; // "Max. Charge Current 500mA"
const DISCHARGE_A = 1.0; // "Discharge Current 1000mA"
const CUTOFF_V = 2.75; // "Discharge Cut Off 2.75V"
const IMPEDANCE_MAX_MOHM = 200; // "Internal Impedance <200mΩ"

const CHARGE_V_RANGE: [number, number] = [+(CHARGE_V - CHARGE_TOL_V).toFixed(2), +(CHARGE_V + CHARGE_TOL_V).toFixed(2)]; // 4.15-4.25 V
const LEAD_V_RANGE: [number, number] = [CUTOFF_V, CHARGE_V_RANGE[1]]; // 2.75-4.25 V: discharge and charge
const SPEC = `${SRC.product} (Lithium Battery Electrical Specification)`;
const MECH = `${SRC.product} (LiPo Battery Mechanical Characteristics)`;
const PHOTO = `${SRC.photo} (product photo: label '- LiPo Battery / LP503450 1000mAh / + 3.7V 3.7Wh', red and black leads)`;

const LEADS = connectorTrait("bare_wire_lead", {
  positions: 2,
  pinout: ["+ (red)", "- (black)"],
  note: "Product photo: two leads, red and black, leaving the PCM end at the corner on the '+' side, ends stripped and tinned, no connector. Lead gauge and length are not stated (see the assumption traits). The maker offers custom wire lengths and JST/Molex connectors as other builds.",
});

const assumption = (field: string, value: string, reason: string, source?: string | string[]): TraitDef => ({
  type: "assumption",
  params: source ? { field, value, reason, source } : { field, value, reason },
});

// ---------------------------------------------------------------------------
// Leaves: the two leads (PCM output terminals)
// ---------------------------------------------------------------------------

const leadPos: InterfaceDef = {
  id: "lead_pos",
  name: "Lead + (red)",
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
        description: "red lead; '+' mark on the cell label; PCM output (PCM 'Yes')",
        source: [PHOTO, MECH],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "voltage range",
        note: "The leaf range spans discharge and charge: 2.75 V cut-off up to the 4.2 V +-50 mV maximum charge voltage. The discharge range alone (2.75-4.20 V) is on battery_out.",
        source: SPEC,
      },
    },
  ],
};

const leadNeg: InterfaceDef = {
  ...Ground({ id: "lead_neg", name: "Lead - (black)", pin: "-" }),
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "BAT-" }],
        description: "black lead; '-' mark on the cell label; PCM output, carries the return current through the PCM switch",
        source: [PHOTO, MECH],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Composed: discharge output and charge input over the same leads
// ---------------------------------------------------------------------------

const batteryOut: InterfaceDef = {
  id: "battery_out",
  name: "Battery output (+ / -), 3.7 V 1000 mAh",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["output"] }],
  capabilities: ["battery_out", "li_ion_1s"],
  parameters: [
    voltageRangeV(OPERATING_V[0], OPERATING_V[1], NOMINAL_V),
    maxCurrentA(DISCHARGE_A),
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
        note: "Discharge current 1000 mA (1C; the maker does not say continuous or maximum, and states no pulse rating), cut-off 2.75 V, internal impedance < 200 mOhm. The PCM thresholds are not published, so a system cut-off above 2.75 V (the bottle uses 3.40 V in firmware) keeps the cell above the maker's cut-off.",
        source: SPEC,
      },
    },
  ],
};

const chargeIn: InterfaceDef = {
  id: "charge_in",
  name: "Charge input (+ / -), 4.2 V CC/CV, 500 mA max",
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
        note: "Charge to 4.2 V +-50 mV at no more than 500 mA (0.5C). The cell has no NTC, so a charger cannot qualify the charge by temperature; the maker states no charge temperature range (see the assumption trait).",
        source: [SPEC, MECH],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mechanical: the face seated in the case pocket
// ---------------------------------------------------------------------------

const mountFace: InterfaceDef = {
  id: "mount_face",
  name: "Seating face (cell bottom, 34 x 50 mm)",
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
        note: "No mounting features: the pouch cell is located by a pocket or held with tape on one of its 34 x 50 mm faces. The PCM is folded across one short end under kapton tape, inside the 5 x 34 x 50 mm outline (photo). The maker states no tolerances and no swelling allowance; size the pocket with clearance (the LiPol reference drawing of the same size code gives 5.0 +-0.3 x 34 +-0.5 x 50 +-1.0).",
        source: [MECH, PHOTO, `${SRC.refLipol850} (drawing FD_3450_73; reference only)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const LIPOL_LP503450_BASE: ModuleDef = defineModule({
  id: "lipol-lp503450",
  name: "LP503450 1000 mAh 3.7 V LiPo with PCM",
  version: "1.0.0",
  manufacturer: "LiPoly Batteries Co., Ltd. (polybattery.com)",
  part_number: "LP503450",
  description:
    "LP503450 lithium polymer cell from polybattery.com, 1S1P, 1000 mAh min (1010 mAh typ), 3.7 V nominal, 3.7 Wh, 2.75-4.20 V, with protection circuit module (no NTC): charge 4.2 V +-50 mV at 500 mA max, discharge 1000 mA, cut-off 2.75 V, < 200 mOhm. 5 x 34 x 50 mm including the PCM, appr. 20 g, two leads (red +, black -), no connector.",
  tags: ["lipo", "li-polymer", "battery", "1s", "1000mah", "pcm", "protected", "wire-leads"],
  categories: ["power", "power.battery"],

  interfaces: [leadPos, leadNeg, batteryOut, chargeIn, mountFace],

  interfaceGroups: [{ id: "lead_pair", label: "+ and - leads are used together", members: ["lead_pos", "lead_neg"], policy: "all_of" }],

  artifacts: [
    { id: "art_product_page", name: "polybattery.com LP503450 1000 mAh product page (specification table)", type: "documentation", url: SRC.product },
    { id: "art_product_photo", name: "polybattery.com LP503450 1000 mAh product photo", type: "documentation", url: SRC.photo },
    { id: "art_product_gps", name: "polybattery.com LP503450 1000 mAh data sheet table (GPS tracker page)", type: "documentation", url: SRC.productGps },
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
          max_current_mA: DISCHARGE_A * 1000,
          regulation_type: "unregulated",
        },
      ],
      metadata: {
        chemistry: "Li-polymer",
        configuration: "1S1P",
        capacity_mAh: { min: CAPACITY_MAH, typ: CAPACITY_TYP_MAH },
        energy_Wh: ENERGY_WH,
        max_charge_voltage_V: { value: CHARGE_V, tolerance_V: CHARGE_TOL_V },
        max_charge_current_mA: CHARGE_MAX_A * 1000,
        discharge_current_mA: DISCHARGE_A * 1000,
        discharge_cutoff_V: CUTOFF_V,
        internal_impedance_max_mohm: IMPEDANCE_MAX_MOHM,
        pcm: true,
        ntc: false,
        source: [`${SRC.product} (Mechanical Characteristics; Electrical Specification)`, SRC.productGps],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 100, width: 34, height: 5 },
      weight_g: 20,
      package: {
        name: "LiPo pouch 503450 with PCM, 2 wire leads",
        code: "LP503450",
        pin_count: 2,
        exposed_pad: false,
        source: `${MECH}; ${PHOTO}`,
        assumption: "The maker names no package; the name is built from the part number's size code (5 x 34 x 50 mm). The two terminals are the leads, designated by the label's polarity marks.",
      },
      metadata: {
        body_mm: { thickness: 5, width: 34, length: "50 (includes the PCM zone; assumption)" },
        dimensions_note: "overall, leads included: 50 mm body + 50 mm leads (assumed) x 34 x 5",
        weight_note: "appr. 20 g",
        tolerances: "not stated by the maker",
        source: [MECH, PHOTO, SRC.sizeList],
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
        capacity_typ_mAh: CAPACITY_TYP_MAH,
        nominal_voltage_V: NOMINAL_V,
        energy_Wh: ENERGY_WH,
        max_charge_current_A: CHARGE_MAX_A,
        continuous_current_A: DISCHARGE_A,
        c_rating_charge_derived: 0.5,
        c_rating_continuous_derived: 1,
        c_rating_note: "Not stated as C rates; derived as 500 mA / 1000 mAh and 1000 mA / 1000 mAh. 'Discharge Current 1000mA' is not labelled continuous.",
        internal_impedance_max_mohm: IMPEDANCE_MAX_MOHM,
        cycle_life: "500 cycles >= 80 % at 0.5C/0.5C, 23 +-5 C",
        source: [SPEC, SRC.productGps],
      },
    },
    {
      type: "operating_conditions",
      params: {
        operating_voltage_V: OPERATING_V,
        charge_voltage_V: CHARGE_V,
        charge_voltage_tolerance_V: CHARGE_TOL_V,
        max_charge_current_A: CHARGE_MAX_A,
        discharge_current_A: DISCHARGE_A,
        discharge_cutoff_V: CUTOFF_V,
        temperature_note: "No temperature range is stated by the maker; see the assumption trait 'charge and discharge temperature'.",
        source: SPEC,
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "rated capacity",
        values: ["1000 mAh min, 1010 mAh typ (product page and GPS-tracker data sheet table)", "850 mAh (the maker's own model list, row LP503450 50 x 34 x 5 mm)"],
        sources: [SRC.product, SRC.productGps, SRC.sizeList],
        resolution:
          "Modelled as 1000 mAh: it is the SKU the bottle brief selected, and two maker pages state it as the specification. The model list rates the same size 850 mAh (and lists LP503455, 5 mm longer, as 1000 mAh), and LiPol Battery's LP503450 of the same size is 850 mAh (src_ref_lipol_850). Measure the capacity of a sample; the bottle's power budget already assumes 850 mAh usable.",
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "protection circuit",
        note: "PCM fitted ('Lithium Battery PCM Yes'); the maker says all its cells carry a protective circuit IC against short circuit. No detection thresholds or delays are published.",
        source: [MECH, `${SRC.about} (Quality)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "compliance and handling",
        note: "The product page lists CE, IEC 62133, UN38.3 and MSDS; no certificate is linked. Cells ship charged to about 60 %. Small-volume price USD 10.00 at 10+, 2000 in stock (fetched 2026-10-03).",
        source: [SRC.product, `${SRC.about} (Shippment)`],
      },
    },
    {
      type: "data_gap",
      params: {
        fields: [
          "datasheet and dimensioned drawing",
          "size tolerances",
          "charge, discharge and storage temperature",
          "PCM thresholds and delays",
          "PCM quiescent current",
          "pulse discharge current",
          "swelling allowance",
          "self-discharge",
          "lead gauge, length, strip length and position",
        ],
        note: "Not stated on the maker's product page, its GPS-tracker data sheet table or its About page; no datasheet PDF is published. Ask the maker for the specification sheet before production.",
        source: [SRC.product, SRC.productGps, SRC.about],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The product pages link no datasheet, drawing or CAD; LiPol Battery's datasheet index has only its own 850 mAh LP503450 PDF; a web search for an LP503450 STEP found only listings. Geometry is generated from the stated size and the photo (parts/local/lipol-lp503450/lipol-lp503450.py).",
        source: [SRC.product, SRC.productGps, SRC.refLipolIndex],
      },
    },
    assumption(
      "charge and discharge temperature",
      "charge 0 to +45 C, discharge -20 to +60 C",
      "The maker states none. These are the values on LiPol Battery's LP503450 850 mAh datasheet, a different maker's cell of the same size code; the bottle brief uses 0-45 C for charging. Confirm with the maker.",
      `${SRC.refLipol850} (Ambient Conditions; reference only)`,
    ),
    assumption(
      "length includes the PCM",
      "50 mm overall, of which the last 5.0 mm (along the length) is the folded PCM zone at full width and height",
      "The maker states 5mm*34mm*50mm and the photo shows the PCM inside the outline; the PCM depth is read from the not-to-scale tab-side view of the LiPol 850 mAh drawing of the same size code. Confirm on a sample before the cap is frozen.",
      [MECH, PHOTO, `${SRC.refLipol850} (drawing FD_3450_73)`],
    ),
    assumption(
      "lead side and order",
      "both leads leave the PCM end face next to the '+' side edge, red (+) outermost at y = +15.5 and black (-) at y = +13.0, at mid-thickness",
      "The photo shows the leads at the PCM corner on the '+' side; the order and positions are not dimensioned anywhere (the LiPol reference drawing shows the same corner).",
      [PHOTO, `${SRC.refLipol850} (tab-side view)`],
    ),
    assumption(
      "lead wire and length",
      "AWG28 UL1571, insulation O0.90 mm, conductor O0.38 mm, 50 mm beyond the body end; drawn as 2 mm stubs",
      "The maker states neither gauge nor length. The LiPol 850 mAh reference drawing gives AWG28 UL1571 leads 50 +-3.0 mm long; a UL1571 28 AWG table gives 7/0.127 stranding, 0.38 mm conductor, 0.90 mm overall (another maker sells a 0.60 mm thin-wall build). Measure the sample leads. The CAD draws only 2 mm of each lead (changed in the smart-bottle project, 2026-10-03; the library drew them straight at 50 mm): the leads bend, so the harness (bottle-battery-leads) owns their run and length.",
      [`${SRC.refLipol850} (parts list items 50, 60)`, SRC.wireXinya, SRC.wireEss],
    ),
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD from parts/local/lipol-lp503450/lipol-lp503450.py
// (mm; body centred in X and Y, bottom face at z = 0, PCM end and leads at +X,
// '+' side edge at +Y).
// ---------------------------------------------------------------------------

const LEAD_POS = feature("lead_pos", { area_mm2: 0.636, centroid: [27.0, 15.5, 2.5], normal: [1.0, 0.0, 0.0] });
const LEAD_NEG = feature("lead_neg", { area_mm2: 0.636, centroid: [27.0, 13.0, 2.5], normal: [1.0, 0.0, 0.0] });

export const LIPOL_LP503450: ModuleDef = withGeometry(
  LIPOL_LP503450_BASE,
  {
    // seating face: frame at the centre of the bottom face, normal out of it, x toward the PCM end
    mount_face: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("mount_face", { area_mm2: 1700.0, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("mount_face")],
    },
    // lead stub ends (2 mm drawn), where the harness continues: frame on the end, normal along the lead
    lead_pos: { frame: { origin: [27.0, 15.5, 2.5], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_POS, own("lead_pos")] },
    lead_neg: { frame: { origin: [27.0, 13.0, 2.5], normal: [1, 0, 0], xAxis: [0, 1, 0] }, refs: [LEAD_NEG, own("lead_neg")] },
    battery_out: { refs: [LEAD_POS, LEAD_NEG] },
    charge_in: { refs: [LEAD_POS, LEAD_NEG] },
  },
  cadArtifacts({
    dir: "parts/local/lipol-lp503450",
    name: "lipol-lp503450",
    generator: "parts/local/lipol-lp503450/lipol-lp503450.py",
    tool: "build123d 0.13.0",
    interfaces: ["mount_face", "lead_pos", "lead_neg"],
  }),
);

/**
 * Texas Instruments TPS7A0230PDBVR 3.0 V, 200 mA, 25 nA IQ LDO with enable
 * and active output discharge (SOT-23-5, DBV) — datasheet-honest UHD part.
 *
 * Sources (see ./ti-tps7a0230pdbv/sources.json):
 *   - src_datasheet: TI TPS7A02 datasheet SBVS277C (rev. September 2022), with
 *     package option addendum and DBV0005A outline —
 *     https://www.ti.com/lit/ds/symlink/tps7a02.pdf
 *   - src_part_details: TI TPS7A0230PDBVR part details —
 *     https://www.ti.com/product/TPS7A02/part-details/TPS7A0230PDBVR
 *   - src_product: TI TPS7A02 product folder — https://www.ti.com/product/TPS7A02
 *   - src_cad_ultralibrarian: Ultra Librarian download page (terms forbid
 *     redistribution; no model downloaded).
 *
 * Modelling notes:
 *   - Variant: TPS7A02 + "30" (fixed 3.0 V) + "P" (active output discharge)
 *     + DBV (SOT-23-5) + R (3000 reel), Table 9-1; orderable and active
 *     (addendum, marking 21MF). TPS7A0230PDBVRG4 is the same device. The DQN
 *     (X2SON-4) and YCH (DSBGA-4) packages and the other output voltages
 *     (for example TPS7A0218PDBVR) are different parts and are not merged.
 *   - All 5 pins are leaves `pin_1`..`pin_5` from the §5 Table 5-1 DBV
 *     column, with designators and verbatim `pin_functions` traits. NC
 *     (pin 4) has no internal connection and is type `nc`. DBV has no thermal
 *     pad (Table 5-1); the §8.1.5 sentence about soldering "the thermal pad"
 *     applies to the DQN package.
 *   - Composed interfaces: `vin` (IN pin 1 + GND pin 2) and `vout` (OUT pin 5
 *     + GND pin 2). `vout` carries the 200 mA rating (§6.3), so a board's
 *     supply_budget totals its loads against it. EN (pin 3) is a plain logic
 *     input leaf (capability `enable`).
 *   - Output voltage is the ±1.5 % accuracy band over temperature around
 *     3.0 V (2.955-3.045 V, §6.5), nominal 3.0 V. Load regulation (up to
 *     50 mV) and dropout are in usage notes.
 *   - `vin` and pin 1 carry no current_draw: the input current is the load
 *     current plus 25 nA typ ground current, and UHD does not carry a
 *     regulator's output load through to its input. This is a data_gap trait.
 *   - Regulation needs VIN >= 3.0 V + dropout (360 mV max at 200 mA over
 *     -40 to 125 C); the `vin` range is the datasheet's 1.5-6.0 V operating
 *     range, with the dropout in a usage note.
 *   - Geometry: generated from drawing DBV0005A (no redistributable
 *     manufacturer CAD: TI routes CAD to Ultra Librarian, whose terms forbid
 *     redistribution). Bare IC: no bolt pattern. Each pin leaf refs its foot
 *     (`pin_N`), the composed interfaces ref their pins' feet, and
 *     `pcb_mount` refs all five feet with a frame on the seating plane.
 *     Nominal (midpoint) dimensions; body height, standoff and lead shoulder
 *     are an assumption trait.
 *   - verify-part may report "no mechanical bolt pattern": intended, a bare
 *     SMD IC is soldered by its leads.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { PowerIn, PowerOut, defineModule, maxCurrentA, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.ti.com/lit/ds/symlink/tps7a02.pdf",
  partDetails: "https://www.ti.com/product/TPS7A02/part-details/TPS7A0230PDBVR",
  product: "https://www.ti.com/product/TPS7A02",
  cadUltraLibrarian: "https://vendor.ultralibrarian.com/TI/embedded/?gpn=TPS7A02&package=DBV&pin=5",
} as const;

const VIN: [number, number] = [1.5, 6.0]; // §6.3
const VEN: [number, number] = [0, 6.0]; // §6.3
const VOUT_NOM = 3.0; // Table 9-1: "30" = 3.0 V
const VOUT: [number, number] = [2.955, 3.045]; // §6.5: ±1.5 % over TJ -40 to 125 C
const IOUT_MAX_A = 0.2; // §6.3

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — §5 Table 5-1 Pin Functions, DBV package (5-pin SOT-23, top view)
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "IN",
      type: "power_in",
      voltageV: VIN,
      description:
        "IN (Input) — Input pin. For best transient response and to minimize input impedance, use the recommended value or larger ceramic capacitor from IN to ground; see the Recommended Operating Conditions table. Place the input capacitor as close to the input of the device as possible.",
    },
    { pin: 2, name: "GND", type: "ground", description: "GND (—) — Ground pin. This pin must be connected to ground on the board." },
    {
      pin: 3,
      name: "EN",
      type: "input",
      voltageV: VEN,
      capabilities: ["enable"],
      description:
        "EN (Input) — Enable pin. Driving this pin to logic high enables the device; driving this pin to logic low or floating this pin disables the device. This pin features an internal pulldown resistor, which is disconnected when EN is driven high externally and the device has started up.",
      traits: [
        note(
          "Active high: VEN(HI) >= 1.1 V enables, VEN(LOW) <= 0.3 V disables. Floating EN is held low by the 500 kohm smart pulldown, which is disconnected once EN is driven high and the device has started. EN leakage 10 nA at 6 V. EN toggle frequency 10 kHz max. If independent control is not needed, connect EN to IN.",
          "§6.3, §6.5, §7.3.4",
        ),
      ],
    },
    { pin: 4, name: "NC", type: "nc", description: "NC (—) — No connect pin. This pin is not internally connected. Connect to ground or leave floating." },
    {
      pin: 5,
      name: "OUT",
      type: "power_out",
      voltageV: VOUT,
      nominalV: VOUT_NOM,
      description:
        "OUT (Output) — Regulated output pin. A 0.5-µF or greater effective capacitance is required from OUT to ground for stability. For best transient response, use a 1-µF or larger ceramic capacitor from OUT to ground. Place the output capacitor as close to output of the device as possible; see the Recommended Operating Conditions table.",
    },
  ],
  { source: `${SRC.datasheet} (§5 Table 5-1 Pin Functions, DBV column)`, logicV: VEN },
).map((p) => (p.id === "pin_5" ? { ...p, parameters: [...(p.parameters ?? []), maxCurrentA(IOUT_MAX_A)] } : p));

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed supply interfaces
// ---------------------------------------------------------------------------

const vin: InterfaceDef = {
  ...PowerIn({ id: "vin", name: "Input supply (IN + GND)", voltageV: VIN }),
  slots: [
    { id: "in", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "in_gnd", label: "IN 1, GND 2", default_active: true, bindings: { in: pinId(1), gnd: pinId(2) } }],
  bridgesTo: ["vout"],
  traits: [
    note(
      "1.5-6.0 V operating input (6.5 V absolute max). Regulation needs VIN >= VOUT(nom) + VDO: dropout at 200 mA for 2.5 V <= VOUT < 3.3 V is 310 mV max (TJ -40 to 85 C) and 360 mV max (TJ -40 to 125 C); below that the output tracks the input. UVLO 1.3 V typ rising (1.23-1.47), 1.12 V typ falling (1.0-1.41), 180 mV hysteresis. Ground current 25 nA typ / 46 nA max at 25 C with no load (60 nA max at -40 to 85 C), 25 nA in dropout; IGND/IOUT 0.25 % for 1-100 mA, 0.15 % at >= 100 mA. Shutdown 3 nA typ / 10 nA max.",
      "§6.1, §6.3, §6.5, §7.3.3, §7.4.3",
    ),
    note(
      "1 uF ceramic input capacitor (CIN nominal); not required for stability but recommended, and needed if the source impedance is above 0.5 ohm. Place it as close to IN as possible. X5R/X7R/C0G; expect up to 50 % derating.",
      "§6.3, §8.1.1, §8.1.2, §8.4.1",
    ),
  ],
};

const vout: InterfaceDef = {
  ...PowerOut({ id: "vout", name: "Regulated 3.0 V output (OUT + GND)", voltageV: VOUT, nominalV: VOUT_NOM, maxCurrentA: IOUT_MAX_A }),
  slots: [
    { id: "out", required: true, match: { protocol: "power", role: "output" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "out_gnd", label: "OUT 5, GND 2", default_active: true, bindings: { out: pinId(5), gnd: pinId(2) } }],
  traits: [
    note(
      "Fixed 3.0 V: ±1 % at 25 C, ±1.5 % over TJ -40 to 125 C. Line regulation 5 mV max; load regulation (1-200 mA) 20 mV typ / 38 mV max at TJ -40 to 85 C, 50 mV max at -40 to 125 C. 0-200 mA continuous. Current limit ICL 240 / 450 / 750 mA (min / typ / max), brick-wall above VFOLDBACK = 0.5 V and foldback below it to ISC 65 mA typ into a short; thermal shutdown 170 C, reset 145 C. PSRR 55 dB at 1 kHz. Start-up (EN to 90 % VOUT) 750 us typ / 1200 us max.",
      "§6.3, §6.5, §6.6, §7.3.6, §7.3.8",
    ),
    note(
      "COUT 1-22 uF ceramic (1 uF nominal); at least 0.5 uF effective capacitance is required for stability and 22 uF is the largest derated value. Place it as close to OUT as possible.",
      "§5, §6.3, §8.1.2, §8.4.1",
    ),
    note(
      "Active output discharge (P version): when disabled by EN or UVLO, OUT is pulled to ground through RPULLDOWN = 60 ohm (VIN 3.3 V). Do not rely on it to discharge a large output capacitance after the input has collapsed: reverse current from OUT to IN may flow; limit it to 5 % of the rated current for a short time.",
      "§6.5, §7.3.2, §7.4.4",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "SOT-23-5 (DBV) leads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "sot_23_5_dbv",
        note: "5 gull-wing leads, pitch 0.95 mm (pins 1-3 span 1.9 mm), width 0.3-0.5, thickness 0.08-0.22, foot 0.3-0.6 mm; body 2.75-3.05 x 1.45-1.75 mm, span 2.6-3.0 mm, height 0.90-1.45 mm; no exposed pad. MSL Level-1-260C-UNLIM, NIPDAU | SN finish.",
        source: `${SRC.datasheet} (DBV0005A; package option addendum)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const TI_TPS7A0230PDBV_BASE: ModuleDef = defineModule({
  id: "ti-tps7a0230pdbv",
  name: "TI TPS7A0230P 3.0 V 200 mA LDO (SOT-23-5)",
  version: "1.0.0",
  manufacturer: "Texas Instruments",
  part_number: "TPS7A0230PDBVR",
  description:
    "Texas Instruments TPS7A02 nanopower low-dropout linear regulator, fixed 3.0 V output, in the 5-pin SOT-23 (DBV) package: 1.5-6.0 V input, 200 mA output, 25 nA typical ground current (also in dropout), 3 nA shutdown, 360 mV max dropout at 200 mA, ±1.5 % accuracy over temperature, active-high enable with smart pulldown, active output discharge, foldback current limit and thermal shutdown. Stable with a 1 uF ceramic output capacitor.",
  tags: ["tps7a02", "tps7a0230", "texas-instruments", "ti", "ldo", "linear-regulator", "regulator", "nanopower", "3v0", "sot-23-5", "ic"],
  categories: ["power.regulator"],

  interfaces: [...pins, vin, vout, pcbMount],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vin", name: "Input (IN)", voltage_range_V: VIN },
        { id: "vout", name: "Output (OUT, fixed 3.0 V)", nominal_voltage_V: VOUT_NOM, voltage_range_V: VOUT, max_current_mA: 200, regulation_type: "regulated" },
      ],
      metadata: {
        topology: "CMOS low-dropout linear regulator",
        ground_current_nA: { typ_25C: 25, max_25C: 46, max_m40_to_85C: 60, in_dropout_typ: 25 },
        shutdown_current_nA: { typ: 3, max: 10 },
        dropout_mV_at_200mA: { max_m40_to_85C: 310, max_m40_to_125C: 360, vout_band: "2.5 V <= VOUT < 3.3 V" },
        current_limit_mA: [240, 450, 750],
        short_circuit_current_mA: 65,
        uvlo_V: { rising: [1.23, 1.3, 1.47], falling: [1.0, 1.12, 1.41], hysteresis_mV: 180 },
        enable_V: { vih_min: 1.1, vil_max: 0.3 },
        smart_enable_pulldown_kohm: 500,
        output_discharge_ohm: 60,
        psrr_dB_1kHz: 55,
        startup_time_us: { typ: 750, max: 1200 },
        source: `${SRC.datasheet} (§6.5, §6.6)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.9, width: 2.8, height: 1.45 },
      package: {
        name: "SOT-23-5",
        code: "DBV (DBV0005A)",
        pin_count: 5,
        pitch_mm: 0.95,
        exposed_pad: false,
        source: `${SRC.datasheet} (Package Information: DBV (SOT-23, 5) 2.90 mm × 1.60 mm; §5 Figure 5-2 "DBV Package, 5-Pin SOT-23"; DBV0005A outline: body 2.75-3.05 × 1.45-1.75, span 2.6-3.0, 2X 0.95 pitch, 1.45 mm max height, JEDEC MO-178); ${SRC.product} (SOT-23 (DBV) 5: 8.12 mm², 2.9 mm × 2.8 mm)`,
      },
      metadata: {
        body_mm: "2.75-3.05 x 1.45-1.75; lead span 2.6-3.0; height 0.90-1.45",
        dimensions_note: "length along the pin rows (body), width across the leads (span), height is the drawing maximum",
        mounting_method: "surface_mount",
        msl: "Level-1-260C-UNLIM",
        marking: "21MF",
        source: SRC.datasheet,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 125],
      metadata: {
        temperature_note: "The datasheet specifies the operating junction range (-40 to 125 C) and the addendum's operating temperature; no separate ambient range.",
        junction_abs_max_C: [-40, 150],
        storage_C: [-65, 150],
        rtheta_ja_C_per_W: 181.9,
        rtheta_jc_top_C_per_W: 53.0,
        rtheta_jb_C_per_W: 88.1,
        psi_jt_C_per_W: 27.1,
        psi_jb_C_per_W: 52.7,
        thermal_shutdown_C: { shutdown: 170, reset: 145 },
        source: `${SRC.datasheet} (§6.1, §6.3, §6.4, §6.5; addendum)`,
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        vin_V: [-0.3, 6.5],
        ven_V: [-0.3, 6.5],
        vout_V: "-0.3 to VIN + 0.3 or 5.5, whichever is smaller",
        output_current: "internally limited",
        junction_temperature_C: [-40, 150],
        storage_temperature_C: [-65, 150],
        esd: "HBM ±1000 V; CDM ±500 V",
        source: `${SRC.datasheet} (§6.1, §6.2)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vin_V: VIN,
        ven_V: VEN,
        vout_V: VOUT_NOM,
        output_current_mA: [0, 200],
        cin_uF: 1,
        cout_uF: [1, 22],
        cout_effective_min_uF: 0.5,
        en_toggle_frequency_max_kHz: 10,
        junction_temperature_C: [-40, 125],
        source: `${SRC.datasheet} (§6.3)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "regulator",
        topology: "low-dropout linear regulator (CMOS pass transistor), fixed output",
        output_voltage_V: VOUT_NOM,
        output_current_A: IOUT_MAX_A,
        accuracy_pct: { at_25C: 1, over_temperature: 1.5 },
        quiescent_current_nA: 25,
        shutdown_current_nA: 3,
        dropout_mV_max_at_200mA: 360,
        features: "dynamic and adaptive biasing for fast transient response (< 10 us settling, 100 mV undershoot for 1-50 mA steps), low IQ in dropout, smart enable pulldown, active output discharge, foldback current limit, UVLO, thermal shutdown",
        source: `${SRC.datasheet} (§1, §6.5, §7.3)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "layout",
        note: "Place the input and output capacitors as close to the device as possible; use copper planes for the device connections and thermal vias around the device. Power dissipation PD = (VIN - VOUT) x IOUT; TJ = TA + RthJA x PD with RthJA 181.9 C/W for DBV.",
        source: `${SRC.datasheet} (§6.4, §8.1.5, §8.4.1)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Orderable TPS7A0230PDBVR (active, 3000 large T&R, marking 21MF; also listed as TPS7A0230PDBVR.A). TPS7A0230PDBVRG4 is the same device and package. TPS7A0230PDQNR (X2SON-4) and TPS7A0230PYCHR (DSBGA-4) are separate parts, as is every other output voltage.",
        source: [`${SRC.datasheet} (Table 9-1; package option addendum)`, SRC.partDetails],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "input current draw",
        note: "The input current is the output load current plus the ground current (25 nA typ, no load; IGND/IOUT 0.25 % at 1-100 mA). It depends on the loads on OUT, which UHD does not carry through a regulator, so vin and pin_1 have no current_draw. Budget the input from the 3.0 V rail's loads.",
        source: `${SRC.datasheet} (§6.5)`,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "mass",
        note: "Not stated in the datasheet or on the TI product and part-details pages.",
        source: [SRC.datasheet, SRC.partDetails],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "TI's product folder offers the SOT-23 (DBV) 3D model only through Ultra Librarian, whose End User Subscription Agreement forbids redistribution; no model was downloaded. Geometry is generated from the DBV0005A outline (library/cad/py/catalog/ti-tps7a0230pdbv.py).",
        source: [SRC.product, SRC.cadUltraLibrarian],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal = midpoint of each drawing range (body 2.9 x 1.6, span 2.8, lead 0.4 wide x 0.15 thick, foot 0.45); body underside 0.075 mm above the seating plane (standoff midpoint), body top 1.175 mm (standoff + the 1.1 mm reference body height), lead shoulder top 0.6 mm; pin-1 dimple 0.4 mm",
        reason: "DBV0005A gives only min/max limits (standoff 0.00-0.15, height 0.90-1.45, body (1.1) reference) and no shoulder height or pin-1 mark size; the representative model needs single values.",
        source: SRC.datasheet,
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "TI TPS7A02 datasheet SBVS277C", type: "datasheet", url: SRC.datasheet },
    { id: "art_part_details", name: "TI TPS7A0230PDBVR part details", type: "documentation", url: SRC.partDetails },
    { id: "art_product", name: "TI TPS7A02 product folder", type: "documentation", url: SRC.product },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from drawing DBV0005A. Seating plane z = 0, body
// centred on the origin, pins 1-3 on -X (pin 1 at +Y), pin 4 on +X at -Y,
// pin 5 on +X at +Y.
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.18, centroid: [-1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.18, centroid: [-1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.18, centroid: [-1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.18, centroid: [1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.18, centroid: [1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const TI_TPS7A0230PDBV: ModuleDef = withGeometry(
  TI_TPS7A0230PDBV_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    vin: { refs: [PIN_FEATURES.pin_1, PIN_FEATURES.pin_2] },
    vout: { refs: [PIN_FEATURES.pin_5, PIN_FEATURES.pin_2] },
    // the leads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.9, centroid: [-0.235, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/ti-tps7a0230pdbv/artifacts/cad",
    name: "ti-tps7a0230p-dbv5",
    generator: "library/cad/py/catalog/ti-tps7a0230pdbv.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

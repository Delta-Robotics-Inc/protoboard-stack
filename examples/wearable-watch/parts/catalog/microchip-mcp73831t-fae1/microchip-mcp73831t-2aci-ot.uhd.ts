/**
 * Microchip MCP73831T-2ACI/OT single-cell Li-ion / Li-polymer linear charger
 * (4.20 V, options AC, SOT-23-5) — datasheet-honest UHD part.
 *
 * Sources (see ./microchip-mcp73831t-2aci-ot/sources.json):
 *   - src_datasheet: Microchip MCP73831/2 data sheet DS20001984H (June 2020),
 *     with package drawing C04-091-OT Rev F —
 *     https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf
 *   - src_product: Microchip MCP73831 product page — https://www.microchip.com/en-us/product/MCP73831
 *   - src_cad_snapeda: SnapEDA listing (terms forbid redistribution; no model
 *     downloaded) — https://www.snapeda.com/parts/MCP73831T-2ACI/OT/Microchip/view-part/
 *
 * Modelling notes:
 *   - Variant: MCP73831 (tri-state STAT), VREG code 2 = 4.20 V, options AC
 *     (precondition 10 % below 66.5 % of VREG, termination 7.5 %, recharge at
 *     96.5 % of VREG), industrial, 5-lead SOT-23, tape and reel (Product
 *     Identification System, p.26). The MCP73832 (open-drain STAT), the other
 *     VREG and option codes and the 2x3 DFN package are different parts.
 *   - All 5 pins are leaves `pin_1`..`pin_5` from Table 3-1 (SOT-23-5
 *     column), with designators and verbatim `pin_functions` traits. The
 *     SOT-23-5 package has no exposed pad.
 *   - Composed interfaces: `supply` (VDD pin 4 + VSS pin 2, the USB or
 *     adapter input) and `battery_charge` (VBAT pin 3 + VSS pin 2, the
 *     constant-current / constant-voltage output to the cell).
 *   - VBAT is modelled as a power output with capability `battery_charge`.
 *     It shares the cell's terminal, and the cell is a power output too, so
 *     a board net joining both will be reported by the net rule as two
 *     drivers. UHD has no charge-port role yet; recorded as a vocabulary gap
 *     in .research/gaps.json.
 *   - VBAT voltage is 0-4.232 V: the pin follows the cell up to VREG
 *     (4.168-4.232 V). The 0 V lower bound is an assumption trait (no minimum
 *     is stated). max_current 0.5 A is the top of the programmable range
 *     (15-500 mA); the actual current is set by RPROG on the board
 *     (IREG = 1000 V / RPROG, usage_note on `battery_charge`).
 *   - VDD: 3.75-6 V from the DC characteristics (and the product page); §3.1
 *     recommends VREG + 0.3 V (4.5 V) to 6 V for regulation. Both are kept in
 *     a source_discrepancy trait. current_draw on `supply` and pin 4 is the
 *     0.51 mA typical supply current while charging; the charge current is
 *     drawn through VDD as well and is not in current_draw (usage_note).
 *   - STAT (pin 1) is a tri-state output that drives an LED or an MCU input;
 *     PROG (pin 5) takes the programming resistor to VSS and is the charge
 *     enable (float or logic high = disabled). PROG is modelled as an analog
 *     input with capabilities current_set / charge_enable; its logic-high
 *     threshold is not stated (data_gap).
 *   - Logic pins (STAT, PROG) carry voltage 0-6 V: all inputs and outputs
 *     are rated -0.3 V to VDD + 0.3 V and VDD is at most 6 V.
 *   - No thermistor input and no safety timer (product page parametrics):
 *     charge-temperature qualification is the system's job.
 *   - Geometry: generated from drawing C04-091-OT Rev F (no redistributable
 *     manufacturer CAD). Bare IC: no bolt pattern. Each pin leaf refs its
 *     foot (`pin_N`), the composed interfaces ref their pins' feet, and
 *     `pcb_mount` refs all five feet with a frame on the seating plane.
 *     Midpoint dimensions; body height, standoff and shoulder are assumption
 *     traits.
 *   - verify-part may report "no mechanical bolt pattern": intended, a bare
 *     SMD IC is soldered by its leads.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { PowerIn, PowerOut, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet:
    "https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf",
  product: "https://www.microchip.com/en-us/product/MCP73831",
  cadSnapEda: "https://www.snapeda.com/parts/MCP73831T-2ACI/OT/Microchip/view-part/",
} as const;

const VDD: [number, number] = [3.75, 6]; // DC characteristics, p.3
const VREG: [number, number] = [4.168, 4.232]; // VREG MCP7383X-2, p.3
const VBAT: [number, number] = [0, VREG[1]]; // follows the cell up to VREG (assumption: 0 V floor)
const LOGIC: [number, number] = [0, 6]; // p.3: I/O -0.3 to VDD + 0.3 V; VDD <= 6 V
const ISS_A = 0.00051; // p.3: ISS 510 uA typ while charging
const IREG_MAX_A = 0.5; // p.1: programmable charge current 15 mA to 500 mA

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — Table 3-1 Pin Function Tables, SOT-23-5 column (p.11)
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "STAT",
      type: "output",
      capabilities: ["charge_status", "led_drive", "tri_state"],
      description: "STAT — Charge Status Output",
      traits: [
        note(
          "Tri-state output (MCP73831): Low while preconditioning, fast charging and in constant voltage; High at charge complete; High-Z in shutdown and with no battery. Drives an LED or, with a pull-up, a host MCU input. Sink 25 mA max, source 35 mA max; VOL 0.4 V typ / 1 V max and VOH VDD - 0.4 V typ / VDD - 1 V min at 4 mA; 1 uA max leakage in High-Z.",
          "§3.3 p.11, Table 5-1 p.15, DC characteristics p.4",
        ),
      ],
    },
    { pin: 2, name: "VSS", type: "ground", description: "VSS — Battery Management 0V Reference" },
    {
      pin: 3,
      name: "VBAT",
      type: "power_out",
      voltageV: VBAT,
      nominalV: 4.2,
      capabilities: ["battery_charge"],
      description: "VBAT — Battery Charge Control Output",
      traits: [
        note(
          "Connect to the positive terminal of the battery. Drain of the internal P-channel pass transistor. Bypass to VSS with at least 4.7 uF for loop stability when the battery is disconnected.",
          "§3.2 p.11, §6.1.1.4 p.18",
        ),
      ],
    },
    {
      pin: 4,
      name: "VDD",
      type: "power_in",
      voltageV: VDD,
      nominalV: 5,
      description: "VDD — Battery Management Input Supply",
      traits: [note("A supply of VREG (typical) + 0.3 V to 6 V is recommended. Bypass to VSS with at least 4.7 uF.", "§3.1 p.11")],
    },
    {
      pin: 5,
      name: "PROG",
      type: "analog_in",
      capabilities: ["current_set", "charge_enable"],
      description: "PROG — Current Regulation Set and Charge Control Enable",
      traits: [
        note(
          "A resistor from PROG to VSS sets the fast charge current: IREG (mA) = 1000 V / RPROG (kOhm), RPROG 2-67 kOhm (about 500-15 mA). Preconditioning and termination currents scale with it. PROG floating, an impedance above 200 kOhm (the shutdown threshold is 70-200 kOhm), or a logic-high input disables the charger and terminates the cycle (supply current 25 uA typ).",
          "§3.5 p.11, §5.1.2 and §5.2.2 p.15, DC characteristics p.4",
        ),
      ],
    },
  ],
  { source: `${SRC.datasheet} (Table 3-1, SOT-23-5 column, p.11)`, logicV: LOGIC },
).map((p) => (p.id === "pin_4" ? { ...p, parameters: [...(p.parameters ?? []), currentDrawA(ISS_A)] } : p));

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const supply: InterfaceDef = {
  ...PowerIn({ id: "supply", name: "Charger input (VDD + VSS)", voltageV: VDD, nominalV: 5, parameters: [currentDrawA(ISS_A)] }),
  slots: [
    { id: "vdd", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vdd_pins", label: "VDD 4, VSS 2", default_active: true, bindings: { vdd: pinId(4), gnd: pinId(2) } }],
  bridgesTo: ["battery_charge"],
  traits: [
    note(
      "3.75-6 V. UVLO start 3.45 V typ (3.3-3.6), stop 3.38 V typ (3.2-3.5). The charger runs only while VDD is at least 150 mV above VBAT (typ) and powers down below VBAT + 50 mV (typ). Supply current 510 uA typ / 1500 uA max while charging, 53 uA typ when charge is complete, 25 uA typ with PROG floating. The charge current is also drawn through VDD and is not in current_draw.",
      "DC characteristics pp.3-5, §4.1 p.13",
    ),
    note(
      "A hot-pluggable source (USB cable, wall adapter) needs input overvoltage protection: a transzorb from the input to ground. Bypass VDD with at least 4.7 uF.",
      "§6.1.1.2 p.18, §3.1 p.11",
    ),
  ],
};

const batteryCharge: InterfaceDef = {
  ...PowerOut({ id: "battery_charge", name: "Battery charge output (VBAT + VSS)", voltageV: VBAT, nominalV: 4.2, maxCurrentA: IREG_MAX_A }),
  capabilities: ["battery_charge", "li_ion_1s"],
  slots: [
    { id: "vbat", required: true, match: { protocol: "power", role: "output", capability: "battery_charge" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vbat_pins", label: "VBAT 3, VSS 2", default_active: true, bindings: { vbat: pinId(3), gnd: pinId(2) } }],
  max_instances: 1,
  traits: [
    note(
      "Constant-current / constant-voltage charge of one Li-ion or Li-polymer cell to VREG 4.20 V (4.168-4.232 V, -5 to +55 C). Fast charge current IREG = 1000 V / RPROG: 100 mA (90-110) at 10 kOhm, 505 mA (450-550) at 2 kOhm, 14.5 mA (12.5-16.5) at 67 kOhm. Options AC: precondition at 10 % of IREG while VBAT < 66.5 % of VREG; charge terminates when the current falls below 7.5 % of IREG in constant voltage; recharge starts when VBAT falls below 96.5 % of VREG.",
      "DC characteristics pp.3-4, §4.4-4.8 pp.13-14, Product Identification System p.26",
    ),
    note(
      "Battery detection: 6 uA typ is sourced from VBAT; VBAT above VREG + 100 mV means no battery. Reverse leakage into VBAT is 0.15 uA typ with PROG floating or VDD < VSTOP and 0.25 uA typ with VDD floating, 2 uA max in each case. Place the cell close to VBAT and VSS. A system load on VBAT draws from the charge current and can stop termination.",
      "§4.2 p.13, DC characteristics p.4, §6.2 p.18",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "SOT-23-5 (OT) leads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "sot23_5_ot",
        note: "5 gull-wing leads, pitch 0.95 mm (1.90 mm outside), width 0.20-0.51, thickness 0.08-0.26, foot 0.30-0.60 mm; body 2.90 x 1.60 mm, overall width 2.80 mm, height 0.90-1.45 mm; no exposed pad.",
        source: `${SRC.datasheet} (drawing C04-091-OT Rev F, pp.22-23)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const MICROCHIP_MCP73831T_2ACI_OT_BASE: ModuleDef = defineModule({
  id: "microchip-mcp73831t-2aci-ot",
  name: "Microchip MCP73831 Li-ion charger, 4.20 V (SOT-23-5)",
  version: "1.0.0",
  manufacturer: "Microchip Technology",
  part_number: "MCP73831T-2ACI/OT",
  description:
    "Microchip MCP73831 single-cell Li-ion / Li-polymer linear charge controller in the 5-lead SOT-23: 3.75-6 V input, constant-current / constant-voltage charge to 4.20 V (±0.75 %), 15-500 mA set by one resistor on PROG, options AC (10 % preconditioning, 7.5 % termination, recharge at 96.5 % of VREG), tri-state charge status output, integrated pass transistor, reverse discharge protection, thermal regulation.",
  tags: ["mcp73831", "microchip", "charger", "battery-charger", "li-ion", "lipo", "linear-charger", "sot-23-5", "ic"],
  categories: ["power.charger"],

  interfaces: [...pins, supply, batteryCharge, pcbMount],

  interfaceGroups: [
    { id: "required_pins", label: "VDD (4), VSS (2), VBAT (3) and PROG (5) are all needed to charge", members: [pinId(4), pinId(2), pinId(3), pinId(5)], policy: "all_of" },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vdd", name: "Charger input (VDD)", nominal_voltage_V: 5, voltage_range_V: VDD },
        { id: "vbat", name: "Battery charge output (VBAT)", nominal_voltage_V: 4.2, voltage_range_V: VBAT, max_current_mA: 500, regulation_type: "regulated" },
      ],
      metadata: {
        vreg_V: [4.168, 4.2, 4.232],
        charge_current_mA: { range: [15, 500], formula: "IREG (mA) = 1000 V / RPROG (kOhm)", rprog_kohm: [2, 67], shutdown_rprog_kohm: [70, 200], shutdown_rprog_note: "minimum shutdown impedance: the threshold lies somewhere in 70-200 kOhm; above 200 kOhm is guaranteed shutdown" },
        options_ac: { precondition_ratio_pct: 10, precondition_threshold_pct_of_vreg: 66.5, termination_ratio_pct: 7.5, recharge_threshold_pct_of_vreg: 96.5 },
        supply_current_uA: { charging: [510, 1500], charge_complete_no_battery: [53, 200], prog_floating: [25, 50], vdd_below_vbat: [1, 5], vdd_below_vstop: [0.1, 2] },
        uvlo_V: { start: [3.3, 3.45, 3.6], stop: [3.2, 3.38, 3.5] },
        pass_transistor_rdson_mohm: 350,
        reverse_leakage_uA: { prog_floating: [0.15, 2], vdd_floating: [0.25, 2], vdd_below_vstop: [0.15, 2] },
        source: `${SRC.datasheet} (DC characteristics pp.3-5; p.26)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.9, width: 2.8, height: 1.45 },
      package: {
        name: "SOT-23-5",
        code: "OT (C04-091-OT)",
        pin_count: 5,
        pitch_mm: 0.95,
        exposed_pad: false,
        source: `${SRC.datasheet} (Package Types p.1; drawing C04-091-OT Rev F pp.22-23: N 5, e 0.95 BSC, e1 1.90 BSC, D 2.90 BSC, E 2.80 BSC, E1 1.60 BSC, A 0.90-1.45)`,
      },
      metadata: {
        body_mm: "2.90 x 1.60 (D x E1); overall width 2.80 (E); height 0.90-1.45 (A)",
        dimensions_note: "length along the pin rows (D), width across the leads (E), height is the drawing maximum (A)",
        mounting_method: "surface_mount",
        marking: "KDNN (NN = traceability code)",
        source: `${SRC.datasheet} (pp.19, 22-23)`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: {
        junction_C: [-40, 125],
        storage_C: [-65, 150],
        theta_ja_C_per_W: 230,
        theta_ja_note: "4-layer JC51-7 board, natural convection; 130 C/W or better with a large copper area",
        thermal_shutdown_C: 150,
        thermal_shutdown_hysteresis_C: 10,
        source: `${SRC.datasheet} (Temperature Specifications p.5; DC characteristics p.5)`,
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        vdd_V: 7.0,
        inputs_outputs_V: "-0.3 to VDD + 0.3",
        junction_temperature: "internally limited",
        storage_temperature_C: [-65, 150],
        esd: "HBM 4 kV (1.5 kOhm, 100 pF), MM 400 V on all pins",
        source: `${SRC.datasheet} (Absolute Maximum Ratings p.3)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vdd_V: VDD,
        ambient_temperature_C: [-40, 85],
        junction_temperature_C: [-40, 125],
        rprog_kohm: [2, 67],
        vbat_capacitor_min_uF: 4.7,
        vdd_capacitor_min_uF: 4.7,
        source: [`${SRC.datasheet} (pp.3-5, §3.1-3.2 p.11)`, SRC.product],
      },
    },
    {
      type: "performance",
      params: {
        kind: "battery_charger",
        chemistry: "Li-ion / Li-polymer, 1 cell",
        algorithm: "linear, constant current / constant voltage with preconditioning, termination and automatic recharge",
        vreg_V: 4.2,
        vreg_accuracy_pct: 0.75,
        charge_current_mA: [15, 500],
        termination_pct: 7.5,
        thermal_regulation: true,
        thermistor_input: false,
        safety_timer: false,
        protection: "UVLO, reverse discharge protection, thermal regulation, thermal shutdown at 150 C",
        source: [`${SRC.datasheet} (p.1, pp.3-5, §4 pp.13-14, p.26)`, SRC.product],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "thermal",
        note: "Linear charger: dissipation is (VDD - VBAT) x IREG and is worst just after preconditioning ends. The datasheet example, (5.5 V - 2.7 V) x 550 mA = 1.54 W, drives the SOT-23-5 into thermal regulation (charge current reduced by die temperature). At RPROG 10 kOhm (100 mA) the same case is (5.5 V - 2.7 V) x 100 mA = 0.28 W.",
        source: `${SRC.datasheet} (§6.1.1.3 p.18, §4.9 p.14)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Orderable MCP73831T-2ACI/OT: T = tape and reel, 2 = VREG 4.20 V, AC = options, I = -40 to +85 C, OT = 5-lead SOT-23; marking KDNN. MCP73831-2ACI/OT is the same device without tape and reel.",
        source: `${SRC.datasheet} (Product Identification System p.26; §7.1 p.19)`,
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "VDD minimum",
        values: ["3.75 V (DC characteristics, Supply Voltage; product page Vin Min 3.75 V)", "VREG (typical) + 0.3 V = 4.5 V recommended (§3.1)"],
        sources: [SRC.datasheet, SRC.product],
        resolution: "voltage range 3.75-6 V, the specified supply range. §3.1 is a recommendation for regulating to 4.20 V; the DC characteristics are specified from VREG + 1 V (5.2 V) to 6 V. A 5 V USB input meets both.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "PROG logic-high threshold",
        note: "§5.2.2 says a logic-high input on PROG disables the charger but gives no threshold voltage.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Microchip's product page offers CAD only through a third-party library link; the SnapEDA model for MCP73831T-2ACI/OT is under SnapMagic's Terms of Service, which forbid redistributing Design Files (5.1(a), 5.1(f), 5.1(g)). No model was downloaded. Geometry is generated from drawing C04-091-OT Rev F (library/cad/py/catalog/microchip-mcp73831t-2aci-ot.py).",
        source: [SRC.product, SRC.cadSnapEda],
      },
    },
    {
      type: "assumption",
      params: {
        field: "VBAT voltage lower bound",
        value: "0 V",
        reason: "The data sheet gives no minimum VBAT: preconditioning applies below 66.5 % of VREG with no floor, so the pin follows the cell from 0 V up to VREG (4.232 V max).",
        source: SRC.datasheet,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "midpoints of each drawing range (A2 1.095, A1 0.075, L 0.45, c 0.17, b 0.355); body top 1.17 mm; lead shoulder top 0.60 mm; pin-1 dimple 0.3 mm",
        reason: "Drawing C04-091-OT gives only min/max limits for these (A1 max 0.15 with no minimum) and no shoulder height or pin-1 mark size; the representative model needs single values.",
        source: SRC.datasheet,
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "Microchip MCP73831/2 data sheet DS20001984H", type: "datasheet", url: SRC.datasheet },
    { id: "art_product", name: "Microchip MCP73831 product page", type: "documentation", url: SRC.product },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from drawing C04-091-OT Rev F. Seating plane z = 0,
// body centred on the origin, pins 1-3 on -X (pin 1 at +Y), pins 4-5 on +X
// (pin 4 opposite pin 3, pin 5 opposite pin 1).
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.16, centroid: [-1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.16, centroid: [-1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.16, centroid: [-1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.16, centroid: [1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.16, centroid: [1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const MICROCHIP_MCP73831T_2ACI_OT: ModuleDef = withGeometry(
  MICROCHIP_MCP73831T_2ACI_OT_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    supply: { refs: [PIN_FEATURES.pin_4, PIN_FEATURES.pin_2] },
    battery_charge: { refs: [PIN_FEATURES.pin_3, PIN_FEATURES.pin_2] },
    // the leads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.799, centroid: [-0.235, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/microchip-mcp73831t-2aci-ot/artifacts/cad",
    name: "microchip-mcp73831-sot23-5",
    generator: "library/cad/py/catalog/microchip-mcp73831t-2aci-ot.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

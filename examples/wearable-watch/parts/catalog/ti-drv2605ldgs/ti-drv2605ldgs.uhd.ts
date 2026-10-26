/**
 * Texas Instruments DRV2605LDGSR haptic driver for LRA and ERM (VSSOP-10,
 * DGS) — datasheet-honest UHD part.
 *
 * Sources (see ./ti-drv2605ldgs/sources.json):
 *   - src_datasheet: TI DRV2605L datasheet SLOS854D (rev. March 2018), with
 *     package option addendum and DGS0010A outline —
 *     https://www.ti.com/lit/ds/symlink/drv2605l.pdf
 *   - src_product: TI DRV2605L product folder — https://www.ti.com/product/DRV2605L
 *   - src_part_details: TI DRV2605LDGSR part details —
 *     https://www.ti.com/product/DRV2605L/part-details/DRV2605LDGSR
 *   - src_cad_ultralibrarian: Ultra Librarian download page (terms forbid
 *     redistribution; no model downloaded).
 *
 * Modelling notes:
 *   - Variant: the bare IC in the DGS (VSSOP-10) package, orderable as
 *     DRV2605LDGSR (active, 2500 T&R; DRV2605LDGST is the same device on a
 *     250 reel). The DSBGA-9 (YZF) package, the DRV2605 (no L) and the
 *     automotive DRV2605L-Q1 are different parts and are not merged here.
 *   - All 10 pins are leaves `pin_1`..`pin_10` from the §5 DGS Pin Functions
 *     table, with designators and verbatim `pin_functions` traits. The DGS
 *     package has no exposed pad.
 *   - Composed interfaces: `i2c` (target, fixed 0x5A, SDA pin 3 / SCL pin 2),
 *     `supply` (VDD pin 10, optional VDD/NC pin 6, GND pin 8) and
 *     `actuator_output` (OUT+ pin 7 / OUT- pin 9). The haptic drive has no
 *     builder; it mirrors ti-drv8871's brushed DC output (power output leaves
 *     with capability motor_out, slots phase_a/phase_b), recorded as a
 *     vocabulary gap in .research/gaps.json.
 *   - Logic pins (SCL, SDA, IN/TRIG, EN) carry voltage 0-5.2 V: they are
 *     VDD-tolerant (absolute max VDD + 0.3 V) and VDD is at most 5.2 V; the
 *     real limit is the actual VDD (usage_note on `i2c`).
 *   - REG (pin 1) is the internal 1.8 V regulator output and only takes its
 *     1 uF capacitor; the datasheet gives no external load rating.
 *   - The output has no current rating in the datasheet; it limits the load
 *     instead (>= 8 ohm at VDD 5.2 V, over-current at 4 ohm), so
 *     `actuator_output` carries no max_current (data_gap trait).
 *   - `supply` and pin 10 carry current_draw 0.5 mA, the quiescent current
 *     with no signal; actuator current also flows through VDD (usage_note).
 *   - VDD capacitor: 1 uF (pin table, Table 32) vs 0.1 uF (§9.2.2.2) is a
 *     source_discrepancy trait.
 *   - Geometry: generated from drawing DGS0010A (no redistributable
 *     manufacturer CAD: TI routes CAD to Ultra Librarian, whose terms forbid
 *     redistribution). Bare IC: no bolt pattern. Each pin leaf refs its foot
 *     (`pin_N`), the composed interfaces ref their pins' feet, and
 *     `pcb_mount` refs all ten feet with a frame on the seating plane.
 *     Nominal (midpoint) dimensions; body height, standoff and lead shoulder
 *     are assumption traits.
 *   - verify-part may report "no mechanical bolt pattern": intended, a bare
 *     SMD IC is soldered by its leads.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { I2C, PowerIn, PowerOut, currentDrawA, defineModule, maxFrequencyHz, pinTable, voltageRangeV } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.ti.com/lit/ds/symlink/drv2605l.pdf",
  product: "https://www.ti.com/product/DRV2605L",
  partDetails: "https://www.ti.com/product/DRV2605L/part-details/DRV2605LDGSR",
  cadUltraLibrarian: "https://vendor.ultralibrarian.com/TI/embedded/?gpn=DRV2605L&package=DGS&pin=10",
} as const;

const VDD: [number, number] = [2, 5.2]; // §6.3
const LOGIC: [number, number] = [0, 5.2]; // §6.1: VDD + 0.3 V abs max; VDD <= 5.2 V (§6.3)
const OUT: [number, number] = [0, 5.2]; // §8.5.2.2: output cannot exceed VDD
const IQ_A = 0.0005; // §6.5: quiescent 0.5 mA typ, no signal

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — §5 Pin Functions, DGS package (10-pin VSSOP, top view)
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "REG",
      type: "power_out",
      voltageV: 1.83,
      description: "REG (O) — The REG pin is the 1.8-V regulator output. A 1-µF capacitor required.",
      traits: [
        note("V(REG) 1.83 V typ. Place a 1 uF X5R/X7R capacitor from REG to ground, close to the pin. Internal rail only: no external load rating is given. A REG short is current-limited and the device is not functional until it is removed.", "§6.5, §8.3.12.3, §9.2.2.2, §11.1"),
      ],
    },
    {
      pin: 2,
      name: "SCL",
      type: "input",
      capabilities: ["i2c_scl"],
      description: "SCL (I) — I2C clock.",
    },
    {
      pin: 3,
      name: "SDA",
      type: "io",
      capabilities: ["i2c_sda", "open_drain"],
      description: "SDA (I/O) — I2C data.",
    },
    {
      pin: 4,
      name: "IN/TRIG",
      type: "input",
      capabilities: ["pwm_in", "analog_in", "trigger_in"],
      protocols: [{ type: "analog", roles: ["input"] }],
      description: "IN/TRIG (I) — Multi-mode Input. I2C is selectable as PWM, analog, or trigger. If not used, this pin should be connected to GND.",
      traits: [
        note("PWM input 10-250 kHz (0-100 % duty); analog input 0-1.8 V (audio-to-vibe full scale 1.8 Vpp, 1 uF optional AC-coupling capacitor; 100 kohm to V(CM_ANA) 0.9 V); trigger input: edge or level trigger of the GO bit. Connect to GND when unused.", "§6.3, §6.5, §8.3.5.6, Table 32"),
      ],
    },
    {
      pin: 5,
      name: "EN",
      type: "input",
      capabilities: ["enable"],
      description: "EN (I) — Device enable",
      traits: [
        note("EN high = active, EN low = shutdown (registers kept). EN must be high to write I2C registers; with EN low the device can still ACK but no read or write is possible. 2 Mohm internal pull-down, so the device is in shutdown when EN floats.", "§6.5, §8.4.1.3"),
      ],
    },
    {
      pin: 6,
      name: "VDD/NC",
      type: "power_in",
      voltageV: VDD,
      description: "VDD/NC (P) — Optional supply input. This pin should be tied to VDD or left floating.",
    },
    {
      pin: 7,
      name: "OUT+",
      type: "power_out",
      voltageV: OUT,
      capabilities: ["power_out", "motor_out", "haptic_out"],
      description: "OUT+ (O) — Positive haptic driver differential output",
    },
    { pin: 8, name: "GND", type: "ground", description: "GND (P) — Supply ground" },
    {
      pin: 9,
      name: "OUT-",
      type: "power_out",
      voltageV: OUT,
      capabilities: ["power_out", "motor_out", "haptic_out"],
      description: "OUT– (O) — Negative haptic driver differential output",
    },
    {
      pin: 10,
      name: "VDD",
      type: "power_in",
      voltageV: VDD,
      description: "VDD (P) — Supply Input (2 V to 5.2 V). A 1-µF capacitor is required.",
    },
  ],
  { source: `${SRC.datasheet} (§5 Pin Functions, DGS package)`, logicV: LOGIC },
).map((p) => {
  if (p.id === "pin_10") return { ...p, parameters: [...(p.parameters ?? []), currentDrawA(IQ_A)] };
  // §6.3: PWM input frequency 10-250 kHz on IN/TRIG
  if (p.id === "pin_4") return { ...p, parameters: [...(p.parameters ?? []), maxFrequencyHz([10_000, 250_000])] };
  return p;
});

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const i2c = withTraits(
  I2C({ id: "i2c", name: "I2C (target)", roles: ["slave"], clockFreqHz: [0, 400_000], address: 0x5a, sda: pinId(3), scl: pinId(2), defaultActive: true })[0],
  [
    note(
      "7-bit address 0x5A, fixed (0xB4 write / 0xB5 read). SCL up to 400 kHz. 1.8 V logic thresholds (VIL <= 0.5 V, VIH >= 1.3 V), tolerant up to VDD: SDA and SCL must not exceed VDD (absolute max VDD + 0.3 V). External pull-ups 660 ohm to 4.7 kohm (2.2 kohm typical). EN must be high to write registers. A stalled transaction is reset by a 4.33 ms watchdog, except in standby.",
      "§6.1, §6.3, §6.6, §8.3.11, §8.5.3.1, Table 32",
    ),
  ],
);

const supply: InterfaceDef = {
  ...PowerIn({ id: "supply", name: "Supply (VDD + GND)", voltageV: VDD, parameters: [currentDrawA(IQ_A)] }),
  slots: [
    { id: "vdd", required: true, match: { protocol: "power", role: "input" } },
    { id: "vdd_nc", required: false, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vdd_pins", label: "VDD 10, VDD/NC 6, GND 8", default_active: true, bindings: { vdd: pinId(10), vdd_nc: pinId(6), gnd: pinId(8) } }],
  bridgesTo: ["actuator_output"],
  traits: [
    note(
      "2-5.2 V (below 2 V not recommended; 5.5 V absolute max), runs directly from a Li-ion cell. Shutdown (EN = 0) 4 uA typ / 7 uA max; standby (STANDBY = 1) 4.1 / 7 uA; quiescent with no signal 0.5 / 0.65 mA; average 2.4 mA (LRA) / 2.3 mA (ERM), 3.5 mA max at 90 % duty with no load. The actuator current is drawn through VDD as well and is not in current_draw.",
      "§6.3, §6.5, §8.4.1.1-8.4.1.2",
    ),
    note("1 uF X5R/X7R capacitor from VDD to GND, placed close to the VDD pin. Tie VDD/NC (pin 6) to VDD or leave it floating.", "§5, Table 32, §11.1"),
  ],
};

const actuatorOutput: InterfaceDef = {
  id: "actuator_output",
  name: "Haptic actuator output (OUT+ / OUT-)",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "power", roles: ["output"] }],
  capabilities: ["haptic_out", "lra_drive", "erm_drive"],
  parameters: [voltageRangeV(OUT[0], OUT[1])],
  slots: [
    { id: "phase_a", required: true, match: { protocol: "power", role: "output", capability: "motor_out" } },
    { id: "phase_b", required: true, match: { protocol: "power", role: "output", capability: "motor_out" } },
  ],
  profiles: [{ id: "out_pair", label: "OUT+ / OUT- (pins 7 / 9)", default_active: true, bindings: { phase_a: pinId(7), phase_b: pinId(9) } }],
  max_instances: 1,
  traits: [
    note(
      "Differential switching output for one LRA (125-300 Hz, closed-loop auto-resonance) or one ERM. PWM output 20.5 kHz typ (19.5-21.5). Peak amplitude set by OD_CLAMP (LRA: 21.22 mV x OD_CLAMP) and RATED_VOLTAGE; the output cannot exceed VDD. Load >= 8 ohm at VDD 5.2 V; a load below the 4 ohm threshold latches OC_DETECT and shuts the output down. Output impedance in shutdown 15 kohm to GND.",
      "§6.3, §6.5, §6.7, §8.3.12.2, §8.5.2.2",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "VSSOP-10 (DGS) leads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "vssop_10_dgs",
        note: "10 gull-wing leads, pitch 0.5 mm, width 0.17-0.27, thickness 0.13-0.23, foot 0.4-0.7 mm; body 2.9-3.1 x 2.9-3.1 mm, span 4.75-5.05 mm, 1.1 mm max height; no exposed pad. MSL Level-2-260C-1 YEAR, NIPDAUAG | SN finish.",
        source: `${SRC.datasheet} (DGS0010A; package option addendum)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const TI_DRV2605LDGS_BASE: ModuleDef = defineModule({
  id: "ti-drv2605ldgs",
  name: "TI DRV2605L haptic driver (VSSOP-10)",
  version: "1.0.0",
  manufacturer: "Texas Instruments",
  part_number: "DRV2605LDGSR",
  description:
    "Texas Instruments DRV2605L haptic driver for LRA and ERM actuators in the 10-pin VSSOP (DGS) package: 2-5.2 V supply, I2C target at fixed address 0x5A (400 kHz), licensed Immersion TouchSense 2200 effect library, closed-loop LRA auto-resonance (125-300 Hz), PWM/analog/trigger input on IN/TRIG, differential switching output, 4 uA shutdown.",
  tags: ["drv2605l", "texas-instruments", "ti", "haptic", "haptic-driver", "lra", "erm", "i2c", "vssop-10", "ic"],
  categories: ["actuator.haptic", "component.ic"],

  interfaces: [...pins, i2c, supply, actuatorOutput, pcbMount],

  interfaceGroups: [
    { id: "required_supply_pins", label: "VDD (10) and GND (8)", members: [pinId(10), pinId(8)], policy: "all_of" },
    { id: "output_pair", label: "OUT+ (7) and OUT- (9) drive one actuator", members: [pinId(7), pinId(9)], policy: "all_of" },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vdd", name: "Supply (VDD)", voltage_range_V: VDD },
        { id: "reg", name: "Internal 1.8 V regulator (REG)", nominal_voltage_V: 1.83, regulation_type: "regulated" },
      ],
      metadata: {
        logic_levels: { vil_max_V: 0.5, vih_min_V: 1.3, sda_vol_max_V: 0.4, sda_vol_condition: "IOL 4 mA" },
        supply_current_uA: { shutdown: [4, 7], standby: [4.1, 7], quiescent_no_signal: [500, 650] },
        en_pulldown_ohm: 2e6,
        pwm_output_frequency_kHz: [19.5, 20.5, 21.5],
        startup_time_ms: { from_go_or_trigger: 0.7, from_en_pwm_analog: 1.5 },
        source: `${SRC.datasheet} (§6.3, §6.5, §6.7)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 3.0, width: 4.9, height: 1.1 },
      package: {
        name: "VSSOP-10",
        code: "DGS (DGS0010A)",
        pin_count: 10,
        pitch_mm: 0.5,
        exposed_pad: false,
        source: `${SRC.datasheet} (Device Information: VSSOP (10) 3.00 mm × 3.00 mm; §5 "DGS Package 10-Pin VSSOP"; DGS0010A outline: body 2.9-3.1 × 2.9-3.1, span 4.75-5.05, 8X 0.5 pitch, 1.1 mm max height, JEDEC MO-187 BA); ${SRC.product} (VSSOP (DGS) 10: 14.7 mm², 3 mm × 4.9 mm)`,
      },
      metadata: {
        body_mm: "2.9-3.1 x 2.9-3.1; lead span 4.75-5.05; height 1.1 max",
        dimensions_note: "length along the pin rows (body), width across the leads (span), height is the drawing maximum",
        mounting_method: "surface_mount",
        msl: "Level-2-260C-1 YEAR",
        marking: "05L",
        source: SRC.datasheet,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: { junction_C: [-40, 150], storage_C: [-65, 150], source: `${SRC.datasheet} (§6.1; addendum)` },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        vdd_V: [-0.3, 5.5],
        en_sda_scl_in_trig_V: "-0.3 to VDD + 0.3",
        junction_temperature_C: [-40, 150],
        storage_temperature_C: [-65, 150],
        esd: "VSSOP: HBM ±500 V (OUT+, OUT-), ±1000 V other pins; CDM ±250 V",
        source: `${SRC.datasheet} (§6.1, §6.2)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vdd_V: VDD,
        ambient_temperature_C: [-40, 85],
        pwm_input_frequency_kHz: [10, 250],
        analog_input_V: [0, 1.8],
        load_impedance_min_ohm: 8,
        load_impedance_condition: "VDD = 5.2 V",
        lra_frequency_Hz: [125, 300],
        logic_vil_max_V: 0.5,
        logic_vih_min_V: 1.3,
        source: `${SRC.datasheet} (§6.1, §6.3)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "haptic_driver",
        actuators: ["LRA", "ERM"],
        channels: 1,
        features: "Smart-loop: automatic overdrive and braking, LRA auto-resonance tracking and reporting, actuator diagnostics, level auto-calibration; licensed Immersion TouchSense 2200 (over 100 effects: 6 ERM libraries, 1 LRA library), audio-to-vibe; I2C real-time playback; PWM/analog/trigger input",
        pwm_output_frequency_kHz: 20.5,
        overcurrent_load_threshold_ohm: 4,
        protection: "thermal shutdown (OVER_TEMP), actuator over-current latch (OC_DETECT), REG over-current limit",
        source: `${SRC.datasheet} (§1, §6.5, §6.7, §8.3.12)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "external components and layout",
        note: "C(VDD) 1 uF, C(REG) 1 uF, optional C(IN) 1 uF AC coupling on IN/TRIG, I2C pull-ups 2.2 kohm typical. Place the VDD and REG capacitors close to their pins.",
        source: `${SRC.datasheet} (Table 32, §11.1)`,
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "VDD decoupling capacitor",
        values: ["1 uF required (§5 pin table; Table 32 C(VDD), changed from 0.1 uF in the revision history)", "0.1 uF low-ESR X5R/X7R near VDD (§9.2.2.2)"],
        sources: [SRC.datasheet],
        resolution: "1 uF: the pin table and Table 32 are the specification; §9.2.2.2 was not updated with them.",
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Orderable DRV2605LDGSR (active, 2500 large T&R, marking 05L); DRV2605LDGST is the same device on a 250 small reel. DRV2605LYZF (DSBGA-9) and the automotive DRV2605L-Q1 are separate parts.",
        source: [`${SRC.datasheet} (package option addendum)`, SRC.partDetails],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "output current rating",
        note: "No continuous or peak output current is stated; the datasheet limits the load instead (>= 8 ohm at VDD 5.2 V, over-current at 4 ohm), so actuator_output has no max_current.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "DGS thermal resistance",
        note: "§6.4 gives thermal metrics for the YZF (DSBGA) package only (RθJA 145.2 °C/W); none for DGS.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "TI's product folder offers the VSSOP (DGS) 3D model only through Ultra Librarian, whose End User Subscription Agreement forbids redistribution; no model was downloaded. Geometry is generated from the DGS0010A outline (library/cad/py/catalog/ti-drv2605ldgs.py).",
        source: [SRC.product, SRC.cadUltraLibrarian],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal = midpoint of each drawing range (body 3.0 x 3.0, span 4.9, lead 0.22 x 0.18, foot 0.55); body underside 0.10 mm above the seating plane, body top 1.0 mm, lead shoulder top 0.55 mm; pin-1 dimple 0.4 mm",
        reason: "DGS0010A gives only min/max limits (standoff 0.05-0.15, height 1.1 max) and no shoulder height or pin-1 mark size; the representative model needs single values.",
        source: SRC.datasheet,
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "TI DRV2605L datasheet SLOS854D", type: "datasheet", url: SRC.datasheet },
    { id: "art_product", name: "TI DRV2605L product folder", type: "documentation", url: SRC.product },
    { id: "art_part_details", name: "TI DRV2605LDGSR part details", type: "documentation", url: SRC.partDetails },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from drawing DGS0010A. Seating plane z = 0, body
// centred on the origin, pins 1-5 on -X (pin 1 at +Y), 6-10 on +X (pin 6 at -Y).
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.121, centroid: [-2.175, 1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.121, centroid: [-2.175, 0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.121, centroid: [-2.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.121, centroid: [-2.175, -0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.121, centroid: [-2.175, -1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.121, centroid: [2.175, -1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.121, centroid: [2.175, -0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.121, centroid: [2.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.121, centroid: [2.175, 0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.121, centroid: [2.175, 1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const TI_DRV2605LDGS: ModuleDef = withGeometry(
  TI_DRV2605LDGS_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    i2c: { refs: [PIN_FEATURES.pin_3, PIN_FEATURES.pin_2] },
    supply: { refs: [PIN_FEATURES.pin_10, PIN_FEATURES.pin_6, PIN_FEATURES.pin_8] },
    actuator_output: { refs: [PIN_FEATURES.pin_7, PIN_FEATURES.pin_9] },
    // the leads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 1.21, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/ti-drv2605ldgs/artifacts/cad",
    name: "ti-drv2605l-dgs10",
    generator: "library/cad/py/catalog/ti-drv2605ldgs.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

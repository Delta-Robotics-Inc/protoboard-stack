/**
 * Analog Devices (Maxim Integrated) MAX17048G+T10 1-cell ModelGauge fuel
 * gauge (8 TDFN-EP, T822+3, tape and reel) — datasheet-honest UHD part.
 *
 * Sources (see ./adi-max17048g-t10/sources.json):
 *   - src_datasheet: MAX17048/MAX17049 datasheet 19-6171 Rev 7 (11/16) —
 *     https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf
 *     (p.2-3 ratings and electrical characteristics, p.6 pin descriptions,
 *     p.9-14 operation and registers, p.15 application circuit, p.16 I2C,
 *     p.18 ordering and package information). Read from the Internet
 *     Archive capture of that URL; byte-identical to the SparkFun and LCSC
 *     copies the briefs cite.
 *   - src_package_drawing: Maxim outline 21-0168 Rev M, 8L TDFN exposed pad
 *     2 x 2 x 0.75 mm — https://www.analog.com/media/en/package-pcb-resources/package/pkg_pdf/tdfn-ep/21-0168.pdf
 *   - src_product: ADI MAX17048 product page — https://www.analog.com/en/products/max17048.html
 *   - src_cad_search: where research looked for CAD (Ultra Librarian,
 *     SamacSys, SnapEDA; nothing downloaded).
 *
 * Modelling notes:
 *   - Variant: MAX17048G+T10 is the 1-cell gauge in the 8-pin TDFN-EP (G),
 *     lead-free (+), tape and reel (T10). The 8-bump WLP (X) and the 2-cell
 *     MAX17049 are different parts and are not merged here.
 *   - All 8 pins are leaves `pin_1`..`pin_8` from the p.6 pin table, with
 *     designators and verbatim `pin_functions` traits; the exposed pad is the
 *     leaf `ep` with the datasheet's own label "EP" (connect to GND).
 *   - VDD (pin 3) is both the supply and the cell-voltage sense input on the
 *     MAX17048: it connects straight to the cell, 2.5-4.5 V. It carries
 *     current_draw 23 uA, the active-mode typical (40 uA max); hibernate is
 *     3-4 uA (usage_note on `supply`).
 *   - CELL (pin 2) is not internally connected on the MAX17048, so it is type
 *     `nc`. The pin table and Figure 14 still connect it to the positive cell
 *     terminal (usage_note), which keeps the footprint common with the MAX17049.
 *   - CTG (pin 1) is an input the datasheet says to connect to ground; it
 *     carries voltage 0 V so a net check flags it on any other rail. QSTRT
 *     (pin 6) goes to GND when unused (Table 3).
 *   - SDA, SCL and ALRT carry voltage 0-5.5 V, the "Data I/O pins" range of
 *     the electrical characteristics; it does not depend on VDD, so the bus
 *     may be pulled up to a rail above or below the cell. QSTRT has only the
 *     -0.3 to +6 V absolute maximum; it is given the same 0-5.5 V range
 *     (assumption trait).
 *   - Composed interfaces: `i2c` (target, fixed 0x36, 0-400 kHz, SDA pin 8 /
 *     SCL pin 7) and `supply` (VDD pin 3, GND pin 4, EP). ALRT (pin 5) is an
 *     open-drain, active-low interrupt output on its own leaf.
 *   - The datasheet states bus-low sleep two ways (Note 6 vs the Sleep Mode
 *     section): source_discrepancy trait. The ADI product page calls the
 *     package LFCSP, the datasheet 8 TDFN-EP: the package fact uses the
 *     datasheet name (source_discrepancy trait).
 *   - Geometry: generated from outline 21-0168 (no downloadable manufacturer
 *     CAD: data_gap trait). Bare IC: no bolt pattern. Each pin leaf refs its
 *     terminal face (`pin_N`), `ep` the exposed pad, the composed interfaces
 *     their pins' faces, and `pcb_mount` all nine solder faces with a frame
 *     on the seating plane. Pad thickness and the pin-1 mark are assumption
 *     traits.
 *   - No thermal resistance and no mass are stated anywhere (data_gap traits).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { I2C, PowerIn, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf",
  drawing: "https://www.analog.com/media/en/package-pcb-resources/package/pkg_pdf/tdfn-ep/21-0168.pdf",
  product: "https://www.analog.com/en/products/max17048.html",
  cadSearch: "https://www.snapeda.com/parts/MAX17048G+T10/Maxim%20Integrated/view-part/",
} as const;

const VDD: [number, number] = [2.5, 4.5]; // p.2 electrical characteristics
const DATA_IO: [number, number] = [0, 5.5]; // p.2: SCL, SDA, ALRT -0.3 to +5.5 V
const IDD_ACTIVE_A = 23e-6; // p.2: IDD1 active mode 23 uA typ (40 uA max)

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — p.6 Pin/Bump Descriptions, TDFN column
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "CTG",
      type: "input",
      voltageV: 0,
      description: "CTG — Connect to Ground",
    },
    {
      pin: 2,
      name: "CELL",
      type: "nc",
      description: "CELL — Connect to the Positive Battery Terminal. MAX17048: Not internally connected. MAX17049: Voltage sense input.",
      traits: [note("On the MAX17048 CELL has no internal connection; the application circuit (Figure 14) ties it to the cell's positive terminal with VDD.", "p.6, p.15 Figure 14")],
    },
    {
      pin: 3,
      name: "VDD",
      type: "power_in",
      voltageV: VDD,
      description: "VDD — Power-Supply Input. Bypass with 0.1µF to GND. MAX17048: Voltage sense input. Connect to positive battery terminal.",
    },
    { pin: 4, name: "GND", type: "ground", description: "GND — Ground. Connect to negative battery terminal." },
    {
      pin: 5,
      name: "ALRT",
      type: "output",
      capabilities: ["open_drain", "interrupt", "active_low"],
      protocols: [{ type: "interrupt", roles: ["output"] }],
      description: "ALRT — Open-Drain, Active-Low Alert Output. Optionally connect to interrupt input of the system microcontroller.",
      traits: [
        note(
          "ALRT is driven low when an enabled alert fires (low SOC at CONFIG.ATHD, default 4 %; 1 % SOC change; VCELL above VALRT.MAX or below VALRT.MIN; reset) and stays low until software writes CONFIG.ALRT = 0. Alerts are enabled at power-up. VOL <= 0.4 V at 4 mA, 20 mA continuous sink absolute maximum. Needs an external pull-up if used; leave unconnected otherwise (Table 3).",
          "p.2, p.10 Alert Interrupt, Table 1, p.12 CONFIG, p.14-15",
        ),
      ],
    },
    {
      pin: 6,
      name: "QSTRT",
      type: "input",
      capabilities: ["quick_start"],
      description: "QSTRT — Quick-Start Input. Allows reset of the device through hardware. Connect to GND if not used.",
      traits: [note("A rising edge on QSTRT restarts the fuel-gauge calculation like a power-up (quick-start). Most systems should not use quick-start; tie QSTRT to GND unless a rising-edge reset signal drives it (Table 3). VIH >= 1.4 V, VIL <= 0.5 V.", "p.2, p.9 Quick-Start, Table 3")],
    },
    {
      pin: 7,
      name: "SCL",
      type: "input",
      capabilities: ["i2c_scl"],
      description: "SCL — I2C Clock Input. SCL has an internal pulldown (IPD) for sensing disconnection.",
    },
    {
      pin: 8,
      name: "SDA",
      type: "io",
      capabilities: ["i2c_sda", "open_drain"],
      description: "SDA — Open-Drain I2C Data Input/Output. SDA has an internal pulldown (IPD) for sensing disconnection.",
    },
    { pin: "EP", id: "ep", name: "EP", type: "ground", description: "EP — Exposed Pad (TDFN Only). Connect to GND." },
  ],
  { source: `${SRC.datasheet} (p.6 Pin/Bump Descriptions)`, logicV: DATA_IO },
).map((p) => (p.id === "pin_3" ? { ...p, parameters: [...(p.parameters ?? []), currentDrawA(IDD_ACTIVE_A)] } : p));

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const i2c = withTraits(
  I2C({ id: "i2c", name: "I2C (target)", roles: ["slave"], clockFreqHz: [0, 400_000], address: 0x36, sda: pinId(8), scl: pinId(7), defaultActive: true })[0],
  [
    note(
      "Slave only. 7-bit address 0b0110110 (0x36), fixed: 0x6C write / 0x6D read. fSCL 0-400 kHz, bus capacitance <= 400 pF, SCL/SDA input capacitance 60 pF. VIH >= 1.4 V, VIL <= 0.5 V, SDA VOL <= 0.4 V at 4 mA; SDA, SCL -0.3 to +5.5 V whatever VDD is. The system provides the pull-ups. Registers are 16-bit words; 8-bit writes have no effect.",
      "p.2-3, p.10 Register Summary, p.14, p.16 I2C Bus System",
    ),
    note(
      "SDA and SCL have internal pull-downs (0.2 uA typ, 0.4 uA max, always present) to sense disconnection. With MODE.EnSleep = 1, holding both low for tSLEEP (1.75-2.5 s) puts the IC in sleep (below 1 uA), and a rising edge on SDA or SCL wakes it. A bus that idles high does not trigger it.",
      "p.2 IPD and tSLEEP, p.10 Sleep Mode",
    ),
  ],
);

const supply: InterfaceDef = {
  ...PowerIn({ id: "supply", name: "Cell supply and sense (VDD + GND + EP)", voltageV: VDD, parameters: [currentDrawA(IDD_ACTIVE_A)] }),
  slots: [
    { id: "vdd", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
    { id: "ep", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "cell_pins", label: "VDD 3, GND 4, EP", default_active: true, bindings: { vdd: pinId(3), gnd: pinId(4), ep: "ep" } }],
  traits: [
    note(
      "Power VDD directly from the single Li-ion/LiPo cell (2.5-4.5 V): the MAX17048 measures VCELL between VDD and GND (range 2.5-5 V), so VDD must be on the cell, not a regulated rail. GND to the cell's negative terminal, EP to GND. Bypass VDD with 0.1 uF to GND.",
      "p.2, p.6, p.10 VCELL Register, p.15 Figure 14 and Table 3",
    ),
    note(
      "Supply current: active 23 uA typ / 40 uA max; hibernate 3 uA typ / 5 uA max with the reset comparator disabled (VRESET.Dis = 1), 4 uA typ with it enabled; sleep 0.5 uA typ / 2 uA max (TA <= 50 C). The IC enters and leaves hibernate automatically by default (HIBRT 0x8030); ADC sample period 250 ms active, 45 s hibernate.",
      "p.2, p.9 Hibernate Mode, p.12 HIBRT Register",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "TDFN-8 terminals and exposed pad (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "Eight bottom terminals and the exposed pad are soldered to the board; the package is the mechanical domain's package fact. Reflow peak 260 C; lead temperature 300 C for 10 s (TDFN only).",
        source: [`${SRC.datasheet} (p.2 Absolute Maximum Ratings, p.18 Package Information)`, SRC.drawing],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ADI_MAX17048G_T10_BASE: ModuleDef = defineModule({
  id: "adi-max17048g-t10",
  name: "ADI MAX17048 1-cell fuel gauge (TDFN-8)",
  version: "1.0.0",
  manufacturer: "Analog Devices (Maxim Integrated)",
  part_number: "MAX17048G+T10",
  description:
    "Analog Devices (Maxim) MAX17048 ModelGauge fuel gauge for one Li-ion/LiPo cell in the 8-pin 2 x 2 mm TDFN-EP: powered from and measuring the cell on VDD (2.5-4.5 V), no sense resistor, +-7.5 mV/cell voltage measurement, state of charge and charge rate over I2C at fixed address 0x36 (400 kHz), open-drain ALRT output, 23 uA active / 3 uA hibernate.",
  tags: ["max17048", "analog-devices", "maxim", "fuel-gauge", "battery", "li-ion", "lipo", "1s", "modelgauge", "i2c", "tdfn-8", "ic"],
  categories: ["power.monitor"],

  interfaces: [...pins, i2c, supply, pcbMount],

  interfaceGroups: [
    { id: "required_supply_pins", label: "VDD (3), GND (4) and EP", members: [pinId(3), pinId(4), "ep"], policy: "all_of" },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "vdd", name: "VDD (cell, supply and sense)", voltage_range_V: VDD }],
      metadata: {
        supply_current_uA: { active: [23, 40], hibernate_comparator_disabled: [3, 5], hibernate_comparator_enabled: 4, sleep: [0.5, 2] },
        voltage_measurement_range_V: [2.5, 5],
        logic_levels: { vih_min_V: 1.4, vil_max_V: 0.5, vol_max_V: 0.4, vol_condition: "IOL 4 mA (SDA, ALRT)" },
        bus_pulldown_uA: [0.2, 0.4],
        bus_low_timeout_s: [1.75, 2.5],
        reset_threshold_V: { range: [2.28, 3.48], step_mV: 40, trimmed_at_3V: [2.85, 3.0, 3.15] },
        source: `${SRC.datasheet} (p.2-3 Electrical Characteristics)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.0, width: 2.0, height: 0.75 },
      package: {
        name: "TDFN-8",
        code: "T822+3 (outline 21-0168)",
        pin_count: 8,
        pitch_mm: 0.5,
        exposed_pad: true,
        exposed_pad_pin: "EP",
        exposed_pad_mm: [1.2, 0.8],
        source: `${SRC.datasheet} (p.18: 8 TDFN-EP, package code T822+3, outline 21-0168; p.6 EP); ${SRC.drawing} (Rev M: D, E 1.90/2.00/2.10, A 0.70/0.75/0.80, e 0.50, b 0.25, L 0.30; T822-3 E2 1.20 x D2 0.80 ±0.10)`,
      },
      metadata: {
        height_range_mm: [0.7, 0.8],
        dimensions_note: "length along the lead rows (E), width across them (D), height is the drawing nominal A; exposed_pad_mm is E2 x D2",
        mounting_method: "surface_mount",
        source: SRC.drawing,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: { specified_C: [-20, 70], storage_C: [-55, 125], reflow_peak_C: 260, source: `${SRC.datasheet} (p.2, p.18)` },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        cell_to_gnd_V: [-0.3, 12],
        all_other_pins_V: [-0.3, 6],
        sda_alrt_continuous_sink_mA: 20,
        operating_temperature_C: [-40, 85],
        storage_temperature_C: [-55, 125],
        lead_temperature_C: "300 (TDFN only, soldering, 10 s)",
        reflow_C: 260,
        source: `${SRC.datasheet} (p.2 Absolute Maximum Ratings)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vdd_V: VDD,
        data_io_V: [-0.3, 5.5],
        ambient_temperature_C: [-40, 85],
        electrical_characteristics_temperature_C: [-20, 70],
        source: `${SRC.datasheet} (p.2 Electrical Characteristics; p.18 Ordering Information)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "fuel_gauge",
        cells: 1,
        algorithm: "ModelGauge (voltage-based battery model; no current-sense resistor, no learning cycles)",
        voltage_error_mV_per_cell: { at_3V6_25C: 7.5, over_range: 20 },
        voltage_resolution_mV_per_cell: 1.25,
        vcell_lsb_uV: 78.125,
        soc_lsb_percent: 1 / 256,
        crate_lsb_percent_per_hr: 0.208,
        adc_sample_period: { active_ms: 250, hibernate_s: 45 },
        time_base_accuracy_percent: 3.5,
        startup: "OCV estimate ready 17 ms after battery insertion (best of 16 samples), SOC 175 ms after that; first SOC update about 1 s after POR",
        alerts: ["low SOC (1-32 %)", "1 % SOC change", "VCELL overvoltage", "VCELL undervoltage", "reset (VRESET)"],
        id_register: "8-bit one-time-programmable ID",
        source: `${SRC.datasheet} (p.1, p.2, p.8, p.10-13)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "firmware",
        note: "For best accuracy the host measures battery temperature at least once a minute and updates CONFIG.RCOMP (RCOMP0 0x97, TempCoUp -0.5, TempCoDown -5.0 by default). STATUS.RI is set at power-up: load the model and clear it. For a captive (non-removable) cell set VRESET to 2.5 V. Writing 0x5400 to CMD (0xFE) resets the IC as at power-on.",
        source: `${SRC.datasheet} (p.8 Temperature Compensation, p.13 VRESET/ID, p.14 STATUS and CMD)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "MAX17048G+T10: 8 TDFN-EP, -40 to +85 C, lead-free, tape and reel; MAX17048G+ is the same device without the reel. Lifecycle PRODUCTION (PCN 2455A, assembly, Feb 2025). MAX17048X+ (8-bump WLP) and the 2-cell MAX17049 are separate parts.",
        source: [`${SRC.datasheet} (p.18 Ordering Information)`, SRC.product],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "bus-low sleep",
        values: [
          "Note 6 (p.3): the IC enters shutdown mode after SCL < VIL and SDA < VIL for longer than 2.5 s",
          "Sleep Mode (p.10): sleep needs MODE.EnSleep = 1 and then SDA and SCL held low for tSLEEP, or CONFIG.SLEEP = 1",
        ],
        sources: [SRC.datasheet],
        resolution: "The Sleep Mode section is the more specific statement and is the one recorded on `i2c`; firmware should not rely on either and should keep the bus idling high.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "package name",
        values: ["8 TDFN-EP, package code T822+3 (datasheet p.18; outline 21-0168)", "LFCSP (ADI product page part table)"],
        sources: [SRC.datasheet, SRC.product],
        resolution: "The package fact uses the datasheet name TDFN-8 with its code; the outline drawing is the same either way.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "QSTRT voltage range",
        value: "0-5.5 V",
        reason: "The electrical characteristics give the -0.3 to +5.5 V data I/O range for SCL, SDA and ALRT only; QSTRT has just the -0.3 to +6 V absolute maximum. The data I/O range is used as the conservative operating limit.",
        source: `${SRC.datasheet} (p.2)`,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal body 2.00 x 2.00 x 0.75 mm, terminals 0.25 x 0.30 mm, exposed pad 1.20 x 0.80 mm with C0.25 chamfer; terminal and pad thickness 0.02 mm below the body; pin-1 dimple 0.30 mm diameter, 0.03 mm deep",
        reason: "Outline 21-0168 gives the nominal or toleranced plan dimensions used here, but no terminal thickness (only A1 0-0.05 mm) and no size for the pin-1 index mark.",
        source: SRC.drawing,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The ADI product page offers CAD symbols, footprints and 3D models only through Ultra Librarian and SamacSys; SnapEDA has a model page. All need an account and their own terms, none was downloaded, and no licence permitting redistribution is stated. Geometry is generated from outline 21-0168 (library/cad/py/catalog/adi-max17048g-t10.py).",
        source: [SRC.product, SRC.cadSearch],
      },
    },
    {
      type: "data_gap",
      params: { field: "thermal resistance", note: "The datasheet gives no theta-JA or theta-JC for the TDFN package.", source: SRC.datasheet },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "Neither the datasheet nor the outline drawing states a mass.", source: [SRC.datasheet, SRC.drawing] },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "MAX17048/MAX17049 datasheet 19-6171 Rev 7", type: "datasheet", url: SRC.datasheet },
    { id: "art_package_drawing", name: "Package outline 21-0168 Rev M (8L TDFN-EP 2x2x0.75)", type: "documentation", url: SRC.drawing },
    { id: "art_product", name: "ADI MAX17048 product page", type: "documentation", url: SRC.product },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from outline 21-0168. Seating plane z = 0, body centred
// on the origin, x along the lead rows; pins 1-4 on -y (pin 1 at -x), pins
// 5-8 on +y (pin 5 at +x), as in the datasheet top view.
// ---------------------------------------------------------------------------

const PAD_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.075, centroid: [-0.75, -0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.075, centroid: [-0.25, -0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.075, centroid: [0.25, -0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.075, centroid: [0.75, -0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.075, centroid: [0.75, 0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.075, centroid: [0.25, 0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.075, centroid: [-0.25, 0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.075, centroid: [-0.75, 0.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  ep: feature("ep", { area_mm2: 0.929, centroid: [0.017, 0.011, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const ADI_MAX17048G_T10: ModuleDef = withGeometry(
  ADI_MAX17048G_T10_BASE,
  {
    ...Object.fromEntries(Object.entries(PAD_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    i2c: { refs: [PAD_FEATURES.pin_8, PAD_FEATURES.pin_7] },
    supply: { refs: [PAD_FEATURES.pin_3, PAD_FEATURES.pin_4, PAD_FEATURES.ep] },
    // terminals and exposed pad onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 1.529, centroid: [0.011, 0.006, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/adi-max17048g-t10/artifacts/cad",
    name: "adi-max17048-tdfn8",
    generator: "library/cad/py/catalog/adi-max17048g-t10.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

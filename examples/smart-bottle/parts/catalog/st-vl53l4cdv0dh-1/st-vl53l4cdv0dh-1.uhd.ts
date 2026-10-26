/**
 * STMicroelectronics VL53L4CD time-of-flight proximity sensor, order code
 * VL53L4CDV0DH/1 (bare module, Optical LGA12 with liner) — datasheet-honest
 * UHD part.
 *
 * Sources (see ./st-vl53l4cdv0dh-1/sources.json):
 *   - src_datasheet: VL53L4CD datasheet DS13812 Rev 8 (July 2024) —
 *     https://www.st.com/resource/en/datasheet/vl53l4cd.pdf
 *     (Table 1 specification, Figure 2 + Table 2 pins, Figure 3 + Tables 3-4
 *     application schematic, §2.7-2.9 power sequence and interrupt, §3 +
 *     Tables 5-6 I2C, Tables 9-15 ratings, supply, current and I/O levels,
 *     Tables 16-18 ranging, Figures 17-21 outline, §9 laser safety, §11
 *     handling, Table 20 order codes). The same bytes as
 *     adafruit-5396-vl53l4cd's datasheet (sha256 0beb3bb5…); st.com refused
 *     connections on 2026-10-03, and no later revision was found.
 *   - src_ul_cad_page: Ultra Librarian page for the order code (CAD terms
 *     only; the model was not downloaded).
 *
 * Modelling notes:
 *   - Variant: VL53L4CDV0DH/1 ships with a protective liner over the cap;
 *     VL53L4CDV9DH/1 is the same module without it (Table 20). The liner is
 *     removed just before the cover glass is fitted (§10.4), so the modelled
 *     state is without it (usage note).
 *   - All 12 pads are leaves `pin_1`..`pin_12` from Table 2, with
 *     designators and verbatim `pin_functions` traits. GND2-4 are standard
 *     pins that must be grounded (Table 2 note), so they are ground leaves.
 *     DNC (pin 8) "must be left floating": an `nc` leaf. There is no exposed
 *     pad.
 *   - Logic pins carry the IOVDD range 1.6-3.5 V (Table 12) as their voltage.
 *     IOVDD is not a pin: the I/Os are failsafe with no diode to AVDD (§5.2),
 *     so the level is set by the pull-ups.
 *   - Composed interfaces: `i2c` (target, 7-bit 0x29 = ST's 8-bit 0x52,
 *     0-1 MHz, SDA pin 9 / SCL pin 10) and `supply` (AVDD pin 11 + AVDDVCSEL
 *     pin 1 with GND pin 3 + AVSSVCSEL pin 2, 2.6-3.5 V, current_draw 22 mA,
 *     the typical ranging average; peak 40 mA in a usage note).
 *   - GPIO1 (pin 7) is an open-drain interrupt output, driven low when a
 *     result is ready (§2.9); XSHUT (pin 5) is the active-low shutdown input.
 *   - `rx_aperture` (collector) and `tx_aperture` (VCSEL emitter) are the two
 *     openings in the cap, with ST's exclusion cones, which a cover window
 *     must clear. No protocol covers an optical path: `custom` with
 *     capability optical_aperture, as adi-max30102efd does (vocabulary gap).
 *   - Package facts (Optical LGA12, 12 pads, 0.80 mm pitch, no exposed pad,
 *     4.40 x 2.40 x 1.00 mm) are the mechanical domain's `package`.
 *   - Geometry is generated from Figures 17-21 (no usable manufacturer CAD:
 *     data_gap trait). Bare IC: no bolt pattern. Each pin leaf refs its pad,
 *     the composed interfaces ref their pads, `pcb_mount` refs all 12 pads
 *     with a frame on the seating plane (normal -Z), and each aperture has a
 *     frame on the cap top (normal +Z, towards the target). The cap outline,
 *     aperture depth and pad thickness are assumption traits.
 *   - Mass and lifecycle status are not stated in the sources read
 *     (data_gap traits).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { I2C, PowerIn, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.st.com/resource/en/datasheet/vl53l4cd.pdf",
  ulCad: "https://app.ultralibrarian.com/details/872f5a58-6c94-11ec-9033-0a34d6323d74/STMicroelectronics/VL53L4CDV0DH-1",
} as const;

const DS = (where: string) => `${SRC.datasheet} (DS13812 Rev 8, ${where})`;

const AVDD: [number, number] = [2.6, 3.5]; // Table 12
const IOVDD: [number, number] = [1.6, 3.5]; // Table 12
const RANGING_TYP_A = 0.022; // Table 14: active ranging average, typical

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: DS(where) },
});

const GND_NOTE = "To be connected to main ground. GND2, GND3 and GND4 are standard pins that are forced to the ground domain in the application schematics to avoid possible instabilities if set to other states.";

// ---------------------------------------------------------------------------
// Pins — Figure 2 and Table 2
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "AVDDVCSEL",
      type: "power_in",
      voltageV: AVDD,
      nominalV: 2.8,
      description: "AVDDVCSEL — Supply. VCSEL supply, to be connected to main supply.",
    },
    [2, "AVSSVCSEL", "ground", "AVSSVCSEL — VCSEL ground, to be connected to main ground. AVSSVCSEL and GND are ground pins and can be connected together in the application schematics."],
    [3, "GND", "ground", "GND — Ground. To be connected to main ground."],
    [4, "GND2", "ground", `GND2 — Ground. ${GND_NOTE}`],
    {
      pin: 5,
      name: "XSHUT",
      type: "input",
      capabilities: ["shutdown", "active_low"],
      description: "XSHUT — Digital input. Xshutdown pin, active low.",
      traits: [
        note(
          "Low = HW STANDBY (no I2C communication); raise XSHUT only when AVDD is on, and the firmware boots within tBOOT 1.2 ms max. XSHUT must always be driven to avoid leakage current; fit a pull-up (10 kOhm recommended) if the host state is not known. Tied to AVDD through the pull-up, the device boots straight to SW STANDBY.",
          "§1.4, §2.7, Table 12 note 1",
        ),
      ],
    },
    [6, "GND3", "ground", `GND3 — Ground. ${GND_NOTE}`],
    {
      pin: 7,
      name: "GPIO1",
      type: "output",
      capabilities: ["interrupt", "open_drain", "active_low"],
      protocols: [{ type: "interrupt", roles: ["output"] }],
      description: "GPIO1 — Digital output. Interrupt output. Open drain output.",
      traits: [
        note(
          "Driven low when a ranging result is available; the driver clears it when the host reads the result, and ranging holds until it is cleared. ST strongly recommends this hardware interrupt over polling. Pull-up 10 kOhm to IOVDD recommended; leave unconnected if not used. VOL <= 0.4 V at 4 mA; VIH >= 0.7 IOVDD, VIL <= 0.3 IOVDD.",
          "§1.4, §2.9, Table 15",
        ),
      ],
    },
    [8, "DNC", "nc", "DNC — Digital input. Do not connect, must be left floating."],
    { pin: 9, name: "SDA", type: "io", capabilities: ["i2c_sda", "open_drain"], description: "SDA — Digital input/output. I²C serial data." },
    { pin: 10, name: "SCL", type: "input", capabilities: ["i2c_scl"], description: "SCL — Digital input. I²C serial clock input." },
    {
      pin: 11,
      name: "AVDD",
      type: "power_in",
      voltageV: AVDD,
      nominalV: 2.8,
      description: "AVDD — Supply. Supply, to be connected to main supply.",
    },
    [12, "GND4", "ground", `GND4 — Ground. ${GND_NOTE}`],
  ],
  { source: DS("§1.3 Figure 2, Table 2"), logicV: IOVDD },
);

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const i2c = withTraits(
  I2C({ id: "i2c", name: "I2C (target)", roles: ["slave"], clockFreqHz: [0, 1_000_000], address: 0x29, sda: pinId(9), scl: pinId(10), defaultActive: true })[0],
  [
    note(
      "Default address 0x52 write / 0x53 read in ST's 8-bit form (0b0101001 + R/W, 7-bit 0x29). Fast mode (400 kHz) and fast mode plus (1 MHz); 16-bit register index, auto-increment, 8/16/32-bit accesses MSB first. Pull-ups on the host, once per bus: fast mode 3.6 kOhm (CL <= 90 pF), 2.4 k (<= 140 pF), 1.2 k (<= 270 pF), 0.8 k (<= 400 pF); fast mode plus 1.5 k + 100 Ohm series ... 0.3 k + 50 Ohm (Tables 3-4, given for AVDD 1.8-2.8 V). SDA input/output capacitance 10 pF max, SCL 4 pF max. VIH 1.12-3.5 V, VIL -0.5-0.6 V, VOL 0.4 V at 4 mA. Model_ID register 0x010F reads 0xEB.",
      "Table 1, §1.4 Tables 3-4, §3, Figure 10, Tables 5-7, Table 15",
    ),
  ],
);

const supply: InterfaceDef = {
  ...PowerIn({ id: "supply", name: "Supply (AVDD + AVDDVCSEL, GND + AVSSVCSEL)", voltageV: AVDD, nominalV: 2.8, parameters: [currentDrawA(RANGING_TYP_A)] }),
  slots: [
    { id: "avdd", required: true, match: { protocol: "power", role: "input" } },
    { id: "avddvcsel", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
    { id: "avssvcsel", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [
    { id: "supply_pins", label: "AVDD 11, AVDDVCSEL 1, GND 3, AVSSVCSEL 2", default_active: true, bindings: { avdd: pinId(11), avddvcsel: pinId(1), gnd: pinId(3), avssvcsel: pinId(2) } },
  ],
  traits: [
    note(
      "Single 2.8 V supply nominal (2.6-3.5 V) on AVDD and AVDDVCSEL. Current at 23 C, 2.8 V, AVDD + AVDDVCSEL: HW standby 3/5/7 uA, SW standby 4/6/9 uA (min/typ/max); active ranging average 22 mA typ / 24 mA max with default driver settings; peak (with VCSEL) up to 40 mA. Ultralow power detection mode down to 55 uA (AN5870). Decouple with 100 nF + 4.7 uF from AVDD to GND as close as possible to the sensor (AVDDVCSEL/AVSSVCSEL pins). No supply sequencing requirement.",
      "Features, §1.4 Figure 3, §5.2, Table 14, §6.6",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "Optical LGA12 pads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "optical_lga12",
        note: "12 pads 0.50 mm square on the underside in a 5 x 3 grid at 0.80 mm pitch (both ways), the centre three positions empty; pad 1 has a 0.08 x 0.25 mm extension as the pin-1 mark. Body 4.40 x 2.40 mm (+-0.05), 1.00 mm (+0.05/-0.10) tall, substrate 0.31 mm. Reflowable: MSL 3, peak 240 C recommended / 260 C max, three passes max, dry (convection) reflow only, no-wash process. Maximum compressive load 25 N.",
        source: DS("Figures 17, 19; §11.3-11.5"),
      },
    },
  ],
};

const aperture = (id: string, name: string, text: string): InterfaceDef => ({
  id,
  name,
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["optical_aperture"],
  traits: [
    {
      type: "usage_note",
      params: {
        note: `${text} Face the target through a cover window; the window opening must be equal to or wider than the exclusion cone. With a cover glass, run crosstalk calibration as well as offset calibration (UM2931).`,
        source: DS("Figures 17, 18, 21; §2.3; §8"),
      },
    },
  ],
});

const rxAperture = aperture(
  "rx_aperture",
  "Rx (collector) aperture",
  "SPAD collector opening, dia 0.20 mm (0.201 on the second cap supplier), 0.665 mm from the short edge on the pins 5-7 end, on the long centreline. Exclusion cone 25 deg full angle: dia 0.22 at the cap top, 1.55 mm at 3 mm above it. Detection volume 22 deg at 100 mm, 18 deg at 1000 mm (Table 18).",
);

const txAperture = aperture(
  "tx_aperture",
  "Tx (VCSEL emitter) aperture",
  "940 nm VCSEL opening, dia 0.40 mm, 3.00 mm from the Rx aperture on the pin 1 end. Exclusion cone 29 deg full angle: dia 0.38 at the cap top, 1.93 mm at 3 mm above it. Field of illumination 16 x 16 deg (1/e²).",
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ST_VL53L4CDV0DH_1_BASE: ModuleDef = defineModule({
  id: "st-vl53l4cdv0dh-1",
  name: "ST VL53L4CD time-of-flight sensor (VL53L4CDV0DH/1, Optical LGA12)",
  version: "1.0.0",
  manufacturer: "STMicroelectronics",
  part_number: "VL53L4CDV0DH/1",
  description:
    "ST VL53L4CD time-of-flight high accuracy proximity sensor, bare module in Optical LGA12 4.4 x 2.4 x 1 mm (order code with protective liner): 940 nm Class 1 VCSEL and SPAD collector, 0-1200 mm with full FoV (1300 mm typical at 50 % detection, white target), linear from 1 mm, 18 deg diagonal FoV, up to 100 Hz, on-chip processing. Single 2.6-3.5 V supply (2.8 V nominal), 22 mA typical while ranging, 5 uA hardware standby; I2C target at 0x29 up to 1 MHz; open-drain interrupt (GPIO1) and active-low XSHUT.",
  tags: ["vl53l4cd", "st", "stmicroelectronics", "tof", "time-of-flight", "distance", "proximity", "liquid-level", "i2c", "0x29", "interrupt", "xshut", "lga-12", "ic"],
  categories: ["sensor.distance"],

  interfaces: [...pins, i2c, supply, pcbMount, rxAperture, txAperture],

  interfaceGroups: [
    {
      id: "required_supply_pins",
      label: "AVDD (11), AVDDVCSEL (1), GND (3), AVSSVCSEL (2), GND2-4 (4, 6, 12)",
      members: [pinId(11), pinId(1), pinId(3), pinId(2), pinId(4), pinId(6), pinId(12)],
      policy: "all_of",
    },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "avdd", name: "AVDD / AVDDVCSEL", nominal_voltage_V: 2.8, voltage_range_V: AVDD, max_current_mA: 40 }],
      metadata: {
        iovdd_V: { min: 1.6, typ: "1.8 / 2.8", max: 3.5, note: "I/O level set by the pull-ups; I/Os failsafe, no diode to AVDD" },
        supply_current: { hw_standby_uA: [3, 5, 7], sw_standby_uA: [4, 6, 9], ranging_avg_mA: { typ: 22, max: 24 }, peak_mA: 40, ulp_mode_uA: 55, condition: "23 C, 2.8 V, AVDD + AVDDVCSEL" },
        logic_levels: {
          i2c: { vil_V: [-0.5, 0.6], vih_V: [1.12, 3.5], vol_max_V: 0.4, at: "4 mA" },
          gpio1: { vil_max: "0.3 IOVDD", vih_min: "0.7 IOVDD", vol_max_V: 0.4, voh_min: "IOVDD - 0.4 V", at: "4 mA" },
        },
        boot_time_ms_max: 1.2,
        source: DS("Tables 12, 14, 15; §2.7; §6.6"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 4.4, width: 2.4, height: 1.0 },
      package: {
        name: "Optical LGA12",
        pin_count: 12,
        pitch_mm: 0.8,
        exposed_pad: false,
        source: DS("Table 1: Package Optical LGA12, Size 4.4 x 2.4 x 1 mm; Figures 17, 19: 4.40 x 2.40, height 1 +0.05/-0.10, 12 pads 0.50 square at 0.80 pitch"),
      },
      metadata: {
        dimensions_note: "length along the 5-pad rows (CAD x), width across them (CAD y), height to the cap top without the liner; 1.05 mm with the protective liner (Figure 20)",
        substrate_thickness_mm: 0.31,
        apertures_mm: { rx: { x: -1.535, y: 0, dia: 0.2 }, tx: { x: 1.465, y: 0, dia: 0.4 }, frame: "body centre, top view, pin 1 at +x/-y" },
        liner_mm: { length: 4.0, width: 2.92, thickness: 0.05, corner_radius: 0.2 },
        max_compressive_load_N: 25,
        moisture_sensitivity_level: 3,
        mounting_method: "surface_mount",
        source: DS("Figures 17-21; §11.3-11.4"),
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-30, 85],
      metadata: { storage_C: [-40, 125], reflow_peak_C: { recommended: 240, max: 260 }, source: DS("Tables 9, 10, 19") },
    },
  ],

  traits: [
    {
      type: "operating_conditions",
      params: { avdd_V: AVDD, iovdd_V: IOVDD, temperature_C: [-30, 85], i2c_clock_kHz: [0, 1000], source: DS("Tables 5, 10, 12") },
    },
    {
      type: "absolute_maximum",
      params: {
        avdd_scl_sda_xshut_gpio1_V: [-0.5, 3.6],
        storage_temperature_C: [-40, 125],
        esd: "HBM +-2 kV (JS-001-2012); CDM +-500 V (JESD22-C101)",
        compressive_load_N: 25,
        source: DS("Tables 9, 11, 13; §11.3"),
      },
    },
    {
      type: "performance",
      params: {
        kind: "distance_sensor",
        emitter: "940 nm VCSEL, Class 1 (IEC 60825-1:2014)",
        range_mm: "0 to 1200 mm with full FoV; minimum detection 0 mm, linear from 1 mm",
        max_range_33ms_mm: {
          white_88: { indoor: "1200 @ 90 % / 1300 @ 50 % detection", outdoor_overcast: "550 @ 90 % / 600 @ 50 %" },
          grey_17: { indoor: "450 @ 90 % / 475 @ 50 %", outdoor_overcast: "400 @ 90 % / 450 @ 50 %" },
        },
        accuracy_33ms: {
          white_88_indoor: "+-7 mm (1-100 mm), +-8 mm (101-200 mm), +-3 % (> 200 mm)",
          grey_17_indoor: "+-6 mm, +-8 mm, +-4 %",
          outdoor_overcast: "+-7 to 9 mm below 200 mm, +-8 % above",
        },
        fov_deg: 18,
        detection_volume_deg: { at_100mm: 22, at_1000mm: 18 },
        collector_exclusion_cone_deg: 25,
        foi_deg: [16, 16],
        max_ranging_frequency_Hz: 100,
        conditions: "full FoV target, 2.8 V, 23 C, no cover glass, default driver settings",
        source: DS("Features, §6.2-6.3, Tables 16-18, §8, §9"),
      },
    },
    note(
      "Control through ST's ultra lite driver (ULD, UM2931): the register map is not published. Calibrate offset in every application and crosstalk when a cover glass is used. Ranging drifts with temperature as an offset; run the driver's temperature update when the temperature changes. ST lists liquid level measurement as an application (STSW-IMG039 example code).",
      "Description, Applications, §2.1-2.3, §6.5",
    ),
    {
      type: "usage_note",
      params: {
        topic: "variant and liner",
        note: "VL53L4CDV0DH/1 = Optical LGA12 with liner, tape and reel, MOQ 4500; VL53L4CDV9DH/1 is the same without liner. The protective liner (4 x 2.92 x 0.05 mm, 1.05 mm overall) withstands reflow at 260 C and must be removed during assembly, just before mounting the cover glass.",
        source: DS("Table 20, Figure 20, §10.4"),
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "laser safety and handling",
        note: "Class 1 laser product: do not increase the output power or focus the beam with optics. Handle with ESD-safe non-marring tweezers in a clean process until the cover glass is fitted; reject any part that has been dropped. Optical part, not sealed: dry reflow only (no vapour phase) and no-wash assembly.",
        source: DS("§9, §11.1-11.2, §11.5"),
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "Rx aperture diameter",
        values: ["0.20 +-0.02 mm (cap 8575850, Figure 18)", "0.201 +-0.015 mm (cap DM00418317, Figure 18)", "0.22 mm (Rx exclusion cone at datum A, Figure 21)"],
        sources: [SRC.datasheet],
        resolution: "Two cap suppliers, identical for the customer (§7); 0.22 mm is the exclusion cone, not the hole. CAD uses 0.20 mm.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD cap and apertures",
        value: "cap 4.40 x 2.40 mm like the substrate, z 0.31-1.00; side recesses, 0.035 mm marks and draft not modelled; each aperture a 0.05 mm deep disc flush with the cap top",
        reason: "Figures 17-18 dimension the outline, aperture positions and diameters but not the cap's recess depth or the depth of the aperture to the lens.",
        source: DS("Figures 17-18"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD pads",
        value: "0.02 mm thick, inside the substrate, faces on the seating plane",
        reason: "Figure 19 gives the pad size and positions but no pad thickness.",
        source: DS("Figure 19"),
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "No redistributable model found: st.com (product page CAD resources) refused every fetch from the research machine on 2026-10-03 (HTTP/2 error, then timeouts); the STEP on Ultra Librarian needs an account and its End User Subscription Agreement forbids publishing it in a library for distribution; the Mouser page timed out. Geometry is generated from DS13812 Rev 8 Figures 17-21 (library/cad/py/catalog/st-vl53l4cdv0dh-1.py).",
        source: SRC.ulCad,
      },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "DS13812 Rev 8 states no mass.", source: SRC.datasheet },
    },
    {
      type: "data_gap",
      params: { field: "lifecycle status", note: "Not confirmed from ST: the product page could not be read. Ultra Librarian shows it as Active.", source: SRC.ulCad },
    },
  ],

  artifacts: [{ id: "art_datasheet", name: "VL53L4CD datasheet DS13812 Rev 8", type: "datasheet", url: SRC.datasheet }],
});

// ---------------------------------------------------------------------------
// Geometry: generated from DS13812 Figures 17-21. Body centred, seating plane
// z = 0, cap top z = 1.00, x along 4.40 mm, top view; pin 1 at +x/-y; Tx
// aperture at x = +1.465, Rx at x = -1.535.
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.27, centroid: [1.621, -0.791, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.25, centroid: [0.8, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.25, centroid: [0.0, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.25, centroid: [-0.8, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.25, centroid: [-1.6, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.25, centroid: [-1.6, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.25, centroid: [-1.6, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.25, centroid: [-0.8, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.25, centroid: [0.0, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.25, centroid: [0.8, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_11: feature("pin_11", { area_mm2: 0.25, centroid: [1.6, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_12: feature("pin_12", { area_mm2: 0.25, centroid: [1.6, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const ST_VL53L4CDV0DH_1: ModuleDef = withGeometry(
  ST_VL53L4CDV0DH_1_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    i2c: { refs: [PIN_FEATURES.pin_9, PIN_FEATURES.pin_10] },
    supply: { refs: [PIN_FEATURES.pin_11, PIN_FEATURES.pin_1, PIN_FEATURES.pin_3, PIN_FEATURES.pin_2] },
    // the pads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 3.02, centroid: [0.013, -0.004, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
    // optical apertures: frames on the cap top, normal up towards the target
    rx_aperture: {
      frame: { origin: [-1.535, 0, 1.0], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("rx_aperture", { area_mm2: 0.031, centroid: [-1.535, 0.0, 1.0], normal: [0.0, 0.0, 1.0] }), own("rx_aperture")],
    },
    tx_aperture: {
      frame: { origin: [1.465, 0, 1.0], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("tx_aperture", { area_mm2: 0.126, centroid: [1.465, 0.0, 1.0], normal: [0.0, 0.0, 1.0] }), own("tx_aperture")],
    },
  },
  cadArtifacts({
    dir: "library/parts/st-vl53l4cdv0dh-1/artifacts/cad",
    name: "st-vl53l4cd-optical-lga12",
    generator: "library/cad/py/catalog/st-vl53l4cdv0dh-1.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount", "rx_aperture", "tx_aperture"],
  }),
);

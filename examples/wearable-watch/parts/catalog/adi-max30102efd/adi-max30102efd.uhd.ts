/**
 * Analog Devices (Maxim) MAX30102EFD+T pulse-oximeter and heart-rate sensor
 * module (14 OESIP) — datasheet-honest UHD part.
 *
 * Sources (see ./adi-max30102efd/sources.json):
 *   - src_datasheet: MAX30102 datasheet 19-7740 Rev 1 (10/18), the copy read
 *     (sha256 252e0393…) — https://download.mikroe.com/documents/datasheets/MAX30102_datasheet.pdf
 *     (p.2 absolute maximum, package information and electrical
 *     characteristics, pp.3-5 optical/digital/I2C characteristics, p.8 pin
 *     configuration and description, pp.18-20 Tables 4-8, p.28 power
 *     sequencing and I2C, p.29 Table 17, p.31 application circuit and
 *     ordering information)
 *   - src_datasheet_adi: canonical ADI copy of the same document —
 *     https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf
 *     (not reachable from the research machine; not read)
 *   - src_datasheet_rev0: MAX30102 datasheet 19-7740 Rev 0 (9/15) with
 *     package outline 21-1048 rev B on p.32 (sha256 e41d1c2f…) —
 *     https://xonstorage.z8.web.core.windows.net/pdf/maxim_max30102efdt_apr22_xonlink.pdf
 *     (used only for the outline drawing, which Rev 1 omits)
 *
 * Modelling notes:
 *   - Variant: MAX30102EFD+T, the only orderable code (-40 to +85 C, lead-free,
 *     tape and reel). A bare optical module (red + IR LED, photodetector,
 *     18-bit ADC, cover glass) soldered to the board, not a breakout board.
 *   - All 14 pads are leaves `pin_1`..`pin_14` from the Rev 1 pin description
 *     (p.8), with designators and verbatim `pin_functions` traits; there is
 *     no exposed pad. Pins 1, 5, 6, 7, 8, 14 are N.C. (`nc`): solder them to
 *     isolated pads for mechanical stability. Rev 0 named pins 5 and 6
 *     R_DRV / IR_DRV; Rev 1 is used (source_discrepancy trait).
 *   - Composed interfaces: `i2c` (target, fixed 7-bit address 0x57, SDA pin 3 /
 *     SCL pin 2, up to 400 kHz), `core_supply` (VDD pin 11 + GND pin 12,
 *     1.7-2.0 V) and `led_supply` (VLED+ pins 9, 10 + PGND pin 4, 3.1-5.0 V).
 *     INT (pin 13) carries an interrupt output protocol on its leaf.
 *   - SDA, SCL and INT carry voltage 0-6.0 V: the datasheet gives no operating
 *     maximum for them, only the 6.0 V absolute maximum ("All Other Pins"),
 *     and allows pull-ups to an external voltage (assumption trait). Their
 *     thresholds follow VDD (VIH >= 0.7 x VDD), recorded in electrical metadata.
 *   - `core_supply` and pin 11 carry current_draw 1.2 mA, the maximum IDD in
 *     SpO2 and HR mode (600 uA typical). VLED+ draw depends on the programmed
 *     LED current, pulse width and sample rate, so `led_supply` has no
 *     current_draw (usage_note gives the figures).
 *   - `sensor_window` and `led_window` are the two optical apertures in the
 *     cover glass, which an enclosure window and light barrier must match.
 *     No protocol covers an optical path: `custom` with capability
 *     optical_aperture, logged as a vocabulary gap.
 *   - Geometry is generated from outline 21-1048 (no manufacturer CAD
 *     reachable: data_gap trait). Bare IC: no bolt pattern. Each pin leaf refs
 *     its pad, the composed interfaces ref their pads, `pcb_mount` refs all 14
 *     pads with a frame on the seating plane (normal -Z), and each window has
 *     a frame on its top face (normal +Z, towards the skin). The cover-glass
 *     stack-up, square window corners and pad thickness are assumption traits.
 *   - Lifecycle status and mass are not stated in the sources read
 *     (data_gap traits).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { I2C, PowerIn, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://download.mikroe.com/documents/datasheets/MAX30102_datasheet.pdf",
  datasheetAdi: "https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf",
  datasheetRev0: "https://xonstorage.z8.web.core.windows.net/pdf/maxim_max30102efdt_apr22_xonlink.pdf",
  cadSearch: "https://www.snapeda.com/parts/MAX30102EFD+T/Analog%20Devices/view-part/",
} as const;

const DS = (where: string) => `${SRC.datasheet} (19-7740 Rev 1, ${where})`;
const OUTLINE = (where: string) => `${SRC.datasheetRev0} (19-7740 Rev 0 p.32, outline 21-1048 rev B, ${where})`;

const VDD: [number, number] = [1.7, 2.0]; // p.2 Power-Supply Voltage
const VLED: [number, number] = [3.1, 5.0]; // p.2 LED Supply Voltage (Rev 1)
const LOGIC: [number, number] = [0, 6.0]; // p.2 "All Other Pins to GND" absolute max (assumption trait)
const IDD_MAX_A = 0.0012; // p.2: IDD 1200 uA max, SpO2 and HR mode, PW 215 us, 50 sps

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: DS(where) },
});

const NC = "No Connection. Connect to PCB pad for mechanical stability.";

// ---------------------------------------------------------------------------
// Pins — Rev 1 p.8 Pin Configuration (top view) and Pin Description
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    [1, "N.C.", "nc", NC],
    { pin: 2, name: "SCL", type: "input", capabilities: ["i2c_scl"], description: "SCL — I2C Clock Input" },
    { pin: 3, name: "SDA", type: "io", capabilities: ["i2c_sda", "open_drain"], description: "SDA — I2C Data, Bidirectional (Open-Drain)" },
    [4, "PGND", "ground", "PGND — Power Ground of the LED Driver Blocks"],
    [5, "N.C.", "nc", NC],
    [6, "N.C.", "nc", NC],
    [7, "N.C.", "nc", NC],
    [8, "N.C.", "nc", NC],
    {
      pin: 9,
      name: "VLED+",
      type: "power_in",
      voltageV: VLED,
      nominalV: 3.3,
      description: "VLED+ — LED Power Supply (anode connection). Use a bypass capacitor to PGND for best performance.",
    },
    {
      pin: 10,
      name: "VLED+",
      type: "power_in",
      voltageV: VLED,
      nominalV: 3.3,
      description: "VLED+ — LED Power Supply (anode connection). Use a bypass capacitor to PGND for best performance.",
    },
    {
      pin: 11,
      name: "VDD",
      type: "power_in",
      voltageV: VDD,
      nominalV: 1.8,
      description: "VDD — Analog Power Supply Input. Use a bypass capacitor to GND for best performance.",
    },
    [12, "GND", "ground", "GND — Analog Ground"],
    {
      pin: 13,
      name: "INT",
      type: "output",
      capabilities: ["interrupt", "open_drain", "active_low"],
      protocols: [{ type: "interrupt", roles: ["output"] }],
      description: "INT — Active-Low Interrupt (Open-Drain). Connect to an external voltage with a pullup resistor.",
      traits: [
        note(
          "Pulled low while an enabled interrupt is pending (FIFO almost full, new sample ready, ambient light cancellation overflow, die temperature ready) and on power-up (PWR_RDY, which cannot be disabled); cleared by reading the Interrupt Status registers 0x00-0x01. VOL <= 0.2 V at 6 mA. Needs an external pull-up (1 kohm to VDDIO in the application circuit).",
          "pp.4, 12-13, 31",
        ),
      ],
    },
    [14, "N.C.", "nc", NC],
  ],
  { source: DS("p.8 Pin Description"), logicV: LOGIC },
).map((p) => (p.id === "pin_11" ? { ...p, parameters: [...(p.parameters ?? []), currentDrawA(IDD_MAX_A)] } : p));

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const i2c = withTraits(
  I2C({ id: "i2c", name: "I2C (target)", roles: ["slave"], clockFreqHz: [0, 400_000], address: 0x57, sda: pinId(3), scl: pinId(2), defaultActive: true })[0],
  [
    note(
      "7-bit address 0x57, fixed (slave ID 0b1010111; 0xAE write / 0xAF read). SCL 0-400 kHz, bus capacitance <= 400 pF. VIH >= 0.7 x VDD, VIL <= 0.3 x VDD, so the bus may be pulled up above VDD (6.0 V absolute maximum). SDA is open-drain and needs a pull-up (typically > 500 ohm); SCL is input only. Series resistors are optional. FIFO_DATA reads do not auto-increment the register pointer.",
      "pp.2, 4-5, 28-29 Table 17",
    ),
  ],
);

const coreSupply: InterfaceDef = {
  ...PowerIn({ id: "core_supply", name: "Core supply (VDD + GND)", voltageV: VDD, nominalV: 1.8, parameters: [currentDrawA(IDD_MAX_A)] }),
  slots: [
    { id: "vdd", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vdd_pins", label: "VDD 11, GND 12", default_active: true, bindings: { vdd: pinId(11), gnd: pinId(12) } }],
  traits: [
    note(
      "VDD 1.7-2.0 V (1.8 V typical); 2.2 V absolute maximum. IDD 600 uA typ / 1200 uA max in SpO2 and HR mode (also IR-only mode) at PW 215 us, 50 sps; shutdown (MODE 0x80) 0.7 uA typ / 10 uA max. Application circuit: +1.8 V rail sized 20 mA, 4.7 uF + 0.1 uF to GND. Power VDD before VLED+.",
      "p.2, p.28, p.31",
    ),
  ],
};

const ledSupply: InterfaceDef = {
  ...PowerIn({ id: "led_supply", name: "LED supply (VLED+ + PGND)", voltageV: VLED, nominalV: 3.3 }),
  slots: [
    { id: "vled_a", required: true, match: { protocol: "power", role: "input" } },
    { id: "vled_b", required: true, match: { protocol: "power", role: "input" } },
    { id: "pgnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vled_pins", label: "VLED+ 9/10, PGND 4", default_active: true, bindings: { vled_a: pinId(9), vled_b: pinId(10), pgnd: pinId(4) } }],
  traits: [
    note(
      "VLED+ 3.1-5.0 V (3.3 V typical); 6.0 V absolute maximum to PGND. The LED drivers sink a programmed pulse current, 0-50 mA (Table 8: 0x1F 6.2 mA, 0x3F 12.6 mA, 0x7F 25.4 mA, 0xFF 51.0 mA typical; actual current varies widely with trimming), one LED per time slot, pulse width 69-411 us at 50-3200 sps; average current = pulse current x pulse width x sample rate per active LED. Application circuit: +3.3 V rail sized 200 mA max, 10 uF + 0.1 uF to PGND. GND to PGND within +-0.3 V.",
      "pp.2, 9, 18-20 Tables 6-8, p.31",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "OESIP-14 pads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "oesip_14",
        note: "14 pads on the underside in two columns of 7, pitch 0.8 mm (D1 4.8 BSC), column centres 2.4 mm apart (E1 BSC); pad 0.25-0.35 x 0.65-0.75 mm (b x L); no exposed pad. Body 5.5-5.7 x 3.2-3.4 mm, 1.45-1.65 mm tall. Solder the N.C. pads too (mechanical stability).",
        source: [OUTLINE("D, E, A, b, L, e, D1, E1"), DS("p.8")],
      },
    },
  ],
};

const aperture = (id: string, name: string, size: string, what: string): InterfaceDef => ({
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
        note: `${what} Window ${size} mm in the top face (cover glass). Face it towards the skin through a clear enclosure window, with an opaque barrier between the two apertures to stop LED-to-photodiode crosstalk.`,
        source: [OUTLINE("top view"), DS("p.8 Pin Configuration")],
      },
    },
  ],
});

const sensorWindow = aperture(
  "sensor_window",
  "Photodetector aperture",
  "1.97 x 2.75 (REF), centred 0.822 mm from the body centre towards pins 1/14",
  "Photodetector aperture (the pin 1/14 end is labelled SENSOR). Photodiode 600-900 nm, radiant sensitive area 1.36 mm² (1.38 x 0.98 mm).",
);

const ledWindow = aperture(
  "led_window",
  "LED aperture",
  "1.97 x 1.094 (REF), centred 1.64 mm from the body centre towards pins 7/8",
  "Red (660 nm) and IR (880 nm) LED aperture (the pin 7/8 end is labelled LED).",
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ADI_MAX30102EFD_BASE: ModuleDef = defineModule({
  id: "adi-max30102efd",
  name: "ADI MAX30102 pulse oximeter / heart-rate module (OESIP-14)",
  version: "1.0.0",
  manufacturer: "Analog Devices (Maxim Integrated)",
  part_number: "MAX30102EFD+T",
  description:
    "Analog Devices (Maxim) MAX30102 integrated pulse-oximetry and heart-rate optical module in a 14-pin OESIP, 5.6 x 3.3 x 1.55 mm with integrated cover glass: red (660 nm) and IR (880 nm) LEDs, photodetector, ambient light cancellation, 18-bit ADC at 50-3200 sps, 32-sample FIFO, die temperature sensor. VDD 1.7-2.0 V, VLED+ 3.1-5.0 V, I2C target at fixed address 0x57 (400 kHz), active-low open-drain interrupt, 0.7 uA shutdown.",
  tags: ["max30102", "analog-devices", "maxim", "pulse-oximeter", "spo2", "heart-rate", "ppg", "optical-sensor", "i2c", "oesip-14", "ic", "wearable"],
  categories: ["sensor.biometric"],

  interfaces: [...pins, i2c, coreSupply, ledSupply, pcbMount, sensorWindow, ledWindow],

  interfaceGroups: [
    { id: "required_supply_pins", label: "VDD (11), GND (12), VLED+ (9, 10), PGND (4)", members: [pinId(11), pinId(12), pinId(9), pinId(10), pinId(4)], policy: "all_of" },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vdd", name: "Analog supply (VDD)", nominal_voltage_V: 1.8, voltage_range_V: VDD },
        { id: "vled", name: "LED supply (VLED+)", nominal_voltage_V: 3.3, voltage_range_V: VLED },
      ],
      metadata: {
        logic_levels: { scl_sda_vih_min: "0.7 VDD", scl_sda_vil_max: "0.3 VDD", hysteresis_V: 0.2, sda_int_vol_max_V: 0.2, vol_condition: "ISINK 6 mA" },
        supply_current_uA: { spo2_hr_mode: [600, 1200], ir_only_mode: [600, 1200], shutdown: [0.7, 10], condition: "typ/max, PW 215 us, 50 sps" },
        adc_clock_MHz: [10.32, 10.48, 10.64],
        source: DS("pp.2-4"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 5.6, width: 3.3, height: 1.55 },
      package: {
        name: "OESIP-14",
        code: "F143A5MK+1 (outline 21-1048)",
        pin_count: 14,
        pitch_mm: 0.8,
        exposed_pad: false,
        source: `${DS("p.1: 5.6mm x 3.3mm x 1.55mm 14-Pin Optical Module; p.2 Package Information: 14 OESIP, F143A5MK+1, outline 21-1048; p.31: 14-Lead OESIP (0.8mm Pin Pitch)")}; ${OUTLINE("D 5.6, E 3.3, A 1.55 nominal, e 0.8 BSC, N 14")}`,
      },
      metadata: {
        dimensions_note: "length along the pin columns (D), width across them (E), height to the top of the cover glass (A); CAD x is E and y is D",
        mounting_method: "surface_mount",
        cover_glass: "integrated; hydrolytic resistance class HGB 1 (DIN ISO 719)",
        source: [DS("pp.1, 3"), OUTLINE("table")],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: { junction_max_C: 90, storage_C: [-40, 105], theta_ja_C_per_W: 180, theta_jc_C_per_W: 150, source: DS("p.2") },
    },
  ],

  traits: [
    {
      type: "operating_conditions",
      params: { vdd_V: VDD, vled_V: VLED, temperature_C: [-40, 85], i2c_clock_kHz: [0, 400], source: DS("pp.2, 5") },
    },
    {
      type: "absolute_maximum",
      params: {
        vdd_V: [-0.3, 2.2],
        gnd_to_pgnd_V: [-0.3, 0.3],
        vled_to_pgnd_V: [-0.3, 6.0],
        other_pins_V: [-0.3, 6.0],
        terminal_current_mA: 20,
        continuous_power_mW: "440 at +70 C (derate 5.5 mW/C above +70 C)",
        junction_temperature_C: 90,
        storage_temperature_C: [-40, 105],
        reflow_C: 260,
        esd: "HBM 2.5 kV; latchup immunity +-250 mA",
        source: DS("p.2 Absolute Maximum Ratings"),
      },
    },
    {
      type: "performance",
      params: {
        kind: "optical_sensor",
        function: "pulse oximetry (SpO2) and heart rate (photoplethysmography)",
        modes: "heart rate (red only, MODE 010), SpO2 (red and IR, MODE 011), multi-LED (MODE 111)",
        red_led: { peak_nm: [650, 660, 670], fwhm_nm: 20, vf_V: 2.1, radiant_power_mW: 9.8, at: "20 mA, 25 C" },
        ir_led: { peak_nm: [870, 880, 900], fwhm_nm: 30, vf_V: 1.4, radiant_power_mW: 6.5, at: "20 mA, 25 C" },
        photodetector: { spectral_range_nm: [600, 900], sensitive_area_mm2: 1.36, sensitive_area_mm: [1.38, 0.98] },
        adc_bits: 18,
        adc_full_scale_nA: [2048, 4096, 8192, 16384],
        pulse_width_us: [69, 118, 215, 411],
        sample_rate_sps: [50, 100, 200, 400, 800, 1000, 1600, 3200],
        led_current_mA: [0, 51],
        fifo_samples: 32,
        ambient_light_cancellation_uA: 200,
        die_temperature: { accuracy_C: 1, range_C: [-40, 85], acquisition_ms: 29, resolution_C: 0.0625 },
        source: DS("pp.3-4, 9, 18-20 Tables 4-8, p.26"),
      },
    },
    note(
      "Power VDD first, then VLED+; SDA, SCL and INT may be pulled up while the supplies are off. A PWR_RDY interrupt signals readiness after power-up; read the interrupt status to clear it. Power-down tolerates any sequence. SHDN keeps the registers and lets both rails stay powered.",
      "p.18 Mode Configuration, p.28 Power Sequencing",
    ),
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "MAX30102EFD+T is the only orderable code in the datasheet: -40 to +85 C, 14-lead OESIP, + = lead-free/RoHS, T = tape and reel.",
        source: DS("p.31 Ordering Information"),
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "pins 5 and 6",
        values: ["R_DRV (5) and IR_DRV (6), red / IR LED driver (Rev 0, 9/15)", "N.C. (Rev 1, 10/18)"],
        sources: [SRC.datasheetRev0, SRC.datasheet],
        resolution: "Rev 1, the current revision: its revision history lists the pin description and pin configuration as updated. Pins 5 and 6 are nc leaves.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "VLED+ maximum",
        values: ["5.25 V (Rev 0)", "5.0 V (Rev 1)"],
        sources: [SRC.datasheetRev0, SRC.datasheet],
        resolution: "5.0 V (Rev 1).",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "maximum LED current",
        values: ["0 to 50 mA programmable (p.9 LED Driver)", "51.0 mA typical at LEDx_PA = 0xFF (Table 8)"],
        sources: [SRC.datasheet],
        resolution: "Both recorded: Table 8 values are typical and vary with trimming; led_current_mA uses the Table 8 maximum.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "SDA, SCL, INT voltage",
        value: "0-6.0 V",
        reason: "The datasheet states no recommended operating maximum for these pins, only the 6.0 V absolute maximum for all other pins (p.2), and allows pull-ups to an external voltage (p.28). 6.0 V is used as the ceiling for net checks; keep pull-ups well below it (the application circuit uses VDDIO).",
        source: DS("p.2, p.28, p.31"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD cover glass and windows",
        value: "housing 3.3 x 5.6 x 1.35 mm; cover glass 3.1 x 5.4 x 0.20 mm (0.10 rim inset) on top; windows modelled square-cornered; pads 0.02 mm thick, flush with the seating plane",
        reason: "Outline 21-1048 gives A 1.55 and A3 0.20 but the 0.10 rim, the (0.05) side-view step and the rounded window corners only as reference marks without full dimensions, and no pad thickness.",
        source: SRC.datasheetRev0,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "No redistributable model found: the ADI product page timed out from the research machine; SnapEDA, Digi-Key and componentsearchengine.com returned HTTP 403, and Mouser served a bot-block page. Geometry is generated from outline 21-1048 (library/cad/py/catalog/adi-max30102efd.py).",
        source: SRC.cadSearch,
      },
    },
    {
      type: "data_gap",
      params: { field: "lifecycle status", note: "Not confirmed: the ADI product page and distributor pages could not be read (brief OQ-W8).", source: SRC.datasheetAdi },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "Neither datasheet revision states a mass.", source: SRC.datasheet },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "MAX30102 datasheet 19-7740 Rev 1 (copy read)", type: "datasheet", url: SRC.datasheet },
    { id: "art_datasheet_adi", name: "MAX30102 datasheet (canonical ADI URL)", type: "datasheet", url: SRC.datasheetAdi },
    { id: "art_datasheet_rev0", name: "MAX30102 datasheet 19-7740 Rev 0 with outline 21-1048", type: "datasheet", url: SRC.datasheetRev0 },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from outline 21-1048. Seating plane z = 0, body centred,
// x across (E 3.3), y along (D 5.6); pins 1-7 on -X (pin 1 at +Y), 8-14 on +X
// (pin 8 at -Y); sensor window towards +Y, LED window towards -Y.
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.21, centroid: [-1.2, 2.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.21, centroid: [-1.2, 1.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.21, centroid: [-1.2, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.21, centroid: [-1.2, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.21, centroid: [-1.2, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.21, centroid: [-1.2, -1.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.21, centroid: [-1.2, -2.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.21, centroid: [1.2, -2.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.21, centroid: [1.2, -1.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.21, centroid: [1.2, -0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_11: feature("pin_11", { area_mm2: 0.21, centroid: [1.2, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_12: feature("pin_12", { area_mm2: 0.21, centroid: [1.2, 0.8, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_13: feature("pin_13", { area_mm2: 0.21, centroid: [1.2, 1.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_14: feature("pin_14", { area_mm2: 0.21, centroid: [1.2, 2.4, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const ADI_MAX30102EFD: ModuleDef = withGeometry(
  ADI_MAX30102EFD_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    i2c: { refs: [PIN_FEATURES.pin_3, PIN_FEATURES.pin_2] },
    core_supply: { refs: [PIN_FEATURES.pin_11, PIN_FEATURES.pin_12] },
    led_supply: { refs: [PIN_FEATURES.pin_9, PIN_FEATURES.pin_10, PIN_FEATURES.pin_4] },
    // the pads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 2.94, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
    // optical apertures: frames on the window faces, normal up towards the skin
    sensor_window: {
      frame: { origin: [0, 0.822, 1.55], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("sensor_window", { area_mm2: 5.417, centroid: [0.0, 0.822, 1.55], normal: [0.0, 0.0, 1.0] }), own("sensor_window")],
    },
    led_window: {
      frame: { origin: [0, -1.64, 1.55], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("led_window", { area_mm2: 2.155, centroid: [0.0, -1.64, 1.55], normal: [0.0, 0.0, 1.0] }), own("led_window")],
    },
  },
  cadArtifacts({
    dir: "library/parts/adi-max30102efd/artifacts/cad",
    name: "adi-max30102-oesip14",
    generator: "library/cad/py/catalog/adi-max30102efd.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount", "sensor_window", "led_window"],
  }),
);

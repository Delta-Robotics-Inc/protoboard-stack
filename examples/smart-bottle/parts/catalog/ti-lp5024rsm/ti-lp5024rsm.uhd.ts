/**
 * Texas Instruments LP5024RSMR 24-channel 12-bit PWM I2C RGB LED driver
 * (32-pin VQFN, RSM, 3000-unit reel) — datasheet-honest UHD part.
 *
 * Sources (see ./ti-lp5024rsm/sources.json):
 *   - src_datasheet: TI LP5018/LP5024 datasheet SLVSEB8C (rev. July 2024) —
 *     https://www.ti.com/lit/ds/symlink/lp5024.pdf
 *     (§5 pin configuration and Table 5-1, §6.1-6.6 ratings, electrical
 *     characteristics and timing, §7.3-7.6 features, modes, addressing and
 *     registers, §8.2-8.4 application and layout, §11 package option
 *     addendum and RSM0032B outline 4219108/B)
 *   - src_product: TI LP5024 product folder — https://www.ti.com/product/LP5024
 *   - src_part_details: TI LP5024RSMR part details —
 *     https://www.ti.com/product/LP5024/part-details/LP5024RSMR
 *   - src_cad_search: Ultra Librarian for TI, LP5024RSMR (where research
 *     looked for CAD; nothing downloaded).
 *
 * Modelling notes:
 *   - Variant: LP5024 in the RSM package, orderable LP5024RSMR (Active). The
 *     LP5018 (18 channels; RSM pins 19-24 NC, or the VSSOP-28 DGS) shares the
 *     datasheet but is a different part and is not merged here.
 *   - All 32 pins are leaves `pin_1`..`pin_32` from Table 5-1 with
 *     designators and verbatim `pin_functions` traits. The exposed thermal
 *     pad is the device's only ground (Table 5-1 "GND"); the RSM0032B outline
 *     numbers it 33, so its leaf is `pin_33` with designator 33.
 *   - OUT0-OUT23 (pins 1-24) are constant-current sinks for LED cathodes. No
 *     protocol fits, so each is a `custom` output with capability
 *     `led_current_sink` (vocabulary gap). Each carries voltage 0-5.5 V (the
 *     recommended OUTx range) and max_current 25.5 mA: IMAX over the whole
 *     VCC range with the default Max_Current_Option = 0. The 35 mA option
 *     (VCC >= 3.3 V) is in a usage_note, not the parameter.
 *   - Every three consecutive outputs share one LEDx_BRIGHTNESS register
 *     (OUT0-OUT2 = LED0, §7.3.1.2.1). They are the composites `rgb_led_0` ..
 *     `rgb_led_7`, slots `bank_a`/`bank_b`/`bank_c` for the first, second and
 *     third output (banks A, B, C of §7.3.2). §1 describes the three banks
 *     as (R, G, B), but §7.3.2 Table 7-1 and the BANK_A/B/C_COLOR registers
 *     give no letter-to-colour mapping, so the part assigns none.
 *   - IREF (pin 31) takes RIREF to GND (RIREF = KIREF x VIREF / ISET) and
 *     VCAP (pin 32) a 1 uF capacitor to GND; neither drives anything else, so
 *     both are `custom` leaves with usage notes (as ILIM on ti-drv8871). The
 *     VCAP voltage is not stated (data_gap; 2 V absolute maximum).
 *   - ADDR0/ADDR1 are logic inputs strapped to GND or VCC; their absolute
 *     maximum is VCC + 0.3 V. The `i2c` interface states address 0x28 for
 *     ADDR1 = ADDR0 = GND (assumption trait: the strap is the board's choice,
 *     and the bottle cap board uses it); the other three addresses and the
 *     0x3C broadcast address are in a usage_note.
 *   - Logic pins (EN, SCL, SDA, ADDRx) carry voltage 0-5.5 V from §6.3; their
 *     thresholds (VIH 1.4 V, VIL 0.4 V) do not depend on VCC, so the bus may be
 *     pulled up to 1.8, 3.3 or 5 V.
 *   - `supply` (VCC pin 27 + pad 33) carries current_draw 5 mA, the
 *     normal-mode typical with 10 mA per output (§6.5). LED current flows from
 *     the LED supply through the outputs to GND, not through VCC. §7.4 states
 *     different mode currents than §6.5 (source_discrepancy trait).
 *   - Package facts (VQFN-32 RSM, RSM0032B, pitch 0.4, exposed pad 2.8 mm
 *     square) are the mechanical domain's `package`. Height 1.0 mm is the
 *     drawing's maximum (no nominal is given; assumption trait).
 *   - Geometry is generated from RSM0032B (no usable manufacturer CAD:
 *     data_gap). Bare IC: no bolt pattern. Each pin leaf refs its terminal
 *     face, the composites their pins' faces, and `pcb_mount` all 33 solder
 *     faces with a frame on the seating plane.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { I2C, PowerIn, currentDrawA, defineModule, maxCurrentA, pinTable, voltageRangeV } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.ti.com/lit/ds/symlink/lp5024.pdf",
  product: "https://www.ti.com/product/LP5024",
  partDetails: "https://www.ti.com/product/LP5024/part-details/LP5024RSMR",
  cadSearch: "https://vendor.ultralibrarian.com/TI/embedded/?gpn=LP5024&package=RSM&pin=32",
} as const;

const VCC: [number, number] = [2.7, 5.5]; // §6.3, §6.5
const LOGIC: [number, number] = [0, 5.5]; // §6.3: ADDRx, EN, SDA, SCL
const OUT_V: [number, number] = [0, 5.5]; // §6.3: OUTx
const IMAX_A = 0.0255; // §6.5: Max_Current_Option = 0, VCC in full range
const ICC_NORMAL_A = 5e-3; // §6.5: normal mode 5 mA typ (8 max) with 10 mA per OUTx
const CHANNELS = 24;

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

/** A pin with no fitting protocol: `custom` with the given role and capabilities. */
function asCustom(iface: InterfaceDef, role: string, capabilities: string[], parameters = iface.parameters): InterfaceDef {
  return { ...iface, protocols: [{ type: "custom", roles: [role] }], capabilities, ...(parameters ? { parameters } : {}) };
}

const pinId = (n: number) => `pin_${n}`;
const BANKS = ["a", "b", "c"] as const;

// ---------------------------------------------------------------------------
// Pins — §5 Figure 5-2 (LP5024 RSM top view) and Table 5-1, LP5024RSM column
// ---------------------------------------------------------------------------

const outRows = Array.from({ length: CHANNELS }, (_, ch) => ({
  pin: ch + 1,
  name: `OUT${ch}`,
  type: "output" as const,
  description: `OUT${ch} (O) — Current sink output ${ch}. If not used, this pin can be left floating.`,
}));

const table = pinTable(
  [
    ...outRows,
    { pin: 25, name: "ADDR0", type: "input", capabilities: ["address_select"], description: "ADDR0 — I2C slave-address selection pin. This pin must not be left floating." },
    { pin: 26, name: "ADDR1", type: "input", capabilities: ["address_select"], description: "ADDR1 — I2C slave-address selection pin. This pin must not be left floating." },
    { pin: 27, name: "VCC", type: "power_in", voltageV: VCC, description: "VCC (I) — Input power." },
    { pin: 28, name: "SDA", type: "io", capabilities: ["i2c_sda", "open_drain"], description: "SDA (I/O) — I2C bus data line. If not used, this pin must be connected to GND or VCC." },
    { pin: 29, name: "SCL", type: "input", capabilities: ["i2c_scl"], description: "SCL (I) — I2C bus clock line. If not used, this pin must be connected to GND or VCC." },
    { pin: 30, name: "EN", type: "input", capabilities: ["enable"], description: "EN (I) — Chip enable input pin" },
    { pin: 31, name: "IREF", type: "analog_in", description: "IREF — Output current-reference global-setting pin" },
    {
      pin: 32,
      name: "VCAP",
      type: "analog_out",
      description: "VCAP — Internal LDO output pin, this pin must be connected to a 1µF capacitor to GND. Place the capacitor as close to the device as possible.",
    },
    { pin: 33, name: "GND (exposed thermal pad)", type: "ground", description: "GND — Exposed thermal pad also serves the ground pin for the device." },
  ],
  { source: `${SRC.datasheet} (§5 Table 5-1 Pin Functions)`, logicV: LOGIC },
);

const pinTraits: Record<string, TraitDef[]> = {
  pin_25: [note("Tie ADDR0 to GND or VCC (Table 7-2). Absolute maximum -0.3 V to VCC + 0.3 V, so it must not be pulled above the LP5024's own VCC.", "§6.1, §7.5.1.4")],
  pin_26: [note("Tie ADDR1 to GND or VCC (Table 7-2). Absolute maximum -0.3 V to VCC + 0.3 V, so it must not be pulled above the LP5024's own VCC.", "§6.1, §7.5.1.4")],
  pin_30: [
    note(
      "EN low = SHUTDOWN (0.2 uA typ, 1 uA max); EN high = INITIALIZATION (registers reset) then STANDBY until Chip_EN (DEVICE_CONFIG0 bit 6) is written 1. Wait tEN_H (500 us max) after the first EN rising edge before the first I2C access. VIH >= 1.4 V, VIL <= 0.4 V, -0.3 to 6 V absolute maximum.",
      "§6.5, §6.6, §7.4",
    ),
  ],
  pin_31: [
    note(
      "Connect RIREF from IREF to GND: RIREF = KIREF x VIREF / ISET, KIREF = 105, VIREF = 0.7 V (e.g. ISET 15 mA -> 4.9 kOhm; 5 mA -> 14.7 kOhm). ISET is the full-scale current of all 24 outputs. IREF floating gives near-zero output current; IREF shorted to GND gives the internal limit ILIM (35-80 mA, or 40-120 mA with Max_Current_Option = 1), so the resistor is required. Place RIREF close to the device.",
      "§6.5, §7.3.3, §8.2.2, §8.4.1",
    ),
  ],
  pin_32: [note("1 uF from VCAP to GND, as close to the device as possible. VCAP absolute maximum -0.3 to 2 V; do not load it.", "§6.1, §8.2.2, §8.4.1")],
  pin_33: [note("The thermal pad must be soldered to the board for thermal and mechanical performance; add as many thermal vias under it as possible (plated shut or plugged and capped).", "§8.4.1; RSM0032B notes 3-4")],
};

const pins: InterfaceDef[] = table.map((p) => {
  let iface = p;
  const n = Number(p.pin);
  if (n >= 1 && n <= CHANNELS) {
    const ch = n - 1;
    iface = asCustom(p, "output", ["led_current_sink", `led_bank_${BANKS[ch % 3]}`], [voltageRangeV(OUT_V[0], OUT_V[1]), maxCurrentA(IMAX_A)]);
  } else if (n === 31) {
    iface = asCustom(p, "input", ["current_set_resistor"], []);
  } else if (n === 32) {
    iface = asCustom(p, "output", ["ldo_bypass_capacitor"], []);
  } else if (n === 27) {
    iface = { ...p, parameters: [...(p.parameters ?? []), currentDrawA(ICC_NORMAL_A)] };
  }
  if (iface.parameters?.length === 0) {
    const { parameters: _drop, ...rest } = iface;
    iface = rest;
  }
  return pinTraits[iface.id] ? withTraits(iface, pinTraits[iface.id]) : iface;
});

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const i2c = withTraits(
  I2C({ id: "i2c", name: "I2C (target)", roles: ["slave"], clockFreqHz: [0, 400_000], address: 0x28, sda: pinId(28), scl: pinId(29), defaultActive: true })[0],
  [
    note(
      "Target only. 7-bit address 0b0101 0 ADDR1 ADDR0: 0x28 (ADDR1 = GND, ADDR0 = GND), 0x29 (GND, VCC), 0x2A (VCC, GND), 0x2B (VCC, VCC). Every device also answers the broadcast address 0b0111100 (0x3C) whatever the ADDR pins; broadcast reads are valid only if all devices hold the same value. Up to four devices per bus. Auto-increment (Auto_Incr_EN, default 1) writes or reads consecutive registers in one transfer.",
      "§7.5.1.4 Table 7-2 and Table 7-3, §7.5.1.5, §7.6.2, §8.2",
    ),
    note(
      "fSCL up to 400 kHz, bus capacitance 10-200 pF per line. VIH >= 1.4 V, VIL <= 0.4 V, input current +-1 uA, SDA VOL <= 0.4 V at 5 mA; SDA and SCL 0-5.5 V (6 V absolute maximum) whatever VCC is, so they are compatible with 1.8, 3.3 and 5 V pull-ups. The bus needs pull-ups (1.8-4.7 kOhm typical), normally at the controller.",
      "§1, §6.1, §6.3, §6.5, §6.6, §8.2.2",
    ),
    {
      type: "assumption",
      params: {
        field: "i2c_address",
        value: "0x28",
        reason: "The address is set by straps (ADDR0/ADDR1 must not float); the part has no default. 0x28 is ADDR1 = ADDR0 = GND, the strap the smart-bottle cap board uses. A board strapping another address needs an instance override, which UHD does not have yet.",
        source: `${SRC.datasheet} (§7.5.1.4 Table 7-2)`,
      },
    },
  ],
);

const supply: InterfaceDef = {
  ...PowerIn({ id: "supply", name: "Supply (VCC + GND pad)", voltageV: VCC, parameters: [currentDrawA(ICC_NORMAL_A)] }),
  slots: [
    { id: "vcc", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vcc_pins", label: "VCC 27, GND pad 33", default_active: true, bindings: { vcc: pinId(27), gnd: pinId(33) } }],
  traits: [
    note(
      "VCC 2.7-5.5 V, well regulated: load transients (start-up, fast intensity changes) must not pull it below 2.7 V. 1 uF from VCC to GND close to the device. UVLO: shutdown at VUVF (2 V min, falling), restart at VUVR (2.5 V max, rising), 0.2 V hysteresis; below VUVF the device is held in INITIALIZATION (reset).",
      "§6.5, §7.3.5.2, §8.2.2, §8.3",
    ),
    note(
      "Supply current: shutdown (EN = 0) 0.2 uA typ / 1 uA max; standby (EN = 1, Chip_EN = 0) 6 / 10 uA; normal mode 5 / 8 mA with 10 mA per output; automatic power-save (Power_Save_EN = 1, the default, and all LEDs off for longer than tPSM 20-40 ms) 6 / 10 uA. Any I2C command returns the device to NORMAL.",
      "§6.5, §6.6, §7.3.4, §7.4",
    ),
  ],
};

const RGB_LEDS = CHANNELS / 3;

const rgbLeds: InterfaceDef[] = Array.from({ length: RGB_LEDS }, (_, k) => {
  const [a, b, c] = [3 * k, 3 * k + 1, 3 * k + 2];
  return {
    id: `rgb_led_${k}`,
    name: `RGB LED ${k} (OUT${a}-OUT${c}, LED${k}_BRIGHTNESS)`,
    domain: "electrical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "custom", roles: ["output"] }],
    capabilities: ["rgb_led_channels"],
    parameters: [voltageRangeV(OUT_V[0], OUT_V[1]), maxCurrentA(IMAX_A)],
    slots: BANKS.map((bank) => ({ id: `bank_${bank}`, required: true, match: { protocol: "custom", role: "output", capability: `led_bank_${bank}` } })),
    profiles: [
      {
        id: `rgb_led_${k}_pins`,
        label: `OUT${a} / OUT${b} / OUT${c} (pins ${a + 1} / ${b + 1} / ${c + 1})`,
        default_active: true,
        bindings: { bank_a: pinId(a + 1), bank_b: pinId(b + 1), bank_c: pinId(c + 1) },
      },
    ],
    traits:
      k === 0
        ? [
            note(
              "Each RGB LED's cathodes go to three consecutive outputs (OUT3k, OUT3k+1, OUT3k+2), which share the LEDk_BRIGHTNESS register (8-bit, default FFh = 100 %); each output has its own 8-bit OUTx_COLOR register (default 00h). With LEDk_Bank_EN set, the first, second and third outputs follow bank A, B and C colour registers and BANK_BRIGHTNESS instead. Anodes go to the LED supply. §1 describes the three banks as (R, G, B), but §7.3.2 Table 7-1 and the BANK_A/B/C_COLOR registers give no letter-to-colour mapping, so the part assigns none.",
              "§7.3.1, §7.3.2, §7.6 Table 7-4",
            ),
          ]
        : [],
  };
});

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "VQFN-32 (RSM) terminals and exposed pad (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "32 bottom terminals and the exposed thermal pad are soldered to the board; the package is the mechanical domain's package fact. MSL Level-2, 260 C peak reflow, 1 year floor life.",
        source: `${SRC.datasheet} (§11 package option addendum; RSM0032B note 3)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const TI_LP5024RSM_BASE: ModuleDef = defineModule({
  id: "ti-lp5024rsm",
  name: "TI LP5024 24-channel I2C RGB LED driver (VQFN-32)",
  version: "1.0.0",
  manufacturer: "Texas Instruments",
  part_number: "LP5024RSMR",
  description:
    "Texas Instruments LP5024 24-channel constant-current-sink RGB LED driver in the 32-pin 4 x 4 mm VQFN (RSM): VCC 2.7-5.5 V, 24 outputs up to 25.5 mA each (35 mA with VCC >= 3.3 V) set by one IREF resistor, 12-bit 29 kHz PWM per channel with 8-bit colour per output and 8-bit brightness per RGB group, three colour banks, I2C target up to 400 kHz at 0x28-0x2B (two address pins) plus broadcast 0x3C, 0.2 uA shutdown with EN low and 6 uA automatic power-save.",
  tags: ["lp5024", "texas-instruments", "ti", "led-driver", "rgb", "constant-current", "pwm", "i2c", "vqfn-32", "ic"],
  categories: ["component.ic"],

  interfaces: [...pins, i2c, supply, ...rgbLeds, pcbMount],

  interfaceGroups: [
    {
      id: "required_pins",
      label: "Pins that must be connected: VCC (27), GND pad (33), VCAP (32), IREF (31), ADDR0/ADDR1 (25/26), SDA/SCL (28/29)",
      members: [pinId(27), pinId(33), pinId(32), pinId(31), pinId(25), pinId(26), pinId(28), pinId(29)],
      policy: "all_of",
    },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "vcc", name: "VCC (device supply)", voltage_range_V: VCC }],
      metadata: {
        supply_current: { shutdown_uA: [0.2, 1], standby_uA: [6, 10], normal_mA: [5, 8], power_save_uA: [6, 10] },
        uvlo_V: { restart_max: 2.5, shutdown_min: 2.0, hysteresis: 0.2 },
        output: {
          channels: 24,
          imax_mA: { max_current_option_0: 25.5, max_current_option_1_vcc_ge_3V3: 35 },
          ilim_mA: { option_0: [35, 55, 80], option_1: [40, 75, 120] },
          leakage_uA: [0.1, 1],
          current_error_percent: { device_to_device: 7, channel_to_channel: 7 },
          vsat_V_at_20mA: { option_0: [0.25, 0.35], option_1: [0.3, 0.4] },
          viref_V: 0.7,
          kiref: 105,
        },
        pwm: { resolution_bits: 12, frequency_kHz: [21, 29] },
        logic_levels: { vih_min_V: 1.4, vil_max_V: 0.4, input_current_uA: 1, sda_vol_max_V: 0.4, sda_vol_condition: "IPULLUP 5 mA" },
        source: `${SRC.datasheet} (§6.5, §6.6)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 4.0, width: 4.0, height: 1.0 },
      package: {
        name: "VQFN-32",
        code: "RSM (RSM0032B)",
        pin_count: 32,
        pitch_mm: 0.4,
        exposed_pad: true,
        exposed_pad_pin: 33,
        exposed_pad_mm: [2.8, 2.8],
        source: `${SRC.datasheet} (Device Information: VQFN (32) 4.00 mm x 4.00 mm; Figure 5-2 "LP5024 RSM Package 32-Pin VQFN With Exposed Thermal Pad"; RSM0032B 4219108/B: body 3.9-4.1 x 3.9-4.1, 1 mm max height, 28X 0.4 pitch, terminals 0.15-0.25 x 0.25-0.45, exposed thermal pad 33 2.8 +-0.05 square)`,
        assumption: "Height 1.0 mm is the drawing's maximum; RSM0032B gives no nominal height (see the assumption trait).",
      },
      metadata: {
        body_mm: "3.9-4.1 x 3.9-4.1; 1 mm max height; standoff 0.00-0.05",
        terminal_mm: "width 0.15-0.25, length 0.25-0.45",
        mounting_method: "surface_mount",
        msl: "Level-2-260C-1 YEAR",
        lead_finish: "NIPDAU | NIPDAUAG",
        source: `${SRC.datasheet} (§11 package option addendum; RSM0032B)`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: {
        junction_C: [-40, 125],
        storage_C: [-65, 150],
        rtheta_ja_C_per_W: 36.4,
        rtheta_jc_top_C_per_W: 34.8,
        rtheta_jb_C_per_W: 15.9,
        psi_jt_C_per_W: 0.9,
        psi_jb_C_per_W: 16,
        rtheta_jc_bot_C_per_W: 6.3,
        thermal_shutdown_C: 160,
        thermal_shutdown_release_C: 145,
        cooling_method: "PCB heat spreading through the exposed thermal pad and vias",
        source: `${SRC.datasheet} (§6.1, §6.3, §6.4, §6.5, §7.3.5.1)`,
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        en_iref_outx_scl_sda_vcc_V: [-0.3, 6],
        addrx_V: "-0.3 to VCC + 0.3",
        vcap_V: [-0.3, 2],
        power_dissipation: "internally limited",
        junction_temperature_C: [-40, 125],
        storage_temperature_C: [-65, 150],
        esd_hbm_V: 4000,
        esd_cdm_V: 1500,
        source: `${SRC.datasheet} (§6.1, §6.2)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vcc_V: VCC,
        outx_V: OUT_V,
        addrx_en_sda_scl_V: LOGIC,
        ambient_temperature_C: [-40, 85],
        source: [`${SRC.datasheet} (§6.3; §11 package option addendum: LP5024RSMR -40 to 85 C)`, SRC.partDetails],
      },
    },
    {
      type: "performance",
      params: {
        kind: "led_driver",
        channels: 24,
        rgb_groups: 8,
        output_type: "constant-current sink",
        output_current_max_mA: "25.5 (VCC 2.7-5.5 V, Max_Current_Option = 0); 35 (VCC >= 3.3 V, Max_Current_Option = 1)",
        current_setting: "RIREF = 105 x 0.7 V / ISET, one resistor for all channels",
        pwm: "12-bit, 29 kHz typ, per channel; 3-phase PWM shifting; optional dithering",
        color_control: "8-bit OUTx_COLOR per output, 8-bit LEDx_BRIGHTNESS per three outputs, banks A/B/C with BANK_BRIGHTNESS",
        dimming_curve: "logarithmic (default) or linear (Log_Scale_EN)",
        accuracy_percent: "+-7 device-to-device, +-7 channel-to-channel at 10 mA",
        source: `${SRC.datasheet} (§1, §6.5, §7.3, §7.6)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "firmware",
        note: "After EN goes high (and tEN_H), write DEVICE_CONFIG0 (00h) = 0x40 (Chip_EN = 1) to leave STANDBY. DEVICE_CONFIG1 (01h) resets to 3Ch: Log_Scale_EN, Power_Save_EN, Auto_Incr_EN and PWM_Dithering_EN on, Max_Current_Option = 0 (25.5 mA), LED_Global_Off = 0. Writing FFh to RESET (27h) resets all registers. LEDx_BRIGHTNESS resets to FFh and OUTx_COLOR to 00h, so outputs start dark.",
        source: `${SRC.datasheet} (§7.4, §7.6 Table 7-4, §7.6.1, §7.6.2)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "LED headroom",
        note: "Each output needs its LED's forward voltage plus VSAT (0.25 V typ / 0.35 V max at 20 mA, Max_Current_Option = 0; 0.3 / 0.4 V with option 1) from the LED supply; the output voltage must stay within 0-5.5 V. Power dissipated in the device is the sum of output voltage x current, so a high LED supply heats the package (thermal shutdown at 160 C).",
        source: `${SRC.datasheet} (§6.3, §6.5, §8.4.1)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "LP5024RSMR: VQFN (RSM) 32, 3000-unit large tape and reel, Active, -40 to 85 C, marking LP 5024. LP5024RSMRG4 is listed separately (NIPDAU finish only). The LP5018 (18 channels) shares this datasheet and pinout except that its RSM pins 19-24 are NC.",
        source: [`${SRC.datasheet} (§5 Table 5-1, §11 package option addendum)`, SRC.partDetails],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "supply current by mode",
        values: [
          "§6.5 Electrical Characteristics: normal 5 mA typ / 8 mA max (10 mA per output); standby 6 uA typ / 10 uA max; power-save 6 uA typ / 10 uA max",
          "§7.4 Device Functional Modes: normal ICC 10 mA typ; standby 10 uA typ; power-save 10 uA typ (power-save 10 uA typ also in §1, §4 and §7.3.4)",
        ],
        sources: [SRC.datasheet],
        resolution: "The electrical characteristics table is the specification and is used for current_draw and the metadata; the §7.4 figures are descriptive.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "package height (CAD, dimensions)",
        value: "1.0 mm",
        reason: "RSM0032B gives \"1 MAX\" and no nominal; the maximum is used so a clearance check is conservative.",
        source: SRC.datasheet,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "body 4.00 x 4.00 x 1.00 mm; terminals 0.20 x 0.35 mm flush with the body edge, centres 1.825 mm from the body centre; exposed pad 2.80 mm square; terminal and pad thickness 0.02 mm below the body; pin-1 dimple 0.40 mm diameter, 0.03 mm deep",
        reason: "RSM0032B gives toleranced plan dimensions (midpoints used), no terminal thickness (only the 0.00-0.05 standoff) and no size for the pin 1 index area.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The TI product folder offers CAD symbols, footprints and 3D models for VQFN (RSM) 32 only through Ultra Librarian, whose download needs its terms accepted (and third-party cookies) and states no licence permitting redistribution. Nothing was downloaded. Geometry is generated from RSM0032B (library/cad/py/catalog/ti-lp5024rsm.py).",
        source: [SRC.product, SRC.cadSearch],
      },
    },
    {
      type: "data_gap",
      params: { field: "VCAP voltage", note: "The internal LDO output voltage on VCAP is not stated; only its -0.3 to 2 V absolute maximum.", source: SRC.datasheet },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "Neither the datasheet nor the product pages state a mass.", source: [SRC.datasheet, SRC.product] },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "LP5018/LP5024 datasheet SLVSEB8C (incl. RSM0032B outline)", type: "datasheet", url: SRC.datasheet },
    { id: "art_product", name: "TI LP5024 product folder", type: "documentation", url: SRC.product },
    { id: "art_part_details", name: "TI LP5024RSMR part details", type: "documentation", url: SRC.partDetails },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from RSM0032B. Seating plane z = 0, body centred on the
// origin. Top view as Figure 5-2: pins 1-8 down the -x edge (pin 1 at +y),
// 9-16 along -y, 17-24 up +x, 25-32 along +y right to left; pad 33 centred.
// ---------------------------------------------------------------------------

const PAD_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.07, centroid: [-1.825, 1.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.07, centroid: [-1.825, 1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.07, centroid: [-1.825, 0.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.07, centroid: [-1.825, 0.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.07, centroid: [-1.825, -0.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.07, centroid: [-1.825, -0.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.07, centroid: [-1.825, -1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.07, centroid: [-1.825, -1.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.07, centroid: [-1.4, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.07, centroid: [-1.0, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_11: feature("pin_11", { area_mm2: 0.07, centroid: [-0.6, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_12: feature("pin_12", { area_mm2: 0.07, centroid: [-0.2, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_13: feature("pin_13", { area_mm2: 0.07, centroid: [0.2, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_14: feature("pin_14", { area_mm2: 0.07, centroid: [0.6, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_15: feature("pin_15", { area_mm2: 0.07, centroid: [1.0, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_16: feature("pin_16", { area_mm2: 0.07, centroid: [1.4, -1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_17: feature("pin_17", { area_mm2: 0.07, centroid: [1.825, -1.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_18: feature("pin_18", { area_mm2: 0.07, centroid: [1.825, -1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_19: feature("pin_19", { area_mm2: 0.07, centroid: [1.825, -0.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_20: feature("pin_20", { area_mm2: 0.07, centroid: [1.825, -0.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_21: feature("pin_21", { area_mm2: 0.07, centroid: [1.825, 0.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_22: feature("pin_22", { area_mm2: 0.07, centroid: [1.825, 0.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_23: feature("pin_23", { area_mm2: 0.07, centroid: [1.825, 1.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_24: feature("pin_24", { area_mm2: 0.07, centroid: [1.825, 1.4, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_25: feature("pin_25", { area_mm2: 0.07, centroid: [1.4, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_26: feature("pin_26", { area_mm2: 0.07, centroid: [1.0, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_27: feature("pin_27", { area_mm2: 0.07, centroid: [0.6, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_28: feature("pin_28", { area_mm2: 0.07, centroid: [0.2, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_29: feature("pin_29", { area_mm2: 0.07, centroid: [-0.2, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_30: feature("pin_30", { area_mm2: 0.07, centroid: [-0.6, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_31: feature("pin_31", { area_mm2: 0.07, centroid: [-1.0, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_32: feature("pin_32", { area_mm2: 0.07, centroid: [-1.4, 1.825, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_33: feature("pin_33", { area_mm2: 7.84, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const TI_LP5024RSM: ModuleDef = withGeometry(
  TI_LP5024RSM_BASE,
  {
    ...Object.fromEntries(Object.entries(PAD_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    i2c: { refs: [PAD_FEATURES.pin_28, PAD_FEATURES.pin_29] },
    supply: { refs: [PAD_FEATURES.pin_27, PAD_FEATURES.pin_33] },
    ...Object.fromEntries(
      rgbLeds.map((led, k) => [led.id, { refs: [PAD_FEATURES[pinId(3 * k + 1)], PAD_FEATURES[pinId(3 * k + 2)], PAD_FEATURES[pinId(3 * k + 3)]] }]),
    ),
    // terminals and exposed pad onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 10.08, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/ti-lp5024rsm/artifacts/cad",
    name: "ti-lp5024-rsm32",
    generator: "library/cad/py/catalog/ti-lp5024rsm.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

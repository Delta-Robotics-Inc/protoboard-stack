/**
 * Raytac MDBT50Q-1MV2 Bluetooth LE module (Nordic nRF52840 revision 2, chip
 * antenna; order codes MD-240A3-007 tray, MD-240A3-007R reel) —
 * datasheet-honest UHD part.
 *
 * Sources (see ./raytac-mdbt50q-1mv2/sources.json):
 *   - src_datasheet: Raytac approval sheet Version L (2023-05-24) —
 *     https://www.raytac.com/download/index.php?index_id=43
 *     (§1.2 features, §2.1 dimensions, §2.2 pad layout, §2.3 RF keep-out,
 *     §2.5-2.6 pin assignment, §3, §4 mass and order codes, §5.1-5.3 ratings
 *     and currents copied from nRF52840 PS v1.7, §8 reference circuits)
 *   - src_datasheet_k: Version K (2022-07-01), the copy the project brief
 *     read — https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf
 *   - src_product: Raytac product page — https://www.raytac.com/product/ins.php?index_id=24
 *   - src_nordic_ps: Nordic nRF52840 Product Specification v1.11 —
 *     https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6469/NRF52840-DK.pdf
 *     (§5.2.1 currents, §5.3.1 supply modes, §5.3.8 regulators and USB,
 *     §6.9 GPIO, §6.25 SPIM, §6.31 TWIM, §6.34 UARTE, §6.35 USBD)
 *   - src_design_guide: Raytac MDBT50Q design-guide archive (2D drawing
 *     v1.1 2023-06-06, STEP 2018-06-20) —
 *     https://www.raytac.com/document/act.php?act=1&index_id=30
 *
 * Modelling notes:
 *   - Pin-honest: all 61 bottom pads are leaves `pin_1`..`pin_61` with the §2.5
 *     names (two-function pads keep both, e.g. "P0.00/XL1") and a verbatim
 *     `pin_functions` trait. Pads 34/35 (D-/D+) and 51/53 (SWDIO/SWDCLK) are
 *     built by hand so they carry `usb` / `swd` protocols instead of GPIO.
 *   - Supplies: VDD (28) is a 1.7-3.6 V input (normal voltage mode, VDD shorted
 *     to VDDH). VDDH (30) accepts 1.7-5.5 V: 1.7-3.6 V when shorted to VDD, 2.5-5.5 V
 *     alone (high voltage mode). In high voltage mode VDD instead carries the
 *     REG0 output (1.8-3.3 V, up to 25 mA external). That is recorded as a usage
 *     note, not a PowerOut, because the same pad is an input in normal mode.
 *     VBUS (32) is the 4.35-5.5 V USB regulator input. DCCH (31) is the REG0
 *     DC/DC switch node: a `passive` pad, left unconnected in Raytac's < 3.6 V
 *     reference circuit (§8.3).
 *   - GPIO: 48 pads. The 27 full-drive pads carry the bus capability tags
 *     (i2c/spi/uart/pwm) because nRF52840 maps any peripheral to any pin
 *     (PS §6.9). The 21 pads Raytac marks "standard drive, low frequency I/O
 *     only" (<= 10 kHz, §2.6) carry only digital, interrupt and (AIN pads)
 *     analog tags plus `low_frequency_io`.
 *   - No I2C/SPI/UART/PWM composites are declared: their pins are chosen in
 *     firmware (PSEL), UHD has no per-instance pin assignment, and a fixed
 *     default profile would invent a pinout (.research/gaps.json, vocabulary).
 *     The board that uses the module states the assignment. `usb` and `swd`
 *     are composites because their pads are fixed.
 *   - The radio is `ble_radio` (network domain), bound to the chip-antenna
 *     feature; the RF keep-out is a usage note (a board requirement).
 *   - Package facts: Raytac names no package type; the mechanical domain's
 *     `package` states 61 numbered pads, no exposed pad, 15.5 x 10.5 x 2.05 mm.
 *     Mass 0.68 g (§4); the project brief assumed about 1 g, superseded.
 *   - Geometry is generated (library/cad/py/catalog/raytac-mdbt50q-1mv2.py):
 *     Raytac's STEP has no licence stated and no pads, so it is measurement
 *     evidence only (data_gap trait). Each pin leaf binds its own pad
 *     feature; `pcb_mount` binds the module underside. Pad size, pad thickness
 *     and the shield offset are assumption traits; shield size follows the
 *     2023 drawing over the 2018 STEP (source_discrepancy trait).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { defineModule, pinTable, voltageRangeV } from "@deltarobotics/uhd";
import type { PinRow } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.raytac.com/download/index.php?index_id=43",
  datasheetK: "https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf",
  product: "https://www.raytac.com/product/ins.php?index_id=24",
  nordicPs: "https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6469/NRF52840-DK.pdf",
  designGuide: "https://www.raytac.com/document/act.php?act=1&index_id=30",
} as const;

const PIN_TABLE = `${SRC.datasheet} (§2.5 Pin Assignment)`;

/** GPIO logic level: VDD in normal voltage mode (1.7-3.6 V), REGOUT0 (1.8-3.3 V) in high voltage mode. */
const LOGIC: [number, number] = [1.7, 3.6];
const VDD: [number, number] = [1.7, 3.6]; // PS §5.3.8.1, normal voltage mode
const VDDH: [number, number] = [1.7, 5.5]; // 1.7-3.6 shorted to VDD, 2.5-5.5 alone (PS §5.3.1, §5.3.8.1)
const VBUS: [number, number] = [4.35, 5.5]; // PS §5.3.8.5

const FULL_CAPS = ["i2c_sda", "i2c_scl", "spi_mosi", "spi_miso", "spi_sck", "spi_ss", "uart_tx", "uart_rx", "uart_rts", "uart_cts", "pwm_out", "interrupt"];
const PWM_OUT = { type: "pwm", roles: ["output"] };
const INT_IN = { type: "interrupt", roles: ["input"] };
const ANALOG_IN = { type: "analog", roles: ["input"] };

/** A full-drive GPIO pad: any peripheral can be routed to it (PS §6.9). */
function gpio(pin: number, name: string, description: string, extra: string[] = []): PinRow {
  return { pin, name, type: "io", description, capabilities: [...FULL_CAPS, ...extra], protocols: [PWM_OUT, INT_IN] };
}

/** A standard-drive, low-frequency-only GPIO pad (<= 10 kHz; not SPI, I2C, UART or PWM, §2.6). */
function lowGpio(pin: number, name: string, description: string, ain?: number, extra: string[] = []): PinRow {
  return {
    pin,
    name,
    type: "io",
    description,
    capabilities: ["interrupt", "low_frequency_io", ...(ain !== undefined ? ["analog_in", `ain${ain}`] : []), ...extra],
    protocols: [INT_IN, ...(ain !== undefined ? [ANALOG_IN] : [])],
  };
}

const LF = "General-purpose I/O (standard drive, low frequency I/O only)";
const GP = "General-purpose I/O";
const GPD = "General-purpose digital I/O";
const lfAin = (p: string, ain: number) => `${p}: Digital I/O, ${LF}; AIN${ain}: Analog input`;

const tablePins = pinTable(
  [
    { pin: 1, name: "GND", type: "ground", description: "GND: Power, Ground" },
    { pin: 2, name: "GND", type: "ground", description: "GND: Power, Ground" },
    lowGpio(3, "P1.10", `P1.10: Digital I/O, ${LF}`),
    lowGpio(4, "P1.11", `P1.11: Digital I/O, ${LF}`),
    lowGpio(5, "P1.12", `P1.12: Digital I/O, ${LF}`),
    lowGpio(6, "P1.13", `P1.13: Digital I/O, ${LF}`),
    lowGpio(7, "P1.14", `P1.14: Digital I/O, ${LF}`),
    lowGpio(8, "P1.15", `P1.15: Digital I/O, ${LF}`),
    lowGpio(9, "P0.03/AIN1", lfAin("P0.03", 1), 1),
    lowGpio(10, "P0.29/AIN5", lfAin("P0.29", 5), 5),
    lowGpio(11, "P0.02/AIN0", lfAin("P0.02", 0), 0),
    lowGpio(12, "P0.31/AIN7", lfAin("P0.31", 7), 7),
    lowGpio(13, "P0.28/AIN4", lfAin("P0.28", 4), 4),
    lowGpio(14, "P0.30/AIN6", lfAin("P0.30", 6), 6),
    { pin: 15, name: "GND", type: "ground", description: "GND: Power, Ground" },
    gpio(16, "P0.27", `P0.27: Digital I/O, ${GP}`),
    gpio(17, "P0.00/XL1", `P0.00: Digital I/O, ${GP}; XL1: Analog input, Connection for 32.768 kHz crystal`, ["lfxo_xl1"]),
    gpio(18, "P0.01/XL2", `P0.01: Digital I/O, ${GP}; XL2: Analog input, Connection for 32.768 kHz crystal`, ["lfxo_xl2"]),
    gpio(19, "P0.26", `P0.26: Digital I/O, ${GP}`),
    { ...gpio(20, "P0.04/AIN2", `P0.04: Digital I/O, ${GP}; AIN2: Analog input`, ["analog_in", "ain2"]), protocols: [PWM_OUT, INT_IN, ANALOG_IN] },
    { ...gpio(21, "P0.05/AIN3", `P0.05: Digital I/O, ${GP}; AIN3: Analog input`, ["analog_in", "ain3"]), protocols: [PWM_OUT, INT_IN, ANALOG_IN] },
    gpio(22, "P0.06", `P0.06: Digital I/O, ${GP}`),
    gpio(23, "P0.07/TRACECLK", `P0.07: Digital I/O, ${GP}; TRACECLK: Trace clock, Trace buffer clock`, ["traceclk"]),
    gpio(24, "P0.08", `P0.08: Digital I/O, ${GP}`),
    gpio(25, "P1.08", `P1.08: Digital I/O, ${GP}`),
    gpio(26, "P1.09/TRACEDATA3", `P1.09: Digital I/O, ${GP}; TRACEDATA3: Trace data, Trace buffer TRACEDATA[3]`, ["tracedata3"]),
    gpio(27, "P0.11/TRACEDATA2", `P0.11: Digital I/O, ${GP}; TRACEDATA2: Trace data, Trace buffer TRACEDATA[2]`, ["tracedata2"]),
    {
      pin: 28,
      name: "VDD",
      type: "power_in",
      voltageV: VDD,
      nominalV: 3,
      description: "VDD: Power, Power supply",
      traits: [
        {
          type: "usage_note",
          params: {
            note: "Normal voltage mode: supply 1.7-3.6 V (typ 3.0 V) on VDD and VDDH together (Raytac §8.3 uses one 10 uF on both). High voltage mode: leave VDD off any supply; it then carries the REG0 output (1.8-3.3 V set by REGOUT0) and may feed external circuits up to 25 mA at <= 4 dBm TX, 5 mA above 4 dBm, 1 mA in System OFF. Effective decoupling on VDD 2.7-5.5 uF.",
            source: [`${SRC.nordicPs} (§5.3.1, §5.3.1.3, §5.3.8.1-5.3.8.2)`, `${SRC.datasheet} (§8.1-8.3)`],
          },
        },
      ],
    },
    gpio(29, "P0.12/TRACEDATA1", `P0.12: Digital I/O, ${GP}; TRACEDATA1: Trace data, Trace buffer TRACEDATA[1]`, ["tracedata1"]),
    {
      pin: 30,
      name: "VDDH",
      type: "power_in",
      voltageV: VDDH,
      description: "VDDH: Power, High voltage power supply",
      traits: [
        {
          type: "usage_note",
          params: {
            note: "Normal voltage mode: short to VDD (1.7-3.6 V). High voltage mode: the only supply input, 2.5-5.5 V (typ 3.7 V); Raytac recommends VDDH supply when the highest input voltage is 3.6 V or more (§8.1-8.2).",
            source: [`${SRC.nordicPs} (§5.3.1, §5.3.8.1)`, `${SRC.datasheet} (§8.1-8.3)`],
          },
        },
      ],
    },
    {
      pin: 31,
      name: "DCCH",
      type: "passive",
      description: "DCCH: Power, DC/DC converter output",
      traits: [
        {
          type: "usage_note",
          params: {
            note: "REG0 DC/DC switch node. With REG0 DC/DC enabled (high voltage mode) connect an inductor from DCCH to VDD (Raytac recommends 10 uH, 0603, IDC min 80 mA, +-20 %). Unconnected in the reference circuit for inputs below 3.6 V (VDD and VDDH supplied together). Do not enable a DC/DC regulator without its LC filter.",
            source: [`${SRC.datasheet} (§8 notes, §8.1, §8.3)`, `${SRC.nordicPs} (§5.3.1.1)`],
          },
        },
      ],
    },
    {
      pin: 32,
      name: "VBUS",
      type: "power_in",
      voltageV: VBUS,
      nominalV: 5,
      description: "VBUS: Power, 5V input for USB 3.3V regulator",
      traits: [
        {
          type: "usage_note",
          params: {
            note: "USB regulator input and VBUS detection, 4.35-5.5 V. Raytac's USB reference decouples VBUS with 10 uF. USB active draws 2.4 mA from VBUS.",
            source: [`${SRC.nordicPs} (§5.2.1.10, §5.3.8.5)`, `${SRC.datasheet} (§8.3-8.4)`],
          },
        },
      ],
    },
    { pin: 33, name: "GND", type: "ground", description: "GND: Power, Ground" },
    gpio(36, "P0.14", `P0.14: Digital I/O, ${GPD}`),
    gpio(37, "P0.13", `P0.13: Digital I/O, ${GPD}`),
    gpio(38, "P0.16", `P0.16: Digital I/O, ${GPD}`),
    gpio(39, "P0.15", `P0.15: Digital I/O, ${GPD}`),
    gpio(40, "P0.18/nRESET", `P0.18: Digital I/O, ${GPD} (recommended usage: QSPI / CSN); nRESET: Configurable as system RESET`, ["reset", "qspi"]),
    gpio(41, "P0.17", `P0.17: Digital I/O, ${GPD}`),
    gpio(42, "P0.19", `P0.19: Digital I/O, ${GPD} (recommended usage: QSPI / SCK)`, ["qspi"]),
    gpio(43, "P0.21", `P0.21: Digital I/O, ${GPD} (recommended usage: QSPI)`, ["qspi"]),
    gpio(44, "P0.20", `P0.20: Digital I/O, ${GPD}`),
    gpio(45, "P0.23", `P0.23: Digital I/O, ${GPD} (recommended usage: QSPI)`, ["qspi"]),
    gpio(46, "P0.22", `P0.22: Digital I/O, ${GPD} (recommended usage: QSPI)`, ["qspi"]),
    gpio(47, "P1.00/TRACEDATA0", `P1.00: Digital I/O, ${GPD} (recommended usage: QSPI); TRACEDATA0: Trace data, Trace buffer TRACEDATA[0]`, ["qspi", "tracedata0"]),
    gpio(48, "P0.24", `P0.24: Digital I/O, ${GPD}`),
    gpio(49, "P0.25", `P0.25: Digital I/O, ${GPD}`),
    lowGpio(50, "P1.02", `P1.02: Digital I/O, ${LF}`),
    lowGpio(52, "P0.09/NFC1", `P0.09: Digital I/O, ${LF}; NFC1: NFC input, NFC antenna connection`, undefined, ["nfc1"]),
    lowGpio(54, "P0.10/NFC2", `P0.10: Digital I/O, ${LF}; NFC2: NFC input, NFC antenna connection`, undefined, ["nfc2"]),
    { pin: 55, name: "GND", type: "ground", description: "GND: Power, Ground" },
    lowGpio(56, "P1.04", `P1.04: Digital I/O, ${LF}`),
    lowGpio(57, "P1.06", `P1.06: Digital I/O, ${LF}`),
    lowGpio(58, "P1.07", `P1.07: Digital I/O, ${LF}`),
    lowGpio(59, "P1.05", `P1.05: Digital I/O, ${LF}`),
    lowGpio(60, "P1.03", `P1.03: Digital I/O, ${LF}`),
    lowGpio(61, "P1.01", `P1.01: Digital I/O, ${LF}`),
  ],
  { source: PIN_TABLE, logicV: LOGIC },
);

function fn(description: string): TraitDef {
  return { type: "pin_functions", params: { description, source: PIN_TABLE } };
}

/** USB data pad (fixed function, not a GPIO). */
function usbPad(pin: number, name: string, cap: string, description: string): InterfaceDef {
  return {
    id: `pin_${pin}`,
    name,
    pin,
    domain: "electrical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "usb", roles: ["bidirectional"] }],
    capabilities: [cap],
    traits: [
      fn(description),
      {
        type: "usage_note",
        params: {
          note: "Raytac's reference circuits put 27 Ohm in series with D+ and D- to the USB connector; leave D+ and D- unconnected when USB is not used.",
          source: `${SRC.datasheet} (§8.3-8.5)`,
        },
      },
    ],
  };
}

/** Serial wire debug pad (fixed function). */
function swdPad(pin: number, name: string, roles: string[], cap: string, description: string): InterfaceDef {
  return {
    id: `pin_${pin}`,
    name,
    pin,
    domain: "electrical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "swd", roles }],
    capabilities: [cap],
    parameters: [voltageRangeV(LOGIC[0], LOGIC[1])],
    traits: [fn(description)],
  };
}

const fixedPins: InterfaceDef[] = [
  usbPad(34, "D-", "usb_dm", "D-: Digital I/O, USB D-"),
  usbPad(35, "D+", "usb_dp", "D+: Digital I/O, USB D+"),
  swdPad(51, "SWDIO", ["bidirectional"], "swdio", "SWDIO: Debug, Serial wire debug I/O for debug and programming"),
  swdPad(53, "SWDCLK", ["input"], "swdclk", "SWDCLK: Debug, Serial wire debug clock input for debug and programming"),
];

const pins: InterfaceDef[] = [...tablePins, ...fixedPins].sort((a, b) => Number(a.pin) - Number(b.pin));

// ---------------------------------------------------------------------------
// Fixed-function composites
// ---------------------------------------------------------------------------

const usb: InterfaceDef = {
  id: "usb",
  name: "USB 2.0 full-speed device (USBD)",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "usb", roles: ["device"] }],
  capabilities: ["usb_2_0", "usb_full_speed"],
  slots: [
    { id: "dp", required: true, match: { protocol: "usb", capability: "usb_dp" } },
    { id: "dm", required: true, match: { protocol: "usb", capability: "usb_dm" } },
    { id: "vbus", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "usb_pins", label: "D+ 35, D- 34, VBUS 32, GND 33", default_active: true, bindings: { dp: "pin_35", dm: "pin_34", vbus: "pin_32", gnd: "pin_33" } }],
  parameters: [{ id: "max_frequency", name: "Bit rate", unit: "Hz", value: 12_000_000 }],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "USB 2.0 full-speed (12 Mbps) device controller with its own 3.3 V regulator fed from VBUS (4.35-5.5 V); VBUS also serves as plug detection.",
        source: [`${SRC.nordicPs} (§6.35, §5.3.8.5-5.3.8.6)`, `${SRC.datasheet} (§1.2)`],
      },
    },
  ],
};

const swd: InterfaceDef = {
  id: "swd",
  name: "Serial wire debug (programming)",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "swd", roles: ["target"] }],
  capabilities: ["swd", "programming"],
  slots: [
    { id: "swdio", required: true, match: { protocol: "swd", capability: "swdio" } },
    { id: "swdclk", required: true, match: { protocol: "swd", capability: "swdclk" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
    { id: "nreset", required: false, match: { protocol: "digital", capability: "reset" } },
  ],
  profiles: [{ id: "swd_pins", label: "SWDIO 51, SWDCLK 53, GND 55, nRESET 40", default_active: true, bindings: { swdio: "pin_51", swdclk: "pin_53", gnd: "pin_55", nreset: "pin_40" } }],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "SWDIO/SWDCLK are the debug and programming port. P0.18 (pad 40) is configurable as the system reset input.",
        source: PIN_TABLE,
      },
    },
  ],
};

const bleRadio: InterfaceDef = {
  id: "ble_radio",
  name: "2.4 GHz radio (Bluetooth LE, IEEE 802.15.4, ANT), chip antenna",
  domain: "network",
  exposed: true,
  default_active: true,
  protocols: [{ type: "bluetooth", roles: ["peer"] }],
  capabilities: ["bluetooth_le", "bluetooth_5", "bluetooth_long_range", "ieee_802_15_4", "ant", "chip_antenna"],
  parameters: [{ id: "tx_power", name: "TX power", unit: "dBm", range: [-20, 8] }],
  traits: [
    {
      type: "performance",
      params: {
        kind: "radio",
        modes: ["Bluetooth 5: 2 Mbps, 1 Mbps, 500 kbps, 125 kbps", "IEEE 802.15.4-2006: 250 kbps", "Proprietary 2.4 GHz: 2 Mbps, 1 Mbps"],
        tx_power_dBm: "+8 to -20 in 4 dB steps",
        sensitivity_dBm: { ble_1mbps: -95, ble_125kbps: -103 },
        working_distance_m: { "125kbps": "over 550", "1mbps": "over 300", "2mbps": "over 150", note: "tested in open space" },
        antenna: "chip (ceramic) antenna on the module",
        current_mA: { tx_plus8dBm: 16.4, tx_0dBm: 6.4, rx_1mbps: 6.26, note: "1 Mbps BLE, HFXO, DC/DC" },
        certifications: ["FCC", "IC", "CE", "Telec (MIC)", "KC", "SRRC", "NCC", "RCM", "WPC"],
        source: [`${SRC.datasheet} (cover page, §1.2)`, `${SRC.nordicPs} (§5.2.1.5)`, SRC.product],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Place the module at the board edge. No ground pad in any layer under the antenna: the antenna area is the 3.8 mm at the antenna end, kept clear as wide as possible beyond the module width; also no top-layer ground in a 1.6 x 1.2 mm area starting 2.95 mm from the left edge just below the antenna area (top view).",
        source: `${SRC.datasheet} (§2.3)`,
      },
    },
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "61 bottom pads (SMD module)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "smd_module_pads",
        note: "61 pads on the module underside, 0.6 x 0.4 mm in Raytac's recommended layout; module 15.5 x 10.5 (-0.15/+0.2) x 2.05 mm. MSL 2 (nRF52840 package rating).",
        source: [`${SRC.datasheet} (§2.1-2.2, §5.1)`, SRC.designGuide],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const GND_PINS = ["pin_1", "pin_2", "pin_15", "pin_33", "pin_55"];

const RAYTAC_MDBT50Q_1MV2_BASE: ModuleDef = defineModule({
  id: "raytac-mdbt50q-1mv2",
  name: "Raytac MDBT50Q-1MV2 nRF52840 module (chip antenna)",
  version: "1.0.0",
  manufacturer: "Raytac Corporation",
  part_number: "MDBT50Q-1MV2",
  description:
    "Certified Bluetooth LE module on the Nordic nRF52840 (Cortex-M4F 64 MHz, 1 MB flash, 256 kB RAM) with chip antenna, 32 MHz crystal and REG1 DC/DC inductor inside. 61 bottom pads: 48 GPIO (8 analog inputs, NFC), USB 2.0 full-speed device, SWD. Supply 1.7-3.6 V on VDD+VDDH or 2.5-5.5 V on VDDH; VBUS 4.35-5.5 V. 15.5 x 10.5 x 2.05 mm, 0.68 g.",
  tags: ["nrf52840", "raytac", "mdbt50q", "bluetooth-le", "ble", "802.15.4", "usb", "module", "chip-antenna", "mcu"],
  categories: ["microcontroller.module", "connectivity.wireless"],
  interfaces: [...pins, usb, swd, bleRadio, pcbMount],
  interfaceGroups: [
    { id: "ground_pads", label: "Ground pads 1, 2, 15, 33, 55", members: GND_PINS, policy: "all_of" },
  ],
  artifacts: [
    { id: "datasheet", name: "Raytac MDBT50Q-1MV2 approval sheet Ver. L", type: "datasheet", url: SRC.datasheet },
    { id: "soc_datasheet", name: "Nordic nRF52840 Product Specification v1.11", type: "datasheet", url: SRC.nordicPs },
    { id: "product", name: "Raytac MDBT50Q-1MV2 product page", type: "documentation", url: SRC.product },
    { id: "design_guide", name: "Raytac MDBT50Q design guide archive (2D drawing, 3D model)", type: "documentation", url: SRC.designGuide },
  ],
  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vdd", name: "VDD (normal voltage mode)", nominal_voltage_V: 3, voltage_range_V: VDD },
        { id: "vddh", name: "VDDH (high voltage mode 2.5-5.5 V; shorted to VDD in normal mode)", nominal_voltage_V: 3.7, voltage_range_V: VDDH },
        { id: "vbus", name: "VBUS (USB regulator input)", nominal_voltage_V: 5, voltage_range_V: VBUS },
      ],
      metadata: {
        soc: "Nordic nRF52840 revision 2, aQFN-73",
        cpu: "Arm Cortex-M4 with FPU, 64 MHz",
        memory: { flash_kB: 1024, ram_kB: 256 },
        peripherals: {
          gpio: 48,
          spi_master: 4,
          spi_slave: 3,
          twi: 2,
          uart: 2,
          pwm: "4 x 4 channels",
          adc: "12-bit, 200 ksps, 8 channels",
          other: ["I2S", "PDM", "QSPI 32 MHz", "QDEC", "NFC-A tag", "USB 2.0 full speed", "5 x 32-bit timers", "3 x RTC", "CryptoCell 310"],
        },
        bus_limits: { spim_Mbps: "32 (SPIM3; SPIM0-2 8 max)", twim_kbps: [100, 400], uarte_baud_max: 1_000_000 },
        gpio_electrical: {
          vih: "0.7 VDD", vil: "0.3 VDD",
          standard_drive_mA: { min: 1, typ: 2, max: 4 },
          high_drive_mA: { min: 6, typ: 10, max: 15, condition: "VDD >= 2.7 V" },
          pull_kOhm: [11, 16],
          low_frequency_pins: "pads 3-14, 50, 52, 54, 56-61: standard drive, <= 10 kHz",
        },
        currents_typ: {
          system_on_ram_on_rtc_uA: 3.16,
          system_on_ram_on_gpioteport_uA: 2.36,
          system_on_ram_on_gpiote_in_uA: 17.37,
          system_off_uA: 0.4,
          cpu_flash_64MHz_dcdc_mA: 3.3,
          usb_active_vbus_mA: 2.4,
        },
        internal: "32 MHz crystal and REG1 DC/DC inductor are inside the module",
        source: [`${SRC.datasheet} (§1.2, §2.5-2.6, §3, §5.3.11)`, `${SRC.nordicPs} (§5.2.1, §6.9.3.1, §6.25, §6.31, §6.34)`],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 15.5, width: 10.5, height: 2.05 },
      weight_g: 0.68,
      package: {
        name: "MDBT50Q module, 61 pads",
        pin_count: 61,
        exposed_pad: false,
        source: `${SRC.datasheet} (§2.1 L 15.5 x W 10.5 x H 2.05 mm and pin indication; §2.2 "x61 pad 0.6x0.4mm")`,
        assumption: "Raytac names no package type; the name states the module series and its 61 numbered bottom pads. Pads are not on a single pitch (0.8 mm along the bottom row, staggered 0.4 mm on the sides), so no pitch is given.",
      },
      metadata: {
        width_tolerance_mm: [-0.15, 0.2],
        height_tolerance_mm: [-0.15, 0.2],
        shield_mm: { length: 11.1, width: 9.7, top_mm: 2.0 },
        chip_antenna_mm: { length: 8.0, width: 1.0, top_mm: 2.05 },
        pcb_thickness_mm: 0.8,
        weight_tolerance_g: 0.02,
        source: [`${SRC.datasheet} (§2.1, §4)`, `${SRC.designGuide} (MDBT50Q_v1.1-230606.pdf; STEP for PCB thickness and antenna size)`],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: { storage_C: [-40, 125], junction_max_C: 90, source: `${SRC.datasheet} (cover page, §5.1-5.2)` },
    },
    {
      domain: "network",
      metadata: {
        radio: "2.4 GHz: Bluetooth 5, IEEE 802.15.4-2006, ANT, proprietary",
        tx_power_dBm: [-20, 8],
        antenna: "chip",
        source: `${SRC.datasheet} (§1.2)`,
      },
    },
  ],
  traits: [
    {
      type: "operating_conditions",
      params: {
        vdd_V: [1.7, 3.6],
        vdd_por_min_V: 1.75,
        vddh_V: [2.5, 5.5],
        vbus_V: [4.35, 5.5],
        supply_rise_time_max_ms: { vdd_0_to_1v7: 60, vddh_0_to_3v7: 100 },
        ambient_C: [-40, 85],
        junction_max_C: 90,
        note: "The on-chip power-on reset may not work for rise times longer than the maximum.",
        source: `${SRC.datasheet} (§5.2)`,
      },
    },
    {
      type: "absolute_maximum",
      params: {
        vdd_V: [-0.3, 3.9],
        vddh_V: [-0.3, 5.8],
        vbus_V: [-0.3, 5.8],
        io_pin_V: "-0.3 to VDD + 0.3 (VDD <= 3.6 V); -0.3 to 3.9 (VDD > 3.6 V)",
        nfc_pin_current_mA: 80,
        rf_input_dBm: 10,
        storage_C: [-40, 125],
        msl: 2,
        esd: "HBM 2 kV (class 2), CDM 450 V",
        flash: "10 000 write/erase cycles; 10 years retention at 85 C",
        source: `${SRC.datasheet} (§5.1)`,
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Peripheral pins are assigned in firmware: any TWIM, SPIM, UARTE, PWM, I2S, PDM or QSPI signal can be routed to any GPIO. Only the full-drive pads (16-29, 36-49 except the supply and USB pads) suit SPI, I2C, UART and PWM; the low-frequency pads (3-14, 50, 52, 54, 56-61) are for signals up to 10 kHz. Analog inputs are fixed: AIN0-AIN7 on pads 11, 9, 20, 21, 13, 10, 14, 12.",
        source: [`${SRC.nordicPs} (§6.9)`, `${SRC.datasheet} (§2.5-2.6)`],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Raytac ships the module with its test firmware in LDO mode, which needs an external 32.768 kHz crystal on XL1/XL2 (pads 17, 18; load capacitance up to 12.5 pF). DC/DC mode can be used without that crystal; with the internal RC oscillator omit the crystal and its capacitors. Without NFC, omit the NFC antenna and its capacitors.",
        source: [`${SRC.datasheet} (§8 notes)`, `${SRC.nordicPs} (§5.4.2.4)`],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "shield size",
        values: ["9.7 x 11.1 mm (2D drawing MDBT50Q_v1.1, 2023-06-06)", "9.5 x 10.9 x 1.2 mm (STEP 'MDBT50Q 3D Drawing_20180620')"],
        sources: [SRC.designGuide],
        resolution: "The newer dimensioned drawing is used for the shield outline; its 1.2 mm height (2.0 mm top over a 0.8 mm PCB) comes from the STEP and agrees with the 2.0 mm in §2.1.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "GPIO voltage parameter",
        value: "1.7-3.6 V on every logic pad",
        reason: "GPIO high level equals VDD (normal voltage mode, 1.7-3.6 V) or REGOUT0 (high voltage mode, 1.8-3.3 V); the parameter states the union so a 3.0 V or 3.3 V rail checks against it (PS §5.3.1.2).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD pad size and thickness",
        value: "0.6 x 0.4 mm at the §2.2 centres, 0.02 mm thick",
        reason: "Raytac dimensions the recommended solder pad layout and shows the module pads at the same places (§2.1 bottom view) but gives no separate module pad size or plating thickness.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD shield position",
        value: "centred in width, 0.4 mm from the pad-edge end",
        reason: "The 2D drawing dimensions the shield (9.7 x 11.1 mm) but not its offset; 0.4 mm is measured off the Ver. L §2.1 top view (the 2018 STEP places its smaller shield 0.45 mm from that edge). The STEP's 1.9 x 0.5 mm PCB slot is not modelled.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["manufacturer CAD"],
        note: "Raytac's design-guide archive (MDBT50Q & MDBT50Q-P & MDBT50Q-U Footprint_Design Guide 230606) contains 'MDBT50Q 3D Drawing_20180620.stp', an envelope solid without pads. No licence or terms are stated on the download page or in the archive, so it is not redistributed; it was used only to measure the PCB thickness, shield and antenna. Geometry generated from §2.1-2.2 and the 2D drawing (library/cad/py/catalog/raytac-mdbt50q-1mv2.py).",
        source: [SRC.designGuide, "https://www.raytac.com/document/index.php?index_m_id=12"],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from §2.1-2.2 and the 2D drawing (not manufacturer CAD).
// Module centred, pad plane z = 0, x along the 10.5 mm width, y along the
// 15.5 mm length with the antenna at +y (Raytac's top view seen from +z).
// ---------------------------------------------------------------------------

const PAD_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.24, centroid: [-4.65, 3.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.24, centroid: [-4.65, 2.65, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.24, centroid: [-4.65, 1.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.24, centroid: [-4.65, 0.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.24, centroid: [-3.75, -0.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.24, centroid: [-4.65, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.24, centroid: [-3.75, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.24, centroid: [-4.65, -1.35, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.24, centroid: [-3.75, -1.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.24, centroid: [-4.65, -2.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_11: feature("pin_11", { area_mm2: 0.24, centroid: [-3.75, -2.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_12: feature("pin_12", { area_mm2: 0.24, centroid: [-4.65, -2.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_13: feature("pin_13", { area_mm2: 0.24, centroid: [-3.75, -3.35, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_14: feature("pin_14", { area_mm2: 0.24, centroid: [-4.65, -3.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_15: feature("pin_15", { area_mm2: 0.24, centroid: [-4.8, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_16: feature("pin_16", { area_mm2: 0.24, centroid: [-4.0, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_17: feature("pin_17", { area_mm2: 0.24, centroid: [-3.2, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_18: feature("pin_18", { area_mm2: 0.24, centroid: [-2.4, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_19: feature("pin_19", { area_mm2: 0.24, centroid: [-2.0, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_20: feature("pin_20", { area_mm2: 0.24, centroid: [-1.6, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_21: feature("pin_21", { area_mm2: 0.24, centroid: [-1.2, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_22: feature("pin_22", { area_mm2: 0.24, centroid: [-0.8, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_23: feature("pin_23", { area_mm2: 0.24, centroid: [-0.4, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_24: feature("pin_24", { area_mm2: 0.24, centroid: [0.0, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_25: feature("pin_25", { area_mm2: 0.24, centroid: [0.4, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_26: feature("pin_26", { area_mm2: 0.24, centroid: [0.8, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_27: feature("pin_27", { area_mm2: 0.24, centroid: [1.2, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_28: feature("pin_28", { area_mm2: 0.24, centroid: [1.6, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_29: feature("pin_29", { area_mm2: 0.24, centroid: [2.0, -6.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_30: feature("pin_30", { area_mm2: 0.24, centroid: [2.4, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_31: feature("pin_31", { area_mm2: 0.24, centroid: [3.2, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_32: feature("pin_32", { area_mm2: 0.24, centroid: [4.0, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_33: feature("pin_33", { area_mm2: 0.24, centroid: [4.8, -7.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_34: feature("pin_34", { area_mm2: 0.24, centroid: [4.65, -6.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_35: feature("pin_35", { area_mm2: 0.24, centroid: [4.65, -5.35, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_36: feature("pin_36", { area_mm2: 0.24, centroid: [3.75, -4.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_37: feature("pin_37", { area_mm2: 0.24, centroid: [4.65, -4.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_38: feature("pin_38", { area_mm2: 0.24, centroid: [3.75, -4.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_39: feature("pin_39", { area_mm2: 0.24, centroid: [4.65, -3.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_40: feature("pin_40", { area_mm2: 0.24, centroid: [3.75, -3.35, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_41: feature("pin_41", { area_mm2: 0.24, centroid: [4.65, -2.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_42: feature("pin_42", { area_mm2: 0.24, centroid: [3.75, -2.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_43: feature("pin_43", { area_mm2: 0.24, centroid: [3.75, -1.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_44: feature("pin_44", { area_mm2: 0.24, centroid: [4.65, -1.35, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_45: feature("pin_45", { area_mm2: 0.24, centroid: [3.75, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_46: feature("pin_46", { area_mm2: 0.24, centroid: [4.65, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_47: feature("pin_47", { area_mm2: 0.24, centroid: [3.75, -0.15, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_48: feature("pin_48", { area_mm2: 0.24, centroid: [4.65, 0.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_49: feature("pin_49", { area_mm2: 0.24, centroid: [3.75, 0.65, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_50: feature("pin_50", { area_mm2: 0.24, centroid: [3.75, 1.45, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_51: feature("pin_51", { area_mm2: 0.24, centroid: [4.65, 1.85, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_52: feature("pin_52", { area_mm2: 0.24, centroid: [3.75, 2.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_53: feature("pin_53", { area_mm2: 0.24, centroid: [4.65, 2.65, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_54: feature("pin_54", { area_mm2: 0.24, centroid: [3.75, 3.05, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_55: feature("pin_55", { area_mm2: 0.24, centroid: [4.65, 3.75, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_56: feature("pin_56", { area_mm2: 0.24, centroid: [-2.0, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_57: feature("pin_57", { area_mm2: 0.24, centroid: [-1.2, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_58: feature("pin_58", { area_mm2: 0.24, centroid: [-0.4, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_59: feature("pin_59", { area_mm2: 0.24, centroid: [0.4, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_60: feature("pin_60", { area_mm2: 0.24, centroid: [1.2, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_61: feature("pin_61", { area_mm2: 0.24, centroid: [2.0, -0.55, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const RAYTAC_MDBT50Q_1MV2: ModuleDef = withGeometry(
  RAYTAC_MDBT50Q_1MV2_BASE,
  {
    ...Object.fromEntries(Object.entries(PAD_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    usb: { refs: [PAD_FEATURES.pin_35, PAD_FEATURES.pin_34, PAD_FEATURES.pin_32, PAD_FEATURES.pin_33] },
    swd: { refs: [PAD_FEATURES.pin_51, PAD_FEATURES.pin_53, PAD_FEATURES.pin_55, PAD_FEATURES.pin_40] },
    ble_radio: { refs: [feature("antenna", { area_mm2: 8.0, centroid: [0.368, 6.633, 2.05], normal: [0.0, 0.0, 1.0] })] },
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 162.75, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/raytac-mdbt50q-1mv2/artifacts/cad",
    name: "raytac-mdbt50q-1mv2",
    generator: "library/cad/py/catalog/raytac-mdbt50q-1mv2.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

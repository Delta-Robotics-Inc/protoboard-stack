/**
 * Espressif ESP32-C3-MINI-1-H4X Wi-Fi + Bluetooth LE module (ESP32-C3FH4X,
 * chip revision v1.1, 4 MB in-package flash, PCB antenna, 105 °C version) —
 * datasheet-honest UHD part.
 *
 * Sources (see ./espressif-esp32-c3-mini-1-h4x/sources.json):
 *   - src_datasheet: ESP32-C3-MINI-1 & MINI-1U Datasheet v2.2 —
 *     https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf
 *     (Table 1-1 variants, §3 pin layout and Table 3-1, §4 boot, §5 peripherals,
 *     §6 electrical, §7 RF, §8-9 schematics, §10.1 dimensions, §11.1 land
 *     pattern, §12 handling)
 *   - src_chip_datasheet: ESP32-C3 Series Datasheet v2.4 —
 *     https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf
 *     (Table 2-1 pin overview, §2.3.4 peripheral pin assignment, §4.1.3.1 GPIO matrix)
 *   - src_product: Espressif modules page — https://www.espressif.com/en/products/modules/esp32-c3
 *   - src_sleep_modes: ESP-IDF v5.3.5 ESP32-C3 Sleep Modes —
 *     https://docs.espressif.com/projects/esp-idf/en/v5.3.5/esp32c3/api-reference/system/sleep_modes.html
 *   - src_hw_guidelines: ESP Hardware Design Guidelines, ESP32-C3 PCB layout —
 *     https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/pcb-layout-design.html
 *   - src_errata, src_errata_adc183: ESP32-C3 Series SoC Errata, Errata Summary (Table 4) and ADC-183 —
 *     https://docs.espressif.com/projects/esp-chip-errata/en/latest/esp32c3/02-errata-summary/index.html
 *   - src_cad: Espressif STEP (measurement only, not redistributed) —
 *     https://www.espressif.com/sites/default/files/3dmodel/ESP32-C3-MINI-1_20210903_0.STEP
 *
 * Modelling notes:
 *   - Variant: H4X = 4 MB Quad SPI flash, -40 to 105 °C, ESP32-C3FH4X v1.1,
 *     "Recommended" (Table 1-1). The -N4X (85 °C) has the same size and pin
 *     table; the NRND -N4/-H4/-H4-AZ carry chip v0.4. A different variant is a
 *     different part.
 *   - Pin-honest: all 53 pins are leaves `pin_1`..`pin_53` with the Table 3-1
 *     names and verbatim functions, including the 14 NC pins (type `nc`) and
 *     the 22 GND pins. Pin 49 is the centre ground pad (EPAD in the module
 *     schematic, Figure 8-1): it is the package's exposed pad and keeps
 *     Espressif's number.
 *   - Supply: 3V3 (pin 3) is a 3.0-3.6 V input. It carries current_draw 0.5 A,
 *     the supply capability Table 6-2 requires (IVDD >= 0.5 A), so a supply
 *     budget sizes the 3V3 source for RF peaks (assumption trait); the mode
 *     currents are in the `performance` trait and power-domain metadata.
 *   - GPIO: 15 pads. Every one carries the bus capability tags (i2c, spi, uart,
 *     pwm, interrupt) because the GPIO matrix routes peripheral signals to any
 *     IO (chip §4.1.3.1). Analog inputs only on GPIO0-5 (ADC1_CH0-4, ADC2_CH0);
 *     RTC IO GPIO0-5 carry `deep_sleep_wakeup`. Strapping pins GPIO2/8/9 carry
 *     usage notes.
 *   - Composites only where the pins are fixed: `uart0` (U0RXD GPIO20 pin 30,
 *     U0TXD GPIO21 pin 31: download and log port), `usb` (USB Serial/JTAG on
 *     GPIO18 D- pin 26 / GPIO19 D+ pin 27; only those pins, chip Table 2-7),
 *     and `jtag` (MTMS/MTDI/MTCK/MTDO on GPIO4-7). No I2C, SPI2, UART1 or PWM
 *     composite: their pins are chosen in firmware, and a fixed default
 *     profile would invent a pinout (.research/gaps.json, vocabulary). The
 *     board that uses the module states the assignment.
 *   - `wifi` and `bluetooth` (network domain) are bound to the antenna-area
 *     feature; the base-board keep-out is a usage note (a board requirement).
 *   - Package: Espressif names no package type; the mechanical domain states
 *     53 numbered pins at 0.8 mm pitch with pin 49 as the exposed pad,
 *     13.2 x 16.6 x 2.4 mm. No mass is published (data_gap).
 *   - Geometry is generated (library/cad/py/catalog/espressif-esp32-c3-mini-1-h4x.py):
 *     Espressif's STEP states no licence, so it was used only to measure the
 *     pad centres (data_gap). Each pin leaf binds its own pad feature;
 *     `pcb_mount` binds the module underside. Pad thickness and the antenna
 *     face are assumption traits; the shield position follows the drawing over
 *     the STEP (source_discrepancy).
 */
import type { InterfaceDef, ModuleDef, ProtocolDef, TraitDef } from "@deltarobotics/uhd";
import { UART, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import type { PinRow } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf",
  chip: "https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf",
  product: "https://www.espressif.com/en/products/modules/esp32-c3",
  sleep: "https://docs.espressif.com/projects/esp-idf/en/v5.3.5/esp32c3/api-reference/system/sleep_modes.html",
  hwGuide: "https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/pcb-layout-design.html",
  cad: "https://www.espressif.com/sites/default/files/3dmodel/ESP32-C3-MINI-1_20210903_0.STEP",
  errata: "https://docs.espressif.com/projects/esp-chip-errata/en/latest/esp32c3/02-errata-summary/index.html",
  errataAdc2: "https://docs.espressif.com/projects/esp-chip-errata/en/latest/esp32c3/03-errata-description/shared/sar-adc-adc2-not-work.html",
} as const;

const PIN_TABLE = `${SRC.datasheet} (Table 3-1 Pin Definitions)`;

/** VDD33 recommended range (Table 6-2); the GPIO are powered from it. */
const VDD33: [number, number] = [3.0, 3.6];

const MATRIX_CAPS = ["i2c_sda", "i2c_scl", "spi_mosi", "spi_miso", "spi_sck", "spi_ss", "uart_tx", "uart_rx", "uart_rts", "uart_cts", "pwm_out", "interrupt"];
const PWM_OUT: ProtocolDef = { type: "pwm", roles: ["output"] };
const INT_IN: ProtocolDef = { type: "interrupt", roles: ["input"] };
const ANALOG_IN: ProtocolDef = { type: "analog", roles: ["input"] };

const note = (text: string, source: string | string[]): TraitDef => ({ type: "usage_note", params: { note: text, source } });

const strap = (gpio: number, text: string): TraitDef =>
  note(`GPIO${gpio} is a strapping pin, latched at chip reset (hold time >= 3 ms after CHIP_EN rises). ${text}`, `${SRC.datasheet} (§4, Tables 4-1 to 4-4)`);

const RTC_NOTE = note(
  "RTC IO (powered by VDD3P3_RTC): can wake the chip from Deep-sleep (esp_deep_sleep_enable_gpio_wakeup) and can hold its level in Deep-sleep. GPIO6-21 are high impedance in Deep-sleep and wake it only from Light-sleep.",
  [`${SRC.chip} (Table 2-1)`, `${SRC.sleep} (GPIO Wakeup; Power-down Options)`],
);

interface GpioOptions {
  /** ADC channel name, e.g. "adc1_ch0". */
  adc?: string;
  /** Powered by VDD3P3_RTC (GPIO0-5). */
  rtc?: boolean;
  extra?: string[];
  protocols?: ProtocolDef[];
  traits?: TraitDef[];
}

/** A GPIO pad: any GPIO-matrix peripheral can be routed to it (chip §4.1.3.1). */
function gpio(pin: number, name: string, n: number, description: string, o: GpioOptions = {}): PinRow {
  return {
    pin,
    name,
    type: "io",
    description,
    capabilities: [
      ...MATRIX_CAPS,
      `gpio${n}`,
      ...(o.adc ? ["analog_in", o.adc] : []),
      ...(o.rtc ? ["rtc_gpio", "deep_sleep_wakeup"] : []),
      ...(o.extra ?? []),
    ],
    protocols: [PWM_OUT, INT_IN, ...(o.adc ? [ANALOG_IN] : []), ...(o.protocols ?? [])],
    traits: [...(o.rtc ? [RTC_NOTE] : []), ...(o.traits ?? [])],
  };
}

const gnd = (pin: number): PinRow => ({ pin, name: "GND", type: "ground", description: "Ground" });
const nc = (pin: number): PinRow => ({ pin, name: "NC", type: "nc", description: "NC" });

const USB_NOTE = note(
  "USB Serial/JTAG (USB 2.0 full speed, 12 Mbit/s) is only available on GPIO18/GPIO19; USB_D- and USB_D+ can be swapped in a register (USB_SERIAL_JTAG_EXCHG_PINS). The USB function is enabled by default, with the USB pull-up on GPIO19; disabled, the pins are plain GPIO with their pulls off.",
  [`${SRC.chip} (Table 2-1 notes 5, Table 2-7 note 1)`, `${SRC.datasheet} (§5.2.1.5)`],
);

const tablePins = pinTable(
  [
    gnd(1),
    gnd(2),
    {
      pin: 3,
      name: "3V3",
      type: "power_in",
      voltageV: VDD33,
      nominalV: 3.3,
      description: "Power supply",
      traits: [
        note(
          "VDD33 3.0-3.6 V (typ 3.3 V); the external supply must deliver at least 0.5 A. Absolute maximum 3.6 V. Figure 9-1 places 10 uF and 0.1 uF on VDD33; R1/C3 (values left to be determined in the figure) form the EN RC delay. The module has an ESD diode on VDD33. The rails must be stable at least 50 us before EN rises.",
          [`${SRC.datasheet} (Tables 6-1, 6-2, 4-6; Figures 8-1, 9-1)`],
        ),
      ],
    },
    nc(4),
    gpio(5, "IO2", 2, "GPIO2, ADC1_CH2, FSPIQ", {
      adc: "adc1_ch2",
      rtc: true,
      extra: ["strapping", "fspiq"],
      traits: [strap(2, "It does not select SPI or download boot, but a pull-up is recommended because of glitches (floating by default).")],
    }),
    gpio(6, "IO3", 3, "GPIO3, ADC1_CH3", { adc: "adc1_ch3", rtc: true }),
    nc(7),
    {
      pin: 8,
      name: "EN",
      type: "input",
      description: "High: on, enables the chip. Low: off, the chip powers off. Note: Do not leave the EN pin floating.",
      capabilities: ["chip_en", "reset"],
      traits: [
        note(
          "CHIP_EN has no pull-up inside the module. Espressif recommends an RC delay at EN, usually R = 10 kOhm and C = 1 uF, adjusted to the supply's power-up timing. Hold EN below VIL_nRST (0.25 x VDD) for at least 50 us to reset; it releases above VIH_nRST (0.75 x VDD). EN low: power off, 1 uA.",
          [`${SRC.datasheet} (§9 notes, Tables 4-6, 6-3, 6-7; Figure 8-1)`],
        ),
      ],
    },
    nc(9),
    nc(10),
    gnd(11),
    gpio(12, "IO0", 0, "GPIO0, ADC1_CH0, XTAL_32K_P", { adc: "adc1_ch0", rtc: true, extra: ["xtal_32k_p"] }),
    gpio(13, "IO1", 1, "GPIO1, ADC1_CH1, XTAL_32K_N", { adc: "adc1_ch1", rtc: true, extra: ["xtal_32k_n"] }),
    gnd(14),
    nc(15),
    gpio(16, "IO10", 10, "GPIO10, FSPICS0", { extra: ["fspics0"] }),
    nc(17),
    gpio(18, "IO4", 4, "GPIO4, ADC1_CH4, FSPIHD, MTMS", { adc: "adc1_ch4", rtc: true, extra: ["fspihd", "jtag_tms"] }),
    gpio(19, "IO5", 5, "GPIO5, ADC2_CH0, FSPIWP, MTDI", {
      adc: "adc2_ch0",
      rtc: true,
      extra: ["fspiwp", "jtag_tdi"],
      traits: [
        note(
          "ADC2 has one channel and is not factory-calibrated. Errata ADC-183 (affects v0.0-v1.1, so this v1.1 module): the DMA digital controller of SAR ADC2 cannot work; Espressif suggests SAR ADC1. Use GPIO0-4 (ADC1) for continuous/DMA sampling.",
          [`${SRC.datasheet} (§5.2.2.1)`, `${SRC.errata} (Table 4, ADC-183)`, SRC.errataAdc2],
        ),
      ],
    }),
    gpio(20, "IO6", 6, "GPIO6, FSPICLK, MTCK", { extra: ["fspiclk", "jtag_tck"] }),
    gpio(21, "IO7", 7, "GPIO7, FSPID, MTDO", { extra: ["fspid", "jtag_tdo"] }),
    gpio(22, "IO8", 8, "GPIO8", {
      extra: ["strapping"],
      traits: [strap(8, "Floating by default. Joint download boot needs GPIO8 = 1 (with GPIO9 = 0); with EFUSE_UART_PRINT_CONTROL it also gates ROM messages on UART0.")],
    }),
    gpio(23, "IO9", 9, "GPIO9", {
      extra: ["strapping", "boot"],
      traits: [strap(9, "Weak internal pull-up (1 = SPI boot). Pull it low at reset for joint download boot (UART0 or USB Serial/JTAG).")],
    }),
    nc(24),
    nc(25),
    gpio(26, "IO18", 18, "GPIO18, USB_D-", { extra: ["usb_dm"], protocols: [{ type: "usb", roles: ["bidirectional"] }], traits: [USB_NOTE] }),
    gpio(27, "IO19", 19, "GPIO19, USB_D+", { extra: ["usb_dp"], protocols: [{ type: "usb", roles: ["bidirectional"] }], traits: [USB_NOTE] }),
    nc(28),
    nc(29),
    gpio(30, "RXD0", 20, "GPIO20, U0RXD", { extra: ["u0rxd"], protocols: [{ type: "uart", roles: ["receiver"] }] }),
    gpio(31, "TXD0", 21, "GPIO21, U0TXD", {
      extra: ["u0txd"],
      protocols: [{ type: "uart", roles: ["transmitter"] }],
      traits: [note("The module puts a 499 Ohm resistor in series with U0TXD (module schematic R2).", `${SRC.datasheet} (Figure 8-1)`)],
    }),
    nc(32),
    nc(33),
    nc(34),
    nc(35),
    ...[36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48].map(gnd),
    {
      pin: 49,
      name: "GND (EPAD)",
      type: "ground",
      description: "Ground",
      traits: [
        note(
          "Centre ground pad (EPAD in the module schematic), 3 x 3 squares of 1.45 mm, 5.4 mm overall. Soldering it to base-board ground is not a must, but improves thermal performance; too much paste can lift the module and weaken the other joints.",
          [`${SRC.datasheet} (Figures 3-1, 8-1, 10-1; §9 notes)`],
        ),
      ],
    },
    ...[50, 51, 52, 53].map(gnd),
  ],
  { source: PIN_TABLE, logicV: VDD33 },
).map((p) => (p.id === "pin_3" ? { ...p, parameters: [...(p.parameters ?? []), currentDrawA(0.5)] } : p));

const pins: InterfaceDef[] = tablePins;
const GND_PINS = [1, 2, 11, 14, ...Array.from({ length: 18 }, (_, i) => 36 + i)].map((n) => `pin_${n}`);

// ---------------------------------------------------------------------------
// Fixed-function composites
// ---------------------------------------------------------------------------

const uart0: InterfaceDef = {
  ...UART({ id: "uart0", name: "UART0 (U0RXD GPIO20 pin 30 / U0TXD GPIO21 pin 31)", tx: "pin_31", rx: "pin_30", defaultActive: true })[0],
  capabilities: ["uart0", "download_port"],
  traits: [
    note(
      "UART0 is the firmware download and log port (joint download boot, ROM messages). UART controllers run up to 5 Mbps with hardware (RTS/CTS) and software flow control; UART0's signals can also be moved to other GPIO through the GPIO matrix, but download boot uses these pins.",
      [`${SRC.datasheet} (§4.1-4.2, §5.2.1.1, §9 notes)`, `${SRC.chip} (Table 2-7 note 2)`],
    ),
  ],
};

const usb: InterfaceDef = {
  id: "usb",
  name: "USB Serial/JTAG (USB 2.0 full speed device)",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "usb", roles: ["device"] }],
  capabilities: ["usb_2_0", "usb_full_speed", "usb_serial_jtag", "usb_cdc_acm"],
  slots: [
    { id: "dp", required: true, match: { protocol: "usb", capability: "usb_dp" } },
    { id: "dm", required: true, match: { protocol: "usb", capability: "usb_dm" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "usb_pins", label: "D+ 27 (GPIO19), D- 26 (GPIO18), GND 1", default_active: true, bindings: { dp: "pin_27", dm: "pin_26", gnd: "pin_1" } }],
  parameters: [{ id: "max_frequency", name: "Bit rate", unit: "Hz", value: 12_000_000 }],
  traits: [
    note(
      "CDC-ACM virtual serial port and JTAG adapter with an integrated full-speed PHY: flashes the in-package flash and debugs the CPU over USB with no bridge chip. The module has no VBUS pin; the controller runs from 3V3. Joint download boot works over USB Serial/JTAG as well as UART0.",
      [`${SRC.datasheet} (§5.2.1.5, Table 4-3 note 3)`],
    ),
  ],
};

const jtag: InterfaceDef = {
  id: "jtag",
  name: "JTAG (MTMS GPIO4, MTDI GPIO5, MTCK GPIO6, MTDO GPIO7)",
  domain: "electrical",
  exposed: true,
  default_active: false,
  protocols: [{ type: "jtag", roles: ["target"] }],
  slots: [
    { id: "tms", required: true, match: { protocol: "digital", capability: "jtag_tms" } },
    { id: "tdi", required: true, match: { protocol: "digital", capability: "jtag_tdi" } },
    { id: "tck", required: true, match: { protocol: "digital", capability: "jtag_tck" } },
    { id: "tdo", required: true, match: { protocol: "digital", capability: "jtag_tdo" } },
  ],
  profiles: [{ id: "jtag_pins", label: "MTMS 18, MTDI 19, MTCK 20, MTDO 21", default_active: true, bindings: { tms: "pin_18", tdi: "pin_19", tck: "pin_20", tdo: "pin_21" } }],
  max_instances: 1,
  traits: [note("Pad JTAG on GPIO4-7 (Table 3-1). The same pins are FSPIHD/FSPIWP/FSPICLK/FSPID and GPIO; USB Serial/JTAG gives JTAG without them.", [PIN_TABLE, `${SRC.chip} (§2.3.4)`])],
};

const RADIO_SRC = [`${SRC.datasheet} (§1.1, §7, Tables 6-4, 6-5)`, SRC.product];

const wifi: InterfaceDef = {
  id: "wifi",
  name: "Wi-Fi 802.11 b/g/n (2.4 GHz), PCB antenna",
  domain: "network",
  exposed: true,
  default_active: true,
  protocols: [{ type: "wifi", roles: ["client", "access_point"] }],
  capabilities: ["wifi_802_11_bgn", "wifi_2g4", "pcb_antenna"],
  parameters: [{ id: "tx_power", name: "TX power (802.11b, 1 Mbps)", unit: "dBm", value: 20.5 }],
  traits: [
    {
      type: "performance",
      params: {
        kind: "radio",
        standard: "IEEE 802.11 b/g/n, 20/40 MHz, 1T1R up to 150 Mbps; Station, SoftAP, Station + SoftAP, promiscuous; 802.11mc FTM",
        channels_MHz: [2412, 2484],
        tx_power_dBm: { "802.11b_1M": 20.5, "802.11g_54M": 18.0, "802.11n_HT20_MCS7": 17.5, "802.11n_HT40_MCS7": 17.0 },
        rx_sensitivity_dBm: { "802.11b_1M": -98.0 },
        current_mA: { tx_802_11b_20dBm: 350, tx_802_11g_54M: 295, tx_802_11n_MCS7: 290, rx_HT20: 82, rx_HT40: 84, note: "peak, 3.3 V, 25 °C, TX at 100 % duty" },
        source: RADIO_SRC,
      },
    },
    note(
      "PCB antenna at the module's short end. Place the module at the base-board edge with the antenna feed point close to the edge; overhang the antenna or cut the base board away under it, keep copper out of the antenna keep-out zone, and do not centre the module in a hollowed-out board. Keep at least 15 mm of clearance around the antenna inside the housing, and test throughput and range in the end product.",
      [`${SRC.datasheet} (Figure 3-1 note A, Figure 11-1)`, `${SRC.hwGuide} (General Principles of PCB Layout for Modules)`],
    ),
  ],
};

const bluetooth: InterfaceDef = {
  id: "bluetooth",
  name: "Bluetooth 5 LE, PCB antenna",
  domain: "network",
  exposed: true,
  default_active: true,
  protocols: [{ type: "bluetooth", roles: ["peer"] }],
  capabilities: ["bluetooth_le", "bluetooth_5", "bluetooth_mesh", "bluetooth_long_range", "pcb_antenna"],
  parameters: [{ id: "tx_power", name: "TX power", unit: "dBm", range: [-24, 20] }],
  traits: [
    {
      type: "performance",
      params: {
        kind: "radio",
        modes: ["125 kbps", "500 kbps", "1 Mbps", "2 Mbps"],
        channels_MHz: [2402, 2480],
        tx_power_dBm: [-24, 20],
        rx_sensitivity_dBm: { "1M": -96, "2M": -93, "125k": -104, "500k": -99 },
        current_mA: { tx_20dBm: 340, tx_9dBm: 190, tx_0dBm: 170, tx_minus15dBm: 100, rx: 86, note: "peak, 3.3 V, 25 °C" },
        coexistence: "internal Wi-Fi / Bluetooth co-existence sharing the same antenna",
        source: [...RADIO_SRC, `${SRC.datasheet} (Tables 7-7, 7-12 to 7-15)`],
      },
    },
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "53 bottom pads (SMD module)",
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
        note: "53 pads on the module underside: 48 of 0.4 x 0.8 mm at 0.8 mm pitch, 4 corner pads 0.7 x 0.7 mm, and the 5.4 mm centre pad (pin 49). Module 13.2 x 16.6 x 2.4 mm (+-0.15). MSL 3; single reflow, peak 235-250 °C for 30-70 s, SAC305. Avoid ultrasonic cleaning or welding (crystal resonance).",
        source: [`${SRC.datasheet} (Figures 10-1, 11-1; §12.1, §12.3, §12.4)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ESPRESSIF_ESP32_C3_MINI_1_H4X_BASE: ModuleDef = defineModule({
  id: "espressif-esp32-c3-mini-1-h4x",
  name: "Espressif ESP32-C3-MINI-1-H4X module (PCB antenna, 4 MB flash)",
  version: "1.0.0",
  manufacturer: "Espressif Systems",
  part_number: "ESP32-C3-MINI-1-H4X",
  description:
    "Certified 2.4 GHz Wi-Fi (802.11 b/g/n) and Bluetooth 5 LE module on the ESP32-C3FH4X (32-bit RISC-V single core up to 160 MHz, 400 KB SRAM, chip revision v1.1) with 4 MB in-package Quad SPI flash, 40 MHz crystal and PCB antenna. 53 pins: 15 GPIO (ADC on GPIO0-5, UART0, USB Serial/JTAG on GPIO18/19, JTAG), EN, 3V3. Supply 3.0-3.6 V, at least 0.5 A. -40 to 105 °C. 13.2 x 16.6 x 2.4 mm.",
  tags: ["esp32", "esp32-c3", "espressif", "risc-v", "wifi", "ble", "bluetooth-le", "module", "pcb-antenna", "mcu", "usb"],
  categories: ["microcontroller.module", "microcontroller.esp32", "connectivity.wireless"],
  interfaces: [...pins, uart0, usb, jtag, wifi, bluetooth, pcbMount],
  interfaceGroups: [{ id: "ground_pads", label: "Ground pads 1, 2, 11, 14, 36-53", members: GND_PINS, policy: "all_of" }],
  artifacts: [
    { id: "datasheet", name: "ESP32-C3-MINI-1 & MINI-1U Datasheet v2.2", type: "datasheet", url: SRC.datasheet },
    { id: "soc_datasheet", name: "ESP32-C3 Series Datasheet v2.4", type: "datasheet", url: SRC.chip },
    { id: "product", name: "Espressif ESP32-C3 modules page", type: "documentation", url: SRC.product },
    { id: "sleep_modes", name: "ESP-IDF ESP32-C3 Sleep Modes (v5.3.5)", type: "documentation", url: SRC.sleep },
    { id: "hw_guidelines", name: "ESP32-C3 Hardware Design Guidelines, PCB layout", type: "documentation", url: SRC.hwGuide },
  ],
  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "vdd33", name: "3V3 (VDD33)", nominal_voltage_V: 3.3, voltage_range_V: VDD33 }],
      metadata: {
        soc: "ESP32-C3FH4X, chip revision v1.1 (4 MB flash in package)",
        cpu: "32-bit RISC-V single core, up to 160 MHz",
        memory: { rom_KB: 384, sram_KB: 400, rtc_sram_KB: 8, flash_MB: 4, flash: "Quad SPI, 80 MHz max by default, 100,000 P/E cycles, 20 years" },
        peripherals: ["2 x UART (5 Mbps)", "SPI2 (master 80 MHz / slave 60 MHz)", "I2C (up to 800 kbit/s)", "I2S", "USB Serial/JTAG", "TWAI (CAN 2.0)", "LED PWM (6 channels)", "RMT (2 TX + 2 RX)", "2 x 12-bit SAR ADC (ADC1 5 ch, ADC2 1 ch)", "temperature sensor", "timers, watchdogs"],
        gpio_electrical: {
          vih: "0.75 x VDD to VDD + 0.3", vil: "-0.3 to 0.25 x VDD", voh_min: "0.8 x VDD", vol_max: "0.1 x VDD",
          ioh_mA_typ: 40, iol_mA_typ: 28, pull_kOhm_typ: 45, pin_capacitance_pF: 2,
          default_drive_mA: { "GPIO2, GPIO3, GPIO4, GPIO5": 10, "GPIO18, GPIO19": 40, others: 20 },
        },
        currents_typ: {
          modem_sleep_160MHz_mA: { cpu_running: 23, cpu_idle: 16, all_clocks_running: 28 },
          modem_sleep_80MHz_mA: { cpu_running: 17, cpu_idle: 13, all_clocks_running: 22 },
          light_sleep_uA: 130,
          deep_sleep_rtc_timer_memory_uA: 5,
          power_off_en_low_uA: 1,
        },
        internal: "40 MHz crystal, RF matching and PCB antenna, ESD diode on VDD33, 499 Ohm on U0TXD",
        source: [`${SRC.datasheet} (§1.1, §5.2, Tables 6-3, 6-6 to 6-8, Figure 8-1)`, `${SRC.chip} (Table 2-1 note 4)`],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 16.6, width: 13.2, height: 2.4 },
      package: {
        name: "ESP32-C3-MINI-1 module, 53 pins",
        pin_count: 53,
        pitch_mm: 0.8,
        exposed_pad: true,
        exposed_pad_pin: 49,
        exposed_pad_mm: [5.4, 5.4],
        source: `${SRC.datasheet} (§3.2 "The module has 53 pins"; Table 3-1; Figures 8-1, 10-1, 11-1)`,
        assumption:
          "Espressif names no package type; the name states the module series and its pin count. Espressif numbers the centre pad 49 within pins 1-53, so pin_count counts it and exposed_pad_pin points at it.",
      },
      metadata: {
        tolerance_mm: 0.15,
        pcb_thickness_mm: 0.8,
        shield_mm: { length: 9.95, width: 11.95, edge_offset: 0.62, top_mm: 2.4 },
        antenna_area_mm: "the 5.4 mm of PCB beyond 11.2 mm from the pad-end edge",
        pads: "48 x 0.4 x 0.8 mm at 0.8 mm pitch; 4 corner pads 0.7 x 0.7 mm; centre pad 9 x 1.45 mm squares, 5.4 mm overall, pin-1 corner chamfered 0.6 mm",
        msl: 3,
        source: `${SRC.datasheet} (Figures 10-1, 11-1; §12.1)`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 105],
      metadata: { version: "105 °C version (H4X)", storage: "sealed moisture barrier bag: < 40 °C, 90 %RH", source: `${SRC.datasheet} (Table 1-1, Table 6-2, §12.1)` },
    },
    {
      domain: "network",
      metadata: {
        wifi: "IEEE 802.11 b/g/n, 2412-2484 MHz, up to 20.5 dBm",
        bluetooth: "Bluetooth 5 LE and mesh, 2402-2480 MHz, -24 to 20 dBm",
        antenna: "on-board PCB antenna",
        certification: "RF certification: see Espressif certificates; RoHS/REACH",
        source: `${SRC.datasheet} (§1.1, §7)`,
      },
    },
  ],
  traits: [
    {
      type: "operating_conditions",
      params: {
        vdd33_V: { min: 3.0, typ: 3.3, max: 3.6 },
        supply_current_min_A: 0.5,
        ambient_C: [-40, 105],
        power_up: "VDD33 stable >= 50 us before CHIP_EN rises (tSTBL)",
        source: `${SRC.datasheet} (Table 6-2, Table 4-6)`,
      },
    },
    {
      type: "absolute_maximum",
      params: { vdd33_V: [-0.3, 3.6], esd: "HBM +-2000 V, CDM +-500 V", msl: 3, source: `${SRC.datasheet} (Table 6-1, §12.1-12.2)` },
    },
    note(
      "Boot: GPIO9 high at reset (default, weak pull-up) boots from flash; GPIO9 low with GPIO8 high enters joint download boot over UART0 or USB Serial/JTAG. A pull-up on GPIO2 is recommended. Strapping values are latched at reset; the pins are ordinary GPIO afterwards.",
      `${SRC.datasheet} (§4.1, Tables 4-1, 4-3)`,
    ),
    note(
      "Peripheral pins are assigned in firmware through the GPIO matrix: I2C, SPI2, UART1, LED PWM, RMT, I2S and TWAI signals can use any GPIO. Espressif ranks GPIO2/8/9 (strapping), GPIO18/19 (USB), GPIO4-7 (JTAG) and GPIO20/21 (UART0) as usable with caution. Only GPIO0-5 have analog inputs and can wake from Deep-sleep.",
      [`${SRC.chip} (§2.3.4, §4.1.3.1, Table 2-1)`, `${SRC.sleep} (GPIO Wakeup)`],
    ),
    {
      type: "source_discrepancy",
      params: {
        field: "shield offset from the pad-end edge",
        values: ["0.62 mm (datasheet v2.2 Figure 10-1 top view)", "0.93 mm (STEP ESP32-C3-MINI-1_20210903_0)"],
        sources: [SRC.datasheet, SRC.cad],
        resolution: "The dimensioned datasheet drawing is used for the generated shield; the STEP agrees with it on the shield size (11.95 x 9.95 mm) and its 0.62 mm offset from the right edge.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "3V3 current_draw",
        value: "0.5 A on pin 3",
        reason: "The datasheet gives no single typical draw: it requires the external supply to deliver at least 0.5 A (Table 6-2), above the 350 mA Wi-Fi TX peak (Table 6-4). The requirement is used so a supply budget sizes the 3V3 source for RF bursts; average draw depends on the duty cycle (performance traits, power-domain metadata).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "GPIO voltage parameter",
        value: "3.0-3.6 V on every logic pad and EN",
        reason: "The GPIO are powered from VDD33 (chip Table 2-1) and their levels are fractions of it (Table 6-3); the parameter states the VDD33 range so a 3.3 V rail checks against it.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD pads and antenna",
        value: "pads at the STEP's centres and the drawing's sizes, 0.02 mm thick on the seating plane; antenna = top face of the antenna area",
        reason: "The drawing dimensions pad sizes, pitch and field extents but not each pad centre or the plating thickness (the STEP uses 0.035 mm); the PCB antenna trace is not dimensioned, so its area of the PCB stands for it. The shield's Ø0.5 marking and the parts under the shield are not modelled.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["manufacturer CAD"],
        note: "Espressif links ESP32-C3-MINI-1_20210903_0.STEP from datasheet §11.1 and the modules page. No licence is stated, and the datasheet's notice grants no licence ('All rights reserved'), so it is not redistributed; it was used only to measure the pad centres and shield. Geometry generated from Figures 10-1 and 11-1 (library/cad/py/catalog/espressif-esp32-c3-mini-1-h4x.py).",
        source: [SRC.cad, SRC.product, `${SRC.datasheet} (§11.1, Disclaimer and Copyright Notice)`],
      },
    },
    { type: "data_gap", params: { fields: ["mass"], note: "No mass in the datasheet or on the modules page." } },
    {
      type: "data_gap",
      params: {
        fields: ["ADC2 oneshot reads on chip revision v1.1"],
        note: "Errata ADC-183 lists v1.1 as affected: the DMA (digital) controller of SAR ADC2 cannot work. The errata says nothing about ADC2 oneshot reads, so whether GPIO5's ADC2_CH0 works in oneshot mode on v1.1 is not established; do not rely on it.",
        source: [`${SRC.datasheet} (§5.2.2.1)`, `${SRC.errata} (Table 4, ADC-183)`, SRC.errataAdc2],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from Figures 10-1 and 11-1 with pad centres measured in
// the STEP (not manufacturer CAD). Module centred, pad plane z = 0, x along the
// 13.2 mm width, y along the 16.6 mm length with the antenna at +y
// (Espressif's top view seen from +z; pin 1 at the upper left).
// ---------------------------------------------------------------------------

const PAD_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.32, centroid: [-5.9, 1.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.32, centroid: [-5.9, 0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.32, centroid: [-5.9, -0.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.32, centroid: [-5.9, -1.1, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.32, centroid: [-5.9, -1.9, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.32, centroid: [-5.9, -2.7, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_7: feature("pin_7", { area_mm2: 0.32, centroid: [-5.9, -3.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_8: feature("pin_8", { area_mm2: 0.32, centroid: [-5.9, -4.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_9: feature("pin_9", { area_mm2: 0.32, centroid: [-5.9, -5.1, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_10: feature("pin_10", { area_mm2: 0.32, centroid: [-5.9, -5.9, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_11: feature("pin_11", { area_mm2: 0.32, centroid: [-5.9, -6.7, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_12: feature("pin_12", { area_mm2: 0.32, centroid: [-4.8, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_13: feature("pin_13", { area_mm2: 0.32, centroid: [-4.0, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_14: feature("pin_14", { area_mm2: 0.32, centroid: [-3.2, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_15: feature("pin_15", { area_mm2: 0.32, centroid: [-2.4, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_16: feature("pin_16", { area_mm2: 0.32, centroid: [-1.6, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_17: feature("pin_17", { area_mm2: 0.32, centroid: [-0.8, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_18: feature("pin_18", { area_mm2: 0.32, centroid: [0.0, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_19: feature("pin_19", { area_mm2: 0.32, centroid: [0.8, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_20: feature("pin_20", { area_mm2: 0.32, centroid: [1.6, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_21: feature("pin_21", { area_mm2: 0.32, centroid: [2.4, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_22: feature("pin_22", { area_mm2: 0.32, centroid: [3.2, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_23: feature("pin_23", { area_mm2: 0.32, centroid: [4.0, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_24: feature("pin_24", { area_mm2: 0.32, centroid: [4.8, -7.6, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_25: feature("pin_25", { area_mm2: 0.32, centroid: [5.9, -6.7, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_26: feature("pin_26", { area_mm2: 0.32, centroid: [5.9, -5.9, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_27: feature("pin_27", { area_mm2: 0.32, centroid: [5.9, -5.1, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_28: feature("pin_28", { area_mm2: 0.32, centroid: [5.9, -4.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_29: feature("pin_29", { area_mm2: 0.32, centroid: [5.9, -3.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_30: feature("pin_30", { area_mm2: 0.32, centroid: [5.9, -2.7, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_31: feature("pin_31", { area_mm2: 0.32, centroid: [5.9, -1.9, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_32: feature("pin_32", { area_mm2: 0.32, centroid: [5.9, -1.1, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_33: feature("pin_33", { area_mm2: 0.32, centroid: [5.9, -0.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_34: feature("pin_34", { area_mm2: 0.32, centroid: [5.9, 0.5, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_35: feature("pin_35", { area_mm2: 0.32, centroid: [5.9, 1.3, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_36: feature("pin_36", { area_mm2: 0.32, centroid: [4.8, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_37: feature("pin_37", { area_mm2: 0.32, centroid: [4.0, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_38: feature("pin_38", { area_mm2: 0.32, centroid: [3.2, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_39: feature("pin_39", { area_mm2: 0.32, centroid: [2.4, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_40: feature("pin_40", { area_mm2: 0.32, centroid: [1.6, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_41: feature("pin_41", { area_mm2: 0.32, centroid: [0.8, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_42: feature("pin_42", { area_mm2: 0.32, centroid: [0.0, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_43: feature("pin_43", { area_mm2: 0.32, centroid: [-0.8, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_44: feature("pin_44", { area_mm2: 0.32, centroid: [-1.6, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_45: feature("pin_45", { area_mm2: 0.32, centroid: [-2.4, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_46: feature("pin_46", { area_mm2: 0.32, centroid: [-3.2, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_47: feature("pin_47", { area_mm2: 0.32, centroid: [-4.0, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_48: feature("pin_48", { area_mm2: 0.32, centroid: [-4.8, 2.2, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_49: feature("pin_49", { area_mm2: 18.742, centroid: [0.024, -2.724, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_50: feature("pin_50", { area_mm2: 0.49, centroid: [5.95, 2.25, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_51: feature("pin_51", { area_mm2: 0.49, centroid: [5.95, -7.65, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_52: feature("pin_52", { area_mm2: 0.49, centroid: [-5.95, -7.65, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_53: feature("pin_53", { area_mm2: 0.49, centroid: [-5.95, 2.25, 0.0], normal: [0.0, 0.0, -1.0] }),
};

// the PCB antenna: top face of the antenna area
const ANTENNA = feature("antenna", { area_mm2: 71.28, centroid: [0.0, 5.6, 0.8], normal: [0.0, 0.0, 1.0] });

export const ESPRESSIF_ESP32_C3_MINI_1_H4X: ModuleDef = withGeometry(
  ESPRESSIF_ESP32_C3_MINI_1_H4X_BASE,
  {
    ...Object.fromEntries(Object.entries(PAD_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    uart0: { refs: [PAD_FEATURES.pin_30, PAD_FEATURES.pin_31] },
    usb: { refs: [PAD_FEATURES.pin_27, PAD_FEATURES.pin_26, PAD_FEATURES.pin_1] },
    jtag: { refs: [PAD_FEATURES.pin_18, PAD_FEATURES.pin_19, PAD_FEATURES.pin_20, PAD_FEATURES.pin_21] },
    wifi: { refs: [ANTENNA] },
    bluetooth: { refs: [ANTENNA] },
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 219.12, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/espressif-esp32-c3-mini-1-h4x/artifacts/cad",
    name: "espressif-esp32-c3-mini-1-h4x",
    generator: "library/cad/py/catalog/espressif-esp32-c3-mini-1-h4x.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount", "antenna"],
  }),
);

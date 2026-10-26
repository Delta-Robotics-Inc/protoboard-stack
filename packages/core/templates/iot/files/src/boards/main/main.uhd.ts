/**
 * Main board (from the iot template, derived from the smart-bottle reference
 * project's src/boards/bottle-cap): the core of a battery-powered Wi-Fi/BLE
 * device as a UHD board module. Components are children (catalog parts),
 * nets are `Net` interfaces with membership links, and the board's edge
 * (what the cell and a USB cable touch) is its exports. Nothing here names a
 * PCB tool: land patterns, placement and routing are the circuit provider's
 * (circuit.config.ts next to this file, @protoboardai/ext-tscircuit), and the
 * ESP-IDF pin header and sdkconfig are the firmware provider's
 * (firmware.config.ts, @protoboardai/ext-esp-idf).
 *
 * The starting circuit: the ESP32-C3-MINI-1-H4X on a TPS63020 buck-boost
 * (3.28 V from the cell), the MCP73831 charging the cell from USB-C (with
 * ESD protection on the data lines, the C3's USB Serial/JTAG), pads for the
 * cell and bring-up test pads (BOOT, EN, GND). Add sensors and outputs as the
 * bottle does (its cap board is the worked example, every value cited).
 *
 * Sources (the parts' own, as cited in the smart-bottle project):
 *   - Espressif ESP32-C3-MINI-1 datasheet: pinout, EN RC delay (10 kOhm, 1 uF),
 *     GPIO9 BOOT strap pulled up, 10 uF + 0.1 uF on 3V3
 *   - TI TPS63020 SLVS916: feedback divider VOUT = 0.5 V x (1 + R1/R2), PS/SYNC
 *     low for power save, input and output capacitors
 *   - Microchip MCP73831 DS20001984H: RPROG sets IREG = 1000 V / RPROG; STAT
 *     drives to VDD at charge complete
 *   - USB Type-C Specification Release 2.1 Table 4-24: a sink presents
 *     Rd 5.1 kOhm on each CC pin; ST USBLC6-2SC6 DS4260 flow-through
 */
import { Net, defineModule, netLinks, type ChildModuleRef, type ModuleDef } from "@deltarobotics/uhd";

const R = (id: string, ohms: number, name: string): ChildModuleRef => ({ id, moduleDefId: "yageo-rc0402", name, overrides: { resistance: ohms } });

/** Murata MPNs named per placement (the GRM series forms no MPN from the parameters). */
const CAP = {
  // the series parts' defaults: GRM155R71C104KA88D, 0.1 uF 16 V X7R 0402
  n100: { def: "murata-grm155" },
  // GRM155R61A105KE15D: 1 uF 10 V X5R 0402, MPN formed with Murata's numbering (assumption trait below)
  u1: { def: "murata-grm155", overrides: { capacitance: 1e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.1, part_number: "GRM155R61A105KE15D" } },
  // GRM188R61A106ME69D: 10 uF 10 V X5R 0603 (cited on murata-grm188)
  u10: { def: "murata-grm188", overrides: { capacitance: 10e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61A106ME69D" } },
  // GRM188R61E106MA73D: 10 uF 25 V X5R 0603 (cited on murata-grm188), for VBUS
  u10v25: { def: "murata-grm188", overrides: { capacitance: 10e-6, rated_voltage: 25, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61E106MA73D" } },
  // GRM188R61A226ME15D: 22 uF 10 V X5R 0603, MPN formed with Murata's numbering (assumption trait below)
  u22: { def: "murata-grm188", overrides: { capacitance: 22e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61A226ME15D" } },
} as const;

const C = (id: string, kind: keyof typeof CAP, name: string): ChildModuleRef => {
  const c = CAP[kind];
  return { id, moduleDefId: c.def, name, ...("overrides" in c ? { overrides: { ...c.overrides } } : {}) };
};

const GND = [
  // ESP32-C3-MINI-1: GND pins 1, 2, 11, 14, 36-53 (49 is the centre pad)
  ...[1, 2, 11, 14, ...Array.from({ length: 18 }, (_, i) => 36 + i)].map((n) => `u1:pin_${n}`),
  "u4:pin_2", "u4:pgnd", "u4:pin_13", // PS/SYNC low: power save
  "u5:pin_6", "u5:pin_9",
  "j1:pin_a1", "j1:pin_a12", "j1:pin_b1", "j1:pin_b12", "j1:shell", "j1:ground_tags",
  "d9:pin_2",
  "jbat:pad_neg", "tp_gnd:pad",
  "r12:pin_2", "r15:pin_2", "r19:pin_2", "r20:pin_2",
  ...["c1", "c2", "c3", "c8", "c9", "c10", "c11", "c12", "c13", "c14"].map((c) => `${c}:pin_2`),
];

export const MAIN_BOARD: ModuleDef = defineModule({
  id: "main-board",
  name: "Main board",
  version: "0.1.0",
  description:
    "Main board of a battery-powered Wi-Fi/BLE device: ESP32-C3-MINI-1-H4X, TPS63020 3V3 buck-boost from the cell, MCP73831 charger and IP67 USB-C (USB Serial/JTAG through a USBLC6), pads for the LiPo leads.",
  categories: ["microcontroller.module"],
  tags: ["pcb", "custom-board", "iot", "esp32-c3"],
  interfaces: [
    Net({ id: "vbus", name: "VBUS", voltageV: 5 }),
    Net({ id: "vbat", name: "VBAT", voltageV: [3.0, 4.2] }),
    // the TPS63020's output as its feedback divider sets it: 0.5 V x (1 + 1000/180) = 3.28 V
    Net({ id: "v3v3", name: "3V3", voltageV: 3.28 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "sw_l1", name: "SW_L1" }),
    Net({ id: "sw_l2", name: "SW_L2" }),
    Net({ id: "fb", name: "FB" }),
    Net({ id: "en", name: "EN" }),
    Net({ id: "boot", name: "BOOT (GPIO9)" }),
    Net({ id: "chg_stat_5v", name: "CHG_STAT (VDD level)" }),
    Net({ id: "chg_stat", name: "CHG_STAT" }),
    Net({ id: "chg_prog", name: "CHG_PROG" }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
    Net({ id: "usb_cc1", name: "USB_CC1" }),
    Net({ id: "usb_cc2", name: "USB_CC2" }),
  ],
  children: [
    { id: "u1", moduleDefId: "espressif-esp32-c3-mini-1-h4x", name: "Wi-Fi/BLE module" },
    { id: "u4", moduleDefId: "ti-tps63020dsjr", name: "3V3 buck-boost" },
    { id: "l1", moduleDefId: "coilcraft-xfl4020-152me", name: "Buck-boost inductor" },
    { id: "u5", moduleDefId: "microchip-mcp73831t-2aci-mc", name: "LiPo charger" },
    { id: "j1", moduleDefId: "gct-usb4720-03-a", name: "USB-C (IP67)" },
    { id: "d9", moduleDefId: "st-usblc6-2sc6", name: "USB ESD protection" },
    { id: "jbat", moduleDefId: "battery-pads", name: "Cell lead pads" },
    // bring-up pads: GPIO9 low at reset selects download mode; EN resets the module
    ...["boot", "en", "gnd"].map((s) => ({ id: `tp_${s}`, moduleDefId: "test-pad", name: `Test pad ${s.toUpperCase()}` })),
    // resistors
    R("r1", 10_000, "EN pull-up"),
    R("r2", 10_000, "GPIO9 BOOT pull-up"),
    R("r11", 1_000_000, "Feedback upper"),
    R("r12", 180_000, "Feedback lower"),
    R("r13", 3_300, "Charger PROG (303 mA)"),
    R("r14", 68_000, "STAT divider upper"),
    R("r15", 100_000, "STAT divider lower"),
    R("r19", 5_100, "CC1 Rd"),
    R("r20", 5_100, "CC2 Rd"),
    // capacitors
    C("c1", "u10", "3V3 bulk at the module"),
    C("c2", "n100", "3V3 bypass at the module"),
    C("c3", "u1", "EN delay"),
    C("c8", "u10", "Buck-boost VIN"),
    C("c9", "n100", "Buck-boost VINA"),
    C("c10", "u22", "Buck-boost VOUT 1"),
    C("c11", "u22", "Buck-boost VOUT 2"),
    C("c12", "u22", "Buck-boost VOUT 3"),
    C("c13", "u10v25", "Charger VDD (VBUS)"),
    C("c14", "u10", "Charger VBAT"),
  ],
  links: [
    // ---- power
    ...netLinks("vbus", ["j1:pin_a4", "j1:pin_a9", "j1:pin_b4", "j1:pin_b9", "d9:pin_5", "u5:pin_1", "u5:pin_2", "c13:pin_1"]),
    ...netLinks("vbat", [
      "jbat:pad_pos",
      "u4:pin_10", "u4:pin_11", "u4:pin_12", "c8:pin_1", "u4:pin_1", "c9:pin_1", // VIN, EN (always on), VINA with its 0.1 uF
      "u5:pin_3", "u5:pin_4", "c14:pin_1",
    ]),
    ...netLinks("sw_l1", ["u4:pin_8", "u4:pin_9", "l1:pin_1"]),
    ...netLinks("sw_l2", ["u4:pin_6", "u4:pin_7", "l1:pin_2"]),
    ...netLinks("fb", ["u4:pin_3", "r11:pin_2", "r12:pin_1"]),
    ...netLinks("v3v3", ["u4:pin_4", "u4:pin_5", "r11:pin_1", "c10:pin_1", "c11:pin_1", "c12:pin_1", "u1:pin_3", "c1:pin_1", "c2:pin_1", "r1:pin_1", "r2:pin_1"]),
    ...netLinks("gnd", GND),
    // ---- module control
    ...netLinks("en", ["u1:pin_8", "r1:pin_2", "c3:pin_1", "tp_en:pad"]),
    ...netLinks("boot", ["u1:pin_23", "r2:pin_2", "tp_boot:pad"]),
    // ---- charger: PROG, and STAT divided from VBUS level to the 3V3 I/O on GPIO7
    ...netLinks("chg_stat_5v", ["u5:pin_5", "r14:pin_1"]),
    ...netLinks("chg_stat", ["u1:pin_21", "r14:pin_2", "r15:pin_1"]),
    ...netLinks("chg_prog", ["u5:pin_8", "r13:pin_1"]),
    // ---- USB: CC Rd to GND, data through the ESD array (flow-through) to GPIO19 D+ / GPIO18 D-
    ...netLinks("usb_cc1", ["j1:pin_a5", "r19:pin_1"]),
    ...netLinks("usb_cc2", ["j1:pin_b5", "r20:pin_1"]),
    ...netLinks("usb_dp", ["j1:pin_a6", "j1:pin_b6", "d9:pin_1", "d9:pin_6", "u1:pin_27"]),
    ...netLinks("usb_dm", ["j1:pin_a7", "j1:pin_b7", "d9:pin_3", "d9:pin_4", "u1:pin_26"]),
  ],
  // the board's edge: what the case and the harnesses reach
  exports: [
    { id: "usb", name: "USB-C receptacle", from: { child: "j1", interfaceId: "usb_c" } },
    { id: "bat_pos", name: "BAT+ pad", from: { child: "jbat", interfaceId: "pad_pos" } },
    { id: "bat_neg", name: "BAT- pad", from: { child: "jbat", interfaceId: "pad_neg" } },
    { id: "wifi", name: "Wi-Fi", from: { child: "u1", interfaceId: "wifi" } },
    { id: "bluetooth", name: "Bluetooth LE", from: { child: "u1", interfaceId: "bluetooth" } },
  ],
  traits: [
    {
      type: "assumption",
      params: {
        field: "capacitor MPNs GRM155R61A105KE15D (1 uF) and GRM188R61A226ME15D (22 uF)",
        value: "1 uF 10 V X5R 0402 and 22 uF 10 V X5R 0603",
        reason: "Formed with Murata's part-numbering rule stated on murata-grm155/188 (the catalog cites other values' reference sheets). Confirm them at ordering.",
      },
    },
  ],
});

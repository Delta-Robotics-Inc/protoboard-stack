/**
 * Wearable watch main board (PB-828): the components of docs/system.md as a
 * UHD board module. Components are children, nets are `Net` interfaces with
 * membership links, and the board's edge (what the display, the cell, the
 * LRA, the case and a programmer touch) is its exports. Nothing here names a
 * PCB tool: land patterns, placement and routing are the circuit provider's
 * (circuit.config.ts and tscircuit/ next to this file).
 *
 * Stack (case frame, OQ-W5 resolved): display / cell / board. The board sits
 * nearest the back cover with every component on its top copper, facing the
 * back cover and the wrist (the MAX30102 looks through the back window). Its
 * rear face (bottom copper) carries the display (DS1), soldered by its FPC
 * contacts to a land there, and the cell lead pads; the cell lies between the
 * board and the display, the FPC dropping past it.
 *
 * Every value comes from a cited datasheet (the parts' own sources) or is an
 * `assumption`:
 *   [W1]  Raytac MDBT50Q-1MV2 approval sheet Ver. L, §2.5 pin table, §8.3
 *         reference circuit (normal voltage mode, one 10 uF on VDD/VDDH)
 *   [W2]  Nordic nRF52840 PS v1.11 (4413_417): §5.3.1 (normal voltage mode,
 *         VDD and VDDH tied), §5.4.2.4 + Figure 25 (LFXO load: C1 = C2 =
 *         2 CL - Cpcb - Cpin), §5.4.4.3 (CL 12.5 pF max, Cpin 4 pF), §6.35
 *         (USBD: 4.7 uF on VBUS in the reference circuitry)
 *   [W5]  Bosch BMI270 BST-BMI270-DS000-08: SDO to GND for 0x68, CSB to VDDIO
 *         for I2C, 100 nF on VDD and VDDIO (§7.2)
 *   [W6]  ADI MAX30102 19-7740: application circuit (1.8 V rail 4.7 uF +
 *         0.1 uF, VLED+ bypass), INT open drain with a pull-up
 *   [W7]  TI DRV2605L SLOS854D: 1 uF on VDD and on REG, IN/TRIG to GND when
 *         unused, EN with 2 Mohm pull-down
 *   [W9]  ADI MAX17048 19-6171: VDD on the cell with 0.1 uF, CTG and QSTRT to
 *         GND, ALRT open drain with a pull-up (Figure 14, Table 3)
 *   [W10] Microchip MCP73831 DS20001984H: 4.7 uF on VDD and VBAT, RPROG
 *         sets IREG = 1000 V / RPROG
 *   [W11] TI TPS7A02 SBVS277C: 1 uF in, 1-22 uF out, EN to IN
 *   [W13] GCT USB4105 drawing; USB Type-C Cable and Connector Specification
 *         Release 2.1, §4.5.1.3.2 and Table 4-24: a sink presents Rd 5.1 kOhm
 *         on each CC pin
 *   [W14] ST USBLC6-2SC6 DS4260: 100 nF on VBUS (Figure 17)
 *   [W3]  EastRising ER-TFT1.28-1 §4.4: backlight Vf 2.9-3.1 V at 30 mA,
 *         40 mA max
 */
import { Net, defineModule, netLinks, type ChildModuleRef, type InterfaceDef, type ModuleDef } from "@deltarobotics/uhd";

// ---------------------------------------------------------------------------
// Series passives (catalog: yageo-rc0402, murata-grm155, murata-grm188), set
// per placement with ChildModuleRef.overrides; the C0G load capacitors are a
// project-researched part (parts/local/murata-grm1555c1h200ja01).
// ---------------------------------------------------------------------------

const r = (id: string, name: string, ohms: number): ChildModuleRef => ({ id, name, moduleDefId: "yageo-rc0402", overrides: { resistance: ohms } });
/** 100 nF 16 V X7R 0402: the series' default instance (GRM155R71C104KA88D). */
const c100n = (id: string, name: string): ChildModuleRef => ({ id, name, moduleDefId: "murata-grm155" });
/** 1 uF 10 V X5R 0402. */
const c1u = (id: string, name: string): ChildModuleRef => ({
  id,
  name,
  moduleDefId: "murata-grm155",
  overrides: { capacitance: 1e-6, tolerance: 0.1, rated_voltage: 10, dielectric: "X5R", part_number: "GRM155R61A105KE15D" },
});
/** 4.7 uF 6.3 V X5R 0402, for the 1.8 V rail only. */
const c4u7lv = (id: string, name: string): ChildModuleRef => ({
  id,
  name,
  moduleDefId: "murata-grm155",
  overrides: { capacitance: 4.7e-6, tolerance: 0.2, rated_voltage: 6.3, dielectric: "X5R", part_number: "GRM155R60J475ME47D" },
});
/** 4.7 uF 10 V X5R 0603, for VBUS and VBAT. */
const c4u7 = (id: string, name: string): ChildModuleRef => ({
  id,
  name,
  moduleDefId: "murata-grm188",
  overrides: { capacitance: 4.7e-6, tolerance: 0.1, rated_voltage: 10, dielectric: "X5R", part_number: "GRM188R61A475KE15D" },
});
/** 10 uF 10 V X5R 0603. */
const c10u = (id: string, name: string): ChildModuleRef => ({
  id,
  name,
  moduleDefId: "murata-grm188",
  overrides: { capacitance: 10e-6, tolerance: 0.1, rated_voltage: 10, dielectric: "X5R", part_number: "GRM188R61A106KE69D" },
});

/** A site on the board a land is placed at (a component's placement, as the circuit layout has it). */
function site(id: string, name: string, origin: [number, number, number], normal: [number, number, number], xAxis: [number, number, number]): InterfaceDef {
  return {
    id,
    name,
    domain: "mechanical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "custom", roles: ["peer"] }],
    capabilities: ["board_site"],
    geometry: { frame: { origin, normal, xAxis } },
    traits: [{ type: "usage_note", params: { note: "Copied from the circuit layout (src/boards/watch-main/out/pnp.csv, the land's centre and rotation); re-bind after the layout moves it." } }],
  };
}

export const WATCH_MAIN_BOARD: ModuleDef = defineModule({
  id: "watch-main-board",
  name: "Watch main board",
  version: "0.1.0",
  description:
    "Round 41 mm, 0.8 mm, 4-layer main board of the wearable watch: Raytac MDBT50Q-1MV2 (nRF52840), BMI270 IMU, MAX30102 heart-rate sensor, DRV2605L haptic driver, MAX17048 fuel gauge, MCP73831 charger, TPS7A0230 (3V0) and TPS7A0218 (1V8) LDOs, USB-C with USBLC6 ESD protection, two side-push buttons, 32.768 kHz crystal, backlight switch, the round display soldered by its FPC to the rear face, and copper lands for the cell, the LRA and SWD.",
  categories: ["microcontroller.module"],
  tags: ["board", "pcb", "wearable", "nrf52840", "ble"],
  display: { icon: "cpu" },
  interfaces: [
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "vbus", name: "VBUS", voltageV: 5 }),
    // the cell between the firmware's 3.40 V cut-off and full charge (docs/power-budget.md, "Cut-off voltage")
    Net({ id: "vbat", name: "VBAT", voltageV: [3.4, 4.2] }),
    Net({ id: "v3v0", name: "3V0", voltageV: 3.0 }),
    Net({ id: "v1v8", name: "1V8", voltageV: 1.8 }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
    Net({ id: "cc1", name: "CC1" }),
    Net({ id: "cc2", name: "CC2" }),
    Net({ id: "prog", name: "PROG" }),
    Net({ id: "stat", name: "STAT" }),
    Net({ id: "chg_stat", name: "CHG_STAT" }),
    Net({ id: "sda", name: "SDA" }),
    Net({ id: "scl", name: "SCL" }),
    Net({ id: "imu_int1", name: "IMU_INT1" }),
    Net({ id: "imu_int2", name: "IMU_INT2" }),
    Net({ id: "hr_int", name: "HR_INT" }),
    Net({ id: "fg_alrt", name: "FG_ALRT" }),
    Net({ id: "hap_en", name: "HAP_EN" }),
    Net({ id: "hap_reg", name: "HAP_REG" }),
    Net({ id: "lra_p", name: "LRA+" }),
    Net({ id: "lra_n", name: "LRA-" }),
    Net({ id: "xl1", name: "XL1" }),
    Net({ id: "xl2", name: "XL2" }),
    Net({ id: "lcd_sck", name: "LCD_SCK" }),
    Net({ id: "lcd_mosi", name: "LCD_MOSI" }),
    Net({ id: "lcd_cs", name: "LCD_CS" }),
    Net({ id: "lcd_dc", name: "LCD_DC" }),
    Net({ id: "lcd_rst", name: "LCD_RST" }),
    Net({ id: "bl_pwm", name: "BL_PWM" }),
    Net({ id: "led_a", name: "LED_A" }),
    Net({ id: "led_k", name: "LED_K" }),
    Net({ id: "btn1", name: "BTN1" }),
    Net({ id: "btn2", name: "BTN2" }),
    Net({ id: "swdio", name: "SWDIO" }),
    Net({ id: "swdclk", name: "SWDCLK" }),
    Net({ id: "nreset", name: "nRESET" }),
    // where the lead lands sit (the circuit layout's placements, out/pnp.csv), so the lead harnesses
    // have frames to route to: J3 on the bottom copper, J4 on the top (board frame, z 0 mid-plane)
    site("site_j3", "Cell lead pads (J3, bottom)", [-5.9, 16.2, -0.4], [0, 0, -1], [1, 0, 0]),
    site("site_j4", "LRA lead pads (J4, top)", [10, 9, 0.4], [0, 0, 1], [-1, 0, 0]),
  ],
  children: [
    { id: "u1", moduleDefId: "raytac-mdbt50q-1mv2", name: "BLE module (nRF52840)" },
    { id: "u2", moduleDefId: "bosch-bmi270", name: "IMU" },
    { id: "u3", moduleDefId: "adi-max30102efd", name: "Heart-rate sensor" },
    { id: "u4", moduleDefId: "ti-drv2605ldgs", name: "Haptic driver" },
    { id: "u5", moduleDefId: "adi-max17048g-t10", name: "Fuel gauge" },
    { id: "u6", moduleDefId: "microchip-mcp73831t-2aci-ot", name: "Charger" },
    { id: "u7", moduleDefId: "ti-tps7a0230pdbv", name: "3V0 LDO" },
    { id: "u8", moduleDefId: "ti-tps7a0218pdbv", name: "1V8 LDO" },
    { id: "j1", moduleDefId: "gct-usb4105-gf-a", name: "USB-C receptacle" },
    { id: "d1", moduleDefId: "st-usblc6-2sc6", name: "USB ESD protection" },
    { id: "sw1", moduleDefId: "alps-skrtlae010", name: "Button 1 (wake / select)" },
    { id: "sw2", moduleDefId: "alps-skrtlae010", name: "Button 2 (back)" },
    { id: "y1", moduleDefId: "epson-fc-135-32k768-12p5", name: "32.768 kHz crystal" },
    { id: "q1", moduleDefId: "aos-ao3400a", name: "Backlight switch" },
    // the display, soldered to the board by its 12 FPC contacts (hot bar or iron, OQ-W1): it sits under the
    // board's rear face, its FPC dropping past the cell to the land pattern there
    { id: "ds1", moduleDefId: "eastrising-er-tft128-1", name: "Display" },
    { id: "j3", moduleDefId: "watch-cell-pads", name: "Cell lead pads" },
    { id: "j4", moduleDefId: "watch-lra-pads", name: "LRA lead pads" },
    { id: "j5", moduleDefId: "watch-swd-pads", name: "SWD test pads" },
    // U1 [W1] §8.3, [W2] §5.3.1 / USBD
    c10u("c1", "U1 VDD/VDDH bulk"),
    c100n("c2", "U1 VDD bypass"),
    c4u7("c3", "U1 VBUS"),
    // Y1 load capacitors [W2] Figure 25: 2 x 12.5 pF - 4 pF (Cpin) - 1 pF (Cpcb, assumption) = 20 pF
    { id: "c4", moduleDefId: "murata-grm1555c1h200ja01", name: "Y1 load XL1" },
    { id: "c5", moduleDefId: "murata-grm1555c1h200ja01", name: "Y1 load XL2" },
    // LDOs [W11]
    c1u("c6", "U7 input"),
    c1u("c7", "U7 output"),
    c1u("c8", "U8 input"),
    c4u7lv("c9", "U8 output / U3 VDD bulk"),
    // U3 [W6]
    c100n("c10", "U3 VDD bypass"),
    c4u7("c11", "U3 VLED+"),
    // U4 [W7]
    c1u("c12", "U4 VDD"),
    c1u("c13", "U4 REG"),
    // U5 [W9]
    c100n("c14", "U5 VDD"),
    // U6 [W10]
    c4u7("c15", "U6 VDD"),
    c4u7("c16", "U6 VBAT"),
    // U2 [W5]
    c100n("c17", "U2 VDD"),
    c100n("c18", "U2 VDDIO"),
    // D1 [W14]
    c100n("c19", "D1 VBUS"),
    // display VDD at the FPC land
    c1u("c20", "Display VDD"),
    // resistors
    r("r1", "CC1 Rd", 5100),
    r("r2", "CC2 Rd", 5100),
    r("r3", "U6 RPROG (83 mA)", 12_000),
    r("r4", "SDA pull-up", 4700),
    r("r5", "SCL pull-up", 4700),
    r("r6", "HR INT pull-up", 10_000),
    r("r7", "FG ALRT pull-up", 10_000),
    r("r8", "Q1 gate pull-down", 100_000),
    r("r9", "Backlight series", 33),
    // U6's STAT drives high to its VDD (VBUS, 5 V) at charge complete [W10] §3.3; halved for P0.08 (3V0 I/O)
    r("r10", "STAT divider (top)", 22_000),
    r("r11", "STAT divider (bottom)", 22_000),
  ],
  links: [
    ...netLinks("gnd", [
      "u1:pin_1", "u1:pin_2", "u1:pin_15", "u1:pin_33", "u1:pin_55",
      "u2:pin_6", "u2:pin_7", "u2:pin_1", // SDO to GND: I2C address 0x68 [W5]
      "u3:pin_4", "u3:pin_12",
      "u4:pin_8", "u4:pin_4", // IN/TRIG unused: GND [W7]
      "u5:pin_4", "u5:ep", "u5:pin_1", "u5:pin_6", // CTG and QSTRT to GND [W9]
      "u6:pin_2",
      "u7:pin_2",
      "u8:pin_2",
      "j1:pin_a1", "j1:pin_a12", "j1:pin_b1", "j1:pin_b12", "j1:shell",
      "d1:pin_2",
      "sw1:pin_2", "sw2:pin_2",
      "q1:pin_2",
      "ds1:pin_1", "ds1:pin_5", "ds1:pin_6", "ds1:pin_12",
      "j3:pin_2",
      "j5:pin_5",
      "c1:pin_2", "c2:pin_2", "c3:pin_2", "c4:pin_2", "c5:pin_2", "c6:pin_2", "c7:pin_2", "c8:pin_2", "c9:pin_2", "c10:pin_2",
      "c11:pin_2", "c12:pin_2", "c13:pin_2", "c14:pin_2", "c15:pin_2", "c16:pin_2", "c17:pin_2", "c18:pin_2", "c19:pin_2", "c20:pin_2",
      "r1:pin_2", "r2:pin_2", "r3:pin_2", "r8:pin_2", "r11:pin_2",
    ]),
    ...netLinks("vbus", ["j1:pin_a4", "j1:pin_a9", "j1:pin_b4", "j1:pin_b9", "d1:pin_5", "u6:pin_4", "u1:pin_32", "c3:pin_1", "c15:pin_1", "c19:pin_1"]),
    ...netLinks("vbat", [
      "j3:pin_1", "u6:pin_3", "u7:pin_1", "u7:pin_3", "u8:pin_1", "u8:pin_3", "u5:pin_3", "u4:pin_10", "u4:pin_6", "u3:pin_9", "u3:pin_10", "r9:pin_1",
      "u5:pin_2", // CELL: not connected inside the MAX17048, tied to the cell's + as Figure 14 shows [W9]
      "c6:pin_1", "c8:pin_1", "c11:pin_1", "c12:pin_1", "c14:pin_1", "c16:pin_1",
    ]),
    ...netLinks("v3v0", [
      "u7:pin_5", "u1:pin_28", "u1:pin_30", // normal voltage mode: VDD and VDDH on 3V0 [W2] §5.3.1
      "u2:pin_8", "u2:pin_5", "u2:pin_12", // CSB high: I2C [W5]
      "ds1:pin_4", "j5:pin_1",
      "r4:pin_1", "r5:pin_1", "r6:pin_1", "r7:pin_1",
      "c1:pin_1", "c2:pin_1", "c7:pin_1", "c17:pin_1", "c18:pin_1", "c20:pin_1",
    ]),
    ...netLinks("v1v8", ["u8:pin_5", "u3:pin_11", "c9:pin_1", "c10:pin_1"]),
    // USB 2.0: both orientations' contacts, through D1's pin pairs [W14]
    ...netLinks("usb_dp", ["j1:pin_a6", "j1:pin_b6", "d1:pin_1", "d1:pin_6", "u1:pin_35"]),
    ...netLinks("usb_dm", ["j1:pin_a7", "j1:pin_b7", "d1:pin_3", "d1:pin_4", "u1:pin_34"]),
    ...netLinks("cc1", ["j1:pin_a5", "r1:pin_1"]),
    ...netLinks("cc2", ["j1:pin_b5", "r2:pin_1"]),
    // charger
    ...netLinks("prog", ["u6:pin_5", "r3:pin_1"]),
    // STAT is tri-state, not open drain: low while charging, high (to VDD = VBUS) when done, high-Z in shutdown or
    // with no cell [W10] §3.3. R10/R11 halve it: 2.4-2.6 V at VBUS 4.75-5.25 V, above the nRF52840's VIH (0.7 x 3.0 V
    // = 2.1 V, GPIO electrical specification) and below its VDD + 0.3 V limit ([W2], absolute maximum ratings); low stays under 0.1 V. High-Z reads low through R11, so
    // firmware reads STAT only while USBD reports VBUS.
    ...netLinks("stat", ["u6:pin_1", "r10:pin_1"]),
    ...netLinks("chg_stat", ["r10:pin_2", "r11:pin_1", "u1:pin_24"]), // P0.08
    // I2C: U2, U3, U4, U5 on P0.24 / P0.25, 4.7 kOhm to 3V0
    ...netLinks("sda", ["u1:pin_48", "u2:pin_14", "u3:pin_3", "u4:pin_3", "u5:pin_8", "r4:pin_2"]),
    ...netLinks("scl", ["u1:pin_49", "u2:pin_13", "u3:pin_2", "u4:pin_2", "u5:pin_7", "r5:pin_2"]),
    ...netLinks("imu_int1", ["u2:pin_4", "u1:pin_46"]), // P0.22
    ...netLinks("imu_int2", ["u2:pin_9", "u1:pin_45"]), // P0.23
    ...netLinks("hr_int", ["u3:pin_13", "u1:pin_42", "r6:pin_2"]), // P0.19
    ...netLinks("fg_alrt", ["u5:pin_5", "u1:pin_22", "r7:pin_2"]), // P0.06
    // haptics
    ...netLinks("hap_en", ["u4:pin_5", "u1:pin_43"]), // P0.21
    ...netLinks("hap_reg", ["u4:pin_1", "c13:pin_1"]),
    ...netLinks("lra_p", ["u4:pin_7", "j4:pin_1"]),
    ...netLinks("lra_n", ["u4:pin_9", "j4:pin_2"]),
    // 32.768 kHz crystal on XL1 / XL2 (pads 17, 18)
    ...netLinks("xl1", ["u1:pin_17", "y1:pin_1", "c4:pin_1"]),
    ...netLinks("xl2", ["u1:pin_18", "y1:pin_2", "c5:pin_1"]),
    // display: SPI write-only (SPIM3) plus D/C and RESET, on full-drive pads [W1] §2.6
    ...netLinks("lcd_sck", ["u1:pin_37", "ds1:pin_9"]), // P0.13
    ...netLinks("lcd_mosi", ["u1:pin_36", "ds1:pin_10"]), // P0.14
    ...netLinks("lcd_cs", ["u1:pin_39", "ds1:pin_8"]), // P0.15
    ...netLinks("lcd_dc", ["u1:pin_38", "ds1:pin_7"]), // P0.16
    ...netLinks("lcd_rst", ["u1:pin_41", "ds1:pin_11"]), // P0.17
    // backlight: VBAT - R9 - LEDA, LEDK - Q1 drain; Q1 gate on P0.20 with a pull-down
    ...netLinks("bl_pwm", ["u1:pin_44", "q1:pin_1", "r8:pin_1"]),
    ...netLinks("led_a", ["r9:pin_2", "ds1:pin_3"]),
    ...netLinks("led_k", ["q1:pin_3", "ds1:pin_2"]),
    // buttons to GND, internal pull-ups; terminals 1 and 3 are joined inside the switch
    ...netLinks("btn1", ["sw1:pin_1", "sw1:pin_3", "u1:pin_50"]), // P1.02
    ...netLinks("btn2", ["sw2:pin_1", "sw2:pin_3", "u1:pin_56"]), // P1.04
    // SWD
    ...netLinks("swdio", ["u1:pin_51", "j5:pin_2"]),
    ...netLinks("swdclk", ["u1:pin_53", "j5:pin_3"]),
    ...netLinks("nreset", ["u1:pin_40", "j5:pin_4"]),
    // the lead lands on their sites
    { id: "j3_site", name: "J3 on the board", a: { child: "j3", interfaceId: "board_mount" }, b: { self: true, interfaceId: "site_j3" } },
    { id: "j4_site", name: "J4 on the board", a: { child: "j4", interfaceId: "board_mount" }, b: { self: true, interfaceId: "site_j4" } },
  ],
  // the board edge
  exports: [
    { id: "usb", name: "USB-C", from: { child: "j1", interfaceId: "usb_c" } },
    { id: "display_face", name: "Display viewing face", from: { child: "ds1", interfaceId: "display_face" } },
    { id: "bat_pos", name: "Cell + pad", from: { child: "j3", interfaceId: "pin_1" } },
    { id: "bat_neg", name: "Cell - pad", from: { child: "j3", interfaceId: "pin_2" } },
    { id: "lra_pos", name: "LRA + pad", from: { child: "j4", interfaceId: "pin_1" } },
    { id: "lra_neg", name: "LRA - pad", from: { child: "j4", interfaceId: "pin_2" } },
    { id: "swd", name: "SWD pads", from: { child: "j5", interfaceId: "swd" } },
    { id: "btn_1", name: "Button 1 stem", from: { child: "sw1", interfaceId: "actuator" } },
    { id: "btn_2", name: "Button 2 stem", from: { child: "sw2", interfaceId: "actuator" } },
    { id: "hr_sensor", name: "Heart-rate sensor apertures", from: { child: "u3", interfaceId: "sensor_window" } },
    { id: "radio", name: "BLE antenna", from: { child: "u1", interfaceId: "ble_radio" } },
  ],
  // no artifacts: the generated board (out/: body GLB and STEP, manifest, drawings, BOM, fabrication files) is the
  // circuit provider's, which declares them; core attaches each one on disk to this module (PB-1030)
  traits: [
    {
      type: "design_envelope",
      params: {
        max_mm: { length: 41, width: 41, height: 4.2 },
        reason: "Brief: round case at most 46 mm across and 13.5 mm thick. The board is the disc under the 35.6 x 37.8 mm display (tab and FPC fold to 20.5 mm from its centre) inside a cavity of about 42 mm; the tallest part, the USB-C receptacle (3.31 mm), plus the 0.8 mm board sets the height.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "Y1 load capacitance",
        value: "C4 = C5 = 20 pF C0G: 2 x CL (12.5 pF, Y1) - Cpin (4 pF) - Cpcb (1 pF)",
        reason: "Nordic gives the formula and Cpin (PS §5.4.2.4 Figure 25, §5.4.4.3); the 1 pF of board stray capacitance per pin is an estimate for short traces, to be trimmed against a measured frequency (open question OQ-W9).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "pull-up and series values",
        value: "I2C 4.7 kOhm, HR INT and FG ALRT 10 kOhm, Q1 gate 100 kOhm, backlight 33 Ohm",
        reason: "I2C: inside the DRV2605L's 660 Ohm-4.7 kOhm range at 400 kHz [W7]; interrupts: open-drain lines that idle high; backlight: (4.2 V - 2.9 V) / 33 Ohm = 39 mA at full charge, within the 40 mA maximum [W3], (3.4 V - 3.1 V) / 33 Ohm = 9 mA at the cut-off, so firmware PWM caps the average (power budget).",
      },
    },
  ],
});

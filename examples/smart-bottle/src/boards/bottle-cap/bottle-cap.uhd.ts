/**
 * The smart-bottle cap board (PB-833): an ESP32-C3-MINI-1 module with a
 * VL53L4CD time-of-flight sensor looking down through the cap floor, an
 * LP5024 driving eight APTF1616 RGB LEDs round the rim, a TPS63020
 * buck-boost making 3V3 from the cell, an MCP73831 charger and a MAX17048
 * fuel gauge on the cell, an IP67 USB-C receptacle (GCT USB4720) with ESD
 * protection, a side-push button, and solder pads for the cell leads and the
 * temperature probe's wires.
 *
 * The board is a UHD module: its components are children (each a catalog
 * part with a package fact and pin designators, or a project pad), its nets
 * are `Net` interfaces joined to leaf pins by links, and its edge is its
 * exports. It names no tool: the circuit provider (circuit.config.ts here)
 * owns land patterns, placement and routing.
 *
 * Values and pins, with their sources (component selection tags in
 * docs/component-selection.md; datasheet URLs on the parts):
 *   - Pin map and I2C addresses: docs/system.md (proposal adopted here,
 *     with the charger STAT change below). GPIO0-5 are the RTC pads that can
 *     wake the chip from Deep-sleep [B2]: button GPIO3, ToF interrupt GPIO1.
 *   - ESP32-C3-MINI-1: 3V3 decoupled with 10 uF + 0.1 uF; EN with a 10 kOhm
 *     pull-up and 1 uF to GND; GPIO9 (BOOT strap) pulled up 10 kOhm, a test
 *     pad pulls it low for download boot [B1] §4, Table 4-3; power-up note.
 *   - VL53L4CD: AVDDVCSEL and AVDD on 3V3 (2.6-3.5 V [B3] §4.2) with 10 uF
 *     and 0.1 uF; XSHUT pulled down 10 kOhm so the sensor stays in hardware
 *     standby until the host raises it; GPIO1 interrupt pulled up 10 kOhm
 *     [B3] §1.4. DNC (pin 8) left floating.
 *   - I2C: one bus at 400 kHz (MAX17048 limit [B11]), 4.7 kOhm pull-ups to
 *     3V3. LP5024 at 0x28 (ADDR0 = ADDR1 = GND) [B6] Table 7-2, VL53L4CD at
 *     0x29, MAX17048 at 0x36.
 *   - LP5024 on VBAT (2.7-5.5 V [B6]), 1 uF on VCC and 1 uF on VCAP; EN
 *     pulled down 100 kOhm (shutdown, 0.2 uA, until GPIO5 raises it); IREF
 *     14.7 kOhm: ISET = 105 x 0.7 V / 14.7 kOhm = 5.0 mA full scale per
 *     output, the top of the brief's 2-5 mA per channel [B6] §7.3.3.
 *     LED k (D1-D8) has its anode on VBAT and its red, green and blue
 *     cathodes on OUT3k, OUT3k+1, OUT3k+2 (pins 3k+1 .. 3k+3).
 *   - TPS63020 [B8] §8.2: VIN and EN on VBAT (always on, docs/system.md),
 *     PS/SYNC low (power save), VINA with 0.1 uF, 10 uF on VIN, 3 x 22 uF on
 *     VOUT, L1 XFL4020-152ME (1.5 uH, TI Table 2), feedback 1.0 MOhm /
 *     180 kOhm: VOUT = 0.5 V x (1 + 1000/180) = 3.28 V. PG left open.
 *   - MCP73831 (DFN) [B10]: VDD from VBUS with 10 uF (25 V), VBAT with 10 uF,
 *     RPROG 3.3 kOhm: IREG = 1000 V / 3.3 kOhm = 303 mA.
 *     STAT drives high to VDD (up to 5.5 V on USB), more than the
 *     ESP32-C3's I/O takes (VDD + 0.3 V at most), so it reaches GPIO7
 *     through a 68 kOhm / 100 kOhm divider: 5.5 V -> 3.27 V (at most the
 *     3.28 V rail), 4.75 V -> 2.83 V (above VIH = 0.75 x VDD = 2.46 V, [B1] DC
 *     characteristics). Change from docs/system.md, which read STAT directly: the
 *     tri-state "no battery" level now reads low (decisions D-B06).
 *   - MAX17048 [B11]: VDD and CELL on VBAT with 0.1 uF, CTG and QSTRT to GND,
 *     ALRT pulled up 10 kOhm to 3V3 (open drain).
 *   - USB-C (GCT USB4720) as a USB 2.0 sink: CC1 and CC2 each to GND through
 *     5.1 kOhm (Rd; USB Type-C specification, sink); D+ and D- through the
 *     USBLC6-2SC6 [B14] (flow-through: pins 1/6 D+, 3/4 D-; pin 5 on VBUS)
 *     to GPIO19/GPIO18 (USB Serial/JTAG [B1]). SBU1/SBU2 not connected.
 *     VBUS sensed on GPIO10 (a digital input; GPIO10 has no ADC on the C3)
 *     through 68 kOhm / 100 kOhm, the same divider as STAT: 4.75 V (USB
 *     minimum) -> 2.83 V, above VIH 2.46 V; 5.5 V -> 3.27 V (D-B17). The
 *     earlier 100k / 100k read 2.38 V at 4.75 V, below VIH (review finding).
 *   - Button SW1 to GND on GPIO3, 10 kOhm pull-up to 3V3.
 *   - DS18B20 probe DQ on GPIO4, 4.7 kOhm pull-up to 3V3 [B4, B5].
 *
 * Generic passives are the catalog's series parts placed per value through
 * `overrides` (yageo-rc0402, murata-grm155 0402, murata-grm188 0603).
 */
import { BoltPattern, Net, defineModule, netLinks, type ChildModuleRef, type InterfaceLink, type ModuleDef } from "@deltarobotics/uhd";

// ---------------------------------------------------------------------------
// Passive placements: one series part, the value per placement (ChildModuleRef.overrides)
// ---------------------------------------------------------------------------

const R = (id: string, ohms: number, name: string): ChildModuleRef => ({ id, moduleDefId: "yageo-rc0402", name, overrides: { resistance: ohms } });

/** Murata MPNs named per placement (the GRM series forms no MPN from the parameters). */
const CAP = {
  // the series parts' defaults: GRM155R71C104KA88D, 0.1 uF 16 V X7R 0402
  n100: { def: "murata-grm155" },
  // GRM155R61A105KE15D: 1 uF 10 V X5R 0402, MPN formed with Murata's numbering (part_number rule on the part); reference sheet not read (assumption trait below)
  u1: { def: "murata-grm155", overrides: { capacitance: 1e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.1, part_number: "GRM155R61A105KE15D" } },
  // GRM188R61A106ME69D: 10 uF 10 V X5R 0603 (cited on murata-grm188)
  u10: { def: "murata-grm188", overrides: { capacitance: 10e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61A106ME69D" } },
  // GRM188R61E106MA73D: 10 uF 25 V X5R 0603 (cited on murata-grm188), for VBUS
  u10v25: { def: "murata-grm188", overrides: { capacitance: 10e-6, rated_voltage: 25, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61E106MA73D" } },
  // GRM188R61A226ME15D: 22 uF 10 V X5R 0603, MPN formed with Murata's numbering; reference sheet not read (assumption trait below)
  u22: { def: "murata-grm188", overrides: { capacitance: 22e-6, rated_voltage: 10, dielectric: "X5R", tolerance: 0.2, part_number: "GRM188R61A226ME15D" } },
} as const;

const C = (id: string, kind: keyof typeof CAP, name: string): ChildModuleRef => {
  const c = CAP[kind];
  return { id, moduleDefId: c.def, name, ...("overrides" in c ? { overrides: { ...c.overrides } } : {}) };
};

// ---------------------------------------------------------------------------
// LEDs: D1-D8 round the rim, each on three consecutive LP5024 outputs
// ---------------------------------------------------------------------------

export const LED_COUNT = 8;
const LEDS = Array.from({ length: LED_COUNT }, (_, i) => i + 1);
const out = (k: number, c: number) => `u3:pin_${3 * (k - 1) + c + 1}`; // OUTn on pin n+1

const ledLinks: InterfaceLink[] = LEDS.flatMap((k) => [
  ...netLinks(`led${k}_r`, [`d${k}:pin_2`, out(k, 0)]),
  ...netLinks(`led${k}_g`, [`d${k}:pin_3`, out(k, 1)]),
  ...netLinks(`led${k}_b`, [`d${k}:pin_4`, out(k, 2)]),
]);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/** Board mounting holes: four M2 on a 54 mm circle at 45° (the cap's insert bosses). */
export const BOARD_HOLE_CIRCLE_MM = 54;
/** Board thickness: the USB4720 is a mid-mount part for a 0.6 ± 0.1 mm board (GCT drawing). */
export const BOARD_THICKNESS_MM = 0.6;

const GND = [
  // ESP32-C3-MINI-1: GND pins 1, 2, 11, 14, 36-53 (49 is the centre pad)
  ...[1, 2, 11, 14, ...Array.from({ length: 18 }, (_, i) => 36 + i)].map((n) => `u1:pin_${n}`),
  "u2:pin_2", "u2:pin_3", "u2:pin_4", "u2:pin_6", "u2:pin_12",
  "u3:pin_25", "u3:pin_26", "u3:pin_33", // ADDR0, ADDR1 low: 0x28
  "u4:pin_2", "u4:pgnd", "u4:pin_13", // PS/SYNC low: power save
  "u5:pin_6", "u5:pin_9",
  "u6:pin_1", "u6:pin_4", "u6:pin_6", "u6:ep", // CTG, GND, QSTRT, EP
  "j1:pin_a1", "j1:pin_a12", "j1:pin_b1", "j1:pin_b12", "j1:shell", "j1:ground_tags",
  "d9:pin_2",
  "sw1:pin_1", "sw1:pin_3",
  "jbat:pad_neg", "jprb:pad_gnd", "tp_gnd:pad",
  "r5:pin_2", "r9:pin_2", "r10:pin_2", "r12:pin_2", "r13:pin_2", "r15:pin_2", "r18:pin_2", "r19:pin_2", "r20:pin_2",
  ...["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c14", "c15"].map((c) => `${c}:pin_2`),
];

const BOARD: ModuleDef = defineModule({
  id: "bottle-cap-board",
  name: "Bottle cap board",
  version: "0.1.0",
  description:
    "Round four-layer board (Ø70 mm, 0.6 mm) in the bottle cap: ESP32-C3-MINI-1-H4X, VL53L4CD level sensor (underside, over the floor window), LP5024 with 8 RGB LEDs on the rim, TPS63020 3V3 buck-boost, MCP73831 charger, MAX17048 fuel gauge, IP67 USB-C, side-push button, pads for the LiPo leads and the DS18B20 probe.",
  categories: ["microcontroller.module"],
  tags: ["pcb", "custom-board", "smart-bottle", "esp32-c3"],
  // estimated mass (assumption trait below): the 61 parts state none, so the board states its own
  domains: [{ domain: "mechanical", weight_g: 9 }],
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
    Net({ id: "i2c_sda", name: "I2C_SDA" }),
    Net({ id: "i2c_scl", name: "I2C_SCL" }),
    Net({ id: "tof_xshut", name: "TOF_XSHUT" }),
    Net({ id: "tof_int", name: "TOF_INT" }),
    Net({ id: "btn", name: "BTN" }),
    Net({ id: "temp_dq", name: "TEMP_DQ" }),
    Net({ id: "led_en", name: "LED_EN" }),
    Net({ id: "led_iref", name: "LED_IREF" }),
    Net({ id: "led_vcap", name: "LED_VCAP" }),
    Net({ id: "fg_alrt", name: "FG_ALRT" }),
    Net({ id: "chg_stat_5v", name: "CHG_STAT (VDD level)" }),
    Net({ id: "chg_stat", name: "CHG_STAT" }),
    Net({ id: "chg_prog", name: "CHG_PROG" }),
    Net({ id: "boot", name: "BOOT (GPIO9)" }),
    Net({ id: "vbus_sense", name: "VBUS_SENSE" }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
    Net({ id: "usb_cc1", name: "USB_CC1" }),
    Net({ id: "usb_cc2", name: "USB_CC2" }),
    Net({ id: "u0_rxd", name: "U0RXD" }),
    Net({ id: "u0_txd", name: "U0TXD" }),
    ...LEDS.flatMap((k) => ["r", "g", "b"].map((c) => Net({ id: `led${k}_${c}`, name: `LED${k}_${c.toUpperCase()}` }))),
    // the four M2 holes the cap's insert bosses take: frame on the underside, normal out of it
    {
      ...BoltPattern({ id: "mount", name: "4 x M2 on Ø54", role: "component", shape: "circle", spacingMm: BOARD_HOLE_CIRCLE_MM, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2, note: "Ø2.2 mm holes at 45°, 135°, 225°, 315°" }),
      // the pattern's first hole is on the frame's X axis: X at 45° puts the holes where circuit.config.ts drills them
      geometry: { frame: { origin: [0, 0, -BOARD_THICKNESS_MM / 2], normal: [0, 0, -1], xAxis: [Math.SQRT1_2, Math.SQRT1_2, 0] } },
    },
  ],
  children: [
    { id: "u1", moduleDefId: "espressif-esp32-c3-mini-1-h4x", name: "Wi-Fi/BLE module" },
    { id: "u2", moduleDefId: "st-vl53l4cdv0dh-1", name: "Level sensor (ToF)" },
    { id: "u3", moduleDefId: "ti-lp5024rsm", name: "LED driver" },
    { id: "u4", moduleDefId: "ti-tps63020dsjr", name: "3V3 buck-boost" },
    { id: "l1", moduleDefId: "coilcraft-xfl4020-152me", name: "Buck-boost inductor" },
    { id: "u5", moduleDefId: "microchip-mcp73831t-2aci-mc", name: "LiPo charger" },
    { id: "u6", moduleDefId: "adi-max17048g-t10", name: "Fuel gauge" },
    { id: "j1", moduleDefId: "gct-usb4720-03-a", name: "USB-C (IP67)" },
    { id: "d9", moduleDefId: "st-usblc6-2sc6", name: "USB ESD protection" },
    { id: "sw1", moduleDefId: "alps-skrtlae010", name: "Button" },
    ...LEDS.map((k) => ({ id: `d${k}`, moduleDefId: "kingbright-aptf1616lseezgkqbkc", name: `RGB LED ${k}` })),
    { id: "jbat", moduleDefId: "bottle-battery-pads", name: "Cell lead pads" },
    { id: "jprb", moduleDefId: "bottle-probe-pads", name: "Probe wire pads" },
    ...["rxd", "txd", "boot", "en", "3v3", "gnd"].map((s) => ({ id: `tp_${s}`, moduleDefId: "bottle-test-pad", name: `Test pad ${s.toUpperCase()}` })),
    // resistors
    R("r1", 10_000, "EN pull-up"),
    R("r2", 10_000, "GPIO9 BOOT pull-up"),
    R("r3", 4_700, "I2C SDA pull-up"),
    R("r4", 4_700, "I2C SCL pull-up"),
    R("r5", 10_000, "ToF XSHUT pull-down"),
    R("r6", 10_000, "ToF interrupt pull-up"),
    R("r7", 4_700, "1-Wire DQ pull-up"),
    R("r8", 10_000, "Button pull-up"),
    R("r9", 100_000, "LED driver EN pull-down"),
    R("r10", 14_700, "LED driver IREF (5 mA full scale)"),
    R("r11", 1_000_000, "Feedback upper"),
    R("r12", 180_000, "Feedback lower"),
    R("r13", 3_300, "Charger PROG (303 mA)"),
    R("r14", 68_000, "STAT divider upper"),
    R("r15", 100_000, "STAT divider lower"),
    R("r16", 10_000, "Fuel gauge ALRT pull-up"),
    R("r17", 68_000, "VBUS sense upper"),
    R("r18", 100_000, "VBUS sense lower"),
    R("r19", 5_100, "CC1 Rd"),
    R("r20", 5_100, "CC2 Rd"),
    // capacitors
    C("c1", "u10", "3V3 bulk at the module"),
    C("c2", "n100", "3V3 bypass at the module"),
    C("c3", "u1", "EN delay"),
    C("c4", "u10", "ToF AVDDVCSEL"),
    C("c5", "n100", "ToF AVDD"),
    C("c6", "u1", "LED driver VCC"),
    C("c7", "u1", "LED driver VCAP"),
    C("c8", "u10", "Buck-boost VIN"),
    C("c9", "n100", "Buck-boost VINA"),
    C("c10", "u22", "Buck-boost VOUT 1"),
    C("c11", "u22", "Buck-boost VOUT 2"),
    C("c12", "u22", "Buck-boost VOUT 3"),
    C("c13", "u10v25", "Charger VDD (VBUS)"),
    C("c14", "u10", "Charger VBAT"),
    C("c15", "n100", "Fuel gauge VDD"),
  ],
  links: [
    // ---- power
    ...netLinks("vbus", ["j1:pin_a4", "j1:pin_a9", "j1:pin_b4", "j1:pin_b9", "d9:pin_5", "u5:pin_1", "u5:pin_2", "c13:pin_1", "r17:pin_1"]),
    ...netLinks("vbat", [
      "jbat:pad_pos",
      "u4:pin_10", "u4:pin_11", "u4:pin_12", "c8:pin_1", "u4:pin_1", "c9:pin_1", // VIN, EN (always on), VINA with its 0.1 uF
      "u5:pin_3", "u5:pin_4", "c14:pin_1",
      "u6:pin_2", "u6:pin_3", "c15:pin_1",
      "u3:pin_27", "c6:pin_1",
      ...LEDS.map((k) => `d${k}:pin_1`), // common anodes
    ]),
    ...netLinks("sw_l1", ["u4:pin_8", "u4:pin_9", "l1:pin_1"]),
    ...netLinks("sw_l2", ["u4:pin_6", "u4:pin_7", "l1:pin_2"]),
    ...netLinks("fb", ["u4:pin_3", "r11:pin_2", "r12:pin_1"]),
    ...netLinks("v3v3", [
      "u4:pin_4", "u4:pin_5", "r11:pin_1", "c10:pin_1", "c11:pin_1", "c12:pin_1",
      "u1:pin_3", "c1:pin_1", "c2:pin_1",
      "u2:pin_1", "u2:pin_11", "c4:pin_1", "c5:pin_1",
      "r1:pin_1", "r2:pin_1", "r3:pin_1", "r4:pin_1", "r6:pin_1", "r7:pin_1", "r8:pin_1", "r16:pin_1",
      "jprb:pad_vdd", "tp_3v3:pad",
    ]),
    ...netLinks("gnd", GND),
    // ---- module control
    ...netLinks("en", ["u1:pin_8", "r1:pin_2", "c3:pin_1", "tp_en:pad"]),
    ...netLinks("boot", ["u1:pin_23", "r2:pin_2", "tp_boot:pad"]),
    ...netLinks("u0_rxd", ["u1:pin_30", "tp_rxd:pad"]),
    ...netLinks("u0_txd", ["u1:pin_31", "tp_txd:pad"]),
    // ---- I2C: GPIO8 SDA, GPIO2 SCL (both strapping pins held high by the pull-ups, OQ-B12)
    ...netLinks("i2c_sda", ["u1:pin_22", "r3:pin_2", "u2:pin_9", "u3:pin_28", "u6:pin_8"]),
    ...netLinks("i2c_scl", ["u1:pin_5", "r4:pin_2", "u2:pin_10", "u3:pin_29", "u6:pin_7"]),
    // ---- ToF: XSHUT GPIO0, interrupt GPIO1
    ...netLinks("tof_xshut", ["u1:pin_12", "u2:pin_5", "r5:pin_1"]),
    ...netLinks("tof_int", ["u1:pin_13", "u2:pin_7", "r6:pin_2"]),
    // ---- button GPIO3, probe GPIO4, LED enable GPIO5, fuel gauge alert GPIO6, charger status GPIO7, VBUS sense GPIO10
    ...netLinks("btn", ["u1:pin_6", "sw1:pin_2", "r8:pin_2"]),
    ...netLinks("temp_dq", ["u1:pin_18", "jprb:pad_dq", "r7:pin_2"]),
    ...netLinks("led_en", ["u1:pin_19", "u3:pin_30", "r9:pin_1"]),
    ...netLinks("led_iref", ["u3:pin_31", "r10:pin_1"]),
    ...netLinks("led_vcap", ["u3:pin_32", "c7:pin_1"]),
    ...netLinks("fg_alrt", ["u1:pin_20", "u6:pin_5", "r16:pin_2"]),
    ...netLinks("chg_stat_5v", ["u5:pin_5", "r14:pin_1"]),
    ...netLinks("chg_stat", ["u1:pin_21", "r14:pin_2", "r15:pin_1"]),
    ...netLinks("chg_prog", ["u5:pin_8", "r13:pin_1"]),
    ...netLinks("vbus_sense", ["u1:pin_16", "r17:pin_2", "r18:pin_1"]),
    // ---- USB: CC Rd to GND, data through the ESD array (flow-through) to GPIO19 D+ / GPIO18 D-
    ...netLinks("usb_cc1", ["j1:pin_a5", "r19:pin_1"]),
    ...netLinks("usb_cc2", ["j1:pin_b5", "r20:pin_1"]),
    ...netLinks("usb_dp", ["j1:pin_a6", "j1:pin_b6", "d9:pin_1", "d9:pin_6", "u1:pin_27"]),
    ...netLinks("usb_dm", ["j1:pin_a7", "j1:pin_b7", "d9:pin_3", "d9:pin_4", "u1:pin_26"]),
    // ---- LEDs
    ...ledLinks,
  ],
  // the board's edge: what the cap and the harnesses reach
  exports: [
    { id: "usb", name: "USB-C receptacle", from: { child: "j1", interfaceId: "usb_c" } },
    { id: "usb_seal", name: "USB-C gasket face", from: { child: "j1", interfaceId: "panel_seal" } },
    { id: "button", name: "Button actuator", from: { child: "sw1", interfaceId: "actuator" } },
    { id: "tof", name: "ToF emitter aperture (underside)", from: { child: "u2", interfaceId: "tx_aperture" } },
    ...LEDS.map((k) => ({ id: `led${k}`, name: `LED ${k} light output`, from: { child: `d${k}`, interfaceId: "light_output" } })),
    { id: "bat_pos", name: "BAT+ pad", from: { child: "jbat", interfaceId: "pad_pos" } },
    { id: "bat_neg", name: "BAT- pad", from: { child: "jbat", interfaceId: "pad_neg" } },
    { id: "probe_vdd", name: "Probe VDD pad", from: { child: "jprb", interfaceId: "pad_vdd" } },
    { id: "probe_dq", name: "Probe DQ pad", from: { child: "jprb", interfaceId: "pad_dq" } },
    { id: "probe_gnd", name: "Probe GND pad", from: { child: "jprb", interfaceId: "pad_gnd" } },
    { id: "wifi", name: "Wi-Fi", from: { child: "u1", interfaceId: "wifi" } },
    { id: "bluetooth", name: "Bluetooth LE", from: { child: "u1", interfaceId: "bluetooth" } },
  ],
  traits: [
    {
      type: "design_envelope",
      params: {
        max_mm: { length: 71, width: 71, height: 5 },
        reason: "Fits the cap's Ø71.4 mm cavity (src/enclosures/bottle-cap: cavity radius 35.7 mm, 0.7 mm clearance to the wall); 5 mm covers the 0.6 mm board, the 2.4 mm module and the USB-C shell below the board.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "capacitor MPNs GRM155R61A105KE15D (1 uF) and GRM188R61A226ME15D (22 uF)",
        value: "1 uF 10 V X5R 0402 and 22 uF 10 V X5R 0603",
        reason: "Formed with Murata's part-numbering rule stated on murata-grm155/188 (the catalog cites other values' reference sheets); the two reference sheets could not be read here (Murata's product pages need JavaScript). Confirm them at ordering.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "ToF supply capacitor",
        value: "10 uF on AVDDVCSEL (GRM188R61A106ME69D) and 0.1 uF on AVDD",
        reason: "ST's application schematic asks for 4.7 uF and 0.1 uF; the larger 10 uF catalog value is used so the board has one 10 uF part number on 3V3.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "mass",
        value: "9 g assembled",
        reason: "Estimate, not weighed: Ø70 mm x 0.6 mm FR-4 (38.5 cm² x 0.06 cm x 1.85 g/cm³ = 4.3 g), four copper layers at about half coverage (1.2 g), the ESP32-C3-MINI-1 module (about 1.5 g), the USB4720 (about 0.8 g) and the other 57 parts (about 1 g). Weigh the first board and state weight_g from it.",
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "fabrication",
        note: "Four layers, 0.6 mm FR-4 (the USB4720 mid-mount needs a 0.6 +- 0.1 mm board and a 9.05 mm edge cut-out, GCT drawing USB4720 rev B). Every land pattern is the maker's recommended one, verified against its drawing: the receptacle's four stake legs in plated slots and its two grounding tags in plated holes, the switch's guide bosses in Ø0.9 mm non-plated holes (docs/decisions.md D-B07).",
      },
    },
  ],
});

// its outputs (out/: board GLB and STEP, manifest, drawings, BOM, fabrication files; tscircuit/circuit.json) are the
// circuit provider's: ext-tscircuit declares them and core attaches each one on disk to the board (PB-1030)
export const BOTTLE_CAP_BOARD: ModuleDef = BOARD;

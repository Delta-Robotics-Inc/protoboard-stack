/**
 * Main board (from the wearable template, derived from the wearable-watch
 * reference project's src/boards/watch-main): the core of a BLE wearable as
 * a UHD board module. Components are children (catalog parts), nets are
 * `Net` interfaces with membership links, and the board's edge (what the
 * cell, a USB cable and a programmer touch) is its exports. Nothing here
 * names a PCB tool: land patterns, placement and routing are the circuit
 * provider's (circuit.config.ts next to this file, @protoboardai/ext-tscircuit),
 * and the Zephyr board definition is the firmware provider's
 * (firmware.config.ts, @protoboardai/ext-zephyr).
 *
 * The starting circuit: the Raytac MDBT50Q-1MV2 (nRF52840) on a 3.0 V LDO
 * from the cell, the MCP73831 charging the cell from USB-C (with ESD
 * protection on the data lines), and pads for the cell and for SWD. Add
 * sensors, a display and haptics as the watch does (its main board is the
 * worked example, every value cited).
 *
 * Every value comes from a cited datasheet (the parts' own sources) or is an
 * `assumption`:
 *   [W1]  Raytac MDBT50Q-1MV2 approval sheet Ver. L, §2.5 pin table, §8.3
 *         reference circuit (normal voltage mode, one 10 uF on VDD/VDDH)
 *   [W2]  Nordic nRF52840 PS v1.11 (4413_417): §5.3.1 (normal voltage mode,
 *         VDD and VDDH tied), §6.35 (USBD: 4.7 uF on VBUS in the reference
 *         circuitry)
 *   [W10] Microchip MCP73831 DS20001984H: 4.7 uF on VDD and VBAT, RPROG
 *         sets IREG = 1000 V / RPROG
 *   [W11] TI TPS7A02 SBVS277C: 1 uF in, 1-22 uF out, EN to IN
 *   [W13] GCT USB4105 drawing; USB Type-C Cable and Connector Specification
 *         Release 2.1, §4.5.1.3.2 and Table 4-24: a sink presents Rd 5.1 kOhm
 *         on each CC pin
 *   [W14] ST USBLC6-2SC6 DS4260: 100 nF on VBUS (Figure 17)
 */
import { Net, defineModule, netLinks, type ChildModuleRef, type ModuleDef } from "@deltarobotics/uhd";

// Series passives (catalog: yageo-rc0402, murata-grm155, murata-grm188), set per placement with overrides.
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

export const MAIN_BOARD: ModuleDef = defineModule({
  id: "main-board",
  name: "Main board",
  version: "0.1.0",
  description:
    "Main board of a BLE wearable: Raytac MDBT50Q-1MV2 (nRF52840), TPS7A0230 3.0 V LDO from the cell, MCP73831 charger from USB-C with USBLC6 ESD protection, copper pads for the cell and SWD.",
  categories: ["microcontroller.module"],
  tags: ["board", "pcb", "wearable", "nrf52840", "ble"],
  display: { icon: "cpu" },
  interfaces: [
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "vbus", name: "VBUS", voltageV: 5 }),
    // a 1-cell LiPo between a firmware cut-off and full charge (set the cut-off from your power budget)
    Net({ id: "vbat", name: "VBAT", voltageV: [3.4, 4.2] }),
    Net({ id: "v3v0", name: "3V0", voltageV: 3.0 }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
    Net({ id: "cc1", name: "CC1" }),
    Net({ id: "cc2", name: "CC2" }),
    Net({ id: "prog", name: "PROG" }),
    Net({ id: "stat", name: "STAT" }),
    Net({ id: "chg_stat", name: "CHG_STAT" }),
    Net({ id: "swdio", name: "SWDIO" }),
    Net({ id: "swdclk", name: "SWDCLK" }),
    Net({ id: "nreset", name: "nRESET" }),
  ],
  children: [
    { id: "u1", moduleDefId: "raytac-mdbt50q-1mv2", name: "BLE module (nRF52840)" },
    { id: "u6", moduleDefId: "microchip-mcp73831t-2aci-ot", name: "Charger" },
    { id: "u7", moduleDefId: "ti-tps7a0230pdbv", name: "3V0 LDO" },
    { id: "j1", moduleDefId: "gct-usb4105-gf-a", name: "USB-C receptacle" },
    { id: "d1", moduleDefId: "st-usblc6-2sc6", name: "USB ESD protection" },
    { id: "j3", moduleDefId: "cell-pads", name: "Cell lead pads" },
    { id: "j5", moduleDefId: "swd-pads", name: "SWD test pads" },
    // U1 [W1] §8.3, [W2] §5.3.1 / USBD
    c10u("c1", "U1 VDD/VDDH bulk"),
    c100n("c2", "U1 VDD bypass"),
    c4u7("c3", "U1 VBUS"),
    // LDO [W11]
    c1u("c6", "U7 input"),
    c1u("c7", "U7 output"),
    // U6 [W10]
    c4u7("c15", "U6 VDD"),
    c4u7("c16", "U6 VBAT"),
    // D1 [W14]
    c100n("c19", "D1 VBUS"),
    // resistors
    r("r1", "CC1 Rd", 5100),
    r("r2", "CC2 Rd", 5100),
    r("r3", "U6 RPROG (83 mA)", 12_000),
    // U6's STAT drives high to its VDD (VBUS, 5 V) at charge complete [W10] §3.3; halved for P0.08 (3V0 I/O)
    r("r10", "STAT divider (top)", 22_000),
    r("r11", "STAT divider (bottom)", 22_000),
  ],
  links: [
    ...netLinks("gnd", [
      "u1:pin_1", "u1:pin_2", "u1:pin_15", "u1:pin_33", "u1:pin_55",
      "u6:pin_2",
      "u7:pin_2",
      "j1:pin_a1", "j1:pin_a12", "j1:pin_b1", "j1:pin_b12", "j1:shell",
      "d1:pin_2",
      "j3:pin_2",
      "j5:pin_5",
      "c1:pin_2", "c2:pin_2", "c3:pin_2", "c6:pin_2", "c7:pin_2", "c15:pin_2", "c16:pin_2", "c19:pin_2",
      "r1:pin_2", "r2:pin_2", "r3:pin_2", "r11:pin_2",
    ]),
    ...netLinks("vbus", ["j1:pin_a4", "j1:pin_a9", "j1:pin_b4", "j1:pin_b9", "d1:pin_5", "u6:pin_4", "u1:pin_32", "c3:pin_1", "c15:pin_1", "c19:pin_1"]),
    ...netLinks("vbat", ["j3:pin_1", "u6:pin_3", "u7:pin_1", "u7:pin_3", "c6:pin_1", "c16:pin_1"]),
    // normal voltage mode: VDD and VDDH on 3V0 [W2] §5.3.1
    ...netLinks("v3v0", ["u7:pin_5", "u1:pin_28", "u1:pin_30", "j5:pin_1", "c1:pin_1", "c2:pin_1", "c7:pin_1"]),
    // USB 2.0: both orientations' contacts, through D1's pin pairs [W14]
    ...netLinks("usb_dp", ["j1:pin_a6", "j1:pin_b6", "d1:pin_1", "d1:pin_6", "u1:pin_35"]),
    ...netLinks("usb_dm", ["j1:pin_a7", "j1:pin_b7", "d1:pin_3", "d1:pin_4", "u1:pin_34"]),
    ...netLinks("cc1", ["j1:pin_a5", "r1:pin_1"]),
    ...netLinks("cc2", ["j1:pin_b5", "r2:pin_1"]),
    // charger
    ...netLinks("prog", ["u6:pin_5", "r3:pin_1"]),
    // STAT is tri-state: low while charging, high (to VDD = VBUS) when done [W10] §3.3. R10/R11 halve it for P0.08.
    ...netLinks("stat", ["u6:pin_1", "r10:pin_1"]),
    ...netLinks("chg_stat", ["r10:pin_2", "r11:pin_1", "u1:pin_24"]), // P0.08
    // SWD
    ...netLinks("swdio", ["u1:pin_51", "j5:pin_2"]),
    ...netLinks("swdclk", ["u1:pin_53", "j5:pin_3"]),
    ...netLinks("nreset", ["u1:pin_40", "j5:pin_4"]),
  ],
  // the board edge
  exports: [
    { id: "usb", name: "USB-C", from: { child: "j1", interfaceId: "usb_c" } },
    { id: "bat_pos", name: "Cell + pad", from: { child: "j3", interfaceId: "pin_1" } },
    { id: "bat_neg", name: "Cell - pad", from: { child: "j3", interfaceId: "pin_2" } },
    { id: "swd", name: "SWD pads", from: { child: "j5", interfaceId: "swd" } },
    { id: "radio", name: "BLE antenna", from: { child: "u1", interfaceId: "ble_radio" } },
  ],
});

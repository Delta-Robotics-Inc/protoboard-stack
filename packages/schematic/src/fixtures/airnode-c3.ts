/**
 * Airnode C3: the synthetic sample circuit as UHD modules (contract section 3), for tests and examples. A board
 * with six sub-modules: USB input (USB-C receptacle with CC pull-downs), power (a 3.3 V LDO with input and output
 * capacitors), MCU (an ESP32-C3 module with bulk capacitor and EN RC), sensor (an I2C humidity sensor with
 * pull-ups and decoupling), status (two LEDs with resistors) and user IO (a BOOT button with a pull-up).
 *
 * SAMPLE, NOT A MANUFACTURABLE DESIGN: the parts are stand-ins named after common parts. Pin numbers follow the
 * board core's Airnode C3 fixture (its simplified land patterns), not the manufacturers' drawings, and the voltage
 * ranges are illustrative round values in the parts' usual class. No supplier numbers are given on purpose.
 *
 * `airnodeUhd("fault")` is the same board with the BOOT pull-up tied to VBUS (5 V) instead of +3V3, so the voltage
 * check has something to find: the MCU's IO9 allows 3.6 V at most.
 */
import { Net, Passive, defineModule, netLinks, pinTable, type ModuleDef, type ModuleLookup } from "@deltarobotics/uhd";

const SRC = "sample: Airnode C3 stand-in part, illustrative values";
const pkg = (name: string, pin_count: number, size: [number, number, number]) => ({
  domain: "mechanical" as const,
  dimensions_mm: { length: size[0], width: size[1], height: size[2] },
  package: { name, pin_count, exposed_pad: false, source: SRC },
});
const CHIP_0402 = { name: "0402", code: "1005 metric", pin_count: 2, exposed_pad: false, source: SRC };
const CHIP_0603 = { name: "0603", code: "1608 metric", pin_count: 2, exposed_pad: false, source: SRC };

export const MCU_MODULE: ModuleDef = defineModule({
  id: "airnode-esp32-c3-module",
  name: "ESP32-C3 module (sample)",
  part_number: "ESP32-C3-MINI-1 (sample)",
  categories: ["microcontroller.module"],
  interfaces: pinTable(
    [
      [1, "GND", "ground"],
      [2, "GND", "ground"],
      { pin: 3, name: "3V3", type: "power_in", voltageV: [3.0, 3.6], nominalV: 3.3 },
      [4, "IO0", "io"],
      [5, "IO1", "io"],
      [6, "IO2", "io"],
      [7, "IO3", "io"],
      { pin: 8, name: "EN", type: "input", description: "chip enable, high to run" },
      [9, "IO8", "io"],
      [10, "IO10", "io"],
      { pin: 11, name: "TXD0", type: "output", capabilities: ["uart_tx"] },
      { pin: 12, name: "RXD0", type: "input", capabilities: ["uart_rx"] },
      { pin: 13, name: "IO9", type: "io", description: "strapping pin: low at reset enters download mode" },
      { pin: 15, name: "IO4", type: "io", capabilities: ["i2c_sda"] },
      { pin: 16, name: "IO5", type: "io", capabilities: ["i2c_scl"] },
      { pin: 18, name: "IO6", type: "output" },
      { pin: 19, name: "IO7", type: "output" },
      { pin: 26, name: "IO18/D-", type: "io", capabilities: ["usb_dm"] },
      { pin: 27, name: "IO19/D+", type: "io", capabilities: ["usb_dp"] },
      [34, "GND", "ground"],
    ],
    { source: SRC, logicV: [0, 3.6] },
  ),
  domains: [pkg("module stand-in", 20, [13.2, 16.6, 2.4])],
});

export const LDO: ModuleDef = defineModule({
  id: "airnode-ldo-3v3",
  name: "AP2112K-3.3 LDO (sample)",
  part_number: "AP2112K-3.3 (sample)",
  categories: ["power.regulator", "component.ic"],
  interfaces: pinTable(
    [
      { pin: 1, name: "VIN", type: "power_in", voltageV: [2.5, 6.0], nominalV: 5 },
      [2, "GND", "ground"],
      { pin: 3, name: "EN", type: "input", voltageV: [0, 6.0] },
      [4, "NC", "nc"],
      { pin: 5, name: "VOUT", type: "power_out", voltageV: 3.3 },
    ],
    { source: SRC },
  ),
  domains: [pkg("SOT-23-5", 5, [2.9, 1.6, 1.1])],
});

export const SENSOR: ModuleDef = defineModule({
  id: "airnode-humidity-sensor",
  name: "SHT40 humidity sensor (sample)",
  part_number: "SHT40 (sample)",
  categories: ["sensor", "component.ic"],
  interfaces: pinTable(
    [
      { pin: 1, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
      { pin: 2, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
      { pin: 3, name: "VDD", type: "power_in", voltageV: [1.08, 3.6], nominalV: 3.3 },
      [4, "VSS", "ground"],
    ],
    { source: SRC, logicV: [0, 3.6] },
  ),
  domains: [pkg("DFN-4", 4, [1.5, 1.5, 0.5])],
});

export const USB_C: ModuleDef = defineModule({
  id: "airnode-usb-c-receptacle",
  name: "USB-C receptacle, USB 2.0 (sample)",
  part_number: "USB-C 16P (sample)",
  categories: ["connector.usb"],
  interfaces: pinTable(
    [
      { pin: "A1", name: "GND", type: "ground" },
      { pin: "A4", name: "VBUS", type: "power_out", voltageV: 5 },
      { pin: "A5", name: "CC1", type: "io", voltageV: [0, 5.5] },
      { pin: "A6", name: "D+", type: "io", capabilities: ["usb_dp"] },
      { pin: "A7", name: "D-", type: "io", capabilities: ["usb_dm"] },
      { pin: "A8", name: "SBU1", type: "io" },
      { pin: "B1", name: "GND", type: "ground" },
      { pin: "B4", name: "VBUS", type: "power_out", voltageV: 5 },
      { pin: "B5", name: "CC2", type: "io", voltageV: [0, 5.5] },
      { pin: "B6", name: "D+", type: "io", capabilities: ["usb_dp"] },
      { pin: "B7", name: "D-", type: "io", capabilities: ["usb_dm"] },
      { pin: "B8", name: "SBU2", type: "io" },
      { pin: "S", name: "SHIELD", type: "ground" },
    ],
    { source: SRC, logicV: [0, 3.6] },
  ),
  domains: [pkg("USB-C 16P", 13, [8.9, 7.3, 3.2])],
});

const LED = (id: string, color: string): ModuleDef =>
  defineModule({
    id,
    name: `LED ${color} 0603 (sample)`,
    part_number: `LED ${color} 0603 (sample)`,
    categories: ["component.led"],
    interfaces: pinTable(
      [
        [1, "A", "passive"],
        [2, "K", "passive"],
      ],
      { source: SRC },
    ),
    domains: [{ domain: "mechanical", dimensions_mm: { length: 1.6, width: 0.8, height: 0.6 }, package: CHIP_0603 }],
  });
export const LED_GREEN = LED("airnode-led-green", "green");
export const LED_AMBER = LED("airnode-led-amber", "amber");

export const BUTTON: ModuleDef = defineModule({
  id: "airnode-tact-switch",
  name: "Tact switch 4-pad (sample)",
  part_number: "Tact switch 4-pad (sample)",
  categories: ["component.switch"],
  interfaces: pinTable(
    [
      [1, "A", "passive"],
      [2, "A", "passive"],
      [3, "B", "passive"],
      [4, "B", "passive"],
    ],
    { source: SRC },
  ),
  domains: [pkg("tact 4-pad", 4, [5.1, 5.1, 1.5])],
});

const R = (id: string, ohms: number) => Passive({ id, name: `Resistor ${ohms} Ω 0402 (sample)`, kind: "resistor", value: ohms, unit: "Ω", tolerance: 0.01, package: CHIP_0402 });
const C = (id: string, farads: number, chip = CHIP_0402) => Passive({ id, name: `Capacitor ${farads} F (sample)`, kind: "capacitor", value: farads, unit: "F", tolerance: 0.1, package: chip });
export const R_5K1 = R("airnode-r-5k1", 5100);
export const R_4K7 = R("airnode-r-4k7", 4700);
export const R_1K = R("airnode-r-1k", 1000);
export const R_10K = R("airnode-r-10k", 10000);
export const C_1U = C("airnode-c-1u", 1e-6, CHIP_0603);
export const C_10U = C("airnode-c-10u", 1e-5, CHIP_0603);
export const C_100N = C("airnode-c-100n", 1e-7);

const ports = (ids: string[]) => ids.map((id) => ({ id, from: { self: true as const, interfaceId: id } }));

const USB_MODULE = defineModule({
  id: "airnode-usb-input",
  name: "USB input",
  kind: "group",
  interfaces: [Net({ id: "vbus", name: "VBUS", voltageV: 5 }), Net({ id: "gnd", name: "GND" }), Net({ id: "dp", name: "USB_DP" }), Net({ id: "dn", name: "USB_DN" }), Net({ id: "cc1", name: "CC1" }), Net({ id: "cc2", name: "CC2" })],
  children: [
    { id: "connector", moduleDefId: USB_C.id, name: "USB-C", unconnected: [{ interfaceId: "pin_A8", reason: "sideband unused in USB 2.0" }, { interfaceId: "pin_B8", reason: "sideband unused in USB 2.0" }] },
    { id: "r_cc1", moduleDefId: R_5K1.id, name: "CC1 pull-down (sink)" },
    { id: "r_cc2", moduleDefId: R_5K1.id, name: "CC2 pull-down (sink)" },
  ],
  links: [
    ...netLinks("vbus", ["connector:pin_A4", "connector:pin_B4"]),
    ...netLinks("gnd", ["connector:pin_A1", "connector:pin_B1", "connector:pin_S", "r_cc1:pin_2", "r_cc2:pin_2"]),
    ...netLinks("dp", ["connector:pin_A6", "connector:pin_B6"]),
    ...netLinks("dn", ["connector:pin_A7", "connector:pin_B7"]),
    ...netLinks("cc1", ["connector:pin_A5", "r_cc1:pin_1"]),
    ...netLinks("cc2", ["connector:pin_B5", "r_cc2:pin_1"]),
  ],
  exports: ports(["vbus", "gnd", "dp", "dn"]),
});

const POWER_MODULE = defineModule({
  id: "airnode-power",
  name: "Power 3V3",
  kind: "group",
  interfaces: [Net({ id: "vbus", name: "VBUS", voltageV: 5 }), Net({ id: "v3v3", name: "+3V3", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" })],
  children: [
    { id: "ldo", moduleDefId: LDO.id, name: "3.3 V LDO" },
    { id: "c_in", moduleDefId: C_1U.id, name: "LDO input capacitor" },
    { id: "c_out", moduleDefId: C_1U.id, name: "LDO output capacitor" },
  ],
  links: [...netLinks("vbus", ["ldo:pin_1", "ldo:pin_3", "c_in:pin_1"]), ...netLinks("v3v3", ["ldo:pin_5", "c_out:pin_1"]), ...netLinks("gnd", ["ldo:pin_2", "c_in:pin_2", "c_out:pin_2"])],
  exports: ports(["vbus", "v3v3", "gnd"]),
});

const MCU_GROUP = defineModule({
  id: "airnode-mcu",
  name: "MCU",
  kind: "group",
  interfaces: [
    Net({ id: "v3v3", name: "+3V3", voltageV: 3.3 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "en", name: "EN" }),
    Net({ id: "boot", name: "BOOT" }),
    Net({ id: "sda", name: "I2C_SDA" }),
    Net({ id: "scl", name: "I2C_SCL" }),
    Net({ id: "dp", name: "USB_DP" }),
    Net({ id: "dn", name: "USB_DN" }),
    Net({ id: "led1", name: "LED1" }),
    Net({ id: "led2", name: "LED2" }),
  ],
  children: [
    {
      id: "module",
      moduleDefId: MCU_MODULE.id,
      name: "ESP32-C3 module",
      unconnected: ["pin_4", "pin_5", "pin_6", "pin_7", "pin_9", "pin_10", "pin_11", "pin_12"].map((interfaceId) => ({ interfaceId, reason: "spare GPIO on this board" })),
    },
    { id: "c_bulk", moduleDefId: C_10U.id, name: "3V3 bulk capacitor" },
    { id: "r_en", moduleDefId: R_10K.id, name: "EN pull-up" },
    { id: "c_en", moduleDefId: C_1U.id, name: "EN delay capacitor" },
  ],
  links: [
    ...netLinks("v3v3", ["module:pin_3", "c_bulk:pin_1", "r_en:pin_1"]),
    ...netLinks("gnd", ["module:pin_1", "module:pin_2", "module:pin_34", "c_bulk:pin_2", "c_en:pin_2"]),
    ...netLinks("en", ["module:pin_8", "r_en:pin_2", "c_en:pin_1"]),
    ...netLinks("boot", ["module:pin_13"]),
    ...netLinks("sda", ["module:pin_15"]),
    ...netLinks("scl", ["module:pin_16"]),
    ...netLinks("led1", ["module:pin_18"]),
    ...netLinks("led2", ["module:pin_19"]),
    ...netLinks("dn", ["module:pin_26"]),
    ...netLinks("dp", ["module:pin_27"]),
  ],
  exports: ports(["v3v3", "gnd", "boot", "sda", "scl", "dp", "dn", "led1", "led2"]),
});

const SENSOR_GROUP = defineModule({
  id: "airnode-sensor",
  name: "Sensor I2C",
  kind: "group",
  interfaces: [Net({ id: "v3v3", name: "+3V3", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" }), Net({ id: "sda", name: "I2C_SDA" }), Net({ id: "scl", name: "I2C_SCL" })],
  children: [
    { id: "ic", moduleDefId: SENSOR.id, name: "humidity sensor" },
    { id: "c_dec", moduleDefId: C_100N.id, name: "sensor decoupling" },
    { id: "r_sda", moduleDefId: R_4K7.id, name: "SDA pull-up" },
    { id: "r_scl", moduleDefId: R_4K7.id, name: "SCL pull-up" },
  ],
  links: [
    ...netLinks("v3v3", ["ic:pin_3", "c_dec:pin_1", "r_sda:pin_1", "r_scl:pin_1"]),
    ...netLinks("gnd", ["ic:pin_4", "c_dec:pin_2"]),
    ...netLinks("sda", ["ic:pin_1", "r_sda:pin_2"]),
    ...netLinks("scl", ["ic:pin_2", "r_scl:pin_2"]),
  ],
  exports: ports(["v3v3", "gnd", "sda", "scl"]),
});

const STATUS_GROUP = defineModule({
  id: "airnode-status",
  name: "Status LEDs",
  kind: "group",
  interfaces: [Net({ id: "gnd", name: "GND" }), Net({ id: "led1", name: "LED1" }), Net({ id: "led2", name: "LED2" }), Net({ id: "led1_a", name: "LED1_A" }), Net({ id: "led2_a", name: "LED2_A" })],
  children: [
    { id: "led1", moduleDefId: LED_GREEN.id, name: "status LED, green" },
    { id: "led2", moduleDefId: LED_AMBER.id, name: "status LED, amber" },
    { id: "r1", moduleDefId: R_1K.id, name: "LED1 resistor" },
    { id: "r2", moduleDefId: R_1K.id, name: "LED2 resistor" },
  ],
  links: [
    ...netLinks("led1", ["r1:pin_1"]),
    ...netLinks("led1_a", ["r1:pin_2", "led1:pin_1"]),
    ...netLinks("led2", ["r2:pin_1"]),
    ...netLinks("led2_a", ["r2:pin_2", "led2:pin_1"]),
    ...netLinks("gnd", ["led1:pin_2", "led2:pin_2"]),
  ],
  exports: ports(["gnd", "led1", "led2"]),
});

const uiGroup = (pullTo: "v3v3" | "vbus") =>
  defineModule({
    id: pullTo === "v3v3" ? "airnode-ui" : "airnode-ui-fault",
    name: "User IO",
    kind: "group",
    interfaces: [Net({ id: "gnd", name: "GND" }), Net({ id: "boot", name: "BOOT" }), pullTo === "v3v3" ? Net({ id: "v3v3", name: "+3V3", voltageV: 3.3 }) : Net({ id: "vbus", name: "VBUS", voltageV: 5 })],
    children: [
      { id: "boot_button", moduleDefId: BUTTON.id, name: "BOOT button" },
      { id: "r_boot", moduleDefId: R_10K.id, name: "BOOT pull-up" },
    ],
    links: [...netLinks("boot", ["boot_button:pin_1", "boot_button:pin_2", "r_boot:pin_2"]), ...netLinks("gnd", ["boot_button:pin_3", "boot_button:pin_4"]), ...netLinks(pullTo, ["r_boot:pin_1"])],
    exports: ports(["gnd", "boot", pullTo]),
  });

function board(variant: "ok" | "fault"): ModuleDef {
  const ui = uiGroup(variant === "ok" ? "v3v3" : "vbus");
  return defineModule({
    id: variant === "ok" ? "airnode-c3" : "airnode-c3-fault",
    name: variant === "ok" ? "Airnode C3 main board" : "Airnode C3 main board (BOOT pull-up on 5 V)",
    kind: "board",
    interfaces: [
      Net({ id: "vbus", name: "VBUS", voltageV: 5 }),
      Net({ id: "gnd", name: "GND" }),
      Net({ id: "v3v3", name: "+3V3", voltageV: 3.3 }),
      Net({ id: "boot", name: "BOOT" }),
      Net({ id: "sda", name: "I2C_SDA" }),
      Net({ id: "scl", name: "I2C_SCL" }),
      Net({ id: "dp", name: "USB_DP" }),
      Net({ id: "dn", name: "USB_DN" }),
      Net({ id: "led1", name: "LED1" }),
      Net({ id: "led2", name: "LED2" }),
    ],
    children: [
      { id: "usb", moduleDefId: USB_MODULE.id, name: "USB input" },
      { id: "power", moduleDefId: POWER_MODULE.id, name: "Power 3V3" },
      { id: "mcu", moduleDefId: MCU_GROUP.id, name: "MCU" },
      { id: "sensor", moduleDefId: SENSOR_GROUP.id, name: "Sensor I2C" },
      { id: "status", moduleDefId: STATUS_GROUP.id, name: "Status LEDs" },
      { id: "ui", moduleDefId: ui.id, name: "User IO" },
    ],
    links: [
      ...netLinks("vbus", ["usb:vbus", "power:vbus", ...(variant === "fault" ? ["ui:vbus"] : [])]),
      ...netLinks("gnd", ["usb:gnd", "power:gnd", "mcu:gnd", "sensor:gnd", "status:gnd", "ui:gnd"]),
      ...netLinks("v3v3", ["power:v3v3", "mcu:v3v3", "sensor:v3v3", ...(variant === "ok" ? ["ui:v3v3"] : [])]),
      ...netLinks("boot", ["mcu:boot", "ui:boot"]),
      ...netLinks("sda", ["mcu:sda", "sensor:sda"]),
      ...netLinks("scl", ["mcu:scl", "sensor:scl"]),
      ...netLinks("dp", ["usb:dp", "mcu:dp"]),
      ...netLinks("dn", ["usb:dn", "mcu:dn"]),
      ...netLinks("led1", ["mcu:led1", "status:led1"]),
      ...netLinks("led2", ["mcu:led2", "status:led2"]),
    ],
  });
}

const PARTS = [MCU_MODULE, LDO, SENSOR, USB_C, LED_GREEN, LED_AMBER, BUTTON, R_5K1, R_4K7, R_1K, R_10K, C_1U, C_10U, C_100N];

/** The Airnode C3 board as UHD: the board module and a lookup over every definition it uses. */
export function airnodeUhd(variant: "ok" | "fault" = "ok"): { board: ModuleDef; lookup: ModuleLookup } {
  const b = board(variant);
  const defs = [b, USB_MODULE, POWER_MODULE, MCU_GROUP, SENSOR_GROUP, STATUS_GROUP, uiGroup(variant === "ok" ? "v3v3" : "vbus"), ...PARTS];
  const map = new Map(defs.map((d) => [d.id, d]));
  return { board: b, lookup: (id: string) => map.get(id) };
}

/** The reference designators the board core's Airnode C3 fixture uses, by UHD instance path (cross-probe). */
export const AIRNODE_REFS: Record<string, string> = {
  "mcu/module": "U1",
  "usb/connector": "J1",
  "power/ldo": "U2",
  "power/c_in": "C1",
  "power/c_out": "C2",
  "mcu/c_bulk": "C3",
  "sensor/ic": "U3",
  "sensor/c_dec": "C4",
  "sensor/r_sda": "R3",
  "sensor/r_scl": "R4",
  "status/led1": "D1",
  "status/led2": "D2",
  "status/r1": "R1",
  "status/r2": "R2",
  "ui/boot_button": "SW1",
  "usb/r_cc1": "R5",
  "usb/r_cc2": "R6",
  "mcu/r_en": "R7",
  "mcu/c_en": "C5",
};

/** The Airnode C3 circuit from its UHD modules, with the board fixture's designators. */
export async function airnodeCircuit(variant: "ok" | "fault" = "ok") {
  const { circuitFromUhd } = await import("../uhd.ts");
  const { board, lookup } = airnodeUhd(variant);
  return circuitFromUhd(board, lookup, { refs: AIRNODE_REFS });
}

/** The Airnode C3 schematic, laid out, with its title block. */
export async function airnodeSchematic(variant: "ok" | "fault" = "ok") {
  const { createSchematic, withChanges } = await import("../document.ts");
  const { layoutSchematic } = await import("../layout/index.ts");
  const c = await airnodeCircuit(variant);
  const doc = createSchematic([{ kind: "schematic", id: "schematic", name: "Airnode C3", source: { board: c.board, hash: "" }, title_block: { title: "Airnode C3 main board", rev: "B", date: "2026-11-09" }, settings: { bend_limit: 4, gutter: 4 } }], c);
  const r = layoutSchematic(doc);
  return withChanges(doc, r.puts, r.removes);
}

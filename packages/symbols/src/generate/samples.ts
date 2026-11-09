/**
 * One sample per code-built family, with generic pin data (no real part's datasheet copied): the contact sheet
 * draws them and the tests check them.
 */
import type { SymbolDef } from "../types.ts";
import type { PinInput } from "./box.ts";
import { dipSwitch, header, header2, icBox, kicadBox, logicIec, mcu, module, netLabel, regulator, servo, sheet, terminalBlock, usbC, usbMicroB } from "./families.ts";

export interface Sample {
  title: string;
  generator: string;
  build: () => SymbolDef;
}

/** A generic I2C/SPI sensor's pins (pad order). */
export const SENSOR_PINS: PinInput[] = [
  { name: "SDO", number: "1", type: "output", group: "SPI" },
  { name: "VDDIO", number: "2", type: "power_in" },
  { name: "GND", number: "3" },
  { name: "INT1", number: "4", type: "output", group: "interrupts" },
  { name: "VDD", number: "5", type: "power_in" },
  { name: "GND", number: "6" },
  { name: "INT2", number: "7", type: "output", group: "interrupts" },
  { name: "CS", number: "8", type: "input", group: "SPI" },
  { name: "SCL/SCK", number: "9", type: "input", group: "SPI" },
  { name: "SDA/SDI", number: "10", type: "bidirectional", group: "SPI" },
  { name: "NC", number: "11", type: "no_connect" },
];

const MCU_PINS: PinInput[] = [
  { name: "VDD", number: "1" },
  ...["PC13", "PC14/OSC32_IN", "PC15/OSC32_OUT"].map((name, i) => ({ name, number: String(2 + i), type: "bidirectional" as const })),
  { name: "NRST", number: "5", type: "input" },
  { name: "VDDA", number: "6" },
  ...Array.from({ length: 8 }, (_, i) => ({ name: `PA${i}`, number: String(7 + i), type: "bidirectional" as const })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `PB${i}`, number: String(15 + i), type: "bidirectional" as const })),
  { name: "VSS", number: "21" },
  { name: "VDD", number: "22" },
  ...Array.from({ length: 5 }, (_, i) => ({ name: `PA${8 + i}`, number: String(23 + i), type: "bidirectional" as const })),
  { name: "SWDIO", number: "28", type: "bidirectional" },
  { name: "SWCLK", number: "29", type: "input" },
  { name: "BOOT0", number: "30", type: "input" },
  { name: "VSS", number: "31" },
  { name: "EP", number: "33" },
];

const DEV_BOARD_PINS: PinInput[] = ["5V", "GND", "3V3", "IO0", "IO1", "IO2", "IO3", "IO4", "IO5", "IO6", "IO7", "IO8", "IO9", "IO10", "RX", "TX"].map((name, i) => ({
  name,
  number: String(i + 1),
  type: name === "GND" ? "power_in" : /V/.test(name) ? "power_in" : "bidirectional",
}));

export const SAMPLES: Sample[] = [
  { title: "Sensor, four sides", generator: "icBox(pins)", build: () => icBox(SENSOR_PINS, { id: "sample-sensor", name: "Sensor (generic box)" }) },
  { title: "Sensor, KiCad export layout", generator: "kicadBox(pins)", build: () => kicadBox(SENSOR_PINS, { id: "sample-sensor-kicad", name: "Sensor (KiCad export layout)" }) },
  { title: "Microcontroller", generator: "mcu(pins)", build: () => mcu(MCU_PINS, { id: "sample-mcu", name: "Microcontroller (generic, 32 pin)" }) },
  { title: "Dev board, DIP order", generator: "module(pins)", build: () => module(DEV_BOARD_PINS, { id: "sample-dev-board", name: "Dev board (generic, 16 pin)" }) },
  {
    title: "Hierarchical sheet",
    generator: "sheet(title, ports)",
    build: () =>
      sheet("POWER", [
        { name: "VBUS", type: "input" },
        { name: "EN", type: "input" },
        { name: "3V3", type: "power_out" },
        { name: "PG", type: "output" },
      ], { id: "sample-sheet" }),
  },
  {
    title: "LDO, 5 pin",
    generator: "regulator('linear', pins)",
    build: () => regulator("linear", [{ name: "VIN", number: "1" }, { name: "GND", number: "2" }, { name: "EN", number: "3" }, { name: "NC", number: "4" }, { name: "VOUT", number: "5" }], { id: "sample-ldo" }),
  },
  {
    title: "Buck converter, 6 pin",
    generator: "regulator('buck', pins)",
    build: () => regulator("buck", [{ name: "BST", number: "1" }, { name: "GND", number: "2" }, { name: "FB", number: "3" }, { name: "EN", number: "4" }, { name: "VIN", number: "5" }, { name: "SW", number: "6" }], { id: "sample-buck" }),
  },
  {
    title: "Boost converter, 5 pin",
    generator: "regulator('boost', pins)",
    build: () => regulator("boost", [{ name: "SW", number: "1" }, { name: "GND", number: "2" }, { name: "FB", number: "3" }, { name: "EN", number: "4" }, { name: "VIN", number: "5" }], { id: "sample-boost" }),
  },
  {
    title: "Li-ion charger, 8 pin",
    generator: "regulator('charger', pins)",
    build: () =>
      regulator("charger", [
        { name: "TEMP", number: "1" },
        { name: "PROG", number: "2" },
        { name: "GND", number: "3" },
        { name: "VCC", number: "4" },
        { name: "BAT", number: "5" },
        { name: "STDBY", number: "6" },
        { name: "CHRG", number: "7" },
        { name: "CE", number: "8" },
        { name: "EP", number: "9" },
      ], { id: "sample-charger" }),
  },
  { title: "Header 1 x 6", generator: "header(6)", build: () => header(6) },
  {
    title: "SWD header 2 x 5",
    generator: "header2(5, { names })",
    build: () => header2(5, { id: "header-2x5-swd", name: "SWD header 2 x 5", names: ["VTREF", "SWDIO", "GND", "SWCLK", "GND", "SWO", "KEY", "NC", "GNDDET", "NRESET"] }),
  },
  { title: "Screw terminal 1 x 3", generator: "terminalBlock(3)", build: () => terminalBlock(3) },
  { title: "USB-C receptacle", generator: "usbC()", build: () => usbC() },
  { title: "USB micro-B", generator: "usbMicroB()", build: () => usbMicroB() },
  { title: "DIP switch, 4 position", generator: "dipSwitch(4)", build: () => dipSwitch(4) },
  { title: "Hobby servo", generator: "servo()", build: () => servo() },
  { title: "IEC AND", generator: "logicIec('and', 2, false)", build: () => logicIec("and", 2, false) },
  { title: "IEC NOR", generator: "logicIec('or', 2, true)", build: () => logicIec("or", 2, true) },
  { title: "IEC XOR", generator: "logicIec('xor', 2, false)", build: () => logicIec("xor", 2, false) },
  { title: "IEC Schmitt inverter", generator: "logicIec('schmitt', 1, true)", build: () => logicIec("schmitt", 1, true) },
  { title: "Net label", generator: "netLabel('I2C_SDA')", build: () => netLabel("I2C_SDA") },
];

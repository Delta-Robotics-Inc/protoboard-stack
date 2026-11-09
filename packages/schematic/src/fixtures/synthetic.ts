/**
 * Synthetic circuits that exercise the layout's patterns (contract section 7), built directly as schematic circuits
 * (the input `circuitFromUhd` produces) so the tests cover each pattern without any real board:
 *
 *   ledDriver16     a 16-channel LED driver: two 8-bit shift registers, sixteen identical low-side channels (an
 *                   N-MOSFET, its gate resistor and pull-down, an LED and its resistor) on a shared rail (repeated
 *                   channels, drawn as an aligned array)
 *   ledChain8       eight addressable LEDs in a daisy chain, each with its decoupling capacitor, fed through a series
 *                   resistor (a chain, drawn in rows of equal pitch)
 *   mcu48           a 48-pin microcontroller with its crystal and load capacitors, four decoupling capacitors, a reset
 *                   RC, a BOOT0 pull-down, a debug header, a battery divider and an RC filter; most ports unused
 *                   (a large IC: supply rows, hide_unused, crystal, divider, filter)
 *   fifteenCards    a board of fifteen sub-modules: a power input with a fuse, a TVS and a reverse-polarity diode, an
 *                   LDO, a battery divider, a USB port with an ESD array and its differential pair, test points, the
 *                   microcontroller and sensors, outputs and the LED chain (card placement at scale)
 *
 *   largeBoard      the fifteen-card board with sixteen more channels, about 160 parts (the time budget)
 *
 * SAMPLE CIRCUITS, NOT DESIGNS: part names are generic, values are round illustrative numbers, pin numbers are
 * sequential, and nothing here is meant to be built.
 */
import type { CircuitNet, CircuitPart, CircuitPin, PartClass, SchematicCircuit } from "../circuit.ts";
import { CIRCUIT_SCHEMA } from "../circuit.ts";

type PinSpec = [name: string, type?: CircuitPin["type"]];

/** The supply nets of the samples (drawn as power symbols). */
const POWER = new Set(["+12V", "+5V", "+3V3", "VBAT", "VBUS", "VIN_RAW", "VIN_FUSED"]);

/** A small builder: parts with named pins, nets joined by `connect`. */
class Builder {
  parts: CircuitPart[] = [];
  nets = new Map<string, { kind: CircuitNet["kind"]; pins: Set<string> }>();
  groups: SchematicCircuit["groups"] = [];
  constructor(readonly board: string) {}

  group(path: string, name: string): this {
    this.groups.push({ path, name, module: `sample-${path.replace(/\//g, "-")}` });
    return this;
  }
  part(path: string, cls: PartClass, name: string, pins: PinSpec[], extra: Partial<CircuitPart> = {}): string {
    const group = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    this.parts.push({
      path,
      group,
      part: `sample-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      class: cls,
      pins: pins.map(([n, type], i) => ({ id: `p${i + 1}`, number: String(i + 1), name: n, type: type ?? "passive" })),
      ...extra,
    });
    return path;
  }
  /** Two-terminal parts: pins 1 and 2 (an LED: A and K). */
  two(path: string, cls: PartClass, value: string, a: string, b: string): string {
    const names: PinSpec[] = cls === "led" || cls === "diode" ? [["A"], ["K"]] : [["1"], ["2"]];
    this.part(path, cls, `${cls} ${value}`, names, { value });
    this.connect(a, `${path}:p1`);
    this.connect(b, `${path}:p2`);
    return path;
  }
  pin(path: string, name: string): string {
    const p = this.parts.find((x) => x.path === path)!;
    const q = p.pins.find((x) => x.name === name);
    if (!q) throw new Error(`${path} has no pin ${name}`);
    return `${path}:${q.id}`;
  }
  connect(net: string, ...pins: string[]): void {
    const kind: CircuitNet["kind"] = net === "GND" ? "ground" : POWER.has(net) ? "power" : "signal";
    let n = this.nets.get(net);
    if (!n) this.nets.set(net, (n = { kind, pins: new Set() }));
    for (const p of pins) n.pins.add(p);
  }
  circuit(): SchematicCircuit {
    return {
      schema: CIRCUIT_SCHEMA,
      board: this.board,
      parts: this.parts,
      nets: [...this.nets].filter(([, n]) => n.pins.size).map(([name, n]) => ({ name, kind: n.kind, pins: [...n.pins] })),
      groups: this.groups,
    };
  }
}

const LOGIC = (n: string): PinSpec => [n, "io"];

/** An 8-bit shift register (74HC595-like pinout by function). */
function shiftRegister(b: Builder, path: string): string {
  return b.part(path, "ic", "8-bit shift register", [["VCC", "power_in"], ["GND", "ground"], ["SER", "input"], ["SRCLK", "input"], ["RCLK", "input"], ["OE", "input"], ["SRCLR", "input"], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): PinSpec => [`Q${i}`, "output"]), ["Q7S", "output"]]);
}

function lowSideChannel(b: Builder, g: string, i: number, drive: string): void {
  const q = b.part(`${g}/q${i}`, "transistor", "N-MOSFET", [["G", "input"], ["D", "passive"], ["S", "passive"]]);
  b.two(`${g}/rg${i}`, "resistor", "100R", drive, `${g}/GATE${i}`);
  b.connect(`${g}/GATE${i}`, b.pin(q, "G"));
  b.two(`${g}/rpd${i}`, "resistor", "100k", `${g}/GATE${i}`, "GND");
  b.connect("GND", b.pin(q, "S"));
  b.two(`${g}/d${i}`, "led", "red", "+12V", `${g}/LED${i}`);
  b.two(`${g}/rl${i}`, "resistor", "470R", `${g}/LED${i}`, `${g}/SINK${i}`);
  b.connect(`${g}/SINK${i}`, b.pin(q, "D"));
}

/** A 16-channel LED driver: two cascaded shift registers and sixteen identical low-side channels. */
export function ledDriver16(): SchematicCircuit {
  const b = new Builder("sample-led-driver-16");
  b.group("logic", "Shift registers").group("channels", "16 LED channels").group("input", "Input connector");
  const j = b.part("input/j1", "connector", "Input header", [["VIN", "power_out"], ["GND", "ground"], ["DATA", "passive"], ["CLK", "passive"], ["LATCH", "passive"], ["+5V", "power_out"]]);
  b.connect("+12V", b.pin(j, "VIN"));
  b.connect("+5V", b.pin(j, "+5V"));
  b.connect("GND", b.pin(j, "GND"));
  b.connect("DATA", b.pin(j, "DATA"));
  b.connect("CLK", b.pin(j, "CLK"));
  b.connect("LATCH", b.pin(j, "LATCH"));
  const u1 = shiftRegister(b, "logic/u1");
  const u2 = shiftRegister(b, "logic/u2");
  for (const u of [u1, u2]) {
    b.connect("+5V", b.pin(u, "VCC"));
    b.connect("GND", b.pin(u, "GND"), b.pin(u, "OE"));
    b.connect("CLK", b.pin(u, "SRCLK"));
    b.connect("LATCH", b.pin(u, "RCLK"));
    b.connect("+5V", b.pin(u, "SRCLR"));
    b.two(`${u}c`, "capacitor", "100nF", "+5V", "GND");
  }
  b.connect("DATA", b.pin(u1, "SER"));
  b.connect("logic/CASCADE", b.pin(u1, "Q7S"), b.pin(u2, "SER"));
  for (let i = 0; i < 16; i++) {
    const u = i < 8 ? u1 : u2;
    b.connect(`OUT${i}`, b.pin(u, `Q${i % 8}`));
    lowSideChannel(b, "channels", i, `OUT${i}`);
  }
  return b.circuit();
}

/** Eight addressable LEDs in a chain, each with its decoupling capacitor. */
export function ledChain8(prefix = "ring", b = new Builder("sample-led-chain-8"), feed = "LED_DATA"): SchematicCircuit {
  if (!b.groups.some((g) => g.path === prefix)) b.group(prefix, "Status ring (8 addressable LEDs)");
  let data = `${prefix}/DIN0`;
  b.two(`${prefix}/r_din`, "resistor", "330R", feed, data);
  for (let i = 0; i < 8; i++) {
    const d = b.part(`${prefix}/led${i + 1}`, "led", "Addressable RGB LED", [["VDD", "power_in"], ["DOUT", "output"], ["VSS", "ground"], ["DIN", "input"]]);
    b.connect("+5V", b.pin(d, "VDD"));
    b.connect("GND", b.pin(d, "VSS"));
    b.connect(data, b.pin(d, "DIN"));
    if (i < 7) {
      data = `${prefix}/DOUT${i + 1}`;
      b.connect(data, b.pin(d, "DOUT"));
    } else b.parts.find((p) => p.path === d)!.unconnected = { p2: "the chain ends here" };
    b.two(`${prefix}/c${i + 1}`, "capacitor", "100nF", "+5V", "GND");
  }
  if (b.board === "sample-led-chain-8") {
    b.group("feed", "Data input");
    const j = b.part("feed/j1", "connector", "LED header", [["+5V", "power_out"], ["DATA", "passive"], ["GND", "ground"]]);
    b.connect("+5V", b.pin(j, "+5V"));
    b.connect("GND", b.pin(j, "GND"));
    b.connect(feed, b.pin(j, "DATA"));
  }
  return b.circuit();
}

/** The 48-pin microcontroller and what it needs, on one sub-module; most ports left unused. */
function mcuBlock(b: Builder, g: string): string {
  const pins: PinSpec[] = [
    ["VDD", "power_in"],
    ["VDD", "power_in"],
    ["VDD", "power_in"],
    ["VDDA", "power_in"],
    ["VSS", "ground"],
    ["VSS", "ground"],
    ["VSS", "ground"],
    ["VSSA", "ground"],
    ["NRST", "input"],
    ["BOOT0", "input"],
    ["OSC_IN", "passive"],
    ["OSC_OUT", "passive"],
    ["SWDIO", "io"],
    ["SWCLK", "input"],
    ...Array.from({ length: 13 }, (_, i) => LOGIC(`PA${i}`)),
    ...Array.from({ length: 16 }, (_, i) => LOGIC(`PB${i}`)),
    LOGIC("PC13"),
    LOGIC("PC14"),
  ];
  const u = b.part(`${g}/u1`, "mcu", "48-pin microcontroller", pins);
  const all = b.parts.find((p) => p.path === u)!;
  const named = (n: string) => all.pins.filter((p) => p.name === n).map((p) => `${u}:${p.id}`);
  b.connect("+3V3", ...named("VDD"), ...named("VDDA"));
  b.connect("GND", ...named("VSS"), ...named("VSSA"));
  for (let i = 0; i < 4; i++) b.two(`${g}/c${i + 1}`, "capacitor", i === 3 ? "1uF" : "100nF", "+3V3", "GND");
  // crystal with its load capacitors
  b.connect(`${g}/XIN`, b.pin(u, "OSC_IN"));
  b.connect(`${g}/XOUT`, b.pin(u, "OSC_OUT"));
  b.two(`${g}/y1`, "crystal", "8MHz", `${g}/XIN`, `${g}/XOUT`);
  b.two(`${g}/c_xin`, "capacitor", "18pF", `${g}/XIN`, "GND");
  b.two(`${g}/c_xout`, "capacitor", "18pF", `${g}/XOUT`, "GND");
  // reset RC, boot strap
  b.connect(`${g}/NRST`, b.pin(u, "NRST"));
  b.two(`${g}/r_rst`, "resistor", "10k", "+3V3", `${g}/NRST`);
  b.two(`${g}/c_rst`, "capacitor", "100nF", `${g}/NRST`, "GND");
  b.connect(`${g}/BOOT0`, b.pin(u, "BOOT0"));
  b.two(`${g}/r_boot`, "resistor", "10k", `${g}/BOOT0`, "GND");
  // debug
  b.connect("SWDIO", b.pin(u, "SWDIO"));
  b.connect("SWCLK", b.pin(u, "SWCLK"));
  return u;
}

/** A 48-pin microcontroller with its crystal, decoupling, reset, boot strap, debug header, divider and filter. */
export function mcu48(): SchematicCircuit {
  const b = new Builder("sample-mcu-48");
  b.group("mcu", "Microcontroller").group("debug", "Debug header").group("sense", "Battery sense");
  const u = mcuBlock(b, "mcu");
  const j = b.part("debug/j1", "connector", "Debug header", [["+3V3", "power_in"], ["SWDIO", "passive"], ["SWCLK", "passive"], ["GND", "ground"]]);
  b.connect("+3V3", b.pin(j, "+3V3"));
  b.connect("GND", b.pin(j, "GND"));
  b.connect("SWDIO", b.pin(j, "SWDIO"));
  b.connect("SWCLK", b.pin(j, "SWCLK"));
  // a battery divider into an RC filter, read on PA0; a status LED on PB0
  b.two("sense/r_top", "resistor", "100k", "VBAT", "sense/VDIV");
  b.two("sense/r_bot", "resistor", "47k", "sense/VDIV", "GND");
  b.two("sense/r_f", "resistor", "1k", "sense/VDIV", "VBAT_SENSE");
  b.two("sense/c_f", "capacitor", "100nF", "VBAT_SENSE", "GND");
  b.connect("VBAT_SENSE", b.pin(u, "PA0"));
  b.connect("LED_STAT", b.pin(u, "PB0"));
  b.two("mcu/r_led", "resistor", "1k", "LED_STAT", "mcu/LED_A");
  b.two("mcu/d_led", "led", "green", "mcu/LED_A", "GND");
  const bat = b.part("sense/j_bat", "connector", "Battery", [["VBAT", "power_out"], ["GND", "ground"]]);
  b.connect("VBAT", b.pin(bat, "VBAT"));
  b.connect("GND", b.pin(bat, "GND"));
  return b.circuit();
}

/** A board of fifteen sub-modules, for card placement at scale. */
export function fifteenCards(): SchematicCircuit {
  const b = new Builder("sample-fifteen-cards");
  const groups: [string, string][] = [
    ["pwr_in", "Power input (fuse, TVS, reverse diode)"],
    ["ldo", "3.3 V LDO"],
    ["bat", "Battery divider"],
    ["usb", "USB port with ESD"],
    ["tp", "Test points"],
    ["mcu", "Microcontroller"],
    ["debug", "Debug header"],
    ["imu", "IMU on I2C"],
    ["baro", "Barometer on I2C"],
    ["temp", "Temperature sensor"],
    ["btn", "Buttons"],
    ["buzzer", "Buzzer driver"],
    ["relay", "Relay driver"],
    ["ring", "Status ring"],
    ["out", "Output header"],
  ];
  for (const [p, n] of groups) b.group(p, n);
  // power input: connector, fuse, reverse-polarity diode, TVS, bulk capacitor
  const jin = b.part("pwr_in/j1", "connector", "DC input", [["VIN", "power_out"], ["GND", "ground"]]);
  b.connect("VIN_RAW", b.pin(jin, "VIN"));
  b.connect("GND", b.pin(jin, "GND"));
  b.two("pwr_in/f1", "resistor", "500mA", "VIN_RAW", "VIN_FUSED");
  b.parts.find((p) => p.path === "pwr_in/f1")!.class = "ferrite_bead";
  b.parts.find((p) => p.path === "pwr_in/f1")!.value = "PTC 500mA";
  b.two("pwr_in/d1", "diode", "SS34", "VIN_FUSED", "+5V");
  b.two("pwr_in/tvs1", "diode", "SMBJ5.0A", "GND", "VIN_FUSED");
  b.two("pwr_in/c1", "capacitor", "47uF", "+5V", "GND");
  // LDO
  const ldo = b.part("ldo/u1", "regulator", "3.3 V LDO", [["VIN", "power_in"], ["GND", "ground"], ["EN", "input"], ["VOUT", "power_out"]]);
  b.connect("+5V", b.pin(ldo, "VIN"), b.pin(ldo, "EN"));
  b.connect("GND", b.pin(ldo, "GND"));
  b.connect("+3V3", b.pin(ldo, "VOUT"));
  b.two("ldo/c_in", "capacitor", "1uF", "+5V", "GND");
  b.two("ldo/c_out", "capacitor", "1uF", "+3V3", "GND");
  // battery divider
  b.two("bat/r1", "resistor", "100k", "+5V", "bat/VDIV");
  b.two("bat/r2", "resistor", "100k", "bat/VDIV", "GND");
  b.two("bat/r3", "resistor", "1k", "bat/VDIV", "VSENSE");
  b.two("bat/c1", "capacitor", "100nF", "VSENSE", "GND");
  // USB with ESD array and the differential pair
  const usb = b.part("usb/j1", "connector", "USB micro-B", [["VBUS", "power_out"], ["D-", "passive"], ["D+", "passive"], ["GND", "ground"]]);
  b.connect("VBUS", b.pin(usb, "VBUS"));
  b.connect("GND", b.pin(usb, "GND"));
  b.connect("usb/DM_C", b.pin(usb, "D-"));
  b.connect("usb/DP_C", b.pin(usb, "D+"));
  const esd = b.part("usb/u1", "ic", "ESD array", [["IO1", "passive"], ["GND", "ground"], ["IO2", "passive"], ["VBUS", "power_in"]]);
  b.connect("usb/DM_C", b.pin(esd, "IO1"));
  b.connect("usb/DP_C", b.pin(esd, "IO2"));
  b.connect("GND", b.pin(esd, "GND"));
  b.connect("VBUS", b.pin(esd, "VBUS"));
  b.two("usb/r_dm", "resistor", "22R", "usb/DM_C", "USB_DN");
  b.two("usb/r_dp", "resistor", "22R", "usb/DP_C", "USB_DP");
  b.two("usb/fb1", "ferrite_bead", "600R", "VBUS", "+5V");
  // test points on rails and a signal
  for (const [i, net] of ["+5V", "+3V3", "GND", "VSENSE"].entries()) {
    const t = b.part(`tp/tp${i + 1}`, "connector", "Test point", [["TP", net === "GND" ? "ground" : "passive"]]);
    b.connect(net, `${t}:p1`);
  }
  // microcontroller
  const u = mcuBlock(b, "mcu");
  b.connect("VSENSE", b.pin(u, "PA0"));
  b.connect("USB_DN", b.pin(u, "PA11"));
  b.connect("USB_DP", b.pin(u, "PA12"));
  b.connect("I2C_SCL", b.pin(u, "PB6"));
  b.connect("I2C_SDA", b.pin(u, "PB7"));
  b.connect("TEMP", b.pin(u, "PA1"));
  b.connect("BTN_A", b.pin(u, "PB0"));
  b.connect("BTN_B", b.pin(u, "PB1"));
  b.connect("BUZZ", b.pin(u, "PB2"));
  b.connect("RELAY", b.pin(u, "PB3"));
  b.connect("LED_DATA", b.pin(u, "PB4"));
  b.connect("OUT_A", b.pin(u, "PB5"));
  b.connect("OUT_B", b.pin(u, "PB8"));
  const dbg = b.part("debug/j1", "connector", "Debug header", [["+3V3", "power_in"], ["SWDIO", "passive"], ["SWCLK", "passive"], ["GND", "ground"]]);
  b.connect("+3V3", b.pin(dbg, "+3V3"));
  b.connect("GND", b.pin(dbg, "GND"));
  b.connect("SWDIO", b.pin(dbg, "SWDIO"));
  b.connect("SWCLK", b.pin(dbg, "SWCLK"));
  // two I2C sensors (pull-ups with the IMU)
  for (const g of ["imu", "baro"]) {
    const s = b.part(`${g}/u1`, "ic", g === "imu" ? "6-axis IMU" : "Barometer", [["VDD", "power_in"], ["GND", "ground"], ["SCL", "input"], ["SDA", "io"], ["INT", "output"]]);
    b.connect("+3V3", b.pin(s, "VDD"));
    b.connect("GND", b.pin(s, "GND"));
    b.connect("I2C_SCL", b.pin(s, "SCL"));
    b.connect("I2C_SDA", b.pin(s, "SDA"));
    b.connect(`${g}/INT`, b.pin(s, "INT"));
    b.two(`${g}/c1`, "capacitor", "100nF", "+3V3", "GND");
    b.two(`${g}/r_int`, "resistor", "10k", "+3V3", `${g}/INT`);
  }
  b.two("imu/r_scl", "resistor", "4.7k", "+3V3", "I2C_SCL");
  b.two("imu/r_sda", "resistor", "4.7k", "+3V3", "I2C_SDA");
  // temperature: a thermistor divider
  b.two("temp/r1", "resistor", "10k", "+3V3", "TEMP");
  b.two("temp/rt1", "resistor", "10k", "TEMP", "GND");
  b.two("temp/c1", "capacitor", "100nF", "TEMP", "GND");
  // buttons with pull-ups
  for (const [i, n] of ["BTN_A", "BTN_B"].entries()) {
    b.part(`btn/sw${i + 1}`, "switch", "Tact switch", [["1"], ["2"]]);
    b.connect(n, `btn/sw${i + 1}:p1`);
    b.connect("GND", `btn/sw${i + 1}:p2`);
    b.two(`btn/r${i + 1}`, "resistor", "10k", "+3V3", n);
  }
  // buzzer and relay drivers: one channel each
  for (const g of ["buzzer", "relay"]) {
    const q = b.part(`${g}/q1`, "transistor", "N-MOSFET", [["G", "input"], ["D", "passive"], ["S", "passive"]]);
    b.two(`${g}/rg`, "resistor", "100R", g === "buzzer" ? "BUZZ" : "RELAY", `${g}/GATE`);
    b.connect(`${g}/GATE`, b.pin(q, "G"));
    b.two(`${g}/rpd`, "resistor", "100k", `${g}/GATE`, "GND");
    b.connect("GND", b.pin(q, "S"));
    b.two(`${g}/d_fly`, "diode", "1N4148", `${g}/SW`, "+5V");
    b.connect(`${g}/SW`, b.pin(q, "D"));
    const load = b.part(`${g}/j1`, "connector", g === "buzzer" ? "Buzzer" : "Relay coil", [["+", "passive"], ["-", "passive"]]);
    b.connect("+5V", `${load}:p1`);
    b.connect(`${g}/SW`, `${load}:p2`);
  }
  // the status ring: eight addressable LEDs
  ledChain8("ring", b, "LED_DATA");
  // output header
  const out = b.part("out/j1", "connector", "Output header", [["OUT_A", "passive"], ["OUT_B", "passive"], ["GND", "ground"]]);
  b.two("out/r1", "resistor", "100R", "OUT_A", "out/A");
  b.two("out/r2", "resistor", "100R", "OUT_B", "out/B");
  b.connect("out/A", b.pin(out, "OUT_A"));
  b.connect("out/B", b.pin(out, "OUT_B"));
  b.connect("GND", b.pin(out, "GND"));
  return b.circuit();
}

/** About 160 parts: the fifteen-card board with sixteen more low-side channels (for the layout's time budget). */
export function largeBoard(): SchematicCircuit {
  const c = fifteenCards();
  const b = new Builder("sample-large-board");
  b.parts = [...c.parts];
  for (const n of c.nets) b.nets.set(n.name, { kind: n.kind, pins: new Set(n.pins) });
  b.groups = [...c.groups];
  b.group("channels", "16 output channels");
  for (let i = 0; i < 16; i++) lowSideChannel(b, "channels", i, i < 8 ? `OUT_A` : `OUT_B`);
  return b.circuit();
}

/** Every synthetic circuit by name. */
export const SYNTHETIC: Record<string, () => SchematicCircuit> = { ledDriver16, ledChain8: () => ledChain8(), mcu48, fifteenCards, largeBoard };

/**
 * The code-built families: every part gets a readable symbol from its pin list on day one.
 *
 *   icBox          any part: four sides by pin type, groups kept together (the fallback)
 *   kicadBox       the KiCad export's two-sided rule, for parity with the KiCad symbols it writes
 *   mcu            ports by bank (PA…, PB…, GPIO0-7 …), supplies on top, ground at the bottom, control and clock
 *                  pins left, debug and USB right
 *   module         modules and dev boards: pins in physical order down the left and up the right (DIP order), or
 *                  one header per side
 *   sheet          a hierarchical sheet: inputs left, outputs right, the sheet's name inside
 *   regulator      linear, buck, boost and charger: input and enable left, output and feedback right, ground at
 *                  the bottom (pin roles read from the names when the data has no types)
 *   header         1 x N and 2 x N pin headers (SWD and JTAG are 2 x N with names)
 *   terminalBlock  1 x N screw terminals
 *   usbC, usbMicroB  receptacles with their usual pins, shared contacts as one pin listing every pad
 *   dipSwitch      N positions, pin i opposite pin 2N+1-i, a small switch in each row
 *   servo          the three-wire hobby servo
 *   logicIec       the IEC rectangular gates (the `iec` variant of the drawn gates), pins where the US gates have them
 *   netLabel       a net label whose tag fits its text
 */
import { MARGIN, SCHEMA, UNIT, type BodyElement, type PinType, type SymbolDef } from "../types.ts";
import { buildBox, byGroup, fourSided, isGround, mergeSameName, natural, pinName, twoSided, typeOf, withGaps, type PinInput, type Placement } from "./box.ts";
import { boxIcon, dipIcon, headerIcon, mcuIcon, moduleIcon, regulatorMark, servoIcon, sheetIcon, terminalIcon, usbIcon } from "./icons.ts";

const px = (u: number) => MARGIN + UNIT * u;
const P = (d: string, role: BodyElement["role"] = "body"): BodyElement => ({ el: "path", d, role });

export interface FamilyOptions {
  id?: string;
  name?: string;
  refdes?: string;
}

/** Any part: four sides by pin type (the fallback symbol). */
export function icBox(pins: PinInput[], o: FamilyOptions = {}): SymbolDef {
  const placement = fourSided(pins);
  return buildBox({
    id: o.id ?? "ic",
    name: o.name ?? "IC",
    refdes: o.refdes ?? "U",
    category: "ic",
    placement,
    icon: boxIcon(placement),
    tags: ["ic", "box", "generated"],
    keywords: ["ic"],
  });
}

/** The two-sided box the KiCad export draws (same side rule), for a part that should look the same in both. */
export function kicadBox(pins: PinInput[], o: FamilyOptions = {}): SymbolDef {
  const placement = twoSided(pins);
  return buildBox({ id: o.id ?? "ic-two-sided", name: o.name ?? "IC (KiCad export layout)", refdes: o.refdes ?? "U", category: "ic", placement, icon: boxIcon(placement), tags: ["ic", "box", "generated"], keywords: ["ic"] });
}

// ------------------------------------------------------------------ microcontroller

const CONTROL = /^(N?RST|NRESET|RESET|RST_N|EN|CHIP_PU|CHIP_EN|BOOT\d*|NBOOT\d*|PROG|MODE)$/i;
const CLOCK = /^(XTAL\w*|OSC\w*|XIN\w*|XOUT\w*|X32\w*|XI|XO|CLKIN)$/i;
const DEBUG = /^(SWDIO|SWCLK|SWO|TDI|TDO|TMS|TCK|NTRST|JTAG\w*|UPDI)$/i;
const USB = /^(USB_?)?(D[PM+-]|DP|DM|D_?P|D_?N)$/i;

/** The bank a port pin belongs to (PA3 → "PA", GPIO12 → "IO8-15", P1.4 → "P1"), or undefined. */
export function bankOf(name: string): string | undefined {
  const n = pinName(name).split(/[/_]/)[0];
  let m = /^P([A-Z])(\d+)$/i.exec(n);
  if (m) return `P${m[1].toUpperCase()}`;
  m = /^P(\d+)[._](\d+)$/i.exec(pinName(name));
  if (m) return `P${m[1]}`;
  m = /^(?:GPIO|IO|D)(\d+)$/i.exec(n);
  if (m) {
    const k = Math.floor(Number(m[1]) / 8) * 8;
    return `IO${k}-${k + 7}`;
  }
  return undefined;
}

export function mcu(pinsIn: PinInput[], o: FamilyOptions = {}): SymbolDef {
  const pins = mergeSameName(pinsIn);
  const top = pins.filter((p) => typeOf(p) === "power_in" && !isGround(p));
  const bottom = pins.filter((p) => isGround(p));
  const rest = pins.filter((p) => !top.includes(p) && !bottom.includes(p));
  const name = (p: PinInput) => pinName(p.name).split("/")[0];
  const control = rest.filter((p) => CONTROL.test(name(p)));
  const clock = rest.filter((p) => !control.includes(p) && CLOCK.test(name(p)));
  const debug = rest.filter((p) => DEBUG.test(name(p)));
  const usb = rest.filter((p) => !debug.includes(p) && USB.test(name(p)));
  const special = new Set([...control, ...clock, ...debug, ...usb]);
  const banks = new Map<string, PinInput[]>();
  const other: PinInput[] = [];
  for (const p of rest) {
    if (special.has(p)) continue;
    const b = p.group ?? bankOf(p.name);
    if (!b) other.push(p);
    else {
      if (!banks.has(b)) banks.set(b, []);
      banks.get(b)!.push(p);
    }
  }
  const left: PinInput[][] = [control, clock];
  const right: PinInput[][] = [debug, usb];
  const size = (gs: PinInput[][]) => gs.reduce((n, g) => n + g.length + (g.length ? 1 : 0), 0);
  for (const b of [...banks.keys()].sort(natural)) {
    const g = banks.get(b)!.sort((a, c) => natural(pinName(a.name), pinName(c.name)));
    (size(left) <= size(right) ? left : right).push(g);
  }
  if (other.length) (size(left) <= size(right) ? left : right).push(other);
  const placement: Placement = { left: withGaps(left), right: withGaps(right), top: withGaps([top]), bottom: withGaps([bottom]) };
  return buildBox({ id: o.id ?? "mcu", name: o.name ?? "Microcontroller", refdes: o.refdes ?? "U", category: "ic", placement, icon: mcuIcon(), tags: ["mcu", "microcontroller", "generated"], keywords: ["mcu", "microcontroller"] });
}

// ------------------------------------------------------------------ module, sheet

export function module(pins: PinInput[], o: FamilyOptions & { order?: "dip" | "headers" } = {}): SymbolDef {
  let placement: Placement;
  if ((o.order ?? "dip") === "headers") {
    const left = pins.filter((p) => (p.side ?? "left") === "left");
    const right = pins.filter((p) => p.side === "right");
    placement = { left, right, top: [], bottom: [] };
  } else {
    const half = Math.ceil(pins.length / 2);
    placement = { left: pins.slice(0, half), right: pins.slice(half).reverse(), top: [], bottom: [] };
  }
  return buildBox({ id: o.id ?? "module", name: o.name ?? "Module or dev board", refdes: o.refdes ?? "A", category: "module", placement, minWidth: 6, icon: moduleIcon(), tags: ["module", "dev board", "generated"], keywords: ["module", "dev board", "breakout"], notes: "Pins in physical order: down the left, up the right (DIP numbering)." });
}

export function sheet(title: string, ports: PinInput[], o: FamilyOptions = {}): SymbolDef {
  const left = ports.filter((p) => !["output", "open_collector", "power_out"].includes(typeOf(p)));
  const right = ports.filter((p) => left.indexOf(p) < 0);
  const placement: Placement = { left: withGaps(byGroup(left)), right: withGaps(byGroup(right)), top: [], bottom: [] };
  return buildBox({ id: o.id ?? "sheet", name: o.name ?? `Sheet: ${title}`, refdes: o.refdes ?? "#SHEET", category: "sheet", placement, title, numbers: false, minWidth: 6, icon: sheetIcon(), tags: ["sheet", "hierarchical", "generated"], keywords: ["sheet", "subsheet", "block"] });
}

// ------------------------------------------------------------------ regulators

export type RegulatorKind = "linear" | "buck" | "boost" | "charger";
const REG_IN = /^(V?IN\d*|PVIN|AVIN|VCC|VBUS|VDD|VS|VIN_\w+)$/i;
const REG_OUT = /^(V?OUT\d*|VO|SW\d*|LX\d*|BAT|VBAT|BATT|SYS|VSYS)$/i;
const REG_RIGHT = /^(FB|ADJ|SENSE|VSENSE|BST|BOOT|CB|BS|PG|PGOOD|POK|STAT\d*|CHRG|STDBY|NCHG|FLT|NFAULT|ISENSE|CSP|CSN)$/i;
const REG_CTRL = /^(N?EN|ON|N?SHDN|CE|NCE|MODE|SYNC|RT|SS|TR|PROG|ISET|ILIM|TS|NTC|TEMP|TIMER|COMP)$/i;

/** Pin roles a regulator's names imply, for data without types. */
export function regulatorPins(pins: PinInput[]): PinInput[] {
  return pins.map((p) => {
    const n = pinName(p.name);
    const q: PinInput = { ...p };
    if (isGround(p)) q.side = "bottom";
    else if (REG_IN.test(n)) (q.type ??= "power_in"), (q.side = "left");
    else if (REG_OUT.test(n)) (q.type ??= /^(SW|LX)/i.test(n) ? "output" : "power_out"), (q.side = "right");
    else if (REG_RIGHT.test(n)) (q.type ??= /^(PG|PGOOD|POK|STAT|CHRG|STDBY|NCHG|FLT|NFAULT)/i.test(n) ? "open_collector" : /^(BST|BOOT|CB|BS)$/i.test(n) ? "passive" : "input"), (q.side = "right");
    else if (REG_CTRL.test(n)) (q.type ??= "input"), (q.side = "left");
    return q;
  });
}

const REG_NAMES: Record<RegulatorKind, string> = { linear: "Linear regulator (LDO)", buck: "Buck converter", boost: "Boost converter", charger: "Battery charger" };

export function regulator(kind: RegulatorKind, pinsIn: PinInput[], o: FamilyOptions = {}): SymbolDef {
  const pins = mergeSameName(regulatorPins(pinsIn));
  const order = (side: string, rx: RegExp[]) => {
    const on = pins.filter((p) => p.side === side);
    const rank = (p: PinInput) => {
      const i = rx.findIndex((r) => r.test(pinName(p.name)));
      return i < 0 ? rx.length : i;
    };
    return on.sort((a, b) => rank(a) - rank(b));
  };
  const left = order("left", [REG_IN, /^N?EN|ON|CE|SHDN/i, REG_CTRL]);
  const right = order("right", [REG_OUT, /^(BST|BOOT|CB|BS)$/i, /^(FB|ADJ|SENSE)/i, /^(PG|STAT|CHRG|STDBY)/i]);
  const bottom = pins.filter((p) => p.side === "bottom");
  const unplaced = pins.filter((p) => !p.side);
  for (const p of unplaced) (left.length <= right.length ? left : right).push(p);
  const placement: Placement = { left, right, top: [], bottom };
  return buildBox({
    id: o.id ?? `regulator-${kind}`,
    name: o.name ?? REG_NAMES[kind],
    refdes: o.refdes ?? "U",
    category: "ic",
    placement,
    minWidth: 4,
    icon: boxIcon(placement, regulatorMark()),
    tags: ["regulator", kind, "power", "generated"],
    keywords: [kind === "linear" ? "ldo" : kind, "regulator"],
    notes: "Input and enable left, output and feedback right, ground at the bottom.",
  });
}

// ------------------------------------------------------------------ connectors

/** A 1 x N header (`rows`), pins on the left (they face the circuit when the connector sits at the sheet's right edge). */
export function header(n: number, o: FamilyOptions & { names?: string[]; side?: "left" | "right" } = {}): SymbolDef {
  const pins: PinInput[] = Array.from({ length: n }, (_, i) => ({ name: o.names?.[i] ?? String(i + 1), number: String(i + 1), type: "passive" }));
  const side = o.side ?? "left";
  const placement: Placement = { left: side === "left" ? pins : [], right: side === "right" ? pins : [], top: [], bottom: [] };
  return buildBox({
    id: o.id ?? `header-1x${n}`,
    name: o.name ?? `Pin header 1 x ${n}`,
    refdes: o.refdes ?? "J",
    category: "connector",
    placement,
    names: !!o.names,
    minWidth: 2,
    inside: (b, rows) => (side === "left" ? rows.left : rows.right).flatMap((y) => (y === null ? [] : [P(side === "left" ? `M${b.x0} ${y}h2` : `M${b.x1} ${y}h-2`)])),
    icon: headerIcon(),
    tags: ["header", "connector", "generated"],
    keywords: ["header", "pin header", "jst", "dupont"],
  });
}

/** A 2 x N header: odd pins left, even pins right (the usual odd/even numbering); SWD and JTAG pass names. */
export function header2(rows: number, o: FamilyOptions & { names?: string[] } = {}): SymbolDef {
  const pin = (k: number): PinInput => ({ name: o.names?.[k - 1] ?? String(k), number: String(k), type: "passive" });
  const left = Array.from({ length: rows }, (_, i) => pin(2 * i + 1));
  const right = Array.from({ length: rows }, (_, i) => pin(2 * i + 2));
  const placement: Placement = { left, right, top: [], bottom: [] };
  return buildBox({
    id: o.id ?? `header-2x${rows}`,
    name: o.name ?? `Pin header 2 x ${rows}`,
    refdes: o.refdes ?? "J",
    category: "connector",
    placement,
    names: !!o.names,
    minWidth: 2,
    icon: headerIcon(),
    tags: ["header", "connector", "generated"],
    keywords: ["header", "2x", "idc", "swd", "jtag"],
  });
}

/** 1 x N screw terminal block: a screw head (circle with a slot) in each row. */
export function terminalBlock(n: number, o: FamilyOptions = {}): SymbolDef {
  const pins: PinInput[] = Array.from({ length: n }, (_, i) => ({ name: String(i + 1), number: String(i + 1), type: "passive" }));
  const placement: Placement = { left: pins, right: [], top: [], bottom: [] };
  return buildBox({
    id: o.id ?? `terminal-block-1x${n}`,
    name: o.name ?? `Screw terminal 1 x ${n}`,
    refdes: o.refdes ?? "J",
    category: "connector",
    placement,
    names: false,
    minWidth: 2,
    inside: (b, rows) =>
      rows.left.flatMap((y) => (y === null ? [] : [{ el: "circle", cx: b.x0 + 5, cy: y, r: 1.5, role: "body" } as BodyElement, P(`M${b.x0 + 4} ${y + 1}l2-2`)])),
    icon: terminalIcon(),
    tags: ["terminal block", "screw terminal", "connector", "generated"],
    keywords: ["terminal block", "screw terminal", "kf301"],
  });
}

/** USB-C receptacle, USB 2.0 (16 pin): shared contacts are one pin listing all pads; power, configuration, data and sideband grouped. */
export function usbC(o: FamilyOptions = {}): SymbolDef {
  const pins: PinInput[] = [
    { name: "VBUS", pads: ["A4", "A9", "B4", "B9"], type: "power_in", group: "power" },
    { name: "CC1", number: "A5", type: "bidirectional", group: "config" },
    { name: "CC2", number: "B5", type: "bidirectional", group: "config" },
    { name: "D+", pads: ["A6", "B6"], type: "bidirectional", group: "data" },
    { name: "D-", pads: ["A7", "B7"], type: "bidirectional", group: "data" },
    { name: "SBU1", number: "A8", type: "bidirectional", group: "sideband" },
    { name: "SBU2", number: "B8", type: "bidirectional", group: "sideband" },
    { name: "GND", pads: ["A1", "A12", "B1", "B12"], type: "passive", ground: true },
    { name: "SHIELD", number: "S1", type: "passive", ground: true },
  ];
  return connectorOneSide(pins, { id: o.id ?? "usb-c-receptacle", name: o.name ?? "USB-C receptacle (USB 2.0)", refdes: o.refdes ?? "J" }, usbIcon(), ["usb-c", "type-c", "usb"]);
}

/** USB micro-B receptacle. */
export function usbMicroB(o: FamilyOptions = {}): SymbolDef {
  const pins: PinInput[] = [
    { name: "VBUS", number: "1", type: "power_in", group: "power" },
    { name: "D-", number: "2", type: "bidirectional", group: "data" },
    { name: "D+", number: "3", type: "bidirectional", group: "data" },
    { name: "ID", number: "4", type: "passive", group: "id" },
    { name: "GND", number: "5", type: "passive", ground: true },
    { name: "SHIELD", number: "6", type: "passive", ground: true },
  ];
  return connectorOneSide(pins, { id: o.id ?? "usb-micro-b-receptacle", name: o.name ?? "USB micro-B receptacle", refdes: o.refdes ?? "J" }, usbIcon(), ["micro usb", "usb"]);
}

/** A connector with its signals on one side (grouped) and ground and shield at the bottom. */
export function connectorOneSide(pins: PinInput[], o: Required<Pick<FamilyOptions, "id" | "name" | "refdes">>, icon: BodyElement[], keywords: string[], side: "left" | "right" = "right"): SymbolDef {
  const sig = pins.filter((p) => !isGround(p));
  const gnd = pins.filter((p) => isGround(p));
  const slots = withGaps(byGroup(sig));
  const placement: Placement = { left: side === "left" ? slots : [], right: side === "right" ? slots : [], top: [], bottom: gnd };
  return buildBox({ ...o, category: "connector", placement, minWidth: 4, icon, tags: ["connector", "generated", ...keywords], keywords });
}

// ------------------------------------------------------------------ switches, servo

/** N-position DIP switch: pin i on the left faces pin 2N+1-i on the right, a small open switch in each row. */
export function dipSwitch(n: number, o: FamilyOptions = {}): SymbolDef {
  const left = Array.from({ length: n }, (_, i): PinInput => ({ name: String(i + 1), number: String(i + 1), type: "passive" }));
  const right = Array.from({ length: n }, (_, i): PinInput => ({ name: String(2 * n - i), number: String(2 * n - i), type: "passive" }));
  const placement: Placement = { left, right, top: [], bottom: [] };
  return buildBox({
    id: o.id ?? `dip-switch-${n}`,
    name: o.name ?? `DIP switch, ${n} position`,
    refdes: o.refdes ?? "SW",
    category: "connector",
    placement,
    names: false,
    minWidth: 3,
    inside: (b, rows) =>
      rows.left.flatMap((y) => {
        if (y === null) return [];
        const xl = b.x0 + 4;
        const xr = b.x1 - 4;
        return [P(`M${b.x0} ${y}h3`), { el: "circle", cx: xl, cy: y, r: 1, role: "body" } as BodyElement, { el: "circle", cx: xr, cy: y, r: 1, role: "body" } as BodyElement, P(`M${xl + 0.7} ${y - 0.7}L${xr - 1} ${y - 2.5}`), P(`M${b.x1} ${y}h-3`)];
      }),
    icon: dipIcon(),
    tags: ["dip switch", "switch", "generated"],
    keywords: ["dip switch", "config switch"],
  });
}

/** Hobby servo: signal, supply and ground on the left. */
export function servo(o: FamilyOptions = {}): SymbolDef {
  const pins: PinInput[] = [
    { name: "PWM", number: "1", type: "input" },
    { name: "V+", number: "2", type: "power_in" },
    { name: "GND", number: "3", type: "power_in", ground: true },
  ];
  const placement: Placement = { left: pins, right: [], top: [], bottom: [] };
  return buildBox({
    id: o.id ?? "servo",
    name: o.name ?? "Hobby servo",
    refdes: o.refdes ?? "M",
    category: "connector",
    placement,
    minWidth: 5,
    inside: (b) => {
      const cx = b.x1 - 6;
      const cy = (b.y0 + b.y1) / 2;
      return [{ el: "circle", cx, cy, r: 4, role: "body" } as BodyElement, P(`M${cx - 1.5} ${cy + 1.5}v-3l1.5 1.8 1.5-1.8v3`)];
    },
    icon: servoIcon(),
    tags: ["servo", "motor", "generated"],
    keywords: ["servo", "sg90", "mg996r"],
  });
}

// ------------------------------------------------------------------ IEC logic, net label

const QUALIFIER: Record<string, string> = { and: "&", or: "≥1", xor: "=1", buffer: "1", schmitt: "1" };

/**
 * IEC 60617-12 rectangular gate: a box with the function's qualifier, the inversion as a circle on the output. Pins
 * sit where the drawn US gate has them (24 px frame: inputs at rows 1 and 3, or row 2 alone; output at row 2), so
 * switching convention never moves a wire.
 */
export function logicIec(fn: keyof typeof QUALIFIER, inputs: 1 | 2, invert: boolean, o: FamilyOptions = {}): SymbolDef {
  const ins = inputs === 1 ? [{ id: "A", row: 2 }] : [{ id: "A", row: 1 }, { id: "B", row: 3 }];
  const body: BodyElement[] = [{ el: "rect", x: 5, y: 4, width: 11, height: 16, rx: 1, role: "body" }];
  for (const i of ins) body.push({ el: "path", d: `M2 ${px(i.row)}h3`, role: "lead", pin: i.id });
  body.push({ el: "text", x: 10.5, y: 9, text: QUALIFIER[fn], anchor: "middle", size: 4, role: "label" });
  if (fn === "schmitt") body.push({ el: "path", d: "M8 16h3v-3h1.5M9.5 16v-3H8", role: "mark" });
  if (invert) body.push({ el: "circle", cx: 18, cy: 12, r: 2, role: "body" }, { el: "path", d: "M22 12h-2", role: "lead", pin: "Y" });
  else body.push({ el: "path", d: "M22 12h-6", role: "lead", pin: "Y" });
  const pinType: PinType = "input";
  return {
    schema: SCHEMA,
    id: o.id ?? `gate-${invert && fn !== "schmitt" ? "n" : ""}${fn}-iec`,
    name: o.name ?? `IEC ${fn} gate${invert ? ", inverted output" : ""}`,
    category: "logic",
    refdes: o.refdes ?? "U",
    convention: "iec",
    origin: "generated",
    frame: { w: 24, h: 24 },
    pins: [...ins.map((i) => ({ id: i.id, name: i.id, at: [0, i.row] as [number, number], dir: "left" as const, type: pinType })), { id: "Y", name: "Y", at: [4, 2], dir: "right", type: "output" }],
    body,
    variants: {},
    fields: { refdes: { at: [4.3, 1.6], anchor: "start" }, value: { at: [4.3, 2.4], anchor: "start" } },
    icon: { from: "body", omitRoles: ["mark"] },
    tags: ["logic", fn, "iec", "generated"],
    match: { keywords: [`${fn} gate`] },
    license: "Apache-2.0",
    provenance: { author: "Protoboard symbol generator", date: "2026-11-09", basis: "IEC 60617-12 rectangular form, built by packages/symbols/src/generate", review: "draft" },
  };
}

/** A net label whose pill fits its text; the pin is the label's left end. */
export function netLabel(text: string): SymbolDef {
  const tw = text.length * 3 * 0.6 + 5;
  const units = Math.max(2, Math.ceil((tw + 3) / UNIT));
  const w = 4 + UNIT * units;
  const right = w - MARGIN - 1;
  return {
    schema: SCHEMA,
    id: "net-label",
    name: `Net label ${text}`,
    category: "net",
    refdes: "#NET",
    convention: "common",
    origin: "generated",
    frame: { w, h: 14 },
    pins: [{ id: "1", name: text, at: [0, 1], dir: "left", type: "passive" }],
    body: [
      { el: "path", d: "M2 7h2", role: "lead", pin: "1" },
      { el: "rect", x: 4, y: 3, width: right - 4, height: 8, rx: 4, role: "body" },
      { el: "text", x: 4 + (right - 4) / 2, y: 8.1, text, anchor: "middle", size: 3, role: "label" },
    ],
    variants: {},
    fields: { refdes: { at: [0, 0], anchor: "start" }, value: { at: [0, 0], anchor: "start" } },
    icon: { from: "pack:net-label", omitRoles: [] },
    tags: ["net", "label", "generated"],
    match: { keywords: ["net label"] },
    license: "Apache-2.0",
    provenance: { author: "Protoboard symbol generator", date: "2026-11-09", basis: "sized to its text by packages/symbols/src/generate", review: "draft" },
  };
}

/** Generators a drawn symbol's variant may name (`variants.iec.generator`). */
export const VARIANT_GENERATORS: Record<string, (args: Record<string, unknown>) => SymbolDef> = {
  "logic-iec": (a) => logicIec(a.fn as keyof typeof QUALIFIER, a.inputs as 1 | 2, !!a.invert),
};

/** A drawn symbol's generated variant, built. */
export function buildVariant(def: SymbolDef, variant: string): SymbolDef {
  const g = def.variants[variant]?.generator;
  if (!g) throw new Error(`${def.id}[${variant}] is not a generated variant`);
  const make = VARIANT_GENERATORS[g.name];
  if (!make) throw new Error(`unknown generator ${g.name}`);
  return make(g.args);
}

/**
 * The box engine every code-built symbol uses: a body rectangle, pins on its sides at whole grid units, a lead of
 * at least one unit per pin, names inside the body and numbers on the leads, groups separated by a blank row. The
 * output is an ordinary `protoboard.symbol/v0` definition (origin `generated`) that the checker accepts.
 *
 * The side rules come from the stack's KiCad export (ext-tscircuit lib/kicad/schematic.ts, `sides()` and
 * `pinName()`), mirrored here so the export keeps working unchanged: `twoSided` is that rule exactly; `fourSided`
 * adds the readability rule of lane 21 (supply pins on top, ground at the bottom).
 */
import { MARGIN, SCHEMA, UNIT, type BodyElement, type Category, type PinType, type SymbolDef, type SymbolPin } from "../types.ts";

export type Side = "left" | "right" | "top" | "bottom";

/** A part's pin as the generator takes it (from UHD pin data, a datasheet table or a test). */
export interface PinInput {
  name: string;
  /** Pad number; when several pads share the pin, list them in `pads` (the first is shown first). */
  number?: string;
  pads?: string[];
  type?: PinType;
  /** A ground pin (UHD pin kind `ground`); otherwise inferred from the name. */
  ground?: boolean;
  /** Function group: I2C, SPI, USB, Port A … */
  group?: string;
  /** Force a side. */
  side?: Side;
}

/** A side's pins top to bottom (left, right) or left to right (top, bottom); null is a blank row between groups. */
export type Slot = PinInput | null;
export interface Placement {
  left: Slot[];
  right: Slot[];
  top: Slot[];
  bottom: Slot[];
}

const px = (u: number) => MARGIN + UNIT * u;
const NAME_SIZE = 2.5; // 0.5 unit: KiCad's 1.27 mm on a 2.54 mm grid
const NUM_SIZE = 2;
const CHAR = 0.6; // monospace advance per font size
const nameW = (s: string) => s.length * NAME_SIZE * CHAR;
const numW = (s: string) => s.length * NUM_SIZE * CHAR;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A pin name as KiCad shows it: the model's name, a note in brackets dropped, spaces joined (mirror of the KiCad export's `pinName`). */
export function pinName(name: string): string {
  let n = name.trim();
  const bracket = n.indexOf(" (");
  if (bracket > 0) n = n.slice(0, bracket);
  n = n.replace(/\s+/g, "_");
  if (/^~/.test(n) || /[~^_]\{/.test(n)) n = n.replace(/([~^_])\{/g, "$1(").replace(/^~/, "-");
  return n || "~";
}

/** Natural order: PA2 before PA10. */
export const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const GROUND = /^(A|D|P|S)?GND\d*$|^VSS[A-Z]?\d*$|^(EP|EPAD|PAD|THERMAL|EXPOSED_PAD)$|^0V$/i;
const SUPPLY = /^(V(CC|DD|IN|BUS|BAT|SYS|IO|DDA|DDIO|CCA|REF)|AVDD|DVDD|PVIN|IN|3V3|5V|VS|V\+|VCC\d*|VDD\d*|VDD_[A-Z0-9]+|VCC_[A-Z0-9]+)$/i;
const OUTPUT_SUPPLY = /^(VOUT|OUT|VO|SW|LX|BAT|VBAT_OUT|V3V3_OUT)$/i;

/** The pin's ground-ness: the flag, else its name. */
export const isGround = (p: PinInput) => p.ground ?? GROUND.test(pinName(p.name));

/** A pin's type: the given one, else from its name (supply and ground names), else passive. */
export function typeOf(p: PinInput): PinType {
  if (p.type) return p.type;
  const n = pinName(p.name);
  if (isGround(p)) return "power_in";
  if (/^N\.?C\.?$|^DNC$/i.test(n)) return "no_connect";
  if (SUPPLY.test(n)) return "power_in";
  return "passive";
}

/** Pins of one name and a power type become one symbol pin listing all their pads (four GND pads, one GND pin). */
export function mergeSameName(pins: PinInput[]): PinInput[] {
  const out: PinInput[] = [];
  const seen = new Map<string, PinInput>();
  for (const p of pins) {
    const t = typeOf(p);
    const key = pinName(p.name).toUpperCase();
    const merge = t === "power_in" || t === "power_out" || isGround(p);
    const prev = merge ? seen.get(key) : undefined;
    if (prev) {
      prev.pads = [...(prev.pads ?? (prev.number ? [prev.number] : [])), ...(p.pads ?? (p.number ? [p.number] : []))];
      continue;
    }
    const copy = { ...p, pads: p.pads ? [...p.pads] : undefined };
    out.push(copy);
    if (merge) seen.set(key, copy);
  }
  for (const p of out) if (p.pads && p.pads.length > 1) p.pads.sort(natural);
  return out;
}

/** Lay groups out on a side: each group's pins together, a blank row between groups. */
export function withGaps(groups: PinInput[][]): Slot[] {
  const out: Slot[] = [];
  for (const g of groups.filter((g) => g.length)) {
    if (out.length) out.push(null);
    out.push(...g);
  }
  return out;
}

/** Pins grouped by `group`, in first-seen order (ungrouped pins form one group). */
export function byGroup(pins: PinInput[]): PinInput[][] {
  const order: string[] = [];
  const map = new Map<string, PinInput[]>();
  for (const p of pins) {
    const g = p.group ?? "";
    if (!map.has(g)) (map.set(g, []), order.push(g));
    map.get(g)!.push(p);
  }
  return order.map((g) => map.get(g)!);
}

/**
 * The KiCad export's rule (`sides()` in ext-tscircuit lib/kicad/schematic.ts), mirrored: supplies and inputs left,
 * supply outputs and outputs right, the rest (bidirectional, passive, no-connect) on the shorter side in pad order,
 * ground at the bottom of the left side, and the two sides kept within two pins of each other.
 */
export function twoSided(pins: PinInput[]): Placement {
  const t = (p: PinInput) => typeOf(p);
  const supply = pins.filter((p) => t(p) === "power_in" && !isGround(p));
  const out = pins.filter((p) => t(p) === "power_out");
  const ins = pins.filter((p) => t(p) === "input");
  const outs = pins.filter((p) => t(p) === "output" || t(p) === "open_collector");
  const ground = pins.filter((p) => isGround(p));
  const rest = pins.filter((p) => ![supply, out, ins, outs, ground].some((s) => s.includes(p)));
  const left = [...supply, ...ins];
  const right = [...out, ...outs];
  for (const p of rest) (left.length + ground.length <= right.length ? left : right).push(p);
  left.push(...ground);
  while (left.length - right.length > 2 && left.length > ground.length) right.push(left.splice(left.length - ground.length - 1, 1)[0]);
  while (right.length - left.length > 2) left.splice(left.length - ground.length, 0, right.pop()!);
  return { left, right, top: [], bottom: [] };
}

/**
 * Four sides (lane 21, rule C26): supply inputs on top, ground at the bottom, inputs left, outputs and supply
 * outputs right, the rest balanced. Function groups stay together with a blank row between them; a group goes
 * right when its pins are all outputs, else to the shorter side.
 */
export function fourSided(pinsIn: PinInput[], opts: { merge?: boolean } = {}): Placement {
  const pins = opts.merge === false ? pinsIn : mergeSameName(pinsIn);
  const forced = (s: Side) => pins.filter((p) => p.side === s);
  const free = pins.filter((p) => !p.side);
  const top = [...forced("top"), ...free.filter((p) => typeOf(p) === "power_in" && !isGround(p))];
  const bottom = [...forced("bottom"), ...free.filter((p) => isGround(p))];
  const sideable = free.filter((p) => !top.includes(p) && !bottom.includes(p));
  const leftGroups: PinInput[][] = [forced("left")];
  const rightGroups: PinInput[][] = [forced("right")];
  const count = (gs: PinInput[][]) => gs.reduce((n, g) => n + g.length + (g.length ? 1 : 0), 0);
  const ungrouped = sideable.filter((p) => !p.group);
  const isOut = (p: PinInput) => ["output", "open_collector", "power_out"].includes(typeOf(p));
  rightGroups.push(ungrouped.filter(isOut));
  leftGroups.push(ungrouped.filter((p) => typeOf(p) === "input"));
  const rest = ungrouped.filter((p) => !isOut(p) && typeOf(p) !== "input");
  const restL: PinInput[] = [];
  const restR: PinInput[] = [];
  for (const p of rest) (count(leftGroups) + restL.length <= count(rightGroups) + restR.length ? restL : restR).push(p);
  leftGroups.push(restL);
  rightGroups.push(restR);
  for (const g of byGroup(sideable.filter((p) => p.group))) {
    if (g.every(isOut)) rightGroups.push(g);
    else (count(leftGroups) <= count(rightGroups) ? leftGroups : rightGroups).push(g);
  }
  return { left: withGaps(leftGroups), right: withGaps(rightGroups), top: withGaps([top]), bottom: withGaps([bottom]) };
}

export interface BoxSpec {
  id: string;
  name: string;
  refdes: string;
  category: Category;
  placement: Placement;
  /** Text inside the body at the top (a sheet's name, an IEC qualifier). */
  title?: string;
  /** Minimum body width, grid units. */
  minWidth?: number;
  /** Show pin names inside the body (default true). */
  names?: boolean;
  /** Show pad numbers on the leads (default true). */
  numbers?: boolean;
  /** Extra drawing in the body, given the body's box in frame px and each side pin's y. */
  inside?: (box: { x0: number; y0: number; x1: number; y1: number }, rows: { left: (number | null)[]; right: (number | null)[] }) => BodyElement[];
  /** The 24 px icon drawing. */
  icon: BodyElement[];
  tags: string[];
  keywords: string[];
  notes?: string;
}

/** Build the symbol definition for a box. */
export function buildBox(spec: BoxSpec): SymbolDef {
  const { left, right, top, bottom } = spec.placement;
  const showNames = spec.names !== false;
  const showNums = spec.numbers !== false;
  const label = (p: PinInput) => pinName(p.name);
  const numText = (p: PinInput) => (p.pads?.length ? p.pads.join(" ") : (p.number ?? ""));
  const pinsOf = (s: Slot[]) => s.filter((p): p is PinInput => !!p);
  const maxNum = (s: Slot[]) => Math.max(0, ...pinsOf(s).map((p) => (showNums ? numW(numText(p)) : 0)));
  const maxName = (s: Slot[]) => Math.max(0, ...pinsOf(s).map((p) => (showNames ? nameW(label(p)) : 0)));
  // leads: one unit, longer when a pad list needs the room
  const leadL = Math.max(1, Math.ceil((maxNum(left) + 1.5) / UNIT));
  const leadR = Math.max(1, Math.ceil((maxNum(right) + 1.5) / UNIT));
  const rows = Math.max(left.length, right.length, 1);
  const tPins = pinsOf(top).length ? top : [];
  const bPins = pinsOf(bottom).length ? bottom : [];
  const spanTB = Math.max(tPins.length, bPins.length);
  // top and bottom pins: names sit inside the body, numbers beside the lead; both set the pitch
  const tbW = (p: PinInput) => Math.max(showNames ? nameW(label(p)) : 0, showNums ? 2 * (numW(numText(p)) + 0.8) : 0);
  const topNameW = Math.max(0, ...pinsOf(top).map(tbW), ...pinsOf(bottom).map(tbW));
  const pitchTB = Math.max(2, Math.ceil((topNameW + 2) / UNIT));
  const sideText = maxName(left) + maxName(right) + 2 * 1.5 + (left.length && right.length ? 4 : 0);
  const titleW = spec.title ? spec.title.length * 3 * CHAR + 3 : 0;
  const width = Math.max(spec.minWidth ?? 2, Math.ceil(sideText / UNIT), Math.ceil(titleW / UNIT), spanTB ? (spanTB - 1) * pitchTB + 2 : 0);
  const bL = left.length ? leadL : 1;
  const bR = bL + width;
  const cmax = bR + (right.length ? leadR : 1);
  const bT = 1;
  const titleRows = spec.title ? 1 : 0;
  // a row for the top pins' names, and one for the bottom pins' names, so they never sit beside a side pin's name
  const row0 = bT + 1 + titleRows + (tPins.length && showNames ? 1 : 0);
  const bB = row0 + rows + (bPins.length && showNames ? 1 : 0);
  const rmax = bB + 1;
  const frame = { w: px(cmax) + MARGIN, h: px(rmax) + MARGIN };

  const pins: SymbolPin[] = [];
  const body: BodyElement[] = [];
  const ids = new Set<string>();
  const idFor = (p: PinInput) => {
    let base = (p.number ?? pinName(p.name)).replace(/[^A-Za-z0-9+\-_~]/g, "_") || "P";
    let id = base;
    for (let k = 2; ids.has(id); k++) id = `${base}_${k}`;
    ids.add(id);
    return id;
  };
  const x0 = px(bL);
  const x1 = px(bR);
  const y0 = px(bT);
  const y1 = px(bB);
  body.push({ el: "rect", x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 1, role: "body" });
  if (spec.title) body.push({ el: "text", x: r3((x0 + x1) / 2), y: r3(y0 + 4), text: spec.title, anchor: "middle", size: 3, role: "label" });

  const place = (p: PinInput, at: [number, number], dir: SymbolPin["dir"]) => {
    const id = idFor(p);
    const pin: SymbolPin = { id, name: label(p), at, dir, type: typeOf(p) };
    if (p.number) pin.number = p.number;
    if (p.pads?.length) pin.pads = [...p.pads];
    if (p.group) pin.group = p.group;
    pins.push(pin);
    const [x, y] = [px(at[0]), px(at[1])];
    const end = dir === "left" ? `h${x0 - x}` : dir === "right" ? `h${x1 - x}` : dir === "up" ? `v${y0 - y}` : `v${y1 - y}`;
    body.push({ el: "path", d: `M${x} ${y}${end}`, role: "lead", pin: id });
    const nm = label(p);
    const num = numText(p);
    if (dir === "left") {
      if (showNames) body.push({ el: "text", x: r3(x0 + 1.2), y: r3(y + 0.9), text: nm, anchor: "start", size: NAME_SIZE, role: "pin-name" });
      if (showNums && num) body.push({ el: "text", x: r3(x0 - 0.8), y: r3(y - 0.7), text: num, anchor: "end", size: NUM_SIZE, role: "pin-number" });
    } else if (dir === "right") {
      if (showNames) body.push({ el: "text", x: r3(x1 - 1.2), y: r3(y + 0.9), text: nm, anchor: "end", size: NAME_SIZE, role: "pin-name" });
      if (showNums && num) body.push({ el: "text", x: r3(x1 + 0.8), y: r3(y - 0.7), text: num, anchor: "start", size: NUM_SIZE, role: "pin-number" });
    } else if (dir === "up") {
      if (showNames) body.push({ el: "text", x, y: r3(y0 + 3.2), text: nm, anchor: "middle", size: NAME_SIZE, role: "pin-name" });
      if (showNums && num) body.push({ el: "text", x: r3(x + 0.8), y: r3(y0 - 1.2), text: num, anchor: "start", size: NUM_SIZE, role: "pin-number" });
    } else {
      if (showNames) body.push({ el: "text", x, y: r3(y1 - 1.2), text: nm, anchor: "middle", size: NAME_SIZE, role: "pin-name" });
      if (showNums && num) body.push({ el: "text", x: r3(x + 0.8), y: r3(y1 + 2.6), text: num, anchor: "start", size: NUM_SIZE, role: "pin-number" });
    }
  };
  const rowsY = { left: [] as (number | null)[], right: [] as (number | null)[] };
  left.forEach((p, i) => {
    rowsY.left.push(p ? px(row0 + i) : null);
    if (p) place(p, [0, row0 + i], "left");
  });
  right.forEach((p, i) => {
    rowsY.right.push(p ? px(row0 + i) : null);
    if (p) place(p, [cmax, row0 + i], "right");
  });
  const tbStart = (n: number) => bL + Math.floor((width - (n - 1) * pitchTB) / 2);
  tPins.forEach((p, i) => p && place(p, [tbStart(tPins.length) + i * pitchTB, 0], "up"));
  bPins.forEach((p, i) => p && place(p, [tbStart(bPins.length) + i * pitchTB, rmax], "down"));
  if (spec.inside) body.push(...spec.inside({ x0, y0, x1, y1 }, rowsY));

  return {
    schema: SCHEMA,
    id: spec.id,
    name: spec.name,
    category: spec.category,
    refdes: spec.refdes,
    convention: "common",
    origin: "generated",
    frame,
    pins,
    body,
    variants: { icon: { name: "Icon", frame: { w: 24, h: 24 }, pins: [], body: spec.icon } },
    fields: { refdes: { at: [bL, 0.4], anchor: "start" }, value: { at: [bL, rmax - 0.2], anchor: "start" } },
    icon: { from: "icon", omitRoles: [] },
    tags: spec.tags,
    match: { keywords: spec.keywords },
    license: "Apache-2.0",
    provenance: { author: "Protoboard symbol generator", date: "2026-11-09", basis: "built from pin data by packages/symbols/src/generate", review: "draft" },
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
}

/**
 * Symbol resolution (contract section 6): the pack symbol for a part's class and variant when every pin binds,
 * else a code-built box from the part's pin data. The result carries the binding from part pins to symbol pins,
 * and the symbol's boxes in lattice units.
 */
import { connectorOneSide, icBox, mcu, pinName, regulator, MARGIN, UNIT, type BodyElement, type PinInput, type PinType, type SymbolDef, type SymbolPin } from "@protoboardai/symbols";
import { readPack } from "@protoboardai/symbols/pack";
import { elementPolylines } from "../../symbols/src/geometry.ts";
import type { CircuitPart, CircuitPin, PartClass } from "./circuit.ts";
import type { Dir, XY } from "./units.ts";

export interface LBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ResolvedSymbol {
  /** `pack:<id>` or the generator family (`box`, `mcu`, `regulator`). */
  family: string;
  def: SymbolDef;
  /** The variant whose geometry is used (pins and frame are the same for every drawn variant of a two-terminal part). */
  variant?: string;
  frame: { w: number; h: number };
  pins: SymbolPin[];
  body: BodyElement[];
  /** part pin id -> symbol pin id */
  binding: ReadonlyMap<string, string>;
  /** symbol pin id -> part pin ids bound to it (several pads on one symbol pin) */
  members: ReadonlyMap<string, string[]>;
  /** Body box in lattice units (no leads, no pad numbers). */
  body_box: LBox;
  /** Everything, leads included. */
  full_box: LBox;
}

let pack: Map<string, SymbolDef> | undefined;
/** The drawn pack by id (read once). */
export function packSymbols(): Map<string, SymbolDef> {
  if (!pack) pack = new Map(readPack().map((f) => [f.def.id, f.def]));
  return pack;
}

/** The pack symbol each class uses. */
export const PACK_FOR_CLASS: Partial<Record<PartClass, string>> = {
  resistor: "resistor",
  capacitor: "capacitor",
  inductor: "inductor",
  ferrite_bead: "ferrite-bead",
  led: "led",
  diode: "diode",
  switch: "pushbutton",
  crystal: "crystal",
};

/** UHD pin type to the symbol pack's (KiCad's) electrical types. */
export function symbolPinType(t: CircuitPin["type"]): PinType {
  switch (t) {
    case "power_in":
    case "ground":
      return "power_in";
    case "power_out":
      return "power_out";
    case "io":
      return "bidirectional";
    case "input":
    case "analog_in":
      return "input";
    case "output":
    case "analog_out":
      return "output";
    case "nc":
      return "no_connect";
    default:
      return "passive";
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** Bind a part's pins to a drawn symbol's pins, or undefined when they do not all bind. */
export function bindPins(part: CircuitPart, pins: readonly SymbolPin[]): Map<string, string> | undefined {
  const out = new Map<string, string>();
  const used = new Set<string>();
  // 1. by name or alias
  const byName = (p: CircuitPin) => pins.find((s) => [s.id, s.name, ...(s.names ?? [])].some((n) => norm(n) === norm(p.name)));
  let ok = true;
  for (const p of part.pins) {
    const s = byName(p);
    if (!s) {
      ok = false;
      break;
    }
    out.set(p.id, s.id);
    used.add(s.id);
  }
  if (ok && used.size === pins.length) return out;
  // 2. by number (two-terminal passives: 1 and 2)
  out.clear();
  used.clear();
  ok = true;
  for (const p of part.pins) {
    const s = pins.find((x) => x.number === p.number || x.pads?.includes(p.number));
    if (!s) {
      ok = false;
      break;
    }
    out.set(p.id, s.id);
    used.add(s.id);
  }
  if (ok && used.size === pins.length) return out;
  // 3. distinct names in designator order (a four-pad switch: two pads per contact)
  const names: string[] = [];
  for (const p of part.pins) if (!names.includes(norm(p.name))) names.push(norm(p.name));
  if (names.length === pins.length && part.pins.every((p) => p.type === "passive")) {
    out.clear();
    for (const p of part.pins) out.set(p.id, pins[names.indexOf(norm(p.name))].id);
    return out;
  }
  return undefined;
}

function boxOf(els: BodyElement[], textW = (el: BodyElement) => (el.text ?? "").length * (el.size ?? 3) * 0.6): LBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const el of els) {
    if (el.el === "text") {
      const w = textW(el);
      const h = el.size ?? 3;
      const xl = el.anchor === "middle" ? el.x! - w / 2 : el.anchor === "end" ? el.x! - w : el.x!;
      add(xl, el.y! - h * 0.8);
      add(xl + w, el.y! + h * 0.2);
      continue;
    }
    for (const line of elementPolylines(el)) for (const [x, y] of line) add(x, y);
  }
  const l = (v: number) => (v - MARGIN) / UNIT;
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: l(x0), y0: l(y0), x1: l(x1), y1: l(y1) };
}

/** The function group a pin's capabilities or name put it in (I2C, SPI, USB, UART), so its pins sit together. */
export function pinGroup(p: CircuitPin): string | undefined {
  const caps = p.capabilities ?? [];
  if (caps.some((c) => /^i2c/.test(c))) return "I2C";
  if (caps.some((c) => /^spi/.test(c))) return "SPI";
  if (caps.some((c) => /^usb/.test(c))) return "USB";
  if (caps.some((c) => /^uart/.test(c))) return "UART";
  return undefined;
}

/** A part's pins as the generator takes them. */
export function pinInputs(part: CircuitPart, pins = part.pins): PinInput[] {
  return pins.map((p) => {
    const g = pinGroup(p);
    return {
      name: p.name || p.number,
      number: p.number,
      type: symbolPinType(p.type),
      ...(p.type === "ground" ? { ground: true } : {}),
      ...(g ? { group: g } : {}),
    };
  });
}

/** Connector pins: contacts of one name become one pin listing every pad; groups by function (power, configuration, data, sideband). */
export function connectorInputs(part: CircuitPart): PinInput[] {
  const out: PinInput[] = [];
  const byName = new Map<string, PinInput>();
  for (const p of part.pins) {
    const name = (p.name || p.number).trim();
    // contacts that read alike (USB-C's two D+ contacts, "D+ (DP1, A6)" and "D+ (DP2, B6)") are one pin
    const key = pinName(name).toUpperCase();
    const prev = byName.get(key);
    if (prev) {
      prev.pads = [...(prev.pads ?? [prev.number!]), p.number];
      continue;
    }
    const group = /^(VBUS|VIN|VCC|V\+|\+?\d+V\d*)$/i.test(name) ? "power" : /^CC\d?$/i.test(name) ? "config" : /^(D[+-]|DP|DN|DM)\d?$/i.test(name) ? "data" : /^SBU\d?$/i.test(name) ? "sideband" : pinGroup(p);
    const q: PinInput = { name, number: p.number, type: symbolPinType(p.type), ...(p.type === "ground" ? { ground: true } : {}), ...(group ? { group } : {}) };
    byName.set(key, q);
    out.push(q);
  }
  for (const q of out) if (q.pads) delete q.number;
  // ground contacts go to the bottom only with short names (a bottom pin's name runs across the body; long ones
  // would run past it): otherwise they stay on the contact side with the rest, in pad order
  const grounds = out.filter((q) => q.ground ?? /^(GND|VSS|AGND|DGND|PGND|SHIELD|SHLD|0V)/i.test(pinName(q.name)));
  if (grounds.some((q) => pinName(q.name).length > 5)) for (const q of grounds) q.ground = false;
  // power first, then data, then configuration and sideband (their shunts hang below without crossing the data lines)
  const rank = (q: PinInput) => ({ power: 0, data: 1, config: 2, sideband: 3 })[q.group ?? ""] ?? 1.5;
  return out.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q);
}

const cache = new Map<string, ResolvedSymbol>();

/** The symbol for a part (cached by part identity, variant and override). */
export function resolveSymbol(part: CircuitPart, opts: { variant?: string; symbol?: string; hide?: readonly string[] } = {}): ResolvedSymbol {
  const key = `${part.part}|${part.path}|${part.class}|${part.pins.map((p) => `${p.id}=${p.number}/${p.name}/${p.type}`).join(",")}|${opts.variant ?? ""}|${opts.symbol ?? ""}|${(opts.hide ?? []).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = resolveUncached(part, opts);
  cache.set(key, r);
  return r;
}

function finish(family: string, def: SymbolDef, binding: Map<string, string>, variant?: string): ResolvedSymbol {
  const v = variant && def.variants[variant]?.body ? def.variants[variant] : undefined;
  const pins = v?.pins ?? def.pins;
  const body = v?.body ?? def.body;
  const frame = v?.frame ?? def.frame;
  const members = new Map<string, string[]>();
  for (const [pp, sp] of binding) {
    const list = members.get(sp) ?? [];
    list.push(pp);
    members.set(sp, list);
  }
  const bodyEls = body.filter((e) => e.role !== "lead" && e.role !== "pin-number");
  return { family, def, ...(v ? { variant } : {}), frame, pins, body, binding, members, body_box: boxOf(bodyEls), full_box: boxOf(body.filter((e) => e.role !== "pin-number")) };
}

function resolveUncached(fullPart: CircuitPart, opts: { variant?: string; symbol?: string; hide?: readonly string[] }): ResolvedSymbol {
  let part = fullPart;
  const wanted = opts.symbol;
  const packId = wanted?.startsWith("pack:") ? wanted.slice(5) : !wanted ? PACK_FOR_CLASS[part.class] : undefined;
  if (packId) {
    const def = packSymbols().get(packId);
    if (def) {
      const b = bindPins(part, def.pins);
      if (b) return finish(`pack:${packId}`, def, b, opts.variant);
    }
  }
  const family = wanted && !wanted.startsWith("pack:") ? wanted : part.class === "regulator" ? "regulator" : part.class === "mcu" || part.class === "module" ? "mcu" : part.class === "connector" ? "connector" : "box";
  // hide_unused: the pins on no net are left out of a generated symbol and counted in a note inside its body
  const hidden = opts.hide?.length ? part.pins.filter((p) => opts.hide!.includes(p.id)) : [];
  if (hidden.length && hidden.length < part.pins.length) part = { ...part, pins: part.pins.filter((p) => !hidden.includes(p)) };
  const inputs = pinInputs(part);
  const o = { id: `gen-${family}`, name: part.name, refdes: "U" };
  let def =
    family === "regulator"
      ? regulator("linear", inputs, o)
      : family === "mcu"
        ? mcu(inputs, o)
        : family === "connector"
          ? connectorOneSide(connectorInputs(part), { id: "gen-connector", name: part.name, refdes: "J" }, [], ["connector"], "right")
          : icBox(inputs, o);
  const binding = new Map<string, string>();
  for (const p of part.pins) {
    const s = def.pins.find((x) => x.number === p.number || x.pads?.includes(p.number));
    if (!s) throw new Error(`symbol for ${part.path}: pin ${p.number} (${p.name}) did not bind to the generated ${family}`);
    binding.set(p.id, s.id);
  }
  if (part !== fullPart) {
    const rect = def.body.find((e) => e.role === "body" && e.el === "rect");
    if (rect) def = { ...def, body: [...def.body, { el: "text", x: rect.x! + rect.width! - 1.2, y: rect.y! + rect.height! - 1.2, text: `${hidden.length} unused`, anchor: "end", size: 2.4, role: "label" }] };
  }
  return finish(family, def, binding);
}

/** A symbol pin's lattice point and direction. */
export const pinAt = (s: SymbolPin): XY => [s.at[0], s.at[1]];
export const pinDir = (s: SymbolPin): Dir => (s.dir === "none" ? "left" : s.dir);

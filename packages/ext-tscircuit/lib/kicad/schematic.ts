/**
 * The KiCad schematic of a board, written by the provider (PB-1032), not
 * converted from tscircuit's schematic: a person reads it, so it is laid out
 * the way one would draw it.
 *
 *   symbols   one per part (and pin set), pins named as the model names them
 *             (`IN+`, `D-`, `A`/`K`; a long note in brackets is dropped, and two
 *             different pins of one name become `GND`, `GND_2`), electrical types
 *             from the UHD leaf types (power in/out, input, output, open
 *             collector, bidirectional, passive), every pin on the 1.27 mm grid
 *   blocks    one labelled block per sub-module (UHD_Group, the instance path)
 *             and one for the board's own parts; in a block each IC comes first
 *             with the passives it connects to in columns beside it
 *   nets      a short stub and a global label at every connected pin, named by
 *             the board's net (no long wires, nothing through a symbol body); a
 *             pin on no net gets a no-connect flag
 *   flags     a PWR_FLAG on every net with a power input and no power output,
 *             so ERC checks what matters
 *   sheet     the smallest ISO sheet the blocks fit on (A4 to A0), else a user size
 *
 * The connections are the board's own (the pads' nets in the exported
 * .kicad_pcb), so Update PCB from Schematic changes nothing.
 */
import type { BoardComponent, BoardNetlist, BoardPinKind } from "@protoboardai/core";
import type { ProtocolDef } from "@deltarobotics/uhd";
import { list, str, type List, type Node } from "./sexpr.ts";

/** KiCad's electrical pin types (those used here). */
export type KicadPinType = "input" | "output" | "bidirectional" | "open_collector" | "passive" | "power_in" | "power_out" | "no_connect";

/** What a leaf interface is to KiCad: its BoardPin kind refined by its protocols' roles and capabilities. */
export function kicadPinType(kind: BoardPinKind, leaf?: { protocols?: Pick<ProtocolDef, "type" | "roles">[]; capabilities?: string[] }): KicadPinType {
  if (kind === "ground" || kind === "power_in") return "power_in";
  if (kind === "power_out") return "power_out";
  if (kind === "passive") return "passive";
  if (kind === "nc") return "no_connect";
  const roles = new Set((leaf?.protocols ?? []).filter((p) => p.type !== "passive").flatMap((p) => p.roles ?? []));
  const caps = leaf?.capabilities ?? [];
  const input = roles.has("input") || roles.has("sink");
  const output = roles.has("output") || roles.has("source");
  if (roles.has("bidirectional") || (input && output)) return "bidirectional";
  if (output) return caps.some((c) => c === "open_drain" || c === "open_collector") ? "open_collector" : "output";
  if (input) return "input";
  return "passive";
}

export interface SchematicInput {
  board: string;
  /** The project's library name (`<lib>:<symbol>`). */
  lib: string;
  netlist: BoardNetlist;
  /** instance → its pads: pad number → UHD leaf interface (the build's name map; tscircuit's pad numbers are KiCad's). */
  pads: Map<string, Map<string, string>>;
  /** instance → designator */
  refdes: Record<string, string>;
  /** instance → fields as name/value pairs, in order (Value first). */
  fields: Record<string, [string, string][]>;
  /** instance → footprint library id */
  footprint: (instance: string) => string;
  /** designator → pad → net (the exported board's copper). */
  padNets: Map<string, Map<string, string>>;
  /** instance → leaf interface → KiCad type (absent: from the pin's kind). */
  pinTypes?: Record<string, Record<string, KicadPinType>>;
  /** instance → symbol UUID */
  symbolUuid: Record<string, string>;
  uuid: (key: string) => string;
}

export interface Schematic {
  sch: List;
  /** The library symbols, named `<lib>:<name>` (the project's .kicad_sym holds them without the prefix). */
  libSymbols: List[];
  /** instance → its symbol's library id */
  symbolOf: Record<string, string>;
  /** library id → pad → pin name */
  pinNames: Map<string, Map<string, string>>;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const G = 2.54; // the grid symbols and pins sit on (a multiple of KiCad's 1.27 mm)
const FONT = 1.27;
/** Width of a string in KiCad's stroke font at 1.27 mm (a little generous). */
const textW = (s: string, size = FONT) => s.length * size * 0.92;
const up = (v: number) => Math.ceil(v / G - 1e-9) * G;
const r = (v: number) => String(Math.round(v * 1e4) / 1e4 + 0);
const at = (x: number, y: number, a = 0) => list("at", r(x), r(y), r(a));
const effects = (size = FONT, justify?: string[], hide = false) => {
  const e = list("effects", list("font", list("size", r(size), r(size))));
  if (justify?.length) e.items.push(list("justify", ...justify));
  if (hide) e.items.push(list("hide", "yes"));
  return e;
};
const stroke = (width = 0.254, type = "default") => list("stroke", list("width", r(width)), list("type", type));

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

interface PinSpec {
  pad: string;
  name: string;
  type: KicadPinType;
}

interface SymbolSpec {
  /** The library item name. */
  name: string;
  prefix: string;
  kind: "two" | "box";
  passive?: BoardComponent["kind"];
  pins: PinSpec[];
  /** box: pins on each side, top to bottom */
  left: PinSpec[];
  right: PinSpec[];
  /** box: half the body's width; both: rows of pins */
  hw: number;
  rows: number;
}

const PASSIVES = new Set(["resistor", "capacitor", "inductor", "ferrite_bead"]);

/** A pin name KiCad shows as written: the model's name, a note in brackets dropped, spaces joined. */
export function pinName(name: string): string {
  let n = name.trim();
  const bracket = n.indexOf(" (");
  if (bracket > 0) n = n.slice(0, bracket);
  n = n.replace(/\s+/g, "_");
  // KiCad's text markup (~{…}, _{…}, ^{…}) and a lone ~ (no name) are not the model's
  if (/^~/.test(n) || /[~^_]\{/.test(n)) n = n.replace(/([~^_])\{/g, "$1(").replace(/^~/, "-");
  return n || "~";
}

/** Side of a box symbol a pin goes on: supplies and inputs left, outputs right, ground at the bottom of the left. */
function sides(pins: PinSpec[], kindOf: (p: PinSpec) => BoardPinKind): { left: PinSpec[]; right: PinSpec[] } {
  const supply = pins.filter((p) => p.type === "power_in" && kindOf(p) !== "ground");
  const out = pins.filter((p) => p.type === "power_out");
  const ins = pins.filter((p) => p.type === "input");
  const outs = pins.filter((p) => p.type === "output" || p.type === "open_collector");
  const ground = pins.filter((p) => kindOf(p) === "ground");
  const rest = pins.filter((p) => ![supply, out, ins, outs, ground].some((s) => s.includes(p)));
  const left = [...supply, ...ins];
  const right = [...out, ...outs];
  // the rest (bidirectional, passive, no-connect) fill the shorter side, in pad order
  for (const p of rest) (left.length + ground.length <= right.length ? left : right).push(p);
  left.push(...ground);
  // a lopsided symbol is hard to read: move pins from the longer side's end until the two are within two
  while (left.length - right.length > 2 && left.length > ground.length) right.push(left.splice(left.length - ground.length - 1, 1)[0]);
  while (right.length - left.length > 2) left.splice(left.length - ground.length, 0, right.pop()!);
  return { left, right };
}

function symbolSpec(c: BoardComponent, pads: Map<string, string>, typeOf: (pad: string, iface: string) => KicadPinType, netOf: (pad: string) => string | undefined, prefix: string): Omit<SymbolSpec, "name"> {
  const byIface = new Map(c.pins.map((p) => [p.interface, p]));
  const order = [...pads.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  // one name per interface, as the model names it; pins of one name stay one name while they are on one net
  // (a module's ground pads), and one on another net is told apart visibly (GND, GND_2)
  const nameOf = new Map<string, string>();
  const firstNet = new Map<string, string | undefined>(); // shown name → the net of its first pin
  const count = new Map<string, number>();
  for (const [pad, iface] of order) {
    if (nameOf.has(iface)) continue;
    const base = pinName(byIface.get(iface)?.name ?? iface);
    const net = netOf(pad);
    if (!count.has(base) || firstNet.get(base) === net) {
      if (!count.has(base)) (count.set(base, 1), firstNet.set(base, net));
      nameOf.set(iface, base);
      continue;
    }
    let n = count.get(base)! + 1;
    while (count.has(`${base}_${n}`)) n++;
    count.set(base, n);
    count.set(`${base}_${n}`, 1);
    firstNet.set(`${base}_${n}`, net);
    nameOf.set(iface, `${base}_${n}`);
  }
  const pins: PinSpec[] = order.map(([pad, iface]) => ({ pad, name: nameOf.get(iface)!, type: PASSIVES.has(c.kind) ? "passive" : typeOf(pad, iface) }));
  const kindByPad = new Map(order.map(([pad, iface]) => [pad, byIface.get(iface)?.kind ?? "passive"]));
  if (PASSIVES.has(c.kind) && pins.length === 2) return { prefix, kind: "two", passive: c.kind, pins, left: [pins[0]], right: [pins[1]], hw: G, rows: 1 };
  const { left, right } = sides(pins, (p) => kindByPad.get(p.pad)!);
  const rows = Math.max(left.length, right.length, 1);
  const nameW = Math.max(0, ...left.map((p) => textW(p.name))) + Math.max(0, ...right.map((p) => textW(p.name)));
  const hw = Math.max(2 * G, up((nameW + 2 * G) / 2));
  return { prefix, kind: "box", pins, left, right, hw, rows };
}

/** The pin's connection point in library coordinates (Y up) and its angle. */
function pinPlaces(s: SymbolSpec): Map<string, { x: number; y: number; angle: number }> {
  const out = new Map<string, { x: number; y: number; angle: number }>();
  if (s.kind === "two") {
    out.set(s.left[0].pad, { x: -2 * G, y: 0, angle: 0 });
    out.set(s.right[0].pad, { x: 2 * G, y: 0, angle: 180 });
    return out;
  }
  s.left.forEach((p, i) => out.set(p.pad, { x: -(s.hw + G), y: -i * G, angle: 0 }));
  s.right.forEach((p, i) => out.set(p.pad, { x: s.hw + G, y: -i * G, angle: 180 }));
  return out;
}

function libSymbol(s: SymbolSpec, lib: string): List {
  const name = s.name;
  const props = [
    list("property", str("Reference"), str(s.prefix), at(0, s.kind === "two" ? G : 2 * G), effects()),
    list("property", str("Value"), str(name), at(0, s.kind === "two" ? -G : -(s.rows * G + G)), effects()),
    list("property", str("Footprint"), str(""), at(0, 0), effects(FONT, undefined, true)),
    list("property", str("Datasheet"), str(""), at(0, 0), effects(FONT, undefined, true)),
    list("property", str("Description"), str(""), at(0, 0), effects(FONT, undefined, true)),
  ];
  const body: Node[] = [];
  if (s.kind === "two") {
    if (s.passive === "capacitor") {
      body.push(
        list("polyline", list("pts", list("xy", "-0.635", "-1.524"), list("xy", "-0.635", "1.524")), stroke(0.3048), list("fill", list("type", "none"))),
        list("polyline", list("pts", list("xy", "0.635", "-1.524"), list("xy", "0.635", "1.524")), stroke(0.3048), list("fill", list("type", "none"))),
        list("polyline", list("pts", list("xy", "-2.54", "0"), list("xy", "-0.635", "0")), stroke(0.254), list("fill", list("type", "none"))),
        list("polyline", list("pts", list("xy", "0.635", "0"), list("xy", "2.54", "0")), stroke(0.254), list("fill", list("type", "none"))),
      );
    } else if (s.passive === "inductor") {
      for (let i = 0; i < 4; i++) {
        const x0 = -2.54 + i * 1.27;
        body.push(list("arc", list("start", r(x0), "0"), list("mid", r(x0 + 0.635), "0.635"), list("end", r(x0 + 1.27), "0"), stroke(0.254), list("fill", list("type", "none"))));
      }
    } else {
      body.push(list("rectangle", list("start", "-2.54", "1.016"), list("end", "2.54", "-1.016"), stroke(0.254), list("fill", list("type", s.passive === "ferrite_bead" ? "outline" : "none"))));
    }
  } else {
    body.push(list("rectangle", list("start", r(-s.hw), r(G)), list("end", r(s.hw), r(-(s.rows * G))), stroke(0.254), list("fill", list("type", "background"))));
  }
  const places = pinPlaces(s);
  const pins = s.pins.map((p) => {
    const pl = places.get(p.pad)!;
    return list("pin", p.type, "line", at(pl.x, pl.y, pl.angle), list("length", r(G)), list("name", str(p.name), effects()), list("number", str(p.pad), effects()));
  });
  return list(
    "symbol",
    str(`${lib}:${name}`),
    ...(s.kind === "two" ? [list("pin_numbers", list("hide", "yes")), list("pin_names", list("offset", "0"), list("hide", "yes"))] : [list("pin_names", list("offset", "0.762"))]),
    list("exclude_from_sim", "no"),
    list("in_bom", "yes"),
    list("on_board", "yes"),
    ...props,
    list("symbol", str(`${name}_0_1`), ...body),
    list("symbol", str(`${name}_1_1`), ...pins),
    list("embedded_fonts", "no"),
  );
}

/** KiCad's PWR_FLAG, in the project's library. */
function pwrFlag(lib: string): List {
  return list(
    "symbol",
    str(`${lib}:PWR_FLAG`),
    list("power"),
    list("pin_numbers", list("hide", "yes")),
    list("pin_names", list("offset", "0"), list("hide", "yes")),
    list("exclude_from_sim", "no"),
    list("in_bom", "yes"),
    list("on_board", "yes"),
    list("property", str("Reference"), str("#FLG"), at(0, 1.905), effects(FONT, undefined, true)),
    list("property", str("Value"), str("PWR_FLAG"), at(0, 3.81), effects()),
    list("property", str("Footprint"), str(""), at(0, 0), effects(FONT, undefined, true)),
    list("property", str("Datasheet"), str("~"), at(0, 0), effects(FONT, undefined, true)),
    list("property", str("Description"), str("Special symbol for telling ERC where power comes from"), at(0, 0), effects(FONT, undefined, true)),
    list("symbol", str("PWR_FLAG_0_0"), list("pin", "power_out", "line", at(0, 0, 90), list("length", "0"), list("name", str("~"), effects()), list("number", str("1"), effects()))),
    list("symbol", str("PWR_FLAG_0_1"), list("polyline", list("pts", list("xy", "0", "0"), list("xy", "0", "1.27"), list("xy", "-1.016", "1.905"), list("xy", "0", "2.54"), list("xy", "1.016", "1.905"), list("xy", "0", "1.27")), stroke(0), list("fill", list("type", "none")))),
    list("embedded_fonts", "no"),
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A label's extent from its pin: the stub and the label's own width. */
const STUB = 2 * G;
const labelW = (net: string) => STUB + textW(net) + 2.6;

interface Placed {
  inst: string;
  spec: SymbolSpec;
  /** Symbol origin, relative to its cluster (then its block, then the sheet). */
  x: number;
  y: number;
}

interface Box {
  w: number;
  h: number;
  items: Placed[];
}

/** Extents of a symbol with its labels around its origin: left, right, top, bottom (sheet orientation, positive outward). */
function extent(spec: SymbolSpec, nets: Map<string, string> | undefined): { l: number; r: number; t: number; b: number } {
  const lw = Math.max(0, ...spec.left.map((p) => (nets?.get(p.pad) ? labelW(nets.get(p.pad)!) : G)));
  const rw = Math.max(0, ...spec.right.map((p) => (nets?.get(p.pad) ? labelW(nets.get(p.pad)!) : G)));
  if (spec.kind === "two") return { l: 2 * G + lw, r: 2 * G + rw, t: 2 * G, b: 2 * G };
  return { l: spec.hw + G + lw, r: spec.hw + G + rw, t: 3 * G, b: spec.rows * G + 2 * G };
}

/** Lay boxes in rows no wider than `width` (each at least its own width), with `gap` between them. */
function shelf<T extends { w: number; h: number }>(boxes: T[], width: number, gap: number): { box: T; x: number; y: number }[] {
  const out: { box: T; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > width) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    out.push({ box: b, x, y });
    x += up(b.w) + gap;
    rowH = Math.max(rowH, up(b.h));
  }
  return out;
}

const PAPERS: [string, number, number][] = [
  ["A4", 297, 210],
  ["A3", 420, 297],
  ["A2", 594, 420],
  ["A1", 841, 594],
  ["A0", 1189, 841],
];

export function buildSchematic(input: SchematicInput): Schematic {
  const { board, lib, netlist, uuid } = input;
  const comps = netlist.components.filter((c) => input.refdes[c.instance] && input.pads.has(c.instance));
  const netsOf = (inst: string) => input.padNets.get(input.refdes[inst]);

  // ---- symbols: one per part and pin set
  const specs = new Map<string, SymbolSpec>(); // instance → spec
  const byKey = new Map<string, SymbolSpec>();
  const names = new Set<string>(["PWR_FLAG"]);
  // electrical types: the leaf's, then made to say what ERC should check
  const baseType = (c: BoardComponent, pad: string, iface: string): KicadPinType => {
    const kind = c.pins.find((p) => p.interface === iface)?.kind ?? "passive";
    let type = input.pinTypes?.[c.instance]?.[iface] ?? kicadPinType(kind);
    // a no-connect pin that is wired (tied to ground on purpose) is passive, or ERC calls the net an error
    if (type === "no_connect" && netsOf(c.instance)?.get(pad)) type = "passive";
    return type;
  };
  const demoted = new Set<string>(); // `${instance}:${pad}`: a power output that is not the net's source
  const sources = new Map<string, { c: BoardComponent; pad: string }[]>(); // net → its power outputs
  for (const c of comps) {
    const seen = new Set<string>();
    for (const [pad, iface] of [...input.pads.get(c.instance)!].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
      const net = netsOf(c.instance)?.get(pad);
      if (!net || PASSIVES.has(c.kind) || baseType(c, pad, iface) !== "power_out") continue;
      // one part's several output pins on one rail (VOUT on two pads) are one source
      if (seen.has(net)) demoted.add(`${c.instance}:${pad}`);
      else (seen.add(net), sources.set(net, [...(sources.get(net) ?? []), { c, pad }]));
    }
  }
  // a connector carries the power a part on the board makes (a battery or speaker lead): the part is the source
  for (const list of sources.values()) if (list.some((x) => x.c.kind !== "connector")) for (const x of list) if (x.c.kind === "connector") demoted.add(`${x.c.instance}:${x.pad}`);
  for (const c of comps) {
    const pads = input.pads.get(c.instance)!;
    const prefix = (input.refdes[c.instance].match(/^[A-Z#]+/)?.[0] ?? "U") || "U";
    const s = symbolSpec(c, pads, (pad, iface) => (demoted.has(`${c.instance}:${pad}`) ? "passive" : baseType(c, pad, iface)), (pad) => netsOf(c.instance)?.get(pad), prefix);
    const key = JSON.stringify([c.part, prefix, s.kind, s.passive, s.pins, s.left.map((p) => p.pad)]);
    let spec = byKey.get(key);
    if (!spec) {
      const base = c.part.replace(/[:/\\\s"]+/g, "_");
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base}_${n}`;
      names.add(name);
      spec = { ...s, name };
      byKey.set(key, spec);
    }
    specs.set(c.instance, spec);
  }

  // ---- blocks: the board's own parts, then each sub-module in tree order
  const groups = [{ path: "", name: board }, ...(netlist.groups ?? []).map((g) => ({ path: g.path, name: g.name }))];
  const isIc = (c: BoardComponent) => specs.get(c.instance)!.kind === "box";
  const netKind = new Map(netlist.nets.map((n) => [n.name, n.kind]));
  const netKindOf = (name: string) => netKind.get(name) ?? (/gnd|ground/i.test(name) ? "ground" : "signal");
  const blocks: { path: string; title: string; subtitle: string; box: Box }[] = [];
  for (const g of groups) {
    const members = comps.filter((c) => (c.group ?? "") === g.path);
    if (!members.length) continue;
    const ics = members.filter(isIc);
    const passives = members.filter((c) => !isIc(c));
    // each passive beside the IC it shares the most with: a signal net counts most, a supply some, ground not at all
    const beside = new Map<string, BoardComponent[]>(ics.map((c) => [c.instance, []]));
    const loose: BoardComponent[] = [];
    for (const p of passives) {
      const mine = [...(netsOf(p.instance)?.values() ?? [])];
      let best: BoardComponent | undefined;
      let score = 0;
      for (const ic of ics) {
        const theirs = new Set(netsOf(ic.instance)?.values() ?? []);
        const s = mine.filter((n) => theirs.has(n)).reduce((a, n) => a + (netKindOf(n) === "signal" ? 3 : netKindOf(n) === "power" ? 1 : 0), 0);
        if (s > score) (score = s), (best = ic);
      }
      if (best) beside.get(best.instance)!.push(p);
      else loose.push(p);
    }
    // clusters: an IC and its passives in columns to its right; the loose passives in columns of their own
    const clusters: Box[] = [];
    const column = (parts: BoardComponent[], perColumn: number, x0: number, y0: number, items: Placed[]): { w: number; h: number } => {
      let x = x0;
      let h = 0;
      for (let i = 0; i < parts.length; i += perColumn) {
        const col = parts.slice(i, i + perColumn);
        const ex = col.map((c) => extent(specs.get(c.instance)!, netsOf(c.instance)));
        const l = up(Math.max(...ex.map((e) => e.l)));
        const rr = up(Math.max(...ex.map((e) => e.r)));
        col.forEach((c, k) => items.push({ inst: c.instance, spec: specs.get(c.instance)!, x: x + l, y: y0 + 2 * G + k * 3 * G }));
        h = Math.max(h, col.length * 3 * G + G);
        x += l + rr + G;
      }
      return { w: x - x0, h };
    };
    for (const ic of ics) {
      const spec = specs.get(ic.instance)!;
      const e = extent(spec, netsOf(ic.instance));
      const items: Placed[] = [{ inst: ic.instance, spec, x: up(e.l), y: up(e.t) }];
      const icW = up(e.l) + up(e.r);
      const icH = up(e.t) + up(e.b);
      const mine = beside.get(ic.instance)!;
      const per = Math.max(4, Math.floor(icH / (3 * G)));
      const col = mine.length ? column(mine, per, icW + G, 0, items) : { w: 0, h: 0 };
      clusters.push({ w: icW + (mine.length ? G + col.w : 0), h: Math.max(icH, col.h), items });
    }
    if (loose.length) {
      const items: Placed[] = [];
      const per = Math.max(4, Math.ceil(Math.sqrt(loose.length * 3)));
      const col = column(loose, per, 0, 0, items);
      clusters.push({ w: col.w, h: col.h, items });
    }
    const area = clusters.reduce((a, c) => a + c.w * c.h, 0);
    const width = Math.max(...clusters.map((c) => c.w), Math.sqrt(area) * 1.4);
    const laid = shelf(clusters, width, 2 * G);
    const items: Placed[] = [];
    let w = 0;
    let h = 0;
    for (const { box, x, y } of laid) {
      for (const it of box.items) items.push({ ...it, x: it.x + x, y: it.y + y });
      w = Math.max(w, x + box.w);
      h = Math.max(h, y + box.h);
    }
    blocks.push({ path: g.path, title: g.path || board, subtitle: g.path ? g.name : "the board's own parts", box: { w: up(w), h: up(h), items } });
  }

  // ---- the nets ERC should see as powered: a power input and no power output on them
  const typeAt = new Map<string, KicadPinType[]>(); // net → pin types on it
  for (const c of comps) {
    const nets = netsOf(c.instance);
    for (const p of specs.get(c.instance)!.pins) {
      const n = nets?.get(p.pad);
      if (n) typeAt.set(n, [...(typeAt.get(n) ?? []), p.type]);
    }
  }
  const flagged = [...typeAt.entries()].filter(([, ts]) => ts.includes("power_in") && !ts.includes("power_out")).map(([n]) => n).sort((a, b) => a.localeCompare(b));
  if (flagged.length) {
    const items: Placed[] = [];
    const per = Math.max(4, Math.ceil(Math.sqrt(flagged.length * 2)));
    const colW = up(Math.max(...flagged.map((n) => 2 * G + labelW(n)))) + 2 * G;
    flagged.forEach((n, i) => items.push({ inst: `#flag:${n}`, spec: { name: "PWR_FLAG", prefix: "#FLG", kind: "two", pins: [], left: [], right: [], hw: 0, rows: 0 }, x: G + Math.floor(i / per) * colW, y: 4 * G + (i % per) * 4 * G }));
    const cols = Math.ceil(flagged.length / per);
    blocks.push({ path: "#flags", title: "Power flags", subtitle: "nets with a power input and no power output",  box: { w: cols * colW, h: Math.min(per, flagged.length) * 4 * G + 2 * G, items } });
  }

  // ---- the sheet: blocks in rows, each framed with its title
  const PAD = 2 * G; // inside a block's frame
  const TITLE = 4 * G; // the title (sub-module path) and subtitle (its name) above a block's contents
  const titleW = (t: string) => t.length * 2.54 * 0.95;
  const framed = blocks.map((b) => ({ ...b, w: up(Math.max(b.box.w + 2 * PAD, titleW(b.title) + 2 * PAD, textW(b.subtitle) + 2 * PAD)), h: b.box.h + 2 * PAD + TITLE }));
  const MARGIN = 10 * G; // the drawing frame
  const TITLE_BLOCK = 12 * G; // KiCad's title block, bottom right
  const GAP = 4 * G;
  // the smallest sheet the blocks fit on, packed to its width; past A0, a user size of A0's shape
  const pack = (width: number) => {
    const laid = shelf(framed, width, GAP);
    return { laid, w: Math.max(...laid.map((l) => l.x + l.box.w)), h: Math.max(...laid.map((l) => l.y + l.box.h)) };
  };
  let chosen: { laid: ReturnType<typeof shelf<(typeof framed)[number]>>; w: number; h: number; paper: List } | undefined;
  for (const [name, pw, ph] of PAPERS) {
    const p = pack(pw - 2 * MARGIN);
    if (p.w + 2 * MARGIN <= pw && p.h + 2 * MARGIN + TITLE_BLOCK <= ph) {
      chosen = { ...p, paper: list("paper", str(name)) };
      break;
    }
  }
  if (!chosen) {
    const area = framed.reduce((a, b) => a + (b.w + GAP) * (b.h + GAP), 0);
    const p = pack(Math.max(...framed.map((b) => b.w), Math.sqrt(area * 1.414) * 1.1));
    chosen = { ...p, paper: list("paper", str("User"), r(up(Math.max(p.w + 2 * MARGIN, (p.h + 2 * MARGIN + TITLE_BLOCK) * 1.414))), r(up(Math.max(p.h + 2 * MARGIN + TITLE_BLOCK, (p.w + 2 * MARGIN) / 1.414)))) };
  }
  const laid = chosen.laid;
  const paperNode = chosen.paper;

  // ---- the document
  const libSymbols = [...new Map([...specs.values()].map((s) => [s.name, s])).values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => libSymbol(s, lib));
  if (flagged.length) libSymbols.push(pwrFlag(lib));
  const root = uuid("schematic");
  const sch = list(
    "kicad_sch",
    list("version", "20250114"),
    list("generator", str("protoboard")),
    list("generator_version", str("0.1")),
    list("uuid", root),
    paperNode,
    list("title_block", list("title", str(board)), list("comment", "1", str("From the UHD board (@protoboardai/ext-tscircuit)"))),
    list("lib_symbols", ...libSymbols),
  );
  const drawn: List[] = [];
  const labels: List[] = [];
  const symbols: List[] = [];
  const symbolOf: Record<string, string> = {};
  const pinNames = new Map<string, Map<string, string>>();
  let flagN = 0;
  for (const { box: b, x: bx, y: by } of laid) {
    const ox = MARGIN + bx;
    const oy = MARGIN + by;
    drawn.push(list("rectangle", list("start", r(ox), r(oy)), list("end", r(ox + b.w), r(oy + b.h)), stroke(0.254, "dash"), list("fill", list("type", "none")), list("uuid", uuid(`block:${b.path}`))));
    drawn.push(list("text", str(b.title), list("exclude_from_sim", "no"), at(ox + PAD, oy + PAD + G), list("effects", list("font", list("size", "2.54", "2.54"), list("thickness", "0.508"), list("bold", "yes")), list("justify", "left", "bottom")), list("uuid", uuid(`title:${b.path}`))));
    drawn.push(list("text", str(b.subtitle), list("exclude_from_sim", "no"), at(ox + PAD, oy + PAD + 2 * G), list("effects", list("font", list("size", r(FONT), r(FONT)), list("italic", "yes")), list("justify", "left", "bottom")), list("uuid", uuid(`subtitle:${b.path}`))));
    const cx = ox + PAD;
    const cy = oy + PAD + TITLE;
    for (const it of b.box.items) {
      const X = cx + it.x;
      const Y = cy + it.y;
      if (it.inst.startsWith("#flag:")) {
        const net = it.inst.slice("#flag:".length);
        const ref = `#FLG${String(++flagN).padStart(2, "0")}`;
        const u = uuid(`flag:${net}`);
        symbols.push(
          list(
            "symbol",
            list("lib_id", str(`${lib}:PWR_FLAG`)),
            at(X, Y),
            list("unit", "1"),
            list("exclude_from_sim", "no"),
            list("in_bom", "yes"),
            list("on_board", "yes"),
            list("dnp", "no"),
            list("uuid", u),
            list("property", str("Reference"), str(ref), at(X, Y - 1.905), effects(FONT, undefined, true)),
            list("property", str("Value"), str("PWR_FLAG"), at(X, Y - 3.81), effects()),
            list("property", str("Footprint"), str(""), at(X, Y), effects(FONT, undefined, true)),
            list("property", str("Datasheet"), str("~"), at(X, Y), effects(FONT, undefined, true)),
            list("property", str("Description"), str(""), at(X, Y), effects(FONT, undefined, true)),
            list("pin", str("1"), list("uuid", uuid(`flag-pin:${net}`))),
            list("instances", list("project", str(board), list("path", str(`/${root}`), list("reference", str(ref)), list("unit", "1")))),
          ),
        );
        labels.push(...stubAndLabel(X, Y, 0, net, `flag:${net}`, uuid));
        continue;
      }
      const c = comps.find((x) => x.instance === it.inst)!;
      const ref = input.refdes[c.instance];
      const libId = `${lib}:${it.spec.name}`;
      symbolOf[c.instance] = libId;
      if (!pinNames.has(libId)) pinNames.set(libId, new Map(it.spec.pins.map((p) => [p.pad, p.name])));
      const nets = netsOf(c.instance);
      const places = pinPlaces(it.spec);
      for (const p of it.spec.pins) {
        const pl = places.get(p.pad)!;
        const [px, py] = [X + pl.x, Y - pl.y];
        const net = nets?.get(p.pad);
        if (!net) {
          labels.push(list("no_connect", list("at", r(px), r(py)), list("uuid", uuid(`nc:${ref}:${p.pad}`))));
          continue;
        }
        // the label points away from the body: left pins to the left, right pins to the right
        labels.push(...stubAndLabel(px, py, pl.angle === 0 ? 180 : 0, net, `${ref}:${p.pad}`, uuid));
      }
      const two = it.spec.kind === "two";
      const refAt = two ? at(X, Y - 1.905) : at(X - it.spec.hw, Y - G - 0.635);
      const valAt = two ? at(X, Y + 1.905) : at(X - it.spec.hw, Y + it.spec.rows * G + 0.635);
      const fields = input.fields[c.instance] ?? [["Value", c.name]];
      const value = fields.find(([k]) => k === "Value")?.[1] ?? c.name;
      symbols.push(
        list(
          "symbol",
          list("lib_id", str(libId)),
          at(X, Y),
          list("unit", "1"),
          list("exclude_from_sim", "no"),
          list("in_bom", "yes"),
          list("on_board", "yes"),
          list("dnp", "no"),
          list("uuid", input.symbolUuid[c.instance]),
          list("property", str("Reference"), str(ref), refAt, effects(FONT, two ? ["bottom"] : ["left", "bottom"])),
          list("property", str("Value"), str(value), valAt, effects(FONT, two ? ["top"] : ["left", "top"])),
          list("property", str("Footprint"), str(input.footprint(c.instance)), at(X, Y), effects(FONT, undefined, true)),
          list("property", str("Datasheet"), str(""), at(X, Y), effects(FONT, undefined, true)),
          list("property", str("Description"), str(c.name), at(X, Y), effects(FONT, undefined, true)),
          ...fields.filter(([k]) => k !== "Value").map(([k, v]) => list("property", str(k), str(v), at(X, Y), effects(FONT, undefined, true))),
          ...it.spec.pins.map((p) => list("pin", str(p.pad), list("uuid", uuid(`pin:${c.instance}:${p.pad}`)))),
          list("instances", list("project", str(board), list("path", str(`/${root}`), list("reference", str(ref)), list("unit", "1")))),
        ),
      );
    }
  }
  sch.items.push(...drawn, ...labels, ...symbols, list("sheet_instances", list("path", str("/"), list("page", str("1")))), list("embedded_fonts", "no"));
  return { sch, libSymbols, symbolOf, pinNames };
}

/** A short wire from a pin outward and a global label at its end, named by the net. */
function stubAndLabel(x: number, y: number, angle: 0 | 180, net: string, key: string, uuid: (k: string) => string): List[] {
  const dx = angle === 0 ? STUB : -STUB;
  const lx = x + dx;
  return [
    list("wire", list("pts", list("xy", r(x), r(y)), list("xy", r(lx), r(y))), stroke(0.1524), list("uuid", uuid(`stub:${key}`))),
    list(
      "global_label",
      str(net),
      list("shape", "passive"),
      at(lx, y, angle),
      list("fields_autoplaced", "yes"),
      effects(FONT, [angle === 0 ? "left" : "right"]),
      list("uuid", uuid(`label:${key}`)),
      list("property", str("Intersheetrefs"), str("${INTERSHEET_REFS}"), at(lx, y, 0), effects(FONT, undefined, true)),
    ),
  ];
}


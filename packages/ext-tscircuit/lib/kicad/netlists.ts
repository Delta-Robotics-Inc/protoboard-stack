/**
 * The three netlists a locked board is compared through
 * (docs/specs/pcb-kicad-handoff.md §4), in one shape: parts by UHD instance
 * (designator, footprint, fields) and nets as pins `<instance>.<pad>`.
 *
 *   model   the UHD board now, projected the way the export wrote it
 *   kicad   the KiCad files now: the board's footprints and pads, the
 *           schematic's symbols, and the schematic's nets from kicad-cli
 *   record  both of these as they were at lock (handoff.json)
 *
 * Reading KiCad needs no KiCad: the files are S-expressions (sexpr.ts).
 */
import type { BoardNetlist } from "@protoboardai/core";
import type { FootprintOverrides } from "../footprints.ts";
import { resolveFootprint } from "../footprints.ts";
import type { NameMap } from "../source.ts";
import { EXTRA_FIELDS, type ComponentFields } from "./fields.ts";
import { libItemName } from "./project.ts";
import { child, children, head, isList, parse, property, text, type List } from "./sexpr.ts";

export interface PartRecord {
  refdes: string;
  /** Footprint library id, `<lib>:<entry>`. */
  footprint: string;
  /** Value, MPN, Manufacturer, LCSC (those set). */
  fields: Record<string, string>;
}

export interface Netlist {
  parts: Record<string, PartRecord>;
  /** net name → pins `<instance>.<pad>`, sorted */
  nets: Record<string, string[]>;
}

const COMPARED_FIELDS = ["Value", "MPN", "Manufacturer", "LCSC"] as const;

const sortNets = (nets: Record<string, Set<string>>): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(nets)
      .filter(([, pins]) => pins.size > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v].sort()]),
  );

/** The model's netlist, as an export of it would name parts, footprints and pads. */
export function modelNetlist(input: { netlist: BoardNetlist; map?: NameMap; refdes: Record<string, string>; fields: Record<string, ComponentFields>; lib: string; overrides?: FootprintOverrides }): Netlist {
  const { netlist, map, refdes, fields, lib } = input;
  // instance → interface → pads, from the build's name map (tscircuit's pad numbers are KiCad's)
  const pads = new Map<string, Map<string, string[]>>();
  for (const m of Object.values(map?.components ?? {})) {
    const byIface = new Map<string, string[]>();
    for (const [port, iface] of Object.entries(m.ports)) {
      if (!iface) continue;
      const pad = port.replace(/^pin/, "");
      byIface.set(iface, [...(byIface.get(iface) ?? []), pad]);
    }
    pads.set(m.instance, byIface);
  }
  const mapped = new Map(Object.values(map?.components ?? {}).map((m) => [m.instance, m]));
  const parts: Record<string, PartRecord> = {};
  for (const c of netlist.components) {
    const entry = mapped.get(c.instance)?.footprint ?? resolveFootprint(c.instance, c.package ? { ...c.package, manufacturer: c.manufacturer } : undefined, input.overrides).entry?.id ?? c.instance;
    const f = fields[c.instance];
    parts[c.instance] = {
      refdes: refdes[c.instance] ?? "",
      footprint: `${lib}:${libItemName(entry)}`,
      fields: Object.fromEntries(COMPARED_FIELDS.filter((k) => f?.[k]).map((k) => [k, f![k] as string])),
    };
  }
  const nets: Record<string, Set<string>> = {};
  for (const n of netlist.nets) {
    const set = (nets[n.id] = new Set<string>());
    for (const p of n.pins) {
      const [inst, iface] = [p.slice(0, p.lastIndexOf(":")), p.slice(p.lastIndexOf(":") + 1)];
      if (!inst) continue; // the board's own edge
      const comp = netlist.components.find((c) => c.instance === inst);
      const known = pads.get(inst)?.get(iface);
      const pin = known ?? [comp?.pins.find((x) => x.interface === iface)?.pin ?? iface];
      for (const pad of pin) set.add(`${inst}.${pad}`);
    }
  }
  return { parts, nets: sortNets(nets) };
}

/** Which instance a KiCad part is: its UHD_Instance field, else its designator through the record. */
const instanceOf = (fields: Record<string, string>, ref: string, byRef: Map<string, string>) => fields.UHD_Instance || byRef.get(ref) || `?${ref}`;

const fieldsOfNode = (n: List): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of [...COMPARED_FIELDS, ...EXTRA_FIELDS]) {
    const v = property(n, k);
    if (v) out[k] = v;
  }
  return out;
};

const compared = (f: Record<string, string>) => Object.fromEntries(COMPARED_FIELDS.filter((k) => f[k]).map((k) => [k, f[k]]));

/** The board file: footprints (designator, library id, fields) and the copper nets on their pads. */
export function readBoardNetlist(pcbText: string, refdes: Record<string, string>): Netlist {
  const pcb = parse(pcbText);
  if (head(pcb) !== "kicad_pcb") throw new Error("not a KiCad board file (no kicad_pcb)");
  const byRef = new Map(Object.entries(refdes).map(([i, r]) => [r, i]));
  // KiCad 6–9 number nets: (net 3 "sda") in the header, (net 3 "sda") on pads; KiCad 10 names them: (net "sda")
  const parts: Record<string, PartRecord> = {};
  const nets: Record<string, Set<string>> = {};
  for (const fp of children(pcb, "footprint")) {
    const ref = property(fp, "Reference") ?? text(children(fp, "fp_text").find((t) => text(t.items[1]) === "reference")?.items[2]) ?? "";
    const f = fieldsOfNode(fp);
    // board-only footprints (mounting holes, fiducials) are not components
    if (!f.UHD_Instance && child(fp, "attr")?.items.some((x) => text(x) === "board_only")) continue;
    const inst = instanceOf(f, ref, byRef);
    parts[inst] = { refdes: ref, footprint: text(fp.items[1]) ?? "", fields: compared(f) };
    for (const pad of children(fp, "pad")) {
      const num = text(pad.items[1]) ?? "";
      const net = child(pad, "net");
      if (!num || !net) continue;
      const name = text(net.items[net.items.length - 1]) ?? "";
      if (!name || /^unconnected-/.test(name)) continue;
      (nets[name] ??= new Set()).add(`${inst}.${num}`);
    }
  }
  return { parts, nets: sortNets(nets) };
}

/** The schematic file: its symbols (power symbols, `#…`, left out). Its nets need KiCad (readKicadNetlist). */
export function readSchematicParts(schText: string, refdes: Record<string, string>): Record<string, PartRecord> {
  const sch = parse(schText);
  if (head(sch) !== "kicad_sch") throw new Error("not a KiCad schematic file (no kicad_sch)");
  const byRef = new Map(Object.entries(refdes).map(([i, r]) => [r, i]));
  const out: Record<string, PartRecord> = {};
  for (const s of children(sch, "symbol")) {
    const ref = property(s, "Reference") ?? "";
    if (!ref || ref.startsWith("#")) continue;
    const f = fieldsOfNode(s);
    out[instanceOf(f, ref, byRef)] = { refdes: ref, footprint: property(s, "Footprint") ?? "", fields: compared(f) };
  }
  return out;
}

/** `kicad-cli sch export netlist --format kicadsexpr`: the schematic's nets (and its parts). */
export function readKicadNetlist(netText: string, refdes: Record<string, string>): Netlist {
  const doc = parse(netText);
  const byRef = new Map(Object.entries(refdes).map(([i, r]) => [r, i]));
  const refToInst = new Map<string, string>();
  const parts: Record<string, PartRecord> = {};
  for (const comps of children(doc, "components")) {
    for (const c of children(comps, "comp")) {
      const ref = text(child(c, "ref")?.items[1]) ?? "";
      const f: Record<string, string> = {};
      for (const p of children(c, "property")) {
        const k = text(child(p, "name")?.items[1]);
        const v = text(child(p, "value")?.items[1]);
        if (k && v) f[k] = v;
      }
      const fieldsNode = child(c, "fields");
      for (const fld of fieldsNode ? children(fieldsNode, "field") : []) {
        const k = text(child(fld, "name")?.items[1]);
        const v = fld.items.slice(2).find((x) => !isList(x));
        if (k && v !== undefined && text(v)) f[k] = text(v)!;
      }
      const value = text(child(c, "value")?.items[1]);
      if (value) f.Value = value;
      const inst = instanceOf(f, ref, byRef);
      refToInst.set(ref, inst);
      parts[inst] = { refdes: ref, footprint: text(child(c, "footprint")?.items[1]) ?? "", fields: compared(f) };
    }
  }
  const nets: Record<string, Set<string>> = {};
  for (const ns of children(doc, "nets")) {
    for (const n of children(ns, "net")) {
      const name = text(child(n, "name")?.items[1]) ?? "";
      if (!name || /^unconnected-/.test(name)) continue;
      for (const node of children(n, "node")) {
        const ref = text(child(node, "ref")?.items[1]) ?? "";
        const pin = text(child(node, "pin")?.items[1]) ?? "";
        if (!ref || ref.startsWith("#") || !pin) continue;
        (nets[name] ??= new Set()).add(`${refToInst.get(ref) ?? byRef.get(ref) ?? `?${ref}`}.${pin}`);
      }
    }
  }
  return { parts, nets: sortNets(nets) };
}

// ---------------------------------------------------------------------------
// Differences
// ---------------------------------------------------------------------------

export type ChangeKind = "part_added" | "part_removed" | "footprint" | "field" | "net_renamed" | "connection";

export interface Change {
  kind: ChangeKind;
  /** Identity across the model and KiCad sides: the same change made on both has the same key. */
  key: string;
  instance?: string;
  message: string;
}

const normNet = (s: string) => s.replace(/^\//, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
const instOfPin = (p: string) => p.slice(0, p.lastIndexOf("."));

/** pin → its net's name and its peers (pins sharing the net), over pins whose part is in `keep`; nets of one such pin dropped. */
function groups(n: Netlist, keep: Set<string>): Map<string, { net: string; peers: string[] }> {
  const out = new Map<string, { net: string; peers: string[] }>();
  for (const [name, pins] of Object.entries(n.nets)) {
    const kept = pins.filter((p) => keep.has(instOfPin(p)));
    if (kept.length < 2) continue;
    for (const p of kept) {
      const prev = out.get(p);
      const peers = kept.filter((x) => x !== p);
      // a pin on two nets (cannot happen in copper; a hand-edited file): keep the larger group
      if (!prev || prev.peers.length < peers.length) out.set(p, { net: name, peers });
    }
  }
  return out;
}

/**
 * Pins that changed nets from `a` to `b`. Nets are matched one to one by the
 * pins they share (largest overlap first), so moving one pin reports that pin,
 * not every pin of the two nets it touched. `to` identifies the destination
 * the same way on any side: the pins of the matched net in `a`, or `new:` and
 * the pins of a net `a` has no match for.
 */
function movedPins(a: Map<string, { net: string; peers: string[] }>, b: Map<string, { net: string; peers: string[] }>): { pin: string; fromNet?: string; toNet?: string; to: string; with: string[] }[] {
  const nets = (g: Map<string, { net: string; peers: string[] }>) => {
    const m = new Map<string, Set<string>>();
    for (const [p, { net }] of g) (m.get(net) ?? m.set(net, new Set()).get(net)!).add(p);
    return m;
  };
  const [na, nb] = [nets(a), nets(b)];
  const pairs: { x: string; y: string; n: number }[] = [];
  for (const [y, pins] of nb) {
    const count = new Map<string, number>();
    for (const p of pins) {
      const x = a.get(p)?.net;
      if (x !== undefined) count.set(x, (count.get(x) ?? 0) + 1);
    }
    for (const [x, n] of count) pairs.push({ x, y, n });
  }
  pairs.sort((p, q) => q.n - p.n || p.x.localeCompare(q.x) || p.y.localeCompare(q.y));
  const match = new Map<string, string>(); // b net → a net
  const taken = new Set<string>();
  for (const { x, y } of pairs) if (!match.has(y) && !taken.has(x)) (match.set(y, x), taken.add(x));
  const out: { pin: string; fromNet?: string; toNet?: string; to: string; with: string[] }[] = [];
  for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const from = a.get(p)?.net;
    const toNet = b.get(p)?.net;
    const origin = toNet === undefined ? undefined : match.get(toNet);
    if (from === origin && (from !== undefined || toNet === undefined)) continue;
    const to = toNet === undefined ? "none" : origin !== undefined ? [...na.get(origin)!].sort().join("|") : `new:${[...nb.get(toNet)!].sort().join("|")}`;
    out.push({ pin: p, fromNet: from, toNet, to, with: b.get(p)?.peers ?? [] });
  }
  return out;
}

const list3 = (xs: string[], n = 4) => `${xs.slice(0, n).join(", ")}${xs.length > n ? ` (+${xs.length - n})` : ""}`;

/** What changed from `base` to `now`: parts, footprints, fields, renamed nets and moved pins. */
export function diffNetlists(base: Netlist, now: Netlist): Change[] {
  const out: Change[] = [];
  const both = new Set(Object.keys(base.parts).filter((i) => now.parts[i]));
  for (const i of Object.keys(now.parts).sort()) if (!base.parts[i]) out.push({ kind: "part_added", key: `part+:${i}`, instance: i, message: `${i} (${now.parts[i].refdes || "no designator"}) added` });
  for (const i of Object.keys(base.parts).sort()) if (!now.parts[i]) out.push({ kind: "part_removed", key: `part-:${i}`, instance: i, message: `${i} (${base.parts[i].refdes}) removed` });
  for (const i of [...both].sort()) {
    const [a, b] = [base.parts[i], now.parts[i]];
    if (a.footprint !== b.footprint) out.push({ kind: "footprint", key: `fp:${i}:${b.footprint}`, instance: i, message: `${i} (${b.refdes}) footprint ${a.footprint} → ${b.footprint}` });
    for (const k of COMPARED_FIELDS) {
      if ((a.fields[k] ?? "") !== (b.fields[k] ?? "")) out.push({ kind: "field", key: `field:${i}:${k}:${b.fields[k] ?? ""}`, instance: i, message: `${i} (${b.refdes}) ${k} "${a.fields[k] ?? ""}" → "${b.fields[k] ?? ""}"` });
    }
  }
  // nets, over the parts on both sides
  const ga = groups(base, both);
  const gb = groups(now, both);
  const pinSet = (n: Netlist, name: string) => (n.nets[name] ?? []).filter((p) => both.has(instOfPin(p))).join("|");
  const renamedFrom = new Set<string>();
  const baseByPins = new Map<string, string>();
  for (const name of Object.keys(base.nets)) {
    const k = pinSet(base, name);
    if (k.includes("|")) baseByPins.set(k, name);
  }
  for (const name of Object.keys(now.nets).sort()) {
    const k = pinSet(now, name);
    const was = baseByPins.get(k);
    if (was !== undefined && was !== name && normNet(was) !== normNet(name)) {
      out.push({ kind: "net_renamed", key: `rename:${k}:${normNet(name)}`, message: `net ${was} renamed ${name} (${list3(k.split("|"))})` });
      renamedFrom.add(was);
    }
  }
  for (const m of movedPins(ga, gb)) {
    out.push({ kind: "connection", key: `conn:${m.pin}:${m.to}`, instance: instOfPin(m.pin), message: `pin ${m.pin}: ${m.fromNet ?? "no net"} → ${m.toNet ?? "no net"}${m.toNet && m.with.length ? ` (with ${list3(m.with, 3)})` : ""}` });
  }
  return out;
}

/** The parts a schematic and a board disagree on (missing on one side, other footprint). */
export function parityProblems(sch: Record<string, PartRecord>, pcb: Record<string, PartRecord>): string[] {
  const out: string[] = [];
  for (const i of Object.keys(sch).sort()) {
    if (!pcb[i]) out.push(`${sch[i].refdes} (${i}) is in the schematic but not on the board`);
    else if (sch[i].footprint && sch[i].footprint !== pcb[i].footprint) out.push(`${sch[i].refdes} (${i}): schematic footprint ${sch[i].footprint}, board ${pcb[i].footprint}`);
  }
  for (const i of Object.keys(pcb).sort()) if (!sch[i]) out.push(`${pcb[i].refdes} (${i}) is on the board but not in the schematic`);
  return out;
}

/** Nets the schematic and the board group differently (names aside). */
export function netParity(sch: Netlist, pcb: Netlist): string[] {
  const keep = new Set([...Object.keys(sch.parts), ...Object.keys(pcb.parts)]);
  return movedPins(groups(sch, keep), groups(pcb, keep)).map((m) => `pin ${m.pin}: schematic ${m.fromNet ?? "no net"}, board ${m.toNet ?? "no net"}`);
}

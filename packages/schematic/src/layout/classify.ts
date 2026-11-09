/**
 * Layout stage 1 and 2 (contract section 7): classify nets and parts, and group parts into cards.
 *
 * Net classes: `ground` and `rail` (drawn as power symbols), `bus` (a signal net between pins of more than two
 * parts), `signal`; each net is local to one card or crosses cards. Part roles: an `anchor` (a part with more than
 * two symbol pins, or a connector or switch with no other anchor near) or a satellite whose role says how it hangs
 * off the pin it serves.
 */
import { byCodeUnit } from "@protoboardai/board";
import { pinKey, splitPinKey, type CircuitPart } from "../circuit.ts";
import { isRail, recordsOfKind, type SchematicDocument } from "../document.ts";
import { resolveSymbol } from "../symbols.ts";

export type SatelliteRole =
  | "decoupling" // capacitor between a supply rail and ground, beside the supply pin it serves
  | "pull_up" // two-terminal part from a signal to a supply rail
  | "pull_down" // two-terminal part from a signal to ground (resistor, LED, switch, capacitor)
  | "series" // two-terminal part between two signals, in line
  | "rail_shunt" // between two rails, nothing to serve
  | "power_series" // in line between two supply rails (a fuse, a ferrite bead, a reverse-polarity diode, a power inductor)
  | "probe" // a one-pin part on a net (a test point, a pad), beside the pin it probes
  | "free"; // nothing ties it to a pin

export interface PartInfo {
  path: string;
  part: CircuitPart;
  card: string;
  anchor: boolean;
  role?: SatelliteRole;
  /** the anchor pin (pin key) or port net (`port:<net>`) it serves */
  serves?: string;
  /** symbol pin count */
  symbolPins: number;
  /** the card its UHD sub-module gives it (before any regroup) */
  home: string;
}

export interface NetInfoL {
  name: string;
  cls: "ground" | "rail" | "bus" | "signal";
  cards: string[];
  /** pins per card */
  pinsIn: Map<string, string[]>;
}

export interface Classification {
  parts: Map<string, PartInfo>;
  nets: Map<string, NetInfoL>;
  /** card id -> member part paths, sorted */
  cards: Map<string, string[]>;
  /** card id -> UHD group path */
  groupOf: Map<string, string>;
}

const TWO_TERMINAL = new Set(["resistor", "capacitor", "inductor", "ferrite_bead", "led", "diode", "crystal", "switch"]);

/** A first-level sub-module with more parts than this splits into its nested sub-modules (one card each). */
export const SPLIT_PARTS = 20;

/**
 * The card key a part goes to: its first-level UHD sub-module, or the board's root. A first-level sub-module in
 * `split` (a large one with nested sub-modules) gives each nested sub-module its own card; its own parts keep the
 * first-level card.
 */
export function cardKeyOf(part: CircuitPart, split?: ReadonlySet<string>): string {
  if (!part.group) return "root";
  const seg = part.group.split("/");
  return split?.has(seg[0]) && seg.length > 1 ? `${seg[0]}/${seg[1]}` : seg[0];
}

/** The first-level sub-modules large enough to split into their nested sub-modules. */
export function splitGroups(parts: readonly CircuitPart[]): Set<string> {
  const count = new Map<string, number>();
  const nested = new Set<string>();
  for (const p of parts) {
    if (!p.group) continue;
    const seg = p.group.split("/");
    count.set(seg[0], (count.get(seg[0]) ?? 0) + 1);
    if (seg.length > 1) nested.add(seg[0]);
  }
  return new Set([...nested].filter((g) => (count.get(g) ?? 0) > SPLIT_PARTS));
}

export function classify(doc: SchematicDocument): Classification {
  const hit = classCache.get(doc);
  if (hit) return hit;
  const symCard = new Map(recordsOfKind(doc, "symbol").map((s) => [s.part, s.card]));
  const parts = new Map<string, PartInfo>();
  const split = splitGroups(doc.circuit.parts);
  for (const p of doc.circuit.parts) {
    const pins = resolveSymbol(p).pins.length;
    const anchor = (!(TWO_TERMINAL.has(p.class) && pins <= 2) || pins > 2) && pins > 1;
    const home = `card:${cardKeyOf(p, split)}`;
    parts.set(p.path, { path: p.path, part: p, card: symCard.get(p.path) ?? home, anchor, symbolPins: pins, home });
  }
  // root parts with no sub-module: one card per anchor with what hangs on it (decided from the circuit alone, so a
  // part's home card does not depend on where it is drawn; a symbol keeps the card it names)
  const rootAnchors = [...parts.values()].filter((i) => i.home === "card:root" && i.anchor);
  if (rootAnchors.length > 1) {
    for (const a of rootAnchors) {
      a.home = `card:${a.path.replace(/[^A-Za-z0-9_.\-/+~]/g, "_")}`;
      if (!symCard.has(a.path)) a.card = a.home;
    }
    for (const i of parts.values()) {
      if (i.home !== "card:root" || i.anchor) continue;
      const near = nearestAnchor(doc, i.part, rootAnchors.map((a) => a.path));
      if (!near) continue;
      i.home = parts.get(near)!.home;
      if (!symCard.has(i.path)) i.card = i.home;
    }
  }

  const cards = new Map<string, string[]>();
  for (const i of [...parts.values()].sort((a, b) => byCodeUnit(a.path, b.path))) {
    const l = cards.get(i.card) ?? [];
    l.push(i.path);
    cards.set(i.card, l);
  }
  const groupOf = new Map<string, string>();
  for (const [c, members] of cards) {
    const groups = members.map((m) => {
      const seg = parts.get(m)!.part.group.split("/");
      return split.has(seg[0]) && seg.length > 1 ? `${seg[0]}/${seg[1]}` : seg[0];
    });
    groupOf.set(c, groups.sort(byCodeUnit)[0] ?? "");
  }
  // nets
  const nets = new Map<string, NetInfoL>();
  for (const n of doc.circuit.nets) {
    const pinsIn = new Map<string, string[]>();
    for (const k of n.pins) {
      const c = parts.get(splitPinKey(k).part)?.card;
      if (!c) continue;
      const l = pinsIn.get(c) ?? [];
      l.push(k);
      pinsIn.set(c, l);
    }
    const rail = isRail(doc, n.name);
    const partsOn = new Set(n.pins.map((k) => splitPinKey(k).part));
    nets.set(n.name, { name: n.name, cls: rail ? (n.kind === "ground" ? "ground" : "rail") : partsOn.size > 2 ? "bus" : "signal", cards: [...pinsIn.keys()].sort(byCodeUnit), pinsIn });
  }
  // satellite roles
  const decoupling: { info: PartInfo; rail: string }[] = [];
  for (const i of parts.values()) {
    if (i.anchor) continue;
    const p = i.part;
    const netsOf = p.pins.map((x) => doc.pinNets.get(pinKey(p.path, x.id)));
    const distinctNets = [...new Set(netsOf.filter((n): n is string => !!n))];
    if (i.symbolPins === 1 && distinctNets.length === 1) {
      i.role = "probe";
      const s = servedSignal(doc, parts, nets, i.card, distinctNets[0], p.path);
      if (s) i.serves = s;
      continue;
    }
    if (distinctNets.length < 2) {
      i.role = "free";
      continue;
    }
    const [na, nb] = distinctNets;
    const ca = nets.get(na)!.cls;
    const cb = nets.get(nb)!.cls;
    const railA = ca === "ground" || ca === "rail";
    const railB = cb === "ground" || cb === "rail";
    if (railA && railB) {
      const supply = ca === "rail" ? na : cb === "rail" ? nb : undefined;
      const ground = ca === "ground" || cb === "ground";
      if (p.class === "capacitor" && supply && ground) {
        i.role = "decoupling";
        decoupling.push({ info: i, rail: supply });
      } else i.role = !ground && ["resistor", "inductor", "ferrite_bead", "diode"].includes(p.class) ? "power_series" : "rail_shunt";
      continue;
    }
    if (railA || railB) {
      const rail = railA ? na : nb;
      const sig = railA ? nb : na;
      i.role = nets.get(rail)!.cls === "ground" ? "pull_down" : "pull_up";
      const s = servedSignal(doc, parts, nets, i.card, sig, p.path);
      if (s) i.serves = s;
      continue;
    }
    i.role = "series";
    const s = servedSignal(doc, parts, nets, i.card, na, p.path) ?? servedSignal(doc, parts, nets, i.card, nb, p.path);
    if (s) i.serves = s;
  }
  // decoupling capacitors are shared out over the supply pins of their rail in their card, in natural order, so
  // a row of sixteen LEDs with sixteen capacitors gives each LED its own (a part with three supply pins takes three shares)
  const byRail = new Map<string, PartInfo[]>();
  for (const d of decoupling) {
    const k = `${d.info.card}|${d.rail}`;
    byRail.set(k, [...(byRail.get(k) ?? []), d.info]);
  }
  for (const [k, caps] of byRail) {
    const [card, rail] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const pins = servedSupplyPins(doc, parts, card, rail);
    if (!pins.length) continue;
    caps.sort((a, b) => natural(refOf(a.part), refOf(b.part)) || byCodeUnit(a.path, b.path));
    const load = new Map<string, number>();
    for (const c of caps) {
      let best = pins[0];
      for (const p of pins) if ((load.get(p) ?? 0) < (load.get(best) ?? 0)) best = p;
      c.serves = best;
      load.set(best, (load.get(best) ?? 0) + 1);
    }
  }
  const out = { parts, nets, cards, groupOf };
  classCache.set(doc, out);
  return out;
}

const classCache = new WeakMap<SchematicDocument, Classification>();

const refOf = (p: CircuitPart) => p.ref ?? p.path.split("/").pop()!;
/** Natural order: digits compare as numbers ("C2" before "C10"). */
export function natural(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const x = a.match(re) ?? [];
  const y = b.match(re) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i], y[i]];
    if (p === q) continue;
    const [np, nq] = [/^\d/.test(p), /^\d/.test(q)];
    if (np && nq) return Number(p) - Number(q) || p.length - q.length;
    return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * The anchor pins in this card on the supply rail decoupling capacitors serve, best pin type first (supply inputs,
 * then outputs), in natural order of their part's reference. A part with several supply pins on the rail is listed
 * once per pin, so it takes that many shares.
 */
function servedSupplyPins(doc: SchematicDocument, parts: Map<string, PartInfo>, card: string, rail: string): string[] {
  const net = doc.nets.get(rail);
  if (!net) return [];
  const cands = net.pins
    .filter((k) => {
      const i = parts.get(splitPinKey(k).part);
      return i?.anchor && i.card === card;
    })
    .map((k) => {
      const { part, pin } = splitPinKey(k);
      const t = doc.parts.get(part)!.pins.find((x) => x.id === pin)!.type;
      return { k, part, rank: t === "power_in" ? 0 : t === "power_out" ? 1 : 2 };
    });
  if (!cands.length) return [];
  const best = Math.min(...cands.map((c) => c.rank));
  return cands
    .filter((c) => c.rank === best)
    .sort((a, b) => natural(refOf(doc.parts.get(a.part)!), refOf(doc.parts.get(b.part)!)) || byCodeUnit(a.k, b.k))
    .map((c) => c.k);
}

/** What a satellite on a signal net serves: an anchor pin in its card, else the port of a net that leaves the card, else a neighbor satellite. */
function servedSignal(doc: SchematicDocument, parts: Map<string, PartInfo>, nets: Map<string, NetInfoL>, card: string, sig: string, self: string): string | undefined {
  const net = doc.nets.get(sig)!;
  const anchorPins = net.pins.filter((k) => {
    const i = parts.get(splitPinKey(k).part);
    return i?.anchor && i.card === card;
  });
  // the anchor the layout reaches first: most pins, then path (the order clusters are built in)
  if (anchorPins.length) return anchorPins.sort((a, b) => parts.get(splitPinKey(b).part)!.symbolPins - parts.get(splitPinKey(a).part)!.symbolPins || byCodeUnit(a, b))[0];
  if (nets.get(sig)!.cards.length > 1) return `port:${sig}`;
  const other = net.pins.find((k) => splitPinKey(k).part !== self && parts.get(splitPinKey(k).part)?.card === card);
  return other ? `sat:${other}` : undefined;
}

function nearestAnchor(doc: SchematicDocument, part: CircuitPart, anchors: string[]): string | undefined {
  // breadth-first over signal nets, through two-terminal parts
  const seen = new Set([part.path]);
  let frontier = [part.path];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      const p = doc.parts.get(path)!;
      for (const pin of p.pins) {
        const net = doc.pinNets.get(pinKey(path, pin.id));
        if (!net || isRail(doc, net)) continue;
        for (const k of doc.nets.get(net)!.pins) {
          const other = splitPinKey(k).part;
          if (anchors.includes(other)) return other;
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
    }
    frontier = next.sort(byCodeUnit);
  }
  return undefined;
}

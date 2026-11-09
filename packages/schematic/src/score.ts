/**
 * The readability score (contract section 11): thirty measured rules, numbered defects with locations, a score
 * per sheet and per card. Each rule counts what fails over its opportunities; `f = min(1, count / opportunities)`;
 * weights gate 10, error 5, warning 2, info 0.5; `score = clamp(round(100 - 10 * sum(weight * f)), 0, 100)`.
 * A sheet with an open gate (C01 to C06) is not presentable whatever its score.
 */
import { byCodeUnit } from "@protoboardai/board";
import type { OpCall } from "@protoboardai/board";
import { splitPinKey, valueHasUnit } from "./circuit.ts";
import { isRail, recordsOfKind, settingsOf, type SchematicDocument } from "./document.ts";
import {
  boxCenter,
  boxContainsPoint,
  boxesOverlap,
  boxGap,
  cardTitleBoxes,
  crossing,
  drawnNetlist,
  geometryOf,
  labelBox,
  onSegment,
  powerBoxes,
  segmentThroughBox,
  type Segment,
} from "./geometry.ts";
import { classify } from "./layout/classify.ts";
import type { LBox } from "./symbols.ts";
import type { XY } from "./units.ts";

export type RuleSeverity = "gate" | "error" | "warning" | "info";
export const WEIGHT: Record<RuleSeverity, number> = { gate: 10, error: 5, warning: 2, info: 0.5 };
/**
 * The fewest opportunities a non-gate rule's failure fraction is taken over: `f = min(1, count / max(opportunities,
 * OPPORTUNITY_FLOOR))`. A rule with one or two chances on a sheet (signal flow between two cards, two instances of a
 * channel, four title block fields) would otherwise cost 10 to 20 points for a single defect; with the floor one
 * defect costs at most a tenth of the rule's weight. Gates are not floored: any open gate keeps the sheet unpresentable.
 */
export const OPPORTUNITY_FLOOR = 10;
/** A rule's failure fraction (contract section 11). */
export const failFraction = (severity: RuleSeverity, count: number, opportunities: number): number => (opportunities ? Math.min(1, count / (severity === "gate" ? opportunities : Math.max(opportunities, OPPORTUNITY_FLOOR))) : 0);

export interface RuleDef {
  id: string;
  title: string;
  severity: RuleSeverity;
}

export const RULES: RuleDef[] = [
  { id: "C01", title: "Drawn netlist equals UHD", severity: "gate" },
  { id: "C02", title: "No overlapping boxes", severity: "gate" },
  { id: "C03", title: "No wire through a body or text", severity: "gate" },
  { id: "C04", title: "No label or text on a foreign pin", severity: "gate" },
  { id: "C05", title: "No dangling end; open pins marked", severity: "gate" },
  { id: "C06", title: "No accidental merge", severity: "gate" },
  { id: "C07", title: "Rails drawn as power symbols", severity: "error" },
  { id: "C08", title: "Wire inside a card (no label islands)", severity: "error" },
  { id: "C09", title: "Labels across cards, not wires", severity: "warning" },
  { id: "C10", title: "Ground down, supplies up", severity: "error" },
  { id: "C11", title: "Rail pin faces its rail", severity: "warning" },
  { id: "C12", title: "Decoupling beside its supply pin", severity: "warning" },
  { id: "C13", title: "Satellites beside the pin they serve", severity: "warning" },
  { id: "C14", title: "Signal flow left to right", severity: "warning" },
  { id: "C15", title: "Power flows down or right", severity: "warning" },
  { id: "C16", title: "Few crossings", severity: "warning" },
  { id: "C17", title: "No four-way junctions", severity: "error" },
  { id: "C18", title: "Few bends", severity: "info" },
  { id: "C19", title: "No long wires", severity: "warning" },
  { id: "C20", title: "Every part in one card; cards apart", severity: "error" },
  { id: "C21", title: "Every card titled", severity: "warning" },
  { id: "C22", title: "Labels read outward", severity: "warning" },
  { id: "C23", title: "Fields nearest their part", severity: "warning" },
  { id: "C24", title: "Designators unique; values with units", severity: "error" },
  { id: "C25", title: "On grid", severity: "error" },
  { id: "C26", title: "Generated symbol pin sides", severity: "info" },
  { id: "C27", title: "Repeated subcircuits alike", severity: "warning" },
  { id: "C28", title: "Net named once at a point", severity: "warning" },
  { id: "C29", title: "Sheet fill", severity: "info" },
  { id: "C30", title: "Title block filled", severity: "info" },
];

export interface Defect {
  /** marker number, shared with the image and the scene */
  n: number;
  id: string;
  rule: string;
  severity: RuleSeverity;
  card?: string;
  at: XY;
  box?: [number, number, number, number];
  objects: string[];
  message: string;
  suggest?: OpCall[];
}

export interface RuleResult {
  id: string;
  title: string;
  severity: RuleSeverity;
  count: number;
  opportunities: number;
  f: number;
}

export interface Score {
  score: number;
  presentable: boolean;
  gates: { open: number; rules: string[] };
  rules: RuleResult[];
  defects: Defect[];
  cards: Record<string, number>;
}

interface Acc {
  count: number;
  opp: number;
  oppByCard: Map<string, number>;
  countByCard: Map<string, number>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Score a schematic. */
export function scoreSchematic(doc: SchematicDocument): Score {
  const g = geometryOf(doc);
  const cls = classify(doc);
  const cards = recordsOfKind(doc, "card");
  const wires = recordsOfKind(doc, "wire");
  const labels = recordsOfKind(doc, "label");
  const powers = recordsOfKind(doc, "power");
  const settings = settingsOf(doc);
  const cardBox = (c: { x: number; y: number; w: number; h: number }): LBox => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h });
  const cardAt = (p: XY): string | undefined => cards.find((c) => boxContainsPoint(cardBox(c), p))?.id;
  const acc = new Map<string, Acc>(RULES.map((r) => [r.id, { count: 0, opp: 0, oppByCard: new Map(), countByCard: new Map() }]));
  const raw: Omit<Defect, "n" | "id" | "severity">[] = [];
  const opp = (rule: string, n = 1, at?: XY | string) => {
    const a = acc.get(rule)!;
    a.opp += n;
    const c = typeof at === "string" ? at : at ? cardAt(at) : undefined;
    if (c) a.oppByCard.set(c, (a.oppByCard.get(c) ?? 0) + n);
  };
  const defect = (rule: string, at: XY, objects: string[], message: string, extra: { box?: LBox; suggest?: OpCall[]; card?: string } = {}) => {
    const a = acc.get(rule)!;
    a.count++;
    const card = extra.card ?? cardAt(at);
    if (card) a.countByCard.set(card, (a.countByCard.get(card) ?? 0) + 1);
    raw.push({ rule, ...(card ? { card } : {}), at: [r1(at[0]), r1(at[1])], ...(extra.box ? { box: [r1(extra.box.x0), r1(extra.box.y0), r1(extra.box.x1), r1(extra.box.y1)] as [number, number, number, number] } : {}), objects: [...objects].sort(byCodeUnit), message, ...(extra.suggest ? { suggest: extra.suggest } : {}) });
  };
  const symbols = [...g.symbols.values()];
  const segs = g.segments;
  const dn = drawnNetlist(doc);
  const wireOnly = drawnNetlist(doc, { byName: false });

  // ---- C01 drawn netlist equals UHD
  for (const n of doc.circuit.nets) {
    const drawn = n.pins.filter((k) => g.pins.has(k));
    if (!drawn.length) continue;
    opp("C01", 1, g.pins.get(drawn[0])!.at);
    const ci = dn.of.get(drawn[0])!;
    const cond = dn.conductors[ci].filter((k) => doc.pinNets.has(k) || true);
    const same = drawn.every((k) => dn.of.get(k) === ci) && cond.every((k) => doc.pinNets.get(k) === n.name);
    if (!same) defect("C01", g.pins.get(drawn[0])!.at, [`net:${n.name}`], `${n.name} is drawn differently from UHD: ${drawn.filter((k) => dn.of.get(k) !== ci).length} of its pins are on other conductors, ${cond.filter((k) => doc.pinNets.get(k) !== n.name).length} other pins are joined to it`);
  }
  // ---- C02 overlaps
  type Owned = { owner: string; box: LBox; what: string };
  const boxes: Owned[] = [];
  for (const s of symbols) {
    boxes.push({ owner: s.rec.id, box: s.body, what: `${s.rec.ref} body` });
    boxes.push({ owner: s.rec.id, box: s.ref, what: `${s.rec.ref} reference` });
    if (s.value) boxes.push({ owner: s.rec.id, box: s.value, what: `${s.rec.ref} value` });
  }
  for (const l of labels) boxes.push({ owner: l.id, box: labelBox(l, doc), what: `label ${l.net}` });
  for (const p of powers) {
    const b = powerBoxes(p, doc);
    boxes.push({ owner: p.id, box: b.glyph, what: `${p.net} symbol` });
    if (b.text) boxes.push({ owner: p.id, box: b.text, what: `${p.net} symbol text` });
  }
  for (const c of cards) {
    const tb = cardTitleBoxes(c);
    boxes.push({ owner: c.id, box: tb.tag, what: `${c.title} title` });
    if (tb.subtitle) boxes.push({ owner: c.id, box: tb.subtitle, what: `${c.title} subtitle` });
  }
  opp("C02", boxes.length);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.owner === b.owner) continue;
      if (!boxesOverlap(a.box, b.box, 0.1)) continue;
      const at = boxCenter({ x0: Math.max(a.box.x0, b.box.x0), y0: Math.max(a.box.y0, b.box.y0), x1: Math.min(a.box.x1, b.box.x1), y1: Math.min(a.box.y1, b.box.y1) });
      defect("C02", at, [a.owner, b.owner], `${a.what} overlaps ${b.what}`);
    }
  // ---- C03 wire through a body or text
  opp("C03", segs.length);
  const solid: Owned[] = boxes.filter((b) => !b.what.endsWith("subtitle"));
  const labelNet = new Map(labels.map((l) => [l.id, l.net]));
  const powerNet = new Map(powers.map((p) => [p.id, p.net]));
  const solidCells = new Map<string, Owned[]>();
  const cellKeys = (b: LBox) => {
    const out: string[] = [];
    for (let x = Math.floor(b.x0 / 4); x <= Math.floor(b.x1 / 4); x++) for (let y = Math.floor(b.y0 / 4); y <= Math.floor(b.y1 / 4); y++) out.push(`${x},${y}`);
    return out;
  };
  for (const b of solid) for (const k of cellKeys(b.box)) solidCells.set(k, [...(solidCells.get(k) ?? []), b]);
  const solidLookup = (s: Segment): Owned[] => {
    const seen = new Set<Owned>();
    for (const k of cellKeys({ x0: Math.min(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]), x1: Math.max(s.a[0], s.b[0]), y1: Math.max(s.a[1], s.b[1]) })) for (const b of solidCells.get(k) ?? []) seen.add(b);
    return solid.filter((b) => seen.has(b));
  };
  for (const s of segs) {
    const hit = solidLookup(s).find((b) => segmentThroughBox(s, b.box, 0.12) && !(b.owner.startsWith("lbl:") && labelNet.get(b.owner) === s.net) && !(b.owner.startsWith("pwr:") && powerNet.get(b.owner) === s.net));
    if (hit) defect("C03", mid(s), [s.wire, hit.owner], `a ${s.net} wire runs through ${hit.what}`);
  }
  // ---- C04 label or text on a foreign pin
  const pinList = [...g.pins.values()];
  for (const l of labels) {
    opp("C04", 1, [l.x, l.y]);
    const b = labelBox(l, doc);
    const p = pinList.find((q) => q.net !== l.net && boxContainsPoint(b, q.at, -0.05));
    if (p) defect("C04", p.at, [l.id, `pin:${p.key}`], `label ${l.net} covers pin ${p.number} of ${p.part}`);
  }
  for (const s of symbols)
    for (const t of [s.ref, s.value]) {
      if (!t) continue;
      opp("C04", 1, [t.x, t.y]);
      const p = pinList.find((q) => boxContainsPoint(t, q.at, -0.05));
      if (p) defect("C04", p.at, [s.rec.id, `pin:${p.key}`], `${s.rec.ref}'s text covers pin ${p.number} of ${p.part}`);
    }
  // ---- C05 dangling ends and unmarked open pins
  const anchors = new Set<string>([...labels.map((l) => `${l.x},${l.y}`), ...powers.map((p) => `${p.x},${p.y}`), ...pinList.map((p) => `${p.at[0]},${p.at[1]}`)]);
  for (const w of wires)
    for (const end of [w.points[0], w.points[w.points.length - 1]] as XY[]) {
      opp("C05", 1, end);
      if (anchors.has(`${end[0]},${end[1]}`)) continue;
      const onOther = g.lookup.at(end).some((s) => s.wire !== w.id);
      const onSelf = segmentsOf(w).slice(1, -1).some((s) => onSegment(end, s));
      if (!onOther && !onSelf) defect("C05", end, [w.id], `a ${w.net} wire ends on nothing`);
    }
  const ncs = new Set(recordsOfKind(doc, "noconnect").map((n) => n.pin));
  for (const [k, p] of g.pins) {
    opp("C05", 1, p.at);
    if (!p.net) {
      if (!ncs.has(k)) defect("C05", p.at, [`pin:${k}`], `pin ${p.number} (${p.name}) of ${p.part} is open and not marked no-connect`);
      continue;
    }
    const ci = dn.of.get(k)!;
    const alone = dn.conductors[ci].length === 1 && !dn.names[ci].length;
    if (alone && doc.nets.get(p.net)!.pins.length > 1) defect("C05", p.at, [`pin:${k}`], `pin ${p.number} (${p.name}) of ${p.part} is on ${p.net} but nothing is drawn on it`);
  }
  // ---- C06 accidental merges
  for (const w of wires)
    for (const v of w.points as XY[]) {
      opp("C06", 1, v);
      const s = g.lookup.at(v).find((x) => x.net !== w.net);
      const p = pinList.find((q) => q.net !== w.net && q.at[0] === v[0] && q.at[1] === v[1]);
      if (s || p) defect("C06", v, [w.id, ...(s ? [s.wire] : []), ...(p ? [`pin:${p.key}`] : [])], `a ${w.net} wire point lies on ${s ? `a ${s.net} wire` : `pin ${p!.number} of ${p!.part}`}`);
    }
  // ---- C07 rails as power symbols
  const powerConductors = new Set(powers.map((p) => dn.itemOf.get(p.id)));
  const wirePowerConductors = new Set(powers.map((p) => wireOnly.itemOf.get(p.id)));
  for (const [k, p] of g.pins) {
    if (!p.net || !isRail(doc, p.net)) continue;
    opp("C07", 1, p.at);
    if (!wirePowerConductors.has(wireOnly.of.get(k))) defect("C07", p.at, [`pin:${k}`], `${p.net} at pin ${p.number} of ${p.part} does not end in a power symbol`);
  }
  void powerConductors;
  // ---- C08 label islands; C28 named twice
  for (const [netName, info] of cls.nets) {
    if (info.cls === "ground" || info.cls === "rail") continue;
    for (const [card, pins] of info.pinsIn) {
      const drawn = pins.filter((k) => g.pins.has(k));
      const parts = new Set(drawn.map((k) => splitPinKey(k).part));
      if (drawn.length < 2 || parts.size < 2) continue;
      opp("C08", 1, card);
      const comps = new Set(drawn.map((k) => wireOnly.of.get(k)));
      if (comps.size > 1) {
        const at = g.pins.get(drawn[0])!.at;
        defect("C08", at, [`net:${netName}`], `${netName} is drawn with labels inside ${card.slice(5)} (${comps.size} pieces): wire it`, { card, suggest: [{ op: "label.to_wire", net: netName, card }] });
      }
    }
  }
  const namesAt = new Map<number, { id: string; net: string; at: XY }[]>();
  for (const x of [...labels, ...powers]) {
    opp("C28", 1, [x.x, x.y]);
    const ci = wireOnly.itemOf.get(x.id)!;
    const l = namesAt.get(ci) ?? [];
    l.push({ id: x.id, net: x.net, at: [x.x, x.y] });
    namesAt.set(ci, l);
  }
  for (const list of namesAt.values()) for (const extra of list.slice(1)) defect("C28", extra.at, list.map((x) => x.id), `${extra.net} is named ${list.length} times on one drawn conductor`);
  // ---- C09 wires leaving their card
  for (const s of segs) {
    const w = wires.find((x) => x.id === s.wire)!;
    const c = cards.find((x) => x.id === w.card);
    opp("C09", 1, w.card);
    if (c && (!boxContainsPoint(cardBox(c), s.a) || !boxContainsPoint(cardBox(c), s.b))) defect("C09", mid(s), [s.wire, c.id], `a ${s.net} wire leaves ${c.title}`);
  }
  // ---- C10 power symbol direction
  for (const p of powers) {
    opp("C10", 1, [p.x, p.y]);
    const want = p.style === "ground" ? "down" : "up";
    if (p.dir !== want) defect("C10", [p.x, p.y], [p.id], `${p.net} points ${p.dir}`, { suggest: [{ op: "power.delete", ids: [p.id] }, { op: "power.add", symbols: [{ net: p.net, card: p.card, x: p.x, y: p.y, dir: want, style: p.style }] }] });
  }
  // ---- C11 two-pin parts face their rails
  for (const s of symbols) {
    // two-terminal parts drawn with their own symbol (a resistor, a capacitor, an LED); a generated box with two
    // contacts (a two-way terminal block) draws its contacts on one side and has no rail side to face
    if (s.pins.length !== 2 || !s.resolved.family.startsWith("pack:")) continue;
    const railPins = s.pins.filter((p) => p.net && isRail(doc, p.net));
    if (!railPins.length || railPins.length === 2 && railPins[0].net === railPins[1].net) continue;
    opp("C11", 1, s.center);
    const bad = railPins.some((p) => (doc.nets.get(p.net!)!.kind === "ground" ? p.dir !== "down" : p.dir !== "up"));
    if (bad) defect("C11", s.center, [s.rec.id], `${s.rec.ref} does not face its rail (${railPins.map((p) => `${p.net} pin points ${p.dir}`).join(", ")})`, { suggest: [{ op: "symbol.rotate", ids: [s.rec.id], angle: 180 }] });
  }
  // ---- C12 decoupling, C13 satellites
  for (const [path, info] of cls.parts) {
    const s = g.symbols.get(`sym:${path}`);
    if (!s || info.anchor || !info.role) continue;
    if (info.role === "decoupling") {
      opp("C12", 1, s.center);
      if (!info.serves) continue;
      const served = g.pins.get(info.serves);
      if (!served) continue;
      const servedCard = g.symbols.get(`sym:${splitPinKey(info.serves).part}`)?.rec.card;
      const capPin = s.pins.find((p) => p.net === served.net);
      const d = capPin ? Math.round(boxGap(s.body, { x0: served.at[0], y0: served.at[1], x1: served.at[0], y1: served.at[1] }) * 10) / 10 : Infinity;
      const wired = capPin && wireOnly.of.get(capPin.key) === wireOnly.of.get(info.serves);
      if (servedCard !== s.rec.card || d > 6 || !wired) defect("C12", s.center, [s.rec.id, `pin:${info.serves}`], `${s.rec.ref} is ${servedCard !== s.rec.card ? "in another card than" : !wired ? "not wired to" : `${d} units from`} the ${served.name} pin it decouples`, { suggest: moveToward(s.rec.id, s.center, served.at) });
    } else if (info.role === "pull_up" || info.role === "pull_down" || info.role === "series") {
      opp("C13", 1, s.center);
      if (!info.serves) continue;
      let target: XY | undefined;
      if (info.serves.startsWith("port:")) {
        const net = info.serves.slice(5);
        const l = labels.find((x) => x.net === net && x.card === s.rec.card);
        target = l ? [l.x, l.y] : undefined;
      } else if (info.serves.startsWith("sat:")) target = g.pins.get(info.serves.slice(4))?.at;
      else target = g.pins.get(info.serves)?.at;
      if (!target) continue;
      const d = boxGap(s.body, { x0: target[0], y0: target[1], x1: target[0], y1: target[1] });
      if (d > 8) defect("C13", s.center, [s.rec.id], `${s.rec.ref} (${info.role.replace("_", "-")}) is ${Math.round(d)} units from what it serves`, { suggest: moveToward(s.rec.id, s.center, target) });
    }
  }
  // ---- C14 signal flow, C15 power flow
  const cardOfPin = (k: string) => g.symbols.get(`sym:${splitPinKey(k).part}`)?.rec.card;
  const cardRec = (id: string | undefined) => cards.find((c) => c.id === id);
  for (const n of doc.circuit.nets) {
    if (isRail(doc, n.name)) continue;
    const typeOf = (k: string) => doc.parts.get(splitPinKey(k).part)!.pins.find((p) => p.id === splitPinKey(k).pin)!.type;
    const src = n.pins.filter((k) => ["output", "analog_out"].includes(typeOf(k)) && g.pins.has(k));
    const dst = n.pins.filter((k) => ["input", "analog_in"].includes(typeOf(k)) && g.pins.has(k));
    for (const a of src)
      for (const b of dst) {
        if (splitPinKey(a).part === splitPinKey(b).part) continue;
        const pa = g.pins.get(a)!;
        const pb = g.pins.get(b)!;
        opp("C14", 1, pa.at);
        const ca = cardOfPin(a);
        const cb = cardOfPin(b);
        const xa = ca === cb ? pa.at[0] : (cardRec(ca)?.x ?? pa.at[0]);
        const xb = ca === cb ? pb.at[0] : (cardRec(cb)?.x ?? pb.at[0]);
        if (xb < xa - 0.5) defect("C14", pb.at, [`pin:${a}`, `pin:${b}`], `${n.name} flows right to left: ${pa.part} drives ${pb.part}, which sits to its left`);
      }
  }
  for (const n of doc.circuit.nets) {
    if (!isRail(doc, n.name) || doc.nets.get(n.name)!.kind === "ground") continue;
    const typeOf = (k: string) => doc.parts.get(splitPinKey(k).part)!.pins.find((p) => p.id === splitPinKey(k).pin)!.type;
    const srcCards = new Set(n.pins.filter((k) => typeOf(k) === "power_out").map(cardOfPin));
    const dstCards = new Set(n.pins.filter((k) => typeOf(k) === "power_in").map(cardOfPin));
    for (const a of srcCards)
      for (const b of dstCards) {
        if (!a || !b || a === b) continue;
        const A = cardRec(a)!;
        const B = cardRec(b)!;
        opp("C15", 1, b);
        const left = B.x + B.w <= A.x;
        const above = B.y + B.h <= A.y && B.x < A.x + A.w;
        if (left || above) defect("C15", [B.x + 1, B.y + 1], [a, b], `${n.name} flows from ${A.title} up or left to ${B.title}`, { card: b });
      }
  }
  // ---- C16 crossings
  const crossings: { at: XY; a: Segment; b: Segment }[] = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].net === segs[j].net) continue;
      const x = crossing(segs[i], segs[j]);
      if (x) crossings.push({ at: x, a: segs[i], b: segs[j] });
    }
  const allowed = Math.max(2, Math.floor(doc.circuit.nets.length / 10));
  opp("C16", doc.circuit.nets.length);
  crossings.slice(allowed).forEach((c) => defect("C16", c.at, [c.a.wire, c.b.wire], `${c.a.net} crosses ${c.b.net}`));
  // ---- C17 four-way junctions
  opp("C17", Math.max(1, g.junctions.length));
  for (const j of g.junctions) if (j.degree >= 4) defect("C17", j.at, [`net:${j.net}`], `${j.net} meets four ways here`);
  // ---- C18 bends, C19 long wires
  for (const w of wires) {
    opp("C18", 1, w.points[0] as XY);
    opp("C19", 1, w.card);
    const bends = Math.max(0, w.points.length - 2);
    if (bends > 2) defect("C18", w.points[1] as XY, [w.id], `a ${w.net} wire bends ${bends} times`);
    const len = w.points.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - w.points[i][0]) + Math.abs(p[1] - w.points[i][1]), 0);
    const c = cardRec(w.card);
    const limit = Math.max(12, 0.4 * (c?.w ?? 30));
    const through = segmentsOf(w).find((s) => symbols.some((sy) => segmentThroughBox(s, sy.full, 0.3) && !sy.pins.some((p) => p.net === w.net)));
    if (len > limit || through) defect("C19", w.points[0] as XY, [w.id], len > limit ? `a ${w.net} wire is ${len} units long` : `a ${w.net} wire passes over another part`);
  }
  // ---- C20 parts in cards; cards apart
  for (const s of symbols) {
    opp("C20", 1, s.rec.card);
    const c = cardRec(s.rec.card);
    if (!c) defect("C20", s.center, [s.rec.id], `${s.rec.ref} names a card that does not exist`);
    else if (!boxContainsPoint(cardBox(c), [s.body.x0, s.body.y0], 0.01) || !boxContainsPoint(cardBox(c), [s.body.x1, s.body.y1], 0.01)) defect("C20", s.center, [s.rec.id, c.id], `${s.rec.ref} sticks out of ${c.title}`);
    const home = cls.parts.get(s.part.path)?.home ?? "card:root";
    if (cards.some((x) => x.id === home) && home !== s.rec.card) defect("C20", s.center, [s.rec.id], `${s.rec.ref} is regrouped into ${s.rec.card.slice(5)}; its UHD sub-module is ${home.slice(5)}`);
  }
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      opp("C20", 1);
      const a = cardBox(cards[i]);
      const b = cardBox(cards[j]);
      const gap = Math.max(Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      if (gap < settings.gutter - 1e-6) defect("C20", boxCenter({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }), [cards[i].id, cards[j].id], gap < 0 ? `${cards[i].title} and ${cards[j].title} overlap` : `${cards[i].title} and ${cards[j].title} are ${r1(gap)} apart (gutter ${settings.gutter})`);
    }
  // ---- C21 titles
  for (const c of cards) {
    opp("C21", 1, c.id);
    const tb = cardTitleBoxes(c);
    if (!c.title.trim() || tb.tag.x1 > c.x + c.w) defect("C21", [c.x + 1, c.y + 1], [c.id], !c.title.trim() ? "a card has no title" : `${c.title}'s title is wider than its card`);
  }
  // ---- C22 labels read outward
  for (const l of labels) {
    opp("C22", 1, [l.x, l.y]);
    const b = labelBox(l, doc);
    const own = segs.find((s) => s.net === l.net && segmentThroughBox(s, b, 0.15));
    if (own) defect("C22", [l.x, l.y], [l.id, own.wire], `label ${l.net} runs back over its own wire`);
  }
  // ---- C23 fields nearest their part
  for (const s of symbols)
    for (const t of [s.ref, s.value]) {
      if (!t) continue;
      opp("C23", 1, [t.x, t.y]);
      const own = boxGap(t, s.body);
      const other = symbols.find((o) => o !== s && boxGap(t, o.body) < own - 0.3);
      if (other) defect("C23", [t.x, t.y], [s.rec.id, other.rec.id], `${s.rec.ref}'s ${t === s.ref ? "reference" : "value"} sits closer to ${other.rec.ref}`);
    }
  // ---- C24 designators and values
  const refCount = new Map<string, number>();
  for (const s of symbols) refCount.set(s.rec.ref, (refCount.get(s.rec.ref) ?? 0) + 1);
  for (const s of symbols) {
    opp("C24", 1, s.center);
    if (/\?/.test(s.rec.ref) || (refCount.get(s.rec.ref) ?? 0) > 1) defect("C24", s.center, [s.rec.id], `designator ${s.rec.ref} is ${/\?/.test(s.rec.ref) ? "unassigned" : "used twice"}`);
    else if (!valueHasUnit(s.part.class, s.part.value)) defect("C24", s.center, [s.rec.id], `${s.rec.ref}'s value ${s.part.value ?? "(none)"} has no unit`);
  }
  // ---- C25 on grid
  for (const p of pinList) {
    opp("C25", 1, p.at);
    if (!Number.isInteger(p.at[0]) || !Number.isInteger(p.at[1])) defect("C25", p.at, [`pin:${p.key}`], `pin ${p.number} of ${p.part} is off the grid`);
  }
  for (const w of wires) opp("C25", w.points.length, w.card);
  // ---- C26 generated symbol pin sides (in the symbol's own frame)
  for (const s of symbols) {
    // connectors draw their contacts in pad order on one side, whatever their type
    if (s.resolved.family.startsWith("pack:") || s.resolved.family === "connector") continue;
    for (const sp of s.resolved.pins) {
      opp("C26", 1, s.center);
      const bad = (sp.type === "power_in" && sp.dir !== "up" && sp.dir !== "down") || (sp.type === "input" && sp.dir !== "left" && s.resolved.family !== "connector") || (sp.type === "output" && sp.dir !== "right");
      const ground = /^(GND|VSS|AGND|DGND|SHIELD)/i.test(sp.name);
      if (bad && !(ground && sp.dir === "down") && !(s.resolved.family === "regulator" && sp.type === "power_in" && sp.dir === "left")) defect("C26", s.center, [s.rec.id], `${s.rec.ref} pin ${sp.name} (${sp.type}) sits on the ${sp.dir} side`);
    }
  }
  // ---- C27 repeated subcircuits alike (chain instances on one card)
  const chains = new Map<string, { id: string; v: XY; at: XY }[]>();
  for (const [path, info] of cls.parts) {
    if (!info.serves?.startsWith("sat:")) continue;
    const s = g.symbols.get(`sym:${path}`);
    const parent = g.symbols.get(`sym:${splitPinKey(info.serves.slice(4)).part}`);
    if (!s || !parent) continue;
    const k = `${s.rec.card}|${s.part.class}|${parent.part.class}|${info.role}`;
    const l = chains.get(k) ?? [];
    l.push({ id: s.rec.id, v: [s.center[0] - parent.center[0], s.center[1] - parent.center[1]], at: s.center });
    chains.set(k, l);
  }
  for (const l of chains.values()) {
    if (l.length < 2) continue;
    for (const x of l) {
      opp("C27", 1, x.at);
      if (Math.abs(x.v[0] - l[0].v[0]) > 0.5 || Math.abs(x.v[1] - l[0].v[1]) > 0.5) defect("C27", x.at, [x.id, l[0].id], "a repeated channel is drawn differently from the first");
    }
  }
  // ---- C29 sheet fill
  for (const c of cards) {
    opp("C29", 1, c.id);
    const area = c.w * c.h;
    let ink = 0;
    for (const s of symbols) if (s.rec.card === c.id) ink += (s.full.x1 - s.full.x0 + 2) * (s.full.y1 - s.full.y0 + 2);
    for (const w of wires) if (w.card === c.id) for (const s of segmentsOf(w)) ink += (Math.abs(s.a[0] - s.b[0]) + Math.abs(s.a[1] - s.b[1])) * 1.5;
    for (const l of labels) if (l.card === c.id) ink += area ? (labelBox(l, doc).x1 - labelBox(l, doc).x0 + 1) * 2 : 0;
    for (const p of powers) if (p.card === c.id) ink += 9;
    const white = 1 - Math.min(1, ink / area);
    if (white < 0.35 || white > 0.7) defect("C29", [c.x + c.w - 2, c.y + 1], [c.id], `${c.title} is ${Math.round(white * 100)} % empty (0.35 to 0.7 reads best)`);
  }
  if (cards.length) {
    opp("C29");
    const b = cards.map(cardBox).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0), x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1) }));
    const aspect = (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0);
    if (aspect < 1.2 || aspect > 1.8) defect("C29", [b.x0, b.y0], [], `the sheet's aspect is ${r1(aspect)} (1.2 to 1.8 reads best)`);
  }
  // ---- C30 title block
  const head = doc.records.get("schematic");
  const tb = head?.kind === "schematic" ? (head.title_block ?? {}) : {};
  opp("C30", 4);
  for (const f of ["title", "rev", "date"] as const) if (!tb[f]) defect("C30", [-1, -1], ["schematic"], `the title block has no ${f}`);

  // ---- totals
  const rules: RuleResult[] = RULES.map((r) => {
    const a = acc.get(r.id)!;
    return { id: r.id, title: r.title, severity: r.severity, count: a.count, opportunities: a.opp, f: failFraction(r.severity, a.count, a.opp) };
  });
  const total = (fs: { severity: RuleSeverity; f: number }[]) => Math.max(0, Math.min(100, Math.round(100 - 10 * fs.reduce((s, x) => s + WEIGHT[x.severity] * x.f, 0))));
  const score = total(rules);
  const cardScores: Record<string, number> = {};
  for (const c of cards)
    cardScores[c.id] = total(
      RULES.map((r) => {
        const a = acc.get(r.id)!;
        const o = a.oppByCard.get(c.id) ?? 0;
        return { severity: r.severity, f: failFraction(r.severity, a.countByCard.get(c.id) ?? 0, o) };
      }),
    );
  const order: Record<RuleSeverity, number> = { gate: 0, error: 1, warning: 2, info: 3 };
  const sevOf = new Map(RULES.map((r) => [r.id, r.severity]));
  const defects: Defect[] = raw
    .map((d) => ({ ...d, severity: sevOf.get(d.rule)! }))
    .sort((a, b) => order[a.severity] - order[b.severity] || byCodeUnit(a.card ?? "", b.card ?? "") || byCodeUnit(a.rule, b.rule) || a.at[1] - b.at[1] || a.at[0] - b.at[0] || byCodeUnit(a.message, b.message))
    .map((d, i) => ({ n: i + 1, id: `D${i + 1}`, ...d }));
  const gateRules = rules.filter((r) => r.severity === "gate" && r.count > 0).map((r) => r.id);
  return { score, presentable: gateRules.length === 0, gates: { open: rules.filter((r) => r.severity === "gate").reduce((s, r) => s + r.count, 0), rules: gateRules }, rules, defects, cards: cardScores };
}

const mid = (s: Segment): XY => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
const segmentsOf = (w: { id: string; net: string; points: [number, number][] }): Segment[] => w.points.slice(1).map((p, i) => ({ wire: w.id, net: w.net, a: w.points[i] as XY, b: p as XY }));
function moveToward(id: string, from: XY, to: XY): OpCall[] {
  const dx = Math.round((to[0] - from[0]) / 2);
  const dy = Math.round((to[1] - from[1]) / 2);
  return dx || dy ? [{ op: "item.move", ids: [id], dx, dy }] : [];
}

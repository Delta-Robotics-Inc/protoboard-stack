/**
 * The layout pipeline (contract section 7): classify, group into cards, lay out each card in scope (patterns,
 * settle, connect, route: ./place.ts), size the cards and place them for left-to-right signal flow with power
 * flowing down, then write the records. Pure and deterministic; pinned items never move; with a card scope only
 * those cards are laid out again.
 */
import { byCodeUnit, deterministicKey } from "@protoboardai/board";
import { REF_PREFIX, circuitHash, splitPinKey } from "../circuit.ts";
import { recordsOfKind, settingsOf, type SchematicDocument } from "../document.ts";
import { cardTitleBoxes } from "../geometry.ts";
import type { CardRecT, LabelRecT, NoconnectRecT, PowerRecT, SchematicRecord, SchematicRecT, SymbolRecT, WireRecT } from "../schema.ts";
import type { LBox } from "../symbols.ts";
import type { XY } from "../units.ts";
import { classify, natural, type Classification } from "./classify.ts";
import { layoutCard, type CardResult } from "./place.ts";

export interface LayoutOptions {
  /** `all` (default) or the card ids to lay out again */
  scope?: "all" | string[];
  /** `fresh` places every unpinned symbol anew; `tidy` keeps symbol positions and redraws the wiring */
  mode?: "fresh" | "tidy";
  /** `keep` (default): cards of an earlier layout stay where they are (grown cards push the ones they overlap down); `repack`: place every card anew */
  sheet?: "keep" | "repack";
}

export interface LayoutResult {
  puts: SchematicRecord[];
  removes: string[];
  /** nets labeled at each pin in some card because their wire failed or bent too much */
  fallbacks: { card: string; net: string }[];
  /** the patterns recognized, per card: `chain:<n>`, `array:<n>`, `bank:top:<rails>`, `bank:bottom:<rails>` */
  patterns: { card: string; pattern: string }[];
}

/** Margin inside a card, and the title band, in grid units. */
export const CARD_MARGIN = 2;
export const TITLE_BAND = 3;
export const DEFAULT_SETTINGS = { bend_limit: 4, gutter: 4 };

/** Reference designators (contract section 6.3): kept once set; else the circuit's; else the instance id when it reads as one; else prefix and the lowest free number. */
export function assignRefs(doc: SchematicDocument): Map<string, string> {
  const refs = new Map<string, string>();
  const used = new Set<string>();
  for (const s of recordsOfKind(doc, "symbol")) if (doc.parts.has(s.part)) (refs.set(s.part, s.ref), used.add(s.ref));
  const parts = [...doc.circuit.parts].sort((a, b) => natural(a.path, b.path) || byCodeUnit(a.path, b.path));
  for (const p of parts) if (!refs.has(p.path) && p.ref && !used.has(p.ref)) (refs.set(p.path, p.ref), used.add(p.ref));
  for (const p of parts) {
    if (refs.has(p.path)) continue;
    const prefix = REF_PREFIX[p.class];
    const id = p.path.split("/").pop()!;
    const m = new RegExp(`^${prefix}(\\d+)$`, "i").exec(id);
    if (m && !used.has(`${prefix}${m[1]}`)) {
      refs.set(p.path, `${prefix}${m[1]}`);
      used.add(`${prefix}${m[1]}`);
      continue;
    }
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    refs.set(p.path, `${prefix}${n}`);
    used.add(`${prefix}${n}`);
  }
  return refs;
}

const shift = (p: XY, d: XY): XY => [p[0] + d[0], p[1] + d[1]];

/** Run the pipeline. */
export function layoutSchematic(doc: SchematicDocument, options: LayoutOptions = {}): LayoutResult {
  const cls = classify(doc);
  const settings = { ...DEFAULT_SETTINGS, ...settingsOf(doc) };
  const refs = assignRefs(doc);
  const existingCards = new Map(recordsOfKind(doc, "card").map((c) => [c.id, c]));
  const allCards = [...cls.cards.keys()].sort(byCodeUnit);
  const scope = options.scope === undefined || options.scope === "all" ? allCards : options.scope.filter((c) => cls.cards.has(c));
  const symbolsByPart = new Map(recordsOfKind(doc, "symbol").map((s) => [s.part, s]));
  const pinnedNets = new Set<string>();
  for (const r of doc.records.values()) if ((r.kind === "wire" || r.kind === "label" || r.kind === "power") && r.pinned) pinnedNets.add(`${r.card}|${r.net}`);

  const results = new Map<string, { res: CardResult; pinnedCard: boolean; origin: XY }>();
  for (const card of scope) {
    const members = cls.cards.get(card)!;
    const existing = existingCards.get(card);
    // the local frame: the first anchor's old place when it has one, so a partial run keeps the card's drawing where it was
    const anchors = members.filter((m) => cls.parts.get(m)!.anchor).sort((a, b) => cls.parts.get(b)!.symbolPins - cls.parts.get(a)!.symbolPins || byCodeUnit(a, b));
    const prev = anchors.length ? symbolsByPart.get(anchors[0]) : undefined;
    const origin: XY = prev ? [prev.x, prev.y] : existing ? [existing.x + CARD_MARGIN, existing.y + TITLE_BAND + CARD_MARGIN] : [0, 0];
    const fixed = new Map<string, SymbolRecT>();
    for (const m of members) {
      const s = symbolsByPart.get(m);
      if (!s) continue;
      if (s.pinned || options.mode === "tidy") fixed.set(m, { ...s, x: s.x - origin[0], y: s.y - origin[1] });
    }
    const res = layoutCard(doc, cls, card, members, { refs, fixed, bendLimit: settings.bend_limit });
    results.set(card, { res, pinnedCard: !!existing && (fixed.size > 0 || !!existing.pinned), origin });
  }

  // ---- card sizes
  const size = new Map<string, { w: number; h: number; box: LBox }>();
  for (const card of allCards) {
    const r = results.get(card);
    if (!r) {
      const c = existingCards.get(card);
      if (c) size.set(card, { w: c.w, h: c.h, box: { x0: 0, y0: 0, x1: 0, y1: 0 } });
      continue;
    }
    const b = r.res.box;
    const title = cardTitle(doc, cls, card, refs);
    const tb = cardTitleBoxes({ kind: "card", id: card, group: "", title: title.title, subtitle: title.subtitle, x: 0, y: 0, w: 1, h: 1, provenance: { by: "layout" } });
    const titleW = Math.ceil((tb.subtitle ?? tb.title).x1) + 1;
    const w = Math.max(Math.ceil(b.x1) - Math.floor(b.x0) + 2 * CARD_MARGIN, titleW, 12);
    const h = Math.ceil(b.y1) - Math.floor(b.y0) + TITLE_BAND + 2 * CARD_MARGIN;
    size.set(card, { w, h, box: b });
  }

  // ---- card placement
  const placement = placeCards(doc, cls, allCards, size, existingCards, results, settings.gutter, options.sheet === "repack");

  // ---- records
  const puts: SchematicRecord[] = [];
  const keep = new Set<string>();
  const fallbacks: { card: string; net: string }[] = [];
  for (const card of allCards) {
    const pl = placement.get(card)!;
    const title = cardTitle(doc, cls, card, refs);
    const existing = existingCards.get(card);
    const rec: CardRecT = {
      kind: "card",
      id: card,
      group: cls.groupOf.get(card) ?? "",
      title: title.title,
      ...(title.subtitle ? { subtitle: title.subtitle } : {}),
      x: pl.x,
      y: pl.y,
      w: pl.w,
      h: pl.h,
      ...(existing?.pinned ? { pinned: true as const } : {}),
      provenance: existing?.provenance ?? { by: "layout" },
    };
    puts.push(rec);
    keep.add(card);
    const r = results.get(card);
    if (!r) {
      // not in scope: moved rigidly with its card
      const d: XY = existing ? [pl.x - existing.x, pl.y - existing.y] : [0, 0];
      for (const x of doc.records.values()) {
        if (!("card" in x) || x.card !== card) continue;
        keep.add(x.id);
        if (d[0] || d[1]) puts.push(moveRecord(x, d));
      }
      for (const nc of recordsOfKind(doc, "noconnect")) keep.add(nc.id);
      continue;
    }
    for (const f of r.res.fallbacks) fallbacks.push({ card, net: f });
    const d: XY = r.pinnedCard ? r.origin : [pl.x + CARD_MARGIN - Math.floor(r.res.box.x0), pl.y + TITLE_BAND + CARD_MARGIN - Math.floor(r.res.box.y0)];
    for (const s of r.res.symbols) {
      const old = symbolsByPart.get(s.part);
      const moved: SymbolRecT = s.pinned || (options.mode === "tidy" && old) ? { ...old!, card } : { ...s, x: s.x + d[0], y: s.y + d[1], card, ...(old?.variant ? { variant: old.variant } : {}), ...(old?.symbol ? { symbol: old.symbol } : {}) };
      if (old && old.provenance.by !== "layout" && !s.pinned) moved.provenance = { ...old.provenance, edited: "layout" };
      puts.push(moved);
      keep.add(moved.id);
    }
    // pinned drawing in this card stays, and its net is not drawn again here
    for (const x of doc.records.values()) if ((x.kind === "wire" || x.kind === "label" || x.kind === "power") && x.card === card && x.pinned) keep.add(x.id);
    const skip = (net: string) => pinnedNets.has(`${card}|${net}`);
    for (const w of r.res.wires) {
      if (skip(w.net)) continue;
      const points = w.points.map((p) => shift(p, d));
      const id = deterministicKey("wire", { net: w.net, card, points });
      puts.push({ kind: "wire", id, net: w.net, card, points, provenance: { by: "layout" } } satisfies WireRecT);
      keep.add(id);
    }
    for (const l of r.res.labels) {
      if (skip(l.net)) continue;
      const at = shift(l.at, d);
      const id = deterministicKey("lbl", { net: l.net, card, at, side: l.side });
      puts.push({ kind: "label", id, net: l.net, card, x: at[0], y: at[1], side: l.side, scope: l.scope, provenance: { by: "layout" } } satisfies LabelRecT);
      keep.add(id);
    }
    for (const p of r.res.powers) {
      if (skip(p.net)) continue;
      const at = shift(p.at, d);
      const id = deterministicKey("pwr", { net: p.net, card, at, dir: p.dir });
      puts.push({ kind: "power", id, net: p.net, card, x: at[0], y: at[1], dir: p.dir, style: p.style, provenance: { by: "layout" } } satisfies PowerRecT);
      keep.add(id);
    }
    for (const pin of r.res.noconnects) {
      const id = `nc:${pin}`;
      const old = doc.records.get(id);
      if (!old) puts.push({ kind: "noconnect", id, pin, provenance: { by: "layout" } } satisfies NoconnectRecT);
      keep.add(id);
    }
  }
  // noconnect marks of parts outside the scope stay
  for (const nc of recordsOfKind(doc, "noconnect")) {
    const part = splitPinKey(nc.pin).part;
    const card = cls.parts.get(part)?.card;
    if (card && !results.has(card)) keep.add(nc.id);
  }
  // the schematic record
  const s = doc.records.get("schematic");
  const head: SchematicRecT = s?.kind === "schematic" ? { ...s, source: { board: doc.circuit.board, hash: circuitHash(doc.circuit) } } : { kind: "schematic", id: "schematic", name: doc.circuit.board, source: { board: doc.circuit.board, hash: circuitHash(doc.circuit) }, settings: { ...DEFAULT_SETTINGS } };
  // the title block gets the sheet's name when it has no title (revision and date are a person's to give)
  if (!head.title_block?.title) head.title_block = { ...(head.title_block ?? {}), title: head.name };
  puts.push(head);
  keep.add("schematic");
  const removes: string[] = [];
  for (const r of doc.records.values()) {
    if (keep.has(r.id) || r.kind === "proposal" || r.kind === "text" || r.kind === "frame") continue;
    removes.push(r.id);
  }
  const patterns = [...results].flatMap(([card, r]) => r.res.patterns.map((pattern) => ({ card, pattern })));
  return { puts, removes: removes.sort(byCodeUnit), fallbacks, patterns };
}

function moveRecord(r: SchematicRecord, d: XY): SchematicRecord {
  switch (r.kind) {
    case "symbol":
    case "label":
    case "power":
    case "text":
      return { ...r, x: r.x + d[0], y: r.y + d[1] };
    case "wire":
      return { ...r, points: r.points.map((p) => shift(p as XY, d)) };
    default:
      return r;
  }
}

/** A card's title (the UHD sub-module's name) and subtitle (path and designators). */
export function cardTitle(doc: SchematicDocument, cls: Classification, card: string, refs: Map<string, string>): { title: string; subtitle?: string } {
  const members = cls.cards.get(card) ?? [];
  const group = cls.groupOf.get(card) ?? "";
  const g = doc.circuit.groups.find((x) => x.path === group);
  const anchors = members.filter((m) => cls.parts.get(m)?.anchor);
  const main = anchors[0] ? doc.parts.get(anchors[0]) : undefined;
  const title = g?.name ?? main?.name ?? card.slice(5);
  const list = members.map((m) => refs.get(m) ?? m).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const subtitle = `${group ? `${group}/` : "board"}  ${list.slice(0, 8).join(" ")}${list.length > 8 ? " …" : ""}`;
  return { title, subtitle };
}

/** Which card drives a signal net (the card of an output, else of a microcontroller, else of a connector). */
function driverCard(doc: SchematicDocument, cls: Classification, net: string): string | undefined {
  const n = doc.nets.get(net)!;
  const rank = (k: string) => {
    const { part, pin } = splitPinKey(k);
    const p = doc.parts.get(part)!;
    const t = p.pins.find((x) => x.id === pin)!.type;
    if (p.class === "connector") return 0;
    if (t === "output" || t === "power_out" || t === "analog_out") return 1;
    if (p.class === "mcu" || p.class === "module") return 2;
    return 9;
  };
  const best = [...n.pins].sort((a, b) => rank(a) - rank(b) || byCodeUnit(a, b))[0];
  if (!best || rank(best) === 9) return undefined;
  return cls.parts.get(splitPinKey(best).part)?.card;
}

/** The aspect (width over height) a sheet reads best at. */
const SHEET_ASPECT = 1.5;

type CardBox = { x: number; y: number; w: number; h: number };

function placeCards(
  doc: SchematicDocument,
  cls: Classification,
  cards: string[],
  size: Map<string, { w: number; h: number }>,
  existing: Map<string, CardRecT>,
  results: Map<string, { pinnedCard: boolean; res: CardResult; origin: XY }>,
  gutter: number,
  repack: boolean,
): Map<string, CardBox> {
  let out = new Map<string, CardBox>();
  // a sheet laid out before keeps its cards where they are (a small change never reshuffles the sheet): a card that
  // grew pushes the cards it now overlaps down; new cards go below everything
  const kept = !repack && cards.some((c) => existing.has(c)) ? keepPlaces(cards, size, existing, gutter) : undefined;
  if (kept) out = kept;
  else out = packCards(doc, cls, cards, size, gutter);
  // pinned cards keep their place
  for (const c of cards) {
    const e = existing.get(c);
    const r = results.get(c);
    if (e && (e.pinned || r?.pinnedCard)) {
      const b = r?.res.box;
      const x = b ? r!.origin[0] + Math.floor(b.x0) - CARD_MARGIN : e.x;
      const y = b ? r!.origin[1] + Math.floor(b.y0) - TITLE_BAND - CARD_MARGIN : e.y;
      out.set(c, { x, y, w: size.get(c)!.w, h: size.get(c)!.h });
    }
  }
  return out;
}

/**
 * Pack the cards for a fresh sheet: signal flow left to right (connector cards first, then the longest path from
 * the card that drives each net), power from the top (a card that makes a rail sits above the cards it feeds), in
 * columns whose height gives the sheet a readable aspect, with cards that share many nets near each other.
 */
function packCards(doc: SchematicDocument, cls: Classification, cards: string[], size: Map<string, { w: number; h: number }>, gutter: number): Map<string, CardBox> {
  // edges: signal flow between cards, and power from the card that makes a rail to the cards that use it
  const sig = new Map<string, Set<string>>();
  const pow = new Map<string, Set<string>>();
  const shared = new Map<string, number>();
  const flow = new Map<string, number>();
  const add = (m: Map<string, Set<string>>, a: string, b: string) => {
    if (a === b) return;
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const [name, n] of cls.nets) {
    if (n.cards.length < 2) continue;
    if (n.cls === "ground") continue;
    for (const a of n.cards) for (const b of n.cards) if (a < b) shared.set(`${a}|${b}`, (shared.get(`${a}|${b}`) ?? 0) + 1);
    if (n.cls === "rail") {
      const src = doc.nets
        .get(name)!
        .pins.filter((k) => {
          const { part, pin } = splitPinKey(k);
          return doc.parts.get(part)!.pins.find((x) => x.id === pin)!.type === "power_out";
        })
        .map((k) => cls.parts.get(splitPinKey(k).part)!.card);
      for (const s of src) for (const c of n.cards) add(pow, s, c);
      continue;
    }
    // signal flow: output pins to input pins between cards (as rule C14 counts it), else the net's driver card
    const typed = (k: string) => doc.parts.get(splitPinKey(k).part)!.pins.find((x) => x.id === splitPinKey(k).pin)!.type;
    const outs = doc.nets.get(name)!.pins.filter((k) => typed(k) === "output" || typed(k) === "analog_out");
    const ins = doc.nets.get(name)!.pins.filter((k) => typed(k) === "input" || typed(k) === "analog_in");
    let any = false;
    for (const a of outs)
      for (const b of ins) {
        const ca = cls.parts.get(splitPinKey(a).part)!.card;
        const cb = cls.parts.get(splitPinKey(b).part)!.card;
        if (ca === cb) continue;
        flow.set(`${ca}>${cb}`, (flow.get(`${ca}>${cb}`) ?? 0) + 1);
        any = true;
      }
    if (any) continue;
    const d = driverCard(doc, cls, name);
    if (d) for (const c of n.cards) if (c !== d) flow.set(`${d}>${c}`, (flow.get(`${d}>${c}`) ?? 0) + 0.5);
  }
  // a pair of cards flows the way most of its signals go
  for (const [k, v] of flow) {
    const [a, b] = k.split(">");
    const back = flow.get(`${b}>${a}`) ?? 0;
    if (v > back || (v === back && byCodeUnit(a, b) < 0)) add(sig, a, b);
  }
  const isConnectorCard = (c: string) => (cls.cards.get(c) ?? []).some((m) => cls.parts.get(m)!.anchor && doc.parts.get(m)!.class === "connector");
  const makesPower = (c: string) => (pow.get(c)?.size ?? 0) > 0 && !isConnectorCard(c);
  // rank: connector cards first; then the longest signal path; a card that makes power sits in its supplier's rank
  const rank = new Map<string, number>();
  for (const c of cards) rank.set(c, 0);
  for (let it = 0; it < cards.length; it++) {
    let changed = false;
    for (const [a, bs] of sig)
      for (const b of bs) {
        if (b === a) continue;
        const r = rank.get(a)! + 1;
        if (r > rank.get(b)! && r < cards.length) {
          rank.set(b, r);
          changed = true;
        }
      }
    if (!changed) break;
  }
  for (const c of cards) {
    if (!makesPower(c)) continue;
    const suppliers = [...pow].filter(([, t]) => t.has(c)).map(([s]) => s);
    if (suppliers.length && ![...(sig.get(c) ?? [])].length) rank.set(c, Math.max(...suppliers.map((s) => rank.get(s)!)));
  }
  // order: by rank; in a rank, a card above the cards it feeds power to, then by where its links come from
  const yOf = new Map<string, number>();
  const ranks = [...new Set(cards.map((c) => rank.get(c)!))].sort((a, b) => a - b);
  const order: string[] = [];
  for (const r of ranks) {
    const list = cards.filter((c) => rank.get(c) === r);
    const bary = (c: string) => {
      const from = [...sig].filter(([, t]) => t.has(c)).map(([s]) => yOf.get(s) ?? 0);
      return from.length ? from.reduce((a, b) => a + b, 0) / from.length : 0;
    };
    list.sort((a, b) => {
      if (pow.get(a)?.has(b) && !pow.get(b)?.has(a)) return -1;
      if (pow.get(b)?.has(a) && !pow.get(a)?.has(b)) return 1;
      return (isConnectorCard(b) ? 1 : 0) - (isConnectorCard(a) ? 1 : 0) || (makesPower(b) ? 1 : 0) - (makesPower(a) ? 1 : 0) || bary(a) - bary(b) || byCodeUnit(a, b);
    });
    list.forEach((c, i) => yOf.set(c, order.length + i));
    order.push(...list);
  }
  const stack = (cols: string[][]): Map<string, CardBox> => {
    const pl = new Map<string, CardBox>();
    let x = 0;
    const bottoms: number[] = [];
    for (const list of cols) {
      const w = Math.max(...list.map((c) => size.get(c)!.w));
      let y = 0;
      for (const c of list) {
        const h = size.get(c)!.h;
        // cards share their column's width unless that would stretch them by more than a quarter
        pl.set(c, { x, y, w: w <= 1.25 * size.get(c)!.w ? w : size.get(c)!.w, h });
        y += h + gutter;
      }
      bottoms.push(y - gutter);
      x += w + gutter;
    }
    // the last card of each column reaches the tallest column's bottom when it is close
    const bottom = Math.max(...bottoms);
    for (const list of cols) {
      const last = pl.get(list[list.length - 1])!;
      if (bottom - (last.y + last.h) <= 8) last.h = bottom - last.y;
    }
    return pl;
  };
  // column packing in that order: the column height whose sheet reads best (aspect near 1.5, little waste, cards
  // that share many nets near each other)
  const total = order.reduce((s, c) => s + (size.get(c)!.w + gutter) * (size.get(c)!.h + gutter), 0);
  const tallest = Math.max(...order.map((c) => size.get(c)!.h));
  const cands = new Set<number>([tallest]);
  for (let k = 0; k <= 24; k++) cands.add(Math.max(tallest, Math.round(Math.sqrt(total / SHEET_ASPECT) * (0.45 + 0.05 * k))));
  let best: { pl: Map<string, CardBox>; cost: number } | undefined;
  for (const H of [...cands].sort((a, b) => a - b)) {
    const cols: string[][] = [[]];
    let y = 0;
    let lastRank = -1;
    for (const c of order) {
      const h = size.get(c)!.h;
      const col = cols[cols.length - 1];
      if (col.length && (y + h > H || (rank.get(c) !== lastRank && y > 0.75 * H))) {
        cols.push([]);
        y = 0;
      }
      cols[cols.length - 1].push(c);
      y += h + gutter;
      lastRank = rank.get(c)!;
    }
    const pl = stack(cols);
    const cost = sheetCost(pl);
    if (!best || cost < best.cost - 1e-9) best = { pl, cost };
  }
  // the other way: each card in flow order at the free corner where the sheet reads best (bottom-left fill), so a
  // wide card does not leave a column of empty space beside narrow ones
  for (const target of [1.2, 1.5, 1.8]) {
    const pl = new Map<string, CardBox>();
    for (const c of order) {
      const { w, h } = size.get(c)!;
      const xs = new Set<number>([0]);
      const ys = new Set<number>([0]);
      for (const b of pl.values()) {
        xs.add(b.x + b.w + gutter);
        xs.add(b.x);
        ys.add(b.y + b.h + gutter);
        ys.add(b.y);
      }
      let pick: { x: number; y: number; cost: number } | undefined;
      for (const x of xs)
        for (const y of ys) {
          const box = { x, y, w, h };
          if ([...pl.values()].some((o) => box.x < o.x + o.w + gutter && o.x < box.x + box.w + gutter && box.y < o.y + o.h + gutter && o.y < box.y + box.h + gutter)) continue;
          const W = Math.max(x + w, ...[...pl.values()].map((o) => o.x + o.w));
          const H = Math.max(y + h, ...[...pl.values()].map((o) => o.y + o.h));
          let cost = W * H * (1 + 0.8 * Math.abs(Math.log(W / Math.max(1, H) / target)));
          for (const [o, ob] of pl) {
            // flow: a card that feeds this one sits left of it; one that powers it sits above or left
            if (sig.get(o)?.has(c) && x < ob.x + ob.w) cost += 400 + 20 * (ob.x + ob.w - x);
            if (pow.get(o)?.has(c) && y + h <= ob.y && x < ob.x + ob.w) cost += 300;
            const n = shared.get(o < c ? `${o}|${c}` : `${c}|${o}`) ?? 0;
            if (n) cost += 4 * n * (Math.abs(x + w / 2 - ob.x - ob.w / 2) + Math.abs(y + h / 2 - ob.y - ob.h / 2));
          }
          if (!pick || cost < pick.cost - 1e-9 || (Math.abs(cost - pick.cost) <= 1e-9 && (x < pick.x || (x === pick.x && y < pick.y)))) pick = { x, y, cost };
        }
      pl.set(c, { x: pick!.x, y: pick!.y, w, h });
    }
    const cost = sheetCost(pl);
    if (!best || cost < best.cost - 1e-9) best = { pl, cost };
  }
  /** How well a sheet reads: area, aspect near 1.5, little waste, signals flowing right, cards sharing nets near each other. */
  function sheetCost(pl: Map<string, CardBox>): number {
    const W = Math.max(...[...pl.values()].map((b) => b.x + b.w));
    const Hs = Math.max(...[...pl.values()].map((b) => b.y + b.h));
    const used = order.reduce((s, c) => s + size.get(c)!.w * size.get(c)!.h, 0);
    const aspect = W / Math.max(1, Hs);
    let fan = 0;
    for (const [k, n] of shared) {
      const [a, b] = k.split("|");
      const A = pl.get(a)!;
      const B = pl.get(b)!;
      fan += n * (Math.abs(A.x + A.w / 2 - B.x - B.w / 2) + Math.abs(A.y + A.h / 2 - B.y - B.h / 2));
    }
    let back = 0;
    for (const [a, bs] of sig) for (const b of bs) if (pl.get(b)!.x < pl.get(a)!.x) back++;
    return W * Hs * (1 + 1.2 * Math.abs(Math.log(aspect / SHEET_ASPECT))) * (1 + 0.6 * (1 - used / (W * Hs))) + 0.5 * fan + back * 0.3 * W * Hs;
  }
  return best!.pl;
}

/**
 * Keep the cards of an earlier layout where they are. A card keeps its box, grown to its new size (or shrunk when
 * it lost much); a card that now overlaps one placed before it (left to right, top to bottom) moves down just clear
 * of it; new cards go under the sheet. Undefined when nothing was laid out before.
 */
function keepPlaces(cards: string[], size: Map<string, { w: number; h: number }>, existing: Map<string, CardRecT>, gutter: number): Map<string, CardBox> | undefined {
  const old = cards.filter((c) => existing.has(c));
  if (!old.length) return undefined;
  const out = new Map<string, CardBox>();
  const sorted = [...old].sort((a, b) => existing.get(a)!.x - existing.get(b)!.x || existing.get(a)!.y - existing.get(b)!.y || byCodeUnit(a, b));
  const clash = (a: CardBox, b: CardBox) => a.x < b.x + b.w + gutter && b.x < a.x + a.w + gutter && a.y < b.y + b.h + gutter && b.y < a.y + a.h + gutter;
  for (const c of sorted) {
    const e = existing.get(c)!;
    const s = size.get(c)!;
    const box = { x: e.x, y: e.y, w: Math.max(s.w, e.w), h: Math.max(s.h, e.h) };
    if (s.w < e.w - 8) box.w = s.w;
    if (s.h < e.h - 8) box.h = s.h;
    for (let guard = 0; guard < 500; guard++) {
      const hit = [...out.values()].find((o) => clash(box, o));
      if (!hit) break;
      box.y = hit.y + hit.h + gutter;
    }
    out.set(c, box);
  }
  let bottom = Math.max(...[...out.values()].map((b) => b.y + b.h));
  for (const c of cards) {
    if (out.has(c)) continue;
    const s = size.get(c)!;
    out.set(c, { x: 0, y: bottom + gutter, w: s.w, h: s.h });
    bottom += gutter + s.h;
  }
  return out;
}

export { classify };
export type { CardResult };

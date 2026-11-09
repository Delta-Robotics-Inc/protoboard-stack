/**
 * The agent's cleanup loop (contract section 8.4): what the automatic layout leaves, an agent finishes by hand with
 * ordinary operations. Tools, not prose:
 *
 *   listDefects     numbered defects with location, rule, objects, the points each would recover and a crop
 *   proposeFixes    a few typed candidate operation lists for one defect, each scored by applying it to a copy
 *   applyFix        one candidate as an ordinary transaction by the agent actor
 *   explainDefect   one defect in plain words
 *   cleanupPass     a greedy driver: the defect worth most first, the best candidate that raises the score without
 *                   opening a gate, until nothing improves or the budget of operations is spent; never touches a
 *                   pinned item; every transaction carries one change set a person accepts or reverts as a whole
 *
 * `CLEANUP_TOOLS` names and describes them for CLI and MCP bindings.
 */
import { z } from "zod";
import type { Actor, OpCall } from "@protoboardai/board";
import { recordsOfKind, type SchematicDocument } from "./document.ts";
import { boxesOverlap, geometryOf, inflateBox, labelBox, placeSymbol, powerBoxes, segmentThroughBox } from "./geometry.ts";
import { applyCalls, OpError, type ApplyContext } from "./ops/index.ts";
import { ID_PREFIX, type SchematicRecord, type SymbolRecT } from "./schema.ts";
import { OPPORTUNITY_FLOOR, RULES, WEIGHT, scoreSchematic, type Defect, type RuleSeverity, type Score } from "./score.ts";
import { classify } from "./layout/classify.ts";
import { placeText, type TLabel, type TPower, type TSym, type TWire } from "./layout/text.ts";
import { renderSchematicSvg } from "./render/svg.ts";
import type { SchematicService } from "./service.ts";
import type { LBox } from "./symbols.ts";
import type { XY } from "./units.ts";

/** The actor cleanup runs as unless told otherwise. */
export const CLEANUP_AGENT: Actor = { kind: "agent", id: "cleanup", name: "cleanup" };

export interface ListedDefect extends Defect {
  /** score points this defect alone costs (what fixing it would recover), rounded to 0.1 */
  points: number;
  /** a gate defect: the sheet is not presentable while it is open */
  gate: boolean;
  /** where to look: the card and a box around the defect, for `renderDefectCrop` or `describeSchematic` */
  crop: { card?: string; box: [number, number, number, number] };
}

export interface DefectList {
  score: number;
  presentable: boolean;
  gates: Score["gates"];
  defects: ListedDefect[];
}

/** What one defect of a rule costs: the rule's weight over its opportunities (floored as the score floors them). */
function pointsOf(score: Score, rule: string): number {
  const r = score.rules.find((x) => x.id === rule);
  if (!r || !r.opportunities) return 0;
  const opp = r.severity === "gate" ? r.opportunities : Math.max(r.opportunities, OPPORTUNITY_FLOOR);
  // a rule already past f = 1 recovers nothing for one defect until its count drops under its opportunities
  if (r.count > opp) return 0;
  return Math.round(10 * WEIGHT[r.severity] * (1 / opp) * 10) / 10;
}

/** The numbered defects, gates first, then by points recoverable. */
export function listDefects(doc: SchematicDocument, opts: { card?: string; rules?: string[]; includeInfo?: boolean; limit?: number; score?: Score } = {}): DefectList {
  const s = opts.score ?? scoreSchematic(doc);
  const out: ListedDefect[] = [];
  for (const d of s.defects) {
    if (opts.card && d.card !== opts.card) continue;
    if (opts.rules && !opts.rules.includes(d.rule)) continue;
    if (!opts.includeInfo && d.severity === "info") continue;
    const b = d.box ? { x0: d.box[0], y0: d.box[1], x1: d.box[2], y1: d.box[3] } : { x0: d.at[0], y0: d.at[1], x1: d.at[0], y1: d.at[1] };
    const c = inflateBox(b, 6);
    out.push({ ...d, points: pointsOf(s, d.rule), gate: d.severity === "gate", crop: { ...(d.card ? { card: d.card } : {}), box: [Math.floor(c.x0), Math.floor(c.y0), Math.ceil(c.x1), Math.ceil(c.y1)] } });
  }
  out.sort((a, b) => Number(b.gate) - Number(a.gate) || b.points - a.points || a.n - b.n);
  return { score: s.score, presentable: s.presentable, gates: s.gates, defects: opts.limit ? out.slice(0, opts.limit) : out };
}

/** The crop of one defect as an SVG (or PNG through `svgToPng`), the defect ringed and numbered. */
export function renderDefectCrop(doc: SchematicDocument, d: ListedDefect, opts: { theme?: "dark" | "paper"; scale?: number } = {}): string {
  const [x0, y0, x1, y1] = d.crop.box;
  return renderSchematicSvg(doc, { theme: opts.theme ?? "dark", scale: opts.scale ?? 28, crop: { x0, y0, x1, y1 }, markers: [{ n: d.n, at: d.at, severity: d.severity }] });
}

const RULE_WHY: Record<string, string> = {
  C01: "the drawing must connect exactly the pins UHD connects, or a reader is misled about the circuit",
  C02: "overlapping text and symbols cannot be read",
  C03: "a wire running through a body or text looks like a connection that is not there",
  C04: "text over a pin of another net hides which net the pin is on",
  C05: "a wire end on nothing, or an open pin without a no-connect mark, looks like a mistake",
  C06: "a wire touching another net's wire or pin reads as a short",
  C07: "supply and ground pins read fastest as power symbols",
  C08: "a net inside one card reads better as a wire than as labels a reader must match",
  C09: "wires between cards cross the gutter; labels name the net instead",
  C10: "ground points down and supplies up, by convention",
  C11: "a part on a rail reads best with its rail pin facing the rail",
  C12: "a decoupling capacitor belongs beside the supply pin it serves",
  C13: "a pull-up, pull-down or series part belongs beside the pin it serves",
  C14: "signals read left to right, from the part that drives them to the parts that listen",
  C15: "power reads from the top or the left",
  C16: "every crossing is a place a reader must check",
  C17: "a four-way junction is ambiguous on paper",
  C18: "wires with many bends are hard to follow",
  C19: "long wires and wires over other parts are hard to follow",
  C20: "each part belongs inside its card, and cards keep their gutter",
  C21: "every card needs a readable title",
  C22: "a label should read away from its wire",
  C23: "a reference or value closer to another part is read as that part's",
  C24: "designators must be unique and values carry their unit",
  C25: "pins and wires sit on the grid",
  C26: "generated symbols put supplies on top, ground below, inputs left, outputs right",
  C27: "repeated channels drawn alike are recognized at a glance",
  C28: "a net named twice at one point is clutter",
  C29: "a card should be neither crowded nor empty",
  C30: "a printed sheet needs its title block",
};
const RULE_FIX: Record<string, string> = {
  C02: "move the text (a label or power symbol on a short stub of its net, or a part's reference and value to its clear side)",
  C03: "move the text off the wire, or re-route the wire around it",
  C04: "move the label or the part's text off the pin",
  C08: "replace the labels with a wire inside the card",
  C10: "flip the power symbol",
  C11: "rotate the part so its rail pin faces the rail",
  C12: "move the capacitor beside the pin and redraw the card's wiring",
  C13: "move the part beside the pin it serves and redraw the card's wiring",
  C16: "redraw the card's wiring, or move a part so its nets do not cross",
  C19: "redraw the card's wiring, or move the parts closer",
  C23: "move the reference and value back beside their own part",
};

/** One defect in plain words: what is wrong, where, why it matters, and what fixes it. */
export function explainDefect(doc: SchematicDocument, defect: string | number | Defect): string {
  const d = findDefect(doc, defect);
  if (!d) return `There is no defect ${String(defect)} on this sheet now.`;
  const rule = RULES.find((r) => r.id === d.rule)!;
  const where = d.card ? `in card ${d.card.slice(5)}` : "on the sheet";
  const sev = d.severity === "gate" ? "a gate (the sheet is not presentable until it is fixed)" : `a ${d.severity}`;
  const fix = RULE_FIX[d.rule] ?? (d.suggest?.length ? "apply the suggested operations" : "a person decides; no mechanical fix is offered");
  return `Defect ${d.n} (${d.rule}, ${rule.title}) is ${sev} ${where} at (${d.at[0]}, ${d.at[1]}): ${d.message}. It matters because ${RULE_WHY[d.rule] ?? "it hurts readability"}. To fix it: ${fix}.`;
}

function findDefect(doc: SchematicDocument, defect: string | number | Defect, score?: Score): Defect | undefined {
  if (typeof defect === "object") return defect;
  const s = score ?? scoreSchematic(doc);
  return s.defects.find((x) => x.id === String(defect) || x.n === Number(String(defect).replace(/^D/, "")));
}

export interface FixCandidate {
  /** a short title a person reads */
  title: string;
  rule: string;
  /** the defect it addresses (its id when proposed) */
  defect: string;
  ops: OpCall[];
  /** predicted by applying the operations to a copy and scoring it */
  predicted: { before: number; after: number; delta: number; gatesBefore: number; gatesAfter: number; resolved: boolean };
}

let dryKey = 0;
function dryContext(actor: Actor): ApplyContext {
  return { actor, issueId: (kind) => `${ID_PREFIX[kind]}:dry.${++dryKey}`, provenance: { by: "agent", actor: `agent:${actor.name ?? actor.id}` }, edited: "agent", pinMoves: false };
}

const isPinned = (r: SchematicRecord | undefined) => !!(r && "pinned" in r && r.pinned);

/** Records an operation list would change, for the pinned check. */
function touches(doc: SchematicDocument, ops: OpCall[]): string[] {
  const out: string[] = [];
  for (const o of ops) {
    const a = o as unknown as { ids?: string[]; id?: string };
    const ids = [...(a.ids ?? []), ...(a.id ? [a.id] : [])];
    out.push(...ids.filter((i) => doc.records.has(i)));
  }
  return out;
}

/**
 * Candidate fixes for one defect, each a list of ordinary operations scored by applying it to a copy. Candidates
 * that would touch a pinned item, fail to apply, or open a gate are left out; the rest come best first.
 */
export function proposeFixes(doc: SchematicDocument, defect: string | number | Defect, opts: { max?: number; actor?: Actor; score?: Score; cache?: Map<string, Score | null> } = {}): FixCandidate[] {
  const before = opts.score ?? scoreSchematic(doc);
  const d = findDefect(doc, defect, before);
  if (!d) return [];
  const actor = opts.actor ?? CLEANUP_AGENT;
  const raw: { title: string; ops: OpCall[] }[] = [];
  const card = d.card;
  const tidy = (c: string): OpCall => ({ op: "layout.run", scope: [c], mode: "tidy" });

  // text that can move: labels, power symbols, a part's fields
  if (["C02", "C03", "C04", "C22", "C23", "C28"].includes(d.rule)) for (const id of d.objects) {
    const r = doc.records.get(id);
    if (!r || isPinned(r)) continue;
    if (r.kind === "label" || r.kind === "power" || r.kind === "symbol") {
      const c = moveText(doc, r, d.rule === "C23");
      if (c) raw.push(c);
    }
  }
  // a satellite beside what it serves
  if ((d.rule === "C12" || d.rule === "C13") && card) {
    const id = d.objects.find((o) => o.startsWith("sym:"));
    const r = id ? doc.records.get(id) : undefined;
    if (r?.kind === "symbol" && !r.pinned) for (const c of satelliteMoves(doc, r)) raw.push({ title: c.title, ops: [c.op, tidy(r.card)] });
  }
  if (d.rule === "C11" && d.suggest?.length) {
    const id = d.objects[0];
    const r = doc.records.get(id);
    if (r?.kind === "symbol") raw.push({ title: `rotate ${r.ref} to face its rail`, ops: [...d.suggest, tidy(r.card)] });
  }
  if (d.suggest?.length && !["C11", "C12", "C13"].includes(d.rule)) raw.push({ title: `${d.rule}: the suggested operations`, ops: d.suggest });
  // the card's wiring drawn again around what is there
  if (card && !["C14", "C15", "C20", "C21", "C24", "C29", "C30"].includes(d.rule)) raw.push({ title: `redraw the wiring of ${card.slice(5)}`, ops: [tidy(card)] });

  const out: FixCandidate[] = [];
  const seen = new Set<string>();
  const sig = (x: Defect) => `${x.rule}|${[...x.objects].sort().join(",")}`;
  const target = sig(d);
  for (const c of raw) {
    const key = JSON.stringify(c.ops);
    if (seen.has(key)) continue;
    seen.add(key);
    if (touches(doc, c.ops).some((i) => isPinned(doc.records.get(i)))) continue;
    // the same operations on the same document score the same (a card redrawn for several of its defects)
    let s = opts.cache?.get(key);
    if (s === null) continue;
    if (!s) {
      let after: SchematicDocument;
      try {
        after = applyCalls(doc, c.ops, dryContext(actor));
      } catch (e) {
        if (e instanceof OpError) {
          opts.cache?.set(key, null);
          continue;
        }
        throw e;
      }
      // layout.run must not change pinned records either (it never does; checked anyway)
      if ([...doc.records.values()].some((r) => isPinned(r) && after.records.get(r.id) !== r)) {
        opts.cache?.set(key, null);
        continue;
      }
      s = scoreSchematic(after);
      opts.cache?.set(key, s);
    }
    if (s.gates.open > before.gates.open || s.gates.rules.some((g) => !before.gates.rules.includes(g))) continue;
    out.push({ title: c.title, rule: d.rule, defect: d.id, ops: c.ops, predicted: { before: before.score, after: s.score, delta: s.score - before.score, gatesBefore: before.gates.open, gatesAfter: s.gates.open, resolved: !s.defects.some((x) => sig(x) === target) } });
  }
  out.sort((a, b) => b.predicted.gatesBefore - b.predicted.gatesAfter - (a.predicted.gatesBefore - a.predicted.gatesAfter) || b.predicted.delta - a.predicted.delta || Number(b.predicted.resolved) - Number(a.predicted.resolved));
  return out.slice(0, opts.max ?? 4);
}

/** The text search of the layout (./layout/text.ts) run for one label, power symbol or part's fields, as operations. */
function moveText(doc: SchematicDocument, r: SchematicRecord, near: boolean): { title: string; ops: OpCall[] } | undefined {
  const card = "card" in r ? r.card : undefined;
  if (!card) return undefined;
  const syms = recordsOfKind(doc, "symbol").filter((s) => s.card === card);
  const ts: TSym[] = syms.map((s) => ({ rec: s, g: placeSymbol(doc, s)!, movableFields: !s.pinned }));
  const ls = recordsOfKind(doc, "label").filter((l) => l.card === card);
  const ps = recordsOfKind(doc, "power").filter((p) => p.card === card);
  const tl: TLabel[] = ls.map((l) => ({ kind: "label", net: l.net, at: [l.x, l.y], side: l.side, scope: l.scope, movable: !l.pinned }));
  const tp: TPower[] = ps.map((p) => ({ kind: "power", net: p.net, at: [p.x, p.y], dir: p.dir, style: p.style, movable: !p.pinned }));
  const tw: TWire[] = recordsOfKind(doc, "wire").filter((w) => w.card === card).map((w) => ({ net: w.net, points: w.points.map((p) => [p[0], p[1]] as XY) }));
  const n0 = tw.length;
  let target: TLabel | TPower | TSym | undefined;
  if (r.kind === "label") target = tl[ls.findIndex((x) => x.id === r.id)];
  else if (r.kind === "power") target = tp[ps.findIndex((x) => x.id === r.id)];
  else if (r.kind === "symbol") target = ts[syms.findIndex((x) => x.id === r.id)];
  if (!target) return undefined;
  if (near && r.kind === "symbol") {
    // a field nearer another part: put the fields back where they derive, or let the search choose
    return { title: `put ${r.ref}'s reference and value beside it`, ops: [{ op: "symbol.place", id: r.id, fields: null }] };
  }
  placeText(doc, { symbols: ts, labels: tl, powers: tp, wires: tw }, { only: new Set([target]), passes: 1 });
  const ops: OpCall[] = [];
  const stubs = tw.slice(n0);
  if (r.kind === "label") {
    const t = target as TLabel;
    if (t.at[0] === r.x && t.at[1] === r.y && t.side === r.side) return undefined;
    if (t.side === r.side) ops.push({ op: "item.move", ids: [r.id], dx: t.at[0] - r.x, dy: t.at[1] - r.y, pin: false });
    else ops.push({ op: "label.delete", ids: [r.id] }, { op: "label.add", labels: [{ net: r.net, card, x: t.at[0], y: t.at[1], side: t.side, scope: r.scope }] });
  } else if (r.kind === "power") {
    const t = target as TPower;
    if (t.at[0] === r.x && t.at[1] === r.y) return undefined;
    ops.push({ op: "item.move", ids: [r.id], dx: t.at[0] - r.x, dy: t.at[1] - r.y, pin: false });
  } else if (r.kind === "symbol") {
    const t = target as TSym;
    if (JSON.stringify(t.rec.fields) === JSON.stringify(r.fields)) return undefined;
    ops.push({ op: "symbol.place", id: r.id, fields: t.rec.fields ?? null });
  }
  if (stubs.length) ops.push({ op: "wire.add", wires: stubs.map((w) => ({ net: w.net, card, points: w.points })) });
  const what = r.kind === "label" ? `label ${r.net}` : r.kind === "power" ? `the ${r.net} symbol` : `${(r as SymbolRecT).ref}'s reference and value`;
  return { title: `move ${what} clear${stubs.length ? " on a stub" : ""}`, ops };
}

/** Places beside the served pin for a satellite, nearest first, clear of everything drawn. */
function satelliteMoves(doc: SchematicDocument, s: SymbolRecT): { title: string; op: OpCall }[] {
  const cls = classify(doc);
  const info = cls.parts.get(s.part);
  if (!info?.serves) return [];
  const g = geometryOf(doc);
  let target: XY | undefined;
  if (info.serves.startsWith("port:")) {
    const l = recordsOfKind(doc, "label").find((x) => x.net === info.serves!.slice(5) && x.card === s.card);
    target = l ? [l.x, l.y] : undefined;
  } else target = g.pins.get(info.serves.startsWith("sat:") ? info.serves.slice(4) : info.serves)?.at;
  if (!target) return [];
  const me = g.symbols.get(s.id)!;
  const servedNet = info.serves.startsWith("port:") ? info.serves.slice(5) : doc.pinNets.get(info.serves.replace(/^sat:/, ""));
  const myPin = me.pins.find((p) => p.net === servedNet) ?? me.pins[0];
  // obstacles: every other symbol's full box and fields, labels, power symbols, wires of other nets
  const boxes: LBox[] = [];
  for (const o of g.symbols.values()) if (o.rec.id !== s.id && o.rec.card === s.card) boxes.push(inflateBox(o.full, 0.5), o.ref, ...(o.value ? [o.value] : []));
  for (const l of recordsOfKind(doc, "label")) if (l.card === s.card) boxes.push(labelBox(l, doc));
  for (const p of recordsOfKind(doc, "power")) if (p.card === s.card) {
    const b = powerBoxes(p, doc);
    boxes.push(b.glyph, ...(b.text ? [b.text] : []));
  }
  const segs = g.segments.filter((x) => x.net !== servedNet && recordsOfKind(doc, "wire").some((w) => w.id === x.wire && w.card === s.card));
  const card = doc.records.get(s.card);
  const cardBox = card?.kind === "card" ? { x0: card.x + 1, y0: card.y + 3, x1: card.x + card.w - 1, y1: card.y + card.h - 1 } : undefined;
  const cands: { dx: number; dy: number; d: number }[] = [];
  for (let ox = -10; ox <= 10; ox++)
    for (let oy = -10; oy <= 10; oy++) {
      const nx = target[0] + ox;
      const ny = target[1] + oy;
      const dx = nx - myPin.at[0];
      const dy = ny - myPin.at[1];
      if (!dx && !dy) continue;
      const body = { x0: me.body.x0 + dx, y0: me.body.y0 + dy, x1: me.body.x1 + dx, y1: me.body.y1 + dy };
      const gap = Math.hypot(Math.max(0, body.x0 - target[0], target[0] - body.x1), Math.max(0, body.y0 - target[1], target[1] - body.y1));
      if (gap > 5 || gap < 1) continue;
      cands.push({ dx, dy, d: gap + 0.01 * (Math.abs(dx) + Math.abs(dy)) });
    }
  cands.sort((a, b) => a.d - b.d || a.dx - b.dx || a.dy - b.dy);
  const out: { title: string; op: OpCall }[] = [];
  for (const c of cands) {
    const rec: SymbolRecT = { ...s, x: s.x + c.dx, y: s.y + c.dy };
    const m = placeSymbol(doc, rec)!;
    const mine = [inflateBox(m.full, 0.5), m.ref, ...(m.value ? [m.value] : [])];
    if (cardBox && !mine.every((b) => b.x0 >= cardBox.x0 && b.x1 <= cardBox.x1 && b.y0 >= cardBox.y0 && b.y1 <= cardBox.y1)) continue;
    if (mine.some((b) => boxes.some((o) => boxesOverlap(b, o, 0)))) continue;
    if (segs.some((sg) => mine.some((b) => segmentThroughBox(sg, b, 0)))) continue;
    out.push({ title: `move ${s.ref} beside the pin it serves`, op: { op: "item.move", ids: [s.id], dx: c.dx, dy: c.dy, pin: false } });
    if (out.length >= 3) break;
  }
  return out;
}

/** Apply one candidate as an ordinary transaction by the agent actor (one undo step). */
export function applyFix(svc: SchematicService, fix: Pick<FixCandidate, "title" | "ops">, opts: { actor?: Actor; changeSet?: { id: string; title?: string }; batchId?: string } = {}) {
  const label = `cleanup: ${fix.title}`.split(/\s+/).slice(0, 8).join(" ");
  return svc.apply({ batchId: opts.batchId ?? `cleanup-${svc.epoch}-${svc.seq + 1}`, label: label.split(" ").length < 3 ? `${label} cleanup fix` : label, ops: fix.ops, ...(opts.changeSet ? { changeSet: opts.changeSet } : {}) }, opts.actor ?? CLEANUP_AGENT);
}

export interface CleanupStep {
  defect: string;
  rule: string;
  title: string;
  ops: number;
  before: number;
  after: number;
}
export interface CleanupResult {
  changeSet: { id: string; title: string; transactions: number; ops: number };
  before: { score: number; gates: number; rules: string[] };
  after: { score: number; gates: number; rules: string[] };
  /** scans of the defect list; at most `maxPasses` */
  passes: number;
  /** candidate fixes scored */
  tried: number;
  steps: CleanupStep[];
  /** why it stopped */
  stopped: "no-improvement" | "budget" | "max-passes" | "clean";
}

/**
 * The greedy cleanup driver. Each pass lists the defects (gates first, then points recoverable) and, for each in
 * turn, applies the best candidate that raises the score (or closes gates) without opening a gate, then lists again.
 * Stops when a whole pass improves nothing, when `budget` operations are spent, or after `maxPasses` passes (a strict
 * bound). A defect with no improving fix is not tried again until a fix lands in its card; pinned items are never
 * touched. Every transaction carries the
 * change set `changeSet`; `revertCleanup` undoes all of it.
 */
export function cleanupPass(svc: SchematicService, opts: { budget?: number; maxPasses?: number; perPass?: number; actor?: Actor; changeSet?: { id: string; title?: string } } = {}): CleanupResult {
  const budget = opts.budget ?? 60;
  const maxPasses = opts.maxPasses ?? 12;
  const perPass = opts.perPass ?? 200;
  const actor = opts.actor ?? CLEANUP_AGENT;
  const cs = { id: opts.changeSet?.id ?? `cleanup-${svc.epoch}-${svc.seq}`, title: opts.changeSet?.title ?? "agent cleanup" };
  const s0 = svc.score();
  const steps: CleanupStep[] = [];
  let ops = 0;
  let tried = 0;
  let passes = 0;
  let stopped: CleanupResult["stopped"] = "no-improvement";
  /** defects with no improving fix, by signature, with their card: tried again only after a fix lands in that card */
  const failed = new Map<string, string | undefined>();
  /** candidate scores on the current document, cleared whenever a fix lands */
  const cache = new Map<string, Score | null>();
  const sig = (d: Defect) => `${d.rule}|${[...d.objects].sort().join(",")}`;
  outer: for (;;) {
    if (passes >= maxPasses) {
      stopped = "max-passes";
      break;
    }
    passes++;
    let improved = false;
    let looked = 0;
    for (;;) {
      const score = svc.score();
      const list = listDefects(svc.snapshot().doc, { score }).defects.filter((d) => !failed.has(sig(d)));
      if (!score.defects.some((d) => d.severity !== "info")) {
        stopped = "clean";
        break outer;
      }
      const d = list[0];
      if (!d || looked >= perPass) break;
      looked++;
      const cands = proposeFixes(svc.snapshot().doc, d, { score, actor, max: 4, cache });
      tried += cands.length;
      const best = cands.find((c) => c.predicted.gatesAfter < c.predicted.gatesBefore || c.predicted.delta > 0);
      if (!best || ops + best.ops.length > budget) {
        failed.set(sig(d), d.card);
        if (best && ops + best.ops.length > budget) {
          stopped = "budget";
          break outer;
        }
        continue;
      }
      const r = applyFix(svc, best, { actor, changeSet: cs });
      if (r.status !== "applied") {
        failed.set(sig(d), d.card);
        continue;
      }
      for (const [k, c] of failed) if (c === d.card || !c) failed.delete(k);
      cache.clear();
      ops += best.ops.length;
      steps.push({ defect: d.id, rule: d.rule, title: best.title, ops: best.ops.length, before: best.predicted.before, after: best.predicted.after });
      improved = true;
    }
    if (!improved) break;
  }
  const s1 = svc.score();
  return {
    changeSet: { id: cs.id, title: cs.title, transactions: steps.length, ops },
    before: { score: s0.score, gates: s0.gates.open, rules: s0.gates.rules },
    after: { score: s1.score, gates: s1.gates.open, rules: s1.gates.rules },
    passes,
    tried,
    steps,
    stopped,
  };
}

/** Revert a cleanup change set as a whole: undo the agent's transactions of that change set, newest first. */
export function revertCleanup(svc: SchematicService, result: Pick<CleanupResult, "changeSet">, actor: Actor = CLEANUP_AGENT): number {
  let n = 0;
  for (let i = 0; i < result.changeSet.transactions; i++) {
    const r = svc.undo(actor);
    if (r.status !== "applied") break;
    n++;
  }
  return n;
}

/** The cleanup tools as a CLI or MCP host binds them: name, description and input schema. */
export const CLEANUP_TOOLS = [
  {
    name: "schematic_list_defects",
    description: "List the schematic's readability defects, numbered, gates first then by the score points each would recover, with the rule, location, objects and a crop box to look at.",
    input: z.object({ card: z.string().optional(), rules: z.array(z.string()).optional(), includeInfo: z.boolean().optional(), limit: z.number().int().positive().optional() }).strict(),
  },
  {
    name: "schematic_propose_fixes",
    description: "Propose a few candidate fixes for one defect (by id or number), each a list of ordinary operations with the score predicted by applying it to a copy. Never touches pinned items; never opens a gate.",
    input: z.object({ defect: z.union([z.string(), z.number()]), max: z.number().int().positive().max(10).optional() }).strict(),
  },
  {
    name: "schematic_apply_fix",
    description: "Apply one proposed fix as an ordinary transaction by the agent (one undo step), optionally in a change set.",
    input: z.object({ title: z.string(), ops: z.array(z.object({ op: z.string() }).passthrough()).min(1).max(200), changeSet: z.object({ id: z.string(), title: z.string().optional() }).optional() }).strict(),
  },
  {
    name: "schematic_explain_defect",
    description: "Explain one defect in plain words: what is wrong, where, why it matters and what fixes it.",
    input: z.object({ defect: z.union([z.string(), z.number()]) }).strict(),
  },
  {
    name: "schematic_cleanup_pass",
    description: "Clean up greedily: the defect worth most first, the best fix that raises the score without opening a gate, until nothing improves or the budget of operations is spent. Returns one change set to accept or revert as a whole, with the score before and after and the passes used.",
    input: z.object({ budget: z.number().int().positive().max(1000).optional(), maxPasses: z.number().int().positive().max(50).optional() }).strict(),
  },
] as const;

export type { RuleSeverity };

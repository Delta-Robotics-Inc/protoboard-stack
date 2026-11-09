/**
 * Incremental checks (contract docs/specs/pcb-editor/phase2-editing.md, section 6.2): keep the analysis of a board
 * between edits and, after an edit, recheck only what the edit can reach. The result after every update equals
 * what `runBoardChecks(next, { fills, join })` returns for the same document (findings, their order, the summary's
 * counts and line, connectivity); the property test in test/incremental.test.ts holds the two together on random
 * edit sequences.
 *
 * How an update works:
 *
 * - The changed records are the given `changed` ids plus every record that is not the same object as before
 *   (records are frozen and shared between documents, so this costs one pass over the ids), plus footprints whose
 *   pads' nets changed.
 * - Footprints, tracks, vias and silkscreen graphics and texts are rebuilt per record (incremental-model.ts); the
 *   model is reassembled in `buildModel`'s order, so indexes, lists and grids read as a fresh build.
 * - The pair scan keeps every pair of unchanged items and measures each added item against its neighbors.
 * - Connectivity is recomputed in full from the kept scan (linear; incremental-connectivity.ts), keeping which
 *   contacts join and each track's dangling ends.
 * - Each check keeps what it measured per subject and measures again where copper, pads, holes or courtyards were
 *   added or removed within its search distance, or an object's carried net changed (incremental-checks.ts).
 *
 * - New zone fill is compared with the kept fill polygon by polygon (incremental-model.ts `diffFills`): an
 *   unchanged polygon keeps its item; one whose holes changed is a local change whose dirty region is the boxes of
 *   the holes on one side only; any other change replaces the item.
 *
 * A full run (`mode: "full"`) replaces the incremental one when a change has board-wide reach: a rule or net
 * class, the outline or a cutout, the board record or the stackup, a zone or keep-out, the netlist, fill going
 * from absent to present or back, fill whose notes or filled zones change or where more than half the rings
 * changed, new fill while a rule tests an object's shape against an area (a region, a courtyard or area
 * condition), `fillChanged` without new fill, a footprint change while a rule tests courtyards in a condition,
 * and any record kind this mode does not rebuild per record. Nothing here reads or writes `analyzeBoard`'s cache.
 */
import { byCodeUnit, canonical, canonicalRecord, FindingSchema, recordsOfKind, sha1Hex, sha256Hex, type BoardDocument, type BoardRecord, type Box, type CopperLayer, type Finding, type RuleCondition } from "@protoboardai/board";
import { coverage, makeFinding, type Analysis } from "./checks.js";
import type { ConnectivityResult, JoinRule } from "./connectivity.js";
import { normalizeFills, type ZoneFillInput, type ZoneFillSet } from "./fills.js";
import { CHECKS_VERSION, inputHash } from "./hash.js";
import { connectivityFrom, type ConnectivityCaches } from "./incremental-connectivity.js";
import { newCheckCaches, runChecksKept, type CheckCaches, type CheckContext, type MakeFinding } from "./incremental-checks.js";
import { assembleModel, buildPieces, diffFills, edgePartOf, fullScan, groupPieces, insertSorted, PIECE_KINDS, pieceOrder, removeSorted, rescan, zonePartOf, type EdgePart, type FillDiff, type PairRec, type Piece, type PieceOrder, type ZonePart } from "./incremental-model.js";
import { buildModel, type CheckModel, type CopperItem } from "./model.js";
import { RuleBook } from "./rules.js";
import type { BoardCheckResult } from "./run.js";
import { summarize, type Timing } from "./summary.js";

export interface IncrementalChecks {
  /** The current result, as `runBoardChecks` returns it for the current document. */
  readonly result: BoardCheckResult;
  /**
   * Check `next`, the document after an edit. `changed` is the record ids added, changed or removed since the
   * current document (a transaction's `changed` list); records that are not the same object are found anyway.
   * `fills` replaces the zone fill (else the previous fill is kept); `fillChanged` lists zones whose fill changed.
   */
  update(next: BoardDocument, changed: readonly string[], options?: { fills?: ZoneFillInput; fillChanged?: string[] }): IncrementalUpdate;
}

export interface IncrementalUpdate {
  result: BoardCheckResult;
  /** Findings new since the previous result, or whose content changed (by id). */
  added: Finding[];
  /** Ids of findings gone since the previous result, or whose content changed (each such id is also in `added`). */
  removed: string[];
  mode: "incremental" | "full";
  /** Wall time of the update, milliseconds. */
  ms: number;
}

interface State {
  doc: BoardDocument;
  fills?: ZoneFillSet;
  join: JoinRule;
  /** The stackup records (layers and the board record), for building pieces. */
  base: BoardRecord[];
  layers: CopperLayer[];
  pieces: Map<string, Piece>;
  order: PieceOrder;
  zones: ZonePart;
  edges: EdgePart;
  model: CheckModel;
  radius: number;
  pairs: PairRec[];
  /** What connectivity keeps between edits (track ends, shorts through copper without a net, the last sort). */
  conn: ConnectivityCaches;
  /** The rule book, kept while no footprint changes (it reads footprints for conditions). */
  rules: RuleBook;
  caches: CheckCaches;
  memo: Map<string, Finding>;
  /** Whether a rule tests courtyards in a condition (a footprint change then reaches anywhere). */
  courtyardRules: boolean;
  /** Whether a rule tests an object's shape against an area (a region, or a courtyard or area condition): a change
   * of a zone fill anywhere can then change how a rule matches the fill item, so new fill runs in full. */
  shapeRules: boolean;
  hash: KeptHash;
  /** The current findings by id, and the diff of the last check against the previous findings. */
  byId: Map<string, Finding>;
  diff: { added: Finding[]; removed: string[] };
  result: BoardCheckResult;
}

/** A state while its result is being made. */
type Working = Omit<State, "result"> & { result?: BoardCheckResult };

const now = () => performance.now();
const ms = (t: number) => Math.round((now() - t) * 100) / 100;

/** Findings already validated against the contract's schema (memoized findings are validated once). */
const validated = new WeakSet<Finding>();

/** Boxes per layer (or for any layer), tested by meeting. */
class Boxes {
  private readonly byLayer = new Map<string, Box[]>();
  private readonly all: Box[] = [];
  add(layer: string | undefined, b: Box): void {
    this.all.push(b);
    if (layer === undefined) return;
    const l = this.byLayer.get(layer);
    if (l) l.push(b);
    else this.byLayer.set(layer, [b]);
  }
  get size(): number {
    return this.all.length;
  }
  meets(layer: string | undefined, q: Box): boolean {
    const list = layer === undefined ? this.all : this.byLayer.get(layer);
    if (!list) return false;
    for (const b of list) if (b.minX <= q.maxX && q.minX <= b.maxX && b.minY <= q.maxY && q.minY <= b.maxY) return true;
    return false;
  }
}

function conditionUses(c: RuleCondition, key: string): boolean {
  if ("all" in c) return c.all.some((x) => conditionUses(x, key));
  if ("any" in c) return c.any.some((x) => conditionUses(x, key));
  if ("not" in c) return conditionUses(c.not, key);
  return key in c;
}

const usesShapeRules = (doc: BoardDocument): boolean =>
  recordsOfKind(doc, "rule").some((r) => r.enabled !== false && (r.applies.region !== undefined || (r.applies.when !== undefined && (conditionUses(r.applies.when, "courtyard") || conditionUses(r.applies.when, "area")))));

/** A share of rings changed beyond which new fill runs in full (localizing would cost about as much). */
const FILL_CHANGE_LIMIT = 0.5;

const usesCourtyardCondition = (doc: BoardDocument): boolean => recordsOfKind(doc, "rule").some((r) => r.enabled !== false && r.applies.when !== undefined && conditionUses(r.applies.when, "courtyard"));

/** The clearance search radius, as `analyzeBoard` sets it. */
function searchRadius(doc: BoardDocument, model: CheckModel, rules: RuleBook): number {
  let zoneClearance = 0;
  for (const id of model.filledZones) {
    const z = doc.records.get(id);
    if (z?.kind === "zone" && z.clearance !== undefined) zoneClearance = Math.max(zoneClearance, z.clearance);
  }
  return Math.max(rules.maxMin("clearance"), zoneClearance);
}

function freezeFinding(f: Finding): Finding {
  Object.freeze(f.objects);
  Object.freeze(f.location);
  if (f.box) Object.freeze(f.box);
  return Object.freeze(f);
}

/** `makeFinding` through the memo of the previous result: the same inputs give the same finding object. */
function memoMaker(prev: Map<string, Finding>, next: Map<string, Finding>): MakeFinding {
  return (check, severity, objects, loc, message, extra = {}) => {
    const b = extra.box;
    const key = JSON.stringify([check, severity, objects, loc.x, loc.y, loc.layer ?? null, message, extra.rule ?? null, extra.tier ?? null, b ? [b.minX, b.minY, b.maxX, b.maxY] : null, extra.measured ?? null, extra.required ?? null]);
    let f = next.get(key) ?? prev.get(key);
    if (!f) f = freezeFinding(makeFinding(check, severity, objects, loc, message, extra));
    next.set(key, f);
    return f;
  };
}

/** Validate, drop repeats by id and sort, as `runChecks` does for `runBoardChecks`. */
const SEVERITY = { error: 0, warning: 1, info: 2 } as const;
const bySeverityThenId = (a: Finding, b: Finding) => SEVERITY[a.severity] - SEVERITY[b.severity] || byCodeUnit(a.id, b.id);

/**
 * Validate, drop repeats by id and sort, as `runChecks` does for `runBoardChecks`. With the previous result, the
 * findings it shares (the same objects) keep their order and only the new ones are sorted in; the diff comes out
 * of the same pass.
 */
function finalize(perCheck: { check: string; findings: Finding[] }[], prev?: { findings: Finding[]; byId: Map<string, Finding> }): { findings: Finding[]; byId: Map<string, Finding>; added: Finding[]; removed: string[] } {
  const out = new Map<string, Finding>();
  for (const { findings } of perCheck)
    for (const f of findings) {
      if (!validated.has(f)) {
        const r = FindingSchema.safeParse(f);
        if (!r.success) throw new Error(`check ${f.check} returned a malformed finding: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        validated.add(f);
      }
      if (!out.has(f.id)) out.set(f.id, f);
    }
  if (!prev) return { findings: [...out.values()].sort(bySeverityThenId), byId: out, added: [...out.values()], removed: [] };
  const kept: Finding[] = [];
  const removed: string[] = [];
  for (const f of prev.findings) {
    const n = out.get(f.id);
    if (n === f) kept.push(f);
    else if (!n || !sameFinding(f, n)) removed.push(f.id);
  }
  const fresh: Finding[] = [];
  const added: Finding[] = [];
  for (const f of out.values()) {
    const p = prev.byId.get(f.id);
    if (p === f) continue;
    fresh.push(f);
    if (!p || !sameFinding(p, f)) added.push(f);
  }
  fresh.sort(bySeverityThenId);
  const findings: Finding[] = [];
  let i = 0;
  let j = 0;
  while (i < kept.length || j < fresh.length) {
    if (j >= fresh.length || (i < kept.length && bySeverityThenId(kept[i], fresh[j]) < 0)) findings.push(kept[i++]);
    else findings.push(fresh[j++]);
  }
  return { findings, byId: out, added, removed };
}

const NO_CHANGE: Pick<CheckContext, "copperDirty" | "padDirty" | "holeDirty" | "courtyardDirty" | "footprintsChanged" | "netChanged"> = {
  copperDirty: () => false,
  padDirty: () => false,
  holeDirty: () => false,
  courtyardDirty: () => false,
  footprintsChanged: false,
  netChanged: new Set(),
};

/** Connectivity, the checks and the result for a state whose model, rules and scan are current. */
function check(s: Working, rules: RuleBook, hash: string, stages: Record<string, number>, t0: number, change: Pick<CheckContext, "copperDirty" | "padDirty" | "holeDirty" | "courtyardDirty" | "footprintsChanged"> & { shapeDirty: (layer: CopperLayer, box: Box) => boolean; prevCarried?: Record<string, string> }): BoardCheckResult {
  let t = now();
  const contacts: PairRec[] = [];
  const near: PairRec[] = [];
  for (const p of s.pairs) (p.contact ? contacts : near).push(p);
  const connectivity: ConnectivityResult = connectivityFrom(s.model, contacts, hash, s.join, Object.assign(s.conn, { dirty: change.shapeDirty }));
  stages.connectivity = ms(t);
  // objects whose carried net changed: their neighbors' net-dependent results are measured again
  const netChanged = new Set<string>();
  let copperDirty = change.copperDirty;
  let holeDirty = change.holeDirty;
  if (change.prevCarried) {
    const before = change.prevCarried;
    const after = connectivity.carried;
    for (const k of Object.keys(before)) if (after[k] !== before[k]) netChanged.add(k);
    for (const k of Object.keys(after)) if (after[k] !== before[k]) netChanged.add(k);
    if (netChanged.size) {
      const copperBoxes = new Boxes();
      const holeBoxes = new Boxes();
      for (const it of s.model.copper) if (netChanged.has(it.id)) copperBoxes.add(it.layer, it.shape.box);
      for (const h of s.model.holes) if (netChanged.has(h.id)) holeBoxes.add(undefined, h.shape.box);
      const c0 = copperDirty;
      const h0 = holeDirty;
      copperDirty = (l, b) => c0(l, b) || copperBoxes.meets(l, b);
      holeDirty = (b) => h0(b) || holeBoxes.meets(undefined, b);
    }
  }
  const cov = coverage({ rules, model: s.model });
  const analysis: Analysis = { model: s.model, rules, scan: { contacts, near, radius: s.radius }, connectivity, inputHash: hash, notRun: cov.notRun, notes: [...s.model.notes, ...cov.defaults.map((d) => `${d.check}: ${d.reason}`)] };
  const memo = new Map<string, Finding>();
  const ctx: CheckContext = { mk: memoMaker(s.memo, memo), copperDirty, padDirty: change.padDirty, holeDirty, courtyardDirty: change.courtyardDirty, footprintsChanged: change.footprintsChanged, netChanged };
  const perCheck = runChecksKept(analysis, near, ctx, s.caches);
  for (const c of perCheck) stages[c.check] = c.ms;
  t = now();
  const fin = finalize(perCheck, s.result ? { findings: s.result.findings, byId: s.byId } : undefined);
  const findings = fin.findings;
  stages.finalize = ms(t);
  s.memo = memo;
  s.byId = fin.byId;
  s.diff = { added: fin.added, removed: fin.removed };
  const timing: Timing = { totalMs: ms(t0), stages };
  return {
    inputHash: hash,
    findings,
    connectivity,
    summary: summarize(findings, connectivity, { timing, notRun: analysis.notRun }),
    notRun: analysis.notRun,
    defaults: coverage(analysis).defaults,
    notes: analysis.notes,
  };
}

// ---------------------------------------------------------------- the input hash, kept

/** Each record's hash line, as hash.ts builds `inputHash`, kept sorted by id between edits. */
interface KeptHash {
  ids: string[];
  lines: Map<string, string>;
}

const recordHashes = new WeakMap<BoardRecord, string>();
function recordLine(r: BoardRecord): string {
  let h = recordHashes.get(r);
  if (!h) {
    h = sha1Hex(canonicalRecord(r));
    recordHashes.set(r, h);
  }
  return `${r.id}\u0000${h}`;
}
const netlistHashes = new WeakMap<object, string>();

function keptHash(doc: BoardDocument): KeptHash {
  const ids = [...doc.records.keys()].sort(byCodeUnit);
  return { ids, lines: new Map(ids.map((id) => [id, recordLine(doc.records.get(id)!)])) };
}

function rehash(k: KeptHash, doc: BoardDocument, changed: Iterable<string>): void {
  for (const id of changed) {
    const r = doc.records.get(id);
    if (r) {
      insertSorted(k.ids, id);
      k.lines.set(id, recordLine(r));
    } else {
      removeSorted(k.ids, id);
      k.lines.delete(id);
    }
  }
}

/**
 * `canonical(value)` (board's canonical JSON: arrays in order, object keys in code-unit order, keys whose value is
 * undefined left out, finite numbers only), with fast paths for what a zone fill is mostly made of: flat number
 * rings and `{ x, y }` or `{ sweep, x, y }` points. Anything else goes through `canonical` itself.
 */
function fillCanonical(value: unknown): string {
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (i) out += ",";
      if (typeof v === "number" && Number.isFinite(v)) out += String(v);
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const keys = Object.keys(o);
        const { x, y, sweep } = o as { x?: unknown; y?: unknown; sweep?: unknown };
        const plainPoint = typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) && (keys.length === 2 || (keys.length === 3 && "sweep" in o && (sweep === undefined || (typeof sweep === "number" && Number.isFinite(sweep)))));
        if (plainPoint) out += sweep === undefined ? `{"x":${x},"y":${y}}` : `{"sweep":${sweep},"x":${x},"y":${y}}`;
        else out += fillCanonical(v);
      } else out += fillCanonical(v);
    }
    return `${out}]`;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort(byCodeUnit);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${fillCanonical(o[k])}`).join(",")}}`;
  }
  return canonical(value);
}

/** `fillsHash` (hash.ts) through `fillCanonical`, kept per fill set. */
const fillHashes = new WeakMap<ZoneFillSet, string>();
function keptFillsHash(fills: ZoneFillSet | undefined): string {
  if (!fills) return "none";
  let h = fillHashes.get(fills);
  if (!h) {
    h = sha256Hex(fillCanonical(fills));
    fillHashes.set(fills, h);
  }
  return h;
}

/** `inputHash(doc, fills)` from the kept lines (the same parts, joined and hashed as hash.ts does). */
function hashOf(k: KeptHash, doc: BoardDocument, fills: ZoneFillSet | undefined): string {
  const parts: string[] = [CHECKS_VERSION];
  for (const id of k.ids) parts.push(k.lines.get(id)!);
  let nl = "none";
  if (doc.netlist) {
    nl = netlistHashes.get(doc.netlist) ?? sha1Hex(canonical(doc.netlist));
    netlistHashes.set(doc.netlist, nl);
  }
  parts.push(`netlist\u0000${nl}`);
  parts.push(`fills\u0000${keptFillsHash(fills)}`);
  return `sha256:${sha256Hex(parts.join("\n"))}`;
}

/** A state from scratch: the full run. */
function fullState(doc: BoardDocument, fills: ZoneFillSet | undefined, join: JoinRule): State {
  const t0 = now();
  const stages: Record<string, number> = {};
  const hash = inputHash(doc, fills);
  let t = now();
  // a fresh build: never the model `analyzeBoard` caches, whose items this state would renumber
  const built = buildModel(doc, fills);
  const pieces = groupPieces(built, doc.records.values());
  const order = pieceOrder(pieces);
  const zones = zonePartOf(built, pieces);
  const edges = edgePartOf(built);
  const layers = built.layers;
  const model = assembleModel(doc, layers, pieces, order, zones, edges);
  const rules = new RuleBook(doc);
  stages.model = ms(t);
  t = now();
  const radius = searchRadius(doc, model, rules);
  const pairs = fullScan(model, radius);
  stages.pairs = ms(t);
  const s: Omit<State, "result"> & { result?: BoardCheckResult } = {
    doc,
    ...(fills ? { fills } : {}),
    join,
    base: [...doc.records.values()].filter((r) => r.kind === "layer" || r.kind === "board"),
    layers,
    pieces,
    order,
    zones,
    edges,
    model,
    radius,
    pairs,
    conn: { ends: new WeakMap(), dirty: () => false, bridged: new Map(), trees: new Map() },
    rules,
    caches: newCheckCaches(),
    memo: new Map(),
    courtyardRules: usesCourtyardCondition(doc),
    shapeRules: usesShapeRules(doc),
    hash: keptHash(doc),
    byId: new Map(),
    diff: { added: [], removed: [] },
    result: undefined,
  };
  s.result = check(s, rules, hash, stages, t0, { ...NO_CHANGE, shapeDirty: () => false });
  return s as State;
}

/** The state after an edit, or undefined when the edit needs a full run. Mutates `s` (the caller drops it). */
function incrementalState(s: State, next: BoardDocument, hint: readonly string[], fills?: ZoneFillSet): State | undefined {
  const t0 = now();
  const stages: Record<string, number> = {};
  const prev = s.doc;
  if (next.netlist !== prev.netlist) return undefined;
  const changed = new Set<string>();
  for (const id of hint) if (prev.records.get(id) !== next.records.get(id)) changed.add(id);
  for (const [id, r] of next.records) if (prev.records.get(id) !== r) changed.add(id);
  for (const id of prev.records.keys()) if (!next.records.has(id)) changed.add(id);
  if (next.padNets !== prev.padNets)
    for (const id of s.order.footprint) {
      const p = s.pieces.get(id)!;
      if (p.pads.some(([pad]) => next.padNets.get(pad) !== prev.padNets.get(pad))) changed.add(id);
    }
  let footprintsChanged = false;
  for (const id of changed) {
    const before = prev.records.get(id)?.kind;
    const after = next.records.get(id)?.kind;
    for (const k of [before, after]) {
      if (k === undefined) continue;
      if (!PIECE_KINDS.has(k)) return undefined;
      if (k === "footprint") footprintsChanged = true;
    }
  }
  if (footprintsChanged && s.courtyardRules) return undefined;
  // new zone fill: compared with the kept fill polygon by polygon, hole by hole
  let fd: FillDiff | undefined;
  if (fills) {
    if (s.shapeRules) return undefined;
    fd = diffFills(s.zones, next, s.base, fills);
    if (!fd) return undefined;
    if (fd.changedRings > 8 && fd.changedRings > FILL_CHANGE_LIMIT * fd.totalRings) return undefined;
  }

  let t = now();
  const removed = new Set<CopperItem>();
  const added: CopperItem[] = [];
  const olds = new Map<string, Piece>();
  const shape = new Boxes();
  const pads = new Boxes();
  const holes = new Boxes();
  const yards = new Boxes();
  const note = (p: Piece) => {
    for (const it of p.copper) {
      shape.add(it.layer, it.shape.box);
      if (it.kind === "pad") pads.add(it.layer, it.shape.box);
    }
    for (const h of p.holes) holes.add(undefined, h.shape.box);
    for (const c of p.courtyards) yards.add(undefined, c.poly.box);
  };
  const rebuild: BoardRecord[] = [];
  for (const id of changed) {
    const old = s.pieces.get(id);
    if (old) {
      note(old);
      olds.set(id, old);
      for (const it of old.copper) removed.add(it);
      s.pieces.delete(id);
      removeSorted(s.order[old.rec.kind as keyof PieceOrder], id);
    }
    const rec = next.records.get(id);
    if (rec && PIECE_KINDS.has(rec.kind)) rebuild.push(rec);
  }
  if (rebuild.length)
    for (const [id, p] of buildPieces(next, s.base, rebuild)) {
      note(p);
      added.push(...p.copper);
      s.pieces.set(id, p);
      insertSorted(s.order[p.rec.kind as keyof PieceOrder], id);
    }
  // records that only changed in place keep every index: the previous grids are updated, not rebuilt
  const swaps: [Piece, Piece][] = [];
  let swapOnly = true;
  for (const id of changed) {
    const o = olds.get(id);
    const n = s.pieces.get(id);
    if (o && n) swaps.push([o, n]);
    else if (o || n) swapOnly = false;
  }
  if (fd) {
    for (const o of fd.removed) {
      removed.add(o);
      shape.add(o.layer, o.shape.box);
    }
    for (const n of fd.added) {
      added.push(n);
      shape.add(n.layer, n.shape.box);
    }
    for (const l of fd.local) for (const b of l.boxes) shape.add(l.now.layer, b);
    s.zones = fd.zones;
    s.fills = fills;
    if (!fd.itemSwaps) swapOnly = false;
  }
  const prevModel = s.model;
  s.doc = next;
  s.model = assembleModel(next, s.layers, s.pieces, s.order, s.zones, s.edges, swapOnly ? { model: prevModel, swaps, ...(fd?.itemSwaps ? { itemSwaps: fd.itemSwaps } : {}) } : undefined);
  // the rule book reads footprints (conditions on a footprint or its courtyard): kept unless one changed
  const rules = footprintsChanged ? new RuleBook(next) : s.rules;
  s.rules = rules;
  stages.model = ms(t);
  t = now();
  s.pairs = rescan(s.model, s.pairs, removed, added, s.radius, fd?.local ?? []);
  stages.pairs = ms(t);
  t = now();
  rehash(s.hash, next, changed);
  const hash = hashOf(s.hash, next, s.fills);
  stages.hash = ms(t);
  s.result = check(s, rules, hash, stages, t0, {
    shapeDirty: (l, b) => shape.meets(l, b),
    copperDirty: (l, b) => shape.meets(l, b),
    padDirty: (l, b) => pads.meets(l, b),
    holeDirty: (b) => holes.meets(undefined, b),
    courtyardDirty: (b) => yards.meets(undefined, b),
    footprintsChanged,
    prevCarried: s.result.connectivity.carried,
  });
  return s;
}

function sameFinding(a: Finding, b: Finding): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keep the checks of a board between edits. `result` is the full run of `doc`; each `update` checks the next
 * document incrementally where it can and in full where an edit reaches the whole board.
 */
export function createIncrementalChecks(doc: BoardDocument, options: { fills?: ZoneFillInput; join?: JoinRule } = {}): IncrementalChecks {
  const join = options.join ?? "ends";
  let fills = normalizeFills(options.fills);
  let state: State | undefined = fullState(doc, fills, join);
  let result = state.result;
  return {
    get result() {
      return result;
    },
    update(next, changed, opts = {}) {
      const t0 = now();
      const before = result;
      const fillsGiven = opts.fills !== undefined;
      const nextFills = fillsGiven ? normalizeFills(opts.fills) : fills;
      let s: State | undefined;
      let mode: IncrementalUpdate["mode"] = "incremental";
      const current = state;
      // the state is renumbered in place: it is dropped until the update succeeds
      state = undefined;
      // new fill is localized when there was fill before and is now (absent to present, or back, runs in full);
      // `fillChanged` without new fill says the kept fill changed in place: that runs in full
      const fillOk = fillsGiven ? !!current?.fills && !!nextFills : !opts.fillChanged?.length;
      if (current && fillOk) {
        try {
          s = incrementalState(current, next, changed, fillsGiven ? nextFills : undefined);
        } catch {
          // correctness first: whatever went wrong, the full run below gives the right result (and throws
          // itself if the board cannot be checked); the property test asserts local edits stay incremental
          s = undefined;
        }
      }
      if (!s) {
        mode = "full";
        s = fullState(next, nextFills, join);
      }
      state = s;
      fills = nextFills;
      result = s.result;
      let { added, removed } = s.diff;
      if (mode === "full") {
        // a full run has no previous findings of its own: the diff is against the result before
        added = [];
        removed = [];
        const prevById = new Map(before.findings.map((f) => [f.id, f]));
        for (const f of result.findings) {
          const p = prevById.get(f.id);
          if (!p) added.push(f);
          else if (!sameFinding(p, f)) {
            added.push(f);
            removed.push(f.id);
          }
        }
        for (const f of before.findings) if (!s.byId.has(f.id)) removed.push(f.id);
      }
      return { result, added, removed, mode, ms: Math.round((now() - t0) * 100) / 100 };
    },
  };
}

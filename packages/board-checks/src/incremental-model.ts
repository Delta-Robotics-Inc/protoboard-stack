/**
 * The check model kept between edits (incremental mode). The model is split into pieces, one per record that
 * contributes geometry on its own (a footprint with its pads, holes, courtyard and silkscreen; a track; a via; a
 * silkscreen graphic or text), plus the zone fill part and the board edge part. After an edit only the pieces of
 * changed records are rebuilt (with `buildModel` on a small document holding those records and the stackup), and
 * the model is reassembled in the order `buildModel` gives, so every index, list and grid reads as a fresh build.
 *
 * Copper items of unchanged pieces are the same objects from one model to the next (their index `i` is updated in
 * place), which lets the incremental checks keep per-object results. A model built here is never shared with
 * `analyzeBoard`'s cache.
 */
import { byCodeUnit, type BoardDocument, type BoardRecord, type Box, type CopperLayer, type Finding, type FootprintRec, type WorldPad } from "@protoboardai/board";
import { CONTACT_EPS, type NearPair, type Short } from "./connectivity.js";
import type { ZoneFillSet } from "./fills.js";
import { GridIndex } from "./geom/grid.js";
import { shapeGap, type Gap, type PolyCore, type Shape } from "./geom/shape.js";
import { buildModel, type CheckModel, type CopperItem, type CourtyardItem, type EdgeItem, type HoleItem, type SilkItem } from "./model.js";

/** Record kinds whose geometry is built per record. */
export const PIECE_KINDS = new Set(["footprint", "track", "via", "graphic", "text"]);

export interface Piece {
  rec: BoardRecord;
  copper: CopperItem[];
  holes: HoleItem[];
  pads: [string, WorldPad & { shape: Shape }][];
  courtyards: CourtyardItem[];
  silk: SilkItem[];
  /** Rounded-rectangle pads without a corner radius (a model note counts them). */
  roundrect: number;
  /** Silkscreen texts checked as boxes (a model note counts them). */
  texts: number;
}

/** The zone fill part of the model (constant between edits that touch no zone and no fill). */
export interface ZonePart {
  items: CopperItem[];
  notes: string[];
  filledZones: string[];
  unfilledZones: string[];
  zoneOutlines: CheckModel["zoneOutlines"];
}

/** The board edge part (constant between edits that touch neither the outline nor a cutout). */
export interface EdgePart {
  edges: EdgeItem[];
  edgeGrid: GridIndex;
  region?: PolyCore;
}

/** Ids of each piece kind, sorted as `recordsOfKind` sorts them. */
export interface PieceOrder {
  footprint: string[];
  track: string[];
  via: string[];
  graphic: string[];
  text: string[];
}

const roundrectCount = (fp: FootprintRec): number => fp.pads.filter((p) => p.shape === "roundrect" && p.corner_radius === undefined).length;

export const roundrectNote = (n: number) => `${n} rounded-rectangle pad(s) have no corner radius and are checked as sharp rectangles (slightly larger than the real copper).`;
export const textNote = (n: number) => `${n} silkscreen text(s) are checked as their boxes (0.6 of the height per character); the board files hold no font outlines.`;

function emptyPiece(rec: BoardRecord): Piece {
  return { rec, copper: [], holes: [], pads: [], courtyards: [], silk: [], roundrect: rec.kind === "footprint" ? roundrectCount(rec) : 0, texts: 0 };
}

/** Split a model's geometry into pieces by the record that owns it. */
export function groupPieces(model: CheckModel, records: Iterable<BoardRecord>): Map<string, Piece> {
  const pieces = new Map<string, Piece>();
  for (const r of records) if (PIECE_KINDS.has(r.kind)) pieces.set(r.id, emptyPiece(r));
  const get = (id: string) => {
    const p = pieces.get(id);
    if (!p) throw new Error(`incremental checks: model geometry owned by ${id}, which is not a piece record`);
    return p;
  };
  for (const it of model.copper) if (it.kind !== "zone") get(it.kind === "pad" ? it.footprint! : it.id).copper.push(it);
  for (const h of model.holes) get(h.kind === "pad" ? h.footprint! : h.id).holes.push(h);
  for (const [id, wp] of model.pads) get(wp.footprint).pads.push([id, wp]);
  for (const c of model.courtyards) get(c.footprint).courtyards.push(c);
  for (const s of model.silk) {
    const p = get(s.footprint ?? s.id);
    p.silk.push(s);
    if (s.textBox) p.texts++;
  }
  return pieces;
}

/** Build the pieces of some records with `buildModel` on a small document: the stackup records and those records. */
export function buildPieces(next: BoardDocument, base: readonly BoardRecord[], recs: readonly BoardRecord[]): Map<string, Piece> {
  const records = new Map<string, BoardRecord>();
  for (const r of base) records.set(r.id, r);
  for (const r of recs) records.set(r.id, r);
  const mini: BoardDocument = { records, netlist: next.netlist, nets: next.nets, padNets: next.padNets };
  return groupPieces(buildModel(mini), recs);
}

/** The zone fill part from a full model. */
export function zonePartOf(model: CheckModel, pieces: Map<string, Piece>): ZonePart {
  let rr = 0;
  let texts = 0;
  for (const p of pieces.values()) {
    rr += p.roundrect;
    texts += p.texts;
  }
  const own = new Set<string>();
  if (rr) own.add(roundrectNote(rr));
  if (texts) own.add(textNote(texts));
  return {
    items: model.copper.filter((it) => it.kind === "zone"),
    notes: model.notes.filter((n) => !own.has(n)),
    filledZones: model.filledZones,
    unfilledZones: model.unfilledZones,
    zoneOutlines: model.zoneOutlines,
  };
}

/** What changed between two zone fills, item by item. */
export interface FillDiff {
  zones: ZonePart;
  /** Fill items that changed only in some holes: kept pairs move over, the holes' boxes are the dirty region. */
  local: LocalChange[];
  /** Fill items gone, and new ones (a changed outline, net or box counts as one of each). */
  removed: CopperItem[];
  added: CopperItem[];
  /** Old and new item per slot when the fill's items line up one for one (no index shifts); else undefined. */
  itemSwaps?: [CopperItem, CopperItem][];
  /** Rings that differ (both sides), and all rings of the new fill. */
  changedRings: number;
  totalRings: number;
}

const ringsEqual = (a: Float64Array, b: Float64Array): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const ringBox = (r: Float64Array): Box => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < minX) minX = r[i];
    if (r[i] > maxX) maxX = r[i];
    if (r[i + 1] < minY) minY = r[i + 1];
    if (r[i + 1] > maxY) maxY = r[i + 1];
  }
  return { minX, minY, maxX, maxY };
};
const sameBox = (a: Box, b: Box) => a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;

/**
 * The zone part for new fill, compared with the kept one item by item (zone, layer, polygon). An item whose rings
 * are all the same is the old object; one whose outline, net and box are the same and whose holes differ is a
 * local change, its dirty boxes those of the holes only on one side (holes are matched by content, so a hole that
 * merely moved in the list counts as unchanged); any other difference is a removal and an addition. Undefined
 * when the fill's notes or which zones have fill changed (that reaches the summary and every zone test).
 */
export function diffFills(prev: ZonePart, next: BoardDocument, base: readonly BoardRecord[], fills: ZoneFillSet): FillDiff | undefined {
  const records = new Map<string, BoardRecord>();
  for (const r of base) records.set(r.id, r);
  for (const r of next.records.values()) if (r.kind === "zone") records.set(r.id, r);
  const built = buildModel({ records, netlist: next.netlist, nets: next.nets, padNets: next.padNets }, fills);
  if (JSON.stringify([built.notes, built.filledZones, built.unfilledZones]) !== JSON.stringify([prev.notes, prev.filledZones, prev.unfilledZones])) return undefined;
  const key = (it: CopperItem) => `${it.id}\u0000${it.layer}\u0000${it.part}`;
  const oldByKey = new Map(prev.items.map((it) => [key(it), it]));
  const matched = new Set<CopperItem>();
  const items: CopperItem[] = [];
  const local: LocalChange[] = [];
  const removed: CopperItem[] = [];
  const added: CopperItem[] = [];
  let changedRings = 0;
  let totalRings = 0;
  for (const n of built.copper) {
    const nr = (n.shape.core as PolyCore).rings;
    totalRings += nr.length;
    const o = oldByKey.get(key(n));
    if (!o || o.net !== n.net) {
      if (o) {
        matched.add(o);
        removed.push(o);
      }
      added.push(n);
      items.push(n);
      changedRings += nr.length;
      continue;
    }
    matched.add(o);
    const or = (o.shape.core as PolyCore).rings;
    if (nr.length === or.length && nr.every((r, k) => ringsEqual(r, or[k]))) {
      items.push(o);
      continue;
    }
    if (!ringsEqual(nr[0], or[0]) || !sameBox(n.shape.box, o.shape.box)) {
      removed.push(o);
      added.push(n);
      items.push(n);
      changedRings += nr.length + or.length;
      continue;
    }
    // holes: in place first, then the rest matched by content
    const oldLeft: Float64Array[] = [];
    const newLeft: Float64Array[] = [];
    for (let k = 1; k < Math.max(or.length, nr.length); k++) {
      if (k < or.length && k < nr.length && ringsEqual(or[k], nr[k])) continue;
      if (k < or.length) oldLeft.push(or[k]);
      if (k < nr.length) newLeft.push(nr[k]);
    }
    const count = new Map<string, number>();
    for (const r of oldLeft) count.set(r.join(","), (count.get(r.join(",")) ?? 0) + 1);
    const boxes: Box[] = [];
    for (const r of newLeft) {
      const c = count.get(r.join(","));
      if (c) count.set(r.join(","), c - 1);
      else boxes.push(ringBox(r));
    }
    for (const r of oldLeft) {
      const k = r.join(",");
      const c = count.get(k);
      if (c) {
        count.set(k, c - 1);
        boxes.push(ringBox(r));
      }
    }
    changedRings += boxes.length;
    items.push(n);
    // the same rings in another order: nothing changed in the plane, but it is a new object
    local.push({ old: o, now: n, boxes });
  }
  for (const o of prev.items) if (!matched.has(o)) removed.push(o);
  const lined = items.length === prev.items.length && items.every((it, k) => key(it) === key(prev.items[k]));
  return {
    zones: { items, notes: built.notes, filledZones: built.filledZones, unfilledZones: built.unfilledZones, zoneOutlines: built.zoneOutlines },
    local,
    removed,
    added,
    ...(lined ? { itemSwaps: items.map((it, k) => [prev.items[k], it] as [CopperItem, CopperItem]) } : {}),
    changedRings,
    totalRings,
  };
}

export function edgePartOf(model: CheckModel): EdgePart {
  return { edges: model.edges, edgeGrid: model.edgeGrid, ...(model.region ? { region: model.region } : {}) };
}

export function pieceOrder(pieces: Map<string, Piece>): PieceOrder {
  const o: PieceOrder = { footprint: [], track: [], via: [], graphic: [], text: [] };
  for (const [id, p] of pieces) o[p.rec.kind as keyof PieceOrder].push(id);
  for (const k of Object.keys(o) as (keyof PieceOrder)[]) o[k].sort(byCodeUnit);
  return o;
}

/** Insert an id into a sorted id list (no repeat). */
export function insertSorted(list: string[], id: string): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byCodeUnit(list[mid], id) < 0) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] !== id) list.splice(lo, 0, id);
}

/** Remove an id from a sorted id list. */
export function removeSorted(list: string[], id: string): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byCodeUnit(list[mid], id) < 0) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] === id) list.splice(lo, 1);
}

/** As model.ts sizes its grid cells. */
function cellSize(doc: BoardDocument, count: number): number {
  const outline = doc.records.get("outline");
  let area = 100e6 * 100e6;
  if (outline?.kind === "outline") {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of outline.outline) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    area = Math.max(1e12, (maxX - minX) * (maxY - minY));
  }
  const c = Math.sqrt(area / Math.max(1, count)) * 2;
  return Math.min(5e6, Math.max(250_000, c));
}

/** Copper, holes and their grids, in `buildModel`'s order; sets every item's and hole's index. */
function placeAll(doc: BoardDocument, layers: CopperLayer[], pieces: Map<string, Piece>, order: PieceOrder, zones: ZonePart): Pick<CheckModel, "copper" | "holes" | "grids" | "holeGrid" | "cell"> {
  const copper: CopperItem[] = [];
  const holes: HoleItem[] = [];
  const addCopper = (it: CopperItem) => {
    it.i = copper.length;
    copper.push(it);
  };
  const addHole = (h: HoleItem) => {
    h.i = holes.length;
    holes.push(h);
  };
  for (const id of order.footprint) {
    const p = pieces.get(id)!;
    p.copper.forEach(addCopper);
    p.holes.forEach(addHole);
  }
  for (const id of order.track) pieces.get(id)!.copper.forEach(addCopper);
  for (const id of order.via) {
    const p = pieces.get(id)!;
    p.copper.forEach(addCopper);
    p.holes.forEach(addHole);
  }
  zones.items.forEach(addCopper);
  const cell = cellSize(doc, copper.length / Math.max(1, layers.length));
  const grids = new Map<CopperLayer, GridIndex>();
  for (const l of layers) grids.set(l, new GridIndex(cell));
  for (const it of copper) grids.get(it.layer)!.insert(it.i, it.shape.box);
  const holeGrid = new GridIndex(cell);
  for (const h of holes) holeGrid.insert(h.i, h.shape.box);
  return { copper, holes, grids, holeGrid, cell };
}

/**
 * When every changed record kept its id and its number of copper items and holes (a move, a rotation, a net or
 * width change), no index shifts: the new items take the old items' slots and the previous grids are updated in
 * place. Undefined when an index would shift. Takes over the previous model's grids (that model is dropped).
 */
function placeSwapped(prev: CheckModel, swaps: readonly (readonly [Piece, Piece])[], itemSwaps: readonly (readonly [CopperItem, CopperItem])[]): Pick<CheckModel, "copper" | "holes" | "grids" | "holeGrid" | "cell"> | undefined {
  for (const [o, n] of swaps) if (o.rec.kind !== n.rec.kind || o.copper.length !== n.copper.length || o.holes.length !== n.holes.length) return undefined;
  const copper = prev.copper.slice();
  const holes = prev.holes.slice();
  // zone fill items replaced in their slots (the caller checked that the fill's items line up)
  for (const [old, it] of itemSwaps) {
    if (old === it) continue;
    it.i = old.i;
    copper[old.i] = it;
    prev.grids.get(old.layer)!.remove(old.i);
    prev.grids.get(it.layer)!.insert(it.i, it.shape.box);
  }
  for (const [o, n] of swaps) {
    o.copper.forEach((old, k) => {
      const it = n.copper[k];
      it.i = old.i;
      copper[old.i] = it;
      prev.grids.get(old.layer)!.remove(old.i);
      prev.grids.get(it.layer)!.insert(it.i, it.shape.box);
    });
    o.holes.forEach((old, k) => {
      const h = n.holes[k];
      h.i = old.i;
      holes[old.i] = h;
      prev.holeGrid.remove(old.i);
      prev.holeGrid.insert(h.i, h.shape.box);
    });
  }
  return { copper, holes, grids: prev.grids, holeGrid: prev.holeGrid, cell: prev.cell };
}

/**
 * Assemble the model from its parts, in `buildModel`'s order; sets every item's and hole's index. With `prev` and
 * the pieces swapped since it, reuses its indexes and grids when no index shifts.
 */
export function assembleModel(doc: BoardDocument, layers: CopperLayer[], pieces: Map<string, Piece>, order: PieceOrder, zones: ZonePart, edges: EdgePart, prev?: { model: CheckModel; swaps: (readonly [Piece, Piece])[]; itemSwaps?: (readonly [CopperItem, CopperItem])[] }): CheckModel {
  const placed = (prev && placeSwapped(prev.model, prev.swaps, prev.itemSwaps ?? [])) || placeAll(doc, layers, pieces, order, zones);
  const pads = new Map<string, WorldPad & { shape: Shape }>();
  const footprints = new Map<string, FootprintRec>();
  const courtyards: CourtyardItem[] = [];
  const silk: SilkItem[] = [];
  let rr = 0;
  let texts = 0;
  for (const id of order.footprint) {
    const p = pieces.get(id)!;
    footprints.set(id, p.rec as FootprintRec);
    for (const [k, wp] of p.pads) pads.set(k, wp);
    courtyards.push(...p.courtyards);
    silk.push(...p.silk);
    rr += p.roundrect;
    texts += p.texts;
  }
  for (const id of [...order.graphic, ...order.text]) {
    const p = pieces.get(id)!;
    silk.push(...p.silk);
    texts += p.texts;
  }
  const { copper, holes, grids, holeGrid, cell } = placed;
  const notes = [...(rr ? [roundrectNote(rr)] : []), ...zones.notes, ...(texts ? [textNote(texts)] : [])];
  return {
    doc,
    layers,
    copper,
    grids,
    holes,
    holeGrid,
    edges: edges.edges,
    edgeGrid: edges.edgeGrid,
    ...(edges.region ? { region: edges.region } : {}),
    courtyards,
    silk,
    pads,
    filledZones: zones.filledZones,
    unfilledZones: zones.unfilledZones,
    zoneOutlines: zones.zoneOutlines,
    footprints,
    cell,
    notes,
  };
}

// ---------------------------------------------------------------- the pair scan

/** A pair of the scan, kept between edits: the items themselves, their layer's index, and cached results. */
export interface PairRec extends NearPair {
  A: CopperItem;
  B: CopperItem;
  /** The layer's index in `model.layers`. */
  L: number;
  contact: boolean;
  /** Contacts: whether the two join (computed on first use; the items never change). */
  joins?: boolean;
  /** Clearance: the rule evaluation for the nets it was made with. */
  clr?: { na: string | undefined; nb: string | undefined; vs: unknown[] | null; key?: string; out?: Finding[] };
  /** Contacts of two nets: the direct short (frozen, shared by results) with its sort keys. */
  short?: { s: Short; n: string; o: string; k: string };
}

/** A zone fill item replaced by one that differs from it only inside `boxes` (rings added, removed or moved). */
export interface LocalChange {
  old: CopperItem;
  now: CopperItem;
  boxes: Box[];
}

const gapOut: Gap = { gap: 0, x: 0, y: 0 };

/** Measure one pair as `scanPairs` does (a is the lower index); undefined when it is neither contact nor near. */
function measure(a: CopperItem, b: CopperItem, L: number, radius: number): PairRec | undefined {
  const r = Math.max(radius, CONTACT_EPS);
  const same = a.id === b.id || (a.net !== undefined && a.net === b.net);
  const limit = same ? CONTACT_EPS : r;
  const d = shapeGap(a.shape, b.shape, limit, gapOut);
  if (d <= CONTACT_EPS) return { a: a.i, b: b.i, gap: d, x: gapOut.x, y: gapOut.y, A: a, B: b, L, contact: true };
  if (!same && d < radius) return { a: a.i, b: b.i, gap: d, x: gapOut.x, y: gapOut.y, A: a, B: b, L, contact: false };
  return undefined;
}

/** Whether b's box meets a's box grown by r, exactly as the grid tests it for `scanPairs`' query from a. */
function meetsFrom(a: CopperItem, b: CopperItem, r: number): boolean {
  const q = { minX: a.shape.box.minX - r, minY: a.shape.box.minY - r, maxX: a.shape.box.maxX + r, maxY: a.shape.box.maxY + r };
  const bb = b.shape.box;
  return bb.minX <= q.maxX && q.minX <= bb.maxX && bb.minY <= q.maxY && q.minY <= bb.maxY;
}

/** The whole scan, in `scanPairs`' order (layer, then a, then b). */
export function fullScan(m: CheckModel, radius: number): PairRec[] {
  const out: PairRec[] = [];
  const cand: number[] = [];
  m.layers.forEach((layer, L) => {
    const grid = m.grids.get(layer)!;
    for (const a of m.copper) {
      if (a.layer !== layer) continue;
      const r = Math.max(radius, CONTACT_EPS);
      cand.length = 0;
      grid.query({ minX: a.shape.box.minX - r, minY: a.shape.box.minY - r, maxX: a.shape.box.maxX + r, maxY: a.shape.box.maxY + r }, (j) => {
        if (j > a.i) cand.push(j);
      });
      cand.sort((x, y) => x - y);
      for (const j of cand) {
        const p = measure(a, m.copper[j], L, radius);
        if (p) out.push(p);
      }
    }
  });
  return out;
}

/**
 * The scan after an edit: pairs with a removed item are dropped, every added item is measured against its
 * neighbors, and the list is put back in scan order with the current indexes.
 */
export function rescan(m: CheckModel, prev: readonly PairRec[], removed: ReadonlySet<CopperItem>, added: readonly CopperItem[], radius: number, local: readonly LocalChange[] = []): PairRec[] {
  const out: PairRec[] = [];
  const r = Math.max(radius, CONTACT_EPS);
  // a zone fill item that changed only inside some boxes: its pairs with copper away from them stand (the fill is
  // the same there) and move over to the new item; pairs with copper near them are measured again below
  const byOld = new Map(local.map((l) => [l.old, l]));
  const nearChange = (b: Box, l: LocalChange) => l.boxes.some((d) => b.minX <= d.maxX + r + 1 && d.minX - r - 1 <= b.maxX && b.minY <= d.maxY + r + 1 && d.minY - r - 1 <= b.maxY);
  for (const p of prev) {
    if (removed.has(p.A) || removed.has(p.B)) continue;
    const la = byOld.get(p.A);
    const lb = byOld.get(p.B);
    if (la && lb) continue;
    if (la) {
      if (nearChange(p.B.shape.box, la)) continue;
      p.A = la.now;
    } else if (lb) {
      if (nearChange(p.A.shape.box, lb)) continue;
      p.B = lb.now;
    }
    out.push(p);
  }
  const isAdded = new Set(added);
  const layerIndex = new Map(m.layers.map((l, i) => [l, i]));
  const cand: number[] = [];
  const isLocal = new Set(local.map((l) => l.now));
  const seen = new Set<string>();
  for (const l of local) {
    const Z = l.now;
    const grid = m.grids.get(Z.layer);
    if (!grid) continue;
    cand.length = 0;
    for (const d of l.boxes) grid.query({ minX: d.minX - r - 1, minY: d.minY - r - 1, maxX: d.maxX + r + 1, maxY: d.maxY + r + 1 }, (j) => cand.push(j));
    for (const j of cand) {
      const Y = m.copper[j];
      // added items measure themselves against every neighbor, this one included
      if (Y === Z || isAdded.has(Y)) continue;
      // a pair of two changed fill items is kept only when neither changed near the other: measure it once
      if (!isLocal.has(Y) && !nearChange(Y.shape.box, l)) continue;
      const [a, b] = Z.i < Y.i ? [Z, Y] : [Y, Z];
      const key = `${a.i}:${b.i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!meetsFrom(a, b, r)) continue;
      const p = measure(a, b, layerIndex.get(Z.layer)!, radius);
      if (p) out.push(p);
    }
  }
  for (const X of added) {
    const grid = m.grids.get(X.layer);
    if (!grid) continue;
    // one nanometer wider than the scan's query, then the scan's own test from the lower index's side
    const q = { minX: X.shape.box.minX - r - 1, minY: X.shape.box.minY - r - 1, maxX: X.shape.box.maxX + r + 1, maxY: X.shape.box.maxY + r + 1 };
    cand.length = 0;
    grid.query(q, (j) => cand.push(j));
    for (const j of cand) {
      if (j === X.i) continue;
      const Y = m.copper[j];
      // a pair of two added items is measured once, from the lower index
      if (isAdded.has(Y) && Y.i < X.i) continue;
      const [a, b] = X.i < Y.i ? [X, Y] : [Y, X];
      if (!meetsFrom(a, b, r)) continue;
      const p = measure(a, b, layerIndex.get(X.layer)!, radius);
      if (p) out.push(p);
    }
  }
  for (const p of out) {
    p.a = p.A.i;
    p.b = p.B.i;
  }
  out.sort((p, q) => p.L - q.L || p.a - q.a || p.b - q.b);
  return out;
}

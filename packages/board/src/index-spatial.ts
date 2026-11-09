/**
 * The query index (contract section 10): what is in a region, at a point, or on a net. A uniform grid over
 * boxes, updated incrementally as transactions commit; objects spanning many cells sit in a short list checked
 * directly. Pads are indexed on their own (`pad:` ids) with their nets.
 */
import { byCodeUnit } from "./canonical.js";
import { copperLayers, type BoardDocument } from "./document.js";
import { boundsOf, boxesMeet, inflate, layersOf, padsOf, type Box } from "./geometry.js";
import type { BoardRecord, Point, RecordKind } from "./schema.js";

export interface IndexItem {
  id: string;
  kind: RecordKind | "pad";
  box: Box;
  layers: string[];
  net?: string;
  /** For a pad: its footprint's id. */
  footprint?: string;
}

export interface QueryOptions {
  layers?: string[];
  kinds?: (RecordKind | "pad")[];
}

export interface NetMembers {
  pads: string[];
  tracks: string[];
  vias: string[];
  zones: string[];
}

export interface BoardQuery {
  /** Items whose boxes meet `box` (on any of `layers`, when given), sorted by id. */
  region(box: Box, options?: QueryOptions): IndexItem[];
  /** Items whose boxes contain `point` grown by `tolerance` (nm), sorted by id. */
  at(point: Point, options?: QueryOptions & { tolerance?: number }): IndexItem[];
  /** The pads, tracks, vias and zones of a net, each list sorted. */
  net(name: string): NetMembers;
  byId(id: string): IndexItem | undefined;
}

/** DEFAULT: 1 mm cells. */
export const CELL_NM = 1_000_000;
/** Items covering more cells than this go in the large list. */
const LARGE_CELLS = 4096;

function itemsOf(doc: BoardDocument, rec: BoardRecord, copper: string[]): IndexItem[] {
  const out: IndexItem[] = [];
  const box = boundsOf(rec);
  if (box) {
    const net = (rec.kind === "track" || rec.kind === "via" || rec.kind === "zone") && rec.net ? rec.net : undefined;
    out.push({ id: rec.id, kind: rec.kind, box, layers: layersOf(doc, rec) as string[], ...(net ? { net } : {}) });
  }
  if (rec.kind === "footprint")
    for (const p of padsOf(rec, copper as never)) {
      const net = doc.padNets.get(p.id);
      out.push({ id: p.id, kind: "pad", box: p.box, layers: p.layers, footprint: rec.id, ...(net ? { net } : {}) });
    }
  return out;
}

export class BoardIndex implements BoardQuery {
  private readonly cells = new Map<string, Set<string>>();
  private readonly large = new Set<string>();
  private readonly items = new Map<string, IndexItem>();
  /** Record id to the item ids it made (a footprint makes its pads too). */
  private readonly owned = new Map<string, string[]>();
  private readonly nets = new Map<string, Set<string>>();
  private padNets: BoardDocument["padNets"];

  private constructor(
    private doc: BoardDocument,
    private readonly cell: number,
  ) {
    this.padNets = doc.padNets;
  }

  static build(doc: BoardDocument, cell = CELL_NM): BoardIndex {
    const ix = new BoardIndex(doc, cell);
    const copper = copperLayers(doc);
    for (const rec of doc.records.values()) ix.add(rec, copper);
    return ix;
  }

  private span(b: Box): [number, number, number, number] {
    return [Math.floor(b.minX / this.cell), Math.floor(b.minY / this.cell), Math.floor(b.maxX / this.cell), Math.floor(b.maxY / this.cell)];
  }

  private insert(item: IndexItem): void {
    this.items.set(item.id, item);
    const [x0, y0, x1, y1] = this.span(item.box);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > LARGE_CELLS) this.large.add(item.id);
    else
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          let s = this.cells.get(k);
          if (!s) this.cells.set(k, (s = new Set()));
          s.add(item.id);
        }
    if (item.net) {
      let s = this.nets.get(item.net);
      if (!s) this.nets.set(item.net, (s = new Set()));
      s.add(item.id);
    }
  }

  private drop(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    if (!this.large.delete(id)) {
      const [x0, y0, x1, y1] = this.span(item.box);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          const s = this.cells.get(k);
          if (s) {
            s.delete(id);
            if (!s.size) this.cells.delete(k);
          }
        }
    }
    if (item.net) this.nets.get(item.net)?.delete(id);
  }

  private add(rec: BoardRecord, copper: string[]): void {
    const items = itemsOf(this.doc, rec, copper);
    for (const it of items) this.insert(it);
    if (items.length) this.owned.set(rec.id, items.map((i) => i.id));
  }

  /** Bring the index to `after`, given the record ids that changed since `before` (the index's current document). */
  update(after: BoardDocument, changed: readonly string[]): BoardIndex {
    if (after.padNets !== this.padNets) {
      // the netlist or footprint pads changed: pad nets may have moved anywhere
      return BoardIndex.build(after, this.cell);
    }
    this.doc = after;
    const copper = copperLayers(after);
    for (const id of changed) {
      for (const it of this.owned.get(id) ?? []) this.drop(it);
      this.owned.delete(id);
      const rec = after.records.get(id);
      if (rec) this.add(rec, copper);
    }
    return this;
  }

  private match(item: IndexItem, o: QueryOptions | undefined): boolean {
    if (o?.kinds && !o.kinds.includes(item.kind)) return false;
    if (o?.layers && item.layers.length && !item.layers.some((l) => o.layers!.includes(l))) return false;
    return true;
  }

  region(box: Box, options?: QueryOptions): IndexItem[] {
    const ids = new Set<string>(this.large);
    const [x0, y0, x1, y1] = this.span(box);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) for (const s of this.cells.values()) for (const id of s) ids.add(id);
    else
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) for (const id of this.cells.get(`${x},${y}`) ?? []) ids.add(id);
    const out: IndexItem[] = [];
    for (const id of ids) {
      const it = this.items.get(id)!;
      if (boxesMeet(it.box, box) && this.match(it, options)) out.push(it);
    }
    return out.sort((a, b) => byCodeUnit(a.id, b.id));
  }

  at(point: Point, options?: QueryOptions & { tolerance?: number }): IndexItem[] {
    return this.region(inflate({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }, options?.tolerance ?? 0), options);
  }

  net(name: string): NetMembers {
    const out: NetMembers = { pads: [], tracks: [], vias: [], zones: [] };
    for (const id of this.nets.get(name) ?? []) {
      const k = this.items.get(id)?.kind;
      if (k === "pad") out.pads.push(id);
      else if (k === "track") out.tracks.push(id);
      else if (k === "via") out.vias.push(id);
      else if (k === "zone") out.zones.push(id);
    }
    for (const l of Object.values(out)) l.sort(byCodeUnit);
    return out;
  }

  byId(id: string): IndexItem | undefined {
    return this.items.get(id);
  }

  get size(): number {
    return this.items.size;
  }
}

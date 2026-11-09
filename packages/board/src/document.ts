/**
 * The immutable board document (contract section 4): every stored record by id, the input netlist, and the
 * nets derived from it. Records are frozen; a change makes a new document that shares the unchanged records.
 */
import { byCodeUnit, canonicalRecord, deepFreeze } from "./canonical.js";
import { COPPER_LAYERS, type BoardRecord, type CopperLayer, type FootprintRec, type LayerRec, type Netlist, type NetclassRec, type RecordKind, type RecordOf } from "./schema.js";

export interface NetInfo {
  name: string;
  /** The class the netlist gives it (a netclass record may override it: `netClassOf`). */
  class?: string;
  /** Pad ids on this net, sorted. */
  pads: string[];
  /** Netlist pins with no matching footprint or pad on the board. */
  missing: string[];
}

export interface BoardDocument {
  readonly records: ReadonlyMap<string, BoardRecord>;
  readonly netlist: Netlist | undefined;
  readonly nets: ReadonlyMap<string, NetInfo>;
  readonly padNets: ReadonlyMap<string, string>;
}

/** The key of a footprint id (`fp:power/ldo` gives `power/ldo`). */
export const footprintKey = (fp: { id: string }): string => fp.id.slice(fp.id.indexOf(":") + 1);
/** A pad's id. */
export const padId = (fpKey: string, padKey: string): string => `pad:${fpKey}:${padKey}`;
/** The id of a net. */
export const netId = (name: string): string => `net:${name}`;

/** Each pad's key, in file order: its number, with `~2`, `~3` for repeats. */
export function padKeys(fp: Pick<FootprintRec, "pads">): string[] {
  const seen = new Map<string, number>();
  return fp.pads.map((p) => {
    const n = (seen.get(p.number) ?? 0) + 1;
    seen.set(p.number, n);
    return n === 1 ? p.number : `${p.number}~${n}`;
  });
}

/** Parse a pad id into footprint id and pad key. */
export function parsePadId(id: string): { footprint: string; pad: string } | undefined {
  if (!id.startsWith("pad:")) return undefined;
  const rest = id.slice(4);
  const i = rest.lastIndexOf(":");
  if (i <= 0) return undefined;
  return { footprint: `fp:${rest.slice(0, i)}`, pad: rest.slice(i + 1) };
}

function deriveNets(records: ReadonlyMap<string, BoardRecord>, netlist: Netlist | undefined): { nets: Map<string, NetInfo>; padNets: Map<string, string> } {
  const nets = new Map<string, NetInfo>();
  const padNets = new Map<string, string>();
  if (!netlist) return { nets, padNets };
  // ref -> pad number -> pad ids
  const byRef = new Map<string, Map<string, string[]>>();
  for (const r of records.values()) {
    if (r.kind !== "footprint") continue;
    const keys = padKeys(r);
    const m = new Map<string, string[]>();
    r.pads.forEach((p, i) => {
      const list = m.get(p.number) ?? [];
      list.push(padId(footprintKey(r), keys[i]));
      m.set(p.number, list);
    });
    byRef.set(r.ref, m);
  }
  for (const n of netlist.nets) {
    const info: NetInfo = { name: n.name, ...(n.class ? { class: n.class } : {}), pads: [], missing: [] };
    for (const pin of n.pins) {
      const dot = pin.indexOf(".");
      const ids = byRef.get(pin.slice(0, dot))?.get(pin.slice(dot + 1));
      if (!ids) info.missing.push(pin);
      else
        for (const id of ids) {
          info.pads.push(id);
          padNets.set(id, n.name);
        }
    }
    info.pads.sort(byCodeUnit);
    nets.set(n.name, deepFreeze(info));
  }
  return { nets, padNets };
}

function make(records: Map<string, BoardRecord>, netlist: Netlist | undefined, derived?: { nets: ReadonlyMap<string, NetInfo>; padNets: ReadonlyMap<string, string> }): BoardDocument {
  const d = derived ?? deriveNets(records, netlist);
  return Object.freeze({ records, netlist, nets: d.nets, padNets: d.padNets });
}

/** A document from records (any order) and an optional netlist. Duplicate ids are an error. */
export function createDocument(records: Iterable<BoardRecord>, netlist?: Netlist): BoardDocument {
  const map = new Map<string, BoardRecord>();
  for (const r of records) {
    if (map.has(r.id)) throw new Error(`duplicate id ${r.id}`);
    map.set(r.id, deepFreeze(r));
  }
  return make(map, netlist ? deepFreeze(netlist) : undefined);
}

/** The same records with another netlist. */
export const withNetlist = (doc: BoardDocument, netlist: Netlist | undefined): BoardDocument => make(new Map(doc.records), netlist ? deepFreeze(netlist) : undefined);

/**
 * A new document with `puts` written (replacing any record with the same id) and `removes` removed. Derived nets
 * are recomputed only when a footprint's reference or pads changed, or a footprint came or went.
 */
export function withChanges(doc: BoardDocument, puts: readonly BoardRecord[], removes: readonly string[] = []): BoardDocument {
  if (!puts.length && !removes.length) return doc;
  const map = new Map(doc.records);
  let renet = false;
  for (const id of removes) {
    const old = map.get(id);
    if (old?.kind === "footprint") renet = true;
    map.delete(id);
  }
  for (const r of puts) {
    const old = map.get(r.id);
    if (r.kind === "footprint" && (!old || old.kind !== "footprint" || old.ref !== r.ref || old.pads !== r.pads)) renet = true;
    map.set(r.id, deepFreeze(r));
  }
  return make(map, doc.netlist, renet ? undefined : { nets: doc.nets, padNets: doc.padNets });
}

export const getRecord = (doc: BoardDocument, id: string): BoardRecord | undefined => doc.records.get(id);

/** The records of one kind, sorted by id. */
export function recordsOfKind<K extends RecordKind>(doc: BoardDocument, kind: K): RecordOf<K>[] {
  const out: RecordOf<K>[] = [];
  for (const r of doc.records.values()) if (r.kind === kind) out.push(r as RecordOf<K>);
  return out.sort((a, b) => byCodeUnit(a.id, b.id));
}

/** The stackup's copper layer names, top to bottom (the board record's count when there are no layer records). */
export function copperLayers(doc: BoardDocument): CopperLayer[] {
  const layers = recordsOfKind(doc, "layer")
    .filter((l: LayerRec) => l.type === "copper")
    .sort((a, b) => a.order - b.order)
    .map((l) => l.name as CopperLayer);
  if (layers.length) return layers;
  const board = doc.records.get("board");
  const n = board?.kind === "board" ? board.copper_layers : 2;
  return n <= 1 ? ["top"] : ["top", ...COPPER_LAYERS.slice(1, n - 1), "bottom"];
}

/** A footprint by reference designator. */
export function footprintByRef(doc: BoardDocument, ref: string): FootprintRec | undefined {
  for (const r of doc.records.values()) if (r.kind === "footprint" && r.ref === ref) return r;
  return undefined;
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/** A net's class: an explicit netclass entry, else the first class (by id) whose pattern matches, else the netlist's, else `default`. */
export function netClassOf(doc: BoardDocument, net: string): string {
  const classes = recordsOfKind(doc, "netclass") as NetclassRec[];
  for (const c of classes) if (c.nets?.includes(net)) return c.name;
  for (const c of classes) if (c.patterns?.some((p) => globToRegExp(p).test(net))) return c.name;
  return doc.nets.get(net)?.class ?? "default";
}

/** Record-for-record equality of two documents (records and netlist). */
export function documentsEqual(a: BoardDocument, b: BoardDocument): boolean {
  if (a.records.size !== b.records.size) return false;
  for (const [id, r] of a.records) {
    const o = b.records.get(id);
    if (!o || (o !== r && canonicalRecord(o) !== canonicalRecord(r))) return false;
  }
  return JSON.stringify(a.netlist ?? null) === JSON.stringify(b.netlist ?? null);
}

/** The ids whose records differ between two documents (added, changed or removed), sorted. */
export function diffIds(a: BoardDocument, b: BoardDocument): string[] {
  const out = new Set<string>();
  for (const [id, r] of a.records) {
    const o = b.records.get(id);
    if (!o || (o !== r && canonicalRecord(o) !== canonicalRecord(r))) out.add(id);
  }
  for (const id of b.records.keys()) if (!a.records.has(id)) out.add(id);
  return [...out].sort(byCodeUnit);
}

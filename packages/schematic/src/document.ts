/**
 * The immutable schematic document (contract section 4): every stored record by id, the circuit it draws, and
 * indexes derived from the circuit. Records are frozen; a change makes a new document sharing the unchanged ones.
 */
import { byCodeUnit, canonicalRecord, deepFreeze } from "@protoboardai/board";
import { normalizeCircuit, pinKey, type CircuitNet, type CircuitPart, type SchematicCircuit } from "./circuit.ts";
import type { RecordKind, RecordOf, SchematicRecord } from "./schema.ts";

export interface SchematicDocument {
  readonly records: ReadonlyMap<string, SchematicRecord>;
  readonly circuit: SchematicCircuit;
  /** path -> part */
  readonly parts: ReadonlyMap<string, CircuitPart>;
  /** pin key -> net name */
  readonly pinNets: ReadonlyMap<string, string>;
  /** name -> net */
  readonly nets: ReadonlyMap<string, CircuitNet>;
}

interface Derived {
  parts: ReadonlyMap<string, CircuitPart>;
  pinNets: ReadonlyMap<string, string>;
  nets: ReadonlyMap<string, CircuitNet>;
}
const derivedCache = new WeakMap<SchematicCircuit, Derived>();

function derive(circuit: SchematicCircuit): Derived {
  const hit = derivedCache.get(circuit);
  if (hit) return hit;
  const parts = new Map(circuit.parts.map((p) => [p.path, p]));
  const pinNets = new Map<string, string>();
  const nets = new Map<string, CircuitNet>();
  for (const n of circuit.nets) {
    nets.set(n.name, n);
    for (const p of n.pins) pinNets.set(p, n.name);
  }
  const d = { parts, pinNets, nets };
  derivedCache.set(circuit, d);
  return d;
}

function make(records: Map<string, SchematicRecord>, circuit: SchematicCircuit): SchematicDocument {
  return Object.freeze({ records, circuit, ...derive(circuit) });
}

/** A document from records and a circuit (normalized and frozen here). Duplicate ids are an error. */
export function createSchematic(records: Iterable<SchematicRecord>, circuit: SchematicCircuit): SchematicDocument {
  const map = new Map<string, SchematicRecord>();
  for (const r of records) {
    if (map.has(r.id)) throw new Error(`duplicate id ${r.id}`);
    map.set(r.id, deepFreeze(r));
  }
  return make(map, Object.isFrozen(circuit) ? circuit : normalizeCircuit(circuit));
}

/** The same records drawn against another circuit (a UHD change). */
export const withCircuit = (doc: SchematicDocument, circuit: SchematicCircuit): SchematicDocument => make(new Map(doc.records), Object.isFrozen(circuit) ? circuit : normalizeCircuit(circuit));

export function withChanges(doc: SchematicDocument, puts: readonly SchematicRecord[], removes: readonly string[] = []): SchematicDocument {
  if (!puts.length && !removes.length) return doc;
  const map = new Map(doc.records);
  for (const id of removes) map.delete(id);
  for (const r of puts) map.set(r.id, deepFreeze(r));
  return make(map, doc.circuit);
}

export function recordsOfKind<K extends RecordKind>(doc: SchematicDocument, kind: K): RecordOf<K>[] {
  const out: RecordOf<K>[] = [];
  for (const r of doc.records.values()) if (r.kind === kind) out.push(r as RecordOf<K>);
  return out.sort((a, b) => byCodeUnit(a.id, b.id));
}

export const symbolId = (part: string): string => `sym:${part}`;
export const pinOf = (part: string, pin: string): string => pinKey(part, pin);

/** Record-for-record equality. */
export function schematicsEqual(a: SchematicDocument, b: SchematicDocument): boolean {
  if (a.records.size !== b.records.size) return false;
  for (const [id, r] of a.records) {
    const o = b.records.get(id);
    if (!o || (o !== r && canonicalRecord(o) !== canonicalRecord(r))) return false;
  }
  return true;
}

/** Ids whose records differ (added, changed, removed), sorted. */
export function diffIds(a: SchematicDocument, b: SchematicDocument): string[] {
  const out = new Set<string>();
  for (const [id, r] of a.records) {
    const o = b.records.get(id);
    if (!o || (o !== r && canonicalRecord(o) !== canonicalRecord(r))) out.add(id);
  }
  for (const id of b.records.keys()) if (!a.records.has(id)) out.add(id);
  return [...out].sort(byCodeUnit);
}

export const settingsOf = (doc: SchematicDocument) => {
  const s = doc.records.get("schematic");
  return s?.kind === "schematic" ? s.settings : { bend_limit: 4, gutter: 4 };
};

/** Whether a net is drawn as power symbols: listed in settings.rails, else every ground and power net. */
export function isRail(doc: SchematicDocument, net: string): boolean {
  const s = doc.records.get("schematic");
  const rails = s?.kind === "schematic" ? s.settings.rails : undefined;
  if (rails) return rails.includes(net);
  const n = doc.nets.get(net);
  return n?.kind === "ground" || n?.kind === "power";
}

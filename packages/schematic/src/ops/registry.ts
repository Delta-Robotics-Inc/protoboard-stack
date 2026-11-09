/**
 * The schematic's operation registry (contract section 8): the board core's registry shape (`OperationDef`,
 * pure `apply` returning the inverse), kept as a separate table because the document type differs. The
 * `Actor`, `OpCall` and `OpError` types are the board core's own.
 */
import type { z } from "zod";
import { OpError, type Actor, type OpCall } from "@protoboardai/board";
import { withChanges, type SchematicDocument } from "../document.ts";
import { PINNABLE, type Provenance, type RecordKind, type SchematicRecord } from "../schema.ts";

export { OpError, type Actor, type OpCall };

export interface ApplyContext {
  actor: Actor;
  /** A new owner-issued id for a record of this kind (`wire:<epoch>.<n>`). */
  issueId(kind: RecordKind): string;
  provenance: Provenance;
  /** Written to `provenance.edited` of records this operation changes when another kind of actor made them. */
  edited?: "hand" | "agent" | "layout";
  /** A person's moves pin what they move (contract section 8.2). */
  pinMoves: boolean;
}

export interface ApplyResult {
  doc: SchematicDocument;
  inverse: OpCall[];
  changed: string[];
  created?: Record<string, string>;
}

export interface OperationDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  input: S;
  audience: "all" | "system";
  phase: 3;
  /** A valid call on the Airnode C3 schematic (without `op`). */
  example: Record<string, unknown>;
  apply(doc: SchematicDocument, input: z.infer<S>, ctx: ApplyContext): ApplyResult;
}

const registry = new Map<string, OperationDef>();

export function registerOperation<S extends z.ZodTypeAny>(def: OperationDef<S>): OperationDef<S> {
  if (registry.has(def.name)) throw new Error(`operation ${def.name} is registered twice`);
  if (!/^[a-z]+(\.[a-z_]+)?$/.test(def.name)) throw new Error(`operation name ${def.name} is not <noun>.<verb>`);
  registry.set(def.name, def as unknown as OperationDef);
  return def;
}

export const listOperations = (): OperationDef[] => [...registry.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
export const getOperation = (name: string): OperationDef | undefined => registry.get(name);

/** Write records and compute the exact inverse (the previous version of each record touched). */
export function change(doc: SchematicDocument, puts: SchematicRecord[], removes: string[] = [], created?: Record<string, string>): ApplyResult {
  const touched = new Set<string>();
  const restore: SchematicRecord[] = [];
  const unmake: string[] = [];
  for (const id of [...removes, ...puts.map((r) => r.id)]) {
    if (touched.has(id)) continue;
    touched.add(id);
    const before = doc.records.get(id);
    if (before) restore.push(before);
    else unmake.push(id);
  }
  const next = withChanges(doc, puts, removes.filter((id) => doc.records.has(id) || puts.some((p) => p.id === id)));
  const inverse: OpCall[] = [];
  if (unmake.length) inverse.push({ op: "record.remove", ids: unmake });
  if (restore.length) inverse.push({ op: "record.put", records: restore });
  return { doc: next, inverse, changed: [...touched], ...(created && Object.keys(created).length ? { created } : {}) };
}

export function need<K extends SchematicRecord["kind"]>(doc: SchematicDocument, id: string, kinds: readonly K[]): Extract<SchematicRecord, { kind: K }> {
  const r = doc.records.get(id);
  if (!r) throw new OpError(`no object ${id} on this schematic`);
  if (!(kinds as readonly string[]).includes(r.kind)) throw new OpError(`${id} is a ${r.kind}, not a ${kinds.join(" or ")}`);
  return r as Extract<SchematicRecord, { kind: K }>;
}

export function distinct(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new OpError(`${id} is listed twice`);
    seen.add(id);
  }
  return [...ids];
}

/** A record after an edit: `provenance.edited` set when a different kind of actor made it. */
export function edited<R extends SchematicRecord>(rec: R, ctx: ApplyContext): R {
  const p = (rec as { provenance?: Provenance }).provenance;
  if (!ctx.edited || !p) return rec;
  const made = p.by === "hand" ? "hand" : p.by === "agent" ? "agent" : p.by === "layout" ? "layout" : undefined;
  if (made === ctx.edited || p.edited === ctx.edited) return rec;
  return { ...rec, provenance: { ...p, edited: ctx.edited } };
}

/** Pin a record a person moved (unless told not to); clear with `pin: false`. */
export function pinIfMoved<R extends SchematicRecord>(rec: R, ctx: ApplyContext, given?: boolean): R {
  if (!PINNABLE.has(rec.kind)) return rec;
  const pin = given ?? ctx.pinMoves;
  if (pin) return { ...rec, pinned: true };
  if (given === false && (rec as { pinned?: true }).pinned) {
    const { pinned: _p, ...rest } = rec as R & { pinned?: true };
    return rest as R;
  }
  return rec;
}

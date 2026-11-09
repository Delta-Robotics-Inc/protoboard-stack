/**
 * The operation registry (contract section 8). Every change to a board is a named operation: a zod input
 * schema, a pure apply function that returns a new document and the operations that undo it, and a
 * description the CLI and MCP bindings show.
 */
import type { z } from "zod";
import { withChanges, type BoardDocument } from "../document.js";
import type { BoardRecord, Provenance, RecordKind } from "../schema.js";

export interface Actor {
  kind: "human" | "agent" | "router" | "host" | "system";
  id: string;
  name?: string;
}

/** A call: `{ op: "footprint.move", ids: [...], dx, dy }`. */
export type OpCall = { op: string } & Record<string, unknown>;

export interface ApplyContext {
  actor: Actor;
  /** A new owner-issued id for a record of this kind (`trk:<epoch>.<n>`). */
  issueId(kind: RecordKind): string;
  /** Provenance for records this operation creates. */
  provenance: Provenance;
  /** The edit class written to `provenance.edited` of records this operation changes (none for hosts and the system). */
  edited?: "hand" | "agent" | "routed";
  /** Whether copper this operation adds or moves is locked by default (a person's copper: contract section 6). */
  lockCopper: boolean;
}

export interface ApplyResult {
  doc: BoardDocument;
  /** Operations that restore the previous records exactly (`record.put`, `record.remove`). */
  inverse: OpCall[];
  /** Ids added, changed or removed. */
  changed: string[];
  /** Handle to id, for records created with a handle. */
  created?: Record<string, string>;
  /** What the operation wants its caller to know (detached tracks, skipped locked copper, a DXF read report). Plain JSON. */
  report?: Record<string, unknown>;
}

export interface OperationDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  /** One paragraph for CLI help and MCP tool descriptions. */
  description: string;
  /** The call without `op`. MCP tools use `input.shape`. */
  input: S;
  /** `system`: hosts, undo and the engine only; never offered as a CLI or MCP tool. */
  audience: "all" | "system";
  phase: 1 | 2;
  /** A valid call on the Airnode C3 fixture (without `op`). */
  example: Record<string, unknown>;
  apply(doc: BoardDocument, input: z.infer<S>, ctx: ApplyContext): ApplyResult;
}

/** An operation failed on this document (the engine reports it as `invalid` with the op's index). */
export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpError";
  }
}

const registry = new Map<string, OperationDef>();

export function registerOperation<S extends z.ZodTypeAny>(def: OperationDef<S>): OperationDef<S> {
  if (registry.has(def.name)) throw new Error(`operation ${def.name} is registered twice`);
  if (!/^[a-z]+(\.[a-z_]+)?$/.test(def.name)) throw new Error(`operation name ${def.name} is not <noun>.<verb>`);
  registry.set(def.name, def as unknown as OperationDef);
  return def;
}

/** Every registered operation, sorted by name. */
export const listOperations = (): OperationDef[] => [...registry.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
export const getOperation = (name: string): OperationDef | undefined => registry.get(name);

/**
 * Apply records to a document and compute the exact inverse: the previous version of every record written or
 * removed. Every operation ends here.
 */
export function change(doc: BoardDocument, puts: BoardRecord[], removes: string[] = [], created?: Record<string, string>, report?: Record<string, unknown>): ApplyResult {
  const touched = new Set<string>();
  const restore: BoardRecord[] = [];
  const unmake: string[] = [];
  for (const id of [...removes, ...puts.map((r) => r.id)]) {
    if (touched.has(id)) continue;
    touched.add(id);
    const before = doc.records.get(id);
    if (before) restore.push(before);
    else unmake.push(id);
  }
  const next = withChanges(doc, puts, removes);
  const inverse: OpCall[] = [];
  if (unmake.length) inverse.push({ op: "record.remove", ids: unmake });
  if (restore.length) inverse.push({ op: "record.put", records: restore });
  return { doc: next, inverse, changed: [...touched], ...(created && Object.keys(created).length ? { created } : {}), ...(report ? { report } : {}) };
}

/** A record by id, of the expected kind, or an OpError. */
export function need<K extends BoardRecord["kind"]>(doc: BoardDocument, id: string, kinds: readonly K[]): Extract<BoardRecord, { kind: K }> {
  const r = doc.records.get(id);
  if (!r) throw new OpError(`no object ${id} on this board`);
  if (!(kinds as readonly string[]).includes(r.kind)) throw new OpError(`${id} is a ${r.kind}, not a ${kinds.join(" or ")}`);
  return r as Extract<BoardRecord, { kind: K }>;
}

/** Ids given twice are an error (a move listed twice would move twice). */
export function distinct(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new OpError(`${id} is listed twice`);
    seen.add(id);
  }
  return [...ids];
}

/** A record after an edit by `ctx`: `provenance.edited` set when a different kind of actor made it. */
export function edited<R extends BoardRecord>(rec: R, ctx: Pick<ApplyContext, "edited">): R {
  const p = (rec as { provenance?: Provenance }).provenance;
  if (!ctx.edited || !p) return rec;
  const madeBy = p.by === "hand" ? "hand" : p.by === "agent" ? "agent" : p.by === "routed" ? "routed" : undefined;
  if (madeBy === ctx.edited || p.edited === ctx.edited) return rec;
  return { ...rec, provenance: { ...p, edited: ctx.edited } };
}

/** Copper a person moved or drew is locked against routers and agents by default. */
export function lockedByDefault<R extends BoardRecord>(rec: R, ctx: ApplyContext, given?: boolean): R {
  const lock = given ?? ctx.lockCopper;
  if (lock) return { ...rec, locked: true };
  if (given === false && (rec as { locked?: true }).locked) {
    const { locked: _l, ...rest } = rec as R & { locked?: true };
    return rest as R;
  }
  return rec;
}

/** Remove optional fields named in `unset` (edit operations). */
export function unsetFields<R extends Record<string, unknown>>(rec: R, unset: readonly string[] | undefined, protectedFields: readonly string[]): R {
  if (!unset?.length) return rec;
  const out: Record<string, unknown> = { ...rec };
  for (const f of unset) {
    if (protectedFields.includes(f)) throw new OpError(`${f} cannot be removed`);
    delete out[f];
  }
  return out as R;
}

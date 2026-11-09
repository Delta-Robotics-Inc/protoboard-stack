/**
 * The transaction engine (contract section 9), with the board core's semantics: transactions all or nothing,
 * batch ids answered once, `seq` and a version per object, stale writes refused, per-actor undo and redo refused
 * when what they touched changed since. Pinned items refuse agents (reason `pinned`), and an agent's unpin waits
 * for a person. Kept here until the board package exports a generic engine (contract section 14).
 */
import { byCodeUnit, canonicalRecord, newEpoch, type Actor, type OpCall } from "@protoboardai/board";
import type { SchematicDocument } from "./document.ts";
import "./ops/index.ts";
import { getOperation, OpError, type ApplyContext } from "./ops/registry.ts";
import { ID_PREFIX, validateRecord, type Provenance, type SchematicRecord } from "./schema.ts";

export const HUMAN: Actor = { kind: "human", id: "user" };
export const SYSTEM: Actor = { kind: "system", id: "schematic" };
export const MAX_OPS = 200;
const REPLY_CAP = 256;
const LOG_CAP = 1000;

export interface Transaction {
  batchId: string;
  label: string;
  ops: OpCall[];
  changeSet?: { id: string; title?: string };
  expectSeq?: number;
  expectVersions?: Record<string, number>;
  dryRun?: boolean;
  provenance?: Provenance;
}

export type RefusalReason = "stale-seq" | "stale-versions" | "pinned" | "needs-person" | "stale-undo" | "nothing-to-undo" | "nothing-to-redo";

export type Reply =
  | { status: "applied" | "valid"; batchId: string; epoch: string; seq: number; changed: string[]; created: Record<string, string>; removed: string[]; versions: Record<string, number>; duplicate?: true }
  | { status: "refused"; batchId: string; epoch: string; seq: number; reason: RefusalReason; message: string; ids?: string[]; duplicate?: true }
  | { status: "invalid"; batchId: string; epoch: string; seq: number; error: string; index?: number; issues?: unknown; duplicate?: true };

export interface LogEntry {
  seq: number;
  time: number;
  actor: Actor;
  batchId?: string;
  label: string;
  changeSet?: string;
  ops: OpCall[];
  inverse: OpCall[];
  forward: OpCall[];
  changed: string[];
  created: Record<string, string>;
  removed: string[];
  touched: Record<string, number>;
  undoOf?: number;
  redoOf?: number;
  undoneBy?: number;
  redoneBy?: number;
}

export interface CommitEvent {
  entry: LogEntry;
  before: SchematicDocument;
  after: SchematicDocument;
}

export interface SchematicEngine {
  readonly doc: SchematicDocument;
  readonly seq: number;
  readonly epoch: string;
  version(id: string): number;
  apply(tx: Transaction, actor: Actor): Reply;
  undo(actor: Actor, meta?: { batchId?: string }): Reply;
  redo(actor: Actor, meta?: { batchId?: string }): Reply;
  log(since?: number): LogEntry[];
  onCommit(listener: (e: CommitEvent) => void): () => void;
}

export function provenanceFor(actor: Actor): Provenance {
  const name = (actor.name ?? actor.id).replace(/[^\w .:@/-]/g, "").trim().slice(0, 80) || actor.id;
  if (actor.kind === "human") return { by: "hand" };
  if (actor.kind === "agent") return { by: "agent", actor: `agent:${name.replace(/^agent:/, "")}` };
  return { by: "system", tool: name };
}
const editedFor = (a: Actor): ApplyContext["edited"] => (a.kind === "human" ? "hand" : a.kind === "agent" ? "agent" : undefined);
const sameActor = (a: Actor, b: Actor) => a.kind === b.kind && a.id === b.id;
const HANDLE_REF = /^\$([A-Za-z0-9_]{1,40})$/;

function resolveHandles(v: unknown, handles: Record<string, string>): unknown {
  if (typeof v === "string") {
    const m = HANDLE_REF.exec(v);
    if (!m) return v;
    if (!handles[m[1]]) throw new OpError(`unknown handle $${m[1]}`);
    return handles[m[1]];
  }
  if (Array.isArray(v)) return v.map((x) => resolveHandles(x, handles));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveHandles(x, handles)]));
  return v;
}

export function createSchematicEngine(initial: SchematicDocument, options: { now?: () => number; epoch?: string } = {}): SchematicEngine {
  const now = options.now ?? (() => Date.now());
  const epoch = options.epoch ?? newEpoch();
  let doc = initial;
  let seq = 0;
  let nextKey = 1;
  const versions = new Map<string, number>();
  for (const id of initial.records.keys()) versions.set(id, 1);
  let entries: LogEntry[] = [];
  const replies = new Map<string, Reply>();
  const listeners = new Set<(e: CommitEvent) => void>();
  const version = (id: string) => versions.get(id) ?? 0;
  const remember = (bid: string, r: Reply): Reply => {
    if (bid) {
      replies.set(bid, r);
      if (replies.size > REPLY_CAP) replies.delete(replies.keys().next().value as string);
    }
    return r;
  };
  const refused = (batchId: string, reason: RefusalReason, message: string, ids?: string[]): Reply => ({ status: "refused", batchId, epoch, seq, reason, message, ...(ids ? { ids } : {}) });
  const invalid = (batchId: string, error: string, rest: { index?: number; issues?: unknown } = {}): Reply => ({ status: "invalid", batchId, epoch, seq, error, ...rest });

  function execute(actor: Actor, calls: OpCall[], meta: { batchId: string; label: string; internal: boolean; dryRun?: boolean; provenance?: Provenance; changeSet?: { id: string }; undoOf?: number; redoOf?: number }): Reply & { entry?: LogEntry } {
    const id = meta.batchId;
    const before = doc;
    let work = doc;
    const ctx: ApplyContext = { actor, issueId: (kind) => `${ID_PREFIX[kind]}:${epoch}.${nextKey++}`, provenance: meta.provenance ?? provenanceFor(actor), edited: editedFor(actor), pinMoves: actor.kind === "human" };
    const handles: Record<string, string> = {};
    const inverse: OpCall[] = [];
    const applied: OpCall[] = [];
    const candidates = new Set<string>();
    for (let i = 0; i < calls.length; i++) {
      const raw = calls[i];
      if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return invalid(id, "each operation is an object with an op name", { index: i });
      const def = getOperation(raw.op);
      if (!def) return invalid(id, `unknown operation ${raw.op}`, { index: i });
      if (def.audience === "system" && !meta.internal && actor.kind !== "host" && actor.kind !== "system") return invalid(id, `${raw.op} is a system operation`, { index: i });
      let call: Record<string, unknown>;
      try {
        call = resolveHandles(raw, handles) as Record<string, unknown>;
      } catch (e) {
        return invalid(id, (e as Error).message, { index: i });
      }
      const { op: _op, ...args } = call;
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return invalid(id, `${raw.op}: ${parsed.error.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; ")}`, { index: i, issues: parsed.error.issues });
      try {
        const r = def.apply(work, parsed.data, ctx);
        work = r.doc;
        inverse.unshift(...r.inverse);
        for (const c of r.changed) candidates.add(c);
        for (const [h, v] of Object.entries(r.created ?? {})) handles[h] = v;
        applied.push(call as OpCall);
      } catch (e) {
        if (e instanceof OpError) return invalid(id, `${raw.op}: ${e.message}`, { index: i });
        throw e;
      }
    }
    const changed: string[] = [];
    const removed: string[] = [];
    for (const c of [...candidates].sort(byCodeUnit)) {
      const a = before.records.get(c);
      const b = work.records.get(c);
      if (a === b || (a && b && canonicalRecord(a) === canonicalRecord(b))) continue;
      changed.push(c);
      if (a && !b) removed.push(c);
    }
    for (const c of changed) {
      const r = work.records.get(c);
      if (!r) continue;
      const v = validateRecord(r);
      if (!v.ok) return invalid(id, v.error, v.issues ? { issues: v.issues } : {});
    }
    if (actor.kind === "agent") {
      const pinned: string[] = [];
      const unpins: string[] = [];
      for (const c of changed) {
        const a = before.records.get(c) as (SchematicRecord & { pinned?: true }) | undefined;
        const b = work.records.get(c) as (SchematicRecord & { pinned?: true }) | undefined;
        if (!a?.pinned) continue;
        const strip = (r: SchematicRecord) => {
          const { pinned: _p, provenance: _v, ...rest } = r as SchematicRecord & { pinned?: true; provenance?: unknown };
          return canonicalRecord(rest);
        };
        if (b && !b.pinned && strip(a) === strip(b)) unpins.push(c);
        else pinned.push(c);
      }
      if (pinned.length) return refused(id, "pinned", `${pinned.length} pinned item${pinned.length > 1 ? "s" : ""} would change (${pinned.slice(0, 5).join(", ")}); agents leave hand-placed items alone`, pinned);
      if (unpins.length) return refused(id, "needs-person", `unpinning ${unpins.slice(0, 5).join(", ")} waits for a person`, unpins);
    }
    const created: Record<string, string> = { ...handles };
    if (meta.dryRun) return { status: "valid", batchId: id, epoch, seq, changed, created, removed, versions: Object.fromEntries(changed.map((c) => [c, version(c) + 1])) };
    if (!changed.length) return { status: "applied", batchId: id, epoch, seq, changed, created, removed, versions: {} };
    doc = work;
    seq++;
    for (const c of changed) versions.set(c, version(c) + 1);
    const forward: OpCall[] = [];
    if (removed.length) forward.push({ op: "record.remove", ids: removed });
    const puts = changed.filter((c) => work.records.has(c)).map((c) => work.records.get(c)!);
    if (puts.length) forward.push({ op: "record.put", records: puts });
    const entry: LogEntry = {
      seq,
      time: now(),
      actor: { ...actor },
      ...(id ? { batchId: id } : {}),
      label: meta.label,
      ...(meta.changeSet ? { changeSet: meta.changeSet.id } : {}),
      ops: applied,
      inverse,
      forward,
      changed,
      created,
      removed,
      touched: Object.fromEntries(changed.map((c) => [c, version(c)])),
      ...(meta.undoOf !== undefined ? { undoOf: meta.undoOf } : {}),
      ...(meta.redoOf !== undefined ? { redoOf: meta.redoOf } : {}),
    };
    entries.push(entry);
    if (entries.length > LOG_CAP) entries = entries.slice(-LOG_CAP);
    for (const l of [...listeners]) l({ entry, before, after: doc });
    return { status: "applied", batchId: id, epoch, seq, changed, created, removed, versions: Object.fromEntries(changed.map((c) => [c, version(c)])), entry };
  }
  const strip = (r: Reply & { entry?: LogEntry }): Reply => {
    const { entry: _e, ...rest } = r;
    return rest as Reply;
  };
  function staleSince(e: LogEntry): string[] {
    const after = new Map<string, SchematicRecord | undefined>();
    for (const op of e.forward) {
      if (op.op === "record.remove") for (const id of op.ids as string[]) after.set(id, undefined);
      else for (const r of op.records as SchematicRecord[]) after.set(r.id, r);
    }
    const out: string[] = [];
    for (const [id, want] of after) {
      const cur = doc.records.get(id);
      if (!(want === cur || (want && cur && canonicalRecord(want) === canonicalRecord(cur)))) out.push(id);
    }
    return out;
  }
  return {
    get doc() {
      return doc;
    },
    get seq() {
      return seq;
    },
    get epoch() {
      return epoch;
    },
    version,
    apply(tx, actor) {
      const bid = typeof tx?.batchId === "string" ? tx.batchId : "";
      const hit = bid ? replies.get(bid) : undefined;
      if (hit) return { ...hit, duplicate: true };
      if (!bid || bid.length > 200 || !/^[\w.:-]+$/.test(bid)) return invalid(bid, "batchId must be 1 to 200 letters, digits, '.', ':', '_' or '-'");
      const words = typeof tx.label === "string" ? tx.label.trim().split(/\s+/).filter(Boolean).length : 0;
      if (words < 3 || words > 8) return remember(bid, invalid(bid, "label must be 3 to 8 words saying what the transaction does"));
      if (!Array.isArray(tx.ops) || tx.ops.length < 1 || tx.ops.length > MAX_OPS) return remember(bid, invalid(bid, `ops must list 1 to ${MAX_OPS} operations`));
      if (tx.provenance && actor.kind !== "host" && actor.kind !== "system") return remember(bid, invalid(bid, "only hosts and the system give provenance"));
      if (tx.expectSeq !== undefined && tx.expectSeq !== seq) return remember(bid, refused(bid, "stale-seq", `the schematic is at seq ${seq}; you read seq ${tx.expectSeq}`));
      if (tx.expectVersions) {
        const stale = Object.entries(tx.expectVersions).filter(([id, v]) => version(id) !== v).map(([id]) => id);
        if (stale.length) return remember(bid, refused(bid, "stale-versions", `${stale.length} object${stale.length > 1 ? "s" : ""} changed since you read them`, stale));
      }
      const r = execute(actor, tx.ops, { batchId: bid, label: tx.label.trim(), internal: false, ...(tx.dryRun ? { dryRun: true } : {}), ...(tx.provenance ? { provenance: tx.provenance } : {}), ...(tx.changeSet ? { changeSet: tx.changeSet } : {}) });
      return tx.dryRun ? strip(r) : remember(bid, strip(r));
    },
    undo(actor, meta = {}) {
      const bid = meta.batchId ?? "";
      const e = [...entries].reverse().find((x) => sameActor(x.actor, actor) && x.undoOf === undefined && x.undoneBy === undefined);
      if (!e) return refused(bid, "nothing-to-undo", "nothing of yours is left to undo");
      const stale = staleSince(e);
      if (stale.length) return refused(bid, "stale-undo", `your transaction at seq ${e.seq} cannot be undone: what it changed was changed again since`, stale);
      const r = execute(actor, e.inverse, { batchId: bid, label: `undo: ${e.label}`.slice(0, 160), internal: true, undoOf: e.seq });
      if (r.entry) e.undoneBy = r.entry.seq;
      return strip(r);
    },
    redo(actor, meta = {}) {
      const bid = meta.batchId ?? "";
      let u: LogEntry | undefined;
      for (const x of [...entries].reverse()) {
        if (!sameActor(x.actor, actor) || x.redoOf !== undefined) continue;
        if (x.undoOf !== undefined && x.redoneBy === undefined) u = x;
        break;
      }
      if (!u) return refused(bid, "nothing-to-redo", "nothing of yours is left to redo");
      const stale = staleSince(u);
      if (stale.length) return refused(bid, "stale-undo", `the undo at seq ${u.seq} cannot be redone`, stale);
      const r = execute(actor, u.inverse, { batchId: bid, label: u.label.replace(/^undo: /, ""), internal: true, redoOf: u.seq });
      if (r.entry) u.redoneBy = r.entry.seq;
      return strip(r);
    },
    log: (since) => (since === undefined ? [...entries] : entries.filter((e) => e.seq > since)),
    onCommit(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

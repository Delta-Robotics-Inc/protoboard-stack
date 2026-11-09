/**
 * The transaction engine (contract section 9): the only writer of a board document. It applies transactions
 * all or nothing, keeps the document version (`seq`) and a version per object, refuses stale writes, enforces
 * locks and leases, and gives each actor its own undo and redo. It does no I/O: the board service adds the
 * journal, the files, the query index and change events.
 *
 * Ported in shape from the 3D viewer's view store (@deltarobotics/uhd-viewer, src/cad/state/store.ts,
 * Apache-2.0): batch ids with idempotent resend, 3 to 8 word labels, at most 200 operations, preconditions that
 * say what the writer missed, owner-issued ids, fencing tokens, per-actor undo refused when stale.
 */
import { byCodeUnit, canonicalRecord } from "./canonical.js";
import { copperLayers, footprintByRef, footprintKey, padKeys, padId, type BoardDocument } from "./document.js";
import { boundsOf, boxesMeet, inflate, layersOf, unionBox, type Box } from "./geometry.js";
import { createLeaseTable, type EndedLease, type Lease, type LeaseClaim, type Scope } from "./leases.js";
import { getOperation, OpError, type Actor, type ApplyContext, type OpCall } from "./ops/index.js";
import { ID_PREFIX, idMatchesKind, RECORD_SCHEMAS, type BoardRecord, type Provenance, type RecordKind } from "./schema.js";


export const HUMAN: Actor = { kind: "human", id: "user" };
export const SYSTEM: Actor = { kind: "system", id: "board" };

/** DEFAULT: entries kept in memory. */
export const LOG_CAP = 1000;
/** DEFAULT: replies remembered by batch id. */
export const REPLY_CAP = 256;
/** DEFAULT: operations in one transaction. */
export const MAX_OPS = 200;
/** DEFAULT: an agent's write shows as an intent this long. */
export const INTENT_MS = 30_000;

export interface Transaction {
  batchId: string;
  label: string;
  ops: OpCall[];
  changeSet?: { id: string; title?: string };
  expectEpoch?: string;
  expectSeq?: number;
  expectVersions?: Record<string, number>;
  expectRegion?: { box: Box; layers?: string[]; seq: number };
  leaseToken?: number;
  dryRun?: boolean;
  /** Hosts, routers and the system only: provenance for what this transaction creates. */
  provenance?: Provenance;
}

export interface LogEntry {
  seq: number;
  time: number;
  actor: Actor;
  batchId?: string;
  label: string;
  changeSet?: string;
  /** The operations as applied (handles resolved). */
  ops: OpCall[];
  /** Restores the records before this entry. */
  inverse: OpCall[];
  /** Writes the records after this entry (exact replay). */
  forward: OpCall[];
  changed: string[];
  created: Record<string, string>;
  removed: string[];
  /** Each changed id's version after this entry. */
  touched: Record<string, number>;
  /** Boxes and layers of what changed, before and after (spatial read sets). */
  areas: { box: Box; layers: string[] }[];
  baseSeq?: number;
  leaseToken?: number;
  undoOf?: number;
  redoOf?: number;
  revertOf?: string;
  undoneBy?: number;
  redoneBy?: number;
  /** The entry changed the netlist (`netlist.sync`). */
  netlist?: true;
  /** The proposal this entry accepted. */
  proposal?: string;
}

/** What an operation reported (detached tracks, skipped locked copper, a DXF read). */
export interface OpReport {
  index: number;
  op: string;
  report: Record<string, unknown>;
}

/** A person's hold on objects while dragging them (Phase 2 contract, section 5). */
export interface Hold {
  id: string;
  holder: Actor;
  ids: string[];
  box: Box;
  layers: string[];
  margin: number;
  until: number;
}

/** DEFAULT: a drag hold lasts this long unless renewed. */
export const HOLD_TTL_MS = 10_000;
/** DEFAULT: the longest a hold may be asked for. */
export const HOLD_MAX_MS = 60_000;

/** Options only the service passes (never a client): a person accepting a proposal keeps the proposer's provenance. */
export interface ApplyOptions {
  provenance?: Provenance;
  edited?: "hand" | "agent" | "routed";
  lockCopper?: boolean;
  proposal?: string;
}

export interface MissedEntry {
  seq: number;
  actor: Actor;
  batchId?: string;
  label: string;
  changed: string[];
}
export interface Conflict {
  id: string;
  expected: number;
  current: number;
  by?: Actor;
  seq?: number;
}

export type RefusalReason =
  | "stale-epoch"
  | "stale-seq"
  | "stale-versions"
  | "stale-region"
  | "leased"
  | "lease-revoked"
  | "locked"
  | "needs-person"
  | "stale-undo"
  | "nothing-to-undo"
  | "nothing-to-redo"
  | "held"
  | "stale-proposal"
  | "not-a-person"
  | "paused";

export type Reply =
  | { status: "applied" | "valid"; batchId: string; epoch: string; seq: number; changed: string[]; created: Record<string, string>; removed: string[]; versions: Record<string, number>; reports?: OpReport[]; netlist?: true; duplicate?: true }
  | { status: "refused"; batchId: string; epoch: string; seq: number; reason: RefusalReason; message: string; missed?: MissedEntry[]; conflicts?: Conflict[]; lease?: Lease | EndedLease; ids?: string[]; hold?: Hold; retryAfterMs?: number; proposal?: string; pause?: Pause; duplicate?: true }
  | { status: "invalid"; batchId: string; epoch: string; seq: number; error: string; index?: number; issues?: unknown; duplicate?: true };

export interface Intent {
  actor: Actor;
  label: string;
  ids: string[];
  at: number;
  from: "lease" | "recent";
}
export interface Presence {
  epoch: string;
  seq: number;
  leases: Lease[];
  intents: Intent[];
  /** A person's live drag holds. */
  holds: Hold[];
  /** Agents and routers are paused by a person (absent: not paused). */
  paused?: Pause;
}

/** A person's pause of agents and routers (Phase 2, P2-E): their transactions are refused `paused` until resumed or `until`. */
export interface Pause {
  by: Actor;
  since: number;
  reason?: string;
  until?: number;
}

export interface ChangeSetInfo {
  id: string;
  title?: string;
  actors: Actor[];
  entries: number[];
}

export interface CommitEvent {
  entry: LogEntry;
  before: BoardDocument;
  after: BoardDocument;
}

export type ClaimReply =
  | { status: "granted"; lease: Lease }
  | { status: "refused"; reason: "leased"; lease: Lease; message: string }
  | { status: "refused"; reason: "paused"; pause: Pause; retryAfterMs?: number; message: string }
  | { status: "invalid"; error: string };

export interface EngineOptions {
  now?: () => number;
  /** Six base-36 characters; random by default. */
  epoch?: string;
}

export interface Engine {
  readonly doc: BoardDocument;
  readonly seq: number;
  readonly epoch: string;
  version(id: string): number;
  versions(ids?: readonly string[]): Record<string, number>;
  /** `options` is for the service only (a person accepting a proposal); clients never reach it. */
  apply(tx: Transaction, actor: Actor, options?: ApplyOptions): Reply;
  /** A person's hold on objects for a drag: agent, router and host writes touching them or their halo are refused (`held`). */
  hold(actor: Actor, claim: { ids: string[]; margin?: number; ttlMs?: number }): { status: "held"; hold: Hold } | { status: "invalid"; error: string };
  releaseHold(actor: Actor, id?: string): Hold[];
  holds(): Hold[];
  /** A person pauses agents and routers: their transactions and claims are refused `paused` (proposals still go through the service). */
  pause(actor: Actor, options?: { reason?: string; ttlMs?: number }): { status: "paused"; pause: Pause } | { status: "invalid"; error: string };
  /** A person resumes agents and routers. */
  resume(actor: Actor): { status: "resumed"; was?: Pause } | { status: "invalid"; error: string };
  /** The live pause, if any. */
  paused(): Pause | undefined;
  undo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  redo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  revertChangeSet(actor: Actor, id: string, meta?: { batchId?: string; leaseToken?: number }): Reply;
  /** System replay of record operations (journal recovery); no checks beyond the record schemas. */
  replay(ops: OpCall[], label: string): Reply;
  claim(actor: Actor, claim: LeaseClaim): ClaimReply;
  release(actor: Actor, id?: string): EndedLease[];
  takeOver(by?: Actor): EndedLease[];
  presence(): Presence;
  log(since?: number): LogEntry[];
  changeSets(): ChangeSetInfo[];
  onCommit(listener: (e: CommitEvent) => void): () => void;
  onLeases(listener: () => void): () => void;
}

export function newEpoch(): string {
  const a = new Uint8Array(6);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((x) => (x % 36).toString(36)).join("");
}

const sameActor = (a: Actor, b: Actor) => a.kind === b.kind && a.id === b.id;

/** A hold's default halo: the board's largest clearance minimum (any tier) plus 0.1 mm. */
export function defaultHoldMargin(doc: BoardDocument): number {
  let m = 0;
  for (const r of doc.records.values()) if (r.kind === "rule" && r.enabled !== false && (r.check === "clearance" || r.check === "physical_clearance") && r.min !== undefined) m = Math.max(m, r.min);
  for (const r of doc.records.values()) if (r.kind === "zone" && r.clearance !== undefined) m = Math.max(m, r.clearance);
  return m + 100_000;
}
const HANDLE_REF = /^\$([A-Za-z0-9_]{1,40})$/;

/** The provenance the engine gives records an actor creates. */
export function provenanceFor(actor: Actor): Provenance {
  const name = (actor.name ?? actor.id).replace(/[^\w .:@/-]/g, "").trim().slice(0, 80) || actor.id;
  switch (actor.kind) {
    case "human":
      return { by: "hand" };
    case "agent":
      return { by: "agent", actor: `agent:${name.replace(/^agent:/, "")}` };
    case "router":
      return { by: "routed", tool: name };
    case "host":
      return { by: "system", tool: name };
    default:
      return { by: "system" };
  }
}
const editedFor = (actor: Actor): ApplyContext["edited"] => (actor.kind === "human" ? "hand" : actor.kind === "agent" ? "agent" : actor.kind === "router" ? "routed" : undefined);

/** What a record touches, for leases and spatial read sets. */
export function scopeOf(doc: BoardDocument, rec: BoardRecord): Scope {
  const box = boundsOf(rec);
  const layers = layersOf(doc, rec) as string[];
  const paths: string[] = [];
  const nets = new Set<string>();
  if (rec.kind === "footprint") {
    paths.push(rec.path ?? rec.ref);
    const keys = padKeys(rec);
    keys.forEach((k) => {
      const n = doc.padNets.get(padId(footprintKey(rec), k));
      if (n) nets.add(n);
    });
  } else if ((rec.kind === "track" || rec.kind === "via" || rec.kind === "zone") && rec.net) nets.add(rec.net);
  else if (rec.kind === "keepout" && rec.footprint) {
    const fp = doc.records.get(rec.footprint);
    if (fp?.kind === "footprint") paths.push(fp.path ?? fp.ref);
  }
  return { id: rec.id, paths, nets: [...nets], ...(box ? { box } : {}), layers };
}

/** Problems with a changed record: schema, id form, references. */
function recordProblem(doc: BoardDocument, rec: BoardRecord): { error: string; issues?: unknown } | undefined {
  const schema = RECORD_SCHEMAS[rec.kind as RecordKind];
  if (!schema) return { error: `${rec.id}: unknown kind ${String((rec as { kind: unknown }).kind)}` };
  const parsed = schema.safeParse(rec);
  if (!parsed.success) return { error: `${rec.id}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ")}`, issues: parsed.error.issues };
  if (!idMatchesKind(rec.id, rec.kind)) return { error: `${rec.id} is not a valid id for a ${rec.kind} (${ID_PREFIX[rec.kind] ? `${ID_PREFIX[rec.kind]}:<key>` : rec.kind})` };
  const stack = copperLayers(doc);
  const netOk = (net: string | undefined) => !net || !doc.netlist || doc.nets.has(net);
  switch (rec.kind) {
    case "track":
      if (!stack.includes(rec.layer)) return { error: `${rec.id}: layer ${rec.layer} is not in the stackup` };
      if (!netOk(rec.net)) return { error: `${rec.id}: net ${rec.net} is not in the netlist` };
      break;
    case "via": {
      const a = stack.indexOf(rec.from_layer);
      const b = stack.indexOf(rec.to_layer);
      if (a < 0 || b < 0 || a >= b) return { error: `${rec.id}: from_layer ${rec.from_layer} must be above to_layer ${rec.to_layer}, both in the stackup` };
      if (rec.hole_diameter >= rec.outer_diameter) return { error: `${rec.id}: the hole must be smaller than the outer diameter` };
      if (!netOk(rec.net)) return { error: `${rec.id}: net ${rec.net} is not in the netlist` };
      break;
    }
    case "zone":
      if (!netOk(rec.net)) return { error: `${rec.id}: net ${rec.net} is not in the netlist` };
      for (const l of rec.layers) if (!stack.includes(l)) return { error: `${rec.id}: layer ${l} is not in the stackup` };
      break;
    case "keepout":
      for (const l of rec.layers) if (!stack.includes(l)) return { error: `${rec.id}: layer ${l} is not in the stackup` };
      if (rec.footprint && doc.records.get(rec.footprint)?.kind !== "footprint") return { error: `${rec.id}: footprint ${rec.footprint} is not on the board` };
      break;
    case "footprint": {
      const other = footprintByRef(doc, rec.ref);
      if (other && other.id !== rec.id) return { error: `${rec.id}: reference ${rec.ref} is already used by ${other.id}` };
      break;
    }
    case "waiver":
      if (rec.finding === undefined && rec.rule === undefined) return { error: `${rec.id}: a waiver names a finding, a rule, or both` };
      break;
    case "graphic":
    case "text":
      if ((stack as string[]).concat().includes(rec.layer) === false && /^(top|bottom|inner\d)$/.test(rec.layer)) return { error: `${rec.id}: layer ${rec.layer} is not in the stackup` };
      break;
  }
  return undefined;
}

const withoutLock = (r: BoardRecord) => {
  const { locked: _l, provenance: _p, ...rest } = r as BoardRecord & { locked?: true; provenance?: unknown };
  return canonicalRecord(rest);
};

function resolveHandles(value: unknown, handles: Record<string, string>): unknown {
  if (typeof value === "string") {
    const m = HANDLE_REF.exec(value);
    if (!m) return value;
    const id = handles[m[1]];
    if (!id) throw new OpError(`unknown handle $${m[1]} (handles name records created earlier in the same transaction)`);
    return id;
  }
  if (Array.isArray(value)) return value.map((v) => resolveHandles(v, handles));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveHandles(v, handles)]));
  return value;
}

export function createEngine(initial: BoardDocument, options: EngineOptions = {}): Engine {
  const now = options.now ?? (() => Date.now());
  const epoch = options.epoch ?? newEpoch();
  let doc = initial;
  let seq = 0;
  let nextKey = 1;
  const versions = new Map<string, number>();
  for (const id of initial.records.keys()) versions.set(id, 1);
  const lastBy = new Map<string, LogEntry>();
  let entries: LogEntry[] = [];
  const replies = new Map<string, Reply>();
  const leases = createLeaseTable(now);
  const changeSets = new Map<string, ChangeSetInfo>();
  const recent = new Map<string, Intent>();
  const commitListeners = new Set<(e: CommitEvent) => void>();
  const leaseListeners = new Set<() => void>();

  const version = (id: string) => versions.get(id) ?? 0;
  const missedSince = (from: number, filter?: (e: LogEntry) => boolean): MissedEntry[] =>
    entries.filter((e) => e.seq > from && (!filter || filter(e))).map((e) => ({ seq: e.seq, actor: { ...e.actor }, ...(e.batchId ? { batchId: e.batchId } : {}), label: e.label, changed: e.changed }));
  const remember = (batchId: string, reply: Reply): Reply => {
    if (!batchId) return reply;
    replies.set(batchId, reply);
    if (replies.size > REPLY_CAP) replies.delete(replies.keys().next().value as string);
    return reply;
  };
  const refused = (batchId: string, reason: RefusalReason, message: string, rest: Partial<Extract<Reply, { status: "refused" }>> = {}): Reply => ({ status: "refused", batchId, epoch, seq, reason, message, ...rest });
  const invalid = (batchId: string, error: string, rest: { index?: number; issues?: unknown } = {}): Reply => ({ status: "invalid", batchId, epoch, seq, error, ...rest });
  const emitLeases = () => {
    for (const l of [...leaseListeners]) {
      try {
        l();
      } catch (e) {
        console.error("[board] a lease listener failed", e);
      }
    }
  };
  const conflictsOf = (want: Record<string, number>): Conflict[] =>
    Object.entries(want)
      .filter(([id, v]) => version(id) !== v)
      .map(([id, v]) => ({ id, expected: v, current: version(id), ...(lastBy.get(id) ? { by: { ...lastBy.get(id)!.actor }, seq: lastBy.get(id)!.seq } : {}) }));

  interface ExecMeta {
    batchId: string;
    label: string;
    internal: boolean;
    changeSet?: { id: string; title?: string };
    leaseToken?: number;
    dryRun?: boolean;
    provenance?: Provenance;
    baseSeq?: number;
    undoOf?: number;
    redoOf?: number;
    revertOf?: string;
    /** Skip locks, leases and policy (journal replay by the system). */
    replay?: boolean;
    edited?: "hand" | "agent" | "routed";
    lockCopper?: boolean;
    proposal?: string;
  }

  // ---- a person's pause of agents and routers
  let pauseState: Pause | undefined;
  /** The live pause; one past its `until` ends here (and says so to presence listeners). */
  const livePause = (): Pause | undefined => {
    if (pauseState?.until !== undefined && pauseState.until <= now()) {
      pauseState = undefined;
      emitLeases();
    }
    return pauseState;
  };
  const copyPause = (p: Pause): Pause => ({ ...p, by: { ...p.by } });
  /** The refusal of an agent's or router's write while paused (never remembered: a resend after the pause applies). */
  const pausedFor = (actor: Actor, batchId: string): Reply | undefined => {
    if (actor.kind !== "agent" && actor.kind !== "router") return undefined;
    const p = livePause();
    if (!p) return undefined;
    const retry = p.until !== undefined ? Math.max(0, p.until - now()) : undefined;
    return refused(batchId, "paused", `a person paused agents and routers${p.reason ? ` (${p.reason})` : ""}${p.until !== undefined ? ` until ${new Date(p.until).toISOString()}` : " until they resume"}; proposals are still taken: retry later, or propose the change for a person`, { pause: copyPause(p), ...(retry !== undefined ? { retryAfterMs: retry } : {}) });
  };
  /** Refusals that clear on their own are not remembered by batch id, so the same batch may be sent again. */
  const transient = (r: Reply) => r.status === "refused" && (r.reason === "held" || r.reason === "paused");

  const holdTable = new Map<string, Hold>();
  let holdSerial = 0;
  const liveHolds = (): Hold[] => {
    const t = now();
    for (const [k, h] of holdTable) if (h.until <= t) holdTable.delete(k);
    return [...holdTable.values()];
  };
  /** The live hold a changed record runs into, if any. */
  const holdBlocking = (scopes: Scope[]): Hold | undefined => {
    const hs = liveHolds();
    if (!hs.length) return undefined;
    for (const h of hs) {
      const halo = inflate(h.box, h.margin);
      for (const s of scopes) {
        if (h.ids.includes(s.id)) return h;
        if (s.box && boxesMeet(s.box, halo) && (!s.layers.length || !h.layers.length || s.layers.some((l) => h.layers.includes(l)))) return h;
      }
    }
    return undefined;
  };

  function execute(actor: Actor, calls: OpCall[], meta: ExecMeta): Reply & { entry?: LogEntry } {
    const id = meta.batchId;
    const before = doc;
    let work = doc;
    const ctx: ApplyContext = {
      actor,
      issueId: (kind) => `${ID_PREFIX[kind]}:${epoch}.${nextKey++}`,
      provenance: meta.provenance ?? provenanceFor(actor),
      edited: meta.edited ?? editedFor(actor),
      lockCopper: meta.lockCopper ?? actor.kind === "human",
      now,
    };
    const handles: Record<string, string> = {};
    const inverse: OpCall[] = [];
    const applied: OpCall[] = [];
    const reports: OpReport[] = [];
    const candidates = new Set<string>();
    for (let i = 0; i < calls.length; i++) {
      const raw = calls[i];
      if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return invalid(id, "each operation is an object with an op name", { index: i });
      const def = getOperation(raw.op);
      if (!def) return invalid(id, `unknown operation ${raw.op}`, { index: i });
      if (def.audience === "system" && !meta.internal && actor.kind !== "host" && actor.kind !== "system") return invalid(id, `${raw.op} is a system operation (hosts and the engine only)`, { index: i });
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
        for (const [h, v] of Object.entries(r.created ?? {})) {
          if (handles[h]) return invalid(id, `handle ${h} is used twice in this transaction`, { index: i });
          handles[h] = v;
        }
        if (r.report) reports.push({ index: i, op: raw.op, report: r.report });
        applied.push(call as OpCall);
      } catch (e) {
        if (e instanceof OpError) return invalid(id, `${raw.op}: ${e.message}`, { index: i });
        throw e;
      }
    }
    // what really changed (a move and a move back is no change)
    const changed: string[] = [];
    const removed: string[] = [];
    const createdIds: string[] = [];
    for (const c of [...candidates].sort(byCodeUnit)) {
      const a = before.records.get(c);
      const b = work.records.get(c);
      if (a === b) continue;
      if (a && b && canonicalRecord(a) === canonicalRecord(b)) continue;
      changed.push(c);
      if (a && !b) removed.push(c);
      if (!a && b) createdIds.push(c);
    }
    // records valid, references resolve
    for (const c of changed) {
      const rec = work.records.get(c);
      if (!rec) continue;
      const p = recordProblem(work, rec);
      if (p) return invalid(id, p.error, p.issues ? { issues: p.issues } : {});
    }
    const scopes: Scope[] = [];
    for (const c of changed) {
      const a = before.records.get(c);
      const b = work.records.get(c);
      if (a) scopes.push(scopeOf(before, a));
      if (b) scopes.push(scopeOf(work, b));
    }
    if (!meta.replay && (actor.kind === "agent" || actor.kind === "router")) {
      // locks: agents and routers never change locked objects; unlocking waits for a person
      const locked: string[] = [];
      const unlocks: string[] = [];
      const nets: string[] = [];
      for (const c of changed) {
        const a = before.records.get(c) as (BoardRecord & { locked?: true; net?: string }) | undefined;
        const b = work.records.get(c) as (BoardRecord & { locked?: true; net?: string }) | undefined;
        if (a?.locked) {
          if (b && !b.locked && withoutLock(a) === withoutLock(b)) unlocks.push(c);
          else locked.push(c);
        }
        if (a && b && (a.kind === "track" || a.kind === "via" || a.kind === "zone") && a.net !== b.net) nets.push(c);
      }
      if (locked.length) return refused(id, "locked", `${locked.length} locked object${locked.length > 1 ? "s" : ""} would change (${locked.slice(0, 5).join(", ")}); agents and routers leave locked objects alone`, { ids: locked });
      if (unlocks.length) return refused(id, "needs-person", `unlocking ${unlocks.slice(0, 5).join(", ")} waits for a person`, { ids: unlocks });
      if (nets.length && actor.kind === "agent") return refused(id, "needs-person", `net changes from an agent wait for a person (${nets.slice(0, 5).join(", ")})`, { ids: nets });
      // operations only a person makes (a waiver): an agent's call waits for one
      const personOps = [...new Set(applied.filter((c) => getOperation(c.op)?.person).map((c) => c.op))];
      if (personOps.length) return refused(id, "needs-person", `${personOps.join(" and ")} from ${actor.kind === "agent" ? "an agent" : "a router"} waits for a person`, { ids: changed.slice(0, 50) });
    }
    if (!meta.replay && (actor.kind === "agent" || actor.kind === "router" || actor.kind === "host")) {
      // the person's live drag wins: writes into what they hold, or its halo, wait
      const held = holdBlocking(scopes);
      if (held) return refused(id, "held", `a person is dragging ${held.ids.slice(0, 5).join(", ")}${held.ids.length > 5 ? ", ..." : ""}; this transaction changes what they hold or its clearance halo: retry after the drag`, { hold: { ...held, holder: { ...held.holder }, ids: [...held.ids], layers: [...held.layers] }, retryAfterMs: Math.max(0, held.until - now()) });
      const other = leases.blocking(actor, scopes);
      if (other) return refused(id, "leased", `lease ${other.id} of ${other.holder.kind} ${other.holder.id} covers what this transaction changes until ${new Date(other.expiresAt).toISOString()} (its roots, nets, region and purpose are in lease, as data); reads stay open`, { lease: other });
      const fenced = leases.fence(actor, scopes, meta.leaseToken);
      if (fenced) return refused(id, "lease-revoked", fenced.message, fenced.lease ? { lease: fenced.lease } : {});
    }
    const created: Record<string, string> = { ...handles };
    const netlistChanged = before.netlist !== work.netlist && JSON.stringify(before.netlist ?? null) !== JSON.stringify(work.netlist ?? null);
    const extra = { ...(reports.length ? { reports } : {}), ...(netlistChanged ? { netlist: true as const } : {}) };
    if (meta.dryRun) return { status: "valid", batchId: id, epoch, seq, changed, created, removed, versions: Object.fromEntries(changed.map((c) => [c, version(c) + 1])), ...extra };
    if (!changed.length && !netlistChanged) {
      if (meta.leaseToken !== undefined) leases.renew(actor, meta.leaseToken);
      return { status: "applied", batchId: id, epoch, seq, changed, created, removed, versions: {}, ...extra };
    }
    // ---- commit
    doc = work;
    seq++;
    for (const c of changed) versions.set(c, version(c) + 1);
    const forward: OpCall[] = [];
    if (netlistChanged) forward.push({ op: "netlist.sync", netlist: work.netlist ?? null, rename: "none" });
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
      areas: scopes.filter((s) => s.box).map((s) => ({ box: s.box!, layers: s.layers })),
      ...(meta.baseSeq !== undefined ? { baseSeq: meta.baseSeq } : {}),
      ...(meta.leaseToken !== undefined ? { leaseToken: meta.leaseToken } : {}),
      ...(meta.undoOf !== undefined ? { undoOf: meta.undoOf } : {}),
      ...(meta.redoOf !== undefined ? { redoOf: meta.redoOf } : {}),
      ...(meta.revertOf !== undefined ? { revertOf: meta.revertOf } : {}),
      ...(netlistChanged ? { netlist: true as const } : {}),
      ...(meta.proposal !== undefined ? { proposal: meta.proposal } : {}),
    };
    entries.push(entry);
    if (entries.length > LOG_CAP) entries = entries.slice(-LOG_CAP);
    for (const c of changed) lastBy.set(c, entry);
    if (meta.changeSet) {
      const cs = changeSets.get(meta.changeSet.id) ?? { id: meta.changeSet.id, actors: [], entries: [] };
      if (meta.changeSet.title && !cs.title) cs.title = meta.changeSet.title;
      if (!cs.actors.some((a) => sameActor(a, actor))) cs.actors.push({ ...actor });
      cs.entries.push(seq);
      changeSets.set(cs.id, cs);
    }
    if (meta.leaseToken !== undefined) leases.renew(actor, meta.leaseToken);
    if (actor.kind === "agent" || actor.kind === "router") recent.set(`${actor.kind}:${actor.id}`, { actor: { ...actor }, label: meta.label, ids: changed.slice(0, 20), at: entry.time, from: "recent" });
    let revoked: EndedLease[] = [];
    let dropped = false;
    if (actor.kind === "human") {
      revoked = leases.revokeCovering(scopes, actor, `the person changed ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""}`);
      // the drop of a drag ends the person's hold on what it changed
      for (const [k, h] of holdTable) if (sameActor(h.holder, actor) && h.ids.some((x) => changed.includes(x))) dropped = holdTable.delete(k) || dropped;
    }
    for (const l of [...commitListeners]) {
      try {
        l({ entry, before, after: doc });
      } catch (e) {
        console.error("[board] a commit listener failed", e);
      }
    }
    if (revoked.length || dropped) emitLeases();
    return { status: "applied", batchId: id, epoch, seq, changed, created, removed, versions: Object.fromEntries(changed.map((c) => [c, version(c)])), ...extra, entry };
  }

  const strip = (r: Reply & { entry?: LogEntry }): Reply => {
    const { entry: _e, ...rest } = r;
    return rest as Reply;
  };

  function checkEnvelope(tx: Transaction): string | undefined {
    if (typeof tx?.batchId !== "string" || !tx.batchId || tx.batchId.length > 200 || !/^[\w.:-]+$/.test(tx.batchId)) return "batchId must be 1 to 200 letters, digits, '.', ':', '_' or '-'";
    const words = typeof tx.label === "string" ? tx.label.trim().split(/\s+/).filter(Boolean).length : 0;
    if (words < 3 || words > 8 || tx.label.length > 120) return "label must be 3 to 8 words saying what the transaction does";
    if (!Array.isArray(tx.ops) || tx.ops.length < 1 || tx.ops.length > MAX_OPS) return `ops must list 1 to ${MAX_OPS} operations`;
    if (tx.leaseToken !== undefined && !(Number.isInteger(tx.leaseToken) && tx.leaseToken > 0)) return "leaseToken must be the token a claim returned";
    if (tx.changeSet !== undefined && (typeof tx.changeSet?.id !== "string" || !/^[\w.:-]{1,120}$/.test(tx.changeSet.id) || (tx.changeSet.title !== undefined && (typeof tx.changeSet.title !== "string" || tx.changeSet.title.length > 120)))) return "changeSet is { id: 1 to 120 of letters, digits, '.', ':', '_', '-'; title?: up to 120 characters }";
    return undefined;
  }

  /**
   * The objects an entry changed that are no longer as it left them (changed again since). Compared by content, so
   * an actor's own chain of undos and redos does not make its earlier entries stale.
   */
  function changedSince(e: LogEntry): Conflict[] {
    const after = new Map<string, BoardRecord | undefined>();
    for (const op of e.forward) {
      if (op.op === "record.remove") for (const id of op.ids as string[]) after.set(id, undefined);
      else if (op.op === "record.put") for (const r of op.records as BoardRecord[]) after.set(r.id, r);
    }
    const out: Conflict[] = [];
    for (const [id, want] of after) {
      const now = doc.records.get(id);
      const same = want === now || (!!want && !!now && canonicalRecord(want) === canonicalRecord(now));
      if (!same) {
        const last = lastBy.get(id);
        out.push({ id, expected: e.touched[id] ?? 0, current: version(id), ...(last ? { by: { ...last.actor }, seq: last.seq } : {}) });
      }
    }
    return out;
  }

  const findUndoable =(actor: Actor) => [...entries].reverse().find((e) => sameActor(e.actor, actor) && e.undoOf === undefined && e.undoneBy === undefined && e.revertOf === undefined);
  function findRedoable(actor: Actor): LogEntry | undefined {
    for (const e of [...entries].reverse()) {
      if (!sameActor(e.actor, actor)) continue;
      if (e.redoOf !== undefined) continue;
      if (e.undoOf !== undefined) {
        if (e.redoneBy === undefined) return e;
        continue;
      }
      return undefined;
    }
    return undefined;
  }

  const engine: Engine = {
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
    versions(ids) {
      return Object.fromEntries((ids ?? [...versions.keys()].sort(byCodeUnit)).map((i) => [i, version(i)]));
    },
    hold(actor, claim) {
      if (actor.kind !== "human") return { status: "invalid", error: "only a person holds objects for a drag" };
      const ids = Array.isArray(claim?.ids) ? [...new Set(claim.ids.filter((x) => typeof x === "string"))] : [];
      if (!ids.length || ids.length > 5000) return { status: "invalid", error: "a hold names 1 to 5000 object ids" };
      let box: Box | undefined;
      const layers = new Set<string>();
      for (const hid of ids) {
        const r = doc.records.get(hid);
        if (!r) return { status: "invalid", error: `no object ${hid} on this board` };
        const b = boundsOf(r);
        if (b) box = box ? unionBox(box, b) : b;
        for (const l of layersOf(doc, r)) layers.add(l);
      }
      if (!box) return { status: "invalid", error: "the held objects have no place on the board" };
      const ttl = Math.min(HOLD_MAX_MS, Math.max(100, claim.ttlMs ?? HOLD_TTL_MS));
      const margin = claim.margin !== undefined && Number.isFinite(claim.margin) && claim.margin >= 0 ? Math.round(claim.margin) : defaultHoldMargin(doc);
      // the same person holding the same objects renews the hold
      const key = [...ids].sort(byCodeUnit).join("\n");
      let h = [...holdTable.values()].find((x) => sameActor(x.holder, actor) && [...x.ids].sort(byCodeUnit).join("\n") === key);
      if (h) Object.assign(h, { box, layers: [...layers].sort(byCodeUnit), margin, until: now() + ttl });
      else {
        h = { id: `hold.${epoch}.${++holdSerial}`, holder: { ...actor }, ids, box, layers: [...layers].sort(byCodeUnit), margin, until: now() + ttl };
        holdTable.set(h.id, h);
      }
      emitLeases();
      return { status: "held", hold: { ...h, holder: { ...h.holder }, ids: [...h.ids], layers: [...h.layers] } };
    },
    releaseHold(actor, hid) {
      const out: Hold[] = [];
      for (const [k, h] of holdTable) if (sameActor(h.holder, actor) && (hid === undefined || hid === k)) {
        holdTable.delete(k);
        out.push(h);
      }
      if (out.length) emitLeases();
      return out;
    },
    holds: () => liveHolds().map((h) => ({ ...h, holder: { ...h.holder }, ids: [...h.ids], layers: [...h.layers] })),
    pause(actor, options = {}) {
      if (actor.kind !== "human") return { status: "invalid", error: "only a person pauses agents and routers" };
      const reason = typeof options.reason === "string" ? options.reason.trim().slice(0, 200) : undefined;
      if (options.ttlMs !== undefined && !(Number.isFinite(options.ttlMs) && options.ttlMs > 0 && options.ttlMs <= 86_400_000)) return { status: "invalid", error: "ttlMs is a positive number of milliseconds, at most a day" };
      const t = now();
      pauseState = { by: { ...actor }, since: livePause()?.since ?? t, ...(reason ? { reason } : {}), ...(options.ttlMs !== undefined ? { until: t + Math.round(options.ttlMs) } : {}) };
      emitLeases();
      return { status: "paused", pause: copyPause(pauseState) };
    },
    resume(actor) {
      if (actor.kind !== "human") return { status: "invalid", error: "only a person resumes agents and routers" };
      const was = livePause();
      pauseState = undefined;
      if (was) emitLeases();
      return { status: "resumed", ...(was ? { was: copyPause(was) } : {}) };
    },
    paused: () => {
      const p = livePause();
      return p ? copyPause(p) : undefined;
    },
    apply(tx, actor, options = {}) {
      const bid = typeof tx?.batchId === "string" ? tx.batchId : "";
      const hit = bid ? replies.get(bid) : undefined;
      if (hit) return { ...hit, duplicate: true };
      const bad = checkEnvelope(tx);
      if (bad) return remember(bid, invalid(bid, bad));
      if (tx.provenance !== undefined && actor.kind !== "host" && actor.kind !== "router" && actor.kind !== "system") return remember(bid, invalid(bid, "only hosts, routers and the system give provenance"));
      // a dry run changes nothing and goes through a pause, as a proposal does
      const paused = tx.dryRun ? undefined : pausedFor(actor, bid);
      if (paused) return paused;
      if (tx.expectEpoch !== undefined && tx.expectEpoch !== epoch) return remember(bid, refused(bid, "stale-epoch", `the board service restarted (epoch ${epoch}, you read ${tx.expectEpoch}): re-read the board`));
      if (tx.expectSeq !== undefined) {
        if (!Number.isInteger(tx.expectSeq) || tx.expectSeq < 0) return remember(bid, invalid(bid, "expectSeq must be a seq number"));
        if (tx.expectSeq !== seq) return remember(bid, refused(bid, "stale-seq", `the board is at seq ${seq}; you read seq ${tx.expectSeq}`, { missed: missedSince(tx.expectSeq) }));
      }
      if (tx.expectVersions !== undefined) {
        if (!tx.expectVersions || typeof tx.expectVersions !== "object" || Object.values(tx.expectVersions).some((v) => !Number.isInteger(v) || v < 0)) return remember(bid, invalid(bid, "expectVersions maps ids to version numbers (0: must not exist)"));
        const conflicts = conflictsOf(tx.expectVersions).filter((c) => !(c.expected === 0 && !doc.records.has(c.id)));
        if (conflicts.length) {
          const from = Math.min(...conflicts.map((c) => c.seq ?? seq));
          return remember(bid, refused(bid, "stale-versions", `${conflicts.length} object${conflicts.length > 1 ? "s" : ""} changed since you read ${conflicts.length > 1 ? "them" : "it"} (see conflicts)`, { conflicts, missed: missedSince(from - 1, (e) => e.changed.some((c) => conflicts.some((k) => k.id === c))) }));
        }
      }
      if (tx.expectRegion !== undefined) {
        const r = tx.expectRegion;
        if (!r || typeof r !== "object" || !Number.isInteger(r.seq) || !r.box) return remember(bid, invalid(bid, "expectRegion is { box, layers?, seq }"));
        if (r.seq < seq && (!entries.length || entries[0].seq > r.seq + 1)) return remember(bid, refused(bid, "stale-region", `the log no longer reaches seq ${r.seq}: re-read the region`));
        const hits = entries.filter((e) => e.seq > r.seq && e.areas.some((a) => boxesMeet(a.box, r.box) && (!r.layers || !a.layers.length || a.layers.some((l) => r.layers!.includes(l)))));
        if (hits.length) return remember(bid, refused(bid, "stale-region", `${hits.length} change${hits.length > 1 ? "s" : ""} landed in your region since seq ${r.seq}`, { missed: hits.map((e) => ({ seq: e.seq, actor: { ...e.actor }, ...(e.batchId ? { batchId: e.batchId } : {}), label: e.label, changed: e.changed })) }));
      }
      const r = execute(actor, tx.ops, {
        batchId: bid,
        label: tx.label.trim(),
        internal: false,
        ...(tx.changeSet ? { changeSet: tx.changeSet } : {}),
        ...(tx.leaseToken !== undefined ? { leaseToken: tx.leaseToken } : {}),
        ...(tx.dryRun ? { dryRun: true } : {}),
        ...(tx.provenance ? { provenance: tx.provenance } : {}),
        ...(options.provenance ? { provenance: options.provenance } : {}),
        ...(options.edited ? { edited: options.edited } : {}),
        ...(options.lockCopper !== undefined ? { lockCopper: options.lockCopper } : {}),
        ...(options.proposal !== undefined ? { proposal: options.proposal } : {}),
        ...(tx.expectSeq !== undefined ? { baseSeq: tx.expectSeq } : {}),
      });
      // a dry run is not remembered: the same id may be sent again for real (nor a refusal that clears on its own)
      return tx.dryRun || transient(r) ? strip(r) : remember(bid, strip(r));
    },
    undo(actor, meta = {}) {
      const bid = meta.batchId ?? "";
      const hit = bid ? replies.get(bid) : undefined;
      if (hit) return { ...hit, duplicate: true };
      const pu = pausedFor(actor, bid);
      if (pu) return pu;
      const e = findUndoable(actor);
      if (!e) return remember(bid, refused(bid, "nothing-to-undo", `nothing of yours is left to undo (the log keeps the last ${LOG_CAP} entries)`));
      const conflicts = changedSince(e);
      if (conflicts.length) return remember(bid, refused(bid, "stale-undo", `your transaction at seq ${e.seq} cannot be undone: what it changed was changed again since (see conflicts)`, { conflicts, missed: missedSince(e.seq, (x) => x.changed.some((c) => c in e.touched)) }));
      const r = execute(actor, e.inverse, { batchId: bid, label: `undo: ${e.label}`.slice(0, 160), internal: true, undoOf: e.seq, ...(meta.leaseToken !== undefined ? { leaseToken: meta.leaseToken } : {}) });
      if (r.entry) e.undoneBy = r.entry.seq;
      return remember(bid, strip(r));
    },
    redo(actor, meta = {}) {
      const bid = meta.batchId ?? "";
      const hit = bid ? replies.get(bid) : undefined;
      if (hit) return { ...hit, duplicate: true };
      const pr = pausedFor(actor, bid);
      if (pr) return pr;
      const u = findRedoable(actor);
      if (!u) return remember(bid, refused(bid, "nothing-to-redo", "nothing of yours is left to redo (a new change of yours clears redo)"));
      const conflicts = changedSince(u);
      if (conflicts.length) return remember(bid, refused(bid, "stale-undo", `the undo at seq ${u.seq} cannot be redone: what it changed was changed again since (see conflicts)`, { conflicts }));
      const label = u.label.startsWith("undo: ") ? u.label.slice(6) : `redo: ${u.label}`;
      const r = execute(actor, u.inverse, { batchId: bid, label, internal: true, redoOf: u.seq, ...(meta.leaseToken !== undefined ? { leaseToken: meta.leaseToken } : {}) });
      if (r.entry) u.redoneBy = r.entry.seq;
      return remember(bid, strip(r));
    },
    revertChangeSet(actor, csId, meta = {}) {
      const bid = meta.batchId ?? "";
      const hit = bid ? replies.get(bid) : undefined;
      if (hit) return { ...hit, duplicate: true };
      const pv = pausedFor(actor, bid);
      if (pv) return pv;
      const list = entries.filter((e) => e.changeSet === csId && e.undoneBy === undefined && e.undoOf === undefined).reverse();
      if (!list.length) return remember(bid, refused(bid, "nothing-to-undo", `change set ${csId} has nothing left to revert in the log`));
      const mine = new Set(list.map((e) => e.seq));
      const conflicts: Conflict[] = [];
      for (const e of list)
        for (const c of Object.keys(e.touched)) {
          const last = lastBy.get(c);
          if (last && !mine.has(last.seq) && !conflicts.some((k) => k.id === c)) conflicts.push({ id: c, expected: e.touched[c], current: version(c), by: { ...last.actor }, seq: last.seq });
        }
      if (conflicts.length) return remember(bid, refused(bid, "stale-undo", `change set ${csId} cannot be reverted: ${conflicts.length} of its objects changed since (see conflicts)`, { conflicts }));
      const title = changeSets.get(csId)?.title ?? csId;
      const r = execute(
        actor,
        list.flatMap((e) => e.inverse),
        { batchId: bid, label: `revert: ${title}`.slice(0, 160), internal: true, revertOf: csId, ...(meta.leaseToken !== undefined ? { leaseToken: meta.leaseToken } : {}) },
      );
      if (r.entry) for (const e of list) e.undoneBy = r.entry.seq;
      return remember(bid, strip(r));
    },
    replay(ops, label) {
      return strip(execute(SYSTEM, ops, { batchId: "", label, internal: true, replay: true }));
    },
    claim(actor, claim) {
      const pc = pausedFor(actor, "");
      if (pc && pc.status === "refused") return { status: "refused", reason: "paused", pause: pc.pause!, ...(pc.retryAfterMs !== undefined ? { retryAfterMs: pc.retryAfterMs } : {}), message: pc.message };
      const c = leases.claim(actor, claim);
      if ("error" in c) return { status: "invalid", error: c.error };
      if ("refused" in c) return { status: "refused", reason: "leased", lease: c.refused, message: `lease ${c.refused.id} of ${c.refused.holder.kind} ${c.refused.holder.id} overlaps (see lease)` };
      emitLeases();
      return { status: "granted", lease: c.lease };
    },
    release(actor, leaseId) {
      const ended = leases.release(actor, leaseId);
      if (ended.length) emitLeases();
      return ended;
    },
    takeOver(by = HUMAN) {
      const ended = leases.revokeAll(by);
      if (ended.length) emitLeases();
      return ended;
    },
    presence() {
      const live = leases.live();
      const t = now();
      const intents: Intent[] = live.map((l) => ({ actor: { ...l.holder }, label: l.purpose, ids: [], at: l.grantedAt, from: "lease" as const }));
      for (const r of recent.values()) if (t - r.at <= INTENT_MS && !intents.some((i) => sameActor(i.actor, r.actor))) intents.push({ ...r, actor: { ...r.actor }, ids: [...r.ids] });
      const p = livePause();
      return { epoch, seq, leases: live, intents, holds: engine.holds(), ...(p ? { paused: copyPause(p) } : {}) };
    },
    log: (since) => (since === undefined ? [...entries] : entries.filter((e) => e.seq > since)),
    changeSets: () => [...changeSets.values()].map((c) => ({ ...c, actors: c.actors.map((a) => ({ ...a })), entries: [...c.entries] })),
    onCommit(l) {
      commitListeners.add(l);
      return () => void commitListeners.delete(l);
    },
    onLeases(l) {
      leaseListeners.add(l);
      return () => void leaseListeners.delete(l);
    },
  };
  return engine;
}

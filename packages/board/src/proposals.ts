/**
 * Proposal mode (contract docs/specs/pcb-editor/phase2-editing.md, section 4): change sets stored, not applied, until a
 * person accepts them (all or per item) as ordinary transactions of their own with the proposer's provenance kept.
 * A proposal goes stale when a commit changes what it touches or its clearance neighborhood. Validation and
 * previews run on a scratch engine over the live document; nothing here writes the board except an accept.
 */
import { byCodeUnit } from "./canonical.js";
import type { BoardDocument } from "./document.js";
import type { BoardCounts, ChangeSummary, Proposal, ProposalItem, ProposalPreview, ProposeInput, ProposeReply } from "./editing-types.js";
import { boundsOf, boxesMeet, inflate, layersOf } from "./geometry.js";
import type { Actor, OpCall } from "./ops/registry.js";
import type { BoardRecord, Provenance } from "./schema.js";
import { createEngine, defaultHoldMargin, provenanceFor, type Engine, type LogEntry, type Reply, type Transaction } from "./transaction.js";

/** A person seen by the scratch engine (proposals validate as the accept will run: a person keeping the proposer's provenance). */
const PREVIEWER: Actor = { kind: "human", id: "proposal-preview" };
const KEY = /^[A-Za-z0-9_.-]{1,40}$/;
/** DEFAULT: proposals kept in memory and on disk (the oldest closed ones go first). */
export const PROPOSAL_CAP = 500;

export const editedOf = (a: Actor): "hand" | "agent" | "routed" | undefined => (a.kind === "human" ? "hand" : a.kind === "agent" ? "agent" : a.kind === "router" ? "routed" : undefined);

function counts(doc: BoardDocument): BoardCounts {
  let tracks = 0,
    vias = 0;
  for (const r of doc.records.values()) {
    if (r.kind === "track") tracks++;
    else if (r.kind === "via") vias++;
  }
  return { records: doc.records.size, tracks, vias };
}

const trackLength = (r: BoardRecord | undefined) => (r?.kind === "track" ? Math.round(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y)) : 0);

function summarize(before: BoardDocument, after: BoardDocument, ids: Iterable<string>): ChangeSummary {
  const s: ChangeSummary = { added: {}, removed: {}, changed: {}, length: { added: 0, removed: 0 } };
  for (const id of ids) {
    const a = before.records.get(id);
    const b = after.records.get(id);
    if (!a && b) {
      s.added[b.kind] = (s.added[b.kind] ?? 0) + 1;
      s.length.added += trackLength(b);
    } else if (a && !b) {
      s.removed[a.kind] = (s.removed[a.kind] ?? 0) + 1;
      s.length.removed += trackLength(a);
    } else if (a && b) {
      s.changed[b.kind] = (s.changed[b.kind] ?? 0) + 1;
      const d = trackLength(b) - trackLength(a);
      if (d > 0) s.length.added += d;
      else s.length.removed -= d;
    }
  }
  return s;
}

/** Words of a label cut to the engine's 3 to 8 word rule. */
export function labelWords(prefix: string, title: string): string {
  const words = `${prefix} ${title}`.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length < 3) words.push(words.length === 1 ? "proposal" : "items");
  return words.join(" ").slice(0, 120);
}

/**
 * The item's operations with every handle prefixed, so several items apply in one transaction without their handles
 * colliding (`handle` fields, `$handle` references, and `track.route`'s default handle).
 */
export function prefixHandles(ops: OpCall[], prefix: string): OpCall[] {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key === "handle" && /^[A-Za-z0-9_]{1,40}$/.test(v)) return `${prefix}${v}`.slice(0, 40);
      const m = /^\$([A-Za-z0-9_]{1,40})$/.exec(v);
      return m ? `$${`${prefix}${m[1]}`.slice(0, 40)}` : v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return ops.map((op) => {
    const out = walk(op) as OpCall;
    if (op.op === "track.route" && out.handle === undefined) out.handle = `${prefix}r`;
    return out;
  });
}

/** Nets the copper of these records is on. */
function netsOf(doc: BoardDocument, ids: Iterable<string>, before: BoardDocument): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const d of [before, doc]) {
    const r = d.records.get(id) as { net?: string } | undefined;
    if (r?.net) out.add(r.net);
  }
  return [...out].sort(byCodeUnit);
}

interface Trial {
  ok: boolean;
  error?: string;
  item?: string;
  doc: BoardDocument;
  changed: Set<string>;
  created: Record<string, string>;
  entries: LogEntry[];
  perItem: { key: string; changed: string[]; doc: BoardDocument; before: BoardDocument }[];
}

/** Apply items in order on a scratch engine over `doc`, as a person keeping `provenance`. */
function trial(doc: BoardDocument, items: { key: string; label: string; ops: OpCall[] }[], provenance: Provenance, edited: "hand" | "agent" | "routed" | undefined): Trial {
  const scratch: Engine = createEngine(doc, { epoch: "scrtch", now: () => 0 });
  const out: Trial = { ok: true, doc, changed: new Set(), created: {}, entries: [], perItem: [] };
  for (const it of items) {
    const before = scratch.doc;
    const tx: Transaction = { batchId: `trial.${it.key}`, label: "try a proposal item", ops: it.ops };
    const r = scratch.apply(tx, PREVIEWER, { provenance, ...(edited ? { edited } : {}), lockCopper: false });
    if (r.status !== "applied") {
      return { ...out, ok: false, item: it.key, error: r.status === "invalid" ? `item ${it.key}: ${r.error}` : `item ${it.key}: ${(r as { message: string }).message}` };
    }
    for (const c of r.changed) out.changed.add(c);
    for (const [h, v] of Object.entries(r.created)) out.created[`${it.key}:${h}`] = v;
    out.perItem.push({ key: it.key, changed: r.changed, doc: scratch.doc, before });
  }
  out.doc = scratch.doc;
  out.entries = scratch.log();
  return out;
}

export interface ProposalHost {
  engine: Engine;
  now(): number;
  /** Persist one proposal (write its file); absent for an in-memory board. */
  persist?(p: Proposal): void;
  emit(change: "created" | "stale" | "accepted" | "partial" | "rejected", p: Proposal): void;
}

export class ProposalStore {
  private readonly list = new Map<string, Proposal>();
  private serial = 0;

  constructor(private readonly host: ProposalHost) {
    host.engine.onCommit(({ entry }) => this.onCommit(entry));
  }

  /** Proposals left by an earlier session: their seqs are of another epoch, so open ones are stale. */
  load(old: Proposal[]): void {
    for (const p of old) {
      if (this.list.has(p.id)) continue;
      if (p.status === "open") {
        p.status = "stale";
        p.stale = { seq: 0, actor: { kind: "system", id: "board" }, changed: [] };
        for (const it of p.items) if (it.status === "open") it.status = "stale";
      }
      this.list.set(p.id, p);
    }
  }

  all(filter: { status?: Proposal["status"] } = {}): Proposal[] {
    return [...this.list.values()].filter((p) => !filter.status || p.status === filter.status).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  }

  get(id: string): Proposal | undefined {
    return this.list.get(id);
  }

  private store(p: Proposal): void {
    this.list.set(p.id, p);
    if (this.list.size > PROPOSAL_CAP) {
      const closed = [...this.list.values()].filter((x) => x.status !== "open").sort((a, b) => a.createdAt - b.createdAt);
      for (const x of closed.slice(0, this.list.size - PROPOSAL_CAP)) this.list.delete(x.id);
    }
    this.host.persist?.(p);
  }

  propose(actor: Actor, input: ProposeInput, extra: { source?: Proposal["source"]; reason?: string } = {}): ProposeReply {
    const engine = this.host.engine;
    if (actor.kind === "system") return { status: "invalid", error: "the system does not propose" };
    const words = typeof input?.title === "string" ? input.title.trim().split(/\s+/).filter(Boolean).length : 0;
    if (words < 3 || words > 12 || input.title.length > 160) return { status: "invalid", error: "title must be 3 to 12 words saying what the proposal does" };
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) return { status: "invalid", error: "items must list 1 to 200 items" };
    if (input.provenance !== undefined && actor.kind !== "router" && actor.kind !== "host") return { status: "invalid", error: "only routers and hosts give provenance" };
    if (input.expectSeq !== undefined && input.expectSeq !== engine.seq) return { status: "invalid", error: `the board is at seq ${engine.seq}; the proposal was computed on seq ${input.expectSeq}: recompute it` };
    const items: { key: string; label: string; ops: OpCall[] }[] = [];
    const keys = new Set<string>();
    for (const [i, it] of input.items.entries()) {
      const key = it?.key ?? `i${i}`;
      if (!KEY.test(key) || keys.has(key)) return { status: "invalid", error: `item ${i}: key must be unique, 1 to 40 of letters, digits, _ . -` };
      keys.add(key);
      if (!Array.isArray(it.ops) || !it.ops.length || it.ops.length > 200) return { status: "invalid", error: `item ${key}: ops must list 1 to 200 operations`, item: key };
      if (typeof it.label !== "string" || !it.label.trim() || it.label.length > 160) return { status: "invalid", error: `item ${key}: label is a short sentence`, item: key };
      items.push({ key, label: it.label.trim(), ops: it.ops });
    }
    const provenance = input.provenance ?? provenanceFor(actor);
    const edited = editedOf(actor);
    const base = engine.doc;
    // every item alone, then all together
    for (const it of items) {
      const t = trial(base, [it], provenance, edited);
      if (!t.ok) return { status: "invalid", error: t.error!, item: it.key };
    }
    const all = trial(base, items, provenance, edited);
    if (!all.ok) return { status: "invalid", error: `the items do not apply together: ${all.error}`, ...(all.item ? { item: all.item } : {}) };
    const margin = defaultHoldMargin(base);
    const areas: Proposal["areas"] = [];
    for (const id of all.changed)
      for (const d of [base, all.doc]) {
        const r = d.records.get(id);
        const b = r ? boundsOf(r) : undefined;
        if (r && b) areas.push({ box: inflate(b, margin), layers: layersOf(d, r) as string[] });
      }
    const id = `p.${engine.epoch}.${++this.serial}`;
    const proposalItems: ProposalItem[] = items.map((it) => {
      const one = all.perItem.find((x) => x.key === it.key)!;
      return { key: it.key, label: it.label, ops: it.ops, status: "open", nets: netsOf(one.doc, one.changed, one.before), summary: summarize(one.before, one.doc, one.changed) };
    });
    const p: Proposal = {
      id,
      title: input.title.trim(),
      actor: { ...actor },
      source: extra.source ?? (actor.kind === "human" ? "person" : actor.kind === "router" ? "router" : actor.kind === "host" ? "host" : "agent"),
      base: { epoch: engine.epoch, seq: engine.seq },
      status: "open",
      items: proposalItems,
      summary: summarize(base, all.doc, all.changed),
      before: counts(base),
      after: counts(all.doc),
      touched: [...all.changed].sort(byCodeUnit),
      areas,
      ...(input.scores ? { scores: input.scores } : {}),
      provenance,
      changeSet: input.changeSet ?? { id: `proposal.${id}`, title: input.title.trim().slice(0, 120) },
      ...(extra.reason ? { reason: extra.reason } : {}),
      createdAt: this.host.now(),
    };
    this.store(p);
    this.host.emit("created", p);
    return { status: "proposed", proposal: p };
  }

  preview(id: string, options: { items?: string[] } = {}): ProposalPreview | undefined {
    const p = this.list.get(id);
    if (!p) return undefined;
    const engine = this.host.engine;
    const items = p.items.filter((it) => (options.items ? options.items.includes(it.key) : it.status === "open" || it.status === "stale"));
    const base = engine.doc;
    const t = trial(base, items, p.provenance, editedOf(p.actor));
    const out: ProposalPreview = { id, seq: engine.seq, stale: p.status === "stale", valid: t.ok, created: t.created, added: [], removed: [], changed: [] };
    if (!t.ok) return { ...out, error: t.error };
    for (const c of [...t.changed].sort(byCodeUnit)) {
      const a = base.records.get(c);
      const b = t.doc.records.get(c);
      if (!a && b) out.added.push(b);
      else if (a && !b) out.removed.push(a);
      else if (a && b) out.changed.push({ before: a, after: b });
    }
    return out;
  }

  accept(actor: Actor, id: string, options: { items?: string[]; allowStale?: boolean; batchId?: string } = {}): Reply & { proposalState?: Proposal } {
    const engine = this.host.engine;
    const bid = options.batchId ?? `accept.${id}.${engine.seq}`;
    const base = { batchId: bid, epoch: engine.epoch, seq: engine.seq };
    const p = this.list.get(id);
    if (actor.kind !== "human") return { status: "refused", ...base, reason: "not-a-person", message: "only a person accepts a proposal" };
    if (!p) return { status: "invalid", ...base, error: `no proposal ${id}` };
    if (p.status === "stale" && !options.allowStale) return { status: "refused", ...base, reason: "stale-proposal", message: `proposal ${id} is stale: the board changed under it at seq ${p.stale?.seq ?? "?"}; pass allowStale to revalidate and apply it, or ask for a fresh proposal`, proposalState: p };
    const want = options.items ? new Set(options.items) : undefined;
    if (want) for (const k of want) if (!p.items.some((it) => it.key === k)) return { status: "invalid", ...base, error: `proposal ${id} has no item ${k}` };
    const items = p.items.filter((it) => (!want || want.has(it.key)) && (it.status === "open" || (options.allowStale && it.status === "stale")));
    if (!items.length) return { status: "invalid", ...base, error: `proposal ${id} has no open items to accept${want ? " among those named" : ""}` };
    const ops = items.flatMap((it, k) => prefixHandles(it.ops, items.length > 1 ? `${it.key.replace(/[^A-Za-z0-9_]/g, "_")}_${k}_` : ""));
    const tx: Transaction = { batchId: bid, label: labelWords("accept", p.title), ops, changeSet: p.changeSet };
    const r = engine.apply(tx, actor, { provenance: p.provenance, ...(editedOf(p.actor) ? { edited: editedOf(p.actor) } : {}), lockCopper: false, proposal: p.id });
    if (r.status !== "applied" || r.duplicate) return { ...r, proposalState: p };
    for (const it of items) {
      it.status = "accepted";
      it.acceptedSeq = r.seq;
    }
    this.settle(p);
    this.store(p);
    this.host.emit(p.status === "accepted" ? "accepted" : "partial", p);
    return { ...r, proposalState: p };
  }

  reject(actor: Actor, id: string, options: { items?: string[]; reason?: string } = {}): { status: "rejected"; proposal: Proposal } | { status: "invalid"; error: string } {
    const p = this.list.get(id);
    if (!p) return { status: "invalid", error: `no proposal ${id}` };
    const own = actor.kind === p.actor.kind && actor.id === p.actor.id;
    if (actor.kind !== "human" && !own) return { status: "invalid", error: "only a person, or the proposer withdrawing it, rejects a proposal" };
    let n = 0;
    for (const it of p.items) if ((!options.items || options.items.includes(it.key)) && (it.status === "open" || it.status === "stale")) {
      it.status = "rejected";
      n++;
    }
    if (!n) return { status: "invalid", error: `proposal ${id} has nothing left to reject` };
    p.rejected = { by: { ...actor }, ...(options.reason ? { reason: options.reason.slice(0, 500) } : {}) };
    this.settle(p);
    this.store(p);
    this.host.emit("rejected", p);
    return { status: "rejected", proposal: p };
  }

  /** The proposal's status from its items. */
  private settle(p: Proposal): void {
    const open = p.items.filter((it) => it.status === "open" || it.status === "stale");
    if (open.length) return;
    const acc = p.items.filter((it) => it.status === "accepted").length;
    p.status = acc === p.items.length ? "accepted" : acc ? "partial" : "rejected";
  }

  /** A commit makes open proposals stale when it changes what they touch or lands in their neighborhood. */
  private onCommit(entry: LogEntry): void {
    for (const p of this.list.values()) {
      if (p.status !== "open" && !(p.items.some((it) => it.status === "open"))) continue;
      if (entry.proposal === p.id) continue;
      const hitIds = entry.changed.filter((c) => p.touched.includes(c));
      const hitArea = !hitIds.length && entry.areas.some((a) => p.areas.some((q) => boxesMeet(a.box, q.box) && (!a.layers.length || !q.layers.length || a.layers.some((l) => q.layers.includes(l)))));
      if (!hitIds.length && !hitArea && !entry.netlist) continue;
      p.status = "stale";
      p.stale = { seq: entry.seq, actor: { ...entry.actor }, changed: entry.changed.slice(0, 50) };
      for (const it of p.items) if (it.status === "open") it.status = "stale";
      this.store(p);
      this.host.emit("stale", p);
    }
  }
}

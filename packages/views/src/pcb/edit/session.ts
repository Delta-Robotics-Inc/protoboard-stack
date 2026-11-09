/**
 * The page's side of editing (browser): a `BoardSource` the layout screen draws, layered over the host's read-only
 * feed (`RemoteBoardSource`). It shows the person's own gesture at once and reconciles with the board service:
 *
 * - `preview(ops)` draws a gesture in progress (a drag) on top of the board without sending anything;
 * - `commit(label, ops)` sends one transaction through the host (`request`) and keeps drawing it optimistically
 *   until the feed's board reaches the seq the service applied it at; a refusal takes it off the board and is
 *   reported plainly (`onStatus`);
 * - `undo`, `redo`, saves and the rest are requests whose effects come back through the feed.
 *
 * The overlay is computed with the core's own transaction engine on a copy of the confirmed board (the same
 * operations the service applies, as a person), so what the person sees while it is in flight is what the service
 * will do. `showAt(seq)` replays the board at an earlier seq, read only, until `live()`.
 *
 * Who acts is the host's decision: nothing here names an actor.
 */
import { BoardIndex, createEngine, getOperation, snapshotFromWire, withChanges, type BoardDocument, type BoardEvent, type BoardRecord, type BoardSnapshot, type LogEntry, type Presence } from "../board.js";
import type { BoardDerived, BoardReplyMessage, BoardRequest, BoardSource, PageOpCall, PageTransaction } from "../types.js";

export type RequestFn = (req: BoardRequest) => Promise<BoardReplyMessage>;

/** A region precondition (the kernel's, for a route): refused `stale-region` when copper there changed since `seq`. */
export interface ExpectRegion {
  box: { minX: number; minY: number; maxX: number; maxY: number };
  layers?: string[];
  seq: number;
}

/** What came of a write, in plain words. */
export interface Outcome {
  ok: boolean;
  status: "applied" | "valid" | "refused" | "invalid" | "error";
  reason?: string;
  /** For people: what happened and what to do. */
  message: string;
  label: string;
  seq?: number;
  batchId?: string;
  reply?: unknown;
  at: number;
}

/** A transaction sent and not yet in the feed's board. */
interface Pending {
  batchId: string;
  label: string;
  ops: PageOpCall[];
  /** The seq the service applied it at (once the reply came). */
  seq?: number;
  epoch?: string;
  /** Ids it changes on the overlay (from the local apply). */
  ids: string[];
}

export interface SessionStatus {
  writable: boolean;
  /** Transactions sent and not yet back on the feed. */
  pending: number;
  /** The last write's outcome (refusals stay until the next write). */
  last?: Outcome;
  replay?: { seq: number; loading: boolean; error?: string };
}

const PLAIN: Record<string, string> = {
  "stale-epoch": "The board was reopened while you worked; your change was not applied. Try it again.",
  "stale-seq": "The board changed under you; your change was not applied. Try it again.",
  "stale-versions": "Someone changed what you edited first; your change was not applied. Try it again.",
  "stale-region": "Copper near your edit changed first; your change was not applied. Try it again.",
  leased: "An agent holds this area (a lease). Take over to edit it, or wait for it to finish.",
  "lease-revoked": "The lease was taken back; the change was not applied.",
  locked: "Locked: unlock it first.",
  "needs-person": "This needs a person.",
  "stale-undo": "Your undo would overwrite a later change, so it was not done.",
  "nothing-to-undo": "Nothing of yours is left to undo (undo only takes back your own changes).",
  "nothing-to-redo": "Nothing of yours is left to redo.",
  held: "A person is dragging there; try again in a moment.",
};

let batchN = 0;
/** A batch id no other page or process will send. */
export function newBatchId(prefix = "ui"): string {
  return `${prefix}-${Date.now().toString(36)}-${(++batchN).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The plain outcome of a host's reply to a write. */
export function outcomeOf(label: string, r: BoardReplyMessage, batchId?: string): Outcome {
  const at = Date.now();
  if (!r.ok) return { ok: false, status: "error", message: r.error, label, at, ...(batchId ? { batchId } : {}) };
  const x = r.result as { status?: string; reason?: string; message?: string; error?: string; seq?: number; batchId?: string } | undefined;
  if (!x || typeof x !== "object" || !x.status) return { ok: true, status: "applied", message: "done", label, reply: x, at };
  const base = { label, at, reply: x, ...(x.seq !== undefined ? { seq: x.seq } : {}), ...(x.batchId || batchId ? { batchId: x.batchId || batchId } : {}) };
  if (x.status === "applied" || x.status === "valid") return { ...base, ok: true, status: x.status, message: x.status === "valid" ? "valid (dry run)" : "applied" };
  if (x.status === "refused") return { ...base, ok: false, status: "refused", ...(x.reason ? { reason: x.reason } : {}), message: `${PLAIN[x.reason ?? ""] ?? "Refused."}${x.message ? ` (${x.message})` : ""}` };
  return { ...base, ok: false, status: "invalid", message: `Not valid: ${x.error ?? "the service did not take it"}` };
}

function makeSnapshot(epoch: string, seq: number, doc: BoardDocument, version: (id: string) => number): BoardSnapshot {
  let index: BoardIndex | undefined;
  return {
    epoch,
    seq,
    doc,
    version,
    get query() {
      return (index ??= BoardIndex.build(doc));
    },
  };
}

const PERSON = { kind: "human" as const, id: "page-preview" };

/** Apply ops on a copy as a person would (the service's own engine); the document after and the ids changed. */
export function applyLocally(doc: BoardDocument, txs: readonly { ops: readonly PageOpCall[] }[]): { doc: BoardDocument; ids: string[][]; failed: number[] } {
  if (!txs.length) return { doc, ids: [], failed: [] };
  const engine = createEngine(doc, { epoch: "pgdraf", now: () => 0 });
  const ids: string[][] = [];
  const failed: number[] = [];
  txs.forEach((t, i) => {
    const r = engine.apply({ batchId: `local-${i}`, label: "a gesture in progress", ops: t.ops.map((o) => ({ ...o })) }, PERSON);
    if (r.status === "applied") ids.push([...r.changed, ...Object.values(r.created), ...r.removed]);
    else {
      ids.push([]);
      failed.push(i);
    }
  });
  return { doc: engine.doc, ids, failed };
}

/** Whether the page's copy of the core knows an operation (a Phase 2 operation may not be built yet). */
export const hasOperation = (name: string): boolean => !!getOperation(name);
/** Whether an operation takes this input (for options added later, such as `footprint.move`'s `tracks: "attached"`). */
export function takesInput(name: string, input: Record<string, unknown>): boolean {
  const d = getOperation(name);
  return !!d && d.input.safeParse(input).success;
}

export class EditSession implements BoardSource {
  private base: BoardSnapshot;
  private shown: BoardSnapshot;
  private pending: Pending[] = [];
  private draft: PageOpCall[] | undefined;
  /** A kernel drag's preview: the records after the drag (the planner's own output), drawn over the board. */
  private recordDraft: { puts: readonly BoardRecord[]; removes: readonly string[] } | undefined;
  private overlayIds = new Set<string>();
  private replayState: { seq: number; snapshot?: BoardSnapshot; derived?: BoardDerived; loading: boolean; error?: string } | undefined;
  private readonly listeners = new Set<(e: BoardEvent) => void>();
  private readonly statusListeners = new Set<(s: SessionStatus) => void>();
  private last: Outcome | undefined;
  private readonly unsub: () => void;

  constructor(
    private readonly remote: BoardSource,
    private readonly send?: RequestFn,
  ) {
    this.base = remote.snapshot();
    this.shown = this.base;
    this.unsub = remote.subscribe((e) => this.onRemote(e));
  }

  get writable(): boolean {
    return !!this.send && !this.replayState;
  }
  /** The board as the service has it (no overlay). */
  confirmed(): BoardSnapshot {
    return this.base;
  }
  snapshot(): BoardSnapshot {
    return this.replayState?.snapshot ?? this.shown;
  }
  subscribe(listener: (e: BoardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  presence(): Presence | undefined {
    return this.remote.presence?.();
  }
  log(since?: number): LogEntry[] | undefined {
    return this.remote.log?.(since);
  }
  status(): SessionStatus {
    return { writable: this.writable, pending: this.pending.length, ...(this.last ? { last: this.last } : {}), ...(this.replayState ? { replay: { seq: this.replayState.seq, loading: this.replayState.loading, ...(this.replayState.error ? { error: this.replayState.error } : {}) } } : {}) };
  }
  onStatus(listener: (s: SessionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => void this.statusListeners.delete(listener);
  }
  /** The derived data of the replayed seq (checks, ratsnest), when replaying. */
  replayDerived(): BoardDerived | undefined {
    return this.replayState?.derived;
  }
  dispose(): void {
    this.unsub();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  // ------------------------------------------------------------------ gestures

  /** Draw a gesture in progress (nothing is sent); undefined ends it. Returns false when the ops do not apply. */
  preview(ops: PageOpCall[] | undefined): boolean {
    if (this.replayState) return false;
    this.draft = ops;
    return this.recompute([]);
  }

  /**
   * Draw a kernel drag's candidate (records after the drag, from the same planner the operation runs) over the
   * board; nothing is sent. Empty puts and removes end it.
   */
  previewRecords(puts: readonly BoardRecord[], removes: readonly string[]): void {
    if (this.replayState) return;
    this.draft = undefined;
    this.recordDraft = puts.length || removes.length ? { puts, removes } : undefined;
    this.recompute([]);
  }

  /** Send one transaction (one gesture) and draw it until the service's answer and the feed agree. */
  async commit(label: string, ops: PageOpCall[], options: { expectFor?: string[]; changeSet?: { id: string; title?: string }; dryRun?: boolean; expectEpoch?: string; expectRegion?: ExpectRegion } = {}): Promise<Outcome> {
    if (!this.send) return this.report({ ok: false, status: "error", message: "This host does not take edits (read only).", label, at: Date.now() });
    if (this.replayState) return this.report({ ok: false, status: "error", message: "Replaying an earlier version: return to the live board to edit.", label, at: Date.now() });
    const batchId = newBatchId();
    this.draft = undefined;
    this.recordDraft = undefined;
    const tx: PageTransaction & { expectRegion?: ExpectRegion } = { batchId, label, ops, ...(options.changeSet ? { changeSet: options.changeSet } : {}), ...(options.dryRun ? { dryRun: true } : {}), ...(options.expectEpoch ? { expectEpoch: options.expectEpoch } : {}), ...(options.expectRegion ? { expectRegion: options.expectRegion } : {}) };
    if (options.expectFor?.length) {
      const exp: Record<string, number> = {};
      for (const id of options.expectFor) exp[id] = this.base.version(id) + this.pending.filter((p) => p.ids.includes(id)).length;
      tx.expectVersions = exp;
    }
    const p: Pending = { batchId, label, ops, ids: [] };
    if (!options.dryRun) this.pending.push(p);
    this.recompute([]);
    this.emitStatus();
    let r: BoardReplyMessage;
    try {
      r = await this.send({ method: "apply", tx });
    } catch (e) {
      r = { ok: false, error: `the host did not answer: ${(e as Error).message}` };
    }
    const out = outcomeOf(label, r, batchId);
    if (out.ok && out.status === "applied") {
      p.seq = out.seq;
      p.epoch = (out.reply as { epoch?: string } | undefined)?.epoch;
      this.settle();
    } else this.drop(batchId);
    return this.report(out);
  }

  async undo(): Promise<Outcome> {
    return this.simple("undo", { method: "undo", batchId: newBatchId("undo") });
  }
  async redo(): Promise<Outcome> {
    return this.simple("redo", { method: "redo", batchId: newBatchId("redo") });
  }

  /** Any other request (save, checkpoint, routes, waivers): the reply, with errors reported. */
  async request(req: BoardRequest, label: string = req.method): Promise<BoardReplyMessage> {
    if (!this.send) {
      const r: BoardReplyMessage = { ok: false, error: "This host does not take requests (read only)." };
      this.report(outcomeOf(label, r));
      return r;
    }
    let r: BoardReplyMessage;
    try {
      r = await this.send(req);
    } catch (e) {
      r = { ok: false, error: `the host did not answer: ${(e as Error).message}` };
    }
    if (!r.ok) this.report(outcomeOf(label, r));
    return r;
  }

  private async simple(label: string, req: BoardRequest): Promise<Outcome> {
    if (this.replayState) return this.report({ ok: false, status: "error", message: "Replaying an earlier version: return to the live board first.", label, at: Date.now() });
    if (!this.send) return this.report({ ok: false, status: "error", message: "This host does not take edits (read only).", label, at: Date.now() });
    let r: BoardReplyMessage;
    try {
      r = await this.send(req);
    } catch (e) {
      r = { ok: false, error: `the host did not answer: ${(e as Error).message}` };
    }
    return this.report(outcomeOf(label, r));
  }

  // ------------------------------------------------------------------ replay

  /** Show the board at an earlier seq, read only (the host rebuilds it from its log). */
  async showAt(seq: number): Promise<void> {
    if (seq >= this.base.seq) return this.live();
    if (!this.send) return;
    this.draft = undefined;
    this.recordDraft = undefined;
    this.replayState = { seq, loading: true };
    this.emitStatus();
    const r = await this.send({ method: "at", seq });
    if (!this.replayState || this.replayState.seq !== seq) return;
    if (!r.ok) {
      this.replayState = { seq, loading: false, error: r.error };
      this.emitStatus();
      return;
    }
    const res = r.result as { snapshot: { epoch: string; seq: number; records: never[]; netlist?: never; versions: Record<string, number> }; derived?: BoardDerived };
    this.replayState = { seq, snapshot: snapshotFromWire(res.snapshot), ...(res.derived ? { derived: res.derived } : {}), loading: false };
    this.emit({ type: "external-change", files: [] });
    this.emitStatus();
  }

  /** Back to the live board. */
  live(): void {
    if (!this.replayState) return;
    this.replayState = undefined;
    this.emit({ type: "external-change", files: [] });
    this.emitStatus();
  }

  // ------------------------------------------------------------------ internals

  private onRemote(e: BoardEvent): void {
    if (e.type === "commit" || e.type === "external-change") {
      this.base = this.remote.snapshot();
      // the feed can bring a commit before the host's reply to it: it is known by its batch id
      if (e.type === "commit" && e.entry.batchId) {
        const p = this.pending.find((x) => x.batchId === e.entry.batchId);
        if (p) {
          p.seq = e.seq;
          p.epoch = e.epoch;
        }
      }
      const ids = e.type === "commit" ? [...e.changed, ...Object.values(e.created), ...e.removed] : undefined;
      this.settle(ids, e);
      return;
    }
    this.emit(e);
  }

  /** Drop pending transactions the feed's board already holds, and redraw. */
  private settle(ids?: string[], e?: BoardEvent): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => !(p.seq !== undefined && (p.epoch === undefined || p.epoch === this.base.epoch) && p.seq <= this.base.seq) && !(p.epoch !== undefined && p.epoch !== this.base.epoch));
    if (e?.type === "external-change") {
      this.recompute(undefined);
      this.emit(e);
    } else this.recompute(ids ?? [], e);
    if (before !== this.pending.length) this.emitStatus();
  }

  private drop(batchId: string): void {
    this.pending = this.pending.filter((p) => p.batchId !== batchId);
    this.recompute([]);
    this.emitStatus();
  }

  /** Rebuild the shown board: the confirmed one plus pending writes plus the gesture. `extra` undefined: a reload. */
  private recompute(extra: string[] | undefined, event?: BoardEvent): boolean {
    const txs = [...this.pending.map((p) => ({ ops: p.ops })), ...(this.draft ? [{ ops: this.draft }] : [])];
    const r = applyLocally(this.base.doc, txs);
    this.pending.forEach((p, i) => (p.ids = r.ids[i] ?? []));
    const ok = !(this.draft && r.failed.includes(txs.length - 1));
    const now = new Set(r.ids.flat());
    let doc = r.doc;
    if (this.recordDraft) {
      const rd = this.recordDraft;
      // a removed record that the board no longer has (a pending write took it) is not removed twice
      doc = withChanges(doc, rd.puts, rd.removes.filter((id) => doc.records.has(id)));
      for (const p of rd.puts) now.add(p.id);
      for (const id of rd.removes) now.add(id);
    }
    const touched = new Set<string>([...this.overlayIds, ...now, ...(extra ?? [])]);
    this.overlayIds = now;
    const base = this.base;
    this.shown = txs.length || this.recordDraft ? makeSnapshot(base.epoch, base.seq, doc, (id) => base.version(id)) : base;
    if (extra === undefined) return ok;
    if (this.replayState) return ok;
    const ev: BoardEvent =
      event?.type === "commit"
        ? { ...event, changed: [...touched] }
        : { type: "commit", epoch: base.epoch, seq: base.seq, entry: { seq: base.seq, actor: PERSON, label: "draft" }, changed: [...touched], created: {}, removed: [] };
    this.emit(ev);
    return ok;
  }

  private report(o: Outcome): Outcome {
    this.last = o;
    this.emitStatus();
    return o;
  }

  private emit(e: BoardEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
  private emitStatus(): void {
    const s = this.status();
    for (const l of [...this.statusListeners]) l(s);
  }
}

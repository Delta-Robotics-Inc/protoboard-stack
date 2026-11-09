/**
 * One schematic's feed for pages (Node): the host is the schematic service's client (a live `protoboard schematic
 * serve` through its service.json, else the schematic opened in this process) and hands pages `SchematicFeedMessage`s:
 * the page model first, then each commit's changed items (drawn by the schematic package's renderer), the derived
 * score, defects and findings, saves and checkpoints. A page's requests are applied as a person; agents act through
 * the service themselves (MCP tools, the CLI) as agent actors.
 *
 * First open: a folder with no schematic yet is laid out once in memory (a host transaction, so a person's undo
 * history starts clean) and nothing is written until a person saves. Closing the feed never saves; what a person
 * changed and did not save stays in the journal, and the next open replays it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupPass,
  connectSchematic,
  diffDrawn,
  drawGhost,
  emptySchematic,
  ghostDiff,
  HUMAN,
  localClient,
  openSchematicService,
  proposeFixes,
  type SchematicCircuit,
  type SchematicClient,
  type SchematicEvent,
  type SchematicService,
  type SchematicSnapshot,
  type Transaction,
  type Reply,
} from "@protoboardai/schematic/node";
import type { Actor, OpCall } from "@protoboardai/board";
import { commitBoardFolder } from "../../pcb/host/git.js";
import type { PageCleanup, PageFix, PageLogEntry, SchematicFeedMessage, SchematicReply, SchematicRequest } from "../types.js";
import { fieldCalls, mirrorCalls, moveCalls, orthogonalize, rotateCalls } from "./gestures.js";
import { boundsOfDoc, derivedOf, itemOf, junctionsOfDoc, modelOf, partsOf, plain } from "./model.js";

/** The actor a person at a host's screen acts as. */
export const SCHEMATIC_PERSON: Actor = HUMAN;
/** The agent a cleanup pass runs as (the core's cleanup agent, in the wire's form of an agent id). */
export const CLEANUP: Actor = { kind: "agent", id: "agent:cleanup", name: "cleanup" };
/** Who lays out a schematic on its first open (a host, so a person's undo starts with their own edits). */
export const FIRST_OPEN: Actor = { kind: "host", id: "host:schematic-screen", name: "schematic screen" };

export interface SchematicFeedOptions {
  dir: string;
  key: string;
  name?: string;
  /** the circuit from UHD for this folder */
  circuit: () => SchematicCircuit | Promise<SchematicCircuit>;
  projectRoot?: string;
  log?: (line: string) => void;
  /** DEFAULT 40 ms: derived data waits this long after a commit, so a burst of commits is scored once. */
  debounceMs?: number;
}

const entryOf = (e: { seq: number; label: string; actor: Actor; changeSet?: string; undoOf?: number; redoOf?: number; changed: unknown[] | number }): PageLogEntry => ({
  seq: e.seq,
  label: e.label,
  actor: { kind: e.actor.kind, id: e.actor.id, ...(e.actor.name ? { name: e.actor.name } : {}) },
  ...(e.changeSet ? { changeSet: e.changeSet } : {}),
  ...(e.undoOf !== undefined ? { undoOf: e.undoOf } : {}),
  ...(e.redoOf !== undefined ? { redoOf: e.redoOf } : {}),
  changed: typeof e.changed === "number" ? e.changed : e.changed.length,
});

/** Labels the engine takes: 3 to 8 words. */
export function txLabel(words: string): string {
  const w = words.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  while (w.length < 3) w.push(w.length === 1 ? "by" : "hand");
  return w.join(" ");
}

let batch = 0;
const batchId = (what: string) => `page-${what}-${Date.now().toString(36)}-${(++batch).toString(36)}`;

export class SchematicFeed {
  private readonly listeners = new Set<(m: SchematicFeedMessage) => void>();
  private snap: SchematicSnapshot;
  private firstOpen = false;
  private saved: number | undefined;
  private log: PageLogEntry[] = [];
  private derivedTimer: ReturnType<typeof setTimeout> | undefined;
  private lastDerived: SchematicFeedMessage | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly previews = new Map<string, { seq: number; budget: number; cleanup: PageCleanup }>();
  private unsub: () => void;
  private closed = false;

  private constructor(
    private readonly o: SchematicFeedOptions,
    private readonly client: SchematicClient,
    private readonly own: SchematicService | undefined,
    first: SchematicSnapshot,
    private readonly circuit: SchematicCircuit,
  ) {
    this.snap = first;
    this.unsub = client.subscribe((e) => void this.enqueue(() => this.onEvent(e)));
  }

  /** Open a feed: the live service when one runs, else the schematic opened here (laid out in memory on a first open). */
  static async open(o: SchematicFeedOptions): Promise<SchematicFeed> {
    const circuit = await o.circuit();
    const hasFiles = existsSync(join(o.dir, "schematic.jsonl"));
    let client = await connectSchematic(o.dir, { mode: "service", circuit, ...(o.projectRoot ? { projectRoot: o.projectRoot } : {}) }).catch(() => undefined);
    let own: SchematicService | undefined;
    if (!client) {
      own = openSchematicService({ dir: o.dir, circuit, ...(hasFiles ? {} : { document: emptySchematic(circuit, o.name) }), ...(o.projectRoot ? { projectRoot: o.projectRoot } : {}) });
      if (own.recoverable() > 0) {
        const r = own.recover();
        o.log?.(`schematic ${o.key}: replayed ${r.replayed} unsaved transaction(s) from the journal`);
      }
      client = localClient(own, { closeService: false });
    }
    let snap = await client.snapshot();
    const empty = ![...snap.doc.records.values()].some((r) => r.kind === "symbol");
    const feed = new SchematicFeed(o, client, own, snap, circuit);
    if (empty && circuit.parts.length) {
      const r = await client.apply({ batchId: batchId("first-open"), label: "lay out the whole sheet", ops: [{ op: "layout.run", scope: "all", mode: "fresh" }] }, FIRST_OPEN);
      if (r.status !== "applied") o.log?.(`schematic ${o.key}: the first layout did not apply (${r.status === "invalid" ? r.error : r.status === "refused" ? r.message : r.status})`);
      snap = await client.snapshot();
      feed.snap = snap;
      feed.firstOpen = !hasFiles;
    }
    feed.log = (await client.log()).map(entryOf);
    return feed;
  }

  get mode(): "service" | "local" {
    return this.client.mode;
  }
  get subscribers(): number {
    return this.listeners.size;
  }
  get dir(): string {
    return this.o.dir;
  }
  /** The document as the feed last read it (tests, the dev page). */
  snapshot(): SchematicSnapshot {
    return this.snap;
  }

  subscribe(listener: (m: SchematicFeedMessage) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", key: this.o.key, model: modelOf(this.snap.doc, this.snap, { firstOpen: this.firstOpen }), log: this.log, ...(this.saved !== undefined ? { saved: this.saved } : {}), mode: this.client.mode });
    if (this.lastDerived) listener(this.lastDerived);
    else this.scheduleDerived(0);
    return () => void this.listeners.delete(listener);
  }

  private emit(m: SchematicFeedMessage) {
    for (const l of [...this.listeners]) {
      try {
        l(m);
      } catch (e) {
        this.o.log?.(`schematic feed: a subscriber failed (${(e as Error).message})`);
      }
    }
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async onEvent(e: SchematicEvent) {
    if (this.closed) return;
    if (e.type === "commit") {
      const before = this.snap.doc;
      this.snap = await this.client.snapshot();
      const doc = this.snap.doc;
      const puts = [];
      const removes: string[] = [];
      let symbols = false;
      for (const id of e.changed) {
        const r = doc.records.get(id);
        if (r?.kind === "symbol" || before.records.get(id)?.kind === "symbol") symbols = true;
        const it = r ? itemOf(doc, r) : undefined;
        if (it) puts.push(it);
        else removes.push(id);
      }
      const entry = entryOf({ ...e.entry, changed: e.changed.length });
      this.log = [...this.log, entry].slice(-500);
      this.emit({ type: "commit", key: this.o.key, seq: this.snap.seq, epoch: this.snap.epoch, entry, puts, removes, junctions: junctionsOfDoc(doc), bounds: boundsOfDoc(doc), ...(symbols ? { parts: partsOf(doc) } : {}) });
      this.scheduleDerived();
    } else if (e.type === "saved") {
      this.saved = e.seq;
      this.firstOpen = false;
      this.emit({ type: "saved", key: this.o.key, seq: e.seq, files: e.files });
    } else if (e.type === "presence") {
      this.emit({ type: "presence", key: this.o.key, leases: e.presence.leases.map((l) => ({ holder: l.holder.name ?? l.holder.id, purpose: l.purpose, expiresAt: l.expiresAt })) });
    } else if (e.type === "external-change") {
      this.snap = await this.client.snapshot();
      this.emit({ type: "snapshot", key: this.o.key, model: modelOf(this.snap.doc, this.snap), log: this.log, mode: this.client.mode });
    }
  }

  private scheduleDerived(ms = this.o.debounceMs ?? 40) {
    clearTimeout(this.derivedTimer);
    this.derivedTimer = setTimeout(() => void this.enqueue(() => this.sendDerived()), ms);
    this.derivedTimer.unref?.();
  }

  private async sendDerived() {
    if (this.closed) return;
    const t0 = performance.now();
    const doc = this.snap.doc;
    const [score, findings] = [await this.client.score(), await this.client.checks()];
    const d = derivedOf(doc, score, findings.map((f) => ({ ...f, message: plain(doc, f.message) })), this.snap.seq, performance.now() - t0);
    this.lastDerived = { type: "derived", key: this.o.key, derived: d };
    this.emit(this.lastDerived);
  }

  private async tx(label: string, ops: OpCall[]): Promise<SchematicReply> {
    if (!ops.length) return { ok: false, error: "nothing to change" };
    const r = await this.client.apply({ batchId: batchId("tx"), label: txLabel(label), ops } as Transaction, SCHEMATIC_PERSON);
    return replyOf(r);
  }

  private refOf(id: string): string {
    const r = this.snap.doc.records.get(id) as { ref?: string; kind?: string; net?: string } | undefined;
    return r?.ref ?? (r?.net ? `${r.kind} ${r.net}` : id.replace(/^[a-z]+:/, ""));
  }
  private what(ids: string[]): string {
    return ids.length === 1 ? this.refOf(ids[0]) : `${ids.length} items`;
  }

  /** A write by another actor through this feed's service (dev pages and tests stand in for an agent this way; real agents use the service's own tools). */
  applyAs(tx: Transaction, actor: Actor): Promise<SchematicReply> {
    return this.enqueue(async () => replyOf(await this.client.apply(tx, actor)));
  }

  /** A page's request, applied as a person. */
  request(req: SchematicRequest): Promise<SchematicReply> {
    return this.enqueue(async () => {
      try {
        return await this.handle(req);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    });
  }

  private async handle(req: SchematicRequest): Promise<SchematicReply> {
    const doc = (this.snap = await this.client.snapshot()).doc;
    switch (req.method) {
      case "apply":
        return replyOf(await this.client.apply({ ...req.tx, label: txLabel(req.tx.label) } as Transaction, SCHEMATIC_PERSON));
      case "move":
        return this.tx(`move ${this.what(req.ids)} by hand`, moveCalls(doc, req.ids, Math.round(req.dx), Math.round(req.dy)));
      case "rotate":
        return this.tx(`rotate ${this.what(req.ids)} by hand`, rotateCalls(doc, req.ids, req.angle));
      case "mirror":
        return this.tx(`mirror ${this.what(req.ids)} by hand`, mirrorCalls(doc, req.ids));
      case "moveField":
        return this.tx(`move the fields of ${this.refOf(req.id)}`, fieldCalls(doc, req.id, Math.round(req.dx), Math.round(req.dy)));
      case "drawWire": {
        const pts = orthogonalize(req.points);
        if (pts.length < 2) return { ok: false, error: "a wire needs two points apart" };
        return this.tx(`draw a wire on ${req.net}`, [{ op: "wire.add", wires: [{ net: req.net, card: req.card, points: pts }] }]);
      }
      case "editWire": {
        const pts = orthogonalize(req.points);
        if (pts.length < 2) return this.tx("delete a wire by hand", [{ op: "wire.delete", ids: [req.id] }]);
        return this.tx("reshape a wire by hand", [{ op: "wire.edit", id: req.id, points: pts }]);
      }
      case "undo":
        return replyOf(await this.client.undo(SCHEMATIC_PERSON, { batchId: batchId("undo") }));
      case "redo":
        return replyOf(await this.client.redo(SCHEMATIC_PERSON, { batchId: batchId("redo") }));
      case "save": {
        const r = await this.client.save();
        this.saved = r.seq;
        this.firstOpen = false;
        if (!r.written.length) this.emit({ type: "saved", key: this.o.key, seq: r.seq, files: [] });
        return r.refused.length ? { ok: false, error: `changed on disk by someone else, not overwritten: ${r.refused.join(", ")}` } : { ok: true, status: "saved", seq: r.seq, message: r.written.length ? `saved ${r.written.join(", ")}` : "nothing new to save" };
      }
      case "checkpoint": {
        const r = await this.client.checkpoint(req.label);
        this.saved = r.seq;
        if (r.refused.length) return { ok: false, error: `changed on disk by someone else: ${r.refused.join(", ")}` };
        let committed: string | undefined;
        let error: string | undefined;
        try {
          committed = (await commitBoardFolder(this.o.dir, r.message)).commit;
        } catch (e) {
          error = (e as Error).message.replace(/board folder/g, "schematic folder");
        }
        this.emit({ type: "checkpoint", key: this.o.key, seq: r.seq, label: req.label, ...(committed ? { committed } : {}), ...(error ? { error } : {}) });
        return { ok: true, status: "checkpoint", seq: r.seq, ...(committed ? { committed } : {}), ...(error ? { message: error } : {}) };
      }
      case "fixes":
        return { ok: true, fixes: this.fixes(req.defect) };
      case "acceptFix": {
        const f = this.fixes(req.defect)[req.index];
        if (!f) return { ok: false, error: "that fix is no longer offered (the sheet changed); list the fixes again" };
        return this.tx(`accept the fix for ${f.rule}`, f.ops as OpCall[]);
      }
      case "cleanupPreview": {
        const budget = Math.max(1, Math.min(200, req.budget ?? 60));
        const scratch = openSchematicService({ document: doc, circuit: this.circuit });
        const res = cleanupPass(scratch, { budget, actor: CLEANUP });
        const after = scratch.snapshot().doc;
        scratch.close({ save: false });
        const id = `cleanup-${this.snap.seq}-${Date.now().toString(36)}`;
        const cleanup: PageCleanup = {
          id,
          before: { score: res.before.score, gates: res.before.gates },
          after: { score: res.after.score, gates: res.after.gates },
          passes: res.passes,
          steps: res.steps.map((s) => ({ ...s, title: plain(doc, s.title) })),
          stopped: res.stopped,
          ghost: drawGhost(doc, diffDrawn(doc, after), { label: id }),
        };
        this.previews.set(id, { seq: this.snap.seq, budget, cleanup });
        return { ok: true, cleanup };
      }
      case "cleanupApply": {
        const p = this.previews.get(req.id);
        if (!p) return { ok: false, error: "no such cleanup preview; run it again" };
        if (p.seq !== this.snap.seq) return { ok: false, error: "the sheet changed since this preview; run the cleanup again" };
        const res = await this.client.cleanupPass(CLEANUP, { budget: p.budget, changeSet: { id: req.id, title: "cleanup pass accepted by a person" } });
        p.cleanup.applied = { changeSet: res.changeSet.id, seq: (await this.client.snapshot()).seq };
        (p as { result?: unknown }).result = res;
        return { ok: true, status: "applied", cleanup: p.cleanup, message: `${res.changeSet.transactions} fix(es), score ${res.before.score} to ${res.after.score}` };
      }
      case "cleanupRevert": {
        const p = this.previews.get(req.id) as ({ result?: { changeSet: { id: string; title: string; transactions: number; ops: number } } } & { cleanup: PageCleanup }) | undefined;
        if (!p?.result) return { ok: false, error: "that cleanup was not applied here" };
        const n = await this.client.revertCleanup(CLEANUP, p.result.changeSet);
        this.previews.delete(req.id);
        return { ok: true, status: "reverted", message: `${n} transaction(s) undone` };
      }
    }
  }

  private fixes(defect: string): PageFix[] {
    const doc = this.snap.doc;
    return proposeFixes(doc, defect, { max: 4 }).map((c, index) => {
      let ghost = "";
      try {
        ghost = drawGhost(doc, ghostDiff(doc, { ops: c.ops }), { label: `fix-${index}` });
      } catch {
        // a candidate the document refuses draws no ghost (proposeFixes already left those out)
      }
      return { index, title: plain(doc, c.title), rule: c.rule, ops: c.ops as PageFix["ops"], before: c.predicted.before, after: c.predicted.after, delta: c.predicted.delta, resolved: c.predicted.resolved, ghost };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.derivedTimer);
    this.unsub();
    this.listeners.clear();
    await this.queue.catch(() => undefined);
    // never saves: unsaved changes stay in the journal for the next open
    if (this.own) this.own.close({ save: false });
    else await this.client.close();
  }
}

function replyOf(r: Reply): SchematicReply {
  if (r.status === "applied" || r.status === "valid") return { ok: true, status: r.status, seq: r.seq };
  if (r.status === "refused") return { ok: false, status: "refused", error: r.message };
  return { ok: false, status: "invalid", error: (r as { error?: string }).error ?? "invalid" };
}

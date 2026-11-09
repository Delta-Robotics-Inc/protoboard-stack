/**
 * The board service (contract section 10): the single owner of one live board. It holds the transaction engine,
 * the query index and the journal, saves the board files on request, and tells subscribers what changed. The
 * editor tab, the CLI, MCP tools, routers and importers are all its clients; a wire transport (the CLI's
 * `protoboard board serve`) exposes the same calls over JSON-RPC.
 */
import { join, resolve } from "node:path";
import type { BoardDocument } from "./document.js";
import { filesHash, loadBoardDir, writeBoardDir } from "./format.js";
import { BoardIndex, type BoardQuery } from "./index-spatial.js";
import { boardLocalDir, findProjectRoot } from "./paths.js";
import { acquireOwnerLock, BoardJournal, pendingEntries, type JournalLine } from "./journal.js";
import type { EndedLease, LeaseClaim } from "./leases.js";
import type { Actor } from "./ops/registry.js";
import { createEngine, HUMAN, type ChangeSetInfo, type ClaimReply, type Engine, type LogEntry, type Presence, type Reply, type Transaction } from "./transaction.js";
import { BOARD_FILES, type BoardFile, type Netlist } from "./schema.js";

export interface BoardSnapshot {
  epoch: string;
  seq: number;
  doc: BoardDocument;
  /** An object's version at this snapshot (0: absent and never seen). */
  version(id: string): number;
  query: BoardQuery;
}

export type BoardEvent =
  | { type: "commit"; epoch: string; seq: number; entry: { seq: number; actor: Actor; label: string; batchId?: string; changeSet?: string; undoOf?: number; redoOf?: number }; changed: string[]; created: Record<string, string>; removed: string[] }
  | { type: "presence"; presence: Presence }
  | { type: "saved"; seq: number; files: BoardFile[] }
  | { type: "external-change"; files: BoardFile[] };

export interface SaveResult {
  seq: number;
  written: BoardFile[];
  unchanged: BoardFile[];
  /** Changed on disk by someone else since the service read or wrote them: not overwritten. */
  refused: BoardFile[];
  /** The hash of the board files on disk after the save. */
  files: string;
}

export interface CheckpointResult extends SaveResult {
  label: string;
  /** A commit message built from the change sets since the last checkpoint. The caller commits. */
  message: string;
}

export interface BoardServiceOptions {
  /** The board folder. Absent: an in-memory board (`document` required; save is refused). */
  dir?: string;
  document?: BoardDocument;
  /** Default: the nearest folder at or above `dir` with protoboard.config.ts, else the parent of `dir` (state never lands inside a board folder). */
  projectRoot?: string;
  netlist?: Netlist;
  /** Default true when there is a folder. */
  journal?: boolean;
  /** Default true when there is a folder. */
  ownerLock?: boolean;
  now?: () => number;
  epoch?: string;
  journalMaxBytes?: number;
}

export interface BoardService {
  readonly epoch: string;
  readonly seq: number;
  readonly dir: string | undefined;
  /** The ignored local folder for this board (journal, lock, service.json). */
  readonly localDir: string | undefined;
  snapshot(): BoardSnapshot;
  readonly query: BoardQuery;
  apply(tx: Transaction, actor: Actor): Reply;
  undo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  redo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  revertChangeSet(actor: Actor, id: string, meta?: { batchId?: string; leaseToken?: number }): Reply;
  claim(actor: Actor, claim: LeaseClaim): ClaimReply;
  release(actor: Actor, leaseId?: string): EndedLease[];
  takeOver(by?: Actor): EndedLease[];
  presence(): Presence;
  log(since?: number): LogEntry[];
  changeSets(): ChangeSetInfo[];
  subscribe(listener: (e: BoardEvent) => void): () => void;
  save(): SaveResult;
  checkpoint(label: string): CheckpointResult;
  /** Journal entries from an earlier session not in the files on disk (recover() replays them). */
  recoverable(): number;
  recover(): { replayed: number; seq: number };
  close(options?: { save?: boolean }): void;
}

export { boardBuildDir, boardKey, boardLocalDir, findProjectRoot, STATE_DIR } from "./paths.js";

export function openBoardService(options: BoardServiceOptions): BoardService {
  const dir = options.dir ? resolve(options.dir) : undefined;
  if (!dir && !options.document) throw new Error("openBoardService needs a board folder (dir) or a document");
  const projectRoot = dir ? (options.projectRoot ? resolve(options.projectRoot) : findProjectRoot(dir)) : undefined;
  const localDir = dir && projectRoot ? boardLocalDir(projectRoot, dir) : undefined;
  const lock = localDir && (options.ownerLock ?? true) ? acquireOwnerLock(join(localDir, "owner.lock"), { dir }) : undefined;
  let texts: Record<BoardFile, string | undefined>;
  let initial: BoardDocument;
  try {
    if (dir) {
      const loaded = loadBoardDir(dir, options.netlist ? { netlist: options.netlist } : {});
      initial = options.document ?? loaded.doc;
      texts = loaded.texts;
    } else {
      initial = options.document!;
      texts = Object.fromEntries(BOARD_FILES.map((f) => [f, undefined])) as Record<BoardFile, string | undefined>;
    }
  } catch (e) {
    lock?.release();
    throw e;
  }
  const engine: Engine = createEngine(initial, { ...(options.now ? { now: options.now } : {}), ...(options.epoch ? { epoch: options.epoch } : {}) });
  const journal = localDir && (options.journal ?? true) ? new BoardJournal(join(localDir, "journal.jsonl"), options.journalMaxBytes ? { maxBytes: options.journalMaxBytes } : {}) : undefined;
  const hashNow = () => filesHash(texts);
  // entries an earlier session committed but never saved (read before this session writes its own open line)
  let pending: Extract<JournalLine, { t: "entry" }>[] = journal ? pendingEntries(journal.read(), hashNow()) : [];
  journal?.open(engine.epoch, 0, hashNow());

  let index = BoardIndex.build(initial);
  let snap: BoardSnapshot | undefined;
  const listeners = new Set<(e: BoardEvent) => void>();
  let lastCheckpointSeq = 0;
  let closed = false;

  const emit = (e: BoardEvent) => {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("[board] a subscriber failed", err);
      }
    }
  };

  engine.onCommit(({ entry, after }) => {
    journal?.entry(engine.epoch, entry);
    index = index.update(after, entry.changed);
    snap = undefined;
    emit({
      type: "commit",
      epoch: engine.epoch,
      seq: entry.seq,
      entry: { seq: entry.seq, actor: { ...entry.actor }, label: entry.label, ...(entry.batchId ? { batchId: entry.batchId } : {}), ...(entry.changeSet ? { changeSet: entry.changeSet } : {}), ...(entry.undoOf !== undefined ? { undoOf: entry.undoOf } : {}), ...(entry.redoOf !== undefined ? { redoOf: entry.redoOf } : {}) },
      changed: entry.changed,
      created: entry.created,
      removed: entry.removed,
    });
  });
  engine.onLeases(() => emit({ type: "presence", presence: engine.presence() }));

  const live = () => {
    if (closed) throw new Error("this board service is closed");
  };

  const snapshot = (): BoardSnapshot => {
    if (snap && snap.seq === engine.seq) return snap;
    const doc = engine.doc;
    const versions = engine.versions();
    const myIndex = index;
    const s: BoardSnapshot = {
      epoch: engine.epoch,
      seq: engine.seq,
      doc,
      version: (id) => versions[id] ?? 0,
      // the live index while this snapshot is current; a private one for an older snapshot
      get query(): BoardQuery {
        return engine.seq === s.seq && index === myIndex ? index : (privateIndex ??= BoardIndex.build(doc));
      },
    };
    let privateIndex: BoardIndex | undefined;
    snap = s;
    return s;
  };

  const save = (): SaveResult => {
    live();
    if (!dir) throw new Error("an in-memory board has no folder to save to");
    const expected = Object.fromEntries(BOARD_FILES.map((f) => [f, texts[f] ?? null])) as Record<BoardFile, string | null>;
    const r = writeBoardDir(dir, engine.doc, expected);
    for (const f of [...r.written, ...r.unchanged]) texts[f] = r.texts[f];
    const files = hashNow();
    if (r.refused.length) emit({ type: "external-change", files: r.refused });
    else journal?.saved(engine.epoch, engine.seq, files);
    if (r.written.length) emit({ type: "saved", seq: engine.seq, files: r.written });
    return { seq: engine.seq, written: r.written, unchanged: r.unchanged, refused: r.refused, files };
  };

  const service: BoardService = {
    get epoch() {
      return engine.epoch;
    },
    get seq() {
      return engine.seq;
    },
    dir,
    localDir,
    snapshot,
    get query() {
      return index;
    },
    apply(tx, actor) {
      live();
      return engine.apply(tx, actor);
    },
    undo(actor, meta) {
      live();
      return engine.undo(actor, meta);
    },
    redo(actor, meta) {
      live();
      return engine.redo(actor, meta);
    },
    revertChangeSet(actor, id, meta) {
      live();
      return engine.revertChangeSet(actor, id, meta);
    },
    claim: (actor, claim) => engine.claim(actor, claim),
    release: (actor, leaseId) => engine.release(actor, leaseId),
    takeOver: (by = HUMAN) => engine.takeOver(by),
    presence: () => engine.presence(),
    log: (since) => engine.log(since),
    changeSets: () => engine.changeSets(),
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    save,
    checkpoint(label) {
      const r = save();
      const since = engine.log(lastCheckpointSeq);
      const sets = engine.changeSets().filter((c) => c.entries.some((s) => s > lastCheckpointSeq));
      const loose = since.filter((e) => !e.changeSet);
      const who = (actors: Actor[]) => [...new Set(actors.map((a) => (a.kind === "human" ? "person" : `${a.kind} ${a.name ?? a.id}`)))].join(", ");
      const lines = [label.trim() || "board checkpoint", ""];
      for (const c of sets) lines.push(`- ${c.title ?? c.id} (${who(c.actors)}): ${c.entries.filter((s) => s > lastCheckpointSeq).length} transaction(s)`);
      if (loose.length) lines.push(`- other edits (${who(loose.map((e) => e.actor))}): ${loose.length} transaction(s)`);
      if (since.length) lines.push("", `Board seq ${since[0].seq} to ${since[since.length - 1].seq}, epoch ${engine.epoch}.`);
      const message = lines.join("\n");
      if (!r.refused.length) {
        journal?.checkpoint(engine.epoch, engine.seq, label, r.files);
        lastCheckpointSeq = engine.seq;
      }
      return { ...r, label, message };
    },
    recoverable: () => pending.length,
    recover() {
      live();
      let replayed = 0;
      for (const e of pending) {
        const r = engine.replay(e.forward, `recover: ${e.label}`.slice(0, 160));
        if (r.status !== "applied") throw new Error(`journal recovery stopped at seq ${e.seq}: ${r.status === "invalid" ? r.error : r.status}`);
        replayed++;
      }
      pending = [];
      return { replayed, seq: engine.seq };
    },
    close(opts = {}) {
      if (closed) return;
      try {
        if (dir && (opts.save ?? true)) save();
      } finally {
        closed = true;
        listeners.clear();
        lock?.release();
      }
    },
  };
  return service;
}

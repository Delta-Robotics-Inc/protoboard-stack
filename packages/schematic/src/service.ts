/**
 * The schematic service (contract section 10, after the board core's section 10): the single owner of one live
 * schematic. It holds the engine (transactions, per-actor undo, change sets, leases), the journal, caches the score
 * and the checks per seq, saves the files when asked (never per transaction), and tells subscribers about commits,
 * presence and saves. The CLI's `protoboard schematic serve`, the editor host and the tests are its clients; the
 * wire transport (`serveSchematic`, `connectSchematic` in `@protoboardai/schematic/node`) exposes the same calls.
 * Reload on external change follows the board core and is not built (contract section 15).
 */
import { join, relative, resolve } from "node:path";
import { acquireOwnerLock, findProjectRoot, type Actor, type EndedLease, type LeaseClaim } from "@protoboardai/board";
import { electricalChecks, type SchematicFinding } from "./checks.ts";
import type { SchematicCircuit } from "./circuit.ts";
import { createSchematic, withCircuit, type SchematicDocument } from "./document.ts";
import { createSchematicEngine, HUMAN, type ChangeSetInfo, type ClaimReply, type LogEntry, type Reply, type SchematicEngine, type SchematicPresence, type Transaction } from "./engine.ts";
import { loadSchematicDir, writeSchematicDir, type WriteResult } from "./format.ts";
import { SchematicJournal, schematicFilesHash, type JournaledEntry } from "./journal.ts";
import { describeSchematic, type DescribeOptions, type DescribeResult } from "./scene.ts";
import { SCHEMATIC_FILES, type SchematicFile, type SchematicRecord } from "./schema.ts";
import { scoreSchematic, type Score } from "./score.ts";
import { DEFAULT_SETTINGS } from "./layout/index.ts";

/** One commit as subscribers see it. */
export interface SchematicCommitEntry {
  seq: number;
  actor: Actor;
  label: string;
  batchId?: string;
  changeSet?: string;
  undoOf?: number;
  redoOf?: number;
}

export type SchematicEvent =
  | { type: "commit"; epoch: string; seq: number; entry: SchematicCommitEntry; changed: string[]; created: Record<string, string>; removed: string[] }
  | { type: "presence"; presence: SchematicPresence }
  | { type: "saved"; seq: number; files: SchematicFile[] }
  | { type: "external-change"; files: SchematicFile[] };

export interface SchematicSnapshot {
  epoch: string;
  seq: number;
  doc: SchematicDocument;
  /** An object's version at this snapshot (0: absent and never seen). */
  version(id: string): number;
}

export interface SchematicSaveResult extends WriteResult {
  seq: number;
  /** Files whose content was already on disk. */
  unchanged: SchematicFile[];
  /** The hash of the schematic files on disk after the save (what the journal's markers carry). */
  files: string;
}

export interface SchematicCheckpointResult extends SchematicSaveResult {
  label: string;
  /** A commit message built from the change sets since the last checkpoint. The caller commits. */
  message: string;
}

export interface SchematicServiceOptions {
  /** the schematic folder (`<module folder>/schematic`) */
  dir?: string;
  /** or an in-memory document (no folder: save is refused); with a folder, the document to start from instead of the files */
  document?: SchematicDocument;
  /** the circuit from UHD */
  circuit: SchematicCircuit;
  /** Default: the nearest folder at or above `dir` with protoboard.config.ts, else the folder's parent. */
  projectRoot?: string;
  /** default true when there is a folder */
  ownerLock?: boolean;
  /** default true when there is a folder */
  journal?: boolean;
  journalMaxBytes?: number;
  epoch?: string;
  now?: () => number;
}

export interface SchematicService {
  readonly epoch: string;
  readonly seq: number;
  /** The schematic folder (absent for an in-memory schematic). */
  readonly dir: string | undefined;
  /** The ignored local folder for this schematic (journal, lock, service.json, proposals). */
  readonly localDir: string | undefined;
  snapshot(): SchematicSnapshot;
  apply(tx: Transaction, actor: Actor): Reply;
  undo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  redo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Reply;
  revertChangeSet(actor: Actor, id: string, meta?: { batchId?: string; leaseToken?: number }): Reply;
  claim(actor: Actor, claim: LeaseClaim): ClaimReply;
  release(actor: Actor, leaseId?: string): EndedLease[];
  takeOver(by?: Actor): EndedLease[];
  presence(): SchematicPresence;
  log(since?: number): LogEntry[];
  changeSets(): ChangeSetInfo[];
  score(): Score;
  checks(): SchematicFinding[];
  scene(options?: DescribeOptions): DescribeResult;
  subscribe(listener: (e: SchematicEvent) => void): () => void;
  save(): SchematicSaveResult;
  checkpoint(label: string): SchematicCheckpointResult;
  /** Journal entries of an earlier session not in the files on disk (`recover()` replays them). */
  recoverable(): number;
  recover(): { replayed: number; seq: number };
  close(options?: { save?: boolean }): void;
}

/** `<key>`: the schematic folder's path from the project root with `/` as `__`. */
export function schematicKey(projectRoot: string, dir: string): string {
  return relative(projectRoot, resolve(dir)).split(/[\\/]/).filter(Boolean).join("__") || "schematic";
}

/** `.protoboard/local/schematic/<key>/`: the key is the folder's path from the project root with `/` as `__`. */
export function schematicLocalDir(projectRoot: string, dir: string): string {
  return join(projectRoot, ".protoboard", "local", "schematic", schematicKey(projectRoot, dir));
}

/** `.protoboard/build/schematic/<key>/`: renders, scenes and exports. */
export function schematicBuildDir(projectRoot: string, dir: string): string {
  return join(projectRoot, ".protoboard", "build", "schematic", schematicKey(projectRoot, dir));
}

/** A schematic with nothing laid out yet: the `schematic` record named after the board, and the circuit. */
export function emptySchematic(circuit: SchematicCircuit, name?: string): SchematicDocument {
  const head: SchematicRecord = { kind: "schematic", id: "schematic", name: (name ?? circuit.board).slice(0, 200) || "schematic", source: { board: circuit.board, hash: "" }, settings: { ...DEFAULT_SETTINGS } };
  return createSchematic([head], circuit);
}

export function openSchematicService(o: SchematicServiceOptions): SchematicService {
  const dir = o.dir ? resolve(o.dir) : undefined;
  const root = dir ? (o.projectRoot ? resolve(o.projectRoot) : findProjectRoot(dir)) : undefined;
  const localDir = dir && root ? schematicLocalDir(root, dir) : undefined;
  let hashes: Partial<Record<SchematicFile, string>> = {};
  let initial: SchematicDocument;
  if (o.document) initial = withCircuit(o.document, o.circuit);
  else if (dir) {
    const l = loadSchematicDir(dir, o.circuit, localDir ? { localDir } : {});
    initial = l.doc;
    hashes = l.hashes;
  } else throw new Error("openSchematicService needs a folder or a document");
  const lock = dir && localDir && o.ownerLock !== false ? acquireOwnerLock(join(localDir, "owner.lock"), { dir }) : undefined;
  const engine: SchematicEngine = createSchematicEngine(initial, { ...(o.epoch ? { epoch: o.epoch } : {}), ...(o.now ? { now: o.now } : {}) });
  const journal = localDir && (o.journal ?? true) ? new SchematicJournal(join(localDir, "journal.jsonl"), o.journalMaxBytes ? { maxBytes: o.journalMaxBytes } : {}) : undefined;
  const hashNow = () => schematicFilesHash(hashes);
  // entries an earlier session committed but never saved (read before this session writes its own open line)
  let pending: JournaledEntry[] = [];
  try {
    pending = journal ? journal.pending(hashNow()) : [];
    journal?.open(engine.epoch, 0, hashNow());
  } catch (e) {
    lock?.release();
    throw e;
  }
  const listeners = new Set<(e: SchematicEvent) => void>();
  const emit = (e: SchematicEvent) => {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("[schematic] a subscriber failed", err);
      }
    }
  };
  engine.onCommit(({ entry }) => {
    journal?.entry(engine.epoch, entry);
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
  let cache: { seq: number; score?: Score; checks?: SchematicFinding[] } = { seq: -1 };
  const cached = () => {
    if (cache.seq !== engine.seq) cache = { seq: engine.seq };
    return cache;
  };
  let snap: SchematicSnapshot | undefined;
  let lastCheckpointSeq = 0;
  let closed = false;
  const live = () => {
    if (closed) throw new Error("this schematic service is closed");
  };
  const save = (): SchematicSaveResult => {
    live();
    if (!dir) throw new Error("this schematic has no folder; save is refused");
    const r = writeSchematicDir(dir, engine.doc, { expected: hashes, ...(localDir ? { localDir } : {}) });
    hashes = { ...hashes, ...r.hashes };
    const files = hashNow();
    const all: SchematicFile[] = [...SCHEMATIC_FILES, ...(localDir ? (["proposals"] as const) : [])];
    const unchanged = all.filter((f) => !r.written.includes(f) && !r.refused.includes(f));
    if (r.refused.length) emit({ type: "external-change", files: r.refused });
    else journal?.saved(engine.epoch, engine.seq, files);
    if (r.written.length) emit({ type: "saved", seq: engine.seq, files: r.written });
    return { ...r, seq: engine.seq, unchanged, files };
  };
  const svc: SchematicService = {
    get epoch() {
      return engine.epoch;
    },
    get seq() {
      return engine.seq;
    },
    dir,
    localDir,
    snapshot() {
      if (snap && snap.seq === engine.seq) return snap;
      const versions = engine.versions();
      snap = { epoch: engine.epoch, seq: engine.seq, doc: engine.doc, version: (id) => versions[id] ?? 0 };
      return snap;
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
    score() {
      const c = cached();
      return (c.score ??= scoreSchematic(engine.doc));
    },
    checks() {
      const c = cached();
      return (c.checks ??= electricalChecks(engine.doc.circuit, engine.doc));
    },
    scene: (options = {}) => describeSchematic(engine.doc, { ...options, score: svc.score(), findings: svc.checks() }),
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
      const lines = [label.trim() || "schematic checkpoint", ""];
      for (const c of sets) lines.push(`- ${c.title ?? c.id} (${who(c.actors)}): ${c.entries.filter((s) => s > lastCheckpointSeq).length} transaction(s)`);
      if (loose.length) lines.push(`- other edits (${who(loose.map((e) => e.actor))}): ${loose.length} transaction(s)`);
      if (since.length) lines.push("", `Schematic seq ${since[0].seq} to ${since[since.length - 1].seq}, epoch ${engine.epoch}.`);
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
    close(options = {}) {
      if (closed) return;
      try {
        if (dir && options.save !== false) save();
      } finally {
        closed = true;
        lock?.release();
        listeners.clear();
      }
    },
  };
  return svc;
}

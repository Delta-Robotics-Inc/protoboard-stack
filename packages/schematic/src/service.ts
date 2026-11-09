/**
 * The schematic service (contract section 10): the single owner of one live schematic in this process. It holds
 * the engine, caches the score and the checks per seq, saves the files when asked, and tells subscribers about
 * commits and saves. The journal, leases, the wire transport and reload on external change follow the board core
 * and are specified there (contract section 15).
 */
import { join, relative, resolve } from "node:path";
import { acquireOwnerLock, findProjectRoot, type Actor } from "@protoboardai/board";
import { electricalChecks, type SchematicFinding } from "./checks.ts";
import type { SchematicCircuit } from "./circuit.ts";
import { withCircuit, type SchematicDocument } from "./document.ts";
import { createSchematicEngine, type Reply, type SchematicEngine, type Transaction } from "./engine.ts";
import { loadSchematicDir, writeSchematicDir, type WriteResult } from "./format.ts";
import { describeSchematic, type DescribeOptions, type DescribeResult } from "./scene.ts";
import type { SchematicFile } from "./schema.ts";
import { scoreSchematic, type Score } from "./score.ts";

export type SchematicEvent = { type: "commit"; seq: number; changed: string[]; actor: Actor; label: string } | { type: "saved"; files: SchematicFile[] };

export interface SchematicServiceOptions {
  /** the schematic folder (`<module folder>/schematic`) */
  dir?: string;
  /** or an in-memory document (no folder: save is refused) */
  document?: SchematicDocument;
  /** the circuit from UHD */
  circuit: SchematicCircuit;
  projectRoot?: string;
  /** default true when there is a folder */
  ownerLock?: boolean;
  epoch?: string;
  now?: () => number;
}

export interface SchematicService {
  readonly epoch: string;
  readonly seq: number;
  snapshot(): { epoch: string; seq: number; doc: SchematicDocument };
  apply(tx: Transaction, actor: Actor): Reply;
  undo(actor: Actor): Reply;
  redo(actor: Actor): Reply;
  score(): Score;
  checks(): SchematicFinding[];
  scene(options?: DescribeOptions): DescribeResult;
  subscribe(listener: (e: SchematicEvent) => void): () => void;
  save(): WriteResult;
  close(options?: { save?: boolean }): void;
}

/** `.protoboard/local/schematic/<key>/`: the key is the folder's path from the project root with `/` as `__`. */
export function schematicLocalDir(projectRoot: string, dir: string): string {
  const key = relative(projectRoot, resolve(dir)).split(/[\\/]/).filter(Boolean).join("__") || "schematic";
  return join(projectRoot, ".protoboard", "local", "schematic", key);
}

export function openSchematicService(o: SchematicServiceOptions): SchematicService {
  const root = o.dir ? (o.projectRoot ?? findProjectRoot(resolve(o.dir))) : undefined;
  const localDir = o.dir && root ? schematicLocalDir(root, o.dir) : undefined;
  let hashes: Partial<Record<SchematicFile, string>> = {};
  let initial: SchematicDocument;
  if (o.document) initial = withCircuit(o.document, o.circuit);
  else if (o.dir) {
    const l = loadSchematicDir(o.dir, o.circuit, localDir ? { localDir } : {});
    initial = l.doc;
    hashes = l.hashes;
  } else throw new Error("openSchematicService needs a folder or a document");
  const lock = o.dir && localDir && o.ownerLock !== false ? acquireOwnerLock(join(localDir, "owner.lock"), { dir: resolve(o.dir) }) : undefined;
  const engine: SchematicEngine = createSchematicEngine(initial, { ...(o.epoch ? { epoch: o.epoch } : {}), ...(o.now ? { now: o.now } : {}) });
  const listeners = new Set<(e: SchematicEvent) => void>();
  const emit = (e: SchematicEvent) => {
    for (const l of [...listeners]) l(e);
  };
  engine.onCommit(({ entry }) => emit({ type: "commit", seq: entry.seq, changed: entry.changed, actor: entry.actor, label: entry.label }));
  let cache: { seq: number; score?: Score; checks?: SchematicFinding[] } = { seq: -1 };
  const cached = () => {
    if (cache.seq !== engine.seq) cache = { seq: engine.seq };
    return cache;
  };
  const svc: SchematicService = {
    get epoch() {
      return engine.epoch;
    },
    get seq() {
      return engine.seq;
    },
    snapshot: () => ({ epoch: engine.epoch, seq: engine.seq, doc: engine.doc }),
    apply: (tx, actor) => engine.apply(tx, actor),
    undo: (actor) => engine.undo(actor),
    redo: (actor) => engine.redo(actor),
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
    save() {
      if (!o.dir) throw new Error("this schematic has no folder; save is refused");
      const r = writeSchematicDir(o.dir, engine.doc, { expected: hashes, ...(localDir ? { localDir } : {}) });
      hashes = { ...hashes, ...r.hashes };
      if (r.written.length) emit({ type: "saved", files: r.written });
      return r;
    },
    close(options = {}) {
      if (o.dir && options.save !== false) svc.save();
      lock?.release();
      listeners.clear();
    },
  };
  return svc;
}

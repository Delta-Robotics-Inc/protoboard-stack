/**
 * `connectSchematic(dir)`: a client of a schematic, as `connectBoard` is of a board. It finds a live service
 * through the schematic's `service.json` (its pid alive and its port answering) and talks JSON-RPC to it; with no
 * live service it opens the schematic itself for this client (it needs the circuit from UHD for that) and closes it
 * after, saving what the client changed. Every method is the service's, as a promise. Node only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BoardLockedError, findProjectRoot, RPC_ERRORS, TOKEN_PROTOCOL_PREFIX, type Actor, type EndedLease, type LeaseClaim } from "@protoboardai/board/node";
import type { SchematicCircuit } from "../circuit.ts";
import type { CleanupResult, DefectList, FixCandidate } from "../cleanup.ts";
import type { SchematicFinding } from "../checks.ts";
import type { SchematicDocument } from "../document.ts";
import type { ChangeSetInfo, ClaimReply, LogEntry, Reply, SchematicPresence, Transaction } from "../engine.ts";
import type { DescribeOptions, DescribeResult } from "../scene.ts";
import type { Score } from "../score.ts";
import { openSchematicService, schematicLocalDir, type SchematicCheckpointResult, type SchematicEvent, type SchematicSaveResult, type SchematicService, type SchematicSnapshot } from "../service.ts";
import { callSchematicService } from "./dispatch.ts";
import {
  describeSchematicOperations,
  SCHEMATIC_EVENT,
  SCHEMATIC_METHOD_PARAMS,
  SCHEMATIC_PROTOCOL,
  SCHEMATIC_SERVICE_FILE,
  SCHEMATIC_WRITES,
  SchematicRpcError,
  sceneFromWire,
  snapshotFromWire,
  type SchematicMethod,
  type SchematicQueryParams,
  type SchematicQueryResult,
  type SchematicServiceFile,
  type WireScene,
  type WireSchematicSnapshot,
} from "./protocol.ts";

export type SchematicOperationsResult = ReturnType<typeof describeSchematicOperations>;

export interface ConnectSchematicOptions {
  /** DEFAULT: the nearest folder up from `dir` with protoboard.config.ts, else the folder's parent. */
  projectRoot?: string;
  /** "auto" (DEFAULT): a live service, else the schematic opened here; "service": a live service or an error; "local": always open it here. */
  mode?: "auto" | "service" | "local";
  /** DEFAULT 30 s per call. */
  timeoutMs?: number;
  /** Local mode: the circuit from UHD (or a function that loads it, called only when the schematic is opened here). */
  circuit?: SchematicCircuit | (() => SchematicCircuit | Promise<SchematicCircuit>);
  /** Local mode: a document to start from instead of the files (an empty schematic for a folder with none). */
  document?: SchematicDocument | ((circuit: SchematicCircuit) => SchematicDocument | undefined);
  /** Local mode: DEFAULT true. */
  journal?: boolean;
  /** Local mode: DEFAULT true. */
  ownerLock?: boolean;
}

export interface SchematicClient {
  readonly mode: "service" | "local";
  readonly dir: string;
  readonly serviceFile?: string;
  /** Local mode: journal entries of an earlier session not in the files (`schematic serve --recover` replays them). */
  readonly recoverable: number;
  /** Any method by name (params as the protocol defines them). */
  call(method: SchematicMethod, params?: unknown): Promise<unknown>;
  snapshot(): Promise<SchematicSnapshot>;
  apply(tx: Transaction, actor: Actor): Promise<Reply>;
  undo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  redo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  revertChangeSet(actor: Actor, id: string, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  claim(actor: Actor, claim: LeaseClaim): Promise<ClaimReply>;
  release(actor: Actor, leaseId?: string): Promise<EndedLease[]>;
  takeOver(by?: Actor): Promise<EndedLease[]>;
  presence(): Promise<SchematicPresence>;
  save(): Promise<SchematicSaveResult>;
  checkpoint(label: string): Promise<SchematicCheckpointResult>;
  operations(options?: { all?: boolean }): Promise<SchematicOperationsResult>;
  log(since?: number): Promise<LogEntry[]>;
  changeSets(): Promise<ChangeSetInfo[]>;
  score(): Promise<Score>;
  checks(): Promise<SchematicFinding[]>;
  scene(options?: Pick<DescribeOptions, "card" | "net" | "image" | "theme" | "scale">): Promise<DescribeResult>;
  query(q: SchematicQueryParams): Promise<SchematicQueryResult>;
  listDefects(options?: { card?: string; rules?: string[]; includeInfo?: boolean; limit?: number }): Promise<DefectList>;
  proposeFixes(defect: string | number, options?: { max?: number }): Promise<FixCandidate[]>;
  applyFix(actor: Actor, fix: { title: string; ops: Transaction["ops"]; changeSet?: { id: string; title?: string } }, options?: { batchId?: string }): Promise<Reply>;
  explainDefect(defect: string | number): Promise<string>;
  cleanupPass(actor: Actor, options?: { budget?: number; maxPasses?: number; perPass?: number; changeSet?: { id: string; title?: string } }): Promise<CleanupResult>;
  revertCleanup(actor: Actor, changeSet: { id: string; title?: string; transactions: number; ops?: number }): Promise<number>;
  /** A host's extra method: service mode only. */
  callExtension(method: string, params?: unknown): Promise<unknown>;
  /** Service mode: `schematic.event` notifications; local mode: the service's own events. */
  subscribe(listener: (e: SchematicEvent) => void): () => void;
  /** Service mode: disconnect. Local mode: close the schematic, saving it when this client changed it. */
  close(): Promise<void>;
}

/** Where a schematic's `service.json` is. */
export function schematicServiceFileFor(dir: string, projectRoot?: string): string {
  const d = resolve(dir);
  return join(schematicLocalDir(projectRoot ? resolve(projectRoot) : findProjectRoot(d), d), SCHEMATIC_SERVICE_FILE);
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The service a schematic's `service.json` names, when its process is alive; undefined when there is none or it is stale. */
export function findSchematicService(dir: string, projectRoot?: string): (SchematicServiceFile & { file: string }) | undefined {
  const file = schematicServiceFileFor(dir, projectRoot);
  if (!existsSync(file)) return undefined;
  let s: Partial<SchematicServiceFile>;
  try {
    s = JSON.parse(readFileSync(file, "utf8")) as Partial<SchematicServiceFile>;
  } catch {
    return undefined;
  }
  if (typeof s.port !== "number" || typeof s.token !== "string" || typeof s.pid !== "number" || typeof s.epoch !== "string") return undefined;
  if (!processAlive(s.pid)) return undefined;
  return { ...(s as SchematicServiceFile), file };
}

/** JSON round trip: a local reply has exactly the shape a remote one has. */
const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function checkParams(method: SchematicMethod, params: unknown): unknown {
  const parsed = SCHEMATIC_METHOD_PARAMS[method].safeParse(params);
  if (!parsed.success) throw new SchematicRpcError(RPC_ERRORS.invalidParams, parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; "), parsed.error.issues);
  return parsed.data;
}

interface Rest {
  serviceFile?: string;
  callExtension(method: string, params?: unknown): Promise<unknown>;
  snapshot(): Promise<SchematicSnapshot>;
  subscribe(l: (e: SchematicEvent) => void): () => void;
  close(): Promise<void>;
}

function typed(dir: string, mode: "service" | "local", recoverable: number, call: (m: SchematicMethod, p?: unknown) => Promise<unknown>, rest: Rest): SchematicClient {
  const opt = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
  return {
    mode,
    dir,
    recoverable,
    ...(rest.serviceFile ? { serviceFile: rest.serviceFile } : {}),
    call,
    snapshot: rest.snapshot,
    apply: (tx, actor) => call("schematic.apply", { tx, actor }) as Promise<Reply>,
    undo: (actor, meta) => call("schematic.undo", { actor, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    redo: (actor, meta) => call("schematic.redo", { actor, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    revertChangeSet: (actor, id, meta) => call("schematic.revertChangeSet", { actor, id, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    claim: (actor, claim) => call("schematic.claim", { actor, claim }) as Promise<ClaimReply>,
    release: (actor, leaseId) => call("schematic.release", { actor, ...(leaseId ? { leaseId } : {}) }) as Promise<EndedLease[]>,
    takeOver: (by) => call("schematic.takeOver", by ? { by } : {}) as Promise<EndedLease[]>,
    presence: () => call("schematic.presence", {}) as Promise<SchematicPresence>,
    save: () => call("schematic.save", {}) as Promise<SchematicSaveResult>,
    checkpoint: (label) => call("schematic.checkpoint", { label }) as Promise<SchematicCheckpointResult>,
    operations: (o) => call("schematic.operations", o?.all ? { all: true } : {}) as Promise<SchematicOperationsResult>,
    log: (since) => call("schematic.log", since !== undefined ? { since } : {}) as Promise<LogEntry[]>,
    changeSets: () => call("schematic.changeSets", {}) as Promise<ChangeSetInfo[]>,
    score: () => call("schematic.score", {}) as Promise<Score>,
    checks: () => call("schematic.checks", {}) as Promise<SchematicFinding[]>,
    scene: async (o) => sceneFromWire((await call("schematic.scene", opt(o))) as WireScene),
    query: (q) => call("schematic.query", q) as Promise<SchematicQueryResult>,
    listDefects: (o) => call("schematic.listDefects", opt(o)) as Promise<DefectList>,
    proposeFixes: (defect, o) => call("schematic.proposeFixes", { defect, ...opt(o) }) as Promise<FixCandidate[]>,
    applyFix: (actor, fix, o) => call("schematic.applyFix", { actor, title: fix.title, ops: fix.ops, ...(fix.changeSet ? { changeSet: fix.changeSet } : {}), ...opt(o) }) as Promise<Reply>,
    explainDefect: async (defect) => ((await call("schematic.explainDefect", { defect })) as { text: string }).text,
    cleanupPass: (actor, o) => call("schematic.cleanupPass", { actor, ...opt(o) }) as Promise<CleanupResult>,
    revertCleanup: async (actor, changeSet) => ((await call("schematic.revertCleanup", { actor, changeSet: opt(changeSet) })) as { undone: number }).undone,
    callExtension: rest.callExtension,
    subscribe: rest.subscribe,
    close: rest.close,
  };
}

/** A client over a service in this process (local mode, a host, tests). Nothing crosses a wire; replies are copied as if it did. */
export function localClient(svc: SchematicService, options: { dir?: string; closeService?: boolean } = {}): SchematicClient {
  let dirty = false;
  const call = async (method: SchematicMethod, params?: unknown) => {
    const p = checkParams(method, params);
    try {
      const r = callSchematicService(svc, method, p);
      if (SCHEMATIC_WRITES.has(method)) {
        const status = (r as { status?: string } | undefined)?.status;
        if (status === "applied" || (method === "schematic.cleanupPass" && (r as CleanupResult).changeSet.transactions > 0) || (method === "schematic.revertCleanup" && (r as { undone: number }).undone > 0)) dirty = true;
      }
      return plain(r);
    } catch (e) {
      throw e instanceof SchematicRpcError ? e : new SchematicRpcError(RPC_ERRORS.service, (e as Error).message);
    }
  };
  return typed(options.dir ?? svc.dir ?? "", "local", svc.recoverable(), call, {
    callExtension: async (method) => {
      throw new SchematicRpcError(RPC_ERRORS.methodNotFound, `no method ${method.slice(0, 80)} on a schematic opened in this process (extension methods need a serving process)`);
    },
    snapshot: async () => svc.snapshot(),
    subscribe: (l) => svc.subscribe(l),
    close: async () => {
      if (options.closeService ?? true) svc.close({ save: dirty && !!svc.dir });
    },
  });
}

/** A client over the wire to a service at `url` with `token` (sent as the `protoboard.token.<token>` subprotocol). */
export async function schematicWireClient(url: string, token: string, options: { timeoutMs?: number; dir?: string; serviceFile?: string; connectTimeoutMs?: number } = {}): Promise<SchematicClient> {
  const ws = new WebSocket(url, [SCHEMATIC_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
  await new Promise<void>((done, fail) => {
    const t = setTimeout(() => {
      fail(new Error(`no answer from the schematic service at ${url}`));
      try {
        ws.close();
      } catch {
        /* never opened */
      }
    }, options.connectTimeoutMs ?? 3000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      done();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      fail(new Error(`the schematic service at ${url} refused the connection or is gone`));
    });
  });
  const timeoutMs = options.timeoutMs ?? 30_000;
  let next = 1;
  const pending = new Map<number, { done(v: unknown): void; fail(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<(e: SchematicEvent) => void>();
  let closedWith: Error | undefined;

  ws.addEventListener("message", (ev) => {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.method === SCHEMATIC_EVENT) {
      for (const l of [...listeners]) {
        try {
          l(msg.params as SchematicEvent);
        } catch {
          /* a listener's own failure */
        }
      }
      return;
    }
    const p = typeof msg.id === "number" ? pending.get(msg.id) : undefined;
    if (!p) return;
    pending.delete(msg.id!);
    clearTimeout(p.timer);
    if (msg.error) p.fail(new SchematicRpcError(msg.error.code, msg.error.message, msg.error.data));
    else p.done(msg.result);
  });
  ws.addEventListener("close", (ev) => {
    closedWith = new Error(`the schematic service closed the connection (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`);
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.fail(closedWith);
    }
    pending.clear();
  });

  const call = (method: SchematicMethod | string, params?: unknown) =>
    new Promise<unknown>((done, fail) => {
      if (closedWith || ws.readyState !== WebSocket.OPEN) return fail(closedWith ?? new Error("the connection to the schematic service is closed"));
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`the schematic service did not answer ${method} within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      pending.set(id, { done, fail, timer });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }));
    });

  return typed(options.dir ?? "", "service", 0, call, {
    ...(options.serviceFile ? { serviceFile: options.serviceFile } : {}),
    callExtension: (method, params) => call(method, params),
    snapshot: async () => snapshotFromWire((await call("schematic.snapshot", {})) as WireSchematicSnapshot),
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((done) => {
        const t = setTimeout(done, 1000);
        ws.addEventListener("close", () => {
          clearTimeout(t);
          done();
        });
        ws.close(1000);
      });
    },
  });
}

/**
 * A client of the schematic in `dir`: the live service when `service.json` names one, else (mode "auto") the
 * schematic opened in this process for this client, from `options.circuit` (and `options.document` when the folder
 * holds no schematic yet). A schematic owned by a live process that has not written `service.json` yet (a service
 * starting) is waited for briefly.
 */
export async function connectSchematic(dir: string, options: ConnectSchematicOptions = {}): Promise<SchematicClient> {
  const d = resolve(dir);
  const mode = options.mode ?? "auto";
  const tryService = async (): Promise<SchematicClient | undefined> => {
    const s = findSchematicService(d, options.projectRoot);
    if (!s) return undefined;
    try {
      return await schematicWireClient(`ws://127.0.0.1:${s.port}/`, s.token, { dir: d, serviceFile: s.file, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    } catch {
      return undefined;
    }
  };
  if (mode !== "local") {
    const c = await tryService();
    if (c) return c;
    if (mode === "service") throw new Error(`no schematic service is running for ${d}; start one with \`protoboard schematic serve ${dir}\``);
  }
  if (!options.circuit) throw new Error(`no schematic service is running for ${d}, and opening it here needs its circuit (from UHD)`);
  const circuit = typeof options.circuit === "function" ? await options.circuit() : options.circuit;
  const document = typeof options.document === "function" ? options.document(circuit) : options.document;
  for (let attempt = 0; ; attempt++) {
    try {
      const svc = openSchematicService({ dir: d, circuit, ...(document ? { document } : {}), ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}), ...(options.journal !== undefined ? { journal: options.journal } : {}), ...(options.ownerLock !== undefined ? { ownerLock: options.ownerLock } : {}) });
      return localClient(svc, { dir: d });
    } catch (e) {
      if (!(e instanceof BoardLockedError) || mode === "local" || attempt >= 10) throw e;
      // a service starting up holds the lock before it writes service.json
      await new Promise((r) => setTimeout(r, 200));
      const c = await tryService();
      if (c) return c;
    }
  }
}

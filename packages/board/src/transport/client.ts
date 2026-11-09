/**
 * `connectBoard(dir)`: a client of a board. It finds a live service through the board's `service.json` (its pid
 * alive and its port answering) and talks JSON-RPC to it; with no live service it opens the board itself for this
 * client and closes it after (saving what the client changed). Every method is the service's, as a promise.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EndedLease, LeaseClaim } from "../leases.js";
import type { Actor } from "../ops/registry.js";
import { BoardLockedError } from "../journal.js";
import type { Netlist } from "../schema.js";
import { boardLocalDir, findProjectRoot, openBoardService, type BoardEvent, type BoardService, type BoardSnapshot, type CheckpointResult, type SaveResult } from "../service.js";
import type { ChangeSetInfo, ClaimReply, LogEntry, Presence, Reply, Transaction } from "../transaction.js";
import { BOARD_PROTOCOL, BoardRpcError, callService, describeOperations, METHOD_PARAMS, RPC_ERRORS, SERVICE_FILE, snapshotFromWire, type BoardMethod, type QueryParams, type QueryResult, type ServiceFile, type WireSnapshot } from "./protocol.js";

export interface ConnectOptions {
  /** DEFAULT: the nearest folder up from `dir` with protoboard.config.ts, else `dir` (as the service decides). */
  projectRoot?: string;
  /** "auto" (DEFAULT): a live service, else the board opened for this client; "service": a live service or an error; "local": always open it here. */
  mode?: "auto" | "service" | "local";
  /** DEFAULT 30 s per call. */
  timeoutMs?: number;
  /** Local mode: the netlist to open the board with (else netlist.jsonl beside it). */
  netlist?: Netlist;
  /** Local mode: DEFAULT true. */
  journal?: boolean;
}

export type OperationsResult = ReturnType<typeof describeOperations>;

export interface BoardClient {
  readonly mode: "service" | "local";
  readonly dir: string;
  /** The `service.json` of the service this client talks to. */
  readonly serviceFile?: string;
  /** Local mode: journal entries of an earlier session that are not in the files (a host replays them; see `board serve --recover`). */
  readonly recoverable: number;
  /** Any method by name (params as the protocol defines them). */
  call(method: BoardMethod, params?: unknown): Promise<unknown>;
  snapshot(): Promise<BoardSnapshot>;
  query(q: QueryParams): Promise<QueryResult>;
  apply(tx: Transaction, actor: Actor): Promise<Reply>;
  undo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  redo(actor: Actor, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  revertChangeSet(actor: Actor, id: string, meta?: { batchId?: string; leaseToken?: number }): Promise<Reply>;
  claim(actor: Actor, claim: LeaseClaim): Promise<ClaimReply>;
  release(actor: Actor, leaseId?: string): Promise<EndedLease[]>;
  takeOver(by?: Actor): Promise<EndedLease[]>;
  presence(): Promise<Presence>;
  save(): Promise<SaveResult>;
  checkpoint(label: string): Promise<CheckpointResult>;
  operations(options?: { all?: boolean }): Promise<OperationsResult>;
  log(since?: number): Promise<LogEntry[]>;
  changeSets(): Promise<ChangeSetInfo[]>;
  /** Service mode: `board.event` notifications; local mode: the service's own events. */
  subscribe(listener: (e: BoardEvent) => void): () => void;
  /** Service mode: disconnect. Local mode: close the board, saving it when this client changed it. */
  close(): Promise<void>;
}

/** Where a board's `service.json` is. */
export function serviceFileFor(dir: string, projectRoot?: string): string {
  const d = resolve(dir);
  return join(boardLocalDir(projectRoot ? resolve(projectRoot) : findProjectRoot(d), d), SERVICE_FILE);
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

/** The service a board's `service.json` names, when its process is alive; undefined when there is none or it is stale. */
export function findService(dir: string, projectRoot?: string): (ServiceFile & { file: string }) | undefined {
  const file = serviceFileFor(dir, projectRoot);
  if (!existsSync(file)) return undefined;
  let s: Partial<ServiceFile>;
  try {
    s = JSON.parse(readFileSync(file, "utf8")) as Partial<ServiceFile>;
  } catch {
    return undefined;
  }
  if (typeof s.port !== "number" || typeof s.token !== "string" || typeof s.pid !== "number" || typeof s.epoch !== "string") return undefined;
  if (!processAlive(s.pid)) return undefined;
  return { ...(s as ServiceFile), file };
}

/** JSON round trip: a local reply has exactly the shape a remote one has. */
const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function checkParams(method: BoardMethod, params: unknown): unknown {
  const parsed = METHOD_PARAMS[method].safeParse(params);
  if (!parsed.success) throw new BoardRpcError(RPC_ERRORS.invalidParams, parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; "), parsed.error.issues);
  return parsed.data;
}

const WRITES: ReadonlySet<BoardMethod> = new Set(["board.apply", "board.undo", "board.redo", "board.revertChangeSet"]);

function typed(dir: string, mode: "service" | "local", recoverable: number, call: (m: BoardMethod, p?: unknown) => Promise<unknown>, rest: { serviceFile?: string; snapshot(): Promise<BoardSnapshot>; subscribe(l: (e: BoardEvent) => void): () => void; close(): Promise<void> }): BoardClient {
  return {
    mode,
    dir,
    recoverable,
    ...(rest.serviceFile ? { serviceFile: rest.serviceFile } : {}),
    call,
    snapshot: rest.snapshot,
    query: (q) => call("board.query", q) as Promise<QueryResult>,
    apply: (tx, actor) => call("board.apply", { tx, actor }) as Promise<Reply>,
    undo: (actor, meta) => call("board.undo", { actor, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    redo: (actor, meta) => call("board.redo", { actor, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    revertChangeSet: (actor, id, meta) => call("board.revertChangeSet", { actor, id, ...(meta ? { meta } : {}) }) as Promise<Reply>,
    claim: (actor, claim) => call("board.claim", { actor, claim }) as Promise<ClaimReply>,
    release: (actor, leaseId) => call("board.release", { actor, ...(leaseId ? { leaseId } : {}) }) as Promise<EndedLease[]>,
    takeOver: (by) => call("board.takeOver", by ? { by } : {}) as Promise<EndedLease[]>,
    presence: () => call("board.presence", {}) as Promise<Presence>,
    save: () => call("board.save", {}) as Promise<SaveResult>,
    checkpoint: (label) => call("board.checkpoint", { label }) as Promise<CheckpointResult>,
    operations: (o) => call("board.operations", o?.all ? { all: true } : {}) as Promise<OperationsResult>,
    log: (since) => call("board.log", since !== undefined ? { since } : {}) as Promise<LogEntry[]>,
    changeSets: () => call("board.changeSets", {}) as Promise<ChangeSetInfo[]>,
    subscribe: rest.subscribe,
    close: rest.close,
  };
}

/** A client over a service in this process (local mode, and tests). Nothing crosses a wire; replies are copied as if it did. */
export function localClient(svc: BoardService, options: { dir?: string; closeService?: boolean } = {}): BoardClient {
  let dirty = false;
  const call = async (method: BoardMethod, params?: unknown) => {
    const p = checkParams(method, params);
    try {
      const r = callService(svc, method, p);
      if (WRITES.has(method) && (r as Reply).status === "applied") dirty = true;
      return plain(r);
    } catch (e) {
      throw e instanceof BoardRpcError ? e : new BoardRpcError(RPC_ERRORS.service, (e as Error).message);
    }
  };
  return typed(options.dir ?? svc.dir ?? "", "local", svc.recoverable(), call, {
    snapshot: async () => svc.snapshot(),
    subscribe: (l) => svc.subscribe(l),
    close: async () => {
      if (options.closeService ?? true) svc.close({ save: dirty && !!svc.dir });
    },
  });
}

/** A client over the wire to a service at `url` with `token`. */
export async function wireClient(url: string, token: string, options: { timeoutMs?: number; dir?: string; serviceFile?: string; connectTimeoutMs?: number } = {}): Promise<BoardClient> {
  const ws = new WebSocket(url, { protocols: [BOARD_PROTOCOL], headers: { authorization: `Bearer ${token}` } });
  await new Promise<void>((done, fail) => {
    const t = setTimeout(() => {
      fail(new Error(`no answer from the board service at ${url}`));
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
      fail(new Error(`the board service at ${url} refused the connection or is gone`));
    });
  });
  const timeoutMs = options.timeoutMs ?? 30_000;
  let next = 1;
  const pending = new Map<number, { done(v: unknown): void; fail(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<(e: BoardEvent) => void>();
  let closedWith: Error | undefined;

  ws.addEventListener("message", (ev) => {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.method === "board.event") {
      for (const l of [...listeners]) {
        try {
          l(msg.params as BoardEvent);
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
    if (msg.error) p.fail(new BoardRpcError(msg.error.code, msg.error.message, msg.error.data));
    else p.done(msg.result);
  });
  ws.addEventListener("close", (ev) => {
    closedWith = new Error(`the board service closed the connection (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`);
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.fail(closedWith);
    }
    pending.clear();
  });

  const call = (method: BoardMethod, params?: unknown) =>
    new Promise<unknown>((done, fail) => {
      if (closedWith || ws.readyState !== WebSocket.OPEN) return fail(closedWith ?? new Error("the connection to the board service is closed"));
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`the board service did not answer ${method} within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      pending.set(id, { done, fail, timer });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }));
    });

  return typed(options.dir ?? "", "service", 0, call, {
    ...(options.serviceFile ? { serviceFile: options.serviceFile } : {}),
    snapshot: async () => snapshotFromWire((await call("board.snapshot", {})) as WireSnapshot),
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((done) => {
        ws.addEventListener("close", () => done());
        ws.close(1000);
        setTimeout(done, 1000).unref?.();
      });
    },
  });
}

/**
 * A client of the board in `dir`: the live service when `service.json` names one, else (mode "auto") the board
 * opened in this process for this client. A board owned by a live process that has not written `service.json`
 * yet (a service starting) is waited for briefly.
 */
export async function connectBoard(dir: string, options: ConnectOptions = {}): Promise<BoardClient> {
  const d = resolve(dir);
  const mode = options.mode ?? "auto";
  const tryService = async (): Promise<BoardClient | undefined> => {
    const s = findService(d, options.projectRoot);
    if (!s) return undefined;
    try {
      return await wireClient(`ws://127.0.0.1:${s.port}/`, s.token, { dir: d, serviceFile: s.file, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    } catch {
      return undefined;
    }
  };
  if (mode !== "local") {
    const c = await tryService();
    if (c) return c;
    if (mode === "service") throw new Error(`no board service is running for ${d}; start one with \`protoboard board serve ${dir}\``);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const svc = openBoardService({ dir: d, ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}), ...(options.netlist ? { netlist: options.netlist } : {}), ...(options.journal !== undefined ? { journal: options.journal } : {}) });
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

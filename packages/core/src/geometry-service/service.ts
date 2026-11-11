/**
 * The exact measurement tier's process (PB-1187): one Python worker per
 * project in the project's CAD runtime (build123d/OCCT), spoken to over its
 * stdin and stdout as JSON lines (no socket, nothing on loopback), started on
 * the first request and kept warm so a second measurement on a loaded STEP
 * takes milliseconds. The worker is `@protoboardai/ext-parts`
 * `scripts/geometry_service.py`, run with `python -I` (isolated: no user
 * site, no script directory on the path) since it reads files that may have
 * been downloaded.
 *
 * Limits (DEFAULT, revisit): a STEP over 256 MB is refused; a request gets
 * 120 s, or 300 s when its STEP is not loaded yet (ClientX's 143 MB board
 * takes about 47 s to load); a reply line over 16 MB, or a timeout, kills
 * the worker (the next request starts a new one); the worker exits after 10
 * minutes idle.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readToolsRecord } from "../tools.js";
import { checkGeometryRequest, type GeometryRequest, type MeasureResult } from "./protocol.js";
import { MAX_STEP_BYTES, resolvePartStep, type PartStep } from "./resolve.js";

export const GEOMETRY_LIMITS = {
  /** DEFAULT ms for a request on loaded files. */
  timeoutMs: 120_000,
  /** DEFAULT ms for a request that loads a STEP first. */
  loadTimeoutMs: 300_000,
  /** DEFAULT ms for the worker to start (import build123d). */
  startTimeoutMs: 60_000,
  /** DEFAULT bytes of one reply line. */
  maxLineBytes: 16 * 1024 * 1024,
  /** DEFAULT bytes of one request line (the worker's own cap, `MAX_LINE` in geometry_service.py, is 4 MB). */
  maxRequestBytes: 4 * 1024 * 1024 - 1024,
  /** DEFAULT ms idle before the worker exits. */
  idleMs: 10 * 60_000,
} as const;

/** The CAD runtime's Python: PROTOBOARD_PYTHON, else the project's `cad` runtime (`protoboard tools install cad`). */
export function cadPythonFor(root: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PROTOBOARD_PYTHON) return env.PROTOBOARD_PYTHON;
  try {
    const rt = readToolsRecord(root).runtimes.cad;
    const f = rt ? join(root, rt.interpreter.path) : undefined;
    return f && existsSync(f) ? f : undefined;
  } catch {
    return undefined;
  }
}

/** The worker script: the project's @protoboardai/ext-parts, else the one beside this package (a checkout). */
export function geometryScript(root: string): string | undefined {
  const candidates: string[] = [];
  try {
    const req = createRequire(join(root, "package.json"));
    candidates.push(join(dirname(req.resolve("@protoboardai/ext-parts/package.json")), "scripts", "geometry_service.py"));
  } catch {
    // not installed in the project
  }
  candidates.push(fileURLToPath(new URL("../../../ext-parts/scripts/geometry_service.py", import.meta.url)));
  return candidates.find((c) => existsSync(c));
}

export interface GeometryServiceOptions {
  python?: string;
  script?: string;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  startTimeoutMs?: number;
  maxStepBytes?: number;
  idleMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface WorkerInfo {
  build123d: string;
  python: string;
  /** Seconds the worker took to import build123d. */
  importS: number;
  /** ms from spawn to ready. */
  startMs: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** One project's geometry worker. */
export class GeometryService {
  private child: ChildProcess | undefined;
  private starting: Promise<WorkerInfo> | undefined;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private idleTimer: NodeJS.Timeout | undefined;
  private loaded = new Set<string>();
  info: WorkerInfo | undefined;

  constructor(
    readonly root: string,
    private readonly opts: GeometryServiceOptions = {},
  ) {}

  /** Start the worker (once); resolves when it reports ready. */
  start(): Promise<WorkerInfo> {
    if (this.starting) return this.starting;
    const python = this.opts.python ?? cadPythonFor(this.root, this.opts.env);
    const script = this.opts.script ?? geometryScript(this.root);
    if (!python) return Promise.reject(new Error("no CAD runtime: run `protoboard tools install cad` in the project, or set PROTOBOARD_PYTHON"));
    if (!script) return Promise.reject(new Error("geometry_service.py not found: @protoboardai/ext-parts is needed"));
    const t0 = Date.now();
    this.starting = new Promise<WorkerInfo>((resolveReady, rejectReady) => {
      const child = spawn(python, ["-I", script], {
        // not the project: the worker reads absolute paths only, and a project folder it sits in cannot be removed on Windows
        cwd: dirname(script),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...(this.opts.env ?? process.env), PROTOBOARD_GEOMETRY_MAX_BYTES: String(this.opts.maxStepBytes ?? MAX_STEP_BYTES), PYTHONIOENCODING: "utf-8" },
      });
      this.child = child;
      let ready = false;
      // every handler below acts only while `child` is the current worker: a worker stopped after a timeout may
      // still exit or print after the next one started (gate 3)
      const current = () => this.child === child;
      const startTimer = setTimeout(() => {
        if (!ready && current()) {
          this.kill(new Error("the geometry worker did not start in time"));
          rejectReady(new Error(`the geometry worker did not start within ${this.opts.startTimeoutMs ?? GEOMETRY_LIMITS.startTimeoutMs} ms`));
        }
      }, this.opts.startTimeoutMs ?? GEOMETRY_LIMITS.startTimeoutMs);
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (d: string) => {
        if (current()) this.stderr = (this.stderr + d).slice(-4096);
      });
      child.on("error", (e) => {
        clearTimeout(startTimer);
        if (!ready) rejectReady(e);
        if (current()) this.kill(e);
      });
      child.on("exit", (code) => {
        clearTimeout(startTimer);
        const err = new Error(`the geometry worker exited (${code ?? "signal"})${this.stderr ? `: ${this.stderr.trim().split("\n").pop()}` : ""}`);
        if (!ready) rejectReady(err);
        if (current()) this.kill(err);
      });
      child.stdout!.on("data", (d: string) => {
        if (!current()) return;
        this.buffer += d;
        if (this.buffer.length > (GEOMETRY_LIMITS.maxLineBytes as number) && !this.buffer.includes("\n")) {
          this.kill(new Error("a reply from the geometry worker was over the size cap"));
          return;
        }
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string; build123d?: string; python?: string; importS?: number };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.ready && !ready) {
            ready = true;
            clearTimeout(startTimer);
            this.info = { build123d: msg.build123d ?? "?", python: msg.python ?? "?", importS: msg.importS ?? 0, startMs: Date.now() - t0 };
            resolveReady(this.info);
            continue;
          }
          const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
          if (!p) continue;
          this.pending.delete(msg.id!);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error ?? "the geometry worker failed"));
        }
      });
    });
    this.starting.catch(() => undefined);
    return this.starting;
  }

  private kill(err: Error) {
    const c = this.child;
    this.child = undefined;
    this.starting = undefined;
    this.loaded.clear();
    this.buffer = "";
    if (c && c.exitCode === null) c.kill();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), this.opts.idleMs ?? GEOMETRY_LIMITS.idleMs);
    this.idleTimer.unref?.();
  }

  /** Send one request; rejects on the worker's error, a timeout (the worker is then stopped) or its exit. */
  async call<T = unknown>(msg: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    await this.start();
    const child = this.child;
    if (!child?.stdin) throw new Error("the geometry worker is not running");
    const id = this.nextId++;
    const ms = timeoutMs ?? this.opts.timeoutMs ?? GEOMETRY_LIMITS.timeoutMs;
    this.touch();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the geometry worker took longer than ${ms} ms (stopped; the next request starts a new one)`));
        this.kill(new Error("stopped after a timeout"));
      }, ms);
      const line = JSON.stringify({ ...msg, id });
      // over the worker's line cap it would answer without an id and the request would wait for its timeout (gate 3)
      if (line.length > GEOMETRY_LIMITS.maxRequestBytes) {
        clearTimeout(timer);
        reject(new Error(`the request is over ${GEOMETRY_LIMITS.maxRequestBytes} bytes`));
        return;
      }
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      child.stdin!.write(line + "\n");
    });
  }

  private timeoutFor(files: PartStep[]): number {
    return files.some((f) => !this.loaded.has(f.file)) ? (this.opts.loadTimeoutMs ?? GEOMETRY_LIMITS.loadTimeoutMs) : (this.opts.timeoutMs ?? GEOMETRY_LIMITS.timeoutMs);
  }

  /** The source STEP for an instance path (resolved.json, contained, capped). */
  resolve(part: string): PartStep {
    return resolvePartStep(this.root, part, { maxBytes: this.opts.maxStepBytes });
  }

  /** Measure exactly (`tier: "exact"`). Refs name instance paths; their STEP files are resolved here. */
  async measure(req: GeometryRequest): Promise<MeasureResult & { files: Record<string, string> }> {
    const bad = checkGeometryRequest(req);
    if (bad) throw new Error(bad);
    const parts = [req.a.part, ...(req.b ? [req.b.part] : [])];
    const steps = parts.map((p) => this.resolve(p));
    const files = Object.fromEntries(steps.map((s) => [s.part, s.file]));
    const t0 = Date.now();
    const result = await this.call<MeasureResult>({ op: "measure", request: req, files }, this.timeoutFor(steps));
    for (const s of steps) this.loaded.add(s.file);
    const notes = steps.filter((s) => s.placeholder).map((s) => `"${s.holder}" is a placeholder model: the number describes the stand-in`);
    return { ...result, ...(notes.length ? { notes: [...(result.notes ?? []), ...notes] } : {}), ms: Date.now() - t0, files: Object.fromEntries(steps.map((s) => [s.part, s.relative])) };
  }

  /** Load a part's STEP now (warm-up), with the worker's load time. */
  async load(part: string): Promise<{ faces: number; loadS: number; cached: boolean; file: string }> {
    const s = this.resolve(part);
    const r = await this.call<{ faces: number; loadS: number; cached: boolean }>({ op: "load", file: s.file }, this.timeoutFor([s]));
    this.loaded.add(s.file);
    return { ...r, file: s.relative };
  }

  /** The B-rep faces of a part (index, type, area, centroid, normal or axis and radius; part mm). */
  async faces(part: string, limit = 500): Promise<{ faces: number; listed: unknown[]; file: string }> {
    const s = this.resolve(part);
    const r = await this.call<{ faces: number; listed: unknown[] }>({ op: "faces", file: s.file, limit }, this.timeoutFor([s]));
    this.loaded.add(s.file);
    return { ...r, file: s.relative };
  }

  /** Stop the worker. */
  close(): void {
    const c = this.child;
    if (c?.stdin && c.exitCode === null) {
      try {
        c.stdin.write(JSON.stringify({ id: 0, op: "quit" }) + "\n");
      } catch {
        // already gone
      }
    }
    this.kill(new Error("the geometry worker was closed"));
  }
}

const services = new Map<string, GeometryService>();

/** The project's geometry worker (one per project root, started on first use). */
export function geometryService(root: string, opts: GeometryServiceOptions = {}): GeometryService {
  const key = existsSync(root) ? realpathSync(root) : root;
  let s = services.get(key);
  if (!s) {
    s = new GeometryService(key, opts);
    services.set(key, s);
  }
  return s;
}

/** Stop every worker (tests, process exit). */
export function closeGeometryServices(): void {
  for (const s of services.values()) s.close();
  services.clear();
}

/**
 * The project's `protoboard dev` session: find one that is running (attach),
 * or start one and read its JSON log, and notice when it stops or restarts.
 * No VS Code API here: the unit tests run it directly.
 *
 * A running `protoboard dev` records itself in `.protoboard/local/dev.json`
 * (URL, session, pid) and its state route returns the same session. A record
 * whose server does not answer with that session is stale (a server that was
 * killed) and is ignored.
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cliError, folderGone, type CliCommand } from "./cli.js";

export const DEV_RECORD = join(".protoboard", "local", "dev.json");
export const STATE_ROUTE = "/__protoboard/state";

/** `.protoboard/local/dev.json` (`DevRecord` in @protoboardai/cli). */
export interface DevRecord {
  schema: "protoboard.dev/v0";
  url: string;
  port: number;
  pid: number;
  session: string;
  root: string;
  startedAt: string;
}

/** Where a live session serves: from its record, or from the log of a server this extension started. */
export interface DevEndpoint {
  url: string;
  session: string;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; cache?: "no-store" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface LocateDeps {
  read?: (file: string) => string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The project's session record, if there is a well-formed one. */
export function readDevRecord(root: string, read: (file: string) => string = (f) => readFileSync(f, "utf8")): DevRecord | undefined {
  let r: Partial<DevRecord>;
  try {
    r = JSON.parse(read(join(root, DEV_RECORD))) as Partial<DevRecord>;
  } catch {
    return undefined;
  }
  if (r?.schema !== "protoboard.dev/v0" || typeof r.url !== "string" || typeof r.session !== "string") return undefined;
  try {
    new URL(r.url);
  } catch {
    return undefined;
  }
  return r as DevRecord;
}

/** The session a dev server at `url` reports, or undefined when nothing answers like one. */
export async function probeDev(url: string, deps: LocateDeps = {}): Promise<string | undefined> {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 1500);
  try {
    const res = await doFetch(new URL(STATE_ROUTE, url).href, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return undefined;
    const state = (await res.json()) as { session?: unknown };
    return typeof state?.session === "string" ? state.session : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Why a dev server at `url` does not answer like one (for the log), or undefined when it does. */
export async function whyNoDev(url: string, deps: LocateDeps = {}): Promise<string | undefined> {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 1500);
  const target = new URL(STATE_ROUTE, url).href;
  try {
    const res = (await doFetch(target, { signal: ctl.signal, cache: "no-store" })) as { ok: boolean; status?: number; json(): Promise<unknown> };
    if (!res.ok) return `GET ${target} answered ${res.status ?? "an error"}`;
    const state = (await res.json()) as { session?: unknown };
    return typeof state?.session === "string" ? undefined : `GET ${target} answered, but not as a Protoboard dev server (another program has the port?)`;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    if (err.name === "AbortError") return `GET ${target}: no answer in ${deps.timeoutMs ?? 1500} ms`;
    return `GET ${target}: ${err.cause?.code ?? err.cause?.message ?? err.message}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The live session for a project: its record when the server answers with
 * the recorded session; otherwise, for a server this extension started (whose
 * URL it knows from the log), whatever session answers there.
 */
export async function locateDev(root: string, knownUrl?: string, deps: LocateDeps = {}): Promise<(DevEndpoint & { record?: DevRecord }) | undefined> {
  const record = readDevRecord(root, deps.read);
  if (record && (await probeDev(record.url, deps)) === record.session) return { url: record.url, session: record.session, record };
  if (knownUrl && knownUrl !== record?.url) {
    const session = await probeDev(knownUrl, deps);
    if (session) return { url: knownUrl, session };
  }
  return undefined;
}

/** One line of `protoboard dev --format json` (`DevLogEvent` with a time). */
export interface DevLogLine {
  time?: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  url?: string;
  port?: number;
  [key: string]: unknown;
}

/** A log line, or undefined for output that is not one (a stack trace, a warning from Node). */
export function parseDevLog(line: string): DevLogLine | undefined {
  if (!line.startsWith("{")) return undefined;
  try {
    const o = JSON.parse(line) as Partial<DevLogLine> & { error?: unknown };
    // a failure of the command itself: `{"error": "..."}`
    if (typeof o.error === "string" && o.message === undefined) return { level: "error", event: "failed", message: o.error };
    if (typeof o.message !== "string" || typeof o.event !== "string") return undefined;
    return { ...o, level: o.level === "warn" || o.level === "error" ? o.level : "info" } as DevLogLine;
  } catch {
    return undefined;
  }
}

export interface DevProcessOptions {
  cli: CliCommand;
  root: string;
  /** Port to ask for (the CLI then fails when it is taken); default: 5180 or the next free one. */
  port?: number | null;
  /** Every log line, and other output as `event: "output"`. */
  onLog: (line: DevLogLine) => void;
  /** How long the first build may take before giving up (default 3 minutes). */
  startTimeoutMs?: number;
  /** More `protoboard dev` arguments (`devArgs` for a browser-hosted window). */
  extraArgs?: string[];
  spawn?: typeof nodeSpawn;
}

/**
 * What a browser-hosted VS Code (code-server, Codespaces, vscode.dev
 * tunnels) needs from `protoboard dev`: the webview reaches the server
 * through the IDE's authenticated proxy, which passes its own Host on, and
 * the webview's origin is an https one rather than `vscode-webview://`. A
 * desktop window (local or remote) needs nothing: its port forwarding is a
 * tunnel to the loopback name, and its webviews are `vscode-webview://`.
 */
export function devArgs(ui: { web: boolean }): string[] {
  return ui.web ? ["--allow-host", "*", "--host-origin", "self,vscode-webview://*,https://*"] : [];
}

/** `protoboard dev --format json` started by the extension. */
export class DevProcess {
  /** Resolves with the URL once the server listens; rejects when it exits first or does not start in time. */
  readonly ready: Promise<{ url: string; port: number }>;
  /** Resolves when the process has exited, for whatever reason. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly proc: ChildProcess;
  url: string | undefined;
  private stopping = false;
  private done = false;

  constructor(private readonly options: DevProcessOptions) {
    const { cli, root, port } = options;
    const args = [...cli.args, "dev", "--format", "json", ...(port ? ["--port", String(port)] : []), ...(options.extraArgs ?? [])];
    this.proc = (options.spawn ?? nodeSpawn)(cli.command, args, { cwd: root, env: { ...process.env, ...(cli.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let failure: string | undefined;
    let stderrTail = "";
    let settle!: { ok: (v: { url: string; port: number }) => void; fail: (e: Error) => void };
    this.ready = new Promise((ok, fail) => (settle = { ok, fail }));
    // a caller that never awaits `ready` must not see an unhandled rejection
    this.ready.catch(() => undefined);
    const timer = setTimeout(() => {
      settle.fail(new Error(`protoboard dev did not start within ${Math.round((options.startTimeoutMs ?? 180000) / 1000)} s`));
      void this.stop();
    }, options.startTimeoutMs ?? 180000);

    lines(this.proc.stdout!, (text) => {
      const line = parseDevLog(text) ?? { level: "info", event: "output", message: text };
      if (line.event === "failed") failure = line.message;
      if (line.event === "listening" && typeof line.url === "string") {
        this.url = line.url;
        clearTimeout(timer);
        settle.ok({ url: line.url, port: Number(line.port) });
      }
      options.onLog(line);
    });
    lines(this.proc.stderr!, (text) => {
      stderrTail = `${stderrTail}\n${text}`.split("\n").slice(-3).join("\n");
      options.onLog(parseDevLog(text) ?? { level: "warn", event: "output", message: text });
    });
    this.exited = new Promise((ok) => {
      this.proc.on("error", (e) => {
        clearTimeout(timer);
        settle.fail((existsSync(root) ? cliError(cli, e) : folderGone(root)));
        this.done = true;
        ok({ code: null, signal: null });
      });
      this.proc.on("close", (code, signal) => {
        clearTimeout(timer);
        this.done = true;
        const why = failure ?? (stderrTail.trim() || `exited with ${signal ?? code}`);
        settle.fail(new Error(`protoboard dev stopped before serving: ${why}`));
        ok({ code, signal });
      });
    });
  }

  get running(): boolean {
    return !this.done;
  }

  /** Was the exit asked for (stop) rather than a crash? */
  get stopped(): boolean {
    return this.stopping;
  }

  /** Ask the server to stop (it removes its record and closes cleanly), then kill it if it does not exit in time. */
  async stop(timeoutMs = 5000): Promise<void> {
    if (this.done) return;
    this.stopping = true;
    this.proc.kill("SIGTERM");
    const timer = setTimeout(() => this.proc.kill("SIGKILL"), timeoutMs);
    await this.exited;
    clearTimeout(timer);
    // Windows ends the process at once, before it can remove its record: a record that still names this process is removed here
    try {
      const record = readDevRecord(this.options.root);
      if (record && record.pid === this.proc.pid) rmSync(join(this.options.root, DEV_RECORD), { force: true });
    } catch {
      // the next look probes the record's address and finds it dead
    }
  }
}

/** Call `each` for every complete line of a stream. */
function lines(stream: NodeJS.ReadableStream, each: (line: string) => void) {
  let buf = "";
  stream.on("data", (d: Buffer | string) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.trim()) each(line);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) each(buf);
    buf = "";
  });
}

/**
 * Watches where a project's session is: reports a server that stopped
 * (`undefined`) and one that came back or was restarted (a new URL or
 * session). Each change is reported once.
 */
export class DevMonitor {
  private key: string;
  private busy = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly locate: () => Promise<DevEndpoint | undefined>,
    current: DevEndpoint | undefined,
    private readonly onChange: (endpoint: DevEndpoint | undefined) => void,
  ) {
    this.key = keyOf(current);
  }

  start(intervalMs = 2000): this {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
    return this;
  }

  /** Look once (the interval calls this; tests call it directly). */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const found = await this.locate();
      const key = keyOf(found);
      if (key !== this.key) {
        this.key = key;
        this.onChange(found);
      }
    } finally {
      this.busy = false;
    }
  }

  /** The extension moved to this endpoint itself (it started a server): not a change to report. */
  set(endpoint: DevEndpoint | undefined) {
    this.key = keyOf(endpoint);
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

const keyOf = (e: DevEndpoint | undefined) => (e ? `${e.url}|${e.session}` : "");

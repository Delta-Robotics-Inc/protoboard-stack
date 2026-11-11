/**
 * Minimal Chrome DevTools Protocol client: one headless Chrome, one page,
 * evaluate / screenshot / printToPDF. No dependencies.
 * The documents (ext-docs) print with it; `protoboard views check` renders
 * the viewer's tabs with it (PB-1030); the render service (PB-1180,
 * ./render-service/) keeps one warm per project.
 *
 * The browser is the one @protoboardai/core finds (browser.ts: Google
 * Chrome, Chromium, Microsoft Edge or Brave where each platform installs
 * them; $CHROME wins), the same one the `chrome` tool's probe reports.
 *
 * GL backend (`LaunchOptions.backend`):
 * - `swiftshader` (the default, unchanged for the documents): ANGLE on
 *   SwiftShader, a CPU rasteriser, so WebGL renders the same with or without
 *   a GPU.
 * - `gpu`: ANGLE on the machine's GPU (D3D11 on Windows, Metal on macOS,
 *   Vulkan on Linux). Headless Chrome leaves the GPU off unless told; these
 *   flags turn it on.
 * - `auto`: `gpu`, then a probe of the page's WebGL 2 renderer string; a
 *   software renderer (SwiftShader, llvmpipe, Microsoft Basic Render) or no
 *   WebGL 2 at all closes that browser and starts it again on SwiftShader.
 *   `PROTOBOARD_RENDER_BACKEND` (swiftshader | gpu | auto) overrides what a
 *   caller asks for.
 *
 * Every capture names its backend (`Browser.backend`): a headless WebGPU
 * canvas captures black, so the viewer stays on WebGL; a SwiftShader frame is
 * correct but slow.
 *
 * DevTools transport (`LaunchOptions.transport`, wave 2 gate):
 * - `pipe` (the DEFAULT since 2026-11-01): `--remote-debugging-pipe`, the
 *   protocol over the browser's fds 3 and 4 (NUL-terminated JSON). No local
 *   port is opened, so nothing else on the machine can drive the render
 *   service's browser during its 15 warm minutes. A pipe that does not come
 *   up is tried once more on a port (`backend.transportFallback` says why).
 * - `port`: `--remote-debugging-port=0` and a WebSocket on 127.0.0.1 (the
 *   previous behaviour, kept as the fallback).
 *   `PROTOBOARD_CDP_TRANSPORT` (pipe | port) overrides what a caller asks for.
 * Either way the page is one target attached with a flattened session.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { findBrowser, noBrowserMessage } from "./browser.js";

// The render service's public surface is its own entry, `@protoboardai/core/render-service`
// (./render-service/index.ts); its modules import only types from this file.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export type GlBackendRequest = "swiftshader" | "gpu" | "auto";

/** How DevTools is carried: Chrome's fds 3/4 (`pipe`, the default) or a WebSocket on a local port (`port`). */
export type CdpTransport = "pipe" | "port";

/** What the page's WebGL says it runs on. */
export interface GlInfo {
  webgl2: boolean;
  webgl1: boolean;
  /** `UNMASKED_RENDERER_WEBGL`, else `RENDERER` (e.g. "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"). */
  renderer: string;
  vendor: string;
  /** `navigator.gpu` exists (WebGPU). A headless WebGPU canvas still captures black: never used for captures. */
  webgpu: boolean;
}

export interface BackendInfo {
  /** What drew: the GPU through ANGLE, or SwiftShader on the CPU. */
  kind: "gpu" | "swiftshader";
  /** What was asked for (after `PROTOBOARD_RENDER_BACKEND`). */
  requested: GlBackendRequest;
  /** The GL flags the browser was started with. */
  flags: string[];
  gl?: GlInfo;
  /** Why `auto` (or `gpu`) ended on SwiftShader. */
  fallback?: string;
  /** The browser's product string (`Browser.getVersion`), e.g. "HeadlessChrome/141.0.7390.55". */
  product?: string;
  /** Milliseconds to start (both starts when `auto` fell back). */
  startMs: number;
  /** How DevTools was carried. */
  transport?: CdpTransport;
  /** Why the pipe was not used when it was asked for (the browser then runs on a local port). */
  transportFallback?: string;
}

export interface CaptureOptions {
  format?: "png" | "jpeg" | "webp";
  /** 0-100, for jpeg and webp. */
  quality?: number;
  /** A region in CSS pixels; `scale` scales the output (0.5 = half the pixels each way). */
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
}

export interface Browser {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  navigate: (url: string) => Promise<void>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  setViewport: (width: number, height: number, scale?: number) => Promise<void>;
  printToPdf: (url: string) => Promise<Buffer>;
  /** A PNG of the page as drawn (WebGL included), or of a region of it in CSS pixels. */
  screenshot: (clip?: { x: number; y: number; width: number; height: number; scale?: number }) => Promise<Buffer>;
  /** The page as drawn, in a format and quality (the render service's encoder). */
  capture: (options?: CaptureOptions) => Promise<Buffer>;
  /** The page's WebGL: version, renderer, vendor (a throwaway canvas). */
  gl: () => Promise<GlInfo>;
  /** Uncaught exceptions and console errors since the last call (and clears them). */
  takeErrors: () => string[];
  /** The browser process still runs and its DevTools connection is open. */
  alive: () => boolean;
  /** The GL backend it was started with. */
  backend: BackendInfo;
  pid?: number;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  /** What the browser is for, for the message when it does not start. Default: the documents' PDFs. */
  purpose?: string;
  /** Print the page's exceptions to stderr as they happen (default true: the documents' renderer). */
  echoErrors?: boolean;
  /** The GL backend (default `swiftshader`); `PROTOBOARD_RENDER_BACKEND` wins. */
  backend?: GlBackendRequest;
  /** For tests and the doctor: the platform whose GPU flags are used. */
  platform?: NodeJS.Platform;
  /** The DevTools transport (default `pipe`); `PROTOBOARD_CDP_TRANSPORT` wins. */
  transport?: CdpTransport;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SwiftShader WebGL (Chromium's SwiftShader doc: opt-in since the automatic fallback was deprecated). */
export const SWIFTSHADER_FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/** GPU WebGL in headless Chrome, per platform (ANGLE's native backend there). */
export function gpuFlags(platform: NodeJS.Platform = process.platform): string[] {
  const on = ["--enable-gpu", "--ignore-gpu-blocklist"];
  if (platform === "win32") return ["--use-angle=d3d11", ...on];
  if (platform === "darwin") return ["--use-angle=metal", ...on];
  // Linux: Chrome's own recipe for GPU in headless (Vulkan); UNVERIFIED here (no Linux GPU machine); `auto` falls back
  return ["--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface", ...on];
}

/** A renderer string that names a software rasteriser. */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(renderer);
}

/** The backend asked for after the environment: `PROTOBOARD_RENDER_BACKEND` wins over the caller. */
export function requestedBackend(asked: GlBackendRequest | undefined, env: NodeJS.ProcessEnv = process.env): GlBackendRequest {
  const v = (env.PROTOBOARD_RENDER_BACKEND ?? "").trim().toLowerCase();
  if (v === "swiftshader" || v === "gpu" || v === "auto") return v;
  return asked ?? "swiftshader";
}

/** The transport after the environment: `PROTOBOARD_CDP_TRANSPORT` (pipe | port) wins over the caller; DEFAULT `pipe` (no port open while the browser is warm). */
export function requestedTransport(asked: CdpTransport | undefined, env: NodeJS.ProcessEnv = process.env): CdpTransport {
  const v = (env.PROTOBOARD_CDP_TRANSPORT ?? "").trim().toLowerCase();
  if (v === "pipe" || v === "port") return v;
  return asked ?? "pipe";
}

/** In the page: WebGL facts from a throwaway canvas (its context is released at once). */
export const GL_PROBE = `(() => {
  const out = { webgl2: false, webgl1: false, renderer: "", vendor: "", webgpu: typeof navigator !== "undefined" && !!navigator.gpu };
  const read = (gl) => {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    out.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    out.vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  };
  try { const g2 = document.createElement("canvas").getContext("webgl2"); if (g2) { out.webgl2 = true; out.webgl1 = true; read(g2); } } catch {}
  if (!out.webgl2) { try { const g1 = document.createElement("canvas").getContext("webgl"); if (g1) { out.webgl1 = true; read(g1); } } catch {} }
  return out;
})()`;

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const requested = requestedBackend(options.backend);
  const t0 = Date.now();
  if (requested === "swiftshader") {
    const b = await startChrome(options, SWIFTSHADER_FLAGS, "swiftshader");
    b.backend = { ...b.backend, requested, startMs: Date.now() - t0 };
    return b;
  }
  const flags = gpuFlags(options.platform);
  let why: string;
  try {
    const b = await startChrome(options, flags, "gpu");
    const gl = await b.gl().catch(() => undefined);
    if (gl && gl.webgl2 && !isSoftwareRenderer(gl.renderer)) {
      b.backend = { ...b.backend, requested, gl, startMs: Date.now() - t0 };
      return b;
    }
    why = !gl ? "the GL probe failed" : !gl.webgl2 ? "no WebGL 2 with the GPU flags" : `the GPU flags gave a software renderer (${gl.renderer})`;
    await b.close();
  } catch (e) {
    // no browser at all: the same error as the SwiftShader start would give
    if (!findBrowser()) throw e;
    why = `the browser did not start with the GPU flags: ${(e as Error).message.split("\n")[0]}`;
  }
  // `gpu` asked for and not had still renders (SwiftShader), and says why
  const b = await startChrome(options, SWIFTSHADER_FLAGS, "swiftshader");
  const gl = await b.gl().catch(() => undefined);
  b.backend = { ...b.backend, requested, ...(gl ? { gl } : {}), fallback: why, startMs: Date.now() - t0 };
  return b;
}

// ---------------------------------------------------------------------------------------------
// The DevTools connection: a pipe (default) or a WebSocket on a local port

/**
 * One DevTools connection, whichever way it is carried: text messages (one JSON object each) out and
 * in, and one close. `send` throws once the connection is closed.
 */
export interface CdpConnection {
  send(text: string): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: (why?: Error) => void): void;
  readonly open: boolean;
  close(): void;
}

/**
 * DEFAULT (W3-A, 2026-11-01): the largest single message read from the pipe (256 MiB). A screenshot of
 * an 8,000 px square view is about 100 MB of base64; a message past this closes the connection rather
 * than growing without bound.
 */
export const MAX_PIPE_MESSAGE_BYTES = 256 * 1024 * 1024;

/**
 * DevTools over Chrome's `--remote-debugging-pipe`: the browser reads commands from its fd 3 and writes
 * replies and events to its fd 4, each message one JSON text ended by a NUL byte (JSON never holds a raw
 * NUL: `JSON.stringify` escapes it). `toChrome` is our end of fd 3, `fromChrome` our end of fd 4. No port
 * is opened, so no other local process can reach the browser.
 */
export function pipeConnection(toChrome: Writable, fromChrome: Readable, maxMessageBytes = MAX_PIPE_MESSAGE_BYTES): CdpConnection {
  let open = true;
  const onMessage: ((text: string) => void)[] = [];
  const onClose: ((why?: Error) => void)[] = [];
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const shut = (why?: Error) => {
    if (!open) return;
    open = false;
    pending = [];
    pendingBytes = 0;
    for (const fn of onClose) fn(why);
  };
  fromChrome.on("data", (chunk: Buffer | string) => {
    if (!open) return;
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    let start = 0;
    for (let nul = buf.indexOf(0, start); nul >= 0; nul = buf.indexOf(0, start)) {
      const piece = buf.subarray(start, nul);
      const whole = pending.length ? Buffer.concat([...pending, piece], pendingBytes + piece.length) : piece;
      pending = [];
      pendingBytes = 0;
      start = nul + 1;
      const text = whole.toString("utf8");
      for (const fn of onMessage) fn(text);
      if (!open) return;
    }
    if (start < buf.length) {
      const rest = buf.subarray(start);
      pendingBytes += rest.length;
      if (pendingBytes > maxMessageBytes) {
        shut(new Error(`a DevTools message over ${maxMessageBytes} bytes`));
        fromChrome.destroy();
        return;
      }
      // a copy: the stream may reuse its buffer
      pending.push(Buffer.from(rest));
    }
  });
  fromChrome.on("end", () => shut());
  fromChrome.on("close", () => shut());
  fromChrome.on("error", (e) => shut(e));
  // EPIPE when the browser has gone: the next read closes the connection; never an unhandled error
  toChrome.on("error", (e) => shut(e));
  toChrome.on("close", () => shut());
  return {
    send(text) {
      if (!open) throw new Error("the browser closed the DevTools connection");
      toChrome.write(`${text}\0`);
    },
    onMessage: (fn) => void onMessage.push(fn),
    onClose: (fn) => void onClose.push(fn),
    get open() {
      return open;
    },
    close() {
      if (!open) return;
      toChrome.end();
      fromChrome.destroy();
      shut();
    },
  };
}

/** DevTools over a WebSocket (`--remote-debugging-port`: the fallback transport). */
function socketConnection(ws: WebSocket): CdpConnection {
  const onMessage: ((text: string) => void)[] = [];
  const onClose: ((why?: Error) => void)[] = [];
  let closed = false;
  ws.onmessage = (ev) => {
    for (const fn of onMessage) fn(String(ev.data));
  };
  ws.onclose = () => {
    if (closed) return;
    closed = true;
    for (const fn of onClose) fn();
  };
  return {
    send(text) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("the browser closed the DevTools connection");
      ws.send(text);
    },
    onMessage: (fn) => void onMessage.push(fn),
    onClose: (fn) => void onClose.push(fn),
    get open() {
      return !closed && ws.readyState === WebSocket.OPEN;
    },
    close: () => ws.close(),
  };
}

/** Commands with ids, replies matched to them, everything else to the listeners. Session-scoped when `sessionId` is given (flattened sessions). */
export interface CdpRpc {
  raw: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
  listeners: ((msg: any) => void)[];
  conn: CdpConnection;
}

export function cdpRpc(conn: CdpConnection): CdpRpc {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners: ((msg: any) => void)[] = [];
  conn.onMessage((text) => {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg && msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else p.resolve(msg.result);
    } else for (const l of [...listeners]) l(msg);
  });
  // a browser that dies (crash, killed) fails what waits on it instead of hanging the caller
  conn.onClose((why) => {
    for (const p of pending.values()) p.reject(new Error(`the browser closed the DevTools connection${why ? ` (${why.message})` : ""}`));
    pending.clear();
  });
  const raw = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        conn.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        pending.delete(id);
        reject(e as Error);
      }
    });
  return { raw, listeners, conn };
}

/** A page attached over a connection: everything a `Browser` is except the process. */
export type PageSession = Omit<Browser, "alive" | "backend" | "pid" | "close">;

/**
 * Opens one page and attaches to it with a flattened session (`Target.attachToTarget` with
 * `flatten: true`: the page's commands and events carry its `sessionId` on the browser's one
 * connection), then enables Page and Runtime and collects the page's errors.
 */
export async function attachPage(rpc: CdpRpc, options: { echoErrors?: boolean } = {}): Promise<PageSession> {
  const { raw, listeners } = rpc;
  const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
  const send = (method: string, params: Record<string, unknown> = {}) => raw(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");

  let errors: string[] = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ");
      if (process.env.DOCS_DEBUG) console.log(`  [page] ${text}`);
      if (msg.params.type === "error") errors.push(text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const text = msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text;
      errors.push(String(text));
      if (options.echoErrors !== false) console.error(`  [page error] ${text}`);
    }
    // a long-lived page (the render service) keeps only the last few
    if (errors.length > PAGE_ERRORS_KEPT) errors.splice(0, errors.length - PAGE_ERRORS_KEPT);
  });
  const takeErrors = () => {
    const was = errors;
    errors = [];
    return was;
  };
  const capture = async (o: CaptureOptions = {}) => {
    const format = o.format ?? "png";
    const { data } = await send("Page.captureScreenshot", {
      format,
      ...(format !== "png" && o.quality !== undefined ? { quality: Math.max(0, Math.min(100, Math.round(o.quality))) } : {}),
      ...(o.clip ? { clip: { scale: 1, ...o.clip } } : {}),
    });
    return Buffer.from(data, "base64");
  };
  const screenshot = (clip?: { x: number; y: number; width: number; height: number; scale?: number }) => capture({ format: "png", ...(clip ? { clip } : {}) });

  const navigate = async (url: string) => {
    const loaded = new Promise<void>((ok) => {
      const l = (msg: any) => {
        if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") {
          listeners.splice(listeners.indexOf(l), 1);
          ok();
        }
      };
      listeners.push(l);
    });
    await send("Page.navigate", { url });
    await loaded;
  };

  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value as T;
  };

  const setViewport = (width: number, height: number, scale = 1) =>
    send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });

  const printToPdf = async (url: string) => {
    await send("Emulation.clearDeviceMetricsOverride");
    await navigate(url);
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate(
      "Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))",
    );
    const { data } = await send("Page.printToPDF", {
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    return Buffer.from(data, "base64");
  };

  const gl = () => evaluate<GlInfo>(GL_PROBE);
  return { send, navigate, evaluate, setViewport, printToPdf, screenshot, capture, gl, takeErrors };
}

// ---------------------------------------------------------------------------------------------
// Starting the browser

/** DEFAULT (PB-1030): ms a browser gets to start and answer DevTools (the first start on a machine can be slow: macOS checks a new application). */
export const BROWSER_START_TIMEOUT_MS = 30000;
/** DEFAULT (PB-1180): the last page errors kept between two `takeErrors()` calls (a long-lived page). */
export const PAGE_ERRORS_KEPT = 200;
/** DEFAULT (PB-1030): ms `close()` waits for `Browser.close`, then for the process to exit, before it moves on. */
export const BROWSER_CLOSE_WAIT_MS = 3000;
export const BROWSER_EXIT_WAIT_MS = 5000;

/**
 * Starts the browser on the transport asked for; a pipe that does not come up (an unusual platform or
 * browser build) is tried once more on a local port, and the backend says so (`transportFallback`).
 */
async function startChrome(options: LaunchOptions, glFlags: string[], kind: BackendInfo["kind"]): Promise<Browser> {
  const transport = requestedTransport(options.transport);
  if (transport === "port") return startChromeOn(options, glFlags, kind, "port");
  try {
    return await startChromeOn(options, glFlags, kind, "pipe");
  } catch (e) {
    const err = e as Error & { noBrowser?: boolean };
    if (err.noBrowser) throw e;
    const b = await startChromeOn(options, glFlags, kind, "port");
    b.backend = { ...b.backend, transportFallback: `the DevTools pipe did not come up: ${err.message.split("\n")[0]}` };
    return b;
  }
}

async function startChromeOn(options: LaunchOptions, glFlags: string[], kind: BackendInfo["kind"], transport: CdpTransport): Promise<Browser> {
  const found = findBrowser();
  if (!found) throw Object.assign(new Error(noBrowserMessage()), { noBrowser: true });
  const bin = found.path;
  const profile = mkdtempSync(join(tmpdir(), "uhd-docs-chrome-"));
  const args = [
    "--headless=new",
    ...glFlags,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--font-render-hinting=none",
    `--user-data-dir=${profile}`,
    transport === "pipe" ? "--remote-debugging-pipe" : "--remote-debugging-port=0",
    "about:blank",
  ];
  const proc: ChildProcess =
    transport === "pipe"
      ? // fds 3 and 4 are the DevTools pipe (3: commands in, 4: replies out); stdout and stderr are drained
        spawn(bin, args, { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] })
      : spawn(bin, args, { stdio: "ignore" });
  // a browser that cannot be run at all (CHROME names nothing) says so at once
  let failed: Error | undefined;
  proc.on("error", (e) => (failed = e));
  let stderrTail = "";
  proc.stdout?.resume();
  proc.stderr?.on("data", (d: Buffer) => (stderrTail = (stderrTail + d.toString("utf8")).slice(-2000)));
  proc.stderr?.on("error", () => undefined);
  proc.stdout?.on("error", () => undefined);

  const exited = () => proc.exitCode !== null || proc.signalCode !== null;
  const fail = async (why: string): Promise<never> => {
    if (!exited()) proc.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    const enoent = failed && (failed as NodeJS.ErrnoException).code === "ENOENT";
    const tail = stderrTail.trim().split("\n").filter(Boolean).at(-1);
    throw Object.assign(
      new Error(`the browser did not start (${bin}${found.from === "PATH" || found.from === "installed" ? "" : `, from ${found.from}`}): ${why}${tail && !enoent ? ` (${tail.slice(0, 200)})` : ""}. ${options.purpose ?? "The documents are rendered to PDF with a headless Chromium-family browser"}; set CHROME to one that runs${transport === "pipe" ? ", or PROTOBOARD_CDP_TRANSPORT=port" : ""}`),
      enoent ? { noBrowser: true } : {},
    );
  };
  const whyFailed = () => (failed ? ((failed as NodeJS.ErrnoException).code === "ENOENT" ? "it does not exist" : failed.message) : exited() ? `it exited with code ${proc.exitCode ?? proc.signalCode}` : undefined);

  let conn: CdpConnection;
  if (transport === "pipe") {
    const toChrome = proc.stdio[3] as Writable | null;
    const fromChrome = proc.stdio[4] as Readable | null;
    if (!toChrome || !fromChrome) return fail(whyFailed() ?? "no DevTools pipe on fds 3 and 4");
    conn = pipeConnection(toChrome, fromChrome);
  } else {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < BROWSER_START_TIMEOUT_MS / 50 && !existsSync(portFile) && !failed && !exited(); i++) await sleep(50);
    if (!existsSync(portFile)) return fail(whyFailed() ?? `it did not open its debugging port in ${BROWSER_START_TIMEOUT_MS / 1000} s`);
    await sleep(50);
    const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((ok, no) => {
      ws.onopen = () => ok();
      ws.onerror = () => no(new Error("CDP connection failed"));
    }).catch((e: Error) => fail(e.message));
    conn = socketConnection(ws);
  }
  const rpc = cdpRpc(conn);

  // the first answer proves the browser speaks DevTools (on the pipe there is no port file to wait for)
  let timer: ReturnType<typeof setTimeout> | undefined;
  const product = await Promise.race([
    rpc.raw("Browser.getVersion").then((v) => String(v?.product ?? "")),
    new Promise<never>((_, no) => {
      timer = setTimeout(() => no(new Error(`it did not answer DevTools in ${BROWSER_START_TIMEOUT_MS / 1000} s`)), BROWSER_START_TIMEOUT_MS);
      proc.once("exit", () => setTimeout(() => no(new Error(whyFailed() ?? "it exited")), 20));
      proc.once("error", () => no(new Error(whyFailed() ?? "it could not be run")));
    }),
  ])
    .catch(async (e: Error) => {
      conn.close();
      // a process that could not be run says why on its next tick
      await sleep(50);
      return fail(whyFailed() ?? e.message);
    })
    .finally(() => clearTimeout(timer));

  const page = await attachPage(rpc, options);
  const alive = () => !exited() && conn.open;

  const close = async () => {
    try {
      await Promise.race([rpc.raw("Browser.close"), sleep(BROWSER_CLOSE_WAIT_MS)]);
    } catch {
      /* already gone */
    }
    conn.close();
    // wait for Chrome to exit (it may still be writing its profile), then remove the profile;
    // a profile that cannot be removed is left in the temp folder, never a failed render
    const gone = exited() ? Promise.resolve() : new Promise<void>((ok) => proc.once("exit", () => ok()));
    proc.kill();
    await Promise.race([gone, sleep(BROWSER_EXIT_WAIT_MS)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* left in tmp */
    }
  };

  const backend: BackendInfo = { kind, requested: kind === "gpu" ? "gpu" : "swiftshader", flags: glFlags, transport, ...(product ? { product } : {}), startMs: 0 };
  return { ...page, alive, backend, pid: proc.pid, close };
}

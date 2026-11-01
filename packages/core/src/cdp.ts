/**
 * Minimal Chrome DevTools Protocol client: one headless Chrome, one page,
 * evaluate / screenshot / printToPDF. No dependencies (Node's WebSocket).
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
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, noBrowserMessage } from "./browser.js";

// The render service's public surface is its own entry, `@protoboardai/core/render-service`
// (./render-service/index.ts); its modules import only types from this file.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export type GlBackendRequest = "swiftshader" | "gpu" | "auto";

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

async function startChrome(options: LaunchOptions, glFlags: string[], kind: BackendInfo["kind"]): Promise<Browser> {
  const found = findBrowser();
  if (!found) throw new Error(noBrowserMessage());
  const bin = found.path;
  const profile = mkdtempSync(join(tmpdir(), "uhd-docs-chrome-"));
  const proc: ChildProcess = spawn(
    bin,
    [
      "--headless=new",
      ...glFlags,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--font-render-hinting=none",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  // a browser that cannot be run at all (CHROME names nothing) says so at once
  let failed: Error | undefined;
  proc.on("error", (e) => (failed = e));

  const portFile = join(profile, "DevToolsActivePort");
  // the first start of a browser on a machine can take a while (macOS checks a new application)
  for (let i = 0; i < 600 && !existsSync(portFile) && !failed && proc.exitCode === null; i++) await sleep(50);
  if (!existsSync(portFile)) {
    rmSync(profile, { recursive: true, force: true });
    const why = failed ? ((failed as NodeJS.ErrnoException).code === "ENOENT" ? "it does not exist" : failed.message) : proc.exitCode !== null ? `it exited with code ${proc.exitCode}` : "it did not open its debugging port in 30 s";
    throw new Error(`the browser did not start (${bin}${found.from === "PATH" || found.from === "installed" ? "" : `, from ${found.from}`}): ${why}. ${options.purpose ?? "The documents are rendered to PDF with a headless Chromium-family browser"}; set CHROME to one that runs`);
  }
  await sleep(50);
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");

  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise<void>((ok, fail) => {
    ws.onopen = () => ok();
    ws.onerror = () => fail(new Error("CDP connection failed"));
  });
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners: ((msg: any) => void)[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else p.resolve(msg.result);
    } else for (const l of listeners) l(msg);
  };
  // a browser that dies (crash, killed) fails what waits on it instead of hanging the caller
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error("the browser closed the DevTools connection"));
    pending.clear();
  };
  const raw = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const product = await raw("Browser.getVersion")
    .then((v) => String(v.product ?? ""))
    .catch(() => "");
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
    // a long-lived page (the render service) keeps at most the last 200
    if (errors.length > 200) errors.splice(0, errors.length - 200);
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
  const alive = () => proc.exitCode === null && proc.signalCode === null && ws.readyState === WebSocket.OPEN;

  const close = async () => {
    try {
      await Promise.race([raw("Browser.close"), sleep(3000)]);
    } catch {
      /* already gone */
    }
    ws.close();
    // wait for Chrome to exit (it may still be writing its profile), then remove the profile;
    // a profile that cannot be removed is left in the temp folder, never a failed render
    const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : new Promise<void>((ok) => proc.once("exit", () => ok()));
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* left in tmp */
    }
  };

  const backend: BackendInfo = { kind, requested: kind === "gpu" ? "gpu" : "swiftshader", flags: glFlags, ...(product ? { product } : {}), startMs: 0 };
  return { send, navigate, evaluate, setViewport, printToPdf, screenshot, capture, gl, takeErrors, alive, backend, pid: proc.pid, close };
}

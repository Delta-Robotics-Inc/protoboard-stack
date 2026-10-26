/**
 * Minimal Chrome DevTools Protocol client: one headless Chrome, one page,
 * evaluate / screenshot / printToPDF. No dependencies (Node's WebSocket).
 * The documents (ext-docs) print with it; `protoboard views check` renders
 * the viewer's tabs with it (PB-1030).
 *
 * The browser is the one @protoboardai/core finds (browser.ts: Google
 * Chrome, Chromium, Microsoft Edge or Brave where each platform installs
 * them; $CHROME wins), the same one the `chrome` tool's probe reports. It is
 * started with SwiftShader so WebGL renders the same with or without a GPU.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, noBrowserMessage } from "./browser.js";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export interface Browser {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  navigate: (url: string) => Promise<void>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  setViewport: (width: number, height: number, scale?: number) => Promise<void>;
  printToPdf: (url: string) => Promise<Buffer>;
  /** A PNG of the page as drawn (WebGL included), or of a region of it in CSS pixels. */
  screenshot: (clip?: { x: number; y: number; width: number; height: number; scale?: number }) => Promise<Buffer>;
  /** Uncaught exceptions and console errors since the last call (and clears them). */
  takeErrors: () => string[];
  close: () => Promise<void>;
}

export interface LaunchOptions {
  /** What the browser is for, for the message when it does not start. Default: the documents' PDFs. */
  purpose?: string;
  /** Print the page's exceptions to stderr as they happen (default true: the documents' renderer). */
  echoErrors?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const found = findBrowser();
  if (!found) throw new Error(noBrowserMessage());
  const bin = found.path;
  const profile = mkdtempSync(join(tmpdir(), "uhd-docs-chrome-"));
  const proc: ChildProcess = spawn(
    bin,
    [
      "--headless=new",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
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
  const raw = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
  const send = (method: string, params: Record<string, unknown> = {}) => raw(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");

  const consoleLines: string[] = [];
  let errors: string[] = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ");
      if (process.env.DOCS_DEBUG) console.log(`  [page] ${text}`);
      consoleLines.push(text);
      if (msg.params.type === "error") errors.push(text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const text = msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text;
      errors.push(String(text));
      if (options.echoErrors !== false) console.error(`  [page error] ${text}`);
    }
  });
  const takeErrors = () => {
    const was = errors;
    errors = [];
    return was;
  };
  const screenshot = async (clip?: { x: number; y: number; width: number; height: number; scale?: number }) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    return Buffer.from(data, "base64");
  };

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

  const close = async () => {
    try {
      await raw("Browser.close");
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

  return { send, navigate, evaluate, setViewport, printToPdf, screenshot, takeErrors, close };
}

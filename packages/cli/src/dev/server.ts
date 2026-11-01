/**
 * `protoboard dev` (PB-815): Protoboard's web viewer (@protoboardai/web-viewer,
 * the browser shell over the viewer stack, docs/specs/viewer-stack.md) on the
 * project, with a Protoboard adapter.
 *
 * - Builds the project's UHD bundle (every validator that can run, so the
 *   bundle carries Protoboard's aggregate diagnostics) in a child process,
 *   and serves it with the viewer's own handler (`viewerHandler`), which
 *   resolves artifacts against each definition's base (the project, a package)
 *   and serves only files the bundle references, inside their base.
 * - Serves a host page that mounts the web viewer (`mountWebViewer`) and
 *   passes the dev session's own findings as host diagnostics, and the views
 *   the project's extensions contribute as tabs.
 * - Watches the project's sources, parts, configuration and display file;
 *   rebuilds on a change and pushes the new bundle into the open viewer, which
 *   keeps its view, drill level and layout.
 * - Writes layout edits from the viewer (`onLayoutChange`) to the display
 *   file under `diagram.layouts`, and pushes a display file changed on disk
 *   (by hand, by git) to the viewer.
 * - Relays the viewer's host messages when the page is framed (relay.js;
 *   parent origins: `hostOrigins`), and answers where a definition or an
 *   instance is written (`/__protoboard/source`) from the build's source
 *   index, for the viewer's openSource.
 * - Lets a host's own page read the session: a GET from an allowed host
 *   origin (`hostOrigins`, default VS Code webviews) of the bundle, its
 *   artifacts, the state or the events gets CORS headers, so the VS Code
 *   extension's viewer tabs load them without framing the page. Nothing
 *   else is opened: not the page (it carries the write token), not the
 *   source lookup, not writes.
 *
 * - Records itself in `.protoboard/local/dev.json` (URL, session, pid) while
 *   it runs, so an editor can attach to it instead of starting another; the
 *   state route returns the same session, which tells a live server from a
 *   stale record.
 *
 * - The 3D view's state (PB-1178): the page hands the live view state over
 *   400 ms after it last changed, and the server keeps it per user in
 *   `.protoboard/local/viewer-state.json` (git-ignored; the state route
 *   carries it back to a page that opens); named views and annotations are
 *   written to the display file only on an explicit save (`/__protoboard/
 *   display-views`), and only when they changed.
 * - The live-tab bridge (PB-1178, ./bridge.ts, docs/reference/viewer-bridge.md):
 *   an agent with the record's bridge key mints a session token and sends
 *   batches to the open tab (this page, or a VS Code tab the extension host
 *   relays), and gets the tab's reply, or `not-run` / `may-have-run`.
 *
 * Bound to 127.0.0.1 by default, answering only requests addressed to a
 * loopback name. Writes need the session token the page carries and a JSON
 * body, so another site's page cannot post a layout. Bridge calls need the
 * bridge key or a session token in a header (a page on another origin cannot
 * set one without a preflight, which is refused) and are refused with a
 * foreign Origin.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stableStringify } from "@protoboardai/core";
import type { BuildReport } from "./build-worker.js";
import { applyViewerLayout, formatDisplay, parseLayoutRequest, type DisplayFile } from "./layout.js";
import { DEV_ROUTES, DEV_SCRIPT, FAVICON_SVG, TOKEN_HEADER, devPage } from "./page.js";
import { SOURCES_FILE, resolveSource, type SourceIndex } from "./sources.js";
import { DEFAULT_HOST_ORIGINS, originAllowed } from "./relay.js";
import { PARTS_PREFIX, partsRoutes } from "./parts.js";
import { cliTelemetryMode, versionInventory } from "../telemetry.js";
import { BRIDGE_KEY_HEADER, BRIDGE_ROUTES, BRIDGE_SESSION_HEADER, LiveBridge, MAX_BATCH_BYTES, parseBatchBody } from "./bridge.js";
import { MAX_VIEWER_STATE_BYTES, parsePresentation, parseViewerStateFile, readViewerState, saveViewerState, withPresentation } from "./viewState.js";
import { SNAPSHOTS_DIR, readSnapshot, snapshotKey, writeSnapshot } from "@protoboardai/core/render-service";
// TODO(W1-B handoff): `@protoboardai/core/telemetry` once core/package.json exports it
import { MAX_LINE_BYTES, appendTelemetry, enrichViewerRecord } from "@protoboardai/core/telemetry";

export const DEFAULT_DEV_PORT = 5180;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * A write's Origin is the page's own: the host it asked (http or https: a
 * proxy may terminate TLS), or the host a proxy forwarded it from. Writes
 * also need the session token, which only the page carries.
 */
function sameSite(origin: string, req: IncomingMessage): boolean {
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim().toLowerCase();
  return host === (req.headers.host ?? "").toLowerCase() || (!!forwarded && host === forwarded);
}
const MAX_BODY = 4 << 20;
/** The running session's record, relative to the project root. */
export const DEV_RECORD = join(".protoboard", "local", "dev.json");

/** `.protoboard/local/dev.json`: where a running `protoboard dev` serves the project. */
export interface DevRecord {
  schema: "protoboard.dev/v0";
  url: string;
  port: number;
  /** Process serving it. */
  pid: number;
  /** Matches `session` from the state route while this server runs. */
  session: string;
  root: string;
  startedAt: string;
  /**
   * The live-tab bridge (PB-1178): `key` mints agent session tokens
   * (`POST <url>__protoboard/bridge/session`). Made per run; the record is
   * git-ignored and removed when the server stops.
   */
  bridge?: { key: string; version: 1 };
}

/** A finding from the dev session itself, shown in the viewer next to the project's (`UhdBundleDiagnostic`). */
export interface DevDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  entity?: { kind: string; id: string };
  source?: { file: string; line?: number };
  validator: "protoboard/dev";
}

/** One structured log line. */
export interface DevLogEvent {
  level: "info" | "warn" | "error";
  event: "listening" | "build" | "build-failed" | "display" | "layout" | "layout-refused" | "watch" | "error" | "stopped" | "bridge" | "view-state";
  message: string;
  [key: string]: unknown;
}

export interface DevOptions {
  /** Project root (holds protoboard.config.ts). */
  root: string;
  /** First port to try (default 5180; 0 picks any free port). */
  port?: number;
  /** Fail when `port` is taken instead of trying the next ones. */
  strictPort?: boolean;
  /** Interface to bind (default 127.0.0.1). Another address also accepts requests addressed to any host name. */
  host?: string;
  /** Watch the project and rebuild on changes (default true). */
  watch?: boolean;
  /** Quiet period after a change before rebuilding (default 120 ms). */
  debounceMs?: number;
  log?: (event: DevLogEvent) => void;
  /** Where the web viewer's built files are (default: the installed `@protoboardai/web-viewer`'s dist). */
  viewerLib?: string;
  /**
   * Origins of a window framing the page that may drive the viewer and hear
   * its events (exact origins, `scheme://*`, `*`, or `self`). Default: the
   * page's own origin and VS Code webviews (relay.js, DEFAULT_HOST_ORIGINS).
   */
  hostOrigins?: string[];
  /**
   * Host names answered besides the loopback ones when bound to loopback
   * (`*`: any). A proxy in front of the server (a browser-hosted VS Code's
   * port forwarding, code-server's `/proxy/<port>/`) may pass its own Host
   * on; the server refuses other names to keep DNS rebinding out.
   */
  allowHosts?: string[];
  /**
   * Write the session's record (.protoboard/local/dev.json) for editors to find (default true).
   * `protoboard views check` serves the project for itself only and leaves a person's session alone.
   */
  record?: boolean;
}

export interface DevServer {
  url: string;
  port: number;
  bundleFile: string;
  displayFile: string;
  /** Bundle version: increases with every rebuild or display change pushed to the viewer. */
  readonly version: number;
  /** Rebuild now (as a change would), resolving once the result is pushed. */
  rebuild(trigger?: string): Promise<BuildReport>;
  /** Resolves when no build or display update is pending. */
  idle(): Promise<void>;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);
const digest = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

/** The web viewer's built files (the page's script and stylesheet). */
export const WEB_VIEWER_FILES = ["web-viewer.js", "web-viewer.css"] as const;

/** The installed viewers: the UHD viewer's request handler (bundle, artifacts) and the web viewer's build. */
async function loadViewer(libOverride?: string) {
  const serve = (await import("@deltarobotics/uhd-viewer/serve")) as typeof import("@deltarobotics/uhd-viewer/serve");
  const pkgDir = libOverride ? undefined : dirname(require.resolve("@protoboardai/web-viewer/package.json"));
  const lib = libOverride ?? join(pkgDir!, "dist");
  for (const f of WEB_VIEWER_FILES) {
    if (!existsSync(join(lib, f))) throw new Error(`the web viewer is not built (${join(lib, f)} is missing): run \`npm run build\` in ${pkgDir ?? "@protoboardai/web-viewer"}`);
  }
  return { viewerHandler: serve.viewerHandler, lib };
}

function writeAtomic(file: string, data: string, mode?: number) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
  renameSync(tmp, file);
}

/** What a build says when the project's folder is not there any more (B5). */
export function folderGoneMessage(root: string): string {
  return `the project folder ${root} is no longer there: it was moved or deleted`;
}

/**
 * What the viewer says when the dev server cannot watch the project (B19):
 * the system refused a watcher (EMFILE, ENOSPC: too many watched files on the
 * machine), so changes to the files no longer reach the viewer.
 */
export function unwatchedMessage(what: string, e: Error): string {
  const code = (e as NodeJS.ErrnoException).code;
  const why = code === "EMFILE" || code === "ENOSPC" ? `the system allows no more file watchers (${code})` : e.message;
  return `Live reload is off: the dev server cannot watch ${what} (${why}). The viewer does not follow changes to the files; close programs that watch many files, then reload the window.`;
}

/** Directories to watch for a project: [dir, recursive]. Nested ones are dropped. */
export function watchPlan(root: string, w: NonNullable<BuildReport["watch"]>): [string, boolean][] {
  const dirs: [string, boolean][] = [[root, false]];
  const tree = (dir: string) => {
    // never the whole project recursively: its node_modules would be watched too
    if (dir !== root) return dirs.push([dir, true]);
    if (!existsSync(root)) return;
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && !ignored(e.name, "")) dirs.push([join(root, e.name), true]);
    }
  };
  for (const g of w.sources) {
    const m = g.match(/^(.*?)\/?\*\*/);
    if (m) tree(resolve(root, m[1] || "."));
    else dirs.push([resolve(root, dirname(g)), false]);
  }
  tree(resolve(root, dirname(w.catalog)));
  dirs.push([resolve(root, dirname(w.display)), false]);
  if (w.scenarios) dirs.push([resolve(root, dirname(w.scenarios)), false]);
  const recursive = dirs.filter(([, r]) => r).map(([d]) => d);
  const inside = (d: string, parent: string) => d !== parent && (d + sep).startsWith(parent.endsWith(sep) ? parent : parent + sep);
  const seen = new Set<string>();
  return dirs
    .filter(([d, r]) => (r ? !recursive.some((p) => inside(d, p)) : !recursive.some((p) => d === p || inside(d, p))))
    .filter(([d]) => (seen.has(d) ? false : (seen.add(d), true)));
}

/** Files whose changes do not matter: dependencies, build output, editor temporaries. */
function ignored(rel: string, displayRel: string): boolean {
  if (rel === displayRel) return false;
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (parts.some((p) => p === "node_modules" || p === "__pycache__" || p === ".git" || p === ".protoboard")) return true;
  if (name.startsWith(".") || name.endsWith("~") || /\.(swp|swx|tmp|crdownload)$/.test(name) || name === "4913") return true;
  return parts[0] === "operations";
}

export async function startDev(options: DevOptions): Promise<DevServer> {
  const root = resolve(options.root);
  const log = options.log ?? (() => {});
  const host = options.host ?? "127.0.0.1";
  const loopback = LOOPBACK.has(host);
  const extra = new Set((options.allowHosts ?? []).map((h) => h.toLowerCase()));
  const allowHost = !loopback || extra.has("*") ? () => true : (h: string) => LOOPBACK.has(h) || extra.has(h.toLowerCase());
  const viewer = await loadViewer(options.viewerLib);
  const bundleFile = join(root, ".protoboard", "build", "uhd-bundle.json");
  // the bundle, its artifacts and the view sidecars beside each referenced GLB (`X.view.glb`, `X.view.coarse.glb`,
  // `X.view.json`): uhd-viewer's own handler serves all of them, with one containment check (W2-D removed the copy here)
  const handleViewer = viewer.viewerHandler({ bundleFile, allowHost });
  const token = randomBytes(18).toString("base64url");
  const session = randomBytes(9).toString("base64url");
  // the live-tab bridge (./bridge.ts): its key is only in the record, so only a session that writes one is reachable
  const bridge = new LiveBridge({ log: (message) => log({ level: "info", event: "bridge", message }) });
  /** `sha256:<hex>` of the bundle file (as the render service's snapshots name it), kept until the file changes. */
  let hashed: { mtimeMs: number; size: number; hash: string } | undefined;
  const bundleHash = (): string | undefined => {
    try {
      const { mtimeMs, size } = statSync(bundleFile);
      if (!hashed || hashed.mtimeMs !== mtimeMs || hashed.size !== size) hashed = { mtimeMs, size, hash: `sha256:${digest(readFileSync(bundleFile))}` };
      return hashed.hash;
    } catch {
      return undefined;
    }
  };
  /** A person's session (not `views check`'s own): it keeps and restores the viewer's state and offers the bridge. */
  const personal = options.record !== false;
  const tsx = pathToFileURL(require.resolve("tsx/esm")).href;
  const worker = fileURLToPath(new URL("./build-worker.ts", import.meta.url));

  let watchConfig: NonNullable<BuildReport["watch"]> = { display: ".protoboard/display.json", sources: ["src/**/*.uhd.ts"], catalog: "parts/catalog" };
  const displayFile = () => resolve(root, watchConfig.display);
  const displayRel = () => relative(root, displayFile());
  let version = 0;
  let devDiagnostics: DevDiagnostic[] = [];
  let lastBuild: BuildReport | undefined;
  /** Views the extensions of the last good build contribute (the web viewer's extra tabs). */
  let lastViews: NonNullable<BuildReport["views"]> = [];
  let lastPartStatus: NonNullable<BuildReport["partStatus"]> = {};
  let building = false;
  let closed = false;
  let child: ChildProcess | undefined;
  /** Digest of the display file as this server last wrote it (its own write is not news). */
  let ownDisplay: string | undefined;
  let message = "starting";
  /** Why the project is not watched (B19): live reload is off, and the viewer says so. */
  let unwatched: string | undefined;
  const notWatching = (dir: string, e: Error) => {
    const what = relative(root, dir) || "the project folder";
    log({ level: "warn", event: "watch", message: `cannot watch ${relative(root, dir) || "."}: ${e.message}` });
    // a folder deleted while watched (ENOENT) is ordinary: the next build watches what is there. The system refusing
    // more watchers is what stops live reload
    const code = (e as NodeJS.ErrnoException).code;
    if (closed || code === "ENOENT" || code === "ENOTDIR") return;
    unwatched = unwatchedMessage(what, e);
    broadcast("watch", { unwatched });
  };

  // ---- events to open pages
  const clients = new Set<ServerResponse>();
  const send = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event: string, data: unknown) => {
    for (const res of clients) send(res, event, data);
  };
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, 15000);
  heartbeat.unref();

  // ---- one task at a time: builds and display updates both rewrite the bundle
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };
  /** Run a task in the background: a failure is logged, never left unhandled. */
  const background = (task: Promise<unknown>) => void task.catch((e: Error) => log({ level: "error", event: "error", message: e.message }));

  const runWorker = () =>
    new Promise<BuildReport>((ok) => {
      const t0 = Date.now();
      // a project folder moved or deleted under the server (B5): the system would answer the spawn with ENOENT
      if (!existsSync(root)) return ok({ ok: false, ms: 0, error: folderGoneMessage(root) });
      const proc = spawn(process.execPath, ["--import", tsx, worker, root, bundleFile], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      child = proc;
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d));
      proc.stderr.on("data", (d) => (err += d));
      const timer = setTimeout(() => proc.kill(), 5 * 60 * 1000);
      // a process that could not start emits "error" (and maybe no "close"): never an unhandled event that ends the server
      let settled = false;
      proc.on("error", (e) => {
        clearTimeout(timer);
        child = undefined;
        if (settled) return;
        settled = true;
        ok({ ok: false, ms: Date.now() - t0, error: existsSync(root) ? `the build process could not start: ${e.message}` : folderGoneMessage(root) });
      });
      proc.on("close", (code, signal) => {
        clearTimeout(timer);
        child = undefined;
        if (settled) return;
        settled = true;
        const last = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
        try {
          // the whole build as the session sees it, process start included
          if (last) return ok({ ...(JSON.parse(last) as BuildReport), ms: Date.now() - t0 });
        } catch {
          // fall through: report the process failure
        }
        const why = signal ? `stopped by ${signal}` : `exited with ${code}`;
        ok({ ok: false, ms: Date.now() - t0, error: `build process ${why}${err.trim() ? `: ${err.trim().split("\n").slice(-2).join(" ")}` : ""}` });
      });
    });

  /** Make the bundle's display hints match the display file on disk. */
  const syncDisplay = (): boolean => {
    if (!existsSync(bundleFile)) return false;
    const file = displayFile();
    let display: unknown;
    try {
      display = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    } catch (e) {
      devDiagnostics = [
        ...devDiagnostics.filter((d) => d.code !== "PB_DEV_DISPLAY_INVALID"),
        { code: "PB_DEV_DISPLAY_INVALID", severity: "error", message: `${displayRel()} is not valid JSON (${(e as Error).message}); the viewer keeps the last valid layout`, source: { file: displayRel() }, validator: "protoboard/dev" },
      ];
      return true;
    }
    devDiagnostics = devDiagnostics.filter((d) => d.code !== "PB_DEV_DISPLAY_INVALID");
    const bundle = JSON.parse(readFileSync(bundleFile, "utf8")) as Record<string, unknown>;
    if (stableStringify(bundle.display ?? null) === stableStringify(display ?? null)) return false;
    if (display === undefined) delete bundle.display;
    else bundle.display = display;
    writeAtomic(bundleFile, stableStringify(bundle));
    return true;
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const summary = (r: BuildReport) => (r.ok ? `built in ${(r.ms / 1000).toFixed(1)}s: ${plural(r.counts!.error, "error")} · ${plural(r.counts!.warning, "warning")}` : `build failed: ${r.error}`);

  const build = (triggers: string[]) =>
    enqueue(async () => {
      building = true;
      broadcast("status", { state: "busy", message: triggers.length ? `rebuilding (${triggers.slice(0, 3).join(", ")}${triggers.length > 3 ? ", …" : ""})` : "building" });
      const r = await runWorker();
      building = false;
      if (closed) return r;
      lastBuild = r;
      if (r.ok) {
        if (r.watch) watchConfig = r.watch;
        lastViews = r.views ?? [];
        lastPartStatus = r.partStatus ?? {};
        devDiagnostics = devDiagnostics.filter((d) => d.code !== "PB_DEV_BUILD_FAILED");
        syncDisplay(); // a layout saved while the build ran
        log({ level: "info", event: "build", message: summary(r), ms: r.ms, counts: r.counts, trigger: triggers, version: version + 1 });
        rewatch();
        // the configuration (its libraries) or the parts may have changed
        if (triggers.length) parts.changed();
      } else {
        devDiagnostics = [
          ...devDiagnostics.filter((d) => d.code !== "PB_DEV_BUILD_FAILED"),
          { code: "PB_DEV_BUILD_FAILED", severity: "error", message: `rebuild failed, showing the last good bundle: ${r.error}`, validator: "protoboard/dev" },
        ];
        log({ level: "error", event: "build-failed", message: summary(r), ms: r.ms, error: r.error, trigger: triggers });
      }
      version++;
      message = summary(r);
      broadcast("bundle", { version, reason: "source", diagnostics: devDiagnostics, failed: !r.ok, message, partStatus: lastPartStatus, ...(unwatched ? { unwatched } : {}) });
      return r;
    });

  const displayChanged = () =>
    enqueue(async () => {
      const file = displayFile();
      const bytes = existsSync(file) ? readFileSync(file) : undefined;
      if (bytes && ownDisplay === digest(bytes)) return; // our own save, already pushed
      ownDisplay = undefined;
      if (!syncDisplay()) return;
      version++;
      message = devDiagnostics.some((d) => d.code === "PB_DEV_DISPLAY_INVALID") ? `${displayRel()} is not valid JSON` : `${displayRel()} changed on disk`;
      log({ level: "info", event: "display", message, version });
      broadcast("bundle", { version, reason: "display", diagnostics: devDiagnostics, message });
    });

  // ---- watching
  const watchers = new Map<string, FSWatcher>();
  let timer: NodeJS.Timeout | undefined;
  const changed = new Set<string>();
  let displayTouched = false;
  const onChange = (dir: string) => (_event: string, name: string | Buffer | null) => {
    if (closed || !name) return;
    const rel = relative(root, join(dir, name.toString()));
    if (rel.startsWith("..") || isAbsolute(rel) || ignored(rel, displayRel())) return;
    if (rel === displayRel()) displayTouched = true;
    else if (dir === root || !watchers.has(`${dir}|true`)) {
      // a folder watched on its own: the configuration, sources named one by one, and new folders the next build watches
      const named = rel === "protoboard.config.ts" || watchConfig.sources.includes(rel) || (watchConfig.scenarios !== undefined && rel === watchConfig.scenarios);
      let folder = false;
      try {
        folder = statSync(join(root, rel)).isDirectory();
      } catch {
        // deleted: only a named file matters
      }
      if (!named && !(folder && dir === root)) return;
      changed.add(rel);
    } else changed.add(rel);
    clearTimeout(timer);
    timer = setTimeout(flush, options.debounceMs ?? 120);
  };
  const flush = () => {
    if (displayTouched) {
      displayTouched = false;
      background(displayChanged());
    }
    if (changed.size) {
      const triggers = [...changed].sort();
      changed.clear();
      background(build(triggers));
    }
  };
  function rewatch() {
    if (options.watch === false || closed) return;
    for (const [dir, recursive] of watchPlan(root, watchConfig)) {
      const key = `${dir}|${recursive}`;
      if (watchers.has(key) || !existsSync(dir)) continue;
      try {
        const w = watch(dir, { recursive }, onChange(dir));
        w.on("error", (e) => {
          watchers.delete(key);
          notWatching(dir, e);
        });
        watchers.set(key, w);
      } catch (e) {
        notWatching(dir, e as Error);
      }
    }
  }

  // ---- layout edits from the viewer
  const saveLayout = async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const origin = req.headers.origin;
    if (req.headers[TOKEN_HEADER] !== token) return json(403, { error: "missing or wrong session token" });
    if (origin && !sameSite(origin, req)) return json(403, { error: `origin ${origin} not allowed` });
    if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return json(415, { error: "expected application/json" });
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) return json(413, { error: "layout too large" });
      chunks.push(c as Buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(400, { error: "body is not JSON" });
    }
    const parsed = parseLayoutRequest(body);
    if ("error" in parsed) {
      log({ level: "warn", event: "layout-refused", message: parsed.error });
      return json(400, parsed);
    }
    const file = displayFile();
    let current: DisplayFile = {};
    let previous: string | undefined;
    try {
      if (existsSync(file)) current = JSON.parse((previous = readFileSync(file, "utf8"))) as DisplayFile;
    } catch (e) {
      return json(409, { error: `${displayRel()} is not valid JSON (${(e as Error).message}); fix it before saving a layout` });
    }
    const merged = applyViewerLayout(current, parsed.layout, parsed.snapshot);
    devDiagnostics = devDiagnostics.filter((d) => d.code !== "PB_DEV_LAYOUT_NOT_SAVED");
    if (merged.skipped.length) {
      devDiagnostics.push(...merged.skipped.map((s): DevDiagnostic => ({ code: "PB_DEV_LAYOUT_NOT_SAVED", severity: "warning", message: s.reason, source: { file: displayRel() }, validator: "protoboard/dev" })));
    }
    if (merged.levels.length) {
      const data = formatDisplay(merged.display, previous);
      ownDisplay = digest(data);
      writeAtomic(file, data);
      log({ level: "info", event: "layout", message: `saved ${merged.levels.map((l) => (l === "" ? "top level" : `level ${l}`)).join(", ")} to ${displayRel()}`, levels: merged.levels, skipped: merged.skipped });
      background(enqueue(async () => {
        syncDisplay();
        version++;
        broadcast("bundle", { version, reason: "layout", client: parsed.client, diagnostics: devDiagnostics, message: `layout saved · ${displayRel()}` });
      }));
    } else if (merged.skipped.length) log({ level: "warn", event: "layout", message: merged.skipped.map((s) => s.reason).join("; "), skipped: merged.skipped });
    return json(200, { file: displayRel(), levels: merged.levels, skipped: merged.skipped });
  };

  // ---- local telemetry from the page (PB-1181): the session's token, the page's origin, JSON, one record of at most 64 kB
  const saveTelemetry = async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const origin = req.headers.origin;
    if (req.headers[TOKEN_HEADER] !== token) return json(403, { error: "missing or wrong session token" });
    if (origin && !sameSite(origin, req)) return json(403, { error: `origin ${origin} not allowed` });
    if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return json(415, { error: "expected application/json" });
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_LINE_BYTES * 2) return json(413, { error: "record too large" });
      chunks.push(c as Buffer);
    }
    let body: { record?: unknown };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { record?: unknown };
    } catch {
      return json(400, { error: "body is not JSON" });
    }
    // the switch is read on every record: `protoboard telemetry off` takes effect without a restart
    const { mode } = cliTelemetryMode();
    const inv = versionInventory();
    const record = enrichViewerRecord(root, body?.record, { host: "dev-web", versions: { ...(inv.stack ? { stack: inv.stack } : {}) } });
    const r = appendTelemetry(root, record, { mode });
    return json(r.written ? 200 : r.reason === "off" ? 202 : 400, { written: r.written, ...(r.reason ? { reason: r.reason } : {}) });
  };

  // ---- the 3D view's state and the live-tab bridge (PB-1178)
  /** A JSON body up to `max` bytes, or the status and error to answer. */
  const readJson = async (req: IncomingMessage, max: number): Promise<{ body: unknown } | { status: number; error: string }> => {
    if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return { status: 415, error: "expected application/json" };
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > max) return { status: 413, error: "body too large" };
      chunks.push(c as Buffer);
    }
    try {
      return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { status: 400, error: "body is not JSON" };
    }
  };
  /** The dev page's own writes: its token, its origin. */
  const fromPage = (req: IncomingMessage) => req.headers[TOKEN_HEADER] === token && (!req.headers.origin || sameSite(req.headers.origin, req));
  /** A local client with the record's key (the extension host's relay): no browser page sends one (no Origin, or this server's own). */
  const withKey = (req: IncomingMessage) => personal && bridge.keyMatches(req.headers[BRIDGE_KEY_HEADER]) && (!req.headers.origin || sameSite(req.headers.origin, req));
  /** Relays (the VS Code extension host) by id, and the tabs they announced. */
  const relays = new Map<string, ServerResponse>();
  const bridgeRoute = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const post = req.method === "POST";
    // ---- the saved live view state: the page hands it over after its 400 ms debounce
    if (path === DEV_ROUTES.viewState) {
      if (!fromPage(req) && !withKey(req)) return reply(403, { error: "missing or wrong session token" });
      if (req.method === "GET") return reply(200, readViewerState(root) ?? {});
      if (!post) return reply(405, { error: "GET or POST" });
      const r = await readJson(req, MAX_VIEWER_STATE_BYTES);
      if ("error" in r) return reply(r.status, { error: r.error });
      const file = parseViewerStateFile((r.body as { file?: unknown })?.file ?? r.body);
      if ("error" in file) return reply(400, file);
      // `views check` serves the project for itself: it keeps nothing of a person's view
      if (!personal) return reply(202, { written: false, reason: "not a personal session" });
      const saved = saveViewerState(root, file);
      if (saved.written) log({ level: "info", event: "view-state", message: `view state saved · ${relative(root, saved.file)}` });
      return reply(200, { written: saved.written, file: relative(root, saved.file).split(sep).join("/") });
    }
    // ---- a save point from the visible viewer (PB-1180): the frame on settle or hide, in the render service's files
    if (path === DEV_ROUTES.snapshot) {
      if (!fromPage(req) && !withKey(req)) return reply(403, { error: "missing or wrong session token" });
      if (!personal) return reply(202, { written: false, reason: "not a personal session" });
      const r = await readJson(req, 16 << 20);
      if ("error" in r) return reply(r.status, { error: r.error });
      const b = (r.body ?? {}) as { png?: unknown; meta?: Record<string, unknown> };
      const m = b.meta ?? {};
      if (typeof b.png !== "string" || !/^[A-Za-z0-9+/=]+$/.test(b.png) || typeof m.level !== "string" || typeof m.view !== "string" || typeof m.width !== "number" || typeof m.height !== "number")
        return reply(400, { error: "expected { png: base64, meta: { level, view, width, height, css, camera, viewState } }" });
      const png = Buffer.from(b.png, "base64");
      if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return reply(400, { error: "png is not a PNG" });
      const meta = {
        view: m.view,
        level: m.level,
        width: m.width,
        height: m.height,
        css: (m.css ?? { width: m.width, height: m.height, dpr: 1 }) as { width: number; height: number; dpr: number },
        ...(m.camera ? { camera: m.camera } : {}),
        viewState: m.viewState ?? {},
        bundleHash: bundleHash() ?? "",
        revision: version,
        backend: "gpu" as const,
        gpu: typeof m.gpu === "string" ? m.gpu.slice(0, 200) : "",
        ...(typeof m.theme === "string" ? { theme: m.theme } : {}),
        takenAt: typeof m.takenAt === "string" ? m.takenAt : new Date().toISOString(),
        source: "viewer" as const,
      };
      const out = writeSnapshot(root, png, meta as unknown as Parameters<typeof writeSnapshot>[2]);
      return reply(200, { written: true, key: out.meta.key });
    }
    // ---- named views and annotations: an explicit save, written to the display file only when they changed
    if (path === DEV_ROUTES.displayViews) {
      if (!post) return reply(405, { error: "POST" });
      if (!fromPage(req) && !withKey(req)) return reply(403, { error: "missing or wrong session token" });
      // `views check` and the render service serve the project for themselves: they never write the display file
      if (!personal) return reply(202, { written: false, reason: "not a personal session" });
      const r = await readJson(req, MAX_BODY);
      if ("error" in r) return reply(r.status, { error: r.error });
      const pres = parsePresentation((r.body as { presentation?: unknown })?.presentation ?? r.body);
      if ("error" in pres) return reply(400, pres);
      const file = displayFile();
      let current: DisplayFile = {};
      let previous: string | undefined;
      try {
        if (existsSync(file)) current = JSON.parse((previous = readFileSync(file, "utf8"))) as DisplayFile;
      } catch (e) {
        return reply(409, { error: `${displayRel()} is not valid JSON (${(e as Error).message}); fix it before saving views` });
      }
      const merged = withPresentation(current as { spatial?: Record<string, unknown> }, pres);
      if (!merged.changed) return reply(200, { written: false, file: displayRel().split(sep).join("/") });
      const data = formatDisplay(merged.display as DisplayFile, previous);
      ownDisplay = digest(data);
      writeAtomic(file, data);
      log({ level: "info", event: "display", message: `saved ${Object.keys(pres.views).length} named view(s) to ${displayRel()}` });
      background(
        enqueue(async () => {
          syncDisplay();
          version++;
          broadcast("bundle", { version, reason: "display", diagnostics: devDiagnostics, message: `views saved · ${displayRel()}` });
        }),
      );
      return reply(200, { written: true, file: displayRel().split(sep).join("/") });
    }
    if (!personal) return reply(404, { error: "the bridge is offered by a person's dev session only" });
    // ---- an agent session: the key mints it
    if (path === BRIDGE_ROUTES.session) {
      if (!post) return reply(405, { error: "POST" });
      if (!withKey(req)) return reply(403, { error: `missing or wrong ${BRIDGE_KEY_HEADER} (read .protoboard/local/dev.json)` });
      const r = await readJson(req, 4096);
      if ("error" in r) return reply(r.status, { error: r.error });
      const s = bridge.mintSession((r.body as { name?: unknown })?.name);
      return reply(200, { token: s.token, session: s.id, actor: s.actor, header: BRIDGE_SESSION_HEADER });
    }
    // ---- a batch from an agent session, to a live tab
    if (path === BRIDGE_ROUTES.batch) {
      if (!post) return reply(405, { error: "POST" });
      if (req.headers.origin && !sameSite(req.headers.origin, req)) return reply(403, { error: "not from another origin" });
      const s = bridge.session(req.headers[BRIDGE_SESSION_HEADER]);
      if (!s) return reply(401, { error: `missing, wrong or expired ${BRIDGE_SESSION_HEADER} session token (mint one at ${BRIDGE_ROUTES.session})` });
      const r = await readJson(req, MAX_BATCH_BYTES);
      if ("error" in r) return reply(r.status, { error: r.error });
      const parsed = parseBatchBody(r.body);
      if ("error" in parsed) return reply(400, { status: "invalid", error: parsed.error });
      const outcome = await bridge.submit(s, parsed);
      return reply(200, outcome);
    }
    if (path === BRIDGE_ROUTES.state) {
      const s = bridge.session(req.headers[BRIDGE_SESSION_HEADER]);
      if (!s && !withKey(req)) return reply(401, { error: "a session token or the bridge key is needed" });
      return reply(200, { tabs: bridge.listTabs(), sessions: bridge.sessionCount, ...(s ? { session: s.id, actor: s.actor } : {}) });
    }
    // ---- a tab's reply and presence (the page, with its token; a relay, with the key)
    if (path === BRIDGE_ROUTES.reply || path === BRIDGE_ROUTES.presence) {
      if (!post) return reply(405, { error: "POST" });
      const page = fromPage(req);
      if (!page && !withKey(req)) return reply(403, { error: "missing or wrong session token" });
      // a reply may be as large as the viewer lets it be (uhd-viewer protocol.ts: 2 MB), plus its envelope
      const r = await readJson(req, (2 << 20) + MAX_BATCH_BYTES);
      if ("error" in r) return reply(r.status, { error: r.error });
      const b = (r.body ?? {}) as { id?: unknown; reply?: unknown; tab?: unknown; active?: unknown; closed?: unknown; label?: unknown; relay?: unknown };
      // the page answers for its own tab; a relay names the tab it answers for
      const tab = typeof b.tab === "string" ? (page ? `web:${b.tab}` : b.tab) : undefined;
      if (path === BRIDGE_ROUTES.reply) {
        if (typeof b.id !== "string") return reply(400, { error: "a reply needs the delivery id" });
        return reply(bridge.reply(b.id, b.reply, tab) ? 200 : 404, {});
      }
      if (!tab) return reply(400, { error: "presence needs a tab id" });
      if (b.closed === true) bridge.removeTab(tab);
      else if (!page && typeof b.relay === "string" && relays.has(b.relay)) {
        // a relayed tab: announced (or touched) by its relay
        const relayRes = relays.get(b.relay)!;
        if (!bridge.touch(tab) || b.label !== undefined)
          bridge.addTab({
            id: tab,
            kind: "vscode",
            relay: b.relay,
            ...(typeof b.label === "string" ? { label: b.label.slice(0, 120) } : {}),
            ...(b.active === true ? {} : { lastActive: 0 }),
            deliver: (envelope) => (relayRes.writableEnded || relayRes.destroyed ? false : (send(relayRes, "bridge", { tab, envelope }), true)),
          });
        if (b.active === true) bridge.touch(tab);
      } else bridge.touch(tab);
      return reply(200, { tabs: bridge.listTabs().length });
    }
    // ---- the VS Code extension host relays its tabs over an event stream
    if (path === BRIDGE_ROUTES.relay) {
      if (req.method !== "GET") return reply(405, { error: "GET" });
      if (!withKey(req)) return reply(403, { error: `missing or wrong ${BRIDGE_KEY_HEADER}` });
      const id = `relay:${randomBytes(6).toString("base64url")}`;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      send(res, "relay", { relay: id, session });
      relays.set(id, res);
      clients.add(res);
      res.on("close", () => {
        relays.delete(id);
        clients.delete(res);
        bridge.removeRelay(id);
      });
      return;
    }
    return reply(404, { error: "not found" });
  };

  // ---- requests
  const lib = (file: string, type: string) => (res: ServerResponse) => {
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(readFileSync(join(viewer.lib, file)));
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  /** Where a definition and an instance are written, from the last good build's index. */
  const source = (url: URL, res: ServerResponse) => {
    const defId = url.searchParams.get("defId") ?? undefined;
    const instancePath = url.searchParams.get("instancePath") ?? undefined;
    if (!defId && !instancePath) return json(res, 400, { error: "give defId or instancePath" });
    let index: SourceIndex;
    try {
      index = JSON.parse(readFileSync(join(dirname(bundleFile), SOURCES_FILE), "utf8")) as SourceIndex;
    } catch {
      return json(res, 503, { error: "no source index yet (the project has not built)" });
    }
    const found = resolveSource(index, root, { defId, instancePath });
    return found ? json(res, 200, found) : json(res, 404, { error: `no source known for ${defId ?? instancePath}` });
  };
  const relayFile = fileURLToPath(new URL("./relay.js", import.meta.url));
  // the library and bom tabs' data (./parts.ts); a write needs the page's token and origin, as a layout does
  const parts = partsRoutes(root);
  const routes: Record<string, (res: ServerResponse) => void> = {
    [DEV_ROUTES.page]: (res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(devPage({ name: basename(root), token, session, ...(options.hostOrigins?.length ? { hostOrigins: options.hostOrigins } : {}) }));
    },
    [DEV_ROUTES.relay]: (res) => {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(relayFile));
    },
    "/index.html": (res) => routes[DEV_ROUTES.page](res),
    // a browser that asks anyway (the page names an inline icon) gets the mark, not a 404
    "/favicon.ico": (res) => {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=86400" });
      res.end(FAVICON_SVG);
    },
    [DEV_ROUTES.script]: (res) => {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(DEV_SCRIPT);
    },
    [DEV_ROUTES.viewerJs]: lib("web-viewer.js", "text/javascript; charset=utf-8"),
    [DEV_ROUTES.viewerCss]: lib("web-viewer.css", "text/css; charset=utf-8"),
    [DEV_ROUTES.state]: (res) => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      // the saved live view state (PB-1178) comes back to a page that opens; never in a capture's own session
      const viewState = personal ? readViewerState(root) : undefined;
      const hash = bundleHash();
      res.end(JSON.stringify({ session, version, diagnostics: devDiagnostics, building, failed: lastBuild ? !lastBuild.ok : false, message, ...(unwatched ? { unwatched } : {}), views: lastViews, partStatus: lastPartStatus, display: displayRel().split(sep).join("/"), ...(viewState ? { viewState } : {}), ...(hash ? { bundleHash: hash } : {}) }));
    },
    [DEV_ROUTES.events]: (res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      send(res, "hello", { session, version });
      clients.add(res);
      res.on("close", () => clients.delete(res));
      // the dev page names itself (`?tab=`): it is a live tab of the bridge while its stream is open
      const tab = (res as ServerResponse & { pbTab?: string }).pbTab;
      if (tab && personal) {
        bridge.addTab({ id: tab, kind: "web", label: "protoboard dev page", deliver: (envelope) => (res.writableEnded || res.destroyed ? false : (send(res, "bridge", envelope), true)) });
        res.on("close", () => bridge.removeTab(tab));
      }
    },
  };
  /** Origins of host pages that may read the session (not `self`: the dev page is same-origin already). */
  const readOrigins = (options.hostOrigins?.length ? options.hostOrigins : DEFAULT_HOST_ORIGINS).filter((o) => o !== "self");
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!allowHost(hostname)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end(`host ${hostname} not allowed`);
    }
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      res.writeHead(400);
      return res.end("bad request");
    }
    if (path.startsWith(PARTS_PREFIX)) {
      const origin = req.headers.origin;
      const authorised = req.headers[TOKEN_HEADER] === token && (!origin || sameSite(origin, req)) && /^application\/json\b/.test(req.headers["content-type"] ?? "");
      return parts.handle(req, res, new URL(req.url ?? "/", "http://x"), { authorised });
    }
    if (path === DEV_ROUTES.layout) {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end("method not allowed");
      }
      return saveLayout(req, res).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(e.message);
      });
    }
    if (path === DEV_ROUTES.events) {
      // the page's tab id rides on the stream's URL (`?tab=`); only an id that looks like one
      const tab = new URL(req.url ?? "/", "http://x").searchParams.get("tab");
      // a foreign page's EventSource carries its Origin: it may listen to the reload events, never become a bridge tab
      // (it would receive agents' batches as the default tab; wave 2 gate)
      const ownPage = !req.headers.origin || sameSite(req.headers.origin, req);
      if (ownPage && tab && /^[\w-]{8,64}$/.test(tab)) (res as ServerResponse & { pbTab?: string }).pbTab = `web:${tab}`;
    }
    if ((path === DEV_ROUTES.snapshot && req.method === "POST") || path === DEV_ROUTES.viewState || path === DEV_ROUTES.displayViews || path.startsWith("/__protoboard/bridge")) {
      return bridgeRoute(req, res, path).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(e.message);
      });
    }
    if (path === DEV_ROUTES.telemetry) {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        return res.end("method not allowed");
      }
      return saveTelemetry(req, res).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(e.message);
      });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end("method not allowed");
    }
    // a host's own page (the VS Code extension's viewer webview) reads the bundle, its artifacts,
    // the state and the events from its origin; writes stay with the dev page (token, same site)
    // only the routes the tab reads: never the page (it carries the write token) or the source lookup
    const origin = req.headers.origin;
    const shared = path === "/uhd-bundle.json" || path === "/sequence.json" || path.startsWith("/artifacts/") || path === DEV_ROUTES.state || path === DEV_ROUTES.events || path === DEV_ROUTES.snapshot || path === DEV_ROUTES.snapshotPng;
    if (shared && origin && readOrigins.length && originAllowed(origin, readOrigins)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    if (path === DEV_ROUTES.source) return source(new URL(req.url ?? "/", "http://x"), res);
    // the assembly sequence beside the bundle (W2-C, PB-1183): the build's .protoboard/build/sequence.json, read only
    if (path === "/sequence.json") {
      const file = join(dirname(bundleFile), "sequence.json");
      if (!existsSync(file) || statSync(file).size > 8 << 20) return json(res, 404, { error: "no sequence.json (run protoboard build)" });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    }
    // the last snapshot of a tab (PB-1180, W2-D's save points): its record, and its image
    if (path === DEV_ROUTES.snapshot || path === DEV_ROUTES.snapshotPng) {
      const u = new URL(req.url ?? "/", "http://x");
      const level = u.searchParams.get("level") ?? "";
      const view = u.searchParams.get("view") ?? "3d";
      const meta = personal ? readSnapshot(root, level, view) : undefined;
      if (!meta) return json(res, 404, { error: `no snapshot of ${level || "the root"} on ${view}` });
      if (path === DEV_ROUTES.snapshot) return json(res, 200, { ...meta, imageUrl: `${DEV_ROUTES.snapshotPng.slice(1)}?${new URLSearchParams({ level, view })}` });
      // the image's name comes from the key, never from the record: nothing outside the snapshots folder is read
      const png = join(root, SNAPSHOTS_DIR, `${snapshotKey(level, view)}.png`);
      if (!existsSync(png)) return json(res, 404, { error: "the snapshot's image is missing" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : readFileSync(png));
    }
    const route = routes[path];
    if (route) return route(res);
    // the bundle and its artifacts: the viewer's handler (only referenced files, inside their base)
    if (path === "/uhd-bundle.json" || path.startsWith("/artifacts/")) return handleViewer(req, res);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  };

  // ---- start: build first (nothing to serve without a bundle), then listen and watch
  const server: Server = createServer((req, res) => void handler(req, res));
  let port: number;
  try {
    const first = await build([]);
    if (!first.ok) throw new Error(`could not build the project: ${first.error}`);
    port = await listen(server, host, options.port ?? DEFAULT_DEV_PORT, options.strictPort ?? false);
  } catch (e) {
    closed = true;
    clearInterval(heartbeat);
    throw e;
  }
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${shown.includes(":") ? `[${shown}]` : shown}:${port}/`;
  rewatch();
  const recordFile = join(root, DEV_RECORD);
  const record: DevRecord = { schema: "protoboard.dev/v0", url, port, pid: process.pid, session, root, startedAt: new Date().toISOString(), bridge: { key: bridge.key, version: 1 } };
  try {
    // the record carries the bridge key: owner-only, as the render service's record (0o600; advisory on Windows)
    if (options.record !== false) writeAtomic(recordFile, JSON.stringify(record, null, 2) + "\n", 0o600);
  } catch (e) {
    log({ level: "warn", event: "error", message: `cannot write ${DEV_RECORD}: ${(e as Error).message}; editors will not find this session` });
  }
  log({ level: "info", event: "listening", message: `serving ${basename(root)} at ${url}${options.watch === false ? " (not watching)" : ""}`, url, port, bundle: relative(root, bundleFile), display: displayRel() });

  return {
    url,
    port,
    bundleFile,
    get displayFile() {
      return displayFile();
    },
    get version() {
      return version;
    },
    rebuild: (trigger = "manual") => build([trigger]),
    idle: async () => {
      // a change waiting for its quiet period counts as pending
      while (timer && (changed.size || displayTouched)) await new Promise((r) => setTimeout(r, 20));
      await chain;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      bridge.close();
      for (const w of watchers.values()) w.close();
      child?.kill();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
      await chain;
      try {
        // only our own record: another session may have replaced it
        if ((JSON.parse(readFileSync(recordFile, "utf8")) as DevRecord).session === session) rmSync(recordFile);
      } catch {
        // gone or unreadable: nothing to remove
      }
      log({ level: "info", event: "stopped", message: "stopped" });
    },
  };
}

/**
 * Listen on `port`, or the next free one (up to 20 further) unless `strict`.
 * When all of those are taken (a machine with many windows open, each with
 * its project's dev server), any free port the system gives: a twenty-first
 * project still gets its viewer.
 */
async function listen(server: Server, host: string, port: number, strict: boolean): Promise<number> {
  const on = (p: number) =>
    new Promise<number>((ok, fail) => {
      // each try takes both of its listeners away again: twenty tries leave none behind
      const listening = () => {
        server.off("error", failed);
        ok((server.address() as AddressInfo).port);
      };
      const failed = (e: Error) => {
        server.off("listening", listening);
        fail(e);
      };
      server.once("listening", listening);
      server.once("error", failed);
      server.listen(p, host);
    });
  for (let p = port, tries = 0; ; p++, tries++) {
    try {
      return await on(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || strict || port === 0) {
        throw new Error((e as NodeJS.ErrnoException).code === "EADDRINUSE" ? `port ${p} is in use` : (e as Error).message);
      }
      if (tries >= 20) return on(0);
    }
  }
}

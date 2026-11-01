/**
 * The project's render service process (PB-1180): `protoboard views service`
 * runs it in the foreground; `views capture`, `views check` and the MCP
 * server start it on demand, detached, and reach it over loopback with the
 * session token in `.protoboard/local/render-service.json`
 * (@protoboardai/core render-service).
 *
 * What only the CLI has, it supplies: the browser (core's `launchBrowser`,
 * GPU first, `auto`), the viewer page (`protoboard dev`'s server, not
 * watching, no dev.json, so a person's own `protoboard dev` is left alone),
 * the tabs' titles (`@protoboardai/views/tabs`), and the `views check` route.
 * It shuts down after `PROTOBOARD_RENDER_IDLE_S` (default 15 min, DEFAULT: core's `DEFAULT_IDLE_MS`) idle.
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

/** The service's log, beside its record (truncated when over `SERVICE_LOG_MAX_BYTES` at start). */
export const SERVICE_LOG = join(".protoboard", "local", "render-service.log");
/** DEFAULT (PB-1180): a service log larger than this is started afresh (1 MB). */
export const SERVICE_LOG_MAX_BYTES = 1024 * 1024;
/** DEFAULT (W3-A, 2026-11-01): the longest per-tab draw timeout a `/check` body may ask for, in seconds. */
export const CHECK_MAX_TIMEOUT_S = 600;

/**
 * A `/check` body made safe (wave 2 gate): `out` (a folder for one PNG per tab) resolves inside the project
 * unless the body carries `allowOutsideProject: true`, which only the CLI's `views check --out-dir` sets
 * (the person's own folder); the MCP server never does. `module` is a string, `timeout` 1 to
 * `CHECK_MAX_TIMEOUT_S` seconds. Throws naming what is wrong and what to do.
 */
export async function checkBody(root: string, body: unknown): Promise<{ module?: string; out?: string; timeout?: number }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== "object" || Array.isArray(b)) throw new Error("views check: the body must be a JSON object { module, out, timeout }");
  if (b.module !== undefined && typeof b.module !== "string") throw new Error("views check: module is an instance path or module id");
  if (b.timeout !== undefined && (typeof b.timeout !== "number" || !Number.isFinite(b.timeout) || b.timeout < 1 || b.timeout > CHECK_MAX_TIMEOUT_S)) throw new Error(`views check: timeout is 1 to ${CHECK_MAX_TIMEOUT_S} seconds`);
  if (b.allowOutsideProject !== undefined && typeof b.allowOutsideProject !== "boolean") throw new Error("views check: allowOutsideProject is true or false");
  let out: string | undefined;
  if (b.out !== undefined) {
    if (typeof b.out !== "string" || !b.out.trim() || /[<>"|?*\0]/.test(b.out.replace(/^[A-Za-z]:/, ""))) throw new Error('views check: out is a folder path (no < > " | ? *)');
    const { resolveInsideProject } = await import("@protoboardai/core/render-service");
    out = b.allowOutsideProject === true ? resolve(root, b.out) : resolveInsideProject(root, b.out, "views check: out", "run `protoboard views check --out-dir <folder>` yourself to write elsewhere");
  }
  return { ...(b.module !== undefined ? { module: b.module as string } : {}), ...(out !== undefined ? { out } : {}), ...(b.timeout !== undefined ? { timeout: b.timeout as number } : {}) };
}

export interface ServiceProcessOptions {
  root: string;
  version: string;
  idleMs?: number;
  backend?: "auto" | "gpu" | "swiftshader";
  log?: (line: string) => void;
}

/** Builds the render service for a project with the CLI's browser, page host and tab titles (also used in-process by `--no-service` runs). */
export async function createProjectRenderService(o: ServiceProcessOptions & { onIdle?: () => void }) {
  const core = await import("@protoboardai/core/render-service");
  const { startDev } = await import("./dev/server.js");
  const { loadProject, uhdBundle, resolveViews } = await import("@protoboardai/core");
  const { tabsFor } = await import("@protoboardai/views/tabs");
  // the tabs' titles from the shells' own rules, computed once per bundle revision
  let tabs: { hash: string; titles: Map<string, Map<string, string>> } | undefined;
  const tabTitle = async (level: string, view: string) => {
    const p = await loadProject(o.root, { checks: false });
    const bundle = await uhdBundle(p);
    const key = JSON.stringify(bundle.definitions.length) + bundle.definitions.map((d) => d.id).join(",");
    if (!tabs || tabs.hash !== key) tabs = { hash: key, titles: new Map() };
    let at = tabs.titles.get(level);
    if (!at) {
      const inst = p.instances.find((i) => i.path === level);
      const def = inst ? p.lookup(inst.definition) : undefined;
      if (!def) return undefined;
      const { views } = resolveViews(p.extensions);
      at = new Map(tabsFor(bundle.definitions.find((d) => d.id === def.id) ?? def, bundle, level, views).map((v) => [v.id, v.title]));
      tabs.titles.set(level, at);
    }
    return at.get(view);
  };
  const service = new core.RenderService({
    root: o.root,
    launch: async (lo) => (await import("@protoboardai/core/cdp")).launchBrowser(lo),
    startHost: async () => {
      const dev = await startDev({ root: o.root, port: 0, watch: false, record: false });
      return {
        url: dev.url,
        bundleFile: dev.bundleFile,
        get version() {
          return dev.version;
        },
        rebuild: (t) => dev.rebuild(t),
        close: () => dev.close(),
      };
    },
    tabTitle,
    backend: o.backend ?? "auto",
    idleMs: o.idleMs ?? core.idleMsFromEnv(),
    ...(o.onIdle ? { onIdle: o.onIdle } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  return { service, core };
}

/** Runs the service in this process until it idles out or is told to stop. */
export async function runRenderServiceProcess(o: ServiceProcessOptions): Promise<void> {
  const log = o.log ?? ((line: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`));
  let stop: () => Promise<void> = async () => {};
  let stopping = false;
  const shutdown = (why: string) => {
    if (stopping) return;
    stopping = true;
    log(`stopping: ${why}`);
    void stop().finally(() => process.exit(0));
  };
  const { service, core } = await createProjectRenderService({ ...o, log, onIdle: () => shutdown(`idle for ${Math.round((o.idleMs ?? core.idleMsFromEnv()) / 1000)} s`) });
  const { viewsCheck } = await import("./views-check.js");
  const { sceneBatchRoute } = await import("./mcp/scene.js");
  const { Journal } = await import("./dev/journal.js");
  const { findBrowser } = await import("@protoboardai/core");
  const ndjson = (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
    return (v: unknown) => res.write(`${JSON.stringify(v)}\n`);
  };
  const served = await core.serveRenderService(service, o.root, {
    version: o.version,
    onShutdown: () => shutdown("asked to stop"),
    routes: {
      // views check in the warm browser: log lines as they come, then the report
      "/check": async (body, res) => {
        const line = ndjson(res);
        try {
          const b = await checkBody(o.root, body);
          const report = await service.withPage((browser, host) => viewsCheck({ cwd: o.root, module: b.module, out: b.out, timeout: b.timeout, session: { browser, url: host.url }, log: (l) => line({ log: l }) }));
          res.end(`${JSON.stringify({ report })}\n`);
        } catch (e) {
          res.end(`${JSON.stringify({ error: (e as Error).message })}\n`);
        }
      },
      // an agent's view batch on the headless scene (PB-1179, PB-1196; DEFAULT: the service owns the scene when no
      // person's tab is open): applied by the warm page's view store, its op log mirrored to scene-oplog.jsonl
      "/batch": sceneBatchRoute(service, new Journal(o.root)),
      // the doctor's render and capture probes on the warm browser (no second browser)
      "/doctor": async (_body, res) => {
        const report = await service.withPage((browser) =>
          core.runDoctor({
            findBrowser: () => findBrowser(),
            launch: async () => ({ ...browser, close: async () => {} }),
            limits: () => service.limits,
            service: async () => describeHealth(service.health()),
          }),
        );
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(report));
      },
    },
  });
  stop = served.close;
  log(`render service for ${o.root} at ${served.record.url} (pid ${process.pid}, idle timeout ${Math.round(service.idle.ms / 1000)} s)`);
  process.on("SIGINT", () => shutdown("interrupted"));
  process.on("SIGTERM", () => shutdown("terminated"));
  await new Promise<void>(() => {});
}

/** One line about a running service. */
export function describeHealth(h: { pid: number; revision: number; backend?: { kind: string; gl?: { renderer: string } }; captures: number; idleForMs: number; idleMs: number; uptimeMs: number; browser: string }): string {
  return `running (pid ${h.pid}), browser ${h.browser}${h.backend ? ` on ${h.backend.kind === "gpu" ? "the GPU" : "SwiftShader"}${h.backend.gl ? ` (${h.backend.gl.renderer})` : ""}` : ""}, revision ${h.revision}, ${h.captures} capture(s), up ${Math.round(h.uptimeMs / 1000)} s, idle ${Math.round(h.idleForMs / 1000)} of ${Math.round(h.idleMs / 1000)} s`;
}

/** Starts `protoboard views service` for `root`, detached, logging to `.protoboard/local/render-service.log`. */
export function spawnRenderService(root: string): void {
  const bin = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
  const logFile = resolve(root, SERVICE_LOG);
  mkdirSync(resolve(root, ".protoboard", "local"), { recursive: true });
  let flags = "a";
  try {
    if (statSync(logFile).size > SERVICE_LOG_MAX_BYTES) flags = "w";
  } catch {
    /* new */
  }
  const fd = openSync(logFile, flags);
  const child = spawn(process.execPath, [bin, "views", "service", "--cwd", root], { cwd: root, detached: true, stdio: ["ignore", fd, fd], windowsHide: true, env: process.env });
  child.unref();
  closeSync(fd);
}

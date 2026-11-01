/**
 * `protoboard telemetry` (PB-1181): status, show, export (the redacted bundle
 * printed whole), the --send stub and its consent line, clear, the CLI's own
 * switch and the environment's; the crash hook; and the dev server's
 * telemetry route (token, origin, the switch, sanitising, the project hash).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TELEMETRY_DIR, appendTelemetry, projectHash, readConsents, readTelemetry } from "../../core/src/telemetry.js";
import { cliTelemetryMode, crashRecord, installCrashTelemetry, projectRootOf, readCliSwitch, telemetryCommand, telemetryExport, versionInventory } from "../src/telemetry.js";
import { startDev, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/telemetry");
rmSync(TMP, { recursive: true, force: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CONFIG = join(TMP, "config");
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PROTOBOARD_CONFIG_DIR: CONFIG, ...extra });

function project(name: string) {
  const dir = join(TMP, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "protoboard.config.ts"), `export default {};\n`);
  return dir;
}

const record = (over: Record<string, unknown> = {}) => ({
  schema: "pb.render-session/v0",
  session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  start: "2026-11-01T10:00:00.000Z",
  end: "2026-11-01T10:01:00.000Z",
  durationMs: 60000,
  host: "dev-web",
  versions: { viewer: "0.2.1" },
  frameMs: { buckets: [8, 16.7, 33, 50, 100], counts: [1, 2, 3, 0, 0, 0], p50: 16.5, p95: 30.5, frames: 6 },
  exit: "closed",
  ...over,
});

describe("protoboard telemetry", () => {
  it("finds the project from a folder inside it, and says when there is none", () => {
    const root = project("find");
    expect(projectRootOf(join(root, "src"))).toBe(root);
    const r = telemetryCommand(["status"], { cwd: join(TMP, ".."), env: env() });
    // the test folder is inside the stack checkout, which is no project
    expect(r.exitCode).toBe(1);
  });

  it("status: recording on by default, what is stored, nothing sent", () => {
    const root = project("status");
    appendTelemetry(root, record(), { now: new Date("2026-11-01T12:00:00Z") });
    const r = telemetryCommand([], { cwd: root, env: env() });
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({ mode: "all", files: 1, sessions: 1, crashes: 0, consents: 0 });
    expect(r.text).toMatch(/^recording: all \(on \(the default\)/);
    expect(r.text).toContain("nothing is sent");
  });

  it("on and off: the CLI's switch file; the environment wins over it", () => {
    const off = telemetryCommand(["off"], { cwd: TMP, env: env() });
    expect(off.data).toMatchObject({ local: false, mode: "off" });
    expect(JSON.parse(readFileSync(join(CONFIG, "telemetry.json"), "utf8"))).toEqual({ local: false });
    expect(readCliSwitch(env())).toBe(false);
    telemetryCommand(["on"], { cwd: TMP, env: env() });
    expect(cliTelemetryMode(env()).mode).toBe("all");
    expect(cliTelemetryMode(env({ PROTOBOARD_TELEMETRY: "off" }))).toEqual({ mode: "off", reason: "PROTOBOARD_TELEMETRY is off" });
    expect(cliTelemetryMode(env({ DO_NOT_TRACK: "1" })).mode).toBe("off");
  });

  it("show: one line per session (the final over partials)", () => {
    const root = project("show");
    const now = new Date("2026-11-01T12:00:00Z");
    appendTelemetry(root, record({ partial: true, exit: "hidden" }), { now });
    appendTelemetry(root, record(), { now });
    const r = telemetryCommand(["show"], { cwd: root, env: env() });
    expect((r.data as unknown[]).length).toBe(1);
    expect(r.text.split("\n")).toHaveLength(1);
    expect(JSON.parse(r.text)).toMatchObject({ session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", exit: "closed" });
  });

  it("export: prints the whole bundle and writes it; --send is a stub that records the consent and sends nothing", () => {
    const root = project("export");
    appendTelemetry(root, record(), { now: new Date("2026-11-01T12:00:00Z") });
    const out = join(TMP, "bundle.json");
    const now = new Date("2026-11-01T13:00:00Z");
    const shown = telemetryCommand(["export"], { cwd: root, env: env(), out, now });
    expect(shown.exitCode).toBe(0);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(shown.text).toContain(JSON.stringify(written, null, 2));
    expect(shown.text).toContain("Nothing was sent");
    expect(written).toMatchObject({ schema: "pb.telemetry-bundle/v0", project: projectHash(root), counts: { sessions: 1, crashes: 0 } });
    expect(written.inventory.stack).toMatch(/^\d+\.\d+\.\d+/);
    expect(JSON.stringify(written)).not.toContain(root);
    expect(readConsents(root)).toEqual([]);

    const sent = telemetryCommand(["export"], { cwd: root, env: env(), out, now, send: true });
    const data = sent.data as { sha256: string; sent: boolean; request: { url: string }; consent: { bundleSha256: string; sent: boolean } };
    expect(data.sent).toBe(false);
    expect(data.request.url).toBe("https://api.protoboard.ai/v1/reports");
    expect(sent.text).toContain("send (STUB, not made)");
    expect(readConsents(root)).toEqual([{ schema: "pb.telemetry-consent/v0", at: now.toISOString(), bundleSha256: data.sha256, recordCount: 1, destination: "https://api.protoboard.ai/v1/reports", sent: false }]);
    // the default file is in the telemetry folder (git-ignored with .protoboard/local/)
    const def = telemetryExport({ root, now });
    expect(def.file).toBe(join(root, TELEMETRY_DIR, "export-2026-11-01T13-00-00-000Z.json"));
  });

  it("the MCP path: a send without confirm is refused", () => {
    const root = project("confirm");
    expect(() => telemetryExport({ root, send: true })).toThrow(/needs confirm/);
    expect(readConsents(root)).toEqual([]);
    expect(telemetryExport({ root, send: true, confirm: true }).consent).toMatchObject({ sent: false });
  });

  it("clear removes the records and keeps the consents", () => {
    const root = project("clear");
    appendTelemetry(root, record(), { now: new Date("2026-11-01T12:00:00Z") });
    telemetryExport({ root, send: true, confirm: true });
    expect(telemetryCommand(["clear"], { cwd: root, env: env() }).data).toEqual({ removed: ["2026-11-01.jsonl"] });
    expect(readTelemetry(root)).toEqual([]);
    expect(readConsents(root)).toHaveLength(1);
  });

  it("an unknown subcommand prints the usage", () => {
    expect(telemetryCommand(["upload"], { cwd: project("usage"), env: env() })).toMatchObject({ exitCode: 2, text: expect.stringMatching(/^usage: protoboard telemetry/) });
  });

  it("knows the versions, and nothing else about the machine", () => {
    const v = versionInventory();
    expect(Object.keys(v).sort()).toEqual(expect.arrayContaining(["arch", "cli", "node", "os", "stack"]));
    expect(JSON.stringify(v)).not.toMatch(/[\\/]/);
  });
});

describe("the CLI's crash hook", () => {
  it("records the command, the error class, a redacted message and a stack hash; never the arguments or paths", () => {
    const e = new TypeError(`cannot open "C:\\Users\\Kev\\secret project\\board.step"`);
    const r = crashRecord(e, { component: "build", origin: "uncaughtException", now: new Date("2026-11-01T10:00:00Z"), versions: { stack: "0.2.2", cli: "0.2.2" } });
    expect(r).toMatchObject({ schema: "pb.crash/v0", kind: "cli", component: "build", versions: { stack: "0.2.2", cli: "0.2.2" }, error: { kind: "uncaughtException", name: "TypeError", message: "cannot open <str>" } });
    const root = project("crash-record");
    appendTelemetry(root, r);
    const [stored] = readTelemetry(root);
    expect(JSON.stringify(stored)).not.toMatch(/Users|Kev|secret|board|at /);
    expect(stored).toMatchObject({ error: { stackHash: expect.stringMatching(/^[0-9a-f]{16}$/) } });
  });

  it("appends on uncaughtExceptionMonitor (Node's own exit is unchanged) into the project, or not at all when off", () => {
    const root = project("crash-hook");
    const stop = installCrashTelemetry({ component: "dev", cwd: join(root, "src"), env: env() });
    try {
      process.emit("uncaughtExceptionMonitor", new Error("boom"), "uncaughtException");
    } finally {
      stop();
    }
    expect(readTelemetry(root)).toEqual([expect.objectContaining({ schema: "pb.crash/v0", component: "dev", error: expect.objectContaining({ message: "boom" }) })]);
    // after uninstall nothing more is written
    process.emit("uncaughtExceptionMonitor", new Error("again"), "uncaughtException");
    expect(readTelemetry(root)).toHaveLength(1);

    const quiet = project("crash-off");
    const stop2 = installCrashTelemetry({ cwd: quiet, env: env({ PROTOBOARD_TELEMETRY: "off" }) });
    process.emit("uncaughtExceptionMonitor", new Error("boom"), "uncaughtException");
    stop2();
    expect(existsSync(join(quiet, TELEMETRY_DIR))).toBe(false);
  });

  it("outside a project, writes to the config folder's telemetry/", () => {
    // the config folder has no protoboard.config.ts in or above it (TMP is inside the stack checkout, which is no project)
    const stop = installCrashTelemetry({ cwd: CONFIG, env: env() });
    process.emit("uncaughtExceptionMonitor", new Error("boom"), "unhandledRejection");
    stop();
    const files = readdirSync(join(CONFIG, "telemetry")).filter((f) => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(CONFIG, "telemetry", files[0]), "utf8")).toContain(`"kind":"unhandledrejection"`);
  });
});

// ---------------------------------------------------------------------------
// The dev server's route
// ---------------------------------------------------------------------------

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

function post(port: number, path: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

describe("protoboard dev's telemetry route", () => {
  let dir: string;
  let dev: DevServer;
  let token: string;
  const before = { config: process.env.PROTOBOARD_CONFIG_DIR, telemetry: process.env.PROTOBOARD_TELEMETRY, dnt: process.env.DO_NOT_TRACK };

  beforeAll(async () => {
    process.env.PROTOBOARD_CONFIG_DIR = join(TMP, "dev-config");
    delete process.env.PROTOBOARD_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    dir = join(TMP, "dev-project");
    const write = (rel: string, content: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    write("package.json", JSON.stringify({ name: "dev-telemetry", private: true, type: "module" }));
    write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "dev-telemetry", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    write("src/sys.uhd.ts", `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const SYS: ModuleDef = { id: "sys", name: "Sys", interfaces: [] };\n`);
    write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
    write("viewer-lib/web-viewer.css", "body {}\n");
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), watch: false, record: false, log: () => {} });
    const page = (await get(dev.port, "/")).body;
    token = JSON.parse(/<script type="application\/json" id="protoboard-dev">(.*?)<\/script>/.exec(page)![1]).token;
  }, 60000);
  afterAll(async () => {
    await dev?.close();
    for (const [k, v] of [["PROTOBOARD_CONFIG_DIR", before.config], ["PROTOBOARD_TELEMETRY", before.telemetry], ["DO_NOT_TRACK", before.dnt]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("the page relays the viewer's records to the route", async () => {
    const script = (await get(dev.port, "/__protoboard/dev.js")).body;
    expect(script).toContain(`window.addEventListener("uhd-viewer:telemetry"`);
    expect(script).toContain(`fetch("./__protoboard/telemetry"`);
    expect(script).toContain("keepalive: true");
  });

  it("takes a record only with the session token, from the page's origin, as JSON", async () => {
    const body = JSON.stringify({ record: record() });
    const json = { "content-type": "application/json" };
    expect((await post(dev.port, "/__protoboard/telemetry", body, json)).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/telemetry", body, { ...json, "x-protoboard-dev": token, origin: "http://evil.example" })).status).toBe(403);
    expect((await post(dev.port, "/__protoboard/telemetry", body, { "content-type": "text/plain", "x-protoboard-dev": token })).status).toBe(415);
    expect((await get(dev.port, "/__protoboard/telemetry")).status).toBe(405);
    expect((await post(dev.port, "/__protoboard/telemetry", "{", { ...json, "x-protoboard-dev": token })).status).toBe(400);
    expect((await post(dev.port, "/__protoboard/telemetry", JSON.stringify({ record: { schema: "nope" } }), { ...json, "x-protoboard-dev": token })).status).toBe(400);
    expect(existsSync(join(dir, TELEMETRY_DIR, "2026-11-01.jsonl"))).toBe(false);
  });

  it("appends the record with the host and the project hash it names itself; extra fields are dropped", async () => {
    const r = await post(dev.port, "/__protoboard/telemetry", JSON.stringify({ record: { ...record(), host: "vscode-webview", project: "h:0000000000000000", source: "secret source text" } }), { "content-type": "application/json", "x-protoboard-dev": token, origin: `http://127.0.0.1:${dev.port}` });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ written: true });
    const [stored] = readTelemetry(dir);
    expect(stored).toMatchObject({ host: "dev-web", project: projectHash(dir), versions: { viewer: "0.2.1" } });
    expect((stored as { versions: { stack?: string } }).versions.stack).toMatch(/^\d+\.\d+\.\d+/);
    expect(JSON.stringify(stored)).not.toContain("secret source text");
  });

  it("writes nothing while recording is off (the switch is read on every record)", async () => {
    const files = () => (existsSync(join(dir, TELEMETRY_DIR)) ? readdirSync(join(dir, TELEMETRY_DIR)).filter((f) => f.endsWith(".jsonl")) : []);
    const count = () => files().reduce((n, f) => n + readFileSync(join(dir, TELEMETRY_DIR, f), "utf8").trim().split("\n").length, 0);
    const n = count();
    process.env.PROTOBOARD_TELEMETRY = "off";
    const r = await post(dev.port, "/__protoboard/telemetry", JSON.stringify({ record: record() }), { "content-type": "application/json", "x-protoboard-dev": token });
    delete process.env.PROTOBOARD_TELEMETRY;
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ written: false, reason: "off" });
    expect(count()).toBe(n);
  });
});

/**
 * Attaching to or starting `protoboard dev`: the session record and its
 * probe (fake fetch, then a real dev server from @protoboardai/cli on a
 * temporary project), the JSON log, the started process (a stand-in CLI
 * script, and the real CLI when the viewer is built), and the monitor that
 * notices a server stopping or restarting.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { startDev } from "../../cli/src/dev/server.js";
import { resolveCli, type CliCommand } from "../src/cli.js";
import { DEV_RECORD, DevMonitor, DevProcess, devArgs, locateDev, parseDevLog, probeDev, readDevRecord, type DevEndpoint, type DevLogLine, type FetchLike } from "../src/dev.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// its own folder: other test files here work in .tmp at the same time, and this one removes TMP when it ends
const TMP = join(HERE, ".tmp/dev");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const record = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: "protoboard.dev/v0", url: "http://127.0.0.1:5180/", port: 5180, pid: 4242, session: "s1", root: "/p", startedAt: "2026-10-02T00:00:00Z", ...over });

/** A fetch that answers the state route of the given servers (url → session). */
const fakeFetch =
  (servers: Record<string, string>): FetchLike =>
  async (url) => {
    const u = new URL(url);
    if (u.pathname !== "/__protoboard/state") throw new Error(`unexpected ${url}`);
    const session = servers[u.origin + "/"];
    if (session === undefined) throw new TypeError("fetch failed: ECONNREFUSED");
    return { ok: true, json: async () => ({ session, version: 1, diagnostics: [] }) };
  };

describe("the session record", () => {
  it("reads a well-formed record and ignores anything else", () => {
    expect(readDevRecord("/p", () => record())).toMatchObject({ url: "http://127.0.0.1:5180/", session: "s1", pid: 4242 });
    expect(readDevRecord("/p", () => record({ schema: "other/v1" }))).toBeUndefined();
    expect(readDevRecord("/p", () => record({ url: "not a url" }))).toBeUndefined();
    expect(readDevRecord("/p", () => "{")).toBeUndefined();
    expect(
      readDevRecord("/p", () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }),
    ).toBeUndefined();
  });

  it("attaches only when the server answers with the recorded session", async () => {
    const read = () => record();
    // live
    expect(await locateDev("/p", undefined, { read, fetch: fakeFetch({ "http://127.0.0.1:5180/": "s1" }) })).toMatchObject({ url: "http://127.0.0.1:5180/", session: "s1", record: { pid: 4242 } });
    // stale: another server took the port since, or nothing answers
    expect(await locateDev("/p", undefined, { read, fetch: fakeFetch({ "http://127.0.0.1:5180/": "other" }) })).toBeUndefined();
    expect(await locateDev("/p", undefined, { read, fetch: fakeFetch({}) })).toBeUndefined();
    // a server the extension started and knows the URL of, without a record
    expect(await locateDev("/p", "http://127.0.0.1:5181/", { read: () => "", fetch: fakeFetch({ "http://127.0.0.1:5181/": "s9" }) })).toEqual({ url: "http://127.0.0.1:5181/", session: "s9" });
  });

  it("treats a server that does not answer in time, or not with a state, as absent", async () => {
    const slow: FetchLike = (_url, init) => new Promise((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(new Error("aborted"))));
    expect(await probeDev("http://127.0.0.1:5180/", { fetch: slow, timeoutMs: 20 })).toBeUndefined();
    expect(await probeDev("http://127.0.0.1:5180/", { fetch: async () => ({ ok: false, json: async () => ({}) }) })).toBeUndefined();
    expect(await probeDev("http://127.0.0.1:5180/", { fetch: async () => ({ ok: true, json: async () => ({ version: 3 }) }) })).toBeUndefined();
  });
});

describe("a browser-hosted window (PB-861)", () => {
  it("lets the IDE's proxy reach the server and its https webviews drive the viewer; a desktop window needs nothing", () => {
    expect(devArgs({ web: false })).toEqual([]);
    expect(devArgs({ web: true })).toEqual(["--allow-host", "*", "--host-origin", "self,vscode-webview://*,https://*"]);
  });
});

describe("the dev log", () => {
  it("parses JSON log lines and the CLI's own failure, and nothing else", () => {
    expect(parseDevLog('{"time":"t","level":"info","event":"listening","message":"serving quad at http://127.0.0.1:5180/","url":"http://127.0.0.1:5180/","port":5180}')).toMatchObject({
      event: "listening",
      url: "http://127.0.0.1:5180/",
      port: 5180,
    });
    expect(parseDevLog('{"level":"error","event":"build-failed","message":"build failed: x"}')).toMatchObject({ level: "error", event: "build-failed" });
    expect(parseDevLog('{"error":"port 5180 is in use"}')).toEqual({ level: "error", event: "failed", message: "port 5180 is in use" });
    expect(parseDevLog("(node:1) ExperimentalWarning: ...")).toBeUndefined();
    expect(parseDevLog('{"not":"a log line"}')).toBeUndefined();
  });
});

describe("the monitor", () => {
  it("reports a stop, a return and a restart once each", async () => {
    let at: DevEndpoint | undefined = { url: "http://127.0.0.1:5180/", session: "a" };
    const seen: (DevEndpoint | undefined)[] = [];
    const m = new DevMonitor(async () => at, at, (e) => seen.push(e));
    await m.tick();
    expect(seen).toEqual([]);
    at = undefined;
    await m.tick();
    await m.tick();
    expect(seen).toEqual([undefined]);
    at = { url: "http://127.0.0.1:5180/", session: "b" };
    await m.tick();
    // restarted on another port
    at = { url: "http://127.0.0.1:5181/", session: "c" };
    await m.tick();
    expect(seen).toEqual([undefined, { url: "http://127.0.0.1:5180/", session: "b" }, { url: "http://127.0.0.1:5181/", session: "c" }]);
    // the extension moved itself: not news
    m.set({ url: "http://127.0.0.1:5190/", session: "d" });
    at = { url: "http://127.0.0.1:5190/", session: "d" };
    await m.tick();
    expect(seen).toHaveLength(3);
    m.dispose();
  });
});

describe("a dev server from @protoboardai/cli", () => {
  it("is found through its record while it runs, and not after it stops", async () => {
    const dir = tempProject("attach");
    const dev = await startDev({ root: dir, port: 0, watch: false, viewerLib: join(dir, "viewer-lib") });
    try {
      const found = await locateDev(dir);
      expect(found).toMatchObject({ url: dev.url, record: { pid: process.pid, root: dir } });
      expect(await probeDev(dev.url)).toBe(found!.session);
    } finally {
      await dev.close();
    }
    expect(existsSync(join(dir, DEV_RECORD))).toBe(false);
    expect(await locateDev(dir)).toBeUndefined();
    // a record left by a killed server
    writeFileSync(join(dir, DEV_RECORD), record({ url: dev.url, root: dir }));
    expect(await locateDev(dir)).toBeUndefined();
  });
});

describe("a dev server the extension starts", () => {
  const node: CliCommand = { command: process.execPath, args: [], from: "setting" };

  it("is ready when it logs that it listens, and stops on request", async () => {
    const script = fakeCli(
      "listening",
      // the handler first: the test stops the server as soon as it says it listens
      `process.on("SIGTERM", () => { console.log(JSON.stringify({ level: "info", event: "stopped", message: "stopped" })); process.exit(0); });
       console.log(JSON.stringify({ level: "info", event: "build", message: "built in 0.1s" }));
       console.error("(node) a warning");
       console.log(JSON.stringify({ level: "info", event: "listening", message: "serving", url: "http://127.0.0.1:5999/", port: 5999 }));
       setInterval(() => {}, 1000);`,
    );
    const logs: DevLogLine[] = [];
    const p = new DevProcess({ cli: { ...node, args: [script] }, root: dirname(script), onLog: (l) => logs.push(l) });
    expect(await p.ready).toEqual({ url: "http://127.0.0.1:5999/", port: 5999 });
    expect(p.running).toBe(true);
    await p.stop();
    expect(p.running).toBe(false);
    expect(p.stopped).toBe(true);
    expect(logs.map((l) => l.event)).toEqual(expect.arrayContaining(["build", "output", "listening", "stopped"]));
    expect(logs.find((l) => l.event === "output")).toMatchObject({ level: "warn", message: "(node) a warning" });
  });

  it("passes the dev arguments and a configured port", async () => {
    const script = fakeCli("args", `console.log(JSON.stringify({ level: "info", event: "listening", message: process.argv.slice(2).join(" "), url: "http://127.0.0.1:1/", port: 1 })); setTimeout(() => {}, 200);`);
    const logs: DevLogLine[] = [];
    const p = new DevProcess({ cli: { ...node, args: [script] }, root: dirname(script), port: 5300, onLog: (l) => logs.push(l) });
    await p.ready;
    expect(logs[0].message).toBe("dev --format json --port 5300");
    await p.exited;
  });

  it("fails with the CLI's own message when it exits before serving", async () => {
    const script = fakeCli("fails", `console.log(JSON.stringify({ error: "could not build the project: no root" })); process.exitCode = 2;`);
    const p = new DevProcess({ cli: { ...node, args: [script] }, root: dirname(script), onLog: () => {} });
    await expect(p.ready).rejects.toThrow("protoboard dev stopped before serving: could not build the project: no root");
    expect(await p.exited).toMatchObject({ code: 2 });
  });

  it("says which setting to fix when Node or the CLI cannot be run", async () => {
    const p = new DevProcess({ cli: { command: "/nonexistent/node", args: ["cli.mjs"], from: "project" }, root: HERE, onLog: () => {} });
    await expect(p.ready).rejects.toThrow(/set protoboard.nodePath to the full path of a Node.js 22 or later/);
    const q = new DevProcess({ cli: { command: "protoboard-not-installed-here", args: [], from: "none" }, root: HERE, onLog: () => {} });
    await expect(q.ready).rejects.toThrow(/carries no stack.*no Protoboard is installed for your user.*protoboard.cliPath/);
  });

  it("gives up when the first build takes too long", async () => {
    const script = fakeCli("slow", `setInterval(() => {}, 1000);`);
    const p = new DevProcess({ cli: { ...node, args: [script] }, root: dirname(script), onLog: () => {}, startTimeoutMs: 100 });
    await expect(p.ready).rejects.toThrow(/did not start within/);
    await p.exited;
    expect(p.running).toBe(false);
  });

  const viewerBuilt = (() => {
    try {
      const pkg = createRequire(join(HERE, "../../cli/package.json")).resolve("@protoboardai/web-viewer/package.json");
      return existsSync(join(dirname(pkg), "dist", "web-viewer.js"));
    } catch {
      return false;
    }
  })();

  // the real CLI serves the installed viewer's library build (CI builds the viewer after these tests)
  it.skipIf(!viewerBuilt)("starts the real `protoboard dev`, which records itself, and stops it cleanly", async () => {
    const dir = tempProject("real");
    const logs: DevLogLine[] = [];
    const p = new DevProcess({ cli: resolveCli(dir), root: dir, onLog: (l) => logs.push(l) });
    try {
      const { url } = await p.ready;
      const found = await locateDev(dir);
      expect(found).toMatchObject({ url, record: { pid: p.proc.pid } });
    } finally {
      await p.stop();
    }
    expect(logs.some((l) => l.event === "build")).toBe(true);
    expect(logs.at(-1)).toMatchObject({ event: "stopped" });
    expect(existsSync(join(dir, DEV_RECORD))).toBe(false);
  });
});

/** A stand-in for the CLI: a script that behaves like `protoboard dev --format json`. */
function fakeCli(name: string, body: string): string {
  const file = join(TMP, "fake", `${name}.mjs`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return file;
}

/** A one-module project inside the repository, so it resolves @protoboardai/core from the workspace. */
function tempProject(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("package.json", JSON.stringify({ name, private: true, type: "module" }));
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "${name}", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
  write("src/sys.uhd.ts", `import type { ModuleDef } from "@deltarobotics/uhd";\nexport const SYS: ModuleDef = { id: "sys", name: "System", interfaces: [] };\n`);
  write("viewer-lib/web-viewer.js", "export function mountWebViewer() {}\n");
  write("viewer-lib/web-viewer.css", "body {}\n");
  return dir;
}

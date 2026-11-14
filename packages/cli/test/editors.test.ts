/**
 * `protoboard editors` and `protoboard editors host` (contributes.editors):
 * which enabled extension's editor opens a file, and the host process the
 * shell starts for it, speaking JSON lines on stdin and stdout
 * (@protoboardai/core/editor-protocol). A small fixture extension stands in
 * for a real one: its host echoes the webview's messages, calls a shell
 * service and maps a file to a webview URI.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { EditorInit, FromHost, ToHost } from "@protoboardai/core/editor-protocol";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(HERE, "../bin/protoboard.mjs");
const TMP = join(HERE, ".tmp-editors");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const HOST = `
export async function createHost(ctx) {
  console.log("a stray line that must not reach the protocol");
  ctx.log("info", "started for " + ctx.init.relPath);
  return {
    async webview(m) {
      if (m.type === "edit") {
        const r = await ctx.call("document.applyEdit", { text: m.text, label: "Echo edit" });
        ctx.post({ type: "edited", applied: r.applied, version: r.version });
      } else if (m.type === "fail") {
        try { await ctx.call("file.open", { path: "../outside" }); } catch (e) { ctx.post({ type: "refused", error: e.message }); }
      } else ctx.post({ type: "echo", got: m, uri: ctx.webviewUri(ctx.init.root + "/pics/a b.png"), outside: ctx.webviewUri("/elsewhere/x.png") });
    },
    document(c) { ctx.post({ type: "doc", text: c.text, reason: c.reason }); },
    dispose() { process.stderr.write("disposed\\n"); },
  };
}
`;

function project(name: string) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ["ext-echo"] });\n`);
  write("src/sys.uhd.ts", `export const SYS = { id: "sys", interfaces: [] };\n`);
  write("package.json", JSON.stringify({ name, type: "module" }));
  const ext = "node_modules/ext-echo";
  write(`${ext}/package.json`, JSON.stringify({ name: "ext-echo", version: "0.1.0", type: "module" }));
  write(
    `${ext}/protoboard-extension.json`,
    JSON.stringify({
      schema: "protoboard.extension/v0",
      id: "ext-echo",
      version: "0.1.0",
      compatibility: { protoboard: "^0.3.0" },
      contributes: { editors: [{ id: "echo", title: "Echo", icon: "repeat", files: ["*.echo"], webview: { script: "./dist/echo.js" }, host: "./host/echo-host.mjs#createHost" }] },
    }),
  );
  write(`${ext}/dist/echo.js`, "");
  write(`${ext}/host/echo-host.mjs`, HOST);
  write("notes/a.echo", "hello");
  return dir;
}

const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args, "--cwd", dir], { encoding: "utf8", timeout: 120000 });

describe("protoboard editors", () => {
  it("says which enabled extension's editor opens a file", () => {
    const dir = project("list");
    const r = cli(dir, "editors", "--file", join(dir, "notes", "a.echo"), "--format", "json");
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.editors.map((e: { id: string; package: string }) => [e.id, e.package])).toEqual([["echo", "ext-echo"]]);
    expect(report.file.relPath).toBe("notes/a.echo");
    expect(report.file.editor.resolved.host.export).toBe("createHost");
    expect(report.file.editor.resolved.missing).toEqual([]);
    const none = JSON.parse(cli(dir, "editors", "--file", join(dir, "notes", "a.txt"), "--format", "json").stdout);
    expect(none.file.editor).toBeNull();
    expect(cli(dir, "editors").stdout).toContain("echo");
  });

  it("runs an editor's host: relays the webview's messages, calls services, maps files, and ends when told", async () => {
    const dir = project("host");
    const proc = spawn(process.execPath, [CLI, "editors", "host", "ext-echo", "echo", "--cwd", dir], { stdio: ["pipe", "pipe", "pipe"] });
    const got: FromHost[] = [];
    const stray: string[] = [];
    createInterface({ input: proc.stdout }).on("line", (l) => {
      try {
        got.push(JSON.parse(l));
      } catch {
        stray.push(l);
      }
    });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    const send = (m: ToHost) => proc.stdin.write(JSON.stringify(m) + "\n");
    const waitFor = async <T extends FromHost>(pred: (m: FromHost) => boolean): Promise<T> => {
      for (let i = 0; i < 600; i++) {
        const m = got.find(pred);
        if (m) return m as T;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`timed out; got ${JSON.stringify(got)}; stderr ${stderr}`);
    };
    const init: EditorInit = {
      protocol: "protoboard.editor/v0",
      editor: "echo",
      extension: "ext-echo",
      package: "ext-echo",
      packageRoot: join(dir, "node_modules", "ext-echo"),
      root: dir,
      file: join(dir, "notes", "a.echo"),
      relPath: "notes/a.echo",
      readOnly: false,
      theme: { kind: "dark", id: "Default Dark Modern" },
      webview: { root: "https://webview.test/root", package: "https://webview.test/pkg" },
      document: { text: "hello", version: 1, dirty: false },
    };
    send({ t: "init", ...init });
    // messages sent while the host's entry is still loading wait for it
    send({ t: "webview", message: { type: "ping" } });
    const echo = await waitFor<{ t: "webview"; message: { got: unknown; uri: string; outside: unknown } }>((m) => m.t === "webview" && (m.message as { type: string }).type === "echo");
    expect(echo.message).toEqual({ type: "echo", got: { type: "ping" }, uri: "https://webview.test/root/pics/a%20b.png", outside: null });
    expect(got.find((m) => m.t === "log")).toEqual({ t: "log", level: "info", text: "started for notes/a.echo" });

    send({ t: "webview", message: { type: "edit", text: "hello again" } });
    const call = await waitFor<{ t: "call"; id: number; service: string; args: unknown }>((m) => m.t === "call");
    expect([call.service, call.args]).toEqual(["document.applyEdit", { text: "hello again", label: "Echo edit" }]);
    send({ t: "document", text: "hello again", version: 2, dirty: true, reason: "applied" });
    send({ t: "reply", id: call.id, result: { applied: true, version: 2 } });
    expect((await waitFor<{ t: "webview"; message: unknown }>((m) => m.t === "webview" && (m.message as { type: string }).type === "edited")).message).toEqual({ type: "edited", applied: true, version: 2 });
    expect(got.some((m) => m.t === "webview" && JSON.stringify(m.message) === JSON.stringify({ type: "doc", text: "hello again", reason: "applied" }))).toBe(true);

    send({ t: "webview", message: { type: "fail" } });
    const refused = await waitFor<{ t: "call"; id: number }>((m) => m.t === "call" && m.id !== call.id);
    send({ t: "reply", id: refused.id, error: "../outside is outside the project" });
    expect((await waitFor<{ t: "webview"; message: unknown }>((m) => m.t === "webview" && (m.message as { type: string }).type === "refused")).message).toEqual({ type: "refused", error: "../outside is outside the project" });

    const exited = new Promise<number | null>((r) => proc.on("close", r));
    send({ t: "dispose" });
    expect(await exited).toBe(0);
    expect(stderr).toContain("a stray line that must not reach the protocol");
    expect(stderr).toContain("disposed");
    expect(stray).toEqual([]);
  }, 120000);

  it("says why a host cannot start, in its first line", async () => {
    const dir = project("nohost");
    const r = spawnSync(process.execPath, [CLI, "editors", "host", "ext-echo", "missing", "--cwd", dir], {
      input: JSON.stringify({ t: "init", protocol: "protoboard.editor/v0", root: dir }) + "\n",
      encoding: "utf8",
      timeout: 120000,
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout.trim().split("\n")[0])).toEqual({ t: "failed", message: "no enabled extension ext-echo contributes an editor missing" });
    const old = spawnSync(process.execPath, [CLI, "editors", "host", "ext-echo", "echo", "--cwd", dir], { input: JSON.stringify({ t: "init", protocol: "protoboard.editor/v9" }) + "\n", encoding: "utf8", timeout: 120000 });
    expect(JSON.parse(old.stdout.trim()).message).toBe("the shell speaks protoboard.editor/v9; this host speaks protoboard.editor/v0");
  }, 120000);
});

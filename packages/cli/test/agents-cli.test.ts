/**
 * `protoboard agents` (PB-930): the commands against a temporary home, with
 * nothing on PATH but Node, so no agent of this machine is seen or touched.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pb-agents-cli-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

// the switch that turns the sign-in requirement off for tests (PB-928) reaches the CLIs started here
const env = () => ({ HOME: home, PATH: dirname(process.execPath), PROTOBOARD_CREDENTIAL_STORE: "file" });
function pb(args: string[], cwd = home) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: env(), timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}
const LAUNCHER = () => join(home, ".config", "protoboard", "agents");

describe("protoboard agents", () => {
  it("lists every known agent, finds none in an empty home, and writes nothing", () => {
    const r = pb(["agents", "--format", "json"]);
    expect(r.status).toBe(0);
    const data = r.json();
    expect(data.server).toEqual({ name: "protoboard-stack", command: join(LAUNCHER(), "protoboard-mcp"), args: [] });
    expect(data.agents.map((a: { id: string }) => a.id)).toEqual(["claude-code", "claude-desktop", "cursor", "vscode", "vscode-insiders", "windsurf", "codex", "gemini", "cline", "cline-cli"]);
    expect(data.agents.every((a: { status: string }) => a.status === "not-detected")).toBe(true);
    expect(readdirSync(home)).toEqual([]);
    expect(pb(["agents"]).stdout).toMatch(/none found[\s\S]*Not found here: Claude Code, Claude Desktop/);
  });

  it("changes nothing without a yes for an agent", () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".gemini"));
    const asked = pb(["agents", "setup"]);
    expect(asked.status).toBe(2);
    expect(asked.stderr).toMatch(/no terminal to ask at.*not changed without a yes for that agent\. Name them: --agent cursor --agent gemini --yes/);
    const blanket = pb(["agents", "setup", "--yes"]);
    expect(blanket.status).toBe(2);
    expect(blanket.stderr).toMatch(/--yes needs to know which agents/);
    const noYes = pb(["agents", "setup", "--agent", "cursor"]);
    expect(noYes.status).toBe(2);
    expect(pb(["agents", "remove", "--yes"]).status).toBe(2);
    expect(readdirSync(home).sort()).toEqual([".cursor", ".gemini"]);
    expect(readdirSync(join(home, ".cursor"))).toEqual([]);
  });

  it("refuses an agent it does not know, and a scope an agent does not have", () => {
    expect(pb(["agents", "setup", "--agent", "emacs", "--yes"]).stderr).toMatch(/no agent "emacs"; known: claude-code/);
    expect(pb(["agents", "setup", "--agent", "claude-desktop", "--scope", "project", "--yes"]).stderr).toMatch(/Claude Desktop has no project configuration/);
    expect(pb(["agents", "--scope", "machine"]).stderr).toMatch(/--scope takes user or project/);
  });

  it("setup --agent --yes connects that agent only, says what it wrote, and the entry starts the server", async () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".gemini"));
    writeFileSync(join(home, ".gemini", "settings.json"), '{ "theme": "Default Dark" }\n');
    const r = pb(["agents", "setup", "--agent", "gemini", "--yes", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
    const data = r.json();
    const file = join(home, ".gemini", "settings.json");
    expect(data.results).toEqual([expect.objectContaining({ id: "gemini", action: "added", method: "file", file, backup: `${file}.protoboard-backup` })]);
    expect(readFileSync(`${file}.protoboard-backup`, "utf8")).toBe('{ "theme": "Default Dark" }\n');
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "Default Dark", mcpServers: { "protoboard-stack": { command: join(LAUNCHER(), "protoboard-mcp"), args: [] } } });
    expect(readdirSync(join(home, ".cursor"))).toEqual([]);
    // the launcher is there, and records the CLI that ran setup
    expect(statSync(join(LAUNCHER(), "protoboard-mcp")).mode & 0o111).toBeTruthy();
    expect(JSON.parse(readFileSync(join(LAUNCHER(), "launcher.json"), "utf8")).cli).toEqual([expect.objectContaining({ entry: CLI, from: "npm" })]);
    const list = pb(["agents", "--format", "json"]).json();
    expect(Object.fromEntries(list.agents.filter((a: { detected: boolean }) => a.detected).map((a: { id: string; status: string }) => [a.id, a.status]))).toEqual({ cursor: "not-connected", gemini: "connected" });

    // what Gemini CLI would start: the command from its settings, as an MCP client starts it
    const entry = JSON.parse(readFileSync(file, "utf8")).mcpServers["protoboard-stack"] as { command: string; args: string[] };
    const client = new Client({ name: "as-gemini", version: "0" });
    await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args, cwd: home, stderr: "pipe", env: env() }));
    try {
      expect(client.getServerVersion()?.name).toBe("protoboard-stack");
      expect(client.getInstructions()).toMatch(/NOT the Protoboard alpha web app/);
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("project_status");
    } finally {
      await client.close();
    }

    const text = pb(["agents", "setup", "--all", "--yes"]);
    expect(text.status).toBe(0);
    expect(text.stdout).toMatch(/✓ Cursor: connected: added to ~\/\.cursor\/mcp\.json/);
    expect(text.stdout).not.toMatch(/Gemini/);
    expect(text.stdout).toMatch(/The entry runs: .*protoboard-mcp/);
  }, 120_000);

  it("remove takes the entry out and leaves the rest", () => {
    mkdirSync(join(home, ".gemini"));
    const file = join(home, ".gemini", "settings.json");
    writeFileSync(file, '{ "theme": "Default Dark" }\n');
    pb(["agents", "setup", "--agent", "gemini", "--yes"]);
    const r = pb(["agents", "remove", "--all", "--yes", "--format", "json"]);
    expect(r.json().results).toEqual([expect.objectContaining({ id: "gemini", action: "removed" })]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "Default Dark", mcpServers: {} });
    expect(pb(["agents", "remove", "--all", "--yes"]).stdout).toMatch(/No agent has Protoboard configured/);
  });

  it("a configuration that does not parse fails for that agent and is left alone; the others go on", () => {
    mkdirSync(join(home, ".gemini"));
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".gemini", "settings.json"), '{ "theme": ');
    expect(pb(["agents"]).stdout).toMatch(/✗ Gemini CLI\s+cannot read its configuration/);
    const r = pb(["agents", "setup", "--agent", "gemini", "--agent", "cursor", "--yes"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/✗ Gemini CLI: failed:[\s\S]*not valid JSON[\s\S]*left alone/);
    expect(r.stdout).toMatch(/✓ Cursor: connected/);
    expect(readFileSync(join(home, ".gemini", "settings.json"), "utf8")).toBe('{ "theme": ');
  });

  it("config gives the command, JSON and TOML for any other client", () => {
    const data = pb(["agents", "config", "--format", "json"]).json();
    expect(data.command).toEqual({ command: join(LAUNCHER(), "protoboard-mcp"), args: [] });
    expect(JSON.parse(data.json).mcpServers["protoboard-stack"]).toEqual(data.command);
    expect(JSON.parse(data.vscodeJson).servers["protoboard-stack"].type).toBe("stdio");
    expect(data.toml).toContain("[mcp_servers.protoboard-stack]");
    const text = pb(["agents", "config"]).stdout;
    expect(text).toMatch(/for any MCP client[\s\S]*"mcpServers"[\s\S]*claude mcp add --scope user protoboard-stack -- /);
    // it prints, and writes nothing: the launcher the entry names is written by `refresh` (or by `setup`)
    expect(readdirSync(home)).toEqual([]);
    expect(data.launcherInstalled).toBe(false);
    expect(text).toMatch(/The launcher is not on this machine yet, and this command writes nothing\. Write it before the client starts the server: `protoboard agents refresh`\./);
    expect(pb(["agents", "refresh"]).stdout).toMatch(/wrote .*protoboard-mcp\.mjs/);
    expect(existsSync(join(LAUNCHER(), "protoboard-mcp.mjs"))).toBe(true);
    const again = pb(["agents", "config", "--format", "json"]).json();
    expect(again.launcherInstalled).toBe(true);
    expect(pb(["agents", "config"]).stdout).not.toMatch(/not on this machine yet/);
  });

  it("setup writes nothing at all, the launcher included, until an agent has a yes", async () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".gemini"));
    const { agentsCommand } = await import("../src/agents.js");
    const saved = { HOME: process.env.HOME, PATH: process.env.PATH, PROTOBOARD_CONFIG_DIR: process.env.PROTOBOARD_CONFIG_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    Object.assign(process.env, { HOME: home, PATH: dirname(process.execPath) });
    delete process.env.PROTOBOARD_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    const said: { results: { id: string; action: string }[] }[] = [];
    const asked: string[] = [];
    const io = (answers: Record<string, boolean>) => ({ json: true, cwd: home, version: "0.0.0", out: (d: unknown) => void said.push(d as (typeof said)[number]), confirm: async (q: string) => (asked.push(q), Object.entries(answers).some(([k, v]) => v && q.includes(k))) });
    try {
      // every agent declined: nothing is on disk that was not there
      await agentsCommand("setup", [], {}, io({}));
      expect(asked).toHaveLength(2);
      expect(said[0].results.map((r) => [r.id, r.action])).toEqual([["cursor", "declined"], ["gemini", "declined"]]);
      expect(readdirSync(home).sort()).toEqual([".cursor", ".gemini"]);
      expect(existsSync(LAUNCHER())).toBe(false);
      // a yes for one: the launcher and that agent's file, and not the other's
      await agentsCommand("setup", [], {}, io({ "Gemini CLI": true }));
      expect(said[1].results.map((r) => [r.id, r.action])).toEqual([["cursor", "declined"], ["gemini", "added"]]);
      expect(existsSync(join(LAUNCHER(), "protoboard-mcp"))).toBe(true);
      expect(readdirSync(join(home, ".cursor"))).toEqual([]);
      expect(existsSync(join(home, ".gemini", "settings.json"))).toBe(true);
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
      process.exitCode = 0;
    }
  });

  // (a machine with Claude Code in a system-wide place has the command, whatever the home folder is)
  it.skipIf(["/opt/homebrew/bin/claude", "/usr/local/bin/claude"].some((c) => existsSync(c)))("Claude Code without its command: setup edits nothing and gives the command to run", () => {
    writeFileSync(join(home, ".claude.json"), '{"numStartups":3}');
    const r = pb(["agents", "setup", "--agent", "claude-code", "--yes", "--format", "json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json().results).toEqual([expect.objectContaining({ id: "claude-code", action: "manual", message: expect.stringMatching(/Run: claude mcp add --scope user protoboard-stack -- .*protoboard-mcp \(and `protoboard agents refresh` once/) })]);
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe('{"numStartups":3}');
    expect(readdirSync(home)).toEqual([".claude.json"]);
    expect(pb(["agents"]).stdout).toMatch(/Claude Code\s+not connected[\s\S]*connect it yourself with: claude mcp add --scope user protoboard-stack -- /);
  });

  it("a project's entry cannot fetch a package: npx is told not to install, so a clone without its packages fails instead of running someone else's `protoboard`", async () => {
    const { PORTABLE_COMMAND } = await import("@protoboardai/core");
    expect(PORTABLE_COMMAND).toEqual({ command: "npx", args: ["--no-install", "protoboard", "mcp"] });
    // a registry that has a package named `protoboard`, as the public one does: what is asked of it is recorded
    const { createServer } = await import("node:http");
    const asked: string[] = [];
    const registry = createServer((q, res) => {
      asked.push(`${q.method} ${q.url}`);
      const base = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
      if (q.url === "/protoboard") return void res.setHeader("content-type", "application/json").end(JSON.stringify({ name: "protoboard", "dist-tags": { latest: "9.9.9" }, versions: { "9.9.9": { name: "protoboard", version: "9.9.9", bin: { protoboard: "x.js" }, dist: { tarball: `${base}/protoboard/-/protoboard-9.9.9.tgz` } } } }));
      res.writeHead(404).end("{}");
    });
    await new Promise<void>((ok) => registry.listen(0, "127.0.0.1", ok));
    const { spawn } = await import("node:child_process");
    const npx = join(dirname(process.execPath), process.platform === "win32" ? "npx.cmd" : "npx");
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stderr: string }>((done) => {
        asked.length = 0;
        const clone = mkdtempSync(join(home, "clone-"));
        // no terminal, as an agent starts it
        const c = spawn(npx, args, { cwd: clone, shell: process.platform === "win32", stdio: ["ignore", "ignore", "pipe"], env: { HOME: home, PATH: dirname(process.execPath), npm_config_registry: `http://127.0.0.1:${(registry.address() as { port: number }).port}`, npm_config_cache: join(home, "npm-cache"), npm_config_update_notifier: "false", npm_config_fetch_retries: "0", npm_config_audit: "false" } });
        let stderr = "";
        c.stderr.on("data", (d) => (stderr += d));
        c.on("close", (code) => done({ code, stderr }));
      });
    try {
      if (!existsSync(npx)) return; // a Node.js without npm beside it: nothing to run
      const safe = await run(PORTABLE_COMMAND.args);
      expect(safe.code).not.toBe(0);
      expect(safe.stderr).toMatch(/canceled due to missing packages/);
      expect(asked.filter((a) => /\.tgz/.test(a))).toEqual([]);
      // the control: without the flag npx goes for the package, with no one asked
      const old = await run(["protoboard", "mcp"]);
      expect(old.stderr).toMatch(/will be installed: protoboard@9\.9\.9/);
      expect(asked.filter((a) => /\.tgz/.test(a))).toEqual(["GET /protoboard/-/protoboard-9.9.9.tgz"]);
    } finally {
      registry.close();
    }
  }, 120_000);

  it("project scope writes the project's shared file: npx when the project has the CLI, the launcher when not", () => {
    const withCli = join(home, "proj");
    mkdirSync(withCli);
    writeFileSync(join(withCli, "protoboard.config.ts"), "");
    writeFileSync(join(withCli, "package.json"), JSON.stringify({ devDependencies: { "@protoboardai/cli": "^0.1.3" } }));
    const r = pb(["agents", "setup", "--scope", "project", "--agent", "claude-code", "--agent", "vscode", "--yes", "--format", "json", "--cwd", withCli]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(withCli, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { "protoboard-stack": { type: "stdio", command: "npx", args: ["--no-install", "protoboard", "mcp"] } } });
    expect(JSON.parse(readFileSync(join(withCli, ".vscode", "mcp.json"), "utf8")).servers["protoboard-stack"].command).toBe("npx");
    // nothing machine-specific was needed for it
    expect(existsSync(LAUNCHER())).toBe(false);
    const bare = join(home, "bare");
    mkdirSync(bare);
    pb(["agents", "setup", "--scope", "project", "--agent", "claude-code", "--yes", "--cwd", bare]);
    expect(JSON.parse(readFileSync(join(bare, ".mcp.json"), "utf8")).mcpServers["protoboard-stack"].command).toBe(join(LAUNCHER(), "protoboard-mcp"));
    expect(pb(["agents", "--scope", "project", "--cwd", bare, "--format", "json"]).json().agents.find((a: { id: string }) => a.id === "claude-code").status).toBe("connected");
    // what that leaves in a shared folder is said: the entry is this machine's, and so is the copy of the file as it was
    writeFileSync(join(bare, ".cursor-was"), "");
    mkdirSync(join(bare, ".cursor"));
    writeFileSync(join(bare, ".cursor", "mcp.json"), "{}\n");
    const told = pb(["agents", "setup", "--scope", "project", "--agent", "cursor", "--yes", "--cwd", bare]);
    expect(told.stdout).toMatch(/! This entry starts this machine's launcher .* works on this machine only: do not commit/);
    expect(told.stdout).toMatch(/! .*mcp\.json\.protoboard-backup is the file as it was .* do not commit it/);
    const json = pb(["agents", "setup", "--scope", "project", "--agent", "gemini", "--yes", "--format", "json", "--cwd", bare]).json();
    expect(json.results[0].warnings).toHaveLength(1);
    // the shared entry warns of nothing
    expect(r.stdout).not.toMatch(/warnings/);
  });

  it("config names the server protoboard-stack: beside the alpha app's server called protoboard, the copied lines do not collide with it", () => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { protoboard: { url: "https://alpha.example/mcp?key=SECRET" } } }));
    const data = pb(["agents", "config", "--format", "json"]).json();
    expect(data.server).toBe("protoboard-stack");
    expect(Object.keys(JSON.parse(data.json).mcpServers)).toEqual(["protoboard-stack"]);
    const text = pb(["agents", "config"]).stdout;
    expect(text).toMatch(/claude mcp add --scope user protoboard-stack -- /);
    expect(text).toMatch(/Leave one named protoboard unless its command ends in/);
    // and what is said about that other server holds no part of its address that could be a key
    const list = pb(["agents"]).stdout;
    expect(list).toMatch(/the server named protoboard here is another one \(https:\/\/alpha\.example, the alpha web app's\)/);
    expect(list + JSON.stringify(pb(["agents", "--format", "json"]).json())).not.toMatch(/SECRET/);
  });

  it("refresh rewrites the launcher and records the CLI as the extension's when the extension runs it", () => {
    const r = spawnSync(process.execPath, [CLI, "agents", "refresh", "--format", "json"], { cwd: home, encoding: "utf8", env: { ...env(), PROTOBOARD_CLI_FROM: "extension" } });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).cli).toEqual([expect.objectContaining({ entry: CLI, from: "extension" })]);
    expect(pb(["agents", "refresh"]).stdout).toMatch(/wrote launcher\.json|up to date/);
  });
});

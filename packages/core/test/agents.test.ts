/**
 * Agents and their MCP configuration (PB-930): every format with a fixture
 * file, in a temporary home. Nothing here reads or writes the real home.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentConfigError,
  KNOWN_AGENTS,
  LAUNCHER_FILES,
  PORTABLE_COMMAND,
  agentMachine,
  agentState,
  cliOriginOf,
  installLauncher,
  launcherCommand,
  launcherDir,
  listAgents,
  otherClientConfig,
  otherClientName,
  readLauncherRecord,
  removeAgent,
  setupAgent,
  type AgentMachine,
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "agents");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pb-agents-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A Linux machine whose home is the temporary folder, with nothing on PATH and nothing outside that home. */
const machine = (over: Partial<AgentMachine> = {}): AgentMachine =>
  agentMachine({ home, platform: "linux", env: { HOME: home }, exists: (p) => p.startsWith(home) && existsSync(p), which: () => undefined, run: () => ({ status: 1, stdout: "", stderr: "not run in tests" }), ...over });
const COMMAND = { command: "/home/you/.config/protoboard/agents/protoboard-mcp", args: [] as string[] };
const put = (rel: string, name: string) => {
  const file = join(home, rel);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(join(FIXTURES, name), file);
  return file;
};
const read = (file: string) => readFileSync(file, "utf8");

describe("where each agent keeps its MCP configuration", () => {
  const at = (id: string, m: AgentMachine) => agentState(id, { command: COMMAND }, m).file;
  it("on Linux", () => {
    const m = agentMachine({ home: "/home/you", platform: "linux", env: {}, exists: () => false, which: () => undefined });
    expect(at("claude-code", m)).toBe("/home/you/.claude.json");
    expect(at("claude-desktop", m)).toBe("/home/you/.config/Claude/claude_desktop_config.json");
    expect(at("cursor", m)).toBe("/home/you/.cursor/mcp.json");
    expect(at("vscode", m)).toBe("/home/you/.config/Code/User/mcp.json");
    expect(at("vscode-insiders", m)).toBe("/home/you/.config/Code - Insiders/User/mcp.json");
    expect(at("windsurf", m)).toBe("/home/you/.config/devin/mcp_config.json");
    expect(at("codex", m)).toBe("/home/you/.codex/config.toml");
    expect(at("gemini", m)).toBe("/home/you/.gemini/settings.json");
    expect(at("cline", m)).toBe("/home/you/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json");
    expect(at("cline-cli", m)).toBe("/home/you/.cline/data/settings/cline_mcp_settings.json");
  });
  it("on macOS", () => {
    const m = agentMachine({ home: "/Users/you", platform: "darwin", env: {}, exists: () => false, which: () => undefined });
    expect(at("claude-desktop", m)).toBe("/Users/you/Library/Application Support/Claude/claude_desktop_config.json");
    expect(at("vscode", m)).toBe("/Users/you/Library/Application Support/Code/User/mcp.json");
    expect(at("cline", m)).toBe("/Users/you/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json");
    expect(at("windsurf", m)).toBe("/Users/you/.config/devin/mcp_config.json");
    expect(at("cursor", m)).toBe("/Users/you/.cursor/mcp.json");
    expect(at("claude-code", m)).toBe("/Users/you/.claude.json");
  });
  it("on Windows", () => {
    const m = agentMachine({ home: "C:\\Users\\you", platform: "win32", env: { APPDATA: "C:\\Users\\you\\AppData\\Roaming" }, exists: () => false, which: () => undefined });
    expect(at("claude-desktop", m)).toBe("C:\\Users\\you\\AppData\\Roaming\\Claude\\claude_desktop_config.json");
    expect(at("vscode", m)).toBe("C:\\Users\\you\\AppData\\Roaming\\Code\\User\\mcp.json");
    expect(at("windsurf", m)).toBe("C:\\Users\\you\\AppData\\Roaming\\devin\\mcp_config.json");
    expect(at("cursor", m)).toBe("C:\\Users\\you\\.cursor\\mcp.json");
    expect(at("codex", m)).toBe("C:\\Users\\you\\.codex\\config.toml");
    expect(at("claude-code", m)).toBe("C:\\Users\\you\\.claude.json");
  });
  it("follows the agents' own variables", () => {
    const m = agentMachine({ home: "/home/you", platform: "linux", env: { CLAUDE_CONFIG_DIR: "/cfg/claude", CODEX_HOME: "/cfg/codex", XDG_CONFIG_HOME: "/xdg", CLINE_MCP_SETTINGS_PATH: "/cfg/cline.json" }, exists: () => false, which: () => undefined });
    expect(at("claude-code", m)).toBe("/cfg/claude/.claude.json");
    expect(at("codex", m)).toBe("/cfg/codex/config.toml");
    expect(at("vscode", m)).toBe("/xdg/Code/User/mcp.json");
    expect(at("windsurf", m)).toBe("/xdg/devin/mcp_config.json");
    expect(at("cline-cli", m)).toBe("/cfg/cline.json");
  });
  it("uses Windsurf's earlier file only when that is the one present", () => {
    const m = agentMachine({ home: "/home/you", platform: "linux", env: {}, exists: (p) => p === "/home/you/.codeium/windsurf/mcp_config.json", which: () => undefined });
    expect(at("windsurf", m)).toBe("/home/you/.codeium/windsurf/mcp_config.json");
  });
  it("gives the project file of the agents that have one", () => {
    const m = agentMachine({ home: "/home/you", platform: "linux", env: {}, exists: () => false, which: () => undefined });
    const files = Object.fromEntries(listAgents({ scope: "project", projectDir: "/work/p", command: PORTABLE_COMMAND }, m).map((a) => [a.id, a.file]));
    expect(files).toEqual({ "claude-code": "/work/p/.mcp.json", cursor: "/work/p/.cursor/mcp.json", vscode: "/work/p/.vscode/mcp.json", "vscode-insiders": "/work/p/.vscode/mcp.json", codex: "/work/p/.codex/config.toml", gemini: "/work/p/.gemini/settings.json" });
    expect(() => agentState("claude-desktop", { scope: "project", projectDir: "/work/p", command: COMMAND }, m)).toThrow(/no project configuration/);
  });
});

describe("detection", () => {
  it("finds nothing in an empty home, and writes nothing", () => {
    const all = listAgents({ command: COMMAND }, machine());
    expect(all.map((a) => a.id)).toEqual(KNOWN_AGENTS.map((a) => a.id));
    expect(all.every((a) => !a.detected && a.status === "not-detected")).toBe(true);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
  });
  it("sees an agent by its folder or its command", () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev"), { recursive: true });
    const all = listAgents({ command: COMMAND }, machine({ which: (c) => (c === "codex" ? "/usr/local/bin/codex" : undefined) }));
    const by = Object.fromEntries(all.map((a) => [a.id, a]));
    expect(by.cursor).toMatchObject({ detected: true, evidence: "~/.cursor exists", status: "not-connected" });
    expect(by.codex).toMatchObject({ detected: true, evidence: "codex is on PATH (/usr/local/bin/codex)" });
    expect(by.vscode.detected).toBe(true);
    expect(by.cline.detected).toBe(true);
    expect(by.gemini.detected).toBe(false);
  });
  it("says connected, outdated or unreadable from the file", () => {
    put(".cline/data/settings/cline_mcp_settings.json", "cline_mcp_settings.json");
    put(".gemini/settings.json", "broken.json");
    const m = machine();
    expect(agentState("cline-cli", { command: COMMAND }, m)).toMatchObject({ status: "outdated", entry: { command: "/old/place/protoboard-mcp", args: [] } });
    // the fixture's entry has the name before 0.1.7: outdated even with the same command, until setup renames it
    expect(agentState("cline-cli", { command: { command: "/old/place/protoboard-mcp", args: [] } }, m)).toMatchObject({ status: "outdated", legacyName: "protoboard" });
    const g = agentState("gemini", { command: COMMAND }, m);
    expect(g.status).toBe("unreadable");
    expect(g.problem).toMatch(/not valid JSON/);
  });
});

describe("adding the entry", () => {
  const others = (file: string, key = "mcpServers") => {
    const servers = (parseJsonc(read(file)) as Record<string, Record<string, unknown>>)[key];
    return Object.keys(servers).filter((k) => k !== "protoboard-stack");
  };

  it("Claude Desktop: beside the other server, with a backup of the original", () => {
    const file = put(".config/Claude/claude_desktop_config.json", "claude_desktop_config.json");
    const r = setupAgent("claude-desktop", { command: COMMAND }, machine());
    expect(r).toMatchObject({ action: "added", method: "file", file, backup: `${file}.protoboard-backup` });
    const data = JSON.parse(read(file));
    expect(data.mcpServers["protoboard-stack"]).toEqual({ command: COMMAND.command, args: [] });
    expect(data.mcpServers.filesystem.args).toHaveLength(3);
    expect(data.preferences).toEqual({ sidebarMode: "chat" });
    expect(read(r.backup!)).toBe(fixture("claude_desktop_config.json"));
    // the original lines are still there, byte for byte
    expect(read(file)).toContain('      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/Desktop"]');
  });

  it("Claude Code: its own configuration is never edited as a file; without the claude command the user is given the command to run", () => {
    // ~/.claude.json is Claude Code's live state: it rewrites the file while it runs
    const file = put(".claude.json", "claude.json");
    const line = `claude mcp add --scope user protoboard-stack -- ${COMMAND.command}`;
    const state = agentState("claude-code", { command: COMMAND }, machine());
    expect(state).toMatchObject({ status: "not-connected", method: "command", manual: line });
    expect(() => setupAgent("claude-code", { command: COMMAND }, machine())).toThrow(new RegExp(`not edited directly.*Run this in a terminal instead: ${line.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}$`));
    expect(read(file)).toBe(fixture("claude.json"));
    expect(readdirSync(home)).toEqual([".claude.json"]);
    // an entry that is there cannot be taken out as a file either
    writeFileSync(file, JSON.stringify({ mcpServers: { "protoboard-stack": { type: "stdio", ...COMMAND, env: {} } } }));
    expect(agentState("claude-code", { command: COMMAND }, machine())).toMatchObject({ status: "connected" });
    expect(agentState("claude-code", { command: COMMAND }, machine()).manual).toBeUndefined();
    expect(() => removeAgent("claude-code", {}, machine())).toThrow(/Run this in a terminal instead: claude mcp remove --scope user protoboard-stack$/);
    expect(JSON.parse(read(file)).mcpServers["protoboard-stack"]).toBeTruthy();
    // under the name before 0.1.7: the user is given both commands, the old name's removal first
    writeFileSync(file, JSON.stringify({ mcpServers: { protoboard: { type: "stdio", ...COMMAND, env: {} } } }));
    expect(agentState("claude-code", { command: COMMAND }, machine()).manual).toBe(`claude mcp add --scope user protoboard-stack -- ${COMMAND.command}`);
    expect(() => setupAgent("claude-code", { command: COMMAND }, machine())).toThrow(/claude mcp remove --scope user protoboard && claude mcp add --scope user protoboard-stack -- /);
  });

  it("Claude Code: the command is found where its installers put it when PATH does not have it (an editor started from the Dock)", () => {
    put(".claude.json", "claude.json");
    for (const [platform, place] of [
      ["darwin", join(home, ".local", "bin", "claude")],
      ["darwin", "/opt/homebrew/bin/claude"],
      ["linux", "/usr/local/bin/claude"],
    ] as const) {
      const calls: string[][] = [];
      const m = machine({ platform, exists: (p) => p === place || (p.startsWith(home) && existsSync(p)), run: (c, a) => (calls.push([c, ...a]), { status: 0, stdout: "", stderr: "" }) });
      expect(agentState("claude-code", { command: COMMAND }, m).manual, place).toBeUndefined();
      expect(setupAgent("claude-code", { command: COMMAND }, m)).toMatchObject({ action: "added", method: "command" });
      expect(calls, place).toEqual([[place, "mcp", "add", "--scope", "user", "protoboard-stack", "--", COMMAND.command]]);
    }
    // npm's shim on Windows cannot be started without a shell: the user runs the command
    const win = machine({ platform: "win32", which: () => "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd" });
    expect(agentState("claude-code", { command: COMMAND }, win).manual).toMatch(/^claude mcp add --scope user protoboard-stack -- /);
  });

  it("Claude Code: runs `claude mcp add` when the command is installed, and leaves the file to it", () => {
    const file = put(".claude.json", "claude.json");
    const calls: string[][] = [];
    const m = machine({ which: (c) => (c === "claude" ? "/usr/local/bin/claude" : undefined), run: (c, a) => (calls.push([c, ...a]), { status: 0, stdout: "", stderr: "" }) });
    expect(agentState("claude-code", { command: COMMAND }, m).method).toBe("command");
    const r = setupAgent("claude-code", { command: COMMAND }, m);
    expect(r).toMatchObject({ action: "added", method: "command" });
    expect(calls).toEqual([["/usr/local/bin/claude", "mcp", "add", "--scope", "user", "protoboard-stack", "--", COMMAND.command]]);
    expect(read(file)).toBe(fixture("claude.json"));
    expect(existsSync(`${file}.protoboard-backup`)).toBe(false);
    // a failure is reported, with what the command said
    const failing = machine({ which: () => "/usr/local/bin/claude", run: () => ({ status: 1, stdout: "", stderr: "MCP server protoboard already exists" }) });
    expect(() => setupAgent("claude-code", { command: COMMAND }, failing)).toThrow(/claude mcp add.*already exists/);
  });

  it("Cursor: keeps the file's tabs", () => {
    const file = put(".cursor/mcp.json", "cursor-mcp.json");
    setupAgent("cursor", { command: COMMAND }, machine());
    const text = read(file);
    expect(text).toContain('\t\t"protoboard-stack": {\n\t\t\t"type": "stdio",\n\t\t\t"command": "/home/you/.config/protoboard/agents/protoboard-mcp",\n\t\t\t"args": []\n\t\t}');
    expect(text).not.toMatch(/^ +"/m);
    expect(others(file)).toEqual(["github"]);
  });

  it("VS Code: under servers, with the comments and the trailing commas kept", () => {
    const file = put(".config/Code/User/mcp.json", "vscode-mcp.json");
    const r = setupAgent("vscode", { command: COMMAND }, machine());
    expect(r.action).toBe("added");
    const text = read(file);
    expect(text).toContain("// the servers Copilot's agent mode may start");
    expect(text).toContain("/* browser automation */");
    expect(text).toContain("// pinned later");
    const data = parseJsonc(text) as { servers: Record<string, unknown>; inputs: unknown[] };
    expect(data.servers["protoboard-stack"]).toEqual({ type: "stdio", command: COMMAND.command, args: [] });
    expect(Object.keys(data.servers)).toEqual(["playwright", "protoboard-stack"]);
    expect(data.inputs).toHaveLength(1);
  });

  it("Windsurf: keeps CRLF line endings and four-space indentation", () => {
    const file = put(".config/devin/mcp_config.json", "windsurf-mcp_config.json");
    setupAgent("windsurf", { command: COMMAND }, machine());
    const text = read(file);
    expect(text.split("\r\n").length).toBeGreaterThan(10);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).toContain('        "protoboard-stack": {\r\n            "command"');
    expect(others(file)).toEqual(["example"]);
  });

  it("Gemini CLI: creates mcpServers in a settings file that has none", () => {
    const file = put(".gemini/settings.json", "gemini-settings.json");
    setupAgent("gemini", { command: COMMAND }, machine());
    const data = JSON.parse(read(file));
    expect(data.mcpServers).toEqual({ "protoboard-stack": { command: COMMAND.command, args: [] } });
    expect(data).toMatchObject({ theme: "Default Dark", selectedAuthType: "oauth-personal", general: { previewFeatures: true } });
  });

  it("Codex: appends its table, with the comments and the other tables untouched", () => {
    const file = put(".codex/config.toml", "codex-config.toml");
    const r = setupAgent("codex", { command: COMMAND }, machine());
    expect(r).toMatchObject({ action: "added", backup: `${file}.protoboard-backup` });
    const text = read(file);
    expect(text.startsWith(fixture("codex-config.toml").trimEnd())).toBe(true);
    expect(text).toContain('\n[mcp_servers.protoboard-stack]\ncommand = "/home/you/.config/protoboard/agents/protoboard-mcp"\nargs = []\n');
    const data = parseToml(text) as { mcp_servers: Record<string, { command: string; env?: unknown }>; projects: unknown; model: string };
    expect(Object.keys(data.mcp_servers)).toEqual(["context7", "protoboard-stack"]);
    expect(data.mcp_servers.context7.env).toEqual({ MY_ENV_VAR: "MY_ENV_VALUE" });
    expect(data.model).toBe("gpt-5.5");
  });

  it("Codex on Windows: the path is a valid TOML string", () => {
    const file = put(".codex/config.toml", "codex-config.toml");
    const win = { command: "cmd", args: ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] };
    setupAgent("codex", { command: win }, machine());
    expect((parseToml(read(file)) as { mcp_servers: Record<string, unknown> }).mcp_servers["protoboard-stack"]).toEqual(win);
  });

  it("creates the file, and its folder, when the agent has none yet", () => {
    mkdirSync(join(home, ".cursor"));
    const r = setupAgent("cursor", { command: COMMAND }, machine());
    expect(r).toMatchObject({ action: "added", created: true });
    expect(r.backup).toBeUndefined();
    expect(read(r.file)).toBe(`{\n  "mcpServers": {\n    "protoboard-stack": {\n      "type": "stdio",\n      "command": "${COMMAND.command}",\n      "args": []\n    }\n  }\n}\n`);
    const codex = setupAgent("codex", { command: COMMAND }, machine());
    expect(read(codex.file)).toBe(`[mcp_servers.protoboard-stack]\ncommand = "${COMMAND.command}"\nargs = []\n`);
  });

  it("treats an empty file as no configuration", () => {
    const file = put(".gemini/settings.json", "empty.json");
    expect(agentState("gemini", { command: COMMAND }, machine()).status).toBe("not-connected");
    setupAgent("gemini", { command: COMMAND }, machine());
    expect(JSON.parse(read(file)).mcpServers["protoboard-stack"].command).toBe(COMMAND.command);
  });

  it("is unchanged the second time, and writes nothing", () => {
    const file = put(".cursor/mcp.json", "cursor-mcp.json");
    setupAgent("cursor", { command: COMMAND }, machine());
    const after = read(file);
    const mtime = statSync(file).mtimeMs;
    expect(setupAgent("cursor", { command: COMMAND }, machine())).toMatchObject({ action: "unchanged" });
    expect(read(file)).toBe(after);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(agentState("cursor", { command: COMMAND }, machine()).status).toBe("connected");
  });

  it("updates an older entry's command and keeps what the user set beside it", () => {
    const file = put(".cline/data/settings/cline_mcp_settings.json", "cline_mcp_settings.json");
    const r = setupAgent("cline-cli", { command: COMMAND }, machine());
    // its entry had the name before 0.1.7: it is renamed, with what the user set beside it
    expect(r).toMatchObject({ action: "updated", serverName: "protoboard-stack", movedFrom: "protoboard" });
    const data = JSON.parse(read(file));
    expect(data.mcpServers["protoboard-stack"]).toEqual({ command: COMMAND.command, args: [], disabled: false, autoApprove: ["project_status", "project_check"] });
    expect(data.mcpServers.protoboard).toBeUndefined();
    expect(data.mcpServers["local-server"].env).toEqual({ API_KEY: "your_api_key" });
  });

  it("Codex: replaces an older table and its sub-table, in a file with tables after it", () => {
    const file = put(".codex/config.toml", "codex-with-protoboard.toml");
    expect(agentState("codex", { command: COMMAND }, machine()).status).toBe("outdated");
    expect(setupAgent("codex", { command: COMMAND }, machine()).action).toBe("updated");
    const data = parseToml(read(file)) as { mcp_servers: Record<string, Record<string, unknown>>; projects: Record<string, unknown> };
    // the table under the name before 0.1.7 goes, sub-table and all; the entry is written under protoboard-stack with its env
    expect(data.mcp_servers["protoboard-stack"]).toEqual({ command: COMMAND.command, args: [], env: { PROTOBOARD_CLOUD_URL: "http://localhost:8787" } });
    expect(data.mcp_servers.protoboard).toBeUndefined();
    expect(data.projects["/home/you/work/thing"]).toEqual({ trust_level: "trusted" });
    expect(read(file).match(/\[mcp_servers\.protoboard-stack\]/g)).toHaveLength(1);
  });

  it("makes the backup once: a second change does not overwrite the original copy", () => {
    const file = put(".config/Claude/claude_desktop_config.json", "claude_desktop_config.json");
    setupAgent("claude-desktop", { command: COMMAND }, machine());
    const second = setupAgent("claude-desktop", { command: { command: "/elsewhere/protoboard-mcp", args: [] } }, machine());
    expect(second.action).toBe("updated");
    expect(second.backup).toBeUndefined();
    expect(read(`${file}.protoboard-backup`)).toBe(fixture("claude_desktop_config.json"));
  });

  it("refuses a file that does not parse, and leaves it byte for byte", () => {
    const file = put(".gemini/settings.json", "broken.json");
    expect(() => setupAgent("gemini", { command: COMMAND }, machine())).toThrow(AgentConfigError);
    expect(() => setupAgent("gemini", { command: COMMAND }, machine())).toThrow(/not valid JSON.*left alone/);
    expect(read(file)).toBe(fixture("broken.json"));
    expect(existsSync(`${file}.protoboard-backup`)).toBe(false);
    const toml = join(home, ".codex", "config.toml");
    mkdirSync(dirname(toml), { recursive: true });
    writeFileSync(toml, 'model = "x\n[broken\n');
    expect(() => setupAgent("codex", { command: COMMAND }, machine())).toThrow(/not valid TOML/);
    expect(read(toml)).toBe('model = "x\n[broken\n');
  });

  it("refuses a file whose servers are not an object", () => {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(file));
    writeFileSync(file, '{ "mcpServers": [] }\n');
    expect(() => setupAgent("cursor", { command: COMMAND }, machine())).toThrow(/"mcpServers".*not an object/);
    expect(read(file)).toBe('{ "mcpServers": [] }\n');
  });

  it("refuses a TOML file it cannot edit without changing something else", () => {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(dirname(file));
    // the entry written as dotted keys, not as a table: the text edit would leave it in place
    const text = 'mcp_servers.protoboard.command = "/old/protoboard-mcp"\nmcp_servers.protoboard.args = []\n';
    writeFileSync(file, text);
    expect(() => setupAgent("codex", { command: COMMAND }, machine())).toThrow(/left alone/);
    expect(read(file)).toBe(text);
  });

  it("keeps the file's mode, and writes through a link", () => {
    const real = put("dotfiles/cursor-mcp.json", "cursor-mcp.json");
    chmodSync(real, 0o600);
    mkdirSync(join(home, ".cursor"));
    symlinkSync(real, join(home, ".cursor", "mcp.json"));
    setupAgent("cursor", { command: COMMAND }, machine());
    expect(statSync(real).mode & 0o777).toBe(0o600);
    expect(JSON.parse(read(real)).mcpServers["protoboard-stack"]).toBeTruthy();
    expect(JSON.parse(read(join(home, ".cursor", "mcp.json"))).mcpServers["protoboard-stack"]).toBeTruthy();
  });

  it("project scope: writes the project's file with the portable command", () => {
    const root = join(home, "proj");
    mkdirSync(root);
    const r = setupAgent("claude-code", { scope: "project", projectDir: root, command: PORTABLE_COMMAND }, machine({ which: () => "/usr/local/bin/claude" }));
    expect(r).toMatchObject({ action: "added", method: "file", file: join(root, ".mcp.json"), created: true });
    expect(JSON.parse(read(r.file))).toEqual({ mcpServers: { "protoboard-stack": { type: "stdio", command: "npx", args: ["--no-install", "protoboard", "mcp"] } } });
    setupAgent("vscode", { scope: "project", projectDir: root, command: PORTABLE_COMMAND }, machine());
    expect(JSON.parse(read(join(root, ".vscode", "mcp.json")))).toEqual({ servers: { "protoboard-stack": { type: "stdio", command: "npx", args: ["--no-install", "protoboard", "mcp"] } } });
  });
});

describe("another server already named protoboard (the alpha app's)", () => {
  const ALPHA = '{\n  "mcpServers": {\n    "protoboard": {\n      "type": "http",\n      "url": "https://alpha.example/mcp"\n    }\n  }\n}\n';
  const file = () => join(home, ".cursor", "mcp.json");
  beforeEach(() => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(file(), ALPHA);
  });

  it("is not this server: the agent is not connected, and the state says what the other server is", () => {
    expect(agentState("cursor", { command: COMMAND }, machine())).toMatchObject({ status: "not-connected", serverName: "protoboard-stack", alphaServer: "https://alpha.example" });
  });

  it("is left exactly as it is: this server goes in beside it as protoboard-stack", () => {
    const r = setupAgent("cursor", { command: COMMAND }, machine());
    expect(r).toMatchObject({ action: "added", serverName: "protoboard-stack" });
    const servers = JSON.parse(read(file())).mcpServers;
    expect(servers.protoboard).toEqual({ type: "http", url: "https://alpha.example/mcp" });
    expect(servers["protoboard-stack"]).toEqual({ type: "stdio", command: COMMAND.command, args: [] });
    expect(read(file()).startsWith(ALPHA.slice(0, ALPHA.indexOf("    }\n  }")))).toBe(true);
    expect(agentState("cursor", { command: COMMAND }, machine())).toMatchObject({ status: "connected", serverName: "protoboard-stack", alphaServer: "https://alpha.example" });
    expect(setupAgent("cursor", { command: COMMAND }, machine()).action).toBe("unchanged");
  });

  it("is never removed: remove takes out this server only", () => {
    expect(removeAgent("cursor", {}, machine())).toMatchObject({ action: "absent" });
    expect(read(file())).toBe(ALPHA);
    setupAgent("cursor", { command: COMMAND }, machine());
    expect(removeAgent("cursor", {}, machine())).toMatchObject({ action: "removed", serverName: "protoboard-stack" });
    expect(JSON.parse(read(file())).mcpServers).toEqual({ protoboard: { type: "http", url: "https://alpha.example/mcp" } });
  });

  it("Claude Code's command adds under the second name and never removes the other", () => {
    writeFileSync(join(home, ".claude.json"), ALPHA);
    const calls: string[][] = [];
    const m = machine({ which: (c) => (c === "claude" ? "/usr/local/bin/claude" : undefined), run: (c, a) => (calls.push(a), { status: 0, stdout: "", stderr: "" }) });
    expect(setupAgent("claude-code", { command: COMMAND }, m)).toMatchObject({ action: "added", serverName: "protoboard-stack" });
    expect(removeAgent("claude-code", {}, m).action).toBe("absent");
    expect(calls).toEqual([["mcp", "add", "--scope", "user", "protoboard-stack", "--", COMMAND.command]]);
  });

  it("a project's file is written under protoboard-stack too, and the user's own configuration is not read for it", () => {
    writeFileSync(join(home, ".claude.json"), ALPHA);
    const root = join(home, "proj");
    mkdirSync(root);
    const q = { scope: "project" as const, projectDir: root, command: PORTABLE_COMMAND };
    expect(agentState("claude-code", q, machine())).toMatchObject({ status: "not-connected", serverName: "protoboard-stack" });
    expect(setupAgent("claude-code", q, machine())).toMatchObject({ action: "added", serverName: "protoboard-stack", method: "file" });
    expect(Object.keys(JSON.parse(read(join(root, ".mcp.json"))).mcpServers)).toEqual(["protoboard-stack"]);
    expect(agentState("claude-code", q, machine())).toMatchObject({ status: "connected", serverName: "protoboard-stack" });
    expect(read(join(home, ".claude.json"))).toBe(ALPHA);
    expect(removeAgent("claude-code", q, machine())).toMatchObject({ action: "removed", serverName: "protoboard-stack" });
    // a project file a teammate wrote before 0.1.7 has this server as protoboard: setup renames it, the entry as it was
    const shared = join(home, "shared");
    mkdirSync(shared);
    writeFileSync(join(shared, ".mcp.json"), JSON.stringify({ mcpServers: { protoboard: { type: "stdio", ...PORTABLE_COMMAND }, other: { command: "x" } } }));
    const sq = { ...q, projectDir: shared };
    expect(agentState("claude-code", sq, machine())).toMatchObject({ status: "outdated", serverName: "protoboard-stack", legacyName: "protoboard" });
    expect(setupAgent("claude-code", sq, machine())).toMatchObject({ action: "updated", serverName: "protoboard-stack", movedFrom: "protoboard" });
    expect(JSON.parse(read(join(shared, ".mcp.json"))).mcpServers).toEqual({ other: { command: "x" }, "protoboard-stack": { type: "stdio", ...PORTABLE_COMMAND } });
    expect(agentState("claude-code", sq, machine())).toMatchObject({ status: "connected" });
  });

  it("refuses a server named protoboard-stack that is not this one, and writes nothing", () => {
    const taken = '{ "mcpServers": { "protoboard-stack": { "url": "https://elsewhere.example/mcp" } } }\n';
    writeFileSync(file(), taken);
    expect(agentState("cursor", { command: COMMAND }, machine())).toMatchObject({ status: "unreadable", otherServer: "https://elsewhere.example" });
    expect(() => setupAgent("cursor", { command: COMMAND }, machine())).toThrow(/already has a server named protoboard-stack that is not this one/);
    expect(read(file())).toBe(taken);
  });

  it("Codex: the same in TOML, and a stdio server of that name that is not the launcher is also someone else's", () => {
    const toml = join(home, ".codex", "config.toml");
    mkdirSync(dirname(toml));
    const text = '[mcp_servers.protoboard]\ncommand = "npx"\nargs = ["-y", "protoboard-alpha-mcp"]\n';
    writeFileSync(toml, text);
    expect(setupAgent("codex", { command: COMMAND }, machine()).serverName).toBe("protoboard-stack");
    expect(read(toml).startsWith(text)).toBe(true);
    expect((parseToml(read(toml)) as { mcp_servers: Record<string, { command: string }> }).mcp_servers["protoboard-stack"].command).toBe(COMMAND.command);
    removeAgent("codex", {}, machine());
    expect(read(toml)).toBe(text);
  });

  it("knows its own entries under the name before 0.1.7 (the launcher, the Windows form, the portable one), and moves them", () => {
    for (const command of [COMMAND, { command: "cmd", args: ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] }, PORTABLE_COMMAND, { command: "/old/place/protoboard-mcp", args: [] }]) {
      writeFileSync(file(), JSON.stringify({ mcpServers: { protoboard: command } }));
      const state = agentState("cursor", { command: COMMAND }, machine());
      expect(state, command.command).toMatchObject({ status: "outdated", serverName: "protoboard-stack", legacyName: "protoboard" });
      expect(state.alphaServer).toBeUndefined();
      expect(setupAgent("cursor", { command: COMMAND }, machine())).toMatchObject({ action: "updated", movedFrom: "protoboard" });
      expect(Object.keys(JSON.parse(read(file())).mcpServers)).toEqual(["protoboard-stack"]);
    }
    // Claude Code: its command removes the old name, then adds the new one
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { protoboard: COMMAND } }));
    const calls: string[][] = [];
    const m = machine({ which: (c) => (c === "claude" ? "/usr/local/bin/claude" : undefined), run: (_c, a) => (calls.push(a), { status: 0, stdout: "", stderr: "" }) });
    expect(setupAgent("claude-code", { command: COMMAND }, m)).toMatchObject({ action: "updated", serverName: "protoboard-stack", movedFrom: "protoboard" });
    expect(calls).toEqual([
      ["mcp", "remove", "--scope", "user", "protoboard"],
      ["mcp", "add", "--scope", "user", "protoboard-stack", "--", COMMAND.command],
    ]);
  });
});

describe("nothing but the entry changes, character for character", () => {
  const cursor = () => join(home, ".cursor", "mcp.json");
  const roundTrip = (text: string) => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(cursor(), text);
    rmSync(`${cursor()}.protoboard-backup`, { force: true });
    setupAgent("cursor", { command: COMMAND }, machine());
    const added = read(cursor());
    removeAgent("cursor", {}, machine());
    return { added, removed: read(cursor()) };
  };

  it("a neighbour written on one line stays on one line, with its comment and the trailing commas", () => {
    const text = fixture("cursor-one-line-neighbour.json");
    const { added, removed } = roundTrip(text);
    // every line of the original is still there, in order, and the only new lines are the entry's
    const entry = ['    "protoboard-stack": {', '      "type": "stdio",', `      "command": "${COMMAND.command}",`, '      "args": []', "    },"];
    const lines = text.split("\n");
    expect(added.split("\n")).toEqual([...lines.slice(0, 6), ...entry, ...lines.slice(6)]);
    expect(removed).toBe(text);
  });

  it("the round trip gives the file back as it was: one line, spaced, tabs, CRLF, a comment after the last entry", () => {
    for (const text of [
      '{"mcpServers":{}}',
      '{"mcpServers":{"a":{"command":"x","args":[]}}}',
      '{ "mcpServers": { "a": { "command": "x" } } }\n',
      '{\n\t"mcpServers": {\n\t\t"a": { "command": "x" }\n\t}\n}\n',
      '{\r\n  "mcpServers": {\r\n    "a": {\r\n      "command": "x"\r\n    } // c\r\n  }\r\n}\r\n',
      '{\n  "mcpServers": {\n    "a": { "command": "x" } /* x, y */\n  },\n  "z": [1,2,   3]\n}\n',
      '{\n    "mcpServers": {\n        "a": {"command": "x"},\n        "b": {"command": "y"},\n    }\n}',
    ]) {
      const { added, removed } = roundTrip(text);
      expect(removed, JSON.stringify(text)).toBe(text);
      expect((parseJsonc(added) as { mcpServers: Record<string, unknown> }).mcpServers["protoboard-stack"], JSON.stringify(text)).toEqual({ type: "stdio", ...COMMAND });
    }
    // a file on one line stays on one line with the entry in it
    expect(roundTrip('{"mcpServers":{}}').added).toBe(`{"mcpServers":{"protoboard-stack":{"type":"stdio","command":"${COMMAND.command}","args":[]}}}`);
    expect(roundTrip('{ "mcpServers": { "a": { "command": "x" } } }\n').added).toBe(`{ "mcpServers": { "a": { "command": "x" }, "protoboard-stack": { "type": "stdio", "command": "${COMMAND.command}", "args": [] } } }\n`);
  });

  it("a file without the servers object gets it, and keeps the empty object afterwards; nothing else moves", () => {
    const text = '{\n  "theme": "Default Dark", // mine\n  "list": [1, 2]\n}\n';
    const { added, removed } = roundTrip(text);
    expect(added).toBe(`{\n  "theme": "Default Dark", // mine\n  "list": [1, 2],\n  "mcpServers": {\n    "protoboard-stack": {\n      "type": "stdio",\n      "command": "${COMMAND.command}",\n      "args": []\n    }\n  }\n}\n`);
    expect(removed).toBe('{\n  "theme": "Default Dark", // mine\n  "list": [1, 2],\n  "mcpServers": {}\n}\n');
  });

  it("an older entry (under the name before 0.1.7) is renamed and brought up to date in place, as it was written", () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const text = '{\n  "mcpServers": {\n    "protoboard": { "command": "/old/protoboard-mcp", "args": [], "disabled": false }, // ours\n    "b": { "command": "y" }\n  }\n}\n';
    writeFileSync(cursor(), text);
    expect(setupAgent("cursor", { command: COMMAND }, machine()).action).toBe("updated");
    expect(read(cursor())).toBe(text.replace("/old/protoboard-mcp", COMMAND.command).replace('"protoboard":', '"protoboard-stack":'));
  });

  it("a project's older entry (npx without --no-install) is seen as this server's and brought up to date", () => {
    const root = join(home, "proj");
    mkdirSync(root);
    writeFileSync(join(root, ".mcp.json"), '{\n  "mcpServers": {\n    "protoboard": {\n      "type": "stdio",\n      "command": "npx",\n      "args": ["protoboard", "mcp"]\n    }\n  }\n}\n');
    const q = { scope: "project" as const, projectDir: root, command: PORTABLE_COMMAND };
    expect(agentState("claude-code", q, machine())).toMatchObject({ status: "outdated", serverName: "protoboard-stack", legacyName: "protoboard" });
    expect(setupAgent("claude-code", q, machine()).action).toBe("updated");
    expect(JSON.parse(read(join(root, ".mcp.json"))).mcpServers["protoboard-stack"].args).toEqual(["--no-install", "protoboard", "mcp"]);
    expect(PORTABLE_COMMAND.args.indexOf("--no-install")).toBeLessThan(PORTABLE_COMMAND.args.indexOf("protoboard"));
  });
});

describe("removing the entry", () => {
  it("takes out only Protoboard's, in every JSON format", () => {
    for (const [id, rel, name, key] of [
      ["claude-desktop", ".config/Claude/claude_desktop_config.json", "claude_desktop_config.json", "mcpServers"],
      ["cursor", ".cursor/mcp.json", "cursor-mcp.json", "mcpServers"],
      ["vscode", ".config/Code/User/mcp.json", "vscode-mcp.json", "servers"],
      ["windsurf", ".config/devin/mcp_config.json", "windsurf-mcp_config.json", "mcpServers"],
    ] as const) {
      const file = put(rel, name);
      const before = parseJsonc(read(file));
      setupAgent(id, { command: COMMAND }, machine());
      const r = removeAgent(id, {}, machine());
      expect(r.action, id).toBe("removed");
      expect(parseJsonc(read(file)), id).toEqual(before);
      expect((parseJsonc(read(file)) as Record<string, Record<string, unknown>>)[key].protoboard, id).toBeUndefined();
      expect(removeAgent(id, {}, machine()).action, id).toBe("absent");
    }
  });
  it("VS Code: the comments survive a round trip", () => {
    const file = put(".config/Code/User/mcp.json", "vscode-mcp.json");
    setupAgent("vscode", { command: COMMAND }, machine());
    removeAgent("vscode", {}, machine());
    for (const c of ["// the servers Copilot's agent mode may start", "/* browser automation */", "// pinned later"]) expect(read(file)).toContain(c);
  });
  it("Codex: a comment or a blank line after the table is not the table's: an update and a removal both keep it, and the table stays in its place", () => {
    const file = put(".codex/config.toml", "codex-with-comment.toml");
    const was = fixture("codex-with-comment.toml");
    expect(setupAgent("codex", { command: COMMAND }, machine()).action).toBe("updated");
    // only the command's line changed: every other line, the comments included, is where it was
    const renamed = (x: string) => x.replace("[mcp_servers.protoboard]", "[mcp_servers.protoboard-stack]");
    expect(read(file)).toBe(renamed(was.replace('command = "/old/place/protoboard-mcp"', `command = "${COMMAND.command}"`)));
    // an entry whose values run over lines is written again whole, in the same place, and what follows it stays
    writeFileSync(file, was.replace("args = []", 'args = [\n  "--old",\n]'));
    expect(setupAgent("codex", { command: COMMAND }, machine()).action).toBe("updated");
    expect(read(file)).toBe(renamed(was.replace('# the launcher of an earlier install\ncommand = "/old/place/protoboard-mcp"', `command = "${COMMAND.command}"`)));
    expect(removeAgent("codex", {}, machine()).action).toBe("removed");
    expect(read(file)).toBe('model = "gpt-5.5"\n\n# Protoboard, added by hand\n\n# my note about the provider below: keep me\n[model_providers.x]\nname = "x"\nbase_url = "https://x.example/v1"\n');
  });
  it("Codex: a comment straight after the table's last line stays too, and a table that ends the file leaves no blank line behind", () => {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '[a]\nx = 1\n\n[mcp_servers.protoboard]\ncommand = "/old/protoboard-mcp"\nargs = []\n# about b\n[b]\ny = 2\n');
    removeAgent("codex", {}, machine());
    expect(read(file)).toBe("[a]\nx = 1\n\n# about b\n[b]\ny = 2\n");
    writeFileSync(file, '[a]\nx = 1\n\n[mcp_servers.protoboard]\ncommand = "/old/protoboard-mcp"\nargs = []\n');
    removeAgent("codex", {}, machine());
    expect(read(file)).toBe("[a]\nx = 1\n");
  });
  it("Codex: cuts its table and sub-table, and leaves the rest as it was", () => {
    const file = put(".codex/config.toml", "codex-with-protoboard.toml");
    const r = removeAgent("codex", {}, machine());
    expect(r.action).toBe("removed");
    const text = read(file);
    expect(text).not.toContain("protoboard");
    expect(text).toBe('model = "gpt-5.5"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n\n[projects."/home/you/work/thing"]\ntrust_level = "trusted"\n');
    // added to the plain fixture and removed again: the original text
    const plain = put(".codex/config.toml", "codex-config.toml");
    setupAgent("codex", { command: COMMAND }, machine());
    removeAgent("codex", {}, machine());
    expect(read(plain)).toBe(fixture("codex-config.toml"));
  });
  it("keeps a servers object another entry lives in, and an agent with no file is absent", () => {
    const file = put(".cline/data/settings/cline_mcp_settings.json", "cline_mcp_settings.json");
    removeAgent("cline-cli", {}, machine());
    expect(Object.keys(JSON.parse(read(file)).mcpServers)).toEqual(["local-server"]);
    expect(removeAgent("gemini", {}, machine())).toMatchObject({ action: "absent" });
    expect(existsSync(join(home, ".gemini"))).toBe(false);
  });
  it("Claude Code: runs `claude mcp remove` when the command is installed", () => {
    const file = join(home, ".claude.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(fixture("claude.json")), mcpServers: { protoboard: { type: "stdio", ...COMMAND, env: {} } } }, null, 2));
    const calls: string[][] = [];
    const m = machine({ which: () => "/usr/local/bin/claude", run: (c, a) => (calls.push([c, ...a]), { status: 0, stdout: "", stderr: "" }) });
    expect(removeAgent("claude-code", {}, m)).toMatchObject({ action: "removed", method: "command" });
    expect(calls).toEqual([["/usr/local/bin/claude", "mcp", "remove", "--scope", "user", "protoboard"]]);
    expect(JSON.parse(read(file)).mcpServers.protoboard).toBeTruthy();
  });
});

describe("with Claude Code installed here", () => {
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  it.skipIf(claude.status !== 0)("its own command writes the entry this reads back, in a temporary home", () => {
    const m = agentMachine({ home, env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: undefined } as NodeJS.ProcessEnv });
    expect(agentState("claude-code", { command: COMMAND }, m).method).toBe("command");
    const r = setupAgent("claude-code", { command: COMMAND }, m);
    expect(r).toMatchObject({ action: "added", method: "command", file: join(home, ".claude.json") });
    expect(agentState("claude-code", { command: COMMAND }, m)).toMatchObject({ status: "connected", entry: COMMAND });
    expect(setupAgent("claude-code", { command: COMMAND }, m).action).toBe("unchanged");
    expect(setupAgent("claude-code", { command: { command: "/elsewhere/protoboard-mcp", args: ["x"] } }, m).action).toBe("updated");
    expect(agentState("claude-code", { command: COMMAND }, m)).toMatchObject({ status: "outdated", entry: { command: "/elsewhere/protoboard-mcp", args: ["x"] } });
    expect(removeAgent("claude-code", {}, m).action).toBe("removed");
    expect(agentState("claude-code", { command: COMMAND }, m).status).toBe("not-connected");
  });
});

describe("the launcher", () => {
  const place = () => ({ env: { HOME: home } as NodeJS.ProcessEnv, platform: "linux" as const });
  it("lives in Protoboard's per-user folder on each platform", () => {
    expect(launcherDir({ env: { HOME: "/home/you" }, platform: "linux" })).toBe("/home/you/.config/protoboard/agents");
    expect(launcherDir({ env: { HOME: "/Users/you" }, platform: "darwin" })).toBe("/Users/you/.config/protoboard/agents");
    expect(launcherDir({ env: { APPDATA: "C:\\Users\\you\\AppData\\Roaming" }, platform: "win32" })).toBe("C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents");
    expect(launcherCommand({ env: { HOME: "/home/you" }, platform: "linux" })).toEqual({ command: "/home/you/.config/protoboard/agents/protoboard-mcp", args: [] });
    expect(launcherCommand({ env: { APPDATA: "C:\\Users\\you\\AppData\\Roaming" }, platform: "win32" })).toEqual({ command: "cmd", args: ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] });
  });
  it("writes its files once, records the CLI, and drops the ones that are gone", () => {
    const cli = join(home, "cli.mjs");
    writeFileSync(cli, "");
    const first = installLauncher({ ...place(), cli: { entry: cli, version: "0.1.3", from: "npm" }, node: "/usr/bin/node", now: "2026-10-07T00:00:00.000Z" });
    expect(first.written.sort()).toEqual(["launcher.json", "node-path", ...Object.keys(LAUNCHER_FILES)].sort());
    expect(existsSync(join(first.dir, "node-electron"))).toBe(false);
    expect(statSync(join(first.dir, "protoboard-mcp")).mode & 0o111).toBeTruthy();
    expect(read(join(first.dir, "node-path"))).toBe("/usr/bin/node\n");
    expect(readLauncherRecord(place()).cli).toEqual([{ entry: cli, version: "0.1.3", from: "npm", recordedAt: "2026-10-07T00:00:00.000Z" }]);
    // again: nothing to write
    expect(installLauncher({ ...place(), cli: { entry: cli, version: "0.1.3", from: "npm" }, node: "/usr/bin/node" }).written).toEqual([]);
    // the extension's newer CLI is recorded first; a CLI whose file is gone is dropped
    const carried = join(home, "ext-0.1.4.mjs");
    writeFileSync(carried, "");
    rmSync(cli);
    const next = installLauncher({ ...place(), cli: { entry: carried, version: "0.1.4", from: "extension" }, node: "/usr/bin/node" });
    expect(next.written).toEqual(["launcher.json"]);
    expect(next.cli.map((c) => c.entry)).toEqual([carried]);
  });
  it("tells a project's CLI from a machine's", () => {
    const proj = join(home, "proj");
    mkdirSync(join(proj, "node_modules", "@protoboardai", "cli", "bin"), { recursive: true });
    writeFileSync(join(proj, "protoboard.config.ts"), "");
    expect(cliOriginOf(join(proj, "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs"))).toBe("project");
    expect(cliOriginOf(join(home, "lib", "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs"))).toBe("npm");
  });

  /** A fake CLI that says how it was started. */
  const fakeCli = (file: string, name: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `process.stdout.write(JSON.stringify({ cli: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + "\\n");\n`);
    return file;
  };
  const start = (cwd: string, env: NodeJS.ProcessEnv = {}) => spawnSync(join(launcherDir(place()), "protoboard-mcp"), [], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, ...env } });

  it.skipIf(process.platform === "win32")("runs `<cli> mcp` with the recorded CLI: the extension's before a global one, the newest first", () => {
    const old = fakeCli(join(home, "ext-0.1.3", "protoboard.mjs"), "extension 0.1.3");
    const carried = fakeCli(join(home, "ext-0.1.4", "protoboard.mjs"), "extension 0.1.4");
    const global = fakeCli(join(home, "global", "protoboard.mjs"), "npm 0.2.0");
    installLauncher({ ...place(), cli: { entry: old, version: "0.1.3", from: "extension" } });
    installLauncher({ ...place(), cli: { entry: global, version: "0.2.0", from: "npm" } });
    installLauncher({ ...place(), cli: { entry: carried, version: "0.1.4", from: "extension" } });
    const r = start(home);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ cli: "extension 0.1.4", args: ["mcp"] });
    // the extension updated and its old folder is gone: the next one is used, with no setup run in between
    rmSync(dirname(carried), { recursive: true });
    expect(JSON.parse(start(home).stdout).cli).toBe("extension 0.1.3");
    rmSync(dirname(old), { recursive: true });
    expect(JSON.parse(start(home).stdout).cli).toBe("npm 0.2.0");
    expect(JSON.parse(start(home, { PROTOBOARD_CLI: fakeCli(join(home, "dev", "protoboard.mjs"), "from the variable") }).stdout).cli).toBe("from the variable");
  });

  it.skipIf(process.platform === "win32")("falls back to the CLI of the project it was started in, and says what to do when there is none", () => {
    installLauncher(place());
    const proj = join(home, "proj");
    fakeCli(join(proj, "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs"), "the project's");
    mkdirSync(join(proj, "src"));
    expect(JSON.parse(start(join(proj, "src")).stdout).cli).toBe("the project's");
    const none = start(home);
    expect(none.status).toBe(127);
    expect(none.stderr).toMatch(/Protoboard CLI was not found.*protoboard agents setup/);
    expect(none.stdout).toBe("");
  });

  it.skipIf(process.platform === "win32")("finds Node without a PATH when the recorded one works, and with one when it does not", () => {
    const cli = fakeCli(join(home, "global", "protoboard.mjs"), "npm");
    installLauncher({ ...place(), cli: { entry: cli, version: "0.1.3", from: "npm" } });
    // a Dock-started agent on macOS: no shell PATH
    expect(JSON.parse(start(home, { PATH: "/nonexistent" }).stdout).cli).toBe("npm");
    writeFileSync(join(launcherDir(place()), "node-path"), "/gone/after/an/upgrade/node\n");
    expect(JSON.parse(start(home).stdout).cli).toBe("npm");
  });
});

describe("the launcher with an editor's runtime (a machine with no Node.js)", () => {
  it.skipIf(process.platform === "win32")("runs it as Node: ELECTRON_RUN_AS_NODE is set for the recorded runtime, and not for a Node.js", () => {
    const place = { env: { HOME: home } as NodeJS.ProcessEnv, platform: "linux" as const };
    const cli = join(home, "carried", "protoboard.mjs");
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, `process.stdout.write(JSON.stringify({ asNode: process.env.ELECTRON_RUN_AS_NODE ?? null, args: process.argv.slice(2) }) + "\\n");\n`);
    // a stand-in for the editor's executable: it is Node only when asked to be
    const editor = join(home, "editor");
    writeFileSync(editor, `#!/bin/sh\nif [ "$ELECTRON_RUN_AS_NODE" != 1 ]; then echo "the editor opened a window" >&2; exit 9; fi\nexec "${process.execPath}" "$@"\n`);
    chmodSync(editor, 0o755);
    const run = () => spawnSync(join(launcherDir(place), "protoboard-mcp"), [], { cwd: home, encoding: "utf8", env: { PATH: "/nonexistent", HOME: home } });
    const state = installLauncher({ ...place, cli: { entry: cli, version: "0.1.4", from: "extension" }, node: editor, electron: true });
    expect(state.written).toContain("node-electron");
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ asNode: "1", args: ["mcp"] });
    // a real Node.js recorded later: the mark goes, and the variable is not set
    const next = installLauncher({ ...place, cli: { entry: cli, version: "0.1.4", from: "extension" }, node: process.execPath });
    expect(next.written).toContain("node-electron");
    expect(existsSync(join(next.dir, "node-electron"))).toBe(false);
    expect(JSON.parse(run().stdout).asNode).toBeNull();
  });
});

describe("a configuration that starts with a byte-order mark (Windows editors write one)", () => {
  it("is read as what it is, edited, and keeps its mark and its line ends", () => {
    const file = put(".gemini/settings.json", "gemini-with-bom.json");
    const was = fixture("gemini-with-bom.json");
    expect(was.charCodeAt(0)).toBe(0xfeff);
    expect(agentState("gemini", { command: COMMAND }, machine())).toMatchObject({ status: "not-connected" });
    expect(setupAgent("gemini", { command: COMMAND }, machine()).action).toBe("added");
    const text = read(file);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(JSON.parse(text.slice(1)).mcpServers).toEqual({ github: { command: "gh-mcp", args: [] }, "protoboard-stack": { command: COMMAND.command, args: [] } });
    expect(agentState("gemini", { command: COMMAND }, machine()).status).toBe("connected");
    removeAgent("gemini", {}, machine());
    expect(read(file)).toBe(was);
  });
  it("in TOML too", () => {
    const file = join(home, ".codex", "config.toml");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '\uFEFFmodel = "x"\n');
    setupAgent("codex", { command: COMMAND }, machine());
    expect(read(file)).toBe(`\uFEFFmodel = "x"\n\n[mcp_servers.protoboard-stack]\ncommand = "${COMMAND.command}"\nargs = []\n`);
    removeAgent("codex", {}, machine());
    expect(read(file)).toBe('\uFEFFmodel = "x"\n');
  });
});

describe("what is said about another server named protoboard", () => {
  it("is its host or its command's name, never a path, a query or an argument: a key can be in them", () => {
    const file = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { protoboard: { url: "https://user:pw@alpha.example:8443/mcp/v1?key=SECRET-1#frag" } } }));
    const url = agentState("cursor", { command: COMMAND }, machine());
    expect(url.alphaServer).toBe("https://alpha.example:8443");
    writeFileSync(file, JSON.stringify({ mcpServers: { protoboard: { command: "/opt/tools/alpha-mcp", args: ["--token", "SECRET-2"], env: { KEY: "SECRET-3" } } } }));
    const command = agentState("cursor", { command: COMMAND }, machine());
    expect(command.alphaServer).toBe("the command alpha-mcp");
    writeFileSync(file, JSON.stringify({ mcpServers: { protoboard: { url: "not a url SECRET-4" } } }));
    const odd = agentState("cursor", { command: COMMAND }, machine());
    for (const s of [url, command, odd]) expect(JSON.stringify(s)).not.toMatch(/SECRET|pw@/);
  });
});

describe("a write in a project says what it leaves that is this machine's only", () => {
  it("an entry that starts this machine's launcher, and the copy of the file as it was", () => {
    const root = join(home, "proj");
    mkdirSync(root);
    writeFileSync(join(root, ".mcp.json"), '{ "mcpServers": {} }\n');
    const r = setupAgent("claude-code", { scope: "project", projectDir: root, command: COMMAND }, machine());
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings![0]).toMatch(/this machine only: do not commit .*\.mcp\.json/);
    expect(r.warnings![1]).toMatch(/\.mcp\.json\.protoboard-backup .*do not commit it/);
    // the shared entry, in a new file: nothing to warn about
    const shared = setupAgent("cursor", { scope: "project", projectDir: root, command: PORTABLE_COMMAND }, machine());
    expect(shared.warnings).toBeUndefined();
    // the user's own configuration is theirs: no warning there
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), "{}");
    expect(setupAgent("cursor", { command: COMMAND }, machine()).warnings).toBeUndefined();
  });
});

describe("other MCP clients", () => {
  it("are given the name protoboard-stack: the alpha web app's server is named protoboard on many machines", () => {
    expect(otherClientName([])).toBe("protoboard-stack");
    expect(otherClientName([{ serverName: "protoboard-stack", otherServer: "https://alpha.example" }])).toBe("protoboard-stack");
    const c = otherClientConfig(COMMAND, "protoboard-stack");
    expect(Object.keys(JSON.parse(c.json).mcpServers)).toEqual(["protoboard-stack"]);
    expect(Object.keys(JSON.parse(c.vscodeJson).servers)).toEqual(["protoboard-stack"]);
    expect(c.toml).toContain("[mcp_servers.protoboard-stack]");
    expect(c.claudeLine).toBe(`claude mcp add --scope user protoboard-stack -- ${COMMAND.command}`);
    expect(c.steps[0]).toMatch(/named protoboard-stack .*Leave one named protoboard unless its command ends in/);
    expect(otherClientConfig(COMMAND).claudeLine).toBe(`claude mcp add --scope user protoboard-stack -- ${COMMAND.command}`);
  });

  it("gives the entry as JSON, for VS Code, as TOML and as one line", () => {
    const c = otherClientConfig(COMMAND);
    expect(JSON.parse(c.json)).toEqual({ mcpServers: { "protoboard-stack": { command: COMMAND.command, args: [] } } });
    expect(JSON.parse(c.vscodeJson)).toEqual({ servers: { "protoboard-stack": { type: "stdio", command: COMMAND.command, args: [] } } });
    expect(parseToml(c.toml)).toEqual({ mcp_servers: { "protoboard-stack": { command: COMMAND.command, args: [] } } });
    expect(c.commandLine).toBe(COMMAND.command);
    expect(c.steps.join(" ")).toMatch(/stdio/);
    const win = otherClientConfig({ command: "cmd", args: ["/c", "C:\\Users\\A B\\protoboard-mcp.cmd"] });
    expect(parseToml(win.toml)).toEqual({ mcp_servers: { "protoboard-stack": { command: "cmd", args: ["/c", "C:\\Users\\A B\\protoboard-mcp.cmd"] } } });
    expect(win.commandLine).toBe('cmd /c "C:\\\\Users\\\\A B\\\\protoboard-mcp.cmd"');
  });
});

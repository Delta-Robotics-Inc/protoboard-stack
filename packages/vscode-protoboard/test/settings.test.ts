/**
 * The settings page's model and the first-run offer (PB-930): which agents
 * the page lists and what each row says, the entry for other MCP clients,
 * when the offer shows, and the one function that names the machine's CLI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentMachine, listAgents, setupAgent, type AgentState } from "@protoboardai/core/agents";
import { launcherCommand, launcherDir, readLauncherRecord } from "@protoboardai/core/agent-launcher";
import { agentRows, changeText, cliEntry, cliToRecord, offerText, offerable, otherClients, recordCli, settingsModel, shouldOffer, machineCli } from "../src/agents.js";
import { CLI_BIN } from "../src/cli.js";

const HOME = mkdtempSync(join(tmpdir(), "pb-settings-"));
afterAll(() => rmSync(HOME, { recursive: true, force: true }));
const machine = agentMachine({ home: HOME, platform: "linux", env: { HOME }, which: () => undefined });
const place = { env: { HOME } as NodeJS.ProcessEnv, platform: "linux" as const };
const COMMAND = launcherCommand(place);
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

mkdirSync(join(HOME, ".cursor"));
mkdirSync(join(HOME, ".gemini"));
mkdirSync(join(HOME, ".codex"));
mkdirSync(join(HOME, ".cline"));
writeFileSync(join(HOME, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { protoboard: { type: "http", url: "https://alpha.example/mcp" } } }));
writeFileSync(join(HOME, ".gemini", "settings.json"), '{ "theme": ');
writeFileSync(join(HOME, ".codex", "config.toml"), '[mcp_servers.protoboard]\ncommand = "/old/place/protoboard-mcp"\nargs = []\n');
const states = () => listAgents({ command: COMMAND }, machine);

describe("the agents on the settings page", () => {
  it("lists the ones found here with their state, and names the ones that were not", () => {
    const { rows, notFound } = agentRows(states(), HOME);
    expect(rows.map((r) => [r.id, r.status, r.file])).toEqual([
      ["cursor", "not-connected", "~/.cursor/mcp.json"],
      ["codex", "outdated", "~/.codex/config.toml"],
      ["gemini", "unreadable", "~/.gemini/settings.json"],
      ["cline-cli", "not-connected", "~/.cline/data/settings/cline_mcp_settings.json"],
    ]);
    expect(notFound).toEqual(["Claude Code", "Claude Desktop", "VS Code (Copilot agent mode)", "VS Code Insiders (Copilot agent mode)", "Windsurf (Devin Desktop)", "Cline (VS Code)"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.cursor.detail).toBe("Also has an older server named protoboard (https://alpha.example); this one is protoboard-stack.");
    expect(by.codex).toMatchObject({ detailTone: "warning", detail: "Out of date: Update to use the current launcher." });
    expect(by.gemini.detailTone).toBe("error");
    expect(by.gemini.detail).toMatch(/not valid JSON.*left alone/);
    expect(by["cline-cli"].detail).toBeUndefined();
  });

  it("Claude Code without its command: the row gives the command to run, to copy, in place of Connect", () => {
    const line = "claude mcp add --scope user protoboard -- /l/protoboard-mcp";
    const state = { ...states().find((a) => a.id === "cline-cli")!, id: "claude-code", name: "Claude Code", method: "command" as const, manual: line };
    const { rows } = agentRows([state], HOME);
    expect(rows[0]).toMatchObject({ status: "not-connected", manual: line, detailTone: "neutral" });
    expect(rows[0].detail).toBe(`Run in a terminal: ${line}`);
    // what a press of a button just did is said first
    expect(agentRows([state], HOME, { "claude-code": { text: "x", tone: "error" } }).rows[0]).toMatchObject({ detail: "x" });
  });

  it("says what a change wrote and where, and shows a row as working while it runs", () => {
    const change = setupAgent("cline-cli", { command: COMMAND }, machine);
    expect(changeText(change, HOME)).toBe("Added to ~/.cline/data/settings/cline_mcp_settings.json. The Cline CLI starts the server with its next session.");
    const alpha = setupAgent("cursor", { command: COMMAND }, machine);
    // the name is protoboard-stack everywhere since 0.1.7 (PB-1018), so a change no longer says it
    // the backup is named in the log, not on the row
    expect(changeText(alpha, HOME)).toBe("Added to ~/.cursor/mcp.json. Cursor lists it under Settings, MCP; turn it on there if it is off.");
    const { rows } = agentRows(states(), HOME, { "cline-cli": { text: changeText(change, HOME), tone: "ok" } }, new Set(["codex"]));
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by["cline-cli"]).toMatchObject({ status: "connected", detailTone: "ok" });
    expect(by.cursor).toMatchObject({ status: "connected", detail: "Also has an older server named protoboard (https://alpha.example); this one is protoboard-stack." });
    expect(by.codex.working).toBe(true);
    expect(by.cursor.working).toBeUndefined();
  });

  it("the model: account, one version number, the CLI in use, the agents, and the entry for any other client", () => {
    const m = settingsModel({
      account: { state: "signed-in", email: "you@example.com" },
      version: PKG.version,
      cli: { command: { command: "node", args: [join(HOME, "proj", "node_modules", CLI_BIN)], from: "project" }, origin: "project" },
      agents: states(),
      command: COMMAND,
      home: HOME,
    });
    expect(m.account.email).toBe("you@example.com");
    expect(m.about).toEqual({ version: PKG.version, cli: `~/proj/node_modules/${CLI_BIN}`, cliFrom: "the project's own" });
    expect(m.agents.state).toBe("ready");
    expect(m.agents.rows).toHaveLength(4);
    expect(m.other!.forms.map((f) => f.id)).toEqual(["json", "vscode", "toml", "command", "claude"]);
    // Cursor here has another server named protoboard (the alpha app's): what is copied for any client has the name the rows use
    expect(JSON.parse(m.other!.forms[0].text)).toEqual({ mcpServers: { "protoboard-stack": { command: join(HOME, ".config/protoboard/agents/protoboard-mcp"), args: [] } } });
    expect(m.other!.forms[4].text).toBe(`claude mcp add --scope user protoboard-stack -- ${join(HOME, ".config/protoboard/agents/protoboard-mcp")}`);
    const alone = settingsModel({ account: { state: "unknown" }, version: "1", command: COMMAND, home: HOME, agents: states().filter((a) => a.id !== "cursor") });
    expect(alone.other!.forms[4].text).toBe(`claude mcp add --scope user protoboard-stack -- ${join(HOME, ".config/protoboard/agents/protoboard-mcp")}`);
    expect(settingsModel({ account: { state: "unknown" }, version: "1", command: COMMAND, home: HOME }).agents.state).toBe("loading");
    const failed = settingsModel({ account: { state: "unknown" }, version: "1", command: COMMAND, home: HOME, agentsProblem: "boom", cli: { command: { command: "protoboard", args: [], from: "path" } } });
    expect(failed.agents).toMatchObject({ state: "failed", problem: "boom", rows: [] });
    expect(failed.about).toMatchObject({ cli: "protoboard", cliFrom: "found on PATH" });
  });

  it("the entry for other clients is the same one in every form", () => {
    const o = otherClients({ command: "cmd", args: ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] });
    expect(JSON.parse(o.forms[1].text).servers["protoboard-stack"]).toEqual({ type: "stdio", command: "cmd", args: ["/c", "C:\\Users\\you\\AppData\\Roaming\\protoboard\\agents\\protoboard-mcp.cmd"] });
    expect(o.steps).toHaveLength(3);
  });
});

describe("the first-run offer", () => {
  const found = (over: Partial<AgentState>[]): AgentState[] => over.map((o, i) => ({ id: `a${i}`, name: `Agent ${i}`, scope: "user", detected: true, file: "/f", status: "not-connected", serverName: "protoboard", method: "file", docs: "", restart: "", ...o }));

  it("is about the agents found here that are not connected", () => {
    const agents = found([{ status: "connected" }, { status: "not-connected" }, { status: "outdated" }, { status: "unreadable" }, { status: "not-detected", detected: false }]);
    expect(offerable(agents).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("shows once, on an occasion, when there is an agent to connect and the setting allows", () => {
    const agents = found([{}]);
    expect(shouldOffer({ enabled: true, offered: false, occasion: true, agents })).toBe(true);
    expect(shouldOffer({ enabled: true, offered: true, occasion: true, agents })).toBe(false);
    expect(shouldOffer({ enabled: false, offered: false, occasion: true, agents })).toBe(false);
    expect(shouldOffer({ enabled: true, offered: false, occasion: false, agents })).toBe(false);
    expect(shouldOffer({ enabled: true, offered: false, occasion: true, agents: found([{ status: "connected" }]) })).toBe(false);
    expect(shouldOffer({ enabled: true, offered: false, occasion: true, agents: [] })).toBe(false);
  });

  it("names the agents and says what connecting does", () => {
    expect(offerText(found([{ name: "Claude Code" }]))).toBe("Protoboard: connect Claude Code? This adds Protoboard's MCP server to each one's configuration.");
    expect(offerText(found([{ name: "Claude Code" }, { name: "VS Code (Copilot agent mode)" }]))).toMatch(/connect Claude Code and VS Code\?/);
    expect(offerText(found([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }]))).toMatch(/connect A, B, C and 2 more\?/);
  });
});

describe("the machine's CLI (the seam with the extension carrying it)", () => {
  it("is what resolveCli finds from the folder, with where it belongs", () => {
    const proj = join(HOME, "proj");
    const bin = join(proj, "node_modules", CLI_BIN);
    const exists = (p: string) => p === bin || p === join(proj, "protoboard.config.ts");
    const own = machineCli(proj, { nodePath: "/usr/bin/node" }, exists);
    expect(own).toEqual({ cli: { command: "/usr/bin/node", args: [bin], from: "project" }, origin: "project" });
    expect(cliEntry(own.cli)).toBe(bin);
    const none = machineCli(HOME, {}, () => false);
    expect(none).toEqual({ cli: { command: "protoboard", args: [], from: "none" } });
    expect(cliEntry(none.cli)).toBeUndefined();
    expect(cliEntry({ command: "/opt/pb/protoboard.mjs", args: [], from: "setting" })).toBe("/opt/pb/protoboard.mjs");
  });

  it("is recorded for the launcher with its version and the Node.js the CLI runs with, never the editor's", () => {
    const pkg = join(HOME, "carried", "cli");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: "0.1.4" }));
    writeFileSync(join(pkg, "bin", "protoboard.mjs"), "");
    const state = recordCli(join(pkg, "bin", "protoboard.mjs"), "extension", "/opt/homebrew/bin/node", place);
    expect(state.dir).toBe(launcherDir(place));
    expect(readLauncherRecord(place).cli).toEqual([expect.objectContaining({ entry: join(pkg, "bin", "protoboard.mjs"), version: "0.1.4", from: "extension" })]);
    expect(readFileSync(join(state.dir, "node-path"), "utf8")).toBe("/opt/homebrew/bin/node\n");
    recordCli(join(pkg, "bin", "protoboard.mjs"), "extension", undefined, place);
    expect(readFileSync(join(state.dir, "node-path"), "utf8")).toBe("node\n");
    // a machine with no Node.js: the editor's runtime, marked so the launcher runs it as Node
    recordCli(join(pkg, "bin", "protoboard.mjs"), "extension", "/usr/share/code/code", place, true);
    expect(readFileSync(join(state.dir, "node-electron"), "utf8")).toBe("1\n");
    recordCli(join(pkg, "bin", "protoboard.mjs"), "extension", "/opt/homebrew/bin/node", place);
    expect(existsSync(join(state.dir, "node-electron"))).toBe(false);
  });

  it("when the extension starts: the CLI recorded again is the one that stays put, whatever folder is open, never a project's own", () => {
    const proj = join(HOME, "proj");
    const own = join(proj, "node_modules", CLI_BIN);
    const carried = join(HOME, "ext-2", "stack", "node_modules", CLI_BIN);
    const exists = (p: string) => p === own || p === join(proj, "protoboard.config.ts") || p === carried;
    // a build that carries no stack: a project's CLI, else nothing. Neither is recorded unasked
    expect(cliToRecord(proj, HOME, () => ({}), exists)).toBeUndefined();
    expect(cliToRecord(HOME, HOME, () => ({}), exists)).toBeUndefined();
    // a CLI that is the machine's (here by the setting, as the carried stack will be by PB-929's resolution):
    // in a window with no project it is found from the folder open
    const machineWide = (folder: string) => (folder === proj ? {} : { cliPath: carried, nodePath: "/opt/homebrew/bin/node", nodeFile: "/opt/homebrew/bin/node" });
    expect(cliToRecord(join(HOME, "empty"), HOME, machineWide, exists)).toMatchObject({ entry: carried, origin: "npm" });
    // and in a window with a project, whose own CLI is what resolves there, it is found from the home folder all the same
    const seen: string[] = [];
    const found = cliToRecord(proj, HOME, (f) => (seen.push(f), machineWide(f)), exists);
    expect(seen).toEqual([proj, HOME]);
    expect(found).toMatchObject({ entry: carried, settings: { nodeFile: "/opt/homebrew/bin/node" } });
    // a recorded CLI that is gone is not offered
    expect(cliToRecord(proj, HOME, machineWide, (p) => p !== carried && exists(p))).toBeUndefined();
    // the stack the extension carries (PB-929's resolution, `from: "carried"`): recorded as the extension's, from the
    // home folder when the window's project resolves to its own CLI, with the runtime the extension chose
    const stack = join(HOME, ".protoboard", "stack", "0.1.4");
    const stackCli = join(stack, "node_modules", CLI_BIN);
    const withCarried = () => ({ carried: { version: "0.1.4", dir: stack }, nodeFile: "/opt/homebrew/bin/node" });
    const has = (p: string) => exists(p) || p === stackCli;
    expect(machineCli(HOME, withCarried(), has)).toMatchObject({ cli: { from: "carried", args: [stackCli] }, origin: "extension" });
    expect(cliToRecord(proj, HOME, withCarried, has)).toMatchObject({ entry: stackCli, origin: "extension", settings: { nodeFile: "/opt/homebrew/bin/node" } });
    expect(cliToRecord(join(HOME, "empty"), HOME, withCarried, has)).toMatchObject({ entry: stackCli, origin: "extension" });
    // not unpacked yet: nothing to record until it is (the extension records again when the unpacking ends)
    expect(cliToRecord(join(HOME, "empty"), HOME, withCarried, exists)).toBeUndefined();
  });

  it("a CLI the extension carries is recorded as the extension's", () => {
    const entry = join(HOME, "carried", "node_modules", CLI_BIN);
    // what resolveCli returns once the extension carries the stack (PB-929): the sources "carried" and "store"
    for (const from of ["carried", "store"]) {
      const cli = { command: "node", args: [entry], from } as unknown as Parameters<typeof cliEntry>[0];
      const m = settingsModel({ account: { state: "unknown" }, version: "1", cli: { command: cli, origin: "extension" }, command: COMMAND, home: HOME });
      expect(m.about.cliFrom).toMatch(/extension/);
    }
  });
});

describe("the manifest", () => {
  const c = PKG.contributes;
  it("has the settings command, on the Cloud view's title, and the connect command", () => {
    const commands = Object.fromEntries(c.commands.map((x: { command: string }) => [x.command, x]));
    expect(commands["protoboard.openSettings"]).toMatchObject({ title: "Open Settings", category: "Protoboard", icon: "$(settings-gear)" });
    expect(commands["protoboard.agents.connect"]).toMatchObject({ category: "Protoboard" });
    expect(c.menus["view/title"]).toContainEqual({ command: "protoboard.openSettings", when: "view == protoboard.cloud", group: "navigation@2" });
  });
  it("has the setting that turns the offer off", () => {
    expect(c.configuration.properties["protoboard.agents.offerSetup"]).toMatchObject({ type: "boolean", default: true });
  });
});

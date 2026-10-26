/**
 * `protoboard agents`: the agents on this machine and Protoboard's MCP
 * server in their configuration (PB-930, docs/specs/agents-and-mcp.md §4-5).
 * Listing reads only. `setup` and `remove` change an agent's configuration
 * only with the user's yes for that agent: asked at a terminal, or given as
 * `--agent <id> --yes` (or `--all --yes`) where there is none.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  KNOWN_AGENTS,
  MCP_SERVER_NAME,
  PORTABLE_COMMAND,
  cliOriginOf,
  findProjectRoot,
  installLauncher,
  launcherCommand,
  launcherDir,
  listAgents,
  otherClientConfig,
  otherClientName,
  removeAgent,
  setupAgent,
  type AgentChange,
  type AgentScope,
  type AgentState,
  type CliOrigin,
  type ServerCommand,
} from "@protoboardai/core";

export interface AgentsFlags {
  agent?: string[];
  all?: boolean;
  yes?: boolean;
  scope?: string;
  /** Project scope: `npx --no-install protoboard mcp` (true), the machine's launcher (false), or decided from the project (undefined). */
  portable?: boolean;
}

export interface AgentsIo {
  json: boolean;
  cwd: string;
  version: string;
  out(data: unknown, text: () => string): void;
  /** Ask a yes/no question at the terminal; undefined when there is no terminal to ask at. */
  confirm?: (question: string) => Promise<boolean>;
}

const SELF = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));

/** The home folder written as `~`, for messages. */
const tilde = (p: string) => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
};

/** Write the launcher and record this CLI as one the machine has. */
function launcher(io: AgentsIo) {
  const from: CliOrigin = process.env.PROTOBOARD_CLI_FROM === "extension" ? "extension" : cliOriginOf(SELF);
  return installLauncher({ cli: { entry: SELF, version: io.version, from } });
}

/** The scope, the project folder it needs, and the command an entry at that scope runs. */
function where(flags: AgentsFlags, io: AgentsIo): { scope: AgentScope; projectDir?: string; command: ServerCommand; portable: boolean } {
  const scope = flags.scope ?? "user";
  if (scope !== "user" && scope !== "project") throw new Error(`--scope takes user or project, not "${scope}"`);
  if (scope === "user") return { scope, command: launcherCommand(), portable: false };
  // a project's file is shared: the folder is the Protoboard project's root, or the folder given when it is not one yet
  const projectDir = findProjectRoot(io.cwd) ?? io.cwd;
  let depends = false;
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    depends = !!(pkg.dependencies?.["@protoboardai/cli"] ?? pkg.devDependencies?.["@protoboardai/cli"]);
  } catch {
    depends = false;
  }
  const portable = flags.portable ?? depends;
  return { scope, projectDir, command: portable ? PORTABLE_COMMAND : launcherCommand(), portable };
}

const STATUS_TEXT: Record<AgentState["status"], string> = { connected: "connected", outdated: "update needed", "not-connected": "not connected", "not-detected": "not found", unreadable: "cannot read its configuration" };
const MARK: Record<AgentState["status"], string> = { connected: "✓", outdated: "!", "not-connected": "·", "not-detected": " ", unreadable: "✗" };

function validIds(ids: string[], scope: AgentScope): string[] {
  for (const id of ids) {
    const known = KNOWN_AGENTS.find((a) => a.id === id);
    if (!known) throw new Error(`no agent "${id}"; known: ${KNOWN_AGENTS.map((a) => a.id).join(", ")}`);
    if (!known.scopes.includes(scope)) throw new Error(`${known.name} has no project configuration for MCP servers; use --scope user`);
  }
  return [...new Set(ids)];
}

export async function agentsCommand(sub: string | undefined, rest: string[], flags: AgentsFlags, io: AgentsIo): Promise<void> {
  const usage = "usage: protoboard agents [list] | setup [--agent <id>]… [--all] [--yes] [--scope user|project] | remove [--agent <id>]… [--all] [--yes] [--scope user|project] | config | refresh";
  if (rest.length) throw new Error(usage);
  switch (sub ?? "list") {
    case "list": {
      const w = where(flags, io);
      const agents = listAgents(w);
      io.out({ server: { name: MCP_SERVER_NAME, ...w.command }, scope: w.scope, ...(w.projectDir ? { project: w.projectDir } : {}), agents }, () => {
        const shown = agents.filter((a) => a.status !== "not-detected");
        const width = Math.max(...shown.map((a) => a.name.length), 0);
        return [
          w.scope === "project" ? `Agents and this project's MCP configuration (${w.projectDir})` : "Agents on this machine",
          ...shown.map((a) => `  ${MARK[a.status]} ${a.name.padEnd(width)}  ${STATUS_TEXT[a.status].padEnd(14)} ${tilde(a.file)}${a.status === "outdated" ? `\n      its entry runs ${[a.entry!.command, ...a.entry!.args].join(" ")}` : ""}${a.legacyName ? `\n      its entry is named ${a.legacyName}, as before 0.1.7: setup renames it ${a.serverName}` : ""}${a.alphaServer ? `\n      the server named protoboard here is another one (${a.alphaServer}, the alpha web app's); it is left as it is` : ""}${a.problem ? `\n      ${a.problem}` : ""}${a.manual ? `\n      the \`claude\` command was not found from here; connect it yourself with: ${a.manual}` : ""}`),
          ...(shown.length ? [] : ["  none found"]),
          ...(agents.some((a) => a.status === "not-detected") ? [`  Not found here: ${agents.filter((a) => a.status === "not-detected").map((a) => a.name).join(", ")}`] : []),
          "",
          "Connect them: `protoboard agents setup` (asks about each). Any other MCP client: `protoboard agents config`.",
        ].join("\n");
      });
      return;
    }
    case "setup":
    case "remove": {
      const adding = sub === "setup";
      const w = where(flags, io);
      const named = validIds(flags.agent ?? [], w.scope);
      if (flags.yes && !named.length && !flags.all) throw new Error(`--yes needs to know which agents: --agent <id> (repeatable) or --all. An agent's configuration is not changed without a yes for that agent. See \`protoboard agents\`.`);
      const states = listAgents(w);
      // which to act on: the ones named; else the detected ones that need it
      const needs = (a: AgentState) => (adding ? a.detected && a.status !== "connected" : a.status === "connected" || a.status === "outdated");
      const targets = named.length ? states.filter((a) => named.includes(a.id)) : states.filter(needs);
      if (!flags.yes && !io.confirm) {
        throw new Error(
          `there is no terminal to ask at, and an agent's configuration is not changed without a yes for that agent. ${targets.length ? `Name them: ${targets.map((a) => `--agent ${a.id}`).join(" ")} --yes (or --all --yes).` : adding ? "No detected agent needs connecting." : "No agent has Protoboard configured."}`,
        );
      }
      // the launcher is Protoboard's own file, but it too is written only once an agent has a yes
      let launcherWritten = !adding || w.portable;
      const results: (AgentChange | { id: string; name: string; scope: AgentScope; file: string; action: "declined" | "failed" | "manual"; message?: string })[] = [];
      for (const a of targets) {
        // nothing to ask: Protoboard will not make this change itself, and says what the user runs
        if (adding && a.manual) {
          results.push({ id: a.id, name: a.name, scope: a.scope, file: a.file, action: "manual", message: `The \`claude\` command was not found from here, and Claude Code's configuration is not edited directly (it rewrites that file while it runs). Run: ${a.manual}${existsSync(join(launcherDir(), "protoboard-mcp.mjs")) ? "" : " (and `protoboard agents refresh` once: it writes the launcher that entry starts)"}` });
          continue;
        }
        if (!flags.yes) {
          const q = adding
            ? `${a.status === "outdated" ? "Update" : "Connect"} ${a.name}? This ${a.method === "command" ? `runs \`claude mcp add\`, which writes` : "adds"} the "${a.serverName}" MCP server ${a.method === "command" ? "to" : "in"} ${tilde(a.file)}`
            : `Disconnect ${a.name}? This removes the "${a.serverName}" MCP server from ${tilde(a.file)}`;
          if (!(await io.confirm!(q))) {
            results.push({ id: a.id, name: a.name, scope: a.scope, file: a.file, action: "declined" });
            continue;
          }
        }
        try {
          if (!launcherWritten) {
            launcher(io);
            launcherWritten = true;
          }
          results.push(adding ? setupAgent(a.id, w) : removeAgent(a.id, w));
        } catch (e) {
          results.push({ id: a.id, name: a.name, scope: a.scope, file: a.file, action: "failed", message: (e as Error).message });
        }
      }
      const done: Record<string, string> = { added: "connected: added to", updated: "updated in", unchanged: "already connected in", removed: "disconnected: removed from", absent: "was not configured in", declined: "left alone:", failed: "failed:", manual: "to connect yourself:" };
      io.out({ server: { name: MCP_SERVER_NAME, ...w.command }, scope: w.scope, results }, () =>
        [
          ...results.map((r) =>
            [
              `${r.action === "failed" ? "✗" : r.action === "declined" || r.action === "manual" ? "·" : "✓"} ${r.name}: ${done[r.action]} ${tilde(r.file)}${"method" in r && r.method === "command" && (r.action === "added" || r.action === "updated" || r.action === "removed") ? " (by `claude mcp`)" : ""}`,
              ...("movedFrom" in r && r.movedFrom ? [`    renamed from "${r.movedFrom}" (its name before 0.1.7) to "${r.serverName}"`] : []),
              ...("backup" in r && r.backup ? [`    the file as it was is kept as ${tilde(r.backup)}`] : []),
              ...("warnings" in r && r.warnings ? r.warnings.map((x) => `    ! ${x}`) : []),
              ...("message" in r && r.message ? [`    ${r.message}`] : []),
              ...("restart" in r && (r.action === "added" || r.action === "updated") ? [`    ${r.restart}`] : []),
            ].join("\n"),
          ),
          ...(results.length ? [] : [adding ? "No detected agent needs connecting (`protoboard agents` lists them; `--agent <id>` names one that was not found)." : "No agent has Protoboard configured."]),
          ...(adding && results.some((r) => r.action === "added" || r.action === "updated") ? ["", `The entry runs: ${[w.command.command, ...w.command.args].join(" ")}`] : []),
        ].join("\n"),
      );
      process.exitCode = results.some((r) => r.action === "failed") ? 1 : 0;
      return;
    }
    case "config": {
      // prints only: the launcher the entry names is written by `setup`, or by `refresh` for a client set up by hand
      const w = where(flags, io);
      // always protoboard-stack: the alpha web app's server is named protoboard on many machines
      const c = otherClientConfig(w.command, otherClientName());
      const installed = w.portable || existsSync(join(launcherDir(), "protoboard-mcp.mjs"));
      io.out({ server: c.name, ...c, ...(w.portable ? {} : { launcher: launcherDir(), launcherInstalled: installed }) }, () =>
        [
          "Protoboard's MCP server, for any MCP client",
          "",
          ...c.steps.map((s, i) => `${i + 1}. ${s}`),
          "",
          "Command:",
          `  ${c.commandLine}`,
          "",
          "JSON (clients that read mcpServers: Claude Desktop, Cursor, Windsurf, Gemini CLI, Cline, …):",
          c.json,
          "",
          "JSON (VS Code's mcp.json):",
          c.vscodeJson,
          "",
          "TOML (Codex):",
          c.toml,
          "",
          "Claude Code:",
          `  ${c.claudeLine}`,
          ...(w.portable ? [] : ["", `The command is a launcher in ${tilde(launcherDir())}: it finds Node.js and the Protoboard CLI each time, so the entry keeps working when Protoboard updates.`]),
          ...(installed ? [] : ["", "The launcher is not on this machine yet, and this command writes nothing. Write it before the client starts the server: `protoboard agents refresh`."]),
        ].join("\n"),
      );
      return;
    }
    case "refresh": {
      // writes Protoboard's own folder only, never an agent's file: the launcher's files, and this CLI recorded.
      // For a client set up by hand from `agents config`, and what the extension runs when it starts
      const state = launcher(io);
      io.out(state, () => (state.written.length ? `wrote ${state.written.join(", ")} in ${tilde(state.dir)}` : `the launcher in ${tilde(state.dir)} is up to date`));
      return;
    }
    default:
      throw new Error(usage);
  }
}

/** A yes/no question at the terminal, when there is one. */
export function terminalConfirm(): AgentsIo["confirm"] {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return undefined;
  return async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  };
}

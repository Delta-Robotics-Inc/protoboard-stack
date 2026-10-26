/**
 * The agents on this machine and their MCP configuration (PB-930,
 * docs/specs/agents-and-mcp.md §4): detect the ones installed, read whether
 * Protoboard's server is configured, add or remove its entry.
 *
 * Reading never writes. A write changes one entry and nothing else: the file
 * is edited in place (comments, order and indentation kept), the result is
 * parsed again and compared with the original before it replaces it, a file
 * that does not parse is refused, and a copy is made before the first write.
 * Whether to write at all is the caller's question to the user, per agent.
 *
 * Each location and format is from the agent's own documentation, read on
 * 2026-10-07; `docs` names the page. What is not from there says so in `note`.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";
import { applyEdits, createScanner, modify, parse as parseJsonc, parseTree, printParseErrorCode, type Node as JsonNode, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { PORTABLE_COMMAND, type ServerCommand } from "./agent-launcher.js";

/**
 * The entry's name in every agent's configuration (PB-1018): `protoboard-stack`.
 * The alpha web app's MCP server is called `protoboard` on many machines (and
 * in company workspaces' `.mcp.json`), and an agent told to "use the
 * Protoboard MCP server" took whichever it found first.
 */
export const MCP_SERVER_NAME = "protoboard-stack";
/**
 * The name this server had before 0.1.7. An entry of that name that starts
 * this server (`isOurs`) is moved to MCP_SERVER_NAME by setup and taken out
 * by remove; one that points anywhere else (the alpha app's) is never touched.
 */
export const MCP_SERVER_LEGACY_NAME = "protoboard";
/** @deprecated The name is always MCP_SERVER_NAME now; kept for callers of 0.1.6. */
export const MCP_SERVER_ALT_NAME = MCP_SERVER_NAME;

/** The machine as detection sees it; tests give a temporary home. */
export interface AgentMachine {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  /** The full path of a command on PATH. */
  which(command: string): string | undefined;
  /** Run an agent's own command (`claude mcp add`). */
  run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string };
}

export function agentMachine(over: Partial<AgentMachine> = {}): AgentMachine {
  const env = over.env ?? process.env;
  const platform = over.platform ?? process.platform;
  const exists = over.exists ?? existsSync;
  const P = platform === "win32" ? win32 : posix;
  return {
    home: over.home ?? env.HOME ?? env.USERPROFILE ?? homedir(),
    platform,
    env,
    exists,
    which:
      over.which ??
      ((command) => {
        const names = platform === "win32" ? [`${command}.exe`, `${command}.cmd`, command] : [command];
        for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean)) {
          for (const n of names) if (exists(P.join(dir, n))) return P.join(dir, n);
        }
        return undefined;
      }),
    run:
      over.run ??
      ((command, args) => {
        const r = spawnSync(command, args, { encoding: "utf8", env, windowsHide: true, timeout: 30_000 });
        return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : "") };
      }),
  };
}

export type AgentScope = "user" | "project";
type Format = "json" | "toml";

/** One configuration file of an agent. */
interface Target {
  file: string;
  format: Format;
  /** The object holding the servers: `mcpServers`, VS Code's `servers`, Codex's `mcp_servers`. */
  key: string;
  /** The entry this agent expects for a command. */
  entry(c: ServerCommand): Record<string, unknown>;
}

interface AgentDef {
  id: string;
  name: string;
  /** The page of the agent's documentation the location and format are from. */
  docs: string;
  /** What shows it is installed here. */
  detect(h: AgentMachine): string | undefined;
  user(h: AgentMachine): Target;
  project?(h: AgentMachine, root: string): Target;
  /** How the agent picks a change up. */
  restart: string;
  note?: string;
}

const paths = (h: AgentMachine) => (h.platform === "win32" ? win32 : posix);
const plain = (c: ServerCommand) => ({ command: c.command, args: c.args });
const stdio = (c: ServerCommand) => ({ type: "stdio", command: c.command, args: c.args });

/** The user's general configuration folder: `%APPDATA%`, `~/Library/Application Support`, `$XDG_CONFIG_HOME` or `~/.config`. */
function appData(h: AgentMachine): string {
  const P = paths(h);
  if (h.platform === "win32") return h.env.APPDATA ?? P.join(h.home, "AppData", "Roaming");
  if (h.platform === "darwin") return P.join(h.home, "Library", "Application Support");
  return h.env.XDG_CONFIG_HOME || P.join(h.home, ".config");
}

const firstSeen = (h: AgentMachine, checks: [string, string][], commands: string[] = []): string | undefined => {
  for (const [path, what] of checks) if (h.exists(path)) return what;
  for (const c of commands) {
    const at = h.which(c);
    if (at) return `${c} is on PATH (${at})`;
  }
  return undefined;
};

function vscode(id: string, name: string, folder: string, command: string): AgentDef {
  const user = (h: AgentMachine) => paths(h).join(appData(h), folder, "User");
  return {
    id,
    name,
    docs: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    detect: (h) => firstSeen(h, [[user(h), `${user(h)} exists`]], [command]),
    user: (h) => ({ file: paths(h).join(user(h), "mcp.json"), format: "json", key: "servers", entry: stdio }),
    project: (h, root) => ({ file: paths(h).join(root, ".vscode", "mcp.json"), format: "json", key: "servers", entry: stdio }),
    restart: "Starts the next time agent mode lists its tools.",
  };
}

/** Windsurf, now Devin Desktop: the documented file, or the earlier one when that is the one on this machine. */
function windsurfFile(h: AgentMachine): string {
  const P = paths(h);
  const now = P.join(h.platform === "win32" ? (h.env.APPDATA ?? P.join(h.home, "AppData", "Roaming")) : h.env.XDG_CONFIG_HOME || P.join(h.home, ".config"), "devin", "mcp_config.json");
  const before = P.join(h.home, ".codeium", "windsurf", "mcp_config.json");
  if (h.exists(now)) return now;
  if (h.exists(before)) return before;
  if (h.exists(P.dirname(now))) return now;
  return h.exists(P.dirname(before)) ? before : now;
}

const AGENTS: AgentDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    docs: "https://code.claude.com/docs/en/mcp",
    detect: (h) => {
      const P = paths(h);
      const dir = h.env.CLAUDE_CONFIG_DIR;
      return firstSeen(h, dir ? [[dir, `${dir} exists`]] : [[P.join(h.home, ".claude.json"), "~/.claude.json exists"], [P.join(h.home, ".claude"), "~/.claude exists"]], ["claude"]);
    },
    user: (h) => ({ file: paths(h).join(h.env.CLAUDE_CONFIG_DIR ?? h.home, ".claude.json"), format: "json", key: "mcpServers", entry: (c) => ({ type: "stdio", command: c.command, args: c.args, env: {} }) }),
    project: (h, root) => ({ file: paths(h).join(root, ".mcp.json"), format: "json", key: "mcpServers", entry: stdio }),
    restart: "Starts with Claude Code's next session.",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
    detect: (h) => {
      const dir = paths(h).join(appData(h), "Claude");
      return firstSeen(h, [[dir, `${dir} exists`], ...(h.platform === "darwin" ? ([["/Applications/Claude.app", "/Applications/Claude.app exists"]] as [string, string][]) : [])]);
    },
    user: (h) => ({ file: paths(h).join(appData(h), "Claude", "claude_desktop_config.json"), format: "json", key: "mcpServers", entry: plain }),
    restart: "Quit Claude Desktop completely and start it again.",
    note: "Documented for macOS and Windows. On Linux the folder is the one unofficial builds use; a Windows install from the Microsoft Store may keep its configuration elsewhere.",
  },
  {
    id: "cursor",
    name: "Cursor",
    docs: "https://cursor.com/docs/context/mcp",
    detect: (h) => firstSeen(h, [[paths(h).join(h.home, ".cursor"), "~/.cursor exists"]], ["cursor"]),
    user: (h) => ({ file: paths(h).join(h.home, ".cursor", "mcp.json"), format: "json", key: "mcpServers", entry: stdio }),
    project: (h, root) => ({ file: paths(h).join(root, ".cursor", "mcp.json"), format: "json", key: "mcpServers", entry: stdio }),
    restart: "Cursor lists it under Settings, MCP; turn it on there if it is off.",
  },
  vscode("vscode", "VS Code (Copilot agent mode)", "Code", "code"),
  vscode("vscode-insiders", "VS Code Insiders (Copilot agent mode)", "Code - Insiders", "code-insiders"),
  {
    id: "windsurf",
    name: "Windsurf (Devin Desktop)",
    docs: "https://docs.devin.ai/desktop/cascade/mcp",
    detect: (h) => {
      const P = paths(h);
      const file = windsurfFile(h);
      return firstSeen(h, [[P.dirname(file), `${P.dirname(file)} exists`]], ["windsurf"]);
    },
    user: (h) => ({ file: windsurfFile(h), format: "json", key: "mcpServers", entry: plain }),
    restart: "Refresh the MCP servers in Cascade's settings, or restart the app.",
    note: "The documented file is in the devin folder; ~/.codeium/windsurf/mcp_config.json is the earlier location, used when it is the one present.",
  },
  {
    id: "codex",
    name: "Codex",
    docs: "https://learn.chatgpt.com/docs/extend/mcp",
    detect: (h) => {
      const dir = h.env.CODEX_HOME ?? paths(h).join(h.home, ".codex");
      return firstSeen(h, [[dir, `${dir} exists`]], ["codex"]);
    },
    user: (h) => ({ file: paths(h).join(h.env.CODEX_HOME ?? paths(h).join(h.home, ".codex"), "config.toml"), format: "toml", key: "mcp_servers", entry: plain }),
    project: (h, root) => ({ file: paths(h).join(root, ".codex", "config.toml"), format: "toml", key: "mcp_servers", entry: plain }),
    restart: "Codex (the CLI, the IDE extension and the desktop app share the file) starts the server with its next session.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    docs: "https://geminicli.com/docs/tools/mcp-server/",
    detect: (h) => firstSeen(h, [[paths(h).join(h.home, ".gemini"), "~/.gemini exists"]], ["gemini"]),
    user: (h) => ({ file: paths(h).join(h.home, ".gemini", "settings.json"), format: "json", key: "mcpServers", entry: plain }),
    project: (h, root) => ({ file: paths(h).join(root, ".gemini", "settings.json"), format: "json", key: "mcpServers", entry: plain }),
    restart: "Gemini CLI starts the server with its next session (/mcp shows it).",
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    docs: "https://docs.cline.bot/mcp/configuring-mcp-servers",
    detect: (h) => {
      const dir = paths(h).join(appData(h), "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
      return firstSeen(h, [[dir, `${dir} exists`]]);
    },
    user: (h) => ({
      file: paths(h).join(appData(h), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
      format: "json",
      key: "mcpServers",
      entry: (c) => ({ command: c.command, args: c.args, disabled: false, autoApprove: [] }),
    }),
    restart: "Cline reloads the file by itself; its MCP Servers panel shows the server.",
    note: "Cline's documentation names the file, not its folder: the path is the extension's global storage in VS Code.",
  },
  {
    id: "cline-cli",
    name: "Cline CLI",
    docs: "https://docs.cline.bot/mcp/configuring-mcp-servers",
    detect: (h) => firstSeen(h, [[paths(h).join(h.home, ".cline"), "~/.cline exists"]], ["cline"]),
    user: (h) => ({
      file: h.env.CLINE_MCP_SETTINGS_PATH ?? paths(h).join(h.home, ".cline", "data", "settings", "cline_mcp_settings.json"),
      format: "json",
      key: "mcpServers",
      entry: (c) => ({ command: c.command, args: c.args, disabled: false, autoApprove: [] }),
    }),
    restart: "The Cline CLI starts the server with its next session.",
  },
];

/** The agents Protoboard knows how to configure. */
export const KNOWN_AGENTS: readonly { id: string; name: string; docs: string; scopes: AgentScope[] }[] = AGENTS.map((a) => ({ id: a.id, name: a.name, docs: a.docs, scopes: a.project ? ["user", "project"] : ["user"] }));

export type AgentStatus = "connected" | "outdated" | "not-connected" | "not-detected" | "unreadable";

export interface AgentState {
  id: string;
  name: string;
  scope: AgentScope;
  /** Installed here, as far as its folder or command shows. */
  detected: boolean;
  /** What showed it. */
  evidence?: string;
  /** The configuration file for this scope. */
  file: string;
  /** Connected: the entry setup would write is there. Outdated: an entry is there, with another command. */
  status: AgentStatus;
  /** The entry found. */
  entry?: ServerCommand;
  /** The name Protoboard's entry has, or gets: always `protoboard-stack` (MCP_SERVER_NAME). */
  serverName: string;
  /** An entry of this server under its name before 0.1.7 (`protoboard`): setup moves it to `serverName`. */
  legacyName?: string;
  /** Another server named `protoboard-stack` in this file that is not this one: what it is. It is left as it is, and nothing is written. */
  otherServer?: string;
  /** Another server named `protoboard` in this file (the alpha app's): what it is. It is never changed. */
  alphaServer?: string;
  /** Why the file could not be read as its format. */
  problem?: string;
  /** How a change is made: the file is edited, or the agent's own command runs. */
  method: "file" | "command";
  /** The command the user runs themselves to connect it, when Protoboard cannot make the change safely (Claude Code's command was not found). */
  manual?: string;
  docs: string;
  restart: string;
  note?: string;
}

export interface AgentQuery {
  scope?: AgentScope;
  /** The project folder, for `scope: "project"`. */
  projectDir?: string;
  /** The command setup would write; decides connected or outdated. */
  command: ServerCommand;
}

export class AgentConfigError extends Error {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = "AgentConfigError";
  }
}

function targetOf(def: AgentDef, h: AgentMachine, q: Pick<AgentQuery, "scope" | "projectDir">): Target {
  if ((q.scope ?? "user") === "user") return def.user(h);
  if (!def.project) throw new AgentConfigError(`${def.name} has no project configuration for MCP servers; use --scope user`);
  if (!q.projectDir) throw new AgentConfigError("a project-scope entry needs the project's folder");
  return def.project(h, q.projectDir);
}

const defOf = (id: string): AgentDef => {
  const def = AGENTS.find((a) => a.id === id);
  if (!def) throw new AgentConfigError(`no agent "${id}"; known: ${AGENTS.map((a) => a.id).join(", ")}`);
  return def;
};

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A configuration file's content as data; throws an AgentConfigError when it is not its format. */
function parseConfig(t: Target, given: string): Record<string, unknown> {
  // a byte-order mark (Windows editors write one) is not part of the JSON or TOML
  const text = given.replace(/^\uFEFF/, "");
  if (!text.trim()) return {};
  if (t.format === "toml") {
    try {
      return parseToml(text) as Record<string, unknown>;
    } catch (e) {
      throw new AgentConfigError(`${t.file} is not valid TOML (${(e as Error).message.split("\n")[0]}); it was left alone`, t.file);
    }
  }
  const errors: ParseError[] = [];
  const data = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new AgentConfigError(`${t.file} is not valid JSON (${printParseErrorCode(errors[0].error)} at character ${errors[0].offset}); it was left alone`, t.file);
  if (!isObject(data)) throw new AgentConfigError(`${t.file} does not hold a JSON object; it was left alone`, t.file);
  return data;
}

/** Whether an entry is this server's: its command is the launcher, or `protoboard mcp` through npx or a CLI. */
function isOurs(e: Record<string, unknown>): boolean {
  if (typeof e.command !== "string") return false;
  const words = [e.command, ...(Array.isArray(e.args) ? e.args.map(String) : [])];
  return words.some((w) => /(^|[\\/])protoboard-mcp(\.cmd|\.mjs)?$/i.test(w)) || (words.at(-1) === "mcp" && words.some((w) => /(^|[\\/])(protoboard|pb)(\.mjs|\.cmd)?$/i.test(w)));
}

/**
 * What a server entry that is not ours is, for a message: its host, or its
 * command's name. Never its path, query or arguments: a key can be in them,
 * and this text goes to a terminal, a log and the settings page.
 */
function describeEntry(e: Record<string, unknown>): string {
  if (typeof e.url === "string") {
    try {
      const u = new URL(e.url);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "a server at a URL";
    }
  }
  if (typeof e.command === "string" && e.command.trim()) return `the command ${e.command.trim().split(/[\\/]/).pop()!.split(/\s/)[0]}`;
  return "another server";
}

interface Found {
  /** The name Protoboard's entry has, or gets. */
  name: string;
  /** Protoboard's entry, when it is there under that name. */
  entry?: Record<string, unknown>;
  /** Protoboard's entry under the name it had before 0.1.7 (`protoboard`), to be moved. */
  legacy?: Record<string, unknown>;
  /** Another server named `protoboard` (the alpha app's): never touched. */
  alpha?: Record<string, unknown>;
}

/**
 * Protoboard's entry in a configuration, under its name or the one it had
 * before 0.1.7. A server named `protoboard-stack` that is not this one is
 * refused (nothing is written over it); a server named `protoboard` that is
 * not this one (the alpha app's) is reported and left alone.
 */
function entryIn(t: Target, data: Record<string, unknown>): Found {
  const servers = data[t.key];
  if (servers !== undefined && !isObject(servers)) throw new AgentConfigError(`"${t.key}" in ${t.file} is not an object; it was left alone`, t.file);
  const current = servers?.[MCP_SERVER_NAME];
  const legacy = servers?.[MCP_SERVER_LEGACY_NAME];
  if (current !== undefined && !(isObject(current) && isOurs(current)))
    throw new AgentConfigError(`${t.file} already has a server named ${MCP_SERVER_NAME} that is not this one (${isObject(current) ? describeEntry(current) : "not an object"}); it was left alone`, t.file);
  return {
    name: MCP_SERVER_NAME,
    ...(isObject(current) ? { entry: current } : {}),
    ...(isObject(legacy) && isOurs(legacy) ? { legacy } : legacy !== undefined ? { alpha: isObject(legacy) ? legacy : {} } : {}),
  };
}

const commandOf = (e: Record<string, unknown>): ServerCommand => ({ command: typeof e.command === "string" ? e.command : "", args: Array.isArray(e.args) ? e.args.map(String) : [] });
const sameCommand = (a: ServerCommand, b: ServerCommand) => a.command === b.command && a.args.length === b.args.length && a.args.every((x, i) => x === b.args[i]);

const quoteArg = (s: string) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, "\\$1")}"`);

/**
 * Claude Code's user configuration (`~/.claude.json`) is its live state: it
 * rewrites the file while it runs, so an edit from outside can be lost, or
 * lose a change of its own. It is changed only through `claude mcp add` and
 * `claude mcp remove`, never by editing the file.
 */
const viaCommand = (def: AgentDef, scope: AgentScope) => def.id === "claude-code" && scope === "user";

/**
 * Where `claude` is: on PATH, else where its installers put it. An editor
 * started from the Dock has almost no PATH, so the usual places are looked
 * at too (the native installer's ~/.local/bin was seen on Linux; the others
 * are Homebrew's and npm's defaults).
 */
function claudeCommand(h: AgentMachine): string | undefined {
  const P = paths(h);
  const exe = h.platform === "win32" ? "claude.exe" : "claude";
  const usual = [P.join(h.home, ".local", "bin", exe), P.join(h.home, ".claude", "local", exe), ...(h.platform === "win32" ? [] : ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", P.join(h.home, ".npm-global", "bin", "claude")])];
  const at = h.which("claude") ?? usual.find((c) => h.exists(c));
  // a .cmd shim (npm on Windows) cannot be started without a shell
  return at && !/\.cmd$/i.test(at) ? at : undefined;
}

/** What the user runs when Protoboard cannot run Claude Code's command itself. */
const claudeLine = (verb: "add" | "remove", name: string, c?: ServerCommand) => ["claude", "mcp", verb, "--scope", "user", name, ...(c ? ["--", c.command, ...c.args] : [])].map(quoteArg).join(" ");
const noClaude = (line: string, file: string) =>
  new AgentConfigError(`Claude Code's \`claude\` command was not found from here, and its configuration (${file}) is not edited directly: Claude Code rewrites that file while it runs. Run this in a terminal instead: ${line}`, file);

/** One agent's state. Reads only. */
export function agentState(id: string, q: AgentQuery, host: AgentMachine = agentMachine()): AgentState {
  const def = defOf(id);
  const scope = q.scope ?? "user";
  const t = targetOf(def, host, q);
  const evidence = def.detect(host);
  const base = { id: def.id, name: def.name, scope, detected: !!evidence, ...(evidence ? { evidence } : {}), file: t.file, method: viaCommand(def, scope) ? ("command" as const) : ("file" as const), docs: def.docs, restart: def.restart, ...(def.note ? { note: def.note } : {}) };
  const text = readText(t.file);
  let found: Found;
  try {
    found = entryIn(t, text === undefined ? {} : parseConfig(t, text));
  } catch (e) {
    const servers = (() => {
      try {
        return text === undefined ? undefined : parseConfig(t, text)[t.key];
      } catch {
        return undefined;
      }
    })();
    const other = isObject(servers) && isObject(servers[MCP_SERVER_NAME]) ? describeEntry(servers[MCP_SERVER_NAME] as Record<string, unknown>) : undefined;
    return { ...base, serverName: MCP_SERVER_NAME, status: "unreadable", problem: (e as Error).message, ...(other ? { otherServer: other } : {}) };
  }
  const wanted = t.entry(q.command) as unknown as ServerCommand;
  const connected = !!found.entry && !found.legacy && sameCommand(commandOf(found.entry), wanted);
  const named = {
    ...base,
    serverName: found.name,
    ...(found.legacy ? { legacyName: MCP_SERVER_LEGACY_NAME } : {}),
    ...(found.alpha ? { alphaServer: describeEntry(found.alpha) } : {}),
    ...(viaCommand(def, scope) && !claudeCommand(host) && !connected ? { manual: claudeLine("add", found.name, q.command) } : {}),
  };
  const entry = found.entry ?? found.legacy;
  if (!entry) return { ...named, status: evidence || scope === "project" ? "not-connected" : "not-detected" };
  return { ...named, status: connected ? "connected" : "outdated", entry: commandOf(entry) };
}

/** Every known agent's state (at project scope: the ones that have a project file). */
export function listAgents(q: AgentQuery, host: AgentMachine = agentMachine()): AgentState[] {
  return AGENTS.filter((a) => (q.scope ?? "user") === "user" || a.project).map((a) => agentState(a.id, q, host));
}

export interface AgentChange {
  id: string;
  name: string;
  scope: AgentScope;
  file: string;
  action: "added" | "updated" | "unchanged" | "removed" | "absent";
  method: "file" | "command";
  /** The copy made before the first write to this file. */
  backup?: string;
  /** The file did not exist before. */
  created?: boolean;
  entry?: ServerCommand;
  /** The name the entry has in the file. */
  serverName: string;
  /** The name this server's entry had before, when it was moved (`protoboard`, before 0.1.7). */
  movedFrom?: string;
  restart: string;
  /** What the user should know about what was written: an entry or a copy in a shared project that is this machine's only. */
  warnings?: string[];
}

const eolOf = (text: string) => (/\r\n/.test(text) ? "\r\n" : "\n");

/** The file's indentation unit: a tab, or the width of its first indented line (two spaces when it has none). */
function indentOf(text: string): string {
  const m = /^([ \t]+)\S/m.exec(text);
  return !m ? "  " : m[1].startsWith("\t") ? "\t" : m[1];
}

interface JsonEdit {
  offset: number;
  length: number;
  text: string;
}

const applyAll = (text: string, edits: JsonEdit[]): string => [...edits].sort((x, y) => y.offset - x.offset).reduce((t, e) => t.slice(0, e.offset) + e.text + t.slice(e.offset + e.length), text);

/** The whitespace a line starts with, for the line holding `offset`. */
function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, offset))![0];
}

const propertyOf = (object: JsonNode, key: string): JsonNode | undefined => object.children?.find((p) => p.children?.[0]?.value === key);

/** The last token inside an object that is not a comment or space, before its closing brace: a comma when it has a trailing one. */
function lastTokenIn(text: string, object: JsonNode): { comma: boolean; end: number } {
  const scan = createScanner(text, true);
  scan.setPosition(object.offset + 1);
  const close = object.offset + object.length - 1;
  let last = { comma: false, end: object.offset + 1 };
  let depth = 0;
  for (let kind = scan.scan(); kind !== 17 /* EOF */ && scan.getTokenOffset() < close; kind = scan.scan()) {
    if (kind === 1 /* { */ || kind === 3 /* [ */) depth++;
    else if (kind === 2 /* } */ || kind === 4 /* ] */) depth--;
    last = { comma: kind === 5 /* , */ && depth === 0, end: scan.getTokenOffset() + scan.getTokenLength() };
  }
  return last;
}

/**
 * Write one value as JSON the way the text around it is written: on one line
 * where the object it goes into is on one line (spaced as that object is),
 * else over several lines at the file's indentation.
 */
function jsonText(value: unknown, style: { oneLine: boolean; spaced: boolean; unit: string; indent: string; eol: string }): string {
  if (!style.oneLine) return JSON.stringify(value, null, style.unit).replace(/\n/g, style.eol + style.indent);
  if (!style.spaced) return JSON.stringify(value);
  const one = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(one).join(", ")}]` : isObject(v) ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${one(x)}`).join(", ")} }` : "{}") : JSON.stringify(v);
  return one(value);
}

/** The edits that add a property to an object, or replace its value, touching no other character of the text. */
function setProperty(text: string, object: JsonNode, key: string, value: unknown, unit: string, eol: string): JsonEdit[] {
  const whole = text.slice(object.offset, object.offset + object.length);
  const lines = /\n/.test(text.trim());
  const existing = propertyOf(object, key);
  if (existing?.children?.[1]) {
    const v = existing.children[1];
    // an entry written on one line stays on one line
    const was = text.slice(v.offset, v.offset + v.length);
    return [{ offset: v.offset, length: v.length, text: jsonText(value, { oneLine: !/\n/.test(was), spaced: /: |, |\{ /.test(was), unit, indent: lineIndent(text, existing.offset), eol }) }];
  }
  const props = object.children ?? [];
  if (!props.length) {
    // an empty object: opened over lines in a file that has lines, kept on one line in a file that is one line
    if (whole.replace(/\s/g, "") !== "{}") throw new AgentConfigError("an empty object holding only comments is not edited");
    if (!lines) return [{ offset: object.offset, length: object.length, text: `{${JSON.stringify(key)}:${jsonText(value, { oneLine: true, spaced: false, unit, indent: "", eol })}}` }];
    const outer = lineIndent(text, object.offset);
    return [{ offset: object.offset, length: object.length, text: `{${eol}${outer}${unit}${JSON.stringify(key)}: ${jsonText(value, { oneLine: false, spaced: true, unit, indent: outer + unit, eol })}${eol}${outer}}` }];
  }
  const last = props[props.length - 1];
  const lastEnd = last.offset + last.length;
  const tail = lastTokenIn(text, object);
  if (!/\n/.test(whole)) {
    // an object on one line stays on one line
    const spaced = /: |, /.test(whole);
    const prop = `${JSON.stringify(key)}:${spaced ? " " : ""}${jsonText(value, { oneLine: true, spaced, unit, indent: "", eol })}`;
    return tail.comma ? [{ offset: tail.end, length: 0, text: `${spaced ? " " : ""}${prop},` }] : [{ offset: lastEnd, length: 0, text: `,${spaced ? " " : ""}${prop}` }];
  }
  // one property to a line: the new one goes on a line of its own after the last, indented as the last is
  const indent = lineIndent(text, last.offset);
  const close = object.offset + object.length - 1;
  const eolAt = text.indexOf("\n", tail.end);
  // after whatever ends the last property's line (a comment), when the closing brace is not on that line too
  const at = eolAt !== -1 && eolAt < close ? (text[eolAt - 1] === "\r" ? eolAt - 1 : eolAt) : tail.end;
  const prop = `${eol}${indent}${JSON.stringify(key)}: ${jsonText(value, { oneLine: false, spaced: true, unit, indent, eol })}`;
  if (tail.comma) return [{ offset: at, length: 0, text: `${prop},` }];
  return at === lastEnd ? [{ offset: at, length: 0, text: `,${prop}` }] : [{ offset: lastEnd, length: 0, text: "," }, { offset: at, length: 0, text: prop }];
}

/** Where the comma is between two places of an object that hold nothing else but space and comments; -1 when there is none. */
function commaIn(text: string, from: number, to: number): number {
  const scan = createScanner(text, true);
  scan.setPosition(from);
  return scan.scan() === 5 /* , */ && scan.getTokenOffset() < to ? scan.getTokenOffset() : -1;
}

/** The edits that take a property out of an object: the property, its comma and its own line, and nothing else. */
function removeProperty(text: string, object: JsonNode, key: string): JsonEdit[] {
  const props = object.children ?? [];
  const i = props.findIndex((p) => p.children?.[0]?.value === key);
  if (i === -1) return [];
  const prop = props[i];
  let start = prop.offset;
  let end = prop.offset + prop.length;
  // the only property: the object is empty again
  if (props.length === 1 && text.slice(object.offset + 1, start).trim() === "" && text.slice(end, object.offset + object.length - 1).replace(/,/, "").trim() === "") {
    return [{ offset: object.offset, length: object.length, text: "{}" }];
  }
  const edits: JsonEdit[] = [];
  const next = commaIn(text, end, object.offset + object.length - 1);
  const absorbed = next !== -1 && /^[ \t]*$/.test(text.slice(end, next));
  if (absorbed) end = next + 1;
  else if (next !== -1) edits.push({ offset: next, length: 1, text: "" });
  else if (i > 0) {
    // the last property, with no comma after it: the comma before it goes
    const prev = commaIn(text, props[i - 1].offset + props[i - 1].length, start);
    if (prev !== -1 && text.slice(prev + 1, start).trim() === "") return [{ offset: prev, length: end - prev, text: "" }];
    if (prev !== -1) edits.push({ offset: prev, length: 1, text: "" });
  }
  // a property on a line of its own takes the line with it
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const rest = /^[ \t]*(\r?\n)?/.exec(text.slice(end))![0];
  if (text.slice(lineStart, start).trim() === "" && /\n$/.test(rest)) {
    start = lineStart;
    end += rest.length;
  } else if (absorbed) end += /^[ \t]*/.exec(text.slice(end))![0].length;
  return [...edits, { offset: start, length: end - start, text: "" }];
}

/**
 * A JSON configuration with one server's entry set or taken out. Only the
 * characters of that entry change: the neighbours keep their lines, their
 * spacing and their comments, and a file written on one line stays on one.
 */
function editJson(t: Target, name: string, text: string, value: Record<string, unknown> | undefined): string {
  if (!text.trim()) return value ? JSON.stringify({ [t.key]: { [name]: value } }, null, 2) + "\n" : text;
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root || root.type !== "object") throw new AgentConfigError(`${t.file} does not hold a JSON object; it was left alone`, t.file);
  const unit = indentOf(text);
  const eol = eolOf(text);
  const servers = propertyOf(root, t.key)?.children?.[1];
  try {
    if (!value) return servers?.type === "object" ? applyAll(text, removeProperty(text, servers, name)) : text;
    if (servers?.type === "object") return applyAll(text, setProperty(text, servers, name, value, unit, eol));
    if (!servers) return applyAll(text, setProperty(text, root, t.key, { [name]: value }, unit, eol));
  } catch (e) {
    if (!(e instanceof AgentConfigError)) throw e;
  }
  // a shape the careful edit does not cover (an object holding only comments): the general editor, which may re-indent around the entry
  const tab = unit === "\t";
  return applyEdits(text, modify(text, [t.key, name], value, { formattingOptions: { insertSpaces: !tab, tabSize: tab ? 1 : unit.length, eol } }));
}

const tomlHeader = (name: string) => new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${name}"|'${name}'|${name})\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`);

/**
 * Where a server's tables are in a TOML text, as line ranges: each from a
 * `[mcp_servers.<name>]` header (or a sub-table's) to its last line that
 * holds something of the table. The blank lines and comments after that line
 * are not the table's: they stay where they are, whatever is done with it.
 */
function tomlBlocks(lines: string[], name: string): [number, number][] {
  const header = tomlHeader(name);
  const blocks: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i])) continue;
    let end = i + 1;
    let j = i + 1;
    for (; j < lines.length && !/^\s*\[/.test(lines[j]); j++) if (lines[j].trim() && !/^\s*#/.test(lines[j])) end = j + 1;
    blocks.push([i, end]);
    i = j - 1;
  }
  return blocks;
}

/** Take a range of lines out, with the blank lines before it when that would leave two runs of them (or a file starting or ending with one). */
function cutLines(lines: string[], [start, end]: [number, number]): void {
  let from = start;
  if (end >= lines.length || !lines[end].trim() || start === 0) while (from > 0 && !lines[from - 1].trim()) from--;
  lines.splice(from, end - from);
  // the file began with the table: what follows starts the file
  if (from === 0) while (lines.length > 1 && !lines[0].trim()) lines.shift();
}

const tomlKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
const tomlValue = (v: unknown): string => (Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : String(v));

/** A table as TOML lines: its plain values, then each nested object as a sub-table. */
function tomlTable(path: string, value: Record<string, unknown>): string[] {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null);
  return [
    `[${path}]`,
    ...entries.filter(([, v]) => !isObject(v)).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`),
    ...entries.filter(([, v]) => isObject(v)).flatMap(([k, v]) => ["", ...tomlTable(`${path}.${tomlKey(k)}`, v as Record<string, unknown>)]),
  ];
}

/**
 * A TOML configuration with one server's table set or taken out. The table
 * stays where it is; a comment or a blank line after it is not touched; where
 * only the command changes, only the `command` and `args` lines do.
 */
function editToml(t: Target, name: string, text: string, value: Record<string, unknown> | undefined): string {
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  const blocks = tomlBlocks(lines, name);
  const table = value ? tomlTable(`${t.key}.${name}`, value) : [];
  if (value && !blocks.length) {
    const head = text.trim() ? text.replace(/(\r?\n)*$/, "") + eol + eol : "";
    return head + table.join(eol) + eol;
  }
  if (value && blocks.length) {
    // the usual update: the two lines that name the command, in place, when each is one line of the table itself
    const [start, end] = blocks[0];
    const at = (key: string) => {
      const found = lines.slice(start + 1, end).flatMap((l, i) => (new RegExp(`^\\s*${key}\\s*=`).test(l) ? [start + 1 + i] : []));
      return found.length === 1 ? found[0] : -1;
    };
    const [c, a] = [at("command"), at("args")];
    if (c !== -1 && a !== -1) {
      const kept = [...lines];
      const line = (i: number, key: string) => `${/^\s*/.exec(kept[i])![0]}${key} = ${tomlValue(value[key])}`;
      kept[c] = line(c, "command");
      kept[a] = line(a, "args");
      const candidate = kept.join(eol);
      try {
        const servers = (parseToml(candidate) as Record<string, unknown>)[t.key];
        if (isObject(servers) && stable(servers[name]) === stable(value)) return candidate;
      } catch {
        // a value over several lines: the whole table is written again
      }
    }
  }
  // sub-tables and repeats go; the first table's place takes the new one
  for (const block of blocks.slice(value ? 1 : 0).reverse()) cutLines(lines, block);
  if (value) lines.splice(blocks[0][0], blocks[0][1] - blocks[0][0], ...table);
  return lines.join(eol);
}

/**
 * A server's entry renamed where it is: its key in JSON, its table headers
 * (and its sub-tables') in TOML; nothing else in the text changes.
 */
function renameEntry(t: Target, text: string, from: string, to: string): string {
  if (t.format === "toml") {
    const header = tomlHeader(from);
    return text
      .split(/(?<=\n)/)
      .map((line) => (header.test(line.replace(/\r?\n$/, "")) ? line.replace(new RegExp(`(\\[\\s*${t.key}\\s*\\.\\s*)(?:"${from}"|'${from}'|${from})`), `$1${tomlKey(to)}`) : line))
      .join("");
  }
  const root = parseTree(text, [], { allowTrailingComma: true });
  const servers = root && propertyOf(root, t.key)?.children?.[1];
  const key = servers && propertyOf(servers, from)?.children?.[0];
  return key ? text.slice(0, key.offset) + JSON.stringify(to) + text.slice(key.offset + key.length) : text;
}

/** The data without Protoboard's entries (and without the servers object when that leaves it empty and it was not there before). */
function without(t: Target, names: string[], data: Record<string, unknown>): unknown {
  const copy = structuredClone(data);
  const servers = copy[t.key];
  if (isObject(servers)) {
    for (const name of names) delete servers[name];
    if (!Object.keys(servers).length) delete copy[t.key];
  }
  return copy;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : typeof x === "bigint" ? `${x}n` : x));

/** Replace a file's text: a copy first when it is the first write, then a temporary file renamed over it. */
function writeConfig(file: string, text: string): { backup?: string; created?: boolean } {
  let real = file;
  let mode: number | undefined;
  const existed = existsSync(file);
  if (existed) {
    // a link (a dotfiles folder) keeps being a link: its target is replaced
    real = realpathSync(file);
    mode = statSync(real).mode & 0o777;
  } else mkdirSync(dirname(file), { recursive: true });
  const backup = `${file}.protoboard-backup`;
  let made: string | undefined;
  if (existed && !existsSync(backup)) {
    copyFileSync(real, backup);
    made = backup;
  }
  const tmp = `${real}.protoboard-tmp-${process.pid}`;
  writeFileSync(tmp, text, mode !== undefined ? { mode } : {});
  renameSync(tmp, real);
  return { ...(made ? { backup: made } : {}), ...(existed ? {} : { created: true }) };
}

function change(def: AgentDef, t: Target, value: Record<string, unknown> | undefined): { action: AgentChange["action"]; serverName: string; backup?: string; created?: boolean; movedFrom?: string } {
  const raw = readText(t.file) ?? "";
  // a byte-order mark stays at the start of the file; the edit works on what follows it
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = raw.slice(bom.length);
  const before = parseConfig(t, text);
  const found = entryIn(t, before);
  const name = found.name;
  const had = found.entry ?? found.legacy;
  if (!value && !had) return { action: "absent", serverName: name };
  if (value && had) {
    // the same command under the current name: nothing to do. Another command, or the name before 0.1.7: only the
    // command and the name change; what the user set beside it (approved tools, env) stays
    if (!found.legacy && sameCommand(commandOf(had), commandOf(value))) return { action: "unchanged", serverName: name };
    value = { ...(found.entry ?? found.legacy), command: value.command, args: value.args };
  }
  const edit = (x: string, key: string, v: Record<string, unknown> | undefined) => (t.format === "toml" ? editToml(t, key, x, v) : editJson(t, key, x, v));
  // the entry under the earlier name (only ever this server's: entryIn checked) is renamed where it is when it is the only
  // one, else it goes; then the entry is written under its name
  let next = text;
  if (found.legacy) next = value && !found.entry ? renameEntry(t, next, MCP_SERVER_LEGACY_NAME, name) : edit(next, MCP_SERVER_LEGACY_NAME, undefined);
  next = value || found.entry ? edit(next, name, value) : next;
  // nothing but Protoboard's entries may differ, and the entry must be the one meant
  let after: Record<string, unknown>;
  try {
    after = parseConfig(t, next);
  } catch {
    throw new AgentConfigError(`${t.file} could not be edited safely (the result would not parse); it was left alone`, t.file);
  }
  const ours = [name, ...(found.legacy ? [MCP_SERVER_LEGACY_NAME] : [])];
  const servers = after[t.key];
  const now = isObject(servers) && isObject(servers[name]) ? (servers[name] as Record<string, unknown>) : undefined;
  const legacyLeft = found.legacy && isObject(servers) && servers[MCP_SERVER_LEGACY_NAME] !== undefined;
  if (stable(without(t, ours, after)) !== stable(without(t, ours, before)) || legacyLeft || (value ? !now || stable(now) !== stable(value) : !!now)) {
    throw new AgentConfigError(`${t.file} could not be edited without changing something else in it; it was left alone. ${def.name}'s documentation: ${def.docs}`, t.file);
  }
  return { action: value ? (had ? "updated" : "added") : "removed", serverName: name, ...(found.legacy ? { movedFrom: MCP_SERVER_LEGACY_NAME } : {}), ...writeConfig(t.file, bom + next) };
}

/**
 * Add Protoboard's server to one agent's configuration, or bring an older
 * entry up to date. The caller has the user's yes for this agent.
 */
export function setupAgent(id: string, q: AgentQuery, host: AgentMachine = agentMachine()): AgentChange {
  const def = defOf(id);
  const scope = q.scope ?? "user";
  const t = targetOf(def, host, q);
  const base = { id: def.id, name: def.name, scope, file: t.file, restart: def.restart, entry: q.command };
  if (viaCommand(def, scope)) {
    const state = agentState(id, q, host);
    const named = { ...base, serverName: state.serverName };
    if (state.status === "connected") return { ...named, action: "unchanged", method: "command" };
    if (state.status === "unreadable") throw new AgentConfigError(state.problem!, t.file);
    const claude = claudeCommand(host);
    if (!claude) throw noClaude([...(state.legacyName ? [claudeLine("remove", state.legacyName)] : []), claudeLine("add", state.serverName, q.command)].join(" && "), t.file);
    // only this server's own entries are replaced (under its name, or the one it had before 0.1.7); another server's never
    const text = readText(t.file);
    const found = text === undefined ? undefined : entryIn(t, parseConfig(t, text));
    if (found?.legacy) host.run(claude, ["mcp", "remove", "--scope", "user", MCP_SERVER_LEGACY_NAME]);
    if (found?.entry) host.run(claude, ["mcp", "remove", "--scope", "user", state.serverName]);
    const r = host.run(claude, ["mcp", "add", "--scope", "user", state.serverName, "--", q.command.command, ...q.command.args]);
    if (r.status !== 0) throw new AgentConfigError(`\`claude mcp add\` failed${r.status === null ? "" : ` (exit ${r.status})`}: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`, t.file);
    return { ...named, action: state.status === "outdated" ? "updated" : "added", method: "command", ...(state.legacyName ? { movedFrom: state.legacyName } : {}) };
  }
  const done = change(def, t, t.entry(q.command));
  return { ...base, method: "file", ...done, ...projectWarnings(scope, t.file, done, q.command) };
}

/**
 * What a write in a project leaves that is this machine's only. A project's
 * file is shared (committed): an entry that starts this machine's launcher
 * does nothing for a teammate, and the copy made before the first write is
 * not for committing.
 */
function projectWarnings(scope: AgentScope, file: string, done: { action: AgentChange["action"]; backup?: string }, command?: ServerCommand): { warnings?: string[] } {
  if (scope !== "project") return {};
  const warnings: string[] = [];
  if (command && (done.action === "added" || done.action === "updated") && !sameCommand(command, PORTABLE_COMMAND)) {
    warnings.push(`This entry starts this machine's launcher (${command.command === "cmd" ? command.args.at(-1) : command.command}), so it works on this machine only: do not commit ${file} as it is. For an entry the whole team can use, add @protoboardai/cli to the project's package.json (a Protoboard project has it) and run setup again, or pass --portable.`);
  }
  if (done.backup) warnings.push(`${done.backup} is the file as it was before this change. It is this machine's: do not commit it (add *.protoboard-backup to .gitignore), and delete it when you no longer want it.`);
  return warnings.length ? { warnings } : {};
}

/** Remove Protoboard's server from one agent's configuration (under its name and the one it had before 0.1.7). Everything else in the file stays, another server named `protoboard` (the alpha app's) included. */
export function removeAgent(id: string, q: Omit<AgentQuery, "command">, host: AgentMachine = agentMachine()): AgentChange {
  const def = defOf(id);
  const scope = q.scope ?? "user";
  const t = targetOf(def, host, q);
  const base = { id: def.id, name: def.name, scope, file: t.file, restart: def.restart };
  if (viaCommand(def, scope)) {
    const text = readText(t.file);
    const found: Found = text === undefined ? { name: MCP_SERVER_NAME } : entryIn(t, parseConfig(t, text));
    const names = [...(found.entry ? [found.name] : []), ...(found.legacy ? [MCP_SERVER_LEGACY_NAME] : [])];
    if (!names.length) return { ...base, serverName: found.name, action: "absent", method: "command" };
    const claude = claudeCommand(host);
    if (!claude) throw noClaude(names.map((n) => claudeLine("remove", n)).join(" && "), t.file);
    for (const n of names) {
      const r = host.run(claude, ["mcp", "remove", "--scope", "user", n]);
      if (r.status !== 0) throw new AgentConfigError(`\`claude mcp remove\` failed${r.status === null ? "" : ` (exit ${r.status})`}: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`, t.file);
    }
    return { ...base, serverName: found.name, action: "removed", method: "command" };
  }
  const done = change(def, t, undefined);
  return { ...base, method: "file", ...done, ...projectWarnings(scope, t.file, done) };
}

export interface OtherClientConfig {
  /** The name the server gets in the client. */
  name: string;
  /** The entry on its own. */
  command: ServerCommand;
  /** For a client that reads `mcpServers` (most do). */
  json: string;
  /** For VS Code's mcp.json. */
  vscodeJson: string;
  /** For a TOML configuration (Codex). */
  toml: string;
  /** One line for a terminal. */
  commandLine: string;
  /** Claude Code's own command that adds it, for the user to run. */
  claudeLine: string;
  steps: string[];
}


/** The name to give this server in a client set up by hand: always `protoboard-stack` since 0.1.7 (the argument is for callers of 0.1.6). */
export const otherClientName = (_agents: readonly Pick<AgentState, "serverName" | "otherServer">[] = []): string => MCP_SERVER_NAME;

/** The configuration for an MCP client Protoboard does not set up itself. */
export function otherClientConfig(command: ServerCommand, name: string = MCP_SERVER_NAME): OtherClientConfig {
  return {
    name,
    command,
    json: JSON.stringify({ mcpServers: { [name]: plain(command) } }, null, 2),
    vscodeJson: JSON.stringify({ servers: { [name]: stdio(command) } }, null, 2),
    toml: [`[mcp_servers.${name}]`, `command = ${JSON.stringify(command.command)}`, `args = [${command.args.map((a) => JSON.stringify(a)).join(", ")}]`].join("\n"),
    commandLine: [command.command, ...command.args].map(quoteArg).join(" "),
    claudeLine: claudeLine("add", name, command),
    steps: [
      `Add a local (stdio) MCP server named ${name} with the command below; keep the client's other servers. Leave one named ${MCP_SERVER_LEGACY_NAME} unless its command ends in \`protoboard mcp\` or protoboard-mcp.`,
      "No arguments, environment variables or key.",
      "Restart the client or start a new session.",
    ],
  };
}

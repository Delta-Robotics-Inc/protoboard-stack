/**
 * Agents and Protoboard's MCP server, for the settings page and the first-run
 * offer (PB-930, docs/specs/agents-and-mcp.md §6). The detection and the
 * edits are @protoboardai/core's (the same code `protoboard agents` runs);
 * this file turns them into the page's model and decides when to offer.
 *
 * No VS Code API here: the unit tests run it directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KNOWN_AGENTS, MCP_SERVER_NAME, otherClientConfig, otherClientName, type AgentChange, type AgentState } from "@protoboardai/core/agents";
import { cliOriginOf, installLauncher, launcherCommand, type CliOrigin, type LauncherPlace, type LauncherState, type ServerCommand } from "@protoboardai/core/agent-launcher";
import type { AccountModel, AgentRowModel, OtherClientsModel, SettingsLinkModel, SettingsModel } from "@protoboardai/views/parts-model";
import { resolveCli, type CliCommand, type CliSettings } from "./cli.js";

/**
 * The CLI for commands that belong to the machine, not to one project: the
 * agents' launcher records it, and the settings page says which it is.
 *
 * THE SEAM WITH PB-929 (the extension carries the CLI): this is the one
 * function that names the machine's CLI. It is what `resolveCli` finds from
 * `folder` (the current project, else the first workspace folder, else the
 * home folder). Before PB-929 that is the project's CLI, else `protoboard` on
 * PATH. With PB-929, `resolveCli` ends at the stack the extension carries
 * (`from: "carried"`, or `"store"` for a copy it keeps): those are recorded
 * for the launcher as the extension's, which the launcher prefers. So the
 * only change PB-929 needs here is to pass its settings (`carried`, `stacks`,
 * `runtime`) through `settings`.
 */
export function machineCli(folder: string, settings: CliSettings = {}, exists: (p: string) => boolean = existsSync): { cli: CliCommand; origin?: CliOrigin } {
  const cli = resolveCli(folder, settings, exists);
  const entry = cliEntry(cli);
  const from = cli.from as string;
  return { cli, ...(entry ? { origin: from === "carried" || from === "store" ? "extension" : cliOriginOf(entry, exists) } : {}) };
}

/**
 * The CLI to record again for a launcher that is already there, when the
 * extension starts: the one that stays put (the carried stack, or one
 * installed for the machine), whatever folder the window has open. A
 * project's own CLI is never recorded unasked, so where the open folder
 * resolves to one, the CLI is resolved again from `elsewhere` (the home
 * folder), which is where the carried stack is found. Without this, a user
 * with only the extension keeps the stack copy recorded before an update
 * until they press Connect again.
 */
export function cliToRecord<S extends CliSettings>(folder: string, elsewhere: string, settingsFor: (folder: string) => S, exists: (p: string) => boolean = existsSync): { entry: string; origin: CliOrigin; settings: S } | undefined {
  for (const from of folder === elsewhere ? [folder] : [folder, elsewhere]) {
    const settings = settingsFor(from);
    const found = machineCli(from, settings, exists);
    const entry = cliEntry(found.cli);
    if (entry && exists(entry) && found.origin !== "project") return { entry, origin: found.origin ?? "npm", settings };
  }
  return undefined;
}

/** The CLI's entry script, when it is one (a `protoboard` command on PATH has none to record). */
export function cliEntry(cli: CliCommand): string | undefined {
  const file = cli.args[0] ?? (/\.(mjs|cjs|js)$/.test(cli.command) ? cli.command : undefined);
  return file && /\.(mjs|cjs|js)$/.test(file) ? file : undefined;
}

/** The version of the CLI an entry script belongs to (its package.json, two folders up from bin/). */
export function cliVersion(entry: string): string {
  try {
    return String((JSON.parse(readFileSync(join(dirname(dirname(entry)), "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

/**
 * Write the launcher and record the CLI, in process: for a CLI that is a
 * script. `node` is the Node.js the extension runs the CLI with (never the
 * editor's own executable).
 */
export function recordCli(entry: string, origin: CliOrigin, node: string | undefined, place: LauncherPlace = {}, electron = false): LauncherState {
  return installLauncher({ ...place, cli: { entry, version: cliVersion(entry), from: origin }, node: node ?? "node", electron: electron && !!node });
}

export { launcherCommand, type ServerCommand };

const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

/** What a change did, as the row's second line. */
export function changeText(c: AgentChange, home: string): string {
  const file = tilde(c.file, home);
  const as = c.serverName !== MCP_SERVER_NAME ? ` as ${c.serverName}` : "";
  switch (c.action) {
    case "added":
      return `Added${as} to ${file}. ${c.restart}`;
    case "updated":
      return `Updated in ${file}. ${c.restart}`;
    case "unchanged":
      return `Already connected in ${file}.`;
    case "removed":
      return `Removed from ${file}.`;
    default:
      return `Protoboard was not configured in ${file}.`;
  }
}

/** The agents as the page's rows: the ones found here, and the names of the ones that were not. */
export function agentRows(states: AgentState[], home: string, notes: Record<string, { text: string; tone: NonNullable<AgentRowModel["detailTone"]> }> = {}, working: ReadonlySet<string> = new Set()): { rows: AgentRowModel[]; notFound: string[] } {
  const rows = states
    .filter((a) => a.status !== "not-detected")
    .map((a): AgentRowModel => {
      const note = notes[a.id];
      const detail =
        // (a note from a change just made comes first)
        note?.text ??
        (a.status === "unreadable"
          ? a.problem
          : a.status === "outdated"
            ? "Out of date: Update to use the current launcher."
            : a.manual
              ? `Run in a terminal: ${a.manual}`
              : // the alpha app's server, named protoboard (core 0.1.7 reports it as alphaServer; PB-1018)
                a.alphaServer
                ? `Also has an older server named protoboard (${a.alphaServer}); this one is ${a.serverName}.`
                : undefined);
      return {
        id: a.id,
        name: a.name,
        status: a.status as AgentRowModel["status"],
        file: tilde(a.file, home),
        ...(detail ? { detail, detailTone: note?.tone ?? (a.status === "unreadable" ? "error" : a.status === "outdated" ? "warning" : "neutral") } : {}),
        ...(working.has(a.id) ? { working: true } : {}),
        ...(a.manual && !note ? { manual: a.manual } : {}),
      };
    });
  return { rows, notFound: states.filter((a) => a.status === "not-detected").map((a) => a.name) };
}

/** The entry for any other MCP client, in the forms the page offers. */
export function otherClients(command: ServerCommand, name: string = MCP_SERVER_NAME): OtherClientsModel {
  const c = otherClientConfig(command, name);
  return {
    steps: c.steps,
    forms: [
      { id: "json", label: "JSON", text: c.json },
      { id: "vscode", label: "VS Code mcp.json", text: c.vscodeJson },
      { id: "toml", label: "TOML", text: c.toml },
      { id: "command", label: "Command", text: c.commandLine },
      { id: "claude", label: "Claude Code", text: c.claudeLine },
    ],
  };
}

export interface SettingsInput {
  account: AccountModel;
  version: string;
  cli?: { command: CliCommand; origin?: CliOrigin };
  cliProblem?: string;
  agents?: AgentState[];
  agentsProblem?: string;
  command: ServerCommand;
  home: string;
  notes?: Record<string, { text: string; tone: NonNullable<AgentRowModel["detailTone"]> }>;
  working?: ReadonlySet<string>;
  links?: SettingsLinkModel[];
}

const ORIGIN: Record<string, string> = { setting: "from the protoboard.cliPath setting", project: "the project's own", path: "found on PATH", none: "not found", carried: "carried by the extension", store: "a stack copy the extension keeps", extension: "carried by the extension", npm: "installed on this machine" };

export function settingsModel(i: SettingsInput): SettingsModel {
  const cli = i.cli?.command;
  const listed = i.agents ? agentRows(i.agents, i.home, i.notes, i.working) : { rows: [], notFound: [] };
  return {
    account: i.account,
    about: {
      version: i.version,
      ...(cli ? { cli: cliEntry(cli) ? tilde(cliEntry(cli)!, i.home) : cli.command, cliFrom: ORIGIN[cli.from as string] ?? String(cli.from) } : {}),
      ...(i.cliProblem ? { problem: i.cliProblem } : {}),
    },
    agents: { state: i.agents ? "ready" : i.agentsProblem ? "failed" : "loading", ...listed, ...(i.agentsProblem ? { problem: i.agentsProblem } : {}) },
    // named as the rows name it: beside another server called protoboard (the alpha app's), this one has the other name
    other: otherClients(i.command, otherClientName(i.agents)),
    ...(i.links?.length ? { links: i.links } : {}),
  };
}

/** The agents the first-run offer is about: found here, readable, and not connected yet. */
export const offerable = (states: AgentState[]): AgentState[] => states.filter((a) => a.detected && (a.status === "not-connected" || a.status === "outdated"));

export interface OfferFacts {
  /** `protoboard.agents.offerSetup`. */
  enabled: boolean;
  /** The offer was shown before (any answer, or none). */
  offered: boolean;
  /** A Protoboard project is open, or the user has just signed in. */
  occasion: boolean;
  agents: AgentState[];
}

/** Whether to show the offer now: once, on an occasion, when there is an agent to connect. */
export const shouldOffer = (f: OfferFacts): boolean => f.enabled && !f.offered && f.occasion && offerable(f.agents).length > 0;

/** The offer's sentence. */
export function offerText(agents: AgentState[]): string {
  const names = offerable(agents).map((a) => a.name.replace(/ \(.*\)$/, ""));
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `Protoboard: connect ${list}? This adds Protoboard's MCP server to each one's configuration.`;
}

export { KNOWN_AGENTS };

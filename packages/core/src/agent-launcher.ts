/**
 * The launcher an agent's MCP configuration points at (PB-930,
 * docs/specs/agents-and-mcp.md §3). It lives in Protoboard's per-user folder,
 * which does not move when the extension updates, when Node moves or when a
 * project brings its own CLI: a small script that finds Node, then the CLI
 * recorded here, and runs `<cli> mcp`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ensurePrivateDir } from "./private-dir.js";
import { dirname, join, posix, win32 } from "node:path";
import { configDir } from "./account.js";

export const LAUNCHER_SCHEMA = "protoboard.launcher/v1";

/** Where a recorded CLI came from: the VS Code extension carries it, npm installed it for the machine, or it is a project's own. */
export type CliOrigin = "extension" | "npm" | "project";

export interface RecordedCli {
  /** The CLI's entry script (`…/@protoboardai/cli/bin/protoboard.mjs`). */
  entry: string;
  version: string;
  from: CliOrigin;
  recordedAt: string;
}

export interface LauncherRecord {
  schema: typeof LAUNCHER_SCHEMA;
  cli: RecordedCli[];
}

export interface LauncherPlace {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** The launcher's folder: `<config dir>/agents`. */
export function launcherDir(place: LauncherPlace = {}): string {
  const platform = place.platform ?? process.platform;
  return (platform === "win32" ? win32 : posix).join(configDir(place.env ?? process.env, platform), "agents");
}

/** A server entry as MCP clients write it: a command and its arguments. */
export interface ServerCommand {
  command: string;
  args: string[];
}

/**
 * What an agent's configuration runs on this machine: the launcher's shell
 * script, or on Windows `cmd /c` with its `.cmd` (clients start a server
 * without a shell, and a `.cmd` file is not an executable).
 */
export function launcherCommand(place: LauncherPlace = {}): ServerCommand {
  const platform = place.platform ?? process.platform;
  const dir = launcherDir(place);
  return platform === "win32" ? { command: "cmd", args: ["/c", win32.join(dir, "protoboard-mcp.cmd")] } : { command: posix.join(dir, "protoboard-mcp"), args: [] };
}

/**
 * What a configuration shared in a project runs: the project's own CLI, on
 * anyone's machine. `--no-install` is the point: where the project's packages
 * are not installed (a fresh clone), npx must fail, not fetch the package
 * named `protoboard` from the public registry, which is not this one, and
 * run it with no one asked (the security review's R6).
 */
export const PORTABLE_COMMAND: ServerCommand = { command: "npx", args: ["--no-install", "protoboard", "mcp"] };

const SH = `#!/bin/sh
# Protoboard MCP launcher (${LAUNCHER_SCHEMA}). Written by \`protoboard agents setup\` and by the
# Protoboard VS Code extension; do not edit. It finds Node.js, then runs protoboard-mcp.mjs beside it.
# Shell builtins only up to here: an agent started from the Dock may have almost no PATH.
case "$0" in */*) DIR="\${0%/*}" ;; *) DIR="." ;; esac
DIR="$(cd "$DIR" && pwd)"
NODE=""
if [ -r "$DIR/node-path" ]; then read -r NODE < "$DIR/node-path" || true; fi
# the recorded runtime is an editor's own (a machine with no Node.js): it runs as Node only with this set
if [ -e "$DIR/node-electron" ] && [ -n "$NODE" ] && [ -x "$NODE" ]; then ELECTRON_RUN_AS_NODE=1; export ELECTRON_RUN_AS_NODE; fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then NODE="$(command -v node 2>/dev/null || true)"; fi
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.local/share/mise/shims/node" "$HOME/.asdf/shims/node" /usr/bin/node; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "protoboard-mcp: Node.js 22 or later was not found. Install it, then run: protoboard agents setup" >&2
  exit 127
fi
exec "$NODE" "$DIR/protoboard-mcp.mjs" "$@"
`;

const CMD = `@echo off\r
rem Protoboard MCP launcher (${LAUNCHER_SCHEMA}). Written by protoboard agents setup and by the\r
rem Protoboard VS Code extension; do not edit. It finds Node.js, then runs protoboard-mcp.mjs beside it.\r
setlocal\r
set "DIR=%~dp0"\r
set "NODE="\r
if exist "%DIR%node-path" set /p NODE=<"%DIR%node-path"\r
if not defined NODE set "NODE=node"\r
if not exist "%NODE%" set "NODE=node"\r
if exist "%DIR%node-electron" if not "%NODE%"=="node" set "ELECTRON_RUN_AS_NODE=1"\r
"%NODE%" "%DIR%protoboard-mcp.mjs" %*\r
`;

/** The script the wrappers run. No dependencies: it must start from anywhere. */
const MJS = `#!/usr/bin/env node
// Protoboard MCP launcher (${LAUNCHER_SCHEMA}). Written by \`protoboard agents setup\` and by the
// Protoboard VS Code extension; do not edit. It picks the Protoboard CLI on this machine and runs
// \`<cli> mcp\`, passing stdio through (docs/specs/agents-and-mcp.md, section 3).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const say = (m) => process.stderr.write("protoboard-mcp: " + m + "\\n");

let record = { cli: [] };
try {
  record = JSON.parse(readFileSync(join(here, "launcher.json"), "utf8"));
} catch {}

const RANK = { extension: 0, npm: 1, project: 2 };
const parts = (v) => String(v ?? "0").split(/[.+-]/).map((n) => Number(n) || 0);
const newerFirst = (a, b) => {
  const [x, y] = [parts(a.version), parts(b.version)];
  for (let i = 0; i < 3; i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};
const recorded = (Array.isArray(record.cli) ? record.cli : [])
  .filter((c) => c && typeof c.entry === "string")
  .sort((a, b) => (RANK[a.from] ?? 1) - (RANK[b.from] ?? 1) || newerFirst(a, b))
  .map((c) => c.entry);

/** The CLI of the project the agent was started in. */
function projectCli(from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs");
    if (existsSync(bin)) return bin;
    if (dirname(dir) === dir) return undefined;
  }
}

const entry = [process.env.PROTOBOARD_CLI, ...recorded, projectCli(process.cwd())].find((c) => c && existsSync(c));
if (!entry) {
  say("the Protoboard CLI was not found on this machine. Install the Protoboard VS Code extension, or \`npm install -g @protoboardai/cli\`, then run \`protoboard agents setup\`. To stop this agent starting the server: \`protoboard agents remove\`.");
  process.exit(127);
}
const child = spawn(process.execPath, [entry, "mcp", ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  try {
    process.on(s, () => child.kill(s));
  } catch {}
}
child.on("error", (e) => {
  say("could not start " + entry + ": " + e.message);
  process.exit(126);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`;

/** The launcher's files and their text, for a platform. Both wrappers are written everywhere: a home folder can be shared. */
export const LAUNCHER_FILES: Record<string, string> = { "protoboard-mcp": SH, "protoboard-mcp.cmd": CMD, "protoboard-mcp.mjs": MJS };

export function readLauncherRecord(place: LauncherPlace = {}): LauncherRecord {
  try {
    const r = JSON.parse(readFileSync(join(launcherDir(place), "launcher.json"), "utf8")) as LauncherRecord;
    if (r && Array.isArray(r.cli)) return { schema: LAUNCHER_SCHEMA, cli: r.cli.filter((c) => c && typeof c.entry === "string") };
  } catch {
    // none yet, or unreadable: start over
  }
  return { schema: LAUNCHER_SCHEMA, cli: [] };
}

export interface LauncherInstall extends LauncherPlace {
  /** The CLI to record: the one running, or the one the extension carries. */
  cli?: { entry: string; version: string; from: CliOrigin };
  /** The Node.js to record in `node-path` (default: the one running). */
  node?: string;
  /**
   * `node` is an editor's own runtime (VS Code's, on a machine with no
   * Node.js): the launcher sets ELECTRON_RUN_AS_NODE for it. Recorded as the
   * file `node-electron` beside `node-path`.
   */
  electron?: boolean;
  now?: string;
  exists?: (p: string) => boolean;
}

export interface LauncherState {
  dir: string;
  command: ServerCommand;
  /** Files written this time (unchanged ones are left alone). */
  written: string[];
  cli: RecordedCli[];
}

/**
 * Write the launcher (only the files that differ) and record a CLI. Recorded
 * CLIs whose file is gone are dropped; one entry per file.
 */
export function installLauncher(options: LauncherInstall = {}): LauncherState {
  const dir = launcherDir(options);
  const exists = options.exists ?? existsSync;
  // the launchers live in the user's config folder, which stays private (PB-1048)
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") ensurePrivateDir(configDir(options.env ?? process.env, platform), platform);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const put = (name: string, text: string, mode?: number) => {
    const file = join(dir, name);
    let old: string | undefined;
    try {
      old = readFileSync(file, "utf8");
    } catch {
      old = undefined;
    }
    if (old !== text) {
      writeFileSync(file, text);
      written.push(name);
    }
    if (mode !== undefined) {
      try {
        chmodSync(file, mode);
      } catch {
        // a file system without modes (Windows)
      }
    }
  };
  for (const [name, text] of Object.entries(LAUNCHER_FILES)) put(name, text, name.endsWith(".cmd") ? undefined : 0o755);
  put("node-path", `${options.node ?? process.execPath}\n`);
  if (options.electron) put("node-electron", "1\n");
  else if (exists(join(dir, "node-electron"))) {
    rmSync(join(dir, "node-electron"), { force: true });
    written.push("node-electron");
  }
  const record = readLauncherRecord(options);
  let cli = record.cli.filter((c) => exists(c.entry));
  if (options.cli) {
    cli = [{ ...options.cli, recordedAt: options.now ?? new Date().toISOString() }, ...cli.filter((c) => c.entry !== options.cli!.entry)];
  }
  const text = JSON.stringify({ schema: LAUNCHER_SCHEMA, cli }, null, 2) + "\n";
  // the time alone is not a change worth a write
  const same = JSON.stringify(record.cli.map(({ recordedAt: _t, ...c }) => c)) === JSON.stringify(cli.map(({ recordedAt: _t, ...c }) => c));
  if (!same || !exists(join(dir, "launcher.json"))) {
    writeFileSync(join(dir, "launcher.json"), text);
    written.push("launcher.json");
  }
  return { dir, command: launcherCommand(options), written, cli: same ? record.cli : cli };
}

/** Whether a CLI entry is a project's own (it sits in a `node_modules` beside a `protoboard.config.ts` further up). */
export function cliOriginOf(entry: string, exists: (p: string) => boolean = existsSync): CliOrigin {
  for (let dir = dirname(entry); ; dir = dirname(dir)) {
    if (exists(join(dir, "protoboard.config.ts"))) return "project";
    if (dirname(dir) === dir) return "npm";
  }
}

/**
 * Finding and running the `protoboard` CLI for a project. No VS Code API here:
 * the unit tests run it directly.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { projectStackRange, satisfies, stackCli, type Stack } from "@protoboardai/core/stack";

/**
 * Where the CLI of a project comes from (PB-929), in the order they are tried:
 *
 * 1. `project`: the project's own installed CLI (`npm install`, or links to a stack copy);
 * 2. `setting`: the `protoboard.cliPath` setting;
 * 3. `store`: a stack copy in ~/.protoboard/stack that matches the version the project pins,
 *    when the carried one does not (`protoboard stack install` puts it there);
 * 4. `carried`: the stack carried in the .vsix, unpacked to ~/.protoboard/stack.
 *
 * `path`: after the four, and only in a build that carries no stack (a development build, or
 * the small .vsix): a CLI installed globally with npm, found from its command on PATH.
 * `none`: none of them.
 */
export type CliSource = "project" | "setting" | "store" | "carried" | "path" | "none";

/** How to start the CLI: `command ...args <protoboard arguments>`. */
export interface CliCommand {
  command: string;
  args: string[];
  /** Where it was found, for messages and the log. */
  from: CliSource;
  /** Environment the command needs besides the window's (ELECTRON_RUN_AS_NODE for VS Code's own runtime). */
  env?: Record<string, string>;
  /** `project`: its CLI is a link into this stack copy. `store` and `carried`: the copy. */
  stack?: string;
  /** `carried` (or `store`) while the project pins a version this copy does not satisfy: the range. */
  unsatisfied?: string;
  /**
   * Done before the command is started: unpacking the carried stack the first
   * time. `runCli` and the dev server await it.
   */
  prepare?: () => Promise<void>;
  /**
   * The project has the CLI installed under the packages' former npm scope
   * (`FORMER_CLI_BIN`, found here) and not under the current one: it was
   * written for stack 0.1.0 and its packages need renaming (PB-941).
   */
  formerScope?: string;
}

export interface CliSettings {
  /** `protoboard.cliPath`: empty for automatic. */
  cliPath?: string;
  /** `protoboard.nodePath` (default `node`). */
  nodePath?: string;
  /** The Node.js to run a script with, when already chosen (`chooseRuntime`); wins over `nodePath`. */
  runtime?: Runtime;
  /** The stack the .vsix carries: its version, and how to get its unpacked copy. Undefined in a build without one. */
  carried?: { version: string; dir: string; prepare?: () => Promise<void> };
  /** The copies in ~/.protoboard/stack (step 3). */
  stacks?: Stack[];
}

/** The Node.js the CLI runs with, and how it was found. */
export interface NodeChoice {
  /** What to run: the setting, `node` (on PATH), or the full path of one found elsewhere. */
  command: string;
  from: "setting" | "path" | "found" | "missing";
  /** Its full path when known (on PATH, or found). */
  path?: string;
}

/** What actually runs the CLI's script. */
export interface Runtime {
  command: string;
  env?: Record<string, string>;
  /**
   * `setting`: protoboard.nodePath. `system`: a Node.js 22 or later on this machine.
   * `vscode`: VS Code's own runtime, run as Node, because the machine has no Node.js 22 or later.
   */
  from: "setting" | "system" | "vscode";
  version?: string;
  /** Why the system's Node.js was not used (missing, or older than 22). */
  why?: string;
}

/** The oldest Node.js the stack runs on. */
export const MIN_NODE = 22;

/** `node --version` of a command, or undefined when it does not run. */
export function nodeVersion(command: string): string | undefined {
  try {
    const r = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    const v = /^v?(\d+\.\d+\.\d+)/.exec((r.stdout ?? "").trim());
    return r.status === 0 && v ? v[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The runtime for the CLI (PB-929): the `protoboard.nodePath` setting as it
 * is; else the system's Node.js when it is 22 or later; else VS Code's own
 * runtime run as Node (`ELECTRON_RUN_AS_NODE`), which is Node 22.20 in VS
 * Code 1.106 and newer in every later version. In a remote window the
 * extension runs on the server's own `node`, which is the same thing.
 */
export function chooseRuntime(node: NodeChoice, own: { execPath: string; version: string; electron?: boolean }, versionOf: (command: string) => string | undefined = nodeVersion): Runtime {
  if (node.from === "setting") return { command: node.command, from: "setting" };
  const vscode = (why: string): Runtime => ({ command: own.execPath, ...(own.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}), from: "vscode", version: own.version.replace(/^v/, ""), why });
  if (node.from === "missing") return vscode("no Node.js was found on this machine");
  const version = versionOf(node.path ?? node.command);
  if (!version) return vscode(`${node.path ?? node.command} did not run`);
  if (Number(version.split(".")[0]) < MIN_NODE) return vscode(`the Node.js on this machine is ${version}, older than ${MIN_NODE}`);
  return { command: node.command, from: "system", version };
}

export interface NodeLookup {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (p: string) => boolean;
  list?: (dir: string) => string[];
}

/**
 * The Node.js to run the CLI with: `protoboard.nodePath`, else `node` on
 * PATH, else one in the places installers put it. The last matters on macOS:
 * a VS Code started from the Dock or Finder has the system's PATH, not the
 * shell's, so a Node from Homebrew, nvm, Volta, fnm, asdf or mise is not on it.
 */
export function resolveNode(configured: string | undefined, look: NodeLookup = {}): NodeChoice {
  const set = configured?.trim();
  // `node` is the setting's default: look for it, as with no setting
  if (set && set !== "node") return { command: set, from: "setting" };
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const exists = look.exists ?? existsSync;
  const list = look.list ?? ((d: string) => readdirSync(d));
  const home = look.home ?? homedir();
  const win = platform === "win32";
  const names = win ? ["node.exe", "node.cmd"] : ["node"];
  const sep = win ? ";" : look.platform ? ":" : delimiter;
  const j = (...parts: string[]) => parts.join(win ? "\\" : "/");
  for (const dir of (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean)) {
    for (const n of names) if (exists(j(dir, n))) return { command: "node", from: "path", path: j(dir, n) };
  }
  const candidates: string[] = win
    ? [j(env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe"), j(env.LOCALAPPDATA ?? j(home, "AppData", "Local"), "Volta", "bin", "node.exe")]
    : [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        j(home, ".volta", "bin", "node"),
        ...newest(j(home, ".nvm", "versions", "node"), list).map((v) => j(home, ".nvm", "versions", "node", v, "bin", "node")),
        j(home, "Library", "Application Support", "fnm", "aliases", "default", "bin", "node"),
        j(home, ".local", "share", "fnm", "aliases", "default", "bin", "node"),
        j(home, ".local", "share", "mise", "shims", "node"),
        j(home, ".asdf", "shims", "node"),
        "/usr/bin/node",
      ];
  for (const c of candidates) if (exists(c)) return { command: c, from: "found", path: c };
  return { command: "node", from: "missing" };
}

/** Version folders (`v22.11.0`), newest first. */
function newest(dir: string, list: (dir: string) => string[]): string[] {
  let names: string[];
  try {
    names = list(dir);
  } catch {
    return [];
  }
  const key = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  return names
    .filter((n) => /^v?\d+\./.test(n))
    .sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

/** The installed CLI's entry, relative to a `node_modules` folder. */
export const CLI_BIN = join("@protoboardai", "cli", "bin", "protoboard.mjs");
/** Where stack 0.1.0 installed it: the packages were `@protoboard/…` until they were renamed (PB-941). Never run; only recognised. */
export const FORMER_CLI_BIN = join("@protoboard", "cli", "bin", "protoboard.mjs");

/** What a project written for the former scope has to change. */
export const SCOPE_RENAMED_MESSAGE =
  "this project has @protoboard/cli installed: the Protoboard packages were renamed to @protoboardai/… (stack 0.1.1). " +
  "Replace `@protoboard/` with `@protoboardai/` in package.json, protoboard.config.ts, the capability configs and the project's imports, " +
  "and set the project up again (Protoboard: Initialize Project; with packages installed by npm, point `@protoboardai:registry` in .npmrc at the registry and install them again)";

/** Where a project's installed CLI package is a link to (a stack copy), or undefined for a real folder. */
function linkedStack(bin: string): string | undefined {
  // …/node_modules/@protoboardai/cli/bin/protoboard.mjs → the package folder
  const pkg = dirname(dirname(bin));
  try {
    if (!lstatSync(pkg).isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  // <copy>/node_modules/@protoboardai/cli
  return dirname(dirname(dirname(resolveLink(pkg))));
}
function resolveLink(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The CLI for a project, in the order agreed (PB-929; `CliSource`):
 * the project's own installed `@protoboardai/cli` (the nearest `node_modules`
 * from the project folder up, as Node resolves it), the `protoboard.cliPath`
 * setting, a stack copy matching the version the project pins, the stack
 * carried in the .vsix. `protoboard` on PATH is not looked for any more: the
 * carried stack is the fallback that is always there.
 * A project that has only the former scope's CLI installed gets `formerScope`,
 * and `cliError` then says the packages were renamed.
 * A script path runs with Node, so no shell shim is involved on any platform.
 */
export function resolveCli(root: string, settings: CliSettings = {}, exists: (p: string) => boolean = existsSync, range: (root: string) => string | undefined = projectStackRange, look: GlobalLookup = {}): CliCommand {
  const runtime: Runtime = settings.runtime ?? { command: settings.nodePath?.trim() || "node", from: "setting" };
  const script = (file: string, from: CliSource, more: Partial<CliCommand> = {}): CliCommand => ({ command: runtime.command, args: [file], from, ...(runtime.env ? { env: runtime.env } : {}), ...more });
  // 1. the project's own
  let former: string | undefined;
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", CLI_BIN);
    if (exists(bin)) {
      const stack = linkedStack(bin);
      return script(bin, "project", stack ? { stack } : {});
    }
    former ??= exists(join(dir, "node_modules", FORMER_CLI_BIN)) ? join(dir, "node_modules", FORMER_CLI_BIN) : undefined;
    if (dirname(dir) === dir) break;
  }
  // 2. the setting
  const configured = settings.cliPath?.trim();
  if (configured) {
    const file = isAbsolute(configured) ? configured : /[\\/]/.test(configured) ? resolve(root, configured) : configured;
    return /\.(mjs|cjs|js)$/.test(file) ? script(file, "setting") : { command: file, args: [], from: "setting" };
  }
  // the CLI installed under the former scope is not run: its packages are not the ones this extension works with
  const formerScope = former ? { formerScope: former } : {};
  const wanted = range(root);
  const fits = (version: string) => !wanted || satisfies(version, wanted) !== false;
  const carried = settings.carried;
  // 3. a copy that matches the version the project pins, when the carried stack does not
  if (wanted && !(carried && fits(carried.version))) {
    const match = (settings.stacks ?? []).find((s) => s.marker.version !== carried?.version && satisfies(s.marker.version, wanted) === true);
    if (match) return script(stackCli(match.dir), "store", { stack: match.dir, ...formerScope });
  }
  // 4. the carried stack
  if (carried) return script(stackCli(carried.dir), "carried", { stack: carried.dir, ...(carried.prepare ? { prepare: carried.prepare } : {}), ...(wanted && !fits(carried.version) ? { unsatisfied: wanted } : {}), ...formerScope });
  // After the four, only in a build that carries no stack: a CLI installed globally with npm, found from its
  // command on PATH. Its script runs with Node like a project's: no `.cmd` shim (Windows) and no
  // `#!/usr/bin/env node` (a Dock-started VS Code on macOS) in the way. Another package manager's shim is run as
  // the command it is, when the system can start it.
  const global = globalCliScript({ exists, ...look });
  if (global) return script(global, "path", formerScope);
  const bare: CliCommand = { command: "protoboard", args: [], from: "path", ...formerScope };
  if (canRun(bare, { exists, ...look })) return bare;
  return { command: "protoboard", args: [], from: "none", ...formerScope };
}

/** One line for the log: which CLI a project's commands run, and why that one. */
export function describeCli(cli: CliCommand): string {
  const file = cli.args[0] ?? cli.command;
  switch (cli.from) {
    case "project":
      return cli.stack ? `1 of 4, the project's own: ${file}, a link to the stack copy ${cli.stack}` : `1 of 4, the project's own (installed by npm): ${file}`;
    case "setting":
      return `2 of 4, the protoboard.cliPath setting: ${file}`;
    case "store":
      return `3 of 4, the stack copy that matches the version the project pins: ${file}`;
    case "carried":
      return `4 of 4, the stack carried by this extension: ${file}${cli.unsatisfied ? ` (the project asks for ${cli.unsatisfied}, which it is not)` : ""}`;
    case "path":
      return `a CLI installed globally, found on PATH (this build of the extension carries no stack): ${file}`;
    default:
      return "none found: the project has no installed CLI, protoboard.cliPath is empty, this build of the extension carries no stack, and no `protoboard` that can be started is on PATH";
  }
}

/** One line for the log: what runs the CLI's script. */
export function describeRuntime(r: Runtime): string {
  switch (r.from) {
    case "setting":
      return `${r.command} (the protoboard.nodePath setting)`;
    case "system":
      return `${r.command} (Node.js ${r.version} on this machine)`;
    default:
      return `VS Code's own runtime as Node.js ${r.version} (${r.command}), because ${r.why}`;
  }
}

export interface GlobalLookup {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  /** Where a link leads (`fs.realpathSync`); throws when it leads nowhere. */
  realpath?: (p: string) => string;
}

/**
 * The script of a CLI installed globally with npm (`npm install -g
 * @protoboardai/cli`), found from its command on PATH: on Windows the shim
 * `protoboard.cmd` sits beside `node_modules`; elsewhere `protoboard` is a
 * link to the script. Undefined for anything else on PATH (another package
 * manager's shim), which is then run as a command.
 */
export function globalCliScript(look: GlobalLookup = {}): string | undefined {
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const exists = look.exists ?? existsSync;
  const realpath = look.realpath ?? ((p: string) => realpathSync(p));
  const win = platform === "win32";
  const sep = win ? ";" : look.platform ? ":" : delimiter;
  for (const raw of (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean)) {
    const dir = raw.replace(win ? /[\\/]+$/ : /\/+$/, "");
    if (win) {
      if (!exists(`${dir}\\protoboard.cmd`)) continue;
      const file = `${dir}\\node_modules\\@protoboardai\\cli\\bin\\protoboard.mjs`;
      if (exists(file)) return file;
      continue;
    }
    if (!exists(`${dir}/protoboard`)) continue;
    try {
      const file = realpath(`${dir}/protoboard`);
      if (/[\\/]@protoboardai[\\/]cli[\\/].*\.(mjs|cjs|js)$/.test(file) && exists(file)) return file;
    } catch {
      // a link that leads nowhere: not this one
    }
  }
  return undefined;
}

/**
 * Whether `runCli` can start this CLI. A script runs with Node; a command
 * must be something the system starts without a shell: on Windows that is an
 * `.exe`, not npm's `.cmd` shim.
 */
export function canRun(cli: CliCommand, look: Pick<GlobalLookup, "env" | "platform" | "exists"> = {}): boolean {
  if (cli.from === "none") return false;
  if (cli.from !== "path" || cli.args.length) return true;
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const exists = look.exists ?? existsSync;
  const win = platform === "win32";
  const sep = win ? ";" : look.platform ? ":" : delimiter;
  for (const raw of (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean)) {
    const dir = raw.replace(win ? /[\\/]+$/ : /\/+$/, "");
    if (exists(win ? `${dir}\\${cli.command}.exe` : `${dir}/${cli.command}`)) return true;
  }
  return false;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the CLI to completion. A missing executable rejects with a message that says which setting to change. */
export async function runCli(cli: CliCommand, args: string[], options: { cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv; onStderr?: (line: string) => void }): Promise<CliResult> {
  if (cli.from === "none") throw cliError(cli, Object.assign(new Error("no CLI"), { code: "ENOENT" }));
  // a folder that is gone makes the system answer "not found" for the program itself: say what is really missing
  if (!existsSync(options.cwd)) throw folderGone(options.cwd);
  // the carried stack is unpacked the first time it is needed
  if (cli.prepare) await cli.prepare();
  return new Promise((ok, fail) => {
    const proc = spawn(cli.command, [...cli.args, ...args], { cwd: options.cwd, env: { ...(options.env ?? process.env), ...(cli.env ?? {}) }, signal: options.signal, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    let pending = "";
    proc.stderr.on("data", (d) => {
      stderr += d;
      if (!options.onStderr) return;
      const lines = (pending + d).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) options.onStderr(l);
    });
    proc.on("error", (e) => fail(cliError(cli, e)));
    proc.on("close", (code) => {
      if (pending.trim()) options.onStderr?.(pending);
      ok({ code, stdout, stderr });
    });
  });
}

/** The project's folder is not there any more (moved, deleted, a worktree removed). */
export function folderGone(dir: string): Error {
  return new Error(`the folder ${dir} is no longer there: the project was moved or deleted. Its Protoboard tabs are closed; open the project where it is now.`);
}

/** A spawn failure, explained. */
export function cliError(cli: CliCommand, e: Error): Error {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") return e;
  if (cli.from === "none" && cli.formerScope) return new Error(`protoboard CLI not found: ${SCOPE_RENAMED_MESSAGE}`);
  if (cli.from === "none") return new Error("protoboard CLI not found: this build of the Protoboard extension carries no stack (a development build), the project has no installed packages, and no Protoboard is installed for your user. Install the Protoboard extension that carries the stack, or set protoboard.cliPath");
  if (cli.args.length) {
    return new Error(
      `cannot run ${cli.command} (not found): the Node.js chosen for the Protoboard CLI is not there. ` +
        "Leave protoboard.nodePath at `node` to let Protoboard choose (a Node.js 22 or later on this machine, else VS Code's own runtime), " +
        "or set protoboard.nodePath to the full path of a Node.js 22 or later",
    );
  }
  return new Error(`cannot run ${cli.command} (not found): check protoboard.cliPath`);
}

/**
 * The JSON a `--format json` command printed. The CLI prints `{"error": ...}`
 * and exits 2 when the command itself failed; that becomes an Error.
 */
export function parseJsonOutput<T>(r: CliResult, what: string): T {
  let data: unknown;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    const detail = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-3).join(" ");
    throw new Error(`${what} printed no JSON (exit ${r.code})${detail ? `: ${detail}` : ""}`);
  }
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new Error(`${what}: ${(data as { error: string }).error}`);
  }
  return data as T;
}

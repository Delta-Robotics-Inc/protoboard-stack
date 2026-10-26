/**
 * `protoboard setup` (first builds review, D4 and item 8; PB-1047): the npm
 * package sets up the rest of the machine. It finds the command-line launchers
 * of VS Code, Cursor, Windsurf and VSCodium, installs the Protoboard extension
 * into each with the user's yes (`<editor> --install-extension
 * deltarobotics.vscode-protoboard --force`: VS Code installs it from the
 * Marketplace, the others from Open VSX), offers to put the `protoboard`
 * command on PATH, and then offers the agents' set-up (`agents setup`). None
 * of it needs a sign-in.
 *
 * `--vsix <file>` installs that package instead, for a machine offline. An
 * editor whose gallery does not have the extension (not published yet) is said
 * in one line, and the PATH and the agents are still set up.
 *
 * It is a command a person (or their agent, with their yes) runs. It is never
 * run from an npm install script: an install must not change an editor.
 *
 * The platform, the environment, the file system, the network and the
 * programs it starts are arguments, so Windows and macOS are tested from Linux.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { applyPathPlan, describePathPlan, lastingPath, onPathValue, pathPlan, stackHome, type PathPlan } from "@protoboardai/core";

export type EditorId = "code" | "cursor" | "windsurf" | "codium";

export interface Editor {
  id: EditorId;
  name: string;
  /** Its command-line launcher, as a full path. */
  launcher: string;
  /** `path`: found on PATH. `known`: found where its installer puts it. */
  from: "path" | "known";
}

export const EDITORS: readonly { id: EditorId; name: string }[] = [
  { id: "code", name: "VS Code" },
  { id: "cursor", name: "Cursor" },
  { id: "windsurf", name: "Windsurf" },
  { id: "codium", name: "VSCodium" },
];

export interface Look {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (file: string) => boolean;
}

/** Where each editor's installer puts its launcher, when it is not on PATH. */
function knownLaunchers(id: EditorId, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === "darwin") {
    const app = { code: "Visual Studio Code.app", cursor: "Cursor.app", windsurf: "Windsurf.app", codium: "VSCodium.app" }[id];
    return [`/Applications/${app}/Contents/Resources/app/bin/${id}`, `${home}/Applications/${app}/Contents/Resources/app/bin/${id}`];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    const files = env.ProgramFiles ?? "C:\\Program Files";
    return {
      code: [`${local}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${files}\\Microsoft VS Code\\bin\\code.cmd`],
      cursor: [`${local}\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd`, `${files}\\cursor\\resources\\app\\bin\\cursor.cmd`],
      windsurf: [`${local}\\Programs\\Windsurf\\bin\\windsurf.cmd`, `${files}\\Windsurf\\bin\\windsurf.cmd`],
      codium: [`${local}\\Programs\\VSCodium\\bin\\codium.cmd`, `${files}\\VSCodium\\bin\\codium.cmd`],
    }[id];
  }
  return {
    code: ["/usr/bin/code", "/snap/bin/code", "/usr/share/code/bin/code", "/var/lib/flatpak/exports/bin/com.visualstudio.code"],
    cursor: ["/usr/bin/cursor", `${home}/.local/bin/cursor`, "/opt/cursor/bin/cursor"],
    windsurf: ["/usr/bin/windsurf", `${home}/.local/bin/windsurf`, "/opt/windsurf/bin/windsurf"],
    codium: ["/usr/bin/codium", "/snap/bin/codium", "/usr/share/codium/bin/codium", "/var/lib/flatpak/exports/bin/com.vscodium.codium"],
  }[id];
}

/** The editors whose command-line launcher is on this machine: on PATH first, else where the installer puts it. */
export function findEditors(look: Look = {}): Editor[] {
  const platform = look.platform ?? process.platform;
  const env = look.env ?? process.env;
  const home = look.home ?? homedir();
  const exists = look.exists ?? existsSync;
  const win = platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "")
    .split(win ? ";" : ":")
    .filter(Boolean)
    .map((d) => d.replace(win ? /[\\/]+$/ : /\/+$/, ""));
  const found: Editor[] = [];
  for (const e of EDITORS) {
    const names = win ? [`${e.id}.cmd`, `${e.id}.exe`] : [e.id];
    let launcher: string | undefined;
    for (const d of dirs) {
      launcher = names.map((n) => (win ? `${d}\\${n}` : `${d}/${n}`)).find(exists);
      if (launcher) break;
    }
    if (launcher) found.push({ ...e, launcher, from: "path" });
    else {
      const known = knownLaunchers(e.id, platform, env, home).find(exists);
      if (known) found.push({ ...e, launcher: known, from: "known" });
    }
  }
  return found;
}

export interface Command {
  command: string;
  args: string[];
  /** Windows: the arguments are the command line as written (no quoting added). */
  verbatim?: boolean;
}

/**
 * `<editor> --install-extension <id | file> --force`, started without a shell
 * where the launcher is a program or a script. On Windows the launcher is a
 * `.cmd`, which only cmd runs: the line is given to cmd whole, each argument in
 * double quotes (inside them cmd reads `&` and spaces as text).
 */
export function installCommand(editor: Pick<Editor, "launcher">, extension: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Command {
  const args = ["--install-extension", extension, "--force"];
  if (platform === "win32" && /\.(cmd|bat)$/i.test(editor.launcher)) {
    for (const p of [editor.launcher, extension]) if (/["%]/.test(p)) throw new Error(`${p} has a " or a % in its path, which cmd would read as its own: move the file to a folder without one`);
    return { command: env.ComSpec ?? `${env.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`, args: ["/d", "/s", "/c", `""${editor.launcher}" --install-extension "${extension}" --force"`], verbatim: true };
  }
  return { command: editor.launcher, args };
}

export type Run = (c: Command) => { status: number | null; stdout: string; stderr: string; error?: Error };

const defaultRun: Run = (c) => {
  // an editor's launcher started from VS Code's own runtime must not inherit "run as Node"
  const { ELECTRON_RUN_AS_NODE: _e, ...env } = process.env;
  const r = spawnSync(c.command, c.args, { encoding: "utf8", env, windowsHide: true, timeout: 5 * 60_000, ...(c.verbatim ? { windowsVerbatimArguments: true } : {}) });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error } : {}) };
};

// ---------------------------------------------------------------- the extension

/** The extension's id on the Visual Studio Marketplace and on Open VSX (`<publisher>.<name>` of its manifest). */
export const EXTENSION_ID = "deltarobotics.vscode-protoboard";

/**
 * What is installed: the extension by its id, from the editor's own gallery
 * (VS Code's is the Marketplace; Cursor's, Windsurf's and VSCodium's is Open
 * VSX), or a `.vsix` file given with `--vsix` (offline).
 */
export type ExtensionSource = { from: "gallery"; id: string } | { from: "file"; file: string };

/** An editor's answer that its gallery has no extension of that id: not published there (yet). */
export const notPublished = (output: string) => /\bnot found\b|\b404\b/i.test(output);

// ---------------------------------------------------------------- the command

export interface SetupFlags {
  vsix?: string;
  yes?: boolean;
  editor?: string[];
  /** false: leave the agents alone (`--no-agents`). */
  agents?: boolean;
}

export interface SetupIo {
  json: boolean;
  cwd: string;
  out(data: unknown, text: () => string): void;
  log(line: string): void;
  /** Ask a yes/no question at the terminal; undefined when there is no terminal to ask at. */
  confirm?: (question: string) => Promise<boolean>;
  /** The agents' set-up, offered last (`protoboard agents setup`). */
  agents?: () => Promise<void>;
}

export interface SetupDeps extends Look {
  run?: Run;
  /** The user's Protoboard folder (its `bin` holds the command). */
  stackHome?: string;
  /** Appends to a shell start file (PATH set-up). */
  append?: (file: string, text: string) => void;
  read?: (file: string) => string;
}

export interface EditorResult {
  id: EditorId;
  name: string;
  launcher: string;
  /** `unpublished`: the editor's gallery has no extension of that id yet (not a failure of the set-up). */
  action: "installed" | "declined" | "failed" | "unpublished";
  command: string;
  message?: string;
}

export interface SetupResult {
  editors: EditorResult[];
  notFound: string[];
  /** What was installed into the editors: the id from their galleries, or a `--vsix` file. */
  extension?: ExtensionSource;
  path?: { dir: string; action: "added" | "already" | "declined" | "failed" | "not-needed"; message: string };
  agents: "offered" | "skipped" | "not-run";
}

const show = (c: Command) => (c.verbatim ? `${c.command} ${c.args.join(" ")}` : [c.command, ...c.args].map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a))).join(" "));

export async function setupCommand(flags: SetupFlags, io: SetupIo, deps: SetupDeps = {}): Promise<SetupResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  // an install must not change an editor or a shell's start file: only a person's own command does
  const lifecycle = env.npm_lifecycle_event;
  if (lifecycle) throw new Error(`protoboard setup does not run from an npm script of an install (${lifecycle}): it changes editors and asks before each change. Run \`protoboard setup\` yourself, in a terminal.`);
  if (!flags.yes && !io.confirm) throw new Error("there is no terminal to ask at, and protoboard setup changes nothing without a yes: run it in a terminal, or with --yes (installs the extension into every editor found; --editor <id> names one)");
  const run = deps.run ?? defaultRun;
  const wanted = flags.editor ?? [];
  for (const id of wanted) if (!EDITORS.some((e) => e.id === id)) throw new Error(`no editor "${id}"; known: ${EDITORS.map((e) => e.id).join(", ")}`);
  const all = findEditors(deps);
  const editors = wanted.length ? all.filter((e) => wanted.includes(e.id)) : all;
  const notFound = EDITORS.filter((e) => (wanted.length ? wanted.includes(e.id) : true) && !all.some((a) => a.id === e.id)).map((e) => e.name);
  const result: SetupResult = { editors: [], notFound, agents: "not-run" };

  // ---- the extension, into each editor found
  if (editors.length) {
    let source: ExtensionSource;
    if (flags.vsix) {
      const file = resolve(io.cwd, flags.vsix);
      if (!(deps.exists ?? existsSync)(file)) throw new Error(`--vsix: there is no file ${file}`);
      if (!/\.vsix$/i.test(file)) throw new Error(`--vsix: ${file} is not a .vsix file`);
      source = { from: "file", file };
    } else source = { from: "gallery", id: EXTENSION_ID };
    result.extension = source;
    const what = source.from === "file" ? source.file : source.id;
    for (const e of editors) {
      const c = installCommand(e, what, platform, env);
      const shown = show(c);
      if (!flags.yes && !(await io.confirm!(`Install the Protoboard extension into ${e.name}? This runs: ${e.launcher} --install-extension ${what} --force`))) {
        result.editors.push({ id: e.id, name: e.name, launcher: e.launcher, action: "declined", command: shown });
        continue;
      }
      io.log(`${e.name}: ${e.launcher} --install-extension ${source.from === "file" ? basename(source.file) : source.id} --force`);
      const r = run(c);
      const ok = !r.error && r.status === 0;
      const said = `${r.stderr}\n${r.stdout}`;
      // the gallery has no such extension: said once below, and the set-up goes on (PATH, agents)
      const action = ok ? "installed" : !r.error && source.from === "gallery" && notPublished(said) ? "unpublished" : "failed";
      result.editors.push({ id: e.id, name: e.name, launcher: e.launcher, action, command: shown, ...(action === "failed" ? { message: (r.error?.message ?? (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-3).join(" ")) || `exit ${r.status}` } : {}) });
    }
  }

  // ---- the command for terminals outside the editor: only when the extension put one in ~/.protoboard/bin and no `protoboard` is on PATH
  const bin = join(deps.stackHome ?? stackHome(env), "bin");
  const exists = deps.exists ?? existsSync;
  const win = platform === "win32";
  // what a terminal outside the editor has: in an editor's terminal the extension's own entry for `bin` lasts only there (PB-1037)
  const lasting = lastingPath(bin, env, platform);
  const hasCommand = (lasting ?? "")
    .split(win ? ";" : ":")
    .filter(Boolean)
    .some((d) => (win ? ["protoboard.cmd", "protoboard.exe"] : ["protoboard"]).some((n) => exists(win ? `${d.replace(/[\\/]+$/, "")}\\${n}` : `${d.replace(/\/+$/, "")}/${n}`)));
  if (!exists(join(bin, win ? "protoboard.cmd" : "protoboard"))) {
    result.path = { dir: bin, action: "not-needed", message: hasCommand ? "The protoboard command is on PATH." : `The Protoboard extension writes the protoboard command into ${bin} the first time it starts; run \`protoboard setup\` again then to put it on PATH.` };
  } else if (hasCommand || onPathValue(bin, lasting, platform)) {
    result.path = { dir: bin, action: "already", message: "The protoboard command is on PATH." };
  } else {
    const plan: PathPlan = pathPlan(bin, { platform, env, ...(deps.home ? { home: deps.home } : {}), ...(deps.exists ? { exists: deps.exists } : {}), ...(deps.read ? { read: deps.read } : {}) });
    if (plan.kind === "already") result.path = { dir: bin, action: "already", message: describePathPlan(plan) };
    else if (!flags.yes && !(await io.confirm!(`Put the protoboard command on your PATH, for terminals outside the editor? ${describePathPlan(plan)}`))) result.path = { dir: bin, action: "declined", message: `Left as it is. The command is ${join(bin, win ? "protoboard.cmd" : "protoboard")}; the editor's own terminals have it.` };
    else {
      try {
        const applied = applyPathPlan(plan, { ...(deps.append ? { append: deps.append } : {}), ...(deps.run ? { run: (command: string, args: string[]) => deps.run!({ command, args }) } : {}) });
        result.path = { dir: bin, action: applied.changed ? "added" : "already", message: applied.message };
      } catch (e) {
        result.path = { dir: bin, action: "failed", message: (e as Error).message };
      }
    }
  }

  // ---- report, then the agents (their own questions, their own report)
  const agentsNext = flags.agents === false ? "skipped" : io.agents && !io.json && io.confirm ? "offered" : "not-run";
  result.agents = agentsNext;
  const mark = { installed: "✓", declined: "·", failed: "✗", unpublished: "·" } as const;
  const unpublished = result.editors.filter((e) => e.action === "unpublished").map((e) => e.name);
  const gallery = (id: EditorId) => (id === "code" ? "the Marketplace" : "Open VSX");
  io.out(result, () =>
    [
      ...(result.editors.length || result.notFound.length ? ["The Protoboard extension"] : []),
      ...result.editors.map((e) => `  ${mark[e.action]} ${e.name}: ${e.action === "installed" ? `installed (${e.launcher})` : e.action === "declined" ? "left alone" : e.action === "unpublished" ? "not installed" : `not installed: ${e.message}`}${e.action === "installed" ? "\n      Reload its windows (or restart it) to start the extension." : ""}`),
      ...(unpublished.length ? [`  ${EXTENSION_ID} is not published yet on ${[...new Set(result.editors.filter((e) => e.action === "unpublished").map((e) => gallery(e.id)))].join(" or ")}: install a .vsix with \`protoboard setup --vsix <file>\`.`] : []),
      ...(result.notFound.length ? [`  Not found here: ${result.notFound.join(", ")}${editors.length ? "" : `. In ${result.notFound[0]}, install it from the Extensions view: search for Protoboard (${EXTENSION_ID})${platform === "darwin" ? '; its command comes with "Shell Command: Install \'code\' command in PATH" from the Command Palette' : ""}.`}`] : []),
      ...(result.extension?.from === "file" ? [`  from ${result.extension.file}`] : result.extension && result.editors.some((e) => e.action === "installed") ? [`  ${EXTENSION_ID}, from ${[...new Set(result.editors.filter((e) => e.action === "installed").map((e) => gallery(e.id)))].join(" and ")}`] : []),
      ...(result.path && result.path.action !== "not-needed" ? ["", "The protoboard command", `  ${result.path.action === "failed" ? "✗" : result.path.action === "declined" ? "·" : "✓"} ${result.path.message}`] : result.path ? ["", result.path.message] : []),
      ...(agentsNext === "not-run" ? ["", "Agents: `protoboard agents setup` connects your agents to Protoboard (it asks about each)."] : []),
    ].join("\n"),
  );
  if (agentsNext === "offered") {
    io.log("");
    io.log("Agents");
    await io.agents!();
  }
  return result;
}

/** The exit code of a set-up: 1 when an install that was agreed to failed. */
export const setupExitCode = (r: SetupResult) => (r.editors.some((e) => e.action === "failed") || r.path?.action === "failed" ? 1 : 0);

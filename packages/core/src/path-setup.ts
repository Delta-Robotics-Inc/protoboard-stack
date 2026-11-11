/**
 * The `protoboard` command for terminals outside VS Code (first builds
 * review, D3: global by default).
 *
 * The VS Code extension writes the command into `<home>/bin` (`~/.protoboard/bin`;
 * stack.ts, `writeCommands`) and gives it to its own terminals. A terminal
 * opened anywhere else, and an agent that starts its own shell, find it only
 * when that folder is on the user's PATH. This file says how to put it there
 * on each system, and does it when the user says yes:
 *
 * - macOS and Linux: one marked line at the end of the shell's own start
 *   file (`~/.zshrc`, `~/.bashrc` or `~/.bash_profile`, a fish `conf.d` file,
 *   else `~/.profile`). Deleting the line undoes it.
 * - Windows: the folder is added to the user's `Path` (the per-user
 *   environment, no administrator rights), through PowerShell. The value is
 *   read from the registry as it is stored (`%USERPROFILE%` and the like not
 *   expanded), the folder is appended here (`addToPathValue`), and the result
 *   is written back with the registry type it had: every other entry stays
 *   exactly as it was.
 *
 * The folder goes to the END of PATH: a `protoboard` the user installed
 * another way stays first. Nothing here is run from an install script.
 * Platform, environment and file access are arguments, so every system is
 * tested from one.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

/** Marks the line this file writes, so it is written once and can be found again. */
export const PATH_MARK = "protoboard-path";

export interface PathLook {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (file: string) => boolean;
  read?: (file: string) => string;
}

export type PathPlan =
  /** The folder is on PATH already, or its line is in the start file (new terminals have it). */
  | { kind: "already"; dir: string; where: string }
  /** A line to append to a shell start file. */
  | { kind: "profile"; dir: string; file: string; line: string; shell: string }
  /** Windows: the PowerShell command that reads the user's Path as it is stored (`readUserPathScript`); applying the plan appends the folder and writes it back. */
  | { kind: "windows"; dir: string; command: string; args: string[] };

const samePath = (a: string, b: string, win: boolean) => {
  const norm = (p: string) => (win ? p.replace(/[\\/]+$/, "").toLowerCase() : p.replace(/\/+$/, ""));
  return norm(a) === norm(b);
};

/** Whether `dir` is one of the folders of a PATH value. */
export function onPathValue(dir: string, value: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  const win = platform === "win32";
  return (value ?? "").split(win ? ";" : ":").filter(Boolean).some((p) => samePath(p, dir, win));
}

/** Set in the terminals of an editor whose Protoboard extension puts `<home>/bin` on their PATH (that entry lasts only as long as the terminal). */
export const TERMINAL_PATH_ENV = "PROTOBOARD_TERMINAL_PATH";

/**
 * The PATH a terminal opened outside the editor would have (PB-1037). In a
 * VS Code, Cursor or Windsurf terminal the Protoboard extension has appended
 * `dir` to the PATH the shell inherited, so finding it there says nothing
 * about other shells: the entry is left out. Elsewhere the PATH is what it is.
 */
export function lastingPath(dir: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | undefined {
  const win = platform === "win32";
  const value = env.PATH ?? env.Path;
  const marked = env[TERMINAL_PATH_ENV];
  const editor = env.TERM_PROGRAM === "vscode" || (marked !== undefined && samePath(marked, dir, win));
  if (!editor || value === undefined) return value;
  const sep = win ? ";" : ":";
  return value
    .split(sep)
    .filter((p) => !samePath(p, dir, win))
    .join(sep);
}

/** Windows expands `%NAME%` in an expandable value; a name it does not know stays as written. */
const expandWindows = (text: string, env: NodeJS.ProcessEnv) => {
  const byName = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v] as const));
  return text.replace(/%([^%;]+)%/g, (all, name: string) => byName.get(name.toLowerCase()) ?? all);
};

/** Whether an entry of a stored Windows Path is `dir`: case and a trailing separator do not count, quotes around it neither, and `%USERPROFILE%\x` is the folder it stands for. */
const isWindowsEntry = (entry: string, dir: string, env: NodeJS.ProcessEnv) => {
  const bare = entry.trim().replace(/^"(.*)"$/, "$1");
  if (!bare) return false;
  return samePath(bare, dir, true) || samePath(expandWindows(bare, env), dir, true);
};

/**
 * A stored Windows `Path` value with `dir` at its end (PB-1225). The value is
 * the registry's own text, variables not expanded; what was there is kept
 * character for character and only `;dir` is appended (after a trailing
 * semicolon, `dir` alone). A value that has the folder already, as written or
 * through a variable in `env`, comes back unchanged.
 */
export function addToPathValue(value: string | undefined, dir: string, env: NodeJS.ProcessEnv = {}): { value: string; changed: boolean } {
  const stored = value ?? "";
  if (stored.split(";").some((e) => isWindowsEntry(e, dir, env))) return { value: stored, changed: false };
  if (!stored.trim()) return { value: dir, changed: true };
  return { value: stored.endsWith(";") ? stored + dir : `${stored};${dir}`, changed: true };
}

/** A stored Windows `Path` value without `dir`: only the entries that are that folder go, each with one separator; every other entry stays as written. */
export function removeFromPathValue(value: string | undefined, dir: string, env: NodeJS.ProcessEnv = {}): { value: string; changed: boolean } {
  const stored = value ?? "";
  const entries = stored.split(";");
  const kept = entries.filter((e) => !isWindowsEntry(e, dir, env));
  return kept.length === entries.length ? { value: stored, changed: false } : { value: kept.join(";"), changed: true };
}

const POWERSHELL_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/**
 * PowerShell that prints the user's `Path` as the registry stores it: one
 * line, `missing`, or the value's registry type and its text (UTF-8, base64:
 * the console's code page never touches it). `[Environment]::GetEnvironmentVariable`
 * is not used: it returns the value with its variables expanded.
 */
export function readUserPathScript(): string {
  return [
    "$ErrorActionPreference='Stop'",
    "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')",
    "$v=if ($null -eq $k) { $null } else { $k.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }",
    "if ($null -eq $v) { 'missing' } else { $k.GetValueKind('Path').ToString()+' '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$v)) }",
  ].join("; ");
}

/** What `readUserPathScript` printed. */
export function parseUserPath(stdout: string): { kind: string; value: string } | { kind: "missing" } | undefined {
  const line = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
  if (line === "missing") return { kind: "missing" };
  // an empty value prints its type alone
  const m = /^([A-Za-z]+)(?: ([A-Za-z0-9+/=]*))?$/.exec(line);
  return m ? { kind: m[1]!, value: Buffer.from(m[2] ?? "", "base64").toString("utf8") } : undefined;
}

/**
 * PowerShell that writes the user's `Path` with a given registry type
 * (`ExpandString` stays `ExpandString`), then tells running programs the
 * environment changed. `[Environment]::SetEnvironmentVariable` is not used
 * for the value (it writes a plain string); deleting a variable that does
 * not exist through it changes nothing and sends the same broadcast.
 */
export function writeUserPathScript(value: string, kind: "String" | "ExpandString"): string {
  return [
    "$ErrorActionPreference='Stop'",
    `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`,
    "$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
    `$k.SetValue('Path',$v,[Microsoft.Win32.RegistryValueKind]::${kind})`,
    "$k.Close()",
    "[Environment]::SetEnvironmentVariable('PROTOBOARD_PATH_CHANGED',$null,'User')",
    "'written'",
  ].join("; ");
}

/** What would put `dir` on the user's PATH, or that it is there. Changes nothing. */
export function pathPlan(dir: string, look: PathLook = {}): PathPlan {
  const platform = look.platform ?? process.platform;
  const env = look.env ?? process.env;
  const home = look.home ?? homedir();
  const exists = look.exists ?? existsSync;
  const read = look.read ?? ((f: string) => readFileSync(f, "utf8"));
  // an editor terminal's own entry is not the user's PATH
  if (onPathValue(dir, lastingPath(dir, env, platform), platform)) return { kind: "already", dir, where: "PATH" };
  if (platform === "win32") {
    const root = env.SystemRoot ?? env.windir ?? "C:\\Windows";
    return { kind: "windows", dir, command: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: [...POWERSHELL_FLAGS, readUserPathScript()] };
  }
  const shell = (env.SHELL ?? "").split("/").pop() || "sh";
  const j = (...parts: string[]) => parts.join("/");
  // written with $HOME when the folder is under it: the line then survives a home folder that moves
  const shown = dir === home || dir.startsWith(`${home}/`) ? `$HOME${dir.slice(home.length)}` : dir;
  let file: string;
  let line: string;
  if (shell === "fish") {
    file = j(env.XDG_CONFIG_HOME || j(home, ".config"), "fish", "conf.d", "protoboard.fish");
    line = `set -gx PATH $PATH "${shown}" # ${PATH_MARK}: the protoboard command (added by Protoboard; delete this line to undo)`;
  } else {
    file =
      shell === "zsh"
        ? j(env.ZDOTDIR || home, ".zshrc")
        : shell === "bash"
          ? // macOS starts bash as a login shell (which reads .bash_profile, not .bashrc)
            platform === "darwin"
            ? j(home, ".bash_profile")
            : j(home, ".bashrc")
          : j(home, ".profile");
    line = `export PATH="$PATH:${shown}" # ${PATH_MARK}: the protoboard command (added by Protoboard; delete this line to undo)`;
  }
  let text = "";
  try {
    text = exists(file) ? read(file) : "";
  } catch {
    text = "";
  }
  if (text.includes(PATH_MARK)) return { kind: "already", dir, where: file };
  return { kind: "profile", dir, file, line, shell };
}

/** One sentence that says what a plan changes, for the question asked before it is applied. */
export function describePathPlan(plan: PathPlan): string {
  switch (plan.kind) {
    case "already":
      return plan.where === "PATH" ? `${plan.dir} is on PATH already.` : `${plan.where} already adds ${plan.dir} to PATH: terminals opened from now on have it.`;
    case "profile":
      return `Adds one line to the end of ${plan.file} that puts ${plan.dir} at the end of PATH (deleting the line undoes it). Terminals opened afterwards have the protoboard command.`;
    case "windows":
      return `Adds ${plan.dir} to the end of your user Path (your own environment variables; no administrator rights). Terminals opened afterwards have the protoboard command.`;
  }
}

export interface PathApplied {
  changed: boolean;
  /** One line for the person. */
  message: string;
}

/** Do what the plan says. Only after the user said yes. */
export function applyPathPlan(
  plan: PathPlan,
  io: { append?: (file: string, text: string) => void; run?: Run; /** Windows: the variables a stored entry such as `%USERPROFILE%\x` is read with. */ env?: NodeJS.ProcessEnv } = {},
): PathApplied {
  if (plan.kind === "already") return { changed: false, message: describePathPlan(plan) };
  if (plan.kind === "profile") {
    const append =
      io.append ??
      ((file: string, text: string) => {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, text);
      });
    append(plan.file, `\n${plan.line}\n`);
    return { changed: true, message: `${plan.file} now puts ${plan.dir} at the end of PATH. Open a new terminal to use the protoboard command.` };
  }
  const run = io.run ?? runPowerShell;
  const byHand = 'Add it yourself: Settings > System > About > Advanced system settings > Environment Variables > Path (under "User variables") > New.';
  const edited = editUserPath(plan.command, (stored) => addToPathValue(stored, plan.dir, io.env ?? process.env), run);
  if ("error" in edited) throw new Error(`could not add ${plan.dir} to your user Path (${edited.error}). ${byHand}`);
  return { changed: edited.changed, message: edited.changed ? `${plan.dir} is on your user Path now. Open a new terminal to use the protoboard command.` : `${plan.dir} was on your user Path already.` };
}

type RunResult = { status: number | null; stdout: string; stderr: string; error?: Error };
type Run = (command: string, args: string[]) => RunResult;

/** The environment for Windows PowerShell started from here: PowerShell 7's `PSModulePath` left out, so it loads its own modules whatever terminal this runs in. */
export function powerShellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
}

const runPowerShell: Run = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 30_000, env: powerShellEnv() });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error } : {}) };
};

/** Read the stored user Path, change its text with `edit`, and write it back with the type it had. Nothing is written when `edit` changes nothing. */
function editUserPath(command: string, edit: (stored: string | undefined) => { value: string; changed: boolean }, run: Run): { changed: boolean } | { error: string } {
  const failed = (r: RunResult) => (r.error?.message ?? r.stderr.trim()) || `PowerShell exited ${r.status}`;
  const read = run(command, [...POWERSHELL_FLAGS, readUserPathScript()]);
  if (read.error || read.status !== 0) return { error: failed(read) };
  const now = parseUserPath(read.stdout);
  if (!now) return { error: "the user Path could not be read" };
  // a Path stored as anything but text is not ours to rewrite
  if (now.kind !== "missing" && now.kind !== "String" && now.kind !== "ExpandString") return { error: `the user Path is stored as ${now.kind}, not as text` };
  const next = edit("value" in now ? now.value : undefined);
  if (!next.changed) return { changed: false };
  // a Path that does not exist yet is created the way Windows creates it: expandable
  const wrote = run(command, [...POWERSHELL_FLAGS, writeUserPathScript(next.value, now.kind === "String" ? "String" : "ExpandString")]);
  if (wrote.error || wrote.status !== 0) return { error: failed(wrote) };
  return { changed: true };
}

/**
 * Take `dir` out of the Windows user `Path` again: only that folder's entry
 * goes, the rest and the value's registry type stay as they were.
 */
export function removeFromUserPath(dir: string, look: Pick<PathLook, "env"> = {}, io: { run?: Run } = {}): PathApplied {
  const env = look.env ?? process.env;
  const root = env.SystemRoot ?? env.windir ?? "C:\\Windows";
  const edited = editUserPath(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, (stored) => removeFromPathValue(stored, dir, env), io.run ?? runPowerShell);
  if ("error" in edited) throw new Error(`could not take ${dir} out of your user Path (${edited.error}). Remove it yourself: Settings > System > About > Advanced system settings > Environment Variables > Path (under "User variables").`);
  return { changed: edited.changed, message: edited.changed ? `${dir} is no longer on your user Path.` : `${dir} was not on your user Path.` };
}

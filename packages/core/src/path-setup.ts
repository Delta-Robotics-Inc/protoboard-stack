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
 *   environment, no administrator rights), through PowerShell.
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
  /** A PowerShell command that adds the folder to the user's Path. */
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
    const d = dir.replace(/'/g, "''");
    // the user's own Path (HKCU\Environment): read, the folder appended when it is not one of its entries, written back
    const script = `$d='${d}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $p) { $p='' }; if (($p -split ';' | ForEach-Object { $_.TrimEnd('\\') }) -notcontains $d.TrimEnd('\\')) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User'); 'added' } else { 'already' }`;
    const root = env.SystemRoot ?? env.windir ?? "C:\\Windows";
    return { kind: "windows", dir, command: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ["-NoProfile", "-NonInteractive", "-Command", script] };
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
  io: { append?: (file: string, text: string) => void; run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error } } = {},
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
  const run =
    io.run ??
    ((command: string, args: string[]) => {
      const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error } : {}) };
    });
  const r = run(plan.command, plan.args);
  if (r.error || r.status !== 0) throw new Error(`could not add ${plan.dir} to your user Path (${(r.error?.message ?? r.stderr.trim()) || `PowerShell exited ${r.status}`}). Add it yourself: Settings > System > About > Advanced system settings > Environment Variables > Path (under "User variables") > New.`);
  const added = !/already/.test(r.stdout);
  return { changed: added, message: added ? `${plan.dir} is on your user Path now. Open a new terminal to use the protoboard command.` : `${plan.dir} was on your user Path already.` };
}

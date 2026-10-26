/**
 * Choosing the Python that creates a project's Python runtime (PB-943).
 *
 * `python3` on PATH is not always a Python that can make a virtual
 * environment: on macOS 26.2 every Homebrew Python has a `pyexpat` linked
 * against a newer libexpat than the system's, so `ensurepip` and `venv` fail
 * with a traceback. `protoboard tools install` therefore looks at every
 * Python it can find and tests each one: its version is one the runtime's
 * pins support, and `venv`, `ensurepip`, `pyexpat`, `ssl` and `zlib` import
 * (what creating a venv and installing wheels into it needs). The first that
 * passes is used. When none passes, the message lists what was tried and why
 * each was refused, and says what to run on this platform. Nothing is
 * downloaded here.
 *
 * This file imports only Node built-ins and uses only erasable TypeScript,
 * so Node runs it as it is (scripts/macos-probe.mjs, on a runner that has
 * not installed the workspace).
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";

/** A range of Python versions: `min` included, `below` excluded (`>=3.11,<3.15`). */
export interface PythonRange {
  min?: [number, number];
  below?: [number, number];
}

const RANGE_PART = /^(>=|<)\s*(\d+)\.(\d+)$/;

/** A `>=3.11,<3.15` range, or undefined when the text is not one. */
export function parsePythonRange(text: string): PythonRange | undefined {
  const range: PythonRange = {};
  for (const part of text.split(",").map((p) => p.trim())) {
    const m = RANGE_PART.exec(part);
    if (!m) return undefined;
    const v: [number, number] = [Number(m[2]), Number(m[3])];
    if (m[1] === ">=") range.min = v;
    else range.below = v;
  }
  return range.min || range.below ? range : undefined;
}

const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];

/** The versions every one of the ranges allows. */
export function intersectPythonRanges(ranges: (PythonRange | undefined)[]): PythonRange {
  const out: PythonRange = {};
  for (const r of ranges) {
    if (r?.min && (!out.min || cmp(r.min, out.min) > 0)) out.min = r.min;
    if (r?.below && (!out.below || cmp(r.below, out.below) < 0)) out.below = r.below;
  }
  return out;
}

export function formatPythonRange(r: PythonRange): string {
  const parts = [...(r.min ? [`${r.min.join(".")} or later`] : []), ...(r.below ? [`before ${r.below.join(".")}`] : [])];
  return parts.join(", ") || "any version";
}

export function pythonInRange(version: string, r: PythonRange): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const v: [number, number] = [Number(m[1]), Number(m[2])];
  return (!r.min || cmp(v, r.min) >= 0) && (!r.below || cmp(v, r.below) < 0);
}

/** The minor versions of a range, the ones most likely to have wheels first (3.12, 3.13, then the rest, newest last tried). */
export function minorsOf(r: PythonRange): string[] {
  const min = r.min ?? [3, 9];
  const below = r.below ?? [3, 16];
  const all: number[] = [];
  for (let m = min[1]; min[0] === 3 && below[0] === 3 && m < below[1]; m++) all.push(m);
  const rank = (m: number) => (m === 12 ? 0 : m === 13 ? 1 : m === 11 ? 2 : 3 + Math.abs(m - 12));
  return all.sort((a, b) => rank(a) - rank(b)).map((m) => `3.${m}`);
}

/** A Python to try: how to run it and where it was looked for. */
export interface PythonCandidate {
  command: string;
  /** Arguments before the script's (`py -3.12`). */
  args: string[];
  /** For messages: `--python`, `PATH`, `Homebrew`, `python.org`, `uv`, `pyenv`, `the py launcher`. */
  from: string;
}

export interface PythonLookup {
  /** `--python`: tried first, and alone decides when it works. */
  explicit?: string;
  range?: PythonRange;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
  list?: (dir: string) => string[];
}

/**
 * Every Python worth trying, in order: `--python`; `python3` and `python` on
 * PATH; `python3.12`, `python3.13`, … on PATH; then, by full path, Homebrew's
 * (Apple Silicon and Intel), python.org's framework builds, uv's and pyenv's
 * managed ones, and on Windows the `py` launcher and the per-user installs.
 * Names on PATH are left for the system to resolve; paths are listed only
 * when the file exists.
 */
export function pythonCandidates(look: PythonLookup = {}): PythonCandidate[] {
  const env = look.env ?? process.env;
  const platform = look.platform ?? process.platform;
  const home = look.home ?? homedir();
  const exists = look.exists ?? existsSync;
  const list = (dir: string): string[] => {
    try {
      return (look.list ?? ((d: string) => readdirSync(d)))(dir);
    } catch {
      return [];
    }
  };
  const win = platform === "win32";
  const j = (...parts: string[]) => parts.join(win ? "\\" : "/");
  const minors = minorsOf(look.range ?? {});
  const out: PythonCandidate[] = [];
  const seen = new Set<string>();
  const add = (command: string, from: string, args: string[] = []) => {
    const key = [command, ...args].join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ command, args, from });
  };
  const file = (path: string, from: string) => {
    if (exists(path)) add(path, from);
  };

  if (look.explicit?.trim()) add(look.explicit.trim(), "--python");

  // names on PATH: only the ones PATH has (so the list says what was really tried)
  const dirs = (env.PATH ?? env.Path ?? "").split(look.platform ? (win ? ";" : ":") : delimiter).filter(Boolean);
  const onPath = (name: string) => dirs.some((d) => (win ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name]).some((n) => exists(j(d, n))));
  for (const name of win ? ["python", "python3"] : ["python3", "python"]) if (onPath(name)) add(name, "PATH");
  for (const v of minors) if (onPath(`python${v}`)) add(`python${v}`, "PATH");

  if (win) {
    // the launcher picks an installed version by number
    if (onPath("py")) for (const v of minors) add("py", "the py launcher", [`-${v}`]);
    const local = env.LOCALAPPDATA ?? j(home, "AppData", "Local");
    for (const v of minors) {
      const n = v.replace(".", "");
      file(j(local, "Programs", "Python", `Python${n}`, "python.exe"), "python.org");
      file(j(env.ProgramFiles ?? "C:\\Program Files", `Python${n}`, "python.exe"), "python.org");
    }
  } else {
    for (const prefix of ["/opt/homebrew", "/usr/local"]) {
      for (const v of minors) file(`${prefix}/opt/python@${v}/bin/python${v}`, "Homebrew");
      for (const v of minors) file(`${prefix}/bin/python${v}`, prefix === "/opt/homebrew" ? "Homebrew" : "/usr/local/bin");
      file(`${prefix}/bin/python3`, prefix === "/opt/homebrew" ? "Homebrew" : "/usr/local/bin");
    }
    if (platform === "darwin") {
      for (const v of minors) file(`/Library/Frameworks/Python.framework/Versions/${v}/bin/python${v}`, "python.org");
      file("/usr/bin/python3", "Xcode Command Line Tools");
    }
  }

  // uv's managed Pythons (`uv python install`): standalone builds, each in its own folder
  const uvDirs = win
    ? [j(env.APPDATA ?? j(home, "AppData", "Roaming"), "uv", "python")]
    : [...(env.UV_PYTHON_INSTALL_DIR ? [env.UV_PYTHON_INSTALL_DIR] : []), ...(env.XDG_DATA_HOME ? [j(env.XDG_DATA_HOME, "uv", "python")] : []), j(home, ".local", "share", "uv", "python"), j(home, "Library", "Application Support", "uv", "python")];
  for (const dir of uvDirs) {
    const names = list(dir).filter((n) => /^cpython-\d+\.\d+/.test(n));
    for (const v of minors) {
      // the newest patch of this minor
      const of = names.filter((n) => n.startsWith(`cpython-${v}.`) || n.startsWith(`cpython-${v}-`)).sort((a, b) => patchOf(b) - patchOf(a));
      for (const n of of) file(win ? j(dir, n, "python.exe") : j(dir, n, "bin", `python${v}`), "uv");
    }
  }
  // pyenv's
  const pyenvRoot = env.PYENV_ROOT ?? j(home, win ? ".pyenv\\pyenv-win" : ".pyenv");
  const pyenvVersions = list(j(pyenvRoot, "versions"));
  for (const v of minors) {
    for (const n of pyenvVersions.filter((x) => x.startsWith(`${v}.`)).sort((a, b) => patchOf(b) - patchOf(a))) file(win ? j(pyenvRoot, "versions", n, "python.exe") : j(pyenvRoot, "versions", n, "bin", "python"), "pyenv");
  }
  return out;
}

/** The patch number in `cpython-3.12.7-macos-aarch64-none` or `3.12.7`. */
function patchOf(name: string): number {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(name);
  return m ? Number(m[3]) : -1;
}

/** What a candidate turned out to be. */
export interface PythonProbe extends PythonCandidate {
  ok: boolean;
  /** `3.12.7`, when it ran. */
  version?: string;
  /** `sys.executable`, when it ran. */
  executable?: string;
  /** Why it was refused, in a few words. */
  reason?: string;
}

/**
 * What the probe runs: the version, and whether the modules import that a
 * venv with pip needs. `pyexpat` is the one Homebrew's Python on macOS 26.2
 * fails on (pip's vendored code imports it; `ensurepip` then dies).
 */
export const PYTHON_PROBE = [
  "import json, os, sys",
  // the real file: `python3` and `python3.12` on PATH are often one interpreter, and count once
  "r = {'version': '%d.%d.%d' % sys.version_info[:3], 'executable': os.path.realpath(sys.executable), 'failed': {}}",
  "for m in ('venv', 'ensurepip', 'pyexpat', 'ssl', 'zlib'):",
  "    try:",
  "        __import__(m)",
  "    except BaseException as e:",
  "        r['failed'][m] = '%s: %s' % (type(e).__name__, str(e).splitlines()[0][:160] if str(e) else '')",
  "print(json.dumps(r))",
].join("\n");

/** Runs a command; resolves with stdout, rejects with an Error whose message is what went wrong. */
export type PythonExec = (command: string, args: string[]) => Promise<string>;

const defaultExec: PythonExec = (command, args) =>
  new Promise((ok, fail) => {
    execFile(command, args, { encoding: "utf8", timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return ok(stdout);
      const code = (err as NodeJS.ErrnoException).code;
      fail(new Error(code === "ENOENT" ? "not found" : (stderr || err.message).trim().split("\n").pop() ?? "failed"));
    });
  });

export async function probePython(c: PythonCandidate, range: PythonRange = {}, exec: PythonExec = defaultExec): Promise<PythonProbe> {
  let out: string;
  try {
    out = await exec(c.command, [...c.args, "-c", PYTHON_PROBE]);
  } catch (e) {
    return { ...c, ok: false, reason: (e as Error).message.slice(0, 200) };
  }
  let r: { version?: string; executable?: string; failed?: Record<string, string> };
  try {
    r = JSON.parse(out.trim().split("\n").pop() ?? "");
  } catch {
    return { ...c, ok: false, reason: "did not answer like a Python 3" };
  }
  const base = { ...c, ...(r.version ? { version: r.version } : {}), ...(r.executable ? { executable: r.executable } : {}) };
  if (!r.version) return { ...base, ok: false, reason: "did not say its version" };
  if (!pythonInRange(r.version, range)) return { ...base, ok: false, reason: `Python ${r.version}; the packages need ${formatPythonRange(range)}` };
  const failed = Object.entries(r.failed ?? {});
  if (failed.length) return { ...base, ok: false, reason: `cannot import ${failed.map(([m, why]) => `${m} (${why})`).join(", ")}` };
  return { ...base, ok: true };
}

export interface PythonSelection {
  /** The working Pythons, in the order to use them (two candidates that are the same interpreter count once). */
  working: PythonProbe[];
  /** Every candidate, with why the refused ones were refused. */
  tried: PythonProbe[];
}

/**
 * Probe the candidates. A `--python` that works is the only one used: the
 * user chose it. One that does not work is reported, and the others are
 * tried.
 */
export async function selectPython(look: PythonLookup = {}, exec: PythonExec = defaultExec): Promise<PythonSelection> {
  const tried: PythonProbe[] = [];
  const working: PythonProbe[] = [];
  const executables = new Set<string>();
  for (const c of pythonCandidates(look)) {
    const p = await probePython(c, look.range ?? {}, exec);
    tried.push(p);
    if (!p.ok) continue;
    if (p.executable && executables.has(p.executable)) continue;
    if (p.executable) executables.add(p.executable);
    working.push(p);
    if (c.from === "--python") break;
  }
  return { working, tried };
}

const shown = (c: PythonCandidate) => [c.command, ...c.args].join(" ");

/** One line per candidate tried: what it is and why it was refused (or that it works). */
export function describeTried(tried: PythonProbe[]): string[] {
  return tried.map((p) => `  ${shown(p)} (${p.from})${p.version ? `, Python ${p.version}` : ""}: ${p.ok ? "works" : p.reason}`);
}

/**
 * What to say when no Python can create the runtime: what was tried and why
 * each failed, then what to run on this platform. `command` is how the
 * install was asked for (`protoboard tools install cad`).
 */
export function noPythonMessage(tried: PythonProbe[], range: PythonRange, platform: NodeJS.Platform = process.platform, command = "protoboard tools install <runtime>"): string {
  const want = minorsOf(range)[0] ?? "3.12";
  const lines = [`no Python that can create this runtime was found (it needs Python ${formatPythonRange(range)}, with working venv, ensurepip, pyexpat, ssl and zlib modules).`];
  if (tried.length) lines.push("Tried:", ...describeTried(tried));
  else lines.push("No Python was found on PATH or in the usual places.");
  const broken = tried.some((p) => /pyexpat/.test(p.reason ?? ""));
  if (platform === "darwin") {
    if (broken) lines.push("Homebrew's Python on this macOS has a pyexpat that does not load (it is linked against a newer libexpat than the system's), so it cannot create a venv.");
    lines.push(
      "Install a standalone Python and run the install again:",
      `  brew install uv && uv python install ${want}`,
      `  ${command}`,
      `(uv's Pythons are found by themselves. The installer from https://www.python.org/downloads/macos/ works too; or name any working one with --python <path>.)`,
    );
  } else if (platform === "win32") {
    lines.push("Install Python and run the install again:", `  winget install Python.Python.${want}`, `  ${command}`, `(or: winget install astral-sh.uv, then uv python install ${want}; or name a working one with --python <path>.)`);
  } else {
    lines.push(
      "Install Python with its venv module and run the install again:",
      `  sudo apt install python3 python3-venv        (Debian, Ubuntu; other distributions: their python3 package)`,
      `  ${command}`,
      `(or a standalone one: install uv from https://docs.astral.sh/uv/, then uv python install ${want}; or name a working one with --python <path>.)`,
    );
  }
  return lines.join("\n");
}

/**
 * Stack copies outside a project (PB-929, docs/specs/distribution.md, "How a
 * project finds its packages").
 *
 * The usual way a project gets the stack is `npm install`: its package.json
 * names the packages and npm fetches them from a registry (the CLI route).
 * The VS Code extension carries a complete copy of the stack so that a person
 * with no registry access, and no Node.js, can work too. That copy is unpacked
 * once per version into the user's Protoboard folder:
 *
 *   <home>/stack/<version>/node_modules/…    one installed tree per version
 *   <home>/stack/<version>/protoboard-stack.json   what it is and where it came from
 *   <home>/bin/protoboard                    the command for terminals (the extension adds <home>/bin to their PATH)
 *   <home>/runtime                           the Node.js to fall back on: VS Code's own runtime (one line, a path)
 *
 * `<home>` is `~/.protoboard`, or `PROTOBOARD_HOME`.
 *
 * A project uses such a copy through LINKS: `linkProject` puts a link in the
 * project's `node_modules` for each stack package its package.json names
 * (a directory symlink; a junction on Windows, which needs no privilege), and
 * writes `node_modules/.bin/protoboard`. Node resolves a linked package at its
 * real location, so everything the package needs comes from the stack copy,
 * and the project's own sources and its vendored part sources all load the
 * one `@deltarobotics/uhd` of that copy.
 *
 * Links never replace what npm installed: a real folder in `node_modules`
 * stays. A later `npm install` keeps each link whose version package.json's
 * range accepts (and adds the packages a stack copy does not provide:
 * typescript, @types/node), and fetches from a registry the ones whose range
 * asks for another version. No VS Code API here.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { ensurePrivateDir } from "./private-dir.js";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStamp, type BuildStamp } from "./build-info.js";

/** The marker at the root of a stack copy. */
export const STACK_MARKER = "protoboard-stack.json";
/** Written into a project's node_modules by `linkProject`. */
export const LINK_RECORD = ".protoboard-stack.json";
/** The first line of every command script this module writes, so one of ours is recognised (and only ours replaced). */
export const SHIM_MARK = "protoboard-stack-shim";

/** What `protoboard-stack.json` says. */
export interface StackMarker {
  schema: "protoboard.stack/v1";
  /** The stack version: the version of @protoboardai/cli in it. */
  version: string;
  /** Where the copy came from: carried in a .vsix, or installed from a registry by `protoboard stack install`. */
  source: "vsix" | "registry";
  /** Package name → version, for the stack's own packages. */
  packages: Record<string, string>;
  /** vsix: the digest of the archive it was unpacked from (a rebuilt .vsix of the same version replaces the copy). */
  digest?: string;
  /** vsix: the platform whose native modules were unpacked (`linux-x64`). */
  platform?: string;
  /** registry: the registry it was installed from. */
  registry?: string;
  /** What the build was made from (build-info.ts): stamped into a carried stack's stack.json at package time. */
  build?: BuildStamp;
  installedAt: string;
}

export interface Stack {
  /** The copy's folder (`<home>/stack/<version>`). */
  dir: string;
  marker: StackMarker;
}

/** The user's Protoboard folder: `PROTOBOARD_HOME`, else `~/.protoboard`. */
export function stackHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.PROTOBOARD_HOME ? resolve(env.PROTOBOARD_HOME) : join(home, ".protoboard");
}

/** Where a version's copy lives. */
export const stackDir = (home: string, version: string) => join(home, "stack", version);

/** The CLI's entry in a stack copy. */
export const stackCli = (dir: string) => join(dir, "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs");

export function readStack(dir: string): Stack | undefined {
  try {
    const marker = JSON.parse(readFileSync(join(dir, STACK_MARKER), "utf8")) as StackMarker;
    return marker?.schema === "protoboard.stack/v1" && typeof marker.version === "string" && existsSync(stackCli(dir)) ? { dir, marker } : undefined;
  } catch {
    return undefined;
  }
}

/** The complete copies in `<home>/stack`, newest version first. */
export function listStacks(home: string = stackHome()): Stack[] {
  let names: string[];
  try {
    names = readdirSync(join(home, "stack"));
  } catch {
    return [];
  }
  return names
    .map((n) => readStack(join(home, "stack", n)))
    .filter((s): s is Stack => !!s)
    .sort((a, b) => compareVersions(b.marker.version, a.marker.version));
}

/**
 * The stack copy this code runs from, when it does: this file is then
 * `<copy>/node_modules/@protoboardai/core/src/stack.ts`. Undefined in a
 * project's own `npm install` and in the stack's repository.
 */
export function carriedStack(from?: string): Stack | undefined {
  let real: string;
  try {
    // bundled into CommonJS (the VS Code extension) this file has no URL: it is then not in a stack copy either
    // the folder, not the file: when this module is bundled, its source path names a file that is not there,
    // while its folder is
    const self = from ?? fileURLToPath(import.meta.url);
    real = join(realpathSync(dirname(self)), basename(self));
  } catch {
    return undefined;
  }
  // …/node_modules/@protoboardai/core/src/stack.ts → the folder that holds node_modules
  const modules = dirname(dirname(dirname(dirname(real))));
  return /[\\/]node_modules$/.test(modules) ? readStack(dirname(modules)) : undefined;
}

// ---------------------------------------------------------------- versions

const parts = (v: string) => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  return m ? { n: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] as [number, number, number], pre: m[4] } : undefined;
};

/** Negative when a is older than b. A prerelease is older than its release. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  if (!x || !y) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/**
 * Whether a version satisfies a package.json range, for the ranges projects
 * carry: `^1.2.3` (what `init` writes), `~1.2.3`, `1.2.3`, `>=1.2.3`, `*`,
 * `latest` and `x` ranges. Anything else (a tag, a URL, a compound range)
 * is "cannot tell": undefined.
 */
export function satisfies(version: string, range: string): boolean | undefined {
  const r = range.trim();
  const v = parts(version);
  if (!v) return undefined;
  if (r === "" || r === "*" || r === "latest" || r === "x") return true;
  const m = /^(\^|~|>=|=)?\s*v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?$/.exec(r);
  if (!m) return undefined;
  const op = m[1] ?? "";
  const wild = (s: string | undefined) => s === undefined || s === "x" || s === "*";
  const [M, mi, pa] = [m[2], m[3], m[4]];
  if (wild(M)) return true;
  const want: [number, number, number] = [Number(M), wild(mi) ? 0 : Number(mi), wild(pa) ? 0 : Number(pa)];
  const base = `${want[0]}.${want[1]}.${want[2]}${/-/.test(r) ? r.slice(r.indexOf("-")) : ""}`;
  const atLeast = compareVersions(version, base) >= 0;
  if (op === ">=") return atLeast;
  if (wild(mi)) return v.n[0] === want[0];
  if (wild(pa) || op === "~") return v.n[0] === want[0] && v.n[1] === want[1] && atLeast;
  if (op === "^") {
    // ^0.1.3 allows 0.1.x only; ^0.0.3 exactly that patch; ^1.2.3 anything in 1.x
    if (want[0] > 0) return v.n[0] === want[0] && atLeast;
    if (want[1] > 0) return v.n[0] === 0 && v.n[1] === want[1] && atLeast;
    return v.n[0] === 0 && v.n[1] === 0 && v.n[2] === want[2] && atLeast;
  }
  return compareVersions(version, base) === 0;
}

// ---------------------------------------------------------------- a project and its packages

/** The scopes a stack copy provides to projects. */
const STACK_SCOPES = ["@protoboardai/", "@deltarobotics/"];
export const isStackPackage = (name: string) => STACK_SCOPES.some((s) => name.startsWith(s));

/**
 * Type packages a stack copy carries for the projects it sets up: a project's
 * tsconfig names them, and with no `npm install` nothing else brings them.
 * Types only: a project's own tools (typescript and the rest) still come from
 * npm.
 */
export const TYPES_FROM_STACK = ["@types/node"];

/** What a project's package.json asks for: name → range, dependencies and devDependencies together. */
export function projectDependencies(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  } catch {
    return {};
  }
}

/** The stack version a project pins: the range of `@protoboardai/cli`, else of `@protoboardai/core`. */
export function projectStackRange(root: string): string | undefined {
  const deps = projectDependencies(root);
  return deps["@protoboardai/cli"] ?? deps["@protoboardai/core"];
}

/** How one package stands in a project's node_modules. */
export type PackageState =
  /** A real folder: npm (or a person) put it there. Never touched. */
  | "installed"
  /** A link to a stack copy that is there. */
  | "linked"
  /** A link whose target is gone (a deleted copy, a project moved from another machine). */
  | "broken-link"
  | "missing";

export function packageState(root: string, name: string): { state: PackageState; target?: string } {
  const p = join(root, "node_modules", ...name.split("/"));
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return { state: "missing" };
  }
  if (!st.isSymbolicLink()) return { state: "installed" };
  try {
    return { state: "linked", target: realpathSync(p) };
  } catch {
    return { state: "broken-link" };
  }
}

/** What `node_modules/.protoboard-stack.json` records. */
export interface LinkRecord {
  schema: "protoboard.stack-link/v1";
  stack: string;
  version: string;
  linked: string[];
  at: string;
}

export function readLinkRecord(root: string): LinkRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(join(root, "node_modules", LINK_RECORD), "utf8")) as LinkRecord;
    return r?.schema === "protoboard.stack-link/v1" ? r : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a project needs its packages from a stack copy: it has a
 * package.json that names stack packages and at least one of them is neither
 * installed nor linked to a copy that exists. A project whose packages npm
 * installed, and a folder with no package.json, need nothing.
 */
export function needsLink(root: string): boolean {
  const names = Object.keys(projectDependencies(root)).filter(isStackPackage);
  return names.some((n) => {
    const s = packageState(root, n).state;
    return s === "missing" || s === "broken-link";
  });
}

export interface LinkResult {
  root: string;
  stack: string;
  version: string;
  /** Packages now linked to the stack copy. */
  linked: string[];
  /** Of those, the links this call made (the rest were there). */
  made: string[];
  /** Packages left alone because a real folder is there (an `npm install`). */
  installed: string[];
  /** Stack packages the project names that the copy does not have. */
  notInStack: string[];
  /** Other packages the project names (typescript, @types/node…): only `npm install` brings them. */
  notProvided: string[];
  /** The project's range for the stack, and whether this copy satisfies it (undefined: cannot tell). */
  range?: string;
  satisfied?: boolean;
  /** Command scripts written into node_modules/.bin. */
  commands: string[];
}

/**
 * Link a project's stack packages to a stack copy, and write
 * `node_modules/.bin/protoboard` (and `pb`). `force` re-points links that
 * already lead to another copy (updating a project to a newer stack); real
 * folders are never replaced.
 */
export function linkProject(root: string, stack: Stack, options: { force?: boolean; platform?: NodeJS.Platform; home?: string; now?: string } = {}): LinkResult {
  const platform = options.platform ?? process.platform;
  const deps = projectDependencies(root);
  const range = deps["@protoboardai/cli"] ?? deps["@protoboardai/core"];
  const result: LinkResult = { root, stack: stack.dir, version: stack.marker.version, linked: [], made: [], installed: [], notInStack: [], notProvided: [], commands: [], ...(range ? { range } : {}) };
  if (range) {
    const ok = satisfies(stack.marker.version, range);
    if (ok !== undefined) result.satisfied = ok;
  }
  const modules = join(root, "node_modules");
  const carried = (name: string) => existsSync(join(stack.dir, "node_modules", ...name.split("/"), "package.json"));
  // the type packages the copy carries, which a project's tsconfig names (`types: ["node"]`, as `protoboard init`
  // and the examples write it): linked too, whether package.json lists them or not, so the editor type-checks a
  // project that Initialize set up with no npm (UI QA phase 2; B16)
  const names = [...new Set([...Object.keys(deps), ...(Object.keys(deps).some(isStackPackage) ? TYPES_FROM_STACK.filter(carried) : [])])].sort();
  for (const name of names) {
    if (!isStackPackage(name) && !(TYPES_FROM_STACK.includes(name) && carried(name))) {
      if (packageState(root, name).state !== "installed") result.notProvided.push(name);
      continue;
    }
    const target = join(stack.dir, "node_modules", ...name.split("/"));
    if (!existsSync(join(target, "package.json"))) {
      result.notInStack.push(name);
      continue;
    }
    const at = join(modules, ...name.split("/"));
    const now = packageState(root, name);
    if (now.state === "installed") {
      result.installed.push(name);
      continue;
    }
    if (now.state === "linked") {
      if (now.target === realpathSync(target) || !options.force) {
        result.linked.push(name);
        continue;
      }
    }
    if (now.state !== "missing") rmSync(at, { force: true, recursive: false });
    mkdirSync(dirname(at), { recursive: true });
    // a junction needs no privilege on Windows and takes an absolute target
    symlinkSync(target, at, platform === "win32" ? "junction" : "dir");
    result.linked.push(name);
    result.made.push(name);
  }
  // the project's own command, as npm would have written it: only when the CLI is one of the links
  if (result.linked.includes("@protoboardai/cli")) {
    const home = options.home ?? dirname(dirname(stack.dir));
    result.commands = writeCommands(join(modules, ".bin"), { kind: "project", cli: stackCli(stack.dir), home, platform });
  }
  if (result.linked.length) {
    const record: LinkRecord = { schema: "protoboard.stack-link/v1", stack: stack.dir, version: stack.marker.version, linked: result.linked, at: options.now ?? new Date().toISOString() };
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(modules, LINK_RECORD), JSON.stringify(record, null, 2) + "\n");
  }
  return result;
}

/**
 * Take back what one `linkProject` call made, when every link is its own (a
 * project that had none): the links, the command scripts, the record, and
 * the folders left empty. For a command that linked a project to read its
 * configuration and was then refused (sign-in required): the project is left
 * as it was. Links that were there before the call stay, with everything else.
 */
export function unlinkProject(r: LinkResult): void {
  if (!r.made.length || r.made.length !== r.linked.length) return;
  const modules = join(r.root, "node_modules");
  const quiet = (fn: () => void) => {
    try {
      fn();
    } catch {
      // not there, or not empty: left alone
    }
  };
  for (const name of r.made) {
    const at = join(modules, ...name.split("/"));
    quiet(() => {
      // a link only (a junction is one too): never a real folder
      if (lstatSync(at).isSymbolicLink()) rmSync(at, { force: true, recursive: false });
    });
  }
  const bin = join(modules, ".bin");
  for (const c of r.commands) {
    const file = join(bin, c.split(/[\\/]/).pop()!);
    if (existsSync(file) && ours(file)) quiet(() => rmSync(file, { force: true }));
  }
  quiet(() => rmSync(join(modules, LINK_RECORD), { force: true }));
  for (const dir of [bin, ...new Set(r.made.filter((n) => n.includes("/")).map((n) => join(modules, n.split("/")[0]!))), modules]) quiet(() => rmdirSync(dir));
}

/** One line about a link, for the CLI and the extension's log. */
export function linkSummary(r: LinkResult): string {
  const bits = [`${r.linked.length} package(s) in node_modules are links to the Protoboard stack ${r.version} at ${r.stack}`];
  if (r.installed.length) bits.push(`${r.installed.length} installed by npm were left as they are`);
  if (r.notInStack.length) bits.push(`not in that stack: ${r.notInStack.join(", ")}`);
  if (r.range && r.satisfied === false) bits.push(`package.json asks for ${r.range}`);
  return bits.join("; ");
}

// ---------------------------------------------------------------- the command scripts

export interface CommandOptions {
  /**
   * `home`: `<home>/bin/protoboard`, for terminals: runs the project's own
   * command when the project it is run in (the nearest folder up with a
   * protoboard.config.ts) has one in its node_modules/.bin, else `cli`.
   * `project`: `node_modules/.bin/protoboard`: runs `cli`.
   */
  kind: "home" | "project";
  /** The CLI entry (`…/bin/protoboard.mjs`) to run. */
  cli: string;
  /** The user's Protoboard folder (`<home>/runtime` names the fallback runtime). */
  home: string;
  platform?: NodeJS.Platform;
}

const NEED_NODE =
  "protoboard: no Node.js 22 or later was found, and VS Code's own runtime is not where it was. Open a Protoboard project in VS Code once (the extension records its runtime), or install Node.js 22 or later (https://nodejs.org/en/download; macOS: brew install node; Windows: winget install OpenJS.NodeJS.LTS).";

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The POSIX script. `node` 22 or later when there is one; else the runtime `<home>/runtime` names (VS Code's), as Node. */
export function shellCommand(o: CommandOptions): string {
  return [
    "#!/bin/sh",
    `# ${SHIM_MARK}: written by Protoboard (docs/specs/distribution.md). Runs the Protoboard CLI below with Node.js 22 or`,
    "# later when one is on PATH, else with the runtime VS Code brings (the path in <home>/runtime, run as Node).",
    `CLI=${sq(o.cli)}`,
    `PBHOME=${sq(o.home)}`,
    ...(o.kind === "home"
      ? [
          "# a project's own command wins: the one in the project's node_modules/.bin, the project being the nearest",
          "# folder from here up with a protoboard.config.ts; nothing above that folder is looked at (PB-1048)",
          "d=$PWD",
          'while [ -n "$d" ]; do',
          '  if [ -f "$d/protoboard.config.ts" ]; then',
          '    if [ -x "$d/node_modules/.bin/protoboard" ]; then exec "$d/node_modules/.bin/protoboard" "$@"; fi',
          "    break",
          "  fi",
          "  d=${d%/*}",
          "done",
        ]
      : []),
    `if [ ! -f "$CLI" ]; then echo "protoboard: $CLI is missing (the stack copy was removed). Open the project in VS Code with the Protoboard extension, or run npm install in the project." >&2; exit 127; fi`,
    `if command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' >/dev/null 2>&1; then exec node "$CLI" "$@"; fi`,
    "RT=",
    'if [ -r "$PBHOME/runtime" ]; then IFS= read -r RT < "$PBHOME/runtime"; fi',
    'if [ -n "$RT" ] && [ -x "$RT" ]; then ELECTRON_RUN_AS_NODE=1 exec "$RT" "$CLI" "$@"; fi',
    `echo ${sq(NEED_NODE)} >&2`,
    "exit 127",
    "",
  ].join("\n");
}

/** The same for cmd.exe (and PowerShell, which runs `.cmd` files). */
export function windowsCommand(o: CommandOptions): string {
  return [
    "@echo off",
    `rem ${SHIM_MARK}: written by Protoboard (docs/specs/distribution.md). Runs the Protoboard CLI below with Node.js 22 or`,
    "rem later when one is on PATH, else with the runtime VS Code brings (the path in <home>\\runtime, run as Node).",
    "setlocal",
    `set "CLI=${o.cli}"`,
    `set "PBHOME=${o.home}"`,
    ...(o.kind === "home"
      ? [
          "rem a project's own command wins: the one in the project's node_modules\\.bin, the project being the nearest",
          "rem folder from here up with a protoboard.config.ts; nothing above that folder is looked at (PB-1048)",
          'set "D=%CD%"',
          ":up",
          'if exist "%D%\\protoboard.config.ts" goto project',
          'for %%I in ("%D%\\..") do set "P=%%~fI"',
          'if not "%P%"=="%D%" ( set "D=%P%" & goto up )',
          "goto run",
          ":project",
          'if exist "%D%\\node_modules\\.bin\\protoboard.cmd" ( endlocal & "%D%\\node_modules\\.bin\\protoboard.cmd" %* & exit /b )',
          ":run",
        ]
      : []),
    'if not exist "%CLI%" ( echo protoboard: %CLI% is missing ^(the stack copy was removed^). Open the project in VS Code with the Protoboard extension, or run npm install in the project. 1>&2 & exit /b 127 )',
    "where node >nul 2>nul && node -e \"process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)\" >nul 2>nul && ( node \"%CLI%\" %* & exit /b )",
    'set "RT="',
    'if exist "%PBHOME%\\runtime" set /p RT=<"%PBHOME%\\runtime"',
    'if defined RT if exist "%RT%" ( set "ELECTRON_RUN_AS_NODE=1" & "%RT%" "%CLI%" %* & exit /b )',
    `echo ${NEED_NODE.replace(/[()&|<>^]/g, "^$&")} 1>&2`,
    "exit /b 127",
    "",
  ].join("\r\n");
}

/** Whether a file is a command script of ours (or is not there): only those are written over. */
function ours(file: string): boolean {
  try {
    if (lstatSync(file).isSymbolicLink()) return false;
    return readFileSync(file, "utf8").slice(0, 400).includes(SHIM_MARK);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Write `protoboard` and `pb` (and their `.cmd` on Windows) into `dir`. Returns the files written. */
export function writeCommands(dir: string, o: CommandOptions): string[] {
  const platform = o.platform ?? process.platform;
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const name of ["protoboard", "pb"]) {
    const sh = join(dir, name);
    if (ours(sh)) {
      writeFileSync(sh, shellCommand(o), { mode: 0o755 });
      if (platform !== "win32") chmodSync(sh, 0o755);
      written.push(sh);
    }
    if (platform === "win32") {
      const cmd = join(dir, `${name}.cmd`);
      if (ours(cmd)) {
        writeFileSync(cmd, windowsCommand(o));
        written.push(cmd);
      }
    }
  }
  return written;
}

// ---------------------------------------------------------------- npm refused by the registry

/** A private Google Artifact Registry npm repository: its sign-in is a pass that lasts one hour. */
const BETA_REGISTRY_HOST = "us-central1-npm.pkg.dev";

/**
 * What npm's E401 or E403 means and what to do (first builds review, item
 * 26: three sessions were stopped by it, each time read as something else).
 * Undefined when the output is not that. The way that needs no registry is
 * named too: the stack the VS Code extension carries.
 */
export function npmAuthProblem(output: string): string | undefined {
  if (!/\bE40[13]\b|\b40[13] (Unauthorized|Forbidden)\b|code E40[13]|authenticat(e|ion) (required|failed)|Unable to authenticate/i.test(output)) return undefined;
  const code = /\bE?(40[13])\b/.exec(output)?.[1] ?? "401";
  const beta = output.includes(BETA_REGISTRY_HOST);
  const noNpm = "Or set the project up without npm and without a registry: the Protoboard VS Code extension carries the stack (Initialize in the Protoboard views), and `protoboard setup` installs that extension.";
  if (beta)
    return `npm got ${code} from ${BETA_REGISTRY_HOST}: the registry pass ran out (it lasts one hour). Get a new one with \`npx google-artifactregistry-auth --repo-config="$HOME/.npmrc" --credential-config="$HOME/.npmrc"\`, then run this again. If it is still refused, your Google account has no access to the registry: ask the person who invited you. ${noNpm}`;
  return `npm got ${code} from the registry: it does not accept this machine's sign-in for the Protoboard packages (\`npm config get @protoboardai:registry\` shows which registry; its token may have run out). Sign in to it again, then run this again. ${noNpm}`;
}

// ---------------------------------------------------------------- the global stack (first builds review, D3)

/** Stack packages a project names that a copy does not hold. */
export function missingFromStack(root: string, stack: Stack): string[] {
  return Object.keys(projectDependencies(root))
    .filter(isStackPackage)
    .filter((name) => !existsSync(join(stack.dir, "node_modules", ...name.split("/"), "package.json")))
    .sort();
}

/** Why a copy is not a project's stack, or undefined when it is. */
export function unfitReason(root: string, stack: Stack): string | undefined {
  const range = projectStackRange(root);
  if (range && satisfies(stack.marker.version, range) === false) return `package.json asks for ${range}`;
  const missing = missingFromStack(root, stack);
  if (missing.length) return `it does not have ${missing.join(", ")}`;
  return undefined;
}

/** Which copy a project links to, and why (PB-1024, PB-1037). */
export interface StackChoice {
  /** The copy to link; undefined when none on this machine fits the project. */
  stack?: Stack;
  /** The version preferred: the running CLI's. */
  preferred?: string;
  /**
   * Set when the copy is not the preferred version: why that one was not
   * taken, for the one line a command prints ("…; linked 0.1.6 instead").
   */
  fallback?: string;
  /** Copies looked at and not taken, each with why. */
  rejected: { version: string; dir: string; reason: string }[];
}

/**
 * The user's global Protoboard for a project. A copy fits when the
 * project's range accepts its version and it holds every stack package the
 * project names. Among those that fit: the copy this code runs from (the VS
 * Code extension's CLI, or a project's command that links to a copy), then
 * the copy of `version` (the running CLI's), then the newest. A carried copy
 * that does not fit is not taken (before PB-1037 it always was): the
 * project then gets another copy that fits, or none, and the ways to get one
 * are offered. A project uses the copy through links (`linkProject`).
 */
export function chooseStack(root: string, options: { home?: string; version?: string; from?: string } = {}): StackChoice {
  const carried = carriedStack(options.from);
  const copies = listStacks(options.home ?? stackHome());
  const all = carried ? [carried, ...copies.filter((s) => s.dir !== carried.dir)] : copies;
  const rejected: StackChoice["rejected"] = [];
  const fits: Stack[] = [];
  for (const s of all) {
    const reason = unfitReason(root, s);
    if (reason) rejected.push({ version: s.marker.version, dir: s.dir, reason });
    else fits.push(s);
  }
  const preferred = options.version ?? carried?.marker.version;
  const stack = (carried && fits.includes(carried) ? carried : undefined) ?? fits.find((s) => s.marker.version === preferred) ?? fits[0];
  const choice: StackChoice = { rejected, ...(stack ? { stack } : {}), ...(preferred ? { preferred } : {}) };
  if (stack && preferred && stack.marker.version !== preferred) {
    const own = rejected.find((r) => r.version === preferred);
    choice.fallback = own ? `the stack ${preferred} (this CLI's) does not fit this project: ${own.reason}` : `the stack ${preferred} (this CLI's) is not in ${join(options.home ?? stackHome(), "stack")}`;
  }
  return choice;
}

/** The copy `chooseStack` takes, or undefined. */
export function globalStack(root: string, options: { home?: string; version?: string; from?: string } = {}): Stack | undefined {
  return chooseStack(root, options).stack;
}

/**
 * One line when the running CLI and the stack copy a project links to are
 * different versions (PB-1024): the project's checks and builds run the
 * linked copy's packages, and this CLI may not read them the same way.
 * Undefined when they match, or the project links to no copy.
 */
export function stackVersionMismatch(root: string, cliVersion: string): string | undefined {
  const record = readLinkRecord(root);
  if (!record || record.version === cliVersion) return undefined;
  return `this CLI is ${cliVersion}, and the project's packages are links to the Protoboard stack ${record.version} (${record.stack}). Run the project's own command (node_modules/.bin/protoboard, or \`npx @protoboardai/cli\`), or link it to this version with \`protoboard stack link --force\` when it is on this machine (\`protoboard stack\` lists the copies).`;
}

// ---------------------------------------------------------------- a copy from a registry (`protoboard stack install`)

export interface InstallStackOptions {
  home?: string;
  /** Registry for the stack's scopes; default: what npm resolves for the project (its .npmrc, the user's). */
  registry?: string;
  /** Runs npm; stubbed in tests. Returns the exit status and what it printed. */
  run?: (args: string[], cwd: string) => { status: number | null; stdout: string; stderr: string; error?: Error };
  log?: (line: string) => void;
  platform?: NodeJS.Platform;
  now?: string;
}

/**
 * Install the stack version a project pins into `<home>/stack/<version>`,
 * from a registry, with npm. This is the copy the VS Code extension uses for
 * a project whose range its carried stack does not satisfy. It needs npm and
 * a registry that has the packages; both failures say what was tried.
 */
export function installStack(root: string, options: InstallStackOptions = {}): Stack {
  const home = options.home ?? stackHome();
  const platform = options.platform ?? process.platform;
  const log = options.log ?? (() => {});
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  const run =
    options.run ??
    ((args: string[], cwd: string) => {
      const r = spawnSync(npm, args, { cwd, encoding: "utf8", windowsHide: true, shell: platform === "win32" });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error } : {}) };
    });
  const deps = Object.entries(projectDependencies(root)).filter(([n]) => isStackPackage(n));
  const range = projectStackRange(root);
  if (!deps.length || !range) throw new Error(`${join(root, "package.json")} names no Protoboard package: there is no stack version to install for it`);
  const registry = options.registry ? [`--@protoboardai:registry=${options.registry}`, `--@deltarobotics:registry=${options.registry}`] : [];
  const need = (r: ReturnType<typeof run>, what: string) => {
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("npm was not found: installing a stack version from a registry needs Node.js with npm (https://nodejs.org/en/download). The stack carried by the VS Code extension needs neither.");
    if (r.status !== 0) {
      const auth = npmAuthProblem(`${r.stderr}\n${r.stdout}`);
      throw new Error(auth ? `${what} was refused by the registry. ${auth}` : `${what} failed (npm exit ${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-4).join(" ")}`);
    }
    return r;
  };
  // which version the range means today, asked from the project so its .npmrc applies
  const viewed = need(run(["view", `@protoboardai/cli@${range}`, "version", "--json", ...registry], root), `npm view @protoboardai/cli@${range}`);
  let versions: unknown;
  try {
    versions = JSON.parse(viewed.stdout || "null");
  } catch {
    versions = undefined;
  }
  const list = (Array.isArray(versions) ? versions : [versions]).filter((v): v is string => typeof v === "string").sort(compareVersions);
  const version = list.pop();
  if (!version) throw new Error(`no version of @protoboardai/cli matches ${range} in the registry npm uses for this project (\`npm view @protoboardai/cli versions\` lists what it has)`);
  const dir = stackDir(home, version);
  const existing = readStack(dir);
  if (existing?.marker.source === "vsix") throw new Error(`stack ${version} is already here, carried by the VS Code extension (${dir}): nothing to install`);
  ensurePrivateDir(home, platform);
  mkdirSync(dir, { recursive: true });
  // the project's npm settings (its registry lines, legacy-peer-deps) and overrides apply to the copy too
  const projectPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { overrides?: Record<string, string> };
  if (existsSync(join(root, ".npmrc"))) writeFileSync(join(dir, ".npmrc"), readFileSync(join(root, ".npmrc")));
  const pkgFile = join(dir, "package.json");
  const pkg = existsSync(pkgFile) ? (JSON.parse(readFileSync(pkgFile, "utf8")) as { dependencies?: Record<string, string>; overrides?: Record<string, string> }) : {};
  const wanted = { ...(pkg.dependencies ?? {}), ...Object.fromEntries(deps.map(([n, r]) => [n, n === "@protoboardai/cli" ? version : r])) };
  writeFileSync(pkgFile, JSON.stringify({ name: "protoboard-stack", version, private: true, description: "A Protoboard stack copy installed by `protoboard stack install`", dependencies: wanted, overrides: { ...(pkg.overrides ?? {}), ...(projectPkg.overrides ?? {}) } }, null, 2) + "\n");
  log(`npm install of stack ${version} into ${dir}`);
  need(run(["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", ...registry], dir), `npm install in ${dir}`);
  const packages: Record<string, string> = {};
  for (const scope of ["@protoboardai", "@deltarobotics"]) {
    let names: string[] = [];
    try {
      names = readdirSync(join(dir, "node_modules", scope));
    } catch {
      // the scope was not installed
    }
    for (const n of names) {
      try {
        packages[`${scope}/${n}`] = (JSON.parse(readFileSync(join(dir, "node_modules", scope, n, "package.json"), "utf8")) as { version: string }).version;
      } catch {
        // not a package folder
      }
    }
  }
  const build = readStamp(join(dir, "node_modules", "@protoboardai", "cli"));
  const marker: StackMarker = { schema: "protoboard.stack/v1", version, source: "registry", packages, ...(options.registry ? { registry: options.registry } : {}), ...(build ? { build } : {}), installedAt: options.now ?? new Date().toISOString() };
  writeFileSync(join(dir, STACK_MARKER), JSON.stringify(marker, null, 2) + "\n");
  const stack = readStack(dir);
  if (!stack) throw new Error(`npm install finished, but ${stackCli(dir)} is not there`);
  return stack;
}

/**
 * The copy to use for a project among those in `<home>/stack`: the newest
 * whose version satisfies the project's range; with no range (or one that
 * cannot be judged), the newest.
 */
export function stackFor(root: string, stacks: Stack[]): Stack | undefined {
  const range = projectStackRange(root);
  if (!range) return stacks[0];
  return stacks.find((s) => satisfies(s.marker.version, range) !== false);
}

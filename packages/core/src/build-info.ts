/**
 * Where the running build of the stack came from (`protoboard --version
 * --format json`, `protoboard doctor`).
 *
 * The maintainers run development builds on their own projects (dogfooding)
 * and agents there report the stack's problems with the build they saw them
 * on. So the CLI says what it is: its version, and when it can tell, the
 * commit of protoboard-stack it was built from, whether that working tree had
 * changes, the branch, and whether it is a release.
 *
 * A build is a RELEASE when the release workflow made it, or a registry
 * installed it at a published version:
 *
 *   - its stamp says `"release": true` for the version it runs as (written by
 *     `.github/scripts/release.mjs stamp` on a tag build only): the npm
 *     packages, however they were installed (`npm i -g` leaves no lockfile to
 *     read), and the stack the Marketplace extension carries;
 *   - or a project's `npm install` from a registry, or a stack copy
 *     `protoboard stack install` put in `<home>/stack`.
 *
 * Everything else is a development build: a protoboard-stack checkout, a
 * .vsix or a tarball built from one (whose version is a prerelease,
 * `0.2.1-dev.7.g1a2b3c4`: scripts/build-version.mjs).
 *
 * Where it is recorded:
 *
 *   - a checkout: read live from git (commit, dirty, branch);
 *   - a packaged build: `build-info.json`, stamped at package time by
 *     `scripts/build-stack.ts` into the carried CLI package and into the
 *     carried stack's `stack.json` (`build`), which the unpacked copy's
 *     `protoboard-stack.json` keeps;
 *   - otherwise each field is null ("unknown") and the build is not a release
 *     unless a registry installed it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { Stack } from "./stack.js";

/** The stamp's file name, at the root of the CLI package. */
export const BUILD_INFO = "build-info.json";

/** What a build was made from, stamped at package time. */
export interface BuildStamp {
  schema: "protoboard.build-info/v1";
  version: string;
  /** The protoboard-stack commit (full SHA), or null when it was not built from a git checkout. */
  commit: string | null;
  /** The checkout had changes (tracked or untracked) when it was built; null when unknown. */
  dirty: boolean | null;
  branch: string | null;
  builtAt: string;
  /** Made by the release workflow from a release tag (`release.mjs stamp`); absent on every other build. */
  release?: boolean;
}

/** How this build reached the machine. */
export type BuildSource = "checkout" | "vsix" | "registry" | "tarball" | "unknown";

export interface BuildProvenance {
  version: string;
  commit: string | null;
  dirty: boolean | null;
  branch: string | null;
  /** A release: the release workflow's stamp, or a registry installed it at a published version. */
  release: boolean;
  source: BuildSource;
  /** When the stamp was made (packaged builds). */
  builtAt?: string;
  /** The stack copy the CLI runs from, when it does. */
  stack?: string;
}

/** Runs git; returns its trimmed stdout, or undefined when it failed. Replaced in tests. */
export type GitRunner = (args: string[], cwd: string) => string | undefined;

const defaultGit: GitRunner = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 && !r.error ? (r.stdout ?? "").trim() : undefined;
};

const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
};

/** The stamp for a build made from `repoDir` now (`build-stack.ts`, `package.mjs`). Fields git cannot answer are null. */
export function gitStamp(repoDir: string, version: string, options: { git?: GitRunner; now?: string } = {}): BuildStamp {
  const git = options.git ?? defaultGit;
  const commit = git(["rev-parse", "HEAD"], repoDir) ?? null;
  const status = commit ? git(["status", "--porcelain"], repoDir) : undefined;
  const branch = commit ? git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir) : undefined;
  return {
    schema: "protoboard.build-info/v1",
    version,
    commit,
    dirty: status === undefined ? null : status.length > 0,
    branch: branch && branch !== "HEAD" ? branch : null,
    builtAt: options.now ?? new Date().toISOString(),
  };
}

/** A stamp read from a file or a manifest, when it is one. */
export function asStamp(v: unknown): BuildStamp | undefined {
  const s = v as BuildStamp | undefined;
  return s && s.schema === "protoboard.build-info/v1" && typeof s.version === "string" ? s : undefined;
}

export function readStamp(cliDir: string): BuildStamp | undefined {
  return asStamp(readJson(join(cliDir, BUILD_INFO)));
}

/** The stamp is the release workflow's, for the version that runs. */
const releaseStamp = (s: BuildStamp | undefined, version: string) => s?.release === true && s.version === version;

const fromStamp = (s: BuildStamp | undefined) => ({ commit: s?.commit ?? null, dirty: s?.dirty ?? null, branch: s?.branch ?? null, ...(s?.builtAt ? { builtAt: s.builtAt } : {}) });

/** How npm installed the package at `dir` (inside a node_modules), from npm's hidden lockfile. */
function npmSource(dir: string): BuildSource {
  const parts = dir.split(sep);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return "unknown";
  const modules = parts.slice(0, at + 1).join(sep);
  const lock = readJson<{ packages?: Record<string, { resolved?: string; link?: boolean }> }>(join(modules, ".package-lock.json"));
  const key = relative(dirname(modules), dir).split(sep).join("/");
  const resolved = lock?.packages?.[key]?.resolved;
  if (!resolved) return "unknown";
  if (/^https?:\/\//.test(resolved)) return "registry";
  if (resolved.startsWith("file:")) return "tarball";
  return "unknown";
}

/**
 * The provenance of the CLI whose package folder is `cliDir`. `carried` is the
 * stack copy it runs from, when it does (`carriedStack()`).
 */
export function buildProvenance(o: { cliDir: string; version: string; carried?: Stack; git?: GitRunner }): BuildProvenance {
  const git = o.git ?? defaultGit;
  let dir: string;
  try {
    dir = realpathSync(o.cliDir);
  } catch {
    dir = o.cliDir;
  }
  const stamp = readStamp(dir);
  if (o.carried) {
    const m = o.carried.marker;
    const s = asStamp(m.build) ?? stamp;
    return { version: o.version, ...fromStamp(s), release: m.source === "registry" || releaseStamp(s, o.version), source: m.source, stack: o.carried.dir };
  }
  const inModules = dir.split(sep).includes("node_modules");
  if (!inModules) {
    const top = git(["rev-parse", "--show-toplevel"], dir);
    if (top && existsSync(join(top, "packages", "cli", "package.json"))) {
      const commit = git(["rev-parse", "HEAD"], dir) ?? null;
      const status = git(["status", "--porcelain"], dir);
      const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
      return { version: o.version, commit, dirty: status === undefined ? null : status.length > 0, branch: branch && branch !== "HEAD" ? branch : null, release: false, source: "checkout" };
    }
  }
  const source = inModules ? npmSource(dir) : "unknown";
  return { version: o.version, ...fromStamp(stamp), release: source === "registry" || releaseStamp(stamp, o.version), source };
}

const SOURCE_TEXT: Record<BuildSource, string> = {
  checkout: "a protoboard-stack checkout",
  vsix: "the stack carried by a VS Code extension package",
  registry: "installed from a registry",
  tarball: "installed from a package file",
  unknown: "where it came from is unknown",
};

/** One line for doctor: `release` or `development build`, then what is known. A release that cannot say how it got here (`npm i -g`) leaves that out. */
export function fmtProvenance(p: BuildProvenance): string {
  const known = [
    p.branch && `branch ${p.branch}`,
    p.commit && `commit ${p.commit.slice(0, 12)}${p.dirty ? " with uncommitted changes" : p.dirty === false ? " (clean)" : ""}`,
    p.builtAt && `built ${p.builtAt.slice(0, 16).replace("T", " ")} UTC`,
  ].filter(Boolean);
  if (p.release && p.source === "unknown") return `${p.version} release${known.length ? `: ${known.join(", ")}` : ""}`;
  return `${p.version} ${p.release ? "release" : "development build"}: ${SOURCE_TEXT[p.source]}${known.length ? `, ${known.join(", ")}` : p.release ? "" : ", commit unknown"}`;
}

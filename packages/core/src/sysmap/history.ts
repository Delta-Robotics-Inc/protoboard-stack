/**
 * The release history the System Map reads (docs/specs/system-map.md,
 * "Status and changes"): the stack's release tags, which files changed
 * between them and since the last one, and a file's text at a tag. Read-only:
 * git is asked, never told (no checkout, no fetch, no write).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { byCodeUnit, type SysmapHistory, type SysmapRelease } from "./model.js";
import { compareVersions, parseVersion } from "./parse.js";

/** Runs git in a folder and gives its stdout, or null when git is absent or fails. */
export type SysmapGitRunner = (args: string[], cwd: string) => Promise<string | null>;

export const runGit: SysmapGitRunner = (args, cwd) =>
  new Promise((done) => {
    execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout) => done(err ? null : stdout));
  });

/** NUL-separated output as a list (empty entries dropped). */
const nul = (out: string): string[] => out.split("\0").filter(Boolean);

export interface StackHistory {
  /** Release tags, oldest first. */
  releases: (SysmapRelease & { commit: string })[];
  /** Paths (stack-relative) present at each release, by index into `releases`. */
  present: Set<string>[];
  /**
   * changed[i] for i >= 1: paths that differ between releases[i-1] and
   * releases[i]; changed[releases.length]: paths that differ between the last
   * release and the working tree (tracked changes and untracked files).
   * changed[0] is empty.
   */
  changed: Set<string>[];
  /** What freshness compares. */
  fingerprint: SysmapHistory;
  /** A file's text at a release (index into `releases`), null when it is not there. */
  show(release: number, path: string): Promise<string | null>;
}

/**
 * The stack's history, or why there is none: not a git work tree, git absent,
 * or no release tags (`v<major>.<minor>.<patch>`). Paths are relative to
 * `root` (git runs there with --relative), so a stack inside a larger
 * repository reads only its own files.
 */
export async function readHistory(root: string, git: SysmapGitRunner = runGit): Promise<StackHistory | { unavailable: string }> {
  const base = await readBase(root, git);
  if ("unavailable" in base) return base;
  const { head, releases: unique, dirty } = base;
  const present: Set<string>[] = [];
  for (const r of unique) {
    const out = await git(["ls-tree", "-r", "-z", "--name-only", r.commit, "--", "."], root);
    if (out === null) return { unavailable: `git could not list the files of ${r.tag}` };
    present.push(new Set(nul(out)));
  }
  const changed: Set<string>[] = [new Set()];
  for (let i = 1; i < unique.length; i++) {
    const out = await git(["-c", "core.quotepath=off", "diff", "--no-renames", "--name-only", "-z", "--relative", unique[i - 1].commit, unique[i].commit, "--", "."], root);
    if (out === null) return { unavailable: `git could not compare ${unique[i - 1].tag} with ${unique[i].tag}` };
    changed.push(new Set(nul(out)));
  }
  changed.push(dirty);

  const cache = new Map<string, string | null>();
  const show = async (release: number, path: string): Promise<string | null> => {
    const r = unique[release];
    if (!r || !present[release].has(path)) return null;
    const key = `${r.commit}:${path}`;
    if (!cache.has(key)) cache.set(key, await git(["show", `${r.commit}:./${path}`], root));
    return cache.get(key) ?? null;
  };

  return {
    releases: unique,
    present,
    changed,
    fingerprint: { head, tags: unique.map((r) => `${r.tag}=${r.commit}`), dirty: dirtyDigest(dirty) },
    show,
  };
}

/** sha256 of the sorted paths, one per line. */
export function dirtyDigest(paths: Iterable<string>): string {
  return "sha256:" + createHash("sha256").update([...paths].sort(byCodeUnit).join("\n")).digest("hex");
}

/** HEAD, the release tags, and the paths that differ from the last one: what both the history and its fingerprint need. */
async function readBase(root: string, git: SysmapGitRunner): Promise<{ head: string; releases: StackHistory["releases"]; dirty: Set<string> } | { unavailable: string }> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], root);
  if (inside?.trim() !== "true") return { unavailable: "the stack root is not in a git work tree (or git is not installed)" };
  const head = (await git(["rev-parse", "HEAD"], root))?.trim();
  if (!head) return { unavailable: "the repository has no commits" };
  const refs = await git(["for-each-ref", "--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:short)", "refs/tags"], root);
  if (refs === null) return { unavailable: "git could not list the tags" };
  const all: StackHistory["releases"] = [];
  for (const line of refs.split("\n")) {
    const [tag, peeled, object, date] = line.split("\t");
    if (!tag || !parseVersion(tag)) continue;
    all.push({ version: tag.replace(/^v/, ""), tag, commit: peeled || object, date: date ?? "" });
  }
  // two tags for one version (0.3.0 and v0.3.0): keep the first in code-unit order
  all.sort((a, b) => compareVersions(a.version, b.version) || byCodeUnit(a.tag, b.tag));
  const releases = all.filter((r, i) => i === 0 || r.version !== all[i - 1].version);
  if (!releases.length) return { unavailable: "the repository has no release tags (v<major>.<minor>.<patch>)" };
  const last = releases[releases.length - 1];
  const tracked = await git(["-c", "core.quotepath=off", "diff", "--no-renames", "--name-only", "-z", "--relative", last.commit, "--", "."], root);
  const untracked = await git(["-c", "core.quotepath=off", "ls-files", "-z", "--others", "--exclude-standard", "--", "."], root);
  if (tracked === null || untracked === null) return { unavailable: `git could not compare the working tree with ${last.tag}` };
  return { head, releases, dirty: new Set([...nul(tracked), ...nul(untracked)]) };
}

/** Just the fingerprint (what freshness compares), cheaper than the whole history. null when there is no history. */
export async function historyFingerprint(root: string, git: SysmapGitRunner = runGit): Promise<SysmapHistory | null> {
  const b = await readBase(root, git);
  return "unavailable" in b ? null : { head: b.head, tags: b.releases.map((r) => `${r.tag}=${r.commit}`), dirty: dirtyDigest(b.dirty) };
}

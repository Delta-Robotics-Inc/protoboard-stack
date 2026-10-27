/**
 * The version a packaged build carries (PB-1062): the extension's own, the carried stack's (and so its folder,
 * `<home>/stack/<version>`), and what `protoboard --version` and doctor say. Used by
 * packages/vscode-protoboard/scripts/package.mjs and build-stack.ts.
 *
 * The committed package.json files always hold the release version. A build is stamped at build time:
 *
 *   - a RELEASE build (the release workflow on a tag): packages/cli/build-info.json, written by
 *     `.github/scripts/release.mjs stamp`, says `"release": true` for the committed version and this commit.
 *     The build keeps the plain version (0.2.0) and that stamp.
 *   - anything else is a DEVELOPMENT build, with a semver prerelease version:
 *         <next patch>-dev.<commits since the tag>.g<short sha>     0.2.1-dev.7.g1a2b3c4
 *     when the committed version's tag (v0.2.0) is behind HEAD, or, while a version is being prepared and has no
 *     tag yet, <that version>-dev.<commits since the last tag>.g<short sha>. It sorts after the release it builds
 *     on and before the next one, and later commits sort later. So a dev build never takes a release's stack
 *     folder, and a release never takes a dev build's.
 *   - a committed prerelease (0.3.0-rc.1), tagged or not, builds on the release it leads to:
 *         0.3.0-dev.<commits>.g<short sha>
 *     (every dev build is x.y.z-dev.…, which the stack reads as a dev build of x.y.z). It sorts before the release,
 *     and, as "dev" sorts before "rc", before the rc too: still never the same folder as either.
 *
 * The commit count needs the release tags: a checkout without them (a shallow CI clone) counts from the root it
 * has, so the release workflow's vsix job checks out with full history and tags (fetch-depth: 0).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const defaultGit = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 && !r.error ? (r.stdout ?? "").trim() : undefined;
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** The next patch of a plain x.y.z. */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`${version} is not a plain x.y.z version`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * A development build's version. `released`: the committed version has its tag behind HEAD, so the build is on
 * the way to the next patch. `commits` counts from that tag (or the last one); `sha` is the commit, shortened.
 * The sha takes a `g` (as git describe writes it): a prerelease part of digits only may not start with 0.
 * A prerelease base (0.3.0-rc.1) builds on the release it leads to (0.3.0), tagged or not.
 */
export function devVersion(base, { released, commits, sha }) {
  const core = base.replace(/[-+].*$/, "");
  const line = released && core === base ? nextPatch(base) : core;
  return `${line}-dev.${Number.isInteger(commits) && commits >= 0 ? commits : 0}${sha ? `.g${sha.slice(0, 7)}` : ""}`;
}

/** A release stamp for `version` at `commit` (`release.mjs stamp` on a tag), when the file is one. */
export function releaseStamp(file, version, commit) {
  const s = readJson(file);
  if (!s || s.schema !== "protoboard.build-info/v1" || s.release !== true || s.version !== version) return undefined;
  // a stamp left from another commit's tag build is not this build's
  if (commit && s.commit && s.commit !== commit) return undefined;
  return s;
}

/**
 * The version to build `repo` (a protoboard-stack checkout) as, and the release stamp when it is a release
 * build: `{ version, base, release, stamp? }`.
 */
export function buildVersion(repo, options = {}) {
  const git = options.git ?? defaultGit;
  const base = readJson(join(repo, "packages", "core", "package.json"))?.version;
  if (typeof base !== "string") throw new Error(`${join(repo, "packages", "core", "package.json")} has no version`);
  const head = git(["rev-parse", "HEAD"], repo);
  const stamp = releaseStamp(join(repo, "packages", "cli", "build-info.json"), base, head);
  if (stamp) return { version: base, base, release: true, stamp };
  // the newest release tag behind HEAD, and how far behind
  const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], repo);
  const counted = head ? git(["rev-list", "--count", tag ? `${tag}..HEAD` : "HEAD"], repo) : undefined;
  const commits = counted === undefined ? 0 : Number(counted);
  return { version: devVersion(base, { released: tag === `v${base}`, commits, sha: head }), base, release: false };
}

/**
 * An extension's protoboard-extension.json as a build carries it: one of this repository's extensions takes the
 * build's version, as its package.json does, so what it records (operations, doctor, release manifests) names
 * the build that made it. A release build, or another extension, is left as it is.
 */
export function stampExtensionManifest(manifest, bv) {
  if (bv.release || bv.version === manifest.version || typeof manifest.id !== "string" || !manifest.id.startsWith("@protoboardai/")) return manifest;
  if (manifest.version !== bv.base) throw new Error(`${manifest.id}'s protoboard-extension.json is ${manifest.version} and the stack is ${bv.base}: the stack's packages share one version`);
  return { ...manifest, version: bv.version };
}

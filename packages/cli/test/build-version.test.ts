/**
 * The version a packaged build carries (PB-1062, scripts/build-version.mjs)
 * and the release workflow's stamp (`.github/scripts/release.mjs stamp`): a
 * release only for a tag build, a prerelease `x.y.z-dev.<n>.g<sha>` for
 * everything else, with the committed package.json files left as they are.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildVersion, devVersion, nextPatch } from "../../../scripts/build-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-build-version-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const put = (file: string, content: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.email=t@localhost", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
};

/** A stand-in protoboard-stack: the packages at `version`, and the release script. */
function repo(name: string, version: string) {
  const dir = join(TMP, name);
  put(join(dir, "package.json"), JSON.stringify({ name: "protoboard-stack", private: true, workspaces: ["packages/core", "packages/cli"] }));
  put(join(dir, "packages/core/package.json"), JSON.stringify({ name: "@protoboardai/core", version }));
  put(join(dir, "packages/cli/package.json"), JSON.stringify({ name: "@protoboardai/cli", version }));
  put(join(dir, "packages/vscode-protoboard/package.json"), JSON.stringify({ name: "vscode-protoboard", version }));
  mkdirSync(join(dir, ".github/scripts"), { recursive: true });
  copyFileSync(join(ROOT, ".github/scripts/release.mjs"), join(dir, ".github/scripts/release.mjs"));
  return dir;
}

const stamp = (dir: string, env: Record<string, string>) => {
  const r = spawnSync(process.execPath, [".github/scripts/release.mjs", "stamp"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(join(dir, "packages/cli/build-info.json"), "utf8")) as Record<string, unknown>;
};

describe("a development build's version", () => {
  it("the next patch, the commits since the tag and the commit: a prerelease that sorts between the two releases", () => {
    expect(nextPatch("0.2.0")).toBe("0.2.1");
    expect(devVersion("0.2.0", { released: true, commits: 7, sha: "1a2b3c4d5e6f" })).toBe("0.2.1-dev.7.g1a2b3c4");
    // a version being prepared, with no tag yet: a prerelease of that version
    expect(devVersion("0.3.0", { released: false, commits: 2, sha: "0123456789" })).toBe("0.3.0-dev.2.g0123456");
    // outside git
    expect(devVersion("0.2.0", { released: false, commits: Number.NaN, sha: null })).toBe("0.2.0-dev.0");
  });

  it("read from git: commits since v<version>, the release stamp only for this commit", () => {
    const dir = repo("checkout", "0.2.0");
    git(dir, "init", "-q", "--initial-branch=main");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "0.2.0");
    git(dir, "tag", "v0.2.0");
    // on the tag itself, without the release stamp: still a development build
    const head0 = git(dir, "rev-parse", "HEAD");
    expect(buildVersion(dir)).toEqual({ version: `0.2.1-dev.0.g${head0.slice(0, 7)}`, base: "0.2.0", release: false });
    put(join(dir, "a.txt"), "a");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "a");
    put(join(dir, "b.txt"), "b");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "b");
    const head = git(dir, "rev-parse", "HEAD");
    expect(buildVersion(dir).version).toBe(`0.2.1-dev.2.g${head.slice(0, 7)}`);
    // the committed files are not changed
    expect(JSON.parse(readFileSync(join(dir, "packages/core/package.json"), "utf8")).version).toBe("0.2.0");

    // a release stamp for this commit (the vsix job on a tag): the plain version and that stamp
    const s = stamp(dir, { GITHUB_REF: "refs/tags/v0.2.0", GITHUB_SHA: head });
    expect(s.release).toBe(true);
    expect(buildVersion(dir)).toMatchObject({ version: "0.2.0", release: true, stamp: { release: true, commit: head } });
    // the same stamp left behind after another commit is not that commit's
    put(join(dir, "c.txt"), "c");
    git(dir, "add", "a.txt", "b.txt", "c.txt");
    git(dir, "commit", "-qm", "c");
    expect(buildVersion(dir)).toMatchObject({ release: false, version: expect.stringMatching(/^0\.2\.1-dev\.3\.g[0-9a-f]{7}$/) });
  });

  it("a version in preparation (no v<version> tag yet) counts from the last tag", () => {
    const dir = repo("preparing", "0.2.0");
    git(dir, "init", "-q", "--initial-branch=main");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "0.2.0");
    git(dir, "tag", "v0.2.0");
    put(join(dir, "packages/core/package.json"), JSON.stringify({ name: "@protoboardai/core", version: "0.3.0" }));
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "0.3.0");
    expect(buildVersion(dir).version).toMatch(/^0\.3\.0-dev\.1\.g[0-9a-f]{7}$/);
  });
});

describe("release.mjs stamp: a release only for a tag build", () => {
  it("a tag build of this version says release; a manual run (a dry run) and another tag do not", () => {
    const dir = repo("stamps", "0.2.1");
    const sha = "f".repeat(40);
    expect(stamp(dir, { GITHUB_REF: "refs/tags/v0.2.1", GITHUB_SHA: sha })).toMatchObject({ version: "0.2.1", commit: sha, release: true });
    for (const ref of ["refs/heads/main", "refs/tags/v0.2.0", ""]) {
      const s = stamp(dir, { GITHUB_REF: ref, GITHUB_SHA: sha });
      expect(s.release, ref).toBeUndefined();
      // and such a stamp makes no release build
      expect(buildVersion(dir, { git: () => undefined })).toMatchObject({ release: false, version: "0.2.1-dev.0" });
    }
  });
});

/**
 * Where the running build came from (build-info.ts): a checkout read live from
 * git, a packaged build from its stamp, and a release only when a registry
 * installed it.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD_INFO, buildProvenance, fmtProvenance, gitStamp, type BuildStamp } from "../src/build-info.js";
import type { Stack } from "../src/stack.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-build-info-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const put = (file: string, content: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.email=t@localhost", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
};
const STAMP: BuildStamp = { schema: "protoboard.build-info/v1", version: "0.1.7", commit: "a".repeat(40), dirty: true, branch: "mark/r8", builtAt: "2026-10-23T12:00:00.000Z" };

describe("build provenance", () => {
  it("a protoboard-stack checkout: commit, dirty and branch from git, never a release", () => {
    const repo = join(TMP, "checkout");
    put(join(repo, "packages", "cli", "package.json"), '{"name":"@protoboardai/cli","version":"0.1.7"}\n');
    git(repo, "init", "-q", "--initial-branch=mark/r8-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "one");
    const head = git(repo, "rev-parse", "HEAD");
    const clean = buildProvenance({ cliDir: join(repo, "packages", "cli"), version: "0.1.7" });
    expect(clean).toEqual({ version: "0.1.7", commit: head, dirty: false, branch: "mark/r8-q", release: false, source: "checkout" });
    put(join(repo, "packages", "cli", "new.ts"), "export {};\n");
    const dirty = buildProvenance({ cliDir: join(repo, "packages", "cli"), version: "0.1.7" });
    expect(dirty.dirty).toBe(true);
    expect(fmtProvenance(dirty)).toMatch(/^0\.1\.7 development build: a protoboard-stack checkout, branch mark\/r8-q, commit [0-9a-f]{12} with uncommitted changes$/);
    // the stamp the build scripts write says the same
    const stamp = gitStamp(repo, "0.1.7", { now: "2026-10-23T00:00:00.000Z" });
    expect(stamp).toEqual({ schema: "protoboard.build-info/v1", version: "0.1.7", commit: head, dirty: true, branch: "mark/r8-q", builtAt: "2026-10-23T00:00:00.000Z" });
  });

  it("outside git the stamp's fields are null, not guessed", () => {
    expect(gitStamp(join(TMP, "nowhere"), "0.1.7", { git: () => undefined, now: "x" })).toEqual({ schema: "protoboard.build-info/v1", version: "0.1.7", commit: null, dirty: null, branch: null, builtAt: "x" });
  });

  it("a stack copy carried by a .vsix: its stamp, and not a release", () => {
    const dir = join(TMP, "home", "stack", "0.1.7");
    const carried: Stack = { dir, marker: { schema: "protoboard.stack/v1", version: "0.1.7", source: "vsix", packages: {}, build: STAMP, installedAt: "now" } };
    const p = buildProvenance({ cliDir: join(dir, "node_modules", "@protoboardai", "cli"), version: "0.1.7", carried, git: () => undefined });
    expect(p).toEqual({ version: "0.1.7", commit: STAMP.commit, dirty: true, branch: "mark/r8", builtAt: STAMP.builtAt, release: false, source: "vsix", stack: dir });
    expect(fmtProvenance(p)).toContain("development build: the stack carried by a VS Code extension package");
    // an older .vsix without a stamp: unknown, still not a release
    const old = buildProvenance({ cliDir: join(dir, "x"), version: "0.1.6", carried: { dir, marker: { ...carried.marker, build: undefined } }, git: () => undefined });
    expect(old).toMatchObject({ commit: null, dirty: null, branch: null, release: false, source: "vsix" });
    expect(fmtProvenance(old)).toMatch(/commit unknown$/);
  });

  it("a stack copy installed from a registry is a release", () => {
    const dir = join(TMP, "home", "stack", "0.1.6");
    const carried: Stack = { dir, marker: { schema: "protoboard.stack/v1", version: "0.1.6", source: "registry", packages: {}, installedAt: "now" } };
    const p = buildProvenance({ cliDir: join(dir, "node_modules", "@protoboardai", "cli"), version: "0.1.6", carried, git: () => undefined });
    expect(p).toMatchObject({ release: true, source: "registry", commit: null });
    expect(fmtProvenance(p)).toBe("0.1.6 release: installed from a registry");
  });

  it("a project's npm install: a registry is a release, a package file is not; a stamp gives the commit", () => {
    for (const [name, resolved, source, release] of [
      ["reg", "http://127.0.0.1:4873/@protoboardai/cli/-/cli-0.1.6.tgz", "registry", true],
      ["file", "file:../protoboard-stack-0.1.7.tgz", "tarball", false],
      ["none", undefined, "unknown", false],
    ] as const) {
      const project = join(TMP, `project-${name}`);
      const cliDir = join(project, "node_modules", "@protoboardai", "cli");
      put(join(cliDir, "package.json"), '{"name":"@protoboardai/cli","version":"0.1.6"}\n');
      put(join(project, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { "node_modules/@protoboardai/cli": resolved ? { version: "0.1.6", resolved } : { version: "0.1.6" } } }));
      if (name === "file") put(join(cliDir, BUILD_INFO), JSON.stringify(STAMP));
      // git is never asked inside node_modules: the project's own repository is not the CLI's
      const p = buildProvenance({ cliDir, version: "0.1.6", git: () => { throw new Error("git asked"); } });
      expect(p).toMatchObject({ source, release });
      expect(p.commit).toBe(name === "file" ? STAMP.commit : null);
    }
  });
});

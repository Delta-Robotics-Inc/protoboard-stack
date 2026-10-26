/**
 * Which UHD version scripts/registry/publish-stack.mjs may publish (PB-941):
 * a hosted registry gets a plain version only from the commit tagged with
 * it; any other build is <next version>-dev.<short sha>, pinned exactly by
 * the packages that depend on it, in their staged copies. Nothing here
 * publishes: the script runs with --dry-run against a stand-in registry on
 * loopback, or stops before it asks any registry.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devVersion, nextVersion, pinUhd, uhdGitState, uhdPublishPlan } from "../../../scripts/registry/uhd-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/registry/publish-stack.mjs");

const HEAD = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const OTHER = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const plan = (o: Partial<Parameters<typeof uhdPublishPlan>[0]> & { git?: Parameters<typeof uhdPublishPlan>[0]["git"] }) =>
  uhdPublishPlan({ version: "0.3.0", hosted: true, dev: false, git: { head: HEAD, tagCommit: HEAD, dirty: false }, ...o });

describe("UHD's version in a registry of ours", () => {
  it("a hosted registry gets the plain version from the tagged commit with a clean tree", () => {
    expect(plan({})).toEqual({ publishAs: "0.3.0", dev: false });
  });

  it("a hosted registry refuses an untagged build, and says how to proceed", () => {
    const r = plan({ git: { head: HEAD, tagCommit: undefined, dirty: false } });
    expect(r.publishAs).toBeUndefined();
    expect(r.refuse).toContain("uhd has no tag v0.3.0 (HEAD is 1a2b3c4)");
    expect(r.refuse).toContain("push the tag v0.3.0");
    expect(r.refuse).toContain("--uhd-dev to publish this build as 0.3.0-dev.1a2b3c4");
  });

  it("a hosted registry refuses a build past (or before) the tagged commit", () => {
    const r = plan({ git: { head: HEAD, tagCommit: OTHER, dirty: false } });
    expect(r.refuse).toContain("uhd's HEAD (1a2b3c4) is not the commit tagged v0.3.0 (9f8e7d6)");
    expect(r.refuse).toContain("git -C uhd switch --detach v0.3.0");
    // past its release, the build is on the way to the next version
    expect(r.refuse).toContain("--uhd-dev to publish this build as 0.3.1-dev.1a2b3c4");
  });

  it("a hosted registry refuses the tagged commit with changes to tracked files", () => {
    const r = plan({ git: { head: HEAD, tagCommit: HEAD, dirty: true } });
    expect(r.refuse).toContain("the uhd checkout has changes to tracked files");
    expect(r.refuse).toContain("commit or stash the changes in uhd first");
  });

  it("a hosted registry refuses a checkout that is not a git repository", () => {
    expect(plan({ git: undefined }).refuse).toContain("not a git repository");
    expect(plan({ git: undefined, dev: true }).refuse).toContain("not a git repository");
  });

  it("--uhd-dev publishes an untagged build as <version>-dev.<short sha>", () => {
    expect(plan({ dev: true, git: { head: HEAD, tagCommit: undefined, dirty: false } })).toEqual({ publishAs: "0.3.0-dev.1a2b3c4", dev: true });
    expect(plan({ dev: true, git: { head: HEAD, tagCommit: OTHER, dirty: false } })).toEqual({ publishAs: "0.3.1-dev.1a2b3c4", dev: true });
  });

  it("--uhd-dev refuses the release itself, and on a hosted registry a tree that is not its commit", () => {
    expect(plan({ dev: true }).refuse).toContain("publish it as 0.3.0 (leave out --uhd-dev)");
    const dirty = plan({ dev: true, git: { head: HEAD, tagCommit: undefined, dirty: true } });
    expect(dirty.refuse).toContain("0.3.0-dev.1a2b3c4 would not be the build of 1a2b3c4");
  });

  it("the local registry takes any build under the plain version, with a note when it is not the tagged one", () => {
    expect(plan({ hosted: false })).toEqual({ publishAs: "0.3.0", dev: false });
    const untagged = plan({ hosted: false, git: { head: HEAD, tagCommit: undefined, dirty: false } });
    expect(untagged).toMatchObject({ publishAs: "0.3.0", dev: false });
    expect(untagged.note).toContain("uhd has no tag v0.3.0");
    expect(untagged.note).toContain("A hosted registry would refuse it");
    expect(plan({ hosted: false, git: { head: HEAD, tagCommit: HEAD, dirty: true } }).note).toContain("changes to tracked files");
    expect(plan({ hosted: false, git: undefined })).toMatchObject({ publishAs: "0.3.0", dev: false });
    // --uhd-dev works there too; a dirty tree is allowed and noted
    expect(plan({ hosted: false, dev: true, git: { head: HEAD, tagCommit: undefined, dirty: true } })).toMatchObject({ publishAs: "0.3.0-dev.1a2b3c4", dev: true, note: expect.stringContaining("working tree") });
  });

  it("dev versions are valid semver whatever the commit id", () => {
    expect(devVersion("0.3.0", HEAD)).toBe("0.3.0-dev.1a2b3c4");
    expect(devVersion("1.0.0-rc.1", HEAD)).toBe("1.0.0-dev.1a2b3c4");
    // an all-digit identifier may not start with 0: take more of the id
    expect(devVersion("0.3.0", "0123456a" + "0".repeat(32))).toBe("0.3.0-dev.0123456a");
    expect(devVersion("0.3.0", "1234567" + "0".repeat(33))).toBe("0.3.0-dev.1234567");
    expect(devVersion("0.3.0", "0".repeat(40))).toBe(`0.3.0-dev.g${"0".repeat(40)}`);
    expect(() => devVersion("0.3.0", "main")).toThrow();
    expect(nextVersion("0.3.0")).toBe("0.3.1");
    expect(nextVersion("1.0.0-rc.1")).toBe("1.0.0");
  });

  it("pins every UHD dependency of a package, and core's toolchain pin, to the exact version", () => {
    const core = { name: "@protoboardai/core", dependencies: { "@deltarobotics/uhd": "^0.2.0", "@protoboardai/cloud": "^0.1.0" }, protoboard: { toolchain: { uhd: "0.2.0", typescript: "7.0.2" } } };
    expect(pinUhd(core, "0.3.0-dev.1a2b3c4")).toEqual(["dependencies", "protoboard.toolchain"]);
    expect(core.dependencies).toEqual({ "@deltarobotics/uhd": "0.3.0-dev.1a2b3c4", "@protoboardai/cloud": "^0.1.0" });
    expect(core.protoboard.toolchain).toEqual({ uhd: "0.3.0-dev.1a2b3c4", typescript: "7.0.2" });
    const ext = { peerDependencies: { "@deltarobotics/uhd": ">=0.2.0" }, devDependencies: { "@deltarobotics/uhd": "file:../uhd" } };
    expect(pinUhd(ext, "0.3.0-dev.1a2b3c4")).toEqual(["peerDependencies", "devDependencies"]);
    expect(pinUhd({ dependencies: { "@protoboardai/core": "^0.1.0" } }, "0.3.0-dev.1a2b3c4")).toEqual([]);
    expect(pinUhd(ext, "0.3.0-dev.1a2b3c4")).toEqual([]);
  });
});

describe("publish-stack.mjs holds UHD to those rules", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pb-publish-stack-"));
  const uhd = join(scratch, "uhd");
  const git = (...args: string[]) => execFileSync("git", ["-C", uhd, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  const manifest = (dir: string, pkg: object) => {
    mkdirSync(join(scratch, dir), { recursive: true });
    writeFileSync(join(scratch, dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    writeFileSync(join(scratch, dir, "index.js"), "export {};\n");
  };
  let server: Server;
  let registry = "";
  const puts: string[] = [];

  beforeAll(async () => {
    // a workspace shaped like the real one: uhd is a git checkout, core depends on it
    manifest("uhd", { name: "@deltarobotics/uhd", version: "0.3.0", type: "module", files: ["index.js"] });
    manifest("uhd-viewer", { name: "@deltarobotics/uhd-viewer", version: "0.1.0", private: true, type: "module", files: ["index.js"], peerDependencies: { "@deltarobotics/uhd": ">=0.2.0" } });
    manifest("protoboard-cli/packages/cloud", { name: "@protoboardai/cloud", version: "0.1.0", private: true, type: "module", files: ["index.js"] });
    manifest("protoboard-cli/packages/core", { name: "@protoboardai/core", version: "0.1.0", private: true, type: "module", files: ["index.js"], dependencies: { "@deltarobotics/uhd": "^0.2.0" }, protoboard: { toolchain: { uhd: "0.2.0" } } });
    execFileSync("git", ["init", "-q", uhd]);
    git("add", "-A");
    git("commit", "-q", "-m", "uhd");
    // a stand-in registry on loopback: it has no packages, and records any attempt to publish
    server = createServer((req, res) => {
      if (req.method !== "GET") puts.push(`${req.method} ${req.url}`);
      res.writeHead(req.url === "/-/ping" ? 200 : 404, { "content-type": "application/json" }).end("{}");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    await new Promise((done) => server.close(done));
    rmSync(scratch, { recursive: true, force: true });
  });

  // a hosted target at a name that never resolves (RFC 2606): the UHD rule is decided before any request is made
  const hosted = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, "--workspace", scratch, "--target", "verdaccio", "--registry", "https://registry.example.invalid/", "--dry-run", ...args], {
      encoding: "utf8",
      env: { ...process.env, PB_REGISTRY_TOKEN: "not-a-token", PB_REGISTRY_URL: "" },
    });
  const local = async (args: string[]) => {
    const r = await promisify(execFile)(process.execPath, [SCRIPT, "--workspace", scratch, "--registry", registry, "--dry-run", ...args], { encoding: "utf8", env: { ...process.env, PB_REGISTRY_URL: "" } });
    return r.stdout + r.stderr;
  };

  it("reads the checkout: HEAD, the version's tag, changes to tracked files only", () => {
    const head = git("rev-parse", "HEAD");
    expect(uhdGitState(uhd, "0.3.0")).toEqual({ head, tagCommit: undefined, dirty: false });
    writeFileSync(join(uhd, "leftover.d.ts"), "export {};\n"); // untracked: not a change
    expect(uhdGitState(uhd, "0.3.0")!.dirty).toBe(false);
    rmSync(join(uhd, "leftover.d.ts"));
    expect(uhdGitState(join(scratch, "uhd-viewer"), "0.1.0")).toBeUndefined();
  });

  it("refuses to send an untagged UHD to a hosted registry, before it asks the registry anything", () => {
    const r = hosted([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("publish-stack: uhd has no tag v0.3.0");
    expect(r.stderr).toContain("--uhd-dev");
    expect(r.stdout).not.toContain("===");
  });

  it("does not hold a run that leaves UHD out to UHD's state", () => {
    // it gets as far as asking for the registry (there is none), so the UHD rule did not stop it
    const r = hosted(["--only", "@protoboardai/cloud"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no registry at https://registry.example.invalid/");
  });

  it("the local registry takes the untagged build under the plain version and says so (dry run)", async () => {
    const out = await local(["--only", "@deltarobotics/uhd"]);
    expect(out).toContain("publish-stack: note: uhd has no tag v0.3.0");
    expect(out).toContain("dry-run  @deltarobotics/uhd@0.3.0");
  }, 120_000);

  it("--uhd-dev publishes UHD under the dev version and pins the dependants' staged copies, not the repositories (dry run)", async () => {
    const dev = `0.3.0-dev.${git("rev-parse", "HEAD").slice(0, 7)}`;
    const before = readFileSync(join(scratch, "protoboard-cli/packages/core/package.json"), "utf8");
    const out = await local(["--uhd-dev", "--only", "@deltarobotics/uhd,@deltarobotics/uhd-viewer,@protoboardai/core"]);
    expect(out).toContain(`dry-run  @deltarobotics/uhd@${dev}`);
    expect(out).toContain(`@deltarobotics/uhd-viewer: @deltarobotics/uhd pinned to ${dev} (peerDependencies)`);
    expect(out).toContain(`@protoboardai/core: @deltarobotics/uhd pinned to ${dev} (dependencies, protoboard.toolchain)`);
    expect(readFileSync(join(scratch, "protoboard-cli/packages/core/package.json"), "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(join(uhd, "package.json"), "utf8")).version).toBe("0.3.0");
    expect(git("status", "--porcelain")).toBe("");
  }, 120_000);

  it("the tagged commit goes out under the plain version; a commit after it does not", async () => {
    git("tag", "v0.3.0");
    expect((await local(["--only", "@deltarobotics/uhd"]))).not.toContain("note:");
    // hosted: the rule passes, and the run stops only because there is no registry at that name
    expect(hosted(["--only", "@deltarobotics/uhd"]).stderr.trim()).toBe("publish-stack: no registry at https://registry.example.invalid/");
    writeFileSync(join(uhd, "index.js"), "export const later = true;\n");
    expect(hosted(["--only", "@deltarobotics/uhd"]).stderr).toContain("the uhd checkout has changes to tracked files");
    git("commit", "-q", "-am", "later");
    const r = hosted(["--only", "@deltarobotics/uhd"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("is not the commit tagged v0.3.0");
    expect(r.stderr).toContain(`0.3.1-dev.${git("rev-parse", "HEAD").slice(0, 7)}`);
  }, 120_000);

  it("published nothing", () => {
    expect(puts).toEqual([]);
  });
});

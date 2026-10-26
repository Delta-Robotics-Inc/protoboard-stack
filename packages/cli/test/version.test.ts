/**
 * `protoboard --version`: the bare version for scripts; with --json (or
 * --format json) where the build came from. Run from this checkout, the CLI
 * is a development build of this repository's commit.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
const home = mkdtempSync(join(tmpdir(), "pb-version-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
// the whole PATH: a checkout's commit is read from git
const pb = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: home, encoding: "utf8", timeout: 60_000, env: { HOME: home, PATH: process.env.PATH ?? "", PROTOBOARD_CREDENTIAL_STORE: "file" } });
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dirname(CLI), encoding: "utf8" });

describe("protoboard --version", () => {
  it("prints the bare version without --json", () => {
    const r = pb(["--version"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(PKG.version);
  });

  it.skipIf(head.status !== 0 || process.platform === "win32")("--json and --format json add the build: this checkout, not a release", () => {
    for (const flag of [["--json"], ["--format", "json"]]) {
      const r = pb(["--version", ...flag]);
      expect(r.status, r.stderr).toBe(0);
      const p = JSON.parse(r.stdout);
      expect(p).toMatchObject({ version: PKG.version, source: "checkout", release: false, commit: head.stdout.trim() });
      expect(typeof p.dirty).toBe("boolean");
    }
  });
});

describe("the user's Protoboard folders", () => {
  it.skipIf(process.platform === "win32")("any command makes ~/.config/protoboard and ~/.protoboard 0700 when an earlier version left them open (PB-1048)", () => {
    for (const d of [join(home, ".config", "protoboard"), join(home, ".protoboard")]) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o755);
    }
    expect(pb(["--version"]).status).toBe(0);
    expect(statSync(join(home, ".config", "protoboard")).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, ".protoboard")).mode & 0o777).toBe(0o700);
  });
});

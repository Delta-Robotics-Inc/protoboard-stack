/**
 * npm scope guard (PB-941): the packages are `@protoboardai/…`; `@protoboard`
 * on npmjs belongs to someone else. scripts/check-npm-scope.mjs fails on the
 * old scope in any tracked text file outside scripts/npm-scope-allowlist.json
 * (records of what ran under the old names, and what explains the rename).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/check-npm-scope.mjs");
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("npm scope", () => {
  it("no tracked file names the old scope, apart from the allowlist", () => {
    const r = run(["--root", ROOT, "--json"]);
    const { found, unused } = JSON.parse(r.stdout);
    expect(found, "write @protoboardai, or add the occurrence to scripts/npm-scope-allowlist.json with its reason").toEqual([]);
    expect(unused, "allowlist entries that match nothing").toEqual([]);
    expect(r.status).toBe(0);
  });

  const scratch = mkdtempSync(join(tmpdir(), "pb-scope-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("fails on every form of the old scope, not on its neighbours, keeps an allowlisted class, and flags a stale entry", () => {
    execFileSync("git", ["init", "-q", scratch]);
    mkdirSync(join(scratch, "scripts"));
    mkdirSync(join(scratch, "operations"));
    writeFileSync(join(scratch, "package.json"), '{ "dependencies": { "@protoboard/core": "^0.1.0", "@protoboardai/cli": "^0.1.1" } }\n');
    writeFileSync(join(scratch, ".npmrc"), "@protoboardai:registry=http://127.0.0.1:4873/\n@protoboard:registry=http://127.0.0.1:4873/\n");
    writeFileSync(join(scratch, "code.ts"), 'const ok = "@protoboard-test/ext-demo";\nconst mail = "parts@protoboard-cloud.iam.gserviceaccount.com";\nconst dir = join("node_modules", "@protoboard", "core");\nconst re = /@protoboard\\/ext-/;\n');
    writeFileSync(join(scratch, "operations/a.json"), '{ "extension": { "id": "@protoboard/ext-hardware" } }\n');
    writeFileSync(join(scratch, "scripts/npm-scope-allowlist.json"), JSON.stringify({ entries: [{ path: "operations/*.json", reason: "records" }, { path: "gone/**", reason: "stale" }] }));
    execFileSync("git", ["-C", scratch, "add", "-A"]);
    const r = run(["--root", scratch, "--json"]);
    expect(r.status).toBe(1);
    const { found, unused } = JSON.parse(r.stdout);
    expect(found.map((f: { path: string; line: number }) => `${f.path}:${f.line}`).sort()).toEqual([".npmrc:2", "code.ts:3", "code.ts:4", "package.json:1"]);
    expect(unused.map((e: { path: string }) => e.path)).toEqual(["gone/**"]);
  });
});

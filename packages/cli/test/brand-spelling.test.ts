/**
 * Brand spelling guard (PB-913): "Protoboard", with a lowercase b, everywhere.
 * scripts/check-brand-spelling.mjs fails on "ProtoBoard" in any tracked file
 * outside scripts/brand-spelling-allowlist.json.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/check-brand-spelling.mjs");
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

describe("brand spelling", () => {
  it("no tracked file of the stack spells it ProtoBoard, apart from the allowlist", () => {
    const r = run(["--root", ROOT, "--json"]);
    const { found, unused } = JSON.parse(r.stdout);
    expect(found, "spell it Protoboard, or add the occurrence to scripts/brand-spelling-allowlist.json with its reason").toEqual([]);
    expect(unused, "allowlist entries that match nothing").toEqual([]);
    expect(r.status).toBe(0);
  });

  const scratch = mkdtempSync(join(tmpdir(), "pb-brand-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("fails on the old spelling, keeps an allowlisted line, and flags a stale entry", () => {
    execFileSync("git", ["init", "-q", scratch]);
    mkdirSync(join(scratch, "scripts"));
    writeFileSync(join(scratch, "README.md"), "# Protoboard\n\nThe ProtoBoard CLI.\n");
    writeFileSync(join(scratch, "terms.json"), '{ "license": "LicenseRef-ProtoBoard-Library" }\n');
    writeFileSync(join(scratch, "code.ts"), "export const protoBoardTheme = 1;\n");
    writeFileSync(
      join(scratch, "scripts/brand-spelling-allowlist.json"),
      JSON.stringify({ entries: [{ path: "*.json", contains: "LicenseRef-ProtoBoard-Library", reason: "test" }, { path: "gone/**", reason: "stale" }] }),
    );
    execFileSync("git", ["-C", scratch, "add", "-A"]);
    const r = run(["--root", scratch, "--json"]);
    expect(r.status).toBe(1);
    const { found, unused } = JSON.parse(r.stdout);
    expect(found.map((f: { path: string; line: number }) => `${f.path}:${f.line}`).sort()).toEqual(["README.md:3", "code.ts:1"]);
    expect(unused.map((e: { path: string }) => e.path)).toEqual(["gone/**"]);
  });
});

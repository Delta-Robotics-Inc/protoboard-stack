/**
 * Reading a System Map back and telling whether it still describes the stack
 * (docs/specs/system-map.md, "Freshness").
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeSystemMap } from "../src/sysmap/build.js";
import { readSystemMap, sysmapFreshness } from "../src/sysmap/fresh.js";
import type { SysmapGitRunner } from "../src/sysmap/history.js";
import { noGit, stackFiles, writeFiles } from "./sysmap-fixture.js";

const TMP = mkdtempSync(join(tmpdir(), "protoboard-sysmap-fresh-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const OPTS = { git: noGit, stack: "1.0.0" };

let root: string;
let file: string;
let n = 0;
beforeEach(async () => {
  root = join(TMP, `stack-${n++}`);
  writeFiles(root, stackFiles());
  file = join(root, "..", `${n}.sysmap.json`);
  await writeSystemMap(root, { ...OPTS, file });
});

const read = () => {
  const r = readSystemMap(file);
  if ("error" in r) throw new Error(r.message);
  return r.map;
};

describe("readSystemMap", () => {
  it("reads a written map with the digest of its bytes", () => {
    const r = readSystemMap(file);
    expect("map" in r && r.map.schema).toBe("protoboard.sysmap/v0");
    expect("digest" in r && r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a missing, broken or foreign file", () => {
    expect(readSystemMap(join(TMP, "none.json"))).toMatchObject({ error: "MAP_MISSING" });
    const bad = join(TMP, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(readSystemMap(bad)).toMatchObject({ error: "MAP_INVALID" });
    writeFileSync(bad, JSON.stringify({ schema: "protoboard.atlas/v0" }));
    expect(readSystemMap(bad)).toMatchObject({ error: "MAP_SCHEMA" });
    writeFileSync(bad, JSON.stringify({ schema: "protoboard.sysmap/v0", stack: "1.0.0" }));
    expect(readSystemMap(bad)).toMatchObject({ error: "MAP_INVALID", message: "the System Map is missing fields" });
  });
});

describe("sysmapFreshness", () => {
  it("is fresh right after a build", async () => {
    const f = await sysmapFreshness(root, read(), OPTS);
    expect(f).toMatchObject({ fresh: true, added: [], removed: [], changed: [] });
    expect(f.checked).toBe(read().inputs.length);
  });

  it("stays fresh when a file is only touched", async () => {
    const p = join(root, "packages/ext-a/skills/board-make/SKILL.md");
    writeFileSync(p, stackFiles()["packages/ext-a/skills/board-make/SKILL.md"]);
    expect((await sysmapFreshness(root, read(), OPTS)).fresh).toBe(true);
  });

  it("names the files changed, added and removed", async () => {
    writeFiles(root, {
      "packages/ext-a/skills/board-make/SKILL.md": "---\nname: board-make\ndescription: Changed.\n---\n",
      "packages/ext-b/skills/new-one/SKILL.md": "---\nname: new-one\ndescription: New.\n---\n",
    });
    rmSync(join(root, "docs/specs/bar.md"));
    const f = await sysmapFreshness(root, read(), OPTS);
    expect(f).toMatchObject({
      fresh: false,
      reason: "files",
      changed: ["packages/ext-a/skills/board-make/SKILL.md"],
      added: ["packages/ext-b/skills/new-one/SKILL.md"],
      removed: ["docs/specs/bar.md"],
    });
  });

  it("is stale when another stack version built it, or the root became another kind of stack", async () => {
    expect(await sysmapFreshness(root, read(), { ...OPTS, stack: "2.0.0" })).toMatchObject({ fresh: false, reason: "stack", checked: 0 });
    expect(await sysmapFreshness(root, { ...read(), layout: "installed" }, OPTS)).toMatchObject({ fresh: false, reason: "layout" });
  });

  it("is stale when the history moved", async () => {
    const at = (head: string): SysmapGitRunner => async (args) => {
      if (args[0] === "rev-parse") return args[1] === "--is-inside-work-tree" ? "true\n" : `${head}\n`;
      if (args[0] === "for-each-ref") return "v1.0.0\t\tabc\t2026-01-01\n";
      if (args.includes("diff") || args.includes("ls-files")) return "";
      return null;
    };
    const withHistory = { ...read(), history: { head: "one", tags: ["v1.0.0=abc"], dirty: "sha256:" + "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } };
    expect((await sysmapFreshness(root, withHistory, { stack: "1.0.0", git: at("one") })).fresh).toBe(true);
    expect(await sysmapFreshness(root, withHistory, { stack: "1.0.0", git: at("two") })).toMatchObject({ fresh: false, reason: "history" });
    expect(await sysmapFreshness(root, withHistory, { stack: "1.0.0", git: noGit })).toMatchObject({ fresh: false, reason: "history" });
  });
});

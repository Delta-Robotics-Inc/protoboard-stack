/**
 * Where a project's releases are (PB-1018): `release/<version>/`, as the
 * stack writes them; `releases/<version>/`, the name the project-structure
 * spec once gave, is read too, and `release/` wins for a version in both.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listReleases } from "../lib/cost.ts";

const TMP = mkdtempSync(join(tmpdir(), "pb-releases-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const release = (root: string, folder: string, version: string, date: string) => {
  mkdirSync(join(root, folder, version), { recursive: true });
  writeFileSync(join(root, folder, version, "manifest.json"), JSON.stringify({ version, date }));
};

describe("listReleases", () => {
  it("lists release/ and the earlier releases/, newest first, release/ winning a version in both", () => {
    release(TMP, "release", "0.3.0", "2026-10-15T00:00:00Z");
    release(TMP, "releases", "0.2.0", "2026-10-01T00:00:00Z");
    release(TMP, "releases", "0.3.0", "2026-09-01T00:00:00Z");
    const r = listReleases(TMP);
    expect(r.map((x) => x.version)).toEqual(["0.3.0", "0.2.0"]);
    expect(r[0].dir).toBe(join(TMP, "release", "0.3.0"));
    expect(r[1].dir).toBe(join(TMP, "releases", "0.2.0"));
  });
});

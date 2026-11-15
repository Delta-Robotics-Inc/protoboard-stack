/**
 * Reading the Atlas index and its freshness (docs/specs/atlas.md,
 * "Freshness"): a touched file stays fresh, a changed, added or removed one
 * makes the index stale, and so do another stack version or enumerator.
 */
import { mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject, sha256 } from "../src/index.js";
import { writeAtlasIndex, type AtlasGitRunner } from "../src/atlas/build.js";
import { atlasFreshness, readAtlasIndex } from "../src/atlas/fresh.js";
import { ATLAS_SCHEMA, type AtlasIndex } from "../src/atlas/model.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/atlas-fresh");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** No git: the temporary projects sit in an ignored folder of this repository, so they are walked. */
const noGit: AtlasGitRunner = async () => null;

let n = 0;
async function built() {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string> = {
    "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
    "package.json": JSON.stringify({ name: "atlas-fresh", type: "module" }),
    "src/sys.uhd.ts": `export const SYS = { id: "sys", name: "System", interfaces: [], artifacts: [{ id: "brief", name: "Brief", type: "documentation", filePath: "docs/brief.md" }] };\n`,
    "docs/brief.md": "# Brief\n",
    "docs/notes.md": "# Notes\n",
    "renders/front.png": "png front",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  const p = await loadProject(dir, { checks: false, extensions: false });
  const w = await writeAtlasIndex(p, { git: noGit });
  const read = readAtlasIndex(dir);
  if (!("index" in read)) throw new Error(read.message);
  return { dir, index: read.index, digest: read.digest, written: w };
}

/** Move a file's mtime a minute later without changing its bytes. */
const touch = (file: string) => {
  const later = new Date(Date.now() + 60_000);
  utimesSync(file, later, later);
};

describe("readAtlasIndex", () => {
  it("reads the index and the digest of its bytes", async () => {
    const { dir, index, digest, written } = await built();
    expect(index.schema).toBe(ATLAS_SCHEMA);
    expect(digest).toBe(sha256(readFileSync(join(dir, ".protoboard/build/atlas.json"))));
    expect(digest).toBe(written.digest);
  });

  it("refuses a missing, invalid or foreign index with a code", async () => {
    const { dir } = await built();
    expect(readAtlasIndex(join(dir, "nowhere"))).toMatchObject({ error: "INDEX_MISSING" });
    const file = join(dir, "other.json");
    writeFileSync(file, "{ not json");
    expect(readAtlasIndex(dir, file)).toMatchObject({ error: "INDEX_INVALID" });
    writeFileSync(file, JSON.stringify({ schema: "protoboard.atlas/v9" }));
    expect(readAtlasIndex(dir, file)).toMatchObject({ error: "INDEX_SCHEMA" });
    writeFileSync(file, JSON.stringify({ schema: ATLAS_SCHEMA, stack: "0.3.0" }));
    expect(readAtlasIndex(dir, file)).toMatchObject({ error: "INDEX_INVALID" });
    writeFileSync(file, "[]");
    expect(readAtlasIndex(dir, file)).toMatchObject({ error: "INDEX_INVALID" });
  });
});

describe("atlasFreshness", () => {
  it("is fresh right after a build", async () => {
    const { dir, index } = await built();
    const f = await atlasFreshness(dir, index, { git: noGit });
    expect(f).toEqual({ fresh: true, added: [], removed: [], changed: [], checked: index.inputs.length });
  });

  it("stays fresh for a file only touched (same bytes), unless the hash budget is spent", async () => {
    const { dir, index } = await built();
    touch(join(dir, "docs/notes.md"));
    expect((await atlasFreshness(dir, index, { git: noGit })).fresh).toBe(true);
    expect(await atlasFreshness(dir, index, { git: noGit, hashBudgetBytes: 0 })).toMatchObject({ fresh: false, reason: "files", changed: ["docs/notes.md"] });
  });

  it("is stale when a document changes, even at the same size", async () => {
    const { dir, index } = await built();
    writeFileSync(join(dir, "docs/notes.md"), "# Nope!\n"); // as many bytes as "# Notes\n"
    touch(join(dir, "docs/notes.md"));
    expect(await atlasFreshness(dir, index, { git: noGit })).toMatchObject({ fresh: false, reason: "files", changed: ["docs/notes.md"], added: [], removed: [] });
    writeFileSync(join(dir, "docs/brief.md"), "# Brief, rewritten\n");
    expect((await atlasFreshness(dir, index, { git: noGit })).changed).toEqual(["docs/brief.md", "docs/notes.md"]);
  });

  it("names added and removed files", async () => {
    const { dir, index } = await built();
    writeFileSync(join(dir, "docs/new.md"), "# New\n");
    unlinkSync(join(dir, "renders/front.png"));
    expect(await atlasFreshness(dir, index, { git: noGit })).toMatchObject({ fresh: false, reason: "files", added: ["docs/new.md"], removed: ["renders/front.png"], changed: [] });
  });

  it("ignores files the index never covers (dot-files, secrets, its own build folder)", async () => {
    const { dir, index } = await built();
    writeFileSync(join(dir, ".env"), "TOKEN=x\n");
    writeFileSync(join(dir, "server.pem"), "-----BEGIN-----\n");
    writeFileSync(join(dir, ".protoboard/build/other.json"), "{}\n");
    expect((await atlasFreshness(dir, index, { git: noGit })).fresh).toBe(true);
  });

  it("is stale for another stack version", async () => {
    const { dir, index } = await built();
    expect(await atlasFreshness(dir, index, { git: noGit, stack: "0.0.1" })).toEqual({ fresh: false, reason: "stack", added: [], removed: [], changed: [], checked: 0 });
  });

  it("is stale for an index built before creation times were recorded (no counts.created), and still reads it", async () => {
    const { dir, index } = await built();
    expect(index.counts.created).toBeDefined();
    const { created: _created, ...counts } = index.counts;
    const older = { ...index, counts, nodes: index.nodes.map(({ created: _c, ...n }) => n) } as AtlasIndex;
    expect(await atlasFreshness(dir, older, { git: noGit })).toEqual({ fresh: false, reason: "history", added: [], removed: [], changed: [], checked: 0 });
    // the file itself still loads: a missing `created` is not INDEX_INVALID
    const file = join(dir, "older.json");
    writeFileSync(file, JSON.stringify(older));
    expect(readAtlasIndex(dir, file)).toMatchObject({ index: { counts: { nodes: index.counts.nodes } } });
    // another stack version is said first
    expect((await atlasFreshness(dir, older, { git: noGit, stack: "0.0.1" })).reason).toBe("stack");
  });

  it("is stale when the enumerator changes (git appears or goes)", async () => {
    const { dir, index } = await built();
    expect(index.enumerator).toBe("walk");
    const git: AtlasGitRunner = async (args) => (args[0] === "rev-parse" ? "true\n" : args[0] === "check-ignore" ? null : index.inputs.map((i) => i[0]).join("\0"));
    expect(await atlasFreshness(dir, index, { git })).toMatchObject({ fresh: false, reason: "enumerator" });
  });

  it("caps each list at 20 paths", async () => {
    const { dir, index } = await built();
    for (let i = 0; i < 25; i++) writeFileSync(join(dir, `docs/extra-${String(i).padStart(2, "0")}.md`), `# ${i}\n`);
    const f = await atlasFreshness(dir, index, { git: noGit });
    expect(f.fresh).toBe(false);
    expect(f.added).toHaveLength(20);
  });

  it("never writes: the index and the project are left as they were", async () => {
    const { dir, index } = await built();
    const before = readFileSync(join(dir, ".protoboard/build/atlas.json"), "utf8");
    writeFileSync(join(dir, "docs/notes.md"), "# Notes, changed\n");
    await atlasFreshness(dir, index as AtlasIndex, { git: noGit });
    expect(readFileSync(join(dir, ".protoboard/build/atlas.json"), "utf8")).toBe(before);
  });
});

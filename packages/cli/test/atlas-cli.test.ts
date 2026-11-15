/**
 * `protoboard build` writes the project index, and `protoboard index census |
 * where | search` read it (docs/specs/atlas.md): small pages in a stable
 * order, JSON with --format json, and a refusal with exit code 3 (no partial
 * answer) when the index is missing, unreadable, from another schema or older
 * than the project's files. Plus the three MCP tools that run them.
 *
 * Every project here is a copy under test/.tmp/atlas-cli: the examples' own
 * folders are never built or changed.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATLAS_FILE, ATLAS_SCHEMA, type AtlasIndex, type CensusEntry } from "@protoboardai/core";
import { closestNames, createdText, decodeCursor, encodeCursor, staleMessage } from "../src/atlas.js";
import { DESCRIPTION_LIMIT } from "../src/mcp/instructions.js";
import { INDEX_ACTION, cliTools } from "../src/mcp/tools.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp", "atlas-cli");
const CLI = join(HERE, "../bin/protoboard.mjs");
const EXAMPLE = join(HERE, "../../../examples/quadcopter-5in");
const QUAD = join(TMP, "quad");
const SMALL = join(TMP, "small");

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  json: any;
}

/** Run the CLI in a project, without blocking the test worker (long synchronous runs starve vitest's own messages). */
const cliIn = (env: NodeJS.ProcessEnv, dir: string, ...args: string[]): Promise<Run> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args, "--cwd", dir], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      done({ code, stdout, stderr, json });
    });
  });
const cli = (dir: string, ...args: string[]) => cliIn(process.env, dir, ...args);

/** A small project: a system, a module with a STEP body, an image nobody links, notes and a secret. */
function smallProject(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string> = {
    "protoboard.config.ts": `import { writeFileSync } from "node:fs";\nimport { defineConfig } from "@protoboardai/core";\n// the tests set this to prove that index queries never evaluate the project's TypeScript\nif (process.env.PB_ATLAS_TEST_MARK) writeFileSync(process.env.PB_ATLAS_TEST_MARK, "evaluated");\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
    "src/sys.uhd.ts": [
      `const bracket = { id: "bracket", name: "Motor bracket", interfaces: [], artifacts: [{ id: "body", name: "Bracket body", type: "3d_model", filePath: "cad/bracket.step" }] };`,
      `export const DEFS = [bracket];`,
      `export const SYS = { id: "sys", name: "Test system", interfaces: [], children: [{ id: "left", moduleDefId: "bracket" }, { id: "right", moduleDefId: "bracket" }] };`,
      "",
    ].join("\n"),
    "cad/bracket.step": "ISO-10303-21;\nEND-ISO-10303-21;\n",
    "docs/notes.md": "# Notes\n\nThe bracket holds the motor.\nNothing else here.\nThe Motor and the bracket again, together.\n",
    "docs/renders/hero.png": "not really a png",
    ".env": "SECRET=1\n",
    "package.json": JSON.stringify({ name: "atlas-small", private: true, type: "module" }) + "\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

const indexOf = (dir: string) => JSON.parse(readFileSync(join(dir, ATLAS_FILE), "utf8")) as AtlasIndex;

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  cpSync(EXAMPLE, QUAD, { recursive: true, filter: (src) => !/[\\/](node_modules|\.protoboard[\\/](build|cache|tools|local|evals)|release)([\\/]|$)/.test(src) });
  const built = await cli(QUAD, "build", "--format", "json");
  if (built.code !== 0) throw new Error(`the quadcopter copy did not build: ${built.stderr || built.stdout}`);
}, 300_000);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("protoboard build writes the project index", () => {
  it("after the bundle, with its counts in the JSON and one line of text", async () => {
    smallProject(SMALL);
    const r = await cli(SMALL, "build", "--json");
    expect(r.code).toBe(0);
    expect(r.json.atlas).toMatchObject({ bytes: expect.any(Number), digest: expect.stringMatching(/^sha256:/), problems: 0 });
    expect(r.json.atlas.file.replace(/\\/g, "/")).toMatch(/\.protoboard\/build\/atlas\.json$/);
    // the census: the STEP body (linked), the render and the notes (unlinked); the .env file only counted
    expect(r.json.atlas.counts.census).toEqual({ total: 3, linked: 1, unlinked: 2, failed: 0, excluded: 1 });
    expect(indexOf(SMALL).schema).toBe(ATLAS_SCHEMA);
    const text = await cli(SMALL, "build");
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/wrote .*atlas\.json \(project index: 3 asset files, 1 linked, 2 unlinked; \d+ nodes\)/);
  }, 120_000);

  it("an index that cannot be written is reported, and the build's exit code stands", async () => {
    smallProject(SMALL);
    // a folder where the index's file goes: the rename over it fails
    mkdirSync(join(SMALL, ATLAS_FILE, "blocked"), { recursive: true });
    const r = await cli(SMALL, "build", "--json");
    expect(r.code).toBe(0);
    expect(r.json.atlas.error).toEqual(expect.any(String));
    expect(existsSync(join(SMALL, ".protoboard/build/uhd-bundle.json"))).toBe(true);
    const text = await cli(SMALL, "build");
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/project index not written: .*the build stands/);
    // and the queries refuse what is there
    const q = await cli(SMALL, "index", "census", "--json");
    expect(q.code).toBe(3);
    expect(q.json.code).toBe("INDEX_INVALID");
  }, 120_000);
});

describe("index census", () => {
  it("lists every asset file in path order, with stable bytes and the counts of the whole census", async () => {
    const a = await cli(QUAD, "index", "census", "--format", "json");
    const b = await cli(QUAD, "index", "census", "--json");
    expect(a.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    const index = indexOf(QUAD);
    expect(a.json).toMatchObject({ schema: "protoboard.atlas-query/v0", total: index.census.length, query: { command: "census", limit: 20 } });
    expect(a.json.items).toHaveLength(20);
    expect(a.json.counts).toMatchObject(index.counts.census);
    expect(a.json.counts.byKind.render.linked + a.json.counts.byKind.render.unlinked).toBe(index.census.filter((c) => c.kind === "render").length);
    const paths = a.json.items.map((i: CensusEntry) => i.path);
    expect(paths).toEqual([...paths].sort((x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)));
    // the frame's STEP body is linked by its artifact, and says whose it is
    const all = await cli(QUAD, "index", "census", "--kind", "cad", "--limit", "200", "--json");
    expect(all.json.items.find((i: { path: string }) => i.path === "src/modules/frame/out/body.step")).toMatchObject({ status: "linked", owners: ["quadcopter-5in-frame"] });
  }, 120_000);

  it("pages through nextCursor, covering every file exactly once", async () => {
    const index = indexOf(QUAD);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 50; pages++) {
      const r = await cli(QUAD, "index", "census", "--limit", "37", "--json", ...(cursor ? ["--cursor", cursor] : []));
      expect(r.code).toBe(0);
      seen.push(...r.json.items.map((i: CensusEntry) => i.path));
      cursor = r.json.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(index.census.map((c) => c.path));
    expect(new Set(seen).size).toBe(seen.length);
  }, 300_000);

  it("filters by kind and by status; an empty answer is exit 0", async () => {
    const renders = await cli(QUAD, "index", "census", "--kind", "render", "--status", "unlinked", "--limit", "200", "--json");
    expect(renders.code).toBe(0);
    expect(renders.json.total).toBeGreaterThan(0);
    for (const i of renders.json.items) expect(i).toMatchObject({ kind: "render", status: "unlinked" });
    // a kind's plural label is the kind
    expect((await cli(QUAD, "index", "census", "--kind", "renders", "--status", "unlinked", "--limit", "200", "--json")).stdout).toBe(renders.stdout);
    const none = await cli(QUAD, "index", "census", "--status", "failed", "--json");
    expect(none.code).toBe(0);
    expect(none.json).toMatchObject({ total: 0, items: [] });
    expect(none.json.nextCursor).toBeUndefined();
    const text = await cli(QUAD, "index", "census", "--status", "failed");
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/no asset files failed/);
  }, 120_000);

  it("text: one line per file, path, kind, status and who links it, and the next page", async () => {
    const r = await cli(QUAD, "index", "census", "--kind", "cad", "--limit", "3");
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^\d+ asset file\(s\): \d+ linked, \d+ unlinked, 0 failed/);
    expect(lines.filter((l) => /^\S+\s+cad\s+(linked|unlinked)/.test(l))).toHaveLength(3);
    expect(lines.at(-1)).toMatch(/^showing 1-3 of \d+; the next page: --cursor 3\.[0-9a-f]{12}$/);
  }, 120_000);
});

describe("creation times in the answers", () => {
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  it("census, where and search carry each file's created, as on its node, and the text says it", async () => {
    smallProject(SMALL);
    expect((await cli(SMALL, "build")).code).toBe(0);
    const index = indexOf(SMALL);
    // not in a git work tree of its own (an ignored folder): the file system's birth times
    expect(index.counts.created).toEqual({ git: 0, birthtime: expect.any(Number), mtime: expect.any(Number), none: expect.any(Number) });
    const c = index.counts.created!;
    expect(c.git + c.birthtime + c.mtime + c.none).toBe(index.nodes.length);
    const step = index.nodes.find((n) => n.id === "file:cad/bracket.step")!;
    expect(step.created).toEqual({ at: expect.any(Number), from: expect.stringMatching(/^(birthtime|mtime)$/) });

    const census = await cli(SMALL, "index", "census", "--json");
    expect(census.code).toBe(0);
    expect(census.json.items.find((i: { path: string }) => i.path === "cad/bracket.step").created).toEqual(step.created);
    for (const i of census.json.items) expect(i.created, i.path).toEqual(index.nodes.find((n) => n.id === `file:${i.path}`)!.created);
    const day = new Date(step.created!.at).toISOString().slice(0, 10);
    expect(day).toMatch(DAY);
    const text = await cli(SMALL, "index", "census");
    const line = text.stdout.split(/\r?\n/).find((l) => l.startsWith("cad/bracket.step"))!;
    expect(line.split(/\s{2,}/)).toEqual(["cad/bracket.step", "cad", "linked", `created ${day} (${step.created!.from})`, "bracket"]);

    const where = await cli(SMALL, "index", "where", "cad/bracket.step", "--json");
    expect(where.json.node.created).toEqual(step.created);
    const def = index.nodes.find((n) => n.id === "def:bracket")!;
    expect(def.created).toEqual(index.nodes.find((n) => n.id === "def:sys")!.created); // both are defined in src/sys.uhd.ts
    expect(where.json.items).toContainEqual(expect.objectContaining({ relation: "owned-by", node: "def:bracket", created: def.created }));
    const whereText = await cli(SMALL, "index", "where", "cad/bracket.step");
    expect(whereText.stdout.split(/\r?\n/)[0]).toBe(`cad/bracket.step (cad, ok), ${createdText(step.created)}`);

    const search = await cli(SMALL, "index", "search", "bracket", "--limit", "200", "--json");
    expect(search.json.items.find((h: { node: string }) => h.node === "file:cad/bracket.step").created).toEqual(step.created);
    const notes = index.nodes.find((n) => n.id === "file:docs/notes.md")!;
    for (const h of search.json.items.filter((x: { match: string }) => x.match === "text")) expect(h.created).toEqual(notes.created);
  }, 120_000);

  it("createdText: the UTC date and the source, nothing for none", () => {
    expect(createdText({ at: Date.UTC(2026, 10, 3, 23, 59), from: "git" })).toBe("created 2026-11-03 (git)");
    expect(createdText({ at: Date.UTC(2026, 0, 1), from: "mtime" })).toBe("created 2026-01-01 (mtime)");
    expect(createdText(undefined)).toBe("");
  });
});

describe("index where", () => {
  it("resolves an instance path to its definition, with its files and neighbors by relation", async () => {
    const r = await cli(QUAD, "index", "where", "frame", "--limit", "200", "--json");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ matchedBy: "instance", node: { id: "def:quadcopter-5in-frame", kind: "module" }, instances: ["frame"], query: { command: "where", ref: "frame" } });
    expect(r.json.items).toContainEqual(expect.objectContaining({ relation: "has", node: "file:src/modules/frame/out/body.step", kind: "cad", status: "ok", via: ["cad_step"] }));
    expect(r.json.items).toContainEqual(expect.objectContaining({ relation: "contained-by", node: "def:quadcopter-5in", definition: "quadcopter-5in" }));
    // the relations come in a fixed order
    const order = ["has", "made-from", "source-of", "contains", "uses", "contained-by", "used-by", "owned-by", "link", "harness"];
    const ranks = r.json.items.map((i: { relation: string }) => order.indexOf(i.relation));
    expect(ranks.every((x: number) => x >= 0)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));
    // the same definition by its id
    const byId = await cli(QUAD, "index", "where", "quadcopter-5in-frame", "--limit", "200", "--json");
    expect(byId.json).toMatchObject({ matchedBy: "definition", node: { id: "def:quadcopter-5in-frame" } });
    expect(byId.json.items).toEqual(r.json.items);
  }, 120_000);

  it("an instance of a part shared by four arms is one definition, its instances listed", async () => {
    const r = await cli(QUAD, "index", "where", "arm_fl/motor", "--json");
    expect(r.code).toBe(0);
    expect(r.json.node).toMatchObject({ id: "def:meps-neon-2207-v2-1950kv", kind: "part" });
    expect(r.json.instances).toEqual(["arm_fl/motor", "arm_fr/motor", "arm_rl/motor", "arm_rr/motor"]);
    expect(r.json.items).toContainEqual(expect.objectContaining({ relation: "used-by", node: "def:quadcopter-5in-arm" }));
    const step = await cli(QUAD, "index", "where", "arm_fl/motor", "--kind", "cad", "--json");
    expect(step.json.items.length).toBeGreaterThan(0);
    for (const i of step.json.items) expect(i.kind).toBe("cad");
  }, 120_000);

  it("a file path gives the file and what owns it", async () => {
    const r = await cli(QUAD, "index", "where", "src/modules/frame/out/body.step", "--json");
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ matchedBy: "path", node: { id: "file:src/modules/frame/out/body.step", kind: "cad" } });
    expect(r.json.items).toContainEqual(expect.objectContaining({ relation: "owned-by", node: "def:quadcopter-5in-frame" }));
  }, 120_000);

  it("an unknown ref is a usage error (exit 2) that names the closest names", async () => {
    const r = await cli(QUAD, "index", "where", "frme", "--json");
    expect(r.code).toBe(2);
    expect(r.json.error).toMatch(/nothing in the project index is called "frme".*closest: frame/);
    expect(r.json.items).toBeUndefined();
    expect(closestNames("frme", ["frame", "flux", "battery", "arm_fl/motor"], 5)).toEqual(["frame", "flux"]);
  }, 120_000);
});

describe("index search", () => {
  it("lists exact matches first, then names, paths, a kind and the documents' lines", async () => {
    smallProject(SMALL);
    expect((await cli(SMALL, "build")).code).toBe(0);
    const r = await cli(SMALL, "index", "search", "bracket", "--limit", "200", "--json");
    expect(r.code).toBe(0);
    const matches = r.json.items.map((h: { match: string }) => h.match);
    const order = ["exact", "name", "path", "kind", "text"];
    expect(matches.map((m: string) => order.indexOf(m))).toEqual([...matches.map((m: string) => order.indexOf(m))].sort((a, b) => a - b));
    expect(r.json.items[0]).toMatchObject({ match: "exact", node: "def:bracket" });
    // a file's name is its file name: bracket.step holds the word
    expect(r.json.items).toContainEqual(expect.objectContaining({ match: "name", node: "file:cad/bracket.step" }));
    // full text: every word on the line, any case; path and line number
    const text = r.json.items.filter((h: { match: string }) => h.match === "text");
    expect(text.map((h: { path: string; line: number }) => `${h.path}:${h.line}`)).toEqual(["docs/notes.md:3", "docs/notes.md:5"]);
    const both = await cli(SMALL, "index", "search", "MOTOR", "bracket", "--json");
    expect(both.json.items.filter((h: { match: string }) => h.match === "text").map((h: { line: number; text: string }) => [h.line, h.text])).toEqual([
      [3, "The bracket holds the motor."],
      [5, "The Motor and the bracket again, together."],
    ]);
    // a kind by its label: every file of that kind
    const cad = await cli(SMALL, "index", "search", "CAD", "files", "--json");
    expect(cad.json.items).toEqual([expect.objectContaining({ match: "kind", path: "cad/bracket.step", kind: "cad" })]);
    // never a sensitive file, never the hash of one
    expect((await cli(SMALL, "index", "search", "SECRET", "--json")).json.total).toBe(0);
    expect(readFileSync(join(SMALL, ATLAS_FILE), "utf8")).not.toMatch(/\.env/);
  }, 120_000);

  it("text: path:line and the line; nothing found is exit 0", async () => {
    const r = await cli(SMALL, "index", "search", "holds", "motor");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^text\s+doc\s+docs\/notes\.md:3\s+The bracket holds the motor\./m);
    const none = await cli(SMALL, "index", "search", "zzz-nothing");
    expect(none.code).toBe(0);
    expect(none.stdout).toMatch(/nothing in the project index matches "zzz-nothing"/);
  }, 120_000);

  it("on the quadcopter: an instance path is an exact hit, and a long line is cut to 160 characters", async () => {
    const r = await cli(QUAD, "index", "search", "frame", "--limit", "200", "--json");
    expect(r.code).toBe(0);
    expect(r.json.items[0]).toMatchObject({ match: "exact", node: "def:quadcopter-5in-frame" });
    for (const h of r.json.items.filter((x: { match: string }) => x.match === "text")) expect(h.text.length).toBeLessThanOrEqual(160);
  }, 120_000);
});

describe("refusals: exit 3, no partial answer", () => {
  beforeAll(async () => {
    smallProject(SMALL);
    const built = await cli(SMALL, "build");
    if (built.code !== 0) throw new Error(built.stderr);
  }, 120_000);

  it("a document changed after the build: INDEX_STALE, naming the file", async () => {
    expect((await cli(SMALL, "index", "census", "--json")).code).toBe(0);
    writeFileSync(join(SMALL, "docs/notes.md"), "# Notes, edited\n");
    for (const args of [["census"], ["where", "bracket"], ["search", "bracket"]]) {
      const r = await cli(SMALL, "index", ...args, "--json");
      expect(r.code, args.join(" ")).toBe(3);
      expect(r.json).toMatchObject({ code: "INDEX_STALE", error: expect.stringMatching(/older than the project's files: docs\/notes\.md \(changed\).*run `protoboard build`/) });
      expect(r.json.items).toBeUndefined();
      expect(r.json.total).toBeUndefined();
      expect(r.json.freshness).toMatchObject({ fresh: false, reason: "files", changed: ["docs/notes.md"] });
    }
    const text = await cli(SMALL, "index", "census");
    expect(text.code).toBe(3);
    expect(text.stdout).toBe("");
    expect(text.stderr).toMatch(/^protoboard: the project index is older than the project's files: docs\/notes\.md \(changed\)/);
    // a file added is stale too
    writeFileSync(join(SMALL, "docs/more.md"), "more\n");
    expect((await cli(SMALL, "index", "census", "--json")).json.error).toMatch(/docs\/more\.md \(added\)/);
  }, 120_000);

  it("a cursor from an earlier index is refused once the project is built again (exit 2)", async () => {
    expect((await cli(SMALL, "build")).code).toBe(0);
    const first = await cli(SMALL, "index", "census", "--limit", "1", "--json");
    expect(first.json.nextCursor).toMatch(/^1\.[0-9a-f]{12}$/);
    writeFileSync(join(SMALL, "docs/more.md"), "more, changed\n");
    expect((await cli(SMALL, "build")).code).toBe(0);
    const again = await cli(SMALL, "index", "census", "--limit", "1", "--cursor", first.json.nextCursor, "--json");
    expect(again.code).toBe(2);
    expect(again.json.error).toMatch(/earlier project index/);
    expect((await cli(SMALL, "index", "census", "--cursor", "nonsense", "--json")).code).toBe(2);
  }, 120_000);

  it("no index, an unreadable one, and one of another schema", async () => {
    expect((await cli(SMALL, "build")).code).toBe(0);
    const file = join(SMALL, ATLAS_FILE);
    const good = readFileSync(file, "utf8");
    writeFileSync(file, good.replace(ATLAS_SCHEMA, "protoboard.atlas/v99"));
    expect(await cli(SMALL, "index", "where", "bracket", "--json")).toMatchObject({ code: 3, json: { code: "INDEX_SCHEMA" } });
    writeFileSync(file, "{ not json");
    expect(await cli(SMALL, "index", "search", "bracket", "--json")).toMatchObject({ code: 3, json: { code: "INDEX_INVALID" } });
    rmSync(file);
    const missing = await cli(SMALL, "index", "census", "--json");
    expect(missing).toMatchObject({ code: 3, json: { code: "INDEX_MISSING", error: expect.stringMatching(/run `protoboard build`/) } });
  }, 120_000);

  it("an index built before creation times were recorded: INDEX_STALE, saying so", async () => {
    smallProject(SMALL);
    expect((await cli(SMALL, "build")).code).toBe(0);
    const file = join(SMALL, ATLAS_FILE);
    const index = JSON.parse(readFileSync(file, "utf8"));
    delete index.counts.created;
    for (const n of index.nodes) delete n.created;
    for (const c of index.census) delete c.created;
    writeFileSync(file, JSON.stringify(index));
    const r = await cli(SMALL, "index", "census", "--json");
    expect(r.code).toBe(3);
    expect(r.json).toMatchObject({ code: "INDEX_STALE", freshness: { fresh: false, reason: "history", added: [], removed: [], changed: [], checked: 0 } });
    expect(r.json.error).toBe("the project index was built before creation times were recorded; run `protoboard build` to index the project again");
    expect(r.json.items).toBeUndefined();
    const text = await cli(SMALL, "index", "where", "bracket");
    expect(text.code).toBe(3);
    expect(text.stderr).toMatch(/^protoboard: the project index was built before creation times were recorded; run `protoboard build`/);
    // a build answers again
    expect((await cli(SMALL, "build")).code).toBe(0);
    expect((await cli(SMALL, "index", "census", "--json")).code).toBe(0);
  }, 120_000);

  it("usage errors are exit 2, whatever the index", async () => {
    for (const args of [[], ["bogus"], ["where"], ["search"], ["census", "extra"], ["census", "--limit", "0"], ["census", "--limit", "201"], ["census", "--status", "lost"], ["census", "--kind", "module"], ["where", "x", "--status", "linked"], ["search", "x", "--kind", "cad"]]) {
      const r = await cli(SMALL, "index", ...args, "--json");
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.json.error, args.join(" ")).toEqual(expect.any(String));
    }
    // outside a project
    const outside = spawnSync(process.execPath, [CLI, "index", "census", "--json"], { encoding: "utf8", cwd: tmpdir(), timeout: 60_000 });
    expect(outside.status).toBe(2);
    expect(JSON.parse(outside.stdout).error).toMatch(/no protoboard\.config\.ts/);
  }, 180_000);

  it("the stale message names at most five files", async () => {
    const index = { stack: "0.0.0", enumerator: "git" } as AtlasIndex;
    const many = Array.from({ length: 8 }, (_, i) => `docs/n${i}.md`);
    const m = staleMessage(index, { fresh: false, reason: "files", added: [], removed: [], changed: many, checked: 8 });
    expect(m.match(/\(changed\)/g)).toHaveLength(5);
    expect(m).toMatch(/and 3 more; run `protoboard build`/);
    expect(staleMessage(index, { fresh: false, reason: "stack", added: [], removed: [], changed: [], checked: 0 })).toMatch(/written by Protoboard 0\.0\.0/);
    expect(staleMessage(index, { fresh: false, reason: "history", added: [], removed: [], changed: [], checked: 0 })).toBe("the project index was built before creation times were recorded; run `protoboard build` to index the project again");
    expect(decodeCursor(encodeCursor(40, "sha256:0123456789abcdef"), "sha256:0123456789abcdef")).toBe(40);
  });
});

describe("no query runs the project's code", () => {
  it("protoboard.config.ts is not evaluated by index census, where or search (it is by check)", async () => {
    smallProject(SMALL);
    expect((await cli(SMALL, "build")).code).toBe(0);
    const mark = join(TMP, "evaluated.txt");
    rmSync(mark, { force: true });
    const run = (...args: string[]) => cliIn({ ...process.env, PB_ATLAS_TEST_MARK: mark }, SMALL, ...args);
    for (const args of [["index", "census"], ["index", "where", "left"], ["index", "search", "bracket"]]) {
      expect((await run(...args)).code, args.join(" ")).toBe(0);
      expect(existsSync(mark), args.join(" ")).toBe(false);
    }
    // the mark works: a command that loads the project writes it
    await run("check");
    expect(existsSync(mark)).toBe(true);
  }, 180_000);

  it("queries change no file of the project", async () => {
    const before = statSync(join(SMALL, ATLAS_FILE)).mtimeMs;
    expect((await cli(SMALL, "index", "search", "motor")).code).toBe(0);
    expect(statSync(join(SMALL, ATLAS_FILE)).mtimeMs).toBe(before);
    expect((await cli(SMALL, "index", "census", "--json")).code).toBe(0);
  }, 120_000);
});

describe("the MCP tools", () => {
  const clients: Client[] = [];
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
  });

  async function connect(cwd: string): Promise<Client> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("PROTOBOARD_") && k !== "npm_config_registry")) as Record<string, string>;
    const client = new Client({ name: "protoboard-atlas-test", version: "0" });
    // no tool here reaches a parts service: an address that answers nothing
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd, stderr: "pipe", env: { ...env, PROTOBOARD_CONFIG_DIR: join(TMP, "config"), PROTOBOARD_CLOUD_URL: "http://127.0.0.1:9" } }));
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })) as { content: { text: string }[]; isError?: boolean };
    return { data: JSON.parse(r.content[0]!.text), isError: r.isError === true };
  }

  it("are listed, short enough, and say they read only the index", async () => {
    const tools = cliTools([]);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["project_census", "project_where", "project_search"]));
    for (const name of ["project_census", "project_where", "project_search"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.description.length, name).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      expect(t.description, name).toMatch(/Reads only the project index/);
      expect(t.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    expect(tools.find((x) => x.name === "project_build")!.description).toMatch(/project index that project_census, project_where and project_search read/);
  });

  it("answer from the index, and when it is stale say to call project_build", async () => {
    smallProject(SMALL);
    expect((await cli(SMALL, "build")).code).toBe(0);
    const client = await connect(TMP);
    const census = await call(client, "project_census", { dir: "small", status: "unlinked" });
    expect(census.isError).toBe(false);
    expect(census.data.items.map((i: { path: string }) => i.path)).toEqual(["docs/notes.md", "docs/renders/hero.png"]);
    const where = await call(client, "project_where", { dir: "small", ref: "left", kind: "cad" });
    expect(where.data).toMatchObject({ matchedBy: "instance", node: { id: "def:bracket" }, items: [expect.objectContaining({ relation: "has", node: "file:cad/bracket.step" })] });
    // the words are a search, whatever they look like
    const search = await call(client, "project_search", { dir: "small", text: "--help bracket", limit: 5 });
    expect(search.isError).toBe(false);
    expect(search.data.total).toBe(0);
    const paged = await call(client, "project_search", { dir: "small", text: "bracket", limit: 1 });
    expect(paged.data.items).toHaveLength(1);
    const next = await call(client, "project_search", { dir: "small", text: "bracket", limit: 1, cursor: paged.data.nextCursor });
    expect(next.data.items[0]).not.toEqual(paged.data.items[0]);

    writeFileSync(join(SMALL, "docs/notes.md"), "# Notes, edited\n");
    for (const [name, args] of [["project_census", {}], ["project_where", { ref: "left" }], ["project_search", { text: "bracket" }]] as const) {
      const r = await call(client, name, { dir: "small", ...args });
      expect(r.isError, name).toBe(true);
      expect(r.data).toMatchObject({ code: "INDEX_STALE", action: INDEX_ACTION, freshness: { changed: ["docs/notes.md"] } });
      expect(r.data.items, name).toBeUndefined();
    }
    rmSync(join(SMALL, ATLAS_FILE));
    expect((await call(client, "project_census", { dir: "small" })).data).toMatchObject({ code: "INDEX_MISSING", action: INDEX_ACTION });
    // project_build writes it, and the tools answer again
    const built = await call(client, "project_build", { dir: "small" });
    expect(built.data.atlas.counts.census.total).toBe(3);
    expect((await call(client, "project_census", { dir: "small" })).isError).toBe(false);
  }, 240_000);

  it("a project whose own CLI predates the index is told so", async () => {
    const proj = join(TMP, "older-cli");
    const bin = join(proj, "node_modules", "@protoboardai", "cli", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(proj, "protoboard.config.ts"), "");
    // what an older CLI does with a command it does not know: its help, exit 2
    writeFileSync(join(bin, "protoboard.mjs"), `process.stdout.write("\\n  Usage\\n    $ protoboard <command> [options]\\n\\n  Commands\\n    check   Check\\n"); process.exitCode = 2;\n`);
    const client = await connect(TMP);
    const r = await call(client, "project_census", { dir: "older-cli" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toMatch(/has no project index/);
    expect(r.data.action).toMatch(/project_inspect.*protoboard upgrade/);
  }, 120_000);
});

describe("the examples", () => {
  // A build of the example elsewhere (CI, another suite) may have written its ignored
  // .protoboard/build/atlas.json, so the check is on tracked files only.
  it("are left as they were: these tests change no tracked file in them", async () => {
    const status = spawnSync("git", ["status", "--porcelain", "--", "."], { cwd: EXAMPLE, encoding: "utf8" });
    if (status.status === 0) expect(status.stdout).toBe("");
  });
});

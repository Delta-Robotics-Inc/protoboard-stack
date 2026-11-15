/**
 * The System Map builder (docs/specs/system-map.md) on small stacks in
 * temporary folders: the items of every type with their versions, the links
 * read from real references, the problems it lists instead of guessing, the
 * stages and disciplines, empty islands, byte-stable output, the installed
 * layout, and that it never writes into the stack.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSystemMap, serializeSystemMap, writeSystemMap } from "../src/sysmap/build.js";
import { sysmapGraph, type SystemMap } from "../src/sysmap/model.js";
import { installedFiles, noGit, stackFiles, writeFiles } from "./sysmap-fixture.js";

const TMP = mkdtempSync(join(tmpdir(), "protoboard-sysmap-build-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const OPTS = { git: noGit, stack: "1.0.0" };
const ROOT = join(TMP, "stack");
let map: SystemMap;
beforeAll(async () => {
  writeFiles(ROOT, stackFiles());
  map = await buildSystemMap(ROOT, OPTS);
});

const item = (id: string) => map.items.find((i) => i.id === id);
const has = (from: string, kind: string, to: string) => map.links.some((l) => l.from === from && l.kind === kind && l.to === to);
const problem = (reason: string, text: string) => map.problems.some((p) => p.reason === reason && p.message.includes(text));

describe("items", () => {
  it("lists every type, with the counts adding up", () => {
    expect(map.schema).toBe("protoboard.sysmap/v0");
    expect(map.layout).toBe("monorepo");
    expect(map.counts.byType).toEqual({
      package: 4,
      extension: 3,
      skill: 6,
      capability: 1,
      "capability-operation": 4,
      operation: 2,
      check: 1,
      tool: 1,
      "cli-command": 6,
      "mcp-tool": 2,
      view: 2,
      template: 1,
      example: 1,
      doc: 3,
    });
    expect(map.counts.items).toBe(map.items.length);
    expect(map.counts.links).toBe(map.links.length);
    expect(Object.values(map.counts.byDiscipline).reduce((a, b) => a + b, 0)).toBe(map.items.length);
  });

  it("takes versions from the item's own metadata, else its manifest or package, and says which", () => {
    expect(item("skill:board-make")).toMatchObject({ version: "1.0.0", versionFrom: "manifest", status: "released" });
    expect(item("tool:lib-node")).toMatchObject({ version: "boardlib 2.0.0", versionFrom: "own" });
    expect(item("cli:check")).toMatchObject({ name: "protoboard check", version: "1.0.0", versionFrom: "package" });
    expect(item("cap:circuit")).toMatchObject({ version: null, versionFrom: "none" });
    expect(item("ext:@protoboardai/ext-b")).toMatchObject({ version: "1.0.0", versionFrom: "own" });
  });

  it("marks what a package outside the stack ships as outside, with the installed version", () => {
    expect(item("pkg:@deltarobotics/uhd")).toMatchObject({ status: "outside", version: "1.0.0", versionFrom: "installed", facts: { pinned: "1.0.1" } });
    expect(item("skill:uhd-authoring")).toMatchObject({ status: "outside", version: "1.0.0", versionFrom: "installed", source: "node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md" });
  });

  it("reads purposes and facts from the sources", () => {
    expect(item("ext:@protoboardai/ext-a")?.purpose).toBe("Boards and the top-level SOP");
    expect(item("cli:check")?.purpose).toBe("Resolve the project and run every available validator (exit 1 on errors)");
    expect(item("cli:run")?.facts?.forms).toEqual(["run <operation>", "run <capability>:<op> --module <instance>"]);
    expect(item("mcp:project_check")).toMatchObject({ purpose: "Check the project", detail: "Run every validator. Reads only." });
    expect(item("capop:@protoboardai/ext-a#circuit:lock")?.facts).toEqual({ native: "boardlib", effect: "export", human: true });
    expect(item("doc:docs/specs/foo.md")).toMatchObject({ name: "Foo: the board spec", facts: { section: "specs", specStatus: "built" } });
    expect(item("example:demo")?.purpose).toBe("Reference project: a demo board");
    expect(item("template:basic")?.purpose).toBe("Basic: one board");
  });

  it("gives every item a unique id, every link two ends that exist, and degrees that count the links", () => {
    const ids = map.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids.slice().sort());
    for (const l of map.links) {
      expect(ids).toContain(l.from);
      expect(ids).toContain(l.to);
    }
    for (const i of map.items) expect(i.degree).toBe(map.links.filter((l) => l.from === i.id || l.to === i.id).length);
  });
});

describe("links from real references", () => {
  it("reads manifests: ships, declares, provides, operation-of, needs, verified-by", () => {
    expect(has("ext:@protoboardai/ext-a", "ships", "skill:board-make")).toBe(true);
    expect(has("ext:@protoboardai/ext-a", "declares", "skill:uhd-authoring")).toBe(true);
    expect(has("pkg:@deltarobotics/uhd", "ships", "skill:uhd-authoring")).toBe(true);
    expect(has("ext:@protoboardai/ext-b", "provides", "cap:circuit")).toBe(true);
    expect(has("capop:@protoboardai/ext-a#circuit:generate", "operation-of", "cap:circuit")).toBe(true);
    expect(has("capop:@protoboardai/ext-a#circuit:generate", "needs", "tool:lib-node")).toBe(true);
    expect(has("skill:board-make", "verified-by", "skill:board-verify")).toBe(true);
  });

  it("reads package.json, templates and examples: depends-on, installs, derived-from, uses", () => {
    expect(has("pkg:@protoboardai/core", "depends-on", "pkg:@deltarobotics/uhd")).toBe(true);
    expect(has("ext:@protoboardai/ext-a", "depends-on", "pkg:@protoboardai/core")).toBe(true);
    expect(has("template:basic", "installs", "ext:@protoboardai/ext-a")).toBe(true);
    expect(has("template:basic", "derived-from", "example:demo")).toBe(true);
    expect(has("example:demo", "uses", "ext:@protoboardai/ext-a")).toBe(true);
    expect(has("pkg:@protoboardai/core", "ships", "template:basic")).toBe(true);
  });

  it("reads the CLI and MCP sources: ships, wraps, serves (through the module the mcp case imports)", () => {
    expect(has("pkg:@protoboardai/cli", "ships", "cli:check")).toBe(true);
    expect(has("pkg:@protoboardai/cli", "ships", "mcp:project_check")).toBe(true);
    expect(has("mcp:project_check", "wraps", "cli:check")).toBe(true);
    expect(has("cli:mcp", "serves", "mcp:project_check")).toBe(true);
    expect(has("cli:mcp", "serves", "mcp:project_status")).toBe(true);
    expect(has("cli:check", "serves", "mcp:project_check")).toBe(false);
    expect(has("pkg:@protoboardai/views", "ships", "view:pcb")).toBe(true);
  });

  it("reads SKILL.md text: refers-to, runs (own extension first, else the only one, else the capability), runs-command, calls, cites", () => {
    expect(has("skill:board-make", "refers-to", "skill:board-verify")).toBe(true);
    expect(has("skill:board-make", "runs", "capop:@protoboardai/ext-a#circuit:generate")).toBe(true);
    expect(has("skill:other-board", "runs", "capop:@protoboardai/ext-b#circuit:generate")).toBe(true);
    expect(has("skill:c-skill", "runs", "cap:circuit")).toBe(true);
    expect(has("skill:board-make", "runs-command", "cli:check")).toBe(true);
    expect(has("skill:board-make", "calls", "mcp:project_check")).toBe(true);
    expect(has("skill:board-make", "cites", "doc:docs/specs/bar.md")).toBe(true);
    expect(has("pkg:@protoboardai/core", "cites", "doc:docs/specs/foo.md")).toBe(true);
    expect(has("cli:check", "cites", "doc:docs/specs/foo.md")).toBe(true);
  });

  it("reads docs: mentions of skills, extensions, commands and tools, and citations of other docs", () => {
    expect(has("doc:docs/specs/foo.md", "mentions", "skill:board-make")).toBe(true);
    expect(has("doc:docs/specs/foo.md", "mentions", "cli:check")).toBe(true);
    expect(has("doc:docs/specs/foo.md", "mentions", "mcp:project_check")).toBe(true);
    expect(has("doc:docs/specs/bar.md", "mentions", "ext:@protoboardai/ext-a")).toBe(true);
    expect(has("doc:docs/specs/foo.md", "cites", "doc:docs/specs/bar.md")).toBe(true);
  });
});

describe("problems instead of guesses", () => {
  it("lists every reference it cannot resolve", () => {
    expect(problem("REFERENCE_UNRESOLVED", "requires the tool missing-tool")).toBe(true);
    expect(problem("REFERENCE_UNRESOLVED", "runs protoboard frobnicate")).toBe(true);
    expect(problem("REFERENCE_UNRESOLVED", "circuit:nonsense")).toBe(true);
    expect(problem("REFERENCE_UNRESOLVED", "cites docs/specs/missing.md")).toBe(true);
    expect(problem("REFERENCE_UNRESOLVED", "protoboard vanished")).toBe(true);
    expect(problem("REFERENCE_UNRESOLVED", "installs @protoboardai/ext-gone")).toBe(true);
    expect(problem("REFERENCE_AMBIGUOUS", "runs report")).toBe(true);
    expect(map.links.some((l) => l.from === "skill:c-skill" && l.to.startsWith("op:"))).toBe(false);
  });

  it("lists mismatches between sources", () => {
    expect(problem("SKILL_UNDECLARED", "skills/stray/SKILL.md")).toBe(true);
    expect(problem("SKILL_NAME_MISMATCH", "other-board-renamed")).toBe(true);
    expect(problem("VERSION_MISMATCH", "@protoboardai/ext-b: the manifest says 1.0.0, package.json 1.0.1")).toBe(true);
    expect(problem("OUTSIDE_VERSION_DRIFT", "pins 1.0.1")).toBe(true);
    expect(problem("CLI_UNDOCUMENTED", "protoboard secret")).toBe(true);
    expect(problem("CLI_UNDOCUMENTED", "protoboard rebuild")).toBe(true);
    expect(problem("CLI_HELP_ORPHAN", "protoboard ghost")).toBe(true);
    expect(problem("HISTORY_UNAVAILABLE", "taken as released")).toBe(true);
  });

  it("sorts problems and lists each once", () => {
    const keys = map.problems.map((p) => JSON.stringify(p));
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...map.problems].sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
    expect(sorted.map((p) => p.reason)).toEqual(map.problems.map((p) => p.reason));
  });

  it("reports a folder that is no stack, without throwing", async () => {
    const empty = join(TMP, "empty");
    writeFiles(empty, { "README.md": "# nothing\n" });
    const m = await buildSystemMap(empty, OPTS);
    expect(m.items).toEqual([]);
    expect(m.problems.map((p) => p.reason)).toContain("STACK_NOT_FOUND");
    expect(m.islands.every((i) => i.empty)).toBe(true);
  });
});

describe("stages and disciplines", () => {
  it("reads the stages of build-a-project and their disciplines", () => {
    expect(map.stages).toEqual([
      { n: 0, title: "Set up", discipline: "project" },
      { n: 1, title: "Boards (circuit capability)", discipline: "pcb" },
      { n: 2, title: "Release", discipline: "mfg" },
    ]);
  });

  it("stages an item where it is named most, a table row counting half, ties to the earliest", () => {
    // board-make: stage 0 in a table (0.5), stage 1 and stage 2 in prose (1 each)
    expect(item("skill:board-make")).toMatchObject({ stage: 1, stages: [0, 1, 2], stageFrom: "build-a-project", discipline: "pcb", disciplineFrom: "stage" });
    expect(item("cli:check")).toMatchObject({ stage: 0, stageFrom: "build-a-project" });
    // circuit:generate has two providers: named in a stage, it stages neither
    expect(item("capop:@protoboardai/ext-a#circuit:generate")).toMatchObject({ stage: 1, stageFrom: "extension" });
    expect(item("ext:@protoboardai/ext-a")).toMatchObject({ stage: 1, stageFrom: "skills", discipline: "pcb", disciplineFrom: "stage" });
  });

  it("says where each discipline came from", () => {
    expect(item("skill:build-a-project")).toMatchObject({ discipline: "project", disciplineFrom: "rule", stage: null });
    expect(item("skill:uhd-authoring")).toMatchObject({ discipline: "pcb", disciplineFrom: "inherited" });
    expect(item("cap:circuit")).toMatchObject({ disciplineFrom: "inherited" });
    expect(item("tool:lib-node")).toMatchObject({ discipline: "pcb", disciplineFrom: "inherited" });
    expect(item("mcp:project_check")).toMatchObject({ discipline: "system", disciplineFrom: "inherited" });
    expect(item("view:pcb")).toMatchObject({ discipline: "pcb", disciplineFrom: "rule" });
    expect(item("doc:docs/specs/bar.md")).toMatchObject({ discipline: "pcb", disciplineFrom: "links" });
    expect(problem("DISCIPLINE_UNRESOLVED", "doc:docs/specs/playbooks.md")).toBe(true);
    expect(item("doc:docs/specs/playbooks.md")).toMatchObject({ discipline: null, disciplineFrom: "none" });
  });

  it("reports disciplines with no items as empty islands, with what the stack holds about them", () => {
    expect(map.islands.map((i) => i.id)).toEqual(["project", "research", "parts", "system", "pcb", "cad", "firmware", "docs", "mfg", "simulation", "packaging", "protocols", "playbooks"]);
    const byId = Object.fromEntries(map.islands.map((i) => [i.id, i]));
    expect(byId.simulation).toMatchObject({ items: 0, empty: true, note: "No item in the stack resolves to this discipline." });
    expect(byId.playbooks.note).toBe("No item in the stack resolves to this discipline; planned in docs/specs/playbooks.md; no playbooks/ folder at the stack root.");
    expect(byId.pcb.empty).toBe(false);
    expect(map.counts.byDiscipline.simulation).toBe(0);
  });
});

describe("output", () => {
  it("is byte-stable across builds, with no clocks", async () => {
    const again = await buildSystemMap(ROOT, OPTS);
    expect(serializeSystemMap(again)).toBe(serializeSystemMap(map));
    expect(JSON.stringify(map)).not.toMatch(/"(builtAt|generatedAt|now)"/);
  });

  it("records every file it read as an input with its hash", () => {
    const paths = map.inputs.map((i) => i[0]);
    expect(paths).toContain("packages/ext-a/protoboard-extension.json");
    expect(paths).toContain("packages/cli/src/mcp/server.ts");
    expect(paths).toContain("node_modules/@deltarobotics/uhd/skills/uhd-authoring/SKILL.md");
    expect(map.inputs.every((i) => /^sha256:[0-9a-f]{64}$/.test(i[3]))).toBe(true);
    expect(paths).toEqual([...paths].sort());
  });

  it("projects a graph for a view", () => {
    const g = sysmapGraph(map);
    expect(Object.keys(g).sort()).toEqual(["counts", "islands", "items", "layout", "links", "problems", "releases", "stack", "stages"]);
    // never the freshness inputs or the history fingerprint
    expect(g).not.toHaveProperty("inputs");
    expect(g).not.toHaveProperty("history");
  });

  it("writes only the map, never into the stack's files", async () => {
    const listing = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listing(join(dir, e.name)).map((p) => `${e.name}/${p}`) : [`${e.name}:${statSync(join(dir, e.name)).mtimeMs}`]));
    const before = listing(ROOT);
    const out = join(TMP, "out", "sysmap.json");
    const r = await writeSystemMap(ROOT, { ...OPTS, file: out });
    expect(r.file).toBe(out);
    expect(listing(ROOT)).toEqual(before);
    expect(readdirSync(join(TMP, "out"))).toEqual(["sysmap.json"]);
  });
});

describe("an installed stack", () => {
  it("reads node_modules/@protoboardai, with no docs, examples or history", async () => {
    const root = join(TMP, "installed");
    writeFiles(root, installedFiles());
    const m = await buildSystemMap(root, OPTS);
    expect(m.layout).toBe("installed");
    expect(m.counts.byType).toMatchObject({ extension: 3, skill: 6, "cli-command": 6, "mcp-tool": 2, view: 2, template: 1, example: 0, doc: 0 });
    expect(m.items.find((i) => i.id === "skill:board-make")?.source).toBe("node_modules/@protoboardai/ext-a/skills/board-make/SKILL.md");
    expect(m.problems.map((p) => p.reason)).not.toContain("DOCS_ABSENT");
    // a template's example and the docs live in the source repository only: not reported missing here
    expect(m.problems.some((p) => p.message.includes("examples/demo"))).toBe(false);
    expect(m.problems.some((p) => p.message.includes("docs/specs/"))).toBe(false);
  });
});

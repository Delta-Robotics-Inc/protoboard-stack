/**
 * Atlas index builder (docs/specs/atlas.md): the census, the definition-level
 * graph, per-file failures that never throw, hash reuse, byte-stable output,
 * and the read-only promise; then the quadcopter reference project.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, stableStringify, type Project } from "../src/index.js";
import { HISTORY_ARGS, buildAtlasIndex, enumerateProject, nodeAtlasFs, parseAddTimes, writeAtlasIndex, type AtlasFs, type AtlasGitRunner, type AtlasStat } from "../src/atlas/build.js";
import { isUnlinkedFile, type AtlasIndex } from "../src/atlas/model.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const QUAD = join(HERE, "../../../examples/quadcopter-5in");
// its own folder: other test files work in .tmp at the same time
const TMP = join(HERE, ".tmp/atlas-build");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** No git: the temporary projects sit in an ignored folder of this repository, so they are walked. */
const noGit: AtlasGitRunner = async () => null;

const write = (dir: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
};

const IFACES = `interfaces: [{ id: "p", name: "P", domain: "electrical", protocols: [{ type: "power", roles: ["source"] }] }, { id: "q", name: "Q", domain: "electrical", protocols: [{ type: "power", roles: ["sink"] }] }]`;

const PROJECT: Record<string, string> = {
  "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`,
  "package.json": JSON.stringify({ name: "atlas-fixture", type: "module" }),
  "src/sys.uhd.ts": `export const SYS = {
  id: "sys", name: "System", ${IFACES},
  children: [
    { id: "arm_1", moduleDefId: "arm" }, { id: "arm_2", moduleDefId: "arm" }, { id: "arm_3", moduleDefId: "arm" }, { id: "arm_4", moduleDefId: "arm" },
    { id: "main", moduleDefId: "body" }, { id: "harness_1", moduleDefId: "cable" },
  ],
  links: [
    { id: "l1", a: { child: "arm_1", interfaceId: "p" }, b: { child: "main", interfaceId: "q" } },
    { id: "l2", a: { child: "arm_2", interfaceId: "p" }, b: { child: "main", interfaceId: "q" } },
    { id: "l3", a: { child: "arm_3", interfaceId: "p" }, b: { child: "main", interfaceId: "q" }, harness: "harness_1" },
  ],
};
`,
  "src/modules.uhd.ts": `export const ARM = {
  id: "arm", name: "Arm", ${IFACES},
  children: [{ id: "m", moduleDefId: "motor" }],
  artifacts: [
    { id: "cad_source", name: "Arm generator", type: "cad", role: "source", filePath: "cad/arm.py" },
    { id: "cad_step", name: "Arm (STEP)", type: "3d_model", role: "body", format: "step", filePath: "cad/arm.step", provenance: { generatedFrom: "cad_source" } },
    { id: "cad_glb", name: "Arm (GLB)", type: "3d_model", role: "body", format: "glb", filePath: "cad/arm.glb", provenance: { generatedFrom: "cad_step" } },
    { id: "cad_manifest", name: "Arm manifest", type: "cad", format: "json", filePath: "cad/arm.manifest.json", provenance: { generatedFrom: "cad_step" } },
    { id: "gen", name: "Packaged generator", type: "cad", role: "source" },
    { id: "cad_glb2", name: "Arm (packaged GLB)", type: "3d_model", filePath: "cad/arm2.glb", provenance: { generatedFrom: "gen" } },
    { id: "shared", name: "Shared guide", type: "documentation", filePath: "docs/shared.pdf" },
    { id: "ds", name: "Datasheet", type: "datasheet", url: "https://example.com/arm.pdf" },
    { id: "gone", name: "Missing", type: "cad", filePath: "cad/missing.step" },
  ],
};
export const BODY = {
  id: "body", name: "Body", ${IFACES},
  artifacts: [
    { id: "shared", name: "Shared guide", type: "documentation", filePath: "docs/shared.pdf" },
    { id: "renders", name: "Renders", type: "documentation", filePath: "docs/renders/" },
    { id: "concept", name: "Board concept", type: "documentation", filePath: "art/board.png", tags: ["concept"] },
  ],
};
export const CABLE = { id: "cable", name: "Cable", kind: "harness", ${IFACES} };
export const SPARE = { id: "spare", name: "Spare", ${IFACES} };
`,
  "parts/local/motor/motor.uhd.ts": `export const MOTOR = {
  id: "motor", name: "Motor", ${IFACES},
  artifacts: [{ id: "body", name: "Motor body", type: "3d_model", filePath: "parts/local/motor/out/body.stl" }],
};
`,
  "parts/local/motor/out/body.stl": "solid motor\nendsolid\n",
  "cad/arm.py": "print('arm')\n",
  "cad/arm.step": "ISO-10303-21; arm\n",
  "cad/arm.glb": "glTF arm",
  "cad/arm.manifest.json": "{}\n",
  "cad/arm2.glb": "glTF arm2",
  "docs/shared.pdf": "%PDF-1.4 shared\n",
  "docs/renders/r1.png": "png r1",
  "docs/renders/r2.jpg": "jpg r2",
  "art/board.png": "png concept",
  "docs/images/fig.png": "png fig",
  "docs/notes.md": "# Notes\n",
  "photos/IMG_0001.jpg": "jpg photo",
  "photos/Café shot 1.jpg": "jpg unicode",
  "sketches/idea.png": "png idea",
  "misc/clip.mp4": "mp4",
  "data.json": "{}\n",
  "operations/2026-01-01T00-00-00-000Z-tech-docs.json": JSON.stringify({ schema: "protoboard.operation/v0", operation: "tech-docs", outputs: [{ path: "docs/images/fig.png", digest: "sha256:00", bytes: 7 }] }),
  "operations/2026-01-02T00-00-00-000Z-broken.json": "{ not json",
  // never indexed: secrets, dot-folders, the Manufacturing Package, dependencies
  ".env": "TOKEN=x\n",
  "keys/server.pem": "-----BEGIN-----\n",
  ".cache/thumb.png": "png",
  "release/package.pdf": "%PDF",
  "node_modules/dep/readme.md": "# dep\n",
};

let n = 0;
const fixture = () => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  write(dir, PROJECT);
  return dir;
};

const load = (dir: string) => loadProject(dir, { checks: false, extensions: false });

/** Every file under `dir` with its mtime, for the read-only check. */
const mtimes = (dir: string, rel = ""): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const name of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(join(dir, r));
    if (st.isDirectory()) Object.assign(out, mtimes(dir, r));
    else out[r] = st.mtimeMs;
  }
  return out;
};

describe("Atlas index of a small project", () => {
  let dir: string;
  let p: Project;
  let index: AtlasIndex;
  beforeAll(async () => {
    dir = fixture();
    p = await load(dir);
    index = await buildAtlasIndex(p, { previous: null, git: noGit });
  });

  const node = (id: string) => index.nodes.find((x) => x.id === id);
  const census = (path: string) => index.census.find((c) => c.path === path);
  const edge = (from: string, to: string, type: string) => index.edges.find((e) => e.from === from && e.to === to && e.type === type);

  it("lists every asset in the census, linked or not, and leaves out code, secrets and the never-indexed folders", () => {
    expect(index.enumerator).toBe("walk");
    expect(index.census.map((c) => `${c.path} ${c.kind} ${c.status}`)).toEqual([
      "art/board.png concept linked",
      "cad/arm.glb model linked",
      "cad/arm.step cad linked",
      "cad/arm2.glb model linked",
      "docs/images/fig.png render linked",
      "docs/notes.md doc unlinked",
      "docs/renders/r1.png render linked",
      "docs/renders/r2.jpg render linked",
      "docs/shared.pdf doc linked",
      "misc/clip.mp4 other unlinked",
      "parts/local/motor/out/body.stl model linked",
      "photos/Café shot 1.jpg photo unlinked",
      "photos/IMG_0001.jpg photo unlinked",
      "sketches/idea.png concept unlinked",
    ]);
    expect(index.counts.census).toEqual({ total: 14, linked: 9, unlinked: 5, failed: 0, excluded: 2 });
    const inputs = index.inputs.map((i) => i[0]);
    for (const path of ["src/sys.uhd.ts", "protoboard.config.ts", "data.json", "operations/2026-01-02T00-00-00-000Z-broken.json"]) expect(inputs).toContain(path);
    for (const path of [".env", "keys/server.pem", ".cache/thumb.png", "release/package.pdf", "node_modules/dep/readme.md"]) expect(inputs).not.toContain(path);
    expect(index.inputs.every((i) => typeof i[3] === "string" && i[3].startsWith("sha256:"))).toBe(true);
  });

  it("says what links each file: artifacts, folder artifacts and operation records", () => {
    expect(census("docs/shared.pdf")!.linkedBy).toEqual(["artifact:arm#shared", "artifact:body#shared"]);
    expect(census("docs/renders/r1.png")!.linkedBy).toEqual(["dir-artifact:body#renders"]);
    expect(census("docs/images/fig.png")).toMatchObject({ kind: "render", kindFrom: "operation", linkedBy: ["operation:operations/2026-01-01T00-00-00-000Z-tech-docs.json"] });
    expect(census("art/board.png")!.kindFrom).toBe("tag");
    expect(census("docs/notes.md")!.linkedBy).toBeUndefined();
  });

  it("makes one node per definition, whatever its instance count", () => {
    expect(node("def:motor")).toMatchObject({ kind: "part", status: "ok", definition: { tier: "project-researched", instances: ["arm_1/m", "arm_2/m", "arm_3/m", "arm_4/m"] } });
    expect(index.nodes.filter((x) => x.id === "def:motor")).toHaveLength(1);
    expect(node("def:sys")).toMatchObject({ kind: "module", path: "src/sys.uhd.ts", folder: "src", definition: { root: true, instances: [""] } });
    expect(node("def:cable")!.definition!.moduleKind).toBe("harness");
    expect(node("def:spare")).toMatchObject({ kind: "module", status: "unused", definition: { instances: [] } });
    expect(index.instances).toMatchObject({ "": "sys", arm_1: "arm", "arm_1/m": "motor", main: "body", harness_1: "cable" });
    expect(index.project).toEqual({ name: expect.stringMatching(/^p[0-9]+$/), root: "sys" });
  });

  it("gives a file two definitions name one node with both owners", () => {
    const shared = node("file:docs/shared.pdf")!;
    expect(shared.file!.owners).toEqual(["arm", "body"]);
    expect(shared.file!.artifacts.map((a) => `${a.definition}#${a.id}`)).toEqual(["arm#shared", "body#shared"]);
    expect(edge("def:arm", "file:docs/shared.pdf", "has")).toBeDefined();
    expect(edge("def:body", "file:docs/shared.pdf", "has")).toBeDefined();
  });

  it("keeps a STEP typed 3d_model as kind cad, and names non-asset artifact files as nodes only", () => {
    expect(node("file:cad/arm.step")!.kind).toBe("cad");
    expect(node("file:cad/arm.py")).toMatchObject({ kind: "cad", file: { kindFrom: "artifact" } });
    expect(node("file:cad/arm.manifest.json")).toMatchObject({ kind: "data", file: { kindFrom: "artifact" } });
    expect(census("cad/arm.py")).toBeUndefined();
    expect(census("cad/arm.manifest.json")).toBeUndefined();
  });

  it("draws made-from edges, and none to a fileless source", () => {
    expect(edge("file:cad/arm.step", "file:cad/arm.py", "made-from")).toEqual({ from: "file:cad/arm.step", to: "file:cad/arm.py", type: "made-from", via: ["cad_step"] });
    expect(edge("file:cad/arm.glb", "file:cad/arm.step", "made-from")).toBeDefined();
    expect(edge("file:cad/arm.manifest.json", "file:cad/arm.step", "made-from")).toBeDefined();
    expect(index.edges.filter((e) => e.from === "file:cad/arm2.glb")).toEqual([]);
  });

  it("draws contains for the project's modules and uses for parts", () => {
    expect(index.edges.filter((e) => e.type === "contains" || e.type === "uses").map((e) => `${e.from} ${e.type} ${e.to}`)).toEqual([
      "def:arm uses def:motor",
      "def:sys contains def:arm",
      "def:sys contains def:body",
      "def:sys contains def:cable",
    ]);
  });

  it("collapses links onto one edge per definition pair, harness links apart", () => {
    expect(edge("def:arm", "def:body", "link")).toEqual({ from: "def:arm", to: "def:body", type: "link", count: 2, via: ["l1", "l2"] });
    expect(edge("def:arm", "def:body", "harness")).toEqual({ from: "def:arm", to: "def:body", type: "harness", count: 1, via: ["l3"] });
  });

  it("records folder, remote and missing artifacts", () => {
    expect(node("dir:docs/renders/")).toMatchObject({ status: "ok", path: "docs/renders" });
    expect(edge("def:body", "dir:docs/renders/", "has")).toBeDefined();
    expect(edge("dir:docs/renders/", "file:docs/renders/r1.png", "has")).toBeDefined();
    expect(node("file:docs/renders/r2.jpg")!.file!.owners).toEqual(["body"]);
    expect(node("url:arm#ds")).toMatchObject({ kind: "doc", status: "remote", folder: "(remote)", url: "https://example.com/arm.pdf" });
    expect(node("file:cad/missing.step")).toMatchObject({ kind: "cad", status: "missing" });
    expect(index.nodes.some((x) => x.id.includes("#gen"))).toBe(false); // a provenance-only artifact has no node
  });

  it("gives unlinked files no edges, and counts degree and kinds", () => {
    expect(node("file:docs/notes.md")!.degree).toBe(0);
    expect(node("def:arm")!.degree).toBe(index.edges.filter((e) => e.from === "def:arm" || e.to === "def:arm").length);
    expect(index.counts.nodes).toBe(index.nodes.length);
    expect(index.counts.edges).toBe(index.edges.length);
    expect(Object.values(index.counts.byKind).reduce((a, b) => a + (b ?? 0), 0)).toBe(index.nodes.length);
  });

  it("isUnlinkedFile agrees with the census: a produced file with no module is linked, not unlinked", () => {
    expect(index.nodes.filter(isUnlinkedFile).map((x) => x.path).sort()).toEqual(index.census.filter((c) => c.status === "unlinked").map((c) => c.path));
    expect(index.nodes.filter(isUnlinkedFile).length).toBe(index.counts.census.unlinked);
    const produced = node("file:docs/images/fig.png")!;
    expect(produced).toMatchObject({ degree: 0, file: { owners: [], producedBy: "operations/2026-01-01T00-00-00-000Z-tech-docs.json" } });
    expect(isUnlinkedFile(produced)).toBe(false);
    // definitions, folders and remote artifacts are never unlinked files
    for (const id of ["def:spare", "dir:docs/renders/", "url:arm#ds"]) expect(isUnlinkedFile(node(id)!)).toBe(false);
  });

  it("reports an unreadable operation record and goes on", () => {
    expect(index.problems).toEqual([expect.objectContaining({ path: "operations/2026-01-02T00-00-00-000Z-broken.json", reason: "OPERATION_RECORD_UNREADABLE" })]);
  });

  it("sorts nodes, edges and the census by code unit", () => {
    const ids = index.nodes.map((x) => x.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const paths = index.census.map((c) => c.path);
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe("Atlas build failures, reuse and output", () => {
  it("records a locked file as failed and indexes every other file", async () => {
    const dir = fixture();
    const p = await load(dir);
    const locked: AtlasFs = {
      ...nodeAtlasFs,
      hashFile: async (abs) => {
        if (abs.replace(/\\/g, "/").endsWith("cad/arm.step")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        return nodeAtlasFs.hashFile(abs);
      },
    };
    const index = await buildAtlasIndex(p, { previous: null, fs: locked, git: noGit });
    expect(index.census.find((c) => c.path === "cad/arm.step")).toMatchObject({ status: "failed", reason: "LOCKED" });
    expect(index.nodes.find((x) => x.id === "file:cad/arm.step")).toMatchObject({ status: "failed", reason: "LOCKED" });
    expect(index.problems.map((x) => `${x.path} ${x.reason}`)).toContain("cad/arm.step LOCKED");
    expect(index.counts.census).toMatchObject({ total: 14, failed: 1, linked: 8 });
    expect(index.inputs.find((i) => i[0] === "cad/arm.step")![3]).toBeNull();
    expect(index.inputs.filter((i) => i[3] === null)).toHaveLength(1);
  });

  it("maps permission errors and any other read error", async () => {
    const dir = fixture();
    const p = await load(dir);
    const failing: AtlasFs = {
      ...nodeAtlasFs,
      hashFile: async (abs) => {
        const rel = abs.replace(/\\/g, "/");
        if (rel.endsWith("docs/notes.md")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        if (rel.endsWith("misc/clip.mp4")) throw Object.assign(new Error("EIO"), { code: "EIO" });
        return nodeAtlasFs.hashFile(abs);
      },
    };
    const index = await buildAtlasIndex(p, { previous: null, fs: failing, git: noGit });
    expect(index.census.find((c) => c.path === "docs/notes.md")!.reason).toBe("PERMISSION_DENIED");
    expect(index.census.find((c) => c.path === "misc/clip.mp4")!.reason).toBe("READ_FAILED");
  });

  it("reuses the previous hashes for files whose size and mtime are unchanged, and gives the same bytes", async () => {
    const dir = fixture();
    const p = await load(dir);
    let hashed = 0;
    const counting: AtlasFs = { ...nodeAtlasFs, hashFile: (abs) => (hashed++, nodeAtlasFs.hashFile(abs)) };
    const first = await buildAtlasIndex(p, { previous: null, fs: counting, git: noGit });
    expect(hashed).toBe(first.inputs.length);
    hashed = 0;
    const second = await buildAtlasIndex(p, { previous: first, fs: counting, git: noGit });
    expect(hashed).toBe(0);
    expect(stableStringify(second)).toBe(stableStringify(first));
    // a changed file is hashed again
    writeFileSync(join(dir, "docs/notes.md"), "# Notes, longer now\n");
    hashed = 0;
    const third = await buildAtlasIndex(p, { previous: second, fs: counting, git: noGit });
    expect(hashed).toBe(1);
    expect(third.census.find((c) => c.path === "docs/notes.md")!.sha256).not.toBe(first.census.find((c) => c.path === "docs/notes.md")!.sha256);
  });

  it("writes only the index (atomically, with no clocks), and changes no project file", async () => {
    const dir = fixture();
    const p = await load(dir);
    const before = mtimes(dir);
    const first = await writeAtlasIndex(p, { git: noGit });
    expect(first.file.replace(/\\/g, "/")).toMatch(/\.protoboard\/build\/atlas\.json$/);
    expect(first.problems).toBe(1);
    const after = mtimes(dir);
    const added = Object.keys(after).filter((f) => !(f in before));
    expect(added).toEqual([".protoboard/build/atlas.json"]);
    for (const [f, t] of Object.entries(before)) expect([f, after[f]]).toEqual([f, t]);
    // the second build reads the first as its cache and writes the same bytes
    const second = await writeAtlasIndex(p, { git: noGit });
    expect(second.digest).toBe(first.digest);
    expect(readdirSync(join(dir, ".protoboard/build"))).toEqual(["atlas.json"]);
  });

  it("starts without a cache when the build folder is missing, or the previous index is from another stack", async () => {
    const dir = fixture();
    const p = await load(dir);
    const outDir = join(dir, "out-nowhere/deeper");
    const r = await writeAtlasIndex(p, { outDir, git: noGit });
    expect(r.file).toBe(join(outDir, "atlas.json"));
    let hashed = 0;
    const counting: AtlasFs = { ...nodeAtlasFs, hashFile: (abs) => (hashed++, nodeAtlasFs.hashFile(abs)) };
    const old = (await buildAtlasIndex(p, { previous: null, git: noGit })) as AtlasIndex;
    await buildAtlasIndex(p, { previous: { ...old, stack: "0.0.1" }, fs: counting, git: noGit });
    expect(hashed).toBe(old.inputs.length);
  });
});

describe("enumerateProject", () => {
  it("lists a git work tree with git, dropping files gone from disk, dot-files and secrets", async () => {
    const dir = fixture();
    const git: AtlasGitRunner = async (args) => {
      if (args[0] === "rev-parse") return "true\n";
      if (args[0] === "check-ignore") return null;
      if (args[0] === "ls-files") return ["docs/notes.md", "deleted.md", ".env", ".github/ci.yml", "release/package.pdf", "photos/Café shot 1.jpg", "keys/server.pem", ""].join("\0");
      return null;
    };
    const e = await enumerateProject(dir, { git });
    expect(e).toEqual({ enumerator: "git", files: ["docs/notes.md", "photos/Café shot 1.jpg"], problems: [], excluded: 2 });
  });

  it("walks a project git ignores, and falls back to a walk when git ls-files fails", async () => {
    const dir = fixture();
    const ignored: AtlasGitRunner = async (args) => (args[0] === "rev-parse" ? "true\n" : args[0] === "check-ignore" ? "" : "should not be listed");
    expect((await enumerateProject(dir, { git: ignored })).enumerator).toBe("walk");
    const broken: AtlasGitRunner = async (args) => (args[0] === "rev-parse" ? "true\n" : null);
    const e = await enumerateProject(dir, { git: broken });
    expect(e.enumerator).toBe("walk");
    expect(e.problems.map((x) => x.reason)).toEqual(["ENUMERATION_FALLBACK"]);
    expect(e.files).toContain("docs/notes.md");
  });

  it("lists a project nested in a larger repository by paths relative to the project", async () => {
    const e = await enumerateProject(QUAD);
    expect(e.enumerator).toBe("git");
    expect(e.files).toContain("protoboard.config.ts");
    expect(e.files.some((f) => f.startsWith("examples/"))).toBe(false);
    expect(e.files.some((f) => f.startsWith(".protoboard/"))).toBe(false);
  });
});

describe("creation times", () => {
  const S = 1000; // git gives seconds; the index keeps milliseconds
  /** One commit of a faked `git log` (HISTORY_ARGS): "\x01<seconds>\0\n" then status, path pairs. */
  const commit = (seconds: number, events: [string, string][]) => `\x01${seconds}\0\n${events.map(([s, p]) => `${s}\0${p}\0`).join("")}`;
  const LOG = [
    // newest first: notes.md was deleted and added again; shared.pdf left the history (the one on disk is untracked)
    commit(3_000, [["A", "docs/notes.md"], ["A", "photos/Café shot 1.jpg"], ["D", "docs/shared.pdf"]]),
    commit(2_000, [["D", "docs/notes.md"], ["A", "cad/arm.step"], ["A", "docs/renders/r2.jpg"]]),
    commit(1_000, [["A", "docs/notes.md"], ["A", "src/modules.uhd.ts"], ["A", "docs/renders/r1.png"], ["A", "cad/arm.py"], ["A", "docs/shared.pdf"]]),
  ].join("");

  /** A git work tree that lists every file on disk, with LOG as its history (or a failing log), counting the log calls. */
  const fakeGit = async (dir: string, log: string | null) => {
    const files = (await enumerateProject(dir, { git: noGit })).files;
    const calls = { log: 0 };
    const git: AtlasGitRunner = async (args) => {
      if (args[0] === "rev-parse") return "true\n";
      if (args[0] === "check-ignore") return null;
      if (args[0] === "ls-files") return files.join("\0") + "\0";
      if (args.includes("log")) {
        calls.log++;
        expect(args).toEqual([...HISTORY_ARGS]);
        return log;
      }
      return null;
    };
    return { git, calls };
  };

  /** The real file system, with chosen birth times (undefined: keep the real one). */
  const births = (byPath: Record<string, number | undefined>): AtlasFs => {
    const wrap = async (abs: string, st: AtlasStat): Promise<AtlasStat> => {
      const rel = Object.keys(byPath).find((p) => abs.replace(/\\/g, "/").endsWith(`/${p}`));
      if (rel === undefined) return st;
      return { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: byPath[rel], isFile: () => st.isFile(), isDirectory: () => st.isDirectory(), isSymbolicLink: () => st.isSymbolicLink() };
    };
    return { ...nodeAtlasFs, lstat: async (abs) => wrap(abs, await nodeAtlasFs.lstat(abs)), stat: async (abs) => wrap(abs, await nodeAtlasFs.stat(abs)) };
  };

  let dir: string;
  let index: AtlasIndex;
  let calls: { log: number };
  const BIRTH = Date.UTC(2026, 0, 15, 12, 0, 0) + 0.75;
  beforeAll(async () => {
    dir = fixture();
    const fake = await fakeGit(dir, LOG);
    calls = fake.calls;
    index = await buildAtlasIndex(await load(dir), { previous: null, git: fake.git, fs: births({ "sketches/idea.png": BIRTH, "art/board.png": 0, "misc/clip.mp4": Number.NaN }) });
  });
  const node = (id: string) => index.nodes.find((x) => x.id === id);

  it("runs one git log for the whole build", () => {
    expect(index.enumerator).toBe("git");
    expect(calls.log).toBe(1);
  });

  it("takes the author time of the commit that added a file, the newest add for a file added again", () => {
    expect(node("file:cad/arm.step")!.created).toEqual({ at: 2_000 * S, from: "git" });
    expect(node("file:docs/notes.md")!.created).toEqual({ at: 3_000 * S, from: "git" });
    expect(node("file:photos/Café shot 1.jpg")!.created).toEqual({ at: 3_000 * S, from: "git" });
    // the census carries the same time
    expect(index.census.find((c) => c.path === "docs/notes.md")!.created).toEqual({ at: 3_000 * S, from: "git" });
  });

  it("falls back to the birth time for a file with no add in the history, and to the mtime when there is no birth time", () => {
    // untracked
    expect(node("file:sketches/idea.png")!.created).toEqual({ at: Math.floor(BIRTH), from: "birthtime" });
    // deleted from the history: the file there now is untracked
    expect(node("file:docs/shared.pdf")!.created!.from).toBe("birthtime");
    // a birth time of 0, or not a number: the mtime, said so
    const mtime = (rel: string) => Math.floor(statSync(join(dir, rel)).mtimeMs);
    expect(node("file:art/board.png")!.created).toEqual({ at: mtime("art/board.png"), from: "mtime" });
    expect(node("file:misc/clip.mp4")!.created).toEqual({ at: mtime("misc/clip.mp4"), from: "mtime" });
    for (const n of index.nodes) if (n.created) expect(Number.isInteger(n.created.at), n.id).toBe(true);
  });

  it("gives a definition its source file's time, a folder its earliest file's, and nothing to remote, missing or package nodes", () => {
    expect(node("def:arm")).toMatchObject({ path: "src/modules.uhd.ts", created: { at: 1_000 * S, from: "git" } });
    expect(node("def:body")!.created).toEqual(node("def:arm")!.created);
    expect(node("dir:docs/renders/")!.created).toEqual({ at: 1_000 * S, from: "git" });
    expect(node("file:cad/arm.py")!.created).toEqual({ at: 1_000 * S, from: "git" });
    expect(node("url:arm#ds")!.created).toBeUndefined();
    expect(node("file:cad/missing.step")!.created).toBeUndefined();
  });

  it("counts nodes by source, adding up to the node count", () => {
    const c = index.counts.created!;
    expect(c.git + c.birthtime + c.mtime + c.none).toBe(index.nodes.length);
    expect(c).toEqual({
      git: index.nodes.filter((n) => n.created?.from === "git").length,
      birthtime: index.nodes.filter((n) => n.created?.from === "birthtime").length,
      mtime: index.nodes.filter((n) => n.created?.from === "mtime").length,
      none: index.nodes.filter((n) => !n.created).length,
    });
    expect(c.git).toBeGreaterThan(5);
    expect(c.mtime).toBeGreaterThanOrEqual(2);
    expect(c.none).toBeGreaterThanOrEqual(2); // the remote and the missing artifact at least
    expect(index.problems.map((p) => p.reason)).not.toContain("HISTORY_FALLBACK");
  });

  it("a failing git log in a work tree says so, and the file system gives the times", async () => {
    const d = fixture();
    const fake = await fakeGit(d, null);
    const i = await buildAtlasIndex(await load(d), { previous: null, git: fake.git });
    expect(fake.calls.log).toBe(1);
    expect(i.problems).toContainEqual({ reason: "HISTORY_FALLBACK", message: expect.stringMatching(/creation times came from the file system/) });
    expect(i.nodes.some((n) => n.created?.from === "git")).toBe(false);
    expect(i.nodes.find((n) => n.id === "file:docs/notes.md")!.created!.from).toMatch(/^(birthtime|mtime)$/);
    expect(i.counts.created!.git).toBe(0);
  });

  it("a walked project runs no git log, and a failed file has no time", async () => {
    const d = fixture();
    let logs = 0;
    const git: AtlasGitRunner = async (args) => {
      if (args.includes("log")) logs++;
      return null;
    };
    const locked: AtlasFs = {
      ...nodeAtlasFs,
      hashFile: async (abs) => {
        if (abs.replace(/\\/g, "/").endsWith("cad/arm.step")) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
        return nodeAtlasFs.hashFile(abs);
      },
    };
    const i = await buildAtlasIndex(await load(d), { previous: null, git, fs: locked });
    expect(i.enumerator).toBe("walk");
    expect(logs).toBe(0);
    expect(i.nodes.find((n) => n.id === "file:cad/arm.step")).toMatchObject({ status: "failed" });
    expect(i.nodes.find((n) => n.id === "file:cad/arm.step")!.created).toBeUndefined();
    expect(i.census.find((c) => c.path === "cad/arm.step")!.created).toBeUndefined();
    expect(i.problems.map((p) => p.reason)).not.toContain("HISTORY_FALLBACK");
  });

  it("parses the -z stream so that no path is taken for a header or a status", () => {
    const odd = ["A", "D", "\x01123", "line\nbreak.md", "sp ace/é.md"];
    const out = commit(20, odd.map((p) => ["A", p] as [string, string])) + commit(10, [["A", "old.md"], ["A", "A"]]) + `\x01999\0`; // a commit with no files, last
    const times = parseAddTimes(out);
    for (const p of odd) expect(times.get(p), JSON.stringify(p)).toBe(20 * S);
    expect(times.get("old.md")).toBe(10 * S);
    expect(times.size).toBe(odd.length + 1);
    expect(parseAddTimes("")).toEqual(new Map());
  });
});

// a real repository: git init in an ignored folder of this one (its own work tree), two commits with set author dates
const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
describe.skipIf(!hasGit)("creation times from a real git history", () => {
  it("records each file's add commit by author time, and the birth time of an untracked file", async () => {
    const dir = fixture();
    const git = (args: string[], date?: string) => {
      const r = spawnSync("git", ["-c", "user.name=Atlas", "-c", "user.email=atlas@example.invalid", "-c", "core.autocrlf=false", ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
      });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    git(["init", "-q"]);
    writeFileSync(join(dir, ".gitignore"), ".protoboard/\nnode_modules/\n");
    git(["add", ".gitignore", "protoboard.config.ts", "package.json", "src", "cad"]);
    git(["commit", "-q", "-m", "model"], "2026-02-01T09:00:00Z");
    git(["add", "docs", "photos"]);
    git(["commit", "-q", "-m", "docs"], "2026-03-15T18:30:00Z");
    const index = await buildAtlasIndex(await load(dir), { previous: null });
    expect(index.enumerator).toBe("git");
    const node = (id: string) => index.nodes.find((x) => x.id === id)!;
    expect(node("file:cad/arm.step").created).toEqual({ at: Date.parse("2026-02-01T09:00:00Z"), from: "git" });
    expect(node("def:arm").created).toEqual({ at: Date.parse("2026-02-01T09:00:00Z"), from: "git" });
    expect(node("file:docs/notes.md").created).toEqual({ at: Date.parse("2026-03-15T18:30:00Z"), from: "git" });
    expect(node("file:photos/Café shot 1.jpg").created).toEqual({ at: Date.parse("2026-03-15T18:30:00Z"), from: "git" });
    expect(node("dir:docs/renders/").created).toEqual({ at: Date.parse("2026-03-15T18:30:00Z"), from: "git" });
    // never committed: the file system's time
    expect(node("file:sketches/idea.png").created!.from).toMatch(/^(birthtime|mtime)$/);
    expect(index.problems.map((p) => p.reason)).not.toContain("HISTORY_FALLBACK");
  }, 60_000);
});

describe("Atlas index of the quadcopter reference project", async () => {
  const p = await loadProject(QUAD);
  const outDir = join(TMP, "quad");
  const written = await writeAtlasIndex(p, { outDir });
  const index = JSON.parse((await import("node:fs")).readFileSync(written.file, "utf8")) as AtlasIndex;

  it("links the frame's STEP body to the frame", () => {
    const step = "src/modules/frame/out/body.step";
    expect(index.nodes.find((x) => x.id === `file:${step}`)).toMatchObject({ kind: "cad", status: "ok" });
    expect(index.edges.some((e) => e.from === "def:quadcopter-5in-frame" && e.to === `file:${step}` && e.type === "has")).toBe(true);
    expect(index.census.find((c) => c.path === step)).toMatchObject({ status: "linked" });
  });

  it("links the tech-docs images through their operation record", () => {
    const images = index.census.filter((c) => /^docs\/images\/[^/]+\.png$/.test(c.path));
    expect(images.length).toBeGreaterThan(0);
    for (const c of images) {
      expect(c.status).toBe("linked");
      expect(c.linkedBy!.some((b) => b.startsWith("operation:operations/"))).toBe(true);
    }
  });

  it("counts as unlinked exactly the files the census does, not the produced files with no module", () => {
    expect(index.nodes.filter(isUnlinkedFile).length).toBe(index.counts.census.unlinked);
    const producedAlone = index.nodes.filter((x) => x.degree === 0 && !!x.file?.producedBy);
    expect(producedAlone.length).toBeGreaterThan(0);
    expect(producedAlone.some(isUnlinkedFile)).toBe(false);
  });

  it("has no failures, and never writes into the example", () => {
    expect(index.counts.census.failed).toBe(0);
    expect(index.problems).toEqual([]);
    expect(written.file.startsWith(outDir)).toBe(true);
    // its files are tracked: their creation times come from the history
    expect(index.counts.created!.git).toBeGreaterThan(0);
    expect(index.nodes.find((x) => x.id === "file:src/modules/frame/out/body.step")!.created!.from).toBe("git");
    expect(index.nodes.filter((x) => x.kind === "module" || x.kind === "part").length).toBe(p.definitions.size);
  });
});

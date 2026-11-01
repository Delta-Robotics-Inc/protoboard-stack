/**
 * The one model resolver (PB-1174, part-files.ts): the order of sources,
 * placeholders, the model table in resolved.json, the import provider's
 * board STEP mapping, and vendor fetches (stubbed: no network in tests).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchPartModel,
  fileSlug,
  glbJson,
  importPartFile,
  loadProject,
  machineCacheDir,
  mapBoardStep,
  modelTable,
  nodeDesignator,
  placeholderGlb,
  putInCache,
  readPartSources,
  resolvePartFile,
  restorePartFiles,
  sha256,
  stepProductNames,
  vendorKey,
  writeBuild,
  writePartSources,
  type Fetcher,
} from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/part-files");
const CACHE = join(TMP, "cache");
let n = 0;
const tmpProject = (files: Record<string, string | Buffer>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};
let savedCache: string | undefined;
beforeAll(() => {
  savedCache = process.env.PROTOBOARD_CACHE_DIR;
  process.env.PROTOBOARD_CACHE_DIR = CACHE;
});
afterAll(() => {
  if (savedCache === undefined) delete process.env.PROTOBOARD_CACHE_DIR;
  else process.env.PROTOBOARD_CACHE_DIR = savedCache;
  rmSync(TMP, { recursive: true, force: true });
});

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const GLB = (name: string) => placeholderGlb({ name, size_mm: [1, 1, 1] }); // any valid GLB stands in for a body
const part = (id: string, extra = "") => `{ id: "${id}", name: "${id}", kind: "module", interfaces: [], domains: [{ domain: "mechanical", dimensions_mm: { length: 12, width: 8, height: 3 } }]${extra} }`;
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export const A: ModuleDef = ${part("part-a", `, artifacts: [{ id: "a_glb", name: "A", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "parts/local/part-a/a.glb" }]`)};
export const B: ModuleDef = ${part("part-b")};
export const C: ModuleDef = ${part("part-c", `, tags: ["placeholder"], artifacts: [{ id: "c_glb", name: "C", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "parts/local/part-c/c.glb" }]`)};
export const SOLDER: ModuleDef = { id: "solder", name: "Solder", kind: "module", interfaces: [], tags: ["consumable"] };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [
  { id: "a", moduleDefId: "part-a" }, { id: "b1", moduleDefId: "part-b" }, { id: "b2", moduleDefId: "part-b" }, { id: "c", moduleDefId: "part-c" }, { id: "solder", moduleDefId: "solder" },
] };
`;
const base = () => ({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS, "parts/local/part-a/a.glb": GLB("a"), "parts/local/part-c/c.glb": GLB("c") });

describe("names", () => {
  it("vendor keys and file names are valid on Windows", () => {
    expect(vendorKey({ type: "lcsc", id: "c393939" })).toBe("lcsc-C393939");
    expect(vendorKey({ type: "kicad-lib", id: "Package_TO_SOT_SMD:SOT-23" })).toBe("kicad-Package_TO_SOT_SMD-SOT-23");
    expect(vendorKey({ type: "manufacturer", maker: "GCT", id: "USB4720/03:A" })).toBe("mpn-GCT-USB4720-03-A");
    for (const bad of ['a"b', "a<b>c", "x|y?z*", "name. ", "con", "a\\b/c:d"]) {
      const s = fileSlug(bad);
      expect(s).not.toMatch(/[<>:"/\\|?*]/);
      expect(s).not.toMatch(/[. ]$/);
      expect(s.toLowerCase()).not.toBe("con");
    }
  });
});

describe("placeholder GLB", () => {
  it("is an amber box tagged extras.protoboard.placeholder, in glTF metres, Y up", () => {
    const g = glbJson(placeholderGlb({ name: "u3", size_mm: [10, 6, 2], extras: { part: "u3-part" } })) as any;
    expect(g.nodes[0].extras.protoboard).toMatchObject({ placeholder: true, part: "u3-part", size_mm: [10, 6, 2] });
    expect(g.scenes[0].extras.protoboard.placeholder).toBe(true);
    expect(g.materials[0].name).toBe("protoboard-placeholder");
    expect(g.extensionsUsed).toBeUndefined();
    // mm, Z up → m, Y up: length on X, height on Y from the mounting face, width on Z
    expect(g.accessors[0].min).toEqual([-0.005, 0, expect.closeTo(-0.003, 6)]);
    expect(g.accessors[0].max).toEqual([0.005, expect.closeTo(0.002, 6), expect.closeTo(0.003, 6)]);
    // deterministic
    expect(placeholderGlb({ name: "u3", size_mm: [10, 6, 2] }).equals(placeholderGlb({ name: "u3", size_mm: [10, 6, 2] }))).toBe(true);
  });
});

describe("resolver order", () => {
  it("the part's own body, then a recorded vendor file, then the machine cache, then a placeholder; a pin wins", async () => {
    const dir = tmpProject(base());
    let p = await loadProject(dir, { checks: false });
    const a = resolvePartFile(p, "a");
    // a module of the project (src/): its own body is the design
    expect(a).toMatchObject({ source: "artifact", artifact: "a_glb", path: "parts/local/part-a/a.glb", tier: "design", placeholder: false });
    expect(a.sha256).toBe(sha256(readFileSync(join(dir, "parts/local/part-a/a.glb"))));

    // nothing for part-b: the amber box, sized from its package (12 x 8 x 3 mm)
    const b = resolvePartFile(p, "b1");
    expect(b).toMatchObject({ source: "placeholder", tier: "M8", placeholder: true, path: ".protoboard/build/placeholders/part-b.glb" });
    expect(b.placeholderInfo).toMatchObject({ size_mm: [12, 8, 3], sizeSource: "package", heightSource: "package" });
    expect(resolvePartFile(p, "b1", "model", { noPlaceholder: true }).source).toBe("none");

    // a declared stand-in body is used, and flagged
    expect(resolvePartFile(p, "c")).toMatchObject({ source: "artifact", tier: "M8", placeholder: true, placeholderInfo: { heightSource: "declared" } });

    // a vendor model the project fetched (parts/files, gitignored) comes before the placeholder
    const vend = GLB("vendor");
    mkdirSync(join(dir, "parts/files/part-b"), { recursive: true });
    writeFileSync(join(dir, "parts/files/part-b/model.lcsc-C123456.glb"), vend);
    writePartSources(dir, {
      schema: "protoboard.part-sources/v0",
      parts: { "part-b": { files: [{ id: "lcsc-C123456", kind: "model", format: "glb", sha256: sha256(vend), source: { type: "lcsc", id: "C123456" }, path: "parts/files/part-b/model.lcsc-C123456.glb" }] } },
    });
    p = await loadProject(dir, { checks: false });
    expect(resolvePartFile(p, "b1")).toMatchObject({ source: "vendor", tier: "M2", provenance: { entry: "lcsc-C123456", sourceType: "lcsc" }, placeholder: false });

    // the project copy gone: the machine cache has the bytes by sha256
    rmSync(join(dir, "parts/files/part-b/model.lcsc-C123456.glb"));
    putInCache(vend, "lcsc:C123456", {});
    const cached = resolvePartFile(p, "b1");
    expect(cached.source).toBe("vendor");
    expect(cached.file!.startsWith(machineCacheDir())).toBe(true);
    expect(cached.path!.startsWith("cache:")).toBe(true);

    // a per-instance pin wins over the part's own body
    const own = GLB("pinned");
    writeFileSync(join(dir, "parts/files/pinned.glb"), own);
    const data = readPartSources(dir);
    data.parts["part-a"] = { files: [{ id: "url-0001", kind: "model", format: "glb", sha256: sha256(own), source: { type: "url", url: "https://example.com/a.glb" }, path: "parts/files/pinned.glb" }], instances: { a: { model: "url-0001" } } };
    writePartSources(dir, data);
    p = await loadProject(dir, { checks: false });
    expect(resolvePartFile(p, "a")).toMatchObject({ source: "pin", path: "parts/files/pinned.glb" });
    expect(resolvePartFile(p, { part: "part-a" })).toMatchObject({ source: "artifact" });
  });

  it("a recorded file that is neither in the project nor cached is reported, and a changed one too", async () => {
    const dir = tmpProject(base());
    const bytes = Buffer.from("not cached");
    writePartSources(dir, { schema: "protoboard.part-sources/v0", parts: { "part-b": { files: [{ id: "kicad-x", kind: "model", format: "glb", sha256: sha256(bytes), source: { type: "kicad-lib", id: "Lib:X" }, path: "parts/files/part-b/model.kicad-x.glb" }] } } });
    const p = await loadProject(dir);
    expect(p.diagnostics.find((d) => d.code === "PB_PART_FILE_NOT_CACHED")?.message).toMatch(/protoboard parts fetch part-b/);
    mkdirSync(join(dir, "parts/files/part-b"), { recursive: true });
    writeFileSync(join(dir, "parts/files/part-b/model.kicad-x.glb"), "other bytes");
    const p2 = await loadProject(dir);
    expect(p2.diagnostics.some((d) => d.code === "PB_PART_FILE_MISMATCH" && d.severity === "error")).toBe(true);
  });

  it("a path in the record that leaves the project is never read", async () => {
    const dir = tmpProject(base());
    writePartSources(dir, { schema: "protoboard.part-sources/v0", parts: { "part-b": { files: [{ id: "url-x", kind: "model", format: "glb", sha256: sha256("x"), source: { type: "url" }, path: "../../outside.glb" }] } } });
    const p = await loadProject(dir, { checks: false });
    expect(resolvePartFile(p, "b1").source).toBe("placeholder");
  });
});

describe("model table and check", () => {
  it("writes the table into resolved.json and a placeholder GLB per part; check reports PB_MODEL_MISSING per instance", async () => {
    const dir = tmpProject(base());
    const p = await loadProject(dir);
    const missing = p.diagnostics.filter((d) => d.code === "PB_MODEL_MISSING");
    expect(missing.map((d) => d.entity.id).sort()).toEqual(["b1", "b2"]);
    expect(p.diagnostics.filter((d) => d.code === "PB_MODEL_PLACEHOLDER").map((d) => d.entity.id)).toEqual(["c"]);
    expect(p.checks.find((c) => c.validator === "protoboard/part-files")?.status).toBe("ran");

    writeBuild(p);
    const resolved = JSON.parse(readFileSync(join(dir, ".protoboard/build/resolved.json"), "utf8"));
    const t = resolved.models;
    expect(t.schema).toBe("protoboard.models/v0");
    // solder is a consumable: not drawn, not counted
    expect(t.instances.map((e: { instance: string }) => e.instance).sort()).toEqual(["a", "b1", "b2", "c"]);
    expect(t.counts).toMatchObject({ instances: 4, resolved: 1, placeholders: 3, missing: 2 });
    for (const e of t.instances) {
      expect(Object.keys(e)).toEqual(expect.arrayContaining(["instance", "part", "file", "sha256", "tier", "source", "provenance", "placeholder"]));
      expect(e.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    const ph = join(dir, ".protoboard/build/placeholders/part-b.glb");
    expect(existsSync(ph)).toBe(true);
    expect((glbJson(readFileSync(ph)) as any).nodes[0].extras.protoboard.placeholder).toBe(true);
    // the table's digest is the file's
    expect(t.instances.find((e: { instance: string }) => e.instance === "b1").sha256).toBe(sha256(readFileSync(ph)));
    // stable: the same inputs give the same bytes
    const again = readFileSync(join(dir, ".protoboard/build/resolved.json"), "utf8");
    writeBuild(await loadProject(dir));
    expect(readFileSync(join(dir, ".protoboard/build/resolved.json"), "utf8")).toBe(again);
  });

  it("a project with no bodies at all is not told every part lacks a model", async () => {
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS.replace(/, artifacts: \[[^\]]*\]/g, "") });
    const p = await loadProject(dir);
    expect(p.diagnostics.some((d) => d.code === "PB_MODEL_MISSING")).toBe(false);
    expect(p.checks.find((c) => c.validator === "protoboard/part-files")?.status).toBe("skipped");
    expect(modelTable(p).counts.placeholders).toBe(4);
  });
});

// a small ECAD board STEP's product structure, as EasyEDA names it: <designator>~<footprint>~<footprint>~<board tag>
const BOARD_STEP = [
  "ISO-10303-21;",
  "HEADER;",
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
  "ENDSEC;",
  "DATA;",
  "#7 = PRODUCT('EasyEDA PCB Model~T1','EasyEDA PCB Model~T1','',(#8));",
  "#20 = PRODUCT('TopCopper~T1','TopCopper~T1','',(#8));",
  "#21 = PRODUCT('R1~R0603~R0603~T1','R1~R0603~R0603~T1','',(#8));",
  "#22 = PRODUCT('C2~C0402~C0402~T1',",
  "  'C2~C0402~C0402~T1','',(#8));",
  "#23 = PRODUCT('USB-C-SMD_TYPE-C16PIN-C393939~USB-C-SMD~T1','x','',(#8));",
  "#24 = PRODUCT('LED9~LED0603~LED0603~T1','x','',(#8));",
  "#30 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO1','R1','',#5,#6,$);",
  "ENDSEC;",
  "END-ISO-10303-21;",
  "",
].join("\n");

describe("import provider", () => {
  it("reads a STEP's product structure without evaluating it", () => {
    const dir = tmpProject({ "board.step": BOARD_STEP });
    const names = stepProductNames(join(dir, "board.step"));
    expect(names.products).toContain("C2~C0402~C0402~T1");
    expect(names.occurrences).toEqual(["R1"]);
    expect(nodeDesignator("R1~R0603~R0603~T1")).toBe("R1");
    expect(nodeDesignator("TopCopper~T1")).toBeUndefined();
    expect(nodeDesignator("U12")).toBe("U12");
    expect(() => stepProductNames(join(dir, "board.step"), 10)).toThrow(/limit/);
  });

  it("maps component nodes to instances by designator, then LCSC C-number", () => {
    const comps = [
      { path: "pcb/r1", rel: "r1", part: "r", designators: ["R1"] },
      { path: "pcb/g/c2", rel: "g/c2", part: "c", designators: ["C2"] },
      { path: "pcb/usb", rel: "usb", part: "usbc", designators: ["USB", "J1"], lcsc: "C393939" },
      { path: "pcb/u9", rel: "u9", part: "u", designators: ["U9"] },
    ];
    const names = stepProductNames(join(tmpProject({ "b.step": BOARD_STEP }), "b.step"));
    const m = mapBoardStep([...names.products, ...names.occurrences], comps, "imported-x");
    expect(m.components).toEqual({
      r1: { node: "R1~R0603~R0603~T1", by: "designator" },
      "g/c2": { node: "C2~C0402~C0402~T1", by: "designator" },
      usb: { node: "USB-C-SMD_TYPE-C16PIN-C393939~USB-C-SMD~T1", by: "lcsc", lcsc: "C393939" },
    });
    expect(m.unmatchedInstances).toEqual(["u9"]);
    expect(m.unmatchedNodes).toContain("LED9~LED0603~LED0603~T1");
  });

  it("records the file, binds the module with constraints.import, maps a board, and puts the mapping in the model table", async () => {
    const sys = `import type { ModuleDef } from "@deltarobotics/uhd";
export const R: ModuleDef = { id: "res", name: "R", kind: "module", interfaces: [] };
export const BOARD: ModuleDef = { id: "pcb-x", name: "Board", kind: "board", interfaces: [], children: [{ id: "r1", moduleDefId: "res", name: "R1 10k" }, { id: "c2", moduleDefId: "res" }, { id: "u9", moduleDefId: "res" }] };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "pcb", moduleDefId: "pcb-x" }] };
`;
    const dir = tmpProject({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": sys, "cad/board.step": BOARD_STEP, "outside.txt": "x" });
    const p = await loadProject(dir, { checks: false });
    expect(() => importPartFile(p, "../../../package.json", "pcb-x")).toThrow(/outside the project/);
    expect(() => importPartFile(p, "outside.txt", "pcb-x")).toThrow(/import takes/);
    const r = importPartFile(p, "cad/board.step", "pcb-x");
    expect(r.entry).toMatchObject({ kind: "model", format: "step", source: { type: "imported" }, path: "cad/board.step", tier: "design" });
    expect(r.config).toBe("src/cad.config.ts");
    const cfg = readFileSync(join(dir, "src/cad.config.ts"), "utf8");
    expect(cfg).toContain(`provider: "@protoboardai/ext-parts"`);
    expect(cfg).toContain(`import: "../cad/board.step"`);
    expect(cfg).toContain(r.entry.sha256);
    expect(r.board!.components).toMatchObject({ r1: { by: "designator" }, c2: { by: "designator" } });
    expect(r.board!.unmatchedInstances).toEqual(["u9"]);
    const rec = readPartSources(dir).parts["pcb-x"];
    expect(rec.board!.step).toBe(r.entry.id);
    // a re-import keeps one imported record, and an existing config unless replace
    const again = importPartFile(p, "cad/board.step", "pcb-x");
    expect(again.keptConfig).toBe("src/cad.config.ts");
    expect(readPartSources(dir).parts["pcb-x"].files.filter((f) => f.source.type === "imported")).toHaveLength(1);

    // the board has its own body once exported; its components are then drawn by it, with their STEP node
    mkdirSync(join(dir, "src/out"), { recursive: true });
    writeFileSync(join(dir, "src/out/body.glb"), GLB("board"));
    const withBody = sys.replace(`kind: "board", interfaces: [],`, `kind: "board", interfaces: [], artifacts: [{ id: "cad_glb", name: "B", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "src/out/body.glb" }],`);
    writeFileSync(join(dir, "src/sys.uhd.ts"), withBody);
    const t = modelTable(await loadProject(dir, { checks: false, fresh: true }));
    const r1 = t.instances.find((e) => e.instance === "pcb/r1");
    expect(r1).toMatchObject({ drawnBy: "pcb", node: { name: "R1~R0603~R0603~T1", by: "designator" } });
    expect(t.boards?.pcb.unmatchedInstances).toEqual(["pcb/u9"]);
    expect(t.counts.drawnByHolder).toBe(3);
  });
});

describe("vendor fetch (no network: stubs)", () => {
  const step = `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`;

  it("copies a KiCad library model from the installed library offline, records it with its terms and ignores the bytes in git", async () => {
    const dir = tmpProject(base());
    const lib = join(TMP, `kicad${n}`);
    mkdirSync(join(lib, "Package_TO_SOT_SMD.3dshapes"), { recursive: true });
    writeFileSync(join(lib, "Package_TO_SOT_SMD.3dshapes", "SOT-23.step"), step);
    const p = await loadProject(dir, { checks: false });
    const fetcher: Fetcher = async () => {
      throw new Error("no network in this test");
    };
    const o = await fetchPartModel(p, "part-b", { type: "kicad", id: "Package_TO_SOT_SMD:SOT-23" }, { kicadDirs: [lib], fetcher });
    expect(o).toMatchObject({ status: "copied", network: false, key: "kicad-Package_TO_SOT_SMD-SOT-23" });
    const file = join(dir, "parts/files/part-b/model.kicad-Package_TO_SOT_SMD-SOT-23.step");
    expect(readFileSync(file, "utf8")).toBe(step);
    expect(JSON.parse(readFileSync(`${file}.json`, "utf8"))).toMatchObject({ schema: "protoboard.model-sidecar/v0", terms: { distribution: "redistributable", license: "CC-BY-SA-4.0" } });
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("parts/files/**/model.*");
    const rec = readPartSources(dir).parts["part-b"].files[0];
    expect(rec).toMatchObject({ tier: "M5", source: { type: "kicad-lib", id: "Package_TO_SOT_SMD:SOT-23" } });
    // for a STEP reader it resolves; the viewer (GLB) still gets the placeholder until a mesh is made
    const p2 = await loadProject(dir, { checks: false });
    expect(resolvePartFile(p2, "b1", "model", { formats: ["step"] })).toMatchObject({ source: "vendor", tier: "M5" });
    expect(resolvePartFile(p2, "b1", "model", { formats: ["glb"] }).source).toBe("placeholder");
    // a fresh clone: the project copy is gone, the cache restores it
    rmSync(file);
    const restored = await restorePartFiles(p2, { offline: true, kicadDirs: [] });
    expect(restored).toMatchObject([{ status: "restored", network: false }]);
    expect(existsSync(file)).toBe(true);
  });

  it("fetches EasyEDA's model for a C-number through the given fetcher, terms unknown", async () => {
    const dir = tmpProject(base());
    const p = await loadProject(dir, { checks: false });
    const urls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      urls.push(url);
      const body = url.includes("/api/products/") ? JSON.stringify({ result: { packageDetail: { dataStr: { shape: ["TRACK~x", `SVGNODE~${JSON.stringify({ attrs: { uuid: "0123456789abcdef0123456789abcdef", title: "USB-C" } })}`] } } } }) : step;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
    };
    const o = await fetchPartModel(p, "part-b", { type: "lcsc", id: "c393939" }, { fetcher });
    expect(o).toMatchObject({ status: "fetched", key: "lcsc-C393939", network: true });
    expect(urls[0]).toMatch(/easyeda\.com\/api\/products\/C393939\/components/);
    expect(o.entry).toMatchObject({ tier: "M2", terms: { distribution: "unknown" }, path: "parts/files/part-b/model.lcsc-C393939.step" });
    expect((await fetchPartModel(p, "part-b", { type: "lcsc", id: "C1" }, { offline: true })).status).toBe("failed");
    expect((await fetchPartModel(p, "part-b", { type: "url", url: "http://example.com/a.step" }, { fetcher })).message).toMatch(/only https/);
  });
});

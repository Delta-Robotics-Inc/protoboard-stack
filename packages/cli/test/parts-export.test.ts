/**
 * `protoboard parts export` (PB-1191, W4-B): the full-resolution body as GLB,
 * STEP, STL or 3MF; a component cut out of its holder's GLB through the
 * holder's view index; placeholders refused; the GLB reader's guards.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { placeholderGlb, sha256OfFile } from "@protoboardai/core";
import { glbBytes, partsExport, readGlb, stlBytes, threeMfBytes, toMmZUp, worldMeshes, zipBytes, type WorldMesh } from "../src/parts-export.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/parts-export");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const project = (files: Record<string, string | Buffer>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const part = (id: string, extra = "") => `{ id: "${id}", name: "${id}", kind: "module", interfaces: [], domains: [{ domain: "mechanical", dimensions_mm: { length: 12, width: 8, height: 3 } }]${extra} }`;
const glbArt = (id: string, path: string) => `{ id: "${id}_glb", name: "${id}", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "${path}" }`;
const stepArt = (id: string, path: string) => `{ id: "${id}_step", name: "${id}", type: "3d_model", role: "body", format: "step", units: "mm", filePath: "${path}" }`;
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export const A: ModuleDef = ${part("part-a", `, artifacts: [${glbArt("a", "parts/local/part-a/a.glb")}, ${stepArt("a", "parts/local/part-a/a.step")}]`)};
export const C: ModuleDef = ${part("part-c", `, tags: ["placeholder"], artifacts: [${glbArt("c", "parts/local/part-c/c.glb")}]`)};
export const CHIP: ModuleDef = ${part("chip")};
export const BOARD: ModuleDef = { id: "board-def", name: "Board", kind: "module", interfaces: [], artifacts: [${glbArt("board", "parts/local/board/board.glb")}], children: [{ id: "u1", moduleDefId: "chip" }] };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "a", moduleDefId: "part-a" }, { id: "c", moduleDefId: "part-c" }, { id: "board", moduleDefId: "board-def" }] };
`;

/** Two meshes: the component's (a 1 mm triangle pair lifted 2 mm in glTF Y) and the board's rest. */
const tri = (name: string, y: number): WorldMesh => ({ name, positions: new Float32Array([0, y, 0, 0.001, y, 0, 0, y, -0.001, 0.001, y, -0.001]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) });
const BOARD_GLB = glbBytes([tri("U1~SOIC-8", 0.002), tri("EasyEDA board", 0)]);
const VIEW_INDEX = JSON.stringify({ schema: "protoboard.view-sidecar/v0", nodes: [{ id: "u1", instancePath: "u1", name: "U1~SOIC-8", node: 1 }, { id: ".", instancePath: "", name: "EasyEDA board", node: 0 }] });

const base = () =>
  project({
    "protoboard.config.ts": CONFIG,
    "src/sys.uhd.ts": SYS,
    "parts/local/part-a/a.glb": placeholderGlb({ name: "a", size_mm: [10, 6, 2] }), // any valid GLB stands in for a body
    "parts/local/part-a/a.step": "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
    "parts/local/part-c/c.glb": placeholderGlb({ name: "c", size_mm: [1, 1, 1] }),
    "parts/local/board/board.glb": BOARD_GLB,
    "parts/local/board/board.view.json": VIEW_INDEX,
  });

const run = async (dir: string, rest: string[], flags: Record<string, string | undefined>) => {
  let data: Record<string, unknown> = {};
  let text = "";
  const code = await partsExport(dir, rest, flags, (d, t) => {
    data = d as Record<string, unknown>;
    text = t();
  });
  return { code, data, text };
};

/** Bounds of a binary STL (mm). */
function stlBounds(b: Buffer) {
  const count = b.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const x = b.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
    min[k] = Math.min(min[k], x);
    max[k] = Math.max(max[k], x);
  }
  return { count, min, max };
}

/** The files of a zip written by zipBytes (stored names and inflated data). */
function unzip(b: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (b.readUInt32LE(at) === 0x04034b50) {
    const size = b.readUInt32LE(at + 18);
    const nameLen = b.readUInt16LE(at + 26);
    const name = b.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const data = b.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    out.set(name, inflateRawSync(data).toString("utf8"));
    at += 30 + nameLen + size;
  }
  return out;
}

describe("parts export: a part's own body", () => {
  it("glb is the body file as it is (never the view sidecar), with a record of where it came from", async () => {
    const dir = base();
    const r = await run(dir, ["part-a"], { format: "glb" });
    expect(r.code).toBe(0);
    const out = join(dir, ".protoboard/exports/part-a.glb");
    expect(sha256OfFile(out)).toBe(sha256OfFile(join(dir, "parts/local/part-a/a.glb")));
    const rec = JSON.parse(readFileSync(join(dir, ".protoboard/exports/part-a.export.json"), "utf8"));
    expect(rec).toMatchObject({ schema: "protoboard.part-export/v0", part: "part-a", format: "glb", source: { file: "parts/local/part-a/a.glb" }, units: "m (glTF), Y up" });
  });

  it("an instance path works as well as a definition id; step copies the STEP", async () => {
    const dir = base();
    const r = await run(dir, ["a"], { format: "step", out: join(dir, "handoff") });
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "handoff/a.step"), "utf8")).toMatch(/^ISO-10303-21/);
  });

  it("stl and 3mf are millimetres and Z up, from the full-resolution GLB", async () => {
    const dir = base();
    await run(dir, ["part-a"], { format: "stl", out: join(dir, "x/a.stl") });
    const b = stlBounds(readFileSync(join(dir, "x/a.stl")));
    expect(b.count).toBe(12);
    // the placeholder box: 10 mm along X, 6 mm across (glTF Z, so -Z → +Y here), 2 mm high from the mounting face
    expect(b.min.map((v) => +v.toFixed(3))).toEqual([-5, -3, 0]);
    expect(b.max.map((v) => +v.toFixed(3))).toEqual([5, 3, 2]);
    await run(dir, ["part-a"], { format: "3mf" });
    const files = unzip(readFileSync(join(dir, ".protoboard/exports/part-a.3mf")));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    const model = files.get("3D/3dmodel.model")!;
    expect(model).toMatch(/unit="millimeter"/);
    // one object (a slicer takes each object as a part), a box welded: 8 vertices, 12 triangles
    expect(model.match(/<object /g)).toHaveLength(1);
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(model.match(/<triangle /g)).toHaveLength(12);
  });

  it("refuses a placeholder body, a STEP that is not there, unknown formats and the output switch as a format", async () => {
    const dir = base();
    await expect(run(dir, ["part-c"], { format: "stl" })).rejects.toThrow(/only a placeholder body/);
    await expect(run(dir, ["part-a"], { format: "obj" })).rejects.toThrow(/--format is one of step, stl, 3mf, glb/);
    await expect(run(dir, ["part-a"], { format: "json" })).rejects.toThrow(/usage: protoboard parts export/);
    await expect(run(dir, ["nope"], { format: "glb" })).rejects.toThrow(/no part or instance "nope"/);
    await expect(run(dir, ["board-def"], { format: "step" })).rejects.toThrow(/no STEP body/);
  });
});

describe("parts export: a component drawn inside its holder's body", () => {
  it("cuts the component's node out of the holder's GLB through the holder's view index, placement baked in", async () => {
    const dir = base();
    const r = await run(dir, ["board/u1"], { format: "stl" });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/node "U1~SOIC-8" of board's full-resolution GLB \(found through board.view.json\)/);
    const b = stlBounds(readFileSync(join(dir, ".protoboard/exports/board-u1.stl")));
    expect(b.count).toBe(2);
    // glTF Y 0.002 m → Z 2 mm
    expect(b.min[2]).toBeCloseTo(2, 4);
    expect(b.max[2]).toBeCloseTo(2, 4);
    const g = await run(dir, ["board/u1"], { format: "glb" });
    expect(g.code).toBe(0);
    const { json, bin } = readGlb(join(dir, ".protoboard/exports/board-u1.glb"));
    expect(worldMeshes(json, bin).map((m) => m.name)).toEqual(["U1~SOIC-8"]);
    await expect(run(dir, ["board/u1"], { format: "step" })).rejects.toThrow(/has no STEP of its own/);
  });
});

describe("the GLB reader and the writers", () => {
  it("round-trips meshes, applies node transforms, and keeps a mirrored mesh's faces out", () => {
    const g = glbBytes([tri("t", 0)]);
    const file = join(TMP, "rt.glb");
    mkdirSync(TMP, { recursive: true });
    writeFileSync(file, g);
    const { json, bin } = readGlb(file);
    // wrap the mesh node in a parent that moves it 1 m in X and mirrors Z
    json.nodes!.push({ name: "parent", children: [0], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 1] });
    json.scenes = [{ nodes: [1] }];
    const [m] = worldMeshes(json, bin);
    expect(Array.from(m.positions.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(m.positions[8]).toBeCloseTo(0.001, 6);
    expect(Array.from(m.indices.subarray(0, 3))).toEqual([0, 2, 1]);
    expect(worldMeshes(json, bin, "t")[0].positions[0]).toBe(1);
    expect(() => worldMeshes(json, bin, "missing")).toThrow(/no node named "missing"/);
  });

  it("refuses GLBs that require extensions it does not read (a view sidecar's meshopt)", () => {
    const g = glbBytes([tri("t", 0)]);
    const jsonLen = g.readUInt32LE(12);
    const json = JSON.parse(g.subarray(20, 20 + jsonLen).toString("utf8"));
    json.extensionsRequired = ["EXT_meshopt_compression"];
    let jb = Buffer.from(JSON.stringify(json));
    jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
    const rest = g.subarray(20 + jsonLen);
    const head = Buffer.alloc(20);
    head.writeUInt32LE(0x46546c67, 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + jb.length + rest.length, 8);
    head.writeUInt32LE(jb.length, 12);
    head.writeUInt32LE(0x4e4f534a, 16);
    const file = join(TMP, "ext.glb");
    writeFileSync(file, Buffer.concat([head, jb, rest]));
    expect(() => readGlb(file)).toThrow(/requires EXT_meshopt_compression/);
    writeFileSync(join(TMP, "not.glb"), "hello world, not a glb");
    expect(() => readGlb(join(TMP, "not.glb"))).toThrow(/is not a GLB/);
  });

  it("converts glTF metres Y-up to mm Z-up, and writes deterministic STL, 3MF and zip bytes", () => {
    expect(Array.from(toMmZUp(new Float32Array([0.001, 0.002, 0.003])))).toEqual([1, -3, 2]);
    const meshes = [tri("t", 0)];
    expect(stlBytes(meshes).equals(stlBytes(meshes))).toBe(true);
    expect(threeMfBytes(meshes, "t").equals(threeMfBytes(meshes, "t"))).toBe(true);
    const z = zipBytes([{ name: "a.txt", data: Buffer.from("hello") }]);
    expect(unzip(z).get("a.txt")).toBe("hello");
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
  });
});

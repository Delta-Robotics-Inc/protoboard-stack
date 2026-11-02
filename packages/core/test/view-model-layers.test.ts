/**
 * Board layer separation in the view sidecar (fix wave R1, C1): an ECAD
 * board's copper and silkscreen sheets 0.01 mm apart z-fight in the viewer,
 * so the sidecar moves each outward from the substrate by rank. Checked on a
 * synthetic EasyEDA-style board: the offsets in both tiers, the index, the
 * layer materials' extras, X.glb untouched, and a GLB without board layers
 * keeping its cache key and its geometry.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO, type Material, type Node as GNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COARSE_ERROR, LAYER_STEP_MM, MESH_ORIGIN_ERROR, VIEW_PIPELINE_VERSION, layerClassOf, viewSidecarPaths, writeViewSidecar, type ViewSidecarIndex } from "../src/view-model/index.ts";

const dir = mkdtempSync(join(tmpdir(), "pb-view-layers-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** OCCT's and EasyEDA's Z-up to Y-up root rotation (-90° about X). */
const Z_UP: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const MM = 0.001;

/** A flat sheet at height z (metres, Z-up), wound to face -Z as EasyEDA winds every layer, top and bottom alike. */
function sheet(doc: Document, w: number, h: number, z: number) {
  const buf = doc.getRoot().listBuffers()[0];
  const pos = new Float32Array([-w / 2, -h / 2, z, w / 2, -h / 2, z, w / 2, h / 2, z, -w / 2, h / 2, z]);
  return doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1])).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 2, 1, 0, 3, 2])).setBuffer(buf));
}

/** A board slab from z0 to z1 (metres): top, bottom and four sides, one primitive each. */
function slab(doc: Document, w: number, h: number, z0: number, z1: number, mat: Material) {
  const buf = doc.getRoot().listBuffers()[0];
  const x = w / 2, y = h / 2;
  const quads = [
    [[-x, -y, z1], [x, -y, z1], [x, y, z1], [-x, y, z1]],
    [[-x, y, z0], [x, y, z0], [x, -y, z0], [-x, -y, z0]],
    [[x, -y, z0], [x, y, z0], [x, y, z1], [x, -y, z1]],
    [[-x, -y, z1], [-x, y, z1], [-x, y, z0], [-x, -y, z0]],
    [[-x, y, z1], [x, y, z1], [x, y, z0], [-x, y, z0]],
    [[-x, -y, z0], [x, -y, z0], [x, -y, z1], [-x, -y, z1]],
  ];
  const mesh = doc.createMesh("board");
  for (const q of quads) {
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(q.flat())).setBuffer(buf))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2, 0, 2, 3])).setBuffer(buf))
        .setMaterial(mat),
    );
  }
  return mesh;
}

/** Source heights (mm, Z-up) as in the ClientX EasyEDA export. */
const SRC = { boardTop: 1.6001, topCopper: 1.6101, topSilk: 1.6201, bottomCopper: -0.01, bottomSilk: -0.02 };

/** An EasyEDA-style board: wrapper, Board slab, Top/Bottom copper and silkscreen sheets (each sheet on a child node). */
async function easyedaBoard(file: string) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const mat0 = doc.createMaterial("mat_0").setBaseColorFactor([0.02, 0.02, 0.02, 1]);
  const mat1 = doc.createMaterial("mat_1").setBaseColorFactor([0, 0, 0, 1]);
  const mat2 = doc.createMaterial("mat_2").setBaseColorFactor([1, 1, 1, 1]);
  const root = doc.createNode("EasyEDA_PCB_Model~T").setRotation(Z_UP);
  scene.addChild(root);
  root.addChild(doc.createNode("Board~T").setMesh(slab(doc, 0.05, 0.03, 0, SRC.boardTop * MM, mat0)));
  const layer = (name: string, z: number, mat: Material, w: number) => {
    const n = doc.createNode(name);
    n.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(sheet(doc, w, 0.02, z * MM).setMaterial(mat))));
    root.addChild(n);
  };
  layer("TopCopper~T", SRC.topCopper, mat1, 0.04);
  layer("BottomCopper~T", SRC.bottomCopper, mat1, 0.04);
  layer("TopSilkscreen~T", SRC.topSilk, mat2, 0.03);
  layer("BottomSilkscreen~T", SRC.bottomSilk, mat2, 0.03);
  root.addChild(doc.createNode("TopFpcStiffener~T"));
  writeFileSync(file, await new NodeIO().writeBinary(doc));
}

/** Per material of a view GLB: the world Y (mm; = the board's Z in the Y-up file) of every vertex, and the material's extras. */
async function heights(file: string): Promise<Map<string, { ys: number[]; extras: Record<string, unknown> }>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(file);
  const out = new Map<string, { ys: number[]; extras: Record<string, unknown> }>();
  const visit = (n: GNode) => {
    const mesh = n.getMesh();
    if (mesh) {
      const w = n.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const m = p.getMaterial()!;
        const pb = (m.getExtras() as { protoboard?: Record<string, unknown> }).protoboard ?? {};
        const key = (pb.layer as string | undefined) ?? m.getName();
        const rec = out.get(key) ?? { ys: [], extras: pb };
        const pos = p.getAttribute("POSITION")!;
        const el = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          rec.ys.push((w[1] * el[0] + w[5] * el[1] + w[9] * el[2] + w[13]) / MM);
        }
        out.set(key, rec);
      }
    }
    n.listChildren().forEach(visit);
  };
  doc.getRoot().listScenes()[0].listChildren().forEach(visit);
  return out;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** 14-bit positions over a 50 mm mesh: a quantization step of about 0.003 mm. */
const Q = 0.004;

describe("board layers in the view sidecar (C1 z-fighting)", () => {
  const src = join(dir, "board", "body.glb");
  let index: ViewSidecarIndex;
  let srcSha: string;

  beforeAll(async () => {
    mkdirSync(join(dir, "board"), { recursive: true });
    await easyedaBoard(src);
    // a kernel coarse source beside it, so the coarse tier is a file of its own (and must carry the same offsets)
    copyFileSync(src, join(dir, "board", "body.coarse.glb"));
    srcSha = sha(readFileSync(src));
    index = (await writeViewSidecar(src, { context: { owner: { definition: "test-board", partKind: "board" } } })).index;
  });

  it("names layers from EasyEDA and KiCad node names", () => {
    expect(layerClassOf("TopCopper~BqNV")).toEqual({ kind: "copper", side: "top" });
    expect(layerClassOf("BottomSilkscreen~BqNV")).toEqual({ kind: "silkscreen", side: "bottom" });
    expect(layerClassOf("TopSolderMask~X")).toEqual({ kind: "mask", side: "top" });
    expect(layerClassOf("TopPasteMask~X")).toEqual({ kind: "paste", side: "top" });
    expect(layerClassOf("F.Cu")).toEqual({ kind: "copper", side: "top" });
    expect(layerClassOf("B.SilkS")).toEqual({ kind: "silkscreen", side: "bottom" });
    expect(layerClassOf("F.Mask")).toEqual({ kind: "mask", side: "top" });
    expect(layerClassOf("In1.Cu")).toEqual({ kind: "inner" });
    expect(layerClassOf("Board~BqNV")).toEqual({ kind: "substrate" });
    expect(layerClassOf("clientx_PCB")).toEqual({ kind: "substrate" });
    // not layers: components, stiffeners, mechanical parts
    for (const n of ["R34~R2512~X", "TopFpcStiffener~X", "Mainboard", "Housing", "Lid", "U1~SOIC-8~X", "CUSTOM_PART", "cube"]) expect(layerClassOf(n), n).toBeUndefined();
  });

  it("leaves X.glb byte for byte as it was", () => {
    expect(sha(readFileSync(src))).toBe(srcSha);
  });

  it("moves each layer outward from the substrate by rank in the fine tier; the substrate stays", async () => {
    const h = await heights(viewSidecarPaths(src).fine);
    const s = LAYER_STEP_MM;
    const at = (k: string) => {
      const r = h.get(k);
      expect(r, k).toBeDefined();
      return r!.ys;
    };
    const board = at("mat_0");
    expect(Math.min(...board)).toBeCloseTo(0, 2);
    expect(Math.abs(Math.max(...board) - SRC.boardTop)).toBeLessThan(Q);
    // copper and silkscreen keep separate materials per layer kind; each holds a top and a bottom sheet
    const copper = at("copper"), silk = at("silkscreen");
    const top = (ys: number[]) => ys.filter((y) => y > 0.8);
    const bottom = (ys: number[]) => ys.filter((y) => y < 0.8);
    for (const y of top(copper)) expect(Math.abs(y - (SRC.topCopper + 1 * s))).toBeLessThan(Q);
    for (const y of bottom(copper)) expect(Math.abs(y - (SRC.bottomCopper - 1 * s))).toBeLessThan(Q);
    for (const y of top(silk)) expect(Math.abs(y - (SRC.topSilk + 3 * s))).toBeLessThan(Q);
    for (const y of bottom(silk)) expect(Math.abs(y - (SRC.bottomSilk - 3 * s))).toBeLessThan(Q);
    expect(top(copper).length).toBe(4);
    expect(bottom(silk).length).toBe(4);
    // the gaps the depth buffer has to resolve: board → copper 0.03 mm, copper → silkscreen 0.05 mm (were 0.01 and 0.01)
    expect(Math.min(...top(copper)) - Math.max(...board)).toBeGreaterThan(0.025);
    expect(Math.min(...top(silk)) - Math.max(...top(copper))).toBeGreaterThan(0.045);
    expect(Math.min(...board) - Math.max(...bottom(copper))).toBeGreaterThan(0.025);
  });

  it("applies the same offsets in the coarse tier", async () => {
    expect(index.tiers.coarse.method).toBe("kernel-coarse");
    const h = await heights(viewSidecarPaths(src).coarse);
    const top = h.get("silkscreen")!.ys.filter((y) => y > 0.8);
    expect(top.length).toBeGreaterThan(0);
    for (const y of top) expect(Math.abs(y - (SRC.topSilk + 3 * LAYER_STEP_MM))).toBeLessThan(Q);
    for (const y of h.get("copper")!.ys.filter((y) => y < 0.8)) expect(Math.abs(y - (SRC.bottomCopper - LAYER_STEP_MM))).toBeLessThan(Q);
  });

  it("marks the layer materials with extras.protoboard.layer and layerRank, and records the offsets in the index", async () => {
    const h = await heights(viewSidecarPaths(src).fine);
    expect(h.get("copper")!.extras).toEqual({ layer: "copper", layerRank: 1 });
    expect(h.get("silkscreen")!.extras).toEqual({ layer: "silkscreen", layerRank: 3 });
    expect(h.get("mat_0")!.extras).toEqual({});
    expect(index.layers?.stepMm).toBe(LAYER_STEP_MM);
    expect(index.layers?.offsets).toEqual([
      { layer: "copper", side: "top", rank: 1, offsetMm: 0.02, faces: 1 },
      { layer: "silkscreen", side: "top", rank: 3, offsetMm: 0.06, faces: 1 },
      { layer: "copper", side: "bottom", rank: 1, offsetMm: 0.02, faces: 1 },
      { layer: "silkscreen", side: "bottom", rank: 3, offsetMm: 0.06, faces: 1 },
    ]);
    expect(index.design.layers).toMatch(/0\.02 mm/);
    expect(index.warnings ?? []).toEqual([]);
  });

  it("works whatever the board's orientation in the GLB (no wrapper rotation: the board normal is +Z)", async () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene();
    const m0 = doc.createMaterial("mat_0"), m2 = doc.createMaterial("mat_2").setBaseColorFactor([1, 1, 1, 1]);
    scene.addChild(doc.createNode("Board").setMesh(slab(doc, 0.05, 0.03, 0, SRC.boardTop * MM, m0)));
    scene.addChild(doc.createNode("TopSilkscreen").setMesh(doc.createMesh("s").addPrimitive(sheet(doc, 0.03, 0.02, SRC.topSilk * MM).setMaterial(m2))));
    const file = join(dir, "flat", "body.glb");
    mkdirSync(join(dir, "flat"), { recursive: true });
    writeFileSync(file, await new NodeIO().writeBinary(doc));
    await writeViewSidecar(file);
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const view = await io.read(viewSidecarPaths(file).fine);
    const zs: number[] = [];
    const visit = (n: GNode) => {
      const w = n.getWorldMatrix();
      for (const p of n.getMesh()?.listPrimitives() ?? []) {
        if ((p.getMaterial()!.getExtras() as { protoboard?: { layer?: string } }).protoboard?.layer !== "silkscreen") continue;
        const pos = p.getAttribute("POSITION")!;
        for (let i = 0; i < pos.getCount(); i++) {
          const e = pos.getElement(i, [0, 0, 0]);
          zs.push((w[2] * e[0] + w[6] * e[1] + w[10] * e[2] + w[14]) / MM);
        }
      }
      n.listChildren().forEach(visit);
    };
    view.getRoot().listScenes()[0].listChildren().forEach(visit);
    expect(zs.length).toBe(4);
    for (const z of zs) expect(Math.abs(z - (SRC.topSilk + 3 * LAYER_STEP_MM))).toBeLessThan(Q);
  });

  it("rewrites a board sidecar whose cache key predates the offsets, and serves the new one from cache", async () => {
    const again = await writeViewSidecar(src, { context: { owner: { definition: "test-board", partKind: "board" } } });
    expect(again.cached).toBe(true);
    // an index written before C1 has the key without the layer step: the next build rewrites it
    const paths = viewSidecarPaths(src);
    const old = JSON.parse(readFileSync(paths.index, "utf8")) as ViewSidecarIndex;
    writeFileSync(paths.index, JSON.stringify({ ...old, options: optionsKeyWithoutLayers({ definition: "test-board", partKind: "board" }) }));
    const rebuilt = await writeViewSidecar(src, { context: { owner: { definition: "test-board", partKind: "board" } } });
    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.index.options).toBe(old.options);
  });
});

/** Stable JSON with sorted keys, as sidecar.ts writes it. */
function stable(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value)) + "\n";
}

/** The cache key as it was before C1 (no layer options), for a context with only an owner. */
function optionsKeyWithoutLayers(owner: Record<string, unknown> | null): string {
  const key = { owner, components: [], features: [], bodies: [], meshOrigin: false, MESH_ORIGIN_ERROR, COARSE_ERROR, pipeline: VIEW_PIPELINE_VERSION };
  return "sha256:" + createHash("sha256").update(new TextEncoder().encode(stable(key))).digest("hex");
}

describe("a GLB without board layers (C1 leaves it alone)", () => {
  it("keeps the pre-C1 cache key, adds no layer note and moves nothing", async () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene();
    const m = doc.createMaterial("plastic").setBaseColorFactor([0.3, 0.3, 0.35, 1]);
    const root = doc.createNode("Enclosure").setRotation(Z_UP);
    scene.addChild(root);
    root.addChild(doc.createNode("Housing").setMesh(slab(doc, 0.06, 0.04, 0, 0.02, m)));
    // a lid 0.01 mm above the housing: coplanar-ish, but not a board layer, so it stays where it is
    root.addChild(doc.createNode("Lid").setMesh(slab(doc, 0.06, 0.04, 0.02001, 0.022, m)));
    const file = join(dir, "enclosure", "body.glb");
    mkdirSync(join(dir, "enclosure"), { recursive: true });
    writeFileSync(file, await new NodeIO().writeBinary(doc));
    const before = sha(readFileSync(file));
    const res = await writeViewSidecar(file, { context: { owner: { definition: "enclosure", partKind: "mechanical" } } });
    expect(sha(readFileSync(file))).toBe(before);
    expect(res.index.options).toBe(optionsKeyWithoutLayers({ definition: "enclosure", partKind: "mechanical" }));
    expect(res.index.layers).toBeUndefined();
    expect(res.index.design.layers).toBeUndefined();
    const h = await heights(viewSidecarPaths(file).fine);
    expect([...h.keys()]).toEqual(["plastic"]);
    expect(h.get("plastic")!.extras).toEqual({});
    const ys = h.get("plastic")!.ys;
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(22, 2);
    expect(ys.some((y) => Math.abs(y - 20.01) < 0.005)).toBe(true);
  });
});

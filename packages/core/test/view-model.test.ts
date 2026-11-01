/**
 * The view sidecar (PB-1173): round trip through glTF-Transform and three's
 * GLTFLoader, ids on every node, instancing, determinism, the face-range
 * table, quantization bounds, the coarse tier, the project step, and the
 * outputs check leaving sidecars alone.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO, type Node as GNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshFeatures, type Features } from "@gltf-transform/extensions";
import { join as joinTransform } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownedOutputs } from "../src/outputs.ts";
import { componentsOf, isViewSidecarFile, manifestNames, viewSidecarPaths, writeProjectViewSidecars, writeViewSidecar, type ViewContext, type ViewSidecarIndex } from "../src/view-model/index.ts";

// three's types are not installed in this package (view-model-three.d.ts): its objects are typed loosely here
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Three = any;

const dir = mkdtempSync(join(tmpdir(), "pb-view-model-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** OCCT's Z-up to Y-up root rotation (-90° about X). */
const Z_UP: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** A box as six faces (one primitive per face, as an OCCT export writes a B-rep), in metres. */
function boxFaces(doc: Document, size: [number, number, number], at: [number, number, number] = [0, 0, 0]) {
  const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const [sx, sy, sz] = size.map((s) => s / 2);
  const c = at;
  const quads: number[][][] = [
    [[-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]],
    [[-sx, sy, -sz], [sx, sy, -sz], [sx, -sy, -sz], [-sx, -sy, -sz]],
    [[sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz], [sx, -sy, sz]],
    [[-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz], [-sx, -sy, -sz]],
    [[-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz], [-sx, sy, -sz]],
    [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [-sx, -sy, sz]],
  ];
  return quads.map((q) => {
    const pos = new Float32Array(q.flatMap((p) => [p[0] + c[0], p[1] + c[1], p[2] + c[2]]));
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
    const v = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n);
    const nrm = new Float32Array([0, 1, 2, 3].flatMap(() => n.map((x) => x / l)));
    return doc
      .createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nrm).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2, 0, 2, 3])).setBuffer(buf));
  });
}

/**
 * A small board as an ECAD export writes it: a wrapper root, the board and a
 * silkscreen layer, two identical resistors (separate meshes, same
 * geometry), an IC and a test point the model does not know.
 */
async function boardGlb(file: string) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const green = doc.createMaterial("mask").setBaseColorFactor([0.05, 0.3, 0.1, 1]);
  const black = doc.createMaterial("body").setBaseColorFactor([0.02, 0.02, 0.02, 1]);
  const tin = doc.createMaterial("tin").setBaseColorFactor([0.8, 0.8, 0.8, 1]).setMetallicFactor(1);
  const root = doc.createNode("Model~X").setRotation(Z_UP);
  scene.addChild(root);
  const mesh = (name: string, prims: ReturnType<typeof boxFaces>, mat: (i: number) => ReturnType<Document["createMaterial"]> | null) => {
    const m = doc.createMesh(name);
    prims.forEach((p, i) => m.addPrimitive(p.setMaterial(mat(i))));
    return m;
  };
  root.addChild(doc.createNode("Board~X").setMesh(mesh("board", boxFaces(doc, [0.05, 0.03, 0.0016]), () => green)));
  root.addChild(doc.createNode("TopSilkscreen~X").setMesh(mesh("silk", boxFaces(doc, [0.01, 0.002, 0.0001], [0, 0, 0.0009]), () => null)));
  const resistor = (refdes: string, t: [number, number, number], r: [number, number, number, number]) => {
    const n = doc.createNode(`${refdes}~R0603~X`).setTranslation(t).setRotation(r);
    n.addChild(doc.createNode("R0603~X").setMesh(mesh("r0603", boxFaces(doc, [0.0016, 0.0008, 0.00045]), (i) => (i < 2 ? black : tin))));
    root.addChild(n);
  };
  resistor("R1", [0.01, 0.005, 0.0008], [0, 0, 0, 1]);
  resistor("R2", [-0.012, 0.004, 0.0008], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const ic = doc.createNode("U1~SOIC-8~X").setTranslation([0, -0.008, 0.0008]);
  ic.addChild(doc.createNode("SOIC~X").setMesh(mesh("soic", boxFaces(doc, [0.005, 0.004, 0.0015]), () => black)));
  root.addChild(ic);
  const tp = doc.createNode("TP1~Pad~X").setTranslation([0.02, -0.01, 0.0008]);
  tp.addChild(doc.createNode("Pad~X").setMesh(mesh("pad", boxFaces(doc, [0.001, 0.001, 0.00005]), () => tin)));
  root.addChild(tp);
  writeFileSync(file, await new NodeIO().writeBinary(doc));
  return doc;
}

const context = (): ViewContext => ({
  owner: { definition: "test-board", partKind: "board" },
  components: new Map([
    ["r1", { instancePath: "power/r1", definition: "uniroyal-0603waf", vendorKey: "lcsc:C25804", partKind: "resistor" }],
    ["r2", { instancePath: "power/r2", definition: "uniroyal-0603waf", vendorKey: "lcsc:C25804", partKind: "resistor" }],
    ["u1", { instancePath: "mcu/u1", definition: "ti-sn74hct244pwr", partKind: "ic" }],
  ]),
});

/** World-space bounds of every mesh vertex (instances expanded), metres, Y-up. */
function threeBounds(root: Three): Three {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.traverse((o: Three) => {
    const mesh = o as Three;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    const inst = (o as Three).isInstancedMesh ? (o as Three) : undefined;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      if (inst) inst.getMatrixAt(k, m);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (inst) v.applyMatrix4(m);
        box.expandByPoint(v.applyMatrix4(mesh.matrixWorld));
      }
    }
  });
  return box;
}

async function loadThree(file: string): Promise<Three> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder as never);
  const bytes = readFileSync(file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(ab, "");
  return gltf.scene;
}

describe("view sidecar for a board GLB", () => {
  const src = join(dir, "board", "body.glb");
  let index: ViewSidecarIndex;
  let first: { glb: Buffer; json: Buffer };

  beforeAll(async () => {
    mkdirSync(join(dir, "board"), { recursive: true });
    await boardGlb(src);
    index = (await writeViewSidecar(src, { context: context() })).index;
    const p = viewSidecarPaths(src);
    first = { glb: readFileSync(p.fine), json: readFileSync(p.index) };
  });

  it("writes X.view.glb and X.view.json beside X.glb and leaves X.glb alone", () => {
    const p = viewSidecarPaths(src);
    expect(p.fine.endsWith("body.view.glb")).toBe(true);
    expect(p.index.endsWith("body.view.json")).toBe(true);
    expect(index.schema).toBe("protoboard.view-sidecar/v0");
    expect(index.source.file).toBe("body.glb");
    expect(index.source.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(index.tiers.fine.file).toBe("body.view.glb");
    expect(["body.view.glb", "body.view.coarse.glb"]).toContain(index.tiers.coarse.file);
  });

  it("names every part: the owner, matched components by instance path, an unknown designator by refdes", () => {
    const ids = index.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([".", "mcu/u1", "power/r1", "power/r2", "refdes:TP1"]);
    const r1 = index.nodes.find((n) => n.id === "power/r1")!;
    expect(r1).toMatchObject({ instancePath: "power/r1", refdes: "R1", vendorKey: "lcsc:C25804", partKind: "resistor", definition: "uniroyal-0603waf" });
    const tp = index.nodes.find((n) => n.id === "refdes:TP1")!;
    expect(tp.instancePath).toBe("");
    expect(index.nodes.find((n) => n.id === ".")!.partKind).toBe("board");
  });

  it("instances the two identical resistors with EXT_mesh_gpu_instancing", async () => {
    expect(index.instancing).toEqual({ groups: 1, instances: 2, extension: "EXT_mesh_gpu_instancing" });
    const r1 = index.nodes.find((n) => n.id === "power/r1")!;
    const r2 = index.nodes.find((n) => n.id === "power/r2")!;
    expect(r1.node).toBe(r2.node);
    expect([r1.instance, r2.instance].sort()).toEqual([0, 1]);
    const json = JSON.parse(first.glb.toString("utf8", 20, 20 + first.glb.readUInt32LE(12)));
    expect(json.extensionsUsed).toEqual(expect.arrayContaining(["EXT_mesh_gpu_instancing", "EXT_mesh_features", "EXT_meshopt_compression", "KHR_mesh_quantization"]));
    expect(json.extensionsRequired).toEqual(expect.arrayContaining(["EXT_meshopt_compression", "KHR_mesh_quantization"]));
    expect(json.asset.generator).toMatch(/^@protoboardai\/core view-model/);
  });

  it("merges each part to one primitive per material and draws far less", () => {
    // before: board 6 + silk 6 + 2 x resistor 6 + ic 6 + test point 6 = 36 primitives, 36 draws
    expect(index.counts.before.draws).toBe(36);
    // after: owner (board + silk: 2 looks), resistors (instanced, 2 looks), ic (1), test point (1)
    expect(index.counts.after.draws).toBe(6);
    expect(index.counts.after.triangles).toBe(index.counts.before.triangles);
  });

  it("keeps a face-range table that covers every triangle once, in face order", () => {
    for (const n of index.nodes) {
      const covered = n.faces.map((prim) => {
        let next = 0;
        for (let i = 0; i < prim.length; i += 3) {
          expect(prim[i + 1]).toBe(next); // contiguous
          next += prim[i + 2];
          expect(prim[i]).toBeGreaterThanOrEqual(0);
          expect(prim[i]).toBeLessThan(n.featureCount);
        }
        return next;
      });
      expect(covered.reduce((a, b) => a + b, 0)).toBe(n.triangles.fine);
      const features = n.faces.flatMap((prim) => prim.filter((_, i) => i % 3 === 0));
      expect(new Set(features).size).toBe(n.featureCount);
    }
    expect(index.nodes.find((n) => n.id === ".")!.featureCount).toBe(12); // board 6 + silkscreen 6
  });

  it("is deterministic: a second export of the same input is byte-identical, and a third is served from cache", async () => {
    const again = await writeViewSidecar(src, { context: context(), force: true });
    expect(again.cached).toBe(false);
    const p = viewSidecarPaths(src);
    expect(readFileSync(p.fine).equals(first.glb)).toBe(true);
    expect(readFileSync(p.index).equals(first.json)).toBe(true);
    const third = await writeViewSidecar(src, { context: context() });
    expect(third.cached).toBe(true);
    // a changed context (another instance path) is a new sidecar
    const ctx = context();
    ctx.components!.set("u1", { instancePath: "mcu/u2" });
    expect((await writeViewSidecar(src, { context: ctx })).cached).toBe(false);
    await writeViewSidecar(src, { context: context() });
  });

  it("round-trips through glTF-Transform: EXT_mesh_features and the extras survive", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    await MeshoptDecoder.ready;
    const doc = await io.read(viewSidecarPaths(src).fine);
    const nodes = doc.getRoot().listNodes();
    for (const n of nodes) expect((n.getExtras() as { protoboard?: unknown }).protoboard).toBeDefined();
    const inst = nodes.find((n: GNode) => n.getExtension("EXT_mesh_gpu_instancing"))!;
    const pb = (inst.getExtras() as { protoboard: { instances: { partInstanceId: string }[] } }).protoboard;
    expect(pb.instances.map((i) => i.partInstanceId).sort()).toEqual(["power/r1", "power/r2"]);
    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) {
        const f = p.getExtension<Features>("EXT_mesh_features")!;
        expect(f).toBeTruthy();
        expect(f.listFeatureIDs()[0].getAttribute()).toBe(0);
        expect(p.getAttribute("_FEATURE_ID_0")).toBeTruthy();
      }
    }
  });

  it("round-trips through three's GLTFLoader: extras in userData, an InstancedMesh, _feature_id_0, bounds within quantization", async () => {
    const view = await loadThree(viewSidecarPaths(src).fine);
    const source = await loadThree(src);
    const meshes: Three[] = [];
    view.traverse((o: Three) => (o as Three).isMesh && meshes.push(o as Three));
    const inst = meshes.find((m: Three) => (m as Three).isInstancedMesh) as Three;
    expect(inst.count).toBe(2);
    // node extras land on the node's object: a mesh with two primitives becomes a Group of InstancedMeshes, so the ids
    // sit on the InstancedMesh's parent (a picker walks up to the first ancestor with userData.protoboard)
    const holder = inst.userData.protoboard ? inst : inst.parent;
    expect(holder.userData.protoboard.instances.map((i: { partInstanceId: string }) => i.partInstanceId).sort()).toEqual(["power/r1", "power/r2"]);
    const ids = new Set<string>();
    view.traverse((o: Three) => {
      if (o.userData.protoboard?.partInstanceId !== undefined) ids.add(o.userData.protoboard.partInstanceId);
    });
    expect([...ids].sort()).toEqual(["", "mcu/u1"]);
    for (const m of meshes) expect(m.geometry.getAttribute("_feature_id_0")).toBeTruthy();
    const a = threeBounds(view);
    const b = threeBounds(source);
    const size = b.getSize(new THREE.Vector3()).length();
    // 14-bit positions per mesh volume: error under extent / 2^14 per axis; allow 1e-3 of the scene diagonal
    expect(a.min.distanceTo(b.min)).toBeLessThan(size * 1e-3);
    expect(a.max.distanceTo(b.max)).toBeLessThan(size * 1e-3);
    // and every part's bounds in the index sit inside the scene (Y-up metres)
    for (const n of index.nodes) for (const k of [0, 1, 2] as const) expect(n.bounds.min[k]).toBeGreaterThanOrEqual([b.min.x, b.min.y, b.min.z][k] - size * 1e-3);
  });

  it("gives source primitives without a material a default look by part kind or node name", () => {
    const json = JSON.parse(first.glb.toString("utf8", 20, 20 + first.glb.readUInt32LE(12)));
    const names: string[] = json.materials.map((m: { name: string }) => m.name);
    expect(names).toContain("default silkscreen"); // the silkscreen layer had no material
    expect(names).toEqual(expect.arrayContaining(["mask", "body", "tin"])); // source colours kept
  });
});

/**
 * A body as ext-frame-cad writes it: OCCT's Z-up root, named bodies (plate,
 * pads, clamps) and feature compounds (a named node holding a named node
 * holding unnamed solids), two features with the same geometry, a feature
 * nested under an unnamed holder, a node with its own id, and a loose solid.
 */
async function frameGlb(file: string) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const root = doc.createNode("frame").setRotation(Z_UP);
  scene.addChild(root);
  const solid = (name: string, size: [number, number, number], at: [number, number, number] = [0, 0, 0]) => {
    const m = doc.createMesh(name);
    boxFaces(doc, size, at).forEach((p) => m.addPrimitive(p));
    return doc.createNode(name).setMesh(m);
  };
  root.addChild(solid("plate", [0.1, 0.1, 0.003]));
  root.addChild(solid("pads", [0.01, 0.01, 0.001], [0.02, 0.02, 0.002]));
  root.addChild(solid("clamps", [0.004, 0.02, 0.01], [-0.04, 0, 0.006]));
  const feature = (name: string, at: [number, number, number]) => {
    const outer = doc.createNode(name).setTranslation(at);
    const inner = doc.createNode(name);
    inner.addChild(solid("", [0.003, 0.003, 0.0005], [0.005, 0, 0]));
    inner.addChild(solid("", [0.003, 0.003, 0.0005], [-0.005, 0, 0]));
    outer.addChild(inner);
    return outer;
  };
  root.addChild(feature("stack_mount", [0.01, -0.02, 0.003]));
  root.addChild(feature("standoff_mount", [-0.02, 0.03, 0.003]));
  const holder = solid("holder", [0.006, 0.006, 0.006], [0.03, -0.03, 0.003]);
  holder.addChild(solid("deep_pad", [0.002, 0.002, 0.0005], [0.03, -0.03, 0.0065]));
  root.addChild(holder);
  root.addChild(solid("tagged", [0.002, 0.002, 0.002], [-0.03, -0.03, 0.003]).setExtras({ protoboard: { partInstanceId: "x/y" } }));
  root.addChild(solid("", [0.005, 0.005, 0.005], [0.04, 0.04, 0.003]));
  writeFileSync(file, await new NodeIO().writeBinary(doc));
}

describe("named nodes: manifest features and bodies, and nodes with their own id, stay nodes of their own", () => {
  const src = join(dir, "frame", "body.glb");
  const named = { features: ["deep_pad", "stack_mount", "standoff_mount"], bodies: ["clamps", "pads", "plate"] };
  let index: ViewSidecarIndex;

  beforeAll(async () => {
    mkdirSync(join(dir, "frame"), { recursive: true });
    await frameGlb(src);
    index = (await writeViewSidecar(src, { context: { owner: { definition: "quadcopter-5in-frame", partKind: "mechanical" }, ...named } })).index;
  });

  it("indexes each named node by role and name, the rest as the owner, under the source's root", () => {
    expect(index.root).toEqual({ node: 0, name: "frame" });
    expect(index.nodes.map((n) => n.id).sort()).toEqual([".", "body:clamps", "body:pads", "body:plate", "feature:deep_pad", "feature:stack_mount", "feature:standoff_mount", "node:tagged"]);
    const stack = index.nodes.find((n) => n.id === "feature:stack_mount")!;
    expect(stack).toMatchObject({ role: "feature", name: "stack_mount", instancePath: "", featureCount: 12 });
    expect(index.nodes.find((n) => n.id === "node:tagged")!.instancePath).toBe("x/y");
    expect(index.nodes.find((n) => n.id === "body:plate")!.role).toBe("body");
    // the holder's own solid and the loose solid are the owner's remainder: 12 faces
    expect(index.nodes.find((n) => n.id === ".")!.featureCount).toBe(12);
    for (const n of index.nodes) {
      const covered = n.faces.reduce((sum, prim) => sum + prim.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0), 0);
      expect(covered).toBe(n.triangles.fine);
    }
  });

  it("never GPU-instances a named node (two features with the same geometry keep their names), one draw per node and look", () => {
    expect(index.instancing.groups).toBe(0);
    expect(index.counts.after.draws).toBe(8);
    expect(index.counts.before.draws).toBe(66); // 11 solids of 6 faces
  });

  it("loads in three with every name the viewer looks up as a child of the root, in the source's place", async () => {
    const view = await loadThree(viewSidecarPaths(src).fine);
    const source = await loadThree(src);
    expect(view.children.length).toBe(1);
    const top = view.children[0];
    expect(top.name).toBe("frame");
    expect(top.userData.protoboard).toMatchObject({ partInstanceId: "", definition: "quadcopter-5in-frame" });
    const childNames = top.children.map((c: Three) => c.name);
    for (const n of [...named.features, ...named.bodies, "tagged"]) expect(childNames).toContain(n);
    let instanced = 0;
    view.traverse((o: Three) => o.isInstancedMesh && instanced++);
    expect(instanced).toBe(0);
    const sizeOf = (o: Three) => threeBounds(o);
    for (const n of [...named.features, ...named.bodies]) {
      const v = view.getObjectByName(n);
      expect(v.userData.protoboard).toMatchObject({ role: named.features.includes(n) ? "feature" : "body", name: n, partInstanceId: "" });
      const a = sizeOf(v);
      const b = sizeOf(source.getObjectByName(n));
      expect(a.min.distanceTo(b.min)).toBeLessThan(1e-4);
      expect(a.max.distanceTo(b.max)).toBeLessThan(1e-4);
    }
    // the merged remainder: the holder's own solid and the loose one
    const scene = threeBounds(view);
    const whole = threeBounds(source);
    expect(scene.min.distanceTo(whole.min)).toBeLessThan(1e-4);
    expect(scene.max.distanceTo(whole.max)).toBeLessThan(1e-4);
  });

  it("finds the names in the geometry manifest the bundle pairs with the GLB, as the viewer does", () => {
    const root = join(dir, "frame-project");
    mkdirSync(join(root, "out"), { recursive: true });
    writeFileSync(join(root, "out", "body.manifest.json"), JSON.stringify({ artifact: "body", units: "mm", features: { stack_mount: {}, deep_pad: {} }, bodies: { plate: 1, pads: 2 } }));
    writeFileSync(join(root, "out", "body.glb"), "x");
    const def = {
      id: "f",
      artifacts: [
        { id: "cad_glb", role: "body", format: "glb", filePath: "out/body.glb", provenance: { generatedFrom: "cad_step" } },
        { id: "cad_manifest", role: "source", format: "json", filePath: "out/body.manifest.json", provenance: { generatedFrom: "cad_step" } },
      ],
    };
    const names = manifestNames(root, { root: "f", definitions: [def] } as never, def as never, { abs: join(root, "out", "body.glb"), artifact: def.artifacts[0] });
    expect(names).toEqual({ features: ["deep_pad", "stack_mount"], bodies: ["pads", "plate"] });
  });
});

describe("what glTF-Transform join() does to ids (why the sidecar does not use it)", () => {
  it("keeps the first node's extras only and drops EXT_mesh_features, while the _FEATURE_ID_0 values survive", async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const scene = doc.createScene();
    const ext = doc.createExtension(EXTMeshFeatures);
    const mat = doc.createMaterial("m");
    for (const k of [0, 1]) {
      const p = doc
        .createPrimitive()
        .setMaterial(mat)
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, k, 1, 0, k, 0, 1, k])).setBuffer(buf))
        .setAttribute("_FEATURE_ID_0", doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([k, k, k])).setBuffer(buf))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2])).setBuffer(buf));
      p.setExtension("EXT_mesh_features", ext.createFeatures().addFeatureID(ext.createFeatureID().setFeatureCount(2).setAttribute(0)));
      scene.addChild(doc.createNode(`n${k}`).setMesh(doc.createMesh().addPrimitive(p)).setExtras({ protoboard: { partInstanceId: `p${k}` } }));
    }
    doc.setLogger({ debug() {}, info() {}, warn() {}, error() {} });
    await doc.transform(joinTransform({ keepNamed: false }));
    const nodes = doc.getRoot().listNodes();
    expect(nodes.map((n) => (n.getExtras() as { protoboard: { partInstanceId: string } }).protoboard.partInstanceId)).toEqual(["p0"]);
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.getExtension("EXT_mesh_features")).toBeNull();
    expect(Array.from(prim.getAttribute("_FEATURE_ID_0")!.getArray()!)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe("mesh-origin parts and the coarse tier", () => {
  it("simplifies a print-resolution mesh for display (decision 3) and writes a coarse tier, the source untouched", async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    // a gently curved 120 x 120 grid: one primitive, 28,800 triangles, as an STL-sourced GLB
    const n = 121;
    const pos = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pos.set([x / 1000, y / 1000, Math.sin(x / 40) * 0.002], (y * n + x) * 3);
    const idx: number[] = [];
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const a = y * n + x;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
    const prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buf));
    doc.createScene().addChild(doc.createNode("grill").setMesh(doc.createMesh().addPrimitive(prim)));
    const file = join(dir, "grill.glb");
    writeFileSync(file, await new NodeIO().writeBinary(doc));
    const before = readFileSync(file);
    const r = await writeViewSidecar(file, { context: { owner: { definition: "grill" } } });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(r.index.counts.before.triangles).toBe(28800);
    expect(r.index.tiers.fine.method).toBe("simplified");
    expect(r.index.tiers.fine.triangles).toBeLessThan(28800 / 2);
    expect(r.index.tiers.coarse.triangles).toBeLessThanOrEqual(r.index.tiers.fine.triangles);
    expect(r.index.nodes[0].triangles.fine).toBe(r.index.tiers.fine.triangles);
  });

  it("refuses a GLB that requires a glTF extension it does not know", async () => {
    const doc = new Document();
    doc.createScene();
    const bytes = Buffer.from(await new NodeIO().writeBinary(doc));
    const len = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + len));
    json.extensionsUsed = ["EXT_made_up"];
    json.extensionsRequired = ["EXT_made_up"];
    let text = JSON.stringify(json);
    while (text.length % 4) text += " ";
    const head = Buffer.alloc(20);
    head.write("glTF", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + text.length, 8);
    head.writeUInt32LE(text.length, 12);
    head.writeUInt32LE(0x4e4f534a, 16);
    const file = join(dir, "unknown.glb");
    writeFileSync(file, Buffer.concat([head, Buffer.from(text)]));
    await expect(writeViewSidecar(file)).rejects.toThrow(/EXT_made_up/);
  });
});

describe("the project step", () => {
  it("writes a sidecar per body GLB the bundle references, multiplies by placements, and skips paths outside the artifact base", async () => {
    const root = join(dir, "project");
    mkdirSync(join(root, "parts", "local", "res", "out"), { recursive: true });
    mkdirSync(join(root, ".protoboard", "build"), { recursive: true });
    await boardGlb(join(root, "parts", "local", "res", "out", "body.glb"));
    writeFileSync(join(dir, "outside.glb"), readFileSync(join(root, "parts", "local", "res", "out", "body.glb")));
    const bundle = {
      schema: "uhd.bundle/v0",
      root: "top",
      artifactBases: { res: root, top: root },
      definitions: [
        { id: "top", children: [{ id: "a", moduleDefId: "res" }, { id: "b", moduleDefId: "res" }] },
        {
          id: "res",
          tags: ["pcb"],
          artifacts: [
            { id: "cad_glb", role: "body", format: "glb", filePath: "parts/local/res/out/body.glb" },
            { id: "escape", role: "body", format: "glb", filePath: "../outside.glb" },
            { id: "if", role: "interface", format: "glb", filePath: "parts/local/res/out/body.glb" },
          ],
        },
      ],
    };
    writeFileSync(join(root, ".protoboard", "build", "uhd-bundle.json"), JSON.stringify(bundle));
    const lines: string[] = [];
    const s = await writeProjectViewSidecars(root, { log: (l) => lines.push(l) });
    expect(s.files.map((f) => f.file)).toEqual(["parts/local/res/out/body.glb"]);
    expect(s.files[0].placements).toBe(2);
    expect(s.totals.before.draws).toBe(2 * 36);
    // the bundle names no components of this definition, so the file is one part: one draw per look (mask, body, tin, silkscreen)
    expect(s.totals.after.draws).toBe(2 * 4);
    expect(s.line).toMatch(/draws 72 → 8/);
    expect(lines.at(-1)).toBe(s.line);
    const again = await writeProjectViewSidecars(root);
    expect(again.cached).toBe(1);
  });

  it("maps designators to instance paths through ids and through instance names", () => {
    const defs = new Map([
      ["board", { id: "board", children: [{ id: "power", moduleDefId: "sec" }] }],
      ["sec", { id: "sec", children: [{ id: "n12v_dcj", moduleDefId: "jack", name: "12V_DCJ DC barrel jack" }, { id: "r1", moduleDefId: "res", name: "R1 10 k" }] }],
      ["jack", { id: "jack", tags: ["connector"], artifacts: [{ name: "LCSC product page C319200", url: "https://www.lcsc.com/product-detail/x_C319200.html" }] }],
      ["res", { id: "res", manufacturer: "UNI-ROYAL", part_number: "0603WAF1002T5E" }],
    ]);
    const c = componentsOf(defs.get("board")!, defs as never);
    expect(c.get("12v_dcj")).toMatchObject({ instancePath: "power/n12v_dcj", vendorKey: "lcsc:C319200", partKind: "connector" });
    expect(c.get("r1")).toMatchObject({ instancePath: "power/r1", vendorKey: "mpn:UNI-ROYAL 0603WAF1002T5E" });
    expect(c.get("power/r1")?.instancePath).toBe("power/r1");
  });
});

describe("outputs and sidecars", () => {
  it("knows sidecar names, and a capability's owned outputs leave them out (they are the build's, not the export's)", () => {
    expect(isViewSidecarFile("body.view.glb")).toBe(true);
    expect(isViewSidecarFile("body.view.coarse.glb")).toBe(true);
    expect(isViewSidecarFile("body.view.json")).toBe(true);
    expect(isViewSidecarFile("body.glb")).toBe(false);
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    for (const f of ["body.glb", "body.step", "body.view.glb", "body.view.json", "body.view.coarse.glb"]) writeFileSync(join(out, f), "x");
    expect(ownedOutputs(out, "cad", [])).toEqual(["body.glb", "body.step"]);
  });
});

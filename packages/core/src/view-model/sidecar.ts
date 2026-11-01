/**
 * The view sidecar writer (PB-1173; README §4, §6, §9, §10): for one body
 * `X.glb`, write `X.view.glb` (fine tier), `X.view.coarse.glb` (coarse tier)
 * and `X.view.json` (scene index) beside it. `X.glb` is read, never written.
 *
 * Per GLB:
 *  1. read (unknown required glTF extensions are an error; files over
 *     MAX_GLB_BYTES are refused);
 *  2. split the scene into parts: the GLB's owner, plus one part per
 *     component node when the build names components (a board's reference
 *     designators mapped to UHD instance paths);
 *  3. per part, merge every primitive into one primitive per material,
 *     welding and vertex-cache reordering each source face on its own, and
 *     record the face-range table plus a `_FEATURE_ID_0` vertex attribute
 *     (EXT_mesh_features) carrying the source face index;
 *  4. parts with the same geometry share one mesh; a group of two or more is
 *     one node with EXT_mesh_gpu_instancing (identical passives);
 *  5. ids on every node (`extras.protoboard.partInstanceId`, vendorKey,
 *     partKind, placeholder; per instance for instanced nodes);
 *  6. keep source colours; a default material per part kind (or sub-node
 *     name) where the source has none;
 *  7. quantize (KHR_mesh_quantization) and compress (EXT_meshopt_compression);
 *  8. the coarse tier from `X.coarse.glb` when an exporter wrote one (kernel
 *     re-tessellation), else by meshoptimizer simplification;
 *  9. deterministic: fixed node order, no timestamps, fixed generator.
 *
 * Triangle order: the global vertex-cache reorder of glTF-Transform's
 * `reorder()` would interleave faces and break the face-range table, so
 * reordering runs per face (meshopt `reorderMesh`) instead (DEFAULT).
 *
 * Units: glTF metres, Y-up, as the source GLB; nothing is converted here.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Document, Material, Node as GNode, Primitive } from "@gltf-transform/core";
import {
  decompose,
  geometryHash,
  groupBounds,
  invert,
  isIdentity,
  mergeFaces,
  multiply,
  placeFace,
  simplifyGroup,
  transformPoint,
  triangles,
  weldAndReorder,
  IDENTITY,
  type Encoder,
  type Face,
  type Group,
  type Mat4,
  type Simplifier,
} from "./geometry.js";
import { lookForKind, lookForName, type MaterialLook } from "./materials.js";
import { VIEW_PIPELINE_VERSION, VIEW_SIDECAR_SCHEMA, viewSidecarPaths } from "./names.js";
import type { ViewBounds, ViewComponent, ViewContext, ViewCounts, ViewNode, ViewSidecarIndex, ViewTier } from "./types.js";

/** Largest GLB the writer parses (security basics: size caps on parsed files). */
export const MAX_GLB_BYTES = 512 * 1024 * 1024;

/** Simplification error targets, as a fraction of a part's extent (README §6: balanced 0.1 %, fast 0.5 %). */
export const MESH_ORIGIN_ERROR = 0.001;
export const COARSE_ERROR = 0.005;

/** A part whose source is a mesh (an STL turned GLB): few primitives, many triangles. */
const MESH_ORIGIN_MIN_TRIANGLES = 20000;
const MESH_ORIGIN_MAX_PRIMITIVES = 4;

const GENERATOR = `@protoboardai/core view-model v${VIEW_PIPELINE_VERSION}`;

export interface ViewSidecarOptions {
  context?: ViewContext;
  /** Rewrite even when the cached sidecar matches its source. */
  force?: boolean;
  log?: (line: string) => void;
}

export interface ViewSidecarResult {
  source: string;
  cached: boolean;
  index: ViewSidecarIndex;
  paths: ReturnType<typeof viewSidecarPaths>;
}

const sha = (b: Uint8Array) => "sha256:" + createHash("sha256").update(b).digest("hex");

/** Stable JSON: keys sorted, so two runs write the same bytes. */
function stable(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object" && !(v instanceof Map)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value)) + "\n"; // compact: an indented face-range table is ten times larger
}

const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** Write a file through a temporary name, so a reader never sees half of it. */
function writeAtomic(file: string, bytes: Uint8Array | string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Lazy dependencies: glTF-Transform functions loads sharp at import (handoffs.md, 2026-11-01), so nothing
// here is imported at module load; only the export step pays for it.
// ---------------------------------------------------------------------------

interface Deps {
  core: typeof import("@gltf-transform/core");
  ext: typeof import("@gltf-transform/extensions");
  fn: typeof import("@gltf-transform/functions");
  encoder: typeof import("meshoptimizer").MeshoptEncoder;
  simplifier: typeof import("meshoptimizer").MeshoptSimplifier;
  decoder: typeof import("meshoptimizer").MeshoptDecoder;
}

let deps: Promise<Deps> | undefined;
function loadDeps(): Promise<Deps> {
  deps ??= (async () => {
    const [core, ext, fn, mo] = await Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions"), import("@gltf-transform/functions"), import("meshoptimizer")]);
    await Promise.all([mo.MeshoptEncoder.ready, mo.MeshoptSimplifier.ready, mo.MeshoptDecoder.ready]);
    return { core, ext, fn, encoder: mo.MeshoptEncoder, simplifier: mo.MeshoptSimplifier, decoder: mo.MeshoptDecoder };
  })();
  return deps;
}

function newIO(d: Deps) {
  return new d.core.NodeIO().registerExtensions(d.ext.ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": d.encoder, "meshopt.decoder": d.decoder });
}

// ---------------------------------------------------------------------------
// Counting a document as the viewer draws it
// ---------------------------------------------------------------------------

function countDocument(doc: Document): ViewCounts {
  let draws = 0;
  let tris = 0;
  let nodes = 0;
  let primitives = 0;
  const seen = new Set<Primitive>();
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((n) => {
      nodes++;
      const mesh = n.getMesh();
      if (!mesh) return;
      const batch = n.getExtension("EXT_mesh_gpu_instancing") as { getAttribute(s: string): { getCount(): number } | null; listAttributes?: () => { getCount(): number }[] } | null;
      const copies = batch ? (batch.getAttribute("TRANSLATION") ?? batch.getAttribute("ROTATION") ?? batch.getAttribute("SCALE"))?.getCount() ?? 1 : 1;
      for (const p of mesh.listPrimitives()) {
        draws++;
        seen.add(p);
        const idx = p.getIndices();
        const n3 = idx ? idx.getCount() : (p.getAttribute("POSITION")?.getCount() ?? 0);
        if (p.getMode() === 4) tris += (n3 / 3) * copies;
      }
    });
  }
  primitives = seen.size;
  return { draws, triangles: Math.round(tris), nodes, materials: doc.getRoot().listMaterials().length, primitives };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

interface Member {
  node: GNode;
  /** The node's whole subtree (true), or only its own mesh (false: some descendant is a part of its own). */
  deep: boolean;
}

interface PartSpec {
  /** Root node of the part in the source (undefined: the owner's merged remainder). */
  root?: GNode;
  /** Nodes whose geometry belongs to the part. */
  members: Member[];
  /** World matrix of the part frame. */
  world: Mat4;
  id: string;
  instancePath: string;
  refdes?: string;
  name?: string;
  component?: ViewComponent;
  owner: boolean;
  /** "feature" and "body" for nodes the GLB's geometry manifest names, "node" for one with its own extras.protoboard id. */
  role?: "feature" | "body" | "node";
  /** May become one GPU instance of several (components only: a named node keeps its own node and name). */
  instanceable: boolean;
  extras: Record<string, unknown>;
}

/** The source's top wrapper (OCCT's Z-up-to-Y-up root, an ECAD model node): kept as the sidecar's root so names line up. */
interface Wrapper {
  name: string;
  world: Mat4;
  extras: Record<string, unknown>;
}

/** Layer and body nodes of an ECAD board export (EasyEDA, KiCad): they belong to the board itself. */
const BOARD_LAYER = /^(board|pcb|(top|bottom|inner\d*)[a-z]*|.*(copper|silk|mask|paste|stiffener|outline|substrate|edge)[a-z]*)$/i;

/** The reference designator a component node's name starts with ("R34~R2512~..." → "R34"). */
const refdesOf = (name: string) => name.split("~")[0].trim();

function lookup(components: Map<string, ViewComponent> | undefined, name: string): ViewComponent | undefined {
  if (!components || !name) return undefined;
  const n = name.toLowerCase();
  return components.get(n) ?? components.get(refdesOf(n)) ?? components.get(refdesOf(n).replace(/[^a-z0-9_]+/g, "_"));
}

function ownExtras(n: GNode | undefined): Record<string, unknown> {
  const e = n?.getExtras() as Record<string, unknown> | undefined;
  const pb = e && typeof e.protoboard === "object" && e.protoboard ? (e.protoboard as Record<string, unknown>) : {};
  return { ...pb };
}

function hasOwnId(n: GNode): boolean {
  return typeof ownExtras(n).partInstanceId === "string";
}

/**
 * The parts of a scene. Single nodes without a mesh at the top (OCCT's
 * Z-up-to-Y-up root, an ECAD model wrapper) are descended through and kept
 * as the sidecar's root, so the viewer finds the same children by name.
 * Under it:
 *  - components: when the context names components and at least one child
 *    matches by designator or instance path, every child that looks like a
 *    component is its own part (matched or not), and may be GPU-instanced;
 *  - named nodes: every node the GLB's geometry manifest names (its
 *    `features`: interface pads; its `bodies`: named bodies that explode
 *    apart) and every node with its own `extras.protoboard.partInstanceId`
 *    stays its own node with its own name, at any depth (its subtree merged
 *    per material beneath it); never GPU-instanced, so the name survives;
 *  - everything else (board layers, unnamed solids) is merged into one node
 *    for the owner.
 */
function segment(doc: Document, ctx: ViewContext): { wrapper?: Wrapper; parts: PartSpec[] } {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return { parts: [] };
  let level = scene.listChildren();
  let wrapperNode: GNode | undefined;
  while (level.length === 1 && !level[0].getMesh() && level[0].listChildren().length > 0) {
    wrapperNode = level[0];
    level = level[0].listChildren();
  }
  const world: Mat4 = wrapperNode ? (wrapperNode.getWorldMatrix() as unknown as Mat4) : IDENTITY;
  const ownerExtras = wrapperNode ? ownExtras(wrapperNode) : level.length === 1 ? ownExtras(level[0]) : {};
  const wrapper: Wrapper | undefined = wrapperNode ? { name: wrapperNode.getName(), world, extras: ownerExtras } : undefined;
  const comps = ctx.components;
  const componentMode = !!comps?.size && level.length >= 2 && level.some((n) => lookup(comps, n.getName()));
  const features = new Set(ctx.features ?? []);
  const bodies = new Set(ctx.bodies ?? []);
  const keepable = (n: GNode) => (!!n.getName() && (features.has(n.getName()) || bodies.has(n.getName()))) || hasOwnId(n);
  const keepBelow = new Map<GNode, boolean>();
  const anyKeepable = (n: GNode): boolean => {
    let v = keepBelow.get(n);
    if (v === undefined) {
      v = n.listChildren().some((c) => keepable(c) || anyKeepable(c));
      keepBelow.set(n, v);
    }
    return v;
  };
  const rest: Member[] = [];
  const parts: PartSpec[] = [];
  const split = (n: GNode) => {
    if (keepable(n)) {
      const name = n.getName();
      const own = ownExtras(n);
      parts.push({
        root: n,
        members: [{ node: n, deep: true }],
        world: n.getWorldMatrix() as unknown as Mat4,
        id: features.has(name) ? `feature:${name}` : bodies.has(name) ? `body:${name}` : `node:${name || "unnamed"}`,
        instancePath: typeof own.partInstanceId === "string" ? own.partInstanceId : "",
        name,
        owner: true,
        role: features.has(name) ? "feature" : bodies.has(name) ? "body" : "node",
        instanceable: false,
        extras: own,
      });
    } else if (anyKeepable(n)) {
      rest.push({ node: n, deep: false });
      n.listChildren().forEach(split);
    } else rest.push({ node: n, deep: true });
  };
  for (const n of level) {
    const name = n.getName();
    const comp = componentMode ? lookup(comps, name) : undefined;
    const looksLikeComponent = componentMode && (!!comp || (!!name && !BOARD_LAYER.test(refdesOf(name)) && (n.listChildren().length > 0 || !!n.getMesh()) && name.includes("~")));
    if (!looksLikeComponent) {
      split(n);
      continue;
    }
    const refdes = refdesOf(name);
    parts.push({
      root: n,
      members: [{ node: n, deep: true }],
      world: n.getWorldMatrix() as unknown as Mat4,
      id: comp ? comp.instancePath : `refdes:${refdes}`,
      instancePath: comp ? comp.instancePath : "",
      refdes,
      name,
      component: comp,
      owner: false,
      instanceable: true,
      extras: ownExtras(n),
    });
  }
  const owner: PartSpec = { members: rest, world, id: ".", instancePath: "", owner: true, instanceable: false, extras: ownerExtras };
  return { wrapper, parts: [...(rest.length ? [owner] : []), ...parts] };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface Look {
  key: string;
  name: string;
  color: number[];
  metallic: number;
  roughness: number;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number;
  doubleSided: boolean;
  emissive: number[];
}

function lookOf(m: Material | null, fallback: MaterialLook): Look {
  if (!m) {
    const l = { name: fallback.name, color: fallback.color.slice(), metallic: fallback.metallic, roughness: fallback.roughness, alphaMode: "OPAQUE" as const, alphaCutoff: 0.5, doubleSided: true, emissive: [0, 0, 0] };
    return { ...l, key: lookKey(l) };
  }
  const l = {
    name: m.getName() || "material",
    color: m.getBaseColorFactor().map((v) => round(v, 5)),
    metallic: round(m.getMetallicFactor(), 4),
    roughness: round(m.getRoughnessFactor(), 4),
    alphaMode: m.getAlphaMode() as Look["alphaMode"],
    alphaCutoff: round(m.getAlphaCutoff(), 4),
    doubleSided: m.getDoubleSided(),
    emissive: m.getEmissiveFactor().map((v) => round(v, 5)),
  };
  return { ...l, key: lookKey(l) };
}

const lookKey = (l: Omit<Look, "key" | "name">) => JSON.stringify([l.color, l.metallic, l.roughness, l.alphaMode, l.alphaMode === "MASK" ? l.alphaCutoff : 0, l.doubleSided, l.emissive]);

// ---------------------------------------------------------------------------
// Reading a part's faces
// ---------------------------------------------------------------------------

function floats(acc: import("@gltf-transform/core").Accessor): Float32Array {
  const arr = acc.getArray();
  if (arr instanceof Float32Array && !acc.getNormalized() && acc.getElementSize() === 3) return arr.slice();
  const n = acc.getCount();
  const size = acc.getElementSize();
  const out = new Float32Array(n * 3);
  const el: number[] = new Array(size).fill(0);
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    out[i * 3] = el[0];
    out[i * 3 + 1] = el[1] ?? 0;
    out[i * 3 + 2] = el[2] ?? 0;
  }
  return out;
}

interface PartGeometry {
  spec: PartSpec;
  faces: Face[];
  sourcePrimitives: number;
  warnings: string[];
}

/** Every triangle primitive under the part's members, moved into the part frame, with its look. */
function readPart(spec: PartSpec, looks: Map<string, Look>, ctx: ViewContext): PartGeometry {
  const inv = invert(spec.world);
  const faces: Face[] = [];
  const warnings: string[] = [];
  let feature = 0;
  const kind = spec.component?.partKind ?? ctx.owner?.partKind;
  const placeholder = !!(spec.component?.placeholder ?? (spec.owner ? ctx.owner?.placeholder : undefined)) || spec.extras.placeholder === true;
  const visit = (n: GNode, inherited: MaterialLook | undefined) => {
    const named = lookForName(n.getName()) ?? inherited;
    const mesh = n.getMesh();
    if (mesh) {
      const batch = n.getExtension("EXT_mesh_gpu_instancing") as { getAttribute(s: string): import("@gltf-transform/core").Accessor | null } | null;
      const nodeWorld = n.getWorldMatrix() as unknown as Mat4;
      const copies: Mat4[] = [];
      if (batch) {
        const t = batch.getAttribute("TRANSLATION"), r = batch.getAttribute("ROTATION"), s = batch.getAttribute("SCALE");
        const count = (t ?? r ?? s)?.getCount() ?? 1;
        for (let i = 0; i < count; i++) {
          const tv = t ? t.getElement(i, [0, 0, 0]) : [0, 0, 0];
          const rv = r ? r.getElement(i, [0, 0, 0, 1]) : [0, 0, 0, 1];
          const sv = s ? s.getElement(i, [1, 1, 1]) : [1, 1, 1];
          copies.push(multiply(nodeWorld, compose(tv, rv, sv)));
        }
      } else copies.push(nodeWorld);
      for (const w of copies) {
        const rel = multiply(inv, w);
        for (const p of mesh.listPrimitives()) {
          const pos = p.getAttribute("POSITION");
          if (!pos) continue;
          if (p.getMode() !== 4) {
            warnings.push(`${n.getName() || "node"}: primitive mode ${p.getMode()} is not triangles; left out of the view sidecar`);
            continue;
          }
          const fallback = named ?? lookForKind(kind, placeholder);
          const look = lookOf(p.getMaterial(), fallback);
          if (!looks.has(look.key)) looks.set(look.key, look);
          const nrm = p.getAttribute("NORMAL");
          const idx = p.getIndices();
          const positions = floats(pos);
          const indices = idx ? Uint32Array.from(idx.getArray() as ArrayLike<number>) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
          faces.push(placeFace({ feature: feature++, material: look.key, positions, normals: nrm ? floats(nrm) : null, indices }, rel));
        }
      }
    }
    if (deep.get(n) !== false) for (const c of n.listChildren()) visit(c, named);
  };
  // a member's subtree, or only its own mesh when some descendant is a part of its own
  const deep = new Map(spec.members.map((m) => [m.node, m.deep]));
  /** The look a node inherits from its nearest named ancestor ("pads" → its unnamed solids). */
  const inheritedLook = (n: GNode): MaterialLook | undefined => {
    for (let p = n.getParentNode(); p; p = p.getParentNode()) {
      const l = lookForName(p.getName());
      if (l) return l;
    }
    return undefined;
  };
  for (const m of spec.members) visit(m.node, inheritedLook(m.node));
  return { spec, faces, sourcePrimitives: feature, warnings };
}

function compose(t: number[], r: number[], s: number[]): Mat4 {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

// ---------------------------------------------------------------------------
// Building a tier
// ---------------------------------------------------------------------------

interface BuiltPart {
  spec: PartSpec;
  fine: Group[];
  coarse: Group[];
  hash: string;
  featureCount: number;
  meshOrigin: boolean;
}

interface Placement {
  parts: BuiltPart[];
  /** Instanced (EXT_mesh_gpu_instancing) when two or more and every world matrix is TRS. */
  instanced: boolean;
}

function boundsOf(groups: Group[], world: Mat4): ViewBounds {
  const b = groupBounds(groups);
  if (!b) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
    const p = transformPoint(world, x, y, z);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min: min.map((v) => round(v)) as ViewBounds["min"], max: max.map((v) => round(v)) as ViewBounds["max"] };
}

function protoboardExtras(spec: PartSpec, ctx: ViewContext): Record<string, unknown> {
  const c = spec.component;
  const o = spec.owner ? ctx.owner : undefined;
  const e: Record<string, unknown> = { ...spec.extras, partInstanceId: spec.instancePath };
  if (spec.refdes) e.refdes = spec.refdes;
  const def = c?.definition ?? o?.definition;
  if (def) e.definition = def;
  const vk = c?.vendorKey ?? o?.vendorKey;
  if (vk) e.vendorKey = vk;
  const kind = c?.partKind ?? o?.partKind;
  if (kind) e.partKind = kind;
  if (c?.placeholder || o?.placeholder || spec.extras.placeholder === true) e.placeholder = true;
  if (!spec.owner && !c) e.unmatched = true;
  return e;
}

/**
 * One tier as a glTF-Transform document. Node order: the source's wrapper
 * (when it had one) as the root, then the placements in part order (the
 * owner's merged remainder, then named nodes and components in source
 * order); instanced groups at their first member's place.
 */
function buildDocument(d: Deps, placements: Placement[], looks: Map<string, Look>, ctx: ViewContext, tier: "fine" | "coarse", wrapper: Wrapper | undefined): { doc: Document; nodeOf: Map<BuiltPart, { node: number; instance?: number }> } {
  const doc = new d.core.Document();
  doc.setLogger(new d.core.Logger(d.core.Logger.Verbosity.ERROR));
  doc.getRoot().getAsset().generator = GENERATOR;
  const buffer = doc.createBuffer();
  const scene = doc.createScene("view");
  doc.getRoot().setDefaultScene(scene);
  const features = doc.createExtension(d.ext.EXTMeshFeatures);
  const instancing = doc.createExtension(d.ext.EXTMeshGPUInstancing).setRequired(true);
  const materials = new Map<string, Material>();
  const material = (key: string) => {
    let m = materials.get(key);
    if (!m) {
      const l = looks.get(key)!;
      m = doc
        .createMaterial(l.name)
        .setBaseColorFactor(l.color as [number, number, number, number])
        .setMetallicFactor(l.metallic)
        .setRoughnessFactor(l.roughness)
        .setAlphaMode(l.alphaMode)
        .setAlphaCutoff(l.alphaCutoff)
        .setDoubleSided(l.doubleSided)
        .setEmissiveFactor(l.emissive as [number, number, number]);
      materials.set(key, m);
    }
    return m;
  };
  const meshes = new Map<string, import("@gltf-transform/core").Mesh>();
  const meshFor = (p: BuiltPart) => {
    const key = `${p.hash}`;
    let mesh = meshes.get(key);
    if (mesh) return mesh;
    mesh = doc.createMesh(p.spec.component?.definition ?? p.spec.refdes ?? p.spec.name ?? "part");
    const groups = tier === "fine" ? p.fine : p.coarse;
    for (const g of groups) {
      const acc = (type: "VEC3" | "SCALAR", array: Float32Array | Uint32Array | Uint16Array) => doc.createAccessor().setType(type).setArray(array as import("@gltf-transform/core").TypedArray).setBuffer(buffer);
      const fcount = p.featureCount;
      const fid = fcount <= 65535 ? Uint16Array.from(g.features) : g.features;
      const prim = doc
        .createPrimitive()
        .setAttribute("POSITION", acc("VEC3", g.positions))
        .setAttribute("NORMAL", acc("VEC3", g.normals))
        .setAttribute("_FEATURE_ID_0", acc("SCALAR", fid))
        .setIndices(acc("SCALAR", g.indices))
        .setMaterial(material(g.material));
      const id = features.createFeatureID().setFeatureCount(fcount).setAttribute(0).setLabel("face");
      prim.setExtension("EXT_mesh_features", features.createFeatures().addFeatureID(id));
      mesh.addPrimitive(prim);
    }
    meshes.set(key, mesh);
    return mesh;
  };
  const nodeOf = new Map<BuiltPart, { node: number; instance?: number }>();
  let index = 0;
  const setTransform = (node: GNode, m: Mat4) => {
    if (isIdentity(m)) return;
    const trs = decompose(m);
    if (trs) node.setTranslation(trs.t).setRotation(trs.r).setScale(trs.s);
    else node.setMatrix(m as unknown as import("@gltf-transform/core").mat4);
  };
  // the source's wrapper stays the root, so its children keep the names the viewer looks up (manifest features and
  // bodies, components); every part's transform is relative to it
  let parent: { addChild(n: GNode): unknown } = scene;
  let toLocal: Mat4 = IDENTITY;
  if (wrapper) {
    const root = doc.createNode(wrapper.name);
    setTransform(root, wrapper.world);
    const o = ctx.owner;
    root.setExtras({ protoboard: { ...wrapper.extras, partInstanceId: "", ...(o?.definition ? { definition: o.definition } : {}), ...(o?.vendorKey ? { vendorKey: o.vendorKey } : {}), ...(o?.partKind ? { partKind: o.partKind } : {}), ...(o?.placeholder ? { placeholder: true } : {}) } });
    scene.addChild(root);
    index++;
    parent = root;
    toLocal = invert(wrapper.world);
  }
  for (const pl of placements) {
    const first = pl.parts[0];
    if (pl.instanced) {
      const trs = pl.parts.map((p) => decompose(multiply(toLocal, p.spec.world))!);
      const node = doc.createNode(first.spec.component?.definition ?? first.spec.refdes ?? "instances").setMesh(meshFor(first));
      const flat = (k: "t" | "r" | "s", n: number) => Float32Array.from(trs.flatMap((x) => x[k].slice(0, n)));
      const batch = instancing
        .createInstancedMesh()
        .setAttribute("TRANSLATION", doc.createAccessor().setType("VEC3").setArray(flat("t", 3)).setBuffer(buffer))
        .setAttribute("ROTATION", doc.createAccessor().setType("VEC4").setArray(flat("r", 4)).setBuffer(buffer))
        .setAttribute("SCALE", doc.createAccessor().setType("VEC3").setArray(flat("s", 3)).setBuffer(buffer));
      node.setExtension("EXT_mesh_gpu_instancing", batch);
      const each = pl.parts.map((p) => protoboardExtras(p.spec, ctx));
      const common: Record<string, unknown> = {};
      for (const k of ["definition", "vendorKey", "partKind", "placeholder"]) if (each.every((e) => e[k] !== undefined && e[k] === each[0][k])) common[k] = each[0][k];
      node.setExtras({ protoboard: { ...common, instanced: true, instances: each } });
      parent.addChild(node);
      pl.parts.forEach((p, i) => nodeOf.set(p, { node: index, instance: i }));
      index++;
      continue;
    }
    for (const p of pl.parts) {
      // the owner's merged remainder is unnamed under a wrapper (the wrapper carries the owner's name and ids)
      const name = p.spec.name ?? p.spec.component?.instancePath ?? (p.spec.owner ? (wrapper ? "" : (ctx.owner?.definition ?? "body")) : "part");
      const node = doc.createNode(name).setMesh(meshFor(p));
      setTransform(node, multiply(toLocal, p.spec.world));
      node.setExtras({ protoboard: { ...protoboardExtras(p.spec, ctx), ...(p.spec.role ? { role: p.spec.role, name: p.spec.name } : {}) } });
      parent.addChild(node);
      nodeOf.set(p, { node: index });
      index++;
    }
  }
  if (!instancing.listProperties().length) instancing.dispose();
  return { doc, nodeOf };
}

async function compress(d: Deps, doc: Document): Promise<void> {
  // positions and texture coordinates quantized (KHR_mesh_quantization); normals and _FEATURE_ID_0 kept as they are
  // (feature ids must stay exact integers), then everything meshopt-encoded with filters
  await doc.transform(
    d.fn.quantize({ pattern: /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/, quantizePosition: 14, quantizationVolume: "mesh", cleanup: true }),
  );
  doc.createExtension(d.ext.EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: d.ext.EXTMeshoptCompression.EncoderMethod.FILTER });
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

function optionsHash(ctx: ViewContext): string {
  const comps = ctx.components ? [...ctx.components.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return sha(new TextEncoder().encode(stable({ owner: ctx.owner ?? null, components: comps, features: [...(ctx.features ?? [])].sort(), bodies: [...(ctx.bodies ?? [])].sort(), meshOrigin: !!ctx.meshOrigin, MESH_ORIGIN_ERROR, COARSE_ERROR, pipeline: VIEW_PIPELINE_VERSION })));
}

function cached(paths: ReturnType<typeof viewSidecarPaths>, sourceSha: string, coarseSha: string | undefined, options: string): ViewSidecarIndex | undefined {
  if (!existsSync(paths.index) || !existsSync(paths.fine)) return undefined;
  try {
    const idx = JSON.parse(readFileSync(paths.index, "utf8")) as ViewSidecarIndex;
    if (idx.schema !== VIEW_SIDECAR_SCHEMA || idx.pipeline !== VIEW_PIPELINE_VERSION || idx.options !== options) return undefined;
    if (idx.source.sha256 !== sourceSha || (idx.source.coarse?.sha256 ?? undefined) !== coarseSha) return undefined;
    if (sha(readFileSync(paths.fine)) !== idx.tiers.fine.sha256) return undefined;
    if (idx.tiers.coarse.file !== idx.tiers.fine.file && (!existsSync(paths.coarse) || sha(readFileSync(paths.coarse)) !== idx.tiers.coarse.sha256)) return undefined;
    return idx;
  } catch {
    return undefined;
  }
}

/** Read and check a GLB: size cap, then glTF-Transform (which throws on an unknown required extension). */
async function readGlb(d: Deps, file: string): Promise<{ bytes: Uint8Array; doc: Document }> {
  const size = statSync(file).size;
  if (size > MAX_GLB_BYTES) throw new Error(`${file}: ${size} bytes is over the ${MAX_GLB_BYTES}-byte limit for view sidecars`);
  const bytes = new Uint8Array(readFileSync(file));
  const io = newIO(d);
  const doc = await io.readBinary(bytes);
  doc.setLogger(new d.core.Logger(d.core.Logger.Verbosity.ERROR));
  return { bytes, doc };
}

/** Write (or reuse) the view sidecars of one body GLB. */
export async function writeViewSidecar(glb: string, options: ViewSidecarOptions = {}): Promise<ViewSidecarResult> {
  const ctx = options.context ?? {};
  const paths = viewSidecarPaths(glb);
  // the size cap before the read, so an oversized file is never loaded
  const size = statSync(glb).size;
  if (size > MAX_GLB_BYTES) throw new Error(`${glb}: ${size} bytes is over the ${MAX_GLB_BYTES}-byte limit for view sidecars`);
  const sourceBytes = readFileSync(glb);
  const sourceSha = sha(sourceBytes);
  const coarseSha = existsSync(paths.coarseSource) ? sha(readFileSync(paths.coarseSource)) : undefined;
  const opts = optionsHash(ctx);
  if (!options.force) {
    const hit = cached(paths, sourceSha, coarseSha, opts);
    if (hit) return { source: glb, cached: true, index: hit, paths };
  }

  const d = await loadDeps();
  const { doc: src } = await readGlb(d, glb);
  const before = countDocument(src);
  const looks = new Map<string, Look>();
  const warnings: string[] = [];
  const { wrapper, parts: specs } = segment(src, ctx);
  const materialOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // coarse from the kernel when the exporter wrote X.coarse.glb with the same parts
  let kernelCoarse: Map<number, Group[]> | undefined;
  if (coarseSha) {
    const { doc: csrc } = await readGlb(d, paths.coarseSource);
    const cspecs = segment(csrc, ctx).parts;
    if (cspecs.length === specs.length && cspecs.every((c, i) => c.id === specs[i].id)) {
      kernelCoarse = new Map();
      cspecs.forEach((c, i) => {
        const g = readPart(c, looks, ctx);
        kernelCoarse!.set(i, mergeFaces(g.faces.map((f) => weldAndReorder(f, d.encoder)), materialOrder));
      });
    } else warnings.push(`${basename(paths.coarseSource)} has other parts than ${basename(glb)}; coarse tier simplified instead`);
  }

  const built: BuiltPart[] = specs.map((spec, i) => {
    const g = readPart(spec, looks, ctx);
    warnings.push(...g.warnings);
    let fine = mergeFaces(g.faces.map((f) => weldAndReorder(f, d.encoder)), materialOrder);
    const tris = triangles(fine);
    const meshOrigin = !!ctx.meshOrigin || (g.sourcePrimitives <= MESH_ORIGIN_MAX_PRIMITIVES && tris >= MESH_ORIGIN_MIN_TRIANGLES);
    // decision 3 (DEFAULT): a print-resolution mesh is simplified for display; the source file is untouched
    if (meshOrigin) fine = fine.map((x) => simplifyGroup(x, d.simplifier as unknown as Simplifier, MESH_ORIGIN_ERROR));
    const coarse = kernelCoarse?.get(i) ?? fine.map((x) => simplifyGroup(x, d.simplifier as unknown as Simplifier, COARSE_ERROR));
    return { spec, fine, coarse, hash: geometryHash(fine), featureCount: g.sourcePrimitives, meshOrigin };
  });

  // instancing: same geometry hash, TRS-decomposable placements
  const byHash = new Map<string, BuiltPart[]>();
  for (const p of built) {
    if (!p.fine.length) continue;
    const list = byHash.get(p.hash) ?? [];
    list.push(p);
    byHash.set(p.hash, list);
  }
  const placements: Placement[] = [];
  const placed = new Set<BuiltPart>();
  for (const p of built) {
    if (!p.fine.length || placed.has(p)) continue;
    const group = byHash.get(p.hash)!;
    const instanced = group.length >= 2 && group.every((x) => x.spec.instanceable && decompose(x.spec.world));
    if (instanced) {
      placements.push({ parts: group, instanced: true });
      group.forEach((x) => placed.add(x));
    } else {
      placements.push({ parts: [p], instanced: false });
      placed.add(p);
    }
  }

  const tierOut = async (tier: "fine" | "coarse") => {
    const { doc, nodeOf } = buildDocument(d, placements, looks, ctx, tier, wrapper);
    const counts = countDocument(doc);
    await compress(d, doc);
    const io = newIO(d);
    const bytes = await io.writeBinary(doc);
    return { bytes, counts, nodeOf };
  };
  const fine = await tierOut("fine");
  // a coarse file only when it is worth one: B-rep tessellations rarely simplify without changing topology
  // (holes, fillets), so a simplified tier under 10 % smaller is not written and the coarse tier is the fine file
  const fineTris = built.reduce((n, p) => n + triangles(p.fine), 0);
  const coarseTris = built.reduce((n, p) => n + triangles(p.coarse), 0);
  const separateCoarse = !!kernelCoarse || coarseTris < 0.9 * fineTris;
  const coarse = separateCoarse ? await tierOut("coarse") : fine;

  const nodes: ViewNode[] = [];
  for (const pl of placements) {
    for (const p of pl.parts) {
      const at = fine.nodeOf.get(p)!;
      const c = p.spec.component;
      const o = p.spec.owner ? ctx.owner : undefined;
      nodes.push({
        id: p.spec.id,
        instancePath: p.spec.instancePath,
        ...(p.spec.refdes ? { refdes: p.spec.refdes } : {}),
        ...((c?.definition ?? o?.definition) ? { definition: c?.definition ?? o?.definition } : {}),
        ...((c?.vendorKey ?? o?.vendorKey) ? { vendorKey: c?.vendorKey ?? o?.vendorKey } : {}),
        ...((c?.partKind ?? o?.partKind) ? { partKind: c?.partKind ?? o?.partKind } : {}),
        ...(c?.placeholder || o?.placeholder || p.spec.extras.placeholder === true ? { placeholder: true } : {}),
        ...(p.spec.name ? { name: p.spec.name } : {}),
        ...(p.spec.role ? { role: p.spec.role } : {}),
        node: at.node,
        ...(at.instance !== undefined ? { instance: at.instance } : {}),
        bounds: boundsOf(p.fine, p.spec.world),
        tier: "fine",
        triangles: { fine: triangles(p.fine), coarse: triangles(p.coarse) },
        featureCount: p.featureCount,
        faces: p.fine.map((g) => g.faces),
      });
    }
  }
  const instancedGroups = placements.filter((p) => p.instanced);
  const meshOriginParts = built.filter((p) => p.meshOrigin).length;
  const tierInfo = (t: typeof fine, file: string, method: ViewTier["method"], error?: number): ViewTier => ({
    file,
    sha256: sha(t.bytes),
    bytes: t.bytes.length,
    draws: t.counts.draws,
    triangles: t.counts.triangles,
    method,
    ...(error !== undefined ? { error } : {}),
  });
  const index: ViewSidecarIndex = {
    schema: VIEW_SIDECAR_SCHEMA,
    pipeline: VIEW_PIPELINE_VERSION,
    idScope: "relative-to-owner",
    ...(wrapper ? { root: { node: 0, name: wrapper.name } } : {}),
    ...(ctx.owner ? { owner: ctx.owner } : {}),
    source: { file: basename(glb), sha256: sourceSha, bytes: sourceBytes.length, ...(coarseSha ? { coarse: { file: basename(paths.coarseSource), sha256: coarseSha } } : {}) },
    options: opts,
    tiers: {
      fine: tierInfo(fine, basename(paths.fine), meshOriginParts ? "simplified" : "merged", meshOriginParts ? MESH_ORIGIN_ERROR : undefined),
      coarse: separateCoarse ? tierInfo(coarse, basename(paths.coarse), kernelCoarse ? "kernel-coarse" : "simplified", kernelCoarse ? undefined : COARSE_ERROR) : { ...tierInfo(fine, basename(paths.fine), "same-as-fine"), error: COARSE_ERROR },
    },
    counts: { before, after: fine.counts },
    instancing: { groups: instancedGroups.length, instances: instancedGroups.reduce((n, p) => n + p.parts.length, 0), extension: "EXT_mesh_gpu_instancing" },
    nodes,
    design: {
      ids: "extras.protoboard on every node (partInstanceId relative to the owner; instanced nodes carry extras.protoboard.instances[i] per GPU instance). Verified (test/view-model.test.ts): three r187's GLTFLoader copies node extras to the node object's userData; a mesh with several primitives becomes a Group, so the ids sit on the Mesh's or InstancedMesh's parent and a picker walks up to the first ancestor with userData.protoboard; InstancedMesh instanceId indexes instances[]. glTF-Transform 4.5.1 keeps node extras on read and write.",
      faces: "_FEATURE_ID_0 vertex attribute (EXT_mesh_features, featureIds[0].attribute = 0, label face): the source primitive (B-rep face) index within the part. Verified: three's GLTFLoader keeps it as geometry attribute _feature_id_0 (the extension object itself is not read); glTF-Transform 4.5.1 reads and writes EXT_mesh_features.",
      names: "the source's wrapper node stays node 0 (root), and every node the geometry manifest names (features: interface pads; bodies: named bodies that explode apart) or that has its own extras.protoboard.partInstanceId stays its own child node with its source name, merged per material beneath it and never GPU-instanced; the rest of the owner is one unnamed child. Quantization may move a node's mesh into an unnamed child node (glTF-Transform does that for a node with children); names and extras stay on the named node.",
      join: "no cross-part join. Verified: glTF-Transform 4.5.1 join() keeps only the first joined node's extras and drops EXT_mesh_features from the joined primitive (the _FEATURE_ID_0 values survive), so parts stay separate nodes; each part is merged per material here instead, and the face-range table holds because no triangle leaves its face.",
      reorder: "per face (meshopt reorderMesh) instead of glTF-Transform reorder(), which reorders across faces and would break the face-range table (DEFAULT).",
      quantization: "POSITION 14 bit per mesh volume (KHR_mesh_quantization, node transforms and instance attributes adjusted by glTF-Transform quantize); NORMAL float, meshopt octahedral filter; _FEATURE_ID_0 unquantized.",
      units: "glTF metres, Y-up, as the source GLB; bounds are in the GLB's world frame.",
    },
    ...(warnings.length ? { warnings: [...new Set(warnings)].slice(0, 50) } : {}),
  };
  writeAtomic(paths.fine, fine.bytes);
  if (separateCoarse) writeAtomic(paths.coarse, coarse.bytes);
  else if (existsSync(paths.coarse)) rmSync(paths.coarse, { force: true });
  writeAtomic(paths.index, stable(index));
  options.log?.(`view: ${basename(glb)}: draws ${before.draws} → ${fine.counts.draws}, triangles ${before.triangles} → ${fine.counts.triangles} (coarse ${coarse.counts.triangles}), nodes ${before.nodes} → ${fine.counts.nodes}`);
  return { source: glb, cached: false, index, paths };
}

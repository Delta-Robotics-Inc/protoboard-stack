/**
 * Face and mesh geometry of a body GLB for mate suggestions and interference
 * (PB-1185). Read through glTF-Transform (already a core dependency) with the
 * meshopt decoder for view sidecars.
 *
 * Faces come from the view sidecar when it is current: `X.view.json`'s
 * face-range table names, per part node and primitive, which triangles of
 * `X.view.glb` came from which source primitive (one B-rep face in an OCCT
 * export). Without a current sidecar, the source `X.glb` is read and each of
 * its primitives counts as one face (the same convention the table records).
 *
 * THE UNIT BOUNDARY: positions leave this module in UHD's frame, mm and Z up,
 * in the body's own frame (the frame its `Placement.matrix` maps to the
 * assembly): every vertex goes through the GLB's node transforms (metres,
 * Y up) and then `gltfPointToUhd`. Nothing downstream converts again.
 */
import { existsSync, statSync } from "node:fs";
import { fileDigest, readJsonCapped } from "../part-files.js";
import { viewSidecarPaths } from "../view-model/names.js";
import type { ViewSidecarIndex } from "../view-model/types.js";

/** DEFAULT caps on what is read: file size and triangles per body. */
export const MAX_GLB_BYTES = 256 * 1024 * 1024;
export const MAX_BODY_TRIANGLES = 3_000_000;

export interface FaceGeom {
  /** View sidecar node id ("." for the owner's merged part), or the source node's name. */
  node: string;
  /** The face's feature id (source primitive ordinal). */
  feature: number;
  /** mm, Z up, body frame; xyz triples. */
  positions: Float32Array;
  /** Triangle corners into `positions`. */
  indices: Uint32Array;
}

export interface BodyFaces {
  file: string;
  via: "view-sidecar" | "source";
  faces: FaceGeom[];
  triangles: number;
  warnings: string[];
}

export interface BodyMesh {
  file: string;
  via: "view-sidecar" | "source";
  /** mm, Z up, body frame. */
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
  warnings: string[];
}

type GT = typeof import("@gltf-transform/core");
type Acc = import("@gltf-transform/core").Accessor;
type GNode = import("@gltf-transform/core").Node;

let deps: Promise<{ io: InstanceType<GT["NodeIO"]> }> | undefined;
/** One NodeIO with every extension glTF-Transform knows and the meshopt decoder; an unknown required extension is an error (read throws). */
function io() {
  deps ??= (async () => {
    const [core, ext, mo] = await Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions"), import("meshoptimizer")]);
    await mo.MeshoptDecoder.ready;
    return { io: new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": mo.MeshoptDecoder }) };
  })();
  return deps;
}

/** An accessor's values as floats, normalized integers brought to [-1, 1] / [0, 1] (KHR_mesh_quantization). */
function floatsOf(acc: Acc): Float32Array {
  const a = acc.getArray() as ArrayLike<number> & { BYTES_PER_ELEMENT?: number; constructor: { name: string } };
  if (a instanceof Float32Array) return a;
  const out = new Float32Array(a.length);
  if (!acc.getNormalized()) {
    for (let i = 0; i < a.length; i++) out[i] = a[i];
    return out;
  }
  const div = a instanceof Int8Array ? 127 : a instanceof Uint8Array ? 255 : a instanceof Int16Array ? 32767 : a instanceof Uint16Array ? 65535 : 1;
  const signed = a instanceof Int8Array || a instanceof Int16Array;
  for (let i = 0; i < a.length; i++) out[i] = signed ? Math.max(a[i] / div, -1) : a[i] / div;
  return out;
}

/** glTF column-major to row-major. */
const rowMajor = (c: ArrayLike<number>): number[] => [c[0], c[4], c[8], c[12], c[1], c[5], c[9], c[13], c[2], c[6], c[10], c[14], c[3], c[7], c[11], c[15]];

function trs(t: number[], r: number[], s: number[]): number[] {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0], (xy + wz) * s[0], (1 - (xx + zz)) * s[1], (yz - wx) * s[2], t[1], (xz - wy) * s[0], (yz + wx) * s[1], (1 - (xx + yy)) * s[2], t[2], 0, 0, 0, 1];
}
const mulRM = (a: number[], b: number[]) => {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
};

/** The node's world matrices (row-major, glTF metres, Y up): one, or one per GPU instance. */
function worldsOf(n: GNode): number[][] {
  const w = rowMajor(n.getWorldMatrix());
  const batch = n.getExtension("EXT_mesh_gpu_instancing") as { getAttribute(s: string): Acc | null } | null;
  if (!batch) return [w];
  const t = batch.getAttribute("TRANSLATION"), r = batch.getAttribute("ROTATION"), s = batch.getAttribute("SCALE");
  const count = (t ?? r ?? s)?.getCount() ?? 1;
  const out: number[][] = [];
  for (let i = 0; i < count; i++) out.push(mulRM(w, trs(t ? t.getElement(i, [0, 0, 0]) : [0, 0, 0], r ? r.getElement(i, [0, 0, 0, 1]) : [0, 0, 0, 1], s ? s.getElement(i, [1, 1, 1]) : [1, 1, 1])));
  return out;
}

/** Positions through a row-major glTF world matrix, then across the boundary: m, Y up -> mm, Z up (x, -z, y) x 1000. */
function toUhd(pos: Float32Array, m: number[]): Float32Array {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const gx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const gy = m[4] * x + m[5] * y + m[6] * z + m[7];
    const gz = m[8] * x + m[9] * y + m[10] * z + m[11];
    out[i] = gx * 1000;
    out[i + 1] = -gz * 1000;
    out[i + 2] = gy * 1000;
  }
  return out;
}

const indicesOf = (p: import("@gltf-transform/core").Primitive, vertexCount: number): Uint32Array => {
  const idx = p.getIndices();
  return idx ? Uint32Array.from(idx.getArray() as ArrayLike<number>) : Uint32Array.from({ length: vertexCount }, (_, i) => i);
};

function checkSize(file: string) {
  const size = statSync(file).size;
  if (size > MAX_GLB_BYTES) throw new Error(`${file} is ${size} bytes, over the ${MAX_GLB_BYTES}-byte limit (DEFAULT) for geometry reads`);
}

/** The view sidecar index when it describes the current bytes of `glb` (its source sha256 matches). */
export function currentViewIndex(glb: string, root?: string): { index: ViewSidecarIndex; viewGlb: string } | undefined {
  const paths = viewSidecarPaths(glb);
  if (!existsSync(paths.index) || !existsSync(paths.fine)) return undefined;
  try {
    const index = readJsonCapped<ViewSidecarIndex>(paths.index, 64 * 1024 * 1024);
    const d = fileDigest(glb, root);
    if (!index || !d || index.source?.sha256 !== d.sha256) return undefined;
    return { index, viewGlb: paths.fine };
  } catch {
    return undefined;
  }
}

/** Every face of a body: from the view sidecar's face-range table when current, else one per source primitive. */
export async function readBodyFaces(glb: string, root?: string): Promise<BodyFaces> {
  const { io: reader } = await io();
  const warnings: string[] = [];
  const view = currentViewIndex(glb, root);
  if (view) {
    checkSize(view.viewGlb);
    const doc = await reader.read(view.viewGlb);
    const nodes = doc.getRoot().listNodes();
    const faces: FaceGeom[] = [];
    let triangles = 0;
    for (const entry of view.index.nodes) {
      const n = nodes[entry.node];
      const mesh = n?.getMesh();
      if (!n || !mesh) {
        warnings.push(`view node ${entry.node} (${entry.id}) has no mesh`);
        continue;
      }
      const worlds = worldsOf(n);
      const world = worlds[entry.instance ?? 0] ?? worlds[0];
      mesh.listPrimitives().forEach((p, k) => {
        const pos = p.getAttribute("POSITION");
        const table = entry.faces[k];
        if (!pos || !table || p.getMode() !== 4) return;
        const all = toUhd(floatsOf(pos), world);
        const idx = indicesOf(p, pos.getCount());
        for (let i = 0; i + 2 < table.length; i += 3) {
          const [feature, first, count] = [table[i], table[i + 1], table[i + 2]];
          const sub = idx.subarray(first * 3, (first + count) * 3);
          // a face's own vertices, re-indexed (a face is small; the copy keeps fitting simple)
          const remap = new Map<number, number>();
          const out = new Uint32Array(sub.length);
          const verts: number[] = [];
          for (let j = 0; j < sub.length; j++) {
            let v = remap.get(sub[j]);
            if (v === undefined) {
              v = remap.size;
              remap.set(sub[j], v);
              verts.push(all[sub[j] * 3], all[sub[j] * 3 + 1], all[sub[j] * 3 + 2]);
            }
            out[j] = v;
          }
          faces.push({ node: entry.id, feature, positions: Float32Array.from(verts), indices: out });
          triangles += count;
        }
      });
      if (triangles > MAX_BODY_TRIANGLES) throw new Error(`${glb}: over ${MAX_BODY_TRIANGLES} triangles (DEFAULT cap)`);
    }
    return { file: glb, via: "view-sidecar", faces, triangles, warnings };
  }
  checkSize(glb);
  const doc = await reader.read(glb);
  const faces: FaceGeom[] = [];
  let feature = 0;
  let triangles = 0;
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    for (const world of worldsOf(n))
      for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute("POSITION");
        if (!pos || p.getMode() !== 4) continue;
        const indices = indicesOf(p, pos.getCount());
        faces.push({ node: n.getName() || "node", feature: feature++, positions: toUhd(floatsOf(pos), world), indices });
        triangles += indices.length / 3;
        if (triangles > MAX_BODY_TRIANGLES) throw new Error(`${glb}: over ${MAX_BODY_TRIANGLES} triangles (DEFAULT cap)`);
      }
  }
  return { file: glb, via: "source", faces, triangles, warnings };
}

/** One triangle soup for a body (every node and instance), mm Z up, body frame: the view sidecar when current, else the source. */
export async function readBodyMesh(glb: string, root?: string): Promise<BodyMesh> {
  const { io: reader } = await io();
  const view = currentViewIndex(glb, root);
  const file = view ? view.viewGlb : glb;
  checkSize(file);
  const doc = await reader.read(file);
  const pos: Float32Array[] = [];
  const idx: Uint32Array[] = [];
  let verts = 0;
  let triangles = 0;
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    for (const world of worldsOf(n))
      for (const p of mesh.listPrimitives()) {
        const a = p.getAttribute("POSITION");
        if (!a || p.getMode() !== 4) continue;
        const local = indicesOf(p, a.getCount());
        const shifted = new Uint32Array(local.length);
        for (let i = 0; i < local.length; i++) shifted[i] = local[i] + verts;
        pos.push(toUhd(floatsOf(a), world));
        idx.push(shifted);
        verts += a.getCount();
        triangles += local.length / 3;
        if (triangles > MAX_BODY_TRIANGLES) throw new Error(`${glb}: over ${MAX_BODY_TRIANGLES} triangles (DEFAULT cap)`);
      }
  }
  const positions = new Float32Array(verts * 3);
  let o = 0;
  for (const p of pos) {
    positions.set(p, o);
    o += p.length;
  }
  const indices = new Uint32Array(triangles * 3);
  o = 0;
  for (const i of idx) {
    indices.set(i, o);
    o += i.length;
  }
  return { file: glb, via: view ? "view-sidecar" : "source", positions, indices, triangles, warnings: [] };
}

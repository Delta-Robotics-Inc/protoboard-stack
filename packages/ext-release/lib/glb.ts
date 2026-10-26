/**
 * Overall size of a body from a provider's GLB standard output: the bounding
 * box of every mesh's POSITION bounds (accessor min/max, which glTF requires)
 * through the node transforms. glTF is Y-up in metres; the box is returned in
 * the model's Z-up millimetres, as the providers export it (build123d writes
 * the Z-up body under a root rotation, so the result is the body's own box).
 */
import { readFileSync } from "node:fs";

type M = number[]; // column-major 4×4, as glTF stores it

const I: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: M, b: M): M => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function trs(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): M {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m: M, p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

export interface GlbBox {
  min: [number, number, number];
  max: [number, number, number];
  /** Extents along X, Y, Z (mm). */
  size: [number, number, number];
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

/** The body's bounding box in mm (Z up), or undefined when the file is not a readable GLB. */
export function glbBox(file: string): GlbBox | undefined {
  let json: Gltf;
  try {
    const b = readFileSync(file);
    if (b.readUInt32LE(0) !== 0x46546c67) return undefined; // "glTF"
    const len = b.readUInt32LE(12);
    json = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as Gltf;
  } catch {
    return undefined;
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const visit = (i: number, parent: M) => {
    const n = json.nodes?.[i];
    if (!n) return;
    const m = mul(parent, trs(n));
    for (const prim of n.mesh !== undefined ? (json.meshes?.[n.mesh]?.primitives ?? []) : []) {
      const a = json.accessors?.[prim.attributes.POSITION];
      if (!a?.min || !a.max) continue;
      for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) {
        const p = apply(m, [x, y, z]);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const r of scene?.nodes ?? []) visit(r, I);
  if (!Number.isFinite(lo[0])) return undefined;
  // glTF Y-up metres → Z-up millimetres: X = x, Y = −z, Z = y
  const r3 = (v: number) => Math.round(v * 1000 * 100) / 100;
  const min: [number, number, number] = [r3(lo[0]), r3(-hi[2]), r3(lo[1])];
  const max: [number, number, number] = [r3(hi[0]), r3(-lo[2]), r3(hi[1])];
  return { min, max, size: [r3((hi[0] - lo[0])), r3((hi[2] - lo[2])), r3((hi[1] - lo[1]))] };
}

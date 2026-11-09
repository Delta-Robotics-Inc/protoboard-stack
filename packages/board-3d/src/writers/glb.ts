/**
 * GLB (glTF 2.0 binary) for the 3D viewer. One root node turns the board frame (millimeters, Z up) into glTF meters,
 * Y up; its direct children are the board body (no id: the viewer treats it as the substrate) and one node per
 * component carrying `extras.protoboard` { partInstanceId, refdes, definition, placeholder, body } as the viewer's board
 * split expects, placed by its own matrix so the viewer can explode and pick parts. One primitive per color.
 */
import { PART_COLORS } from "../bodies.js";
import type { Affine } from "../math.js";
import { sceneSolids, type Board3d } from "../scene.js";

const METALS = new Set([PART_COLORS.metal, PART_COLORS.tin, PART_COLORS.gold, PART_COLORS.can, PART_COLORS.crystal]);

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function rgba(hex: string): [number, number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  const f = (x: number) => Math.round(srgbToLinear(x / 255) * 1e4) / 1e4;
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255), 1];
}
const colMajor = (m: Affine): number[] => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, m[3], m[7], m[11], 1].map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e9) / 1e9));

export interface GlbOptions {
  /** The id the root carries (`""`: the board is the GLB's owner, as the viewer expects). */
  rootId?: string;
}

export function writeGlb(scene: Board3d, options: GlbOptions = {}): Buffer {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const matIdx = new Map<string, number>();
  const material = (color: string, placeholder: boolean): number => {
    const key = `${color}${placeholder ? "p" : ""}`;
    let i = matIdx.get(key);
    if (i === undefined) {
      const metal = METALS.has(color) || color === scene.colors.copper;
      i = materials.push({ name: color, pbrMetallicRoughness: { baseColorFactor: rgba(color), metallicFactor: metal ? 0.85 : 0.05, roughnessFactor: metal ? 0.35 : 0.65 } }) - 1;
      matIdx.set(key, i);
    }
    return i;
  };
  const view = (data: Buffer): number => {
    const pad = (4 - (data.length % 4)) % 4;
    const v = bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length }) - 1;
    chunks.push(data);
    if (pad) chunks.push(Buffer.alloc(pad));
    byteLength += data.length + pad;
    return v;
  };
  const meshOf = (name: string, pos: number[], color: number[], palette: string[], placeholder: boolean): number => {
    const byColor = new Map<number, number[]>();
    for (let t = 0; t < color.length; t++) {
      const list = byColor.get(color[t]) ?? [];
      list.push(t);
      byColor.set(color[t], list);
    }
    const primitives: Record<string, unknown>[] = [];
    for (const [c, tris] of [...byColor].sort((a, b) => a[0] - b[0])) {
      const p = new Float32Array(tris.length * 9);
      const n = new Float32Array(tris.length * 9);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      tris.forEach((t, k) => {
        const o = t * 9;
        const ux = pos[o + 3] - pos[o];
        const uy = pos[o + 4] - pos[o + 1];
        const uz = pos[o + 5] - pos[o + 2];
        const vx = pos[o + 6] - pos[o];
        const vy = pos[o + 7] - pos[o + 1];
        const vz = pos[o + 8] - pos[o + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        for (let j = 0; j < 3; j++) {
          for (let a = 0; a < 3; a++) {
            const v = pos[o + j * 3 + a];
            p[k * 9 + j * 3 + a] = v;
            const fv = p[k * 9 + j * 3 + a];
            if (fv < min[a]) min[a] = fv;
            if (fv > max[a]) max[a] = fv;
          }
          n[k * 9 + j * 3] = nx;
          n[k * 9 + j * 3 + 1] = ny;
          n[k * 9 + j * 3 + 2] = nz;
        }
      });
      const pv = view(Buffer.from(p.buffer, p.byteOffset, p.byteLength));
      const nv = view(Buffer.from(n.buffer, n.byteOffset, n.byteLength));
      const pa = accessors.push({ bufferView: pv, componentType: 5126, count: tris.length * 3, type: "VEC3", min, max }) - 1;
      const na = accessors.push({ bufferView: nv, componentType: 5126, count: tris.length * 3, type: "VEC3" }) - 1;
      primitives.push({ attributes: { POSITION: pa, NORMAL: na }, material: material(palette[c] ?? palette[0], placeholder), mode: 4 });
    }
    return meshes.push({ name, primitives }) - 1;
  };
  const children: number[] = [];
  const layers = new Map<string, { pos: number[]; color: number[]; palette: string[] }>();
  for (const s of sceneSolids(scene)) {
    if (s.group === "layer") {
      // one node per render layer
      const l = layers.get(s.name) ?? { pos: [], color: [], palette: [] };
      for (const v of s.solid.mesh.pos) l.pos.push(v);
      for (const ci of s.solid.mesh.color) {
        const col = s.solid.palette[ci] ?? s.solid.palette[0];
        let k = l.palette.indexOf(col);
        if (k < 0) k = l.palette.push(col) - 1;
        l.color.push(k);
      }
      layers.set(s.name, l);
      continue;
    }
    const c = s.component;
    const mesh = meshOf(s.name, s.solid.mesh.pos, s.solid.mesh.color, s.solid.palette, !!c?.body.placeholder);
    const extras = c
      ? { protoboard: { partInstanceId: c.path ?? c.ref, refdes: c.ref, definition: c.footprint, ...(c.value ? { value: c.value } : {}), ...(c.body.placeholder ? { placeholder: true } : {}), body: c.body.source, side: c.side } }
      : { protoboard: { role: s.group === "board" ? "substrate" : s.group } };
    const node = nodes.push({ name: c ? c.path ?? c.ref : s.name, mesh, ...(isIdentity(s.transform) ? {} : { matrix: colMajor(s.transform) }), extras }) - 1;
    children.push(node);
  }
  for (const [name, l] of layers) {
    const mesh = meshOf(name, l.pos, l.color, l.palette, false);
    children.push(nodes.push({ name, mesh, extras: { protoboard: { role: "layer" } } }) - 1);
  }
  const s = 0.001;
  const root = nodes.push({ name: scene.name, matrix: [s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, 0, 1], children, extras: { protoboard: { partInstanceId: options.rootId ?? "" } } }) - 1;
  const gltf = {
    asset: { version: "2.0", generator: "Protoboard board-3d", extras: { frame: "glTF: meters, +Y up; board frame (mm, Z up, origin at the board center, z = 0 on the bottom face) = (x, -z, y) x 1000", tier: scene.tier } },
    scene: 0,
    scenes: [{ name: scene.name, nodes: [root] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jpad = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonChunk, bh, bin]);
}

const isIdentity = (m: Affine) => m.every((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0][i]) < 1e-12);

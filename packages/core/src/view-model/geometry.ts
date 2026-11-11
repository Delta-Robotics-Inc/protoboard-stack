/**
 * Plain-array geometry for the view sidecar: 4x4 matrices (column-major, as
 * glTF stores them), per-face welding and vertex-cache reordering, merging a
 * part's faces into one buffer per material, simplification and crease
 * normals. No glTF-Transform here; the meshoptimizer encoder and simplifier
 * are passed in (loaded lazily by sidecar.ts).
 */
import { createHash } from "node:crypto";

export type Mat4 = number[];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

export function invert(m: Mat4): Mat4 {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return IDENTITY.slice();
  det = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}

export const det3 = (m: Mat4) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

export const isIdentity = (m: Mat4, eps = 1e-12) => m.every((v, i) => Math.abs(v - IDENTITY[i]) <= eps);

/** Translation, rotation (quaternion x, y, z, w) and scale of an affine matrix without shear, else undefined. */
export function decompose(m: Mat4): { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] } | undefined {
  const col = (c: number) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const x = col(0), y = col(1), z = col(2);
  let sx = len(x);
  const sy = len(y), sz = len(z);
  if (!sx || !sy || !sz) return undefined;
  if (det3(m) < 0) sx = -sx;
  const nx = x.map((v) => v / sx), ny = y.map((v) => v / sy), nz = z.map((v) => v / sz);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.abs(dot(nx, ny)) > 1e-5 || Math.abs(dot(nx, nz)) > 1e-5 || Math.abs(dot(ny, nz)) > 1e-5) return undefined;
  if (Math.abs(m[3]) > 1e-9 || Math.abs(m[7]) > 1e-9 || Math.abs(m[11]) > 1e-9 || Math.abs(m[15] - 1) > 1e-9) return undefined;
  // rotation matrix (columns nx, ny, nz) to quaternion
  const m00 = nx[0], m10 = nx[1], m20 = nx[2], m01 = ny[0], m11 = ny[1], m21 = ny[2], m02 = nz[0], m12 = nz[1], m22 = nz[2];
  const tr = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const ql = Math.hypot(...q);
  if (q[3] < 0) q = q.map((v) => -v) as typeof q; // one sign per rotation, so equal rotations hash equal
  return { t: [m[12], m[13], m[14]], r: q.map((v) => v / ql) as typeof q, s: [sx, sy, sz] };
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** The 3x3 inverse transpose of m, for normals (column-major 3x3 in a 9-array). */
export function normalMatrix(m: Mat4): number[] {
  const inv = invert(m);
  return [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
}

// ---------------------------------------------------------------------------
// Faces and parts
// ---------------------------------------------------------------------------

/** One source primitive (one B-rep face in an OCCT export), in the part's frame. */
export interface Face {
  feature: number;
  material: string;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array;
}

/** A part's geometry merged per material: one primitive each. */
export interface Group {
  material: string;
  positions: Float32Array;
  normals: Float32Array;
  features: Float32Array;
  indices: Uint32Array;
  /** `[feature, firstTriangle, triangleCount]` per contiguous run. */
  faces: number[];
}

export interface Encoder {
  reorderMesh: (indices: Uint32Array, triangles: boolean, optsize: boolean) => [Uint32Array, number];
}

export interface Simplifier {
  simplify: (indices: Uint32Array, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: ("LockBorder" | "Prune" | "ErrorAbsolute")[]) => [Uint32Array, number];
}

/**
 * A face moved into the part's frame: positions by `m`, normals by its
 * normal matrix (renormalised), winding flipped for a mirroring `m`.
 */
export function placeFace(f: Face, m: Mat4): Face {
  if (isIdentity(m)) return f;
  const p = f.positions;
  const positions = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = transformPoint(m, p[i], p[i + 1], p[i + 2]);
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
  let normals: Float32Array | null = null;
  if (f.normals) {
    const n = normalMatrix(m);
    const s = f.normals;
    normals = new Float32Array(s.length);
    for (let i = 0; i < s.length; i += 3) {
      const x = n[0] * s[i] + n[3] * s[i + 1] + n[6] * s[i + 2];
      const y = n[1] * s[i] + n[4] * s[i + 1] + n[7] * s[i + 2];
      const z = n[2] * s[i] + n[5] * s[i + 1] + n[8] * s[i + 2];
      const l = Math.hypot(x, y, z) || 1;
      normals[i] = x / l;
      normals[i + 1] = y / l;
      normals[i + 2] = z / l;
    }
  }
  let indices = f.indices;
  if (det3(m) < 0) {
    indices = indices.slice();
    for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  }
  return { ...f, positions, normals, indices };
}

/** Area-weighted vertex normals of an indexed triangle list (for a face that came without normals). */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * Weld bitwise-identical vertices of one face, then reorder its triangles
 * for the vertex cache and its vertices for fetch (meshopt), dropping
 * unused ones. Triangles never leave their face, so the face-range table
 * stays contiguous.
 */
export function weldAndReorder(f: Face, encoder: Encoder): Face {
  const p = f.positions;
  const nrm = f.normals ?? vertexNormals(p, f.indices);
  const count = p.length / 3;
  const pb = new Uint32Array(p.buffer, p.byteOffset, p.length);
  const nb = new Uint32Array(nrm.buffer, nrm.byteOffset, nrm.length);
  const first = new Map<string, number>();
  const weld = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    const k = `${pb[v * 3]},${pb[v * 3 + 1]},${pb[v * 3 + 2]},${nb[v * 3]},${nb[v * 3 + 1]},${nb[v * 3 + 2]}`;
    const at = first.get(k);
    if (at === undefined) {
      first.set(k, v);
      weld[v] = v;
    } else weld[v] = at;
  }
  // degenerate triangles (two corners welded together) draw nothing: dropped
  const tris: number[] = [];
  for (let t = 0; t < f.indices.length; t += 3) {
    const a = weld[f.indices[t]], b = weld[f.indices[t + 1]], c = weld[f.indices[t + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const indices = Uint32Array.from(tris);
  if (!indices.length) return { ...f, positions: new Float32Array(0), normals: new Float32Array(0), indices };
  const [remap, unique] = encoder.reorderMesh(indices, true, true);
  const positions = new Float32Array(unique * 3);
  const normals = new Float32Array(unique * 3);
  for (let v = 0; v < count; v++) {
    const to = remap[v];
    if (to === 0xffffffff) continue;
    positions.set(p.subarray(v * 3, v * 3 + 3), to * 3);
    normals.set(nrm.subarray(v * 3, v * 3 + 3), to * 3);
  }
  return { ...f, positions, normals, indices };
}

/** Faces merged into one group per material, in material order, faces kept contiguous. */
export function mergeFaces(faces: Face[], materialOrder: (a: string, b: string) => number): Group[] {
  const by = new Map<string, Face[]>();
  for (const f of faces) {
    if (!f.indices.length) continue;
    const list = by.get(f.material) ?? [];
    list.push(f);
    by.set(f.material, list);
  }
  return [...by.keys()].sort(materialOrder).map((material) => {
    const list = by.get(material)!;
    const verts = list.reduce((n, f) => n + f.positions.length / 3, 0);
    const idx = list.reduce((n, f) => n + f.indices.length, 0);
    const g: Group = { material, positions: new Float32Array(verts * 3), normals: new Float32Array(verts * 3), features: new Float32Array(verts), indices: new Uint32Array(idx), faces: [] };
    let v = 0;
    let i = 0;
    for (const f of list) {
      g.positions.set(f.positions, v * 3);
      g.normals.set(f.normals!, v * 3);
      g.features.fill(f.feature, v, v + f.positions.length / 3);
      for (let k = 0; k < f.indices.length; k++) g.indices[i + k] = f.indices[k] + v;
      g.faces.push(f.feature, i / 3, f.indices.length / 3);
      v += f.positions.length / 3;
      i += f.indices.length;
    }
    return g;
  });
}

/** Content hash of a part's merged geometry, positions rounded to 1 µm (glTF metres), for instancing. */
export function geometryHash(groups: Group[]): string {
  const h = createHash("sha256");
  for (const g of groups) {
    h.update(`m:${g.material};`);
    const q = new Int32Array(g.positions.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(g.positions[i] * 1e6);
    h.update(new Uint8Array(q.buffer));
    h.update(new Uint8Array(g.indices.buffer, g.indices.byteOffset, g.indices.byteLength));
    h.update(new Uint8Array(g.features.buffer, g.features.byteOffset, g.features.byteLength));
  }
  return h.digest("hex");
}

export function groupBounds(groups: Group[]): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) {
    for (let i = 0; i < g.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = g.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return min[0] <= max[0] ? { min, max } : undefined;
}

export const triangles = (groups: Group[]) => groups.reduce((n, g) => n + g.indices.length / 3, 0);

// ---------------------------------------------------------------------------
// Simplification (mesh-origin parts and the coarse tier)
// ---------------------------------------------------------------------------

const CREASE_COS = Math.cos((40 * Math.PI) / 180);

/**
 * A group simplified with meshoptimizer: vertices welded by position (so the
 * simplifier sees one surface across face seams), simplified to `error`
 * (a fraction of the group's extent), then split again where faces meet at
 * more than 40 degrees (crease normals) and sorted by feature so the
 * face-range table stays contiguous. Each output vertex keeps the feature of
 * the source vertex it came from.
 */
export function simplifyGroup(g: Group, simplifier: Simplifier, error: number): Group {
  const count = g.positions.length / 3;
  const pb = new Uint32Array(g.positions.buffer, g.positions.byteOffset, g.positions.length);
  const first = new Map<string, number>();
  const weld = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    const k = `${pb[v * 3]},${pb[v * 3 + 1]},${pb[v * 3 + 2]}`;
    const at = first.get(k);
    if (at === undefined) (first.set(k, v), (weld[v] = v));
    else weld[v] = at;
  }
  const welded = new Uint32Array(g.indices.length);
  for (let i = 0; i < welded.length; i++) welded[i] = weld[g.indices[i]];
  // the feature of a triangle: its first corner's, before welding
  const triFeature = new Float32Array(g.indices.length / 3);
  for (let t = 0; t < triFeature.length; t++) triFeature[t] = g.features[g.indices[t * 3]];
  // no "Prune": it drops disconnected pieces smaller than the error (embossed text, small bosses), a visible loss
  const [kept] = simplifier.simplify(welded, g.positions, 3, 0, error, []);
  // simplify returns a subset of the welded triangles' corners; recover each triangle's feature from the nearest source triangle by corner set
  const featureOf = new Map<string, number>();
  for (let t = 0; t < triFeature.length; t++) {
    const [a, b, c] = [welded[t * 3], welded[t * 3 + 1], welded[t * 3 + 2]];
    for (const k of [`${a}`, `${b}`, `${c}`]) if (!featureOf.has(k)) featureOf.set(k, triFeature[t]);
  }
  const nt = kept.length / 3;
  const order = Array.from({ length: nt }, (_, t) => t);
  const tf = order.map((t) => featureOf.get(`${kept[t * 3]}`) ?? 0);
  order.sort((a, b) => tf[a] - tf[b] || a - b);
  // face normals
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [kept[t * 3] * 3, kept[t * 3 + 1] * 3, kept[t * 3 + 2] * 3];
    const p = g.positions;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const unit = (t: number) => {
    const l = Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1;
    return [fn[t * 3] / l, fn[t * 3 + 1] / l, fn[t * 3 + 2] / l];
  };
  const incident = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = kept[t * 3 + k];
    const list = incident.get(v) ?? [];
    list.push(t);
    incident.set(v, list);
  }
  const outP: number[] = [];
  const outN: number[] = [];
  const outF: number[] = [];
  const outI: number[] = [];
  const faces: number[] = [];
  const seen = new Map<string, number>();
  for (const t of order) {
    const ut = unit(t);
    for (let k = 0; k < 3; k++) {
      const v = kept[t * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (const o of incident.get(v)!) {
        const uo = unit(o);
        if (uo[0] * ut[0] + uo[1] * ut[1] + uo[2] * ut[2] >= CREASE_COS) {
          nx += fn[o * 3];
          ny += fn[o * 3 + 1];
          nz += fn[o * 3 + 2];
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const n = [nx / l, ny / l, nz / l];
      const key = `${v},${tf[t]},${Math.round(n[0] * 1e3)},${Math.round(n[1] * 1e3)},${Math.round(n[2] * 1e3)}`;
      let at = seen.get(key);
      if (at === undefined) {
        at = outF.length;
        seen.set(key, at);
        outP.push(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]);
        outN.push(n[0], n[1], n[2]);
        outF.push(tf[t]);
      }
      outI.push(at);
    }
    const tri = outI.length / 3 - 1;
    if (faces.length && faces[faces.length - 3] === tf[t] && faces[faces.length - 2] + faces[faces.length - 1] === tri) faces[faces.length - 1]++;
    else faces.push(tf[t], tri, 1);
  }
  return { material: g.material, positions: Float32Array.from(outP), normals: Float32Array.from(outN), features: Float32Array.from(outF), indices: Uint32Array.from(outI), faces };
}

/**
 * Small vector and frame maths for the mates module (PB-1185). Pure.
 *
 * Matrices here are UHD's: row-major 4x4 as a flat 16-array, mm, Z up
 * (`Placement.matrix`, `HardwarePlacement.matrix`), applied to column vectors.
 *
 * THE UNIT BOUNDARY: glTF is metres and Y up; UHD is mm and Z up. A GLB's
 * coordinates come back to UHD through `gltfPointToUhd` / `gltfDirToUhd`, the
 * same map as the viewer's `cadWrapper` (uhd-viewer `src/cad/scene.ts`:
 * rotate +90 degrees about X, scale 1000) and ext-harness-cad's `to_cad_mm`:
 * (x, y, z) m, Y up  ->  (1000 x, -1000 z, 1000 y) mm, Z up.
 * Nothing else in the module converts.
 */
import type { Dof, MateFrame, MateLimit, Vec3 } from "./types.js";

export type M4 = number[];

export const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: readonly number[], k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: readonly number[]): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const finite3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** glTF point (m, Y up) to UHD (mm, Z up): the viewer's cadWrapper, written out. */
export const gltfPointToUhd = (p: readonly number[]): Vec3 => [p[0] * 1000, -p[2] * 1000, p[1] * 1000];
/** glTF direction (Y up) to UHD (Z up): the same rotation, no scale. */
export const gltfDirToUhd = (d: readonly number[]): Vec3 => [d[0], -d[2], d[1]];

export const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Row-major product a·b. */
export function mul(a: readonly number[], b: readonly number[]): M4 {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
}
export const applyPoint = (m: readonly number[], p: readonly number[]): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
export const applyDir = (m: readonly number[], d: readonly number[]): Vec3 => [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
export const translation = (v: readonly number[]): M4 => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];

/** Inverse of a rigid (rotation plus translation) row-major matrix. Scale-free placements only (UHD's are). */
export function invertRigid(m: readonly number[]): M4 {
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // transpose of the rotation
  const t = [m[3], m[7], m[11]];
  return [r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]), r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]), r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]), 0, 0, 0, 1];
}

/** General 4x4 inverse (row-major), for matrices that may carry scale (GLB node transforms). */
export function invert(m: readonly number[]): M4 {
  const a = m;
  const inv = new Array<number>(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  const k = det ? 1 / det : 0;
  return inv.map((x) => x * k);
}

/** Rotation by `deg` about the line through `p` along unit `axis` (right-hand rule), row-major. */
export function rotationAbout(axis: readonly number[], p: readonly number[], deg: number): M4 {
  const a = (deg * Math.PI) / 180;
  const [x, y, z] = unit(axis);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const r: M4 = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1];
  return mul(translation(p), mul(r, translation([-p[0], -p[1], -p[2]])));
}

/** A frame as a row-major matrix (columns x, y, z, origin). x defaults to any perpendicular of z. */
export function frameMatrix(f: MateFrame): M4 {
  const z = unit(f.zAxis);
  let x = f.xAxis ? unit(sub(f.xAxis, scale(z, dot(f.xAxis, z)))) : perpendicular(z);
  if (!len(x) || !Number.isFinite(x[0])) x = perpendicular(z);
  const y = cross(z, x);
  return [x[0], y[0], z[0], f.origin[0], x[1], y[1], z[1], f.origin[1], x[2], y[2], z[2], f.origin[2], 0, 0, 0, 1];
}

/** A unit vector perpendicular to `n` (stable choice). */
export function perpendicular(n: readonly number[]): Vec3 {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, a));
}

/** A frame carried through a row-major matrix (a body frame to world, or back). */
export function transformFrame(m: readonly number[], f: MateFrame): MateFrame {
  return { origin: applyPoint(m, f.origin), zAxis: unit(applyDir(m, f.zAxis)), ...(f.xAxis ? { xAxis: unit(applyDir(m, f.xAxis)) } : {}) };
}

/** A sidecar frame written in glTF space (m, Y up) brought to UHD (mm, Z up): the boundary. */
export function gltfFrameToUhd(f: MateFrame): MateFrame {
  return { origin: gltfPointToUhd(f.origin), zAxis: gltfDirToUhd(f.zAxis), ...(f.xAxis ? { xAxis: gltfDirToUhd(f.xAxis) } : {}) };
}

/** Which degrees of freedom a mate kind has (what its limits may name). */
export const DOFS: Record<string, Dof[]> = {
  fixed: [],
  revolute: ["rotate"],
  prismatic: ["slide"],
  cylindrical: ["rotate", "slide"],
  coaxial: ["rotate", "slide"],
  planar: ["rotate", "slide"],
};

/** A limit in degrees (rotate) or mm (slide). Undefined for a unit that does not fit the dof. */
export function normalizeLimit(l: MateLimit): { min?: number; max?: number; rest: number } | undefined {
  const k = l.dof === "rotate" ? (l.unit === "deg" ? 1 : l.unit === "rad" ? 180 / Math.PI : undefined) : l.unit === "mm" ? 1 : l.unit === "m" ? 1000 : undefined;
  if (k === undefined) return undefined;
  const f = (x: number | undefined) => (x === undefined ? undefined : x * k);
  return { min: f(l.min), max: f(l.max), rest: f(l.rest) ?? 0 };
}

/**
 * Eigen-decomposition of a symmetric 3x3 (cyclic Jacobi), eigenvalues ascending
 * with their unit eigenvectors. Used to find a cylinder's axis: the direction
 * its face normals do not spread along.
 */
export function eigenSym3(m: readonly number[]): { values: number[]; vectors: Vec3[] } {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => unit([v[0][i], v[1][i], v[2][i]])) };
}

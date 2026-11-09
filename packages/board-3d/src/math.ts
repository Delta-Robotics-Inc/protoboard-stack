/**
 * Small vector and rigid-transform helpers. Everything in this package is in millimeters (floats), in the board frame
 * (X right and Y up seen from the top, Z out of the top face, z = 0 on the board's bottom face) unless a name says
 * otherwise. Transforms are affine 3 x 4 matrices, row-major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz].
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** Row-major 3 x 4 affine matrix. */
export type Affine = number[];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a * b (apply b first). */
export function compose(a: Affine, b: Affine): Affine {
  const r: Affine = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      let v = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
      if (j === 3) v += a[i * 4 + 3];
      r[i * 4 + j] = v;
    }
  }
  return r;
}

export function apply(m: Affine, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
}
/** The linear part applied to a direction. */
export function applyDir(m: Affine, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
}
export const translation = (t: Vec3): Affine => [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]];
/** Rotation about +Z by degrees (counterclockwise seen from the top). */
export function rotationZ(degrees: number): Affine {
  const a = (degrees * Math.PI) / 180;
  const c = clean(Math.cos(a));
  const s = clean(Math.sin(a));
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}
/** Rotation about +X by degrees. */
export function rotationX(degrees: number): Affine {
  const a = (degrees * Math.PI) / 180;
  const c = clean(Math.cos(a));
  const s = clean(Math.sin(a));
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}
/** Rotation about +Y by degrees. */
export function rotationY(degrees: number): Affine {
  const a = (degrees * Math.PI) / 180;
  const c = clean(Math.cos(a));
  const s = clean(Math.sin(a));
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}
/** Rotate Z then Y then X (the order KiCad and most libraries state a model rotation in), degrees. */
export const rotationXYZ = (r: Vec3): Affine => compose(rotationX(r[0]), compose(rotationY(r[1]), rotationZ(r[2])));
/** cos and sin exact at multiples of 90 degrees, so placements stay exact. */
function clean(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-12 ? r : v;
}
/** Inverse of a rigid transform (rotation and translation only). */
export function invertRigid(m: Affine): Affine {
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const t: Vec3 = [m[3], m[7], m[11]];
  return [r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]), r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]), r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2])];
}
/** The determinant of the linear part (negative for a mirror). */
export const det = (m: Affine): number => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

export interface Bounds {
  min: Vec3;
  max: Vec3;
}
export const emptyBounds = (): Bounds => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
export function growBounds(b: Bounds, p: Vec3): void {
  for (let i = 0; i < 3; i++) {
    if (p[i] < b.min[i]) b.min[i] = p[i];
    if (p[i] > b.max[i]) b.max[i] = p[i];
  }
}
export const boundsValid = (b: Bounds): boolean => b.min[0] <= b.max[0];
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return { min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])], max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])] };
}
/** Round to 1 nm for stable output. */
export const r6 = (v: number): number => {
  const x = Math.round(v * 1e6) / 1e6;
  return x === 0 ? 0 : x;
};
export const roundVec = (v: Vec3): Vec3 => [r6(v[0]), r6(v[1]), r6(v[2])];
export const roundBounds = (b: Bounds): Bounds => ({ min: roundVec(b.min), max: roundVec(b.max) });

/**
 * Exact predicates on integer coordinates. Board lengths are integer nanometers, so every orientation test can be
 * decided exactly: a fast floating-point path when the products are below 2^53 (then they are exact), an error
 * bound filter above that, and BigInt arithmetic only when the filter cannot decide.
 */

const TWO53 = 9007199254740992;
/** Relative error bound of `l - r` for two rounded products (generous). */
const FILTER = 8.9e-16;

/** Sign of (b - a) x (c - a): 1 when c is left of a->b, -1 right, 0 collinear. Inputs must be integers. */
export function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const l = (bx - ax) * (cy - ay);
  const r = (by - ay) * (cx - ax);
  if (l < TWO53 && l > -TWO53 && r < TWO53 && r > -TWO53) return l > r ? 1 : l < r ? -1 : 0;
  const det = l - r;
  const bound = (Math.abs(l) + Math.abs(r)) * FILTER;
  if (det > bound) return 1;
  if (det < -bound) return -1;
  const e = BigInt(bx - ax) * BigInt(cy - ay) - BigInt(by - ay) * BigInt(cx - ax);
  return e > 0n ? 1 : e < 0n ? -1 : 0;
}

/** Sign of the cross product of two integer vectors (ux, uy) x (vx, vy). */
export function crossSign(ux: number, uy: number, vx: number, vy: number): number {
  return orient(0, 0, ux, uy, vx, vy);
}

/** Sign of the dot product of two integer vectors. */
export function dotSign(ux: number, uy: number, vx: number, vy: number): number {
  const l = ux * vx;
  const r = -(uy * vy);
  if (l < TWO53 && l > -TWO53 && r < TWO53 && r > -TWO53) return l > r ? 1 : l < r ? -1 : 0;
  const det = l - r;
  const bound = (Math.abs(l) + Math.abs(r)) * FILTER;
  if (det > bound) return 1;
  if (det < -bound) return -1;
  const e = BigInt(ux) * BigInt(vx) + BigInt(uy) * BigInt(vy);
  return e > 0n ? 1 : e < 0n ? -1 : 0;
}

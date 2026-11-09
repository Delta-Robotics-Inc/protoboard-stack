/**
 * Units (contract section 2). One grid unit (gu) is the symbol lattice unit: 2.54 mm on paper, 5 frame pixels in
 * a symbol file, 16 screen pixels at zoom 1. Every stored coordinate is an integer number of grid units; +X right,
 * +Y down, origin at the sheet's top-left.
 */
import { MARGIN, UNIT } from "@protoboardai/symbols";

/** Millimeters per grid unit. */
export const GU_MM = 2.54;
/** Symbol frame pixels per grid unit. */
export const FRAME_PX = UNIT;

export const guToMm = (gu: number): number => Math.round(gu * GU_MM * 10_000) / 10_000;
export const mmToGu = (mm: number): number => mm / GU_MM;
/** A symbol frame pixel coordinate in lattice units (frame px 2 is lattice 0). */
export const frameToLattice = (px: number): number => (px - MARGIN) / UNIT;

export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** A point in grid units. */
export type XY = [number, number];

/**
 * The symbol transform: lattice point `p` of a symbol placed at (x, y) with `rotation` (counterclockwise on the
 * sheet, +Y down) and `mirror` (left to right in the symbol's own frame, applied first).
 */
export function transformPoint(p: XY, rotation: Rotation, mirror: boolean, at: XY = [0, 0]): XY {
  let [u, v] = p;
  if (mirror) u = -u;
  let x: number;
  let y: number;
  switch (rotation) {
    case 0:
      [x, y] = [u, v];
      break;
    case 90:
      [x, y] = [v, -u];
      break;
    case 180:
      [x, y] = [-u, -v];
      break;
    case 270:
      [x, y] = [-v, u];
      break;
  }
  return [at[0] + x + 0, at[1] + y + 0];
}

export type Dir = "left" | "right" | "up" | "down";
const DIR_VEC: Record<Dir, XY> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
export const dirVec = (d: Dir): XY => DIR_VEC[d];
export function vecDir(v: XY): Dir {
  if (Math.abs(v[0]) >= Math.abs(v[1])) return v[0] < 0 ? "left" : "right";
  return v[1] < 0 ? "up" : "down";
}
/** A pin direction after the symbol transform. */
export function transformDir(d: Dir, rotation: Rotation, mirror: boolean): Dir {
  return vecDir(transformPoint(DIR_VEC[d], rotation, mirror));
}
export const opposite = (d: Dir): Dir => ({ left: "right", right: "left", up: "down", down: "up" })[d] as Dir;

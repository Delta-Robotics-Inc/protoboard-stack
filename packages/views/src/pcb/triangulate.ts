/// <reference path="./three-extras.d.ts" />
/** Polygon triangulation for filled shapes: three.js's port of earcut (three is already the renderer's dependency). */
import { Earcut } from "three/src/extras/Earcut.js";

/** Triangles (vertex indices) of a flat outer ring followed by holes starting at the given vertex indices. */
export const triangulate = (flat: number[], holes: number[]): number[] => Earcut.triangulate(flat, holes.length ? holes : undefined, 2);

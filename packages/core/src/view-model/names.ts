/**
 * View sidecar file names (PB-1173, plan.md "Interfaces agreed between
 * writers"). For every body `X.glb` the build writes, beside it:
 *
 *   X.view.glb         the fine tier: merged per part and material, repeated
 *                      parts instanced, quantized, meshopt-compressed
 *   X.view.coarse.glb  the coarse tier (same nodes and ids, fewer triangles)
 *   X.view.json        the scene index (ids, instance paths, vendor keys,
 *                      bounds, face-range table, tiers, content hashes)
 *
 * `X.glb` itself is never changed: other readers (ext-harness-cad glb.py,
 * ext-release glb.ts, checkGlb, circuit-json-to-gltf, ext-docs) need plain,
 * uncompressed glTF. A viewer loads `X.view.glb` when present and its
 * `X.view.json` names the current `X.glb` (source sha256), else `X.glb`.
 *
 * No dependency here: outputs.ts imports this module to tell sidecars from
 * export outputs, and must not load glTF-Transform.
 */
import { basename, dirname, join } from "node:path";

export const VIEW_SIDECAR_SCHEMA = "protoboard.view-sidecar/v0";

/** Bumped whenever the pipeline's output for the same input changes, so cached sidecars are rebuilt. */
export const VIEW_PIPELINE_VERSION = 1;

const SIDECAR = /\.view(\.coarse)?\.(glb|json)$/i;
const COARSE_SOURCE = /\.coarse\.glb$/i;

/** True for a view sidecar file name (`X.view.glb`, `X.view.coarse.glb`, `X.view.json`). */
export function isViewSidecarFile(name: string): boolean {
  return SIDECAR.test(name);
}

/**
 * True for a coarse tessellation written by a Python exporter beside its
 * fine GLB (`X.coarse.glb`, 0.5 rad / 0.1 mm). It is an input of the coarse
 * view tier, not a body of its own.
 */
export function isCoarseSourceFile(name: string): boolean {
  return COARSE_SOURCE.test(name) && !SIDECAR.test(name);
}

export interface ViewSidecarPaths {
  /** The body GLB the sidecars describe. */
  source: string;
  /** A coarse tessellation of the same body from the kernel, used when present. */
  coarseSource: string;
  fine: string;
  coarse: string;
  index: string;
}

/** The sidecar paths for a body GLB `.../X.glb`. */
export function viewSidecarPaths(glb: string): ViewSidecarPaths {
  const dir = dirname(glb);
  const stem = basename(glb).replace(/\.glb$/i, "");
  return {
    source: glb,
    coarseSource: join(dir, `${stem}.coarse.glb`),
    fine: join(dir, `${stem}.view.glb`),
    coarse: join(dir, `${stem}.view.coarse.glb`),
    index: join(dir, `${stem}.view.json`),
  };
}

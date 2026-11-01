/**
 * The enclosure voxel field as an interference test (PB-1185, research B.4
 * v2: "the CLI already has a voxel clearance field for enclosures"). An
 * enclosure that ext-enclosure-cad generated is voxelised and its signed
 * distance field built exactly as its fit analysis does (`py/fit.py`
 * `analyse`: ext-harness-cad's `ObstacleMap`, solid fill, the Euclidean
 * distance transform of free space minus the depth into solid). Every other
 * body's surface is sampled at each keyframe pose and looked up: a sample
 * deeper than one cell inside a wall is an interference, its depth the
 * penetration estimate (good to about one cell, the field's resolution).
 *
 * The Python is this file's own (below), run in the project's CAD runtime;
 * it imports fit.py, route.py and glb.py read-only from their packages and
 * changes none of them (fit.py is hashed into the enclosure generator digest).
 * Caps (DEFAULT): `MAX_CELLS` voxels, as fit.py (the cell grows to fit), and
 * a wall-clock timeout. Units: mm, Z up; glb.py's `to_cad_mm` converts each
 * GLB from glTF (m, Y up) at its boundary.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRuntime } from "../tools.js";

/** DEFAULT caps: voxels in the field (fit.py's MAX_CELLS), seconds for the whole run, and the cell size asked for (mm). */
export const VOXEL_DEFAULTS = { maxCells: 6_000_000, timeoutS: 120, resolutionMm: 0.5 };

export interface VoxelQuery {
  /** Query id (echoed back). */
  id: string;
  /** Body GLB (plain glTF; read by glb.py). */
  glb: string;
  /** Body frame to enclosure frame, row-major (mm). */
  matrix: number[];
}
export interface VoxelAnswer {
  id: string;
  /** Lowest signed clearance over the samples (mm; negative = inside a wall). */
  minClearanceMm: number;
  /** Where (enclosure frame, mm). */
  at: number[];
  /** The wall part there. */
  wall: string;
  samples: number;
}
export interface VoxelRun {
  ok: boolean;
  resolutionMm?: number;
  grid?: number[];
  cells?: number;
  answers: VoxelAnswer[];
  ms: number;
  error?: string;
}

/** The Python run per request: read stdin JSON, write one JSON line. */
const SCRIPT = String.raw`
import json, sys, time
req = json.load(sys.stdin)
sys.path.insert(0, req["fit_py"])
import numpy as np
from scipy import ndimage
import fit  # ext-enclosure-cad py/fit.py: imports ext-harness-cad route.py and glb.py itself
t0 = time.time()
v, f = fit.load_mesh(req["walls"])
lo = v.min(axis=0) - 2.0
hi = v.max(axis=0) + 2.0
res = float(req["resolution"])
cells = float(np.prod(np.ceil((hi - lo) / res) + 1))
if cells > req["max_cells"]:
    res = float(np.ceil(((np.prod(hi - lo) / req["max_cells"]) ** (1 / 3)) * 100) / 100)
om = fit.ObstacleMap(np.floor(lo), np.ceil(hi), res)
# one solid per wall node, so a hit names its part
parts = {}
for name, pv, pf in fit.read_glb(req["walls"]):
    parts.setdefault(name or "enclosure", []).append((fit.to_cad_mm(pv), pf))
for name, items in sorted(parts.items()):
    vs, fs, n = [], [], 0
    for pv, pf in items:
        vs.append(pv); fs.append(pf + n); n += len(pv)
    om.add_solid(np.concatenate(vs), np.concatenate(fs), name)
om.finalize()
depth = ndimage.distance_transform_edt(om.occ) * res
meshes = {}
out = []
for q in req["queries"]:
    if time.time() - t0 > req["timeout"]:
        break
    if q["glb"] not in meshes:
        bv, bf = fit.load_mesh(q["glb"])
        meshes[q["glb"]] = fit.sample_surface(bv, bf, res * 0.5) if len(bf) else bv
    pts = meshes[q["glb"]]
    if not len(pts):
        continue
    m = np.asarray(q["matrix"], dtype=float).reshape(4, 4)
    w = pts @ m[:3, :3].T + m[:3, 3]
    inside = np.all((w >= om.lo) & (w <= om.lo + (np.array(om.shape) - 1) * res), axis=1)
    if not inside.any():
        out.append({"id": q["id"], "minClearanceMm": 1e9, "at": [], "wall": "", "samples": 0})
        continue
    w = w[inside]
    g = (w - om.lo) / res
    signed = om.clearance(w) - ndimage.map_coordinates(depth, g.T, order=1, mode="nearest")
    k = int(np.argmin(signed))
    out.append({"id": q["id"], "minClearanceMm": round(float(signed[k]), 3), "at": [round(float(x), 2) for x in w[k]], "wall": om.owner_at(w[k]), "samples": int(len(w))})
print(json.dumps({"ok": True, "resolution": res, "grid": list(om.shape), "cells": int(np.prod(om.shape)), "answers": out}))
`;

/** The Python to run: PROTOBOARD_PYTHON, else the project's `cad` runtime, else none. */
export function cadPython(root: string): string | undefined {
  if (process.env.PROTOBOARD_PYTHON && existsSync(process.env.PROTOBOARD_PYTHON)) return process.env.PROTOBOARD_PYTHON;
  return projectRuntime(root, "cad")?.python;
}

/**
 * Run the field against `queries`. `fitPy` is ext-enclosure-cad's py folder;
 * `scratch` a folder for the script (the project's `.protoboard/build/`).
 */
export function runVoxel(opts: { python: string; fitPy: string; walls: string; queries: VoxelQuery[]; scratch: string; resolutionMm?: number; maxCells?: number; timeoutS?: number }): Promise<VoxelRun> {
  const t0 = performance.now();
  mkdirSync(opts.scratch, { recursive: true });
  const script = join(opts.scratch, "interference-voxel.py");
  writeFileSync(script, SCRIPT);
  const timeoutS = opts.timeoutS ?? VOXEL_DEFAULTS.timeoutS;
  const req = { fit_py: opts.fitPy, walls: opts.walls, queries: opts.queries, resolution: opts.resolutionMm ?? VOXEL_DEFAULTS.resolutionMm, max_cells: opts.maxCells ?? VOXEL_DEFAULTS.maxCells, timeout: timeoutS };
  return new Promise((resolveRun) => {
    // -I: isolated (no user site, no PYTHON* variables, the script's folder not on sys.path ahead of the stdlib)
    const child = execFile(opts.python, ["-I", script], { timeout: (timeoutS + 30) * 1000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const ms = Math.round(performance.now() - t0);
      if (err) return resolveRun({ ok: false, answers: [], ms, error: (stderr || err.message).trim().split("\n").slice(-3).join(" | ") });
      try {
        const line = stdout.trim().split("\n").pop() ?? "";
        const r = JSON.parse(line) as { resolution: number; grid: number[]; cells: number; answers: VoxelAnswer[] };
        resolveRun({ ok: true, resolutionMm: r.resolution, grid: r.grid, cells: r.cells, answers: r.answers, ms });
      } catch (e) {
        resolveRun({ ok: false, answers: [], ms, error: `unreadable output: ${(e as Error).message}` });
      }
    });
    child.stdin?.end(JSON.stringify(req));
  });
}

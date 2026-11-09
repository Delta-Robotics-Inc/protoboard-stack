/**
 * Place supplied part models' own STEP geometry into a board STEP: the writer here puts a box (the model mesh's
 * bounds) in each model part's product, then OCCT (through the CAD runtime) replaces it with the model, placed in the
 * footprint frame and seated as the scene measured, fused into one solid per part unless `merge` is false.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose, translation, type Affine } from "./math.js";
import type { LoadedModels } from "./models.js";
import { runCadPython } from "./python.js";
import type { Board3d } from "./scene.js";

export interface ComposeResult {
  out: string;
  parts: { occurrence: string; ok: boolean; message?: string; suppliedSolids?: number; solids?: number; note?: string }[];
  seconds: number;
}

export async function composeStepModels(python: string, scene: Board3d, loaded: LoadedModels, baseStep: string, outStep: string, options: { merge?: boolean } = {}): Promise<ComposeResult> {
  const parts: { occurrence: string; model: string; matrix: Affine; merge: boolean; color?: string }[] = [];
  for (const c of scene.components) {
    const p = loaded.placements.get(c.id);
    if (!p || c.body.source !== "model" || !/\.(step|stp)$/i.test(p.ref.path)) continue;
    // the seating fix moved the mesh; move the model the same way
    const matrix = compose(translation([0, 0, c.seating.fixedMm ?? 0]), p.matrix);
    parts.push({ occurrence: c.name, model: p.ref.path, matrix, merge: options.merge ?? true, ...(p.ref.color ? { color: p.ref.color } : {}) });
  }
  const dir = mkdtempSync(join(tmpdir(), "board-3d-compose-"));
  try {
    const jobs = join(dir, "jobs.json");
    writeFileSync(jobs, JSON.stringify({ parts }));
    return await runCadPython<ComposeResult>(python, ["compose", baseStep, jobs, outStep], 1_800_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

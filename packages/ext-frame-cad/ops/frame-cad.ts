import type { OperationFn } from "@protoboardai/core";
import { generateThenExport } from "../lib/alias.ts";
import { PROVIDER, plateBinding, plateModules } from "../lib/params.ts";
import type { PlateTarget } from "../lib/plate.ts";

export { GENERATOR, bindingDiff, python } from "../lib/plate.ts";

/**
 * frame-cad: the `cad` capability's generate and export for every plate
 * module (or the named ones), in one operation. Each module needs a
 * `cad.config.ts` naming @protoboardai/ext-frame-cad; its native design goes to
 * `<dir>/frame-cad/` and its standard outputs to `<dir>/out/` by
 * `cad:generate` and `cad:export` run for each module, each with its own
 * operation record (lib/alias.ts), so the release can trace every `out/`.
 * Returns the new signatures plus the bindings that no longer match
 * (re-bind explicitly with frame-cad-rebind after reviewing them).
 */
export const frameCad: OperationFn = async (ctx) => {
  const p = ctx.project;
  const only = ctx.inputs.module?.split(",").map((s) => s.trim()).filter(Boolean);
  const modules = plateModules(p, only);
  if (!modules.length) return { status: "failed", summary: "no plate modules (local definitions with mechanical metadata plate_thickness_mm) in the project" };
  const targets: PlateTarget[] = [];
  const problems = modules.flatMap((m) => m.problems);
  for (const { def } of modules.filter((m) => !m.problems.length)) {
    const binding = plateBinding(p, def.id);
    if (binding) targets.push({ def, binding });
    else problems.push(`${def.id} has no cad.config.ts naming ${PROVIDER} (or it has a problem; see protoboard capabilities); add one in the module's folder: export default defineCapabilityConfig({ provider: "${PROVIDER}", process: "cut" })`);
  }
  if (problems.length) return { status: "failed", summary: problems[0], data: { problems } };

  const run = await generateThenExport(p, targets.map((t) => t.def.id));
  if (!run.ok) return { status: "failed", summary: run.summary, data: { module: run.module, problems: run.problems ?? [run.summary], steps: run.steps } };
  type Generated = { module: string; features: Record<string, unknown>; rebind: { signatures: unknown[]; frames: unknown[] } };
  const results = targets.map((t) => ({
    ...(run.generated.get(t.def.id)!.data as Generated),
    out: t.binding.out,
    volume_mm3: (run.exported.get(t.def.id)!.data as { volume_mm3?: number }).volume_mm3,
  }));
  const stale = results.reduce((n, r) => n + r.rebind.signatures.length + r.rebind.frames.length, 0);
  return {
    status: "succeeded",
    summary: `${results.map((r) => `${r.module} (${Object.keys(r.features).length} features)`).join(", ")}; ${stale ? `${stale} binding(s) changed: review, then run frame-cad-rebind` : "all bindings still match"}`,
    data: { modules: results, generator: "@protoboardai/ext-frame-cad/py/frame_cad.py", steps: run.steps },
  };
};

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationFn } from "@protoboardai/core";
import { hardwareBinding, hardwareModules } from "../lib/hardware.ts";
import { generateThenExport } from "../lib/alias.ts";
import type { HardwareTarget } from "../lib/hardware-cad.ts";

export { HARDWARE_GENERATOR } from "../lib/hardware-cad.ts";

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

/**
 * hardware-cad: the `cad` capability's generate and export for every
 * mounting-hardware module (screws, nuts, standoffs, spacers), or the named
 * ones, in one operation, as `frame-cad` is for plates. Each module needs a
 * `cad.config.ts` naming @protoboardai/ext-frame-cad in its folder; its
 * parameters go to `<dir>/frame-cad/params.json` and its body to
 * `<dir>/out/` by `cad:generate` and `cad:export` run for each module, each
 * with its own operation record (lib/alias.ts). Returns each body's volume with the volume it
 * replaces (mass = volume × material density, so a change moves the system
 * mass).
 */
export const hardwareCad: OperationFn = async (ctx) => {
  const p = ctx.project;
  const only = ctx.inputs.module?.split(",").map((s) => s.trim()).filter(Boolean);
  const modules = hardwareModules(p, only);
  if (!modules.length) return { status: "failed", summary: "no hardware modules (local definitions tagged fastener and screw, nut, standoff or spacer) in the project" };
  const problems = modules.flatMap((m) => m.problems);
  const targets: HardwareTarget[] = [];
  for (const { def } of modules.filter((m) => !m.problems.length)) {
    const binding = hardwareBinding(p, def.id);
    if (binding) targets.push({ def, binding });
    else problems.push(`${def.id} has no cad.config.ts naming @protoboardai/ext-frame-cad (or it has a problem; see protoboard capabilities); add one in a folder of its own: export default defineCapabilityConfig({ provider: "@protoboardai/ext-frame-cad", module: "${def.id}" })`);
  }
  if (problems.length) return { status: "failed", summary: problems[0], data: { problems } };

  // the volume each body replaces, read before the export empties out/
  const before = new Map(targets.map((t) => [t.def.id, readJson<{ volume_mm3?: number }>(join(p.root, t.binding.out, "body.manifest.json"))?.volume_mm3 ?? null]));
  const run = await generateThenExport(p, targets.map((t) => t.def.id));
  if (!run.ok) return { status: "failed", summary: run.summary, data: { module: run.module, problems: run.problems ?? [run.summary], steps: run.steps } };
  type Generated = { kind: string };
  type Exported = { out: string; toolVersion: string; volume_mm3: number };
  const results = targets.map((t) => {
    const gen = run.generated.get(t.def.id)!.data as Generated;
    const exp = run.exported.get(t.def.id)!.data as Exported;
    return { module: t.def.id, kind: gen.kind, dir: t.binding.dir, out: exp.out, toolVersion: exp.toolVersion, volume_mm3: exp.volume_mm3, previousVolume_mm3: before.get(t.def.id) ?? null };
  });
  const changed = results.filter((r) => r.previousVolume_mm3 !== null && r.previousVolume_mm3 !== r.volume_mm3);
  return {
    status: "succeeded",
    summary: `${results.length} hardware bodies; ${changed.length ? `volume changed for ${changed.map((r) => r.module).join(", ")} (system mass moves)` : "volumes unchanged"}`,
    data: { modules: results, generator: "@protoboardai/ext-frame-cad/py/hardware_cad.py", steps: run.steps },
  };
};

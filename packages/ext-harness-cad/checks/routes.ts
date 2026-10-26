import type { ExtensionCheck, ProjectDiagnostic } from "@protoboardai/core";
import { projectAssembly, wireHarnesses } from "../lib/job.ts";
import { PROVIDER } from "../lib/route.ts";

/**
 * Wire harnesses (cable_build trait) that no `cad.config.ts` binds to a cad
 * provider. A bound harness's route report is its `cad:check`
 * (ext:@protoboardai/ext-harness-cad/cad:check in `protoboard check`, one run
 * per harness): not routed, route older than the model or export older than
 * the route, length fit, the generator's notes, ends that no longer meet
 * their parts.
 */
export const routes: ExtensionCheck = (p) => {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  if (!p.rootDef) return out;
  const seen = new Set<string>();
  for (const inst of wireHarnesses(projectAssembly(p))) {
    const def = inst.def;
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    if (p.capabilities.some((b) => b.capability === "cad" && b.module === def.id)) continue;
    out.push({
      code: "HARNESS_NOT_CONFIGURED",
      severity: "info",
      entity: { kind: "instance", id: inst.path.join("/") },
      message: `${inst.path.join("/")} (${def.id}) is a wire harness with no cad.config.ts; add one naming ${PROVIDER} (e.g. src/harnesses/${def.id}/cad.config.ts with module: "${def.id}") to route it`,
      source: p.definitions.get(def.id)?.origin.source,
    });
  }
  return out;
};

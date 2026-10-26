import type { ExtensionCheck, ProjectDiagnostic } from "@protoboardai/core";
import { PROVIDER, plateBinding, plateModules } from "../lib/params.ts";

/**
 * Plate modules that no `cad.config.ts` binds to this provider. A bound
 * module's frames, stale parameters and stale export are its `cad:check`
 * (ext:@protoboardai/ext-frame-cad/cad:check in `protoboard check`, one run
 * per module); this check only finds the plates that nothing designs yet.
 */
export const frames: ExtensionCheck = (p) => {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  for (const { def } of plateModules(p)) {
    if (plateBinding(p, def.id)) continue;
    const bound = p.capabilities.find((b) => b.capability === "cad" && b.module === def.id);
    if (bound) continue; // its config's own finding (another provider, or a problem) is reported by protoboard/capabilities
    out.push({
      code: "FRAME_CAD_NOT_CONFIGURED",
      severity: "info",
      entity: { kind: "definition", id: def.id },
      message: `${def.id} is a plate module (plate_thickness_mm) with no cad.config.ts; add one in its folder naming ${PROVIDER} to generate its CAD (protoboard run cad:generate --module ${def.id})`,
      source: p.definitions.get(def.id)!.origin.source,
    });
  }
  return out;
};

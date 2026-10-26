import type { ExtensionCheck, ProjectDiagnostic } from "@protoboardai/core";
import { hardwareBinding, hardwareModules } from "../lib/hardware.ts";

/**
 * Mounting-hardware modules (local definitions tagged fastener and screw,
 * nut, standoff or spacer) that no `cad.config.ts` binds to this provider.
 * A bound module's stale sizes and stale export are its `cad:check`
 * (ext:@protoboardai/ext-frame-cad/cad:check in `protoboard check`, one run per
 * module); this check only finds the hardware nothing designs yet.
 */
export const hardware: ExtensionCheck = (p) => {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  for (const { def } of hardwareModules(p)) {
    if (hardwareBinding(p, def.id)) continue;
    if (p.capabilities.some((b) => b.capability === "cad" && b.module === def.id)) continue; // reported by protoboard/capabilities
    if ((def.artifacts ?? []).some((a) => a.role === "body")) continue; // a body from elsewhere (a vendor model)
    out.push({
      code: "HARDWARE_CAD_NOT_CONFIGURED",
      severity: "info",
      entity: { kind: "definition", id: def.id },
      message: `${def.id} is mounting hardware with no body and no cad.config.ts; add one in a folder of its own naming @protoboardai/ext-frame-cad (module: "${def.id}") to generate its nominal body (protoboard run cad:generate --module ${def.id})`,
      source: p.definitions.get(def.id)!.origin.source,
    });
  }
  return out;
};

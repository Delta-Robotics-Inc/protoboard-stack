/**
 * Routed harness geometry (@protoboardai/ext-harness-cad, the `cad` provider
 * of every wire harness here).
 *
 * Each cable has a provider directory, src/harnesses/<harness id>/, holding
 * its cad.config.ts. `protoboard run cad:generate --module <id>` routes it
 * through the assembled model (harness-cad/route.json) and `cad:export`
 * writes its standard outputs, out/body.{glb,step,manifest.json}, in
 * assembly-root coordinates. `routed(def)` (the provider's `routedHarness`)
 * attaches those files to the harness as its artifacts and gives each end
 * interface the frame the route was generated for, so UHD `assemble` places
 * the cable from the part its first end lands on and reports any end that no
 * longer meets its part. It reads only the route, never the exported
 * manifest, so an export does not change the definition it was made from.
 *
 * Until a harness has been routed it simply has no geometry.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { readRoute, routedHarness } from "@protoboardai/ext-harness-cad/artifacts";

export function routed(def: ModuleDef): ModuleDef {
  return routedHarness(def, { dir: `src/harnesses/${def.id}`, route: readRoute(new URL(`./${def.id}/harness-cad/route.json`, import.meta.url)) });
}

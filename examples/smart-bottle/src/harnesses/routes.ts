/**
 * Routed harness geometry (@protoboardai/ext-harness-cad, the `cad` provider
 * of every wire harness here).
 *
 * Each cable has a provider directory, src/harnesses/<harness id>/, holding
 * its cad.config.ts. `protoboard run cad:generate --module <id>` routes it
 * through the assembled model (harness-cad/route.json) and `cad:export`
 * writes its standard outputs, out/body.{glb,step,manifest.json}, in
 * assembly-root coordinates. `routed(def)` attaches those files to the
 * harness as its artifacts and gives each end interface the frame the route
 * was generated for, so UHD `assemble` places the cable from the part its
 * first end lands on and reports any end that no longer meets its part.
 *
 * Until a harness has been exported it simply has no geometry.
 */
import { existsSync, readFileSync } from "node:fs";
import type { GeometryFrame, ModuleDef } from "@deltarobotics/uhd";
import { harnessCadArtifacts } from "@protoboardai/ext-harness-cad/artifacts";

interface RouteManifest {
  toolVersion: string;
  ends: Record<string, { frame: GeometryFrame }>;
  features: Record<string, { area_mm2: number; centroid: [number, number, number] }>;
}

export function routeManifest(id: string): RouteManifest | undefined {
  const file = new URL(`./${id}/out/body.manifest.json`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RouteManifest) : undefined;
}

export function routed(def: ModuleDef): ModuleDef {
  const m = routeManifest(def.id);
  if (!m) return def;
  return {
    ...def,
    interfaces: def.interfaces.map((i) => {
      const end = m.ends[i.id];
      if (!end) return i;
      const f = m.features[i.id];
      return {
        ...i,
        geometry: {
          frame: end.frame,
          ...(f ? { refs: [{ kind: "feature" as const, artifact: "cad_step", name: i.id, signature: { area_mm2: f.area_mm2, centroid: f.centroid } }] } : {}),
        },
      };
    }),
    artifacts: [...(def.artifacts ?? []), ...harnessCadArtifacts({ dir: `src/harnesses/${def.id}`, name: def.id, tool: `ext-harness-cad ${m.toolVersion}` })],
  };
}

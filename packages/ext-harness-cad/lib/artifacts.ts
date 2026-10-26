/**
 * What the `cad` capability writes for a routed wire harness, as UHD
 * artifacts (`@protoboardai/ext-harness-cad/artifacts`). The harness's
 * `cad.config.ts` sits in `dir`, its provider directory
 * (tool-integrations §4):
 *
 *   <dir>/harness-cad/route.json   native design: the route (conductor paths,
 *                                  length fit, bend limits, clearance) found
 *                                  by `protoboard run cad:generate`
 *   <dir>/out/body.step            standard outputs, from `cad:export`:
 *   <dir>/out/body.glb             swept conductors, plug housings and solder
 *   <dir>/out/body.manifest.json   joints (assembly-root coordinates), and the
 *                                  manifest: end frames, lengths, bend radii,
 *                                  clearance, centreline
 *
 * The artifact ids are the ones the rest of the stack reads (cad_step,
 * cad_glb, cad_manifest generated from the body).
 */
import { existsSync, readFileSync } from "node:fs";
import type { ArtifactDef, GeometryFrame, ModuleDef } from "@deltarobotics/uhd";

export const HARNESS_CAD_GENERATOR = "@protoboardai/ext-harness-cad py/harness_cad.py";

/** The generator's version, as its manifests state it (py/harness_cad.py). */
export const HARNESS_CAD_TOOL = "ext-harness-cad 0.1.0";

/** The native folder of this provider in a module's provider directory (`native` in the manifest). */
export const HARNESS_CAD_NATIVE = "harness-cad";

export function harnessCadArtifacts(o: { dir: string; name: string; tool: string }): ArtifactDef[] {
  const out = `${o.dir}/out`;
  const provenance = { generatedFrom: "cad_source", tool: o.tool };
  return [
    {
      id: "cad_source",
      name: `${o.name} route`,
      type: "cad",
      role: "source",
      format: "json",
      filePath: `${o.dir}/${HARNESS_CAD_NATIVE}/route.json`,
      description: `Native design: the route found by ${HARNESS_CAD_GENERATOR} through the assembled model (protoboard run cad:generate): conductor paths, length fit, bend limits, clearance.`,
    },
    {
      id: "cad_step",
      name: `${o.name} routed (STEP)`,
      type: "3d_model",
      role: "body",
      format: "step",
      units: "mm",
      filePath: `${out}/body.step`,
      provenance,
      description: "Swept conductors, plug housings and solder joints in assembly-root coordinates.",
    },
    {
      id: "cad_glb",
      name: `${o.name} routed (GLB)`,
      type: "3d_model",
      role: "body",
      format: "glb",
      units: "m",
      filePath: `${out}/body.glb`,
      provenance: { ...provenance, generatedFrom: "cad_step" },
      description: "Viewer mesh: one node per conductor (coloured insulation), plug housing, solder joint and tinned tip (glTF metres, Y-up).",
    },
    {
      id: "cad_manifest",
      name: `${o.name} route manifest`,
      type: "cad",
      role: "source",
      format: "json",
      filePath: `${out}/body.manifest.json`,
      provenance: { ...provenance, generatedFrom: "cad_step" },
      description: "End frames, modelled and routed length, bend radii, clearance and the route centreline.",
    },
  ];
}

/** What a harness definition takes from its route file (`harness-cad/route.json`, py/harness_cad.py ROUTE_SCHEMA). */
export interface RoutedEnds {
  harness: { ends: { interfaceId: string; frame: GeometryFrame; termination: { kind: string } }[] };
}

/** A harness's route file, if it has been generated. */
export function readRoute(file: string | URL): RoutedEnds | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RoutedEnds) : undefined;
}

/**
 * A wire harness with its routed geometry: each end interface gets the frame
 * the route was generated for, and a feature ref to its termination body
 * (plug housing or solder joints; an integral end has none) in `cad_step`;
 * the harness gets the artifacts the `cad` capability writes. `dir` is the
 * harness's provider directory, project-relative.
 *
 * Everything comes from the route that `cad:generate` writes, never from the
 * outputs `cad:export` writes: a definition read from its own export would
 * change with every export that moved its bodies, leaving the export's
 * record one definition behind until a second, identical export (PB-836).
 * The refs carry no signature: one copied from this export's own manifest
 * would only compare the manifest with itself. UHD still checks that each
 * named feature is in the exported manifest.
 */
export function routedHarness(def: ModuleDef, o: { dir: string; route: RoutedEnds | undefined }): ModuleDef {
  if (!o.route) return def;
  const ends = new Map(o.route.harness.ends.map((e) => [e.interfaceId, e]));
  return {
    ...def,
    interfaces: def.interfaces.map((i) => {
      const end = ends.get(i.id);
      if (!end) return i;
      return {
        ...i,
        geometry: {
          frame: end.frame,
          ...(end.termination.kind !== "integral" ? { refs: [{ kind: "feature" as const, artifact: "cad_step", name: i.id }] } : {}),
        },
      };
    }),
    artifacts: [...(def.artifacts ?? []), ...harnessCadArtifacts({ dir: o.dir, name: def.id, tool: HARNESS_CAD_TOOL })],
  };
}

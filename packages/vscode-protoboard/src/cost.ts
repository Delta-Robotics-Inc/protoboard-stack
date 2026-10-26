/**
 * What the project costs (spec §2.4): the bill of materials is shared with
 * the CLI (`@protoboardai/ext-sourcing/lib/cost.ts`, also `protoboard bom`;
 * the model is `@protoboardai/core/bom`); here it is fed from the build's
 * resolved.json and bundle (model.ts).
 */
import * as shared from "@protoboardai/ext-sourcing/lib/cost.ts";
import type { ProjectIndex } from "./model.js";

export {
  RELEASE_DIR,
  ORDERING_LIST,
  OFFERS_FILE,
  OFFERS_SCHEMA,
  SOURCING_SCHEMA,
  parseCsv,
  compareVersions,
  listReleases,
  readHeldOffers,
  readOrderingList,
  readBomSettings,
  writeBomSettings,
  bomFileProblems,
  costOf,
  money,
  type CostIndex,
  type CostLine,
  type CostModel,
  type HeldOffers,
  type LineKind,
  type ProjectBomOptions,
  type ReleaseInfo,
} from "@protoboardai/ext-sourcing/lib/cost.ts";

/** The bill's view of the build. */
export function costIndex(index: ProjectIndex): shared.CostIndex {
  // the build's own lines say which ordering code and value each placement has (a series passive placed at a value)
  const placed = new Map<string, { mpn?: string; value?: string }>();
  for (const l of (index.resolved as { bom?: { partNumber?: string; value?: string; instances?: string[] }[] }).bom ?? [])
    for (const path of l.instances ?? []) placed.set(path, { ...(l.partNumber ? { mpn: l.partNumber } : {}), ...(l.value ? { value: l.value } : {}) });
  return {
    instances: index.resolved.instances,
    definition: (id) => {
      const def = index.bundleDefs.get(id) as ReturnType<shared.CostIndex["definition"]>;
      const name = index.defs.get(id)?.name ?? def?.name;
      return def || name ? { ...def, ...(name ? { name } : {}) } : undefined;
    },
    // a researched part's CAD config models a bought part; only the project's own designs are made
    capability: (id) => (index.defs.get(id)?.origin.tier === "project-researched" ? undefined : index.capabilities.get(id)?.find((c) => !c.problem)),
    placement: (path) => placed.get(path),
    partStatus: (id) => index.defs.get(id)?.partStatus?.trust,
  };
}

const asIndex = (index: ProjectIndex | shared.CostIndex | undefined): shared.CostIndex | undefined => (index && "resolved" in index ? costIndex(index) : index);

export const designLines = (index: ProjectIndex | shared.CostIndex, project = "") => shared.designLines(asIndex(index)!, project);

/** The project's bill of materials (the design's lines, or a release's or a file's with `options`). */
export const projectBom = (root: string, project: string, index: ProjectIndex | shared.CostIndex | undefined, options?: shared.ProjectBomOptions) => shared.projectBom(root, project, asIndex(index), options);

/** The project's cost: its bill of materials in the Cloud view's terms. */
export const projectCost = (root: string, project: string, index: ProjectIndex | shared.CostIndex | undefined, options?: shared.ProjectBomOptions) => shared.projectCost(root, project, asIndex(index), options);

/**
 * View model: the build-time sidecars the 3D viewer loads instead of plain
 * body GLBs (PB-1173). See sidecar.ts for the pipeline and names.ts for the
 * file convention. Importing this module loads no glTF library; the export
 * step loads glTF-Transform and meshoptimizer when it first runs.
 */
export { VIEW_PIPELINE_VERSION, VIEW_SIDECAR_SCHEMA, isCoarseSourceFile, isViewSidecarFile, viewSidecarPaths, type ViewSidecarPaths } from "./names.js";
export { COARSE_ERROR, MAX_GLB_BYTES, MESH_ORIGIN_ERROR, writeViewSidecar, type ViewSidecarOptions, type ViewSidecarResult } from "./sidecar.js";
export { bodyGlbs, componentsOf, manifestNames, placementCounts, vendorKeyOf, writeProjectViewSidecars, type ProjectViewFile, type ProjectViewOptions, type ProjectViewSummary } from "./project.js";
export { LOOKS, lookForKind, lookForName, partKindOf, type MaterialLook } from "./materials.js";
export type { ViewBounds, ViewComponent, ViewContext, ViewCounts, ViewNode, ViewOwner, ViewSidecarIndex, ViewTier } from "./types.js";

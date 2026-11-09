/**
 * @protoboardai/board-3d: the 3D model of a board and its export. `buildBoard3d` makes the neutral scene (board body,
 * seated component bodies, detail tier, optional copper and silkscreen); `exportBoard3d` writes STEP, STL, 3MF and GLB
 * with a sidecar and images and checks every file. See README.md.
 */
export { buildBoard3d, sceneSolids, bodyCount, exportedComponents, TIERS, DEFAULT_COLORS, type Board3d, type Board3dOptions, type BoardColors, type BodySource, type Component3d, type Finding3d, type HoleInfo, type LayerBody, type ModelMesh, type NamedSolid, type PartOverride, type RenderLayers, type Tier } from "./scene.js";
export { exportBoard3d, FORMATS, type ExportOptions, type ExportReport, type Format } from "./export.js";
export { classify, padGeom, sizeFromName, CHIP_HEIGHTS, type PackageInfo, type PackageKind, type PadGeom } from "./packages.js";
export { parametricBody, PART_COLORS, type BodyInterface, type ParametricBody } from "./bodies.js";
export { measureSeating, type Seating, type SeatingInput } from "./seating.js";
export { extrudeRegion, boxUnion, transformSolid, meshBounds, meshVolume, brepDefects, type Brep, type Mesh, type Solid, type Box3, type Face, type Edge, type Surface, type Curve } from "./brep.js";
export { writeStep, stepNum, stepStr, type StepOptions, type StepResult } from "./writers/step.js";
export { writeStl, writeStlZip, write3mf, sceneMeshes, worldMesh, safeFileName, type WorldMesh } from "./writers/mesh.js";
export { writeGlb, type GlbOptions } from "./writers/glb.js";
export { writeZip, readZip, crc32, type ZipEntry } from "./writers/zip.js";
export { buildSidecar, SIDECAR_SCHEMA, type Sidecar, type SidecarFile, type SidecarInput } from "./sidecar.js";
export { validateFile, readStepText, readStl, read3mf, readGlb, boardIntersections, sceneBounds, expectedSolids, expectedObjects, type Check, type FileValidation, type OcctInspect } from "./validate.js";
export { renderPng, rasterize, encodePng, type Raster, type RenderOptions, type View } from "./render.js";
export { loadModels, modelMatrix, modelSolid, type LoadedModels, type ModelRef, type ModelResolver } from "./models.js";
export { composeStepModels, type ComposeResult } from "./compose.js";
export { findCadPython, runCadPython, PY_SCRIPT } from "./python.js";
export { BOARD_3D_BINDINGS, Export3dInput, Seating3dInput, Inspect3dInput, PartOverrideSchema, type Binding } from "./bindings.js";
export type { Affine, Bounds, Vec2, Vec3 } from "./math.js";

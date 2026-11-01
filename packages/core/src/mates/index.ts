/**
 * Mates (PB-1185): the `protoboard.mate` trait, the `<model>.mates.json`
 * sidecar bound by sha256, the merge rule (trait beats sidecar beats
 * inferred), the validator, heuristic suggestions, and static interference at
 * sequence keyframes. Zero UHD schema change.
 */
export * from "./types.js";
export { DOFS, frameMatrix, gltfDirToUhd, gltfFrameToUhd, gltfPointToUhd, normalizeLimit, transformFrame } from "./frames.js";
export { MAX_SIDECAR_BYTES, drives, frameOfGeometry, matesSidecarPath, mergeMates, readMatesSidecar, sidecarMates, traitMates, type MateContext } from "./read.js";
export { validateMates, type ValidateContext } from "./validate.js";
export { TOLERANCES, fitFace, suggestMates, type CylinderFit, type FaceFit, type PlaneFit, type SuggestBody, type SuggestResult } from "./suggest.js";
export { MAX_BODY_TRIANGLES, MAX_GLB_BYTES, currentViewIndex, readBodyFaces, readBodyMesh, type BodyFaces, type BodyMesh, type FaceGeom } from "./mesh.js";
export { TriBVH, pointTriDist, triTri } from "./bvh.js";
export { linkedPairs, mateDiagnostics, placedBodies, projectMates, suggestProjectMates } from "./project.js";
export { VOXEL_DEFAULTS, cadPython, runVoxel, type VoxelAnswer, type VoxelQuery, type VoxelRun } from "./voxel.js";
export { INTERFERENCE_DEFAULTS, INTERFERENCE_SCHEMA, loadInterferenceBodies, runInterference, testPair, type InterferenceBody, type InterferenceHit, type InterferenceOptions, type InterferenceReport, type KeyframeReport } from "./interference.js";

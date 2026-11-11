/** Assembly sequence (PB-1183): types, generator, patches and the build hook. */
export * from "./types.js";
export { flattenSequence, generateSequence, hardwareKeys, isTurned, placementKey, structureEnd, threadOf, worldFrameOf, type GenerateOptions } from "./generate.js";
export { applyPatches, expandRefs } from "./patch.js";
export { SEQUENCE_FILE, SEQUENCE_GENERATOR, SEQUENCE_PATCH_FILES, buildSequence, defaultSequenceRoot, readSequencePatches, runMateChecks, runSequenceChecks, sequenceLine, writeSequence, type SequenceBuild, type SequenceBuildOptions } from "./project.js";
export { RADIAL, applyRadial, mountingNormal, movingMembers, placeTriangles, projectRadialExplode, radialDirections, type RadialPart, type RadialResult } from "./radial.js";
export { assembleProject, readDisplaySpatial } from "./assemble.js";
export { clampSequenceJoints, holdAtStops } from "./limits.js";
export { applyMatesToSequence } from "./mates.js";
export { KEYFRAME_GAP_MM, jointValuesAt, keyframeAt, poseCore, resolveCore, sequenceKeyframes, type CoreResolved, type Keyframe, type RJoint } from "./keyframes.js";

/** Assembly sequence (PB-1183): types, generator, patches and the build hook. */
export * from "./types.js";
export { flattenSequence, generateSequence, hardwareKeys, isTurned, placementKey, structureEnd, threadOf, worldFrameOf, type GenerateOptions } from "./generate.js";
export { applyPatches, expandRefs } from "./patch.js";
export { SEQUENCE_FILE, SEQUENCE_GENERATOR, SEQUENCE_PATCH_FILES, buildSequence, defaultSequenceRoot, readSequencePatches, runSequenceChecks, sequenceLine, writeSequence, type SequenceBuild } from "./project.js";

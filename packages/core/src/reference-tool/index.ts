/**
 * Reference tools (PB-1191): the `protoboard.reference-tool/v0` registry
 * (types.ts, builtin.ts), its loader and validator (load.ts, validate.ts),
 * and the evidence layout writer (evidence.ts).
 *
 * Export line for W4-D (core/package.json is theirs): `"./reference-tool": "./src/reference-tool/index.ts"`
 * (phase-1/handoffs.md, 2026-11-01, W4-B). Until it lands, the CLI imports this file by relative path.
 */
export * from "./types.js";
export { BUILTIN_REFERENCE_TOOLS } from "./builtin.js";
export { REFERENCE_TOOL_ID, parseReferenceTool, safeRelativePath, validateReferenceTool } from "./validate.js";
export {
  MAX_REFERENCE_TOOL_BYTES,
  PROJECT_REFERENCE_TOOLS_DIR,
  checkModel,
  loadReferenceTools,
  referenceTool,
  type LoadReferenceToolsOptions,
  type LoadedReferenceTool,
  type ReferenceToolProblem,
  type ReferenceToolRegistry,
} from "./load.js";
export {
  MAX_EVIDENCE_FILE_BYTES,
  MANUAL_TOOL,
  checkEvidenceFile,
  copyEvidenceFile,
  evidenceDirName,
  isRunnableFile,
  isoDate,
  parseMeasurement,
  scaleCheck,
  writeReferenceEvidence,
  type EvidenceInput,
  type EvidenceRecord,
  type EvidenceTool,
  type MeasurementInput,
  type ScaleCheck,
} from "./evidence.js";

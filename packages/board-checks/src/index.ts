/**
 * @protoboardai/board-checks: connectivity, design rule checks and the status line of Protoboard's PCB editor,
 * computed headless from the board document, with an optional KiCad DRC cross-check. The contract is
 * docs/specs/pcb-editor/phase1-board-core.md (sections 4.3, 5 and 11).
 */
export { runBoardChecks, createBoardChecks, analyzeBoard, type RunOptions, type BoardCheckResult } from "./run.js";
export { createIncrementalChecks, type IncrementalChecks, type IncrementalUpdate } from "./incremental.js";
export { summarize, type Summary, type Timing, type CheckCounts } from "./summary.js";
export { applyWaivers, splitWaived, waiverFor, waiversOf, type WaivedFinding } from "./waivers.js";
export { CHECKS, coverage, makeFinding, type Analysis } from "./checks.js";
export * from "./connectivity.js";
export { normalizeFills, type FillPolygon, type ZoneFill, type ZoneFillSet, type ZoneFillInput } from "./fills.js";
export { inputHash, isStale, fillsHash, CHECKS_VERSION } from "./hash.js";
export { RuleBook, type Subject, type Violation, type ObjKind } from "./rules.js";
export { buildModel, padShape, padHole, type CheckModel, type CopperItem, type HoleItem } from "./model.js";
export * from "./geom/prims.js";
export * from "./geom/shape.js";
export { GridIndex } from "./geom/grid.js";
export { findKicadCli, kicadCliCandidates, type KicadCli } from "./kicad/cli.js";
export { runKicadDrc, parseKicadDrc, CROSS_CHECK_DRC_ARGS, CROSS_CHECK_DRC_COMMAND, type KicadDrcReport, type KicadViolation, type KicadDrcRun } from "./kicad/drc.js";
export { compareWithKicad, estimateTransform, formatCrossCheck, KICAD_CATEGORY, CATEGORY_NOTES, type CrossCheck, type CrossCheckResult, type CategoryRow, type KicadEntry, type KicadTransform } from "./kicad/compare.js";
export { crossCheckWithKicad, type CrossCheckOptions } from "./kicad/cross-check.js";
export { parseSExpr, readKicadPlacements, type KicadFootprintPlacement } from "./kicad/sexpr.js";

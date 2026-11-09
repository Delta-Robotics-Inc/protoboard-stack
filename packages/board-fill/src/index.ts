/**
 * @protoboardai/board-fill: copper zone fills computed from the board document (contract
 * docs/specs/pcb-editor/phase1-board-core.md, section 4.3: zones are intent, the fill is derived data).
 *
 *   const r = fillZones(snapshot);              // r.fill: protoboard.zone-fill/v1, source "computed"
 *   const v = verifyFill(snapshot, r.fill);     // v.ok, v.violations
 *   const s = staleZones(next, r.fill, r.inputs);
 *   const r2 = refillZones(next, r, event.changed);
 */
export { fillZones, refillZones, fillOrder, writeComputedFill, readFillInputs, parseFillInputs, fillInputsPath, globalInputsHash, polygonsHash, DEFAULT_MAX_ERROR, DEFAULT_MARGIN, FILL_INPUTS_FILE, FILL_INPUTS_SCHEMA } from "./zones.js";
export type { FillZonesOptions, FillZonesResult, FillInputs, FillInputsEntry } from "./zones.js";
export { staleZones, type StaleReason, type StaleZone, type Staleness } from "./stale.js";
export { verifyFill, type FillViolation, type FillViolationKind, type VerifyOptions, type VerifyResult } from "./verify.js";
export { FillRules, DEFAULT_FILL_RULES, type FillRuleDefaults, type FillRuleOptions } from "./rules.js";
export { fillZoneLayer, type FillContext, type ZoneLayerFill, type ZoneLayerStats } from "./fill.js";
export { collectBoardShapes, padShapes, type BoardShapes, type CopperItem } from "./collect.js";
export { clip, ClipError, polygonsArea, ringArea, pointInPolygon, polygonRings, unionRings, type Polygon, type Ring, type Operand, type FillRule } from "./clip.js";
export { grow, growRings } from "./offset.js";
export * as exact from "./shapes.js";
export { SegIndex } from "./segindex.js";

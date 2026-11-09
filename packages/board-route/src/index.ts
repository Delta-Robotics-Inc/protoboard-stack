/**
 * @protoboardai/board-route: the router interface, the orchestrator that turns router runs into scored, verified
 * proposals, and the router adapters (tscircuit's autorouter first, an installed Freerouting as the fallback, and a
 * built-in straight and L router for tests). Routers never change a board: they return operations for the board
 * core, and a proposal is applied only when accepted.
 */
export * from "./types.js";
export { resolveConstraints, netConstraint, commonUnexpressed, DEFAULT_PLAN, DEFAULT_FLOOR, type ResolveOptions } from "./constraints.js";
export { copperModel, copperGap, netIslands, openNetIslands, islandAnchors, missingOf, clearancePairs, basicScorer, copperTotals, type CopperItem, type CopperModel, type Island } from "./connectivity.js";
export { buildJob, netsInScope, lockedIds, pourNets, defaultBudget, boardHash, type JobRequest } from "./job.js";
export { routedToOps, opsTotals, routedProvenance, routerTransaction, type RoutedSegment, type RoutedVia } from "./ops.js";
export {
  routeBoard,
  applyProposal,
  scoreBoard,
  compareScores,
  worseThan,
  lockedFingerprint,
  lockedChanges,
  type RouteRequest,
  type RouteProposal,
  type RouteEvent,
  type StageReport,
  type ProposalStep,
  type DiagnosticReport,
  type DiagnosticNet,
} from "./orchestrator.js";
export { createLocalScoring, changedIds, islandAnchorsOf, type LocalScoring, type LocalScoringDeps, type CheckRunLike, type IncrementalChecksLike, type FillEngineLike } from "./local.js";
export { createBuiltinRouter, BUILTIN_VERSION, type BuiltinOptions } from "./routers/builtin.js";
export { createTscircuitRouter, TSCIRCUIT_AUTOROUTER_PIN, TSCIRCUIT_AUTOROUTER_PACKAGE } from "./routers/tscircuit/adapter.js";
export { jobToSrj, srjTracesToRouted, netOfConnection, connectionName, type SimpleRouteJsonIn, type SrjTrace, type SrjConversion } from "./routers/tscircuit/srj.js";
export { createFreeroutingRouter, freeroutingArgs, javaOptions, type FreeroutingOptions } from "./routers/freerouting/adapter.js";
export { detectFreerouting, installLocations, versionOf, FREEROUTING_ENV, HOW_TO_INSTALL, type FreeroutingInstall, type FreeroutingDetection, type DetectOptions } from "./routers/freerouting/detect.js";
export { jobToDsn, viaPadstackName, parseViaPadstackName, type DsnResult } from "./routers/freerouting/dsn.js";
export { parseSes, resolutionScale, type SesRead } from "./routers/freerouting/ses.js";
export { parseSExpr, child, children, type SNode } from "./routers/freerouting/sexpr.js";

import { createBuiltinRouter } from "./routers/builtin.js";
import { createFreeroutingRouter, type FreeroutingOptions } from "./routers/freerouting/adapter.js";
import { createTscircuitRouter } from "./routers/tscircuit/adapter.js";
import type { Router } from "./types.js";

/** The default order: the tscircuit autorouter, then Freerouting when installed. The built-in router is for tests. */
export function defaultRouters(freerouting: FreeroutingOptions = {}): Router[] {
  return [createTscircuitRouter(), createFreeroutingRouter(freerouting)];
}

export { createBuiltinRouter as builtinRouter };

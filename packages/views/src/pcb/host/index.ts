/**
 * @protoboardai/views/pcb/host: the Node side of the layout screen. A host process (the `protoboard dev` server,
 * the layout dev page's server, the VS Code extension host) is the board service's client and hands pages the
 * board and its derived data as `BoardFeedMessage`s; the CLI's `board check` and `board describe` use the same
 * analysis. Node only; the page side is ../remote.ts.
 */
export {
  analyzeBoard,
  crossCheckSummary,
  importRecordFor,
  importRecordPath,
  loadChecksModule,
  logTail,
  readImportRecord,
  toBoardDerived,
  writeImportRecord,
  IMPORT_RECORD_FILE,
  IMPORT_RECORD_SCHEMA,
  type AnalyzeOptions,
  type BoardAnalysis,
  type BoardCheckResult,
  type CrossCheckResult,
  type ImportRecord,
  type KicadReference,
} from "./analysis.js";
export { BoardFeed, docAtSeq, watchRefusals, type BoardFeedOptions } from "./feed.js";
export { BOARD_ROUTE_PREFIX, createBoardRoutes, entryOf, findBoards, PERSON, type BoardRoutes, type BoardRoutesOptions } from "./routes.js";
export { diagnoseNet, ghostOf, lockedRecords, lockFingerprint, loadFillModule, loadRouteModule, productScorer, proposalView, routerInfo, routeScope, RouteRuns, defaultRouterList, type DiagnoseOptions, type ProposeRun, type RouteMessage, type RunOptions } from "./route.js";
export { HostChecks, rebase, type HostCheckRun } from "./live.js";
export { copperOf, loadEditModule, pagePreview, pageProposal, routeProposalInputs } from "./proposals.js";
export { commitBoardFolder, type CommitResult } from "./git.js";
export { parseBoardRequest } from "../requests.js";
export { applyWaivers, boardWaivers, legacyWaiverMigration, legacyWaivers, readWaivers, unwaiveOps, waiverAddOp, waiverCovers, waiverFor, waiverRule, waiverRuleId, WAIVER_ID_PREFIX, type BoardWaiver } from "../waivers.js";
export { zoneFillsFromEntries } from "../fills.js";
export { describeFinding, describeOpenNet, type FindingText } from "../findings-text.js";
export type { BoardDerived, BoardEntry, BoardFeedMessage, BoardReplyMessage, BoardRequest, CheckSummary, CrossCheckSummary, DiagnosisView, PageActor, PagePause, PageProposal, PageProposalPreview, PageRefusal, PcbFinding, ProposalView, RatsnestPair, RouterInfo } from "../types.js";

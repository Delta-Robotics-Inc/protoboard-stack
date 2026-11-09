/**
 * @protoboardai/views/pcb/host: the Node side of the layout screen. A host process (the `protoboard dev` server,
 * the layout dev page's server, the VS Code extension host) is the board service's client and hands pages the
 * board and its derived data as `BoardFeedMessage`s; the CLI's `board check` and `board describe` use the same
 * analysis. Node only; the page side is ../remote.ts.
 */
export {
  analyzeBoard,
  crossCheckSummary,
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
export { BoardFeed, type BoardFeedOptions } from "./feed.js";
export { BOARD_ROUTE_PREFIX, createBoardRoutes, entryOf, findBoards, type BoardRoutes, type BoardRoutesOptions } from "./routes.js";
export { zoneFillsFromEntries } from "../fills.js";
export type { BoardDerived, BoardEntry, BoardFeedMessage, CheckSummary, CrossCheckSummary, PcbFinding, RatsnestPair } from "../types.js";

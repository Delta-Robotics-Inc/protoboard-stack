/** The result every importer of this package returns: the contract's `ImportResult`, filled in, plus what a host needs. */
import type { BoardDocument, ImportResult, Netlist } from "@protoboardai/board";
import type { DerivedFill } from "./fill.js";
import type { ImportSummary } from "./report.js";

export interface ImportStats {
  footprints: number;
  pads: number;
  /** Track records: segments and arcs. */
  tracks: number;
  arcs: number;
  vias: number;
  zones: number;
  keepouts: number;
  /** Nets in the netlist. */
  nets: number;
  graphics: number;
  texts: number;
  cutouts: number;
  netclasses: number;
  rules: number;
  layers: number;
  /** Polygons in the derived fill. */
  fillPolygons: number;
}

export interface BoardImportResult extends ImportResult {
  document: BoardDocument;
  netlist: Netlist;
  /** Zone fill read from the source (derived data; see fill.ts). */
  fill: DerivedFill;
  /**
   * What was subtracted to center the board, nanometers, in the source's frame turned +Y up: a board point (x, y)
   * is the source point (x + offset.x, y + offset.y). For KiCad, negate that Y and divide by 1e6 for its millimeters.
   */
  offset: { x: number; y: number };
  stats: ImportStats;
  summary: ImportSummary;
  /**
   * Rules and settings of the source that the board's rules cannot express (a KiCad custom rule with a condition
   * the rule model has no term for, a constraint type no check measures), by name. Also in `report`. They are not
   * evaluated, so a cross-check lists them as such and counts nothing from them.
   */
  rulesNotEvaluated?: { name: string; reason: string }[];
  /**
   * Groups of objects the source gives one identity (KiCad pads sharing one UUID, as some exporters write them).
   * KiCad's DRC reports each group as one item; a cross-check folds our findings on such a group into one.
   */
  sharedSourceIds?: string[][];
  /** The importer that ran. */
  importer: string;
  /** Wall time of the import, milliseconds. */
  ms: number;
}

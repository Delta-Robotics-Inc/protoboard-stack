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
  /** The importer that ran. */
  importer: string;
  /** Wall time of the import, milliseconds. */
  ms: number;
}

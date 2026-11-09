/**
 * The cross-check runner: when a KiCad board file for the same board exists and kicad-cli is installed, run
 * KiCad's DRC on a copy and compare. Without KiCad or without the file, the result says the cross-check was not
 * run and why; it never reports agreement it did not measure.
 */
import { existsSync, readFileSync } from "node:fs";
import type { BoardDocument } from "@protoboardai/board";
import type { BoardCheckResult } from "../run.js";
import { findKicadCli, type KicadCli } from "./cli.js";
import { compareWithKicad, estimateTransform, notRun, type CrossCheckResult, type KicadTransform } from "./compare.js";
import { runKicadDrc } from "./drc.js";

export interface CrossCheckOptions {
  /** The KiCad board file of the same board. */
  pcbPath?: string;
  /** The folder copied for kicad-cli (default: the board file's folder). */
  root?: string;
  /** The board document, for estimating the coordinate transform from footprint positions. */
  doc?: BoardDocument;
  /** The importer's transform (KiCad millimeters to document nanometers), when it states one. */
  transform?: { tx: number; ty: number };
  cli?: KicadCli;
  refillZones?: boolean;
  tolerance?: number;
  /** The source's rules the importer could not express (`rulesNotEvaluated` of a KiCad import). */
  notEvaluated?: { name: string; reason: string }[];
  /** Groups of objects the source gives one identity (`sharedSourceIds` of a KiCad import). */
  sharedIds?: string[][];
}

export function crossCheckWithKicad(result: BoardCheckResult, options: CrossCheckOptions): CrossCheckResult {
  if (!options.pcbPath) return notRun("no KiCad board file for this board", result.inputHash);
  if (!existsSync(options.pcbPath)) return notRun(`the KiCad board file does not exist (${options.pcbPath})`, result.inputHash);
  const cli = options.cli ?? findKicadCli();
  if (!cli) return notRun("kicad-cli is not installed (set PROTOBOARD_KICAD_CLI, put it on PATH, or install KiCad)", result.inputHash);
  const run = runKicadDrc(options.pcbPath, { cli, ...(options.root ? { root: options.root } : {}), ...(options.refillZones ? { refillZones: true } : {}) });
  let transform: KicadTransform | undefined = options.transform ? { ...options.transform, source: "given" } : undefined;
  if (!transform && options.doc) transform = estimateTransform(options.doc, readFileSync(options.pcbPath, "utf8"));
  return compareWithKicad(result, run.report, { ...(transform ? { transform } : {}), ...(options.tolerance ? { tolerance: options.tolerance } : {}), ...(options.notEvaluated ? { notEvaluated: options.notEvaluated } : {}), ...(options.doc ? { doc: options.doc } : {}), ...(options.sharedIds ? { sharedIds: options.sharedIds } : {}), command: run.command, durationMs: run.durationMs });
}

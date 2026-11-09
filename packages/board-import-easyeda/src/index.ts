/**
 * @protoboardai/board-import-easyeda: EasyEDA Pro project exports (`.epro2`, file format 3, and `.epro`, file format
 * 2) into the board document (contract docs/specs/pcb-editor/phase1-board-core.md, section 11).
 *
 * ```ts
 * import { easyedaImporter, importEasyEdaPro } from "@protoboardai/board-import-easyeda";
 * const r = importEasyEdaPro(readFileSync("board.epro2"), { pcb: "Main PCB" });
 * r.document; r.netlist; r.report; r.fill; r.offset;
 * ```
 */
import { readFileSync } from "node:fs";
import type { ImportContext, Importer, ImportSource } from "@protoboardai/board";
import { convertProject, IMPORTER_ID, type ConvertOptions, type EasyEdaImportResult } from "./convert.js";
import { listPcbs, readProject } from "./project.js";
import { looksLikeZip } from "./zip.js";

export { convertProject, choosePcb, HANDLING, IMPORTER_ID, UNIT_NM, reverseRing, type ConvertOptions, type EasyEdaImportResult, type Handling } from "./convert.js";
export { FILL_SCHEMA, ringsToPolygons, zoneFillInputHash, type DerivedFill, type FillEntry, type FillPolygon } from "./fill.js";
export { arcCenter, arcPoints, flatten, parseComplex, parseSingle, type PVertex, type Shape } from "./path.js";
export { idParts, listPcbs, parseLog, readProject, records, type SourceDoc, type SourceProject, type SourceRecord } from "./project.js";
export { v2RecordToKeyed } from "./v2.js";
export { looksLikeZip, writeZip, ZipReader } from "./zip.js";

const KINDS = new Set(["epro", "epro2", "easyeda-pro", "easyeda"]);

function bytesOf(source: ImportSource): Uint8Array {
  if (source.bytes) return source.bytes;
  if (source.path) return readFileSync(source.path);
  throw new Error("the EasyEDA Pro importer reads bytes or a path; text is not an EasyEDA Pro export");
}

/** Import an EasyEDA Pro export (bytes of a `.epro2` or `.epro` file). */
export function importEasyEdaPro(bytes: Uint8Array, options: ConvertOptions = {}): EasyEdaImportResult {
  return convertProject(readProject(bytes), options);
}

/** The PCB documents in an export, to choose one with the `pcb` option. */
export const listEasyEdaPcbs = (bytes: Uint8Array) => listPcbs(readProject(bytes));

/** An importer bound to options (for example a PCB to import from a project holding several). */
export function createEasyEdaImporter(options: ConvertOptions = {}): Importer {
  return {
    id: IMPORTER_ID,
    title: "EasyEDA Pro project (.epro2, .epro)",
    accepts(source: ImportSource): boolean {
      if (source.kind && KINDS.has(source.kind.toLowerCase())) return true;
      if (source.path && /\.epro2?$/i.test(source.path)) return true;
      return false;
    },
    async import(source: ImportSource, _ctx: ImportContext): Promise<EasyEdaImportResult> {
      const bytes = bytesOf(source);
      if (!looksLikeZip(bytes)) throw new Error("not an EasyEDA Pro export: the file is not a ZIP archive");
      return importEasyEdaPro(bytes, options);
    },
  };
}

/** The EasyEDA Pro importer (imports the first board's PCB; see `createEasyEdaImporter` to choose another). */
export const easyedaImporter: Importer = createEasyEdaImporter();

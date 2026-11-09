/**
 * @protoboardai/board-import: KiCad boards and Circuit JSON into the board document of the PCB editor
 * (docs/specs/pcb-editor/phase1-board-core.md, section 11), and the board document back to Circuit JSON.
 *
 *   const r = await importBoard({ path: "board.kicad_pcb" });
 *   r.document; r.netlist; r.fill; r.report; r.summary; r.offset;
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { writeBoardDir, writeNetlist, type ImportContext, type Importer, type ImportSource, type WriteResult } from "@protoboardai/board";
import { importCircuitJson, CIRCUIT_JSON_IMPORTER_ID, type CircuitJsonImportOptions } from "./circuit-json/import.js";
import { importKicadPcb, KICAD_IMPORTER_ID, type KicadImportOptions } from "./kicad/board.js";
import { writeDerivedFill } from "./fill.js";
import { loadOptionalImporters } from "./registry.js";
import type { BoardImportResult } from "./types.js";

export { loadOptionalImporters, OPTIONAL_IMPORTER_PACKAGES, type OptionalImporterPackage } from "./registry.js";

export * from "./types.js";
export * from "./fill.js";
export { Reporter, type ImportSummary } from "./report.js";
export { importKicadPcb, KICAD_IMPORTER_ID, type KicadImportOptions } from "./kicad/board.js";
export { mapKicadRules, parseLength, CUSTOM_RULE_PRIORITY, KICAD_VIOLATION_TYPE } from "./kicad/rules.js";
export { kicadCondition, UnsupportedCondition } from "./kicad/condition.js";
export { importCircuitJson, CIRCUIT_JSON_IMPORTER_ID, type CircuitJsonImportOptions } from "./circuit-json/import.js";
export { exportCircuitJson, type CircuitJsonExport } from "./circuit-json/export.js";
export { READ_FIELDS, WRITE_FIELDS, ROUTE_POINT_FIELDS } from "./circuit-json/fields.js";
export { parseSexpr, parseSexprAll, SexprError, type SList, type SNode } from "./sexpr.js";

/** An import source plus the files a KiCad board reads beside it (found next to `path` when not given). */
export interface BoardSource extends ImportSource {
  /** `.kicad_pro` text. */
  project?: string;
  /** `.kicad_dru` text. */
  rules?: string;
  /** The board's name (default: the file name without its extension). */
  name?: string;
}

export interface ImportBoardOptions {
  /** Write the derived fill to the build cache of this board folder (contract section 7). */
  cache?: { projectRoot: string; boardDir: string };
  recenter?: boolean;
  /** Circuit JSON only: provenance of what it imports (default `generated`). */
  provenance?: CircuitJsonImportOptions["provenance"];
}

const textOf = (s: ImportSource): string => {
  if (s.text !== undefined) return s.text;
  if (s.bytes) return new TextDecoder("utf-8").decode(s.bytes);
  if (s.path) return readFileSync(s.path, "utf8");
  throw new Error("an import source needs a path, bytes or text");
};

/** Which importer a source is for: its `kind` hint, its extension, else its first characters. */
export function sourceKind(s: ImportSource): "kicad_pcb" | "circuit-json" | undefined {
  const k = s.kind?.toLowerCase();
  if (k === "kicad_pcb" || k === "kicad") return "kicad_pcb";
  if (k === "circuit-json" || k === "circuit_json" || k === "json") return "circuit-json";
  if (s.path) {
    if (/\.kicad_pcb$/i.test(s.path)) return "kicad_pcb";
    if (/\.json$/i.test(s.path)) return "circuit-json";
  }
  const head = (s.text ?? (s.bytes ? new TextDecoder().decode(s.bytes.subarray(0, 64)) : "")).trimStart().slice(0, 16);
  if (head.startsWith("(kicad_pcb")) return "kicad_pcb";
  if (head.startsWith("[")) return "circuit-json";
  return undefined;
}

/** The file beside a board with another extension, when it exists. */
const beside = (path: string, ext: string): string | undefined => {
  const p = join(dirname(path), `${basename(path, extname(path))}${ext}`);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
};

/** Import a board from a KiCad `.kicad_pcb` or a Circuit JSON file, picking the importer from the source. */
export async function importBoard(source: BoardSource, options: ImportBoardOptions = {}): Promise<BoardImportResult> {
  const kind = sourceKind(source);
  const text = textOf(source);
  const name = source.name ?? (source.path ? basename(source.path).replace(/(\.circuit)?\.(kicad_pcb|json)$/i, "") : undefined);
  let result: BoardImportResult;
  if (kind === "kicad_pcb") {
    const opts: KicadImportOptions = {
      ...(name ? { name } : {}),
      ...(options.recenter !== undefined ? { recenter: options.recenter } : {}),
      project: source.project ?? (source.path ? beside(source.path, ".kicad_pro") : undefined),
      rules: source.rules ?? (source.path ? beside(source.path, ".kicad_dru") : undefined),
    };
    result = importKicadPcb(text, opts);
    if (opts.project === undefined) result.report.push({ level: "info", message: "1 project file: none beside the board; no net classes mapped, and KiCad's default board constraints used (as KiCad does)" });
    if (opts.rules === undefined) result.report.push({ level: "info", message: "1 custom rules file: none beside the board" });
  } else if (kind === "circuit-json") {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Circuit JSON is an array of elements");
    result = importCircuitJson(parsed, { ...(name ? { name } : {}), ...(options.recenter !== undefined ? { recenter: options.recenter } : {}), ...(options.provenance ? { provenance: options.provenance } : {}) });
  } else throw new Error(`no importer for ${source.path ?? "this source"} (a .kicad_pcb or a Circuit JSON array)`);
  if (options.cache) writeDerivedFill(options.cache.projectRoot, options.cache.boardDir, result.fill);
  return result;
}

/** Save an imported board as a board folder: the board files and the netlist (boards without UHD carry one). */
export function saveImportedBoard(dir: string, result: Pick<BoardImportResult, "document" | "netlist">): WriteResult {
  const w = writeBoardDir(dir, result.document);
  writeNetlist(dir, result.netlist);
  return w;
}

/** The KiCad importer as the contract's `Importer`. */
export const kicadImporter: Importer = {
  id: KICAD_IMPORTER_ID,
  title: "KiCad board (.kicad_pcb, KiCad 7 to 10)",
  accepts: (s) => sourceKind(s) === "kicad_pcb",
  import: (s: ImportSource, _ctx: ImportContext) => importBoard({ ...s, kind: "kicad_pcb" }),
};

/** The Circuit JSON importer as the contract's `Importer`. */
export const circuitJsonImporter: Importer = {
  id: CIRCUIT_JSON_IMPORTER_ID,
  title: "Circuit JSON (tscircuit)",
  accepts: (s) => sourceKind(s) === "circuit-json",
  import: (s: ImportSource, _ctx: ImportContext) => importBoard({ ...s, kind: "circuit-json" }),
};

/** The importers this package carries. */
export const IMPORTERS: readonly Importer[] = [kicadImporter, circuitJsonImporter];

/**
 * Every importer available here: this package's (KiCad, Circuit JSON) and those of installed optional importer
 * packages (EasyEDA Pro, `@protoboardai/board-import-easyeda`), in that order, one per id. Hosts such as the CLI's
 * `protoboard board import` load this package and pick the first importer whose `accepts` says yes.
 */
export async function availableImporters(): Promise<Importer[]> {
  const optional = await loadOptionalImporters();
  const ids = new Set(IMPORTERS.map((i) => i.id));
  return [...IMPORTERS, ...optional.filter((i) => !ids.has(i.id))];
}

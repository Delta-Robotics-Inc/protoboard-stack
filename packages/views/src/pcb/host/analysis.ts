/**
 * The derived data a host computes for a board (Node only): the checks (`@protoboardai/board-checks`, loaded when
 * installed) on the board with its zone fill (the core's `protoboard.zone-fill/v1` cache), the KiCad cross-check
 * when the board was imported from a KiCad file and kicad-cli is installed, and the same in the layout screen's
 * plain types (`toBoardDerived`). Shared by `protoboard board check` and `describe`, the dev servers' board feed
 * and the VS Code extension host, so the numbers a person sees and the numbers an agent reads are one computation.
 *
 * The import record (`<derived folder>/import.json`, written by `protoboard board import`) says which source file
 * a board came from and how its coordinates were shifted; the cross-check uses it to find KiCad's file and frame.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { boardBuildDir, findProjectRoot, loadZoneFill, parseZoneFill, type BoardSnapshot, type DerivedZoneFill } from "@protoboardai/board/node";
import type * as ChecksModule from "@protoboardai/board-checks";
import type { BoardDerived, CheckSummary, CrossCheckSummary, PcbFinding, RatsnestPair } from "../types.js";
import type { WaivedFinding } from "../types.js";
import { applyWaivers, boardWaivers } from "../waivers.js";

export type BoardCheckResult = ChecksModule.BoardCheckResult;
export type CrossCheckResult = ChecksModule.CrossCheckResult;
type KicadDrcRun = ChecksModule.KicadDrcRun;

export const IMPORT_RECORD_SCHEMA = "protoboard.board-import/v1";
export const IMPORT_RECORD_FILE = "import.json";

/** What `protoboard board import` records about where a board came from (derived data, never in the board files). */
export interface ImportRecord {
  schema: typeof IMPORT_RECORD_SCHEMA;
  importer: string;
  /** The source file, absolute, as it was imported. */
  source: string;
  /** What the importer subtracted to center the board (nanometers, +Y up): a board point plus this is the source point. */
  offset?: { x: number; y: number };
  /** ISO time of the import. */
  at: string;
  /** Report counts: dropped, approximated, info lines. */
  report?: { dropped: number; approximated: number; info: number };
  /** Source rules the board's rules cannot express (the import's `rulesNotEvaluated`): the cross-check lists KiCad's items under them apart. */
  rulesNotEvaluated?: { name: string; reason: string }[];
  /** Groups of objects the source gives one identity (the import's `sharedSourceIds`): KiCad reports each group once. */
  sharedIds?: string[][];
  /**
   * KiCad files written from this board (`protoboard board export-kicad`), absolute: written in the source's frame (the
   * offset above), and with `sharedIds` true keeping the groups above on one UUID each, so a cross-check against one
   * reads it as it reads the source.
   */
  exports?: { path: string; at: string; sharedIds: boolean }[];
}

/** Whether two paths name one file (case-insensitively on Windows). */
const samePath = (a: string, b: string): boolean => {
  const x = resolve(a);
  const y = resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** How the import record bears on a KiCad file: its source, an export of the board (and whether it keeps the shared identities), or neither. */
export function importRecordFor(record: ImportRecord | undefined, pcbPath: string): { source: boolean; exported: boolean; sharedIds: boolean } | undefined {
  if (!record) return undefined;
  if (samePath(record.source, pcbPath)) return { source: true, exported: false, sharedIds: true };
  const e = record.exports?.find((x) => samePath(x.path, pcbPath));
  return e ? { source: false, exported: true, sharedIds: e.sharedIds } : undefined;
}

export const importRecordPath = (boardDir: string, projectRoot?: string): string => {
  const dir = resolve(boardDir);
  return join(boardBuildDir(projectRoot ?? findProjectRoot(dir), dir), IMPORT_RECORD_FILE);
};

export function writeImportRecord(boardDir: string, record: Omit<ImportRecord, "schema">, projectRoot?: string): string {
  const file = importRecordPath(boardDir, projectRoot);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ schema: IMPORT_RECORD_SCHEMA, ...record }, null, 2) + "\n");
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return file;
}

export function readImportRecord(boardDir: string, projectRoot?: string): ImportRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(importRecordPath(boardDir, projectRoot), "utf8")) as Partial<ImportRecord>;
    return r.schema === IMPORT_RECORD_SCHEMA && typeof r.source === "string" && typeof r.importer === "string" ? (r as ImportRecord) : undefined;
  } catch {
    return undefined;
  }
}

let checksModule: Promise<typeof ChecksModule | undefined> | undefined;
/** The checks package, when it is installed (undefined otherwise; the reason is not an error). */
export function loadChecksModule(): Promise<typeof ChecksModule | undefined> {
  checksModule ??= import("@protoboardai/board-checks").then(
    (m) => m as typeof ChecksModule,
    () => undefined,
  );
  return checksModule;
}

/** KiCad's DRC of a source file, run once and compared against each new result of ours (the file does not change when the board does). */
export interface KicadReference {
  pcbPath: string;
  run?: KicadDrcRun;
  /** Why there is no run. */
  reason?: string;
  transform?: { tx: number; ty: number };
  ms?: number;
}

export interface AnalyzeOptions {
  projectRoot?: string;
  /** The zone fill to check with; DEFAULT the board's cache (`zone-fill.json`); false: none. */
  fill?: DerivedZoneFill | false;
  /** `auto` (DEFAULT): cross-check when the import record names a KiCad file and kicad-cli is found; false: never. */
  crossCheck?: "auto" | boolean;
  /** A KiCad board file to cross-check against (instead of the import record's source). */
  kicadPcb?: string;
  /** The folder kicad-cli's run copies (DEFAULT the board file's folder; it must hold the project and rule files). */
  kicadRoot?: string;
  /** KiCad's run from an earlier analysis of the same source (hosts keep it). */
  kicad?: KicadReference;
  /**
   * The checks' result for this snapshot, already computed (a host's incremental checks or the service's live
   * checks): used as it is instead of a new run; the cross-check still runs on it.
   */
  result?: BoardCheckResult;
}

export interface BoardAnalysis {
  /** False when the checks package is not installed (`reason` says so). */
  available: boolean;
  reason?: string;
  result?: BoardCheckResult;
  crossCheck?: CrossCheckResult;
  /** The KiCad run behind the cross-check, for the host to reuse. */
  kicad?: KicadReference;
  fill?: { fill: DerivedZoneFill; current: boolean; path?: string };
  importRecord?: ImportRecord;
  ms: { checks?: number; kicad?: number };
}

/** Run the checks (and the cross-check) on a snapshot of the board in `dir` (or an in-memory board: no dir). */
export async function analyzeBoard(snapshot: BoardSnapshot, dir: string | undefined, options: AnalyzeOptions = {}): Promise<BoardAnalysis> {
  const mod = await loadChecksModule();
  const root = dir ? (options.projectRoot ?? findProjectRoot(resolve(dir))) : undefined;
  let fill: BoardAnalysis["fill"];
  if (options.fill) fill = { fill: parseZoneFill(options.fill), current: true };
  else if (options.fill !== false && dir) {
    const f = loadZoneFill(resolve(dir), snapshot.doc, root);
    if (f) fill = f;
  }
  const importRecord = dir ? readImportRecord(dir, root) : undefined;
  if (!mod) return { available: false, reason: "the board checks are not installed (package @protoboardai/board-checks)", ...(fill ? { fill } : {}), ...(importRecord ? { importRecord } : {}), ms: {} };
  const t0 = performance.now();
  const result = options.result ?? mod.runBoardChecks(snapshot, fill ? { fills: fill.fill } : {});
  const ms: BoardAnalysis["ms"] = options.result ? {} : { checks: Math.round(performance.now() - t0) };
  const out: BoardAnalysis = { available: true, result, ...(fill ? { fill } : {}), ...(importRecord ? { importRecord } : {}), ms };
  if (options.crossCheck === false) return out;
  const pcbPath = options.kicadPcb ?? options.kicad?.pcbPath ?? (importRecord && /\.kicad_pcb$/i.test(importRecord.source) ? importRecord.source : undefined);
  if (!pcbPath) {
    if (options.crossCheck === true) out.crossCheck = { ran: false, reason: "no KiCad board file is known for this board (import it from one, or give --kicad <file>)", inputHash: result.inputHash };
    return out;
  }
  let kicad = options.kicad && options.kicad.pcbPath === pcbPath ? options.kicad : undefined;
  if (!kicad) {
    // the source and the board's own exports are in one frame: the import record's offset
    kicad = { pcbPath, ...(importRecord?.offset && importRecordFor(importRecord, pcbPath) ? { transform: { tx: -importRecord.offset.x, ty: -importRecord.offset.y } } : {}) };
    if (!existsSync(pcbPath)) kicad.reason = `the KiCad board file is not there any more (${pcbPath})`;
    else {
      const cli = mod.findKicadCli();
      if (!cli) kicad.reason = "kicad-cli is not installed (set PROTOBOARD_KICAD_CLI, put it on PATH, or install KiCad)";
      else {
        const t = performance.now();
        try {
          kicad.run = mod.runKicadDrc(pcbPath, { cli, ...(options.kicadRoot ? { root: options.kicadRoot } : {}) });
        } catch (e) {
          kicad.reason = `KiCad's DRC failed: ${(e as Error).message.split("\n")[0]}`;
        }
        kicad.ms = Math.round(performance.now() - t);
      }
    }
  }
  out.kicad = kicad;
  if (kicad.ms !== undefined) ms.kicad = kicad.ms;
  if (!kicad.run) {
    out.crossCheck = { ran: false, reason: kicad.reason ?? "KiCad's DRC did not run", inputHash: result.inputHash };
    return out;
  }
  const transform = kicad.transform ? { ...kicad.transform, source: "given" as const } : mod.estimateTransform(snapshot.doc, readFileSync(pcbPath, "utf8"));
  // like with like (board-checks README, "KiCad cross-check"): the rules the import could not express and the objects
  // the source gives one identity come from the import record when the record is for this source file, or for a file
  // exported from the board (an export holds none of the rules the import could not express; it keeps the shared
  // identities unless it was written with every object on its own UUID)
  const bears = importRecordFor(importRecord, pcbPath);
  const fromImport = bears ? { rulesNotEvaluated: importRecord!.rulesNotEvaluated, sharedIds: bears.sharedIds ? importRecord!.sharedIds : undefined } : undefined;
  out.crossCheck = mod.compareWithKicad(result, kicad.run.report, {
    ...(transform ? { transform } : {}),
    command: kicad.run.command,
    durationMs: kicad.run.durationMs,
    doc: snapshot.doc,
    ...(fromImport?.rulesNotEvaluated ? { notEvaluated: fromImport.rulesNotEvaluated } : {}),
    ...(fromImport?.sharedIds ? { sharedIds: fromImport.sharedIds } : {}),
  });
  return out;
}

/**
 * KiCad beside ours for the status line: the comparable counts on both sides (like with like), each difference among
 * them named, and apart from them what only we check, what only KiCad checks, and the rules the import could not
 * express (KiCad's items under them are counted nowhere).
 */
export function crossCheckSummary(c: CrossCheckResult, seq?: number): CrossCheckSummary {
  if (!c.ran) return { ran: false, tool: "KiCad", reason: c.reason };
  const tool = `KiCad${c.kicad.version ? ` ${c.kicad.version}` : ""}`;
  const k = c.comparable;
  const parts: string[] = [];
  for (const key of ["unconnected", "errors", "warnings"] as const) if (k.ours[key] !== k.kicad[key]) parts.push(`${key}: ours ${k.ours[key]}, KiCad ${k.kicad[key]}`);
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((x, y) => y[1] - x[1])
      .map(([t, n]) => `${t} ${n}`);
  return {
    ran: true,
    tool,
    unconnected: k.kicad.unconnected,
    errors: k.kicad.errors,
    warnings: k.kicad.warnings,
    ours: { unconnected: k.ours.unconnected, errors: k.ours.errors, warnings: k.ours.warnings },
    oursOnly: { count: c.oursOnlyCategories.count, what: top(c.oursOnlyCategories.byCheck) },
    kicadOnly: { count: c.kicadOnlyCategories.count, what: top(c.kicadOnlyCategories.byType) },
    notEvaluated: { rules: c.notEvaluated.rules.length, kicadItems: c.notEvaluated.kicadItems.length, what: c.notEvaluated.rules.map((r) => r.name) },
    raw: { ours: { ...c.totals.ours }, kicad: { unconnected: c.totals.kicad.unconnected, errors: c.totals.kicad.errors, warnings: c.totals.kicad.warnings } },
    ...(parts.length ? { difference: parts.join("; ") } : {}),
    ...(c.differences.length ? { differences: c.differences } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };
}

const LOG_FIELDS_DROPPED = { ops: [], inverse: [], forward: [] };
/** The tail of a log for a page: the last `n` entries without their operations (a page draws labels and ids). */
export function logTail<T extends { ops: unknown[]; inverse: unknown[]; forward: unknown[] }>(log: readonly T[], n = 100): T[] {
  return log.slice(-n).map((e) => ({ ...e, ...LOG_FIELDS_DROPPED }));
}

/** The analysis in the layout screen's types. */
export function toBoardDerived(snapshot: BoardSnapshot, a: BoardAnalysis, options: { at?: string; crossCheckSeq?: number } = {}): BoardDerived {
  const notes: string[] = [];
  const fills = a.fill?.fill.fills ?? [];
  if (a.fill && !a.fill.current) notes.push(`the zone fill (${a.fill.fill.source}) was made for other zones than the board has now: it is drawn and checked as it is, and is out of date`);
  if (!a.fill && snapshot.doc.records.size && [...snapshot.doc.records.values()].some((r) => r.kind === "zone")) notes.push("no zone fill is known for this board: zones are drawn as outlines and connect nothing in the checks");
  if (!a.available || !a.result) {
    if (a.reason) notes.push(a.reason);
    return { epoch: snapshot.epoch, seq: snapshot.seq, checks: { ran: false, ...(a.reason ? { reason: a.reason } : {}) }, findings: [], ratsnest: [], fills, ...(a.fill ? { fill: { source: a.fill.fill.source, current: a.fill.current } } : {}), ...(notes.length ? { notes } : {}) };
  }
  const r = a.result;
  // waivers (a person's "not a problem", ../waivers.ts): left out of the findings and the counts, listed apart. The
  // checks leave waiver records out themselves (`result.waived`, already out of the counts); what they did not (the
  // older rules entries, or checks that predate waiver records) is left out here and out of the counts
  const waivers = boardWaivers(snapshot.doc);
  const byChecks: WaivedFinding[] = ((r as { waived?: { finding: unknown; waiver: string }[] }).waived ?? []).map((x) => {
    const w = waivers.find((y) => y.id === x.waiver);
    return { finding: x.finding as PcbFinding, rule: x.waiver, reason: w?.reason ?? "", ...(w?.by ? { by: w.by } : {}), ...(w?.at ? { at: w.at } : {}) };
  });
  const { open, waived: here } = applyWaivers(r.findings as PcbFinding[], waivers);
  const waived = [...byChecks, ...here];
  const waivedUnconnected = here.filter((w) => w.finding.check === "unconnected").length;
  const waivedErrors = here.filter((w) => w.finding.check !== "unconnected" && w.finding.severity === "error").length;
  const waivedWarnings = here.filter((w) => w.finding.check !== "unconnected" && w.finding.severity === "warning").length;
  const waivedLinks = new Set(waived.filter((w) => w.finding.check === "unconnected").map((w) => w.finding.objects.join("|")));
  const ratsnest: RatsnestPair[] = r.connectivity.links.map((l) => ({ net: l.net, a: { x: l.from.x, y: l.from.y }, b: { x: l.to.x, y: l.to.y }, from: l.from.object, to: l.to.object }));
  const checks: CheckSummary = {
    ran: true,
    ...(options.at ? { at: options.at } : {}),
    ms: r.summary.timing?.totalMs ?? a.ms.checks ?? 0,
    seq: snapshot.seq,
    unconnected: r.summary.unconnected - waivedUnconnected,
    errors: r.summary.errors - waivedErrors,
    warnings: r.summary.warnings - waivedWarnings,
    ...(r.summary.incomplete ? { incomplete: true } : {}),
    ...(r.summary.caveats.length || waived.length ? { caveats: [...r.summary.caveats, ...(waived.length ? [`${waived.length} finding(s) waived as not a problem, with a reason (Checks tab)`] : [])] } : {}),
    ...(a.crossCheck ? { crossCheck: crossCheckSummary(a.crossCheck, options.crossCheckSeq) } : {}),
  };
  return {
    epoch: snapshot.epoch,
    seq: snapshot.seq,
    checks,
    findings: open,
    ratsnest: waivedLinks.size ? ratsnest.filter((p) => !waivedLinks.has([p.from, p.to].filter(Boolean).sort().join("|"))) : ratsnest,
    fills,
    ...(a.fill ? { fill: { source: a.fill.fill.source, current: a.fill.current } } : {}),
    ...(notes.length ? { notes } : {}),
    ...(waived.length ? { waived } : {}),
  };
}

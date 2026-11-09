/**
 * `protoboard board export-kicad <dir> <out.kicad_pcb>`: the board as a KiCad board (`@protoboardai/board-import`'s
 * `exportKicadBoard`), written as the `.kicad_pcb`, `.kicad_pro` and `.kicad_dru` beside each other, with the
 * exporter's report. Coordinates go through the board's import record offset when it has one, so
 * `protoboard board check <dir> --kicad <out.kicad_pcb>` cross-checks the export as it would the source; the zone
 * fill is the board's cached fill (`zone-fill.json`). Objects the source gave one KiCad UUID (the import record's
 * `sharedIds`) share one again unless `--unique-ids`, and the export is noted in the import record (`exports`) so the
 * cross-check reads it as it reads the source. It writes those three files and that note; the board is not changed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as ImportModule from "@protoboardai/board-import";
import type * as HostModule from "@protoboardai/views/pcb/host";
import { connectBoard, findProjectRoot, loadZoneFill, toMm } from "@protoboardai/board/node";

/** board-import by name (once linked as a workspace), else from this repository's source tree. */
async function loadBoardImport(): Promise<typeof ImportModule | undefined> {
  try {
    return (await import("@protoboardai/board-import")) as typeof ImportModule;
  } catch {
    const file = fileURLToPath(new URL("../../board-import/src/index.ts", import.meta.url));
    if (!existsSync(file)) return undefined;
    return (await import(pathToFileURL(file).href)) as typeof ImportModule;
  }
}

export interface ExportKicadOutcome {
  status: "written";
  dir: string;
  files: { pcb: string; pro: string; dru: string };
  stats: ImportModule.KicadExport["stats"];
  /** What a board point is shifted by (nanometers, +Y up) and where that came from. */
  offset: { x: number; y: number } | null;
  offsetFrom: "import record" | "none";
  fill: { path: string; current: boolean; source: string; polygons: number } | null;
  /** Objects the source gave one UUID: `kept` sharing one again, `own UUIDs` (--unique-ids), or `none` in the import record. */
  sharedIds: "kept" | "own UUIDs" | "none";
  /** The import record the export was noted in (for `board check --kicad <export>`), when the board has one. */
  importRecord: string | null;
  levels: { dropped: number; approximated: number; info: number };
  report: ImportModule.KicadExportReportItem[];
  ms: number;
}

export type ExportKicadResult = { status: "not-available"; reason: string } | ExportKicadOutcome;

/** Export the board in `dir` to `out` (a `.kicad_pcb` path; the `.kicad_pro` and `.kicad_dru` go beside it). */
export async function boardExportKicad(dir: string, out: string, host: typeof HostModule | undefined, options: { uniqueIds?: boolean } = {}): Promise<ExportKicadResult> {
  const t0 = performance.now();
  if (!/\.kicad_pcb$/i.test(out)) throw new Error(`the output is a .kicad_pcb file (got ${basename(out)})`);
  if (!existsSync(join(dir, "board.jsonl"))) throw new Error(`${dir} is not a board folder (no board.jsonl)`);
  const mod = await loadBoardImport();
  if (!mod || typeof mod.exportKicadBoard !== "function") return { status: "not-available", reason: "the KiCad exporter is not installed (package board-import)" };
  const client = await connectBoard(dir, { journal: false });
  let snapshot: Awaited<ReturnType<typeof client.snapshot>>;
  try {
    snapshot = await client.snapshot();
  } finally {
    await client.close();
  }
  const root = findProjectRoot(resolve(dir));
  const record = host?.readImportRecord(dir, root);
  const fill = loadZoneFill(resolve(dir), snapshot.doc, root);
  const base = basename(out).replace(/\.kicad_pcb$/i, "");
  const ex = mod.exportKicadBoard(snapshot.doc, {
    ...(record?.offset ? { offset: record.offset } : {}),
    ...(fill ? { fills: fill.fill } : {}),
    name: base,
    ...(record?.rulesNotEvaluated?.length ? { notEvaluated: record.rulesNotEvaluated } : {}),
    ...(record?.sharedIds?.length ? { sharedIds: record.sharedIds, keepSharedIds: !options.uniqueIds } : {}),
  });
  const report = [...ex.report];
  if (fill && !fill.current) report.unshift({ level: "approximated", message: `1 zone fill: the board's fill (${fill.fill.source}) was made for other zones than the board has now; it is written as it is, out of date (KiCad refills with kicad-cli pcb drc --refill-zones)`, count: 1 });
  mkdirSync(dirname(out), { recursive: true });
  const files = { pcb: out, pro: join(dirname(out), `${base}.kicad_pro`), dru: join(dirname(out), `${base}.kicad_dru`) };
  writeFileSync(files.pcb, ex.pcb);
  writeFileSync(files.pro, ex.pro);
  // always written: a stale rules file left beside the board would be read by KiCad
  writeFileSync(files.dru, ex.dru ?? "(version 1)\n# No custom rules: the board's rules are all board setup and net class values (in the .kicad_pro).\n");
  // the import record notes the export: `board check --kicad <export>` then reads it in the source's frame, folding
  // the shared identities when the export keeps them
  let recorded: string | null = null;
  if (host && record) {
    const sharedIds = !!record.sharedIds?.length && !options.uniqueIds;
    const { schema: _schema, ...rest } = record;
    const exports = [...(record.exports ?? []).filter((e) => !samePath(e.path, out)), { path: resolve(out), at: new Date().toISOString(), sharedIds }];
    recorded = host.writeImportRecord(dir, { ...rest, exports }, root);
  }
  const levels = { dropped: 0, approximated: 0, info: 0 };
  for (const r of report) levels[r.level]++;
  return {
    status: "written",
    dir,
    files,
    stats: ex.stats,
    offset: record?.offset ?? null,
    offsetFrom: record?.offset ? "import record" : "none",
    fill: fill ? { path: fill.path, current: fill.current, source: fill.fill.source, polygons: fill.fill.fills.reduce((n, f) => n + f.polygons.length, 0) } : null,
    sharedIds: record?.sharedIds?.length ? (options.uniqueIds ? "own UUIDs" : "kept") : "none",
    importRecord: recorded,
    levels,
    report,
    ms: Math.round(performance.now() - t0),
  };
}

/** Whether two paths name one file (case-insensitively on Windows). */
const samePath = (a: string, b: string) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

const mm = (nm: number) => `${+toMm(nm).toFixed(6)} mm`;

/** The outcome for a person. */
export function exportKicadText(r: ExportKicadOutcome): string {
  const s = r.stats;
  return [
    `WRITTEN  ${r.dir} -> ${r.files.pcb}`,
    `  files: ${r.files.pcb}, ${r.files.pro}, ${r.files.dru}`,
    `  board: ${s.footprints} footprints, ${s.pads} pads, ${s.tracks} tracks (${s.arcs} arcs), ${s.vias} vias, ${s.zones} zones, ${s.ruleAreas} rule areas, ${s.graphics} graphics, ${s.texts} texts, ${s.nets} nets, ${s.netclasses} net classes, ${s.customRules} custom rules`,
    r.offset ? `  offset: the import record's: a board point plus (${mm(r.offset.x)}, ${mm(r.offset.y)}) is the KiCad point, Y turned down` : "  offset: no import record; the board's origin is placed at (150, 100) mm in KiCad",
    r.sharedIds === "none" ? "" : `  shared identities: ${r.sharedIds === "kept" ? "objects the source gave one UUID share one again (KiCad reports each group once)" : "every object has its own UUID (--unique-ids)"}`,
    r.importRecord ? `  noted in the import record: ${r.importRecord}` : "",
    r.fill ? `  zone fill: ${r.fill.polygons} polygon(s) from ${r.fill.path} (${r.fill.source}${r.fill.current ? "" : ", out of date"})` : "  zone fill: none cached; zones are written unfilled (kicad-cli pcb drc --refill-zones fills them)",
    `  report: ${r.levels.dropped} dropped, ${r.levels.approximated} approximated, ${r.levels.info} info line(s)`,
    ...r.report.map((x) => `  ${x.level.toUpperCase()} ${x.message}`),
    `  cross-check it: protoboard board check ${r.dir} --kicad ${r.files.pcb}`,
    `  took ${r.ms} ms`,
  ]
    .filter(Boolean)
    .join("\n");
}

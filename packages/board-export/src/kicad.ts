/**
 * Steps that run KiCad's command line program when it is installed (found by `@protoboardai/board-checks`): IPC-2581
 * and ODB++ exports for fabs that take them (CircuitHub), and a cross-check of our Gerbers and drill files against
 * kicad-cli's own export of the same board. KiCad is never bundled or downloaded; it is run as a separate program on a
 * copy of the board in the system's temporary folder, never on the board in place.
 *
 * These need a KiCad board file that matches the board document. The board document has no KiCad writer yet (no
 * exporter in `@protoboardai/board-import`), so a step runs only when the caller names the `.kicad_pcb` the board was
 * imported from and that file still imports to the same document; otherwise it reports "needs KiCad" and why.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { serializeDocument, type BoardDocument } from "@protoboardai/board";
import { findKicadCli, type KicadCli } from "@protoboardai/board-checks";
import { readExcellon } from "./drill.js";
import { countObjects, readGerber, type GerberRead } from "./gerber/read.js";

export interface KicadSource {
  /** The `.kicad_pcb` the board was imported from. */
  board?: string;
  /** A kicad-cli path (default: found on PATH or in the standard install folders). */
  cli?: string;
}

export interface KicadAvailability {
  ok: boolean;
  cli?: KicadCli;
  board?: string;
  /** Why a KiCad step cannot run, in plain words. */
  reason?: string;
}

/** Whether KiCad steps can run for this board: kicad-cli found, and a KiCad board file that imports to the same document. */
export async function kicadAvailability(doc: BoardDocument, source: KicadSource | undefined): Promise<KicadAvailability> {
  const cli = source?.cli ? { path: source.cli, version: "?", from: "env" as const } : findKicadCli();
  if (!cli) return { ok: false, reason: "needs KiCad: kicad-cli is not installed (or not found on PATH or in the standard install folders)" };
  if (!source?.board) return { ok: false, cli, reason: "needs KiCad: the board document has no KiCad writer yet, and no KiCad board file it was imported from was named" };
  if (!existsSync(source.board)) return { ok: false, cli, reason: `needs KiCad: the named KiCad board file does not exist` };
  try {
    const { importBoard } = await import("@protoboardai/board-import");
    const r = await importBoard({ path: source.board });
    const a = serializeDocument(doc);
    const b = serializeDocument(r.document);
    const same = Object.keys(a).every((k) => a[k as keyof typeof a] === b[k as keyof typeof b]);
    if (!same) return { ok: false, cli, board: source.board, reason: "needs KiCad: the board was edited since it was imported from the named KiCad file, so a KiCad export of that file would not match it (no KiCad writer for the board document yet)" };
  } catch (e) {
    return { ok: false, cli, board: source.board, reason: `needs KiCad: the named KiCad file could not be imported (${(e as Error).message.slice(0, 120)})` };
  }
  return { ok: true, cli, board: source.board };
}

/** Copy a KiCad board (and its project and rules files) to a new temporary folder. */
function scratchCopy(board: string): { dir: string; pcb: string } {
  const dir = mkdtempSync(join(tmpdir(), "pb-board-export-"));
  const base = basename(board, extname(board));
  for (const ext of [".kicad_pcb", ".kicad_pro", ".kicad_dru"]) {
    const src = join(dirname(board), `${base}${ext}`);
    if (existsSync(src)) copyFileSync(src, join(dir, `${base}${ext}`));
  }
  return { dir, pcb: join(dir, `${base}.kicad_pcb`) };
}

function run(cli: KicadCli, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cli.path, args, { encoding: "utf8", windowsHide: true, timeout: 300_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Export IPC-2581 (revision C, millimeters) or ODB++ (zip) with kicad-cli; returns the file's bytes. */
export function kicadExport(av: KicadAvailability, kind: "ipc2581" | "odb"): { ok: boolean; bytes?: Uint8Array; message: string } {
  if (!av.ok || !av.cli || !av.board) return { ok: false, message: av.reason ?? "needs KiCad" };
  const s = scratchCopy(av.board);
  try {
    const out = join(s.dir, kind === "ipc2581" ? "board.xml" : "board-odb.zip");
    const args = kind === "ipc2581" ? ["pcb", "export", "ipc2581", "--version", "C", "--units", "mm", "-o", out, s.pcb] : ["pcb", "export", "odb", "--compression", "zip", "-o", out, s.pcb];
    const r = run(av.cli, args);
    if (!r.ok || !existsSync(out)) return { ok: false, message: `kicad-cli ${kind} failed: ${r.out.slice(0, 300)}` };
    return { ok: true, bytes: new Uint8Array(readFileSync(out)), message: `written by kicad-cli ${av.cli.version} from the KiCad board the document was imported from` };
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
}

export interface CrossRow {
  fileFunction: string;
  ours?: ReturnType<typeof countObjects>;
  kicad?: ReturnType<typeof countObjects>;
  /** Why the counts may differ, when they do. */
  note?: string;
}

export interface CrossCheck {
  ok: boolean;
  message: string;
  rows: CrossRow[];
  drill?: { ours: { holes: number; sizes: number[] }; kicad: { holes: number; sizes: number[] } };
}

/** KiCad's reasons, by layer kind, why its object counts differ from ours though the image is the same. */
const WHY: Record<string, string> = {
  Legend: "text is drawn in different stroke fonts (KiCad's own versus the stack's), so stroke counts differ",
  Copper: "KiCad splits zone fill into its own polygons and may draw some pads as regions",
  Soldermask: "KiCad may merge openings or draw custom pads as regions",
  Paste: "KiCad may draw custom pads as regions",
  Profile: "KiCad draws the outline from its own edge segments",
};

/** Export Gerbers and drill files with kicad-cli from the same board and compare object counts with ours, by file function. */
export function kicadCrossCheck(av: KicadAvailability, ours: { fileFunction: string; read: GerberRead }[], oursHoles: { holes: number; sizes: number[] }): CrossCheck {
  if (!av.ok || !av.cli || !av.board) return { ok: false, message: av.reason ?? "needs KiCad", rows: [] };
  const s = scratchCopy(av.board);
  try {
    const gdir = join(s.dir, "gerbers");
    const g = run(av.cli, ["pcb", "export", "gerbers", "--no-protel-ext", "-o", `${gdir}/`, s.pcb]);
    if (!g.ok) return { ok: false, message: `kicad-cli gerbers failed: ${g.out.slice(0, 300)}`, rows: [] };
    const ddir = join(s.dir, "drill");
    const d = run(av.cli, ["pcb", "export", "drill", "--excellon-separate-th", "--excellon-oval-format", "route", "-o", `${ddir}/`, s.pcb]);
    const theirs = new Map<string, GerberRead>();
    for (const f of readdirSync(gdir)) {
      if (!/\.gbr$/i.test(f)) continue;
      const r = readGerber(readFileSync(join(gdir, f), "utf8"));
      const ff = (r.fileAttrs[".FileFunction"] ?? []).join(",");
      if (ff) theirs.set(ff, r);
    }
    const rows: CrossRow[] = [];
    const seen = new Set<string>();
    for (const o of ours) {
      seen.add(o.fileFunction);
      const t = theirs.get(o.fileFunction);
      const a = countObjects(o.read);
      const b = t ? countObjects(t) : undefined;
      const same = b && a.flashes === b.flashes && a.draws + a.arcs === b.draws + b.arcs && a.regions === b.regions;
      rows.push({ fileFunction: o.fileFunction, ours: a, ...(b ? { kicad: b } : {}), ...(same ? {} : { note: b ? WHY[o.fileFunction.split(",")[0]] ?? "counts differ" : "KiCad wrote no such layer (empty layers are skipped)" }) });
    }
    for (const [ff, t] of theirs) if (!seen.has(ff)) rows.push({ fileFunction: ff, kicad: countObjects(t), note: "a layer KiCad plots that is not part of our fab set (fabrication, user or adhesive layers)" });
    let drill: CrossCheck["drill"];
    if (d.ok && existsSync(ddir)) {
      const holes = readdirSync(ddir)
        .filter((f) => /\.drl$/i.test(f))
        .map((f) => readExcellon(readFileSync(join(ddir, f), "utf8")));
      drill = { ours: oursHoles, kicad: { holes: holes.reduce((n, h) => n + h.holes.length, 0), sizes: [...new Set(holes.flatMap((h) => [...h.tools.values()].map((t) => t.d)))].sort((x, y) => x - y) } };
    }
    return { ok: true, message: `kicad-cli ${av.cli.version} export of the same board`, rows, ...(drill ? { drill } : {}) };
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
}

/**
 * PCB regression set: a measurement against its baseline. Board structure
 * (layers, footprints, tracks, vias, zones, nets, size, KiCad's stats) must
 * not change at all; check findings (DRC errors, warnings, unconnected,
 * schematic parity, each DRC type) may go down ("improved", a pass that asks
 * for the baseline to be recorded again) but never up; golden images must
 * match within a pixel tolerance.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import looksSame from "@tscircuit/image-utils/looks-same";
import type { FileMetrics, ImageRecord, KicadMetrics, Measurement } from "./measure.ts";

/** /2: DRC counts with --all-track-errors (every error of each track). */
export const BASELINE_SCHEMA = "pb-pcb-regression-baseline/2";

export interface Baseline {
  schema: typeof BASELINE_SCHEMA;
  board: string;
  name: string;
  /** The board file, inside the board's folder. */
  pcb: string;
  pcbSha256: string;
  file: FileMetrics;
  /** Absent when the baseline was recorded without KiCad. */
  kicad?: KicadMetrics;
}

export type Status = "same" | "improved" | "regressed" | "changed" | "missing" | "info";
export const FAILING: ReadonlySet<Status> = new Set(["regressed", "changed", "missing"]);

export interface Row {
  board: string;
  metric: string;
  baseline: string;
  current: string;
  status: Status;
  note?: string;
}

export function toBaseline(m: Measurement, name: string, pcb: string): Baseline {
  return { schema: BASELINE_SCHEMA, board: m.board, name, pcb, pcbSha256: m.pcbSha256, file: m.file, ...(m.kicad ? { kicad: m.kicad } : {}) };
}

const fmt = (v: unknown) => (v === undefined ? "-" : Array.isArray(v) ? v.join(",") : String(v));

/** A structural number: any change fails. */
function exact(board: string, metric: string, b: unknown, c: unknown, tolerance = 0): Row {
  const same = typeof b === "number" && typeof c === "number" ? Math.abs(b - c) <= tolerance : fmt(b) === fmt(c);
  return { board, metric, baseline: fmt(b), current: fmt(c), status: same ? "same" : "changed" };
}

/** A count of findings: fewer is better. */
function finding(board: string, metric: string, b: number | undefined, c: number | undefined): Row {
  const bb = b ?? 0;
  const cc = c ?? 0;
  return { board, metric, baseline: fmt(b ?? 0), current: fmt(c ?? 0), status: cc === bb ? "same" : cc < bb ? "improved" : "regressed" };
}

/** The numbers of a measurement against its baseline (images aside: compareImages). */
export function compareNumbers(base: Baseline, cur: Measurement): Row[] {
  const b = base.file;
  const c = cur.file;
  const id = base.board;
  const rows: Row[] = [];
  if (base.pcbSha256 !== cur.pcbSha256) rows.push({ board: id, metric: "input file", baseline: base.pcbSha256.slice(0, 12), current: cur.pcbSha256.slice(0, 12), status: "info", note: "the board file itself changed" });
  rows.push(exact(id, "file format", b.format, c.format));
  rows.push(exact(id, "copper layers", b.copperLayers, c.copperLayers));
  rows.push(exact(id, "copper layer names", b.copperLayerNames, c.copperLayerNames));
  for (const k of ["footprints", "tracks", "vias", "zones", "nets"] as const) rows.push(exact(id, k, b[k], c[k]));
  rows.push(exact(id, "outline width mm", b.boardWidthMm, c.boardWidthMm, 0.001));
  rows.push(exact(id, "outline height mm", b.boardHeightMm, c.boardHeightMm, 0.001));
  if (!cur.kicad) return rows;
  if (!base.kicad) {
    rows.push({ board: id, metric: "KiCad baseline", baseline: "-", current: cur.kicad.version, status: "missing", note: "baseline recorded without KiCad; record it again with --update" });
    return rows;
  }
  const bk = base.kicad;
  const ck = cur.kicad;
  if (bk.version !== ck.version) rows.push({ board: id, metric: "KiCad version", baseline: bk.version, current: ck.version, status: "info", note: "DRC differences may come from KiCad itself" });
  rows.push(finding(id, "DRC errors", bk.drc.errors, ck.drc.errors));
  rows.push(finding(id, "DRC warnings", bk.drc.warnings, ck.drc.warnings));
  rows.push(finding(id, "DRC unconnected", bk.drc.unconnected, ck.drc.unconnected));
  rows.push(finding(id, "DRC schematic parity", bk.drc.parity, ck.drc.parity));
  for (const t of [...new Set([...Object.keys(bk.drc.byType), ...Object.keys(ck.drc.byType)])].sort()) rows.push(finding(id, `DRC ${t}`, bk.drc.byType[t], ck.drc.byType[t]));
  rows.push(exact(id, "stats width mm", bk.stats.widthMm, ck.stats.widthMm, 0.001));
  rows.push(exact(id, "stats height mm", bk.stats.heightMm, ck.stats.heightMm, 0.001));
  for (const k of ["components", "vias", "smdPads", "thPads", "npthPads"] as const) rows.push(exact(id, `stats ${k}`, bk.stats[k], ck.stats[k]));
  return rows;
}

/** An image as RGBA pixels in a PNG: PNGs as they are, SVGs rasterized at one width on white. */
function asPng(file: string): Uint8Array {
  const raw = readFileSync(file);
  if (!file.endsWith(".svg")) return raw;
  return new Resvg(raw.toString("utf8"), { fitTo: { mode: "width", value: 1000 }, background: "#ffffff" }).render().asPng();
}

/**
 * The golden images: identical (by hash, an SVG's dated title ignored), or
 * different in at most `threshold` of the pixels. A diff image of each
 * failure is written to `artifacts`.
 */
export async function compareImages(board: string, goldenDir: string, golden: Record<string, ImageRecord>, currentDir: string, current: Record<string, ImageRecord>, threshold: number, artifacts: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (const key of [...new Set([...Object.keys(golden), ...Object.keys(current)])].sort()) {
    const g = golden[key];
    const c = current[key];
    const metric = `image ${key}`;
    if (!g || !c) {
      rows.push({ board, metric, baseline: g ? "present" : "-", current: c ? "present" : "-", status: "changed", note: g ? "no longer produced" : "new image" });
      continue;
    }
    if (g.sha256 === c.sha256) {
      rows.push({ board, metric, baseline: g.sha256.slice(0, 8), current: c.sha256.slice(0, 8), status: "same" });
      continue;
    }
    const gFile = join(goldenDir, key);
    if (!existsSync(gFile)) {
      rows.push({ board, metric, baseline: "file missing", current: c.sha256.slice(0, 8), status: "missing", note: `golden image not found: ${gFile}` });
      continue;
    }
    const ref = asPng(gFile);
    const cur = asPng(join(currentDir, key));
    const r = await looksSame(ref, cur, { strict: false, tolerance: 2.3 });
    const total = r.totalPixels ?? 0;
    const diff = r.differentPixels ?? (r.equal ? 0 : total);
    const fraction = total ? diff / total : r.equal ? 0 : 1;
    const pct = `${(fraction * 100).toFixed(3)}% px`;
    const ok = r.equal || fraction <= threshold;
    // KiCad's PNG bytes vary from run to run with identical pixels: only a pixel difference is worth a note
    const note = !ok ? `${pct} differ` : diff > 0 ? `${pct} differ (within tolerance)` : undefined;
    rows.push({ board, metric, baseline: g.sha256.slice(0, 8), current: c.sha256.slice(0, 8), status: ok ? "same" : "changed", ...(note ? { note } : {}) });
    if (!ok) {
      try {
        const out = join(artifacts, "diff", key.replace(/\.svg$/, ".png"));
        mkdirSync(join(out, ".."), { recursive: true });
        writeFileSync(out, await looksSame.createDiff({ reference: ref, current: cur, tolerance: 2.3 }));
      } catch {
        // a size change cannot be drawn as a diff; the row already says it failed
      }
    }
  }
  return rows;
}

/** A plain text table with padded columns. */
export function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

const STATUS_LABEL: Record<Status, string> = { same: "same", improved: "improved", regressed: "REGRESSED", changed: "CHANGED", missing: "MISSING", info: "note" };

/** The rows that are not "same", as a table. */
export function differencesTable(rows: Row[]): string {
  const shown = rows.filter((r) => r.status !== "same" || r.note);
  if (!shown.length) return "";
  return table(
    ["board", "metric", "baseline", "current", "status", "note"],
    shown.map((r) => [r.board, r.metric, r.baseline, r.current, STATUS_LABEL[r.status], r.note ?? ""]),
  );
}

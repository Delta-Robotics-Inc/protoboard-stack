/**
 * KiCad's DRC of a locked board (PB-1027): one way of running it and one way
 * of counting, for circuit:export (which stops on errors) and circuit:check
 * (CIRCUIT_KICAD_DRC). Before, export counted one way and a person running
 * kicad-cli by hand another (201 against 209 for one large board), and
 * check did not run it at all, so a forced export passed every stack check.
 * The command is always
 *
 *   kicad-cli pcb drc --format json --severity-all --schematic-parity
 *
 * on a copy of the KiCad folder (kicad-cli writes its settings beside the
 * project), and the summary names it, so the same numbers can be had by hand.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kicadVersion, runKicad } from "./cli.ts";

export const DRC_ARGS = ["pcb", "drc", "--format", "json", "--severity-all", "--schematic-parity"] as const;
export const DRC_COMMAND = `kicad-cli ${DRC_ARGS.join(" ")}`;

export interface DrcReport {
  violations?: { severity: string; type: string; description: string; items?: { description?: string }[] }[];
  unconnected_items?: unknown[];
  schematic_parity?: unknown[];
}

export interface DrcSummary {
  errors: number;
  warnings: number;
  unconnected: number;
  parity: number;
  /** Error types, most frequent first. */
  byType: [string, number][];
  /** The first few errors, as "type: description". */
  first: string[];
}

/** The counts every report of a KiCad DRC gives: errors and warnings (KiCad's severities), unconnected items, schematic parity. */
export function summariseDrc(r: DrcReport): DrcSummary {
  const v = r.violations ?? [];
  const errors = v.filter((x) => x.severity === "error");
  const byType = Object.entries(errors.reduce((m, x) => ({ ...m, [x.type]: (m[x.type] ?? 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { errors: errors.length, warnings: v.length - errors.length, unconnected: r.unconnected_items?.length ?? 0, parity: r.schematic_parity?.length ?? 0, byType, first: errors.slice(0, 3).map((x) => `${x.type}: ${x.description}${x.items?.length ? ` (${x.items.map((i) => i.description).filter(Boolean).slice(0, 2).join(", ")})` : ""}`) };
}

/** One line: "KiCad DRC: 15 error(s) (13 courtyards_overlap, 2 hole_clearance), 156 warning(s), 4 unconnected, 0 schematic parity". */
export const drcLine = (s: DrcSummary) =>
  `KiCad DRC: ${s.errors} error(s)${s.byType.length ? ` (${s.byType.slice(0, 4).map(([t, n]) => `${n} ${t}`).join(", ")})` : ""}, ${s.warnings} warning(s), ${s.unconnected} unconnected, ${s.parity} schematic parity`;

/** The digest of what DRC reads in a KiCad folder: the board, its rules, the project and the schematic. */
export function drcInputsDigest(folder: string, board: string): string {
  const h = createHash("sha256");
  for (const f of [`${board}.kicad_pcb`, `${board}.kicad_dru`, `${board}.kicad_pro`, `${board}.kicad_sch`]) {
    h.update(`${f}\0`);
    if (existsSync(join(folder, f))) h.update(readFileSync(join(folder, f)));
    h.update("\0");
  }
  h.update(kicadVersion() ?? "");
  return h.digest("hex");
}

/**
 * Run KiCad's DRC on a KiCad folder (copied first) and return its report.
 * With `cache`, a report for the same files and KiCad version is reused from
 * the system's temporary folder (check runs often; nothing is written into the
 * project).
 */
export function runDrc(folder: string, board: string, options: { cache?: boolean } = {}): { report: DrcReport; raw: Buffer } {
  const key = options.cache ? drcInputsDigest(folder, board) : undefined;
  const cacheDir = join(tmpdir(), "protoboard-kicad-drc");
  if (key && existsSync(join(cacheDir, `${key}.json`))) {
    const raw = readFileSync(join(cacheDir, `${key}.json`));
    return { report: JSON.parse(raw.toString("utf8")) as DrcReport, raw };
  }
  const tmp = mkdtempSync(join(tmpdir(), "pb-kicad-drc-"));
  try {
    cpSync(folder, join(tmp, "project"), { recursive: true, filter: (src) => !/[\\/]3d([\\/]|$)/.test(src.slice(folder.length)) || statSync(src).isDirectory() });
    const out = join(tmp, "drc.json");
    const r = runKicad([...DRC_ARGS, "--output", out, join(tmp, "project", `${board}.kicad_pcb`)]);
    if (!existsSync(out)) throw new Error(`kicad-cli pcb drc wrote no report (exit ${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
    const raw = readFileSync(out);
    if (key) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${key}.json`), raw);
      // a small cache: the newest reports only
      const old = readdirSync(cacheDir).map((f) => ({ f, t: statSync(join(cacheDir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(50);
      for (const o of old) rmSync(join(cacheDir, o.f), { force: true });
    }
    return { report: JSON.parse(raw.toString("utf8")) as DrcReport, raw };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

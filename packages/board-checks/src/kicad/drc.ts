/**
 * Running KiCad's DRC for the cross-check. The command is always
 *
 *   kicad-cli pcb drc --format json --severity-all --all-track-errors --units mm
 *
 * (every severity, every error of each track, no schematic parity: the board document has no schematic to
 * compare against), on a copy of the board's folder in the system's temporary folder, because kicad-cli writes
 * settings beside a project. The board in place is never touched.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { findKicadCli, type KicadCli } from "./cli.js";

export const CROSS_CHECK_DRC_ARGS = ["pcb", "drc", "--format", "json", "--severity-all", "--all-track-errors", "--units", "mm"] as const;
export const CROSS_CHECK_DRC_COMMAND = `kicad-cli ${CROSS_CHECK_DRC_ARGS.join(" ")}`;

export interface KicadDrcItem {
  description?: string;
  pos?: { x: number; y: number };
  uuid?: string;
}
export interface KicadViolation {
  type: string;
  severity: string;
  description?: string;
  items?: KicadDrcItem[];
}
export interface KicadDrcReport {
  kicad_version?: string;
  coordinate_units?: string;
  violations?: KicadViolation[];
  unconnected_items?: KicadViolation[];
  schematic_parity?: unknown[];
}

export interface KicadDrcRun {
  report: KicadDrcReport;
  cli: KicadCli;
  command: string;
  durationMs: number;
}

/** Folders not copied for a DRC run (3D models and editor history are large and DRC does not read them). */
const SKIP = /^(3d|3dshapes|.*\.3dshapes|\.history|backups?|.*-backups)$/i;

/**
 * Run KiCad's DRC on a board file. `root` is the folder copied for the run (default: the board file's folder); it
 * must hold the board's project and rule files (`.kicad_pro`, `.kicad_dru`) so KiCad applies the board's rules.
 */
export function runKicadDrc(pcbPath: string, options: { cli?: KicadCli; root?: string; refillZones?: boolean; timeoutMs?: number } = {}): KicadDrcRun {
  const cli = options.cli ?? findKicadCli();
  if (!cli) throw new Error("kicad-cli was not found (set PROTOBOARD_KICAD_CLI, put it on PATH, or install KiCad)");
  const pcb = resolve(pcbPath);
  if (!existsSync(pcb)) throw new Error(`no board file at ${pcb}`);
  const root = resolve(options.root ?? dirname(pcb));
  const rel = relative(root, pcb);
  if (rel.startsWith("..")) throw new Error("the board file must be inside the copied folder");
  const tmp = mkdtempSync(join(tmpdir(), "pb-board-checks-drc-"));
  try {
    const copy = join(tmp, "board");
    cpSync(root, copy, { recursive: true, filter: (src) => src === root || !SKIP.test(basename(src)) });
    const out = join(tmp, "drc.json");
    const args = [...CROSS_CHECK_DRC_ARGS, ...(options.refillZones ? ["--refill-zones"] : []), "--output", out, join(copy, rel)];
    const t0 = performance.now();
    const r = spawnSync(cli.path, args, { encoding: "utf8", windowsHide: true, timeout: options.timeoutMs ?? 600_000, cwd: copy });
    const durationMs = Math.round(performance.now() - t0);
    if (!existsSync(out)) throw new Error(`kicad-cli pcb drc wrote no report (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-2).join(" ")}`);
    const report = parseKicadDrc(readFileSync(out, "utf8"));
    return { report, cli, command: `${CROSS_CHECK_DRC_COMMAND}${options.refillZones ? " --refill-zones" : ""}`, durationMs };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Parse a KiCad DRC JSON report (the shape of `https://schemas.kicad.org/drc.v1.json`). */
export function parseKicadDrc(text: string): KicadDrcReport {
  const r = JSON.parse(text) as KicadDrcReport;
  if (!r || typeof r !== "object") throw new Error("not a KiCad DRC report");
  if (r.coordinate_units && r.coordinate_units !== "mm") throw new Error(`the DRC report is in ${r.coordinate_units}; run it with --units mm`);
  return { ...r, violations: r.violations ?? [], unconnected_items: r.unconnected_items ?? [] };
}

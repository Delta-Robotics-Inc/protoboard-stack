/**
 * PCB regression set (PCB editor overhaul, Phase 0): the numbers recorded for
 * one reference board. Two sources:
 *
 * - the board file itself, read with the stack's own S-expression reader (no
 *   KiCad needed): copper layers, footprints, tracks, vias, zones, nets and
 *   the Edge.Cuts outline's size;
 * - kicad-cli, when KiCad is installed: DRC (the stack's one DRC command,
 *   lib/kicad/drc.ts, plus `--all-track-errors` so every error of a track is
 *   counted, not only its first: complete and stable counts, as the board
 *   checks' KiCad cross-check runs it), `pcb export stats`, a top-side render
 *   and one SVG per layer as golden images.
 *
 * Every kicad-cli call runs on a copy of the board's folder in the system's
 * temporary folder (kicad-cli writes settings beside a project), never on the
 * board in place.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { kicadCliInfo, kicadCliMissing } from "../../lib/kicad/cli.ts";
import { DRC_ARGS, type DrcReport } from "../../lib/kicad/drc.ts";

/** The regression set's DRC: the stack's one DRC command with every error of each track. */
export const REGRESSION_DRC_ARGS = [...DRC_ARGS, "--all-track-errors"] as const;
import { child, children, head, isList, isStr, parse, text, valueOf, type List, type Node } from "../../lib/kicad/sexpr.ts";

/** What the board file says, without KiCad. */
export interface FileMetrics {
  /** The file's `(version …)`, e.g. 20260206 (KiCad 10) or 20241229 (tscircuit's exporter). */
  format: string;
  copperLayers: number;
  copperLayerNames: string[];
  footprints: number;
  /** Top-level `segment` and `arc` items. */
  tracks: number;
  vias: number;
  /** Top-level `zone` items (pours and rule areas; keep-outs inside footprints are not counted). */
  zones: number;
  /** Distinct non-empty net names referenced anywhere in the file. */
  nets: number;
  /** The Edge.Cuts outline's bounding box (top-level graphics), in mm, 3 decimals. */
  boardWidthMm: number;
  boardHeightMm: number;
}

export interface DrcCounts {
  errors: number;
  warnings: number;
  unconnected: number;
  parity: number;
  /** "severity type" -> count, e.g. "error clearance": 12. */
  byType: Record<string, number>;
}

export interface StatsCounts {
  widthMm: number;
  heightMm: number;
  components: number;
  vias: number;
  smdPads: number;
  thPads: number;
  npthPads: number;
}

export interface ImageRecord {
  /** sha256 of the file (SVG: with its dated <title> removed). */
  sha256: string;
  bytes: number;
}

export interface KicadMetrics {
  version: string;
  drc: DrcCounts;
  stats: StatsCounts;
  /** Golden image path inside the baseline folder -> its record. */
  images: Record<string, ImageRecord>;
}

export interface Measurement {
  board: string;
  /** sha256 of the .kicad_pcb measured: tells a changed input from a changed tool. */
  pcbSha256: string;
  file: FileMetrics;
  /** Absent when KiCad is not installed or was turned off. */
  kicad?: KicadMetrics;
  /** Where the images of this run are (a temporary folder, removed by the caller). */
  imageDir?: string;
  seconds: number;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

const xy = (n: List | undefined): [number, number] | undefined => {
  if (!n) return undefined;
  const x = Number(text(n.items[1]));
  const y = Number(text(n.items[2]));
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
};

/**
 * The points that bound an arc through start, mid and end: the two ends plus
 * every axis extreme (0, 90, 180, 270 degrees) the arc sweeps over.
 */
export function arcBoundPoints(s: [number, number], m: [number, number], e: [number, number]): [number, number][] {
  const d = 2 * (s[0] * (m[1] - e[1]) + m[0] * (e[1] - s[1]) + e[0] * (s[1] - m[1]));
  if (Math.abs(d) < 1e-12) return [s, m, e];
  const sq = (p: [number, number]) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(s) * (m[1] - e[1]) + sq(m) * (e[1] - s[1]) + sq(e) * (s[1] - m[1])) / d;
  const cy = (sq(s) * (e[0] - m[0]) + sq(m) * (s[0] - e[0]) + sq(e) * (m[0] - s[0])) / d;
  const r = Math.hypot(s[0] - cx, s[1] - cy);
  const ang = (p: [number, number]) => Math.atan2(p[1] - cy, p[0] - cx);
  const TAU = 2 * Math.PI;
  const ccw = (a: number, b: number) => (((b - a) % TAU) + TAU) % TAU;
  const [a0, am, a1] = [ang(s), ang(m), ang(e)];
  // sweep counter-clockwise from `from` by `sweep`, the way that passes the mid point
  const [from, sweep] = ccw(a0, am) <= ccw(a0, a1) ? [a0, ccw(a0, a1)] : [a1, ccw(a1, a0)];
  const out: [number, number][] = [s, e];
  for (let k = 0; k < 4; k++) {
    const t = (k * Math.PI) / 2;
    if (ccw(from, t) <= sweep) out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** The Edge.Cuts outline's bounding box from the top-level graphics. */
function outlineBox(doc: List): { w: number; h: number } {
  const pts: [number, number][] = [];
  for (const g of doc.items) {
    if (!isList(g)) continue;
    const h = head(g);
    if (!h?.startsWith("gr_") || valueOf(g, "layer") !== "Edge.Cuts") continue;
    const start = xy(child(g, "start"));
    const end = xy(child(g, "end"));
    if (h === "gr_line" || h === "gr_rect") {
      if (start) pts.push(start);
      if (end) pts.push(end);
    } else if (h === "gr_arc") {
      const mid = xy(child(g, "mid"));
      if (start && mid && end) pts.push(...arcBoundPoints(start, mid, end));
    } else if (h === "gr_circle") {
      const c = xy(child(g, "center"));
      if (c && end) {
        const r = Math.hypot(end[0] - c[0], end[1] - c[1]);
        pts.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
      }
    } else if (h === "gr_poly" || h === "gr_curve") {
      const p = child(g, "pts");
      for (const q of p ? children(p, "xy") : []) {
        const v = xy(q);
        if (v) pts.push(v);
      }
    }
  }
  if (!pts.length) return { w: 0, h: 0 };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { w: round3(Math.max(...xs) - Math.min(...xs)), h: round3(Math.max(...ys) - Math.min(...ys)) };
}

/** Every net name referenced in the file: `(net 3 "x")` (before KiCad 10), `(net "x")` (KiCad 10), `(net_name "x")` (zones before KiCad 10). */
function netNames(n: List, out: Set<string>): Set<string> {
  const h = head(n);
  if (h === "net" || h === "net_name") {
    const last = n.items[n.items.length - 1];
    if (isStr(last) && last.str !== "") out.add(last.str);
  }
  for (const c of n.items) if (isList(c)) netNames(c, out);
  return out;
}

/** The numbers a .kicad_pcb gives without KiCad. */
export function fileMetrics(src: string): FileMetrics {
  const doc = parse(src);
  const layers = child(doc, "layers");
  const copper = (layers?.items ?? [])
    .filter((l): l is List => isList(l))
    .map((l) => text(l.items[1]) ?? "")
    .filter((name) => name.endsWith(".Cu"));
  const top = (name: string) => doc.items.filter((c: Node) => isList(c) && head(c) === name).length;
  const box = outlineBox(doc);
  return {
    format: valueOf(doc, "version") ?? "",
    copperLayers: copper.length,
    copperLayerNames: copper,
    footprints: top("footprint"),
    tracks: top("segment") + top("arc"),
    vias: top("via"),
    zones: top("zone"),
    nets: netNames(doc, new Set()).size,
    boardWidthMm: box.w,
    boardHeightMm: box.h,
  };
}

/** The DRC report's counts, warnings included, by severity and type. */
export function drcCounts(r: DrcReport): DrcCounts {
  const v = r.violations ?? [];
  const byType: Record<string, number> = {};
  for (const x of v) byType[`${x.severity} ${x.type}`] = (byType[`${x.severity} ${x.type}`] ?? 0) + 1;
  const sorted = Object.fromEntries(Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0])));
  return {
    errors: v.filter((x) => x.severity === "error").length,
    warnings: v.filter((x) => x.severity !== "error").length,
    unconnected: r.unconnected_items?.length ?? 0,
    parity: r.schematic_parity?.length ?? 0,
    byType: sorted,
  };
}

/** "40.0000 mm" -> 40 */
const mm = (s: unknown) => round3(Number.parseFloat(String(s ?? "")) || 0);

interface StatsJson {
  board?: { width?: string; height?: string };
  pads?: { smd?: number; through_hole?: number; npth?: number };
  vias?: Record<string, number>;
  components?: { total?: { total?: number } };
}

/** `kicad-cli pcb export stats --format json`, as numbers. */
export function statsCounts(s: StatsJson): StatsCounts {
  return {
    widthMm: mm(s.board?.width),
    heightMm: mm(s.board?.height),
    components: s.components?.total?.total ?? 0,
    vias: Object.values(s.vias ?? {}).reduce((a, b) => a + b, 0),
    smdPads: s.pads?.smd ?? 0,
    thPads: s.pads?.through_hole ?? 0,
    npthPads: s.pads?.npth ?? 0,
  };
}

/** An SVG as compared: KiCad puts the export date in its <title>. */
export const normalizeSvg = (svg: string) => svg.replace(/<title>[\s\S]*?<\/title>/g, "<title/>");

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function imageRecord(file: string): ImageRecord {
  const raw = readFileSync(file);
  return { sha256: sha256(file.endsWith(".svg") ? normalizeSvg(raw.toString("utf8")) : raw), bytes: raw.length };
}

/** The layers plotted to SVG: every copper layer, then silkscreen, mask and the outline. */
export const svgLayers = (copper: string[]) => [...copper, "F.SilkS", "B.SilkS", "F.Mask", "B.Mask", "Edge.Cuts"];

export const RENDER_ARGS = ["pcb", "render", "--side", "top", "--quality", "basic", "--width", "1200", "--height", "900", "--background", "opaque"] as const;
export const SVG_ARGS = ["pcb", "export", "svg", "--mode-multi", "--page-size-mode", "2", "--exclude-drawing-sheet"] as const;
export const STATS_ARGS = ["pcb", "export", "stats", "--format", "json"] as const;

/** The kicad-cli in use, or why there is none. */
export function kicadAvailable(): { path: string; version: string } | { missing: string } {
  const cli = kicadCliInfo();
  return cli ? { path: cli.path, version: cli.version } : { missing: kicadCliMissing() ?? "kicad-cli (KiCad 10 or newer) not found" };
}

/** Run kicad-cli without blocking the event loop (boards run side by side). */
function kicad(cli: string, args: string[], cwd: string, timeoutMs = 600_000): Promise<{ status: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cli, args, { cwd, windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, out });
    });
  });
}

const lastLines = (s: string) => s.trim().split("\n").slice(-3).join(" ");

/**
 * Measure one board. `root` is the folder copied for kicad-cli (it must hold
 * everything the board refers to with ${KIPRJMOD}: footprint libraries, 3D
 * models); `pcb` is the board file's path inside it.
 */
export async function measureBoard(board: string, root: string, pcb: string, options: { cli?: string } = {}): Promise<Measurement> {
  const t0 = Date.now();
  const src = readFileSync(join(root, pcb));
  const file = fileMetrics(src.toString("utf8"));
  const result: Measurement = { board, pcbSha256: sha256(src), file, seconds: 0 };
  if (!options.cli) {
    result.seconds = (Date.now() - t0) / 1000;
    return result;
  }
  const cli = options.cli;
  const work = mkdtempSync(join(tmpdir(), "pb-pcb-regression-"));
  try {
    const proj = join(work, "board");
    cpSync(root, proj, { recursive: true });
    const pcbPath = join(proj, pcb);
    const cwd = dirname(pcbPath);
    const name = basename(pcb).replace(/\.kicad_pcb$/, "");
    const out = join(work, "out");
    mkdirSync(join(out, "layers"), { recursive: true });

    const drc = await kicad(cli, [...REGRESSION_DRC_ARGS, "--output", join(out, "drc.json"), pcbPath], cwd);
    if (!existsSync(join(out, "drc.json"))) throw new Error(`${board}: kicad-cli pcb drc wrote no report (exit ${drc.status}): ${lastLines(drc.out)}`);
    const stats = await kicad(cli, [...STATS_ARGS, "--output", join(out, "stats.json"), pcbPath], cwd);
    if (!existsSync(join(out, "stats.json"))) throw new Error(`${board}: kicad-cli pcb export stats failed (exit ${stats.status}): ${lastLines(stats.out)}`);
    const render = await kicad(cli, [...RENDER_ARGS, "--output", join(out, "render-top.png"), pcbPath], cwd);
    if (!existsSync(join(out, "render-top.png"))) throw new Error(`${board}: kicad-cli pcb render failed (exit ${render.status}): ${lastLines(render.out)}`);
    const svgDir = join(work, "svg");
    const svg = await kicad(cli, [...SVG_ARGS, "--layers", svgLayers(file.copperLayerNames).join(","), "--output", svgDir, pcbPath], cwd);
    const svgs = existsSync(svgDir) ? readdirSync(svgDir).filter((f) => f.endsWith(".svg")) : [];
    if (!svgs.length) throw new Error(`${board}: kicad-cli pcb export svg wrote nothing (exit ${svg.status}): ${lastLines(svg.out)}`);
    // "<board>-F_Cu.svg" -> "layers/F_Cu.svg"
    for (const f of svgs) renameSync(join(svgDir, f), join(out, "layers", f.startsWith(`${name}-`) ? f.slice(name.length + 1) : f));

    const images: Record<string, ImageRecord> = {};
    images["render-top.png"] = imageRecord(join(out, "render-top.png"));
    for (const f of readdirSync(join(out, "layers")).sort()) images[`layers/${f}`] = imageRecord(join(out, "layers", f));

    result.kicad = {
      version: kicadCliInfo()?.version ?? "",
      drc: drcCounts(JSON.parse(readFileSync(join(out, "drc.json"), "utf8")) as DrcReport),
      stats: statsCounts(JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as StatsJson),
      images,
    };
    // keep only the outputs: the caller compares and then removes them
    rmSync(proj, { recursive: true, force: true });
    rmSync(svgDir, { recursive: true, force: true });
    result.imageDir = out;
    result.seconds = (Date.now() - t0) / 1000;
    return result;
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/** The temporary folder a measurement's images live in (its parent is the run's work folder). */
export const workDirOf = (m: Measurement) => (m.imageDir ? dirname(m.imageDir) : undefined);

/** A path for messages: relative to `from` when inside it. */
export const shortPath = (p: string, from: string) => {
  const r = relative(from, p);
  return r && !r.startsWith("..") ? r : p;
};

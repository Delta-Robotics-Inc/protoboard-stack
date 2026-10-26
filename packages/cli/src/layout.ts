/**
 * `protoboard layout` (PB-1007): the diagram's layout measured, level by
 * level, headless, and written to the display file when asked.
 *
 * The numbers are what the viewer draws (`@deltarobotics/uhd-viewer/headless`:
 * the same layout and line routing): link crossings, overlapping boxes, the
 * strip (the most cards one straight line across or down passes through), the
 * aspect ratio, lines under cards. With --apply each level is laid out afresh
 * (the viewer's automatic layout); with --tidy the saved arrangement is the
 * starting point. Pinned cards keep their places. A level is written only when
 * the result reads better than what is there (--force writes it anyway).
 *
 * `check` adds the findings of the levels of modules (not the boards' sheets,
 * which `layout` reports) as PB_DIAGRAM_LAYOUT info diagnostics.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { uhdBundle, type Project, type ProjectDiagnostic } from "@protoboardai/core";
import { DISPLAY_SCHEMA, formatDisplay, type DisplayFile, type LevelLayout } from "./dev/layout.js";

type Headless = typeof import("@deltarobotics/uhd-viewer/headless");
type LayoutMetrics = import("@deltarobotics/uhd-viewer/headless").LayoutMetrics;
type LayoutFinding = import("@deltarobotics/uhd-viewer/headless").LayoutFinding;
type UhdBundle = Parameters<Headless["measureLevel"]>[0];

export interface LayoutOptions {
  /** One level (an instance path; "" is the top). Default: every level. */
  level?: string;
  /** Write: "default" lays the level out afresh, "tidy" fixes the saved arrangement. */
  apply?: "default" | "tidy";
  /** Cards that keep their places (added to the level's saved `pinned`). */
  pin?: string[];
  /** Write even when the result does not read better. */
  force?: boolean;
}

export interface LevelReport {
  level: string;
  label: string;
  board: boolean;
  /** The level has a saved layout (else the viewer lays it out automatically). */
  saved: boolean;
  metrics: LayoutMetrics;
  findings: LayoutFinding[];
  /** With --apply or --tidy: the proposal's metrics and findings, and whether it was written. */
  proposed?: { mode: "default" | "tidy"; metrics: LayoutMetrics; findings: LayoutFinding[]; better: boolean; written: boolean; pinned: string[] };
}

export interface LayoutReport {
  /** The display file, relative to the project. */
  file: string;
  levels: LevelReport[];
  /** Levels written to the display file. */
  written: string[];
  /** Levels with a warning after this run (what --check fails on). */
  warnings: number;
}

async function headless(): Promise<Headless> {
  return (await import("@deltarobotics/uhd-viewer/headless")) as Headless;
}

export function displayPath(p: Project): string {
  return join(p.root, p.config.display ?? ".protoboard/display.json");
}

const slim = (m: LayoutMetrics): LayoutMetrics => ({ ...m, detail: { overlaps: m.detail.overlaps.slice(0, 20), underCards: m.detail.underCards.slice(0, 20) } });

export async function runLayout(p: Project, opts: LayoutOptions = {}): Promise<LayoutReport> {
  const h = await headless();
  const file = displayPath(p);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const display: DisplayFile = previous ? (JSON.parse(previous) as DisplayFile) : { schema: DISPLAY_SCHEMA };
  const bundle = (await uhdBundle(p)) as unknown as UhdBundle;
  const all = h.diagramLevels(bundle);
  const levels = opts.level === undefined ? all : all.filter((l) => l.level === opts.level);
  if (!levels.length) throw new Error(`no level "${opts.level}"; the levels are ${all.map((l) => (l.level ? `"${l.level}"` : '"" (the top)')).join(", ")}`);
  const out: LevelReport[] = [];
  const written: string[] = [];
  for (const lv of levels) {
    const now = h.measureLevel(bundle, lv.level);
    const report: LevelReport = { level: lv.level, label: lv.label, board: lv.board, saved: now.saved, metrics: slim(now.metrics), findings: now.findings };
    if (opts.apply) {
      const pr = h.proposeLevel(bundle, lv.level, { mode: opts.apply, pinned: opts.pin });
      // a level with no saved layout already draws the automatic layout, and keeps following the model as it
      // changes: it is saved only when asked (--force), or when cards are pinned on it
      const write = opts.force || (pr.better && now.saved);
      if (write) {
        display.schema ??= DISPLAY_SCHEMA;
        display.diagram ??= {};
        display.diagram.layouts ??= {};
        display.diagram.layouts[lv.level] = pr.layout as LevelLayout;
        written.push(lv.level);
      }
      report.proposed = { mode: opts.apply, metrics: slim(pr.after.metrics), findings: pr.after.findings, better: pr.better, written: write, pinned: pr.layout.pinned ?? [] };
    }
    out.push(report);
  }
  if (written.length) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, formatDisplay(display, previous));
  }
  const warnings = out.filter((r) => ((r.proposed?.written ? r.proposed.findings : r.findings) ?? []).some((f) => f.severity === "warning")).length;
  return { file: relative(p.root, file) || file, levels: out, written, warnings };
}

const name = (r: { level: string; label: string }) => (r.level ? `${r.level} (${r.label})` : `top level (${r.label})`);
const line = (m: LayoutMetrics) =>
  `${m.cards} cards, ${m.links} lines: ${m.crossings} crossings, ${m.overlaps} overlaps, longest ${m.stripAxis} ${m.strip}, aspect ${m.aspect}, ${m.underCards} under cards`;

export function formatLayout(r: LayoutReport): string {
  const out: string[] = [];
  for (const l of r.levels) {
    out.push(`${name(l)}${l.board ? " [board]" : ""}: ${l.saved ? "saved layout" : "automatic layout"}`);
    out.push(`  now:      ${line(l.metrics)}`);
    for (const f of l.findings) out.push(`    ${f.severity === "warning" ? "!" : "·"} ${f.message}`);
    // a board's sheet is laid out as a schematic; past a few dozen parts it reads better as sub-modules (model, not display)
    if (l.board && l.findings.some((f) => f.severity === "warning") && l.metrics.cards > 24)
      out.push(`    → a board of ${l.metrics.cards} parts reads better split into sub-modules by function (power, processor, sensors, outputs), each a level of its own: model them, the diagram follows`);
    if (l.proposed) {
      const p = l.proposed;
      out.push(`  ${p.mode === "tidy" ? "tidied:  " : "default: "} ${line(p.metrics)}${p.pinned.length ? ` (pinned: ${p.pinned.join(", ")})` : ""}`);
      for (const f of p.findings) out.push(`    ${f.severity === "warning" ? "!" : "·"} ${f.message}`);
      out.push(`  ${p.written ? `written to ${r.file}` : !l.saved ? "not written: the level has no saved layout, so the viewer draws this already (--force saves it)" : "not written: it does not read better than what is there (--force writes it)"}`);
    }
  }
  out.push(
    "",
    r.written.length
      ? `wrote ${r.written.length} level${r.written.length === 1 ? "" : "s"} to ${r.file}; look at them in the viewer (protoboard dev) before you call it done`
      : r.warnings
        ? `${r.warnings} level${r.warnings === 1 ? " has" : "s have"} something to fix: move the cards (protoboard dev, or ${r.file}), or try --apply or --tidy`
        : "nothing to fix",
  );
  return out.join("\n");
}

/**
 * Layout findings for `check`: the levels of modules only (a board's sheet is
 * reported by `protoboard layout`), as info, one diagnostic per level.
 */
export async function layoutDiagnostics(p: Project): Promise<ProjectDiagnostic[]> {
  if (!p.rootDef) return [];
  try {
    const h = await headless();
    const bundle = (await uhdBundle(p)) as unknown as UhdBundle;
    const out: ProjectDiagnostic[] = [];
    for (const lv of h.diagramLevels(bundle)) {
      if (lv.board) continue;
      const m = h.measureLevel(bundle, lv.level);
      const warn = m.findings.filter((f) => f.severity === "warning");
      if (!warn.length) continue;
      out.push({
        code: "PB_DIAGRAM_LAYOUT",
        severity: "info",
        message: `the diagram's ${lv.level ? `level "${lv.level}"` : "top level"} is hard to read: ${warn.map((f) => f.message).join("; ")}. Run \`protoboard layout${lv.level ? ` ${lv.level}` : ""}\`, and fix it (--apply, --tidy, or by moving cards) before you call the build done`,
        entity: lv.level ? { kind: "instance", id: lv.level } : { kind: "project", id: p.name },
        validator: "protoboard/layout",
      });
    }
    return out;
  } catch {
    // no viewer build (a stack without it): no layout findings
    return [];
  }
}

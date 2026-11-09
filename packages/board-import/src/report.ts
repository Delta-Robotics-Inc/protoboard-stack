/**
 * The import report: what was dropped or approximated, with counts. Items of the same kind are merged into one
 * report line ("12 dimension items: dimensions are not modeled"), keeping the first few source locations.
 */
import type { ImportReportItem } from "@protoboardai/board";

export type ReportLevel = ImportReportItem["level"];

interface Entry {
  level: ReportLevel;
  what: string;
  why: string;
  count: number;
  sources: string[];
  ids: string[];
}

const MAX_SOURCES = 5;
const MAX_IDS = 20;

/** Collects report entries keyed by level and subject, and counts repeats. */
export class Reporter {
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[] = [];

  /**
   * Note one occurrence (or `count` occurrences). `what` names the thing ("dimension item"), `why` the reason
   * ("dimensions are not modeled"). The same level, `what` and `why` merge into one line.
   */
  add(level: ReportLevel, what: string, why: string, opts: { source?: string; id?: string; count?: number } = {}): void {
    const key = `${level}\u0000${what}\u0000${why}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { level, what, why, count: 0, sources: [], ids: [] };
      this.entries.set(key, e);
      this.order.push(key);
    }
    e.count += opts.count ?? 1;
    if (opts.source && e.sources.length < MAX_SOURCES && !e.sources.includes(opts.source)) e.sources.push(opts.source);
    if (opts.id && e.ids.length < MAX_IDS && !e.ids.includes(opts.id)) e.ids.push(opts.id);
  }

  dropped(what: string, why: string, opts?: { source?: string; id?: string; count?: number }): void {
    this.add("dropped", what, why, opts);
  }
  approximated(what: string, why: string, opts?: { source?: string; id?: string; count?: number }): void {
    this.add("approximated", what, why, opts);
  }
  info(what: string, why: string, opts?: { source?: string; id?: string; count?: number }): void {
    this.add("info", what, why, opts);
  }

  /** The report lines in the order first seen, dropped first, then approximated, then info. */
  items(): ImportReportItem[] {
    const rank = { dropped: 0, approximated: 1, info: 2 } as const;
    return this.order
      .map((k) => this.entries.get(k)!)
      .sort((a, b) => rank[a.level] - rank[b.level])
      .map((e) => ({
        level: e.level,
        message: `${e.count} ${e.what}: ${e.why}`,
        ...(e.sources.length ? { source: e.sources.join(", ") + (e.count > e.sources.length ? ", ..." : "") } : {}),
        ...(e.ids.length ? { ids: [...e.ids] } : {}),
      }));
  }

  /** Counts by level and subject, for the summary: `{ dropped: { "dimension item": 3 } }`. */
  summary(): ImportSummary {
    const out: ImportSummary = { dropped: {}, approximated: {}, info: {} };
    for (const k of this.order) {
      const e = this.entries.get(k)!;
      out[e.level][e.what] = (out[e.level][e.what] ?? 0) + e.count;
    }
    return out;
  }
}

export interface ImportSummary {
  dropped: Record<string, number>;
  approximated: Record<string, number>;
  info: Record<string, number>;
}

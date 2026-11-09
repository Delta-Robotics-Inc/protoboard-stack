/**
 * The import report: every record type dropped or approximated, merged into one line per subject and reason with a
 * count ("12 DIMENSION records: dimensions are not modeled"), keeping the first few source ids.
 */
import type { ImportReportItem } from "@protoboardai/board";

type Level = ImportReportItem["level"];

interface Entry {
  level: Level;
  what: string;
  why: string;
  count: number;
  sources: string[];
}

const MAX_SOURCES = 5;

export class Reporter {
  private readonly entries = new Map<string, Entry>();

  add(level: Level, what: string, why: string, opts: { source?: string; count?: number } = {}): void {
    const key = `${level}\u0000${what}\u0000${why}`;
    let e = this.entries.get(key);
    if (!e) this.entries.set(key, (e = { level, what, why, count: 0, sources: [] }));
    e.count += opts.count ?? 1;
    if (opts.source && e.sources.length < MAX_SOURCES && !e.sources.includes(opts.source)) e.sources.push(opts.source);
  }
  dropped(what: string, why: string, opts?: { source?: string; count?: number }): void {
    this.add("dropped", what, why, opts);
  }
  approximated(what: string, why: string, opts?: { source?: string; count?: number }): void {
    this.add("approximated", what, why, opts);
  }
  info(what: string, why: string, opts?: { source?: string; count?: number }): void {
    this.add("info", what, why, opts);
  }

  /** Report lines: dropped first, then approximated, then info, each in the order first seen. */
  items(): ImportReportItem[] {
    const rank = { dropped: 0, approximated: 1, info: 2 } as const;
    return [...this.entries.values()]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => rank[a.e.level] - rank[b.e.level] || a.i - b.i)
      .map(({ e }) => ({
        level: e.level,
        message: `${e.count} ${e.what}: ${e.why}`,
        ...(e.sources.length ? { source: e.sources.join(", ") + (e.count > e.sources.length ? ", ..." : "") } : {}),
      }));
  }

  /** Counts by level and subject. */
  summary(): Record<Level, Record<string, number>> {
    const out: Record<Level, Record<string, number>> = { dropped: {}, approximated: {}, info: {} };
    for (const e of this.entries.values()) out[e.level][e.what] = (out[e.level][e.what] ?? 0) + e.count;
    return out;
  }
}

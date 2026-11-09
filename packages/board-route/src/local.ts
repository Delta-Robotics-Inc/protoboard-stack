/**
 * Net-local scoring for repeated router runs on one board (the routing diagnosis): the board's checks run in full
 * once, and each candidate is scored by what changed since the last board scored (an incremental check run and an
 * incremental refill of the zones), not by a full check run per candidate. The same check runs give the islands
 * each net still has to join as the checks see them, zone fill included (`IslandSource`), so a net a pour partly
 * joins is routed only where the pour does not reach.
 *
 * This package does not depend on the checks or the fill: the caller passes them in (`@protoboardai/board-checks`'
 * `createIncrementalChecks`, `@protoboardai/board-fill`'s `fillZones` and `refillZones`), typed here by the parts used.
 */
import { byCodeUnit, type BoardDocument, type CopperLayer } from "@protoboardai/board";
import type { BoardScorer, IslandAnchor, IslandSource, ScorerReport } from "./types.js";

/** The parts of a check run used here (board-checks' `BoardCheckResult`). */
export interface CheckRunLike {
  summary: { unconnected: number; errors: number };
  findings: readonly { id: string; severity: string; check: string }[];
  connectivity: {
    links: readonly { net: string; islands: readonly [number, number] | readonly number[] }[];
    islands: readonly { net: string; anchors: readonly { object: string; x: number; y: number; layer: CopperLayer }[] }[];
  };
}

/** The parts of incremental checks used here (board-checks' `IncrementalChecks`). */
export interface IncrementalChecksLike {
  readonly result: CheckRunLike;
  update(next: BoardDocument, changed: readonly string[], options?: { fills?: unknown; fillChanged?: string[] }): { result: CheckRunLike; mode?: string };
}

/** The zone fill engine's parts used here (board-fill's `fillZones`, `refillZones` and the result's `fill`). */
export interface FillEngineLike<F extends { fill: unknown; recomputed: readonly { zone: string }[] }> {
  fill(doc: BoardDocument): F;
  refill(doc: BoardDocument, previous: F, changed: readonly string[]): F;
}

export interface LocalScoringDeps<F extends { fill: unknown; recomputed: readonly { zone: string }[] }> {
  /** Incremental checks on a board, with its zone fill when it has zones. */
  checks(doc: BoardDocument, options: { fills?: F["fill"] }): IncrementalChecksLike;
  /** The zone fill engine (absent: zones connect nothing, as the checks say). */
  fills?: FillEngineLike<F>;
}

export interface LocalScoring {
  /** Scores a board by the change from the last board scored: open connections and errors as a full check run would count them. */
  scorer: BoardScorer;
  /** The islands each net still has to join on a board, from the same check runs (zone fill included). */
  islands: IslandSource;
  /** The check run of the board it started from. */
  readonly base: CheckRunLike;
  /** Runs so far: `full` (the first, and any change with board-wide reach), `incremental`, and their total time. */
  readonly stats: { full: number; incremental: number; ms: number };
}

const hasZones = (doc: BoardDocument) => {
  for (const r of doc.records.values()) if (r.kind === "zone") return true;
  return false;
};

/** Ids of records that differ between two boards (changed, added or removed), by record identity. */
export function changedIds(a: BoardDocument, b: BoardDocument): string[] {
  if (a === b) return [];
  const out: string[] = [];
  for (const [id, r] of a.records) if (b.records.get(id) !== r) out.push(id);
  for (const id of b.records.keys()) if (!a.records.has(id)) out.push(id);
  return out.sort(byCodeUnit);
}

/** One anchor per island of a net with missing links: the anchor nearest the other islands (pads before track ends), its object's layers merged. */
export function islandAnchorsOf(run: CheckRunLike, net: string): IslandAnchor[] {
  const idx = new Set<number>();
  for (const l of run.connectivity.links) if (l.net === net) for (const i of l.islands) idx.add(i);
  const islands = [...idx].sort((x, y) => x - y).map((i) => run.connectivity.islands[i]).filter((i) => i && i.anchors.length);
  if (islands.length < 2) return [];
  const center = (as: readonly { x: number; y: number }[]) => ({ x: as.reduce((s, p) => s + p.x, 0) / as.length, y: as.reduce((s, p) => s + p.y, 0) / as.length });
  const centers = islands.map((i) => center(i.anchors));
  return islands.map((isl, k) => {
    const others = centers.filter((_, j) => j !== k);
    const target = center(others);
    const byObject = new Map<string, IslandAnchor>();
    for (const a of isl.anchors) {
      const got = byObject.get(a.object);
      if (got) {
        if (!got.layers.includes(a.layer)) got.layers.push(a.layer);
      } else byObject.set(a.object, { object: a.object, x: a.x, y: a.y, layers: [a.layer] });
    }
    const isPad = (o: string) => !o.startsWith("trk:") && !o.startsWith("via:");
    const best = [...byObject.values()].sort((p, q) => Number(isPad(q.object)) - Number(isPad(p.object)) || Math.hypot(p.x - target.x, p.y - target.y) - Math.hypot(q.x - target.x, q.y - target.y) || byCodeUnit(p.object, q.object))[0];
    return { ...best, layers: [...best.layers].sort(byCodeUnit) };
  });
}

/** Net-local scoring from a board: one full check run (and fill) now, then only what changes. */
export function createLocalScoring<F extends { fill: unknown; recomputed: readonly { zone: string }[] }>(doc: BoardDocument, deps: LocalScoringDeps<F>): LocalScoring {
  const t0 = performance.now();
  const stats = { full: 1, incremental: 0, ms: 0 };
  let fill: F | undefined = deps.fills && hasZones(doc) ? deps.fills.fill(doc) : undefined;
  const checks = deps.checks(doc, fill ? { fills: fill.fill } : {});
  const base = checks.result;
  let cur = doc;
  const runs = new WeakMap<BoardDocument, CheckRunLike>();
  runs.set(doc, base);
  stats.ms += performance.now() - t0;

  const runFor = (next: BoardDocument): CheckRunLike => {
    const hit = runs.get(next);
    if (hit) return hit;
    const t = performance.now();
    const changed = changedIds(cur, next);
    let fillChanged: string[] | undefined;
    if (deps.fills && (fill || hasZones(next))) {
      fill = fill ? deps.fills.refill(next, fill, changed) : deps.fills.fill(next);
      fillChanged = [...new Set(fill.recomputed.map((r) => r.zone))].sort(byCodeUnit);
    }
    // the fill goes to the checks only when a zone was refilled (an unchanged fill keeps the update local)
    const u = checks.update(next, changed, fill && fillChanged?.length ? { fills: fill.fill, fillChanged } : {});
    if (u.mode === "full") stats.full++;
    else stats.incremental++;
    cur = next;
    runs.set(next, u.result);
    stats.ms += performance.now() - t;
    return u.result;
  };

  const scorer: BoardScorer = (d): ScorerReport => {
    const r = runFor(d);
    const openNets = [...new Set(r.connectivity.links.map((l) => l.net))].sort(byCodeUnit);
    const errorIds = r.findings.filter((f) => f.severity === "error" && f.check !== "unconnected").map((f) => f.id);
    return { open: r.summary.unconnected, errors: r.summary.errors, openNets, errorIds };
  };
  const islands: IslandSource = (d, nets) => {
    const r = runFor(d);
    const out = new Map<string, IslandAnchor[]>();
    for (const net of nets) {
      const a = islandAnchorsOf(r, net);
      if (a.length > 1) out.set(net, a);
    }
    return out;
  };
  return {
    scorer,
    islands,
    base,
    get stats() {
      return { ...stats, ms: Math.round(stats.ms) };
    },
  };
}

/**
 * The host's own live checks (Node): `createIncrementalChecks` from `@protoboardai/board-checks` kept between
 * changes, so a board read from its files (no service) or a service's client recheck only what a change can reach
 * (contract section 6.2). When the host owns the board's service, the service's live checks (`attachEditing`) are
 * used instead and this is not needed.
 *
 * `noteChanged` collects the ids each change touched; `run` updates the kept checks with them (a full build the
 * first time, after `reset`, or when there is no kept state). The result equals a full `runBoardChecks` run.
 */
import { byCodeUnit, canonicalRecord, withChanges, type BoardDocument, type BoardRecord, type BoardSnapshot, type DerivedZoneFill } from "@protoboardai/board/node";
import type * as ChecksModule from "@protoboardai/board-checks";
import { loadChecksModule } from "./analysis.js";

export interface HostCheckRun {
  result: ChecksModule.BoardCheckResult;
  mode: "incremental" | "full";
  ms: number;
}

export class HostChecks {
  private kept: { checks: ChecksModule.IncrementalChecks; fill?: DerivedZoneFill; seq: number } | undefined;
  private changed = new Set<string>();

  /** Ids a change touched since the last run (a commit's changed, created and removed ids). */
  noteChanged(ids: Iterable<string>): void {
    for (const id of ids) this.changed.add(id);
  }

  /** Start again with a full build at the next run (a new board, or one reloaded whole). */
  reset(): void {
    this.kept = undefined;
    this.changed.clear();
  }

  /** The checks for this snapshot, with this zone fill (`fillChanged`: the zones refilled since the last run). */
  async run(snap: BoardSnapshot, fill: DerivedZoneFill | undefined, fillChanged?: readonly string[]): Promise<HostCheckRun | undefined> {
    const mod = await loadChecksModule();
    if (!mod) return undefined;
    const t = performance.now();
    if (!this.kept) {
      const checks = mod.createIncrementalChecks(snap.doc, fill ? { fills: fill } : {});
      this.kept = { checks, ...(fill ? { fill } : {}), seq: snap.seq };
      this.changed.clear();
      return { result: checks.result, mode: "full", ms: Math.round((performance.now() - t) * 100) / 100 };
    }
    const changed = [...this.changed];
    this.changed.clear();
    const newFill = fill && fill !== this.kept.fill ? fill : undefined;
    const u = this.kept.checks.update(snap.doc, changed, newFill ? { fills: newFill, ...(fillChanged?.length ? { fillChanged: [...fillChanged] } : {}) } : {});
    if (newFill) this.kept.fill = newFill;
    this.kept.seq = snap.seq;
    return { result: u.result, mode: u.mode, ms: Math.round(u.ms * 100) / 100 };
  }
}

/**
 * A board read again from its files, built on the one before so that unchanged records stay the same objects (the
 * incremental checks then rebuild only what changed): the document, and the ids added, changed or removed. A
 * different netlist starts from the fresh document (`whole`).
 */
export function rebase(prev: BoardDocument | undefined, fresh: BoardDocument): { doc: BoardDocument; changed: string[]; whole: boolean } {
  if (!prev || netlistKey(prev) !== netlistKey(fresh)) return { doc: fresh, changed: [], whole: true };
  const puts: BoardRecord[] = [];
  const removes: string[] = [];
  for (const r of fresh.records.values()) {
    const old = prev.records.get(r.id);
    if (!old || canonicalRecord(old) !== canonicalRecord(r)) puts.push(r);
  }
  for (const id of prev.records.keys()) if (!fresh.records.has(id)) removes.push(id);
  if (!puts.length && !removes.length) return { doc: prev, changed: [], whole: false };
  return { doc: withChanges(prev, puts, removes), changed: [...puts.map((r) => r.id), ...removes].sort(byCodeUnit), whole: false };
}

function netlistKey(doc: BoardDocument): string {
  const out: string[] = [];
  for (const [name, n] of doc.nets) out.push(`${name}=${JSON.stringify(n)}`);
  return out.sort(byCodeUnit).join("\n");
}

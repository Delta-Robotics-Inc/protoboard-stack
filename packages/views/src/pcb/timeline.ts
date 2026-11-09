/**
 * The timeline's model (pure, no DOM): the journal as change sets (consecutive entries of one change set make one
 * block, other entries one block each), the error count after each check run as a step line, checkpoints as
 * diamonds, and the x position of each seq across a window of the latest versions. The screen draws it
 * (ui/timeline.tsx).
 */
import type { LogEntry } from "./board.js";
import type { CheckPoint } from "./types.js";

export interface TimelineBlock {
  key: string;
  label: string;
  from: number;
  to: number;
  actor: LogEntry["actor"];
  kind: "human" | "agent" | "router" | "host" | "system";
  entries: number;
  changeSet?: string;
  /** An undo, a redo or a revert. */
  undo?: boolean;
  /** Ids it changed (all entries). */
  ids: string[];
}

/** Group log entries into blocks: one per change set run, else one per entry. */
export function blocksOf(log: readonly LogEntry[]): TimelineBlock[] {
  const out: TimelineBlock[] = [];
  for (const e of log) {
    const last = out.at(-1);
    const ids = [...e.changed, ...Object.values(e.created)];
    if (last && e.changeSet && last.changeSet === e.changeSet && last.to === e.seq - 1) {
      last.to = e.seq;
      last.entries++;
      last.ids.push(...ids);
      continue;
    }
    out.push({
      key: `${e.seq}`,
      label: e.label,
      from: e.seq,
      to: e.seq,
      actor: e.actor,
      kind: e.actor.kind,
      entries: 1,
      ...(e.changeSet ? { changeSet: e.changeSet } : {}),
      ...(e.undoOf !== undefined || e.redoOf !== undefined || e.revertOf !== undefined ? { undo: true } : {}),
      ids,
    });
  }
  return out;
}

export interface TimelineScale {
  min: number;
  max: number;
  /** 0 to 1 across the lanes. */
  x(seq: number): number;
  /** The seq nearest a 0 to 1 position. */
  seqAt(f: number): number;
}

/** A window of the latest `span` versions ending at `seq` (at least one version wide). */
export function scaleFor(seq: number, span = 24): TimelineScale {
  const max = Math.max(seq, 1);
  const min = Math.max(0, max - span);
  const w = Math.max(1, max - min);
  return { min, max, x: (s) => (Math.min(max, Math.max(min, s)) - min) / w, seqAt: (f) => Math.round(min + Math.min(1, Math.max(0, f)) * w) };
}

/** The error line as points (x 0..1, y 0..1, 1 the most errors in view), stepping at each check run. */
export function errorLine(history: readonly CheckPoint[] | undefined, scale: TimelineScale): { points: [number, number][]; peak: number; last?: CheckPoint } {
  const h = [...(history ?? [])].sort((a, b) => a.seq - b.seq);
  if (!h.length) return { points: [], peak: 0 };
  const before = h.filter((p) => p.seq <= scale.min).at(-1);
  const inView = h.filter((p) => p.seq > scale.min);
  const pts = [...(before ? [{ ...before, seq: scale.min }] : []), ...inView];
  const value = (p: CheckPoint) => p.errors + p.unconnected;
  const peak = Math.max(1, ...pts.map(value));
  const out: [number, number][] = [];
  for (const [i, p] of pts.entries()) {
    const x = scale.x(p.seq);
    const y = value(p) / peak;
    if (i > 0) out.push([x, out[out.length - 1][1]]);
    out.push([x, y]);
  }
  if (out.length) out.push([1, out[out.length - 1][1]]);
  return { points: out, peak, last: h.at(-1) };
}

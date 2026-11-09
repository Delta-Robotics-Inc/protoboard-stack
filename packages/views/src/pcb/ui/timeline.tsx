/**
 * The bottom timeline: the real journal as blocks (one per change set run, else one per transaction; a person's
 * work bold, an agent's dashed, a router's dotted), the error count after each check run as a line, checkpoints
 * (Git commits) as diamonds and saves as ticks, and a fourth lane per mode: Draft (writes in flight and the gesture
 * in progress), Queue (review), Router (an autoroute run's stages) or Probe (a diagnosis). A click on the lanes or a
 * block shows the board at that seq, read only (replay); the play button steps through the window; Esc or the live
 * end returns to the board as it is.
 */
import { useMemo, useRef, type ReactNode } from "react";
import type { LogEntry } from "../board.js";
import { blocksOf, errorLine, scaleFor } from "../timeline.js";
import type { CheckPoint, CheckSummary } from "../types.js";
import { Icon } from "./icons.js";

export interface LaneBlock {
  key: string;
  label: string;
  /** Where on the seq axis it sits (the next seq for drafts). */
  seq: number;
  tone: "draft" | "queue" | "queue-on" | "done" | "router" | "router-fail" | "fallback" | "probe" | "fail";
  title?: string;
  onClick?: () => void;
}

export interface TimelineProps {
  log: readonly LogEntry[] | undefined;
  seq: number;
  epoch: string;
  checks: CheckSummary;
  history?: readonly CheckPoint[];
  saves: number[];
  checkpoints: { seq: number; label: string; committed?: string }[];
  /** The seq shown when replaying (else the live board). */
  replay?: number;
  replayNote?: string;
  /** The block whose objects are selected. */
  selected?: string;
  title: string;
  sub: string;
  /** The fourth lane: its name and blocks, in order (`end`: at the live end, as drafts are). */
  lane?: { name: string; blocks: LaneBlock[]; align?: "start" | "end" };
  writable: boolean;
  onSelect: (block: { from: number; to: number; ids: string[] } | undefined) => void;
  onScrub: (seq: number | undefined) => void;
  onPlay: () => void;
  playing: boolean;
  onUndo?: () => void;
  onCheckpoint?: () => void;
}

const SPAN = 24;
/** At most this many blocks in the mode's lane: each keeps room for its label; the rest are counted in one block. */
const LANE_MAX = 8;

/** The mode lane's blocks that fit: a window around the one in hand, and a count of the rest. */
export function laneWindow(blocks: readonly LaneBlock[], max = LANE_MAX): { shown: LaneBlock[]; before: LaneBlock[]; after: LaneBlock[] } {
  if (blocks.length <= max) return { shown: [...blocks], before: [], after: [] };
  const on = Math.max(0, blocks.findIndex((b) => b.tone === "queue-on"));
  const room = max - 1;
  const start = Math.min(Math.max(0, on - 1), blocks.length - room);
  return { shown: blocks.slice(start, start + room), before: blocks.slice(0, start), after: blocks.slice(start + room) };
}

export function Timeline(p: TimelineProps) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const entries = p.log ?? [];
  const scale = useMemo(() => scaleFor(p.seq, SPAN), [p.seq]);
  const blocks = useMemo(() => blocksOf(entries).filter((b) => b.to > scale.min), [entries, scale]);
  const slots = scale.max - scale.min + 1;
  const left = (seq: number) => `${(((seq - scale.min) / slots) * 100).toFixed(3)}%`;
  const width = (n: number) => `calc(${((n / slots) * 100).toFixed(3)}% - 3px)`;
  const line = errorLine(p.history, { ...scale, x: (s) => (s - scale.min + 0.5) / slots });
  const cursor = p.replay ?? p.seq;
  const scrub = (clientX: number) => {
    const el = lanesRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = (clientX - r.left) / r.width;
    const s = Math.round(scale.min + f * slots - 0.5);
    p.onScrub(s >= p.seq ? undefined : Math.max(scale.min, s));
  };
  const win = laneWindow(p.lane?.blocks ?? []);
  const lane = (children: ReactNode, className = "") => <div className={`lane ${className}`}>{children}</div>;
  return (
    <div className={`pcb-float pcb-timeline${p.lane ? " four" : ""}${p.replay !== undefined ? " replaying" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <button className="play" disabled={!entries.length} onClick={p.onPlay} title={p.playing ? "Stop the replay" : "Replay this window of the journal, read only"}>
          <Icon name={p.playing ? "stop" : "play"} size={12} />
        </button>
        <button className="pcb-btn ghost" disabled={!p.onUndo} onClick={p.onUndo} title="Undo your last change (Ctrl+Z); undo takes back only your own changes" style={{ padding: 0, width: 26 }}>
          <Icon name="undo" size={14} />
        </button>
        <div className="title">
          <b>{p.title}</b>
          <span>{p.sub}</span>
        </div>
        {p.replay !== undefined && (
          <button className="pcb-chip on" onClick={() => p.onScrub(undefined)} title="Back to the live board (Esc)">
            replay · seq {p.replay} of {p.seq} · read only · esc
          </button>
        )}
        <button className="pcb-btn" disabled={!p.onCheckpoint} onClick={p.onCheckpoint} title={p.onCheckpoint ? "Save, then commit the board folder to Git with a prepared message (never pushes)" : "This host does not make checkpoints"}>
          <Icon name="commit" size={13} /> Checkpoint = git commit
        </button>
      </div>
      <div className="lane-names">
        <span>Changes</span>
        <span>Errors</span>
        <span>Checkpoints</span>
        {p.lane && <span>{p.lane.name}</span>}
      </div>
      <div
        className="lanes"
        ref={lanesRef}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          scrub(e.clientX);
        }}
        title="Click to see the board at that version (read only)"
      >
        {lane(
          <>
            {!entries.length && <span className="mute mono empty">{p.log === undefined ? "This host gives no transaction log." : "Changes appear here as people, agents and routers commit them."}</span>}
            {blocks.map((b) => {
              const from = Math.max(b.from, scale.min + 1);
              return (
                <button
                  key={b.key}
                  className={`pcb-block ${b.kind}${b.undo ? " undo" : ""}${p.selected === b.key ? " on" : ""}`}
                  style={{ position: "absolute", left: left(from), width: width(b.to - from + 1) }}
                  onClick={() => p.onSelect(p.selected === b.key ? undefined : { from: b.from, to: b.to, ids: b.ids })}
                  title={`${b.label}\nseq ${b.from}${b.to !== b.from ? ` to ${b.to}` : ""} · ${b.actor.kind} ${b.actor.name ?? b.actor.id} · ${b.entries} transaction${b.entries === 1 ? "" : "s"}${b.changeSet ? ` · change set ${b.changeSet}` : ""}`}
                >
                  {b.to !== b.from ? `${b.from}-${b.to}` : b.from} {b.label}
                </button>
              );
            })}
          </>,
        )}
        {lane(
          line.points.length ? (
            <>
              <svg className="errline" viewBox="0 0 100 20" preserveAspectRatio="none">
                <polyline points={line.points.map(([x, y]) => `${(x * 100).toFixed(2)},${(17 - y * 14).toFixed(2)}`).join(" ")} fill="none" stroke="var(--pcb-fail)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
              </svg>
              {line.last && (
                <span className="errcount mono" style={line.last.seq - scale.min > slots * 0.7 ? { right: `calc(100% - ${left(Math.min(scale.max, line.last.seq))})`, transform: "translateX(-6px)" } : { left: left(Math.min(scale.max, line.last.seq) + 0.5) }}>
                  {line.last.errors} err · {line.last.unconnected} open
                </span>
              )}
            </>
          ) : (
            <span className="mute mono empty">{p.checks.ran ? `${p.checks.errors} errors · ${p.checks.unconnected} unconnected (one run so far)` : "No check has run yet."}</span>
          ),
        )}
        {lane(
          <>
            {!p.checkpoints.length && !p.saves.length && <span className="mute mono empty">No save or checkpoint in this session.</span>}
            {p.saves
              .filter((s) => s > scale.min)
              .map((s, i) => (
                <span key={`s${i}`} className="tick" style={{ left: left(s + 0.5) }} title={`saved at seq ${s}`} />
              ))}
            {p.checkpoints
              .filter((c) => c.seq > scale.min)
              .map((c, i) => (
                <span key={`c${i}`} className="cp" style={{ left: left(c.seq + 0.5) }} title={`${c.committed ? `git commit ${c.committed}` : "checkpoint"} · ${c.label}`}>
                  <span className="pcb-diamond" />
                  <span className="strong">{c.committed ? c.committed : c.label}</span>
                </span>
              ))}
          </>,
        )}
        {p.lane &&
          lane(
            <>
              {!p.lane.blocks.length && <span className="mute mono empty">Nothing here yet.</span>}
              <div className="flow" style={{ justifyContent: p.lane.align === "end" ? "flex-end" : "flex-start" }}>
                {win.before.length > 0 && (
                  <span className="pcb-block lane-more" title={win.before.map((b) => b.label).join("\n")}>
                    {win.before.length} before
                  </span>
                )}
                {win.shown.map((b) => (
                  <button key={b.key} className={`pcb-block lane-${b.tone}`} onClick={b.onClick} title={b.title && b.title !== b.label ? `${b.label}\n${b.title}` : b.label}>
                    {b.label}
                  </button>
                ))}
                {win.after.length > 0 && (
                  <span className="pcb-block lane-more" title={win.after.map((b) => b.label).join("\n")}>
                    +{win.after.length} more
                  </span>
                )}
              </div>
            </>,
          )}
        <div className="cursor" style={{ left: `calc(${left(cursor)} + ${((1 / slots) * 50).toFixed(3)}%)` }} />
      </div>
      {p.replayNote && <div className="replay-note mono">{p.replayNote}</div>}
    </div>
  );
}

/**
 * The fixed regions around the board: top bar with the depth switcher, the app gutter, the floating tool rail,
 * the agent bar, the timeline and the status line. Each says only what it was handed; where a feed is missing it
 * says so instead of showing sample values.
 */
import type { ReactNode } from "react";
import type { LogEntry, Presence } from "../board.js";
import type { CheckSummary, DepthView } from "../types.js";
import type { Tool } from "../BoardCanvas.js";
import { Icon } from "./icons.js";

const DEPTHS: { id: DepthView; label: string }[] = [
  { id: "system", label: "System" },
  { id: "schematic", label: "Schematic" },
  { id: "layout", label: "Layout" },
  { id: "3d", label: "3D" },
];

export interface TopBarProps {
  crumbs: string[];
  onNavigate?: (v: DepthView) => void;
  seq: number;
  saved?: number;
  reviewCount: number;
  onReview: () => void;
  onCheck?: () => void;
  onExport?: () => void;
}

export function TopBar(p: TopBarProps) {
  return (
    <header className="pcb-top">
      <div className="pcb-brand">
        <span className="mark">P</span>PROTOBOARD
      </div>
      <nav className="pcb-crumbs caps">
        {p.crumbs.map((c, i) => (
          <span key={i}>{i === p.crumbs.length - 1 ? <b>{c}</b> : <>{c} /</>}</span>
        ))}
      </nav>
      <div className="pcb-switch caps" role="tablist" aria-label="Depth">
        {DEPTHS.map((d, i) => (
          <span key={d.id} style={{ display: "contents" }}>
            {i > 0 && <span className="dash" />}
            <button className={d.id === "layout" ? "on" : ""} disabled={!p.onNavigate && d.id !== "layout"} onClick={() => p.onNavigate?.(d.id)} title={`${d.label} (${i + 1})`} role="tab" aria-selected={d.id === "layout"}>
              <span className="key">{i + 1}</span>
              {d.label}
            </button>
          </span>
        ))}
      </div>
      <div className="pcb-topright">
        <span className="pcb-chip" title="The board's version in this session and its last save">
          seq {p.seq} · {p.saved === undefined ? "not saved this session" : p.saved === p.seq ? "saved" : `saved at ${p.saved}`}
        </span>
        {p.reviewCount > 0 && (
          <button className="pcb-btn main" onClick={p.onReview} title="Go through the findings one by one">
            <Icon name="list" size={13} /> Review {p.reviewCount}
          </button>
        )}
        <button className="pcb-btn" disabled={!p.onCheck} onClick={p.onCheck} title={p.onCheck ? "Run the checks" : "No checker is attached to this screen"}>
          <Icon name="check" size={13} /> Check
        </button>
        <button className="pcb-btn" disabled={!p.onExport} onClick={p.onExport} title={p.onExport ? "Export" : "Export comes with the release flow"}>
          <Icon name="download" size={13} /> Export
        </button>
      </div>
    </header>
  );
}

export function Gutter({ errors }: { errors: number }) {
  return (
    <aside className="pcb-gutter">
      <button className="on" title="Layout">
        <Icon name="board" />
      </button>
      <button title="Checks">
        <Icon name="alert" />
        {errors > 0 && <span className="dot" />}
      </button>
      <button title="History">
        <Icon name="history" />
      </button>
      <span className="spacer" />
      <button title="Settings">
        <Icon name="settings" />
      </button>
      <button title="Account">
        <Icon name="user" />
      </button>
    </aside>
  );
}

export interface RailProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  onFlip: () => void;
  flipped: boolean;
  onFit: () => void;
  onCapture: () => void;
  markers: boolean;
  onMarkers: () => void;
  errors: number;
}

const PLANNED = "Phase 2: editing tools come with interactive routing";

export function Rail(p: RailProps) {
  const B = ({ icon, k, title, on, disabled, onClick, badge }: { icon: string; k?: string; title: string; on?: boolean; disabled?: boolean; onClick?: () => void; badge?: ReactNode }) => (
    <button className={on ? "on" : ""} title={disabled ? `${title} (${PLANNED})` : k ? `${title} (${k})` : title} disabled={disabled} onClick={onClick} aria-pressed={on}>
      <Icon name={icon} />
      {k && <span className="k">{k.toLowerCase()}</span>}
      {badge}
    </button>
  );
  return (
    <div className="pcb-float pcb-rail" onPointerDown={(e) => e.stopPropagation()}>
      <B icon="select" k="V" title="Select" on={p.tool === "select"} onClick={() => p.onTool("select")} />
      <B icon="route" k="X" title="Route" disabled />
      <B icon="via" title="Via" disabled />
      <B icon="zone" title="Zone" disabled />
      <B icon="keepout" title="Keep-out" disabled />
      <B icon="text" title="Text" disabled />
      <B icon="measure" k="M" title="Measure" on={p.tool === "measure"} onClick={() => p.onTool(p.tool === "measure" ? "select" : "measure")} />
      <span className="sep" />
      <B icon="flip" k="B" title={p.flipped ? "View from the top" : "View from the bottom"} on={p.flipped} onClick={p.onFlip} />
      <B icon="fit" k="F" title="Fit the board" onClick={p.onFit} />
      <B icon="camera" title="Save a PNG of this view" onClick={p.onCapture} />
      <B icon="alert" title={p.markers ? "Hide finding markers" : "Show finding markers"} on={p.markers} onClick={p.onMarkers} badge={p.errors > 0 ? <span className="badge">{p.errors > 9 ? "9+" : p.errors}</span> : undefined} />
    </div>
  );
}

/** What the agent bar says, from the service's presence and log. */
export function agentState(presence: Presence | undefined, log: readonly LogEntry[] | undefined, now: number): { title: string; sub: string; working: boolean } {
  if (!presence) return { title: "Ready", sub: "this host gives no presence feed", working: false };
  const leases = presence.leases.filter((l) => l.holder.kind !== "human");
  if (leases.length) {
    const l = leases[leases.length - 1];
    const scope = [l.roots.length ? `${l.roots.length} subtree${l.roots.length > 1 ? "s" : ""}` : "", l.nets.length ? `${l.nets.length} net${l.nets.length > 1 ? "s" : ""}` : "", l.region ? "a region" : ""].filter(Boolean).join(", ");
    const left = Math.max(0, Math.round((l.expiresAt - now) / 1000));
    return { title: `${l.holder.name ?? l.holder.id} is working`, sub: `lease on ${scope || "the board"} · ${left} s left · purpose: ${l.purpose}`, working: true };
  }
  const intent = presence.intents.filter((i) => i.actor.kind !== "human").at(-1);
  const last = (log ?? []).filter((e) => e.actor.kind === "agent" || e.actor.kind === "router").at(-1);
  if (intent) return { title: "Ready", sub: `last: ${intent.label} · ${intent.ids.length} object${intent.ids.length === 1 ? "" : "s"}`, working: false };
  if (last) return { title: "Ready", sub: `last: ${last.label} · seq ${last.seq}`, working: false };
  return { title: "Ready", sub: "no agent has changed this board in this session", working: false };
}

export function AgentBar({ state }: { state: { title: string; sub: string; working: boolean } }) {
  return (
    <div className={`pcb-float pcb-agent${state.working ? " working" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <span className="who">
        <Icon name="sparkle" size={14} /> Agent
      </span>
      <span className="what">
        <b>{state.title}</b>
        <span>{state.sub}</span>
      </span>
      <button className="pcb-btn" disabled title="Asking the agent comes with Phase 2">
        <Icon name="sparkle" size={12} /> Ask <span className="pcb-chip" style={{ height: 15, fontSize: 8 }}>Ctrl K</span>
      </button>
    </div>
  );
}

export interface TimelineProps {
  log: readonly LogEntry[] | undefined;
  seq: number;
  epoch: string;
  saves: number[];
  checks: CheckSummary;
  selected?: number;
  onSelect: (e: LogEntry | undefined) => void;
}

export function Timeline(p: TimelineProps) {
  const entries = p.log ?? [];
  const last = entries.at(-1);
  const blocks = entries.slice(-12);
  return (
    <div className="pcb-float pcb-timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <button className="play" disabled title="Replay comes with Phase 2">
          <Icon name="play" size={12} />
        </button>
        <button className="pcb-btn ghost" disabled title="Undo is per person; the editor's undo comes with editing" style={{ padding: 0, width: 26 }}>
          <Icon name="undo" size={14} />
        </button>
        <div className="title">
          <b>{last ? `Seq ${p.seq} · ${last.label}` : `Seq ${p.seq} · no change yet this session`}</b>
          <span>
            {p.log === undefined ? "this host gives no transaction log" : `epoch ${p.epoch} · ${entries.length} transaction${entries.length === 1 ? "" : "s"} this session · ${p.saves.length ? `last saved at seq ${p.saves.at(-1)}` : "not saved yet"}`}
          </span>
        </div>
        <button className="pcb-btn" disabled title="The host makes Git commits at checkpoints">
          <Icon name="commit" size={13} /> Checkpoint = git commit
        </button>
      </div>
      <div className="lane-names">
        <span>Changes</span>
        <span>Checks</span>
        <span>Saves</span>
      </div>
      <div className="lanes">
        <div className="lane">
          {blocks.length === 0 && <span className="mute mono" style={{ fontSize: 9.5 }}>Changes appear here as people, agents and routers commit them.</span>}
          {blocks.map((e) => (
            <button
              key={e.seq}
              className={`pcb-block ${e.actor.kind}${p.selected === e.seq ? " on" : ""}`}
              onClick={() => p.onSelect(p.selected === e.seq ? undefined : e)}
              title={`seq ${e.seq} · ${e.actor.kind} ${e.actor.name ?? e.actor.id} · ${e.changed.length} changed${e.removed.length ? `, ${e.removed.length} removed` : ""}`}
            >
              {e.seq} {e.label}
            </button>
          ))}
        </div>
        <div className="lane mono" style={{ fontSize: 9.5 }}>
          {p.checks.ran ? (
            <span className="strong">
              {p.checks.errors} errors · {p.checks.warnings} warnings · {p.checks.unconnected} unconnected{p.checks.seq !== undefined ? ` at seq ${p.checks.seq}` : ""}
            </span>
          ) : (
            <span className="mute">No check has run yet.</span>
          )}
        </div>
        <div className="lane mono" style={{ fontSize: 9.5 }}>
          {p.saves.length === 0 && <span className="mute">Not saved in this session.</span>}
          {p.saves.slice(-6).map((s, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="pcb-diamond" />
              <span className="strong">saved · seq {s}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface StatusProps {
  checks: CheckSummary;
  cursor?: { x: number; y: number };
  grid: number;
  flipped: boolean;
  scale: number;
  active: string;
}

export function StatusLine(p: StatusProps) {
  const c = p.checks;
  return (
    <footer className="pcb-status">
      {c.ran ? (
        <>
          <span className="item" style={{ color: "var(--pcb-warn)" }}>
            ▲ <b>{c.unconnected}</b> <span className="mute">unconnected</span>
          </span>
          <span className="item" style={{ color: "var(--pcb-fail)" }}>
            ✖ <b>{c.errors}</b> <span className="mute">errors</span>
          </span>
          <span className="item" style={{ color: "var(--pcb-body)" }}>
            ◌ <b>{c.warnings}</b> <span className="mute">warnings</span>
          </span>
          <span className="item">
            ours{c.at ? ` · ${c.at}` : ""}
            {c.ms !== undefined ? ` · ${Math.round(c.ms)} ms` : ""}
          </span>
          {c.crossCheck && (
            <span className="item">
              {c.crossCheck.tool} <b>{c.crossCheck.unconnected}</b> · <b>{c.crossCheck.errors}</b> · <b>{c.crossCheck.warnings}</b>
              {c.crossCheck.difference && <span className="pcb-chip warn">{c.crossCheck.difference}</span>}
            </span>
          )}
        </>
      ) : (
        <span className="item">No check has run on this board yet: there are no counts to show.</span>
      )}
      <span className="right">
        <span>
          active <b>{p.active}</b>
        </span>
        <span>{p.flipped ? "seen from the bottom" : "seen from the top"}</span>
        <span>origin board center</span>
        <span>
          X <b>{p.cursor ? p.cursor.x.toFixed(2) : "-"}</b> Y <b>{p.cursor ? p.cursor.y.toFixed(2) : "-"}</b> mm
        </span>
        <span>
          grid <b>{p.grid}</b>
        </span>
        <span>{p.scale >= 10 ? Math.round(p.scale) : p.scale.toFixed(1)} px/mm</span>
      </span>
    </footer>
  );
}

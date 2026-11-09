/**
 * The agent bar: one slot at the top of the canvas that says what is happening, from the service's presence and
 * log: ready (the last agent or router change), an agent working (its lease, purpose and time left, with Pause and
 * Take over), a router run in progress (step, router, progress, Cancel), the review item in hand, a diagnosis, or
 * a proposal waiting. Modes change what sits in it; they never add a region.
 */
import type { LogEntry, Presence } from "../board.js";
import { Icon } from "./icons.js";

export interface AgentBarButton {
  label: string;
  icon?: string;
  onClick?: () => void;
  /** Why it is off (shown as its title). */
  disabled?: string;
  key?: string;
  tone?: "on" | "plain";
}

export interface AgentBarState {
  who: "Agent" | "Router";
  title: string;
  sub: string;
  working?: boolean;
  /** 0 to 1, for a run in progress. */
  progress?: number;
  buttons?: AgentBarButton[];
}

/** What the bar says from presence and log alone (no mode). */
export function presenceState(presence: Presence | undefined, log: readonly LogEntry[] | undefined, now: number, handlers: { onTakeOver?: () => void }): AgentBarState {
  if (!presence) return { who: "Agent", title: "Ready", sub: "this host gives no presence feed" };
  const leases = presence.leases.filter((l) => l.holder.kind !== "human");
  if (leases.length) {
    const l = leases[leases.length - 1];
    const scope = [l.roots.length ? l.roots.map((r) => (r === "" ? "the whole board" : `${r}/`)).join(", ") : "", l.nets.length ? `${l.nets.length} net${l.nets.length > 1 ? "s" : ""}` : "", l.region ? "a region" : ""].filter(Boolean).join(", ");
    const left = Math.max(0, Math.round((l.expiresAt - now) / 1000));
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const last = (log ?? []).filter((e) => e.actor.id === l.holder.id).at(-1);
    return {
      who: l.holder.kind === "router" ? "Router" : "Agent",
      title: l.purpose || `${l.holder.name ?? l.holder.id} is working`,
      sub: `${l.holder.name ?? l.holder.id} · lease on ${scope || "the board"} · ${mmss} left${last ? ` · last: ${last.label}` : ""}`,
      working: true,
      buttons: [
        { label: "Pause", icon: "pause", disabled: "Pausing an agent needs a channel to it, which this host does not have yet: Take over stops its writes" },
        { label: "Take over", icon: "hand", tone: "on", ...(handlers.onTakeOver ? { onClick: handlers.onTakeOver } : { disabled: "this host is read only" }) },
      ],
    };
  }
  const intent = presence.intents.filter((i) => i.actor.kind !== "human").at(-1);
  const last = (log ?? []).filter((e) => e.actor.kind === "agent" || e.actor.kind === "router").at(-1);
  if (intent) return { who: "Agent", title: "Ready", sub: `last: ${intent.label} · ${intent.ids.length} object${intent.ids.length === 1 ? "" : "s"} · ${intent.actor.name ?? intent.actor.id}` };
  if (last) return { who: last.actor.kind === "router" ? "Router" : "Agent", title: "Ready", sub: `last: ${last.label} · seq ${last.seq} · ${last.actor.name ?? last.actor.id}` };
  return { who: "Agent", title: "Ready", sub: "no agent has changed this board in this session" };
}

export function AgentBar({ state }: { state: AgentBarState }) {
  return (
    <div className={`pcb-float pcb-agent${state.working ? " working" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <span className="who">
        <Icon name={state.who === "Router" ? "route" : "sparkle"} size={14} /> {state.who}
      </span>
      <span className="what">
        <b>{state.title}</b>
        <span>{state.sub}</span>
        {state.progress !== undefined && (
          <i className="bar">
            <i style={{ width: `${Math.round(Math.min(1, Math.max(0, state.progress)) * 100)}%` }} />
          </i>
        )}
      </span>
      {state.progress !== undefined && <span className="pct mono">{Math.round(state.progress * 100)}%</span>}
      {(state.buttons ?? []).map((b) => (
        <button key={b.label} className={`pcb-btn${b.tone === "on" ? " sel" : ""}`} disabled={!!b.disabled || !b.onClick} title={b.disabled ?? b.label} onClick={b.onClick}>
          {b.icon && <Icon name={b.icon} size={12} />} {b.label}
          {b.key && <span className="kbd">{b.key}</span>}
        </button>
      ))}
    </div>
  );
}

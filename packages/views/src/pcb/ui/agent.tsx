/**
 * The agent bar: one slot at the top of the canvas that says what is happening, from the service's presence and
 * log: ready (the last agent or router change), an agent working (its lease, purpose and time left, with Pause and
 * Take over), a router run in progress (step, router, progress, Cancel), the review item in hand, a diagnosis, or
 * a proposal waiting. Modes change what sits in it; they never add a region.
 */
import { useEffect, useState } from "react";
import type { LogEntry, Presence } from "../board.js";
import type { SideMessage } from "../remote.js";
import type { PagePause, PageRefusal } from "../types.js";
import { Icon } from "./icons.js";

/** The writes of agents and routers the service refused (paused or held), as the host's feed reports them (the last 50). */
export function useRefusals(onSide: ((l: (m: SideMessage) => void) => () => void) | undefined): PageRefusal[] {
  const [list, setList] = useState<PageRefusal[]>([]);
  useEffect(() => onSide?.((m) => m.type === "refusal" && setList((l) => [...l, m.refusal].slice(-50))), [onSide]);
  return list;
}

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

export interface PresenceHandlers {
  onTakeOver?: () => void;
  /** Pause agents and routers (absent: read only). */
  onPause?: () => void;
  onResume?: () => void;
  /** Writes of agents and routers the service refused while this screen watched (newest last). */
  refusals?: readonly PageRefusal[];
  /** Proposals waiting for a person, and how to open them. */
  waiting?: { count: number; onOpen: () => void };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const who = (a: { kind: string; id: string; name?: string }) => a.name ?? a.id;

/** The pause a presence carries (a core without pausing never has one). */
export const pauseOf = (presence: Presence | undefined): PagePause | undefined => (presence as (Presence & { paused?: PagePause }) | undefined)?.paused;

/** What the bar says from presence and log alone (no mode). */
export function presenceState(presence: Presence | undefined, log: readonly LogEntry[] | undefined, now: number, handlers: PresenceHandlers): AgentBarState {
  if (!presence) return { who: "Agent", title: "Ready", sub: "this host gives no presence feed" };
  const ro = "this host is read only";
  const leases = presence.leases.filter((l) => l.holder.kind !== "human");
  const takeOver: AgentBarButton = { label: "Take over", icon: "hand", tone: "on", ...(handlers.onTakeOver ? { onClick: handlers.onTakeOver } : { disabled: ro }) };
  const waiting: AgentBarButton[] = handlers.waiting?.count ? [{ label: `${handlers.waiting.count} proposal${handlers.waiting.count === 1 ? "" : "s"}`, icon: "sparkle", onClick: handlers.waiting.onOpen }] : [];
  const pause = pauseOf(presence);
  if (pause) {
    const refused = (handlers.refusals ?? []).filter((r) => r.reason === "paused" && r.at >= pause.since);
    const last = refused.at(-1);
    const byYou = pause.by.kind === "human";
    return {
      who: "Agent",
      title: byYou ? "Agents paused by you" : `Agents paused by ${who(pause.by)}`,
      sub: [refused.length ? `${refused.length} write${refused.length === 1 ? "" : "s"} refused · last: ${who(last!.actor)}${last!.label ? ` "${last!.label}"` : ""}` : leases.length ? `${leases.length} agent lease${leases.length === 1 ? "" : "s"} held, no writes` : "no agent write refused yet · proposals still arrive", `since ${new Date(pause.since).toTimeString().slice(0, 8)}`, pause.until ? `resumes by itself in ${clock(pause.until - now)}` : "until you resume", pause.reason ?? ""].filter(Boolean).join(" · "),
      buttons: [...waiting, { label: "Resume", icon: "play", tone: "on", ...(handlers.onResume ? { onClick: handlers.onResume } : { disabled: ro }) }, ...(leases.length ? [{ ...takeOver, tone: "plain" as const }] : [])],
    };
  }
  const pauseBtn: AgentBarButton = { label: "Pause", icon: "pause", ...(handlers.onPause ? { onClick: handlers.onPause } : { disabled: ro }) };
  if (leases.length) {
    const l = leases[leases.length - 1];
    const scope = [l.roots.length ? l.roots.map((r) => (r === "" ? "the whole board" : `${r}/`)).join(", ") : "", l.nets.length ? `${l.nets.length} net${l.nets.length > 1 ? "s" : ""}` : "", l.region ? "a region" : ""].filter(Boolean).join(", ");
    const last = (log ?? []).filter((e) => e.actor.id === l.holder.id).at(-1);
    return {
      who: l.holder.kind === "router" ? "Router" : "Agent",
      title: l.purpose || `${l.holder.name ?? l.holder.id} is working`,
      sub: `${l.holder.name ?? l.holder.id} · lease on ${scope || "the board"} · ${clock(l.expiresAt - now)} left${last ? ` · last: ${last.label}` : ""}`,
      working: true,
      buttons: [...waiting, pauseBtn, takeOver],
    };
  }
  const intent = presence.intents.filter((i) => i.actor.kind !== "human").at(-1);
  const last = (log ?? []).filter((e) => e.actor.kind === "agent" || e.actor.kind === "router").at(-1);
  const quiet = [...waiting, pauseBtn];
  if (intent) return { who: "Agent", title: "Ready", sub: `last: ${intent.label} · ${intent.ids.length} object${intent.ids.length === 1 ? "" : "s"} · ${intent.actor.name ?? intent.actor.id}`, buttons: quiet };
  if (last) return { who: last.actor.kind === "router" ? "Router" : "Agent", title: "Ready", sub: `last: ${last.label} · seq ${last.seq} · ${last.actor.name ?? last.actor.id}`, buttons: quiet };
  return { who: "Agent", title: "Ready", sub: "no agent has changed this board in this session", buttons: quiet };
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

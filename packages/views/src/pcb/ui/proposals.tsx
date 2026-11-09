/**
 * Incoming proposals (contract section 4; the concept's L2, L5 and L6): what agents, routers and agents' net
 * changes ask a person to accept. The board service holds them; the host relays them (`proposal` messages) and
 * answers `proposals`, `proposalPreview`, `proposalAccept` and `proposalReject`.
 *
 * - The list (Inspect tab): who, the title, before and after counts, the router's scores, the items with their
 *   nets, and for a stale one why (the commit, by whom, what it changed).
 * - The preview: added copper as the blue ghost, removed copper marked, on the board as it is now.
 * - The card on the canvas for the proposal in hand: Accept all (the one orange action), or Revalidate and accept
 *   when it went stale and its operations still apply, and Reject. Items are accepted or rejected one by one in the
 *   list. After a router's proposal is accepted, the host has checked every locked record byte for byte: the card
 *   says how many hand tracks were verified unchanged.
 *
 * Net changes never get a one-key accept.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copperSvg, SELECT, type ScreenMap } from "../overlay.js";
import type { SideMessage } from "../remote.js";
import type { BoardReplyMessage, BoardRequest, PageActor, PageProposal, PageProposalPreview, PageScore } from "../types.js";
import { useRefusals, type PresenceHandlers } from "./agent.js";
import { Icon } from "./icons.js";

type Ask = (req: BoardRequest, label?: string) => Promise<BoardReplyMessage>;

/** What came of an accept or a reject, in words. */
export interface ProposalOutcome {
  id: string;
  ok: boolean;
  message: string;
}

export interface ProposalsState {
  /** Open and stale proposals, newest first. */
  list: PageProposal[];
  waiting: number;
  /** The list is open in the Inspect tab. */
  open: boolean;
  setOpen: (open: boolean) => void;
  selected: PageProposal | undefined;
  select: (id: string | undefined, items?: string[]) => void;
  preview: PageProposalPreview | undefined;
  previewError: string | undefined;
  busy: boolean;
  outcome: ProposalOutcome | undefined;
  accept: (id: string, options?: { items?: string[]; allowStale?: boolean }) => Promise<void>;
  reject: (id: string, items?: string[]) => Promise<void>;
  /** The ghost diff of the proposal in hand, for the canvas overlay. */
  overlay: (m: ScreenMap) => string;
}

const LIVE = new Set(["open", "stale"]);
const byNewest = (a: PageProposal, b: PageProposal) => b.createdAt - a.createdAt;

/** The proposals of a board, kept current from the host's feed. */
export function useProposals(ask: Ask, onSide: ((l: (m: SideMessage) => void) => () => void) | undefined, writable: boolean, seq: number): ProposalsState {
  const [all, setAll] = useState<Map<string, PageProposal>>(() => new Map());
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<{ id: string; items?: string[] } | undefined>(undefined);
  const [preview, setPreview] = useState<PageProposalPreview | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ProposalOutcome | undefined>(undefined);
  const put = useCallback((ps: PageProposal[]) => setAll((m) => new Map([...m, ...ps.map((p) => [p.id, p] as const)])), []);

  // what the service holds now, then each change as it happens
  useEffect(() => {
    if (!writable) return;
    let gone = false;
    void ask({ method: "proposals" }, "proposals").then((r) => !gone && r.ok && Array.isArray(r.result) && put(r.result as PageProposal[]));
    return () => void (gone = true);
  }, [ask, writable, put]);
  useEffect(() => onSide?.((m) => m.type === "proposal" && put([m.proposal])), [onSide, put]);

  const list = useMemo(() => [...all.values()].filter((p) => LIVE.has(p.status)).sort(byNewest), [all]);
  const selected = sel ? all.get(sel.id) : undefined;

  // the preview follows the board: asked again when the board or the proposal moves on
  const asked = useRef(0);
  useEffect(() => {
    if (!sel || !selected || !LIVE.has(selected.status)) {
      setPreview(undefined);
      return;
    }
    const n = ++asked.current;
    void ask({ method: "proposalPreview", id: sel.id, ...(sel.items ? { items: sel.items } : {}) }, "preview").then((r) => {
      if (n !== asked.current) return;
      if (r.ok) {
        setPreview(r.result as PageProposalPreview);
        setPreviewError(undefined);
      } else setPreviewError(r.error);
    });
  }, [ask, sel, selected?.status, seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((id: string | undefined, items?: string[]) => {
    setOutcome(undefined);
    setPreviewError(undefined);
    setSel(id ? { id, ...(items ? { items } : {}) } : undefined);
  }, []);

  const accept = useCallback(
    async (id: string, options: { items?: string[]; allowStale?: boolean } = {}) => {
      setBusy(true);
      const r = await ask({ method: "proposalAccept", id, ...options }, "accept the proposal");
      setBusy(false);
      const p = all.get(id);
      const o = acceptOutcome(id, p, r);
      setOutcome(o);
      if (o.ok && r.ok) {
        const st = (r.result as { proposalState?: PageProposal }).proposalState;
        if (st) put([st]);
        if (!st || !LIVE.has(st.status)) setSel(undefined);
      }
    },
    [ask, all, put],
  );
  const reject = useCallback(
    async (id: string, items?: string[]) => {
      setBusy(true);
      const r = await ask({ method: "proposalReject", id, ...(items ? { items } : {}) }, "reject the proposal");
      setBusy(false);
      const st = r.ok ? (r.result as { status: string; proposal?: PageProposal; error?: string }) : undefined;
      if (st?.proposal) put([st.proposal]);
      setOutcome({ id, ok: !!st?.proposal, message: st?.proposal ? (items ? `rejected ${items.length} item${items.length === 1 ? "" : "s"}` : "rejected: nothing was applied") : r.ok ? `not rejected: ${st?.error ?? "the service did not take it"}` : r.error });
      if (st?.proposal && !LIVE.has(st.proposal.status)) setSel(undefined);
    },
    [ask, put],
  );

  const overlay = useCallback(
    (m: ScreenMap) => {
      if (!preview || !selected) return "";
      // removed copper marked in a quiet dashed gray (red and green are for check results only), added as the blue ghost
      return copperSvg(preview.removed, m, "#a3a3a3", { dash: "2 3", opacity: 0.9 }) + copperSvg(preview.added, m, SELECT);
    },
    [preview, selected],
  );

  return { list, waiting: list.length, open, setOpen, selected, select, preview: selected ? preview : undefined, previewError, busy, outcome, accept, reject, overlay };
}

/**
 * The agent side of the screen in one hook: the proposals, the agents' refused writes, and the agent bar's handlers
 * (Take over, Pause and Resume, the proposals waiting). `toast` shows what a pause or resume did.
 */
export function useAgentWork(o: { session: { request: Ask }; onSide: ((l: (m: SideMessage) => void) => () => void) | undefined; writable: boolean; seq: number; toast: (t: { ok: boolean; status: "applied" | "error"; message: string; label: string; at: number }) => void; openList: () => void }) {
  const { session, onSide, writable, seq, toast, openList } = o;
  const request = useCallback<Ask>((r, l) => session.request(r, l), [session]);
  const proposals = useProposals(request, onSide, writable, seq);
  const refusals = useRefusals(onSide);
  const say = useCallback(
    (label: string) => (r: BoardReplyMessage) => {
      const x = r.ok ? (r.result as { status?: string; error?: string }) : undefined;
      const ok = r.ok && (x?.status === "paused" || x?.status === "resumed");
      toast({ ok, status: ok ? "applied" : "error", label, message: ok ? (x!.status === "paused" ? "Agents and routers are paused: their writes are refused until you resume (proposals still arrive)" : "Agents and routers may write again") : r.ok ? (x?.error ?? "the service did not take it") : r.error, at: Date.now() });
    },
    [toast],
  );
  const handlers: PresenceHandlers = {
    ...(writable
      ? {
          onTakeOver: () => void request({ method: "takeOver" }, "take over"),
          onPause: () => void request({ method: "pause", reason: "paused from the layout screen" }, "pause agents").then(say("pause agents")),
          onResume: () => void request({ method: "resume" }, "resume agents").then(say("resume agents")),
        }
      : {}),
    refusals,
    ...(proposals.waiting
      ? {
          waiting: {
            count: proposals.waiting,
            onOpen: () => {
              proposals.setOpen(true);
              openList();
            },
          },
        }
      : {}),
  };
  return { proposals, refusals, handlers };
}

/** The words for an accept's reply: applied at which seq, and for a router's proposal the hand tracks verified. */
export function acceptOutcome(id: string, p: PageProposal | undefined, r: BoardReplyMessage): ProposalOutcome {
  if (!r.ok) return { id, ok: false, message: r.error };
  const x = r.result as { status: string; seq?: number; reason?: string; message?: string; error?: string; locked?: { checked: number; changed: string[]; hand: number } };
  if (x.status !== "applied") {
    if (x.reason === "stale-proposal") return { id, ok: false, message: "Not applied: the board changed under this proposal. Revalidate it when its changes still apply, or reject it." };
    return { id, ok: false, message: `Not applied: ${x.reason ?? x.status}${x.message ? ` (${x.message})` : x.error ? ` (${x.error})` : ""}` };
  }
  const lk = x.locked;
  if (lk && lk.changed.length) return { id, ok: false, message: `Applied at seq ${x.seq}, but locked records changed: ${lk.changed.slice(0, 4).join(", ")}${lk.changed.length > 4 ? "…" : ""}. Undo it.` };
  const hand = lk ? `${lk.hand} hand track${lk.hand === 1 ? "" : "s"} verified unchanged` : "";
  const routed = p?.source === "router" || p?.actor.kind === "router";
  return { id, ok: true, message: `Accepted at seq ${x.seq} as your change (undo takes it back)${routed || lk?.hand ? ` · ${hand}` : ""}` };
}

// ---------------------------------------------------------------- views

const name = (a: PageActor) => a.name ?? a.id;
const whoLabel = (p: PageProposal) => (p.source === "needs-person" ? `${name(p.actor)} · needs you` : `${p.actor.kind === "router" ? "Router" : p.actor.kind === "agent" ? "Agent" : p.actor.kind === "human" ? "Person" : "Host"} · ${name(p.actor)}`);
const mmLen = (nm: number) => `${nm >= 0 ? "+" : ""}${(nm / 1e6).toFixed(1)} mm`;
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** Before and after counts (and the router's scores when it gave them). */
function Counts({ p }: { p: PageProposal }) {
  const row = (label: string, a: number, b: number, fmt = (n: number) => String(n)) => (
    <tr key={label}>
      <td>{label}</td>
      <td>{fmt(a)}</td>
      <td>{fmt(b)}</td>
    </tr>
  );
  const s: { current?: PageScore; candidate?: PageScore } = p.scores ?? {};
  return (
    <table className="pcb-table">
      <thead>
        <tr>
          <th />
          <th>before</th>
          <th>after</th>
        </tr>
      </thead>
      <tbody>
        {s.current && s.candidate && row("open", s.current.open, s.candidate.open)}
        {s.current && s.candidate && row("errors", s.current.errors, s.candidate.errors)}
        {row("tracks", p.before.tracks, p.after.tracks)}
        {row("vias", p.before.vias, p.after.vias)}
        {row("records", p.before.records, p.after.records)}
      </tbody>
    </table>
  );
}

const KIND_WORD: Record<string, string> = { trk: "track", via: "via", fp: "part", zone: "zone", kpo: "keep-out", rule: "rule", txt: "text", gfx: "drawing", class: "net class", outline: "outline", waiver: "waiver" };

/** Ids in words by kind ("2 tracks, 1 part"), for a sentence; the ids themselves stay in the title. */
export function idsInWords(ids: readonly string[]): string {
  const n = new Map<string, number>();
  for (const id of ids) {
    const w = KIND_WORD[id.split(":")[0]] ?? "object";
    n.set(w, (n.get(w) ?? 0) + 1);
  }
  return [...n].map(([w, c]) => `${c} ${w}${c === 1 ? "" : "s"}`).join(", ");
}

function staleLine(p: PageProposal): string | undefined {
  if (p.status !== "stale" || !p.stale) return undefined;
  const who = p.stale.actor.kind === "human" ? "you" : name(p.stale.actor);
  return `Stale since seq ${p.stale.seq}: ${who} changed ${p.stale.changed.length ? `${idsInWords(p.stale.changed)} where it works` : "the board where it works"}.`;
}

export interface ProposalsPanelProps {
  state: ProposalsState;
  writable: boolean;
  now: number;
  onClose: () => void;
}

/** The incoming proposals list, in the Inspect tab. */
export function ProposalsPanel({ state: s, writable, now, onClose }: ProposalsPanelProps) {
  return (
    <>
      <div className="pcb-sec">
        <h4>
          <span>Proposals</span>
          <i>{s.waiting ? `${s.waiting} waiting for you` : "none waiting"}</i>
        </h4>
        <p className="pcb-p">Agents and routers propose; nothing changes until you accept. Accepting is one change of yours: undo takes it back.</p>
        {!s.list.length && <div className="pcb-empty">No proposal is open on this board.</div>}
        <div className="acts">
          <button className="pcb-btn ghost" onClick={onClose}>
            Back to Inspect
          </button>
        </div>
      </div>
      {s.list.map((p) => {
        const on = s.selected?.id === p.id;
        const stale = staleLine(p);
        return (
          <div key={p.id} className="pcb-sec">
            <div className={`pcb-card${on ? " on" : ""}`} data-proposal={p.id}>
              <div className="row1">
                <span className="mono mute caps">{whoLabel(p)}</span>
                <span className={`pcb-chip ${p.status === "stale" ? "warn" : on ? "on" : ""}`} style={{ marginLeft: "auto" }}>
                  {p.status}
                </span>
              </div>
              <p className="sentence">{p.title}</p>
              {p.reason && <div className="pcb-note">Needs a person: {p.reason}</div>}
              <div className="mono mute meta">
                tracks {p.before.tracks} → {p.after.tracks} · vias {p.before.vias} → {p.after.vias} · length {mmLen(p.summary.length.added - p.summary.length.removed)}
                {p.scores?.current && p.scores.candidate ? ` · open ${p.scores.current.open} → ${p.scores.candidate.open}, errors ${p.scores.current.errors} → ${p.scores.candidate.errors}` : ""} · {ago(p.createdAt, now)}
              </div>
              {stale && <div className="pcb-note warn">{stale}</div>}
              {p.items.length > 1 &&
                p.items.slice(0, 12).map((i) => (
                  <div key={i.key} className="pcb-qrow" style={{ padding: "4px 0" }}>
                    <span className="txt">
                      <b>{i.label}</b>
                      <span>
                        {i.nets.length ? i.nets.slice(0, 4).join(", ") : "no net"} · {i.status}
                        {i.summary.length.added ? ` · ${mmLen(i.summary.length.added - i.summary.length.removed)}` : ""}
                      </span>
                    </span>
                    {i.status === "open" && writable && (
                      <>
                        <button className="pcb-btn" disabled={s.busy} onClick={() => s.select(p.id, [i.key])} title="Show only this item on the board">
                          Show
                        </button>
                        <button className="pcb-btn" disabled={s.busy || p.status === "stale"} onClick={() => void s.accept(p.id, { items: [i.key] })} title={p.status === "stale" ? "Stale: revalidate the whole proposal first" : "Accept this item only, as your change"}>
                          Accept
                        </button>
                        <button className="pcb-btn ghost" disabled={s.busy} onClick={() => void s.reject(p.id, [i.key])}>
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                ))}
              {p.items.length === 1 && <div className="mono mute meta">{p.items[0].label} · {p.items[0].nets.length ? p.items[0].nets.join(", ") : "no net"}</div>}
              <div className="acts">
                <button className={`pcb-btn${on ? " sel" : ""}`} onClick={() => s.select(on ? undefined : p.id)}>
                  <Icon name="eye" size={12} /> {on ? "Hide preview" : "Preview"}
                </button>
                <button className="pcb-btn ghost" disabled={!writable || s.busy} onClick={() => void s.reject(p.id)}>
                  Reject
                </button>
              </div>
              {s.outcome?.id === p.id && <div className={`pcb-note ${s.outcome.ok ? "pass" : "fail"}`}>{s.outcome.message}</div>}
            </div>
          </div>
        );
      })}
      {s.outcome && !s.list.some((p) => p.id === s.outcome!.id) && <div className={`pcb-note ${s.outcome.ok ? "pass" : "fail"}`}>{s.outcome.message}</div>}
    </>
  );
}

/** The card on the canvas for the proposal in hand: before and after, Accept all (the one main action), Reject. */
export function ProposalReviewCard({ state: s, writable }: { state: ProposalsState; writable: boolean }): ReactNode {
  const p = s.selected;
  if (!p) return null;
  const pv = s.preview;
  const stale = p.status === "stale";
  const items = pv?.items;
  const canRevalidate = stale && !!pv?.valid;
  return (
    <div className="pcb-proposal" onPointerDown={(e) => e.stopPropagation()} data-proposal-card={p.id}>
      <div className="row1">
        <b className="caps">{p.source === "needs-person" ? "needs you" : p.actor.kind}</b>
        <span className="mono mute small">{name(p.actor)}</span>
        <span className={`pcb-chip ${stale ? "warn" : "on"}`} style={{ marginLeft: "auto" }}>
          {stale ? "stale" : "proposed"}
        </span>
        <button className="pcb-btn ghost" style={{ padding: "0 2px" }} onClick={() => s.select(undefined)} title="Close the preview (the proposal stays open)">
          <Icon name="close" size={12} />
        </button>
      </div>
      <p className="pcb-p" style={{ margin: "6px 0" }}>
        {p.title}
        {items ? ` (${items.length} item${items.length === 1 ? "" : "s"} shown)` : ""}
      </p>
      <Counts p={p} />
      <div className="mono mute small" style={{ margin: "6px 0" }}>
        {pv ? `ghost: +${pv.added.segments.length} segments, +${pv.added.vias.length} vias · removes ${pv.removed.segments.length + pv.removed.vias.length} · changes ${pv.counts.changed}` : s.previewError ? `no preview: ${s.previewError}` : "reading the preview…"}
        <br />
        {stale ? (pv ? (pv.valid ? "its changes still apply to the board as it is now" : `it no longer applies: ${pv.error ?? "refused"}`) : staleLine(p)) : p.source === "needs-person" ? "a net change: accept it with the button, never a key" : "accepting it is one change of yours"}
      </div>
      {s.outcome?.id === p.id && <div className={`pcb-note ${s.outcome.ok ? "pass" : "fail"}`}>{s.outcome.message}</div>}
      <div className="acts">
        {(!stale || canRevalidate) && (
          <button className="pcb-btn main" disabled={!writable || s.busy || (!stale && pv?.valid === false)} onClick={() => void s.accept(p.id, { ...(items ? { items } : {}), ...(stale ? { allowStale: true } : {}) })} title={stale ? "Check it again on the board as it is now and apply it" : "Apply it as your change (undoable)"}>
            <Icon name="check" size={12} /> {stale ? "Revalidate and accept" : items ? "Accept shown" : "Accept all"}
          </button>
        )}
        <button className="pcb-btn" disabled={!writable || s.busy} onClick={() => void s.reject(p.id, items)}>
          Reject
        </button>
      </div>
    </div>
  );
}

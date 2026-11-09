/**
 * Review mode's fix queue (L2), in the right panel's Checks tab: how much is left, filters by group, the item in hand
 * as a card (its plain sentence, a crop of the board around it, and what can be done: route its net, ask why it does
 * not route, do it yourself, or mark it not a problem with a reason), then the rest of the queue with small crops,
 * and the waived findings with their reasons. The canvas follows the item in hand; J and K step through the queue.
 */
import { useMemo, useState } from "react";
import type { BoardDocument } from "../board.js";
import { checkWords, describeFinding } from "../findings-text.js";
import { dotSvg, markerKind } from "../markers.js";
import { cropSvg } from "../overlay.js";
import { GROUP_LABEL, queueCounts, type QueueGroup, type QueueItem } from "../review.js";
import type { WaivedFinding } from "../types.js";
import { Icon } from "./icons.js";

export interface ReviewPanelProps {
  doc: BoardDocument;
  items: QueueItem[];
  index: number;
  filter: QueueGroup | "all";
  done: number;
  total: number;
  waived: readonly WaivedFinding[];
  writable: boolean;
  onFilter: (f: QueueGroup | "all") => void;
  onPick: (i: number) => void;
  onWaive: (item: QueueItem, reason: string) => void;
  onUnwaive: (finding: string) => void;
  onMyself: (item: QueueItem) => void;
  onRoute: (item: QueueItem) => void;
  onWhy: (item: QueueItem) => void;
}

const FILTERS: { id: QueueGroup | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fab", label: "Blocks fab" },
  { id: "unconnected", label: "Unconnected" },
  { id: "style", label: "Looks" },
  { id: "note", label: "Notes" },
];

function Crop({ doc, item, w, h }: { doc: BoardDocument; item: QueueItem; w: number; h: number }) {
  const svg = useMemo(() => cropSvg(doc, item.box, { width: w, height: h, focus: item.objects, ...(item.findings[0] ? { marker: item.findings[0].location } : {}), pad: w > 100 ? 1.5 : 0.8 }), [doc, item, w, h]);
  return <span className="crop" style={{ width: w, height: h }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ReviewPanel(p: ReviewPanelProps) {
  const [reason, setReason] = useState<string | undefined>(undefined);
  const counts = queueCounts(p.items);
  const shown = p.filter === "all" ? p.items : p.items.filter((i) => i.group === p.filter);
  const cur = p.items[p.index];
  const fraction = p.total ? p.done / p.total : 1;
  const next = shown.filter((i) => i !== cur).slice(0, 30);
  return (
    <>
      <div className="pcb-sec">
        <h4>
          <span>Finish this board</span>
          <i>ranked: blocks the fab first</i>
        </h4>
        <div className="pcb-left">
          <b>{p.items.length} left</b>
          <span className="mono mute">
            {p.done} of {p.total} done
          </span>
        </div>
        <i className="pcb-progress">
          <i style={{ width: `${Math.round(fraction * 100)}%` }} />
        </i>
        <div className="pcb-presets" style={{ marginTop: 10 }}>
          {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
            <button key={f.id} className={p.filter === f.id ? "on" : ""} onClick={() => p.onFilter(f.id)}>
              {f.label} {counts[f.id]}
            </button>
          ))}
        </div>
      </div>
      {cur ? (
        <div className="pcb-sec">
          <div className="pcb-card on" data-item={cur.id} title={[...cur.findings.map((f) => f.id), ...cur.objects].join("\n")}>
            <div className="row1">
              <span className="num">{p.index + 1}</span>
              <span className={`pcb-chip ${cur.severity === "error" ? "fail" : cur.severity === "warning" ? "warn" : ""}`}>{cur.severity}</span>
              <span className="mono mute caps">{cur.findings[0] ? checkWords(cur.findings[0].check) : "unconnected"}</span>
              <span className="mono mute grow">{GROUP_LABEL[cur.group]}</span>
            </div>
            <p className="sentence">{cur.sentence}</p>
            <Crop doc={p.doc} item={cur} w={300} h={110} />
            <div className="mono mute meta">{cur.meta}</div>
            {reason === undefined ? (
              <div className="acts">
                {cur.group === "unconnected" && (
                  <button className="pcb-btn" disabled={!p.writable} onClick={() => p.onRoute(cur)} title="Run the autorouter on this net (a proposal you accept or reject)">
                    <Icon name="route" size={12} /> Route it
                  </button>
                )}
                {cur.group === "unconnected" && (
                  <button className="pcb-btn" disabled={!p.writable} onClick={() => p.onWhy(cur)} title="Why this net does not route: the probe with the fab floor only, and relaxations test-run">
                    <Icon name="why" size={12} /> Why?
                  </button>
                )}
                <button className="pcb-btn" onClick={() => p.onMyself(cur)} title="Leave review with these objects selected">
                  Do it myself
                </button>
                <button className="pcb-btn" disabled={!p.writable || cur.group === "unconnected"} onClick={() => setReason("")} title={cur.group === "unconnected" ? "An open connection is fixed by routing it" : "Record a waiver with a reason; the checks then leave it out and list it"}>
                  Not a problem
                </button>
              </div>
            ) : (
              <form
                className="waive"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!reason.trim()) return;
                  p.onWaive(cur, reason.trim());
                  setReason(undefined);
                }}
              >
                <textarea className="pcb-search" autoFocus maxLength={500} placeholder="Why it is not a problem (kept with the board as a waiver, with your name)" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => {
                  if (e.key === "Escape") setReason(undefined);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget.form as HTMLFormElement).requestSubmit();
                  }
                  e.stopPropagation();
                }} />
                <div className="acts">
                  <button className="pcb-btn" type="submit" disabled={!reason.trim()}>
                    Record the reason
                  </button>
                  <button className="pcb-btn ghost" type="button" onClick={() => setReason(undefined)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="pcb-empty">{p.waived.length ? "Nothing left: every leftover has a reason. Export is allowed." : "Nothing left to review on this board."}</div>
      )}
      {next.length > 0 && (
        <div className="pcb-sec">
          <h4>
            <span>Next</span>
            <i>J / K</i>
          </h4>
          {next.map((it) => {
            const i = p.items.indexOf(it);
            return (
              <button key={it.id} className="pcb-qrow" onClick={() => p.onPick(i)} title={`${it.sentence}\n${[...it.findings.map((f) => f.id), ...it.objects].join("\n")}`}>
                <span className="num">{i + 1}</span>
                <Crop doc={p.doc} item={it} w={56} h={40} />
                <span className="txt">
                  <b>
                    <svg width="9" height="9" viewBox="-4.5 -4.5 9 9" dangerouslySetInnerHTML={{ __html: dotSvg(markerKind({ severity: it.severity, ...(it.findings[0]?.tier ? { tier: it.findings[0].tier } : {}) }), 3) }} />
                    {it.title}
                  </b>
                  <span>{it.meta}</span>
                </span>
                <span className="pcb-chip">{it.group === "unconnected" ? "why?" : GROUP_LABEL[it.group]}</span>
              </button>
            );
          })}
        </div>
      )}
      <WaivedList doc={p.doc} waived={p.waived} writable={p.writable} onUnwaive={p.onUnwaive} />
    </>
  );
}

/**
 * The waived findings, apart from the open ones: what each was, the reason, who waived it, and Take back
 * (`waiver.remove`). Shown under the review queue and under the Checks tab's findings.
 */
export function WaivedList({ doc, waived, writable, onUnwaive }: { doc: BoardDocument; waived: readonly WaivedFinding[]; writable: boolean; onUnwaive: (finding: string) => void }) {
  if (!waived.length) return null;
  return (
    <div className="pcb-sec" data-waived={waived.length}>
      <h4>
        <span>Not a problem</span>
        <i>
          {waived.length} waived · not counted
        </i>
      </h4>
      {waived.map((w) => {
        const t = describeFinding(w.finding, doc);
        return (
          <div key={`${w.rule}|${w.finding.id}`} className="pcb-waived" title={[...t.ids, w.rule].join(" · ")}>
            <div>
              <b>{t.title}</b>
            </div>
            <div className="why">“{w.reason}”</div>
            <div className="mono mute small">
              {w.by ? `waived by ${w.by}` : "waived"}
              {w.at ? ` · ${w.at.slice(0, 10)}` : ""}
              {w.legacy ? " · an older rules entry: becomes a waiver record on your next change" : ""}
            </div>
            <button className="pcb-btn ghost" disabled={!writable} onClick={() => onUnwaive(w.finding.id)} title="Take the waiver back: the finding counts again">
              Take back
            </button>
          </div>
        );
      })}
    </div>
  );
}

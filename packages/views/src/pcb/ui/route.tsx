/**
 * The Inspect tab's run views: the autoroute panel (L5: scope, router order with availability, the Balanced preset,
 * a time budget, run with progress and cancel, the result as a scored proposal against the board you have, the
 * fallback flagged, Accept or Reject), the proposal card that sits on the canvas while a proposal is open, and the
 * routing diagnosis (L4: the verdict, what blocks the net, and relaxations already test-run).
 */
import type { DiagnosisProgress, DiagnosisView, PageScore, ProposalView, RelaxOption, RouteProgressView, RouterInfo } from "../types.js";
import { Icon } from "./icons.js";

const mm = (nm: number, d = 1) => `${(nm / 1e6).toFixed(d)}`;
const signed = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

export type ScopeKind = "open" | "nets" | "region";

export interface AutoroutePanelProps {
  routers: RouterInfo[] | undefined;
  scope: ScopeKind;
  onScope: (s: ScopeKind) => void;
  scopeNote: string;
  /** Open connections and nets in scope now. */
  open: { links: number; nets: number };
  hand: number;
  budgetMs: number;
  onBudget: (ms: number) => void;
  running?: { run: string; progress: RouteProgressView[]; started: number };
  proposal?: ProposalView;
  accepted?: { run: string; message: string; ok: boolean; changeSet: string };
  writable: boolean;
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onReject: () => void;
  onRevert: (changeSet: string) => void;
}

function ScoreTable({ now, cand, label }: { now: PageScore; cand: PageScore; label: string }) {
  const row = (name: string, a: number, b: number, fmt = (n: number) => String(n)) => (
    <tr key={name}>
      <td>{name}</td>
      <td>{fmt(a)}</td>
      <td className={b < a ? "better" : b > a ? "worse" : ""}>{fmt(b)}</td>
    </tr>
  );
  return (
    <table className="pcb-table">
      <thead>
        <tr>
          <th />
          <th>now</th>
          <th>{label}</th>
        </tr>
      </thead>
      <tbody>
        {row("open", now.open, cand.open)}
        {row("errors", now.errors, cand.errors)}
        {row("vias", now.vias, cand.vias)}
        {row("length mm", now.length, cand.length, (n) => mm(n))}
      </tbody>
    </table>
  );
}

export function AutoroutePanel(p: AutoroutePanelProps) {
  const pr = p.proposal;
  const offered = pr && pr.status === "proposed";
  return (
    <>
      <div className="pcb-sec">
        <h4>
          <span>Autoroute</span>
          <i>{pr ? `${pr.status} · ${(pr.ms / 1000).toFixed(1)} s` : p.running ? "running" : "not run"}</i>
        </h4>
        <dl className="pcb-kv">
          <dt>Scope</dt>
          <dd>{p.scopeNote}</dd>
          <dt>Locked</dt>
          <dd>hand copper · {p.hand} track{p.hand === 1 ? "" : "s"}</dd>
          <dt>Order</dt>
          <dd>{p.routers ? p.routers.map((r) => r.id).join(", then ") : "asking the host"}</dd>
        </dl>
        <div className="pcb-seg" style={{ marginTop: 10 }}>
          {(["open", "nets", "region"] as ScopeKind[]).map((s) => (
            <button key={s} className={p.scope === s ? "on" : ""} onClick={() => p.onScope(s)} disabled={!!p.running}>
              {s === "open" ? "All open nets" : s === "nets" ? "Selected nets" : "Drawn region"}
            </button>
          ))}
        </div>
        <div className="pcb-seg" style={{ marginTop: 8 }}>
          <span className="lbl">Preset</span>
          <button disabled title="Not defined yet: Balanced is the only preset the orchestrator has">
            Loose
          </button>
          <button className="on">Balanced</button>
          <button disabled title="Not defined yet">
            Strict
          </button>
        </div>
        <div className="mono mute small">Balanced: fab floor and no-go are hard, design targets are costs.</div>
        <div className="pcb-seg" style={{ marginTop: 8 }}>
          <span className="lbl">Budget</span>
          {[15_000, 60_000, 180_000].map((ms) => (
            <button key={ms} className={p.budgetMs === ms ? "on" : ""} disabled={!!p.running} onClick={() => p.onBudget(ms)}>
              {ms < 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`}
            </button>
          ))}
        </div>
      </div>
      <div className="pcb-sec">
        <h4>
          <span>Routers</span>
          <i>in order</i>
        </h4>
        {(p.routers ?? []).map((r, i) => (
          <div key={r.id} className="pcb-step">
            <span className={`dot ${r.available ? "pass" : "fail"}`} />
            <span className="txt">
              <b>
                {i + 1} · {r.title}
              </b>
              <span>{r.available ? `available · ${r.version}${i > 0 ? " · runs when the one before leaves nets open" : ""}` : `not available: ${r.reason ?? "unknown"}`}</span>
            </span>
          </div>
        ))}
        {!p.routers && <div className="mono mute small">Asking the host which routers it has.</div>}
        <div className="acts" style={{ marginTop: 10 }}>
          {p.running ? (
            <button className="pcb-btn" onClick={p.onCancel}>
              <Icon name="close" size={12} /> Cancel <span className="kbd">Esc</span>
            </button>
          ) : (
            <button className={`pcb-btn${offered ? "" : " main"}`} disabled={!p.writable || !p.canRun || !p.routers?.some((r) => r.available)} onClick={p.onRun} title={!p.writable ? "This host is read only" : !p.canRun ? "Nothing in scope is open" : "Run the routers on a copy; the result is a proposal"}>
              <Icon name="route" size={12} /> {pr ? "Run again" : "Run"}
            </button>
          )}
          <span className="mono mute small">
            {p.open.links} open connection{p.open.links === 1 ? "" : "s"} · {p.open.nets} net{p.open.nets === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {(p.running || pr) && (
        <div className="pcb-sec">
          <h4>
            <span>Run</span>
            <i>{p.running ? `${((Date.now() - p.running.started) / 1000).toFixed(0)} s` : pr ? `${(pr.ms / 1000).toFixed(1)} s` : ""}</i>
          </h4>
          {pr
            ? pr.stages.map((s, i) => (
                <div key={i} className="pcb-step">
                  <span className={`dot ${s.kept ? "pass" : s.status === "skipped" || s.status === "failed" || s.status === "timeout" ? "fail" : "warn"}`} />
                  <span className="txt">
                    <b>
                      {i + 1} · {s.router} {i > 0 && <span className="pcb-chip warn">fallback</span>}
                    </b>
                    <span>
                      {s.status}
                      {s.kept ? ", kept" : ""} · {s.added.segments} segments, {s.added.vias} vias{s.reason ? ` · ${s.reason}` : ""}
                    </span>
                  </span>
                  <span className="mono mute small">{(s.durationMs / 1000).toFixed(1)} s</span>
                </div>
              ))
            : p.running!.progress.slice(-4).map((g, i) => (
                <div key={i} className="pcb-step">
                  <span className={`dot ${g.fallback ? "warn" : "run"}`} />
                  <span className="txt">
                    <b>
                      {g.stage + 1} · {g.router} {g.fallback && <span className="pcb-chip warn">fallback</span>}
                    </b>
                    <span>
                      {g.phase}
                      {g.message ? ` · ${g.message}` : ""}
                    </span>
                  </span>
                  <span className="mono mute small">{g.fraction !== undefined ? `${Math.round(g.fraction * 100)}%` : `${(g.elapsedMs / 1000).toFixed(0)} s`}</span>
                </div>
              ))}
          {pr && (
            <div className="pcb-step">
              <span className={`dot ${pr.lockCheck.ok ? "pass" : "fail"}`} />
              <span className="txt">
                <b>Checks and locks</b>
                <span>{pr.lockCheck.ok ? `checks rerun · ${pr.lockCheck.checked} locked record${pr.lockCheck.checked === 1 ? "" : "s"} verified unchanged` : `a router tried to change ${pr.lockCheck.changed.join(", ")}: its result was not kept`}</span>
              </span>
            </div>
          )}
          {pr?.fallback && <div className="pcb-note warn">Fallback flagged: {pr.fallback.reasons.join("; ")}</div>}
        </div>
      )}
      {pr && (
        <div className="pcb-sec">
          <h4>
            <span>Proposal</span>
            <i>scored</i>
          </h4>
          <ScoreTable now={pr.current} cand={pr.candidate} label={pr.stages.filter((s) => s.kept).map((s) => s.router).join(" + ") || "result"} />
          <p className="pcb-p">{offered ? `Ranked by open connections, then errors, then vias. The board service holds it as ${pr.proposals?.length ? `${pr.proposals.length} proposal${pr.proposals.length === 1 ? "" : "s"}` : "a proposal"} (one item per net); accepting applies it as your change, and Revert takes the whole run back.` : `Not offered: ${pr.reasons.join("; ") || pr.status}. A result worse than the board you have is never offered for Accept.`}</p>
          {offered && pr.proposalError && <div className="pcb-note fail">Not held as a service proposal: {pr.proposalError}</div>}
          {pr.unexpressed.length > 0 && <div className="mono mute small">checked after the run: {pr.unexpressed.slice(0, 4).join("; ")}</div>}
        </div>
      )}
      {p.accepted && (
        <div className="pcb-sec">
          <div className={`pcb-note ${p.accepted.ok ? "pass" : "fail"}`}>{p.accepted.message}</div>
          {p.accepted.ok && (
            <div className="acts">
              <button className="pcb-btn" disabled={!p.writable} onClick={() => p.onRevert(p.accepted!.changeSet)} title="Take the whole run back (a revert of its change set)">
                <Icon name="undo" size={12} /> Revert this run
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** The proposal card on the canvas: before and after, Accept (the one main action) and Reject. */
export function ProposalCard({ proposal, onAccept, onReject, busy }: { proposal: ProposalView; onAccept: () => void; onReject: () => void; busy?: boolean }) {
  const pr = proposal;
  const offered = pr.status === "proposed";
  const by = pr.stages.filter((s) => s.kept).map((s) => s.router).join(" + ") || "router";
  return (
    <div className="pcb-proposal" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row1">
        <b className="caps">{by}</b>
        <span className="pcb-chip on">{offered ? "proposed" : pr.status}</span>
      </div>
      <ScoreTable now={pr.current} cand={pr.candidate} label="proposal" />
      <div className="mono mute small" style={{ margin: "6px 0" }}>
        length {signed((pr.candidate.length - pr.current.length) / 1e6)} mm · hand copper {pr.lockCheck.ok ? "0 moved" : "changed: refused"}
        <br />
        ranked by open, then errors, then vias{offered ? " · better than now on the first two" : ""}
      </div>
      <div className="acts">
        {offered && (
          <button className="pcb-btn main" disabled={busy || !pr.proposals?.length} onClick={onAccept} title={pr.proposals?.length ? "Apply the proposal as your change (A)" : `The board service does not hold it${pr.proposalError ? `: ${pr.proposalError}` : ""}`}>
            <Icon name="check" size={12} /> Accept <span className="kbd">A</span>
          </button>
        )}
        <button className="pcb-btn" disabled={busy} onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

export interface DiagnosisPanelProps {
  net: string;
  loading: boolean;
  error?: string;
  view?: DiagnosisView;
  /** The host's progress while the diagnosis runs (stage, fraction, time against the budget). */
  progress?: DiagnosisProgress;
  writable: boolean;
  /** The relaxation whose card is open on the canvas: its Accept is the one main action, so no option here is orange. */
  pending?: string;
  onApply: (o: RelaxOption) => void;
  onRun: () => void;
}

const VERDICT_TITLE: Record<DiagnosisView["verdict"], string> = { rules: "Rules, not placement", placement: "Placement", routes: "It routes as the rules are", connected: "Nothing is open", unknown: "Not known yet" };
const STAGE_TEXT: Record<DiagnosisProgress["stage"], string> = { cache: "cache", connectivity: "open links", attempt: "attempt, every rule", probe: "probe, floor and no-go only", relaxations: "relaxations on copies", done: "done" };

/** The verdict in a few words (the agent bar's title). */
export function diagnosisVerdictText(v: DiagnosisView): string {
  return v.verdict === "rules" ? "a rule blocks it, not the parts" : v.verdict === "placement" ? "the parts or a no-go area block it" : v.verdict === "connected" ? (v.pour ? "left to its pour, nothing is open" : "nothing is open") : v.verdict === "unknown" ? "not known, the time budget ran out" : "it routes as the rules are";
}

export function DiagnosisPanel(p: DiagnosisPanelProps) {
  const v = p.view;
  const best = v?.options.find((o) => o.result.routed && o.result.newFindings === 0) ?? v?.options.find((o) => o.result.routed);
  const g = p.loading ? p.progress : undefined;
  return (
    <>
      <div className="pcb-sec">
        <h4>
          <span>Why {p.net} can't route</span>
          <i>{v ? `${v.cached ? "cached · " : ""}${(v.ms / 1000).toFixed(1)} s${v.budgetMs ? ` of ${(v.budgetMs / 1000).toFixed(0)} s` : ""} · seq ${v.seq}` : g ? `${STAGE_TEXT[g.stage]} · ${(g.elapsedMs / 1000).toFixed(1)} of ${(g.budgetMs / 1000).toFixed(0)} s` : p.loading ? "probing" : ""}</i>
        </h4>
        {p.loading && <div className="pcb-note">Routing only the open links of {p.net}: the attempt, the probe with only the fab floor and no-go areas, and the relaxations on copies of the board, within one time budget. Nothing changes.</div>}
        {g && (
          <>
            <i className="pcb-progress" title={`${Math.round(g.fraction * 100)}%`}>
              <i style={{ width: `${Math.round(g.fraction * 100)}%` }} />
            </i>
            <div className="mono mute small" style={{ marginTop: 4 }}>
              {g.router ? `${g.router} · ` : ""}
              {g.message ?? STAGE_TEXT[g.stage]}
            </div>
          </>
        )}
        {p.error && <div className="pcb-note fail">{p.error}</div>}
        {!p.loading && !v && !p.error && (
          <button className="pcb-btn" onClick={p.onRun} disabled={!p.writable}>
            <Icon name="why" size={12} /> Diagnose {p.net}
          </button>
        )}
        {v && (
          <div className="pcb-verdict">
            <span className="caps">Verdict</span>
            <b>{VERDICT_TITLE[v.verdict] ?? v.verdict}</b>
            <p>{v.summary}.</p>
          </div>
        )}
        {v?.pour && <div className="pcb-note">{v.pour.note}.</div>}
        {v?.stopped?.length ? (
          <div className="mono mute small" style={{ marginTop: 6 }} title={v.stopped.join("\n")}>
            the {((v.budgetMs ?? 0) / 1000).toFixed(0)} s budget cut: {v.stopped.join("; ")}
          </div>
        ) : null}
      </div>
      {v && (
        <div className="pcb-sec">
          <h4>
            <span>What blocks it</span>
            <i>{v.attempts.map((a) => `${a.router} ${a.status}`).join(" · ")}</i>
          </h4>
          <table className="pcb-table wide">
            <thead>
              <tr>
                <th>rule</th>
                <th>tier</th>
                <th>blocks</th>
              </tr>
            </thead>
            <tbody>
              {v.blockers.map((b) => (
                <tr key={b.rule + b.what}>
                  <td title={b.what}>{b.rule.replace(/^rule:|^kpo:/, "")}</td>
                  <td className={b.tier === "no_go" ? "worse" : ""}>{b.tier === "no_go" ? "no-go" : b.tier}</td>
                  <td>{b.blocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.probe && (
            <div className="mono mute small" style={{ marginTop: 8 }}>
              probe ({v.probe.router}, floor and no-go only): {v.probe.routed ? `routed, ${mm(v.probe.length, 2)} mm, ${v.probe.vias} via${v.probe.vias === 1 ? "" : "s"}` : "did not route"}
              {v.probe.floorViolations ? `, ${v.probe.floorViolations} pair(s) under the floor` : ""}
            </div>
          )}
        </div>
      )}
      {v && v.options.length > 0 && (
        <div className="pcb-sec">
          <h4>
            <span>Relax options</span>
            <i>already test-run</i>
          </h4>
          {v.options.map((o, i) => (
            <div key={o.id} className="pcb-option">
              <div className="row1">
                <span className="num">{i + 1}</span>
                <b>{o.title}</b>
                <button className={`pcb-btn${o === best && !p.pending ? " main" : ""}`} disabled={!p.writable} onClick={() => p.onApply(o)} title="A proposal you accept or reject; the rule is written to the board's rules with who and why">
                  {o === best ? "Apply as proposal" : "Apply"}
                </button>
              </div>
              <div className="mono mute small">{o.detail}</div>
              <div className={`mono small ${o.result.skipped ? "mute" : o.result.routed ? "pass" : "fail"}`}>
                {o.result.skipped ? `not test-run: ${o.result.skipped}` : <>{o.result.routed ? "✓" : "✗"} test-run: {o.result.routed ? `routes · ${o.result.vias} via${o.result.vias === 1 ? "" : "s"} · ${o.result.newFindings ? `${o.result.newFindings} new finding(s)` : "no new findings"}` : `still open${o.result.note ? ` · ${o.result.note}` : ""}`} · {(o.result.ms / 1000).toFixed(1)} s</>}
              </div>
            </div>
          ))}
          <p className="pcb-p">Relaxing never touches the fab floor. Each change is written to the rules with who and why.</p>
        </div>
      )}
    </>
  );
}

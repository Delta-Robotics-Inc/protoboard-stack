/**
 * The schematic screen's regions, in the layout screen's frame (its stylesheet, `pcb-*` classes): the top bar with
 * the depth switcher, the app gutter, the tool rail, the agent bar, the timeline, the status line, and the right
 * panel's tabs (Blocks, Nets, Checks, Readability, Inspect with the part card). Each says only what it was handed.
 */
import { useMemo, useState, type ReactNode } from "react";
import { DepthSwitcher, Icon, clock, type Depth } from "../shell/index.js";
import { CHIPS, netFacts, partFacts, pinFacts, pinWords, type Chip, type Fact } from "./facts.js";
import type { Lod } from "./canvas.js";
import type { PageCleanup, PageDefect, PageDerived, PageFinding, PageFix, PageItem, PageLogEntry, PageModel, PageNet, PagePart, PagePin } from "./types.js";

export type Tab = "blocks" | "nets" | "checks" | "readability" | "inspect";
export type Tool = "select" | "wire";

// ------------------------------------------------------------------ frame

export function TopBar(p: { crumbs: string[]; onNavigate?: (d: Depth) => void; navEnabled?: (d: Depth) => boolean; seq: number; saved?: number; firstOpen?: boolean; onSave?: () => void; liveMs?: number }) {
  const state = p.saved === undefined ? (p.firstOpen ? "laid out, not saved" : p.seq === 0 ? "nothing to save" : "not saved") : p.saved === p.seq ? "saved" : `saved at ${p.saved}`;
  return (
    <header className="pcb-top">
      <div className="pcb-brand">
        <span className="mark">P</span>PROTOBOARD
      </div>
      <nav className="pcb-crumbs caps">
        {[...p.crumbs, "Schematic"].map((c, i, a) => (
          <span key={i}>{i === a.length - 1 ? <b>{c}</b> : <>{c} /</>}</span>
        ))}
      </nav>
      <DepthSwitcher active="schematic" {...(p.onNavigate ? { onNavigate: p.onNavigate } : {})} {...(p.navEnabled ? { enabled: p.navEnabled } : {})} />
      <div className="pcb-topright">
        <button className={`pcb-chip${p.onSave && p.saved !== p.seq ? " dashed" : ""}`} disabled={!p.onSave} onClick={p.onSave} title={p.onSave ? "Save the schematic files now (Ctrl+S)" : "The schematic's version in this session and its last save"} data-save-state={state}>
          seq {p.seq} · {state}
        </button>
        <button className="pcb-btn" disabled title={p.liveMs !== undefined ? `The checks and the readability score run after every commit (${Math.round(p.liveMs)} ms last time)` : "The checks run after every commit"}>
          <Icon name="check" size={13} /> Check
        </button>
        <button className="pcb-btn" disabled title="The flat KiCad export runs from the command line: protoboard schematic export-kicad">
          <Icon name="download" size={13} /> Export
        </button>
      </div>
    </header>
  );
}

export function Gutter({ errors }: { errors: number }) {
  return (
    <aside className="pcb-gutter">
      <button className="on" title="Schematic">
        <Icon name="system" />
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
  writable: boolean;
  canSymbol: boolean;
  canConvert: boolean;
  canPin: boolean;
  pinned: boolean;
  onRotate: () => void;
  onMirror: () => void;
  onConvert: () => void;
  onPin: () => void;
  onLayout: () => void;
  layoutTitle: string;
  onFit: () => void;
  markers: boolean;
  onMarkers: () => void;
  errors: number;
}

export function Rail(p: RailProps) {
  const B = ({ icon, k, title, on, disabled, onClick, badge }: { icon: string; k?: string; title: string; on?: boolean; disabled?: boolean; onClick?: () => void; badge?: ReactNode }) => (
    <button className={on ? "on" : ""} title={k ? `${title} (${k})` : title} disabled={disabled} onClick={onClick} aria-pressed={on} data-tool={icon}>
      <Icon name={icon} />
      {k && <span className="k">{k.toLowerCase()}</span>}
      {badge}
    </button>
  );
  return (
    <div className="pcb-float pcb-rail" onPointerDown={(e) => e.stopPropagation()}>
      <B icon="select" k="V" title="Select and move" on={p.tool === "select"} onClick={() => p.onTool("select")} />
      <B icon="route" k="W" title="Draw a wire: click a pin, click the corners, click the end (a wire draws a UHD net; it never makes a connection)" on={p.tool === "wire"} disabled={!p.writable} onClick={() => p.onTool(p.tool === "wire" ? "select" : "wire")} />
      <B icon="text" k="L" title="A wire to labels, or labels back to a wire" disabled={!p.writable || !p.canConvert} onClick={p.onConvert} />
      <B icon="rotate" k="R" title="Rotate the selected symbols (wires follow)" disabled={!p.writable || !p.canSymbol} onClick={p.onRotate} />
      <B icon="flip" k="X" title="Mirror the selected symbols (wires follow)" disabled={!p.writable || !p.canSymbol} onClick={p.onMirror} />
      <B icon={p.pinned ? "unlock" : "lock"} k="P" title={p.pinned ? "Unpin: the layout may move it again" : "Pin: the layout and agents leave it where it is"} disabled={!p.writable || !p.canPin} onClick={p.onPin} />
      <B icon="reroute" title={p.layoutTitle} disabled={!p.writable} onClick={p.onLayout} />
      <span className="sep" />
      <B icon="fit" k="F" title="Fit the sheet" onClick={p.onFit} />
      <B icon="alert" title={p.markers ? "Hide the numbered defects and findings" : "Show the numbered defects and findings"} on={p.markers} onClick={p.onMarkers} badge={p.errors > 0 ? <span className="badge">{p.errors > 9 ? "9+" : p.errors}</span> : undefined} />
    </div>
  );
}

export interface AgentState {
  title: string;
  sub: string;
  working: boolean;
  actions?: ReactNode;
}

export function AgentBar({ state }: { state: AgentState }) {
  return (
    <div className={`pcb-float pcb-agent${state.working ? " working" : ""}`} onPointerDown={(e) => e.stopPropagation()} data-agent={state.title}>
      <span className="who">
        <Icon name="sparkle" size={14} /> Agent
      </span>
      <span className="what">
        <b>{state.title}</b>
        <span>{state.sub}</span>
      </span>
      {state.actions}
    </div>
  );
}

// ------------------------------------------------------------------ timeline and status

export function Timeline(p: { name: string; log: readonly PageLogEntry[]; seq: number; scores: readonly { seq: number; score: number; gates: number }[]; saves: readonly number[]; checkpoints: readonly { seq: number; label: string; committed?: string; error?: string }[]; findings: number; onUndo?: () => void; onRedo?: () => void; onCheckpoint?: () => void; selected?: number; onSelect: (e: PageLogEntry | undefined) => void }) {
  const blocks = p.log.slice(-10);
  const first = Math.min(...[p.seq, ...p.scores.map((s) => s.seq), ...blocks.map((b) => b.seq)].filter((x) => Number.isFinite(x)), p.seq);
  const span = Math.max(1, p.seq - first);
  const xn = (seq: number) => 4 + ((seq - first) / span) * 90;
  const x = (seq: number) => `${xn(seq)}%`;
  const last = p.log.at(-1);
  return (
    <div className="pcb-float pcb-timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="head">
        <button className="play" disabled title="Replay is the layout screen's for now">
          <Icon name="play" size={12} />
        </button>
        <button className="pcb-btn ghost" disabled={!p.onUndo} onClick={p.onUndo} title="Undo your last change (Ctrl+Z)" style={{ padding: 0, width: 26 }}>
          <Icon name="undo" size={14} />
        </button>
        <button className="pcb-btn ghost" disabled={!p.onRedo} onClick={p.onRedo} title="Redo (Ctrl+Shift+Z)" style={{ padding: 0, width: 26 }}>
          <Icon name="redo" size={14} />
        </button>
        <div className="title">
          <b>
            Schematic · {p.name}
            {last ? ` · seq ${p.seq} · ${last.label}` : ""}
          </b>
          <span>auto layout by rules and forces · hand pins · agent cleanup · readability is measured, not guessed</span>
        </div>
        <button className="pcb-btn" disabled={!p.onCheckpoint} onClick={p.onCheckpoint} title="Save and make a Git commit of the schematic folder">
          <Icon name="commit" size={13} /> Checkpoint = git commit
        </button>
      </div>
      <div className="lane-names">
        <span>Changes</span>
        <span>Readability</span>
        <span>Checks</span>
      </div>
      <div className="lanes">
        <div className="lane">
          <div className="flow">
            {blocks.length === 0 && <span className="mute mono empty">Changes appear here as people and agents commit them.</span>}
            {blocks.map((e) => (
              <button key={e.seq} className={`pcb-block ${e.actor.kind}${e.undoOf !== undefined ? " undo" : ""}${p.selected === e.seq ? " on" : ""}`} onClick={() => p.onSelect(p.selected === e.seq ? undefined : e)} title={`seq ${e.seq} · ${e.actor.kind} ${e.actor.name ?? e.actor.id} · ${e.changed} changed`}>
                {e.seq} {e.label}
                {e.actor.kind === "agent" ? ` · ${e.actor.name ?? "agent"}` : e.actor.kind === "human" ? " · you" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="lane mono" style={{ fontSize: 9.5 }}>
          {p.scores.length === 0 ? (
            <span className="mute">Scored after the first commit.</span>
          ) : (
            <>
              <svg className="sch-scoreline" viewBox="0 0 100 24" preserveAspectRatio="none">
                <polyline points={p.scores.flatMap((s, i) => { const xx = xn(s.seq); const y = 21 - (s.score / 100) * 18; const prev = i ? 21 - (p.scores[i - 1].score / 100) * 18 : y; return [`${xx},${prev}`, `${xx},${y}`]; }).join(" ")} fill="none" stroke="var(--pcb-pass)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              </svg>
              {p.scores.map((s, i) => (
                <span key={s.seq} className="cp" style={{ left: x(s.seq), color: s.gates ? "var(--pcb-fail)" : i === p.scores.length - 1 ? "var(--pcb-strong)" : "var(--pcb-body)" }} title={`seq ${s.seq}: score ${s.score}, ${s.gates} gate${s.gates === 1 ? "" : "s"} open`}>
                  <span className="pcb-diamond" style={{ width: 6, height: 6 }} />
                  {s.score}
                </span>
              ))}
            </>
          )}
        </div>
        <div className="lane mono" style={{ fontSize: 9.5 }}>
          <span className={p.findings ? "fail" : "mute"}>{p.findings ? `${p.findings} electrical finding${p.findings === 1 ? "" : "s"}` : "no electrical findings"}</span>
          {p.saves.slice(-4).map((s, i) => (
            <span key={`s${i}`} className="cp" style={{ left: x(s) }} title={`saved at seq ${s}`}>
              <span className="tick" style={{ position: "static", display: "inline-block", marginRight: 4 }} />
              saved {s}
            </span>
          ))}
          {p.checkpoints.slice(-3).map((c, i) => (
            <span key={`c${i}`} className="cp" style={{ left: x(c.seq) }} title={c.error ?? `commit ${c.committed}`}>
              <span className="pcb-diamond" />
              {c.committed ? `commit ${c.committed}` : "checkpoint"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatusLine(p: { derived?: PageDerived; parts: number; nets: number; scale: number; lod: Lod; cursor?: [number, number]; dir?: string }) {
  const d = p.derived;
  const volt = d?.findings.filter((f) => f.check === "voltage" && f.severity === "error").length ?? 0;
  const open = d?.findings.filter((f) => f.check === "unconnected_pin").length ?? 0;
  const other = (d?.findings.length ?? 0) - volt - open;
  return (
    <footer className="pcb-status">
      {d ? (
        <>
          <span className="item" data-status="voltage">
            <span className={`sev ${volt ? "fail" : ""}`}>{volt ? "✖" : "✓"}</span> <b>{volt}</b> voltage {volt === 1 ? "error" : "errors"}
          </span>
          <span className="item" data-status="unconnected">
            <span className={`sev ${open ? "warn" : ""}`}>{open ? "▲" : "✓"}</span> <b>{open}</b> unconnected pins
          </span>
          {other > 0 && (
            <span className="item">
              <span className="sev warn">▲</span> <b>{other}</b> other findings
            </span>
          )}
          <span className="item" data-status="readability">
            readability <b>{d.score}</b>
            {d.gates.open ? <span className="pcb-chip fail">{d.gates.open} gate{d.gates.open === 1 ? "" : "s"} open</span> : <span className="pcb-chip pass">gates closed</span>}
          </span>
          <span className="item">ours · {clock(new Date().toISOString())} · seq {d.seq} · {Math.round(d.ms)} ms</span>
        </>
      ) : (
        <span className="item">Scoring the sheet…</span>
      )}
      <span className="right">
        <span>
          <b>{p.parts}</b> parts · <b>{p.nets}</b> nets
        </span>
        <span>
          zoom <b>{Math.round((p.scale / 16) * 100)}%</b> · L{p.lod}
        </span>
        <span>
          X <b>{p.cursor ? p.cursor[0].toFixed(1) : "-"}</b> Y <b>{p.cursor ? p.cursor[1].toFixed(1) : "-"}</b> gu
        </span>
        {p.dir && <span>positions in {p.dir}</span>}
      </span>
    </footer>
  );
}

// ------------------------------------------------------------------ panels

export function ChipTag({ chip }: { chip: Chip }) {
  return <span className={`sch-chip ${chip}`}>{chip}</span>;
}

export function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="sch-facts">
      {facts.map((f, i) => (
        <FactRow key={i} f={f} />
      ))}
    </dl>
  );
}
function FactRow({ f }: { f: Fact }) {
  return (
    <>
      <dt>{f.label}</dt>
      <dd>{f.value}</dd>
      <span>{f.chip ? <ChipTag chip={f.chip} /> : null}</span>
      {f.why && <span className="why">{f.why}</span>}
    </>
  );
}

const LOD_NAMES: Record<number, string> = { 0: "L0 system", 1: "L1 blocks", 2: "L2 symbols", 3: "L3 pins" };

export function DepthStops({ lod, onStop, systemEnabled }: { lod: Lod; onStop: (l: 0 | Lod) => void; systemEnabled: boolean }) {
  return (
    <div className="sch-depth" data-lod={lod}>
      {[0, 1, 2, 3].map((l) => (
        <button key={l} className={lod === l ? "on" : ""} disabled={l === 0 && !systemEnabled} onClick={() => onStop(l as 0 | Lod)} title={l === 0 ? "The system diagram" : `Zoom to ${LOD_NAMES[l]}`}>
          <i />
          {LOD_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

export function BlocksPanel(p: { model: PageModel; items: ReadonlyMap<string, PageItem>; derived?: PageDerived; lod: Lod; onStop: (l: 0 | Lod) => void; systemEnabled: boolean; onCard: (id: string) => void; selected: readonly string[]; onLayoutAll?: () => void }) {
  const cards = [...p.items.values()].filter((i) => i.kind === "card");
  const members = (id: string) => [...p.items.values()].filter((i) => i.kind === "symbol" && i.card === id);
  return (
    <>
      <div className="pcb-sec">
        <h4>
          Depth <i>one zoom · ctrl + wheel</i>
        </h4>
        <DepthStops lod={p.lod} onStop={p.onStop} systemEnabled={p.systemEnabled} />
      </div>
      <div className="pcb-sec">
        <h4>
          {cards.length} cards <i>one per UHD sub-module</i>
        </h4>
        {cards.map((c) => {
          const m = members(c.id);
          const score = p.derived?.cards[c.id];
          return (
            <button key={c.id} className={`pcb-row${p.selected.includes(c.id) ? " on" : ""}`} onClick={() => p.onCard(c.id)} title={`${String(c.rec.group || "the board's root")} · ${m.length} parts`} style={{ width: "100%" }}>
              <span className="name">{String(c.rec.title)}</span>
              <span className="short">{m.length} parts</span>
              {score !== undefined && <span className="short">{score}</span>}
            </button>
          );
        })}
        {p.onLayoutAll && (
          <div className="sch-actions" style={{ marginTop: 10 }}>
            <button className="pcb-btn" onClick={p.onLayoutAll} title="Run the automatic layout on every card; pinned items stay where they are">
              <Icon name="reroute" size={12} /> Lay out all cards
            </button>
          </div>
        )}
      </div>
      <div className="pcb-sec">
        <h4>Cards on one grid</h4>
        <p className="pcb-notes">Each card grows to fit its circuit and keeps its place when the layout runs again. Nets that leave a card become labels; ground and supply rails are symbols. Moving a part to another card is an explicit regroup (Inspect).</p>
      </div>
    </>
  );
}

export function NetsPanel(p: { nets: readonly PageNet[]; colors: Record<string, string>; lit?: string; onLight: (net: string | undefined) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => p.nets.filter((n) => !q || n.name.toLowerCase().includes(q.toLowerCase())), [p.nets, q]);
  return (
    <div className="pcb-sec">
      <h4>
        {p.nets.length} nets <i>by signal class</i>
      </h4>
      <input className="pcb-search" placeholder="Find a net" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      {shown.map((n) => (
        <button key={n.name} className={`pcb-row${p.lit === n.name ? " on" : ""}`} onClick={() => p.onLight(p.lit === n.name ? undefined : n.name)} style={{ width: "100%" }} data-net={n.name}>
          <span className="sw" style={{ background: p.colors[n.cls] ?? "#999" }} />
          <span className="name">{n.shown}</span>
          <span className="short">{n.pins.length} pins</span>
          <span className="short">{n.cards.length > 1 ? `${n.cards.length} cards` : n.cls}</span>
        </button>
      ))}
    </div>
  );
}

const CHECK_WORDS: Record<string, string> = { unconnected_pin: "Unconnected pin", single_pin_net: "Net with one pin", conflicting_outputs: "Outputs drive one net", voltage: "Voltage" };

export function ChecksPanel(p: { derived?: PageDerived; active?: string; onLocate: (f: PageFinding) => void }) {
  const f = p.derived?.findings ?? [];
  const n = (s: string) => f.filter((x) => x.severity === s).length;
  return (
    <div className="pcb-sec">
      <h4>
        Electrical checks <i>from UHD, after every commit</i>
      </h4>
      <div className="pcb-counts">
        <span className="fail">{n("error")} errors</span>
        <span className="warn">{n("warning")} warnings</span>
        <span>{n("info")} notes</span>
      </div>
      {!f.length && <div className="pcb-empty">No electrical finding: every pin is on a net or marked open, no net has one pin, no outputs fight, no voltage exceeds a pin's limit.</div>}
      {f.map((x) => (
        <div key={x.id} className={`pcb-finding${p.active === x.id ? " on" : ""}`} onClick={() => p.onLocate(x)} data-finding={x.id}>
          <span className={`sev ${x.severity === "error" ? "fail" : x.severity === "warning" ? "warn" : ""}`} style={{ color: x.severity === "error" ? "var(--pcb-fail)" : x.severity === "warning" ? "var(--pcb-warn)" : "var(--pcb-mute)" }}>
            {x.severity === "error" ? "✖" : "▲"}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="ttl">{CHECK_WORDS[x.check] ?? x.check}</div>
            <div className="msg">{x.message}</div>
            {x.path && p.active === x.id && (
              <ol className="sch-path">
                {x.path.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ReadabilityProps {
  derived?: PageDerived;
  model: PageModel;
  activeDefect?: string;
  onDefect: (d: PageDefect | undefined) => void;
  fixes?: PageFix[];
  fixesFor?: string;
  activeFix?: number;
  onFixHover: (i: number | undefined) => void;
  onAccept?: (d: PageDefect, f: PageFix) => void;
  onReject: (d: PageDefect, f: PageFix) => void;
  rejected: ReadonlySet<string>;
  cleanup?: PageCleanup;
  busy?: string;
  onCleanup?: () => void;
  onCleanupApply?: () => void;
  onCleanupDiscard?: () => void;
  onCleanupRevert?: () => void;
}

export function ReadabilityPanel(p: ReadabilityProps) {
  const d = p.derived;
  if (!d) return <div className="pcb-empty">Scoring the sheet…</div>;
  const c = p.cleanup;
  const sevColor = (s: string) => p.model.severity[s as "error"] ?? "#888";
  return (
    <>
      <div className="pcb-sec">
        <h4>
          Readability <i>30 rules · score {d.presentable ? "presentable" : "not presentable"}</i>
        </h4>
        <div className="sch-score">
          <div>
            <div className="cap">{c ? "before" : "score"}</div>
            <div className={`big${!c && d.gates.open === 0 && d.score >= 90 ? " good" : ""}`} data-score={d.score}>
              {c ? c.before.score : d.score}
            </div>
          </div>
          {c && (
            <>
              <span className="arrow">→</span>
              <div>
                <div className="cap">{c.applied ? "after" : "after · preview"}</div>
                <div className={`big${c.after.score > c.before.score ? " good" : ""}`}>{c.after.score}</div>
              </div>
            </>
          )}
          <span style={{ marginLeft: "auto", textAlign: "right" }} className="cap">
            {d.defects.length} defects
            <br />
            {d.gates.open ? `${d.gates.open} gates open` : "gates closed"}
          </span>
        </div>
        <div className="sch-gates">
          {d.gateRules.map((g) => (
            <span key={g.id} className={`sch-gate${g.count ? " open" : ""}`} title={g.title} data-gate={g.id}>
              {g.id} <b>{g.count ? g.count : "✓"}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="pcb-sec">
        <h4>
          Clean up with the agent <i>bounded passes · a preview first</i>
        </h4>
        {!c && (
          <div className="sch-actions">
            <button className="pcb-btn" disabled={!p.onCleanup || !!p.busy} onClick={p.onCleanup} data-action="cleanup-preview">
              <Icon name="sparkle" size={12} /> {p.busy === "cleanup" ? "Running on a copy…" : "Run a cleanup pass"}
            </button>
          </div>
        )}
        {c && (
          <>
            <p className="pcb-notes">
              {c.steps.length} fix{c.steps.length === 1 ? "" : "es"} in {c.passes} pass{c.passes === 1 ? "" : "es"} ({c.stopped.replace(/-/g, " ")}), gates {c.before.gates} → {c.after.gates}. {c.applied ? "Applied as one change set." : "Preview only, nothing written: the blue ghost shows every change."}
            </p>
            {c.steps.slice(0, 8).map((s, i) => (
              <div key={i} className="sch-fix" style={{ paddingLeft: 0 }}>
                <span className="num">{i + 1}</span>
                <span className="t">
                  {s.title}
                  <span>
                    {s.rule} · {s.before} → {s.after}
                  </span>
                </span>
                <span className="gain">{s.after - s.before >= 0 ? "+" : ""}{Math.round((s.after - s.before) * 10) / 10}</span>
              </div>
            ))}
            <div className="sch-actions" style={{ marginTop: 8 }}>
              {!c.applied ? (
                <>
                  <button className="pcb-btn main" disabled={!p.onCleanupApply || !!p.busy || !c.steps.length} onClick={p.onCleanupApply} data-action="cleanup-apply">
                    <Icon name="check" size={12} /> Apply {c.steps.length} fix{c.steps.length === 1 ? "" : "es"}
                  </button>
                  <button className="pcb-btn" onClick={p.onCleanupDiscard} data-action="cleanup-discard">
                    Discard
                  </button>
                </>
              ) : (
                <>
                  <button className="pcb-btn" disabled={!p.onCleanupRevert || !!p.busy} onClick={p.onCleanupRevert} data-action="cleanup-revert">
                    <Icon name="undo" size={12} /> Revert the whole pass
                  </button>
                  <button className="pcb-btn" onClick={p.onCleanupDiscard}>
                    Keep
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div className="pcb-sec">
        <h4>
          Numbered defects <i>same numbers on the sheet and in the agent's scene</i>
        </h4>
        {!d.defects.length && <div className="pcb-empty">No readability defect.</div>}
        {d.defects.map((x) => (
          <div key={x.id} data-defect={x.n}>
            <div className={`sch-defect${p.activeDefect === x.id ? " on" : ""}`} onClick={() => p.onDefect(p.activeDefect === x.id ? undefined : x)} style={{ ["--sev" as string]: sevColor(x.severity) }}>
              <span className="nb">{x.n}</span>
              <span className="txt">
                <b>{x.message}</b>
                <span>
                  {x.rule} {x.title.toLowerCase()} · {x.severity}
                  {x.cardTitle ? ` · ${x.cardTitle}` : ""} · {x.points} pt
                </span>
              </span>
            </div>
            {p.activeDefect === x.id && p.fixesFor === x.id && (
              <div>
                {!p.fixes && <div className="sch-fix mute">Proposing fixes…</div>}
                {p.fixes && !p.fixes.filter((f) => !p.rejected.has(`${x.id}#${f.index}`)).length && <div className="sch-fix mute">No candidate fix raises the score here; this one needs a person.</div>}
                {p.fixes
                  ?.filter((f) => !p.rejected.has(`${x.id}#${f.index}`))
                  .map((f) => (
                    <div key={f.index} className={`sch-fix${p.activeFix === f.index ? " on" : ""}`} onMouseEnter={() => p.onFixHover(f.index)} data-fix={f.index}>
                      <span className="t">
                        {f.title}
                        <span>
                          {f.rule} · {f.ops.length} operation{f.ops.length === 1 ? "" : "s"} · {f.before} → {f.after}
                          {f.resolved ? " · resolves it" : ""}
                        </span>
                      </span>
                      <span className="gain">
                        {f.delta >= 0 ? "+" : ""}
                        {Math.round(f.delta * 10) / 10}
                      </span>
                      <button className="sch-sq ok" disabled={!p.onAccept} onClick={() => p.onAccept?.(x, f)} title="Accept: apply it as your change (one undo step)" data-action="accept-fix">
                        <Icon name="check" size={12} />
                      </button>
                      <button className="sch-sq" onClick={() => p.onReject(x, f)} title="Reject: hide this fix" data-action="reject-fix">
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** A symbol drawn alone (the part card's face): the host's markup in a small SVG. */
export function SymbolFace({ item, pin }: { item: PageItem; pin?: PagePin }) {
  const b = item.box;
  const fb = item.fieldBox ?? b;
  const x0 = Math.min(b[0], fb[0]) - 1.5;
  const y0 = Math.min(b[1], fb[1]) - 1.5;
  const x1 = Math.max(b[2], fb[2]) + 1.5;
  const y1 = Math.max(b[3], fb[3]) + 1.5;
  const mark = pin ? `<rect x="${pin.at[0] - 0.6}" y="${pin.at[1] - 0.6}" width="1.2" height="1.2" rx="0.2" fill="rgba(90,169,255,0.15)" stroke="#5aa9ff" stroke-width="0.12"/>` : "";
  const inner = `${item.svg}${item.pinText ? `<g transform="${item.transform ?? ""}">${item.pinText}</g>` : ""}${item.fields ?? ""}${mark}`;
  return <svg className="sch-partsvg" viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: inner }} />;
}

export interface InspectProps {
  model: PageModel;
  items: ReadonlyMap<string, PageItem>;
  derived?: PageDerived;
  selection: readonly string[];
  pin?: PagePin;
  proposed: ReadonlySet<string>;
  writable: boolean;
  onPin: (p: PagePin | undefined) => void;
  act: {
    rotate(): void;
    mirror(): void;
    pin(on: boolean): void;
    convert(): void;
    layoutCard(card: string, mode: "fresh" | "tidy"): void;
    regroup(card: string): void;
    light(net: string): void;
    remove(): void;
  };
  layoutKnown: boolean;
  /** references of the parts the layout's selection probes here */
  probed?: string[];
}

export function InspectPanel(p: InspectProps) {
  const cards = useMemo(() => new Map([...p.items.values()].filter((i) => i.kind === "card").map((c) => [c.id, String(c.rec.title)])), [p.items]);
  const sel = p.selection.map((id) => p.items.get(id)).filter((x): x is PageItem => !!x);
  const first = sel[0];
  const legend = (
    <div className="pcb-sec">
      <h4>
        Status chips <i>on every fact</i>
      </h4>
      <div className="sch-chips">
        {CHIPS.map((c) => (
          <ChipTag key={c} chip={c} />
        ))}
      </div>
    </div>
  );
  if (!first)
    return (
      <>
        <div className="pcb-empty">Select a symbol, a pin, a wire, a label or a card. A pin shows its datasheet facts from UHD; a part shows its card.</div>
        {p.probed?.length ? (
          <div className="pcb-sec">
            <h4>
              From the layout <i>cross-probe</i>
            </h4>
            <div className="pcb-row on">
              <Icon name="board" size={13} />
              <span className="name">{p.probed.join(" ")}</span>
              <span className="short">selected in the layout</span>
            </div>
          </div>
        ) : null}
        {legend}
        <OnSheet derived={p.derived} />
      </>
    );
  if (first.kind === "symbol") {
    const part = p.model.parts.find((x) => x.path === first.rec.part);
    if (!part) return <div className="pcb-empty">This symbol's part is not in the circuit any more.</div>;
    const pin = p.pin && p.pin.part === part.path ? p.pin : undefined;
    const proposed = p.proposed.has(first.id);
    return (
      <>
        {pin && (
          <div className="pcb-sec" data-inspect="pin">
            <h4>
              {part.ref} · pin {pin.number} · {pin.name} <i>pin</i>
            </h4>
            <p className="pcb-notes" style={{ marginTop: -4 }}>
              {part.path} · {part.name}
              {pin.net ? ` · net ${pin.net}` : ""}
            </p>
            <FactList facts={pinFacts(part, pin.pin, { ...(p.derived ? { derived: p.derived } : {}), nets: p.model.nets, ...(p.model.stale ? { stale: true } : {}), proposed })} />
            {p.derived?.findings
              .filter((f) => f.check === "voltage" && f.objects.some((o) => pin.keys.includes(o.replace(/^pin:/, ""))))
              .map((f) => (
                <div key={f.id} className="pcb-note fail" style={{ marginTop: 10 }}>
                  <b className="mono" style={{ color: "var(--pcb-fail)", fontSize: 10 }}>
                    {f.severity === "error" ? "FAIL" : "CHECK"} · voltage
                  </b>
                  <ol className="sch-path">
                    {(f.path ?? []).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
            <div className="pcb-sec" style={{ padding: "10px 0 0", borderBottom: 0 }}>
              <h4>Same pin in</h4>
              <div className="pcb-row">
                <Icon name="board" size={13} /> <span className="name">Layout · {part.ref} pad {pin.number}</span>
                <span className="short">{p.layoutKnown ? "cross-probed" : "no board folder"}</span>
              </div>
              <div className="pcb-row">
                <Icon name="file" size={13} /> <span className="name">UHD · {part.path}.{pin.pin}</span>
              </div>
            </div>
          </div>
        )}
        <div className="pcb-sec" data-inspect="part">
          <h4>
            {part.ref} · {part.value ?? part.name} <i>part card</i>
          </h4>
          <SymbolFace item={first} {...(pin ? { pin } : {})} />
          <div style={{ height: 10 }} />
          <FactList facts={partFacts(part, { ...(p.model.stale ? { stale: true } : {}), proposed, refFromBoard: false })} />
          {first.pinned && (
            <div className="pcb-note" style={{ marginTop: 8 }}>
              Pinned by hand: the layout and agents leave it where it is.
            </div>
          )}
          <div className="sch-actions" style={{ marginTop: 10 }}>
            <button className="pcb-btn" disabled={!p.writable} onClick={p.act.rotate}>
              <Icon name="rotate" size={12} /> Rotate
            </button>
            <button className="pcb-btn" disabled={!p.writable} onClick={p.act.mirror}>
              <Icon name="flip" size={12} /> Mirror
            </button>
            <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.pin(!first.pinned)}>
              <Icon name={first.pinned ? "unlock" : "lock"} size={12} /> {first.pinned ? "Unpin" : "Pin"}
            </button>
            {first.card && (
              <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.layoutCard(first.card!, "fresh")} title="Lay out this card again; pinned items stay">
                <Icon name="reroute" size={12} /> Lay out card
              </button>
            )}
          </div>
          <div className="sch-actions" style={{ marginTop: 8, alignItems: "center" }}>
            <span className="caps mute">Regroup</span>
            <select className="sch-select" disabled={!p.writable} value={first.card} onChange={(e) => p.act.regroup(e.target.value)} title="Show the selected symbols in another card (presentation; reported until UHD moves the part)">
              {[...cards].map(([id, t]) => (
                <option key={id} value={id}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pcb-sec">
          <h4>
            {part.pins.length} pins <i>click a pin</i>
          </h4>
          <table className="sch-pins">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {part.pins.map((q) => {
                const placed = first.pins?.find((x) => x.keys.includes(`${part.path}:${q.id}`));
                return (
                  <tr key={q.id} className={pin?.pin === q.id ? "on" : ""} onClick={() => placed && p.onPin({ ...placed, pin: q.id, number: q.number, name: q.name })}>
                    <td>{q.number}</td>
                    <td>{q.name}</td>
                    <td className="mute">{q.type.replace(/_/g, " ")}</td>
                    <td className={q.net ? "" : "mute"}>{q.net ?? (q.open ? "open" : "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pcb-sec">
          <h4>Sourcing</h4>
          <p className="pcb-notes">{part.mpn ? `UHD names ${part.mpn}; supplier stock and price come from the project's sourcing data, which this screen does not read yet.` : "UHD names no part number for this part; the BOM tab's sourcing data is where a supplier part is recorded."}</p>
        </div>
        {legend}
      </>
    );
  }
  if (first.kind === "card") {
    const members = [...p.items.values()].filter((i) => i.kind === "symbol" && i.card === first.id);
    return (
      <div className="pcb-sec" data-inspect="card">
        <h4>
          {String(first.rec.title)} <i>card</i>
        </h4>
        <FactList
          facts={[
            { label: "Sub-module", value: String(first.rec.group || "the board's root"), chip: "authored" },
            { label: "Parts", value: members.map((m) => String(m.rec.ref)).join(" ") || "none" },
            { label: "Size", value: `${first.box[2] - first.box[0]} × ${first.box[3] - first.box[1]} grid` },
            ...(p.derived?.cards[first.id] !== undefined ? [{ label: "Readability", value: String(p.derived.cards[first.id]), chip: "inferred" as Chip }] : []),
          ]}
        />
        <div className="sch-actions" style={{ marginTop: 10 }}>
          <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.layoutCard(first.id, "fresh")}>
            <Icon name="reroute" size={12} /> Lay out card
          </button>
          <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.layoutCard(first.id, "tidy")}>
            Redraw wiring
          </button>
          <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.pin(!first.pinned)}>
            <Icon name={first.pinned ? "unlock" : "lock"} size={12} /> {first.pinned ? "Unpin" : "Pin"}
          </button>
        </div>
      </div>
    );
  }
  const net = first.net ? p.model.nets.find((n) => n.name === first.net) : undefined;
  return (
    <div className="pcb-sec" data-inspect={first.kind}>
      <h4>
        {first.kind === "power" ? "power symbol" : first.kind} {net ? `· ${net.shown}` : ""} <i>{sel.length > 1 ? `${sel.length} selected` : ""}</i>
      </h4>
      {net && <FactList facts={netFacts(net, { ...(p.derived ? { derived: p.derived } : {}), parts: p.model.parts, cards })} />}
      {net && (
        <p className="pcb-notes" style={{ marginTop: 8 }}>
          {net.pins.map((k) => pinWords(p.model, k)).join(", ")}
        </p>
      )}
      <div className="sch-actions" style={{ marginTop: 10 }}>
        {net && (
          <button className="pcb-btn" onClick={() => p.act.light(net.name)}>
            <Icon name="eye" size={12} /> Light net
          </button>
        )}
        {(first.kind === "wire" || first.kind === "label") && (
          <button className="pcb-btn" disabled={!p.writable} onClick={p.act.convert} title="L">
            {first.kind === "wire" ? "To labels" : "To a wire"}
          </button>
        )}
        {first.kind !== "noconnect" && (
          <button className="pcb-btn" disabled={!p.writable} onClick={() => p.act.pin(!first.pinned)}>
            <Icon name={first.pinned ? "unlock" : "lock"} size={12} /> {first.pinned ? "Unpin" : "Pin"}
          </button>
        )}
        <button className="pcb-btn" disabled={!p.writable} onClick={p.act.remove}>
          <Icon name="trash" size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

function OnSheet({ derived }: { derived?: PageDerived }) {
  if (!derived) return null;
  const errors = derived.findings.filter((f) => f.severity === "error");
  return (
    <div className="pcb-sec">
      <h4>
        On this sheet <i>{errors.length} error{errors.length === 1 ? "" : "s"}</i>
      </h4>
      {errors.slice(0, 4).map((f) => (
        <div key={f.id} className="pcb-row" style={{ height: "auto", padding: "4px 6px", alignItems: "flex-start" }}>
          <span style={{ color: "var(--pcb-fail)" }}>✖</span>
          <span className="name" style={{ whiteSpace: "normal" }}>
            {f.message}
          </span>
          <ChipTag chip="conflict" />
        </div>
      ))}
      <div className="pcb-row">
        <span style={{ color: derived.gates.open ? "var(--pcb-fail)" : "var(--pcb-pass)" }}>{derived.gates.open ? "✖" : "✓"}</span>
        <span className="name">Readability gates C01 to C06</span>
        <span className="short">{derived.gates.open ? `${derived.gates.open} open` : "clean"}</span>
      </div>
    </div>
  );
}

export type { PagePart };

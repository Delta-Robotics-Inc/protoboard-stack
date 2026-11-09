/** The right panel's tabs: Layers, Nets, Checks, Inspect. Plain props in, callbacks out; the screen owns the state. */
import { useMemo, useState, type ReactNode } from "react";
import type { CopperLayer } from "../board.js";
import { groupSwatch } from "../colors.js";
import type { Inspection } from "../inspect.js";
import { fmtMm } from "../inspect.js";
import { layerGroups, PRESETS, type PresetId } from "../layers.js";
import { checkWords, type FindingText } from "../findings-text.js";
import { dotSvg, markerKind } from "../markers.js";
import type { CheckSummary, PcbFinding } from "../types.js";
import { Icon } from "./icons.js";

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button className={`pcb-toggle${on ? " on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="knob" />
      <span>{children}</span>
    </button>
  );
}

export interface LayersPanelProps {
  copper: CopperLayer[];
  groups: Set<string>;
  active: CopperLayer;
  grayInactive: boolean;
  preset?: PresetId;
  thicknessNm?: number;
  handTracks: number;
  routedTracks: number;
  classes: { name: string; width?: number; clearance?: number; tier?: string; nets: number }[];
  selection?: { title: string; count: number };
  onToggle: (group: string) => void;
  onActive: (layer: CopperLayer) => void;
  onPreset: (p: PresetId) => void;
  onGray: (v: boolean) => void;
  onInspect: () => void;
}

export function LayersPanel(p: LayersPanelProps) {
  const rows = layerGroups(p.copper);
  return (
    <>
      <div className="pcb-sec">
        <h4>
          <span>
            {p.copper.length} {p.copper.length === 1 ? "layer" : "layers"}
            {p.thicknessNm ? ` · ${fmtMm(p.thicknessNm, 2)} mm` : ""}
          </span>
          <i>eye = visible</i>
        </h4>
        {rows.map((r) => {
          const shown = p.groups.has(r.id);
          const active = r.copper === p.active;
          return (
            <div key={r.id} className={`pcb-row${active ? " on" : ""}${shown ? "" : " off"}`}>
              <span className="sw" style={{ background: groupSwatch(r.id, p.active, p.grayInactive), opacity: shown ? 1 : 0.35 }} />
              {r.copper ? (
                <button className="name" onClick={() => p.onActive(r.copper!)} title={`Make ${r.label.toLowerCase()} the active layer (PageUp, PageDown, + and -)`}>
                  {r.label}
                </button>
              ) : (
                <span className="name">{r.label}</span>
              )}
              {active && <span className="tag">ACTIVE</span>}
              <span className="short">{r.short}</span>
              <button className="eye" onClick={() => p.onToggle(r.id)} title={shown ? `Hide ${r.label.toLowerCase()}` : `Show ${r.label.toLowerCase()}`} aria-pressed={shown}>
                <Icon name={shown ? "eye" : "eyeOff"} size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="pcb-sec">
        <h4>
          <span>Presets</span>
          <i>Alt+1 to 4</i>
        </h4>
        <div className="pcb-presets">
          {PRESETS.map((x) => (
            <button key={x.id} className={p.preset === x.id ? "on" : ""} onClick={() => p.onPreset(x.id)} title={x.key}>
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <Toggle on={p.grayInactive} onChange={p.onGray}>
            Inactive copper layer drawn gray <span className="mute">(G)</span>
          </Toggle>
        </div>
      </div>
      <div className="pcb-sec">
        <h4>
          <span>Copper origin</span>
          <i>how it looks</i>
        </h4>
        <div className="pcb-legend">
          <span className="line" style={{ background: "linear-gradient(#a13e35 0 40%, #e8c8c4 40% 60%, #a13e35 60%)" }} />
          <span className="name">Hand · locked against routers</span>
          <span className="mute">{p.handTracks} tracks</span>
        </div>
        <div className="pcb-legend">
          <span className="line" style={{ background: "#b56a62" }} />
          <span className="name">Autorouted · may move</span>
          <span className="mute">{p.routedTracks} tracks</span>
        </div>
      </div>
      <div className="pcb-sec">
        <h4>
          <span>Net classes</span>
          <i>width / gap mm</i>
        </h4>
        {p.classes.length === 0 && <div className="mute">No net classes on this board.</div>}
        {p.classes.map((c) => (
          <div key={c.name} className="pcb-row">
            <span className="name">{c.name}</span>
            <span className="short">
              {c.width !== undefined ? fmtMm(c.width, 2) : "-"} / {c.clearance !== undefined ? fmtMm(c.clearance, 2) : "-"}
            </span>
            {c.tier && <span className="pcb-chip">{c.tier === "floor" ? "fab floor" : c.tier}</span>}
          </div>
        ))}
      </div>
      <div className="pcb-sec">
        <h4>
          <span>Selection</span>
        </h4>
        {p.selection ? (
          <div className="pcb-row on" style={{ cursor: "pointer" }} onClick={p.onInspect}>
            <span className="name">
              {p.selection.title}
              {p.selection.count > 1 ? ` and ${p.selection.count - 1} more` : ""}
            </span>
            <span className="short">Inspect · I</span>
          </div>
        ) : (
          <div className="mute">Nothing selected.</div>
        )}
      </div>
    </>
  );
}

export interface NetRow {
  name: string;
  cls: string;
  pads: number;
  tracks: number;
  vias: number;
}

export function NetsPanel({ nets, lit, dim, onLight, onDim }: { nets: NetRow[]; lit: string[]; dim: boolean; onLight: (net: string | undefined, add: boolean) => void; onDim: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? nets.filter((n) => n.name.toLowerCase().includes(s) || n.cls.toLowerCase().includes(s)) : nets;
  }, [nets, q]);
  return (
    <>
      <div className="pcb-sec">
        <input className="pcb-search" placeholder="Search nets or classes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <Toggle on={dim} onChange={onDim}>
            Dim the other nets
          </Toggle>
          {lit.length > 0 && (
            <button className="pcb-btn ghost" onClick={() => onLight(undefined, false)}>
              Clear · Esc
            </button>
          )}
        </div>
      </div>
      <div className="pcb-sec">
        <h4>
          <span>
            {shown.length} of {nets.length} nets
          </span>
          <i>pads · tracks · vias</i>
        </h4>
        {shown.map((n) => (
          <div key={n.name} className={`pcb-row${lit.includes(n.name) ? " on" : ""}`} style={{ cursor: "pointer" }} onClick={(e) => onLight(n.name, e.shiftKey || e.ctrlKey || e.metaKey)} title="Click to light this net; Shift adds it">
            <span className="name">{n.name}</span>
            <span className="short">{n.cls}</span>
            <span className="short" style={{ width: 70, textAlign: "right" }}>
              {n.pads} · {n.tracks} · {n.vias}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Where a rule came from in the source (board setup, a net class, a custom rule), when the board records it. */
export type RuleFrom = (ruleId: string) => string | undefined;

/** A finding in plain language (findings-text.ts), as the screen hands it to its panels and callouts. */
export type Describe = (f: PcbFinding) => FindingText;

/** The plain words of a finding: the formatter's, else (no document at hand) its own message. */
const plain = (f: PcbFinding, describe?: Describe): FindingText => describe?.(f) ?? { title: f.check.replace(/_/g, " "), sentence: f.message, ids: [f.id, ...f.objects], check: f.check.replace(/_/g, " ") };

/** The ids behind a finding, for a hover title (never for reading). */
const idsTitle = (ids: readonly string[], from?: string) => `${ids.join("\n")}${from ? `\nrule from ${from}` : ""}`;

const SEV_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** The checks' notes, the "not checked: no rule" ones gathered into one line. */
export function gatherNotes(notes: readonly string[]): string[] {
  const unruled: string[] = [];
  const rest: string[] = [];
  for (const n of [...new Set(notes)]) {
    const m = /^(\w+) not checked: no enabled \1 rule on the board\.?$/.exec(n);
    if (m) unruled.push(checkWords(m[1]));
    else rest.push(n);
  }
  return [...(unruled.length ? [`Not checked, no rule on the board: ${unruled.join(", ")}.`] : []), ...rest];
}

export function ChecksPanel({ findings, checks, notes, active, onLocate, ruleFrom, describe }: { findings: readonly PcbFinding[] | undefined; checks: CheckSummary; notes?: readonly string[]; active?: string; onLocate: (f: PcbFinding) => void; ruleFrom?: RuleFrom; describe?: Describe }) {
  const said = gatherNotes([...(notes ?? []), ...(checks.ran ? (checks.caveats ?? []) : [])]);
  const noteList = said.length ? (
    <div className="pcb-notes">
      {said.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  ) : null;
  if (!checks.ran && !findings?.length)
    return (
      <div className="pcb-empty">
        No check has run on this board yet, so there are no findings to show.{checks.reason ? ` ${checks.reason}.` : ""}
        {noteList}
        <div className="mute" style={{ marginTop: 8, fontSize: 11.5 }}>
          Findings appear here when the host hands in a check run: each one is a marker on the board, and clicking it here frames it.
        </div>
      </div>
    );
  const list = findings ?? [];
  if (!list.length)
    return (
      <div className="pcb-empty">
        The last check found nothing on this board.
        {noteList}
      </div>
    );
  const sorted = [...list].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.check < b.check ? -1 : a.check > b.check ? 1 : a.id < b.id ? -1 : 1));
  // counted as the status line counts them: open connections apart from errors
  const open = list.filter((f) => f.check === "unconnected").length;
  const e = list.filter((f) => f.severity === "error" && f.check !== "unconnected").length;
  const w = list.filter((f) => f.severity === "warning").length;
  return (
    <div className="pcb-sec">
      <h4>
        <span>
          {list.length} {list.length === 1 ? "finding" : "findings"}
        </span>
        <i>click one to frame it</i>
      </h4>
      <div className="pcb-counts">
        {e > 0 && <span className="fail">{e} {e === 1 ? "error" : "errors"}</span>}
        {w > 0 && <span className="warn">{w} {w === 1 ? "warning" : "warnings"}</span>}
        {open > 0 && <span>{open} open {open === 1 ? "connection" : "connections"}</span>}
      </div>
      {noteList}
      {sorted.map((f) => {
        const d = plain(f, describe);
        return (
          <div key={f.id} className={`pcb-finding${f.id === active ? " on" : ""}`} onClick={() => onLocate(f)} title={idsTitle(d.ids, f.rule ? ruleFrom?.(f.rule) : undefined)}>
            <svg width="12" height="12" viewBox="-6 -6 12 12" className="sev" dangerouslySetInnerHTML={{ __html: dotSvg(markerKind(f), 3.6) }} />
            <div style={{ minWidth: 0 }}>
              <div className="ttl">{d.title}</div>
              <div className="msg">{d.sentence}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The one callout a finding gets on the canvas: quiet, its plain sentence, its ids on hover. */
export function FindingCallout({ f, at, maxLeft, maxTop, hover, describe }: { f: PcbFinding; at: { x: number; y: number }; maxLeft: number; maxTop?: number; hover: boolean; describe?: Describe }) {
  const d = plain(f, describe);
  const left = Math.max(8, Math.min(at.x + 20, maxLeft));
  // below the marker, or above it when it would run into the timeline
  const above = maxTop !== undefined && at.y + 130 > maxTop;
  return (
    <div className="pcb-callout finding" style={above ? { left, top: at.y - 18, transform: "translateY(-100%)" } : { left, top: at.y + 22 }} title={idsTitle(d.ids)}>
      <div className="shelf">
        <svg width="10" height="10" viewBox="-5 -5 10 10" dangerouslySetInnerHTML={{ __html: dotSvg(markerKind(f), 3.2) }} />
        <span>
          {f.severity === "info" ? "note" : f.severity} · {d.check}
        </span>
        <i>{hover ? "hover" : "selected"}</i>
      </div>
      <p>{d.sentence}</p>
    </div>
  );
}

export function InspectPanel({ items, total, onLook, finding, ruleFrom, describe }: { items: Inspection[]; total: number; onLook: () => void; finding?: PcbFinding; ruleFrom?: RuleFrom; describe?: Describe }): ReactNode {
  // the finding these objects were selected for, in plain words, with the rule it names and where that rule came from
  const d = finding ? plain(finding, describe) : undefined;
  const about =
    finding && d ? (
      <div className="pcb-sec" data-finding={finding.id} title={idsTitle(d.ids)}>
        <h4>
          <span>finding</span>
          <i>{d.check}</i>
        </h4>
        <div className="pcb-ftitle">{d.title}</div>
        <div className="msg" style={{ marginBottom: 10 }}>
          {d.sentence}
        </div>
        <dl className="pcb-kv">
          {finding.measured !== undefined && <Kv label="Measured" value={fmtMm(finding.measured)} unit="mm" />}
          {finding.required !== undefined && <Kv label="Required" value={fmtMm(finding.required)} unit="mm" />}
          {d.source && <Kv label="Limit" value={d.source} />}
          {finding.rule && ruleFrom?.(finding.rule) && <Kv label="From" value={ruleFrom(finding.rule)!} />}
          {finding.location.layer && <Kv label="Layer" value={finding.location.layer.replace(/_/g, " ")} />}
        </dl>
      </div>
    ) : null;
  if (about) {
    const rest: ReactNode = InspectPanel({ items, total, onLook });
    return (
      <>
        {about}
        {items.length ? rest : null}
      </>
    );
  }
  if (!items.length) return <div className="pcb-empty">Nothing selected. Click a pad, a via, a track or a footprint on the board; click again at the same spot to reach what lies under it.</div>;
  if (items.length > 1) {
    const kinds = new Map<string, number>();
    for (const i of items) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
    return (
      <div className="pcb-sec">
        <h4>
          <span>{total} selected</span>
          <button className="pcb-btn ghost" onClick={onLook}>
            Look at
          </button>
        </h4>
        <dl className="pcb-kv">
          {[...kinds].map(([k, n]) => (
            <Kv key={k} label={k} value={String(n)} />
          ))}
        </dl>
        <div style={{ marginTop: 12 }}>
          {items.slice(0, 40).map((i) => (
            <div key={i.subtitle + i.title} className="pcb-row">
              <span className="name">{i.title}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const i = items[0];
  return (
    <div className="pcb-sec">
      <h4>
        <span>
          {i.kind} · <span className="strong">{i.title}</span>
        </span>
        <button className="pcb-btn ghost" onClick={onLook}>
          Look at
        </button>
      </h4>
      {i.subtitle && <div className="mono mute" style={{ fontSize: 10, marginBottom: 10 }}>{i.subtitle}</div>}
      <dl className="pcb-kv">
        {i.fields.map((f) => (
          <Kv key={f.label} label={f.label} value={f.value} unit={f.unit} />
        ))}
      </dl>
      {i.chips.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {i.chips.map((c) => (
            <span key={c.text} className={`pcb-chip ${c.tone ?? ""}`}>
              {c.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Kv({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value}
        {unit && <span className="u">{unit}</span>}
      </dd>
    </>
  );
}

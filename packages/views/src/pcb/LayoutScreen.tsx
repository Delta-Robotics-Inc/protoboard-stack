/**
 * The layout screen: the board canvas in the fixed shell of the chosen design (top bar with the System /
 * Schematic / Layout / 3D switcher, a floating tool rail, the agent bar, a right panel with Layers, Nets, Checks
 * and Inspect, the timeline and the status line). A read-only client of the board service: it reads snapshots
 * and commit events from `source` and never writes. Derived data (ratsnest, zone fills, findings, check counts)
 * is handed in: as `derived` (what a host's board feed sends, ./host), or field by field.
 *
 * Keys: 1 to 4 the depths (when the host navigates), V select, M measure, F fit, B view from the bottom,
 * PageUp / PageDown top or bottom copper active, + and - the next or previous copper layer, G inactive copper gray,
 * Alt+1 to 4 the layer presets, H light the selection's net, I inspect, Ctrl+= and Ctrl+- zoom, arrows pan,
 * Esc clears the measure, the lit nets and the selection, in that order.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { BoardEvent, CopperLayer, LogEntry, Presence, ZoneFillEntry } from "./board.js";
import { recordsOfKind, netClassOf } from "./board.js";
import { BoardCanvas, type Tool } from "./BoardCanvas.js";
import type { BoardView } from "./boardview.js";
import { classTargets, inspect, type Inspection } from "./inspect.js";
import { cu, defaultGroups, presetGroups, PRESETS, type PresetId } from "./layers.js";
import type { Hit } from "./pick.js";
import { zoneFillsFromEntries } from "./fills.js";
import type { BoardDerived, BoardSource, CheckSummary, DepthView, PcbFinding, RatsnestPair, ZoneFill } from "./types.js";
import { ChecksPanel, InspectPanel, Kv, LayersPanel, NetsPanel, type NetRow } from "./ui/panels.js";
import { AgentBar, agentState, Gutter, Rail, StatusLine, Timeline, TopBar } from "./ui/shell.js";
import { SCREEN_CSS } from "./ui/styles.js";
import { fitRect, panBy, zoomAbout, type Insets } from "./view.js";

export interface LayoutScreenProps {
  source: BoardSource;
  /** Breadcrumbs before "Layout" (project, board, branch). */
  crumbs?: string[];
  /**
   * Everything derived at once, as a host's board feed sends it (checks, findings, ratsnest, the zone fill in the
   * core's shared form). The fields below override its parts.
   */
  derived?: BoardDerived;
  ratsnest?: readonly RatsnestPair[];
  /** Zone fill in the renderer's form; `zoneFill` takes the core's shared form (`protoboard.zone-fill/v1` entries). */
  fills?: readonly ZoneFill[];
  zoneFill?: readonly ZoneFillEntry[];
  findings?: readonly PcbFinding[];
  /** What the status line says about checks; absent means no check has run. */
  checks?: CheckSummary;
  /** The switcher's navigation hook; absent: the other depths are shown disabled. */
  onNavigate?: (view: DepthView) => void;
  onCheck?: () => void;
  onExport?: () => void;
  onSelectionChange?: (ids: string[]) => void;
  /** Base grid, millimeters (default 0.25). */
  grid?: number;
  /** Called once with the canvas's board view (tests, captures). */
  onView?: (view: BoardView) => void;
}

type Tab = "layers" | "nets" | "checks" | "inspect";
const INSETS: Insets = { left: 60, right: 380, top: 104, bottom: 160 };
/** Fitting the whole board leaves room on its right for the selection callout (the concept's L1). */
const FIT_INSETS: Insets = { ...INSETS, left: 90, right: INSETS.right + 230 };
const NO_CHECK: CheckSummary = { ran: false };
const EMPTY: readonly never[] = [];

let cssInstalled = false;
function installCss() {
  if (cssInstalled || typeof document === "undefined") return;
  cssInstalled = true;
  const s = document.createElement("style");
  s.dataset.pcbScreen = "";
  s.textContent = SCREEN_CSS;
  document.head.append(s);
}

/** A small event bus so the cursor readout updates without re-rendering the screen. */
function useBus<T>() {
  return useMemo(() => {
    const ls = new Set<(v: T) => void>();
    return { emit: (v: T) => ls.forEach((l) => l(v)), on: (l: (v: T) => void) => (ls.add(l), () => void ls.delete(l)) };
  }, []);
}

export function LayoutScreen(props: LayoutScreenProps) {
  installCss();
  const { source, derived } = props;
  const findings = props.findings ?? derived?.findings ?? EMPTY;
  const checks = props.checks ?? derived?.checks ?? NO_CHECK;
  const ratsnest = props.ratsnest ?? derived?.ratsnest ?? EMPTY;
  const zoneEntries = props.zoneFill ?? derived?.fills;
  const fills = useMemo(() => props.fills ?? zoneFillsFromEntries(zoneEntries).fills, [props.fills, zoneEntries]);
  const notes = derived?.notes;
  const viewRef = useRef<BoardView | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // the screen takes the keyboard when it opens (its shortcuts); a click on the board takes it back later
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);
  const [snap, setSnap] = useState(() => source.snapshot());
  const [presence, setPresence] = useState<Presence | undefined>(() => source.presence?.());
  const [log, setLog] = useState<LogEntry[] | undefined>(() => source.log?.());
  const [saves, setSaves] = useState<number[]>([]);
  const copper = useMemo(() => {
    const layers = recordsOfKind(snap.doc, "layer").filter((l) => l.type === "copper").sort((a, b) => a.order - b.order).map((l) => l.name as CopperLayer);
    return layers.length ? layers : (["top", "bottom"] as CopperLayer[]);
  }, [snap.doc]);
  const [groups, setGroups] = useState(() => defaultGroups(copper));
  const [preset, setPreset] = useState<PresetId | undefined>(undefined);
  const [active, setActive] = useState<CopperLayer>("top");
  const [gray, setGray] = useState(true);
  const [tab, setTab] = useState<Tab>("layers");
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [lit, setLit] = useState<string[]>([]);
  const [dim, setDim] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [markers, setMarkers] = useState(true);
  const [activeFinding, setActiveFinding] = useState<string | undefined>(undefined);
  const [timelineSel, setTimelineSel] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const cursorBus = useBus<{ x: number; y: number } | undefined>();
  const scaleBus = useBus<number>();
  const grid = props.grid ?? 0.25;

  // the service: commits, presence, saves
  useEffect(() => {
    setSnap(source.snapshot());
    return source.subscribe((e: BoardEvent) => {
      if (e.type === "commit") {
        const s = source.snapshot();
        viewRef.current?.applyCommit(e, s);
        setSnap(s);
        setLog(source.log?.());
      } else if (e.type === "external-change") {
        // the host reloaded the whole board (changed on disk, or a service started or stopped)
        const s = source.snapshot();
        viewRef.current?.setSnapshot(s);
        setSnap(s);
        setLog(source.log?.());
        setPresence(source.presence?.());
      } else if (e.type === "presence") setPresence(e.presence);
      else if (e.type === "saved") setSaves((x) => [...x, e.seq]);
    });
  }, [source]);
  // lease countdowns in the agent bar
  useEffect(() => {
    if (!presence?.leases.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [presence]);

  const onReady = useCallback(
    (v: BoardView) => {
      viewRef.current = v;
      v.setSnapshot(source.snapshot());
      v.setRatsnest(ratsnest);
      v.setFills(fills);
      v.setGrid(grid);
      v.fit(FIT_INSETS);
      v.onChange(() => scaleBus.emit(v.view.s));
      props.onView?.(v);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source],
  );

  useEffect(() => viewRef.current?.setLayers({ groups, active, grayInactive: gray }), [groups, active, gray]);
  useEffect(() => viewRef.current?.setHighlight(lit, dim), [lit, dim]);
  useEffect(() => {
    viewRef.current?.setSelection(selection);
    props.onSelectionChange?.(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  useEffect(() => viewRef.current?.setRatsnest(ratsnest), [ratsnest]);
  useEffect(() => viewRef.current?.setFills(fills), [fills]);
  useEffect(() => viewRef.current?.setGrid(grid), [grid]);
  // a selection that left the board leaves the selection
  useEffect(() => setSelection((s) => s.filter((id) => id.startsWith("pad:") ? true : snap.doc.records.has(id))), [snap]);

  // ------------------------------------------------------------ derived
  const nets: NetRow[] = useMemo(() => {
    const names = new Set<string>(snap.doc.nets.keys());
    for (const r of snap.doc.records.values()) if ((r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net) names.add(r.net);
    return [...names].sort().map((name) => {
      const m = snap.query.net(name);
      return { name, cls: netClassOf(snap.doc, name), pads: m.pads.length, tracks: m.tracks.length, vias: m.vias.length };
    });
  }, [snap]);
  const classes = useMemo(() => {
    const names = new Set(recordsOfKind(snap.doc, "netclass").map((c) => c.name));
    const count = new Map<string, number>();
    for (const n of nets) {
      count.set(n.cls, (count.get(n.cls) ?? 0) + 1);
      names.add(n.cls);
    }
    return [...names].sort().map((name) => ({ name, ...classTargets(snap.doc, name), tier: classTargets(snap.doc, name).widthTier, nets: count.get(name) ?? 0 }));
  }, [snap, nets]);
  const copperOrigin = useMemo(() => {
    let hand = 0;
    let routed = 0;
    for (const t of recordsOfKind(snap.doc, "track")) {
      if ((t.provenance.by === "hand" || t.provenance.edited === "hand") && t.locked) hand++;
      else if (t.provenance.by === "routed" && t.provenance.edited !== "hand") routed++;
    }
    return { hand, routed };
  }, [snap]);
  const inspections = useMemo(() => selection.map((id) => inspect(snap.doc, id)).filter((x): x is Inspection => !!x), [selection, snap]);
  const errors = findings.filter((f) => f.severity === "error").length;
  // where a finding's rule came from in the source (the importer's `provenance.from`)
  const ruleFrom = useCallback(
    (id: string) => {
      const r = snap.doc.records.get(id);
      return r?.kind === "rule" ? r.provenance?.from : undefined;
    },
    [snap],
  );
  const board = snap.doc.records.get("board");
  const boardName = board?.kind === "board" ? board.name : "board";

  // ------------------------------------------------------------ actions
  const fitSelection = useCallback(
    (ids: readonly string[]) => {
      const v = viewRef.current;
      if (!v?.scene || !ids.length) return;
      let r: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const id of ids) {
        const o = v.scene.objects.get(id);
        if (!o) continue;
        r = [Math.min(r[0], o.rect[0]), Math.min(r[1], o.rect[1]), Math.max(r[2], o.rect[2]), Math.max(r[3], o.rect[3])];
      }
      if (!(r[0] <= r[2])) return;
      const cx = (r[0] + r[2]) / 2;
      const cy = (r[1] + r[3]) / 2;
      const half = Math.max(r[2] - r[0], r[3] - r[1], 3) / 2;
      v.setView(fitRect([cx - half * 1.6, cy - half * 1.6, cx + half * 1.6, cy + half * 1.6], v.width, v.height, INSETS, v.view.flip));
    },
    [],
  );

  const locate = useCallback(
    (f: PcbFinding) => {
      const v = viewRef.current;
      setActiveFinding(f.id);
      setTab("checks");
      const known = f.objects.filter((id) => v?.scene?.objects.has(id));
      setSelection(known);
      if (!v) return;
      const NMm = 1e-6;
      const b = f.box ? [f.box.minX * NMm, f.box.minY * NMm, f.box.maxX * NMm, f.box.maxY * NMm] : [f.location.x * NMm - 1.5, f.location.y * NMm - 1.5, f.location.x * NMm + 1.5, f.location.y * NMm + 1.5];
      const cx = (b[0] + b[2]) / 2;
      const cy = (b[1] + b[3]) / 2;
      const half = Math.max(b[2] - b[0], b[3] - b[1], 6) / 2;
      v.setView(fitRect([cx - half * 2.6, cy - half * 2.6, cx + half * 2.6, cy + half * 2.6], v.width, v.height, INSETS, v.view.flip));
    },
    [],
  );

  const onPick = (hits: Hit[], index: number, additive: boolean) => {
    setActiveFinding(undefined);
    const h = hits[index];
    if (!h) {
      if (!additive) setSelection([]);
      return;
    }
    setSelection((s) => (additive ? (s.includes(h.id) ? s.filter((x) => x !== h.id) : [...s, h.id]) : [h.id]));
  };

  const capture = () => {
    const v = viewRef.current;
    if (!v) return;
    v.renderNow();
    v.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${boardName.replace(/[^\w.-]+/g, "-")}-seq${snap.seq}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  const applyPreset = (p: PresetId) => {
    setPreset(p);
    setGroups(presetGroups(p, copper));
  };
  const stepLayer = (d: number) => {
    const i = copper.indexOf(active);
    setActive(copper[(i + d + copper.length) % copper.length]);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const v = viewRef.current;
    const k = e.key;
    if (e.altKey && /^[1-4]$/.test(k)) {
      applyPreset(PRESETS[Number(k) - 1].id);
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === "=" || k === "+" || k === "-")) {
      if (v) v.setView(zoomAbout(v.view, v.width, v.height, v.width / 2, v.height / 2, k === "-" ? 1 / 1.4 : 1.4));
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const depth = ({ "1": "system", "2": "schematic", "3": "layout", "4": "3d" } as Record<string, DepthView | undefined>)[k];
    if (depth) {
      if (depth !== "layout") props.onNavigate?.(depth);
      return;
    }
    switch (k) {
      case "v":
      case "V":
        setTool("select");
        break;
      case "m":
      case "M":
        setTool((t) => (t === "measure" ? "select" : "measure"));
        break;
      case "f":
      case "F":
      case "Home":
        v?.fit(FIT_INSETS);
        break;
      case "b":
      case "B":
        v?.flip();
        setFlipped((x) => !x);
        break;
      case "PageUp":
        setActive(copper[0]);
        break;
      case "PageDown":
        setActive(copper[copper.length - 1]);
        break;
      case "+":
      case "=":
        stepLayer(1);
        break;
      case "-":
        stepLayer(-1);
        break;
      case "g":
      case "G":
        setGray((x) => !x);
        break;
      case "h":
      case "H": {
        const net = selection.map((id) => viewRef.current?.scene?.objects.get(id)?.netName).find(Boolean);
        setLit(net && !lit.includes(net) ? [net] : []);
        break;
      }
      case "i":
      case "I":
        setTab("inspect");
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        if (v) {
          const step = Math.min(v.width, v.height) * 0.15;
          v.setView(panBy(v.view, k === "ArrowLeft" ? step : k === "ArrowRight" ? -step : 0, k === "ArrowUp" ? step : k === "ArrowDown" ? -step : 0));
        }
        break;
      case "Escape":
        if (tool === "measure") setTool("select");
        else if (lit.length) setLit([]);
        else if (activeFinding) setActiveFinding(undefined);
        else setSelection([]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const calloutFor = selection.length === 1 && !activeFinding ? selection[0] : undefined;
  const callout = () => {
    const i = calloutFor ? inspect(snap.doc, calloutFor) : undefined;
    if (!i) return null;
    const keep = new Set(["LCSC", "Value", "At", "Net", "Class", "Layer", "Width", "Size", "Diameter", "Drill", "Span", "Length", "Tier", "Layers"]);
    return (
      <>
        <dl className="pcb-kv">
          {i.fields
            .filter((f) => keep.has(f.label))
            .slice(0, 5)
            .map((f) => (
              <Kv key={f.label} label={f.label} value={f.value} unit={f.unit} />
            ))}
        </dl>
        {i.chips.length > 0 && (
          <div className="chips">
            {i.chips.map((c) => (
              <span key={c.text} className={`pcb-chip ${c.tone ?? ""}`}>
                {c.text}
              </span>
            ))}
          </div>
        )}
        <div className="acts">
          <button className="pcb-btn" onClick={() => fitSelection(selection)}>
            Look at
          </button>
          <button className="pcb-btn" onClick={() => setTab("inspect")}>
            Inspect <span className="mute">I</span>
          </button>
        </div>
      </>
    );
  };

  const traceSel = selection.length ? (inspect(snap.doc, selection[0])?.title ?? selection[0]) : undefined;

  return (
    <div ref={rootRef} className="pcb-screen" tabIndex={0} onKeyDown={onKey}>
      <TopBar
        crumbs={[...(props.crumbs ?? [boardName]), "Layout"]}
        {...(props.onNavigate ? { onNavigate: (d) => d !== "layout" && props.onNavigate?.(d) } : {})}
        seq={snap.seq}
        {...(saves.length ? { saved: saves.at(-1)! } : {})}
        reviewCount={findings.length}
        onReview={() => findings.length && locate([...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))[0])}
        {...(props.onCheck ? { onCheck: props.onCheck } : {})}
        {...(props.onExport ? { onExport: props.onExport } : {})}
      />
      <Gutter errors={errors} />
      <main className="pcb-main">
        <BoardCanvas
          onReady={onReady}
          tool={tool}
          findings={markers ? findings : EMPTY}
          {...(activeFinding ? { activeFinding } : {})}
          insets={INSETS}
          onPick={onPick}
          onBoxSelect={(ids, add) => {
            setActiveFinding(undefined);
            setSelection((s) => (add ? [...new Set([...s, ...ids])] : ids));
          }}
          onHover={(h) => viewRef.current?.setHover(h?.id)}
          onCursor={(p) => cursorBus.emit(p)}
          onNet={(n) => setLit(n ? [n] : [])}
          onFinding={(id) => {
            const f = findings.find((x) => x.id === id);
            if (f) locate(f);
          }}
          callout={callout}
          {...(calloutFor ? { calloutFor, calloutTitle: `${inspect(snap.doc, calloutFor)?.title ?? calloutFor}` } : {})}
        />
        <Rail
          tool={tool}
          onTool={setTool}
          flipped={flipped}
          onFlip={() => {
            viewRef.current?.flip();
            setFlipped((x) => !x);
          }}
          onFit={() => viewRef.current?.fit(FIT_INSETS)}
          onCapture={capture}
          markers={markers}
          onMarkers={() => setMarkers((m) => !m)}
          errors={errors}
        />
        <AgentBar state={agentState(presence, log, now)} />
        <div className="pcb-ctx" onPointerDown={(e) => e.stopPropagation()}>
          <span className="pcb-chip">
            <span className="sw" style={{ background: active === "top" ? "#a13e35" : active === "bottom" ? "#3c5f8f" : "#8a7a2e" }} />
            {active}
            {(() => {
              const t = classTargets(snap.doc, "default");
              return t.width !== undefined ? ` · track ${Number((t.width / 1e6).toFixed(3))}` : "";
            })()}
          </span>
          {lit.length > 0 && <span className="pcb-chip on">net {lit.join(", ")}</span>}
          {tool === "measure" && <span className="pcb-chip on">measure · drag on the board · Esc</span>}
        </div>
        <div className="pcb-live" style={{ right: INSETS.right }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="pcb-chip">
            <span className={`led${checks.ran ? " pass" : ""}`} />
            {checks.ran ? `checked${checks.seq !== undefined ? ` at seq ${checks.seq}` : ""}${checks.ms !== undefined ? ` · ${Math.round(checks.ms)} ms` : ""}` : "no check run"}
          </span>
        </div>
        <Timeline
          log={log}
          seq={snap.seq}
          epoch={snap.epoch}
          saves={saves}
          checks={checks}
          {...(timelineSel !== undefined ? { selected: timelineSel } : {})}
          onSelect={(e) => {
            setTimelineSel(e?.seq);
            if (e) {
              const ids = [...e.changed, ...Object.values(e.created)].filter((id) => snap.doc.records.has(id));
              setSelection(ids);
              fitSelection(ids);
            }
          }}
        />
        <aside className="pcb-float pcb-panel" onPointerDown={(e) => e.stopPropagation()}>
          <nav className="pcb-tabs">
            {(["layers", "nets", "checks", "inspect"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t}
                {t === "checks" && findings.length > 0 && <span className="n">{findings.length}</span>}
                {t === "inspect" && selection.length > 0 && <span className="n">{selection.length}</span>}
              </button>
            ))}
          </nav>
          <div className="pcb-body">
            {tab === "layers" && (
              <LayersPanel
                copper={copper}
                groups={groups}
                active={active}
                grayInactive={gray}
                {...(preset ? { preset } : {})}
                {...(board?.kind === "board" ? { thicknessNm: board.thickness } : {})}
                handTracks={copperOrigin.hand}
                routedTracks={copperOrigin.routed}
                classes={classes}
                {...(traceSel ? { selection: { title: traceSel, count: selection.length } } : {})}
                onToggle={(g) => {
                  setPreset(undefined);
                  setGroups((s) => {
                    const n = new Set(s);
                    if (n.has(g)) n.delete(g);
                    else n.add(g);
                    return n;
                  });
                }}
                onActive={(l) => {
                  setActive(l);
                  setGroups((s) => new Set([...s, cu(l)]));
                }}
                onPreset={applyPreset}
                onGray={setGray}
                onInspect={() => setTab("inspect")}
              />
            )}
            {tab === "nets" && <NetsPanel nets={nets} lit={lit} dim={dim} onDim={setDim} onLight={(n, add) => setLit((l) => (!n ? [] : add ? (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]) : l.length === 1 && l[0] === n ? [] : [n]))} />}
            {tab === "checks" && <ChecksPanel findings={props.findings ?? derived?.findings} checks={checks} {...(notes?.length ? { notes } : {})} {...(activeFinding ? { active: activeFinding } : {})} onLocate={locate} ruleFrom={ruleFrom} />}
            {tab === "inspect" && <InspectPanel items={inspections} total={selection.length} onLook={() => fitSelection(selection)} ruleFrom={ruleFrom} {...(activeFinding && findings.find((f) => f.id === activeFinding) ? { finding: findings.find((f) => f.id === activeFinding)! } : {})} />}
          </div>
        </aside>
      </main>
      <StatusWrapper checks={checks} cursorBus={cursorBus} scaleBus={scaleBus} grid={grid} flipped={flipped} active={active} />
    </div>
  );
}

function StatusWrapper(p: { checks: CheckSummary; cursorBus: { on: (l: (v: { x: number; y: number } | undefined) => void) => () => void }; scaleBus: { on: (l: (v: number) => void) => () => void }; grid: number; flipped: boolean; active: string }) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | undefined>(undefined);
  const [scale, setScale] = useState(1);
  useEffect(() => p.cursorBus.on(setCursor), [p.cursorBus]);
  useEffect(() => p.scaleBus.on(setScale), [p.scaleBus]);
  return <StatusLine checks={p.checks} {...(cursor ? { cursor } : {})} grid={p.grid} flipped={p.flipped} scale={scale} active={p.active} />;
}

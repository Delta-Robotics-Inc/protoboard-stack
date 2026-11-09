/**
 * The layout screen: the board canvas in the fixed shell of the chosen design (top bar with the System / Schematic
 * / Layout / 3D switcher, a floating tool rail, the agent bar, a right panel with Layers, Nets, Checks and Inspect,
 * the timeline and the status line).
 *
 * It reads snapshots and commit events from `source` (a host's board feed) and, when the host takes requests
 * (`request`), edits the board through it: one gesture is one transaction, drawn at once (EditSession: the
 * person's own change on top of the confirmed board) and reconciled with the service's reply; refusals are said
 * plainly. Derived data (ratsnest, zone fills, findings, check counts) is handed in, as `derived` (what a host's
 * board feed sends, ./host), or field by field. Modes (review, autoroute, diagnosis) change what sits in the
 * shell's regions; they never add one.
 *
 * Keys: 1 to 4 the depths (when the host navigates), V select, M measure, F fit, B view from the bottom,
 * PageUp / PageDown top or bottom copper active, + and - the next or previous copper layer, G inactive copper gray,
 * Alt+1 to 4 the layer presets, H light the selection's net, I inspect, Ctrl+= and Ctrl+- zoom, arrows pan.
 * Editing: drag to move, R rotate (Shift+R the other way), Shift+F flip, L lock or unlock, Del delete, Ctrl+Z undo,
 * Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+S save. Review: J and K the next and previous item. A accepts an open router
 * proposal (never a net change). Esc steps back: a drag, a run, a replay, the measure, the lit nets, the selection,
 * then the mode.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { BoardEvent, CopperLayer, LogEntry, Presence, ZoneFillEntry } from "./board.js";
import { recordsOfKind, netClassOf } from "./board.js";
import { BoardCanvas, type Tool } from "./BoardCanvas.js";
import type { BoardView } from "./boardview.js";
import { allLocked, anchorOf, deleteOps, flipOps, gestureLabel, lockOps, moveOps, numericOps, rotateOps, snapDelta, targets, type NumericField } from "./edit/gestures.js";
import { EditSession, hasOperation, outcomeOf, type Outcome, type RequestFn, type SessionStatus } from "./edit/session.js";
import { classTargets, inspect, type Inspection } from "./inspect.js";
import { cu, defaultGroups, presetGroups, PRESETS, type PresetId } from "./layers.js";
import { areasSvg, boxOfIds, copperSvg, FAIL, frameSvg, leaseBox, PASS, SELECT, type ScreenMap } from "./overlay.js";
import type { Hit } from "./pick.js";
import { zoneFillsFromEntries } from "./fills.js";
import { buildQueue, exportState, type QueueGroup, type QueueItem } from "./review.js";
import type { SideMessage } from "./remote.js";
import type { BoardDerived, BoardSource, CheckSummary, DepthView, DiagnosisView, PageOpCall, PcbFinding, ProposalView, RatsnestPair, RelaxOption, RouteProgressView, RouterInfo, ZoneFill } from "./types.js";
import { AgentBar, presenceState, type AgentBarState } from "./ui/agent.js";
import { CheckpointDialog, EditSection, TextPlacer, Toast } from "./ui/edit.js";
import { ChecksPanel, InspectPanel, Kv, LayersPanel, NetsPanel, type NetRow } from "./ui/panels.js";
import { ReviewPanel } from "./ui/review.js";
import { AutoroutePanel, DiagnosisPanel, ProposalCard, type ScopeKind } from "./ui/route.js";
import { Gutter, Rail, StatusLine, TopBar } from "./ui/shell.js";
import { SCREEN_CSS } from "./ui/styles.js";
import { Timeline, type LaneBlock } from "./ui/timeline.js";
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
  /** The host's request channel: present, the screen edits (the host decides who acts); absent, it is read only. */
  request?: RequestFn;
  /** Checkpoints and autoroute runs as the host's feed reports them (RemoteBoardSource.onSide). */
  onSide?: (listener: (m: SideMessage) => void) => () => void;
  /** The switcher's navigation hook; absent: the other depths are shown disabled. */
  onNavigate?: (view: DepthView) => void;
  onCheck?: () => void;
  onExport?: () => void;
  onSelectionChange?: (ids: string[]) => void;
  /** Base grid, millimeters (default 0.25). */
  grid?: number;
  /** Called once with the canvas's board view (tests, captures). */
  onView?: (view: BoardView) => void;
  /** Called once with the edit session (tests, captures). */
  onSession?: (session: EditSession) => void;
}

type Tab = "layers" | "nets" | "checks" | "inspect";
type Mode = "edit" | "review" | "route" | "diagnose";
const INSETS: Insets = { left: 60, right: 380, top: 104, bottom: 160 };
/** Fitting the whole board leaves room on its right for the selection callout (the concept's L1). */
const FIT_INSETS: Insets = { ...INSETS, left: 90, right: INSETS.right + 230 };
const NO_CHECK: CheckSummary = { ran: false };
const EMPTY: readonly never[] = [];
const NM = 1e-6;

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

const isNetChange = (ops: readonly PageOpCall[]) => ops.some((o) => o.op === "net.set" || o.op === "netlist.sync");
const MOVABLE = new Set(["footprint", "pad", "track", "via", "zone", "keepout", "text", "graphic"]);

interface DragState {
  ids: string[];
  anchor?: { x: number; y: number };
  label: string;
  /** The last delta asked for. */
  last?: { dx: number; dy: number };
  /** The last delta whose operations applied (a drag that would short stays at the last legal place). */
  legal?: { dx: number; dy: number };
  /** The delta asked for since the last frame: pointer moves are coalesced to one preview per display frame. */
  want?: { dx: number; dy: number };
  raf?: number;
}

export function LayoutScreen(props: LayoutScreenProps) {
  installCss();
  const { source } = props;
  const session = useMemo(() => new EditSession(source, props.request), [source, props.request]);
  useEffect(() => {
    props.onSession?.(session);
    return () => session.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const [status, setStatus] = useState<SessionStatus>(() => session.status());
  useEffect(() => {
    setStatus(session.status());
    return session.onStatus(setStatus);
  }, [session]);
  const replaying = status.replay !== undefined;
  const derived = replaying ? session.replayDerived() : props.derived;
  const findings = (replaying ? derived?.findings : props.findings ?? derived?.findings) ?? EMPTY;
  const checks = (replaying ? derived?.checks : props.checks ?? derived?.checks) ?? NO_CHECK;
  const ratsnest = (replaying ? derived?.ratsnest : props.ratsnest ?? derived?.ratsnest) ?? EMPTY;
  const zoneEntries = replaying ? derived?.fills : props.zoneFill ?? derived?.fills;
  const fills = useMemo(() => (!replaying && props.fills) || zoneFillsFromEntries(zoneEntries).fills, [props.fills, zoneEntries, replaying]);
  const notes = derived?.notes;
  const viewRef = useRef<BoardView | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // the screen takes the keyboard when it opens (its shortcuts); a click on the board takes it back later
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);
  const [snap, setSnap] = useState(() => session.snapshot());
  const [presence, setPresence] = useState<Presence | undefined>(() => session.presence());
  const [log, setLog] = useState<LogEntry[] | undefined>(() => session.log());
  const [saves, setSaves] = useState<number[]>([]);
  const [checkpoints, setCheckpoints] = useState<{ seq: number; label: string; committed?: string }[]>([]);
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
  const [mode, setMode] = useState<Mode>("edit");
  const [selection, setSelection] = useState<string[]>([]);
  const [lit, setLit] = useState<string[]>([]);
  const [dim, setDim] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [markers, setMarkers] = useState(true);
  const [activeFinding, setActiveFinding] = useState<string | undefined>(undefined);
  const [timelineSel, setTimelineSel] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<Outcome | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [checkpoint, setCheckpoint] = useState<{ stage: "label" | "preparing" | "ready" | "committing" | "done"; message?: string; result?: string; error?: string } | undefined>(undefined);
  // review (L2)
  const [rFilter, setRFilter] = useState<QueueGroup | "all">("all");
  const [rIndex, setRIndex] = useState(0);
  const [rStart, setRStart] = useState<Set<string> | undefined>(undefined);
  // autoroute (L5)
  const [routers, setRouters] = useState<RouterInfo[] | undefined>(undefined);
  const [scopeKind, setScopeKind] = useState<ScopeKind>("open");
  const [region, setRegion] = useState<[number, number, number, number] | undefined>(undefined);
  const [budgetMs, setBudgetMs] = useState(60_000);
  const [running, setRunning] = useState<{ run: string; progress: RouteProgressView[]; started: number } | undefined>(undefined);
  const [proposal, setProposal] = useState<ProposalView | undefined>(undefined);
  const [accepted, setAccepted] = useState<{ run: string; message: string; ok: boolean; changeSet: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // diagnosis (L4) and its relaxations, held in the page as a proposal until accepted
  const [diag, setDiag] = useState<{ net: string; loading: boolean; view?: DiagnosisView; error?: string } | undefined>(undefined);
  const [relax, setRelax] = useState<{ option: RelaxOption; net: string } | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [placing, setPlacing] = useState<{ x: number; y: number; sx: number; sy: number } | undefined>(undefined);
  const cursorBus = useBus<{ x: number; y: number } | undefined>();
  const scaleBus = useBus<number>();
  const grid = props.grid ?? 0.25;
  const writable = status.writable;

  // the board: commits (the person's own drawn at once), presence, saves; during a drag only the canvas redraws
  useEffect(() => {
    setSnap(session.snapshot());
    return session.subscribe((e: BoardEvent) => {
      if (e.type === "commit") {
        const s = session.snapshot();
        viewRef.current?.applyCommit(e, s);
        if (dragRef.current) return;
        setSnap(s);
        setLog(session.log());
      } else if (e.type === "external-change") {
        // the host reloaded the whole board (changed on disk, or a service started or stopped), or a replay began or ended
        const s = session.snapshot();
        viewRef.current?.setSnapshot(s);
        setSnap(s);
        setLog(session.log());
        setPresence(session.presence());
      } else if (e.type === "presence") setPresence(e.presence);
      else if (e.type === "saved") setSaves((x) => [...x, e.seq]);
    });
  }, [session]);
  // checkpoints and router runs from the host's feed
  useEffect(
    () =>
      props.onSide?.((m) => {
        if (m.type === "checkpoint") setCheckpoints((c) => [...c.filter((x) => !(x.seq === m.seq && !x.committed && m.committed)), { seq: m.seq, label: m.label, ...(m.committed ? { committed: m.committed } : {}) }]);
        else if (m.type === "route") {
          if (m.progress) setRunning((r) => (r && r.run === m.run ? { ...r, progress: [...r.progress, m.progress!].slice(-40) } : r));
          if (m.proposal) {
            setRunning((r) => (r?.run === m.run ? undefined : r));
            setProposal(m.proposal);
          }
          if (m.error) {
            setRunning(undefined);
            setToast({ ok: false, status: "error", message: m.error, label: "autoroute", at: Date.now() });
          }
          if (m.ended === "cancelled") setRunning((r) => (r?.run === m.run ? undefined : r));
        }
      }),
    [props.onSide],
  );
  // lease countdowns in the agent bar, and a run's clock
  useEffect(() => {
    if (!presence?.leases.length && !running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [presence, running]);
  // a refused write stays until the next one; a done one goes after a moment
  useEffect(() => {
    if (status.last && !status.last.ok) setToast(status.last);
  }, [status.last]);

  const onReady = useCallback(
    (v: BoardView) => {
      viewRef.current = v;
      v.setSnapshot(session.snapshot());
      v.setRatsnest(ratsnest);
      v.setFills(fills);
      v.setGrid(grid);
      v.fit(FIT_INSETS);
      v.onChange(() => scaleBus.emit(v.view.s));
      props.onView?.(v);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
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
  useEffect(() => setSelection((s) => s.filter((id) => (id.startsWith("pad:") ? true : snap.doc.records.has(id)))), [snap]);

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
  const queue = useMemo(() => buildQueue(snap.doc, findings), [snap, findings]);
  const exportOk = exportState(queue, derived?.waived, checks.ran);
  const openNets = useMemo(() => [...new Set(ratsnest.map((r) => r.net))].sort(), [ratsnest]);
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
  const hasZones = useMemo(() => recordsOfKind(snap.doc, "zone").length > 0, [snap]);
  const derivedBehind = !replaying && !!props.derived && (props.derived.seq !== session.confirmed().seq || props.derived.epoch !== session.confirmed().epoch);

  // ------------------------------------------------------------ view helpers
  const fitBox = useCallback((r: [number, number, number, number], grow = 1.6, min = 3) => {
    const v = viewRef.current;
    if (!v) return;
    const cx = (r[0] + r[2]) / 2;
    const cy = (r[1] + r[3]) / 2;
    const half = Math.max(r[2] - r[0], r[3] - r[1], min) / 2;
    v.setView(fitRect([cx - half * grow, cy - half * grow, cx + half * grow, cy + half * grow], v.width, v.height, INSETS, v.view.flip));
  }, []);
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
      if (r[0] <= r[2]) fitBox(r);
    },
    [fitBox],
  );
  const locate = useCallback(
    (f: PcbFinding, switchTab = true) => {
      const v = viewRef.current;
      setActiveFinding(f.id);
      if (switchTab) setTab("checks");
      setSelection(f.objects.filter((id) => v?.scene?.objects.has(id)));
      const b = f.box ? [f.box.minX * NM, f.box.minY * NM, f.box.maxX * NM, f.box.maxY * NM] : [f.location.x * NM - 1.5, f.location.y * NM - 1.5, f.location.x * NM + 1.5, f.location.y * NM + 1.5];
      fitBox(b as [number, number, number, number], 2.6, 6);
    },
    [fitBox],
  );

  // ------------------------------------------------------------ writes
  const say = (o: Outcome) => {
    if (!o.ok) setToast(o);
    return o;
  };
  const commitOps = async (label: string, ops: PageOpCall[], expectFor?: string[]) => {
    if (!ops.length) return;
    setToast(undefined);
    return say(await session.commit(label, ops, expectFor ? { expectFor } : {}));
  };
  const selRecords = useMemo(() => targets(snap.doc, selection), [snap, selection]);
  const rotate = (deg: number) => {
    const r = rotateOps(snap.doc, selection, Math.round(deg * 1000));
    void commitOps(gestureLabel(`rotate ${deg > 0 ? "" : "back "}`.trim(), snap.doc, selection), r.ops, r.ops.length ? (r.ops[0].ids as string[]) : undefined);
  };
  const flip = () => {
    const r = flipOps(snap.doc, selection);
    void commitOps(gestureLabel("flip", snap.doc, selection), r.ops, r.ops.length ? (r.ops[0].ids as string[]) : undefined);
  };
  const del = () => {
    const r = deleteOps(snap.doc, selection);
    if (r.skipped.length && !r.ops.length) setToast({ ok: false, status: "error", message: `${r.skipped.length} selected object(s) have no delete in this core yet (footprint.remove, text and graphic deletes come with the kernel)`, label: "delete", at: Date.now() });
    void commitOps(gestureLabel("delete", snap.doc, selection), r.ops).then(() => setSelection([]));
  };
  const lock = (on: boolean) => void commitOps(gestureLabel(on ? "lock" : "unlock", snap.doc, selection), lockOps(snap.doc, selection, on));
  const editField = (field: NumericField, value: number) => {
    const r = selRecords[0];
    if (!r) return;
    void commitOps(`set ${field} of ${r.kind === "footprint" ? r.ref : r.kind} by hand`, numericOps(r, field, value), [r.id]);
  };
  const save = async () => {
    const r = await session.request({ method: "save" }, "save");
    if (r.ok) {
      const x = r.result as { seq: number; written: string[]; refused: string[] };
      setToast({ ok: !x.refused.length, status: x.refused.length ? "refused" : "applied", message: x.refused.length ? `files changed on disk by someone else were not overwritten: ${x.refused.join(", ")}` : x.written.length ? `saved ${x.written.join(", ")} at seq ${x.seq}` : `nothing changed since the last save (seq ${x.seq})`, label: "save", at: Date.now() });
      setSaves((s) => [...s, x.seq]);
    }
  };
  const ripNet = selRecords.length === 1 && (selRecords[0].kind === "track" || selRecords[0].kind === "via") && selRecords[0].net && hasOperation("copper.rip") ? selRecords[0].net : undefined;
  const rip = () => {
    if (ripNet) void commitOps(`rip up ${ripNet} by hand`, [{ op: "copper.rip", nets: [ripNet] }]).then(() => setSelection([]));
  };
  const placeText = (text: string | undefined) => {
    const at = placing;
    setPlacing(undefined);
    if (!text || !at) return;
    void commitOps("add board text by hand", [{ op: "text.add", text: { layer: "top_silkscreen", text, x: Math.round(at.x * 1e6), y: Math.round(at.y * 1e6), height: 1_000_000, stroke_width: 150_000 } }]);
  };
  const importDxf = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dxf";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      void f.text().then(async (dxf) => {
        const o = await commitOps("set the outline from DXF", [{ op: "outline.import_dxf", dxf }]);
        const rep = (o?.reply as { reports?: { report: { entities?: number; loops?: number; cutouts?: number; skipped?: { type: string; count: number }[] } }[] } | undefined)?.reports?.[0]?.report;
        if (o?.ok && rep) setToast({ ok: true, status: "applied", label: "outline from DXF", message: `${rep.entities ?? "?"} entities, ${rep.loops ?? "?"} loops, ${rep.cutouts ?? 0} cutouts${rep.skipped?.length ? `; skipped ${rep.skipped.map((x) => `${x.count} ${x.type}`).join(", ")}` : ""}`, at: Date.now() });
      });
    };
    input.click();
  };
  const undo = () => void session.undo().then(say);
  const redo = () => void session.redo().then(say);

  // ------------------------------------------------------------ drag (one gesture, one transaction)
  const canDrag = useCallback((h: Hit) => writable && mode === "edit" && MOVABLE.has(h.kind), [writable, mode]);
  const onDragStart = (h: Hit, additive: boolean) => {
    const id = h.kind === "pad" && h.footprint ? h.footprint : h.id;
    const ids = selection.includes(h.id) || selection.includes(id) ? selection : additive ? [...selection, id] : [id];
    const rs = targets(session.confirmed().doc, ids);
    if (!rs.length) return false;
    if (!(selection.includes(h.id) || selection.includes(id))) setSelection(ids);
    setActiveFinding(undefined);
    dragRef.current = { ids, anchor: anchorOf(session.confirmed().doc, ids), label: gestureLabel("move", session.confirmed().doc, ids) };
    setDragging(true);
    return true;
  };
  const onDragMove = (dxMm: number, dyMm: number) => {
    const d = dragRef.current;
    if (!d) return;
    d.want = snapDelta(d.anchor, dxMm * 1e6, dyMm * 1e6, grid);
    if (d.raf) return;
    // one preview per display frame, with the latest delta, drawn in that same frame: moves never queue up
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      const s = d.want;
      if (dragRef.current !== d || !s || (d.last && d.last.dx === s.dx && d.last.dy === s.dy)) return;
      d.last = s;
      if (session.preview(moveOps(session.confirmed().doc, d.ids, s.dx, s.dy).ops)) d.legal = s;
      else if (d.legal) session.preview(moveOps(session.confirmed().doc, d.ids, d.legal.dx, d.legal.dy).ops);
      viewRef.current?.flush();
    });
  };
  const onDragEnd = (cancel: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    // the release's own position counts (a quick drag can end before its last frame)
    if (!cancel && d.want && (!d.last || d.last.dx !== d.want.dx || d.last.dy !== d.want.dy) && session.preview(moveOps(session.confirmed().doc, d.ids, d.want.dx, d.want.dy).ops)) d.legal = d.want;
    if (cancel || !d.legal || (d.legal.dx === 0 && d.legal.dy === 0)) {
      session.preview(undefined);
      setSnap(session.snapshot());
      return;
    }
    const m = moveOps(session.confirmed().doc, d.ids, d.legal.dx, d.legal.dy);
    void commitOps(d.label, m.ops, targets(session.confirmed().doc, d.ids).map((r) => r.id));
    setSnap(session.snapshot());
    setLog(session.log());
  };

  // ------------------------------------------------------------ review (L2)
  const enterReview = () => {
    setMode("review");
    setTab("checks");
    setRStart(new Set(queue.map((q) => q.id)));
    setRIndex(0);
    if (queue[0]) followItem(queue[0]);
  };
  const followItem = (it: QueueItem) => {
    if (it.findings.length === 1) locate(it.findings[0], false);
    else {
      setActiveFinding(it.findings[0]?.id);
      setSelection(it.objects.filter((id) => viewRef.current?.scene?.objects.has(id)));
      fitBox([it.box.minX * NM, it.box.minY * NM, it.box.maxX * NM, it.box.maxY * NM], 1.8, 6);
    }
  };
  const pickItem = (i: number) => {
    const n = queue.length;
    if (!n) return;
    const j = ((i % n) + n) % n;
    setRIndex(j);
    followItem(queue[j]);
  };
  // the queue shrinks as items are fixed: keep the index in range and follow the item now in hand
  useEffect(() => {
    if (mode !== "review") return;
    if (rIndex >= queue.length && queue.length) {
      setRIndex(queue.length - 1);
      followItem(queue[queue.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length, mode]);
  const reviewDone = rStart ? [...rStart].filter((id) => !queue.some((q) => q.id === id)).length : 0;
  const reviewTotal = rStart ? rStart.size : queue.length;
  const waive = async (it: QueueItem, reason: string) => {
    for (const f of it.findings) {
      const r = await session.request({ method: "waive", finding: f.id, reason }, "not a problem");
      if (r.ok) say(outcomeOf("not a problem", r));
    }
  };
  const unwaive = async (finding: string) => {
    const r = await session.request({ method: "unwaive", finding }, "take back");
    if (r.ok) say(outcomeOf("take back", r));
  };

  // ------------------------------------------------------------ autoroute (L5)
  const openRoute = (scope?: { nets: string[] }) => {
    setMode("route");
    setTab("inspect");
    setDiag(undefined);
    if (scope) {
      setScopeKind("nets");
      setLit(scope.nets);
    }
    if (!routers) void session.request({ method: "routers" }, "routers").then((r) => r.ok && setRouters(r.result as RouterInfo[]));
  };
  const scopeNets = useMemo(() => {
    if (scopeKind === "nets") {
      const fromSel = selection.map((id) => viewRef.current?.scene?.objects.get(id)?.netName).filter((n): n is string => !!n);
      return [...new Set([...fromSel, ...lit])].filter((n) => openNets.includes(n));
    }
    return openNets;
  }, [scopeKind, selection, lit, openNets]);
  const scopeNote = scopeKind === "open" ? `${openNets.length} open net${openNets.length === 1 ? "" : "s"}` : scopeKind === "nets" ? (scopeNets.length ? scopeNets.join(", ") : "select or light a net that is open") : region ? `a region ${(region[2] - region[0]).toFixed(1)} x ${(region[3] - region[1]).toFixed(1)} mm` : "draw a region on the board";
  const runRoute = async () => {
    setProposal(undefined);
    setAccepted(undefined);
    const scope = scopeKind === "open" ? { kind: "open" as const } : scopeKind === "nets" ? { kind: "nets" as const, nets: scopeNets } : { kind: "region" as const, region: region ? [{ x: region[0] * 1e6, y: region[1] * 1e6 }, { x: region[2] * 1e6, y: region[1] * 1e6 }, { x: region[2] * 1e6, y: region[3] * 1e6 }, { x: region[0] * 1e6, y: region[3] * 1e6 }] : [] };
    const r = await session.request({ method: "route", scope, budgetMs, preset: "balanced" }, "autoroute");
    if (r.ok) setRunning({ run: (r.result as { run: string }).run, progress: [], started: Date.now() });
  };
  const cancelRoute = () => {
    if (running) void session.request({ method: "routeCancel", run: running.run }, "cancel");
    setRunning(undefined);
  };
  const acceptRoute = async () => {
    if (!proposal || proposal.status !== "proposed" || busy) return;
    setBusy(true);
    const r = await session.request({ method: "routeAccept", run: proposal.run }, "accept the proposal");
    setBusy(false);
    if (!r.ok) return;
    const x = r.result as { replies: { status: string; reason?: string; message?: string; seq?: number }[]; locked: { checked: number; changed: string[] } };
    const ok = x.replies.length > 0 && x.replies.every((y) => y.status === "applied") && !x.locked.changed.length;
    const refused = x.replies.find((y) => y.status !== "applied");
    const message = ok
      ? `applied in ${x.replies.length} step${x.replies.length === 1 ? "" : "s"} (seq ${x.replies.at(-1)?.seq}); ${x.locked.checked} locked record${x.locked.checked === 1 ? "" : "s"} verified unchanged`
      : refused
        ? `not applied: ${refused.reason ?? refused.status}${refused.message ? ` (${refused.message})` : ""}`
        : `locked records changed: ${x.locked.changed.join(", ")}`;
    setAccepted({ run: proposal.run, message, ok, changeSet: proposal.changeSet });
    if (!ok) setToast({ ok: false, status: "refused", message, label: "accept the proposal", at: Date.now() });
    setProposal(undefined);
  };
  const rejectRoute = () => {
    if (proposal) void session.request({ method: "routeReject", run: proposal.run }, "reject");
    setProposal(undefined);
  };
  const revertRun = async (changeSet: string) => {
    const r = await session.request({ method: "revertChangeSet", id: changeSet }, "revert the run");
    if (r.ok) {
      const o = say(outcomeOf("revert the run", r));
      if (o.ok) setAccepted(undefined);
    }
  };

  // ------------------------------------------------------------ diagnosis (L4)
  const diagnose = async (net: string) => {
    setMode("diagnose");
    setTab("inspect");
    setProposal(undefined);
    setRelax(undefined);
    setLit([net]);
    setDiag({ net, loading: true });
    const r = await session.request({ method: "diagnose", net, budgetMs: 20_000 }, "diagnose");
    setDiag((d) => (d?.net !== net ? d : r.ok ? { net, loading: false, view: r.result as DiagnosisView } : { net, loading: false, error: r.error }));
  };
  const acceptRelax = async () => {
    if (!relax) return;
    const o = await commitOps(`relax rules for ${relax.net} by hand`.split(" ").slice(0, 8).join(" "), relax.option.rules.map((rule) => ({ op: "rule.set", rule })));
    if (o?.ok) {
      setRelax(undefined);
      setDiag(undefined);
      openRoute({ nets: [relax.net] });
    }
  };

  // ------------------------------------------------------------ checkpoint
  const prepareCheckpoint = async (label: string) => {
    setCheckpoint({ stage: "preparing" });
    const r = await session.request({ method: "checkpoint", label }, "checkpoint");
    if (!r.ok) return setCheckpoint({ stage: "label", error: r.error });
    const x = r.result as { message: string; refused: string[]; seq: number; written: string[] };
    setSaves((s) => [...s, x.seq]);
    if (x.refused.length) return setCheckpoint({ stage: "label", message: x.message, error: `files changed on disk by someone else were not overwritten: ${x.refused.join(", ")}` });
    setCheckpoint({ stage: "ready", message: x.message });
  };
  const commitCheckpoint = async () => {
    const msg = checkpoint?.message;
    if (!msg) return;
    setCheckpoint({ stage: "committing", message: msg });
    const r = await session.request({ method: "commit", message: msg }, "git commit");
    if (!r.ok) return setCheckpoint({ stage: "ready", message: msg, error: r.error });
    const x = r.result as { commit: string; files: string[] };
    setCheckpoint({ stage: "done", message: msg, result: `committed ${x.commit}: ${x.files.length} file${x.files.length === 1 ? "" : "s"} of the board folder; nothing was pushed` });
  };

  // ------------------------------------------------------------ replay
  const scrub = (seq: number | undefined) => {
    setPlaying(false);
    if (seq === undefined) session.live();
    else void session.showAt(seq);
  };
  useEffect(() => {
    if (!playing) return;
    const base = session.confirmed().seq;
    let s = Math.max(0, base - 24);
    void session.showAt(s);
    const t = setInterval(() => {
      s++;
      if (s >= base) {
        setPlaying(false);
        session.live();
        return;
      }
      void session.showAt(s);
    }, 600);
    return () => clearInterval(t);
  }, [playing, session]);

  // ------------------------------------------------------------ picking
  const onPick = (hits: Hit[], index: number, additive: boolean) => {
    if (mode === "edit") setActiveFinding(undefined);
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
  const leaveMode = () => {
    setMode("edit");
    setDiag(undefined);
    setRelax(undefined);
    setRStart(undefined);
    if (tool === "region") setTool("select");
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
    if (e.ctrlKey || e.metaKey) {
      if (k === "=" || k === "+" || k === "-") {
        if (v) v.setView(zoomAbout(v.view, v.width, v.height, v.width / 2, v.height / 2, k === "-" ? 1 / 1.4 : 1.4));
      } else if ((k === "z" || k === "Z") && !e.shiftKey) undo();
      else if (k === "y" || k === "Y" || ((k === "z" || k === "Z") && e.shiftKey)) redo();
      else if (k === "s" || k === "S") void save();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const depth = ({ "1": "system", "2": "schematic", "3": "layout", "4": "3d" } as Record<string, DepthView | undefined>)[k];
    if (depth) {
      if (depth !== "layout") props.onNavigate?.(depth);
      return;
    }
    const editing = writable && mode === "edit" && selection.length > 0;
    switch (k) {
      case "v":
      case "V":
        setTool("select");
        break;
      case "m":
      case "M":
        setTool((t) => (t === "measure" ? "select" : "measure"));
        break;
      case "t":
      case "T":
        if (!writable || !hasOperation("text.add")) return;
        setTool((t) => (t === "text" ? "select" : "text"));
        break;
      case "f":
      case "Home":
        v?.fit(FIT_INSETS);
        break;
      case "F":
        if (e.shiftKey && editing) flip();
        else v?.fit(FIT_INSETS);
        break;
      case "r":
      case "R":
        if (!editing) return;
        rotate(e.shiftKey ? -90 : 90);
        break;
      case "l":
      case "L":
        if (!editing) return;
        lock(!allLocked(snap.doc, selection));
        break;
      case "Delete":
      case "Backspace":
        if (!editing) return;
        del();
        break;
      case "a":
      case "A":
        // a router's proposal adds copper; a net change never gets a one-key accept
        if (proposal?.status === "proposed") void acceptRoute();
        else return;
        break;
      case "j":
      case "J":
        if (mode !== "review") return;
        pickItem(rIndex + 1);
        break;
      case "k":
      case "K":
        if (mode !== "review") return;
        pickItem(rIndex - 1);
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
        if (placing) setPlacing(undefined);
        else if (checkpoint) setCheckpoint(undefined);
        else if (running) cancelRoute();
        else if (replaying || playing) scrub(undefined);
        else if (relax) setRelax(undefined);
        else if (tool !== "select") setTool("select");
        else if (lit.length) setLit([]);
        else if (activeFinding && mode === "edit") setActiveFinding(undefined);
        else if (selection.length && mode === "edit") setSelection([]);
        else if (mode !== "edit") leaveMode();
        else setSelection([]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ------------------------------------------------------------ the one open callout
  const showProposalCard = !!proposal || !!relax;
  const calloutFor = selection.length === 1 && !activeFinding && !showProposalCard && !dragging && mode === "edit" ? selection[0] : undefined;
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

  // ------------------------------------------------------------ overlay: ghosts, areas, leases, lock tags
  const overlay = (v: BoardView) => {
    const m: ScreenMap = { toScreen: (x, y) => v.toScreen(x, y), scale: v.view.s };
    const out: string[] = [];
    if (mode === "diagnose" && diag?.view) {
      out.push(areasSvg(diag.view.areas, m));
      for (const a of diag.view.attempts) out.push(copperSvg(a.ghost, m, FAIL, { opacity: 0.7 }));
      if (diag.view.probe) out.push(copperSvg(diag.view.probe.ghost, m, PASS, { dash: "6 3" }));
    }
    if (proposal) {
      out.push(copperSvg(proposal.ghost, m, SELECT));
      const ids: string[] = [];
      for (const t of recordsOfKind(snap.doc, "track")) if (t.locked && (t.provenance.by === "hand" || t.provenance.edited === "hand")) ids.push(t.id);
      const hb = boxOfIds(snap.doc, ids);
      if (hb) {
        const p = v.toScreen(hb[0], hb[3]);
        out.push(`<g transform="translate(${p.x.toFixed(1)},${(p.y - 10).toFixed(1)})"><rect x="0" y="-12" width="150" height="16" rx="3" fill="#161616" stroke="#4a4a4a"/><text x="8" y="0" fill="#e6e6e6" font-family="Kode Mono, ui-monospace, monospace" font-size="9.5" letter-spacing="0.8">HAND · LOCKED · ${proposal.lockCheck.ok ? "UNCHANGED" : "CHANGED"}</text></g>`);
      }
    }
    if (mode === "route" && scopeKind === "region" && region) out.push(frameSvg(region, m, "autoroute region"));
    for (const l of presence?.leases ?? []) {
      if (l.holder.kind === "human") continue;
      const b = leaseBox(snap.doc, l);
      if (!b) continue;
      const left = Math.max(0, Math.round((l.expiresAt - now) / 1000));
      out.push(frameSvg([b[0] - 0.6, b[1] - 0.6, b[2] + 0.6, b[3] + 0.6], m, `${l.holder.kind} · ${l.roots.length ? l.roots.map((r) => (r ? `${r}/` : "board")).join(" ") : l.nets.length ? l.nets.slice(0, 2).join(" ") : "region"} · lease ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`));
    }
    // a locked selection carries its lock tag
    if (calloutFor && mode === "edit") {
      const r = snap.doc.records.get(calloutFor);
      if (r && (r as { locked?: true }).locked && (r.kind === "track" || r.kind === "via")) {
        const b = boxOfIds(snap.doc, [r.id]);
        if (b) {
          const p = v.toScreen(b[0], b[1]);
          out.push(`<g transform="translate(${p.x.toFixed(1)},${(p.y + 18).toFixed(1)})"><rect x="0" y="-12" width="${r.provenance?.by === "hand" || r.provenance?.edited === "hand" ? 104 : 64}" height="16" rx="3" fill="#161616" stroke="#4a4a4a"/><text x="8" y="0" fill="#e6e6e6" font-family="Kode Mono, ui-monospace, monospace" font-size="9.5" letter-spacing="0.8">${r.provenance?.by === "hand" || r.provenance?.edited === "hand" ? "HAND · LOCKED" : "LOCKED"}</text></g>`);
        }
      }
    }
    return out.join("");
  };
  const nodes = (v: BoardView) => {
    if (!showProposalCard) return null;
    const left = Math.max(INSETS.left + 16, v.width - INSETS.right - 16 - 220);
    if (relax)
      return (
        <div style={{ position: "absolute", left, top: INSETS.top + 120 }}>
          <div className="pcb-proposal" onPointerDown={(e) => e.stopPropagation()}>
            <div className="row1">
              <b className="caps">relaxation · {relax.net}</b>
              <span className="pcb-chip on">proposed</span>
            </div>
            <p className="pcb-p">{relax.option.title}: {relax.option.detail}.</p>
            <div className={`mono small ${relax.option.result.routed ? "pass" : "fail"}`}>test-run: {relax.option.result.routed ? `routes, ${relax.option.result.vias} vias, ${relax.option.result.newFindings} new findings` : "still open"}</div>
            <div className="acts">
              <button className="pcb-btn main" disabled={isNetChange(relax.option.rules.map((rule) => ({ op: "rule.set", rule })))} onClick={() => void acceptRelax()} title="Write the rule as your change (undoable), then route the net">
                Accept
              </button>
              <button className="pcb-btn" onClick={() => setRelax(undefined)}>
                Reject
              </button>
            </div>
          </div>
        </div>
      );
    return (
      <div style={{ position: "absolute", left, top: INSETS.top + 120 }}>
        <ProposalCard proposal={proposal!} busy={busy} onAccept={() => void acceptRoute()} onReject={rejectRoute} />
      </div>
    );
  };

  // ------------------------------------------------------------ the agent bar and the timeline's fourth lane
  const queueItem = mode === "review" ? queue[rIndex] : undefined;
  const bar: AgentBarState = (() => {
    if (running) {
      const last = running.progress.at(-1);
      const stages = new Set(running.progress.map((p) => p.stage));
      return {
        who: "Router",
        title: `Autorouting · step ${(last?.stage ?? 0) + 1} · ${last?.router ?? "starting"}${last?.fallback ? " fallback" : ""}`,
        sub: `${last?.phase ?? "starting"}${last?.message ? ` · ${last.message}` : ""} · ${Math.round((Date.now() - running.started) / 1000)} s · ${stages.size} stage${stages.size === 1 ? "" : "s"} so far`,
        working: true,
        ...(last?.fraction !== undefined ? { progress: last.fraction } : {}),
        buttons: [{ label: "Cancel", icon: "close", key: "Esc", onClick: cancelRoute }],
      };
    }
    if (proposal) {
      const better = proposal.status === "proposed";
      return { who: "Router", title: better ? `Autoroute finished: the proposal beats the board you have` : `Autoroute finished: nothing to offer (${proposal.status})`, sub: `${proposal.stages.map((s) => `${s.router} ${(s.durationMs / 1000).toFixed(0)} s`).join(", then ")} · Balanced · nothing applied yet`, buttons: [{ label: "Run again", icon: "reroute", onClick: () => void runRoute() }] };
    }
    if (mode === "diagnose" && diag) return { who: "Agent", title: diag.view ? `${diag.net}: ${diag.view.verdict === "rules" ? "a rule blocks it, not the parts" : diag.view.verdict === "placement" ? "the parts or a no-go area block it" : "it routes as the rules are"}` : `Probing ${diag.net}…`, sub: diag.view ? `constraint probe · fab floor and no-go only · ${diag.view.options.length} relaxation${diag.view.options.length === 1 ? "" : "s"} test-run in ${(diag.view.ms / 1000).toFixed(1)} s` : "attempt, probe and relaxations on copies; nothing changes", working: diag.loading };
    if (queueItem) return { who: "Agent", title: `Item ${rIndex + 1} of ${queue.length} · ${queueItem.title}`, sub: "the canvas follows the queue · nothing applied yet", buttons: [{ label: "Skip", key: "J", onClick: () => pickItem(rIndex + 1) }] };
    return presenceState(presence, log, now, writable ? { onTakeOver: () => void session.request({ method: "takeOver" }, "take over") } : {});
  })();
  const lane: { name: string; blocks: LaneBlock[]; align?: "start" | "end" } | undefined = (() => {
    if (mode === "review") return { name: "Queue", blocks: queue.slice(0, 12).map((q, i) => ({ key: q.id, label: `${i + 1} ${q.title}`, seq: snap.seq, tone: i === rIndex ? "queue-on" : "queue", onClick: () => pickItem(i) })) };
    if (mode === "route" && (running || proposal)) {
      const stages = proposal ? proposal.stages.map((s, i) => ({ key: `st${i}`, label: `${s.router} ${(s.durationMs / 1000).toFixed(0)} s${s.kept ? " ✓" : ""}`, seq: snap.seq, tone: (s.kept ? "router" : "router-fail") as LaneBlock["tone"] })) : [...new Map(running!.progress.map((p) => [p.stage, p])).values()].map((p) => ({ key: `st${p.stage}`, label: `${p.router} · ${p.phase}`, seq: snap.seq, tone: "router" as const }));
      if (proposal?.fallback) stages.splice(1, 0, { key: "fb", label: "⚑ fallback", seq: snap.seq, tone: "fallback" });
      return { name: "Router", blocks: stages, align: "end" };
    }
    if (mode === "diagnose" && diag?.view) return { name: "Router", align: "end", blocks: [...diag.view.attempts.map((a, i) => ({ key: `a${i}`, label: `${a.router} ✗`, seq: snap.seq, tone: "fail" as const })), ...(diag.view.probe ? [{ key: "p", label: `probe ${diag.view.probe.routed ? "✓" : "✗"}`, seq: snap.seq, tone: (diag.view.probe.routed ? "probe" : "fail") as LaneBlock["tone"] }] : []), ...diag.view.options.map((o, i) => ({ key: `o${i}`, label: `relax ${i + 1} ${o.result.routed ? "✓" : "✗"}`, seq: snap.seq, tone: (o.result.routed ? "probe" : "fail") as LaneBlock["tone"] }))] };
    if (writable) return { name: "Draft", align: "end", blocks: status.pending ? [{ key: "pending", label: `${status.pending} sending · ${status.last?.label ?? ""}`, seq: snap.seq + 1, tone: "draft" }] : [] };
    return undefined;
  })();
  const lastEntry = (log ?? []).at(-1);
  const title = mode === "review" ? `Review · ${reviewDone} of ${reviewTotal} done` : mode === "route" ? (proposal ? "Autoroute · result" : running ? "Autoroute · running" : "Autoroute") : mode === "diagnose" ? `Diagnosis · ${diag?.net ?? ""}` : lastEntry ? `Seq ${snap.seq} · ${lastEntry.label}` : `Seq ${snap.seq} · no change yet this session`;
  const sub = mode === "review" ? "each fix is one transaction · the review closes with one checkpoint" : mode === "route" ? "one run, one proposal · accepting it is one run of the router, revertible" : mode === "diagnose" ? "failed attempts, the probe and test runs · nothing changes until you apply one" : log === undefined ? "this host gives no transaction log" : `epoch ${snap.epoch} · ${(log ?? []).length} transaction${(log ?? []).length === 1 ? "" : "s"} this session · ${saves.length ? `last saved at seq ${saves.at(-1)}` : "not saved yet"} · git keeps the history`;

  const traceSel = selection.length ? (inspect(snap.doc, selection[0])?.title ?? selection[0]) : undefined;
  const fillStale = hasZones && (derivedBehind || (derived?.fill ? !derived.fill.current : false));

  return (
    <div ref={rootRef} className={`pcb-screen mode-${mode}`} tabIndex={0} onKeyDown={onKey}>
      <TopBar
        crumbs={[...(props.crumbs ?? [boardName]), "Layout"]}
        {...(props.onNavigate ? { onNavigate: (d) => d !== "layout" && props.onNavigate?.(d) } : {})}
        seq={snap.seq}
        {...(saves.length ? { saved: saves.at(-1)! } : {})}
        reviewCount={queue.length}
        onReview={enterReview}
        {...(mode === "review" ? { toFinish: { left: queue.length, total: reviewTotal } } : {})}
        {...(props.onCheck ? { onCheck: props.onCheck } : {})}
        {...(props.onExport ? { onExport: props.onExport } : {})}
        exportState={exportOk}
        mainElsewhere={!!checkpoint || showProposalCard || mode === "route" || mode === "diagnose"}
        {...(writable ? { onSave: () => void save() } : {})}
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
            if (mode === "edit") setActiveFinding(undefined);
            setSelection((s) => (add ? [...new Set([...s, ...ids])] : ids));
          }}
          onHover={(h) => viewRef.current?.setHover(h?.id)}
          onCursor={(p) => cursorBus.emit(p)}
          onNet={(n) => setLit(n ? [n] : [])}
          onFinding={(id) => {
            const f = findings.find((x) => x.id === id);
            if (!f) return;
            const qi = queue.findIndex((q) => q.findings.some((x) => x.id === id));
            if (mode === "review" && qi >= 0) pickItem(qi);
            else locate(f);
          }}
          callout={callout}
          {...(calloutFor ? { calloutFor, calloutTitle: `${inspect(snap.doc, calloutFor)?.title ?? calloutFor}` } : {})}
          canDrag={canDrag}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onPlace={(x, y, sx, sy) => setPlacing({ x, y, sx, sy })}
          onRegion={(r) => {
            setRegion(r);
            setTool("select");
          }}
          overlay={overlay}
          nodes={nodes}
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
          {...(props.request ? { onAutoroute: () => (mode === "route" ? leaveMode() : openRoute()) } : {})}
          autorouteOn={mode === "route"}
          {...(writable && hasOperation("text.add") ? { onText: () => setTool((t) => (t === "text" ? "select" : "text")) } : {})}
          {...(writable && hasOperation("outline.import_dxf") ? { onDxf: importDxf } : {})}
        />
        {placing && <TextPlacer x={placing.sx} y={placing.sy} onDone={placeText} />}
        <AgentBar state={bar} />
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
          {tool === "region" && <span className="pcb-chip on">draw the autoroute region · drag on the board · Esc</span>}
          {tool === "text" && <span className="pcb-chip on">text · click where it goes · Esc</span>}
          {replaying && <span className="pcb-chip on">replay · seq {status.replay!.seq} · read only</span>}
          {!writable && !replaying && <span className="pcb-chip">read only</span>}
        </div>
        <div className="pcb-live" style={{ right: INSETS.right }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="pcb-chip" title={checks.ran ? `checks at seq ${checks.seq ?? "?"}` : "no check has run"}>
            <span className={`led${checks.ran && !derivedBehind ? " pass" : ""}`} />
            {!checks.ran ? "no check run" : derivedBehind ? "checking…" : `checks live${checks.ms !== undefined ? ` · ${Math.round(checks.ms)} ms` : ""}`}
          </span>
          {hasZones && (
            <span className={`pcb-chip${fillStale ? " warn" : ""}`} title={derived?.fill ? `zone fill: ${derived.fill.source}${derived.fill.seq !== undefined ? ` at seq ${derived.fill.seq}` : ""}` : "no zone fill"}>
              {fillStale ? "fill stale · refilling" : derived?.fill ? `fill ${derived.fill.source}${derived.fill.ms !== undefined ? ` · ${derived.fill.ms} ms` : ""}` : "no fill"}
            </span>
          )}
        </div>
        {toast && (
          <div className="pcb-toastwrap">
            <Toast outcome={toast} onClose={() => setToast(undefined)} />
          </div>
        )}
        {checkpoint && <CheckpointDialog seq={snap.seq} {...checkpoint} onPrepare={(l) => void prepareCheckpoint(l)} onCommit={() => void commitCheckpoint()} onClose={() => setCheckpoint(undefined)} />}
        <Timeline
          log={log}
          seq={session.confirmed().seq}
          epoch={snap.epoch}
          checks={checks}
          {...(props.derived?.history ? { history: props.derived.history } : {})}
          saves={saves}
          checkpoints={checkpoints}
          {...(status.replay ? { replay: status.replay.seq } : {})}
          {...(status.replay?.error ? { replayNote: status.replay.error } : status.replay?.loading ? { replayNote: "reading the board at that version…" } : {})}
          {...(timelineSel ? { selected: timelineSel } : {})}
          title={title}
          sub={sub}
          {...(lane ? { lane } : {})}
          writable={writable}
          playing={playing}
          onPlay={() => setPlaying((p) => !p)}
          onScrub={scrub}
          onSelect={(b) => {
            setTimelineSel(b ? String(b.from) : undefined);
            if (b) {
              const ids = b.ids.filter((id) => snap.doc.records.has(id));
              setSelection(ids);
              fitSelection(ids);
            }
          }}
          {...(writable ? { onUndo: undo, onCheckpoint: () => setCheckpoint({ stage: "label" }) } : {})}
        />
        <aside className="pcb-float pcb-panel" onPointerDown={(e) => e.stopPropagation()}>
          <nav className="pcb-tabs">
            {(["layers", "nets", "checks", "inspect"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t}
                {t === "checks" && queue.length > 0 && <span className="n">{queue.length}</span>}
                {t === "inspect" && selection.length > 0 && mode === "edit" && <span className="n">{selection.length}</span>}
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
            {tab === "checks" &&
              (mode === "review" ? (
                <ReviewPanel
                  doc={snap.doc}
                  items={queue}
                  index={Math.min(rIndex, Math.max(0, queue.length - 1))}
                  filter={rFilter}
                  done={reviewDone}
                  total={reviewTotal}
                  waived={derived?.waived ?? []}
                  writable={writable}
                  onFilter={(f) => {
                    setRFilter(f);
                    const i = f === "all" ? 0 : queue.findIndex((q) => q.group === f);
                    if (i >= 0) pickItem(i);
                  }}
                  onPick={pickItem}
                  onWaive={(it, reason) => void waive(it, reason)}
                  onUnwaive={(f) => void unwaive(f)}
                  onMyself={(it) => {
                    leaveMode();
                    setSelection(it.objects.filter((id) => viewRef.current?.scene?.objects.has(id) || snap.doc.records.has(id)));
                    setTab("inspect");
                  }}
                  onRoute={(it) => it.net && openRoute({ nets: [it.net] })}
                  onWhy={(it) => it.net && void diagnose(it.net)}
                />
              ) : (
                <ChecksPanel findings={findings} checks={checks} {...(notes?.length ? { notes } : {})} {...(activeFinding ? { active: activeFinding } : {})} onLocate={locate} ruleFrom={ruleFrom} />
              ))}
            {tab === "inspect" && mode === "route" && (
              <AutoroutePanel
                routers={routers}
                scope={scopeKind}
                onScope={(s) => {
                  setScopeKind(s);
                  if (s === "region") setTool("region");
                }}
                scopeNote={scopeNote}
                open={{ links: ratsnest.length, nets: scopeKind === "region" ? openNets.length : scopeNets.length }}
                hand={copperOrigin.hand}
                budgetMs={budgetMs}
                onBudget={setBudgetMs}
                {...(running ? { running } : {})}
                {...(proposal ? { proposal } : {})}
                {...(accepted ? { accepted } : {})}
                writable={writable}
                canRun={scopeKind === "region" ? !!region : scopeNets.length > 0}
                onRun={() => void runRoute()}
                onCancel={cancelRoute}
                onAccept={() => void acceptRoute()}
                onReject={rejectRoute}
                onRevert={(cs) => void revertRun(cs)}
              />
            )}
            {tab === "inspect" && mode === "diagnose" && diag && (
              <DiagnosisPanel
                net={diag.net}
                loading={diag.loading}
                {...(diag.error ? { error: diag.error } : {})}
                {...(diag.view ? { view: diag.view } : {})}
                writable={writable}
                onApply={(o) => setRelax({ option: o, net: diag.net })}
                onRun={() => void diagnose(diag.net)}
              />
            )}
            {tab === "inspect" && (mode === "edit" || mode === "review") && (
              <>
                {writable && selection.length > 0 && mode === "edit" && (
                  <EditSection
                    record={selRecords[0]}
                    count={selRecords.length}
                    writable={writable}
                    locked={allLocked(snap.doc, selection)}
                    canRotate={selRecords.some((r) => r.kind === "footprint")}
                    canDelete={deleteOps(snap.doc, selection).ops.length > 0}
                    onField={editField}
                    onRotate={rotate}
                    onFlip={flip}
                    onLock={lock}
                    onDelete={del}
                    {...(ripNet ? { ripNet, onRip: rip } : {})}
                  />
                )}
                <InspectPanel items={inspections} total={selection.length} onLook={() => fitSelection(selection)} ruleFrom={ruleFrom} {...(activeFinding && findings.find((f) => f.id === activeFinding) ? { finding: findings.find((f) => f.id === activeFinding)! } : {})} />
                {writable && (() => {
                  const net = selection.map((id) => viewRef.current?.scene?.objects.get(id)?.netName).find((n): n is string => !!n && openNets.includes(n));
                  return net ? (
                    <div className="pcb-sec">
                      <h4>
                        <span>{net} is open</span>
                        <i>{ratsnest.filter((r) => r.net === net).length} links</i>
                      </h4>
                      <div className="acts">
                        <button className="pcb-btn" onClick={() => openRoute({ nets: [net] })}>
                          Autoroute {net}
                        </button>
                        <button className="pcb-btn" onClick={() => void diagnose(net)}>
                          Why doesn't it route?
                        </button>
                      </div>
                    </div>
                  ) : null;
                })()}
              </>
            )}
          </div>
        </aside>
      </main>
      <StatusWrapper checks={checks} cursorBus={cursorBus} scaleBus={scaleBus} grid={grid} flipped={flipped} active={active} mode={mode} {...(replaying ? { replay: status.replay!.seq } : {})} />
    </div>
  );
}

function StatusWrapper(p: { checks: CheckSummary; cursorBus: { on: (l: (v: { x: number; y: number } | undefined) => void) => () => void }; scaleBus: { on: (l: (v: number) => void) => () => void }; grid: number; flipped: boolean; active: string; mode: Mode; replay?: number }) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | undefined>(undefined);
  const [scale, setScale] = useState(1);
  useEffect(() => p.cursorBus.on(setCursor), [p.cursorBus]);
  useEffect(() => p.scaleBus.on(setScale), [p.scaleBus]);
  const modeChip = p.replay !== undefined ? `replay · seq ${p.replay} · esc returns` : p.mode === "review" ? "review mode · j k move · esc leaves" : p.mode === "route" ? "autoroute · esc cancels" : p.mode === "diagnose" ? "diagnosis · esc leaves" : undefined;
  return <StatusLine checks={p.checks} {...(cursor ? { cursor } : {})} grid={p.grid} flipped={p.flipped} scale={scale} active={p.active} {...(modeChip ? { mode: modeChip } : {})} />;
}

/**
 * The schematic screen: the pin-level schematic in the same shell as the layout screen (top bar with the depth
 * switcher, floating tool rail, agent bar, right panel with tabs, bottom timeline, status line). It reads a
 * `SchematicSource` (the host's feed) and writes through the host's request channel as a person; every gesture is
 * one transaction, so one undo step. Read only without a channel.
 *
 * Mouse: click selects (Shift adds); drag a symbol, label, power symbol or card tag to move it (a symbol's wires
 * follow); drag a symbol's reference to move its fields; drag a selected wire's segment to reshape it; drag empty
 * space to pan (Shift: select by box); wheel zooms. Keys: V select, W wire, R rotate (Shift+R the other way),
 * X mirror, L wire to labels and back, P pin or unpin, Delete removes wires, labels, power symbols and no-connect
 * marks, F fit, Esc clears, Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+S save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lastProbe, onProbe, publishProbe, SCREEN_CSS, Icon, type Depth, type Probe } from "../shell/index.js";
import { BASE_SCALE, LOD_STOPS, SchematicCanvas, type DragPreview, type Hit, type Lod } from "./canvas.js";
import { followPreview, moveSegment } from "./paths.js";
import type { SchematicSource } from "./remote.js";
import { SCHEMATIC_CSS } from "./styles.js";
import type { Box, PageCleanup, PageDefect, PageFinding, PageFix, PageItem, PagePin, SchematicEntry, SchematicReply, SchematicRequest, XY } from "./types.js";
import { AgentBar, BlocksPanel, ChecksPanel, Gutter, InspectPanel, NetsPanel, Rail, ReadabilityPanel, StatusLine, Timeline, TopBar, type AgentState, type Tab, type Tool } from "./ui.js";

export interface SchematicScreenProps {
  source: SchematicSource;
  /** The host's request channel: present, the screen edits as a person; absent, it is read only. */
  request?: (req: SchematicRequest) => Promise<SchematicReply>;
  /** Breadcrumbs before "Schematic". */
  crumbs?: string[];
  entry?: SchematicEntry;
  onNavigate?: (d: Depth) => void;
  navEnabled?: (d: Depth) => boolean;
  /** Called once with the canvas (tests, captures). */
  onCanvas?: (c: SchematicCanvas) => void;
  /** Called once with the screen's handles (tests, captures). */
  onApi?: (api: SchematicScreenApi) => void;
}

export interface SchematicScreenApi {
  canvas: SchematicCanvas;
  select(ids: string[], pin?: PagePin): void;
  setTab(t: Tab): void;
  request(req: SchematicRequest): Promise<SchematicReply>;
  firstPaintMs?: number;
}

let cssInstalled = false;
function installCss() {
  if (cssInstalled || typeof document === "undefined") return;
  cssInstalled = true;
  const s = document.createElement("style");
  s.dataset.schematicScreen = "";
  s.textContent = `${SCREEN_CSS}\n${SCHEMATIC_CSS}`;
  document.head.append(s);
}

const INSETS = { left: 60, right: 380, top: 70, bottom: 170 };
const MOVABLE = new Set(["symbol", "label", "power", "card"]);
let batchN = 0;
const bid = (w: string) => `page-${w}-${Date.now().toString(36)}-${(++batchN).toString(36)}`;

type Drag =
  | { kind: "pan"; x: number; y: number; tx: number; ty: number }
  | { kind: "move"; start: XY; ids: string[]; d: XY; moved: boolean }
  | { kind: "field"; start: XY; id: string; d: XY; moved: boolean }
  | { kind: "segment"; start: XY; id: string; seg: number; d: XY; moved: boolean }
  | { kind: "band"; start: XY; now: XY; add: boolean };

export function SchematicScreen(props: SchematicScreenProps) {
  installCss();
  const { source } = props;
  const writable = !!props.request;
  const [, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SchematicCanvas | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [pinSel, setPinSel] = useState<PagePin | undefined>(undefined);
  const [lit, setLit] = useState<string | undefined>(undefined);
  const [scale, setScale] = useState(BASE_SCALE);
  const [lod, setLod] = useState<Lod>(3);
  const [cursor, setCursor] = useState<XY | undefined>(undefined);
  const [markers, setMarkers] = useState(true);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  const [defect, setDefect] = useState<PageDefect | undefined>(undefined);
  const [fixes, setFixes] = useState<{ for: string; list?: PageFix[] } | undefined>(undefined);
  const [activeFix, setActiveFix] = useState<number | undefined>(undefined);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [cleanup, setCleanup] = useState<PageCleanup | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [finding, setFinding] = useState<string | undefined>(undefined);
  const [timelineSel, setTimelineSel] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState<{ net: string; card: string; points: XY[] } | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const firstPaint = useRef<number | undefined>(undefined);
  const [probed, setProbed] = useState<string[]>([]);

  const model = source.model;
  const items = source.items;
  const derived = source.derived;

  // ------------------------------------------------------------ canvas
  useEffect(() => {
    const host = hostRef.current!;
    const t0 = performance.now();
    const c = new SchematicCanvas(host);
    canvasRef.current = c;
    c.setModel(source.model, source.items);
    c.fit(undefined, INSETS);
    requestAnimationFrame(() => {
      firstPaint.current = performance.now() - t0;
      api.firstPaintMs = firstPaint.current;
    });
    const off = c.onView((v) => {
      setScale(v.s);
      setLod(c.lod);
    });
    setScale(c.view.s);
    setLod(c.lod);
    const api: SchematicScreenApi = { canvas: c, select: (ids, pin) => select(ids, pin), setTab, request: (r) => send(r) };
    props.onCanvas?.(c);
    props.onApi?.(api);
    const unsub = source.subscribe((e) => {
      if (e.type === "model") c.setModel(source.model, source.items);
      else if (e.type === "commit") c.update(source.model, source.items, e.changed, e.removed);
      bump();
    });
    return () => {
      off();
      unsub();
      c.dispose();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  // the screen takes the keyboard when it opens
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);

  // selection that left the sheet leaves the selection
  useEffect(() => {
    setSelection((s) => (s.every((id) => items.has(id)) ? s : s.filter((id) => items.has(id))));
  }, [items, model.seq]);
  useEffect(() => canvasRef.current?.setSelection(selection, pinSel), [selection, pinSel, model.seq]);
  useEffect(() => canvasRef.current?.setLit(lit), [lit]);
  useEffect(() => canvasRef.current?.setProbed(probed), [probed]);

  // numbered markers: the score's defects, then the electrical findings (as the agent's scene numbers them)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (!markers || !derived) return c.setMarkers([]);
    const ms = derived.defects.filter((d) => d.severity !== "info").map((d) => ({ n: d.n, at: d.at, severity: d.severity, on: defect?.id === d.id }));
    const base = derived.defects.length;
    derived.findings.forEach((f, i) => f.at && ms.push({ n: base + i + 1, at: f.at, severity: f.severity === "error" ? "error" : "warning", on: finding === f.id }));
    c.setMarkers(ms);
  }, [derived, markers, defect, finding]);

  // the ghost on screen: a hovered fix, else the cleanup preview
  const ghost = useMemo(() => {
    if (cleanup && !cleanup.applied) return cleanup.ghost;
    if (fixes?.list && activeFix !== undefined) return fixes.list.find((f) => f.index === activeFix)?.ghost;
    return undefined;
  }, [cleanup, fixes, activeFix]);
  useEffect(() => canvasRef.current?.setGhost(ghost), [ghost]);

  // ------------------------------------------------------------ requests
  const send = useCallback(
    async (req: SchematicRequest): Promise<SchematicReply> => {
      if (!props.request) return { ok: false, error: "this screen is read only" };
      const r = await props.request(req);
      if (!r.ok) setToast({ ok: false, text: r.error ?? r.status ?? "refused" });
      return r;
    },
    [props.request],
  );
  const apply = (label: string, ops: { op: string; [k: string]: unknown }[]) => send({ method: "apply", tx: { batchId: bid("op"), label, ops } });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), toast.ok ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ------------------------------------------------------------ selection and cross-probe
  const select = useCallback(
    (ids: string[], pin?: PagePin) => {
      setSelection(ids);
      setPinSel(pin);
      if (ids.length) setTab((t) => (t === "readability" || t === "checks" ? t : "inspect"));
      const parts = ids.map((id) => items.get(id)).filter((i): i is PageItem => i?.kind === "symbol").map((i) => ({ path: String(i.rec.part), ref: String(i.rec.ref) }));
      const nets = [...new Set([...(pin?.net ? [pin.net] : []), ...ids.map((id) => items.get(id)?.net).filter((n): n is string => !!n)])];
      publishProbe({ source: "schematic", board: model.board, parts, nets });
    },
    [items, model.board],
  );
  const light = useCallback(
    (net: string | undefined) => {
      setLit(net);
      if (net) publishProbe({ source: "schematic", board: model.board, parts: [], nets: [net] });
    },
    [model.board],
  );
  useEffect(() => {
    const show = (p: Probe) => {
      if (p.source === "schematic") return;
      const paths = new Set(p.parts.flatMap((x) => (x.path ? [x.path] : [])));
      const refs = new Set(p.parts.flatMap((x) => (x.ref ? [x.ref] : [])));
      setProbed([...items.values()].filter((i) => i.kind === "symbol" && (paths.has(String(i.rec.part)) || (!paths.size && refs.has(String(i.rec.ref))))).map((i) => i.id));
      setLit(p.nets[0]);
    };
    // a probe sent before this screen opened (the switcher from the layout) shows at once
    const last = lastProbe();
    if (last) show(last);
    return onProbe(show);
  }, [items]);

  // ------------------------------------------------------------ actions
  const selItems = selection.map((id) => items.get(id)).filter((i): i is PageItem => !!i);
  const symbolsSel = selItems.filter((i) => i.kind === "symbol").map((i) => i.id);
  const rotate = (angle: 90 | 270 = 90) => symbolsSel.length && void send({ method: "rotate", ids: symbolsSel, angle });
  const mirror = () => symbolsSel.length && void send({ method: "mirror", ids: symbolsSel });
  const pinIds = selItems.filter((i) => i.kind !== "noconnect").map((i) => i.id);
  const togglePin = (on?: boolean) => {
    if (!pinIds.length) return;
    const want = on ?? !selItems.every((i) => i.pinned);
    void apply(`${want ? "pin" : "unpin"} ${pinIds.length === 1 ? (selItems[0].rec.ref ?? "an item") : `${pinIds.length} items`} by hand`, [{ op: want ? "pin" : "unpin", ids: pinIds }]);
  };
  const convert = () => {
    const wires = selItems.filter((i) => i.kind === "wire").map((i) => i.id);
    if (wires.length) return void apply("turn wires into labels", [{ op: "wire.to_label", ids: wires }]);
    const l = selItems.find((i) => i.kind === "label");
    if (l) void apply(`draw ${l.net} as a wire`, [{ op: "label.to_wire", net: l.net, card: l.card }]);
  };
  const remove = () => {
    const ops: { op: string; ids: string[] }[] = [];
    const of = (k: string) => selItems.filter((i) => i.kind === k).map((i) => i.id);
    if (of("wire").length) ops.push({ op: "wire.delete", ids: of("wire") });
    if (of("label").length) ops.push({ op: "label.delete", ids: of("label") });
    if (of("power").length) ops.push({ op: "power.delete", ids: of("power") });
    if (of("noconnect").length) ops.push({ op: "noconnect.delete", ids: of("noconnect") });
    if (!ops.length) return setToast({ ok: false, text: selItems.some((i) => i.kind === "symbol") ? "symbols come from UHD: remove a part in the UHD source" : "nothing to delete" });
    void apply(`delete ${ops.reduce((n, o) => n + o.ids.length, 0)} items by hand`, ops).then((r) => r.ok && select([]));
  };
  const layoutCard = (card: string, mode: "fresh" | "tidy") => void apply(mode === "fresh" ? "lay out one card again" : "redraw the wiring of one card", [{ op: "layout.run", scope: [card], mode }]);
  const layoutAll = () => void apply("lay out every card again", [{ op: "layout.run", scope: "all", mode: "fresh" }]);
  const regroup = (card: string) => symbolsSel.length && void apply(`move ${symbolsSel.length === 1 ? "a part" : "parts"} to another card`, [{ op: "card.regroup", ids: symbolsSel, card }]);
  const undo = () => void send({ method: "undo" });
  const redo = () => void send({ method: "redo" });
  const save = () =>
    void send({ method: "save" }).then((r) => {
      if (r.ok) setToast({ ok: true, text: r.message ?? "saved" });
    });
  const checkpoint = () =>
    void send({ method: "checkpoint", label: `schematic checkpoint at seq ${model.seq}` }).then((r) => {
      if (r.ok) setToast({ ok: true, text: r.committed ? `checkpoint committed ${r.committed}` : (r.message ?? "checkpoint saved") });
    });

  const fit = () => canvasRef.current?.fit(undefined, INSETS);
  const zoomToBox = (b: Box, minScale = 0) => {
    const c = canvasRef.current;
    if (!c) return;
    c.fit([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4], INSETS);
    if (c.view.s < minScale) {
      const r = c.host.getBoundingClientRect();
      c.zoomAt(INSETS.left + (r.width - INSETS.left - INSETS.right) / 2, INSETS.top + (r.height - INSETS.top - INSETS.bottom) / 2, minScale / c.view.s);
    }
  };
  const depthStop = (l: 0 | Lod) => {
    const c = canvasRef.current;
    if (!c) return;
    if (l === 0) return props.onNavigate?.("system");
    const target = l === 1 ? LOD_STOPS.blocks * 0.8 : l === 2 ? (LOD_STOPS.blocks + LOD_STOPS.pins) / 2 : Math.max(LOD_STOPS.pins * 1.6, BASE_SCALE);
    const r = c.host.getBoundingClientRect();
    if (l === 1) {
      fit();
      if (c.view.s >= LOD_STOPS.blocks) c.zoomAt(INSETS.left + (r.width - INSETS.left - INSETS.right) / 2, INSETS.top + (r.height - INSETS.top - INSETS.bottom) / 2, (LOD_STOPS.blocks * 0.9) / c.view.s);
      return;
    }
    c.zoomAt(INSETS.left + (r.width - INSETS.left - INSETS.right) / 2, INSETS.top + (r.height - INSETS.top - INSETS.bottom) / 2, target / c.view.s);
  };

  // ------------------------------------------------------------ fixes and cleanup
  const openDefect = (d: PageDefect | undefined) => {
    setDefect(d);
    setActiveFix(undefined);
    if (!d) return setFixes(undefined);
    zoomToBox([d.at[0] - 6, d.at[1] - 6, d.at[0] + 6, d.at[1] + 6], LOD_STOPS.pins * 1.2);
    setFixes({ for: d.id });
    if (!writable) return;
    void send({ method: "fixes", defect: d.id }).then((r) => {
      setFixes((f) => (f?.for === d.id ? { for: d.id, list: r.fixes ?? [] } : f));
      if (r.fixes?.length) setActiveFix(r.fixes[0].index);
    });
  };
  const acceptFix = (d: PageDefect, f: PageFix) =>
    void send({ method: "acceptFix", defect: d.id, index: f.index }).then((r) => {
      if (r.ok) {
        setToast({ ok: true, text: `fix accepted: ${f.title}` });
        setFixes(undefined);
        setActiveFix(undefined);
        setDefect(undefined);
      }
    });
  const rejectFix = (d: PageDefect, f: PageFix) => {
    setRejected((s) => new Set([...s, `${d.id}#${f.index}`]));
    setActiveFix(undefined);
  };
  const runCleanup = () => {
    setBusy("cleanup");
    setTab("readability");
    void send({ method: "cleanupPreview", budget: 60 }).then((r) => {
      setBusy(undefined);
      if (r.cleanup) {
        setCleanup(r.cleanup);
        // the ghost may touch any card: show the whole sheet
        fit();
      }
    });
  };
  const applyCleanup = () => {
    if (!cleanup) return;
    setBusy("apply");
    void send({ method: "cleanupApply", id: cleanup.id }).then((r) => {
      setBusy(undefined);
      if (r.ok && r.cleanup) {
        setCleanup(r.cleanup);
        setToast({ ok: true, text: r.message ?? "cleanup applied" });
      }
    });
  };
  const revertCleanup = () => {
    if (!cleanup) return;
    setBusy("revert");
    void send({ method: "cleanupRevert", id: cleanup.id }).then((r) => {
      setBusy(undefined);
      if (r.ok) {
        setCleanup(undefined);
        setToast({ ok: true, text: r.message ?? "cleanup reverted" });
      }
    });
  };
  const proposedIds = useMemo(() => {
    const s = new Set<string>();
    const g = ghost ?? "";
    if (!g) return s;
    for (const it of items.values()) if (it.kind === "symbol" && g.includes(String(it.rec.ref))) s.add(it.id);
    return s;
  }, [ghost, items]);

  const locateFinding = (f: PageFinding) => {
    setFinding(f.id);
    const pin = f.objects.find((o) => o.startsWith("pin:"))?.slice(4);
    const net = f.objects.find((o) => o.startsWith("net:"))?.slice(4);
    if (pin) {
      const sym = [...items.values()].find((i) => i.kind === "symbol" && i.pins?.some((p) => p.keys.includes(pin)));
      const pp = sym?.pins?.find((p) => p.keys.includes(pin));
      if (sym && pp) {
        select([sym.id], pp);
        setTab("checks");
      }
    }
    if (net) setLit(net);
    if (f.at) zoomToBox([f.at[0] - 8, f.at[1] - 8, f.at[0] + 8, f.at[1] + 8], LOD_STOPS.pins * 1.2);
  };

  // ------------------------------------------------------------ pointer
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = hostRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const snap = (p: XY): XY => [Math.round(p[0]), Math.round(p[1])];

  const previewFor = (ids: string[], d: XY): DragPreview => {
    const syms = ids.map((id) => items.get(id)).filter((i): i is PageItem => i?.kind === "symbol");
    const moved = new Map<string, { to: XY; dir: PagePin["dir"] }>();
    for (const s of syms) for (const p of s.pins ?? []) moved.set(`${p.at[0]},${p.at[1]}`, { to: [p.at[0] + d[0], p.at[1] + d[1]], dir: p.dir });
    const cards = new Set(ids.filter((id) => items.get(id)?.kind === "card"));
    const wires = [...items.values()].filter((i) => i.kind === "wire" && !(i.card && cards.has(i.card))).map((i) => ({ id: i.id, net: i.net!, points: i.rec.points as XY[] }));
    // a card moves with everything in it
    const inCards = cards.size ? [...items.values()].filter((i) => i.card && cards.has(i.card)).map((i) => i.id) : [];
    return { ids: [...ids, ...inCards], dx: d[0], dy: d[1], wires: moved.size ? followPreview(wires, moved, d) : [] };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return;
    rootRef.current?.focus({ preventScroll: true });
    const [x, y] = local(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: "pan", x, y, tx: c.view.tx, ty: c.view.ty };
      return;
    }
    const p = c.toSheet(x, y);
    if (tool === "wire" && writable) {
      const hit = c.pick(x, y, { cards: false });
      const at = hit?.pin ? hit.pin.at : snap(p);
      if (!draft) {
        if (!hit?.pin?.net) return setToast({ ok: false, text: "start a wire on a pin that is on a net: a wire draws a UHD net" });
        setDraft({ net: hit.pin.net, card: String(hit.item.card ?? hit.item.rec.card), points: [at] });
        return;
      }
      const last = draft.points[draft.points.length - 1];
      const corner: XY[] = last[0] !== at[0] && last[1] !== at[1] ? [[at[0], last[1]], at] : [at];
      const pts = [...draft.points, ...corner];
      const endNet = hit?.pin?.net ?? (hit?.kind === "wire" || hit?.kind === "label" || hit?.kind === "power" ? hit.item.net : undefined);
      if (endNet && endNet !== draft.net) return setToast({ ok: false, text: `that would join ${draft.net} and ${endNet}: net changes are UHD edits` });
      if (endNet === draft.net || e.detail >= 2) {
        setDraft(undefined);
        void send({ method: "drawWire", net: draft.net, card: draft.card, points: pts });
        return;
      }
      setDraft({ ...draft, points: pts });
      return;
    }
    const hit = c.pick(x, y);
    if (!hit) {
      if (e.shiftKey) drag.current = { kind: "band", start: p, now: p, add: true };
      else drag.current = { kind: "pan", x, y, tx: c.view.tx, ty: c.view.ty };
      return;
    }
    const already = selection.includes(hit.id);
    if (hit.kind === "pin") {
      select(e.shiftKey ? [...new Set([...selection, hit.id])] : [hit.id], hit.pin);
      if (writable) drag.current = { kind: "move", start: p, ids: e.shiftKey ? [...new Set([...selection, hit.id])] : [hit.id], d: [0, 0], moved: false };
      return;
    }
    if (hit.kind === "field") {
      if (!already) select([hit.id]);
      if (writable) drag.current = { kind: "field", start: p, id: hit.id, d: [0, 0], moved: false };
      return;
    }
    if (hit.kind === "wire") {
      if (already && writable && hit.seg !== undefined) drag.current = { kind: "segment", start: p, id: hit.id, seg: hit.seg, d: [0, 0], moved: false };
      select(e.shiftKey ? [...new Set([...selection, hit.id])] : [hit.id]);
      return;
    }
    const next = e.shiftKey ? (already ? selection.filter((s) => s !== hit.id) : [...selection, hit.id]) : already ? selection : [hit.id];
    if (!already || e.shiftKey) select(next);
    else if (pinSel) select(selection);
    if (writable && MOVABLE.has(hit.kind) && next.includes(hit.id)) drag.current = { kind: "move", start: p, ids: next.filter((id) => MOVABLE.has(items.get(id)?.kind ?? "")), d: [0, 0], moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return;
    const [x, y] = local(e);
    const p = c.toSheet(x, y);
    setCursor(p);
    const g = drag.current;
    if (!g) {
      if (tool === "wire" && draft) {
        const last = draft.points[draft.points.length - 1];
        const at = snap(p);
        const pts = [...draft.points, ...(last[0] !== at[0] && last[1] !== at[1] ? [[at[0], last[1]] as XY] : []), at];
        c.setPreview({ ids: [], dx: 0, dy: 0, wires: [{ id: "draft", net: draft.net, points: pts }] });
        return;
      }
      c.setHover(c.pick(x, y)?.id);
      return;
    }
    if (g.kind === "pan") {
      c.setView({ s: c.view.s, tx: g.tx + (x - g.x), ty: g.ty + (y - g.y) });
      hostRef.current?.classList.add("pan");
      return;
    }
    if (g.kind === "band") {
      g.now = p;
      return;
    }
    const d = snap([p[0] - g.start[0], p[1] - g.start[1]]);
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * c.view.s < 4) return;
    g.moved = true;
    g.d = d;
    if (g.kind === "move") c.setPreview(previewFor(g.ids, d));
    else if (g.kind === "field") c.setPreview({ ids: [g.id], dx: d[0], dy: d[1], wires: [], field: g.id });
    else if (g.kind === "segment") {
      const w = items.get(g.id)!;
      c.setPreview({ ids: [], dx: 0, dy: 0, wires: [{ id: g.id, net: w.net!, points: moveSegment(w.rec.points as XY[], g.seg, d) }] });
    }
  };

  const onPointerUp = () => {
    const c = canvasRef.current;
    const g = drag.current;
    drag.current = undefined;
    hostRef.current?.classList.remove("pan");
    if (!c || !g) return;
    if (g.kind === "pan") {
      if (Math.abs(c.view.tx - g.tx) + Math.abs(c.view.ty - g.ty) < 3 && !draft) select([]);
      return;
    }
    if (g.kind === "band") {
      const b: Box = [Math.min(g.start[0], g.now[0]), Math.min(g.start[1], g.now[1]), Math.max(g.start[0], g.now[0]), Math.max(g.start[1], g.now[1])];
      select([...new Set([...selection, ...c.itemsIn(b)])]);
      return;
    }
    const keep = g.moved && (g.d[0] || g.d[1]);
    const clear = () => c.setPreview(undefined);
    if (!keep) return clear();
    let p: Promise<SchematicReply>;
    if (g.kind === "move") p = send({ method: "move", ids: g.ids, dx: g.d[0], dy: g.d[1] });
    else if (g.kind === "field") p = send({ method: "moveField", id: g.id, dx: g.d[0], dy: g.d[1] });
    else {
      const w = items.get(g.id)!;
      p = send({ method: "editWire", id: g.id, points: moveSegment(w.rec.points as XY[], g.seg, g.d) });
    }
    // the preview stays until the commit comes back (or the write fails)
    void p.then(clear, clear);
  };

  const onWheel = (e: React.WheelEvent) => {
    const c = canvasRef.current;
    if (!c) return;
    const [x, y] = local(e);
    c.zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  };

  // ------------------------------------------------------------ keys
  const onKeyDown = (e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: EventTarget | null; preventDefault(): void }) => {
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") return void (e.preventDefault(), e.shiftKey ? redo() : undo());
    if (mod && k === "y") return void (e.preventDefault(), redo());
    if (mod && k === "s") return void (e.preventDefault(), writable && save());
    if (mod) return;
    if (k === "escape") {
      setDraft(undefined);
      canvasRef.current?.setPreview(undefined);
      setTool("select");
      select([]);
      setLit(undefined);
      return;
    }
    if (k === "v") return setTool("select");
    if (k === "w" && writable) return setTool((t) => (t === "wire" ? "select" : "wire"));
    if (k === "f") return fit();
    if (!writable) return;
    if (k === "r") return void rotate(e.shiftKey ? 270 : 90);
    if (k === "x") return void mirror();
    if (k === "l") return convert();
    if (k === "p") return togglePin();
    if (k === "delete" || k === "backspace") return remove();
    if (k === "enter" && draft) {
      const d = draft;
      setDraft(undefined);
      canvasRef.current?.setPreview(undefined);
      if (d.points.length >= 2) void send({ method: "drawWire", net: d.net, card: d.card, points: d.points });
    }
  };

  // keys also reach the screen when focus fell to the page (a click on the panel's text): the screen owns the page's keys then
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const a = document.activeElement;
      if (a && a !== document.body && rootRef.current?.contains(a)) return;
      if (a && a !== document.body) return;
      keyRef.current(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ------------------------------------------------------------ derived for the frame
  const cardInfo = useMemo(() => {
    const m = new Map<string, { score?: number; refs: string[] }>();
    for (const it of items.values()) if (it.kind === "card") m.set(it.id, { ...(derived?.cards[it.id] !== undefined ? { score: derived.cards[it.id] } : {}), refs: [] });
    for (const it of items.values()) if (it.kind === "symbol" && it.card) m.get(it.card)?.refs.push(String(it.rec.ref));
    return m;
  }, [items, model.seq, derived]);
  useEffect(() => canvasRef.current?.setCardInfo(cardInfo), [cardInfo]);

  const agentLog = source.log.filter((l) => l.actor.kind === "agent").at(-1);
  const agent: AgentState = cleanup && !cleanup.applied
    ? {
        title: `Clean up ${model.name}`,
        sub: `${cleanup.passes} pass${cleanup.passes === 1 ? "" : "es"} · ${cleanup.steps.length} fixes · score ${cleanup.before.score} → ${cleanup.after.score} · preview only, nothing written`,
        working: true,
        actions: (
          <button className="pcb-btn" onClick={() => setCleanup(undefined)}>
            <Icon name="close" size={12} /> Discard
          </button>
        ),
      }
    : source.leases.length
      ? { title: `${source.leases[0].holder} is working`, sub: `lease · ${source.leases[0].purpose}`, working: true }
      : model.firstOpen
        ? { title: "Laid out on open", sub: "the automatic layout ran once in memory · nothing is written until you save", working: false }
        : agentLog
          ? { title: "Ready", sub: `last: ${agentLog.label} · ${agentLog.actor.name ?? agentLog.actor.id} · seq ${agentLog.seq}`, working: false }
          : { title: "Ready", sub: "agents work through the schematic tools (MCP, CLI) as agents; their changes show here", working: false };

  const errors = (derived?.findings.filter((f) => f.severity === "error").length ?? 0) + (derived?.gates.open ?? 0);
  const one = selItems[0];
  const saves = source.saved !== undefined ? [source.saved] : [];

  return (
    <div className="pcb-screen" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} data-schematic-screen={source.key} data-seq={model.seq}>
      <TopBar crumbs={props.crumbs ?? [model.name]} {...(props.onNavigate ? { onNavigate: props.onNavigate } : {})} {...(props.navEnabled ? { navEnabled: props.navEnabled } : {})} seq={model.seq} {...(source.saved !== undefined ? { saved: source.saved } : {})} {...(model.firstOpen ? { firstOpen: true } : {})} {...(writable ? { onSave: save } : {})} {...(derived ? { liveMs: derived.ms } : {})} />
      <Gutter errors={errors} />
      <main className="sch-main">
        <div ref={hostRef} className={`sch-canvas${tool === "wire" ? " wire" : ""}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => canvasRef.current?.setHover(undefined)} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} onDoubleClick={() => one?.kind === "card" && zoomToBox(one.box)} />
        <Rail
          tool={tool}
          onTool={setTool}
          writable={writable}
          canSymbol={symbolsSel.length > 0}
          canConvert={selItems.some((i) => i.kind === "wire" || i.kind === "label")}
          canPin={pinIds.length > 0}
          pinned={selItems.length > 0 && selItems.every((i) => i.pinned)}
          onRotate={() => void rotate()}
          onMirror={() => void mirror()}
          onConvert={convert}
          onPin={() => togglePin()}
          onLayout={() => (one?.card || one?.kind === "card" ? layoutCard(one.kind === "card" ? one.id : one.card!, "fresh") : layoutAll())}
          layoutTitle={one?.card || one?.kind === "card" ? "Lay out this card again (pinned items stay)" : "Lay out every card again (pinned items stay)"}
          onFit={fit}
          markers={markers}
          onMarkers={() => setMarkers((m) => !m)}
          errors={errors}
        />
        <AgentBar state={agent} />
        <div className="pcb-live" style={{ right: 380 }}>
          <span className="pcb-chip" title="The checks and the score run after every commit">
            <span className={`led${derived ? " pass" : ""}`} /> checks live{derived ? ` · ${Math.round(derived.ms)} ms` : ""}
          </span>
          <span className="pcb-chip" data-zoom={lod}>
            zoom {Math.round((scale / BASE_SCALE) * 100)}% · L{lod} {lod === 1 ? "blocks" : lod === 2 ? "symbols" : "pins and nets"}
          </span>
        </div>
        {(model.firstOpen || model.stale) && (
          <div className="sch-first">
            {model.firstOpen && <span className="pcb-chip dashed">first open · laid out in memory · save to keep it</span>}
            {model.stale && <span className="pcb-chip warn">the circuit changed since this layout · lay out to update</span>}
          </div>
        )}
        <div className="sch-legend">
          <span className="h">wires by signal class</span>
          {(["power", "ground", "digital", "i2c", "usb", "analog"] as const).map((k) => (
            <span key={k}>
              <i style={{ background: model.colors[k] }} />
              {k === "i2c" ? "I2C bus" : k === "usb" ? "USB pair" : k}
            </span>
          ))}
          <span>
            <i style={{ background: model.highlight }} />
            selected
          </span>
        </div>
        <aside className="pcb-float pcb-panel" onPointerDown={(e) => e.stopPropagation()}>
          <nav className="pcb-tabs">
            {(["blocks", "nets", "checks", "readability", "inspect"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} data-tab={t}>
                {t}
                {t === "checks" && derived ? <span className="n">{derived.findings.length}</span> : null}
                {t === "readability" && derived ? <span className="n">{derived.defects.length}</span> : null}
              </button>
            ))}
          </nav>
          <div className="pcb-body">
            {tab === "blocks" && <BlocksPanel model={model} items={items} {...(derived ? { derived } : {})} lod={lod} onStop={depthStop} systemEnabled={!!props.onNavigate && (props.navEnabled?.("system") ?? true)} onCard={(id) => (select([id]), zoomToBox(items.get(id)!.box))} selected={selection} {...(writable ? { onLayoutAll: layoutAll } : {})} />}
            {tab === "nets" && <NetsPanel nets={model.nets} colors={model.colors} {...(lit ? { lit } : {})} onLight={light} />}
            {tab === "checks" && <ChecksPanel {...(derived ? { derived } : {})} {...(finding ? { active: finding } : {})} onLocate={locateFinding} />}
            {tab === "readability" && (
              <ReadabilityPanel
                {...(derived ? { derived } : {})}
                model={model}
                {...(defect ? { activeDefect: defect.id } : {})}
                onDefect={openDefect}
                {...(fixes?.list ? { fixes: fixes.list } : {})}
                {...(fixes ? { fixesFor: fixes.for } : {})}
                {...(activeFix !== undefined ? { activeFix } : {})}
                onFixHover={setActiveFix}
                {...(writable ? { onAccept: acceptFix } : {})}
                onReject={rejectFix}
                rejected={rejected}
                {...(cleanup ? { cleanup } : {})}
                {...(busy ? { busy } : {})}
                {...(writable ? { onCleanup: runCleanup, onCleanupApply: applyCleanup, onCleanupRevert: revertCleanup } : {})}
                onCleanupDiscard={() => setCleanup(undefined)}
              />
            )}
            {tab === "inspect" && (
              <InspectPanel
                model={model}
                items={items}
                {...(derived ? { derived } : {})}
                selection={selection}
                {...(pinSel ? { pin: pinSel } : {})}
                proposed={proposedIds}
                writable={writable}
                onPin={(p) => select(selection, p)}
                act={{ rotate: () => void rotate(), mirror: () => void mirror(), pin: (on) => togglePin(on), convert, layoutCard, regroup: (c) => void regroup(c), light, remove }}
                layoutKnown={!!props.entry?.layoutKey}
                probed={probed.map((id) => String(items.get(id)?.rec.ref ?? id))}
              />
            )}
          </div>
        </aside>
        <Timeline
          name={model.name}
          log={source.log}
          seq={model.seq}
          scores={source.scores}
          saves={saves}
          checkpoints={source.checkpoints}
          findings={derived?.findings.length ?? 0}
          {...(writable ? { onUndo: undo, onRedo: redo, onCheckpoint: checkpoint } : {})}
          {...(timelineSel !== undefined ? { selected: timelineSel } : {})}
          onSelect={(e) => setTimelineSel(e?.seq)}
        />
        {toast && (
          <div className="pcb-toastwrap">
            <div className={`pcb-toast ${toast.ok ? "pass" : "fail"}`} data-toast={toast.ok ? "ok" : "fail"}>
              <b>{toast.ok ? "Done" : "Refused"}</b>
              <span>{toast.text}</span>
              <button className="pcb-btn ghost" onClick={() => setToast(undefined)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          </div>
        )}
      </main>
      <StatusLine {...(derived ? { derived } : {})} parts={model.parts.length} nets={model.nets.length} scale={scale} lod={lod} {...(cursor ? { cursor } : {})} {...(props.entry ? { dir: props.entry.dir } : {})} />
    </div>
  );
}

export { moveSegment };
export type { Hit };

/**
 * The layout screen's interactive tools (L3 for routing, L1 for the editing shell), as one hook the screen wires in
 * with one-line hooks: the route tool on the kernel's route sessions (the walk-around draft drawn live, its
 * clearance halo, one callout on the active segment naming the limiting rule, its tier and its source, live length,
 * V for a via, / for the posture, W for the width, Backspace backs up, F or a double click finishes as one
 * `track.route` transaction, Esc drops the draft, Ctrl+M switches to highlight collisions), the via, zone, keep-out,
 * rip-up, outline and silkscreen-line tools, kernel drags (a footprint with its attached tracks, a track or via with
 * its neighbors following, held against agents while it moves), track widths and the DXF outline import with its
 * report.
 *
 * The draft is drawn straight into the canvas's draft layer per cursor move (no React render per move); the panel,
 * the Drafting lane and the agent bar follow the tool's state.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { mm, type BoardDocument, type CopperLayer } from "../board.js";
import type { BoardView } from "../boardview.js";
import type { Tool, ToolInput, ToolPointer } from "../BoardCanvas.js";
import { calloutAnchor, dragNotesSvg, placeCard, leaderSvg, lineSvg, outlineHandlesSvg, polygonSvg, routeCardHtml, routeDraftSvg } from "../draft-overlay.js";
import { ToolController } from "../edit/controller.js";
import type { EditSession, Outcome, RequestFn } from "../edit/session.js";
import { hasOperation } from "../edit/session.js";
import { contourOf, dxfReport, floorClearance, lineOp, keepoutOp, moveVertexOp, nearestVertex, outlineFromCad, outlineVertices, rectContour, reportOf, ripOp, ripSelectionOps, ripSummary, routeCallout, routeStartFor, stepWidth, valueSource, viaOp, viaSize, widthOps, zoneOp, mmText, type DxfReport, type KeepoutBlocks, type KeepoutTier, type Pt, type RouteDraft } from "../edit/tools.js";
import { boxOfIds, FAIL, SELECT, WARN, type ScreenMap } from "../overlay.js";
import type { PageOpCall } from "../types.js";
import type { AgentBarState } from "./agent.js";
import type { LaneBlock } from "./timeline.js";

export const TOOLS_CSS = `
.pcb-routecard { width: 300px; pointer-events: none; }
.pcb-routecard .shelf { color: var(--pcb-select); }
.pcb-routecard .hd { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; font-family: var(--pcb-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--pcb-strong); }
.pcb-routecard .hd b { font-weight: 400; }
.pcb-routecard .hd i { margin-left: auto; font-style: normal; color: var(--pcb-mute); letter-spacing: 0.04em; }
.pcb-routecard .hd .sw { width: 9px; height: 9px; border-radius: 2px; background: #c4544a; }
.pcb-routecard .row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-height: 18px; font-family: var(--pcb-mono); font-size: 10px; }
.pcb-routecard .row .k { width: 64px; flex: none; color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; }
.pcb-routecard .row .v { color: var(--pcb-strong); white-space: nowrap; }
.pcb-routecard .row .pcb-chip { height: 16px; font-size: 8.5px; padding: 0 5px; }
.pcb-routecard .row .from { flex: 1 1 60px; color: var(--pcb-mute); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pcb-routecard .row.fail .v { color: var(--pcb-fail); }
.pcb-routecard .note { margin: 6px 0 0; font-family: var(--pcb-mono); font-size: 9.5px; color: var(--pcb-mute); }
.pcb-routecard .flag { margin: 6px 0 0; font-family: var(--pcb-mono); font-size: 9.5px; letter-spacing: 0.04em; }
.pcb-routecard .flag.fail { color: var(--pcb-fail); }
.pcb-routecard .flag.warn { color: var(--pcb-warn); }
.pcb-routecard .keys { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.pcb-routecard .keys .pcb-chip { height: 16px; font-size: 8.5px; padding: 0 5px; text-transform: none; }
.pcb-srctable { display: grid; grid-template-columns: 74px 1fr auto; row-gap: 7px; column-gap: 8px; align-items: center; font-family: var(--pcb-mono); font-size: 10.5px; }
.pcb-srctable .h { color: var(--pcb-mute); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
.pcb-srctable .v { color: var(--pcb-strong); }
.pcb-srctable .pcb-chip { justify-self: end; height: 17px; font-size: 8.5px; }
.pcb-srctable .from { grid-column: 2 / 4; margin-top: -5px; color: var(--pcb-mute); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcb-toolrow { display: flex; flex-wrap: wrap; gap: 6px; }
.pcb-toolform { display: grid; grid-template-columns: 74px 1fr; gap: 8px; align-items: center; font-family: var(--pcb-mono); font-size: 10px; }
.pcb-toolform > span { color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; }
.pcb-toolform select, .pcb-toolform input[type=text] { height: 24px; background: #0f0f0f; color: var(--pcb-strong); border: 1px solid var(--pcb-rule2); border-radius: 4px; font-family: var(--pcb-mono); font-size: 10.5px; padding: 0 6px; min-width: 0; }
.pcb-check { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 11.5px; color: var(--pcb-body); cursor: pointer; }
.pcb-check input { accent-color: var(--pcb-select); }
.pcb-dxf { position: absolute; left: 76px; top: 120px; width: 330px; padding: 12px 14px; z-index: 4; }
.pcb-dxf .row1 { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.pcb-dxf b.caps { color: var(--pcb-strong); font-weight: 400; }
.pcb-dxf table { width: 100%; border-collapse: collapse; font-family: var(--pcb-mono); font-size: 10.5px; }
.pcb-dxf td { padding: 3px 0; color: var(--pcb-strong); vertical-align: top; }
.pcb-dxf td:first-child { color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; width: 96px; padding-top: 4px; }
.pcb-dxf .skip { margin-top: 8px; font-size: 11px; color: var(--pcb-body); }
.pcb-dxf .skip li { margin: 2px 0; }
`;

let cssInstalled = false;
function installCss() {
  if (cssInstalled || typeof document === "undefined") return;
  cssInstalled = true;
  const s = document.createElement("style");
  s.dataset.pcbTools = "";
  s.textContent = TOOLS_CSS;
  document.head.append(s);
}

/** The tools that draw on the board (the others are the screen's own). */
export const DRAW_TOOLS: readonly Tool[] = ["route", "via", "zone", "keepout", "outline", "rip", "line"];
const TOOL_WORDS: Partial<Record<Tool, string>> = {
  route: "route · click a pad, via or track end · F finishes · Esc drops",
  via: "via · click where it goes",
  zone: "zone · click the corners · Enter or double click closes",
  keepout: "keep-out · click the corners · Enter or double click closes",
  outline: "outline · drag a corner",
  rip: "rip-up · drag a region · locked copper stays",
  line: "silkscreen line · drag it",
};

export interface ToolsContext {
  session: EditSession;
  request?: RequestFn;
  view: () => BoardView | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  /** The person may edit now (writable, edit mode, live board). */
  enabled: boolean;
  doc: BoardDocument;
  seq: number;
  active: CopperLayer;
  copper: CopperLayer[];
  lit: readonly string[];
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  grid: number;
  /** Show an outcome (a refusal stays; a done one says what happened). */
  toast: (o: Outcome) => void;
}

export interface ToolsApi {
  input?: ToolInput;
  draftLayer: (layer: { svg: SVGSVGElement; html: HTMLDivElement } | null) => void;
  /** Keys of the active tool; true when used. */
  onKey: (e: KeyboardEvent) => boolean;
  panel: ReactNode;
  nodes: ReactNode;
  chip?: string;
  lane?: { name: string; blocks: LaneBlock[]; align?: "start" | "end" };
  bar?: AgentBarState;
  /** A kernel drag for this selection (footprints, or one track or via): true when the kernel takes it. */
  dragStart: (ids: string[]) => boolean;
  dragMove: (dx: number, dy: number) => void;
  dragEnd: (cancel: boolean, label: string) => void;
  importDxf: () => void;
  controller: ToolController;
}

const info = (label: string, message: string, ok = true): Outcome => ({ ok, status: ok ? "applied" : "error", label, message, at: Date.now() });

export function useTools(ctx: ToolsContext): ToolsApi {
  installCss();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const layer = useRef<{ svg: SVGSVGElement; html: HTMLDivElement } | null>(null);
  const viewOff = useRef<(() => void) | null>(null);
  const cursor = useRef<Pt | undefined>(undefined);
  const raf = useRef(0);
  const pendingDrag = useRef<{ dx: number; dy: number } | undefined>(undefined);
  // per-tool drawing state (nanometers)
  const poly = useRef<Pt[]>([]);
  const press = useRef<{ a: Pt; b: Pt; vertex?: number } | undefined>(undefined);
  const hotVertex = useRef<number | undefined>(undefined);
  const [zoneNet, setZoneNet] = useState<string>("");
  const [koTier, setKoTier] = useState<KeepoutTier>("no_go");
  const [koBlocks, setKoBlocks] = useState<KeepoutBlocks>({ tracks: true, vias: true, pours: true, footprints: false });
  const [koAll, setKoAll] = useState(true);
  const [ripLayer, setRipLayer] = useState(false);
  const [detach, setDetach] = useState(false);
  const [silk, setSilk] = useState<"top_silkscreen" | "bottom_silkscreen">("top_silkscreen");
  const [routeMode, setRouteMode] = useState<"walkaround" | "highlight">("walkaround");
  const [posture, setPosture] = useState<"45" | "90">("45");
  const [dxf, setDxf] = useState<{ name: string; report: DxfReport } | undefined>(undefined);
  const [widthMm, setWidthMm] = useState("");
  const [wholeNet, setWholeNet] = useState(false);
  const [neck, setNeck] = useState(true);

  const controller = useMemo(() => new ToolController({ session: ctx.session, ...(ctx.request ? { request: ctx.request } : {}), onChange: () => bump() }), [ctx.session, ctx.request]);
  useEffect(() => () => controller.dispose(), [controller]);

  // ------------------------------------------------------------------ drawing the draft layer
  const draw = useCallback(() => {
    const l = layer.current;
    const v = ctxRef.current.view();
    if (!l) return;
    if (!v) {
      l.svg.innerHTML = "";
      l.html.innerHTML = "";
      return;
    }
    const c = ctxRef.current;
    const m: ScreenMap = { toScreen: (x, y) => v.toScreen(x, y), scale: v.view.s };
    const svg: string[] = [];
    let html = "";
    const r = controller.route;
    if (r?.candidate) {
      const d = r.candidate as unknown as RouteDraft;
      const via = viaSize(c.doc);
      svg.push(routeDraftSvg(c.doc, d, m, { mode: r.mode, via }));
      const co = routeCallout(c.doc, d, { mode: r.mode, posture: r.posture, armed: r.armed, paused: r.paused });
      const a = calloutAnchor(d, m);
      if (a) {
        const w = 300;
        const h = 64 + co.rows.length * 20 + (co.note ? 16 : 0) + (co.flag ? 30 : 0);
        const S = d.points.map((q) => m.toScreen(q.x * 1e-6, q.y * 1e-6));
        const { x, y } = placeCard({ x0: Math.min(...S.map((q) => q.x)), y0: Math.min(...S.map((q) => q.y)), x1: Math.max(...S.map((q) => q.x)), y1: Math.max(...S.map((q) => q.y)) }, a, { w, h }, { left: 76, top: 132, right: v.width - 396, bottom: v.height - 180 });
        svg.push(leaderSvg(a, { x, y, w, h }, ""));
        html = `<div class="pcb-callout pcb-routecard" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px"><div class="shelf">${co.shelf.replace(/[<&>]/g, "")}</div>${routeCardHtml(co)}</div>`;
      }
    } else if (c.tool === "route" && cursor.current) {
      const p = m.toScreen(cursor.current.x * 1e-6, cursor.current.y * 1e-6);
      svg.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="none" stroke="#e6e6e6" stroke-opacity="0.6" stroke-width="1"/>`);
    }
    const dr = controller.drag;
    if (dr?.candidate) {
      svg.push(dragNotesSvg(c.doc, dr.candidate, m));
      // what moves with it: a quiet tag above the dragged objects (their place in the preview)
      const b = boxOfIds(c.session.snapshot().doc, dr.ids);
      if (b) {
        const follow = dr.candidate.puts.filter((x) => x.kind === "track" || x.kind === "via").length;
        const tag = dr.kind === "footprint" ? `${follow} track${follow === 1 ? "" : "s"} follow${dr.candidate.detached.length ? ` · ${dr.candidate.detached.length} stay` : ""}` : `neighbors follow · ${follow} segment${follow === 1 ? "" : "s"}${dr.candidate.ok ? "" : " · stopped at the last legal spot"}`;
        const p = m.toScreen(b[0], b[3]);
        const tw = tag.length * 6 + 16;
        svg.push(`<g transform="translate(${(p.x - tw - 12).toFixed(1)},${(p.y + 12).toFixed(1)})"><rect x="0" y="-12" width="${tw.toFixed(0)}" height="16" rx="3" fill="#161616" stroke="#4a4a4a"/><text x="8" y="0" fill="#e6e6e6" font-family="Kode Mono, ui-monospace, monospace" font-size="9.5" letter-spacing="0.8">${tag.toUpperCase()}</text></g>`);
      }
    }
    if ((c.tool === "zone" || c.tool === "keepout") && (poly.current.length || cursor.current)) {
      const isZone = c.tool === "zone";
      svg.push(polygonSvg(poly.current, cursor.current, m, { color: isZone ? "#e6e6e6" : koTier === "no_go" ? FAIL : WARN, label: isZone ? `zone · ${zoneNet || "no net"} · ${c.active}` : `keep-out · ${koTier === "no_go" ? "no-go" : "policy"}`, hatch: !isZone }));
    }
    if (c.tool === "rip" && press.current) {
      const pr = press.current;
      svg.push(polygonSvg(rectContour(pr.a, pr.b), undefined, m, { color: WARN, label: "rip-up region" }));
    }
    if (c.tool === "line" && press.current) svg.push(lineSvg(press.current.a, press.current.b, m, 150_000));
    if (c.tool === "outline") {
      const vs = outlineVertices(c.doc);
      if (vs) svg.push(outlineHandlesSvg(vs, m, hotVertex.current, press.current?.vertex !== undefined ? { index: press.current.vertex, ...press.current.b } : undefined));
    }
    if (c.tool === "via" && cursor.current) {
      const p = m.toScreen(cursor.current.x * 1e-6, cursor.current.y * 1e-6);
      const rr = Math.max(3, (viaSize(c.doc).outer * 1e-6 * m.scale) / 2);
      svg.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="#a7a7a2" fill-opacity="0.35" stroke="${SELECT}" stroke-width="1.25" stroke-dasharray="3 2"/>`);
    }
    l.svg.innerHTML = svg.join("");
    if (l.html.innerHTML !== html) l.html.innerHTML = html;
  }, [controller, koTier, zoneNet]);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const draftLayer = useCallback((l: { svg: SVGSVGElement; html: HTMLDivElement } | null) => {
    layer.current = l;
    viewOff.current?.();
    viewOff.current = null;
    const v = ctxRef.current.view();
    if (l && v) viewOff.current = v.onChange(() => drawRef.current());
  }, []);
  // redraw after every render (state changed) and when the tool changes
  useEffect(() => draw());

  // leaving a tool ends what it was doing
  useEffect(() => {
    if (ctx.tool !== "route") controller.cancelRoute();
    poly.current = [];
    press.current = undefined;
    hotVertex.current = undefined;
    cursor.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.tool]);
  useEffect(() => {
    if (!ctx.enabled) controller.cancelRoute();
  }, [ctx.enabled, controller]);
  // the zone's net defaults to the lit net, else GND when the board has it
  useEffect(() => {
    if (zoneNet) return;
    const n = ctx.lit[0] ?? (ctx.doc.nets.has("GND") ? "GND" : "");
    if (n) setZoneNet(n);
  }, [ctx.lit, ctx.doc, zoneNet]);

  const snap = (p: { x: number; y: number }): Pt => {
    const g = ctxRef.current.grid;
    const x = p.x * 1e6;
    const y = p.y * 1e6;
    if (!g) return { x: Math.round(x), y: Math.round(y) };
    const s = mm(g);
    return { x: Math.round(x / s) * s, y: Math.round(y / s) * s };
  };

  const commit = async (label: string, ops: PageOpCall[], after?: (o: Outcome) => string | undefined): Promise<Outcome | undefined> => {
    if (!ops.length) return undefined;
    const o = await ctxRef.current.session.commit(label, ops);
    const extra = o.ok && after ? after(o) : undefined;
    ctxRef.current.toast(extra ? { ...o, message: extra } : o);
    return o;
  };

  // ------------------------------------------------------------------ route
  const moveHead = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (controller.route && cursor.current) controller.moveRoute(cursor.current);
      drawRef.current();
    });
  };
  const finish = async () => {
    const out = await controller.finishRoute();
    if ("armed" in out) return;
    if ("error" in out) return ctxRef.current.toast(info("finish the route", out.error, false));
    ctxRef.current.toast(controller.note ? { ...out, message: `${out.message} · ${controller.note}` } : out);
    controller.note = undefined;
    drawRef.current();
  };
  const startRoute = (p: ToolPointer) => {
    const c = ctxRef.current;
    const hits = p.pick();
    const hit = hits.find((h) => (h.kind === "pad" || h.kind === "via" || h.kind === "track") && !h.interior);
    const from = routeStartFor(c.doc, hit, { x: p.x * 1e6, y: p.y * 1e6 });
    if (!from) return c.toast(info("route", "start on a pad, a via or a track end of a net", false));
    const r = controller.startRoute(from, { layer: c.active, mode: routeMode, posture });
    if ("error" in r) return c.toast(info("route", r.error, false));
    cursor.current = snap(p);
    controller.moveRoute(cursor.current);
    drawRef.current();
  };

  // ------------------------------------------------------------------ the tool's pointer
  const input: ToolInput | undefined = (() => {
    if (!ctx.enabled || !DRAW_TOOLS.includes(ctx.tool)) return undefined;
    const tool = ctx.tool;
    return {
      cursor: tool === "outline" ? (hotVertex.current !== undefined ? "move" : "default") : "crosshair",
      down(p) {
        const c = ctxRef.current;
        const at = snap(p);
        if (tool === "route") {
          if (!controller.route) startRoute(p);
          else {
            cursor.current = at;
            const cand = controller.clickRoute(at);
            // a click on the target copper finishes the route
            if (cand?.reached && cand.ok) void finish();
            drawRef.current();
          }
          return true;
        }
        if (tool === "via") {
          const hit = p.pick().find((h) => !h.interior && c.view()?.scene?.objects.get(h.id)?.netName);
          const net = hit ? c.view()?.scene?.objects.get(hit.id)?.netName : c.lit[0];
          void commit(`add a via${net ? ` on ${net}` : ""} by hand`, [viaOp(at, { ...(net ? { net } : {}), ...viaSize(c.doc) })]);
          return true;
        }
        if (tool === "zone" || tool === "keepout") {
          poly.current = [...poly.current, at];
          drawRef.current();
          return true;
        }
        if (tool === "outline") {
          const v = c.view();
          const tol = v ? (8 / v.view.s) * 1e6 : 500_000;
          const i = nearestVertex(outlineVertices(c.doc), { x: p.x * 1e6, y: p.y * 1e6 }, tol);
          if (i === undefined) return false;
          press.current = { a: at, b: at, vertex: i };
          drawRef.current();
          return true;
        }
        press.current = { a: at, b: at };
        drawRef.current();
        return true;
      },
      move(p, pressed) {
        const c = ctxRef.current;
        const at = snap(p);
        cursor.current = at;
        if (tool === "route") {
          if (controller.route) moveHead();
          else drawRef.current();
          return;
        }
        if (pressed && press.current) press.current.b = at;
        if (tool === "outline" && !pressed) {
          const v = c.view();
          const tol = v ? (8 / v.view.s) * 1e6 : 500_000;
          const h = nearestVertex(outlineVertices(c.doc), { x: p.x * 1e6, y: p.y * 1e6 }, tol);
          if (h !== hotVertex.current) {
            hotVertex.current = h;
            bump();
          }
        }
        drawRef.current();
      },
      up() {
        const c = ctxRef.current;
        const pr = press.current;
        press.current = undefined;
        if (!pr) return;
        if (tool === "rip") {
          if (Math.hypot(pr.b.x - pr.a.x, pr.b.y - pr.a.y) < 1000) return drawRef.current();
          const op = ripOp({ region: rectContour(pr.a, pr.b), ...(ripLayer ? { layers: [c.active] } : {}) });
          if (op) void commit("rip up a region by hand", [op], (o) => ripSummary(reportOf(o.reply, "copper.rip")));
        } else if (tool === "line") {
          const op = lineOp(pr.a, pr.b, { layer: silk });
          if (op) void commit("draw a silkscreen line by hand", [op]);
        } else if (tool === "outline" && pr.vertex !== undefined) {
          if (pr.a.x !== pr.b.x || pr.a.y !== pr.b.y) {
            const v = outlineVertices(c.doc)![pr.vertex];
            const op = moveVertexOp(c.doc, pr.vertex, { x: v.x + (pr.b.x - pr.a.x), y: v.y + (pr.b.y - pr.a.y) }, detach);
            if (op) void commit("move an outline corner by hand", [op]);
          }
        }
        drawRef.current();
      },
      double() {
        if (tool === "route") {
          if (controller.route) void finish();
          return true;
        }
        if (tool === "zone" || tool === "keepout") {
          closePoly();
          return true;
        }
        return false;
      },
      leave() {
        if (tool !== "route" || !controller.route) cursor.current = undefined;
        drawRef.current();
      },
    };
  })();

  const closePoly = () => {
    const c = ctxRef.current;
    const pts = poly.current;
    // a double click adds the same corner twice: the contour drops repeats
    if (!contourOf(pts)) {
      c.toast(info(c.tool, "a zone or keep-out needs three corners that enclose an area", false));
      return;
    }
    const op =
      c.tool === "zone"
        ? zoneOp(pts, { ...(zoneNet ? { net: zoneNet } : {}), layer: c.active })
        : keepoutOp(pts, { layers: koAll ? [...c.copper] : [c.active], tier: koTier, blocks: koBlocks });
    poly.current = [];
    if (!op) return c.toast(info(c.tool, "choose at least one thing the keep-out blocks", false));
    void commit(c.tool === "zone" ? `add a ${zoneNet || "plain"} zone by hand` : `add a ${koTier === "no_go" ? "no-go" : "policy"} keep-out by hand`, [op]);
    drawRef.current();
  };

  // ------------------------------------------------------------------ keys
  const onKey = (e: KeyboardEvent): boolean => {
    const c = ctxRef.current;
    if (!c.enabled) return false;
    const k = e.key;
    if ((k === "x" || k === "X") && !e.ctrlKey && !e.metaKey && !e.altKey && !controller.route) {
      if (!hasOperation("track.route")) return false;
      c.setTool(c.tool === "route" ? "select" : "route");
      return true;
    }
    if (c.tool === "route") {
      if ((e.ctrlKey || e.metaKey) && (k === "m" || k === "M")) {
        const m = routeMode === "walkaround" ? "highlight" : "walkaround";
        setRouteMode(m);
        controller.setRouteMode(m, cursor.current);
        drawRef.current();
        return true;
      }
      if (k === "/") {
        setPosture((p) => (p === "45" ? "90" : "45"));
        controller.flipPosture(cursor.current);
        drawRef.current();
        return true;
      }
      const r = controller.route;
      if (!r) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      switch (k) {
        case "Escape":
          controller.cancelRoute();
          drawRef.current();
          return true;
        case "Backspace":
          controller.backRoute();
          drawRef.current();
          return true;
        case "v":
        case "V": {
          const res = controller.viaRoute(undefined, cursor.current);
          if (!res.ok) c.toast(info("via", res.reason ?? "no legal spot for a via", false));
          drawRef.current();
          return true;
        }
        case "w":
        case "W": {
          const now = r.candidate?.width.value ?? 250_000;
          controller.setRouteWidth(stepWidth(now, e.shiftKey ? -1 : 1), cursor.current);
          drawRef.current();
          return true;
        }
        case "f":
        case "F":
        case "Enter":
          void finish();
          return true;
        default:
          return false;
      }
    }
    if (c.tool === "zone" || c.tool === "keepout") {
      if (k === "Enter") {
        closePoly();
        return true;
      }
      if (k === "Backspace" && poly.current.length) {
        poly.current = poly.current.slice(0, -1);
        drawRef.current();
        return true;
      }
      if (k === "Escape" && poly.current.length) {
        poly.current = [];
        drawRef.current();
        return true;
      }
    }
    return false;
  };

  // ------------------------------------------------------------------ drags through the kernel
  const dragStart = (ids: string[]): boolean => {
    const doc = ctxRef.current.session.confirmed().doc;
    const rs = ids.map((id) => doc.records.get(id));
    if (!rs.length || rs.some((r) => !r)) return false;
    let ok = false;
    if (rs.every((r) => r!.kind === "footprint")) ok = controller.startDrag({ kind: "footprint", ids });
    else if (rs.length === 1 && (rs[0]!.kind === "via" || (rs[0]!.kind === "track" && !rs[0]!.sweep))) ok = controller.startDrag({ kind: "track", id: rs[0]!.id });
    return ok;
  };
  const dragMove = (dx: number, dy: number) => {
    pendingDrag.current = { dx, dy };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const d = pendingDrag.current;
      if (!d || !controller.drag) return;
      const last = controller.drag.candidate;
      if (!last || last.dx !== d.dx || last.dy !== d.dy) controller.moveDrag(d.dx, d.dy);
      ctxRef.current.view()?.flush();
      drawRef.current();
    });
  };
  const dragEnd = (cancel: boolean, label: string) => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    // the release's own position counts
    const d = pendingDrag.current;
    pendingDrag.current = undefined;
    if (!cancel && d && controller.drag && (controller.drag.candidate?.dx !== d.dx || controller.drag.candidate?.dy !== d.dy)) controller.moveDrag(d.dx, d.dy);
    const detached = controller.drag?.candidate?.detached.length ?? 0;
    void controller.endDrag(cancel, label).then((o) => {
      if (o) ctxRef.current.toast(o.ok && detached ? { ...o, message: `${o.message} · ${detached} track${detached === 1 ? "" : "s"} stayed (would short)` } : o);
      drawRef.current();
    });
    drawRef.current();
  };

  // ------------------------------------------------------------------ DXF
  const importDxf = () => {
    if (typeof document === "undefined") return;
    const el = document.createElement("input");
    el.type = "file";
    el.accept = ".dxf";
    el.onchange = () => {
      const f = el.files?.[0];
      if (!f) return;
      void f.text().then((text) => applyDxf(f.name, text));
    };
    el.click();
  };
  const applyDxf = async (name: string, text: string) => {
    const o = await ctxRef.current.session.commit("set the outline from DXF", [{ op: "outline.import_dxf", dxf: text }]);
    const rep = dxfReport(reportOf(o.reply, "outline.import_dxf"));
    if (o.ok && rep) setDxf({ name, report: rep });
    else ctxRef.current.toast(o);
  };
  // the bench and tests reach the import without a file dialog
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __pcbTools?: unknown }).__pcbTools = { controller, applyDxf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  // ------------------------------------------------------------------ panel, lane, bar, nodes
  const r = controller.route;
  const lane = r
    ? { name: "Drafting", align: "end" as const, blocks: [{ key: "draft", label: `${r.net} · uncommitted`, seq: ctx.seq + 1, tone: "draft" as const, title: `${r.candidate ? `${(r.candidate.length.total * 1e-6).toFixed(2)} mm · ` : ""}nothing is written until you finish (F) · Esc drops the draft` }] }
    : undefined;
  const bar: AgentBarState | undefined = r ? { who: "Agent", title: `You are routing ${r.net}`, sub: r.paused ? "agent paused while you draw · resumes on finish" : "nothing is written until you finish (F) · Esc drops the draft", buttons: [{ label: "Finish", key: "F", onClick: () => void finish() }, { label: "Drop", key: "Esc", onClick: () => controller.cancelRoute() }] } : undefined;
  const chip = ctx.enabled && TOOL_WORDS[ctx.tool] ? `${TOOL_WORDS[ctx.tool]}${ctx.tool === "route" ? ` · ${routeMode === "highlight" ? "highlight collisions" : "walk around"} · ${posture}°` : ""}` : undefined;

  const panel = ctx.enabled ? (
    <ToolPanel
      ctx={ctx}
      controller={controller}
      routeMode={routeMode}
      onRouteMode={(m) => {
        setRouteMode(m);
        controller.setRouteMode(m, cursor.current);
      }}
      posture={posture}
      zoneNet={zoneNet}
      onZoneNet={setZoneNet}
      koTier={koTier}
      onKoTier={setKoTier}
      koBlocks={koBlocks}
      onKoBlocks={setKoBlocks}
      koAll={koAll}
      onKoAll={setKoAll}
      ripLayer={ripLayer}
      onRipLayer={setRipLayer}
      detach={detach}
      onDetach={setDetach}
      silk={silk}
      onSilk={setSilk}
      widthMm={widthMm}
      onWidthMm={setWidthMm}
      wholeNet={wholeNet}
      onWholeNet={setWholeNet}
      neck={neck}
      onNeck={setNeck}
      onCommit={(label, ops, after) => void commit(label, ops, after)}
      onDxf={importDxf}
      onPause={(on) => {
        controller.pauseAgents = on;
        bump();
      }}
    />
  ) : null;

  const nodes = dxf ? <DxfCard name={dxf.name} report={dxf.report} onClose={() => setDxf(undefined)} /> : null;

  return { ...(input ? { input } : {}), draftLayer, onKey, panel, nodes, ...(chip ? { chip } : {}), ...(lane ? { lane } : {}), ...(bar ? { bar } : {}), dragStart, dragMove, dragEnd, importDxf, controller };
}

// ------------------------------------------------------------------ the Inspect tab's tool section

interface ToolPanelProps {
  ctx: ToolsContext;
  controller: ToolController;
  routeMode: "walkaround" | "highlight";
  onRouteMode: (m: "walkaround" | "highlight") => void;
  posture: "45" | "90";
  zoneNet: string;
  onZoneNet: (n: string) => void;
  koTier: KeepoutTier;
  onKoTier: (t: KeepoutTier) => void;
  koBlocks: KeepoutBlocks;
  onKoBlocks: (b: KeepoutBlocks) => void;
  koAll: boolean;
  onKoAll: (v: boolean) => void;
  ripLayer: boolean;
  onRipLayer: (v: boolean) => void;
  detach: boolean;
  onDetach: (v: boolean) => void;
  silk: "top_silkscreen" | "bottom_silkscreen";
  onSilk: (v: "top_silkscreen" | "bottom_silkscreen") => void;
  widthMm: string;
  onWidthMm: (v: string) => void;
  wholeNet: boolean;
  onWholeNet: (v: boolean) => void;
  neck: boolean;
  onNeck: (v: boolean) => void;
  onCommit: (label: string, ops: PageOpCall[], after?: (o: Outcome) => string | undefined) => void;
  onDxf: () => void;
  onPause: (on: boolean) => void;
}

function Seg<T extends string>({ value, options, onPick }: { value: T; options: { v: T; label: string; disabled?: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="pcb-presets">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} disabled={!!o.disabled} title={o.disabled} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="pcb-check">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function ToolPanel(p: ToolPanelProps) {
  const { ctx } = p;
  const doc = ctx.doc;
  const r = p.controller.route;
  const nets = useMemo(() => [...doc.nets.keys()].sort(), [doc]);
  const tracks = ctx.selection.map((id) => doc.records.get(id)).filter((x) => x?.kind === "track");
  const copperSel = ctx.selection.map((id) => doc.records.get(id)).filter((x) => x?.kind === "track" || x?.kind === "via");
  const selNet = copperSel.map((x) => (x as { net?: string }).net).find(Boolean);
  const out: ReactNode[] = [];
  if (ctx.tool === "route") {
    const k = p.controller.kernel();
    const net = r?.net ?? ctx.lit[0];
    const width = r?.candidate?.width ?? (net ? { ...k.world.rules.width(net, ctx.active) } : undefined);
    const cl = r?.candidate?.clearance ?? (net ? { ...k.world.rules.clearance(net, undefined, ctx.active, "track") } : undefined);
    const via = k.world.rules.via();
    const floor = floorClearance(doc);
    const rows: { label: string; value: string; by: string; from?: string }[] = [];
    if (cl) {
      const s = valueSource(doc, cl as never);
      rows.push({ label: "Clearance", value: mmText(cl.value), by: s.by, from: s.from });
    }
    if (width) {
      const s = valueSource(doc, width as never);
      rows.push({ label: "Width", value: mmText(width.value), by: s.by, from: s.from });
    }
    rows.push({ label: "Via", value: `${mmText(via.outer)} / ${mmText(via.hole)}`, by: "rules or default" });
    if (floor !== undefined) rows.push({ label: "Fab floor", value: mmText(floor), by: "fab floor" });
    out.push(
      <div className="pcb-sec" key="route">
        <h4>
          <span>Routing{net ? ` · ${net}` : ""}</span>
          <i>{r ? "live" : "click a pad to start"}</i>
        </h4>
        {r && (
          <dl className="pcb-kv">
            <dt>Layer</dt>
            <dd>{r.candidate?.layer ?? ctx.active}</dd>
            <dt>Length</dt>
            <dd>{r.candidate ? `${(r.candidate.length.total * 1e-6).toFixed(2)} mm` : "—"}</dd>
            <dt>Step</dt>
            <dd>{r.candidate ? `${r.candidate.timing.ms} ms${r.candidate.timing.budgetHit ? " · budget hit" : ""}` : "—"}</dd>
          </dl>
        )}
      </div>,
      <div className="pcb-sec" key="src">
        <h4>
          <span>Where each value comes from</span>
          <i>four tiers</i>
        </h4>
        {rows.length ? (
          <div className="pcb-srctable">
            {rows.map((x) => [
              <span key={`${x.label}h`} className="h">
                {x.label}
              </span>,
              <span key={`${x.label}v`} className="v">
                {x.value}
              </span>,
              <span key={`${x.label}c`} className="pcb-chip">
                {x.by}
              </span>,
              x.from ? (
                <span key={`${x.label}f`} className="from" title={x.from}>
                  {x.from}
                </span>
              ) : null,
            ])}
          </div>
        ) : (
          <p className="pcb-p">Light a net or start on a pad to see its values.</p>
        )}
        <p className="pcb-p">The strictest tier that applies sets each value. The canvas names it only for the segment you are drawing.</p>
      </div>,
      <div className="pcb-sec" key="mode">
        <h4>
          <span>Mode</span>
          <i>Ctrl M</i>
        </h4>
        <Seg
          value={p.routeMode}
          options={[
            { v: "highlight", label: "Highlight" },
            { v: "walkaround", label: "Walk around" },
            { v: "shove" as "walkaround", label: "Shove", disabled: "Shove is not built yet (the kernel's extension point)" },
          ]}
          onPick={p.onRouteMode}
        />
        {p.routeMode === "highlight" && <div className="pcb-note fail">Highlight draws straight through other copper and lists the collisions. Committing it writes those violations; F asks twice.</div>}
        <Check on={p.controller.pauseAgents} label="Pause agents while I draw" onChange={p.onPause} />
        <p className="pcb-p">Posture {p.posture}° (/) · W and Shift+W step the width · V places a via · Backspace backs up.</p>
      </div>,
    );
  } else if (ctx.tool === "via") {
    const v = viaSize(doc);
    out.push(
      <div className="pcb-sec" key="via">
        <h4>
          <span>Via</span>
          <i>
            {mmText(v.outer)} / {mmText(v.hole)} mm
          </i>
        </h4>
        <p className="pcb-p">Click where it goes. It takes the net of the copper under it, else the lit net{ctx.lit[0] ? ` (${ctx.lit[0]})` : ""}, else none. A person's via is locked.</p>
      </div>,
    );
  } else if (ctx.tool === "zone") {
    out.push(
      <div className="pcb-sec" key="zone">
        <h4>
          <span>Zone</span>
          <i>on {ctx.active}</i>
        </h4>
        <div className="pcb-toolform">
          <span>Net</span>
          <select value={p.zoneNet} onChange={(e) => p.onZoneNet(e.target.value)}>
            <option value="">no net</option>
            {nets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <p className="pcb-p">Click the corners on the active layer; Enter or a double click closes it. Backspace removes the last corner.</p>
      </div>,
    );
  } else if (ctx.tool === "keepout") {
    out.push(
      <div className="pcb-sec" key="ko">
        <h4>
          <span>Keep-out</span>
          <i>{p.koAll ? "all copper" : `on ${ctx.active}`}</i>
        </h4>
        <Seg
          value={p.koTier}
          options={[
            { v: "no_go", label: "No-go" },
            { v: "policy", label: "Policy" },
          ]}
          onPick={p.onKoTier}
        />
        {(["tracks", "vias", "pours", "footprints"] as const).map((b) => (
          <Check key={b} on={p.koBlocks[b]} label={`Blocks ${b}`} onChange={(v) => p.onKoBlocks({ ...p.koBlocks, [b]: v })} />
        ))}
        <Check on={p.koAll} label="Every copper layer" onChange={p.onKoAll} />
        <p className="pcb-p">No-go areas are walls for the router and the route tool; policy areas are reported by the checks.</p>
      </div>,
    );
  } else if (ctx.tool === "rip") {
    out.push(
      <div className="pcb-sec" key="rip">
        <h4>
          <span>Rip-up</span>
          <i>locked copper stays</i>
        </h4>
        <Check on={p.ripLayer} label={`Only the active layer (${ctx.active})`} onChange={p.onRipLayer} />
        <p className="pcb-p">Drag a region: unlocked tracks and vias touching it are removed in one change; locked ones are listed, never removed.</p>
      </div>,
    );
  } else if (ctx.tool === "outline") {
    const cad = outlineFromCad(doc);
    out.push(
      <div className="pcb-sec" key="outline">
        <h4>
          <span>Board outline</span>
          <i>{outlineVertices(doc)?.length ?? 0} corners</i>
        </h4>
        <p className="pcb-p">Drag a corner; the outline is set as one change.</p>
        {cad && <Check on={p.detach} label={`Take the outline over from CAD (${cad})`} onChange={p.onDetach} />}
        <div className="acts">
          <button className="pcb-btn" onClick={p.onDxf} disabled={!hasOperation("outline.import_dxf")}>
            Outline from DXF
          </button>
        </div>
      </div>,
    );
  } else if (ctx.tool === "line") {
    out.push(
      <div className="pcb-sec" key="line">
        <h4>
          <span>Silkscreen line</span>
          <i>0.15 mm</i>
        </h4>
        <Seg
          value={p.silk}
          options={[
            { v: "top_silkscreen", label: "Top silk" },
            { v: "bottom_silkscreen", label: "Bottom silk" },
          ]}
          onPick={p.onSilk}
        />
        <p className="pcb-p">Drag the line on the board.</p>
      </div>,
    );
  }
  // the selection's copper: width and rip-up
  if (ctx.tool === "select" && copperSel.length) {
    const w = Number(p.widthMm.replace(",", "."));
    const target = p.wholeNet && selNet ? { net: selNet } : { ids: tracks.map((t) => t!.id) };
    const ops = widthOps(target, w, p.neck);
    const rip = ripSelectionOps(doc, ctx.selection);
    out.push(
      <div className="pcb-sec" key="copper">
        <h4>
          <span>Copper</span>
          <i>
            {tracks.length} track{tracks.length === 1 ? "" : "s"}
            {selNet ? ` · ${selNet}` : ""}
          </i>
        </h4>
        {tracks.length > 0 && hasOperation("track.set_width") && (
          <>
            <div className="pcb-toolform">
              <span>Width mm</span>
              <input type="text" inputMode="decimal" placeholder={mmText((tracks[0] as { width: number }).width)} value={p.widthMm} onChange={(e) => p.onWidthMm(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            {selNet && <Check on={p.wholeNet} label={`Every track of ${selNet}`} onChange={p.onWholeNet} />}
            <Check on={p.neck} label="Keep a neck at narrow pads" onChange={p.onNeck} />
          </>
        )}
        <div className="acts" style={{ marginTop: 10 }}>
          {tracks.length > 0 && hasOperation("track.set_width") && (
            <button className="pcb-btn" disabled={!ops.length} onClick={() => p.onCommit(`set ${"net" in target ? target.net : "track"} width by hand`, ops, (o) => { const rep = reportOf(o.reply, "track.set_width"); const necked = (rep?.necked as unknown[] | undefined)?.length ?? 0; const locked = (rep?.skippedLocked as unknown[] | undefined)?.length ?? 0; return `width ${w} mm${necked ? ` · ${necked} necked at pads` : ""}${locked ? ` · ${locked} locked kept` : ""}`; })}>
              Set width
            </button>
          )}
          <button className="pcb-btn" disabled={!rip.ops.length} title={rip.skippedLocked.length ? `${rip.skippedLocked.length} locked: kept` : "Remove the selected unlocked tracks and vias"} onClick={() => p.onCommit("rip up the selection by hand", rip.ops, () => ripSummary(undefined, rip))}>
            Rip up selection{rip.skippedLocked.length ? ` · ${rip.skippedLocked.length} locked` : ""}
          </button>
          {selNet && hasOperation("copper.rip") && (
            <button className="pcb-btn" onClick={() => p.onCommit(`rip up ${selNet} by hand`, [ripOp({ nets: [selNet] })!], (o) => ripSummary(reportOf(o.reply, "copper.rip")))}>
              Rip up {selNet}
            </button>
          )}
        </div>
      </div>,
    );
  }
  if (ctx.tool === "select") {
    out.push(
      <div className="pcb-sec" key="tools">
        <h4>
          <span>Board tools</span>
          <i>each is one change</i>
        </h4>
        <div className="pcb-toolrow">
          {hasOperation("outline.set") && (
            <button className="pcb-btn" onClick={() => ctx.setTool("outline")}>
              Outline
            </button>
          )}
          {hasOperation("copper.rip") && (
            <button className="pcb-btn" onClick={() => ctx.setTool("rip")}>
              Rip region
            </button>
          )}
          {hasOperation("graphic.add") && (
            <button className="pcb-btn" onClick={() => ctx.setTool("line")}>
              Silk line
            </button>
          )}
          {hasOperation("outline.import_dxf") && (
            <button className="pcb-btn" onClick={p.onDxf}>
              DXF
            </button>
          )}
        </div>
      </div>,
    );
  }
  return <>{out}</>;
}

/** outline.import_dxf's report: entities, loops, the outline, cutouts, and what was skipped with reasons. */
export function DxfCard({ name, report, onClose }: { name: string; report: DxfReport; onClose: () => void }) {
  return (
    <div className="pcb-float pcb-dxf" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row1">
        <b className="caps">Outline from DXF · {name}</b>
        <button className="pcb-btn ghost" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <table>
        <tbody>
          <tr>
            <td>Entities</td>
            <td>{report.entities} read</td>
          </tr>
          <tr>
            <td>Loops</td>
            <td>
              {report.loops} closed{report.open ? ` · ${report.open} open` : ""}
            </td>
          </tr>
          <tr>
            <td>Outline</td>
            <td>{report.outline ? `${report.outline.vertices} corners · ${report.outline.areaMm2} mm²` : "none"}</td>
          </tr>
          <tr>
            <td>Cutouts</td>
            <td>{report.cutouts}</td>
          </tr>
          <tr>
            <td>Units</td>
            <td>{report.units}</td>
          </tr>
        </tbody>
      </table>
      {report.skipped.length > 0 ? (
        <ul className="skip">
          {report.skipped.map((s) => (
            <li key={`${s.type}${s.reason}`}>
              Skipped {s.count} {s.type}: {s.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pcb-p">Nothing skipped.</p>
      )}
      <p className="pcb-p">One change: undo (Ctrl+Z) puts the old outline back.</p>
    </div>
  );
}

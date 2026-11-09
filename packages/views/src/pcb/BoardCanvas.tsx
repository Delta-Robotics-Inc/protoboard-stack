/**
 * The board canvas of the layout screen: the WebGL drawing (BoardView) plus an SVG overlay for the origin mark,
 * finding markers, the box-select rectangle and the measure line, and the one open callout. Pan with the middle
 * or right button or Space and drag; the wheel zooms about the pointer; a click picks (again at the same spot
 * cycles through what is under it); a drag from empty space box-selects (left to right: wholly inside; right to
 * left: touching); a double click lights the net under the pointer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { BoardView } from "./boardview.js";
import { markerKind, markerSvg, originSvg } from "./markers.js";
import type { Hit } from "./pick.js";
import type { PcbFinding } from "./types.js";
import { panBy, zoomAbout, type Insets } from "./view.js";

export type Tool = "select" | "measure";

export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardCanvasProps {
  onReady: (view: BoardView) => void;
  tool: Tool;
  findings: readonly PcbFinding[];
  /** The finding whose callout is open (from the Checks tab), if any. */
  activeFinding?: string;
  insets: Insets;
  onPick: (hits: Hit[], index: number, additive: boolean) => void;
  onBoxSelect: (ids: string[], additive: boolean) => void;
  onHover: (hit: Hit | undefined) => void;
  onCursor: (p: { x: number; y: number } | undefined) => void;
  onNet: (net: string | undefined) => void;
  onFinding: (id: string) => void;
  /** The selection callout, placed beside `anchor` (the selection's box on screen). */
  callout?: (anchor: CanvasRect) => ReactNode;
  calloutFor?: string;
  /** The title written on the callout's shelf. */
  calloutTitle?: string;
  /** Show the origin mark (board center). */
  origin?: boolean;
}

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "press"; x0: number; y0: number; x: number; y: number; moved: boolean; shift: boolean }
  | { kind: "measure"; x0: number; y0: number; x: number; y: number };

export function BoardCanvas(props: BoardCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const lastClick = useRef<{ x: number; y: number; ids: string; index: number } | null>(null);
  const hoverFrame = useRef(0);
  const [, setTick] = useState(0);
  const [box, setBox] = useState<CanvasRect | null>(null);
  const [measure, setMeasure] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [hoverFinding, setHoverFinding] = useState<string | undefined>(undefined);
  const props_ = useRef(props);
  props_.current = props;

  useLayoutEffect(() => {
    const c = canvas.current!;
    const v = new BoardView(c);
    viewRef.current = v;
    const off = v.onChange(() => setTick((t) => (t + 1) % 1_000_000));
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect();
      v.resize(r.width, r.height);
    });
    ro.observe(host.current!);
    const r = host.current!.getBoundingClientRect();
    v.resize(r.width, r.height);
    props_.current.onReady(v);
    return () => {
      ro.disconnect();
      off();
      v.dispose();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // the measure line goes when the tool changes
  useEffect(() => setMeasure(null), [props.tool]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: RPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    host.current!.setPointerCapture(e.pointerId);
    host.current!.focus({ preventScroll: true });
    const p = local(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space.current)) {
      drag.current = { kind: "pan", x: p.x, y: p.y };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (props.tool === "measure") {
      drag.current = { kind: "measure", x0: p.x, y0: p.y, x: p.x, y: p.y };
      setMeasure({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      return;
    }
    drag.current = { kind: "press", x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const p = local(e);
    const w = v.toWorld(p.x, p.y);
    props.onCursor(w);
    const d = drag.current;
    if (d?.kind === "pan") {
      v.setView(panBy(v.view, p.x - d.x, p.y - d.y));
      d.x = p.x;
      d.y = p.y;
      return;
    }
    if (d?.kind === "measure") {
      d.x = p.x;
      d.y = p.y;
      setMeasure({ x0: d.x0, y0: d.y0, x: p.x, y: p.y });
      return;
    }
    if (d?.kind === "press") {
      d.x = p.x;
      d.y = p.y;
      if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > 4) d.moved = true;
      if (d.moved) setBox({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
      return;
    }
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const hits = viewRef.current?.pickScreen(p.x, p.y) ?? [];
      const top = hits[0];
      // a zone's or keep-out's inside does not light up as the pointer passes: only its outline does
      props_.current.onHover(top && !top.interior ? top : undefined);
    });
  };

  const onPointerUp = (e: RPointerEvent) => {
    const v = viewRef.current;
    const d = drag.current;
    drag.current = null;
    if (!v || !d) return;
    if (d.kind === "press") {
      if (d.moved) {
        setBox(null);
        props.onBoxSelect(v.pickScreenBox(d.x0, d.y0, d.x, d.y), d.shift);
        return;
      }
      const hits = v.pickScreen(d.x0, d.y0);
      const ids = hits.map((h) => h.id).join("|");
      const last = lastClick.current;
      const again = last && Math.hypot(last.x - d.x0, last.y - d.y0) < 3 && last.ids === ids && hits.length > 1;
      const index = again ? (last!.index + 1) % hits.length : 0;
      lastClick.current = { x: d.x0, y: d.y0, ids, index };
      props.onPick(hits, index, d.shift);
    }
    if (e.button === 0 && d.kind === "measure") {
      /* the line stays until the next press or Esc */
    }
  };

  const onDoubleClick = (e: RMouseEvent) => {
    const v = viewRef.current;
    if (!v || props.tool !== "select") return;
    const p = local(e);
    const hit = v.pickScreen(p.x, p.y).find((h) => v.scene?.objects.get(h.id)?.netName);
    props.onNet(hit ? v.scene!.objects.get(hit.id)!.netName : undefined);
  };

  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      const v = viewRef.current;
      if (!v) return;
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      if (e.shiftKey && !e.ctrlKey) {
        v.setView(panBy(v.view, -e.deltaY * unit, 0));
        return;
      }
      v.setView(zoomAbout(v.view, v.width, v.height, p.x, p.y, Math.exp(-e.deltaY * unit * 0.0015)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const v = viewRef.current;
  const overlay: string[] = [];
  let calloutNode: ReactNode = null;
  let findingCard: ReactNode = null;
  if (v?.scene) {
    if (props.origin !== false) {
      const o = v.toScreen(0, 0);
      overlay.push(`<g transform="translate(${o.x.toFixed(1)},${o.y.toFixed(1)})">${originSvg()}</g>`);
    }
    // the selection callout: a leader up from the selection to a shelf above the board, the card at the shelf's end
    // in the clear canvas beside the board (the concept's callout: terminal dot, leg, shelf, title on the shelf)
    const sel = props.calloutFor && props.tool === "select" ? v.scene.objects.get(props.calloutFor) : undefined;
    if (sel && props.callout) {
      const a = v.toScreen(sel.rect[0], sel.rect[3]);
      const b = v.toScreen(sel.rect[2], sel.rect[1]);
      const anchor = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      const cardW = 196;
      const boardTop = Math.min(v.toScreen(v.scene.rect[0], v.scene.rect[3]).y, v.toScreen(v.scene.rect[2], v.scene.rect[3]).y);
      const sx = anchor.x + anchor.w / 2;
      const sy = anchor.y;
      const shelfY = Math.max(props.insets.top + 20, Math.min(boardTop - 22, sy - 30));
      let cx = v.width - props.insets.right - 16 - cardW;
      // the card never covers the selection: when it would, it goes to the left
      if (cx < anchor.x + anchor.w + 24 && cx + cardW > anchor.x - 24) cx = Math.max(props.insets.left + 16, anchor.x - 60 - cardW);
      const toRight = cx > sx;
      const ex = toRight ? cx + cardW : cx;
      const visible = anchor.x < v.width && anchor.y < v.height && anchor.x + anchor.w > 0 && anchor.y + anchor.h > 0;
      if (visible) {
        const leg = sy > shelfY + 2 ? `M${sx},${sy} V${shelfY} H${ex}` : `M${sx},${sy} L${sx + (toRight ? 20 : -20)},${shelfY} H${ex}`;
        const title = (props.calloutTitle ?? "").replace(/[<&>]/g, "");
        overlay.push(
          `<path d="${leg}" fill="none" stroke="#5aa9ff" stroke-width="1.25"/><circle cx="${sx}" cy="${sy}" r="2.5" fill="#5aa9ff"/><text x="${toRight ? sx + 8 : sx - 8}" y="${shelfY - 6}" text-anchor="${toRight ? "start" : "end"}" fill="#5aa9ff" font-family="Kode Mono, ui-monospace, monospace" font-size="10" letter-spacing="1">${title.toUpperCase()}</text>`,
        );
        calloutNode = (
          <div className="pcb-callout" style={{ left: cx, top: shelfY + 10 }} onPointerDown={(e) => e.stopPropagation()}>
            {props.callout(anchor)}
          </div>
        );
      }
    }
    for (const f of props.findings) {
      const p = v.nmToScreen(f.location);
      if (p.x < -20 || p.y < -20 || p.x > v.width + 20 || p.y > v.height + 20) continue;
      const on = f.id === props.activeFinding || f.id === hoverFinding;
      overlay.push(`<g class="marker" data-finding="${f.id}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">${markerSvg(markerKind(f), 7, on)}</g>`);
      if (on) {
        const left = Math.min(p.x + 22, v.width - props.insets.right - 250);
        findingCard = (
          <div className="pcb-callout finding" style={{ left, top: p.y + 34 }}>
            <div className="shelf" style={{ color: f.severity === "error" ? "var(--pcb-fail)" : f.severity === "warning" ? "var(--pcb-warn)" : "var(--pcb-body)" }}>
              {f.severity} · {f.check}
            </div>
            <p>{f.message}</p>
          </div>
        );
      }
    }
  }

  return (
    <div
      ref={host}
      className="pcb-canvas"
      tabIndex={-1}
      style={{ cursor: props.tool === "measure" ? "crosshair" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        props.onCursor(undefined);
        props.onHover(undefined);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvas} />
      <svg
        className="overlay"
        onPointerOver={(e) => {
          const g = (e.target as Element).closest("[data-finding]");
          setHoverFinding(g?.getAttribute("data-finding") ?? undefined);
        }}
        onPointerOut={() => setHoverFinding(undefined)}
        onPointerDown={(e) => {
          const g = (e.target as Element).closest("[data-finding]");
          if (g) {
            e.stopPropagation();
            props.onFinding(g.getAttribute("data-finding")!);
          }
        }}
        dangerouslySetInnerHTML={{ __html: overlay.join("") }}
      />
      {box && <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, border: "1px dashed #5aa9ff", background: "rgba(90,169,255,0.08)", pointerEvents: "none" }} />}
      {measure && v && <MeasureLine m={measure} view={v} />}
      {calloutNode}
      {findingCard}
    </div>
  );
}

function MeasureLine({ m, view }: { m: { x0: number; y0: number; x: number; y: number }; view: BoardView }) {
  const a = view.toWorld(m.x0, m.y0);
  const b = view.toWorld(m.x, m.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const f = (n: number) => n.toFixed(3);
  return (
    <>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        <line x1={m.x0} y1={m.y0} x2={m.x} y2={m.y} stroke="#e6e6e6" strokeWidth={1} strokeDasharray="4 3" />
        <circle cx={m.x0} cy={m.y0} r={3} fill="#e6e6e6" />
        <circle cx={m.x} cy={m.y} r={3} fill="#e6e6e6" />
      </svg>
      <div className="pcb-measure" style={{ left: (m.x0 + m.x) / 2 + 10, top: (m.y0 + m.y) / 2 + 10 }}>
        {f(d)} mm · dx {f(dx)} · dy {f(dy)}
        {d > 0 ? ` · ${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}°` : ""}
      </div>
    </>
  );
}

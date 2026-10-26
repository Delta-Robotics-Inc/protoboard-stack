/**
 * Pan and zoom for an SVG drawing by its viewBox (the drawing stays vector
 * sharp at any zoom), with the canvas's own interactions (the diagram's,
 * uhd-viewer canvas/interaction.ts):
 *
 * - two tools, Select (V, the default) and Pan (H): with Select a left-drag
 *   draws a selection box, with Pan it moves the view; Space held makes a
 *   left-drag pan with either; the middle button always pans;
 * - the wheel (and a pinch: a trackpad's, or two fingers) zooms about the
 *   pointer;
 * - F fits, + and - zoom about the centre, 0 goes back to the fit's zoom;
 * - the drawing is fitted when it first has a size and a box, and fitted
 *   again on a resize until the person moves the view.
 *
 * The view lives in a ref and is written to the `<svg>`'s viewBox directly:
 * a pan never re-renders the drawing. React hears of it once a frame
 * (`view`), for what is sized to the zoom (markers, the selection box).
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { canvasCommand, initialInteraction, interactionReducer, type CanvasTool } from "@deltarobotics/uhd-viewer/components";

export type Box = [number, number, number, number];

export interface View {
  /** Drawing units at the centre of the host, and screen pixels per unit. */
  cx: number;
  cy: number;
  s: number;
}

/** Room a fit leaves clear at each side of the host (floating panels), in pixels. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PanZoomOptions {
  /** What a fit shows (drawing units); the drawing's own box until the content's is known. */
  box: Box | undefined;
  /** Room to keep clear when fitting (asked at each fit: panels open and close). */
  insets?: () => Partial<Insets>;
  /** A selection box drawn with the Select tool (drawing units), and whether Shift added to the selection. */
  onBox?: (box: Box, additive: boolean) => void;
  /** Escape pressed on the view. */
  onEscape?: () => void;
}

export interface PanZoom {
  /** The host element's ref: the element the pointer and the wheel act on. */
  ref: (el: HTMLElement | null) => void;
  /** The current view (updated at most once a frame). */
  view: View | null;
  fit(): void;
  zoomBy(k: number): void;
  /** Bring a drawing point to the centre, zoomed in to at least `zoom` times the fit (a finding, a component). */
  centerOn(x: number, y: number, zoom?: number): void;
  /** Screen point (client coordinates) → drawing units. */
  toDrawing(clientX: number, clientY: number): [number, number] | undefined;
  /** The pointer moved more than a click since it went down (the click that ends a drag is not a pick). */
  dragged: () => boolean;
  tool: CanvasTool;
  setTool(tool: CanvasTool): void;
  /** Space is held, or the Pan tool is chosen: a left-drag pans. */
  panning: boolean;
  /** The selection box being drawn, in the host's pixels (left, top, width, height). */
  selecting: Box | null;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 200;
const CLICK_SLOP = 4;
const FIT_MARGIN = 0.96;

const insetsOf = (o: PanZoomOptions): Insets => ({ left: 0, right: 0, top: 0, bottom: 0, ...(o.insets?.() ?? {}) });

/** The scale and centre that show `box` inside `w` × `h` less `insets`. */
export function fitView(box: Box, w: number, h: number, insets: Insets): View {
  // never fit into less than a third of the host: a small window keeps the drawing under its panels instead
  const iw = Math.max(w / 3, w - insets.left - insets.right);
  const ih = Math.max(h / 3, h - insets.top - insets.bottom);
  const dx = iw === w / 3 ? 0 : (insets.left - insets.right) / 2;
  const dy = ih === h / 3 ? 0 : (insets.top - insets.bottom) / 2;
  const s = Math.min(iw / box[2], ih / box[3]) * FIT_MARGIN;
  return { s, cx: box[0] + box[2] / 2 - dx / s, cy: box[1] + box[3] / 2 - dy / s };
}

/** The view after zooming by `k` about the host point (px, py) (the point under it stays put). */
export function zoomAbout(v: View, k: number, px: number, py: number, w: number, h: number, limits: [number, number]): View {
  const s = Math.min(limits[1], Math.max(limits[0], v.s * k));
  const ox = px - w / 2;
  const oy = py - h / 2;
  const ux = v.cx + ox / v.s;
  const uy = v.cy + oy / v.s;
  return { s, cx: ux - ox / s, cy: uy - oy / s };
}

/** The viewBox attribute that shows `v` in a `w` × `h` host. */
export const viewBoxOf = (v: View, w: number, h: number) => `${v.cx - w / 2 / v.s} ${v.cy - h / 2 / v.s} ${w / v.s} ${h / v.s}`;

export function usePanZoom(svg: () => SVGSVGElement | null, options: PanZoomOptions): PanZoom {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const opts = useRef(options);
  opts.current = options;
  // the getter is a new function each render: read through a ref, so the listeners (and a drag under way) stay
  const svgRef = useRef(svg);
  svgRef.current = svg;
  const box = options.box;
  const boxKey = box?.map((n) => n.toFixed(4)).join(" ");

  const viewRef = useRef<View | null>(null);
  const [view, setView] = useState<View | null>(null);
  const fitScale = useRef(1);
  /** The person moved the view since the last automatic fit. */
  const moved = useRef(false);
  const dragMoved = useRef(false);
  const [interaction, dispatch] = useReducer(interactionReducer, initialInteraction);
  const panning = interaction.tool === "pan" || interaction.space;
  const panningRef = useRef(panning);
  panningRef.current = panning;
  const [selecting, setSelecting] = useState<Box | null>(null);

  const size = useCallback(() => (el ? { w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) } : { w: 1, h: 1 }), [el]);

  // the view written to the drawing: now, and React told once a frame
  const frame = useRef(0);
  const apply = useCallback(() => {
    const s = svgRef.current();
    const v = viewRef.current;
    if (!s || !v || !el) return;
    const { w, h } = size();
    s.setAttribute("viewBox", viewBoxOf(v, w, h));
    s.setAttribute("width", String(w));
    s.setAttribute("height", String(h));
    s.setAttribute("preserveAspectRatio", "xMidYMid meet");
    // a level of detail for the drawing's own rules (labels that only read when zoomed in)
    s.style.setProperty("--pb-px", String(1 / v.s));
  }, [el, size]);
  const commit = useCallback(
    (v: View | null, byPerson: boolean) => {
      viewRef.current = v;
      if (byPerson) moved.current = true;
      apply();
      if (!frame.current)
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setView(viewRef.current);
        });
    },
    [apply],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // a new <svg> (a drawing loaded, a side flipped) gets the view at once
  useLayoutEffect(() => apply());

  const limits = (): [number, number] => [fitScale.current * MIN_ZOOM, fitScale.current * MAX_ZOOM];

  const fit = useCallback(() => {
    const b = opts.current.box;
    if (!b || !el) return;
    const { w, h } = size();
    if (w < 8 || h < 8) return;
    const v = fitView(b, w, h, insetsOf(opts.current));
    fitScale.current = v.s;
    moved.current = false;
    commit(v, false);
  }, [el, size, commit]);

  // fitted when the drawing first has a box and the host a size, and again when the box changes
  const fittedKey = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!el || !boxKey || fittedKey.current === boxKey) return;
    const { w, h } = size();
    if (w < 8 || h < 8) return;
    fittedKey.current = boxKey;
    fit();
  }, [el, boxKey, fit, size]);

  // a resize: fitted again until the person moved the view; after that the centre and the zoom relative to fit stay
  useEffect(() => {
    if (!el) return;
    let last = size();
    const ro = new ResizeObserver(() => {
      const next = size();
      if (next.w === last.w && next.h === last.h) return;
      last = next;
      const b = opts.current.box;
      if (!b) return;
      if (fittedKey.current !== boxKey || !moved.current || !viewRef.current) {
        fittedKey.current = boxKey;
        return fit();
      }
      const k = fitView(b, next.w, next.h, insetsOf(opts.current)).s;
      const ratio = k / fitScale.current;
      fitScale.current = k;
      const v = viewRef.current;
      commit({ ...v, s: v.s * ratio }, false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, boxKey, fit, size, commit]);

  const zoomAt = useCallback(
    (k: number, px?: number, py?: number) => {
      const v = viewRef.current;
      if (!v) return;
      const { w, h } = size();
      commit(zoomAbout(v, k, px ?? w / 2, py ?? h / 2, w, h, limits()), true);
    },
    [size, commit],
  );

  // the pointer, the wheel and touch on the host
  useEffect(() => {
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // a pinch on a trackpad arrives as a wheel with Ctrl: it zooms faster
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), x, y);
    };
    type Gesture = { mode: "pan" | "box"; id: number; x: number; y: number; start: View; additive: boolean };
    let g: Gesture | null = null;
    const touches = new Map<number, [number, number]>();
    let pinch: { d: number; s: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: viewRef.current?.s ?? 1 };
          g = null;
          return;
        }
      }
      if (e.button !== 0 && e.button !== 1) return;
      const v = viewRef.current;
      if (!v) return;
      // the middle button pans with either tool; the browser's own autoscroll never starts
      if (e.button === 1) e.preventDefault();
      dragMoved.current = false;
      const pan = e.button === 1 || panningRef.current || e.pointerType === "touch" || !opts.current.onBox;
      g = { mode: pan ? "pan" : "box", id: e.pointerId, x: e.clientX, y: e.clientY, start: v, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    };
    const move = (e: PointerEvent) => {
      if (pinch && touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const v = viewRef.current;
        if (v && pinch.d > 0) {
          const [x, y] = local({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
          zoomAt((pinch.s * (d / pinch.d)) / v.s, x, y);
        }
        dragMoved.current = true;
        return;
      }
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!dragMoved.current) {
        if (Math.hypot(dx, dy) < CLICK_SLOP) return;
        dragMoved.current = true;
        el.setPointerCapture?.(e.pointerId);
      }
      if (g.mode === "pan") {
        const s = viewRef.current?.s ?? g.start.s;
        commit({ s, cx: g.start.cx - dx / s, cy: g.start.cy - dy / s }, true);
      } else {
        const [x0, y0] = local({ clientX: g.x, clientY: g.y });
        const [x1, y1] = local(e);
        setSelecting([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]);
      }
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (!g || e.pointerId !== g.id) return;
      const done = g;
      g = null;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (done.mode === "box") {
        setSelecting(null);
        const v = viewRef.current;
        if (dragMoved.current && v && e.type === "pointerup") {
          const { w, h } = size();
          const [x0, y0] = local({ clientX: done.x, clientY: done.y });
          const [x1, y1] = local(e);
          const ux = (x: number) => v.cx + (x - w / 2) / v.s;
          const uy = (y: number) => v.cy + (y - h / 2) / v.s;
          opts.current.onBox?.([ux(Math.min(x0, x1)), uy(Math.min(y0, y1)), Math.abs(x1 - x0) / v.s, Math.abs(y1 - y0) / v.s], done.additive);
        }
      }
    };
    // the middle button's click would paste on Linux, and its press start the browser's autoscroll
    const aux = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("mousedown", aux);
    el.addEventListener("auxclick", aux);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("mousedown", aux);
      el.removeEventListener("auxclick", aux);
    };
  }, [el, zoomAt, commit, size]);

  // the canvas's keys, when they are pressed on the page or inside this view, outside any field
  useEffect(() => {
    if (!el) return;
    const ours = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || !el.isConnected || el.closest("[inert]")) return false;
      if (t?.closest?.("input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox']")) return false;
      const root = el.closest(".pb-board-drawing") ?? el;
      return !t || t === document.body || t === document.documentElement || root.contains(t);
    };
    const taken = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const keydown = (e: KeyboardEvent) => {
      if (!ours(e)) return;
      if (e.key === " " || e.code === "Space") {
        if ((e.target as HTMLElement | null)?.closest?.("button, a[href], [role='tab']")) return;
        e.preventDefault();
        if (!e.repeat) dispatch({ type: "space", down: true });
        return;
      }
      const c = canvasCommand(e);
      if (!c) return;
      switch (c.type) {
        case "tool":
          dispatch(c);
          return taken(e);
        case "fit":
          fit();
          return taken(e);
        case "zoom":
          if (c.by === "reset") {
            const v = viewRef.current;
            if (v) commit({ ...v, s: fitScale.current }, true);
          } else zoomAt(c.by === "in" ? 1.4 : 1 / 1.4);
          return taken(e);
        case "escape":
          opts.current.onEscape?.();
          return;
        default:
          return;
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") dispatch({ type: "space", down: false });
    };
    const blur = () => dispatch({ type: "blur" });
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
    };
  }, [el, fit, zoomAt, commit]);

  return {
    ref: setEl,
    view,
    fit,
    zoomBy: (k) => zoomAt(k),
    centerOn: (x, y, zoom = 4) => {
      const v = viewRef.current;
      if (v) commit({ cx: x, cy: y, s: Math.max(v.s, fitScale.current * zoom) }, true);
    },
    toDrawing: (x, y) => {
      const v = viewRef.current;
      if (!el || !v) return undefined;
      const r = el.getBoundingClientRect();
      return [v.cx + (x - r.left - r.width / 2) / v.s, v.cy + (y - r.top - r.height / 2) / v.s];
    },
    dragged: () => dragMoved.current,
    tool: interaction.tool,
    setTool: (tool) => dispatch({ type: "tool", tool }),
    panning,
    selecting,
  };
}

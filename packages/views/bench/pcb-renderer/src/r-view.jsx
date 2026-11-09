/**
 * Baseline (e): the current PCB view's technique, driven with the real drawing code. Each
 * piece is drawn by `shapeEl` imported from `packages/views/src/drawing/CircuitPcbView.tsx`,
 * inside memoized React layer groups, with the view's own `DRAWING_CSS`; pan and zoom by the
 * viewBox as its `usePanZoom` does; the net highlight is the same set of CSS rules the view
 * writes (`[data-net=...]`, the rest of the copper at 0.35); picking is the DOM's (the view
 * uses the event target). The view is read-only, so it has no drag.
 *
 * The board reaches it as the view's own piece model (rect, circle, line, area, text), so
 * designators are SVG text as in the view, not the shared stroke font.
 */
import { memo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { shapeEl } from "../../../src/drawing/CircuitPcbView.tsx";
import { DRAWING_CSS } from "../../../src/drawing/palettes.ts";
import { installHarness } from "./harness.js";

const TOKENS = `.pb-pcb { --uhd-canvas: #131416; --uhd-text: #e6e6e6; --uhd-text-muted: #9a9a9a; --uhd-node: #2f2f2f; --uhd-surface: #1d1e21;
  --uhd-highlight: #ffffff; --uhd-accent: #00e5ff; --uhd-border-strong: #d1d1cc; --uhd-severity-error: #e5484d; --uhd-domain-software: #6aa9ff; --uhd-domain-mechanical: #9aa0a6; }`;

function roleOf(name, copper) {
  if (name === "F.Cu") return "copper-top";
  if (name === "B.Cu") return "copper-bottom";
  if (copper.includes(name)) return `copper-inner-${(Number(name.replace(/\D/g, "")) - 1) % 4}`;
  return { "F.SilkS": "silk", "B.SilkS": "silk-bottom", "F.Fab": "fab", "B.Fab": "fab", "Edge.Cuts": "edge", Holes: "drill", Vias: "copper-top", Keepout: "keepout", Designators: "silk" }[name] ?? "ink";
}

function piecesOf(o) {
  const out = [];
  const base = { net: o.n ? String(o.n) : undefined, ref: o.fp >= 0 ? String(o.fp) : undefined };
  for (const p of o.parts) {
    if (p.k === "box") out.push({ ...base, shape: { kind: "rect", x: p.cx, y: p.cy, w: 2 * p.hx, h: 2 * p.hy, rotate: (p.a * 180) / Math.PI, r: Math.min(p.c, p.hx, p.hy) } });
    else if (p.k === "ring") out.push(p.ri > 0 ? { ...base, stroke: p.r - p.ri, shape: { kind: "circle", x: p.cx, y: p.cy, r: (p.r + p.ri) / 2 } } : { ...base, shape: { kind: "circle", x: p.cx, y: p.cy, r: p.r } });
    else if (p.k === "seg") out.push({ ...base, shape: { kind: "line", points: [[p.x1, p.y1], [p.x2, p.y2]], width: p.w } });
    else if (p.k === "path") {
      const pts = [];
      for (let i = 0; i < p.pts.length; i += 2) pts.push([p.pts[i], p.pts[i + 1]]);
      if (p.closed) pts.push(pts[0]);
      out.push({ ...base, shape: { kind: "line", points: pts, width: p.w } });
    } else if (p.k === "poly") out.push({ ...base, shape: { kind: "area", rings: p.rings.map((r) => { const q = []; for (let i = 0; i < r.length; i += 2) q.push([r[i], r[i + 1]]); return q; }) } });
    else if (p.k === "text" && o.label) out.push({ ...base, shape: { kind: "text", x: o.label.x, y: o.label.y, text: o.label.t, size: o.label.s, rotate: o.label.r || undefined } });
  }
  return out;
}

const LayerGroup = memo(function LayerGroup({ layer }) {
  return (
    <g className={`pb-pcb-layer${layer.copper ? " pb-pcb-copper" : ""}`} data-layer={layer.dl} style={{ color: `var(--pb-d-${layer.role})` }}>
      {layer.pieces.map((p, i) => shapeEl(p, i, false, { "data-net": p.net, "data-ref": p.ref, "data-o": String(p.o), className: p.shape.kind === "area" && layer.copper ? "pb-pour" : undefined }))}
    </g>
  );
});

async function createRenderer(host, W, H) {
  const div = document.createElement("div");
  div.className = "pb-board-drawing pb-pcb pb-drawing";
  div.style.cssText = `width:${W}px;height:${H}px;position:relative`;
  host.appendChild(div);
  const root = createRoot(div);
  let setRules, layers = [], svgEl, scene;
  function App({ layers }) {
    const [rules, set] = useState("");
    setRules = set;
    return (
      <>
        <style>{TOKENS + DRAWING_CSS}</style>
        <style>{rules}</style>
        <svg ref={(e) => (svgEl = e)} width={W} height={H} role="img">
          <g data-pb-viewport>{layers.map((l) => <LayerGroup key={l.id} layer={l} />)}</g>
        </svg>
      </>
    );
  }
  return {
    async build(sc) {
      scene = sc;
      layers = sc.layers
        .map((l, i) => ({ id: `${i}:${l.name}`, dl: l.name === "Edge.Cuts" ? "edge" : l.name === "Holes" ? "drill" : l.copper ? `copper:${l.name}` : l.name, copper: l.copper || l.name === "Vias", role: roleOf(l.name, sc.board.copper), pieces: l.objects.flatMap((id) => piecesOf(sc.objects[id]).map((p) => ({ ...p, o: id }))) }))
        .filter((l) => l.pieces.length);
      flushSync(() => root.render(<App layers={layers} />));
    },
    setView(v) { svgEl.setAttribute("viewBox", `${v.cx - W / 2 / v.s} ${v.cy - H / 2 / v.s} ${W / v.s} ${H / v.s}`); },
    render() {},
    setHighlight(n) {
      const key = String(n);
      const esc = (s) => s.replace(/["\\]/g, "\\$&");
      const rules = n
        ? [
            `.pb-pcb [data-net="${esc(key)}"] { color: var(--pb-d-hover) !important; } .pb-pcb .pb-pcb-copper [data-net="${esc(key)}"] { opacity: 1; }`,
            `.pb-pcb .pb-pcb-copper > :not([data-net="${esc(key)}"]) { opacity: 0.35; }`,
            `.pb-pcb .pb-pcb-copper > .pb-pour[data-net="${esc(key)}"] { opacity: 0.3; }`,
          ].join("\n")
        : "";
      flushSync(() => setRules(rules));
    },
    domPick(x, y) {
      const r = div.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + x, r.top + y)?.closest?.("[data-net],[data-ref]");
      return el?.getAttribute("data-o") ? scene.objects[+el.getAttribute("data-o")] : undefined;
    },
    info() { return { domNodes: div.getElementsByTagName("*").length, technique: "CircuitPcbView shapeEl + React 19 + CSS-rule highlight" }; },
  };
}

installHarness(createRenderer);

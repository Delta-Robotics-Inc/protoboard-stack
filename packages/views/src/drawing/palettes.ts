/**
 * The colours circuit tools write into their standard-output drawings and the
 * role each plays, and what each role is drawn with in the shell's theme.
 *
 * The drawings are found by file name (schematic.svg, pcb-top.svg,
 * pcb-bottom.svg; docs/specs/tool-integrations.md §8), never by the tool. The
 * palettes below know the colours of the drawings the stack's circuit
 * provider writes: tscircuit's circuit-to-svg defaults, and KiCad's default
 * colours for a locked board's export (`kicad-cli sch|pcb export svg`); a
 * drawing in other colours keeps them.
 */
import type { Palette } from "./svg.js";

const map = (entries: Record<string, string>): Palette => new Map(Object.entries(entries));

/** Schematic roles: paper, ink (symbols, outlines), body (part fill), wire, pin numbers, labels. */
export const SCHEMATIC_PALETTE = map({
  "#f5f1ed": "paper",
  "#ffffff": "paper",
  "#840000": "ink",
  "#ffffc2": "body",
  "#009600": "wire",
  "#a90000": "pin",
  "#006464": "label",
  "#0f0f0f": "net-text",
  "#ffffff/0.6": "net-fill",
  "#ff0000": "hover",
  // KiCad (Eeschema): the sheet, labels and their text, no-connect marks and buses
  "#f5f4ef": "paper",
  "#000000": "net-text",
  "#000084": "ink",
  "#c2c2c2": "label",
});

/** PCB roles: the page, copper on each side, silkscreen, drills, the board's edge, keepouts. */
export const PCB_PALETTE = map({
  "#000000": "paper",
  "#c83434": "copper-top",
  "#4d7fc4": "copper-bottom",
  "#ff26e2": "drill",
  "#f2eda1": "silk",
  "#5da9e9": "silk",
  "#ffffff": "edge",
  "#ffffff/0.5": "edge",
  "#ff6b6b": "keepout",
  "#ff6b6b/0.2": "keepout-fill",
  // KiCad (Pcbnew): the mask's openings over the pads on each side, the bottom silkscreen, the edge cuts
  "#d864ff": "pad",
  "#02ffee": "pad",
  "#e8b2a7": "silk",
  "#d0d2cd": "edge",
});

/**
 * The roles in theme tokens. Copper and drills are data colours: the same
 * family in every theme, mixed toward the canvas so they sit on it; the
 * page, ink, labels and edges are the theme's own. High contrast draws every
 * line in the foreground and keeps fills out of the way.
 */
export const DRAWING_CSS = `
.pb-board-drawing {
  --pb-d-paper: var(--uhd-canvas);
  --pb-d-ink: color-mix(in oklab, var(--uhd-text) 88%, var(--uhd-canvas));
  --pb-d-body: var(--uhd-node);
  --pb-d-wire: var(--uhd-domain-software);
  /* pin names and numbers: quieter than the ink, but opaque and readable on every canvas (a theme's faint text may be translucent) */
  --pb-d-pin: color-mix(in oklab, var(--uhd-text) 70%, var(--uhd-canvas));
  --pb-d-label: var(--uhd-text-muted);
  --pb-d-net-text: var(--uhd-text);
  --pb-d-net-fill: color-mix(in oklab, var(--uhd-surface) 85%, transparent);
  --pb-d-hover: var(--uhd-highlight);
  --pb-d-board: color-mix(in oklab, var(--uhd-text) 7%, var(--uhd-canvas));
  --pb-d-copper-top: color-mix(in oklab, #c94a3e 85%, var(--uhd-canvas));
  --pb-d-copper-bottom: color-mix(in oklab, #4d7fc4 82%, var(--uhd-canvas));
  --pb-d-drill: color-mix(in oklab, var(--uhd-text) 30%, var(--uhd-canvas));
  --pb-d-silk: color-mix(in oklab, var(--uhd-text) 92%, var(--uhd-canvas));
  --pb-d-edge: var(--uhd-border-strong);
  --pb-d-keepout: var(--uhd-severity-error);
  --pb-d-keepout-fill: color-mix(in oklab, var(--uhd-severity-error) 14%, transparent);
  --pb-d-select: var(--uhd-accent);
  /* the routed board (CircuitPcbView): inner copper, the far side's silkscreen, courtyards, the fabrication drawing */
  --pb-d-copper-inner-0: color-mix(in oklab, #d1a23a 80%, var(--uhd-canvas));
  --pb-d-copper-inner-1: color-mix(in oklab, #4fa66a 78%, var(--uhd-canvas));
  --pb-d-copper-inner-2: color-mix(in oklab, #9a6cc9 78%, var(--uhd-canvas));
  --pb-d-copper-inner-3: color-mix(in oklab, #3aa7a7 78%, var(--uhd-canvas));
  --pb-d-silk-bottom: color-mix(in oklab, var(--uhd-text) 55%, var(--uhd-canvas));
  --pb-d-courtyard: color-mix(in oklab, var(--uhd-text-muted) 80%, var(--uhd-canvas));
  --pb-d-fab: color-mix(in oklab, var(--uhd-domain-mechanical, var(--uhd-text-muted)) 75%, var(--uhd-canvas));
  /* a pad the solder mask leaves open (KiCad's export draws the openings over the copper): the finish */
  --pb-d-pad: color-mix(in oklab, #d9a441 82%, var(--uhd-canvas));
}
/* the board check's marks on the routed board: a fixed size on screen at any zoom (--pb-px: drawing units per pixel) */
.pb-pcb .pb-finding-ring { r: calc(var(--pb-px, 0.05) * 6px); opacity: 0.9; }
.pb-pcb .pb-finding-dot { r: calc(var(--pb-px, 0.05) * 2px); }
.pb-pcb [data-severity="warning"] .pb-finding-ring { r: calc(var(--pb-px, 0.05) * 4.5px); opacity: 0.75; }
.pb-pcb [data-severity="info"] .pb-finding-ring { r: calc(var(--pb-px, 0.05) * 3.5px); opacity: 0.6; }
.pb-pcb .pb-pcb-layer[data-layer="edge"] { color: var(--pb-d-board); }
.pb-pcb .pb-pcb-layer[data-layer="edge"] > * { fill: var(--pb-d-board); stroke: var(--pb-d-edge); stroke-width: 0.12px; vector-effect: non-scaling-stroke; }
.pb-pcb .pb-pcb-copper > * { opacity: 0.9; }
.pb-pcb .pb-pcb-copper .pb-pour { opacity: 0.2; }
.pb-pcb .pb-pcb-layer[data-layer="drill"] { color: var(--pb-d-paper); }
.pb-pcb [data-net], .pb-pcb [data-ref] { cursor: pointer; }
.pb-pcb .pb-pcb-findings { pointer-events: none; }
.pb-drawing { background: var(--pb-d-paper); }
.pb-drawing svg { display: block; overflow: visible; }
.pb-drawing text { font-family: var(--uhd-font-ui); }
.pb-drawing .pcb-board { fill: var(--pb-d-board); }
.pb-drawing .schematic-boundary, .pb-drawing .pcb-boundary { stroke: var(--pb-d-edge); }
/* hit areas the tool draws invisible stay invisible */
.pb-drawing .trace-invisible-hover-outline, .pb-drawing .schematic-port-hover { opacity: 0; }
/* what the pointer is over, and what is selected */
.pb-drawing [data-pb-hot] { cursor: pointer; }
.pb-drawing .pb-net-on :is(path, line) { stroke: var(--pb-d-hover) !important; stroke-width: 0.9px; }
.pb-drawing .pb-net-on.sch-trace-junction, .pb-drawing .pb-net-on circle { fill: var(--pb-d-hover) !important; }
.pb-drawing .pb-pad-on { fill: var(--pb-d-hover) !important; stroke: var(--pb-d-hover) !important; }
.pb-drawing .pb-part-hover :is(.sch-component-body, .sch-component-symbol-path) { stroke: var(--pb-d-hover) !important; }
.pb-drawing .pb-part-on :is(.sch-component-body, .sch-component-symbol-path, .component-pin) { stroke: var(--pb-d-select) !important; stroke-width: 0.9px; }
.pb-drawing .pb-part-on .sch-component-body { fill: color-mix(in oklab, var(--pb-d-select) 14%, var(--pb-d-body)) !important; }
.pb-drawing .pb-part-on text { fill: var(--pb-d-select) !important; }
.pb-drawing .pb-pad-part { fill: var(--pb-d-select) !important; }
/* KiCad's drawings: lines never thinner than a pixel at any zoom (its strokes are a tenth of a millimetre), wires as wide as the symbols' */
.pb-kicad .pb-drawing svg :is(path, line, polyline, polygon, circle, rect) { stroke-width: max(var(--pb-kicad-w, 0.1524px), calc(var(--pb-px, 0.05) * 0.9px)); }
.pb-kicad .pb-drawing [data-pb-stroke="wire"], .pb-kicad .pb-drawing [data-pb-stroke="wire"] :is(path, line, polyline) { --pb-kicad-w: 0.254px; }
.pb-kicad .pb-drawing [data-pb-page] { stroke: none; }
/* a KiCad net lit end to end (its wires and labels), a part picked (its reference, value and body) */
.pb-drawing .pb-kicad-net, .pb-drawing .pb-kicad-net path { stroke: var(--pb-d-hover) !important; stroke-width: max(0.3px, calc(var(--pb-px, 0.05) * 2.5px)) !important; }
.pb-drawing .pb-kicad-part-hover, .pb-drawing .pb-kicad-part-hover path { stroke: var(--pb-d-hover) !important; }
.pb-drawing .pb-kicad-part, .pb-drawing .pb-kicad-part path { stroke: var(--pb-d-select) !important; }
.pb-drawing [data-pb-fill="body"].pb-kicad-part { fill: color-mix(in oklab, var(--pb-d-select) 18%, var(--pb-d-body)) !important; stroke-width: max(0.25px, calc(var(--pb-px, 0.05) * 2px)) !important; }
/* KiCad's board export fills a pour as many polygons side by side: a hairline of the same copper closes the seams between them */
.pb-kicad-pcb .pb-drawing [data-pb-fill^="copper"]:not([data-pb-stroke]) { stroke: var(--pb-d-copper-top) !important; stroke-width: 0.02px !important; }
.pb-kicad-pcb .pb-drawing [data-pb-fill="copper-bottom"]:not([data-pb-stroke]) { stroke: var(--pb-d-copper-bottom) !important; }
[data-uhd-scheme^="high-contrast"] .pb-board-drawing {
  --pb-d-ink: var(--uhd-text);
  --pb-d-body: var(--uhd-canvas);
  --pb-d-wire: var(--uhd-text);
  --pb-d-pin: var(--uhd-text);
  --pb-d-label: var(--uhd-text);
  --pb-d-net-fill: var(--uhd-canvas);
  --pb-d-board: var(--uhd-canvas);
  --pb-d-silk: var(--uhd-text);
  --pb-d-edge: var(--uhd-contrast-border);
  --pb-d-hover: var(--uhd-contrast-active-border);
  --pb-d-select: var(--uhd-contrast-active-border);
  --pb-d-silk-bottom: var(--uhd-text);
  --pb-d-courtyard: var(--uhd-text);
  --pb-d-fab: var(--uhd-text);
  --pb-d-pad: var(--uhd-text);
}
`;

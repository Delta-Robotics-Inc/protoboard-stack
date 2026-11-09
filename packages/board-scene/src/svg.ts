/**
 * A pure SVG drawing of a board model: the whole board or a region, chosen copper layers, on a dark background in
 * the app's board palette, with overlays that match the scene JSON (labels, numbered markers, a millimeter grid with
 * axis ticks and the origin at the board center, a scale bar, highlights, and before/after ghosting). Text is drawn
 * with the package's stroke font, so the file needs no fonts. Same input, same bytes.
 */
import type { RatLink } from "./connectivity.js";
import { textPath, textWidth } from "./font.js";
import type { BoardModel, MPad, MTrack, MVia } from "./model.js";
import type { Corridor } from "./relations.js";
import type { MarkerItem } from "./scene.js";
import { centerOf, inBox, inflateBox, overlaps, polyMidpoint, segBoxDist, type BoxMm, type Pt } from "./util.js";

/**
 * The board palette of @protoboardai/views (packages/views/src/drawing/palettes.ts) resolved against the dark
 * theme's canvas: the copper families mixed toward the canvas by the same shares.
 */
export const PALETTE = {
  canvas: "#1a1a1a",
  board: "#252525",
  edge: "#a8a29e",
  grid: "#333333",
  gridMajor: "#4a4a4a",
  axis: "#9a9a9a",
  text: "#dadada",
  muted: "#989898",
  silk: "#cbcbcb",
  silkBottom: "#8a8a8a",
  courtyard: "#6f6f6f",
  pad: "#b78b3a",
  padBottom: "#6a93cf",
  drill: "#111111",
  via: "#a8a29e",
  keepout: "#ef4444",
  rat: "#e5e5e5",
  highlight: "#22d3ee",
  accent: "#3b9ae0",
  warning: "#eed202",
  error: "#ef4444",
  info: "#60a5fa",
  ghost: "#9ca3af",
  corridor: "#4ade80",
  copper: { top: "#b4473c", bottom: "#446da5", inner: ["#ac8734", "#438758", "#7e5aa3", "#338888"] },
};

export function layerColor(model: BoardModel, layer: string): string {
  if (layer === "top") return PALETTE.copper.top;
  if (layer === "bottom") return PALETTE.copper.bottom;
  const i = model.copper.indexOf(layer);
  return PALETTE.copper.inner[Math.max(0, i - 1) % PALETTE.copper.inner.length];
}

export interface SvgOptions {
  /** The world box to draw (mm). Default: the board with a 1 mm margin. */
  box?: BoxMm;
  /** Copper layers to draw (default all). Silkscreen and courtyards follow the sides shown. */
  layers?: string[];
  /** Scale; default fits the longer side in `maxPx`. */
  pxPerMm?: number;
  /** Default 1200. */
  maxPx?: number;
  /** refs: footprint references; all: plus pad numbers and net names on tracks; none. Default refs. */
  labels?: "refs" | "all" | "none";
  markers?: MarkerItem[];
  grid?: boolean;
  scaleBar?: boolean;
  rats?: RatLink[];
  corridors?: Corridor[];
  highlight?: { nets?: string[]; ids?: string[] };
  /** Before/after: draw `before`'s objects among `changed` dashed in gray, and the current ones outlined in the highlight color. */
  ghost?: { before: BoardModel; changed: string[] };
  /** A one-line caption above the drawing. */
  title?: string;
}

const f = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ML = 46;
const MR = 14;
const MT = 26;
const MB = 30;

interface Frame {
  box: BoxMm;
  s: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  w: number;
  h: number;
}

function frame(model: BoardModel, o: SvgOptions): Frame {
  const box = o.box ?? inflateBox(model.box, 1);
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  const s = o.pxPerMm ?? Math.max(2, Math.min(80, (o.maxPx ?? 1200) / Math.max(bw, bh)));
  return { box, s, X: (x) => ML + (x - box.minX) * s, Y: (y) => MT + (box.maxY - y) * s, w: Math.ceil(ML + MR + bw * s), h: Math.ceil(MT + MB + bh * s) };
}

const pathOf = (fr: Frame, pts: readonly Pt[], close = false): string => pts.map((p, i) => `${i ? "L" : "M"}${f(fr.X(p.x))} ${f(fr.Y(p.y))}`).join("") + (close ? "Z" : "");

/** A text label as a stroke path with a dark halo. */
function label(fr: Frame, text: string, x: number, y: number, h: number, color: string, anchor: "left" | "center" | "right" = "center", attrs = ""): string {
  const d = textPath(text, x, y, h, anchor);
  if (!d) return "";
  const sw = Math.max(0.8, h * 0.13);
  return `<g${attrs}><path d="${d}" fill="none" stroke="${PALETTE.canvas}" stroke-width="${f(sw + 2.2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function trackSvg(fr: Frame, t: MTrack, color: string, extra = ""): string {
  const w = f(Math.max(0.6, t.w * fr.s));
  if (t.sweep !== undefined) {
    const r = trackRadius(t) * fr.s;
    const large = Math.abs(t.sweep) > 180 ? 1 : 0;
    const sweep = t.sweep > 0 ? 0 : 1;
    return `<path d="M${f(fr.X(t.a.x))} ${f(fr.Y(t.a.y))}A${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(fr.X(t.b.x))} ${f(fr.Y(t.b.y))}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
  }
  return `<line x1="${f(fr.X(t.a.x))}" y1="${f(fr.Y(t.a.y))}" x2="${f(fr.X(t.b.x))}" y2="${f(fr.Y(t.b.y))}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
}

function trackRadius(t: MTrack): number {
  const theta = ((t.sweep ?? 0) * Math.PI) / 180;
  const chord = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
  return Math.abs(chord / 2 / Math.sin(theta / 2));
}

function padSvg(fr: Frame, p: MPad, color: string, extra = ""): string {
  let out = "";
  if (p.shape.kind === "poly") out = `<path d="${pathOf(fr, p.shape.pts, true)}" fill="${color}"${extra}/>`;
  else {
    const { cx, cy, hw, hh, rr, rot } = p.shape;
    const deg = (-rot * 180) / Math.PI;
    const tr = Math.abs(deg) > 1e-9 ? ` transform="rotate(${f(deg)} ${f(fr.X(cx))} ${f(fr.Y(cy))})"` : "";
    out = `<rect x="${f(fr.X(cx - hw))}" y="${f(fr.Y(cy + hh))}" width="${f(2 * hw * fr.s)}" height="${f(2 * hh * fr.s)}"${rr > 0 ? ` rx="${f(rr * fr.s)}"` : ""} fill="${color}"${tr}${extra}/>`;
  }
  return out;
}

function holeSvg(fr: Frame, p: MPad): string {
  if (p.hole === undefined) return "";
  if (Array.isArray(p.hole)) {
    const [w, h] = p.hole;
    const deg = -p.rot;
    const tr = Math.abs(deg) > 1e-9 ? ` transform="rotate(${f(deg)} ${f(fr.X(p.x))} ${f(fr.Y(p.y))})"` : "";
    return `<rect x="${f(fr.X(p.x - w / 2))}" y="${f(fr.Y(p.y + h / 2))}" width="${f(w * fr.s)}" height="${f(h * fr.s)}" rx="${f((Math.min(w, h) / 2) * fr.s)}" fill="${PALETTE.drill}"${tr}/>`;
  }
  return `<circle cx="${f(fr.X(p.x))}" cy="${f(fr.Y(p.y))}" r="${f((p.hole / 2) * fr.s)}" fill="${PALETTE.drill}"/>`;
}

function viaSvg(fr: Frame, v: MVia, color = PALETTE.via, extra = ""): string {
  return `<circle cx="${f(fr.X(v.x))}" cy="${f(fr.Y(v.y))}" r="${f((v.d / 2) * fr.s)}" fill="${color}"${extra}/><circle cx="${f(fr.X(v.x))}" cy="${f(fr.Y(v.y))}" r="${f((v.hole / 2) * fr.s)}" fill="${PALETTE.drill}"/>`;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Draw the model. */
/** An area's outline with its holes, as one path (drawn even-odd: a ring keep-out hatches only the ring). */
const areaPath = (fr: Parameters<typeof pathOf>[0], a: { outline: Pt[]; holes?: Pt[][] }): string => pathOf(fr, a.outline, true) + (a.holes ?? []).map((h) => pathOf(fr, h, true)).join("");

export function renderSvg(model: BoardModel, o: SvgOptions = {}): string {
  const fr = frame(model, o);
  const layers = (o.layers ?? model.copper).filter((l) => model.copper.includes(l));
  const showTop = layers.includes("top") || layers.length === model.copper.length;
  const showBottom = layers.includes("bottom") || layers.length === model.copper.length;
  const sideShown = (layer: string) => (layer.startsWith("bottom") ? showBottom : layer.startsWith("top") ? showTop : true);
  const view = fr.box;
  const hlNets = new Set(o.highlight?.nets ?? []);
  const hlIds = new Set(o.highlight?.ids ?? []);
  const dim = hlNets.size > 0 || hlIds.size > 0;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fr.w}" height="${fr.h}" viewBox="0 0 ${fr.w} ${fr.h}" data-board="${esc(model.name)}" data-px-per-mm="${f(fr.s)}" data-view="${[view.minX, view.minY, view.maxX, view.maxY].map(f).join(" ")}">`);
  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${PALETTE.keepout}" stroke-width="1.2" opacity="0.55"/></pattern></defs>`);
  out.push(`<rect width="${fr.w}" height="${fr.h}" fill="${PALETTE.canvas}"/>`);
  // no clip-path (resvg 2.6 can fail on clipped content that lies wholly outside the clip): an opaque frame drawn
  // after the board covers whatever spills into the margins
  out.push(`<g data-role="view">`);
  // board
  if (model.outline.length) {
    const holes = model.cutouts.map((c) => pathOf(fr, c, true)).join("");
    out.push(`<path d="${pathOf(fr, model.outline, true)}${holes}" fill="${PALETTE.board}" fill-rule="evenodd" data-id="outline"/>`);
  }
  // grid
  if (o.grid !== false) out.push(gridSvg(fr, model));
  out.push(`<g data-role="board">`);
  const order = [...layers].sort((a, b) => model.copper.indexOf(b) - model.copper.indexOf(a));
  // zones (outline and a light fill), bottom layer first
  for (const l of order)
    for (const z of model.zones)
      if (z.layers.includes(l) && overlaps(z.box, view)) out.push(`<path d="${areaPath(fr, z)}" fill="${layerColor(model, l)}" fill-opacity="0.14" fill-rule="evenodd" stroke="${layerColor(model, l)}" stroke-width="1" stroke-dasharray="5 3" data-id="${esc(z.id)}" data-layer="${l}"/>`);
  // copper, bottom to top: tracks, then pads
  for (const l of order) {
    const c = layerColor(model, l);
    out.push(`<g data-layer="${l}" opacity="0.88">`);
    for (const t of model.tracks) if (t.layer === l && overlaps(t.box, view)) out.push(trackSvg(fr, t, c, ` data-id="${esc(t.id)}"`));
    for (const p of model.pads)
      if (p.type === "smd" && p.layers[0] === l && overlaps(p.box, view)) out.push(padSvg(fr, p, l === "top" ? PALETTE.pad : l === "bottom" ? PALETTE.padBottom : c, ` data-id="${esc(p.id)}"`));
    out.push(`</g>`);
  }
  // plated and plain holes, vias
  for (const p of model.pads)
    if (p.type !== "smd" && overlaps(p.box, view)) {
      if (p.type === "th" && p.layers.some((l) => layers.includes(l))) out.push(padSvg(fr, p, PALETTE.pad, ` data-id="${esc(p.id)}"`));
      out.push(holeSvg(fr, p));
    }
  for (const v of model.vias) if (v.layers.some((l) => layers.includes(l)) && overlaps(v.box, view)) out.push(viaSvg(fr, v, PALETTE.via, ` data-id="${esc(v.id)}"`));
  // keep-outs
  for (const k of model.keepouts)
    if (k.layers.some((l) => layers.includes(l)) && overlaps(k.box, view)) out.push(`<path d="${areaPath(fr, k)}" fill="${Object.values(k.blocks ?? {}).some(Boolean) ? "url(#hatch)" : "none"}" fill-rule="evenodd" stroke="${PALETTE.keepout}" stroke-width="1.2" stroke-dasharray="6 3" data-id="${esc(k.id)}"/>`);
  // courtyards and silkscreen
  for (const fp of model.footprints) {
    if (!overlaps(fp.box, view) || !sideShown(fp.side)) continue;
    if (fp.courtyard) out.push(`<path d="${pathOf(fr, fp.courtyard)}" fill="none" stroke="${PALETTE.courtyard}" stroke-width="0.8" stroke-dasharray="2 2"/>`);
    for (const d of fp.drawings) if (d.layer.endsWith("silkscreen") && sideShown(d.layer)) for (const line of d.lines) out.push(`<path d="${pathOf(fr, line)}" fill="none" stroke="${d.layer.startsWith("bottom") ? PALETTE.silkBottom : PALETTE.silk}" stroke-width="${f(Math.max(0.7, d.w * fr.s))}" stroke-linecap="round"/>`);
    if ((o.labels ?? "refs") === "none")
      for (const t of fp.texts) if (t.layer.endsWith("silkscreen") && sideShown(t.layer)) out.push(silkText(fr, t.text, t.x, t.y, t.h, t.rot, t.anchor, t.layer.startsWith("bottom") ? PALETTE.silkBottom : PALETTE.silk));
  }
  for (const d of model.drawings) if (d.layer.endsWith("silkscreen") && sideShown(d.layer)) for (const line of d.lines) out.push(`<path d="${pathOf(fr, line)}" fill="none" stroke="${d.layer.startsWith("bottom") ? PALETTE.silkBottom : PALETTE.silk}" stroke-width="${f(Math.max(0.7, d.w * fr.s))}" stroke-linecap="round" data-id="${esc(d.id)}"/>`);
  for (const t of model.texts) if (t.layer.endsWith("silkscreen") && sideShown(t.layer)) out.push(silkText(fr, t.text, t.x, t.y, t.h, t.rot, t.anchor, t.layer.startsWith("bottom") ? PALETTE.silkBottom : PALETTE.silk, ` data-id="${esc(t.id)}"`));
  // the board edge
  if (model.outline.length) out.push(`<path d="${pathOf(fr, model.outline, true)}" fill="none" stroke="${PALETTE.edge}" stroke-width="1.6"/>`);
  for (const c of model.cutouts) out.push(`<path d="${pathOf(fr, c, true)}" fill="none" stroke="${PALETTE.edge}" stroke-width="1.2"/>`);
  out.push(`</g>`);
  // dimming for a highlight: a veil over the board (group opacity nested in group opacity trips resvg 2.6)
  if (dim) out.push(`<rect x="${ML}" y="${MT}" width="${f((view.maxX - view.minX) * fr.s)}" height="${f((view.maxY - view.minY) * fr.s)}" fill="${PALETTE.canvas}" opacity="0.58" data-role="dim"/>`);

  // ratsnest
  for (const r of o.rats ?? []) if (segBoxDist(r.from.at, r.to.at, view) === 0) out.push(`<line x1="${f(fr.X(r.from.at.x))}" y1="${f(fr.Y(r.from.at.y))}" x2="${f(fr.X(r.to.at.x))}" y2="${f(fr.Y(r.to.at.y))}" stroke="${PALETTE.rat}" stroke-width="1" stroke-dasharray="4 3" opacity="0.85" data-id="${esc(r.id)}"/>`);
  // corridors
  for (const c of o.corridors ?? []) {
    if (c.found && c.path) {
      out.push(`<path d="${pathOf(fr, c.path)}" fill="none" stroke="${PALETTE.corridor}" stroke-width="${f(Math.max(1.5, c.width * fr.s))}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`);
      out.push(`<path d="${pathOf(fr, c.path)}" fill="none" stroke="${PALETTE.corridor}" stroke-width="1" stroke-dasharray="3 2"/>`);
    } else if (c.stuckAt) {
      const x = fr.X(c.stuckAt.x);
      const y = fr.Y(c.stuckAt.y);
      out.push(`<line x1="${f(fr.X(c.from.x))}" y1="${f(fr.Y(c.from.y))}" x2="${f(fr.X(c.to.x))}" y2="${f(fr.Y(c.to.y))}" stroke="${PALETTE.error}" stroke-width="1" stroke-dasharray="2 3"/><path d="M${f(x - 5)} ${f(y - 5)}L${f(x + 5)} ${f(y + 5)}M${f(x - 5)} ${f(y + 5)}L${f(x + 5)} ${f(y - 5)}" stroke="${PALETTE.error}" stroke-width="2"/>`);
    }
  }
  // before and after
  if (o.ghost) out.push(ghostSvg(fr, o.ghost.before, model, o.ghost.changed, layers));
  // highlight
  if (dim) out.push(highlightSvg(fr, model, hlNets, hlIds, layers));
  // findings rings
  for (const m of o.markers ?? []) if (m.kind === "finding") out.push(`<circle cx="${f(fr.X(m.at.x))}" cy="${f(fr.Y(m.at.y))}" r="9" fill="none" stroke="${PALETTE[m.severity ?? "warning"]}" stroke-width="2"/>`);
  // labels
  const lab = o.labels ?? "refs";
  if (lab !== "none") {
    for (const fp of model.footprints) {
      if (!inBox(view, centerOf(fp.box))) continue;
      const bw = (fp.box.maxX - fp.box.minX) * fr.s;
      const bh = (fp.box.maxY - fp.box.minY) * fr.s;
      const color = fp.side === "bottom" ? PALETTE.padBottom : PALETTE.text;
      if (lab === "all" && bh > 40) {
        // close in, pads carry their numbers: the reference goes just above the part
        const above = fr.Y(fp.box.maxY) - 9;
        const y = above > MT + 8 ? above : fr.Y(fp.box.minY) + 9;
        out.push(label(fr, fp.ref, fr.X((fp.box.minX + fp.box.maxX) / 2), y, 12, color, "center", ` data-label="${esc(fp.id)}"`));
        continue;
      }
      const h = Math.max(7, Math.min(16, Math.min(bh * 0.55, (bw / Math.max(1, fp.ref.length)) * 0.95)));
      out.push(label(fr, fp.ref, fr.X((fp.box.minX + fp.box.maxX) / 2), fr.Y((fp.box.minY + fp.box.maxY) / 2), h, color, "center", ` data-label="${esc(fp.id)}"`));
    }
    if (lab === "all") {
      for (const p of model.pads) {
        if (!inBox(view, p)) continue;
        const size = Math.min(p.w, p.h) * fr.s;
        if (size < 9) continue;
        out.push(label(fr, p.number, fr.X(p.x), fr.Y(p.y), Math.min(10, size * 0.55), PALETTE.text, "center"));
      }
      const seen = new Set<string>();
      for (const t of [...model.tracks].sort((a, b) => b.len - a.len)) {
        if (!t.net || !overlaps(t.box, view) || !layers.includes(t.layer) || seen.has(`${t.net}|${t.layer}`) || t.len * fr.s < textWidth(t.net, 7) + 10) continue;
        seen.add(`${t.net}|${t.layer}`);
        const m = polyMidpoint(t.pts);
        if (!inBox(inflateBox(view, -0.5), m)) continue;
        const ang = (-Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x) * 180) / Math.PI;
        const a = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
        const d = textPath(t.net, fr.X(m.x), fr.Y(m.y) - Math.max(5, t.w * fr.s * 0.5 + 5), 7, "center", a);
        out.push(`<path d="${d}" fill="none" stroke="${PALETTE.canvas}" stroke-width="3" stroke-linecap="round" opacity="0.8"/><path d="${d}" fill="none" stroke="${layerColor(model, t.layer)}" stroke-width="1.1" stroke-linecap="round" data-net="${esc(t.net)}"/>`);
      }
    }
  }
  out.push(`</g>`);
  const vw = (view.maxX - view.minX) * fr.s;
  const vh = (view.maxY - view.minY) * fr.s;
  out.push(`<path d="M0 0H${fr.w}V${fr.h}H0ZM${ML} ${MT}V${f(MT + vh)}H${f(ML + vw)}V${MT}Z" fill="${PALETTE.canvas}" fill-rule="evenodd" data-role="frame"/>`);
  // markers (over the frame so a marker at the edge stays whole)
  out.push(markersSvg(fr, o.markers ?? []));
  // axes, title, scale bar
  out.push(axesSvg(fr, model));
  if (o.scaleBar !== false) out.push(scaleBarSvg(fr));
  const caption = o.title ?? `${model.name}  layers ${layers.join(" ")}  origin board center, +Y up`;
  out.push(label(fr, caption, ML, MT / 2, 8, PALETTE.muted, "left"));
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

function silkText(fr: Frame, text: string, x: number, y: number, h: number, rot: number, anchor: "center" | "left" | "right", color: string, extra = ""): string {
  const hp = Math.max(4, h * fr.s * 0.8);
  const d = textPath(text, fr.X(x), fr.Y(y), hp, anchor, -rot);
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(Math.max(0.7, hp * 0.12))}" stroke-linecap="round"${extra}/>` : "";
}

function gridSvg(fr: Frame, model: BoardModel): string {
  const v = fr.box;
  const minor = fr.s >= 12 ? 1 : fr.s >= 4 ? 5 : 10;
  const major = niceStep(Math.max(v.maxX - v.minX, v.maxY - v.minY), 8);
  const out: string[] = [`<g data-role="grid">`];
  const lines = (step: number, color: string, w: number) => {
    const parts: string[] = [];
    for (let x = Math.ceil(v.minX / step) * step; x <= v.maxX + 1e-9; x += step) parts.push(`M${f(fr.X(x))} ${f(fr.Y(v.maxY))}V${f(fr.Y(v.minY))}`);
    for (let y = Math.ceil(v.minY / step) * step; y <= v.maxY + 1e-9; y += step) parts.push(`M${f(fr.X(v.minX))} ${f(fr.Y(y))}H${f(fr.X(v.maxX))}`);
    out.push(`<path d="${parts.join("")}" stroke="${color}" stroke-width="${w}" fill="none"/>`);
  };
  if (minor < major) lines(minor, PALETTE.grid, 0.6);
  lines(major, PALETTE.gridMajor, 0.8);
  // the origin (board center)
  const ox = fr.X(0);
  const oy = fr.Y(0);
  out.push(`<path d="M${f(ox - 7)} ${f(oy)}H${f(ox + 7)}M${f(ox)} ${f(oy - 7)}V${f(oy + 7)}" stroke="${PALETTE.axis}" stroke-width="1"/><circle cx="${f(ox)}" cy="${f(oy)}" r="2.5" fill="none" stroke="${PALETTE.axis}" stroke-width="1"/>`);
  void model;
  out.push(`</g>`);
  return out.join("");
}

function axesSvg(fr: Frame, model: BoardModel): string {
  const v = fr.box;
  const step = niceStep(Math.max(v.maxX - v.minX, v.maxY - v.minY), 8);
  const out: string[] = [`<g data-role="axes">`];
  const ticks: string[] = [];
  const y0 = MT + (v.maxY - v.minY) * fr.s;
  for (let x = Math.ceil(v.minX / step) * step; x <= v.maxX + 1e-9; x += step) {
    ticks.push(`M${f(fr.X(x))} ${f(y0)}v5`);
    out.push(label(fr, f(x), fr.X(x), y0 + 13, 7, PALETTE.axis, "center"));
  }
  for (let y = Math.ceil(v.minY / step) * step; y <= v.maxY + 1e-9; y += step) {
    ticks.push(`M${ML} ${f(fr.Y(y))}h-5`);
    out.push(label(fr, f(y), ML - 8, fr.Y(y), 7, PALETTE.axis, "right"));
  }
  out.push(`<path d="${ticks.join("")}" stroke="${PALETTE.axis}" stroke-width="1"/>`);
  out.push(`<rect x="${ML}" y="${MT}" width="${f((v.maxX - v.minX) * fr.s)}" height="${f((v.maxY - v.minY) * fr.s)}" fill="none" stroke="${PALETTE.gridMajor}" stroke-width="1"/>`);
  out.push(label(fr, "X MM", fr.w - MR, fr.h - 6, 6, PALETTE.muted, "right"));
  out.push(label(fr, "Y MM", 4, MT - 8 > 6 ? MT - 4 : MT, 6, PALETTE.muted, "left"));
  void model;
  out.push(`</g>`);
  return out.join("");
}

function scaleBarSvg(fr: Frame): string {
  const v = fr.box;
  const len = niceStep((v.maxX - v.minX) / 1.2, 5);
  const px = len * fr.s;
  const x1 = fr.w - MR - 8;
  const x0 = x1 - px;
  const y = MT + (v.maxY - v.minY) * fr.s - 10;
  return `<g data-role="scale"><rect x="${f(x0 - 4)}" y="${f(y - 14)}" width="${f(px + 8)}" height="20" fill="${PALETTE.canvas}" opacity="0.75"/><path d="M${f(x0)} ${f(y - 3)}V${f(y + 3)}M${f(x0)} ${f(y)}H${f(x1)}M${f(x1)} ${f(y - 3)}V${f(y + 3)}" stroke="${PALETTE.text}" stroke-width="1.5"/>${label(fr, `${f(len)} MM`, (x0 + x1) / 2, y - 8, 7, PALETTE.text, "center")}</g>`;
}

function markersSvg(fr: Frame, markers: MarkerItem[]): string {
  const placed: { x: number; y: number }[] = [];
  const out: string[] = [`<g data-role="markers">`];
  const offsets: [number, number][] = [
    [12, -12],
    [-12, -12],
    [12, 12],
    [-12, 12],
    [20, 0],
    [-20, 0],
    [0, -20],
    [0, 20],
    [26, -26],
    [-26, -26],
    [26, 26],
    [-26, 26],
  ];
  for (const m of markers) {
    const ax = fr.X(m.at.x);
    const ay = fr.Y(m.at.y);
    const text = String(m.n);
    const r = text.length > 2 ? 9.5 : 8;
    let pos = { x: ax + 12, y: ay - 12 };
    for (const [dx, dy] of offsets) {
      const c = { x: Math.min(fr.w - r - 1, Math.max(r + 1, ax + dx)), y: Math.min(fr.h - r - 1, Math.max(r + 1, ay + dy)) };
      if (placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= 2 * r + 2)) {
        pos = c;
        break;
      }
    }
    placed.push(pos);
    const color = m.kind === "finding" ? PALETTE[m.severity ?? "warning"] : m.kind === "rat" ? PALETTE.rat : m.kind === "corridor" ? PALETTE.corridor : m.kind === "keepout" ? PALETTE.keepout : m.kind === "change" ? PALETTE.highlight : PALETTE.accent;
    out.push(
      `<g data-marker="${m.n}" data-id="${esc(m.id)}"><line x1="${f(ax)}" y1="${f(ay)}" x2="${f(pos.x)}" y2="${f(pos.y)}" stroke="${color}" stroke-width="1"/><circle cx="${f(ax)}" cy="${f(ay)}" r="1.8" fill="${color}"/><circle cx="${f(pos.x)}" cy="${f(pos.y)}" r="${r}" fill="#0b0b0b" stroke="${color}" stroke-width="1.6"/><path d="${textPath(text, pos.x, pos.y, 8, "center")}" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`,
    );
  }
  out.push(`</g>`);
  return out.join("");
}

function highlightSvg(fr: Frame, model: BoardModel, nets: Set<string>, ids: Set<string>, layers: string[]): string {
  const c = PALETTE.highlight;
  const out: string[] = [`<g data-role="highlight">`];
  for (const t of model.tracks) if (layers.includes(t.layer) && ((t.net && nets.has(t.net)) || ids.has(t.id))) out.push(trackSvg(fr, t, c));
  for (const p of model.pads) if ((p.net && nets.has(p.net)) || ids.has(p.id) || ids.has(p.footprint)) out.push(padSvg(fr, p, c));
  for (const v of model.vias) if ((v.net && nets.has(v.net)) || ids.has(v.id)) out.push(viaSvg(fr, v, c));
  for (const a of [...model.zones, ...model.keepouts]) if (ids.has(a.id)) out.push(`<path d="${pathOf(fr, a.outline, true)}" fill="none" stroke="${c}" stroke-width="2"/>`);
  for (const fp of model.footprints) if (ids.has(fp.id)) out.push(boxOutline(fr, fp.box, c, ""));
  out.push(`</g>`);
  return out.join("");
}

const boxOutline = (fr: Frame, b: BoxMm, color: string, dash: string): string =>
  `<rect x="${f(fr.X(b.minX) - 2)}" y="${f(fr.Y(b.maxY) - 2)}" width="${f((b.maxX - b.minX) * fr.s + 4)}" height="${f((b.maxY - b.minY) * fr.s + 4)}" fill="none" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;

function ghostSvg(fr: Frame, before: BoardModel, after: BoardModel, changed: string[], layers: string[]): string {
  const ids = new Set(changed);
  const out: string[] = [`<g data-role="ghost-before">`];
  const dash = ` stroke-dasharray="4 3"`;
  const old = PALETTE.ghost;
  for (const t of before.tracks) if (ids.has(t.id) && layers.includes(t.layer)) out.push(trackSvg(fr, { ...t, w: Math.min(t.w, 0.12) }, old, dash));
  for (const v of before.vias) if (ids.has(v.id)) out.push(`<circle cx="${f(fr.X(v.x))}" cy="${f(fr.Y(v.y))}" r="${f((v.d / 2) * fr.s)}" fill="none" stroke="${old}" stroke-width="1.2"${dash}/>`);
  for (const fp of before.footprints) if (ids.has(fp.id)) {
    out.push(boxOutline(fr, fp.box, old, "4 3"));
    for (const p of fp.pads) out.push(padSvg(fr, p, "none", ` stroke="${old}" stroke-width="1"${dash}`));
  }
  for (const a of [...before.zones, ...before.keepouts]) if (ids.has(a.id)) out.push(`<path d="${pathOf(fr, a.outline, true)}" fill="none" stroke="${old}" stroke-width="1.2"${dash}/>`);
  out.push(`</g><g data-role="ghost-after">`);
  const neu = PALETTE.highlight;
  for (const t of after.tracks) if (ids.has(t.id) && layers.includes(t.layer)) out.push(trackSvg(fr, t, neu, ` opacity="0.9"`));
  for (const v of after.vias) if (ids.has(v.id)) out.push(viaSvg(fr, v, neu));
  for (const fp of after.footprints) if (ids.has(fp.id)) {
    out.push(boxOutline(fr, fp.box, neu, ""));
    for (const p of fp.pads) out.push(padSvg(fr, p, neu, ` opacity="0.8"`));
  }
  for (const a of [...after.zones, ...after.keepouts]) if (ids.has(a.id)) out.push(`<path d="${pathOf(fr, a.outline, true)}" fill="none" stroke="${neu}" stroke-width="1.6"/>`);
  out.push(`</g>`);
  out.push(label(fr, "OLD: DASHED GRAY   NEW: CYAN", fr.w - MR, MT / 2, 7, PALETTE.muted, "right"));
  return out.join("");
}


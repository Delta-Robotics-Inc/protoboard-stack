/**
 * SVG renderings of a symbol. Every stroke is `currentColor`: the host sets the color from its theme (dark canvas,
 * paper print), and nothing in a symbol file names a color.
 *
 *   icon       Lucide's form: a 24 × 24 viewBox, 2 px round stroke, no fill (a dot role is filled), roles in
 *              icon.omitRoles left out. A 34 px glyph is scaled into the same box with the stroke scaled to match.
 *   schematic  the body at sheet scale: `unitPx` screen pixels per grid unit, a 0.1-unit stroke, optional anchor
 *              markers and pin labels, text for code-built symbols.
 */
import { MARGIN, UNIT, type BodyElement, type Frame, type SymbolDef, type SymbolPin } from "./types.ts";
import { SHEET_STROKE, ICON_STROKE } from "./check.ts";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One element as SVG markup (geometry attributes only; the caller sets stroke and fill). */
export function elementSvg(el: BodyElement, opts: { font?: string } = {}): string {
  const fill = el.role === "dot" ? ' fill="currentColor"' : "";
  switch (el.el) {
    case "path":
      return `<path d="${el.d}"${fill}/>`;
    case "line":
      return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}"${fill}/>`;
    case "polyline":
      return `<polyline points="${el.points}"${fill}/>`;
    case "polygon":
      return `<polygon points="${el.points}"${fill}/>`;
    case "circle":
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}"${fill}/>`;
    case "ellipse":
      return `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}"${fill}/>`;
    case "rect":
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}"${el.rx ? ` rx="${el.rx}"` : ""}${fill}/>`;
    case "text": {
      const anchor = el.anchor ?? "start";
      return `<text x="${fmt(el.x!)}" y="${fmt(el.y!)}" font-size="${fmt(el.size ?? 3)}" text-anchor="${anchor}" fill="currentColor" stroke="none" font-family="${opts.font ?? "Consolas, 'DejaVu Sans Mono', monospace"}">${esc(el.text ?? "")}</text>`;
    }
  }
}

export interface Form {
  frame: Frame;
  pins: SymbolPin[];
  body: BodyElement[];
}

/** The default body or a variant's, with the frame and pins that go with it. */
export function formOf(def: SymbolDef, variant?: string): Form {
  if (!variant || variant === "body") return { frame: def.frame, pins: def.pins, body: def.body };
  const v = def.variants[variant];
  if (!v?.body) throw new Error(`${def.id} has no drawn variant ${variant}`);
  return { frame: v.frame ?? def.frame, pins: v.pins ?? def.pins, body: v.body };
}

/** The form an icon is drawn from (`pack:<id>` needs the pack to resolve). */
export function iconForm(def: SymbolDef, lookup?: (id: string) => SymbolDef | undefined): { form: Form; omit: string[] } {
  const from = def.icon.from;
  if (from.startsWith("pack:")) {
    const other = lookup?.(from.slice(5));
    if (!other) throw new Error(`${def.id}: icon from unknown ${from}`);
    return iconForm(other, lookup);
  }
  return { form: formOf(def, from), omit: def.icon.omitRoles };
}

/** The icon's inner markup in a 24 × 24 box (no root element). */
export function iconInner(def: SymbolDef, lookup?: (id: string) => SymbolDef | undefined): string {
  const { form, omit } = iconForm(def, lookup);
  const els = form.body.filter((e) => !omit.includes(e.role) && e.el !== "text");
  const s = 24 / Math.max(form.frame.w, form.frame.h);
  const inner = els.map((e) => elementSvg(e)).join("");
  return s === 1 ? inner : `<g transform="scale(${fmt(s)})" stroke-width="${fmt(ICON_STROKE / s)}">${inner}</g>`;
}

/** A standalone icon SVG in Lucide's root form. */
export function iconSvg(def: SymbolDef, lookup?: (id: string) => SymbolDef | undefined, size = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconInner(def, lookup)}</svg>`;
}

export interface SchematicOptions {
  /** Screen pixels per grid unit (the canvas uses 16 at zoom 1). */
  unitPx?: number;
  variant?: string;
  /** Draw a small open ring on each anchor. */
  anchors?: boolean;
  /** Label each anchor with the pin id (review sheets). */
  pinIds?: boolean;
  /** Color for anchors and pin ids (default currentColor). */
  accent?: string;
  /** Faint lattice dots (review sheets). */
  lattice?: string;
}

/** The symbol at sheet scale, as an <svg> element sized in screen pixels. */
export function schematicSvg(def: SymbolDef, opts: SchematicOptions = {}): string {
  const form = formOf(def, opts.variant);
  const unitPx = opts.unitPx ?? 16;
  const k = unitPx / UNIT; // screen px per frame px
  const W = form.frame.w * k;
  const H = form.frame.h * k;
  const parts: string[] = [];
  if (opts.lattice) {
    let dots = "";
    for (let x = MARGIN; x <= form.frame.w - MARGIN; x += UNIT) for (let y = MARGIN; y <= form.frame.h - MARGIN; y += UNIT) dots += `<circle cx="${x}" cy="${y}" r="0.35"/>`;
    parts.push(`<g fill="${opts.lattice}" stroke="none">${dots}</g>`);
  }
  const drawn = form.body.filter((e) => e.el !== "text");
  const text = form.body.filter((e) => e.el === "text");
  parts.push(`<g fill="none" stroke="currentColor" stroke-width="${SHEET_STROKE}" stroke-linecap="round" stroke-linejoin="round">${drawn.map((e) => elementSvg(e)).join("")}</g>`);
  if (text.length) parts.push(`<g>${text.map((e) => elementSvg(e)).join("")}</g>`);
  const accent = opts.accent ?? "currentColor";
  if (opts.anchors || opts.pinIds) {
    for (const p of form.pins) {
      const x = MARGIN + UNIT * p.at[0];
      const y = MARGIN + UNIT * p.at[1];
      if (opts.anchors) parts.push(`<circle cx="${x}" cy="${y}" r="0.7" fill="none" stroke="${accent}" stroke-width="0.3"/>`);
      if (opts.pinIds && def.origin === "drawn") {
        const dx = p.dir === "left" ? 0.8 : p.dir === "right" ? -0.8 : 0.9;
        const dy = p.dir === "up" ? 2.2 : p.dir === "down" ? -1 : -0.9;
        const anchor = p.dir === "right" ? "end" : "start";
        parts.push(`<text x="${fmt(x + dx)}" y="${fmt(y + dy)}" font-size="1.9" fill="${accent}" text-anchor="${anchor}" font-family="Consolas, monospace">${esc(p.id)}</text>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}" height="${fmt(H)}" viewBox="0 0 ${form.frame.w} ${form.frame.h}">${parts.join("")}</svg>`;
}

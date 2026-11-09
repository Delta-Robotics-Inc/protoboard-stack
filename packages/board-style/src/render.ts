/**
 * The as-built render: a board side as the fab would make it in the theme's colors (mask, silkscreen, finish), for
 * the agent to look at and for before and after images of a correction. Top is seen from above; bottom is seen from
 * below (mirrored left to right), so bottom text reads normally. Silkscreen is drawn under the mask openings, as
 * fabs clip it. Text uses the same stroke font as the knockout tags, so a tag and its render agree.
 *
 * Output is SVG with paths only (no fonts); `renderPng` rasterizes it through `@protoboardai/board-scene`.
 */
import { arcCenter, footprintToWorld, recordsOfKind, sideLayer, toMm, type BoardDocument, type DerivedZoneFill, type FootprintGraphic, type Side, type Vertex } from "@protoboardai/board";
import { buildModel, flattenContour, type Shape } from "@protoboardai/board-checks";
import { svgToPng, textPath } from "@protoboardai/board-scene";
import { FINISH_HEX, MASK_HEX, SILK_HEX } from "./fab.js";
import { textStrokes } from "./geom.js";
import { tok, type ResolvedStyle } from "./resolve.js";

export interface RenderOptions {
  side: Side;
  /** Pixels per millimeter (default 20). */
  scale?: number;
  /** Derived zone fill to draw copper pours under the mask. */
  fill?: DerivedZoneFill;
  /** A caption under the board (default: theme name and side; empty string for none). */
  caption?: string;
  /** Margin around the board, mm (default 2). */
  margin?: number;
  /** Draw only the silkscreen (and the outline): for comparing silk between boards. */
  silkOnly?: boolean;
  /** Mark these points (finding locations) with numbered rings. */
  marks?: { x: number; y: number; label?: string }[];
}

const f2 = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

function hex(style: ResolvedStyle, side: Side): { mask: string; maskAlpha: number; silk: string; copper: string; under: string } {
  const maskTok = tok<string>(style, "preview.maskHex");
  const silkTok = tok<string>(style, "preview.silkHex");
  const copTok = tok<string>(style, "preview.copperHex");
  const maskFull = maskTok !== "auto" ? maskTok : MASK_HEX[tok<string>(style, `fab.mask.color.${side}`)] ?? "#1E5631";
  const mask = maskFull.slice(0, 7);
  const maskAlpha = maskFull.length === 9 ? parseInt(maskFull.slice(7), 16) / 255 : 1;
  const silk = silkTok !== "auto" ? silkTok.slice(0, 7) : SILK_HEX[tok<string>(style, `fab.silk.color.${side}`)] ?? "#F4F4F0";
  const copper = copTok !== "auto" ? copTok.slice(0, 7) : FINISH_HEX[tok<string>(style, "fab.finish")] ?? "#C4C8CC";
  return { mask, maskAlpha, silk, copper, under: mix(mask, "#C07A3C", 0.12) };
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The SVG of one board side as built. */
export function renderAsBuilt(doc: BoardDocument, style: ResolvedStyle, o: RenderOptions): string {
  const s = o.scale ?? 20;
  const margin = (o.margin ?? 2) * 1e6;
  const outline = doc.records.get("outline");
  const ring = outline?.kind === "outline" ? flattenContour(outline.outline) : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]);
    maxX = Math.max(maxX, ring[i]);
    minY = Math.min(minY, ring[i + 1]);
    maxY = Math.max(maxY, ring[i + 1]);
  }
  if (!Number.isFinite(minX)) [minX, minY, maxX, maxY] = [-20e6, -15e6, 20e6, 15e6];
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  const caption = o.caption ?? `${style.theme.name}, ${o.side}`;
  const capH = caption ? 1.6 * s : 0;
  const W = ((maxX - minX) / 1e6) * s;
  const H = ((maxY - minY) / 1e6) * s + capH;
  const bottom = o.side === "bottom";
  const X = (x: number) => (((bottom ? maxX - x : x - minX) / 1e6) * s);
  const Y = (y: number) => (((maxY - y) / 1e6) * s);
  const P = (x: number, y: number) => `${f2(X(x))} ${f2(Y(y))}`;
  const ringPath = (r: ArrayLike<number>) => {
    let d = "";
    for (let i = 0; i < r.length; i += 2) d += `${i ? "L" : "M"}${P(r[i], r[i + 1])}`;
    return `${d}Z`;
  };
  const c = hex(style, o.side);
  const copperLayer = o.side;
  const silkLayer = o.side === "top" ? "top_silkscreen" : "bottom_silkscreen";
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}" height="${f2(H)}" viewBox="0 0 ${f2(W)} ${f2(H)}">`);
  out.push(`<rect width="${f2(W)}" height="${f2(H)}" fill="#202024"/>`);
  // board body under the mask, then the mask
  const cutouts = recordsOfKind(doc, "cutout").map((cu) => ringPath(flattenContour(cu.outline)));
  const body = `${ringPath(ring)}${cutouts.join("")}`;
  out.push(`<path d="${body}" fill="#3B3A2E" fill-rule="evenodd"/>`);
  out.push(`<path d="${body}" fill="${c.mask}" fill-opacity="${f2(c.maskAlpha)}" fill-rule="evenodd"/>`);
  const copperOn = !o.silkOnly;
  // copper under the mask: pours and tracks
  for (const fl of copperOn ? (o.fill?.fills ?? []) : []) {
    if (fl.layer !== copperLayer) continue;
    for (const p of fl.polygons) out.push(`<path d="${ringPath(p.outer)}${p.holes.map(ringPath).join("")}" fill="${c.under}" fill-rule="evenodd"/>`);
  }
  const strokePath = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${P(x, y)}`).join("");
  for (const t of recordsOfKind(doc, "track")) {
    if (t.layer !== copperLayer || !copperOn) continue;
    out.push(`<path d="${strokePath(trackPoints(t.start, t.end, t.sweep))}" stroke="${c.under}" stroke-width="${f2(toMm(t.width) * s)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
  }
  // silkscreen
  const silk: string[] = [];
  const sw = (w: number) => f2(Math.max(toMm(w) * s, 0.5));
  const drawGraphic = (g: FootprintGraphic, map: (x: number, y: number) => [number, number]) => {
    const w = g.stroke_width;
    if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) {
      const a = map(g.start.x, g.start.y);
      const b = map(g.end.x, g.end.y);
      silk.push(`<path d="${strokePath(trackPoints({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, g.sweep))}" stroke="${c.silk}" stroke-width="${sw(w)}" stroke-linecap="round" fill="none"/>`);
    } else if (g.shape === "circle" && g.center && g.radius) {
      const [cx, cy] = map(g.center.x, g.center.y);
      silk.push(`<circle cx="${f2(X(cx))}" cy="${f2(Y(cy))}" r="${f2(toMm(g.radius) * s)}" ${g.filled ? `fill="${c.silk}"` : `fill="none" stroke="${c.silk}" stroke-width="${sw(w)}"`}/>`);
    } else if (g.shape === "rect" && g.center && g.width && g.height) {
      const hw = g.width / 2;
      const hh = g.height / 2;
      const rot = (((g.rotation ?? 0) / 1000) * Math.PI) / 180;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const pts: number[] = [];
      for (const [x, y] of [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]) {
        const m = map(g.center.x + x * cs - y * sn, g.center.y + x * sn + y * cs);
        pts.push(m[0], m[1]);
      }
      silk.push(`<path d="${ringPath(pts)}" ${g.filled ? `fill="${c.silk}"` : `fill="none" stroke="${c.silk}" stroke-width="${sw(w)}" stroke-linejoin="round"`}/>`);
    } else if (g.points && g.points.length >= 2) {
      const closed = g.shape === "polygon";
      const flat = flattenContour(g.points as Vertex[], map, closed);
      if (closed) silk.push(`<path d="${ringPath(flat)}" ${g.filled ? `fill="${c.silk}" fill-rule="nonzero"${w ? ` stroke="${c.silk}" stroke-width="${sw(w)}"` : ""}` : `fill="none" stroke="${c.silk}" stroke-width="${sw(w)}" stroke-linejoin="round"`}/>`);
      else {
        const pts: [number, number][] = [];
        for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
        silk.push(`<path d="${strokePath(pts)}" stroke="${c.silk}" stroke-width="${sw(w)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
      }
    }
  };
  const drawText = (text: string, x: number, y: number, height: number, stroke: number, rotation: number, anchor: "left" | "center" | "right", mirrored: boolean) => {
    const lines = textStrokes(text, { x, y, height, rotation, anchor, mirrored });
    const d = lines.map((l) => strokePath(l)).join("");
    if (d) silk.push(`<path d="${d}" stroke="${c.silk}" stroke-width="${sw(stroke)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
  };
  for (const fp of recordsOfKind(doc, "footprint")) {
    const map = (x: number, y: number): [number, number] => {
      const w = footprintToWorld(fp, { x, y });
      return [w.x, w.y];
    };
    for (const g of fp.graphics ?? []) if (sideLayer(g.layer, fp.side) === silkLayer) drawGraphic(g, map);
    for (const t of fp.texts ?? []) {
      if (sideLayer(t.layer, fp.side) !== silkLayer) continue;
      const text = t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text;
      const [x, y] = map(t.x, t.y);
      const rot = fp.rotation + (fp.side === "bottom" ? -(t.rotation ?? 0) : t.rotation ?? 0);
      drawText(text, x, y, t.height, t.stroke_width ?? Math.round(t.height / 8), rot, t.anchor ?? "center", fp.side === "bottom");
    }
  }
  const id = (x: number, y: number): [number, number] => [x, y];
  for (const g of recordsOfKind(doc, "graphic")) if (g.layer === silkLayer) drawGraphic(g, id);
  for (const t of recordsOfKind(doc, "text")) if (t.layer === silkLayer) drawText(t.text, t.x, t.y, t.height, t.stroke_width ?? Math.round(t.height / 8), t.rotation ?? 0, t.anchor ?? "center", !!t.mirrored);
  out.push(`<g>${silk.join("")}</g>`);
  // exposed copper and holes (mask openings clip the silkscreen)
  const m = buildModel(doc);
  const shapeSvg = (sh: Shape, fill: string): string => {
    const k = sh.core;
    if (k.t === "pt") return `<circle cx="${f2(X(k.x))}" cy="${f2(Y(k.y))}" r="${f2((sh.r / 1e6) * s)}" fill="${fill}"/>`;
    if (k.t === "seg") return `<path d="M${P(k.ax, k.ay)}L${P(k.bx, k.by)}" stroke="${fill}" stroke-width="${f2(((2 * sh.r) / 1e6) * s)}" stroke-linecap="round"/>`;
    if (k.t === "poly") return `<path d="${k.rings.map((r) => ringPath(r)).join("")}" fill="${fill}" fill-rule="evenodd"${sh.r ? ` stroke="${fill}" stroke-width="${f2(((2 * sh.r) / 1e6) * s)}" stroke-linejoin="round"` : ""}/>`;
    return "";
  };
  const exposed: string[] = [];
  if (!copperOn) m.pads.clear();
  for (const p of m.pads.values()) if (p.layers.includes(copperLayer)) exposed.push(shapeSvg(p.shape, c.copper));
  for (const cu of m.copper) {
    if (cu.kind !== "via" || cu.layer !== copperLayer || !copperOn) continue;
    const v = doc.records.get(cu.id);
    const tented = v?.kind === "via" ? (v.tented ?? (tok<string>(style, "fab.viaCovering") === "open" ? "none" : "both")) : "both";
    const covered = tented === "both" || tented === copperLayer;
    exposed.push(shapeSvg(cu.shape, covered ? c.under : c.copper));
  }
  if (copperOn) for (const h of m.holes) exposed.push(shapeSvg(h.shape, "#0B0B0C"));
  out.push(`<g>${exposed.join("")}</g>`);
  out.push(`<path d="${body}" fill="none" stroke="#9A9A9A" stroke-width="1"/>`);
  for (const [i, mk] of (o.marks ?? []).entries()) {
    out.push(`<circle cx="${f2(X(mk.x))}" cy="${f2(Y(mk.y))}" r="${f2(0.9 * s)}" fill="none" stroke="#FF5C00" stroke-width="2"/>`);
    out.push(`<path d="${textPath(mk.label ?? String(i + 1), X(mk.x) + 1.1 * s, Y(mk.y) - 1.1 * s, 0.9 * s, "left")}" stroke="#FF5C00" stroke-width="1.6" fill="none"/>`);
  }
  if (caption) out.push(`<path d="${textPath(caption.toUpperCase(), 0.5 * s, H - capH / 2, 0.7 * s, "left")}" stroke="#B8B8B8" stroke-width="1.4" fill="none" stroke-linecap="round"/>`);
  out.push("</svg>");
  return out.join("\n") + "\n";
}

/** Points along a track or line, arcs flattened at 2 degree steps. */
function trackPoints(a: { x: number; y: number }, b: { x: number; y: number }, sweep?: number): [number, number][] {
  if (!sweep) return [
    [a.x, a.y],
    [b.x, b.y],
  ];
  const cc = arcCenter(a as never, b as never, sweep);
  const a0 = Math.atan2(a.y - cc.y, a.x - cc.x);
  const sw = ((sweep / 1000) * Math.PI) / 180;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / 2000));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([cc.x + cc.r * Math.cos(a0 + (sw * i) / n), cc.y + cc.r * Math.sin(a0 + (sw * i) / n)]);
  return pts;
}

/** A side as a PNG (bytes) at a pixel width. */
export function renderPng(doc: BoardDocument, style: ResolvedStyle, o: RenderOptions & { width?: number }): Uint8Array {
  return svgToPng(renderAsBuilt(doc, style, o), o.width ? { width: o.width } : {}).png;
}

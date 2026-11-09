/**
 * Images of what was written: a Gerber file read back (`readGerber`) drawn as SVG, so the picture shows what the fab
 * receives, not what the editor shows. Clear polarity is drawn with SVG masks in file order. Labels are stroke paths
 * from the stack's single-stroke font, so the SVG needs no fonts and its PNG is the same on every machine.
 */
import { textPath } from "@protoboardai/board-scene";
import type { Pt } from "../geom.js";
import { apertureShapes, arcPoints, type GerberRead, type GObject } from "./read.js";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SvgLayer {
  read: GerberRead;
  color: string;
  opacity?: number;
}

export interface SvgOptions {
  /** The area shown, board frame nm (default: everything drawn). */
  box?: Box;
  /** Pixels per millimeter (default 20, capped so the long edge stays at or under 2576 px). */
  scale?: number;
  background?: string;
  /** A caption drawn under the image. */
  caption?: string;
  /** Mirror left to right (a bottom view). */
  mirror?: boolean;
}

/** Number formatting for SVG coordinates in millimeters (4 decimals). */
export const f = (nm: number): string => {
  const s = (Math.round(nm / 100) / 10_000).toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

const ringPath = (r: readonly Pt[], ox = 0, oy = 0): string => (r.length ? `M${r.map((p) => `${f(p.x + ox)} ${f(p.y + oy)}`).join("L")}Z` : "");

/** The extent of a read file's objects (aperture sizes included). */
export function extentOf(read: GerberRead): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number, r = 0) => {
    b.minX = Math.min(b.minX, x - r);
    b.minY = Math.min(b.minY, y - r);
    b.maxX = Math.max(b.maxX, x + r);
    b.maxY = Math.max(b.maxY, y + r);
  };
  const size = new Map<number, number>();
  for (const [code, ap] of read.apertures) {
    let m = 0;
    for (const s of apertureShapes(read, ap)) for (const p of s.ring) m = Math.max(m, Math.hypot(p.x, p.y));
    size.set(code, m);
  }
  for (const o of read.objects) {
    if (o.k === "flash") add(o.x, o.y, size.get(o.ap) ?? 0);
    else if (o.k === "region") for (const p of o.ring) add(p.x, p.y);
    else {
      const r = size.get(o.ap) ?? 0;
      for (const p of o.arc ? arcPoints(o.from, o.to, o.arc) : [o.from, o.to]) add(p.x, p.y, r);
    }
  }
  return b;
}

/** SVG markup (inside a y-flipped group) for one read file. */
export function objectsSvg(read: GerberRead, color: string, idPrefix: string): string {
  const shapes = new Map<number, string>();
  const width = new Map<number, number>();
  for (const [code, ap] of read.apertures) {
    const s = apertureShapes(read, ap);
    shapes.set(code, s.filter((x) => !x.clear).map((x) => ringPath(x.ring)).join(""));
    if (ap.template === "C") width.set(code, (read.units === "mm" ? 1e6 : 25.4e6) * ap.params[0]);
    else {
      let m = Infinity;
      for (const x of s) for (const p of x.ring) m = Math.min(m, Math.hypot(p.x, p.y));
      width.set(code, Number.isFinite(m) ? 2 * m : 0);
    }
  }
  const pathOf = (o: GObject): { d: string; stroke?: number } => {
    if (o.k === "flash") {
      const shape = shapes.get(o.ap) ?? "";
      return { d: shape.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_m, x: string, y: string) => `${f(Number(x) * 1e6 + o.x)} ${f(Number(y) * 1e6 + o.y)}`) };
    }
    if (o.k === "region") return { d: ringPath(o.ring) };
    const pts = o.arc ? arcPoints(o.from, o.to, o.arc) : [o.from, o.to];
    return { d: `M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}`, stroke: width.get(o.ap) ?? 0 };
  };
  const draw = (o: GObject, fill: string): string => {
    const p = pathOf(o);
    if (!p.d) return "";
    if (p.stroke !== undefined) return `<path d="${p.d}" fill="none" stroke="${fill}" stroke-width="${f(p.stroke)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<path d="${p.d}" fill="${fill}"/>`;
  };
  let content = "";
  let defs = "";
  let k = 0;
  let i = 0;
  const objs = read.objects;
  while (i < objs.length) {
    if (objs[i].dark) {
      content += draw(objs[i], color);
      i++;
      continue;
    }
    let clear = "";
    while (i < objs.length && !objs[i].dark) clear += draw(objs[i++], "#000");
    const id = `${idPrefix}m${k++}`;
    defs += `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/>${clear}</mask>`;
    content = `<g mask="url(#${id})">${content}</g>`;
  }
  return `${defs ? `<defs>${defs}</defs>` : ""}${content}`;
}

/** Stroke text in screen coordinates (y down), millimeters. */
export function label(text: string, x: number, y: number, h: number, color: string, anchor: "left" | "center" | "right" = "left", width = h * 0.12): string {
  const d = textPath(text.replace(/;/g, ",").replace(/[^ -~]/g, "?"), x, y, h, anchor, 0);
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"/>` : "";
}

/** An SVG of one or more read Gerber files stacked in order (first at the bottom). */
export function gerbersToSvg(layers: SvgLayer[], options: SvgOptions = {}): string {
  let box = options.box;
  if (!box) {
    box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const l of layers) {
      const e = extentOf(l.read);
      box = { minX: Math.min(box.minX, e.minX), minY: Math.min(box.minY, e.minY), maxX: Math.max(box.maxX, e.maxX), maxY: Math.max(box.maxY, e.maxY) };
    }
    if (!Number.isFinite(box.minX)) box = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
  }
  const margin = Math.max(1e6, 0.03 * Math.max(box.maxX - box.minX, box.maxY - box.minY));
  const wMm = (box.maxX - box.minX + 2 * margin) / 1e6;
  const hMm = (box.maxY - box.minY + 2 * margin) / 1e6;
  const capMm = options.caption ? Math.min(Math.max(1.2, wMm * 0.035), (wMm * 0.94 * 6) / Math.max(1, options.caption.length * 5.5)) : 0;
  const scale = Math.min(options.scale ?? 20, 2576 / Math.max(wMm, hMm + capMm * 2));
  const W = Math.round(wMm * scale);
  const H = Math.round((hMm + capMm * 2) * scale);
  const x0 = box.minX - margin;
  const y1 = box.maxY + margin;
  const flip = options.mirror ? `translate(${f(box.maxX + margin)} ${f(y1)}) scale(-1 -1)` : `translate(${f(-x0)} ${f(y1)}) scale(1 -1)`;
  const groups = layers.map((l, i) => `<g opacity="${l.opacity ?? 1}">${objectsSvg(l.read, l.color, `l${i}`)}</g>`).join("");
  const cap = options.caption ? label(options.caption, capMm * 0.6, hMm + capMm, capMm, "#cfd6dd") : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${wMm.toFixed(4)} ${(hMm + capMm * 2).toFixed(4)}">`,
    `<rect x="0" y="0" width="${wMm.toFixed(4)}" height="${(hMm + capMm * 2).toFixed(4)}" fill="${options.background ?? "#10151b"}"/>`,
    `<g transform="${flip}">${groups}</g>`,
    cap,
    "</svg>",
    "",
  ].join("\n");
}

/** Colors for layer kinds (fab-like, dark background). */
export const LAYER_COLORS: Record<string, string> = {
  copper: "#d8a24a",
  inner: "#7fb069",
  soldermask: "#3fa7d6",
  paste: "#b8b8c8",
  legend: "#f2f2f2",
  profile: "#ffd23f",
  drill: "#ff6b6b",
};

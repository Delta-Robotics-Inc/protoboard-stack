/**
 * The board document as fabrication layers: per layer, the flashes, draws and regions a Gerber file holds, with the
 * X2 aperture function and object attributes each object carries. Every Gerber writer and image reads this model,
 * never the document directly, so each fab layer has one definition.
 *
 * Coordinates stay integer nanometers in the board frame; the writers subtract the chosen origin.
 */
import {
  copperLayers,
  footprintToWorld,
  normAngle,
  padsOf,
  rotatePoint,
  sideLayer,
  viaLayers,
  recordsOfKind,
  type BoardDocument,
  type CopperLayer,
  type FootprintGraphic,
  type FootprintRec,
  type Pad,
  type Side,
  type Vertex,
  type WorldPad,
} from "@protoboardai/board";
import { contourPath, flattenContour, flattenPath, footprintTextStrokes, fracture, openPath, ringOf, textStrokes, type PathPt, type Pt } from "./geom.js";
import type { ResolvedFill } from "./fill.js";

/** An aperture's shape. Lengths nm; `rot` millidegrees counterclockwise. */
export type ApertureShape =
  | { t: "C"; d: number }
  | { t: "R"; w: number; h: number }
  | { t: "O"; w: number; h: number }
  | { t: "RoundRect"; r: number; w: number; h: number; rot: number }
  | { t: "RotRect"; w: number; h: number; rot: number }
  | { t: "RotOval"; w: number; h: number; rot: number }
  /** A polygon pad: vertices relative to the flash point, world orientation, flat nm. */
  | { t: "Outline"; pts: number[] };

export interface ObjAttrs {
  /** `.N`: net name ("" not on a net, "N/C" a pad on no net). */
  N?: string;
  /** `.P`: reference designator, pin number, pin function. */
  P?: [string, string, string?];
  /** `.C`: reference designator. */
  C?: string;
}

interface Base {
  /** X2 `.AperFunction` value (`SMDPad,CuDef`, `ComponentPad`, `ViaPad`, `Conductor`, `Profile`, ...). */
  fn?: string;
  attrs?: ObjAttrs;
  /** Clear polarity (LPC): erases what is below it (silkscreen clipped by mask openings). */
  clear?: true;
  /** The record (or pad) id it comes from. */
  src: string;
}
export interface Flash extends Base {
  k: "flash";
  ap: ApertureShape;
  x: number;
  y: number;
}
export interface Draw extends Base {
  k: "draw";
  /** A round aperture of this diameter. */
  width: number;
  path: PathPt[];
}
export interface Region extends Base {
  k: "region";
  ring: Pt[];
}
export type PlotObj = Flash | Draw | Region;

export type LayerKind = "copper" | "soldermask" | "paste" | "legend" | "profile";
export interface PlotLayer {
  /** `copper:top`, `soldermask:bottom`, `profile`, ... */
  id: string;
  kind: LayerKind;
  side?: Side;
  copper?: CopperLayer;
  /** 1-based copper index (L1 top). */
  index?: number;
  /** X2 `.FileFunction` value. */
  fileFunction: string;
  polarity: "Positive" | "Negative";
  objects: PlotObj[];
}

export interface PlotOptions {
  /** Mask opening growth for pads without their own `mask_margin`, nm (default 0). */
  maskExpansion?: number;
  /** Paste shrink (negative) or growth for pads without `paste_margin`, nm (default 0). */
  pasteExpansion?: number;
  /** Vias without a `tented` value: covered by mask on both sides (default true). */
  tentVias?: boolean;
  /** Clear silkscreen from mask openings (clear polarity on the legend layer), as JLCPCB asks (default false). */
  clipSilkToMask?: boolean;
  /** Width of the profile line, nm (default 0.1 mm). */
  profileWidth?: number;
  /** Draw footprint value texts that sit on silkscreen (default true). */
  values?: boolean;
  /** Copper and drill object attributes `.N`, `.P`, `.C` (default true). */
  netAttributes?: boolean;
}

export interface Plot {
  layers: PlotLayer[];
  copper: CopperLayer[];
  /** What the plot approximated or left out, in plain words. */
  notes: string[];
}

const isAxis = (rot: number): boolean => rot % 90_000 === 0;
const swaps = (rot: number): boolean => rot === 90_000 || rot === 270_000;

/** The aperture of a rectangle-like shape at a world rotation. */
function shapeAp(shape: Pad["shape"], w: number, h: number, corner: number, rotation: number): ApertureShape {
  let rot = normAngle(rotation);
  if (shape === "circle") return { t: "C", d: w };
  if (shape === "roundrect") {
    if (corner <= 0) return shapeAp("rect", w, h, 0, rot);
    if (2 * corner >= Math.min(w, h)) return shapeAp("oval", w, h, 0, rot);
  }
  if (shape === "oval" && w === h) return { t: "C", d: w };
  if (isAxis(rot)) {
    const [W, H] = swaps(rot) ? [h, w] : [w, h];
    if (shape === "rect" || shape === "polygon") return { t: "R", w: W, h: H };
    if (shape === "oval") return { t: "O", w: W, h: H };
    return { t: "RoundRect", r: corner, w: W, h: H, rot: 0 };
  }
  if (shape === "oval") {
    if (w < h) return { t: "RotOval", w: h, h: w, rot: normAngle(rot + 90_000) };
    return { t: "RotOval", w, h, rot };
  }
  if (shape === "roundrect") return { t: "RoundRect", r: corner, w, h, rot };
  rot = normAngle(rot);
  return { t: "RotRect", w, h, rot };
}

/** Grow (or shrink, negative `m`) an aperture by `m` on every side; undefined when nothing is left. */
export function growAp(ap: ApertureShape, m: number): ApertureShape | undefined {
  if (m === 0) return ap;
  const ok = (...v: number[]) => v.every((x) => x > 0);
  switch (ap.t) {
    case "C":
      return ok(ap.d + 2 * m) ? { t: "C", d: ap.d + 2 * m } : undefined;
    case "R":
    case "O":
      return ok(ap.w + 2 * m, ap.h + 2 * m) ? { ...ap, w: ap.w + 2 * m, h: ap.h + 2 * m } : undefined;
    case "RotRect":
    case "RotOval":
      return ok(ap.w + 2 * m, ap.h + 2 * m) ? { ...ap, w: ap.w + 2 * m, h: ap.h + 2 * m } : undefined;
    case "RoundRect": {
      if (!ok(ap.w + 2 * m, ap.h + 2 * m)) return undefined;
      const r = Math.max(0, ap.r + m);
      const w = ap.w + 2 * m;
      const h = ap.h + 2 * m;
      if (r === 0) return ap.rot === 0 ? { t: "R", w, h } : { t: "RotRect", w, h, rot: ap.rot };
      if (2 * r >= Math.min(w, h)) return ap.rot === 0 ? { t: "O", w, h } : w >= h ? { t: "RotOval", w, h, rot: ap.rot } : { t: "RotOval", w: h, h: w, rot: normAngle(ap.rot + 90_000) };
      return { ...ap, r, w, h };
    }
    case "Outline": {
      const pts = offsetRing(ringOf(ap.pts), m);
      return pts ? { t: "Outline", pts: pts.flatMap((p) => [p.x, p.y]) } : undefined;
    }
  }
}

/** Offset a simple ring by `d` (miter joins, mitre limited to 4 d); undefined when it collapses. */
function offsetRing(r: Pt[], d: number): Pt[] | undefined {
  let area = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) area += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  const s = area > 0 ? 1 : -1; // counterclockwise: outward normal is to the right of each edge
  const n = r.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n];
    const c = r[i];
    const q = r[(i + 1) % n];
    const n1 = norm(c.y - p.y, p.x - c.x, s);
    const n2 = norm(q.y - c.y, c.x - q.x, s);
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cosHalf = Math.max(0.25, bx * n1.x + by * n1.y);
    out.push({ x: Math.round(c.x + (bx * d) / cosHalf), y: Math.round(c.y + (by * d) / cosHalf) });
  }
  let a2 = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) a2 += (out[j].x - out[i].x) * (out[j].y + out[i].y);
  return Math.sign(a2) === Math.sign(area) && a2 !== 0 ? out : undefined;
}
function norm(x: number, y: number, s: number): Pt {
  const l = Math.hypot(x, y) || 1;
  return { x: (-s * x) / l, y: (-s * y) / l };
}

/** A pad's copper aperture (world orientation). Non-plated holes have none. */
export function padAperture(fp: FootprintRec, wp: WorldPad): ApertureShape | undefined {
  const p = wp.pad;
  if (p.type === "np") return undefined;
  if (p.shape === "polygon" && p.points) {
    const pts: number[] = [];
    for (const v of flattenContour(p.points, 500)) {
      const r = rotatePoint(v, p.rotation ?? 0);
      const w = footprintToWorld(fp, { x: p.x + r.x, y: p.y + r.y });
      pts.push(Math.round(w.x) - wp.x, Math.round(w.y) - wp.y);
    }
    return { t: "Outline", pts };
  }
  if (p.type === "th") {
    if (p.shape === "circle") return { t: "C", d: p.outer_diameter! };
    return shapeAp(p.shape, p.outer_width!, p.outer_height!, p.corner_radius ?? 0, wp.rotation);
  }
  if (p.shape === "circle") return { t: "C", d: 2 * p.radius! };
  return shapeAp(p.shape, p.width!, p.height!, p.corner_radius ?? 0, wp.rotation);
}

/** A graphic (board or footprint frame) as world paths. */
export function graphicPaths(g: FootprintGraphic, map: (p: Pt) => Pt = (p) => p, mirrored = false): { paths: PathPt[][]; closed: boolean } {
  const mp = (p: Pt): Pt => {
    const w = map(p);
    return { x: Math.round(w.x), y: Math.round(w.y) };
  };
  const sw = (s: number | undefined) => (s === undefined ? undefined : mirrored ? -s : s);
  const mapPath = (ps: PathPt[]): PathPt[] => ps.map((p) => ({ ...mp(p), ...(p.sweep !== undefined ? { sweep: sw(p.sweep) } : {}) }));
  switch (g.shape) {
    case "line":
    case "arc":
      if (!g.start || !g.end) return { paths: [], closed: false };
      return { paths: [mapPath([{ ...g.start }, g.sweep !== undefined ? { ...g.end, sweep: g.sweep } : { ...g.end }])], closed: false };
    case "circle": {
      if (!g.center || g.radius === undefined) return { paths: [], closed: true };
      const s = { x: g.center.x + g.radius, y: g.center.y };
      const o = { x: g.center.x - g.radius, y: g.center.y };
      return { paths: [mapPath([s, { ...o, sweep: 180_000 }, { ...s, sweep: 180_000 }])], closed: true };
    }
    case "rect": {
      if (!g.center || g.width === undefined || g.height === undefined) return { paths: [], closed: true };
      const c = g.center;
      const pts = [
        [-g.width / 2, -g.height / 2],
        [g.width / 2, -g.height / 2],
        [g.width / 2, g.height / 2],
        [-g.width / 2, g.height / 2],
      ].map(([x, y]) => {
        const r = rotatePoint({ x, y }, g.rotation ?? 0);
        return { x: c.x + r.x, y: c.y + r.y };
      });
      return { paths: [mapPath([...pts, pts[0]])], closed: true };
    }
    case "polygon":
      if (!g.points || g.points.length < 3) return { paths: [], closed: true };
      return { paths: [mapPath(contourPath(g.points as Vertex[]))], closed: true };
    case "path":
      if (!g.points || g.points.length < 2) return { paths: [], closed: false };
      return { paths: [mapPath(openPath(g.points as Vertex[]))], closed: false };
  }
}

/** Board text and footprint text resolved: what the text shows. */
function shownText(fp: FootprintRec, t: { text: string; role?: "ref" | "value" | "user" }): string {
  if (t.role === "ref") return fp.ref;
  if (t.role === "value") return fp.value ?? t.text;
  return t.text;
}

/** Build the plot of a board. */
export function plotBoard(doc: BoardDocument, fill: ResolvedFill | undefined, options: PlotOptions = {}): Plot {
  const stack = copperLayers(doc);
  const n = stack.length;
  const notes: string[] = [];
  const net = options.netAttributes !== false;
  const layers = new Map<string, PlotLayer>();
  stack.forEach((c, i) => {
    const pos = i === 0 ? "Top" : i === n - 1 ? "Bot" : "Inr";
    layers.set(`copper:${c}`, { id: `copper:${c}`, kind: "copper", copper: c, index: i + 1, side: i === 0 ? "top" : i === n - 1 ? "bottom" : undefined, fileFunction: `Copper,L${i + 1},${pos}`, polarity: "Positive", objects: [] });
  });
  for (const side of ["top", "bottom"] as const) {
    const S = side === "top" ? "Top" : "Bot";
    layers.set(`soldermask:${side}`, { id: `soldermask:${side}`, kind: "soldermask", side, fileFunction: `Soldermask,${S}`, polarity: "Negative", objects: [] });
    layers.set(`paste:${side}`, { id: `paste:${side}`, kind: "paste", side, fileFunction: `Paste,${S}`, polarity: "Positive", objects: [] });
    layers.set(`legend:${side}`, { id: `legend:${side}`, kind: "legend", side, fileFunction: `Legend,${S}`, polarity: "Positive", objects: [] });
  }
  layers.set("profile", { id: "profile", kind: "profile", fileFunction: "Profile,NP", polarity: "Positive", objects: [] });
  const L = (id: string) => layers.get(id)!;
  const add = (id: string, o: PlotObj) => layers.get(id)?.objects.push(o);

  // ---- copper: zone fill first (regions), then tracks, vias, pads, copper graphics and text
  if (fill) {
    const sorted = [...fill.fills].sort((a, b) => ((a.zone ?? a.source) < (b.zone ?? b.source) ? -1 : (a.zone ?? a.source) > (b.zone ?? b.source) ? 1 : a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));
    for (const f of sorted) {
      if (!layers.has(`copper:${f.layer}`)) continue;
      f.polygons.forEach((p, i) => {
        const ring = fracture(ringOf(p.outer), p.holes.map(ringOf));
        add(`copper:${f.layer}`, { k: "region", ring, fn: "Conductor", ...(net ? { attrs: { N: f.net ?? "" } } : {}), src: `${f.zone ?? `fill:${f.source}`}#${i}` });
      });
    }
  }
  const byId = <T extends { id: string }>(xs: T[]) => xs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const t of byId(recordsOfKind(doc, "track"))) {
    add(`copper:${t.layer}`, { k: "draw", width: t.width, path: [{ ...t.start }, t.sweep !== undefined ? { ...t.end, sweep: t.sweep } : { ...t.end }], fn: "Conductor", ...(net ? { attrs: { N: t.net ?? "" } } : {}), src: t.id });
  }
  const vias = byId(recordsOfKind(doc, "via"));
  for (const v of vias) {
    for (const c of viaLayers(doc, v.from_layer, v.to_layer)) add(`copper:${c}`, { k: "flash", ap: { t: "C", d: v.outer_diameter }, x: v.x, y: v.y, fn: "ViaPad", ...(net ? { attrs: { N: v.net ?? "" } } : {}), src: v.id });
    const tent = v.tented ?? (options.tentVias === false ? "none" : "both");
    const top = stack[0] === v.from_layer;
    const bot = stack[n - 1] === v.to_layer;
    for (const side of ["top", "bottom"] as const) {
      const reaches = side === "top" ? top : bot;
      const covered = tent === "both" || tent === side;
      if (reaches && !covered) {
        const m = options.maskExpansion ?? 0;
        add(`soldermask:${side}`, { k: "flash", ap: { t: "C", d: v.outer_diameter + 2 * m }, x: v.x, y: v.y, src: v.id });
      }
    }
  }
  const fps = byId(recordsOfKind(doc, "footprint"));
  for (const fp of fps) {
    for (const wp of padsOf(fp, stack)) {
      const p = wp.pad;
      const ap = padAperture(fp, wp);
      const attrs: ObjAttrs | undefined = net ? { N: doc.padNets.get(wp.id) ?? "N/C", P: [fp.ref, p.number, ...(p.pin ? [p.pin] : [])] as [string, string, string?], C: fp.ref } : undefined;
      if (ap) for (const c of wp.layers) add(`copper:${c}`, { k: "flash", ap, x: wp.x, y: wp.y, fn: p.type === "smd" ? "SMDPad,CuDef" : "ComponentPad", ...(attrs ? { attrs } : {}), src: wp.id });
      // mask openings: SMD pads on their side, drilled pads on both
      const sides: Side[] = p.type === "smd" ? [wp.layers[0] === stack[0] ? "top" : "bottom"] : ["top", "bottom"];
      const m = p.mask_margin ?? options.maskExpansion ?? 0;
      const maskAp = ap ? growAp(ap, m) : p.type === "np" ? growAp({ t: "C", d: p.hole_diameter! }, m) : undefined;
      if (maskAp) for (const s of sides) add(`soldermask:${s}`, { k: "flash", ap: maskAp, x: wp.x, y: wp.y, ...(net ? { attrs: { C: fp.ref } } : {}), src: wp.id });
      if (p.type === "smd" && ap) {
        const pm = p.paste_margin ?? options.pasteExpansion ?? 0;
        const pa = growAp(ap, pm);
        if (pa) add(`paste:${sides[0]}`, { k: "flash", ap: pa, x: wp.x, y: wp.y, ...(net ? { attrs: { C: fp.ref } } : {}), src: wp.id });
        else notes.push(`paste of ${wp.id}: the paste margin leaves no opening`);
      }
    }
    // footprint graphics and texts
    const map = (pt: Pt) => footprintToWorld(fp, pt);
    const mirrored = fp.side === "bottom";
    (fp.graphics ?? []).forEach((g, i) => {
      const layer = sideLayer(g.layer, fp.side);
      emitGraphic(layer, graphicPaths(g, map, mirrored), g.stroke_width, g.filled === true, `${fp.id}#g${i}`, fp.ref);
    });
    (fp.texts ?? []).forEach((t, i) => {
      if (t.role === "value" && options.values === false) return;
      const layer = sideLayer(t.layer, fp.side);
      const text = shownText(fp, t);
      const strokes = footprintTextStrokes(fp, { ...t, text });
      emitStrokes(layer, strokes, t.stroke_width ?? Math.max(1, Math.round(t.height * 0.15)), `${fp.id}#t${i}`, fp.ref);
    });
  }
  for (const g of byId(recordsOfKind(doc, "graphic"))) emitGraphic(g.layer, graphicPaths(g), g.stroke_width, g.filled === true, g.id);
  for (const t of byId(recordsOfKind(doc, "text"))) emitStrokes(t.layer, textStrokes({ ...t, mirrored: t.mirrored === true }), t.stroke_width ?? Math.max(1, Math.round(t.height * 0.15)), t.id);

  function target(layer: string): string | undefined {
    if ((stack as string[]).includes(layer)) return `copper:${layer}`;
    const m = /^(top|bottom)_(silkscreen|soldermask|paste)$/.exec(layer);
    if (!m) return undefined;
    return `${m[2] === "silkscreen" ? "legend" : m[2]}:${m[1]}`;
  }
  function emitGraphic(layer: string, g: { paths: PathPt[][]; closed: boolean }, stroke: number, filled: boolean, src: string, ref?: string): void {
    const id = target(layer);
    if (!id) return;
    const copper = id.startsWith("copper:");
    const fn = copper ? "NonConductor" : undefined;
    const attrs: ObjAttrs | undefined = net && ref ? { C: ref } : undefined;
    for (const path of g.paths) {
      if (filled && g.closed) {
        const ring = flattenPath(path, 500);
        ring.pop();
        if (ring.length >= 3) add(id, { k: "region", ring, ...(fn ? { fn } : {}), ...(attrs ? { attrs } : {}), src });
      }
      if (stroke > 0) add(id, { k: "draw", width: stroke, path, ...(fn ? { fn } : {}), ...(attrs ? { attrs } : {}), src });
      else if (!filled) notes.push(`${src} on ${layer}: an unfilled shape with no stroke width draws nothing`);
    }
  }
  function emitStrokes(layer: string, strokes: Pt[][], width: number, src: string, ref?: string): void {
    const id = target(layer);
    if (!id) return;
    const fn = id.startsWith("copper:") ? "NonConductor" : undefined;
    const attrs: ObjAttrs | undefined = net && ref ? { C: ref } : undefined;
    for (const s of strokes) add(id, { k: "draw", width, path: s.map((p) => ({ x: p.x, y: p.y })), ...(fn ? { fn } : {}), ...(attrs ? { attrs } : {}), src });
  }

  // ---- silkscreen clipped from mask openings
  if (options.clipSilkToMask) {
    for (const side of ["top", "bottom"] as const) {
      const legend = L(`legend:${side}`);
      if (!legend.objects.length) continue;
      for (const o of L(`soldermask:${side}`).objects) {
        const { attrs: _attrs, ...rest } = o;
        legend.objects.push({ ...rest, clear: true });
      }
    }
  }

  // ---- profile: outline and cutouts
  const pw = options.profileWidth ?? 100_000;
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") add("profile", { k: "draw", width: pw, path: contourPath(outline.outline), fn: "Profile", src: outline.id });
  else notes.push("the board has no outline: the profile file is empty");
  for (const c of byId(recordsOfKind(doc, "cutout"))) add("profile", { k: "draw", width: pw, path: contourPath(c.outline), fn: "Profile", src: c.id });

  return { layers: [...layers.values()], copper: stack, notes };
}

/** An aperture's outline as a ring of points around its flash point (circles and round ends as 32-gons). */
export function apertureRing(ap: ApertureShape): Pt[] {
  const circle = (cx: number, cy: number, r: number, from = 0, to = 2 * Math.PI, k = 32): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= k; i++) {
      const a = from + ((to - from) * i) / k;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  };
  const rot = (pts: Pt[], mdeg: number) => pts.map((p) => rotatePoint(p, mdeg));
  const rect = (w: number, h: number): Pt[] => [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  const oval = (w: number, h: number): Pt[] => {
    if (w >= h) {
      const r = h / 2;
      return [...circle(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, 16), ...circle(r - w / 2, 0, r, Math.PI / 2, (3 * Math.PI) / 2, 16)];
    }
    const r = w / 2;
    return [...circle(0, h / 2 - r, r, 0, Math.PI, 16), ...circle(0, r - h / 2, r, Math.PI, 2 * Math.PI, 16)];
  };
  switch (ap.t) {
    case "C":
      return circle(0, 0, ap.d / 2).slice(0, -1);
    case "R":
      return rect(ap.w, ap.h);
    case "O":
      return oval(ap.w, ap.h);
    case "RotRect":
      return rot(rect(ap.w, ap.h), ap.rot);
    case "RotOval":
      return rot(oval(ap.w, ap.h), ap.rot);
    case "RoundRect": {
      const { r, w, h } = ap;
      const pts = [
        ...circle(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, 8),
        ...circle(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, 8),
        ...circle(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, 8),
        ...circle(-w / 2 + r, -h / 2 + r, r, Math.PI, (3 * Math.PI) / 2, 8),
      ];
      return rot(pts, ap.rot);
    }
    case "Outline":
      return ringOf(ap.pts);
  }
}

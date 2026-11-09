/**
 * Geometry helpers: boxes, the footprint transform (contract section 2), world pads, and the box and layers of
 * every record. Boxes are in nanometers and rounded outward to whole nanometers.
 */
import { cosSin, normAngle } from "./units.js";
import { copperLayers, footprintKey, padKeys, padId, type BoardDocument } from "./document.js";
import type { AnyLayer, BoardRecord, CopperLayer, FootprintRec, Pad, Point, Side, Vertex } from "./schema.js";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const isEmptyBox = (b: Box): boolean => !(b.minX <= b.maxX && b.minY <= b.maxY);
export function addPoint(b: Box, x: number, y: number, r = 0): Box {
  if (x - r < b.minX) b.minX = x - r;
  if (y - r < b.minY) b.minY = y - r;
  if (x + r > b.maxX) b.maxX = x + r;
  if (y + r > b.maxY) b.maxY = y + r;
  return b;
}
export const unionBox = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
export const boxesMeet = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
export const inflate = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
export const boxContains = (b: Box, p: Point): boolean => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const roundOut = (b: Box): Box => ({ minX: Math.floor(b.minX), minY: Math.floor(b.minY), maxX: Math.ceil(b.maxX), maxY: Math.ceil(b.maxY) });
export const boxCenter = (b: Box): Point => ({ x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) });

/** Rotate a point about the origin (counterclockwise, millidegrees). Not rounded. */
export function rotatePoint(p: { x: number; y: number }, mdeg: number): { x: number; y: number } {
  const [c, s] = cosSin(mdeg);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
/** Rotate a point about a center and round to whole nanometers. */
export function rotateAbout(p: Point, center: Point, mdeg: number): Point {
  const r = rotatePoint({ x: p.x - center.x, y: p.y - center.y }, mdeg);
  return { x: Math.round(center.x + r.x), y: Math.round(center.y + r.y) };
}

/** A footprint-frame point in world coordinates: T(x, y) R(rotation) M(side) p. Not rounded. */
export function footprintToWorld(fp: Pick<FootprintRec, "x" | "y" | "rotation" | "side">, p: { x: number; y: number }): { x: number; y: number } {
  const m = fp.side === "bottom" ? { x: -p.x, y: p.y } : p;
  const r = rotatePoint(m, fp.rotation);
  return { x: fp.x + r.x, y: fp.y + r.y };
}

/** A footprint-frame layer name on the side the footprint sits on. */
export function sideLayer<L extends string>(layer: L, side: Side): L {
  if (side === "top") return layer;
  if (layer === "top") return "bottom" as L;
  if (layer === "bottom") return "top" as L;
  if (layer.startsWith("top_")) return `bottom_${layer.slice(4)}` as L;
  if (layer.startsWith("bottom_")) return `top_${layer.slice(7)}` as L;
  return layer;
}

/** The center of an arc from `start` to `end` with a signed sweep (millidegrees). */
export function arcCenter(start: Point, end: Point, sweep: number): { x: number; y: number; r: number } {
  const theta = (sweep / 1000) * (Math.PI / 180);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return { x: start.x, y: start.y, r: 0 };
  // distance from the chord midpoint to the center, signed so a positive sweep turns counterclockwise
  const h = chord / 2 / Math.tan(theta / 2);
  const nx = -dy / chord;
  const ny = dx / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  return { x: cx, y: cy, r: Math.hypot(start.x - cx, start.y - cy) };
}

/** The box of an arc edge (with its stroke). */
function addArc(b: Box, start: Point, end: Point, sweep: number, stroke: number): void {
  addPoint(b, start.x, start.y, stroke);
  addPoint(b, end.x, end.y, stroke);
  const c = arcCenter(start, end, sweep);
  const a0 = (Math.atan2(start.y - c.y, start.x - c.x) * 180) / Math.PI;
  const s = sweep / 1000;
  // the axis directions the arc passes through
  for (const ax of [0, 90, 180, 270, 360, 450, 540, 630]) {
    for (const base of [ax, ax - 720]) {
      const rel = s > 0 ? base - a0 : a0 - base;
      if (rel > 0 && rel < Math.abs(s)) {
        const r = (base * Math.PI) / 180;
        addPoint(b, c.x + c.r * Math.cos(r), c.y + c.r * Math.sin(r), stroke);
      }
    }
  }
}

/** The box of a contour or path (arcs included). */
export function contourBox(vertices: readonly Vertex[], closed = true, stroke = 0): Box {
  const b = emptyBox();
  vertices.forEach((v, i) => {
    addPoint(b, v.x, v.y, stroke);
    const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    if (v.sweep !== undefined && next) addArc(b, v, next, v.sweep, stroke);
  });
  return roundOut(b);
}

/** A pad's outline corners in the pad's own frame (for its box). */
function padLocalPoints(p: Pad): { x: number; y: number }[] {
  const rect = (w: number, h: number) => [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  if (p.type === "np") return rect(p.hole_diameter ?? 0, p.hole_diameter ?? 0);
  if (p.type === "th") {
    if (p.shape === "circle") return rect(p.outer_diameter ?? 0, p.outer_diameter ?? 0);
    return rect(p.outer_width ?? 0, p.outer_height ?? 0);
  }
  if (p.shape === "circle") return rect(2 * (p.radius ?? 0), 2 * (p.radius ?? 0));
  if (p.shape === "polygon") return (p.points ?? []).map((v) => ({ x: v.x, y: v.y }));
  return rect(p.width ?? 0, p.height ?? 0);
}

export interface WorldPad {
  /** `pad:<footprint key>:<pad key>`. */
  id: string;
  footprint: string;
  key: string;
  pad: Pad;
  /** World center (rounded). */
  x: number;
  y: number;
  /** World rotation of the pad shape, millidegrees (mirror applied for bottom). */
  rotation: number;
  /** Copper layers the pad has copper on. */
  layers: CopperLayer[];
  box: Box;
  /** Whether the pad has a drilled hole. */
  drilled: boolean;
}

/** Every pad of a footprint in world coordinates. */
export function padsOf(fp: FootprintRec, copper: readonly CopperLayer[] = ["top", "bottom"]): WorldPad[] {
  const keys = padKeys(fp);
  const fk = footprintKey(fp);
  return fp.pads.map((p, i) => {
    const c = footprintToWorld(fp, p);
    const b = emptyBox();
    for (const q of padLocalPoints(p)) {
      const r = rotatePoint(q, p.rotation ?? 0);
      const w = footprintToWorld(fp, { x: p.x + r.x, y: p.y + r.y });
      addPoint(b, w.x, w.y);
    }
    const mirrored = fp.side === "bottom";
    const rotation = normAngle(fp.rotation + (mirrored ? -(p.rotation ?? 0) : p.rotation ?? 0));
    const layers: CopperLayer[] = p.type === "smd" ? [sideLayer("top", fp.side) as CopperLayer] : p.type === "th" ? [...copper] : [];
    return { id: padId(fk, keys[i]), footprint: fp.id, key: keys[i], pad: p, x: Math.round(c.x), y: Math.round(c.y), rotation, layers, box: roundOut(b), drilled: p.type !== "smd" };
  });
}

/** The copper layers a via spans, in stack order. */
export function viaLayers(doc: BoardDocument, from: CopperLayer, to: CopperLayer): CopperLayer[] {
  const stack = copperLayers(doc);
  const a = stack.indexOf(from);
  const b = stack.indexOf(to);
  if (a < 0 || b < 0) return [from, to];
  return stack.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function textBox(x: number, y: number, height: number, text: string, rotation = 0, anchor: "center" | "left" | "right" = "center"): Box {
  const w = height * 0.6 * Math.max(1, text.length);
  const x0 = anchor === "left" ? 0 : anchor === "right" ? -w : -w / 2;
  const b = emptyBox();
  for (const q of [
    { x: x0, y: -height / 2 },
    { x: x0 + w, y: -height / 2 },
    { x: x0 + w, y: height / 2 },
    { x: x0, y: height / 2 },
  ]) {
    const r = rotatePoint(q, rotation);
    addPoint(b, x + r.x, y + r.y);
  }
  return b;
}

type GraphicLike = { shape: string; start?: Point; end?: Point; sweep?: number; center?: Point; radius?: number; width?: number; height?: number; rotation?: number; points?: Vertex[]; stroke_width: number };
function graphicBox(g: GraphicLike, map: (p: { x: number; y: number }) => { x: number; y: number } = (p) => p): Box {
  const b = emptyBox();
  const s = g.stroke_width / 2;
  const add = (p: { x: number; y: number }, r = s) => {
    const w = map(p);
    addPoint(b, w.x, w.y, r);
  };
  if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) {
    if (g.sweep !== undefined) {
      const local = emptyBox();
      addArc(local, g.start, g.end, g.sweep, 0);
      for (const p of [
        { x: local.minX, y: local.minY },
        { x: local.maxX, y: local.maxY },
        { x: local.minX, y: local.maxY },
        { x: local.maxX, y: local.minY },
      ])
        add(p);
    } else {
      add(g.start);
      add(g.end);
    }
  } else if (g.shape === "circle" && g.center && g.radius !== undefined) {
    for (const [dx, dy] of [
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ])
      add({ x: g.center.x + dx * g.radius, y: g.center.y + dy * g.radius });
  } else if (g.shape === "rect" && g.center && g.width !== undefined && g.height !== undefined) {
    for (const [dx, dy] of [
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ]) {
      const r = rotatePoint({ x: (dx * g.width) / 2, y: (dy * g.height) / 2 }, g.rotation ?? 0);
      add({ x: g.center.x + r.x, y: g.center.y + r.y });
    }
  } else if (g.points) {
    const local = contourBox(g.points, g.shape === "polygon", 0);
    for (const p of [
      { x: local.minX, y: local.minY },
      { x: local.maxX, y: local.maxY },
      { x: local.minX, y: local.maxY },
      { x: local.maxX, y: local.minY },
    ])
      add(p);
  }
  return b;
}

/** A footprint's box: its courtyard, pads, graphics and texts. */
export function footprintBox(fp: FootprintRec): Box {
  let b = emptyBox();
  const map = (p: { x: number; y: number }) => footprintToWorld(fp, p);
  if (fp.courtyard) for (const v of fp.courtyard) {
    const w = map(v);
    addPoint(b, w.x, w.y);
  }
  for (const p of padsOf(fp)) b = unionBox(b, p.box);
  for (const g of fp.graphics ?? []) b = unionBox(b, graphicBox(g, map));
  if (isEmptyBox(b)) addPoint(b, fp.x, fp.y);
  return roundOut(b);
}

/** The box of a record, or undefined for records with no geometry (board, layer, netclass, a rule without a region). */
export function boundsOf(rec: BoardRecord): Box | undefined {
  switch (rec.kind) {
    case "footprint":
      return footprintBox(rec);
    case "track": {
      const b = emptyBox();
      if (rec.sweep !== undefined) addArc(b, rec.start, rec.end, rec.sweep, rec.width / 2);
      else {
        addPoint(b, rec.start.x, rec.start.y, rec.width / 2);
        addPoint(b, rec.end.x, rec.end.y, rec.width / 2);
      }
      return roundOut(b);
    }
    case "via":
      return roundOut(addPoint(emptyBox(), rec.x, rec.y, rec.outer_diameter / 2));
    case "zone":
    case "keepout":
    case "outline":
    case "cutout":
      return contourBox(rec.outline);
    case "graphic":
      return roundOut(graphicBox(rec));
    case "text":
      return roundOut(textBox(rec.x, rec.y, rec.height, rec.text, rec.rotation, rec.anchor));
    case "rule":
      return rec.applies.region ? contourBox(rec.applies.region) : undefined;
    default:
      return undefined;
  }
}

/** The layers a record occupies (copper and drawing layers). */
export function layersOf(doc: BoardDocument, rec: BoardRecord): AnyLayer[] {
  switch (rec.kind) {
    case "footprint": {
      const out = new Set<AnyLayer>();
      const copper = copperLayers(doc);
      for (const p of padsOf(rec, copper)) for (const l of p.layers) out.add(l);
      for (const g of rec.graphics ?? []) out.add(sideLayer(g.layer, rec.side));
      for (const t of rec.texts ?? []) out.add(sideLayer(t.layer, rec.side));
      out.add(sideLayer("top_courtyard", rec.side));
      return [...out];
    }
    case "track":
      return [rec.layer];
    case "via":
      return viaLayers(doc, rec.from_layer, rec.to_layer);
    case "zone":
    case "keepout":
      return [...rec.layers];
    case "outline":
    case "cutout":
      return ["edge_cuts"];
    case "graphic":
    case "text":
      return [rec.layer];
    case "rule":
      return rec.applies.layers ? [...rec.applies.layers] : [];
    default:
      return [];
  }
}

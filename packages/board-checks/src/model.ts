/**
 * The check model of a board document: every piece of copper per layer as a shape (pads, tracks, arcs, vias, zone
 * fill), every drilled hole, the board edges, courtyards and silkscreen, each in a spatial grid. Built once per
 * document and fill set; the checks and connectivity read it.
 */
import {
  copperLayers,
  footprintToWorld,
  padsOf,
  recordsOfKind,
  sideLayer,
  toDeg,
  viaLayers,
  type BoardDocument,
  type Box,
  type CopperLayer,
  type FootprintRec,
  type Pad,
  type Vertex,
  type WorldPad,
} from "@protoboardai/board";
import type { ZoneFillSet } from "./fills.js";
import { GridIndex } from "./geom/grid.js";
import type { Prim } from "./geom/prims.js";
import {
  arcShape,
  cosSinRad,
  circleOutline,
  contourPrims,
  flattenContour,
  ovalShape,
  pointShape,
  polyCore,
  rectShape,
  segShape,
  shape,
  type PolyCore,
  type Shape,
} from "./geom/shape.js";

export type CopperKind = "pad" | "track" | "via" | "zone";

export interface CopperItem {
  /** Index in `model.copper`. */
  i: number;
  /** The object id: a record id, or a pad id (`pad:<fp key>:<pad key>`). A zone fill polygon carries its zone's id. */
  id: string;
  kind: CopperKind;
  layer: CopperLayer;
  net?: string;
  shape: Shape;
  /** Pads: the footprint id. */
  footprint?: string;
  /** Tracks: the endpoints (for dangling ends) and the half width. */
  ends?: [number, number, number, number];
  /** Zone fill: the polygon's index within the zone's fill on this layer. */
  part?: number;
}

export interface HoleItem {
  i: number;
  id: string;
  kind: "via" | "pad";
  plated: boolean;
  net?: string;
  shape: Shape;
  /** Copper layers the drill passes through. */
  layers: CopperLayer[];
  footprint?: string;
}

export interface CourtyardItem {
  footprint: string;
  ref: string;
  side: "top" | "bottom";
  poly: PolyCore;
}

export interface SilkItem {
  /** The record id (footprint, graphic or text). */
  id: string;
  layer: "top_silkscreen" | "bottom_silkscreen";
  shapes: Shape[];
  box: Box;
  /** True when the shape is a text's box (no font geometry): an approximation. */
  textBox: boolean;
  footprint?: string;
}

export interface EdgeItem {
  /** `outline` or a cutout's id. */
  id: string;
  shape: Shape;
}

export interface CheckModel {
  doc: BoardDocument;
  layers: CopperLayer[];
  copper: CopperItem[];
  /** Copper items per layer. */
  grids: Map<CopperLayer, GridIndex>;
  holes: HoleItem[];
  holeGrid: GridIndex;
  edges: EdgeItem[];
  edgeGrid: GridIndex;
  /** The board's area (outline with cutouts as holes), flattened, for inside tests; absent without an outline. */
  region?: PolyCore;
  courtyards: CourtyardItem[];
  silk: SilkItem[];
  /** World pads by pad id. */
  pads: Map<string, WorldPad & { shape: Shape }>;
  /** Zones with fill given, and zones without. */
  filledZones: string[];
  unfilledZones: string[];
  /** Zone outlines (flattened) by zone id, for "inside a zone of the same net" tests when fill is absent. */
  zoneOutlines: Map<string, { net?: string; layers: CopperLayer[]; poly: PolyCore }>;
  footprints: Map<string, FootprintRec>;
  /** The grid cell size used (nm). */
  cell: number;
  /** Things the model could not represent exactly. */
  notes: string[];
}

const rad = (mdeg: number) => (toDeg(mdeg) * Math.PI) / 180;

/** The copper shape of a pad in world coordinates. */
export function padShape(fp: FootprintRec, wp: WorldPad): Shape {
  const p = wp.pad;
  const rot = rad(wp.rotation);
  const x = footprintToWorld(fp, p).x;
  const y = footprintToWorld(fp, p).y;
  const sized = (shapeName: Pad["shape"], w: number, h: number): Shape => {
    switch (shapeName) {
      case "circle":
        return pointShape(x, y, Math.min(w, h) / 2);
      case "oval":
        return w === h ? pointShape(x, y, w / 2) : ovalShape(x, y, w, h, rot);
      case "roundrect": {
        const cr = Math.min(p.corner_radius ?? 0, w / 2, h / 2);
        return rectShape(x, y, w - 2 * cr, h - 2 * cr, rot, cr);
      }
      case "polygon":
        return polygonPad(fp, p);
      default:
        return rectShape(x, y, w, h, rot);
    }
  };
  if (p.type === "np") return pointShape(x, y, (p.hole_diameter ?? 0) / 2);
  if (p.type === "th") {
    if (p.shape === "circle") return pointShape(x, y, (p.outer_diameter ?? 0) / 2);
    if (p.shape === "polygon" && p.points) return polygonPad(fp, p);
    return sized(p.shape, p.outer_width ?? p.outer_diameter ?? 0, p.outer_height ?? p.outer_diameter ?? 0);
  }
  if (p.shape === "circle") return pointShape(x, y, p.radius ?? 0);
  return sized(p.shape, p.width ?? 0, p.height ?? 0);
}

function polygonPad(fp: FootprintRec, p: Pad): Shape {
  const [c, s] = cosSinRad(rad(p.rotation ?? 0));
  const pts = flattenContour(p.points ?? [], (lx, ly) => {
    const w = footprintToWorld(fp, { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c });
    return [w.x, w.y];
  });
  return shape(polyCore([pts]), 0);
}

/** The drill of a pad (round or slotted), or undefined for an smd pad. */
export function padHole(fp: FootprintRec, wp: WorldPad): Shape | undefined {
  const p = wp.pad;
  if (p.type === "smd") return undefined;
  const w = footprintToWorld(fp, p);
  if (p.hole_diameter !== undefined) return pointShape(w.x, w.y, p.hole_diameter / 2);
  if (p.hole_width !== undefined && p.hole_height !== undefined) return ovalShape(w.x, w.y, p.hole_width, p.hole_height, rad(wp.rotation));
  return undefined;
}

function cellSize(doc: BoardDocument, count: number): number {
  const outline = doc.records.get("outline");
  let area = 100e6 * 100e6;
  if (outline?.kind === "outline") {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of outline.outline) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    area = Math.max(1e12, (maxX - minX) * (maxY - minY));
  }
  const c = Math.sqrt(area / Math.max(1, count)) * 2;
  return Math.min(5e6, Math.max(250_000, c));
}

function graphicShapes(g: { shape: string; start?: { x: number; y: number }; end?: { x: number; y: number }; sweep?: number; center?: { x: number; y: number }; radius?: number; width?: number; height?: number; rotation?: number; points?: Vertex[]; stroke_width: number; filled?: true }, map: (x: number, y: number) => [number, number], mirrored: boolean, extraRot: number): Shape[] {
  const r = g.stroke_width / 2;
  const P = (p: { x: number; y: number }) => map(p.x, p.y);
  if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) {
    const [ax, ay] = P(g.start);
    const [bx, by] = P(g.end);
    if (g.sweep !== undefined) return [arcShape({ x: ax, y: ay }, { x: bx, y: by }, mirrored ? -g.sweep : g.sweep, r)];
    return [segShape(ax, ay, bx, by, r)];
  }
  if (g.shape === "circle" && g.center && g.radius !== undefined) {
    const [cx, cy] = P(g.center);
    return g.filled ? [pointShape(cx, cy, g.radius + r)] : [circleOutline(cx, cy, g.radius, r)];
  }
  if (g.shape === "rect" && g.center && g.width !== undefined && g.height !== undefined) {
    const [cx, cy] = P(g.center);
    const rect = rectShape(cx, cy, g.width, g.height, rad((mirrored ? -(g.rotation ?? 0) : g.rotation ?? 0) + extraRot), 0);
    if (g.filled) return [{ ...rect, r, box: { minX: rect.box.minX - r, minY: rect.box.minY - r, maxX: rect.box.maxX + r, maxY: rect.box.maxY + r } }];
    return ringStrokes(rect.core.t === "poly" ? rect.core.rings[0] : new Float64Array(), r, true);
  }
  if (g.points && g.points.length >= 2) {
    const closed = g.shape === "polygon";
    const pts = flattenContour(g.points, map, closed);
    if (closed && g.filled && pts.length >= 6) return [shape(polyCore([pts]), r)];
    return ringStrokes(Float64Array.from(pts), r, closed);
  }
  return [];
}

function ringStrokes(pts: Float64Array, r: number, closed: boolean): Shape[] {
  const out: Shape[] = [];
  const n = pts.length;
  const count = closed ? n / 2 : n / 2 - 1;
  for (let k = 0; k < count; k++) {
    const i = 2 * k;
    const j = (i + 2) % n;
    out.push(segShape(pts[i], pts[i + 1], pts[j], pts[j + 1], r));
  }
  return out;
}

function textRect(x: number, y: number, height: number, text: string, rotation: number, anchor: "center" | "left" | "right" | undefined, stroke: number): Shape {
  const w = height * 0.6 * Math.max(1, text.length);
  const off = anchor === "left" ? w / 2 : anchor === "right" ? -w / 2 : 0;
  const [c, s] = cosSinRad(rad(rotation));
  return rectShape(x + off * c, y + off * s, w + stroke, height + stroke, rad(rotation), 0);
}

const unionBoxes = (shapes: Shape[]): Box => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of shapes) {
    b.minX = Math.min(b.minX, s.box.minX);
    b.minY = Math.min(b.minY, s.box.minY);
    b.maxX = Math.max(b.maxX, s.box.maxX);
    b.maxY = Math.max(b.maxY, s.box.maxY);
  }
  return b;
};

/** Build the check model of a document, with zone fill when given. */
export function buildModel(doc: BoardDocument, fills?: ZoneFillSet): CheckModel {
  const layers = copperLayers(doc);
  const layerSet = new Set<string>(layers);
  const notes: string[] = [];
  const copper: CopperItem[] = [];
  const holes: HoleItem[] = [];
  const pads = new Map<string, WorldPad & { shape: Shape }>();
  const footprints = new Map<string, FootprintRec>();
  const add = (it: Omit<CopperItem, "i">) => {
    if (!layerSet.has(it.layer)) return;
    copper.push({ ...it, i: copper.length });
  };

  const fps = recordsOfKind(doc, "footprint");
  let roundrectWithoutRadius = 0;
  for (const fp of fps) {
    footprints.set(fp.id, fp);
    for (const wp of padsOf(fp, layers)) {
      const s = padShape(fp, wp);
      if (wp.pad.shape === "roundrect" && wp.pad.corner_radius === undefined) roundrectWithoutRadius++;
      pads.set(wp.id, { ...wp, shape: s });
      const net = doc.padNets.get(wp.id);
      for (const l of wp.layers) add({ id: wp.id, kind: "pad", layer: l, ...(net ? { net } : {}), shape: s, footprint: fp.id });
      const h = padHole(fp, wp);
      if (h) holes.push({ i: holes.length, id: wp.id, kind: "pad", plated: wp.pad.type === "th", ...(net && wp.pad.type === "th" ? { net } : {}), shape: h, layers: [...layers], footprint: fp.id });
    }
  }
  if (roundrectWithoutRadius) notes.push(`${roundrectWithoutRadius} rounded-rectangle pad(s) have no corner radius and are checked as sharp rectangles (slightly larger than the real copper).`);

  for (const t of recordsOfKind(doc, "track")) {
    const r = t.width / 2;
    const s = t.sweep !== undefined ? arcShape(t.start, t.end, t.sweep, r) : segShape(t.start.x, t.start.y, t.end.x, t.end.y, r);
    add({ id: t.id, kind: "track", layer: t.layer, ...(t.net ? { net: t.net } : {}), shape: s, ends: [t.start.x, t.start.y, t.end.x, t.end.y] });
  }
  for (const v of recordsOfKind(doc, "via")) {
    const span = viaLayers(doc, v.from_layer, v.to_layer);
    const s = pointShape(v.x, v.y, v.outer_diameter / 2);
    for (const l of span) add({ id: v.id, kind: "via", layer: l, ...(v.net ? { net: v.net } : {}), shape: s });
    holes.push({ i: holes.length, id: v.id, kind: "via", plated: true, ...(v.net ? { net: v.net } : {}), shape: pointShape(v.x, v.y, v.hole_diameter / 2), layers: span });
  }

  const zones = recordsOfKind(doc, "zone");
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const zoneOutlines = new Map<string, { net?: string; layers: CopperLayer[]; poly: PolyCore }>();
  for (const z of zones) zoneOutlines.set(z.id, { ...(z.net ? { net: z.net } : {}), layers: [...z.layers], poly: polyCore([flattenContour(z.outline), ...(z.holes ?? []).map((h) => flattenContour(h))]) });
  const filled = new Set<string>();
  const orphanFills = new Set<string>();
  for (const f of fills ?? []) {
    const z = zoneById.get(f.zone);
    if (!z && !f.zone.startsWith("fill:")) {
      notes.push(`zone fill for ${f.zone} names no zone on the board; it was ignored.`);
      continue;
    }
    if (!layerSet.has(f.layer)) {
      notes.push(`zone fill for ${f.zone} is on ${f.layer}, which is not a copper layer of this board; it was ignored.`);
      continue;
    }
    if (z) filled.add(z.id);
    else orphanFills.add(f.zone);
    const net = z ? z.net : f.net;
    f.polygons.forEach((p, k) => {
      const rings = "outer" in p ? [p.outer, ...(p.holes ?? [])] : [flattenContour(p.outline), ...(p.holes ?? []).map((h) => flattenContour(h))];
      const usable = rings.filter((r) => r.length >= 6);
      if (!usable.length) return;
      add({ id: z ? z.id : f.zone, kind: "zone", layer: f.layer, ...(net ? { net } : {}), shape: shape(polyCore(usable), 0), part: k });
    });
  }
  if (orphanFills.size) notes.push(`${orphanFills.size} fill(s) without a zone record (copper pours of the source) are checked as copper of their net under fill: ids.`);
  const filledZones = zones.filter((z) => filled.has(z.id)).map((z) => z.id);
  const unfilledZones = zones.filter((z) => !filled.has(z.id)).map((z) => z.id);

  const cell = cellSize(doc, copper.length / Math.max(1, layers.length));
  const grids = new Map<CopperLayer, GridIndex>();
  for (const l of layers) grids.set(l, new GridIndex(cell));
  for (const it of copper) grids.get(it.layer)!.insert(it.i, it.shape.box);
  const holeGrid = new GridIndex(cell);
  for (const h of holes) holeGrid.insert(h.i, h.shape.box);

  // edges: the outline and cutouts, as true segments and arcs
  const edges: EdgeItem[] = [];
  const outline = doc.records.get("outline");
  const cutouts = recordsOfKind(doc, "cutout");
  const prims = (id: string, vs: readonly Vertex[]) => contourPrims(vs).forEach((p: Prim) => edges.push({ id, shape: shape(p as never, 0) }));
  let region: PolyCore | undefined;
  if (outline?.kind === "outline") {
    prims("outline", outline.outline);
    for (const c of cutouts) prims(c.id, c.outline);
    region = polyCore([flattenContour(outline.outline), ...cutouts.map((c) => flattenContour(c.outline))]);
  }
  const edgeGrid = new GridIndex(cell, 1 << 30);
  edges.forEach((e, i) => edgeGrid.insert(i, e.shape.box));

  // courtyards and silkscreen
  const courtyards: CourtyardItem[] = [];
  const silk: SilkItem[] = [];
  let texts = 0;
  for (const fp of fps) {
    const map = (x: number, y: number): [number, number] => {
      const w = footprintToWorld(fp, { x, y });
      return [w.x, w.y];
    };
    if (fp.courtyard) courtyards.push({ footprint: fp.id, ref: fp.ref, side: fp.side, poly: polyCore([flattenContour(fp.courtyard, map)]) });
    const mirrored = fp.side === "bottom";
    for (const g of fp.graphics ?? []) {
      const layer = sideLayer(g.layer, fp.side);
      if (layer !== "top_silkscreen" && layer !== "bottom_silkscreen") continue;
      const shapes = graphicShapes(g, map, mirrored, fp.rotation);
      if (shapes.length) silk.push({ id: fp.id, layer, shapes, box: unionBoxes(shapes), textBox: false, footprint: fp.id });
    }
    for (const t of fp.texts ?? []) {
      const layer = sideLayer(t.layer, fp.side);
      if (layer !== "top_silkscreen" && layer !== "bottom_silkscreen") continue;
      const text = t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text;
      const [x, y] = map(t.x, t.y);
      const rot = (mirrored ? -(t.rotation ?? 0) : t.rotation ?? 0) + fp.rotation;
      const s = textRect(x, y, t.height, text, rot, t.anchor, t.stroke_width ?? 0);
      texts++;
      silk.push({ id: fp.id, layer, shapes: [s], box: s.box, textBox: true, footprint: fp.id });
    }
  }
  const id2 = (x: number, y: number): [number, number] => [x, y];
  for (const g of recordsOfKind(doc, "graphic")) {
    if (g.layer !== "top_silkscreen" && g.layer !== "bottom_silkscreen") continue;
    const shapes = graphicShapes(g, id2, false, 0);
    if (shapes.length) silk.push({ id: g.id, layer: g.layer, shapes, box: unionBoxes(shapes), textBox: false });
  }
  for (const t of recordsOfKind(doc, "text")) {
    if (t.layer !== "top_silkscreen" && t.layer !== "bottom_silkscreen") continue;
    const s = textRect(t.x, t.y, t.height, t.text, t.rotation ?? 0, t.anchor, t.stroke_width ?? 0);
    texts++;
    silk.push({ id: t.id, layer: t.layer, shapes: [s], box: s.box, textBox: true });
  }
  if (texts) notes.push(`${texts} silkscreen text(s) are checked as their boxes (0.6 of the height per character); the board files hold no font outlines.`);

  return { doc, layers, copper, grids, holes, holeGrid, edges, edgeGrid, ...(region ? { region } : {}), courtyards, silk, pads, filledZones, unfilledZones, zoneOutlines, footprints, cell, notes };
}

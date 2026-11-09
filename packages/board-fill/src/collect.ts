/**
 * The copper, holes and areas of a board as exact shapes, per copper layer, gathered once per fill run from the
 * board core's public records and transforms. Pad shapes are built from the unrounded footprint transform, so a
 * pad's corner is where the footprint puts it, not where a rounded center would.
 */
import {
  copperLayers,
  footprintKey,
  footprintToWorld,
  padKeys,
  padId,
  padsOf,
  padWorldSide,
  recordsOfKind,
  sideLayer,
  viaLayers,
  type BoardDocument,
  type CopperLayer,
  type CutoutRec,
  type FootprintRec,
  type KeepoutRec,
  type OutlineRec,
  type Pad,
  type ZoneRec,
} from "@protoboardai/board";
import type { Party } from "./rules.js";
import { arcEdge, circleEdge, contourEdges, regionShape, shapeAnchor, shapeBox, TAU, type Box, type ContourEdge, type Shape } from "./shapes.js";

export type ItemKind = "pad" | "track" | "via" | "graphic" | "text";

export interface CopperItem {
  /** The object's id: a record id, or `pad:<footprint key>:<pad key>`. */
  id: string;
  /** The record it comes from (a pad's footprint). */
  record: string;
  kind: ItemKind;
  net?: string;
  layers: readonly CopperLayer[];
  shape: Shape;
  /** A plated drill (through-hole pads and vias). */
  hole?: Shape;
  box: Box;
  /** Pads: the world center and rotation (radians) for thermal spokes, and whether the pad is round. */
  pad?: { x: number; y: number; rotation: number; round: boolean; drilled: boolean };
  /** What rule conditions may ask about it. */
  party: Party;
}

export interface HoleItem {
  id: string;
  record: string;
  shape: Shape;
  box: Box;
  party: Party;
}

export interface AreaItem {
  id: string;
  shape: Extract<Shape, { t: "region" }>;
  box: Box;
}

export interface BoardShapes {
  copper: CopperLayer[];
  items: CopperItem[];
  /** Non-plated holes (on every copper layer). */
  holes: HoleItem[];
  outline?: AreaItem;
  cutouts: AreaItem[];
  /** Keep-outs that block pours, with their layers. */
  keepouts: (AreaItem & { layers: readonly CopperLayer[] })[];
}

const mdegToRad = (m: number) => (m / 1000) * (Math.PI / 180);

/** A pad's copper shape (and drill) in world coordinates, unrounded. */
export function padShapes(fp: FootprintRec, pad: Pad): { copper?: Shape; hole?: Shape } {
  const rot = mdegToRad(pad.rotation ?? 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const map = (q: { x: number; y: number }) => footprintToWorld(fp, { x: pad.x + q.x * c - q.y * s, y: pad.y + q.x * s + q.y * c });
  const mirrored = fp.side === "bottom";
  const center = map({ x: 0, y: 0 });
  const rect = (w: number, h: number, cr = 0): Shape => {
    const r = Math.max(0, Math.min(cr, w / 2, h / 2));
    const iw = w / 2 - r;
    const ih = h / 2 - r;
    if (iw <= 0 && ih <= 0) return { t: "disc", cx: center.x, cy: center.y, r };
    if (iw <= 0 || ih <= 0) {
      const a = iw > 0 ? map({ x: -iw, y: 0 }) : map({ x: 0, y: -ih });
      const b = iw > 0 ? map({ x: iw, y: 0 }) : map({ x: 0, y: ih });
      return { t: "capsule", x0: a.x, y0: a.y, x1: b.x, y1: b.y, r };
    }
    const pts = [map({ x: -iw, y: -ih }), map({ x: iw, y: -ih }), map({ x: iw, y: ih }), map({ x: -iw, y: ih })];
    return regionShape(pts.map((p, i) => ({ t: "line" as const, x0: p.x, y0: p.y, x1: pts[(i + 1) % 4].x, y1: pts[(i + 1) % 4].y })), r);
  };
  const oval = (w: number, h: number): Shape => rect(w, h, Math.min(w, h) / 2);
  const shaped = (shape: Pad["shape"], w: number, h: number): Shape | undefined => {
    if (shape === "circle") return { t: "disc", cx: center.x, cy: center.y, r: w / 2 };
    if (shape === "oval") return oval(w, h);
    if (shape === "roundrect") return rect(w, h, pad.corner_radius ?? 0);
    if (shape === "polygon") return pad.points ? regionShape(contourEdges(pad.points, map, mirrored)) : rect(w, h);
    return rect(w, h);
  };
  if (pad.type === "np") return { hole: { t: "disc", cx: center.x, cy: center.y, r: (pad.hole_diameter ?? 0) / 2 } };
  if (pad.type === "smd") {
    if (pad.shape === "circle") return { copper: { t: "disc", cx: center.x, cy: center.y, r: pad.radius ?? 0 } };
    return { copper: shaped(pad.shape, pad.width ?? 0, pad.height ?? 0) };
  }
  // through hole
  const copper = pad.shape === "circle" && pad.outer_diameter !== undefined ? ({ t: "disc", cx: center.x, cy: center.y, r: pad.outer_diameter / 2 } as Shape) : shaped(pad.shape, pad.outer_width ?? pad.outer_diameter ?? 0, pad.outer_height ?? pad.outer_diameter ?? 0);
  let hole: Shape | undefined;
  if (pad.hole_diameter !== undefined) hole = { t: "disc", cx: center.x, cy: center.y, r: pad.hole_diameter / 2 };
  else if (pad.hole_width !== undefined && pad.hole_height !== undefined) hole = oval(pad.hole_width, pad.hole_height);
  return { copper, hole };
}

const box = (s: Shape): Box => shapeBox(s);
const corners = (b: Box, s: Shape) => [shapeAnchor(s), { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];

/** A graphic's copper shape (lines and arcs by their stroke, closed shapes filled when `filled`). */
function graphicShapes(g: { shape: string; start?: { x: number; y: number }; end?: { x: number; y: number }; sweep?: number; center?: { x: number; y: number }; radius?: number; width?: number; height?: number; rotation?: number; points?: { x: number; y: number; sweep?: number }[]; stroke_width: number; filled?: true }, map: (p: { x: number; y: number }) => { x: number; y: number }, mirrored: boolean): Shape[] {
  const h = g.stroke_width / 2;
  const out: Shape[] = [];
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }, sweep?: number) => {
    const p = map(a);
    const q = map(b);
    if (sweep !== undefined) {
      const e = arcEdge(p.x, p.y, q.x, q.y, mdegToRad(mirrored ? -sweep : sweep));
      out.push(e.t === "arc" ? { t: "arcband", arc: e, r: h } : { t: "capsule", x0: p.x, y0: p.y, x1: q.x, y1: q.y, r: h });
    } else out.push({ t: "capsule", x0: p.x, y0: p.y, x1: q.x, y1: q.y, r: h });
  };
  if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) seg(g.start, g.end, g.sweep);
  else if (g.shape === "circle" && g.center && g.radius) {
    const c = map(g.center);
    if (g.filled) out.push({ t: "disc", cx: c.x, cy: c.y, r: g.radius + h });
    else if (h > 0) out.push({ t: "arcband", arc: circleEdge(c.x, c.y, g.radius), r: h });
  } else if (g.shape === "rect" && g.center && g.width && g.height) {
    const rot = mdegToRad(g.rotation ?? 0);
    const corner = (dx: number, dy: number) => ({ x: g.center!.x + dx * Math.cos(rot) - dy * Math.sin(rot), y: g.center!.y + dx * Math.sin(rot) + dy * Math.cos(rot) });
    const pts = [corner(-g.width / 2, -g.height / 2), corner(g.width / 2, -g.height / 2), corner(g.width / 2, g.height / 2), corner(-g.width / 2, g.height / 2)];
    if (g.filled) out.push(regionShape(contourEdges(pts, map, mirrored), h));
    else for (let i = 0; i < 4; i++) seg(pts[i], pts[(i + 1) % 4]);
  } else if ((g.shape === "polygon" || g.shape === "path") && g.points && g.points.length >= 2) {
    if (g.shape === "polygon" && g.filled && g.points.length >= 3) out.push(regionShape(contourEdges(g.points, map, mirrored), h));
    else {
      const n = g.points.length;
      const last = g.shape === "polygon" ? n : n - 1;
      for (let i = 0; i < last; i++) seg(g.points[i], g.points[(i + 1) % n], g.points[i].sweep);
    }
  }
  return out.filter((s) => (s.t === "disc" ? s.r > 0 : s.t === "capsule" ? s.r > 0 : true));
}

function textShape(x: number, y: number, height: number, text: string, rotation: number, anchor: string | undefined, map: (p: { x: number; y: number }) => { x: number; y: number }, mirrored: boolean): Shape {
  // a box around the text (glyphs are not modeled): 0.6 of the height per character, plus a stroke
  const w = height * 0.6 * Math.max(1, text.length) + height * 0.2;
  const hh = height * 0.6;
  const x0 = anchor === "left" ? -height * 0.1 : anchor === "right" ? -w + height * 0.1 : -w / 2;
  const rot = mdegToRad(rotation);
  const pt = (dx: number, dy: number) => ({ x: x + dx * Math.cos(rot) - dy * Math.sin(rot), y: y + dx * Math.sin(rot) + dy * Math.cos(rot) });
  return regionShape(contourEdges([pt(x0, -hh), pt(x0 + w, -hh), pt(x0 + w, hh), pt(x0, hh)], map, mirrored));
}

/** Every copper object, hole and area of a board as exact shapes. */
export function collectBoardShapes(doc: BoardDocument): BoardShapes {
  const copper = copperLayers(doc);
  const isCopper = (l: string): l is CopperLayer => (copper as string[]).includes(l);
  const items: CopperItem[] = [];
  const holes: HoleItem[] = [];
  for (const fp of recordsOfKind(doc, "footprint")) {
    const keys = padKeys(fp);
    const fk = footprintKey(fp);
    const world = padsOf(fp, copper);
    fp.pads.forEach((pad, i) => {
      const id = padId(fk, keys[i]);
      const { copper: cs, hole } = padShapes(fp, pad);
      if (pad.type === "np") {
        if (hole && hole.t === "disc" && hole.r > 0) {
          const b = box(hole);
          holes.push({ id, record: fp.id, shape: hole, box: b, party: { kind: "hole", padType: "np", pad: pad.number, footprint: { ref: fp.ref, lib: fp.footprint }, at: { x: hole.cx, y: hole.cy }, box: b, points: corners(b, hole) } });
        }
        return;
      }
      if (!cs) return;
      const layers: CopperLayer[] = pad.type === "smd" ? [padWorldSide(fp, pad)].filter(isCopper) : [...copper];
      const net = doc.padNets.get(id);
      const c = cs.t === "disc" ? { x: cs.cx, y: cs.cy } : footprintToWorld(fp, pad);
      items.push({
        id,
        record: fp.id,
        kind: "pad",
        ...(net !== undefined ? { net } : {}),
        layers,
        shape: cs,
        ...(hole ? { hole } : {}),
        box: box(cs),
        pad: { x: c.x, y: c.y, rotation: mdegToRad(world[i].rotation), round: pad.shape === "circle", drilled: pad.type === "th" },
        party: { kind: "pad", ...(net !== undefined ? { net } : {}), padType: pad.type, pad: pad.number, footprint: { ref: fp.ref, lib: fp.footprint }, at: c, box: box(cs), points: corners(box(cs), cs) },
      });
    });
    const map = (p: { x: number; y: number }) => footprintToWorld(fp, p);
    const mirrored = fp.side === "bottom";
    (fp.graphics ?? []).forEach((g, gi) => {
      const layer = sideLayer(g.layer, fp.side);
      if (!isCopper(layer)) return;
      for (const s of graphicShapes(g, map, mirrored)) items.push({ id: `${fp.id}#graphic${gi}`, record: fp.id, kind: "graphic", layers: [layer], shape: s, box: box(s), party: { kind: "graphic", footprint: { ref: fp.ref, lib: fp.footprint }, box: box(s), points: corners(box(s), s) } });
    });
    (fp.texts ?? []).forEach((t, ti) => {
      const layer = sideLayer(t.layer, fp.side);
      if (!isCopper(layer)) return;
      const s = textShape(t.x, t.y, t.height, t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text, t.rotation ?? 0, t.anchor, map, mirrored);
      items.push({ id: `${fp.id}#text${ti}`, record: fp.id, kind: "text", layers: [layer], shape: s, box: box(s), party: { kind: "text", footprint: { ref: fp.ref, lib: fp.footprint }, box: box(s), points: corners(box(s), s) } });
    });
  }
  for (const t of recordsOfKind(doc, "track")) {
    let s: Shape;
    if (t.sweep !== undefined) {
      const e = arcEdge(t.start.x, t.start.y, t.end.x, t.end.y, mdegToRad(t.sweep));
      s = e.t === "arc" ? { t: "arcband", arc: e, r: t.width / 2 } : { t: "capsule", x0: t.start.x, y0: t.start.y, x1: t.end.x, y1: t.end.y, r: t.width / 2 };
    } else s = { t: "capsule", x0: t.start.x, y0: t.start.y, x1: t.end.x, y1: t.end.y, r: t.width / 2 };
    items.push({ id: t.id, record: t.id, kind: "track", ...(t.net !== undefined ? { net: t.net } : {}), layers: [t.layer], shape: s, box: box(s), party: { kind: "track", ...(t.net !== undefined ? { net: t.net } : {}), start: t.start, end: t.end, box: box(s), points: [t.start, t.end, shapeAnchor(s)] } });
  }
  for (const v of recordsOfKind(doc, "via")) {
    const s: Shape = { t: "disc", cx: v.x, cy: v.y, r: v.outer_diameter / 2 };
    const hole: Shape = { t: "disc", cx: v.x, cy: v.y, r: v.hole_diameter / 2 };
    items.push({ id: v.id, record: v.id, kind: "via", ...(v.net !== undefined ? { net: v.net } : {}), layers: viaLayers(doc, v.from_layer, v.to_layer), shape: s, hole, box: box(s), party: { kind: "via", ...(v.net !== undefined ? { net: v.net } : {}), at: { x: v.x, y: v.y }, box: box(s), points: [{ x: v.x, y: v.y }] } });
  }
  for (const g of recordsOfKind(doc, "graphic")) {
    if (!isCopper(g.layer)) continue;
    for (const s of graphicShapes(g, (p) => p, false)) items.push({ id: g.id, record: g.id, kind: "graphic", layers: [g.layer], shape: s, box: box(s), party: { kind: "graphic", box: box(s), points: corners(box(s), s) } });
  }
  for (const t of recordsOfKind(doc, "text")) {
    if (!isCopper(t.layer)) continue;
    const s = textShape(t.x, t.y, t.height, t.text, t.rotation ?? 0, t.anchor, (p) => p, false);
    items.push({ id: t.id, record: t.id, kind: "text", layers: [t.layer], shape: s, box: box(s), party: { kind: "text", box: box(s), points: corners(box(s), s) } });
  }
  const area = (id: string, rec: OutlineRec | CutoutRec | KeepoutRec | ZoneRec): AreaItem => {
    const shape = regionShape(contourEdges(rec.outline)) as Extract<Shape, { t: "region" }>;
    return { id, shape, box: shapeBox(shape) };
  };
  const outlineRec = doc.records.get("outline");
  const outline = outlineRec?.kind === "outline" ? area("outline", outlineRec) : undefined;
  const cutouts = recordsOfKind(doc, "cutout").map((c) => area(c.id, c));
  const keepouts = recordsOfKind(doc, "keepout")
    .filter((k) => k.blocks.pours)
    .map((k) => ({ ...area(k.id, k), layers: k.layers }));
  return { copper, items, holes, ...(outline ? { outline } : {}), cutouts, keepouts };
}

/** A zone's outline as an exact region. */
export const zoneRegion = (z: ZoneRec): Extract<Shape, { t: "region" }> => regionShape(contourEdges(z.outline)) as Extract<Shape, { t: "region" }>;

export { TAU, type ContourEdge };

/** A zone as one side of a rule's pair: its net, box and outline corners. */
export function zoneParty(z: ZoneRec): Party {
  const b = shapeBox(zoneRegion(z));
  return { kind: "zone", ...(z.net !== undefined ? { net: z.net } : {}), box: b, points: z.outline.map((v) => ({ x: v.x, y: v.y })) };
}

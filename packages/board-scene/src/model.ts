/**
 * The scene model: a board document converted once to millimeters and degrees, with world pads, flattened arcs and
 * the rule values the relations need. Every object keeps the core's id. Built from a `BoardSnapshot` or a bare
 * `BoardDocument`; the model is a plain read-only view and never writes.
 */
import {
  boundsOf,
  copperLayers,
  footprintToWorld,
  netClassOf,
  padsOf,
  recordsOfKind,
  sideLayer,
  toDeg,
  toMm,
  type BoardDocument,
  type BoardSnapshot,
  type FootprintGraphic,
  type FootprintRec,
  type KeepoutRec,
  type Provenance,
  type RuleRec,
  type TrackRec,
  type Vertex,
  type ZoneRec,
} from "@protoboardai/board";
import { arcPoints, boxOfPoints, byStr, natCmp, polyLength, polygonArea, type BoxMm, type Pt } from "./util.js";

const mmBox = (b: { minX: number; minY: number; maxX: number; maxY: number }): BoxMm => ({ minX: toMm(b.minX), minY: toMm(b.minY), maxX: toMm(b.maxX), maxY: toMm(b.maxY) });
const mmPt = (p: { x: number; y: number }): Pt => ({ x: toMm(p.x), y: toMm(p.y) });

/** A pad's copper as a rounded box (rect, roundrect, oval, circle) or a polygon, in world millimeters. */
export type PadShape = { kind: "rbox"; cx: number; cy: number; hw: number; hh: number; rr: number; rot: number } | { kind: "poly"; pts: Pt[] };

export interface MPad {
  id: string;
  footprint: string;
  ref: string;
  number: string;
  net?: string;
  pin?: string;
  type: "smd" | "th" | "np";
  shapeName: string;
  x: number;
  y: number;
  /** World rotation of the pad shape, degrees. */
  rot: number;
  /** Copper size (mm). */
  w: number;
  h: number;
  /** Drill: diameter, or slot width and height. */
  hole?: number | [number, number];
  layers: string[];
  box: BoxMm;
  shape: PadShape;
}

export interface MDrawing {
  layer: string;
  /** World polylines; closed ones repeat the first point. */
  lines: Pt[][];
  filled: boolean;
  w: number;
}

export interface MText {
  id: string;
  layer: string;
  text: string;
  x: number;
  y: number;
  h: number;
  rot: number;
  anchor: "center" | "left" | "right";
  role?: "ref" | "value" | "user";
}

export interface MFootprint {
  id: string;
  ref: string;
  value?: string;
  footprint: string;
  path?: string;
  side: "top" | "bottom";
  x: number;
  y: number;
  rot: number;
  box: BoxMm;
  pads: MPad[];
  /** Courtyard in world coordinates (closed), when the footprint has one. */
  courtyard?: Pt[];
  drawings: MDrawing[];
  texts: MText[];
  nets: string[];
  /** Copper layers the footprint has pads on. */
  copper: string[];
  locked: boolean;
  prov: Provenance;
}

export interface MTrack {
  id: string;
  net?: string;
  layer: string;
  w: number;
  a: Pt;
  b: Pt;
  /** Arc sweep, degrees (absent: straight). */
  sweep?: number;
  /** The centerline, arcs flattened in 5 degree steps. */
  pts: Pt[];
  len: number;
  box: BoxMm;
  locked: boolean;
  prov: Provenance;
}

export interface MVia {
  id: string;
  net?: string;
  x: number;
  y: number;
  d: number;
  hole: number;
  from: string;
  to: string;
  layers: string[];
  box: BoxMm;
  locked: boolean;
  prov: Provenance;
}

export interface MArea {
  id: string;
  kind: "zone" | "keepout";
  net?: string;
  name?: string;
  layers: string[];
  outline: Pt[];
  box: BoxMm;
  area: number;
  locked: boolean;
  prov: Provenance;
  /** zone */
  priority?: number;
  fill?: string;
  connect?: string;
  /** keepout */
  blocks?: { tracks: boolean; vias: boolean; pours: boolean; footprints: boolean };
  tier?: "no_go" | "policy";
  owner?: string;
  description?: string;
}

export interface MNet {
  name: string;
  id: string;
  class: string;
  /** Pad ids, sorted. */
  pads: string[];
  /** Netlist pins with no pad on the board. */
  missingPins: string[];
}

export interface RuleValues {
  /** Target track width (mm): the global target rule's preferred value, else its min, else the floor. */
  trackWidth: number;
  /** Target copper clearance (mm). */
  clearance: number;
  /** Edge clearance floor (mm). */
  edgeClearance: number;
}

export interface BoardModel {
  doc: BoardDocument;
  epoch?: string;
  seq?: number;
  name: string;
  thickness: number;
  /** Copper layer names, top to bottom. */
  copper: string[];
  /** The outline's box (board box). */
  box: BoxMm;
  outline: Pt[];
  cutouts: Pt[][];
  footprints: MFootprint[];
  fpById: Map<string, MFootprint>;
  pads: MPad[];
  padById: Map<string, MPad>;
  tracks: MTrack[];
  trackById: Map<string, MTrack>;
  vias: MVia[];
  viaById: Map<string, MVia>;
  zones: MArea[];
  keepouts: MArea[];
  areaById: Map<string, MArea>;
  texts: MText[];
  drawings: (MDrawing & { id: string })[];
  nets: MNet[];
  netByName: Map<string, MNet>;
  rules: RuleValues;
}

/** Whether a value is a snapshot (it has a document) rather than a document. */
export function isSnapshot(v: BoardSnapshot | BoardDocument): v is BoardSnapshot {
  return (v as BoardSnapshot).doc !== undefined && (v as BoardSnapshot).seq !== undefined;
}

/** A contour (closed) or path in world millimeters, arcs flattened. */
export function flatten(vertices: readonly Vertex[], closed = true, map: (p: { x: number; y: number }) => { x: number; y: number } = (p) => p): Pt[] {
  const out: Pt[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
    const a = mmPt(map(v));
    if (v.sweep !== undefined && next) {
      // the arc is defined in the record's own frame; map each point
      const pts = arcPoints({ x: v.x, y: v.y }, { x: next.x, y: next.y }, toDeg(v.sweep));
      for (let k = 0; k < pts.length - 1; k++) out.push(mmPt(map(pts[k])));
    } else out.push(a);
  }
  if (closed && out.length) out.push({ ...out[0] });
  return out;
}

function graphicLines(g: FootprintGraphic | (FootprintGraphic & { id: string }), map: (p: { x: number; y: number }) => { x: number; y: number }): Pt[][] {
  const P = (p: { x: number; y: number }) => mmPt(map(p));
  if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) {
    if (g.sweep !== undefined) return [arcPoints(g.start, g.end, toDeg(g.sweep)).map(P)];
    return [[P(g.start), P(g.end)]];
  }
  if (g.shape === "circle" && g.center && g.radius !== undefined) {
    const pts: Pt[] = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push(P({ x: g.center.x + g.radius * Math.cos(a), y: g.center.y + g.radius * Math.sin(a) }));
    }
    return [pts];
  }
  if (g.shape === "rect" && g.center && g.width !== undefined && g.height !== undefined) {
    const rot = ((g.rotation ?? 0) / 1000) * (Math.PI / 180);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ].map(([dx, dy]) => {
      const x = (dx * g.width!) / 2;
      const y = (dy * g.height!) / 2;
      return P({ x: g.center!.x + x * c - y * s, y: g.center!.y + x * s + y * c });
    });
    return [corners];
  }
  if (g.points) return [flatten(g.points, g.shape === "polygon", map)];
  return [];
}

function padShape(fp: FootprintRec, wp: ReturnType<typeof padsOf>[number]): { shape: PadShape; w: number; h: number; hole?: number | [number, number] } {
  const p = wp.pad;
  const cx = toMm(wp.x);
  const cy = toMm(wp.y);
  const rot = (wp.rotation / 1000) * (Math.PI / 180);
  const box = (w: number, h: number, rr: number): PadShape => ({ kind: "rbox", cx, cy, hw: w / 2, hh: h / 2, rr: Math.min(rr, w / 2, h / 2), rot });
  if (p.type === "np") {
    const d = toMm(p.hole_diameter ?? 0);
    return { shape: box(d, d, d / 2), w: d, h: d, hole: d };
  }
  if (p.type === "th") {
    const hole: number | [number, number] = p.hole_diameter !== undefined ? toMm(p.hole_diameter) : [toMm(p.hole_width ?? 0), toMm(p.hole_height ?? 0)];
    if (p.shape === "circle") {
      const d = toMm(p.outer_diameter ?? 0);
      return { shape: box(d, d, d / 2), w: d, h: d, hole };
    }
    const w = toMm(p.outer_width ?? 0);
    const h = toMm(p.outer_height ?? 0);
    const rr = p.shape === "oval" ? Math.min(w, h) / 2 : p.shape === "roundrect" ? toMm(p.corner_radius ?? 0) : 0;
    return { shape: box(w, h, rr), w, h, hole };
  }
  if (p.shape === "circle") {
    const d = 2 * toMm(p.radius ?? 0);
    return { shape: box(d, d, d / 2), w: d, h: d };
  }
  if (p.shape === "polygon" && p.points) {
    const r = ((p.rotation ?? 0) / 1000) * (Math.PI / 180);
    const c = Math.cos(r);
    const s = Math.sin(r);
    const pts = p.points.map((v) => mmPt(footprintToWorld(fp, { x: p.x + v.x * c - v.y * s, y: p.y + v.x * s + v.y * c })));
    pts.push({ ...pts[0] });
    const b = boxOfPoints(pts);
    return { shape: { kind: "poly", pts }, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }
  const w = toMm(p.width ?? 0);
  const h = toMm(p.height ?? 0);
  const rr = p.shape === "oval" ? Math.min(w, h) / 2 : p.shape === "roundrect" ? toMm(p.corner_radius ?? 0) : 0;
  return { shape: box(w, h, rr), w, h };
}

function ruleValues(doc: BoardDocument): RuleValues {
  const rules = (recordsOfKind(doc, "rule") as RuleRec[]).filter((r) => r.enabled !== false);
  const global = (r: RuleRec) => !r.applies.nets && !r.applies.classes && !r.applies.layers && !r.applies.region && !r.applies.between;
  const pick = (check: string, tiers: string[], fallback: number, usePreferred: boolean) => {
    for (const tier of tiers) {
      const r = rules.find((x) => x.check === check && x.tier === tier && global(x));
      if (r) {
        const v = usePreferred ? (r.preferred ?? r.min) : (r.min ?? r.preferred);
        if (v !== undefined) return toMm(v);
      }
    }
    return fallback;
  };
  return { trackWidth: pick("track_width", ["target", "floor"], 0.2, true), clearance: pick("clearance", ["target", "floor"], 0.2, false), edgeClearance: pick("edge_clearance", ["floor", "target"], 0.3, false) };
}

/** Build the model of a snapshot or document. */
export function buildModel(input: BoardSnapshot | BoardDocument): BoardModel {
  const snap = isSnapshot(input) ? input : undefined;
  const doc = snap ? snap.doc : (input as BoardDocument);
  const copper = copperLayers(doc) as string[];
  const boardRec = doc.records.get("board");
  const outlineRec = doc.records.get("outline");
  const outline = outlineRec?.kind === "outline" ? flatten(outlineRec.outline) : [];
  const cutouts = recordsOfKind(doc, "cutout").map((c) => flatten(c.outline));

  const footprints: MFootprint[] = [];
  const pads: MPad[] = [];
  for (const fp of recordsOfKind(doc, "footprint") as FootprintRec[]) {
    const map = (p: { x: number; y: number }) => footprintToWorld(fp, p);
    const fpPads: MPad[] = padsOf(fp, copper as never).map((wp) => {
      const s = padShape(fp, wp);
      const net = doc.padNets.get(wp.id);
      return {
        id: wp.id,
        footprint: fp.id,
        ref: fp.ref,
        number: wp.pad.number,
        ...(net ? { net } : {}),
        ...(wp.pad.pin ? { pin: wp.pad.pin } : {}),
        type: wp.pad.type,
        shapeName: wp.pad.shape,
        x: toMm(wp.x),
        y: toMm(wp.y),
        rot: toDeg(wp.rotation),
        w: s.w,
        h: s.h,
        ...(s.hole !== undefined ? { hole: s.hole } : {}),
        layers: wp.layers as string[],
        box: mmBox(wp.box),
        shape: s.shape,
      };
    });
    pads.push(...fpPads);
    const drawings: MDrawing[] = (fp.graphics ?? []).map((g) => ({ layer: sideLayer(g.layer, fp.side), lines: graphicLines(g, map), filled: g.filled === true, w: toMm(g.stroke_width) }));
    const texts: MText[] = (fp.texts ?? []).map((t, i) => {
      const w = mmPt(map(t));
      return {
        id: `${fp.id}#text${i}`,
        layer: sideLayer(t.layer, fp.side),
        text: t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text,
        x: w.x,
        y: w.y,
        h: toMm(t.height),
        rot: toDeg(((t.rotation ?? 0) + fp.rotation) % 360_000),
        anchor: t.anchor ?? "center",
        ...(t.role ? { role: t.role } : {}),
      };
    });
    const nets = [...new Set(fpPads.map((p) => p.net).filter((n): n is string => !!n))].sort(byStr);
    const fpCopper = copper.filter((l) => fpPads.some((p) => p.layers.includes(l)));
    footprints.push({
      id: fp.id,
      ref: fp.ref,
      ...(fp.value ? { value: fp.value } : {}),
      footprint: fp.footprint,
      ...(fp.path ? { path: fp.path } : {}),
      side: fp.side,
      x: toMm(fp.x),
      y: toMm(fp.y),
      rot: toDeg(fp.rotation),
      box: mmBox(boundsOf(fp)!),
      pads: fpPads,
      ...(fp.courtyard ? { courtyard: flatten(fp.courtyard, true, map) } : {}),
      drawings,
      texts,
      nets,
      copper: fpCopper,
      locked: fp.locked === true,
      prov: fp.provenance,
    });
  }
  footprints.sort((a, b) => natCmp(a.ref, b.ref) || byStr(a.id, b.id));
  pads.sort((a, b) => byStr(a.id, b.id));

  const tracks: MTrack[] = (recordsOfKind(doc, "track") as TrackRec[]).map((t) => {
    const a = mmPt(t.start);
    const b = mmPt(t.end);
    const pts = t.sweep !== undefined ? arcPoints(t.start, t.end, toDeg(t.sweep)).map(mmPt) : [a, b];
    return {
      id: t.id,
      ...(t.net ? { net: t.net } : {}),
      layer: t.layer,
      w: toMm(t.width),
      a,
      b,
      ...(t.sweep !== undefined ? { sweep: toDeg(t.sweep) } : {}),
      pts,
      len: polyLength(pts),
      box: mmBox(boundsOf(t)!),
      locked: t.locked === true,
      prov: t.provenance,
    };
  });

  const vias: MVia[] = recordsOfKind(doc, "via").map((v) => {
    const a = copper.indexOf(v.from_layer);
    const b = copper.indexOf(v.to_layer);
    const layers = a >= 0 && b >= 0 ? copper.slice(Math.min(a, b), Math.max(a, b) + 1) : [v.from_layer, v.to_layer];
    return {
      id: v.id,
      ...(v.net ? { net: v.net } : {}),
      x: toMm(v.x),
      y: toMm(v.y),
      d: toMm(v.outer_diameter),
      hole: toMm(v.hole_diameter),
      from: v.from_layer,
      to: v.to_layer,
      layers,
      box: mmBox(boundsOf(v)!),
      locked: v.locked === true,
      prov: v.provenance,
    };
  });

  const area = (rec: ZoneRec | KeepoutRec): MArea => {
    const pts = flatten(rec.outline);
    const base = { id: rec.id, ...(rec.name ? { name: rec.name } : {}), layers: [...rec.layers] as string[], outline: pts, box: mmBox(boundsOf(rec)!), area: Math.abs(polygonArea(pts)), locked: rec.locked === true, prov: rec.provenance };
    if (rec.kind === "zone") return { ...base, kind: "zone", ...(rec.net ? { net: rec.net } : {}), priority: rec.priority, fill: rec.fill_mode, connect: rec.pad_connection };
    return { ...base, kind: "keepout", blocks: { ...rec.blocks }, tier: rec.tier, ...(rec.footprint ? { owner: rec.footprint } : {}), ...(rec.description ? { description: rec.description } : {}) };
  };
  const zones = (recordsOfKind(doc, "zone") as ZoneRec[]).map(area);
  const keepouts = (recordsOfKind(doc, "keepout") as KeepoutRec[]).map(area);

  const texts: MText[] = recordsOfKind(doc, "text").map((t) => ({ id: t.id, layer: t.layer, text: t.text, x: toMm(t.x), y: toMm(t.y), h: toMm(t.height), rot: toDeg(t.rotation ?? 0), anchor: t.anchor ?? "center" }));
  const drawings = recordsOfKind(doc, "graphic").map((g) => ({ id: g.id, layer: g.layer, lines: graphicLines(g as never, (p) => p), filled: g.filled === true, w: toMm(g.stroke_width) }));

  const netNames = new Set<string>(doc.nets.keys());
  for (const t of tracks) if (t.net) netNames.add(t.net);
  for (const v of vias) if (v.net) netNames.add(v.net);
  for (const z of zones) if (z.net) netNames.add(z.net);
  const nets: MNet[] = [...netNames].sort(byStr).map((name) => {
    const info = doc.nets.get(name);
    return { name, id: `net:${name}`, class: netClassOf(doc, name), pads: info ? [...info.pads] : [], missingPins: info ? [...info.missing] : [] };
  });

  const box = outline.length ? boxOfPoints(outline) : boxOfPoints([...pads.map((p) => ({ x: p.x, y: p.y })), ...tracks.flatMap((t) => [t.a, t.b])]);
  return {
    doc,
    ...(snap ? { epoch: snap.epoch, seq: snap.seq } : {}),
    name: boardRec?.kind === "board" ? boardRec.name : "board",
    thickness: boardRec?.kind === "board" ? toMm(boardRec.thickness) : 1.6,
    copper,
    box,
    outline,
    cutouts,
    footprints,
    fpById: new Map(footprints.map((f) => [f.id, f])),
    pads,
    padById: new Map(pads.map((p) => [p.id, p])),
    tracks,
    trackById: new Map(tracks.map((t) => [t.id, t])),
    vias,
    viaById: new Map(vias.map((v) => [v.id, v])),
    zones,
    keepouts,
    areaById: new Map([...zones, ...keepouts].map((a) => [a.id, a])),
    texts,
    drawings,
    nets,
    netByName: new Map(nets.map((n) => [n.name, n])),
    rules: ruleValues(doc),
  };
}

/** Signed distance from a point to a pad's copper (negative inside). */
export function padSdf(shape: PadShape, p: Pt): number {
  if (shape.kind === "poly") {
    let d = Infinity;
    for (let i = 0; i + 1 < shape.pts.length; i++) {
      const a = shape.pts[i];
      const b = shape.pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    let inside = false;
    const poly = shape.pts;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside ? -d : d;
  }
  const c = Math.cos(-shape.rot);
  const s = Math.sin(-shape.rot);
  const dx = p.x - shape.cx;
  const dy = p.y - shape.cy;
  const lx = Math.abs(dx * c - dy * s);
  const ly = Math.abs(dx * s + dy * c);
  const qx = lx - (shape.hw - shape.rr);
  const qy = ly - (shape.hh - shape.rr);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - shape.rr;
}

/** The objects a scene can name by id. */
export function objectKind(model: BoardModel, id: string): "footprint" | "pad" | "track" | "via" | "zone" | "keepout" | "net" | undefined {
  if (model.fpById.has(id)) return "footprint";
  if (model.padById.has(id)) return "pad";
  if (model.trackById.has(id)) return "track";
  if (model.viaById.has(id)) return "via";
  const a = model.areaById.get(id);
  if (a) return a.kind;
  if (id.startsWith("net:") && model.netByName.has(id.slice(4))) return "net";
  return undefined;
}

/** The box of an object the scene can name. */
export function objectBox(model: BoardModel, id: string): BoxMm | undefined {
  const k = objectKind(model, id);
  if (k === "footprint") return model.fpById.get(id)!.box;
  if (k === "pad") return model.padById.get(id)!.box;
  if (k === "track") return model.trackById.get(id)!.box;
  if (k === "via") return model.viaById.get(id)!.box;
  if (k === "zone" || k === "keepout") return model.areaById.get(id)!.box;
  if (k === "net") return netBox(model, id.slice(4));
  return undefined;
}

/** The box of a net's pads, tracks, vias (zones left out: a pour can cover the board). */
export function netBox(model: BoardModel, net: string): BoxMm | undefined {
  const pts: Pt[] = [];
  for (const id of model.netByName.get(net)?.pads ?? []) {
    const p = model.padById.get(id);
    if (p) pts.push({ x: p.box.minX, y: p.box.minY }, { x: p.box.maxX, y: p.box.maxY });
  }
  for (const t of model.tracks) if (t.net === net) pts.push({ x: t.box.minX, y: t.box.minY }, { x: t.box.maxX, y: t.box.maxY });
  for (const v of model.vias) if (v.net === net) pts.push({ x: v.box.minX, y: v.box.minY }, { x: v.box.maxX, y: v.box.maxY });
  return pts.length ? boxOfPoints(pts) : undefined;
}

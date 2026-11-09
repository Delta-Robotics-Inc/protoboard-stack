/**
 * The renderer's scene: the board document turned into drawable objects. One scene object per record (and one per
 * pad, by its derived `pad:` id), each with items on draw layers made of the primitive parts in geom.ts. Pure
 * data, no WebGL, so it is built and tested in Node; the GPU side (buffers.ts, renderer.ts) flattens it.
 *
 * Incremental: `updateScene` takes the ids a commit changed and rebuilds only those objects (a footprint brings
 * its pads; a cutout brings the board outline), reporting which objects changed so only they are re-uploaded.
 * Derived inputs (zone fills, ratsnest) are set with `setFills` and `setRatsnest`.
 */
import {
  copperLayers,
  footprintToWorld,
  padsOf,
  sideLayer,
  type BoardDocument,
  type BoardRecord,
  type CopperLayer,
  type FootprintGraphic,
  type FootprintRec,
  type Pad,
  type WorldPad,
} from "./board.js";
import { strokeText, textWidth } from "./font.js";
import { contourPoints, arcPoints, FLAG, hatchLines, mapPoints, NM, partsRect, EMPTY_RECT, growRect, rectEmpty, type Part, type Rect } from "./geom.js";
import { cu, drawLayerOf, drawLayers, sideId, type DrawLayerDef, type DrawLayerId } from "./layers.js";
import type { RatsnestPair, ZoneFill } from "./types.js";

export type SceneKind = "footprint" | "pad" | "track" | "via" | "zone" | "keepout" | "outline" | "cutout" | "graphic" | "text" | "ratsnest";

export interface SceneItem {
  layer: DrawLayerId;
  parts: Part[];
  flags: number;
  /** Shown only at or above this many pixels per millimeter (labels); 0 always. */
  minScale: number;
  /** The item's own net index when it differs from the object's (ratsnest lines). */
  net?: number;
}

export interface SceneObject {
  id: string;
  kind: SceneKind;
  /** Slot in the object state texture (selection, hover). Stable for the scene's life. */
  index: number;
  /** Net index (0: no net). */
  net: number;
  netName?: string;
  /** Owning footprint id (pads, and the footprint itself). */
  footprint?: string;
  /** Owning footprint's object index, -1 when none (drag offsets apply per footprint). */
  fp: number;
  items: SceneItem[];
  rect: Rect;
  /** Copper layers the object has copper on (picking honors the visible and active layers). */
  copper: CopperLayer[];
  /** Exact pick geometry when it is not the drawn geometry (a footprint: its courtyard area). */
  pick?: Part[];
  locked?: boolean;
}

export interface SceneOptions {
  fills?: readonly ZoneFill[];
  ratsnest?: readonly RatsnestPair[];
}

export interface Scene {
  doc: BoardDocument;
  copper: CopperLayer[];
  layers: DrawLayerDef[];
  objects: Map<string, SceneObject>;
  /** Object index to object (holes where objects were removed). */
  byIndex: (SceneObject | undefined)[];
  /** Net index to name; 0 is "no net". */
  nets: string[];
  netIndex: Map<string, number>;
  /** Pad object ids per footprint id. */
  padsOf: Map<string, string[]>;
  fills: Map<string, ZoneFill[]>;
  ratsnest: readonly RatsnestPair[];
  /** The board's extent (the outline, else everything), millimeters. */
  rect: Rect;
}

// ---------------------------------------------------------------- helpers

const rad = (mdeg: number) => ((mdeg / 1000) * Math.PI) / 180;
const LABEL_MIN_PX = 7;
const EDGE_WIDTH = 0.1;
const COURTYARD_WIDTH = 0.05;
const KEEPOUT_HATCH = 0.6;

/** A footprint-frame point (millimeters) in world millimeters. */
function fpMap(fp: FootprintRec): (x: number, y: number) => { x: number; y: number } {
  return (x, y) => {
    const w = footprintToWorld(fp, { x: x / NM, y: y / NM });
    return { x: w.x * NM, y: w.y * NM };
  };
}
const ident = (x: number, y: number) => ({ x, y });

/** A readable angle: text never reads upside down. */
function readable(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r > Math.PI / 2 + 1e-6) r -= Math.PI;
  if (r <= -Math.PI / 2 - 1e-6) r += Math.PI;
  return r;
}

function textParts(text: string, x: number, y: number, height: number, stroke: number | undefined, angle: number, anchor: "center" | "left" | "right" = "center", mirror = false): Part[] {
  const paths = strokeText(text, x, y, height, angle, anchor, mirror);
  return paths.length ? [{ k: "text", paths, w: stroke ?? height * 0.15 }] : [];
}

/** A graphic's parts (shape fields in nanometers in the frame `map` takes to world millimeters). */
function graphicParts(g: FootprintGraphic, map: (x: number, y: number) => { x: number; y: number }): Part[] {
  const w = g.stroke_width * NM;
  const P = (p: { x: number; y: number }) => map(p.x * NM, p.y * NM);
  switch (g.shape) {
    case "line":
    case "arc": {
      if (!g.start || !g.end) return [];
      if (g.sweep !== undefined) return [{ k: "path", pts: mapPoints(arcPoints(g.start, g.end, g.sweep), map), w, closed: false }];
      const a = P(g.start);
      const b = P(g.end);
      return [{ k: "seg", x1: a.x, y1: a.y, x2: b.x, y2: b.y, w }];
    }
    case "circle": {
      if (!g.center || g.radius === undefined) return [];
      const c = P(g.center);
      const r = g.radius * NM;
      if (g.filled) return [{ k: "ring", cx: c.x, cy: c.y, r: r + w / 2, ri: 0 }];
      if (w > 0) return [{ k: "ring", cx: c.x, cy: c.y, r: r + w / 2, ri: Math.max(0, r - w / 2) }];
      const pts: number[] = [];
      for (let i = 0; i < 64; i++) pts.push(c.x + r * Math.cos((i / 64) * 2 * Math.PI), c.y + r * Math.sin((i / 64) * 2 * Math.PI));
      return [{ k: "path", pts, w: 0, closed: true }];
    }
    case "rect": {
      if (!g.center || g.width === undefined || g.height === undefined) return [];
      const a = rad(g.rotation ?? 0);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pts: number[] = [];
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const lx = (dx * g.width) / 2;
        const ly = (dy * g.height) / 2;
        const q = map((g.center.x + lx * c - ly * s) * NM, (g.center.y + lx * s + ly * c) * NM);
        pts.push(q.x, q.y);
      }
      return g.filled ? [{ k: "poly", rings: [pts] }, ...(w > 0 ? [{ k: "path" as const, pts, w, closed: true }] : [])] : [{ k: "path", pts, w, closed: true }];
    }
    case "polygon": {
      if (!g.points) return [];
      const pts = mapPoints(contourPoints(g.points, true), map);
      return g.filled ? [{ k: "poly", rings: [pts] }, ...(w > 0 ? [{ k: "path" as const, pts, w, closed: true }] : [])] : [{ k: "path", pts, w, closed: true }];
    }
    case "path": {
      if (!g.points) return [];
      return [{ k: "path", pts: mapPoints(contourPoints(g.points, false), map), w, closed: false }];
    }
  }
}

/** A pad's copper shape grown by `grow` millimeters (mask and paste margins), in world millimeters. */
export function padShape(fp: FootprintRec, wp: WorldPad, grow = 0): Part[] {
  const p: Pad = wp.pad;
  const cx = wp.x * NM;
  const cy = wp.y * NM;
  const a = rad(wp.rotation);
  const box = (w: number, h: number, corner: number): Part => ({ k: "box", cx, cy, hx: (w * NM) / 2 + grow, hy: (h * NM) / 2 + grow, a, c: Math.max(0, corner + grow) });
  const polygon = (): Part[] => {
    // pad frame (rotation, then the pad's own offset) into the footprint frame, then the world
    const m = fpMap(fp);
    const pr = rad(p.rotation ?? 0);
    const c = Math.cos(pr);
    const s = Math.sin(pr);
    const pts = mapPoints(contourPoints(p.points ?? [], true), (x, y) => m(p.x * NM + x * c - y * s, p.y * NM + x * s + y * c));
    const out: Part[] = [{ k: "poly", rings: [pts] }];
    if (grow > 0) out.push({ k: "path", pts, w: 2 * grow, closed: true });
    return out;
  };
  if (p.type === "np") return [];
  if (p.type === "smd") {
    if (p.shape === "circle") return [{ k: "ring", cx, cy, r: (p.radius ?? 0) * NM + grow, ri: 0 }];
    if (p.shape === "polygon") return polygon();
    const w = p.width ?? 0;
    const h = p.height ?? 0;
    const corner = p.shape === "oval" ? (Math.min(w, h) * NM) / 2 : p.shape === "roundrect" ? (p.corner_radius ?? Math.min(w, h) * 0.25) * NM : 0;
    return [box(w, h, corner)];
  }
  // plated through hole
  if (p.shape === "circle") return [{ k: "ring", cx, cy, r: ((p.outer_diameter ?? 0) * NM) / 2 + grow, ri: 0 }];
  if (p.shape === "polygon") return polygon();
  const w = p.outer_width ?? p.outer_diameter ?? 0;
  const h = p.outer_height ?? p.outer_diameter ?? 0;
  const corner = p.shape === "oval" ? (Math.min(w, h) * NM) / 2 : p.shape === "roundrect" ? (p.corner_radius ?? Math.min(w, h) * 0.25) * NM : 0;
  return [box(w, h, corner)];
}

/** A pad's drilled hole, if it has one. */
export function padHole(wp: WorldPad): Part | undefined {
  const p = wp.pad;
  if (p.type === "smd") return undefined;
  const cx = wp.x * NM;
  const cy = wp.y * NM;
  if (p.hole_diameter !== undefined) return { k: "ring", cx, cy, r: (p.hole_diameter * NM) / 2, ri: 0 };
  if (p.hole_width !== undefined && p.hole_height !== undefined) {
    const hx = (p.hole_width * NM) / 2;
    const hy = (p.hole_height * NM) / 2;
    return { k: "box", cx, cy, hx, hy, a: rad(wp.rotation), c: Math.min(hx, hy) };
  }
  return undefined;
}

/** A label that fits inside a pad: its long axis, sized to the pad, readable. */
function padLabel(text: string, shape: Part[]): SceneItem | undefined {
  const s = shape[0];
  if (!s) return undefined;
  let cx: number, cy: number, long: number, short: number, a: number;
  if (s.k === "box") {
    cx = s.cx;
    cy = s.cy;
    long = 2 * Math.max(s.hx, s.hy);
    short = 2 * Math.min(s.hx, s.hy);
    a = s.hx >= s.hy ? s.a : s.a + Math.PI / 2;
  } else if (s.k === "ring") {
    cx = s.cx;
    cy = s.cy;
    long = short = 2 * s.r * 0.75;
    a = 0;
  } else {
    const r = partsRect(shape);
    cx = (r[0] + r[2]) / 2;
    cy = (r[1] + r[3]) / 2;
    long = Math.max(r[2] - r[0], r[3] - r[1]) * 0.7;
    short = Math.min(r[2] - r[0], r[3] - r[1]) * 0.7;
    a = r[2] - r[0] >= r[3] - r[1] ? 0 : Math.PI / 2;
  }
  const n = [...text].length;
  const h = Math.min(short * 0.42, (long * 0.86) / Math.max(1, textWidth(text, 1) || n));
  if (!(h > 0)) return undefined;
  return { layer: "labels:pads", parts: textParts(text, cx, cy, h, h * 0.13, readable(a)), flags: 0, minScale: LABEL_MIN_PX / h };
}

// ---------------------------------------------------------------- building

function netIdx(scene: Scene, name: string | undefined): number {
  if (!name) return 0;
  let i = scene.netIndex.get(name);
  if (i === undefined) {
    i = scene.nets.length;
    scene.nets.push(name);
    scene.netIndex.set(name, i);
  }
  return i;
}

const nextIndexFor = new WeakMap<Scene, number>();
function newIndex(scene: Scene): number {
  const i = nextIndexFor.get(scene) ?? 1;
  nextIndexFor.set(scene, i + 1);
  return i;
}

function put(scene: Scene, obj: Omit<SceneObject, "index" | "rect"> & { rect?: Rect }): SceneObject {
  const old = scene.objects.get(obj.id);
  const index = old?.index ?? newIndex(scene);
  const rect = obj.rect ?? partsRect(obj.items.flatMap((i) => i.parts));
  const o: SceneObject = { ...obj, index, rect };
  scene.objects.set(o.id, o);
  scene.byIndex[index] = o;
  return o;
}

function drop(scene: Scene, id: string): void {
  const o = scene.objects.get(id);
  if (!o) return;
  scene.objects.delete(id);
  scene.byIndex[o.index] = undefined;
}

const isHand = (r: { provenance?: { by: string; edited?: string } }) => r.provenance?.by === "hand" || r.provenance?.edited === "hand";
const isRouted = (r: { provenance?: { by: string; edited?: string } }) => r.provenance?.by === "routed" && r.provenance?.edited !== "hand";

function buildFootprint(scene: Scene, fp: FootprintRec, changed: Set<string>): void {
  const map = fpMap(fp);
  const items: SceneItem[] = [];
  const side = fp.side;
  for (const g of fp.graphics ?? []) {
    const parts = graphicParts(g, map);
    if (parts.length) items.push({ layer: drawLayerOf(sideLayer(g.layer, side)), parts, flags: 0, minScale: 0 });
  }
  for (const t of fp.texts ?? []) {
    const text = t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text;
    const w = map(t.x * NM, t.y * NM);
    const mirror = side === "bottom";
    const angle = rad(mirror ? fp.rotation - (t.rotation ?? 0) : fp.rotation + (t.rotation ?? 0));
    const parts = textParts(text, w.x, w.y, t.height * NM, t.stroke_width !== undefined ? t.stroke_width * NM : undefined, readable(angle), t.anchor ?? "center", mirror);
    if (parts.length) items.push({ layer: drawLayerOf(sideLayer(t.layer, side)), parts, flags: 0, minScale: 0 });
  }
  let pick: Part[] | undefined;
  if (fp.courtyard) {
    const pts = mapPoints(contourPoints(fp.courtyard, true), map);
    items.push({ layer: sideId("crtyd", side), parts: [{ k: "path", pts, w: COURTYARD_WIDTH, closed: true }], flags: 0, minScale: 0 });
    pick = [{ k: "poly", rings: [pts] }];
  }
  // pads
  const pads = padsOf(fp, scene.copper);
  const fpObj = put(scene, { id: fp.id, kind: "footprint", net: 0, footprint: fp.id, fp: -1, items, copper: [], ...(pick ? { pick } : {}), ...(fp.locked ? { locked: true } : {}) });
  fpObj.fp = fpObj.index;
  const old = scene.padsOf.get(fp.id) ?? [];
  const ids: string[] = [];
  let rect = rectEmpty(fpObj.rect) ? EMPTY_RECT() : ([...fpObj.rect] as Rect);
  const inner = scene.copper.filter((l) => l !== "top" && l !== "bottom");
  for (const wp of pads) {
    const netName = scene.doc.padNets.get(wp.id);
    const net = netIdx(scene, netName);
    const shape = padShape(fp, wp);
    const pi: SceneItem[] = [];
    const sides: ("top" | "bottom")[] = wp.pad.type === "smd" ? [wp.layers[0] === "bottom" ? "bottom" : "top"] : wp.pad.type === "th" ? ["top", "bottom"] : [];
    if (shape.length) {
      for (const s of sides) {
        pi.push({ layer: sideId("pads", s), parts: shape, flags: 0, minScale: 0 });
        const mask = padShape(fp, wp, (wp.pad.mask_margin ?? 0) * NM);
        if (mask.length) pi.push({ layer: sideId("mask", s), parts: mask, flags: 0, minScale: 0 });
        if (wp.pad.type === "smd") {
          const paste = padShape(fp, wp, (wp.pad.paste_margin ?? 0) * NM);
          if (paste.length) pi.push({ layer: sideId("paste", s), parts: paste, flags: 0, minScale: 0 });
        }
      }
      if (wp.pad.type === "th") for (const l of inner) pi.push({ layer: cu(l), parts: shape, flags: 0, minScale: 0 });
    }
    const hole = padHole(wp);
    if (hole) pi.push({ layer: "holes", parts: [hole], flags: 0, minScale: 0 });
    const label = shape.length ? padLabel(netName ?? wp.pad.number, shape) : undefined;
    if (label && label.parts.length) pi.push(label);
    const o = put(scene, {
      id: wp.id,
      kind: "pad",
      net,
      ...(netName ? { netName } : {}),
      footprint: fp.id,
      fp: fpObj.index,
      items: pi,
      copper: wp.layers,
      ...(fp.locked ? { locked: true } : {}),
    });
    rect = growRect(rect, o.rect);
    ids.push(wp.id);
    changed.add(wp.id);
  }
  for (const id of old) if (!ids.includes(id)) {
    drop(scene, id);
    changed.add(id);
  }
  scene.padsOf.set(fp.id, ids);
  // the footprint's box covers its pads, so a click on the body between pads finds it
  if (!rectEmpty(rect)) fpObj.rect = rect;
  fpObj.copper = [...new Set(pads.flatMap((p) => p.layers))];
}

function boardOutline(scene: Scene): void {
  const doc = scene.doc;
  const outline = doc.records.get("outline");
  if (!outline || outline.kind !== "outline") {
    drop(scene, "outline");
    return;
  }
  const ring = contourPoints(outline.outline, true);
  const holes: number[][] = [];
  for (const r of doc.records.values()) if (r.kind === "cutout") holes.push(contourPoints(r.outline, true));
  put(scene, {
    id: "outline",
    kind: "outline",
    net: 0,
    fp: -1,
    items: [
      { layer: "board", parts: [{ k: "poly", rings: [ring, ...holes] }], flags: 0, minScale: 0 },
      { layer: "edge", parts: [{ k: "path", pts: ring, w: EDGE_WIDTH, closed: true }], flags: 0, minScale: 0 },
    ],
    copper: [],
    pick: [{ k: "path", pts: ring, w: EDGE_WIDTH, closed: true }],
    ...(outline.locked ? { locked: true } : {}),
  });
}

function trackLabel(net: string, x1: number, y1: number, x2: number, y2: number, w: number): SceneItem | undefined {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const h = w * 0.55;
  if (!(h > 0) || textWidth(net, h) * 1.3 > len) return undefined;
  const a = readable(Math.atan2(y2 - y1, x2 - x1));
  return { layer: "labels:tracks", parts: textParts(net, (x1 + x2) / 2, (y1 + y2) / 2, h, h * 0.13, a), flags: 0, minScale: LABEL_MIN_PX / h };
}

function buildRecord(scene: Scene, r: BoardRecord, changed: Set<string>): void {
  switch (r.kind) {
    case "footprint":
      buildFootprint(scene, r, changed);
      return;
    case "track": {
      const net = netIdx(scene, r.net);
      const w = r.width * NM;
      const flags = (isHand(r) && r.locked ? FLAG.HAND : 0) | (isRouted(r) ? FLAG.AUTO : 0);
      const items: SceneItem[] = [];
      if (r.sweep !== undefined) items.push({ layer: cu(r.layer), parts: [{ k: "path", pts: arcPoints(r.start, r.end, r.sweep), w, closed: false }], flags, minScale: 0 });
      else {
        const [x1, y1, x2, y2] = [r.start.x * NM, r.start.y * NM, r.end.x * NM, r.end.y * NM];
        items.push({ layer: cu(r.layer), parts: [{ k: "seg", x1, y1, x2, y2, w }], flags, minScale: 0 });
        const label = r.net ? trackLabel(r.net, x1, y1, x2, y2, w) : undefined;
        if (label && label.parts.length) items.push(label);
      }
      put(scene, { id: r.id, kind: "track", net, ...(r.net ? { netName: r.net } : {}), fp: -1, items, copper: [r.layer], ...(r.locked ? { locked: true } : {}) });
      return;
    }
    case "via": {
      const net = netIdx(scene, r.net);
      const span = scene.copper.slice(Math.min(scene.copper.indexOf(r.from_layer), scene.copper.indexOf(r.to_layer)), Math.max(scene.copper.indexOf(r.from_layer), scene.copper.indexOf(r.to_layer)) + 1);
      const through = r.from_layer === scene.copper[0] && r.to_layer === scene.copper[scene.copper.length - 1];
      const cx = r.x * NM;
      const cy = r.y * NM;
      const ring: Part = { k: "ring", cx, cy, r: (r.outer_diameter * NM) / 2, ri: 0 };
      const items: SceneItem[] = [
        { layer: "vias", parts: [ring], flags: through ? 0 : FLAG.PARTIAL, minScale: 0 },
        { layer: "holes", parts: [{ k: "ring", cx, cy, r: (r.hole_diameter * NM) / 2, ri: 0 }], flags: 0, minScale: 0 },
      ];
      // mask openings only where the via is stated untented on that side
      const t = r.tented;
      if (t === "none" || t === "bottom") items.push({ layer: sideId("mask", "top"), parts: [ring], flags: 0, minScale: 0 });
      if (t === "none" || t === "top") items.push({ layer: sideId("mask", "bottom"), parts: [ring], flags: 0, minScale: 0 });
      put(scene, { id: r.id, kind: "via", net, ...(r.net ? { netName: r.net } : {}), fp: -1, items, copper: span.length ? span : [r.from_layer, r.to_layer], ...(r.locked ? { locked: true } : {}) });
      return;
    }
    case "zone": {
      const net = netIdx(scene, r.net);
      const ring = contourPoints(r.outline, true);
      const items: SceneItem[] = [];
      const fills = scene.fills.get(r.id) ?? [];
      for (const l of r.layers) {
        for (const f of fills.filter((x) => x.layer === l))
          for (const poly of f.polygons) items.push({ layer: cu(l), parts: [{ k: "poly", rings: poly.map((ringNm) => ringNm.flatMap((p) => [p.x * NM, p.y * NM])) }], flags: FLAG.FILL, minScale: 0 });
        items.push({ layer: cu(l), parts: [{ k: "path", pts: ring, w: 0, closed: true }], flags: FLAG.DASHED, minScale: 0 });
      }
      put(scene, { id: r.id, kind: "zone", net, ...(r.net ? { netName: r.net } : {}), fp: -1, items, copper: [...r.layers], pick: [{ k: "poly", rings: [ring] }], ...(r.locked ? { locked: true } : {}) });
      return;
    }
    case "keepout": {
      const ring = contourPoints(r.outline, true);
      const hatch = hatchLines([ring], KEEPOUT_HATCH);
      const parts: Part[] = [{ k: "path", pts: ring, w: 0.08, closed: true }];
      for (let i = 0; i + 3 < hatch.length; i += 4) parts.push({ k: "seg", x1: hatch[i], y1: hatch[i + 1], x2: hatch[i + 2], y2: hatch[i + 3], w: 0 });
      put(scene, { id: r.id, kind: "keepout", net: 0, fp: -1, items: [{ layer: "keepout", parts, flags: 0, minScale: 0 }], copper: [...r.layers], pick: [{ k: "poly", rings: [ring] }], ...(r.footprint ? { footprint: r.footprint } : {}), ...(r.locked ? { locked: true } : {}) });
      return;
    }
    case "outline":
      boardOutline(scene);
      return;
    case "cutout": {
      const ring = contourPoints(r.outline, true);
      put(scene, { id: r.id, kind: "cutout", net: 0, fp: -1, items: [{ layer: "edge", parts: [{ k: "path", pts: ring, w: EDGE_WIDTH, closed: true }], flags: 0, minScale: 0 }], copper: [], ...(r.locked ? { locked: true } : {}) });
      boardOutline(scene);
      changed.add("outline");
      return;
    }
    case "graphic": {
      const parts = graphicParts(r, ident);
      put(scene, { id: r.id, kind: "graphic", net: 0, fp: -1, items: parts.length ? [{ layer: drawLayerOf(r.layer), parts, flags: 0, minScale: 0 }] : [], copper: [], ...(r.locked ? { locked: true } : {}) });
      return;
    }
    case "text": {
      const parts = textParts(r.text, r.x * NM, r.y * NM, r.height * NM, r.stroke_width !== undefined ? r.stroke_width * NM : undefined, rad(r.rotation ?? 0), r.anchor ?? "center", r.mirrored === true);
      put(scene, { id: r.id, kind: "text", net: 0, fp: -1, items: parts.length ? [{ layer: drawLayerOf(r.layer), parts, flags: 0, minScale: 0 }] : [], copper: [], ...(r.locked ? { locked: true } : {}) });
      return;
    }
    default:
      return;
  }
}

function buildRatsnest(scene: Scene): void {
  if (!scene.ratsnest.length) {
    drop(scene, "ratsnest");
    return;
  }
  const items: SceneItem[] = scene.ratsnest.map((p) => ({
    layer: "ratsnest",
    parts: [{ k: "seg" as const, x1: p.a.x * NM, y1: p.a.y * NM, x2: p.b.x * NM, y2: p.b.y * NM, w: 0 }],
    flags: FLAG.DASHED,
    minScale: 0,
    net: netIdx(scene, p.net),
  }));
  put(scene, { id: "ratsnest", kind: "ratsnest", net: 0, fp: -1, items, copper: [] });
}

function computeRect(scene: Scene): Rect {
  const o = scene.objects.get("outline");
  const board = o?.items.find((i) => i.layer === "board");
  if (board) {
    const r = partsRect(board.parts);
    if (!rectEmpty(r)) return r;
  }
  const r = EMPTY_RECT();
  for (const x of scene.objects.values()) if (!rectEmpty(x.rect)) growRect(r, x.rect);
  return rectEmpty(r) ? [-10, -10, 10, 10] : r;
}

function groupFills(fills: readonly ZoneFill[] | undefined): Map<string, ZoneFill[]> {
  const m = new Map<string, ZoneFill[]>();
  for (const f of fills ?? []) (m.get(f.zone) ?? m.set(f.zone, []).get(f.zone)!).push(f);
  return m;
}

/** Build the scene of a whole document. */
export function buildScene(doc: BoardDocument, options: SceneOptions = {}): Scene {
  const copper = copperLayers(doc);
  const scene: Scene = {
    doc,
    copper,
    layers: drawLayers(copper),
    objects: new Map(),
    byIndex: [],
    nets: [""],
    netIndex: new Map(),
    padsOf: new Map(),
    fills: groupFills(options.fills),
    ratsnest: options.ratsnest ?? [],
    rect: [0, 0, 0, 0],
  };
  nextIndexFor.set(scene, 1);
  // nets in the netlist's order first, so indices are stable across rebuilds of the same board
  for (const n of doc.nets.keys()) netIdx(scene, n);
  const sink = new Set<string>();
  for (const r of doc.records.values()) buildRecord(scene, r, sink);
  buildRatsnest(scene);
  scene.rect = computeRect(scene);
  return scene;
}

/**
 * Bring the scene to `doc`, given the record ids a commit changed (created, changed and removed). Returns the ids
 * of scene objects that changed or went away (pads of a changed footprint included), or `"all"` when the scene was
 * rebuilt (the stackup changed).
 */
export function updateScene(scene: Scene, doc: BoardDocument, changedIds: readonly string[]): Set<string> | "all" {
  const prev = scene.doc;
  scene.doc = doc;
  const stackChanged = changedIds.some((id) => id.startsWith("layer:") || id === "board");
  if (stackChanged) {
    const copper = copperLayers(doc);
    if (copper.join() !== scene.copper.join()) {
      const fresh = buildScene(doc, { fills: [...scene.fills.values()].flat(), ratsnest: scene.ratsnest });
      Object.assign(scene, fresh);
      nextIndexFor.set(scene, nextIndexFor.get(fresh) ?? 1);
      return "all";
    }
  }
  const out = new Set<string>();
  // pad nets moved (the netlist, or a footprint's pads): every footprint's pads take their nets again
  const ids = new Set(changedIds);
  if (doc.padNets !== prev.padNets) for (const r of doc.records.values()) if (r.kind === "footprint") ids.add(r.id);
  for (const id of ids) {
    const r = doc.records.get(id);
    if (!r) {
      if (scene.objects.has(id)) {
        drop(scene, id);
        out.add(id);
      }
      for (const p of scene.padsOf.get(id) ?? []) {
        drop(scene, p);
        out.add(p);
      }
      scene.padsOf.delete(id);
      if (id.startsWith("cutout:")) {
        boardOutline(scene);
        out.add("outline");
      }
      continue;
    }
    buildRecord(scene, r, out);
    out.add(id);
  }
  scene.rect = computeRect(scene);
  return out;
}

/** Replace the zone fills (derived data handed in); returns the zone ids whose drawing changed. */
export function setFills(scene: Scene, fills: readonly ZoneFill[]): Set<string> {
  const next = groupFills(fills);
  const touched = new Set<string>([...scene.fills.keys(), ...next.keys()]);
  scene.fills = next;
  const out = new Set<string>();
  for (const id of touched) {
    const r = scene.doc.records.get(id);
    if (r?.kind === "zone") {
      buildRecord(scene, r, out);
      out.add(id);
    }
  }
  return out;
}

/** Replace the ratsnest (derived data handed in). */
export function setRatsnest(scene: Scene, pairs: readonly RatsnestPair[]): Set<string> {
  scene.ratsnest = pairs;
  buildRatsnest(scene);
  return new Set(["ratsnest"]);
}

/** Counts for tests and the perf script. */
export function sceneCounts(scene: Scene): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of scene.objects.values()) out[o.kind] = (out[o.kind] ?? 0) + 1;
  return out;
}


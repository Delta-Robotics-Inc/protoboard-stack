/**
 * The fill of one zone on one copper layer.
 *
 * 1. Allowed area: the zone outline (approximated from inside) within the board outline (from inside) minus a band
 *    of the edge clearance along every board edge and cutout; minus every copper object of another net grown by
 *    its clearance (pads of every shape, tracks and arcs, vias, copper graphics and text), drills by the hole
 *    clearance, non-plated holes, keep-outs that block pours on the layer, and the fill of higher-priority zones of
 *    another net grown by the zone-to-zone clearance. Same-net pads are left in (solid), cut out by the thermal gap
 *    (thermal), or kept clear like other copper (none); same-net tracks and vias are left in.
 * 2. Minimum width: with `min_width` w, step 1 runs with every clearance grown by w/2 (the inward offset) and the
 *    result is grown back by w/2 (the outward offset), which removes every part narrower than w and rounds corners.
 * 3. Thermal spokes: four per pad on the pad's axes (diagonals for round pads), each kept only where it reaches the
 *    fill and stays clear of everything step 1 keeps clear of; a spoke is never narrower than `min_width`.
 * 4. Islands: a piece that touches no pad, via or track of the zone's net is removed (`always`), or removed when
 *    smaller than `island_min_area` (`below_area`), or kept (`never`). A zone without a net keeps its pieces.
 * 5. Hatch: square openings on a grid anchored at the board origin, cut only where the fill is at least one hatch
 *    width from its own border, so a solid border of the hatch width stays.
 *
 * Every clearance is grown by `margin` (default 10 nm), larger than the grid rounding (at most 0.71 nm per vertex)
 * and the boolean engine's snapping, so a check at the exact clearance passes. Curves are approximated within
 * `maxError`: obstacles from outside, the board and zone outline from inside.
 */
import type { BoardDocument, CopperLayer, ZoneRec } from "@protoboardai/board";
import { clip, pointInPolygon, polygonRings, polygonsArea, ringBox, type Operand, type Polygon, type Ring } from "./clip.js";
import { zoneParty, zoneRegion, type BoardShapes, type CopperItem } from "./collect.js";
import { grow, growRings, shrinkRings } from "./offset.js";
import { FillRules, type Party } from "./rules.js";
import { SegIndex } from "./segindex.js";
import {
  boxesMeet,
  contourPoints,
  distPointEdge,
  distSegEdge,
  distSegShape,
  inflateBox,
  pointInContour,
  regionInsideRing,
  roundRing,
  shapeAnchor,
  shapeBox,
  shapeRings,
  type Box,
  type Shape,
} from "./shapes.js";

export interface FillContext {
  doc: BoardDocument;
  shapes: BoardShapes;
  rules: FillRules;
  maxError: number;
  margin: number;
}

export interface HigherFill {
  zone: ZoneRec;
  polygons: Polygon[];
}

export interface ZoneLayerStats {
  obstacles: number;
  thermalPads: number;
  spokes: number;
  spokesDropped: number;
  islandsRemoved: number;
  ms: number;
}

export interface ZoneLayerFill {
  zone: string;
  layer: CopperLayer;
  polygons: Polygon[];
  /** The fill before island removal and hatching (what a later partial refill patches). */
  pre: Polygon[];
  /** Every record read (ids), the zones of higher priority whose fill it kept clear of, and the area searched. */
  reads: string[];
  deps: string[];
  near: Box;
  stats: ZoneLayerStats;
}

interface Obstacle {
  shape: Shape;
  need: number;
  box: Box;
}

/** How far around a zone's outline anything can matter. */
export function zoneRange(ctx: FillContext, zone: ZoneRec): number {
  const x = ctx.margin + (zone.min_width ? zone.min_width / 2 + ctx.maxError : 0);
  const gap = zone.thermal_gap ?? ctx.rules.defaults.thermal_gap;
  const hatch = zone.fill_mode === "hatch" ? Math.max(zone.hatch_width ?? ctx.rules.defaults.hatch_width, zone.min_width ?? 0) : 0;
  return Math.max(ctx.rules.maxValue, zone.clearance ?? 0, gap) + x + hatch + ctx.maxError + 1000;
}

export function zoneNearBox(ctx: FillContext, zone: ZoneRec): Box {
  return inflateBox(shapeBox(zoneRegion(zone)), zoneRange(ctx, zone));
}

export interface FillLayerOptions {
  /**
   * Fill only inside this box (a partial refill): the box acts as an extra boundary, only objects near it are read,
   * and island removal and hatching are left to the caller.
   */
  window?: Box;
}

export function fillZoneLayer(ctx: FillContext, zone: ZoneRec, layer: CopperLayer, higher: readonly HigherFill[], options: FillLayerOptions = {}): ZoneLayerFill {
  const t0 = performance.now();
  const { shapes, rules, maxError: err, margin: m } = ctx;
  const zp: Party = zoneParty(zone);
  const zclr = zone.clearance ?? 0;
  const minW = zone.min_width ?? 0;
  const r = minW / 2;
  const x = m + (r > 0 ? r + err : 0);
  const gap = zone.thermal_gap ?? rules.defaults.thermal_gap;
  const zr = zoneRegion(zone);
  const near = zoneNearBox(ctx, zone);
  const win = options.window;
  const search = win ? inflateBox(win, zoneRange(ctx, zone)) : near;
  const reads = new Set<string>([zone.id]);
  const deps: string[] = [];
  const sameNet = (net: string | undefined) => zone.net !== undefined && net === zone.net;

  // ---- what the fill keeps clear of, with the distance it keeps (before the margin)
  const obstacles: Obstacle[] = [];
  const thermal: CopperItem[] = [];
  const connectors: CopperItem[] = [];
  const add = (shape: Shape, need: number) => obstacles.push({ shape, need, box: inflateBox(shapeBox(shape), need) });
  for (const it of shapes.items) {
    if (!it.layers.includes(layer) || !boxesMeet(it.box, near) || !boxesMeet(it.box, search)) continue;
    reads.add(it.record);
    if (sameNet(it.net)) {
      if (it.kind !== "pad" || zone.pad_connection === "solid") {
        connectors.push(it);
        continue;
      }
      if (zone.pad_connection === "thermal") {
        thermal.push(it);
        continue;
      }
    }
    const at = shapeAnchor(it.shape);
    add(it.shape, rules.clearance(zp, it.party, layer, at, zclr));
    if (it.hole) add(it.hole, rules.hole(zp, it.party, layer, at, zclr));
  }
  for (const h of shapes.holes) {
    if (!boxesMeet(h.box, near) || !boxesMeet(h.box, search)) continue;
    reads.add(h.record);
    add(h.shape, rules.hole(zp, h.party, layer, shapeAnchor(h.shape), zclr));
  }
  const keepouts = shapes.keepouts.filter((k) => k.layers.includes(layer) && boxesMeet(k.box, near) && boxesMeet(k.box, search));
  for (const k of keepouts) reads.add(k.id);
  const cutouts = shapes.cutouts.filter((c) => boxesMeet(c.box, near) && boxesMeet(c.box, search));
  for (const c of cutouts) reads.add(c.id);
  const edgeNeed = rules.edge(zp, "outline", layer);
  const cutNeed = rules.edge(zp, "cutout", layer);
  if (shapes.outline) reads.add("outline");
  const hi: { fill: HigherFill; need: number }[] = [];
  for (const h of higher) {
    if (sameNet(h.zone.net)) continue;
    if (!h.polygons.length) continue;
    reads.add(h.zone.id);
    deps.push(h.zone.id);
    hi.push({ fill: h, need: rules.clearance(zp, zoneParty(h.zone), layer, undefined, Math.max(zclr, h.zone.clearance ?? 0)) });
  }

  // ---- the allowed area with every clearance grown by `extra`
  const zoneRing = regionInsideRing(zr, err);
  const boardRing = shapes.outline ? regionInsideRing(shapes.outline.shape, err) : undefined;
  const hiRings: Ring[] = hi.flatMap((h) => polygonRings(h.fill.polygons));
  const cutoutRings = cutouts.map((c) => roundRing(contourPoints(c.shape.edges, err, true)));
  const allowed = (extra: number, withThermal: boolean): Polygon[] => {
    const cut: Ring[] = [...cutoutRings];
    for (const k of keepouts) cut.push(...shapeRings(k.shape, extra, err));
    for (const o of obstacles) cut.push(...shapeRings(o.shape, o.need + extra, err));
    if (withThermal) for (const t of thermal) cut.push(...shapeRings(t.shape, gap + extra, err));
    const hiGrow: Ring[] = hi.flatMap((h) => growRings(h.fill.polygons, h.need + extra, err));
    const cutGrow: Ring[] = cutoutRings.flatMap((r) => growRings([{ outer: r, holes: [] }], cutNeed + extra, err));
    const winRing: Ring = win ? [Math.floor(win.minX), Math.floor(win.minY), Math.ceil(win.maxX), Math.floor(win.minY), Math.ceil(win.maxX), Math.ceil(win.maxY), Math.floor(win.minX), Math.ceil(win.maxY)] : zoneRing;
    const ops: Operand[] = [
      // with a minimum width the zone outline shrinks too, so growing back stays inside it
      { rings: shrinkRings(zoneRing, extra - m, err), rule: "positive" },
      // the board shrunk by the edge clearance
      { rings: boardRing ? shrinkRings(boardRing, edgeNeed + extra, err) : [zoneRing], rule: "positive" },
      { rings: cut },
      { rings: hiRings },
      { rings: hiGrow, rule: "positive" },
      { rings: [winRing] },
      { rings: cutGrow, rule: "positive" },
    ];
    return clip(ops, (i) => i[0] && i[1] && !i[2] && !i[3] && !i[4] && i[5] && !i[6]);
  };
  const q = allowed(x, true);
  let fill = r > 0 ? grow(q, r, err) : q;

  // ---- thermal spokes: capsules from the pad center out into the fill, kept only where they reach it and stay clear
  let spokes = 0;
  let spokesDropped = 0;
  const spokeRings: Ring[] = [];
  const connected = new Set<CopperItem>();
  if (thermal.length && fill.length) {
    const spokeW = Math.max(zone.thermal_spoke_width ?? rules.defaults.thermal_spoke_width, minW);
    // the radius tested: the spoke's half width plus the approximation of its round ends, plus the margin
    const sr = spokeW / 2 + err + m;
    let hiIndex: SegIndex | undefined;
    const inFill = (px: number, py: number): boolean => {
      for (const p of fill) {
        const b = ringBox(p.outer);
        if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) continue;
        if (pointInPolygon(p, px, py)) return true;
      }
      return false;
    };
    const clear = (owner: CopperItem, x0: number, y0: number, x1: number, y1: number): boolean => {
      const box: Box = { minX: Math.min(x0, x1) - sr, minY: Math.min(y0, y1) - sr, maxX: Math.max(x0, x1) + sr, maxY: Math.max(y0, y1) + sr };
      if (!pointInContour(zr.edges, x0, y0) || !pointInContour(zr.edges, x1, y1)) return false;
      for (const e of zr.edges) if (distSegEdge(x0, y0, x1, y1, e) < sr) return false;
      if (shapes.outline) {
        if (!pointInContour(shapes.outline.shape.edges, x0, y0) || !pointInContour(shapes.outline.shape.edges, x1, y1)) return false;
        for (const e of shapes.outline.shape.edges) if (distSegEdge(x0, y0, x1, y1, e) < edgeNeed + sr) return false;
      }
      for (const c of cutouts) if (boxesMeet(inflateBox(c.box, cutNeed), box) && distSegShape(x0, y0, x1, y1, c.shape) < cutNeed + sr) return false;
      for (const k of keepouts) if (boxesMeet(k.box, box) && distSegShape(x0, y0, x1, y1, k.shape) < sr) return false;
      for (const o of obstacles) if (boxesMeet(o.box, box) && distSegShape(x0, y0, x1, y1, o.shape) < o.need + sr) return false;
      // another pad's relief: a spoke may not cross it
      for (const t of thermal) if (t !== owner && boxesMeet(inflateBox(t.box, gap), box) && distSegShape(x0, y0, x1, y1, t.shape) < gap + sr) return false;
      if (hi.length) {
        hiIndex ??= new SegIndex(hi.flatMap((h) => h.fill.polygons));
        const need = Math.max(...hi.map((h) => h.need)) + sr;
        let bad = false;
        hiIndex.query(inflateBox(box, need), (si) => {
          const g = hiIndex!.segs;
          if (distSegEdge(x0, y0, x1, y1, { t: "line", x0: g[4 * si], y0: g[4 * si + 1], x1: g[4 * si + 2], y1: g[4 * si + 3] }) < need) {
            bad = true;
            return true;
          }
          return false;
        });
        if (bad) return false;
        for (const h of hi) for (const p of h.fill.polygons) if (pointInPolygon(p, x1, y1) || pointInPolygon(p, x0, y0)) return false;
      }
      return true;
    };
    for (const t of thermal) {
      const pd = t.pad!;
      const base = pd.rotation + (pd.round ? Math.PI / 4 : 0);
      const outline = shapeRings(t.shape, 0, err)[0];
      let kept = 0;
      for (let k = 0; k < 4; k++) {
        const th = base + (k * Math.PI) / 2;
        const dx = Math.cos(th);
        const dy = Math.sin(th);
        let ext = 0;
        for (let i = 0; i < outline.length; i += 2) ext = Math.max(ext, (outline[i] - pd.x) * dx + (outline[i + 1] - pd.y) * dy);
        // the fill starts about `reach` from the center; the spoke runs half its width past that, and its end cap as much again
        const reach = ext + gap + m + err;
        const probe = reach + spokeW / 2;
        if (!inFill(pd.x + dx * probe, pd.y + dy * probe)) {
          spokesDropped++;
          continue;
        }
        const ex = pd.x + dx * probe;
        const ey = pd.y + dy * probe;
        if (!clear(t, pd.x, pd.y, ex, ey)) {
          spokesDropped++;
          continue;
        }
        spokeRings.push(...shapeRings({ t: "capsule", x0: pd.x, y0: pd.y, x1: ex, y1: ey, r: spokeW / 2 }, 0, err));
        kept++;
        spokes++;
      }
      if (kept) connected.add(t);
    }
    if (spokeRings.length) fill = clip([{ rings: polygonRings(fill) }, { rings: spokeRings }], (i) => i[0] || i[1]);
  }

  const pre = fill;
  // ---- islands
  let islandsRemoved = 0;
  if (!win) {
    for (const c of connectors) connected.add(c);
    const r = removeIslands(zone, fill, [...connected]);
    fill = r.kept;
    islandsRemoved = r.removed;
  }

  // ---- hatch
  if (!win && zone.fill_mode === "hatch" && fill.length) {
    const hw = Math.max(zone.hatch_width ?? rules.defaults.hatch_width, minW);
    const hg = zone.hatch_gap ?? rules.defaults.hatch_gap;
    const inner = allowed(x + hw, true);
    const pitch = hw + hg;
    const fb = fill.map((p) => ringBox(p.outer)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    const squares: Ring[] = [];
    for (let i = Math.floor((fb[0] - hw) / pitch); i * pitch <= fb[2]; i++)
      for (let j = Math.floor((fb[1] - hw) / pitch); j * pitch <= fb[3]; j++) {
        const x0 = Math.round(i * pitch + hw / 2);
        const y0 = Math.round(j * pitch + hw / 2);
        const x1 = Math.round(i * pitch + hw / 2 + hg);
        const y1 = Math.round(j * pitch + hw / 2 + hg);
        if (x1 < fb[0] || x0 > fb[2] || y1 < fb[1] || y0 > fb[3]) continue;
        squares.push([x0, y0, x1, y0, x1, y1, x0, y1]);
      }
    if (squares.length && inner.length) fill = clip([{ rings: polygonRings(fill) }, { rings: squares }, { rings: polygonRings(inner) }], (i) => i[0] && !(i[1] && i[2]));
  }

  return {
    zone: zone.id,
    layer,
    polygons: fill,
    pre,
    reads: [...reads].sort(),
    deps: deps.sort(),
    near,
    stats: { obstacles: obstacles.length, thermalPads: thermal.length, spokes, spokesDropped, islandsRemoved, ms: performance.now() - t0 },
  };
}


/** Island removal per the zone's setting: pieces that touch none of connectors go (all, or those below the area). */
export function removeIslands(zone: ZoneRec, fill: readonly Polygon[], connectors: readonly { shape: Shape; box: Box }[]): { kept: Polygon[]; removed: number } {
  if (zone.net === undefined || zone.remove_islands === "never") return { kept: [...fill], removed: 0 };
  const kept: Polygon[] = [];
  let removed = 0;
  for (const p of fill) {
    if (pieceConnected(p, connectors) || (zone.remove_islands === "below_area" && polygonsArea([p]) >= (zone.island_min_area ?? 0))) kept.push(p);
    else removed++;
  }
  return { kept, removed };
}

/** The copper a zone's pieces may connect through: every item of its net on the layer near it (pads of any connection
 * style are tested by geometry: a thermal pad counts only where a spoke reaches it, a pad kept clear never touches). */
export function zoneConnectors(ctx: FillContext, zone: ZoneRec, layer: CopperLayer, box: Box): CopperItem[] {
  if (zone.net === undefined) return [];
  return ctx.shapes.items.filter((it) => it.net === zone.net && it.layers.includes(layer) && boxesMeet(it.box, box) && !(it.kind === "pad" && zone.pad_connection === "none"));
}

/** Whether a fill piece touches any of the given copper (its anchor inside the piece, or the piece's edge on it). */
export function pieceConnected(p: Polygon, items: readonly { shape: Shape; box: Box }[]): boolean {
  const pb = ringBox(p.outer);
  const box: Box = { minX: pb[0], minY: pb[1], maxX: pb[2], maxY: pb[3] };
  for (const it of items) {
    if (!boxesMeet(it.box, box)) continue;
    const a = shapeAnchor(it.shape);
    if (pointInPolygon(p, a.x, a.y)) return true;
    for (const r of [p.outer, ...p.holes]) {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = r[2 * i];
        const y0 = r[2 * i + 1];
        const x1 = r[2 * j];
        const y1 = r[2 * j + 1];
        if (Math.max(x0, x1) < it.box.minX || Math.min(x0, x1) > it.box.maxX || Math.max(y0, y1) < it.box.minY || Math.min(y0, y1) > it.box.maxY) continue;
        if (distSegShape(x0, y0, x1, y1, it.shape) <= 0) return true;
      }
    }
  }
  return false;
}

export { distPointEdge };

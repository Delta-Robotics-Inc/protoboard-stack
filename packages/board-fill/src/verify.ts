/**
 * Proof that a fill is valid, measured with exact distances to the true shapes (arcs as arcs, pads from the
 * unrounded footprint transform), independently of the boolean engine that built the fill:
 *
 * - `clearance`: no copper of another net (and no same-net pad a zone connects `none`) closer than its clearance;
 *   no drill or non-plated hole closer than the hole clearance;
 * - `zone_clearance`: fills of different nets on the same layer keep the zone-to-zone clearance;
 * - `edge_clearance`: the board outline and cutouts at least the edge clearance away, all copper inside the board;
 * - `keepout`: no fill inside a keep-out that blocks pours on its layer;
 * - `outside_zone`: no fill outside its zone outline;
 * - `min_width`: every boundary point of a zone with `min_width` w lies on a disc of diameter w (less the
 *   tolerance) inside the fill: no neck or sliver narrower than w;
 * - `island`: no piece that touches no copper of the zone's net, unless the zone keeps islands.
 *
 * Works on any `protoboard.zone-fill/v1` (computed or imported). Required values come from the same rule
 * resolution the fill engine uses; measured values must be at least the required ones, to within `tolerance`
 * (default 0: exact).
 */
import { copperLayers, type BoardDocument, type BoardSnapshot, type CopperLayer, type DerivedZoneFill, type ZoneRec } from "@protoboardai/board";
import { pointInPolygon, polygonsArea, ringBox, type Polygon } from "./clip.js";
import { collectBoardShapes, zoneParty, zoneRegion, type CopperItem } from "./collect.js";
import { pieceConnected } from "./fill.js";
import { FillRules, type FillRuleOptions, type Party } from "./rules.js";
import { SegIndex } from "./segindex.js";
import { boxesMeet, distPointEdge, distPointSeg, distSegEdge, distSegShape, inflateBox, pointInContour, shapeAnchor, shapeBox, type Box, type ContourEdge, type Shape } from "./shapes.js";
import { DEFAULT_MAX_ERROR } from "./zones.js";

export type FillViolationKind = "clearance" | "zone_clearance" | "edge_clearance" | "keepout" | "outside_zone" | "min_width" | "island";

export interface FillViolation {
  kind: FillViolationKind;
  zone?: string;
  layer: CopperLayer;
  /** The other objects involved (ids), sorted. */
  objects: string[];
  /** Measured distance or width, nm. */
  measured: number;
  /** Required distance or width, nm. */
  required: number;
  location: { x: number; y: number };
}

export interface VerifyOptions {
  rules?: FillRuleOptions;
  /** Allowed shortfall for clearances, nm (default 0). */
  tolerance?: number;
  /** Allowed shortfall for minimum width, nm (default: the curve approximation error plus 2 nm). */
  widthTolerance?: number;
  /** The fill's curve approximation error, nm (default 5000), for the width tolerance. */
  maxError?: number;
  /** Which checks to run (default all). */
  checks?: readonly FillViolationKind[];
}

export interface VerifyResult {
  ok: boolean;
  violations: FillViolation[];
  checked: { entries: number; edges: number; obstacles: number; widthSamples: number };
}

const docOf = (s: BoardSnapshot | BoardDocument): BoardDocument => ("doc" in s && (s as BoardSnapshot).doc ? (s as BoardSnapshot).doc : (s as BoardDocument));

/** Check a fill against the board's rules with exact distances. */
export function verifyFill(source: BoardSnapshot | BoardDocument, fill: DerivedZoneFill, options: VerifyOptions = {}): VerifyResult {
  const doc = docOf(source);
  const shapes = collectBoardShapes(doc);
  const rules = new FillRules(doc, options.rules);
  const tol = options.tolerance ?? 0;
  const widthTol = options.widthTolerance ?? (options.maxError ?? DEFAULT_MAX_ERROR) + 2;
  const want = new Set<FillViolationKind>(options.checks ?? ["clearance", "zone_clearance", "edge_clearance", "keepout", "outside_zone", "min_width", "island"]);
  const stack = copperLayers(doc);
  const violations: FillViolation[] = [];
  const checked = { entries: 0, edges: 0, obstacles: 0, widthSamples: 0 };
  const entries = fill.fills.filter((f) => stack.includes(f.layer));
  const indexes = entries.map((f) => new SegIndex(f.polygons as Polygon[]));

  entries.forEach((f, fi) => {
    checked.entries++;
    const polys = f.polygons as Polygon[];
    if (!polys.length) return;
    const zone = f.zone ? (doc.records.get(f.zone) as ZoneRec | undefined) : undefined;
    const net = zone ? zone.net : f.net;
    const layer = f.layer;
    const zp: Party = zone ? zoneParty(zone) : { kind: "zone", ...(net !== undefined ? { net } : {}) };
    const zclr = zone?.clearance ?? 0;
    const ix = indexes[fi];
    checked.edges += ix.owner.length;
    const sameNet = (n: string | undefined) => net !== undefined && n === net;
    const fb = polys.map((p) => ringBox(p.outer)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    const fillBox: Box = { minX: fb[0], minY: fb[1], maxX: fb[2], maxY: fb[3] };
    const add = (v: FillViolation) => violations.push({ ...v, objects: [...v.objects].sort() });

    /** The smallest distance from the fill to a shape near it, and where; 0 when the shape is inside the fill. */
    const nearest = (s: Shape, need: number): { d: number; x: number; y: number } => {
      const b = inflateBox(shapeBox(s), need);
      let best = { d: Infinity, x: 0, y: 0 };
      const a = shapeAnchor(s);
      if (a.x >= fillBox.minX && a.x <= fillBox.maxX && a.y >= fillBox.minY && a.y <= fillBox.maxY && ix.contains(a.x, a.y)) return { d: -1, x: a.x, y: a.y };
      const g = ix.segs;
      ix.query(b, (si) => {
        const d = distSegShape(g[4 * si], g[4 * si + 1], g[4 * si + 2], g[4 * si + 3], s);
        if (d < best.d) best = { d, x: (g[4 * si] + g[4 * si + 2]) / 2, y: (g[4 * si + 1] + g[4 * si + 3]) / 2 };
      });
      return best;
    };

    // ---- copper and holes of other nets
    if (want.has("clearance")) {
      const check = (id: string, s: Shape, need: number) => {
        if (!boxesMeet(inflateBox(shapeBox(s), need), fillBox)) return;
        checked.obstacles++;
        const r = nearest(s, need);
        if (r.d < need - tol) add({ kind: "clearance", ...(f.zone ? { zone: f.zone } : {}), layer, objects: [id], measured: Math.max(0, Math.round(r.d)), required: need, location: { x: Math.round(r.x), y: Math.round(r.y) } });
      };
      for (const it of shapes.items) {
        if (!it.layers.includes(layer)) continue;
        if (sameNet(it.net) && !(it.kind === "pad" && zone?.pad_connection === "none")) continue;
        const at = shapeAnchor(it.shape);
        check(it.id, it.shape, rules.clearance(zp, it.party, layer, at, zclr));
        if (it.hole && !sameNet(it.net)) check(it.id, it.hole, rules.hole(zp, it.party, layer, at, zclr));
      }
      for (const h of shapes.holes) check(h.id, h.shape, rules.hole(zp, h.party, layer, shapeAnchor(h.shape), zclr));
    }

    // ---- other fills on the layer
    if (want.has("zone_clearance")) {
      entries.forEach((o, oi) => {
        if (oi <= fi || o.layer !== layer || !o.polygons.length) return;
        const oz = o.zone ? (doc.records.get(o.zone) as ZoneRec | undefined) : undefined;
        const onet = oz ? oz.net : o.net;
        if (net !== undefined && onet === net) return;
        const need = rules.clearance(zp, oz ? zoneParty(oz) : { kind: "zone", ...(onet !== undefined ? { net: onet } : {}) }, layer, undefined, Math.max(zclr, oz?.clearance ?? 0));
        const oix = indexes[oi];
        const g = ix.segs;
        const h = oix.segs;
        let best = { d: Infinity, x: 0, y: 0 };
        for (let s = 0; s < ix.owner.length; s++) {
          const x0 = g[4 * s];
          const y0 = g[4 * s + 1];
          const x1 = g[4 * s + 2];
          const y1 = g[4 * s + 3];
          oix.query({ minX: Math.min(x0, x1) - need, minY: Math.min(y0, y1) - need, maxX: Math.max(x0, x1) + need, maxY: Math.max(y0, y1) + need }, (t) => {
            const d = distSegEdge(x0, y0, x1, y1, { t: "line", x0: h[4 * t], y0: h[4 * t + 1], x1: h[4 * t + 2], y1: h[4 * t + 3] });
            if (d < best.d) best = { d, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
          });
        }
        // one inside the other
        const op = o.polygons as Polygon[];
        for (const p of polys) if (op.some((q) => pointInPolygon(q, p.outer[0], p.outer[1]))) best = { d: 0, x: p.outer[0], y: p.outer[1] };
        for (const q of op) if (polys.some((p) => pointInPolygon(p, q.outer[0], q.outer[1]))) best = { d: 0, x: q.outer[0], y: q.outer[1] };
        if (best.d < need - tol) add({ kind: "zone_clearance", ...(f.zone ? { zone: f.zone } : {}), layer, objects: [o.zone ?? `fill:${o.source}`], measured: Math.round(best.d), required: need, location: { x: Math.round(best.x), y: Math.round(best.y) } });
      });
    }

    // ---- board edge and cutouts
    if (want.has("edge_clearance")) {
      const edgeCheck = (id: string, edges: readonly ContourEdge[], need: number, inside: boolean) => {
        let best = { d: Infinity, x: 0, y: 0 };
        const g = ix.segs;
        for (const e of edges) {
          const eb: Box = e.t === "line" ? { minX: Math.min(e.x0, e.x1), minY: Math.min(e.y0, e.y1), maxX: Math.max(e.x0, e.x1), maxY: Math.max(e.y0, e.y1) } : { minX: e.cx - e.r, minY: e.cy - e.r, maxX: e.cx + e.r, maxY: e.cy + e.r };
          ix.query(inflateBox(eb, need), (si) => {
            const d = distSegEdge(g[4 * si], g[4 * si + 1], g[4 * si + 2], g[4 * si + 3], e);
            if (d < best.d) best = { d, x: (g[4 * si] + g[4 * si + 2]) / 2, y: (g[4 * si + 1] + g[4 * si + 3]) / 2 };
          });
        }
        // every ring on the right side of the edge (inside the board, outside a cutout)
        for (const p of polys) {
          if (pointInContour(edges, p.outer[0], p.outer[1]) !== inside) best = { d: -1, x: p.outer[0], y: p.outer[1] };
        }
        if (!inside) {
          const e0 = edges[0];
          if (polys.some((p) => pointInPolygon(p, e0.x0, e0.y0))) best = { d: -1, x: e0.x0, y: e0.y0 };
        }
        if (best.d < need - tol) add({ kind: "edge_clearance", ...(f.zone ? { zone: f.zone } : {}), layer, objects: [id], measured: Math.max(0, Math.round(best.d)), required: need, location: { x: Math.round(best.x), y: Math.round(best.y) } });
      };
      if (shapes.outline) edgeCheck("outline", shapes.outline.shape.edges, rules.edge(zp, "outline", layer), true);
      for (const c of shapes.cutouts) if (boxesMeet(inflateBox(c.box, rules.maxValue), fillBox)) edgeCheck(c.id, c.shape.edges, rules.edge(zp, "cutout", layer), false);
    }

    // ---- keep-outs
    if (want.has("keepout")) {
      for (const k of shapes.keepouts) {
        if (!k.layers.includes(layer) || !boxesMeet(k.box, fillBox)) continue;
        const r = nearest(k.shape, 0);
        const inside = polys.some((p) => pointInContour(k.shape.edges, p.outer[0], p.outer[1]));
        if (r.d <= 0 || inside) add({ kind: "keepout", ...(f.zone ? { zone: f.zone } : {}), layer, objects: [k.id], measured: Math.max(0, Math.round(r.d)), required: 0, location: { x: Math.round(r.x), y: Math.round(r.y) } });
      }
    }

    if (!zone) return;
    const zr = zoneRegion(zone);

    // ---- inside the zone outline (1 nm for grid rounding)
    if (want.has("outside_zone")) {
      for (const p of polys)
        for (const ring of [p.outer, ...p.holes])
          for (let i = 0; i < ring.length; i += 2) {
            const x = ring[i];
            const y = ring[i + 1];
            if (pointInContour(zr.edges, x, y)) continue;
            let d = Infinity;
            for (const e of zr.edges) d = Math.min(d, distPointEdge(x, y, e));
            if (d > 1 + tol) {
              add({ kind: "outside_zone", zone: zone.id, layer, objects: [], measured: Math.round(d), required: 0, location: { x, y } });
              i = ring.length;
            }
          }
    }

    // ---- minimum width
    if (want.has("min_width") && zone.min_width) {
      const w = zone.min_width;
      const rho = w / 2;
      polys.forEach((p) => {
        const local = new SegIndex([p]);
        const g = local.segs;
        const clearance = (cx: number, cy: number, limit: number, exactValue: boolean): number => {
          let d = Infinity;
          local.query({ minX: cx - limit, minY: cy - limit, maxX: cx + limit, maxY: cy + limit }, (si) => {
            d = Math.min(d, distPointSeg(cx, cy, g[4 * si], g[4 * si + 1], g[4 * si + 2], g[4 * si + 3]));
            return !exactValue && d < limit - widthTol;
          });
          return d;
        };
        const pass = rho - widthTol;
        /** The clearance of the disc of radius rho touching (sx, sy) from direction (nx, ny); -1 when its center is not in copper. */
        const probe = (sx: number, sy: number, nx: number, ny: number, exactValue: boolean, dist = rho): number => {
          const cx = sx + nx * dist;
          const cy = sy + ny * dist;
          if (!local.contains(cx, cy)) return -1;
          return clearance(cx, cy, rho, exactValue);
        };
        const fits = (sx: number, sy: number, dirs: [number, number, number][]): number => {
          let best = -1;
          for (const [nx, ny, dist] of dirs) {
            const d = probe(sx, sy, nx, ny, false, dist);
            if (d >= pass) return d;
          }
          // a point where two discs meet (a cusp): search every direction, then refine around the best
          let bestA = 0;
          const K = 48;
          for (let k = 0; k < K; k++) {
            const a = (k * 2 * Math.PI) / K;
            const d = probe(sx, sy, Math.cos(a), Math.sin(a), true);
            if (d >= pass) return d;
            if (d > best) {
              best = d;
              bestA = a;
            }
          }
          let lo = bestA - (2 * Math.PI) / K;
          let hi = bestA + (2 * Math.PI) / K;
          for (let it = 0; it < 24; it++) {
            const m1 = lo + (hi - lo) / 3;
            const m2 = hi - (hi - lo) / 3;
            const d1 = probe(sx, sy, Math.cos(m1), Math.sin(m1), true);
            const d2 = probe(sx, sy, Math.cos(m2), Math.sin(m2), true);
            best = Math.max(best, d1, d2);
            if (best >= pass) return best;
            if (d1 < d2) lo = m1;
            else hi = m2;
          }
          return best;
        };
        for (const ring of [p.outer, ...p.holes]) {
          const n = ring.length >> 1;
          let reported = false;
          for (let i = 0; i < n && !reported; i++) {
            const pi = (i + n - 1) % n;
            const qi = (i + 1) % n;
            const vx = ring[2 * i];
            const vy = ring[2 * i + 1];
            const inward = (ax: number, ay: number, bx: number, by: number): [number, number] => {
              const L = Math.hypot(bx - ax, by - ay) || 1;
              return [-(by - ay) / L, (bx - ax) / L];
            };
            const n1 = inward(ring[2 * pi], ring[2 * pi + 1], vx, vy);
            const n2 = inward(vx, vy, ring[2 * qi], ring[2 * qi + 1]);
            const bl = Math.hypot(n1[0] + n2[0], n1[1] + n2[1]);
            const bis: [number, number] = bl > 1e-9 ? [(n1[0] + n2[0]) / bl, (n1[1] + n2[1]) / bl] : n2;
            checked.widthSamples++;
            // at a corner the copper turns around (convex), the widest disc sits in the wedge: its center is
            // rho / sin(half the corner angle) along the bisector; a sharp corner of a wide area passes, a nub does not
            const turn = (vx - ring[2 * pi]) * (ring[2 * qi + 1] - vy) - (vy - ring[2 * pi + 1]) * (ring[2 * qi] - vx);
            const cosT = n1[0] * n2[0] + n1[1] * n2[1];
            const half = Math.sqrt(Math.max(1e-12, (1 + cosT) / 2)); // sin of half the interior angle
            const wedge = turn > 0 ? Math.min(rho / half, 8 * rho) : rho;
            let d = fits(vx, vy, [[bis[0], bis[1], wedge], [n1[0], n1[1], rho], [n2[0], n2[1], rho]]);
            let at = { x: vx, y: vy };
            if (d >= rho - widthTol) {
              // along the edge to the next vertex, every half width
              const ex = ring[2 * qi];
              const ey = ring[2 * qi + 1];
              const L = Math.hypot(ex - vx, ey - vy);
              const steps = L > w / 2 ? Math.floor(L / (w / 2)) : 0;
              for (let s = 1; s <= steps && d >= rho - widthTol; s++) {
                const t = s / (steps + 1);
                checked.widthSamples++;
                at = { x: vx + t * (ex - vx), y: vy + t * (ey - vy) };
                d = fits(at.x, at.y, [[n2[0], n2[1], rho]]);
              }
            }
            if (d < rho - widthTol) {
              reported = true;
              add({ kind: "min_width", zone: zone.id, layer, objects: [], measured: Math.round(2 * d), required: w, location: { x: Math.round(at.x), y: Math.round(at.y) } });
            }
          }
        }
      });
    }

    // ---- islands
    if (want.has("island") && zone.net !== undefined && zone.remove_islands !== "never") {
      const conns: CopperItem[] = shapes.items.filter((it) => it.layers.includes(layer) && it.net === zone.net && !(it.kind === "pad" && zone.pad_connection === "none"));
      for (const p of polys) {
        if (pieceConnected(p, conns)) continue;
        if (zone.remove_islands === "below_area" && polygonsArea([p]) >= (zone.island_min_area ?? 0)) continue;
        add({ kind: "island", zone: zone.id, layer, objects: [], measured: Math.round(polygonsArea([p]) / 1e6), required: 0, location: { x: p.outer[0], y: p.outer[1] } });
      }
    }
  });
  return { ok: violations.length === 0, violations, checked };
}

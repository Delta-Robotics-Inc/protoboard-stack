/**
 * Copper geometry for editing (Phase 2 contract, sections 2.1 and 7): every piece of copper as a simple primitive
 * (a disc, a stroked polyline, or a filled polygon grown by a radius), exact distances between them, and a per-layer
 * grid index. The operations use it to refuse or detach shorts; the interactive kernel uses it for clearance.
 *
 * Distances are in nanometers as floating point. A gap below zero means the copper overlaps; zero means it touches.
 * Arcs are flattened to chords whose sagitta stays under 1 um (the chord lies inside the arc, so a flattened arc is
 * never farther than 1 um from the true one).
 */
import { copperLayers, footprintKey, padKeys, padId, type BoardDocument } from "./document.js";
import { arcCenter, boxesMeet, footprintToWorld, inflate, padWorldSide, rotatePoint, viaLayers, type Box } from "./geometry.js";
import type { BoardRecord, CopperLayer, FootprintRec, Pad, TrackRec, Vertex } from "./schema.js";

/** A disc (one point), a stroked open polyline (two or more points), or a filled polygon (closed, three or more), grown by `r`. */
export interface Prim {
  /** Flat x0, y0, x1, y1, ... */
  pts: number[];
  r: number;
  closed: boolean;
}

export type CopperKind = "pad" | "track" | "via" | "hole";

/** One piece of copper (or a drilled hole) on one layer. */
export interface CopperPiece {
  /** The record id, or a pad id (`pad:<footprint key>:<pad key>`). */
  id: string;
  kind: CopperKind;
  /** The record that owns it (a pad's footprint). */
  owner: string;
  net?: string;
  layer: CopperLayer;
  prim: Prim;
  box: Box;
}

export const disc = (x: number, y: number, r: number): Prim => ({ pts: [x, y], r, closed: false });
export const segmentPrim = (ax: number, ay: number, bx: number, by: number, r: number): Prim => ({ pts: [ax, ay, bx, by], r, closed: false });

export function primBox(p: Prim): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i],
      y = p.pts[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: Math.floor(minX - p.r), minY: Math.floor(minY - p.r), maxX: Math.ceil(maxX + p.r), maxY: Math.ceil(maxY + p.r) };
}

// ---------------------------------------------------------------- distances

/** Distance from a point to a segment. */
export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px,
    qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Distance between two segments (0 when they cross or touch). */
export function segSegDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const o1 = orient(ax, ay, bx, by, cx, cy),
    o2 = orient(ax, ay, bx, by, dx, dy),
    o3 = orient(cx, cy, dx, dy, ax, ay),
    o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
  return Math.min(pointSegDist(ax, ay, cx, cy, dx, dy), pointSegDist(bx, by, cx, cy, dx, dy), pointSegDist(cx, cy, ax, ay, bx, by), pointSegDist(dx, dy, ax, ay, bx, by));
}

/** Whether a point lies inside a closed polygon (even-odd). */
export function pointInPolygon(px: number, py: number, pts: readonly number[]): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i],
      yi = pts[2 * i + 1],
      xj = pts[2 * j],
      yj = pts[2 * j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The distance between the cores (no radius) of two primitives: 0 when they meet or one holds the other. */
function coreDist(a: Prim, b: Prim): number {
  const na = a.pts.length / 2,
    nb = b.pts.length / 2;
  if (a.closed && na >= 3 && pointInPolygon(b.pts[0], b.pts[1], a.pts)) return 0;
  if (b.closed && nb >= 3 && pointInPolygon(a.pts[0], a.pts[1], b.pts)) return 0;
  const ea = na === 1 ? 1 : a.closed ? na : na - 1;
  const eb = nb === 1 ? 1 : b.closed ? nb : nb - 1;
  let best = Infinity;
  for (let i = 0; i < ea; i++) {
    const i2 = na === 1 ? 0 : (i + 1) % na;
    const ax = a.pts[2 * i],
      ay = a.pts[2 * i + 1],
      bx = a.pts[2 * i2],
      by = a.pts[2 * i2 + 1];
    for (let j = 0; j < eb; j++) {
      const j2 = nb === 1 ? 0 : (j + 1) % nb;
      const d = segSegDist(ax, ay, bx, by, b.pts[2 * j], b.pts[2 * j + 1], b.pts[2 * j2], b.pts[2 * j2 + 1]);
      if (d < best) {
        best = d;
        if (best <= 0) return 0;
      }
    }
  }
  return best;
}

/** The gap between two primitives' edges: negative when they overlap, 0 when they touch. */
export function primGap(a: Prim, b: Prim): number {
  return coreDist(a, b) - a.r - b.r;
}

/** The gap from a point to a primitive's edge (negative inside). */
export function pointGap(x: number, y: number, p: Prim): number {
  return coreDist(disc(x, y, 0), p) - p.r;
}

// ---------------------------------------------------------------- copper of records

/** Flatten an arc from `a` to `b` with a signed sweep into chord points (excluding `a`, including `b`). */
export function arcPoints(a: { x: number; y: number }, b: { x: number; y: number }, sweep: number, maxSagitta = 1000): { x: number; y: number }[] {
  const c = arcCenter(a, b, sweep);
  if (c.r === 0) return [b];
  const total = (sweep / 1000) * (Math.PI / 180);
  // chord angle whose sagitta r (1 - cos(t/2)) stays under maxSagitta
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maxSagitta / c.r)));
  const n = Math.max(1, Math.min(720, Math.ceil(Math.abs(total) / Math.max(step, 1e-6))));
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < n; i++) {
    const t = a0 + (total * i) / n;
    out.push({ x: c.x + c.r * Math.cos(t), y: c.y + c.r * Math.sin(t) });
  }
  out.push(b);
  return out;
}

export function trackPrim(t: Pick<TrackRec, "start" | "end" | "width" | "sweep">): Prim {
  if (t.sweep === undefined) return segmentPrim(t.start.x, t.start.y, t.end.x, t.end.y, t.width / 2);
  const pts = [t.start.x, t.start.y];
  for (const p of arcPoints(t.start, t.end, t.sweep)) pts.push(p.x, p.y);
  return { pts, r: t.width / 2, closed: false };
}

/** A contour's points with arcs flattened. */
export function contourPoints(vs: readonly Vertex[], closed = true): number[] {
  const out: number[] = [];
  vs.forEach((v, i) => {
    out.push(v.x, v.y);
    const next = vs[i + 1] ?? (closed ? vs[0] : undefined);
    if (v.sweep !== undefined && next) {
      const pts = arcPoints(v, next, v.sweep);
      pts.pop();
      for (const p of pts) out.push(p.x, p.y);
    }
  });
  return out;
}

/** A pad's copper shape in the world (its outer copper for a drilled pad). */
export function padPrim(fp: Pick<FootprintRec, "x" | "y" | "rotation" | "side">, pad: Pad): Prim {
  const map = (lx: number, ly: number) => {
    const r = rotatePoint({ x: lx, y: ly }, pad.rotation ?? 0);
    return footprintToWorld(fp, { x: pad.x + r.x, y: pad.y + r.y });
  };
  const rectPrim = (w: number, h: number, cr = 0): Prim => {
    const hw = Math.max(0, w / 2 - cr),
      hh = Math.max(0, h / 2 - cr);
    const pts: number[] = [];
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p = map(sx * hw, sy * hh);
      pts.push(p.x, p.y);
    }
    return { pts, r: cr, closed: true };
  };
  const capsule = (w: number, h: number): Prim => {
    if (Math.abs(w - h) < 1) {
      const c = map(0, 0);
      return disc(c.x, c.y, w / 2);
    }
    const r = Math.min(w, h) / 2;
    const a = w > h ? map(-(w / 2 - r), 0) : map(0, -(h / 2 - r));
    const b = w > h ? map(w / 2 - r, 0) : map(0, h / 2 - r);
    return segmentPrim(a.x, a.y, b.x, b.y, r);
  };
  if (pad.type === "np") {
    const c = map(0, 0);
    return disc(c.x, c.y, (pad.hole_diameter ?? 0) / 2);
  }
  if (pad.type === "th") {
    if (pad.shape === "circle") {
      const c = map(0, 0);
      return disc(c.x, c.y, (pad.outer_diameter ?? 0) / 2);
    }
    const w = pad.outer_width ?? 0,
      h = pad.outer_height ?? 0;
    if (pad.shape === "oval") return capsule(w, h);
    if (pad.shape === "roundrect") return rectPrim(w, h, Math.min(pad.corner_radius ?? 0, Math.min(w, h) / 2));
    return rectPrim(w, h);
  }
  switch (pad.shape) {
    case "circle": {
      const c = map(0, 0);
      return disc(c.x, c.y, pad.radius ?? 0);
    }
    case "oval":
      return capsule(pad.width ?? 0, pad.height ?? 0);
    case "roundrect": {
      const w = pad.width ?? 0,
        h = pad.height ?? 0;
      return rectPrim(w, h, Math.min(pad.corner_radius ?? 0, Math.min(w, h) / 2));
    }
    case "polygon": {
      const local = contourPoints(pad.points ?? []);
      const pts: number[] = [];
      for (let i = 0; i < local.length; i += 2) {
        const p = map(local[i], local[i + 1]);
        pts.push(p.x, p.y);
      }
      return { pts, r: 0, closed: true };
    }
    default:
      return rectPrim(pad.width ?? 0, pad.height ?? 0);
  }
}

/** The hole of a drilled pad or via, as a primitive (for hole clearances and the router). */
export function padHolePrim(fp: Pick<FootprintRec, "x" | "y" | "rotation" | "side">, pad: Pad): Prim | undefined {
  if (pad.type === "smd") return undefined;
  const c = footprintToWorld(fp, { x: pad.x, y: pad.y });
  if (pad.hole_diameter !== undefined) return disc(c.x, c.y, pad.hole_diameter / 2);
  const w = pad.hole_width ?? 0,
    h = pad.hole_height ?? 0;
  const r = Math.min(w, h) / 2;
  const along = rotatePoint(w > h ? { x: w / 2 - r, y: 0 } : { x: 0, y: h / 2 - r }, pad.rotation ?? 0);
  const a = footprintToWorld(fp, { x: pad.x - along.x, y: pad.y - along.y });
  const b = footprintToWorld(fp, { x: pad.x + along.x, y: pad.y + along.y });
  return segmentPrim(a.x, a.y, b.x, b.y, r);
}

/** The copper pieces of one record (every pad of a footprint, a track, a via on each layer it spans). */
export function copperOf(doc: BoardDocument, rec: BoardRecord, stack: readonly CopperLayer[] = copperLayers(doc)): CopperPiece[] {
  const out: CopperPiece[] = [];
  if (rec.kind === "track") {
    if (!stack.includes(rec.layer)) return out;
    const prim = trackPrim(rec);
    out.push({ id: rec.id, kind: "track", owner: rec.id, ...(rec.net ? { net: rec.net } : {}), layer: rec.layer, prim, box: primBox(prim) });
  } else if (rec.kind === "via") {
    const prim = disc(rec.x, rec.y, rec.outer_diameter / 2);
    const box = primBox(prim);
    for (const l of viaLayers(doc, rec.from_layer, rec.to_layer)) out.push({ id: rec.id, kind: "via", owner: rec.id, ...(rec.net ? { net: rec.net } : {}), layer: l, prim, box });
  } else if (rec.kind === "footprint") {
    const keys = padKeys(rec);
    const fk = footprintKey(rec);
    rec.pads.forEach((pad, i) => {
      const id = padId(fk, keys[i]);
      const net = doc.padNets.get(id);
      const prim = padPrim(rec, pad);
      const box = primBox(prim);
      const kind: CopperKind = pad.type === "np" ? "hole" : "pad";
      const layers: CopperLayer[] = pad.type === "smd" ? [padWorldSide(rec, pad)] : [...stack];
      for (const l of layers) if (stack.includes(l)) out.push({ id, kind, owner: rec.id, ...(net && kind === "pad" ? { net } : {}), layer: l, prim, box });
    });
  }
  return out;
}

/** Whether two pieces are on different nets for shorts and clearance (unassigned copper conflicts with everything else). */
export const otherNet = (a: { net?: string }, b: { net?: string }): boolean => !(a.net !== undefined && a.net === b.net);

// ---------------------------------------------------------------- index

/** DEFAULT: 1 mm cells for the copper grid. */
export const COPPER_CELL_NM = 1_000_000;

/**
 * A per-layer grid of copper pieces. Built from a document; `replace` updates the pieces of changed records, so a
 * session keeps one index across many candidate moves.
 */
export class CopperIndex {
  private readonly layers = new Map<string, Map<number, CopperPiece[]>>();
  private readonly byOwner = new Map<string, CopperPiece[]>();
  private readonly big: CopperPiece[] = [];
  readonly stack: CopperLayer[];

  private constructor(
    private doc: BoardDocument,
    private readonly cell: number,
  ) {
    this.stack = copperLayers(doc);
  }

  static build(doc: BoardDocument, cell = COPPER_CELL_NM): CopperIndex {
    const ix = new CopperIndex(doc, cell);
    for (const rec of doc.records.values()) if (rec.kind === "track" || rec.kind === "via" || rec.kind === "footprint") ix.add(rec);
    return ix;
  }

  private key(x: number, y: number): number {
    return x * 100_003 + y;
  }

  private add(rec: BoardRecord): void {
    const pieces = copperOf(this.doc, rec, this.stack);
    if (!pieces.length) return;
    this.byOwner.set(rec.id, pieces);
    for (const p of pieces) {
      const x0 = Math.floor(p.box.minX / this.cell),
        y0 = Math.floor(p.box.minY / this.cell),
        x1 = Math.floor(p.box.maxX / this.cell),
        y1 = Math.floor(p.box.maxY / this.cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) {
        this.big.push(p);
        continue;
      }
      let grid = this.layers.get(p.layer);
      if (!grid) this.layers.set(p.layer, (grid = new Map()));
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = this.key(x, y);
          const l = grid.get(k);
          if (l) l.push(p);
          else grid.set(k, [p]);
        }
    }
  }

  private drop(owner: string): void {
    const pieces = this.byOwner.get(owner);
    if (!pieces) return;
    this.byOwner.delete(owner);
    for (const p of pieces) {
      const bi = this.big.indexOf(p);
      if (bi >= 0) {
        this.big.splice(bi, 1);
        continue;
      }
      const grid = this.layers.get(p.layer);
      if (!grid) continue;
      const x0 = Math.floor(p.box.minX / this.cell),
        y0 = Math.floor(p.box.minY / this.cell),
        x1 = Math.floor(p.box.maxX / this.cell),
        y1 = Math.floor(p.box.maxY / this.cell);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = this.key(x, y);
          const l = grid.get(k);
          if (!l) continue;
          const i = l.indexOf(p);
          if (i >= 0) l.splice(i, 1);
          if (!l.length) grid.delete(k);
        }
    }
  }

  /** Bring the index to `next`, given the record ids that changed. */
  update(next: BoardDocument, changed: Iterable<string>): void {
    if (next.padNets !== this.doc.padNets) {
      // pad nets may have moved anywhere: re-add every footprint
      this.doc = next;
      for (const r of next.records.values()) if (r.kind === "footprint") changedOwner(this, r.id);
    }
    this.doc = next;
    for (const id of changed) changedOwner(this, id);
    function changedOwner(ix: CopperIndex, id: string) {
      ix.drop(id);
      const rec = next.records.get(id);
      if (rec && (rec.kind === "track" || rec.kind === "via" || rec.kind === "footprint")) ix.add(rec);
    }
  }

  /** Pieces of a record. */
  of(owner: string): readonly CopperPiece[] {
    return this.byOwner.get(owner) ?? [];
  }

  /** Pieces on `layer` whose boxes meet `box`, each once. */
  near(box: Box, layer: string, visit: (p: CopperPiece) => void | boolean): void {
    const grid = this.layers.get(layer);
    const seen = new Set<CopperPiece>();
    const x0 = Math.floor(box.minX / this.cell),
      y0 = Math.floor(box.minY / this.cell),
      x1 = Math.floor(box.maxX / this.cell),
      y1 = Math.floor(box.maxY / this.cell);
    if (grid)
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const l = grid.get(this.key(x, y));
          if (!l) continue;
          for (const p of l) {
            if (seen.has(p)) continue;
            seen.add(p);
            if (boxesMeet(p.box, box) && visit(p) === false) return;
          }
        }
    for (const p of this.big) if (p.layer === layer && boxesMeet(p.box, box) && visit(p) === false) return;
  }

  /** The other-net piece nearest to `prim` on `layer` within `reach` of its box (the least gap), or undefined. */
  nearestOther(prim: Prim, layer: string, net: string | undefined, reach: number, skip?: (p: CopperPiece) => boolean): { piece: CopperPiece; gap: number } | undefined {
    let best: { piece: CopperPiece; gap: number } | undefined;
    this.near(inflate(primBox(prim), reach), layer, (p) => {
      if (!otherNet({ net }, p) || skip?.(p)) return;
      const g = primGap(prim, p.prim);
      if (g <= reach && (!best || g < best.gap)) best = { piece: p, gap: g };
    });
    return best;
  }
}

/**
 * Free space on a board side for silkscreen: what a new silk element must keep clear of (pads, vias, holes, other
 * silk, other parts' courtyards, the board edge), measured with `@protoboardai/board-checks`' exact shapes and model.
 */
import { boxesMeet, recordsOfKind, type BoardDocument, type Box, type Side } from "@protoboardai/board";
import { textWidth } from "@protoboardai/board-scene";
import { buildModel, GridIndex, pointInPoly, polyCore, rectShape, segShape, shape, shapeGap, type CheckModel, type Shape } from "@protoboardai/board-checks";
import { type Ring } from "./geom.js";

export interface Obstacle {
  id: string;
  kind: "pad" | "via" | "hole" | "silk" | "courtyard";
  side: Side | "both";
  shape: Shape;
  footprint?: string;
}

export interface Clearances {
  /** From pads, vias and holes (nm). */
  pad: number;
  /** From other silk (nm); undefined: silk is not an obstacle. */
  silk?: number;
  /** From other parts' courtyards (nm); undefined: courtyards are not obstacles. */
  courtyard?: number;
  /** From the board edge (nm). */
  edge: number;
}

export interface Ignore {
  /** Footprints whose courtyard and own silk do not block (the part a designator labels). */
  footprints?: ReadonlySet<string>;
  /** Object ids that do not block (silk the tool is replacing). */
  ids?: ReadonlySet<string>;
}

const CELL = 1_000_000;

export class BoardSpace {
  readonly model: CheckModel;
  private readonly items: Obstacle[] = [];
  private readonly grid = new GridIndex(CELL, 4096);
  private readonly edges: Shape[];
  private readonly region?: ReturnType<typeof polyCore>;

  constructor(
    readonly doc: BoardDocument,
    o: { ignoreSilk?: (id: string) => boolean; keepFootprintTexts?: boolean } = {},
  ) {
    const m = buildModel(doc);
    this.model = m;
    for (const [id, p] of m.pads) {
      const side: Side | "both" = p.drilled ? "both" : p.layers.includes("bottom") ? "bottom" : "top";
      if (p.layers.length || p.drilled) this.add({ id, kind: "pad", side, shape: p.shape, footprint: p.footprint });
    }
    for (const c of m.copper) if (c.kind === "via" && !this.items.some((i) => i.id === c.id)) this.add({ id: c.id, kind: "via", side: "both", shape: c.shape });
    for (const h of m.holes) if (h.kind === "pad" && !h.plated) this.add({ id: h.id, kind: "hole", side: "both", shape: h.shape });
    for (const s of m.silk) {
      if (o.ignoreSilk?.(s.id)) continue;
      // footprints' own texts leave the silkscreen when designators run (they are replaced by board text)
      if (s.footprint && s.textBox && !o.keepFootprintTexts) continue;
      // board text: measured below in the stroke font the style draws with (wider than the checks' estimate)
      if (s.textBox && !s.footprint && doc.records.get(s.id)?.kind === "text") continue;
      const side: Side = s.layer === "top_silkscreen" ? "top" : "bottom";
      for (const sh of s.shapes) this.add({ id: s.id, kind: "silk", side, shape: sh, ...(s.footprint ? { footprint: s.footprint } : {}) });
    }
    for (const t of recordsOfKind(doc, "text")) {
      if (t.layer !== "top_silkscreen" && t.layer !== "bottom_silkscreen") continue;
      if (o.ignoreSilk?.(t.id)) continue;
      const w = textWidth(t.text, t.height) + (t.stroke_width ?? 0);
      const h = t.height + (t.stroke_width ?? 0);
      const a = ((t.rotation ?? 0) / 1000) * (Math.PI / 180);
      const sgn = t.mirrored ? -1 : 1;
      const off = t.anchor === "left" ? (w - (t.stroke_width ?? 0)) / 2 : t.anchor === "right" ? -(w - (t.stroke_width ?? 0)) / 2 : 0;
      const cx = t.x + Math.cos(a) * off * sgn;
      const cy = t.y + Math.sin(a) * off * sgn;
      this.add({ id: t.id, kind: "silk", side: t.layer === "top_silkscreen" ? "top" : "bottom", shape: rectShape(cx, cy, w, h, a, 0) });
    }
    for (const c of m.courtyards) this.add({ id: c.footprint, kind: "courtyard", side: c.side, shape: shape(c.poly, 0), footprint: c.footprint });
    this.edges = m.edges.map((e) => e.shape);
    if (m.region) this.region = m.region;
  }

  /** Add an obstacle (silk a tool just placed, so its next placements keep clear of it). */
  add(o: Obstacle): void {
    this.items.push(o);
    this.grid.insert(this.items.length - 1, o.shape.box);
  }

  /** Add silk rings or strokes a tool placed. */
  addSilk(id: string, side: Side, shapes: Shape[]): void {
    for (const s of shapes) this.add({ id, kind: "silk", side, shape: s });
  }

  /** The first obstacle a shape on `side` comes too close to, or undefined when it is clear. */
  blocker(s: Shape, side: Side, c: Clearances, ignore: Ignore = {}): string | undefined {
    const reach = Math.max(c.pad, c.silk ?? 0, c.courtyard ?? 0);
    const q: Box = { minX: s.box.minX - reach, minY: s.box.minY - reach, maxX: s.box.maxX + reach, maxY: s.box.maxY + reach };
    let hit: string | undefined;
    this.grid.query(q, (i) => {
      if (hit) return;
      const o = this.items[i];
      if (o.side !== "both" && o.side !== side) return;
      if (ignore.ids?.has(o.id)) return;
      let clr: number | undefined;
      if (o.kind === "pad" || o.kind === "via" || o.kind === "hole") clr = c.pad;
      else if (o.kind === "silk") {
        if (o.footprint && ignore.footprints?.has(o.footprint)) return;
        clr = c.silk;
      } else if (o.kind === "courtyard") {
        if (o.footprint && ignore.footprints?.has(o.footprint)) return;
        clr = c.courtyard;
      }
      if (clr === undefined) return;
      if (!boxesMeet(q, o.shape.box)) return;
      if (shapeGap(s, o.shape, clr) < clr) hit = o.id;
    });
    if (hit) return hit;
    if (!this.insideBoard(s, c.edge)) return "edge";
    return undefined;
  }

  /** Whether a shape lies inside the board with at least `clearance` to every edge. */
  insideBoard(s: Shape, clearance: number): boolean {
    if (this.region) {
      const cx = (s.box.minX + s.box.maxX) / 2;
      const cy = (s.box.minY + s.box.maxY) / 2;
      if (!pointInPoly(this.region, cx, cy)) return false;
    }
    for (const e of this.edges) if (shapeGap(s, e, clearance) < clearance) return false;
    return true;
  }

  /** Obstacles of one kind on a side near a box. */
  near(box: Box, side: Side, kinds: Obstacle["kind"][]): Obstacle[] {
    const out: Obstacle[] = [];
    this.grid.query(box, (i) => {
      const o = this.items[i];
      if ((o.side === "both" || o.side === side) && kinds.includes(o.kind) && boxesMeet(box, o.shape.box)) out.push(o);
    });
    return out;
  }
}

/** A shape for a filled ring (a tag, a mark). */
export const ringShape = (r: Ring, grow = 0): Shape => shape(polyCore([r]), grow);
/** A shape for a stroke. */
export const strokeShape = (ax: number, ay: number, bx: number, by: number, width: number): Shape => segShape(ax, ay, bx, by, width / 2);
/** A shape for a rotated box (radians). */
export const boxShape = (cx: number, cy: number, w: number, h: number, rotRad = 0): Shape => rectShape(cx, cy, w, h, rotRad, 0);

/** Split a polyline into the pieces that keep clear of obstacles (pads, vias, holes; silk when asked), with exact re-checks. */
export function clearPieces(space: BoardSpace, pts: [number, number][], width: number, side: Side, c: Clearances, ignore: Ignore = {}, step = 25_000): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const ok = (a: [number, number], b: [number, number]) => !space.blocker(strokeShape(a[0], a[1], b[0], b[1], width), side, { ...c, edge: 0 }, ignore) && space.insideBoard(strokeShape(a[0], a[1], b[0], b[1], width), c.edge);
  const flush = () => {
    if (cur.length >= 2) {
      const len = cur.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - cur[i][0], p[1] - cur[i][1]), 0);
      if (len >= 3 * width) out.push(cur);
    }
    cur = [];
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (ok(a, b)) {
      if (!cur.length) cur.push(a);
      cur.push(b);
      continue;
    }
    const n = Math.max(1, Math.ceil(len / step));
    let prev: [number, number] = a;
    let prevOk = cur.length > 0 && cur[cur.length - 1][0] === a[0] && cur[cur.length - 1][1] === a[1];
    for (let k = 1; k <= n; k++) {
      const p: [number, number] = [Math.round(a[0] + ((b[0] - a[0]) * k) / n), Math.round(a[1] + ((b[1] - a[1]) * k) / n)];
      const good = ok(prev, p);
      if (good) {
        if (!prevOk) {
          flush();
          cur.push(prev);
        }
        cur.push(p);
      } else if (prevOk) flush();
      prevOk = good;
      prev = p;
    }
    if (!prevOk) flush();
  }
  flush();
  // merge collinear runs back into single segments
  return out.map((line) => {
    const r: [number, number][] = [line[0]];
    for (let i = 1; i < line.length - 1; i++) {
      const a = r[r.length - 1];
      const b = line[i];
      const c2 = line[i + 1];
      const cross = (b[0] - a[0]) * (c2[1] - a[1]) - (b[1] - a[1]) * (c2[0] - a[0]);
      if (Math.abs(cross) > 1e-3 * Math.hypot(c2[0] - a[0], c2[1] - a[1]) * 1000) r.push(b);
    }
    r.push(line[line.length - 1]);
    return r;
  });
}

/**
 * Picking, outside the renderer: the board core's query index finds candidates by box, then exact shape tests on
 * the scene's geometry decide. Only objects drawn on a visible layer are picked. Priority: pads and vias, then
 * tracks, then footprints, then graphics and text, then keep-outs and zones; a zone or keep-out is picked by its
 * outline, or by its inside only when nothing else is under the cursor. Within a rank, copper on the active layer
 * wins, then the closer shape, then the smaller object.
 */
import type { BoardQuery, CopperLayer } from "./board.js";
import { partDistance, rectInside, rectsMeet, NM, type Part, type Rect } from "./geom.js";
import type { DrawLayerId } from "./layers.js";
import type { Scene, SceneKind, SceneObject } from "./scene.js";

export interface PickContext {
  scene: Scene;
  query: BoardQuery;
  /** Whether a draw layer is shown. */
  visible: (layer: DrawLayerId) => boolean;
  active: CopperLayer;
}

export interface Hit {
  id: string;
  kind: SceneKind;
  rank: number;
  /** Signed distance to the shape in millimeters (negative inside). */
  distance: number;
  /** The owning footprint, for a pad. */
  footprint?: string;
  /** A zone or keep-out hit inside rather than on its outline. */
  interior?: boolean;
}

export const RANK: Record<SceneKind, number> = { pad: 5, via: 5, track: 4, footprint: 3, graphic: 2, text: 2, cutout: 2, outline: 1, keepout: 0, zone: 0, ratsnest: -1 };

const LABEL_LAYERS = new Set(["labels:pads", "labels:tracks"]);
/** The index's boxes leave out stroke widths and footprint text: candidates are looked up this much wider (mm), then tested exactly. */
const LOOKUP_MARGIN = 0.25;

/** The parts an object is picked by on visible layers. A footprint is picked by its body, not its text (which can sit outside its box). */
function visibleParts(o: SceneObject, visible: PickContext["visible"]): Part[] {
  const out: Part[] = [];
  for (const it of o.items) if (!LABEL_LAYERS.has(it.layer) && visible(it.layer)) for (const p of it.parts) if (!(o.kind === "footprint" && p.k === "text")) out.push(p);
  return out;
}

const area = (r: Rect) => (r[2] - r[0]) * (r[3] - r[1]);

/** Everything under (x, y) millimeters within `tol` millimeters, best first. */
export function pickAt(ctx: PickContext, x: number, y: number, tol: number): Hit[] {
  const items = ctx.query.at({ x: Math.round(x / NM), y: Math.round(y / NM) }, { tolerance: Math.ceil((tol + LOOKUP_MARGIN) / NM) });
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const o = ctx.scene.objects.get(it.id);
    if (!o) continue;
    const parts = visibleParts(o, ctx.visible);
    if (!parts.length && o.kind !== "footprint") continue;
    let d = Infinity;
    let interior = false;
    if (o.kind === "outline") {
      // the board outline by its edge only
      if (!parts.length || !o.pick) continue;
      d = Math.min(...o.pick.map((p) => partDistance(p, x, y)));
      if (d > tol) continue;
    } else if (o.kind === "zone" || o.kind === "keepout") {
      if (!parts.length) continue;
      const shape = o.pick?.[0];
      if (!shape || shape.k !== "poly") continue;
      const sd = partDistance(shape, x, y);
      if (Math.abs(sd) <= tol) d = Math.abs(sd);
      else if (sd < 0) {
        d = sd;
        interior = true;
      } else continue;
    } else if (o.kind === "footprint") {
      // its body: the courtyard area, else its drawn graphics, else its box
      const shown = parts.length > 0 || (ctx.scene.padsOf.get(o.id) ?? []).some((p) => visibleParts(ctx.scene.objects.get(p)!, ctx.visible).length > 0);
      if (!shown) continue;
      for (const p of [...(o.pick ?? []), ...parts]) d = Math.min(d, partDistance(p, x, y));
      if (!o.pick && d > tol && x >= o.rect[0] && x <= o.rect[2] && y >= o.rect[1] && y <= o.rect[3]) d = 0;
      if (d > tol) continue;
    } else {
      for (const p of parts) d = Math.min(d, partDistance(p, x, y));
      if (d > tol) continue;
    }
    hits.push({ id: o.id, kind: o.kind, rank: RANK[o.kind], distance: d, ...(o.kind === "pad" && o.footprint ? { footprint: o.footprint } : {}), ...(interior ? { interior } : {}) });
  }
  // a zone's or keep-out's inside counts only when nothing else is under the cursor
  const solid = hits.filter((h) => !h.interior);
  const list = solid.length ? solid : hits;
  const onActive = (h: Hit) => (ctx.scene.objects.get(h.id)?.copper.includes(ctx.active) ? 1 : 0);
  return list.sort(
    (a, b) =>
      b.rank - a.rank ||
      onActive(b) - onActive(a) ||
      Math.max(a.distance, -tol) - Math.max(b.distance, -tol) ||
      area(ctx.scene.objects.get(a.id)!.rect) - area(ctx.scene.objects.get(b.id)!.rect) ||
      (a.id < b.id ? -1 : 1),
  );
}

/**
 * Objects in a box (millimeters). `window` (drag left to right): objects wholly inside. `crossing` (right to left):
 * objects the box touches. Pads select their footprint; a zone, a keep-out or the board outline only when wholly
 * inside.
 */
export function pickBox(ctx: PickContext, rect: Rect, mode: "window" | "crossing"): string[] {
  const items = ctx.query.region({ minX: Math.floor(rect[0] / NM), minY: Math.floor(rect[1] / NM), maxX: Math.ceil(rect[2] / NM), maxY: Math.ceil(rect[3] / NM) });
  const out = new Set<string>();
  for (const it of items) {
    const o = ctx.scene.objects.get(it.kind === "pad" ? (ctx.scene.objects.get(it.id)?.footprint ?? it.id) : it.id);
    if (!o || o.kind === "pad" || o.kind === "ratsnest") continue;
    const shown =
      visibleParts(o, ctx.visible).length > 0 || (o.kind === "footprint" && (ctx.scene.padsOf.get(o.id) ?? []).some((p) => visibleParts(ctx.scene.objects.get(p)!, ctx.visible).length > 0));
    if (!shown) continue;
    const whole = rectInside(o.rect, rect);
    if (o.kind === "zone" || o.kind === "keepout" || o.kind === "outline") {
      if (whole && mode === "window") out.add(o.id);
      continue;
    }
    if (mode === "window" ? whole : rectsMeet(o.rect, rect)) out.add(o.id);
  }
  return [...out].sort();
}

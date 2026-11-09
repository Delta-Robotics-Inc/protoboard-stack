/** Adding and removing footprints (Phase 2 contract, section 2.2). */
import { z } from "zod";
import { byCodeUnit } from "../canonical.js";
import { copperLayers, footprintByRef, recordsOfKind, type BoardDocument } from "../document.js";
import { pointInPolygon } from "../dxf.js";
import { boxContains, inflate, padsOf, rotatePoint, viaLayers, type WorldPad } from "../geometry.js";
import { FootprintRec, idMatchesKind, ObjectId, type BoardRecord, type FootprintRec as FootprintRecord, type Pad, type Point } from "../schema.js";
import { change, distinct, need, OpError, registerOperation, type ApplyContext } from "./registry.js";

const FootprintFields = FootprintRec.omit({ kind: true, id: true, provenance: true });

/** A pad's smaller and larger copper sides in its own frame (undefined for a plain hole, which has no copper). */
export function padSides(p: Pad): [number, number] | undefined {
  let w: number;
  let h: number;
  if (p.type === "np") return undefined;
  if (p.type === "th") {
    if (p.shape === "circle") w = h = p.outer_diameter ?? 0;
    else {
      w = p.outer_width ?? 0;
      h = p.outer_height ?? 0;
    }
  } else if (p.shape === "circle") w = h = 2 * (p.radius ?? 0);
  else if (p.shape === "polygon") {
    const xs = (p.points ?? []).map((v) => v.x);
    const ys = (p.points ?? []).map((v) => v.y);
    w = Math.max(...xs) - Math.min(...xs);
    h = Math.max(...ys) - Math.min(...ys);
  } else {
    w = p.width ?? 0;
    h = p.height ?? 0;
  }
  return [Math.min(w, h), Math.max(w, h)];
}

/**
 * Whether a world point lies on a pad's copper (its shape in the world frame; the edge counts). Polygon pads use
 * their vertices as straight edges (a vertex's arc sweep is not followed).
 */
export function pointOnPad(fp: Pick<FootprintRecord, "side">, wp: WorldPad, at: Point): boolean {
  const p = wp.pad;
  if (p.type === "np") return false;
  if (!boxContains(inflate(wp.box, 1), at)) return false;
  const d = rotatePoint({ x: at.x - wp.x, y: at.y - wp.y }, -wp.rotation);
  if (fp.side === "bottom") d.x = -d.x;
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const eps = 1;
  const inRect = (w: number, h: number) => ax <= w / 2 + eps && ay <= h / 2 + eps;
  const inRound = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    const qx = ax - (w / 2 - rr);
    const qy = ay - (h / 2 - rr);
    return inRect(w, h) && (qx <= 0 || qy <= 0 || Math.hypot(qx, qy) <= rr + eps);
  };
  const inOval = (w: number, h: number) => inRound(w, h, Math.min(w, h) / 2);
  if (p.type === "th") {
    if (p.shape === "circle") return Math.hypot(d.x, d.y) <= (p.outer_diameter ?? 0) / 2 + eps;
    const w = p.outer_width ?? 0;
    const h = p.outer_height ?? 0;
    return p.shape === "oval" ? inOval(w, h) : p.shape === "roundrect" ? inRound(w, h, p.corner_radius ?? 0) : inRect(w, h);
  }
  switch (p.shape) {
    case "circle":
      return Math.hypot(d.x, d.y) <= (p.radius ?? 0) + eps;
    case "polygon":
      return pointInPolygon(d, p.points ?? []);
    case "oval":
      return inOval(p.width ?? 0, p.height ?? 0);
    case "roundrect":
      return inRound(p.width ?? 0, p.height ?? 0, p.corner_radius ?? 0);
    default:
      return inRect(p.width ?? 0, p.height ?? 0);
  }
}

/** Every footprint's world pads on the board's copper layers, with their footprint. */
export function boardPads(doc: BoardDocument): { fp: FootprintRecord; pad: WorldPad }[] {
  const copper = copperLayers(doc);
  return recordsOfKind(doc, "footprint").flatMap((fp) => padsOf(fp, copper).map((pad) => ({ fp, pad })));
}

/**
 * Copper attached to a footprint's pads: tracks with an end on a pad's copper on that pad's layer, and vias whose
 * center is on a pad whose layers the via spans. Sorted by id.
 */
export function attachedCopper(doc: BoardDocument, fp: FootprintRecord): string[] {
  const pads = padsOf(fp, copperLayers(doc)).filter((p) => p.layers.length);
  const out: string[] = [];
  for (const r of doc.records.values()) {
    if (r.kind === "track") {
      if (pads.some((p) => p.layers.includes(r.layer) && (pointOnPad(fp, p, r.start) || pointOnPad(fp, p, r.end)))) out.push(r.id);
    } else if (r.kind === "via") {
      const span = viaLayers(doc, r.from_layer, r.to_layer);
      if (pads.some((p) => p.layers.some((l) => span.includes(l)) && pointOnPad(fp, p, { x: r.x, y: r.y }))) out.push(r.id);
    }
  }
  return out.sort(byCodeUnit);
}

const EXAMPLE_FOOTPRINT = {
  ref: "TP1",
  path: "test/tp1",
  footprint: "Airnode:TestPoint-1mm",
  value: "test point",
  x: -17_000_000,
  y: -8_000_000,
  rotation: 0,
  side: "top",
  pads: [{ number: "1", type: "smd", shape: "circle", x: 0, y: 0, radius: 500_000 }],
};

registerOperation({
  name: "footprint.add",
  title: "Add a footprint",
  description:
    "Place a new footprint: reference designator, optional UHD instance path, library name, value, LCSC part, position (nanometers), rotation (millidegrees), side, pads in the footprint frame, and optional courtyard, graphics and texts. Its id is fp:<path> when path is given, else fp:<ref>. Refused when that id or the reference is already on the board. Pads take their nets from the netlist by reference and pad number.",
  input: z.object({ footprint: FootprintFields }).strict(),
  audience: "all",
  phase: 2,
  example: { footprint: EXAMPLE_FOOTPRINT },
  apply(doc, input, ctx) {
    const f = input.footprint;
    const id = `fp:${f.path ?? f.ref}`;
    if (!idMatchesKind(id, "footprint")) throw new OpError(`${id} is not a valid footprint id (keys use letters, digits and _ . - / + ~)`);
    if (doc.records.has(id)) throw new OpError(`${id} already exists`);
    const other = footprintByRef(doc, f.ref);
    if (other) throw new OpError(`reference ${f.ref} is already used by ${other.id}`);
    const rec: FootprintRecord = { kind: "footprint", id, ...f, provenance: ctx.provenance };
    return change(doc, [rec]);
  },
});

const stops = (ctx: ApplyContext) => ctx.actor.kind === "agent" || ctx.actor.kind === "router";

registerOperation({
  name: "footprint.remove",
  title: "Remove footprints",
  description:
    "Remove footprints and the keep-outs that belong to them. Copper attached to their pads (tracks ending on a pad, vias centered on one) is kept and reported as orphaned with copper: \"keep\" (the default), or removed with copper: \"remove\"; agents and routers never remove locked copper, which is reported as skippedLocked and stays orphaned.",
  input: z.object({ ids: z.array(ObjectId).min(1).max(1000), copper: z.enum(["keep", "remove"]).optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { ids: ["fp:ui/boot_button"] },
  apply(doc, input, ctx) {
    const fps = distinct(input.ids).map((id) => need(doc, id, ["footprint"]));
    const gone = new Set(fps.map((f) => f.id));
    const attached = [...new Set(fps.flatMap((f) => attachedCopper(doc, f)))].sort(byCodeUnit);
    const keepouts = recordsOfKind(doc, "keepout")
      .filter((k) => k.footprint && gone.has(k.footprint))
      .map((k) => k.id);
    const removedCopper: string[] = [];
    const skippedLocked: string[] = [];
    const orphaned: string[] = [];
    for (const id of attached) {
      const r = doc.records.get(id) as BoardRecord & { locked?: true };
      if (input.copper !== "remove") orphaned.push(id);
      else if (r.locked && stops(ctx)) {
        skippedLocked.push(id);
        orphaned.push(id);
      } else removedCopper.push(id);
    }
    const report = { removed: [...gone], keepouts, copper: input.copper ?? "keep", orphaned, removedCopper, skippedLocked };
    return change(doc, [], [...gone, ...keepouts, ...removedCopper], undefined, report);
  },
});

export {};

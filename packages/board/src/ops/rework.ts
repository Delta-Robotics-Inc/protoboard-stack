/** Track width changes and ripping up copper (Phase 2 contract, section 2.1). */
import { z } from "zod";
import { byCodeUnit } from "../canonical.js";
import { copperLayers, recordsOfKind, type BoardDocument } from "../document.js";
import { arcPoints, flattenContour, pointInPolygon, pointSegmentDistance, segmentDistance, type XY } from "../dxf.js";
import { viaLayers } from "../geometry.js";
import { Contour, CopperLayer, NetName, ObjectId, PositiveNm, type BoardRecord, type Point, type TrackRec, type Vertex, type ViaRec } from "../schema.js";
import { boardPads, padSides, pointOnPad } from "./placement.js";
import { change, distinct, edited, lockedByDefault, need, OpError, registerOperation, type ApplyContext } from "./registry.js";

const stops = (ctx: ApplyContext) => ctx.actor.kind === "agent" || ctx.actor.kind === "router";
const isLocked = (r: BoardRecord) => (r as { locked?: true }).locked === true;

function checkLayers(doc: BoardDocument, layers: readonly string[]): void {
  const stack = copperLayers(doc);
  for (const l of layers) if (!(stack as string[]).includes(l)) throw new OpError(`layer ${l} is not in this board's stackup (${stack.join(", ")})`);
}

/** A net named in an input must be in the netlist or on some copper (catches typos). */
function checkNets(doc: BoardDocument, nets: readonly string[]): void {
  const onCopper = new Set<string>();
  for (const r of doc.records.values()) if ((r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net) onCopper.add(r.net);
  for (const n of nets) if (!doc.nets.has(n) && !onCopper.has(n)) throw new OpError(`net ${n} is not in the netlist and no copper is on it`);
}

// ---------------------------------------------------------------- track.set_width

interface Neck {
  pad: string;
  width: number;
  length: number;
}

registerOperation({
  name: "track.set_width",
  title: "Set track widths",
  description:
    "Set the width (nanometers) of tracks given by `ids`, or of every track of `net` (exactly one of the two). With neck: true, a straight segment ending on a pad whose smaller side is narrower than the new width keeps a neck at that end: the part within one pad length (the pad's larger side) of the pad keeps the pad's smaller side as its width, as a new segment. The report lists changed and necked tracks; for a net, agents and routers skip locked tracks (skippedLocked).",
  input: z.object({ ids: z.array(ObjectId).min(1).max(5000).optional(), net: NetName.optional(), width: PositiveNm, neck: z.boolean().optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { net: "I2C_SDA", width: 500_000, neck: true },
  apply(doc, input, ctx) {
    if ((input.ids === undefined) === (input.net === undefined)) throw new OpError("give exactly one of ids and net");
    const skippedLocked: string[] = [];
    let tracks: TrackRec[];
    if (input.ids) tracks = distinct(input.ids).map((id) => need(doc, id, ["track"]));
    else {
      checkNets(doc, [input.net!]);
      tracks = recordsOfKind(doc, "track").filter((t) => t.net === input.net);
      if (!tracks.length) throw new OpError(`no tracks on net ${input.net}`);
      if (stops(ctx)) {
        for (const t of tracks) if (isLocked(t)) skippedLocked.push(t.id);
        tracks = tracks.filter((t) => !isLocked(t));
      }
    }
    const pads = input.neck ? boardPads(doc) : [];
    const neckAt = (t: TrackRec, at: Point): Neck | undefined => {
      let best: Neck | undefined;
      for (const { fp, pad } of pads) {
        if (!pad.layers.includes(t.layer) || !pointOnPad(fp, pad, at)) continue;
        const sides = padSides(pad.pad);
        if (!sides || sides[0] >= input.width || sides[0] <= 0) continue;
        if (!best || sides[0] < best.width) best = { pad: pad.id, width: sides[0], length: sides[1] };
      }
      return best;
    };
    const puts: TrackRec[] = [];
    const changed: string[] = [];
    const necked: { track: string; pad: string; neck: string; width: number }[] = [];
    const finish = (t: TrackRec) => lockedByDefault(edited(t, ctx), ctx);
    for (const t of tracks) {
      const s = input.neck && t.sweep === undefined ? neckAt(t, t.start) : undefined;
      const e = input.neck && t.sweep === undefined ? neckAt(t, t.end) : undefined;
      const len = Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);
      if (!s && !e) {
        if (t.width === input.width) continue;
        puts.push(finish({ ...t, width: input.width }));
        changed.push(t.id);
        continue;
      }
      // the whole segment is within the neck length of its pads: it all keeps the neck width
      if ((s?.length ?? 0) + (e?.length ?? 0) >= len) {
        const w = Math.min(s?.width ?? Infinity, e?.width ?? Infinity);
        if (t.width !== w) {
          puts.push(finish({ ...t, width: w }));
          changed.push(t.id);
        }
        for (const n of [s, e]) if (n) necked.push({ track: t.id, pad: n.pad, neck: t.id, width: n.width });
        continue;
      }
      const along = (from: Point, to: Point, d: number): Point => ({ x: Math.round(from.x + ((to.x - from.x) * d) / len), y: Math.round(from.y + ((to.y - from.y) * d) / len) });
      const p1 = s ? along(t.start, t.end, s.length) : t.start;
      const p2 = e ? along(t.end, t.start, e.length) : t.end;
      if (s) {
        const id = ctx.issueId("track");
        puts.push(finish({ ...t, id, width: s.width, start: t.start, end: p1 }));
        necked.push({ track: t.id, pad: s.pad, neck: id, width: s.width });
      }
      puts.push(finish({ ...t, width: input.width, start: p1, end: p2 }));
      if (e) {
        const id = ctx.issueId("track");
        puts.push(finish({ ...t, id, width: e.width, start: p2, end: t.end }));
        necked.push({ track: t.id, pad: e.pad, neck: id, width: e.width });
      }
      changed.push(t.id);
    }
    return change(doc, puts, [], undefined, { changed, necked, ...(skippedLocked.length ? { skippedLocked } : {}) });
  },
});

// ---------------------------------------------------------------- copper.rip

/** Whether a track (its centerline grown by half its width) meets a polygon: crossing, touching or inside it. */
function trackTouches(t: TrackRec, poly: readonly XY[]): boolean {
  const pts: XY[] = [t.start, ...(t.sweep !== undefined ? arcPoints(t.start, t.end, t.sweep) : [t.end])];
  if (pts.some((p) => pointInPolygon(p, poly))) return true;
  const r = t.width / 2;
  for (let i = 0; i + 1 < pts.length; i++)
    for (let j = 0; j < poly.length; j++) if (segmentDistance(pts[i], pts[i + 1], poly[j], poly[(j + 1) % poly.length]) <= r) return true;
  return false;
}

/** Whether a via's disc meets a polygon. */
function viaTouches(v: ViaRec, poly: readonly XY[]): boolean {
  const c = { x: v.x, y: v.y };
  if (pointInPolygon(c, poly)) return true;
  const r = v.outer_diameter / 2;
  for (let j = 0; j < poly.length; j++) if (pointSegmentDistance(c, poly[j], poly[(j + 1) % poly.length]) <= r) return true;
  return false;
}

const EXAMPLE_REGION: Vertex[] = [
  { x: -6_000_000, y: 6_000_000 },
  { x: 0, y: 6_000_000 },
  { x: 0, y: 11_000_000 },
  { x: -6_000_000, y: 11_000_000 },
];

registerOperation({
  name: "copper.rip",
  title: "Rip up copper",
  description:
    "Remove unlocked tracks and vias of the given `nets`, or touching the `region` (a closed contour in nanometers; a track touches when its width meets the area), or both (then a removed object must match both). `layers` and `kinds` (track, via) narrow it. Locked copper is never removed: the report lists it as skippedLocked beside the removed ids. At least one of nets and region.",
  input: z
    .object({
      nets: z.array(NetName).min(1).max(10_000).optional(),
      region: Contour.optional(),
      layers: z.array(CopperLayer).min(1).max(10).optional(),
      kinds: z.array(z.enum(["track", "via"])).min(1).max(2).optional(),
    })
    .strict(),
  audience: "all",
  phase: 2,
  example: { nets: ["I2C_SDA"], region: EXAMPLE_REGION },
  apply(doc, input) {
    if (!input.nets && !input.region) throw new OpError("give nets, region, or both");
    if (input.nets) checkNets(doc, input.nets);
    if (input.layers) checkLayers(doc, input.layers);
    const nets = input.nets ? new Set(input.nets) : undefined;
    const layers = input.layers ? new Set<string>(input.layers) : undefined;
    const kinds = new Set(input.kinds ?? ["track", "via"]);
    const poly = input.region ? flattenContour(input.region) : undefined;
    const removed: string[] = [];
    const skippedLocked: string[] = [];
    for (const r of doc.records.values()) {
      if (r.kind !== "track" && r.kind !== "via") continue;
      if (!kinds.has(r.kind)) continue;
      if (nets && !(r.net && nets.has(r.net))) continue;
      if (layers && !(r.kind === "track" ? layers.has(r.layer) : viaLayers(doc, r.from_layer, r.to_layer).some((l) => layers.has(l)))) continue;
      if (poly && !(r.kind === "track" ? trackTouches(r, poly) : viaTouches(r, poly))) continue;
      (isLocked(r) ? skippedLocked : removed).push(r.id);
    }
    removed.sort(byCodeUnit);
    skippedLocked.sort(byCodeUnit);
    return change(doc, [], removed, undefined, { removed, skippedLocked });
  },
});

export {};

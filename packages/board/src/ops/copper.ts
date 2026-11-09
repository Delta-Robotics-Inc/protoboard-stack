/** Track and via operations and net assignment (contract section 8.2). */
import { z } from "zod";
import { copperLayers } from "../document.js";
import { CopperLayer, Key, NetName, Nm, ObjectId, Point, PositiveNm, Sweep, type TrackRec, type ViaRec } from "../schema.js";
import { change, distinct, edited, lockedByDefault, need, OpError, registerOperation, type ApplyContext } from "./registry.js";

const Ids = z.array(ObjectId).min(1).max(5000);
export const Handle = z.string().regex(/^[A-Za-z0-9_]{1,40}$/, "a handle is 1 to 40 letters, digits or _");

/** An id a host chose (importers), or a new owner-issued one. Agents and people never choose ids. */
export function newId(ctx: ApplyContext, kind: "track" | "via" | "zone" | "keepout", given: string | undefined, prefix: string): string {
  if (given === undefined) return ctx.issueId(kind);
  if (ctx.actor.kind !== "host" && ctx.actor.kind !== "system") throw new OpError("only hosts choose ids; pass a handle and read the id from the reply");
  if (!given.startsWith(`${prefix}:`) || !Key.safeParse(given.slice(prefix.length + 1)).success) throw new OpError(`${given} is not a ${prefix}: id`);
  return given;
}

const Segment = z
  .object({
    handle: Handle.optional(),
    id: ObjectId.optional(),
    net: NetName.optional(),
    layer: CopperLayer,
    width: PositiveNm,
    start: Point,
    end: Point,
    sweep: Sweep.optional(),
    locked: z.boolean().optional(),
  })
  .strict();

registerOperation({
  name: "track.add",
  title: "Add track segments",
  description:
    "Add copper track segments, or arcs when `sweep` (millidegrees, counterclockwise positive) is given, on a copper layer with a width in nanometers. Give each a `handle` to learn its new id from the reply (later operations in the same transaction may use \"$<handle>\"). A person's copper is locked by default; pass locked: false to leave it open to routers.",
  input: z.object({ segments: z.array(Segment).min(1).max(5000) }).strict(),
  audience: "all",
  phase: 1,
  example: { segments: [{ handle: "a", net: "I2C_SDA", layer: "top", width: 200_000, start: { x: 2_000_000, y: 4_000_000 }, end: { x: 4_000_000, y: 4_000_000 } }] },
  apply(doc, input, ctx) {
    const layers = copperLayers(doc);
    const created: Record<string, string> = {};
    const puts = input.segments.map((s, i) => {
      if (!layers.includes(s.layer)) throw new OpError(`segment ${i}: layer ${s.layer} is not in this board's stackup (${layers.join(", ")})`);
      if (s.start.x === s.end.x && s.start.y === s.end.y) throw new OpError(`segment ${i}: start and end are the same point`);
      const id = newId(ctx, "track", s.id, "trk");
      if (doc.records.has(id)) throw new OpError(`${id} already exists`);
      if (s.handle) {
        if (created[s.handle]) throw new OpError(`handle ${s.handle} is used twice`);
        created[s.handle] = id;
      }
      const rec: TrackRec = { kind: "track", id, ...(s.net ? { net: s.net } : {}), layer: s.layer, width: s.width, start: s.start, end: s.end, ...(s.sweep !== undefined ? { sweep: s.sweep } : {}), provenance: ctx.provenance };
      return lockedByDefault(rec, ctx, s.locked);
    });
    return change(doc, puts, [], created);
  },
});

registerOperation({
  name: "track.move",
  title: "Move track segments",
  description:
    "Translate track segments and arcs rigidly by dx, dy (nanometers). Connected copper does not follow in Phase 1 (Phase 2 adds `follow`). A person's moved copper becomes locked.",
  input: z.object({ ids: Ids, dx: Nm, dy: Nm }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["trk:f.i2c_sda.1"], dx: 0, dy: 100_000 },
  apply(doc, input, ctx) {
    const puts = distinct(input.ids).map((id) => {
      const t = need(doc, id, ["track"]);
      const moved: TrackRec = { ...t, start: { x: t.start.x + input.dx, y: t.start.y + input.dy }, end: { x: t.end.x + input.dx, y: t.end.y + input.dy } };
      return lockedByDefault(edited(moved, ctx), ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "track.delete",
  title: "Delete track segments",
  description: "Remove track segments and arcs by id.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["trk:f.i2c_scl.1"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["track"]);
    return change(doc, [], ids);
  },
});

const ViaIn = z
  .object({
    handle: Handle.optional(),
    id: ObjectId.optional(),
    net: NetName.optional(),
    x: Nm,
    y: Nm,
    outer_diameter: PositiveNm,
    hole_diameter: PositiveNm,
    from_layer: CopperLayer.optional(),
    to_layer: CopperLayer.optional(),
    tented: z.enum(["both", "top", "bottom", "none"]).optional(),
    locked: z.boolean().optional(),
  })
  .strict();

registerOperation({
  name: "via.add",
  title: "Add vias",
  description:
    "Add vias at x, y (nanometers) with outer and hole diameters. from_layer and to_layer default to the outermost copper layers (a through via); from_layer must be above to_layer. Give each a `handle` to learn its id. A person's vias are locked by default.",
  input: z.object({ vias: z.array(ViaIn).min(1).max(5000) }).strict(),
  audience: "all",
  phase: 1,
  example: { vias: [{ handle: "v", net: "GND", x: -6_000_000, y: -11_000_000, outer_diameter: 600_000, hole_diameter: 300_000 }] },
  apply(doc, input, ctx) {
    const layers = copperLayers(doc);
    const created: Record<string, string> = {};
    const puts = input.vias.map((v, i) => {
      const from = v.from_layer ?? layers[0];
      const to = v.to_layer ?? layers[layers.length - 1];
      const a = layers.indexOf(from);
      const b = layers.indexOf(to);
      if (a < 0 || b < 0) throw new OpError(`via ${i}: layers ${from} and ${to} must be in this board's stackup (${layers.join(", ")})`);
      if (a >= b) throw new OpError(`via ${i}: from_layer ${from} must be above to_layer ${to}`);
      if (v.hole_diameter >= v.outer_diameter) throw new OpError(`via ${i}: the hole (${v.hole_diameter} nm) must be smaller than the outer diameter (${v.outer_diameter} nm)`);
      const id = newId(ctx, "via", v.id, "via");
      if (doc.records.has(id)) throw new OpError(`${id} already exists`);
      if (v.handle) {
        if (created[v.handle]) throw new OpError(`handle ${v.handle} is used twice`);
        created[v.handle] = id;
      }
      const rec: ViaRec = { kind: "via", id, ...(v.net ? { net: v.net } : {}), x: v.x, y: v.y, outer_diameter: v.outer_diameter, hole_diameter: v.hole_diameter, from_layer: from, to_layer: to, ...(v.tented ? { tented: v.tented } : {}), provenance: ctx.provenance };
      return lockedByDefault(rec, ctx, v.locked);
    });
    return change(doc, puts, [], created);
  },
});

registerOperation({
  name: "via.move",
  title: "Move vias",
  description: "Translate vias by dx, dy (nanometers). Connected tracks do not follow in Phase 1. A person's moved vias become locked.",
  input: z.object({ ids: Ids, dx: Nm, dy: Nm }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["via:f.gnd.1"], dx: 250_000, dy: 0 },
  apply(doc, input, ctx) {
    const puts = distinct(input.ids).map((id) => {
      const v = need(doc, id, ["via"]);
      return lockedByDefault(edited({ ...v, x: v.x + input.dx, y: v.y + input.dy }, ctx), ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "via.delete",
  title: "Delete vias",
  description: "Remove vias by id.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["via:f.gnd.2"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["via"]);
    return change(doc, [], ids);
  },
});

registerOperation({
  name: "net.set",
  title: "Set the net of copper",
  description:
    "Assign tracks, vias or zones to a net (it must exist in the board's netlist), or clear it with net: null. Pads take their nets from the netlist and cannot be set here. Net changes from an agent wait for a person (refused with needs-person in Phase 1; a proposal in Phase 2).",
  input: z.object({ ids: Ids, net: NetName.nullable() }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["trk:f.spare.1"], net: "+3V3" },
  apply(doc, input, ctx) {
    const puts = distinct(input.ids).map((id) => {
      const r = need(doc, id, ["track", "via", "zone"]);
      if (input.net === null) {
        const { net: _n, ...rest } = r;
        return edited(rest as typeof r, ctx);
      }
      return edited({ ...r, net: input.net }, ctx);
    });
    return change(doc, puts);
  },
});

export {};

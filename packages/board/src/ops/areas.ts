/** Zones, keep-outs and the board outline (contract section 8.2). */
import { z } from "zod";
import { copperLayers, type BoardDocument } from "../document.js";
import { Contour, KeepoutFields, ObjectId, OutlineSource, ZoneFields, type KeepoutRec, type OutlineRec, type ZoneRec } from "../schema.js";
import { Handle, newId } from "./copper.js";
import { change, distinct, edited, need, OpError, registerOperation, unsetFields } from "./registry.js";

const Ids = z.array(ObjectId).min(1).max(1000);

function checkLayers(doc: BoardDocument, layers: readonly string[]): void {
  const stack = copperLayers(doc);
  for (const l of layers) if (!stack.includes(l as never)) throw new OpError(`layer ${l} is not in this board's stackup (${stack.join(", ")})`);
  if (new Set(layers).size !== layers.length) throw new OpError("a layer is listed twice");
}

const EXAMPLE_AREA = [
  { x: -18_000_000, y: -13_000_000 },
  { x: -10_000_000, y: -13_000_000 },
  { x: -10_000_000, y: -6_000_000 },
  { x: -18_000_000, y: -6_000_000 },
];

registerOperation({
  name: "zone.add",
  title: "Add a copper zone",
  description:
    "Add a copper zone: its net, copper layers, outline (vertices in nanometers; a vertex's `sweep` makes the edge to the next vertex an arc), fill priority (higher fills first), pad connection, fill mode and island removal. The zone is intent; its fill is derived and recomputed.",
  input: z.object({ zone: ZoneFields, handle: Handle.optional(), id: ObjectId.optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { zone: { net: "+3V3", layers: ["top"], outline: EXAMPLE_AREA, priority: 1, pad_connection: "thermal", fill_mode: "solid", remove_islands: "always" }, handle: "z" },
  apply(doc, input, ctx) {
    checkLayers(doc, input.zone.layers);
    const id = newId(ctx, "zone", input.id, "zone");
    if (doc.records.has(id)) throw new OpError(`${id} already exists`);
    const rec: ZoneRec = { kind: "zone", id, ...input.zone, provenance: ctx.provenance };
    return change(doc, [rec], [], input.handle ? { [input.handle]: id } : undefined);
  },
});

registerOperation({
  name: "zone.edit",
  title: "Edit a copper zone",
  description: "Change fields of a zone: `patch` sets fields, `unset` removes optional ones (for example clearance, to fall back on the rules). The fill goes stale and is recomputed.",
  input: z.object({ id: ObjectId, patch: ZoneFields.partial(), unset: z.array(z.string()).max(20).optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { id: "zone:f.gnd_bottom", patch: { clearance: 300_000 } },
  apply(doc, input, ctx) {
    const z0 = need(doc, input.id, ["zone"]);
    if (input.patch.layers) checkLayers(doc, input.patch.layers);
    const next = unsetFields({ ...z0, ...input.patch } as ZoneRec, input.unset, ["kind", "id", "layers", "outline", "priority", "pad_connection", "fill_mode", "remove_islands", "provenance"]);
    return change(doc, [edited(next, ctx)]);
  },
});

registerOperation({
  name: "zone.delete",
  title: "Delete copper zones",
  description: "Remove zones by id (their derived fill goes with them).",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["zone:f.gnd_bottom"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["zone"]);
    return change(doc, [], ids);
  },
});

registerOperation({
  name: "keepout.add",
  title: "Add a keep-out",
  description:
    "Add a keep-out area: outline, copper layers, and what it blocks ({tracks, vias, pours, footprints}, all four stated). tier \"no_go\" is a hard limit; \"policy\" is a preference checked as a warning and used as a cost by routers. `footprint` ties it to a footprint.",
  input: z.object({ keepout: KeepoutFields, handle: Handle.optional(), id: ObjectId.optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { keepout: { outline: EXAMPLE_AREA, layers: ["top", "bottom"], blocks: { tracks: false, vias: true, pours: false, footprints: false }, tier: "policy", name: "no vias near the button" }, handle: "k" },
  apply(doc, input, ctx) {
    checkLayers(doc, input.keepout.layers);
    if (input.keepout.footprint) need(doc, input.keepout.footprint, ["footprint"]);
    const id = newId(ctx, "keepout", input.id, "kpo");
    if (doc.records.has(id)) throw new OpError(`${id} already exists`);
    const rec: KeepoutRec = { kind: "keepout", id, ...input.keepout, provenance: ctx.provenance };
    return change(doc, [rec], [], input.handle ? { [input.handle]: id } : undefined);
  },
});

registerOperation({
  name: "keepout.edit",
  title: "Edit a keep-out",
  description: "Change fields of a keep-out: `patch` sets fields (blocks is replaced whole), `unset` removes optional ones.",
  input: z.object({ id: ObjectId, patch: KeepoutFields.partial(), unset: z.array(z.string()).max(20).optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { id: "kpo:f.antenna", patch: { tier: "no_go" } },
  apply(doc, input, ctx) {
    const k = need(doc, input.id, ["keepout"]);
    if (input.patch.layers) checkLayers(doc, input.patch.layers);
    if (input.patch.footprint) need(doc, input.patch.footprint, ["footprint"]);
    const next = unsetFields({ ...k, ...input.patch } as KeepoutRec, input.unset, ["kind", "id", "outline", "layers", "blocks", "tier", "provenance"]);
    return change(doc, [edited(next, ctx)]);
  },
});

registerOperation({
  name: "keepout.delete",
  title: "Delete keep-outs",
  description: "Remove keep-outs by id.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["kpo:f.antenna"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["keepout"]);
    return change(doc, [], ids);
  },
});

registerOperation({
  name: "outline.set",
  title: "Set the board outline",
  description:
    "Replace the board outline (a closed list of vertices in nanometers, centered on the origin by convention; `sweep` on a vertex rounds the edge to the next). `source` says who owns it: {kind: \"board\"} or {kind: \"cad\", ref}. A CAD-driven outline only changes with detach: true.",
  input: z.object({ outline: Contour, source: OutlineSource.optional(), detach: z.boolean().optional() }).strict(),
  audience: "all",
  phase: 1,
  example: {
    outline: [
      { x: -21_000_000, y: -15_000_000 },
      { x: 21_000_000, y: -15_000_000 },
      { x: 21_000_000, y: 15_000_000 },
      { x: -21_000_000, y: 15_000_000 },
    ],
  },
  apply(doc, input, ctx) {
    const old = doc.records.get("outline") as OutlineRec | undefined;
    if (old && old.source.kind === "cad" && !input.detach && (input.source?.kind ?? "cad") === "cad") throw new OpError(`the outline is driven by CAD (${old.source.ref}); pass detach: true to take it over here`);
    const source = input.source ?? (input.detach ? { kind: "board" as const } : (old?.source ?? { kind: "board" as const }));
    const base: OutlineRec = old ? { ...old, outline: input.outline, source } : { kind: "outline", id: "outline", outline: input.outline, source, provenance: ctx.provenance };
    return change(doc, [old ? edited(base, ctx) : base]);
  },
});

export {};

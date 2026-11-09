/** Board text and graphics (Phase 2 contract, section 2.2). */
import { z } from "zod";
import { copperLayers, type BoardDocument } from "../document.js";
import { COPPER_LAYERS, GraphicRec, ObjectId, TextRec, type GraphicRec as GraphicRecord, type TextRec as TextRecord } from "../schema.js";
import { Handle } from "./copper.js";
import { change, distinct, edited, need, OpError, registerOperation, unsetFields } from "./registry.js";

const Ids = z.array(ObjectId).min(1).max(5000);
const TextFields = TextRec.omit({ kind: true, id: true, provenance: true });
const GraphicFields = GraphicRec.omit({ kind: true, id: true, provenance: true });

/** A copper layer must be in the stackup; drawing layers are a fixed vocabulary. */
function checkLayer(doc: BoardDocument, layer: string): void {
  if ((COPPER_LAYERS as readonly string[]).includes(layer) && !(copperLayers(doc) as string[]).includes(layer)) throw new OpError(`layer ${layer} is not in this board's stackup (${copperLayers(doc).join(", ")})`);
}

/** The fields each graphic shape needs (contract section 4.1). */
function checkGraphic(g: Omit<GraphicRecord, "kind" | "id" | "provenance">): void {
  const need = (fields: (keyof typeof g)[]) => {
    const missing = fields.filter((f) => g[f] === undefined);
    if (missing.length) throw new OpError(`a ${g.shape} graphic needs ${missing.join(", ")}`);
  };
  switch (g.shape) {
    case "line":
      need(["start", "end"]);
      break;
    case "arc":
      need(["start", "end", "sweep"]);
      break;
    case "circle":
      need(["center", "radius"]);
      break;
    case "rect":
      need(["center", "width", "height"]);
      break;
    case "polygon":
      need(["points"]);
      if (g.points!.length < 3) throw new OpError("a polygon graphic needs at least three points");
      break;
    case "path":
      need(["points"]);
      break;
  }
  if ((g.shape === "line" || g.shape === "arc") && g.start!.x === g.end!.x && g.start!.y === g.end!.y) throw new OpError(`a ${g.shape} graphic's start and end are the same point`);
}

const EXAMPLE_TEXT = { layer: "top_silkscreen", text: "rev C", x: 15_000_000, y: -13_500_000, height: 1_000_000, stroke_width: 150_000 };

registerOperation({
  name: "text.add",
  title: "Add board text",
  description:
    "Add text on the board: its layer (silkscreen, fabrication, user notes or a copper layer of the stackup), the text, x and y (nanometers), height, and optionally stroke width, rotation (millidegrees), anchor (center, left, right) and mirrored. Give a `handle` to learn its new id from the reply.",
  input: z.object({ text: TextFields, handle: Handle.optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { text: EXAMPLE_TEXT, handle: "t" },
  apply(doc, input, ctx) {
    checkLayer(doc, input.text.layer);
    const id = ctx.issueId("text");
    if (doc.records.has(id)) throw new OpError(`${id} already exists`);
    const rec: TextRecord = { kind: "text", id, ...input.text, provenance: ctx.provenance };
    return change(doc, [rec], [], input.handle ? { [input.handle]: id } : undefined);
  },
});

registerOperation({
  name: "text.edit",
  title: "Edit board text",
  description: "Change fields of board text: `patch` sets fields (text, layer, position, height, rotation, anchor...), `unset` removes optional ones (stroke_width, rotation, anchor, mirrored).",
  input: z.object({ id: ObjectId, patch: TextFields.partial(), unset: z.array(z.string()).max(20).optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { id: "txt:f.title", patch: { text: "Airnode C3 rev B" } },
  apply(doc, input, ctx) {
    const t = need(doc, input.id, ["text"]);
    if (input.patch.layer) checkLayer(doc, input.patch.layer);
    const next = unsetFields({ ...t, ...input.patch } as TextRecord, input.unset, ["kind", "id", "layer", "text", "x", "y", "height", "provenance"]);
    return change(doc, [edited(next, ctx)]);
  },
});

registerOperation({
  name: "text.delete",
  title: "Delete board text",
  description: "Remove board text by id (footprint texts belong to their footprint and are not removed here).",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 2,
  example: { ids: ["txt:f.title"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["text"]);
    return change(doc, [], ids);
  },
});

registerOperation({
  name: "graphic.add",
  title: "Add a board graphic",
  description:
    "Add a graphic on the board (silkscreen, fabrication, courtyard, user notes, edge cuts or a copper layer of the stackup): shape line or arc (start, end, and sweep for an arc), circle (center, radius), rect (center, width, height, rotation), polygon (closed points) or path (open points), with a stroke width in nanometers; filled: true fills closed shapes. Give a `handle` to learn its id.",
  input: z.object({ graphic: GraphicFields, handle: Handle.optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { graphic: { layer: "top_silkscreen", shape: "line", start: { x: 10_000_000, y: -13_500_000 }, end: { x: 18_000_000, y: -13_500_000 }, stroke_width: 150_000 }, handle: "g" },
  apply(doc, input, ctx) {
    checkLayer(doc, input.graphic.layer);
    checkGraphic(input.graphic);
    const id = ctx.issueId("graphic");
    if (doc.records.has(id)) throw new OpError(`${id} already exists`);
    const rec: GraphicRecord = { kind: "graphic", id, ...input.graphic, provenance: ctx.provenance };
    return change(doc, [rec], [], input.handle ? { [input.handle]: id } : undefined);
  },
});

registerOperation({
  name: "graphic.edit",
  title: "Edit a board graphic",
  description: "Change fields of a board graphic: `patch` sets fields, `unset` removes optional ones. The result must still have the fields its shape needs.",
  input: z.object({ id: ObjectId, patch: GraphicFields.partial(), unset: z.array(z.string()).max(20).optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { id: "gfx:f.logo_box", patch: { width: 9_000_000 } },
  apply(doc, input, ctx) {
    const g = need(doc, input.id, ["graphic"]);
    if (input.patch.layer) checkLayer(doc, input.patch.layer);
    const next = unsetFields({ ...g, ...input.patch } as GraphicRecord, input.unset, ["kind", "id", "layer", "shape", "stroke_width", "provenance"]);
    checkGraphic(next);
    return change(doc, [edited(next, ctx)]);
  },
});

registerOperation({
  name: "graphic.delete",
  title: "Delete board graphics",
  description: "Remove board graphics by id (footprint graphics belong to their footprint and are not removed here).",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 2,
  example: { ids: ["gfx:f.logo_box"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["graphic"]);
    return change(doc, [], ids);
  },
});

export {};

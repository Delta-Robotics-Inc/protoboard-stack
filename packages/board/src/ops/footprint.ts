/** Footprint placement operations: move, place, rotate, flip (contract section 8.2). */
import { z } from "zod";
import { boxCenter, emptyBox, footprintBox, rotateAbout, unionBox } from "../geometry.js";
import { Nm, ObjectId, Point, Side, type FootprintRec } from "../schema.js";
import { normAngle } from "../units.js";
import { planFootprintMove } from "../edit-plan.js";
import { change, distinct, edited, need, registerOperation } from "./registry.js";

const Ids = z.array(ObjectId).min(1).max(1000);
const Angle = z.number().int().min(-360_000).max(360_000);

registerOperation({
  name: "footprint.move",
  title: "Move footprints",
  description:
    "Translate footprints by dx, dy (nanometers). Pads, courtyard and footprint graphics move with them. `tracks` says what happens to copper attached to their pads: \"attached\" (the default) brings it along: tracks between moved pads and vias on them follow, tracks with one end on a moved pad stretch (with a 45 degree corner when needed), and a track that would short another net, or locked copper an agent may not change, is left in place and listed as detached in the report; \"stay\" leaves all copper where it is.",
  input: z.object({ ids: Ids, dx: Nm, dy: Nm, tracks: z.enum(["stay", "attached"]).optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["fp:power/ldo"], dx: 500_000, dy: 0 },
  apply(doc, input, ctx) {
    const ids = distinct(input.ids);
    if ((input.tracks ?? "attached") === "attached") {
      const plan = planFootprintMove(doc, ids, input.dx, input.dy, ctx);
      return change(doc, plan.puts, plan.removes, undefined, { followed: plan.followed, stretched: plan.stretched, detached: plan.detached });
    }
    const puts = ids.map((id) => {
      const fp = need(doc, id, ["footprint"]);
      return edited({ ...fp, x: fp.x + input.dx, y: fp.y + input.dy }, ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "footprint.place",
  title: "Place a footprint",
  description:
    "Set a footprint's absolute position (x, y in nanometers), rotation (millidegrees, counterclockwise) and side. Fields left out keep their value. Changing `side` here does not mirror the position; use footprint.flip for that.",
  input: z.object({ id: ObjectId, x: Nm.optional(), y: Nm.optional(), rotation: z.number().int().optional(), side: Side.optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { id: "fp:status/led1", x: 12_000_000, y: -9_000_000, rotation: 90_000 },
  apply(doc, input, ctx) {
    const fp = need(doc, input.id, ["footprint"]);
    const next: FootprintRec = { ...fp, ...(input.x !== undefined ? { x: input.x } : {}), ...(input.y !== undefined ? { y: input.y } : {}), ...(input.rotation !== undefined ? { rotation: normAngle(input.rotation) } : {}), ...(input.side ? { side: input.side } : {}) };
    return change(doc, [edited(next, ctx)]);
  },
});

const groupCenter = (fps: FootprintRec[]) => boxCenter(fps.reduce((b, fp) => unionBox(b, footprintBox(fp)), emptyBox()));

registerOperation({
  name: "footprint.rotate",
  title: "Rotate footprints",
  description:
    "Rotate footprints by `angle` millidegrees (counterclockwise seen from the top; 90000 is a quarter turn). `about`: \"each\" (default) turns each about its own origin, \"center\" turns the group about the center of its box, or a point {x, y} turns them about that point. Positions round to whole nanometers.",
  input: z.object({ ids: Ids, angle: Angle, about: z.union([z.enum(["each", "center"]), Point]).optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["fp:status/led1", "fp:status/led2"], angle: 90_000, about: "center" },
  apply(doc, input, ctx) {
    const fps = distinct(input.ids).map((id) => need(doc, id, ["footprint"]));
    const about = input.about ?? "each";
    const pivot = about === "each" ? undefined : about === "center" ? groupCenter(fps) : about;
    const puts = fps.map((fp) => {
      const at = pivot ? rotateAbout({ x: fp.x, y: fp.y }, pivot, input.angle) : { x: fp.x, y: fp.y };
      return edited({ ...fp, x: at.x, y: at.y, rotation: normAngle(fp.rotation + input.angle) }, ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "footprint.flip",
  title: "Flip footprints to the other side",
  description:
    "Move footprints to the other side of the board, mirrored left to right as seen from the top. \"each\" (default) flips each about its own origin (x, y stay); \"center\" mirrors the group about the vertical line through its box center. Rotation is negated; flipping twice restores the footprint.",
  input: z.object({ ids: Ids, about: z.enum(["each", "center"]).optional() }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["fp:sensor/c_dec"] },
  apply(doc, input, ctx) {
    const fps = distinct(input.ids).map((id) => need(doc, id, ["footprint"]));
    const cx = input.about === "center" ? groupCenter(fps).x : undefined;
    const puts = fps.map((fp) => edited({ ...fp, x: cx === undefined ? fp.x : 2 * cx - fp.x, side: fp.side === "top" ? ("bottom" as const) : ("top" as const), rotation: normAngle(-fp.rotation) }, ctx));
    return change(doc, puts);
  },
});

export {};

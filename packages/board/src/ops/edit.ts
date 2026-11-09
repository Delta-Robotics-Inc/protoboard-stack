/** Phase 2 editing operations: track.drag and track.route (contract docs/specs/pcb-editor/phase2-editing.md, 2.1). */
import { z } from "zod";
import { planRoute, planTrackDrag } from "../edit-plan.js";
import { CopperLayer, NetName, Nm, ObjectId, PositiveNm } from "../schema.js";
import { Handle } from "./copper.js";
import { change, lockedByDefault, OpError, registerOperation } from "./registry.js";

registerOperation({
  name: "track.drag",
  title: "Drag a track segment or via",
  description:
    "Drag one track segment or via by dx, dy (nanometers) with connected copper following. A segment slides along its normal (the part of dx, dy across it) and its neighbors keep their directions and re-form their corners; a via moves and each attached segment re-forms as two segments at the posture (45: diagonal and straight; 90: horizontal and vertical). Refused when the result would short another net. The report lists moved, added and removed segments.",
  input: z.object({ id: ObjectId, dx: Nm, dy: Nm, posture: z.enum(["45", "90"]).optional() }).strict(),
  audience: "all",
  phase: 2,
  example: { id: "via:f.gnd.1", dx: 300_000, dy: 200_000 },
  apply(doc, input, ctx) {
    const plan = planTrackDrag(doc, input.id, input.dx, input.dy, input.posture ?? "45", ctx);
    if (!plan.puts.length && !plan.removes.length) throw new OpError(`dragging ${input.id} by ${input.dx}, ${input.dy} moves nothing (a segment moves only across its own direction)`);
    return change(doc, plan.puts, plan.removes, undefined, { moved: plan.moved, added: plan.added, removed: plan.removed });
  },
});

const RoutePoint = z.object({ x: Nm, y: Nm, layer: CopperLayer }).strict();

registerOperation({
  name: "track.route",
  title: "Commit an interactive route",
  description:
    "Add a routed path in one operation: `points` in order, each with x, y (nanometers) and a copper layer. Two consecutive points on one layer make a segment of `width`; two consecutive points at the same x, y on different layers make a via there (`viaSpan` through: the whole stack, the default; pair: between those two layers) with the `via` diameters (default 0.6 mm outer, 0.3 mm hole). The reply maps handles <handle>_s0, _s1, ... to segment ids and <handle>_v0, ... to via ids (handle default r). A person's route is locked unless locked: false. The operation does not check clearance; the checks report it.",
  input: z
    .object({
      net: NetName,
      width: PositiveNm,
      points: z.array(RoutePoint).min(2).max(2000),
      via: z.object({ outer_diameter: PositiveNm, hole_diameter: PositiveNm }).strict().optional(),
      viaSpan: z.enum(["through", "pair"]).optional(),
      handle: Handle.optional(),
      locked: z.boolean().optional(),
    })
    .strict(),
  audience: "all",
  phase: 2,
  example: {
    net: "LED1",
    width: 250_000,
    points: [
      { x: 12_000_000, y: -6_000_000, layer: "top" },
      { x: 12_000_000, y: -7_000_000, layer: "top" },
      { x: 12_000_000, y: -7_000_000, layer: "bottom" },
      { x: 13_000_000, y: -8_000_000, layer: "bottom" },
    ],
  },
  apply(doc, input, ctx) {
    const { records, created } = planRoute(doc, input, ctx);
    return change(
      doc,
      records.map((r) => lockedByDefault(r, ctx, input.locked)),
      [],
      created,
    );
  },
});

export {};

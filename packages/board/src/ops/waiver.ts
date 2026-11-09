/**
 * Waivers (Phase 2, P2-E): a person's "not a problem" on a finding, with a reason, stored with the rules. The checks
 * leave a waived finding out of the findings and the counts and list it apart (`result.waived`). Only a person (or a
 * host acting for one) waives: an agent's call is refused `needs-person` and the service keeps it as a proposal.
 */
import { z } from "zod";
import { FindingId, ObjectId, WaiverRule, type WaiverRec } from "../schema.js";
import { change, distinct, need, OpError, registerOperation } from "./registry.js";

const Handle = z.string().regex(/^[A-Za-z0-9_]{1,40}$/);

const WaiverInput = z
  .object({
    finding: FindingId.optional(),
    rule: WaiverRule.optional(),
    objects: z.array(z.string().min(1).max(300)).max(50).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

registerOperation({
  name: "waiver.add",
  title: "Waive a finding",
  description:
    "Mark a check finding as not a problem, with a reason (1 to 500 characters): `finding` waives that finding id (f:<check>:<hash>, as board check lists it); `rule` (a rule id or a check name) with `objects` waives that rule's findings on exactly these objects (it survives the objects moving); `rule` alone waives every finding of that rule or check. The checks then leave waived findings out of the findings and counts and list them apart. Only a person waives: an agent's waiver is refused needs-person and kept as a proposal for a person to accept. The new id is waiver:<generated>; `handle` maps to it in the reply.",
  input: z.object({ waiver: WaiverInput, handle: Handle.optional() }).strict(),
  audience: "all",
  phase: 2,
  person: true,
  example: { waiver: { rule: "via_under_footprint", objects: ["fp:mcu/module", "via:f.gnd.1"], reason: "the module's ground via is stitched on purpose" }, handle: "w" },
  apply(doc, input, ctx) {
    const w = input.waiver;
    if (w.finding === undefined && w.rule === undefined) throw new OpError("a waiver names a finding, a rule, or both");
    const id = ctx.issueId("waiver");
    if (doc.records.has(id)) throw new OpError(`${id} exists already`);
    const objects = [...new Set(w.objects ?? [])].sort();
    for (const o of objects) if (!ObjectId.safeParse(o).success) throw new OpError(`${o} is not an object id`);
    const rec: WaiverRec = {
      kind: "waiver",
      id,
      ...(w.finding !== undefined ? { finding: w.finding } : {}),
      ...(w.rule !== undefined ? { rule: w.rule } : {}),
      objects,
      reason: w.reason,
      by: { kind: ctx.actor.kind, id: ctx.actor.id, ...(ctx.actor.name ? { name: ctx.actor.name } : {}) },
      ...(ctx.now ? { at: new Date(ctx.now()).toISOString() } : {}),
      provenance: ctx.provenance,
    };
    return change(doc, [rec], [], input.handle ? { [input.handle]: id } : undefined);
  },
});

registerOperation({
  name: "waiver.remove",
  title: "Remove waivers",
  description:
    "Remove waivers so their findings count again: `ids` (waiver:<key>, each must exist) and/or `findings` (finding ids: every waiver naming one of them; a finding with no waiver is an error). Only a person removes a waiver: an agent's call is refused needs-person and kept as a proposal.",
  input: z
    .object({ ids: z.array(ObjectId).min(1).max(1000).optional(), findings: z.array(FindingId).min(1).max(1000).optional() })
    .strict(),
  audience: "all",
  phase: 2,
  person: true,
  example: { findings: ["f:silk_to_pad:0a1b2c3d4e5f"] },
  exampleBefore: [{ op: "waiver.add", waiver: { finding: "f:silk_to_pad:0a1b2c3d4e5f", reason: "the silkscreen clips there by design" } }],
  apply(doc, input) {
    if (!input.ids && !input.findings) throw new OpError("name the waivers to remove: ids, findings, or both");
    const out = new Set<string>();
    for (const id of distinct(input.ids ?? [])) out.add(need(doc, id, ["waiver"]).id);
    for (const f of distinct(input.findings ?? [])) {
      let n = 0;
      for (const r of doc.records.values())
        if (r.kind === "waiver" && r.finding === f) {
          out.add(r.id);
          n++;
        }
      if (!n) throw new OpError(`no waiver names finding ${f}`);
    }
    return change(doc, [], [...out]);
  },
});

export {};

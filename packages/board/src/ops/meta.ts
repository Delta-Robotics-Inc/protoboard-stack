/** Locks, rules, net classes and the system record operations (contract sections 5, 6, 8.2). */
import { z } from "zod";
import { AnyRecord, idMatchesKind, LOCKABLE_KINDS, NetclassRec, ObjectId, RuleRec, type BoardRecord } from "../schema.js";
import { change, distinct, need, OpError, registerOperation } from "./registry.js";

const Ids = z.array(ObjectId).min(1).max(5000);

function lockable(doc: Parameters<typeof need>[0], id: string): BoardRecord {
  const r = doc.records.get(id);
  if (!r) throw new OpError(`no object ${id} on this board`);
  if (!LOCKABLE_KINDS.has(r.kind)) throw new OpError(`${id} is a ${r.kind}; only footprints, tracks, vias, zones, keep-outs, the outline, cutouts, graphics and text lock`);
  return r;
}

registerOperation({
  name: "lock",
  title: "Lock objects",
  description: "Lock objects so agents and routers cannot move, change or delete them (a person still can). Objects already locked are left as they are.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["fp:mcu/module"] },
  apply(doc, input) {
    const puts = distinct(input.ids)
      .map((id) => lockable(doc, id))
      .filter((r) => !(r as { locked?: true }).locked)
      .map((r) => ({ ...r, locked: true as const }) as BoardRecord);
    return change(doc, puts);
  },
});

registerOperation({
  name: "unlock",
  title: "Unlock objects",
  description: "Unlock objects so routers and agents may change them. Only a person (or a host acting for one) unlocks; an agent's unlock is refused with needs-person in Phase 1 and becomes a proposal in Phase 2.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["trk:f.vbus.1"] },
  apply(doc, input) {
    const puts = distinct(input.ids)
      .map((id) => lockable(doc, id))
      .filter((r) => (r as { locked?: true }).locked)
      .map((r) => {
        const { locked: _l, ...rest } = r as BoardRecord & { locked?: true };
        return rest as BoardRecord;
      });
    return change(doc, puts);
  },
});

const RuleInput = RuleRec.omit({ kind: true, provenance: true }).extend({ provenance: RuleRec.shape.provenance }).strict();

registerOperation({
  name: "rule.set",
  title: "Set a design rule",
  description:
    "Create or replace a design rule by id (rule:<name>). tier: floor (fab limit, error), target (design default), policy (preference with a cost) or no_go (prohibition). check names what is measured (clearance, track_width, via_diameter, ...); applies narrows it to nets, classes, layers, an object pair or a region; min, max and preferred are nanometers.",
  input: z.object({ rule: RuleInput }).strict(),
  audience: "all",
  phase: 1,
  example: { rule: { id: "rule:target.power_width", tier: "target", check: "track_width", applies: { classes: ["power"] }, min: 400_000, preferred: 500_000 } },
  apply(doc, input, ctx) {
    if (!idMatchesKind(input.rule.id, "rule")) throw new OpError(`${input.rule.id} is not a rule:<name> id`);
    const old = doc.records.get(input.rule.id);
    if (old && old.kind !== "rule") throw new OpError(`${input.rule.id} is a ${old.kind}`);
    const rec = { kind: "rule" as const, ...input.rule, provenance: input.rule.provenance ?? ctx.provenance };
    return change(doc, [rec]);
  },
});

registerOperation({
  name: "rule.delete",
  title: "Delete design rules",
  description: "Remove design rules by id.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["rule:policy.via_under_module"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["rule"]);
    return change(doc, [], ids);
  },
});

const NetclassInput = NetclassRec.omit({ kind: true, provenance: true }).extend({ provenance: NetclassRec.shape.provenance }).strict();

registerOperation({
  name: "netclass.set",
  title: "Set a net class",
  description: "Create or replace a net class by id (class:<name>): explicit member nets and glob patterns (* and ?). Rules refer to classes by name in applies.classes.",
  input: z.object({ netclass: NetclassInput }).strict(),
  audience: "all",
  phase: 1,
  example: { netclass: { id: "class:usb", name: "usb", nets: ["USB_DP", "USB_DN"] } },
  apply(doc, input, ctx) {
    if (!idMatchesKind(input.netclass.id, "netclass") || input.netclass.id !== `class:${input.netclass.name}`) throw new OpError(`a net class id is class:<name> (${input.netclass.id}, name ${input.netclass.name})`);
    const old = doc.records.get(input.netclass.id);
    if (old && old.kind !== "netclass") throw new OpError(`${input.netclass.id} is a ${old.kind}`);
    return change(doc, [{ kind: "netclass" as const, ...input.netclass, provenance: input.netclass.provenance ?? ctx.provenance }]);
  },
});

registerOperation({
  name: "netclass.delete",
  title: "Delete net classes",
  description: "Remove net classes by id. Rules naming the class stop matching.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 1,
  example: { ids: ["class:power"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) need(doc, id, ["netclass"]);
    return change(doc, [], ids);
  },
});

registerOperation({
  name: "record.put",
  title: "Write whole records",
  description: "System operation: write whole records (create or replace by id). Importers, generators, undo and journal recovery use it; it is never offered to agents as a tool.",
  input: z.object({ records: z.array(AnyRecord).min(1).max(100_000) }).strict(),
  audience: "system",
  phase: 1,
  example: { records: [{ kind: "text", id: "txt:f.rev", layer: "top_silkscreen", text: "rev B", x: 15_000_000, y: -13_000_000, height: 1_000_000, provenance: { by: "system" } }] },
  apply(doc, input) {
    const seen = new Set<string>();
    for (const r of input.records) {
      if (seen.has(r.id)) throw new OpError(`${r.id} is written twice`);
      seen.add(r.id);
      if (!idMatchesKind(r.id, r.kind)) throw new OpError(`${r.id} is not a valid id for a ${r.kind}`);
    }
    return change(doc, input.records as BoardRecord[]);
  },
});

registerOperation({
  name: "record.remove",
  title: "Remove records",
  description: "System operation: remove records by id, whatever their kind. Importers, undo and journal recovery use it; never offered to agents.",
  input: z.object({ ids: Ids }).strict(),
  audience: "system",
  phase: 1,
  example: { ids: ["txt:f.title"] },
  apply(doc, input) {
    const ids = distinct(input.ids);
    for (const id of ids) if (!doc.records.has(id)) throw new OpError(`no object ${id} on this board`);
    return change(doc, [], ids);
  },
});

export {};

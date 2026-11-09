/** Test cases for the waiver operations (merged into OP_CASES). */
import { expect } from "vitest";
import type { WaiverRec } from "../src/index.js";
import type { OpCase } from "./op-cases.js";

/** A waiver already on the board (cases that remove one start from it). */
export const SAMPLE_WAIVER: WaiverRec = {
  kind: "waiver",
  id: "waiver:sample.1",
  finding: "f:silk_to_pad:0a1b2c3d4e5f",
  objects: [],
  reason: "the silkscreen clips there by design",
  by: { kind: "human", id: "user" },
  at: "2026-11-09T00:00:00.000Z",
  provenance: { by: "hand" },
};
const { finding: _f, ...noFinding } = SAMPLE_WAIVER;
const SECOND: WaiverRec = { ...noFinding, id: "waiver:sample.2", rule: "via_under_footprint", objects: ["fp:mcu/module", "via:f.gnd.1"] };
const SETUP = [{ op: "record.put", records: [SAMPLE_WAIVER, SECOND] }];

export const OP_CASES_WAIVER: Record<string, OpCase[]> = {
  "waiver.add": [
    {
      name: "waives one finding with a reason, as the person",
      call: { op: "waiver.add", waiver: { finding: "f:clearance:00aa11bb22cc", reason: " checked by hand: the fab's own rule allows it " }, handle: "w" },
      check(_b, a, created) {
        const w = a.records.get(created.w) as WaiverRec;
        expect(w.id).toMatch(/^waiver:/);
        expect([w.kind, w.finding, w.rule, w.objects, w.reason, w.by.kind, w.provenance.by]).toEqual(["waiver", "f:clearance:00aa11bb22cc", undefined, [], "checked by hand: the fab's own rule allows it", "human", "hand"]);
      },
    },
    {
      name: "a rule's findings on exactly these objects (sorted, repeats dropped)",
      call: { op: "waiver.add", waiver: { rule: "rule:policy.via_under_module", objects: ["via:f.gnd.1", "fp:mcu/module", "via:f.gnd.1"], reason: "stitching on purpose" }, handle: "w" },
      check(_b, a, created) {
        const w = a.records.get(created.w) as WaiverRec;
        expect([w.rule, w.objects, w.finding]).toEqual(["rule:policy.via_under_module", ["fp:mcu/module", "via:f.gnd.1"], undefined]);
      },
    },
    {
      name: "a host acting for a person records the host",
      actor: "host",
      call: { op: "waiver.add", waiver: { rule: "silk_to_pad", reason: "silkscreen is clipped at the fab" }, handle: "w" },
      check(_b, a, created) {
        expect((a.records.get(created.w) as WaiverRec).by.kind).toBe("host");
      },
    },
    { name: "names neither a finding nor a rule", call: { op: "waiver.add", waiver: { objects: ["fp:mcu/module"], reason: "why not" } }, fails: "names a finding, a rule, or both", check() {} },
    { name: "an object that is not an id", call: { op: "waiver.add", waiver: { rule: "clearance", objects: ["U1"], reason: "fine" } }, fails: "not an object id", check() {} },
  ],
  "waiver.remove": [
    {
      name: "by id",
      before: SETUP,
      call: { op: "waiver.remove", ids: ["waiver:sample.2"] },
      check(b, a) {
        expect(b.records.has("waiver:sample.2")).toBe(true);
        expect(a.records.has("waiver:sample.2")).toBe(false);
        expect(a.records.has("waiver:sample.1")).toBe(true);
      },
    },
    {
      name: "by the finding it names",
      before: SETUP,
      call: { op: "waiver.remove", findings: ["f:silk_to_pad:0a1b2c3d4e5f"] },
      check(_b, a) {
        expect(a.records.has("waiver:sample.1")).toBe(false);
        expect(a.records.has("waiver:sample.2")).toBe(true);
      },
    },
    { name: "a rule is not a waiver", call: { op: "waiver.remove", ids: ["rule:floor.clearance"] }, fails: "not a waiver", check() {} },
    { name: "a finding nobody waived", call: { op: "waiver.remove", findings: ["f:clearance:00aa11bb22cc"] }, fails: "no waiver names", check() {} },
    { name: "names nothing", call: { op: "waiver.remove" }, fails: "name the waivers", check() {} },
  ],
};

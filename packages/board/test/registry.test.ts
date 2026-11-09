/**
 * The registry's own guarantees (contract section 8): every registered operation has an input schema, a title, a
 * description, an example that runs on the Airnode C3 fixture, and at least one test case. A new operation
 * without them fails here.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { createEngine, listOperations, PLANNED_OPERATIONS, type Actor } from "../src/index.js";
import { OP_CASES } from "./op-cases.js";

const HOST: Actor = { kind: "host", id: "test-host" };
const PERSON: Actor = { kind: "human", id: "user" };

describe("operation registry", () => {
  const ops = listOperations();

  it("registers the Phase 1 set", () => {
    const names = ops.map((o) => o.name);
    for (const n of ["footprint.move", "footprint.rotate", "footprint.flip", "track.add", "track.move", "track.delete", "via.add", "via.move", "via.delete", "net.set", "zone.add", "zone.edit", "outline.set", "lock", "unlock", "rule.set"]) expect(names).toContain(n);
  });

  for (const def of ops) {
    describe(def.name, () => {
      it("has a zod object schema, a title and a description", () => {
        expect(def.input).toBeInstanceOf(z.ZodObject);
        expect(def.title.length).toBeGreaterThan(5);
        expect(def.description.length).toBeGreaterThanOrEqual(15);
        expect(["all", "system"]).toContain(def.audience);
      });
      it("has a test case", () => {
        expect(OP_CASES[def.name]?.length ?? 0, `add a case for ${def.name} to test/op-cases.ts`).toBeGreaterThan(0);
        expect(OP_CASES[def.name].some((c) => !c.fails), `${def.name} needs a case that succeeds`).toBe(true);
      });
      it("has an example that applies to the fixture", () => {
        expect(def.input.safeParse(def.example).success).toBe(true);
        const engine = createEngine(airnodeC3(), { epoch: "test01" });
        const r = engine.apply({ batchId: `example-${def.name}`, label: `run the ${def.name} example`, ops: [{ op: def.name, ...def.example }] }, def.audience === "system" ? HOST : PERSON);
        expect(r.status, JSON.stringify(r)).toBe("applied");
        if (r.status === "applied") expect(r.changed.length).toBeGreaterThan(0);
      });
    });
  }

  it("has no test cases for operations that do not exist", () => {
    const names = new Set(ops.map((o) => o.name));
    for (const n of Object.keys(OP_CASES)) expect(names.has(n), n).toBe(true);
  });

  it("lists Phase 2 operations that are not registered (except footprint.move's attached mode)", () => {
    const names = new Set(ops.map((o) => o.name));
    for (const p of PLANNED_OPERATIONS) if (p.name !== "footprint.move") expect(names.has(p.name), p.name).toBe(false);
  });

  it("keeps system operations out of agents' reach", () => {
    const engine = createEngine(airnodeC3(), { epoch: "test02" });
    const r = engine.apply({ batchId: "sys-1", label: "agent writes a whole record", ops: [{ op: "record.remove", ids: ["txt:f.title"] }] }, { kind: "agent", id: "a1" });
    expect(r.status).toBe("invalid");
  });
});

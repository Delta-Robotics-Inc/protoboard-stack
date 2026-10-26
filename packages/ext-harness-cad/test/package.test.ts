/**
 * ext-harness-cad's Manufacturing Package contributions on the quadcopter's
 * cables: preparation and terminations in the work order (from the cut list
 * and the routed manifest) and routing checks in the test plan.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import type { SectionContribution } from "@protoboardai/ext-release";
import { testContexts } from "@protoboardai/ext-release/testing";
import { testPlan, workOrder } from "../ops/package.ts";

const QUAD = join(fileURLToPath(new URL(".", import.meta.url)), "../../../examples/quadcopter-5in");
const p = await loadProject(QUAD, { checks: false });
const t = testContexts(p, { units: ["stack"] });
const one = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x[0] : x)!;
const table = (c: SectionContribution, caption: string) => {
  const b = c.blocks.find((x) => x.kind === "table" && x.caption === caption);
  return b?.kind === "table" ? (b.rows as Record<string, unknown>[]) : [];
};

describe("package:work-order", () => {
  it("prepares each cable of the unit: cut length against the supplied length, strip, conductors, lay, bend radius", async () => {
    const c = one(await workOrder(t.context("system", "work-order")));
    expect(c).toMatchObject({ title: "Cables", order: 40 });
    const prep = table(c, "Cable preparation");
    expect(prep).toHaveLength(9);
    expect(prep.find((r) => r.cable === "Motor 1 phase leads (Rear-right)")).toMatchObject({ qty: 1, cut: "78 mm (of 150)", strip: "3 mm", wire: "3 × 20 AWG", lay: "twisted, 24 mm pitch", bend: "5.5 mm" });
    // the stack's own cable is in the stack unit only
    expect(prep.some((r) => r.cable === "FC/ESC SH1.0 8-pin cable")).toBe(false);
    expect(table(one(await workOrder(t.context("stack", "work-order"))), "Cable preparation").map((r) => r.cable)).toEqual(["FC/ESC SH1.0 8-pin cable"]);
  });

  it("says how each end is terminated and onto what", async () => {
    const ends = table(one(await workOrder(t.context("system", "work-order"))), "Terminations");
    const m1 = ends.filter((r) => r.cable === "Motor 1 phase leads (Rear-right)");
    expect(m1.map((r) => [r.onto, String(r.how).split(";")[0]])).toEqual([
      ["arm_rr.motor_leads", "fixed to the part (its own leads): nothing to terminate"],
      ["stack.motor_1_pads", "strip, tin, solder to the pads"],
    ]);
  });
});

describe("package:test-plan", () => {
  it("checks each routed cable: bend radius, clearance, slack", async () => {
    const c = one(await testPlan(t.context("system", "test-plan")));
    const t1 = c.blocks.find((b) => b.kind === "table");
    const row = t1?.kind === "table" ? (t1.rows as Record<string, unknown>[]).find((r) => r.cable === "Motor 1 phase leads (Rear-right)") : undefined;
    expect(row).toMatchObject({ bend: "no bend tighter than 5.5 mm" });
    expect(String(row?.slack)).toMatch(/^8\.1 mm taken up \(bow\)/);
  });
});

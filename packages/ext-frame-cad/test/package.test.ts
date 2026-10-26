/**
 * ext-frame-cad's Manufacturing Package contributions on the quadcopter's
 * plates (final assembly unit): the cut order in the work order and its
 * inspection in the test plan, from the module, cad.config.ts, the
 * generator parameters and the standard outputs.
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
const t = testContexts(p, { units: ["stack"], build: 2 });
const one = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x[0] : x)!;
const rows = (c: SectionContribution, heading: string) => {
  const i = c.blocks.findIndex((b) => b.kind === "heading" && b.text === heading);
  const kv = c.blocks.slice(i).find((b) => b.kind === "keyvalues");
  return Object.fromEntries((kv?.kind === "keyvalues" ? kv.rows : []).map((r) => [r.label, r.value]));
};

describe("package:work-order", () => {
  it("orders each plate: process, carbon stock, quantities by DXF layer, hole sizes, router bit, edge finish", async () => {
    const c = one(await workOrder(t.context("system", "work-order")));
    expect(c).toMatchObject({ title: "Cut parts", order: 30 });
    const frame = rows(c, "5-inch quadcopter frame (custom)");
    expect(frame).toMatchObject({
      Process: "CNC routing from sheet",
      Material: "3K woven carbon fibre / epoxy laminate",
      "Stock: plate": "5 mm sheet",
      "Stock: clamp_camera_mount": "2 mm sheet",
      Quantity: "2 × plate, 4 × clamp_camera_mount",
      "Holes M3": "Ø3.2 mm, 24 per plate",
    });
    expect(frame["Router bit"]).toBe("≤ 5 mm");
    expect(rows(c, "5-inch frame top plate (custom)")["Router bit"]).toBe("≤ 3 mm");
    expect(frame["Not in the DXF"]).toMatch(/^pads: raised mating pads/);
    expect(frame.Edges).toMatch(/seal the cut edges/);
  });

  it("contributes nothing to a unit with no plates", async () => {
    expect(await workOrder(t.context("stack", "work-order"))).toBeUndefined();
  });
});

describe("package:test-plan", () => {
  it("inspects what the cut order asks for: hole sizes by pin gauge, sealed edges, edge distance", async () => {
    const c = one(await testPlan(t.context("system", "test-plan")));
    const table = c.blocks.find((b) => b.kind === "table");
    const checks = table?.kind === "table" ? table.rows.map((r) => ("check" in r ? r.check : "")) : [];
    expect(checks).toContain("Hole size M3: 5-inch quadcopter frame (custom)");
    expect(checks).toContain("Edges: 5-inch frame top plate (custom)");
    expect(table?.kind === "table" && table.rows.find((r) => "how" in r && r.how === "Pin gauge Ø3.2 mm")).toBeTruthy();
  });
});

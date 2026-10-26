/**
 * ext-drone's flight-controller configuration in the quadcopter's
 * Manufacturing Package (units: the flight stack and final assembly),
 * without Chrome (@protoboardai/ext-release/testing):
 *
 *   - flashing and loading are contributed as "configure" operations, and
 *     the release's work order numbers them with its own;
 *   - the root work order runs the power-up checks, the configuration and
 *     the rest of the bench test (motors spun with the props off) before the
 *     battery is strapped on and the propellers are fitted, then a final
 *     check with the functional checks.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import type { SectionContribution, Step } from "@protoboardai/ext-release";
import { testContexts } from "@protoboardai/ext-release/testing";
import { BASELINE } from "../../ext-release/lib/sections/baseline.ts";
import { workOrder } from "../ops/package.ts";

const QUAD = join(fileURLToPath(new URL(".", import.meta.url)), "../../../examples/quadcopter-5in");
const p = await loadProject(QUAD, { checks: false });
const t = testContexts(p, { units: ["stack"] });
const one = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x[0] : x)!;
const RELEASE = "@protoboardai/ext-release";
const DRONE = "@protoboardai/ext-drone";

describe("package:work-order", () => {
  it("contributes flashing and loading as configure operations, with the file and its details", async () => {
    const c = one(await workOrder(t.context("system", "work-order")));
    expect(c.operations?.map((o) => [o.stage, o.title])).toEqual([
      ["configure", "Flash the flight controller"],
      ["configure", "Load the flight controller configuration"],
    ]);
    expect(c.blocks.some((b) => b.kind === "steps")).toBe(false);
    expect(c.files?.[0]).toMatchObject({ path: "files/firmware/betaflight-cli.txt", role: "firmware-config" });
    expect(await workOrder(t.context("stack", "work-order"))).toBeUndefined();
  });

  it("the root work order tests and configures with the props off, then fits the battery and the propellers, then the final check", async () => {
    const ops = one(await workOrder(t.context("system", "work-order"))).operations!.map((o) => ({ ...o, extension: DRONE }));
    const c = one(await BASELINE["work-order"](t.context("system", "work-order", [RELEASE, DRONE], ops)));
    const steps = c.blocks.flatMap((b) => (b.kind === "steps" ? b.steps : [])) as Step[];
    const at = (title: string) => steps.findIndex((s) => s.title === title);
    const titles = steps.map((s) => s.title);
    expect(titles.slice(-7)).toEqual(["Power up the product", "Flash the flight controller", "Load the flight controller configuration", "Test the product", "Strap on the battery", "Fit the propellers", "Final check"]);
    // every assembly step that needs no test comes before the power-up
    expect(at("Mount and connect the GNSS")).toBeLessThan(at("Power up the product"));
    // the bench test spins the motors props off: it and the configuration come before the propellers
    const test = steps[at("Test the product")];
    expect(test.test).toMatch(/^BU-\d+–BU-\d+$/);
    expect(at("Fit the propellers")).toBeGreaterThan(at("Test the product"));
    expect(at("Fit the propellers")).toBeGreaterThan(at("Load the flight controller configuration"));
    expect(steps[at("Power up the product")].notes?.[0].text).toMatch(/"Strap on the battery" and "Fit the propellers" come after this test/);
    expect(steps[at("Fit the propellers")].notes?.[0].text).toMatch(/^This step follows the bench test and configuration \(it fits propellers/);
    expect(steps[at("Flash the flight controller")].trace).toContain(`contributed by ${DRONE} (details below)`);
    // the functional checks need the finished product
    expect(steps[at("Final check")].test).toBe("FN-1–FN-9");
    expect(steps.map((s) => s.id)).toEqual(steps.map((_, i) => `OP ${(i + 1) * 10}`));
  });

  it("without contributed configuration the bench test is one operation, still before the propellers", async () => {
    const c = one(await BASELINE["work-order"](t.context("system", "work-order")));
    const titles = (c.blocks.flatMap((b) => (b.kind === "steps" ? b.steps : [])) as Step[]).map((s) => s.title);
    expect(titles.slice(-4)).toEqual(["Test the product", "Strap on the battery", "Fit the propellers", "Final check"]);
  });
});

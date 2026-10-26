/**
 * The IMU tile board in the Manufacturing Package, without building it: its
 * standard outputs are stood in by a pick-and-place file and empty Gerber
 * and drill files (the fab order reads their names and rows, not geometry).
 *
 *   - ext-tscircuit's fabrication and assembly order (package:work-order):
 *     profile with its defaults, finish chosen by the leadless parts,
 *     stack-up, sides from pnp.csv, files;
 *   - the release's test plan for a unit with a custom board: bring-up from
 *     the board's nets (input at the edge, rails), the supply budget,
 *     programming through the exported SWD port and the I2C scan with the
 *     BMI270's address; its work order assembles the board before testing.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, type Project } from "@protoboardai/core";
import type { SectionContribution } from "@protoboardai/ext-release";
import { testContexts, type TestContexts } from "@protoboardai/ext-release/testing";
import { workOrder } from "../ops/package.ts";
import { fabProfile } from "../ops/package.ts";
import { BASELINE } from "../../ext-release/lib/sections/baseline.ts";
import { makeProject } from "./fixture.ts";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-package");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let p: Project;
let t: TestContexts;
beforeAll(async () => {
  const dir = await makeProject(join(TMP, "imu-tile"));
  const out = join(dir, "src/boards/imu/out");
  mkdirSync(join(out, "gerber"), { recursive: true });
  for (const f of ["F_Cu.gbr", "B_Cu.gbr", "F_Mask.gbr", "Edge_Cuts.gbr", "plated.drl"]) writeFileSync(join(out, "gerber", f), "");
  const rows = ["u1,0,0,0,top", "u2,5,5,0,top", "u3,-5,5,90,top", "c1,-8,0,0,bottom", "j1,0,11.5,0,top"];
  writeFileSync(join(out, "pnp.csv"), ["instance,x_mm,y_mm,rotation_deg,side", ...rows].join("\n") + "\n");
  p = await loadProject(dir, { checks: false });
  t = testContexts(p, {}, "1.0.0");
});

const one = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x[0] : x)!;

describe("ext-tscircuit package:work-order", () => {
  it("states the fab profile, the finish the leadless parts need, the stack-up, the assembly sides and the files", async () => {
    const f = fabProfile(p, p.capabilities[0]);
    expect(f).toMatchObject({ layers: 2, thickness_mm: 1, finish: "ENIG", assembly: "fab", placed: 5, sides: { top: 4, bottom: 1 } });
    expect(f.leadless).toEqual(["u1 (QFN-56)", "u2 (LGA-14)"]);
    expect(f.gerbers).toHaveLength(4);
    const c = one(await workOrder(t.context("system", "work-order")));
    expect(c).toMatchObject({ title: "Boards", order: 20 });
    const kv = c.blocks.find((b) => b.kind === "keyvalues");
    const rows = Object.fromEntries((kv?.kind === "keyvalues" ? kv.rows : []).map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Quantity: "1 board", Layers: "2 copper", Thickness: "1 mm", Finish: "ENIG", Assembly: "by the fab: 5 placements (4 top, 1 bottom)" });
    expect(rows.Files).toBe("files/boards/imu-tile-board/gerber/ (4 layers, 1 drill), bom.csv, pnp.csv, board.step");
    // the fixture has unverified land patterns, so the order opens with the provider's hold
    expect(rows["Land patterns"]).toMatch(/^\d+ of \d+ not verified$/);
    const notes = c.blocks.find((b) => b.kind === "table" && /fabrication notes/.test(b.caption ?? ""));
    expect(notes?.kind === "table" && String((notes.rows[0] as Record<string, unknown>).note)).toMatch(/^HOLD: do not order this revision\. \d+ of \d+ land patterns are not verified/);
    const stack = c.blocks.find((b) => b.kind === "table" && /stack-up/.test(b.caption ?? ""));
    expect(stack?.kind === "table" && stack.rows.map((r) => ("layer" in r ? r.layer : ""))).toEqual(["Top copper", "Core", "Bottom copper"]);
  });

  it("a finish in circuit.config.ts wins over the default", async () => {
    const b = { ...p.capabilities[0], constraints: { ...p.capabilities[0].constraints, finish: "lead-free HASL" } };
    expect(fabProfile(p, b)).toMatchObject({ finish: "lead-free HASL", finishWhy: "circuit.config.ts" });
  });
});

describe("the release's test plan and work order for a unit with a board", () => {
  it("brings the board up from its nets: power at the edge, rails, budget, SWD, the BMI270 at 0x68", async () => {
    const c = one(await BASELINE["test-plan"](t.context("system", "test-plan")));
    const table = (title: string) => {
      const i = c.blocks.findIndex((b) => b.kind === "heading" && b.text === title);
      const b = c.blocks.slice(i).find((x) => x.kind === "table");
      return (b?.kind === "table" ? b.rows : []) as Record<string, string>[];
    };
    expect(table("First-article inspection").map((r) => r.id)).toEqual(["FAI-1", "FAI-2"]);
    const bu = table("Bring-up");
    expect(bu.map((r) => r.check.split(":")[0])).toEqual(["Before power", "Power up", "Rail VIN", "Rail 3V3", "Rail 1V1", "Current against the power budget", "Programming and boot", "Bus scan"]);
    expect(bu[1].how).toBe("Bench supply into IMU tile board (test fixture) net VIN, at its edge connector, current limit set low: start at a low voltage and raise slowly to the voltage it sees in the product, within its 2.5–5.5 V range");
    expect(bu.find((r) => r.check.startsWith("Rail 3V3"))!.pass).toBe("3.3 V ± 5 % (3.13–3.46 V; tolerance assumed)");
    expect(bu.find((r) => r.check.startsWith("Current"))!.pass).toMatch(/imu-tile-board u3:vout: under its 2 A rating at 3\.3 V \(no load on it states a draw\)/);
    expect(bu.find((r) => r.check.startsWith("Programming"))!.check).toMatch(/SWD/);
    expect(bu.find((r) => r.check.startsWith("Bus scan"))!.pass).toMatch(/^answers at 0x68 \(Bosch BMI270\)/);
    // the board's nets are its copper: no assembly step, so no joint checks
    const joints = c.blocks.findIndex((b) => b.kind === "heading" && b.text === "Fits and joints");
    expect(c.blocks[joints + 1]).toEqual({ kind: "paragraph", text: "This unit makes no joints." });
    expect(c.files?.[0]).toMatchObject({ path: "files/test/test-record.csv", role: "test" });
    expect(String(c.files?.[0].content).split("\n")[0]).toBe("release,unit,serial,id,group,check,subject,pass_criterion,result,measured,instrument,by,date,note");
  });

  it("assembles the board before testing it, and points at the provider's order", async () => {
    const c = one(await BASELINE["work-order"](t.context("system", "work-order", ["@protoboardai/ext-release", "@protoboardai/ext-tscircuit"])));
    const steps = c.blocks.flatMap((b) => (b.kind === "steps" ? b.steps : []));
    expect(steps.map((s) => s.title)).toEqual(["Kit and inspect incoming parts", "Assemble the IMU tile board (test fixture)", "Test the product"]);
    expect(steps.map((s) => s.id)).toEqual(["OP 10", "OP 20", "OP 30"]);
    expect(steps[1].test).toBe("BU-1…BU-8 (bring-up)");
    expect(steps[0].test).toBe("FAI-1…FAI-2");
    const fab = c.blocks.find((b) => b.kind === "table" && b.columns.some((x) => x.key === "details"));
    expect(fab?.kind === "table" && fab.rows[0]).toMatchObject({ details: "below, from @protoboardai/ext-tscircuit" });
  });

  it("adds the project's own test steps (release.checks) after the generated bring-up", async () => {
    const own = { ...p, config: { ...p.config, release: { checks: [{ check: "Display", subject: "the display", how: "draw colour bars", pass: "full image", record: "pass or fail", trace: "docs/x.md" }, { group: "function" as const, check: "Wrist", subject: "worn", how: "wear it", pass: "fits", record: "pass or fail" }] } } };
    const c = one(await BASELINE["test-plan"](testContexts(own, {}, "1.0.0").context("system", "test-plan")));
    const i = c.blocks.findIndex((b) => b.kind === "heading" && b.text === "Bring-up");
    const b = c.blocks.slice(i).find((x) => x.kind === "table");
    const rows = (b?.kind === "table" ? b.rows : []) as Record<string, string>[];
    expect(rows.at(-1)).toMatchObject({ id: "BU-9", check: "Display: the display", pass: "full image" });
  });
});

/**
 * ext-docs' Manufacturing Package sections on the quadcopter (units: the
 * flight stack and final assembly), without Chrome: figures are recorded,
 * not rendered (@protoboardai/ext-release/testing).
 *
 *   - the unit plan: each unit covers the links it makes and no other; the
 *     two units together cover every mate and connection of the system, in
 *     the doc spec's order;
 *   - the assembly guide: kit, illustrated steps lettered like their parts,
 *     connection tables, torques, the routed cables in the wiring figures;
 *   - the spec sheet: what is designed for each unit, from the providers'
 *     standard outputs;
 *   - the steps that follow the bench test (propellers, the battery) planned
 *     last, and a module unit built several times (the arm) whose builds
 *     differ: the propeller's hand listed per build;
 *   - the actions and the test plan's joint check count the same conductors.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import type { Block, SectionContribution, Step } from "@protoboardai/ext-release";
import { testContexts } from "@protoboardai/ext-release/testing";
import { buildContext } from "../lib/context.ts";
import { planSteps } from "../lib/docs/assembly.ts";
import { assembly } from "../lib/package/assembly.ts";
import { unitPlan } from "../lib/package/plan.ts";
import { spec } from "../lib/package/spec.ts";
import { unitTests } from "../../ext-release/lib/sections/tests.ts";

const QUAD = join(fileURLToPath(new URL(".", import.meta.url)), "../../../examples/quadcopter-5in");
const p = await loadProject(QUAD, { checks: false });
const t = testContexts(p, { units: ["stack"] });
const contributions = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x : x ? [x] : []);
const blocksOf = (x: SectionContribution | SectionContribution[] | undefined) => contributions(x).flatMap((c) => c.blocks);
const stepsOf = (bs: Block[]) => bs.flatMap((b) => (b.kind === "steps" ? b.steps : [])) as Step[];

describe("unit plan", () => {
  it("each unit covers its own links; together they cover the system, in the doc spec's order", async () => {
    const [stack, root] = t.units;
    const s = await unitPlan(p, stack);
    const r = await unitPlan(p, root);
    const links = (plan: typeof s) => plan.steps.flatMap((x) => [...x.plan.mates.map((m) => m.linkId), ...x.plan.wiring.map((w) => w.linkId)]);
    expect(links(s)).toEqual(["stack/fc_esc_plug_fc", "stack/fc_esc_plug_esc"]);
    expect(links(r).some((l) => l.startsWith("stack/"))).toBe(false);
    const all = planSteps({ ctx: await buildContext(p) }).flatMap((x) => [...x.mates.map((m) => m.linkId), ...x.wiring.map((w) => w.linkId)]);
    expect([...links(s), ...links(r)].sort()).toEqual([...all].sort());
    expect(r.steps.map((x) => x.id)).toEqual(["motors", "stack", "motor-wiring", "air-unit", "power", "video-wiring", "receiver", "top-plate", "gnss", "battery", "props"]);
    // the stack unit plugs the cable (its own doc spec step), final assembly mounts the tested stack
    expect(s.steps[0]).toMatchObject({ id: "stack-cable", kind: "connect", cables: ["stack/sh8_cable"] });
    expect(s.steps[0].split).toBeFalsy();
    expect(r.steps[1]).toMatchObject({ id: "stack", kind: "mate" });
    expect(r.steps[1].torque).toMatch(/N·m/);
    expect(r.steps[2]).toMatchObject({ kind: "connect", solder: true });
    expect(r.steps[2].cables.sort()).toEqual(["arm_fl_leads", "arm_fr_leads", "arm_rl_leads", "arm_rr_leads"]);
    expect(r.steps[2].tools).toContain("soldering iron");
  });
});

describe("package:assembly", () => {
  it("final assembly: kit, then illustrated steps lettered like their parts, with tables, torques and a coverage table", async () => {
    const out = await assembly(t.context("system", "assembly"));
    const bs = blocksOf(out);
    const kit = bs.find((b) => b.kind === "kit");
    expect(kit?.kind === "kit" && kit.items.find((i) => i.ref?.includes("units/stack/"))).toMatchObject({ quantity: 1, image: expect.stringMatching(/^assets\/images\/unit-thumb-stack\.png$/) });
    const steps = stepsOf(bs);
    expect(steps).toHaveLength(11);
    const motors = steps[0];
    expect(motors.figure?.file).toBe("assets/images/ag-system-01-motors.png");
    expect(motors.parts?.map((x) => [x.letter, x.quantity])).toEqual([["A", 4], ["B", 16]]);
    expect(motors.figure?.callouts?.map((c) => c.label).sort()).toEqual(["A", "B"]);
    expect(motors.torque).toMatch(/0\.6 N·m/);
    // wiring: the routed cables in the accent colour, the camera fitted on them
    const leads = steps[2];
    expect(leads.table?.rows).toHaveLength(8);
    const spec = t.figures.get("ag-system-03-motor-wiring")!;
    expect(spec.bodies.filter((b) => b.style === "accent").map((b) => b.key).sort()).toEqual(["harness:arm_fl_leads", "harness:arm_fr_leads", "harness:arm_rl_leads", "harness:arm_rr_leads"]);
    expect(spec.bodies.filter((b) => b.style === "context").every((b) => b.fit === false)).toBe(true);
    const coverage = bs.find((b) => b.kind === "table" && b.columns.some((c) => c.key === "step"));
    const plan = await unitPlan(p, t.units[1]);
    expect(coverage?.kind === "table" && coverage.rows.length).toBe(plan.steps.reduce((n, x) => n + x.plan.mates.length + x.plan.wiring.length, 0));
  });

  it("the stack unit: its one step plugs the cable, drawn with the cable routed between the boards", async () => {
    const steps = stepsOf(blocksOf(await assembly(t.context("stack", "assembly"))));
    expect(steps.map((s) => s.title)).toEqual(["Connect the FC and ESC"]);
    const spec = t.figures.get("ag-stack-01-stack-cable")!;
    expect(spec.bodies.map((b) => [b.key, b.style]).sort()).toEqual([["harness:stack/sh8_cable", "accent"], ["stack/esc", "normal"], ["stack/fc", "normal"]]);
  });
});

describe("package:spec", () => {
  it("lists what is designed for each unit from the standard outputs: plates with their facts and figure, cables in one table", async () => {
    const root = contributions(await spec(t.context("system", "spec")));
    expect(root[0].title).toBe("Designed for this unit");
    const bs = root[0].blocks;
    const kv = (title: string) => {
      const i = bs.findIndex((b) => b.kind === "heading" && b.text === title);
      const b = bs.slice(i).find((x) => x.kind === "keyvalues");
      return Object.fromEntries((b?.kind === "keyvalues" ? b.rows : []).map((r) => [r.label, r.value]));
    };
    const frame = kv("5-inch quadcopter frame (custom)");
    expect(frame).toMatchObject({ Module: "quadcopter-5in-frame", Material: "3K woven carbon fibre / epoxy laminate", Thickness: "plate 5 mm, clamp_camera_mount 2 mm" });
    expect(frame["Overall size"]).toMatch(/^183\.1 × 183\.1 × \d+(\.\d)? mm$/);
    expect(frame.Supply).toMatch(/^made: cut/);
    expect(bs.some((b) => b.kind === "image" && b.file === "assets/images/made-quadcopter-5in-frame.png")).toBe(true);
    const cables = bs.find((b) => b.kind === "table" && b.columns[0].key === "cable");
    expect(cables?.kind === "table" && cables.rows.length).toBe(9);
    expect(cables?.kind === "table" && cables.rows.find((r) => "cable" in r && r.cable === "Motor 1 phase leads (Rear-right)")).toMatchObject({ len: "78 mm (of 150)", supply: "with meps-neon-2207-v2-1950kv" });
    const stack = contributions(await spec(t.context("stack", "spec")))[0].blocks;
    expect(stack.find((b) => b.kind === "kit")).toMatchObject({ items: [{ name: "FC/ESC SH1.0 8-pin cable", quantity: 1 }] });
  });
});

describe("steps after the bench test", () => {
  it("the battery (after: \"test\") and the propellers are planned last and say why", async () => {
    const r = await unitPlan(p, t.units[1]);
    expect(r.steps.filter((x) => x.afterTest).map((x) => [x.n, x.id])).toEqual([[10, "battery"], [11, "props"]]);
    expect(r.steps.find((x) => x.id === "props")!.afterTest).toMatch(/fits propellers/);
    expect(r.steps.find((x) => x.id === "battery")!.afterTest).toMatch(/after: "test"/);
    const steps = stepsOf(blocksOf(await assembly(t.context("system", "assembly"))));
    // the doc spec's own warning already says so for the props; the battery step gets the note
    expect(steps[9].notes?.[0]).toMatchObject({ level: "caution", text: expect.stringMatching(/^This step follows the bench test and configuration/) });
    expect(steps[10].notes?.filter((n) => /follows the bench test/.test(n.text))).toHaveLength(0);
  });
});

describe("a module unit built several times", () => {
  const ta = testContexts(p, { units: ["stack", "quadcopter-5in-arm"] });
  const arm = ta.units.find((u) => u.id === "quadcopter-5in-arm")!;

  it("lists the propeller's hand for each build, from the position it goes to", async () => {
    expect(arm.perProduct).toBe(4);
    const plan = await unitPlan(p, arm);
    expect(plan.builds.map((b) => [b.path, b.fields.spin])).toEqual([["arm_fr", "CCW"], ["arm_rr", "CW"], ["arm_rl", "CCW"], ["arm_fl", "CW"]]);
    expect(plan.variants).toEqual([{ field: "spin", values: expect.any(Array), handled: true }]);
    const props = plan.steps.find((x) => x.id === "props")!;
    expect(props.perBuild).toBe(true);
    // the representative build alone would say CCW for all four
    for (const [path, spin] of [["arm_fr", "CCW"], ["arm_rr", "CW"], ["arm_rl", "CCW"], ["arm_fl", "CW"]])
      expect(props.actions.filter((a) => a.includes(`(${path})`))).toEqual([expect.stringMatching(new RegExp(`spins ${spin} seen from above, so fit a ${spin} `))]);
    expect(props.actions.some((a) => /^The builds differ \(2 with CCW, 2 with CW propellers\)/.test(a))).toBe(true);
    expect(props.trace).toEqual(["mates prop_on_shaft in each build (arm_fr, arm_rr, arm_rl, arm_fl)"]);
    // the guide warns that the builds differ
    const bs = blocksOf(await assembly(ta.context(arm.id, "assembly")));
    expect(bs.find((b) => b.kind === "note")).toMatchObject({ level: "caution", text: expect.stringMatching(/^The 4 builds are not all the same: spin CCW for Front-right arm, CW for Rear-right arm/) });
  });

  it("builds that are all the same get one action", async () => {
    // the motors of every arm are mounted the same way: no per-build list
    const plan = await unitPlan(p, arm);
    for (const x of plan.steps.filter((y) => y.id !== "props")) expect(x.perBuild).toBe(false);
  });
});

describe("test plan wording", () => {
  it("the step's actions and its joint check count the same conductors", async () => {
    for (const u of t.units) {
      const plan = await unitPlan(p, u);
      const tests = unitTests(p, u, plan);
      for (const x of plan.steps.filter((y) => y.kind === "connect" || y.plan.wiring.length)) {
        const jt = tests.items.find((i) => i.id === tests.joint.get(x.n))!;
        expect(x.extent).toMatch(/^\d+ conductors?( in \d+ links)?$/);
        if (x.kind === "connect") expect(jt.how).toContain(x.extent);
        const total = x.actions.filter((a) => / as in the table \(/.test(a)).map((a) => Number(/\((\d+) /.exec(a.slice(a.lastIndexOf("as in the table")))![1]));
        expect(total.reduce((s, n) => s + n, 0)).toBe(x.conductors);
      }
    }
    const stack = await unitPlan(p, t.units[0]);
    expect(stack.steps[0].extent).toBe("16 conductors in 2 links");
  });

  it("power-up raises the supply to one stated voltage: the pack's nominal, or the pack's that feeds an input given as a range", async () => {
    const powerUp = async (i: number) => unitTests(p, t.units[i], await unitPlan(p, t.units[i])).items.find((x) => x.check === "Power up")!.how;
    expect(await powerUp(1)).toMatch(/start at a low voltage and raise slowly to 22\.2 V \(the pack runs 18–25\.2 V\)$/);
    expect(await powerUp(0)).toMatch(/^Bench supply into .* ESC BAT\+ .*: start at a low voltage and raise slowly to 22\.2 V, the voltage of the CNHL .* that feeds it in the product \(it accepts 6–30 V\)$/);
  });
});

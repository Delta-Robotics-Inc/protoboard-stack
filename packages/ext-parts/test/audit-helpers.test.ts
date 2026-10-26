/**
 * The shared audit helpers (PB-862): scripts/audit/eagle_brd.py reads an
 * Eagle board's outline, mounting holes, pads and nets; scripts/audit/
 * step_measure.py measures a STEP's envelope, hole axes and sections. An
 * auditor uses them instead of ad hoc scripts, so they are checked here on
 * inputs whose answers are known.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG = join(HERE, "..");
const REPO = join(PKG, "../..");
const AUDIT = join(PKG, "scripts/audit");
const TMP = join(HERE, ".tmp-audit");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CAD_PYTHON = cadPython();
const hasPython3 = spawnSync("python3", ["--version"]).status === 0;

const run = (python: string, args: string[]) => {
  const r = spawnSync(python, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${args.join(" ")}: ${r.stderr || r.error?.message}`);
  return r.stdout;
};

describe.skipIf(!hasPython3)("eagle_brd.py", () => {
  const brd = join(HERE, "fixtures/audit/mirrored.brd");
  const board = () => JSON.parse(run("python3", [join(AUDIT, "eagle_brd.py"), brd, "--json"]));

  it("reads the outline, the mounting holes (plain holes and plated mounting-hole pads) and the nets", () => {
    const b = board();
    expect(b.outline).toEqual({ min: [0, 0], max: [30, 20], size: [30, 20] });
    expect(b.mounting_holes.map((h: { x: number; y: number; drill: number; plated: boolean; element: string | null }) => [h.x, h.y, h.drill, h.plated, h.element])).toEqual([
      [3, 17, 2.5, true, "H1"],
      [27, 17, 3.2, false, null],
    ]);
    expect(b.nets).toEqual({ VCC: ["JP1.1", "U1.A"], GND: ["JP1.2", "H1.P$1"], SDA: ["JP1.3", "U1.B"] });
  });

  it("places pads as Eagle does: rotate, then mirror a bottom-side (MR) element in X; every trace ends on its pads", () => {
    const b = board();
    const pads = new Map<string, { x: number; y: number; net: string }>();
    for (const e of b.elements) for (const p of e.pads) pads.set(`${e.name}.${p.name}`, p);
    expect(pads.get("JP1.1")).toMatchObject({ x: 12.46, y: 2.54, net: "VCC" });
    // U1 is MR90 at (10, 10): pad A (1, 0.5) rotates to (-0.5, 1), mirrors to (0.5, 1); mirroring first would put it at (9.5, 9)
    expect(pads.get("U1.A")).toMatchObject({ x: 10.5, y: 11, net: "VCC" });
    expect(pads.get("U1.B")).toMatchObject({ x: 9.5, y: 12, net: "SDA" });
  });

  it("prints a header's pinout in pad order", () => {
    const out = run("python3", [join(AUDIT, "eagle_brd.py"), brd, "--element", "^JP1$"]);
    expect(out).toMatch(/pad 1 +\(12\.460,2\.540\) drill 1\.0 -> VCC\n +pad 2 +\(15\.000,2\.540\) drill 1\.0 -> GND\n +pad 3 +\(17\.540,2\.540\) drill 1\.0 -> SDA/);
  });
});

describe.skipIf(!CAD_PYTHON)("step_measure.py", () => {
  it("measures a model with known geometry: envelope, hole axes along z and x, and sections", () => {
    mkdirSync(TMP, { recursive: true });
    const step = join(TMP, "known.step");
    // a 20 x 10 x 5 block with two 3 mm holes along z at x = ±5 and a 4 mm cross bore along x at z = 5
    run(CAD_PYTHON!, [
      "-c",
      [
        "from build123d import *",
        "with BuildPart() as p:",
        "    Box(20, 10, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))",
        "    with Locations((-5, 0, 0), (5, 0, 0)):",
        "        Cylinder(1.5, 5, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)",
        "    with Locations((0, 0, 5)):",
        "        Cylinder(2, 30, rotation=(0, 90, 0), mode=Mode.SUBTRACT)",
        `export_step(p.part, ${JSON.stringify(step)})`,
      ].join("\n"),
    ]);
    const m = JSON.parse(run(CAD_PYTHON!, [join(AUDIT, "step_measure.py"), step, "--section", "z=2.5", "--section", "x=0", "--solids", "--json"]));
    expect(m.envelope).toEqual({ min: [-10, -5, 0], max: [10, 5, 5], size: [20, 10, 5] });
    expect(m.axes).toEqual([
      { kind: "cylinder", diameter: 3, point: [-5, 0, 0], direction: [0, 0, 1], faces: 1 },
      { kind: "cylinder", diameter: 3, point: [5, 0, 0], direction: [0, 0, 1], faces: 1 },
      { kind: "cylinder", diameter: 4, point: [0, 0, 5], direction: [1, 0, 0], faces: 1 },
    ]);
    const [z, x] = m.sections;
    expect(z.bbox.size).toEqual([20, 10, 0]);
    expect(z.circles).toEqual([
      { centre: [-5, 0, 2.5], diameter: 3 },
      { centre: [5, 0, 2.5], diameter: 3 },
    ]);
    expect(x.circles).toEqual([{ centre: [0, 0, 5], diameter: 4 }]);
    expect(x.lines.map((l: { length: number }) => l.length)).toEqual([10, 5, 5, 3, 3]);
    expect(m.solids).toHaveLength(1);
    // --axis keeps the axes along one direction
    const onlyZ = JSON.parse(run(CAD_PYTHON!, [join(AUDIT, "step_measure.py"), step, "--axis", "z", "--json"]));
    expect(onlyZ.axes.map((a: { diameter: number }) => a.diameter)).toEqual([3, 3]);
  }, 120_000);
});

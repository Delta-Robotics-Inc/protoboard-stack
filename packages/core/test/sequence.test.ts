/**
 * Assembly sequence (PB-1183): the generator on a fixture with two mates and
 * one fastener stack, patches keyed by step id (rename, reorder, merge, split,
 * manual action, camera, joint), unknown ids reported, regeneration keeping
 * edits, the build hook on the drone example, and the shared files kept
 * identical to the viewer's copies.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Assembly, Mat4, ModuleDef } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "../src/project.ts";
import { applyPatches, buildSequence, flattenSequence, generateSequence, hardwareKeys, readSequencePatches, runSequenceChecks, threadOf, writeSequence, type SequencePatch } from "../src/sequence/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const stackRoot = resolve(here, "../../..");
const tmp = mkdtempSync(join(tmpdir(), "pb-sequence-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const T = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1] as unknown as Mat4;
const def = (id: string, extra: Partial<ModuleDef> = {}): ModuleDef => ({ id, name: id, interfaces: [], ...extra }) as unknown as ModuleDef;
const bolt = (role: "structure" | "component") => ({ id: "mount", domain: "mechanical", protocols: [{ type: "bolt_pattern", roles: [role] }] });
const shaft = (role: "output" | "input") => ({ id: role === "output" ? "shaft" : "bore", domain: "mechanical", protocols: [{ type: "shaft", roles: [role] }] });
const up = { origin: [0, 0, 0], normal: [0, 0, 1] };

/**
 * A plate (base), a motor bolted onto it (mate 1, a fastener stack of two
 * screws from under the plate and two nuts on top), and a hub slid on the
 * motor's shaft (mate 2). The motor and hub are one module (a sub-assembly).
 */
function fixture(): Assembly {
  const plate = def("plate");
  const motor = def("motor");
  const hub = def("hub");
  const screw = def("m3x10", { tags: ["fastener", "screw"], traits: [{ type: "performance", params: { thread: "M3 x 0.5" } }] } as Partial<ModuleDef>);
  const nut = def("m3-nut", { tags: ["fastener", "nut"], traits: [{ type: "performance", params: { thread: "M3 x 0.5 LH" } }] } as Partial<ModuleDef>);
  const mates = [
    { linkId: "motor_mount", harness: "motor_hw", a: { path: ["unit", "motor"], def: motor, iface: bolt("component"), frame: { origin: [0, 0, 0], normal: [0, 0, -1] } }, b: { path: ["plate"], def: plate, iface: bolt("structure"), frame: { origin: [0, 0, 2], normal: [0, 0, 1] } } },
    { linkId: "unit/hub_on_shaft", a: { path: ["unit", "motor"], def: motor, iface: shaft("output"), frame: { origin: [0, 0, 20], normal: [0, 0, 1] } }, b: { path: ["unit", "hub"], def: hub, iface: shaft("input"), frame: { origin: [0, 0, 0], normal: [0, 0, -1] } } },
  ];
  const hardware = [
    { harness: "motor_hw", child: "screws", def: screw, linkId: "motor_mount", matrix: T(-5, 0, -1), structure: "plate", mounted: "unit/motor", atMm: -3, direction: 1 },
    { harness: "motor_hw", child: "screws", def: screw, linkId: "motor_mount", matrix: T(5, 0, -1), structure: "plate", mounted: "unit/motor", atMm: -3, direction: 1 },
    { harness: "motor_hw", child: "nuts", def: nut, linkId: "motor_mount", matrix: T(-5, 0, 8), structure: "plate", mounted: "unit/motor", atMm: 6, direction: 1 },
    { harness: "motor_hw", child: "nuts", def: nut, linkId: "motor_mount", matrix: T(5, 0, 8), structure: "plate", mounted: "unit/motor", atMm: 6, direction: 1 },
  ];
  return {
    instances: [],
    placements: [
      { key: "plate", path: ["plate"], matrix: T(0, 0, 0) },
      { key: "unit/motor", path: ["unit", "motor"], matrix: T(0, 0, 2), via: "motor_mount" },
      { key: "unit/hub", path: ["unit", "hub"], matrix: T(0, 0, 22), via: "unit/hub_on_shaft" },
    ],
    mates,
    routes: [],
    hardware,
    harnesses: [],
    unrouted: [],
    issues: [],
  } as unknown as Assembly;
}

describe("sequence generator", () => {
  const file = generateSequence(fixture(), { root: ["plate"] });
  const main = file.sequences.find((s) => s.id === "main")!;

  it("fits each mate and fastens its stack after it, from the base", () => {
    expect(file.schema).toBe("protoboard.sequence/v0");
    expect(main.base).toEqual(["plate"]);
    expect(main.steps.map((s) => s.id)).toEqual(["fit:motor_mount", "fasten:motor_mount"]);
    const fasten = main.steps[1];
    expect(fasten.kind).toBe("fasten");
    expect(fasten.members.map((m) => m.ref)).toEqual(["motor_hw/screws#1", "motor_hw/screws#2", "motor_hw/nuts#1", "motor_hw/nuts#2"]);
    expect(main.groups?.map((g) => g.id)).toEqual(["@motor_hw/screws", "@motor_hw/nuts"]);
    // every link appears exactly once across all sequences
    const links = file.sequences.flatMap((s) => s.steps.flatMap((x) => x.links ?? []));
    expect(links.filter((l) => l === "motor_mount").length).toBe(2); // its fit and its fasten
    expect(links.filter((l) => l === "unit/hub_on_shaft").length).toBe(1);
  });

  it("nests a module whose bodies mate among themselves as a sub-assembly fitted as one step", () => {
    const fit = main.steps[0];
    expect(fit.kind).toBe("subassembly");
    expect(fit.sequence).toBe("unit");
    const sub = file.sequences.find((s) => s.id === "unit")!;
    expect(sub.base).toEqual(["unit/motor"]);
    expect(sub.steps.map((s) => [s.id, s.kind])).toEqual([["fit:unit/hub_on_shaft", "insert"]]);
    expect(sub.steps[0].members[0].parent).toBe("unit/motor");
    // flattened: the sub-assembly's own steps come before the step that fits it
    expect(flattenSequence(file).map((x) => x.step.id)).toEqual(["fit:unit/hub_on_shaft", "fit:motor_mount", "fasten:motor_mount"]);
    expect(flattenSequence(file, "main", "one").map((x) => x.step.id)).toEqual(["fit:motor_mount", "fasten:motor_mount"]);
  });

  it("ranks parts along the joint like the docs' figures and turns threaded parts at their pitch and hand", () => {
    const [fit, fasten] = main.steps;
    expect(fit.members[0].rank).toBe(1); // the motor's seat (2 mm up the plate's normal... from the frame at 2): first out
    const screw = fasten.members[0];
    expect(screw.rank).toBe(-1);
    expect(screw.motion).toMatchObject({ axis: "-normal", turns: 3, pitchMm: 0.5, hand: "right" });
    expect(screw.parent).toBe("plate");
    const nut = fasten.members[2];
    expect(nut.rank).toBe(2);
    expect(nut.motion).toMatchObject({ turns: 3, pitchMm: 0.5, hand: "left" });
    expect(nut.motion?.axis).toBeUndefined();
    expect(fasten.motion).toEqual({ along: { mate: "motor_mount", end: "structure" }, distance: "auto" });
  });

  it("reads a pitch only where the module states one", () => {
    expect(threadOf(def("x", { traits: [{ type: "performance", params: { thread: "M5 x 0.8" } }] } as Partial<ModuleDef>))).toEqual({ pitchMm: 0.8, hand: "right" });
    expect(threadOf(def("x", { traits: [{ type: "performance", params: { thread: "M3" } }] } as Partial<ModuleDef>))).toBeUndefined();
    expect(threadOf(def("x"))).toBeUndefined();
  });

  it("is deterministic and keys hardware as ext-docs does", () => {
    expect(JSON.stringify(generateSequence(fixture(), { root: ["plate"] }))).toBe(JSON.stringify(file));
    expect(hardwareKeys(fixture().hardware)).toEqual(["motor_hw/screws#1", "motor_hw/screws#2", "motor_hw/nuts#1", "motor_hw/nuts#2"]);
  });

  it("gives parts a display hint places a planned step", () => {
    const asm = fixture();
    asm.placements.push({ key: "battery", path: ["battery"], matrix: T(0, 0, -20) });
    const f = generateSequence(asm, { root: ["plate"], hinted: ["battery"] });
    const last = f.sequences[0].steps.at(-1)!;
    expect(last).toMatchObject({ id: "place:battery", plan: "stack", motion: { along: "up", distance: "auto" } });
  });
});

describe("sequence patches", () => {
  const generated = generateSequence(fixture(), { root: ["plate"] });

  it("renames, reorders, sets a camera and adds a manual action, keyed by step id", () => {
    const patches: SequencePatch[] = [
      {
        edits: [
          { step: "fit:motor_mount", set: { title: "Seat the motor", camera: { dir: [1, -1, 1] } } },
          { insert: { id: "check:spin", title: "Spin the hub by hand", kind: "action", members: [] }, after: "fasten:motor_mount" },
          { move: "check:spin", before: "fasten:motor_mount" },
        ],
      },
    ];
    const r = applyPatches(generated, patches);
    expect(r.problems).toEqual([]);
    expect(r.applied).toBe(3);
    const steps = r.file.sequences[0].steps;
    expect(steps.map((s) => s.id)).toEqual(["fit:motor_mount", "check:spin", "fasten:motor_mount"]);
    expect(steps[0]).toMatchObject({ title: "Seat the motor", camera: { dir: [1, -1, 1] }, kind: "subassembly" });
    expect(steps[1].source).toBe("authored");
    // the input is not changed
    expect(generated.sequences[0].steps[0].title).not.toBe("Seat the motor");
  });

  it("merges fit and fasten, each member keeping its motion", () => {
    const r = applyPatches(generated, [{ edits: [{ merge: ["fit:motor_mount", "fasten:motor_mount"], into: "mount:motor", title: "Bolt the motor on" }] }]);
    expect(r.problems).toEqual([]);
    const [step] = r.file.sequences[0].steps;
    expect(step.id).toBe("mount:motor");
    expect(step.members).toHaveLength(5);
    expect(step.members[1].motion).toMatchObject({ along: { mate: "motor_mount", end: "structure" }, axis: "-normal", turns: 3 });
    expect(step.links).toEqual(["motor_mount"]);
  });

  it("splits a stack by group", () => {
    const r = applyPatches(generated, [{ edits: [{ split: "fasten:motor_mount", by: [["@motor_hw/nuts"]], ids: ["fasten:nuts", "fasten:screws"] }] }]);
    expect(r.problems).toEqual([]);
    const steps = r.file.sequences[0].steps;
    expect(steps.map((s) => s.id)).toEqual(["fit:motor_mount", "fasten:nuts", "fasten:screws"]);
    expect(steps[1].members.map((m) => m.ref)).toEqual(["motor_hw/nuts#1", "motor_hw/nuts#2"]);
    expect(steps[2].members[0].motion?.along).toEqual({ mate: "motor_mount", end: "structure" });
  });

  it("reports unknown step ids, members and sequences and applies the rest", () => {
    const r = applyPatches(
      generated,
      [
        { edits: [{ step: "fit:lid_mount", set: { title: "x" } }, { remove: "fasten:motor_mount" }, { split: "fit:motor_mount", by: [["nope#1"]] }] },
        { sequence: "gearbox", edits: [{ remove: "x" }] },
      ],
      "src/assembly.uhd.ts",
    );
    expect(r.applied).toBe(1);
    expect(r.problems.map((p) => [p.code, p.edit])).toEqual([
      ["SEQUENCE_PATCH_UNKNOWN_STEP", 0],
      ["SEQUENCE_PATCH_UNKNOWN_MEMBER", 2],
      ["SEQUENCE_PATCH_UNKNOWN_SEQUENCE", undefined],
    ]);
    expect(r.problems[0].patch).toBe("src/assembly.uhd.ts");
    expect(r.file.sequences[0].steps.map((s) => s.id)).toEqual(["fit:motor_mount"]);
  });

  it("survives regeneration while the link ids stay", () => {
    const patches: SequencePatch[] = [{ edits: [{ step: "fasten:motor_mount", set: { title: "Tighten the four fasteners" } }] }];
    const asm = fixture();
    // the model moves (the motor sits 3 mm higher): generated again, the edit still applies
    (asm.placements[1].matrix as unknown as number[])[11] = 5;
    const again = applyPatches(generateSequence(asm, { root: ["plate"] }), patches);
    expect(again.problems).toEqual([]);
    expect(again.file.sequences[0].steps[1].title).toBe("Tighten the four fasteners");
  });

  it("adds a joint with hard stops and refuses inverted limits", () => {
    const r = applyPatches(generated, [
      { sequence: "unit", edits: [{ joint: { id: "hub_spin", type: "revolute", part: "unit/hub", along: { mate: "unit/hub_on_shaft", end: "parent" }, min: -90, max: 90 } }] },
      { sequence: "unit", edits: [{ joint: { id: "bad", type: "slider", part: "unit/hub", along: "up", min: 5, max: 1 } }] },
    ]);
    expect(r.file.sequences.find((s) => s.id === "unit")!.joints).toEqual([{ id: "hub_spin", type: "revolute", part: "unit/hub", along: { mate: "unit/hub_on_shaft", end: "parent" }, min: -90, max: 90, limitsFrom: "sequence" }]);
    expect(r.problems.map((p) => p.code)).toEqual(["SEQUENCE_PATCH_BAD_JOINT"]);
  });
});

describe("sequence build hook", () => {
  it("reads patches from a sibling JSON file and reports a bad one", async () => {
    const root = join(tmp, "p1");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "assembly.sequence.json"), JSON.stringify({ patches: [{ edits: [{ remove: "a" }] }] }));
    const ok = await readSequencePatches(root);
    expect(ok.files.map((f) => f.file)).toEqual(["src/assembly.sequence.json"]);
    writeFileSync(join(root, "src", "assembly.sequence.json"), JSON.stringify({ patches: [{ nope: 1 }] }));
    const bad = await readSequencePatches(root);
    expect(bad.problems.map((p) => p.code)).toEqual(["SEQUENCE_PATCH_INVALID"]);
  });

  it("writes sequence.json for the drone: every mate and every hardware part exactly once", async () => {
    const p = await loadProject(join(stackRoot, "examples", "quadcopter-5in"), { checks: false });
    const out = join(tmp, "drone-sequence.json");
    const b = (await writeSequence(p, out))!;
    expect(b.diagnostics).toEqual([]);
    const file = JSON.parse(readFileSync(out, "utf8"));
    expect(file.schema).toBe("protoboard.sequence/v0");
    expect(file.root).toEqual(["frame"]);
    const steps = flattenSequence(file);
    const fits = steps.filter((s) => s.step.id.startsWith("fit:")).map((s) => s.step.links![0]);
    expect(fits.sort()).toEqual(
      ["arm_fl_mount", "arm_fr_mount", "arm_rl_mount", "arm_rr_mount", "stack_mount", "fc_mount", "top_plate_mount", "camera_mount", "vtx_mount", "gps_mount", "arm_fl/prop_on_shaft", "arm_fr/prop_on_shaft", "arm_rl/prop_on_shaft", "arm_rr/prop_on_shaft"].sort(),
    );
    const hw = steps.flatMap((s) => (s.step.kind === "fasten" ? s.step.members.map((m: { ref: string }) => m.ref) : []));
    expect(hw).toHaveLength(84);
    expect(new Set(hw).size).toBe(84);
    // the stack's nuts are the first thing off when it explodes: last in its fasten step's rank order
    const stack = steps.find((s) => s.step.id === "fasten:stack_mount")!.step;
    const nut = stack.members.find((m: { ref: string }) => m.ref.startsWith("stack_hardware/nuts"))!;
    expect(nut.rank).toBe(Math.max(...stack.members.map((m: { rank?: number }) => m.rank ?? 0)));
    expect(nut.motion).toMatchObject({ turns: 3, pitchMm: 0.5 });
    // the arms are sub-assemblies: motor then prop
    expect(file.sequences.map((s: { id: string }) => s.id)).toEqual(["main", "arm_fl", "arm_fr", "arm_rl", "arm_rr"]);
    const b2 = (await buildSequence(p))!;
    expect(JSON.stringify(b2.file)).toBe(JSON.stringify(file));
  }, 60_000);

  it("check reports a patch's unknown step id as SEQUENCE_PATCH_UNKNOWN_STEP, and runs nothing without patches (wave 2 gate)", async () => {
    const drone = await loadProject(join(stackRoot, "examples", "quadcopter-5in"), { checks: false });
    // the drone declares no patches: no check entry, no diagnostics
    const before = { diagnostics: drone.diagnostics.length, checks: drone.checks.length };
    await runSequenceChecks(drone);
    expect({ diagnostics: drone.diagnostics.length, checks: drone.checks.length }).toEqual(before);
    // the same system read from a folder whose src/assembly.sequence.json names a step that does not exist
    const root = join(tmp, "patched");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "assembly.sequence.json"), JSON.stringify({ patches: [{ edits: [{ step: "fit:no_such_link", set: { title: "x" } }, { step: "fit:stack_mount", set: { title: "Stack on" } }] }] }));
    const p = { ...drone, root, config: { ...drone.config, display: ".protoboard/display.json" }, diagnostics: [] as typeof drone.diagnostics, checks: [] as typeof drone.checks };
    await runSequenceChecks(p);
    expect(p.diagnostics.map((d) => [d.code, d.severity, d.validator])).toEqual([["SEQUENCE_PATCH_UNKNOWN_STEP", "warning", "protoboard/sequence"]]);
    expect(p.diagnostics[0].source?.file).toBe("src/assembly.sequence.json");
    expect(p.checks).toEqual([{ validator: "protoboard/sequence", status: "ran", counts: { error: 0, warning: 1, info: 0 } }]);
  }, 60_000);
});

describe("shared sequence files", () => {
  // the viewer runs the same generator and types when a bundle has no sequence.json: the files must not drift
  const viewerLink = join(stackRoot, "node_modules", "@deltarobotics", "uhd-viewer");
  const viewer = existsSync(viewerLink) ? realpathSync(viewerLink) : undefined;
  const shared = ["types.ts", "generate.ts", "patch.ts"];
  it.skipIf(!viewer || !existsSync(join(viewer, "src", "cad", "sequence", "types.ts")))("are identical in core and the linked uhd-viewer checkout", () => {
    for (const f of shared) {
      const a = readFileSync(join(here, "..", "src", "sequence", f), "utf8").replace(/\r\n/g, "\n");
      const b = readFileSync(join(viewer!, "src", "cad", "sequence", f), "utf8").replace(/\r\n/g, "\n");
      expect(b, f).toBe(a);
    }
  });
});

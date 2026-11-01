/**
 * Joint limits as hard stops in the sequence, and mates feeding it (PB-1185):
 * keyframes beyond a stop held and flagged, a rest beyond a stop held, a
 * driving mate adding a joint with its limits (units normalized) on a world
 * line, a planner-only body fitted along its mate, inferred and suppressed
 * mates ignored, an authored joint kept; and the CLI-side keyframes and poses
 * the interference check uses.
 */
import type { Assembly, Mat4, ModuleDef } from "@deltarobotics/uhd";
import { describe, expect, it } from "vitest";
import type { Mate } from "../src/mates/index.ts";
import { applyMatesToSequence, clampSequenceJoints, generateSequence, jointValuesAt, keyframeAt, poseCore, resolveCore, sequenceKeyframes, type SequenceFile } from "../src/sequence/index.ts";

const T = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1] as unknown as Mat4;
const def = (id: string): ModuleDef => ({ id, name: id, interfaces: [] }) as unknown as ModuleDef;
const bolt = (role: "structure" | "component") => ({ id: "mount", domain: "mechanical", protocols: [{ type: "bolt_pattern", roles: [role] }] });

/** A case (base), a lid mated to it by a link, a knob on the lid placed by a display hint (no mate). */
function fixture(): Assembly {
  return {
    instances: [],
    placements: [
      { key: "case", path: ["case"], matrix: T(0, 0, 0) },
      { key: "lid", path: ["lid"], matrix: T(0, 0, 20), via: "lid_mount" },
      { key: "knob", path: ["knob"], matrix: T(5, 0, 22) },
    ],
    mates: [{ linkId: "lid_mount", a: { path: ["lid"], def: def("lid"), iface: bolt("component"), frame: { origin: [0, 0, 0], normal: [0, 0, -1] } }, b: { path: ["case"], def: def("case"), iface: bolt("structure"), frame: { origin: [0, 0, 20], normal: [0, 0, 1] } } }],
    routes: [],
    hardware: [],
    harnesses: [],
    unrouted: [],
    issues: [],
  } as unknown as Assembly;
}
const frame = (o: [number, number, number], z: [number, number, number]) => ({ origin: o, zAxis: z });
const hinge: Mate = { id: "lid_hinge", kind: "revolute", a: { instance: "case", frame: frame([0, 30, 20], [1, 0, 0]) }, b: { instance: "lid", frame: frame([0, 30, 0], [-1, 0, 0]) }, limits: [{ dof: "rotate", min: 0, max: Math.PI / 2, rest: 0, unit: "rad", source: "test" }], provenance: "declared", from: "trait" };
const knobOn: Mate = { id: "knob_on", kind: "coaxial", a: { instance: "lid", frame: frame([5, 0, 2], [0, 0, 1]) }, b: { instance: "knob", frame: frame([0, 0, 0], [0, 0, -1]) }, provenance: "measured", from: "sidecar" };

const generated = (): SequenceFile => generateSequence(fixture(), { root: ["case"], hinted: ["knob"] });

describe("mates feeding the sequence", () => {
  it("adds a revolute joint on the moving end with its limits in degrees, on a world line", () => {
    const r = applyMatesToSequence(generated(), fixture(), [hinge]);
    const j = r.file.sequences[0].joints!.find((x) => x.id === "lid_hinge")!;
    expect(j).toMatchObject({ type: "revolute", part: "lid", min: 0, limitsFrom: "mate:trait" });
    expect(j.max).toBeCloseTo(90, 9);
    expect(j.along).toEqual({ at: [0, 30, 20], axis: [1, 0, 0] });
    expect(r.joints).toBe(1);
  });
  it("fits a body only the planner placed along the mate that joins it", () => {
    const before = generated();
    expect(before.sequences[0].steps.some((s) => s.id === "place:knob" && s.plan === "stack")).toBe(true);
    const r = applyMatesToSequence(before, fixture(), [knobOn]);
    const steps = r.file.sequences[0].steps;
    expect(steps.some((s) => s.id === "place:knob")).toBe(false);
    const fit = steps.find((s) => s.id === "fit:mate:knob_on")!;
    expect(fit).toMatchObject({ kind: "insert", members: [{ ref: "knob", parent: "lid" }], motion: { along: { at: [5, 0, 22], axis: [0, 0, 1] }, distance: "auto" } });
    expect(r.fits).toBe(1);
  });
  it("ignores inferred and suppressed mates, and keeps an authored joint", () => {
    const inferred = { ...hinge, provenance: "inferred" as const, confidence: 0.9, from: "inferred" as const };
    expect(applyMatesToSequence(generated(), fixture(), [inferred]).joints).toBe(0);
    expect(applyMatesToSequence(generated(), fixture(), [{ ...hinge, suppressed: true }]).joints).toBe(0);
    const authored = generated();
    authored.sequences[0].joints = [{ id: "lid_hinge", type: "revolute", part: "lid", along: { mate: "lid_mount" }, min: -5, max: 5, limitsFrom: "sequence" }];
    const r = applyMatesToSequence(authored, fixture(), [hinge]);
    expect(r.file.sequences[0].joints).toEqual(authored.sequences[0].joints);
    expect(r.problems.map((p) => p.code)).toEqual(["SEQUENCE_MATE_JOINT_AUTHORED"]);
  });
});

describe("joint limits as hard stops", () => {
  const withHinge = () => {
    const f = applyMatesToSequence(generated(), fixture(), [hinge]).file;
    f.sequences[0].steps.push({ id: "open", title: "Open the lid", kind: "action", members: [], joints: { lid_hinge: 135, ghost: 3 }, source: "authored" });
    f.sequences[0].joints![0].rest = -10;
    return f;
  };
  it("holds a keyframe beyond a stop at the stop, flags it on the step, and reports it", () => {
    const r = clampSequenceJoints(withHinge());
    const open = r.file.sequences[0].steps.find((s) => s.id === "open")!;
    expect(open.joints!.lid_hinge).toBeCloseTo(90, 9);
    expect(open.limits).toEqual([{ joint: "lid_hinge", asked: 135, held: open.joints!.lid_hinge, stop: "max" }]);
    const j = r.file.sequences[0].joints![0];
    expect(j.rest).toBe(0);
    expect(j.limited).toEqual({ joint: "lid_hinge", asked: -10, held: 0, stop: "min" });
    expect(r.problems.map((p) => p.code).sort()).toEqual(["SEQUENCE_JOINT_LIMIT", "SEQUENCE_JOINT_LIMIT", "SEQUENCE_JOINT_UNKNOWN"]);
    expect(r.flagged).toBe(2);
  });
  it("leaves a file within its stops unchanged", () => {
    const f = applyMatesToSequence(generated(), fixture(), [hinge]).file;
    const r = clampSequenceJoints(f);
    expect(r.file).toEqual(f);
    expect(r.problems).toEqual([]);
  });
});

describe("keyframes and poses for the interference check", () => {
  const file = clampSequenceJoints(applyMatesToSequence(applyMatesToSequence(generated(), fixture(), [hinge]).file, fixture(), [knobOn]).file).file;
  file.sequences[0].steps.push({ id: "open", title: "Open the lid", kind: "action", members: [], joints: { lid_hinge: 60 }, source: "authored" });
  const r = resolveCore(fixture(), file);

  it("lists assembled, one per step and each joint at its stops", () => {
    const ids = sequenceKeyframes(r).map((k) => k.id);
    expect(ids[0]).toBe("assembled");
    expect(ids).toContain("step:fit:lid_mount");
    expect(ids).toContain("step:fit:mate:knob_on");
    expect(ids).toContain("joint:lid_hinge@min");
    expect(ids).toContain("joint:lid_hinge@max");
    expect(keyframeAt(r, "fit:lid_mount")!.id).toBe("step:fit:lid_mount");
    expect(keyframeAt(r, "0.5")!.t).toBe(0.5);
    expect(keyframeAt(r, "nope")).toBeUndefined();
  });
  it("plays joint keyframes in assembly order: assembled shows the last, apart shows rest", () => {
    expect(jointValuesAt(r, 0).lid_hinge).toBeCloseTo(60, 6);
    expect(jointValuesAt(r, 1).lid_hinge).toBeCloseTo(0, 6);
    expect(jointValuesAt(r, 0, { lid_hinge: 400 }).lid_hinge).toBeCloseTo(90, 6); // an asked value is held at the stop too
  });
  it("poses the lid about the hinge line and the knob riding on the lid", () => {
    const at0 = poseCore(r, 0);
    const lid = at0.deltas.get("lid")!;
    // 60 degrees about +x through (0, 30, 20): the lid origin (0, 0, 20) swings to (0, 30 - 30 cos 60, 20 - 30 sin 60)
    const p = [lid[0] * 0 + lid[1] * 0 + lid[2] * 20 + lid[3], lid[4] * 0 + lid[5] * 0 + lid[6] * 20 + lid[7], lid[8] * 0 + lid[9] * 0 + lid[10] * 20 + lid[11]];
    expect(p[1]).toBeCloseTo(30 - 30 * Math.cos(Math.PI / 3), 6);
    expect(p[2]).toBeCloseTo(20 - 30 * Math.sin(Math.PI / 3), 6);
    expect(at0.deltas.get("knob")).toEqual(lid);
    // the knob's fit step apart: it leaves along +z from the lid, by one gap
    const k = keyframeAt(r, "step:fit:mate:knob_on")!;
    const apart = poseCore(r, k.t, { lid_hinge: 0 });
    expect(apart.deltas.get("knob")![11]).toBeCloseTo(26 * 1.6, 6);
  });
});

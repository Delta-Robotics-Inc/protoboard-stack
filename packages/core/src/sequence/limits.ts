/**
 * Joint limits as hard stops in the sequence (PB-1185, research B.4 v1). Core
 * only (not a shared file): the viewer applies the same rule when it resolves
 * (uhd-viewer `src/cad/sequence/resolve.ts`), so a file written by another
 * tool is held at its stops too.
 *
 * A keyframe (`SeqStep.joints`) or a joint's `rest` outside the joint's
 * [min, max] is clamped to the nearer stop and flagged: on the step
 * (`SeqStep.limits`) or the joint (`JointDef.limited`), and as a
 * `SEQUENCE_JOINT_LIMIT` warning. A keyframe naming no joint is
 * `SEQUENCE_JOINT_UNKNOWN`. Pure; the input is not changed.
 */
import type { JointDef, JointLimitFlag, SequenceFile, SequenceProblem } from "./types.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The value held within a joint's stops, and the flag when it moved. */
export function holdAtStops(j: Pick<JointDef, "id" | "min" | "max">, asked: number): { held: number; flag?: JointLimitFlag } {
  if (j.min !== undefined && asked < j.min) return { held: j.min, flag: { joint: j.id, asked, held: j.min, stop: "min" } };
  if (j.max !== undefined && asked > j.max) return { held: j.max, flag: { joint: j.id, asked, held: j.max, stop: "max" } };
  return { held: asked };
}

export function clampSequenceJoints(file: SequenceFile): { file: SequenceFile; problems: SequenceProblem[]; flagged: number } {
  const out = clone(file);
  const problems: SequenceProblem[] = [];
  const joints = new Map<string, JointDef>();
  let flagged = 0;
  for (const seq of out.sequences)
    for (const j of seq.joints ?? []) {
      joints.set(j.id, j);
      delete j.limited;
      if (j.rest === undefined) continue;
      const r = holdAtStops(j, j.rest);
      if (r.flag) {
        j.rest = r.held;
        j.limited = r.flag;
        flagged++;
        problems.push({ code: "SEQUENCE_JOINT_LIMIT", severity: "warning", message: `joint "${j.id}": rest ${r.flag.asked} is beyond its ${r.flag.stop} stop ${r.held}; held at the stop` });
      }
    }
  for (const seq of out.sequences)
    for (const step of seq.steps) {
      delete step.limits;
      if (!step.joints) continue;
      const flags: JointLimitFlag[] = [];
      for (const [id, v] of Object.entries(step.joints)) {
        const j = joints.get(id);
        if (!j) {
          problems.push({ code: "SEQUENCE_JOINT_UNKNOWN", severity: "warning", message: `step "${step.id}" sets joint "${id}", which no sequence declares (joints: ${[...joints.keys()].join(", ") || "none"})`, step: step.id });
          continue;
        }
        if (typeof v !== "number" || !Number.isFinite(v)) {
          problems.push({ code: "SEQUENCE_JOINT_LIMIT", severity: "warning", message: `step "${step.id}": joint "${id}" value is not a number; left out`, step: step.id });
          delete step.joints[id];
          continue;
        }
        const r = holdAtStops(j, v);
        if (r.flag) {
          step.joints[id] = r.held;
          flags.push(r.flag);
          flagged++;
          problems.push({ code: "SEQUENCE_JOINT_LIMIT", severity: "warning", message: `step "${step.id}": joint "${id}" ${v} is beyond its ${r.flag.stop} stop ${r.held}; held at the stop`, step: step.id });
        }
      }
      if (flags.length) step.limits = flags;
    }
  return { file: out, problems, flagged };
}

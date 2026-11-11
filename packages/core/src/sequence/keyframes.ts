/**
 * Sequence keyframes and poses on the CLI side (PB-1185), for static
 * interference. Core only: a compact version of the viewer's resolve and
 * poseAt (uhd-viewer `src/cad/sequence/resolve.ts`) with the same windows,
 * ease, ranks, hierarchical parents and joint deltas, minus what only the
 * view can do:
 *
 * - DEFAULT: screw turns are left out (a part turning about its own axis
 *   changes nothing an interference check sees on a round fastener);
 * - DEFAULT: members of planned steps (the viewer's stack planner, raycast
 *   at view time) are reported out of the check while their step is apart,
 *   since their exploded position is the planner's, not the file's.
 *
 * Keyframes (research B.4 v2): `assembled` (t = 0), `step:<id>` (the state
 * just before that step is assembled, as the player's goto), and for every
 * joint with stops `joint:<id>@min` and `joint:<id>@max` (assembled, that
 * joint at its stop). Matrices are row-major, mm, Z up (UHD).
 */
import type { Assembly, MateEdge } from "@deltarobotics/uhd";
import { IDENTITY, applyPoint, invertRigid, mul, rotationAbout, translation, unit, type M4 } from "../mates/frames.js";
import { flattenSequence, placementKey, structureEnd, worldFrameOf } from "./generate.js";
import { holdAtStops } from "./limits.js";
import { expandRefs } from "./patch.js";
import { DEFAULTS, type FrameRef, type JointDef, type Motion, type SequenceFile, type Vec3 } from "./types.js";

/** DEFAULT: the viewer's explode step, mm per rank (uhd-viewer CadView `EXPLODE_MM`). */
export const KEYFRAME_GAP_MM = 26;

export interface Keyframe {
  id: string;
  label: string;
  /** Explode amount (0 assembled, 1 apart). */
  t: number;
  /** Joint values asked at this keyframe (on top of step keyframes). */
  joints?: Record<string, number>;
}

interface RMember {
  ref: string;
  parent?: string;
  dir: Vec3;
  distance: number;
}
interface RStep {
  id: string;
  members: RMember[];
  planned: boolean;
  still: boolean;
  durationS: number;
  ease: "cubic" | "linear";
  joints?: Record<string, number>;
}
export interface RJoint {
  id: string;
  type: "revolute" | "slider";
  part: string;
  origin: Vec3;
  axis: Vec3;
  min?: number;
  max?: number;
  rest: number;
}
export interface CoreResolved {
  steps: RStep[];
  windows: [number, number][];
  parents: Map<string, string>;
  joints: RJoint[];
}

const endKey = (e: MateEdge["a"]) => placementKey(e.path, e.frame.artifact);

function frameOf(asm: Assembly, ref: FrameRef, up: Vec3): { origin: Vec3; axis: Vec3 } | undefined {
  if (ref === "up") return { origin: [0, 0, 0], axis: unit(up) as Vec3 };
  if ("world" in ref) return { origin: [0, 0, 0], axis: unit(ref.world) as Vec3 };
  if ("at" in ref) return { origin: [...ref.at] as Vec3, axis: unit(ref.axis) as Vec3 };
  const m = asm.mates.find((x) => x.linkId === ref.mate);
  if (!m) return undefined;
  const placement = new Map(asm.placements.map((p) => [p.key, p]));
  const mover = [m.a, m.b].find((e) => placement.get(endKey(e))?.via === m.linkId);
  const end = ref.end === "a" ? m.a : ref.end === "b" ? m.b : ref.end === "structure" ? structureEnd(m) : ref.end === "child" ? (mover ?? m.b) : mover ? (mover === m.a ? m.b : m.a) : structureEnd(m);
  const pl = placement.get(endKey(end));
  if (!pl) return undefined;
  const w = worldFrameOf(pl.matrix, end.frame);
  return { origin: w.origin as Vec3, axis: unit(w.normal) as Vec3 };
}

/** Resolve a sequence file against an assembly (CLI side; see the module comment for what differs from the viewer). */
export function resolveCore(asm: Assembly, file: SequenceFile, opts: { gap?: number; up?: Vec3 } = {}): CoreResolved {
  const gap = opts.gap ?? KEYFRAME_GAP_MM;
  const up = unit(opts.up ?? [0, 0, 1]) as Vec3;
  const defaults = { ...DEFAULTS, ...(file.defaults ?? {}) };
  const parents = new Map<string, string>();
  const steps: RStep[] = [];
  for (const { step, sequence } of flattenSequence(file)) {
    const seq = file.sequences.find((s) => s.id === sequence)!;
    const members: RMember[] = [];
    for (const m0 of step.members)
      for (const ref of m0.ref.startsWith("@") ? expandRefs(seq, [m0.ref]) : [m0.ref]) {
        const motion: Motion = { along: "up", distance: "auto", ...(step.motion ?? {}), ...(m0.motion ?? {}) } as Motion;
        const f = frameOf(asm, motion.along, up) ?? { origin: [0, 0, 0] as Vec3, axis: up };
        let dir = motion.axis === "-normal" ? (f.axis.map((x) => -x) as Vec3) : f.axis;
        let distance: number;
        if (step.plan === "stack") {
          dir = up;
          distance = typeof motion.distance === "number" ? motion.distance : gap;
        } else if (typeof motion.distance === "number") distance = motion.distance;
        else distance = (m0.rank !== undefined ? Math.abs(m0.rank) : 1) * gap * (step.kind === "insert" ? 1.6 : 1);
        if (m0.parent) parents.set(ref, m0.parent);
        members.push({ ref, parent: m0.parent, dir, distance });
      }
    steps.push({ id: step.id, members, planned: step.plan === "stack", still: members.every((x) => x.distance === 0) && !step.joints, durationS: step.durationS ?? defaults.durationS, ease: step.ease ?? "cubic", ...(step.joints ? { joints: step.joints } : {}) });
  }
  const weight = steps.map((s) => (s.still ? 0 : Math.max(0.05, s.durationS)));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  const windows: [number, number][] = steps.map(() => [0, 0]);
  let at = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    windows[i] = [at / total, (at + weight[i]) / total];
    at += weight[i];
  }
  const joints: RJoint[] = [];
  for (const seq of file.sequences)
    for (const j of seq.joints ?? ([] as JointDef[])) {
      const f = frameOf(asm, j.along, up);
      if (f) joints.push({ id: j.id, type: j.type, part: j.part, origin: f.origin, axis: f.axis, min: j.min, max: j.max, rest: j.rest ?? 0 });
    }
  return { steps, windows, parents, joints };
}

const ease = (u: number, kind: "cubic" | "linear") => (kind === "linear" ? u : u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
function stepOut(r: CoreResolved, i: number, t: number): number {
  const [a, b] = r.windows[i];
  if (b <= a) return t > a || t >= 1 ? 1 : 0;
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

/** Joint values at explode amount t: rest, then each step's keyframe as that step goes in (assembly order), then `asked` on top; all held at the stops. */
export function jointValuesAt(r: CoreResolved, t: number, asked: Record<string, number> = {}): Record<string, number> {
  const v: Record<string, number> = {};
  for (const j of r.joints) v[j.id] = j.rest;
  r.steps.forEach((s, i) => {
    if (!s.joints) return;
    const inAmount = 1 - ease(stepOut(r, i, t), s.ease);
    for (const [id, x] of Object.entries(s.joints)) if (id in v) v[id] = v[id] + (x - v[id]) * inAmount;
  });
  for (const [id, x] of Object.entries(asked)) if (id in v) v[id] = x;
  for (const j of r.joints) v[j.id] = holdAtStops(j, v[j.id]).held;
  return v;
}

/** Per part, the world delta (row-major) at explode amount t with joint values; and planned members that are apart. */
export function poseCore(r: CoreResolved, t: number, asked: Record<string, number> = {}): { deltas: Map<string, M4>; apart: Set<string>; joints: Record<string, number> } {
  const own = new Map<string, M4>();
  const apart = new Set<string>();
  r.steps.forEach((s, i) => {
    const u = stepOut(r, i, t);
    if (u <= 0) return;
    const e = ease(u, s.ease);
    for (const m of s.members) {
      if (s.planned) apart.add(m.ref);
      if (e > 0 && m.distance) own.set(m.ref, translation([m.dir[0] * m.distance * e, m.dir[1] * m.distance * e, m.dir[2] * m.distance * e]));
    }
  });
  const values = jointValuesAt(r, t, asked);
  const jointDelta = new Map<string, M4>();
  for (const j of r.joints) {
    const q = values[j.id] - j.rest;
    if (!q) continue;
    jointDelta.set(j.part, j.type === "revolute" ? rotationAbout(j.axis, j.origin, q) : translation(j.axis.map((x) => x * q)));
  }
  const out = new Map<string, M4>();
  const visiting = new Set<string>();
  const total = (ref: string): M4 | undefined => {
    if (out.has(ref)) return out.get(ref);
    if (visiting.has(ref)) return undefined;
    visiting.add(ref);
    const parent = r.parents.get(ref);
    const p = parent ? total(parent) : undefined;
    const jd = jointDelta.get(ref);
    const od = own.get(ref);
    visiting.delete(ref);
    if (!p && !jd && !od) return undefined;
    let m = p ?? IDENTITY;
    if (jd) m = mul(m, jd);
    if (od) m = mul(m, od);
    out.set(ref, m);
    return m;
  };
  for (const ref of new Set([...own.keys(), ...jointDelta.keys(), ...r.parents.keys()])) total(ref);
  return { deltas: out, apart, joints: values };
}

/** Every keyframe of a resolved sequence (see the module comment). */
export function sequenceKeyframes(r: CoreResolved): Keyframe[] {
  const out: Keyframe[] = [{ id: "assembled", label: "assembled", t: 0 }];
  r.steps.forEach((s, i) => {
    if (s.still) return;
    out.push({ id: `step:${s.id}`, label: `just before "${s.id}" is assembled`, t: r.windows[i][1] });
  });
  for (const j of r.joints) {
    if (j.min !== undefined) out.push({ id: `joint:${j.id}@min`, label: `joint "${j.id}" at its min stop ${j.min}`, t: 0, joints: { [j.id]: j.min } });
    if (j.max !== undefined) out.push({ id: `joint:${j.id}@max`, label: `joint "${j.id}" at its max stop ${j.max}`, t: 0, joints: { [j.id]: j.max } });
  }
  return out;
}

/** A keyframe by id, or a number t in [0, 1] (`--at`). */
export function keyframeAt(r: CoreResolved, at: string): Keyframe | undefined {
  const n = Number(at);
  if (at.trim() !== "" && Number.isFinite(n)) return { id: `t=${Math.min(1, Math.max(0, n))}`, label: `explode amount ${n}`, t: Math.min(1, Math.max(0, n)) };
  return sequenceKeyframes(r).find((k) => k.id === at || k.id === `step:${at}`);
}

/** A delta applied to a placement: world pose = delta x placement (row-major). */
export const posed = (delta: M4 | undefined, placement: readonly number[]): M4 => (delta ? mul(delta, placement as number[]) : [...placement]);
/** Relative transform taking b's body frame into a's (both world poses rigid). */
export const relative = (a: readonly number[], b: readonly number[]): M4 => mul(invertRigid(a), b as number[]);
export { applyPoint };

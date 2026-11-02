/**
 * Edits on a generated sequence (PB-1183). SHARED FILE: byte for byte the same
 * in protoboard-stack `packages/core/src/sequence/` and uhd-viewer
 * `src/cad/sequence/`. Pure.
 *
 * The generated default is never edited by hand: people and agents write
 * `SequencePatch[]` (in `src/assembly.uhd.ts` or a sibling patch file), keyed
 * by step id, and every build applies them to the regenerated default. Step
 * ids come from link ids, so an edit survives regeneration while the link is
 * there; an edit that names a step, member or sequence that no longer exists
 * is reported (`SEQUENCE_PATCH_*`) and skipped, never guessed.
 */
import type { AssemblySequence, Member, PartRef, SeqStep, SequenceEdit, SequenceFile, SequencePatch, SequenceProblem, Vec3 } from "./types.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Expand `@group` refs of a sequence to their member refs. */
export function expandRefs(seq: AssemblySequence, refs: readonly PartRef[]): PartRef[] {
  const out: PartRef[] = [];
  for (const r of refs) {
    const g = r.startsWith("@") ? seq.groups?.find((x) => x.id === r) : undefined;
    for (const x of g ? g.members : [r]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** A step's members with the step's motion folded into each (so they keep it when moved to another step). */
const withOwnMotion = (step: SeqStep): Member[] => step.members.map((m) => (step.motion ? { ...m, motion: { ...step.motion, ...(m.motion ?? {}) } } : m));

/**
 * Apply patches in order. Returns a new file (the input is not changed), the
 * number of edits applied, and a problem per edit that could not apply.
 * `label` names the patch source in problems (a file name).
 */
export function applyPatches(file: SequenceFile, patches: readonly SequencePatch[], label?: string): { file: SequenceFile; applied: number; problems: SequenceProblem[] } {
  const out = clone(file);
  const problems: SequenceProblem[] = [];
  let applied = 0;
  let editNo = 0;
  for (const patch of patches) {
    const seqId = patch.sequence ?? out.main;
    const seq = out.sequences.find((s) => s.id === seqId);
    if (!seq) {
      problems.push({ code: "SEQUENCE_PATCH_UNKNOWN_SEQUENCE", severity: "warning", message: `no sequence "${seqId}" (known: ${out.sequences.map((s) => s.id).join(", ")})`, patch: label });
      editNo += patch.edits?.length ?? 0;
      continue;
    }
    for (const edit of patch.edits ?? []) {
      const n = editNo++;
      const problem = applyEdit(seq, edit);
      if (problem) problems.push({ ...problem, edit: n, ...(label ? { patch: label } : {}) });
      else applied++;
    }
  }
  return { file: out, applied, problems };
}

const index = (seq: AssemblySequence, id: string) => seq.steps.findIndex((s) => s.id === id);
const unknown = (id: string, seq: AssemblySequence): Omit<SequenceProblem, "edit"> => ({
  code: "SEQUENCE_PATCH_UNKNOWN_STEP",
  severity: "warning",
  message: `no step "${id}" in sequence "${seq.id}"${nearest(id, seq)}`,
  step: id,
});
/** " (did you mean ...)" from the steps with the same suffix after the colon. */
function nearest(id: string, seq: AssemblySequence): string {
  const tail = id.split(":").pop() ?? id;
  const like = seq.steps.map((s) => s.id).filter((s) => s.endsWith(tail) || tail.endsWith(s.split(":").pop() ?? s));
  return like.length ? `; did you mean ${like.slice(0, 3).join(", ")}?` : "";
}

/** Where to put a step: before or after another (default: the end). */
function slot(seq: AssemblySequence, before?: string, after?: string): number | Omit<SequenceProblem, "edit"> {
  if (before !== undefined) {
    const i = index(seq, before);
    return i < 0 ? unknown(before, seq) : i;
  }
  if (after !== undefined) {
    const i = index(seq, after);
    return i < 0 ? unknown(after, seq) : i + 1;
  }
  return seq.steps.length;
}

function applyEdit(seq: AssemblySequence, edit: SequenceEdit): Omit<SequenceProblem, "edit"> | undefined {
  if ("set" in edit) {
    const i = index(seq, edit.step);
    if (i < 0) return unknown(edit.step, seq);
    const { ...set } = edit.set as Record<string, unknown>;
    delete set.id;
    delete set.members;
    delete set.source;
    seq.steps[i] = { ...seq.steps[i], ...(set as Partial<SeqStep>) };
    return undefined;
  }
  if ("rename" in edit) {
    const i = index(seq, edit.rename);
    if (i < 0) return unknown(edit.rename, seq);
    if (index(seq, edit.to) >= 0) return { code: "SEQUENCE_PATCH_DUPLICATE_STEP", severity: "warning", message: `a step "${edit.to}" already exists`, step: edit.to };
    seq.steps[i] = { ...seq.steps[i], id: edit.to };
    return undefined;
  }
  if ("move" in edit) {
    const i = index(seq, edit.move);
    if (i < 0) return unknown(edit.move, seq);
    const [step] = seq.steps.splice(i, 1);
    const at = slot(seq, edit.before, edit.after);
    if (typeof at !== "number") {
      seq.steps.splice(i, 0, step);
      return at;
    }
    seq.steps.splice(at, 0, step);
    return undefined;
  }
  if ("merge" in edit) {
    const missing = edit.merge.find((id) => index(seq, id) < 0);
    if (missing !== undefined) return unknown(missing, seq);
    if (!edit.merge.length) return { code: "SEQUENCE_PATCH_EMPTY", severity: "warning", message: "merge names no steps" };
    if (index(seq, edit.into) >= 0 && !edit.merge.includes(edit.into)) return { code: "SEQUENCE_PATCH_DUPLICATE_STEP", severity: "warning", message: `a step "${edit.into}" already exists`, step: edit.into };
    const steps = edit.merge.map((id) => seq.steps[index(seq, id)]);
    const at = Math.min(...edit.merge.map((id) => index(seq, id)));
    const merged: SeqStep = {
      ...steps[0],
      id: edit.into,
      title: edit.title ?? steps[0].title,
      members: steps.flatMap(withOwnMotion),
      motion: undefined,
      links: [...new Set(steps.flatMap((s) => s.links ?? []))],
      source: "authored",
    };
    if (steps.some((s) => s.kind === "fasten")) merged.stagger = steps.find((s) => s.stagger !== undefined)?.stagger;
    delete merged.motion;
    seq.steps = seq.steps.filter((s) => !edit.merge.includes(s.id));
    seq.steps.splice(at, 0, merged);
    return undefined;
  }
  if ("split" in edit) {
    const i = index(seq, edit.split);
    if (i < 0) return unknown(edit.split, seq);
    const step = seq.steps[i];
    const own = withOwnMotion(step);
    const parts = edit.by.map((refs) => expandRefs(seq, refs));
    const missing = parts.flat().find((r) => !own.some((m) => m.ref === r));
    if (missing !== undefined) return { code: "SEQUENCE_PATCH_UNKNOWN_MEMBER", severity: "warning", message: `step "${step.id}" has no member "${missing}"`, step: step.id };
    const taken = new Set(parts.flat());
    const rest = own.filter((m) => !taken.has(m.ref));
    const groups = [...parts.map((refs) => own.filter((m) => refs.includes(m.ref))), ...(rest.length ? [rest] : [])];
    const ids = groups.map((_, k) => edit.ids?.[k] ?? `${step.id}#${k + 1}`);
    const clash = ids.find((id) => id !== step.id && index(seq, id) >= 0);
    if (clash) return { code: "SEQUENCE_PATCH_DUPLICATE_STEP", severity: "warning", message: `a step "${clash}" already exists`, step: clash };
    const made: SeqStep[] = groups.map((members, k) => {
      const s: SeqStep = { ...step, id: ids[k], title: edit.titles?.[k] ?? `${step.title} (${k + 1} of ${groups.length})`, members, source: "authored" };
      delete s.motion;
      return s;
    });
    seq.steps.splice(i, 1, ...made);
    return undefined;
  }
  if ("insert" in edit) {
    if (index(seq, edit.insert.id) >= 0) return { code: "SEQUENCE_PATCH_DUPLICATE_STEP", severity: "warning", message: `a step "${edit.insert.id}" already exists`, step: edit.insert.id };
    const at = slot(seq, edit.before, edit.after);
    if (typeof at !== "number") return at;
    seq.steps.splice(at, 0, { ...edit.insert, members: edit.insert.members ?? [], source: edit.insert.source ?? "authored" });
    return undefined;
  }
  if ("remove" in edit) {
    const i = index(seq, edit.remove);
    if (i < 0) return unknown(edit.remove, seq);
    seq.steps.splice(i, 1);
    return undefined;
  }
  if ("explode" in edit) {
    // how a member leaves in the exploded view (R2-E, H2): every member the ref names, in every step of the sequence
    const refs = expandRefs(seq, [edit.explode]);
    const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.hypot(v[0], v[1], v[2]) > 1e-9;
    if (edit.direction !== undefined && !vec(edit.direction)) return { code: "SEQUENCE_PATCH_BAD_EXPLODE", severity: "warning", message: `explode "${edit.explode}": direction is three finite numbers, not all zero` };
    if (edit.distance !== undefined && !(typeof edit.distance === "number" && Number.isFinite(edit.distance) && edit.distance >= 0)) return { code: "SEQUENCE_PATCH_BAD_EXPLODE", severity: "warning", message: `explode "${edit.explode}": distance is a number of mm, 0 or more` };
    let hit = 0;
    for (const step of seq.steps)
      for (const m of step.members) {
        if (!refs.includes(m.ref)) continue;
        m.explode = { ...(m.explode ?? {}), ...(edit.direction ? { direction: [edit.direction[0], edit.direction[1], edit.direction[2]] as Vec3 } : {}), ...(edit.distance !== undefined ? { distance: edit.distance } : {}) };
        hit++;
      }
    if (!hit) return { code: "SEQUENCE_PATCH_UNKNOWN_MEMBER", severity: "warning", message: `no step of sequence "${seq.id}" moves "${edit.explode}" (a base part does not move)` };
    return undefined;
  }
  if ("joint" in edit) {
    const j = edit.joint;
    if (j.min !== undefined && j.max !== undefined && j.min > j.max) return { code: "SEQUENCE_PATCH_BAD_JOINT", severity: "warning", message: `joint "${j.id}": min ${j.min} is above max ${j.max}` };
    seq.joints = [...(seq.joints ?? []).filter((x) => x.id !== j.id), { ...j, limitsFrom: j.limitsFrom ?? "sequence" }];
    return undefined;
  }
  return { code: "SEQUENCE_PATCH_UNKNOWN_EDIT", severity: "warning", message: `unknown edit ${JSON.stringify(edit).slice(0, 80)}` };
}

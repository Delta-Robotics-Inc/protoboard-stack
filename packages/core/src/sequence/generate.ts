/**
 * The default assembly sequence from a model's mates and fastener stacks
 * (PB-1183). SHARED FILE: byte for byte the same in protoboard-stack
 * `packages/core/src/sequence/` and uhd-viewer `src/cad/sequence/` (the viewer
 * runs it when a bundle comes without a built sequence.json). Pure: input is
 * assemble()'s output, nothing is read from disk.
 *
 * Method (explode-sequencing.md 5.3, in our own words):
 * - the body placed without a link is the base; the mate tree is walked
 *   breadth first from it, siblings in the order their links are declared;
 * - every mate that places a body gives a `fit:<link>` step (an `insert` when
 *   a shaft is involved); its fastener stack gives a `fasten:<link>` step once
 *   every body on that joint (the structure frame) has been fitted, with one
 *   group per harness child (four screws are one group);
 * - members carry their stacking rank along the joint, ranked as ext-docs
 *   figures rank them, so a fully exploded view is the docs' column; screws
 *   and nuts whose module states a pitch turn out at that pitch;
 * - a module whose bodies mate among themselves and join the rest through one
 *   link is a sub-assembly: a sequence of its own, fitted as one step;
 * - bodies a display hint places (no mate) get `place:<key>` steps that the
 *   viewer's stack planner orders and spaces.
 */
import type { Assembly, GeometryFrame, HardwarePlacement, Mat4, MateEdge, ModuleDef } from "./uhd.js";
import { DEFAULTS, SEQUENCE_SCHEMA, type AssemblySequence, type Group, type Member, type SeqStep, type SequenceFile } from "./types.js";

export interface GenerateOptions {
  /** The instance path assemble() placed from. */
  root: string[];
  /** Placement keys a display hint fixed (no mate places them). */
  hinted?: Iterable<string>;
  /** Who generated it (recorded). */
  by?: string;
  /** Digest of the model it was generated from (staleness). */
  modelDigest?: string;
  /** Cap on screw turns shown (default DEFAULTS.maxTurns). */
  maxTurns?: number;
}

/** Placement key of an instance path and body artifact (UHD bodyKey). */
export const placementKey = (path: string[], artifact?: string): string => path.join("/") + (artifact ? `#${artifact}` : "");

/** Hardware keys as ext-docs makes them: `<harness>/<child>#<n>`, n from 1 in assemble() order. */
export function hardwareKeys(hardware: readonly HardwarePlacement[]): string[] {
  const counters = new Map<string, number>();
  return hardware.map((h) => {
    const base = `${h.harness}/${h.child}`;
    const n = (counters.get(base) ?? 0) + 1;
    counters.set(base, n);
    return `${base}#${n}`;
  });
}

/** Row-major UHD Mat4 applied to a point. */
function apply(m: Mat4, p: readonly number[]): number[] {
  const a = m as unknown as number[];
  return [a[0] * p[0] + a[1] * p[1] + a[2] * p[2] + a[3], a[4] * p[0] + a[5] * p[1] + a[6] * p[2] + a[7], a[8] * p[0] + a[9] * p[1] + a[10] * p[2] + a[11]];
}

/** An interface frame's origin and unit normal in world (assembly root) coordinates. */
export function worldFrameOf(m: Mat4, f: GeometryFrame): { origin: number[]; normal: number[] } {
  const o = apply(m, f.origin);
  const tip = apply(m, [f.origin[0] + f.normal[0], f.origin[1] + f.normal[1], f.origin[2] + f.normal[2]]);
  const n = [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return { origin: o, normal: n.map((x) => x / len) };
}

const isStructure = (e: MateEdge["a"]) => Boolean(e.iface.protocols?.some((p) => p.type === "bolt_pattern" && p.roles?.includes("structure")));
/** The end a fastener stack is measured from: the bolt pattern's structure end, else end a (ext-docs `mateEnds`). */
export const structureEnd = (m: MateEdge): MateEdge["a"] => (isStructure(m.b) && !isStructure(m.a) ? m.b : m.a);
const endKey = (e: MateEdge["a"]) => placementKey(e.path, e.frame.artifact);
const hasShaft = (m: MateEdge) => [m.a, m.b].some((e) => e.iface.protocols?.some((p) => p.type === "shaft"));

/** A thread's pitch (mm) and hand, when the part's module states it ("M3 x 0.5", "M5x0.8 LH"). */
export function threadOf(def: ModuleDef): { pitchMm: number; hand: "right" | "left" } | undefined {
  const texts: string[] = [];
  const scan = (params: Record<string, unknown> | undefined) => {
    for (const [k, v] of Object.entries(params ?? {})) if (typeof v === "string" && /thread/i.test(k)) texts.push(v);
  };
  for (const t of def.traits ?? []) scan(t.params as Record<string, unknown> | undefined);
  for (const i of def.interfaces ?? []) for (const t of i.traits ?? []) scan(t.params as Record<string, unknown> | undefined);
  for (const s of texts) {
    const m = /M\s?\d+(?:\.\d+)?\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(s);
    if (m) return { pitchMm: Number(m[1]), hand: /\bLH\b|left/i.test(s) ? "left" : "right" };
  }
  return undefined;
}

/** Turned when taken apart: screws, bolts and nuts (not spacers, standoffs, grommets or washers). */
export function isTurned(def: ModuleDef): boolean {
  const tags = (def.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => /spacer|standoff|grommet|washer/.test(t))) return false;
  return tags.some((t) => t === "screw" || t === "bolt" || t === "nut" || t === "lock-nut");
}

/** "arm_fl/motor" → "arm fl motor"; a short name for generated titles. */
const label = (key: string) => key.replace(/#.*$/, "").replace(/[/_]+/g, " ").trim() || "base";

interface Joint {
  key: string;
  origin: number[];
  normal: number[];
  structure: string;
}

/** Generate the default sequence file (no patches). */
export function generateSequence(asm: Assembly, options: GenerateOptions): SequenceFile {
  const maxTurns = options.maxTurns ?? DEFAULTS.maxTurns;
  const hinted = new Set(options.hinted ?? []);
  const placement = new Map(asm.placements.map((p) => [p.key, p]));
  const mateById = new Map(asm.mates.map((m, i) => [m.linkId, { m, i }]));
  const hwKeys = hardwareKeys(asm.hardware);

  // the mate tree: each body placed by a link, under the body at the link's other end
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const p of asm.placements) {
    if (!p.via) continue;
    const m = mateById.get(p.via)?.m;
    if (!m) continue;
    const other = endKey(m.a) === p.key ? m.b : m.a;
    const parent = endKey(other);
    if (!placement.has(parent)) continue;
    parentOf.set(p.key, parent);
    children.set(parent, [...(children.get(parent) ?? []), p.key]);
  }
  const declIndex = (key: string) => mateById.get(placement.get(key)?.via ?? "")?.i ?? Number.MAX_SAFE_INTEGER;
  for (const list of children.values()) list.sort((a, b) => declIndex(a) - declIndex(b));
  const bases = asm.placements.filter((p) => !p.via && !hinted.has(p.key)).map((p) => p.key);
  if (!bases.length && asm.placements.length) bases.push(asm.placements[0].key);

  // breadth first from the base
  const order: string[] = [];
  const seen = new Set<string>(bases);
  const queue = [...bases];
  while (queue.length) {
    const k = queue.shift()!;
    for (const c of children.get(k) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      order.push(c);
      queue.push(c);
    }
  }

  // joints (structure frames) and every part's rank along its joint, as ext-docs figures rank them
  const joints = new Map<string, Joint>();
  const jointOfLink = new Map<string, Joint>();
  for (const m of asm.mates) {
    const s = structureEnd(m);
    const sKey = endKey(s);
    const pl = placement.get(sKey);
    if (!pl) continue;
    const jk = `${sKey}.${s.iface.id}`;
    const j = joints.get(jk) ?? { key: jk, ...worldFrameOf(pl.matrix, s.frame), structure: sKey };
    joints.set(jk, j);
    jointOfLink.set(m.linkId, j);
  }
  const posAlong = (j: Joint, p: number[]) => (p[0] - j.origin[0]) * j.normal[0] + (p[1] - j.origin[1]) * j.normal[1] + (p[2] - j.origin[2]) * j.normal[2];
  const position = new Map<string, number>(); // part ref -> position along its joint
  for (const m of asm.mates) {
    const j = jointOfLink.get(m.linkId);
    if (!j) continue;
    for (const end of [m.a, m.b]) {
      const k = endKey(end);
      const pl = placement.get(k);
      if (pl?.via === m.linkId) position.set(k, posAlong(j, worldFrameOf(pl.matrix, end.frame).origin));
    }
  }
  asm.hardware.forEach((h, i) => {
    const j = jointOfLink.get(h.linkId);
    const a = h.matrix as unknown as number[];
    if (j) position.set(hwKeys[i], posAlong(j, [a[3], a[7], a[11]]));
  });
  const round = (x: number) => Math.round(x * 100) / 100;
  const rankOf = new Map<string, number>();
  const membersOfJoint = new Map<string, string[]>();
  for (const m of asm.mates) {
    const j = jointOfLink.get(m.linkId);
    if (!j) continue;
    const list = membersOfJoint.get(j.key) ?? [];
    const mover = [m.a, m.b].map(endKey).find((k) => placement.get(k)?.via === m.linkId);
    if (mover && position.has(mover)) list.push(mover);
    asm.hardware.forEach((h, i) => {
      if (h.linkId === m.linkId && position.has(hwKeys[i])) list.push(hwKeys[i]);
    });
    membersOfJoint.set(j.key, list);
  }
  for (const list of membersOfJoint.values()) {
    const ps = list.map((k) => round(position.get(k)!));
    const below = [...new Set(ps.filter((p) => p < -0.01))].sort((a, b) => b - a);
    const above = [...new Set(ps.filter((p) => p >= -0.01))].sort((a, b) => a - b);
    list.forEach((k, i) => rankOf.set(k, ps[i] < -0.01 ? -(below.indexOf(ps[i]) + 1) : above.indexOf(ps[i]) + 1));
  }

  // sub-assemblies: a module instance whose placed bodies mate among themselves (links it declares) and join the rest through one link
  const placedByLink = asm.placements.filter((p) => p.via && parentOf.has(p.key));
  const prefixes = new Set<string>();
  for (const p of placedByLink) for (let k = 1; k < p.path.length; k++) prefixes.add(p.path.slice(0, k).join("/"));
  const inside = (key: string, prefix: string) => key.startsWith(prefix + "/");
  const subs = new Map<string, { base: string; join: string }>();
  for (const prefix of [...prefixes].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const members = placedByLink.filter((p) => inside(p.key, prefix));
    if (members.length < 2) continue;
    const joining = members.filter((p) => !inside(p.via!, prefix) || !inside(parentOf.get(p.key)!, prefix));
    if (joining.length !== 1) continue;
    if (members.some((p) => p !== joining[0] && !inside(parentOf.get(p.key)!, prefix))) continue;
    subs.set(prefix, { base: joining[0].key, join: joining[0].via! });
  }
  /** The innermost sub-assembly a link is internal to ("" = main). */
  const sequenceOfLink = (linkId: string): string => {
    const m = mateById.get(linkId)?.m;
    let best = "";
    for (const [prefix, sub] of subs) {
      if (sub.join === linkId) continue;
      const ends = m ? [endKey(m.a), endKey(m.b)] : [];
      if (inside(linkId, prefix) && ends.every((k) => inside(k, prefix)) && prefix.length > best.length) best = prefix;
    }
    return best;
  };
  /** The sequence a sub-assembly's joining step belongs to: the innermost sub-assembly strictly containing it. */
  const parentSequenceOf = (prefix: string): string => {
    let best = "";
    for (const other of subs.keys()) if (other !== prefix && inside(prefix, other) && other.length > best.length) best = other;
    return best;
  };

  // steps, per sequence, in breadth-first order
  const sequences = new Map<string, AssemblySequence>();
  const seqFor = (id: string): AssemblySequence => {
    let s = sequences.get(id);
    if (!s) {
      const sub = subs.get(id);
      s = { id: id || "main", title: id ? `Assemble ${label(id)}` : undefined, scope: id, base: sub ? [sub.base] : [...bases], groups: [], steps: [] };
      sequences.set(id, s);
    }
    return s;
  };
  seqFor("");
  const hardwareOf = (linkId: string) => asm.hardware.map((h, i) => ({ h, key: hwKeys[i] })).filter((x) => x.h.linkId === linkId);
  const fitStep = (key: string, m: MateEdge, sub: string | undefined): SeqStep => {
    const parent = parentOf.get(key);
    const insert = hasShaft(m);
    const member: Member = { ref: key, ...(rankOf.has(key) ? { rank: rankOf.get(key) } : {}), ...(parent ? { parent } : {}) };
    // a fit along the joint's axis: the structure frame when the mover is on it, else the parent's frame
    const along = jointOfLink.get(m.linkId) && endKey(structureEnd(m)) !== key ? ({ mate: m.linkId, end: "structure" } as const) : ({ mate: m.linkId, end: "parent" } as const);
    const step: SeqStep = {
      id: `fit:${m.linkId}`,
      title: sub ? `Fit the ${label(sub)} assembly` : insert ? `Slide the ${label(key)} on` : `Fit the ${label(key)}`,
      kind: sub ? "subassembly" : insert ? "insert" : "place",
      members: [member],
      motion: { along, distance: "auto" },
      links: [m.linkId],
      source: "generated",
    };
    if (m.harness) step.harness = m.harness;
    if (sub) step.sequence = sub;
    return step;
  };
  const fastenStep = (m: MateEdge, seq: AssemblySequence): SeqStep | undefined => {
    const hw = hardwareOf(m.linkId);
    if (!hw.length) return undefined;
    const j = jointOfLink.get(m.linkId);
    const members: Member[] = hw.map(({ h, key }) => {
      const rank = rankOf.get(key);
      const thread = isTurned(h.def) ? threadOf(h.def) : undefined;
      const motion: Member["motion"] = {};
      if (rank !== undefined && rank < 0) motion.axis = "-normal";
      if (thread) Object.assign(motion, { turns: maxTurns, pitchMm: thread.pitchMm, hand: thread.hand });
      return { ref: key, ...(rank !== undefined ? { rank } : {}), ...(j ? { parent: j.structure } : {}), ...(Object.keys(motion).length ? { motion } : {}) };
    });
    // one group per harness child: the four screws of a pattern go together
    const groupIds: string[] = [];
    for (const { h, key } of hw) {
      const id = `@${h.harness}/${h.child}`;
      let g: Group | undefined = seq.groups!.find((x) => x.id === id);
      if (!g) {
        g = { id, members: [], title: h.def.name };
        seq.groups!.push(g);
      }
      if (!g.members.includes(key)) g.members.push(key);
      if (!groupIds.includes(id)) groupIds.push(id);
    }
    const mover = [m.a, m.b].map(endKey).find((k) => placement.get(k)?.via === m.linkId);
    const step: SeqStep = {
      id: `fasten:${m.linkId}`,
      title: `Fasten the ${label(mover ?? endKey(structureEnd(m)))}`,
      kind: "fasten",
      members,
      motion: { along: { mate: m.linkId, end: "structure" }, distance: "auto" },
      links: [m.linkId],
      stagger: 0.06,
      callout: `${hw.length} part(s): ${groupIds.map((g) => g.slice(1).split("/").pop()).join(", ")}`,
      source: "generated",
    };
    if (m.harness) step.harness = m.harness;
    return step;
  };

  // which mates are fitted where: each body by its link (a sub-assembly's base by its joining link, as one step)
  const fitsOfJoint = new Map<string, string[]>(); // joint key -> links still to fit, per sequence
  const pending = new Map<string, Set<string>>(); // sequence|joint -> links not fitted yet
  const seqOfFit = new Map<string, string>(); // link -> sequence its fit (or subassembly step) is in
  for (const key of order) {
    const via = placement.get(key)!.via!;
    const sub = [...subs.entries()].find(([, s]) => s.base === key)?.[0];
    seqOfFit.set(via, sub !== undefined ? parentSequenceOf(sub) : sequenceOfLink(via));
  }
  for (const [link, seqId] of seqOfFit) {
    const j = jointOfLink.get(link);
    if (!j) continue;
    const pk = `${seqId}|${j.key}`;
    pending.set(pk, (pending.get(pk) ?? new Set()).add(link));
    fitsOfJoint.set(j.key, [...(fitsOfJoint.get(j.key) ?? []), link]);
  }
  const fastened = new Set<string>();
  const fastenWhenDone = (seqId: string, link: string) => {
    const j = jointOfLink.get(link);
    const pk = j ? `${seqId}|${j.key}` : "";
    const left = pending.get(pk);
    left?.delete(link);
    if (left && left.size) return;
    const seq = seqFor(seqId);
    const links = j ? (fitsOfJoint.get(j.key) ?? []).filter((l) => seqOfFit.get(l) === seqId) : [link];
    for (const l of links) {
      if (fastened.has(l)) continue;
      const m = mateById.get(l)?.m;
      const step = m && fastenStep(m, seq);
      if (step) seq.steps.push(step);
      fastened.add(l);
    }
  };
  for (const key of order) {
    const via = placement.get(key)!.via!;
    const m = mateById.get(via)!.m;
    const seqId = seqOfFit.get(via)!;
    const sub = [...subs.entries()].find(([, s]) => s.base === key)?.[0];
    seqFor(seqId).steps.push(fitStep(key, m, sub));
    if (sub !== undefined) seqFor(sub);
    fastenWhenDone(seqId, via);
  }
  // links that place nothing (a mate closing a loop) still carry hardware: fastened at the end of their sequence
  for (const m of asm.mates) {
    if (fastened.has(m.linkId) || seqOfFit.has(m.linkId)) continue;
    const seq = seqFor(sequenceOfLink(m.linkId));
    const step = fastenStep(m, seq);
    if (step) seq.steps.push(step);
    fastened.add(m.linkId);
  }
  // what no mate places: the stack planner orders it at view time
  const main = seqFor("");
  for (const p of asm.placements) {
    if (!hinted.has(p.key) || p.via) continue;
    main.steps.push({ id: `place:${p.key}`, title: `Place the ${label(p.key)}`, kind: "place", members: [{ ref: p.key }], motion: { along: "up", distance: "auto" }, plan: "stack", source: "generated" });
  }

  const list = [...sequences.values()].map((s) => (s.groups?.length ? s : { ...s, groups: undefined }));
  for (const s of list) if (!s.groups) delete s.groups;
  return {
    schema: SEQUENCE_SCHEMA,
    main: "main",
    sequences: [list.find((s) => s.id === "main")!, ...list.filter((s) => s.id !== "main").sort((a, b) => a.id.localeCompare(b.id))],
    defaults: { ...DEFAULTS, maxTurns },
    root: [...options.root],
    generated: { by: options.by ?? "protoboard sequence generator v0", ...(options.modelDigest ? { modelDigest: options.modelDigest } : {}) },
  };
}

/** Every step of a sequence with its nested sub-assembly steps first, in assembly order (what a player plays). */
export function flattenSequence(file: SequenceFile, id = file.main, levels: "all" | "one" = "all"): { step: SeqStep; sequence: string; depth: number }[] {
  const out: { step: SeqStep; sequence: string; depth: number }[] = [];
  const walk = (sid: string, depth: number, seen: Set<string>) => {
    const seq = file.sequences.find((s) => s.id === sid);
    if (!seq || seen.has(sid)) return;
    const next = new Set(seen).add(sid);
    for (const step of seq.steps) {
      if (step.sequence && levels === "all") walk(step.sequence, depth + 1, next);
      out.push({ step, sequence: sid, depth });
    }
  };
  walk(id, 0, new Set());
  return out;
}

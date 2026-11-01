/**
 * Mates feeding the sequence (PB-1185). Core only. The generator
 * (`generate.ts`, shared with the viewer) still walks assemble()'s UHD mates
 * and fastener stacks; this adds what the mates module declares on top:
 *
 * - a driving mate (trait or sidecar, not suppressed, not inferred) of kind
 *   revolute, prismatic or cylindrical, or a coaxial or planar one with a
 *   rotate limit, becomes a `JointDef` on the moving end (`b`), its limits as
 *   hard stops (deg and mm after `normalizeLimit`), its axis the `a` frame's
 *   z axis through the `a` frame's origin, written as a world line
 *   (`FrameRef` `{ at, axis }`, assembly mm, Z up);
 * - a body no UHD mate places (the generator gave it a planned `place:` step,
 *   the stack planner's) that a driving mate joins to a placed body gets a
 *   `fit:mate:<id>` step instead, along the mate's axis: the mate now says how
 *   it goes on, where before only the planner guessed.
 *
 * A joint the sequence already declares (an authored `SequencePatch` joint)
 * keeps the authored one: SEQUENCE_MATE_JOINT_AUTHORED (info).
 */
import type { Assembly } from "@deltarobotics/uhd";
import { applyDir, applyPoint, normalizeLimit, unit } from "../mates/frames.js";
import { drives } from "../mates/read.js";
import type { Mate } from "../mates/types.js";
import type { JointDef, SeqStep, SequenceFile, SequenceProblem, Vec3 } from "./types.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const label = (key: string) => key.replace(/#.*$/, "").replace(/[/_]+/g, " ").trim() || "base";
const keyOf = (e: Mate["a"]) => e.instance + (e.body ? `#${e.body}` : "");

export function applyMatesToSequence(file: SequenceFile, asm: Assembly, mates: readonly Mate[]): { file: SequenceFile; problems: SequenceProblem[]; joints: number; fits: number } {
  const out = clone(file);
  const problems: SequenceProblem[] = [];
  const main = out.sequences.find((s) => s.id === out.main);
  if (!main) return { file: out, problems, joints: 0, fits: 0 };
  const placement = new Map(asm.placements.map((p) => [p.key, p]));
  const authored = new Set(out.sequences.flatMap((s) => (s.joints ?? []).map((j) => j.id)));
  let joints = 0;
  let fits = 0;
  for (const m of mates) {
    if (!drives(m)) continue;
    const pa = placement.get(keyOf(m.a));
    const pb = placement.get(keyOf(m.b));
    if (!pa || !pb) {
      problems.push({ code: "SEQUENCE_MATE_UNPLACED", severity: "info", message: `mate "${m.id}": ${!pa ? keyOf(m.a) : keyOf(m.b)} is not placed in this assembly; the mate adds nothing to the sequence` });
      continue;
    }
    // the joint line in assembly coordinates (mm, Z up): a's frame through a's placement
    const at = applyPoint(pa.matrix as unknown as number[], m.a.frame.origin) as Vec3;
    const axis = unit(applyDir(pa.matrix as unknown as number[], m.a.frame.zAxis)) as Vec3;
    const along = { at, axis };
    const lim = (dof: "rotate" | "slide") => {
      const l = m.limits?.find((x) => x.dof === dof);
      return l ? normalizeLimit(l) : undefined;
    };
    const add = (id: string, type: JointDef["type"], dof: "rotate" | "slide") => {
      if (authored.has(id)) {
        problems.push({ code: "SEQUENCE_MATE_JOINT_AUTHORED", severity: "info", message: `joint "${id}": the sequence's own joint is kept over mate "${m.id}"` });
        return;
      }
      const l = lim(dof);
      main.joints = [...(main.joints ?? []).filter((j) => j.id !== id), { id, type, part: pb.key, along, ...(l?.min !== undefined ? { min: l.min } : {}), ...(l?.max !== undefined ? { max: l.max } : {}), ...(l && l.rest !== 0 ? { rest: l.rest } : {}), limitsFrom: `mate:${m.from ?? "trait"}` }];
      joints++;
    };
    if (m.kind === "revolute") add(m.id, "revolute", "rotate");
    else if (m.kind === "prismatic") add(m.id, "slider", "slide");
    else if (m.kind === "cylindrical") {
      add(`${m.id}:rotate`, "revolute", "rotate");
      add(`${m.id}:slide`, "slider", "slide");
    } else if ((m.kind === "coaxial" || m.kind === "planar") && lim("rotate")) add(`${m.id}:rotate`, "revolute", "rotate");
    // a body only the planner placed gets a fit along the mate
    if (!pb.via) {
      const i = main.steps.findIndex((s) => s.id === `place:${pb.key}` && s.plan === "stack");
      if (i >= 0) {
        const step: SeqStep = {
          id: `fit:mate:${m.id}`,
          title: `Fit the ${label(pb.key)}`,
          kind: m.kind === "coaxial" || m.kind === "cylindrical" || m.kind === "prismatic" ? "insert" : "place",
          members: [{ ref: pb.key, parent: pa.key }],
          motion: { along, distance: "auto" },
          links: m.link ? [m.link] : [],
          source: "generated",
        };
        main.steps.splice(i, 1, step);
        fits++;
      }
    }
  }
  return { file: out, problems, joints, fits };
}

/**
 * `protoboard mates ...` (PB-1185): the mates a project declares and the ones
 * the heuristics suggest.
 *
 *   protoboard mates list [--json]       declared mates (traits and sidecars, merged: trait beats sidecar), with problems
 *   protoboard mates suggest [--json]    heuristic suggestions (coaxial, hole patterns, planar contact), provenance
 *                                        inferred, written to .protoboard/build/mates-suggested.json (never source)
 *   protoboard mates validate [--json]   the validator alone; exit 1 on an error
 *
 * Registration in `cli/src/index.ts` is one case (handoffs.md, 2026-11-01 W4-E, for W4-D):
 *   case "mates": process.exitCode = await (await import("./mates.js")).matesCommand(cwd, args, out); return;
 * Flags are read from `args`, so the shared flag table does not change. Until `@protoboardai/core` exports
 * `./mates` (same handoff), core is imported by its path inside the repository.
 */
import { findProjectRoot, loadProject } from "@protoboardai/core";
// DEFAULT until W4-D adds the "./mates" subpath: an in-repo path (handoffs.md, W4-E)
import { mateDiagnostics, projectMates, suggestProjectMates, type Mate, type MateProblem } from "@protoboardai/core/mates";
import { assembleProject } from "@protoboardai/core/sequence";

type Out = (data: unknown, text: () => string) => void;

export const MATES_USAGE = "usage: protoboard mates list | suggest | validate [--json]";

const fmtVec = (v: number[]) => `[${v.map((x) => Number(x.toFixed(3))).join(", ")}]`;
const fmtMate = (m: Mate) => {
  const lim = (m.limits ?? []).map((l) => `${l.dof} ${l.min ?? "-inf"}..${l.max ?? "inf"} ${l.unit}${l.rest !== undefined ? ` (rest ${l.rest})` : ""}`).join("; ");
  return [
    `${m.id}  ${m.kind}  ${m.a.instance} -> ${m.b.instance}  [${m.from ?? "trait"}${m.provenance !== m.from ? `, ${m.provenance}` : ""}${m.confidence !== undefined ? ` ${m.confidence}` : ""}]${m.suppressed ? " (suppressed)" : ""}`,
    `    a frame origin ${fmtVec(m.a.frame.origin)} z ${fmtVec(m.a.frame.zAxis)} mm, Z up${m.link ? `; link ${m.link}` : ""}${lim ? `; limits ${lim}` : ""}`,
    ...(m.note ? [`    ${m.note}`] : []),
  ].join("\n");
};
const fmtProblem = (q: MateProblem) => `${q.severity.toUpperCase().padEnd(7)} ${q.code}  ${q.message}`;

/** Run `protoboard mates <sub>`; returns the exit code. */
export async function matesCommand(cwd: string, args: string[], out: Out): Promise<number> {
  const [sub] = args.filter((a) => !a.startsWith("--"));
  const root = findProjectRoot(cwd);
  if (!root) throw new Error("not in a Protoboard project (no protoboard.config.ts here or above)");
  if (sub !== "list" && sub !== "suggest" && sub !== "validate") throw new Error(MATES_USAGE);
  const p = await loadProject(root, { checks: false });
  const placed = assembleProject(p);
  if (!placed) throw new Error("the project has no root system to assemble");
  const { asm } = placed;
  const set = projectMates(p, asm);
  const errors = set.problems.filter((q) => q.severity === "error").length;
  switch (sub) {
    case "list": {
      out({ mates: set.mates, shadowed: set.shadowed, problems: set.problems, diagnostics: mateDiagnostics(set.problems) }, () =>
        [
          set.mates.length ? set.mates.map(fmtMate).join("\n") : "no mates declared (a `protoboard.mate` trait, or a <model>.mates.json sidecar beside a model)",
          ...(set.shadowed.length ? [`${set.shadowed.length} shadowed by a higher source: ${set.shadowed.map((s) => `${s.id} (${s.from} under ${s.byFrom})`).join(", ")}`] : []),
          ...set.problems.map(fmtProblem),
        ].join("\n"),
      );
      return errors ? 1 : 0;
    }
    case "validate": {
      out({ ok: !errors, mates: set.mates.length, problems: set.problems, diagnostics: mateDiagnostics(set.problems) }, () => (set.problems.length ? set.problems.map(fmtProblem).join("\n") : `${set.mates.length} mate(s), no problems`));
      return errors ? 1 : 0;
    }
    case "suggest": {
      const r = await suggestProjectMates(p, asm, { declared: set.mates });
      const f = r.file;
      out({ ...f, path: r.path }, () =>
        [
          `${f.counts.suggestions} suggestion(s) over ${f.counts.bodies} bodies (${f.counts.faces} faces: ${f.counts.planes} planes, ${f.counts.cylinders} cylinders, ${f.counts.patterns} hole patterns) in ${f.timings.totalMs} ms; ${f.counts.covered} more join bodies a UHD link already mates, ${f.counts.shadowed} shadowed by declared mates`,
          ...f.suggestions.map(fmtMate),
          ...(f.skipped.length ? [`skipped: ${f.skipped.map((s) => `${s.instance} (${s.reason})`).join(", ")}`] : []),
          `written: ${r.path} (provenance inferred: nothing moves or places from it until a person writes a trait or a sidecar)`,
        ].join("\n"),
      );
      return 0;
    }
  }
  return 0;
}

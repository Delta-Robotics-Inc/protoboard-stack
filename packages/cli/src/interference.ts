/**
 * `protoboard interference` (PB-1185): static interference at the assembly
 * sequence's keyframes (assembled, just before each step, each joint at its
 * stops), with the enclosure voxel field where ext-enclosure-cad generated an
 * enclosure (and a CAD Python runtime is present), and an AABB-then-BVH mesh
 * test for everything else. The report says which ran.
 *
 *   protoboard interference [--at <keyframe | t>] [--json] [--max-seconds N] [--contact-mm X] [--no-voxel]
 *                           [--voxel-mm R] [--max-voxels N] [--all]
 *
 *   --at           one keyframe: assembled, step:<id> (or the bare step id), joint:<id>@min|max, or a number t from 0 to 1
 *   --max-seconds  DEFAULT 120: the whole run's budget; keyframes after it are left out and the report says so
 *   --contact-mm   DEFAULT 0.1: below this penetration a hit is contact, not interference
 *   --voxel-mm     DEFAULT 0.5: the voxel cell asked for (it grows to stay under --max-voxels, DEFAULT 6,000,000)
 *   --all          the text lists intended hits (a link's own parts) and contacts too
 *
 * Exit code 1 when an interference that no link intends is found. Registration in `cli/src/index.ts`
 * (handoffs.md, 2026-11-01 W4-E, for W4-D):
 *   case "interference": process.exitCode = await (await import("./interference.js")).interferenceCommand(cwd, args, out); return;
 */
import { findProjectRoot, loadProject } from "@protoboardai/core";
// DEFAULT until W4-D adds the "./mates" subpath: an in-repo path (handoffs.md, W4-E)
import { runInterference, type InterferenceReport } from "@protoboardai/core/mates";
import { assembleProject, buildSequence } from "@protoboardai/core/sequence";

type Out = (data: unknown, text: () => string) => void;

export const INTERFERENCE_USAGE = "usage: protoboard interference [--at <keyframe|t>] [--json] [--max-seconds N] [--contact-mm X] [--no-voxel] [--voxel-mm R] [--max-voxels N] [--all]";

function flagValue(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[i + 1];
}
function numberFlag(args: string[], name: string): number | undefined {
  const v = flagValue(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} takes a positive number, not "${v}"`);
  return n;
}

/** The report as text: method, timings, then the hits per keyframe. */
export function formatInterference(r: InterferenceReport, all = false): string {
  const walls = r.method.walls ? `; enclosure walls: ${r.method.walls}${r.method.voxel ? ` (${r.method.voxel.resolutionMm ?? "?"} mm cells, ${r.method.voxel.cells ?? "?"} cells, ${r.method.voxel.ms} ms${r.method.voxel.error ? `; failed: ${r.method.voxel.error}` : ""})` : ""}` : "";
  const lines = [
    `method: pairs ${r.method.pairs} (AABB, then BVH triangles)${walls}`,
    `${r.bodies} bodies, ${r.triangles} triangles; load ${r.timings.loadMs} ms, BVH ${r.timings.bvhMs} ms, check ${r.timings.checkMs} ms over ${r.keyframes.length} keyframe(s)`,
    `${r.counts.interference} interference(s) no link intends, ${r.counts.intendedInterference} between parts a link joins (a screw in its hole), ${r.counts.contact} contact(s); depths are lower-bound estimates (sampled points), mm`,
  ];
  for (const k of r.keyframes) {
    const shown = k.hits.filter((h) => all || (h.status === "interference" && !h.intended));
    if (!shown.length && !all) continue;
    lines.push(`${k.id}  (${k.label}; ${k.ms} ms, ${k.candidates} candidate pair(s), ${k.tested} tested, ${k.reused} reused)`);
    for (const h of shown) lines.push(`  ${h.status.padEnd(12)} ${h.depthMm.toFixed(3)} mm  ${h.a} ~ ${h.b}${h.wall ? ` (wall ${h.wall})` : ""}${h.at ? ` at [${h.at.join(", ")}]` : ""}${h.intended ? `  intended: ${h.intended}` : ""}  [${h.method}]`);
  }
  if (r.skipped.length) lines.push(`skipped: ${r.skipped.map((s) => `${s.instance} (${s.reason})`).join(", ")}`);
  if (r.truncated) lines.push(r.truncated);
  return lines.join("\n");
}

/** Run `protoboard interference`; returns the exit code. */
export async function interferenceCommand(cwd: string, args: string[], out: Out): Promise<number> {
  const root = findProjectRoot(cwd);
  if (!root) throw new Error("not in a Protoboard project (no protoboard.config.ts here or above)");
  const p = await loadProject(root, { checks: false });
  const placed = assembleProject(p);
  const seq = await buildSequence(p);
  if (!placed || !seq) throw new Error("the project has no root system to assemble");
  const report = await runInterference(p, placed.asm, seq.file, {
    at: flagValue(args, "at"),
    contactMm: numberFlag(args, "contact-mm"),
    maxSeconds: numberFlag(args, "max-seconds"),
    noVoxel: args.includes("--no-voxel"),
    voxelMm: numberFlag(args, "voxel-mm"),
    maxVoxels: numberFlag(args, "max-voxels"),
  });
  out(report, () => formatInterference(report, args.includes("--all")));
  return report.counts.interference ? 1 : 0;
}

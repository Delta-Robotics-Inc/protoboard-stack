/**
 * The project's assembly sequence (PB-1183): generated from the assembled
 * system's mates and fastener stacks, patched by `src/assembly.uhd.ts` (or the
 * sibling `src/assembly.sequence.json`), written to
 * `.protoboard/build/sequence.json`. A build output: UHD and the project's
 * sources are only read.
 *
 * The assembly is placed the way the 3D viewer places it (uhd-viewer
 * `cad/scope.ts`): from the display file's `spatial.root` when it names one,
 * else the system itself when it has a body, else the top-level module with
 * the most interface frames; display placements fix what no mate places.
 *
 * R2-E (H2, 2026-11-02): the assembly script may ask for the radial explode
 * (`"explode": "radial"` beside `patches` in `src/assembly.sequence.json`, or
 * `export const sequenceExplode = "radial"` in `src/assembly.uhd.ts`): every
 * moving part then gets its way out from its mounting face (radial.ts) before
 * the patches apply, so an `explode` patch edit adjusts it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { assemble } from "@deltarobotics/uhd";
import { importTs } from "../load.js";
import { mateDiagnostics, projectMates } from "../mates/project.js";
import { assembleProject } from "./assemble.js";
import { clampSequenceJoints } from "./limits.js";
import { applyMatesToSequence } from "./mates.js";
import type { Project } from "../project.js";
import type { ProjectDiagnostic } from "../types.js";
import { generateSequence } from "./generate.js";
import { applyPatches } from "./patch.js";
import { projectRadialExplode } from "./radial.js";
import type { SequenceFile, SequencePatch, SequenceProblem } from "./types.js";

/** Where the build writes the sequence, project-relative. */
export const SEQUENCE_FILE = ".protoboard/build/sequence.json";
/** Patch sources, project-relative, in the order they apply. */
export const SEQUENCE_PATCH_FILES = ["src/assembly.uhd.ts", "src/assembly.sequence.json"];
export const SEQUENCE_GENERATOR = "@protoboardai/core sequence v0";

export { defaultSequenceRoot } from "./assemble.js";

/** sha256 of what the sequence is generated from: placements, mates and hardware (not the patches). */
function modelDigest(asm: ReturnType<typeof assemble>): string {
  const data = JSON.stringify({
    placements: asm.placements.map((p) => [p.key, p.via ?? null, p.matrix]),
    mates: asm.mates.map((m) => [m.linkId, m.harness ?? null, m.a.path, m.a.iface.id, m.b.path, m.b.iface.id]),
    hardware: asm.hardware.map((h) => [h.linkId, h.harness, h.child, h.def.id, h.atMm, h.direction]),
  });
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

function isPatchList(x: unknown): x is SequencePatch[] {
  return Array.isArray(x) && x.every((p) => p && typeof p === "object" && Array.isArray((p as SequencePatch).edits));
}

/** The patches a project declares, by file; a file that cannot be read is a problem, not a crash. */
export async function readSequencePatches(root: string): Promise<{ files: { file: string; patches: SequencePatch[] }[]; problems: SequenceProblem[]; explode?: "radial" }> {
  const files: { file: string; patches: SequencePatch[] }[] = [];
  const problems: SequenceProblem[] = [];
  // R2-E (H2): the script's explode mode (the last file that names one wins)
  let explode: "radial" | undefined;
  const mode = (v: unknown, rel: string) => {
    if (v === undefined) return;
    if (v === "radial") explode = "radial";
    else problems.push({ code: "SEQUENCE_PATCH_INVALID", severity: "warning", message: `${rel}: explode is "radial" (or left out), not ${JSON.stringify(v).slice(0, 40)}`, patch: rel });
  };
  for (const rel of SEQUENCE_PATCH_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      let value: unknown;
      if (rel.endsWith(".json")) {
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as unknown;
        value = Array.isArray(parsed) ? parsed : (parsed as { patches?: unknown }).patches;
        if (!Array.isArray(parsed)) mode((parsed as { explode?: unknown }).explode, rel);
      } else {
        const mod = await importTs<Record<string, unknown>>(abs);
        value = mod.sequencePatches ?? mod.default;
        mode(mod.sequenceExplode, rel);
      }
      if (value === undefined) continue; // the file declares other things (definitions), no patches
      if (!isPatchList(value)) {
        problems.push({ code: "SEQUENCE_PATCH_INVALID", severity: "warning", message: `${rel}: patches must be a SequencePatch[] (each with \`edits\`)`, patch: rel });
        continue;
      }
      files.push({ file: rel, patches: value });
    } catch (e) {
      problems.push({ code: "SEQUENCE_PATCH_INVALID", severity: "warning", message: `${rel}: ${(e as Error).message}`, patch: rel });
    }
  }
  return { files, problems, ...(explode ? { explode } : {}) };
}

export interface SequenceBuild {
  file: SequenceFile;
  /** Absolute path written (writeSequence only). */
  path?: string;
  steps: number;
  sequences: number;
  /** Problems as project diagnostics, for `project_check`-style reporting (the orchestrator wires them). */
  diagnostics: ProjectDiagnostic[];
}

/** What a build of the sequence may add (R2-E). */
export interface SequenceBuildOptions {
  /** "radial": every moving part's way out from its mounting face (radial.ts); default: what the assembly script says. */
  explode?: "radial" | "none";
}

/** Generate and patch the project's sequence (nothing written). Undefined when the project has no root system. */
export async function buildSequence(p: Project, options: SequenceBuildOptions = {}): Promise<SequenceBuild | undefined> {
  const placed = assembleProject(p);
  if (!placed) return undefined;
  const { asm, root, fixed } = placed;
  const generated = generateSequence(asm, { root, hinted: Object.keys(fixed), by: SEQUENCE_GENERATOR, modelDigest: modelDigest(asm) });
  const read = await readSequencePatches(p.root);
  let file = generated;
  let applied = 0;
  const problems = [...read.problems];
  // R2-E (H2): the radial explode first, so the script's `explode` edits adjust what it wrote
  const explode = options.explode ?? read.explode;
  if (explode === "radial") {
    const r = await projectRadialExplode(p, asm, file);
    file = r.file;
    // one line for the parts without a model (placeholders, no file): the viewer's own rule moves them
    if (r.skipped.length) problems.push({ code: "SEQUENCE_EXPLODE_NO_MODEL", severity: "info", message: `radial explode: ${r.skipped.length} part(s) have no model to read (${r.skipped.slice(0, 3).map((x) => x.ref).join(", ")}${r.skipped.length > 3 ? ", ..." : ""}); the viewer's own rule moves them` });
  }
  for (const f of read.files) {
    const r = applyPatches(file, f.patches, f.file);
    file = r.file;
    applied += r.applied;
    problems.push(...r.problems);
  }
  // PB-1185: mates the project declares (`protoboard.mate` traits, `<model>.mates.json` sidecars; never inferred
  // ones) add joints with hard stops and fits for what only the planner placed; then every joint value is held
  // at its stops. A project with no mates is unchanged. Mate validation findings are the check's (runMateChecks).
  const mateSet = projectMates(p, asm);
  if (mateSet.mates.length) {
    const fed = applyMatesToSequence(file, asm, mateSet.mates);
    file = fed.file;
    problems.push(...fed.problems.filter((q) => q.severity !== "info"));
  }
  const held = clampSequenceJoints(file);
  file = held.file;
  problems.push(...held.problems);
  if (read.files.length || problems.length) file.patches = { files: read.files.map((f) => f.file), applied, problems };
  const diagnostics: ProjectDiagnostic[] = problems.map((q) => ({
    code: q.code,
    severity: q.severity,
    entity: { kind: "project", id: q.patch ?? SEQUENCE_FILE },
    message: `${q.patch ? `${q.patch}` : "sequence"}${q.edit !== undefined ? ` edit ${q.edit + 1}` : ""}: ${q.message}`,
    ...(q.patch ? { source: { file: q.patch } } : {}),
    validator: "protoboard/sequence",
  }));
  const steps = file.sequences.reduce((n, s) => n + s.steps.length, 0);
  return { file, steps, sequences: file.sequences.length, diagnostics };
}

/**
 * The build hook: generate, patch and write `.protoboard/build/sequence.json`.
 * Returns what was written and the patch diagnostics (unknown step ids and the like).
 */
export async function writeSequence(p: Project, outFile = join(p.root, SEQUENCE_FILE), options: SequenceBuildOptions = {}): Promise<SequenceBuild | undefined> {
  const built = await buildSequence(p, options);
  if (!built) return undefined;
  mkdirSync(dirname(outFile), { recursive: true });
  writeAtomic(outFile, JSON.stringify(built.file, null, 2) + "\n");
  return { ...built, path: outFile };
}

/**
 * Write through a temporary file in the same folder and rename it over the target (the wave 2 gate's item):
 * the dev server serves sequence.json while a build writes it, so a reader sees the old file or the new one,
 * never half of one. On Windows a reader holding the file can make the rename fail for a moment (EPERM,
 * EACCES, EBUSY): retried (DEFAULT 5 times, 50 ms apart), then the temporary file is removed and the error raised.
 */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        continue;
      }
      rmSync(tmp, { force: true });
      throw e;
    }
  }
}

/** One line for the build's text output. */
export function sequenceLine(b: SequenceBuild, root: string): string {
  const problems = b.file.patches?.problems.length ?? 0;
  const patches = b.file.patches ? `, ${b.file.patches.applied} patch edit(s) applied${problems ? `, ${problems} problem(s)` : ""}` : "";
  return `sequence: ${b.steps} step(s) in ${b.sequences} sequence(s)${patches} → ${b.path ? relative(root, b.path).replace(/\\/g, "/") : SEQUENCE_FILE}`;
}

/**
 * The check's view of the sequence (PB-1183, wired at the wave 2 gate): when the project declares
 * patches (`src/assembly.uhd.ts` export `sequencePatches`, or `src/assembly.sequence.json`), build the
 * sequence and add its `SEQUENCE_PATCH_*` diagnostics (unknown step ids, members, sequences; all
 * warnings) and a `protoboard/sequence` check entry. Without patches nothing runs (nothing to report).
 * A sequence that cannot be built is a skipped check, never a crash.
 */
export async function runSequenceChecks(p: Project): Promise<void> {
  const zero = { error: 0, warning: 0, info: 0 };
  if (!p.rootDef) return;
  if (!SEQUENCE_PATCH_FILES.some((f) => existsSync(join(p.root, f)))) return;
  try {
    const built = await buildSequence(p);
    const ds = built?.diagnostics ?? [];
    p.diagnostics.push(...ds);
    p.checks.push({ validator: "protoboard/sequence", status: "ran", counts: { ...zero, warning: ds.filter((d) => d.severity === "warning").length, error: ds.filter((d) => d.severity === "error").length, info: ds.filter((d) => d.severity === "info").length } });
  } catch (e) {
    p.checks.push({ validator: "protoboard/sequence", status: "skipped", reason: (e as Error).message.split("\n")[0], counts: zero });
  }
}

/**
 * The check's view of the mates (PB-1185, wired at the wave 4 gate per W4-E's handoff): read the
 * `protoboard.mate` traits and the `<model>.mates.json` sidecars of the placed models, validate them, and add
 * their problems (validator `protoboard/mates`) with a check entry. Cheap without traits or sidecars (one
 * `existsSync` per placed model file). A project that cannot be assembled is a skipped check, never a crash.
 */
export async function runMateChecks(p: Project): Promise<void> {
  const zero = { error: 0, warning: 0, info: 0 };
  if (!p.rootDef) return;
  try {
    const placed = assembleProject(p);
    if (!placed) return;
    const ds = mateDiagnostics(projectMates(p, placed.asm).problems);
    p.diagnostics.push(...ds);
    p.checks.push({ validator: "protoboard/mates", status: "ran", counts: { error: ds.filter((d) => d.severity === "error").length, warning: ds.filter((d) => d.severity === "warning").length, info: ds.filter((d) => d.severity === "info").length } });
  } catch (e) {
    p.checks.push({ validator: "protoboard/mates", status: "skipped", reason: (e as Error).message.split("\n")[0], counts: zero });
  }
}

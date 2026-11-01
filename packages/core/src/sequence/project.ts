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
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assemble, type Mat4, type ModuleDef } from "@deltarobotics/uhd";
import { importTs } from "../load.js";
import type { Project } from "../project.js";
import type { ProjectDiagnostic } from "../types.js";
import { generateSequence } from "./generate.js";
import { applyPatches } from "./patch.js";
import type { SequenceFile, SequencePatch, SequenceProblem } from "./types.js";

/** Where the build writes the sequence, project-relative. */
export const SEQUENCE_FILE = ".protoboard/build/sequence.json";
/** Patch sources, project-relative, in the order they apply. */
export const SEQUENCE_PATCH_FILES = ["src/assembly.uhd.ts", "src/assembly.sequence.json"];
export const SEQUENCE_GENERATOR = "@protoboardai/core sequence v0";

const hasBody = (def: ModuleDef) => (def.artifacts ?? []).some((a) => a.role === "body" && a.format === "glb");

/** The viewer's default root: the system when it has a body, else the top-level module with the most interface frames. */
export function defaultSequenceRoot(system: ModuleDef, lookup: (id: string) => ModuleDef | undefined): string[] {
  if (hasBody(system)) return [];
  let best: { id: string; frames: number } | undefined;
  for (const c of system.children ?? []) {
    const def = lookup(c.moduleDefId);
    if (!def || def.kind === "harness") continue;
    const frames = def.interfaces.filter((i) => i.geometry?.frame).length;
    if (frames && (!best || frames > best.frames)) best = { id: c.id, frames };
  }
  return best ? [best.id] : [];
}

interface DisplaySpatial {
  root?: string;
  placements?: Record<string, { matrix?: Mat4 }>;
}

function readDisplay(p: Project): DisplaySpatial {
  const file = join(p.root, p.config.display ?? ".protoboard/display.json");
  try {
    return existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { spatial?: DisplaySpatial }).spatial ?? {}) : {};
  } catch {
    return {}; // an unreadable display file only loses the hints, as in the project check
  }
}

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
export async function readSequencePatches(root: string): Promise<{ files: { file: string; patches: SequencePatch[] }[]; problems: SequenceProblem[] }> {
  const files: { file: string; patches: SequencePatch[] }[] = [];
  const problems: SequenceProblem[] = [];
  for (const rel of SEQUENCE_PATCH_FILES) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    try {
      let value: unknown;
      if (rel.endsWith(".json")) {
        const parsed = JSON.parse(readFileSync(abs, "utf8")) as unknown;
        value = Array.isArray(parsed) ? parsed : (parsed as { patches?: unknown }).patches;
      } else {
        const mod = await importTs<Record<string, unknown>>(abs);
        value = mod.sequencePatches ?? mod.default;
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
  return { files, problems };
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

/** Generate and patch the project's sequence (nothing written). Undefined when the project has no root system. */
export async function buildSequence(p: Project): Promise<SequenceBuild | undefined> {
  if (!p.rootDef) return undefined;
  const spatial = readDisplay(p);
  const root = spatial.root ? spatial.root.split("/") : defaultSequenceRoot(p.rootDef, p.lookup);
  const fixed = Object.fromEntries(Object.entries(spatial.placements ?? {}).filter(([, v]) => Array.isArray(v.matrix) && v.matrix.length === 16).map(([k, v]) => [k, v.matrix!]));
  const asm = assemble(p.rootDef, p.lookup, { root, fixed });
  const generated = generateSequence(asm, { root, hinted: Object.keys(fixed), by: SEQUENCE_GENERATOR, modelDigest: modelDigest(asm) });
  const read = await readSequencePatches(p.root);
  let file = generated;
  let applied = 0;
  const problems = [...read.problems];
  for (const f of read.files) {
    const r = applyPatches(file, f.patches, f.file);
    file = r.file;
    applied += r.applied;
    problems.push(...r.problems);
  }
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
export async function writeSequence(p: Project, outFile = join(p.root, SEQUENCE_FILE)): Promise<SequenceBuild | undefined> {
  const built = await buildSequence(p);
  if (!built) return undefined;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(built.file, null, 2) + "\n");
  return { ...built, path: outFile };
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

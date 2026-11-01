/**
 * Mates on a project (PB-1185): read the traits and sidecars, merge, validate,
 * and run the suggestion heuristics over the placed bodies' faces, writing
 * `.protoboard/build/mates-suggested.json` (never source).
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Assembly } from "@deltarobotics/uhd";
import { resolvePartFile } from "../part-files.js";
import type { Project } from "../project.js";
import type { ProjectDiagnostic } from "../types.js";
import { readBodyFaces } from "./mesh.js";
import { matesSidecarPath, mergeMates, readMatesSidecar, sidecarMates, traitMates } from "./read.js";
import { TOLERANCES, suggestMates, type SuggestBody } from "./suggest.js";
import { MATES_SUGGESTED_FILE, MATES_SUGGESTED_SCHEMA, MATES_VALIDATOR, type Mate, type MateProblem, type MateSet, type SuggestedMatesFile } from "./types.js";
import { validateMates } from "./validate.js";

/** Through a temporary file and a rename, so a reader never sees half a file (sequence/project.ts does the same). */
function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

const rel = (p: Project, f: string) => relative(p.root, f).replace(/\\/g, "/");

/** Model files a placed instance may carry a mates sidecar beside (its GLB and its STEP), as the resolver picks them. */
function modelFiles(p: Project, asm: Assembly): { owner: string; files: string[] }[] {
  const out: { owner: string; files: string[] }[] = [];
  const defOf = new Map(p.instances.map((i) => [i.path, i.definition]));
  for (const pl of asm.placements) {
    const owner = pl.path.join("/");
    const part = defOf.get(owner);
    if (!part) continue;
    const files = new Set<string>();
    for (const formats of [["glb"], ["step"]]) {
      try {
        const r = resolvePartFile(p, { part, instance: owner }, "model", { formats, ...(pl.body ? { body: pl.body } : {}), noPlaceholder: true });
        if (r.file && !r.placeholder) files.add(r.file);
      } catch {
        // an unresolvable part has no sidecar to read
      }
    }
    out.push({ owner, files: [...files] });
  }
  return out;
}

/** The project's declared mates: traits and current sidecars, merged (trait beats sidecar), validated. */
export function projectMates(p: Project, asm: Assembly, options: { suggested?: readonly Mate[] } = {}): MateSet {
  const problems: MateProblem[] = [];
  const traits = traitMates({ instances: p.instances, lookup: p.lookup, asm });
  problems.push(...traits.problems);
  const sidecar: Mate[] = [];
  const read = new Map<string, ReturnType<typeof readMatesSidecar>>();
  for (const { owner, files } of modelFiles(p, asm))
    for (const f of files) {
      const side = matesSidecarPath(f);
      if (!existsSync(side)) continue;
      let r = read.get(side);
      if (!r) {
        r = readMatesSidecar(side, p.root);
        read.set(side, r);
        problems.push(...r.problems);
      }
      if (!r.sidecar) continue;
      const m = sidecarMates(r.sidecar, owner, rel(p, side), asm);
      sidecar.push(...m.mates);
      problems.push(...m.problems);
    }
  const merged = mergeMates(traits.mates, sidecar, [...(options.suggested ?? [])]);
  const instances = new Set(p.instances.map((i) => i.path));
  const links = new Set(asm.mates.map((m) => m.linkId));
  problems.push(...validateMates(merged.mates, { instances, links }));
  // de-duplicate (a sidecar read for two owners reports once)
  const seen = new Set<string>();
  const unique = problems.filter((q) => {
    const k = `${q.code}|${q.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...merged, problems: unique };
}

/** Mate problems as project diagnostics (validator protoboard/mates). */
export function mateDiagnostics(problems: readonly MateProblem[]): ProjectDiagnostic[] {
  return problems.map((q) => ({
    code: q.code,
    severity: q.severity,
    entity: q.file?.includes("#") ? { kind: "definition", id: q.file.split("#")[0] } : { kind: "project", id: q.file ?? "mates" },
    message: q.message,
    ...(q.file && !q.file.includes("#") ? { source: { file: q.file } } : {}),
    validator: MATES_VALIDATOR,
  }));
}

/** Placed bodies with a real model (placeholders and missing files are skipped, and said so). */
export function placedBodies(p: Project, asm: Assembly): { bodies: { key: string; instance: string; body?: string; matrix: number[]; file: string }[]; skipped: { instance: string; reason: string }[] } {
  const defOf = new Map(p.instances.map((i) => [i.path, i.definition]));
  const bodies: { key: string; instance: string; body?: string; matrix: number[]; file: string }[] = [];
  const skipped: { instance: string; reason: string }[] = [];
  for (const pl of asm.placements) {
    const instance = pl.path.join("/");
    const part = defOf.get(instance);
    if (!part) {
      skipped.push({ instance: pl.key, reason: "no definition" });
      continue;
    }
    const r = resolvePartFile(p, { part, instance }, "model", { formats: ["glb"], ...(pl.body ? { body: pl.body } : {}) });
    if (!r.file || r.source === "none" || !existsSync(r.file)) skipped.push({ instance: pl.key, reason: "no model file" });
    else if (r.placeholder) skipped.push({ instance: pl.key, reason: `placeholder (${r.placeholderInfo?.reason ?? "declared"})` });
    else bodies.push({ key: pl.key, instance, ...(pl.body ? { body: pl.body } : {}), matrix: pl.matrix as unknown as number[], file: r.file });
  }
  return { bodies, skipped };
}

/** Pairs of placement keys a UHD link already mates (a link's two ends; a fastener stack's structure and mounted body). */
export function linkedPairs(asm: Assembly): Map<string, string> {
  const key = (e: Assembly["mates"][number]["a"]) => e.path.join("/") + (e.frame.artifact ? `#${e.frame.artifact}` : "");
  const pair = (a: string, b: string) => [a, b].sort().join("~");
  const out = new Map<string, string>();
  for (const m of asm.mates) out.set(pair(key(m.a), key(m.b)), m.linkId);
  for (const h of asm.hardware) if (!out.has(pair(h.structure, h.mounted))) out.set(pair(h.structure, h.mounted), h.linkId);
  return out;
}

/**
 * Suggest mates for the project's placed bodies and write them to
 * `.protoboard/build/mates-suggested.json` (`write: false` skips the write).
 * Suggestions between bodies a UHD link already mates are listed as covered;
 * those a declared mate joins are shadowed (merge rule); neither is in `suggestions`.
 */
export async function suggestProjectMates(p: Project, asm: Assembly, options: { write?: boolean; tolerances?: typeof TOLERANCES; declared?: readonly Mate[] } = {}): Promise<{ file: SuggestedMatesFile; path?: string }> {
  const t0 = performance.now();
  const { bodies, skipped } = placedBodies(p, asm);
  const inputs: SuggestBody[] = [];
  for (const b of bodies) {
    try {
      const r = await readBodyFaces(b.file, p.root);
      inputs.push({ key: b.key, instance: b.instance, ...(b.body ? { body: b.body } : {}), matrix: b.matrix, faces: r.faces });
    } catch (e) {
      skipped.push({ instance: b.key, reason: (e as Error).message.split("\n")[0] });
    }
  }
  const t1 = performance.now();
  const tol = options.tolerances ?? TOLERANCES;
  const r = suggestMates(inputs, tol);
  const t2 = performance.now();
  const linked = linkedPairs(asm);
  const pairKey = (m: Mate) => [m.a.instance + (m.a.body ? `#${m.a.body}` : ""), m.b.instance + (m.b.body ? `#${m.b.body}` : "")].sort().join("~");
  const covered: { id: string; link: string }[] = [];
  const open: Mate[] = [];
  for (const s of r.suggestions) {
    const link = linked.get(pairKey(s));
    if (link) covered.push({ id: s.id, link });
    else open.push({ ...s, from: "inferred" });
  }
  const merged = mergeMates([...(options.declared ?? [])], open);
  const suggestions = merged.mates.filter((m) => m.from === "inferred").sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id.localeCompare(b.id));
  const byKind: Record<string, number> = {};
  for (const s of suggestions) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const t3 = performance.now();
  const file: SuggestedMatesFile = {
    schema: MATES_SUGGESTED_SCHEMA,
    generated: { by: "@protoboardai/core mates suggest v0", at: new Date().toISOString() },
    tolerances: { ...tol },
    counts: { bodies: inputs.length, faces: r.fitted.faces, planes: r.fitted.planes, cylinders: r.fitted.cylinders, patterns: r.fitted.patterns, suggestions: suggestions.length, covered: covered.length, shadowed: merged.shadowed.length, byKind },
    timings: { readMs: Math.round(t1 - t0), suggestMs: Math.round(t2 - t1), mergeMs: Math.round(t3 - t2), totalMs: Math.round(t3 - t0) },
    suggestions,
    ...(covered.length ? { covered } : {}),
    skipped,
  };
  if (options.write === false) return { file };
  const path = join(p.root, MATES_SUGGESTED_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, JSON.stringify(file, null, 2) + "\n");
  return { file, path };
}

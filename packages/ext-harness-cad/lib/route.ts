/**
 * Routed wire harnesses as a `cad` provider (docs/specs/tool-integrations.md
 * §2–§4, PB-822).
 *
 *   generate  the assembled model → native design <dir>/harness-cad/route.json:
 *             conductor paths, centreline, length fit, bend limits, clearance
 *   export    route.json → out/body.glb, body.step, body.manifest.json
 *   extract   the end frames the route was generated for, plus the artifacts
 *   check     model vs route (ends, conductors, length changed), route vs
 *             out/ (an export older than the route), and the route report:
 *             length fit, the generator's notes, ends that no longer meet
 *             their parts in the assembly
 *
 * Routing order is a property of the system (rigid ends first, then
 * thickest), and each cable is routed around the ones before it. Generating
 * one harness routes the harnesses before it again, in memory, so its route
 * is the one a run over the whole system gives, whatever was generated
 * before.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactDef, GeometryFrame, ModuleDef } from "@deltarobotics/uhd";
import { sha256, stableStringify, type CapabilityBinding, type OperationContext, type Project, type ProjectDiagnostic } from "@protoboardai/core";
import { HARNESS_CAD_TOOL, harnessCadArtifacts } from "./artifacts.ts";
import { buildJob, cableLength, projectAssembly, wireHarnesses, type JobHarness } from "./job.ts";

export const GENERATOR = fileURLToPath(new URL("../py/harness_cad.py", import.meta.url));
export const python = () => process.env.PROTOBOARD_PYTHON || "python3";
export const PROVIDER = "@protoboardai/ext-harness-cad";
const TOOL = HARNESS_CAD_TOOL;

/** What generate and export need from their context (a capability context, or the harness-cad alias's). */
export type Writer = Pick<OperationContext, "project" | "writeOutput" | "log">;

/** A harness definition and its provider directory. */
export interface HarnessTarget {
  id: string;
  binding: Pick<CapabilityBinding, "dir" | "native" | "out">;
}

export interface RouteResult {
  id: string;
  path: string;
  status: "ok" | "warning" | "failed";
  notes: string[];
  [k: string]: unknown;
}

/** The route file the router writes (py/harness_cad.py, ROUTE_SCHEMA). */
export interface RouteFile {
  schema: string;
  harness: JobHarness;
  notes: string[];
}

type Outcome<T> = { ok: true; value: T } | { ok: false; summary: string; problems?: string[] };

export const harnessFiles = (b: Pick<CapabilityBinding, "native" | "out">) => ({ route: `${b.native}/route.json`, manifest: `${b.out}/body.manifest.json` });

/** The harness's cad binding to this provider (its `cad.config.ts`), when it has a usable one. */
export function harnessBinding(p: Project, id: string): CapabilityBinding | undefined {
  return p.capabilities.find((b) => b.capability === "cad" && b.module === id && b.provider === PROVIDER && !b.problem && b.native);
}

function runPython(args: string[]): Outcome<{ harnesses: RouteResult[]; context?: RouteResult[]; map?: unknown }> {
  try {
    const stdout = execFileSync(python(), [GENERATOR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1800000, maxBuffer: 64 << 20, env: { ...process.env, PYTHONHASHSEED: "0" } });
    return { ok: true, value: JSON.parse(stdout.trim().split("\n").pop()!) };
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return { ok: false, summary: `generator failed: ${(err.stderr ?? err.message).trim().split("\n").slice(-3).join(" | ")}` };
  }
}

/** generate: route the system's harnesses up to the last target and write each target's route.json. */
export function routeHarnesses(ctx: Writer, targets: HarnessTarget[]) {
  const p = ctx.project;
  if (!p.rootDef) return { ok: false as const, summary: "the project has no root system" };
  const job = buildJob(p);
  for (const t of targets) {
    const entries = job.harnesses.filter((h) => h.id === t.id);
    if (!entries.length) {
      const why = job.problems.filter((x) => x.includes(`(${t.id})`) || x.includes(t.id));
      return { ok: false as const, summary: `${t.id} cannot be routed: ${why.join("; ") || "it is not a placed wire harness with connector ends and a cable_build trait"}`, problems: job.problems };
    }
    if (entries.length > 1) return { ok: false as const, summary: `${t.id} is used ${entries.length} times (${entries.map((h) => h.path).join(", ")}); routes are written per definition, so give each cable its own definition` };
  }
  job.targets = targets.map((t) => t.id);
  const scratch = join(p.root, ".protoboard", "cache", "harness-cad", "route");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, "job.json"), stableStringify(job));
  const run = runPython(["route", join(scratch, "job.json"), join(scratch, "routes")]);
  if (!run.ok) return run;
  const summary = run.value;
  for (const r of summary.harnesses) {
    const t = targets.find((x) => x.id === r.id)!;
    if (r.status !== "failed") ctx.writeOutput(harnessFiles(t.binding).route, readFileSync(join(scratch, "routes", `${r.id}.route.json`)), `${r.path}: route (native design)`);
    ctx.log(`${r.path}: ${r.status}${r.notes?.length ? ` — ${r.notes.join("; ")}` : ""}`);
  }
  if (summary.context?.length) ctx.log(`routed first, in memory: ${summary.context.map((r) => r.path).join(", ")}`);
  rmSync(scratch, { recursive: true, force: true });
  return { ok: true as const, value: { ...summary, problems: job.problems } };
}

/** export: build each target's bodies from its route.json and write the standard outputs. */
export function exportHarnesses(ctx: Writer, targets: HarnessTarget[]) {
  const p = ctx.project;
  const missing = targets.filter((t) => !existsSync(join(p.root, harnessFiles(t.binding).route)));
  if (missing.length) return { ok: false as const, summary: `${missing.map((t) => t.id).join(", ")}: no route (${harnessFiles(missing[0].binding).route}); run \`protoboard run cad:generate --module ${missing[0].id}\` first` };
  const scratch = join(p.root, ".protoboard", "cache", "harness-cad", "export");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  // one process per harness: OpenCascade numbers STEP assembly occurrences with a
  // process-wide counter, so this keeps each body.step the same as its own cad:export gives
  const results: RouteResult[] = [];
  for (const t of targets) {
    const run = runPython(["export", scratch, join(p.root, harnessFiles(t.binding).route)]);
    if (!run.ok) return run;
    results.push(...run.value.harnesses);
  }
  for (const r of results) {
    if (r.status === "failed") continue;
    const t = targets.find((x) => x.id === r.id)!;
    const files = harnessFiles(t.binding);
    const out = t.binding.out;
    ctx.writeOutput(`${out}/body.glb`, readFileSync(join(scratch, `${r.id}.glb`)), `${r.path}: viewer mesh`);
    if (existsSync(join(scratch, `${r.id}.step`))) ctx.writeOutput(`${out}/body.step`, readFileSync(join(scratch, `${r.id}.step`)), `${r.path}: swept solids`);
    // the generator's manifest, named for out/: it describes body.*, and records the route it was exported from
    const manifest = JSON.parse(readFileSync(join(scratch, `${r.id}.manifest.json`), "utf8")) as Record<string, unknown>;
    const standard = { ...manifest, artifact: "body", exportedFrom: { file: files.route, digest: sha256(readFileSync(join(p.root, files.route))) } };
    ctx.writeOutput(files.manifest, JSON.stringify(standard, null, 2) + "\n", `${r.path}: route manifest (end frames, lengths, bends, clearance)`);
    ctx.log(`${r.path}: exported to ${out}${r.step !== "ok" ? ` (STEP ${r.step})` : ""}`);
  }
  rmSync(scratch, { recursive: true, force: true });
  return { ok: true as const, value: { harnesses: results } };
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

/** extract: the frames the route gives the harness's end interfaces, and the artifacts that exist. */
export function extractHarness(root: string, t: HarnessTarget) {
  const route = readJson<RouteFile>(join(root, harnessFiles(t.binding).route));
  if (!route) return { ok: false as const, summary: `${t.id} has no route (${harnessFiles(t.binding).route}); run \`protoboard run cad:generate --module ${t.id}\` first` };
  const frames: Record<string, GeometryFrame> = Object.fromEntries(route.harness.ends.map((e) => [e.interfaceId, e.frame]));
  const artifacts: ArtifactDef[] = harnessCadArtifacts({ dir: t.binding.dir, name: t.id, tool: TOOL }).filter((a) => a.filePath && existsSync(join(root, a.filePath)));
  return { ok: true as const, value: { frames, artifacts } };
}

interface RouteManifest {
  length_mm: number;
  route_length_mm: number;
  status: string;
  notes: string[];
  exportedFrom?: { digest?: string };
}

/** check: the harness's route against the model, its export against the route, and the route report. */
export function harnessDiagnostics(p: Project, def: ModuleDef, t: HarnessTarget): Omit<ProjectDiagnostic, "validator">[] {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const source = p.definitions.get(def.id)?.origin.source;
  if (!p.rootDef) return out;
  const asm = projectAssembly(p);
  const inst = wireHarnesses(asm).find((i) => i.def.id === def.id);
  if (!inst) {
    out.push({ code: "HARNESS_NOT_ROUTABLE", severity: "error", entity: { kind: "definition", id: def.id }, message: `${def.id} is not a wire harness ext-harness-cad can route (kind harness, connector ends, a cable_build trait, used in the system)`, source });
    return out;
  }
  const key = inst.path.join("/");
  const entity = { kind: "instance" as const, id: key };
  const files = harnessFiles(t.binding);
  const regenerate = `protoboard run cad:generate --module ${def.id}, then cad:export`;
  const routeBytes = existsSync(join(p.root, files.route)) ? readFileSync(join(p.root, files.route)) : undefined;
  if (!routeBytes) {
    out.push({ code: "HARNESS_NOT_ROUTED", severity: "info", entity, message: `${key} (${def.id}) has no routed geometry; run \`${regenerate}\``, source });
    return out;
  }
  const route = JSON.parse(routeBytes.toString("utf8")) as RouteFile;
  const job = buildJob(p);
  const now = job.harnesses.find((h) => h.id === def.id);
  if (!now) {
    out.push({ code: "HARNESS_ROUTE_STALE", severity: "warning", entity, message: `${key}: no longer routable (${job.problems.filter((x) => x.includes(def.id)).join("; ") || "see the model"}); its route was generated for an earlier model`, source });
  } else if (stableStringify(now) !== stableStringify(route.harness)) {
    const changed = (Object.keys(now) as (keyof JobHarness)[]).filter((k) => stableStringify(now[k]) !== stableStringify(route.harness[k]));
    out.push({ code: "HARNESS_ROUTE_STALE", severity: "warning", entity, message: `${key}: the route was generated for a different ${changed.join(", ")}; regenerate (${regenerate})`, source });
  }

  const m = readJson<RouteManifest>(join(p.root, files.manifest));
  if (!m) return out; // never exported: the standard-outputs check says so
  if (m.exportedFrom?.digest !== sha256(routeBytes)) {
    out.push({ code: "HARNESS_EXPORT_STALE", severity: "warning", entity, message: `${key}: ${t.binding.out}/ was exported from an earlier route than ${files.route}; run \`protoboard run cad:export --module ${def.id}\``, source });
  }
  const length = cableLength(def);
  if (length !== undefined && Math.abs(length - m.length_mm) > 0.5) {
    out.push({ code: "HARNESS_ROUTE_LENGTH", severity: "warning", entity, message: `${key}: modelled length ${length} mm, routed at ${m.length_mm} mm; regenerate (${regenerate})`, source });
  }
  if (Math.abs(m.route_length_mm - m.length_mm) > 1.5) {
    out.push({ code: "HARNESS_ROUTE_LENGTH", severity: "warning", entity, message: `${key}: the routed cable is ${m.route_length_mm} mm, not its ${m.length_mm} mm (${m.route_length_mm > m.length_mm ? "too short to reach" : "the slack could not be laid clear"})`, source });
  }
  for (const note of m.notes ?? []) out.push({ code: "HARNESS_ROUTE_WARNING", severity: "warning", entity, message: `${key}: ${note}`, source });
  const placed = asm.harnesses.find((h) => h.key === key);
  if (!placed) {
    out.push({ code: "HARNESS_ROUTE_STALE", severity: "warning", entity, message: `${key}: routed, but no end lands on a placed part`, source });
    return out;
  }
  for (const e of placed.ends) {
    if (e.status === "stale") {
      out.push({ code: "HARNESS_ROUTE_STALE", severity: "warning", entity, message: `${key}.${e.interfaceId} is ${e.offsetMm} mm / ${e.angleDeg}° from ${e.counterpart}: regenerate (${regenerate})`, source });
    } else if (e.status === "unplaced" || e.status === "no_geometry") {
      out.push({ code: "HARNESS_ROUTE_STALE", severity: "info", entity, message: `${key}.${e.interfaceId}: ${e.counterpart} ${e.status === "unplaced" ? "is not placed" : "has no frame"}, so this end is not checked`, source });
    }
  }
  return out;
}

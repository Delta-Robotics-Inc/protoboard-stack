/**
 * Plates as a `cad` provider (docs/specs/tool-integrations.md §2–§4).
 *
 *   generate  UHD module + constraints → native design in <dir>/frame-cad/:
 *             params.json (what the generator runs on) and frames.json (the
 *             interface frames of the generated geometry)
 *   export    params.json → build123d → standard outputs in <dir>/out/:
 *             body.step, body.glb, body.manifest.json, body.dxf and
 *             interfaces/<id>.glb
 *   extract   frames.json → frames by interface id, plus the artifacts
 *   check     model vs native design (frames, stale parameters) and native
 *             design vs out/ (an export older than the design)
 *
 * The generator is deterministic for fixed params and build123d version, so
 * export rebuilds exactly the body that generate measured.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactDef, ModuleDef } from "@deltarobotics/uhd";
import { sha256, stableStringify, type CapabilityBinding, type OperationContext, type ProjectDiagnostic } from "@protoboardai/core";
import { plateCadArtifacts } from "./artifacts.ts";
import { buildParams, plateFiles, sameVec, type FramesFile, type PlateParams } from "./params.ts";
import { runAsync } from "./run.ts";

export const GENERATOR = fileURLToPath(new URL("../py/frame_cad.py", import.meta.url));
export const python = () => process.env.PROTOBOARD_PYTHON || "python3";

/** What generate and export need from their context (a capability context, or the frame-cad alias's). */
export type Writer = Pick<OperationContext, "project" | "writeOutput" | "log">;

/** A plate module and its provider directory. */
export interface PlateTarget {
  def: ModuleDef;
  binding: Pick<CapabilityBinding, "dir" | "native" | "out" | "constraints" | "process" | "config">;
}

interface Signature {
  area_mm2: number;
  centroid: number[];
  normal?: number[];
}

interface Generated {
  toolVersion: string;
  sourceDigest: string;
  features: Record<string, Signature>;
  frames: FramesFile;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; summary: string; problems?: string[] };

/** What the module currently binds, compared with what was generated: the re-binding worklist. */
export function bindingDiff(def: ModuleDef, features: Record<string, Signature>, frames: FramesFile) {
  const signatures: { interface: string; feature: string; bound?: Signature; generated?: Signature }[] = [];
  const frameChanges: { interface: string; declared?: number[]; generated?: number[] }[] = [];
  for (const i of def.interfaces) {
    for (const ref of i.geometry?.refs ?? []) {
      if (ref.kind !== "feature" || ref.artifact !== "cad_step") continue;
      const now = features[ref.name];
      const was = ref.signature;
      const close = was && now && Math.abs(was.area_mm2 - now.area_mm2) <= 0.01 * Math.max(was.area_mm2, now.area_mm2, 1) && sameVec(was.centroid, now.centroid, 0.05);
      if (!close) signatures.push({ interface: i.id, feature: ref.name, bound: was, generated: now });
    }
    const f = frames[i.id];
    if (i.geometry?.frame && f && !(sameVec(i.geometry.frame.origin, f.origin) && sameVec(i.geometry.frame.normal, f.normal))) {
      frameChanges.push({ interface: i.id, declared: i.geometry.frame.origin, generated: f.origin });
    }
  }
  return { signatures, frames: frameChanges };
}

/** Run the generator on a params file into a fresh scratch folder; returns its summary and the folder. */
async function runGenerator(root: string, paramsFile: string, name: string): Promise<Outcome<{ scratch: string; summary: Generated }>> {
  const scratch = join(root, ".protoboard", "cache", "frame-cad", name);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const r = await runAsync(python(), [GENERATOR, paramsFile, scratch], { timeout: 300000, env: { ...process.env, PYTHONHASHSEED: "0" } });
  if (r.ok) return { ok: true, value: { scratch, summary: JSON.parse(r.stdout.trim().split("\n").pop()!) as Generated } };
  rmSync(scratch, { recursive: true, force: true });
  return { ok: false, summary: `${name}: generator failed: ${r.error}` };
}

/** generate: write the params from the module and constraints, run the generator, keep the frames it measured. */
export async function generatePlate(ctx: Writer, t: PlateTarget) {
  const p = ctx.project;
  const { def, binding: b } = t;
  const files = plateFiles(b);
  const { params, problems } = buildParams(def, def.id, b.constraints);
  if (!params || problems.length) return { ok: false as const, summary: problems[0], problems };
  ctx.writeOutput(files.params, stableStringify(params), `${def.id}: generator parameters from its interfaces and ${b.config}`);
  const run = await runGenerator(p.root, join(p.root, files.params), params.name);
  if (!run.ok) return run;
  const { scratch, summary } = run.value;
  ctx.writeOutput(files.frames, readFileSync(join(scratch, `${params.name}.frames.json`)), `${def.id}: interface frames of the generated geometry`);
  rmSync(scratch, { recursive: true, force: true });
  ctx.log(`${def.id}: ${Object.keys(summary.features).length} features; native design in ${b.native}`);
  return {
    ok: true as const,
    value: {
      module: def.id,
      dir: b.dir,
      native: b.native!,
      toolVersion: summary.toolVersion,
      sourceDigest: summary.sourceDigest,
      features: summary.features,
      frames: summary.frames,
      rebind: bindingDiff(def, summary.features, summary.frames),
    },
  };
}

/** export: rebuild the body from the native params and write the standard outputs. */
export async function exportPlate(ctx: Writer, t: PlateTarget) {
  const p = ctx.project;
  const { def, binding: b } = t;
  const files = plateFiles(b);
  if (b.process === "print") return { ok: false as const, summary: `${def.id}: ext-frame-cad cuts plates (DXF profiles for routing or waterjet); process "print" needs STL or 3MF, which it does not write. Use process "cut" or "machine" in ${b.config}` };
  if (!existsSync(join(p.root, files.params))) return { ok: false as const, summary: `${def.id} has no native design (${files.params}); run \`protoboard run cad:generate --module ${def.id}\` first` };
  const paramsBytes = readFileSync(join(p.root, files.params));
  const params = JSON.parse(paramsBytes.toString("utf8")) as PlateParams;
  const run = await runGenerator(p.root, join(p.root, files.params), params.name);
  if (!run.ok) return run;
  const { scratch, summary } = run.value;
  const n = params.name;
  ctx.writeOutput(`${b.out}/body.step`, readFileSync(join(scratch, `${n}.step`)), `${def.id}: body with one named sub-shape per interface feature`);
  ctx.writeOutput(`${b.out}/body.glb`, readFileSync(join(scratch, `${n}.glb`)), `${def.id}: viewer mesh`);
  ctx.writeOutput(`${b.out}/body.dxf`, readFileSync(join(scratch, `${n}.dxf`)), `${def.id}: cutting profiles`);
  const interfaces = existsSync(join(scratch, "interfaces")) ? readdirSync(join(scratch, "interfaces")).sort() : [];
  for (const f of interfaces) ctx.writeOutput(`${b.out}/interfaces/${f}`, readFileSync(join(scratch, "interfaces", f)), `${def.id}: ${f.replace(/\.glb$/, "")} geometry`);
  // the generator's manifest, named for out/: it describes body.*, and records the design it was exported from
  const manifest = JSON.parse(readFileSync(join(scratch, `${n}.manifest.json`), "utf8")) as Record<string, unknown> & { manufacturing?: Record<string, unknown> };
  const standard = {
    ...manifest,
    artifact: "body",
    params: `../${b.native!.split("/").pop()}/params.json`,
    ...(manifest.manufacturing ? { manufacturing: { ...manifest.manufacturing, dxf: "body.dxf" } } : {}),
    exportedFrom: { file: files.params, digest: sha256(paramsBytes) },
  };
  ctx.writeOutput(files.manifest, JSON.stringify(standard, null, 2) + "\n", `${def.id}: geometry manifest (features that carry interfaces, volume)`);
  rmSync(scratch, { recursive: true, force: true });
  ctx.log(`${def.id}: ${4 + interfaces.length} files in ${b.out}`);
  return { ok: true as const, value: { module: def.id, out: b.out, volume_mm3: manifest.volume_mm3 as number, features: summary.features, interfaces: interfaces.map((f) => f.replace(/\.glb$/, "")) } };
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

/** extract: the generated frames by interface id, and the module's artifacts that exist. */
export function extractPlate(root: string, t: PlateTarget) {
  const { def, binding: b } = t;
  const files = plateFiles(b);
  const frames = readJson<FramesFile>(join(root, files.frames));
  if (!frames) return { ok: false as const, summary: `${def.id} has no native design (${files.frames}); run \`protoboard run cad:generate --module ${def.id}\` first` };
  const artifacts: ArtifactDef[] = plateCadArtifacts({ dir: b.dir, name: def.id, interfaces: Object.keys(frames) }).filter((a) => a.filePath && existsSync(join(root, a.filePath)));
  return { ok: true as const, value: { frames, artifacts } };
}

const fmt = (v?: number[]) => (v ? `[${v.map((n) => Number(n.toFixed(3))).join(", ")}]` : "—");

/**
 * check: every interface frame equals the generated frame; the params the
 * design was generated from are still what the interfaces and constraints
 * give (otherwise the CAD is stale); and out/ was exported from the current
 * params.
 */
export function plateDiagnostics(root: string, t: PlateTarget, source: ProjectDiagnostic["source"]): Omit<ProjectDiagnostic, "validator">[] {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const { def, binding: b } = t;
  const files = plateFiles(b);
  const entity = { kind: "definition" as const, id: def.id };
  const generated = readJson<FramesFile>(join(root, files.frames));
  if (!generated) {
    out.push({ code: "FRAME_CAD_NOT_GENERATED", severity: "info", entity, message: `${def.id} has no generated frames (${files.frames}); run \`protoboard run cad:generate --module ${def.id}\``, source });
    return out;
  }
  for (const [id, f] of Object.entries(generated)) {
    const iface = def.interfaces.find((i) => i.id === id);
    if (!iface) {
      out.push({ code: "FRAME_CAD_UNKNOWN_INTERFACE", severity: "error", entity: { kind: "interface", id: `${def.id}:${id}` }, message: `generated frames name "${id}", which ${def.id} does not have (renamed or removed? regenerate)`, source });
      continue;
    }
    const d = iface.geometry?.frame;
    if (!d) {
      out.push({ code: "FRAME_CAD_FRAME_MISSING", severity: "warning", entity: { kind: "interface", id: `${def.id}:${id}` }, message: `${id} has generated geometry but no frame in the model`, source });
      continue;
    }
    const diffs = [
      !sameVec(d.origin, f.origin) && `origin ${fmt(d.origin)} vs generated ${fmt(f.origin)}`,
      !sameVec(d.normal, f.normal) && `normal ${fmt(d.normal)} vs generated ${fmt(f.normal)}`,
      f.xAxis && d.xAxis && !sameVec(d.xAxis, f.xAxis) && `xAxis ${fmt(d.xAxis)} vs generated ${fmt(f.xAxis)}`,
      (f.symmetryDeg ?? null) !== (d.symmetryDeg ?? null) && `symmetry ${d.symmetryDeg ?? "none"} vs generated ${f.symmetryDeg ?? "none"}`,
    ].filter(Boolean);
    if (diffs.length) {
      out.push({
        code: "FRAME_CAD_FRAME_MISMATCH",
        severity: "error",
        entity: { kind: "interface", id: `${def.id}:${id}` },
        message: `${id}: ${diffs.join("; ")} — the model and the plate disagree; review, then \`protoboard run frame-cad-rebind --input module=${def.id}\``,
        source,
      });
    }
  }
  const paramsFile = join(root, files.params);
  if (existsSync(paramsFile)) {
    const bytes = readFileSync(paramsFile);
    const recorded = JSON.parse(bytes.toString("utf8")) as PlateParams;
    const { params } = buildParams(def, def.id, b.constraints);
    if (params && stableStringify(params) !== stableStringify(recorded)) {
      const changed = [
        ...params.interfaces.filter((i) => stableStringify(i) !== stableStringify(recorded.interfaces?.find((r) => r.id === i.id))).map((i) => i.id),
        ...(stableStringify(params.plate) !== stableStringify(recorded.plate) ? ["plate"] : []),
      ];
      out.push({
        code: "FRAME_CAD_STALE",
        severity: "warning",
        entity,
        message: `${def.id}: the CAD was generated from different parameters (${changed.join(", ") || "interfaces"} changed); run \`protoboard run cad:generate --module ${def.id}\`, then cad:export`,
        source,
      });
    }
    const manifest = readJson<{ exportedFrom?: { digest?: string } }>(join(root, files.manifest));
    if (manifest && manifest.exportedFrom?.digest !== sha256(bytes)) {
      out.push({
        code: "FRAME_CAD_EXPORT_STALE",
        severity: "warning",
        entity,
        message: `${def.id}: ${b.out}/ was exported from other parameters than ${files.params}; run \`protoboard run cad:export --module ${def.id}\``,
        source,
      });
    }
  }
  return out;
}

/**
 * Mounting hardware as a `cad` provider (tool-integrations §2–§4, PB-836):
 * a local fastener module (a screw, nut, standoff or spacer) whose
 * `cad.config.ts` names @protoboardai/ext-frame-cad gets its nominal body the
 * same way a plate does.
 *
 *   generate  module sizes → native design <dir>/frame-cad/params.json
 *   export    params.json → build123d (py/hardware_cad.py) → standard
 *             outputs <dir>/out/body.step, body.glb, body.manifest.json
 *   extract   the module's artifacts that exist (no interface frames: a
 *             fastener's position comes from the fastener stack)
 *   check     params still what the module says; out/ exported from them
 *
 * `protoboard run hardware-cad` is the alias of generate then export for
 * every bound hardware module, as `frame-cad` is for plates.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactDef, ModuleDef } from "@deltarobotics/uhd";
import { sha256, stableStringify, type CapabilityBinding, type ProjectDiagnostic } from "@protoboardai/core";
import { hardwareCadArtifacts } from "./artifacts.ts";
import { buildHardwareParams, type HardwareParams } from "./hardware.ts";
import { python, type Writer } from "./plate.ts";
import { runAsync } from "./run.ts";

export const HARDWARE_GENERATOR = fileURLToPath(new URL("../py/hardware_cad.py", import.meta.url));

/** A hardware module and its provider directory. */
export interface HardwareTarget {
  def: ModuleDef;
  binding: Pick<CapabilityBinding, "dir" | "native" | "out" | "config">;
}

/** Native params and the standard outputs' manifest of a bound hardware module. */
export function hardwareFiles(b: Pick<CapabilityBinding, "native" | "out">) {
  return { params: `${b.native}/params.json`, manifest: `${b.out}/body.manifest.json` };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; summary: string; problems?: string[] };

/** generate: the generator parameters from the module's sizes, into the native folder. */
export function generateHardware(ctx: Writer, t: HardwareTarget): Outcome<{ module: string; kind: string; native: string; params: HardwareParams }> {
  const { def, binding: b } = t;
  const { params, problems } = buildHardwareParams(def, def.id);
  if (!params || problems.length) return { ok: false, summary: problems[0], problems };
  const files = hardwareFiles(b);
  ctx.writeOutput(files.params, stableStringify(params), `${def.id}: generator parameters from its sizes`);
  ctx.log(`${def.id}: ${params.part.kind}; native design in ${b.native}`);
  return { ok: true, value: { module: def.id, kind: params.part.kind, native: b.native!, params } };
}

/** export: build the nominal body from the native params and write the standard outputs. */
export async function exportHardware(ctx: Writer, t: HardwareTarget): Promise<Outcome<{ module: string; out: string; volume_mm3: number; previousVolume_mm3: number | null; toolVersion: string }>> {
  const p = ctx.project;
  const { def, binding: b } = t;
  const files = hardwareFiles(b);
  if (!existsSync(join(p.root, files.params))) return { ok: false, summary: `${def.id} has no native design (${files.params}); run \`protoboard run cad:generate --module ${def.id}\` first` };
  const paramsBytes = readFileSync(join(p.root, files.params));
  const params = JSON.parse(paramsBytes.toString("utf8")) as HardwareParams;
  const before = readJson<{ volume_mm3?: number }>(join(p.root, files.manifest))?.volume_mm3 ?? null;
  const scratch = join(p.root, ".protoboard", "cache", "hardware-cad", params.name);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const run = await runAsync(python(), [HARDWARE_GENERATOR, join(p.root, files.params), scratch], { timeout: 300000, env: { ...process.env, PYTHONHASHSEED: "0" } });
  if (!run.ok) {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, summary: `${def.id}: generator failed: ${run.error}` };
  }
  const summary = JSON.parse(run.stdout.trim().split("\n").pop()!) as { toolVersion: string; volume_mm3: number };
  const n = params.name;
  ctx.writeOutput(`${b.out}/body.step`, readFileSync(join(scratch, `${n}.step`)), `${def.id}: nominal body`);
  ctx.writeOutput(`${b.out}/body.glb`, readFileSync(join(scratch, `${n}.glb`)), `${def.id}: viewer mesh`);
  const manifest = JSON.parse(readFileSync(join(scratch, `${n}.manifest.json`), "utf8")) as Record<string, unknown>;
  const standard = { ...manifest, artifact: "body", params: `../${b.native!.split("/").pop()}/params.json`, exportedFrom: { file: files.params, digest: sha256(paramsBytes) } };
  ctx.writeOutput(files.manifest, JSON.stringify(standard, null, 2) + "\n", `${def.id}: geometry manifest (volume)`);
  rmSync(scratch, { recursive: true, force: true });
  ctx.log(`${def.id}: ${summary.volume_mm3} mm³ in ${b.out}`);
  return { ok: true, value: { module: def.id, out: b.out, volume_mm3: summary.volume_mm3, previousVolume_mm3: before, toolVersion: summary.toolVersion } };
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

/** extract: no frames (a fastener is placed by its fastener stack), and the module's artifacts that exist. */
export function extractHardware(root: string, t: HardwareTarget): Outcome<{ frames: Record<string, never>; artifacts: ArtifactDef[] }> {
  const { def, binding: b } = t;
  if (!existsSync(join(root, hardwareFiles(b).params))) return { ok: false, summary: `${def.id} has no native design (${hardwareFiles(b).params}); run \`protoboard run cad:generate --module ${def.id}\` first` };
  const artifacts = hardwareCadArtifacts({ dir: b.dir, name: def.id }).filter((a) => a.filePath && existsSync(join(root, a.filePath)));
  return { ok: true, value: { frames: {}, artifacts } };
}

/**
 * check: the params the body was made from are still the module's sizes
 * (otherwise the body, and the mass computed from its volume, are stale),
 * and out/ was exported from those params.
 */
export function hardwareDiagnostics(root: string, t: HardwareTarget, source: ProjectDiagnostic["source"]): Omit<ProjectDiagnostic, "validator">[] {
  const { def, binding: b } = t;
  const files = hardwareFiles(b);
  const entity = { kind: "definition" as const, id: def.id };
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const { params, problems } = buildHardwareParams(def, def.id);
  if (!params) {
    out.push({ code: "HARDWARE_CAD_PARAMS", severity: "error", entity, message: `${def.id}: ${problems.join("; ")}`, source });
    return out;
  }
  const paramsFile = join(root, files.params);
  if (!existsSync(paramsFile)) {
    out.push({ code: "HARDWARE_CAD_NOT_GENERATED", severity: "info", entity, message: `${def.id} has no native design (${files.params}); run \`protoboard run cad:generate --module ${def.id}\`, then cad:export`, source });
    return out;
  }
  const bytes = readFileSync(paramsFile);
  if (stableStringify(params) !== stableStringify(JSON.parse(bytes.toString("utf8")))) {
    out.push({
      code: "HARDWARE_CAD_STALE",
      severity: "warning",
      entity,
      message: `${def.id}: its sizes changed since its CAD was generated (${files.params}); run \`protoboard run cad:generate --module ${def.id}\`, then cad:export (or \`protoboard run hardware-cad --input module=${def.id}\`)`,
      source,
    });
  }
  const manifest = readJson<{ exportedFrom?: { digest?: string } }>(join(root, files.manifest));
  if (manifest && manifest.exportedFrom?.digest !== sha256(bytes)) {
    out.push({ code: "HARDWARE_CAD_EXPORT_STALE", severity: "warning", entity, message: `${def.id}: ${b.out}/ was exported from other parameters than ${files.params}; run \`protoboard run cad:export --module ${def.id}\``, source });
  }
  return out;
}

/**
 * A purchased part's body as a `cad` provider (tool-integrations §2–§4,
 * PB-836): a project-researched part (parts/local) whose body is drawn by a
 * self-contained build123d script the part's author wrote from its drawing.
 * The script is the native design; the provider runs it and keeps its
 * outputs as the standard outputs, so the part's CAD is made the same way
 * as every other module's (`protoboard run cad:generate` / `cad:export
 * --module <id>`), recorded, and checked for staleness.
 *
 *   <dir>/cad.config.ts      provider @protoboardai/ext-parts, module <id>,
 *                            constraints.generator: the script's file name
 *   <dir>/part-cad/<script>  the generator (native, hand-written)
 *   <dir>/part-cad/source.json  what generate recorded: the script's digest,
 *                            build123d version, feature signatures
 *   <dir>/out/               body.step, body.glb, body.manifest.json,
 *                            interfaces/<id>.glb (standard outputs)
 *
 * The script contract: `python <script> <out_dir>` writes body.step,
 * body.glb and body.manifest.json (`{ artifact, tool, toolVersion, units,
 * volume_mm3, bodies, features }`, with each interface feature's signature)
 * and any interfaces/<id>.glb into <out_dir>. It must be deterministic.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactDef, ModuleDef } from "@deltarobotics/uhd";
import { sha256, stableStringify, type CapabilityBinding, type OperationContext, type ProjectDiagnostic } from "@protoboardai/core";

export const PROVIDER = "@protoboardai/ext-parts";
export const NATIVE = "part-cad";

export type Writer = Pick<OperationContext, "project" | "writeOutput" | "log">;

export interface PartCadTarget {
  def: ModuleDef;
  binding: Pick<CapabilityBinding, "dir" | "native" | "out" | "constraints" | "config">;
}

interface Signature {
  area_mm2: number;
  centroid: number[];
  normal?: number[];
}

interface SourceRecord {
  schema: "protoboard.part-cad.source/v0";
  module: string;
  generator: string;
  generatorDigest: string;
  toolVersion: string;
  volume_mm3: number;
  features: Record<string, Signature>;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; summary: string; problems?: string[] };

const python = () => process.env.PROTOBOARD_PYTHON || "python3";

/** The script, the native record and the manifest of a bound part. */
export function partCadFiles(t: PartCadTarget): { generator?: string; source: string; manifest: string; problem?: string } {
  const g = t.binding.constraints.generator;
  const files = { source: `${t.binding.native}/source.json`, manifest: `${t.binding.out}/body.manifest.json` };
  if (typeof g !== "string" || !/^[\w.-]+\.py$/.test(g)) return { ...files, problem: `${t.binding.config}: constraints.generator must name the part's build123d script in ${t.binding.native}/ (e.g. "body.py")` };
  return { ...files, generator: `${t.binding.native}/${g}` };
}

function runScript(command: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr!.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => resolve({ ok: false, error: e.message.split("\n")[0] }));
    child.on("close", (code, signal) => (code === 0 ? resolve({ ok: true, stdout }) : resolve({ ok: false, error: stderr.trim().split("\n").pop() || `${command} exited with ${code ?? signal}` })));
  });
}

/** Run the script into a fresh scratch folder; check it wrote the body files. */
async function build(root: string, t: PartCadTarget): Promise<Outcome<{ scratch: string; generator: string; digest: string; manifest: Record<string, unknown> & { features?: Record<string, Signature>; toolVersion?: string; volume_mm3?: number } }>> {
  const f = partCadFiles(t);
  if (!f.generator) return { ok: false, summary: f.problem! };
  if (!existsSync(join(root, f.generator))) return { ok: false, summary: `${t.def.id}: no generator ${f.generator}` };
  const scratch = join(root, ".protoboard", "cache", "part-cad", t.def.id);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const r = await runScript(python(), [join(root, f.generator), scratch]);
  if (!r.ok) {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, summary: `${t.def.id}: generator failed: ${r.error}` };
  }
  const missing = ["body.step", "body.glb", "body.manifest.json"].filter((n) => !existsSync(join(scratch, n)));
  if (missing.length) {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, summary: `${t.def.id}: ${f.generator} did not write ${missing.join(", ")} into the folder it was given` };
  }
  return { ok: true, value: { scratch, generator: f.generator, digest: sha256(readFileSync(join(root, f.generator))), manifest: JSON.parse(readFileSync(join(scratch, "body.manifest.json"), "utf8")) } };
}

/** What the module binds now against what the script generated: the re-binding worklist. */
export function bindingDiff(def: ModuleDef, features: Record<string, Signature>) {
  const changed: { interface: string; feature: string; bound?: Signature; generated?: Signature }[] = [];
  for (const i of def.interfaces) {
    for (const ref of i.geometry?.refs ?? []) {
      if (ref.kind !== "feature" || ref.artifact !== "cad_step") continue;
      const now = features[ref.name];
      const was = ref.signature;
      const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) <= 0.05);
      const same = was && now && Math.abs(was.area_mm2 - now.area_mm2) <= 0.01 * Math.max(was.area_mm2, now.area_mm2, 1) && near(was.centroid, now.centroid);
      if (!same) changed.push({ interface: i.id, feature: ref.name, bound: was, generated: now });
    }
  }
  return changed;
}

/** generate: run the script and record what it made (digest, version, features). */
export async function generatePart(ctx: Writer, t: PartCadTarget): Promise<Outcome<SourceRecord & { rebind: ReturnType<typeof bindingDiff> }>> {
  const b = await build(ctx.project.root, t);
  if (!b.ok) return b;
  const { scratch, generator, digest, manifest } = b.value;
  rmSync(scratch, { recursive: true, force: true });
  const record: SourceRecord = {
    schema: "protoboard.part-cad.source/v0",
    module: t.def.id,
    generator,
    generatorDigest: digest,
    toolVersion: String(manifest.toolVersion ?? ""),
    volume_mm3: Number(manifest.volume_mm3 ?? 0),
    features: manifest.features ?? {},
  };
  ctx.writeOutput(partCadFiles(t).source, stableStringify(record), `${t.def.id}: what ${generator} generated`);
  ctx.log(`${t.def.id}: ${Object.keys(record.features).length} features from ${generator}`);
  return { ok: true, value: { ...record, rebind: bindingDiff(t.def, record.features) } };
}

/** export: run the script again and write its body as the standard outputs. */
export async function exportPart(ctx: Writer, t: PartCadTarget): Promise<Outcome<{ module: string; out: string; volume_mm3: number; interfaces: string[] }>> {
  const root = ctx.project.root;
  const f = partCadFiles(t);
  if (!existsSync(join(root, f.source))) return { ok: false, summary: `${t.def.id} has no native record (${f.source}); run \`protoboard run cad:generate --module ${t.def.id}\` first` };
  const sourceBytes = readFileSync(join(root, f.source));
  const b = await build(root, t);
  if (!b.ok) return b;
  const { scratch, manifest } = b.value;
  const out = t.binding.out;
  ctx.writeOutput(`${out}/body.step`, readFileSync(join(scratch, "body.step")), `${t.def.id}: body with one named sub-shape per interface feature`);
  ctx.writeOutput(`${out}/body.glb`, readFileSync(join(scratch, "body.glb")), `${t.def.id}: viewer mesh`);
  const interfaces = existsSync(join(scratch, "interfaces")) ? readdirSync(join(scratch, "interfaces")).filter((n) => n.endsWith(".glb")).sort() : [];
  for (const n of interfaces) ctx.writeOutput(`${out}/interfaces/${n}`, readFileSync(join(scratch, "interfaces", n)), `${t.def.id}: ${n.replace(/\.glb$/, "")} geometry`);
  const standard = { ...manifest, artifact: "body", exportedFrom: { file: f.source, digest: sha256(sourceBytes) } };
  ctx.writeOutput(f.manifest, JSON.stringify(standard, null, 2) + "\n", `${t.def.id}: geometry manifest (features that carry interfaces, volume)`);
  rmSync(scratch, { recursive: true, force: true });
  return { ok: true, value: { module: t.def.id, out, volume_mm3: Number(manifest.volume_mm3 ?? 0), interfaces: interfaces.map((n) => n.replace(/\.glb$/, "")) } };
}

/** The artifacts a part bound to this provider declares (`partCadArtifacts` in the part's source). */
export function partCadArtifacts(o: { dir: string; name: string; generator: string; interfaces?: string[]; tool?: string }): ArtifactDef[] {
  const tool = o.tool ?? "build123d 0.13.0";
  const out = `${o.dir}/out`;
  const provenance = { generatedFrom: "cad_source", tool };
  return [
    { id: "cad_source", name: `${o.name} generator`, type: "cad", role: "source", format: "py", filePath: `${o.dir}/${NATIVE}/${o.generator}`, description: `Drawn from the part's drawing; run by ${PROVIDER} (protoboard run cad:generate, then cad:export).` },
    { id: "cad_step", name: `${o.name} (STEP)`, type: "3d_model", role: "body", format: "step", units: "mm", filePath: `${out}/body.step`, provenance, description: "Body plus one named sub-shape per interface feature; features and signatures in the manifest." },
    { id: "cad_glb", name: `${o.name} (GLB)`, type: "3d_model", role: "body", format: "glb", units: "m", filePath: `${out}/body.glb`, provenance: { ...provenance, generatedFrom: "cad_step" }, description: "Viewer mesh of the STEP body (glTF metres, Y-up)." },
    { id: "cad_manifest", name: `${o.name} feature manifest`, type: "cad", role: "source", format: "json", filePath: `${out}/body.manifest.json`, provenance: { ...provenance, generatedFrom: "cad_step" } },
    ...(o.interfaces ?? []).map(
      (id): ArtifactDef => ({ id: `cad_if_${id}`, name: `${id} geometry`, type: "3d_model", role: "interface", interfaceId: id, format: "glb", units: "m", filePath: `${out}/interfaces/${id}.glb`, provenance: { ...provenance, generatedFrom: "cad_step" } }),
    ),
  ];
}

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

/** check: the script is the one generate ran, and out/ was exported from that record. */
export function partCadDiagnostics(root: string, t: PartCadTarget, source: ProjectDiagnostic["source"]): Omit<ProjectDiagnostic, "validator">[] {
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  const entity = { kind: "definition" as const, id: t.def.id };
  const f = partCadFiles(t);
  if (!f.generator) return [{ code: "PART_CAD_CONFIG", severity: "error", entity, message: f.problem!, source }];
  if (!existsSync(join(root, f.generator))) return [{ code: "PART_CAD_CONFIG", severity: "error", entity, message: `${t.def.id}: no generator ${f.generator}`, source }];
  const record = readJson<SourceRecord>(join(root, f.source));
  if (!record) return [{ code: "PART_CAD_NOT_GENERATED", severity: "info", entity, message: `${t.def.id} has no native record (${f.source}); run \`protoboard run cad:generate --module ${t.def.id}\`, then cad:export`, source }];
  if (record.generator !== f.generator || record.generatorDigest !== sha256(readFileSync(join(root, f.generator)))) {
    out.push({ code: "PART_CAD_STALE", severity: "warning", entity, message: `${t.def.id}: ${f.generator} changed since its body was generated; run \`protoboard run cad:generate --module ${t.def.id}\`, then cad:export`, source });
  }
  const manifest = readJson<{ exportedFrom?: { digest?: string } }>(join(root, f.manifest));
  if (manifest && manifest.exportedFrom?.digest !== sha256(readFileSync(join(root, f.source)))) {
    out.push({ code: "PART_CAD_EXPORT_STALE", severity: "warning", entity, message: `${t.def.id}: ${t.binding.out}/ was exported from another generate than ${f.source}; run \`protoboard run cad:export --module ${t.def.id}\``, source });
  }
  return out;
}

/** extract: the module's artifacts that exist (the frames are the author's, bound from the manifest's signatures). */
export function extractPart(root: string, t: PartCadTarget): Outcome<{ frames: Record<string, never>; artifacts: ArtifactDef[] }> {
  const f = partCadFiles(t);
  if (!f.generator) return { ok: false, summary: f.problem! };
  const generator = f.generator.split("/").pop()!;
  const record = readJson<SourceRecord>(join(root, f.source));
  const interfaces = existsSync(join(root, t.binding.out, "interfaces")) ? readdirSync(join(root, t.binding.out, "interfaces")).filter((n) => n.endsWith(".glb")).map((n) => n.replace(/\.glb$/, "")).sort() : [];
  const artifacts = partCadArtifacts({ dir: t.binding.dir, name: t.def.id, generator, interfaces }).filter((a) => a.filePath && existsSync(join(root, a.filePath)));
  return record ? { ok: true, value: { frames: {}, artifacts } } : { ok: false, summary: `${t.def.id} has no native record (${f.source}); run \`protoboard run cad:generate --module ${t.def.id}\` first` };
}

/**
 * The import provider (PB-1143, PB-1174): a module whose body already exists
 * as a CAD file (STEP, STL or 3MF; a printed frame's plates, an ECAD tool's
 * board STEP) gets its standard outputs from that file through ext-parts'
 * `cad` capability, with no hand-written script.
 *
 *   <dir>/cad.config.ts   provider @protoboardai/ext-parts, module <id>,
 *                         constraints: { import: "<file, relative to <dir>>", sha256, units }
 *                         (written by `protoboard parts import <file> --part <id>`)
 *   <dir>/part-cad/source.json  what generate recorded: the file, its sha256, build123d's version
 *   <dir>/out/            body.step, body.glb, body.manifest.json
 *
 * The file is read where the project keeps it (inside the project, size
 * capped: core part-files-import.ts) and converted by scripts/import_cad.py
 * on the project's CAD runtime. Its frame is kept as it is. parts/sources.json
 * records the file with provenance `imported`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { importableFile, sha256OfFile, stableStringify, type ProjectDiagnostic } from "@protoboardai/core";
import type { PartCadTarget, Writer } from "./part-cad.ts";

export const IMPORT_SCRIPT = fileURLToPath(new URL("../scripts/import_cad.py", import.meta.url));
const python = () => process.env.PROTOBOARD_PYTHON || "python3";

type Outcome<T> = { ok: true; value: T } | { ok: false; summary: string };

interface ImportRecord {
  schema: "protoboard.part-cad.import/v0";
  module: string;
  source: string;
  format: string;
  sha256: string;
  toolVersion?: string;
}

/** Whether a binding imports a file rather than running a script. */
export const isImport = (t: PartCadTarget) => typeof t.binding.constraints.import === "string";

/** The bound file: project-relative, its format and the sha256 the config pins. */
export function importSource(root: string, t: PartCadTarget): { file: string; abs: string; format: string; sha256?: string } | { problem: string } {
  const given = t.binding.constraints.import;
  if (typeof given !== "string" || !given) return { problem: `${t.binding.config}: constraints.import must name the CAD file (relative to ${t.binding.dir})` };
  try {
    const f = importableFile(root, resolvePath(root, t.binding.dir, given));
    const pinned = typeof t.binding.constraints.sha256 === "string" ? t.binding.constraints.sha256 : undefined;
    return { file: f.rel, abs: f.abs, format: f.format, ...(pinned ? { sha256: pinned } : {}) };
  } catch (e) {
    return { problem: `${t.def.id}: ${(e as Error).message}` };
  }
}

function run(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    // large board STEPs take minutes to import (ClientX's 148 MB board: about 192 s, PB-1112): 20 minutes
    const child = spawn(python(), args, { env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: ["ignore", "pipe", "pipe"], timeout: 20 * 60 * 1000 });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr!.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => resolve({ ok: false, error: e.message.split("\n")[0] }));
    child.on("close", (code, signal) => (code === 0 ? resolve({ ok: true, stdout }) : resolve({ ok: false, error: stderr.trim().split("\n").pop() || `exited with ${code ?? signal}` })));
  });
}

async function convert(root: string, t: PartCadTarget): Promise<Outcome<{ scratch: string; record: ImportRecord; manifest: Record<string, unknown> }>> {
  const s = importSource(root, t);
  if ("problem" in s) return { ok: false, summary: s.problem };
  const sha256 = sha256OfFile(s.abs);
  if (s.sha256 && s.sha256 !== sha256) return { ok: false, summary: `${t.def.id}: ${s.file} changed since it was imported (sha256 ${sha256.slice(0, 19)}…, recorded ${s.sha256.slice(0, 19)}…); check the new file, then \`protoboard parts import ${s.file} --part ${t.def.id}\` again` };
  const scratch = join(root, ".protoboard", "cache", "part-cad", t.def.id);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const r = await run([IMPORT_SCRIPT, scratch, "--source", s.abs, "--format", s.format, "--sha256", sha256, "--module", t.def.id]);
  if (!r.ok) {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, summary: `${t.def.id}: import of ${s.file} failed: ${r.error}` };
  }
  const missing = ["body.step", "body.glb", "body.manifest.json"].filter((n) => !existsSync(join(scratch, n)));
  if (missing.length) {
    rmSync(scratch, { recursive: true, force: true });
    return { ok: false, summary: `${t.def.id}: the import wrote no ${missing.join(", ")}` };
  }
  const manifest = JSON.parse(readFileSync(join(scratch, "body.manifest.json"), "utf8")) as Record<string, unknown>;
  return { ok: true, value: { scratch, manifest, record: { schema: "protoboard.part-cad.import/v0", module: t.def.id, source: s.file, format: s.format, sha256, toolVersion: String(manifest.toolVersion ?? "") } } };
}

const recordFile = (t: PartCadTarget) => `${t.binding.native}/source.json`;

/** generate: convert the file once and record what was imported (file, sha256, build123d version). */
export async function generateImport(ctx: Writer, t: PartCadTarget): Promise<Outcome<ImportRecord & { rebind: never[]; features: Record<string, never>; generator: string }>> {
  const c = await convert(ctx.project.root, t);
  if (!c.ok) return c;
  rmSync(c.value.scratch, { recursive: true, force: true });
  ctx.writeOutput(recordFile(t), stableStringify(c.value.record), `${t.def.id}: the imported file and its sha256`);
  ctx.log(`${t.def.id}: ${c.value.record.source} (${c.value.record.format}) imported`);
  return { ok: true, value: { ...c.value.record, rebind: [], features: {}, generator: c.value.record.source } };
}

/** export: convert again and write body.step, body.glb and body.manifest.json. */
export async function exportImport(ctx: Writer, t: PartCadTarget): Promise<Outcome<{ module: string; out: string; volume_mm3: number; interfaces: string[] }>> {
  const root = ctx.project.root;
  if (!existsSync(join(root, recordFile(t)))) return { ok: false, summary: `${t.def.id} has no import record (${recordFile(t)}); run \`protoboard run cad:generate --module ${t.def.id}\` first` };
  const recordBytes = readFileSync(join(root, recordFile(t)));
  const c = await convert(root, t);
  if (!c.ok) return c;
  const { scratch, manifest } = c.value;
  const out = t.binding.out;
  ctx.writeOutput(`${out}/body.step`, readFileSync(join(scratch, "body.step")), `${t.def.id}: body imported from ${c.value.record.source}`);
  ctx.writeOutput(`${out}/body.glb`, readFileSync(join(scratch, "body.glb")), `${t.def.id}: viewer mesh`);
  const standard = { ...manifest, artifact: "body", exportedFrom: { file: recordFile(t), digest: `sha256:${createHash("sha256").update(recordBytes).digest("hex")}` } };
  ctx.writeOutput(`${out}/body.manifest.json`, JSON.stringify(standard, null, 2) + "\n", `${t.def.id}: geometry manifest (imported body)`);
  rmSync(scratch, { recursive: true, force: true });
  return { ok: true, value: { module: t.def.id, out, volume_mm3: Number(manifest.volume_mm3 ?? 0), interfaces: [] } };
}

/** check: the file is still the one imported, and out/ was exported from that import. */
export function importDiagnostics(root: string, t: PartCadTarget, source: ProjectDiagnostic["source"]): Omit<ProjectDiagnostic, "validator">[] {
  const entity = { kind: "definition" as const, id: t.def.id };
  const s = importSource(root, t);
  if ("problem" in s) return [{ code: "PART_CAD_CONFIG", severity: "error", entity, message: s.problem, source }];
  const now = sha256OfFile(s.abs);
  const out: Omit<ProjectDiagnostic, "validator">[] = [];
  if (s.sha256 && s.sha256 !== now) out.push({ code: "PART_CAD_IMPORT_CHANGED", severity: "warning", entity, message: `${t.def.id}: ${s.file} changed since it was imported; check it, then \`protoboard parts import ${s.file} --part ${t.def.id}\` again`, source });
  const recPath = join(root, recordFile(t));
  if (!existsSync(recPath)) return [...out, { code: "PART_CAD_NOT_GENERATED", severity: "info", entity, message: `${t.def.id}: ${s.file} is bound but not imported yet; run \`protoboard run cad:generate --module ${t.def.id}\`, then cad:export`, source }];
  const rec = JSON.parse(readFileSync(recPath, "utf8")) as Partial<ImportRecord>;
  if (rec.sha256 !== now || rec.source !== s.file) out.push({ code: "PART_CAD_STALE", severity: "warning", entity, message: `${t.def.id}: ${s.file} is not the file imported last; run \`protoboard run cad:generate --module ${t.def.id}\`, then cad:export`, source });
  const manifestPath = join(root, t.binding.out, "body.manifest.json");
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { source?: { sha256?: string } };
    if (m.source?.sha256 && `sha256:${m.source.sha256}` !== now && m.source.sha256 !== now) out.push({ code: "PART_CAD_EXPORT_STALE", severity: "warning", entity, message: `${t.def.id}: ${t.binding.out}/ was exported from another file than ${s.file}; run \`protoboard run cad:export --module ${t.def.id}\``, source });
  }
  return out;
}

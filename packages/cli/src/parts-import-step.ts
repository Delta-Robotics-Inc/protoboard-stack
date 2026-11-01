/**
 * `protoboard parts import-step <file.step> --part <id> [--tool <reference tool>] [--replace] [--no-run]`
 * (PB-1191): a STEP that came back from a reference tool (ScanRuler's
 * reverse-engineered body, a vendor STEP, a STEP from another CAD tool)
 * becomes the part's body.
 *
 *   1. The file is checked: inside the project (links followed), a STEP, under
 *      the import size cap (core part-files-import.ts `importableFile`; 1 GiB,
 *      PROTOBOARD_MAX_IMPORT_BYTES raises it); its sha256 is taken.
 *   2. It is recorded the way `parts import` records any CAD file
 *      (`importPartFile`): an `imported` entry in parts/sources.json with the
 *      sha256, and the part bound to @protoboardai/ext-parts' cad capability
 *      with `constraints.import` (no script).
 *   3. The managed CAD runtime is found through core's python.ts (below), and
 *      cad:generate and cad:export run on it: ext-parts runs
 *      packages/ext-parts/scripts/import_cad.py, which writes out/body.step,
 *      out/body.glb and out/body.manifest.json (the file's own frame, no
 *      re-centring).
 *   4. With `--tool`, the reference tool is looked up in the registry and the
 *      import is recorded as evidence in the part's folder
 *      (`evidence/<date>-<tool>/evidence.json`, provenance
 *      `measured-from-reference-tool`, the file's sha256, the tool's id).
 *
 * The CLI registration (`case "import-step"`, the `--tool` flag) belongs to W4-D; see phase-1/handoffs.md (2026-11-01, W4-B).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname } from "node:path";
import {
  definitionDir,
  importPartFile,
  importableFile,
  loadProject,
  parsePythonRange,
  runCapabilityOperation,
  selectPython,
  toolEnvironment,
  type Project,
} from "@protoboardai/core";
// W4-D adds the `./reference-tool` export to core/package.json (handoffs.md); until then, by path
import { loadReferenceTools, referenceTool, writeReferenceEvidence } from "@protoboardai/core/reference-tool";

export type Out = (data: unknown, text: () => string) => void;

export interface ImportStepFlags {
  part?: string;
  tool?: string;
  replace?: boolean;
  /** false: record and bind only; run cad:generate and cad:export later. */
  run?: boolean;
}

/** The managed CAD runtime's range (ext-parts and ext-frame-cad declare python >=3.11,<3.15 with build123d 0.13.0). */
export const CAD_PYTHON_RANGE = ">=3.11,<3.15";
/** The build123d the managed runtime pins (ext-parts protoboard-extension.json). */
export const CAD_BUILD123D = "0.13.0";

export interface CadPython {
  python?: string;
  /** Where it came from: PROTOBOARD_PYTHON, the project's runtime, or a Python found on this machine. */
  from?: "environment" | "runtime" | "system";
  /** Why there is none. */
  problem?: string;
}

const run = (cmd: string, args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((ok) => execFile(cmd, args, { encoding: "utf8", timeout: 60_000, windowsHide: true, cwd: tmpdir() }, (err, stdout, stderr) => ok({ ok: !err, out: (err ? stderr || err.message : stdout).trim() })));

/**
 * The Python that has build123d, through core's python.ts: PROTOBOARD_PYTHON, else the project's managed `cad`
 * runtime (`protoboard tools install cad`; core tools.ts `toolEnvironment`), else a Python on this machine in
 * range (`selectPython`) that can import build123d.
 */
export async function cadRuntimePython(root: string, env: NodeJS.ProcessEnv = process.env): Promise<CadPython> {
  // the user's PROTOBOARD_PYTHON wins; else the variable the project's cad runtime sets (toolEnvironment)
  const fromEnv: { value: string; from: "environment" | "runtime" } | undefined = env.PROTOBOARD_PYTHON ? { value: env.PROTOBOARD_PYTHON, from: "environment" } : toolEnvironment(root, env).vars.PROTOBOARD_PYTHON;
  const version = async (python: string) => {
    // -I (wave 4 gate): isolated, so a build123d.py or a shadowing module in the current folder never runs
    const r = await run(python, ["-I", "-c", "import build123d; print(build123d.__version__)"]);
    return r.ok ? r.out.split(/\r?\n/).pop()!.trim() : undefined;
  };
  const has = async (python: string) => (await version(python)) !== undefined;
  if (fromEnv && existsSync(fromEnv.value)) {
    if (await has(fromEnv.value)) return { python: fromEnv.value, from: fromEnv.from };
    return { problem: `${fromEnv.value} (${fromEnv.from === "environment" ? "PROTOBOARD_PYTHON" : "the project's cad runtime"}) cannot import build123d` };
  }
  const range = parsePythonRange(CAD_PYTHON_RANGE)!;
  const sel = await selectPython({ range, env });
  for (const p of sel.working) {
    // the real interpreter file (a `py -3.12` launcher candidate reports it too)
    const exe = p.executable ?? (p.args.length ? undefined : p.command);
    // a Python found on the machine must have the runtime's pin: a different build123d/OCP pairing can import and
    // still fail on a STEP (seen 2026-11-01: a system Python 3.14 with build123d 0.7.0 imports it, then import_step raises in OCP)
    if (exe && (await version(exe)) === CAD_BUILD123D) return { python: exe, from: "system" };
  }
  return { problem: `no Python with build123d ${CAD_BUILD123D}: run \`protoboard tools install cad\` in the project, or point PROTOBOARD_PYTHON at one` };
}

/** Run cad:generate and cad:export for a part with PROTOBOARD_PYTHON set to the runtime found, then restore it. */
export async function generateAndExport(cwd: string, part: string, python: string): Promise<{ operation: string; status: string; summary: string }[]> {
  const before = process.env.PROTOBOARD_PYTHON;
  process.env.PROTOBOARD_PYTHON = python;
  const ran: { operation: string; status: string; summary: string }[] = [];
  try {
    const p = await loadProject(cwd, { checks: false });
    for (const op of ["generate", "export"]) {
      const rec = await runCapabilityOperation(p, "cad", op, part, {}, {});
      ran.push({ operation: `cad:${op}`, status: rec.status, summary: rec.summary });
      if (rec.status !== "succeeded") break;
    }
  } finally {
    if (before === undefined) delete process.env.PROTOBOARD_PYTHON;
    else process.env.PROTOBOARD_PYTHON = before;
  }
  return ran;
}

/** The evidence folder a part's sessions go in: its own folder when local, else parts/evidence/<id>/ (DEFAULT). */
export function partFolder(p: Project, part: string): string {
  try {
    return definitionDir(p, part);
  } catch {
    if (!p.definitions.get(part)) throw new Error(`no definition "${part}" in the project`);
    // DEFAULT (PB-1191): a library part's evidence sits with its other evidence, parts/evidence/<id>/
    return `parts/evidence/${part}`;
  }
}

export async function partsImportStep(cwd: string, rest: string[], flags: ImportStepFlags, out: Out): Promise<number> {
  const file = rest[0];
  const usage = "usage: protoboard parts import-step <file.step|.stp> --part <id> [--tool <reference tool id>] [--replace] [--no-run]";
  if (!file || !flags.part) throw new Error(usage);
  if (![".step", ".stp"].includes(extname(file).toLowerCase())) throw new Error(`${file}: import-step takes a STEP file (.step, .stp); \`protoboard parts import\` takes STL and 3MF`);
  const p = await loadProject(cwd, { checks: false });
  // containment, format and size cap first, before anything is written
  const f = importableFile(p.root, file);
  const registry = flags.tool ? loadReferenceTools(p.root) : undefined;
  const tool = flags.tool ? referenceTool(registry!, flags.tool) : undefined;
  const r = importPartFile(p, f.rel, flags.part, { replace: flags.replace });
  let evidence: { dir: string; file: string } | undefined;
  if (tool) {
    const w = writeReferenceEvidence(p.root, {
      part: flags.part,
      partDir: partFolder(p, flags.part),
      tool: tool.tool,
      ...(tool.model ? { toolModel: tool.model } : {}),
      imported: { file: r.entry.path!, sha256: r.entry.sha256, format: "step" },
      by: { kind: "person" },
    });
    evidence = { dir: w.dir, file: w.file };
  }
  let ran: { operation: string; status: string; summary: string }[] = [];
  let runtime: CadPython | undefined;
  if (flags.run !== false && r.config) {
    runtime = await cadRuntimePython(p.root);
    if (runtime.python) ran = await generateAndExport(cwd, flags.part, runtime.python);
  }
  const failed = ran.some((x) => x.status !== "succeeded") || (flags.run !== false && !!r.config && !runtime?.python);
  out({ ...r, ...(evidence ? { evidence } : {}), ...(runtime ? { runtime } : {}), ran }, () =>
    [
      `${r.part}: ${r.entry.path} recorded as its body (STEP, ${r.entry.sha256.slice(0, 19)}…, ${f.size} bytes) in ${r.sources}`,
      r.config ? `bound in ${r.config}: @protoboardai/ext-parts imports it through scripts/import_cad.py` : `kept ${r.keptConfig}: it already binds ${r.part} (pass --replace to bind the STEP instead)`,
      ...(evidence ? [`evidence: ${evidence.file} (provenance measured-from-reference-tool, tool ${flags.tool})`] : []),
      ...(runtime?.python ? [`CAD runtime: ${runtime.python} (${runtime.from})`] : runtime?.problem ? [`not converted: ${runtime.problem}`] : []),
      ...ran.map((x) => `  ${x.status.toUpperCase()} ${x.operation}: ${x.summary}`),
      failed || !ran.length ? `next: protoboard run cad:generate --module ${r.part}, then cad:export` : "next: protoboard build",
    ].join("\n"),
  );
  return failed ? 1 : 0;
}

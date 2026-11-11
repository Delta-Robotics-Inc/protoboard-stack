/**
 * The evidence layout writer (PB-1191): one folder per measuring session,
 *
 *   parts/local/<part>/evidence/<date>-<tool>/
 *     evidence.json      protoboard.reference-evidence/v0: the tool (id, kind, nominal dimensions, model sha256),
 *                        the photos (name, sha256, size), every measured value with provenance
 *                        `measured-from-reference-tool`, and the scale check
 *     <photo files>      copied in, names made file-system safe
 *
 * A second session with the same tool on the same day gets `<date>-<tool>-2/`;
 * nothing is overwritten. The folder is created inside the project only
 * (path containment), photos are size-capped and only copied (never opened or
 * run), and the record holds no absolute path of this machine.
 *
 * The scale check: a measurement that names one of the tool's nominal
 * dimensions (`reference: "<name>"`) is the tool measured in the same photo or
 * scan. Its deviation from the nominal, whether that is inside the tool's
 * tolerance, and the scale factor (nominal / measured) are recorded, so a
 * reader can see how far the other values can be trusted. Values are
 * recorded as measured; nothing is rescaled.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileSlug, sha256OfFile } from "../part-files.js";
import { isInsideReal, projectRelative } from "../paths.js";
import { MEASURED_FROM_REFERENCE_TOOL, REFERENCE_EVIDENCE_SCHEMA, TO_MM, UNITS, type DimensionUnit, type ReferenceTool, type Tolerance } from "./types.js";

/** What a session needs of its tool: a registered reference tool, or MANUAL_TOOL for evidence taken without one. */
export type EvidenceTool = Pick<ReferenceTool, "id" | "name" | "nominal" | "model"> & { kind: ReferenceTool["kind"] | "manual" };

/** Evidence taken with no registered reference tool (a caliper reading, a photo): no nominal, no scale check. */
export const MANUAL_TOOL: EvidenceTool = { id: "manual", name: "No reference tool", kind: "manual", nominal: [] };

/** DEFAULT: one photo or attached file up to 64 MB (PROTOBOARD_MAX_EVIDENCE_BYTES raises it). */
export const MAX_EVIDENCE_FILE_BYTES = 64 * 1024 * 1024;
const capBytes = () => Number(process.env.PROTOBOARD_MAX_EVIDENCE_BYTES) || MAX_EVIDENCE_FILE_BYTES;

/**
 * Extensions never copied into evidence or attachments: things a click could run, and source the project itself
 * loads (wave 4 gate: a `notes.uhd.ts` attached under parts/local/<id>/ matched the default source glob
 * `parts/local/** /*.uhd.ts`, so the next check would have run it; TypeScript and module files are refused too).
 */
const RUNNABLE = new Set([
  ".exe", ".bat", ".cmd", ".com", ".ps1", ".psm1", ".sh", ".command", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".vbs", ".vbe", ".jse", ".wsf", ".hta", ".msi", ".msc", ".dll", ".scr", ".cpl", ".pif", ".reg", ".scf", ".url", ".desktop",
  ".jar", ".app", ".lnk", ".py", ".pyw", ".wasm", ".node",
]);
export const isRunnableFile = (name: string) => RUNNABLE.has(extname(name).toLowerCase());

export interface MeasurementInput {
  /** What was measured: "overall-length", "hole-diameter", or a nominal dimension's name with `reference`. */
  name: string;
  value: number;
  unit: DimensionUnit;
  /** The measurement's own uncertainty (same unit), when known. */
  uncertainty?: number;
  /** This value is the tool itself, measured: the name of the tool's nominal dimension it checks. */
  reference?: string;
  note?: string;
}

export interface EvidenceInput {
  part: string;
  /** Project-relative folder of the part (parts/local/<id> for a local part). */
  partDir: string;
  tool: EvidenceTool;
  /** The tool's model as checked by the loader (status ok/missing/changed). */
  toolModel?: { status: string; sha256?: string };
  /** YYYY-MM-DD; default today (UTC). */
  date?: string;
  /** Photos or other files to copy into the folder (absolute or cwd-relative). */
  photos?: string[];
  measurements?: MeasurementInput[];
  /** A body imported through the tool (parts import-step --tool): the file and its sha256. */
  imported?: { file: string; sha256: string; format: string };
  /** Who took it: "person" or an agent's name. */
  by?: { kind: "person" | "agent"; who?: string };
  notes?: string;
}

export interface EvidenceRecord {
  schema: typeof REFERENCE_EVIDENCE_SCHEMA;
  part: string;
  date: string;
  recordedAt: string;
  by?: EvidenceInput["by"];
  tool: { id: string; name: string; kind: EvidenceTool["kind"]; nominal: ReferenceTool["nominal"]; model?: { sha256: string; status: string } };
  files: { file: string; sha256: string; bytes: number; from: string }[];
  measurements: (MeasurementInput & { provenance: { method: typeof MEASURED_FROM_REFERENCE_TOOL; tool: string; evidence: string }; check?: ScaleCheck })[];
  scale?: { reference: string; factor: number; withinTolerance: boolean };
  imported?: EvidenceInput["imported"] & { provenance: { method: typeof MEASURED_FROM_REFERENCE_TOOL; tool: string } };
  notes?: string;
}

export interface ScaleCheck {
  nominal: number;
  unit: DimensionUnit;
  tolerance: Tolerance;
  /** measured - nominal, in the nominal's unit. */
  deviation: number;
  withinTolerance: boolean;
  /** nominal / measured (both in mm): multiply a length from the same photo by this to put it on the tool's scale. */
  factor: number;
}

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

/** The session folder name: `<date>-<tool>`. */
export const evidenceDirName = (date: string, tool: string) => `${date}-${fileSlug(tool)}`;

/** Check a measurement of the tool against its nominal dimension. */
export function scaleCheck(tool: EvidenceTool, m: MeasurementInput): ScaleCheck {
  const d = tool.nominal.find((n) => n.name === m.reference);
  if (!d) throw new Error(`${m.name}: the tool ${tool.id} has no nominal dimension "${m.reference}" (it has ${tool.nominal.map((n) => n.name).join(", ") || "none"})`);
  if ((d.unit === "deg") !== (m.unit === "deg")) throw new Error(`${m.name}: ${m.unit} cannot be checked against ${d.name} in ${d.unit}`);
  const measuredInNominal = (m.value * TO_MM[m.unit]) / TO_MM[d.unit];
  const deviation = measuredInNominal - d.value;
  const within = deviation <= d.tolerance.plus + 1e-12 && -deviation <= d.tolerance.minus + 1e-12;
  return { nominal: d.value, unit: d.unit, tolerance: d.tolerance, deviation: +deviation.toPrecision(12), withinTolerance: within, factor: +(d.value / measuredInNominal).toPrecision(12) };
}

/** Parse `name=12.34mm`, `name=12.34mm+-0.02`, `ruler:length=100.2mm` (ruler: the tool's nominal it checks). */
export function parseMeasurement(text: string): MeasurementInput {
  const m = /^\s*(?:([A-Za-z0-9_.-]+):)?([A-Za-z0-9_.-]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*(mm|um|in|deg)\s*(?:(?:\+-|±)\s*(\d+(?:\.\d+)?))?\s*$/.exec(text);
  if (!m) throw new Error(`"${text}": write a measurement as name=value<unit>, e.g. hole-diameter=3.02mm or hole-diameter=3.02mm+-0.02 (units: ${UNITS.join(", ")}); prefix ref: to measure the tool itself, e.g. ref:length=100.04mm`);
  const [, ref, name, value, unit, unc] = m;
  return { name, value: Number(value), unit: unit as DimensionUnit, ...(unc ? { uncertainty: Number(unc) } : {}), ...(ref === "ref" ? { reference: name } : {}) };
}

/** Create the session folder (next free name) inside the project, and return it (absolute and project-relative). */
function sessionDir(root: string, partDir: string, date: string, tool: string): { abs: string; rel: string } {
  const base = resolve(root, partDir, "evidence");
  if (!isInsideReal(root, base)) throw new Error(`${partDir} is outside the project`);
  const name = evidenceDirName(date, tool);
  for (let n = 1; n < 1000; n++) {
    const abs = join(base, n === 1 ? name : `${name}-${n}`);
    if (existsSync(abs)) continue;
    mkdirSync(abs, { recursive: true });
    return { abs, rel: projectRelative(root, abs) };
  }
  throw new Error(`too many evidence sessions for ${tool} on ${date}`);
}

/** Copy one file into a folder under a safe, unused name. Returns the record. */
/** A file evidence may hold: there, not runnable, under the cap. Returns its absolute path and size. */
export function checkEvidenceFile(src: string): { abs: string; size: number } {
  const abs = resolve(src);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`no file ${src}`);
  if (isRunnableFile(abs)) throw new Error(`${basename(src)}: files that can run (${extname(abs)}) are not kept as evidence`);
  const size = statSync(abs).size;
  if (size > capBytes()) throw new Error(`${basename(src)} is ${size} bytes, over the ${capBytes()}-byte limit (PROTOBOARD_MAX_EVIDENCE_BYTES raises it)`);
  return { abs, size };
}

export function copyEvidenceFile(src: string, destDir: string, root: string): { file: string; sha256: string; bytes: number; from: string } {
  const { abs, size } = checkEvidenceFile(src);
  const ext = extname(abs).toLowerCase();
  const stem = fileSlug(basename(abs, extname(abs)));
  let name = `${stem}${ext}`;
  for (let n = 2; existsSync(join(destDir, name)); n++) name = `${stem}-${n}${ext}`;
  const dest = join(destDir, name);
  if (!isInsideReal(root, destDir)) throw new Error(`${destDir} is outside the project`);
  copyFileSync(abs, dest);
  return { file: projectRelative(root, dest), sha256: sha256OfFile(dest), bytes: size, from: basename(abs) };
}

/** Write one session's evidence. Returns the record and the folder (project-relative). */
export function writeReferenceEvidence(root: string, input: EvidenceInput): { dir: string; file: string; record: EvidenceRecord } {
  const date = input.date ?? isoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date ${date}: write it as YYYY-MM-DD`);
  const measurements = input.measurements ?? [];
  // check everything before writing anything
  const checks = measurements.map((m) => (m.reference ? scaleCheck(input.tool, m) : undefined));
  for (const m of measurements) {
    if (!Number.isFinite(m.value)) throw new Error(`${m.name}: the value must be a number`);
    if (!UNITS.includes(m.unit)) throw new Error(`${m.name}: unit must be one of ${UNITS.join(", ")}`);
  }
  if (!measurements.length && !(input.photos ?? []).length && !input.imported) throw new Error("nothing to record: give photos, measurements or an imported body");
  for (const p of input.photos ?? []) checkEvidenceFile(p);
  const { abs, rel } = sessionDir(root, input.partDir, date, input.tool.id);
  const files = (input.photos ?? []).map((p) => copyEvidenceFile(p, abs, root));
  const provenance = { method: MEASURED_FROM_REFERENCE_TOOL, tool: input.tool.id, evidence: rel } as const;
  const scaleIndex = checks.findIndex((c) => c);
  const record: EvidenceRecord = {
    schema: REFERENCE_EVIDENCE_SCHEMA,
    part: input.part,
    date,
    recordedAt: new Date().toISOString(),
    ...(input.by ? { by: input.by } : {}),
    tool: {
      id: input.tool.id,
      name: input.tool.name,
      kind: input.tool.kind,
      nominal: input.tool.nominal,
      ...(input.tool.model ? { model: { sha256: input.tool.model.sha256, status: input.toolModel?.status ?? "unchecked" } } : {}),
    },
    files,
    measurements: measurements.map((m, i) => ({ ...m, provenance, ...(checks[i] ? { check: checks[i] } : {}) })),
    ...(scaleIndex >= 0 ? { scale: { reference: measurements[scaleIndex].reference!, factor: checks[scaleIndex]!.factor, withinTolerance: checks[scaleIndex]!.withinTolerance } } : {}),
    ...(input.imported ? { imported: { ...input.imported, provenance: { method: MEASURED_FROM_REFERENCE_TOOL, tool: input.tool.id } } } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const file = join(abs, "evidence.json");
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { dir: rel, file: projectRelative(root, file), record };
}

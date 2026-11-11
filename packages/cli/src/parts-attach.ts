/**
 * `protoboard parts attach <part> <file> --kind evidence|drawing|datasheet` (PB-1191): put a file that belongs to a
 * part in the part's folder, with its sha256 and terms on record.
 *
 *   --kind drawing     <part folder>/drawings/<name>
 *   --kind datasheet   <part folder>/datasheets/<name>
 *   --kind evidence    <part folder>/evidence/<date>-<tool>/<name>, with evidence.json (core reference-tool
 *                      evidence.ts): the tool (--tool <id>, from the reference-tool registry; default "manual"),
 *                      measured values (--measure name=12.02mm, repeatable; `ref:<nominal>=<value>` measures the
 *                      tool itself, the scale check), each with provenance measured-from-reference-tool
 *   --terms redistributable|internal|unknown, --license <text>, --url <where it came from>
 *
 * The part folder is the local part's own (parts/local/<id>/, or its module folder); a library part's files go in
 * parts/evidence/<id>/ (DEFAULT). Every attachment is listed in `<part folder>/attachments.json`
 * (protoboard.part-attachments/v0): kind, project-relative path, sha256, size, the original name, the source URL and
 * the terms.
 *
 * DEFAULT (vendor files stay out of git, build-rules.md): a datasheet is gitignored (a `.gitignore` in datasheets/)
 * unless --terms redistributable; drawings and evidence are the project's own and stay tracked.
 *
 * Security basics: the file is copied, never opened or run; files that can run (.exe, .ps1, .sh, .js, ...) are
 * refused; a size cap (256 MB, PROTOBOARD_MAX_ATTACH_BYTES); the destination is inside the project; the name is made
 * safe on every OS (no `< > : " / \ | ? *`, no trailing dot or space, no device names).
 *
 * No ext-parts op file is needed: attach is a CLI command over core (no provider runs). Registration (`case
 * "attach"`, the `--kind`, `--tool`, `--measure`, `--license` flags) belongs to W4-D; see phase-1/handoffs.md.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileSlug, isInsideReal, loadProject, projectRelative, sha256OfFile } from "@protoboardai/core";
import { MANUAL_TOOL, isRunnableFile, isoDate, loadReferenceTools, parseMeasurement, referenceTool, writeReferenceEvidence, type EvidenceTool } from "@protoboardai/core/reference-tool";
import { partFolder, type Out } from "./parts-import-step.js";

export const ATTACHMENTS_SCHEMA = "protoboard.part-attachments/v0";
export const ATTACH_KINDS = ["evidence", "drawing", "datasheet"] as const;
export type AttachKind = (typeof ATTACH_KINDS)[number];
/** DEFAULT: 256 MB per attached file. */
export const MAX_ATTACH_BYTES = 256 * 1024 * 1024;
const cap = () => Number(process.env.PROTOBOARD_MAX_ATTACH_BYTES) || MAX_ATTACH_BYTES;
const TERMS = ["redistributable", "internal", "unknown"] as const;

export interface AttachFlags {
  kind?: string;
  tool?: string;
  measure?: string[];
  terms?: string;
  license?: string;
  url?: string;
  date?: string;
  notes?: string;
}

export interface AttachmentEntry {
  kind: AttachKind;
  file: string;
  sha256: string;
  bytes: number;
  from: string;
  url?: string;
  terms: { distribution: (typeof TERMS)[number]; license?: string };
  /** The evidence session the file belongs to (kind evidence). */
  evidence?: string;
  attachedAt: string;
}

interface AttachmentsFile {
  schema: typeof ATTACHMENTS_SCHEMA;
  part: string;
  files: AttachmentEntry[];
}

function readAttachments(file: string, part: string): AttachmentsFile {
  if (!existsSync(file)) return { schema: ATTACHMENTS_SCHEMA, part, files: [] };
  if (statSync(file).size > 16 * 1024 * 1024) throw new Error(`${file} is over 16 MB`);
  const data = JSON.parse(readFileSync(file, "utf8")) as AttachmentsFile;
  if (data.schema !== ATTACHMENTS_SCHEMA || !Array.isArray(data.files)) throw new Error(`${file} is not a ${ATTACHMENTS_SCHEMA} record`);
  return data;
}

/** Copy into `dir` under a safe name; an identical file already there is reused, a different one gets `-2`, `-3`. */
function place(src: string, dir: string, root: string): { abs: string; reused: boolean } {
  if (!isInsideReal(root, dir)) throw new Error(`${dir} is outside the project`);
  mkdirSync(dir, { recursive: true });
  const ext = extname(src).toLowerCase();
  const stem = fileSlug(basename(src, extname(src)));
  const sha = sha256OfFile(src);
  for (let n = 1; n < 1000; n++) {
    const abs = join(dir, n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`);
    if (!existsSync(abs)) {
      copyFileSync(src, abs);
      return { abs, reused: false };
    }
    if (sha256OfFile(abs) === sha) return { abs, reused: true };
  }
  throw new Error(`too many files named ${stem}${ext} in ${dir}`);
}

export async function partsAttach(cwd: string, rest: string[], flags: AttachFlags, out: Out): Promise<number> {
  const [part, file] = rest;
  const usage = "usage: protoboard parts attach <part> <file> --kind evidence|drawing|datasheet [--tool <reference tool id>] [--measure name=value<unit>]... [--terms redistributable|internal|unknown] [--license <text>] [--url <source>]";
  if (!part || !file) throw new Error(usage);
  if (!ATTACH_KINDS.includes(flags.kind as AttachKind)) throw new Error(`--kind is one of ${ATTACH_KINDS.join(", ")}\n${usage}`);
  const kind = flags.kind as AttachKind;
  if (flags.terms && !TERMS.includes(flags.terms as never)) throw new Error(`--terms is one of ${TERMS.join(", ")}`);
  if ((flags.tool || flags.measure?.length) && kind !== "evidence") throw new Error("--tool and --measure go with --kind evidence");
  const src = resolve(cwd, file);
  if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`no file ${file}`);
  if (isRunnableFile(src)) throw new Error(`${basename(src)}: files that can run (${extname(src)}) are not attached to parts`);
  const size = statSync(src).size;
  if (size > cap()) throw new Error(`${basename(src)} is ${size} bytes, over the ${cap()}-byte limit (PROTOBOARD_MAX_ATTACH_BYTES raises it)`);
  const measures = (flags.measure ?? []).map(parseMeasurement);

  const p = await loadProject(cwd, { checks: false });
  const folder = partFolder(p, part);
  const distribution = (flags.terms ?? (kind === "datasheet" ? "unknown" : "internal")) as AttachmentEntry["terms"]["distribution"];
  let abs: string;
  let evidence: { dir: string; file: string; scale?: unknown } | undefined;
  if (kind === "evidence") {
    let tool: EvidenceTool = MANUAL_TOOL;
    let model: { status: string; sha256?: string } | undefined;
    if (flags.tool) {
      const t = referenceTool(loadReferenceTools(p.root), flags.tool);
      tool = t.tool;
      model = t.model;
    }
    const w = writeReferenceEvidence(p.root, { part, partDir: folder, tool, ...(model ? { toolModel: model } : {}), ...(flags.date ? { date: flags.date } : {}), photos: [src], measurements: measures, by: { kind: "person" }, ...(flags.notes ? { notes: flags.notes } : {}) });
    abs = join(p.root, w.record.files[0].file);
    evidence = { dir: w.dir, file: w.file, ...(w.record.scale ? { scale: w.record.scale } : {}) };
  } else {
    const dir = join(p.root, folder, kind === "drawing" ? "drawings" : "datasheets");
    abs = place(src, dir, p.root).abs;
    if (kind === "datasheet" && distribution !== "redistributable") {
      const ignore = join(dir, ".gitignore");
      if (!existsSync(ignore)) writeFileSync(ignore, "# vendor datasheets stay out of git unless their terms allow it (protoboard parts attach; DEFAULT)\n*\n!.gitignore\n");
    }
  }
  const rel = projectRelative(p.root, abs);
  const entry: AttachmentEntry = {
    kind,
    file: rel,
    sha256: sha256OfFile(abs),
    bytes: size,
    from: basename(src),
    ...(flags.url ? { url: flags.url } : {}),
    terms: { distribution, ...(flags.license ? { license: flags.license } : {}) },
    ...(evidence ? { evidence: evidence.dir } : {}),
    attachedAt: new Date().toISOString(),
  };
  const listFile = join(p.root, folder, "attachments.json");
  if (!isInsideReal(p.root, listFile)) throw new Error(`${folder} is outside the project`);
  const list = readAttachments(listFile, part);
  list.files = [...list.files.filter((e) => e.file !== rel), entry].sort((a, b) => a.file.localeCompare(b.file));
  mkdirSync(join(p.root, folder), { recursive: true });
  writeFileSync(listFile, JSON.stringify(list, null, 2) + "\n");
  out({ part, entry, list: projectRelative(p.root, listFile), ...(evidence ? { evidence } : {}) }, () =>
    [
      `${part}: ${rel} attached as ${kind} (${entry.sha256.slice(0, 19)}…, ${size} bytes, terms ${distribution}${flags.license ? `, ${flags.license}` : ""})`,
      `listed in ${projectRelative(p.root, listFile)}`,
      ...(evidence ? [`evidence: ${evidence.file}${measures.length ? ` (${measures.length} measured value(s), provenance measured-from-reference-tool${flags.tool ? `, tool ${flags.tool}` : ""})` : ""}`] : []),
      ...(kind === "datasheet" && distribution !== "redistributable" ? ["kept out of git (datasheets/.gitignore); the record keeps its sha256 and source"] : []),
      `date ${isoDate()}`,
    ].join("\n"),
  );
  return 0;
}

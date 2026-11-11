/**
 * Writing a `.uhdpkg` (PB-1195): `uhdpkg.json` first, then the envelope's
 * files at their envelope paths (sorted), then any `derived/` entries
 * (sorted). Deterministic: the same envelope, files and options give the
 * same bytes (zip.ts: fixed timestamps, no host attributes; the manifest as
 * sorted-key JSON; `createdAt` fixed unless given).
 *
 * The writer applies the reader's caps and name rules, so it never makes a
 * package that `read` would refuse, and it re-hashes every file against the
 * envelope as it packs it (a file changed since the envelope was built is an
 * error, not a silently wrong package).
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { stableStringify, type PartRevisionDraft, type PartRevisionEnvelope } from "@protoboardai/cloud/client";
import { DERIVED_DIR, FIXED_CREATED_AT, MANIFEST_NAME, UHDPKG_SCHEMA, capsWith, createdBy, type DerivedEntry, type PackageProvenance, type UhdpkgCaps, type UhdpkgManifest } from "./manifest.js";
import { entryNameProblem, nameClashes } from "./names.js";
import { envelopeFiles, type Problem } from "./verify.js";
import { writeZip, type ZipInput } from "./zip.js";

export class UhdpkgError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly problems: Problem[] = [],
  ) {
    super(message);
    this.name = "UhdpkgError";
  }
}

/** Where a file's bytes come from: a file on disk or bytes in memory. */
export type FileSource = string | Uint8Array;

/** A build output to carry under `derived/<key>/<name>`. */
export interface DerivedInput {
  /** sha256 (64 hex) of the envelope file it describes. */
  key: string;
  /** File name under `derived/<key>/` (may hold `/`). */
  name: string;
  source: FileSource;
  mediaType?: string;
}

export interface PackageInput {
  envelope: PartRevisionDraft | PartRevisionEnvelope;
  /** Envelope path → bytes or a file. Every file the envelope lists must be here. */
  files: Map<string, FileSource>;
  derived?: DerivedInput[];
  /** DEFAULT: the envelope's `createdAt` when it has one, else FIXED_CREATED_AT. */
  createdAt?: string;
  provenance?: PackageProvenance;
  caps?: Partial<UhdpkgCaps>;
  /** DEFAULT "deflate" (stored when deflating saves nothing). */
  method?: "store" | "deflate";
}

export interface BuiltPackage {
  zip: Buffer;
  manifest: UhdpkgManifest;
  entries: { path: string; size: number; sha256: string }[];
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function bytesOf(src: FileSource, cap: number, what: string): Buffer {
  if (typeof src !== "string") return Buffer.from(src.buffer, src.byteOffset, src.byteLength);
  const st = statSync(src);
  if (!st.isFile()) throw new UhdpkgError("FILE_NOT_FILE", `${what}: ${src} is not a file`);
  // the size is checked before the file is read
  if (st.size > cap) throw new UhdpkgError("CAP_ENTRY", `${what} is ${st.size} bytes, over the per-entry cap of ${cap} (leave it out with --exclude ${what}, or raise the cap)`);
  return readFileSync(src);
}

/** Build a package in memory. Throws UhdpkgError when the input cannot make a package every reader accepts. */
export function buildPackage(input: PackageInput): BuiltPackage {
  const caps = capsWith(input.caps);
  const problems: Problem[] = [];
  const expected = envelopeFiles(input.envelope, problems);
  if (problems.length) throw new UhdpkgError("ENVELOPE_FILES", `the envelope's file list cannot be packaged:\n${problems.map((p) => `  ${p.code}: ${p.message}`).join("\n")}`, problems);
  const zipped: ZipInput[] = [];
  const entries: BuiltPackage["entries"] = [];
  let total = 0;
  const take = (path: string, bytes: Buffer) => {
    if (bytes.length > caps.maxEntryBytes) throw new UhdpkgError("CAP_ENTRY", `${path} is ${bytes.length} bytes, over the per-entry cap of ${caps.maxEntryBytes}`);
    total += bytes.length;
    if (total > caps.maxTotalBytes) throw new UhdpkgError("CAP_TOTAL", `the files come to over ${caps.maxTotalBytes} bytes, the cap for a package`);
    zipped.push({ name: path, data: bytes, method: input.method ?? "deflate" });
    entries.push({ path, size: bytes.length, sha256: sha256Hex(bytes) });
  };
  for (const f of [...expected].sort(byPath)) {
    const src = input.files.get(f.path);
    if (src === undefined) throw new UhdpkgError("FILE_MISSING", `${f.path} is in the envelope, but no file was given for it`);
    const bytes = bytesOf(src, caps.maxEntryBytes, f.path);
    const sha = sha256Hex(bytes);
    if (sha !== f.sha256 || bytes.length !== f.size) throw new UhdpkgError("FILE_CHANGED", `${f.path}: ${bytes.length} bytes, sha256 ${sha}; the envelope says ${f.size} bytes, ${f.sha256} (changed since the envelope was built?)`);
    take(f.path, bytes);
  }
  for (const extra of input.files.keys()) if (!expected.some((f) => f.path === extra)) throw new UhdpkgError("FILE_UNLISTED", `${extra} was given but the envelope does not list it`);
  const carried = new Set(expected.map((f) => f.sha256));
  const derived: DerivedEntry[] = [];
  for (const d of input.derived ?? []) {
    if (!/^[0-9a-f]{64}$/.test(d.key)) throw new UhdpkgError("DERIVED_KEY", `a derived entry's key must be a sha256 (64 lower-case hex), not ${JSON.stringify(d.key)}`);
    if (!carried.has(d.key)) throw new UhdpkgError("DERIVED_KEY", `derived ${d.name}: its key ${d.key} is the sha256 of no file in the envelope`);
    const path = `${DERIVED_DIR}/${d.key}/${d.name}`;
    const bad = entryNameProblem(path);
    if (bad) throw new UhdpkgError("DERIVED_NAME", `derived ${JSON.stringify(d.name)}: ${bad}`);
    const bytes = bytesOf(d.source, caps.maxEntryBytes, path);
    derived.push({ path, key: d.key, sha256: sha256Hex(bytes), size: bytes.length, ...(d.mediaType ? { mediaType: d.mediaType } : {}) });
  }
  derived.sort(byPath);
  for (const d of derived) {
    const src = input.derived!.find((x) => `${DERIVED_DIR}/${x.key}/${x.name}` === d.path)!;
    take(d.path, bytesOf(src.source, caps.maxEntryBytes, d.path));
  }
  const clashes = nameClashes([MANIFEST_NAME, ...entries.map((e) => e.path)]);
  if (clashes.length) throw new UhdpkgError("ENTRY_DUPLICATE", clashes.join("; "));
  if (entries.length + 1 > caps.maxEntries) throw new UhdpkgError("CAP_ENTRIES", `${entries.length + 1} entries, over the cap of ${caps.maxEntries}`);
  const envCreated = (input.envelope as Partial<PartRevisionEnvelope>).createdAt;
  const manifest: UhdpkgManifest = {
    schema: UHDPKG_SCHEMA,
    // the envelope exactly as given: no field added, none dropped
    envelope: input.envelope,
    required: ["envelope"],
    createdBy: createdBy(),
    createdAt: input.createdAt ?? (typeof envCreated === "string" ? envCreated : FIXED_CREATED_AT),
    ...(derived.length ? { derived } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  };
  const manifestBytes = Buffer.from(stableStringify(manifest), "utf8");
  if (manifestBytes.length > caps.maxManifestBytes) throw new UhdpkgError("CAP_MANIFEST", `${MANIFEST_NAME} would be ${manifestBytes.length} bytes, over the cap of ${caps.maxManifestBytes}`);
  const zip = writeZip([{ name: MANIFEST_NAME, data: manifestBytes }, ...zipped]);
  if (zip.length > caps.maxArchiveBytes) throw new UhdpkgError("CAP_ARCHIVE", `the package would be ${zip.length} bytes, over the cap of ${caps.maxArchiveBytes}`);
  return { zip, manifest, entries };
}

/** Why a file name may not be a package's name on disk (Windows rules), or undefined. */
export function outputNameProblem(file: string): string | undefined {
  return entryNameProblem(basename(file));
}

/**
 * Write bytes to `file` by way of a temporary file beside it and a rename,
 * so a failed write leaves no half-written package. Mode 0o644: never
 * executable.
 */
export function writeFileAtomic(file: string, bytes: Uint8Array): void {
  const bad = outputNameProblem(file);
  if (bad) throw new UhdpkgError("OUTPUT_NAME", `${basename(file)} cannot be a file name: ${bad}`);
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const tmp = `${resolve(file)}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx", 0o644);
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Build a package and write it to `file`. */
export function writePackage(file: string, input: PackageInput): BuiltPackage & { file: string } {
  const built = buildPackage(input);
  writeFileAtomic(file, built.zip);
  return { ...built, file: resolve(file) };
}

// ---------------------------------------------------------------------------
// Sources: a folder that holds an envelope and its files
// ---------------------------------------------------------------------------

/** DEFAULT: the envelope file a plain part folder holds, when it has no uhdpkg.json. */
export const ENVELOPE_FILE = "envelope.json";

/**
 * A package's input from a folder: `uhdpkg.json` (an unpacked package: its
 * envelope, derived list and provenance) or `envelope.json` (an envelope as
 * the parts service serves it), with every file at its envelope path under
 * the folder. A file whose real path leaves the folder (a link) is refused.
 */
export function inputFromFolder(dir: string, options: { caps?: Partial<UhdpkgCaps> } = {}): PackageInput {
  const caps = capsWith(options.caps);
  const root = realpathSync(resolve(dir));
  const manifestFile = join(root, MANIFEST_NAME);
  const envelopeFile = join(root, ENVELOPE_FILE);
  const which = existsSync(manifestFile) ? manifestFile : existsSync(envelopeFile) ? envelopeFile : undefined;
  if (!which) throw new UhdpkgError("FOLDER_NO_ENVELOPE", `${dir} holds neither ${MANIFEST_NAME} nor ${ENVELOPE_FILE}`);
  if (statSync(which).size > caps.maxManifestBytes) throw new UhdpkgError("CAP_MANIFEST", `${basename(which)} is over ${caps.maxManifestBytes} bytes`);
  const json = JSON.parse(readFileSync(which, "utf8")) as Record<string, unknown>;
  const fromManifest = which === manifestFile;
  if (fromManifest && json.schema !== UHDPKG_SCHEMA) throw new UhdpkgError("MANIFEST_SCHEMA", `${MANIFEST_NAME} is not a ${UHDPKG_SCHEMA} manifest`);
  const envelope = (fromManifest ? json.envelope : json) as PartRevisionDraft | PartRevisionEnvelope;
  const problems: Problem[] = [];
  const listed = envelopeFiles(envelope, problems);
  if (problems.length) throw new UhdpkgError("ENVELOPE_FILES", problems.map((p) => p.message).join("; "), problems);
  const inside = (rel: string): string => {
    const abs = resolve(root, ...rel.split("/"));
    const real = existsSync(abs) ? realpathSync(abs) : abs;
    if (real !== root && !real.startsWith(root + sep)) throw new UhdpkgError("PATH_ESCAPE", `${rel} resolves outside ${dir}`);
    return real;
  };
  const files = new Map<string, FileSource>();
  for (const f of listed) {
    const abs = inside(f.path);
    if (!existsSync(abs)) throw new UhdpkgError("FILE_MISSING", `${f.path} is in the envelope but not in ${dir}`);
    files.set(f.path, abs);
  }
  const derived: DerivedInput[] = [];
  if (fromManifest && Array.isArray(json.derived)) {
    for (const d of json.derived as DerivedEntry[]) {
      const prefix = `${DERIVED_DIR}/${d.key}/`;
      if (typeof d.path !== "string" || !d.path.startsWith(prefix)) throw new UhdpkgError("MANIFEST_DERIVED", `derived ${JSON.stringify(d.path)} does not lie under ${prefix}`);
      derived.push({ key: d.key, name: d.path.slice(prefix.length), source: inside(d.path), ...(d.mediaType ? { mediaType: d.mediaType } : {}) });
    }
  }
  return {
    envelope,
    files,
    ...(derived.length ? { derived } : {}),
    ...(fromManifest && typeof json.createdAt === "string" ? { createdAt: json.createdAt } : {}),
    // an unpacked package keeps what it said (so read then write gives the same bytes); a bare envelope folder says where it came from
    ...(fromManifest ? (json.provenance && typeof json.provenance === "object" ? { provenance: json.provenance as PackageProvenance } : {}) : { provenance: { kind: "folder" } }),
  };
}

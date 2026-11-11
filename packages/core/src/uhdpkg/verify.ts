/**
 * Checking a `.uhdpkg` (PB-1195): everything `read` checks, without writing
 * a file. The archive is judged before any entry is inflated (its size, the
 * entry count, every name, every declared size, the ratio of each entry, the
 * sum), then the manifest, then the envelope, then each entry's bytes
 * against the envelope's sha256 and size. Nothing in a package is ever
 * executed, imported or evaluated: entries are bytes that are hashed and,
 * for `read`, written.
 */
import { createHash } from "node:crypto";
import { envelopeDigest, validateDraft, type PartRevisionDraft, type Problem } from "@protoboardai/cloud/client";
import { DERIVED_DIR, KNOWN_MEMBERS, KNOWN_REQUIRED, MANIFEST_NAME, UHDPKG_SCHEMA, capsWith, type DerivedEntry, type UhdpkgCaps, type UhdpkgManifest } from "./manifest.js";
import { attributesProblem, entryNameProblem, nameClashes } from "./names.js";
import { ZipError, readEntry, readZipDirectory, type ZipEntry } from "./zip.js";

export type { Problem };

/** What an entry is in the package. */
export type EntryKind = "manifest" | "artifact" | "evidence" | "source" | "derived" | "unexpected";

export interface EntryReport {
  path: string;
  kind: EntryKind;
  size: number;
  compressedSize: number;
  method: "stored" | "deflated";
  /** The bytes' sha256, when they were read. */
  sha256?: string;
  /** What the envelope (or the manifest's `derived`) says it should be. */
  expectedSha256?: string;
  expectedSize?: number;
  status: "ok" | "bad" | "missing" | "unexpected" | "unread";
  role?: string;
  mediaType?: string;
  terms?: unknown;
  problem?: string;
}

export interface PackageReport {
  ok: boolean;
  archiveBytes: number;
  schema?: string;
  envelopeSchema?: string;
  partId?: string;
  revision?: number;
  envelopeDigest?: string;
  /** Sum of the entries' uncompressed sizes. */
  totalBytes: number;
  entries: EntryReport[];
  problems: Problem[];
  warnings: Problem[];
  manifest?: UhdpkgManifest;
}

/** A file the envelope (or the manifest's `derived`) says the package carries. */
export interface ExpectedFile {
  path: string;
  kind: Exclude<EntryKind, "manifest" | "unexpected">;
  sha256: string;
  size: number;
  role?: string;
  mediaType?: string;
  terms?: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * validateDraft codes reported as warnings, not errors: they are the parts
 * service's rules about the catalog (lineage, pinned children, the UHD
 * schema line it serves), not about whether this package is intact. The
 * service still applies them on publish. DEFAULT.
 */
// the cloud envelope's own codes (packages/cloud/src/envelope.ts), not diagnostics the stack emits: the third is
// spelled in parts so the diagnostic-codes reference check (cli skills-sop.test.ts) does not take it for one (W4-D)
export const ENVELOPE_WARNING_CODES = new Set(["DERIVED_FROM_REQUIRED", "DEPENDENCY_MISSING", ["UHD", "SCHEMA", "UNSUPPORTED"].join("_")]);

/** Fields of a published envelope that a draft does not have (the publish record). */
const RECORD_ONLY = new Set(["publisher", "createdAt"]);

/**
 * Every file an envelope carries: its artifacts, its evidence files and its
 * definition source files, with the facts the envelope gives for each.
 * Problems with the list itself (unsafe or clashing paths, bad digests, a
 * path the package format reserves) are added to `problems`.
 */
export function envelopeFiles(envelope: unknown, problems: Problem[] = []): ExpectedFile[] {
  const out: ExpectedFile[] = [];
  if (!isObject(envelope)) return out;
  const add = (kind: ExpectedFile["kind"], f: unknown, at: string) => {
    if (!isObject(f)) return;
    const { path, sha256, size } = f;
    if (typeof path !== "string") return problems.push({ code: "ENVELOPE_PATH", message: "a carried file has no path", at });
    const bad = entryNameProblem(path);
    if (bad) problems.push({ code: "ENVELOPE_PATH", message: `${path}: ${bad}`, at: `${at}.path` });
    else if (path === MANIFEST_NAME || path.toLowerCase() === MANIFEST_NAME || path.split("/")[0].toLowerCase() === DERIVED_DIR)
      problems.push({ code: "ENVELOPE_PATH_RESERVED", message: `${path}: the package format reserves ${MANIFEST_NAME} and ${DERIVED_DIR}/`, at: `${at}.path` });
    if (typeof sha256 !== "string" || !HEX64.test(sha256)) problems.push({ code: "ENVELOPE_SHA256", message: `${path}: sha256 must be 64 lower-case hex digits`, at: `${at}.sha256` });
    if (!Number.isInteger(size) || (size as number) < 0) problems.push({ code: "ENVELOPE_SIZE", message: `${path}: size must be a non-negative integer`, at: `${at}.size` });
    out.push({
      path,
      kind,
      sha256: String(sha256),
      size: Number(size),
      ...(typeof f.role === "string" ? { role: f.role } : {}),
      ...(typeof f.mediaType === "string" ? { mediaType: f.mediaType } : {}),
      ...(f.terms !== undefined ? { terms: f.terms } : {}),
    });
  };
  if (Array.isArray(envelope.artifacts)) envelope.artifacts.forEach((a, i) => add("artifact", a, `envelope.artifacts[${i}]`));
  if (Array.isArray(envelope.evidence)) envelope.evidence.forEach((e, i) => isObject(e) && e.path !== undefined && add("evidence", e, `envelope.evidence[${i}]`));
  const src = envelope.source;
  if (isObject(src) && Array.isArray(src.files)) src.files.forEach((f, i) => add("source", { ...(isObject(f) ? f : {}), mediaType: isObject(f) ? f.mediaType : undefined }, `envelope.source.files[${i}]`));
  for (const clash of nameClashes(out.map((f) => f.path))) problems.push({ code: "ENVELOPE_PATH_DUPLICATE", message: clash, at: "envelope" });
  return out;
}

/** The manifest's derived entries, checked: each under `derived/<key>/`, keyed by a sha256. */
function derivedFiles(derived: unknown, problems: Problem[], warnings: Problem[], carried: Set<string>): ExpectedFile[] {
  if (derived === undefined) return [];
  if (!Array.isArray(derived)) {
    problems.push({ code: "MANIFEST_DERIVED", message: "derived must be an array", at: "derived" });
    return [];
  }
  const out: ExpectedFile[] = [];
  derived.forEach((d: unknown, i) => {
    const at = `derived[${i}]`;
    if (!isObject(d) || typeof d.path !== "string" || typeof d.key !== "string") return problems.push({ code: "MANIFEST_DERIVED", message: "a derived entry needs path, key, sha256 and size", at });
    const bad = entryNameProblem(d.path);
    const segs = d.path.split("/");
    if (bad) return problems.push({ code: "MANIFEST_DERIVED", message: `${d.path}: ${bad}`, at: `${at}.path` });
    if (!HEX64.test(d.key)) return problems.push({ code: "MANIFEST_DERIVED", message: `${d.path}: key must be the sha256 (64 hex) of the file it describes`, at: `${at}.key` });
    if (segs.length < 3 || segs[0] !== DERIVED_DIR || segs[1] !== d.key) return problems.push({ code: "MANIFEST_DERIVED", message: `${d.path}: a derived entry lies under ${DERIVED_DIR}/<key>/`, at: `${at}.path` });
    if (typeof d.sha256 !== "string" || !HEX64.test(d.sha256) || !Number.isInteger(d.size) || (d.size as number) < 0) return problems.push({ code: "MANIFEST_DERIVED", message: `${d.path}: needs sha256 and size`, at });
    // DEFAULT: a sidecar for a file this package does not carry is kept, with a warning
    if (!carried.has(d.key)) warnings.push({ code: "DERIVED_KEY_UNKNOWN", message: `${d.path}: its key matches no file in the envelope`, at: `${at}.key` });
    out.push({ path: d.path, kind: "derived", sha256: d.sha256, size: d.size as number, ...(typeof d.mediaType === "string" ? { mediaType: d.mediaType } : {}) });
  });
  return out;
}

/** The manifest's own members, checked. Returns the manifest when it can be used. */
function checkManifest(m: unknown, problems: Problem[], warnings: Problem[]): UhdpkgManifest | undefined {
  if (!isObject(m)) {
    problems.push({ code: "MANIFEST_INVALID", message: `${MANIFEST_NAME} is not a JSON object` });
    return undefined;
  }
  if (m.schema !== UHDPKG_SCHEMA) problems.push({ code: "MANIFEST_SCHEMA", message: `schema must be "${UHDPKG_SCHEMA}" (this reader does not know ${JSON.stringify(m.schema)})`, at: "schema" });
  for (const k of Object.keys(m)) if (!(KNOWN_MEMBERS as readonly string[]).includes(k)) warnings.push({ code: "MANIFEST_MEMBER_UNKNOWN", message: `${k} is not a member this reader knows; ignored`, at: k });
  if (!Array.isArray(m.required) || m.required.some((r) => typeof r !== "string")) problems.push({ code: "MANIFEST_REQUIRED", message: "required must be an array of names", at: "required" });
  else {
    for (const r of m.required as string[])
      if (!(KNOWN_REQUIRED as readonly string[]).includes(r)) problems.push({ code: "REQUIRED_UNKNOWN", message: `the package requires "${r}", which this reader does not understand`, at: "required" });
    if (!(m.required as string[]).includes("envelope")) problems.push({ code: "MANIFEST_REQUIRED", message: 'required must list "envelope"', at: "required" });
  }
  if (typeof m.createdBy !== "string") warnings.push({ code: "MANIFEST_CREATED_BY", message: "createdBy is missing", at: "createdBy" });
  if (typeof m.createdAt !== "string" || Number.isNaN(Date.parse(m.createdAt))) warnings.push({ code: "MANIFEST_CREATED_AT", message: "createdAt is missing or not a date", at: "createdAt" });
  if (!isObject(m.envelope)) {
    problems.push({ code: "MANIFEST_ENVELOPE", message: "envelope is missing", at: "envelope" });
    return undefined;
  }
  return m as unknown as UhdpkgManifest;
}

/** The envelope's own checks (packages/cloud validateDraft), split into errors and warnings by ENVELOPE_WARNING_CODES. */
function checkEnvelope(envelope: Record<string, unknown>, problems: Problem[], warnings: Problem[]): void {
  const draft = Object.fromEntries(Object.entries(envelope).filter(([k]) => !RECORD_ONLY.has(k))) as unknown as PartRevisionDraft;
  const found = validateDraft(draft);
  for (const p of found) (ENVELOPE_WARNING_CODES.has(p.code) ? warnings : problems).push({ ...p, at: `envelope${p.at ? `.${p.at}` : ""}` });
  // validateDraft compares the digest only when it found nothing at all; a warning must not skip that check
  if (found.length && found.every((p) => ENVELOPE_WARNING_CODES.has(p.code)) && typeof draft.digest === "string" && draft.digest !== envelopeDigest(draft))
    problems.push({ code: "DIGEST_MISMATCH", message: `digest does not match the content (expected ${envelopeDigest(draft)})`, at: "envelope.digest" });
}

export interface InspectOptions {
  caps?: Partial<UhdpkgCaps>;
  /**
   * Called with each entry's bytes once they are checked against the
   * envelope (and only then): `read` writes them. Not called for the
   * manifest, nor for a bad or unexpected entry.
   */
  onFile?: (file: ExpectedFile, bytes: Buffer) => void;
  /** Called with the manifest's bytes once it parses and passes its own checks. */
  onManifest?: (bytes: Buffer) => void;
}

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const methodName = (m: number): EntryReport["method"] => (m === 8 ? "deflated" : "stored");

/** Check a package in memory. Never throws for a bad package: the report says what is wrong. */
export function inspectPackage(zip: Buffer, options: InspectOptions = {}): PackageReport {
  const caps = capsWith(options.caps);
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  const report = (extra: Partial<PackageReport> = {}): PackageReport => ({ archiveBytes: zip.length, totalBytes: 0, entries: [], problems, warnings, ...extra, ok: problems.length === 0 });

  // 1. the archive as a whole, before anything is inflated
  if (zip.length > caps.maxArchiveBytes) {
    problems.push({ code: "CAP_ARCHIVE", message: `the archive is ${zip.length} bytes, over the cap of ${caps.maxArchiveBytes}` });
    return report();
  }
  let dir: ZipEntry[];
  try {
    dir = readZipDirectory(zip, { maxEntries: caps.maxEntries });
  } catch (e) {
    problems.push({ code: e instanceof ZipError ? e.code : "ZIP_DAMAGED", message: (e as Error).message });
    return report();
  }
  const entries: EntryReport[] = dir.map((e) => ({ path: e.name, kind: "unexpected", size: e.size, compressedSize: e.compressedSize, method: methodName(e.method), status: "unread" }));
  const totalBytes = dir.reduce((n, e) => n + e.size, 0);
  let fatal = false;
  dir.forEach((e) => {
    const bad = entryNameProblem(e.name) ?? attributesProblem(e.externalAttributes, e.madeBy);
    if (bad) {
      problems.push({ code: "ENTRY_NAME", message: `${JSON.stringify(e.name)} is refused: ${bad}`, at: e.name });
      fatal = true;
    }
    if (e.size > caps.maxEntryBytes) {
      problems.push({ code: "CAP_ENTRY", message: `${e.name} is ${e.size} bytes uncompressed, over the cap of ${caps.maxEntryBytes}`, at: e.name });
      fatal = true;
    }
    if (e.size >= caps.ratioMinBytes && e.size > caps.maxRatio * Math.max(1, e.compressedSize)) {
      problems.push({ code: "CAP_RATIO", message: `${e.name} expands ${Math.round(e.size / Math.max(1, e.compressedSize))}:1, over the cap of ${caps.maxRatio}:1 (a zip bomb?)`, at: e.name });
      fatal = true;
    }
  });
  for (const clash of nameClashes(dir.map((e) => e.name))) {
    problems.push({ code: "ENTRY_DUPLICATE", message: clash });
    fatal = true;
  }
  if (totalBytes > caps.maxTotalBytes) {
    problems.push({ code: "CAP_TOTAL", message: `the entries come to ${totalBytes} bytes uncompressed, over the cap of ${caps.maxTotalBytes}` });
    fatal = true;
  }
  if (!dir.length || dir[0].name !== MANIFEST_NAME) {
    problems.push({ code: "MANIFEST_MISSING", message: `the first entry must be ${MANIFEST_NAME}` });
    fatal = true;
  }
  if (fatal) return report({ entries, totalBytes });

  // 2. the manifest
  const mEntry = dir[0];
  entries[0].kind = "manifest";
  if (mEntry.size > caps.maxManifestBytes) {
    problems.push({ code: "CAP_MANIFEST", message: `${MANIFEST_NAME} is ${mEntry.size} bytes, over the cap of ${caps.maxManifestBytes}` });
    return report({ entries, totalBytes });
  }
  let manifest: UhdpkgManifest | undefined;
  try {
    const bytes = readEntry(zip, mEntry);
    entries[0].sha256 = sha256Hex(bytes);
    entries[0].status = "ok";
    manifest = checkManifest(JSON.parse(bytes.toString("utf8")), problems, warnings);
    if (manifest) options.onManifest?.(bytes);
  } catch (e) {
    entries[0].status = "bad";
    problems.push({ code: e instanceof ZipError ? e.code : "MANIFEST_INVALID", message: e instanceof SyntaxError ? `${MANIFEST_NAME} is not JSON (${e.message})` : (e as Error).message, at: MANIFEST_NAME });
  }
  if (!manifest) return report({ entries, totalBytes });
  const env = manifest.envelope as unknown as Record<string, unknown>;
  const base: Partial<PackageReport> = {
    schema: manifest.schema,
    envelopeSchema: typeof env.schema === "string" ? env.schema : undefined,
    partId: typeof env.partId === "string" ? env.partId : undefined,
    revision: typeof env.revision === "number" ? env.revision : undefined,
    envelopeDigest: typeof env.digest === "string" ? env.digest : undefined,
    manifest,
    totalBytes,
  };

  // 3. the envelope and the files it lists
  checkEnvelope(env, problems, warnings);
  const expected = envelopeFiles(env, problems);
  const carriedShas = new Set(expected.map((f) => f.sha256));
  expected.push(...derivedFiles(manifest.derived, problems, warnings, carriedShas));
  if (problems.length) return report({ ...base, entries });

  // 4. every entry against what is expected, by bytes
  const byPath = new Map(expected.map((f) => [f.path, f]));
  const present = new Set<string>([MANIFEST_NAME]);
  dir.forEach((e, i) => {
    if (i === 0) return;
    const r = entries[i];
    const want = byPath.get(e.name);
    present.add(e.name);
    if (!want) {
      r.status = "unexpected";
      problems.push({ code: "ENTRY_UNEXPECTED", message: `${e.name} is in the archive but not in the envelope (nor in the manifest's derived list)`, at: e.name });
      return;
    }
    Object.assign(r, { kind: want.kind, expectedSha256: want.sha256, expectedSize: want.size, ...(want.role ? { role: want.role } : {}), ...(want.mediaType ? { mediaType: want.mediaType } : {}), ...(want.terms !== undefined ? { terms: want.terms } : {}) });
    if (e.size !== want.size) {
      r.status = "bad";
      r.problem = `${e.size} bytes, the envelope says ${want.size}`;
      problems.push({ code: "ENTRY_SIZE", message: `${e.name}: ${r.problem}`, at: e.name });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = readEntry(zip, e);
    } catch (err) {
      r.status = "bad";
      r.problem = (err as Error).message;
      problems.push({ code: err instanceof ZipError ? err.code : "ZIP_DAMAGED", message: r.problem, at: e.name });
      return;
    }
    r.sha256 = sha256Hex(bytes);
    if (r.sha256 !== want.sha256) {
      r.status = "bad";
      r.problem = `sha256 ${r.sha256}, the envelope says ${want.sha256}`;
      problems.push({ code: "ENTRY_SHA256", message: `${e.name}: ${r.problem}`, at: e.name });
      return;
    }
    r.status = "ok";
    options.onFile?.(want, bytes);
  });
  for (const f of expected) {
    if (present.has(f.path)) continue;
    entries.push({ path: f.path, kind: f.kind, size: 0, compressedSize: 0, method: "stored", expectedSha256: f.sha256, expectedSize: f.size, status: "missing", ...(f.role ? { role: f.role } : {}), ...(f.mediaType ? { mediaType: f.mediaType } : {}), ...(f.terms !== undefined ? { terms: f.terms } : {}) });
    problems.push({ code: "ENTRY_MISSING", message: `${f.path} is in the ${f.kind === "derived" ? "manifest's derived list" : "envelope"} but not in the archive`, at: f.path });
  }
  return report({ ...base, entries });
}

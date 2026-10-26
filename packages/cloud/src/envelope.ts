/**
 * Part revision envelope, `protoboard.part-revision/v1`: the unit the parts
 * service stores and serves (docs/specs/tool-integrations.md § 6).
 *
 * One envelope is one immutable revision of one part: the UHD definition, the
 * exact revisions of the definitions it references, the files that come with
 * it (artifacts and evidence, by content digest), and where it came from.
 * Supplier offers are not technical facts and are not part of it.
 *
 * Pure: shared by the server, the client and the publishing scripts. Uses only
 * node:crypto, so the stack can import it without extra dependencies.
 */
import { createHash } from "node:crypto";

export const PART_REVISION_SCHEMA = "protoboard.part-revision/v1";

/**
 * The envelope identifier of the open UHD library protocol
 * (`uhd-library/v1`, UHD docs/library-protocol.md § 4). The format is the
 * same as PART_REVISION_SCHEMA's, member for member and digest for digest.
 * `schema` is inside the digest and revisions never change, so the revisions
 * already published keep PART_REVISION_SCHEMA, and so do new ones until the
 * catalog moves over deliberately (it would change every envelope digest
 * that projects pin). The service accepts and serves both, and lists both in
 * its discovery document as the protocol's § 4.4 allows.
 */
export const UHD_PART_REVISION_SCHEMA = "uhd.part-revision/v1";

/** Envelope identifiers accepted for publishing and reading. */
export const ENVELOPE_SCHEMAS = [PART_REVISION_SCHEMA, UHD_PART_REVISION_SCHEMA] as const;
export type EnvelopeSchema = (typeof ENVELOPE_SCHEMAS)[number];

/**
 * UHD schema versions this service accepts: the `@deltarobotics/uhd` minor
 * line a definition is written against (`uhdSchemaVersion`: a library built
 * with UHD 0.2.1 records 0.2.0). Before 1.0 a minor version may break the
 * schema, so the range names each minor line it reads. 0.3.0 only widens
 * the schema (net ports, the board marker, piezo and charge vocabulary): a
 * definition written for 0.2 is a valid 0.3 definition, so this release,
 * built against 0.3.0, reads both lines. A client before it reads 0.2 only
 * and refuses a revision recorded as 0.3.0.
 */
export const SUPPORTED_UHD_SCHEMA: UhdSchemaRange = { min: "0.2.0", below: "0.4.0" };

export interface UhdSchemaRange {
  /** Lowest accepted version, inclusive. */
  min: string;
  /** First version no longer accepted. */
  below: string;
}

/**
 * The parts of a UHD ModuleDef this service reads. The definition is stored
 * and served unchanged; everything else in it is opaque here, so the service
 * does not pin a UHD release at the type level.
 */
export interface UhdModuleDef {
  id: string;
  name: string;
  description?: string;
  version?: string;
  manufacturer?: string;
  part_number?: string;
  tags?: string[];
  categories?: string[];
  interfaces: { id: string; domain: string; exposed?: boolean; protocols?: { type: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  children?: { id: string; moduleDefId: string; [key: string]: unknown }[];
  harnesses?: { id: string; artifacts?: UhdArtifactDef[] }[];
  artifacts?: UhdArtifactDef[];
  domains?: { domain: string }[];
  [key: string]: unknown;
}

export interface UhdArtifactDef {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  filePath?: string;
  mimeType?: string;
  format?: string;
  role?: string;
  interfaceId?: string;
  [key: string]: unknown;
}

/** An exact revision of a part. */
export interface PartRef {
  partId: string;
  revision: number;
}

/**
 * What a file is for. The first four are UHD `ArtifactDef.role`; `thumbnail`
 * is the library's preview image, `license` the terms a vendor file ships
 * under, `attachment` anything else the definition references.
 */
export const ARTIFACT_ROLES = ["body", "interface", "source", "drawing", "thumbnail", "license", "attachment"] as const;
export type ArtifactRole = (typeof ARTIFACT_ROLES)[number];

/**
 * Who may receive a file (UHD docs/library-protocol.md § 4.5):
 * `redistributable`, its terms allow passing it on; `internal`, its terms
 * restrict use or redistribution, so it stays with the team; `unknown`, no
 * terms could be established (unverified). Only `redistributable` files
 * leave the team.
 */
export const DISTRIBUTION_CLASSES = ["redistributable", "internal", "unknown"] as const;
export type Distribution = (typeof DISTRIBUTION_CLASSES)[number];

/** The terms a file comes under (uhd.part-revision/v1 `terms`, protocol § 4.5). Inside the digest. */
export interface FileTerms {
  distribution: Distribution;
  /** SPDX licence id, or a `LicenseRef-…` id or plain name. */
  license?: string;
  licenseUrl?: string;
  /** A file of the same revision holding the licence text. */
  licensePath?: string;
  /** The notice redistribution must carry. */
  attribution?: string;
  summary?: string;
  /** Where the file (or the archive it was taken from) was downloaded. */
  sourceUrl?: string;
  /** SHA-256 of the bytes as downloaded, when they differ from the file's. */
  sourceSha256?: string;
  /** ISO 8601 date or date-time the file and its terms were retrieved. */
  retrieved?: string;
}

export const TERMS_FIELDS = ["distribution", "license", "licenseUrl", "licensePath", "attribution", "summary", "sourceUrl", "sourceSha256", "retrieved"] as const;

export interface EnvelopeArtifact {
  /**
   * Path as the definition references it (`ArtifactDef.filePath`), relative
   * to the revision's artifact base. Normalised: no `.`/`..` segments, no
   * leading slash, forward slashes.
   */
  path: string;
  /** Lower-case hex SHA-256 of the file: its blob address. */
  sha256: string;
  size: number;
  mediaType: string;
  role: ArtifactRole;
  /** The `ArtifactDef.id` this file backs, when the definition references it. */
  artifactId?: string;
  /** Licence and distribution of the file; absent means unknown. */
  terms?: FileTerms;
}

/**
 * A file the definition references that this revision does not carry, and
 * why. Recorded so a consumer reports it instead of finding out later.
 */
export interface MissingArtifact {
  path: string;
  artifactId: string;
  reason: string;
}

export const EVIDENCE_KINDS = ["sources", "verification", "datasheet", "document", "other"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Evidence behind the definition's facts: a file carried by the revision
 * (path + sha256 + size + mediaType) or an external reference (url).
 */
export interface EvidenceRef {
  kind: EvidenceKind;
  title?: string;
  path?: string;
  sha256?: string;
  size?: number;
  mediaType?: string;
  url?: string;
  /** For a carried file: its licence and distribution. */
  terms?: FileTerms;
}

/**
 * Where the definition was authored, for traceability (not lineage: see
 * `derivedFrom`). Part of the publish record, not the content: a new commit
 * in the source repository that leaves the part alone is not a new revision.
 */
export interface RevisionSource {
  /** Repository or system it came from, e.g. "uhd library". */
  repository: string;
  /** Commit or version of that source. */
  commit?: string;
  /** File inside it. */
  path?: string;
  /** The source checkout had uncommitted changes when published. */
  dirty?: boolean;
  /**
   * Definition source (UHD library protocol § 4.6, PB-910): the module the
   * definition is evaluated from, one of `files` (`<part-id>.uhd.ts`).
   */
  entry?: string;
  /** The entry's export holding the definition. */
  export?: string;
  /** The source closure: the entry and every library module it imports, as blobs. */
  files?: SourceFile[];
  /** Version ranges the source needs: `@deltarobotics/uhd` (like a peerDependency) and TypeScript. */
  requires?: SourceRequirements;
}

/** A file of the definition source: a blob, at a path in the revision's file namespace. */
export interface SourceFile {
  path: string;
  sha256: string;
  size: number;
  mediaType: string;
}

export interface SourceRequirements {
  uhd: string;
  typescript: string;
}

/** The media type of a source file. */
export const SOURCE_MEDIA_TYPE = "text/typescript";

/** Whether a revision ships definition source. */
export const hasSourceFiles = (env: { source?: RevisionSource }): boolean => Array.isArray(env.source?.files) && env.source!.files!.length > 0;

/**
 * The record of § 4.6.1 as far as it can be judged without the bytes: entry
 * among the files, paths normalised, `.ts`, unique and apart from the
 * revision's other files, each a blob address, and both requirements given.
 * The lint (what the code may do) needs the bytes: UHD's `lintSource`.
 */
export function sourceRecordProblems(env: Pick<PartRevisionDraft, "artifacts" | "evidence" | "source">): Problem[] {
  const out: Problem[] = [];
  const s = env.source as unknown;
  if (!isObject(s) || s.files === undefined) {
    if (isObject(s)) for (const k of ["entry", "export", "requires"]) if (s[k] !== undefined) out.push({ code: "SOURCE_INVALID", message: `source.${k} without source.files`, at: `source.${k}` });
    return out;
  }
  const add = (message: string, at: string) => out.push({ code: "SOURCE_INVALID", message, at });
  if (!Array.isArray(s.files) || s.files.length === 0) return [{ code: "SOURCE_INVALID", message: "source.files must be a non-empty array", at: "source.files" }];
  const others = new Set([...(env.artifacts ?? []).map((a) => a?.path), ...(env.evidence ?? []).flatMap((e) => (e?.path !== undefined ? [e.path] : []))]);
  const seen = new Set<string>();
  (s.files as unknown[]).forEach((f, i) => {
    const at = `source.files[${i}]`;
    if (!isObject(f)) return add("source file must be an object", at);
    for (const k of Object.keys(f)) if (!["path", "sha256", "size", "mediaType"].includes(k)) add(`${k} is not a source file field`, `${at}.${k}`);
    if (typeof f.path !== "string" || !isSafePath(f.path) || !/\.ts$/.test(f.path)) add("path must be a normalised relative .ts path", `${at}.path`);
    else if (seen.has(f.path) || others.has(f.path)) add(`${f.path} is listed twice among the revision's files`, `${at}.path`);
    else seen.add(f.path);
    if (typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) add("sha256 must be 64 lower-case hex digits", `${at}.sha256`);
    if (!Number.isInteger(f.size) || (f.size as number) < 0) add("size must be a non-negative integer", `${at}.size`);
    if (typeof f.mediaType !== "string" || f.mediaType === "") add("mediaType is required", `${at}.mediaType`);
  });
  if (typeof s.entry !== "string" || !seen.has(s.entry)) add("source.entry must be one of source.files", "source.entry");
  if (typeof s.export !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s.export)) add("source.export must be an export name", "source.export");
  const req = s.requires;
  if (!isObject(req) || typeof req.uhd !== "string" || req.uhd === "" || typeof req.typescript !== "string" || req.typescript === "") add("source.requires must be { uhd, typescript } version ranges", "source.requires");
  return out;
}

/** What a publisher sends. */
export interface PartRevisionDraft {
  schema: EnvelopeSchema;
  uhdSchema: string;
  partId: string;
  revision: number;
  definition: UhdModuleDef;
  /** `sha256:` digest of `stableStringify(definition)`: the vendored file's bytes. */
  definitionDigest: string;
  /** Exact revisions of every definition this one references (its children). */
  dependencies: PartRef[];
  artifacts: EnvelopeArtifact[];
  missingArtifacts: MissingArtifact[];
  evidence: EvidenceRef[];
  /**
   * The revision this one was made from: the previous revision of the same
   * part for an update, or another part's revision for a variant. Null only
   * for a first revision authored from scratch.
   */
  derivedFrom: PartRef | null;
  /** Kept as sent with the first publish; outside the digest. */
  source?: RevisionSource;
  /** `sha256:` digest over the canonical JSON of the content fields (see `envelopeDigest`). */
  digest: string;
}

/** What the service stores and serves: the draft plus the publish record. */
export interface PartRevisionEnvelope extends PartRevisionDraft {
  publisher: { name: string };
  createdAt: string;
}

/** Fields that record the publish rather than the content; outside the digest. */
const RECORD_FIELDS = new Set(["digest", "source", "publisher", "createdAt"]);

const sortedValue = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortedValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortedValue((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
};

/**
 * Canonical JSON: keys sorted by UTF-16 code unit, undefined members dropped,
 * no whitespace. For the JSON this service accepts (no non-finite numbers)
 * this is RFC 8785 (JCS).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

/**
 * The bytes the stack writes for a vendored definition
 * (packages/core/src/build.ts `stableStringify`): sorted keys, two-space
 * indent, trailing newline. Its digest is what parts/origins.json pins.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortedValue(value), null, 2) + "\n";
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
export const sha256Digest = (bytes: Uint8Array | string): string => "sha256:" + sha256Hex(bytes);

export const definitionDigest = (definition: UhdModuleDef): string => sha256Digest(stableStringify(definition));

/** Digest of an envelope or draft: every field except `digest`, `source`, `publisher` and `createdAt`. */
export function envelopeDigest(envelope: PartRevisionDraft & { publisher?: unknown; createdAt?: unknown }): string {
  const content = Object.fromEntries(Object.entries(envelope).filter(([k]) => !RECORD_FIELDS.has(k)));
  return sha256Digest(canonicalJson(content));
}

/**
 * What a revision says, apart from its number and lineage: the definition,
 * the UHD schema, pinned dependencies and every file. Two revisions of a part
 * with the same content are the same part; publishing the second would only
 * mint a number.
 */
export function sameContent(a: PartRevisionDraft, b: PartRevisionDraft): boolean {
  const content = (d: PartRevisionDraft) =>
    canonicalJson({ partId: d.partId, uhdSchema: d.uhdSchema, definitionDigest: d.definitionDigest, dependencies: d.dependencies, artifacts: d.artifacts, missingArtifacts: d.missingArtifacts, evidence: d.evidence });
  return content(a) === content(b);
}

/** Fill in `definitionDigest` and `digest`. */
export function sealDraft(draft: Omit<PartRevisionDraft, "definitionDigest" | "digest">): PartRevisionDraft {
  const withDef = { ...draft, definitionDigest: definitionDigest(draft.definition) } as PartRevisionDraft;
  return { ...withDef, digest: envelopeDigest(withDef) };
}

/** Every file path the definition references, with the artifact that references it. */
export function referencedFiles(definition: UhdModuleDef): { path: string; artifact: UhdArtifactDef }[] {
  const all = [...(definition.artifacts ?? []), ...(definition.harnesses ?? []).flatMap((h) => h.artifacts ?? [])];
  return all.filter((a) => typeof a.filePath === "string" && a.filePath !== "").map((a) => ({ path: a.filePath as string, artifact: a }));
}

/** Ids of the definitions this one references (its children), sorted. */
export function referencedDefinitions(definition: UhdModuleDef): string[] {
  return [...new Set((definition.children ?? []).map((c) => c.moduleDefId))].sort();
}

/** Search facets, computed as the UHD library manifest does (uhd scripts/build-library.ts). */
export function facets(definition: UhdModuleDef): { tags: string[]; protocols: string[]; domains: string[] } {
  const uniq = (v: string[]) => [...new Set(v)].sort();
  return {
    tags: uniq([...(definition.tags ?? []), ...(definition.categories ?? [])]),
    protocols: uniq(definition.interfaces.filter((i) => i.exposed).flatMap((i) => (i.protocols ?? []).map((p) => p.type))),
    domains: uniq([...definition.interfaces.map((i) => i.domain), ...(definition.domains ?? []).map((d) => d.domain)]),
  };
}

/** Whether a file's terms let it leave the team; no terms is unknown. */
export const isRedistributable = (file: { terms?: { distribution?: string } }): boolean => file.terms?.distribution === "redistributable";

/**
 * Whether a revision can be given out as it is (protocol § 4.5): every file
 * that backs an artifact of the definition is redistributable. `blocking`
 * lists those that are not; `withheld` the optional files (thumbnail,
 * licence texts, attachments, evidence) a redistributable copy leaves out.
 * Dependencies are the caller's to check.
 */
export function revisionDistribution(env: Pick<PartRevisionDraft, "artifacts" | "evidence">): { redistributable: boolean; blocking: string[]; withheld: string[] } {
  const blocking = env.artifacts.filter((a) => a.artifactId !== undefined && !isRedistributable(a)).map((a) => a.path);
  const withheld = [...env.artifacts.filter((a) => a.artifactId === undefined), ...env.evidence.filter((e) => e.path !== undefined)].filter((f) => !isRedistributable(f)).map((f) => f.path!);
  return { redistributable: blocking.length === 0, blocking, withheld };
}

/** Problems with one `terms` object; `paths` are the revision's files (for `licensePath`). */
export function termsProblems(terms: unknown, at: string, paths?: Set<string>): Problem[] {
  const out: Problem[] = [];
  const add = (field: string, message: string) => out.push({ code: "TERMS_INVALID", message, at: `${at}.${field}` });
  if (!isObject(terms)) return [{ code: "TERMS_INVALID", message: "terms must be an object", at }];
  for (const k of Object.keys(terms)) if (!(TERMS_FIELDS as readonly string[]).includes(k)) add(k, `${k} is not a terms field`);
  if (!(DISTRIBUTION_CLASSES as readonly unknown[]).includes(terms.distribution)) add("distribution", `distribution must be one of ${DISTRIBUTION_CLASSES.join(", ")}`);
  for (const k of ["license", "licensePath", "retrieved"]) if (terms[k] !== undefined && (typeof terms[k] !== "string" || terms[k] === "")) add(k, `${k} must be a non-empty string`);
  for (const k of ["attribution", "summary"]) if (terms[k] !== undefined && typeof terms[k] !== "string") add(k, `${k} must be a string`);
  for (const k of ["licenseUrl", "sourceUrl"]) if (terms[k] !== undefined && !(typeof terms[k] === "string" && /^https?:\/\//.test(terms[k] as string))) add(k, `${k} must be an http(s) URL`);
  if (terms.sourceSha256 !== undefined && !(typeof terms.sourceSha256 === "string" && HEX64.test(terms.sourceSha256))) add("sourceSha256", "sourceSha256 must be 64 lower-case hex digits");
  if (paths && typeof terms.licensePath === "string" && terms.licensePath !== "" && !paths.has(terms.licensePath)) add("licensePath", `${terms.licensePath} is not a file of this revision`);
  return out;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a)!.slice(1, 4).map(Number);
  const pb = SEMVER.exec(b)!.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The UHD schema version a `@deltarobotics/uhd` package version carries: the
 * first release of its minor line (0.2.1 and 0.2.7-dev.3 carry schema 0.2.0).
 * A patch release fixes UHD without changing the schema, so a definition
 * built with any 0.2.x is written against 0.2.0 and reads under every 0.2.x.
 * This is what a library records as `uhdSchema` (inside the envelope digest:
 * recording the package version instead would make every part of an
 * unchanged library a different revision after each UHD patch release) and
 * what its source declares as `requires.uhd` (`^<uhdSchema>`).
 */
export function uhdSchemaVersion(packageVersion: string): string {
  const m = SEMVER.exec(packageVersion);
  if (!m) throw new Error(`${JSON.stringify(packageVersion)} is not a version such as 0.2.1`);
  return `${m[1]}.${m[2]}.0`;
}

export function uhdSchemaSupported(version: string, range: UhdSchemaRange = SUPPORTED_UHD_SCHEMA): boolean {
  return SEMVER.test(version) && compareVersions(version, range.min) >= 0 && compareVersions(version, range.below) < 0;
}

export const PART_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** A normalised relative path: forward slashes, no empty, `.` or `..` segments. */
export function isSafePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export interface Problem {
  /** Stable code, e.g. UHD_SCHEMA_UNSUPPORTED. */
  code: string;
  message: string;
  /** Where in the envelope, e.g. "artifacts[3].path". */
  at?: string;
}

const DRAFT_FIELDS = new Set([
  "schema", "uhdSchema", "partId", "revision", "definition", "definitionDigest", "dependencies",
  "artifacts", "missingArtifacts", "evidence", "derivedFrom", "source", "digest",
]);

const SOURCE_FIELDS = new Set(["repository", "commit", "path", "dirty", "entry", "export", "files", "requires"]);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const isRef = (v: unknown): v is PartRef =>
  !!v && typeof v === "object" && typeof (v as PartRef).partId === "string" && Number.isInteger((v as PartRef).revision) && (v as PartRef).revision >= 1;

/**
 * The shape of the ModuleDef fields this service reads (search facets,
 * referenced files, children). Anything else in the definition is UHD's to
 * define and is carried as sent.
 */
function definitionShape(def: Record<string, unknown>): Problem[] {
  const out: Problem[] = [];
  const add = (at: string, message: string) => out.push({ code: "DEFINITION_INVALID", message, at: `definition.${at}` });
  const optString = (v: unknown) => v === undefined || typeof v === "string";
  const optArray = (v: unknown, at: string): unknown[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v;
    add(at, `${at} must be an array`);
    return [];
  };
  for (const k of ["description", "version", "manufacturer", "part_number"]) if (!optString(def[k])) add(k, `${k} must be a string`);
  for (const k of ["tags", "categories"]) optArray(def[k], k).forEach((v, i) => typeof v !== "string" && add(`${k}[${i}]`, "must be a string"));
  (def.interfaces as unknown[]).forEach((itf, i) => {
    if (!isObject(itf) || typeof itf.id !== "string" || typeof itf.domain !== "string") return add(`interfaces[${i}]`, "interface needs id and domain");
    optArray(itf.protocols, `interfaces[${i}].protocols`).forEach((p, j) => (!isObject(p) || typeof p.type !== "string") && add(`interfaces[${i}].protocols[${j}]`, "protocol needs a type"));
  });
  optArray(def.domains, "domains").forEach((d, i) => (!isObject(d) || typeof d.domain !== "string") && add(`domains[${i}]`, "needs a domain"));
  optArray(def.children, "children").forEach((c, i) => (!isObject(c) || typeof c.moduleDefId !== "string") && add(`children[${i}]`, "child needs a moduleDefId"));
  const artifacts = (list: unknown, at: string) =>
    optArray(list, at).forEach((a, i) => (!isObject(a) || typeof a.id !== "string" || !optString(a.filePath)) && add(`${at}[${i}]`, "artifact needs an id; filePath is a string"));
  artifacts(def.artifacts, "artifacts");
  optArray(def.harnesses, "harnesses").forEach((h, i) => (isObject(h) ? artifacts(h.artifacts, `harnesses[${i}].artifacts`) : add(`harnesses[${i}]`, "harness must be an object")));
  return out;
}

/**
 * Structural checks on a draft: everything that can be judged from the
 * draft alone. The server adds the checks that need its store (dependencies
 * and derivations exist, blobs present, revision order).
 */
export function validateDraft(draft: PartRevisionDraft, range: UhdSchemaRange = SUPPORTED_UHD_SCHEMA): Problem[] {
  const out: Problem[] = [];
  const add = (code: string, message: string, at?: string) => out.push({ code, message, ...(at ? { at } : {}) });
  if (!draft || typeof draft !== "object") return [{ code: "ENVELOPE_INVALID", message: "body is not an object" }];
  for (const k of Object.keys(draft)) if (!DRAFT_FIELDS.has(k)) add("FIELD_UNKNOWN", `${k} is not a ${PART_REVISION_SCHEMA} field`, k);
  if (!(ENVELOPE_SCHEMAS as readonly string[]).includes(draft.schema)) add("ENVELOPE_SCHEMA", `schema must be ${ENVELOPE_SCHEMAS.map((x) => `"${x}"`).join(" or ")}`, "schema");
  if (typeof draft.uhdSchema !== "string" || !SEMVER.test(draft.uhdSchema)) add("UHD_SCHEMA_INVALID", "uhdSchema must be a version such as 0.2.0", "uhdSchema");
  else if (!uhdSchemaSupported(draft.uhdSchema, range))
    add("UHD_SCHEMA_UNSUPPORTED", `uhdSchema ${draft.uhdSchema} is outside the supported range >=${range.min} <${range.below}`, "uhdSchema");
  if (typeof draft.partId !== "string" || !PART_ID.test(draft.partId)) add("PART_ID_INVALID", "partId must be lower-case letters, digits, '.', '_' or '-'", "partId");
  if (!Number.isInteger(draft.revision) || draft.revision < 1) add("REVISION_INVALID", "revision must be an integer >= 1", "revision");
  const def = draft.definition;
  if (!isObject(def) || typeof def.id !== "string" || typeof def.name !== "string" || !Array.isArray(def.interfaces)) {
    add("DEFINITION_INVALID", "definition must be a UHD ModuleDef (id, name, interfaces[])", "definition");
    return out;
  }
  const shape = definitionShape(def);
  if (shape.length) return [...out, ...shape];
  if (def.id !== draft.partId) add("DEFINITION_ID", `definition.id "${def.id}" differs from partId "${draft.partId}"`, "definition.id");
  if (draft.definitionDigest !== definitionDigest(def)) add("DEFINITION_DIGEST", "definitionDigest does not match the definition", "definitionDigest");

  // dependencies: exactly the definitions it references, once each
  if (!Array.isArray(draft.dependencies)) add("DEPENDENCIES_INVALID", "dependencies must be an array", "dependencies");
  else {
    const ids = draft.dependencies.map((d) => d?.partId);
    draft.dependencies.forEach((d, i) => {
      if (!isRef(d)) add("DEPENDENCY_INVALID", "dependency must be { partId, revision >= 1 }", `dependencies[${i}]`);
      else if (d.partId === draft.partId) add("DEPENDENCY_SELF", "a part cannot depend on itself", `dependencies[${i}]`);
    });
    if (new Set(ids).size !== ids.length) add("DEPENDENCY_DUPLICATE", "each dependency appears once", "dependencies");
    const want = referencedDefinitions(def);
    const missing = want.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => typeof id === "string" && !want.includes(id));
    if (missing.length) add("DEPENDENCY_MISSING", `children reference ${missing.join(", ")} with no pinned revision`, "dependencies");
    if (extra.length) add("DEPENDENCY_UNUSED", `${extra.join(", ")} not referenced by the definition`, "dependencies");
  }

  // files
  const paths = new Set<string>();
  const checkFile = (f: { path?: string; sha256?: string; size?: number; mediaType?: string }, at: string) => {
    if (typeof f.path !== "string" || !isSafePath(f.path)) add("PATH_INVALID", "path must be relative and normalised", `${at}.path`);
    else if (paths.has(f.path)) add("PATH_DUPLICATE", `${f.path} listed twice`, `${at}.path`);
    else paths.add(f.path);
    if (typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) add("SHA256_INVALID", "sha256 must be 64 lower-case hex digits", `${at}.sha256`);
    if (!Number.isInteger(f.size) || (f.size as number) < 0) add("SIZE_INVALID", "size must be a non-negative integer", `${at}.size`);
    if (typeof f.mediaType !== "string" || f.mediaType === "") add("MEDIA_TYPE_INVALID", "mediaType is required", `${at}.mediaType`);
  };
  if (!Array.isArray(draft.artifacts)) add("ARTIFACTS_INVALID", "artifacts must be an array", "artifacts");
  else
    draft.artifacts.forEach((a, i) => {
      if (!isObject(a)) return add("ARTIFACT_INVALID", "artifact must be an object", `artifacts[${i}]`);
      checkFile(a, `artifacts[${i}]`);
      if (!ARTIFACT_ROLES.includes(a.role)) add("ROLE_INVALID", `role must be one of ${ARTIFACT_ROLES.join(", ")}`, `artifacts[${i}].role`);
    });
  if (!Array.isArray(draft.evidence)) add("EVIDENCE_INVALID", "evidence must be an array", "evidence");
  else
    draft.evidence.forEach((e, i) => {
      if (!isObject(e)) return add("EVIDENCE_INVALID", "evidence entry must be an object", `evidence[${i}]`);
      if (!EVIDENCE_KINDS.includes(e.kind)) add("EVIDENCE_KIND", `kind must be one of ${EVIDENCE_KINDS.join(", ")}`, `evidence[${i}].kind`);
      if (e.path !== undefined) checkFile(e, `evidence[${i}]`);
      else if (typeof e.url !== "string" || !/^https?:\/\//.test(e.url)) add("EVIDENCE_REF", "evidence needs a file (path, sha256, size, mediaType) or an http(s) url", `evidence[${i}]`);
    });
  if (!Array.isArray(draft.missingArtifacts)) add("MISSING_ARTIFACTS_INVALID", "missingArtifacts must be an array", "missingArtifacts");
  // terms (protocol § 4.5): optional on every carried file
  const termed: [unknown, string][] = [
    ...(Array.isArray(draft.artifacts) ? draft.artifacts.map((a, i) => [isObject(a) ? a.terms : undefined, `artifacts[${i}].terms`] as [unknown, string]) : []),
    ...(Array.isArray(draft.evidence) ? draft.evidence.map((e, i) => [isObject(e) ? e.terms : undefined, `evidence[${i}].terms`] as [unknown, string]) : []),
  ];
  for (const [terms, at] of termed) if (terms !== undefined) out.push(...termsProblems(terms, at, paths));
  if (Array.isArray(draft.evidence)) draft.evidence.forEach((e, i) => isObject(e) && e.terms !== undefined && e.path === undefined && add("TERMS_INVALID", "terms belong to a carried file, not a url", `evidence[${i}].terms`));

  // every file the definition references is carried or declared missing
  if (Array.isArray(draft.artifacts) && Array.isArray(draft.missingArtifacts)) {
    const carried = new Set(draft.artifacts.map((a) => a?.path));
    const declared = new Set(draft.missingArtifacts.map((m) => m?.path));
    for (const { path, artifact } of referencedFiles(def)) {
      if (!carried.has(path) && !declared.has(path)) add("ARTIFACT_UNACCOUNTED", `artifact ${artifact.id} references ${path}, which is neither carried nor listed in missingArtifacts`, "artifacts");
    }
    draft.missingArtifacts.forEach((m, i) => {
      if (!m || typeof m.path !== "string" || typeof m.reason !== "string" || m.reason === "") add("MISSING_ARTIFACT_INVALID", "missing artifact needs path and reason", `missingArtifacts[${i}]`);
      else if (carried.has(m.path)) add("MISSING_ARTIFACT_CARRIED", `${m.path} is carried and listed missing`, `missingArtifacts[${i}]`);
    });
  }

  if (draft.source !== undefined) {
    const src = draft.source as unknown;
    const ok =
      isObject(src) &&
      typeof src.repository === "string" &&
      (src.commit === undefined || typeof src.commit === "string") &&
      (src.path === undefined || typeof src.path === "string") &&
      (src.dirty === undefined || typeof src.dirty === "boolean") &&
      Object.keys(src).every((k) => SOURCE_FIELDS.has(k));
    if (!ok) add("SOURCE_INVALID", "source must be { repository, commit?, path?, dirty?, entry?, export?, files?, requires? }", "source");
    else out.push(...sourceRecordProblems(draft));
  }

  if (draft.derivedFrom !== null && !isRef(draft.derivedFrom)) add("DERIVED_FROM_INVALID", "derivedFrom must be { partId, revision } or null", "derivedFrom");
  else if (draft.derivedFrom && draft.derivedFrom.partId === draft.partId && draft.derivedFrom.revision >= draft.revision)
    add("DERIVED_FROM_ORDER", "a revision derives from an earlier revision of its part", "derivedFrom");
  else if (Number.isInteger(draft.revision) && draft.revision > 1 && !draft.derivedFrom)
    add("DERIVED_FROM_REQUIRED", "a revision after the first names the revision it was derived from", "derivedFrom");

  if (typeof draft.digest !== "string" || !DIGEST.test(draft.digest)) add("DIGEST_INVALID", "digest must be sha256:<hex>", "digest");
  else if (out.length === 0 && draft.digest !== envelopeDigest(draft)) add("DIGEST_MISMATCH", `digest does not match the content (expected ${envelopeDigest(draft)})`, "digest");
  return out;
}

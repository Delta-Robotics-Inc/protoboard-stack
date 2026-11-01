/**
 * A package's input from a part of a Protoboard project (PB-1195), with no
 * network and no sign-in. Nothing is written into the project.
 *
 * - A project part (`parts/local/`, or any definition the project's own
 *   sources declare): the envelope `parts publish` would send, built by the
 *   same function (`localPartDraft`, parts.ts). Publish asks the library for
 *   the next revision number; offline, the revision is DEFAULT the one after
 *   the project's last publish (`parts/origins.json` `published`), else 1.
 *   Children are pinned at the catalog revisions the project vendored, as
 *   publish pins them; a child that is not a catalog part is an error unless
 *   `allowUnpinned` (then the envelope lists no revision for it, and readers
 *   report DEPENDENCY_MISSING as a warning).
 * - A catalog part (`parts add`): the service's envelope is not kept in the
 *   project (only its digest, in parts/origins.json), so an equivalent one is
 *   rebuilt from the vendored definition (its bytes are the pinned
 *   `definitionDigest`) and the vendored files (their pinned sha256), with
 *   the same fields. DEFAULT choices, since the project does not record them:
 *   roles from the definition's artifacts (else "attachment"), media types
 *   from the file extension, no licence terms, `derivedFrom` null, no
 *   definition source. Its digest is therefore not the pinned envelope
 *   digest, which the manifest's `provenance` keeps.
 *
 * `exclude`: envelope paths left out of the package, recorded in the
 * envelope's own `missingArtifacts` (an existing field) with the reason, and
 * the envelope resealed. For a file over the caps (a 148 MB STEP).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import {
  ARTIFACT_ROLES,
  referencedDefinitions,
  sealDraft,
  sha256Hex,
  type ArtifactRole,
  type EnvelopeArtifact,
  type EvidenceKind,
  type EvidenceRef,
  type MissingArtifact,
  type PartRef,
  type PartRevisionDraft,
  type UhdModuleDef,
} from "@protoboardai/cloud/client";
import { UhdpkgError, type FileSource, type PackageInput } from "./write.js";

export interface ProjectPartOptions {
  /** Envelope paths to leave out (recorded in missingArtifacts). */
  exclude?: string[];
  /** Package a part whose children are not catalog parts. */
  allowUnpinned?: boolean;
}

/** The media type of a file, by extension: the table `parts publish` uses (parts.ts MEDIA_TYPES). */
const MEDIA_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".step": "model/step",
  ".stp": "model/step",
  ".stl": "model/stl",
  ".3mf": "model/3mf",
  ".obj": "model/obj",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".py": "text/x-python",
  ".ts": "text/typescript",
  ".kcl": "text/plain",
  ".dxf": "image/vnd.dxf",
  ".zip": "application/zip",
};
const mediaTypeFor = (path: string) => MEDIA_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

const EXCLUDED_REASON = "left out of this package (uhdpkg --exclude)";

/** Move excluded paths from artifacts and evidence to missingArtifacts, and reseal. */
function applyExclude(draft: PartRevisionDraft, exclude: string[]): PartRevisionDraft {
  if (!exclude.length) return draft;
  const want = new Set(exclude);
  const known = new Set([...draft.artifacts.map((a) => a.path), ...draft.evidence.flatMap((e) => (e.path ? [e.path] : []))]);
  const unknown = exclude.filter((p) => !known.has(p));
  if (unknown.length) throw new UhdpkgError("EXCLUDE_UNKNOWN", `--exclude names ${unknown.join(", ")}, which the envelope does not carry (carried: ${[...known].join(", ")})`);
  const missing: MissingArtifact[] = [
    ...draft.missingArtifacts,
    ...draft.artifacts.filter((a) => want.has(a.path)).map((a) => ({ path: a.path, artifactId: a.artifactId ?? a.path, reason: EXCLUDED_REASON })),
  ];
  // evidence has no "missing" list: an excluded evidence file becomes a reference without a file, which the envelope cannot express; refuse
  const ev = draft.evidence.filter((e) => e.path && want.has(e.path));
  if (ev.length) throw new UhdpkgError("EXCLUDE_EVIDENCE", `${ev.map((e) => e.path).join(", ")} is evidence; evidence files cannot be left out of an envelope`);
  const { digest: _d, definitionDigest: _dd, ...rest } = draft;
  return sealDraft({
    ...rest,
    artifacts: draft.artifacts.filter((a) => !want.has(a.path)),
    missingArtifacts: missing.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}

/** The package input for part `id` of the project at `root`. */
export async function inputFromProjectPart(root: string, id: string, options: ProjectPartOptions = {}): Promise<PackageInput & { kind: "local-part" | "catalog-vendored" }> {
  // loaded lazily: the zip and verify code paths never pull in the project loader
  const { loadProject } = await import("../project.js");
  const { readOrigins } = await import("../load.js");
  const p = await loadProject(root, { checks: false, extensions: false });
  const rec = p.definitions.get(id);
  if (!rec) throw new UhdpkgError("PART_NOT_FOUND", `${id} is not a part of the project at ${p.root}`);
  const origins = readOrigins(p.root, p.config.catalog);
  const exclude = options.exclude ?? [];

  if (rec.origin.kind === "local") {
    const { localPartDraft } = await import("../parts.js");
    const dependencies: PartRef[] = [];
    for (const child of referencedDefinitions(rec.def as unknown as UhdModuleDef)) {
      const o = origins.definitions[child];
      if (o && typeof o.revision === "number" && (o.provider === "protoboard-cloud" || o.provider === "uhd-library")) dependencies.push({ partId: o.partId ?? child, revision: o.revision });
      else if (!options.allowUnpinned)
        throw new UhdpkgError("DEPENDENCY_UNPINNED", `${id} contains ${child}, which is not a catalog part; an envelope pins its children at catalog revisions (use --allow-unpinned to package it anyway)`);
    }
    const published = origins.published?.[id];
    // DEFAULT: offline, the next revision after the project's last publish
    const revision = published ? published.revision + 1 : 1;
    const derivedFrom = published ? { partId: id, revision: published.revision } : null;
    const { draft, files } = localPartDraft(p, id, revision, derivedFrom, dependencies);
    const sealed = applyExclude(draft, exclude);
    const byPath = new Map<string, FileSource>();
    const all = [...sealed.artifacts, ...sealed.evidence.filter((e): e is EvidenceRef & { path: string; sha256: string } => !!e.path && !!e.sha256)];
    for (const f of all) byPath.set(f.path, files.get(f.sha256)!);
    return { kind: "local-part", envelope: sealed, files: byPath, provenance: { kind: "local-part", note: `built offline as \`parts publish\` would send it (revision ${revision})` } };
  }

  const o = origins.definitions[id];
  if (!o || o.artifactBase?.kind !== "vendored" || typeof o.revision !== "number") throw new UhdpkgError("PART_NOT_PACKAGEABLE", `${id} is neither a project part nor a catalog part vendored by \`parts add\``);
  const defBytes = readFileSync(join(p.root, ...o.file.split("/")));
  if (`sha256:${sha256Hex(defBytes)}` !== o.digest) throw new UhdpkgError("VENDORED_CHANGED", `${o.file} no longer matches its pinned digest; run \`protoboard check\``);
  const definition = JSON.parse(defBytes.toString("utf8")) as UhdModuleDef;
  const base = o.artifactBase;
  const strip = base.strip;
  const referenced = new Map<string, { id: string; role?: string }>();
  for (const a of [...(definition.artifacts ?? []), ...(definition.harnesses ?? []).flatMap((h) => h.artifacts ?? [])]) if (a.filePath) referenced.set(a.filePath, { id: a.id, role: a.role });
  // DEFAULT: the library path of a vendored file: the stripped prefix put back when the definition names it so, or when the stored path does not start with the library's own top folder
  const libraryPath = (stored: string): string => {
    if (!strip) return stored;
    if (referenced.has(strip + stored)) return strip + stored;
    if (referenced.has(stored)) return stored;
    return stored.startsWith(strip.split("/")[0] + "/") ? stored : strip + stored;
  };
  const evidenceStored = new Map((o.evidence ?? []).map((e) => [e.path, e.kind]));
  const artifacts: EnvelopeArtifact[] = [];
  const evidence: EvidenceRef[] = [];
  const files = new Map<string, FileSource>();
  for (const [stored, digest] of Object.entries(o.files ?? {})) {
    const file = join(p.root, ...base.dir.split("/"), ...stored.split("/"));
    if (!existsSync(file)) throw new UhdpkgError("VENDORED_MISSING", `${base.dir}/${stored} is pinned but not on disk`);
    const path = libraryPath(stored);
    const sha = digest.replace(/^sha256:/, "");
    // the size from disk; the bytes are re-hashed against the pin when packed
    const size = statSync(file).size;
    const kind = evidenceStored.get(stored);
    if (kind) evidence.push({ kind: kind as EvidenceKind, path, sha256: sha, size, mediaType: mediaTypeFor(path) });
    else {
      const ref = referenced.get(path);
      const role = ref?.role && (ARTIFACT_ROLES as readonly string[]).includes(ref.role) ? (ref.role as ArtifactRole) : "attachment";
      artifacts.push({ path, sha256: sha, size, mediaType: mediaTypeFor(path), role, ...(ref ? { artifactId: ref.id } : {}) });
    }
    files.set(path, file);
  }
  const cmp = (a: { path?: string }, b: { path?: string }) => ((a.path ?? "") < (b.path ?? "") ? -1 : (a.path ?? "") > (b.path ?? "") ? 1 : 0);
  const draft = sealDraft({
    // the schema id the stack publishes under today (packages/cloud PART_REVISION_SCHEMA)
    schema: "protoboard.part-revision/v1",
    uhdSchema: o.uhdSchema ?? "0.2.0",
    partId: o.partId ?? id,
    revision: o.revision,
    definition,
    dependencies: [...(o.dependencies ?? [])].sort((a, b) => (a.partId < b.partId ? -1 : 1)),
    artifacts: artifacts.sort(cmp),
    missingArtifacts: (o.missingArtifacts ?? []).map((m) => ({ path: libraryPath(m.path), artifactId: m.artifactId ?? m.path, reason: m.reason })).sort(cmp),
    evidence: evidence.sort(cmp),
    derivedFrom: null,
  });
  const sealed = applyExclude(draft, exclude);
  for (const x of exclude) files.delete(x);
  return {
    kind: "catalog-vendored",
    envelope: sealed,
    files,
    provenance: {
      kind: "catalog-vendored",
      ...(o.envelopeDigest ? { pinnedEnvelopeDigest: o.envelopeDigest } : {}),
      note: `rebuilt from the files ${o.library ?? o.provider} revision ${o.revision} vendored into the project; roles from the definition, media types from extensions, no licence terms, derivedFrom unknown`,
    },
  };
}

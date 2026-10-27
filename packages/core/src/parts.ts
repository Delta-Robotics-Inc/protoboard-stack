/**
 * Parts from the project's libraries (docs/specs/tool-integrations.md §6,
 * docs/specs/vscode-extension.md §4.2): `protoboard parts search|add|update|publish`.
 * Every library speaks the UHD library protocol (`uhd-library/v1`); the
 * Protoboard Cloud parts service is the default one (libraries.ts).
 *
 * - `search` asks every library and merges the results, each with the
 *   library it comes from.
 * - A part comes from the first library that has its id, unless `--library`
 *   names one or parts/origins.json already pins it to one.
 *
 * - `add` vendors an exact revision and its transitive closure: each
 *   definition as `parts/catalog/<id>.json` (the bytes the envelope's
 *   `definitionDigest` names, so the digest pin `check` verifies is unchanged)
 *   and its files under `parts/catalog/<id>/`, the definition's artifact base.
 *   Everything is verified before anything is written, and `parts/origins.json`
 *   records the service, part, revision, envelope digest and every file digest.
 *   By default it also vendors the revision's definition source (PB-910,
 *   UHD library protocol § 4.6) into the same folder: `<id>.uhd.ts` and the
 *   library modules it imports, after UHD's lint (imports only
 *   `@deltarobotics/uhd` and the closure; no fs, network, process, eval or
 *   dynamic import) and a confined evaluation (a child process that reads only
 *   the closure and UHD) that must give the pinned definition
 *   digest. Source that fails either is not vendored (the part comes
 *   compiled, and the result says why); `--compiled` vendors JSON only.
 * - `update` reports the recommended revision and re-pins only when asked.
 * - `publish` promotes a project-researched part (`parts/local/`) to the
 *   catalog as its next revision.
 * - `offers` vendors the service's supplier offers for catalog parts into
 *   `parts/offers.json`, so a release can quote them offline.
 * - `usage` is the library owners' view of what is added most (publishers).
 *
 * Only these commands talk to the service. Loading, checking and building read
 * the vendored files and never import this module's client.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import {
  ARTIFACT_ROLES,
  CloudError,
  PART_REVISION_SCHEMA,
  hasSourceFiles,
  isSafePath,
  referencedDefinitions,
  referencedFiles,
  sameContent,
  sealDraft,
  sha256Hex,
  uhdSchemaVersion,
  validateDraft,
  vendoredDefinition,
  type ArtifactRole,
  type EnvelopeArtifact,
  type EvidenceKind,
  type FileTerms,
  type EvidenceRef,
  type MissingArtifact,
  type PartRef,
  type PartRevisionDraft,
  type PartRevisionEnvelope,
  type PartSummary,
  type PublicOffer,
  type RevisionRow,
  type SearchQuery,
  type UhdModuleDef,
  type UsageReport,
} from "@protoboardai/cloud/client";
import { uhdVersion } from "./build.js";
import { LOCAL_PARTS_DIR, ORIGINS_SCHEMA, originsPath, readOrigins, revisionLabel, sha256, type OriginRecord, type OriginsFile } from "./load.js";
import { evaluateSources, lintVendoredSource, projectToolchain, uhdRunsSource, type VendoredSource } from "./source.js";
import { satisfiesRange } from "@deltarobotics/uhd/library";
import type { Project } from "./project.js";
import type { ProtoboardConfig } from "./types.js";
import { CLOUD_PROVIDER, DEFAULT_LIBRARY_ID, LIBRARY_PROVIDER, cloudUrl, configuredLibraries, connectLibrary, recordLibrary, type LibraryConnection } from "./libraries.js";
import { PartsError, explainCloudError, type AccountTokens } from "./library-client.js";
import { projectRelative } from "./paths.js";
import { migrateRecord, recordLayout, stripPrefixFor, storedPath, vendoredDirName, type MigrateResult } from "./vendored-layout.js";

export { PartsError, explainCloudError };

/** A client for one library; `connectCloud` gives the Protoboard library's. */
export type CloudConnection = LibraryConnection;

/**
 * A client for the project's Protoboard library (its parts service): the
 * `protoboard` entry of `libraries`, or the default. The publish token is
 * PROTOBOARD_CLOUD_TOKEN, else the signed-in user's (`accountTokens`).
 */
export function connectCloud(config?: ProtoboardConfig, options: { url?: string; fetch?: typeof fetch; env?: NodeJS.ProcessEnv; accountTokens?: AccountTokens } = {}): CloudConnection {
  const env = options.env ?? process.env;
  const lib = configuredLibraries(config, { ...options, env }).find((l) => l.id === DEFAULT_LIBRARY_ID) ?? { id: DEFAULT_LIBRARY_ID, url: cloudUrl(config, options.url, env) };
  return connectLibrary(lib, { env, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.accountTokens ? { accountTokens: options.accountTokens } : {}) });
}

// ---------------------------------------------------------------- search

export async function searchParts(cloud: CloudConnection, query: SearchQuery): Promise<{ total: number; parts: PartSummary[]; nextCursor?: string | null }> {
  try {
    return await cloud.client.search(query);
  } catch (e) {
    throw explainCloudError(e, cloud);
  }
}

export { LIBRARY_SORTS, isLibrarySort, partPrices, pricesBySource, searchLibraries, type LibrariesQuery, type LibrariesSearch, type LibraryHit, type LibrarySort, type PartPrice, type PartPrices, type PriceSource } from "./library-client.js";

// ---------------------------------------------------------------- add / update

export type AddStatus =
  /** Newly vendored. */
  | "added"
  /** Already vendored at this revision, every file intact. */
  | "unchanged"
  /** Already pinned at this revision; missing or altered files were downloaded again. */
  | "restored"
  /** Vendored before the parts service with identical definition bytes; now pinned to the service revision. */
  | "migrated"
  /** Re-pinned to another revision (`parts update --to`). */
  | "updated"
  /** Refused: pinned at another revision or content, or defined locally. Nothing in its closure was written. */
  | "conflict";

export interface AddResult {
  id: string;
  /** The library it was vendored from. */
  library?: string;
  revision?: number;
  status: AddStatus;
  /** The part this one was vendored for, when it is a dependency in the closure. */
  requiredBy?: string;
  file?: string;
  digest?: string;
  /** Files written (artifacts and evidence). */
  files?: number;
  message?: string;
}

/** Parse "<id>" or "<id>@<revision>". */
export function parsePartRef(s: string): { partId: string; revision?: number } {
  const m = /^([^@\s]+)(?:@([1-9]\d*))?$/.exec(s);
  if (!m) throw new PartsError("BAD_REF", `expected <part-id> or <part-id>@<revision>, got "${s}"`);
  return { partId: m[1], ...(m[2] ? { revision: Number(m[2]) } : {}) };
}

const catalogRel = (p: Project) => p.config.catalog ?? "parts/catalog";

const writeOrigins = (p: Project, origins: OriginsFile) => {
  const sort = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const out: OriginsFile = { schema: ORIGINS_SCHEMA, definitions: sort(origins.definitions), ...(origins.published && Object.keys(origins.published).length ? { published: sort(origins.published) } : {}) };
  const file = originsPath(p.root, p.config.catalog);
  const text = JSON.stringify(out, null, 2) + "\n";
  if (existsSync(file) ? readFileSync(file, "utf8") === text : !Object.keys(out.definitions).length && !out.published) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** Every vendored byte of a record still matches its digests. */
function vendoredIntact(root: string, rec: OriginRecord): boolean {
  const def = join(root, rec.file);
  if (!existsSync(def) || sha256(readFileSync(def)) !== rec.digest) return false;
  if (rec.artifactBase?.kind !== "vendored") return true;
  const dir = rec.artifactBase.dir;
  return Object.entries(rec.files ?? {}).every(([path, digest]) => {
    const f = join(root, dir, path);
    return existsSync(f) && sha256(readFileSync(f)) === digest;
  });
}

/** A record of a revision vendored from a library (Protoboard's or another uhd-library/v1 one). */
const isCloudRecord = (rec: OriginRecord | undefined): rec is OriginRecord & { revision: number } =>
  (rec?.provider === CLOUD_PROVIDER || rec?.provider === LIBRARY_PROVIDER) && typeof rec.revision === "number";

const previousOf = (rec: OriginRecord): NonNullable<OriginRecord["previous"]> => ({
  provider: rec.provider,
  ...(recordLibrary(rec) && isCloudRecord(rec) ? { library: recordLibrary(rec) } : {}),
  ...(rec.revision !== undefined ? { revision: rec.revision } : {}),
  ...(rec.version ? { version: rec.version } : {}),
  digest: rec.digest,
  ...(rec.envelopeDigest ? { envelopeDigest: rec.envelopeDigest } : {}),
  retrievedAt: rec.retrievedAt,
});

/** Every vendored source file of a record still matches its digest. */
function sourceIntact(root: string, rec: OriginRecord): boolean {
  if (!rec.source || rec.artifactBase?.kind !== "vendored") return true;
  const dir = rec.artifactBase.dir;
  return Object.entries(rec.source.files).every(([path, digest]) => {
    const f = join(root, dir, ...path.split("/"));
    return existsSync(f) && sha256(readFileSync(f)) === digest;
  });
}

/**
 * `sourceOnly`: the pin and its files stay as they are; only the definition
 * source is vendored (or, `--compiled`, removed).
 */
type Plan = { env: PartRevisionEnvelope; status: AddStatus; message?: string; sourceOnly?: boolean };

/** What vendoring does with a revision's definition source. */
interface SourceOutcome {
  /** The record to keep in parts/origins.json, when the source is vendored. */
  record?: VendoredSource;
  /** Files to write under the artifact base: path → bytes. */
  files?: Map<string, Uint8Array>;
  /** Why the source was not vendored, or what to know about it. */
  note?: string;
}

/**
 * Download a revision's definition source, lint it, and evaluate it
 * confined (in a child process that reads only the closure and UHD, never
 * in this one), all before a byte is written: it is laid out under `dir`
 * only when it gives the definition digest the envelope pins.
 */
async function vendorSource(p: Project, cloud: CloudConnection, env: PartRevisionEnvelope, dir: string): Promise<SourceOutcome> {
  const src = env.source!;
  const files = await cloud.client.downloadSource(env);
  const lint = lintVendoredSource(files, src.entry!);
  if (lint.length)
    return { note: `its definition source was refused (${lint.slice(0, 2).map((x) => `${x.path ?? ""}${x.line ? `:${x.line}` : ""} ${x.message}`).join("; ")}${lint.length > 2 ? `; ${lint.length - 2} more` : ""}): library source may only import @deltarobotics/uhd and its own files; vendored compiled` };
  const record: VendoredSource = { entry: src.entry!, export: src.export!, requires: { uhd: src.requires!.uhd, typescript: src.requires!.typescript }, files: Object.fromEntries(src.files!.map((f) => [f.path, `sha256:${f.sha256}`])) };
  const toolchain = projectToolchain(p.root);
  const r = (await evaluateSources(p.root, [{ key: env.partId, files, entry: record.entry, export: record.export }])).get(env.partId)!;
  const uhdOk = !toolchain.uhd || uhdRunsSource(toolchain.uhd.version, record.requires.uhd);
  if ("error" in r || r.digest !== env.definitionDigest) {
    const why = "error" in r ? `does not evaluate here (${r.error})` : `evaluates here to ${r.digest.slice(0, 19)}…, not the pinned ${env.definitionDigest.slice(0, 19)}…`;
    return { note: `its definition source ${why}${uhdOk ? "" : `; it needs @deltarobotics/uhd ${record.requires.uhd} and the project has ${toolchain.uhd!.version}`}; vendored compiled` };
  }
  const bytes = new Map(files.map((f) => [f.path, new TextEncoder().encode(f.text)]));
  for (const [path, b] of bytes) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, b);
  }
  const tsNote = toolchain.typescript && !satisfiesRange(toolchain.typescript.version, record.requires.typescript) ? `; its source is written for TypeScript ${record.requires.typescript} (the project has ${toolchain.typescript.version})` : "";
  return { record, files: bytes, ...(tsNote ? { note: tsNote.slice(2) } : {}) };
}

/**
 * Vendor one revision and its closure. `replace` (from `parts update --to`)
 * allows moving existing pins; otherwise a part pinned at another revision
 * is a conflict. All files are downloaded and verified into a staging folder
 * first, so a failure leaves the project as it was.
 */
async function vendorClosure(p: Project, origins: OriginsFile, cloud: CloudConnection, root: PartRef, options: { now: string; replace: boolean; compiled?: boolean }): Promise<AddResult[]> {
  const closure = await cloud.client.getClosure(root.partId, root.revision);
  const plans: Plan[] = closure.revisions.map((env): Plan => {
    const local = p.definitions.get(env.partId);
    if (local && local.origin.kind === "local") {
      return { env, status: "conflict", message: `defined locally in ${local.origin.source.file}; a catalog part cannot share its id (rename the local one, or remove it to use the catalog's)` };
    }
    const rec = origins.definitions[env.partId];
    if (!rec) return { env, status: "added" };
    // the same content is the same part, whichever library serves it
    if (isCloudRecord(rec) && rec.revision === env.revision && rec.envelopeDigest === env.digest) {
      if (!vendoredIntact(p.root, rec)) return { env, status: "restored" };
      // the same pin: only its definition source may need vendoring, restoring or (--compiled) removing
      const wanted = !options.compiled && hasSourceFiles(env);
      if (!wanted && rec.source) return { env, status: "restored", sourceOnly: true };
      if (wanted && (!rec.source || !sourceIntact(p.root, rec) || env.source!.files!.some((f) => rec.source!.files[f.path] !== `sha256:${f.sha256}`))) return { env, status: "restored", sourceOnly: true };
      return { env, status: "unchanged" };
    }
    const pinnedTo = recordLibrary(rec);
    if (isCloudRecord(rec) && pinnedTo !== cloud.id && !options.replace) {
      return {
        env,
        status: "conflict",
        message: `pinned to library ${pinnedTo} (revision ${rec.revision}); library ${cloud.id} has different content under this id. A project holds one definition per id: keep the pin, or move it deliberately with \`protoboard parts update ${env.partId} --to ${env.revision} --library ${cloud.id}\`.`,
      };
    }
    if (isCloudRecord(rec) && pinnedTo === cloud.id && rec.revision === env.revision) {
      return { env, status: "conflict", message: `the service now serves ${env.partId}@${env.revision} with envelope digest ${env.digest}, but ${rec.envelopeDigest} is pinned; revisions are immutable, so the pin is kept. Report this to the service operator.` };
    }
    if (!isCloudRecord(rec) && rec.digest === env.definitionDigest) return { env, status: "migrated", message: `same definition bytes as the ${rec.provider} copy; now pinned to the service revision` };
    if (options.replace) return { env, status: "updated", message: `${pinnedTo && pinnedTo !== cloud.id ? `${pinnedTo} ` : ""}${revisionLabel(rec.revision) ?? rec.version} → ${pinnedTo && pinnedTo !== cloud.id ? `${cloud.id} ` : ""}${env.revision}` };
    const pinned = isCloudRecord(rec) ? `pinned at revision ${rec.revision}` : `vendored from ${rec.provider} with different content`;
    return { env, status: "conflict", message: `${pinned}; this needs revision ${env.revision}. Updates are deliberate: \`protoboard parts update ${env.partId}\` shows the difference, \`--to ${env.revision}\` re-pins it.` };
  });
  const result = (pl: Plan): AddResult => ({
    id: pl.env.partId,
    library: cloud.id,
    revision: pl.env.revision,
    status: pl.status,
    ...(pl.env.partId !== root.partId ? { requiredBy: `${root.partId}@${root.revision}` } : {}),
    file: `${catalogRel(p)}/${pl.env.partId}.json`,
    digest: pl.env.definitionDigest,
    ...(pl.message ? { message: pl.message } : {}),
  });
  if (plans.some((pl) => pl.status === "conflict")) {
    // all or nothing: a closure that cannot be vendored whole is not vendored at all
    return plans.map((pl) => (pl.status === "conflict" ? result(pl) : { ...result(pl), status: "conflict" as const, message: `not written: ${plans.find((x) => x.status === "conflict")!.env.partId} conflicts` }));
  }

  const write = plans.filter((pl) => pl.status !== "unchanged");
  // each part's folder (src/vendored-layout.ts): the one its record has for a source-only change, else a short one no other part uses
  const catalog = catalogRel(p);
  const taken = new Set(Object.entries(origins.definitions).flatMap(([id, r]) => (r.artifactBase?.kind === "vendored" && !write.some((pl) => pl.env.partId === id && !pl.sourceOnly) ? [r.artifactBase.dir.split("/").pop()!] : [])));
  const layout = new Map<string, { dir: string; strip?: string }>();
  for (const pl of write) {
    const rec = origins.definitions[pl.env.partId];
    if (pl.sourceOnly && rec?.artifactBase?.kind === "vendored") {
      layout.set(pl.env.partId, { dir: rec.artifactBase.dir, ...(rec.artifactBase.strip ? { strip: rec.artifactBase.strip } : {}) });
      continue;
    }
    const name = vendoredDirName(pl.env.partId, taken);
    taken.add(name);
    const files = [...pl.env.artifacts.map((a) => a.path), ...pl.env.evidence.flatMap((e) => (e.path ? [e.path] : []))];
    const strip = stripPrefixFor(pl.env.partId, files, (pl.env.source?.files ?? []).map((f) => f.path));
    layout.set(pl.env.partId, { dir: `${catalog}/${name}`, ...(strip ? { strip } : {}) });
  }
  const stored = (id: string, path: string) => storedPath(path, layout.get(id)?.strip);
  const stagingRoot = join(p.root, ".protoboard", "cache");
  mkdirSync(stagingRoot, { recursive: true });
  const staging = mkdtempSync(join(stagingRoot, "parts-"));
  const fileCounts = new Map<string, number>();
  /** The paths each part was served: a library may withhold optional files whose terms do not allow giving them out. */
  const served = new Map<string, Set<string>>();
  const sources = new Map<string, SourceOutcome>();
  const notes = new Map<string, string>();
  try {
    for (const pl of write) {
      const wantSource = !options.compiled && hasSourceFiles(pl.env);
      if (pl.sourceOnly) {
        if (wantSource) sources.set(pl.env.partId, await vendorSource(p, cloud, pl.env, join(staging, pl.env.partId)));
        continue;
      }
      const bytes = vendoredDefinition(pl.env);
      if (sha256(bytes) !== pl.env.definitionDigest) throw new CloudError(0, "INTEGRITY", `${pl.env.partId}@${pl.env.revision}: vendored bytes do not match definitionDigest`);
      writeFileSync(join(staging, `${pl.env.partId}.json`), bytes);
      const raw = join(staging, `${pl.env.partId}.download`);
      const files = await cloud.client.downloadFiles(pl.env, raw, { evidence: true, skipWithheld: true });
      served.set(pl.env.partId, new Set(files.map((f) => f.path)));
      // laid out as this project keeps them: the library's folders down to the part's own left out
      for (const f of files) {
        const to = join(staging, pl.env.partId, ...stored(pl.env.partId, f.path).split("/"));
        mkdirSync(dirname(to), { recursive: true });
        renameSync(f.file, to);
      }
      rmSync(raw, { recursive: true, force: true });
      fileCounts.set(pl.env.partId, files.length);
      if (wantSource) sources.set(pl.env.partId, await vendorSource(p, cloud, pl.env, join(staging, pl.env.partId)));
    }
    // everything verified: move into place
    const catalogDir = join(p.root, catalogRel(p));
    mkdirSync(catalogDir, { recursive: true });
    for (const pl of write) {
      const { env } = pl;
      const place = layout.get(env.partId)!;
      const dir = join(p.root, ...place.dir.split("/"));
      const source = sources.get(env.partId);
      if (source?.note) notes.set(env.partId, source.note);
      if (pl.sourceOnly) {
        // the pin, its definition and files stay; only the source changes
        const rec = origins.definitions[env.partId];
        for (const path of Object.keys(rec.source?.files ?? {})) if (!source?.files?.has(path)) rmSync(join(dir, ...path.split("/")), { force: true });
        for (const [path, b] of source?.files ?? []) {
          mkdirSync(dirname(join(dir, ...path.split("/"))), { recursive: true });
          writeFileSync(join(dir, ...path.split("/")), b);
        }
        const { source: _old, ...rest } = rec;
        origins.definitions[env.partId] = { ...rest, ...(source?.record ? { source: source.record } : {}) };
        if (!notes.has(env.partId)) notes.set(env.partId, source?.record ? `vendored its definition source (${source.record.entry}${Object.keys(source.record.files).length > 1 ? ` and ${Object.keys(source.record.files).length - 1} module(s) it imports` : ""})` : "removed its definition source (--compiled)");
        continue;
      }
      rmSync(dir, { recursive: true, force: true });
      // the folder the part had before (the earlier layout, or another name) goes too
      const before = origins.definitions[env.partId]?.artifactBase;
      if (before?.kind === "vendored" && before.dir !== place.dir && isSafePath(before.dir)) rmSync(join(p.root, ...before.dir.split("/")), { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      if (existsSync(join(staging, env.partId))) renameSync(join(staging, env.partId), dir);
      renameSync(join(staging, `${env.partId}.json`), join(catalogDir, `${env.partId}.json`));
      const prev = origins.definitions[env.partId];
      // what was vendored: the files the library served (a withheld optional file is neither on disk nor recorded)
      const got = served.get(env.partId);
      const kept = (path: string) => !got || got.has(path);
      const carried = [...env.artifacts, ...env.evidence.filter((e): e is EvidenceRef & { path: string; sha256: string } => !!e.path && !!e.sha256)].filter((f) => kept(f.path));
      const withheld = got ? [...env.artifacts.map((a) => a.path), ...env.evidence.flatMap((e) => (e.path ? [e.path] : []))].filter((path) => !got.has(path)).length : 0;
      if (withheld) notes.set(env.partId, [notes.get(env.partId), `${withheld} optional file(s) withheld by the library: their terms do not allow redistribution`].filter(Boolean).join("; "));
      const rec: OriginRecord = {
        file: projectRelative(p.root, join(catalogDir, `${env.partId}.json`)),
        tier: "catalog",
        provider: cloud.id === DEFAULT_LIBRARY_ID ? CLOUD_PROVIDER : LIBRARY_PROVIDER,
        library: cloud.id,
        service: cloud.url,
        partId: env.partId,
        revision: env.revision,
        uhdSchema: env.uhdSchema,
        digest: env.definitionDigest,
        envelopeDigest: env.digest,
        retrievedAt: options.now,
        artifactBase: { kind: "vendored", dir: place.dir, ...(place.strip ? { strip: place.strip } : {}) },
        ...(env.dependencies.length ? { dependencies: env.dependencies } : {}),
        ...(carried.length ? { files: Object.fromEntries(carried.map((f) => [stored(env.partId, f.path), `sha256:${f.sha256}`]).sort(([a], [b]) => a.localeCompare(b))) } : {}),
        ...(env.evidence.some((e) => e.path && kept(e.path)) ? { evidence: env.evidence.filter((e) => e.path && kept(e.path)).map((e) => ({ kind: e.kind, path: stored(env.partId, e.path!) })) } : {}),
        ...(env.missingArtifacts.length ? { missingArtifacts: env.missingArtifacts.map((m) => ({ ...m, path: stored(env.partId, m.path) })) } : {}),
        ...(source?.record ? { source: source.record } : {}),
        // a restore keeps the record's history; a new pin keeps the one it replaces
        ...(prev && pl.status !== "restored" ? { previous: previousOf(prev) } : prev?.previous ? { previous: prev.previous } : {}),
      };
      origins.definitions[env.partId] = rec;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return plans.map((pl) => {
    const r = result(pl);
    const note = notes.get(pl.env.partId);
    const files = (fileCounts.get(pl.env.partId) ?? 0) + Object.keys(sources.get(pl.env.partId)?.record?.files ?? {}).length;
    return { ...r, ...(files ? { files } : {}), ...(note ? { message: r.message ? `${r.message}; ${note}` : note } : {}) };
  });
}

/** The revision a bare id means: the library's recommended revision. */
function recommendedOf(part: PartSummary): number {
  if (part.recommendedRevision === undefined) throw new PartsError("ALL_DEPRECATED", `${part.partId}: every revision is deprecated; name one explicitly (${part.partId}@${part.latestRevision})`);
  return part.recommendedRevision;
}

async function recommended(cloud: CloudConnection, partId: string): Promise<number> {
  return recommendedOf((await cloud.client.getPart(partId)).part);
}

const asList = (libs: CloudConnection | CloudConnection[]) => (Array.isArray(libs) ? libs : [libs]);

function libraryById(libs: CloudConnection[], id: string, why: string): CloudConnection {
  const lib = libs.find((l) => l.id === id);
  if (!lib) throw new PartsError("LIBRARY_UNKNOWN", `${why}: no library "${id}" in protoboard.config.ts (configured: ${libs.map((l) => l.id).join(", ") || "none"}; \`protoboard libraries\`)`);
  return lib;
}

/**
 * The library a part comes from: the one named (`--library`), else the one
 * parts/origins.json pins it to, else the first library that has the id. An
 * unreachable library before the one that has it is an error, not skipped:
 * it might hold a different part under the same id.
 */
async function chooseLibrary(libs: CloudConnection[], origins: OriginsFile, partId: string, named?: string): Promise<{ lib: CloudConnection; part?: PartSummary }> {
  if (named) return { lib: libraryById(libs, named, partId) };
  const rec = origins.definitions[partId];
  const pinned = rec && isCloudRecord(rec) ? recordLibrary(rec) : undefined;
  if (pinned) {
    const lib = libs.find((l) => l.id === pinned);
    if (!lib)
      throw new PartsError(
        "LIBRARY_NOT_CONFIGURED",
        `${partId} is pinned to library "${pinned}"${rec.service ? ` (${rec.service})` : ""}, which protoboard.config.ts does not list; add it back (\`protoboard libraries add ${pinned} ${rec.service ?? "<url>"}\`) or name another with --library`,
      );
    return { lib };
  }
  if (!libs.length) throw new PartsError("NO_LIBRARIES", "no libraries are configured (protoboard.config.ts `libraries`)");
  for (const lib of libs) {
    try {
      return { lib, part: (await lib.client.getPart(partId)).part };
    } catch (e) {
      if (e instanceof CloudError && e.code === "PART_NOT_FOUND" && libs.length > 1) continue;
      throw explainCloudError(e, lib, partId);
    }
  }
  throw new PartsError("PART_NOT_FOUND", `${partId}: not in any library (${libs.map((l) => `${l.id} at ${l.url}`).join(", ")}; \`protoboard parts search\` lists what they have)`);
}

/**
 * `parts add <id>[@revision]...`: vendor each revision (the recommended one
 * when none is named) with its closure, from the library that provides the
 * part (`chooseLibrary`). Re-adding a pinned part changes nothing; a part
 * pinned at another revision or in another library is a conflict, never an
 * update.
 */
export async function addParts(p: Project, refs: string[], libs: CloudConnection | CloudConnection[], options: { now?: string; library?: string; compiled?: boolean } = {}): Promise<AddResult[]> {
  const list = asList(libs);
  const origins = readOrigins(p.root, p.config.catalog);
  const now = options.now ?? new Date().toISOString();
  const out: AddResult[] = [];
  try {
    for (const s of refs) {
      const ref = parsePartRef(s);
      const { lib, part } = await chooseLibrary(list, origins, ref.partId, options.library);
      try {
        const revision = ref.revision ?? (part ? recommendedOf(part) : await recommended(lib, ref.partId));
        out.push(...(await vendorClosure(p, origins, lib, { partId: ref.partId, revision }, { now, replace: false, compiled: options.compiled })));
      } catch (e) {
        throw explainCloudError(e, lib, s);
      }
    }
  } finally {
    // whatever was vendored before a failure stays consistent with its record
    writeOrigins(p, origins);
  }
  return out;
}

/**
 * `parts migrate`: move every vendored part still in the layout of stack
 * 0.1.6 and earlier (`parts/catalog/<id>/library/parts/<id>/…`) to the short
 * one (src/vendored-layout.ts), and record the new paths in
 * parts/origins.json. Offline; no file changes its bytes, so every digest
 * pin stays.
 */
export function migrateParts(p: Project): MigrateResult[] {
  const origins = readOrigins(p.root, p.config.catalog);
  const catalog = catalogRel(p);
  const taken = new Set(Object.values(origins.definitions).flatMap((r) => (r.artifactBase?.kind === "vendored" ? [r.artifactBase.dir.split("/").pop()!] : [])));
  const out: MigrateResult[] = [];
  try {
    for (const id of Object.keys(origins.definitions).sort()) out.push(migrateRecord(p.root, id, origins.definitions[id], catalog, taken));
  } finally {
    // what moved is recorded, also when a later part could not be moved
    writeOrigins(p, origins);
  }
  return out;
}

/** The vendored parts still in the earlier layout (what `parts migrate` would move). */
export function partsToMigrate(root: string, catalog = "parts/catalog"): string[] {
  const origins = readOrigins(root, catalog);
  return Object.entries(origins.definitions)
    .filter(([id, rec]) => !recordLayout(id, rec, catalog).current)
    .map(([id]) => id)
    .sort();
}

export interface UpdateReport {
  id: string;
  /**
   * up-to-date: pinned at the recommended revision. update-available: the
   * recommended revision changes content. renumbered: it only renumbers the
   * pin. migratable: vendored before the parts service, with the same bytes
   * as the recommended revision. deprecated: no revision is recommended.
   */
  status: "up-to-date" | "update-available" | "renumbered" | "migratable" | "not-vendored" | "deprecated" | "library-missing";
  provider: string;
  /** The library asked: the one the part is pinned to. */
  library?: string;
  pinned?: string | number;
  recommended?: number;
  latest?: number;
  /** Whether the recommended revision says something different from the pin (`sameContent`), or only renumbers it. */
  contentChanged?: boolean;
  /** What differs, when it does. */
  changes?: string[];
  message: string;
}

const diffContent = (a: PartRevisionDraft, b: PartRevisionDraft): string[] => {
  const j = JSON.stringify;
  const out: string[] = [];
  if (a.definitionDigest !== b.definitionDigest) out.push("definition");
  if (a.uhdSchema !== b.uhdSchema) out.push(`UHD schema ${a.uhdSchema} → ${b.uhdSchema}`);
  if (j(a.dependencies) !== j(b.dependencies)) out.push(`dependencies ${a.dependencies.map((d) => `${d.partId}@${d.revision}`).join(", ") || "none"} → ${b.dependencies.map((d) => `${d.partId}@${d.revision}`).join(", ") || "none"}`);
  if (j(a.artifacts) !== j(b.artifacts)) out.push("artifact files");
  if (j(a.missingArtifacts) !== j(b.missingArtifacts)) out.push("files not carried");
  if (j(a.evidence) !== j(b.evidence)) out.push("evidence");
  return out;
};

/**
 * `parts update [<id>...]` without `--to`: what the service recommends for
 * each vendored part (all of them when no id is given), and whether it
 * differs in content or only in number. Writes nothing.
 */
export async function checkPartUpdates(p: Project, ids: string[], libs: CloudConnection | CloudConnection[]): Promise<UpdateReport[]> {
  const list = asList(libs);
  const origins = readOrigins(p.root, p.config.catalog);
  const out: UpdateReport[] = [];
  for (const id of ids.length ? ids : Object.keys(origins.definitions).sort()) {
    const rec = origins.definitions[id];
    if (!rec) {
      out.push({ id, status: "not-vendored", provider: "", message: `${id} is not vendored in this project; \`protoboard parts add ${id}\` adds it` });
      continue;
    }
    // a pinned part is asked of its own library; one vendored before libraries, of the Protoboard library
    const pinnedTo = isCloudRecord(rec) ? recordLibrary(rec) : undefined;
    const cloud = pinnedTo ? list.find((l) => l.id === pinnedTo) : (list.find((l) => l.id === DEFAULT_LIBRARY_ID) ?? list[0]);
    if (!cloud) {
      out.push({
        id,
        status: "library-missing",
        provider: rec.provider,
        ...(pinnedTo ? { library: pinnedTo } : {}),
        pinned: rec.revision,
        message: pinnedTo ? `pinned to library ${pinnedTo}${rec.service ? ` (${rec.service})` : ""}, which protoboard.config.ts does not list; the vendored copy stays as it is` : "no library is configured to ask",
      });
      continue;
    }
    try {
      const { part, revisions } = await cloud.client.getPart(rec.partId ?? id);
      const rec2 = part.recommendedRevision;
      const base = { id, provider: rec.provider, library: cloud.id, pinned: rec.revision, latest: part.latestRevision, ...(rec2 !== undefined ? { recommended: rec2 } : {}) };
      const pinnedRow: RevisionRow | undefined = isCloudRecord(rec) ? revisions.find((r) => r.revision === rec.revision) : undefined;
      if (rec2 === undefined) {
        out.push({ ...base, status: "deprecated", message: `every revision of ${id} is deprecated${part.deprecated ? ` (${part.deprecated.reason})` : ""}; the pin is kept` });
        continue;
      }
      if (isCloudRecord(rec) && rec.revision === rec2) {
        out.push({ ...base, status: "up-to-date", message: `pinned at ${rec2}, the recommended revision` });
        continue;
      }
      const target = await cloud.client.getRevision(part.partId, rec2);
      let changes: string[];
      if (isCloudRecord(rec)) {
        // the pinned envelope, verified against the digest this project recorded
        const pinned = await cloud.client.getRevision(part.partId, rec.revision, { digest: rec.envelopeDigest });
        changes = sameContent(pinned, target) ? [] : diffContent(pinned, target);
      } else {
        // vendored before the service: only the definition bytes can be compared
        changes = rec.digest === target.definitionDigest ? [] : ["definition"];
      }
      const deprecated = pinnedRow?.deprecated ? ` Revision ${rec.revision} is deprecated: ${pinnedRow.deprecated.reason}.` : "";
      out.push(
        changes.length
          ? { ...base, status: "update-available", contentChanged: true, changes, message: `pinned at ${revisionLabel(rec.revision) ?? rec.version}; revision ${rec2} is recommended and changes ${changes.join("; ")}.${deprecated} Re-pin with \`protoboard parts update ${id} --to ${rec2}\`.` }
          : isCloudRecord(rec)
            ? { ...base, status: "renumbered", contentChanged: false, message: `pinned at ${rec.revision}; revision ${rec2} has the same content (renumbered only).${deprecated} Nothing would change; \`--to ${rec2}\` moves the pin.` }
            : {
                ...base,
                status: "migratable",
                contentChanged: false,
                message: `vendored from ${rec.provider}; revision ${rec2} has the same definition bytes. \`protoboard parts add ${id}@${rec2}\` pins the service revision and vendors its files without changing the definition.`,
              },
      );
    } catch (e) {
      throw explainCloudError(e, cloud, id);
    }
  }
  return out;
}

/**
 * `parts update <id> --to <revision>`: re-pin deliberately, keeping the
 * replaced pin under `previous`. The revision comes from the library the part
 * is pinned to, or from `library` to move it to another one.
 */
export async function updatePart(p: Project, id: string, to: number | "recommended", libs: CloudConnection | CloudConnection[], options: { now?: string; library?: string; compiled?: boolean } = {}): Promise<AddResult[]> {
  const origins = readOrigins(p.root, p.config.catalog);
  const rec = origins.definitions[id];
  if (!rec) throw new PartsError("NOT_VENDORED", `${id} is not vendored in this project; \`protoboard parts add ${id}\` adds it`);
  const partId = rec.partId ?? id;
  const list = asList(libs);
  const { lib: cloud } = isCloudRecord(rec) || options.library ? await chooseLibrary(list, origins, id, options.library) : { lib: list.find((l) => l.id === DEFAULT_LIBRARY_ID) ?? list[0] };
  if (!cloud) throw new PartsError("NO_LIBRARIES", "no libraries are configured (protoboard.config.ts `libraries`)");
  try {
    const revision = to === "recommended" ? await recommended(cloud, partId) : to;
    const r = await vendorClosure(p, origins, cloud, { partId, revision }, { now: options.now ?? new Date().toISOString(), replace: true, compiled: options.compiled });
    writeOrigins(p, origins);
    // a project holds one revision per part: say which other vendored parts were made against the old one
    return r.map((x) => {
      if (x.status !== "updated") return x;
      const others = Object.entries(origins.definitions).filter(([id, o]) => o.dependencies?.some((d) => d.partId === x.id && d.revision !== x.revision) && id !== partId);
      return others.length ? { ...x, message: `${x.message}; ${others.map(([id, o]) => `${id}@${o.revision} was published with ${x.id}@${o.dependencies!.find((d) => d.partId === x.id)!.revision}`).join(", ")}` } : x;
    });
  } catch (e) {
    throw explainCloudError(e, cloud, `${id}@${to}`);
  }
}

// ---------------------------------------------------------------- publish

/** Media types for carried files, as the parts service's publishing scripts assign them. */
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

/**
 * Not distributed, whatever is on this machine: research working files and
 * vendor files whose redistribution has not been cleared (the same rule the
 * service's UHD library seed applies).
 */
// research working files stay in the project; vendor files are carried with their terms (PB-863), and the catalog decides who receives them
const NOT_DISTRIBUTED = /(^|\/)\.research\//;
const NOT_DISTRIBUTED_REASON = "not distributed: a research working file";

const listFiles = (dir: string, prefix = ""): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? listFiles(join(dir, n), `${prefix}${n}/`) : [`${prefix}${n}`]))
    : [];

export interface PublishResult {
  id: string;
  status: "published" | "unchanged" | "dry-run";
  revision: number;
  derivedFrom: PartRef | null;
  digest: string;
  definitionDigest: string;
  artifacts: string[];
  evidence: string[];
  missingArtifacts: MissingArtifact[];
  dependencies: PartRef[];
  /** Blobs uploaded (the service already had the others). */
  uploaded?: number;
  message: string;
}

const git = (cwd: string, args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * The terms of a project part's files (PB-863): `parts/evidence/<id>/terms.json`
 * (`protoboard.library-terms/v1`, the cloud library's format; projects have
 * no presets, so an entry gives its terms in full). An entry that pins
 * `sha256` applies only while the file has those bytes; a file without an
 * applicable entry goes without terms, which the catalog treats as unknown.
 */
function partTerms(root: string, id: string): (path: string, sha256: string) => FileTerms | undefined {
  const file = join(root, "parts", "evidence", id, "terms.json");
  if (!existsSync(file)) return () => undefined;
  const record = JSON.parse(readFileSync(file, "utf8")) as { files?: Record<string, Record<string, unknown>> };
  return (path, sha256) => {
    const entry = record.files?.[path];
    if (!entry || "preset" in entry || (typeof entry.sha256 === "string" && entry.sha256 !== sha256)) return undefined;
    // record fields stay in the record (sha256, note, verified, provenance); the rest are the file's terms
    const { sha256: _s, note: _n, verified: _v, provenance: _p, ...terms } = entry;
    return terms as unknown as FileTerms;
  };
}

/**
 * The draft for a project-researched part: the definition from
 * `parts/local/<file>.uhd.ts`, the files its artifacts reference (relative to
 * the project root, which is the revision's artifact base), the other files
 * in `parts/local/<id>/`, and its evidence from `parts/evidence/<id>/`.
 * `sourcing.json` stays in the project: supplier offers are commercial data,
 * not facts about the part, and never part of a revision.
 */
export function localPartDraft(p: Project, id: string, revision: number, derivedFrom: PartRef | null, dependencies: PartRef[]): { draft: PartRevisionDraft; files: Map<string, string> } {
  const rec = p.definitions.get(id)!;
  const definition = JSON.parse(JSON.stringify(rec.def)) as UhdModuleDef;
  const files = new Map<string, string>();
  const artifacts: EnvelopeArtifact[] = [];
  const missingArtifacts: MissingArtifact[] = [];
  const carried = new Set<string>();
  const termsFor = partTerms(p.root, id);
  const facts = (path: string) => {
    const file = join(p.root, ...path.split("/"));
    const bytes = readFileSync(file);
    const sha = sha256Hex(bytes);
    files.set(sha, file);
    const terms = termsFor(path, sha);
    return { sha256: sha, size: bytes.length, mediaType: mediaTypeFor(path), ...(terms ? { terms } : {}) };
  };
  for (const { path, artifact } of referencedFiles(definition)) {
    if (carried.has(path) || missingArtifacts.some((m) => m.path === path)) continue;
    const file = join(p.root, ...path.split("/"));
    if (NOT_DISTRIBUTED.test(path)) missingArtifacts.push({ path, artifactId: artifact.id, reason: NOT_DISTRIBUTED_REASON });
    else if (!isSafePath(path)) missingArtifacts.push({ path, artifactId: artifact.id, reason: "not a normalised project-relative path, so it cannot be carried" });
    else if (!existsSync(file) || !statSync(file).isFile()) missingArtifacts.push({ path, artifactId: artifact.id, reason: "file not present in the project" });
    else {
      const role = (ARTIFACT_ROLES as readonly string[]).includes(artifact.role ?? "") ? (artifact.role as ArtifactRole) : "attachment";
      artifacts.push({ path, ...facts(path), role, artifactId: artifact.id });
      carried.add(path);
    }
  }
  // the part's own folder beside its definition: thumbnail, licence texts, other files
  const own = `${LOCAL_PARTS_DIR}/${id}`;
  for (const f of listFiles(join(p.root, own))) {
    const path = `${own}/${f}`;
    if (carried.has(path) || NOT_DISTRIBUTED.test(path) || f.endsWith(".uhd.ts")) continue;
    const role: ArtifactRole = /(^|\/)thumbnail\.png$/.test(f) ? "thumbnail" : /(^|\/)LICEN[CS]E[^/]*$/i.test(f) ? "license" : "attachment";
    artifacts.push({ path, ...facts(path), role });
    carried.add(path);
  }
  const evidenceDir = `parts/evidence/${id}`;
  const evidence: EvidenceRef[] = [];
  for (const f of listFiles(join(p.root, evidenceDir))) {
    const path = `${evidenceDir}/${f}`;
    // sourcing.json is commercial data; terms.json becomes each file's `terms`
    if (NOT_DISTRIBUTED.test(path) || f === "sourcing.json" || f === "terms.json") continue;
    const kind: EvidenceKind = f === "sources.json" ? "sources" : f === "verification.json" ? "verification" : extname(f).toLowerCase() === ".pdf" ? "datasheet" : "document";
    evidence.push({ kind, path, ...facts(path) });
  }
  const uhd = uhdVersion(p.root).version;
  if (!uhd) throw new PartsError("UHD_VERSION", "cannot tell which @deltarobotics/uhd version the project uses (is it installed?)");
  const draft = sealDraft({
    schema: PART_REVISION_SCHEMA,
    // the schema of UHD's minor line, not the patch installed: the same part published under 0.2.0 and 0.2.1 is one revision
    uhdSchema: uhdSchemaVersion(uhd),
    partId: id,
    revision,
    definition,
    dependencies: [...dependencies].sort((a, b) => a.partId.localeCompare(b.partId)),
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
    missingArtifacts: missingArtifacts.sort((a, b) => a.path.localeCompare(b.path)),
    evidence: evidence.sort((a, b) => a.path!.localeCompare(b.path!)),
    derivedFrom,
    source: provenance(p, rec.origin.source.file),
  });
  return { draft, files };
}

/** Where the part was authored: this project, its commit when it is in git. */
function provenance(p: Project, file: string): PartRevisionDraft["source"] {
  const source: NonNullable<PartRevisionDraft["source"]> = { repository: `protoboard project ${p.name}`, path: file };
  try {
    source.commit = git(p.root, ["rev-parse", "HEAD"]);
    if (git(p.root, ["status", "--porcelain", "--", "."]) !== "") source.dirty = true;
  } catch {
    // not a git checkout: the project name and path are what there is
  }
  return source;
}

/** The project-researched definition a `parts publish` argument names: a parts/local file, or a part id. */
function localPart(p: Project, target: string, cwd: string): string {
  const abs = resolve(cwd, target);
  const rel = projectRelative(p.root, abs);
  const inFile = existsSync(abs) && statSync(abs).isFile() ? [...p.definitions.values()].filter((r) => r.origin.kind === "local" && r.origin.source.file === rel) : [];
  const rec = inFile.length ? undefined : p.definitions.get(target);
  if (inFile.length > 1) throw new PartsError("PUBLISH_AMBIGUOUS", `${rel} declares ${inFile.map((r) => r.def.id).join(", ")}; publish one part per file (or name the part id)`);
  const found = inFile[0] ?? rec;
  if (!found) throw new PartsError("PUBLISH_NOT_FOUND", `${target} is neither a project source that declares a part nor a part id in this project`);
  if (found.origin.tier !== "project-researched") {
    throw new PartsError(
      "PUBLISH_TIER",
      `${found.def.id} is a ${found.origin.tier} part (${found.origin.source.file}); only project-researched parts in ${LOCAL_PARTS_DIR}/ are published to the catalog`,
    );
  }
  return found.def.id;
}

/**
 * `parts publish <path>`: promote a project-researched part to the catalog
 * as its next revision (1 for a new part, otherwise derived from the latest).
 * Content equal to the latest revision publishes nothing. Needs
 * PROTOBOARD_CLOUD_TOKEN, except for a dry run.
 */
export async function publishPart(p: Project, target: string, cloud: CloudConnection, options: { cwd?: string; dryRun?: boolean; now?: string } = {}): Promise<PublishResult> {
  const id = localPart(p, target, options.cwd ?? p.root);
  const rec = p.definitions.get(id)!;
  // the project's own checks first: a part with errors is not published
  const errors = p.diagnostics.filter((d) => d.severity === "error" && (d.entity.id === id || d.entity.id.startsWith(`${id}#`) || d.entity.id.startsWith(`${id}:`) || d.source?.file === rec.origin.source.file));
  if (errors.length) throw new PartsError("PUBLISH_CHECK_FAILED", `${id} has ${errors.length} error(s) in \`protoboard check\`; fix them first:\n${errors.map((d) => `  ${d.code}  ${d.message}`).join("\n")}`);
  const evidenceDir = join(p.root, "parts", "evidence", id);
  const missingEvidence = ["sources.json", "verification.json"].filter((f) => !existsSync(join(evidenceDir, f)));
  if (missingEvidence.length) {
    throw new PartsError("PUBLISH_UNVERIFIED", `${id}: the catalog holds researched and verified parts; parts/evidence/${id}/ has no ${missingEvidence.join(" or ")} (uhd-part-research, uhd-part-verify)`);
  }
  // children are pinned at the catalog revisions this project vendored
  const origins = readOrigins(p.root, p.config.catalog);
  const dependencies: PartRef[] = [];
  for (const child of referencedDefinitions(rec.def as unknown as UhdModuleDef)) {
    const o = origins.definitions[child];
    if (!isCloudRecord(o)) {
      const where = p.definitions.get(child)?.origin;
      throw new PartsError("PUBLISH_DEPENDENCY", `${id} contains ${child}, which is ${where ? `a ${where.tier} part (${where.source.file})` : "not defined"}; a catalog part can only contain catalog parts: publish or add ${child} first`);
    }
    dependencies.push({ partId: o.partId ?? child, revision: o.revision });
  }
  try {
    const revisions = await cloud.client.listRevisions(id).catch((e) => {
      if (e instanceof CloudError && e.code === "PART_NOT_FOUND") return [] as RevisionRow[];
      throw e;
    });
    const latest = revisions.length ? await cloud.client.getRevision(id, revisions[revisions.length - 1].revision) : undefined;
    const revision = (latest?.revision ?? 0) + 1;
    const derivedFrom = latest ? { partId: id, revision: latest.revision } : null;
    const { draft, files } = localPartDraft(p, id, revision, derivedFrom, dependencies);
    const problems = validateDraft(draft);
    if (problems.length) throw new PartsError("ENVELOPE_INVALID", `${id}: the revision would be invalid:\n${problems.map((x) => `  ${x.code}${x.at ? ` at ${x.at}` : ""}: ${x.message}`).join("\n")}`);
    const summary = {
      id,
      derivedFrom,
      definitionDigest: draft.definitionDigest,
      artifacts: draft.artifacts.map((a) => a.path),
      evidence: draft.evidence.flatMap((e) => (e.path ? [e.path] : [])),
      missingArtifacts: draft.missingArtifacts,
      dependencies: draft.dependencies,
    };
    if (latest && sameContent(latest, draft)) {
      return { ...summary, status: "unchanged", revision: latest.revision, digest: latest.digest, derivedFrom: latest.derivedFrom, message: `${id}@${latest.revision} at ${cloud.url} already has this content; nothing published` };
    }
    if (options.dryRun) return { ...summary, status: "dry-run", revision, digest: draft.digest, message: `would publish ${id}@${revision} to ${cloud.url}` };
    if (!cloud.canPublish) throw new PartsError("AUTH_REQUIRED", `publishing ${id} needs a publisher: sign in with \`protoboard login\` as one, or set the service's token in PROTOBOARD_CLOUD_TOKEN (never stored in the project)`);
    const r = await cloud.client.publish(draft, (sha) => readFileSync(files.get(sha)!));
    origins.published = {
      ...origins.published,
      [id]: { file: rec.origin.source.file, service: cloud.url, revision: r.envelope.revision, envelopeDigest: r.envelope.digest, definitionDigest: r.envelope.definitionDigest, publishedAt: options.now ?? r.envelope.createdAt },
    };
    writeOrigins(p, origins);
    return {
      ...summary,
      status: r.status === "source-added" ? "unchanged" : r.status,
      revision: r.envelope.revision,
      digest: r.envelope.digest,
      uploaded: r.uploaded.length,
      message: `${r.status} ${id}@${r.envelope.revision} at ${cloud.url}: ${draft.artifacts.length} files, ${r.uploaded.length} uploaded`,
    };
  } catch (e) {
    throw explainCloudError(e, cloud, id, { publishing: true });
  }
}


// ---------------------------------------------------------------------------
// Usage: the library owners' view (publishers only)
// ---------------------------------------------------------------------------

/**
 * `parts usage`: the most added parts of the Protoboard library over a
 * period, as counts (PB-936). For the library's publishers: the service
 * refuses everyone else. It says how often, never who.
 */
export async function libraryUsage(cloud: CloudConnection, query: { days?: number; from?: string; to?: string; limit?: number } = {}): Promise<UsageReport> {
  try {
    return await cloud.client.usage(query);
  } catch (e) {
    if (e instanceof CloudError && ["AUTH_REQUIRED", "FORBIDDEN", "PUBLISH_DISABLED"].includes(e.code))
      throw new PartsError(e.code, `the usage of ${cloud.url} is for the library's publishers (${e.code}: ${e.message}). Sign in with a publisher account (\`protoboard login\`) or set PROTOBOARD_CLOUD_TOKEN.`);
    if (e instanceof CloudError && e.status === 404) throw new PartsError("NO_USAGE", `${cloud.url} does not record usage (a parts service older than usage tracking)`);
    throw explainCloudError(e, cloud);
  }
}

// ---------------------------------------------------------------------------
// Offers: commercial data, vendored for offline use (releases never call the service)
// ---------------------------------------------------------------------------

export const OFFERS_FILE = "parts/offers.json";
export const OFFERS_SCHEMA = "protoboard.offers/v0";

/**
 * `parts/offers.json`: the service's offers by part id, as last retrieved:
 * prices by source (supplier, its code, price breaks, currency, stock, pack
 * and minimum order, the link, when it was observed). The service says
 * nothing about how a price was fetched, so neither does this file.
 */
export interface OffersFile {
  schema: typeof OFFERS_SCHEMA;
  service: string;
  retrievedAt: string;
  parts: Record<string, Omit<PublicOffer, "id" | "partId">[]>;
}

/**
 * `parts offers [id...]`: fetch the offers the parts service holds for the
 * vendored catalog parts (all of them, or the ids named) and write them to
 * `parts/offers.json`, replacing those parts' entries. Offers never change a
 * part's revision or digest; they are dated observations a release quotes.
 */
export async function vendorOffers(p: Project, ids: string[], cloud: CloudConnection, options: { now?: string } = {}): Promise<{ id: string; offers: number; status: "vendored" | "not-catalog" }[]> {
  const origins = readOrigins(p.root, p.config.catalog);
  const catalog = Object.entries(origins.definitions).filter(([, r]) => r.tier === "catalog" || r.provider === CLOUD_PROVIDER);
  const wanted = ids.length ? ids : catalog.map(([id]) => id).sort();
  const file = join(p.root, OFFERS_FILE);
  const existing: OffersFile | undefined = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  const parts: OffersFile["parts"] = { ...(existing?.parts ?? {}) };
  const out: { id: string; offers: number; status: "vendored" | "not-catalog" }[] = [];
  for (const id of wanted) {
    const rec = catalog.find(([x]) => x === id)?.[1];
    if (!rec) {
      out.push({ id, offers: 0, status: "not-catalog" });
      continue;
    }
    let offers: PublicOffer[];
    try {
      offers = await cloud.client.listOffers(rec.partId ?? id);
    } catch (e) {
      throw explainCloudError(e, cloud.url, id);
    }
    parts[id] = offers
      .map(({ id: _id, partId: _part, ...o }) => o)
      .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : a.supplier.localeCompare(b.supplier)));
    out.push({ id, offers: parts[id].length, status: "vendored" });
  }
  const data: OffersFile = { schema: OFFERS_SCHEMA, service: cloud.url, retrievedAt: options.now ?? new Date().toISOString(), parts: Object.fromEntries(Object.keys(parts).sort().map((k) => [k, parts[k]])) };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return out;
}

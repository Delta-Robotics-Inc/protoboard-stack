/**
 * Project loading: config, local definitions, catalog definitions (with
 * integrity), and the definition registry.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import type { ModuleDef } from "@deltarobotics/uhd";
import type { ArtifactBase, DefinitionRecord, Origin, PartTier, ProjectDiagnostic, ProtoboardConfig, SourceLocation } from "./types.js";
import { cachedEvaluations, editedSourceFiles, evaluateSources, lintVendoredSource, projectToolchain, requirementDiagnostics, uhdPinDiagnostics, vendoredClosure, type SourceClosure, type SourceEvaluation, type VendoredSource } from "./source.js";
import type { SourceProblem } from "@deltarobotics/uhd/library";
import { importFailure, isFormerScopeImport } from "./scope.js";
import { isInside, projectRelative, realpathOrAncestor, recordedPath } from "./paths.js";
import { recordLayout, withStoredPaths } from "./vendored-layout.js";

/** A path relative to the project, written with forward slashes on every system: what the build records and the views compare (Windows gave `src\\x.uhd.ts`). */
const relative = (from: string, to: string): string => projectRelative(from, to);

export const CONFIG_FILE = "protoboard.config.ts";

export function defineConfig(config: ProtoboardConfig): ProtoboardConfig {
  return config;
}

/** Walk up from `from` to the directory holding protoboard.config.ts. */
export function findProjectRoot(from = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

let registered = false;
/**
 * Import a project TypeScript file. The tsx loader is registered once, so all
 * project sources share Node's module cache: a definition imported by two
 * files is the same object, not a duplicate. Small leaf files that are edited
 * between loads (module capability configs) can be imported `fresh`.
 */
export async function importTs<T = Record<string, unknown>>(file: string, options: { fresh?: boolean } = {}): Promise<T> {
  if (!registered) {
    register();
    registered = true;
  }
  // fresh: keyed by content, so an edited file is evaluated again in a long-running process
  const url = pathToFileURL(file).href + (options.fresh ? `?digest=${sha256(readFileSync(file)).slice(7, 23)}` : "");
  return (await import(url)) as T;
}

/** Imports project TypeScript files: `importTs`, or a `freshImporter`. */
export type TsImporter = <T = Record<string, unknown>>(file: string) => Promise<T>;

/**
 * An importer with a module graph of its own (a tsx namespace): every project
 * source it imports, and every source those import, is evaluated anew, once
 * per importer. A long-running process uses one to see definitions that
 * read files an operation has just written (a harness's route).
 */
export function freshImporter(): TsImporter {
  const api = register({ namespace: `protoboard-${randomUUID()}` });
  return async <T>(file: string) => (await api.import(pathToFileURL(file).href, import.meta.url)) as T;
}

export async function loadConfig(root: string): Promise<ProtoboardConfig> {
  const mod = await importTs<{ default?: ProtoboardConfig }>(join(root, CONFIG_FILE)).catch((e: unknown) => {
    // a project written for the former npm scope (PB-941): say what to change, not only what is missing
    if (isFormerScopeImport(e)) throw new Error(`${CONFIG_FILE}: ${importFailure(e)}`);
    throw e;
  });
  if (!mod.default) throw new Error(`${CONFIG_FILE} has no default export`);
  return mod.default;
}

/**
 * The files that are not in the catalog folder (by path or, links followed,
 * by realpath): what a `sources` glob may load as the project's own code. A
 * vendored part's files are someone else's, evaluated confined (PB-1048).
 */
export function outsideCatalog(root: string, config: Pick<ProtoboardConfig, "catalog">, files: string[]): string[] {
  const catalog = join(root, config.catalog ?? "parts/catalog");
  const real = realpathOrAncestor(catalog);
  return files.filter((f) => !isInside(catalog, f) && !isInside(real, realpathOrAncestor(f)));
}

/** Minimal glob: "dir/**\/*.suffix" and plain paths. */
export function expandGlob(root: string, pattern: string): string[] {
  const m = pattern.match(/^(.*?)\/?\*\*\/\*(\.[\w.]+)$/);
  if (!m) return existsSync(join(root, pattern)) ? [join(root, pattern)] : [];
  const base = join(root, m[1]);
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "node_modules" && !name.startsWith(".")) walk(p);
      } else if (name.endsWith(m[2])) out.push(p);
    }
  };
  walk(base);
  return out;
}

export const isModuleDef = (v: unknown): v is ModuleDef =>
  !!v && typeof v === "object" && typeof (v as ModuleDef).id === "string" && Array.isArray((v as ModuleDef).interfaces);

/** Line of `id: "<id>"` in a source file, for source-located diagnostics. */
export function locateId(file: string, id: string, root: string, key = "id"): SourceLocation {
  const text = readFileSync(file, "utf8");
  const needle = new RegExp(`\\b${key}\\s*:\\s*["'\`]${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
  const lines = text.split("\n");
  const i = lines.findIndex((l) => needle.test(l));
  return { file: relative(root, file), ...(i >= 0 ? { line: i + 1 } : {}) };
}

/**
 * A vendored definition's entry in parts/origins.json (`"<id>": {` under
 * `definitions`), where its pin, files and missing artifacts are recorded:
 * the place to point a finding about a catalog part at.
 */
export function originEntry(root: string, catalog: string | undefined, id: string): SourceLocation {
  const file = originsPath(root, catalog);
  const rel = relative(root, file);
  try {
    const lines = readFileSync(file, "utf8").split("\n");
    const needle = JSON.stringify(id) + ":";
    const i = lines.findIndex((l) => l.trimStart().startsWith(needle));
    return { file: rel, ...(i >= 0 ? { line: i + 1 } : {}) };
  } catch {
    return { file: rel };
  }
}

/** A vendored definition's record in parts/origins.json. */
export interface OriginRecord {
  /** The vendored definition file (project-relative). */
  file: string;
  /** Vendored definitions are the cloud catalog tier (docs/specs/tool-integrations.md §6). */
  tier?: "catalog";
  /** "protoboard-cloud" for the Protoboard library, "uhd-library" for another uhd-library/v1 library, "<package> library" for definitions vendored from an npm package. */
  provider: string;
  /** Library URL the revision was downloaded from. */
  service?: string;
  /** Library id (`libraries` in protoboard.config.ts) it was downloaded from; absent on records from before libraries, which came from the Protoboard library. */
  library?: string;
  partId?: string;
  package?: string;
  version?: string;
  /** Parts service: the immutable revision number. Package-vendored: the package's git commit. */
  revision?: string | number;
  /** UHD schema the definition is written against. */
  uhdSchema?: string;
  /** sha256 of the vendored definition file: what `check` verifies. */
  digest: string;
  /** Parts service: digest of the revision envelope. */
  envelopeDigest?: string;
  retrievedAt: string;
  /**
   * Where the files are. `vendored`: under `dir`; `strip` is the library's
   * folder prefix left out of their paths (src/vendored-layout.ts), absent
   * in the layout of stack 0.1.6 and earlier.
   */
  artifactBase?: { kind: "package"; package: string } | { kind: "vendored"; dir: string; strip?: string };
  /** Exact revisions of the definitions this one references, vendored with it. */
  dependencies?: { partId: string; revision: number }[];
  /** Every file vendored with the revision: path under the artifact base → sha256. Checked offline. */
  files?: Record<string, string>;
  /** Evidence files among them, by kind (sources, verification, datasheet, …). */
  evidence?: { kind: string; path: string }[];
  /** Files the revision references but does not carry, with the service's reason. */
  missingArtifacts?: { path: string; artifactId?: string; reason: string }[];
  /**
   * The definition source vendored with the revision (PB-910; absent when
   * vendored `--compiled` or the library ships none): its files under the
   * artifact base, the entry and export, and the UHD and TypeScript ranges
   * it requires. Loading evaluates it; `check` reports when it no longer
   * evaluates to `digest`.
   */
  source?: VendoredSource;
  /** The pin this one replaced (`protoboard parts update`). */
  previous?: { provider?: string; library?: string; revision?: string | number; version?: string; digest: string; envelopeDigest?: string; retrievedAt: string };
}

/** A project-researched part promoted to the catalog (`protoboard parts publish`). */
export interface PublishedRecord {
  /** The parts/local source it was published from. */
  file: string;
  service: string;
  revision: number;
  envelopeDigest: string;
  definitionDigest: string;
  publishedAt: string;
}

export interface OriginsFile {
  schema: "protoboard.origins/v0";
  definitions: Record<string, OriginRecord>;
  /** Project-researched parts published to the catalog, by part id. */
  published?: Record<string, PublishedRecord>;
}

export const ORIGINS_SCHEMA = "protoboard.origins/v0";
export const DEFAULT_SOURCES = ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"];
/** Project-researched parts live here (docs/specs/tool-integrations.md §6). */
export const LOCAL_PARTS_DIR = "parts/local";

/** parts/origins.json beside the catalog folder (an empty file when there is none yet). */
export function originsPath(root: string, catalog = "parts/catalog"): string {
  return join(dirname(join(root, catalog)), "origins.json");
}

export function readOrigins(root: string, catalog?: string): OriginsFile {
  const file = originsPath(root, catalog);
  return existsSync(file) ? normalizeOrigins(JSON.parse(readFileSync(file, "utf8"))) : { schema: ORIGINS_SCHEMA, definitions: {} };
}

/**
 * parts/origins.json as this stack reads it on any system: every recorded
 * path with forward slashes. Stack 0.1.6 and earlier wrote the definition
 * file and the vendored folder with the separators of the system that
 * vendored the part, so a project vendored on Windows listed its catalog
 * files as missing on macOS and Linux (PB-1018). The next write of the file
 * (any `parts` command that changes it) records the paths as read here.
 */
export function normalizeOrigins(origins: OriginsFile): OriginsFile {
  const keys = <T>(o: Record<string, T> | undefined) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [recordedPath(k), v])) : o);
  for (const [id, rec] of Object.entries(origins.definitions ?? {})) {
    const next: OriginRecord = { ...rec, file: recordedPath(rec.file) };
    if (rec.artifactBase?.kind === "vendored") next.artifactBase = { ...rec.artifactBase, dir: recordedPath(rec.artifactBase.dir) };
    if (rec.files) next.files = keys(rec.files);
    if (rec.evidence) next.evidence = rec.evidence.map((e) => ({ ...e, path: recordedPath(e.path) }));
    if (rec.missingArtifacts) next.missingArtifacts = rec.missingArtifacts.map((m) => ({ ...m, path: recordedPath(m.path) }));
    if (rec.source) next.source = { ...rec.source, entry: recordedPath(rec.source.entry), files: keys(rec.source.files)! };
    origins.definitions[id] = next;
  }
  for (const [id, rec] of Object.entries(origins.published ?? {})) origins.published![id] = { ...rec, file: recordedPath(rec.file) };
  return origins;
}

/** Absolute directory a definition's artifacts resolve against, or undefined when its package is not installed. */
export function artifactBaseDir(root: string, base: ArtifactBase): string | undefined {
  if (base.kind === "project") return root;
  if (base.kind === "vendored") return join(root, base.dir);
  return packageRoot(root, base.package);
}

/** Label for an artifact base in diagnostics and build output: project, package:<name>, or the vendored directory. */
export function artifactBaseLabel(base: ArtifactBase): string {
  return base.kind === "project" ? "project" : base.kind === "package" ? `package:${base.package}` : base.dir;
}

/** Tier of a local definition, from where its source lives. */
export const localTier = (file: string): PartTier => (file === LOCAL_PARTS_DIR || file.startsWith(`${LOCAL_PARTS_DIR}/`) ? "project-researched" : "project-specific");

/** A revision for people: a parts-service number as is, a commit shortened. */
export const revisionLabel = (revision: string | number | undefined): string | undefined => (typeof revision === "number" ? String(revision) : revision?.slice(0, 12));

export const sha256 = (bytes: Buffer | string) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

export interface LoadedDefinitions {
  records: DefinitionRecord[];
  diagnostics: ProjectDiagnostic[];
}

export async function loadDefinitions(root: string, config: ProtoboardConfig, importer: TsImporter = importTs): Promise<LoadedDefinitions> {
  const records: DefinitionRecord[] = [];
  // the UHD the project pins against the one it runs with
  const diagnostics: ProjectDiagnostic[] = [...uhdPinDiagnostics(root)];

  // ---- local sources: every exported ModuleDef (or array of them)
  // never the catalog folder, whatever a `sources` glob says: vendored sources are someone else's code, evaluated confined below (PB-1048)
  const catalogFolder = join(root, config.catalog ?? "parts/catalog");
  const matched = [...new Set((config.sources ?? DEFAULT_SOURCES).flatMap((g) => expandGlob(root, g)))];
  const files = outsideCatalog(root, config, matched);
  if (files.length < matched.length)
    diagnostics.push({
      code: "PB_SOURCES_IN_CATALOG",
      severity: "info",
      entity: { kind: "project", id: CONFIG_FILE },
      message: `${matched.length - files.length} file(s) a \`sources\` glob matches are in ${relative(root, catalogFolder) || "the catalog folder"}; they are not loaded as project sources (a vendored part's source is evaluated confined, from parts/origins.json)`,
      source: { file: CONFIG_FILE },
      validator: "protoboard/loader",
    });
  const seen = new Set<ModuleDef>();
  for (const file of files) {
    let mod: Record<string, unknown>;
    try {
      mod = await importer(file);
    } catch (e) {
      diagnostics.push({
        code: "PB_SOURCE_LOAD_FAILED",
        severity: "error",
        entity: { kind: "project", id: relative(root, file) },
        message: `could not evaluate ${relative(root, file)}: ${importFailure(e)}`,
        source: { file: relative(root, file) },
        validator: "protoboard/loader",
      });
      continue;
    }
    for (const value of Object.values(mod)) {
      for (const def of Array.isArray(value) ? value : [value]) {
        if (!isModuleDef(def) || seen.has(def)) continue;
        seen.add(def);
        // a definition re-exported from another local file belongs to the file that declares its id
        const declared = files.find((f) => locateId(f, def.id, root).line !== undefined) ?? file;
        const source = locateId(declared, def.id, root);
        records.push({
          def,
          origin: { kind: "local", tier: localTier(source.file), source, artifactBase: { kind: "project" } },
        });
      }
    }
  }

  // ---- catalog: vendored JSON definitions, verified against parts/origins.json
  const catalogDir = join(root, config.catalog ?? "parts/catalog");
  const originsFile = originsPath(root, config.catalog);
  const origins = readOrigins(root, config.catalog);
  let toolchain: ReturnType<typeof projectToolchain> | undefined;
  // vendored definition sources: linted, then evaluated confined, all in one batch, again only when a file changed (source.ts)
  const vendored = Object.entries(origins.definitions)
    .filter(([id, r]) => r.source && r.artifactBase?.kind === "vendored" && existsSync(join(catalogDir, `${id}.json`)))
    .map(([id, r]) => ({ id, dir: join(root, (r.artifactBase as { dir: string }).dir), src: r.source!, files: editedSourceFiles(root, (r.artifactBase as { dir: string }).dir, r.source!) }));
  const sourceLint = new Map<string, SourceProblem[]>();
  const closures: SourceClosure[] = [];
  for (const v of vendored) {
    if (v.files.missing.length) continue;
    const closure = vendoredClosure(v.id, v.dir, v.src);
    const problems = lintVendoredSource(closure.files, v.src.entry);
    if (problems.length) sourceLint.set(v.id, problems);
    else closures.push(closure);
  }
  const evaluated = closures.length ? await cachedEvaluations(sha256(vendored.map((v) => `${v.id} ${v.files.state}`).join("\n")), () => evaluateSources(root, closures)) : new Map<string, SourceEvaluation>();
  if (existsSync(catalogDir)) {
    for (const name of readdirSync(catalogDir).filter((n) => n.endsWith(".json")).sort()) {
      const file = join(catalogDir, name);
      const rel = relative(root, file);
      const bytes = readFileSync(file);
      const id = basename(name, ".json");
      const rec = origins.definitions[id];
      if (!rec) {
        diagnostics.push({
          code: "PB_ORIGIN_MISSING",
          severity: "error",
          entity: { kind: "definition", id },
          message: `${rel} has no origin record in ${relative(root, originsFile)}; add it with \`protoboard parts add\``,
          source: { file: rel },
          validator: "protoboard/catalog",
        });
        continue;
      }
      const digest = sha256(bytes);
      if (digest !== rec.digest) {
        diagnostics.push({
          code: "PB_DIGEST_MISMATCH",
          severity: "error",
          entity: { kind: "definition", id },
          message: `${rel} does not match its recorded digest (${rec.digest.slice(0, 19)}…, now ${digest.slice(0, 19)}…): catalog definitions are immutable; re-download or derive a local variant`,
          source: { file: rel },
          validator: "protoboard/catalog",
        });
        continue;
      }
      let def: ModuleDef;
      try {
        def = JSON.parse(bytes.toString("utf8"));
      } catch (e) {
        diagnostics.push({ code: "PB_CATALOG_PARSE", severity: "error", entity: { kind: "definition", id }, message: `${rel}: ${(e as Error).message}`, source: { file: rel }, validator: "protoboard/catalog" });
        continue;
      }
      const artifactBase: ArtifactBase = rec.artifactBase ?? { kind: "project" };
      // definition source (PB-910): loading uses it; the pinned JSON is what it must evaluate to
      let definitionSource: SourceLocation | undefined;
      if (rec.source && artifactBase.kind === "vendored") {
        const src = rec.source;
        const entryRel = relative(root, join(root, artifactBase.dir, ...src.entry.split("/")));
        const at = originEntry(root, config.catalog, id);
        toolchain ??= projectToolchain(root);
        diagnostics.push(...requirementDiagnostics(id, src, toolchain, at));
        const { missing, edited } = vendored.find((v) => v.id === id)?.files ?? editedSourceFiles(root, artifactBase.dir, src);
        const lint = sourceLint.get(id);
        if (missing.length) {
          diagnostics.push({
            code: "PB_SOURCE_FILE_MISSING",
            severity: "warning",
            entity: { kind: "definition", id },
            message: `${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} vendored with ${id}@${revisionLabel(rec.revision)}'s source and ${missing.length === 1 ? "is" : "are"} missing; ${rel} is used. Restore ${missing.length === 1 ? "it" : "them"} with \`protoboard parts add ${id}@${rec.revision}\``,
            source: at,
            validator: "protoboard/catalog",
          });
        } else if (lint) {
          diagnostics.push({
            code: "PB_SOURCE_LINT",
            severity: "error",
            entity: { kind: "definition", id },
            message: `${id}'s source is not evaluated: ${lint
              .slice(0, 2)
              .map((x) => `${x.path ?? ""}${x.line ? `:${x.line}` : ""} ${x.message}`)
              .join("; ")}${lint.length > 2 ? `; ${lint.length - 2} more` : ""}. Library source may only import @deltarobotics/uhd and its own files, with no host access or reflection; ${rel} is used. Restore it with \`protoboard parts add ${id}@${rec.revision}\``,
            source: { file: lint[0].path ? relative(root, join(root, artifactBase.dir, ...lint[0].path.split("/"))) : entryRel, ...(lint[0].line ? { line: lint[0].line } : {}) },
            validator: "protoboard/catalog",
          });
        } else {
          const r = evaluated.get(id) ?? { error: "it was not evaluated" };
          definitionSource = { file: entryRel };
          if ("error" in r) {
            diagnostics.push({
              code: "PB_SOURCE_LOAD_FAILED",
              severity: "error",
              entity: { kind: "definition", id },
              message: `could not evaluate ${entryRel} (${id}'s source): ${r.error}; ${rel} is used`,
              source: { file: entryRel },
              validator: "protoboard/catalog",
            });
          } else {
            // what the project builds with is the pinned definition: a drifted source is reported, never used
            if (r.digest === rec.digest) def = r.def;
            if (r.digest !== rec.digest)
              diagnostics.push({
                code: "PB_SOURCE_DRIFT",
                severity: "error",
                entity: { kind: "definition", id },
                message: `${entryRel} no longer evaluates to the pinned definition of ${id}@${revisionLabel(rec.revision)} (${rec.digest.slice(0, 19)}…, now ${r.digest.slice(0, 19)}…)${edited.length ? `: ${edited.join(", ")} ${edited.length === 1 ? "was" : "were"} edited` : `: the files are as vendored, so the UHD it evaluates with differs (${toolchain.uhd?.version ?? "unknown"}; it needs ${src.requires.uhd})`}; ${rel} is used. Vendored parts are immutable: restore with \`protoboard parts add ${id}@${rec.revision}\`, or copy it to parts/local as a derived part under a new id`,
                source: { file: edited[0] ?? entryRel },
                validator: "protoboard/catalog",
              });
            else if (edited.length)
              diagnostics.push({
                code: "PB_SOURCE_EDITED",
                severity: "info",
                entity: { kind: "definition", id },
                message: `${edited.join(", ")} differ${edited.length === 1 ? "s" : ""} from what was vendored but still evaluate${edited.length === 1 ? "s" : ""} to the pinned definition of ${id}`,
                source: { file: edited[0] },
                validator: "protoboard/catalog",
              });
          }
        }
      }
      const origin: Origin = {
        kind: "catalog",
        tier: "catalog",
        source: { file: rel },
        provider: rec.provider,
        ...(rec.service ? { service: rec.service } : {}),
        ...(rec.library ? { library: rec.library } : rec.provider === "protoboard-cloud" ? { library: "protoboard" } : {}),
        package: rec.package,
        version: rec.version,
        revision: rec.revision,
        digest: rec.digest,
        ...(rec.envelopeDigest ? { envelopeDigest: rec.envelopeDigest } : {}),
        retrievedAt: rec.retrievedAt,
        artifactBase,
        ...(rec.evidence?.length && artifactBase.kind === "vendored" ? { evidence: rec.evidence.map((e) => ({ kind: e.kind, file: join(artifactBase.dir, e.path) })) } : {}),
        ...(rec.missingArtifacts?.length ? { missingArtifacts: rec.missingArtifacts } : {}),
        ...(definitionSource ? { definitionSource } : {}),
      };
      // the definition's files at the paths they have in the project (the bytes checked above stay the pin)
      if (artifactBase.kind === "vendored") def = withStoredPaths(def, artifactBase.strip);
      records.push({ def, origin });
      if (artifactBase.kind === "vendored") diagnostics.push(...vendoredFileDiagnostics(root, id, artifactBase.dir, rec, originEntry(root, config.catalog, id)));
    }
  }
  for (const id of Object.keys(origins.definitions)) {
    if (!existsSync(join(root, origins.definitions[id].file))) {
      diagnostics.push({
        code: "PB_CATALOG_FILE_MISSING",
        severity: "error",
        entity: { kind: "definition", id },
        message: `origins.json lists ${id} but ${origins.definitions[id].file} is missing`,
        source: originEntry(root, config.catalog, id),
        validator: "protoboard/catalog",
      });
    }
  }
  // the folder layout of stack 0.1.6 and earlier repeats each part id in every path (PB-1018)
  const earlier = Object.entries(origins.definitions).filter(([id, r]) => !recordLayout(id, r, config.catalog ?? "parts/catalog").current);
  if (earlier.length)
    diagnostics.push({
      code: "PB_CATALOG_LAYOUT_EARLIER",
      severity: "info",
      entity: { kind: "project", id: relative(root, originsFile) },
      message: `${earlier.length} vendored part${earlier.length === 1 ? " is" : "s are"} in the folder layout of Protoboard 0.1.6 and earlier (${earlier
        .slice(0, 3)
        .map(([id]) => id)
        .join(", ")}${earlier.length > 3 ? ", …" : ""}), whose paths repeat the part id and can be too long for Windows; \`protoboard parts migrate\` moves them to the short layout (offline; the pins stay)`,
      source: { file: relative(root, originsFile) },
      validator: "protoboard/catalog",
    });
  return { records, diagnostics };
}

/**
 * Files vendored with a catalog revision are as immutable as its definition:
 * each one must still hash to the digest recorded when it was downloaded.
 * Offline: reads only the project.
 */
function vendoredFileDiagnostics(root: string, id: string, dir: string, rec: OriginRecord, entry: SourceLocation): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  for (const [path, digest] of Object.entries(rec.files ?? {})) {
    const file = join(root, dir, path);
    const rel = relative(root, file);
    if (!existsSync(file)) {
      out.push({
        code: "PB_VENDORED_FILE_MISSING",
        severity: "warning",
        entity: { kind: "definition", id },
        message: `${rel} was vendored with ${id}@${revisionLabel(rec.revision)} and is missing; restore it or run \`protoboard parts add ${id}@${rec.revision}\` again`,
        source: entry,
        validator: "protoboard/catalog",
      });
    } else if (sha256(readFileSync(file)) !== digest) {
      out.push({
        code: "PB_VENDORED_FILE_MISMATCH",
        severity: "error",
        entity: { kind: "definition", id },
        message: `${rel} does not match the digest recorded when ${id}@${revisionLabel(rec.revision)} was downloaded: vendored files are immutable; restore it with \`protoboard parts add ${id}@${rec.revision}\` or derive a local variant`,
        source: { file: rel },
        validator: "protoboard/catalog",
      });
    }
  }
  return out;
}

/** Resolve a package's root directory from the project (for package artifact bases). */
export function packageRoot(root: string, pkg: string): string | undefined {
  try {
    const req = createRequire(join(root, "package.json"));
    return dirname(req.resolve(`${pkg}/package.json`));
  } catch {
    // packages whose "exports" hide package.json: walk node_modules
    let dir = root;
    for (;;) {
      const p = join(dir, "node_modules", pkg);
      if (existsSync(join(p, "package.json"))) return p;
      const up = dirname(dir);
      if (up === dir) return undefined;
      dir = up;
    }
  }
}

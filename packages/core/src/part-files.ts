/**
 * One resolver for a part's body model and footprint files (PB-1174;
 * docs/specs/cad-and-footprint-sources.md §5). Every consumer that needs a
 * body file asks here: the build's model table, the viewer bundle, the
 * tscircuit and KiCad exports, the harness, enclosure and docs extensions.
 * None of them searches artifacts, caches or tool libraries on its own.
 *
 * Order of sources for a model (spec §5.1, README §2, the W1-B brief):
 *
 *   0. the project's pin in parts/sources.json (per instance, then per part):
 *      an imported file, a vendor file it fetched
 *   1. the part's own files: its body artifacts resolved against its origin
 *      (parts/local/<id>/, src/…, parts/catalog/<short>/), and the standard
 *      output of the capability provider bound to it
 *   2. library-fetched files in the per-machine cache: a catalog file that is
 *      not in the project (withheld, or not carried) found by the sha256
 *      parts/origins.json pins for it
 *   3. vendor files the project recorded (by vendor key: model.lcsc-C393939.step,
 *      model.kicad-<lib>-<name>.step), from parts/files/<short>/ or the machine
 *      cache. Fetching them needs the network and only `protoboard parts fetch`
 *      (or `build --fetch`) does it: the resolver itself never fetches
 *   4. a placeholder: an amber box sized from the footprint bounds or the
 *      package, written by the build under .protoboard/build/placeholders/
 *      and tagged `extras.protoboard.placeholder: true` (part-files-glb.ts)
 *
 * Trust tiers (spec §3.1): M1 a catalog body whose revision is verified or
 * official; M2 a vendor model paired with the footprint (LCSC/EasyEDA by
 * C-number); M3 a maker's model; M4 an unverified catalog body or a
 * project-local one (an imported file included); M5 KiCad's library; M6 a
 * parametric body from facts (ext-frame-cad's nominal fasteners); M7 a body
 * hand-modelled from the drawing (an ext-parts part-cad script); M8 a
 * placeholder. `design` is a designed module's own generated body (a frame,
 * an enclosure, a harness, a board): the design itself, not a part model.
 *
 * Paths recorded in project files are project-relative with forward slashes
 * (paths.ts). Units: UHD is mm, Z-up; GLB files are glTF metres, Y-up; the
 * resolver records each file's own units and never converts geometry.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import type { ArtifactDef, ModuleDef } from "@deltarobotics/uhd";
import { stableStringify } from "./build.js";
import { readOrigins } from "./load.js";
import { isInsideReal, projectRelative, recordedPath } from "./paths.js";
import { definitionTrust } from "./project-parts.js";
import type { Project } from "./project.js";
import type { ProjectDiagnostic } from "./types.js";
import { placeholderGlb } from "./part-files-glb.js";

export const PART_SOURCES_FILE = "parts/sources.json";
export const PART_SOURCES_SCHEMA = "protoboard.part-sources/v0";
export const MODEL_TABLE_SCHEMA = "protoboard.models/v0";
export const MODEL_SIDECAR_SCHEMA = "protoboard.model-sidecar/v0";
/** Where fetched vendor files live in a project: gitignored by default (DEFAULT, plan.md overnight defaults; PB-1069 Q6 open). */
export const PART_FILES_DIR = "parts/files";
/** Placeholder bodies the build writes. */
export const PLACEHOLDER_DIR = ".protoboard/build/placeholders";
export const PART_FILES_VALIDATOR = "protoboard/part-files";

/** Largest JSON record the resolver parses (parts/sources.json, a sidecar, the hash cache). */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

export type PartFileKind = "model" | "footprint";
export type ModelTier = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "design";
export type FootprintTier = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

/** Where the chosen file came from. */
export type PartFileSource = "pin" | "artifact" | "provider" | "cache" | "vendor" | "placeholder" | "none";

/** FileTerms (UHD library protocol §4.5), as the sources record keeps them. */
export interface PartFileTerms {
  distribution: "redistributable" | "internal" | "unknown";
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  summary?: string;
}

/** One file in parts/sources.json (spec §3.3, trimmed to what phase 1 uses). */
export interface SourceEntry {
  /** The vendor key (`lcsc-C393939`, `kicad-Package_TO_SOT_SMD-SOT-23`, `mpn-<maker>-<mpn>`), or `imported-<sha8>`. */
  id: string;
  kind: PartFileKind;
  /** step | glb | stl | 3mf | wrl | kicad_mod | easyeda-json */
  format: string;
  /** "sha256:<hex>" of the bytes the record pins. */
  sha256: string;
  size?: number;
  source: {
    type: "lcsc" | "kicad-lib" | "manufacturer" | "url" | "imported" | "library" | "generated";
    /** C-number, KiCad `lib:item`, maker part number. */
    id?: string;
    url?: string;
    /** Date (YYYY-MM-DD) the file was fetched or imported. */
    retrieved?: string;
    /** The bytes as downloaded, when converted. */
    sourceSha256?: string;
  };
  terms?: PartFileTerms;
  tier?: ModelTier | FootprintTier;
  /** Units of the file (mm for STEP, m for GLB). */
  units?: string;
  /** Project-relative: the copy in parts/files/<short>/ (gitignored), or an imported file the project keeps. Absent when cache-only. */
  path?: string;
  /** A viewer mesh made from this file (STEP → GLB), recorded with the sha256 of what it was made from. */
  derived?: { format: string; path: string; sha256: string; generatedFrom: string }[];
  chosenBy?: { kind: "person" | "agent" | "default"; who?: string; at?: string };
  /** The model aligned to this footprint, and how the source places it. */
  pairs?: string;
  placement?: { offset: [number, number, number]; rotate: [number, number, number] };
}

/** A whole-board ECAD STEP mapped onto the board's UHD instances (the import provider, PB-1143). */
export interface BoardStepMap {
  /** The source entry id of the board STEP. */
  step: string;
  /** Instance path (from the root) → the STEP component node it is drawn by, and how it was matched. */
  components: Record<string, { node: string; by: "designator" | "lcsc"; lcsc?: string }>;
  /** Component nodes no instance matched. */
  unmatchedNodes: string[];
  /** Board component instances no node matched. */
  unmatchedInstances: string[];
}

export interface PartSourcesRecord {
  files: SourceEntry[];
  /** The project's pins: the entry ids used per kind. */
  use?: Partial<Record<PartFileKind, string>>;
  /** Per-instance pins (instance path → entry ids). */
  instances?: Record<string, Partial<Record<PartFileKind, string>>>;
  /** A board's ECAD STEP and the component mapping it gives. */
  board?: BoardStepMap;
}

export interface PartSourcesFile {
  schema: typeof PART_SOURCES_SCHEMA;
  parts: Record<string, PartSourcesRecord>;
}

/** What a resolution chose for one part (and instance). */
export interface ResolvedPartFile {
  part: string;
  instance?: string;
  kind: PartFileKind;
  /** Absolute path of the chosen file; for a placeholder, where the build writes it. */
  file?: string;
  /** Machine-independent: project-relative, `package:<name>/<path>`, or `cache:sha256/<hex>`. */
  path?: string;
  format?: string;
  /** The definition's artifact id, when the file is one of its artifacts. */
  artifact?: string;
  units?: string;
  /** "sha256:<hex>", for files that exist. */
  sha256?: string;
  bytes?: number;
  tier: ModelTier | FootprintTier | "none";
  source: PartFileSource;
  provenance: {
    method: "library" | "generated" | "imported" | "download" | "placeholder" | "declared-placeholder" | "authored" | "provider";
    tool?: string;
    generatedFrom?: string;
    /** The sources-record entry, for pins and vendor files. */
    entry?: string;
    sourceType?: SourceEntry["source"]["type"];
    url?: string;
    retrieved?: string;
    terms?: PartFileTerms;
  };
  /** True for the resolver's amber box, and for a body its definition declares a placeholder (tag `placeholder`). */
  placeholder: boolean;
  /** Why it is a placeholder, and the box the build draws (mm, UHD frame). */
  placeholderInfo?: { reason: string; size_mm: [number, number, number]; heightSource: "package" | "footprint" | "default" | "declared"; sizeSource: "footprint" | "package" | "default" | "declared" };
  findings: ProjectDiagnostic[];
}

export interface ResolveOptions {
  /** What the caller can read, best first. Default: model ["glb", "step"], footprint ["kicad_mod"]. */
  formats?: string[];
  /** One of the definition's bodies (its STEP artifact id, as `assemble` names it), for multi-body parts. */
  body?: string;
  /** Footprint bounds from the provider (mm, length × width), for the placeholder's size. */
  footprintBounds?: [number, number];
  /** No placeholder: return source "none" instead. */
  noPlaceholder?: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

/** Characters a file name may not carry on Windows, and what replaces them. */
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f\s]+/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A vendor key slug that is a valid file name on Windows, macOS and Linux (no `< > : " / \ | ? *`, no trailing dot or space). */
export function fileSlug(text: string): string {
  let s = text.replace(UNSAFE_NAME, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").replace(/[-. ]+$/, "");
  if (!s) s = "x";
  if (RESERVED_NAMES.test(s)) s = `${s}_`;
  return s.slice(0, 120).replace(/[-. ]+$/, "");
}

/** The vendor key of a source: `lcsc-C393939`, `kicad-<lib>-<name>`, `mpn-<maker>-<mpn>`, `url-<sha8>`. */
export function vendorKey(source: { type: SourceEntry["source"]["type"]; id?: string; url?: string; maker?: string }): string {
  switch (source.type) {
    case "lcsc":
      return `lcsc-${fileSlug((source.id ?? "").toUpperCase())}`;
    case "kicad-lib":
      return `kicad-${fileSlug((source.id ?? "").replace(/:/g, "-"))}`;
    case "manufacturer":
      return `mpn-${fileSlug(`${source.maker ? `${source.maker}-` : ""}${source.id ?? ""}`)}`;
    default:
      return `${source.type}-${createHash("sha256").update(source.url ?? source.id ?? "").digest("hex").slice(0, 8)}`;
  }
}

/** The file name a vendor model takes in parts/files/<short>/: `model.<key>.<ext>`. */
export const vendorFileName = (key: string, format: string) => `model.${key}.${format.toLowerCase()}`;

/** A file's bytes as `sha256:<hex>`, read in chunks (files of hundreds of MB are hashed without being held in memory). */
export function sha256OfFile(file: string): string {
  const h = createHash("sha256");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return `sha256:${h.digest("hex")}`;
}

/** Read a JSON record, refusing one larger than `cap` bytes. */
export function readJsonCapped<T>(file: string, cap = MAX_RECORD_BYTES): T | undefined {
  if (!existsSync(file)) return undefined;
  const size = statSync(file).size;
  if (size > cap) throw new Error(`${file} is ${size} bytes, over the ${cap}-byte limit for a record`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

// ---------------------------------------------------------------------------
// Hashes: per process, and the build's cache keyed by size and mtime
// ---------------------------------------------------------------------------

interface HashEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}
const HASH_CACHE_FILE = ".protoboard/build/file-hashes.json";
const memo = new Map<string, HashEntry>();
const loadedCaches = new Set<string>();

function loadHashCache(root: string) {
  if (loadedCaches.has(root)) return;
  loadedCaches.add(root);
  try {
    const saved = readJsonCapped<{ files?: Record<string, HashEntry> }>(join(root, HASH_CACHE_FILE));
    for (const [rel, e] of Object.entries(saved?.files ?? {})) if (!memo.has(resolvePath(root, rel))) memo.set(resolvePath(root, rel), e);
  } catch {
    // a broken cache only costs re-hashing
  }
}

/** sha256 and size of a file, from the cache when its size and mtime are unchanged. */
export function fileDigest(file: string, root?: string): { sha256: string; bytes: number } | undefined {
  if (root) loadHashCache(root);
  let st;
  try {
    st = statSync(file);
  } catch {
    return undefined;
  }
  if (!st.isFile()) return undefined;
  const hit = memo.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return { sha256: hit.sha256, bytes: st.size };
  const sha256 = sha256OfFile(file);
  memo.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha256 });
  return { sha256, bytes: st.size };
}

/** Write the build's hash cache: the project files hashed in this process. */
function saveHashCache(root: string) {
  const files: Record<string, HashEntry> = {};
  for (const [abs, e] of memo) if (isInsideReal(root, abs)) files[projectRelative(root, abs)] = e;
  const file = join(root, HASH_CACHE_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stableStringify({ schema: "protoboard.file-hashes/v0", files }));
}

// ---------------------------------------------------------------------------
// The per-machine cache (spec §4.1)
// ---------------------------------------------------------------------------

/** The machine's content-addressed file store: PROTOBOARD_CACHE_DIR, else the platform's cache folder. */
export function machineCacheDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.PROTOBOARD_CACHE_DIR) return resolvePath(env.PROTOBOARD_CACHE_DIR);
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "protoboard", "Cache", "files");
  if (platform === "darwin") return join(homedir(), "Library", "Caches", "protoboard", "files");
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "protoboard", "files");
}

/** Where the cache keeps the bytes of a sha256 (`sha256:<hex>` or bare hex): `sha256/<2 hex>/<62 hex>`. */
export function cachePath(sha: string, dir = machineCacheDir()): string | undefined {
  const hex = sha.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  return join(dir, "sha256", hex.slice(0, 2), hex.slice(2));
}

/** The cached copy of a sha256, when it is there and its bytes still match. */
export function cachedFile(sha: string, dir = machineCacheDir()): string | undefined {
  const f = cachePath(sha, dir);
  if (!f || !existsSync(f)) return undefined;
  return fileDigest(f)?.sha256 === `sha256:${sha.replace(/^sha256:/, "").toLowerCase()}` ? f : undefined;
}

/** Put bytes into the machine cache (atomic rename) and index them under a source key. Returns the cached path. */
export function putInCache(bytes: Buffer, key: string, record: Record<string, unknown>, dir = machineCacheDir()): { file: string; sha256: string } {
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const file = cachePath(sha256, dir)!;
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
  }
  const indexFile = join(dir, "index.json");
  let index: { schema: string; entries: Record<string, unknown> } = { schema: "protoboard.file-cache/v0", entries: {} };
  try {
    index = readJsonCapped(indexFile) ?? index;
  } catch {
    // a broken index is rebuilt from what is added next; the bytes stay addressable by sha256
  }
  index.entries[key] = { ...record, sha256, size: bytes.length };
  mkdirSync(dir, { recursive: true });
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
  return { file, sha256 };
}

// ---------------------------------------------------------------------------
// parts/sources.json
// ---------------------------------------------------------------------------

/** The project's sources record (an empty one when there is none). Throws on a record over the size cap or of another schema. */
const sourcesMemo = new Map<string, { key: string; data: PartSourcesFile }>();
export function readPartSources(root: string): PartSourcesFile {
  const file = join(root, PART_SOURCES_FILE);
  let key = "none";
  try {
    const st = statSync(file);
    key = `${st.size}:${st.mtimeMs}`;
  } catch {
    // no record
  }
  const hit = sourcesMemo.get(root);
  if (hit && hit.key === key) return structuredClone(hit.data);
  const data = readPartSourcesFile(file);
  sourcesMemo.set(root, { key, data });
  return structuredClone(data);
}

function readPartSourcesFile(file: string): PartSourcesFile {
  const raw = readJsonCapped<PartSourcesFile>(file);
  if (!raw) return { schema: PART_SOURCES_SCHEMA, parts: {} };
  if (raw.schema !== PART_SOURCES_SCHEMA) throw new Error(`${PART_SOURCES_FILE}: schema ${JSON.stringify(raw.schema)} is not ${PART_SOURCES_SCHEMA}`);
  return { schema: PART_SOURCES_SCHEMA, parts: raw.parts ?? {} };
}

export function writePartSources(root: string, data: PartSourcesFile): string {
  const file = join(root, PART_SOURCES_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stableStringify(data));
  sourcesMemo.delete(root);
  return file;
}

/** Add or replace an entry (by id) for a part, optionally pinning it. */
export function recordSourceEntry(data: PartSourcesFile, part: string, entry: SourceEntry, pin?: { instance?: string }): PartSourcesFile {
  const rec = (data.parts[part] ??= { files: [] });
  rec.files = [...rec.files.filter((f) => f.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
  if (pin) {
    if (pin.instance) ((rec.instances ??= {})[pin.instance] ??= {})[entry.kind] = entry.id;
    else (rec.use ??= {})[entry.kind] = entry.id;
  }
  return data;
}

/** A project-relative path from a record, resolved only when it stays inside the project. */
function projectFile(root: string, rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  const p = recordedPath(rel);
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) return undefined;
  const abs = resolvePath(root, p);
  return isInsideReal(root, abs) ? abs : undefined;
}

// ---------------------------------------------------------------------------
// Choosing a definition's body artifact (the one rule every consumer used to repeat)
// ---------------------------------------------------------------------------

/**
 * The definition's body artifact in one of `formats` (best first). With
 * `body` (a STEP artifact id, as `assemble` names a multi-body part's
 * placement): the artifact that is that body or was generated from it, in
 * any role, as the viewer and the docs always matched it. Without: the
 * first `role: "body"` artifact of the best format.
 */
export function bodyArtifact(def: ModuleDef, formats: string[] = ["glb"], body?: string): ArtifactDef | undefined {
  const arts = def.artifacts ?? [];
  for (const f of formats) {
    if (!body) {
      const hit = arts.find((a) => a.role === "body" && a.format === f);
      if (hit) return hit;
      continue;
    }
    const named = arts.filter((a) => a.format === f && (a.id === body || a.provenance?.generatedFrom === body));
    // the body itself before anything else made from it (an interface's own mesh is never a body)
    const hit = named.find((a) => a.role === "body") ?? named.find((a) => a.role !== "interface");
    if (hit) return hit;
  }
  return undefined;
}

/** The provider bound to a module, when it is ready. */
const bindingOf = (p: Project, def: string) => p.capabilities.find((b) => b.module === def && !b.problem);

/** The standard output file a bound provider writes for a format (`out/board.glb`, `out/body.step`). */
function providerOutput(p: Project, def: string, format: string): string | undefined {
  const b = bindingOf(p, def);
  if (!b) return undefined;
  const name = b.capability === "circuit" ? `board.${format}` : b.capability === "cad" ? `body.${format}` : undefined;
  if (!name) return undefined;
  const f = join(p.root, b.out, name);
  return existsSync(f) ? f : undefined;
}

const trustCache = new WeakMap<Project, ReturnType<typeof definitionTrust>>();
const trustOf = (p: Project) => {
  let t = trustCache.get(p);
  if (!t) {
    try {
      t = definitionTrust(p);
    } catch {
      t = {};
    }
    trustCache.set(p, t);
  }
  return t;
};

/** Whether a definition says its own body is a stand-in (tag `placeholder`). */
export const declaredPlaceholder = (def: ModuleDef | undefined) => !!def?.tags?.some((t) => t.toLowerCase() === "placeholder");

/** The tier of a definition's own body, from where the definition and its body come from. */
export function ownBodyTier(p: Project, def: string, artifact?: ArtifactDef): { tier: ModelTier; method: ResolvedPartFile["provenance"]["method"]; tool?: string } {
  const rec = p.definitions.get(def);
  if (!rec) return { tier: "M4", method: "library" };
  if (declaredPlaceholder(rec.def)) return { tier: "M8", method: "declared-placeholder" };
  if (rec.origin.kind === "catalog") {
    const t = trustOf(p)[def]?.trust;
    return { tier: t === "verified" || t === "official" ? "M1" : "M4", method: "library" };
  }
  const b = bindingOf(p, def);
  const tool = artifact?.provenance?.tool ?? b?.provider;
  if (b?.provider === "@protoboardai/ext-parts" && b.constraints.import) return { tier: rec.origin.tier === "project-specific" ? "design" : "M4", method: "imported", tool };
  if (rec.origin.tier === "project-researched") {
    if (b?.provider === "@protoboardai/ext-frame-cad" || /ext-frame-cad/.test(tool ?? "")) return { tier: "M6", method: "generated", tool };
    if (b?.provider === "@protoboardai/ext-parts" || /part-cad|build123d/.test(tool ?? "")) return { tier: "M7", method: "authored", tool };
    return { tier: "M4", method: artifact?.provenance?.generatedFrom ? "generated" : "library", tool };
  }
  return { tier: "design", method: b ? "provider" : artifact?.provenance?.generatedFrom ? "generated" : "library", tool };
}

/** Tier of a vendor source entry (spec §3.1). */
const vendorTier = (e: SourceEntry): ModelTier | FootprintTier =>
  e.tier ?? (e.kind === "footprint" ? (e.source.type === "lcsc" ? "F3" : e.source.type === "manufacturer" ? "F2" : "F4") : e.source.type === "lcsc" ? "M2" : e.source.type === "manufacturer" ? "M3" : e.source.type === "kicad-lib" ? "M5" : e.source.type === "imported" ? "M4" : "M3");

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a part's (or an instance's) model or footprint. `ref` is an
 * instance path, a definition id, or `{ part, instance }`. Never fetches,
 * never writes: a placeholder's file is where the build will write it
 * (`writeModelTable`, `ensurePlaceholder`).
 */
export function resolvePartFile(project: Project, ref: string | { part: string; instance?: string }, kind: PartFileKind = "model", options: ResolveOptions = {}): ResolvedPartFile {
  const p = project;
  let part: string;
  let instance: string | undefined;
  if (typeof ref === "string") {
    const inst = p.instances.find((i) => i.path === ref);
    part = inst ? inst.definition : ref;
    instance = inst?.path;
  } else {
    part = ref.part;
    instance = ref.instance;
  }
  const def = p.lookup(part);
  const formats = options.formats ?? (kind === "model" ? ["glb", "step"] : ["kicad_mod"]);
  const base = { part, ...(instance !== undefined ? { instance } : {}), kind };
  const findings: ProjectDiagnostic[] = [];
  let sources: PartSourcesFile;
  try {
    sources = readPartSources(p.root);
  } catch (e) {
    sources = { schema: PART_SOURCES_SCHEMA, parts: {} };
    findings.push({ code: "PB_PART_SOURCES_INVALID", severity: "error", entity: { kind: "project", id: p.name }, message: (e as Error).message, source: { file: PART_SOURCES_FILE }, validator: PART_FILES_VALIDATOR });
  }
  const rec = sources.parts[part];
  const digestOf = (file: string) => fileDigest(file, p.root);
  const rel = (abs: string) => (isInsideReal(p.root, abs) ? projectRelative(p.root, abs) : `cache:${projectRelative(machineCacheDir(), abs)}`);

  // an entry's local bytes in a wanted format: its copy in the project, a derived mesh, else the machine cache
  const entryFile = (e: SourceEntry): { file: string; format: string; sha256: string; bytes: number; derived?: boolean } | "absent" | undefined => {
    let wanted = false;
    for (const f of formats) {
      if (e.format === f || e.derived?.some((d) => d.format === f)) wanted = true;
      if (e.format === f) {
        const local = projectFile(p.root, e.path);
        if (local && existsSync(local)) {
          const d = digestOf(local)!;
          if (d.sha256 !== e.sha256) {
            findings.push({ code: "PB_PART_FILE_MISMATCH", severity: "error", entity: { kind: "definition", id: part }, message: `${part}: ${e.path} no longer matches the sha256 ${PART_SOURCES_FILE} pins for ${e.id} (${e.sha256.slice(0, 19)}…, now ${d.sha256.slice(0, 19)}…); fetch it again (\`protoboard parts fetch ${part}\`) or record the new file`, source: { file: PART_SOURCES_FILE }, validator: PART_FILES_VALIDATOR });
            continue;
          }
          return { file: local, format: f, ...d };
        }
        const cached = cachedFile(e.sha256);
        if (cached) return { file: cached, format: f, sha256: e.sha256, bytes: statSync(cached).size };
      }
      const derived = e.derived?.find((d) => d.format === f);
      if (derived) {
        const local = projectFile(p.root, derived.path);
        if (local && existsSync(local) && digestOf(local)!.sha256 === derived.sha256) return { file: local, format: f, ...digestOf(local)!, derived: true };
        const cached = cachedFile(derived.sha256);
        if (cached) return { file: cached, format: f, sha256: derived.sha256, bytes: statSync(cached).size, derived: true };
      }
    }
    // in a format the caller cannot read: not this entry's question
    return wanted ? "absent" : undefined;
  };

  const fromEntry = (e: SourceEntry, source: PartFileSource): ResolvedPartFile | undefined => {
    if (e.kind !== kind) return undefined;
    const hit = entryFile(e);
    if (!hit) return undefined;
    if (hit === "absent") {
      findings.push({ code: "PB_PART_FILE_NOT_CACHED", severity: "warning", entity: { kind: "definition", id: part }, message: `${part}: ${e.id} (${e.format}${e.derived?.length ? `, ${e.derived.map((d) => d.format).join(", ")}` : ""}) is recorded in ${PART_SOURCES_FILE} but is not on this machine${formats.length ? ` in ${formats.join(" or ")}` : ""}; \`protoboard parts fetch ${part}\` restores it`, source: { file: PART_SOURCES_FILE }, validator: PART_FILES_VALIDATOR });
      return undefined;
    }
    const imported = e.source.type === "imported";
    return {
      ...base,
      file: hit.file,
      path: rel(hit.file),
      format: hit.format,
      ...(hit.format === "glb" ? { units: "m" } : e.units ? { units: e.units } : {}),
      sha256: hit.sha256,
      bytes: hit.bytes,
      tier: imported && p.definitions.get(part)?.origin.tier === "project-specific" ? "design" : vendorTier(e),
      source,
      provenance: {
        method: imported ? "imported" : "download",
        entry: e.id,
        sourceType: e.source.type,
        ...(e.source.url ? { url: e.source.url } : {}),
        ...(e.source.retrieved ? { retrieved: e.source.retrieved } : {}),
        ...(e.terms ? { terms: e.terms } : {}),
        ...(hit.derived ? { generatedFrom: e.id } : {}),
      },
      placeholder: false,
      findings,
    };
  };

  // 0. the project's pins: per instance, then per part
  const pinned = (instance !== undefined ? rec?.instances?.[instance]?.[kind] : undefined) ?? rec?.use?.[kind];
  if (pinned) {
    const e = rec!.files.find((f) => f.id === pinned);
    if (!e) findings.push({ code: "PB_PART_SOURCES_INVALID", severity: "error", entity: { kind: "definition", id: part }, message: `${part}: ${PART_SOURCES_FILE} pins ${kind} ${pinned}, which it does not list`, source: { file: PART_SOURCES_FILE }, validator: PART_FILES_VALIDATOR });
    else {
      const r = fromEntry(e, "pin");
      if (r) return r;
    }
  }

  if (kind === "footprint") {
    // phase 1: a footprint comes from the provider's own land-pattern table (F1/F5) unless the project recorded one
    for (const e of rec?.files ?? []) {
      const r = e.kind === "footprint" ? fromEntry(e, "vendor") : undefined;
      if (r) return r;
    }
    return { ...base, tier: "none", source: "provider", provenance: { method: "provider" }, placeholder: false, findings };
  }

  // 1. the part's own files
  if (def) {
    const declared = declaredPlaceholder(def);
    // a multi-body part's body is named; otherwise a bound provider's standard output comes first (what it last exported)
    if (!options.body) {
      for (const f of formats) {
        const out = providerOutput(p, part, f);
        if (!out) continue;
        const art = (def.artifacts ?? []).find((a) => a.filePath && resolvePath(p.root, a.filePath) === out);
        const t = ownBodyTier(p, part, art);
        const d = digestOf(out)!;
        return {
          ...base,
          file: out,
          path: rel(out),
          format: f,
          ...(art ? { artifact: art.id } : {}),
          units: f === "glb" ? "m" : "mm",
          ...d,
          tier: t.tier,
          source: "provider",
          provenance: { method: t.method === "library" ? "provider" : t.method, tool: t.tool ?? bindingOf(p, part)?.provider },
          placeholder: declared,
          ...(declared ? { placeholderInfo: declaredInfo(def) } : {}),
          findings,
        };
      }
    }
    for (const f of formats) {
      const art = bodyArtifact(def, [f], options.body);
      if (!art) continue;
      const resolved = p.artifacts.find((a) => a.definition === part && a.id === art.id);
      const t = ownBodyTier(p, part, art);
      const result = (file: string, source: PartFileSource, d: { sha256: string; bytes: number }): ResolvedPartFile => ({
        ...base,
        file,
        path: resolved?.base.startsWith("package:") && source === "artifact" ? `${resolved.base}/${art.filePath}` : rel(file),
        format: f,
        artifact: art.id,
        ...(art.units ? { units: art.units } : f === "glb" ? { units: "m" } : {}),
        ...d,
        tier: t.tier,
        source,
        provenance: { method: t.method, ...(t.tool ? { tool: t.tool } : {}), ...(art.provenance?.generatedFrom ? { generatedFrom: art.provenance.generatedFrom } : {}) },
        placeholder: declared,
        ...(declared ? { placeholderInfo: declaredInfo(def) } : {}),
        findings,
      });
      if (resolved?.resolved && resolved.present === true && existsSync(resolved.resolved)) return result(resolved.resolved, "artifact", digestOf(resolved.resolved)!);
      // 2. a library file that is not in the project: the machine cache, by the sha256 origins.json pins
      const rc = p.definitions.get(part);
      if (rc?.origin.kind === "catalog" && art.filePath) {
        const pin = catalogPin(p.root, part, art.filePath, rc.origin.artifactBase.kind === "vendored" ? rc.origin.artifactBase.strip : undefined);
        const cached = pin ? cachedFile(pin) : undefined;
        if (cached) return result(cached, "cache", { sha256: pin!, bytes: statSync(cached).size });
      }
    }
  }

  // 3. vendor files the project recorded for the part (not pinned): best tier first
  const vendor = (rec?.files ?? []).filter((e) => e.kind === kind && e.id !== pinned).sort((a, b) => String(vendorTier(a)).localeCompare(String(vendorTier(b))));
  for (const e of vendor) {
    const r = fromEntry(e, "vendor");
    if (r) return r;
  }

  // 4. the placeholder
  if (options.noPlaceholder || !formats.includes("glb")) return { ...base, tier: "none", source: "none", provenance: { method: "placeholder" }, placeholder: false, findings };
  const info = placeholderBox(def, options.footprintBounds);
  const file = join(p.root, PLACEHOLDER_DIR, `${fileSlug(part)}.glb`);
  return { ...base, file, path: projectRelative(p.root, file), format: "glb", units: "m", tier: "M8", source: "placeholder", provenance: { method: "placeholder", tool: "@protoboardai/core part-files" }, placeholder: true, placeholderInfo: info, findings };
}

function declaredInfo(def: ModuleDef): NonNullable<ResolvedPartFile["placeholderInfo"]> {
  const b = placeholderBox(def);
  return { ...b, reason: `${def.id} is tagged placeholder: its body is a stand-in for the real part`, heightSource: "declared", sizeSource: "declared" };
}

/** The sha256 parts/origins.json pins for a catalog file (its path under the artifact base, with the vendored prefix stripped). */
function catalogPin(root: string, part: string, filePath: string, strip?: string): string | undefined {
  try {
    const files = readOrigins(root)?.definitions?.[part]?.files;
    if (!files) return undefined;
    const pin = files[filePath] ?? (strip ? files[`${strip}${filePath}`] : undefined);
    return pin ? (pin.startsWith("sha256:") ? pin : `sha256:${pin}`) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The placeholder box (mm, UHD frame: length along X, width along Y,
 * height up +Z from the mounting face): XY from the footprint bounds when
 * the provider gives them, else the package's `dimensions_mm`; Z from the
 * package height, else 1 mm (flagged).
 */
export function placeholderBox(def: ModuleDef | undefined, footprint?: [number, number]): NonNullable<ResolvedPartFile["placeholderInfo"]> {
  const dims = def?.domains?.find((d) => d.domain === "mechanical" && d.dimensions_mm)?.dimensions_mm;
  const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  const fromFootprint = footprint && pos(footprint[0]) && pos(footprint[1]);
  const fromPackage = pos(dims?.length) && pos(dims?.width);
  const [l, w] = fromFootprint ? footprint! : fromPackage ? [dims!.length!, dims!.width!] : [10, 10];
  const h = pos(dims?.height) ? dims!.height! : 1;
  return {
    reason: `${def?.id ?? "the part"} has no body model at any tier`,
    size_mm: [l, w, h],
    sizeSource: fromFootprint ? "footprint" : fromPackage ? "package" : "default",
    heightSource: pos(dims?.height) ? "package" : "default",
  };
}

// ---------------------------------------------------------------------------
// Which instances need a body, and the model table
// ---------------------------------------------------------------------------

/** Definitions that are not drawn (solder, tape, threadlocker): no body is expected. */
const NOT_DRAWN_TAGS = new Set(["consumable", "assembly-material", "material", "no-body"]);
export const expectsBody = (def: ModuleDef) => !def.tags?.some((t) => NOT_DRAWN_TAGS.has(t.toLowerCase())) && !def.categories?.some((c) => c === "material" || c.startsWith("material."));

const hasOwnBody = (p: Project, def: ModuleDef) => !!bodyArtifact(def, ["glb", "step"]) || !!providerOutput(p, def.id, "glb");

export interface ModelTableEntry {
  instance: string;
  part: string;
  /** The project-relative (or `package:`/`cache:`) path of the file the viewer draws. */
  file?: string;
  format?: string;
  artifact?: string;
  sha256?: string;
  bytes?: number;
  units?: string;
  tier: string;
  source: PartFileSource;
  provenance: ResolvedPartFile["provenance"];
  placeholder: boolean;
  placeholderInfo?: ResolvedPartFile["placeholderInfo"];
  /** The same part's STEP, for the PCB and STEP exports: same resolver, same bytes. */
  step?: { file: string; sha256: string; bytes: number; tier: string };
  /** The instance is drawn inside an ancestor's own body (a board's component in its GLB or STEP). */
  drawnBy?: string;
  /** The ancestor's board STEP component node that draws it (import provider mapping). */
  node?: { name: string; by: "designator" | "lcsc"; lcsc?: string };
}

export interface ModelTable {
  schema: typeof MODEL_TABLE_SCHEMA;
  counts: { instances: number; resolved: number; placeholders: number; missing: number; drawnByHolder: number; files: number };
  instances: ModelTableEntry[];
  boards?: Record<string, BoardStepMap & { holder: string; part: string }>;
}

/**
 * The model table: every instance that is drawn as a body, what the
 * resolver chose for it, and the instances drawn inside a holder's body
 * (a board's components) with the STEP node that draws them when the board
 * was imported from an ECAD STEP.
 */
export function modelTable(p: Project): ModelTable {
  const entries: ModelTableEntry[] = [];
  const holders: string[] = [];
  let sources: PartSourcesFile = { schema: PART_SOURCES_SCHEMA, parts: {} };
  try {
    sources = readPartSources(p.root);
  } catch {
    // reported by check (PB_PART_SOURCES_INVALID)
  }
  const boards: NonNullable<ModelTable["boards"]> = {};
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const children = new Set(p.instances.map((i) => i.parent).filter((x): x is string => x !== undefined));
  const holderOf = (path: string): string | undefined => holders.filter((h) => path.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];
  // parents before children
  for (const inst of [...p.instances].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))) {
    if (inst.path === "") continue;
    const def = p.lookup(inst.definition);
    if (!def) continue;
    const holder = holderOf(inst.path);
    if (holder !== undefined) {
      if (children.has(inst.path) || !expectsBody(def)) continue;
      const map = boards[holder];
      const node = map?.components[inst.path];
      entries.push({ instance: inst.path, part: inst.definition, tier: "design", source: "none", provenance: { method: "provider" }, placeholder: false, drawnBy: holder, ...(node ? { node: { name: node.node, by: node.by, ...(node.lcsc ? { lcsc: node.lcsc } : {}) } } : {}) });
      continue;
    }
    const own = hasOwnBody(p, def);
    if (children.has(inst.path) && !own) continue; // an assembly, a group or a hardware kit: its contents are drawn
    if (!expectsBody(def) || inst.kind === "group") continue;
    // a harness's body is its routed cable (ext-harness-cad, which reports an unrouted one itself): no box for it (DEFAULT)
    if (inst.kind === "harness" && !own) continue;
    const r = resolvePartFile(p, { part: inst.definition, instance: inst.path }, "model", { formats: ["glb"] });
    const step = resolvePartFile(p, { part: inst.definition, instance: inst.path }, "model", { formats: ["step"], noPlaceholder: true });
    entries.push({
      instance: inst.path,
      part: inst.definition,
      ...(r.path ? { file: r.path } : {}),
      ...(r.format ? { format: r.format } : {}),
      ...(r.artifact ? { artifact: r.artifact } : {}),
      ...(r.sha256 ? { sha256: r.sha256, bytes: r.bytes } : {}),
      ...(r.units ? { units: r.units } : {}),
      tier: r.tier,
      source: r.source,
      provenance: r.provenance,
      placeholder: r.placeholder,
      ...(r.placeholderInfo ? { placeholderInfo: r.placeholderInfo } : {}),
      ...(step.sha256 && step.path ? { step: { file: step.path, sha256: step.sha256, bytes: step.bytes!, tier: step.tier } } : {}),
    });
    if (children.has(inst.path) && own) {
      holders.push(inst.path);
      const map = sources.parts[inst.definition]?.board;
      if (map) {
        // the record keys components by their path below the board; the table by the full instance path
        const components: BoardStepMap["components"] = {};
        for (const [k, v] of Object.entries(map.components)) components[`${inst.path}/${k}`] = v;
        boards[inst.path] = { ...map, components, unmatchedInstances: map.unmatchedInstances.map((k) => `${inst.path}/${k}`), holder: inst.path, part: inst.definition };
      }
    }
  }
  void byPath;
  const drawn = entries.filter((e) => !e.drawnBy);
  return {
    schema: MODEL_TABLE_SCHEMA,
    counts: {
      instances: drawn.length,
      resolved: drawn.filter((e) => !e.placeholder && e.source !== "none").length,
      placeholders: drawn.filter((e) => e.placeholder).length,
      missing: drawn.filter((e) => e.source === "placeholder" || e.source === "none").length,
      drawnByHolder: entries.length - drawn.length,
      files: new Set(drawn.map((e) => e.sha256).filter(Boolean)).size,
    },
    instances: entries,
    ...(Object.keys(boards).length ? { boards } : {}),
  };
}

/** Write the placeholder GLBs the table names (one per part) and the build's hash cache. Returns the placeholders written. */
export function writeModelFiles(p: Project, table: ModelTable): string[] {
  const written: string[] = [];
  const done = new Set<string>();
  const draws = projectHas3d(p);
  for (const e of table.instances) {
    if (!draws || e.source !== "placeholder" || !e.file || done.has(e.file)) continue;
    done.add(e.file);
    const abs = join(p.root, e.file);
    const bytes = placeholderGlb({ name: e.part, size_mm: e.placeholderInfo!.size_mm, extras: { placeholder: true, part: e.part, tier: "M8", reason: e.placeholderInfo!.reason, heightSource: e.placeholderInfo!.heightSource, sizeSource: e.placeholderInfo!.sizeSource } });
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || !readFileSync(abs).equals(bytes)) writeFileSync(abs, bytes);
    written.push(e.file);
  }
  // the placeholders now exist: their digests go into the table
  for (const e of table.instances) {
    if (e.source !== "placeholder" || !e.file) continue;
    const d = fileDigest(join(p.root, e.file), p.root);
    if (d) Object.assign(e, d);
  }
  table.counts.files = new Set(table.instances.filter((e) => !e.drawnBy).map((e) => e.sha256).filter(Boolean)).size;
  saveHashCache(p.root);
  return written;
}

/** Make sure a placeholder result's file exists (for a consumer that needs it outside the build). */
export function ensurePlaceholder(r: ResolvedPartFile): string | undefined {
  if (r.source !== "placeholder" || !r.file || !r.placeholderInfo) return r.file;
  if (!existsSync(r.file)) {
    mkdirSync(dirname(r.file), { recursive: true });
    writeFileSync(r.file, placeholderGlb({ name: r.part, size_mm: r.placeholderInfo.size_mm, extras: { placeholder: true, part: r.part, tier: "M8", reason: r.placeholderInfo.reason, heightSource: r.placeholderInfo.heightSource, sizeSource: r.placeholderInfo.sizeSource } }));
  }
  return r.file;
}

// ---------------------------------------------------------------------------
// check: protoboard/part-files
// ---------------------------------------------------------------------------

/**
 * The model findings (spec §6) for every instance drawn as a body:
 * PB_MODEL_MISSING (warning) per instance with no body at any tier,
 * PB_MODEL_PLACEHOLDER (info) per instance whose body is a declared
 * stand-in, and the record's own findings (a pinned file that changed, a
 * recorded file not on this machine). Runs only in a project that has 3D
 * bodies at all (one body artifact or a bound cad/circuit provider), so a
 * purely electrical project is not told every part lacks a model.
 */
/** Whether a project draws in 3D at all: a used definition with a body, or a bound cad or circuit provider. */
export function projectHas3d(p: Project): boolean {
  const used = new Set(p.instances.map((i) => i.definition));
  return (
    [...used].some((id) => {
      const d = p.lookup(id);
      return !!d && !!bodyArtifact(d, ["glb", "step"]);
    }) || p.capabilities.some((b) => b.capability === "cad" || b.capability === "circuit")
  );
}

export function partFileDiagnostics(p: Project): { diagnostics: ProjectDiagnostic[]; ran: boolean; reason?: string } {
  if (!projectHas3d(p)) return { diagnostics: [], ran: false, reason: "no body models in the project" };
  const out: ProjectDiagnostic[] = [];
  const seen = new Set<string>();
  const table = modelTable(p);
  for (const e of table.instances) {
    if (e.drawnBy) continue;
    if (e.source === "placeholder" || e.source === "none") {
      out.push({
        code: "PB_MODEL_MISSING",
        severity: "warning",
        entity: { kind: "instance", id: e.instance },
        message: `${e.instance} (${e.part}) has no body model at any tier; the viewer draws an amber placeholder box ${e.placeholderInfo ? `${e.placeholderInfo.size_mm.map((v) => +v.toFixed(2)).join(" x ")} mm (size from ${e.placeholderInfo.sizeSource}, height from ${e.placeholderInfo.heightSource})` : ""}. Find a source before modelling one: the part's library revision, its LCSC C-number (\`protoboard parts fetch ${e.part} --lcsc <C-number>\`), the maker's STEP, or an existing file (\`protoboard parts import <file> --part ${e.part}\`)`,
        source: p.definitions.get(e.part)?.origin.source,
        validator: PART_FILES_VALIDATOR,
      });
    } else if (e.placeholder) {
      out.push({ code: "PB_MODEL_PLACEHOLDER", severity: "info", entity: { kind: "instance", id: e.instance }, message: `${e.instance} (${e.part}): its body is a declared placeholder (the definition is tagged placeholder), drawn as one and counted as one`, source: p.definitions.get(e.part)?.origin.source, validator: PART_FILES_VALIDATOR });
    }
    const r = resolvePartFile(p, { part: e.part, instance: e.instance }, "model", { formats: ["glb"] });
    for (const f of r.findings) {
      const key = `${f.code}:${f.message}`;
      if (!seen.has(key)) out.push(f), seen.add(key);
    }
  }
  return { diagnostics: out, ran: true };
}

// ---------------------------------------------------------------------------
// Vendor files in the project: the gitignore entry and sidecars
// ---------------------------------------------------------------------------

/** The lines a project's .gitignore gets so fetched vendor bytes are never committed (sidecars, numbers only, may be). */
export const PART_FILES_IGNORE = [`# vendor model files fetched by \`protoboard parts fetch\`: never committed (vendor terms; DEFAULT, PB-1069 Q6)`, `${PART_FILES_DIR}/**/model.*`, `!${PART_FILES_DIR}/**/model.*.json`];

/** Add the vendor-files ignore lines to the project's .gitignore when missing. Returns whether it changed. */
export function ensurePartFilesIgnored(root: string): boolean {
  const file = join(root, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/).some((l) => l.trim() === PART_FILES_IGNORE[1])) return false;
  writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${PART_FILES_IGNORE.join("\n")}\n`);
  return true;
}

/** The sidecar written beside a vendor file (`<file>.json`): the record's echo, so a copied folder still says where its bytes came from. */
export function modelSidecar(e: SourceEntry, part: string): Record<string, unknown> {
  return {
    schema: MODEL_SIDECAR_SCHEMA,
    key: e.id,
    part,
    format: e.format,
    sha256: e.sha256,
    ...(e.size !== undefined ? { bytes: e.size } : {}),
    units: e.units ?? (e.format === "glb" ? "m" : "mm"),
    upAxis: e.format === "glb" ? "+Y" : "+Z",
    source: e.source,
    terms: e.terms ?? { distribution: "unknown" },
    ...(e.tier ? { tier: e.tier } : {}),
  };
}

export const partFilesDir = (part: string) => `${PART_FILES_DIR}/${fileSlug(part)}`;

/** Today as YYYY-MM-DD: the `retrieved` date of a fetch or import. */
export const isoToday = today;

/**
 * Atlas, the project index (docs/specs/atlas.md): its types, the kind table,
 * the file classifier and the projection a view draws. Browser-safe: no Node
 * imports, so a shell can use it (`@protoboardai/core/atlas`).
 *
 * The index itself is built by `./build.ts` (Node) and checked for freshness
 * by `./fresh.ts`.
 */
import type { Instance, PartTier } from "../types.js";

export const ATLAS_SCHEMA = "protoboard.atlas/v0";
export const ATLAS_FILE = ".protoboard/build/atlas.json";
/** The key of display.json that holds the Atlas layout (stripped from the UHD bundle). */
export const ATLAS_DISPLAY_KEY = "atlas";

export type FileKind = "concept" | "render" | "photo" | "image" | "model" | "cad" | "board" | "doc" | "data" | "firmware" | "other";
export type AtlasKind = "module" | "part" | FileKind;
export type KindSource = "tag" | "artifact" | "extension" | "path" | "operation";

export type FailReason =
  | "STAT_FAILED" | "READ_FAILED" | "LOCKED" | "PERMISSION_DENIED"
  | "BROKEN_LINK" | "OUTSIDE_PROJECT" | "UNSAFE_PATH" | "NAME_UNREADABLE";
export type NodeStatus = "ok" | "missing" | "remote" | "unused" | "failed";
export type CensusStatus = "linked" | "unlinked" | "failed";
export type EdgeType = "contains" | "uses" | "has" | "made-from" | "link" | "harness";

/** Where a creation time came from (docs/specs/atlas.md, "Creation times"): the commit that added the file, its birth time, or its mtime when the file system has no birth time. */
export type CreatedSource = "git" | "birthtime" | "mtime";
/** When a file came into being: integer milliseconds since the Unix epoch (UTC), and which source said so. */
export interface AtlasCreated { at: number; from: CreatedSource }

export interface ArtifactRef { definition: string; id: string; name?: string; type?: string; role?: string; format?: string; tags?: string[] }

export interface AtlasNode {
  /** "def:<definition id>" | "file:<project-relative path>" | "dir:<path>/" | "url:<definition>#<artifact id>" */
  id: string;
  kind: AtlasKind;
  label: string;
  /** Project-relative, forward slashes. Modules: the file that defines them. Files: the file itself. Package files: "package:<name>/<path>". */
  path?: string;
  /** dirname(path) ("" at the root); "(remote)" for URL artifacts. "Pull together by Folder" groups on it. */
  folder: string;
  status: NodeStatus;
  reason?: FailReason;
  degree: number;
  definition?: { id: string; tier: PartTier; moduleKind: Instance["kind"]; root?: true; instances: string[]; trust?: string };
  file?: { ext: string; size: number; sha256?: string; kindFrom: KindSource; artifacts: ArtifactRef[]; owners: string[]; producedBy?: string };
  url?: string;
  /**
   * When the file came into being: on a `file:` node of an enumerated project
   * file that is not failed, on a `def:` node whose `path` is one, and on a
   * `dir:` node (the earliest of the files below it). Optional: an index
   * built before creation times existed has none (and is stale, "history").
   */
  created?: AtlasCreated;
}

export interface AtlasEdge { from: string; to: string; type: EdgeType; /** links collapsed onto one definition pair */ count?: number; /** link ids, harness ids, artifact ids */ via?: string[] }

export interface CensusEntry {
  path: string; kind: FileKind; kindFrom: KindSource; ext: string; size: number; sha256?: string;
  status: CensusStatus; reason?: FailReason;
  /** "artifact:<def>#<id>" | "dir-artifact:<def>#<id>" | "operation:<record path>" */
  linkedBy?: string[];
  /** The same creation time as the file's node (none for a failed file). */
  created?: AtlasCreated;
}

export interface AtlasCounts {
  nodes: number; edges: number; byKind: Partial<Record<AtlasKind, number>>;
  census: { total: number; linked: number; unlinked: number; failed: number; excluded: number };
  /** Nodes by the source of their creation time; `none`: nodes with no `created`. The four add up to `nodes`. Absent in an index built before creation times existed. */
  created?: { git: number; birthtime: number; mtime: number; none: number };
}

export interface AtlasIndex {
  schema: typeof ATLAS_SCHEMA;
  stack: string;                       // FRAMEWORK_VERSION that built it
  project: { name: string; root: string | null };
  enumerator: "git" | "walk";
  counts: AtlasCounts;
  nodes: AtlasNode[];                  // sorted by id (code-unit order)
  edges: AtlasEdge[];                  // sorted by from, to, type
  census: CensusEntry[];               // sorted by path
  instances: Record<string, string>;   // instance path -> definition id ("" = root)
  /** Every enumerated file (code included): what freshness compares. [path, size, mtimeMs, sha256 | null] */
  inputs: [string, number, number, string | null][];
  problems: { path?: string; reason: FailReason | "OPERATION_RECORD_UNREADABLE" | "ENUMERATION_FALLBACK" | "HISTORY_FALLBACK"; message: string }[];
}

/** What a view needs: no inputs or census details. */
export interface AtlasGraph { project: AtlasIndex["project"]; counts: AtlasCounts; nodes: AtlasNode[]; edges: AtlasEdge[] }

/** The view projection of an index: the graph, without the freshness inputs, census or problems. */
export function atlasGraph(index: AtlasIndex): AtlasGraph {
  return { project: index.project, counts: index.counts, nodes: index.nodes, edges: index.edges };
}

/**
 * Whether a node is a file the census calls unlinked: a project file that no
 * artifact, folder artifact or operation record points to (and that is not
 * failed, which the census counts apart). Read from the graph alone: an
 * artifact or a folder artifact gives the file a `has` edge, an operation
 * record gives it `file.producedBy`. A file an operation produced but no
 * module names is linked (by its record), though it has no edge.
 * Over an index's nodes, the count equals `counts.census.unlinked`.
 */
export function isUnlinkedFile(node: Pick<AtlasNode, "id" | "path" | "status" | "degree" | "file">): boolean {
  return node.id.startsWith("file:") && !node.path?.startsWith("package:") && !!node.file && node.status !== "failed" && node.degree === 0 && !node.file.producedBy;
}

/** Plural label and singular noun for every kind. */
export const ATLAS_KINDS: Record<AtlasKind, { label: string; one: string }> = {
  module: { label: "Modules", one: "Module" },
  part: { label: "Parts", one: "Part" },
  concept: { label: "Concept images", one: "Concept image" },
  render: { label: "Renders", one: "Render" },
  photo: { label: "Photos", one: "Photo" },
  image: { label: "Images", one: "Image" },
  model: { label: "3D models", one: "3D model" },
  cad: { label: "CAD files", one: "CAD file" },
  board: { label: "Board files", one: "Board file" },
  doc: { label: "Documents", one: "Document" },
  data: { label: "Data files", one: "Data file" },
  firmware: { label: "Firmware", one: "Firmware image" },
  other: { label: "Other files", one: "Other file" },
};

/** The order kinds are listed in (legends, census tables, filters). */
export const ATLAS_KIND_ORDER: readonly AtlasKind[] = ["module", "part", "concept", "render", "photo", "image", "model", "cad", "board", "doc", "data", "firmware", "other"];

/** Code-unit order (never localeCompare: stable across ICU builds). */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const set = (s: string) => new Set(s.split(" "));

/** Asset extensions (lower case, no dot) by kind; images are decided separately. */
const EXTENSION_KINDS: [FileKind, Set<string>][] = [
  ["model", set("glb gltf stl 3mf obj ply fbx usdz")],
  ["cad", set("step stp iges igs brep kcl f3d f3z sldprt sldasm slddrw ipt iam fcstd scad dxf dwg 3dm skp")],
  ["board", set("kicad_pcb kicad_sch kicad_pro kicad_sym kicad_mod brd sch gbr gtl gbl gts gbs gto gbo gko gm1 drl xln")],
  ["doc", set("md markdown pdf txt rst adoc html htm docx doc odt rtf pptx")],
  ["data", set("csv tsv xlsx xls parquet")],
  ["firmware", set("bin hex elf uf2")],
];

/** Board outputs recognized by file name (their extensions mean something else elsewhere). */
const BOARD_NAMES = set("schematic.svg pcb-top.svg pcb-bottom.svg circuit.json netlist.json pnp.csv");

const IMAGE_EXTENSIONS = set("png jpg jpeg webp gif svg heic heif tif tiff bmp avif");

/** Code, configuration and records: inputs for freshness, never assets. */
const NOT_ASSETS = set(
  "ts tsx mts cts js jsx mjs cjs py pyi ipynb json jsonc json5 yaml yml toml lock ini cfg conf properties " +
    "c h cc cpp cxx hpp hh ino rs go java kt kts swift cs rb php lua sh bash zsh ps1 psm1 bat cmd " +
    "map tsbuildinfo editorconfig gitignore gitattributes npmrc nvmrc kicad_prl",
);

const PATH_TOKENS: [FileKind, RegExp][] = [
  ["concept", /^(concepts?|sketch(es)?|ideas?|moodboard|whiteboard|inspiration)$/],
  ["render", /^(renders?|rendering|hero)$/],
  // camera file names carry a number: IMG_0001, DSC01234, PXL_20240101
  ["photo", /^(photos?|pics?|camera|(dsc|img|pxl)\d*)$/],
];

/** Artifact tags that name an image kind; the first one found wins. */
const TAG_KINDS: FileKind[] = ["concept", "render", "photo"];

/** Artifact `type` (UHD ArtifactType), used only to break a tie for an unknown extension. */
const TYPE_KINDS: Record<string, FileKind> = {
  pcb: "board",
  schematic: "board",
  "3d_model": "model",
  cad: "cad",
  firmware: "firmware",
  datasheet: "doc",
  documentation: "doc",
};

/** The file kind an artifact `type` suggests, if any: a tie-breaker only (extension and path come first). */
export const artifactTypeKind = (type: string | undefined): FileKind | undefined => (type ? TYPE_KINDS[type] : undefined);

const baseName = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";

/** The lower-case extension of a path's file name, without the dot ("" for none or a dot-file). */
export function fileExtension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * The kind of a project file (docs/specs/atlas.md, "Kinds").
 * null: not an asset (code, config, JSON records); the file is still an input for freshness.
 */
export function classifyFile(path: string, hints?: { artifacts?: ArtifactRef[]; producedBy?: string }): { kind: FileKind; from: KindSource } | null {
  const artifacts = hints?.artifacts ?? [];
  // 1. an author's tag wins
  for (const kind of TAG_KINDS) {
    if (artifacts.some((a) => a.tags?.some((t) => t.toLowerCase() === kind))) return { kind, from: "tag" };
  }
  const name = baseName(path).toLowerCase();
  const ext = fileExtension(path);
  // 2. by extension (board outputs by name first)
  if (BOARD_NAMES.has(name)) return { kind: "board", from: "extension" };
  for (const [kind, exts] of EXTENSION_KINDS) if (exts.has(ext)) return { kind, from: "extension" };
  // 3. images by path tokens, then by operation provenance
  if (IMAGE_EXTENSIONS.has(ext)) {
    const tokens = path.toLowerCase().split(/[/\\_\-. ]+/).filter(Boolean);
    for (const [kind, re] of PATH_TOKENS) if (tokens.some((t) => re.test(t))) return { kind, from: "path" };
    if (ext === "heic" || ext === "heif") return { kind: "photo", from: "path" };
    if (hints?.producedBy) return { kind: "render", from: "operation" };
    return { kind: "image", from: "extension" };
  }
  // 4. a file an artifact names that is not an asset by extension
  if (!ext || NOT_ASSETS.has(ext)) {
    if (!artifacts.length) return null;
    return artifacts.some((a) => a.role === "source") ? { kind: "cad", from: "artifact" } : { kind: "data", from: "artifact" };
  }
  // 5. anything else (video included); an artifact's type breaks the tie
  for (const a of artifacts) {
    const kind = artifactTypeKind(a.type);
    if (kind) return { kind, from: "artifact" };
  }
  return { kind: "other", from: "extension" };
}

/** Names never listed, hashed or searched (.env*, *.pem, *.key, *.p12, *.pfx, id_rsa*, id_ed25519*, credentials*.json, *.keystore). */
export function isSensitiveName(path: string): boolean {
  const name = baseName(path).toLowerCase();
  return (
    name.startsWith(".env") ||
    /\.(pem|key|p12|pfx|keystore)$/.test(name) ||
    name.startsWith("id_rsa") ||
    name.startsWith("id_ed25519") ||
    /^credentials.*\.json$/.test(name)
  );
}

/** The display config as the UHD bundle embeds it: without the Atlas layout, so Atlas saves never change the bundle. */
export function displayForBundle(display: Record<string, unknown>): Record<string, unknown> {
  // a hand-edited display.json may hold anything: only an object can carry the key
  if (!display || typeof display !== "object" || Array.isArray(display) || !(ATLAS_DISPLAY_KEY in display)) return display;
  const { [ATLAS_DISPLAY_KEY]: _atlas, ...rest } = display;
  return rest;
}

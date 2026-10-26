/**
 * Framework contracts (docs/specs/core-cli-v0.md).
 */
import type { ModuleDef } from "@deltarobotics/uhd";

/** protoboard.config.ts default export. */
export interface ProtoboardConfig {
  /** Project name (defaults to the directory name). */
  name?: string;
  /** Root system: a project source file and the export holding its ModuleDef. */
  root: { source: string; export: string };
  /**
   * Project source files (globs, relative to the project root) whose exported
   * ModuleDefs (or arrays of them) are local definitions. Defaults to
   * `src/**\/*.uhd.ts` and `parts/local/**\/*.uhd.ts`.
   */
  sources?: string[];
  /** Folder of vendored/downloaded definitions (JSON), with `origins.json` next to it. Default `parts/catalog`. */
  catalog?: string;
  /**
   * Protoboard Cloud parts service used by `protoboard parts search|add|update|publish`
   * (never by loading or checking): the URL of the `protoboard` library.
   * `PROTOBOARD_CLOUD_URL` overrides it; the default is http://localhost:8787.
   * The publish token comes only from `PROTOBOARD_CLOUD_TOKEN`, never from a
   * project file.
   */
  cloud?: { url?: string };
  /**
   * Part libraries (UHD library protocol `uhd-library/v1`) in order: the first
   * one that has a part id provides it, unless `--library` names one or the
   * part is pinned to one in parts/origins.json. Default: the Protoboard
   * library alone (`[{ id: "protoboard" }]`, at the cloud URL above).
   * Managed by `protoboard libraries list|add|remove|move`.
   */
  libraries?: LibraryConfig[];
  /** Extensions by package name (discovery arrives in M4; listed and reported by `doctor`). */
  extensions?: string[];
  /**
   * Named variants of the system (fault scenarios, options) exported by a
   * project source: `{ id, label, description?, system?, overrides? }[]`.
   * Included in the UHD bundle for viewers.
   */
  scenarios?: { source: string; export: string };
  /** Viewer display hints (layout, labels, placement, appearance), keyed by instance path. Default `.protoboard/display.json`. */
  display?: string;
  /**
   * The currency the project's quotes use (ISO 4217, default USD): the
   * release's ordering list and the cost model price each line from an offer
   * in this currency when one fits; offers in other currencies are kept as
   * alternatives, and amounts in different currencies are never converted
   * or summed together.
   */
  currency?: string;
  /**
   * `protoboard release` (@protoboardai/ext-release; docs/specs/release-package-and-evals.md).
   * May also be the default export of `release.config.ts` next to this file.
   */
  release?: ReleaseConfig;
}

/** How the Manufacturing Package is laid out and how much is ordered. */
export interface ReleaseConfig {
  /**
   * Package units: instance paths ("stack", "arm_fl") or module ids (every
   * instance of "quadcopter-5in-arm" is one unit, built once per instance).
   * The root system is always a unit; a module that is not a unit folds into
   * the nearest unit above it. Default: the root only.
   */
  units?: string[];
  /** Products to build; ordering quantities are multiplied by it. Default 1. */
  build?: number;
  /**
   * Spares added to ordering quantities, overriding the defaults by part
   * definition id or by tag/category: `{ "hardware": { percent: 10, min: 2 } }`.
   */
  spares?: Record<string, { percent?: number; min?: number }>;
  /**
   * The project's own test steps, added to a unit's test plan after the ones
   * generated from the model: what the model cannot say how to test (a
   * display shows its pattern, a charge current, a sleep current). `unit` is
   * the `units` entry (or its module id); omitted, the root (system) unit.
   */
  checks?: ReleaseCheck[];
}

/** A test step a project adds to a unit's test plan (`release.checks`). */
export interface ReleaseCheck {
  unit?: string;
  /** Bring-up (default) or functional check. */
  group?: "bringup" | "function";
  /** Bring-up: needs only power, or the firmware running (default). */
  phase?: "power" | "running";
  check: string;
  subject: string;
  how: string;
  pass: string;
  record: string;
  /** Where the expected value comes from (a document, a model path). */
  trace?: string;
}

/** One part library in `libraries`. */
export interface LibraryConfig {
  /** Short id, shown with search results and recorded in parts/origins.json: lower-case letters, digits, '-', '_'. */
  id: string;
  /** Library URL (its discovery document is at `<url>/.well-known/uhd-library` or `<url>/v1`). Optional only for "protoboard", which defaults to the cloud URL. */
  url?: string;
  /** Name of the environment variable holding the library's read token. The token itself is never written to the project. */
  authEnv?: string;
}

export type OriginKind = "local" | "catalog";

/**
 * Where a part comes from (docs/specs/tool-integrations.md §6): the cloud
 * catalog (vendored into parts/catalog), researched in this project
 * (parts/local, evidence in parts/evidence), or designed in this project (src).
 */
export type PartTier = "catalog" | "project-researched" | "project-specific";

/**
 * Base that a definition's relative artifact paths resolve against: the
 * project root, an installed npm package (definitions vendored before the
 * parts service), or a project directory the files were vendored into
 * (`parts add` from the parts service: parts/catalog/<id>).
 */
export type ArtifactBase = { kind: "project" } | { kind: "package"; package: string } | { kind: "vendored"; dir: string; strip?: string };

export interface SourceLocation {
  /** Project-relative path. */
  file: string;
  line?: number;
}

/** Where a definition came from; kept alongside the canonical UHD data. */
export interface Origin {
  kind: OriginKind;
  tier: PartTier;
  /** Local: the project source that exports it. Catalog: the JSON file. */
  source: SourceLocation;
  /** Catalog provenance (parts/origins.json). */
  provider?: string;
  /** Library URL the revision was downloaded from. */
  service?: string;
  /** Library id the revision was downloaded from (`libraries` in protoboard.config.ts). */
  library?: string;
  package?: string;
  version?: string;
  /** Parts service: the immutable revision number. Package-vendored: the package's git commit. */
  revision?: string | number;
  /** sha256 of the vendored definition file. */
  digest?: string;
  /** Parts service: digest of the revision envelope. */
  envelopeDigest?: string;
  retrievedAt?: string;
  /** Base that the definition's relative artifact paths resolve against. */
  artifactBase: ArtifactBase;
  /** Evidence files vendored with a catalog revision (project-relative), by kind (sources, verification, …). */
  evidence?: { kind: string; file: string }[];
  /** Files the catalog revision references but does not carry, with the reason. */
  missingArtifacts?: { path: string; artifactId?: string; reason: string }[];
  /** Catalog: the vendored definition source the definition was evaluated from (`<id>.uhd.ts`, PB-910), when it was vendored with its source. */
  definitionSource?: SourceLocation;
}

export interface DefinitionRecord {
  def: ModuleDef;
  origin: Origin;
}

export type Severity = "error" | "warning" | "info";

export interface EntityRef {
  kind: "project" | "definition" | "instance" | "link" | "artifact" | "interface";
  id: string;
}

export interface ProjectDiagnostic {
  /** Stable code, e.g. PB_UNRESOLVED_DEFINITION or UHD_LINK_STATE. */
  code: string;
  severity: Severity;
  entity: EntityRef;
  message: string;
  source?: SourceLocation;
  /** Validator that produced it: protoboard/registry, uhd/checkSystem, … */
  validator: string;
  /** Where on a design the finding is, when a provider can say (a board's check: mm in the board frame). */
  location?: DiagnosticLocation;
}

/**
 * Where a finding sits on a design, for a viewer to draw it there. Coordinates are in the design's
 * own frame: for a circuit board, mm in the board frame (+X right, +Y up, top view). A finding about
 * the whole design has `scope: "design"` and nothing else.
 */
export interface DiagnosticLocation {
  scope?: "design";
  /** The point to mark. */
  at?: [number, number];
  /** Further points when the finding has several (each via in a pad). */
  points?: [number, number][];
  /** The copper layer (top, bottom, inner1, inner2) when it is on one. */
  layer?: string;
  /** Component instance paths it concerns. */
  components?: string[];
  /** Pads it concerns: the provider's pad ids (circuit.json `pcb_smtpad_id`, `pcb_plated_hole_id`). */
  pads?: string[];
  /** Net ids (UHD) it concerns. */
  nets?: string[];
  /** Other copper or holes by the provider's ids (traces, vias, holes, pours, keep-outs). */
  items?: string[];
}

/** A validator's outcome: diagnostics are only meaningful if it ran. */
export interface CheckRun {
  validator: string;
  /** What it ran on, when a validator runs once per module (a capability provider's check). */
  subject?: string;
  status: "ran" | "skipped";
  reason?: string;
  counts: Record<Severity, number>;
}

export interface Instance {
  /** Stable instance path: child ids from the root, e.g. "arm_fl/motor". "" is the root. */
  path: string;
  definition: string;
  name?: string;
  /** UHD `ModuleKind`; a `board` (UHD 0.3.0, one PCB) behaves as a `module`. */
  kind: "module" | "group" | "harness" | "board";
  /** Identical units represented by this instance (ChildModuleRef.quantity). */
  quantity: number;
  parent?: string;
  /** Per-placement values (ChildModuleRef.overrides), e.g. a series passive's resistance. */
  overrides?: Record<string, unknown>;
}

export interface ResolvedArtifact {
  definition: string;
  id: string;
  role?: string;
  format?: string;
  /** As declared. */
  filePath?: string;
  url?: string;
  /** Absolute path after resolving against the origin's base. */
  resolved?: string;
  base: string;
  /** true/false for files; "remote" when only a URL is given; "provenance" when neither (a recorded reference). */
  present: boolean | "remote" | "provenance";
}

export interface ResolvedLink {
  /** "<declaring instance path>:<link id>", or just the link id for links declared by the root. */
  id: string;
  owner: string;
  a: string;
  b: string;
  /** The leaf instance interfaces the ends resolve to through exports, e.g. "arm_fl/motor:base_mount". */
  aLeaf?: string;
  bLeaf?: string;
  /** For a link-scoped composition: the leaf interface of every composed position. */
  aLeaves?: string[];
  bLeaves?: string[];
  harness?: string;
}

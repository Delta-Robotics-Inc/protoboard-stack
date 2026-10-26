/**
 * The Manufacturing Package's contracts (docs/specs/release-package-and-evals.md
 * §2–§3): package units, the section contract through which extensions
 * contribute content, and the release manifest.
 *
 * An extension contributes to a section by declaring an operation
 * `package:<section>` (effect `pure`) whose entry is a `SectionFn`. The
 * release calls it once per unit and renders what it returns; extensions never
 * render whole documents.
 */
import type { Project, ReleaseConfig } from "@protoboardai/core";
import type { RenderSpec } from "@protoboardai/ext-docs/renderer";

export const RELEASE_SCHEMA = "protoboard.release/v0";

/** Section ids, in document order within a unit. */
export const SECTIONS = ["spec", "bom", "work-order", "assembly", "test-plan"] as const;
export type SectionId = (typeof SECTIONS)[number];

/** The document each section becomes in a unit folder. */
export const SECTION_DOCS: Record<SectionId, { file: string; title: string; code: string }> = {
  spec: { file: "spec-sheet", title: "Spec sheet", code: "SPEC" },
  bom: { file: "bom", title: "Bill of materials", code: "BOM" },
  "work-order": { file: "work-order", title: "Work order", code: "WO" },
  assembly: { file: "assembly-guide", title: "Assembly guide", code: "AG" },
  "test-plan": { file: "test-plan", title: "Test and validation plan", code: "TP" },
};

/**
 * One folder of the package: the root system, or a module the operator
 * named in `release.units`. Paths are instance paths in the system.
 */
export interface Unit {
  /** Folder name: "system" for the root, otherwise the entry as written ("/" becomes "."). */
  id: string;
  /** Package-relative folder: "system" or "units/<id>". */
  folder: string;
  kind: "root" | "instance" | "module";
  /** The `release.units` entry ("" for the root). */
  entry: string;
  name: string;
  definition: string;
  /** Instance paths built as this unit ("" for the root). */
  instances: string[];
  /** The instance whose subtree describes one build of the unit. */
  representative: string;
  /** Builds of this unit per product (instance quantities multiplied through the tree). */
  perProduct: number;
  /** Unit ids the unit is assembled into (empty for the root). */
  parents: string[];
  /**
   * What one build contains, relative to the representative instance: the
   * instances folded into it (not inside a sub-unit), with their quantity per
   * build of this unit. A sub-unit's instance is listed with `unit` set and
   * nothing below it.
   */
  members: UnitMember[];
}

export interface UnitMember {
  /** Instance path relative to the unit's representative instance. */
  path: string;
  /** Full instance path (of the representative build). */
  instance: string;
  parent: string;
  definition: string;
  name: string;
  /** UHD `ModuleKind`; a `board` (UHD 0.3.0, one PCB) behaves as a `module`. */
  kind: "module" | "group" | "harness" | "board";
  /** Quantity of this instance per build of the unit (its own and its ancestors' within the unit). */
  quantity: number;
  /** Set when this instance is another unit, built in its own folder. */
  unit?: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// Section content: structured, rendered by the release into PDF and HTML
// ---------------------------------------------------------------------------

export type Cell = string | number | null | undefined;

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Keep the cell on one line (ids, part numbers). */
  nowrap?: boolean;
}

export type Block =
  | { kind: "heading"; text: string }
  /** `keep`: stays on the page of the block after it (an introduction to a table). */
  | { kind: "paragraph"; text: string; keep?: boolean }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "keyvalues"; rows: { label: string; value: string; note?: string }[] }
  | { kind: "figures"; items: { label: string; value: string; sub?: string }[] }
  | { kind: "table"; columns: Column[]; rows: (Record<string, Cell> | { group: string })[]; caption?: string; note?: string }
  | { kind: "note"; level: "tip" | "caution" | "warning"; text: string }
  | { kind: "steps"; steps: Step[] }
  /**
   * An image (PNG): a figure the release rendered (`SectionContext.figure`) or
   * a file the contribution supplies; `file` is package-relative. `callouts`
   * are lettered bubbles with leaders to points of the image (pixels).
   */
  | { kind: "image"; file: string; caption: string; width?: number; height?: number; callouts?: Callout[]; size?: "small" | "full" }
  /** A grid of items to lay out at the bench, each with a thumbnail when it has one. */
  | { kind: "kit"; items: KitItem[]; note?: string };

export interface Callout {
  x: number;
  y: number;
  label: string;
  accent?: boolean;
}

export interface KitItem {
  name: string;
  quantity: number;
  /** Definition id or instance path, printed small. */
  ref?: string;
  /** Package path of a thumbnail (a rendered figure). */
  image?: string;
  /** Shown instead of an image ("cable", "CAD file not available"). */
  placeholder?: string;
}

export interface Step {
  title: string;
  /** Operation or step id shown before the title ("OP-3"); default: the step's number. */
  id?: string;
  /** What to do, in order. */
  actions?: string[];
  /** Parts used in this step; `letter` matches a callout of the figure, `image` is a thumbnail. */
  parts?: { name: string; quantity: number; ref?: string; letter?: string; accent?: boolean; image?: string }[];
  /** The step's figure (a rendered figure: `SectionContext.figure`). */
  figure?: { file: string; width: number; height: number; caption?: string; callouts?: Callout[] };
  /** A table under the actions (connections of a wiring step). */
  table?: { columns: Column[]; rows: Record<string, Cell>[] };
  tools?: string[];
  materials?: string[];
  torque?: string;
  inspect?: string;
  /** The test step that follows. */
  test?: string;
  notes?: { level: "tip" | "caution" | "warning"; text: string }[];
  /** Model references the step covers (link ids, instance paths), shown as a trace line. */
  trace?: string[];
}

/** A file a contribution adds to the unit folder. */
export interface SectionFile {
  /**
   * Unit-relative destination: under `files/` for manufacturing files
   * (`files/firmware/cli.txt`), or a unit-level data file (`bom.csv`).
   */
  path: string;
  /** Project-relative source file to copy… */
  from?: string;
  /** …or the content to write. */
  content?: string | Buffer;
  /** What it is for (manifest role): fabrication, assembly, firmware-config, purchasing, model, test. */
  role?: string;
  description?: string;
}

export interface SectionDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}

/** What a `package:<section>` entry returns for one unit. */
export interface SectionContribution {
  /** Part title within the section ("Flight controller configuration"); omitted for the section's main body. */
  title?: string;
  /** Sort key within the section (lower first; the release's own baseline is 0). */
  order?: number;
  blocks: Block[];
  files?: SectionFile[];
  /**
   * Work order only: operations for the unit's numbered sequence, which the
   * release's own work order places and numbers (OP 10, 20, …) with the rest.
   * Details stay in this contribution's blocks.
   */
  operations?: ContributedOperation[];
  /** Findings: an error stops the release (e.g. a contributed file that is stale). */
  diagnostics?: SectionDiagnostic[];
}

/**
 * An operation another extension adds to a unit's work order.
 * `configure`: after the assembly steps and before the unit's bench test
 * (flash firmware, load a configuration), so before the steps that must
 * follow the test (propellers, a battery strapped on for use).
 */
export interface ContributedOperation extends Step {
  stage: "configure";
}

export interface SectionContext {
  project: Project;
  section: SectionId;
  unit: Unit;
  units: Unit[];
  release: { version: string; date: string; build: number; config: ReleaseConfig };
  /** The unit's collected manufacturing files (package paths), known before sections run. */
  files: PackageFile[];
  /**
   * Extensions contributing to this section, in call order (the release's own
   * first). A baseline can step aside when a richer contributor is present.
   */
  contributors: string[];
  /**
   * Operations the other contributors add to this unit's work order, for the
   * release's own work order to number (it runs after them). Empty in the
   * other sections.
   */
  operations: (ContributedOperation & { extension: string })[];
  /**
   * Render a figure with the release's renderer (headless Chrome, one per
   * release) into the package's assets/images/<name>.png. Served GLB paths are
   * `project/<project-relative path>` (ext-docs' server). The same name with
   * the same spec returns the first result; with another spec it throws.
   */
  figure: (name: string, spec: RenderSpec) => Promise<RenderedFigure>;
  log: (line: string) => void;
}

/** A figure in the package: `file` is its package path; anchors are the spec's anchors in image pixels. */
export interface RenderedFigure {
  file: string;
  width: number;
  height: number;
  anchors: Record<string, { x: number; y: number }>;
}

/** A `package:<section>` entry. Returning undefined or no blocks contributes nothing to this unit. */
export type SectionFn = (ctx: SectionContext) => SectionContribution | SectionContribution[] | undefined | Promise<SectionContribution | SectionContribution[] | undefined>;

/** A file in the package, before it is written. */
export interface PackageFile {
  /** Package-relative path (forward slashes). */
  path: string;
  unit?: string;
  role: string;
  /** Project-relative source, when copied. */
  from?: string;
  content: Buffer;
  description?: string;
}

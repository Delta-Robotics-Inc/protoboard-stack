/**
 * The System Map (docs/specs/system-map.md): an index of what the Protoboard
 * stack itself can do (packages, extensions, skills, capabilities and their
 * operations, operations, checks, external tools, CLI commands, MCP tools,
 * views, templates, example projects and docs), grouped into disciplines
 * ("islands"), with versions and the links between items.
 *
 * Browser-safe: no Node imports. The map is built by `./build.ts` (Node) and
 * checked for freshness by `./fresh.ts`.
 */

export const SYSMAP_SCHEMA = "protoboard.sysmap/v0";
/** Where a writer puts the map by default, relative to the stack root (derived data, git-ignored like the Atlas index). */
export const SYSMAP_FILE = ".protoboard/build/sysmap.json";

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemType =
  | "package"
  | "extension"
  | "skill"
  | "capability"
  | "capability-operation"
  | "operation"
  | "check"
  | "tool"
  | "cli-command"
  | "mcp-tool"
  | "view"
  | "template"
  | "example"
  | "doc";

/** The order item types are listed in (legends, counts, filters). */
export const ITEM_TYPE_ORDER: readonly ItemType[] = [
  "package",
  "extension",
  "skill",
  "capability",
  "capability-operation",
  "operation",
  "check",
  "tool",
  "cli-command",
  "mcp-tool",
  "view",
  "template",
  "example",
  "doc",
];

/** Plural label, singular noun and id prefix of every item type. */
export const ITEM_TYPES: Record<ItemType, { label: string; one: string; prefix: string }> = {
  package: { label: "Packages", one: "Package", prefix: "pkg" },
  extension: { label: "Extensions", one: "Extension", prefix: "ext" },
  skill: { label: "Skills (SOPs)", one: "Skill (SOP)", prefix: "skill" },
  capability: { label: "Capabilities", one: "Capability", prefix: "cap" },
  "capability-operation": { label: "Capability operations", one: "Capability operation", prefix: "capop" },
  operation: { label: "Operations", one: "Operation", prefix: "op" },
  check: { label: "Checks", one: "Check", prefix: "check" },
  tool: { label: "External tools", one: "External tool", prefix: "tool" },
  "cli-command": { label: "CLI commands", one: "CLI command", prefix: "cli" },
  "mcp-tool": { label: "MCP tools", one: "MCP tool", prefix: "mcp" },
  view: { label: "Views", one: "View", prefix: "view" },
  template: { label: "Templates", one: "Template", prefix: "template" },
  example: { label: "Example projects", one: "Example project", prefix: "example" },
  doc: { label: "Docs and specs", one: "Doc", prefix: "doc" },
};

/**
 * Where an item's version came from: its own metadata ("own"), the extension
 * manifest that declares it ("manifest"), the package that ships it
 * ("package"), the installed copy of a package outside the stack
 * ("installed"); "unreleased" for an item not in the last release (no version
 * yet); "none" when nothing gives one.
 */
export type VersionSource = "own" | "manifest" | "package" | "installed" | "unreleased" | "none";

/**
 * Where an item's discipline came from: declared in its manifest
 * ("declared"), the build-a-project stage it belongs to ("stage"), the item
 * it belongs to or wraps ("inherited"), the classification table in this
 * module ("rule"), the disciplines of the items it links to ("links"), or
 * nothing ("none", with a problem).
 */
export type DisciplineSource = "declared" | "stage" | "inherited" | "rule" | "links" | "none";

/** released: in the last release tag (or an installed stack); wip: added since the last release tag; outside: shipped by a package whose source is not in the stack. */
export type ItemStatus = "released" | "wip" | "outside";

/** The last version an item changed in, and one line why. */
export interface ItemChange {
  /** A release version ("0.3.0"), or "unreleased" for a change since the last release tag. */
  in: string;
  /** The release tag's date (YYYY-MM-DD); absent for "unreleased". */
  date?: string;
  why: string;
  /** release-notes: the line is a release-notes bullet that names the item; history: written from what the history shows. */
  from: "release-notes" | "history";
}

export interface SysmapItem {
  /** "<prefix>:<key>" (ITEM_TYPES[type].prefix). */
  id: string;
  type: ItemType;
  name: string;
  version: string | null;
  versionFrom: VersionSource;
  discipline: DisciplineId | null;
  disciplineFrom: DisciplineSource;
  /** Its step in build-a-project (the "### N." sections of that SKILL.md): the section that names it most, a table row counting half, ties to the earliest; or null. */
  stage: number | null;
  /** build-a-project: a stage section names it; skills: the earliest stage of the skills it ships; extension: its extension's stage. */
  stageFrom?: "build-a-project" | "skills" | "extension";
  /** Every build-a-project stage that names it (stage is the one that names it most). */
  stages?: number[];
  /** One plain line. */
  purpose: string;
  /** The full text the purpose was cut from, when it was cut. */
  detail?: string;
  status: ItemStatus;
  /** null: no history to tell (no git, no release tags). */
  changed: ItemChange | null;
  /** The file that defines it, relative to the stack root with forward slashes; "#..." names the entry inside it. */
  source: string;
  /** The npm name of the package that ships it. */
  package?: string;
  /** Type-specific facts read from the source (effect, native provider, pins, spec status...). */
  facts?: Record<string, string | boolean | string[]>;
  degree: number;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type LinkKind =
  | "ships" // a package or extension ships the item
  | "declares" // an extension declares a skill another package ships
  | "depends-on" // package.json dependencies between stack packages
  | "provides" // an extension provides a capability
  | "operation-of" // a capability operation belongs to its capability
  | "needs" // an operation or extension needs an external tool (manifest `requires`, `tools`)
  | "verified-by" // manifest `verifiedBy`
  | "refers-to" // a skill names another skill (bold in its SKILL.md)
  | "runs" // a skill runs an operation or capability operation (`protoboard run ...`)
  | "runs-command" // a skill tells the agent to run a CLI command
  | "calls" // a skill names an MCP tool
  | "wraps" // an MCP tool runs a CLI command
  | "serves" // a CLI command serves an MCP tool
  | "installs" // a template installs an extension
  | "derived-from" // a template is derived from an example project
  | "uses" // an example project uses a stack package
  | "cites" // an item's text cites a doc by path
  | "mentions"; // a doc names an item (a skill, an extension or package, a CLI command, an MCP tool)

export const LINK_KINDS: Record<LinkKind, { label: string; reverse: string }> = {
  ships: { label: "ships", reverse: "shipped by" },
  declares: { label: "declares", reverse: "declared by" },
  "depends-on": { label: "depends on", reverse: "depended on by" },
  provides: { label: "provides", reverse: "provided by" },
  "operation-of": { label: "operation of", reverse: "has operation" },
  needs: { label: "needs", reverse: "needed by" },
  "verified-by": { label: "verified by", reverse: "verifies" },
  "refers-to": { label: "refers to", reverse: "named by" },
  runs: { label: "runs", reverse: "run by" },
  "runs-command": { label: "runs command", reverse: "run by" },
  calls: { label: "calls", reverse: "called by" },
  wraps: { label: "wraps", reverse: "wrapped by" },
  serves: { label: "serves", reverse: "served by" },
  installs: { label: "installs", reverse: "installed by" },
  "derived-from": { label: "derived from", reverse: "template for" },
  uses: { label: "uses", reverse: "used by" },
  cites: { label: "cites", reverse: "cited by" },
  mentions: { label: "mentions", reverse: "mentioned by" },
};

export interface SysmapLink {
  from: string;
  to: string;
  kind: LinkKind;
  /** The file (stack-relative) the reference was read from. */
  via: string;
}

// ---------------------------------------------------------------------------
// Disciplines (islands)
// ---------------------------------------------------------------------------

export type DisciplineId =
  | "project"
  | "research"
  | "parts"
  | "system"
  | "pcb"
  | "cad"
  | "firmware"
  | "docs"
  | "mfg"
  | "simulation"
  | "packaging"
  | "protocols"
  | "playbooks";

export interface DisciplineDef {
  id: DisciplineId;
  name: string;
  gloss: string;
  /** For a discipline the stack plans but may not ship: specs that describe it, and folders that would hold it. */
  planned?: { specs?: string[]; folders?: string[] };
}

/** Every discipline, in island order. A discipline no item resolves to is reported as an empty island. */
export const DISCIPLINES: readonly DisciplineDef[] = [
  { id: "project", name: "Project & agent", gloss: "Setting up a project and connecting an AI agent to it" },
  { id: "research", name: "Research & sourcing", gloss: "Finding real parts, reading datasheets, comparing suppliers" },
  { id: "parts", name: "Parts", gloss: "Turning a bought part into a checked UHD definition" },
  { id: "system", name: "System design", gloss: "The system diagram: blocks, links, wiring and the check loop" },
  { id: "pcb", name: "PCB & EDA", gloss: "Circuit boards with tscircuit, and the KiCad handoff (EDA: electronic design automation)" },
  { id: "cad", name: "3D CAD", gloss: "Enclosures, plates and frames, routed cables" },
  { id: "firmware", name: "Firmware", gloss: "Controller configuration written from the board's wiring" },
  { id: "docs", name: "Test & documents", gloss: "Test plans, datasheets, assembly guides, evals" },
  { id: "mfg", name: "Manufacturing & release", gloss: "Bill of materials, the release and its Manufacturing Package" },
  { id: "simulation", name: "Simulation", gloss: "Circuit and mechanical simulation" },
  { id: "packaging", name: "Packaging", gloss: "Product packaging: boxes, inserts, labels" },
  {
    id: "protocols",
    name: "Protocols",
    gloss: "Shared procedures beyond one extension's skills (the planned Handbook)",
    planned: { specs: ["docs/specs/playbooks.md"], folders: ["handbook"] },
  },
  {
    id: "playbooks",
    name: "Playbooks",
    gloss: "Project-type playbooks that sequence the skills",
    planned: { specs: ["docs/specs/playbooks.md"], folders: ["playbooks"] },
  },
];

export const DISCIPLINE_ORDER: readonly DisciplineId[] = DISCIPLINES.map((d) => d.id);

/**
 * The discipline of a build-a-project stage, from words in its heading
 * ("### 5. Boards (circuit capability)"). The first rule that matches wins; a
 * heading none matches is a STAGE_UNCLASSIFIED problem.
 */
export const STAGE_DISCIPLINE_RULES: readonly [RegExp, DisciplineId][] = [
  [/harness cad/, "cad"],
  [/enclosure|structure/, "cad"],
  [/board/, "pcb"],
  [/firmware/, "firmware"],
  [/sourcing/, "research"],
  [/\bparts\b/, "parts"],
  [/system|harness|check|fault/, "system"],
  [/document|test plan|eval/, "docs"],
  [/release|manufactur/, "mfg"],
  [/set up|brief|requirement/, "project"],
];

/** The discipline a stage heading names, if a rule matches. */
export function stageDiscipline(title: string): DisciplineId | undefined {
  const t = title.toLowerCase();
  for (const [re, d] of STAGE_DISCIPLINE_RULES) if (re.test(t)) return d;
  return undefined;
}

/**
 * The classification tables for items whose files say nothing about a
 * discipline and that have no build-a-project stage to take one from (see
 * docs/specs/system-map.md, "Disciplines"). Items found here carry
 * `disciplineFrom: "rule"`. Keys: npm names for packages, command names, view
 * ids.
 */
export const DISCIPLINE_RULES: {
  package: Record<string, DisciplineId>;
  packageDefault: DisciplineId;
  skill: Record<string, DisciplineId>;
  cliCommand: Record<string, DisciplineId>;
  cliDefault: DisciplineId;
  view: Record<string, DisciplineId>;
  viewDefault: DisciplineId;
  template: DisciplineId;
  example: DisciplineId;
} = {
  package: { "@protoboardai/cloud": "parts" },
  packageDefault: "project",
  // the top-level SOP: it spans every stage, and starts and ends with the project
  skill: { "build-a-project": "project" },
  cliCommand: {
    check: "system",
    build: "system",
    inspect: "system",
    artifacts: "system",
    layout: "system",
    views: "system",
    dev: "system",
    index: "system",
    parts: "parts",
    libraries: "parts",
    bom: "mfg",
    release: "mfg",
    evals: "docs",
    map: "project",
  },
  cliDefault: "project",
  view: { diagram: "system", pair: "system", "3d": "cad", schematic: "pcb", pcb: "pcb", bom: "mfg", library: "parts", atlas: "project", sysmap: "project" },
  viewDefault: "project",
  template: "project",
  example: "project",
};

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export interface SysmapIsland {
  id: DisciplineId;
  name: string;
  gloss: string;
  items: number;
  empty: boolean;
  /** For an empty island: what the stack holds about it (a spec, a missing folder). */
  note?: string;
}

export interface SysmapStage {
  n: number;
  title: string;
  discipline: DisciplineId | null;
}

export interface SysmapRelease {
  version: string;
  tag: string;
  date: string;
}

export type ProblemReason =
  | "STACK_NOT_FOUND"
  | "PACKAGE_UNREADABLE"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID"
  | "VERSION_MISMATCH"
  | "VERSION_MISSING"
  | "OUTSIDE_NOT_INSTALLED"
  | "OUTSIDE_VERSION_DRIFT"
  | "SKILL_FILE_MISSING"
  | "SKILL_UNDECLARED"
  | "SKILL_NAME_MISMATCH"
  | "FRONTMATTER_MISSING"
  | "DUPLICATE_ID"
  | "SOURCE_UNPARSED"
  | "CLI_UNDOCUMENTED"
  | "CLI_HELP_ORPHAN"
  | "REFERENCE_UNRESOLVED"
  | "REFERENCE_AMBIGUOUS"
  | "STAGES_MISSING"
  | "STAGE_UNCLASSIFIED"
  | "DISCIPLINE_UNRESOLVED"
  | "DOCS_ABSENT"
  | "HISTORY_UNAVAILABLE";

export interface SysmapProblem {
  reason: ProblemReason;
  message: string;
  /** The file it concerns, stack-relative. */
  path?: string;
  /** The item it concerns. */
  item?: string;
}

export interface SysmapCounts {
  items: number;
  links: number;
  /** Every item type, zeros included. */
  byType: Record<ItemType, number>;
  /** Every discipline, zeros included; "none": items with no discipline. */
  byDiscipline: Record<DisciplineId | "none", number>;
  byStatus: Record<ItemStatus, number>;
  byLinkKind: Partial<Record<LinkKind, number>>;
  problems: number;
}

/** What the history said when the map was built: freshness compares it. */
export interface SysmapHistory {
  head: string;
  /** "tag=commit" for every release tag, in version order. */
  tags: string[];
  /** sha256 of the sorted paths that differ from the last release tag (tracked changes and untracked files). */
  dirty: string;
}

export interface SystemMap {
  schema: typeof SYSMAP_SCHEMA;
  /** FRAMEWORK_VERSION of the stack that built it. */
  stack: string;
  /** monorepo: the stack's source repository (package.json workspaces); installed: a folder holding node_modules/@protoboardai. */
  layout: "monorepo" | "installed";
  counts: SysmapCounts;
  islands: SysmapIsland[];
  stages: SysmapStage[];
  releases: SysmapRelease[];
  items: SysmapItem[]; // sorted by id (code-unit order)
  links: SysmapLink[]; // sorted by from, to, kind
  /** Every file read: [path, size, mtimeMs, sha256]. */
  inputs: [string, number, number, string][];
  history: SysmapHistory | null;
  problems: SysmapProblem[]; // sorted by reason, path, item, message
}

/**
 * What a view needs: the items, links, islands and stages, the release tags
 * (the "Show changes" picker) and the problems (the view lists them); not the
 * inputs or the history fingerprint, which only freshness reads.
 */
export interface SysmapGraph {
  /** The stack version that built the map (the view's boxed version). */
  stack: string;
  layout: SystemMap["layout"];
  counts: SysmapCounts;
  islands: SysmapIsland[];
  stages: SysmapStage[];
  releases: SysmapRelease[];
  items: SysmapItem[];
  links: SysmapLink[];
  problems: SysmapProblem[];
}

/** The view projection of a map. */
export function sysmapGraph(map: SystemMap): SysmapGraph {
  return { stack: map.stack, layout: map.layout, counts: map.counts, islands: map.islands, stages: map.stages, releases: map.releases, items: map.items, links: map.links, problems: map.problems };
}

/** Code-unit order (never localeCompare: stable across ICU builds). */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The item id for a type and key. */
export const itemId = (type: ItemType, key: string): string => `${ITEM_TYPES[type].prefix}:${key}`;

/**
 * The most frequent discipline in a list; a tie goes to the one earlier in
 * island order ("island"), or to the one that comes first in the list
 * ("first", for a list the caller ordered, such as by stage). undefined for
 * an empty list.
 */
export function majorityDiscipline(list: readonly (DisciplineId | null | undefined)[], tie: "island" | "first" = "island"): DisciplineId | undefined {
  const counts = new Map<DisciplineId, number>();
  for (const d of list) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  const order = tie === "first" ? [...new Set(list.filter((d): d is DisciplineId => !!d))] : DISCIPLINE_ORDER;
  let best: DisciplineId | undefined;
  for (const d of order) {
    const n = counts.get(d) ?? 0;
    if (n > 0 && (best === undefined || n > (counts.get(best) ?? 0))) best = d;
  }
  return best;
}

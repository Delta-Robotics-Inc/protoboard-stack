/**
 * The System Map view's logic (docs/specs/system-map.md, "The view"), pure
 * so the tests check it directly: the map's items as the Atlas renderer's
 * nodes (graph.ts), their look by status, the islands and types the side
 * panel lists, the releases "Show changes" picks from and what changed in
 * each, an item's links grouped by kind, and the item types' default
 * colors and shapes (Appearance, kept apart from the Atlas's).
 *
 * - An item is a hexagon in its island ("Pull together by folder", the
 *   folder being its discipline): released items are filled, work in
 *   progress (wip) hollow and dashed, what a package outside this
 *   repository ships hollow and solid.
 * - Its chip is its own version, "unreleased" for work in progress; with
 *   "Show changes" on, an item that changed in the chosen release reads
 *   "changed <version>" and is ringed.
 * - A link within an island is a core link (always drawn); one across
 *   islands is drawn with "All links" (the muted web), and always for the
 *   hovered or selected item (draw.ts `isCoreLink`, Folder mode).
 */
import type { ThemeToken } from "@deltarobotics/uhd-viewer/components";
import { DISCIPLINE_ORDER, ITEM_TYPES, ITEM_TYPE_ORDER, LINK_KINDS, type DisciplineId, type ItemStatus, type ItemType, type LinkKind, type SysmapGraph, type SysmapIsland, type SysmapItem } from "@protoboardai/core/sysmap";
import type { KindTable } from "../atlas/appearance.js";
import type { MapGraph, MapNode, MapSpec, NodeLook } from "../atlas/graph.js";
import type { Shape } from "../atlas/palette.js";

/** The island of an item no rule placed (`discipline: null`). */
export const NO_ISLAND = "none";

/** A map item as the renderer draws it. */
export interface SysmapNode extends MapNode {
  item: SysmapItem;
}

/** How each status is drawn. */
export const STATUS_LOOK: Record<ItemStatus, NodeLook> = { released: "fill", wip: "dashed", outside: "hollow" };

/** Each status in words (the inspector, the legend). */
export const STATUS_LABEL: Record<ItemStatus, string> = {
  released: "Released",
  wip: "In progress, not released yet",
  outside: "Outside this repository",
};

/** The version "Show changes" reads for work since the last release tag. */
export const UNRELEASED = "unreleased";

/** The file an item is defined in (its `source` before the entry), or undefined. */
export function sourceFile(item: Pick<SysmapItem, "source">): string | undefined {
  const file = item.source.split("#")[0]?.trim();
  return file ? file : undefined;
}

/** What an item's chip says: "changed <version>" when it is marked; else its own version; "unreleased" for work in progress; else nothing. */
export function itemChip(item: SysmapItem, changedIn: string | null = null): string {
  if (changedIn && item.changed?.in === changedIn) return `changed ${changedIn}`;
  if (item.status === "wip") return UNRELEASED;
  return item.version ?? "";
}

/** The renderer's graph of a map: every item a node in its island, every link an edge typed by its kind. */
export function sysmapMapGraph(graph: SysmapGraph, changedIn: string | null = null): MapGraph<SysmapNode> {
  const nodes: SysmapNode[] = graph.items.map((item) => ({
    id: item.id,
    kind: item.type,
    label: item.name,
    path: sourceFile(item),
    folder: item.discipline ?? NO_ISLAND,
    look: STATUS_LOOK[item.status],
    version: itemChip(item, changedIn),
    item,
  }));
  return { nodes, edges: graph.links.map((l) => ({ from: l.from, to: l.to, type: l.kind })) };
}

/** Whether a link joins two items of one island (a core link: always drawn); the rest cross islands ("All links"). */
export function isWithinIsland(link: { from: string; to: string }, byId: ReadonlyMap<string, Pick<SysmapItem, "discipline">>): boolean {
  const a = byId.get(link.from);
  const b = byId.get(link.to);
  return !!a && !!b && (a.discipline ?? NO_ISLAND) === (b.discipline ?? NO_ISLAND);
}

export interface IslandRow {
  id: string;
  name: string;
  gloss: string;
  count: number;
  /** No item resolves to it: listed, never drawn. */
  empty: boolean;
  note?: string;
}

/** The islands the side panel lists, in island order (empty ones included, with their note), and "No discipline" when any item has none. */
export function islandRows(graph: Pick<SysmapGraph, "islands" | "items">): IslandRow[] {
  const count = new Map<string, number>();
  for (const i of graph.items) count.set(i.discipline ?? NO_ISLAND, (count.get(i.discipline ?? NO_ISLAND) ?? 0) + 1);
  const rows: IslandRow[] = graph.islands.map((s: SysmapIsland) => ({ id: s.id, name: s.name, gloss: s.gloss, count: count.get(s.id) ?? 0, empty: (count.get(s.id) ?? 0) === 0, ...(s.note ? { note: s.note } : {}) }));
  const none = count.get(NO_ISLAND) ?? 0;
  if (none) rows.push({ id: NO_ISLAND, name: "No discipline", gloss: "Items no rule placed in a discipline", count: none, empty: false });
  return rows;
}

/** The item types the map holds, in type order, with their counts. */
export function typeRows(graph: Pick<SysmapGraph, "items">): { type: ItemType; label: string; count: number }[] {
  const count = new Map<ItemType, number>();
  for (const i of graph.items) count.set(i.type, (count.get(i.type) ?? 0) + 1);
  return ITEM_TYPE_ORDER.filter((t) => count.get(t)).map((t) => ({ type: t, label: ITEM_TYPES[t].label, count: count.get(t)! }));
}

export interface ReleaseOption {
  /** A release version, or "unreleased". */
  version: string;
  label: string;
  date?: string;
  /** Items whose last change is in it. */
  count: number;
}

/**
 * The releases "Show changes" offers, from the map's change data: every
 * version some item last changed in, newest first ("unreleased" on top),
 * with how many items. Releases without such an item are left out.
 */
export function releaseOptions(graph: Pick<SysmapGraph, "items" | "releases">): ReleaseOption[] {
  const count = new Map<string, number>();
  for (const i of graph.items) if (i.changed) count.set(i.changed.in, (count.get(i.changed.in) ?? 0) + 1);
  const out: ReleaseOption[] = [];
  if (count.get(UNRELEASED)) out.push({ version: UNRELEASED, label: "Unreleased (since the last release)", count: count.get(UNRELEASED)! });
  for (const r of [...graph.releases].reverse()) {
    const n = count.get(r.version);
    if (n) out.push({ version: r.version, label: `Release ${r.version}`, date: r.date, count: n });
  }
  // a version the items name that the release list lacks (a map read with another history): after the rest, as found
  for (const [v, n] of count) if (v !== UNRELEASED && !out.some((o) => o.version === v)) out.push({ version: v, label: `Release ${v}`, count: n });
  return out;
}

/** The release "Show changes" starts on: the latest release that changed something, else the unreleased work, else none. */
export function defaultRelease(options: readonly ReleaseOption[]): string | null {
  return options.find((o) => o.version !== UNRELEASED)?.version ?? options[0]?.version ?? null;
}

/** The items that last changed in `version`, by island order, then name; each with its one-line why. */
export function changedIn(graph: Pick<SysmapGraph, "items">, version: string | null): { item: SysmapItem; why: string }[] {
  if (!version) return [];
  const order = (d: DisciplineId | null) => (d ? DISCIPLINE_ORDER.indexOf(d) : DISCIPLINE_ORDER.length);
  return graph.items
    .filter((i) => i.changed?.in === version)
    .sort((a, b) => order(a.discipline) - order(b.discipline) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((item) => ({ item, why: item.changed!.why }));
}

export interface LinkGroup {
  kind: LinkKind;
  /** out: the item is the link's `from`; in: its `to`. */
  direction: "out" | "in";
  /** How the link reads from this item ("ships", "shipped by"). */
  label: string;
  items: SysmapItem[];
}

/** An item's links in both directions, grouped by kind (LINK_KINDS order, out before in), each group's items by name. */
export function linkGroups(graph: Pick<SysmapGraph, "items" | "links">, id: string): LinkGroup[] {
  const byId = new Map(graph.items.map((i) => [i.id, i]));
  const groups = new Map<string, LinkGroup>();
  for (const l of graph.links) {
    const direction = l.from === id ? "out" : l.to === id ? "in" : null;
    if (!direction) continue;
    const other = byId.get(direction === "out" ? l.to : l.from);
    if (!other) continue;
    const key = `${l.kind}:${direction}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind: l.kind, direction, label: direction === "out" ? LINK_KINDS[l.kind].label : LINK_KINDS[l.kind].reverse, items: [] }));
    if (!g.items.includes(other)) g.items.push(other);
  }
  const kinds = Object.keys(LINK_KINDS) as LinkKind[];
  return [...groups.values()]
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }));
}

/** The System Map's vocabulary for the renderer: item types for kinds, island names for groups, purposes in the search. */
export function sysmapSpec(graph: Pick<SysmapGraph, "islands">): MapSpec {
  const names = new Map<string, string>(graph.islands.map((s) => [s.id, s.name]));
  names.set(NO_ISLAND, "No discipline");
  return {
    kind: (k) => ITEM_TYPES[k as ItemType],
    groupName(key) {
      const at = key.indexOf(":");
      const type = key.slice(0, at);
      const value = key.slice(at + 1);
      if (type === "kind") return ITEM_TYPES[value as ItemType]?.label ?? value;
      return names.get(value) ?? value;
    },
    folderTitles: "names",
    titleAll: true,
    searchText: (n) => {
      const item = (n as SysmapNode).item;
      return item ? `${item.id} ${item.purpose}` : "";
    },
  };
}

/**
 * Each item type's default color and shape. Every type a hexagon; the
 * colors (the Atlas's swatches: the accent and its oranges stay the hover's
 * and the selection's) apply once "Color by type" is on. It starts off: the
 * map in neutral grays, the best-linked items a step stronger, as in the
 * approved design.
 */
export const SYSMAP_TYPE_STYLE: Record<ItemType, { shape: Shape; token: ThemeToken }> = {
  package: { shape: "hex", token: "text" },
  extension: { shape: "hex", token: "textMuted" },
  skill: { shape: "hex", token: "domainSoftware" },
  capability: { shape: "hex", token: "signalCan" },
  "capability-operation": { shape: "hex", token: "signalAnalog" },
  operation: { shape: "hex", token: "signalUart" },
  check: { shape: "hex", token: "domainThermal" },
  tool: { shape: "hex", token: "signalGround" },
  "cli-command": { shape: "hex", token: "domainPneumatic" },
  "mcp-tool": { shape: "hex", token: "signalDigital" },
  view: { shape: "hex", token: "domainHydraulic" },
  template: { shape: "hex", token: "domainNetwork" },
  example: { shape: "hex", token: "signalRf" },
  doc: { shape: "hex", token: "textFaint" },
};

const hexagons = Object.fromEntries(ITEM_TYPE_ORDER.map((t) => [t, "hex"])) as Record<ItemType, Shape>;

/** The item types' appearance table: their defaults and the shape presets (all hexagons; by type: what ships squares, how-to dots, what runs diamonds). */
export const SYSMAP_KIND_TABLE: KindTable = {
  order: ITEM_TYPE_ORDER,
  style: SYSMAP_TYPE_STYLE,
  presets: {
    hexagons,
    "by-type": {
      ...hexagons,
      package: "square",
      extension: "square",
      template: "square",
      example: "square",
      doc: "dot",
      skill: "dot",
      operation: "diamond",
      "capability-operation": "diamond",
      check: "diamond",
      "cli-command": "diamond",
      "mcp-tool": "diamond",
    },
  },
  colorByType: false,
};

/** The presets as the Appearance popover offers them. */
export const SYSMAP_PRESET_OPTIONS = [
  { id: "hexagons", icon: "hexagon", label: "All hexagons" },
  { id: "by-type", icon: "shapes", label: "Shapes by type: packages, extensions, templates and examples squares; skills and docs dots; operations, checks and commands diamonds; the rest hexagons" },
] as const;

/** Where the System Map keeps the person's settings (apart from the Atlas's), its positions, and per tab its camera. */
export const SYSMAP_KEYS = { ui: "protoboard.sysmap:ui", layout: "protoboard.sysmap:layout", session: "protoboard.sysmap:session" } as const;

/** Positions kept in local storage, read leniently (an entry that is not [x, y] of finite numbers is left out). */
export function parsePositions(raw: string | null | undefined): Record<string, [number, number]> | undefined {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const out: Record<string, [number, number]> = {};
    for (const [id, p] of Object.entries((v as { positions?: unknown }).positions ?? {})) {
      if (Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) out[id] = [p[0] as number, p[1] as number];
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

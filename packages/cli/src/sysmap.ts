/**
 * `protoboard map`: the System Map (docs/specs/system-map.md) of the stack
 * this CLI runs from: every package, extension, skill, operation, check,
 * external tool, CLI command, MCP tool, view, template and doc, grouped by
 * discipline, with versions, what changed in which release and the links
 * between them.
 *
 * Built on every run from the stack's files (and its git history, where it
 * has one). Nothing is written unless `--out` names a file: an installed
 * stack copy is never written into. `--island`, `--type` and `--item` answer
 * one question from the map, small enough for an agent (the `stack_map` MCP
 * tool runs them).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCIPLINES,
  DISCIPLINE_ORDER,
  ITEM_TYPES,
  ITEM_TYPE_ORDER,
  LINK_KINDS,
  buildSystemMap,
  byCodeUnit,
  serializeSystemMap,
  writeSystemMap,
  type DisciplineId,
  type ItemChange,
  type ItemStatus,
  type ItemType,
  type LinkKind,
  type SysmapIsland,
  type SysmapItem,
  type SysmapProblem,
  type SystemMap,
} from "@protoboardai/core";
import { closestNames } from "./atlas.js";

export const SYSMAP_QUERY_SCHEMA = "protoboard.sysmap-query/v0";

export const MAP_USAGE = "usage: protoboard map [--island <id> | --type <type> | --item <id>] [--root <dir>] [--out <file>] [--check] [--format json]";

// ---------------------------------------------------------------------------
// Which stack
// ---------------------------------------------------------------------------

export interface StackRoot {
  root: string;
  layout: "monorepo" | "installed";
}

/** What `stackRootOf` reads through (injectable for tests). */
export interface StackRootIo {
  exists(path: string): boolean;
  readJson(path: string): unknown;
}

const nodeIo: StackRootIo = { exists: existsSync, readJson: (p) => JSON.parse(readFileSync(p, "utf8")) };

/**
 * The stack a file belongs to, walking up from it: an ancestor named
 * `node_modules` makes its parent an installed stack (the folder holding
 * node_modules/@protoboardai, such as a copy in ~/.protoboard/stack/<version>);
 * the first ancestor whose package.json has `workspaces` is the stack's
 * repository (monorepo). Whichever comes first wins. null when neither is
 * found. Node resolves links when it loads the CLI, so a project's link into a
 * stack copy lands in the copy.
 */
export function stackRootOf(file: string, io: Partial<StackRootIo> = {}): StackRoot | null {
  const { exists, readJson } = { ...nodeIo, ...io };
  for (let d = dirname(resolve(file)); ; d = dirname(d)) {
    if (basename(d) === "node_modules") return { root: dirname(d), layout: "installed" };
    const pkg = join(d, "package.json");
    if (exists(pkg)) {
      let json: unknown;
      try {
        json = readJson(pkg);
      } catch {
        json = undefined;
      }
      const ws = json && typeof json === "object" && !Array.isArray(json) ? (json as { workspaces?: unknown }).workspaces : undefined;
      if (ws && (Array.isArray(ws) ? ws.length > 0 : typeof ws === "object")) return { root: d, layout: "monorepo" };
    }
    if (dirname(d) === d) return null;
  }
}

/** The stack this CLI runs from. */
export const thisStack = (): StackRoot | null => stackRootOf(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** An item as a query lists it: no facts, no detail. */
export interface MapQueryItem {
  id: string;
  type: ItemType;
  name: string;
  version: string | null;
  status: ItemStatus;
  discipline: DisciplineId | null;
  stage: number | null;
  purpose: string;
  changed: ItemChange | null;
  source: string;
  package?: string;
  degree: number;
}

/** A neighbor of the item asked about. */
export interface MapNeighbor {
  id: string;
  name: string;
  type: ItemType;
  version: string | null;
  status: ItemStatus;
}

/** The links of one kind, in one direction: "out" from the item asked about, "in" to it. */
export interface MapLinkGroup {
  kind: LinkKind;
  direction: "out" | "in";
  /** How the item stands to them: the kind's label (out) or its reverse (in). */
  label: string;
  items: MapNeighbor[];
}

interface QueryHead {
  schema: typeof SYSMAP_QUERY_SCHEMA;
  stack: string;
  layout: SystemMap["layout"];
}

export interface MapListAnswer extends QueryHead {
  query: { island?: DisciplineId; type?: ItemType };
  /** The island asked about, with its count over every type (an empty one says what the stack holds about it). */
  island?: SysmapIsland;
  total: number;
  items: MapQueryItem[];
}

export interface MapItemAnswer extends QueryHead {
  query: { item: string };
  item: SysmapItem;
  links: MapLinkGroup[];
  /** The map's problems about this item. */
  problems: SysmapProblem[];
}

const listed = (i: SysmapItem): MapQueryItem => ({
  id: i.id,
  type: i.type,
  name: i.name,
  version: i.version,
  status: i.status,
  discipline: i.discipline,
  stage: i.stage,
  purpose: i.purpose,
  changed: i.changed,
  source: i.source,
  ...(i.package ? { package: i.package } : {}),
  degree: i.degree,
});

/** A discipline by its id or name, case-insensitive; a usage error naming the ones there are. */
export function parseIsland(given: string): DisciplineId {
  const t = given.trim().toLowerCase();
  const found = DISCIPLINES.find((d) => d.id === t || d.name.toLowerCase() === t);
  if (!found) throw new Error(`--island takes one of ${DISCIPLINE_ORDER.join(", ")}, not "${given}"`);
  return found.id;
}

/** An item type by its id, its id prefix ("cli", "mcp"), its label or its noun, case-insensitive; a usage error naming the ones there are. */
export function parseType(given: string): ItemType {
  const t = given.trim().toLowerCase();
  const found = ITEM_TYPE_ORDER.find((k) => k === t || `${k}s` === t || ITEM_TYPES[k].prefix === t || ITEM_TYPES[k].label.toLowerCase() === t || ITEM_TYPES[k].one.toLowerCase() === t);
  if (!found) throw new Error(`--type takes one of ${ITEM_TYPE_ORDER.join(", ")}, not "${given}"`);
  return found;
}

/** The item a ref names: its id, else the one item whose id, key or name it is (case-insensitive); a usage error with the closest ids. */
export function findItem(map: SystemMap, ref: string): SysmapItem {
  const given = ref.trim();
  const exact = map.items.find((i) => i.id === given);
  if (exact) return exact;
  const lower = given.toLowerCase();
  const loose = map.items.filter((i) => i.id.toLowerCase() === lower || i.id.slice(i.id.indexOf(":") + 1).toLowerCase() === lower || i.name.toLowerCase() === lower);
  if (loose.length === 1) return loose[0]!;
  if (loose.length > 1) throw new Error(`"${ref}" names ${loose.length} items of the System Map: ${loose.map((i) => i.id).join(", ")}; ask for one by its id`);
  const closest = closestNames(given, map.items.map((i) => i.id), 5);
  throw new Error(`no item "${ref}" in the System Map${closest.length ? `; closest: ${closest.join(", ")}` : ""}. Ids are <type prefix>:<key> (cli:map, mcp:stack_map, skill:build-a-project); --type <type> lists them`);
}

const typeRank = (t: ItemType) => ITEM_TYPE_ORDER.indexOf(t);

/** The items of an island, of a type, or both: by type, then id. */
export function listItems(map: SystemMap, q: { island?: DisciplineId; type?: ItemType }): MapListAnswer {
  const items = map.items
    .filter((i) => (!q.island || i.discipline === q.island) && (!q.type || i.type === q.type))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || byCodeUnit(a.id, b.id))
    .map(listed);
  const island = q.island ? map.islands.find((i) => i.id === q.island) : undefined;
  return { schema: SYSMAP_QUERY_SCHEMA, stack: map.stack, layout: map.layout, query: { ...(q.island ? { island: q.island } : {}), ...(q.type ? { type: q.type } : {}) }, ...(island ? { island } : {}), total: items.length, items };
}

const KIND_ORDER = Object.keys(LINK_KINDS) as LinkKind[];

/** One item with every link in both directions, grouped by kind (the model's order), out before in, each group by id. */
export function itemAnswer(map: SystemMap, ref: string): MapItemAnswer {
  const item = findItem(map, ref);
  const byId = new Map(map.items.map((i) => [i.id, i]));
  const groups = new Map<string, MapLinkGroup>();
  const add = (kind: LinkKind, direction: "out" | "in", other: string) => {
    const n = byId.get(other);
    if (!n) return;
    const key = `${kind} ${direction}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kind, direction, label: direction === "out" ? LINK_KINDS[kind].label : LINK_KINDS[kind].reverse, items: [] }));
    if (!g.items.some((x) => x.id === n.id)) g.items.push({ id: n.id, name: n.name, type: n.type, version: n.version, status: n.status });
  };
  for (const l of map.links) {
    if (l.from === item.id && l.to !== item.id) add(l.kind, "out", l.to);
    else if (l.to === item.id && l.from !== item.id) add(l.kind, "in", l.from);
  }
  const links = [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1));
  for (const g of links) g.items.sort((a, b) => byCodeUnit(a.id, b.id));
  return { schema: SYSMAP_QUERY_SCHEMA, stack: map.stack, layout: map.layout, query: { item: ref }, item, links, problems: map.problems.filter((p) => p.item === item.id) };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Columns padded to the widest cell, the last left as it is. */
function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(widths[i]!) : c)).join("  ").trimEnd());
}

const versionText = (v: string | null, status: ItemStatus) => `${v ?? "no version"}${status === "released" ? "" : `, ${status}`}`;
const changedText = (c: ItemChange | null) => (c ? `changed in ${c.in === "unreleased" ? "work since the last release" : `${c.in}${c.date ? ` (${c.date})` : ""}`}: ${c.why}` : "");

/** The summary `protoboard map` prints: the stack, the islands, the counts by type, the problems. */
export function summaryText(map: SystemMap, root: string): string {
  const c = map.counts;
  const last = map.releases[map.releases.length - 1];
  const lines = [
    `System Map of the Protoboard stack ${map.stack} (${map.layout}: ${root})`,
    `${c.items} items, ${c.links} links, ${c.problems} problem(s); ${last ? `${map.releases.length} release(s), the last ${last.tag}${last.date ? ` (${last.date})` : ""}` : "no release history"}`,
    "",
    "Islands",
    ...table(map.islands.map((i) => [`  ${i.id}`, i.name, i.empty ? "empty" : String(i.items), ...(i.empty && i.note ? [i.note] : [])])),
    ...(c.byDiscipline.none ? [`  (no discipline: ${c.byDiscipline.none})`] : []),
    "",
    "By type",
    ...table(ITEM_TYPE_ORDER.filter((t) => c.byType[t]).map((t) => [`  ${ITEM_TYPES[t].label}`, String(c.byType[t])])),
  ];
  if (map.problems.length) lines.push("", "Problems", ...table(map.problems.map((p) => [`  ${p.reason}`, p.item ?? p.path ?? "", p.message])));
  lines.push("", "--island <id>, --type <type> or --item <id> asks one question; --format json prints the whole map");
  return lines.join("\n");
}

function listText(a: MapListAnswer): string {
  const what = [a.island ? `island ${a.island.id} (${a.island.name}: ${a.island.gloss})` : "", a.query.type ? ITEM_TYPES[a.query.type].label : ""].filter(Boolean).join(", ");
  const head = `${a.total} item(s) of the System Map (stack ${a.stack}): ${what}`;
  if (!a.total) return [head, a.island?.empty && a.island.note ? `  ${a.island.note}` : "  none"].join("\n");
  const rows = a.items.map((i) => [`  ${i.id}`, i.type, versionText(i.version, i.status), ...(a.query.island ? [] : [i.discipline ?? "-"]), i.purpose]);
  return [head, ...table(rows)].join("\n");
}

function itemText(a: MapItemAnswer): string {
  const i = a.item;
  const where = [i.discipline ? `${DISCIPLINES.find((d) => d.id === i.discipline)?.name ?? i.discipline}` : "no discipline", i.stage !== null ? `stage ${i.stage}` : ""].filter(Boolean).join(", ");
  const lines = [`${i.id} "${i.name}" (${ITEM_TYPES[i.type].one}, ${versionText(i.version, i.status)}; ${where})`, `  ${i.purpose}`, `  source: ${i.source}${i.package ? ` (${i.package})` : ""}`];
  const changed = changedText(i.changed);
  if (changed) lines.push(`  ${changed}`);
  for (const p of a.problems) lines.push(`  problem: ${p.reason}: ${p.message}`);
  if (!a.links.length) lines.push("", "no links");
  for (const g of a.links) {
    lines.push("", `${g.label} (${g.items.length})`, ...table(g.items.map((n) => [`  ${n.id}`, n.type, versionText(n.version, n.status)])));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export interface MapContext {
  json: boolean;
  cwd: string;
  /** Prints an answer: JSON as given, or the text. */
  out: (data: unknown, text: () => string) => void;
  /** Prints text as it is (the whole map's bytes). Default: stdout. */
  write?: (text: string) => void;
  /** Says something beside the answer. Default: stderr. */
  say?: (text: string) => void;
  flags: { root?: string; out?: string; island?: string; type?: string; item?: string; check?: boolean };
  /** The stack to map without --root (default: the one this CLI runs from). */
  stack?: () => StackRoot | null;
}

const given = (name: string, v: string | undefined, what: string): string | undefined => {
  if (v === undefined) return undefined;
  if (!v.trim()) throw new Error(`--${name} takes ${what} (${MAP_USAGE})`);
  return v;
};

/**
 * `protoboard map`: usage errors throw (exit 2); the exit code it returns is 1
 * with --check when the map lists problems, else 0.
 */
export async function mapCommand(args: string[], ctx: MapContext): Promise<{ code: 0 | 1 }> {
  if (args.length) throw new Error(`protoboard map takes no words (${MAP_USAGE})`);
  // usage first: a malformed command is exit 2 before anything is read
  const islandFlag = given("island", ctx.flags.island, "a discipline id");
  const typeFlag = given("type", ctx.flags.type, "an item type");
  const itemFlag = given("item", ctx.flags.item, "an item id");
  const rootFlag = given("root", ctx.flags.root, "a folder");
  const outFlag = given("out", ctx.flags.out, "a file");
  if (itemFlag !== undefined && (islandFlag !== undefined || typeFlag !== undefined)) throw new Error(`--item takes no --island or --type: it answers one item with all its links (${MAP_USAGE})`);
  const island = islandFlag !== undefined ? parseIsland(islandFlag) : undefined;
  const type = typeFlag !== undefined ? parseType(typeFlag) : undefined;

  let root: string;
  if (rootFlag !== undefined) {
    root = resolve(ctx.cwd, rootFlag);
    let dir = false;
    try {
      dir = statSync(root).isDirectory();
    } catch {
      dir = false;
    }
    if (!dir) throw new Error(`--root: no folder ${root}`);
  } else {
    const found = (ctx.stack ?? thisStack)();
    if (!found) throw new Error("this protoboard runs neither from the stack's repository nor from an installed stack copy (no package.json with workspaces, no node_modules above it): pass --root <dir>");
    root = found.root;
  }

  let map: SystemMap;
  let wrote: string | undefined;
  if (outFlag !== undefined) {
    const r = await writeSystemMap(root, { file: resolve(ctx.cwd, outFlag) });
    map = r.map;
    wrote = r.file;
  } else map = await buildSystemMap(root);

  const write = ctx.write ?? ((t: string) => void process.stdout.write(t));
  const say = ctx.say ?? ((t: string) => void process.stderr.write(`protoboard: ${t}\n`));
  if (itemFlag !== undefined) {
    const a = itemAnswer(map, itemFlag);
    ctx.out(a, () => itemText(a) + (wrote && !ctx.json ? `\n\nwrote ${wrote}` : ""));
  } else if (island || type) {
    const a = listItems(map, { ...(island ? { island } : {}), ...(type ? { type } : {}) });
    ctx.out(a, () => listText(a) + (wrote && !ctx.json ? `\n\nwrote ${wrote}` : ""));
  } else if (ctx.json) write(serializeSystemMap(map));
  else ctx.out(map, () => summaryText(map, root) + (wrote ? `\nwrote ${wrote}` : ""));
  // JSON stays the answer alone: where the file went is said beside it
  if (wrote && ctx.json) say(`wrote ${wrote}`);
  if (!ctx.flags.check || !map.problems.length) return { code: 0 };
  // the summary lists them; a query answer and the JSON do not say it in words
  if (ctx.json || island || type || itemFlag !== undefined) say(`--check: the System Map lists ${map.problems.length} problem(s) (${[...new Set(map.problems.map((p) => p.reason))].join(", ")})`);
  return { code: 1 };
}

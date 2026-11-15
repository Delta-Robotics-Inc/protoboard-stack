/**
 * `protoboard index census | where <ref> | search <text>`: read-only queries
 * over the project index that `protoboard build` writes
 * (.protoboard/build/atlas.json, docs/specs/atlas.md).
 *
 * Every query reads the index and nothing else of the model: no query loads
 * protoboard.config.ts or evaluates any of the project's TypeScript. Only the
 * project root is located. Before answering, the index is checked against the
 * project's files; an index that is missing, unreadable, from another schema
 * or older than the files is refused with exit code 3 and no partial answer.
 *
 * Output is paginated (default 20 items, at most 200) in a stable order, with
 * an opaque cursor bound to the index it came from.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  ATLAS_KINDS,
  ATLAS_KIND_ORDER,
  FRAMEWORK_VERSION,
  atlasFreshness,
  byCodeUnit,
  findProjectRoot,
  isSensitiveName,
  readAtlasIndex,
  type AtlasCounts,
  type AtlasCreated,
  type AtlasEdge,
  type AtlasFreshness,
  type AtlasIndex,
  type AtlasKind,
  type AtlasNode,
  type CensusEntry,
  type CensusStatus,
  type EdgeType,
  type FileKind,
  type NodeStatus,
} from "@protoboardai/core";

/** The exit code of every index refusal (missing, invalid, another schema, stale). */
export const INDEX_EXIT_CODE = 3;
export const QUERY_SCHEMA = "protoboard.atlas-query/v0";
export type IndexErrorCode = "INDEX_MISSING" | "INDEX_INVALID" | "INDEX_SCHEMA" | "INDEX_STALE";

/** The index cannot answer: the command prints this and exits with INDEX_EXIT_CODE, with no partial answer. */
export class AtlasUnavailableError extends Error {
  constructor(
    readonly code: IndexErrorCode,
    message: string,
    readonly freshness?: AtlasFreshness,
  ) {
    super(message);
    this.name = "AtlasUnavailableError";
  }
}

export interface Page<T> {
  schema: typeof QUERY_SCHEMA;
  query: Record<string, unknown>;
  total: number;
  items: T[];
  nextCursor?: string;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

const FILE_KINDS = ATLAS_KIND_ORDER.filter((k): k is FileKind => k !== "module" && k !== "part");
const CENSUS_STATUSES: readonly CensusStatus[] = ["linked", "unlinked", "failed"];

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

const digestTag = (digest: string) => digest.replace(/^sha256:/, "").slice(0, 12);

/** An opaque cursor: "<offset>.<first 12 hex of the index digest>". */
export function encodeCursor(offset: number, digest: string): string {
  return `${offset}.${digestTag(digest)}`;
}

/** The offset a cursor carries; a cursor that is malformed or from another index is refused (a usage error, exit 2). */
export function decodeCursor(cursor: string, digest: string): number {
  const m = /^(\d{1,9})\.([0-9a-f]{12})$/.exec(cursor.trim());
  if (!m) throw new Error(`--cursor "${cursor.slice(0, 40)}" is not a cursor of \`protoboard index\`: pass the nextCursor of the previous page`);
  if (m[2] !== digestTag(digest)) throw new Error("this cursor belongs to an earlier project index (the project was built again since): run the query again without --cursor");
  return Number(m[1]);
}

function page<T>(all: T[], query: Record<string, unknown>, digest: string, limit: number, offset: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { schema: QUERY_SCHEMA, query, total: all.length, items, ...(next < all.length ? { nextCursor: encodeCursor(next, digest) } : {}) };
}

// ---------------------------------------------------------------------------
// Opening the index
// ---------------------------------------------------------------------------

/** A creation time as text output shows it: "created 2026-11-03 (git)", the date in UTC; "" for none. */
export function createdText(created: AtlasCreated | undefined): string {
  if (!created || !Number.isFinite(created.at)) return "";
  const d = new Date(created.at);
  return Number.isNaN(d.getTime()) ? "" : `created ${d.toISOString().slice(0, 10)} (${created.from})`;
}

/** How many changed files a refusal names. */
const NAMED = 5;

/** Why a stale index is refused, naming up to 5 files. */
export function staleMessage(index: AtlasIndex, f: AtlasFreshness): string {
  const build = "run `protoboard build` to index the project again";
  if (f.reason === "stack") return `the project index was written by Protoboard ${index.stack}, not by this one (${FRAMEWORK_VERSION}); ${build}`;
  if (f.reason === "history") return `the project index was built before creation times were recorded; ${build}`;
  if (f.reason === "enumerator") return `the project index listed the project's files with ${index.enumerator === "git" ? "git" : "a folder walk"}, and they are listed with ${index.enumerator === "git" ? "a folder walk" : "git"} now (git appeared or went); ${build}`;
  const named = [...f.changed.map((p) => `${p} (changed)`), ...f.added.map((p) => `${p} (added)`), ...f.removed.map((p) => `${p} (removed)`)];
  const total = f.changed.length + f.added.length + f.removed.length;
  // each list stops at 20 paths: past that the count is a lower bound
  const capped = f.changed.length >= 20 || f.added.length >= 20 || f.removed.length >= 20;
  const more = total > NAMED ? `, and ${total - NAMED}${capped ? " or more" : ""} more` : "";
  return `the project index is older than the project's files: ${named.slice(0, NAMED).join(", ")}${more}; ${build}`;
}

/**
 * The project's index, checked against its files. Throws AtlasUnavailableError
 * when it is missing, unreadable, from another schema or stale; a plain Error
 * (exit 2) when there is no project. Never loads protoboard.config.ts.
 */
export async function openFreshIndex(cwd: string): Promise<{ root: string; index: AtlasIndex; digest: string; freshness: AtlasFreshness }> {
  const root = findProjectRoot(cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
  const read = readAtlasIndex(root);
  if ("error" in read) throw new AtlasUnavailableError(read.error, read.message);
  const freshness = await atlasFreshness(root, read.index);
  if (!freshness.fresh) throw new AtlasUnavailableError("INDEX_STALE", staleMessage(read.index, freshness), freshness);
  return { root, index: read.index, digest: read.digest, freshness };
}

// ---------------------------------------------------------------------------
// census
// ---------------------------------------------------------------------------

export interface CensusItem extends CensusEntry {
  /** The definitions whose artifacts name the file (or a folder holding it). */
  owners?: string[];
}

export interface CensusResult {
  counts: AtlasCounts["census"] & { byKind: Partial<Record<FileKind, { linked: number; unlinked: number; failed: number }>> };
  items: CensusItem[];
}

/** Every asset file, filtered by kind and status, sorted by path; the counts are of the whole census. */
export function census(index: AtlasIndex, q: { kind?: FileKind; status?: CensusStatus } = {}): CensusResult {
  const byKind: CensusResult["counts"]["byKind"] = {};
  for (const kind of FILE_KINDS) {
    const of = index.census.filter((c) => c.kind === kind);
    if (of.length) byKind[kind] = { linked: of.filter((c) => c.status === "linked").length, unlinked: of.filter((c) => c.status === "unlinked").length, failed: of.filter((c) => c.status === "failed").length };
  }
  const nodes = new Map(index.nodes.map((n) => [n.id, n]));
  const items = index.census
    .filter((c) => (!q.kind || c.kind === q.kind) && (!q.status || c.status === q.status))
    .sort((a, b) => byCodeUnit(a.path, b.path))
    .map((c): CensusItem => {
      const owners = nodes.get(`file:${c.path}`)?.file?.owners ?? [];
      return owners.length ? { ...c, owners: [...owners] } : { ...c };
    });
  return { counts: { ...index.counts.census, byKind }, items };
}

// ---------------------------------------------------------------------------
// where
// ---------------------------------------------------------------------------

/** How a related node stands to the one asked about: the edge's type, or its reverse when the edge points at it. */
export type WhereRelation = EdgeType | "owned-by" | "source-of" | "contained-by" | "used-by";

/** The order relations are listed in. */
export const WHERE_ORDER: readonly WhereRelation[] = ["has", "made-from", "source-of", "contains", "uses", "contained-by", "used-by", "owned-by", "link", "harness"];

const REVERSE: Partial<Record<EdgeType, WhereRelation>> = { has: "owned-by", "made-from": "source-of", contains: "contained-by", uses: "used-by" };

export interface WhereItem {
  relation: WhereRelation;
  node: string;
  kind: AtlasKind;
  label: string;
  path?: string;
  /** For a module or part: its definition id. */
  definition?: string;
  status: NodeStatus;
  size?: number;
  /** Artifact ids (has, made-from) or link and harness ids (link, harness). */
  via?: string[];
  /** Links between the two definitions. */
  count?: number;
  /** The related node's creation time, as on the node. */
  created?: AtlasCreated;
}

export interface WhereResult {
  matchedBy: "instance" | "definition" | "path" | "name";
  node: AtlasNode;
  /** The instance paths that use the definition (for an instance: that instance first). */
  instances: string[];
  items: WhereItem[];
}

/** A usage error with the ref's closest names (exit 2). */
function unknownRef(index: AtlasIndex, ref: string): Error {
  const names = new Set<string>([...Object.keys(index.instances).filter(Boolean), ...index.nodes.filter((n) => n.definition).map((n) => n.definition!.id), ...index.nodes.map((n) => n.path ?? n.label)]);
  const closest = closestNames(ref, [...names], 5);
  return new Error(
    `nothing in the project index is called "${ref}" (not an instance path, a definition id, a file path or a name)${closest.length ? `; closest: ${closest.join(", ")}` : ""}. \`protoboard index search ${ref}\` searches by words`,
  );
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Up to `n` names closest to `ref`: names containing it first, then by edit distance, then code-unit order. */
export function closestNames(ref: string, names: string[], n: number): string[] {
  const r = ref.toLowerCase();
  return names
    .map((name) => {
      const l = name.toLowerCase();
      return { name, contains: l.includes(r) || r.includes(l) ? 0 : 1, d: distance(r, l.length > 80 ? l.slice(0, 80) : l) };
    })
    .filter((x) => x.contains === 0 || x.d <= Math.max(3, Math.floor(r.length / 2)))
    .sort((a, b) => a.contains - b.contains || a.d - b.d || byCodeUnit(a.name, b.name))
    .slice(0, n)
    .map((x) => x.name);
}

/** The node a ref names: an instance path, then a definition id, then a node id or file path, then an exact name (case-insensitive). */
function resolveRef(index: AtlasIndex, ref: string): { matchedBy: WhereResult["matchedBy"]; node: AtlasNode; instance?: string } {
  const nodes = new Map(index.nodes.map((n) => [n.id, n]));
  const trimmed = ref.trim();
  const instanceDef = Object.prototype.hasOwnProperty.call(index.instances, trimmed) ? index.instances[trimmed] : undefined;
  if (instanceDef !== undefined) {
    const node = nodes.get(`def:${instanceDef}`);
    if (node) return { matchedBy: "instance", node, instance: trimmed };
  }
  const def = nodes.get(`def:${trimmed}`);
  if (def) return { matchedBy: "definition", node: def };
  const byId = /^(def|file|dir|url):/.test(trimmed) ? nodes.get(trimmed) : undefined;
  if (byId) return { matchedBy: byId.definition ? "definition" : "path", node: byId };
  const path = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  const file = nodes.get(`file:${path}`) ?? nodes.get(`dir:${path.replace(/\/*$/, "/")}`);
  if (file) return { matchedBy: "path", node: file };
  const lower = trimmed.toLowerCase();
  const named = index.nodes.filter((n) => n.label.toLowerCase() === lower);
  if (named.length === 1) return { matchedBy: "name", node: named[0]! };
  if (named.length > 1) {
    const list = named.slice(0, 10).map((n) => n.definition?.id ?? n.path ?? n.id);
    throw new Error(`"${ref}" is the name of ${named.length} things in the project index: ${list.join(", ")}${named.length > 10 ? ", …" : ""}. Ask for one by its definition id or path`);
  }
  throw unknownRef(index, ref);
}

/** Where a thing is: the node a ref names and every node one edge away, by relation, then path. */
export function where(index: AtlasIndex, ref: string, q: { kind?: AtlasKind } = {}): WhereResult {
  const { matchedBy, node, instance } = resolveRef(index, ref);
  const nodes = new Map(index.nodes.map((n) => [n.id, n]));
  const items: WhereItem[] = [];
  const add = (e: AtlasEdge, other: string, relation: WhereRelation) => {
    const n = nodes.get(other);
    if (!n || (q.kind && n.kind !== q.kind)) return;
    items.push({
      relation,
      node: n.id,
      kind: n.kind,
      label: n.label,
      ...(n.path ? { path: n.path } : {}),
      ...(n.definition ? { definition: n.definition.id } : {}),
      status: n.status,
      ...(n.file ? { size: n.file.size } : {}),
      ...(e.via?.length ? { via: [...e.via] } : {}),
      ...(e.count !== undefined ? { count: e.count } : {}),
      ...(n.created ? { created: { ...n.created } } : {}),
    });
  };
  for (const e of index.edges) {
    if (e.from === node.id && e.to !== node.id) add(e, e.to, e.type);
    else if (e.to === node.id && e.from !== node.id) add(e, e.from, e.type === "link" || e.type === "harness" ? e.type : (REVERSE[e.type] ?? e.type));
  }
  const rank = (r: WhereRelation) => WHERE_ORDER.indexOf(r);
  // a file by its path; a module or part by its path too (the file that defines it), then by its id
  items.sort((a, b) => rank(a.relation) - rank(b.relation) || byCodeUnit(a.path ?? a.label, b.path ?? b.label) || byCodeUnit(a.node, b.node));
  const used = node.definition?.instances ?? [];
  const instances = instance ? [instance, ...used.filter((i) => i !== instance)] : [...used];
  return { matchedBy, node, instances, items };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export interface SearchHit {
  match: "exact" | "name" | "path" | "kind" | "text";
  node?: string;
  kind?: AtlasKind;
  label?: string;
  path: string;
  line?: number;
  text?: string;
  /** The node's creation time (a text hit: its file's). */
  created?: AtlasCreated;
}

const MATCH_ORDER: SearchHit["match"][] = ["exact", "name", "path", "kind", "text"];
/** Files whose lines are searched (A15): plain-text documents only, no PDF or HTML. */
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "rst", "adoc"]);
const TEXT_MAX_BYTES = 1024 * 1024;
const SNIPPET = 160;

/** The kind a word names: an id ("render"), a label ("renders", "3d models") or a singular noun ("cad file"). */
export function kindNamed(text: string): AtlasKind | undefined {
  const t = text.trim().toLowerCase();
  return ATLAS_KIND_ORDER.find((k) => k === t || ATLAS_KINDS[k].label.toLowerCase() === t || ATLAS_KINDS[k].one.toLowerCase() === t || `${k}s` === t);
}

/** A line cut to at most 160 characters around the first word found. */
function snippet(line: string, words: string[]): string {
  const text = line.trim();
  if (text.length <= SNIPPET) return text;
  const at = Math.max(0, Math.min(...words.map((w) => text.toLowerCase().indexOf(w)).filter((i) => i >= 0)));
  const start = Math.max(0, Math.min(at - 40, text.length - (SNIPPET - 1)));
  const cut = text.slice(start, start + SNIPPET - (start > 0 ? 2 : 1));
  return `${start > 0 ? "…" : ""}${cut}…`;
}

/** Whether a census path may be read for full text: a project-relative input of this index, never sensitive. */
function readablePath(inputs: Set<string>, path: string): boolean {
  return inputs.has(path) && !isAbsolute(path) && !path.split(/[/\\]/).includes("..") && !isSensitiveName(path);
}

/**
 * Search by words, in tiers: an exact id, name or path; a name that holds
 * every word, then a path that does; every node of a kind the text names;
 * then the lines of the project's plain-text documents that hold every word.
 * A node is listed once, at its best tier.
 */
export async function search(root: string, index: AtlasIndex, text: string): Promise<SearchHit[]> {
  const whole = text.trim().toLowerCase();
  const words = whole.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const hit = (n: AtlasNode, match: SearchHit["match"]) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    hits.push({ match, node: n.id, kind: n.kind, label: n.label, path: n.path ?? n.url ?? n.id, ...(n.created ? { created: { ...n.created } } : {}) });
  };
  const bare = (id: string) => id.replace(/^(def|file|dir|url):/, "");
  // 1. exact: a node id (with or without its prefix), a name, a path, or an instance path
  const instanceDef = Object.prototype.hasOwnProperty.call(index.instances, text.trim()) ? index.instances[text.trim()] : undefined;
  for (const n of index.nodes) {
    if (n.id.toLowerCase() === whole || bare(n.id).toLowerCase() === whole || n.label.toLowerCase() === whole || n.path?.toLowerCase() === whole || (instanceDef !== undefined && n.id === `def:${instanceDef}`)) hit(n, "exact");
  }
  const all = (s: string | undefined) => !!s && words.every((w) => s.toLowerCase().includes(w));
  // 2. a name that holds every word, then a path
  for (const n of index.nodes) if (all(n.label) || all(n.definition?.id)) hit(n, "name");
  for (const n of index.nodes) if (all(n.path)) hit(n, "path");
  // 3. a kind
  const kind = kindNamed(whole);
  if (kind) for (const n of index.nodes) if (n.kind === kind) hit(n, "kind");
  // 4. the lines of plain-text documents
  const inputs = new Set(index.inputs.map((i) => i[0]));
  const nodeById = new Map(index.nodes.map((n) => [n.id, n]));
  for (const c of index.census) {
    if (c.kind !== "doc" || c.status === "failed" || !TEXT_EXTENSIONS.has(c.ext) || c.size > TEXT_MAX_BYTES || !readablePath(inputs, c.path)) continue;
    let body: string;
    try {
      body = await readFile(join(root, c.path), "utf8");
    } catch {
      continue;
    }
    if (body.includes("\0")) continue;
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!all(lines[i])) continue;
      const created = nodeById.get(`file:${c.path}`)?.created ?? c.created;
      hits.push({ match: "text", node: `file:${c.path}`, kind: c.kind, path: c.path, line: i + 1, text: snippet(lines[i]!, words), ...(created ? { created: { ...created } } : {}) });
    }
  }
  const rank = (m: SearchHit["match"]) => MATCH_ORDER.indexOf(m);
  return hits.sort((a, b) => rank(a.match) - rank(b.match) || byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.node ?? "", b.node ?? ""));
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export const INDEX_USAGE =
  "usage: protoboard index census [--kind <kind>] [--status linked|unlinked|failed] | protoboard index where <ref> [--kind <kind>] | protoboard index search <text>; each takes --limit <1-200> and --cursor <c>";

export interface IndexContext {
  json: boolean;
  cwd: string;
  out: (data: unknown, text: () => string) => void;
  flags: { kind?: string; status?: string; limit?: number; cursor?: string };
}

/** Columns padded to the widest cell, the last left as it is. */
function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(widths[i]!) : c)).join("  ").trimEnd());
}

function pageFooter(p: Page<unknown>, offset: number): string[] {
  if (!p.total) return [];
  const shown = p.items.length ? `showing ${offset + 1}-${offset + p.items.length} of ${p.total}` : `nothing past item ${offset} of ${p.total}`;
  return [p.nextCursor ? `${shown}; the next page: --cursor ${p.nextCursor}` : shown];
}

function parseLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`--limit takes a whole number from 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`);
  return limit;
}

function parseKind<K extends AtlasKind>(given: string | undefined, allowed: readonly K[]): K | undefined {
  if (given === undefined) return undefined;
  const k = kindNamed(given);
  if (k && (allowed as readonly AtlasKind[]).includes(k)) return k as K;
  throw new Error(`--kind takes one of ${allowed.join(", ")}, not "${given}"`);
}

/** `protoboard index <sub>`: usage errors throw (exit 2); an unusable index prints its refusal and sets exit code 3. */
export async function indexCommand(args: string[], ctx: IndexContext): Promise<void> {
  const [sub, ...rest] = args;
  const words = rest.join(" ").trim();
  if (sub !== "census" && sub !== "where" && sub !== "search") throw new Error(INDEX_USAGE);
  // usage first: a malformed command is exit 2 whatever the index's state
  const limit = parseLimit(ctx.flags.limit);
  if (sub === "census" && rest.length) throw new Error(`index census takes no words (${INDEX_USAGE})`);
  if (sub !== "census" && !words) throw new Error(sub === "where" ? "usage: protoboard index where <ref>: an instance path (arm_fl/motor), a definition id, a file path or a name" : "usage: protoboard index search <text>");
  if (sub !== "census" && ctx.flags.status !== undefined) throw new Error(`--status is for index census only (${INDEX_USAGE})`);
  if (sub === "search" && ctx.flags.kind !== undefined) throw new Error(`index search takes no --kind: search for the kind itself ("renders"), or use index census --kind (${INDEX_USAGE})`);
  const status = ctx.flags.status === undefined ? undefined : (CENSUS_STATUSES as readonly string[]).includes(ctx.flags.status) ? (ctx.flags.status as CensusStatus) : undefined;
  if (ctx.flags.status !== undefined && !status) throw new Error(`--status takes linked, unlinked or failed, not "${ctx.flags.status}"`);
  const fileKind = sub === "census" ? parseKind(ctx.flags.kind, FILE_KINDS) : undefined;
  const kind = sub === "census" ? fileKind : sub === "where" ? parseKind(ctx.flags.kind, ATLAS_KIND_ORDER) : undefined;

  let opened: Awaited<ReturnType<typeof openFreshIndex>>;
  try {
    opened = await openFreshIndex(ctx.cwd);
  } catch (e) {
    if (!(e instanceof AtlasUnavailableError)) throw e;
    // no partial answer: the refusal only, and its own exit code
    if (ctx.json) process.stdout.write(JSON.stringify({ error: e.message, code: e.code, ...(e.freshness ? { freshness: e.freshness } : {}) }) + "\n");
    else process.stderr.write(`protoboard: ${e.message}\n`);
    process.exitCode = INDEX_EXIT_CODE;
    return;
  }
  const { root, index, digest } = opened;
  const offset = ctx.flags.cursor !== undefined ? decodeCursor(ctx.flags.cursor, digest) : 0;

  if (sub === "census") {
    const r = census(index, { ...(fileKind ? { kind: fileKind } : {}), ...(status ? { status } : {}) });
    const p = page(r.items, { command: "census", ...(kind ? { kind } : {}), ...(status ? { status } : {}), limit }, digest, limit, offset);
    ctx.out({ ...p, counts: r.counts }, () => {
      const c = r.counts;
      const head = [
        `${c.total} asset file(s): ${c.linked} linked, ${c.unlinked} unlinked, ${c.failed} failed${c.excluded ? ` (${c.excluded} with sensitive names left out)` : ""}`,
        ...table(FILE_KINDS.filter((k) => c.byKind[k]).map((k) => [`  ${ATLAS_KINDS[k].label}`, `${c.byKind[k]!.linked} linked`, `${c.byKind[k]!.unlinked} unlinked`, ...(c.byKind[k]!.failed ? [`${c.byKind[k]!.failed} failed`] : [])])),
        "",
      ];
      if (!p.total) return [...head, `no asset files${kind ? ` of kind ${kind}` : ""}${status ? ` ${status}` : ""}`].join("\n");
      const rows = p.items.map((i) => [i.path, i.kind, i.status === "failed" ? `failed (${i.reason ?? "?"})` : i.status, createdText(i.created), i.owners?.join(", ") ?? i.linkedBy?.[0] ?? ""]);
      return [...head, ...table(rows), ...pageFooter(p, offset)].join("\n");
    });
    return;
  }

  if (sub === "where") {
    const r = where(index, words, kind ? { kind } : {});
    const p = page(r.items, { command: "where", ref: words, ...(kind ? { kind } : {}), limit }, digest, limit, offset);
    ctx.out({ ...p, matchedBy: r.matchedBy, node: r.node, instances: r.instances }, () => {
      const n = r.node;
      const what = n.definition ? `${n.definition.id} "${n.label}" (${n.kind}, ${n.definition.tier}${n.status === "unused" ? ", unused" : ""})` : `${n.path ?? n.id} (${n.kind}, ${n.status}${n.reason ? `: ${n.reason}` : ""})`;
      const born = createdText(n.created);
      const head = [
        `${r.matchedBy === "instance" ? `${words}: an instance of ${what}` : what}${born ? `, ${born}` : ""}`,
        ...(n.path && n.definition ? [`defined in ${n.path}`] : []),
        ...(r.instances.length ? [`instances: ${r.instances.slice(0, 12).join(", ")}${r.instances.length > 12 ? `, and ${r.instances.length - 12} more` : ""}`] : []),
        "",
      ];
      if (!p.total) return [...head, `nothing related${kind ? ` of kind ${kind}` : ""}`].join("\n");
      const rows = p.items.map((i) => [i.relation, i.kind, i.status, i.definition ?? i.path ?? i.label, createdText(i.created), i.count !== undefined ? `${i.count} link(s)` : i.via?.length ? i.via.join(", ") : ""]);
      return [...head, ...table(rows), ...pageFooter(p, offset)].join("\n");
    });
    return;
  }

  const hits = await search(root, index, words);
  const p = page(hits, { command: "search", text: words, limit }, digest, limit, offset);
  ctx.out(p, () => {
    if (!p.total) return `nothing in the project index matches "${words}"`;
    const rows = p.items.map((h) => [h.match, h.kind ?? "", h.line !== undefined ? `${h.path}:${h.line}` : h.path, h.text ?? (h.label && h.label !== h.path.split("/").pop() ? h.label : ""), createdText(h.created)]);
    return [...table(rows), ...pageFooter(p, offset)].join("\n");
  });
}

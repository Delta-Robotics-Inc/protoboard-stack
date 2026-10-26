/**
 * The library's data as the shells compute it (docs/specs/vscode-extension.md
 * § 2.3, PB-902): the category drill-down, the result rows and a part's
 * preview from the library client's answers, and their mapping onto the
 * views' models (model.ts). Plain functions with no host API and no React:
 * the VS Code extension (`@protoboardai/views/parts-data`) and `protoboard dev`
 * run the same code, and the unit tests run it directly.
 */
import type { LibraryHit, MergedTaxonomyNode } from "@protoboardai/core/library-client";
import { LIBRARY_SORTS, compareHits, isLibrarySort, localSorts, type LibrarySort } from "@protoboardai/core/library-sort";
import { PART_TRUST_TEXT, partTrust, type PartTrust, type VerificationRecord } from "@protoboardai/core/part-trust";
import type { PartRevisionEnvelope, PartSummary, RevisionRow, SearchFacets } from "@protoboardai/cloud/client";
import type { AccountModel, CategoryRow as ViewCategory, LibraryModel, LibraryQuery, LibrarySortModel, LibrarySource, PartCardModel, PartDetailModel, PartPages, ProjectPartModel, BomModel } from "./model.js";
import { rev, revChange } from "./revision.js";

export { rev, revChange };
export * from "./part-pages.js";

export type { LibraryQuery };

/** A part the project has vendored (parts/origins.json): the pinned revision and the library it came from. */
export interface Usage {
  revision?: number;
  library?: string;
  tier?: string;
  /** The vendored definition file, project-relative. */
  file?: string;
}

export const EMPTY_QUERY: LibraryQuery = { text: "", category: "", domain: "", protocol: "", sort: "relevance" };

export function parseLibraryQuery(v: unknown, fallback: LibraryQuery = EMPTY_QUERY): LibraryQuery {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: keyof LibraryQuery) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 200) : fallback[k]);
  return { text: s("text"), category: s("category"), domain: s("domain"), protocol: s("protocol"), sort: isLibrarySort(o.sort) ? o.sort : fallback.sort };
}

// ---------------------------------------------------------------- the order of the results (beta test 1, F14)

export const SORT_LABEL: Record<LibrarySort, string> = { relevance: "Relevance", name: "Name", manufacturer: "Manufacturer", updated: "Recently updated" };

/**
 * The order the Library shows and the orders its control offers, so the
 * control never offers one that cannot work:
 *
 * - an order every library asked sorts by itself (`sorts`, from their
 *   discovery documents) is offered, and holds over every page;
 * - by name and by manufacturer are always offered: when the libraries do
 *   not sort, the parts loaded so far are ordered here (`local`);
 * - by relevance is offered without a sorting library only when the parts
 *   carry a relevance; "recently updated" only when the libraries sort by it
 *   (a part summary has no date to order by).
 *
 * The order asked for is kept as the request; what is shown falls back to
 * relevance, then name, while the libraries cannot make it.
 */
export function sortState(requested: LibrarySort, sorts: readonly LibrarySort[], hits: readonly { relevance?: number }[]): LibrarySortModel {
  const local = localSorts(hits);
  const options = LIBRARY_SORTS.filter((s) => sorts.includes(s) || local.includes(s));
  const value = options.includes(requested) ? requested : options.includes("relevance") ? "relevance" : "name";
  return { value, options, local: !sorts.includes(value) };
}

/** The loaded parts in an order made here (`sortState` said `local`); an order that cannot be made leaves them as they came. */
export function sortLocally<T extends { name: string; partId: string; manufacturer?: string; relevance?: number }>(items: T[], sort: LibrarySort): T[] {
  const cmp = compareHits(sort) as ((a: T, b: T) => number) | undefined;
  return cmp ? [...items].sort(cmp) : items;
}

// ---------------------------------------------------------------- category drill-down

export interface Crumb {
  path: string;
  name: string;
}

export interface CategoryRow {
  path: string;
  name: string;
  count: number;
  /** It has sub-categories to drill into. */
  more: boolean;
  description?: string;
}

/** One level of the taxonomy (Alpha's TaxonomyFilter): where we are, the level the list shows, and its categories. */
export interface DrillDown {
  /** From the top ("All categories") to the current category. */
  crumbs: Crumb[];
  /** The "All in …" row: the current category itself (every part at or under it). */
  all: { path: string; name: string; count: number };
  /**
   * The category whose sub-categories the list shows: the current one, or
   * its parent when the current one has none (a leaf stays listed among its
   * siblings, selected, as in the alpha).
   */
  level: { path: string; name: string; count: number };
  /** The level's sub-categories with parts (an empty one is left out unless it is the one chosen). */
  rows: CategoryRow[];
  /** The chosen path is not in any library's taxonomy (a library's own, or a stale filter). */
  unknown?: boolean;
}

const lastName = (path: string) => {
  const id = path.split(".").pop() ?? path;
  return id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};

/**
 * The drill-down at `path`: its ancestors as crumbs, the node's own count as
 * "All in …", and one level of categories with counts: the node's children,
 * or its siblings when it has none. Counts come from the taxonomy route (the
 * other filters applied, the category filter not), so siblings keep their
 * counts while drilling. Category paths that parts use but no taxonomy lists
 * (facets) are shown under their parent too.
 */
export function drillDown(nodes: MergedTaxonomyNode[], path: string, extra: { facets?: Record<string, number>; total?: number } = {}): DrillDown {
  const rootCount = extra.total ?? nodes.reduce((n, x) => n + x.count, 0);
  const crumbs: Crumb[] = [{ path: "", name: "All categories" }];
  // each step down: the category and the list of its children
  const steps: { path: string; name: string; count: number; children: MergedTaxonomyNode[] }[] = [{ path: "", name: "All categories", count: rootCount, children: nodes }];
  let unknown = false;
  if (path) {
    const ids = path.split(".");
    for (let i = 0; i < ids.length; i++) {
      const p = ids.slice(0, i + 1).join(".");
      const n = unknown ? undefined : steps[steps.length - 1].children.find((x) => x.path === p);
      if (!n) {
        unknown = true;
        crumbs.push({ path: p, name: lastName(p) });
        steps.push({ path: p, name: lastName(p), count: extra.facets?.[p] ?? 0, children: [] });
        continue;
      }
      crumbs.push({ path: n.path, name: n.name });
      steps.push({ path: n.path, name: n.name, count: n.count, children: n.children });
    }
  }
  const rowsAt = (step: (typeof steps)[number]): CategoryRow[] => {
    const rows: CategoryRow[] = step.children
      .filter((n) => n.count > 0 || n.path === path)
      .map((n) => ({ path: n.path, name: n.name, count: n.count, more: n.children.some((c) => c.count > 0), ...(n.description ? { description: n.description } : {}) }));
    // paths parts carry that the taxonomy does not have (one level below this one)
    const depth = step.path ? step.path.split(".").length + 1 : 1;
    for (const [p, count] of Object.entries(extra.facets ?? {})) {
      if (!count || p.split(".").length !== depth || (step.path && !p.startsWith(`${step.path}.`)) || rows.some((r) => r.path === p) || step.children.some((n) => n.path === p)) continue;
      rows.push({ path: p, name: lastName(p), count, more: Object.keys(extra.facets!).some((q) => q.startsWith(`${p}.`)) });
    }
    return rows;
  };
  const current = steps[steps.length - 1];
  let level = current;
  let rows = rowsAt(current);
  // a category with nothing below it: the list stays on its parent's level, the category selected in it
  if (!rows.length && steps.length > 1) {
    level = steps[steps.length - 2];
    rows = rowsAt(level);
    if (!rows.some((r) => r.path === current.path)) rows.push({ path: current.path, name: current.name, count: current.count, more: false });
  }
  const pick = (x: (typeof steps)[number]) => ({ path: x.path, name: x.name, count: x.count });
  return { crumbs, all: pick(current), level: pick(level), rows, ...(unknown ? { unknown } : {}) };
}

// ---------------------------------------------------------------- results

export interface ItemModel {
  /** Unique in the list: library and part id. */
  key: string;
  partId: string;
  name: string;
  manufacturer?: string;
  mpn?: string;
  /** The revision `Add` takes (the recommended one, else the latest). */
  revision: number;
  latest: number;
  library: string;
  /** An earlier library has this id: `parts add <id>` alone would take that one. */
  shadowedBy?: string;
  /** The project's vendored copy, when it has one. */
  used?: { revision?: number; library?: string; tier?: string; elsewhere: boolean };
  /** A newer revision than the project's pin, from the same library. */
  update?: number;
  deprecated?: boolean;
  thumbnail?: { sha256: string; size: number; mediaType: string };
  categories: string[];
  domains: string[];
  protocols: string[];
  description?: string;
  tags?: string[];
  /** The part's relevance in its library, when the library ranks. */
  relevance?: number;
}

export function itemModel(hit: LibraryHit, usage: Map<string, Usage>): ItemModel {
  const revision = hit.recommendedRevision ?? hit.latestRevision;
  const u = usage.get(hit.partId);
  const used = u ? { ...(u.revision !== undefined ? { revision: u.revision } : {}), ...(u.library ? { library: u.library } : {}), ...(u.tier ? { tier: u.tier } : {}), elsewhere: !!u.library && u.library !== hit.library } : undefined;
  const update = used && !used.elsewhere && used.revision !== undefined && hit.recommendedRevision !== undefined && hit.recommendedRevision > used.revision ? hit.recommendedRevision : undefined;
  return {
    key: `${hit.library}/${hit.partId}`,
    partId: hit.partId,
    name: hit.name,
    ...(hit.manufacturer ? { manufacturer: hit.manufacturer } : {}),
    ...(hit.partNumber ? { mpn: hit.partNumber } : {}),
    revision,
    latest: hit.latestRevision,
    library: hit.library,
    ...(hit.shadowedBy ? { shadowedBy: hit.shadowedBy } : {}),
    ...(used ? { used } : {}),
    ...(update !== undefined ? { update } : {}),
    ...(hit.deprecated ? { deprecated: true } : {}),
    ...(hit.thumbnail ? { thumbnail: hit.thumbnail } : {}),
    categories: hit.categories ?? [],
    domains: hit.domains ?? [],
    protocols: hit.protocols ?? [],
    ...(hit.description ? { description: hit.description } : {}),
    ...(hit.tags?.length ? { tags: hit.tags } : {}),
    ...(typeof hit.relevance === "number" ? { relevance: hit.relevance } : {}),
  };
}

/** A facet's values with counts, the most common first; the chosen one is kept even at zero. */
export function facetOptions(counts: Record<string, number> | undefined, chosen = ""): { value: string; count: number }[] {
  const out = Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  if (chosen && !out.some((o) => o.value === chosen)) out.unshift({ value: chosen, count: 0 });
  return out;
}

/** The facet counts the filters show: those of a search that did not filter on that facet would be best, but the page's own are close enough when the facet is unset. */
export function filterOptions(facets: SearchFacets | undefined, q: LibraryQuery) {
  return { domain: facetOptions(facets?.domain, q.domain), protocol: facetOptions(facets?.protocol, q.protocol) };
}

// ---------------------------------------------------------------- preview

export interface Fact {
  label: string;
  value: string;
}

export interface InterfaceRow {
  id: string;
  name: string;
  domain?: string;
  protocols: string;
  count: number;
}

export interface PreviewModel {
  key: string;
  partId: string;
  library: string;
  libraryUrl: string;
  name: string;
  description?: string;
  manufacturer?: string;
  mpn?: string;
  /** The revision shown. */
  revision: number;
  recommended?: number;
  latest: number;
  categories: { path: string; name: string }[];
  domains: string[];
  protocols: string[];
  facts: Fact[];
  interfaces: InterfaceRow[];
  /** Interfaces in the definition (rows group pins that share a name pattern). */
  interfaceCount: number;
  datasheet?: { label: string; url: string };
  links: { label: string; url: string }[];
  revisions: { revision: number; createdAt: string; publisher: string; deprecated?: string; recommended: boolean; current: boolean; pinned: boolean }[];
  /** The body GLB of the revision, when it has one. */
  glb?: { sha256: string; size: number; path: string };
  thumbnail?: { sha256: string; size: number; mediaType: string };
  used?: ItemModel["used"];
  /** What the main action does: add, update to a newer revision, switch to the shown one, or nothing (already pinned here). */
  action: { kind: "add" | "update" | "switch" | "pinned" | "elsewhere"; revision: number };
  dependencies: string[];
  evidence: { kind: string; title?: string }[];
  /** The revision's verification record, when it carries one as a file: the host reads it to tell the part's status. */
  verification?: { sha256: string; size: number; mediaType: string };
}

type Def = Record<string, any>;

const fmtRange = (v: unknown, unit: string): string | undefined => {
  if (typeof v === "number") return `${v} ${unit}`;
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return v[0] === v[1] ? `${v[0]} ${unit}` : `${v[0]} to ${v[1]} ${unit}`;
  return undefined;
};

/** Key facts a definition states, in a fixed order; only those it has. */
export function keyFacts(def: Def): Fact[] {
  const facts: Fact[] = [];
  const domains: Def[] = Array.isArray(def.domains) ? def.domains.filter((d: unknown) => d && typeof d === "object") : [];
  const of = (name: string) => domains.find((d) => d.domain === name);
  const mech = of("mechanical");
  const elec = of("electrical");
  const therm = of("thermal");
  const dims = mech?.dimensions_mm;
  if (dims && typeof dims === "object") {
    const parts = ["length", "width", "height"].map((k) => dims[k]).filter((x) => typeof x === "number");
    if (parts.length) facts.push({ label: "Size", value: `${parts.join(" × ")} mm` });
  }
  const mass = mech?.mass_g ?? mech?.metadata?.mass_g ?? def.mass_g;
  if (typeof mass === "number") facts.push({ label: "Mass", value: `${mass} g` });
  const supply = fmtRange(elec?.metadata?.supply_voltage_V ?? elec?.supply_voltage_V, "V");
  if (supply) facts.push({ label: "Supply", value: supply });
  const pkg = elec?.metadata?.package_type ?? mech?.metadata?.package_type;
  if (typeof pkg === "string") facts.push({ label: "Package", value: pkg });
  const pins = elec?.metadata?.pin_count;
  if (typeof pins === "number") facts.push({ label: "Pins", value: String(pins) });
  const mount = mech?.metadata?.mounting_method;
  if (typeof mount === "string") facts.push({ label: "Mounting", value: mount.replace(/_/g, " ") });
  const temp = fmtRange(therm?.operating_temperature_C, "°C");
  if (temp) facts.push({ label: "Operating temperature", value: temp });
  for (const pd of Array.isArray(elec?.power_domains) ? elec.power_domains.slice(0, 3) : []) {
    const v = fmtRange(pd?.voltage_range_V, "V") ?? fmtRange(pd?.nominal_voltage_V, "V");
    if (v && typeof pd.name === "string") facts.push({ label: pd.name, value: v });
  }
  if (typeof def.version === "string") facts.push({ label: "Definition version", value: def.version });
  return facts;
}

/** Interfaces, one row each; pins with the same protocols and domain fold into one row past twelve. */
export function interfaceRows(def: Def): { rows: InterfaceRow[]; count: number } {
  const list: Def[] = Array.isArray(def.interfaces) ? def.interfaces.filter((i: unknown) => i && typeof i === "object") : [];
  const row = (i: Def): InterfaceRow => ({
    id: String(i.id ?? ""),
    name: String(i.name ?? i.id ?? ""),
    ...(typeof i.domain === "string" ? { domain: i.domain } : {}),
    protocols: (Array.isArray(i.protocols) ? i.protocols : [])
      .map((p: Def) => [p?.type, ...(Array.isArray(p?.roles) ? [`(${p.roles.join(", ")})`] : [])].filter(Boolean).join(" "))
      .join(", "),
    count: 1,
  });
  if (list.length <= 12) return { rows: list.map(row), count: list.length };
  const groups = new Map<string, InterfaceRow>();
  for (const i of list) {
    const r = row(i);
    const k = `${r.domain}|${r.protocols}`;
    const g = groups.get(k);
    if (g) {
      g.count++;
      g.name = `${g.count} interfaces`;
    } else groups.set(k, r);
  }
  return { rows: [...groups.values()].map((g) => (g.count > 1 ? { ...g, id: "" } : g)), count: list.length };
}

/** The datasheet link, and the other documents' links. */
export function documents(def: Def): { datasheet?: { label: string; url: string }; links: { label: string; url: string }[] } {
  const arts: Def[] = Array.isArray(def.artifacts) ? def.artifacts : [];
  const web = arts.filter((a) => typeof a?.url === "string" && /^https?:\/\//.test(a.url));
  const ds = web.find((a) => a.type === "datasheet") ?? web.find((a) => /datasheet/i.test(`${a.id} ${a.name}`));
  const links = web.filter((a) => a !== ds).map((a) => ({ label: String(a.name ?? a.id), url: a.url as string }));
  for (const l of Array.isArray(def.links) ? def.links : []) if (typeof l?.url === "string" && /^https?:\/\//.test(l.url)) links.push({ label: String(l.label ?? l.url), url: l.url });
  return { ...(ds ? { datasheet: { label: String(ds.name ?? "Datasheet"), url: ds.url as string } } : {}), links };
}

/** The GLB to preview: the body mesh (artifact role "body", glb), else any GLB that is not an interface's. */
export function bodyGlb(env: Pick<PartRevisionEnvelope, "artifacts" | "definition">): PreviewModel["glb"] {
  const defArts: Def[] = Array.isArray((env.definition as Def).artifacts) ? (env.definition as Def).artifacts : [];
  const glbs = env.artifacts.filter((a) => a.mediaType === "model/gltf-binary" || a.path.toLowerCase().endsWith(".glb"));
  const role = (a: (typeof glbs)[number]) => a.role ?? defArts.find((d) => d.id === a.artifactId)?.role;
  const pick = glbs.find((a) => role(a) === "body") ?? glbs.find((a) => role(a) !== "interface");
  return pick ? { sha256: pick.sha256, size: pick.size, path: pick.path } : undefined;
}

/** The preview of one revision of a part from one library. */
export function previewModel(p: {
  part: PartSummary;
  revisions: RevisionRow[];
  envelope: PartRevisionEnvelope;
  library: { id: string; url: string };
  usage?: Usage;
  categoryName?: (path: string) => string | undefined;
}): PreviewModel {
  const def = p.envelope.definition as Def;
  const { rows, count } = interfaceRows(def);
  const docs = documents(def);
  const u = p.usage;
  const used = u ? { ...(u.revision !== undefined ? { revision: u.revision } : {}), ...(u.library ? { library: u.library } : {}), ...(u.tier ? { tier: u.tier } : {}), elsewhere: !!u.library && u.library !== p.library.id } : undefined;
  const shown = p.envelope.revision;
  const action: PreviewModel["action"] = !used
    ? { kind: "add", revision: shown }
    : used.elsewhere || used.revision === undefined
      ? { kind: "elsewhere", revision: shown }
      : used.revision === shown
        ? { kind: "pinned", revision: shown }
        : shown > used.revision
          ? { kind: "update", revision: shown }
          : { kind: "switch", revision: shown };
  const categories = (p.part.categories ?? []).map((path) => ({ path, name: p.categoryName?.(path) ?? lastName(path) }));
  return {
    key: `${p.library.id}/${p.part.partId}`,
    partId: p.part.partId,
    library: p.library.id,
    libraryUrl: p.library.url,
    name: typeof def.name === "string" ? def.name : p.part.name,
    ...((def.description ?? p.part.description) ? { description: String(def.description ?? p.part.description) } : {}),
    ...(p.part.manufacturer ? { manufacturer: p.part.manufacturer } : {}),
    ...(p.part.partNumber ? { mpn: p.part.partNumber } : {}),
    revision: shown,
    ...(p.part.recommendedRevision !== undefined ? { recommended: p.part.recommendedRevision } : {}),
    latest: p.part.latestRevision,
    categories,
    domains: p.part.domains ?? [],
    protocols: p.part.protocols ?? [],
    facts: keyFacts(def),
    interfaces: rows,
    interfaceCount: count,
    ...(docs.datasheet ? { datasheet: docs.datasheet } : {}),
    links: docs.links,
    revisions: [...p.revisions]
      .sort((a, b) => b.revision - a.revision)
      .map((r) => ({
        revision: r.revision,
        createdAt: r.createdAt,
        publisher: r.publisher,
        ...(r.deprecated ? { deprecated: r.deprecated.reason } : {}),
        recommended: r.revision === p.part.recommendedRevision,
        current: r.revision === shown,
        pinned: !!used && !used.elsewhere && used.revision === r.revision,
      })),
    ...(bodyGlb(p.envelope) ? { glb: bodyGlb(p.envelope) } : {}),
    ...(p.part.thumbnail ? { thumbnail: p.part.thumbnail } : {}),
    ...(used ? { used } : {}),
    action,
    dependencies: p.envelope.dependencies.map((d) => `${d.partId} ${rev(d.revision)}`),
    evidence: p.envelope.evidence.map((e) => ({ kind: e.kind, ...(e.title ? { title: e.title } : {}) })),
    ...(verificationFile(p.envelope) ? { verification: verificationFile(p.envelope) } : {}),
  };
}

/** The revision's verification record among its evidence, when it is a carried file. */
function verificationFile(env: Pick<PartRevisionEnvelope, "evidence">): PreviewModel["verification"] {
  const e = env.evidence.find((x) => x.kind === "verification" && x.sha256 && typeof x.size === "number");
  return e ? { sha256: e.sha256!, size: e.size!, mediaType: e.mediaType ?? "application/json" } : undefined;
}

/**
 * A library part's status from its revision (PB-932): `record` is the
 * verification record the host read (`null`: the revision carries one that
 * could not be read; leave it out while the revision carries none).
 */
export function previewTrust(p: Pick<PreviewModel, "verification" | "evidence">, record?: VerificationRecord | null): { trust: PartTrust; trustBasis: string } {
  const carries = !!p.verification || p.evidence.some((e) => e.kind === "verification");
  const r = partTrust({ inLibrary: true, ...(carries ? { verification: record ?? null } : {}) });
  return { trust: r.trust, trustBasis: r.basis };
}

/** A taxonomy path's name, from the merged tree. */
export function categoryNamer(nodes: MergedTaxonomyNode[]): (path: string) => string | undefined {
  const names = new Map<string, string>();
  const walk = (list: MergedTaxonomyNode[]) => {
    for (const n of list) {
      names.set(n.path, n.name);
      walk(n.children);
    }
  };
  walk(nodes);
  return (path) => names.get(path);
}

// ---------------------------------------------------------------- onto the views' models

const PROTOCOL_LABEL: Record<string, string> = { i2c: "I2C", spi: "SPI", uart: "UART", usb: "USB", can: "CAN", gpio: "GPIO", pwm: "PWM", i2s: "I2S", power: "Power", analog: "Analog", ethernet: "Ethernet", crsf: "CRSF", dshot: "DShot" };

/** A protocol's short label: `I2C`, `SPI`; others as they are, capitalised. */
export const protocolLabel = (p: string) => PROTOCOL_LABEL[p.toLowerCase()] ?? (p.length <= 4 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));

/** The first sentence of a description, short enough for a card. */
export function shortDescription(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined;
  const first = text.trim().split(/(?<=[.!?])\s+/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** "Environmental · Gas": the last two names of a part's first category. */
export function categoryTrail(paths: string[], name: (path: string) => string | undefined = () => undefined): string | undefined {
  const path = paths[0];
  if (!path) return undefined;
  const ids = path.split(".");
  const names = ids.map((_, i) => {
    const p = ids.slice(0, i + 1).join(".");
    return name(p) ?? lastName(p);
  });
  return names.slice(-2).join(" · ");
}

/** A result row as a card. */
/** Protocols that tell parts apart on a card (buses and links); power, digital, mechanical and the like say little. */
const CARD_PROTOCOLS = /^(i2c|i3c|spi|qspi|uart|usb|can|canfd|i2s|pwm|crsf|sbus|dshot|ethernet|wifi|ble|bluetooth|lora|sdio|mipi[_-]?csi|csi|dsi|hdmi|pcie|onewire|1-wire|jtag|swd|rs485|rs232|modbus|gnss|ppm)$/i;

export function cardModel(it: ItemModel, o: { thumb?: string; busy?: string; categoryName?: (path: string) => string | undefined } = {}): PartCardModel {
  const cats = new Set(it.categories);
  const free = (it.tags ?? []).filter((t) => !cats.has(t) && !t.includes(".") && !t.includes("_") && !it.protocols.includes(t));
  const tags = [...it.protocols.filter((p) => CARD_PROTOCOLS.test(p)).map(protocolLabel), ...free].filter((t, i, a) => a.indexOf(t) === i).slice(0, 3);
  return {
    key: it.key,
    partId: it.partId,
    name: it.name,
    ...(it.manufacturer ? { manufacturer: it.manufacturer } : {}),
    ...(it.mpn ? { mpn: it.mpn } : {}),
    ...(categoryTrail(it.categories, o.categoryName) ? { category: categoryTrail(it.categories, o.categoryName) } : {}),
    ...(shortDescription(it.description) ? { description: shortDescription(it.description) } : {}),
    tags,
    library: it.library,
    revision: it.revision,
    ...(o.thumb ? { thumbnail: o.thumb } : {}),
    ...(it.used ? { used: { ...(it.used.revision !== undefined ? { revision: it.used.revision } : {}), elsewhere: it.used.elsewhere } } : {}),
    ...(it.update !== undefined ? { update: it.update } : {}),
    ...(it.deprecated ? { deprecated: true } : {}),
    ...(it.shadowedBy ? { shadowedBy: it.shadowedBy } : {}),
    ...(o.busy ? { busy: o.busy } : {}),
    ...(it.relevance !== undefined ? { relevance: it.relevance } : {}),
    pages: { key: it.key, revision: it.revision },
  };
}

/** The size of the whole catalog: the host's figure, or this search's total when nothing filters it. Never the sum of the categories, which counts a part once per category. */
function catalogTotalOf(input: { query: LibraryQuery; total: number; catalogTotal?: number; loading: boolean; error?: string }): number | undefined {
  if (input.catalogTotal !== undefined) return input.catalogTotal;
  const q = input.query;
  return !q.text && !q.category && !q.domain && !q.protocol && !input.loading && !input.error ? input.total : undefined;
}

/** The Library's model from a search, the taxonomy and what the host has fetched. */
export function libraryViewModel(input: {
  query: LibraryQuery;
  drill?: DrillDown;
  /** The merged taxonomy's top level (the full page's categories). */
  top?: MergedTaxonomyNode[];
  items: ItemModel[];
  total: number;
  /** The unfiltered search's total, when the host has seen it. */
  catalogTotal?: number;
  more: boolean;
  sources: LibrarySource[];
  thumbs?: Record<string, string>;
  busy?: Map<string, string> | Record<string, string>;
  loading: boolean;
  loadingMore?: boolean;
  error?: string;
  setupError?: string;
  noProject?: boolean;
  categoryName?: (path: string) => string | undefined;
  /** The orders every library searched sorts by itself (`searchLibraries`' `sorts`). */
  sorts?: readonly LibrarySort[];
}): LibraryModel {
  const busy = input.busy instanceof Map ? Object.fromEntries(input.busy) : (input.busy ?? {});
  const cat = (r: { path: string; name: string; count: number; more?: boolean; description?: string }): ViewCategory => ({ path: r.path, name: r.name, count: r.count, ...(r.more ? { more: true } : {}), ...(r.description ? { description: r.description } : {}) });
  const sort = sortState(input.query.sort, input.sorts ?? [], input.items);
  const ordered = sort.local ? sortLocally(input.items, sort.value) : input.items;
  return {
    query: input.query,
    crumbs: input.drill?.crumbs ?? [{ path: "", name: "All categories" }],
    categories: (input.drill?.rows ?? []).map(cat),
    level: input.drill?.level ?? { path: "", name: "All categories", count: input.total },
    sort,
    topCategories: (input.top ?? []).filter((n) => n.count > 0).map((n) => cat({ path: n.path, name: n.name, count: n.count, more: n.children.some((c) => c.count > 0), ...(n.description ? { description: n.description } : {}) })),
    total: input.total,
    ...(catalogTotalOf(input) !== undefined ? { catalogTotal: catalogTotalOf(input) } : {}),
    libraries: input.sources,
    items: ordered.map((it) => cardModel(it, { ...(it.thumbnail && input.thumbs?.[it.thumbnail.sha256] ? { thumb: input.thumbs[it.thumbnail.sha256] } : {}), ...(busy[it.key] ? { busy: busy[it.key] } : {}), ...(input.categoryName ? { categoryName: input.categoryName } : {}) })),
    more: input.more,
    loading: input.loading,
    ...(input.loadingMore ? { loadingMore: true } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.setupError ? { setupError: input.setupError } : {}),
    ...(input.noProject ? { noProject: true } : {}),
  };
}

/** A part's preview as the detail view's model. */
export function detailModel(
  p: PreviewModel,
  o: { thumb?: string; model?: string; modelError?: string; busy?: string; noProject?: boolean; trust?: PartTrust; trustBasis?: string; /** The revision's pages (`partPages`). */ pages?: PartPages; /** The model comes when the CAD section asks. */ modelLazy?: boolean; /** The host can ask the library for prices. */ hasPrices?: boolean } = {},
): PartDetailModel {
  // the buses and links that tell parts apart (as on a card); "power", "digital" or "bolt_pattern" say little beside a name
  const buses = p.protocols.filter((x) => CARD_PROTOCOLS.test(x)).map(protocolLabel);
  const identifiers = buses.length ? [buses.join(" / ")] : [];
  return {
    key: p.key,
    partId: p.partId,
    name: p.name,
    crumbs: p.categories.length ? p.categories[0].path.split(".").map((_, i, ids) => {
      const path = ids.slice(0, i + 1).join(".");
      return p.categories.find((c) => c.path === path)?.name ?? lastName(path);
    }) : [],
    ...(p.manufacturer ? { manufacturer: p.manufacturer } : {}),
    ...(p.mpn ? { mpn: p.mpn } : {}),
    identifiers,
    ...(p.description ? { description: p.description } : {}),
    library: p.library,
    libraryUrl: p.libraryUrl,
    revision: p.revision,
    ...(p.recommended !== undefined ? { recommended: p.recommended } : {}),
    latest: p.latest,
    ...(o.thumb ? { thumbnail: o.thumb } : {}),
    ...(o.model ? { model: o.model } : {}),
    ...(o.modelError ? { modelError: o.modelError } : {}),
    facts: p.facts,
    interfaces: p.interfaces,
    interfaceCount: p.interfaceCount,
    ...(p.datasheet ? { datasheet: p.datasheet } : {}),
    links: p.links,
    revisions: p.revisions,
    evidence: p.evidence,
    dependencies: p.dependencies,
    ...(p.used ? { used: { ...(p.used.revision !== undefined ? { revision: p.used.revision } : {}), elsewhere: p.used.elsewhere } } : {}),
    action: p.action,
    ...(o.busy ? { busy: o.busy } : {}),
    ...(o.noProject ? { noProject: true } : {}),
    ...(o.trust ? { trust: o.trust, ...(o.trustBasis ? { trustBasis: o.trustBasis } : {}) } : {}),
    ...(o.pages ? { pages: o.pages } : {}),
    ...(o.modelLazy ? { modelLazy: true } : {}),
    ...(o.hasPrices ? { hasPrices: true } : {}),
  };
}

export type { AccountModel };

// ---------------------------------------------------------------- project parts (PB-903, PB-945)

export interface PartGroup {
  id: string;
  title: string;
  parts: ProjectPartModel[];
}

/** The side bar's groups, in its order: updates, each library, researched, designed. */
export function partGroups(parts: ProjectPartModel[]): PartGroup[] {
  const updates = parts.filter((p) => p.status === "update-available");
  const libs = [...new Set(parts.filter((p) => p.tier === "catalog" && p.status !== "update-available").map((p) => p.library ?? "library"))];
  return [
    { id: "updates", title: "Updates available", parts: updates },
    ...libs.map((l) => ({ id: `library:${l}`, title: `Library · ${l}`, parts: parts.filter((p) => p.tier === "catalog" && p.status !== "update-available" && (p.library ?? "library") === l) })),
    { id: "researched", title: "Project · researched", parts: parts.filter((p) => p.tier === "project-researched") },
    { id: "designed", title: "Project · designed", parts: parts.filter((p) => p.tier === "project-specific") },
  ].filter((g) => g.parts.length);
}

/** The Project Parts page's groups: the project's parts by tier (library, researched, designed), each with what the tier means. */
export function tierGroups(parts: ProjectPartModel[]): (PartGroup & { hint: string })[] {
  return [
    { id: "library", title: "From libraries", hint: "Vendored from a library and pinned to a revision. Updates flow one way, from the library to the project.", parts: parts.filter((p) => p.tier === "catalog") },
    { id: "researched", title: "Researched in the project", hint: "Written in parts/local from datasheets. They can be submitted to a library for verification later.", parts: parts.filter((p) => p.tier === "project-researched") },
    { id: "designed", title: "Designed in the project", hint: "The project's own modules under src/: circuits, CAD parts, harnesses.", parts: parts.filter((p) => p.tier === "project-specific") },
  ].filter((g) => g.parts.length);
}

export type PartSyncKind = "in-sync" | "update" | "diverged" | "local" | "pinned";

/** A project part against its library: the one wording and tone of every view. */
export interface PartSync {
  kind: PartSyncKind;
  /** "In sync", "Update available · v4", "Diverged", "Local only", "Pinned · v2". */
  label: string;
  /** What the state means, for the tooltip. */
  meaning: string;
  tone: "ok" | "info" | "warning" | "neutral";
  icon: string;
}

/**
 * A part's sync status with its library: in sync, update available (with
 * the revision), diverged (vendored files edited), local only. A library
 * part not compared with its library yet (offline) is "pinned".
 */
export function partSync(p: Pick<ProjectPartModel, "tier" | "status" | "revision" | "recommended" | "edited" | "library">): PartSync {
  if (p.tier !== "catalog") return { kind: "local", label: "Local only", meaning: "Only in this project: no library holds it, so there is nothing to sync with.", tone: "neutral", icon: "hard-drive" };
  const from = p.library ? ` in ${p.library}` : "";
  if (p.status === "diverged") {
    const files = p.edited?.length ? `: ${p.edited.join(", ")}` : "";
    return { kind: "diverged", label: "Diverged", meaning: `Its vendored files were edited in the project since ${rev(p.revision)} was added${files}. Restore the revision, or keep the edits as a part of your own.${p.recommended !== undefined ? ` ${rev(p.recommended)} is recommended${from}.` : ""}`, tone: "warning", icon: "git-compare-arrows" };
  }
  if (p.status === "update-available") return { kind: "update", label: `Update available · ${rev(p.recommended)}`, meaning: `The project pins ${rev(p.revision)}; the library recommends ${rev(p.recommended)}. Updating replaces the vendored files with that revision; compare the two first to see what changes.`, tone: "info", icon: "download" };
  if (p.status === "up-to-date") return { kind: "in-sync", label: "In sync", meaning: `The project has ${rev(p.revision)}, the revision the library recommends, and its files are untouched.`, tone: "ok", icon: "check" };
  return { kind: "pinned", label: `Pinned · ${rev(p.revision)}`, meaning: `Pinned to ${rev(p.revision)} with its files untouched; not compared with the library yet (check for updates).`, tone: "neutral", icon: "pin" };
}

/** A part's short mono note: `v2 → v3`, `v3 · edited`, `local`, `circuit · tscircuit`. */
export function partNote(p: ProjectPartModel): string {
  const r = p.revision !== undefined ? rev(p.revision) : "";
  if (p.status === "update-available") return revChange(p.revision, p.recommended);
  if (p.status === "diverged") return `${r} · edited`;
  if (p.tier === "project-researched") return p.published ? `local · published ${rev(p.published.revision)}` : "local";
  if (p.tier === "project-specific") {
    if (!p.capability) return "module";
    const tool = p.capability.provider.replace(/^@[^/]+\//, "").replace(/^ext-/, "");
    return tool === p.capability.capability ? tool : `${p.capability.capability} · ${tool}`;
  }
  return r;
}

/** A project part as a library card draws it (the Project Parts page uses the library's cards). */
export function projectCard(p: ProjectPartModel, categoryName: (path: string) => string | undefined = () => undefined): PartCardModel {
  const sub = p.tier === "catalog" ? undefined : partNote(p);
  return {
    key: p.id,
    partId: p.id,
    name: p.name,
    ...(p.manufacturer ? { manufacturer: p.manufacturer } : {}),
    ...(p.partNumber ? { mpn: p.partNumber } : {}),
    ...(p.category ? { category: categoryTrail([p.category], categoryName) } : sub ? { category: sub } : {}),
    ...(shortDescription(p.description) ? { description: shortDescription(p.description) } : {}),
    tags: [],
    library: p.library ?? "",
    revision: typeof p.revision === "number" ? p.revision : 0,
    ...(p.thumbnail ? { thumbnail: p.thumbnail } : {}),
    ...(p.busy ? { busy: p.busy } : {}),
    // a library part's pages are its pinned revision's, from its library; the project's own parts have their overview
    ...(p.tier === "catalog" && p.library ? { pages: { key: `${p.library}/${p.id}`, ...(typeof p.revision === "number" ? { revision: p.revision } : {}) } } : {}),
  };
}

export { PART_TRUST_TEXT };

// ---------------------------------------------------------------- bill of materials (PB-904)

/** The bill as CSV (Export CSV): core's export of the structured model. */
export { bomCsv } from "@protoboardai/core/bom";

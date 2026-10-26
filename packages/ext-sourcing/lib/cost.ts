/**
 * The project's bill of materials and what it costs, as far as it can be
 * known offline (PB-933, docs/specs/bom.md). Shared by the VS Code extension
 * (the BOM editor, the Cloud view's estimate) and the CLI (`protoboard bom`,
 * the web viewer's BOM view), so every surface prices a line the same way.
 *
 * The model and its arithmetic are core's (`@protoboardai/core/bom`: lines,
 * offers, the chosen offer, packs and minimum orders, dollars). This module
 * is the part that reads a project: the lines from the design (the system's
 * instance tree) or from a release's ordering list, the offers the project
 * holds (`parts/offers.json`, from the library's price API, and the
 * project's own sourcing records, `parts/evidence/<id>/sourcing.json`), the
 * rate table (`parts/fx-rates.json`, else core's dated table) and the
 * project's BOM settings (`parts/bom.json`: units to build, chosen offers).
 *
 * Nothing here fetches a price, and nothing says how the library got one:
 * the offers are the library's results as the project holds them.
 *
 * A line with no price is listed as unpriced, never estimated. Made parts
 * (boards, printed and cut parts, cable assembly) need a quote.
 *
 * Node only (reads the project's files); no host API.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  BOM_SETTINGS_FILE,
  BOM_SETTINGS_SCHEMA,
  bomLines,
  bomSettingsProblems,
  offerPackSize,
  priceBom,
  type Bom,
  type BomGroupInfo,
  type BomLine,
  type BomLineInput,
  type BomOffer,
  type BomSettings,
} from "@protoboardai/core/bom";
import { DEFAULT_FX, FX_FILE, fxProblems, type FxTable } from "@protoboardai/core/fx";
import { readProjectOffers, type LibraryOfferEntry, type SourcingOfferEntry } from "@protoboardai/core/offers";

/**
 * What the bill needs of the system: its instances (tree order, "" the
 * root), each definition, and which definitions a capability provider
 * makes. The extension builds it from the build's resolved.json and bundle;
 * the CLI from the loaded project.
 */
export interface CostIndex {
  instances: readonly { path: string; definition: string; name?: string; quantity?: number; parent?: string }[];
  definition(id: string):
    | { name?: string; manufacturer?: string; part_number?: string; kind?: string; topology?: string; traits?: readonly { type: string; params?: Record<string, unknown> }[] }
    | undefined;
  /** The capability that makes a definition, when one does (it is then made, not bought). */
  capability(id: string): { capability: string; provider: string } | undefined;
  /** The ordering code and value of one placement, where they differ from the definition's (a series passive placed at a value). */
  placement?(path: string): { mpn?: string; value?: string } | undefined;
  /** The part's status in the library (part-trust.ts). */
  partStatus?(id: string): string | undefined;
}

export const RELEASE_DIR = "release";
/**
 * An earlier name of the release folder (PB-1018): the project-structure spec
 * said `releases/` while the stack wrote `release/`. Releases found there are
 * listed too; `release/` wins for a version in both.
 */
export const RELEASE_DIR_EARLIER = "releases";
export const ORDERING_LIST = join("system", "ordering-list.csv");
export const OFFERS_FILE = join("parts", "offers.json");
export const OFFERS_SCHEMA = "protoboard.offers/v0";
export const SOURCING_SCHEMA = "protoboard.sourcing/v0";

/** RFC 4180 rows, with each row's 1-based starting line in the file. */
export function parseCsv(text: string): { rows: string[][]; lines: number[] } {
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      any = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      any = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (any || field) {
        row.push(field);
        rows.push(row);
        lines.push(start);
      }
      row = [];
      field = "";
      any = false;
      line++;
      start = line;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field) {
    row.push(field);
    rows.push(row);
    lines.push(start);
  }
  return { rows, lines };
}

/** A release folder of the project. */
export interface ReleaseInfo {
  version: string;
  /** Absolute folder. */
  dir: string;
  /** From manifest.json, else the folder's modification time. */
  date: Date;
  hasOrderingList: boolean;
  index?: string;
  overview?: string;
  manifest: boolean;
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Compare version strings by their numeric parts (0.10.0 after 0.9.1), then as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The project's releases, newest first (by manifest date, then version). */
export function listReleases(root: string): ReleaseInfo[] {
  const found = new Map<string, string>();
  for (const folder of [RELEASE_DIR_EARLIER, RELEASE_DIR]) {
    try {
      for (const d of readdirSync(join(root, folder), { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith(".")) found.set(d.name, join(root, folder, d.name));
    } catch {
      // no such folder
    }
  }
  const out: ReleaseInfo[] = [];
  for (const [version, dir] of found) {
    let date: Date | undefined;
    let manifest = false;
    try {
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { date?: string; version?: string };
      manifest = true;
      if (m.date && !Number.isNaN(Date.parse(m.date))) date = new Date(m.date);
    } catch {
      // a folder without a manifest is an interrupted or foreign one
    }
    date ??= statSync(dir).mtime;
    const file = (f: string) => (existsSync(join(dir, f)) ? join(dir, f) : undefined);
    out.push({ version, dir, date, manifest, hasOrderingList: existsSync(join(dir, ORDERING_LIST)), index: file("index.html"), overview: file("00-overview.pdf") });
  }
  return out.filter((r) => r.manifest || r.hasOrderingList).sort((a, b) => b.date.getTime() - a.date.getTime() || compareVersions(b.version, a.version));
}


// ---- what the project holds

export interface HeldOffers {
  /** By definition id. */
  offers: Map<string, BomOffer[]>;
  /** When the library's offers were fetched into the project. */
  retrievedAt?: string;
  library: boolean;
  /** Parts with a sourcing record of the project's own. */
  project: number;
}

const offerId = (o: Pick<BomOffer, "origin" | "supplier" | "sku" | "mpn">) => `${o.origin}:${o.supplier}:${o.sku || o.mpn || ""}`;

function unique(list: BomOffer[]): BomOffer[] {
  const seen = new Map<string, number>();
  return list.map((o) => {
    const n = (seen.get(o.id) ?? 0) + 1;
    seen.set(o.id, n);
    return n === 1 ? o : { ...o, id: `${o.id}#${n}` };
  });
}

/**
 * The offers the project holds, by definition id: the library's (`parts/offers.json`) and the project's own
 * sourcing records, read through core's one offer reader (PB-1033), each part's in its order of precedence
 * (a project part's own evidence first, a library part's library offers first).
 */
export function readHeldOffers(root: string, ids: Iterable<string>, options: { catalog?: string } = {}): HeldOffers {
  const held = readProjectOffers(root, options);
  const out = new Map<string, BomOffer[]>();
  const add = (id: string, o: BomOffer) => out.set(id, [...(out.get(id) ?? []), o]);
  const library = held.libraryParts.some((id) => held.forPart(id).offers.some((o) => o.origin === "library"));
  let project = 0;
  // the library's offers for every part it holds them for, the project's for the parts asked about
  const wanted = new Set(ids);
  for (const id of [...new Set([...held.libraryParts, ...wanted])]) {
    let any = false;
    for (const h of held.forPart(id).offers) {
      if (h.origin === "library") {
        const o = h.entry as LibraryOfferEntry & {
          url?: string;
          unitPrice?: number;
          currency?: string;
          priceBreaks?: { quantity: number; unitPrice: number }[];
          minQuantity?: number;
          observedAt?: string;
          packaging?: string;
          stock?: number;
          leadTimeWeeks?: number;
          authorized?: boolean;
          market?: string;
          stale?: boolean;
        };
        const breaks = o.priceBreaks?.length
          ? o.priceBreaks.filter((b) => b && typeof b.quantity === "number" && typeof b.unitPrice === "number").map((b) => ({ quantity: b.quantity, unitPrice: b.unitPrice }))
          : typeof o.unitPrice === "number"
            ? [{ quantity: o.minQuantity ?? 1, unitPrice: o.unitPrice }]
            : [];
        const pack = offerPackSize(o.packaging, o.minQuantity);
        const offer: Omit<BomOffer, "id"> = {
          origin: "library",
          supplier: o.supplier,
          ...(o.sku ? { sku: o.sku } : {}),
          ...(o.mpn ? { mpn: o.mpn } : {}),
          // only a web link: an older file may hold something else in this place
          ...(o.url && /^https?:\/\//.test(o.url) ? { url: o.url } : {}),
          ...(o.currency ? { currency: o.currency } : {}),
          breaks,
          ...(pack ? { packSize: pack } : {}),
          ...(o.minQuantity ? { minOrder: o.minQuantity } : {}),
          ...(o.packaging ? { packaging: o.packaging } : {}),
          stock: typeof o.stock === "number" ? o.stock : null,
          ...(typeof o.leadTimeWeeks === "number" ? { leadTimeWeeks: o.leadTimeWeeks } : {}),
          ...(typeof o.authorized === "boolean" ? { authorized: o.authorized } : {}),
          ...(o.market ? { market: o.market } : {}),
          ...(o.observedAt ? { observedAt: o.observedAt } : {}),
          ...(o.stale ? { stale: true } : {}),
          file: h.file,
        };
        add(id, { ...offer, id: offerId(offer) });
        continue;
      }
      if (!wanted.has(id)) continue;
      const o = h.entry as SourcingOfferEntry & { url?: string; as_of?: string; moq?: number | null; packaging?: string; stock?: number | null; lead_time_weeks?: number | null; authorized?: boolean | null; market?: string; price_breaks?: { quantity: number; unit_price: number; currency: string }[] };
      any = true;
      const priced = (o.price_breaks ?? []).filter((b) => b && typeof b.unit_price === "number" && typeof b.quantity === "number" && typeof b.currency === "string");
      const currency = priced[0]?.currency;
      const pack = offerPackSize(typeof o.packaging === "string" ? o.packaging : undefined, o.moq);
      const offer: Omit<BomOffer, "id"> = {
        origin: "project",
        supplier: o.supplier,
        ...(o.supplier_sku ? { sku: o.supplier_sku } : {}),
        ...(typeof o.mpn === "string" && o.mpn ? { mpn: o.mpn } : {}),
        ...(o.url && /^https?:\/\//.test(o.url) ? { url: o.url } : {}),
        ...(currency ? { currency } : {}),
        breaks: priced.filter((b) => b.currency === currency).map((b) => ({ quantity: b.quantity, unitPrice: b.unit_price })),
        ...(pack ? { packSize: pack } : {}),
        ...(o.moq ? { minOrder: o.moq } : {}),
        ...(typeof o.packaging === "string" ? { packaging: o.packaging } : {}),
        stock: typeof o.stock === "number" ? o.stock : null,
        ...(typeof o.lead_time_weeks === "number" ? { leadTimeWeeks: o.lead_time_weeks } : {}),
        ...(typeof o.authorized === "boolean" ? { authorized: o.authorized } : {}),
        ...(o.market ? { market: o.market } : {}),
        ...(o.as_of ? { observedAt: o.as_of } : {}),
        file: h.file,
      };
      add(id, { ...offer, id: offerId(offer) });
    }
    if (any) project++;
  }
  for (const [id, list] of out) out.set(id, unique(list));
  const retrievedAt = held.libraryFile?.retrievedAt;
  return { offers: out, ...(retrievedAt ? { retrievedAt } : {}), library, project };
}

/** The rate table the project converts with: its own (`parts/fx-rates.json`) when it has a valid one, else core's dated table. */
export function readFx(root: string): { table: FxTable; project: boolean; problems: string[] } {
  const file = join(root, FX_FILE);
  if (!existsSync(file)) return { table: DEFAULT_FX, project: false, problems: [] };
  try {
    const t = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const problems = fxProblems(t);
    return problems.length ? { table: DEFAULT_FX, project: false, problems } : { table: t as FxTable, project: true, problems: [] };
  } catch (e) {
    return { table: DEFAULT_FX, project: false, problems: [`not JSON: ${(e as Error).message}`] };
  }
}

/** The project's BOM settings (`parts/bom.json`); the defaults when it has none. A malformed file is reported, not used. */
export function readBomSettings(root: string): { settings: BomSettings; problems: string[] } {
  const none: BomSettings = { schema: BOM_SETTINGS_SCHEMA };
  const file = join(root, BOM_SETTINGS_FILE);
  if (!existsSync(file)) return { settings: none, problems: [] };
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const problems = bomSettingsProblems(s);
    return problems.length ? { settings: none, problems } : { settings: s as BomSettings, problems: [] };
  } catch (e) {
    return { settings: none, problems: [`not JSON: ${(e as Error).message}`] };
  }
}

/**
 * Change the settings: the units to build, or the offer of a line (`null`
 * goes back to the best offer by the rules). Writes `parts/bom.json`; a
 * file left with nothing chosen and one unit still says so, so the choice
 * to build one is on record.
 */
export function writeBomSettings(root: string, change: { units?: number; offer?: { line: string; offer: string | null } }): BomSettings {
  const { settings, problems } = readBomSettings(root);
  if (problems.length) throw new Error(`${BOM_SETTINGS_FILE}: ${problems.join("; ")}`);
  if (change.units !== undefined && !(Number.isInteger(change.units) && change.units > 0 && change.units <= 1_000_000)) throw new Error("units must be a whole number from 1 to 1,000,000");
  const offers = { ...(settings.offers ?? {}) };
  if (change.offer) {
    if (change.offer.offer === null) delete offers[change.offer.line];
    else offers[change.offer.line] = change.offer.offer;
  }
  const next: BomSettings = {
    schema: BOM_SETTINGS_SCHEMA,
    units: change.units ?? settings.units ?? 1,
    ...(Object.keys(offers).length ? { offers: Object.fromEntries(Object.keys(offers).sort().map((k) => [k, offers[k]])) } : {}),
  };
  const file = join(root, BOM_SETTINGS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

// ---- the lines

type Lines = { lines: Omit<BomLineInput, "offers">[]; groups: BomGroupInfo[] };

const paramsOf = (def: ReturnType<CostIndex["definition"]>) => (def?.traits ?? []).map((t) => (t.params ?? {}) as Record<string, unknown>);

function listingOf(def: ReturnType<CostIndex["definition"]>): { supplier: string; url: string } | undefined {
  for (const t of def?.traits ?? []) {
    const p = (t.params ?? {}) as Record<string, unknown>;
    const src = Array.isArray(p.source) ? p.source[0] : p.source;
    if (t.type === "usage_note" && typeof p.note === "string" && p.note.startsWith("Supplier listing:") && typeof src === "string" && /^https?:\/\//.test(src)) {
      try {
        return { supplier: new URL(src).hostname.replace(/^www\./, ""), url: src };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function groupsOf(index: CostIndex, project: string): { groups: BomGroupInfo[]; of: (instances: string[]) => string } {
  const tops = new Map<string, BomGroupInfo>();
  for (const i of index.instances) {
    if (i.path === "" || i.path.includes("/")) continue;
    tops.set(i.path, { path: i.path, name: i.name ?? index.definition(i.definition)?.name ?? i.path, quantity: i.quantity ?? 1 });
  }
  const root = index.instances.find((i) => i.path === "");
  const rootName = (root && (index.definition(root.definition)?.name ?? root.name)) ?? project;
  return {
    groups: [...tops.values(), { path: "", name: rootName, quantity: 1 }],
    // one top-level module that holds every instance (not the module itself placed on the system)
    of: (instances) => {
      const owners = [...new Set(instances.map((p) => p.split("/")[0] ?? ""))];
      return owners.length === 1 && tops.has(owners[0]) && instances.every((p) => p.includes("/")) ? owners[0] : "";
    },
  };
}

/**
 * The design's lines: one per part the system uses (per ordering code where
 * placements differ), with the pieces one unit needs, multiplied through the
 * instance tree. An assembly's contents are the lines, not the assembly. A
 * module a capability provider designs (a board, a printed or cut part) and
 * a cable to be assembled are made; a part the model says ships with another
 * is included; the rest is bought.
 */
export function designLines(index: CostIndex, project = ""): Lines {
  const byPath = new Map(index.instances.map((i) => [i.path, i]));
  const parents = new Set(index.instances.map((i) => i.parent).filter((p): p is string => p !== undefined));
  const memo = new Map<string, number>();
  const total = (path: string): number => {
    if (memo.has(path)) return memo.get(path)!;
    const i = byPath.get(path);
    const q = !i ? 1 : (i.quantity ?? 1) * (i.parent !== undefined && i.path !== "" ? total(i.parent) : 1);
    memo.set(path, q);
    return q;
  };
  const { groups, of } = groupsOf(index, project);
  const lines = new Map<string, Omit<BomLineInput, "offers">>();
  for (const i of index.instances) {
    if (i.path === "") continue;
    const def = index.definition(i.definition);
    const cap = index.capability(i.definition);
    const included = paramsOf(def).find((x) => typeof x.included_with === "string")?.included_with as string | undefined;
    const cable = def?.kind === "harness" && def.topology === "wire";
    // an assembly, a group, a harness kit: its contents are the lines
    if (!cap && !cable && parents.has(i.path)) continue;
    const placed = index.placement?.(i.path);
    const mpn = placed?.mpn ?? def?.part_number ?? "";
    const key = bomLineKey(i.definition, mpn, def?.part_number);
    const pack = paramsOf(def).map((x) => x.pack_quantity).find((v) => typeof v === "number" && Number.isInteger(v) && v > 1) as number | undefined;
    const kind = cap || (cable && !included) ? "make" : included ? "included" : "buy";
    const listing = kind === "buy" ? listingOf(def) : undefined;
    const status = index.partStatus?.(i.definition);
    const line = lines.get(key) ?? {
      key,
      definition: i.definition,
      item: def?.name ?? i.definition,
      manufacturer: def?.manufacturer ?? "",
      mpn,
      ...(placed?.value ? { value: placed.value } : {}),
      kind,
      ...(cap ? { process: `${cap.capability} (${cap.provider.replace(/^@[^/]+\//, "")})` } : cable && kind === "make" ? { process: "cable assembly" } : {}),
      ...(included ? { includedWith: included } : {}),
      quantity: 0,
      ...(pack ? { packQuantity: pack } : {}),
      group: "",
      instances: [],
      ...(listing ? { listing } : {}),
      ...(status ? { partStatus: status } : {}),
    };
    line.quantity += total(i.path);
    line.instances.push(i.path);
    lines.set(key, line);
  }
  for (const l of lines.values()) l.group = of(l.instances);
  return { lines: [...lines.values()], groups };
}

/** An ordering list's lines (`release/<version>/system/ordering-list.csv`, or any CSV with its columns). */
export function readOrderingList(file: string, rel: string, text: string = readFileSync(file, "utf8"), index?: CostIndex): Lines {
  const { rows, lines: at } = parseCsv(text);
  const [header = [], ...body] = rows;
  const col = (r: string[], k: string) => {
    const i = header.indexOf(k);
    return i >= 0 ? (r[i] ?? "") : "";
  };
  const g = index ? groupsOf(index, "") : { groups: [{ path: "", name: rel, quantity: 1 }], of: () => "" };
  const seen = new Set<string>();
  const lines = body.map((r, i): Omit<BomLineInput, "offers"> => {
    const definition = col(r, "definition");
    const def = index?.definition(definition);
    const mpn = col(r, "mpn");
    let key = mpn && mpn !== (def?.part_number ?? mpn) ? `${definition}#${mpn}` : definition;
    if (seen.has(key)) key = `${key}@${i + 1}`;
    seen.add(key);
    const action = col(r, "action");
    // an ordering list writes order 0 for a part that ships with another
    const kind = action === "fabricate" ? "make" : action === "included" || num(col(r, "order")) === 0 ? "included" : "buy";
    const instances = index ? index.instances.filter((x) => x.definition === definition && x.path !== "").map((x) => x.path) : [];
    const pack = num(col(r, "pack_qty"));
    const listing = kind === "buy" ? listingOf(def) : undefined;
    return {
      key,
      definition,
      item: col(r, "item") || definition,
      manufacturer: col(r, "manufacturer"),
      mpn,
      ...(col(r, "value") ? { value: col(r, "value") } : {}),
      kind,
      ...(col(r, "process") ? { process: col(r, "process") } : {}),
      ...(kind === "included" && /^included with /.test(col(r, "note")) ? { includedWith: col(r, "note").replace(/^included with /, "") } : {}),
      quantity: num(col(r, "qty_per_product")) ?? 0,
      ...(pack && pack > 1 ? { packQuantity: pack } : {}),
      group: g.of(instances),
      instances,
      ...(listing ? { listing } : {}),
      source: { file: rel, line: at[i + 1] },
    };
  });
  return { lines, groups: g.groups };
}

const sameCode = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * A line with the offers held for it. A line that is one value of a series
 * part (`exact`: a passive placed at a value, whose placements differ in
 * ordering code) takes only the offers for its own code: those that name
 * it, and those that name none when its code is the definition's own (an
 * offer without a code is for the definition's). It is never priced by
 * another value's offer; without an offer for its code it stays unpriced.
 * Any other line: when some offers name its code, those and the ones that
 * name none; else all.
 */
function withOffers(l: Omit<BomLineInput, "offers">, held: Map<string, BomOffer[]>, exact = Boolean(l.value)): BomLineInput {
  const all = l.kind === "buy" ? (held.get(l.definition) ?? []) : [];
  if (exact && l.mpn) {
    const own = !l.key.startsWith(`${l.definition}#`);
    return { ...l, offers: all.filter((o) => (o.mpn ? sameCode(o.mpn, l.mpn) : own)) };
  }
  const offers = l.mpn && all.some((o) => o.mpn && sameCode(o.mpn, l.mpn)) ? all.filter((o) => !o.mpn || sameCode(o.mpn, l.mpn)) : all;
  return { ...l, offers };
}

export interface ProjectBomOptions {
  /** Units to build; the project's setting (`parts/bom.json`), else 1. */
  units?: number;
  /** Take the lines from this release's ordering list instead of the design. */
  release?: ReleaseInfo;
  /** Take the lines from this CSV text (an ordering list being edited). */
  file?: { rel: string; text: string; release?: string };
  /** The moment prices are aged against (default: now). */
  now?: string;
}

/**
 * The project's bill of materials: the design's lines (or a release's),
 * the offers held, the project's chosen offers and units, priced in
 * dollars. Nothing when there is no system to list (no build yet).
 */
export function projectBom(root: string, project: string, index: CostIndex | undefined, options: ProjectBomOptions = {}): Bom | undefined {
  let lines: Lines;
  let source: Bom["source"];
  if (options.file) {
    lines = readOrderingList(join(root, options.file.rel), options.file.rel, options.file.text, index);
    source = options.file.release ? { kind: "release", version: options.file.release, file: options.file.rel } : { kind: "file", file: options.file.rel };
  } else if (options.release) {
    const rel = relative(root, join(options.release.dir, ORDERING_LIST)).split("\\").join("/");
    lines = readOrderingList(join(options.release.dir, ORDERING_LIST), rel, undefined, index);
    source = { kind: "release", version: options.release.version, file: rel };
  } else if (index) {
    lines = designLines(index, project);
    source = { kind: "design" };
  } else return undefined;
  const held = readHeldOffers(root, lines.lines.map((l) => l.definition));
  const { settings } = readBomSettings(root);
  const fx = readFx(root);
  return priceBom(
    { project, source, lines: lines.lines.map((l) => withOffers(l, held.offers)), groups: lines.groups, ...(held.retrievedAt ? { offersRetrievedAt: held.retrievedAt } : {}) },
    { units: options.units ?? settings.units ?? 1, choices: settings.offers ?? {}, fx: fx.table, fxFromProject: fx.project, now: options.now ?? new Date().toISOString() },
  );
}

/** One bought line to quote outside the bill (a release's ordering list): the pieces wanted already include its spares. */
export interface HeldLine {
  /** The bill's key for the line (`bomLineKey`), so the offer chosen in parts/bom.json applies. */
  key: string;
  definition: string;
  item: string;
  manufacturer: string;
  mpn: string;
  pieces: number;
  packQuantity?: number;
  /** One value of a series part: only offers for this ordering code count. */
  exact?: boolean;
}

/** The bill's key of a line: the definition, with the ordering code where a placement's differs from the definition's own. */
export const bomLineKey = (definition: string, mpn: string, definitionMpn: string | undefined) => (mpn && mpn !== (definitionMpn ?? "") ? `${definition}#${mpn}` : definition);

/**
 * Quote lines the way the bill of materials does: the offers the project
 * holds, the offer a person chose for the line (parts/bom.json), whole
 * packs, minimum orders and price breaks, in dollars with the project's
 * rate table. The release's ordering list uses it, so a release and the
 * bill agree on supplier and price for the same pieces.
 */
export function quoteHeldLines(root: string, lines: HeldLine[], now: string = new Date().toISOString()): { bom: Bom; line: (key: string) => BomLine | undefined } {
  const held = readHeldOffers(root, lines.map((l) => l.definition));
  const { settings } = readBomSettings(root);
  const fx = readFx(root);
  const input = lines.map((l) =>
    withOffers({ key: l.key, definition: l.definition, item: l.item, manufacturer: l.manufacturer, mpn: l.mpn, kind: "buy", quantity: l.pieces, ...(l.packQuantity ? { packQuantity: l.packQuantity } : {}), group: "", instances: [] }, held.offers, l.exact === true),
  );
  const bom = priceBom(
    { project: "", source: { kind: "design" }, lines: input, groups: [{ path: "", name: "", quantity: 1 }], ...(held.retrievedAt ? { offersRetrievedAt: held.retrievedAt } : {}) },
    { units: 1, choices: settings.offers ?? {}, fx: fx.table, fxFromProject: fx.project, now },
  );
  const by = new Map(bomLines(bom).map((l) => [l.key, l]));
  return { bom, line: (key) => by.get(key) };
}

/** What is wrong with the files the bill reads besides the design: the settings and the project's rate table. */
export function bomFileProblems(root: string): { file: string; message: string }[] {
  return [
    ...readBomSettings(root).problems.map((message) => ({ file: BOM_SETTINGS_FILE, message })),
    ...readFx(root).problems.map((message) => ({ file: FX_FILE, message })),
  ];
}

// ---- the cost, as the Cloud view shows it

export type LineKind = "priced" | "unpriced" | "made" | "included";

/** A bill's line in the Cloud view's terms. Prices are dollars. */
export interface CostLine {
  line: number;
  key: string;
  definition: string;
  item: string;
  manufacturer: string;
  mpn: string;
  /** What is made, for a made line. */
  process: string;
  qtyPerProduct: number;
  /** Pieces bought for the units built. */
  order: number;
  kind: LineKind;
  unitPrice?: number;
  currency?: string;
  /** What ordering the line costs. */
  extended?: number;
  supplier?: string;
  priceFrom?: "the library" | "the project's sourcing record";
  priceAsOf?: string;
  priceUrl?: string;
  note: string;
  row?: { file: string; line: number };
  instances: string[];
}

export interface CostModel {
  /** The bill the cost is of. */
  bill: Bom;
  source: Bom["source"];
  lines: CostLine[];
  bom: {
    /** One entry, in dollars: what the order costs. Empty when nothing is priced. */
    totals: { currency: string; amount: number }[];
    priced: number;
    unpriced: number;
    included: number;
  };
  manufacturing: { status: "needs-quote"; made: number };
  offers: { catalog: boolean; sourcing: number };
}

const KIND: Record<BomLine["status"], LineKind> = { priced: "priced", unpriced: "unpriced", make: "made", included: "included" };

export function costOf(bill: Bom): CostModel {
  const lines = bomLines(bill).map((l, i): CostLine => {
    const o = l.offers.find((x) => x.id === l.chosen);
    return {
      line: i + 1,
      key: l.key,
      definition: l.definition,
      item: l.item,
      manufacturer: l.manufacturer,
      mpn: l.mpn,
      process: l.process ?? "",
      qtyPerProduct: l.quantity,
      order: l.quote?.buy ?? (l.kind === "included" ? 0 : l.needed),
      kind: KIND[l.status],
      ...(l.quote?.unitPrice !== undefined ? { unitPrice: l.quote.unitPrice, currency: bill.currency, extended: l.orderCost! } : {}),
      ...(o ? { supplier: o.supplier, priceFrom: o.origin === "library" ? ("the library" as const) : ("the project's sourcing record" as const), ...(o.observedAt ? { priceAsOf: o.observedAt } : {}), ...(o.url ? { priceUrl: o.url } : {}) } : {}),
      note: l.notes.join("; "),
      ...(l.source ? { row: l.source } : {}),
      instances: l.instances,
    };
  });
  const held = bomLines(bill).flatMap((l) => l.offers);
  return {
    bill,
    source: bill.source,
    lines,
    bom: { totals: bill.counts.priced ? [{ currency: bill.currency, amount: bill.totals.order }] : [], priced: bill.counts.priced, unpriced: bill.counts.unpriced, included: bill.counts.included },
    manufacturing: { status: "needs-quote", made: bill.counts.make },
    offers: { catalog: held.some((o) => o.origin === "library"), sourcing: new Set(bomLines(bill).filter((l) => l.offers.some((o) => o.origin === "project")).map((l) => l.definition)).size },
  };
}

/** The project's cost: its bill of materials, in the Cloud view's terms. */
export function projectCost(root: string, project: string, index: CostIndex | undefined, options: ProjectBomOptions = {}): CostModel | undefined {
  const bill = projectBom(root, project, index, options);
  return bill ? costOf(bill) : undefined;
}

/** "$12.40" for USD, else "12.40 EUR". */
export function money(amount: number, currency: string): string {
  const fixed = amount.toFixed(2);
  return currency === "USD" ? `$${fixed}` : `${fixed} ${currency}`;
}

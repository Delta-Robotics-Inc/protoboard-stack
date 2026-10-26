/**
 * The offers a project holds for its parts, read from one place (PB-1033).
 *
 *   parts/offers.json                    the library's offers by part id, vendored by
 *                                        `protoboard parts offers` (`protoboard.offers/v0`)
 *   parts/evidence/<part>/sourcing.json  the project's own sourcing record, written by
 *                                        ext-sourcing (`protoboard.sourcing/v0`)
 *
 * Every reader of supplier numbers uses this: the bill of materials, the
 * generated board's supplier part numbers, the pick-and-place and the KiCad
 * fields written at lock. A part's offers come in one order of precedence:
 * a project part (researched or designed in the project) puts its own
 * evidence first, a library part (vendored from the catalog) its library
 * offers first. The first offer that names a supplier's code wins where one
 * number is needed (the LCSC field).
 *
 * Standalone (node:fs and node:path only), so the BOM can import it without
 * the rest of core: `@protoboardai/core/offers`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PART_OFFERS_FILE = "parts/offers.json";
export const PART_OFFERS_SCHEMA = "protoboard.offers/v0";
export const PART_SOURCING_SCHEMA = "protoboard.sourcing/v0";

/** An offer as `parts/offers.json` holds it (the library's price API). */
export interface LibraryOfferEntry {
  supplier: string;
  sku?: string;
  mpn?: string;
  [k: string]: unknown;
}

/** An offer as a sourcing record holds it (ext-sourcing). */
export interface SourcingOfferEntry {
  supplier: string;
  supplier_sku?: string;
  mpn?: string;
  [k: string]: unknown;
}

/** A sourcing record, as much of it as the readers here need. */
export interface SourcingRecordEntry {
  schema: string;
  mpn?: string;
  offers: SourcingOfferEntry[];
  [k: string]: unknown;
}

/** One offer the project holds, in a shape every reader shares, with the entry it came from. */
export type HeldPartOffer =
  | { origin: "library"; file: string; supplier: string; sku?: string; mpn?: string; entry: LibraryOfferEntry }
  | { origin: "project"; file: string; supplier: string; sku?: string; mpn?: string; entry: SourcingOfferEntry };

export interface PartOfferSet {
  part: string;
  /** Whether the part is vendored from the library (its library offers come first), else a project part. */
  library: boolean;
  /** Every offer for the part, in precedence order. */
  offers: HeldPartOffer[];
  /** The part's sourcing record, when it has a readable one. */
  record?: { file: string; data: SourcingRecordEntry };
}

export interface ProjectOffers {
  /** `parts/offers.json` when it is there and readable. */
  libraryFile?: { schema: string; service?: string; retrievedAt?: string; parts: Record<string, LibraryOfferEntry[]> };
  /** Part ids `parts/offers.json` holds offers for. */
  libraryParts: string[];
  forPart(part: string): PartOfferSet;
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** The ids of the parts vendored from the library (parts/origins.json beside the catalog folder). */
function vendoredIds(root: string, catalog = "parts/catalog"): Set<string> {
  const data = readJson(join(dirname(join(root, catalog)), "origins.json")) as { definitions?: Record<string, unknown> } | undefined;
  return new Set(Object.keys(data?.definitions ?? {}));
}

/**
 * The project's offers. `catalog` is the project's catalog folder (its
 * config's `catalog`), which says where parts/origins.json is: a part listed
 * there is a library part. A part not listed but held in parts/offers.json is
 * one too (offers are vendored only for catalog parts).
 */
export function readProjectOffers(root: string, options: { catalog?: string } = {}): ProjectOffers {
  const raw = readJson(join(root, PART_OFFERS_FILE)) as ProjectOffers["libraryFile"] | undefined;
  const libraryFile = raw && raw.schema === PART_OFFERS_SCHEMA && raw.parts && typeof raw.parts === "object" ? raw : undefined;
  const vendored = vendoredIds(root, options.catalog);
  const cache = new Map<string, PartOfferSet>();
  const forPart = (part: string): PartOfferSet => {
    const hit = cache.get(part);
    if (hit) return hit;
    const lib: HeldPartOffer[] = [];
    for (const o of libraryFile?.parts[part] ?? []) {
      if (!o || typeof o.supplier !== "string") continue;
      lib.push({ origin: "library", file: PART_OFFERS_FILE, supplier: o.supplier, ...(o.sku ? { sku: o.sku } : {}), ...(o.mpn ? { mpn: o.mpn } : {}), entry: o });
    }
    const file = `parts/evidence/${part}/sourcing.json`;
    let record: PartOfferSet["record"];
    const own: HeldPartOffer[] = [];
    const abs = join(root, file);
    if (existsSync(abs)) {
      const r = readJson(abs) as SourcingRecordEntry | undefined;
      if (r && r.schema === PART_SOURCING_SCHEMA && Array.isArray(r.offers)) {
        record = { file, data: r };
        for (const o of r.offers) {
          if (!o || typeof o.supplier !== "string") continue;
          // an offer that states no MPN is for the record's own
          const mpn = typeof o.mpn === "string" && o.mpn ? o.mpn : r.mpn;
          own.push({ origin: "project", file, supplier: o.supplier, ...(o.supplier_sku ? { sku: o.supplier_sku } : {}), ...(mpn ? { mpn } : {}), entry: o });
        }
      }
    }
    const library = vendored.has(part) || !!libraryFile?.parts[part];
    const set: PartOfferSet = { part, library, offers: library ? [...lib, ...own] : [...own, ...lib], ...(record ? { record } : {}) };
    cache.set(part, set);
    return set;
  };
  return { ...(libraryFile ? { libraryFile } : {}), libraryParts: Object.keys(libraryFile?.parts ?? {}), forPart };
}

// ---------------------------------------------------------------------------
// Supplier numbers
// ---------------------------------------------------------------------------

export type SupplierKey = "lcsc" | "digikey" | "mouser";
export type SupplierNumbers = Partial<Record<SupplierKey, string[]>>;
export const SUPPLIER_ORDER: SupplierKey[] = ["lcsc", "digikey", "mouser"];

/** The supplier a name means, when it is one with part numbers a fab or a CAD tool uses ("LCSC / JLCPCB assembly" is LCSC). */
export function supplierKey(name: string): SupplierKey | undefined {
  const n = name.toLowerCase();
  if (/\blcsc\b|jlc/.test(n)) return "lcsc";
  if (/digi-?key/.test(n)) return "digikey";
  if (/mouser/.test(n)) return "mouser";
  return undefined;
}

const sameMpn = (a: string, b: string) => a.replace(/[\s-]/g, "").toLowerCase() === b.replace(/[\s-]/g, "").toLowerCase();

/** Whether an offer is for a placement with this MPN: it names none, or the same one (a series passive's offers are per value). */
export const offerFits = (o: Pick<HeldPartOffer, "mpn">, mpn?: string) => !mpn || !o.mpn || sameMpn(o.mpn, mpn);

/** A placement's supplier part numbers by supplier, each list in precedence order (first is the one to use). */
export function supplierNumbersOf(set: PartOfferSet, mpn?: string): SupplierNumbers {
  const found: SupplierNumbers = {};
  for (const o of set.offers) {
    const key = supplierKey(o.supplier);
    if (!key || !o.sku || !offerFits(o, mpn)) continue;
    const list = (found[key] ??= []);
    if (!list.includes(o.sku)) list.push(o.sku);
  }
  return Object.fromEntries(SUPPLIER_ORDER.filter((k) => found[k]?.length).map((k) => [k, found[k]!])) as SupplierNumbers;
}

/** The LCSC number for a placement of `part` with this MPN, when the project holds one. */
export const lcscNumberOf = (offers: ProjectOffers, part: string, mpn?: string) => supplierNumbersOf(offers.forPart(part), mpn).lcsc?.[0];

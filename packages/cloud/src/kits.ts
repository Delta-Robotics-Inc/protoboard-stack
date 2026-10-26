/**
 * Kit manifests (PB-867): what a purchasable kit contains, item by item,
 * with the catalog part each item is and how many come in the box. The
 * library keeps them in `library/kits/<kit>.json` (library/taxonomy.ts reads
 * and checks them); the seed gives them to the service (`PUT /v1/kits/:kit`)
 * and the service serves them (`GET /v1/kits`, `GET /v1/kits/:kit`, the
 * discovery capability `x-kits`).
 *
 * A kit is a node of the taxonomy (`kit.<name>`, UHD keeps the node and
 * leaves the contents to the library that publishes them). Its parts are
 * filed under that node, so `GET /v1/parts?taxonomy=kit.<name>` finds them;
 * the manifest adds what search cannot: quantities, the kit's own labels,
 * series placements and the items that are not catalog parts.
 *
 * Pure, and free of `@deltarobotics/uhd` like the rest of the server.
 */

export interface KitItem {
  /** The catalog part; absent for an item the catalog does not model. */
  part_id?: string;
  /** The ProtoPart part the item came from (the kit was carried over from ProtoPart). */
  protopart_id?: string;
  /** The kit's own name for the item (its packing list). */
  kit_label: string;
  /** How many come in the kit. */
  quantity: number;
  /** Kit contents that are not circuit parts (cables, media, boxes). */
  unmodeled?: boolean;
  /** For a series part: the placement (ChildModuleRef overrides). */
  overrides?: Record<string, unknown>;
  /** For a series part: the ordering code the placement resolves to. */
  mpn?: string;
  note?: string;
  tutorials?: { title: string; url: string }[];
}

export interface KitManifest {
  /** The kit's taxonomy path, `kit.<name>`. */
  kit: string;
  name: string;
  sku?: string;
  vendor?: string;
  docs_url?: string;
  source_url?: string;
  controller_part_id?: string | null;
  notes?: string;
  provenance?: string;
  items: KitItem[];
}

/** One row of `GET /v1/kits`. */
export interface KitSummary {
  kit: string;
  name: string;
  sku?: string;
  vendor?: string;
  /** Items in the manifest, and the distinct catalog parts they name. */
  items: number;
  parts: number;
  setAt: string;
  digest: string;
}

/** `GET /v1/kits/:kit`: the manifest as given, and the latest revision of each part it names (null: not in the catalog). */
export interface KitResult {
  manifest: KitManifest;
  setAt: string;
  digest: string;
  revisions: Record<string, number | null>;
}

export const KIT_PATH = /^kit\.[a-z][a-z0-9_]*$/;

/** What is wrong with a kit manifest body, as `{ at, message }` problems; empty when it is one. */
export function kitManifestProblems(body: unknown): { at?: string; message: string }[] {
  const out: { at?: string; message: string }[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return [{ message: "the body must be a kit manifest object" }];
  const k = body as Record<string, unknown>;
  if (typeof k.kit !== "string" || !KIT_PATH.test(k.kit)) out.push({ at: "kit", message: "kit must be a taxonomy path kit.<name>" });
  if (typeof k.name !== "string" || !k.name.trim()) out.push({ at: "name", message: "name must be a non-empty string" });
  for (const f of ["sku", "vendor", "docs_url", "source_url", "notes", "provenance"]) if (k[f] !== undefined && typeof k[f] !== "string") out.push({ at: f, message: `${f} must be a string` });
  if (k.controller_part_id !== undefined && k.controller_part_id !== null && typeof k.controller_part_id !== "string") out.push({ at: "controller_part_id", message: "controller_part_id must be a part id or null" });
  if (!Array.isArray(k.items) || !k.items.length) out.push({ at: "items", message: "items must be a non-empty array" });
  else
    k.items.forEach((raw, i) => {
      const it = raw as Record<string, unknown> | null;
      const at = `items[${i}]`;
      if (!it || typeof it !== "object" || Array.isArray(it)) return out.push({ at, message: "an item is an object" });
      if (typeof it.kit_label !== "string" || !it.kit_label.trim()) out.push({ at: `${at}.kit_label`, message: "kit_label must be a non-empty string" });
      if (!Number.isInteger(it.quantity) || (it.quantity as number) < 1) out.push({ at: `${at}.quantity`, message: "quantity must be an integer >= 1" });
      if (it.part_id !== undefined && (typeof it.part_id !== "string" || !it.part_id)) out.push({ at: `${at}.part_id`, message: "part_id must be a part id" });
      if (it.part_id === undefined && it.unmodeled !== true && it.protopart_id === undefined) out.push({ at, message: "an item names a part_id, or is marked unmodeled" });
      if (it.overrides !== undefined && (typeof it.overrides !== "object" || it.overrides === null || Array.isArray(it.overrides))) out.push({ at: `${at}.overrides`, message: "overrides must be an object" });
      if (it.overrides !== undefined && it.part_id === undefined) out.push({ at: `${at}.overrides`, message: "overrides place a part: the item needs its part_id" });
      return undefined;
    });
  return out;
}

/** The catalog parts a manifest names, once each, sorted. */
export const kitPartIds = (m: KitManifest): string[] => [...new Set(m.items.flatMap((i) => (i.part_id ? [i.part_id] : [])))].sort();

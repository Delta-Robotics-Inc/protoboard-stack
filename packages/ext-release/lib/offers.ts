/**
 * Ordering data, offline only. A release never calls a service; it reads what
 * the project holds. Which offer a line is quoted from, and its price, are
 * the bill of materials' (bom.ts, ext-sourcing `quoteHeldLines`); this
 * module reads the rest: the sourcing record's lifecycle and alternates,
 * the pack the model states, and a listing the model cites.
 *
 *   1. catalog offers vendored by `protoboard parts offers` into
 *      `parts/offers.json` (`protoboard.offers/v0`: the parts service's
 *      offers by part id, prices by source, with the service and retrieval
 *      time);
 *   2. sourcing evidence, `parts/evidence/<id>/sourcing.json`
 *      (@protoboardai/ext-sourcing: dated offers with price breaks, lifecycle,
 *      alternates);
 *   3. a supplier listing the model itself cites (a `usage_note` trait whose
 *      note starts "Supplier listing:" and whose source is the listing URL):
 *      where to buy, without price or stock.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { OFFERS_FILE, OFFERS_SCHEMA, type Project } from "@protoboardai/core";
import type { OffersFile } from "@protoboardai/core";
import { readProjectOffers } from "@protoboardai/core/offers";
import type { Offer, SourcingRecord } from "@protoboardai/ext-sourcing/lib/sourcing.ts";

export type { OffersFile } from "@protoboardai/core";
type CatalogOffer = OffersFile["parts"][string][number];

export interface Sourcing {
  /** Offers from every offline source, in the sourcing record's shape. */
  offers: (Offer & { origin: "catalog" | "sourcing" })[];
  record?: SourcingRecord;
  recordFile?: string;
  /** A listing the model cites, when no offer exists. */
  listing?: { supplier: string; url: string };
  /** Units per pack the model states (performance trait pack_quantity). */
  packQuantity?: number;
}

export function readOffersFile(root: string): OffersFile | undefined {
  const f = join(root, OFFERS_FILE);
  if (!existsSync(f)) return undefined;
  const data = JSON.parse(readFileSync(f, "utf8")) as OffersFile;
  if (data.schema !== OFFERS_SCHEMA) throw new Error(`${OFFERS_FILE} is not ${OFFERS_SCHEMA}`);
  return data;
}

/**
 * A catalog offer in the sourcing record's shape. An offer states the MPN it
 * is for (a series part's offers are per value); one vendored before MPNs
 * were required is taken to be for the definition's own MPN.
 */
const catalogOffer = (o: CatalogOffer, defMpn: string): Offer & { origin: "catalog" } => {
  const currency = o.currency;
  const breaks = currency
    ? o.priceBreaks?.length
      ? o.priceBreaks.map((b) => ({ quantity: b.quantity, unit_price: b.unitPrice, currency }))
      : typeof o.unitPrice === "number"
        ? [{ quantity: o.minQuantity ?? 1, unit_price: o.unitPrice, currency }]
        : []
    : [];
  return {
    origin: "catalog",
    supplier: o.supplier,
    ...(o.sku ? { supplier_sku: o.sku } : {}),
    mpn: o.mpn || defMpn,
    // the listing's link; the library says nothing about how it fetched a price, and a file vendored before that is read the same way
    url: o.url ?? "",
    as_of: o.observedAt,
    via: "api",
    ...(o.authorized !== undefined ? { authorized: o.authorized } : {}),
    stock: o.stock ?? null,
    moq: o.minQuantity ?? null,
    ...(o.packaging ? { packaging: o.packaging } : {}),
    price_breaks: breaks,
    lead_time_weeks: o.leadTimeWeeks ?? null,
    ...(o.market ? { market: o.market } : {}),
    note: "catalog offer",
  };
};

/**
 * Everything the project holds about buying `def`. With `placementMpn` (one
 * value of a series passive, whose placements differ in MPN), only offers
 * and a sourcing record for that MPN count: each catalog offer names the MPN
 * it is for (one vendored without one counts for the definition's own).
 */
export function sourcingFor(p: Project, def: ModuleDef, catalog?: OffersFile, placementMpn?: string): Sourcing {
  const mpn = def.part_number ?? "";
  const catalogOffers: Sourcing["offers"] = (catalog?.parts[def.id] ?? []).map((o) => catalogOffer(o, mpn));
  // the sourcing record through core's one offer reader (PB-1033), which also says the precedence:
  // a project part's own evidence first, a library part's library offers first
  const held = readProjectOffers(p.root, { catalog: p.config.catalog }).forPart(def.id);
  let record: SourcingRecord | undefined = held.record?.data as SourcingRecord | undefined;
  let recordFile: string | undefined = held.record?.file;
  const own: Sourcing["offers"] = (record?.offers ?? []).map((o) => ({ ...o, origin: "sourcing" as const }));
  const offers: Sourcing["offers"] = held.library || !own.length ? [...catalogOffers, ...own] : [...own, ...catalogOffers];
  let listing: Sourcing["listing"];
  for (const t of def.traits ?? []) {
    const params = (t.params ?? {}) as Record<string, unknown>;
    const note = typeof params.note === "string" ? params.note : "";
    const src = Array.isArray(params.source) ? params.source[0] : params.source;
    if (t.type === "usage_note" && note.startsWith("Supplier listing:") && typeof src === "string") {
      const host = (() => {
        try {
          return new URL(src).hostname.replace(/^www\./, "");
        } catch {
          return src;
        }
      })();
      listing = { supplier: host, url: src };
      break;
    }
  }
  const pack = (def.traits ?? []).map((t) => (t.params as Record<string, unknown> | undefined)?.pack_quantity).find((v) => typeof v === "number" && Number.isInteger(v) && v > 1) as number | undefined;
  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  const placed = placementMpn ? offers.filter((o) => same(o.mpn, placementMpn)) : offers;
  // the record's lifecycle and alternates are about its own MPN
  if (placementMpn && record && !same(record.mpn, placementMpn)) record = undefined;
  if (!record && !placed.some((o) => o.origin === "sourcing")) recordFile = undefined;
  return { offers: placed, ...(record ? { record } : {}), ...(recordFile ? { recordFile } : {}), ...(listing ? { listing } : {}), ...(pack ? { packQuantity: pack } : {}) };
}

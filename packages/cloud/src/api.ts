/**
 * Response and request shapes of the parts API v1, shared by the server and
 * the client: types, and the few constant lists both sides check against.
 */
import type { PartRef, PartRevisionEnvelope } from "./envelope.js";
import type { TaxonomyTreeNode } from "./taxonomy.js";

export type { TaxonomyTreeNode, ServiceTaxonomyDocument } from "./taxonomy.js";

export interface Deprecation {
  reason: string;
  at: string;
  replacedBy?: PartRef;
}

export interface RevisionRow {
  partId: string;
  revision: number;
  digest: string;
  definitionDigest: string;
  uhdSchema: string;
  createdAt: string;
  publisher: string;
  deprecated?: Deprecation;
  /**
   * Service extra: whether this revision and every dependency it pins can
   * be given out (every file backing a definition artifact is
   * redistributable, UHD library protocol § 4.5).
   */
  redistributable?: boolean;
}

/**
 * Which files a request may see. `all` (the default) is the team's view:
 * every file whatever its terms. `redistributable` serves only parts whose
 * revision is redistributable, and only files whose terms say
 * `redistributable`: the view under `/distributable/v1`, or `?distribution=redistributable` on `/v1`.
 */
export type DistributionScope = "all" | "redistributable";

/** A file by content address (`GET /v1/blobs/:sha256`). */
export interface BlobRef {
  sha256: string;
  size: number;
  mediaType: string;
}

export interface PartSummary {
  partId: string;
  name: string;
  description?: string;
  manufacturer?: string;
  partNumber?: string;
  /** Taxonomy paths the definition lists (`ModuleDef.categories`), in its order. */
  categories: string[];
  /** Free-form tags and the category paths, merged (as the library manifest's `taxonomy`). */
  tags: string[];
  protocols: string[];
  domains: string[];
  /** Highest revision. */
  latestRevision: number;
  /** Highest revision that is not deprecated (absent when all are). */
  recommendedRevision?: number;
  deprecated?: Deprecation;
  /** The recommended revision's thumbnail file, when it carries one. */
  thumbnail?: BlobRef;
  /**
   * Service extra (capability `x-sort`): the part's relevance in this library,
   * 0 and up, higher first. A library-side value about the part (a seed the
   * library's owners set, plus recent use; docs/relevance.md), never part of
   * a revision or its digest. Absent from libraries that do not rank.
   */
  relevance?: number;
}

/** The orders `GET /v1/parts` takes in `sort` (capability `x-sort`; docs/relevance.md). */
export const SEARCH_SORTS = ["relevance", "name", "manufacturer", "updated"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** One price break: the unit price from `quantity` pieces up, in the offer's currency. */
export interface OfferPriceBreak {
  quantity: number;
  unitPrice: number;
}

/**
 * A supplier offer: commercial data about a part, kept apart from its
 * technical facts. An offer is for one ordering code (`mpn`): a series part
 * (one catalog part per manufacturer series, e.g. a resistor family) is
 * placed at many values, each its own MPN, and each is priced only by offers
 * for that MPN.
 *
 * Prices are per piece of the part. A pack sold as one item is stated per
 * piece, with the pack in `packaging` and `minQuantity`.
 */
export interface Offer {
  id?: number;
  partId: string;
  /** The ordering code this offer is for, as the manufacturer states it (packaging suffix included). Offers stored before MPNs were required carry the part's own `part_number`. */
  mpn: string;
  supplier: string;
  /** The supplier's own code for the item. */
  sku?: string;
  url?: string;
  /** Price per piece at the first break (`minQuantity`, else 1): what a client that reads one price quotes. */
  unitPrice?: number;
  /** ISO 4217. Prices are never converted. */
  currency?: string;
  /** Every price break shown, ascending by quantity; the first one's price is `unitPrice`. */
  priceBreaks?: OfferPriceBreak[];
  /** Minimum order quantity, in pieces. */
  minQuantity?: number;
  /** Pieces in stock at the supplier when observed; 0 when it showed none. */
  stock?: number;
  /** Lead time the supplier states, in weeks. */
  leadTimeWeeks?: number;
  /** Packaging or sale unit as listed: "Tape & Reel", "pack of 10". */
  packaging?: string;
  /** Storefront or market: "US", "DE", "CN". */
  market?: string;
  /** A franchised distributor or the manufacturer's own store; absent when not known. */
  authorized?: boolean;
  /** INTERNAL, publishers only: what the observer wrote down about the listing and how it was read. Never served to users. */
  note?: string;
  /** When the offer was observed at the supplier (when the price was fetched). */
  observedAt: string;
  /**
   * INTERNAL, publishers only: where the observation came from (a URL, a quote
   * reference; "protopart-import" for prices carried over from ProtoPart).
   * Required when an offer is recorded; never served to users (`PUBLIC_OFFER_FIELDS`).
   */
  source?: string;
  /** The observation is too old, or the product discontinued, to quote as a current price: history, not a quote. Absent means not known to be stale. */
  stale?: boolean;
}

/**
 * The members of an offer a user is served (`GET /v1/parts/:id/offers`): the
 * result of pricing, by source. Everything else an offer record holds
 * (`source`, `note`: how and where the price was read) stays in the service
 * and is given only to a publisher who asks for the internal view. A new
 * member is internal until it is added here; test/offers-public.test.ts pins
 * the list.
 */
export const PUBLIC_OFFER_FIELDS = [
  "id",
  "partId",
  "mpn",
  "supplier",
  "sku",
  "url",
  "unitPrice",
  "currency",
  "priceBreaks",
  "minQuantity",
  "stock",
  "leadTimeWeeks",
  "packaging",
  "market",
  "authorized",
  "observedAt",
  "stale",
] as const;
/** An offer as users see it. */
export type PublicOffer = Pick<Offer, (typeof PUBLIC_OFFER_FIELDS)[number]>;

export interface SearchQuery {
  q?: string;
  /** Taxonomy path: parts with a category at it or below it. */
  taxonomy?: string;
  domain?: string;
  protocol?: string;
  tag?: string;
  /** The same filter as `taxonomy` (this service's name for it before the protocol); `taxonomy` wins when both are given. */
  category?: string;
  includeDeprecated?: boolean;
  limit?: number;
  /** `nextCursor` of the previous page. */
  cursor?: string;
  /** Before cursors; still accepted. */
  offset?: number;
  /** Return facet counts. */
  facets?: boolean;
  /** `redistributable`: only parts whose recommended revision is redistributable (`DistributionScope`). */
  distribution?: "redistributable";
  /**
   * The order of the results (capability `x-sort`, this library's extension):
   * `relevance` (the default: with search words, the closeness of the text
   * match first and relevance within it), `name`, `manufacturer` or `updated`
   * (newest revision first). Ties end on the part id, so every order is
   * stable. A library without the capability ignores it.
   */
  sort?: SearchSort;
}

/** Counts of matching parts per value, over every page; taxonomy counts each path and every ancestor. */
export interface SearchFacets {
  taxonomy: Record<string, number>;
  domain: Record<string, number>;
  protocol: Record<string, number>;
  tag: Record<string, number>;
  /**
   * Service extra (not part of the protocol): parts per taxonomy path (each
   * part counted once at every ancestor of its categories), over every filter
   * of the query except the taxonomy filter, so a drill-down shows the counts
   * of siblings and children alike.
   */
  categories: Record<string, number>;
}

/** `GET /v1/parts`: the uhd-library/v1 search response. */
export interface SearchResult {
  total: number;
  parts: PartSummary[];
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null;
  facets?: SearchFacets;
}

/** `GET /.well-known/uhd-library` and `GET /v1`: the uhd-library/v1 discovery document, plus the service's counts. */
export interface Discovery {
  protocol: "uhd-library/v1";
  name: string;
  id: string;
  description?: string;
  version: string;
  api: string;
  envelopeSchemas: string[];
  uhdSchema: { min: string; below: string };
  /** `id` is a service extra: the taxonomy's id ("uhd"). */
  taxonomy: { id?: string; version: string; namespaces?: string[] } | null;
  capabilities: string[];
  auth: { read: "none" } | { read: "bearer"; realm?: string; documentation?: string };
  limits: { defaultPageSize: number; maxPageSize: number };
  /** Service extras (not part of the protocol). */
  service: string;
  publishing: boolean;
  /** The scope this document describes; on the team's view, where the redistributable view lives. */
  distribution: DistributionScope;
  views?: { redistributable: string };
  /** With capability `x-sort`: the values `sort` takes in a search, and the order without it. */
  sort?: { values: SearchSort[]; default: SearchSort };
  /**
   * How to sign in, when the service authenticates users (PB-911). From
   * 0.2.0 (PB-928) every read of the library needs a signed-in user:
   * `required` lists them (search, taxonomy, parts, revisions, files, kits,
   * offers, downloads), and `auth.read` is `bearer`. Firebase details are
   * identifiers for clients, never secrets.
   */
  account?: {
    required: string[];
    provider: "firebase";
    projectId?: string;
    apiKey?: string;
    signInUrl?: string;
    deviceUrl?: string;
    emulator?: string;
  };
  /** The library's counts: left out for a request that is not signed in, when the service authenticates users. */
  parts?: number;
  revisions?: number;
  blobs?: number;
  blobBytes?: number;
}

/** `GET /v1/taxonomy`: the taxonomy the service uses, with part counts. */
export interface TaxonomyResult {
  taxonomy: {
    id: string;
    version: string;
    extensions: { library: string; root: string; taxonomyVersion: string }[];
    /** When it was given to the service. */
    setAt: string;
  };
  /** Parts counted (the query's filters apply, the taxonomy filter excepted). */
  total: number;
  /** Of those, parts with no category. */
  uncategorised: number;
  nodes: TaxonomyTreeNode[];
  /** Category paths parts list that the taxonomy does not have, with their part counts. */
  unknown: { path: string; count: number }[];
}

/** `GET /v1/parts/:partId/revisions/:revision/closure`. */
export interface Closure {
  root: PartRef;
  /** The root and every transitive dependency, each at its pinned revision; dependencies first. */
  revisions: PartRevisionEnvelope[];
  /** Parts reached at more than one revision (a project can hold only one). */
  conflicts: { partId: string; revisions: number[] }[];
}

/** Every error response: `{ error: ApiError }`. */
export interface ApiError {
  code: string;
  message: string;
  [detail: string]: unknown;
}

/** A part's relevance seed: the value the library's owners gave it (library/relevance.json), with the reason. */
export interface RelevanceSeed {
  partId: string;
  seed: number;
  reason?: string;
  setAt?: string;
}

/** `PUT /v1/relevance`: every seed, as `{ <partId>: { seed, reason? } }`; a part left out is cleared to 0. */
export type RelevanceSeeds = Record<string, { seed: number; reason?: string }>;

export interface RelevanceSeedsResult {
  /** Seeds written (new, or a changed value or reason). */
  set: number;
  unchanged: number;
  /** Parts that had a seed and are not in the body: now 0. */
  cleared: number;
  /** Seeded part ids the catalog does not hold (kept: they apply when the part is published). */
  unknown: string[];
}

/** What a recorded download is counted as: a revision asked for by itself, or one pulled in as a pinned dependency of another. */
export type UsageKind = "revision" | "dependency";

/** One part in `GET /v1/usage` (publishers only). */
export interface UsageRow {
  partId: string;
  name?: string;
  /** Requests for the full revision in the period, every one counted: adds, and looks (a detail page, an update check). */
  downloads: number;
  /** Closure downloads (`parts add`, an applied `parts update`, the VS Code add), once per account, part revision and day: what informs relevance. */
  adds: number;
  /** The same two numbers for the revisions downloaded, by revision. */
  revisions: Record<string, { downloads: number; adds: number }>;
  /** Times the part came along as a pinned dependency of another (once per account, revision and day). */
  asDependency: number;
  seed: number;
  relevance: number;
}

/** `GET /v1/usage`: the most added parts over a period (publishers only). */
export interface UsageReport {
  /** First and last day counted (UTC, `YYYY-MM-DD`), inclusive. */
  from: string;
  to: string;
  days: number;
  totals: { downloads: number; adds: number; parts: number };
  /** By adds, then downloads, then part id. */
  parts: UsageRow[];
  /** Adds per day over the period, days without any left out. */
  daily: { day: string; downloads: number; adds: number }[];
}

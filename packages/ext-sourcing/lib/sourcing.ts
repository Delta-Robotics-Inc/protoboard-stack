/**
 * Sourcing evidence records: `parts/evidence/<id>/sourcing.json`, schema
 * protoboard.sourcing/v0 (skills/supplier-compare/references/sourcing-record.md).
 *
 * A record holds what was observed about buying one ordering code: offers
 * (supplier, stock, price breaks), lifecycle, alternates, the risks a person
 * accepted, and which sources were available to look at. Every observation is
 * dated and sourced. These are observations, not engineering facts: they never
 * go into the UHD definition, and nothing here places or prepares an order.
 */

export const SOURCING_SCHEMA = "protoboard.sourcing/v0";

/**
 * Days after which the newest offer is reported as stale (info only). The
 * extension's default, not a sourced figure: prices and stock move on month
 * timescales, so a quarter-old observation should be re-read before it is quoted.
 */
export const STALE_DAYS = 90;

/** Stock below this multiple of the needed quantity wants a named alternate. */
export const STOCK_COVERAGE = 10;

export type LifecycleStatus = "active" | "nrnd" | "ltb" | "eol" | "obsolete" | "unknown";
export type RiskCode = "single-source" | "low-stock" | "lifecycle";
export type AlternateRelation = "family-variant" | "form-fit-function" | "pin-compatible" | "near-miss";

export interface PriceBreak {
  quantity: number;
  unit_price: number;
  /** ISO 4217, e.g. USD. Offers in different currencies are never converted. */
  currency: string;
}

export interface Offer {
  supplier: string;
  supplier_sku?: string;
  /** The ordering code as this supplier lists it, packaging suffix included. */
  mpn: string;
  /** The supplier's canonical product URL (as the API or page gives it). */
  url: string;
  /** When it was read (ISO date or date-time). */
  as_of: string;
  /** How it was read: a supplier API, a web page read, or a person reading it out. */
  via: "api" | "web" | "human";
  /** Franchised/authorized distributor for this manufacturer; null when not known. */
  authorized?: boolean | null;
  stock?: number | null;
  moq?: number | null;
  packaging?: string;
  price_breaks?: PriceBreak[];
  lead_time_weeks?: number | null;
  /** Storefront or market, e.g. "US" or "CN": catalogs differ by market and language. */
  market?: string;
  note?: string;
}

export interface Alternate {
  mpn: string;
  manufacturer: string;
  relation: AlternateRelation;
  /** What differs (pinout, rating, package, firmware, suffix). "None" is a claim too. */
  differences: string;
  /** For a near-miss: the one line on why it lost. */
  lost_because?: string;
  /** URL or project file that supports the comparison. */
  evidence?: string;
}

export interface AcceptedRisk {
  code: RiskCode;
  reason: string;
  accepted_by: string;
  date: string;
}

export interface CapabilityRow {
  /** A source or tool: "manufacturer site", "distributor API (parametric)", "datasheet parser". */
  source: string;
  available: boolean;
  used: boolean;
  note?: string;
}

export interface SourcingRecord {
  schema: typeof SOURCING_SCHEMA;
  /** The UHD definition id this record is about. */
  part: string;
  manufacturer: string;
  /** Exact ordering code, suffix included. */
  mpn: string;
  need?: { quantity: number; note?: string };
  offers: Offer[];
  lifecycle?: { status: LifecycleStatus; source: string; as_of: string; notes?: string };
  alternates?: Alternate[];
  risks?: AcceptedRisk[];
  capability?: CapabilityRow[];
}

export interface SourcingIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}

const LIFECYCLE: LifecycleStatus[] = ["active", "nrnd", "ltb", "eol", "obsolete", "unknown"];
const RELATIONS: AlternateRelation[] = ["family-variant", "form-fit-function", "pin-compatible", "near-miss"];
const RISKS: RiskCode[] = ["single-source", "low-stock", "lifecycle"];
const VIA = ["api", "web", "human"];

/** Keys that would make a record an order, a cart or a credential store. */
const FORBIDDEN_KEY = /^(order|order_id|order_number|orders|cart|cart_id|checkout|purchase|purchase_order|po|po_number|api_key|apikey|access_token|refresh_token|token|secret|client_secret|password|session|session_id|cookie|authorization)$/i;
/** URL query parameters that carry credentials (some supplier APIs take the key as a query parameter). */
const CREDENTIAL_PARAM = /^(api_?key|key|token|access_token|client_secret|secret|password|sig|signature)$/i;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isDate = (x: unknown): x is string => isStr(x) && /^\d{4}-\d{2}-\d{2}/.test(x) && !Number.isNaN(Date.parse(x));
const normMpn = (s: string) => s.trim().toUpperCase();

function forbiddenKeys(x: unknown, at: string, out: string[]): void {
  if (Array.isArray(x)) x.forEach((v, i) => forbiddenKeys(v, `${at}[${i}]`, out));
  else if (isObj(x))
    for (const [k, v] of Object.entries(x)) {
      if (FORBIDDEN_KEY.test(k)) out.push(at ? `${at}.${k}` : k);
      forbiddenKeys(v, at ? `${at}.${k}` : k, out);
    }
}

function credentialParams(url: string): string[] {
  try {
    return [...new URL(url).searchParams.keys()].filter((k) => CREDENTIAL_PARAM.test(k));
  } catch {
    return [];
  }
}

/** Every http(s) URL in any string of the record (urls, sources, evidence, notes) whose query carries a credential. */
function credentialUrls(x: unknown, at: string, out: { at: string; params: string[] }[]): void {
  if (Array.isArray(x)) x.forEach((v, i) => credentialUrls(v, `${at}[${i}]`, out));
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) credentialUrls(v, at ? `${at}.${k}` : k, out);
  else if (typeof x === "string")
    for (const [url] of x.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const params = credentialParams(url);
      if (params.length) out.push({ at, params });
    }
}

/**
 * Validate one sourcing record and evaluate the selection rules on it. Errors
 * are malformed or forbidden content; warnings are disqualifiers nobody has
 * accepted (single source, low stock without an alternate, lifecycle);
 * info is coverage the reader should know about.
 */
export function validateSourcing(
  record: unknown,
  opts: { now?: Date; staleDays?: number; knownPart?: (id: string) => boolean } = {},
): SourcingIssue[] {
  const issues: SourcingIssue[] = [];
  const add = (code: string, severity: SourcingIssue["severity"], message: string) => issues.push({ code, severity, message });

  if (!isObj(record) || record.schema !== SOURCING_SCHEMA) {
    add("SRC_RECORD_INVALID", "error", `not a ${SOURCING_SCHEMA} record (schema is ${isObj(record) ? JSON.stringify(record.schema) : typeof record})`);
    return issues;
  }
  const missing = (["part", "manufacturer", "mpn"] as const).filter((k) => !isStr(record[k]));
  if (missing.length) add("SRC_RECORD_INVALID", "error", `record lacks ${missing.join(", ")}`);
  if (!Array.isArray(record.offers)) {
    add("SRC_RECORD_INVALID", "error", "offers must be an array (empty when nothing was found)");
    return issues;
  }
  const r = record as unknown as SourcingRecord;

  const forbidden: string[] = [];
  forbiddenKeys(record, "", forbidden);
  if (forbidden.length) add("SRC_FORBIDDEN_FIELD", "error", `sourcing records are observations, never orders, carts or credentials: remove ${forbidden.join(", ")}`);
  const keyed: { at: string; params: string[] }[] = [];
  credentialUrls(record, "", keyed);
  for (const k of keyed) add("SRC_CREDENTIAL_IN_URL", "error", `${k.at} has a URL carrying ${k.params.join(", ")}: store the public URL, never one with a key in it`);

  if (opts.knownPart && isStr(r.part) && !opts.knownPart(r.part)) add("SRC_UNKNOWN_PART", "warning", `part "${r.part}" is not a definition in this project`);

  // ---- offers
  r.offers.forEach((o, i) => {
    const at = `offers[${i}]`;
    if (!isObj(o)) return add("SRC_OFFER_INCOMPLETE", "error", `${at} is not an object`);
    const lacks = [
      !isStr(o.supplier) && "supplier",
      !isStr(o.mpn) && "mpn",
      !(isStr(o.url) && /^https?:\/\//.test(o.url)) && "url (http/https)",
      !isDate(o.as_of) && "as_of (ISO date)",
      !VIA.includes(o.via as string) && "via (api|web|human)",
    ].filter(Boolean);
    if (lacks.length) add("SRC_OFFER_INCOMPLETE", "error", `${at}${isStr(o.supplier) ? ` (${o.supplier})` : ""} lacks ${lacks.join(", ")}: an undated or unsourced figure is not evidence`);
    if (isStr(o.mpn) && isStr(r.mpn) && normMpn(o.mpn) !== normMpn(r.mpn))
      add("SRC_OFFER_MPN_MISMATCH", "warning", `${at} (${o.supplier}) lists ${o.mpn}, the record is for ${r.mpn}: an offer for another ordering code is not evidence about this one; record it as an alternate or fix the MPN`);
    if (o.stock != null && !(Number.isInteger(o.stock) && o.stock >= 0)) add("SRC_OFFER_INCOMPLETE", "error", `${at} stock must be a whole number ≥ 0 or null (unknown)`);
    for (const [j, b] of (o.price_breaks ?? []).entries()) {
      if (!(isObj(b) && Number.isInteger(b.quantity) && b.quantity > 0 && typeof b.unit_price === "number" && b.unit_price >= 0 && /^[A-Z]{3}$/.test(String(b.currency))))
        add("SRC_OFFER_INCOMPLETE", "error", `${at}.price_breaks[${j}] needs quantity (whole number > 0), unit_price (≥ 0) and an ISO 4217 currency`);
    }
  });

  // ---- accepted risks
  const accepted = new Set<RiskCode>();
  for (const [i, k] of (r.risks ?? []).entries()) {
    if (!(isObj(k) && RISKS.includes(k.code) && isStr(k.reason) && isStr(k.accepted_by) && isDate(k.date))) {
      add("SRC_RECORD_INVALID", "error", `risks[${i}] needs code (${RISKS.join("|")}), reason, accepted_by and date: a risk is accepted by a named person, in writing`);
      continue;
    }
    accepted.add(k.code);
  }
  const rule = (code: RiskCode, diag: string, message: string) =>
    accepted.has(code) ? add("SRC_RISK_ACCEPTED", "info", `${message} (accepted: ${r.risks!.find((k) => k.code === code)!.reason})`) : add(diag, "warning", message);

  // ---- alternates
  for (const [i, a] of (r.alternates ?? []).entries()) {
    if (!(isObj(a) && isStr(a.mpn) && isStr(a.manufacturer) && RELATIONS.includes(a.relation) && isStr(a.differences)))
      add("SRC_RECORD_INVALID", "error", `alternates[${i}] needs mpn, manufacturer, relation (${RELATIONS.join("|")}) and differences`);
    else if (a.relation === "near-miss" && !isStr(a.lost_because)) add("SRC_RECORD_INVALID", "error", `alternates[${i}] is a near-miss with no lost_because`);
  }

  // ---- lifecycle
  if (!r.lifecycle) add("SRC_LIFECYCLE_UNKNOWN", "info", "no lifecycle observation recorded (lifecycle-alternates skill)");
  else if (!(isObj(r.lifecycle) && LIFECYCLE.includes(r.lifecycle.status) && isStr(r.lifecycle.source) && isDate(r.lifecycle.as_of)))
    add("SRC_RECORD_INVALID", "error", `lifecycle needs status (${LIFECYCLE.join("|")}), source and as_of`);
  else if (r.lifecycle.status === "unknown") add("SRC_LIFECYCLE_UNKNOWN", "info", `lifecycle status could not be established (${r.lifecycle.source})`);
  else if (r.lifecycle.status !== "active") rule("lifecycle", "SRC_LIFECYCLE", `${r.mpn} is ${r.lifecycle.status.toUpperCase()} per ${r.lifecycle.source} (${r.lifecycle.as_of})`);

  // ---- single source: distinct suppliers that list it and do not show zero stock. Brokers and
  // marketplaces (authorized: false) are offers but not independent sources: one distributor
  // plus a marketplace listing is still one source. Unknown (null) counts, as the record cannot tell.
  const valid = r.offers.filter((o) => isObj(o) && isStr(o.supplier) && isStr(o.mpn) && normMpn(o.mpn) === normMpn(String(r.mpn)));
  const listing = valid.filter((o) => o.stock !== 0);
  const suppliers = new Set(listing.map((o) => o.supplier.trim().toLowerCase()));
  const independent = new Set(listing.filter((o) => o.authorized !== false).map((o) => o.supplier.trim().toLowerCase()));
  const brokers = [...suppliers].filter((s) => !independent.has(s));
  const besides = brokers.length ? `; ${brokers.join(", ")} not authorized, so not counted` : "";
  if (suppliers.size === 0) add("SRC_NO_OFFER", "warning", `no supplier offer for ${r.mpn} with stock other than zero`);
  else if (independent.size === 0) rule("single-source", "SRC_SINGLE_SOURCE", `${r.mpn} is listed only by sellers that are not authorized distributors (${brokers.join(", ")})`);
  else if (independent.size === 1) rule("single-source", "SRC_SINGLE_SOURCE", `${r.mpn} is offered by one supplier only (${[...independent][0]}${besides})`);

  // ---- stock coverage at the needed quantity
  const qty = r.need?.quantity;
  if (qty !== undefined && !(Number.isInteger(qty) && qty > 0)) add("SRC_RECORD_INVALID", "error", "need.quantity must be a whole number > 0");
  else if (qty && valid.length) {
    const stocks = valid.map((o) => o.stock).filter((s): s is number => typeof s === "number");
    const best = stocks.length ? Math.max(...stocks) : undefined;
    // a near-miss lost to this part, often on a hard requirement: it is not somewhere to go when stock runs out
    const usable = (r.alternates ?? []).filter((a) => isObj(a) && isStr(a.mpn) && isStr(a.manufacturer) && RELATIONS.includes(a.relation) && a.relation !== "near-miss" && isStr(a.differences));
    if (best === undefined) add("SRC_STOCK_UNKNOWN", "info", `no offer states a stock figure; coverage of ${qty} is unknown`);
    else if (best < STOCK_COVERAGE * qty && !usable.length)
      rule("low-stock", "SRC_LOW_STOCK", `best single-supplier stock ${best} is under ${STOCK_COVERAGE}× the needed ${qty}, and no alternate is named (a near-miss does not count)`);
  }

  // ---- freshness and coverage
  const dates = valid.map((o) => Date.parse(o.as_of)).filter((t) => !Number.isNaN(t));
  const now = (opts.now ?? new Date()).getTime();
  const stale = opts.staleDays ?? STALE_DAYS;
  if (dates.length && now - Math.max(...dates) > stale * 86400000)
    add("SRC_STALE", "info", `newest offer was read ${new Date(Math.max(...dates)).toISOString().slice(0, 10)}, over ${stale} days ago: re-read before quoting price or stock`);
  if (!r.capability?.length) add("SRC_NO_CAPABILITY", "info", "no capability rows: a reader cannot tell which sources were available, so coverage is unknown");
  else {
    const missingSources = r.capability.filter((c) => isObj(c) && c.available === false).map((c) => c.source);
    if (missingSources.length) add("SRC_UNVERIFIED", "info", `searched without ${missingSources.join(", ")}: coverage is partial, treat the record as unverified for those sources`);
  }
  return issues;
}

/** The price paid per unit when buying `quantity` from this offer: the largest break at or below it, or the smallest break (an MOQ) above it. */
export function unitPriceAt(o: Offer, quantity: number): { unit_price: number; currency: string; buy: number } | undefined {
  const breaks = [...(o.price_breaks ?? [])].sort((a, b) => a.quantity - b.quantity);
  if (!breaks.length) return undefined;
  const buy = Math.max(quantity, o.moq ?? 0, breaks[0].quantity);
  const b = breaks.filter((x) => x.quantity <= buy).pop()!;
  return { unit_price: b.unit_price, currency: b.currency, buy };
}

/** The currency quotes use when the project names none (`currency` in protoboard.config.ts). */
export const DEFAULT_QUOTE_CURRENCY = "USD";

/**
 * A full reel: packaging that says reel (not cut tape, not a Digi-Reel
 * re-reeled to order) and that sells whole reels, because the packaging says
 * so ("unit pack 1300", "full reel") or because the least it sells is 500 or
 * more. LCSC's "Tape & Reel (TR)" from 1 or 5 pieces is cut from a reel and
 * is not one.
 */
export function isFullReel(o: Pick<Offer, "packaging" | "moq" | "price_breaks">): boolean {
  const pk = o.packaging ?? "";
  if (!/\breel\b/i.test(pk) || /cut|digi-?reel|\bCT\b|mouse-?reel/i.test(pk)) return false;
  if (/unit pack|full reel|whole reel|per reel/i.test(pk)) return true;
  const breaks = (o.price_breaks ?? []).map((b) => b.quantity);
  const least = Math.max(o.moq ?? 0, breaks.length ? Math.min(...breaks) : 0);
  return least >= 500;
}

/**
 * How an offer fits the quantity to order: `fits` (its minimum order is at
 * most the quantity), `overbuy` (a small minimum above it: a bag of 10 for 4
 * needed), `reel` (a full reel the quantity fills), `reel-over` (a full reel
 * for fewer than a reel: never quoted, only listed as an alternative).
 */
export type OfferFit = "fits" | "overbuy" | "reel" | "reel-over";

export interface OfferRow {
  supplier: string;
  market?: string;
  mpn: string;
  as_of: string;
  via: Offer["via"];
  authorized: boolean | null;
  stock: number | null;
  covers: boolean | null;
  buy?: number;
  unit_price?: number;
  extended?: number;
  currency?: string;
  url: string;
  /** False when the offer lists another ordering code: shown, but ranked after every matching offer. */
  mpn_matches: boolean;
  fit: OfferFit;
  /** Priced in the quote currency (offers in other currencies are alternatives, never converted). */
  in_currency: boolean;
  packaging?: string;
}

const FIT_RANK: Record<OfferFit, number> = { fits: 0, overbuy: 1, reel: 2, "reel-over": 3 };

/**
 * The offers for the needed quantity, best first: offers for the line's own
 * ordering code; then cut tape or an offer whose minimum order fits the
 * quantity before a full reel (a reel for fewer than a reel last of all);
 * then offers in the quote currency (`currency`, default USD) before others;
 * then cheapest extended cost (within a currency: never converted); then
 * offers without price breaks. `covers` is whether the stated stock covers
 * what is bought.
 */
export function compareOffers(r: SourcingRecord, quantity = r.need?.quantity ?? 1, opts: { currency?: string } = {}): OfferRow[] {
  const currency = opts.currency ?? DEFAULT_QUOTE_CURRENCY;
  const listed = r.offers.filter((o) => isObj(o) && isStr(o.supplier));
  const rows = listed.map((o): OfferRow => {
    const p = unitPriceAt(o, quantity);
    const stock = typeof o.stock === "number" ? o.stock : null;
    const reel = isFullReel(o);
    const over = (p?.buy ?? Math.max(quantity, o.moq ?? 0)) > quantity;
    return {
      supplier: o.supplier,
      market: o.market,
      mpn: o.mpn,
      as_of: isStr(o.as_of) ? o.as_of : "",
      via: o.via,
      authorized: o.authorized ?? null,
      stock,
      covers: stock === null ? null : stock >= (p?.buy ?? quantity),
      ...(p && { buy: p.buy, unit_price: p.unit_price, extended: Number((p.unit_price * p.buy).toFixed(4)), currency: p.currency }),
      url: o.url,
      mpn_matches: isStr(o.mpn) && isStr(r.mpn) && normMpn(o.mpn) === normMpn(r.mpn),
      fit: reel ? (over ? "reel-over" : "reel") : over ? "overbuy" : "fits",
      in_currency: (p?.currency ?? currency) === currency,
      ...(o.packaging ? { packaging: o.packaging } : {}),
    };
  });
  const reelRank = (x: OfferRow) => (x.fit === "reel" ? 1 : x.fit === "reel-over" ? 2 : 0);
  return rows.sort(
    (a, b) =>
      Number(b.mpn_matches) - Number(a.mpn_matches) ||
      reelRank(a) - reelRank(b) ||
      Number(b.in_currency) - Number(a.in_currency) ||
      FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
      (a.currency ?? "~").localeCompare(b.currency ?? "~") ||
      (a.extended ?? Infinity) - (b.extended ?? Infinity) ||
      a.supplier.localeCompare(b.supplier),
  );
}

/** What a quote says about the offer it uses or passes over. */
export interface OfferChoice {
  /** The offer row to quote; none when every priced offer is a full reel for fewer than a reel. */
  quoted?: OfferRow;
  /** Why the quote needs a look ("full reel", "quoted in GBP: no USD offer"), "" when nothing does. */
  flag: string;
  /** Priced offers not quoted that a buyer may still want: full reels, other currencies. */
  alternatives: OfferRow[];
}

/**
 * The offer to quote for `quantity` (the ranking of compareOffers): the best
 * offer for the line's own code whose stock covers the order (or does not
 * say), else any such offer, else any priced offer, else the first offer
 * without a price. A full reel for fewer than a reel is never quoted: the
 * line stays unpriced and the reel is an alternative. A full reel the
 * quantity fills, or an offer in another currency, is quoted and flagged.
 */
export function chooseOffer(r: SourcingRecord, quantity: number, opts: { currency?: string } = {}): OfferChoice {
  const currency = opts.currency ?? DEFAULT_QUOTE_CURRENCY;
  const ranked = compareOffers(r, quantity, { currency });
  const quotable = (x: OfferRow) => x.unit_price !== undefined && x.fit !== "reel-over";
  const usable = (x: OfferRow) => x.covers !== false && quotable(x);
  const quoted = ranked.find((x) => x.mpn_matches && usable(x)) ?? ranked.find(usable) ?? ranked.find(quotable) ?? ranked.find((x) => x.unit_price === undefined);
  const alternatives = ranked.filter((x) => x !== quoted && x.unit_price !== undefined && (x.fit === "reel-over" || x.fit === "reel" || !x.in_currency));
  const money = (x: OfferRow) => `${x.extended!.toFixed(2)} ${x.currency}`;
  let flag = "";
  if (!quoted || quoted.unit_price === undefined) {
    const reel = ranked.find((x) => x.fit === "reel-over");
    if (reel) flag = `no offer fits ${quantity}: ${reel.supplier} sells only a full reel of ${reel.buy} (${money(reel)}); not quoted`;
  } else if (quoted.fit === "reel") flag = `full reel: ${quoted.buy} from ${quoted.supplier}`;
  else if (!quoted.in_currency) flag = `quoted in ${quoted.currency}: no ${currency} offer`;
  return { ...(quoted ? { quoted } : {}), flag, alternatives };
}

/** One line per alternative, for an ordering list: "Rutronik24: full reel 1300 × 1.48 USD = 1924.00 USD". */
export function describeAlternatives(rows: OfferRow[]): string {
  return rows
    .map((x) => `${x.supplier}: ${x.fit === "reel" || x.fit === "reel-over" ? `full reel ${x.buy}` : `${x.buy}`} × ${x.unit_price} ${x.currency} = ${x.extended!.toFixed(2)} ${x.currency}`)
    .join("; ");
}

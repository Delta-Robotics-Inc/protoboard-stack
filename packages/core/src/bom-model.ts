/**
 * The bill of materials as a structured model (PB-933, docs/specs/bom.md).
 *
 * A line states what the design needs of one part per unit built, the offers
 * the project holds for it, the offer chosen, what has to be bought to build
 * N units (rounded up to whole packs and to the supplier's minimum order),
 * and two costs: what the parts used in a unit cost, and what the order
 * costs. Everything is in one currency, US dollars: an offer in another
 * currency is converted with a dated rate table (fx-rates.ts) and marked.
 *
 * This is the data source: `protoboard bom --format json` prints it, the BOM
 * views draw it and re-price it when the reader changes the units to build
 * or the offer of a line, and the CSV is an export of it (`bomCsv`).
 *
 * Pure and browser-safe: no file access, no clock (the caller says what
 * "now" is), no imports but the rate table.
 */
import { DEFAULT_FX, fxRate, type FxTable } from "./fx-rates.js";

export const BOM_SCHEMA = "protoboard.bom/v0";
/** The project's BOM settings: units to build and the offers a person chose. */
export const BOM_SETTINGS_FILE = "parts/bom.json";
export const BOM_SETTINGS_SCHEMA = "protoboard.bom-settings/v0";
/** The one currency of a bill of materials (owner decision, 2026-10-06: dollars for now). */
export const BOM_CURRENCY = "USD";
/**
 * Days after which a price is shown as stale. The library may also mark an
 * offer stale itself (`stale`), whatever its age. Ninety days is the
 * sourcing extension's figure for "re-read before quoting".
 */
export const BOM_STALE_DAYS = 90;

export interface BomSettings {
  schema: typeof BOM_SETTINGS_SCHEMA;
  /** Units to build (default 1). */
  units?: number;
  /** Line key → the id of the offer a person chose for it. A line not named takes the best offer. */
  offers?: Record<string, string>;
}

export interface BomPriceBreak {
  /** Pieces from which the price applies. */
  quantity: number;
  /** Per piece, in the offer's currency. */
  unitPrice: number;
}

/** One offer the project holds for a line: a supplier's price as the library (or the project's own record) gave it. */
export interface BomOffer {
  /** Unique within its line, stable while the offer is the same listing. */
  id: string;
  /** `library`: parts/offers.json, from the library's price API. `project`: the project's own sourcing record. */
  origin: "library" | "project";
  supplier: string;
  /** The supplier's own code. */
  sku?: string;
  /** The ordering code the offer is for. */
  mpn?: string;
  /** The supplier's page for the item. */
  url?: string;
  /** ISO 4217, as the supplier prices it. */
  currency?: string;
  /** Ascending by quantity; empty when the offer states no price. */
  breaks: BomPriceBreak[];
  /** Pieces per pack, when the listing sells packs. */
  packSize?: number;
  /** Minimum order, in pieces. */
  minOrder?: number;
  /** The sale unit as listed ("4-pack", "Tape & Reel"). */
  packaging?: string;
  /** Pieces in stock when observed; null or absent when the listing did not say. */
  stock?: number | null;
  leadTimeWeeks?: number | null;
  authorized?: boolean | null;
  market?: string;
  /** When the price was observed (ISO date or date-time). */
  observedAt?: string;
  /** The library marked the price too old to quote. */
  stale?: boolean;
  /** The project file that holds it. */
  file: string;
}

export type BomLineKind = "buy" | "make" | "included";

/** What the design says about one line, before pricing. */
export interface BomLineInput {
  /** Unique in the bill: the definition, with the ordering code where placements differ in it. */
  key: string;
  definition: string;
  item: string;
  manufacturer: string;
  mpn: string;
  /** A passive's value as placed ("4.7 kΩ ±1 %"). */
  value?: string;
  /** Bought, made for this product (a board, a printed or cut part: needs a quote), or shipped with another part. */
  kind: BomLineKind;
  /** What is made, for a made line. */
  process?: string;
  /** The part this one ships with. */
  includedWith?: string;
  /** Pieces one unit of the product needs. */
  quantity: number;
  /** Pieces per pack the part's own model states. */
  packQuantity?: number;
  /** The top-level module that uses it ("" for the system itself, or several modules). */
  group: string;
  /** Instances of the part in the system, in tree order. */
  instances: string[];
  offers: BomOffer[];
  /** A supplier listing the model cites, when no offer exists: where to buy, without a price. */
  listing?: { supplier: string; url: string };
  /** Where the line is written, when it comes from a file. */
  source?: { file: string; line: number };
  /** The part's status in the library (part-trust.ts), when known. */
  partStatus?: string;
}

/** How an offer fits what is needed (the sourcing extension's terms). */
export type BomFit = "fits" | "overbuy" | "reel" | "reel-over";

/** An offer worked out for the quantity a line needs. */
export interface BomQuote {
  offer: string;
  /** Why there is no price: the offer states none, or its currency has no rate. */
  problem?: "no-price" | "no-rate";
  /** Pieces to buy: the need, rounded up to whole packs and to the minimum order, or more where a price break makes more pieces cost less. */
  buy: number;
  packSize: number;
  packs: number;
  minOrder: number;
  /** Pieces bought beyond the need. */
  surplus: number;
  /**
   * The order was raised to a price break because that costs less: the
   * pieces the need alone would buy, and what they would cost (dollars).
   */
  raised?: { from: number; fromCost: number };
  /** Per piece, in dollars, at the price break `buy` reaches. */
  unitPrice?: number;
  /** `buy` × `unitPrice`: what the order of this line costs. */
  orderCost?: number;
  /** The price as the supplier states it, when it was converted. */
  native?: { unitPrice: number; currency: string; rate: number };
  fit: BomFit;
  /** The stated stock covers `buy`; null when the listing does not say. */
  covers: boolean | null;
  ageDays?: number;
  stale: boolean;
}

export type BomLineStatus = "priced" | "unpriced" | "make" | "included";

export interface BomLine extends BomLineInput {
  /** `quantity` × the units built. */
  needed: number;
  status: BomLineStatus;
  /** Every offer, best first. */
  quotes: BomQuote[];
  /** The quote used, when the line is priced. */
  quote?: BomQuote;
  /** The offer the quote is of. */
  chosen?: string;
  /** `auto`: the best offer by the rules; `pinned`: a person chose it; `pinned-gone`: the chosen offer is no longer held, so the best one is used. */
  choice: "auto" | "pinned" | "pinned-gone";
  /** `quantity` × `unitPrice`: what the pieces one unit uses cost. */
  perUnitCost?: number;
  /** What ordering this line costs for the units built. */
  orderCost?: number;
  /** What a reader should know about the price: converted, stale, packs, stock, a full reel. */
  notes: string[];
}

export interface BomGroupInfo {
  /** The top-level instance path ("" for the system itself). */
  path: string;
  name: string;
  /** Units of that module per product. */
  quantity: number;
}

export interface BomGroup extends BomGroupInfo {
  lines: BomLine[];
  /** Order cost of the group's priced lines. */
  orderCost: number;
}

export interface BomInput {
  project: string;
  /** Where the lines come from: the design (the system's instance tree), or a file (a release's ordering list). */
  source: { kind: "design" } | { kind: "release"; version: string; file: string } | { kind: "file"; file: string };
  lines: BomLineInput[];
  groups: BomGroupInfo[];
  /** When the library's offers were last fetched into the project. */
  offersRetrievedAt?: string;
}

export interface BomOptions {
  units?: number;
  /** Line key → chosen offer id. */
  choices?: Record<string, string>;
  fx?: FxTable;
  /** The table is the project's own (parts/fx-rates.json), not the built-in one. */
  fxFromProject?: boolean;
  /** The moment prices are aged against (ISO); the caller's clock. */
  now: string;
}

export interface Bom extends Omit<BomInput, "lines"> {
  schema: typeof BOM_SCHEMA;
  currency: typeof BOM_CURRENCY;
  units: number;
  /** What prices were aged against. */
  asOf: string;
  /** The rate table (whose it is, its date and source), and the rates to dollars this bill used. */
  fx: FxTable & { project: boolean; used: { currency: string; rate: number }[] };
  totals: {
    /** The parts one unit uses, at the prices paid: Σ quantity × unit price. */
    perUnit: number;
    /** What the order costs for `units`: Σ pieces bought × unit price. */
    order: number;
    /** `order` ÷ `units`. */
    orderPerUnit: number;
    /** Of `order`, what pays for pieces left over (packs, minimum orders): Σ pieces beyond the need × unit price. */
    surplus: number;
  };
  counts: { lines: number; buy: number; priced: number; unpriced: number; make: number; included: number; stale: number; converted: number; pinned: number; suppliers: number };
  /** The oldest and newest observation among the prices used. */
  prices: { oldest?: string; newest?: string };
  groups: BomGroup[];
  /** Line keys the settings name that the bill no longer has (a part was removed). */
  unknownChoices: string[];
}

const round = (v: number, places = 4) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** Pieces per pack a listing's sale unit states: "4-pack", "pack of 10", "set of 4", "purchase unit 100 pcs", "1 PU = 70 pieces". */
export function packSizeOf(packaging: string | undefined): number | undefined {
  if (!packaging) return undefined;
  const m =
    /(\d+)\s*-?\s*(?:pack|pk)\b/i.exec(packaging) ??
    /\b(?:pack|bag|box|set|kit|lot) of (\d+)/i.exec(packaging) ??
    /\b(?:purchase unit|PU)\s*(?:=|:|of)?\s*(\d+)\s*(?:pcs|pieces|pc)?/i.exec(packaging) ??
    /\b(\d+)\s*(?:pcs|pieces)\s*(?:per|\/)\s*(?:pack|bag|box|unit)/i.exec(packaging);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 1 ? n : undefined;
}

/**
 * A full reel: packaging that says reel (not cut tape, not re-reeled to
 * order) and sells whole reels, because it says so or because the least it
 * sells is 500 or more.
 */
export function isFullReel(o: { packaging?: string; minOrder?: number | null; breaks?: { quantity: number }[] }): boolean {
  const pk = o.packaging ?? "";
  if (!/\breel\b/i.test(pk) || /cut|digi-?reel|\bCT\b|mouse-?reel/i.test(pk)) return false;
  if (/unit pack|full reel|whole reel|per reel/i.test(pk)) return true;
  const q = (o.breaks ?? []).map((b) => b.quantity);
  return Math.max(o.minOrder ?? 0, q.length ? Math.min(...q) : 0) >= 500;
}

/** Whole days between an observation and `now`; nothing when either is not a date. */
export function ageInDays(observedAt: string | undefined, now: string): number | undefined {
  const a = observedAt ? Date.parse(observedAt) : NaN;
  const b = Date.parse(now);
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

/**
 * Pieces per pack of a listing: what its sale unit states (`packSizeOf`), or
 * its minimum order when it sells only in multiples of that ("sale-quantity
 * multiples": 5, 10, 15, never 8). One rule for the library's offers and the
 * project's own records.
 */
export function offerPackSize(packaging: string | undefined, minOrder: number | null | undefined): number | undefined {
  return packSizeOf(packaging) ?? (packaging && /multiples/i.test(packaging) && Number.isInteger(minOrder) && minOrder! > 1 ? minOrder! : undefined);
}

/**
 * One offer for `needed` pieces. The pack is the listing's own, else the
 * part's (`linePack`), else single pieces. What is bought is the need raised
 * to the minimum order (and to the first price break, which is a minimum
 * too), then rounded up to whole packs; the price is the break that quantity
 * reaches. Where buying up to a later price break costs less in all than
 * that (steep breaks on small parts: 10 at the 10-piece price under 8 at the
 * 5-piece price), the order is raised to it and says so (`raised`), unless
 * the stated stock covers the smaller order only.
 */
export function quoteOffer(o: BomOffer, needed: number, opts: { linePack?: number; fx?: FxTable; now: string }): BomQuote {
  const fx = opts.fx ?? DEFAULT_FX;
  const breaks = [...o.breaks].filter((b) => b.quantity > 0 && b.unitPrice >= 0).sort((a, b) => a.quantity - b.quantity);
  const packSize = Math.max(1, Math.ceil(o.packSize ?? opts.linePack ?? 1));
  const minOrder = Math.max(o.minOrder ?? 0, breaks[0]?.quantity ?? 0, 1);
  const want = Math.max(0, needed);
  let packs = want > 0 ? Math.ceil(Math.max(want, minOrder) / packSize) : 0;
  let buy = packs * packSize;
  const priceAt = (q: number) => breaks.filter((b) => b.quantity <= Math.max(q, breaks[0].quantity)).pop()!.unitPrice;
  let raised: { from: number; native: number } | undefined;
  if (buy > 0 && breaks.length) {
    const first = buy * priceAt(buy);
    let best = first;
    for (const b of breaks) {
      if (b.quantity <= buy) continue;
      const q = Math.ceil(b.quantity / packSize) * packSize;
      if (typeof o.stock === "number" && o.stock >= packs * packSize && o.stock < q) continue;
      // cheaper by a cent or more: a tie buys the fewer pieces
      if (q * priceAt(q) < best - 0.005) {
        best = q * priceAt(q);
        raised = { from: packs * packSize, native: first };
        buy = q;
      }
    }
    if (raised) packs = buy / packSize;
  }
  const age = ageInDays(o.observedAt, opts.now);
  const reel = isFullReel(o);
  const base = {
    offer: o.id,
    buy,
    packSize,
    packs,
    minOrder,
    surplus: Math.max(0, buy - want),
    fit: (reel ? (buy > want ? "reel-over" : "reel") : buy > want ? "overbuy" : "fits") as BomFit,
    covers: typeof o.stock === "number" ? o.stock >= buy : null,
    ...(age !== undefined ? { ageDays: age } : {}),
    stale: o.stale === true || (age !== undefined && age > BOM_STALE_DAYS),
  };
  if (!breaks.length || !o.currency) return { ...base, problem: "no-price" };
  const rate = fxRate(o.currency, BOM_CURRENCY, fx);
  if (rate === undefined) return { ...base, problem: "no-rate" };
  const at = { unitPrice: priceAt(buy) };
  const unitPrice = round(at.unitPrice * rate, 6);
  return { ...base, ...(raised ? { raised: { from: raised.from, fromCost: round(raised.native * rate) } } : {}), unitPrice, orderCost: round(unitPrice * buy), ...(o.currency !== BOM_CURRENCY ? { native: { unitPrice: at.unitPrice, currency: o.currency, rate: round(rate, 6) } } : {}) };
}

/**
 * Best first: an offer that can be quoted before one that cannot; one that
 * is not a full reel for fewer than a reel; one whose stock covers the order
 * (or does not say); a current price before a stale one; then the lowest
 * order cost in dollars; a price that needed no conversion; the supplier's
 * name.
 */
export function rankQuotes(quotes: BomQuote[], offers: BomOffer[]): BomQuote[] {
  const by = new Map(offers.map((o) => [o.id, o]));
  const n = (b: boolean) => (b ? 0 : 1);
  return [...quotes].sort(
    (a, b) =>
      n(a.unitPrice !== undefined) - n(b.unitPrice !== undefined) ||
      n(a.fit !== "reel-over") - n(b.fit !== "reel-over") ||
      n(a.covers !== false) - n(b.covers !== false) ||
      n(!a.stale) - n(!b.stale) ||
      (a.orderCost ?? Infinity) - (b.orderCost ?? Infinity) ||
      n(!a.native) - n(!b.native) ||
      (by.get(a.offer)?.supplier ?? "").localeCompare(by.get(b.offer)?.supplier ?? "") ||
      a.offer.localeCompare(b.offer),
  );
}

export function formatUsd(amount: number): string {
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/** A unit price: cents, or more places when it is under ten cents (a resistor at $0.0123). */
export function formatUnitUsd(amount: number): string {
  if (amount === 0 || amount >= 0.1) return formatUsd(amount);
  return `$${amount.toFixed(4).replace(/0{1,2}$/, "")}`;
}

function priceLine(l: BomLineInput, units: number, pinned: string | undefined, opts: { fx: FxTable; now: string }): BomLine {
  const needed = l.quantity * units;
  const base = { ...l, needed, quotes: [] as BomQuote[], choice: "auto" as BomLine["choice"], notes: [] as string[] };
  if (l.kind === "included") return { ...base, status: "included", notes: [l.includedWith ? `ships with ${l.includedWith}` : "ships with another part"] };
  if (l.kind === "make") return { ...base, status: "make", notes: [l.process ? `made: ${l.process}` : "made for this product"] };
  const quotes = rankQuotes(l.offers.map((o) => quoteOffer(o, needed, { ...(l.packQuantity ? { linePack: l.packQuantity } : {}), ...opts })), l.offers);
  const pin = pinned ? quotes.find((q) => q.offer === pinned) : undefined;
  const choice: BomLine["choice"] = pin ? "pinned" : pinned ? "pinned-gone" : "auto";
  // a person's choice is used as it is; the rules never quote a full reel for fewer than a reel
  const quote = pin ?? quotes.find((q) => q.unitPrice !== undefined && q.fit !== "reel-over");
  const notes: string[] = [];
  if (choice === "pinned-gone") notes.push("the offer chosen for this line is no longer held; the best offer is used");
  if (!quote || quote.unitPrice === undefined) {
    const reel = quotes.find((q) => q.fit === "reel-over" && q.orderCost !== undefined);
    const why = quote?.problem === "no-rate" || (!quote && quotes.some((q) => q.problem === "no-rate")) ? "an offer is in a currency the rate table lacks" : reel ? `only a full reel of ${reel.buy} is offered (${formatUsd(reel.orderCost!)}); choose it to quote it` : l.offers.length ? "the offers held state no price" : l.listing ? `no price held; listed at ${l.listing.supplier}` : "no offer held";
    return { ...base, quotes, choice, status: "unpriced", notes: [...notes, why] };
  }
  const offer = l.offers.find((o) => o.id === quote.offer)!;
  if (quote.native) notes.push(`converted from ${quote.native.currency} at ${quote.native.rate} (${opts.fx.date})`);
  if (quote.stale) notes.push(quote.ageDays !== undefined ? `price is ${quote.ageDays} days old` : "the library marks this price as stale");
  if (quote.raised) notes.push(`buys ${quote.buy} for ${needed} needed: at the price break ${quote.buy} cost ${formatUsd(quote.orderCost!)}, ${quote.raised.from} would cost ${formatUsd(quote.raised.fromCost)}`);
  else if (quote.surplus > 0) notes.push(`buys ${quote.buy} for ${needed} needed (${quote.packSize > 1 ? `pack${quote.packs === 1 ? "" : "s"} of ${quote.packSize}` : `minimum order ${quote.minOrder}`})`);
  if (quote.covers === false) notes.push(`${offer.supplier} showed ${offer.stock ?? 0} in stock`);
  if (quote.fit === "reel" || quote.fit === "reel-over") notes.push("a full reel");
  return { ...base, quotes, quote, chosen: quote.offer, choice, status: "priced", perUnitCost: round(l.quantity * quote.unitPrice), orderCost: quote.orderCost!, notes };
}

/** Price the lines for `units` built. The result holds its own input, so it can be priced again (`repriceBom`). */
export function priceBom(input: BomInput, options: BomOptions): Bom {
  const fx = options.fx ?? DEFAULT_FX;
  const units = Number.isInteger(options.units) && options.units! > 0 ? options.units! : 1;
  const choices = options.choices ?? {};
  const lines = input.lines.map((l) => priceLine(l, units, choices[l.key], { fx, now: options.now }));
  const priced = lines.filter((l) => l.status === "priced");
  const perUnit = round(priced.reduce((s, l) => s + l.perUnitCost!, 0), 2);
  const order = round(priced.reduce((s, l) => s + l.orderCost!, 0), 2);
  // the pieces left over, line by line: the totals' own difference would carry the rounding of each to cents
  const surplus = round(priced.reduce((t, l) => t + l.quote!.surplus * l.quote!.unitPrice!, 0), 2);
  const used = new Map<string, number>();
  for (const l of priced) if (l.quote!.native) used.set(l.quote!.native.currency, l.quote!.native.rate);
  const dates = priced.map((l) => l.offers.find((o) => o.id === l.chosen)?.observedAt).filter((d): d is string => !!d).sort();
  const known = new Map(input.groups.map((g, i) => [g.path, { ...g, order: i }]));
  const groups = new Map<string, BomGroup>();
  for (const l of lines) {
    const info = known.get(l.group) ?? known.get("") ?? { path: "", name: input.project, quantity: 1 };
    const g = groups.get(info.path) ?? { path: info.path, name: info.name, quantity: info.quantity, lines: [], orderCost: 0 };
    g.lines.push(l);
    g.orderCost = round(g.orderCost + (l.orderCost ?? 0), 2);
    groups.set(info.path, g);
  }
  // the system's own lines last, the modules in the system's order
  const rank = (path: string) => (path === "" ? Number.MAX_SAFE_INTEGER : (known.get(path)?.order ?? 0));
  const count = (s: BomLineStatus) => lines.filter((l) => l.status === s).length;
  const keys = new Set(lines.map((l) => l.key));
  return {
    schema: BOM_SCHEMA,
    project: input.project,
    source: input.source,
    ...(input.offersRetrievedAt ? { offersRetrievedAt: input.offersRetrievedAt } : {}),
    currency: BOM_CURRENCY,
    units,
    asOf: options.now,
    fx: { ...fx, project: options.fxFromProject === true, used: [...used].map(([currency, rate]) => ({ currency, rate })).sort((a, b) => a.currency.localeCompare(b.currency)) },
    totals: { perUnit, order, orderPerUnit: round(order / units, 2), surplus },
    counts: {
      lines: lines.length,
      buy: count("priced") + count("unpriced"),
      priced: count("priced"),
      unpriced: count("unpriced"),
      make: count("make"),
      included: count("included"),
      stale: priced.filter((l) => l.quote!.stale).length,
      converted: priced.filter((l) => l.quote!.native).length,
      pinned: lines.filter((l) => l.choice === "pinned").length,
      suppliers: new Set(priced.map((l) => l.offers.find((o) => o.id === l.chosen)!.supplier)).size,
    },
    prices: { ...(dates.length ? { oldest: dates[0], newest: dates[dates.length - 1] } : {}) },
    groups: [...groups.values()].sort((a, b) => rank(a.path) - rank(b.path)),
    unknownChoices: Object.keys(choices).filter((k) => !keys.has(k)).sort(),
  };
}

/** Every line of the bill, in the groups' order. */
export const bomLines = (bom: Bom): BomLine[] => bom.groups.flatMap((g) => g.lines);

/** The choices a bill was priced with: the lines whose offer a person chose. */
export const bomChoices = (bom: Bom): Record<string, string> => Object.fromEntries(bomLines(bom).filter((l) => l.choice === "pinned" && l.chosen).map((l) => [l.key, l.chosen!]));

/** The same bill for other units or other chosen offers (the views do this as the reader changes them). */
export function repriceBom(bom: Bom, change: { units?: number; choices?: Record<string, string> }): Bom {
  const lines: BomLineInput[] = bomLines(bom).map(({ needed: _n, status: _s, quotes: _q, quote: _u, chosen: _c, choice: _h, perUnitCost: _p, orderCost: _o, notes: _t, ...input }) => input);
  const { project, used: _used, ...fx } = bom.fx;
  return priceBom(
    { project: bom.project, source: bom.source, lines, groups: bom.groups.map(({ path, name, quantity }) => ({ path, name, quantity })), ...(bom.offersRetrievedAt ? { offersRetrievedAt: bom.offersRetrievedAt } : {}) },
    { units: change.units ?? bom.units, choices: change.choices ?? bomChoices(bom), now: bom.asOf, fx, fxFromProject: project },
  );
}

export const BOM_CSV_COLUMNS = [
  "line",
  "module",
  "item",
  "definition",
  "manufacturer",
  "mpn",
  "value",
  "kind",
  "status",
  "qty_per_unit",
  "units",
  "needed",
  "buy",
  "pack_size",
  "packs",
  "min_order",
  "supplier",
  "supplier_sku",
  "unit_price_usd",
  "per_unit_cost_usd",
  "order_cost_usd",
  "supplier_unit_price",
  "supplier_currency",
  "fx_rate",
  "fx_date",
  "stock",
  "price_observed",
  "stale",
  "offer_chosen_by",
  "supplier_url",
  "note",
] as const;

/**
 * One cell. Text that a spreadsheet would run as a formula (it starts with
 * =, +, - or @, or with a tab or return before one) gets an apostrophe in
 * front, so it is shown as text: names and notes come from library and
 * project data. Numbers are written as they are.
 */
const cell = (v: unknown) => {
  const raw = v === undefined || v === null ? "" : String(v);
  const s = typeof v === "string" && /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The bill as CSV (RFC 4180): one row per line, then nothing else; the totals are the columns' sums. An export, not the source. */
export function bomCsv(bom: Bom): string {
  const rows: unknown[][] = [];
  let n = 0;
  for (const g of bom.groups)
    for (const l of g.lines) {
      const o = l.offers.find((x) => x.id === l.chosen);
      const q = l.quote;
      rows.push([
        ++n,
        g.name,
        l.item,
        l.definition,
        l.manufacturer,
        l.mpn,
        l.value ?? "",
        l.kind,
        l.status,
        l.quantity,
        bom.units,
        l.needed,
        q?.buy ?? (l.kind === "buy" ? l.needed : ""),
        q?.packSize ?? "",
        q?.packs ?? "",
        q?.minOrder ?? "",
        o?.supplier ?? l.listing?.supplier ?? "",
        o?.sku ?? "",
        q?.unitPrice ?? "",
        l.perUnitCost ?? "",
        l.orderCost ?? "",
        q?.native?.unitPrice ?? "",
        q?.native?.currency ?? "",
        q?.native?.rate ?? "",
        q?.native ? bom.fx.date : "",
        typeof o?.stock === "number" ? o.stock : "",
        o?.observedAt ?? "",
        q ? (q.stale ? "yes" : "no") : "",
        l.status === "priced" ? (l.choice === "pinned" ? "person" : "rules") : "",
        o?.url ?? l.listing?.url ?? "",
        l.notes.join("; "),
      ]);
    }
  return [BOM_CSV_COLUMNS.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

/** What is wrong with a settings file, or nothing. */
export function bomSettingsProblems(s: unknown): string[] {
  const x = s as Partial<BomSettings> | null;
  if (!x || typeof x !== "object" || x.schema !== BOM_SETTINGS_SCHEMA) return [`not a ${BOM_SETTINGS_SCHEMA} file`];
  const out: string[] = [];
  if (x.units !== undefined && !(Number.isInteger(x.units) && x.units > 0)) out.push("units must be a whole number above 0");
  if (x.offers !== undefined && (typeof x.offers !== "object" || x.offers === null || Object.values(x.offers).some((v) => typeof v !== "string"))) out.push("offers must map a line key to an offer id");
  return out;
}

/**
 * The exchange rates the bill of materials converts with (PB-933). A dated
 * table, never a live call: a check, a build and a release give the same
 * totals offline and on every machine.
 *
 * Where the figures come from: the European Central Bank's euro foreign
 * exchange reference rates (https://www.ecb.europa.eu/stats/eurofxref/),
 * as published for `date`. They are quoted per euro; a price in currency X
 * becomes dollars as `amount / rates[X] * rates.USD`. They are reference
 * rates: what a card or a supplier charges differs by a few percent, which
 * is why every converted price is marked.
 *
 * A project that needs other rates (a newer date, a contract rate, a
 * currency the table lacks) writes `parts/fx-rates.json` in the same shape
 * (`protoboard.fx/v0`); it replaces this table for that project.
 *
 * Browser-safe: no imports.
 */
export const FX_SCHEMA = "protoboard.fx/v0";
export const FX_FILE = "parts/fx-rates.json";

export interface FxTable {
  schema: typeof FX_SCHEMA;
  /** The currency the rates are quoted against (ISO 4217): `rates[X]` is how many X one unit of it buys. */
  base: string;
  /** The day the rates are for (ISO date). */
  date: string;
  /** Who published them. */
  source: string;
  rates: Record<string, number>;
}

export const DEFAULT_FX: FxTable = {
  schema: FX_SCHEMA,
  base: "EUR",
  date: "2026-10-07",
  source: "European Central Bank euro foreign exchange reference rates",
  rates: {
    USD: 1.1177,
    JPY: 176.85,
    CZK: 24.427,
    DKK: 7.4745,
    GBP: 0.84645,
    HUF: 366.75,
    PLN: 4.3825,
    RON: 5.3528,
    SEK: 11.224,
    CHF: 0.9309,
    ISK: 137.0,
    NOK: 10.712,
    TRY: 54.9822,
    AUD: 1.6079,
    BRL: 5.5953,
    CAD: 1.5931,
    CNY: 7.4937,
    HKD: 8.7722,
    IDR: 19974.25,
    ILS: 3.429,
    INR: 108.1165,
    KRW: 1496.25,
    MXN: 20.2236,
    MYR: 4.5692,
    NZD: 1.9977,
    PHP: 70.203,
    SGD: 1.4311,
    THB: 37.661,
    ZAR: 18.6539,
  },
};

/** What is wrong with a rate table, or nothing. */
export function fxProblems(t: unknown): string[] {
  const out: string[] = [];
  const x = t as Partial<FxTable> | null;
  if (!x || typeof x !== "object" || x.schema !== FX_SCHEMA) return [`not a ${FX_SCHEMA} table`];
  if (typeof x.base !== "string" || !/^[A-Z]{3}$/.test(x.base)) out.push("base must be an ISO 4217 code");
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || Number.isNaN(Date.parse(x.date))) out.push("date must be an ISO date (YYYY-MM-DD)");
  if (typeof x.source !== "string" || !x.source.trim()) out.push("source must say who published the rates");
  if (!x.rates || typeof x.rates !== "object") out.push("rates must be an object of currency: rate");
  else for (const [k, v] of Object.entries(x.rates)) if (!/^[A-Z]{3}$/.test(k) || typeof v !== "number" || !(v > 0)) out.push(`rates.${k} must be a positive number under an ISO 4217 code`);
  return out;
}

/** How many `to` one `from` buys by the table, or nothing when it lacks either. */
export function fxRate(from: string, to: string, table: FxTable = DEFAULT_FX): number | undefined {
  if (from === to) return 1;
  const per = (c: string) => (c === table.base ? 1 : table.rates[c]);
  const a = per(from);
  const b = per(to);
  return a && b ? b / a : undefined;
}

/**
 * A part's prices by source (the owners' decision of 2026-10-07 on PB-942):
 * the offers its library serves for it, one block per supplier: the price
 * breaks, the pack and the minimum order, the stock, when the price was
 * observed, and the link to the supplier's page. Suppliers that price in US
 * dollars come first; prices are shown in the currency they were given in,
 * never converted. Only what the library's API returns is shown.
 *
 * The prices are asked for when the section is first opened. A library that
 * refuses (no sign-in, an account that is not invited) or has no price
 * service is said so, with what to do about it.
 */
import { useEffect, useState } from "react";
import { EmptyState, Icon, cx } from "@deltarobotics/uhd-viewer/components";
import type { PartPriceOffer, PartPriceSource, PartPricesModel } from "./model.js";
import { BODY, Button, Pill } from "./ui.js";

export type PricesState = { status: "loading" } | { status: "ready"; prices: PartPricesModel } | { status: "error"; error: string };

/** An amount in its own currency: at least two decimals, up to four (price breaks go below a cent). */
export function money(amount: number, currency: string | undefined): string {
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * Suppliers in the order the section lists them: a current price in US
 * dollars first, then a current price in another currency, then those with
 * only an old price (dollars first again), then those with none; the
 * library's order within each.
 */
export function usdFirst(sources: readonly PartPriceSource[]): PartPriceSource[] {
  const rank = (s: PartPriceSource) => {
    if (s.from) return s.from.currency === "USD" ? 0 : 1;
    const priced = s.offers.filter((o) => o.unitPrice !== undefined);
    return priced.some((o) => o.currency === "USD") ? 2 : priced.length ? 3 : 4;
  };
  return sources.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}

/** The day a price was observed, as written (ISO dates sort and read the same everywhere). */
const day = (iso: string) => iso.slice(0, 10);

/** The price breaks of an offer: its own list, or its one price from its minimum order. */
export function breaksOf(o: PartPriceOffer): { quantity: number; unitPrice: number }[] {
  if (o.priceBreaks?.length) return [...o.priceBreaks].sort((a, b) => a.quantity - b.quantity);
  return o.unitPrice !== undefined ? [{ quantity: o.minQuantity ?? 1, unitPrice: o.unitPrice }] : [];
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-0.5", wide && "col-span-full min-[520px]:col-span-2")}>
      <dt className="font-ui text-[10px] tracking-[0.08em] text-fg-muted uppercase">{label}</dt>
      <dd className="m-0 min-w-0 text-[12.5px] break-words text-fg">{children}</dd>
    </div>
  );
}

function Offer({ offer, supplier, onOpen }: { offer: PartPriceOffer; supplier: string; onOpen: (url: string) => void }) {
  const breaks = breaksOf(offer);
  const stock = offer.stock === undefined ? "not stated" : offer.stock === 0 ? "none shown" : offer.stock.toLocaleString("en-US");
  return (
    <div className="flex min-w-0 items-start gap-3 py-3">
      <dl className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-4 gap-y-2.5">
        <Field label="Price per piece" wide>
          {breaks.length ? (
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-ui text-[12.5px]">
              {breaks.map((b) => (
                <span key={b.quantity} className="whitespace-nowrap">
                  <span className="text-fg-muted">{b.quantity}+</span> {money(b.unitPrice, offer.currency)}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-fg-muted">no price listed</span>
          )}
        </Field>
        <Field label="Currency">{offer.currency ?? "not stated"}</Field>
        <Field label="Pack">{offer.packaging ?? "single pieces"}</Field>
        <Field label="Minimum order">{offer.minQuantity !== undefined ? `${offer.minQuantity.toLocaleString("en-US")} pc` : "not stated"}</Field>
        <Field label="Stock">
          {stock}
          {offer.leadTimeWeeks !== undefined && <span className="text-fg-muted"> · {offer.leadTimeWeeks} wk lead</span>}
        </Field>
        <Field label="Ordering code">
          <span className="font-ui text-[12px]">{offer.mpn}</span>
          {offer.sku && <span className="block font-ui text-[11px] text-fg-muted">{supplier} {offer.sku}</span>}
        </Field>
        <Field label="Observed">
          <span className="font-ui text-[12px]">{day(offer.observedAt)}</span>
          {offer.stale && (
            <span className="ml-1.5 inline-flex align-middle">
              <Pill tone="warning" title="Too old, or the product is discontinued, to quote as a current price: history, not a quote">
                old price
              </Pill>
            </span>
          )}
        </Field>
      </dl>
      {offer.url && /^https?:\/\//.test(offer.url) && (
        <Button icon="external-link" aria-label={`Open ${supplier}'s page for ${offer.mpn}`} data-tooltip={`Open at ${supplier}`} className="w-8 !px-0" onClick={() => onOpen(offer.url!)} />
      )}
    </div>
  );
}

function Source({ source, onOpen }: { source: PartPriceSource; onOpen: (url: string) => void }) {
  const market = source.offers.find((o) => o.market)?.market;
  // within a supplier too, US dollars first
  const offers = source.offers.map((o, i) => ({ o, i })).sort((a, b) => Number(a.o.currency !== "USD") - Number(b.o.currency !== "USD") || a.i - b.i).map((x) => x.o);
  return (
    <section aria-label={source.supplier} className="rounded-[4px] bg-[var(--pb-card)] px-3 outline-1 -outline-offset-1 outline-contrast">
      <header className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line-subtle py-2.5">
        <Icon name="store" size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-fg">{source.supplier}</h3>
        {source.authorized && <Pill tone="ok" title="A franchised distributor, or the manufacturer's own store">authorized</Pill>}
        {market && <Pill title="The storefront or market the price is from">{market}</Pill>}
        <span className="ml-auto flex shrink-0 items-baseline gap-2">
          {source.from ? (
            <span className="font-ui text-[13px] text-fg">
              <span className="text-[11px] text-fg-muted">from </span>
              {money(source.from.unitPrice, source.from.currency)}
            </span>
          ) : (
            <span className="text-[12px] text-fg-muted">{source.offers.some((o) => o.unitPrice !== undefined) ? "old price only" : "no price listed"}</span>
          )}
        </span>
      </header>
      <div className="divide-y divide-line-subtle">
        {offers.map((o, i) => (
          <Offer key={`${o.mpn}-${o.sku ?? ""}-${i}`} offer={o} supplier={source.supplier} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

const SIGNED_OUT = new Set(["AUTH_REQUIRED", "FORBIDDEN"]);

/** Why there are no prices, and what to do. */
function Unavailable({ why, onSignIn }: { why: NonNullable<PartPricesModel["unavailable"]>; onSignIn?: () => void }) {
  const signedOut = SIGNED_OUT.has(why.code);
  const title = signedOut ? "Sign in to see prices" : why.code === "ACCOUNT_NOT_ALLOWED" ? "This account cannot see prices yet" : why.code === "NO_PRICES" ? "This library has no prices" : "The prices did not load";
  const what = why.code === "NO_PRICES" ? "This part's library has no prices." : why.message;
  return (
    <div className="py-6">
      <EmptyState icon={<Icon name={signedOut ? "log-in" : why.code === "ACCOUNT_NOT_ALLOWED" ? "user-x" : "circle-dollar-sign"} size={24} strokeWidth={1.25} />} title={title}>
        <span className="block max-w-[64ch]">{what}</span>
        {signedOut && onSignIn && (
          <span className="mt-3 block">
            <Button kind="primary" icon="log-in" onClick={onSignIn}>
              Sign in
            </Button>
          </span>
        )}
      </EmptyState>
    </div>
  );
}

export interface PricesPanelProps {
  /** The prices, once asked for. */
  state: PricesState | undefined;
  /** Ask for them (the section opened, or "Try again"). */
  onLoad(): void;
  onOpenLink(url: string): void;
  onSignIn?: () => void;
}

export function PricesPanel({ state, onLoad, onOpenLink, onSignIn }: PricesPanelProps) {
  useEffect(() => {
    if (!state) onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!state || state.status === "loading")
    return (
      <div role="status" aria-label="Loading the prices" className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div key={i} aria-hidden className="h-[92px] animate-pulse rounded-[4px] bg-[var(--pb-card)] outline-1 -outline-offset-1 outline-contrast motion-reduce:animate-none" />
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <div className="py-6">
        <EmptyState icon={<Icon name="triangle-alert" size={24} strokeWidth={1.25} />} title="The prices did not load">
          <span className="block max-w-[64ch]">{state.error}</span>
          <span className="mt-3 block">
            <Button icon="refresh-cw" onClick={onLoad}>
              Try again
            </Button>
          </span>
        </EmptyState>
      </div>
    );
  const p = state.prices;
  if (p.unavailable) return <Unavailable why={p.unavailable} {...(onSignIn ? { onSignIn } : {})} />;
  if (!p.sources.length)
    return (
      <div className="py-6">
        <EmptyState icon={<Icon name="circle-dollar-sign" size={24} strokeWidth={1.25} />} title="No prices for this part">
          The library holds no supplier offers for it yet.
        </EmptyState>
      </div>
    );
  const sources = usdFirst(p.sources);
  return (
    <div className={cx(BODY, "flex flex-col gap-3")}>
      {sources.map((s) => (
        <Source key={s.supplier} source={s} onOpen={onOpenLink} />
      ))}
      <p className="flex items-start gap-1.5 text-[12px] leading-snug text-fg-muted">
        <Icon name="info" size={13} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
        <span>
          {sources.length} supplier{sources.length === 1 ? "" : "s"}. Each price is per piece, in the currency the supplier lists it in (none is converted), as of the day shown. Check the supplier's page before ordering.
        </span>
      </p>
    </div>
  );
}

/** The prices of the part shown: asked for once per part and revision, kept while the detail is open. */
export function usePrices(key: string, load: (() => Promise<PartPricesModel>) | undefined): { state: PricesState | undefined; load(): void } {
  const [held, setHeld] = useState<{ key: string; state: PricesState }>();
  const state = held?.key === key ? held.state : undefined;
  return {
    state,
    load: () => {
      if (!load) return;
      setHeld({ key, state: { status: "loading" } });
      load().then(
        (prices) => setHeld((h) => (h?.key === key ? { key, state: { status: "ready", prices } } : h)),
        (e: unknown) => setHeld((h) => (h?.key === key ? { key, state: { status: "error", error: e instanceof Error ? e.message : String(e) } } : h)),
      );
    },
  };
}

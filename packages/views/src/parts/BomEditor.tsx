/**
 * The bill of materials, in its own tab (PB-904, PB-933; docs/specs/bom.md).
 * Styled after the Alpha's: summary cards over a table with labelled
 * columns, a supplier chip per line that opens the offers held, a stock
 * badge, the pack arithmetic in the open (what is bought against what is
 * needed, with a warning where pieces are left over), the order cost in the
 * accent colour, and a totals row.
 *
 * The model is core's structured bill (`@protoboardai/core/bom`); the view
 * re-prices it itself when the reader changes the units to build or a
 * line's offer, and tells the host so the project keeps the choice. One
 * currency, dollars: a converted price carries its supplier's currency and
 * the rate in a tooltip. How the library came by a price is not shown; the
 * view shows the library's results.
 *
 * Narrow (a side panel, a small window): the table becomes a list of lines,
 * each on three short rows, so nothing is cut off and nothing scrolls
 * sideways.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bomChoices, formatUnitUsd, formatUsd, repriceBom, type Bom, type BomGroup, type BomLine, type BomOffer, type BomQuote } from "@protoboardai/core/bom";
import { EmptyState, Icon, IconButton, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { Select } from "../ui/Select.js";
import type { BomActions } from "./model.js";
import { PartsSurface } from "./Surface.js";
import { BODY, Card, RowAction, StatusText, type Tone } from "./ui.js";

/** "$12.40": every amount of a bill is in dollars. */
export const formatMoney = (amount: number, _currency = "USD") => formatUsd(amount);

/** "Oct 3": the day a price was observed. */
export function shortDay(iso: string | undefined): string | undefined {
  if (!iso || Number.isNaN(Date.parse(iso))) return undefined;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "read Oct 3 · fresh", or how old the newest price is. */
export function offersAge(asOf: string | undefined, now = new Date()): { date: string; fresh: string } | undefined {
  const date = shortDay(asOf);
  if (!date) return undefined;
  const days = Math.floor((now.getTime() - new Date(asOf!).getTime()) / 86400000);
  return { date, fresh: days <= 14 ? "fresh" : `${days} d old` };
}

type GroupBy = "module" | "supplier" | "none";
const GROUP_ICON: Record<GroupBy, string> = { module: "boxes", supplier: "store", none: "list" };
const GROUP_NOW: Record<GroupBy, string> = { module: "Grouped by module", supplier: "Grouped by supplier", none: "Not grouped" };
const GROUP_NEXT: Record<GroupBy, string> = { module: "by supplier", supplier: "not at all", none: "by module" };

const supplierOf = (l: BomLine) => l.offers.find((o) => o.id === l.chosen)?.supplier;

function regroup(bom: Bom, by: GroupBy): BomGroup[] {
  if (by === "module") return bom.groups;
  const lines = bom.groups.flatMap((g) => g.lines);
  const sum = (list: BomLine[]) => Math.round(list.reduce((s, l) => s + (l.orderCost ?? 0), 0) * 100) / 100;
  if (by === "none") return [{ path: "", name: "All lines", quantity: 1, lines, orderCost: sum(lines) }];
  const map = new Map<string, BomLine[]>();
  for (const l of lines) {
    const k = supplierOf(l) ?? (l.status === "make" ? "Made for this product" : l.status === "included" ? "Included with other parts" : "No price yet");
    map.set(k, [...(map.get(k) ?? []), l]);
  }
  return [...map].map(([name, list]) => ({ path: name, name, quantity: 1, lines: list, orderCost: sum(list) }));
}

const STATUS: Record<Exclude<BomLine["status"], "priced">, { tone: Tone; label: string }> = {
  unpriced: { tone: "warning", label: "Unpriced" },
  make: { tone: "info", label: "Needs quote" },
  included: { tone: "neutral", label: "Included" },
};

/** The Alpha's stock badge: in stock, limited (some, not enough for the order), out, or not stated. */
function stockOf(o: BomOffer | undefined, q: BomQuote | undefined): { tone: Tone; label: string; tip: string } | undefined {
  if (!o || !q) return undefined;
  if (typeof o.stock !== "number") return { tone: "neutral", label: "Not stated", tip: `${o.supplier} did not state its stock` };
  const tip = `${o.supplier} showed ${o.stock.toLocaleString("en-US")} in stock${shortDay(o.observedAt) ? ` on ${shortDay(o.observedAt)}` : ""}`;
  if (o.stock <= 0) return { tone: "error", label: "Out of stock", tip };
  if (o.stock < q.buy) return { tone: "warning", label: "Limited", tip: `${tip}; the order is ${q.buy}` };
  return { tone: "ok", label: "In stock", tip };
}

function StockBadge({ line }: { line: BomLine }) {
  const s = stockOf(line.offers.find((o) => o.id === line.chosen), line.quote);
  if (!s) return <span className="text-fg-muted">—</span>;
  return (
    <span data-tooltip={s.tip} className="inline-flex h-[20px] max-w-full items-center gap-1.5 rounded-[5px] bg-muted px-1.5 text-[11.5px] whitespace-nowrap text-fg-muted outline-1 -outline-offset-1 outline-contrast">
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", s.tone === "ok" ? "bg-ok" : s.tone === "warning" ? "bg-warning" : s.tone === "error" ? "bg-error" : "bg-fg-muted")} />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

/** One offer in the supplier list: who, what the order of this line costs there, and what to know. */
function offerLabel(o: BomOffer, q: BomQuote): ReactNode {
  const marks = [q.native ? `from ${q.native.currency}` : "", q.packSize > 1 ? `pack of ${q.packSize}` : q.minOrder > 1 ? `min ${q.minOrder}` : "", q.stale ? "stale" : "", q.fit === "reel" || q.fit === "reel-over" ? "full reel" : "", o.stock === 0 ? "out of stock" : ""].filter(Boolean);
  return (
    <span className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 truncate">{o.supplier}</span>
      <span className="ml-auto shrink-0 text-fg-muted">{q.unitPrice !== undefined ? `${formatUnitUsd(q.unitPrice)} × ${q.buy} = ${formatUsd(q.orderCost!)}` : q.problem === "no-rate" ? `no rate for ${o.currency}` : "no price"}</span>
      {marks.length > 0 && <span className="shrink-0 text-[11px] text-fg-muted">{marks.join(" · ")}</span>}
    </span>
  );
}

const AUTO = "\u0000auto";
const CHIP = "inline-flex h-[22px] max-w-full min-w-0 items-center gap-1 rounded-[5px] border border-[var(--pb-control-border)] px-1.5 text-[11.5px] text-fg";

/** The supplier chip: the supplier used, and the offers held to choose from. */
function SupplierChip({ line, onChoose }: { line: BomLine; onChoose?: (offer: string | null) => void }) {
  const o = line.offers.find((x) => x.id === line.chosen);
  if (line.kind !== "buy") return <span className="text-fg-muted">—</span>;
  if (!line.offers.length)
    return line.listing ? (
      <span className={cx(CHIP, "border-dashed text-fg-muted")} data-tooltip={`No price held. The part's model cites a listing at ${line.listing.supplier}.`}>
        <span className="truncate">{line.listing.supplier}</span>
      </span>
    ) : (
      <span className="text-[11.5px] text-fg-muted" data-tooltip="No offer yet. Use Refresh offers.">
        No offers
      </span>
    );
  const name = o?.supplier ?? (line.quotes.some((q) => q.unitPrice !== undefined) ? "Choose an offer" : "No price held");
  const pinned = line.choice === "pinned";
  const body = (
    <>
      {pinned && <Icon name="pin" size={11} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />}
      <span className="truncate">{name}</span>
    </>
  );
  if (!onChoose || (line.offers.length === 1 && !pinned && o)) return <span className={CHIP} data-tooltip={`${name}: the only offer held`}>{body}</span>;
  const options = [
    ...(pinned ? [{ value: AUTO, label: <span className="text-fg-muted">Best offer by the rules</span>, text: name }] : []),
    ...line.quotes.map((q) => ({ value: q.offer, label: offerLabel(line.offers.find((x) => x.id === q.offer)!, q), text: line.offers.find((x) => x.id === q.offer)!.supplier })),
  ];
  return (
    <Select
      value={line.chosen ?? ""}
      options={options}
      onChange={(v) => onChoose(v === AUTO ? null : v)}
      label={`Supplier for ${line.item}`}
      tooltip={pinned ? `${name}: chosen for this line. ${line.offers.length} offer${line.offers.length === 1 ? "" : "s"} held` : `${name}: the best of ${line.offers.length} offers held. Choose another`}
      className={cx(CHIP, "hover:bg-hover")}
      trigger={
        <>
          {body}
          <Icon name="chevron-down" size={12} className="shrink-0 text-fg-muted" aria-hidden />
        </>
      }
    />
  );
}

/** The unit price, with what a reader should know beside it: converted, stale. */
function UnitPrice({ line, bom }: { line: BomLine; bom: Bom }) {
  const q = line.quote;
  if (!q || q.unitPrice === undefined) return <span className="text-fg-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span>{formatUnitUsd(q.unitPrice)}</span>
      {q.native && (
        <span
          data-tooltip={`Converted from ${q.native.unitPrice} ${q.native.currency} at ${q.native.rate}: ${bom.fx.source}, ${bom.fx.date}`}
          aria-label={`converted from ${q.native.currency}`}
          className="inline-flex h-[15px] items-center rounded-[3px] bg-muted px-1 font-ui text-[9.5px] leading-none text-fg-muted outline-1 -outline-offset-1 outline-contrast"
        >
          {q.native.currency}
        </span>
      )}
      {q.stale && (
        <span data-tooltip={q.ageDays !== undefined ? `${q.ageDays} days old. Use Refresh offers.` : "The library marks this price as stale."} aria-label="stale price" className="inline-flex text-warning">
          <Icon name="clock-alert" size={13} aria-hidden />
        </span>
      )}
    </span>
  );
}

/** What is bought against what is needed; a warning where pieces are left over. */
function Buy({ line }: { line: BomLine }) {
  const q = line.quote;
  if (!q) return <span className="text-fg-muted">{line.kind === "buy" ? line.needed : "—"}</span>;
  const why = q.raised
    ? `at the price break ${q.buy} cost ${formatUsd(q.orderCost!)}, ${q.raised.from} would cost ${formatUsd(q.raised.fromCost)}`
    : q.packSize > 1
      ? `${q.packs} pack${q.packs === 1 ? "" : "s"} of ${q.packSize}`
      : `minimum order ${q.minOrder}`;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span>{q.buy}</span>
      {q.surplus > 0 && (
        <span data-tooltip={`Buys ${q.buy} for ${line.needed} needed (${why}): ${q.surplus} left over, ${formatUsd(q.surplus * q.unitPrice!)} of this line`} aria-label={`${q.surplus} left over`} className="inline-flex text-warning">
          <Icon name="triangle-alert" size={13} aria-hidden />
        </span>
      )}
    </span>
  );
}

const COLS = "grid grid-cols-[minmax(190px,2.6fr)_minmax(120px,1.25fr)_100px_64px_64px_92px_84px_92px_76px] items-center gap-x-3";
const HEAD = "font-ui text-[10.5px] tracking-[0.1em] text-fg-muted uppercase";
const NUM_BASE = "justify-self-end text-right font-ui text-[12px]";
const NUM = `${NUM_BASE} text-fg`;

function PartName({ line, actions }: { line: BomLine; actions: BomActions }) {
  const sub = [line.mpn, line.value].filter(Boolean).join(" · ") || line.definition;
  const open = actions.openPart ? () => actions.openPart!(line) : undefined;
  return (
    <span className="flex min-w-0 items-start gap-2">
      <Icon name={line.kind === "make" ? "hammer" : line.kind === "included" ? "package-check" : "package"} size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-fg-muted" aria-hidden />
      <span className="flex min-w-0 flex-col">
        {open ? (
          <button type="button" onClick={open} data-tooltip={`Open ${line.item}`} className="min-w-0 cursor-pointer truncate text-left text-[13px] text-fg hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus">
            {line.item}
          </button>
        ) : (
          <span className="truncate text-[13px] text-fg">{line.item}</span>
        )}
        <span className="truncate font-ui text-[11px] text-fg-muted">{sub}</span>
      </span>
    </span>
  );
}

function Actions({ line, actions }: { line: BomLine; actions: BomActions }) {
  const o = line.offers.find((x) => x.id === line.chosen);
  const url = o?.url ?? (line.status === "unpriced" ? line.listing?.url : undefined);
  const where = o?.supplier ?? line.listing?.supplier;
  return (
    <span className="flex shrink-0 items-center justify-end">
      {url && actions.openLink && <RowAction icon="external-link" label={`Open at ${where}`} onClick={() => actions.openLink!(url)} />}
      {actions.focus && line.instances.length > 0 && <RowAction icon="crosshair" label={`Show in the viewer (${line.instances.length} place${line.instances.length === 1 ? "" : "s"})`} onClick={() => actions.focus!(line)} />}
      {actions.openRow && line.source && <RowAction icon="file-text" label={`Open ${line.source.file}`} onClick={() => actions.openRow!(line)} />}
    </span>
  );
}

function Quantity({ line, units }: { line: BomLine; units: number }) {
  return (
    <span className="whitespace-nowrap" data-tooltip={units > 1 ? `${line.quantity} per unit × ${units} units = ${line.needed} needed` : `${line.quantity} per unit`}>
      {line.needed}
    </span>
  );
}

function StatusNote({ line }: { line: BomLine }) {
  if (line.status === "priced") return null;
  const s = STATUS[line.status];
  return (
    <span data-tooltip={line.notes.join(". ") || undefined} className="inline-flex min-w-0">
      <StatusText tone={s.tone}>{s.label}</StatusText>
    </span>
  );
}

function TableRow({ line, bom, actions, onChoose }: { line: BomLine; bom: Bom; actions: BomActions; onChoose?: (offer: string | null) => void }) {
  return (
    <div role="row" data-line={line.key} className={cx(COLS, "min-h-[44px] border-t border-line-subtle px-3 py-1.5 hover:bg-hover")}>
      <span role="cell" className="min-w-0">
        <PartName line={line} actions={actions} />
      </span>
      <span role="cell" className="min-w-0">
        {line.status === "priced" || line.kind === "buy" ? <SupplierChip line={line} {...(onChoose ? { onChoose } : {})} /> : <StatusNote line={line} />}
      </span>
      <span role="cell" className="min-w-0">
        {line.status === "priced" ? <StockBadge line={line} /> : line.kind === "buy" ? <StatusNote line={line} /> : <span className="text-fg-muted">—</span>}
      </span>
      <span role="cell" className={NUM}>
        <Quantity line={line} units={bom.units} />
      </span>
      <span role="cell" className={NUM}>
        <Buy line={line} />
      </span>
      <span role="cell" className={NUM}>
        <UnitPrice line={line} bom={bom} />
      </span>
      <span role="cell" className={NUM}>
        {line.perUnitCost !== undefined ? formatUsd(line.perUnitCost) : <span className="text-fg-muted">—</span>}
      </span>
      <span role="cell" className={cx(NUM_BASE, "font-medium text-accent")}>
        {line.orderCost !== undefined ? formatUsd(line.orderCost) : <span className="font-normal text-fg-muted">—</span>}
      </span>
      <span role="cell">
        <Actions line={line} actions={actions} />
      </span>
    </div>
  );
}

function ListRow({ line, bom, actions, onChoose }: { line: BomLine; bom: Bom; actions: BomActions; onChoose?: (offer: string | null) => void }) {
  return (
    <div data-line={line.key} className="flex flex-col gap-1.5 border-t border-line-subtle px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <PartName line={line} actions={actions} />
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-ui text-[12.5px] font-medium text-accent">{line.orderCost !== undefined ? formatUsd(line.orderCost) : <StatusNote line={line} />}</span>
          {line.perUnitCost !== undefined && <span className="font-ui text-[11px] text-fg-muted">{formatUsd(line.perUnitCost)} / unit</span>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px]">
        {line.kind === "buy" && (
          <span className="min-w-0 max-w-full">
            <SupplierChip line={line} {...(onChoose ? { onChoose } : {})} />
          </span>
        )}
        {line.status === "priced" && <StockBadge line={line} />}
        <span className="inline-flex items-center gap-1 font-ui text-[11.5px] text-fg-muted">
          need <Quantity line={line} units={bom.units} />
          {line.quote && (
            <>
              · buy <Buy line={line} /> · <UnitPrice line={line} bom={bom} />
            </>
          )}
        </span>
        <span className="ml-auto">
          <Actions line={line} actions={actions} />
        </span>
      </div>
    </div>
  );
}

function GroupHead({ g, open, onToggle, icon }: { g: BomGroup; open: boolean; onToggle: () => void; icon: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-8 w-full cursor-pointer items-center gap-2 border-t border-line-subtle bg-[var(--pb-row-head)] px-3 text-left hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus">
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <Icon name={icon} size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 truncate text-[13px] font-semibold text-fg">
        {g.name}
        {g.quantity > 1 && ` ×${g.quantity}`}
      </span>
      <span className="shrink-0 text-[12px] text-fg-muted">
        {g.lines.length} line{g.lines.length === 1 ? "" : "s"}
      </span>
      {g.orderCost > 0 && <span className="ml-auto shrink-0 font-ui text-[12px] text-fg">{formatUsd(g.orderCost)}</span>}
    </button>
  );
}

/** An Alpha summary card: a label with its icon, the figure, what it is made of. */
function Summary({ label, icon, value, accent, children }: { label: string; icon: string; value: ReactNode; accent?: boolean; children?: ReactNode }) {
  return (
    <Card className={cx(BODY, "flex min-w-0 flex-col gap-1.5 px-3.5 py-3")}>
      <span className="flex items-center justify-between gap-2 text-fg-muted">
        <span className={cx(HEAD, "truncate")}>{label}</span>
        <Icon name={icon} size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
      </span>
      <span className={cx("truncate font-ui text-[20px] leading-tight font-semibold", accent ? "text-accent" : "text-fg")}>{value}</span>
      {children && <div className="flex flex-col gap-0.5 text-[11.5px] leading-snug text-fg-muted">{children}</div>}
    </Card>
  );
}

function Facts({ items }: { items: [string, ReactNode, Tone?][] }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([k, v, tone]) => (
        <span key={k} className="flex flex-col">
          <span>{k}</span>
          <span className={cx("font-ui text-[12px] font-semibold", tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : tone === "ok" ? "text-ok" : "text-fg")}>{v}</span>
        </span>
      ))}
    </span>
  );
}

/** Units to build: a number with its steppers. */
function Units({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 1_000_000) {
      if (n !== value) onChange(n);
      setText(String(n));
    } else setText(String(value));
  };
  return (
    <span className="inline-flex h-7 items-center gap-0.5 rounded-[5px] border border-line bg-sunken pl-2 outline-1 -outline-offset-1 outline-contrast focus-within:border-focus" data-tooltip="Units to build: quantities and the order are worked out for this many">
      <span className={cx(HEAD, "pr-1")}>Units</span>
      <input
        aria-label="Units to build"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "ArrowUp") (e.preventDefault(), onChange(value + 1));
          if (e.key === "ArrowDown" && value > 1) (e.preventDefault(), onChange(value - 1));
        }}
        className="h-full w-[5ch] min-w-0 border-0 bg-transparent p-0 text-right font-ui text-[12.5px] text-fg outline-none"
      />
      <IconButton icon="minus" label="One unit fewer" tooltipSide="bottom" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} />
      <IconButton icon="plus" label="One unit more" tooltipSide="bottom" onClick={() => onChange(value + 1)} />
    </span>
  );
}

/** How long after the reader's last change a model from the host is taken to be an echo of it. */
const SETTLE_MS = 2500;
const sameChoices = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

export function BomEditor({ model, actions, title = "Bill of materials" }: { model: Bom; actions: BomActions; title?: string }) {
  const [by, setBy] = useState<GroupBy>("module");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // the reader's own units and offers, over the model the host last gave
  const [local, setLocal] = useState<{ units?: number; choices?: Record<string, string> }>({});
  // The host keeps each change and sends the model again a moment later. While the reader is still clicking, a
  // model that arrives is one of an earlier click: what was changed here stays until the model says the same (or
  // nothing was changed for a while, so the model is news from elsewhere: the CLI, another window).
  const edited = useRef(0);
  useEffect(() => {
    setLocal((s) => {
      if (Date.now() - edited.current > SETTLE_MS) return {};
      const next = { ...s };
      if (next.units === model.units) delete next.units;
      if (next.choices && sameChoices(next.choices, bomChoices(model))) delete next.choices;
      return next;
    });
  }, [model]);
  const bom = useMemo(() => (local.units === undefined && !local.choices ? model : repriceBom(model, local)), [model, local]);
  const groups = useMemo(() => regroup(bom, by), [bom, by]);
  const lines = useMemo(() => bom.groups.flatMap((g) => g.lines), [bom]);

  const setUnits = (n: number) => {
    edited.current = Date.now();
    setLocal((s) => ({ ...s, units: n }));
    actions.setUnits?.(n);
  };
  const choose = (line: BomLine) => (offer: string | null) => {
    const choices = { ...(local.choices ?? bomChoices(bom)) };
    if (offer === null) delete choices[line.key];
    else choices[line.key] = offer;
    edited.current = Date.now();
    setLocal((s) => ({ ...s, choices }));
    actions.chooseOffer?.(line.key, offer);
  };
  const toggle = (k: string) => setClosed((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const cycle = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length];

  const src = bom.source.kind === "design" ? "from the design" : bom.source.kind === "release" ? `release ${bom.source.version}` : bom.source.file.split("/").pop()!;
  const pieces = lines.filter((l) => l.kind !== "included").reduce((s, l) => s + l.quantity, 0);
  const inStock = lines.filter((l) => l.status === "priced" && stockOf(l.offers.find((o) => o.id === l.chosen), l.quote)?.tone === "ok").length;
  const observed = shortDay(bom.prices.newest);
  const groupIcon = by === "supplier" ? "store" : "boxes";
  const empty = !lines.length;

  return (
    <PartsSurface place="editor">
      <div className="@container size-full">
        <ScrollArea className="size-full" axis="vertical" contentClassName="flex min-w-[260px] flex-col gap-4 px-6 pt-5 pb-8 @max-[640px]:px-3">
          <header className={cx(BODY, "flex flex-wrap items-center gap-x-3 gap-y-2")}>
            <h1 className="text-[19px] font-semibold text-fg">{title}</h1>
            <span className="min-w-0 truncate font-ui text-[12px] text-fg-muted">{src}</span>
            {/* a toolbar: icon buttons that name themselves and what they do in a tooltip */}
            <span className="ml-auto flex flex-wrap items-center gap-1" role="toolbar" aria-label="Bill of materials">
              <Units value={bom.units} onChange={setUnits} />
              <IconButton icon={GROUP_ICON[by]} label={`${GROUP_NOW[by]}: click to group ${GROUP_NEXT[by]}`} tooltipSide="bottom" onClick={() => setBy(cycle<GroupBy>(["module", "supplier", "none"], by))} />
              {actions.refreshOffers && <IconButton icon="refresh-cw" label="Refresh offers: ask the library for its current prices" tooltipSide="bottom" onClick={actions.refreshOffers} />}
              {actions.exportCsv && <IconButton icon="download" label="Export CSV" tooltipSide="bottom" disabled={empty} onClick={() => actions.exportCsv!(bom)} />}
            </span>
          </header>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">
            <Summary label="Parts" icon="box" value={`${pieces} per unit`}>
              <Facts
                items={[
                  ["Lines", bom.counts.lines],
                  ["Suppliers", bom.counts.suppliers],
                  ["In stock", `${inStock} / ${bom.counts.priced}`],
                  ["Made", bom.counts.make ? `${bom.counts.make} · quote` : 0, bom.counts.make ? "info" : undefined],
                ]}
              />
            </Summary>
            <Summary label="Prices" icon="tags" value={`${bom.counts.priced} / ${bom.counts.buy} priced`}>
              <Facts
                items={[
                  ["Unpriced", bom.counts.unpriced, bom.counts.unpriced ? "warning" : undefined],
                  ["Stale", bom.counts.stale, bom.counts.stale ? "warning" : undefined],
                  ["Converted", bom.counts.converted],
                ]}
              />
              <span>
                {observed ? `Observed ${shortDay(bom.prices.oldest) !== observed ? `${shortDay(bom.prices.oldest)} to ` : ""}${observed}.` : "No prices held yet: Refresh offers asks the library."}
                {bom.fx.used.length > 0 && (
                  <span data-tooltip={`${bom.fx.source}${bom.fx.project ? " (parts/fx-rates.json)" : ""}, ${bom.fx.date}: ${bom.fx.used.map((u) => `1 ${u.currency} = ${u.rate} USD`).join(", ")}`}> Rates of {bom.fx.date}.</span>
                )}
              </span>
            </Summary>
            <Summary label="Per unit" icon="cuboid" value={bom.counts.priced ? formatUsd(bom.totals.perUnit) : "—"}>
              <span>The parts one unit uses, at the prices paid{bom.units > 1 ? ` when ordering for ${bom.units}` : ""}.</span>
            </Summary>
            <Summary label={`Order · ${bom.units} unit${bom.units === 1 ? "" : "s"}`} icon="shopping-cart" accent value={bom.counts.priced ? formatUsd(bom.totals.order) : "—"}>
              {bom.counts.priced > 0 && (
                <span>
                  {bom.totals.surplus > 0 ? `${formatUsd(bom.totals.surplus)} of it buys pieces left over (packs and minimum orders).` : "Nothing is left over."}
                  {bom.units > 1 && ` ${formatUsd(bom.totals.orderPerUnit)} per unit.`}
                </span>
              )}
              <span>Tax and shipping are not included.{bom.counts.unpriced + bom.counts.make > 0 ? ` ${bom.counts.unpriced + bom.counts.make} line${bom.counts.unpriced + bom.counts.make === 1 ? " is" : "s are"} not in it.` : ""}</span>
            </Summary>
          </div>

          {empty ? (
            <EmptyState icon={<Icon name="sheet" size={26} strokeWidth={1.25} />} title="No lines">
              The system has no bought or made parts yet.
            </EmptyState>
          ) : (
            <Card className={cx(BODY, "overflow-hidden")}>
              {/* wide: a table */}
              <div role="table" aria-label={title} className="@max-[1080px]:hidden">
                <div role="row" className={cx(COLS, HEAD, "h-9 px-3")}>
                  <span role="columnheader">Part</span>
                  <span role="columnheader">Supplier</span>
                  <span role="columnheader">Stock</span>
                  <span role="columnheader" className="justify-self-end" data-tooltip={`Pieces needed for ${bom.units} unit${bom.units === 1 ? "" : "s"}`}>
                    Need
                  </span>
                  <span role="columnheader" className="justify-self-end" data-tooltip="Pieces to buy: the need, in whole packs and at least the minimum order">
                    Buy
                  </span>
                  <span role="columnheader" className="justify-self-end" data-tooltip="Price per piece, in dollars, at the quantity bought">
                    Unit
                  </span>
                  <span role="columnheader" className="justify-self-end" data-tooltip="What the pieces one unit uses cost">
                    Per unit
                  </span>
                  <span role="columnheader" className="justify-self-end" data-tooltip="What ordering this line costs: pieces bought × unit price">
                    Order
                  </span>
                  <span />
                </div>
                {groups.map((g) => (
                  <Fragment key={g.path || "system"}>
                    {by !== "none" && <GroupHead g={g} icon={groupIcon} open={!closed.has(g.path)} onToggle={() => toggle(g.path)} />}
                    {!closed.has(g.path) && g.lines.map((l) => <TableRow key={l.key} line={l} bom={bom} actions={actions} onChoose={choose(l)} />)}
                  </Fragment>
                ))}
              </div>
              {/* narrow: a list */}
              <div className="hidden @max-[1080px]:block">
                {groups.map((g) => (
                  <Fragment key={g.path || "system"}>
                    {by !== "none" && <GroupHead g={g} icon={groupIcon} open={!closed.has(g.path)} onToggle={() => toggle(g.path)} />}
                    {!closed.has(g.path) && g.lines.map((l) => <ListRow key={l.key} line={l} bom={bom} actions={actions} onChoose={choose(l)} />)}
                  </Fragment>
                ))}
              </div>
              <div className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 border-t border-line bg-[var(--pb-row-head)] px-3 py-2 font-ui text-[12px]">
                <span className="text-fg-muted">
                  Per unit <span className="text-fg">{bom.counts.priced ? formatUsd(bom.totals.perUnit) : "—"}</span>
                </span>
                <span className="text-fg-muted">
                  Order for {bom.units} <span className="font-semibold text-accent">{bom.counts.priced ? formatUsd(bom.totals.order) : "—"}</span>
                </span>
              </div>
            </Card>
          )}
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

/**
 * A card's carousels (PB-918, designs 06 and 07): the picture carousel on
 * top (dots always, arrows and the "2 / 4" index on hover or focus) and the
 * pages of the text carousel under the title: overview, specs, dimensions,
 * interfaces, CAD and artifacts, each drawn to fit a fixed box so the card
 * never changes size. A list shows a still of the CAD, never the model.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Icon, cx } from "@deltarobotics/uhd-viewer/components";
import { StepButton, useSwipe, type PagesState } from "./carousel.js";
import type { CardPageId, PartCardModel, PartFact, PartImage, PartOutline, PartPages } from "./model.js";
import { BODY, Tag, Thumb } from "./ui.js";

// ---------------------------------------------------------------- pictures

export interface ImageCarouselProps {
  images: PartImage[];
  /** The part's name, for the pictures' accessible names. */
  alt: string;
  index: number;
  onIndex(index: number): void;
  className?: string;
  /** The placeholder icon when the part has no picture. */
  icon?: string;
  iconSize?: number;
  /** The arrows' size (24 on a tile, 18 on a row, 36 in the detail). */
  arrow?: number;
  /** Arrows and dots take part in the tab order (the detail); on a card the card's own keys turn the pictures. */
  tabbable?: boolean;
  /** Over the picture, above the carousel's own controls (the state pill, the expand button). */
  children?: ReactNode;
}

/** A part's pictures, one at a time. With one picture there is nothing to turn: no dots, no arrows. */
export function ImageCarousel({ images, alt, index, onIndex, className, icon, iconSize, arrow = 24, tabbable, children }: ImageCarouselProps) {
  const n = images.length;
  const i = n ? Math.min(Math.max(index, 0), n - 1) : 0;
  const step = (d: number) => n > 1 && onIndex((i + d + n) % n);
  const swipe = useSwipe(step);
  const tab = tabbable ? 0 : -1;
  const round = cx(
    "pb-reveal absolute top-1/2 z-[1] -translate-y-1/2 !rounded-full bg-[color-mix(in_oklab,black_64%,transparent)] !text-white hover:bg-[color-mix(in_oklab,black_82%,transparent)]",
    "outline-1 outline-contrast",
  );
  return (
    <div role={n > 1 ? "group" : undefined} aria-roledescription={n > 1 ? "carousel" : undefined} aria-label={n > 1 ? `Pictures of ${alt}` : undefined} className={cx("relative shrink-0 touch-pan-y overflow-hidden", className)} {...(n > 1 ? swipe : {})}>
      <Thumb src={images[i]?.url} alt={n > 1 ? `${alt}: ${images[i].label} (${i + 1} of ${n})` : alt} className="size-full" icon={icon} {...(iconSize ? { iconSize } : {})} />
      {n > 1 && (
        <>
          <span aria-hidden className="pb-reveal absolute top-2 left-2 z-[1] rounded-full bg-[color-mix(in_oklab,black_64%,transparent)] px-1.5 py-0.5 font-ui text-[10px] leading-none text-white tabular-nums outline-1 outline-contrast">
            {i + 1} / {n}
          </span>
          <StepButton dir="prev" label="Previous picture" onClick={() => step(-1)} size={arrow} tabIndex={tab} className={cx(round, arrow > 20 ? "left-2" : "left-1")} />
          <StepButton dir="next" label="Next picture" onClick={() => step(1)} size={arrow} tabIndex={tab} className={cx(round, arrow > 20 ? "right-2" : "right-1")} />
          <span className="absolute inset-x-0 bottom-1.5 z-[1] flex justify-center">
            <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,black_48%,transparent)] px-1.5 py-1 outline-1 outline-contrast">
              {images.map((img, k) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={tab}
                  aria-label={`Picture ${k + 1} of ${n}: ${img.label}`}
                  aria-current={k === i || undefined}
                  data-tooltip={img.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onIndex(k);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className={cx("h-[5px] cursor-pointer rounded-full transition-[width] motion-reduce:transition-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white", k === i ? "w-3 bg-white" : "w-[5px] bg-white/55 hover:bg-white/80")}
                />
              ))}
            </span>
          </span>
        </>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- the pages of a card

/** Label and value on one line: the label gives way first, the value keeps to the right in the mono face. */
function Row({ fact, tall }: { fact: PartFact; tall?: boolean }) {
  return (
    <div className={cx("flex min-w-0 items-baseline justify-between gap-2", tall ? "h-[17px]" : "h-[15px]")} title={`${fact.label}: ${fact.value}`}>
      <span className="min-w-0 shrink truncate text-fg-muted">{fact.label}</span>
      <span className="max-w-[62%] shrink-0 truncate font-ui text-[11px] text-fg">{fact.value}</span>
    </div>
  );
}

/**
 * The part's outline with its two measures, drawn to scale: a board from
 * above (length by width), a round part from the side (diameter by height).
 */
export function OutlineDrawing({ outline, width, height, className }: { outline: PartOutline; width: number; height: number; className?: string }) {
  const round = outline.diameter !== undefined && (outline.length === undefined || outline.length === outline.width);
  const a = round ? outline.diameter! : (outline.length ?? outline.width ?? outline.height ?? 1);
  const b = round ? (outline.height ?? outline.diameter!) : (outline.width ?? outline.height ?? a);
  // room for the two labels: below (the first measure) and to the right (the second)
  const pad = { right: Math.max(26, width * 0.34), bottom: 12 };
  const boxW = width - pad.right - 2;
  const boxH = height - pad.bottom - 2;
  const k = Math.min(boxW / a, boxH / b);
  const w = Math.max(6, a * k);
  const h = Math.max(6, b * k);
  const x = 1 + (boxW - w) / 2;
  const y = 1 + (boxH - h) / 2;
  const n = (v: number) => String(Math.round(v * 10) / 10);
  const font = Math.max(7.5, Math.min(10, width / 8));
  return (
    <svg role="img" aria-label={`Outline: ${round ? `diameter ${n(a)}` : n(a)} by ${n(b)} mm`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cx("shrink-0 text-fg-muted", className)}>
      <rect x={x} y={y} width={w} height={h} rx={round ? 1.5 : 2} fill="none" stroke="currentColor" strokeWidth={1.25} className="text-fg" />
      <line x1={x} y1={y + h + 4} x2={x + w} y2={y + h + 4} stroke="currentColor" strokeWidth={0.75} />
      <line x1={x + w + 4} y1={y} x2={x + w + 4} y2={y + h} stroke="currentColor" strokeWidth={0.75} />
      <text x={x + w / 2} y={height - 1} textAnchor="middle" fontSize={font} fill="currentColor" className="font-ui">
        {round ? `Ø${n(a)}` : n(a)}
      </text>
      <text x={x + w + 7} y={y + h / 2 + font / 3} fontSize={font} fill="currentColor" className="font-ui">
        {n(b)}
      </text>
    </svg>
  );
}

/** The rows beside a card's outline: the height the drawing does not show, then the rest (the size is the drawing). */
export function dimensionRows(d: NonNullable<PartPages["dimensions"]>): PartFact[] {
  if (!d.outline) return d.rows;
  const round = d.outline.diameter !== undefined && (d.outline.length === undefined || d.outline.length === d.outline.width);
  const rest = d.rows.filter((r) => r.label !== "Size" && !(round && /^(diameter|overall height)$/i.test(r.label)));
  return [...(!round && d.outline.height !== undefined ? [{ label: "Height", value: `${d.outline.height} mm` }] : []), ...rest];
}

/** As many chips as fit a budget of characters, and how many are left. */
export function fitChips(chips: string[], budget: number): { shown: string[]; more: number } {
  const shown: string[] = [];
  let used = 0;
  for (const c of chips) {
    const cost = c.length + 3;
    if (shown.length && used + cost > budget) break;
    shown.push(c);
    used += cost;
  }
  return { shown, more: chips.length - shown.length };
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex h-full flex-col justify-start gap-[7px] pt-1">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden className="h-[9px] animate-pulse rounded-[2px] bg-muted motion-reduce:animate-none" style={{ width: `${[92, 70, 84, 58][i % 4]}%` }} />
      ))}
    </div>
  );
}

export interface CardPageProps {
  page: CardPageId;
  item: PartCardModel;
  state: PagesState;
  /** `tile`: four lines (68 px); `row`: three (46 px). */
  variant: "tile" | "row";
  /** Before the overview's first line (the Project Parts page: the part's status dot). */
  status?: ReactNode;
  onRetry(): void;
  /** -1 or 1: the side the page came in from. */
  from?: number;
}

/** One page of a card's text carousel, in its fixed box. */
export function CardPage({ page, item, state, variant, status, onRetry, from = 1 }: CardPageProps) {
  const tile = variant === "tile";
  const lines = tile ? 4 : 3;
  const box = cx(BODY, "pb-page-in min-w-0 overflow-hidden text-[11.5px] leading-[1.3]", tile ? "h-[68px]" : "h-[46px]");
  const style = { "--pb-page-from": `${from * 6}px` } as React.CSSProperties;
  if (page === "overview") {
    const who = [item.manufacturer, item.mpn && item.mpn !== item.name ? item.mpn : undefined].filter(Boolean).join(" · ");
    const first = tile ? [who, item.category?.split(" · ").pop()].filter(Boolean).join(" · ") : item.category;
    return (
      <div key="overview" className={box} style={style}>
        {(first || status) && (
          <div className="flex h-[15px] min-w-0 items-center gap-1.5 text-fg-muted">
            {status}
            {first && (
              <span className="flex min-w-0 items-center gap-1">
                {!tile && <Icon name="tag" size={11} strokeWidth={1.75} className="shrink-0" aria-hidden />}
                <span className="truncate">{first}</span>
              </span>
            )}
          </div>
        )}
        {item.description && <p className={cx("line-clamp-2 text-fg", tile ? "text-[12px]" : "text-[11.5px]")}>{item.description}</p>}
        {tile && item.tags.length > 0 && (
          <div className="mt-1 flex h-[18px] gap-1 overflow-hidden">
            {item.tags.slice(0, 4).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (state.status === "error")
    return (
      <div key="error" role="status" className={cx(box, "flex flex-col items-start gap-1 text-fg-muted")}>
        <span className="line-clamp-2">The library did not give this part's details: {state.error}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className="cursor-pointer rounded-[3px] text-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus"
        >
          Try again
        </button>
      </div>
    );
  if (state.status !== "ready")
    return (
      <div key="loading" className={box}>
        <Skeleton lines={lines} />
      </div>
    );
  const p = state.pages;
  switch (page) {
    case "specs":
      return (
        <div key={page} className={box} style={style}>
          {p.specs.slice(0, lines).map((f) => (
            <Row key={f.label} fact={f} tall={tile} />
          ))}
        </div>
      );
    case "dimensions": {
      const d = p.dimensions!;
      const rows = dimensionRows(d).slice(0, d.outline ? 3 : lines);
      return (
        <div key={page} className={cx(box, "flex items-center gap-2.5")} style={style}>
          {d.outline && <OutlineDrawing outline={d.outline} width={tile ? 78 : 62} height={tile ? 62 : 44} />}
          <div className="min-w-0 flex-1">
            {rows.map((f) => (
              <Row key={f.label} fact={f} tall={tile} />
            ))}
          </div>
        </div>
      );
    }
    case "interfaces": {
      const { shown, more } = fitChips(p.interfaces.chips, tile ? 74 : 44);
      return (
        <div key={page} className={cx(box, "flex flex-wrap content-start gap-1")} style={style} aria-label={`${p.interfaces.count} interfaces`}>
          {shown.map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
          {more > 0 && (
            <span data-tooltip={p.interfaces.chips.slice(shown.length).join(", ")}>
              <Tag>+{more}</Tag>
            </span>
          )}
        </div>
      );
    }
    case "cad": {
      const c = p.cad!;
      const texts = [c.file, c.origin, c.features ? `${c.features} mate feature${c.features === 1 ? "" : "s"}` : undefined].filter((x): x is string => !!x);
      return (
        <div key={page} className={cx(box, "flex items-center gap-2.5")} style={style}>
          <div className={cx("relative shrink-0 overflow-hidden rounded-[3px] outline-1 -outline-offset-1 outline-contrast", tile ? "h-[60px] w-[84px]" : "h-[44px] w-[60px]")}>
            <Thumb src={c.preview} alt="" className="size-full" icon="box" iconSize={20} />
            <Icon name="rotate-3d" size={12} strokeWidth={1.75} className="absolute right-1 bottom-1 text-[var(--pb-thumb-fg)]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            {texts.slice(0, tile ? 3 : 2).map((t, i) => (
              <div key={t} className={cx("h-[15px] truncate", i === 0 ? "font-ui text-[11px] text-fg" : "text-fg-muted")}>
                {t}
              </div>
            ))}
            <div className="h-[15px] truncate text-fg-faint">{c.mesh ? "Open the part to orbit" : "No 3D mesh"}</div>
          </div>
        </div>
      );
    }
    case "artifacts": {
      const over = p.artifacts.length > lines;
      const rows = over ? p.artifacts.slice(0, lines - 1) : p.artifacts;
      return (
        <div key={page} className={box} style={style}>
          {rows.map((g) => (
            <div key={g.kind} className={cx("flex min-w-0 items-center gap-1.5", tile ? "h-[17px]" : "h-[15px]")} title={`${g.label}: ${g.items.map((x) => x.name).join(", ")}`}>
              <Icon name={g.icon} size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-fg">{g.summary}</span>
              <span className="shrink-0 font-ui text-[10px] text-fg-muted">{g.note}</span>
            </div>
          ))}
          {over && (
            <div className={cx("flex items-center gap-1.5 text-fg-muted", tile ? "h-[17px]" : "h-[15px]")}>
              <Icon name="ellipsis" size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="truncate">{p.artifacts.length - rows.length} more kinds</span>
            </div>
          )}
        </div>
      );
    }
  }
}

/** Says a page change to a screen reader, once, when the reader made it. */
export function Announce({ text }: { text: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current && text) ref.current.textContent = text;
  }, [text]);
  return <span ref={ref} aria-live="polite" className="sr-only" />;
}

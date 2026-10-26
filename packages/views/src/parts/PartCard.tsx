/**
 * A part as a card (PB-902), with its carousels (PB-918, designs 06 and 07):
 * the pictures on top (or at the left of a row), the title, which never
 * changes, and under it a text carousel that turns through the part's pages
 * (overview, specs, dimensions, interfaces, CAD, artifacts) in a box of
 * fixed size, so a card is the same size on every page. The actions are
 * icons (Add part, Preview, Compare, more), with the project's state as a
 * pill. `row` is the sidebar's and the list's; `tile` is the full page's grid.
 *
 * A card with focus turns its pages with ← and →, its pictures with Shift
 * and the same keys; Enter opens the part. The pages' data is fetched when
 * the reader first rests on the card or turns it (carousel.tsx).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, cx } from "@deltarobotics/uhd-viewer/components";
import { Announce, CardPage, ImageCarousel } from "./CardPages.js";
import { Pager, Segments, stepIn, usePagerStore, usePartPages, useSwipe } from "./carousel.js";
import type { CardPageId, PartCardModel, PartDetailTab, PartImage } from "./model.js";
import { PAGE_ICON, PAGE_LABEL, availablePages } from "./part-pages.js";
import { rev } from "./revision.js";
import { BODY, Pill, RowAction, Tag } from "./ui.js";

export interface PartCardProps {
  item: PartCardModel;
  variant?: "row" | "tile";
  selected?: boolean;
  /** No project: Add is offered but disabled. */
  noProject?: boolean;
  onOpen(key: string, tab?: PartDetailTab): void;
  onAdd(key: string): void;
  onUpdate(key: string): void;
  onMore?(key: string): void;
  /** The card's state pill, in place of the library's "used" and "update" pills (the Project Parts page: the sync status). */
  pill?: ReactNode;
  /** The card's action icons, in place of the library's (Add, Preview, Compare). */
  actions?: ReactNode;
  /** Shown before the category line (the Project Parts page: the part's status dot). */
  status?: ReactNode;
  /** The picture's placeholder icon when the part has none. */
  icon?: string;
}

/** The project's state of a part, as a pill; an update's pill updates the part. */
export function UsePill({ item, solid, onUpdate, disabled }: { item: Pick<PartCardModel, "key" | "used" | "update" | "busy" | "deprecated">; solid?: boolean; onUpdate?: (key: string) => void; disabled?: boolean }) {
  if (item.busy) return <Pill tone="neutral" solid={false}>{item.busy}…</Pill>;
  if (item.update !== undefined) {
    const pill = (
      <Pill tone="info" solid={solid} icon="download" title={`The project pins ${rev(item.used?.revision)}; ${rev(item.update)} is recommended`}>
        update {rev(item.update)}
      </Pill>
    );
    if (!onUpdate) return pill;
    return (
      <button
        type="button"
        aria-label={`Update part to ${rev(item.update)}`}
        data-tooltip={`Update part to ${rev(item.update)}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onUpdate(item.key);
        }}
        className="cursor-pointer rounded-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus disabled:cursor-default"
      >
        {pill}
      </button>
    );
  }
  if (item.used)
    return (
      <Pill tone="ok" solid={solid} title={item.used.elsewhere ? "The project has this id from another library" : "In this project"}>
        {item.used.elsewhere ? "used · other library" : `used ${rev(item.used.revision)}`}
      </Pill>
    );
  if (item.deprecated) return <Pill tone="warning">deprecated</Pill>;
  return null;
}

function Actions({ item, noProject, onOpen, onAdd, onMore }: Omit<PartCardProps, "variant" | "selected">) {
  const inProject = !!item.used && !item.used.elsewhere;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <RowAction icon="plus" label={inProject ? "In this project" : noProject ? "Add part (open a Protoboard project first)" : "Add part"} disabled={noProject || inProject || !!item.busy} onClick={() => onAdd(item.key)} />
      <RowAction icon="eye" label="Preview part" onClick={() => onOpen(item.key)} />
      <RowAction icon="git-compare-arrows" label="Compare revisions" onClick={() => onOpen(item.key, "revisions")} />
      {onMore && <RowAction icon="ellipsis" label="More actions" onClick={() => onMore(item.key)} />}
    </div>
  );
}

const CATALOG_PICTURE = "Catalog picture";

/**
 * A card's carousels: where it is (kept by the list's store), the pages it
 * has, and its pictures. The pages are asked for once the card is turned,
 * or the reader rests on it (so the first turn does not wait).
 */
function useCard(item: PartCardModel) {
  const store = usePagerStore();
  const asked = store.page(item.key);
  const [rested, setRested] = useState(false);
  const { state, available, retry } = usePartPages(item.pages, asked !== "overview" || rested);
  const pages = state.status === "ready" ? state.pages : undefined;
  const list: CardPageId[] = available ? availablePages(pages) : ["overview"];
  // the way the reader last turned, so a page the part turns out not to have is passed over in that direction
  const dir = useRef(1);
  const [said, setSaid] = useState<string>();
  useEffect(() => {
    if (!pages || list.includes(asked) || store.isLinked) return;
    const all = availablePages(undefined);
    let next = asked;
    for (let i = 0; i < all.length && !list.includes(next); i++) next = stepIn(all, next, dir.current);
    store.setPage(item.key, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, asked]);
  // while the cards turn together, a part without that page keeps to its overview
  const page: CardPageId = list.includes(asked) ? asked : "overview";
  const step = (delta: number) => {
    if (list.length < 2) return;
    dir.current = delta;
    const next = stepIn(list, page, delta);
    store.setPage(item.key, next);
    setSaid(`${PAGE_LABEL[next]}, page ${list.indexOf(next) + 1} of ${list.length}`);
  };
  const images: PartImage[] = pages?.images.length ? pages.images : item.thumbnail ? [{ url: item.thumbnail, label: CATALOG_PICTURE }] : [];
  const image = Math.min(store.image(item.key), Math.max(images.length - 1, 0));
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  return {
    page,
    list,
    state,
    retry,
    step,
    said,
    dir: dir.current,
    images,
    image,
    setImage: (i: number) => store.setImage(item.key, i),
    stepImage: (d: number) => images.length > 1 && store.setImage(item.key, (image + d + images.length) % images.length),
    /** The reader rests on the card (pointer or focus): its pages are fetched ahead of the first turn. */
    hover: {
      onPointerEnter: () => {
        if (!rested && available) rest.current = setTimeout(() => setRested(true), 350);
      },
      onPointerLeave: () => clearTimeout(rest.current),
      onFocus: () => available && setRested(true),
    },
  };
}

type Card = ReturnType<typeof useCard>;

/** The page's name and the pager: "ⓘ OVERVIEW  ‹ 1/6 ›". */
function PageHeader({ card, className }: { card: Card; className?: string }) {
  const n = card.list.length;
  return (
    <div className={cx("flex h-4 min-w-0 items-center gap-1.5", className)}>
      <Icon name={PAGE_ICON[card.page]} size={11} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-ui text-[10px] leading-none tracking-[0.08em] text-fg-muted uppercase">{PAGE_LABEL[card.page]}</span>
      {/* the card's own keys turn the pages, so the arrows stay out of the tab order: one stop per card, then its actions */}
      {n > 1 && <Pager index={card.list.indexOf(card.page)} count={n} what="page" onStep={card.step} tabIndex={-1} />}
    </div>
  );
}

/** Enter opens the part; the arrows turn the pages, with Shift the pictures. Only when the card itself has the focus. */
const cardKeys = (open: () => void, card: Card) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    open();
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 1 : -1;
    if (e.shiftKey) card.stepImage(d);
    else card.step(d);
  }
};

/** A card's height before it is drawn (the list's window keeps offscreen cards as boxes of this size). */
export const CARD_HEIGHT = { tile: 300, row: 132 } as const;

export function PartCard(props: PartCardProps) {
  const { item, variant = "row", selected, onOpen } = props;
  const title = item.summary ? `${item.name} · ${item.summary}` : item.name;
  const open = () => onOpen(item.key);
  const card = useCard(item);
  const swipe = useSwipe(card.step);
  const turns = card.list.length > 1;
  const label = `${title}${turns ? `. ${PAGE_LABEL[card.page]}, page ${card.list.indexOf(card.page) + 1} of ${card.list.length}` : ""}`;
  const pageBox = <CardPage page={card.page} item={item} state={card.state} variant={variant} status={props.status} onRetry={card.retry} from={card.dir} />;
  if (variant === "tile")
    return (
      <article
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-keyshortcuts={turns ? "ArrowLeft ArrowRight" : undefined}
        data-page={card.page}
        onClick={open}
        onKeyDown={cardKeys(open, card)}
        {...card.hover}
        className={cx(
          BODY,
          "pb-reveal-host group relative flex h-[300px] min-w-0 cursor-pointer flex-col overflow-hidden rounded-[6px] border bg-[var(--pb-card)] text-left transition-colors",
          selected ? "border-focus" : "border-line hover:border-[var(--pb-control-border)]",
          "outline-1 -outline-offset-1 outline-contrast hover:outline-dashed hover:outline-contrast-active focus-visible:outline-solid focus-visible:outline-focus",
        )}
      >
        <ImageCarousel images={card.images} alt={item.name} index={card.image} onIndex={card.setImage} className="h-[146px] w-full" iconSize={40} icon={props.icon}>
          <div className="absolute top-2 right-2 z-[1]">{props.pill ?? <UsePill item={item} solid onUpdate={props.onUpdate} disabled={props.noProject} />}</div>
        </ImageCarousel>
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-2.5 pb-2">
          <h3 className="h-[19px] shrink-0 truncate text-[13.5px] leading-[19px] font-semibold text-fg" title={title}>
            {item.name}
          </h3>
          <PageHeader card={card} className="mt-1" />
          <div className="mt-1.5 touch-pan-y" {...(turns ? swipe : {})}>
            {pageBox}
          </div>
          <div className="mt-auto flex items-center gap-2">
            <Segments index={card.list.indexOf(card.page)} count={card.list.length} />
            <span className="ml-auto flex shrink-0">{props.actions ?? <Actions {...props} />}</span>
          </div>
        </div>
        <Announce text={card.said} />
      </article>
    );
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-keyshortcuts={turns ? "ArrowLeft ArrowRight" : undefined}
      aria-current={selected || undefined}
      data-page={card.page}
      onClick={open}
      onKeyDown={cardKeys(open, card)}
      {...card.hover}
      className={cx(
        BODY,
        "pb-reveal-host flex min-h-[132px] min-w-0 cursor-pointer overflow-hidden rounded-[4px] border bg-[var(--pb-card)] text-left transition-colors",
        selected ? "border-focus" : "border-line hover:border-[var(--pb-control-border)]",
        "outline-1 -outline-offset-1 outline-contrast hover:outline-dashed hover:outline-contrast-active focus-visible:outline-solid focus-visible:outline-focus",
      )}
    >
      <ImageCarousel images={card.images} alt={item.name} index={card.image} onIndex={card.setImage} className="w-[88px] self-stretch max-[300px]:w-[64px]" icon={props.icon} arrow={18} />
      <div className="flex min-w-0 flex-1 flex-col px-2.5 pt-2 pb-1">
        <h3 className="line-clamp-2 text-[12.5px] leading-[1.25] font-semibold text-fg" title={title}>
          {title}
        </h3>
        <PageHeader card={card} className="mt-1" />
        <div className="mt-1 touch-pan-y" {...(turns ? swipe : {})}>
          {pageBox}
        </div>
        {/* the pill never shrinks away (an update is an action): when it and the icons do not fit, the icons wrap below */}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 pt-0.5">
          <span className="flex shrink-0 empty:hidden">{props.pill ?? <UsePill item={item} onUpdate={props.onUpdate} disabled={props.noProject} />}</span>
          {!props.pill && !item.used && !item.update && item.tags.length > 0 && (
            <span className="flex min-w-0 flex-1 basis-0 items-center gap-1 overflow-hidden">
              {item.tags.slice(0, 2).map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </span>
          )}
          <span className="ml-auto flex shrink-0">{props.actions ?? <Actions {...props} />}</span>
        </div>
      </div>
      <Announce text={card.said} />
    </article>
  );
}

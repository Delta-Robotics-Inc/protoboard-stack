/**
 * The Library sidebar (PB-902, design 01; PB-934): search, the category
 * breadcrumb, the categories as a list that drills in and out (it folds away
 * to leave the parts the room), the count and the order, and the part cards.
 * Opening a card shows the part's detail in an editor tab (the host's).
 */
import { useEffect, useRef, useState } from "react";
import { EmptyState, Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { CategoryList } from "./CategoryList.js";
import { SORT_LABEL } from "./library-data.js";
import type { LibraryActions, LibraryModel, LibrarySort, LibrarySortModel } from "./model.js";
import { CARD_HEIGHT, PartCard } from "./PartCard.js";
import { LinkPagesToggle, PagerProvider, PagesProvider, useNewPagerStore } from "./carousel.js";
import { Windowed } from "./Windowed.js";
import { PartsSurface } from "./Surface.js";
import { BODY, Button, SearchField, categoryIcon } from "./ui.js";
import { Select } from "../ui/Select.js";

/** "All › Sensors › Environmental": each crumb goes back to that level. */
export function Crumbs({ crumbs, onPick, className }: { crumbs: LibraryModel["crumbs"]; onPick: (path: string) => void; className?: string }) {
  const list = crumbs.length ? crumbs : [{ path: "", name: "All" }];
  return (
    <nav aria-label="Category" className={cx(BODY, "flex min-w-0 items-center gap-1 text-[12.5px]", className)}>
      <Icon name={list.length > 1 ? categoryIcon(list[list.length - 1].path) : "network"} size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
      {list.map((c, i) => {
        const last = i === list.length - 1;
        return (
          <span key={c.path || "all"} className="flex min-w-0 items-center gap-1">
            {i > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-fg-faint" aria-hidden />}
            <button
              type="button"
              aria-current={last ? "location" : undefined}
              onClick={() => onPick(c.path)}
              className={cx("cursor-pointer truncate rounded-[3px] px-0.5 hover:underline", last ? "font-semibold text-fg" : "text-fg-muted hover:text-fg")}
            >
              {i === 0 ? "All" : c.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/**
 * The order of the results. It offers only the orders that work (`sort.options`,
 * library-data.ts `sortState`), and says when an order was made here over the
 * parts loaded so far instead of by the library.
 */
export function SortMenu({ sort, onSort, compact }: { sort: LibrarySortModel; onSort: (s: LibrarySort) => void; compact?: boolean }) {
  const tip = sort.local ? `Ordered by ${SORT_LABEL[sort.value].toLowerCase()} (loaded parts only)` : `Ordered by ${SORT_LABEL[sort.value].toLowerCase()}`;
  return (
    <Select
      label="Order of the results"
      tooltip={tip}
      value={sort.value}
      onChange={(v) => onSort(v as LibrarySort)}
      options={sort.options.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
      className={cx(
        BODY,
        "relative inline-flex shrink-0 items-center gap-1 text-fg-muted hover:text-fg",
        compact ? "h-6 text-[12px]" : "h-8 rounded-[4px] border border-[var(--pb-control-border)] px-3 text-[13px] text-fg hover:bg-hover",
      )}
      trigger={
        <>
          <Icon name="arrow-down-up" size={compact ? 12 : 14} strokeWidth={1.75} aria-hidden />
          <span>{SORT_LABEL[sort.value]}</span>
          {compact && <Icon name="chevron-down" size={12} aria-hidden />}
        </>
      }
    />
  );
}

/** Asks for the next page when the end of the list comes into view. */
export function LoadMore({ model, onMore }: { model: Pick<LibraryModel, "more" | "loadingMore">; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !model.more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && onMore(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [model.more, onMore]);
  if (!model.more) return null;
  return (
    <div ref={ref} className="flex justify-center py-2">
      <Button size="sm" kind="ghost" icon={model.loadingMore ? "loader" : "chevrons-down"} disabled={model.loadingMore} onClick={onMore}>
        {model.loadingMore ? "Loading…" : "More parts"}
      </Button>
    </div>
  );
}

export function LibraryProblems({ model, onRetry }: { model: Pick<LibraryModel, "error" | "setupError" | "libraries">; onRetry?: () => void }) {
  const failed = model.libraries.filter((l) => l.error);
  const message = model.setupError ?? model.error;
  if (!message && !failed.length) return null;
  return (
    <div role="status" className={cx(BODY, "flex items-start gap-2 rounded-[4px] border border-line px-2.5 py-2 text-[12px] text-fg-muted")}>
      <Icon name="triangle-alert" size={14} className="mt-px shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        {message && <p className="text-fg">{message}</p>}
        {failed.map((l) => (
          <p key={l.id}>
            {l.name ?? l.id}: {l.error}
          </p>
        ))}
      </div>
      {onRetry && <Button size="sm" kind="ghost" icon="refresh-cw" onClick={onRetry} aria-label="Try again" />}
    </div>
  );
}

export interface LibraryBrowserProps {
  model: LibraryModel;
  actions: LibraryActions;
  /** The part whose detail is open (its card is outlined). */
  selected?: string;
}

export function LibraryBrowser({ model, actions, selected }: LibraryBrowserProps) {
  // the category list folds away: the breadcrumb stays, and says where the list is
  const [open, setOpen] = useState(true);
  const pager = useNewPagerStore();
  const asked = model.libraries.length;
  const pick = (category: string) => actions.query({ category });
  return (
    <PartsSurface place="sidebar">
      <div className="flex size-full min-w-[220px] flex-col">
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-2">
          <SearchField value={model.query.text} placeholder="Search parts" onChange={(text) => actions.query({ text })} />
          <div className="flex min-w-0 items-center gap-1">
            <Crumbs crumbs={model.crumbs} onPick={pick} className="flex-1" />
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? "Hide the categories" : "Show the categories"}
              data-tooltip={open ? "Hide the categories" : "Show the categories"}
              onClick={() => setOpen(!open)}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
            >
              <Icon name={open ? "chevrons-down-up" : "chevrons-up-down"} size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {/* the list scrolls inside its own area: the parts below keep most of the side bar */}
          {open && <CategoryList model={model} onPick={pick} scroll className="max-h-[min(264px,38vh)] border-y border-line-subtle py-1" />}
          <div className={cx(BODY, "flex items-center gap-2 text-[11.5px] text-fg-muted")}>
            <span className="min-w-0 flex-1 truncate">
              {model.loading ? "Searching…" : `${model.total} part${model.total === 1 ? "" : "s"}`}
              {asked > 1 && ` · ${asked} libraries`}
            </span>
            {actions.pages && <LinkPagesToggle store={pager} compact />}
            <SortMenu sort={model.sort} onSort={(sort) => actions.query({ sort })} compact />
          </div>
          <LibraryProblems model={model} onRetry={actions.retry} />
        </div>
        <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col gap-2 px-3 pb-3">
          <PagesProvider loader={actions.pages}>
            <PagerProvider store={pager}>
              {model.items.map((it, i) => (
                <Windowed key={it.key} height={CARD_HEIGHT.row} eager={i < 10}>
                  <PartCard item={it} selected={it.key === selected} noProject={model.noProject} onOpen={actions.open} onAdd={actions.add} onUpdate={actions.update} onMore={actions.more} />
                </Windowed>
              ))}
            </PagerProvider>
          </PagesProvider>
          {!model.items.length && !model.loading && !model.setupError && (
            <div className="py-8">
              <EmptyState icon={<Icon name="search-x" size={24} strokeWidth={1.25} />} title="No parts match">
                {model.query.text || model.query.category ? "Try other words, or a broader category." : "The libraries list no parts."}
              </EmptyState>
            </div>
          )}
          {model.loading && !model.items.length && <Skeleton />}
          <LoadMore model={model} onMore={actions.loadMore} />
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="h-[132px] animate-pulse rounded-[4px] border border-line bg-[var(--pb-card)]" />
      ))}
    </>
  );
}

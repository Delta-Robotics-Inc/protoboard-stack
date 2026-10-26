/**
 * The full-page library (PB-902, design 02; PB-934): a McMaster-style grid
 * with larger pictures and more per part. On the left the categories as a
 * list that drills in and out (with counts), the libraries searched and the
 * "show only" filters; on the right the search, the order and grid/list
 * switch, the category's breadcrumb and heading, then the cards. Narrow: the
 * left column folds away behind a button.
 */
import { useEffect, useMemo, useState } from "react";
import { EmptyState, Icon, IconButton, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { CategoryList } from "./CategoryList.js";
import { Crumbs, LibraryProblems, LoadMore, SortMenu } from "./LibraryBrowser.js";
import type { LibraryActions, LibraryModel, PartCardModel } from "./model.js";
import { CARD_HEIGHT, PartCard } from "./PartCard.js";
import { LinkPagesToggle, PagerProvider, PagesProvider, useNewPagerStore } from "./carousel.js";
import { Windowed } from "./Windowed.js";
import { PartsSurface } from "./Surface.js";
import { BODY, SearchField, SectionLabel, categoryIcon } from "./ui.js";

type ShowOnly = "model" | "audited" | "project";
const SHOW_ONLY: { id: ShowOnly; label: string; icon: string; test: (x: PartCardModel) => boolean | undefined; known: (x: PartCardModel) => boolean }[] = [
  { id: "model", label: "Has 3D model", icon: "box", test: (x) => x.hasModel, known: (x) => x.hasModel !== undefined },
  { id: "audited", label: "Independently audited", icon: "shield-check", test: (x) => x.audited, known: (x) => x.audited !== undefined },
  { id: "project", label: "In this project", icon: "folder", test: (x) => !!x.used && !x.used.elsewhere, known: () => true },
];

export interface LibraryPageProps {
  model: LibraryModel;
  actions: LibraryActions;
  selected?: string;
}

function Check({ checked, label, onChange, disabled, title, icon }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean; title?: string; icon?: string }) {
  return (
    <label title={title} className={cx(BODY, "flex h-6 cursor-pointer items-center gap-2 rounded-[3px] px-1 text-[12.5px] text-fg hover:bg-hover", disabled && "cursor-default opacity-50 hover:bg-transparent")}>
      {icon ? (
        <Icon name={icon} size={14} strokeWidth={1.75} className={checked ? "text-accent" : "text-fg-muted"} aria-hidden />
      ) : (
        <span aria-hidden className={cx("grid size-3.5 shrink-0 place-items-center rounded-[3px] border", checked ? "border-accent bg-accent text-on-accent" : "border-[var(--pb-control-border)]")}>
          {checked && <Icon name="check" size={11} strokeWidth={3} />}
        </span>
      )}
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx("truncate", icon && checked && "font-medium")}>{label}</span>
    </label>
  );
}

export function LibraryPage({ model, actions, selected }: LibraryPageProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState<Set<ShowOnly>>(new Set());
  const [rail, setRail] = useState(false);
  const pager = useNewPagerStore();
  const current = model.crumbs[model.crumbs.length - 1];
  const heading = model.crumbs.length > 1 ? current.name : "All parts";
  const items = useMemo(() => {
    let list = model.items.filter((x) => !hidden.has(x.library));
    for (const o of only) list = list.filter((x) => SHOW_ONLY.find((s) => s.id === o)!.test(x));
    return list;
  }, [model.items, hidden, only]);
  // the catalog's size: the unfiltered search's total, remembered while a category or text narrows it (summing the categories counts a part once per category)
  const [seenTotal, setSeenTotal] = useState<number>();
  useEffect(() => {
    if (model.catalogTotal !== undefined) setSeenTotal(model.catalogTotal);
  }, [model.catalogTotal]);
  const catalogSize = model.catalogTotal ?? seenTotal ?? 0;
  const pick = (category: string) => actions.query({ category });
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  const side = (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-4">
      <section>
        <SectionLabel>Categories</SectionLabel>
        <CategoryList model={catalogSize ? { ...model, catalogTotal: catalogSize } : model} onPick={pick} className="mt-1" />
      </section>
      {model.libraries.length > 0 && (
        <section>
          <SectionLabel>Libraries</SectionLabel>
          <div className="mt-1 flex flex-col">
            {model.libraries.map((l) => (
              <Check key={l.id} checked={!hidden.has(l.id)} label={l.name ?? l.id} title={l.error ? `${l.id}: ${l.error}` : l.total !== undefined ? `${l.total} matching` : undefined} onChange={(on) => setHidden(toggle(hidden, l.id, !on))} />
            ))}
          </div>
        </section>
      )}
      <section>
        <SectionLabel>Show only</SectionLabel>
        <div className="mt-1 flex flex-col">
          {SHOW_ONLY.map((s) => {
            const known = model.items.some(s.known);
            return (
              <Check
                key={s.id}
                icon={s.icon}
                checked={only.has(s.id)}
                disabled={!known}
                title={known ? undefined : "The libraries do not say this yet"}
                label={s.label}
                onChange={(on) => setOnly(toggle(only, s.id, on))}
              />
            );
          })}
        </div>
      </section>
    </div>
  );

  return (
    <PartsSurface place="editor">
      <div className="flex size-full min-w-[360px]">
        <aside aria-label="Filters" className={cx("w-[260px] shrink-0 border-r border-line-subtle bg-[var(--pb-bg)] max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-20 max-[760px]:shadow-float", !rail && "max-[760px]:hidden")}>
          <ScrollArea className="size-full">{side}</ScrollArea>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 px-6 pt-5 max-[760px]:px-4">
            <span className="min-[761px]:hidden">
              <IconButton icon="sliders-horizontal" label="Categories and filters" pressed={rail} onClick={() => setRail(!rail)} />
            </span>
            <SearchField className="min-w-0 flex-1" value={model.query.text} placeholder={`Search ${catalogSize ? `${catalogSize} ` : ""}parts by name, MPN or what it does…`} onChange={(text) => actions.query({ text })} />
            <SortMenu sort={model.sort} onSort={(sort) => actions.query({ sort })} />
            {actions.pages && <LinkPagesToggle store={pager} />}
            <span className="flex items-center gap-1">
              <IconButton icon="layout-grid" label="Grid" pressed={layout === "grid"} onClick={() => setLayout("grid")} />
              <IconButton icon="list" label="List" pressed={layout === "list"} onClick={() => setLayout("list")} />
            </span>
          </div>
          {model.crumbs.length > 1 && <Crumbs crumbs={model.crumbs} onPick={pick} className="shrink-0 px-6 pt-4 max-[760px]:px-4" />}
          <div className={cx(BODY, "flex shrink-0 items-baseline gap-2 px-6 max-[760px]:px-4", model.crumbs.length > 1 ? "pt-1.5" : "pt-4")}>
            <Icon name={model.crumbs.length > 1 ? categoryIcon(current.path) : "layout-grid"} size={16} strokeWidth={1.75} className="self-center text-fg" aria-hidden />
            <h1 className="text-[17px] font-semibold text-fg">{heading}</h1>
            <span className="text-[12.5px] text-fg-muted">{model.loading ? "searching…" : `${model.total} part${model.total === 1 ? "" : "s"}`}</span>
          </div>
          <div className="shrink-0 px-6 pt-2 empty:hidden max-[760px]:px-4">
            <LibraryProblems model={model} onRetry={actions.retry} />
          </div>
          <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 pt-3 pb-6 max-[760px]:px-4">
            <div className={layout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "flex flex-col gap-2"}>
              <PagesProvider loader={actions.pages}>
                <PagerProvider store={pager}>
                  {items.map((it, i) => (
                    <Windowed key={it.key} height={CARD_HEIGHT[layout === "grid" ? "tile" : "row"]} eager={i < 24}>
                      <PartCard item={it} variant={layout === "grid" ? "tile" : "row"} selected={it.key === selected} noProject={model.noProject} onOpen={actions.open} onAdd={actions.add} onUpdate={actions.update} onMore={layout === "list" ? actions.more : undefined} />
                    </Windowed>
                  ))}
                </PagerProvider>
              </PagesProvider>
              {model.loading && !items.length && [0, 1, 2, 3].map((i) => <div key={i} aria-hidden className="h-[300px] animate-pulse rounded-[6px] border border-line bg-[var(--pb-card)]" />)}
            </div>
            {!items.length && !model.loading && (
              <div className="py-16">
                <EmptyState icon={<Icon name="search-x" size={28} strokeWidth={1.25} />} title="No parts match">
                  {hidden.size || only.size ? "The filters on the left hide them." : "Try other words, or a broader category."}
                </EmptyState>
              </div>
            )}
            <LoadMore model={model} onMore={actions.loadMore} />
          </ScrollArea>
        </main>
      </div>
    </PartsSurface>
  );
}

/**
 * The library's categories as a list that drills in and out (PB-934), the
 * way the alpha's TaxonomyFilter does: one level of the taxonomy at a time.
 * A row narrows the results to that category and, when it has categories of
 * its own, the list moves down into it; the row at the top goes back up, and
 * "All in …" is the level itself. A category with nothing below it stays
 * listed among its siblings, selected. Every row carries its count; the
 * breadcrumb above (Crumbs) says where the list is and jumps to any level.
 */
import { Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import type { LibraryModel } from "./model.js";
import { BODY, categoryIcon } from "./ui.js";

export interface CategoryListProps {
  model: Pick<LibraryModel, "crumbs" | "categories" | "level" | "query" | "total" | "catalogTotal" | "loading">;
  onPick: (path: string) => void;
  /** Scroll the list inside its own area (give it a height limit in `className`): the side bar keeps room for the parts. */
  scroll?: boolean;
  className?: string;
}

function Row({ name, icon, count, active, more, title, onClick, back }: { name: string; icon: string; count?: number; active?: boolean; more?: boolean; title?: string; onClick: () => void; back?: boolean }) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={active || undefined}
      aria-current={active ? "true" : undefined}
      aria-label={back ? `Back to ${name}` : more ? `${name}, ${count ?? 0} parts, has sub-categories` : count !== undefined ? `${name}, ${count} parts` : name}
      title={title}
      onClick={onClick}
      className={cx(
        BODY,
        "group flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[4px] px-2 text-left text-[12.5px] transition-colors",
        active ? "bg-active font-medium text-fg outline outline-1 -outline-offset-1 outline-contrast-active" : back ? "text-fg-muted hover:bg-hover hover:text-fg" : "text-fg hover:bg-hover",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <Icon name={icon} size={14} strokeWidth={1.75} className={cx("shrink-0", active ? "text-fg" : "text-fg-muted")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count !== undefined && <span className="shrink-0 font-ui text-[11px] text-fg-muted tabular-nums">{count}</span>}
      {/* the chevron's place is kept on every row, so the counts line up */}
      {!back && <Icon name="chevron-right" size={13} className={cx("shrink-0 text-fg-muted", !more && "invisible")} aria-hidden />}
    </button>
  );
}

export function CategoryList({ model, onPick, scroll, className }: CategoryListProps) {
  const level = model.level;
  const active = model.query.category;
  // the level's parent: the crumb before it (the top for a first-level category)
  const at = model.crumbs.findIndex((c) => c.path === level.path);
  const parent = at > 0 ? model.crumbs[at - 1] : undefined;
  const root = !level.path;
  // at the top, "All parts" counts the catalog; below it, the level's own count
  const allCount = root ? (model.catalogTotal ?? (active ? undefined : model.loading ? undefined : model.total)) : level.count;
  const list = (
    <div role="tree" aria-label={root ? "Categories" : `Categories in ${level.name}`} className="flex flex-col gap-px">
      {parent && <Row back name={parent.path ? parent.name : "All categories"} icon="arrow-left" onClick={() => onPick(parent.path)} />}
      <Row name={root ? "All parts" : `All in ${level.name}`} icon={root ? "layout-grid" : "layers"} count={allCount} active={active === level.path} onClick={() => onPick(level.path)} />
      {model.categories.map((c) => (
        <Row key={c.path} name={c.name} icon={c.icon ?? categoryIcon(c.path)} count={c.count} more={c.more} active={active === c.path} title={c.description} onClick={() => onPick(c.path)} />
      ))}
    </div>
  );
  if (!scroll) return <div className={className}>{list}</div>;
  return (
    <ScrollArea className={className} contentClassName="pr-1.5">
      {list}
    </ScrollArea>
  );
}

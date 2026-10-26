/**
 * The project's parts in the side bar (PB-903, design 03; PB-945), the way
 * Source Control shows files: updates first, then each library's parts with
 * their pinned revision, then the parts researched and designed in the
 * project. Each row says two things: the part's status (PB-932: a dot, gray
 * local, yellow unverified, green verified, blue official) and its sync with
 * the library (in sync, an update with its revision, diverged, local only).
 * Colours are the theme's; rows and groups have room between them. The
 * heading opens the Project Parts page, the same parts as cards.
 */
import { useMemo } from "react";
import { Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { partGroups, partNote, partSync, type PartSync } from "./library-data.js";
import type { ProjectPartModel, ProjectPartsActions, ProjectPartsModel } from "./model.js";
import { PartStatusDot, PartStatusLegend } from "./PartStatus.js";
import { rev } from "./revision.js";
import { PartsSurface } from "./Surface.js";
import { BODY, FoldHeading, RowAction, useFolded, type FoldedGroups } from "./ui.js";

export { partGroups, partNote, partSync, tierGroups, type PartGroup, type PartSync } from "./library-data.js";

const SYNC_TEXT: Record<PartSync["tone"], string> = { ok: "text-ok", info: "text-info", warning: "text-warning", neutral: "text-fg-muted" };

/** What an update is, said where updates are listed (beta test 1, F16). */
export const UPDATE_EXPLAINED = "A newer revision the library recommends. Compare before you update.";

export const partIcon = (part: Pick<ProjectPartModel, "tier" | "capability">): string =>
  part.tier === "project-researched" ? "flask-conical" : part.tier === "project-specific" ? (part.capability?.capability === "circuit" ? "circuit-board" : "box") : "package";

function Row({ part, actions, selected }: { part: ProjectPartModel; actions: ProjectPartsActions; selected: boolean }) {
  const sync = partSync(part);
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => actions.open(part.id)}
      onKeyDown={(e) => e.key === "Enter" && actions.open(part.id)}
      className={cx(
        BODY,
        "group flex min-h-8 cursor-pointer items-center gap-2 rounded-[4px] py-1 pr-1.5 pl-2 text-[13px] text-fg",
        selected ? "bg-active outline outline-1 -outline-offset-1 outline-contrast-active" : "hover:bg-hover",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      {part.trust ? <PartStatusDot trust={part.trust} basis={part.trustBasis} /> : <span className="w-2 shrink-0" />}
      <Icon name={partIcon(part)} size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-[1.25]" title={[part.name, part.id, part.file].join("\n")}>
          {part.name}
          {part.instances > 1 && <span className="text-fg-muted"> ×{part.instances}</span>}
        </span>
        <span className={cx("truncate font-ui text-[11px] leading-[1.3]", sync.kind === "update" || sync.kind === "diverged" ? SYNC_TEXT[sync.tone] : "text-fg-muted")}>{part.busy ? `${part.busy}…` : partNote(part)}</span>
      </span>
      <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        {part.status === "update-available" && actions.update && <RowAction icon="download" label={`Update to ${rev(part.recommended)}`} onClick={() => actions.update!(part.id)} />}
        {part.status === "diverged" && actions.restore && <RowAction icon="undo-2" label={`Restore ${rev(part.revision)}`} onClick={() => actions.restore!(part.id)} />}
        {part.tier === "catalog" && actions.compare && <RowAction icon="git-compare-arrows" label="Compare with the library" onClick={() => actions.compare!(part.id)} />}
        {part.tier === "project-researched" && actions.publish && <RowAction icon="upload" label="Submit for verification" onClick={() => actions.publish!(part.id)} />}
        {(actions.openSource || part.tier !== "catalog") && <RowAction icon="file-code" label="Open source" onClick={() => (actions.openSource ?? actions.open)(part.id)} />}
      </span>
      <span role="img" aria-label={`${sync.label}. ${sync.meaning}`} data-tooltip={`${sync.label}. ${sync.meaning}`} className={cx("grid size-5 shrink-0 place-items-center", SYNC_TEXT[sync.tone])}>
        <Icon name={sync.icon} size={14} strokeWidth={sync.kind === "in-sync" ? 2.25 : 1.75} aria-hidden />
      </span>
    </li>
  );
}

export function ProjectParts({
  model,
  actions,
  selected,
  folded,
}: {
  model: ProjectPartsModel;
  actions: ProjectPartsActions;
  /** The part shown in the Inspector or in a detail tab. */ selected?: string;
  /** The groups folded away, kept by the host (PB-1039). */
  folded?: FoldedGroups;
}) {
  const groups = useMemo(() => partGroups(model.parts), [model.parts]);
  const { closed, toggle, setAll } = useFolded(folded);
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.id));
  const c = model.counts;
  return (
    <PartsSurface place="sidebar">
      <div className="flex size-full min-w-[220px] flex-col">
        <div className={cx(BODY, "flex shrink-0 flex-col gap-2 border-b border-line-subtle px-3 pt-2.5 pb-2.5 text-[12px]")}>
          <div className="flex min-w-0 items-center gap-2">
            {actions.openPage ? (
              <button
                type="button"
                onClick={actions.openPage}
                data-tooltip="Open the Project Parts page"
                className="group/title flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[4px] text-left text-[13px] font-semibold text-fg hover:text-link focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <Icon name="package" size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="truncate">
                  {model.waiting ? "Parts" : `${c.total} part${c.total === 1 ? "" : "s"}`}
                </span>
                <Icon name="arrow-up-right" size={13} className="shrink-0 text-fg-muted group-hover/title:text-link" aria-hidden />
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold text-fg">
                <Icon name="package" size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="truncate">
                  {model.waiting ? "Parts" : `${c.total} part${c.total === 1 ? "" : "s"}`}
                </span>
              </span>
            )}
            {groups.length > 1 && <RowAction icon={allClosed ? "chevrons-up-down" : "chevrons-down-up"} label={allClosed ? "Expand all groups" : "Collapse all groups"} onClick={() => setAll(allClosed ? [] : groups.map((g) => g.id))} />}
            {actions.check && <RowAction icon={model.loading ? "loader" : "refresh-cw"} label={model.checked ? "Check the libraries for updates again" : "Check the libraries for updates"} disabled={model.loading} onClick={actions.check} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {model.waiting ? (
              <span className="text-fg-muted">{model.waiting}</span>
            ) : model.checked ? (
              <span className={cx("flex items-center gap-1", c.updates ? "text-info" : "text-fg-muted")} data-tooltip={UPDATE_EXPLAINED}>
                <Icon name="download" size={13} strokeWidth={1.75} aria-hidden /> {c.updates} update{c.updates === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="text-fg-muted">{model.loading ? "Listing…" : "Not checked for updates yet"}</span>
            )}
            {c.diverged > 0 && (
              <span className="flex items-center gap-1 text-warning">
                <Icon name="git-compare-arrows" size={13} strokeWidth={1.75} aria-hidden /> {c.diverged} diverged
              </span>
            )}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-1.5 pt-1 pb-4">
          <ul role="tree" aria-label="Project parts" className="flex flex-col">
            {groups.map((g) => {
              const open = !closed.has(g.id);
              return (
                <li key={g.id} role="treeitem" aria-expanded={open} data-group={g.id} className="mt-3 first:mt-1.5">
                  <FoldHeading
                    open={open}
                    onToggle={() => toggle(g.id)}
                    className="h-7 px-1.5"
                    titleClassName={cx("text-[10.5px]", g.id === "updates" ? "text-info" : "text-fg-muted")}
                    right={<span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-muted px-1 font-ui text-[10px] text-fg outline-1 -outline-offset-1 outline-contrast">{g.parts.length}</span>}
                  >
                    {g.title}
                  </FoldHeading>
                  {open && (
                    <ul role="group" className="mt-1 flex flex-col gap-0.5">
                      {g.parts.map((p) => (
                        <Row key={p.id} part={p} actions={actions} selected={p.id === selected} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {!groups.length && !model.loading && !model.error && !model.waiting && <p className={cx(BODY, "px-2 pt-4 text-[12.5px] text-fg-muted")}>The project has no parts yet. Add some from the library.</p>}
          {model.error && <p className={cx(BODY, "px-2 pt-3 text-[12px] text-error")}>{model.error}</p>}
          {(model.checked?.problems ?? []).map((m) => (
            <p key={m} className={cx(BODY, "px-2 pt-2 text-[12px] text-warning")}>
              Not checked: {m}
            </p>
          ))}
          {groups.length > 0 && (
            <div className={cx(BODY, "mt-5 flex flex-col gap-2 border-t border-line-subtle px-2 pt-3 text-[11.5px] leading-snug text-fg-muted")}>
              <PartStatusLegend />
              <p>{UPDATE_EXPLAINED}</p>
            </div>
          )}
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

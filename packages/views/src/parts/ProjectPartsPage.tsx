/**
 * The Project Parts page (PB-945, decision D3 of beta test 1): the project's
 * parts in the editor area, looking like the library: the same cards with
 * their pictures (PartCard), grouped by tier (from libraries, researched,
 * designed), each carrying its sync status with the library (in sync, update
 * available with the revision, diverged, local only) and its part status
 * (PB-932). The "Project parts" breadcrumb of a part's detail returns here,
 * and the side bar's heading opens it. The same page in VS Code (an editor
 * tab) and in the web viewer.
 */
import { useMemo, useState } from "react";
import { EmptyState, Icon, IconButton, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { partSync, projectCard, tierGroups, type PartSync, type PartSyncKind } from "./library-data.js";
import type { ProjectPartModel, ProjectPartsActions, ProjectPartsModel } from "./model.js";
import { CARD_HEIGHT, PartCard } from "./PartCard.js";
import { LinkPagesToggle, PagerProvider, PagesProvider, useNewPagerStore } from "./carousel.js";
import { Windowed } from "./Windowed.js";
import { PartStatusDot } from "./PartStatus.js";
import { PART_TRUST_STATES, PART_TRUST_TEXT } from "./part-status.js";
import { UPDATE_EXPLAINED, partIcon } from "./ProjectParts.js";
import { rev } from "./revision.js";
import { PartsSurface } from "./Surface.js";
import { BODY, Button, FoldHeading, RowAction, SearchField, SectionLabel, useFolded, type FoldedGroups } from "./ui.js";

export interface ProjectPartsPageProps {
  /** The groups folded away, kept by the host (PB-1039). */
  folded?: FoldedGroups;
  model: ProjectPartsModel;
  actions: ProjectPartsActions;
  /** The project's name, beside the heading. */
  project?: string;
  /** The part whose detail is open (its card is outlined). */
  selected?: string;
}

const SYNC_TEXT: Record<PartSync["tone"], string> = { ok: "text-ok", info: "text-info", warning: "text-warning", neutral: "text-fg-muted" };

/** A part's sync status as a pill: its icon and words in the state's tone, on the card's own surface so it reads over a picture. */
export function SyncPill({ sync, onClick, disabled }: { sync: PartSync; /** An update's pill updates the part. */ onClick?: () => void; disabled?: boolean }) {
  const tip = `${sync.label}. ${sync.meaning}`;
  const pill = (
    <span
      {...(onClick ? {} : { role: "img", "aria-label": tip, "data-tooltip": tip })}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-current bg-[var(--pb-card)] px-2 text-[11px] leading-none whitespace-nowrap outline-1 -outline-offset-1 outline-contrast",
        SYNC_TEXT[sync.tone],
      )}
    >
      <Icon name={sync.icon} size={11} strokeWidth={2} aria-hidden />
      {sync.label}
    </span>
  );
  if (!onClick) return pill;
  return (
    <button
      type="button"
      aria-label={tip}
      data-tooltip={tip}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="cursor-pointer rounded-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default"
    >
      {pill}
    </button>
  );
}

type Filter = "all" | PartSyncKind;

function CardActions({ part, actions }: { part: ProjectPartModel; actions: ProjectPartsActions }) {
  const busy = !!part.busy;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {part.status === "update-available" && actions.update && <RowAction icon="download" label={`Update to ${rev(part.recommended)}`} disabled={busy} onClick={() => actions.update!(part.id)} />}
      {part.status === "diverged" && actions.restore && <RowAction icon="undo-2" label={`Restore ${rev(part.revision)}`} disabled={busy} onClick={() => actions.restore!(part.id)} />}
      {part.tier === "catalog" && actions.compare && <RowAction icon="git-compare-arrows" label="Compare with the library" onClick={() => actions.compare!(part.id)} />}
      {part.tier === "project-researched" && actions.publish && <RowAction icon="upload" label="Submit for verification" onClick={() => actions.publish!(part.id)} />}
      {actions.openSource && <RowAction icon="file-code" label="Open source" onClick={() => actions.openSource!(part.id)} />}
    </div>
  );
}

export function ProjectPartsPage({ model, actions, project, selected, folded }: ProjectPartsPageProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const pager = useNewPagerStore();
  const synced = useMemo(() => model.parts.map((p) => ({ part: p, sync: partSync(p) })), [model.parts]);
  const count = (k: PartSyncKind) => synced.filter((x) => x.sync.kind === k).length;
  const shown = useMemo(() => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return synced.filter(({ part, sync }) => (filter === "all" || sync.kind === filter) && words.every((w) => `${part.name} ${part.id} ${part.manufacturer ?? ""} ${part.partNumber ?? ""}`.toLowerCase().includes(w)));
  }, [synced, text, filter]);
  const syncOf = useMemo(() => new Map(shown.map((x) => [x.part.id, x.sync])), [shown]);
  const groups = useMemo(() => tierGroups(shown.map((x) => x.part)), [shown]);
  const { closed, toggle, setAll } = useFolded(folded);
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.id));
  const c = model.counts;
  // the filters offered: every sync state the project has parts in (never one that would show nothing)
  const every: { id: Filter; label: string; icon: string; n: number; tone: PartSync["tone"] }[] = [
    { id: "all", label: "All", icon: "layout-grid", n: c.total, tone: "neutral" },
    { id: "update", label: "Updates", icon: "download", n: count("update"), tone: "info" },
    { id: "diverged", label: "Diverged", icon: "git-compare-arrows", n: count("diverged"), tone: "warning" },
    { id: "in-sync", label: "In sync", icon: "check", n: count("in-sync"), tone: "ok" },
    { id: "pinned", label: "Not checked", icon: "pin", n: count("pinned"), tone: "neutral" },
    { id: "local", label: "Local only", icon: "hard-drive", n: count("local"), tone: "neutral" },
  ];
  const filters = every.filter((f) => f.id === "all" || f.n > 0);
  const checked = model.checked ? `Checked ${model.checked.at.slice(0, 16).replace("T", " ")} UTC` : undefined;
  return (
    <PartsSurface place="editor">
      <div className="flex size-full min-w-[320px] flex-col">
        <header className={cx(BODY, "flex shrink-0 flex-col gap-3 px-6 pt-5 pb-3 max-[640px]:px-4")}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <Icon name="package" size={17} strokeWidth={1.75} className="shrink-0 self-center text-fg" aria-hidden />
              <h1 className="shrink-0 text-[17px] font-semibold text-fg">Project parts</h1>
              <span className="min-w-0 truncate text-[12.5px] text-fg-muted">
                {project ? `${project} · ` : ""}
                {c.total} part{c.total === 1 ? "" : "s"}: {c.library} from libraries, {c.researched} researched, {c.designed} designed
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {actions.check && (
                <Button icon={model.loading ? "loader" : "refresh-cw"} disabled={model.loading} onClick={actions.check} data-tooltip={checked ?? "Ask the libraries which parts have a newer recommended revision"}>
                  {model.loading ? "Checking…" : "Check for updates"}
                </Button>
              )}
              {actions.openLibrary && (
                <Button icon="library-big" onClick={actions.openLibrary}>
                  Library
                </Button>
              )}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SearchField className="min-w-[160px] flex-1" value={text} placeholder="Filter the project's parts by name, id or MPN…" onChange={setText} />
            {actions.pages && <LinkPagesToggle store={pager} />}
            <span className="flex items-center gap-1">
              {groups.length > 1 && <IconButton icon={allClosed ? "chevrons-up-down" : "chevrons-down-up"} label={allClosed ? "Expand all groups" : "Collapse all groups"} onClick={() => setAll(allClosed ? [] : groups.map((g) => g.id))} />}
              <IconButton icon="layout-grid" label="Grid" pressed={layout === "grid"} onClick={() => setLayout("grid")} />
              <IconButton icon="list" label="List" pressed={layout === "list"} onClick={() => setLayout("list")} />
            </span>
          </div>
          <ScrollArea axis="horizontal" className="-mx-1 shrink-0" contentClassName="flex gap-1.5 px-1 py-0.5">
            <div role="radiogroup" aria-label="Show parts by sync status" className="flex gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cx(
                    "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] border px-2.5 text-[12px] whitespace-nowrap transition-colors",
                    filter === f.id ? "border-focus bg-active text-fg outline outline-1 -outline-offset-1 outline-contrast-active" : "border-[var(--pb-control-border)] text-fg hover:bg-hover",
                    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus",
                  )}
                >
                  <Icon name={f.icon} size={13} strokeWidth={1.75} className={SYNC_TEXT[f.tone]} aria-hidden />
                  {f.label}
                  <span className="font-ui text-[11px] text-fg-muted tabular-nums">{f.n}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
          {model.error && (
            <p role="status" className="flex items-start gap-2 rounded-[4px] border border-line px-2.5 py-2 text-[12px] text-fg">
              <Icon name="triangle-alert" size={14} className="mt-px shrink-0 text-warning" aria-hidden />
              {model.error}
            </p>
          )}
          {(model.checked?.problems ?? []).map((m) => (
            <p key={m} role="status" className="flex items-start gap-2 text-[12px] text-fg-muted">
              <Icon name="triangle-alert" size={14} className="mt-px shrink-0 text-warning" aria-hidden />
              Not checked: {m}
            </p>
          ))}
        </header>
        <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col gap-7 px-6 pt-1 pb-8 max-[640px]:px-4">
          <PagesProvider loader={actions.pages}>
            <PagerProvider store={pager}>
              {groups.map((g, gi) => (
                <section key={g.id} aria-label={g.title} data-group={g.id}>
                  <FoldHeading open={!closed.has(g.id)} onToggle={() => toggle(g.id)} className="-ml-1.5 h-7 px-1.5" right={<span className="font-ui text-[11px] text-fg-muted">{g.parts.length}</span>}>
                    {g.title}
                  </FoldHeading>
                  {!closed.has(g.id) && <p className={cx(BODY, "pt-0.5 pb-2.5 text-[12px] leading-snug text-fg-muted")}>{g.hint}</p>}
                  {!closed.has(g.id) && (
                  <div className={layout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "flex flex-col gap-2"}>
                    {g.parts.map((p, i) => {
                      const sync = syncOf.get(p.id)!;
                      return (
                      <Windowed key={p.id} height={CARD_HEIGHT[layout === "grid" ? "tile" : "row"]} eager={gi === 0 && i < 24}>
                          <PartCard
                            item={projectCard(p)}
                            variant={layout === "grid" ? "tile" : "row"}
                            selected={p.id === selected}
                            icon={partIcon(p)}
                            onOpen={() => actions.open(p.id)}
                            onAdd={() => undefined}
                            onUpdate={() => undefined}
                            pill={p.busy ? undefined : <SyncPill sync={sync} {...(sync.kind === "update" && actions.update ? { onClick: () => actions.update!(p.id) } : {})} />}
                            status={p.trust ? <PartStatusDot trust={p.trust} basis={p.trustBasis} label /> : undefined}
                            actions={<CardActions part={p} actions={actions} />}
                          />
                      </Windowed>
                      );
                    })}
                  </div>
                  )}
                </section>
              ))}
            </PagerProvider>
          </PagesProvider>
          {model.loading && !model.parts.length && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[300px] animate-pulse rounded-[6px] border border-line bg-[var(--pb-card)]" />
              ))}
            </div>
          )}
          {!groups.length && !model.loading && (
            <div className="py-16">
              {model.parts.length ? (
                <EmptyState icon={<Icon name="search-x" size={28} strokeWidth={1.25} />} title="No parts match">
                  Try other words, or show every sync status.
                </EmptyState>
              ) : (
                <EmptyState icon={<Icon name="package" size={28} strokeWidth={1.25} />} title="No parts yet">
                  Parts you add from the library, research or design in the project are listed here.
                </EmptyState>
              )}
            </div>
          )}
          {model.parts.length > 0 && (
            <footer className={cx(BODY, "flex flex-col gap-3 border-t border-line-subtle pt-4 text-[12px] leading-snug text-fg-muted")}>
              <div>
                <SectionLabel>Part status</SectionLabel>
                <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  {PART_TRUST_STATES.map((t) => (
                    <div key={t} className="contents">
                      <dt className="flex items-center">
                        <PartStatusDot trust={t} label />
                      </dt>
                      <dd>{PART_TRUST_TEXT[t].meaning}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <SectionLabel>Updates</SectionLabel>
                <p className="mt-1 max-w-[80ch]">{UPDATE_EXPLAINED}</p>
              </div>
            </footer>
          )}
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

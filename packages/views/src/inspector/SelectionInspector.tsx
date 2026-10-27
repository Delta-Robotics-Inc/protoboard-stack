/**
 * The Inspector's selection (PB-940; design A "Linear-tight", PB-1042, with
 * expandable interface cards): one column, no boxes. The
 * header is the shell's: the kind's icon, the name, what it is and which
 * part, the part's status, and a summary row (the findings, the price, how
 * many modules are below, the quick actions). Then sections, each a 28 px
 * header row (chevron, title, count or summary) over its body, separated by
 * 1 px dividers: the viewer's own (`SelectionDetails` of
 * @deltarobotics/uhd-viewer: Parameters, Interfaces as slot cards that
 * expand, Artifacts, and the secondary ones closed), then the shell's
 * (Checks, Children, Links, Sourcing, Used in…). Arrow keys move through the
 * section headers and the cards.
 *
 * The shell gives the card, the project's bundle and the files the page may
 * load. Nothing is loaded that the card does not name: pictures are lazy, a
 * model is drawn only when the shell marks it small enough.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import {
  ArtifactGrid,
  DetailsSection,
  HostContext,
  Icon,
  IconButton,
  ScrollArea,
  SECTION_LOOK,
  SelectionDetails,
  Sections,
  cx,
  useTheme,
  type ArtifactCardModel,
  type HostActions,
} from "@deltarobotics/uhd-viewer/components";
import { PartStatusDot } from "../parts/PartStatus.js";
import { PartsSurface } from "../parts/Surface.js";
import { RowAction } from "../parts/ui.js";
import type { InspectorActions, InspectorCard, InspectorChip, InspectorContent, InspectorRow, InspectorSection } from "./model.js";

type Bundle = NonNullable<Parameters<typeof SelectionDetails>[0]["bundle"]>;

/**
 * The bundle with only one definition's artifacts (PB-1063). The viewer's
 * details show an assembly's parts' artifacts as well (a row of parts to pick
 * from, the count of all of them); the Inspector shows the selection's own.
 */
export function ownArtifactsOnly(bundle: unknown, defId: string | undefined): unknown {
  const b = bundle as { definitions?: { id: string; artifacts?: unknown[] }[] } | undefined;
  if (!defId || !b || !Array.isArray(b.definitions)) return bundle;
  return { ...b, definitions: b.definitions.map((d) => (d.id === defId || !d.artifacts?.length ? d : { ...d, artifacts: [] })) };
}
type Definitions = NonNullable<Parameters<typeof SelectionDetails>[0]["definitions"]>;

const TONE: Record<string, string> = { error: "text-error", warning: "text-warning", info: "text-info", ok: "text-ok" };
const SEVERITY_ICON: Record<string, string> = { error: "circle-x", warning: "triangle-alert", info: "info" };

/** The header's look (design A), in one place. */
export const INSPECTOR_HEADER_LOOK = {
  header: "border-b border-line-subtle px-3.5 pt-3 pb-2.5",
  tile: "grid size-9 shrink-0 place-items-center rounded-[8px] border border-line bg-[color-mix(in_oklab,var(--uhd-text)_6%,transparent)] text-fg",
  title: "truncate text-[14px] leading-[1.3] font-semibold text-fg",
  subtitle: "truncate text-[11px] leading-[1.4] text-fg-muted",
  status: "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--uhd-text)_8%,transparent)] px-2 text-[11px] leading-none text-fg",
  summary: "mt-2.5 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] leading-none text-fg-muted",
  divider: "h-3.5 w-px shrink-0 bg-line",
} as const;

/** A small outlined label: the part's tier, its sync state, a quantity, stale outputs. */
function Chip({ chip }: { chip: InspectorChip }) {
  return (
    <span
      data-tooltip={chip.title}
      data-tooltip-clamp={chip.title && chip.title.length > 40 ? "4" : undefined}
      data-blank={chip.blank ? "" : undefined}
      className={cx(
        "inline-flex h-[18px] max-w-full shrink-0 items-center gap-1.5 rounded-full border px-1.5 text-[10.5px] leading-none whitespace-nowrap",
        chip.tone && TONE[chip.tone] ? cx(TONE[chip.tone], "border-current") : "border-[var(--pb-control-border)] text-fg-muted",
        chip.blank && "border-dashed border-fg-muted",
        "outline-1 -outline-offset-1 outline-contrast",
      )}
    >
      {chip.status && <PartStatusDot trust={chip.status} blank={chip.blank} size={7} />}
      <span className="truncate">{chip.text}</span>
    </span>
  );
}

/** The part's status, at the title's right: its dot and its name (Local, Unverified, Verified, Official). */
function StatusChip({ chip }: { chip: InspectorChip }) {
  return (
    <span data-status-chip="" data-tooltip={chip.title} data-tooltip-clamp="4" className={cx(INSPECTOR_HEADER_LOOK.status, chip.blank && "border border-dashed border-fg-muted bg-transparent")}>
      {chip.status && <PartStatusDot trust={chip.status} blank={chip.blank} size={7} />}
      <span className="truncate">{chip.text}</span>
    </span>
  );
}

/** The findings here and below, in the summary row: a count per severity with its icon, or "No findings". */
function Counts({ counts }: { counts: InspectorCard["counts"] }) {
  const total = counts.error + counts.warning + counts.info;
  const label = `${counts.error} blocking, ${counts.warning} warnings, ${counts.info} info`;
  if (!total)
    return (
      <span aria-label="No findings" className="inline-flex items-center gap-1 text-ok">
        <Icon name="circle-check" size={13} strokeWidth={1.75} aria-hidden />
        <span className="text-fg-muted">No findings</span>
      </span>
    );
  return (
    <span role="img" aria-label={`Findings here and below: ${label}`} data-tooltip={`Findings here and below: ${label}`} className="inline-flex items-center gap-2">
      {(["error", "warning", "info"] as const).map((sev) =>
        counts[sev] ? (
          <span key={sev} className={cx("inline-flex items-center gap-1 tabular-nums", TONE[sev])}>
            <Icon name={SEVERITY_ICON[sev]} size={13} strokeWidth={1.75} aria-hidden />
            <span className="text-fg">{counts[sev]}</span>
          </span>
        ) : null,
      )}
    </span>
  );
}

/** A row of a section: a module, a link's end, a finding (its message and its code under it), a fact. */
function Row({ row, actions }: { row: InspectorRow; actions: InspectorActions }) {
  const act = row.action;
  const go = act ? () => (act.type === "focus" ? actions.focus(act.path) : actions.finding(act.key)) : undefined;
  const finding = act?.type === "finding" || row.code;
  return (
    <div
      role={go ? "button" : undefined}
      tabIndex={go ? 0 : undefined}
      data-tooltip={`${row.label}${row.detail ? ` · ${row.detail}` : ""}`}
      data-tooltip-clamp="3"
      data-tooltip-delay="600"
      data-row-finding={row.code}
      onClick={go}
      onKeyDown={
        go &&
        ((e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            go();
          }
        })
      }
      className={cx(
        "group/row -mx-1 flex gap-2 rounded-[4px] px-1 text-[11.5px] text-fg",
        finding ? "items-start py-1" : "min-h-[24px] items-center",
        go && "cursor-pointer hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <Icon name={row.icon} size={13} strokeWidth={1.75} className={cx("shrink-0", finding && "mt-px", row.tone && TONE[row.tone] ? TONE[row.tone] : "text-fg-muted")} aria-hidden />
      {finding ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="leading-[1.4]">{row.label}</span>
          {row.code && <span className="font-code text-[9.5px] leading-none text-fg-faint">{row.code}</span>}
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.detail && <span className="max-w-[50%] min-w-0 shrink truncate text-[11px] text-fg-muted">{row.detail}</span>}
        </>
      )}
      {(row.chips ?? []).map((c) => (
        <Chip key={c.text} chip={c} />
      ))}
      {act?.type === "finding" && (
        <span className="flex shrink-0 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
          <RowAction icon="circle-help" label={`Explain ${row.code ?? "this finding"}`} onClick={() => actions.explain(act.key)} />
        </span>
      )}
    </div>
  );
}

/** How many rows of a section are shown at first, and how many more each "Show more" adds (PB-1088). */
export const SECTION_STEP = 10;

const MORE_BUTTON =
  "-mx-1 inline-flex h-6 cursor-pointer items-center gap-1 rounded-[3px] px-1 text-[11px] leading-none text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus";

/** A long list `step` rows at a time: "Show 10 more" under it adds the next ones, "Show fewer" goes back (PB-1088). */
export function useLoadMore(total: number, step = SECTION_STEP): { limit: number; footer: React.ReactNode } {
  const [shown, setShown] = useState(step);
  const limit = Math.min(total, shown);
  if (total <= step) return { limit: total, footer: null };
  const next = Math.min(step, total - limit);
  return {
    limit,
    footer: (
      <div className="flex min-h-6 items-center gap-3 pt-1" data-load-more="">
        {next > 0 && (
          <button type="button" className={MORE_BUTTON} onClick={() => setShown(limit + next)}>
            <Icon name="chevron-down" size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
            Show {next} more
          </button>
        )}
        {limit > step && (
          <button type="button" className={cx(MORE_BUTTON, next > 0 && "ml-auto")} onClick={() => setShown(step)}>
            <Icon name="chevron-up" size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
            Show fewer
          </button>
        )}
      </div>
    ),
  };
}

/** One of the shell's sections, in the details' look: a header row, closed when secondary, ten rows at a time. */
function HostSection({ section, actions }: { section: InspectorSection; actions: InspectorActions }) {
  const more = useLoadMore(section.rows.length, section.limit ?? SECTION_STEP);
  return (
    <DetailsSection id={`host:${section.title}`} title={section.title} count={section.count} summary={section.summary} defaultOpen={!section.collapsed}>
      {section.rows.slice(0, more.limit).map((r, i) => (
        <Row key={`${r.label}-${i}`} row={r} actions={actions} />
      ))}
      {more.footer}
    </DetailsSection>
  );
}

/**
 * The way to the code (the 2026-10-08 first builds, D7): the open-source
 * action drawn with the name of the file it opens, so it is seen without
 * hovering; the tooltip says the whole path. It comes first among the actions.
 */
function SourceAction({ source, onOpen }: { source: { file: string; line?: number }; onOpen: () => void }) {
  const name = source.file.split("/").pop() ?? source.file;
  const at = `${source.file}${source.line ? `:${source.line}` : ""}`;
  return (
    <button
      type="button"
      data-action="source"
      aria-label={`Open source: ${at}`}
      data-tooltip={`Open source: ${at}`}
      data-tooltip-clamp={at.length > 40 ? "3" : undefined}
      onClick={onOpen}
      className={cx(
        "inline-flex h-6 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[4px] px-1.5 text-[11px] leading-none text-fg",
        "hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <Icon name="file-code" size={14} strokeWidth={1.75} className="shrink-0 text-link" aria-hidden />
      <span className="min-w-0 truncate font-code">
        {name}
        {source.line ? <span className="text-fg-muted">:{source.line}</span> : null}
      </span>
    </button>
  );
}

/** Cards outside the viewer's details open through the same host actions. */
function HostCards({ host, children }: { host: HostActions; children: React.ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

/**
 * On a light page the viewer's details write in the link-state hues (a part's audit, its assumptions, a link's
 * diagnostics), which are bright for dark pages: yellow on white is 1.4:1. They take the deeper shades the parts
 * views' surface gives the severities there (PB-900), the same hue for the same meaning; dark pages keep the hues.
 */
const LIGHT_STATES = {
  "--uhd-drc-configured": "var(--uhd-severity-ok)",
  "--uhd-drc-partial": "var(--uhd-severity-warning)",
  "--uhd-drc-incompatible": "var(--uhd-severity-error)",
  // the grey of "not configured" as text: the muted text colour
  "--uhd-drc-unconfigured": "var(--uhd-text-muted)",
} as CSSProperties;

export interface SelectionInspectorProps {
  content: InspectorContent | undefined;
  /** The project's bundle (loaded by the shell from `content.bundle`). */
  bundle?: unknown;
  actions: InspectorActions;
}

/** The header (design A): icon, name, what it is, the status at the right, then the summary row with the quick actions. */
function Header({ card, actions }: { card: InspectorCard; actions: InspectorActions }) {
  const a = card.actions;
  const status = card.chips.find((c) => c.status);
  // the kind is said in the subtitle; the other chips (tier, sync, quantity, stale outputs) stay small under it
  const kindChip = !card.kindLabel ? card.chips.find((c) => !c.status && !c.tone && c === card.chips[0]) : undefined;
  const kind = card.kindLabel ?? kindChip?.text;
  const rest = card.chips.filter((c) => c !== status && c !== kindChip);
  const subtitle = [kind, card.subtitle].filter(Boolean).join(" · ");
  const findingsShown = (card.kind !== "part" && card.kind !== "interface") || card.counts.error + card.counts.warning + card.counts.info > 0;
  const facts = [
    ...(card.summary?.price ? [<span key="price" className="tabular-nums text-fg" data-summary="price">{card.summary.price}</span>] : []),
    ...(card.summary?.children ? [<span key="children" data-summary="children">{`${card.summary.children} ${card.summary.children === 1 ? "child" : "children"}`}</span>] : []),
  ];
  return (
    <header className={INSPECTOR_HEADER_LOOK.header}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={INSPECTOR_HEADER_LOOK.tile}>
          <Icon name={card.icon} size={18} strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1 pt-px">
          <h1 data-tooltip={card.title} data-tooltip-clamp="3" className={cx("m-0", INSPECTOR_HEADER_LOOK.title)}>
            {card.title}
          </h1>
          {subtitle && (
            <div data-tooltip={subtitle} data-tooltip-clamp="3" className={INSPECTOR_HEADER_LOOK.subtitle}>
              {subtitle}
            </div>
          )}
        </div>
        {status && <StatusChip chip={status} />}
      </div>
      {rest.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {rest.map((c) => (
            <Chip key={c.text} chip={c} />
          ))}
        </div>
      )}
      <div className={INSPECTOR_HEADER_LOOK.summary}>
        {findingsShown && <Counts counts={card.counts} />}
        {facts.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-2.5">
            {(findingsShown || i > 0) && <span aria-hidden className={INSPECTOR_HEADER_LOOK.divider} />}
            {f}
          </span>
        ))}
        {/* the quick actions, at the right; they wrap under the facts in a narrow side bar */}
        <div role="toolbar" aria-label="Selection actions" className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5 empty:hidden">
          {a.source && card.source && <SourceAction source={card.source} onOpen={() => actions.action("source")} />}
          {a.focus && <IconButton size="sm" icon="crosshair" label={card.kind === "link" ? "Show the link in the viewer" : "Focus in the viewer"} onClick={() => actions.action("focus")} />}
          {a.pair && <IconButton size="sm" icon="git-compare-arrows" label="Open the pair view in a tab" onClick={() => actions.action("pair")} />}
          {a.detail && <IconButton size="sm" icon="panel-top-open" label="Open the part's page" onClick={() => actions.action("detail")} />}
          {a.source && !card.source && <IconButton size="sm" icon="file-code" label="Open source" onClick={() => actions.action("source")} />}
          {a.artifacts && <IconButton size="sm" icon="folder-open" label="Open artifact…" onClick={() => actions.action("artifacts")} />}
          {a.operation && <IconButton size="sm" icon="play" label="Run operation…" onClick={() => actions.action("operation")} />}
        </div>
      </div>
    </header>
  );
}

export function SelectionInspector({ content, bundle, actions }: SelectionInspectorProps) {
  const card = content && "card" in content ? content.card : undefined;
  const details = card?.details;
  const light = useTheme().theme.scheme.includes("light");
  const resolve = useCallback((defId: string, filePath: string) => details?.files[`${defId}\n${filePath}`], [details]);
  const shown = useMemo(() => ownArtifactsOnly(bundle, details?.artifactsOf), [bundle, details?.artifactsOf]);
  const host = useMemo<HostActions>(
    () => ({
      openArtifact: actions.openArtifact,
      openLink: actions.openLink,
      // nothing is loaded for a 3D preview here: a model is a card, drawn small only when the shell says it may be
      artifactModels: "cards",
      artifactPreview: (def, artifact) => details?.previews[`${def.id}#${artifact.id}`],
      ...(actions.drawModel ? { drawModel: actions.drawModel } : {}),
      // pictures come from the shell's own files only
      remoteImages: false,
      evidence: (defId) => details?.evidence?.[defId] as ReturnType<NonNullable<HostActions["evidence"]>>,
    }),
    [actions, details],
  );
  if (!card)
    return (
      <PartsSurface place="sidebar" className="bg-transparent!">
        <div className="grid size-full place-items-center px-6" data-inspector-empty="">
          <div className="flex max-w-[260px] flex-col items-center gap-2 text-center font-ui">
            <span aria-hidden className={cx(INSPECTOR_HEADER_LOOK.tile, "text-fg-muted")}>
              <Icon name="mouse-pointer-click" size={18} strokeWidth={1.6} />
            </span>
            <h1 className="m-0 text-[13px] font-semibold text-fg">Nothing selected</h1>
            <p className="m-0 text-[11.5px] leading-[1.5] text-fg-muted">{content && "empty" in content ? content.empty : "Open a Protoboard project."}</p>
          </div>
        </div>
      </PartsSurface>
    );
  // a part's picture that is not an artifact of its definition (a library's thumbnail)
  const picture: ArtifactCardModel[] = details?.picture
    ? [{ key: "picture", defId: card.part?.partId ?? "", title: card.title, kind: "image", group: "images", kindLabel: "Picture", source: card.part?.library, icon: "image", preview: { kind: "image", src: details.picture }, remote: false }]
    : [];
  const own: ArtifactCardModel[] = (card.artifacts ?? []).map((x) => ({
    key: `${x.defId}#${x.artifactId}`,
    defId: x.defId,
    artifactId: x.artifactId,
    title: x.title,
    kind: "model",
    group: "data",
    kindLabel: x.kindLabel,
    ...(x.format ? { format: x.format } : {}),
    ...(x.source ? { source: x.source } : {}),
    icon: x.icon,
    ...(x.preview ? { preview: x.preview } : {}),
    remote: false,
  }));
  return (
    <PartsSurface place="sidebar" className="bg-transparent!">
      <div className="contents" style={light ? LIGHT_STATES : undefined}>
        {/* a new selection starts at its top (the scroll is the selection's, not the view's) */}
        <ScrollArea key={`${card.kind}:${card.path}:${card.linkId ?? card.part?.partId ?? ""}:${card.title}`} className="size-full" contentClassName="min-w-[188px] pb-4 font-ui">
          <Header card={card} actions={actions} />
          <Sections label={`${card.title}: details`} className="pb-inspector-sections">
            {picture.length > 0 && (
              <HostCards host={host}>
                <DetailsSection id="picture" title="Picture">
                  <ArtifactGrid cards={picture} />
                </DetailsSection>
              </HostCards>
            )}
            {details && (
              <SelectionDetails
                className="pb-inspector-details"
                bundle={shown as Bundle | undefined}
                definitions={details.definitions as Definitions | undefined}
                target={details.target}
                resolveArtifact={resolve}
                host={host}
                onSelect={actions.select}
                onPair={() => actions.action("pair")}
                {...(details.findings ? { findings: details.findings } : {})}
                onFinding={actions.finding}
                {...(actions.interfaceSource ? { onInterfaceSource: actions.interfaceSource } : {})}
                {...(actions.connect ? { onConnect: actions.connect } : {})}
                missing={bundle || details.target.kind === "definition" ? null : <p className={cx(SECTION_LOOK.body, "m-0 py-2 text-[11.5px] text-fg-muted")}>Reading the build…</p>}
              />
            )}
            {own.length > 0 && (
              <HostCards host={host}>
                <DetailsSection id="host:artifacts" title="Artifacts" count={own.length}>
                  <ArtifactGrid cards={own} />
                </DetailsSection>
              </HostCards>
            )}
            {card.sections.map((s) => (
              <HostSection key={s.title} section={s} actions={actions} />
            ))}
          </Sections>
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

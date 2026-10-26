/**
 * The DRC panel (PB-901): the build's findings in severity lanes (Blocking,
 * Warnings, and Information on request), grouped by module, rule or source.
 * The filters are segmented icon choices with tooltips, never the system's
 * dropdown; a row opens to its reasons, what the code means and what to do;
 * its actions (locate, open source, explain) are icon buttons with tooltips,
 * the same icons as the Inspector's. The shell computes the model and does
 * what the actions ask. Finding text is drawn as text: the only markup read
 * from it is `code` and **bold**.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Icon, IconButton, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { PartsSurface } from "../parts/Surface.js";
import { BODY, Button, RowAction } from "../parts/ui.js";
import type { DrcLaneModel, DrcPanelActions, DrcPanelModel, DrcQueryModel, DrcRowModel } from "./model.js";

export interface DrcPanelProps {
  model: DrcPanelModel | undefined;
  actions: DrcPanelActions;
}

const LANE: Record<DrcLaneModel["id"], { icon: string; tone: string; empty: string }> = {
  blocking: { icon: "circle-x", tone: "text-error", empty: "Nothing blocking." },
  warnings: { icon: "triangle-alert", tone: "text-warning", empty: "None." },
  info: { icon: "info", tone: "text-info", empty: "None." },
};

const SEVERITY = [
  { id: "all", icon: "list", label: "Blocking and warnings" },
  { id: "error", icon: "circle-x", label: "Blocking only" },
  { id: "warning", icon: "triangle-alert", label: "Warnings only" },
] as const;

const GROUP = [
  { id: "module", icon: "box", label: "Group by module" },
  { id: "rule", icon: "scale", label: "Group by rule" },
  { id: "source", icon: "blocks", label: "Group by source" },
] as const;

/** `code` and **bold** from the references' Markdown; everything else as text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
        !part ? null : part.startsWith("`") ? (
          <code key={i} className="font-code text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith("**") ? (
          <b key={i}>{part.slice(2, -2)}</b>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A themed segmented choice of icons, each naming itself in a tooltip; a count may follow an icon. */
function Segmented<T extends string>({ label, options, value, onChange, counts }: { label: string; options: readonly { id: T; icon: string; label: string }[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>> }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 items-center gap-px rounded-[6px] border border-[var(--pb-control-border)] bg-sunken p-px">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-label={o.label}
          aria-pressed={o.id === value}
          data-tooltip={o.label}
          data-value={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            BODY,
            "inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-1.5 text-[12px] whitespace-nowrap text-fg-muted transition-colors",
            "hover:bg-hover hover:text-fg aria-pressed:border-accent/45 aria-pressed:bg-accent-tint aria-pressed:text-fg",
            "outline-1 -outline-offset-1 outline-transparent aria-pressed:outline-contrast-active focus-visible:outline-focus",
          )}
        >
          <Icon name={o.icon} size={13} strokeWidth={1.75} aria-hidden />
          {counts?.[o.id] !== undefined && <span className="tabular-nums opacity-85">{counts[o.id]}</span>}
        </button>
      ))}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <Icon name="chevron-right" size={12} strokeWidth={2} className={cx("shrink-0 text-fg-muted transition-transform duration-100", open && "rotate-90")} aria-hidden />;
}

function FindingRow({ f, lane, flat, open, onToggle, actions }: { f: DrcRowModel; lane: DrcLaneModel["id"]; flat: boolean; open: boolean; onToggle: () => void; actions: DrcPanelActions }) {
  return (
    <div data-finding={f.key} className="group/item">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cx(
          BODY,
          "group/row flex min-h-[24px] cursor-pointer items-center gap-2 rounded-[3px] pr-0.5 text-[12.5px] text-fg",
          flat ? "pl-0" : "pl-3",
          "hover:bg-hover hover:outline hover:outline-1 hover:outline-dashed hover:-outline-offset-1 hover:outline-contrast-active",
          "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        )}
      >
        <Chevron open={open} />
        <span className={cx("shrink-0 font-code text-[11.5px]", LANE[lane].tone)}>{f.code}</span>
        <span title={f.message} className="min-w-0 flex-1 truncate">
          {f.summary}
        </span>
        <span className="max-w-[35%] min-w-0 shrink truncate text-fg-muted">{f.module}</span>
        <span className={cx("flex shrink-0 gap-px", !open && "invisible group-focus-within/row:visible group-hover/row:visible")}>
          {f.fix && actions.fix && <RowAction icon={f.fix.icon ?? "download"} label={f.fix.label} onClick={() => actions.fix!(f.key)} />}
          <RowAction icon="crosshair" label="Locate in the viewer" onClick={() => actions.locate(f.key)} />
          <RowAction icon="file-code" label={f.hasSource ? `Open source · ${f.sourceLabel}` : "No source location"} disabled={!f.hasSource} onClick={() => actions.openSource(f.key)} />
          <RowAction icon="circle-help" label={`Explain ${f.code}`} onClick={() => actions.explain(f.key)} />
        </span>
      </div>
      {open && (
        <div className={cx(BODY, "mb-1.5 border-l-2 border-line-strong py-1 pl-2.5 text-[12.5px] leading-[1.45] text-fg", flat ? "ml-[18px]" : "ml-[30px]")}>
          {/* the row's line is cut to fit; here it is whole, with the reasons under it */}
          <p>{f.summary}</p>
          {f.reasons.length > 0 && (
            <ul className="list-disc pl-4">
              {f.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {f.means && (
            <p className="pt-0.5">
              <Inline text={f.means} />
            </p>
          )}
          {f.todo && (
            <p className="pt-0.5">
              <span className="text-fg-muted">What to do: </span>
              <Inline text={f.todo} />
            </p>
          )}
          {f.fix && actions.fix && (
            <p className="pt-1">
              <Button size="sm" kind="primary" icon={f.fix.icon ?? "download"} onClick={() => actions.fix!(f.key)}>
                {f.fix.label}
              </Button>
            </p>
          )}
          <p className="pt-0.5 text-[11.5px] text-fg-muted">{[f.sourceKind, f.validator, f.sourceLabel].filter(Boolean).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className={cx(BODY, "py-2 text-[12.5px] text-fg-muted")}>{children}</div>;
}

export function DrcPanel({ model, actions }: DrcPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(actions.saved?.expanded ?? []));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(actions.saved?.collapsed ?? []));
  const query: DrcQueryModel = model?.query ?? { groupBy: "module", text: "", severity: "all", info: false };
  // the text field is the user's while they type; a query from the shell replaces it otherwise
  const [text, setText] = useState(query.text);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setText(query.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.text]);
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => {
      actions.query({ ...query, text });
      setTyping(false);
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, typing]);
  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const keep = (e: Set<string>, c: Set<string>) => actions.save?.({ expanded: [...e], collapsed: [...c] });
  const send = (patch: Partial<DrcQueryModel>) => actions.query({ ...query, text, ...patch });
  const m = model?.model;
  const c = m?.counts;
  const head = model && model.state !== "none" ? [model.project, model.state === "running" ? "checking…" : model.state === "failed" ? "the last check failed (see the Protoboard log)" : "", model.at ? `checked ${model.at}` : ""].filter(Boolean).join(" · ") : "";
  return (
    <PartsSurface place="editor" className="bg-transparent!">
      <div className="flex size-full min-w-[260px] flex-col">
        <div role="search" className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-1 pb-1.5">
          <label className={cx(BODY, "flex h-6 min-w-[120px] flex-[1_1_180px] items-center gap-1.5 rounded-[4px] border border-line bg-sunken px-1.5 text-fg-muted focus-within:border-focus focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-focus")}>
            <Icon name="list-filter" size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <input
              type="search"
              value={text}
              placeholder="Filter: code, message, module"
              aria-label="Filter findings"
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setTyping(true);
              }}
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <Segmented label="Severity" options={SEVERITY} value={query.severity} onChange={(severity) => send({ severity })} counts={c ? { all: c.error + c.warning, error: c.error, warning: c.warning } : undefined} />
          <IconButton size="sm" icon="info" label={`${query.info ? "Hide" : "Show"} information findings${c ? ` (${c.info})` : ""}`} pressed={query.info} disabled={query.severity !== "all"} onClick={() => send({ info: !query.info })} />
          <Segmented label="Group by" options={GROUP} value={query.groupBy} onChange={(groupBy) => send({ groupBy })} />
          <IconButton size="sm" icon="refresh-cw" label="Check again (protoboard build)" onClick={actions.refresh} />
        </div>
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-3 pb-3">
          {head && (
            <div className={cx(BODY, "truncate pb-1.5 text-[12px] text-fg-muted")}>
              {head}
              {m && (
                <>
                  {" · "}
                  <b className="font-semibold text-fg">{m.counts.error}</b> blocking · <b className="font-semibold text-fg">{m.counts.warning}</b> warnings · {m.counts.info} info · configured: {m.configured.links}/{m.configured.linksTotal} links, {m.configured.checksRan} checks ran
                  {m.configured.checksSkipped ? `, ${m.configured.checksSkipped} skipped` : ""}
                </>
              )}
            </div>
          )}
          {!model || model.state === "none" ? (
            <Notice>Open a folder with a protoboard.config.ts to see its design-rule findings.</Notice>
          ) : !m ? (
            <Notice>{model.state === "running" ? "Checking the project…" : "No findings yet: run Protoboard: Check."}</Notice>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-3">
              {m.lanes.map((lane) => {
                const flat = lane.groups.length === 1 && query.groupBy !== "rule";
                const row = (f: DrcRowModel) => {
                  const id = `${f.code}|${f.message}`;
                  return (
                    <FindingRow
                      key={f.key}
                      f={f}
                      lane={lane.id}
                      flat={flat}
                      open={expanded.has(id)}
                      actions={actions}
                      onToggle={() => {
                        const next = flip(expanded, id);
                        setExpanded(next);
                        keep(next, collapsed);
                      }}
                    />
                  );
                };
                return (
                  <section key={lane.id} data-lane={lane.id} className="min-w-0">
                    <h2 className={cx("mb-0.5 flex items-center gap-1.5 border-b border-line py-0.5 font-label text-[11px] font-normal tracking-[0.06em] uppercase", LANE[lane.id].tone)}>
                      <Icon name={LANE[lane.id].icon} size={13} strokeWidth={1.75} aria-hidden />
                      <span>{lane.title}</span>
                      <span className="text-fg-muted">{lane.shown === lane.total ? lane.total : `${lane.shown} of ${lane.total}`}</span>
                    </h2>
                    {!lane.groups.length && <div className={cx(BODY, "py-1 text-[12.5px] text-fg-muted italic")}>{lane.total ? "No match." : LANE[lane.id].empty}</div>}
                    {flat
                      ? lane.groups[0].items.map(row)
                      : lane.groups.map((g) => {
                          const gid = `${lane.id}|${g.key}`;
                          const open = !collapsed.has(gid);
                          return (
                            <div key={g.key}>
                              <button
                                type="button"
                                aria-expanded={open}
                                onClick={() => {
                                  const next = flip(collapsed, gid);
                                  setCollapsed(next);
                                  keep(expanded, next);
                                }}
                                className={cx(BODY, "flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-[3px] text-left text-[12.5px] text-fg-muted select-none hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus")}
                              >
                                <Chevron open={open} />
                                <span className="min-w-0 truncate">{g.label}</span>
                                <span className="tabular-nums">{g.items.length}</span>
                              </button>
                              {open && g.items.map(row)}
                            </div>
                          );
                        })}
                  </section>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </PartsSurface>
  );
}

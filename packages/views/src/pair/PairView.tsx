/**
 * The pair view (PB-905): two linked modules side by side, as the website's
 * UHD pair comparator draws them (uhd docs/visualizer-spec.md). Each stored
 * link between them is a band of shared territory across both columns, its
 * pill naming the link, protocol and state; its conductors run straight
 * across, leaf and pin on each side. Below, the pairings DRC would also
 * allow, and every interface of both modules in a census, grouped and
 * filterable, so a part with dozens of pins (an RP2040) stays readable.
 */
import { useMemo, useState } from "react";
import { EmptyState, Icon, IconButton, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { ViewIcon } from "../icons.js";
import type { ViewProps } from "../types.js";
import { Select } from "../ui/Select.js";
import { censusOf, findPair, pairsOf, potentialsOf, type CensusEntry, type LinkState, type Pair, type PairLink, type PairSide } from "./model.js";

const STATE: Record<LinkState, { color: string; label: string }> = {
  configured: { color: "var(--uhd-drc-configured)", label: "configured" },
  partial: { color: "var(--uhd-drc-partial)", label: "partial" },
  incompatible: { color: "var(--uhd-drc-incompatible)", label: "incompatible" },
  unconfigured: { color: "var(--uhd-drc-unconfigured)", label: "not configured" },
};

const soft = (color: string, pct = 8) => `color-mix(in oklab, ${color} ${pct}%, transparent)`;
const roles = (i: { protocols: { type: string; roles: string[] }[] }) => i.protocols.map((p) => `${p.type} · ${p.roles.join("/")}`).join(", ");

export function PairView({ module, bundle, path, host, view, params }: ViewProps) {
  const pairs = useMemo(() => pairsOf(module, bundle, path), [module, bundle, path]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const pair = pairs.find((p) => p.key === picked) ?? findPair(pairs, params) ?? pairs[0];
  const [filter, setFilter] = useState("");

  if (!pair) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<ViewIcon name={view.icon} size={28} strokeWidth={1.25} />} title="Pair">
          {module.name} links no two modules yet.
        </EmptyState>
      </div>
    );
  }
  const childLabel = (child: string) => (child ? (module.children?.find((c) => c.id === child)?.name ?? child) : `${module.name} (boundary)`);
  const census = { a: censusOf(module, pair, "a", childLabel), b: censusOf(module, pair, "b", childLabel) };
  const potentials = potentialsOf(pair);
  const linkId = (l: PairLink) => (path ? `${path}/${l.link.id}` : l.link.id);

  return (
    <div className="pb-pair relative flex size-full min-h-[260px] min-w-[320px] flex-col overflow-hidden bg-canvas text-fg">
      <ScrollArea axis="both" className="min-h-0 flex-1" contentClassName="mx-auto min-w-[560px] max-w-[1180px] px-4 pt-[calc(var(--uhd-inset-top,0px)+14px)] pb-6">
        {pairs.length > 1 && (
          <div className="mb-3 flex items-center gap-2">
            <span className="font-label text-[10px] tracking-[0.1em] text-fg-muted uppercase">Pair</span>
            <Select
              label="Pair"
              tooltip={`${pairs.length} linked pairs on this level`}
              value={pair.key}
              onChange={setPicked}
              options={pairs.map((p) => ({ value: p.key, label: `${p.a.label} ↔ ${p.b.label} · ${p.links.length} link${p.links.length === 1 ? "" : "s"}` }))}
            />
          </div>
        )}

        {/* the two modules, and the verdict between them */}
        <div className="grid grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] items-stretch">
          <ModuleCard side={pair.a} census={census.a} align="left" onSource={host.openSource && (() => host.openSource!({ defId: module.id, instancePath: pair.a.path || undefined }))} />
          <div className="flex flex-col items-center justify-center gap-1 px-1">
            <span className="h-px w-full" style={{ background: STATE[pair.state].color }} />
            <span className="rounded-full border px-2 py-0.5 text-center font-code text-[10px] whitespace-nowrap uppercase" style={{ borderColor: STATE[pair.state].color, color: STATE[pair.state].color }}>
              {pair.links.length} link{pair.links.length === 1 ? "" : "s"}
            </span>
            <span className="font-code text-[10px] tracking-[0.06em] uppercase" style={{ color: STATE[pair.state].color }}>
              {STATE[pair.state].label}
            </span>
          </div>
          <ModuleCard side={pair.b} census={census.b} align="right" onSource={host.openSource && (() => host.openSource!({ defId: module.id, instancePath: pair.b.path || undefined }))} />
        </div>

        <SectionTitle title="Connections" count={pair.links.length} />
        <div className="flex flex-col gap-3">
          {groupsOf(pair.links).map((g) =>
            g.links.length > GROUP_AT ? (
              <GroupBand key={g.protocol} protocol={g.protocol} links={g.links} onSelect={(l) => host.selectionChanged?.({ kind: "link", id: linkId(l), defId: module.id })} />
            ) : (
              g.links.map((l) => (
                <Band key={l.link.id} l={l} onSelect={() => host.selectionChanged?.({ kind: "link", id: linkId(l), defId: module.id })} onSource={host.openSource && (() => host.openSource!({ defId: module.id, instancePath: path || undefined }))} />
              ))
            ),
          )}
        </div>

        {potentials.shown.length > 0 && (
          <>
            <SectionTitle title="Could also connect" count={potentials.shown.length + potentials.hidden} />
            <div className="flex flex-col gap-1.5">
              {potentials.shown.map((p) => (
                <div key={`${p.a}~${p.b}`} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,0.6fr)_minmax(0,1fr)] items-center rounded-panel border border-dashed border-line px-3 py-1.5 font-code text-[11px]">
                  <span className="truncate text-fg">{p.a}</span>
                  <span className="flex items-center gap-1.5 px-2 text-fg-muted">
                    <span className="h-0 flex-1 border-t border-dashed" style={{ borderColor: p.clean ? STATE.configured.color : STATE.partial.color }} />
                    <span className="shrink-0">{p.protocol}</span>
                    <span className="h-0 flex-1 border-t border-dashed" style={{ borderColor: p.clean ? STATE.configured.color : STATE.partial.color }} />
                  </span>
                  <span className="truncate text-right text-fg">{p.b}</span>
                </div>
              ))}
              {potentials.hidden > 0 && <div className="px-1 font-code text-[10px] text-fg-faint">the {potentials.shown.length} cleanest shown · {potentials.hidden} more</div>}
            </div>
          </>
        )}

        <div className="mt-6 mb-2 flex items-center gap-3">
          <h3 className="m-0 font-label text-[11px] font-normal tracking-[0.1em] text-fg-muted uppercase">Every interface</h3>
          <span className="h-px flex-1 bg-line" />
          <label className="flex h-7 w-[min(260px,40%)] items-center gap-1.5 rounded-md border border-line bg-sunken px-2 focus-within:outline focus-within:outline-1 focus-within:outline-focus">
            <Icon name="search" size={13} className="shrink-0 text-fg-faint" aria-hidden />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter interfaces" aria-label="Filter interfaces" className="min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-[12px] text-fg outline-none placeholder:text-fg-faint" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Census entries={census.a} filter={filter} />
          <Census entries={census.b} filter={filter} />
        </div>
      </ScrollArea>
    </div>
  );
}

/** More links of one protocol than this between a pair (a part's pins on a board's nets) draw as one band with a row each. */
const GROUP_AT = 6;

function groupsOf(links: PairLink[]): { protocol: string; links: PairLink[] }[] {
  const by = new Map<string, PairLink[]>();
  for (const l of links) by.set(l.result.protocol, [...(by.get(l.result.protocol) ?? []), l]);
  return [...by].map(([protocol, list]) => ({ protocol, links: list }));
}

/** Many links of one protocol: one band, a row per link, each with its state. */
function GroupBand({ protocol, links, onSelect }: { protocol: string; links: PairLink[]; onSelect: (l: PairLink) => void }) {
  const state = links.some((l) => l.result.state === "incompatible") ? "incompatible" : links.some((l) => l.result.state === "partial") ? "partial" : links.every((l) => l.result.state === "unconfigured") ? "unconfigured" : "configured";
  const s = STATE[state];
  return (
    <section className="relative mt-2 rounded-panel border-[1.5px] px-3 pt-4 pb-2" style={{ borderColor: s.color, background: soft(s.color, 6) }}>
      <div className="absolute -top-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-surface px-2.5 py-0.5 font-code text-[10px] whitespace-nowrap uppercase" style={{ borderColor: s.color, color: s.color }}>
        {protocol} · {links.length} links · {s.label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,0.55fr)_minmax(0,1fr)] items-center gap-y-0.5 font-code text-[11px]">
        {links.map((l) => {
          const c = STATE[l.result.state].color;
          return (
            <div key={l.link.id} className="contents cursor-pointer" onClick={() => onSelect(l)} title={l.link.name ?? l.link.id}>
              <div className="flex min-w-0 items-center justify-end gap-1.5 text-fg">
                <span className="truncate">{l.aIface.name ?? l.aIface.id}</span>
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: c }} />
              </div>
              <div className="relative flex h-5 items-center">
                <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2" style={{ background: c }} />
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-fg">
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: c }} />
                <span className="truncate">{l.bIface.name ?? l.bIface.id}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mt-6 mb-2 flex items-center gap-3">
      <h3 className="m-0 font-label text-[11px] font-normal tracking-[0.1em] text-fg-muted uppercase">
        {title}
        {count !== undefined && <span className="text-fg-faint"> · {count}</span>}
      </h3>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function ModuleCard({ side, census, align, onSource }: { side: PairSide; census: CensusEntry[]; align: "left" | "right"; onSource?: () => void }) {
  const here = census.filter((c) => c.status === "here").length;
  const elsewhere = census.filter((c) => c.status === "elsewhere").length;
  const icon = side.def.display?.icon ?? "box";
  return (
    <div className={cx("flex min-w-0 flex-col gap-1 rounded-panel border border-line bg-surface px-3 py-2.5 shadow-panel outline outline-1 -outline-offset-1 outline-contrast", align === "right" && "items-end text-right")}>
      <div className={cx("flex w-full min-w-0 items-center gap-2", align === "right" && "flex-row-reverse")}>
        <Icon name={icon} size={16} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-label text-[13px] tracking-[0.04em] uppercase">{side.label}</span>
        {onSource && <IconButton icon="file-code" size="sm" label="Open source" onClick={onSource} />}
      </div>
      <div className="w-full truncate text-[11px] text-fg-muted">{side.def.name}</div>
      <div className="w-full truncate font-code text-[10px] text-fg-faint">{side.def.id}</div>
      <div className={cx("mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-code text-[10px] text-fg-muted", align === "right" && "justify-end")}>
        <span>{census.length} interfaces</span>
        <span style={{ color: here ? STATE.configured.color : undefined }}>{here} linked here</span>
        {elsewhere > 0 && <span>{elsewhere} elsewhere</span>}
      </div>
    </div>
  );
}

/** One link as shared territory across both columns. */
function Band({ l, onSelect, onSource }: { l: PairLink; onSelect: () => void; onSource?: () => void }) {
  const s = STATE[l.result.state];
  const name = l.link.name ?? l.link.id;
  const errors = l.result.diagnostics.filter((d) => d.severity !== "info");
  return (
    <section
      className="relative mt-2 rounded-panel border-[1.5px] px-3 pt-4 pb-2.5 outline-offset-2 hover:outline hover:outline-1 hover:outline-dashed hover:outline-contrast-active"
      style={{ borderColor: s.color, background: soft(s.color, 7) }}
      onClick={onSelect}
      aria-label={`${name}: ${l.result.protocol}, ${s.label}`}
    >
      <div className="absolute -top-2.5 left-1/2 flex max-w-[80%] -translate-x-1/2 items-center gap-1 rounded-full border bg-surface px-2.5 py-0.5 font-code text-[10px] whitespace-nowrap uppercase" style={{ borderColor: s.color, color: s.color }}>
        <span className="truncate">{name}</span>
        <span className="opacity-70">· {l.result.protocol} · {s.label}</span>
        {l.link.childLinks && <Icon name="lock" size={10} aria-label="stored conductor map" />}
      </div>
      {onSource && (
        <span className="absolute -top-3.5 right-2 rounded-md bg-surface">
          <IconButton icon="file-code" size="sm" label="Open the link's source" onClick={(e) => (e.stopPropagation(), onSource())} />
        </span>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,0.55fr)_minmax(0,1fr)] items-center gap-y-0.5 font-code text-[11px]">
        <div className="min-w-0 truncate text-fg" title={roles(l.aIface)}>
          {l.aIface.name ?? l.aIface.id} <span className="text-fg-faint">{roles(l.aIface)}</span>
        </div>
        <span className="mx-2 h-[3px] rounded-full" style={{ background: s.color }} />
        <div className="min-w-0 truncate text-right text-fg" title={roles(l.bIface)}>
          <span className="text-fg-faint">{roles(l.bIface)}</span> {l.bIface.name ?? l.bIface.id}
        </div>
        {l.rows.map((r, i) => (
          <Row key={i} r={r} color={s.color} />
        ))}
      </div>
      {errors.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0">
          {errors.map((d, i) => (
            <li key={i} className="flex gap-1.5 text-[11px]" style={{ color: d.severity === "error" ? "var(--uhd-severity-error)" : "var(--uhd-severity-warning)" }}>
              <Icon name={d.severity === "error" ? "circle-x" : "triangle-alert"} size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span className="text-fg-muted">{d.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ r, color }: { r: PairLink["rows"][number]; color: string }) {
  return (
    <>
      <div className="flex min-w-0 items-center justify-end gap-1.5 text-fg-muted">
        <span className="truncate">{r.a}</span>
        {r.aPin && <span className="shrink-0 text-fg-faint">{r.aPin}</span>}
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: color }} />
      </div>
      <div className="relative mx-0 flex h-5 items-center">
        <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2" style={{ background: color }} />
        <span className="relative mx-auto max-w-full truncate rounded-sm bg-surface px-1 text-[9.5px] text-fg-faint">
          {r.a} → {r.b}
          {r.locked && " · locked"}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-fg-muted">
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: color }} />
        {r.bPin && <span className="shrink-0 text-fg-faint">{r.bPin}</span>}
        <span className="truncate">{r.b}</span>
      </div>
    </>
  );
}

const GLYPH: Record<CensusEntry["status"], string> = { here: "circle-dot", elsewhere: "circle-arrow-out-up-right", free: "circle" };

function Census({ entries, filter }: { entries: CensusEntry[]; filter: string }) {
  const q = filter.trim().toLowerCase();
  const shown = q ? entries.filter((e) => `${e.iface.id} ${e.iface.name ?? ""} ${e.group} ${e.others.join(" ")}`.toLowerCase().includes(q)) : entries;
  const groups = new Map<string, CensusEntry[]>();
  for (const e of shown) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
  const rank = (list: CensusEntry[]) => (list.some((e) => e.status === "here") ? 0 : list.some((e) => e.status === "elsewhere") ? 1 : 2);
  const ordered = [...groups].sort((x, y) => rank(x[1]) - rank(y[1]) || x[0].localeCompare(y[0]));
  if (!shown.length) return <div className="rounded-panel border border-line px-3 py-3 text-[11px] text-fg-faint">No interface matches.</div>;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {ordered.map(([group, list]) => (
        <details key={group} open={list.length <= 16 || rank(list) < 2 || Boolean(q)} className="group rounded-panel border border-line bg-surface outline outline-1 -outline-offset-1 outline-contrast">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-label text-[10px] tracking-[0.08em] text-fg-muted uppercase [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={12} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{group}</span>
            <span className="text-fg-faint">{list.length}</span>
          </summary>
          <ul className="m-0 list-none border-t border-line-subtle px-3 py-1">
            {list.map((e) => (
              <li key={e.iface.id} className="flex min-w-0 items-center gap-2 py-0.5 font-code text-[11px]">
                <Icon
                  name={GLYPH[e.status]}
                  size={12}
                  className="shrink-0"
                  style={{ color: e.status === "here" ? STATE[e.state ?? "configured"].color : e.status === "elsewhere" ? "var(--uhd-text-muted)" : "var(--uhd-text-faint)" }}
                  aria-label={e.status === "here" ? "linked to the other module" : e.status === "elsewhere" ? "linked elsewhere" : "not linked"}
                />
                <span className={cx("min-w-0 truncate", e.status === "free" ? "text-fg-muted" : "text-fg")}>{e.iface.name ?? e.iface.id}</span>
                <span className="ml-auto min-w-0 shrink truncate text-right text-[10px] text-fg-faint">{e.status === "elsewhere" ? `→ ${e.others.join(", ")}` : e.iface.protocols.map((p) => p.roles.join("/")).join(", ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

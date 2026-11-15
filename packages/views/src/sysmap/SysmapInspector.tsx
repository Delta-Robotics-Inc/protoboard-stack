/**
 * The System Map's inspector card (right) and its island or type card:
 * built from the same primitives as the Atlas's (Inspector.tsx). An item
 * shows its type, version, status, island and stage, its purpose, the
 * release it last changed in and why, and every link grouped by kind, each
 * a button that selects the item at its other end. An item defined in a
 * file has Open (VS Code: an editor) or, on the web, Copy path.
 */
import { Badge, IconButton, InspectorPanel, PropertyRow, Section, StatusDot, type Tone } from "@deltarobotics/uhd-viewer/components";
import { ITEM_TYPES, type ItemStatus, type SysmapGraph, type SysmapItem } from "@protoboardai/core/sysmap";
import { ActionButton } from "../atlas/Inspector.js";
import type { HostAdapter } from "../types.js";
import type { SysmapData } from "./data.js";
import { STATUS_LABEL, UNRELEASED, linkGroups, sourceFile } from "./model.js";

const STATUS_TONE: Record<ItemStatus, Tone> = { released: "ok", wip: "info", outside: "neutral" };
/** Rows a link group shows before "n more". */
const GROUP_ROWS = 24;
const LONG_NAME = 30;

export interface SysmapInspectorProps {
  item: SysmapItem;
  graph: SysmapGraph;
  data: SysmapData | null;
  host?: HostAdapter;
  onSelect(id: string): void;
  onClose(): void;
  onCollapse?(): void;
  className?: string;
}

export function SysmapInspector({ item, graph, data, host, onSelect, onClose, onCollapse, className }: SysmapInspectorProps) {
  const type = ITEM_TYPES[item.type];
  const island = item.discipline ? graph.islands.find((s) => s.id === item.discipline) : undefined;
  const stage = item.stage !== null ? graph.stages.find((s) => s.n === item.stage) : undefined;
  const groups = linkGroups(graph, item.id);
  const links = groups.reduce((n, g) => n + g.items.length, 0);
  const file = sourceFile(item);
  const problems = graph.problems.filter((p) => p.item === item.id);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => host?.notify?.("Path copied"),
      () => host?.notify?.("The path could not be copied", "warning"),
    );
  };
  const version = item.version ?? (item.status === "wip" ? "Unreleased" : "None");
  return (
    <InspectorPanel
      className={className}
      title={item.name}
      actions={
        <>
          {onCollapse && <IconButton icon="panel-right-close" size="sm" label="Hide the inspector" aria-expanded onClick={onCollapse} />}
          <IconButton icon="x" size="sm" label="Clear the selection" onClick={onClose} />
        </>
      }
    >
      {[...item.name].length > LONG_NAME && <p className="m-0 mt-2 text-[12px] [overflow-wrap:anywhere] text-fg">{item.name}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-pb-sysmap-item={item.id}>
        <Badge tone="neutral">{type.one}</Badge>
        <span className="rounded-[4px] border border-line bg-surface px-1.5 font-code text-[10.5px] leading-[16px] text-fg">{item.version ?? (item.status === "wip" ? UNRELEASED : "no version")}</span>
        <span className="flex items-center gap-1 text-[11px] text-fg-muted">
          <StatusDot tone={STATUS_TONE[item.status]} label={STATUS_LABEL[item.status]} />
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      {item.purpose && <p className="m-0 mt-2 text-[12px] leading-[1.45] text-fg">{item.purpose}</p>}
      {item.detail && item.detail !== item.purpose && <p className="m-0 mt-1.5 text-[11px] leading-[1.45] text-fg-muted">{item.detail}</p>}
      <Section title="About">
        <PropertyRow name="Type" value={type.one} />
        <PropertyRow name="Version" value={version} mono />
        <PropertyRow name="Status" value={STATUS_LABEL[item.status]} />
        <PropertyRow name="Island" value={island?.name ?? "No discipline"} />
        <PropertyRow name="Stage" value={stage ? `${stage.n}. ${stage.title}` : "None"} />
        {item.package && <PropertyRow name="Package" value={item.package} mono />}
        <PropertyRow name="Defined in" value={item.source} mono />
        <PropertyRow name="Links" value={String(links)} />
      </Section>
      <Section title="Changed in">
        {item.changed ? (
          <p className="m-0 text-[11px] leading-[1.45] text-fg" data-pb-sysmap-changed={item.changed.in}>
            <span className="font-code">{item.changed.in === UNRELEASED ? "Unreleased" : item.changed.in}</span>
            {item.changed.date && <span className="text-fg-muted"> ({item.changed.date})</span>}
            <span className="text-fg-muted">: </span>
            {item.changed.why}
            {item.changed.from === "release-notes" && <span className="text-fg-faint"> (release notes)</span>}
          </p>
        ) : (
          <p className="m-0 text-[11px] text-fg-muted">No release history to tell (no release tags where this map was built).</p>
        )}
      </Section>
      {problems.length > 0 && (
        <Section title="Problems" count={problems.length}>
          <ul className="m-0 list-none p-0 text-[11px]">
            {problems.map((p) => (
              <li key={`${p.reason}~${p.message}`} className="py-0.5">
                <span className="font-code text-warning">{p.reason}</span> <span className="text-fg-muted">{p.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {groups.map((g) => (
        <Section key={`${g.kind}~${g.direction}`} title={capitalize(g.label)} count={g.items.length}>
          <ul className="m-0 list-none p-0">
            {g.items.slice(0, GROUP_ROWS).map((m) => (
              <li key={m.id}>
                <ItemRow item={m} onSelect={() => onSelect(m.id)} />
              </li>
            ))}
          </ul>
          {g.items.length > GROUP_ROWS && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{g.items.length - GROUP_ROWS} more</div>}
        </Section>
      ))}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {file && data?.openFile && <ActionButton icon="external-link" label="Open file" onClick={() => data.openFile!(file)} />}
        {file && !data?.openFile && <ActionButton icon="copy" label="Copy path" onClick={() => copy(file)} />}
      </div>
    </InspectorPanel>
  );
}

/** A selected island or type: its name, what it is, and its items. */
export function SysmapGroupCard({ name, summary, items, onSelect, onFit, onClose, onCollapse, className }: { name: string; summary: string; items: readonly SysmapItem[]; onSelect(id: string): void; onFit(): void; onClose(): void; onCollapse?(): void; className?: string }) {
  const shown = items.slice(0, 40);
  return (
    <InspectorPanel
      className={className}
      title={name}
      actions={
        <>
          <IconButton icon="scan" size="sm" label="Fit the group" onClick={onFit} />
          {onCollapse && <IconButton icon="panel-right-close" size="sm" label="Hide the inspector" aria-expanded onClick={onCollapse} />}
          <IconButton icon="x" size="sm" label="Clear the selection" onClick={onClose} />
        </>
      }
    >
      <p className="m-0 mt-2 text-[11px] text-fg-muted">{summary}</p>
      <ul className="m-0 mt-2 list-none p-0">
        {shown.map((m) => (
          <li key={m.id}>
            <ItemRow item={m} onSelect={() => onSelect(m.id)} />
          </li>
        ))}
      </ul>
      {items.length > shown.length && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{items.length - shown.length} more</div>}
    </InspectorPanel>
  );
}

/** One item as a row: its status glyph, its name, its type. */
export function ItemRow({ item, onSelect, aside }: { item: SysmapItem; onSelect(): void; aside?: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-tooltip={item.purpose || item.id}
      data-tooltip-side="left"
      className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-1 py-0.5 text-left text-[11px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
    >
      <StatusGlyph status={item.status} />
      <span className="min-w-0 truncate text-fg">{item.name}</span>
      <span className="ml-auto shrink-0 truncate text-fg-faint">{aside ?? ITEM_TYPES[item.type].one}</span>
    </button>
  );
}

/** A status as the map draws it: a filled hexagon (released), a dashed hollow one (in progress), a solid hollow one (outside). */
export function StatusGlyph({ status, size = 10 }: { status: ItemStatus; size?: number }) {
  const h = size / 2;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = i * (Math.PI / 3) + Math.PI / 6;
    return `${(h + Math.cos(a) * (h - 1)).toFixed(2)},${(h + Math.sin(a) * (h - 1)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-fg-muted">
      <polygon points={pts} fill={status === "released" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={status === "released" ? 0 : 1.2} strokeDasharray={status === "wip" ? "2 1.5" : undefined} />
    </svg>
  );
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

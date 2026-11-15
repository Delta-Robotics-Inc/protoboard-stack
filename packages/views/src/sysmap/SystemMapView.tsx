/**
 * The System Map view (docs/specs/system-map.md, "The view"): what the
 * Protoboard stack can do, every package, extension, skill, operation,
 * check, tool, command, view, template and doc, drawn with the Atlas's
 * renderer (the same engine, simulation, canvas and labels: atlas/engine.ts)
 * on the map the shell gives it (`SysmapDataProvider`, data.ts).
 *
 * - Islands: items pull together by discipline (the renderer's "Folder"
 *   grouping, each item's folder its discipline), with no drawn borders;
 *   each island's name is its title, centered far out, above it closer in.
 *   An island no item resolves to is listed in the side panel, "nothing
 *   here yet", and never drawn.
 * - Nodes: hexagons sized by their links. Released filled; in progress
 *   (wip) hollow and dashed; outside this repository hollow and solid. The
 *   Appearance popover (color by type, each type's color and shape,
 *   presets) is the Atlas's, keyed by item type and kept apart from it
 *   (local storage, `protoboard.sysmap:ui`); it starts in neutral grays.
 * - Labels: the name beside the hexagon with its boxed version chip
 *   ("unreleased" for work in progress), in the Atlas's zoom tiers.
 * - Links: within an island by default; "All links" adds the links across
 *   islands as the muted web; a hovered or selected item's are all drawn
 *   in the accent, with the Atlas's hover timing (shared code).
 * - "Show changes": every item that last changed in the chosen release
 *   (the latest by default) is ringed in the text color, its chip reads
 *   "changed <version>", the rest dims; the side panel lists them with
 *   their one-line why.
 * - The left panel: the title and the stack's boxed version, search,
 *   islands with counts (click flies to the island), types with counts
 *   (click lights them), and the changes. The right: the minimap, then the
 *   inspector (inspector card: SysmapInspector.tsx). Problems the builder
 *   found sit at the top, as the Atlas's stale notice does.
 * - Node positions are the person's own (local storage,
 *   `protoboard.sysmap:layout`), the camera per tab (session storage); the
 *   opening intro and the minimap come with the engine. No time-lapse.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EmptyState, HIERARCHY_LOOK, Icon, IconButton, Legend, LegendItem, Toolbar, ToolbarSeparator, canvasCommand, cx, token } from "@deltarobotics/uhd-viewer/components";
import { ITEM_TYPES, type SysmapGraph, type SysmapItem } from "@protoboardai/core/sysmap";
import { ViewIcon } from "../icons.js";
import type { HostAdapter, ViewProps } from "../types.js";
import { AppearancePopover, LEGEND_SHAPE, kindCss } from "../atlas/AppearancePopover.js";
import { kindColor, kindShape } from "../atlas/appearance.js";
import { panBy, ZOOM } from "../atlas/camera.js";
import { MINIMAP, groupMembers, matches } from "../atlas/draw.js";
import { AtlasEngine, CARD, REOPEN, SAVE_DELAY_MS, TIP_DELAY_MS, TOP, readSession, useAtlasPalette, writeSession } from "../atlas/engine.js";
import { readUi, writeUi, type AtlasUi } from "../atlas/settings.js";
import { useSysmapData, type SysmapData, type SysmapPayload } from "./data.js";
import { SYSMAP_KEYS, SYSMAP_KIND_TABLE, SYSMAP_PRESET_OPTIONS, changedIn, defaultRelease, islandRows, parsePositions, releaseOptions, sysmapMapGraph, sysmapSpec, typeRows, type SysmapNode } from "./model.js";
import { ItemRow, StatusGlyph, SysmapGroupCard, SysmapInspector } from "./SysmapInspector.js";

/** The view's tab id (tabs.ts). */
export const SYSMAP_VIEW = "sysmap";
/** The session's name for the camera (`readSession`). */
const SESSION = "sysmap";

/** The System Map tab. */
export function SystemMapView({ host, view }: ViewProps) {
  const data = useSysmapData();
  if (!data) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<ViewIcon name={view.icon} size={28} strokeWidth={1.25} />} title={view.title}>
          The System Map needs the dev server (<span className="cmd">protoboard dev</span>) or the VS Code extension. In a terminal, <span className="cmd">protoboard map</span> prints it.
        </EmptyState>
      </div>
    );
  }
  return <SystemMap data={data} host={host} />;
}

export interface SystemMapProps {
  data: SysmapData;
  /** For notices (a copied path); a page without a viewer shell may leave it out. */
  host?: HostAdapter;
}

/** The System Map on a page of its own (the VS Code panel) or in a tab: loads the map, then draws it. */
export function SystemMap({ data, host }: SystemMapProps) {
  const [payload, setPayload] = useState<SysmapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      data.load().then(
        (p) => {
          if (!live) return;
          setPayload(p);
          setError(null);
        },
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    void load();
    const off = data.subscribe?.(() => void load());
    return () => {
      live = false;
      off?.();
    };
  }, [data]);

  if (!payload) {
    return (
      <div className="grid size-full place-items-center bg-canvas" aria-busy={!error}>
        <EmptyState icon={<Icon name={error ? "file-x" : "loader"} size={24} strokeWidth={1.25} className={error ? undefined : "motion-safe:animate-spin"} />} title={error ? "No System Map" : "Building the System Map"}>
          {error ?? "Reading the stack's packages, manifests, skills and release history (a few seconds)."}
        </EmptyState>
      </div>
    );
  }
  if (!payload.graph.items.length) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<Icon name="map" size={28} strokeWidth={1.25} />} title="System Map">
          The map holds nothing: {payload.graph.problems[0]?.message ?? "no stack was found where it was built."}
        </EmptyState>
      </div>
    );
  }
  return <SysmapCanvas graph={payload.graph} data={data} host={host} />;
}

function readPositions(): Record<string, [number, number]> | undefined {
  try {
    return parsePositions(globalThis.localStorage?.getItem(SYSMAP_KEYS.layout));
  } catch {
    return undefined;
  }
}

function writePositions(positions: Record<string, [number, number]>) {
  try {
    globalThis.localStorage?.setItem(SYSMAP_KEYS.layout, JSON.stringify({ positions }));
  } catch {
    // storage refused: the layout holds for this visit
  }
}

function SysmapCanvas({ graph, data, host }: { graph: SysmapGraph; data: SysmapData; host?: HostAdapter }) {
  const session = useMemo(() => readSession(SESSION, SYSMAP_KEYS.session), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ui, setUiState] = useState<AtlasUi>(() => readUi(SYSMAP_KEYS.ui, SYSMAP_KIND_TABLE));
  const releases = useMemo(() => releaseOptions(graph), [graph]);
  const [changes, setChanges] = useState(false);
  const [release, setRelease] = useState<string | null>(() => defaultRelease(releases));
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [groupTip, setGroupTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const helpId = useId();
  const panelId = useId();
  const palette = useAtlasPalette(rootEl, ui.appearance, SYSMAP_KIND_TABLE);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceButton = useRef<HTMLButtonElement | null>(null);
  const appearancePop = useRef<HTMLDivElement | null>(null);
  const setUi = (patch: Partial<AtlasUi>) =>
    setUiState((u) => {
      const next = { ...u, ...patch };
      writeUi(next, SYSMAP_KEYS.ui);
      return next;
    });
  // a release the map no longer has (a rebuild): the latest again
  const shownRelease = release && releases.some((r) => r.version === release) ? release : defaultRelease(releases);
  const marking = changes ? shownRelease : null;

  const spec = useMemo(() => sysmapSpec(graph), [graph]);
  const mapGraph = useMemo(() => sysmapMapGraph(graph, marking), [graph, marking]);
  const byId = useMemo(() => new Map(graph.items.map((i) => [i.id, i])), [graph]);
  const changed = useMemo(() => changedIn(graph, marking), [graph, marking]);

  const savedRef = useRef(readPositions());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const engineRef = useRef<AtlasEngine | null>(null);
  const saveNow = () => {
    saveTimer.current = undefined;
    const sim = engineRef.current?.sim;
    if (!engineRef.current || !sim || sim.active) return;
    const positions = sim.positions();
    engineRef.current.changed = false;
    writePositions(positions);
    savedRef.current = positions;
  };
  const engine = (engineRef.current ??= new AtlasEngine({
    pick: (id) => {
      setSelected(id);
      setGroup(null);
      const e = engineRef.current;
      if (!e) return;
      e.cardOpen = id !== null;
      const i = id === null ? undefined : e.sim?.indexOf(id);
      if (i !== undefined) e.revealSoon(i);
    },
    pickGroup: (key) => {
      setGroup(key);
      setSelected(null);
    },
    settled: () => {
      const e = engineRef.current;
      const sim = e?.sim;
      if (!e || !sim || !e.changed) return;
      if (!sim.changedSince(savedRef.current, 1)) {
        e.changed = false;
        return;
      }
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, SAVE_DELAY_MS);
    },
    idle: () => {
      const e = engineRef.current;
      if (e) writeSession(SESSION, { pullBy: "folder", cam: { x: e.cam.tx, y: e.cam.ty, k: e.cam.tk } }, SYSMAP_KEYS.session);
    },
    playbackTick: () => {},
    playbackChanged: () => {},
    groupTip: (tip) => {
      clearTimeout(tipTimer.current);
      if (!tip) setGroupTip(null);
      else tipTimer.current = setTimeout(() => setGroupTip(tip), TIP_DELAY_MS);
    },
  }));
  engine.spec = spec;

  useLayoutEffect(() => {
    if (!rootEl) return;
    const measure = () => {
      engine.insetTop = parseFloat(getComputedStyle(rootEl).getPropertyValue("--uhd-inset-top")) || 0;
      engine.resize(rootEl.clientWidth, rootEl.clientHeight, globalThis.devicePixelRatio || 1);
      measureFloats();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rootEl);
    return () => ro.disconnect();
  }, [rootEl, engine]);

  /** What floats over the canvas: label boxes keep off it, fits keep clear of it (as the Atlas measures). */
  const measureFloats = () => {
    if (!rootEl) return;
    const base = rootEl.getBoundingClientRect();
    const reserved: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const f = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-pb-atlas-float]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const box = { x0: r.left - base.left - 4, y0: r.top - base.top - 4, x1: r.right - base.left + 4, y1: r.bottom - base.top + 4 };
      reserved.push(box);
      const side = el.dataset.pbAtlasFloat;
      if (side === "left") f.left = Math.max(f.left, box.x1);
      else if (side === "right") f.right = Math.max(f.right, engine.w - box.x0);
      else if (side === "top") f.top = Math.max(f.top, box.y1);
      else if (side === "bottom") f.bottom = Math.max(f.bottom, engine.h - box.y0);
    }
    engine.reserved = reserved;
    if (engine.s) engine.s.reserved = reserved;
    engine.floats = f;
    engine.wake();
  };
  useLayoutEffect(measureFloats);

  // the map: the first, a rebuild's, or the same with other chips (Show changes): the same items and links change nothing on the map
  useLayoutEffect(() => {
    if (!rootEl) return;
    const first = !engine.sim;
    if (first && session?.cam) Object.assign(engine.cam, { x: session.cam.x, y: session.cam.y, k: session.cam.k, tx: session.cam.x, ty: session.cam.y, tk: session.cam.k });
    if (first) {
      measureFloats();
      engine.allLinks = ui.allLinks;
    }
    engine.load(mapGraph, savedRef.current, "folder", !first || !!session?.cam);
    rerender();
  }, [mapGraph, rootEl, engine]);

  // the changed items, ringed (after the map is loaded: a new simulation starts unmarked)
  useLayoutEffect(() => {
    engine.setMark(marking ? new Set(changed.map((c) => c.item.id)) : null);
  }, [engine, marking, changed, mapGraph, rootEl]);

  useEffect(() => {
    engine.palette = palette;
    if (engine.s) engine.s.highContrast = palette.highContrast;
    engine.wake();
  }, [palette, engine]);

  useEffect(() => {
    engine.allLinks = ui.allLinks;
    engine.wake();
  }, [ui.allLinks, engine]);

  useEffect(() => {
    if (!appearanceOpen) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!appearancePop.current?.contains(t) && !appearanceButton.current?.contains(t)) setAppearanceOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [appearanceOpen]);

  useEffect(() => {
    const { sim, s } = engine;
    if (!sim || !s) return;
    const index = selected === null ? null : (sim.indexOf(selected) ?? null);
    if (selected !== null && index === null) setSelected(null);
    s.selected = index;
    s.group = group;
    s.query = query;
    engine.cardOpen = ui.right && (index !== null || group !== null);
    engine.wake();
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => engine.wheel(e);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [engine, rootEl]);
  const canvasCallback = useMemo(
    () => (c: HTMLCanvasElement | null) => {
      canvasRef.current = c;
      engine.canvas = c;
      if (c) engine.resize(engine.w, engine.h, engine.dpr);
    },
    [engine],
  );
  const miniCallback = useMemo(
    () => (c: HTMLCanvasElement | null) => {
      engine.mini = c;
      engine.sizeMini();
      engine.wake();
    },
    [engine],
  );
  useEffect(
    () => () => {
      engine.stop();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveNow();
      }
      writeSession(SESSION, { pullBy: "folder", cam: { x: engine.cam.tx, y: engine.cam.ty, k: engine.cam.tk } }, SYSMAP_KEYS.session);
    },
    [engine],
  );

  const sim = engine.sim;
  const islands = useMemo(() => islandRows(graph), [graph]);
  const types = useMemo(() => typeRows(graph), [graph]);
  const results = useMemo(() => (query.trim() ? mapGraph.nodes.filter((n) => matches(n, query, spec)) : []), [mapGraph, query, spec]);
  const summary = `System Map of the Protoboard stack ${graph.stack}: ${graph.items.length} items and ${graph.links.length} links in ${islands.filter((i) => !i.empty).length} islands. ${islands
    .filter((i) => !i.empty)
    .map((i) => `${i.name}: ${i.count}`)
    .join(", ")}.`;

  const select = (id: string | null, fit = false) => {
    setSelected(id);
    setGroup(null);
    engine.cardOpen = ui.right && id !== null;
    const i = id === null ? undefined : sim?.indexOf(id);
    if (fit && i !== undefined) engine.fitNode(i);
  };
  const selectGroup = (key: string | null, fly = false) => {
    setGroup(key);
    setSelected(null);
    engine.cardOpen = ui.right && key !== null;
    if (key && fly) engine.fitGroup(key);
    else if (!key) engine.fitAll();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true']")) return;
    const c = canvasCommand(e);
    if (!c) return;
    switch (c.type) {
      case "fit":
        engine.fitAll();
        break;
      case "zoom":
        engine.zoom(c.by === "reset" ? "reset" : c.by === "in" ? ZOOM.step : 1 / ZOOM.step);
        break;
      case "nudge":
        if (t !== canvasRef.current) return;
        panBy(engine.cam, -c.dx * 2, -c.dy * 2);
        engine.wake();
        break;
      case "escape":
        if (!selected && !group) return;
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const item = selected !== null ? byId.get(selected) : undefined;
  const members: SysmapItem[] = group && sim ? groupMembers(sim, group).map((i) => (sim.source[i] as SysmapNode).item) : [];
  const groupIsland = group?.startsWith("folder:") ? islands.find((s) => `folder:${s.id}` === group) : undefined;
  const groupType = group?.startsWith("kind:") ? types.find((t) => `kind:${t.type}` === group) : undefined;
  const card = "pointer-events-auto min-h-0 w-full";
  const hasCard = !!item || !!group;
  const problems = graph.problems;

  return (
    <div ref={setRootEl} className="pb-atlas pb-sysmap relative size-full min-h-[240px] min-w-[300px] overflow-hidden bg-canvas text-fg" onKeyDown={onKeyDown} data-pb-sysmap={changes ? "changes" : "map"}>
      <canvas
        ref={canvasCallback}
        role="img"
        aria-label={summary}
        aria-describedby={helpId}
        tabIndex={0}
        className="absolute inset-0 size-full cursor-grab touch-none select-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        onPointerDown={(e) => engine.pointerDown(e)}
        onPointerMove={(e) => engine.pointerMove(e)}
        onPointerUp={(e) => engine.pointerUp(e)}
        onPointerCancel={(e) => engine.pointerUp(e)}
        onPointerLeave={() => engine.pointerLeave()}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const hit = engine.doubleClick(e);
          if (hit.node) select(hit.node);
          else if (hit.group) selectGroup(hit.group);
        }}
      />
      <p id={helpId} className="sr-only">
        Drag an item to move it, drag the map (or use the right or middle button anywhere) to pan, use the wheel to zoom. Keys: F fits, plus and minus zoom, 0 goes back to 100 percent, the arrows pan, Escape clears the selection. Search to find an item by name, purpose or type; the side panel lists the islands, the types and, with Show changes on, what changed in a release.
      </p>

      {groupTip && (
        <div
          role="tooltip"
          className="uhd-tooltip pointer-events-none absolute z-[1000] rounded-md border border-line bg-raised px-2 py-1 font-ui text-[11px] leading-4 whitespace-nowrap text-fg shadow-float outline outline-1 -outline-offset-1 outline-contrast select-none"
          style={{ left: groupTip.x, top: groupTip.y, transform: "translate(-50%, -100%)" }}
        >
          {groupTip.text}
        </div>
      )}

      {ui.left ? (
        <div id={panelId} data-pb-atlas-float="left" className={cx("absolute bottom-[50px] left-1 flex w-[min(320px,calc(100%-8px))] flex-col gap-1", TOP)}>
          <div className={cx("flex shrink-0 flex-col gap-2 px-3 py-2", CARD)}>
            <div className="flex items-center gap-2">
              <Icon name="map" size={15} className="shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-label text-[12px] tracking-[0.06em] uppercase">System Map</span>
                  <span className="shrink-0 rounded-[4px] border border-line bg-surface px-1.5 font-code text-[10px] leading-[15px] text-fg-muted" data-tooltip={`Built by the Protoboard stack ${graph.stack} (${graph.layout === "monorepo" ? "its repository" : "an installed copy"})`} data-tooltip-side="bottom">
                    {graph.stack}
                  </span>
                </div>
                <div className="truncate text-[11px] text-fg-muted">
                  {graph.items.length} items, {graph.links.length} links
                </div>
              </div>
              {data.refresh && <IconButton icon="refresh-cw" size="sm" label="Build the map again" tooltipSide="bottom" onClick={() => data.refresh!()} />}
              <IconButton icon="panel-left-close" size="sm" label="Hide the System Map panel" aria-expanded aria-controls={panelId} onClick={() => setUi({ left: false })} />
            </div>
            <label className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-sunken px-2 focus-within:outline focus-within:outline-1 focus-within:outline-focus">
              <Icon name="search" size={13} className="shrink-0 text-fg-faint" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) select(results[0].id, true);
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Find a skill, a command, a tool"
                aria-label="Find in the System Map"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-[12px] text-fg outline-none placeholder:text-fg-faint"
              />
            </label>
            {query.trim() && (
              <div role="region" aria-label="Search results" aria-live="polite" className="max-h-[220px] overflow-y-auto">
                <div className="pb-1 text-[10.5px] text-fg-faint">{results.length ? `${results.length} found` : "Nothing found"}</div>
                <ul className="m-0 list-none p-0">
                  {results.slice(0, 8).map((n) => (
                    <li key={n.id}>
                      <ItemRow item={n.item} onSelect={() => select(n.id, true)} />
                    </li>
                  ))}
                </ul>
                {results.length > 8 && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{results.length - 8} more: type more of the name</div>}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {/* with Show changes on, what changed comes first */}
            {changes && (
              <Legend title="What changed">
                <label className="flex items-center gap-2 pb-1 text-[11px] text-fg-muted">
                  <span className="shrink-0">In</span>
                  <select
                    value={shownRelease ?? ""}
                    aria-label="The release whose changes are marked"
                    onChange={(e) => setRelease(e.target.value)}
                    className="h-6 min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-sunken px-1 font-ui text-[11px] text-fg outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus"
                  >
                    {releases.map((r) => (
                      <option key={r.version} value={r.version}>
                        {r.label}
                        {r.date ? ` · ${r.date}` : ""} · {r.count}
                      </option>
                    ))}
                  </select>
                </label>
                {changed.length ? (
                  <ul className="m-0 list-none p-0" aria-label="Changed items">
                    {changed.map(({ item: c, why }) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => select(c.id, true)}
                          data-tooltip={why}
                          data-tooltip-side="right"
                          className="flex w-full cursor-pointer flex-col gap-0 rounded-sm border-0 bg-transparent px-1 py-[3px] text-left hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
                        >
                          <span className="flex w-full items-center gap-2 text-[11px]">
                            <StatusGlyph status={c.status} size={9} />
                            <span className="min-w-0 truncate text-fg">{c.name}</span>
                            <span className="ml-auto shrink-0 text-fg-faint">{ITEM_TYPES[c.type].one}</span>
                          </span>
                          <span className="truncate pl-[17px] text-[10.5px] text-fg-muted">{why}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[11px] text-fg-muted">{releases.length ? "Nothing changed in this release." : "The map has no release history (built without git or release tags)."}</p>
                )}
              </Legend>
            )}
            <Legend title="Islands">
              <p className="m-0 pb-1 text-[10.5px] leading-[1.4] text-fg-muted">Click an island to fly to it. Filled: released; dashed: in progress; hollow: outside this repository.</p>
              {islands.map((s) =>
                s.empty ? (
                  <div key={s.id} className="flex items-center gap-2 px-1 py-[3px] text-[11px] text-fg-faint" data-tooltip={s.note ?? s.gloss} data-tooltip-side="right" data-pb-sysmap-island={s.id} data-empty>
                    <span aria-hidden className="size-[9px] shrink-0 border border-dashed border-line [clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)]" />
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="ml-auto shrink-0 italic">nothing here yet</span>
                  </div>
                ) : (
                  <button
                    key={s.id}
                    type="button"
                    data-pb-sysmap-island={s.id}
                    aria-pressed={group === `folder:${s.id}`}
                    data-tooltip={s.gloss}
                    data-tooltip-side="right"
                    onClick={() => (group === `folder:${s.id}` ? selectGroup(null) : selectGroup(`folder:${s.id}`, true))}
                    className={cx(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-1 py-[3px] text-left text-[11px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
                      group === `folder:${s.id}` && "bg-accent-tint",
                    )}
                  >
                    <StatusGlyph status="released" size={9} />
                    <span className="min-w-0 truncate text-fg">{s.name}</span>
                    <span className="ml-auto shrink-0 font-code text-fg-muted">{s.count}</span>
                  </button>
                ),
              )}
            </Legend>

            <Legend title="Types" className="max-[520px]:hidden">
              {types.map((t) => (
                <div key={t.type} className={cx("-mr-3 flex flex-col pr-3", LEGEND_SHAPE[kindShape(ui.appearance, t.type, SYSMAP_KIND_TABLE)])} data-tooltip={`Light every ${ITEM_TYPES[t.type].one.toLowerCase()}`} data-tooltip-side="right">
                  <LegendItem
                    shape="dot"
                    color={ui.appearance.colorByType ? kindCss(kindColor(ui.appearance, t.type, SYSMAP_KIND_TABLE)) : token("textFaint")}
                    label={`${t.label} · ${t.count}`}
                    pressed={group === `kind:${t.type}`}
                    dimmed={!!group && group !== `kind:${t.type}`}
                    onSelect={() => {
                      const key = `kind:${t.type}`;
                      if (group === key) return selectGroup(null);
                      selectGroup(key);
                      engine.fitAll();
                    }}
                  />
                </div>
              ))}
            </Legend>

            {!changes && (
              <div className="rounded-md border border-dashed border-line bg-surface px-2.5 py-2 text-[11px] leading-[1.45] text-fg-muted max-[520px]:hidden">
                Turn on <span className="text-fg">Show changes</span> to mark every item that changed in a release, with its version.
              </div>
            )}
          </div>
        </div>
      ) : (
        <button type="button" aria-label="Show the System Map panel" aria-expanded={false} data-tooltip="Show the System Map panel" data-tooltip-side="right" onClick={() => setUi({ left: true })} className={HIERARCHY_LOOK.folded}>
          <Icon name="panel-left-open" size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      {/* the builder's problems, where the Atlas says its index is stale */}
      {problems.length > 0 && (
        <div role="status" data-pb-atlas-float="top" className={cx("absolute left-1/2 flex max-h-[50%] w-max max-w-[min(520px,calc(100%-8px))] -translate-x-1/2 flex-col text-[11.5px] max-[860px]:top-auto max-[860px]:bottom-[52px]", CARD, TOP)}>
          <button type="button" aria-expanded={problemsOpen} onClick={() => setProblemsOpen((o) => !o)} className="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-fg">
            <Icon name="triangle-alert" size={13} className="shrink-0 text-warning" aria-hidden />
            {problems.length} {problems.length === 1 ? "problem" : "problems"} in the map: {problems[0]!.reason.toLowerCase().replace(/_/g, " ")}
            {problems.length > 1 ? " and more" : ""}
            <Icon name={problemsOpen ? "chevron-up" : "chevron-down"} size={13} className="ml-auto shrink-0 text-fg-muted" aria-hidden />
          </button>
          {problemsOpen && (
            <ul className="m-0 min-h-0 list-none overflow-y-auto border-t border-line px-3 py-1.5" aria-label="Problems">
              {problems.map((p) => (
                <li key={`${p.reason}~${p.item ?? p.path ?? ""}~${p.message}`} className="py-0.5 text-[11px]">
                  <span className="font-code text-warning">{p.reason}</span>{" "}
                  {p.item && byId.has(p.item) ? (
                    <button type="button" onClick={() => select(p.item!, true)} className="cursor-pointer border-0 bg-transparent p-0 font-code text-[11px] text-fg underline decoration-line underline-offset-2 hover:text-accent">
                      {byId.get(p.item)!.name}
                    </button>
                  ) : p.path ? (
                    <span className="font-code text-fg">{p.path}</span>
                  ) : null}
                  <span className="text-fg-muted"> {p.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={cx("pointer-events-none absolute right-1 bottom-[50px] flex w-[min(300px,calc(100%-8px))] flex-col items-end gap-1", TOP)}>
        {ui.minimap && (
          <div data-pb-atlas-float="corner" className={cx("pointer-events-auto shrink-0 overflow-hidden", CARD)} style={{ width: MINIMAP.w + 2, height: MINIMAP.h + 2 }}>
            <canvas ref={miniCallback} aria-hidden className="block" style={{ width: MINIMAP.w, height: MINIMAP.h }} />
          </div>
        )}
        {ui.right ? (
          <>
            {item && (
              <div data-pb-atlas-float="right" className={cx(card, "flex flex-col")}>
                <SysmapInspector className="max-h-full" item={item} graph={graph} data={data} host={host} onSelect={(id) => select(id, true)} onClose={() => select(null)} onCollapse={() => setUi({ right: false })} />
              </div>
            )}
            {!item && group && (
              <div data-pb-atlas-float="right" className={cx(card, "flex flex-col")}>
                <SysmapGroupCard
                  className="max-h-full"
                  name={groupIsland?.name ?? groupType?.label ?? spec.groupName(group)}
                  summary={groupIsland ? `${groupIsland.gloss}. ${members.length} items.` : `${members.length} items, across the islands.`}
                  items={members}
                  onSelect={(id) => select(id, true)}
                  onFit={() => engine.fitGroup(group)}
                  onClose={() => selectGroup(null)}
                  onCollapse={() => setUi({ right: false })}
                />
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            aria-label={hasCard ? "Show the inspector" : "Show the inspector (nothing is selected)"}
            aria-expanded={false}
            data-tooltip="Show the inspector"
            data-tooltip-side="left"
            data-pb-atlas-float="right"
            onClick={() => setUi({ right: true })}
            className={cx("pointer-events-auto", REOPEN, hasCard && "text-accent")}
          >
            <Icon name="panel-right-open" size={16} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {appearanceOpen && (
        <div ref={appearancePop} data-pb-atlas-float="over" className="absolute bottom-[48px] left-1/2 z-20 max-w-[calc(100%-8px)] -translate-x-1/2">
          <AppearancePopover
            appearance={ui.appearance}
            onChange={(appearance) => setUi({ appearance })}
            kinds={types.map((t) => t.type)}
            resolved={palette.kinds}
            table={SYSMAP_KIND_TABLE}
            kindName={(k) => ITEM_TYPES[k as keyof typeof ITEM_TYPES]?.label ?? k}
            presets={SYSMAP_PRESET_OPTIONS}
            onClose={() => {
              setAppearanceOpen(false);
              appearanceButton.current?.focus();
            }}
          />
        </div>
      )}

      {/* centered at the bottom, as every Protoboard view's toolbar; the strip beside it stays the canvas's */}
      <div className="pointer-events-none absolute right-0 bottom-1 left-0 flex justify-center px-1">
        <div data-pb-atlas-float="bottom" className="pointer-events-auto max-w-full">
        <Toolbar label="System Map tools" className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <IconButton icon="maximize" label="Fit" shortcut="F" tooltipSide="top" onClick={() => engine.fitAll()} />
          <IconButton icon="zoom-in" label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => engine.zoom(ZOOM.step)} />
          <IconButton icon="zoom-out" label="Zoom out" shortcut="-" tooltipSide="top" onClick={() => engine.zoom(1 / ZOOM.step)} />
          <ToolbarSeparator />
          <IconButton icon="wind" label="Shake the layout" tooltipSide="top" onClick={() => engine.shake()} />
          <IconButton icon="map" label={ui.minimap ? "Hide the minimap" : "Show the minimap"} pressed={ui.minimap} tooltipSide="top" onClick={() => setUi({ minimap: !ui.minimap })} />
          <IconButton
            icon="network"
            label="All links"
            pressed={ui.allLinks}
            data-tooltip={ui.allLinks ? "All links: on, the links across islands drawn too (click to show only the links within each island)" : "All links: off, only the links within each island (click to add the links across islands)"}
            tooltipSide="top"
            onClick={() => setUi({ allLinks: !ui.allLinks })}
          />
          <IconButton
            icon="file-diff"
            label="Show changes"
            pressed={changes}
            disabled={!releases.length}
            data-tooltip={releases.length ? (changes ? "Show changes: on, the items that changed in the chosen release ringed" : "Show changes: mark every item that changed in a release") : "Show changes: the map has no release history"}
            tooltipSide="top"
            onClick={() => {
              setChanges((c) => !c);
              setUi({ left: true });
            }}
          />
          <IconButton
            ref={appearanceButton}
            icon="palette"
            label="Appearance: colors and shapes"
            aria-haspopup="dialog"
            aria-expanded={appearanceOpen}
            tooltipSide="top"
            onClick={() => setAppearanceOpen((o) => !o)}
            className={cx(appearanceOpen && "bg-active text-fg")}
          />
        </Toolbar>
        </div>
      </div>
    </div>
  );
}

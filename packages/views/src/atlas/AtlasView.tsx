/**
 * The Atlas view: every artifact of the project and how it connects, drawn
 * as a force-directed map on a canvas (sim.ts lays it out, draw.ts draws
 * it), with HTML controls and an inspector over it. The shell gives it its
 * data through `AtlasDataProvider` (data.ts); without one (a static page)
 * it says what it needs.
 *
 * One graph, one simulation for the life of the view. Switching what pulls
 * nodes together (Links, Kind, Folder) blends the forces and lets the nodes
 * drift into their new groups; a rebuild of the index with the same graph
 * changes nothing on the map, and one that adds or removes nodes keeps
 * every other node where it is. Saving positions never feeds back into it:
 * a save only writes the display file.
 *
 * Interactions: drag a node to move it (the layout follows once the press
 * has moved past a few pixels: a click never wakes the layout); on release
 * the node is let go where it is and the physics eases everything back to
 * rest. Drag the empty canvas with the left button, or anywhere with the
 * right or middle button, to pan (a pan let go while moving flings on);
 * the wheel zooms about the pointer with a little inertia. Click to select
 * a node (it slides clear of the inspector when it would sit under it) or a
 * group title, double-click to fit a node with its neighbors (or a group).
 * Keys on the map: F fits, + and - zoom, 0 goes back to 100 %, the arrows
 * pan, Escape clears the selection (or leaves the time-lapse).
 *
 * On open the map grows from its center to its saved layout (or settles
 * freely when there is none) in about two seconds. Animations always play,
 * whatever the system's reduced-motion setting, and there is no switch for
 * them: the opening, the camera's glides, the hover highlight's fade, and
 * the physics answering a drag or a change of grouping.
 *
 * The left panel (search, grouping, kinds) and the right one (the
 * inspector) fold away and come back; the minimap shows or hides; "All
 * links" adds the non-core links; the Appearance popover sets each kind's
 * color and shape; all of it is remembered per person (local storage,
 * settings.ts), never in the project. The time-lapse ("Animate") replays how the
 * project grew from the creation times the index records (timeline.ts,
 * timelapse.ts): nodes arrive one after another, live in the physics; nothing is saved
 * while it plays, and leaving it glides the map back to where it was.
 *
 * The simulation, camera and canvas live in refs (an `AtlasEngine`): a
 * frame never re-renders React. The animation loop is one chain of frames
 * (a frame never schedules a second one), and it stops once the layout has
 * cooled and nothing eases.
 *
 * Positions are saved through the data (`saveLayout`, display.json's
 * `atlas.positions`) 800 ms after a settle that followed new nodes, a drag,
 * a shake or a change of grouping, when they changed by more than a unit.
 * The grouping and the camera are kept per tab (session storage).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { UhdBundle } from "@deltarobotics/uhd";
import { EmptyState, HIERARCHY_LOOK, Icon, IconButton, Legend, LegendItem, ToggleGroup, Toolbar, ToolbarSeparator, canvasCommand, cx, token } from "@deltarobotics/uhd-viewer/components";
import { ATLAS_KINDS, ATLAS_KIND_ORDER, type AtlasNode, type EdgeType } from "@protoboardai/core/atlas";
import { ViewIcon } from "../icons.js";
import type { HostAdapter, ViewProps } from "../types.js";
import { panBy, ZOOM } from "./camera.js";
import { staleMessage, useAtlasData, type AtlasData, type AtlasPayload, type PullBy } from "./data.js";
import { AppearancePopover, LEGEND_SHAPE, kindCss } from "./AppearancePopover.js";
import { kindColor, kindShape } from "./appearance.js";
import { MINIMAP, groupMembers, groupName, isLooseFile, matches } from "./draw.js";
import { AtlasEngine, CARD, REOPEN, SAVE_DELAY_MS, TIP_DELAY_MS, TOP, readSession, useAtlasPalette, writeSession, type PlaybackState } from "./engine.js";
import { AtlasGroupCard, AtlasInspector } from "./Inspector.js";
import { readUi, writeUi, type AtlasUi } from "./settings.js";
import type { LabelBox } from "./labels.js";
import type { AtlasSimulation } from "./sim.js";
import { TIMELAPSE_SPEEDS, buildTimeline, formatDay, type TimelapseSpeed } from "./timeline.js";

export type { PlaybackState } from "./engine.js";

/** The Atlas tab. */
export function AtlasView({ host, view, bundle }: ViewProps) {
  const data = useAtlasData();
  if (!data) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<ViewIcon name={view.icon} size={28} strokeWidth={1.25} />} title={view.title}>
          The Atlas needs the dev server (<span className="cmd">protoboard dev</span>) or the VS Code extension.
        </EmptyState>
      </div>
    );
  }
  return <AtlasLoader data={data} host={host} bundle={bundle} icon={view.icon} title={view.title} />;
}

function AtlasLoader({ data, host, bundle, icon, title }: { data: AtlasData; host: HostAdapter; bundle?: UhdBundle; icon: string; title: string }) {
  const [payload, setPayload] = useState<AtlasPayload | null>(null);
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
        <EmptyState icon={<Icon name={error ? "file-x" : "loader"} size={24} strokeWidth={1.25} className={error ? undefined : "motion-safe:animate-spin"} />} title={error ? "No Atlas yet" : "Loading the Atlas"}>
          {error ?? undefined}
        </EmptyState>
      </div>
    );
  }
  if (!payload.graph.nodes.length) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<ViewIcon name={icon} size={28} strokeWidth={1.25} />} title={title}>
          The index holds nothing yet. Run <span className="cmd">protoboard build</span> to index the project.
        </EmptyState>
      </div>
    );
  }
  return <AtlasMap payload={payload} data={data} host={host} bundle={bundle} />;
}

const PULL_OPTIONS = [
  { id: "links", icon: "share-2", label: "Pull together by links" },
  { id: "kind", icon: "shapes", label: "Pull together by kind" },
  { id: "folder", icon: "folder-tree", label: "Pull together by folder" },
] as const satisfies readonly { id: PullBy; icon: string; label: string }[];

const PULL_NAME: Record<PullBy, string> = { links: "Links", kind: "Kind", folder: "Folder" };

const SPEED_OPTIONS = TIMELAPSE_SPEEDS.map((v) => ({ id: String(v), icon: <span className="font-code text-[10.5px] leading-none">{v}×</span>, label: `Play at ${v}× speed` }));


function AtlasMap({ payload, data, host, bundle }: { payload: AtlasPayload; data: AtlasData; host: HostAdapter; bundle?: UhdBundle }) {
  const graph = payload.graph;
  const project = graph.project.name;
  const session = useMemo(() => readSession(project), [project]);
  const [pullBy, setPullBy] = useState<PullBy>(session?.pullBy ?? "links");
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ui, setUiState] = useState<AtlasUi>(readUi);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [groupTip, setGroupTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [speed, setSpeed] = useState<TimelapseSpeed>(1);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const helpId = useId();
  const panelId = useId();
  const palette = useAtlasPalette(rootEl, ui.appearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceButton = useRef<HTMLButtonElement | null>(null);
  const appearancePop = useRef<HTMLDivElement | null>(null);
  const timeline = useMemo(() => buildTimeline(graph), [graph]);
  const setUi = (patch: Partial<AtlasUi>) =>
    setUiState((u) => {
      const next = { ...u, ...patch };
      writeUi(next);
      return next;
    });

  const savedRef = useRef(payload.layout?.positions);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ data, host, project, pullBy });
  live.current = { data, host, project, pullBy };
  /** The time-lapse controls written directly while it plays (no React per frame). */
  const scrubRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLSpanElement | null>(null);
  const countRef = useRef<HTMLSpanElement | null>(null);

  const engineRef = useRef<AtlasEngine | null>(null);
  const saveNow = () => {
    saveTimer.current = undefined;
    const engine = engineRef.current;
    const sim = engine?.sim;
    const { data: d, host: h } = live.current;
    // never while the map moves, plays a time-lapse or glides back from one
    if (!engine || !sim || !d.saveLayout || sim.active || engine.playback) return;
    const positions = sim.positions();
    engine.changed = false;
    d.saveLayout({ positions }).then(
      () => {
        savedRef.current = positions;
      },
      (e: unknown) => {
        engine.changed = true;
        h.notify?.(`The Atlas layout could not be saved: ${e instanceof Error ? e.message : String(e)}`, "warning");
      },
    );
  };
  const engine = (engineRef.current ??= new AtlasEngine({
    pick: (id) => {
      setSelected(id);
      setGroup(null);
      const e = engineRef.current;
      if (!e) return;
      e.cardOpen = id !== null;
      // a node clicked where the inspector opens slides into view
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
      if (!e || !sim || !live.current.data.saveLayout || !e.changed || e.playback) return;
      if (!sim.changedSince(savedRef.current, 1)) {
        e.changed = false;
        return;
      }
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, SAVE_DELAY_MS);
    },
    idle: () => {
      const e = engineRef.current;
      if (e) writeSession(live.current.project, { pullBy: live.current.pullBy, cam: { x: e.cam.tx, y: e.cam.ty, k: e.cam.tk } });
    },
    playbackTick: (p) => {
      if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(p.ms);
      if (dateRef.current) dateRef.current.textContent = formatDay(p.date);
      if (countRef.current) countRef.current.textContent = `${p.shown} of ${engineRef.current?.sim?.nodes.length ?? 0}`;
    },
    playbackChanged: (p) => setPlayback(p),
    groupTip: (tip) => {
      clearTimeout(tipTimer.current);
      if (!tip) setGroupTip(null);
      else tipTimer.current = setTimeout(() => setGroupTip(tip), TIP_DELAY_MS);
    },
  }));

  // the canvas's size, in CSS pixels and device pixels
  useLayoutEffect(() => {
    if (!rootEl) return;
    const measure = () => {
      // the host's bar may lie over the canvas: fits keep below it
      engine.insetTop = parseFloat(getComputedStyle(rootEl).getPropertyValue("--uhd-inset-top")) || 0;
      engine.resize(rootEl.clientWidth, rootEl.clientHeight, globalThis.devicePixelRatio || 1);
      measureFloats();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rootEl);
    return () => ro.disconnect();
  }, [rootEl, engine]);

  /** What floats over the canvas: label boxes keep off it, fits keep clear of it. */
  const measureFloats = () => {
    if (!rootEl) return;
    const base = rootEl.getBoundingClientRect();
    const reserved: LabelBox[] = [];
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
  // after every render: panels open, close and change size with their content
  useLayoutEffect(measureFloats);

  // a graph: the first, or a rebuild's (positions, camera and selection kept; the same graph changes nothing)
  useLayoutEffect(() => {
    if (!rootEl) return;
    const first = !engine.sim;
    if (payload.layout) savedRef.current = payload.layout.positions;
    if (first && session?.cam) {
      Object.assign(engine.cam, { x: session.cam.x, y: session.cam.y, k: session.cam.k, tx: session.cam.x, ty: session.cam.y, tk: session.cam.k });
    }
    if (first) {
      measureFloats();
      engine.allLinks = ui.allLinks;
    }
    engine.load(graph, payload.layout?.positions, live.current.pullBy, !first || !!session?.cam);
    rerender();
  }, [payload, rootEl, engine]);

  useEffect(() => {
    engine.palette = palette;
    if (engine.s) engine.s.highContrast = palette.highContrast;
    engine.wake();
  }, [palette, engine]);

  // "All links" draws more, it never moves a node: the physics uses every link either way
  useEffect(() => {
    engine.allLinks = ui.allLinks;
    engine.wake();
  }, [ui.allLinks, engine]);

  // the Appearance popover closes on a press anywhere else
  useEffect(() => {
    if (!appearanceOpen) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!appearancePop.current?.contains(t) && !appearanceButton.current?.contains(t)) setAppearanceOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [appearanceOpen]);

  // what the canvas highlights follows the selection, the group and the search
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

  // the wheel needs a listener that may prevent the page's scroll
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => engine.wheel(e);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [engine, rootEl]);

  // stable refs: a new callback each render would resize (and clear) the canvases on every render
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
      // a save still waiting is made now: closing the tab right after a drag keeps it
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveNow();
      }
      writeSession(live.current.project, { pullBy: live.current.pullBy, cam: { x: engine.cam.tx, y: engine.cam.ty, k: engine.cam.tk } });
    },
    [engine],
  );

  // the Atlas's simulation is of the project index
  const sim = engine.sim as AtlasSimulation<AtlasNode> | null;
  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of graph.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
    return m;
  }, [graph]);
  // the census's unlinked files: what the chip counts, the dashed nodes, the "Unlinked" group
  const loose = useMemo(() => graph.nodes.filter(isLooseFile).length, [graph]);
  const results = useMemo(() => (query.trim() ? graph.nodes.filter((n) => matches(n, query)) : []), [graph, query]);
  const summary = `Atlas of ${project}: ${graph.nodes.length} items and ${graph.edges.length} links. ${ATLAS_KIND_ORDER.filter((k) => byKind.get(k))
    .map((k) => `${byKind.get(k)} ${ATLAS_KINDS[k].label.toLowerCase()}`)
    .join(", ")}.${loose ? ` ${loose} ${loose === 1 ? "file is" : "files are"} unlinked: no artifact, folder artifact or operation points to ${loose === 1 ? "it" : "them"}.` : ""}`;

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
  const changePullBy = (p: PullBy) => {
    if (p === pullBy) return;
    setPullBy(p);
    live.current.pullBy = p;
    setSelected(null);
    setGroup(null);
    engine.setPullBy(p);
    writeSession(project, { pullBy: p, cam: { x: engine.cam.tx, y: engine.cam.ty, k: engine.cam.tk } });
  };
  const animate = () => {
    if (playback) engine.stopPlayback();
    else engine.startPlayback(timeline, speed);
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
        // the arrows pan the map (only while the map itself has the focus)
        if (t !== canvasRef.current) return;
        panBy(engine.cam, -c.dx * 2, -c.dy * 2);
        engine.wake();
        break;
      case "escape":
        if (playback) {
          engine.stopPlayback();
          break;
        }
        if (!selected && !group) return;
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const node = selected !== null && sim ? sim.source[sim.indexOf(selected) ?? -1] : undefined;
  const neighbors =
    node && sim
      ? sim.neighbors(node.id).flatMap((n) => {
          const other = sim.source[sim.indexOf(n.id) ?? -1];
          return other ? [{ node: other, type: n.type as EdgeType, out: n.out }] : [];
        })
      : [];
  const members = group && sim ? groupMembers(sim, group).map((i) => sim.source[i]!) : [];
  const owners = new Set(members.flatMap((m) => m.file?.owners ?? []));
  const card = "pointer-events-auto min-h-0 w-full";
  const hasCard = !!node || !!group;
  const animateLabel = timeline.usable
    ? playback
      ? "Leave the time-lapse"
      : "Animate: replay how the project grew"
    : "Animate: this index has no creation times (run protoboard build)";

  return (
    <div ref={setRootEl} className="pb-atlas relative size-full min-h-[240px] min-w-[300px] overflow-hidden bg-canvas text-fg" onKeyDown={onKeyDown} data-pb-atlas={pullBy}>
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
        // the right button pans: no menu over the map
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const hit = engine.doubleClick(e);
          if (hit.node) select(hit.node);
          else if (hit.group) selectGroup(hit.group);
        }}
      />
      <p id={helpId} className="sr-only">
        Drag a node to move it, drag the map (or use the right or middle button anywhere) to pan, use the wheel to zoom. Keys: F fits, plus and minus zoom, 0 goes back to 100 percent, the arrows pan, Escape clears the selection. Search to find a file by name, path or kind.
      </p>

      {/* a folder title's whole path, above the title (the app's tooltip look): the canvas has no elements to hover */}
      {groupTip && (
        <div
          role="tooltip"
          className="uhd-tooltip pointer-events-none absolute z-[1000] rounded-md border border-line bg-raised px-2 py-1 font-ui text-[11px] leading-4 whitespace-nowrap text-fg shadow-float outline outline-1 -outline-offset-1 outline-contrast select-none"
          style={{ left: groupTip.x, top: groupTip.y, transform: "translate(-50%, -100%)" }}
        >
          {groupTip.text}
        </div>
      )}

      {/* the left panel: the grouping, the search and its results, the kinds; folds away */}
      {ui.left ? (
        <div id={panelId} data-pb-atlas-float="left" className={cx("absolute left-1 flex w-[min(320px,calc(100%-8px))] flex-col gap-1", TOP)}>
          <div className={cx("flex flex-col gap-2 px-3 py-2", CARD)}>
            <div className="flex items-center gap-2">
              <Icon name="waypoints" size={15} className="shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate font-label text-[12px] tracking-[0.06em] uppercase">Atlas</div>
                <div className="truncate text-[11px] text-fg-muted">
                  {graph.nodes.length} items, {graph.edges.length} links
                </div>
              </div>
              {loose > 0 && (
                <button
                  type="button"
                  aria-pressed={group === "unlinked"}
                  data-tooltip="Files no artifact, folder artifact or operation points to (drawn dashed)"
                  data-tooltip-side="bottom"
                  onClick={() => selectGroup(group === "unlinked" ? null : "unlinked")}
                  className={cx(
                    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line bg-transparent px-2 text-[10.5px] text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
                    group === "unlinked" && "border-accent bg-accent-tint text-fg",
                  )}
                >
                  Unlinked <span className="font-code">{loose}</span>
                </button>
              )}
              <IconButton icon="panel-left-close" size="sm" label="Hide the Atlas panel" aria-expanded aria-controls={panelId} onClick={() => setUi({ left: false })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-fg-muted" id="pb-atlas-pull">
                Pull together by <span className="text-fg">{PULL_NAME[pullBy]}</span>
              </span>
              <ToggleGroup label="Pull together by" size="sm" tooltipSide="bottom" options={PULL_OPTIONS} value={pullBy} onChange={changePullBy} />
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
                placeholder="Find a file, a module or a kind"
                aria-label="Find in the Atlas"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-[12px] text-fg outline-none placeholder:text-fg-faint"
              />
            </label>
            {query.trim() && (
              <div role="region" aria-label="Search results" aria-live="polite" className="max-h-[220px] overflow-y-auto">
                <div className="pb-1 text-[10.5px] text-fg-faint">{results.length ? `${results.length} found` : "Nothing found"}</div>
                <ul className="m-0 list-none p-0">
                  {results.slice(0, 8).map((n) => (
                    <li key={n.id}>
                      <SearchRow node={n} onSelect={() => select(n.id, true)} />
                    </li>
                  ))}
                </ul>
                {results.length > 8 && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{results.length - 8} more: type more of the name</div>}
              </div>
            )}
          </div>

          {/* the kinds, each a button that selects them all */}
          <Legend title="Kinds" className="max-[520px]:hidden">
            {ATLAS_KIND_ORDER.filter((k) => byKind.get(k)).map((k) => (
              // the row's tooltip opens to the right of the panel, over the map: never on top of the row it names
              // (the legend's own places it at the left, which the canvas's edge pushes back over the row)
              // the swatch takes the kind's shape and color as chosen (Appearance); every kind the neutral with "Color by type" off
              <div key={k} className={cx("-mr-3 flex flex-col pr-3", LEGEND_SHAPE[kindShape(ui.appearance, k)])} data-tooltip={`Select every ${ATLAS_KINDS[k].one.toLowerCase()}`} data-tooltip-side="right">
              <LegendItem
                shape="dot"
                color={ui.appearance.colorByType ? kindCss(kindColor(ui.appearance, k)) : token("textFaint")}
                label={`${ATLAS_KINDS[k].label} · ${byKind.get(k)}`}
                pressed={group === `kind:${k}`}
                dimmed={!!group && group !== `kind:${k}`}
                onSelect={() => {
                  const key = `kind:${k}`;
                  if (group === key) return selectGroup(null);
                  // pulled together by kind, the kind is one place to fly to; otherwise it is spread over the whole map
                  selectGroup(key, pullBy === "kind");
                  if (pullBy !== "kind") engine.fitAll();
                }}
              />
              </div>
            ))}
          </Legend>
        </div>
      ) : (
        <button type="button" aria-label="Show the Atlas panel" aria-expanded={false} data-tooltip="Show the Atlas panel" data-tooltip-side="right" onClick={() => setUi({ left: true })} className={HIERARCHY_LOOK.folded}>
          <Icon name="panel-left-open" size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      {payload.stale && (
        <div
          role="status"
          data-pb-atlas-float="top"
          className={cx("absolute left-1/2 flex max-w-[calc(100%-8px)] -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-[11.5px] max-[860px]:top-auto max-[860px]:bottom-[52px]", CARD, TOP)}
        >
          <Icon name={payload.stale.rebuilding ? "refresh-cw" : "triangle-alert"} size={13} className={cx("shrink-0 text-warning", payload.stale.rebuilding && "motion-safe:animate-spin")} aria-hidden />
          {staleMessage(payload.stale)}
          {payload.stale.rebuilding ? "; rebuilding…" : <>; run <span className="cmd">protoboard build</span></>}
        </div>
      )}

      {/* the right column: the minimap at the top right, the inspector under it; both fold away */}
      <div className={cx("pointer-events-none absolute right-1 bottom-[50px] flex w-[min(300px,calc(100%-8px))] flex-col items-end gap-1", TOP)}>
        {ui.minimap && (
          <div data-pb-atlas-float="corner" className={cx("pointer-events-auto shrink-0 overflow-hidden", CARD)} style={{ width: MINIMAP.w + 2, height: MINIMAP.h + 2 }}>
            <canvas ref={miniCallback} aria-hidden className="block" style={{ width: MINIMAP.w, height: MINIMAP.h }} />
          </div>
        )}
        {ui.right ? (
          <>
            {node && (
              <div data-pb-atlas-float="right" className={cx(card, "flex flex-col")}>
                <AtlasInspector
                  className="max-h-full"
                  node={node}
                  neighbors={neighbors}
                  data={data}
                  host={host}
                  bundle={bundle}
                  onSelect={(id) => select(id, true)}
                  onClose={() => select(null)}
                  onCollapse={() => setUi({ right: false })}
                />
              </div>
            )}
            {!node && group && (
              <div data-pb-atlas-float="right" className={cx(card, "flex flex-col")}>
                <AtlasGroupCard
                  className="max-h-full"
                  name={groupName(group)}
                  summary={
                    group === "unlinked"
                      ? `${members.length} ${members.length === 1 ? "file" : "files"} that no artifact, folder artifact or operation points to. Drawn dashed, at the edge of the map; a module's artifact naming one links it.`
                      : `${members.length} items${owners.size ? `, spread across ${owners.size} ${owners.size === 1 ? "module" : "modules"}` : ""}`
                  }
                  members={members.slice(0, 12)}
                  more={Math.max(0, members.length - 12)}
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

      {/* the time-lapse's controls: play and pause, the scrubber, the date, the speed */}
      {playback && (
        <div data-pb-atlas-float="bottom" role="group" aria-label="Time-lapse" className={cx("absolute bottom-[50px] left-1/2 flex w-[min(560px,calc(100%-8px))] -translate-x-1/2 items-center gap-2 px-2 py-1", CARD)}>
          <IconButton icon={playback.playing ? "pause" : "play"} label={playback.playing ? "Pause" : "Play"} tooltipSide="top" onClick={() => engine.setPlaying(!playback.playing)} />
          <input
            ref={scrubRef}
            type="range"
            aria-label="When"
            min={0}
            max={Math.max(1, timeline.duration)}
            step={1}
            defaultValue={playback.ms}
            onInput={(e) => {
              if (playback.playing) engine.setPlaying(false);
              engine.seek(Number((e.target as HTMLInputElement).value));
            }}
            className="min-w-0 flex-1 accent-accent"
          />
          <span className="flex shrink-0 flex-col items-end leading-tight">
            <span ref={dateRef} className="font-code text-[11px] text-fg" aria-live="off">
              {formatDay(playback.date)}
            </span>
            <span ref={countRef} className="text-[10px] text-fg-muted">
              {playback.shown} of {graph.nodes.length}
            </span>
          </span>
          <ToggleGroup
            label="Speed"
            size="sm"
            tooltipSide="top"
            options={SPEED_OPTIONS}
            value={String(speed)}
            onChange={(v) => {
              const s = Number(v) as TimelapseSpeed;
              setSpeed(s);
              engine.setSpeed(s);
            }}
          />
          <IconButton icon="x" size="sm" label="Leave the time-lapse" tooltipSide="top" onClick={() => engine.stopPlayback()} />
        </div>
      )}

      {appearanceOpen && (
        <div ref={appearancePop} data-pb-atlas-float="over" className="absolute bottom-[48px] left-1/2 z-20 max-w-[calc(100%-8px)] -translate-x-1/2">
          <AppearancePopover
            appearance={ui.appearance}
            onChange={(appearance) => setUi({ appearance })}
            kinds={ATLAS_KIND_ORDER.filter((k) => byKind.get(k))}
            resolved={palette.kinds}
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
        <Toolbar label="Atlas tools" className="max-w-full overflow-x-auto [scrollbar-width:none]">
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
            data-tooltip={ui.allLinks ? "All links: on, every link drawn (click to show only the core ones)" : "All links: off, only the core links (click to show every link)"}
            tooltipSide="top"
            onClick={() => setUi({ allLinks: !ui.allLinks })}
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
          <IconButton icon="film" label={animateLabel} pressed={!!playback} disabled={!timeline.usable} tooltipSide="top" onClick={animate} />
        </Toolbar>
        </div>
      </div>
    </div>
  );
}

function SearchRow({ node, onSelect }: { node: AtlasNode; onSelect(): void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // its path, to the right of the panel: never on top of the row
      data-tooltip={node.path ?? node.label}
      data-tooltip-side="right"
      className="flex w-full cursor-pointer items-baseline gap-2 rounded-sm border-0 bg-transparent px-1 py-0.5 text-left text-[11px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
    >
      <span className="min-w-0 truncate text-fg">{node.label}</span>
      <span className="ml-auto shrink-0 text-fg-faint">{ATLAS_KINDS[node.kind].one}</span>
    </button>
  );
}

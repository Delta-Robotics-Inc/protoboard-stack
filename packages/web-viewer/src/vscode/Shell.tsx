/**
 * The VS Code shell (PB-894 §2, PB-895, PB-896, PB-897): one viewer editor
 * tab, as simple as it can be. A floating header with the Protoboard mark,
 * the module the tab shows and the view tabs the registry offers for it; the
 * view; for the diagram a toolbar (fit, zoom, wire detail, grounds) and a
 * legend that holds the colouring choice; and at the left the tab's own
 * hierarchy (PB-1042: the module tree of this tab's project, synced with its
 * canvas; its right-click menu is VS Code's, from the rows' context). No
 * inspector and no DRC: those are VS Code's own views (the Protoboard
 * Inspector, which follows the focused tab, and the DRC panel). The theme is
 * VS Code's (high contrast included); the Protoboard faces apply only under a
 * Protoboard colour theme.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  CLASSIFICATIONS,
  DETAIL_OPTIONS,
  CLASSIFICATION_OPTIONS,
  DiagramCanvas,
  DiagramLegendItems,
  EmptyState,
  FittedLegend,
  LegendToolbarButton,
  Icon,
  IconButton,
  IsolationClear,
  Scene3D,
  ScrollArea,
  ThemeProvider,
  ToggleGroup,
  ToolToggle,
  Toolbar,
  ToolbarSeparator,
  UhdViewer,
  ViewButtons,
  HierarchyToggle,
  ViewerHierarchy,
  ViewerNodeMenu,
  cx,
  defineTheme,
  useViewer,
  vscodeThemeAdapter,
  type HierarchyCommand,
  type HierarchyNode,
  type HierarchyPanelState,
  type ThemeAdapter,
  type UhdViewerOptions,
} from "@deltarobotics/uhd-viewer/components";
import type { ResolvedView } from "@protoboardai/core";
import { MissingPartsHint, PartStatusStyles, PlannedView, ViewIcon, ViewRegistry, createViewRegistry, nodeMarks, registerContributedViews, type HostAdapter, type PartTrust, type ViewDefinition } from "@protoboardai/views";
import { Logo } from "../Logo.js";
import { DEV_SERVER_IS, type ViewerStatus } from "./devLink.js";
import type { DevAction, FromWebview, HierarchyAction, HierarchyRowContext, ModuleSource, SourceAction } from "./protocol.js";
import { tabModule } from "./tab-module.js";
import { fitTabs } from "./tabs-fit.js";

export { tabModule };

/** What the page tells the shell besides the viewer's options. */
export interface ShellBridge {
  /** Send a message to the extension. */
  post(message: FromWebview): void;
  /** The extension asked for a view (`showView`): subscribe; returns the unsubscribe. */
  onShowView(listener: (view: string) => void): () => void;
  /** The view the tab opens on. */
  startView: string;
  /** The level the tab opens on ("" = the top): the shell reports no state until the viewer shows it, so the tab never passes through the top level. */
  startPath?: string;
  /** What the tab's view was opened with (the pair view's `link`, `a`, `b`). */
  startParams?: Record<string, string>;
  /** What the page says over the canvas while it has no bundle to show, or lost its server. */
  status: () => ViewerStatus | null;
  onStatus(listener: () => void): () => void;
  /** The buttons of a dev server problem: try again, reload the window, show the extension's log. */
  devAction?(action: DevAction): void;
  /** The source file of a module (by instance path), as the extension last said it; undefined: not known. */
  source?: (path: string) => ModuleSource | null | undefined;
  onSource?(listener: () => void): () => void;
  /** What the tab's hierarchy panel kept (the webview's own state), and where its changes go. */
  hierarchyState?: unknown;
  onHierarchyState?(state: HierarchyPanelState): void;
  /** The extension's commands for the hierarchy panel (reveal a module, the filter, open or fold): subscribe; returns the unsubscribe. */
  onHierarchy?(listener: (command: { type: HierarchyAction; path?: string }) => void): () => void;
}

export interface VsCodeViewerOptions extends UhdViewerOptions {
  bridge: ShellBridge;
  /** Views the project's extensions declare, added to the built-in ones. */
  views?: ResolvedView[];
  registry?: ViewRegistry;
  /** Every definition's part status by id (PB-932; the dev server's state): the dot on a module in the diagram. */
  partStatus?: Record<string, { trust: PartTrust; basis?: string; blank?: boolean }>;
}

/** VS Code's faces, or the Protoboard ones under a Protoboard colour theme (the only place they apply). */
const VSCODE_FACES = { fontUi: "var(--vscode-font-family)", fontLabel: "var(--vscode-font-family)", fontMono: "var(--vscode-editor-font-family, ui-monospace, monospace)" };
const PROTOBOARD_FACES = { fontUi: '"Kode Mono", var(--vscode-font-family)', fontLabel: '"Kode Mono Bold", "Kode Mono", var(--vscode-font-family)', fontMono: "var(--vscode-editor-font-family, ui-monospace, monospace)" };

/** The colour theme VS Code applies is a Protoboard one (the extension's Protoboard Dark or Light). */
export const isProtoboardTheme = (doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean =>
  /^protoboard\b/i.test(doc?.body?.dataset.vscodeThemeId ?? doc?.body?.dataset.vscodeThemeName ?? "");

/**
 * VS Code's theme (uhd-viewer's adapter, every token on `--vscode-*`) with
 * the faces of the colour theme in use: a change of theme (the body's class
 * or its theme id) re-themes.
 */
export function vscodeShellThemeAdapter(doc: Document | undefined = typeof document === "undefined" ? undefined : document): ThemeAdapter {
  const base = vscodeThemeAdapter(doc);
  const current = () => {
    const t = base.current();
    return defineTheme(t, { id: t.id, label: t.label, tokens: isProtoboardTheme(doc) ? PROTOBOARD_FACES : VSCODE_FACES });
  };
  return {
    id: "vscode",
    current,
    subscribe: doc?.body
      ? (onChange) => {
          let key = `${doc.body.className}|${isProtoboardTheme(doc)}`;
          const observer = new MutationObserver(() => {
            const next = `${doc.body.className}|${isProtoboardTheme(doc)}`;
            if (next !== key) {
              key = next;
              onChange(current());
            }
          });
          observer.observe(doc.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-id", "data-vscode-theme-name"] });
          return () => observer.disconnect();
        }
      : undefined,
  };
}

export function VsCodeShell(props: VsCodeViewerOptions) {
  const adapter = useMemo(() => vscodeShellThemeAdapter(), []);
  const status = useSyncExternalStore(props.bridge.onStatus, props.bridge.status);
  // the viewer knows marks, not parts: the status becomes a tone and a tooltip here
  const marks = useMemo(() => nodeMarks(props.partStatus), [props.partStatus]);
  return (
    <ThemeProvider adapter={adapter} className="pb-vscode">
      <PartStatusStyles />
      {props.bundle || props.bundleUrl ? (
        <UhdViewer {...props} nodeMarks={props.nodeMarks ?? marks}>
          <Shell bridge={props.bridge} views={props.views} registry={props.registry} />
          {status && <StatusCard status={status} bridge={props.bridge} over />}
        </UhdViewer>
      ) : (
        <div className={cx("relative grid size-full bg-canvas", MIDDLE)}>
          <Header />
          <StatusCard status={status ?? { message: "Loading the project…", busy: true }} bridge={props.bridge} />
        </div>
      )}
    </ThemeProvider>
  );
}

/**
 * What the tab says over the canvas. A note (a rebuild running, a rebuild
 * that failed) sits at the bottom, out of the drawing's way. A dev server
 * problem sits in the middle of the tab (PB-943): what failed, what the dev
 * server is, and what to try.
 */
function StatusCard({ status, bridge, over }: { status: ViewerStatus; bridge: ShellBridge; over?: boolean }) {
  const { message, busy, problem } = status;
  const mark = busy ? (
    <span aria-hidden className="mt-[3px] size-3 shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent" />
  ) : (
    <Icon name="circle-alert" size={14} className="mt-[2px] shrink-0 text-warning" aria-hidden />
  );
  const card = "z-40 rounded-panel border border-line bg-surface font-ui text-[12px] text-fg-muted shadow-panel outline outline-1 -outline-offset-1 outline-contrast";
  if (!problem) {
    return (
      <div role="status" className={cx(card, "flex max-w-[min(520px,calc(100%-32px))] items-start gap-2.5 px-3 py-2", over && "absolute bottom-16 left-1/2 -translate-x-1/2")}>
        {mark}
        <span className="min-w-0">{message}</span>
      </div>
    );
  }
  const act = bridge.devAction;
  const box = (
    <div role="alert" data-dev-problem className={cx(card, CARD_BOX)}>
      <ScrollArea className="min-h-0" contentClassName="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        {mark}
        <span className="min-w-0 text-[13px] leading-snug text-fg [overflow-wrap:anywhere]">{message}</span>
      </div>
      <p className="m-0 leading-snug">{DEV_SERVER_IS}</p>
      {act && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <DevButton icon="refresh-cw" label="Retry" title="Find or start the dev server again and reload this tab from it" primary onClick={() => act("retry")} />
          <DevButton icon="rotate-ccw" label="Reload Window" title="Reload this VS Code window: the extension and every viewer tab start again" onClick={() => act("reload")} />
          <DevButton icon="scroll-text" label="Show Log" title="Protoboard: Show Log. What the extension started, on which address, and what this tab tried to reach" onClick={() => act("showLog")} />
        </div>
      )}
      </ScrollArea>
    </div>
  );
  // in the middle of the tab, over the drawing when there is one (which stays usable around the card)
  return over ? <div className={cx("pointer-events-none absolute inset-0 z-40 grid", MIDDLE)}>{box}</div> : box;
}

/**
 * Where a card sits: in the middle of what the floating header leaves free
 * (the header is 40px tall, 4px from the top). One row as tall as that space,
 * so a card taller than a small tab is held to it and scrolls inside itself.
 */
const MIDDLE = "box-border grid-rows-[minmax(0,1fr)] place-items-center pt-12 pb-1";
const CARD_BOX = "pointer-events-auto flex max-h-full w-[min(440px,calc(100%-32px))] min-w-[220px] flex-col overflow-hidden";

function DevButton({ icon, label, title, primary, onClick }: { icon: string; label: string; title: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-tooltip={title}
      onClick={onClick}
      className={cx(
        "inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md border px-2.5 font-ui text-[12px] leading-none outline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus",
        primary ? "pb-dev-primary border-transparent" : "border-line bg-transparent text-fg hover:bg-hover",
      )}
    >
      <Icon name={icon} size={13} aria-hidden />
      {label}
    </button>
  );
}

function useRegistry(views: ResolvedView[] | undefined, given?: ViewRegistry): ViewRegistry {
  const registry = useMemo(() => {
    if (given) return given;
    const r = createViewRegistry();
    if (views?.length) registerContributedViews(r, views);
    return r;
  }, [views, given]);
  useSyncExternalStore(
    (l) => registry.subscribe(l),
    () => registry.list().length + registry.list().filter((v) => v.status === "ready").length * 1000,
  );
  return registry;
}

/** Views VS Code shows in editors of their own (PB-912): the BOM editor. */
const NATIVE_VIEWS = new Set(["bom"]);

/**
 * Views a VS Code viewer tab does not offer (PB-1070): the library is the
 * Library side bar's, and its full page and part pages open from there; a
 * header tab is for what this tab shows.
 */
const NOT_IN_VSCODE = new Set(["library"]);

/** What the floating header and the toolbar cover (the viewer's floating cards sit inside it). */
const INSETS = { "--uhd-inset-top": "44px", "--uhd-inset-left": "0px", "--uhd-inset-right": "0px" } as CSSProperties;

/** The floating header without a model: the mark only. */
function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="absolute top-1 right-1 left-1 z-50 flex h-10 min-w-0 items-center gap-1 rounded-panel border border-line bg-surface px-1 shadow-panel outline outline-1 -outline-offset-1 outline-contrast">
      <Logo />
      {children}
    </header>
  );
}

function Shell({ bridge, views, registry: given }: { bridge: ShellBridge; views?: ResolvedView[]; registry?: ViewRegistry }) {
  const c = useViewer();
  const registry = useRegistry(views, given);
  const path = c.drill.join("/");
  const tabs = registry.forModule(c.levelDef, c.source.bundle, path).filter((t) => !NOT_IN_VSCODE.has(t.id));
  // a domain tab (schematic, BOM, …) when one is shown; the viewer's own view (diagram, 3D) otherwise
  const [domain, setDomain] = useState<string | null>(() => (bridge.startView === "diagram" || bridge.startView === "3d" ? null : bridge.startView));
  const lastView = useRef(c.view);
  useEffect(() => {
    // the viewer's view changed (a host's setView): show it
    if (lastView.current !== c.view) setDomain(null);
    lastView.current = c.view;
  }, [c.view]);
  const wanted = domain ?? c.view;
  const active = tabs.find((t) => t.id === wanted) ?? tabs[0];
  const show = (id: string) => {
    if (id === "diagram" || id === "3d") {
      setDomain(null);
      c.setView(id);
    } else setDomain(id);
  };
  useEffect(() => bridge.onShowView(show));
  // views with an editor of their own in VS Code (the BOM editor): their tab opens it
  const opensNative = (id: string) => NATIVE_VIEWS.has(id);
  const host = useMemo<HostAdapter>(
    () => ({
      kind: "vscode",
      openSource: c.hostActions.openSource ? (r) => c.hostActions.openSource!(r.defId, r.instancePath) : undefined,
      openArtifact: c.hostActions.openArtifact ? (r) => c.hostActions.openArtifact!(r.defId, r.artifactId) : undefined,
      openView: (view, at, params) => bridge.post({ type: "openView", view, path: at, ...(params ? { params } : {}) }),
      notify: (message, severity) => bridge.post({ type: "notify", message, ...(severity ? { severity } : {}) }),
      // the diagram's notice about parts the project has not fetched: the extension's Fetch Parts (B6)
      fetchParts: () => bridge.post({ type: "devAction", action: "fetchParts" }),
      // a view's files (the board drawings) from the dev server, as the bundle's artifacts are
      artifactUrl: (defId, filePath) => c.source.resolveArtifact(defId, filePath),
      // a component picked in a domain view (the PCB, the schematic): the extension's Inspector follows it, as it
      // follows the diagram's selection
      selectionChanged: (selection) => bridge.post({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection } }),
    }),
    [c.hostActions, bridge, c.source],
  );

  // the extension titles the tab and follows the level (the Inspector, a new tab's module)
  // (a part's name as its level declares it: the diagram's own labels are capitals)
  const parts = ((c.levelDef.children ?? []) as { id: string; name?: string; moduleDefId?: string }[]).map((ch) => ({ id: ch.id, label: ch.name ?? c.defFor(ch.moduleDefId)?.name ?? ch.id }));
  const on = tabModule(c.drill, bridge.startPath ?? "", c.vm.path[c.vm.path.length - 1]?.label ?? c.source.name, parts);
  const label = on.label;
  const viewId = active?.id ?? "diagram";
  const nodes = c.drawn.nodes.length;
  const tabKey = tabs.map((t) => `${t.id}:${t.title}`).join(",");
  // a tab opened on a module (or on 3D) says nothing until the viewer shows it; a path the bundle no longer has gives up after a moment
  const startPath = bridge.startPath ?? "";
  const wantsStart = startPath !== "" || bridge.startView === "3d";
  const [settled, setSettled] = useState(!wantsStart);
  const atStart = path === startPath && (bridge.startView !== "3d" || c.view === "3d");
  const loaded = !!c.source.bundle;
  // definitions the project names and has not fetched: the tab says how many, and the extension's log with it
  const missing = c.scenario.missing.length;
  useEffect(() => {
    if (settled) return;
    if (atStart && loaded) return void setSettled(true);
    if (!loaded) return;
    const t = setTimeout(() => setSettled(true), 1500);
    return () => clearTimeout(t);
  }, [settled, atStart, loaded]);
  useEffect(() => {
    if (!settled) return;
    bridge.post({ type: "state", path, label, view: viewId, nodes, views: tabs.map((t) => ({ id: t.id, title: t.title })), ...(missing ? { missing } : {}), ...(on.part ? { at: on.path } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, settled, path, label, viewId, nodes, tabKey, missing, on.path]);

  // 3D shows the module the tab is on (PB-897): the level, or the part the tab was opened on when it has no level of its own
  const startAt = startPath ? startPath.split("/") : [];
  const scope = startAt.length > c.drill.length && c.drill.every((d, i) => startAt[i] === d) ? startAt : c.drill;
  // a board's 3D model is an output of its circuit tool: say how it is made where there is none (PB-946)
  // (a board: a module with nets, whether or not its drawings exist yet; and the tab is on the board itself, not on one of its parts)
  const board = scope === c.drill && (tabs.some((t) => t.id === "pcb" || t.id === "schematic") || ((c.levelDef.interfaces ?? []) as { protocols?: { type: string }[] }[]).some((i) => i.protocols?.some((p) => p.type === "net")));
  const modelHint = board ? (
    <>
      A board's 3D model is its <span className="cmd">out/board.glb</span>. It is written by <span className="cmd">npx protoboard run circuit:generate --module {c.levelDef.id}</span> and then{" "}
      <span className="cmd">npx protoboard run circuit:export --module {c.levelDef.id}</span>, and shown once the board's module lists it in its <span className="cmd">artifacts</span> (role body, format glb). Your agent can do all three.
    </>
  ) : (
    <>A part's 3D model is its body artifact (a GLB). A part from the library brings its own; for a part of your own, ask your agent to model it.</>
  );
  const View = active?.component ?? PlannedView;
  // the tab's hierarchy: the extension reveals modules in it and puts the keyboard in its filter
  const [hierarchyCommand, setHierarchyCommand] = useState<HierarchyCommand>();
  const [hierarchyOpen, setHierarchyOpen] = useState(true);
  const commandSeq = useRef(0);
  useEffect(() => bridge.onHierarchy?.((m) => setHierarchyCommand({ type: m.type, ...(m.path !== undefined ? { path: m.path } : {}), seq: ++commandSeq.current })), [bridge]);
  // a row's right-click menu is VS Code's (the manifest's webview/context menus read this, and its commands get it)
  const rowAttributes = useCallback(
    (n: HierarchyNode) => {
      const context: HierarchyRowContext = {
        webviewSection: "hierarchy",
        pbPath: n.path,
        pbKind: n.kind,
        pbDefId: n.defId,
        pbLevel: n.drillable && n.path !== "",
        pbArtifacts: (c.defFor(n.defId)?.artifacts?.length ?? 0) > 0,
        preventDefaultContextMenuItems: true,
      };
      return { "data-vscode-context": JSON.stringify(context) } as Record<`data-${string}`, string>;
    },
    [c.defFor],
  );
  return (
    <div className="relative size-full min-h-[240px] min-w-[320px] overflow-hidden bg-background text-fg" style={INSETS}>
      <Header>
        <ToolbarSeparator />
        <HierarchyToggle open={hierarchyOpen} onClick={() => setHierarchyCommand({ type: "toggle", seq: ++commandSeq.current })} />
        <ToolbarSeparator />
        <ViewTabs tabs={tabs} active={active?.id} opensEditor={opensNative} onOpen={(id, beside) => (beside || opensNative(id) ? bridge.post({ type: "openView", view: id, path }) : show(id))} />
        <ToolbarSeparator />
        <Breadcrumb part={on.part ? label : undefined} />
        <SourcePath bridge={bridge} path={on.path} />
      </Header>
      {/* a floating card; the header's Hierarchy button is its one fold control (PB-1070) */}
      <ViewerHierarchy state={bridge.hierarchyState} onStateChange={bridge.onHierarchyState} onOpenChange={setHierarchyOpen} command={hierarchyCommand} rowAttributes={rowAttributes} ownMenu={false} foldButton={false} />
      <div className="workspace" role="tabpanel" aria-label={active?.title}>
        {active?.id === "diagram" ? (
          <>
            <DiagramCanvas toolbar={false} legend={false} coveredRight={false} missingHint={<MissingPartsHint host={host} />} />
            <DiagramTools />
            <DiagramKey />
          </>
        ) : active?.id === "3d" ? (
          <Scene3D inspector={false} scope={scope} emptyHint={modelHint} />
        ) : (
          active && <View module={c.levelDef} path={path} bundle={c.source.bundle} host={host} view={active} {...(bridge.startParams && active.id === bridge.startView ? { params: bridge.startParams } : {})} />
        )}
      </div>
      <ViewerNodeMenu />
    </div>
  );
}

/** Where the tab is: the system, the levels drilled into (each one a way back), and the part the tab is on when it has no level of its own. */
function Breadcrumb({ part }: { part?: string }) {
  const c = useViewer();
  const path = c.vm.path;
  const crumbs = [...path.map((p, i) => ({ key: p.id || "root", label: p.label, go: i < path.length - 1 || part ? () => c.onNavigate(i) : undefined })), ...(part ? [{ key: "part", label: part, go: undefined }] : [])];
  return (
    <nav aria-label="Level" className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden max-[520px]:hidden">
      {crumbs.map((p, i) => {
        const current = i === crumbs.length - 1;
        return (
          <span key={p.key} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-fg-faint" aria-hidden />}
            {p.go && !current ? (
              <button type="button" onClick={p.go} className="h-7 max-w-48 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 font-ui text-[12px] text-fg-muted hover:bg-hover hover:text-fg">
                {p.label}
              </button>
            ) : (
              <span aria-current={current ? "location" : undefined} className="max-w-56 truncate px-1.5 font-ui text-[12px] text-fg">
                {p.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * The view tabs (B8): titles while they fit, icons when they do not, and a
 * More menu for the tabs that do not fit even as icons. Two hidden copies of
 * the strip measure the tabs.
 */
function ViewTabs({ tabs, active, opensEditor, onOpen }: { tabs: ViewDefinition[]; active?: string; opensEditor: (id: string) => boolean; onOpen: (id: string, beside: boolean) => void }) {
  const nav = useRef<HTMLElement>(null);
  const fullRow = useRef<HTMLDivElement>(null);
  const compactRow = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ compact: boolean; shown: number[] }>({ compact: false, shown: tabs.map((_, i) => i) });
  // the More menu, open at the button's place (the strip clips what overflows it)
  const [menu, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const setMenu = (open: boolean, at?: Element) => {
    const r = at?.getBoundingClientRect();
    setMenuAt(open && r ? { left: Math.max(4, r.right - 168), top: r.bottom + 4 } : null);
  };
  const key = tabs.map((t) => t.id).join(",");
  const activeIndex = tabs.findIndex((t) => t.id === active);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const widths = (row: HTMLDivElement | null) => [...(row?.children ?? [])].map((c) => (c as HTMLElement).offsetWidth);
    const measure = () => {
      const next = fitTabs(widths(fullRow.current), widths(compactRow.current), el.clientWidth, activeIndex);
      setFit((was) => (was.compact === next.compact && was.shown.join() === next.shown.join() ? was : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, activeIndex]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && (e.target as Element | null)?.closest?.("[data-view-menu]")) return;
      setMenu(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [menu]);
  const hidden = tabs.filter((_, i) => !fit.shown.includes(i));
  const row = (compact: boolean) => tabs.map((t) => <Tab key={t.id} view={t} active={t.id === active} compact={compact} measure />);
  return (
    <>
      <nav ref={nav} role="tablist" aria-label="Views" className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {tabs.map((t, i) =>
          fit.shown.includes(i) ? <Tab key={t.id} view={t} active={t.id === active} compact={fit.compact} opensEditor={opensEditor(t.id)} onOpen={(beside) => onOpen(t.id, beside)} /> : null,
        )}
        {hidden.length > 0 && (
          <IconButton size="sm" icon="chevrons-right" label={`More views: ${hidden.map((t) => t.title).join(", ")}`} aria-haspopup="menu" aria-expanded={!!menu} data-view-menu onClick={(e) => setMenu(!menu, e.currentTarget)} className="size-8 shrink-0" />
        )}
        {/* the measuring copies: never seen, never focused */}
        <div aria-hidden inert className="pointer-events-none invisible absolute top-0 left-0 flex gap-0.5" ref={fullRow}>
          {row(false)}
        </div>
        <div aria-hidden inert className="pointer-events-none invisible absolute top-0 left-0 flex gap-0.5" ref={compactRow}>
          {row(true)}
        </div>
      </nav>
      {menu && hidden.length > 0 && (
        <div role="menu" aria-label="More views" data-view-menu style={{ left: menu.left, top: menu.top }} className="fixed z-[60] flex w-[168px] flex-col gap-0.5 rounded-panel border border-line bg-surface p-1 shadow-panel outline outline-1 -outline-offset-1 outline-contrast">
          {hidden.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              onClick={(e) => {
                setMenu(false);
                onOpen(t.id, e.ctrlKey || e.metaKey);
              }}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 text-left font-ui text-[12px] text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
            >
              <ViewIcon name={t.icon} size={15} strokeWidth={1.75} aria-hidden />
              {t.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Tab({ view, active, compact, measure, opensEditor, onOpen }: { view: ViewDefinition; active: boolean; compact?: boolean; measure?: boolean; opensEditor?: boolean; onOpen?: (beside: boolean) => void }) {
  const planned = view.status === "planned";
  const click = (e: MouseEvent) => onOpen?.(e.ctrlKey || e.metaKey || e.button === 1);
  return (
    <button
      type="button"
      role={measure ? undefined : "tab"}
      tabIndex={measure ? -1 : undefined}
      // the tab's name for screen readers and automation, also when it shows only its icon (B9)
      aria-label={view.title}
      aria-selected={measure ? undefined : active}
      data-tooltip={`${view.title}${planned ? " · planned" : ""}${view.description ? `: ${view.description}` : ""}`}
      data-tooltip-shortcut={opensEditor ? "Opens its own editor" : "Ctrl+click: new tab"}
      onClick={click}
      onAuxClick={(e) => e.button === 1 && click(e)}
      className={cx(
        "relative flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 font-ui text-[12px] tracking-[-0.01em] transition-colors",
        active ? "bg-accent-tint text-fg outline outline-1 -outline-offset-1 outline-contrast-active" : "text-fg-muted hover:bg-hover hover:text-fg",
        planned && !active && "text-fg-faint",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <ViewIcon name={view.icon} size={15} strokeWidth={1.75} className={active ? "text-accent" : undefined} aria-hidden />
      {!compact && <span>{view.title}</span>}
      {active && <span aria-hidden className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

/**
 * From a canvas tab to its source (the 2026-10-08 first builds, item 29):
 * the file the module in view is written in, at the right of the header. A
 * click opens it; beside it, show it in the Explorer and copy its path (the
 * tab's own right-click menu has the same three, since VS Code offers its
 * Reveal and Copy Path only for files).
 */
function SourcePath({ bridge, path }: { bridge: ShellBridge; path: string }) {
  const source = useSyncExternalStore(
    (l) => bridge.onSource?.(l) ?? (() => undefined),
    () => bridge.source?.(path) ?? null,
  );
  if (!source) return null;
  const act = (action: SourceAction) => bridge.post({ type: "source", action });
  const at = `${source.file}${source.line ? `:${source.line}` : ""}`;
  const parts = source.file.split("/");
  const name = parts.pop() ?? source.file;
  return (
    <div data-source-path={source.file} className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5 pl-1 max-[560px]:shrink">
      <button
        type="button"
        aria-label={`Open ${at}`}
        data-tooltip={`Open the source of this module: ${at}`}
        onClick={() => act("open")}
        className="flex h-8 max-w-[280px] min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 font-code text-[11px] text-fg-muted transition-colors hover:bg-hover hover:text-fg hover:outline hover:outline-1 hover:outline-dashed hover:-outline-offset-1 hover:outline-contrast-active focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
      >
        <Icon name="file-code" size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <span className="flex min-w-0 max-[760px]:hidden">
          {/* the folders give way first: the file's name stays whole */}
          {parts.length > 0 && <span className="min-w-0 shrink truncate text-fg-faint">{parts.join("/")}/</span>}
          <span className="shrink-0">{name}</span>
        </span>
      </button>
      <IconButton size="sm" icon="folder-search" label="Reveal the source file in the Explorer" onClick={() => act("reveal")} className="max-[480px]:hidden" />
      <IconButton size="sm" icon="copy" label="Copy the source file's path" shortcut="Shift+click: relative" onClick={(e) => act(e.shiftKey ? "copyRelative" : "copy")} className="max-[480px]:hidden" />
    </div>
  );
}

/** The diagram's tools: the pointer's tool (select or pan), fit and zoom, then how links are drawn. No reset and no scenario (PB-896): the layout is saved with Ctrl+S. */
function DiagramTools() {
  const c = useViewer();
  return (
    <Toolbar label="Diagram tools" className="toolbar">
      {/* the legend, when it has no room beside the toolbar (FittedLegend) */}
      <LegendToolbarButton>
        <DiagramKeyBody form="popover" />
      </LegendToolbarButton>
      <ToolToggle tooltipSide="top" />
      <ToolbarSeparator />
      <ViewButtons tooltipSide="top" />
      <ToolbarSeparator />
      <ToggleGroup label="Wires" tooltipSide="top" options={DETAIL_OPTIONS} value={c.conductors ? "conductors" : "bundled"} onChange={(v) => c.setConductors(v === "conductors")} />
      <IconButton icon="arrow-down-to-line" tooltipSide="top" label={c.showGrounds ? "Draw grounds as symbols" : "Draw grounds as wires"} pressed={c.showGrounds} onClick={() => c.setShowGrounds(!c.showGrounds)} />
    </Toolbar>
  );
}

const LEGEND_KEY = "protoboard-vscode:legend";

/** The legend starts open on a roomy tab and folded on a narrow one; a choice made on it is kept (per webview). */
function useLegendOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(LEGEND_KEY);
      if (v) return v === "open";
    } catch {
      /* storage unavailable */
    }
    // folded until the user opens it (B22): open, it covered a quarter of a laptop-sized canvas and the ports under it
    return false;
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(LEGEND_KEY, next ? "open" : "folded");
    } catch {
      /* storage unavailable: the choice lasts this tab */
    }
  };
  return [open, set];
}

/**
 * The legend, with the colouring it explains chosen in it (PB-896: "it should
 * be in the legend itself"); it folds to its header. Its entries are buttons
 * (PB-946, the viewer's own): a click isolates a signal type or a domain, and
 * the header then carries the way back, folded or not. It stays at the bottom
 * left and gives way to the toolbar as the tab narrows: compact (no title,
 * swatches without labels), then a button in the toolbar that opens it.
 */
function DiagramKey() {
  const [open, setOpen] = useLegendOpen();
  return <FittedLegend label="Legend" render={(form) => <DiagramKeyBody form={form} open={open} onOpen={setOpen} />} />;
}

/** The legend's content: `full` and `compact` fold (`open`); `popover` (from the toolbar's button) always lists the entries. */
function DiagramKeyBody({ form, open = true, onOpen }: { form: "full" | "compact" | "popover"; open?: boolean; onOpen?: (open: boolean) => void }) {
  const c = useViewer();
  const title = CLASSIFICATIONS.find((x) => x.id === c.mode)?.label;
  const folds = form !== "popover";
  const shown = !folds || open;
  return (
    <>
      <div className={cx("-mx-1 -my-1 flex items-center justify-between gap-1", shown && "mb-1")}>
        {folds && <IconButton icon={open ? "chevron-down" : "chevron-right"} size="sm" tooltipSide="top" label={open ? "Fold the legend" : "Show the legend"} aria-expanded={open} onClick={() => onOpen?.(!open)} className="size-6" />}
        {form !== "compact" && <span className={cx("min-w-0 flex-1 truncate font-label text-[10px] tracking-[0.8px] text-fg-muted uppercase", !folds && "pl-1")}>{title}</span>}
        <IsolationClear />
        <ToggleGroup label="Colour links by" tooltipSide="top" size="sm" options={CLASSIFICATION_OPTIONS} value={c.mode} onChange={c.setMode} />
      </div>
      {shown && (form === "compact" ? <DiagramLegendItems compact columns={4} /> : <DiagramLegendItems />)}
    </>
  );
}

/** A view that has nothing yet (kept for shells that want the placeholder outside the registry). */
export function NoView({ title }: { title: string }) {
  return (
    <div className="grid size-full place-items-center bg-canvas">
      <EmptyState icon={<Icon name="eye-off" size={28} strokeWidth={1.25} />} title={title}>
        Nothing to show here.
      </EmptyState>
    </div>
  );
}

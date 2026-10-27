/**
 * The web shell: Protoboard's browser viewer over the viewer stack. A floating
 * header with the logo, the level's breadcrumb, the view tabs the registry
 * offers for the focused module (the drilled level), the active view's tools
 * and the panel toggles; the hierarchy at the left (PB-1042: the module tree,
 * synced with the canvas, as in a VS Code viewer tab); the view; and its own
 * inspector and DRC (the viewer's panels). The VS Code shell keeps those in
 * native views instead (docs/specs/viewer-stack.md).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  Icon,
  IconButton,
  ThemeProvider,
  ToolbarSeparator,
  HierarchyToggle,
  UhdViewer,
  ViewerHierarchy,
  ViewerInspector,
  ViewerNodeMenu,
  applyTheme,
  cx,
  tokenColor,
  useTheme,
  useViewer,
  type HierarchyCommand,
  type HierarchyPanelState,
  type UhdViewerOptions,
} from "@deltarobotics/uhd-viewer/components";
import type { ResolvedView } from "@protoboardai/core";
import { PartStatusStyles, PartsDataProvider, PlannedView, ViewIcon, ViewRegistry, createViewRegistry, nodeMarks, registerContributedViews, themeAdapterFor, themeChoiceOf, type HostAdapter, type PartTrust, type PartsData, type ViewDefinition } from "@protoboardai/views";
import { Logo, markSvg } from "./Logo.js";

export interface WebViewerOptions extends UhdViewerOptions {
  /** `protoboard-dark` (default), `protoboard-light`, `protoboard-system`, `vscode`, `default-dark`, `default-light`. */
  themeChoice?: string;
  /** Views the project's extensions declare (core's resolveViews), added to the built-in ones. */
  views?: ResolvedView[];
  /** A registry of the host's own (default: the built-in views plus `views`). */
  registry?: ViewRegistry;
  /** The viewer's requests for the pair view (`mountWebViewer` wires them; `open` events with `{ linkId, a, b }`). */
  pairRequests?: EventTarget;
  /** The library and BOM tabs' data (`createDevPartsData` for `protoboard dev`); without it they say it is missing. */
  partsData?: PartsData;
  /**
   * Every definition's part status by id (PB-932; the dev server's state):
   * the dot on a module in the diagram takes its colour (gray local, yellow
   * unverified, green verified, blue official) and says what it means.
   */
  partStatus?: Record<string, { trust: PartTrust; basis?: string; blank?: boolean }>;
}

const THEME_KEY = "protoboard-web:theme";
/** The hierarchy panel's open rows, width and fold: per browser tab (session storage), as a VS Code tab keeps them per tab. */
const HIERARCHY_KEY = "protoboard-web:hierarchy";

function keptHierarchy(): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(HIERARCHY_KEY) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

function keepHierarchy(state: HierarchyPanelState) {
  try {
    sessionStorage.setItem(HIERARCHY_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the panel's state lasts this visit */
  }
}

/** Views with no module tree to follow: the library and the BOM are the project's, not a level's. */
const NO_HIERARCHY = new Set(["library", "bom"]);

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

/** The theme: `themeChoice` when the page names one, else the viewer's last pick, else Protoboard dark. */
function useThemeChoice(given?: string): [string, (next: string) => void] {
  const [picked, setPicked] = useState<string | null>(() => storedTheme());
  // `?theme=light` means Protoboard light: the picker shows the id it resolves to
  const choice = themeChoiceOf(given) ?? picked ?? "protoboard-dark";
  const set = (next: string) => {
    setPicked(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts this visit */
    }
  };
  return [choice, set];
}

export function WebShell(props: WebViewerOptions) {
  const [choice, setChoice] = useThemeChoice(props.themeChoice);
  const adapter = useMemo(() => themeAdapterFor(choice), [choice]);
  // the viewer knows marks, not parts: the status becomes a tone and a tooltip here
  const marks = useMemo(() => nodeMarks(props.partStatus), [props.partStatus]);
  return (
    <ThemeProvider adapter={adapter} className="pb-web">
      <DocumentTheme />
      <PartStatusStyles />
      <PartsDataProvider data={props.partsData ?? null}>
        <UhdViewer {...props} nodeMarks={props.nodeMarks ?? marks}>
          <Shell views={props.views} registry={props.registry} pairRequests={props.pairRequests} theme={choice} onTheme={props.themeChoice ? undefined : setChoice} />
        </UhdViewer>
      </PartsDataProvider>
    </ThemeProvider>
  );
}

/**
 * The shell owns its page: the theme's tokens go on the document too (so the
 * page behind the viewer, overscroll included, has the theme's background,
 * not the stylesheet's dark default), and the tab's icon is the mark in the
 * theme's accent (the page's own icon is neutral: no hard-coded brand colour).
 */
function DocumentTheme() {
  const { theme, root } = useTheme();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const undo = applyTheme(html, theme);
    html.style.background = "var(--uhd-background)";
    return () => {
      undo();
      html.style.background = "";
    };
  }, [theme]);
  useEffect(() => {
    if (typeof document === "undefined" || !root) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    link.href = `data:image/svg+xml,${encodeURIComponent(markSvg(tokenColor(root, "accent", "#888888")))}`;
  }, [theme, root]);
  return null;
}

function useRegistry(views: ResolvedView[] | undefined, given?: ViewRegistry): ViewRegistry {
  const registry = useMemo(() => {
    if (given) return given;
    const r = createViewRegistry();
    if (views?.length) registerContributedViews(r, views);
    return r;
  }, [views, given]);
  // re-render when views register later (an extension's component arriving)
  useSyncExternalStore(
    (l) => registry.subscribe(l),
    () => registry.list().length + registry.list().filter((v) => v.status === "ready").length * 1000,
  );
  return registry;
}

/** Space the floating header covers at the top of the view (the viewer's floating cards sit below it). */
const INSETS = { "--uhd-inset-top": "44px", "--uhd-inset-left": "0px" } as CSSProperties;

function Shell({ views, registry: given, pairRequests, theme, onTheme }: { views?: ResolvedView[]; registry?: ViewRegistry; pairRequests?: EventTarget; theme: string; onTheme?: (t: string) => void }) {
  const c = useViewer();
  const registry = useRegistry(views, given);
  const path = c.drill.join("/");
  const tabs = registry.forModule(c.levelDef, c.source.bundle, path);
  // a domain tab (schematic, BOM, …) when one is open; the viewer's own view (diagram, 3D) otherwise
  const [domain, setDomain] = useState<string | null>(null);
  // what a domain tab was opened with (the pair view's pair, a board)
  const [params, setParams] = useState<Record<string, string> | undefined>(undefined);
  // a host's setView (or anything else that changes the viewer's view) shows that view
  useEffect(() => setDomain(null), [c.view]);
  const wanted = domain ?? c.view;
  const active = tabs.find((t) => t.id === wanted) ?? tabs[0];
  const open = (v: ViewDefinition, with_?: Record<string, string>) => {
    setParams(with_);
    if (v.uhd && (v.id === "diagram" || v.id === "3d")) {
      setDomain(null);
      c.setView(v.id);
    } else setDomain(v.id);
  };
  // the inspector's pair preview opens the pair tab on that pair
  useEffect(() => {
    if (!pairRequests) return;
    const onOpen = (e: Event) => {
      const r = (e as CustomEvent<{ linkId: string; a: string; b: string }>).detail;
      const pair = registry.get("pair");
      if (pair) open(pair, { link: r.linkId, a: r.a, b: r.b });
    };
    pairRequests.addEventListener("open", onOpen);
    return () => pairRequests.removeEventListener("open", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairRequests, registry]);
  const host = useMemo<HostAdapter>(
    () => ({
      kind: "web",
      openSource: c.hostActions.openSource ? (r) => c.hostActions.openSource!(r.defId, r.instancePath) : undefined,
      openArtifact: c.hostActions.openArtifact ? (r) => c.hostActions.openArtifact!(r.defId, r.artifactId) : undefined,
      openView: (id, at, with_) => {
        const v = registry.get(id);
        if (!v) return;
        open(v, with_);
        // the diagram of another level: go there, and select what was asked for
        if (v.id === "diagram") {
          if (at !== c.drill.join("/")) c.onGoto({ drill: at ? at.split("/") : [], selection: with_?.select ? { kind: "node", id: with_.select } : null });
          else if (with_?.select) c.setSelection({ kind: "node", id: with_.select });
        }
      },
      artifactUrl: (defId, filePath) => c.source.resolveArtifact(defId, filePath),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.hostActions, registry, c.source, c.drill],
  );
  const View = active?.component ?? PlannedView;
  const diagram = active?.id === "diagram";
  const light = theme.endsWith("light");
  // the hierarchy at the left: kept per browser tab; the header's button opens and folds it
  const [hierarchyState] = useState(keptHierarchy);
  const [hierarchyOpen, setHierarchyOpen] = useState<boolean | null>(null);
  const [hierarchyCommand, setHierarchyCommand] = useState<HierarchyCommand>();
  const seq = useRef(0);
  const showHierarchy = !NO_HIERARCHY.has(active?.id ?? "");

  return (
    <div className="relative h-full overflow-hidden bg-background text-fg" style={INSETS}>
      <header className="absolute top-1 right-1 left-1 z-50 flex h-10 items-center gap-1 rounded-panel border border-line bg-surface px-1 shadow-panel outline outline-1 -outline-offset-1 outline-contrast">
        <Logo />
        <ToolbarSeparator />
        <HierarchyToggle open={showHierarchy && (hierarchyOpen ?? true)} disabled={!showHierarchy} onClick={() => setHierarchyCommand({ type: "toggle", seq: ++seq.current })} />
        <ToolbarSeparator />
        <nav role="tablist" aria-label="Views" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => (
            <Tab key={t.id} view={t} active={t.id === active?.id} onClick={() => open(t)} />
          ))}
        </nav>
        <ToolbarSeparator />
        <Breadcrumb />
        <span className="min-w-2 flex-1" />
        <ToolbarSeparator />
        <IconButton icon="panel-right" label="Inspector" pressed={c.panel === "hierarchy"} disabled={!active?.uhd} onClick={() => c.setPanel(c.panel === "hierarchy" ? null : "hierarchy")} />
        <IconButton
          icon="shield-check"
          label={`Design rule checks${c.errors ? ` · ${c.errors} error${c.errors === 1 ? "" : "s"}` : ""}`}
          pressed={c.panel === "checks"}
          badge={c.errors || undefined}
          disabled={!active?.uhd}
          onClick={() => {
            c.setSelection(null);
            c.setPanel(c.panel === "checks" ? null : "checks");
          }}
        />
        {onTheme && <IconButton icon={light ? "moon" : "sun"} label={light ? "Dark theme" : "Light theme"} onClick={() => onTheme(light ? "protoboard-dark" : "protoboard-light")} />}
      </header>
      {showHierarchy && <ViewerHierarchy state={hierarchyState} command={hierarchyCommand} onStateChange={keepHierarchy} onOpenChange={setHierarchyOpen} />}
      <div className="workspace" role="tabpanel" aria-label={active?.title}>
        {active && <View key={active.id} module={c.levelDef} path={path} bundle={c.source.bundle} host={host} view={active} params={active.uhd ? undefined : params} />}
        {diagram && <ViewerInspector />}
      </div>
      <ViewerNodeMenu />
    </div>
  );
}

function Tab({ view, active, onClick }: { view: ViewDefinition; active: boolean; onClick: () => void }) {
  const planned = view.status === "planned";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tooltip={`${view.title}${planned ? " · planned" : ""}${view.description ? `: ${view.description}` : ""}`}
      onClick={onClick}
      className={cx(
        "relative flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 font-ui text-[12px] tracking-[-0.01em] transition-colors",
        active ? "bg-accent-tint text-fg outline outline-1 -outline-offset-1 outline-contrast-active" : "text-fg-muted hover:bg-hover hover:text-fg",
        planned && !active && "text-fg-faint",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <ViewIcon name={view.icon} size={15} strokeWidth={1.75} className={active ? "text-accent" : undefined} aria-hidden />
      <span className="max-[1180px]:hidden">{view.title}</span>
      {active && <span aria-hidden className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

function Breadcrumb() {
  const c = useViewer();
  const path = c.vm.path;
  return (
    <nav aria-label="Level" className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
      {path.map((p, i) => {
        const current = i === path.length - 1;
        return (
          <span key={p.id || "root"} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-fg-faint" aria-hidden />}
            <button
              type="button"
              aria-current={current ? "location" : undefined}
              onClick={() => c.onNavigate(i)}
              className={cx(
                "h-8 max-w-56 cursor-pointer truncate rounded-md px-2 font-ui text-[12px]",
                current ? "text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {p.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

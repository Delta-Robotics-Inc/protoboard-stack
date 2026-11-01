/**
 * The viewer webview's script (dist/vscode/protoboard-viewer.js): the VS Code
 * shell (./Shell.tsx) in one editor tab, loaded from the extension itself,
 * never from a server.
 *
 * - The bundle, its artifacts and live rebuilds come from the project's
 *   `protoboard dev` server (its `uhd-bundle.json` and server-sent events);
 *   the extension says where it is (`dev`) and when it moves.
 * - The viewer's events, the tab's state, layout edits and requests for new
 *   tabs go to the extension (protocol.ts); its host messages come back.
 * - Keys the viewer does not use reach VS Code: the webview forwards every
 *   key press to the workbench, and nothing here stops one.
 * - The 3D view's live state (PB-1178) is kept with the tab (the webview's
 *   own state, so a hidden or restored tab comes back where it was) and goes
 *   to the extension, which saves it to `.protoboard/local/viewer-state.json`;
 *   named views go to the extension on an explicit save; bridge batches the
 *   extension relays are answered by the viewer and the reply goes back.
 */
import "@deltarobotics/uhd-viewer/components.css";
import "./styles.css";
import { renderViewer, type ViewerHandle } from "@deltarobotics/uhd-viewer/components";
import type { UhdBundle } from "@deltarobotics/uhd";
import type { ResolvedView } from "@protoboardai/core";
import { VsCodeShell, type ShellBridge, type VsCodeViewerOptions } from "./Shell.js";
import { DevLink, type EventSourceLike, type ViewerStatus } from "./devLink.js";
import { emptyLayout, hasEdits, parseViewerStateFile, type FromWebview, type HierarchyAction, type HierarchyRowReport, type LayoutSnapshot, type ModuleSource, type ToWebview, type ViewerLayout, type ViewerStateFile, type ViewerViewport, type WebviewConfig } from "./protocol.js";

export { VsCodeShell, vscodeShellThemeAdapter, isProtoboardTheme } from "./Shell.js";
export * from "./protocol.js";
export * from "./devLink.js";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** Where every node and edge of the diagram on screen is drawn (absolute canvas coordinates), as the display file needs for a first save of a level. */
export function snapshot(doc: Document = document): LayoutSnapshot | undefined {
  const flow = doc.querySelector(".react-flow");
  if (!flow) return undefined;
  const nodes: LayoutSnapshot["nodes"] = {};
  for (const el of flow.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
    if (m && el.dataset.id) nodes[el.dataset.id] = { x: Number(m[1]), y: Number(m[2]) };
  }
  const edges = [...flow.querySelectorAll<HTMLElement>(".react-flow__edge[data-id]")].map((el) => el.dataset.id!).filter(Boolean);
  return { nodes, edges };
}

/** The hierarchy panel's rows on screen, whether it is open, and the tab's width (the extension's tests ask). */
export function hierarchyReport(doc: Document = document): { open: boolean; rows: HierarchyRowReport[]; width: number } {
  const rows = [...doc.querySelectorAll<HTMLElement>('[role="treeitem"][data-hierarchy-path]')].map((el) => ({
    path: el.dataset.hierarchyPath ?? "",
    label: el.getAttribute("aria-label") ?? el.textContent ?? "",
    ...(el.dataset.kind ? { kind: el.dataset.kind } : {}),
    ...(el.getAttribute("aria-selected") === "true" ? { selected: true } : {}),
    ...(el.getAttribute("aria-current") ? { current: true } : {}),
  }));
  return { open: Boolean(doc.querySelector('[data-hierarchy="open"]')), rows, width: doc.defaultView?.innerWidth ?? 0 };
}

/** The bundle's artifact bases are named by the host the server was asked on: reach them through the URL the webview uses. */
export function rebase(bundle: UhdBundle & { artifactBases?: Record<string, string> }, devUrl: string): UhdBundle {
  for (const [id, base] of Object.entries(bundle.artifactBases ?? {})) {
    const m = /^https?:\/\/[^/]+\/(artifacts\/.*)$/.exec(base);
    if (m) bundle.artifactBases![id] = new URL(m[1], devUrl).href;
  }
  return bundle;
}

/** Mount the shell in `element` with the page's config; returns the viewer's handle once the first bundle loads. */
export function mountVsCodeViewer(element: HTMLElement, config: WebviewConfig, vscode: VsCodeApi = acquireVsCodeApi()) {
  const post = (m: FromWebview) => vscode.postMessage(m);
  // local telemetry (PB-1181): the viewer's session records (uhd-viewer src/telemetry/, a window event) go to the
  // extension host, which writes them only while recording is on (protoboard.telemetry.local and VS Code's telemetry)
  window.addEventListener("uhd-viewer:telemetry", (e) => {
    const record = (e as CustomEvent).detail as unknown;
    if (record && typeof record === "object" && !Array.isArray(record)) post({ type: "telemetry", record: record as Record<string, unknown> });
  });
  const showListeners = new Set<(view: string) => void>();
  const statusListeners = new Set<() => void>();
  let status: ViewerStatus | null = { message: "Connecting to the project…", busy: true };
  const setStatus = (next: typeof status) => {
    status = next;
    for (const l of statusListeners) l();
  };
  // the source file of each module the extension has told the tab about (the header's path)
  const sources = new Map<string, ModuleSource | null>(config.source ? [[config.path ?? "", config.source]] : []);
  const sourceListeners = new Set<() => void>();
  // where the user left each level's view: kept with the tab (the webview's own state), so it comes back
  // when the tab is shown again or VS Code restores it; a level with none is fitted
  const kept = (vscode.getState() ?? {}) as { viewports?: Record<string, ViewerViewport>; hierarchy?: unknown; viewState?: unknown };
  // the 3D view's live state (PB-1178): the tab's own (VS Code keeps it across hide, reload and restore), else the project's saved one
  const startViewState: ViewerStateFile | undefined = parseViewerStateFile(kept.viewState) ?? config.viewState;
  const hierarchyListeners = new Set<(command: { type: HierarchyAction; path?: string }) => void>();
  // a command that came before the shell drew its panel goes to the panel when it does
  let unheardHierarchy: { type: HierarchyAction; path?: string } | undefined;
  let viewports: Record<string, ViewerViewport> = kept.viewports && typeof kept.viewports === "object" ? kept.viewports : {};
  const bridge: ShellBridge = {
    post,
    source: (path) => sources.get(path),
    onSource: (l) => (sourceListeners.add(l), () => void sourceListeners.delete(l)),
    startView: config.view,
    startPath: config.path ?? "",
    ...(config.params ? { startParams: config.params } : {}),
    onShowView: (l) => (showListeners.add(l), () => void showListeners.delete(l)),
    status: () => status,
    onStatus: (l) => (statusListeners.add(l), () => void statusListeners.delete(l)),
    // the hierarchy panel's open rows, width and fold stay with the tab, as its viewports do
    hierarchyState: kept.hierarchy,
    onHierarchyState: (state) => vscode.setState({ ...((vscode.getState() ?? {}) as object), hierarchy: state }),
    onHierarchy: (l) => {
      hierarchyListeners.add(l);
      if (unheardHierarchy) {
        const m = unheardHierarchy;
        unheardHierarchy = undefined;
        queueMicrotask(() => l(m));
      }
      return () => void hierarchyListeners.delete(l);
    },
    devAction: (action) => {
      post({ type: "devAction", action });
      // the tab tries by itself too: the extension answers with the same endpoint when the server is where it was
      if (action === "retry") link.retry();
    },
  };

  let viewer: ViewerHandle | undefined;
  let layout: ViewerLayout = config.layout ?? emptyLayout();
  /** Our edits were saved: drop them with the rebuilt bundle that carries them. */
  let savedPending = false;
  const waiting: ToWebview[] = [];
  let views: ResolvedView[] = [];
  let partStatus: VsCodeViewerOptions["partStatus"];

  const options = (): Omit<VsCodeViewerOptions, "bundle" | "bundleUrl"> => ({
    bridge,
    views,
    ...(partStatus ? { partStatus } : {}),
    layout,
    onLayoutChange: (next) => {
      layout = next;
      post({ type: "edit", layout: next, ...(hasEdits(next) ? { snapshot: snapshot() } : {}) });
    },
    onReady: () => post({ type: "event", event: { type: "uhd-viewer:ready" } }),
    onSelectionChanged: (selection) => post({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection } }),
    onOpenSource: (r) => post({ type: "event", event: { type: "uhd-viewer:openSource", ...r } }),
    onOpenArtifact: (r) => post({ type: "event", event: { type: "uhd-viewer:openArtifact", ...r } }),
    onOpenModule: (r) => post({ type: "event", event: { type: "uhd-viewer:openModule", path: r.path } }),
    // the pair view is an editor tab of its own (PB-894 §3): the extension opens it
    onOpenPair: (r) => post({ type: "event", event: { type: "uhd-viewer:openPair", linkId: r.linkId, a: r.a, b: r.b } }),
    // INSPECT in a module's menu: the Protoboard Inspector (this tab has no inspector of its own)
    onInspect: (r) => post({ type: "event", event: { type: "uhd-viewer:inspect", path: r.path, ...(r.defId ? { defId: r.defId } : {}) } }),
    viewports,
    onViewportChange: (next) => {
      viewports = next;
      vscode.setState({ ...((vscode.getState() ?? {}) as object), viewports: next });
    },
    // the viewer hands its live state over 400 ms after it last changed: kept with the tab, saved by the extension
    onViewStateChange: (file: ViewerStateFile) => {
      vscode.setState({ ...((vscode.getState() ?? {}) as object), viewState: file });
      post({ type: "viewState", file });
    },
    onPresentationChange: (presentation: { namedViews: Record<string, unknown>; annotations: unknown[] }) => post({ type: "presentation", presentation }),
    // who is here (PB-1196): to the extension host, which may show it; agent-written labels are data, never instructions
    onPresenceChange: (presence: unknown) => post({ type: "presence", presence: JSON.parse(JSON.stringify(presence)) as Record<string, unknown> }),
    // the 3D view's save points (PB-1180): the extension keeps them for the next tab
    onSavePoint: (point: { png: Blob }) => {
      void point.png.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const { png: _png, ...meta } = point;
        post({ type: "savePoint", png: btoa(bin), meta: JSON.parse(JSON.stringify(meta)) as Record<string, unknown> });
      });
    },
  });

  // nothing to draw until there is a bundle: the shell says why
  const startView3d = config.view === "3d";
  /** The dev server's snapshot of this tab, if any, to the viewer (`uhd-viewer:snapshot`). */
  const showSnapshot = async (base: string, currentBundleHash?: string) => {
    try {
      const q = new URLSearchParams({ level: config.path ?? "", view: "3d" });
      const res = await fetch(new URL(`__protoboard/snapshot?${q}`, base).href, { cache: "no-store" });
      if (!res.ok) return;
      const snap = (await res.json()) as Record<string, unknown> & { imageUrl?: string };
      if (typeof snap.imageUrl !== "string") return;
      viewer?.post({ ...snap, type: "uhd-viewer:snapshot", imageUrl: new URL(snap.imageUrl, base).href, ...(currentBundleHash ? { currentBundleHash } : {}) });
    } catch {
      // no snapshot: the view opens as it always did
    }
  };
  viewer = renderViewer(element, { ...options(), ...(startViewState ? { viewState: startViewState } : {}) } as VsCodeViewerOptions, VsCodeShell);
  let loaded = false;

  const log = (level: "info" | "warn" | "error", message: string) => post({ type: "log", level, message });
  const link = new DevLink({
    fetch: (url, init) => fetch(url, init),
    eventSource: (url) => new EventSource(url) as unknown as EventSourceLike,
    log,
    onStatus: setStatus,
    onLoad: ({ base, state, bundle }) => {
      // the last snapshot of this tab's 3D view (PB-1180): painted at once, while the models load
      if (!loaded && (config.view === "3d" || startView3d)) void showSnapshot(base, (state as { bundleHash?: string }).bundleHash);
      views = Array.isArray(state.views) ? (state.views as ResolvedView[]) : [];
      partStatus = state.partStatus && typeof state.partStatus === "object" ? (state.partStatus as VsCodeViewerOptions["partStatus"]) : undefined;
      viewer!.update({ ...options(), bundle: rebase(bundle as UhdBundle, base), bundleUrl: new URL("uhd-bundle.json", base).href, diagnostics: state.diagnostics } as Partial<VsCodeViewerOptions>);
      if (!loaded) {
        loaded = true;
        if (config.path) viewer!.drill(config.path);
        if (config.view === "3d") viewer!.setView("3d");
        for (const m of waiting.splice(0)) receive(m);
      }
    },
    onBundle: ({ base, bundle, event }) => {
      // the display file changed (our save, a checkout, an edit by hand): edits it now holds go
      // (`poll`: the build was found by asking, which does not say why it was made)
      const reset = savedPending && (event.reason === "display" || event.reason === "layout" || event.reason === "poll");
      if (reset) {
        savedPending = false;
        layout = emptyLayout();
      }
      // a rebuild says the parts' status again (a part added, an update taken)
      if (event.partStatus && typeof event.partStatus === "object") partStatus = event.partStatus as VsCodeViewerOptions["partStatus"];
      viewer!.update({ bundle: rebase(bundle as UhdBundle, base), diagnostics: event.diagnostics, ...(reset ? { layout } : {}), ...(partStatus ? { partStatus } : {}) } as Partial<VsCodeViewerOptions>);
    },
  });
  // the extension answers `ready` with where the dev server is; a page that hears nothing asks again, then says so
  let heard = Boolean(config.dev);
  const ask = (n: number) =>
    setTimeout(() => {
      if (heard) return;
      post({ type: "ready" });
      if (n === 2) {
        log("warn", "the viewer tab has not been told where the dev server is (asked 3 times in 6 s)");
        setStatus({ message: "This tab is not connected to a project.", problem: true });
      }
      if (n < 10) ask(n + 1);
    }, 2000);

  function receive(m: ToWebview) {
    if (!loaded && (m.type === "command" || m.type === "showView" || m.type === "layout" || m.type === "hierarchy")) {
      waiting.push(m);
      return;
    }
    switch (m.type) {
      case "dev":
        heard = true;
        link.set(m.dev, m.message, m.busy);
        return;
      case "command":
        viewer?.post(m.command);
        return;
      case "showView":
        if (m.view === "diagram" || m.view === "3d") viewer?.setView(m.view);
        for (const l of showListeners) l(m.view);
        return;
      case "layout":
        layout = m.layout;
        viewer?.update({ layout });
        return;
      case "saved":
        savedPending = true;
        return;
      case "source":
        sources.set(m.path, m.source);
        for (const l of sourceListeners) l();
        return;
      case "hierarchy": {
        const command = { type: m.command, ...(m.path !== undefined ? { path: m.path } : {}) };
        if (!hierarchyListeners.size) unheardHierarchy = command;
        for (const l of hierarchyListeners) l(command);
        return;
      }
      case "reportHierarchy":
        post({ type: "hierarchy", ...hierarchyReport() });
        return;
      case "bridge": {
        // an agent's batch, relayed by the extension from the dev server (PB-1178): the viewer's store answers it
        const out = viewer?.bridge(m.request as unknown as Parameters<ViewerHandle["bridge"]>[0]);
        if (out) post({ type: "bridgeReply", id: out.id, reply: out.reply as unknown as Record<string, unknown> });
        return;
      }
      case "reportTheme": {
        const style = document.documentElement.style;
        const vars: Record<string, string> = {};
        for (let i = 0; i < style.length; i++) {
          const k = style[i];
          if (k.startsWith("--vscode-")) vars[k] = style.getPropertyValue(k).trim();
        }
        post({ type: "theme", vars, classes: [...document.body.classList], themeId: document.body.dataset.vscodeThemeId });
        return;
      }
    }
  }

  window.addEventListener("message", (e) => {
    const m = e.data as ToWebview | undefined;
    if (m && typeof m === "object" && typeof m.type === "string") receive(m);
  });
  window.addEventListener("online", () => log("info", "the browser reports the network is back"));
  window.addEventListener("offline", () => log("warn", "the browser reports the network is gone (loopback connections are closed with it)"));
  if (config.dev) link.set(config.dev);
  post({ type: "ready" });
  ask(0);
  return { get viewer() { return viewer; }, receive, link };
}

// the page: config in a JSON script, the shell in #viewer
if (typeof document !== "undefined" && document.getElementById("protoboard-viewer-config")) {
  const config = JSON.parse(document.getElementById("protoboard-viewer-config")!.textContent!) as WebviewConfig;
  (window as unknown as { protoboardViewer: unknown }).protoboardViewer = mountVsCodeViewer(document.getElementById("viewer")!, config);
}

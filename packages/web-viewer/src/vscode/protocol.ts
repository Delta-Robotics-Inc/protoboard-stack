/**
 * The messages between the VS Code extension and its viewer webview (the
 * VS Code shell, ./Shell.tsx). One viewer editor tab is one webview showing
 * one module of a project; the bundle and live rebuilds come from the
 * project's `protoboard dev` server, everything else (selection, sources,
 * artifacts, new tabs, layout saving, the Atlas's positions and the files it
 * opens) goes through the extension: the webview never holds the dev
 * server's write token.
 *
 * The System Map (docs/specs/system-map.md) is the one thing a page reads
 * from the extension instead of the dev server: it is the map of the stack
 * the extension runs, whatever project is open. A viewer tab's System Map
 * tab and the extension's System Map panel (`mode: "sysmap"`, a page with no
 * project) ask for it (`sysmap`) and open its files (`sysmapOpen`) the same way.
 *
 * No React and no VS Code API here: the extension imports this file too.
 */
import type { SysmapGraph } from "@protoboardai/core/sysmap";

/** The viewer's own host messages, as the extension sends them (uhd-viewer's protocol). */
export type ViewerCommand =
  | { type: "uhd-viewer:focus"; path: string }
  | { type: "uhd-viewer:select"; ids: string[]; reveal?: boolean }
  | { type: "uhd-viewer:drill"; path: string }
  | { type: "uhd-viewer:setView"; view: "diagram" | "3d" };

export interface ViewerSelection {
  kind: "node" | "link";
  id: string;
  defId?: string;
  /** Modules selected together (two or more, paths from the root); `id` is the first (QA B10). */
  ids?: string[];
}

/** As in uhd-viewer's host contract (`LinkLayout`). */
export interface LinkLayout {
  waypoints?: [number, number][];
  labelT?: number;
  labelFlip?: boolean;
  tabT?: number;
  tabFlip?: boolean;
}

/** As in uhd-viewer's host contract (`ViewerLayout`): both maps keyed by drill level ("" = top). */
export interface ViewerLayout {
  positions: Record<string, Record<string, { x: number; y: number }>>;
  links: Record<string, Record<string, LinkLayout>>;
}

/** Where every node and edge of the diagram on screen is drawn (as the dev server's layout route takes it). */
export interface LayoutSnapshot {
  nodes: Record<string, { x: number; y: number }>;
  edges: string[];
}

/** What the page starts with (a JSON script in the page). */
export interface WebviewConfig {
  /**
   * `viewer` (the default): a viewer tab, the VS Code shell on a project.
   * `sysmap`: the extension's System Map panel, the System Map alone (no
   * project, no bundle, no dev server); `path` and `view` are not read.
   */
  mode?: "viewer" | "sysmap";
  /** The module the tab shows: its instance path ("" is the root system). */
  path: string;
  /** The view the tab opens on (`diagram`, `3d`, or a registry view id). */
  view: string;
  /** The extension's media folder as the webview reaches it, no trailing slash. */
  media: string;
  /** The dev server, when it is already known. */
  dev?: DevEndpoint;
  /** A layout the tab had (a restored backup or unsaved edits). */
  layout?: ViewerLayout;
  /** What the view was opened with (the pair view's `link`, `a`, `b`), as `ViewProps.params`. */
  params?: Record<string, string>;
  /** The source file of the module the tab opens on, when the extension knows it already. */
  source?: ModuleSource;
}

/** The file a module is written in: project-relative, with the line of its definition when the build records it. */
export interface ModuleSource {
  file: string;
  line?: number;
}

/** A view of the diagram, as uhd-viewer's host contract has it (`ViewerViewport`). */
export interface ViewerViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DevEndpoint {
  /** The dev server's page URL as the webview reaches it, with a trailing slash. */
  url: string;
  session: string;
}

/** Extension → webview. */
export type ToWebview =
  /** The dev server to load from (`null`: there is none; `message` says why). */
  | { type: "dev"; dev: DevEndpoint | null; message?: string; busy?: boolean }
  /** A host message for the viewer (focus, select, drill, setView). */
  | { type: "command"; command: ViewerCommand }
  /** Show a view of the tab's registry (`diagram`, `3d`, `schematic`, …). */
  | { type: "showView"; view: string }
  /** Replace the viewer's layout edits (undo, redo, revert). */
  | { type: "layout"; layout: ViewerLayout }
  /** The edits were written to the display file: drop them once the rebuilt bundle carries them. */
  | { type: "saved" }
  /** The source file of the module the tab shows now (`null`: none is recorded), for the header's path. */
  | { type: "source"; path: string; source: ModuleSource | null }
  /** Test hook: report the page's `--vscode-*` variables and body classes. */
  | { type: "reportTheme" }
  /**
   * The tab's hierarchy panel (PB-1042): show a module's row (`reveal`, with its
   * instance path), put the keyboard in its filter, open or fold it.
   */
  | { type: "hierarchy"; command: HierarchyAction; path?: string }
  /** Test hook: report the hierarchy panel's rows. */
  | { type: "reportHierarchy" }
  /** The answer to the page's `sysmap`: the System Map of the stack the extension runs, or why there is none. */
  | SysmapReply;

/** The extension's System Map answer (`sysmapGraph(map)`), or what failed. */
export type SysmapReply = { type: "sysmap"; graph: SysmapGraph } | { type: "sysmap"; error: string };

export type HierarchyAction = "reveal" | "filter" | "open" | "close" | "toggle";

/** One row of a tab's hierarchy panel, as the page reports it (tests). */
export interface HierarchyRowReport {
  path: string;
  label: string;
  kind?: string;
  selected?: boolean;
  current?: boolean;
}

/**
 * What a hierarchy row tells VS Code for its right-click menu (`data-vscode-context`;
 * the manifest's `webview/context` menus read it, and the commands get it as their argument).
 */
export interface HierarchyRowContext {
  webviewSection: "hierarchy";
  /** The module's instance path ("" is the root). */
  pbPath: string;
  pbKind: string;
  pbDefId: string;
  /** It has a level of its own (Open in New Tab). */
  pbLevel: boolean;
  /** Its definition lists artifacts. */
  pbArtifacts: boolean;
  preventDefaultContextMenuItems: true;
}

/** A command's argument when it comes from a hierarchy row's menu: the row's context with the webview's id; anything else is undefined. */
export function hierarchyRowArg(v: unknown): { path: string; defId?: string } | undefined {
  if (!obj(v) || v.webviewSection !== "hierarchy" || !str(v.pbPath)) return undefined;
  return { path: v.pbPath, ...(str(v.pbDefId) && v.pbDefId ? { defId: v.pbDefId } : {}) };
}

/** Webview → extension. */
export type FromWebview =
  /** The page runs. The extension answers every one with where the dev server is (`dev`): a page that loaded again asks again. */
  | { type: "ready" }
  /** A line for the extension's log (Protoboard: Show Log): what the page tried to reach and the error it got. */
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  /** The buttons of the tab's dev server message: find or start the server again, reload the window, show the log. */
  | { type: "devAction"; action: DevAction }
  /** The viewer's events: ready, selectionChanged, openSource, openArtifact, openModule, openPair. */
  | { type: "event"; event: ViewerEvent }
  /** What the tab shows now: the level, its label, the view, how many nodes the diagram draws. */
  | {
      type: "state";
      path: string;
      label: string;
      view: string;
      nodes: number;
      views: { id: string; title: string }[];
      error?: string;
      /** Definitions the bundle names and does not hold (drawn as placeholders). */
      missing?: number;
      /** The module the tab is on when it is not the level shown: a part with nothing inside, opened as a tab (its `label` is the part's). */
      at?: string;
    }
  /** The layout edits changed (`dirty`: edits beyond what the display file holds). */
  | { type: "edit"; layout: ViewerLayout; snapshot?: LayoutSnapshot }
  /** Open a view of a module as its own editor tab (`params` as the view takes them). */
  | { type: "openView"; view: string; path: string; params?: Record<string, string> }
  | { type: "notify"; message: string; severity?: "info" | "warning" | "error" }
  /** The header's path of the module in view: open its file, show it in the Explorer, or copy its path. */
  | { type: "source"; action: SourceAction }
  | { type: "theme"; vars: Record<string, string>; classes: string[]; themeId?: string }
  /** The hierarchy panel's rows (`reportHierarchy`), whether it is open, and the tab's width in CSS pixels. */
  | { type: "hierarchy"; open: boolean; rows: HierarchyRowReport[]; width?: number }
  /** The Atlas view's positions after a settle (node id to [x, y]): the extension keeps them in the display file's `atlas` key, at once (no Ctrl+S). */
  | { type: "atlasLayout"; positions: Record<string, [number, number]> }
  /** The Atlas inspector's Open: a project file by its project-relative path (forward slashes); the extension checks it lies inside the project. */
  | { type: "openFile"; path: string }
  /** The System Map, please (`refresh`: the panel's Rebuild, build it again first). The extension answers `sysmap` with the graph or an error. */
  | { type: "sysmap"; refresh?: true }
  /** The System Map inspector's Open: a stack file by its stack-relative path (an item's `source` without its `#entry`); the extension checks it lies inside the stack. */
  | { type: "sysmapOpen"; path: string };

export type SourceAction = "open" | "reveal" | "copy" | "copyRelative";
const SOURCE_ACTIONS: readonly SourceAction[] = ["open", "reveal", "copy", "copyRelative"];

/**
 * `signIn`, `signInDevice`, `signOut` and `checkAccount` are account buttons a page may show (Fetch Parts asks for a
 * sign-in); `openLibrary` is an empty level's Add a part: the Library side bar.
 */
export type DevAction = "retry" | "reload" | "showLog" | "signIn" | "signInDevice" | "signOut" | "checkAccount" | "fetchParts" | "openLibrary";
const DEV_ACTIONS: readonly DevAction[] = ["retry", "reload", "showLog", "signIn", "signInDevice", "signOut", "checkAccount", "fetchParts", "openLibrary"];

export type ViewerEvent =
  | { type: "uhd-viewer:ready" }
  | { type: "uhd-viewer:selectionChanged"; selection: ViewerSelection | null }
  | { type: "uhd-viewer:openSource"; defId: string; instancePath?: string }
  | { type: "uhd-viewer:openArtifact"; defId: string; artifactId: string }
  | { type: "uhd-viewer:openModule"; path: string }
  | { type: "uhd-viewer:openPair"; linkId: string; a: string; b: string }
  /** INSPECT in a module's context menu: the Protoboard Inspector, in front and focused. */
  | { type: "uhd-viewer:inspect"; path: string; defId?: string };

const str = (v: unknown): v is string => typeof v === "string";
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An empty layout: no edits. */
export const emptyLayout = (): ViewerLayout => ({ positions: {}, links: {} });

/** A layout holds edits when any level has a moved node or an edited link. */
export function hasEdits(layout: ViewerLayout | undefined): boolean {
  if (!layout) return false;
  return Object.values(layout.positions ?? {}).some((l) => Object.keys(l ?? {}).length > 0) || Object.values(layout.links ?? {}).some((l) => Object.keys(l ?? {}).length > 0);
}

function parseLayout(v: unknown): ViewerLayout | undefined {
  if (!obj(v) || !obj(v.positions) || !obj(v.links)) return undefined;
  for (const level of Object.values(v.positions)) {
    if (!obj(level)) return undefined;
    for (const p of Object.values(level)) if (!obj(p) || typeof p.x !== "number" || typeof p.y !== "number") return undefined;
  }
  for (const level of Object.values(v.links)) if (!obj(level) || !Object.values(level).every(obj)) return undefined;
  return v as unknown as ViewerLayout;
}

function parseSnapshot(v: unknown): LayoutSnapshot | undefined {
  if (!obj(v) || !obj(v.nodes) || !Array.isArray(v.edges) || !v.edges.every(str)) return undefined;
  for (const p of Object.values(v.nodes)) if (!obj(p) || typeof p.x !== "number" || typeof p.y !== "number") return undefined;
  return v as unknown as LayoutSnapshot;
}

/** A view's params: a few short strings by name, nothing else. */
export function parseParams(v: unknown): Record<string, string> | undefined {
  if (!obj(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (/^[a-z][a-zA-Z0-9]{0,31}$/.test(k) && str(x) && x.length <= 512) out[k] = x;
  return Object.keys(out).length && Object.keys(out).length <= 8 ? out : undefined;
}

function parseEvent(v: unknown): ViewerEvent | undefined {
  if (!obj(v)) return undefined;
  switch (v.type) {
    case "uhd-viewer:ready":
      return { type: v.type };
    case "uhd-viewer:selectionChanged": {
      const s = v.selection;
      if (s === null || s === undefined) return { type: v.type, selection: null };
      if (!obj(s) || (s.kind !== "node" && s.kind !== "link") || !str(s.id)) return undefined;
      const ids = Array.isArray(s.ids) ? s.ids.filter(str).slice(0, 500) : [];
      return { type: v.type, selection: { kind: s.kind, id: s.id, ...(str(s.defId) ? { defId: s.defId } : {}), ...(ids.length > 1 ? { ids } : {}) } };
    }
    case "uhd-viewer:openSource":
      return str(v.defId) ? { type: v.type, defId: v.defId, ...(str(v.instancePath) ? { instancePath: v.instancePath } : {}) } : undefined;
    case "uhd-viewer:openArtifact":
      return str(v.defId) && str(v.artifactId) ? { type: v.type, defId: v.defId, artifactId: v.artifactId } : undefined;
    case "uhd-viewer:openModule":
      return str(v.path) ? { type: v.type, path: v.path } : undefined;
    case "uhd-viewer:openPair":
      return str(v.linkId) && str(v.a) && str(v.b) ? { type: v.type, linkId: v.linkId, a: v.a, b: v.b } : undefined;
    case "uhd-viewer:inspect":
      return str(v.path) ? { type: v.type, path: v.path, ...(str(v.defId) ? { defId: v.defId } : {}) } : undefined;
    default:
      return undefined;
  }
}

/** What an Atlas layout may hold (as the dev server's layout route, packages/cli/src/dev/atlas.ts). */
export const ATLAS_LAYOUT_LIMITS = { ids: 50_000, idLength: 512, coordinate: 1e9 } as const;
const ATLAS_NODE_ID = /^[a-z][a-z0-9-]*:/;
const coordinate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= ATLAS_LAYOUT_LIMITS.coordinate;

/** Atlas positions: at most 50 000 node ids (`def:…`, `file:…`), each at most 512 characters, with two finite numbers each; anything else is undefined. */
export function parseAtlasPositions(v: unknown): Record<string, [number, number]> | undefined {
  if (!obj(v)) return undefined;
  const entries = Object.entries(v);
  if (entries.length > ATLAS_LAYOUT_LIMITS.ids) return undefined;
  const out: Record<string, [number, number]> = {};
  for (const [id, p] of entries) {
    if (id.length > ATLAS_LAYOUT_LIMITS.idLength || !ATLAS_NODE_ID.test(id)) return undefined;
    if (!Array.isArray(p) || p.length !== 2 || !coordinate(p[0]) || !coordinate(p[1])) return undefined;
    out[id] = [p[0], p[1]];
  }
  return out;
}

/**
 * A project file's path as the Atlas names it: relative, forward slashes, at
 * most 1024 characters, no empty, `.` or `..` segment, no drive, colon,
 * backslash or control character. Anything else is undefined. (Whether it
 * lies inside the project once links are followed is the extension's check.)
 */
export function parseProjectPath(v: unknown): string | undefined {
  if (!str(v) || !v.length || v.length > 1024) return undefined;
  if (/[\\:]/.test(v) || [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) || v.startsWith("/")) return undefined;
  return v.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..") ? v : undefined;
}

/**
 * A stack file's path as the System Map names it (an item's `source`): the
 * `#entry` it may end with is dropped, and what is left is checked as
 * `parseProjectPath` checks a project's (relative, forward slashes, at most
 * 1024 characters, no `.` or `..` segment, no drive, colon or backslash).
 * Anything else is undefined. (Whether it lies inside the stack once links
 * are followed is the extension's check.)
 */
export function parseStackPath(v: unknown): string | undefined {
  if (!str(v) || v.length > 2048) return undefined;
  const hash = v.indexOf("#");
  return parseProjectPath(hash < 0 ? v : v.slice(0, hash));
}

/** A message from the webview, checked field by field; anything else is undefined. */
export function parseFromWebview(data: unknown): FromWebview | undefined {
  if (!obj(data)) return undefined;
  switch (data.type) {
    case "ready":
      return { type: "ready" };
    case "log": {
      if (!str(data.message)) return undefined;
      const level = data.level === "warn" || data.level === "error" ? data.level : "info";
      return { type: "log", level, message: data.message.slice(0, 2000) };
    }
    case "devAction":
      return (DEV_ACTIONS as readonly unknown[]).includes(data.action) ? { type: "devAction", action: data.action as DevAction } : undefined;
    case "event": {
      const event = parseEvent(data.event);
      return event && { type: "event", event };
    }
    case "state": {
      if (!str(data.path) || !str(data.label) || !str(data.view) || typeof data.nodes !== "number") return undefined;
      const views = Array.isArray(data.views) ? data.views.filter((v): v is { id: string; title: string } => obj(v) && str(v.id) && str(v.title)).map((v) => ({ id: v.id, title: v.title })) : [];
      return { type: "state", path: data.path, label: data.label, view: data.view, nodes: data.nodes, views, ...(str(data.error) ? { error: data.error } : {}), ...(typeof data.missing === "number" && data.missing > 0 ? { missing: data.missing } : {}), ...(str(data.at) && data.at ? { at: data.at } : {}) };
    }
    case "edit": {
      const layout = parseLayout(data.layout);
      if (!layout) return undefined;
      const snapshot = data.snapshot === undefined ? undefined : parseSnapshot(data.snapshot);
      return { type: "edit", layout, ...(snapshot ? { snapshot } : {}) };
    }
    case "openView": {
      if (!str(data.view) || !str(data.path)) return undefined;
      const params = parseParams(data.params);
      return { type: "openView", view: data.view, path: data.path, ...(params ? { params } : {}) };
    }
    case "notify": {
      if (!str(data.message)) return undefined;
      const severity = data.severity === "warning" || data.severity === "error" || data.severity === "info" ? data.severity : undefined;
      return { type: "notify", message: data.message, ...(severity ? { severity } : {}) };
    }
    case "source":
      return (SOURCE_ACTIONS as readonly unknown[]).includes(data.action) ? { type: "source", action: data.action as SourceAction } : undefined;
    case "theme": {
      if (!obj(data.vars) || !Array.isArray(data.classes)) return undefined;
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.vars)) if (str(v) && k.startsWith("--vscode-")) vars[k] = v;
      return { type: "theme", vars, classes: data.classes.filter(str), ...(str(data.themeId) ? { themeId: data.themeId } : {}) };
    }
    case "hierarchy": {
      if (typeof data.open !== "boolean" || !Array.isArray(data.rows)) return undefined;
      const rows = data.rows
        .filter((r): r is Record<string, unknown> => obj(r) && str(r.path) && str(r.label))
        .slice(0, 5000)
        .map((r) => ({ path: r.path as string, label: r.label as string, ...(str(r.kind) ? { kind: r.kind } : {}), ...(r.selected === true ? { selected: true } : {}), ...(r.current === true ? { current: true } : {}) }));
      return { type: "hierarchy", open: data.open, rows, ...(typeof data.width === "number" && Number.isFinite(data.width) ? { width: data.width } : {}) };
    }
    case "atlasLayout": {
      const positions = parseAtlasPositions(data.positions);
      return positions && { type: "atlasLayout", positions };
    }
    case "openFile": {
      const path = parseProjectPath(data.path);
      return path === undefined ? undefined : { type: "openFile", path };
    }
    case "sysmap":
      return data.refresh === true ? { type: "sysmap", refresh: true } : { type: "sysmap" };
    case "sysmapOpen": {
      const path = parseStackPath(data.path);
      return path === undefined ? undefined : { type: "sysmapOpen", path };
    }
    default:
      return undefined;
  }
}

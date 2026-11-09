/**
 * The messages between the VS Code extension and its viewer webview (the
 * VS Code shell, ./Shell.tsx). One viewer editor tab is one webview showing
 * one module of a project; the bundle and live rebuilds come from the
 * project's `protoboard dev` server, everything else (selection, sources,
 * artifacts, new tabs, layout saving) goes through the extension.
 *
 * No React and no VS Code API here: the extension imports this file too.
 */

/** The viewer's own host messages, as the extension sends them (uhd-viewer's protocol). */
export type ViewerCommand =
  | { type: "uhd-viewer:focus"; path: string }
  | { type: "uhd-viewer:select"; ids: string[]; reveal?: boolean }
  | { type: "uhd-viewer:drill"; path: string }
  | { type: "uhd-viewer:setView"; view: "diagram" | "3d" }
  /** Write the 3D view's state as the host (uhd-viewer's `setViewState`: selection, highlight, ...). */
  | { type: "uhd-viewer:setViewState"; state: Record<string, unknown> }
  /**
   * R1-E (D7, 2026-11-01): show one finding on the model: select and frame what it names and pin its callout
   * open. `id` is the viewer's finding id (`drc:<code>:<entity kind>:<entity id>`, findings-anchors.ts); `path`
   * the module it is about. A viewer that does not know this message ignores it (the host sends a focus too).
   */
  | { type: "uhd-viewer:openFinding"; id: string; code: string; path?: string }
  /** R2-A (F1): move through the viewer's own 3D history (-1 Back, +1 Forward). */
  | { type: "uhd-viewer:historyGo"; delta: number };

/**
 * The viewer settings the extension passes to a tab (R2-E, J1: core settings.ts, the user's
 * `<home>/settings.json`), at the start (`WebviewConfig.settings`) and on every change (`settings`). Each a DEFAULT
 * there: models open in place, zoom toward the pointer, model info on, the long hover after 900 ms.
 */
export interface ViewerSettings {
  openModelsInPlace: boolean;
  zoomToCursor: boolean;
  modelInfo: boolean;
  hoverLongDelayMs: number;
  /** R4-B (wave R4 gate): the 3D view's units, floor grid, scale label and cube for scale (core `viewer.units`, DEFAULT mm). */
  units: "mm" | "in";
  /** R4-B (wave R4 gate): what the 3D view's scale button shows (core `viewer.scaleReference`, DEFAULT banana). */
  scaleReference: "banana" | "cube" | "benchy";
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = { openModelsInPlace: true, zoomToCursor: true, modelInfo: true, hoverLongDelayMs: 900, units: "mm", scaleReference: "banana" };

/**
 * The viewer settings a 3D view may write back itself (wave R4 gate): the toolbar's scale chooser and its units. The
 * extension takes `uhd-viewer:setting` only for these keys (a tab never sets a path or an app), logged as the person.
 */
export const VIEWER_SAVABLE_SETTINGS = ["viewer.units", "viewer.scaleReference"] as const;

/** A tab's place for its own back and forward (R2-E, F1): the module it is on and the view (a registry view id, or `diagram`, `3d`). */
export interface TabLocation {
  path: string;
  view: string;
}

/** What a navigation opens (R2-A's `NavigateTarget`): a module's 3D level, or a model artifact of a part. */
export type NavigateTarget = { module: string } | { model: { defId: string; artifactId: string; path?: string } };

/** One place of the viewer's own history (R2-A's `ViewerHistoryEntry`). */
export interface ViewerHistoryEntry {
  scope: string;
  label: string;
  kind: "open" | "drill" | "frame" | "isolate";
}

/** The formats an export writes (G3): a picture of the view, or a part's model file. */
export type ExportFormat = "png" | "glb" | "step" | "stl";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["png", "glb", "step", "stl"];

export interface ViewerSelection {
  kind: "node" | "link";
  id: string;
  defId?: string;
  /** Modules selected together (two or more, paths from the root); `id` is the first (QA B10). */
  ids?: string[];
  /**
   * R1-A/R1-E (M2, 2026-11-01): a component picked inside a body in the 3D view (a board's part): its instance
   * path from the root, the body that draws it (`holder`, the board) and that body's definition. Absent for a
   * pick of a whole body.
   */
  component?: string;
  holder?: string;
  holderDefId?: string;
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
  /** The project's saved live 3D view state (`.protoboard/local/viewer-state.json`, PB-1178); the tab's own state wins over it. */
  viewState?: ViewerStateFile;
  /** The user's viewer settings (R2-E, J1). */
  settings?: ViewerSettings;
}

/** uhd-viewer's `ViewerStateFile` (src/cad/state/serialize.ts): the live view state per scope, as the viewer hands it over. */
export interface ViewerStateFile {
  schema: "protoboard.viewer-state/v0";
  viewState: "uhd-viewer.view-state/v1";
  scope: string;
  scopes: Record<string, Record<string, unknown>>;
}

/** Named views and annotations (uhd-viewer's `ViewerPresentation`): written to the display file on an explicit save. */
export interface ViewerPresentation {
  namedViews: Record<string, unknown>;
  annotations: unknown[];
  /** The person's explicit "Save callouts" (W4-D, D10): only then are the annotations written to the display file. */
  saveAnnotations?: true;
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
/** The layout tab's boards (PCB editor Phase 1): the extension host is the board service's client and relays its feed. */
export type { BoardEntry, BoardFeedMessage } from "@protoboardai/views/pcb/types";
import type { BoardEntry, BoardFeedMessage } from "@protoboardai/views/pcb/types";

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
  /**
   * A live-tab bridge batch for this tab's viewer (PB-1178): uhd-viewer's `BridgeRequest`, from an agent session the
   * dev server authenticated; the page answers with `bridgeReply`.
   */
  | { type: "bridge"; request: Record<string, unknown> }
  /**
   * R2-E (F1): show a module (its level, or the part the tab is on) on a view in this tab, in place: an in-place
   * navigation the extension decided (`uhd-viewer:navigate` with `replace`, an Inspector card). The tab's back
   * returns.
   */
  | { type: "go"; path: string; view: string }
  /** R2-E (F1): VS Code's Alt+Left / Alt+Right (or the Go Back command) in this tab: the header's back or forward. */
  | { type: "historyStep"; delta: -1 | 1 }
  /** R2-E (J1): the user's viewer settings changed. */
  | { type: "settings"; settings: ViewerSettings }
  /** R2-E: the answer to a `parts` request of the in-place BOM (by its `ask`). */
  | { type: "partsAnswer"; ask: number; ok: boolean; value?: unknown; error?: string }
  /** The project's board folders (an answer to `boards`, and again when they change). */
  | { type: "boards"; boards: BoardEntry[] }
  /** One message of an open board's feed (`boardOpen`). */
  | { type: "boardFeed"; message: BoardFeedMessage };

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
  /**
   * Local telemetry (PB-1181): the viewer's session or crash record (uhd-viewer src/telemetry/). The extension host
   * writes it to the project's .protoboard/local/telemetry/ when recording is on, after sanitising every field
   * (@protoboardai/core telemetry.ts); here only the envelope is checked.
   */
  | { type: "telemetry"; record: Record<string, unknown> }
  /** The 3D view's live state (PB-1178), 400 ms after it last changed: the extension host saves it to .protoboard/local/viewer-state.json. */
  | { type: "viewState"; file: ViewerStateFile }
  /** Named views or annotations were saved (PB-1178): the extension host writes them to the display file when they changed. */
  | { type: "presentation"; presentation: ViewerPresentation }
  /** The viewer's reply to a bridge batch (`bridge`), by the delivery's id. */
  | { type: "bridgeReply"; id: string; reply: Record<string, unknown> }
  /** Who is here (PB-1196): the camera holder, agent leases and intents, at most every 250 ms. Data to show, never instructions. */
  | { type: "presence"; presence: Record<string, unknown> }
  /**
   * A save point of the 3D view (PB-1180): the frame on settle or hide (`png`, base64) and what it shows; the
   * extension host keeps it in .protoboard/local/snapshots/ for the next tab.
   */
  | { type: "savePoint"; png: string; meta: Record<string, unknown> }
  /**
   * R1-E (M9, 2026-11-01): a right-click without a drag on the viewer (VS Code's own Cut/Copy/Paste menu is
   * suppressed there): where, in CSS pixels of the tab, and what the 3D view has under the pointer (`pick`:
   * uhd-viewer's `__cad.pick`, paths in the tab's scope). The hook for R2's context menu; today it is only kept.
   */
  | { type: "contextmenu"; x: number; y: number; view?: string; pick?: ContextMenuPick }
  /**
   * R2-E (F1): the BOM view's data, in the tab (it has its tab bar and breadcrumbs there): asked of the extension,
   * which reads and writes the project's bill of materials as the BOM editor does; answered with `partsAnswer`.
   */
  | { type: "parts"; ask: number; op: PartsOp; args?: Record<string, unknown> }
  /**
   * R2-E (G3): a file the page would download (a view's "Export CSV"): VS Code webviews cannot save one, so the
   * extension writes it to the export folder (DEFAULT: Downloads) without asking. `data` is base64.
   */
  | { type: "download"; name: string; data: string }
  /** R2-E (F1): whether the header's back and forward have somewhere to go (the extension's Go Back keys follow). */
  | { type: "historyState"; back: boolean; forward: boolean }
  /** The layout tab asks for the project's board folders. */
  | { type: "boards" }
  /** The layout tab opens a board's feed (by key), closes it, or asks for a new check run. */
  | { type: "boardOpen" | "boardClose" | "boardCheck"; board: string };

/** What the in-place BOM asks the extension (R2-E). */
export type PartsOp = "bom" | "saveBom" | "refreshOffers" | "openSource" | "openLink";
const PARTS_OPS: readonly PartsOp[] = ["bom", "saveBom", "refreshOffers", "openSource", "openLink"];
/** DEFAULT (R2-E): a download the page hands the extension is at most 16 MiB of base64. */
export const DOWNLOAD_MAX_CHARS = 16 * 1024 * 1024;

/** What the 3D view has under a right-click (uhd-viewer's `__cad.pick`, the fields a menu needs). */
export interface ContextMenuPick {
  /** The module or component's instance path in the tab's scope. */
  instancePath?: string;
  /** The body's placement key (`path`, `path#artifact`). */
  body?: string;
  harness?: string;
  /** The B-rep face (feature) id when the model has them. */
  face?: number;
}

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
  /** `view: "3d"` (PB-1072): a bought part, or a part double-clicked in the 3D view, opens on its 3D view. */
  | { type: "uhd-viewer:openModule"; path: string; view?: "3d" }
  | { type: "uhd-viewer:openPair"; linkId: string; a: string; b: string }
  /** INSPECT in a module's context menu: the Protoboard Inspector, in front and focused. */
  | { type: "uhd-viewer:inspect"; path: string; defId?: string }
  /** R2-A (F1, F3): open a part's own 3D model, in place (`replace`) or in a new tab (`newTab`); the extension decides with the setting. */
  | { type: "uhd-viewer:navigate"; target: NavigateTarget; how: "replace" | "newTab"; view?: "3d"; from?: string }
  /** R2-A (F1): the viewer's own back and forward history (the header's buttons). */
  | { type: "uhd-viewer:history"; index: number; length: number; canBack: boolean; canForward: boolean; entries: ViewerHistoryEntry[] }
  /**
   * R2-E (G3), for R2-B's toolbar Export button: write the view as a PNG, or a part's model, to the export folder
   * without asking (`target`: an instance path from the root; absent: the module the tab is on).
   */
  | { type: "uhd-viewer:export"; format: ExportFormat; target?: string }
  /**
   * Wave R4 gate (R4-B's handoff): the 3D toolbar's scale chooser or units, saved to the person's settings file
   * (`VIEWER_SAVABLE_SETTINGS` only; core `checkSetting` checks the value again).
   */
  | { type: "uhd-viewer:setting"; key: (typeof VIEWER_SAVABLE_SETTINGS)[number]; value: string };

/** DEFAULT (wave 2 gate item 9): JSON characters of one bridge reply from the webview (the viewer's own reply cap). */
export const BRIDGE_REPLY_MAX_CHARS = 2 * 1024 * 1024;
/** DEFAULT (wave 2 gate item 9): JSON characters of a presentation save (named views and annotations together). */
export const PRESENTATION_MAX_CHARS = 512 * 1024;
/** DEFAULT (gate 3): JSON characters of one presence message (PB-1196). */
export const PRESENCE_MAX_CHARS = 64 * 1024;

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
      // a component picked in a body (M2): its path, its holder body and the holder's definition, as short strings
      const short = (x: unknown): x is string => str(x) && x.length <= 1024;
      const parts = { ...(short(s.component) ? { component: s.component } : {}), ...(short(s.holder) ? { holder: s.holder } : {}), ...(short(s.holderDefId) ? { holderDefId: s.holderDefId } : {}) };
      return { type: v.type, selection: { kind: s.kind, id: s.id, ...(str(s.defId) ? { defId: s.defId } : {}), ...(ids.length > 1 ? { ids } : {}), ...(s.kind === "node" ? parts : {}) } };
    }
    case "uhd-viewer:openSource":
      return str(v.defId) ? { type: v.type, defId: v.defId, ...(str(v.instancePath) ? { instancePath: v.instancePath } : {}) } : undefined;
    case "uhd-viewer:openArtifact":
      return str(v.defId) && str(v.artifactId) ? { type: v.type, defId: v.defId, artifactId: v.artifactId } : undefined;
    case "uhd-viewer:openModule":
      return str(v.path) ? { type: v.type, path: v.path, ...(v.view === "3d" ? { view: "3d" as const } : {}) } : undefined;
    case "uhd-viewer:openPair":
      return str(v.linkId) && str(v.a) && str(v.b) ? { type: v.type, linkId: v.linkId, a: v.a, b: v.b } : undefined;
    case "uhd-viewer:inspect":
      return str(v.path) ? { type: v.type, path: v.path, ...(str(v.defId) ? { defId: v.defId } : {}) } : undefined;
    case "uhd-viewer:navigate":
      return parseNavigate(v);
    case "uhd-viewer:history": {
      const n = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= -1 && (x as number) <= 1000;
      if (!n(v.index) || !n(v.length) || typeof v.canBack !== "boolean" || typeof v.canForward !== "boolean" || !Array.isArray(v.entries)) return undefined;
      const KINDS = ["open", "drill", "frame", "isolate"];
      const entries = v.entries
        .slice(-50)
        .filter((e): e is Record<string, unknown> => obj(e) && pathLike(e.scope) && str(e.label) && KINDS.includes(e.kind as string))
        .map((e) => ({ scope: e.scope as string, label: (e.label as string).slice(0, 200), kind: e.kind as ViewerHistoryEntry["kind"] }));
      return { type: v.type, index: v.index, length: v.length, canBack: v.canBack, canForward: v.canForward, entries };
    }
    case "uhd-viewer:export":
      if (!(EXPORT_FORMATS as readonly unknown[]).includes(v.format) || (v.target !== undefined && !pathLike(v.target))) return undefined;
      return { type: v.type, format: v.format as ExportFormat, ...(v.target !== undefined ? { target: v.target as string } : {}) };
    case "uhd-viewer:setting":
      if (!(VIEWER_SAVABLE_SETTINGS as readonly unknown[]).includes(v.key) || typeof v.value !== "string" || v.value.length > 64) return undefined;
      return { type: v.type, key: v.key as (typeof VIEWER_SAVABLE_SETTINGS)[number], value: v.value };
    default:
      return undefined;
  }
}

/** An instance path as a message carries it: a string of at most 1024 characters, no control characters ("" is the root). */
const pathLike = (x: unknown): x is string => typeof x === "string" && x.length <= 1024 && !/[\u0000-\u001f]/.test(x);

/** A `uhd-viewer:navigate` event, checked as uhd-viewer's own relay checks it (R2-A `parseNavigateEvent`). */
function parseNavigate(v: Record<string, unknown>): Extract<ViewerEvent, { type: "uhd-viewer:navigate" }> | undefined {
  if (v.how !== "replace" && v.how !== "newTab") return undefined;
  if (v.view !== undefined && v.view !== "3d") return undefined;
  if (v.from !== undefined && !pathLike(v.from)) return undefined;
  const t = v.target;
  if (!obj(t)) return undefined;
  let target: NavigateTarget;
  if ("module" in t) {
    if (!pathLike(t.module)) return undefined;
    target = { module: t.module };
  } else {
    const a = t.model;
    const id = (x: unknown): x is string => pathLike(x) && x.length > 0;
    if (!obj(a) || !id(a.defId) || !id(a.artifactId) || (a.path !== undefined && !pathLike(a.path))) return undefined;
    target = { model: { defId: a.defId, artifactId: a.artifactId, ...(a.path !== undefined ? { path: a.path as string } : {}) } };
  }
  return { type: "uhd-viewer:navigate", target, how: v.how, ...(v.view ? { view: "3d" as const } : {}), ...(v.from !== undefined ? { from: v.from as string } : {}) };
}

/** Viewer settings as a message or a config carries them; the defaults for anything missing or wrong. */
export function parseViewerSettings(v: unknown): ViewerSettings {
  const o = obj(v) ? v : {};
  const b = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const ms = typeof o.hoverLongDelayMs === "number" && Number.isFinite(o.hoverLongDelayMs) ? Math.min(5000, Math.max(200, Math.round(o.hoverLongDelayMs))) : DEFAULT_VIEWER_SETTINGS.hoverLongDelayMs;
  return {
    openModelsInPlace: b(o.openModelsInPlace, DEFAULT_VIEWER_SETTINGS.openModelsInPlace),
    zoomToCursor: b(o.zoomToCursor, DEFAULT_VIEWER_SETTINGS.zoomToCursor),
    modelInfo: b(o.modelInfo, DEFAULT_VIEWER_SETTINGS.modelInfo),
    hoverLongDelayMs: ms,
    units: o.units === "in" ? "in" : DEFAULT_VIEWER_SETTINGS.units,
    scaleReference: o.scaleReference === "cube" || o.scaleReference === "benchy" ? o.scaleReference : DEFAULT_VIEWER_SETTINGS.scaleReference,
  };
}

/** A message from the webview, checked field by field; anything else is undefined. */
export function parseFromWebview(data: unknown): FromWebview | undefined {
  if (!obj(data)) return undefined;
  switch (data.type) {
    case "ready":
      return { type: "ready" };
    case "boards":
      return { type: "boards" };
    case "boardOpen":
    case "boardClose":
    case "boardCheck":
      // a board key (contract section 7: the folder relative to the project, `/` as `__`), never a path
      return str(data.board) && /^[A-Za-z0-9_.-]{1,300}$/.test(data.board) ? { type: data.type, board: data.board } : undefined;
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
    case "telemetry": {
      const r = data.record;
      if (!obj(r) || (r.schema !== "pb.render-session/v0" && r.schema !== "pb.crash/v0")) return undefined;
      // one record is small (numbers, short strings); anything larger is not a record of ours
      if (JSON.stringify(r).length > 64 * 1024) return undefined;
      return { type: "telemetry", record: r };
    }
    case "viewState": {
      const file = parseViewerStateFile(data.file);
      return file && { type: "viewState", file };
    }
    case "presentation": {
      const p = data.presentation;
      // DEFAULT (wave 2 gate item 9): 512 kB of JSON for the named views and annotations together
      if (!obj(p) || !obj(p.namedViews) || !Array.isArray(p.annotations) || JSON.stringify(p).length > PRESENTATION_MAX_CHARS) return undefined;
      // the person's explicit "Save callouts" (W4-D, collaboration D10) travels on: the extension writes the
      // annotations to the display file only when the save says so (wave 4 gate); anything but `true` is dropped
      return { type: "presentation", presentation: { namedViews: p.namedViews, annotations: p.annotations, ...(p.saveAnnotations === true ? { saveAnnotations: true as const } : {}) } };
    }
    case "savePoint": {
      // a PNG of the view, at most 16 MB of base64; the meta's fields are checked where it is written
      // DEFAULT: 16 MiB of base64
      if (!str(data.png) || data.png.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(data.png) || !obj(data.meta)) return undefined;
      const m = data.meta;
      if (!str(m.level) || !str(m.view) || typeof m.width !== "number" || typeof m.height !== "number") return undefined;
      return { type: "savePoint", png: data.png, meta: m };
    }
    case "bridgeReply":
      // DEFAULT (wave 2 gate item 9): a reply is at most 2 MB of JSON (the viewer's own cap)
      if (!str(data.id) || data.id.length > 128 || !obj(data.reply) || JSON.stringify(data.reply).length > BRIDGE_REPLY_MAX_CHARS) return undefined;
      return { type: "bridgeReply", id: data.id, reply: data.reply };
    case "contextmenu": {
      const n = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
      if (!n(data.x) || !n(data.y)) return undefined;
      const p = obj(data.pick) ? data.pick : undefined;
      const s512 = (x: unknown): x is string => str(x) && x.length <= 1024;
      const pick: ContextMenuPick | undefined = p
        ? { ...(s512(p.instancePath) ? { instancePath: p.instancePath } : {}), ...(s512(p.body) ? { body: p.body } : {}), ...(s512(p.harness) ? { harness: p.harness } : {}), ...(Number.isInteger(p.face) ? { face: p.face as number } : {}) }
        : undefined;
      return { type: "contextmenu", x: Math.round(data.x), y: Math.round(data.y), ...(str(data.view) && data.view.length <= 64 ? { view: data.view } : {}), ...(pick && Object.keys(pick).length ? { pick } : {}) };
    }
    case "parts": {
      if (!Number.isInteger(data.ask) || !(PARTS_OPS as readonly unknown[]).includes(data.op)) return undefined;
      const args = obj(data.args) && JSON.stringify(data.args).length <= 4096 ? data.args : undefined;
      return { type: "parts", ask: data.ask as number, op: data.op as PartsOp, ...(args ? { args } : {}) };
    }
    case "download":
      // a name with no folder in it, and base64 under the cap
      if (!str(data.name) || !data.name.trim() || data.name.length > 200 || /[\\/\u0000-\u001f]/.test(data.name)) return undefined;
      if (!str(data.data) || data.data.length > DOWNLOAD_MAX_CHARS || !/^[A-Za-z0-9+/=]*$/.test(data.data)) return undefined;
      return { type: "download", name: data.name, data: data.data };
    case "historyState":
      return typeof data.back === "boolean" && typeof data.forward === "boolean" ? { type: "historyState", back: data.back, forward: data.forward } : undefined;
    case "presence":
      // DEFAULT: 64 kB of JSON (presence is a few leases and intents; anything larger is not ours)
      if (!obj(data.presence) || JSON.stringify(data.presence).length > PRESENCE_MAX_CHARS) return undefined;
      return { type: "presence", presence: data.presence };
    default:
      return undefined;
  }
}

/** A viewer-state file, its envelope checked (the viewer checks every value it reads back); undefined for anything else. */
export function parseViewerStateFile(v: unknown): ViewerStateFile | undefined {
  if (!obj(v) || v.schema !== "protoboard.viewer-state/v0" || v.viewState !== "uhd-viewer.view-state/v1" || !obj(v.scopes)) return undefined;
  if (Object.keys(v.scopes).length > 200 || !Object.values(v.scopes).every(obj) || JSON.stringify(v).length > 1024 * 1024) return undefined;
  return { schema: v.schema, viewState: v.viewState, scope: str(v.scope) ? v.scope : "", scopes: v.scopes as ViewerStateFile["scopes"] };
}

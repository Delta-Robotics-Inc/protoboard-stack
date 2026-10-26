/**
 * The viewer editor tabs (PB-895, PB-896, PB-897): what names a tab, and the
 * page of its webview. A tab shows one module of one project, on one view
 * (diagram, 3D, or a registry view such as the schematic); its resource is a
 * `protoboard-viewer:` URI that carries the project folder, the module's
 * instance path and the view, so VS Code restores the tab after a reload and
 * a second tab on the same module and view is the same tab.
 *
 * The page loads the VS Code shell the extension ships
 * (dist/webview/protoboard-viewer.js, built from @protoboardai/web-viewer's
 * src/vscode) and reads the project from its `protoboard dev` server; it
 * frames nothing. No VS Code API here.
 */
import { escapeHtml } from "./html.js";
import { parseParams, type SourceAction, type ViewerLayout, type WebviewConfig } from "../../web-viewer/src/vscode/protocol.js";

export const VIEWER_SCHEME = "protoboard-viewer";
export const VIEWER_TYPE = "protoboard.viewer";

/** What a viewer tab shows. */
export interface ViewerTarget {
  /** The project folder. */
  root: string;
  /** The module's instance path ("" is the root system). */
  path: string;
  /** `diagram` (the default), `3d`, or a registry view id. */
  view: string;
  /** What the view is opened with (the pair view's `link`, `a`, `b`): part of the tab's identity. */
  params?: Record<string, string>;
}

/** The parts of the tab's URI (`vscode.Uri.from` takes them). */
export interface ViewerUriParts {
  scheme: string;
  path: string;
  query: string;
}

const VIEW_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)?$/;
const MODULE_PATH = /^[A-Za-z0-9_.\-/]*$/;

/** The tab's URI: readable path (`/<project>/<module path>`), the facts in the query. */
export function viewerUri(t: ViewerTarget): ViewerUriParts {
  const project = t.root.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  const query = new URLSearchParams({ root: t.root, module: t.path });
  if (t.view && t.view !== "diagram") query.set("view", t.view);
  for (const [k, v] of Object.entries(t.params ?? {}).sort(([a], [b]) => a.localeCompare(b))) query.set(`p.${k}`, v);
  return { scheme: VIEWER_SCHEME, path: `/${project}${t.path ? `/${t.path}` : ""}`, query: query.toString() };
}

/** What a tab's URI names, or undefined for anything that is not one. */
export function parseViewerUri(u: { scheme: string; query: string }): ViewerTarget | undefined {
  if (u.scheme !== VIEWER_SCHEME) return undefined;
  const q = new URLSearchParams(u.query);
  const root = q.get("root");
  const path = q.get("module") ?? "";
  const view = q.get("view") ?? "diagram";
  if (!root || !MODULE_PATH.test(path) || path.startsWith("/") || path.includes("//") || !VIEW_ID.test(view)) return undefined;
  const params = parseParams(Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith("p.")).map(([k, v]) => [k.slice(2), v])));
  return { root, path, view, ...(params ? { params } : {}) };
}

const VIEW_TITLES: Record<string, string> = { diagram: "Diagram", "3d": "3D", schematic: "Schematic", pcb: "PCB", bom: "BOM", pair: "Pair", library: "Library" };

/** The tab's title: the module's name, and the view when it is not the diagram (`Bottle cap · 3D`). */
export function viewerTitle(label: string, view: string, viewTitle?: string): string {
  if (view === "diagram") return label;
  return `${label} · ${viewTitle ?? VIEW_TITLES[view] ?? view}`;
}

/** The tab's commands on its module's source file (the header's path, and the tab's right-click menu). */
export const SOURCE_COMMANDS: Record<SourceAction, string> = {
  open: "protoboard.viewer.openSourceFile",
  reveal: "protoboard.viewer.revealSourceFile",
  copy: "protoboard.viewer.copySourcePath",
  copyRelative: "protoboard.viewer.copyRelativeSourcePath",
};

/** What names one open tab, for telling tabs apart by title. */
export interface TabName {
  /** The project folder. */
  root: string;
  /** The module the tab is on: its instance path ("" is the root system). */
  path: string;
  label: string;
  view: string;
  viewTitle?: string;
}

/**
 * The titles of the open tabs, in order: `viewerTitle` for each, and where
 * tabs on different modules would read the same (two instances of one part,
 * a board and the system named alike), the module's place after the name:
 * `Motor · arm_fl/motor` beside `Motor · arm_fr/motor`, the project's folder
 * for a root system. Tabs on the same module and view keep one title.
 */
export function distinctTitles(tabs: readonly TabName[]): string[] {
  const plain = tabs.map((t) => viewerTitle(t.label, t.view, t.viewTitle));
  const where = (t: TabName) => `${t.root}\n${t.path}`;
  return tabs.map((t, i) => {
    const clash = tabs.some((o, j) => j !== i && plain[j] === plain[i] && where(o) !== where(t));
    if (!clash) return plain[i];
    const project = t.root.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    // two projects with a module at the same place: the project's folder says which
    const sameplace = tabs.some((o, j) => j !== i && plain[j] === plain[i] && o.path === t.path && o.root !== t.root);
    const place = t.path ? (sameplace ? `${project}/${t.path}` : t.path) : project;
    return viewerTitle(`${t.label} (${place})`, t.view, t.viewTitle);
  });
}

/** Origins the page may read from: the dev server on any loopback port (it moves when it restarts), and the one it is reached at now. */
export function devOrigins(url?: string): string[] {
  // (CSP has no syntax for an IPv6 literal host: a server on [::1] is reached by the origin it is published at)
  const loopback = ["http://127.0.0.1:*", "http://localhost:*"];
  if (!url) return loopback;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return loopback;
    return loopback.some((o) => matchesOrigin(u.origin, o)) ? loopback : [...loopback, u.origin];
  } catch {
    return loopback;
  }
}

/** Whether the page's policy lets it read `url` (else the page is written again with the new origin). */
export function originCovered(url: string, origins: string[]): boolean {
  try {
    const o = new URL(url).origin;
    return origins.some((a) => matchesOrigin(o, a));
  } catch {
    return false;
  }
}

function matchesOrigin(origin: string, allowed: string): boolean {
  if (allowed.endsWith(":*")) return origin.startsWith(allowed.slice(0, -1)) && /^\d+$/.test(origin.slice(allowed.length - 1));
  return origin === allowed;
}

export interface ViewerPage {
  /** `webview.cspSource`. */
  cspSource: string;
  /** The shell's script and stylesheet as the webview reaches them (`asWebviewUri`). */
  script: string;
  style: string;
  nonce: string;
  title: string;
  /** Origins the page may read (`devOrigins`). */
  origins: string[];
  config: WebviewConfig;
}

/**
 * The page's policy: its own script (by nonce, from the extension), styles
 * from the extension and inline (the viewer positions and themes elements
 * with style attributes), images, fonts and data from the extension and the
 * dev server only. No frames, no forms.
 */
export function viewerCsp(p: Pick<ViewerPage, "cspSource" | "nonce" | "origins">): string {
  const dev = p.origins.join(" ");
  return [
    "default-src 'none'",
    `script-src 'nonce-${p.nonce}' ${p.cspSource}`,
    `style-src ${p.cspSource} 'unsafe-inline'`,
    `img-src ${p.cspSource} ${dev} data: blob:`,
    `font-src ${p.cspSource} data:`,
    `connect-src ${p.cspSource} ${dev} data: blob:`,
    "worker-src blob:",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The page's config as an inert JSON script (no `<` that could close it). */
const jsonScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function viewerPageHtml(p: ViewerPage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(viewerCsp(p))}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(p.title)}</title>
    <link rel="stylesheet" href="${escapeHtml(p.style)}" />
    <script type="application/json" id="protoboard-viewer-config">${jsonScript(p.config)}</script>
  </head>
  <body>
    <div id="viewer"></div>
    <script type="module" nonce="${p.nonce}" src="${escapeHtml(p.script)}"></script>
  </body>
</html>
`;
}

/** A saved backup of a tab's unsaved layout edits (hot exit). */
export interface ViewerBackup {
  schema: "protoboard.viewer-backup/v0";
  layout: ViewerLayout;
  snapshot?: { nodes: Record<string, { x: number; y: number }>; edges: string[] };
}

export function parseBackup(text: string): ViewerBackup | undefined {
  try {
    const b = JSON.parse(text) as Partial<ViewerBackup>;
    if (b?.schema !== "protoboard.viewer-backup/v0" || typeof b.layout !== "object" || !b.layout?.positions || !b.layout?.links) return undefined;
    return b as ViewerBackup;
  } catch {
    return undefined;
  }
}

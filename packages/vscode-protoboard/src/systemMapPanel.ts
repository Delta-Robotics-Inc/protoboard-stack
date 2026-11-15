/**
 * **Protoboard: Open System Map** (docs/specs/system-map.md): one editor
 * panel, "System Map", that draws the stack this extension runs (systemMap.ts
 * finds it and keeps its map). Its page is the viewer tabs' own page and
 * script (viewerPage.ts, the shell's bundle) in `mode: "sysmap"`: the map
 * alone, with no project, no bundle and no dev server. It needs no project
 * and no sign-in, and opens in an empty window.
 *
 * The same `sysmap` and `sysmapOpen` messages come from a viewer tab's
 * System Map tab (viewerEditor.ts passes them here): every page gets the one
 * map of the session, and a file opens only when it lies inside the stack.
 */
import * as vscode from "vscode";
import { parseFromWebview, type FromWebview, type SysmapReply } from "../../web-viewer/src/vscode/protocol.js";
import { nonce } from "./html.js";
import { stackFileOf, type SysmapCache } from "./systemMap.js";
import { viewerPageHtml } from "./viewerPage.js";

export const SYSTEM_MAP_PANEL = "protoboard.systemMap";
export const SYSTEM_MAP_TITLE = "System Map";

export interface SystemMapHost {
  cache: SysmapCache;
  log: vscode.LogOutputChannel;
  /** Say something short (status bar), or a warning or an error. */
  notify(message: string, severity?: "info" | "warning" | "error"): void;
}

type SysmapMessage = Extract<FromWebview, { type: "sysmap" } | { type: "sysmapOpen" }>;

export class SystemMapController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** The panel's last `reportTheme` answer (tests). */
  themeReport: Extract<FromWebview, { type: "theme" }> | undefined;
  private readonly subs: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: SystemMapHost,
  ) {
    // a panel VS Code restores after a reload is written again
    this.subs = [vscode.window.registerWebviewPanelSerializer(SYSTEM_MAP_PANEL, { deserializeWebviewPanel: async (panel) => this.adopt(panel) })];
  }

  /** Open the panel, or bring it to the front. */
  open(): void {
    if (this.panel) return this.panel.reveal();
    this.adopt(vscode.window.createWebviewPanel(SYSTEM_MAP_PANEL, SYSTEM_MAP_TITLE, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true }));
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  private adopt(panel: vscode.WebviewPanel) {
    // one panel: a second one restored next to it gives way
    if (this.panel && this.panel !== panel) {
      panel.dispose();
      return this.panel.reveal();
    }
    this.panel = panel;
    panel.title = SYSTEM_MAP_TITLE;
    panel.iconPath = { light: vscode.Uri.joinPath(this.extensionUri, "media", "protoboard-light.svg"), dark: vscode.Uri.joinPath(this.extensionUri, "media", "protoboard-dark.svg") };
    // as a viewer tab: the shell's script and stylesheet, the extension's media, nothing else
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview"), vscode.Uri.joinPath(this.extensionUri, "media")] };
    const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", f)).toString();
    webview.html = viewerPageHtml({
      cspSource: webview.cspSource,
      script: asset("protoboard-viewer.js"),
      style: asset("protoboard-viewer.css"),
      nonce: nonce(),
      title: SYSTEM_MAP_TITLE,
      // no dev server: the page reads nothing but the extension's own files
      origins: [],
      config: { mode: "sysmap", path: "", view: "sysmap", media: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media")).toString() },
    });
    webview.onDidReceiveMessage((data) => this.receive(panel, data));
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
  }

  private receive(panel: vscode.WebviewPanel, data: unknown) {
    const m = parseFromWebview(data);
    if (!m) return;
    switch (m.type) {
      case "sysmap":
      case "sysmapOpen":
        return this.answer(m, (r) => void panel.webview.postMessage(r), "the System Map panel");
      case "log": {
        const text = `the System Map panel: ${m.message}`;
        if (m.level === "error") this.host.log.error(text);
        else if (m.level === "warn") this.host.log.warn(text);
        else this.host.log.info(text);
        return;
      }
      case "notify":
        return this.host.notify(m.message, m.severity);
      case "theme":
        this.themeReport = m;
        return;
      // `ready` and everything a viewer tab sends about a project: the panel has none
      default:
        return;
    }
  }

  /** Ask the panel for its `--vscode-*` variables (tests). */
  reportTheme(): void {
    void this.panel?.webview.postMessage({ type: "reportTheme" });
  }

  /**
   * A page's System Map message (the panel's, or a viewer tab's System Map
   * tab's): `sysmap` is answered with the session's map (built again first
   * with `refresh`) or what failed; `sysmapOpen` opens the stack file, beside
   * the page, once it is checked to lie inside the stack.
   */
  answer(m: SysmapMessage, reply: (r: SysmapReply) => void, who: string): void {
    if (m.type === "sysmap") {
      if (m.refresh) this.host.log.info(`${who}: Rebuild pressed; building the System Map again`);
      this.host.cache.get({ refresh: m.refresh === true }).then(
        (graph) => reply({ type: "sysmap", graph }),
        (e: Error) => reply({ type: "sysmap", error: e.message }),
      );
      return;
    }
    let root: string;
    try {
      root = this.host.cache.location().root;
    } catch (e) {
      return this.host.notify((e as Error).message, "error");
    }
    const r = stackFileOf(root, m.path);
    if ("refused" in r) {
      this.host.log.warn(`${who}: refused to open ${JSON.stringify(m.path)}: ${r.refused}`);
      return this.host.notify(r.refused, "warning");
    }
    void Promise.resolve(vscode.commands.executeCommand("vscode.open", vscode.Uri.file(r.file), { viewColumn: vscode.ViewColumn.Beside, preview: true })).catch((e: Error) => this.host.notify(e.message, "error"));
  }

  dispose() {
    for (const s of this.subs) s.dispose();
    this.panel?.dispose();
  }
}

/**
 * The Protoboard Inspector's selection view (PB-895, PB-940): a webview view
 * under the hierarchy, in the Protoboard Inspector container (the secondary
 * side bar). It draws @protoboardai/views' SelectionInspector (the extension's
 * React page, appPage.ts) for what the focused viewer tab has selected, else
 * the level that tab shows: the card (inspector.ts) and, inside it, the
 * viewer's own details of the selection with every artifact as a card.
 *
 * The page reaches files only as webview URLs, and only below the folders
 * given as its roots: the projects, the packages their artifacts are in, and
 * the library's cache.
 */
import * as vscode from "vscode";
import type { InspectorAction, InspectorInterfaceRequest } from "@protoboardai/views/inspector-model";
import { appHtml } from "./appPage.js";
import { nonce } from "./html.js";
import { pageContent, type InspectorCard, type InspectorContent } from "./inspector.js";
import { vscodeBefore } from "./newProject.js";

export type { InspectorAction, InspectorContent };

export interface InspectorActions {
  action(card: InspectorCard, action: InspectorAction): unknown;
  focusPath(path: string): unknown;
  /** Something picked inside the details (an end of a link, a net's member): shown in the viewer. */
  select(selection: { kind: "node" | "link"; id: string }): unknown;
  finding(key: string): unknown;
  explain(key: string): unknown;
  /** An artifact's card: opened as Open Artifact opens it. */
  openArtifact(card: InspectorCard, defId: string, artifactId: string): unknown;
  /** A web address among the card's links. */
  openLink(url: string): unknown;
  /** An interface card's Open in source (PB-1042). */
  interfaceSource?(request: InspectorInterfaceRequest): unknown;
  /** An open slot's Connect…: where a link from it is written. */
  connect?(request: InspectorInterfaceRequest): unknown;
  /** Folders the page may load from (the projects, their artifact packages, the library's cache). */
  roots(): string[];
  /** A picture did not load (a file outside the roots, or gone): for the log. */
  problem?(message: string): void;
}

/** Page → extension. */
export type InspectorPageMessage =
  | { type: "ready" }
  | { type: "action"; action: InspectorAction }
  | { type: "focus"; path: string }
  | { type: "select"; selection: { kind: "node" | "link"; id: string } }
  | { type: "finding" | "explain"; key: string }
  | { type: "openArtifact"; defId: string; artifactId: string }
  | { type: "openLink"; url: string }
  | { type: "interfaceSource" | "connect"; request: InspectorInterfaceRequest }
  | ({ type: "drawn" } & PageDrawn);

/** What the page says it drew, once settled (the log and the tests read it). */
export interface PageDrawn {
  /** `<kind>:<path, link or part>:<title>` of the card. */
  what: string;
  /** The viewer's details are there. */
  details: boolean;
  /** Artifact cards, and artifacts still drawn as plain rows (none). */
  cards: number;
  rows: number;
  /** Pictures that loaded, pictures that did not, cards showing their icon. */
  loaded: number;
  failed: number;
  icons: number;
  /** The page is larger than the view (it should never be: its scroll areas are its own). */
  scrolls: boolean;
  /** The page's size, which is its view's. */
  width: number;
  height: number;
}

const ACTIONS: readonly InspectorAction[] = ["focus", "source", "artifacts", "operation", "pair", "detail"];

export class InspectorViewProvider implements vscode.WebviewViewProvider {
  static readonly id = "protoboard.inspector";
  private view: vscode.WebviewView | undefined;
  private content: InspectorContent = { empty: "Open a viewer tab, then select a module or a link." };
  /** The roots the webview has now. */
  private applied = "";
  /** What the page last said it drew. */
  drawn: PageDrawn | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: InspectorActions,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.applied = "";
    this.applyRoots();
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist");
    view.webview.html = appHtml({
      screen: "inspector",
      title: "Protoboard Inspector",
      cspSource: view.webview.cspSource,
      script: view.webview.asWebviewUri(vscode.Uri.joinPath(dist, "views-app.js")).toString(),
      style: view.webview.asWebviewUri(vscode.Uri.joinPath(dist, "views-app.css")).toString(),
      nonce: nonce(),
    });
    view.webview.onDidReceiveMessage((m: InspectorPageMessage) => this.receive(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.post();
      for (const l of this.visibilityListeners) l(view.visible);
    });
    view.onDidDispose(() => (this.view = undefined));
  }

  /** The folders the page may load from now. */
  get roots(): string[] {
    return this.applied ? this.applied.split("\n") : [];
  }

  /** The folders the page may load from; set again only when they change (a new project, a new package), since that reloads the page. */
  private applyRoots(): boolean {
    if (!this.view) return false;
    const roots = this.actions.roots();
    const key = roots.join("\n");
    if (key === this.applied) return false;
    const first = this.applied === "";
    this.applied = key;
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media"), ...roots.map((r) => vscode.Uri.file(r))],
    };
    return !first;
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  private readonly visibilityListeners = new Set<(visible: boolean) => void>();
  /** The view was shown or hidden (another view put in front of it, its side bar closed). */
  onVisibility(listener: (visible: boolean) => void): vscode.Disposable {
    this.visibilityListeners.add(listener);
    return { dispose: () => void this.visibilityListeners.delete(listener) };
  }

  /**
   * Bring the Inspector to the front of its side bar (the 2026-10-08 first
   * builds, D6: selecting in the viewer shows it, every time, even over an
   * agent's chat). `focus: false` (a selection) leaves the keyboard where it
   * is, in the canvas; `focus: true` (INSPECT in a module's menu) moves it.
   * Returns false when it was in view already. Off with the
   * `protoboard.inspector.revealOnSelection` setting for selections.
   */
  async reveal(options: { focus?: boolean; log?: (message: string) => void } = {}): Promise<boolean> {
    const focus = options.focus ?? false;
    if (!focus && this.view?.visible) return false;
    if (!focus && !vscode.workspace.getConfiguration("protoboard").get<boolean>("inspector.revealOnSelection", true)) return false;
    try {
      // the view itself shows without taking the focus on every VS Code this extension runs on; before it was
      // ever drawn there is only the command (which holds `preserveFocus` from 1.107, and is given back before)
      if (this.view) this.view.show(!focus);
      else {
        const giveBack = !focus && vscodeBefore(vscode.version, 107) && vscode.window.tabGroups.activeTabGroup.activeTab !== undefined;
        await vscode.commands.executeCommand(`${InspectorViewProvider.id}.focus`, { preserveFocus: !focus });
        if (giveBack) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      }
      return true;
    } catch (e) {
      options.log?.(`could not show the Protoboard Inspector: ${(e as Error).message}`);
      return false;
    }
  }

  /** What the view shows now (tests read it). */
  get current(): InspectorContent {
    return this.content;
  }

  /** Ask the page to load every picture it shows and say what it drew again (the integration test). */
  probe() {
    this.drawn = undefined;
    void this.view?.webview.postMessage({ type: "probe" });
  }

  show(content: InspectorContent) {
    this.content = content;
    this.post();
  }

  private post() {
    if (!this.view) return;
    this.view.description = this.content.project;
    // new roots reload the page: it asks again when it is ready
    if (this.applyRoots()) return;
    const webview = this.view.webview;
    void webview.postMessage({ type: "model", model: pageContent(this.content, (file) => webview.asWebviewUri(vscode.Uri.file(file)).toString()) });
  }

  private receive(m: InspectorPageMessage) {
    const card = "card" in this.content ? this.content.card : undefined;
    switch (m?.type) {
      case "ready":
        return this.post();
      case "action":
        if (card && ACTIONS.includes(m.action)) void this.actions.action(card, m.action);
        return;
      case "focus":
        if (typeof m.path === "string") void this.actions.focusPath(m.path);
        return;
      case "select":
        if (m.selection && (m.selection.kind === "node" || m.selection.kind === "link") && typeof m.selection.id === "string") void this.actions.select({ kind: m.selection.kind, id: m.selection.id });
        return;
      case "finding":
        if (typeof m.key === "string") void this.actions.finding(m.key);
        return;
      case "explain":
        if (typeof m.key === "string") void this.actions.explain(m.key);
        return;
      case "openArtifact":
        if (card && typeof m.defId === "string" && typeof m.artifactId === "string") void this.actions.openArtifact(card, m.defId, m.artifactId);
        return;
      case "drawn":
        this.drawn = { what: String(m.what), details: !!m.details, cards: Number(m.cards) || 0, rows: Number(m.rows) || 0, loaded: Number(m.loaded) || 0, failed: Number(m.failed) || 0, icons: Number(m.icons) || 0, scrolls: !!m.scrolls, width: Number(m.width) || 0, height: Number(m.height) || 0 };
        if (this.drawn.failed) this.actions.problem?.(`the Inspector could not load ${this.drawn.failed} of the pictures of ${this.drawn.what}`);
        return;
      case "interfaceSource":
      case "connect": {
        const r = m.request;
        const ok = r && typeof r.path === "string" && typeof r.interfaceId === "string" && typeof r.owner === "string" && Array.isArray(r.links) && r.links.every((l) => typeof l === "string");
        if (ok) void (m.type === "connect" ? this.actions.connect : this.actions.interfaceSource)?.({ path: r.path, interfaceId: r.interfaceId, owner: r.owner, links: r.links });
        return;
      }
      case "openLink":
        // only an address the card itself names (an artifact's or an evidence source's), and only the web
        if (card && typeof m.url === "string" && /^https?:\/\//i.test(m.url) && card.details?.links?.includes(m.url)) void this.actions.openLink(m.url);
        return;
    }
  }
}

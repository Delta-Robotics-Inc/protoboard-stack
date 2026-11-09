/**
 * The viewer as VS Code editor tabs (PB-895, PB-896, PB-897): a custom
 * editor whose document is one module of a project on one view, and whose
 * webview is the VS Code shell (viewerPage.ts). Several tabs may be open,
 * each on its own module; VS Code restores them after a reload.
 *
 * The document holds the tab's layout edits: moving a module or a link marks
 * the tab dirty (the tab's dot), undo and redo step through the edits, and
 * Save (Ctrl+S) writes them to the project's display file (display.ts). Hot
 * exit keeps unsaved edits in a backup. Everything else a tab does (its
 * selection, open source, open artifact, open a module as a new tab) goes to
 * the extension through `ViewerHost`.
 *
 * The 3D view's state (PB-1178, viewerBridge.ts): a tab's live view state is
 * saved to `.protoboard/local/viewer-state.json` (and kept in the webview's
 * own state, so VS Code restores the camera and selection with the tab), its
 * saved named views go to the display file, and the tabs of a project are
 * live tabs of the dev server's bridge, through one relay per project.
 *
 * R2-E (walkthrough F1, 2026-11-02): a tab moves in place (`go`) when a model or
 * module is opened from it or from the Inspector (the `viewer.openModelsInPlace`
 * setting, DEFAULT on); its header's back and forward are the page's
 * (web-viewer tab-history.ts), and VS Code's Alt+Left / Alt+Right reach them
 * through `protoboard.viewer.back` / `forward` while the page says it has
 * somewhere to go (the context keys `protoboard.viewer.canGoBack` and
 * `canGoForward`; with nowhere to go Alt+Left is VS Code's own Go Back). The
 * page's BOM asks its data here (`parts`), and a file it would download is
 * written to the export folder (`download`).
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import * as vscode from "vscode";
import { join } from "node:path";
import { emptyLayout, hasEdits, parseFromWebview, type DevEndpoint, type FromWebview, type LayoutSnapshot, type ModuleSource, type PartsOp, type SourceAction, type ToWebview, type ViewerEvent, type ViewerLayout, type ViewerSelection, type ViewerSettings, type BoardFeedMessage } from "../../web-viewer/src/vscode/protocol.js";
import { nonce } from "./html.js";
import { BoardFeed, findBoards } from "../../views/src/pcb/host/index.js";
import { writeViewerTelemetry } from "./telemetry.js";
import { ProjectRelay, presenceChip, readViewerState, saveTabViewState, savePresentation, saveViewerSnapshot, takeOverRequest } from "./viewerBridge.js";
import { devOrigins, distinctTitles, originCovered, parseBackup, parseViewerUri, viewerPageHtml, viewerTitle, viewerUri, SOURCE_COMMANDS, VIEWER_SCHEME, VIEWER_TYPE, type ViewerBackup, type ViewerTarget } from "./viewerPage.js";

/** What the extension does for the tabs. */
export interface ViewerHost {
  /** Start or attach to the project's dev server (the tabs read from it). */
  ensureDev(root: string): Promise<void>;
  /** The dev server as a tab reaches it now, or why there is none. */
  devState(root: string): { dev?: DevEndpoint; message?: string; busy?: boolean };
  /** An account button of a tab (Sign In and the like, from the shell's `devAction`). */
  account(action: "signIn" | "signInDevice" | "signOut" | "checkAccount"): void;
  /** The viewer's events from a tab (selection, open source, open artifact, open module). */
  event(editor: ViewerEditor, event: ViewerEvent): unknown;
  /** The focused tab changed (undefined: no viewer tab has focus). */
  focused(editor: ViewerEditor | undefined): void;
  /** A tab's level, view or label changed. */
  stateChanged(editor: ViewerEditor): void;
  /** Save a tab's layout edits to the project's display file. */
  save(target: ViewerTarget, layout: ViewerLayout, snapshot?: LayoutSnapshot): Promise<void>;
  /** A tab closed (the project's last one, perhaps). */
  closed(root: string): void;
  /** A tab's Retry: look for the server again, start one if there is none, and tell the tabs. */
  retryDev(root: string): Promise<void>;
  /** A tab's Reload Window and Show Log. */
  reloadWindow(): void;
  showLog(): void;
  /** Say something short in the status bar. */
  notify(message: string, severity?: "info" | "warning" | "error"): void;
  /**
   * The source file of a module of a project (project-relative, with its line
   * when the build records it), or undefined when the last build has none
   * for it: the tab's header shows it, and the tab's Open Source File,
   * Reveal in Explorer and Copy Path act on it.
   */
  sourceOf?(root: string, path: string): ModuleSource | undefined;
  /**
   * A right-click without a drag on a tab (R1-E, M9): VS Code's own menu is not shown there; this is the hook for
   * R2's context menu (inspect, open its 3D model, frame, isolate, explode, open in new tab). Optional: unset, the
   * click is only kept on the tab (`lastContextMenu`).
   */
  contextMenu?(editor: ViewerEditor, at: Extract<FromWebview, { type: "contextmenu" }>): unknown;
  /** R2-E (J1): the user's viewer settings now (core settings.ts), for a page written now. */
  settings?(): ViewerSettings;
  /** R2-E (F1): the BOM's data and its writes, for the BOM drawn in a tab; the answer goes back to the page. */
  parts?(editor: ViewerEditor, op: PartsOp, args: Record<string, unknown>): Promise<unknown>;
  /** R2-E (G3): a file the page would download: written to the export folder without asking. */
  download?(editor: ViewerEditor, name: string, data: Buffer): unknown;
  log: vscode.LogOutputChannel;
}

/** One tab's document: what it shows and its unsaved layout edits. */
export class ViewerDocument implements vscode.CustomDocument {
  /** The edits on screen (empty: as the display file has it). */
  layout: ViewerLayout;
  snapshot: LayoutSnapshot | undefined;
  /** The edits as last saved, for revert. */
  private savedLayout: ViewerLayout = emptyLayout();
  readonly editors = new Set<ViewerEditor>();

  constructor(
    readonly uri: vscode.Uri,
    readonly target: ViewerTarget,
    backup?: ViewerBackup,
  ) {
    this.layout = backup?.layout ?? emptyLayout();
    this.snapshot = backup?.snapshot;
  }

  get dirty(): boolean {
    return hasEdits(this.layout);
  }

  markSaved() {
    this.savedLayout = this.layout;
  }

  get saved(): ViewerLayout {
    return this.savedLayout;
  }

  dispose(): void {
    this.editors.clear();
  }
}

/** One open tab: its webview and what it shows now. */
export class ViewerEditor {
  /** The webview said it is ready: messages go now (before: they wait). */
  private ready = false;
  private pending: ToWebview[] = [];
  /** What the page was written for (its policy's origins). */
  origins: string[] = [];
  /** The tab's last selection (the Inspector shows it). */
  selection: ViewerSelection | null = null;
  /** The tab's last right-click (M9, R2's context menu hook): where, and what the 3D view had under the pointer. */
  lastContextMenu: Extract<FromWebview, { type: "contextmenu" }> | undefined;
  /** What the tab shows now (the shell reports it). */
  state: { path: string; label: string; view: string; nodes: number; views: { id: string; title: string }[]; missing?: number; /** The part the tab is on, when it is not the level shown. */ at?: string } | undefined;
  /** The source file last told to the page (`path` and what it was), so it is told again only when it changes. */
  sourceSent: string | undefined;
  /** The webview answered `reportTheme` (tests). */
  themeReport: Extract<FromWebview, { type: "theme" }> | undefined;
  /** How many times the page said it runs, and reported what it shows (tests: a page that loads again is told the server again). */
  readyCount = 0;
  stateCount = 0;
  /** The live-tab bridge's id for this tab (PB-1178). */
  readonly bridgeId = ProjectRelay.tabId();
  /** The tab's last presence (PB-1196: leases, intents, who holds the camera), for the status bar chip. */
  presence: Record<string, unknown> | undefined;
  /** R2-E (F1): whether the tab's header has somewhere to go back or forward to (the page says). */
  history: { back: boolean; forward: boolean } = { back: false, forward: false };
  /** R2-E (F1): the viewer's own 3D history, as it last said (`uhd-viewer:history`). */
  viewerHistory: Extract<ViewerEvent, { type: "uhd-viewer:history" }> | undefined;
  /** R2-E (G3): the 3D view's last save point (a PNG of the view at rest), what an export of the view writes. */
  lastSavePoint: { png: string; meta: Record<string, unknown>; at: number } | undefined;
  /** R2-E (F1): in-place moves the extension made (tests). */
  readonly moves: { path: string; view: string }[] = [];
  /** The layout tab's open board feeds (PCB editor Phase 1), by board key: this host is the board service's client. */
  readonly boardFeeds = new Map<string, { feed: Promise<BoardFeed>; unsubscribe?: () => void }>();
  private themeWaiters: ((r: Extract<FromWebview, { type: "theme" }>) => void)[] = [];
  private hierarchyWaiters: ((r: Extract<FromWebview, { type: "hierarchy" }>) => void)[] = [];

  constructor(
    readonly document: ViewerDocument,
    readonly panel: vscode.WebviewPanel,
  ) {}

  get root(): string {
    return this.document.target.root;
  }

  /** The level the tab shows ("" is the root), or the module it opened on. */
  get path(): string {
    return this.state?.path ?? this.document.target.path;
  }

  /** The module the tab is on: the level it shows, or the part with nothing inside it was opened on. */
  get module(): string {
    return this.state ? (this.state.at ?? this.state.path) : this.document.target.path;
  }

  post(m: ToWebview) {
    if (this.ready) void this.panel.webview.postMessage(m);
    else {
      // a navigation replaces the one waiting before it; the last of every other kind wins
      // (a finding to pin and a view-state write wait beside the navigation they follow, not in its place: D7, F5)
      const kind = (t: string) => (t === "uhd-viewer:setView" ? "view" : t === "uhd-viewer:select" ? "select" : t === "uhd-viewer:openFinding" ? "finding" : t === "uhd-viewer:setViewState" ? "state" : t === "uhd-viewer:historyGo" ? "history" : "nav");
      const key = (x: ToWebview) => (x.type === "command" ? `command:${kind(x.command.type)}` : x.type);
      this.pending = [...this.pending.filter((p) => key(p) !== key(m)), m];
    }
  }

  opened() {
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    for (const m of queued) void this.panel.webview.postMessage(m);
  }

  reset() {
    this.ready = false;
    this.sourceSent = undefined;
  }

  get isReady() {
    return this.ready;
  }

  /** R2-E (F1): show a module on a view in this tab, in place (the page's back returns). */
  go(path: string, view: string) {
    this.moves.push({ path, view });
    this.post({ type: "go", path, view });
  }

  /** Ask the page for its `--vscode-*` variables (tests capture the token sets VS Code gives a webview). */
  reportTheme(timeoutMs = 10000): Promise<Extract<FromWebview, { type: "theme" }>> {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("the viewer tab did not report its theme")), timeoutMs);
      this.themeWaiters.push((r) => {
        clearTimeout(timer);
        ok(r);
      });
      this.post({ type: "reportTheme" });
    });
  }

  /** Ask the page for its hierarchy panel's rows (tests: each tab shows its own project's tree). */
  reportHierarchy(timeoutMs = 10000): Promise<Extract<FromWebview, { type: "hierarchy" }>> {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("the viewer tab did not report its hierarchy")), timeoutMs);
      this.hierarchyWaiters.push((r) => {
        clearTimeout(timer);
        ok(r);
      });
      this.post({ type: "reportHierarchy" });
    });
  }

  hierarchyReported(r: Extract<FromWebview, { type: "hierarchy" }>) {
    for (const w of this.hierarchyWaiters.splice(0)) w(r);
  }

  themeReported(r: Extract<FromWebview, { type: "theme" }>) {
    this.themeReport = r;
    for (const w of this.themeWaiters.splice(0)) w(r);
  }
}

/** Where the dev server is, or why there is none, as a tab takes it. */
function devMessage(state: { dev?: DevEndpoint; message?: string; busy?: boolean }): ToWebview {
  return { type: "dev", dev: state.dev ?? null, ...(state.message ? { message: state.message } : {}), ...(state.busy ? { busy: true } : {}) };
}

export class ViewerEditors implements vscode.CustomEditorProvider<ViewerDocument>, vscode.Disposable {
  static readonly viewType = VIEWER_TYPE;
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ViewerDocument>>();
  readonly onDidChangeCustomDocument = this.changed.event;
  readonly editors = new Set<ViewerEditor>();
  private active: ViewerEditor | undefined;
  /** One bridge relay per project with open tabs (PB-1178). */
  private readonly relays = new Map<string, ProjectRelay>();

  private relayOf(root: string): ProjectRelay {
    let r = this.relays.get(root);
    if (!r) this.relays.set(root, (r = new ProjectRelay(root, undefined, (m) => this.host.log.info(m))));
    return r;
  }

  private readonly commands: vscode.Disposable[];
  private readonly commands_: vscode.Disposable[];
  /** "agent X is working on Y" for the focused viewer tab (W4-D, PB-1196 D8); click: take over. */
  private readonly presenceItem: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: ViewerHost,
  ) {
    // R2-E (F1): VS Code's Alt+Left / Alt+Right in a viewer tab (package.json's keybindings, while the tab can go)
    this.commands_ = [
      vscode.commands.registerCommand("protoboard.viewer.back", () => this.focused?.post({ type: "historyStep", delta: -1 })),
      vscode.commands.registerCommand("protoboard.viewer.forward", () => this.focused?.post({ type: "historyStep", delta: 1 })),
    ];
    this.presenceItem = vscode.window.createStatusBarItem("protoboard.viewer.presence", vscode.StatusBarAlignment.Left, 40);
    this.presenceItem.name = "Protoboard: agents in the 3D view";
    this.presenceItem.command = "protoboard.viewer.takeOver";
    // from a canvas tab to its source (the tab's right-click menu and the Command Palette; the header's path posts the same)
    const on = (action: SourceAction) => (resource?: vscode.Uri) => this.sourceAction(this.editorOf(resource), action).catch((e: Error) => this.host.notify(e.message, "error"));
    this.commands = (Object.keys(SOURCE_COMMANDS) as SourceAction[]).map((a) => vscode.commands.registerCommand(SOURCE_COMMANDS[a], on(a)));
    // the person takes the focused tab back from every agent (the chip's click; Esc in the 3D view does the same)
    this.commands.push(
      vscode.commands.registerCommand("protoboard.viewer.takeOver", () => {
        const editor = this.focused;
        if (!editor) return;
        editor.post({ type: "bridge", request: takeOverRequest() });
        this.host.log.info(`${this.name(editor)}: the person took over from the agents`);
      }),
    );
  }

  /** The tab a command is about: the one whose title was right-clicked (its resource), else the focused one. */
  private editorOf(resource?: vscode.Uri): ViewerEditor | undefined {
    if (resource?.scheme === VIEWER_SCHEME) {
      const hit = [...this.editors].find((e) => e.document.uri.toString() === resource.toString());
      if (hit) return hit;
    }
    return this.focused;
  }

  /** Open, reveal or copy the source file of the module a tab is on. */
  async sourceAction(editor: ViewerEditor | undefined, action: SourceAction): Promise<void> {
    if (!editor) throw new Error("No Protoboard viewer tab is open.");
    const source = this.host.sourceOf?.(editor.root, editor.module);
    if (!source) throw new Error(`No source file is recorded for ${editor.panel.title}. Run Protoboard: Check, then try again.`);
    const uri = vscode.Uri.file(join(editor.root, ...source.file.split("/")));
    switch (action) {
      case "open": {
        const at = source.line ? new vscode.Range(source.line - 1, 0, source.line - 1, 0) : undefined;
        // beside the tab, so the diagram stays in view next to its code
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, ...(at ? { selection: at } : {}) });
        return;
      }
      case "reveal":
        await vscode.commands.executeCommand("revealInExplorer", uri);
        return;
      case "copy":
      case "copyRelative": {
        const text = action === "copy" ? uri.fsPath : vscode.workspace.asRelativePath(uri, false);
        await vscode.env.clipboard.writeText(text);
        this.host.notify(`Copied ${text}`);
        return;
      }
    }
  }

  /** Tell a tab's page the source file of the module it is on (again only when it changed). */
  private tellSource(editor: ViewerEditor) {
    const path = editor.module;
    const source = this.host.sourceOf?.(editor.root, path) ?? null;
    const key = `${path}\n${source ? `${source.file}:${source.line ?? ""}` : ""}`;
    if (editor.sourceSent === key) return;
    editor.sourceSent = key;
    editor.post({ type: "source", path, source });
  }

  /** The project was built again (its sources may have moved): every tab of it is told its source file again. */
  sourcesChanged(root: string) {
    for (const editor of this.of(root)) this.tellSource(editor);
  }

  /**
   * Title every open tab: its module's name and view, and where two tabs on
   * different modules would read the same, the module's place after the name
   * (viewerPage.ts, `distinctTitles`).
   */
  private retitle() {
    const all = [...this.editors];
    const titles = distinctTitles(
      all.map((e) => {
        const view = e.state?.view ?? e.document.target.view;
        const fallback = e.document.target.path ? (e.document.target.path.split("/").pop() ?? e.document.target.path) : basename(e.root);
        return { root: e.root, path: e.module, label: e.state?.label ?? fallback, view, viewTitle: e.state?.views.find((v) => v.id === view)?.title };
      }),
    );
    all.forEach((e, i) => {
      if (e.panel.title !== titles[i]) e.panel.title = titles[i];
    });
  }

  /** The tab's URI for a module and view. */
  static uri(t: ViewerTarget): vscode.Uri {
    return vscode.Uri.from(viewerUri(t));
  }

  /** The viewer tab that has focus, else the last one that had it while it is open. */
  get focused(): ViewerEditor | undefined {
    return this.active && this.editors.has(this.active) ? this.active : undefined;
  }

  /** The tabs of a project, the focused one first. */
  of(root: string): ViewerEditor[] {
    const all = [...this.editors].filter((e) => e.root === root);
    return all.sort((a, b) => Number(b === this.active) - Number(a === this.active));
  }

  async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): Promise<ViewerDocument> {
    const target = parseViewerUri(uri);
    if (!target) throw new Error(`not a Protoboard viewer resource: ${uri.toString()}`);
    let backup: ViewerBackup | undefined;
    if (context.backupId) {
      try {
        backup = parseBackup(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId))).toString("utf8"));
      } catch {
        backup = undefined;
      }
    }
    return new ViewerDocument(uri, target, backup);
  }

  async resolveCustomEditor(document: ViewerDocument, panel: vscode.WebviewPanel): Promise<void> {
    // a tab VS Code restores for a project whose folder is gone (moved, deleted, a worktree removed) closes itself:
    // kept, it made that folder the current project, and every command then failed in it
    if (!existsSync(join(document.target.root, "protoboard.config.ts"))) {
      panel.webview.html = `<body style="font-family:var(--vscode-font-family);color:var(--vscode-descriptionForeground);padding:24px">This project is no longer at ${document.target.root.replace(/[&<>]/g, "")}.</body>`;
      setTimeout(() => panel.dispose(), 0);
      return;
    }
    const editor = new ViewerEditor(document, panel);
    document.editors.add(editor);
    this.editors.add(editor);
    const { root, path, view } = document.target;
    panel.title = viewerTitle(path ? (path.split("/").pop() ?? path) : basename(root), view);
    panel.iconPath = { light: vscode.Uri.joinPath(this.extensionUri, "media", "protoboard-light.svg"), dark: vscode.Uri.joinPath(this.extensionUri, "media", "protoboard-dark.svg") };
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview"), vscode.Uri.joinPath(this.extensionUri, "media")] };
    panel.webview.onDidReceiveMessage((m) => this.receive(editor, m));
    // the Inspector follows the viewer tab that has focus, and stays on it while another editor has focus
    panel.onDidChangeViewState((e) => e.webviewPanel.active && this.setActive(editor));
    panel.onDidDispose(() => {
      for (const key of [...editor.boardFeeds.keys()]) this.closeBoard(editor, key);
      this.relays.get(root)?.remove(editor.bridgeId);
      document.editors.delete(editor);
      this.editors.delete(editor);
      if (this.active === editor) this.setActive(undefined);
      this.host.closed(root);
      // a tab that had its module's place in its title for another's sake gives it up
      this.retitle();
    });
    this.retitle();
    this.write(editor);
    if (panel.active) this.setActive(editor);
    // the tabs read from the project's dev server: start or attach to it
    this.host.ensureDev(root).catch((e: Error) => this.host.log.warn(`viewer ${basename(root)}: ${e.message}`));
  }

  /** A tab in the log: `viewer tab "Main board · 3D" (my-project)`. */
  private name(editor: ViewerEditor): string {
    return `viewer tab "${editor.panel.title}" (${basename(editor.root)})`;
  }

  private setActive(editor: ViewerEditor | undefined) {
    if (editor) {
      this.active = editor;
      this.relays.get(editor.root)?.activate(editor.bridgeId);
    }
    this.host.focused(editor);
    this.showPresence();
    this.historyKeys();
  }

  /** R2-E (F1): Alt+Left / Alt+Right are the focused tab's while its header has somewhere to go, else VS Code's own. */
  private historyKeys() {
    const h = this.focused?.history ?? { back: false, forward: false };
    void vscode.commands.executeCommand("setContext", "protoboard.viewer.canGoBack", h.back);
    void vscode.commands.executeCommand("setContext", "protoboard.viewer.canGoForward", h.forward);
  }

  /** R2-E (J1): the user's viewer settings changed: every tab follows. */
  settingsChanged(settings: ViewerSettings) {
    for (const editor of this.editors) editor.post({ type: "settings", settings });
  }

  /** The focused tab's presence in the status bar, or nothing when no agent is there. */
  private showPresence() {
    const chip = presenceChip(this.focused?.presence);
    if (!chip) return this.presenceItem.hide();
    this.presenceItem.text = chip.text;
    this.presenceItem.tooltip = chip.tooltip;
    this.presenceItem.show();
  }

  /** (Re)write a tab's page, for the dev server the project has now. */
  private write(editor: ViewerEditor) {
    const { webview } = editor.panel;
    const state = this.host.devState(editor.root);
    editor.origins = devOrigins(state.dev?.url);
    editor.reset();
    const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", f)).toString();
    webview.html = viewerPageHtml({
      cspSource: webview.cspSource,
      script: asset("protoboard-viewer.js"),
      style: asset("protoboard-viewer.css"),
      nonce: nonce(),
      title: editor.panel.title,
      origins: editor.origins,
      config: {
        // the module the tab is on (a part with no level of its own included: R2-E), so a page written again comes back there
        path: editor.module,
        view: editor.state?.view ?? editor.document.target.view,
        media: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media")).toString(),
        ...(state.dev ? { dev: state.dev } : {}),
        ...(editor.document.dirty ? { layout: editor.document.layout } : {}),
        ...(editor.document.target.params ? { params: editor.document.target.params } : {}),
        // the project's saved live 3D view state (PB-1178): the webview's own state wins over it
        ...(() => {
          const viewState = readViewerState(editor.root);
          return viewState ? { viewState } : {};
        })(),
        // the user's viewer settings (R2-E, J1)
        ...(this.host.settings ? { settings: this.host.settings() } : {}),
      },
    });
    this.tellSource(editor);
    editor.post(devMessage(state));
    this.host.log.info(`${this.name(editor)}: page written; it may read from ${editor.origins.join(", ")}${state.dev ? `; the dev server is at ${state.dev.url}` : `; no dev server yet (${state.message ?? "none"})`}`);
  }

  /** The project's dev server started, moved, restarted or stopped: every tab of it follows. */
  devChanged(root: string) {
    // the bridge relay follows the server (a restart makes a new key)
    this.relays.get(root)?.connect();
    const state = this.host.devState(root);
    for (const editor of this.of(root)) {
      if (state.dev && !originCovered(state.dev.url, editor.origins)) this.write(editor);
      else editor.post(devMessage(state));
    }
  }

  private receive(editor: ViewerEditor, data: unknown) {
    const m = parseFromWebview(data);
    if (!m) return;
    const doc = editor.document;
    switch (m.type) {
      case "ready": {
        // every time, not once: a page that loaded again (a restored tab, a tab moved to another group or window,
        // a webview VS Code reloaded) starts from the page as it was written, perhaps before there was a server
        const again = editor.isReady;
        editor.readyCount++;
        editor.opened();
        const state = this.host.devState(editor.root);
        if (again) this.host.log.info(`${this.name(editor)}: its page loaded again; telling it where the dev server is (${state.dev?.url ?? state.message ?? "none"})`);
        editor.post(devMessage(state));
        // a live tab of the bridge: batches for it come through the project's relay (PB-1178)
        this.relayOf(editor.root).add({ id: editor.bridgeId, label: editor.panel.title, active: this.active === editor, deliver: (request) => editor.post({ type: "bridge", request }) });
        return;
      }
      case "telemetry":
        // local telemetry (PB-1181): written only while recording is on; never sent anywhere
        writeViewerTelemetry(editor.root, m.record);
        return;
      case "viewState":
        // the live 3D view state (PB-1178), after the viewer's 400 ms debounce: per user, git-ignored, only when it changed
        try {
          saveTabViewState(editor.root, m.file);
        } catch (e) {
          this.host.log.warn(`${this.name(editor)}: view state not saved: ${(e as Error).message}`);
        }
        return;
      case "presentation":
        // named views saved in the tab: into the display file, only when they changed
        // "Save callouts" (W4-D): the viewer marks the presentation when the person asked to save the annotations too
        void savePresentation(editor.root, m.presentation, (m.presentation as { saveAnnotations?: unknown }).saveAnnotations === true ? { saveAnnotations: true } : {})
          .then((r) => r.written && this.host.notify("Saved views to the display file"))
          .catch((e: Error) => this.host.notify(`Views not saved: ${e.message}`, "error"));
        return;
      case "savePoint":
        // the 3D view's save point (PB-1180): the same files the render service writes, for the next tab; the last one
        // is also what an export of the view writes (R2-E, G3)
        editor.lastSavePoint = { png: m.png, meta: m.meta, at: Date.now() };
        try {
          saveViewerSnapshot(editor.root, m.png, m.meta);
        } catch (e) {
          this.host.log.warn(`${this.name(editor)}: save point not kept: ${(e as Error).message}`);
        }
        return;
      case "bridgeReply":
        void this.relays.get(editor.root)?.reply(editor.bridgeId, m.id, m.reply);
        return;
      case "parts": {
        // the BOM drawn in the tab (R2-E, F1): its data and writes, as the BOM editor reads and writes them
        const answer = (r: { ok: boolean; value?: unknown; error?: string }) => editor.post({ type: "partsAnswer", ask: m.ask, ...r });
        if (!this.host.parts) return answer({ ok: false, error: "not available in this window" });
        void this.host.parts(editor, m.op, m.args ?? {}).then(
          (value) => answer({ ok: true, ...(value === undefined ? {} : { value }) }),
          (e: Error) => answer({ ok: false, error: e.message }),
        );
        return;
      }
      case "download":
        // G3: the page cannot save a file; the export folder gets it, no dialog
        void Promise.resolve(this.host.download?.(editor, m.name, Buffer.from(m.data, "base64"))).catch((e: Error) => this.host.notify(`Not exported: ${e.message}`, "error"));
        return;
      case "historyState":
        editor.history = { back: m.back, forward: m.forward };
        if (editor === this.focused) this.historyKeys();
        return;
      case "contextmenu":
        // M9: VS Code's Cut/Copy/Paste is not shown over the viewer; R2's own menu hangs here
        editor.lastContextMenu = m;
        void Promise.resolve(this.host.contextMenu?.(editor, m)).catch((e: Error) => this.host.log.warn(`${this.name(editor)}: context menu: ${e.message}`));
        return;
      case "presence":
        // who is here (PB-1196, W4-D): the status bar chip for the focused tab. Agent-written names and labels in it
        // are data shown to the person, never instructions (presenceChip makes them safe to show).
        editor.presence = m.presence;
        if (editor === this.focused) this.showPresence();
        return;
      case "log": {
        const text = `${this.name(editor)}: ${m.message}`;
        if (m.level === "error") this.host.log.error(text);
        else if (m.level === "warn") this.host.log.warn(text);
        else this.host.log.info(text);
        return;
      }
      case "devAction":
        this.host.log.info(`${this.name(editor)}: ${m.action === "retry" ? "Retry" : m.action === "reload" ? "Reload Window" : m.action === "showLog" ? "Show Log" : m.action} pressed`);
        if (m.action === "reload") return this.host.reloadWindow();
        if (m.action === "showLog") return this.host.showLog();
        if (m.action === "fetchParts") return void vscode.commands.executeCommand("protoboard.fetchParts", editor.root);
        // an empty level's Add a part: the Library side bar, where parts are found and added
        if (m.action === "openLibrary") return void vscode.commands.executeCommand("protoboard.library.focus");
        if (m.action !== "retry") return this.host.account(m.action);
        void this.host.retryDev(editor.root).catch((e: Error) => this.host.log.warn(`${this.name(editor)}: retry: ${e.message}`));
        return;
      case "event":
        if (m.event.type === "uhd-viewer:selectionChanged") editor.selection = m.event.selection;
        if (m.event.type === "uhd-viewer:history") editor.viewerHistory = m.event;
        void Promise.resolve(this.host.event(editor, m.event)).catch((e: Error) => this.host.notify(e.message, "error"));
        return;
      case "state": {
        editor.stateCount++;
        if (m.missing && m.missing !== editor.state?.missing) this.host.log.warn(`viewer ${basename(editor.root)}: ${m.missing} definition(s) the project names are not in its build (library parts that were not fetched?); they are drawn as placeholders. Fetch Parts (the notice's button, or the DRC finding's) adds them; the check lists each one`);
        editor.state = { path: m.path, label: m.label, view: m.view, nodes: m.nodes, views: m.views, ...(m.missing ? { missing: m.missing } : {}), ...(m.at ? { at: m.at } : {}) };
        this.retitle();
        this.tellSource(editor);
        this.host.stateChanged(editor);
        return;
      }
      case "edit": {
        const before = doc.layout;
        const after = m.layout;
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        doc.layout = after;
        if (m.snapshot) doc.snapshot = m.snapshot;
        this.changed.fire({
          document: doc,
          label: "Layout",
          undo: () => this.setLayout(doc, before),
          redo: () => this.setLayout(doc, after),
        });
        return;
      }
      case "openView":
        void vscode.commands.executeCommand("protoboard.openViewer", { root: editor.root, path: m.path, view: m.view, ...(m.params ? { params: m.params } : {}), beside: true });
        return;
      case "notify":
        this.host.notify(m.message, m.severity);
        return;
      case "source":
        void this.sourceAction(editor, m.action).catch((e: Error) => this.host.notify(e.message, "error"));
        return;
      case "theme":
        editor.themeReported(m);
        return;
      case "hierarchy":
        editor.hierarchyReported(m);
        return;
      case "boards":
        // straight to the page (not through post, which keeps only the last message of a kind while it loads)
        void editor.panel.webview.postMessage({ type: "boards", boards: findBoards(editor.root) } satisfies ToWebview);
        return;
      case "boardOpen":
        this.openBoard(editor, m.board);
        return;
      case "boardClose":
        this.closeBoard(editor, m.board);
        return;
      case "boardCheck":
        void editor.boardFeeds.get(m.board)?.feed.then((f) => f.recheck());
        return;
    }
  }

  /**
   * A board's feed for a tab's layout view: the live board service when one runs (connectBoard), else the board's
   * files; snapshots, commits and the checks' derived data go to the page by postMessage, read only.
   */
  private openBoard(editor: ViewerEditor, key: string) {
    this.closeBoard(editor, key);
    const entry = findBoards(editor.root).find((b) => b.key === key);
    const send = (message: BoardFeedMessage) => void editor.panel.webview.postMessage({ type: "boardFeed", message } satisfies ToWebview);
    if (!entry) {
      send({ type: "error", board: key, message: `no board folder with key ${key} in this project` });
      return;
    }
    const slot: { feed: Promise<BoardFeed>; unsubscribe?: () => void } = { feed: BoardFeed.open({ dir: join(editor.root, entry.dir), key, projectRoot: editor.root, log: (l) => this.host.log.info(l) }) };
    editor.boardFeeds.set(key, slot);
    slot.feed.then(
      (f) => {
        if (editor.boardFeeds.get(key) !== slot) return void f.close();
        slot.unsubscribe = f.subscribe(send);
      },
      (e: Error) => {
        editor.boardFeeds.delete(key);
        send({ type: "error", board: key, message: e.message });
      },
    );
  }

  private closeBoard(editor: ViewerEditor, key: string) {
    const slot = editor.boardFeeds.get(key);
    if (!slot) return;
    editor.boardFeeds.delete(key);
    slot.unsubscribe?.();
    void slot.feed.then((f) => f.close(), () => {});
  }

  private setLayout(doc: ViewerDocument, layout: ViewerLayout) {
    doc.layout = layout;
    for (const e of doc.editors) e.post({ type: "layout", layout });
  }

  async saveCustomDocument(document: ViewerDocument): Promise<void> {
    if (!document.dirty) return document.markSaved();
    await this.host.save(document.target, document.layout, document.snapshot);
    document.markSaved();
    // the dev server rebuilds with the new display file; the tabs drop the edits it now holds
    for (const e of document.editors) e.post({ type: "saved" });
    document.layout = emptyLayout();
  }

  async saveCustomDocumentAs(document: ViewerDocument): Promise<void> {
    // a layout has one home, the project's display file
    await this.saveCustomDocument(document);
  }

  async revertCustomDocument(document: ViewerDocument): Promise<void> {
    this.setLayout(document, emptyLayout());
  }

  async backupCustomDocument(document: ViewerDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    const backup: ViewerBackup = { schema: "protoboard.viewer-backup/v0", layout: document.layout, ...(document.snapshot ? { snapshot: document.snapshot } : {}) };
    await vscode.workspace.fs.writeFile(context.destination, Buffer.from(JSON.stringify(backup)));
    return {
      id: context.destination.toString(),
      delete: () => void Promise.resolve(vscode.workspace.fs.delete(context.destination)).catch(() => undefined),
    };
  }

  dispose() {
    this.presenceItem.dispose();
    for (const r of this.relays.values()) r.dispose();
    this.relays.clear();
    this.changed.dispose();
    for (const c of this.commands) c.dispose();
    for (const c of this.commands_) c.dispose();
  }
}

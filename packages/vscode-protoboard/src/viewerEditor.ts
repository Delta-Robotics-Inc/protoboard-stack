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
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import * as vscode from "vscode";
import { join } from "node:path";
import { emptyLayout, hasEdits, parseFromWebview, type DevEndpoint, type FromWebview, type LayoutSnapshot, type ModuleSource, type SourceAction, type ToWebview, type ViewerEvent, type ViewerLayout, type ViewerSelection } from "../../web-viewer/src/vscode/protocol.js";
import { nonce } from "./html.js";
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
  /** What the tab shows now (the shell reports it). */
  state: { path: string; label: string; view: string; nodes: number; views: { id: string; title: string }[]; missing?: number; /** The part the tab is on, when it is not the level shown. */ at?: string } | undefined;
  /** The source file last told to the page (`path` and what it was), so it is told again only when it changes. */
  sourceSent: string | undefined;
  /** The webview answered `reportTheme` (tests). */
  themeReport: Extract<FromWebview, { type: "theme" }> | undefined;
  /** How many times the page said it runs, and reported what it shows (tests: a page that loads again is told the server again). */
  readyCount = 0;
  stateCount = 0;
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
      const key = (x: ToWebview) => (x.type === "command" ? `command:${x.command.type === "uhd-viewer:setView" ? "view" : x.command.type === "uhd-viewer:select" ? "select" : "nav"}` : x.type);
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

  private readonly commands: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: ViewerHost,
  ) {
    // from a canvas tab to its source (the tab's right-click menu and the Command Palette; the header's path posts the same)
    const on = (action: SourceAction) => (resource?: vscode.Uri) => this.sourceAction(this.editorOf(resource), action).catch((e: Error) => this.host.notify(e.message, "error"));
    this.commands = (Object.keys(SOURCE_COMMANDS) as SourceAction[]).map((a) => vscode.commands.registerCommand(SOURCE_COMMANDS[a], on(a)));
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
    if (editor) this.active = editor;
    this.host.focused(editor);
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
        path: editor.path,
        view: editor.state?.view ?? editor.document.target.view,
        media: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media")).toString(),
        ...(state.dev ? { dev: state.dev } : {}),
        ...(editor.document.dirty ? { layout: editor.document.layout } : {}),
        ...(editor.document.target.params ? { params: editor.document.target.params } : {}),
      },
    });
    this.tellSource(editor);
    editor.post(devMessage(state));
    this.host.log.info(`${this.name(editor)}: page written; it may read from ${editor.origins.join(", ")}${state.dev ? `; the dev server is at ${state.dev.url}` : `; no dev server yet (${state.message ?? "none"})`}`);
  }

  /** The project's dev server started, moved, restarted or stopped: every tab of it follows. */
  devChanged(root: string) {
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
        return;
      }
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
        if (m.action !== "retry") return this.host.account(m.action);
        void this.host.retryDev(editor.root).catch((e: Error) => this.host.log.warn(`${this.name(editor)}: retry: ${e.message}`));
        return;
      case "event":
        if (m.event.type === "uhd-viewer:selectionChanged") editor.selection = m.event.selection;
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
    }
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
    this.changed.dispose();
    for (const c of this.commands) c.dispose();
  }
}

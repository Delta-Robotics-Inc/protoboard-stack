/**
 * The item-6 surfaces (PB-912, PB-902, PB-903, PB-904, PB-945), registered
 * apart from the rest of the extension so other tracks can change the shell
 * without touching them:
 *
 * - **Project parts**, in its own container: the side bar (a webview drawing
 *   @protoboardai/views' ProjectParts, so its colours follow the theme and
 *   its rows have room; beta test 1, F15) and the **Project Parts page**, an
 *   editor tab that looks like the library: the same cards with pictures,
 *   grouped by tier, each with its sync status with the library and its part
 *   status (decision D3, PB-932). Data from `protoboard parts list`
 *   (offline), then `--check` (the libraries' recommendations). The
 *   container's badge counts the updates.
 * - **The BOM editor** (PB-904, PB-933): @protoboardai/views' BomEditor on
 *   the project's bill of materials (the design as last built, the offers
 *   the project holds, dollars); `Protoboard: Open Bill of Materials` opens
 *   it. It writes the units to build and the offers chosen to
 *   `parts/bom.json`. A release's ordering list (`ordering-list.csv`) opens
 *   in the same editor as a custom editor.
 * - **The full-page library** command (the page itself is the Library's).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import * as vscode from "vscode";
import type { BomModel, BomRowModel, ProjectPartModel, ProjectPartsModel } from "@protoboardai/views/parts-model";
import { bomCsv, projectPartsWaiting, rev } from "./libraryModel.js";
import { CLOUD_COMMANDS } from "./account.js";
import { showApp, tabIcon } from "./appView.js";
import { parseJsonOutput, runCli, type CliCommand } from "./cli.js";
import { bomFileProblems, projectBom, writeBomSettings } from "./cost.js";
import { answer, type LibraryController } from "./libraryView.js";
import type { ProjectIndex } from "./model.js";

/** What the parts surfaces need of the extension. */
export interface PartsHost {
  log: vscode.LogOutputChannel;
  cli(root: string): CliCommand;
  /** The project the views show. */
  project(): string | undefined;
  library: LibraryController;
  /** The last build's index of a project, when it has one. */
  index(root: string): ProjectIndex | undefined;
  openLocation(root: string, file: string, line?: number): Promise<void>;
  /** Focus instances in the viewer (the first one), revealing them in the Explorer. */
  focusInstances(root: string, paths: string[]): Promise<void>;
  guard(fn: () => unknown): Promise<unknown>;
  /** A part selected in the list: the Inspector shows it, the focus stays here (PB-919). */
  partPicked?(root: string, part: ProjectPartModel): void;
  /** Whether the cloud needs a sign-in now (PB-928): update checks, updates, compares and publishing ask for one first. */
  cloudLocked?(): Promise<boolean>;
  /** Ask the user to sign in (a cloud command, signed out). */
  askSignIn?(): Promise<void>;
}

export interface PartsViews extends vscode.Disposable {
  /** The project changed: the Project parts view follows it. */
  setProject(root: string | undefined): void;
  /** The project's parts as last listed (the Cloud panel counts them). */
  parts(): ProjectPartsModel | undefined;
  /** For the integration test. */
  snapshot(): { root?: string; parts?: ProjectPartsModel; checked: boolean; bomDrawn: boolean; drawn: string[]; pageOpen: boolean; selected?: string };
  /** Reload the Project parts view (`check`: ask the libraries too); resolves when listed. */
  refresh(check?: boolean): Promise<void>;
  /** Select a part in the list, as a click does (the integration test). */
  select(id: string): Promise<void>;
  /** The Project Parts page, in an editor tab (a part's "Project parts" breadcrumb, the side bar's heading). */
  openPage(): void;
  /** For the integration test: hand the BOM tab's serializer a panel with a page's saved state, as VS Code does after a window reload. */
  restoreBom(root: string): Promise<void>;
}

export function registerPartsViews(context: vscode.ExtensionContext, host: PartsHost): PartsViews {
  const parts = new ProjectPartsController(context, host);
  // a line's part opens as it does from the Project Parts page: a library part's detail, the project's own where it is written
  const bom = new BomEditorProvider(context, host, async (root, definition) => {
    if (parts.root !== root || !parts.report?.parts.some((x) => x.id === definition)) await parts.load(false).catch(() => undefined);
    return parts.open(definition);
  });
  const prices = vscode.workspace.createFileSystemWatcher("**/{parts/offers.json,parts/bom.json,parts/fx-rates.json,parts/evidence/*/sourcing.json,.protoboard/build/resolved.json}");
  // the cloud's commands (CLOUD_COMMANDS) ask to sign in instead of running, signed out; the rest are local work
  const cmd = (id: string, fn: (...args: any[]) => unknown) => vscode.commands.registerCommand(id, (...args) => host.guard(async () => (CLOUD_COMMANDS.has(id) && (await host.cloudLocked?.()) ? host.askSignIn?.() : fn(...args))));
  const origins = vscode.workspace.createFileSystemWatcher("**/parts/{origins.json,local/**/*.uhd.ts}");
  // a command run from the palette acts on the part selected in the view; the views pass the part's id
  const id = (arg?: unknown) => (typeof arg === "string" ? arg : undefined);
  const subs: vscode.Disposable[] = [
    vscode.window.registerWebviewViewProvider(ProjectPartsController.id, parts, { webviewOptions: { retainContextWhenHidden: true } }),
    parts,
    origins,
    origins.onDidChange(() => parts.changed()),
    origins.onDidCreate(() => parts.changed()),
    origins.onDidDelete(() => parts.changed()),
    prices,
    prices.onDidChange(() => bom.changed()),
    prices.onDidCreate(() => bom.changed()),
    prices.onDidDelete(() => bom.changed()),
    vscode.window.registerWebviewPanelSerializer(BomEditorProvider.projectType, bom),
    vscode.window.registerCustomEditorProvider(BomEditorProvider.viewType, bom, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
    cmd("protoboard.parts.refresh", () => parts.load(parts.checked)),
    cmd("protoboard.parts.check", () => parts.load(true)),
    cmd("protoboard.parts.openPage", () => parts.openPage()),
    cmd("protoboard.parts.open", (a?: unknown) => parts.open(id(a))),
    cmd("protoboard.parts.update", (a?: unknown) => parts.update(id(a))),
    cmd("protoboard.parts.restore", (a?: unknown) => parts.restore(id(a))),
    cmd("protoboard.parts.compare", (a?: unknown) => parts.compare(id(a))),
    cmd("protoboard.parts.publish", (a?: unknown) => parts.publish(id(a))),
    cmd("protoboard.parts.openSource", (a?: unknown) => parts.openSource(id(a))),
    // signed out, the full library opens too and shows the sign-in card, as the Library view does (B13); it loads nothing until then
    vscode.commands.registerCommand("protoboard.library.openPage", () => host.guard(() => host.library.openPage())),
    // Alt+Left in a part's detail (package.json's keybinding): the same as its back control
    cmd("protoboard.part.back", () => host.library.detailBack()),
    cmd("protoboard.openBom", (root?: string) => bom.openProjectBom(root ?? host.project())),
  ];
  return {
    setProject: (root) => parts.setProject(root),
    parts: () => parts.report,
    snapshot: () => ({ root: parts.root, parts: parts.report, checked: parts.checked, bomDrawn: bom.drawn, drawn: [...parts.drawn], pageOpen: parts.pageOpen, ...(parts.selected ? { selected: parts.selected } : {}) }),
    refresh: (check) => parts.load(!!check),
    select: (partId) => parts.select(partId),
    openPage: () => parts.openPage(),
    restoreBom: (root) => {
      bom.drawn = false;
      return bom.deserializeWebviewPanel(vscode.window.createWebviewPanel(BomEditorProvider.projectType, "Bill of materials", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true }), { extra: { root } });
    },
    dispose: () => {
      for (const d of subs) d.dispose();
      bom.dispose();
    },
  };
}

// ---------------------------------------------------------------- Project parts

/** Side bar or page → extension. */
type PartsMessage =
  | { type: "ready" | "check" | "openPage" | "openLibrary" }
  | { type: "open" | "openSource" | "update" | "restore" | "compare" | "publish"; id: string }
  /** A card asked for its library part's pages (PB-918): answered with `{ type: "answer", ask, ... }`. */
  | { type: "pages"; ask: number; ref: { key: string; revision?: number } };

class ProjectPartsController implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly id = "protoboard.parts";
  private view: vscode.WebviewView | undefined;
  private page: vscode.WebviewPanel | undefined;
  root: string | undefined;
  report: ProjectPartsModel | undefined;
  checked = false;
  /** The part last picked (the Inspector shows it; its row and card are outlined). */
  selected: string | undefined;
  /** Which webviews have drawn (their React app said "ready"): the integration test reads it. */
  readonly drawn = new Set<"sidebar" | "page">();
  private loading: Promise<void> | undefined;
  private listing = false;
  private timer: NodeJS.Timeout | undefined;
  private error: string | undefined;
  /** Parts being updated or restored, by id. */
  private readonly busy = new Map<string, string>();
  /** Library parts' pictures as webview URIs, by `library/id` (asked once each). */
  private readonly thumbs = new Map<string, string | null>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: PartsHost,
  ) {}

  get pageOpen(): boolean {
    return !!this.page;
  }

  private roots(): vscode.Uri[] {
    mkdirSync(this.host.library.cacheDir, { recursive: true });
    return [vscode.Uri.file(this.host.library.cacheDir)];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    showApp(view.webview, this.context.extensionUri, "project-parts", "Project parts", this.roots());
    view.webview.onDidReceiveMessage((m: PartsMessage) => void this.host.guard(() => this.receive(m, "sidebar")));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.ensure();
        this.post();
      }
    });
    view.onDidDispose(() => (this.view = undefined));
    this.ensure();
    this.post();
  }

  /** The Project Parts page: one editor tab, the same parts as cards. */
  openPage() {
    if (this.page) {
      this.page.reveal(undefined, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel("protoboard.partsPage", "Project Parts", { viewColumn: vscode.ViewColumn.Active }, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = tabIcon(this.context.extensionUri, "part");
    showApp(panel.webview, this.context.extensionUri, "project-parts-page", "Project Parts", this.roots());
    panel.webview.onDidReceiveMessage((m: PartsMessage) => void this.host.guard(() => this.receive(m, "page")));
    panel.onDidChangeViewState(() => panel.visible && this.post());
    panel.onDidDispose(() => {
      this.page = undefined;
      this.drawn.delete("page");
    });
    this.page = panel;
    this.ensure();
    this.post();
  }

  setProject(root: string | undefined) {
    if (root === this.root) return;
    this.root = root;
    this.report = undefined;
    this.checked = false;
    this.error = undefined;
    this.selected = undefined;
    this.busy.clear();
    this.thumbs.clear();
    this.post();
    if (this.view?.visible || this.page) this.ensure();
  }

  /** First time shown: the offline list, then what the libraries say. */
  ensure() {
    if (!(this.root ?? this.host.project()) || this.loading || this.report) return;
    // the libraries are asked only where the cloud may be used: signed out, the list is the project's own (PB-928)
    void this.load(false).then(async () => ((await this.host.cloudLocked?.()) ? undefined : this.load(true)));
  }

  /** parts/origins.json or a researched part changed. */
  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.report && void this.load(this.checked), 400);
  }

  async load(check: boolean): Promise<void> {
    const root = this.root ?? this.host.project();
    if (!root) return;
    this.root = root;
    const run = async () => {
      this.listing = true;
      this.post();
      try {
        const args = ["parts", "list", ...(check ? ["--check"] : []), "--format", "json"];
        const list = () => runCli(this.host.cli(root), args, { cwd: root, env: this.host.library.cliEnv() });
        const r = await (check && this.view?.visible ? vscode.window.withProgress({ location: { viewId: ProjectPartsController.id } }, list) : list());
        if (root !== this.root) return;
        this.report = parseJsonOutput<ProjectPartsModel>(r, "protoboard parts list");
        this.checked = this.checked || check;
        this.error = undefined;
        for (const p of this.report.checked?.problems ?? []) this.host.log.warn(`parts: not checked: ${p}`);
      } catch (e) {
        if (root !== this.root) return;
        this.error = (e as Error).message;
        this.host.log.error(`parts list: ${this.error}`);
      } finally {
        this.listing = false;
      }
      this.post();
      void this.fetchThumbs();
    };
    const previous = this.loading;
    this.loading = (async () => {
      await previous;
      await run();
    })();
    const mine = this.loading;
    await mine;
    if (this.loading === mine) this.loading = undefined;
  }

  /** The pictures of the library parts, from their libraries (verified and cached by the Library), a few at a time. */
  private async fetchThumbs() {
    const root = this.root;
    if (!this.report?.parts.some((p) => p.tier === "catalog" && p.library && !this.thumbs.has(`${p.library}/${p.id}`))) return;
    await this.host.library.whenLoaded().catch(() => undefined);
    if (root !== this.root) return;
    const wanted = (this.report?.parts ?? []).filter((p) => p.tier === "catalog" && p.library && !this.thumbs.has(`${p.library}/${p.id}`) && this.host.library.connection(p.library));
    // asked once each: a part whose library has no picture of it stays without (null)
    for (const p of wanted) this.thumbs.set(`${p.library}/${p.id}`, null);
    const queue = [...wanted];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const key = `${p.library}/${p.id}`;
        let file: string | undefined;
        try {
          file = await this.host.library.thumbnailFile(p.library!, p.id);
        } catch (e) {
          this.host.log.warn(`parts: picture of ${key}: ${(e as Error).message}`);
          this.thumbs.delete(key); // the library did not answer: ask again with the next listing
          continue;
        }
        if (root !== this.root) return;
        // every webview of the extension maps the cache folder the same way
        const webview = (this.view ?? this.page)?.webview;
        if (file && webview) {
          this.thumbs.set(key, webview.asWebviewUri(vscode.Uri.file(file)).toString());
          this.post();
        } else if (file) this.thumbs.delete(key);
      }
    };
    await Promise.all([0, 1, 2, 3].map(() => worker()));
  }

  /** The model both webviews draw: the report, each part with its picture and what is being done to it. */
  model(): ProjectPartsModel {
    const r = this.report;
    const parts = (r?.parts ?? []).map((p) => {
      const thumb = p.library ? this.thumbs.get(`${p.library}/${p.id}`) : undefined;
      const busy = this.busy.get(p.id);
      return { ...p, ...(thumb ? { thumbnail: thumb } : {}), ...(busy ? { busy } : {}) };
    });
    return {
      parts,
      counts: r?.counts ?? { total: 0, library: 0, researched: 0, designed: 0, updates: 0, diverged: 0 },
      ...(r?.checked ? { checked: r.checked } : {}),
      ...(this.listing || (!r && !this.error && !!this.root) ? { loading: true } : {}),
      ...(this.error ? { error: `Could not list the parts: ${this.error}` } : {}),
      // nothing listed yet, and nothing to list it from (B12): say why rather than "the project has no parts"
      ...(!r && !this.error && !this.root ? { waiting: projectPartsWaiting() } : {}),
    };
  }

  private post() {
    const v = this.view;
    if (v) {
      const c = this.report?.counts;
      v.badge = c && c.updates ? { value: c.updates, tooltip: `${c.updates} part update${c.updates === 1 ? "" : "s"} available` } : undefined;
      v.description = this.root ? basename(this.root) : undefined;
    }
    if (!this.view?.visible && !this.page?.visible) return;
    const message = { type: "model", model: this.model(), ...(this.selected ? { selected: this.selected } : {}), ...(this.root ? { project: basename(this.root) } : {}) };
    if (this.view?.visible) void this.view.webview.postMessage(message);
    if (this.page?.visible) void this.page.webview.postMessage(message);
  }

  private async receive(m: PartsMessage, from: "sidebar" | "page") {
    switch (m?.type) {
      case "ready":
        this.drawn.add(from);
        this.ensure();
        // pictures asked for while no page was open had nowhere to be shown and wait for a listing: this page is one
        void this.fetchThumbs();
        return this.post();
      case "check":
        return (await this.host.cloudLocked?.()) ? this.host.askSignIn?.() : this.load(true);
      case "openPage":
        return this.openPage();
      case "openLibrary":
        return this.host.library.openPage();
      case "pages": {
        const webview = from === "page" ? this.page?.webview : this.view?.webview;
        return answer(webview, m.ask, () => this.host.library.partPages(m.ref, webview!));
      }
      case "open":
        return this.open(m.id);
      case "openSource":
        return this.openSource(m.id);
      case "update":
      case "restore":
      case "compare":
      case "publish":
        // each uses the library's account features (PB-928): signed out, it asks to sign in
        if (await this.host.cloudLocked?.()) return this.host.askSignIn?.();
        return m.type === "update" ? this.update(m.id) : m.type === "restore" ? this.restore(m.id) : m.type === "compare" ? this.compare(m.id) : this.publish(m.id);
    }
  }

  private part(id?: string): ProjectPartModel {
    const p = this.report?.parts.find((x) => x.id === (id ?? this.selected));
    if (!p) throw new Error(id ? `no ${id} among the project's parts` : "pick a part in the Project parts view");
    return p;
  }

  /** Select a part: its row and card are outlined, the Inspector shows it. */
  async select(id: string) {
    const p = this.part(id);
    this.selected = p.id;
    this.post();
    if (this.root) this.host.partPicked?.(this.root, p);
  }

  /** A library part opens its detail (its breadcrumb returns to the Project Parts page); the project's own parts open where they are written. */
  async open(id?: string) {
    const p = this.part(id);
    await this.select(p.id);
    if (p.tier === "catalog" && p.library) await this.host.library.whenLoaded().catch(() => undefined);
    if (p.tier === "catalog" && p.library && this.host.library.connection(p.library)) return this.host.library.showPart(p.library, p.id, undefined, undefined, "parts");
    return this.openSource(p.id);
  }

  async openSource(id?: string) {
    const p = this.part(id);
    if (!this.root) throw new Error("open a Protoboard project first");
    await this.host.openLocation(this.root, p.file, p.line);
  }

  async compare(id?: string) {
    const p = this.part(id);
    if (p.library) await this.host.library.whenLoaded().catch(() => undefined);
    if (!p.library || !this.host.library.connection(p.library)) throw new Error(`${p.id} comes from library ${p.library ?? "(none)"}, which is not active`);
    await this.select(p.id);
    await this.host.library.showPart(p.library, p.id, undefined, "revisions", "parts");
  }

  private async working(id: string, what: string, fn: () => Promise<unknown>) {
    this.busy.set(id, what);
    this.post();
    try {
      await fn();
    } finally {
      this.busy.delete(id);
      this.post();
    }
  }

  async update(id?: string) {
    const p = this.part(id);
    if (!p.library || p.recommended === undefined) throw new Error(`no update is known for ${p.id}: check for updates first`);
    await this.working(p.id, "Updating", () => this.host.library.vendor("update", p.id, p.recommended!, p.library!));
    await this.load(true);
  }

  /** A diverged part back to its pinned revision: `parts add <id>@<rev>` restores the vendored files. */
  async restore(id?: string) {
    const p = this.part(id);
    if (typeof p.revision !== "number" || !p.library) throw new Error(`${p.id} is not pinned to a library revision`);
    const ok = await vscode.window.showWarningMessage(
      `Restore ${p.name} to ${rev(p.revision)}?`,
      { modal: true, detail: `Your edits to ${(p.edited ?? []).join(", ") || "its files"} are replaced by the vendored revision. To keep them, copy the part to parts/local as a derived part under a new id first.` },
      "Restore",
    );
    if (ok !== "Restore") return;
    await this.working(p.id, "Restoring", () => this.host.library.vendor("add", p.id, p.revision as number, p.library!));
    await this.load(this.checked);
  }

  /** Submitting a researched part for verification: the CLI's publish, shown first as a dry run in a terminal. */
  async publish(id?: string) {
    const p = this.part(id);
    const root = this.root!;
    const cli = this.host.cli(root);
    const t = vscode.window.createTerminal({ name: `Protoboard: publish ${p.id}`, cwd: root, env: this.host.library.cliEnv() as Record<string, string>, iconPath: new vscode.ThemeIcon("cloud-upload") });
    t.show();
    t.sendText([cli.command, ...cli.args, "parts", "publish", p.file, "--dry-run"].map((x) => (/^[\w@%+=:,./-]+$/.test(x) ? x : `'${x.replace(/'/g, `'\\''`)}'`)).join(" "));
  }

  dispose() {
    clearTimeout(this.timer);
    this.page?.dispose();
  }
}

// ---------------------------------------------------------------- BOM editor

/** The project folder (the one with protoboard.config.ts) above a file. */
function projectRootOf(file: string): string | undefined {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(d, "protoboard.config.ts"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

interface Shown {
  root: string;
  model: BomModel;
}

/** What a BOM tab draws: the project's design, or a file's lines (an ordering list). */
interface BomTab {
  panel: vscode.WebviewPanel;
  root: () => string;
  read: () => BomModel;
  shown?: Shown;
  /** Restored after a reload: say nothing until it has drawn once. */
  quiet?: boolean;
}

class BomEditorProvider implements vscode.CustomTextEditorProvider, vscode.WebviewPanelSerializer, vscode.Disposable {
  static readonly viewType = "protoboard.bom";
  /** The project's bill of materials, from the design: one tab per project. */
  static readonly projectType = "protoboard.bomProject";
  private readonly project = new Map<string, BomTab>();
  private readonly tabs = new Set<BomTab>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** A BOM webview has drawn (its React app said "ready"). */
  drawn = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: PartsHost,
    private readonly openPart: (root: string, definition: string) => Promise<unknown>,
  ) {}

  /** The bill of a CSV document: an ordering list's lines, priced from the offers the project holds, grouped by its modules. */
  private billOf(document: vscode.TextDocument): Shown {
    const file = document.uri.fsPath;
    const root = projectRootOf(file);
    if (!root) throw new Error(`${basename(file)} is not inside a Protoboard project (no protoboard.config.ts above it)`);
    const rel = relative(root, file).split(sep).join("/");
    const release = /^release\/([^/]+)\/system\/ordering-list\.csv$/.exec(rel);
    const model = projectBom(root, this.nameOf(root), this.host.index(root), { file: { rel, text: document.getText(), ...(release ? { release: release[1] } : {}) } });
    if (!model) throw new Error(`${rel} has no lines`);
    return { root, model };
  }

  /** The project's own name (protoboard.config.ts), as the CLI names it; the folder's until a build says. */
  private nameOf(root: string): string {
    return this.host.index(root)?.resolved.project?.name ?? basename(root);
  }

  private post(tab: BomTab) {
    try {
      tab.shown = { root: tab.root(), model: tab.read() };
      tab.quiet = false;
      // `root` goes into the page's saved state: a tab restored after a window reload says which project it is of
      void tab.panel.webview.postMessage({ type: "model", model: tab.shown.model, root: tab.shown.root });
    } catch (e) {
      // a restored tab keeps what it showed until the project's build has been read
      if (tab.quiet) this.host.log.info(`bill of materials: ${(e as Error).message}`);
      else void vscode.window.showErrorMessage(`Protoboard: ${(e as Error).message}`);
    }
  }

  private attach(tab: BomTab, more: vscode.Disposable[] = []) {
    this.tabs.add(tab);
    const subs = [...more, tab.panel.webview.onDidReceiveMessage((m: BomMessage) => void this.host.guard(() => (m?.type === "ready" ? ((this.drawn = true), this.post(tab)) : this.receive(m, tab))))];
    tab.panel.onDidDispose(() => {
      this.tabs.delete(tab);
      subs.forEach((d) => d.dispose());
    });
  }

  /** Offers, the BOM settings, the rate table or the build changed on disk: every open bill is priced again. */
  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tabs.forEach((t) => this.post(t)), 250);
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    showApp(panel.webview, this.context.extensionUri, "bom", "Bill of materials");
    const version = /release[\\/]([^\\/]+)[\\/]system[\\/]ordering-list\.csv$/.exec(document.uri.fsPath)?.[1];
    panel.title = version ? `Bill of materials · ${version}` : `Bill of materials · ${basename(document.uri.fsPath)}`;
    const tab: BomTab = { panel, root: () => this.billOf(document).root, read: () => this.billOf(document).model };
    this.attach(tab, [vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.toString() === document.uri.toString() && this.post(tab))]);
  }

  private readProject(root: string): BomModel {
    const problems = bomFileProblems(root);
    if (problems.length) throw new Error(problems.map((x) => `${x.file}: ${x.message}`).join("; "));
    const model = projectBom(root, this.nameOf(root), this.host.index(root));
    if (!model) throw new Error(`${basename(root)} has no build yet: run Protoboard: Check first`);
    return model;
  }

  /** Make a panel the project's BOM tab (a new one, or one VS Code restored). */
  private adopt(root: string, panel: vscode.WebviewPanel, quiet = false) {
    panel.title = `Bill of materials · ${this.nameOf(root)}`;
    panel.iconPath = tabIcon(this.context.extensionUri, "table");
    showApp(panel.webview, this.context.extensionUri, "bom", "Bill of materials");
    const tab: BomTab = { panel, root: () => root, read: () => this.readProject(root), quiet };
    this.project.set(root, tab);
    panel.onDidDispose(() => this.project.get(root) === tab && this.project.delete(root));
    this.attach(tab);
  }

  /** The project's bill of materials, from the design as last built. */
  async openProjectBom(root: string | undefined) {
    if (!root) throw new Error("open a Protoboard project first");
    this.readProject(root);
    const open = this.project.get(root);
    if (open) {
      open.panel.reveal();
      this.post(open);
      return;
    }
    this.adopt(root, vscode.window.createWebviewPanel(BomEditorProvider.projectType, "Bill of materials", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true }));
  }

  /**
   * A project's BOM tab that was open when the window closed or reloaded:
   * VS Code hands the panel back with the page's saved state, which names
   * the project. A tab of a project that is no longer there is closed.
   */
  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const root = (state as { extra?: { root?: unknown } } | undefined)?.extra?.root;
    if (typeof root !== "string" || !existsSync(join(root, "protoboard.config.ts")) || this.project.has(root)) return panel.dispose();
    // the bill of materials is the project's own (vendored offers): drawn again at once, signed in or not (PB-928)
    panel.webview.options = { enableScripts: true };
    this.adopt(root, panel, true);
  }

  private line(tab: BomTab, key: string): BomRowModel {
    const l = tab.shown?.model.groups.flatMap((g) => g.lines).find((x) => x.key === key);
    if (!tab.shown || !l) throw new Error("the bill of materials changed since it was shown; look again");
    return l;
  }

  private async receive(m: BomMessage, tab: BomTab) {
    const shown = tab.shown;
    switch (m?.type) {
      case "openPart":
        return this.openPart(tab.root(), this.line(tab, m.key).definition);
      case "openRow": {
        const l = this.line(tab, m.key);
        if (l.source) await this.host.openLocation(shown!.root, l.source.file, l.source.line);
        return;
      }
      case "focus": {
        const l = this.line(tab, m.key);
        if (!l.instances.length) throw new Error(`${l.item} is not used by an instance of the system in the last build`);
        return this.host.focusInstances(shown!.root, l.instances);
      }
      case "setUnits":
        // the view has already re-priced; the project keeps the number (parts/bom.json), and the watcher redraws
        writeBomSettings(tab.root(), { units: Number(m.units) });
        return this.changed();
      case "chooseOffer": {
        const l = this.line(tab, m.key);
        if (m.offer !== null && !l.offers.some((o) => o.id === m.offer)) throw new Error(`${l.item} holds no such offer; look again`);
        writeBomSettings(tab.root(), { offer: { line: l.key, offer: m.offer } });
        return this.changed();
      }
      case "refreshOffers":
        return vscode.commands.executeCommand("protoboard.fetchOffers", shown?.root);
      case "exportCsv": {
        if (!shown) return;
        // as the project holds it now: the units and offers the reader chose are already written
        const model = tab.read();
        const name = model.source.kind === "release" ? `bom-${model.source.version}.csv` : `${model.project || basename(shown.root)}-bom.csv`;
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(join(shown.root, name)), filters: { CSV: ["csv"] }, title: "Export the bill of materials" });
        if (!target) return;
        writeFileSync(target.fsPath, bomCsv(model));
        void vscode.window.showInformationMessage(`Protoboard: the bill of materials (${model.units} unit${model.units === 1 ? "" : "s"}) was written to ${relative(shown.root, target.fsPath) || target.fsPath}.`);
        return;
      }
      case "openLink":
        if (typeof m.url === "string" && /^https?:\/\//.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
        return;
    }
  }

  dispose() {
    clearTimeout(this.timer);
    for (const t of this.project.values()) t.panel.dispose();
  }
}

type BomMessage =
  | { type: "ready" | "refreshOffers" | "exportCsv" }
  | { type: "openRow" | "focus" | "openPart"; key: string }
  | { type: "setUnits"; units: number }
  | { type: "chooseOffer"; key: string; offer: string | null }
  | { type: "openLink"; url: string };

/**
 * Protoboard for VS Code (PB-816, PB-854, PB-856, PB-894): the viewer as
 * editor tabs (one module and view each, reading the project's `protoboard
 * dev` session), the Protoboard Inspector (the system's hierarchy and the
 * focused tab's selection) in the secondary side bar, the project's checks in
 * the Problems panel and the DRC panel, and a part's artifacts opened
 * natively. Everything runs through the project's own CLI and its build
 * output; the extension holds no project logic.
 */
import { homedir, release as osRelease } from "node:os";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import * as vscode from "vscode";
import { helpCommands, helpMarkdown, registerHelp } from "./help.js";
import { buildArtifacts, describeArtifact, describeInstances, openMode, partChoices, sortArtifacts, type ArtifactEntry, type PartChoice } from "./artifacts.js";
import { openOutside } from "./openOutside.js";
import { countDiagnostics, mapDiagnostics, parseCheck, skippedChecks, statusLabel, statusText, type Counts, type MappedDiagnostic } from "./check.js";
import { SCOPE_RENAMED_MESSAGE, canRun, chooseRuntime, describeCli, describeRuntime, parseJsonOutput, resolveCli, resolveNode, runCli, type CliCommand, type CliSettings, type Runtime } from "./cli.js";
import { compareVersions, listStacks, needsLink, npmAuthProblem, readLinkRecord, stackDir, stackHome } from "@protoboardai/core/stack";
import { configDir, signInStamp } from "@protoboardai/core/account";
import { tightenUserFolders } from "@protoboardai/core/user-folders";
import { ProjectTrust, trustQuestion, type TrustAnswer } from "./trust.js";
import { TERMINAL_PATH_ENV, applyPathPlan, describePathPlan, pathPlan } from "@protoboardai/core/path-setup";
import { StackReplaceRefused, carriedManifest, ensureCarried, ensureFromVsix, unpackedCarried, writeHome, type CarriedManifest } from "./stackStore.js";
import { loadCodeReference, type CodeReference } from "./codes.js";
import { ACCESS_EXIT_CODE } from "@protoboardai/core/access";
import { CHECKING, CLOUD_COMMANDS, accessMessage, accountCard, accountFromWhoAmI, accountView, accountItem, lockOf, terminalCommand, type AccountAction, type AccountState, type Lock } from "./account.js";
import { setAccountHandler, setAppAccess, trackApp } from "./appView.js";
import { cloudPageModel, pageOrder, projectAuthor, releaseOutcome, type ReleaseRecord, type ReleaseState } from "./cloud.js";
import type { CloudPageMessage } from "./cloudPage.js";
import { CloudViewProvider } from "./cloudView.js";
import { listReleases, projectCost, type CostLine, type CostModel, type ReleaseInfo } from "./cost.js";
import { DEV_RECORD, DevMonitor, DevProcess, STATE_ROUTE, devArgs, locateDev, probeDev, readDevRecord, whyNoDev, type DevEndpoint, type DevLogLine } from "./dev.js";
import { explainMarkdown, findings, unfetchedParts, type Finding } from "./drc.js";
import { DrcViewProvider } from "./drcView.js";
import { ExplorerProvider } from "./explorer.js";
import { packageHtml, packageLink, type PackagePageMessage } from "./packagePage.js";
import { nonce } from "./html.js";
import { BUNDLE_FILE, indexProject, linkFromViewer, localLinkId, readBuild, RESOLVED_FILE, viewerMessages, type BuildOutput, type ProjectIndex } from "./model.js";
import { IGNORED_DIRS, chooseProject, projectOf, projectRoots } from "./project.js";
import type { ViewerCommand as HostToViewer } from "../../web-viewer/src/vscode/protocol.js";
import { boardSection, groupCard, interfaceCard, libraryPartCard, linkCard, linkHarnessDefs, moduleCard, partCard, type DetailFiles, type InspectorCard } from "./inspector.js";
import { definitionsBelow, detailFiles, interfaceArtifacts, resourceRoots, smallModel } from "./inspectorFiles.js";
import { InspectorViewProvider, type InspectorAction, type InspectorContent } from "./inspectorView.js";
import { displayFile, saveLayout } from "./display.js";
import { ViewerEditors, type ViewerEditor } from "./viewerEditor.js";
import { VIEWER_TYPE, type ViewerTarget } from "./viewerPage.js";
import type { LayoutSnapshot, ViewerEvent, ViewerLayout } from "../../web-viewer/src/vscode/protocol.js";
import { hierarchyRowArg } from "../../web-viewer/src/vscode/protocol.js";
import { definitionSource, idLine, instanceAtCursor, instanceSource, moduleSource, projectRelative } from "./source.js";
import { buildTree, type ExplorerNode } from "./tree.js";
import { LibraryController, type LibraryPick } from "./libraryView.js";
import { rev } from "./libraryModel.js";
import { offerThemes } from "./themes.js";
import { aboutLine } from "./versions.js";
import { CAD_VIEWER, CadEditorProvider, isCadFile } from "./cadEditor.js";
import { registerPartsViews, type PartsViews } from "./partsViews.js";
import { canInitIn, partsFailure, folderFromName, folderHolding, folderNameProblem, folderNotice, initArgs, npxCommand, partsAddArgs, partsNotFetchedMessage, registryRefusal, templateChoices, toolsInstallHint, vscodeBefore, withoutRunHint } from "./newProject.js";
import { lensTitle, moduleAtLine, modulesInFile, type SourceModule } from "./sourceModules.js";
import { SettingsController, type SettingsLink } from "./settingsPage.js";

let instance: ProtoboardExtension | undefined;

/** A folder to ask the CLI from when no folder is open: the user's home. */
const homedirOr = (context: vscode.ExtensionContext) => process.env.HOME ?? process.env.USERPROFILE ?? dirname(context.extensionUri.fsPath);

/**
 * A web address handed to the system's browser exactly as it is written
 * (first builds review, item 22: a link must reach the browser whole).
 * `vscode.Uri.parse(url)` decodes the address and `toString()` encodes it
 * again its own way (`=` and `&` of a query become `%3D` and `%26`), so a
 * link with a query is not the same link afterwards. VS Code's opener takes
 * the address as a string and then opens that string untouched; where a
 * version refuses a string, the strictly parsed Uri is the next best.
 * Signing in does not come through here: `protoboard login` opens its own
 * page (packages/cli/src/openUrl.ts).
 */
export async function openWeb(url: string): Promise<boolean> {
  try {
    return await vscode.env.openExternal(url as unknown as vscode.Uri);
  } catch {
    return vscode.env.openExternal(vscode.Uri.parse(url, true));
  }
}

let cad: CadEditorProvider | undefined;

/** STEP and GLB in the CAD viewer tab (PB-906), beside the viewer like any opened file. */
export const openCad = (file: vscode.Uri, viewColumn?: vscode.ViewColumn) => vscode.commands.executeCommand("vscode.openWith", file, CAD_VIEWER, { viewColumn, preview: true });

/** The views of the Protoboard Inspector container, where the manifest puts them (VS Code names an extension's container `workbench.view.extension.<id>`). */
export const INSPECTOR_VIEWS = { container: "workbench.view.extension.protoboard-inspector", views: ["protoboard.inspector"] } as const;

/** The views a window with no project shows instead (PB-931), and a project that is not set up (first builds review, D2): one in each Protoboard container, each with its welcome (the manifest's `viewsWelcome`) that offers New Project or Initialize. */
export const START_VIEWS = ["protoboard.start.library", "protoboard.start.parts", "protoboard.start.cloud", "protoboard.start.inspector"] as const;

/**
 * One Protoboard Inspector (PB-919). Earlier builds had the hierarchy in an
 * activity-bar container; a hierarchy dragged from there to the secondary side
 * bar stays in a container of its own (VS Code keeps a moved view where it was
 * put), and the declared Inspector then showed as a second "Protoboard
 * Inspector". Once per profile, both views go back to the Inspector container.
 * VS Code's move also reveals the container; the editor keeps the focus.
 */
async function gatherInspector(context: vscode.ExtensionContext, again = false) {
  const KEY = "protoboard.inspectorGathered";
  if (context.globalState.get(KEY) && !again) return;
  await context.globalState.update(KEY, true);
  const editor = vscode.window.tabGroups.activeTabGroup.activeTab !== undefined;
  try {
    await vscode.commands.executeCommand("vscode.moveViews", { viewIds: [...INSPECTOR_VIEWS.views], destinationId: INSPECTOR_VIEWS.container });
  } catch {
    return;
  }
  if (editor) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
}

/**
 * What **Protoboard: New Project…** may be given instead of asking: the
 * template (`""` or `empty` for a blank project), where it goes (`dir`, the
 * project's own folder; or `folder`, a folder to make it in under its name),
 * the name, and whether to open it afterwards (`open: false` never asks).
 * One command (first builds review, item 21): Create Project… and New
 * Project… were two ways to the same thing.
 */
interface NewProjectArgs {
  template?: string;
  dir?: string;
  name?: string;
  folder?: string;
  open?: boolean;
  /** Was: run `npm install` afterwards. Nothing is installed into a project any more; accepted and ignored. */
  install?: boolean;
}


export function activate(context: vscode.ExtensionContext) {
  // the user's Protoboard folders (sign-ins, the stack) are readable by the user only, also when an earlier version made them (PB-1048)
  try {
    tightenUserFolders();
  } catch {}
  // the CAD viewer first: a STEP or GLB opened before any project is found still has its editor
  cad = CadEditorProvider.register(context);
  // the extension runs in every window (`onStartupFinished`), so that a project made in it later is noticed
  // (PB-931); what a project needs (its views gathered, the Inspector in front) starts when there is one
  instance = new ProtoboardExtension(context);
  // what the integration test reads; nothing else uses it
  return {
    projects: () => instance!.roots(),
    about: () => aboutLine(String(context.extension.packageJSON.version)),
    checkResult: (root: string) => instance!.results.get(root),
    devEndpoint: (root: string) => instance!.sessions.get(root)?.endpoint,
    explorer: () => ({ project: instance!.current, roots: instance!.explorer.roots }),
    findings: (root: string) => instance!.data.get(root)?.findings,
    library: () => instance!.library.snapshot(),
    librarySearch: (q: Record<string, string>) => instance!.library.setQuery(q),
    libraryReload: () => instance!.library.reload(),
    libraryLoadMore: () => instance!.library.loadMoreForTest(),
    libraryOpen: (key: string, origin?: "sidebar" | "page" | "parts") => instance!.library.openForTest(key, origin),
    // a message from the Library's side bar, as its page sends it on a click (PB-1039)
    libraryMessage: (m: { type: string; key?: string }) => instance!.library.messageForTest(m as never),
    libraryPreview: () => instance!.library.previewSnapshot(),
    libraryShow: (library: string, partId: string, origin?: "sidebar" | "page" | "parts") => instance!.library.showPart(library, partId, undefined, undefined, origin),
    cost: (root: string) => instance!.costOf(root),
    cloud: () => instance!.cloudModel(),
    cloudDrawn: () => instance!.cloudDrawn(),
    parts: () => instance!.partsViews.snapshot(),
    restoreBom: (root: string) => instance!.partsViews.restoreBom(root),
    partsRefresh: (check?: boolean) => instance!.partsViews.refresh(check),
    partsSelect: (id: string) => instance!.partsViews.select(id),
    partsOpenPage: () => instance!.partsViews.openPage(),
    libraryBack: () => instance!.library.detailBack(),
    // a card's pages and the shown part's prices, as their webviews ask for them (PB-918)
    libraryPages: (key: string, revision?: number) => instance!.library.pagesForTest({ key, ...(revision ? { revision } : {}) }),
    libraryPrices: () => instance!.library.pricesForTest(),
    gatherInspector: () => gatherInspector(context, true),
    generate: (root: string, options?: { allowDirty?: boolean; quiet?: boolean }) => instance!.generate(root, options),
    accountStatus: () => ({ text: instance!.account.text, tooltip: instance!.account.tooltip }),
    lock: () => instance!.lock,
    // what a cloud command said instead of running, signed out (PB-928)
    signInPrompts: () => [...instance!.signInPrompts],
    accountRefresh: () => instance!.refreshAccount(true),
    cliOf: (root: string) => instance!.cliInfo(root),
    // the integration test's stand-in for `protoboard dev` (the workspace's project has its own CLI, which comes
    // first): there only when VS Code runs the extension's tests, never in an installed extension
    ...(context.extensionMode === vscode.ExtensionMode.Test ? { useCliForTest: (file: string | undefined) => instance!.useCliForTest(file) } : {}),
    stack: () => instance!.stackInfo(),
    settings: {
      model: () => instance!.settings.model(),
      drawn: () => instance!.settings.drawn,
      useHome: (home: string) => instance!.settings.useHome(home),
      look: () => instance!.settings.look(),
      connect: (id: string) => instance!.settings.connect(id),
      disconnect: (id: string) => instance!.settings.disconnect(id),
      offer: (options?: { force?: boolean }) => instance!.settings.offer(options),
      offered: () => context.globalState.get<string>("protoboard.agents.offered"),
    },
    viewers: () =>
      [...instance!.viewers.editors].map((e) => ({
        uri: e.document.uri.toString(),
        root: e.root,
        target: e.document.target,
        title: e.panel.title,
        active: e.panel.active,
        focused: instance!.viewers.focused === e,
        dirty: e.document.dirty,
        state: e.state,
        selection: e.selection,
        loads: e.readyCount,
        states: e.stateCount,
      })),
    viewerTheme: () => (instance!.viewers.focused ?? [...instance!.viewers.editors][0])?.reportTheme(),
    /** A viewer tab's hierarchy panel, as its page reports it (PB-1042): by the tab's URI, else the focused tab. */
    viewerHierarchy: (uri?: string) => ([...instance!.viewers.editors].find((e) => e.document.uri.toString() === uri) ?? instance!.viewers.focused)?.reportHierarchy(),
    inspector: () => instance!.inspector.current,
    inspectorDrawn: () => instance!.inspector.drawn,
    inspectorRoots: () => instance!.inspector.roots,
    inspectorProbe: () => instance!.inspector.probe(),
    drcProbe: () => instance!.drc.probe(),
    inspectorOpenArtifact: (defId: string, artifactId: string) => {
      const c = instance!.inspector.current;
      return "card" in c ? instance!.openCardArtifact(c.card, defId, artifactId) : undefined;
    },
    drcDrawn: () => instance!.drc.drawn,
    /** A click on a node of the hierarchy, by its key. */
    explorerPick: (key: string) => {
      const n = instance!.explorer.node(key);
      if (n) instance!.treePicked(n, true);
      return !!n;
    },
    inspectorAction: (card: InspectorCard, action: "focus" | "source" | "artifacts" | "operation" | "pair") => instance!.inspectorAction(card, action),
    openViewer: (target: Partial<ViewerTarget> & { root: string }) => instance!.openViewer(target),
    // PB-931, PB-946: a project made after the window opened, the Inspector in front once, a .uhd.ts in the viewer
    state: () => instance!.windowState(),
    createProject: (arg: { dir: string; template?: string; install?: boolean }) => instance!.newProject({ ...arg, open: false }),
    // first builds review, D2: a project that is not set up; and what the pages are told about the library's sign-in
    setupProject: (root?: string) => instance!.setupProject(root),
    access: () => accessMessage(instance!.lock),
    sourceModules: (file: string) => instance!.sourceModulesOf(vscode.Uri.file(file)),
    openSourceInViewer: (file: string, defId?: string) => instance!.openSourceInViewer(vscode.Uri.file(file), defId),
    cadViewers: () => [...(cad?.tabs.values() ?? [])],
  };
}

export async function deactivate() {
  await instance?.dispose();
  instance = undefined;
}

/** A project's dev session as the extension sees it (the viewer tabs read from it). */
interface Session {
  root: string;
  /** A server this extension started. */
  process?: DevProcess;
  /** Where the session is served: our server, or one started elsewhere (attached). */
  endpoint?: DevEndpoint;
  /** The same, as a webview reaches it (`asExternalUri`: a forwarded port in a remote window). */
  external?: DevEndpoint;
  /** Starting or attaching, so a second command waits for the same result. */
  starting?: Promise<DevEndpoint>;
  monitor?: DevMonitor;
  /** What the tabs say while there is no server to read from. */
  status?: { message: string; busy?: boolean };
}

/** What `protoboard.openViewer` takes: a project folder, or a module and view of one. */
type OpenViewerArg = string | (Partial<ViewerTarget> & { root?: string; beside?: boolean; preserveFocus?: boolean; background?: boolean });

/** What a module's command is given: a node of the tree, or a viewer tab's hierarchy row (its `data-vscode-context`). */
type NodeArg = ExplorerNode | Record<string, unknown>;

/** The user put another view in front of the Inspector, or closed its side bar, while using the window (QA B3). */
const INSPECTOR_AWAY = "protoboard.inspector.awayByUser";

/** The Inspector with no viewer tab open (PB-1042: it follows the focused tab). */
export const NO_VIEWER = "Open a viewer tab to inspect what it shows: the hierarchy is at its left, and a module or link selected there or on the canvas shows here.";

/** A project's last build, as the Explorer and the DRC view use it. */
interface ProjectData {
  build: BuildOutput;
  index: ProjectIndex;
  tree: ExplorerNode[];
  findings: Finding[];
  codes: CodeReference;
}

interface CheckResult {
  counts: Counts;
  at: Date;
  skipped: string[];
  files: Set<string>;
}

const SEVERITY: Record<MappedDiagnostic["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Explain's pages (B15): a code's entry, read in the Markdown preview. */
const EXPLAIN_SCHEME = "protoboard-explain";

class ProtoboardExtension {
  readonly log = vscode.window.createOutputChannel("Protoboard", { log: true });
  readonly diagnostics = vscode.languages.createDiagnosticCollection("protoboard");
  readonly status = vscode.window.createStatusBarItem("protoboard.status", vscode.StatusBarAlignment.Left, 10);
  /** Protoboard Cloud account (PB-911): the CLI's sign-in for the project's Protoboard library (account.ts). */
  readonly account = vscode.window.createStatusBarItem("protoboard.account", vscode.StatusBarAlignment.Left, 9);
  private accountState: AccountState = { state: "unknown" };
  private accountChecked = 0;
  private signInTerminal: vscode.Terminal | undefined;
  readonly results = new Map<string, CheckResult>();
  readonly sessions = new Map<string, Session>();
  readonly data = new Map<string, ProjectData>();
  /**
   * The current project's module tree (tree.ts), by node key: what the commands of a module and the
   * Inspector's cards look up. It is drawn by each viewer tab's own hierarchy panel (PB-1042), not by a view of its own.
   */
  readonly explorer = new ExplorerProvider();
  readonly drc: DrcViewProvider;
  readonly viewers: ViewerEditors;
  readonly inspector: InspectorViewProvider;
  readonly library: LibraryController;
  private readonly cloud: CloudViewProvider;
  /** Project parts, the BOM editor, the full-page library (PB-912; partsViews.ts). */
  readonly partsViews: PartsViews;
  /** The settings page and the agents' MCP configuration (PB-930; settingsPage.ts). */
  readonly settings: SettingsController;
  /** `protoboard release` runs, by project: the Cloud view shows the state of the current one. */
  private readonly releasing = new Map<string, ReleaseState>();
  private readonly packagePanels = new Map<string, vscode.WebviewPanel>();
  private cloudTimer: NodeJS.Timeout | undefined;
  /** The cost model the Cloud view shows, so a click on a line finds it. */
  private shownCost: { root: string; cost: CostModel } | undefined;
  /** The project the Explorer and the DRC view show. */
  current: string | undefined;
  private selectedPath: string | undefined;
  /** A part picked in the Library or Project parts (PB-919): the Inspector shows it until a viewer or the hierarchy selects something. */
  private picked: InspectorContent | undefined;
  /** An interface picked in the hierarchy (PB-940): the Inspector shows it while the viewer keeps its module selected. */
  private pickedInterface: { root: string; key: string; path: string } | undefined;
  private readonly checking = new Map<string, AbortController>();
  private readonly failed = new Set<string>();
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly buildTimers = new Map<string, NodeJS.Timeout>();
  private cursorTimer: NodeJS.Timeout | undefined;
  private known: Promise<string[]> | undefined;
  private disposed = false;
  /** Projects whose folder went while the window was open (B5), looked for until they come back. */
  private goneRoots = new Set<string>();

  /** **Protoboard: About**: the version, which the extension shares with the stack (PB-944). */
  private async about() {
    const line = aboutLine(String(this.context.extension.packageJSON.version));
    const choice = await vscode.window.showInformationMessage(line, "Copy", "Show Log");
    if (choice === "Copy") await vscode.env.clipboard.writeText(line);
    else if (choice === "Show Log") this.log.show();
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    // the log's first line: which version this is (the extension's and the stack's are one number)
    this.log.info(aboutLine(String(context.extension.packageJSON.version)));
    // then what a report needs (PB-943): which extension, which VS Code, which machine, and the PATH the CLI is started with
    const ext = context.extension.packageJSON as { version?: string };
    this.log.info(
      `Protoboard extension ${ext.version ?? "?"} in VS Code ${vscode.version} (${vscode.env.appName}, ${vscode.env.uiKind === vscode.UIKind.Web ? "browser" : "desktop"}${vscode.env.remoteName ? `, remote ${vscode.env.remoteName}` : ""}) on ${process.platform} ${process.arch} ${osRelease()}; the extension host's Node.js is ${process.version}`,
    );
    this.log.info(`PATH of this window (a VS Code started from the macOS Dock has the system's, not the shell's): ${process.env.PATH ?? process.env.Path ?? "(none)"}`);
    // PB-928: only the cloud's commands need a sign-in; signed out, they ask for one instead of running
    const cmd = (id: string, fn: (...args: any[]) => unknown) => vscode.commands.registerCommand(id, (...args) => this.guard(async () => (CLOUD_COMMANDS.has(id) && (await this.cloudLocked()) ? this.askSignIn() : fn(...args))));
    // PB-929: the stack this build carries, and where it is unpacked
    this.carried = carriedManifest(context.extensionPath);
    this.log.info(
      this.carried
        ? `this extension carries the Protoboard stack ${this.carried.version} (UHD ${this.carried.uhd}) for ${this.carried.platforms.join(", ")}; it is unpacked to ${stackDir(this.home, this.carried.version)} the first time it is needed`
        : "this build of the extension carries no stack (a development build): a project uses its own installed packages, a Protoboard installed for the user, or protoboard.cliPath",
    );
    this.showLock();
    this.status.name = "Protoboard";
    this.status.command = "protoboard.check";
    this.account.name = "Protoboard Cloud account";
    this.showAccount();
    this.account.command = "protoboard.account";
    const watcher = vscode.workspace.createFileSystemWatcher("**/protoboard.config.ts", false, true, false);
    // a build run anywhere (a terminal, the CLI in a task) refreshes the views
    const builds = vscode.workspace.createFileSystemWatcher(`**/${RESOLVED_FILE.split("\\").join("/")}`);
    // what the Cloud view's cost and package come from: releases, vendored offers, sourcing evidence
    const costs = vscode.workspace.createFileSystemWatcher("**/{release/*/manifest.json,release/*/system/ordering-list.csv,parts/offers.json,parts/bom.json,parts/fx-rates.json,parts/evidence/*/sourcing.json}");
    this.viewers = new ViewerEditors(context.extensionUri, {
      log: this.log,
      ensureDev: (root) => this.ensureDev(root),
      retryDev: (root) => this.retryDev(root),
      account: (action) => this.accountAction(action),
      reloadWindow: () => void vscode.commands.executeCommand("workbench.action.reloadWindow"),
      showLog: () => this.log.show(),
      devState: (root) => this.devState(root),
      event: (editor, event) => this.fromViewer(editor, event),
      focused: (editor) => this.viewerFocused(editor),
      stateChanged: (editor) => this.viewerStateChanged(editor),
      save: (target, layout, snapshot) => this.saveViewerLayout(target, layout, snapshot),
      notify: (message, severity) => this.notify(message, severity),
      closed: (root) => this.viewerClosed(root),
      sourceOf: (root, path) => (this.data.get(root) ? moduleSource(this.data.get(root)!.index, path, (f) => readText(root, f)) : undefined),
    });
    this.inspector = new InspectorViewProvider(context.extensionUri, {
      action: (card, action) => this.guard(() => this.inspectorAction(card, action)),
      focusPath: (path) => this.guard(() => this.current && this.toViewer(this.current, viewerMessages({ path }), true)),
      // something picked inside the details: the viewer shows it, and the Inspector follows the viewer's selection
      select: (sel) => this.guard(() => this.current && this.toViewer(this.current, sel.kind === "node" ? viewerMessages({ path: sel.id }) : [{ type: "uhd-viewer:select", ids: [`link:${sel.id}`] }], true)),
      finding: (key) => this.guard(() => this.locateFinding(key)),
      explain: (key) => this.guard(() => this.explainFinding(key)),
      openArtifact: (card, defId, artifactId) => this.guard(() => this.openCardArtifact(card, defId, artifactId)),
      openLink: (url) => this.guard(() => openWeb(url)),
      // an interface card's Open in source and an open slot's Connect… (PB-1042, design A)
      interfaceSource: (req) => this.guard(() => this.openInterfaceSource(req, false)),
      connect: (req) => this.guard(() => this.openInterfaceSource(req, true)),
      problem: (message) => this.log.warn(message),
      // only the projects, the packages their artifacts are in, and the library's cache
      roots: () => resourceRoots([...new Set([...this.data.keys(), ...(this.current ? [this.current] : [])])].map((root) => ({ root, index: this.data.get(root)?.index })), this.library.cacheDir),
    });
    this.drc = new DrcViewProvider(context.extensionUri, context.workspaceState, {
      locate: (f) => this.guard(() => this.locate(f)),
      openSource: (f) => this.guard(() => f.location && this.openLocation(this.current!, f.location.file, f.location.line)),
      explain: (f) => this.guard(() => this.explain(f)),
      fix: () => this.guard(() => this.fetchMissingParts(this.current)),
      refresh: () => this.guard(() => this.check(this.current, { silent: false })),
    });
    this.library = new LibraryController(context, {
      log: this.log,
      cli: (root) => this.trustedCli(root),
      project: () => this.readyProject(),
      partsChanged: (root) => this.check(root, { silent: true }),
      openInViewer: (root, partId) => this.openPartInViewer(root, partId),
      openFile: (root, file) => this.openLocation(root, file),
      guard: (fn) => this.guard(fn),
      account: () => accountView(this.accountState),
      signIn: () => this.signIn(),
      signOut: () => this.signOut(),
      partPicked: (pick) => this.libraryPartPicked(pick),
      openProjectParts: () => this.partsViews.openPage(),
      locked: () => this.lock.locked,
      recheckAccount: () => this.refreshAccount(true),
    });
    const act = <T extends CloudPageMessage>(fn: (m: T) => unknown) => (m: T) => this.guard(() => fn(m));
    this.cloud = new CloudViewProvider(
      context.extensionUri,
      {
        generate: act(() => this.generate(this.current)),
        focus: act((m) => this.focusCostLine(m.index)),
        openRow: act((m) => this.openCostRow(m.index)),
        openList: act(() => this.openCostList()),
        fetchOffers: act(() => this.fetchOffers(this.current)),
        openPackage: act((m) => this.openPackage(this.current, m.version, m.what)),
        showLog: () => this.log.show(),
        signIn: act(() => this.signIn()),
        signOut: act(() => this.signOut()),
        openBom: act(() => vscode.commands.executeCommand("protoboard.openBom", this.current)),
        publish: () => void vscode.window.showInformationMessage("Protoboard: publishing a project is not available yet. Publish parts from Project Parts."),
        requestQuote: () => void vscode.window.showInformationMessage("Protoboard: quotes are not available yet. Send the Manufacturing Package's ordering list to your suppliers."),
      },
      () => this.showCloud(),
    );
    this.partsViews = registerPartsViews(context, {
      log: this.log,
      cli: (root) => this.trustedCli(root),
      project: () => this.readyProject(),
      library: this.library,
      index: (root) => this.data.get(root)?.index,
      openLocation: (root, file, line) => this.openLocation(root, file, line),
      focusInstances: (root, paths) => this.focusInstances(root, paths),
      guard: (fn) => this.guard(fn),
      partPicked: (root, part) => this.projectPartPicked(root, part),
      cloudLocked: () => this.cloudLocked(),
      askSignIn: () => this.askSignIn(),
    });
    this.settings = new SettingsController(context, {
      log: this.log,
      version: String(ext.version ?? "?"),
      account: () => accountView(this.accountState),
      signIn: () => this.signIn(),
      signOut: () => this.signOut(),
      project: () => this.current,
      // the launcher an agent starts uses the CLI this extension itself would run (PB-929): the carried stack and its runtime
      cliSettings: (folder) => this.cliSettings(folder),
      links: () => this.settingsLinks(),
      openLibraries: () => this.library.setManage(true),
      guard: (fn) => this.guard(fn),
    });
    context.subscriptions.push(
      this.settings,
      this.log,
      this.diagnostics,
      this.status,
      this.account,
      watcher,
      builds,
      costs,
      costs.onDidChange(() => this.cloudChanged()),
      costs.onDidCreate(() => this.cloudChanged()),
      costs.onDidDelete(() => this.cloudChanged()),
      this.explorer,
      watcher.onDidCreate(() => this.refreshRoots()),
      watcher.onDidDelete(() => this.refreshRoots()),
      builds.onDidChange((u) => this.buildChanged(u)),
      builds.onDidCreate((u) => this.buildChanged(u)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refreshRoots()),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        void this.updateStatus();
        void this.followEditor(e);
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.cursorMoved(e)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc)),
      // the user's choice in the secondary side bar (QA B3): the Inspector hidden while they use the window is theirs
      this.inspector.onVisibility((visible) => {
        if (visible) return void this.context.workspaceState.update(INSPECTOR_AWAY, false);
        if (this.disposed || !vscode.window.state.focused || Date.now() - this.ourReveal < 3000) return;
        void this.context.workspaceState.update(INSPECTOR_AWAY, true);
      }),
      vscode.window.registerWebviewViewProvider(DrcViewProvider.id, this.drc, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.registerWebviewViewProvider(LibraryController.id, this.library, { webviewOptions: { retainContextWhenHidden: true } }),
      this.library,
      this.partsViews,
      vscode.window.registerWebviewViewProvider(CloudViewProvider.id, this.cloud, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.registerCustomEditorProvider(VIEWER_TYPE, this.viewers, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }),
      this.viewers,
      // the Inspector view writes its own page: it is tracked here like the views app's other pages (it ignores the library's flag)
      vscode.window.registerWebviewViewProvider(
        InspectorViewProvider.id,
        {
          resolveWebviewView: (view) => {
            this.inspector.resolveWebviewView(view);
            trackApp(view.webview);
          },
        },
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      cmd("protoboard.openViewer", (arg?: OpenViewerArg) => this.openViewOf(arg)),
      cmd("protoboard.openModule", (n?: NodeArg) => this.openNodeAsTab(n)),
      // the former id of New Project (Create Project…), kept for what still calls it: one command, one implementation
      cmd("protoboard.init", (arg?: NewProjectArgs) => this.newProject(arg)),
      cmd("protoboard.setupProject", (root?: string) => this.setupProject(typeof root === "string" ? root : undefined)),
      cmd("protoboard.trustProject", (root?: string) => this.trustProject(typeof root === "string" ? root : undefined)),
      cmd("protoboard.path.add", () => this.addToPath()),
      cmd("protoboard.tools.install", (id?: string, root?: string) => this.installRuntime(typeof id === "string" ? id : undefined, typeof root === "string" ? root : undefined)),
      cmd("protoboard.openSourceInViewer", (uri?: vscode.Uri, defId?: string) => this.openSourceInViewer(uri, typeof defId === "string" ? defId : undefined)),
      // a window with no project, or one whose project is not set up: each Protoboard container has a view whose welcome offers New Project or Initialize (nothing to list)
      ...START_VIEWS.map((id) => vscode.window.registerTreeDataProvider(id, { getChildren: () => [], getTreeItem: (x: vscode.TreeItem) => x })),
      // documentation, feedback and Discord: the Cloud side bar's Help view and the palette (PB-1070)
      ...registerHelp(),
      this.lensChanged,
      vscode.languages.registerCodeLensProvider({ scheme: "file", pattern: "**/*.uhd.ts" }, { onDidChangeCodeLenses: this.lensChanged.event, provideCodeLenses: (doc) => this.lenses(doc) }),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("protoboard.editor.codeLens") && this.lensChanged.fire()),
      cmd("protoboard.check", (root?: string) => this.check(root, { reveal: true })),
      cmd("protoboard.openArtifact", (arg?: string | { root?: string; instance?: string }) => this.openArtifact(arg)),
      cmd("protoboard.stopDev", (root?: string) => this.stopDev(root)),
      vscode.workspace.registerTextDocumentContentProvider(EXPLAIN_SCHEME, { provideTextDocumentContent: (uri) => this.explanations.get(uri.toString()) ?? "" }),
      cmd("protoboard.fetchParts", (root?: string) => this.fetchMissingParts(typeof root === "string" ? root : undefined)),
      // Problems: a definition nothing defines has a quick fix, Fetch Parts (B6)
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
        provideCodeActions: (_doc, _range, ctx) => {
          const missing = ctx.diagnostics.filter((d) => d.code === "PB_UNRESOLVED_DEFINITION");
          if (!missing.length) return [];
          const a = new vscode.CodeAction("Fetch Parts: add the project's missing library parts", vscode.CodeActionKind.QuickFix);
          a.command = { command: "protoboard.fetchParts", title: "Fetch Parts" };
          a.diagnostics = missing;
          a.isPreferred = true;
          return [a];
        },
      }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
      cmd("protoboard.showLog", () => this.log.show()),
      cmd("protoboard.about", () => this.about()),
      cmd("protoboard.openSettings", () => this.settings.open()),
      cmd("protoboard.agents.connect", () => this.settings.connectPicked()),
      // a module's commands: from a row of a viewer tab's hierarchy (its right-click menu), the Command Palette, or the tests
      cmd("protoboard.explorer.focus", (n?: NodeArg) => this.focusNode(n, true)),
      cmd("protoboard.explorer.select", (n?: NodeArg) => this.focusNode(n, false)),
      cmd("protoboard.explorer.openSource", (n?: NodeArg) => this.openNodeSource(n)),
      cmd("protoboard.explorer.openArtifact", (n?: NodeArg) => this.openNodeArtifact(n)),
      cmd("protoboard.explorer.runOperation", (n?: NodeArg) => this.runNodeOperation(n)),
      // the hierarchy is each viewer tab's own (PB-1042): these act on the focused tab's
      cmd("protoboard.explorer.filter", () => this.hierarchyCommand("filter")),
      cmd("protoboard.hierarchy.toggle", () => this.hierarchyCommand("toggle")),
      cmd("protoboard.hierarchy.reveal", (n?: NodeArg) => this.revealNode(n)),
      cmd("protoboard.explorer.refresh", () => this.check(this.current, { silent: false })),
      cmd("protoboard.explorer.switchProject", () => this.switchProject()),
      cmd("protoboard.library.manage", () => this.library.setManage(true)),
      cmd("protoboard.library.closeManage", () => this.library.setManage(false)),
      cmd("protoboard.library.refresh", () => this.library.reload()),
      cmd("protoboard.library.add", (ref?: string) => this.addPartCommand(ref)),
      cmd("protoboard.generate", (root?: string) => this.generate(root ?? this.current)),
      cmd("protoboard.openPackage", (root?: string) => this.openPackage(root ?? this.current, undefined, "index")),
      cmd("protoboard.fetchOffers", (root?: string) => this.fetchOffers(root ?? this.current)),
      cmd("protoboard.cloud.refresh", () => this.showCloud()),
      cmd("protoboard.account", () => this.accountActions()),
      cmd("protoboard.signIn", () => this.signIn()),
      cmd("protoboard.signInDevice", () => this.signIn(true)),
      cmd("protoboard.signOut", () => this.signOut()),
      cmd("protoboard.account.check", () => this.refreshAccount(true)),
      cmd("protoboard.newProject", (given?: NewProjectArgs) => this.newProject(given)),
      cmd("protoboard.stack.show", () => this.showStack()),
      cmd("protoboard.stack.update", (root?: string) => this.updateProjectStack(root)),
      cmd("protoboard.project.upgrade", (root?: string) => this.upgradeProject(root)),
      cmd("protoboard.stack.install", (root?: string) => this.installProjectStack(root)),
      cmd("protoboard.stack.fromVsix", (file?: string, root?: string) => this.stackFromVsix(file, root)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("protoboard.terminal.addCommand")) this.terminalCommand();
        if (e.affectsConfiguration("protoboard.nodePath")) this.runtimes.clear();
      }),
      vscode.window.onDidChangeWindowState((w) => {
        // a sign-in done elsewhere (another window, a terminal) shows up when this window is used again
        if (w.focused && Date.now() - this.accountChecked > 60_000) void this.refreshAccount();
      }),
      vscode.window.onDidCloseTerminal((t) => {
        if (t === this.signInTerminal) {
          this.signInTerminal = undefined;
          // the terminal closes by itself when the login succeeded: say so where it is seen
          void this.refreshAccount().then((a) => {
            if (a.state === "signed-in") void vscode.window.setStatusBarMessage(this.lock.locked ? "$(account) Signed in; this account is not invited to the Protoboard library yet" : `$(account) Signed in to Protoboard${a.email ? ` as ${a.email}` : ""}`, 6000);
          });
        }
      }),
    );
    void this.updateStatus();
    // the account buttons of the Protoboard pages (the Library's sign-in card)
    setAccountHandler((action) => this.accountAction(action));
    setAppAccess(this.lock);
    // a sign-in made anywhere (this window, a terminal, an agent) is noticed at once (first builds review, item 24)
    this.watchCredentials();
    // a project folder moved or deleted while the window is open (B5)
    this.watchFoldersGone();
    // the command an earlier build left in ~/.protoboard/bin is given to this window's terminals too
    this.terminalCommand();
    // agents (PB-930): an updated extension is recorded for the launcher, in a window with a project or without
    void this.settings.refreshLauncher();
    void this.start();
    // the carried stack is unpacked at the first start, with its progress shown, so the terminal's command is there
    // (and the launcher an agent starts is recorded again once it is: an update moved the CLI, PB-930)
    if (this.carried)
      void this.prepareStack()
        .then(() => this.settings.refreshLauncher())
        .catch((e: Error) => this.log.error(`the carried stack: ${e.message}`));
  }

  // ---- the stack this extension carries (PB-929; stackStore.ts, docs/specs/distribution.md)

  /** The user's Protoboard folder: ~/.protoboard, or PROTOBOARD_HOME. */
  readonly home = stackHome();
  private carried: CarriedManifest | undefined;
  private stackReady: Promise<void> | undefined;
  private readonly runtimes = new Map<string, Runtime>();

  /**
   * Unpack the carried stack if this is its first use (or a newer build of
   * it), with progress, then write the terminal's command. One run however
   * many callers; a failure can be tried again.
   */
  prepareStack(): Promise<void> {
    const manifest = this.carried;
    if (!manifest) return Promise.resolve();
    this.stackReady ??= (async () => {
      const dir = stackDir(this.home, manifest.version);
      // the extension's own build replaces a copy of its version from elsewhere: it is the code the user installed
      const run = (onProgress?: (fraction: number, what: string) => void) => ensureCarried(this.context.extensionPath, this.home, { replace: true, ...(onProgress ? { onProgress } : {}) });
      let unpacked = false;
      if (unpackedCarried(this.home, manifest)) await run();
      else {
        this.log.info(`unpacking the carried stack ${manifest.version} into ${dir} (first use of this version)`);
        const t0 = Date.now();
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: setting up its stack ${manifest.version} in ${dir}` }, async (progress) => {
          let said = 0;
          await run((fraction, what) => {
            const pct = Math.floor(fraction * 100);
            if (pct > said) {
              progress.report({ increment: pct - said, message: what.replace(/^Unpacking /, "unpacking ") });
              said = pct;
            }
          });
        });
        unpacked = true;
        this.log.info(`the carried stack ${manifest.version} is in ${dir} (${((Date.now() - t0) / 1000).toFixed(1)} s). Projects link to it from their node_modules; deleting the folder is safe, the extension unpacks it again.`);
      }
      // VS Code's own runtime, for machines without Node.js 22: its path changes when VS Code updates, so it is written every time
      const home = writeHome(this.home, { runtime: process.execPath, version: manifest.version });
      this.log.info(`the terminal's command is ${join(home.bin, process.platform === "win32" ? "protoboard.cmd" : "protoboard")}; without a Node.js 22 or later it runs on ${process.execPath}`);
      this.terminalCommand();
      if (unpacked) {
        // said once per version, and it counts as this window's one notice (an empty folder is not also asked about)
        this.noticed = true;
        const path = "Add to PATH";
        const plan = pathPlan(home.bin);
        void vscode.window
          .showInformationMessage(
            `Protoboard ${manifest.version} is installed. VS Code's terminals have the protoboard command.`,
            ...(plan.kind === "already" ? [] : [path]),
            "Show Folder",
          )
          .then((a) => (a === path ? this.guard(() => this.addToPath()) : a === "Show Folder" ? this.showStack() : undefined));
      }
    })().catch((e: Error) => {
      this.stackReady = undefined;
      throw e;
    });
    return this.stackReady;
  }

  /**
   * `~/.protoboard/bin` at the end of the PATH of this window's terminals
   * (`protoboard.terminal.addCommand`), whenever the command is there: written
   * by this build, or by an earlier one that carried a stack.
   */
  private terminalCommand() {
    const env = this.context.environmentVariableCollection;
    const bin = join(this.home, "bin");
    const on = vscode.workspace.getConfiguration("protoboard").get<boolean>("terminal.addCommand", true) && existsSync(join(bin, process.platform === "win32" ? "protoboard.cmd" : "protoboard"));
    env.description = new vscode.MarkdownString("Adds the `protoboard` command (the Protoboard installed for your user by the Protoboard extension) to the end of `PATH`");
    if (on) {
      env.append("PATH", `${delimiter}${bin}`);
      // says that entry is this window's own: `protoboard setup` in such a terminal still puts it on the user's PATH (PB-1037)
      env.replace(TERMINAL_PATH_ENV, bin);
    } else {
      env.delete("PATH");
      env.delete(TERMINAL_PATH_ENV);
    }
  }

  /**
   * **Protoboard: Add the protoboard Command to PATH** (first builds review,
   * D3): the command the extension keeps in `~/.protoboard/bin`, for terminals
   * outside VS Code and for agents that start their own shell. It says what
   * it would change (one line in the shell's start file, or the user's Path
   * on Windows) and changes it only on a yes.
   */
  private async addToPath() {
    const bin = join(this.home, "bin");
    if (!existsSync(join(bin, process.platform === "win32" ? "protoboard.cmd" : "protoboard"))) {
      if (this.carried) await this.prepareStack();
      else return void vscode.window.showInformationMessage("Protoboard: this build has no protoboard command to add to PATH.");
    }
    const plan = pathPlan(bin);
    if (plan.kind === "already") return void vscode.window.showInformationMessage(`Protoboard: ${describePathPlan(plan)}`);
    const yes = "Add to PATH";
    const a = await vscode.window.showInformationMessage("Add the protoboard command to your PATH?", { modal: true, detail: describePathPlan(plan) }, yes);
    if (a !== yes) return;
    const done = applyPathPlan(plan);
    this.log.info(`PATH: ${done.message}`);
    void vscode.window.showInformationMessage(`Protoboard: ${done.message}`);
  }
  /** This window has shown its one unasked notice (set-up finished, an empty folder, a project to initialize). */
  private noticed = false;

  /** **Protoboard: Show Where the Stack Is Installed**. */
  private async showStack() {
    const dir = this.carried ? stackDir(this.home, this.carried.version) : join(this.home, "stack");
    if (!existsSync(dir)) return void vscode.window.showInformationMessage(this.carried ? `Protoboard: the stack ${this.carried.version} has not been unpacked yet; it goes to ${dir}.` : `Protoboard: this build carries no stack. Copies installed from a registry go to ${dir}.`);
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir));
  }

  /** What the integration test reads. */
  stackInfo() {
    return { home: this.home, carried: this.carried?.version, unpacked: this.carried ? !!unpackedCarried(this.home, this.carried) : false, stacks: listStacks(this.home).map((s) => ({ version: s.marker.version, source: s.marker.source })) };
  }
  /**
   * Whether a project's code may run (PB-1048, trust.ts): asked once per
   * project folder before a check, Initialize, the dev server or the
   * project's own CLI first runs, and kept in the config folder.
   */
  readonly trust = ((dir: string) => new ProjectTrust({ dir: () => dir, workspaceTrusted: () => vscode.workspace.isTrusted, ask: (root) => this.askTrust(root) }))(
    // the folder as the window started: a later change of PROTOBOARD_CONFIG_DIR (a test signing out) does not forget the answers
    configDir(),
  );

  private async askTrust(root: string): Promise<TrustAnswer> {
    const q = trustQuestion(basename(root), root);
    this.log.info(`${basename(root)}: asking whether to run the project's code (${root})`);
    const a = await vscode.window.showWarningMessage(q.message, { modal: true, detail: q.detail }, q.trust, q.refuse);
    const answer: TrustAnswer = a === q.trust ? "trust" : a === q.refuse ? "refuse" : undefined;
    this.log.info(`${basename(root)}: ${answer === "trust" ? "trusted: its code runs" : answer === "refuse" ? "not trusted: none of its code runs (Protoboard: Trust This Project's Code… asks again)" : "no answer: nothing of it runs until asked again"}`);
    return answer;
  }

  /** Throws when the project's code may not run, asking first when the folder was never answered. */
  private async requireTrust(root: string): Promise<void> {
    if (await this.trust.ensure(root)) return;
    throw new Error(this.untrustedMessage(root));
  }

  private untrustedMessage(root: string): string {
    return vscode.workspace.isTrusted
      ? `${basename(root)}'s code is not run: it was not trusted. Protoboard: Trust This Project's Code… asks again`
      : `${basename(root)}'s code is not run in Restricted Mode: trust the workspace first`;
  }

  /** The project's CLI, only when its code may run (asked before by `requireTrust`): every command that runs in a project comes through here. */
  private trustedCli(root: string): CliCommand {
    if (!this.trust.isTrusted(root)) throw new Error(this.untrustedMessage(root));
    return this.cli(root);
  }

  /** **Protoboard: Trust This Project's Code…**: ask again (a project that was refused, or to take trust back). */
  private async trustProject(given?: string) {
    const roots = await this.roots();
    const root = given ?? (roots.length > 1 ? (await vscode.window.showQuickPick(roots.map((r) => ({ label: basename(r), description: r, root: r })), { placeHolder: "Which project's code may run?" }))?.root : roots[0]);
    if (!root) return;
    const was = this.trust.answer(root);
    this.trust.set(root, undefined);
    let now = await this.trust.ensure(root);
    // the question dismissed: the earlier answer stands
    if (this.trust.answer(root) === undefined && was !== undefined) {
      this.trust.set(root, was);
      now = was;
    }
    if (now && was !== true) await this.arrive(root, false);
    if (!now) {
      // nothing of it runs from now on: a dev server this window started for it stops
      const s = this.sessions.get(root);
      if (s?.process?.running) await s.process.stop();
    }
  }

  private cliForTest: string | undefined;
  useCliForTest(file: string | undefined) {
    this.cliForTest = file;
    this.cliSaid.clear();
  }
  cliInfo(root: string) {
    const { prepare: _prepare, ...cli } = this.cli(root);
    return cli;
  }

  /** The Node.js for a `nodePath` setting: chosen once per value (it runs `node --version`). */
  private runtime(configured: string | undefined): Runtime {
    const key = configured ?? "";
    let r = this.runtimes.get(key);
    if (!r) {
      r = chooseRuntime(resolveNode(configured), { execPath: process.execPath, version: process.version, electron: !!process.versions.electron });
      this.runtimes.set(key, r);
    }
    return r;
  }

  /** **Protoboard: Update Project to the Stack This Extension Carries**: re-point the project's links, with its package.json ranges following when they must. */
  private async updateProjectStack(given?: string) {
    const root = await this.project(given);
    const manifest = this.carried;
    if (!manifest) throw new Error("this build of the extension carries no stack");
    await this.prepareStack();
    const runtime = this.runtime(vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root)).get<string>("nodePath"));
    const carried: CliCommand = { command: runtime.command, args: [join(stackDir(this.home, manifest.version), "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs")], from: "carried", ...(runtime.env ? { env: runtime.env } : {}) };
    const r = await runCli(carried, ["stack", "link", "--force", "--carried", "--format", "json"], { cwd: root, onStderr: (l) => this.log.info(`[stack ${basename(root)}] ${l}`) });
    const out = parseJsonOutput<{ linked: string[]; installed: string[]; version: string; range?: string; satisfied?: boolean }>(r, "protoboard stack link");
    this.cliSaid.delete(root);
    this.log.info(`${basename(root)}: ${out.linked.length} package(s) now link to the stack ${out.version}${out.installed.length ? `; ${out.installed.length} installed by npm were left as they are` : ""}`);
    if (out.installed.length && !out.linked.length) return void vscode.window.showInformationMessage(`Protoboard: ${basename(root)} uses npm packages. Update them with npm.`);
    const note = out.range && out.satisfied === false ? ` Its package.json still asks for ${out.range}: Protoboard: Update Project to This Extension's Protoboard Version (protoboard upgrade) moves it.` : "";
    void vscode.window.showInformationMessage(`Protoboard: ${basename(root)} now uses the stack ${out.version}.${note}`);
    await this.check(root, { silent: true });
  }

  /**
   * **Protoboard: Update Project to This Extension's Protoboard Version** (PB-1051): `protoboard upgrade` with the
   * carried CLI, for a project made by an earlier line (0.1.x) whose ranges exclude the carried stack: package.json's
   * ranges and pins, the links, AGENTS.md and CLAUDE.md, the vendored parts' layout.
   */
  private async upgradeProject(given?: string) {
    const root = await this.project(given);
    // it loads the project (its configuration, for the guidance and the parts): only a trusted project's code runs
    await this.requireTrust(root);
    const manifest = this.carried;
    if (!manifest) throw new Error("this build of the extension carries no stack");
    await this.prepareStack();
    const runtime = this.runtime(vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root)).get<string>("nodePath"));
    const carried: CliCommand = { command: runtime.command, args: [join(stackDir(this.home, manifest.version), "node_modules", "@protoboardai", "cli", "bin", "protoboard.mjs")], from: "carried", ...(runtime.env ? { env: runtime.env } : {}) };
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: updating ${basename(root)} to Protoboard ${manifest.version}` }, () =>
      runCli(carried, ["upgrade", "--format", "json"], { cwd: root, onStderr: (l) => this.log.info(`[upgrade ${basename(root)}] ${l}`) }),
    );
    const out = parseJsonOutput<{ from?: string; to: string; changes: unknown[]; next: string; linkNote?: string }>(r, "protoboard upgrade");
    this.cliSaid.delete(root);
    this.log.info(`${basename(root)}: upgraded from ${out.from ?? "no stack range"} to ${out.to} (${out.changes.length} package.json change(s)); next: ${out.next}`);
    void vscode.window.showInformationMessage(`Protoboard: ${basename(root)} now asks for Protoboard ${out.to}.${out.linkNote ? ` ${out.linkNote}.` : " Review the changes and commit them."}`);
    await this.check(root, { silent: true });
  }

  /** **Protoboard: Install the Stack Version the Project Pins**: `protoboard stack install`, which needs npm and a registry that has the packages. */
  private async installProjectStack(given?: string) {
    const root = await this.project(given);
    const cli = this.trustedCli(root);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: installing the stack version ${basename(root)} pins, from the registry npm uses` }, (progress) =>
      runCli(cli, ["stack", "install", "--format", "json"], {
        cwd: root,
        onStderr: (l) => {
          this.log.info(`[stack ${basename(root)}] ${l}`);
          progress.report({ message: l.slice(0, 80) });
        },
      }),
    );
    const out = parseJsonOutput<{ stack: string; version: string }>(r, "protoboard stack install");
    this.cliSaid.delete(root);
    void vscode.window.showInformationMessage(`Protoboard: the stack ${out.version} is in ${out.stack}, and ${basename(root)} links to it.`);
    await this.check(root, { silent: true });
  }

  /**
   * **Protoboard: Add the Stack from Another .vsix File…**: the stack an
   * older (or newer) Protoboard .vsix carries goes to the stack folder without
   * that extension being installed. It is how a project that pins another
   * version gets its stack on a machine with no npm and no registry
   * (resolution step 3): the person who invited you has the .vsix.
   */
  private async stackFromVsix(given?: string, root?: string) {
    const file = given ?? (await vscode.window.showOpenDialog({ title: "The Protoboard .vsix whose stack to add", openLabel: "Add Its Stack", canSelectMany: false, filters: { "VS Code extension": ["vsix"] } }))?.[0]?.fsPath;
    if (!file) return;
    const own = this.carried?.version;
    let r: Awaited<ReturnType<typeof ensureFromVsix>>;
    try {
      r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: adding the stack from ${basename(file)} to ${join(this.home, "stack")}` }, async (progress) => {
        let said = 0;
        return ensureFromVsix(file, this.home, {
          ...(own ? { exceptVersion: own } : {}),
          // a copy of that version from another build is replaced only when the user says so (PB-1048)
          replace: async (existing, incoming) => {
            const replace = "Replace It";
            const answer = await vscode.window.showWarningMessage(
              `${existing.dir} already holds the Protoboard stack ${incoming.version} from another build. Replace it with the one in ${basename(file)}?`,
              { modal: true, detail: `Projects linked to the stack ${incoming.version} would run the code in ${basename(file)} from then on. Replace it only if you trust where this file came from.` },
              replace,
            );
            return answer === replace;
          },
          onProgress: (fraction, what) => {
            const pct = Math.floor(fraction * 100);
            if (pct > said) {
              progress.report({ increment: pct - said, message: what.replace(/^Unpacking /, "unpacking ") });
              said = pct;
            }
          },
        });
      });
    } catch (e) {
      // the user kept the copy that is there
      if (e instanceof StackReplaceRefused) {
        this.log.info(`kept ${e.dir}: the stack ${e.version} in ${basename(file)} is another build, and replacing it was declined`);
        return;
      }
      throw e;
    }
    this.log.info(`the stack ${r.manifest.version} from ${file} is in ${r.stack.dir}${r.unpacked ? "" : " (it was there already)"}`);
    this.cliSaid.clear();
    // the projects of this window that pin it use it from now on (step 3); one of them follows at once
    const project = root ?? this.current;
    const uses = project ? this.cli(project) : undefined;
    void vscode.window.showInformationMessage(
      `Protoboard: the stack ${r.manifest.version} is in ${r.stack.dir}.${uses && uses.stack === r.stack.dir ? ` ${basename(project!)} uses it now.` : project ? ` ${basename(project)} does not pin that version, so it keeps the stack it had.` : ""}`,
    );
    if (project && uses?.stack === r.stack.dir) await this.check(project, { silent: true });
    return r.stack.dir;
  }

  /**
   * **Protoboard: New Project…** (PB-929, PB-931; first builds review, D2
   * and item 21): what to start from (blank is the default, first in the
   * list) and where, then `protoboard init` with the Protoboard installed for
   * the user. The project's packages are links to it, so nothing is installed
   * into the project and it works at once: in this window's folder the views
   * and the viewer start by themselves; elsewhere it is offered to open, in
   * a new window first.
   */
  async newProject(given: NewProjectArgs = {}): Promise<string | undefined> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
    // the CLI to ask and to run, in the one order (PB-929): one installed above the folder, the setting, a stack copy, the carried stack
    const cliFor = (dir: string): CliCommand | undefined => this.cliAt(dir) ?? (canRun(this.cliOutside()) ? this.cliOutside() : undefined);
    // asked in the window (not by a caller that names everything): the questions a person can answer
    const interactive = given.template === undefined;
    let template = given.template === "empty" ? "" : given.template;
    if (template === undefined) {
      const base = folders[0] ?? homedirOr(this.context);
      const cli = cliFor(base);
      let listed: string | undefined;
      if (cli) {
        try {
          listed = (await runCli(cli, ["init", "--list", "--format", "json"], { cwd: base })).stdout;
        } catch {
          listed = undefined;
        }
      }
      const pick = await vscode.window.showQuickPick(
        templateChoices(listed).map((t) => ({ label: t.title, description: t.id ? `the ${t.id} template` : "the default", detail: t.description, id: t.id })),
        { title: "New Protoboard project (1 of 2): what to start from", placeHolder: "A blank project, or a template", matchOnDescription: true, matchOnDetail: true },
      );
      if (!pick) return undefined;
      template = pick.id;
    }
    let dir = given.dir;
    if (!dir && given.folder) {
      // named by the caller: a folder of the project's name inside the one given
      const id = folderFromName(given.name ?? (template || "my-project"));
      if (!id) throw new Error("a project's name needs at least one letter or digit");
      dir = join(given.folder, id);
    }
    if (!dir) {
      type Where = vscode.QuickPickItem & { where: "here" | "inside" | "elsewhere"; folder?: string };
      const items: Where[] = [];
      for (const f of folders) {
        if (canInitIn(f)) items.push({ label: `$(folder-opened) In ${basename(f)}`, description: "this folder (it is empty)", detail: f, where: "here", folder: f });
        items.push({ label: `$(new-folder) In a new folder inside ${basename(f)}…`, detail: canInitIn(f) ? f : `${f} has files in it: a project needs a folder of its own`, where: "inside", folder: f });
      }
      items.push({ label: "$(folder) In another folder…", detail: "Pick or make an empty folder; it is offered to open when the project is made", where: "elsewhere" });
      const pick = await vscode.window.showQuickPick(items, { title: "New Protoboard project (2 of 2): where it goes", placeHolder: "An empty folder, or a new one" });
      if (!pick) return undefined;
      if (pick.where === "here") dir = pick.folder!;
      else if (pick.where === "inside") {
        const name = await vscode.window.showInputBox({
          title: `New folder in ${basename(pick.folder!)}`,
          prompt: "The project's folder; its name becomes the project's",
          value: template || "my-project",
          validateInput: (v) => folderNameProblem(v, pick.folder!),
        });
        if (!name) return undefined;
        dir = join(pick.folder!, name.trim());
      } else {
        const chosen = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Create Project Here", title: "An empty folder for the new Protoboard project" });
        if (!chosen?.[0]) return undefined;
        dir = chosen[0].fsPath;
      }
    }
    if (!canInitIn(dir)) throw new Error(`${dir} is not empty: a new project goes into an empty folder, or a new one`);
    const inWorkspace = folderHolding(dir, folders);
    const cli = cliFor(existsSync(dir) ? dir : dirname(dir));
    if (!cli) throw new Error("Protoboard has nothing to make a project with here: this build of the extension carries no stack, and no Protoboard is installed for your user. Install the Protoboard extension from the downloads site (it carries everything it needs), or set protoboard.cliPath.");
    const cwd = existsSync(dir) ? dir : dirname(dir);
    mkdirSync(cwd, { recursive: true });
    // a template's parts come from the part library, which wants a sign-in: ask before, not after (the project itself needs none)
    if (template && interactive && !(await this.signedInForParts(cli, cwd, template))) return undefined;
    this.log.info(`new project: ${template ? `template ${template}` : "blank"} in ${dir}`);
    // a project made here, from the stack's own template, is the user's: its code runs without asking (PB-1048).
    // Kept before init runs: the folder's views start as soon as its protoboard.config.ts appears.
    const trustedBefore = this.trust.answer(dir);
    this.trust.set(dir, true);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: creating ${basename(dir)}${template ? ` from the ${template} template` : ""}` }, (progress) => {
      progress.report({ message: template ? "getting the template's parts from the Protoboard library" : "writing the project" });
      return runCli(cli, initArgs(dir!, template || undefined, true, given.name), { cwd, env: this.library.cliEnv(), onStderr: (l) => this.log.info(`[init ${basename(dir!)}] ${l}`) });
    });
    let out: { root: string; files: string[]; partsError?: string; partsSkipped?: string; partsCommand?: string; stack?: { linked: string[]; version: string; stack: string }; stackError?: string };
    try {
      out = parseJsonOutput(r, "protoboard init");
    } catch (e) {
      this.trust.set(dir, trustedBefore);
      throw e;
    }
    this.trust.set(out.root, true);
    this.log.info(`created ${out.root}: ${out.files.length} files${out.stack ? `; ${out.stack.linked.length} package(s) link to the Protoboard stack ${out.stack.version} at ${out.stack.stack}` : ""}`);
    if (out.stackError) {
      this.log.warn(`${basename(out.root)} was created but not set up: ${out.stackError}`);
      void vscode.window.showWarningMessage(`Protoboard: ${basename(out.root)} was created but is not set up: ${out.stackError.split(". ")[0]}. Use Initialize.`, "Show Log").then((a) => a && this.log.show());
    }
    // signed out, init makes the project and leaves the library parts for after a sign-in (partsSkipped, PB-928)
    const missed = out.partsError ?? out.partsSkipped;
    if (missed) {
      this.log.warn(`the template's catalog parts were not fetched: ${missed}`);
      void this.partsNotFetched(out.root, missed, out.partsCommand, !!inWorkspace);
    }
    if (inWorkspace) {
      // the watcher sees protoboard.config.ts appear; a look now too, for file systems that report late. The views
      // and the viewer start by themselves (arrive)
      this.refreshRoots();
      return out.root;
    }
    if (given.open !== false) await this.offerToOpen(out.root, given.open === true);
    return out.root;
  }

  /**
   * A project made outside this window's folders (first builds review, item
   * 35): open it, in a new window first, and say what VS Code asks then.
   * `now`: the caller asked for it to be opened (this window when it holds no
   * folder, else a new one).
   */
  private async offerToOpen(dir: string, now = false) {
    const uri = vscode.Uri.file(dir);
    const none = !vscode.workspace.workspaceFolders?.length;
    const fresh = "Open in New Window";
    const here = "Open Here";
    const add = "Add to Workspace";
    const a = now
      ? none
        ? here
        : fresh
      : await vscode.window.showInformationMessage(`Protoboard: created ${basename(dir)} in ${dirname(dir)}. Trust the folder when VS Code asks.`, fresh, here, ...(none ? [] : [add]));
    if (a === add) vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri });
    else if (a) await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: a === fresh });
  }

  /** The CLI for what is done outside any project (New Project, signing in before there is one). */
  private cliOutside(): CliCommand {
    const home = this.cli(homedir());
    if (canRun(home)) return home;
    // a build that carries no stack: a CLI installed above the window's folder, when there is one
    const base = this.baseFolder();
    return base === homedir() ? home : this.cli(base);
  }

  // ---- the cloud's sign-in (PB-928): only the library's account features need it

  /** Whether the cloud may be used, and why not. Starts as "checking"; local work never looks at it. */
  lock: Lock = CHECKING;
  private accountAsked?: Promise<AccountState>;
  /** Whether the current project's views, first check and dev server have been started (`arrive`). */
  private startedProjects = false;

  /**
   * Whether a cloud command must ask for a sign-in now. While the first
   * answer is still coming, it waits for it rather than asking for nothing.
   */
  private async cloudLocked(): Promise<boolean> {
    if (this.lock.reason === "checking") await (this.accountAsked ?? this.refreshAccount(false)).catch(() => undefined);
    return this.lock.locked;
  }

  private showLock() {
    void vscode.commands.executeCommand("setContext", "protoboard.cloudLocked", this.lock.locked);
    void vscode.commands.executeCommand("setContext", "protoboard.access", this.lock.reason);
  }

  /**
   * The account state changed. Only the cloud's surfaces follow: the Library
   * shows its sign-in card or the library, and a cloud command asks to sign
   * in. The viewer, the Inspector, the hierarchy, checks and builds go on as
   * they were, signed in or not.
   */
  private applyLock() {
    const next = lockOf(this.accountState);
    const was = this.lock;
    this.lock = next;
    this.showLock();
    if (was.locked === next.locked && was.reason === next.reason && was.message === next.message) return;
    this.log.info(next.locked ? `the Protoboard library needs a sign-in (${next.reason}): the Library shows its sign-in card; local work goes on: ${next.message}` : "the Protoboard library may be used with this account");
    // the views app's pages are told the one flag; only the Library's screens act on it
    setAppAccess(next);
    // signed out, the Library lists no parts (PB-1039); signed in again, it is listed below
    this.library.lockChanged();
    if (!next.locked && was.locked && was.reason !== "checking") void this.library.reload();
  }

  /** An account button of a Protoboard page (the Library's sign-in card, the settings page). */
  accountAction(action: AccountAction) {
    void this.guard(() => (action === "signIn" ? this.signIn() : action === "signInDevice" ? this.signIn(true) : action === "signOut" ? this.signOut() : action === "showLog" ? this.log.show() : this.refreshAccount(true)));
  }

  /**
   * A sign-in made anywhere is noticed at once (first builds review, items 24
   * and W3: the status bar said "Sign in" after signing in). `login` and
   * `logout` touch a stamp beside the credentials, whichever store keeps them
   * (core's `CredentialStore.changed`); the credentials file changes too
   * where that is the store. Both are looked at every second and a half: two
   * `stat` calls, no process, no request. A change asks the CLI who is signed
   * in, and the status bar, the views and the viewer tabs follow.
   */
  private watchCredentials() {
    const look = () => {
      // read each time: the folder follows the environment (PROTOBOARD_CONFIG_DIR, in tests)
      const dir = configDir();
      return [signInStamp(dir), join(dir, "credentials.json")]
        .map((f) => {
          try {
            const st = statSync(f);
            return `${st.mtimeMs}:${st.size}`;
          } catch {
            return "-";
          }
        })
        .join("|");
    };
    let last = look();
    let busy = false;
    const timer = setInterval(() => {
      if (busy || this.disposed) return;
      const now = look();
      if (now === last) return;
      busy = true;
      this.log.info("the sign-in kept on this machine changed (a login or a logout, here or in a terminal): asking who is signed in");
      void this.refreshAccount(true)
        .catch(() => undefined)
        .finally(() => {
          // the check itself may have saved a refreshed token: that is not another change
          last = look();
          busy = false;
        });
    }, 1500);
    this.context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  /** The prompts a cloud command showed signed out, for the integration test. */
  readonly signInPrompts: string[] = [];

  /** A cloud command asked for while the library needs a sign-in. */
  private async askSignIn() {
    this.signInPrompts.push(this.lock.message);
    const again = this.lock.reason === "unreachable" || this.lock.reason === "unknown" || this.lock.reason === "checking";
    const choice = await vscode.window.showWarningMessage(`Protoboard: ${this.lock.message}`, ...(again ? ["Check Again", "Show Log"] : ["Sign In", "Sign In with a Code"]));
    if (choice === "Sign In") await this.signIn();
    else if (choice === "Sign In with a Code") await this.signIn(true);
    else if (choice === "Check Again") await this.refreshAccount(true);
    else if (choice === "Show Log") this.log.show();
  }

  /** The projects of the last look at the workspace (the lens provider and the editor commands read it without waiting). */
  private rootList: string[] = [];

  /** What the manifest's `when` clauses read: a project is open, or none is (the start views), and whether the current one still has to be set up. Neither before the first look. */
  private async setProjectContext(roots: string[]) {
    this.rootList = roots;
    await Promise.all([
      vscode.commands.executeCommand("setContext", "protoboard.hasProject", roots.length > 0),
      vscode.commands.executeCommand("setContext", "protoboard.noProject", roots.length === 0),
      vscode.commands.executeCommand("setContext", "protoboard.needsSetup", roots.length > 0 && this.needsSetup(this.current && roots.includes(this.current) ? this.current : roots[0]!)),
    ]);
  }

  /**
   * A project that is not set up on this machine (first builds review, D2):
   * its package.json names Protoboard packages that are neither installed in
   * it nor linked to a copy that exists, and no CLI of its own is found above
   * it. Initialize sets it up; until then nothing of it is checked or served.
   */
  private needsSetup(root: string): boolean {
    if (this.cliForTest) return false;
    try {
      return needsLink(root) && this.cli(root).from !== "project";
    } catch {
      return false;
    }
  }

  /**
   * A project is in the window: when it opened, or later (PB-931: an agent's
   * `protoboard init` in a folder that had none). Everything starts as on a
   * window opened on the project: the account, the Inspector in front (once
   * per workspace), the last build, the first viewer tab, the DRC panel, the
   * first check and the dev server. A project that is not set up on this
   * machine waits for Initialize first, saying so. None of it needs an
   * account (PB-928): signed in or out, the same happens.
   */
  private async arrive(root: string, later: boolean) {
    if (later) this.log.info(`${basename(root)}: a project appeared in the workspace (${join(root, "protoboard.config.ts")}); starting its views`);
    // the Protoboard themes are offered where there is a project, once: never in a window that has nothing to do with Protoboard
    void offerThemes(this.context);
    // the Inspector's views in its container (once per profile), then the Inspector in front (once per workspace)
    void gatherInspector(this.context).then(() => this.revealInspector());
    // nothing of the project runs (a check, Initialize, the dev server, its own CLI) before it is trusted (PB-1048)
    if (!(await this.trust.ensure(root))) {
      this.untrustedNotice(root);
      return;
    }
    if (!(await this.runnable(root))) return;
    if (this.disposed || !(await this.roots()).includes(root)) return;
    // the account, now that there is a project to ask about (PB-928)
    if (root === this.current && later) await this.refreshAccount();
    if (!this.data.has(root)) {
      const build = readBuild(root);
      if (build) this.applyBuild(root, build);
      if (root === this.current) this.showCurrent();
    }
    void this.openOnFirstVisit(root);
    if (root === this.current) this.startedProjects = true;
    // agents (PB-930): once, the offer to connect the ones found here, for a project that came after the window too
    if (later) setTimeout(() => !this.disposed && void this.guard(() => this.settings.offer()), 5000);
    const config = vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root));
    if (root === this.current && config.get<boolean>("drc.revealOnOpen", true)) void vscode.commands.executeCommand(`${DrcViewProvider.id}.focus`, { preserveFocus: true });
    if (root === this.current) this.checkOnOpen(root);
  }

  /** Once per project and window: its code is not run, and how to change that. */
  private untrustedNotice(root: string) {
    if (this.untrustedSaid.has(root)) return;
    this.untrustedSaid.add(root);
    this.log.info(`${basename(root)}: ${this.untrustedMessage(root)}`);
    if (!vscode.workspace.isTrusted) return;
    const again = "Trust Its Code…";
    void vscode.window.showInformationMessage(`Protoboard does not run ${basename(root)}'s code, so it is not checked or shown.`, again).then((a) => a === again && void vscode.commands.executeCommand("protoboard.trustProject", root));
  }
  private readonly untrustedSaid = new Set<string>();

  /** Projects that are not set up yet: the views offer Initialize, and a check is not tried. */
  private readonly waiting = new Set<string>();

  /**
   * The CLI this project's commands run is there to run, by the one order
   * (PB-929): the project's own, the setting, a stack copy, the carried
   * stack, or (a build that carries none) a global install on PATH. With a
   * carried stack that is always so.
   */
  private cliReady(root: string): boolean {
    // an untrusted project's own CLI never runs: commands that need no project (the account) use the CLI outside it
    return this.trust.isTrusted(root) && canRun(this.cli(root));
  }

  /** The project the parts views work on: the current one, once it is set up and its CLI can run (they list libraries through it). */
  private readyProject(): string | undefined {
    const root = this.current;
    return root && !this.waiting.has(root) && this.cliReady(root) ? root : undefined;
  }

  /**
   * The CLI for a folder that may hold no project (Create Project, signing in
   * before there is one), found in the same order as a project's: one
   * installed above the folder, the setting, the carried stack, or a global
   * install on PATH. Undefined when there is none.
   */
  private cliAt(dir: string): CliCommand | undefined {
    const cli = this.cli(dir);
    // a CLI in a node_modules above the folder is someone's project code: only from a trusted one (PB-1048)
    if (cli.from === "project" && !this.trust.isTrusted(dir)) return undefined;
    return canRun(cli) ? cli : undefined;
  }

  /** Where a command that needs no project runs: the window's first folder, else the home folder. */
  private baseFolder(): string {
    return (vscode.workspace.workspaceFolders ?? []).find((f) => f.uri.scheme === "file")?.uri.fsPath ?? homedirOr(this.context);
  }

  /**
   * Resolves true once the project is set up and its CLI can run. A project
   * whose packages are not there (cloned from git, or made by a CLI that could
   * not set it up) waits: the views offer **Initialize**, one notification
   * offers it too, and the folder is looked at every few seconds (an agent
   * may be setting it up; file watchers leave `node_modules` out). False when
   * the project went away.
   */
  private async runnable(root: string): Promise<boolean> {
    const ready = () => this.cliReady(root) && !this.needsSetup(root);
    if (ready()) return true;
    if (this.waiting.has(root)) return false;
    this.waiting.add(root);
    await this.setProjectContext(this.rootList);
    this.showCurrent();
    this.log.info(`${basename(root)}: not set up on this machine yet (its Protoboard packages are neither installed nor linked): the Protoboard views offer Initialize, which needs no npm and no registry`);
    this.offerSetup(root);
    try {
      for (;;) {
        await new Promise<void>((done) => {
          const t = setTimeout(done, 3000);
          this.setupWake.set(root, () => {
            clearTimeout(t);
            done();
          });
        });
        if (this.disposed || !existsSync(join(root, "protoboard.config.ts"))) return false;
        // the CLI is looked up again on every look, and logged only when the choice changes (B17: not every 3 s)
        if (ready()) {
          this.log.info(`${basename(root)}: it is set up`);
          return true;
        }
      }
    } finally {
      this.waiting.delete(root);
      this.setupWake.delete(root);
      this.cliSaid.delete(root);
      await this.setProjectContext(this.rootList);
      this.showCurrent();
    }
  }
  /** Ends a project's wait at once (Initialize finished). */
  private readonly setupWake = new Map<string, () => void>();

  /**
   * The one notification a window gives unasked (first builds review, D2 and
   * item 6): for a Protoboard project that is not set up, the offer to
   * initialize it; for an empty folder, the offer of a new project. Once per
   * project or folder, never both in one window, and nothing at all in a
   * folder that is neither: Protoboard does not nag where it was not asked.
   */
  private giveNotice(roots: string[]) {
    if (this.noticed) return;
    // the first start of this version says that Protoboard is set up (prepareStack): that is this window's notice
    if (this.carried && !unpackedCarried(this.home, this.carried)) return;
    const KEY = "protoboard.folderNoticed";
    const told = this.context.workspaceState.get<string[]>(KEY, []);
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
    const notice = folderNotice({ folders, roots, needsSetup: (r) => this.needsSetup(r), told: (k) => told.includes(k) });
    if (notice.kind === "none") return;
    this.noticed = true;
    if (notice.kind === "needs-setup") {
      void this.context.workspaceState.update(KEY, [...told, `setup:${notice.root}`]);
      const init = "Initialize";
      void vscode.window
        .showInformationMessage(`Protoboard: ${basename(notice.root)} is not set up on this machine yet.`, init)
        .then((a) => a === init && this.guard(() => this.setupProject(notice.root)));
      return;
    }
    void this.context.workspaceState.update(KEY, [...told, `empty:${notice.folder}`]);
    const make = "New Project";
    void vscode.window.showInformationMessage("Protoboard: this folder is empty. Start a Protoboard project in it?", make).then((a) => a === make && this.guard(() => this.newProject({ dir: notice.folder })));
  }

  private offerSetup(_root: string) {
    this.giveNotice(this.rootList);
  }

  /**
   * **Protoboard: Initialize Project** (first builds review, D2): set a
   * project up with the Protoboard installed for the user. Its packages
   * become links to that copy (`protoboard stack link`): no npm, no registry,
   * nothing downloaded. When no copy on this machine fits the project, the
   * ways to get one are offered as buttons.
   */
  async setupProject(given?: string): Promise<boolean> {
    const root = given ?? this.current ?? (await this.roots())[0];
    if (!root) throw new Error("there is no Protoboard project in this window to initialize; Protoboard: New Project makes one");
    await this.requireTrust(root);
    if (!this.needsSetup(root)) {
      void vscode.window.setStatusBarMessage(`$(check) ${basename(root)} is set up`, 4000);
      return true;
    }
    const cli = this.trustedCli(root);
    if (!canRun(cli)) throw new Error(`${basename(root)} cannot be set up from here: this build of the extension carries no stack, and no Protoboard is installed for your user. Install the Protoboard extension from the downloads site (it carries everything it needs), or set protoboard.cliPath`);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: setting up ${basename(root)}` }, () =>
      runCli(cli, ["stack", "link", "--format", "json"], { cwd: root, onStderr: (l) => this.log.info(`[setup ${basename(root)}] ${l}`) }),
    );
    let out: { linked: string[]; installed: string[]; notInStack?: string[]; version: string; stack: string };
    try {
      out = parseJsonOutput(r, "protoboard stack link");
    } catch (e) {
      // no copy on this machine fits the project: the ways to get one, as buttons
      const message = (e as Error).message.replace(/^protoboard stack link: /, "").split(" (`protoboard stack`")[0]!;
      this.log.warn(`${basename(root)} was not set up: ${(e as Error).message}`);
      // a project made by an earlier line (0.1 with this 0.2 extension): updating it is what sets it up, not another stack
      const line = this.earlierLine(cli);
      if (line && this.carried) {
        const update = `Update Project to Protoboard ${line}`;
        const a = await vscode.window.showWarningMessage(
          `Protoboard: ${basename(root)} was made with Protoboard ${cli.unsatisfied}, and this extension carries ${this.carried.version}. ${update} moves it to ${line} and sets it up (package.json, its links, AGENTS.md and its parts' layout); or add the stack it asks for from that version's .vsix.`,
          update,
          "Add from a .vsix File…",
          "Show Log",
        );
        if (a === update) await vscode.commands.executeCommand("protoboard.project.upgrade", root);
        else if (a === "Add from a .vsix File…") await vscode.commands.executeCommand("protoboard.stack.fromVsix", undefined, root);
        else if (a) this.log.show();
        this.setupWake.get(root)?.();
        return !this.needsSetup(root);
      }
      const vsix = "Add from a .vsix File…";
      const registry = "Install from a Registry";
      const a = await vscode.window.showWarningMessage(
        `Protoboard: ${basename(root)} could not be set up: ${message}. The version it asks for can come from the .vsix of that version, or from a registry (which needs Node.js with npm and access to it).`,
        vsix,
        registry,
        "Show Log",
      );
      if (a === vsix) await vscode.commands.executeCommand("protoboard.stack.fromVsix", undefined, root);
      else if (a === registry) await vscode.commands.executeCommand("protoboard.stack.install", root);
      else if (a) this.log.show();
      this.setupWake.get(root)?.();
      return !this.needsSetup(root);
    }
    this.cliSaid.delete(root);
    this.log.info(`${basename(root)}: set up. ${out.linked.length} package(s) in its node_modules are links to the Protoboard stack ${out.version} at ${out.stack}${out.installed.length ? `; ${out.installed.length} installed by npm were left as they are` : ""}`);
    if (out.notInStack?.length) void vscode.window.showWarningMessage(`Protoboard: ${basename(root)} is set up; ${out.notInStack.join(", ")} ${out.notInStack.length === 1 ? "is" : "are"} not in Protoboard ${out.version}.`, "Show Log").then((a) => a && this.log.show());
    else void vscode.window.setStatusBarMessage(`$(check) ${basename(root)} is set up`, 5000);
    // the wait in runnable() ends now: the views, the check and the viewer start
    this.setupWake.get(root)?.();
    return true;
  }

  /**
   * **Protoboard: Install a Tool Runtime** (first builds review, item 28: a
   * button, not a command to type): `protoboard tools install <cad|circuit>`
   * for the project, with its progress shown, then a fresh check.
   */
  private async installRuntime(given?: string, givenRoot?: string) {
    const root = await this.project(givenRoot);
    const id =
      given ??
      (
        await vscode.window.showQuickPick(
          [
            { label: "CAD runtime", description: "cad", detail: "Python with build123d, in the project's .protoboard/tools: 3D models, frames, enclosures, harness routes" },
            { label: "Circuit runtime", description: "circuit", detail: "The circuit tools' packages, in the project's .protoboard/tools: boards and schematics" },
            { label: "Both", description: "all" },
          ],
          { title: `Install a tool runtime for ${basename(root)}`, placeHolder: "Which runtime" },
        )
      )?.description;
    if (!id) return;
    const name = id === "cad" ? "CAD runtime" : id === "circuit" ? "circuit runtime" : "tool runtimes";
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: installing the ${name} for ${basename(root)}`, cancellable: true }, (progress, cancel) => {
      const ctl = new AbortController();
      cancel.onCancellationRequested(() => ctl.abort());
      return runCli(this.trustedCli(root), ["tools", "install", id, "--format", "json"], {
        cwd: root,
        signal: ctl.signal,
        onStderr: (l) => {
          this.log.info(`[tools ${basename(root)}] ${l}`);
          progress.report({ message: l.slice(0, 90) });
        },
      });
    });
    const out = parseJsonOutput<{ id: string; status: string; dir: string; message?: string }[]>(r, "protoboard tools install");
    const failed = out.filter((x) => x.status !== "installed");
    for (const x of failed) this.log.error(`the ${x.id} runtime was not installed: ${x.message ?? "no reason given"}`);
    if (failed.length) {
      const again = "Try Again";
      void vscode.window
        .showErrorMessage(`Protoboard: the ${failed.map((x) => x.id).join(" and ")} runtime was not installed: ${withoutRunHint(failed[0]!.message ?? "see the log").split("\n")[0]}`, again, "Show Log")
        .then((a) => (a === again ? vscode.commands.executeCommand("protoboard.tools.install", id, root) : a && this.log.show()));
    } else void vscode.window.showInformationMessage(`Protoboard: the ${name} ${out.length === 1 ? "is" : "are"} installed for ${basename(root)} (${out.map((x) => x.dir).join(", ")}).`);
    void this.check(root, { silent: true });
  }

  /**
   * PB-946 and QA B3 (2026-10-21): the Protoboard Inspector comes to the front of the secondary side bar when a
   * window opens on a project, once a session, keeping the keyboard focus where it was, unless the user put
   * another view in front of it (an agent's chat) or closed its side bar while using the window: that choice
   * stays, until the Inspector is shown again. Before, it came once per workspace: VS Code then restored Chat in
   * front, or a blank "Protoboard Inspector" pane, after a restart.
   */
  private revealedThisSession = false;
  private ourReveal = 0;
  private async revealInspector() {
    const KEY = "protoboard.inspector.shownOnce";
    if (this.revealedThisSession) return;
    if (this.context.workspaceState.get<boolean>(KEY) && this.context.workspaceState.get<boolean>(INSPECTOR_AWAY)) {
      this.log.info("the Protoboard Inspector stays behind the view you put in front of it last time (it comes back when you show it)");
      return;
    }
    this.revealedThisSession = true;
    this.ourReveal = Date.now();
    await this.context.workspaceState.update(KEY, true);
    // VS Code before 1.107 moves the focus with the view whatever is asked: only there is it given back, to the
    // editor (the one place it can be sent). From 1.107 `preserveFocus` holds, and the focus is left alone: a
    // person typing in a terminal or an agent's chat when a project appears keeps typing there.
    const giveBack = vscodeBefore(vscode.version, 107) && vscode.window.tabGroups.activeTabGroup.activeTab !== undefined;
    try {
      await vscode.commands.executeCommand(`${InspectorViewProvider.id}.focus`, { preserveFocus: true });
      this.log.info("the Protoboard Inspector was brought to the front of the secondary side bar (once a session; a view you put in front of it stays there)");
    } catch (e) {
      this.log.warn(`could not show the Protoboard Inspector: ${(e as Error).message}`);
      return;
    }
    if (giveBack) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  }

  /** What the integration test reads of the window (PB-931, PB-946). */
  windowState() {
    return { current: this.current, waiting: [...this.waiting], inspectorVisible: this.inspector.visible, drcVisible: this.drc.visible, inspectorShownOnce: !!this.context.workspaceState.get<boolean>("protoboard.inspector.shownOnce") };
  }

  /** On activation: show the current project's last build at once, then check it again. */
  private async start() {
    const roots = await this.roots();
    if (roots.length) {
      this.current = chooseProject(roots, vscode.window.activeTextEditor?.document.uri.fsPath, this.lastUsed) ?? roots[0];
      this.multipleRoots = roots.length > 1;
    }
    await this.setProjectContext(roots);
    this.account.show();
    if (!roots.length) {
      this.log.info("no protoboard.config.ts in this window's folders: the Protoboard views offer a new project, and the extension starts when one appears");
      this.showCurrent();
      // an empty folder is offered a project, once; any other folder is left alone
      this.giveNotice(roots);
      // no project (every window, since the extension starts with VS Code): the account is still asked, for the
      // status bar and New Project. A signed-in person's window takes the service's last answer while it is recent
      // and sends no request of its own; anything else (signed out, a service never asked, which may be one that
      // signs no one in) is asked once
      this.accountAsked = this.refreshAccount(false);
      void this.accountAsked.then((a) => (a.state === "signed-in" && !this.lock.locked ? a : this.refreshAccount(true)));
      return;
    }
    const current = this.current!;
    // agents (PB-930): once, the offer to connect the ones found here (signed in or not: the agents' tools are local work)
    setTimeout(() => !this.disposed && void this.guard(() => this.settings.offer()), 5000);
    // the project's last build at once: the views are there before the first check finishes
    if (!this.needsSetup(current)) {
      const build = readBuild(current);
      if (build) this.applyBuild(current, build);
    }
    this.showCurrent();
    // the project starts at once: nothing of it waits for the account (PB-928)
    if (!this.startedProjects) void this.arrive(current, false);
    // the account, for the status bar and the Library: the service's last answer while it is recent (no request),
    // then the service is asked in the background. The account is the user's: a project that is not set up, or
    // whose configuration does not load, does not change which service is asked (first builds review, item 23)
    this.accountAsked = this.refreshAccount(false);
    void this.accountAsked.then(() => this.refreshAccount(true));
  }

  /**
   * PB-897: the first time a project is opened in this workspace, its viewer
   * opens at the top-level system. After that VS Code restores whatever tabs
   * were open (a closed viewer stays closed). A project that appears later
   * (an agent's `protoboard init`) gets the same once its first build lands.
   */
  private async openOnFirstVisit(root: string) {
    const key = "protoboard.viewer.opened";
    const opened = this.context.workspaceState.get<string[]>(key, []);
    if (opened.includes(root)) return;
    if (!vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root)).get<boolean>("viewer.openOnFirstVisit", true)) return;
    if (this.viewers.of(root).length) return void this.context.workspaceState.update(key, [...opened, root]);
    await this.context.workspaceState.update(key, [...opened, root]);
    await this.openViewer({ root, path: "", preserveFocus: true }).catch((e: Error) => this.log.warn(`opening the viewer of ${basename(root)}: ${e.message}`));
  }

  /** A project that becomes current is checked once, so its views and the status bar are current (`protoboard.check.onOpen`). */
  private checkOnOpen(root: string) {
    if (this.results.has(root) || this.checking.has(root) || this.failed.has(root)) return;
    if (!vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root)).get<boolean>("check.onOpen", true)) return;
    void this.check(root, { silent: true });
  }

  /** What the CLI says on stderr while it works: into the log. A project it linked to the user's stack is read again. */
  private cliSays(root: string, line: string) {
    this.log.info(`[cli ${basename(root)}] ${line}`);
    if (/are links to the Protoboard stack/.test(line)) this.cliSaid.delete(root);
  }

  /**
   * A command's failure: logged, and shown once. Where the CLI's message
   * tells the user to run a command the extension can run itself, the
   * notification offers it as a button instead (first builds review, item
   * 28): a missing tool runtime, and, when npm was refused by the registry
   * (item 26), the set-up that needs no npm.
   */
  private async guard(fn: () => unknown) {
    try {
      return await fn();
    } catch (e) {
      const message = (e as Error).message;
      if (message === "cancelled") return;
      this.log.error(message);
      const runtime = toolsInstallHint(message);
      const install = runtime ? `Install the ${runtime === "cad" ? "CAD Runtime" : runtime === "circuit" ? "Circuit Runtime" : "Tool Runtimes"}` : undefined;
      const refused = registryRefusal(message) ?? (npmAuthProblem(message) ? { text: message } : undefined);
      const renew = refused?.renew ? "Renew Registry Pass" : undefined;
      const noNpm = refused && this.current && this.needsSetup(this.current) ? "Initialize Without npm" : undefined;
      void vscode.window.showErrorMessage(`Protoboard: ${refused ? refused.text : runtime ? withoutRunHint(message) : message}`, ...(install ? [install] : []), ...(renew ? [renew] : []), ...(noNpm ? [noNpm] : []), "Show Log").then((a) => {
        if (a === install) return vscode.commands.executeCommand("protoboard.tools.install", runtime);
        if (a === noNpm) return vscode.commands.executeCommand("protoboard.setupProject");
        if (a === renew) {
          // the registry's own sign-in (a Google account): in a terminal, where the person sees what it asks
          const t = vscode.window.createTerminal({ name: "Protoboard: Registry Pass", iconPath: new vscode.ThemeIcon("key") });
          t.show();
          return void t.sendText(refused!.renew!);
        }
        if (a) this.log.show();
      });
    }
  }

  // ---- projects

  roots(): Promise<string[]> {
    this.known ??= Promise.resolve(vscode.workspace.findFiles("**/protoboard.config.ts", "**/{node_modules,.git,.protoboard}/**", 500)).then((uris) =>
      // a search index can still name a folder that was just moved or deleted (B5)
      projectRoots(uris.map((u) => ({ file: u.fsPath, folder: vscode.workspace.getWorkspaceFolder(u)?.uri.fsPath ?? "" }))).filter((r) => existsSync(join(r, "protoboard.config.ts"))),
    );
    return this.known!;
  }

  private refreshRoots() {
    const before = this.known;
    this.known = undefined;
    void this.updateStatus();
    void this.roots().then(async (roots) => {
      const had = before ? await before.catch(() => [] as string[]) : roots;
      // a project folder that is gone hides the DRC view (its `when`), and the panel would fall back on the terminal,
      // whose new shell cannot start in the folder that is gone (B5): the panel is closed first
      const gone = [...new Set([...had, ...this.data.keys(), ...this.sessions.keys()])].filter((r) => !roots.includes(r) && !existsSync(join(r, "protoboard.config.ts")));
      if (gone.length && !roots.length && this.drc.visible) await vscode.commands.executeCommand("workbench.action.closePanel");
      await this.setProjectContext(roots);
      if (this.current && !roots.includes(this.current)) this.current = undefined;
      this.multipleRoots = roots.length > 1;
      if (!this.current && roots.length) {
        this.current = chooseProject(roots, vscode.window.activeTextEditor?.document.uri.fsPath, this.lastUsed) ?? roots[0];
        const build = readBuild(this.current);
        if (build) this.applyBuild(this.current, build);
        this.startedProjects = true;
        // a project that was there already is checked now; one that just appeared starts in arrive(), below
        if (had.includes(this.current)) this.checkOnOpen(this.current);
      }
      // tabs of a project whose folder went while the window was open close too: focused, one would bring it back as the current project
      for (const e of [...this.viewers.editors]) if (!existsSync(join(e.root, "protoboard.config.ts"))) e.panel.dispose();
      // and what the extension holds for it goes (B5): its findings in Problems (and so the status bar's counts), its dev server
      for (const r of gone) this.forget(r);
      this.showCurrent();
      this.lensChanged.fire();
      // a project that appeared in the workspace (an agent's `protoboard init`, PB-931): it starts as on a window
      // opened on it, with no reload: the views, the Inspector, the check, its viewer tab and dev server
      // Several appearing at once are a checkout or a copy, not someone starting a project: only the current one
      // starts (a viewer tab and a dev server for each would fill the ports); the others start when they are opened.
      const appeared = roots.filter((r) => !had.includes(r));
      for (const r of appeared) if (appeared.length === 1 || r === this.current) void this.arrive(r, true);
      if (appeared.length > 1) this.log.info(`${appeared.length} projects appeared in the workspace at once; they start when opened`);
    });
  }

  /**
   * A project whose folder is gone (moved, trashed, deleted; B5): its
   * findings leave the Problems panel, its check stops, and its dev server is
   * stopped before its next build fails on a working folder that is not there.
   */
  private forget(root: string) {
    this.log.info(`${basename(root)}: the project's folder is gone (moved or deleted): its findings are cleared and its dev server is stopped`);
    this.goneRoots.add(root);
    for (const f of this.results.get(root)?.files ?? []) this.diagnostics.delete(vscode.Uri.file(f));
    // what is left under the folder (a finding with no file of its own)
    this.diagnostics.forEach((uri) => {
      if (uri.fsPath === root || uri.fsPath.startsWith(root + sep)) this.diagnostics.delete(uri);
    });
    this.results.delete(root);
    this.data.delete(root);
    this.failed.delete(root);
    this.checking.get(root)?.abort();
    this.checking.delete(root);
    this.setupWake.get(root)?.();
    const s = this.sessions.get(root);
    if (s) {
      s.monitor?.dispose();
      s.monitor = undefined;
      if (s.process?.running) void s.process.stop(3000);
      this.sessions.delete(root);
    }
  }

  /**
   * The projects' folders are looked at every few seconds (B5): a folder
   * renamed or moved away (as Move to Trash does) fires no event for the
   * `protoboard.config.ts` watcher, so the window would keep its tabs, views
   * and findings. A folder that comes back (restored from the Trash, moved
   * back, checked out again) is looked for too: the watcher of a folder that
   * was renamed away sees nothing when it returns, so the project would stay
   * unknown until a reload (UI QA phase 2).
   */
  private watchFoldersGone() {
    const t = setInterval(() => {
      if (this.disposed) return;
      const back = [...this.goneRoots].filter((r) => existsSync(join(r, "protoboard.config.ts")));
      if (back.length) {
        for (const r of back) this.goneRoots.delete(r);
        this.log.info(`${back.map((r) => basename(r)).join(", ")}: the project's folder is back: it is read again`);
        return this.refreshRoots();
      }
      const held = new Set([...this.rootList, ...this.data.keys(), ...this.sessions.keys(), ...[...this.viewers.editors].map((e) => e.root)]);
      for (const r of held) if (!existsSync(join(r, "protoboard.config.ts"))) return this.refreshRoots();
    }, 2000);
    this.context.subscriptions.push({ dispose: () => clearInterval(t) });
  }

  private get lastUsed(): string | undefined {
    return this.context.workspaceState.get<string>("protoboard.lastProject");
  }

  /** The project a command is about: given, implied by the active editor or the workspace, or picked. */
  private async project(given?: string): Promise<string> {
    if (given) {
      await this.requireTrust(given);
      return given;
    }
    const roots = await this.roots();
    if (!roots.length) throw new Error("there is no Protoboard project in this window (no protoboard.config.ts): open a project's folder, or make one with Protoboard: New Project");
    let root = chooseProject(roots, vscode.window.activeTextEditor?.document.uri.fsPath, this.lastUsed);
    if (!root) {
      const picked = await vscode.window.showQuickPick(
        roots.map((r) => ({ label: basename(r), description: vscode.workspace.asRelativePath(r), root: r })),
        { placeHolder: "Protoboard project" },
      );
      if (!picked) throw new Error("cancelled");
      root = picked.root;
    }
    await this.context.workspaceState.update("protoboard.lastProject", root);
    await this.requireTrust(root);
    return root;
  }

  /**
   * What the CLI of a folder is resolved from (PB-929): the settings, the
   * runtime, the stack copies and the stack this extension carries. The
   * settings page reads the same for the launcher an agent starts (PB-930),
   * with the runtime's file: the system's Node.js, or VS Code's own run as
   * Node on a machine that has none of 22 or later (`electron`).
   */
  private cliSettings(root: string): CliSettings & { nodeFile?: string; electron?: boolean } {
    const config = vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root));
    const configured = config.get<string>("nodePath");
    const runtime = this.runtime(configured);
    const node = resolveNode(configured);
    const manifest = this.carried;
    const nodeFile = runtime.from === "vscode" ? runtime.command : (node.path ?? (node.from === "setting" ? node.command : undefined));
    return {
      cliPath: config.get<string>("cliPath"),
      nodePath: runtime.command,
      runtime,
      stacks: listStacks(this.home),
      ...(manifest ? { carried: { version: manifest.version, dir: stackDir(this.home, manifest.version), prepare: () => this.prepareStack() } } : {}),
      ...(nodeFile ? { nodeFile } : {}),
      ...(runtime.from === "vscode" && runtime.env?.ELECTRON_RUN_AS_NODE ? { electron: true } : {}),
    };
  }

  /** What the settings page links to besides its own sections (PB-930): what the other parts of the extension offer in this window. */
  private settingsLinks(): SettingsLink[] {
    const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
    const manifest = this.carried;
    return [
      { id: "start", label: "First steps", note: "New project, viewer, sign-in, terminal", icon: "map", action: "Open", command: "workbench.action.openWalkthrough", args: [`${this.context.extension.id}#protoboard.start`, false] },
      { id: "createProject", label: "A new project", note: "Blank or from a template", icon: "folder-plus", action: "Create", command: "protoboard.newProject" },
      ...(this.current && this.needsSetup(this.current) ? [{ id: "setupProject", label: `Set up ${basename(this.current)}`, note: "Not set up on this machine yet", icon: "rocket", action: "Initialize", command: "protoboard.setupProject" }] : []),
      ...(this.current && !this.needsSetup(this.current) ? [{ id: "runtimes", label: "Tool runtimes", note: `${basename(this.current)}: CAD and circuit runtimes`, icon: "wrench", action: "Install…", command: "protoboard.tools.install" }] : []),
      ...(this.current ? [{ id: "bom", label: "Bill of materials", note: `${basename(this.current)}: parts and chosen offers, in USD`, icon: "table", action: "Open", command: "protoboard.openBom" }] : []),
      ...(manifest
        ? [
            { id: "stack", label: `Protoboard ${manifest.version}, installed for your user`, note: tilde(stackDir(this.home, manifest.version)), icon: "package", action: "Show Folder", command: "protoboard.stack.show" },
            { id: "path", label: "The protoboard command outside VS Code", note: `For terminals outside VS Code (${tilde(join(this.home, "bin"))})`, icon: "terminal", action: "Add to PATH", command: "protoboard.path.add" },
          ]
        : []),
      { id: "account", label: "Check the account again", note: "Check the service again", icon: "refresh-cw", action: "Check", command: "protoboard.account.check" },
    ];
  }

  private cli(root: string): CliCommand {
    const config = vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root));
    const runtime = this.runtime(config.get<string>("nodePath"));
    if (this.cliForTest) return { command: runtime.command, args: [this.cliForTest], from: "setting", ...(runtime.env ? { env: runtime.env } : {}) };
    // the agreed order (PB-929): the project's own, the setting, a copy matching the project's pin, the carried stack
    const cli = resolveCli(root, this.cliSettings(root));
    // once per project and choice: which CLI every command of this project runs, why that one, and on which Node.js
    const said = `${runtime.command}|${cli.from}|${cli.args.join(" ")}|${cli.unsatisfied ?? ""}`;
    if (this.cliSaid.get(root) !== said) {
      this.cliSaid.set(root, said);
      this.log.info(`${root === homedir() ? "outside a project" : basename(root)}: the CLI is ${describeCli(cli)}. It runs with ${describeRuntime(runtime)}`);
      if (root !== homedir()) this.stackNotices(root, cli);
    }
    // a project written for the packages' former npm scope (PB-941): say so once, whether or not another CLI then runs
    if (cli.formerScope && !this.formerScopeWarned.has(root)) {
      this.formerScopeWarned.add(root);
      void vscode.window.showWarningMessage(`Protoboard: ${SCOPE_RENAMED_MESSAGE}.`);
    }
    return cli;
  }
  private readonly formerScopeWarned = new Set<string>();
  private readonly cliSaid = new Map<string, string>();

  /**
   * What a person should know about the stack a project uses, once per
   * project and window (PB-929): it pins a version the carried stack is not,
   * or it is linked to an older copy than this extension carries.
   */
  /** The carried stack's line (`0.2`) when the project was made by an earlier one (its range asks for an older version), else undefined. */
  private earlierLine(cli: CliCommand): string | undefined {
    const manifest = this.carried;
    const asked = cli.unsatisfied?.replace(/^[^\d]*/, "");
    if (cli.unsatisfied && manifest && asked && /^\d+\.\d+\.\d+/.test(asked) && compareVersions(asked, manifest.version) < 0) return manifest.version.split(".").slice(0, 2).join(".");
    return undefined;
  }

  private stackNotices(root: string, cli: CliCommand) {
    const manifest = this.carried;
    // a project made by an earlier line (its range's version is older than the carried stack): offer to update it
    const line = this.earlierLine(cli);
    if (line && manifest) {
      const update = `Update Project to Protoboard ${line}`;
      void vscode.window
        .showWarningMessage(
          `Protoboard: ${basename(root)} was made with Protoboard ${cli.unsatisfied}, and this extension carries ${manifest.version}. It runs with ${manifest.version} for now. ${update} moves it (package.json, its links, AGENTS.md and its parts' layout); or add the stack it asks for from that version's .vsix.`,
          update,
          "Add from a .vsix File…",
          "Show Log",
        )
        .then((a) => (a === update ? vscode.commands.executeCommand("protoboard.project.upgrade", root) : a === "Add from a .vsix File…" ? vscode.commands.executeCommand("protoboard.stack.fromVsix", undefined, root) : a === "Show Log" ? this.log.show() : undefined));
      return;
    }
    if (cli.unsatisfied && manifest) {
      void vscode.window
        .showWarningMessage(
          `Protoboard: ${basename(root)} asks for the stack ${cli.unsatisfied}, and this extension carries ${manifest.version}. It runs with ${manifest.version} for now. The version it asks for can come from the .vsix of that version, or from a registry (which needs Node.js with npm and access to it).`,
          "Add from a .vsix File…",
          "Install from a Registry",
          "Show Log",
        )
        .then((a) => (a === "Add from a .vsix File…" ? vscode.commands.executeCommand("protoboard.stack.fromVsix", undefined, root) : a === "Install from a Registry" ? vscode.commands.executeCommand("protoboard.stack.install", root) : a === "Show Log" ? this.log.show() : undefined));
      return;
    }
    const link = cli.from === "project" && cli.stack ? readLinkRecord(root) : undefined;
    if (link && manifest && compareVersions(link.version, manifest.version) < 0) {
      this.log.info(`${basename(root)} is linked to the stack ${link.version}; this extension carries ${manifest.version}. It keeps working as it is; Protoboard: Update Project to the Stack This Extension Carries moves it.`);
      void vscode.window
        .showInformationMessage(`Protoboard: ${basename(root)} uses stack ${link.version} (the extension has ${manifest.version}).`, "Update Project", "Not Now")
        .then((a) => (a === "Update Project" ? vscode.commands.executeCommand("protoboard.stack.update", root) : undefined));
    }
  }

  // ---- Protoboard Cloud account (PB-911): the CLI's sign-in, shown and changed through the CLI

  /** The account problem last written to the log, so a refresh that finds the same one says nothing. */
  private accountProblemLogged: string | undefined;

  private showAccount() {
    // the status bar says the state in a few words; what went wrong is said here, once per change
    const a = this.accountState;
    const problem = a.state === "unreachable" || a.state === "expired" ? `${a.service}: ${a.problem}` : a.state === "unknown" ? a.reason : undefined;
    if (problem && problem !== this.accountProblemLogged) this.log.warn(`account (${a.state}): ${problem}`);
    this.accountProblemLogged = problem;
    const item = accountItem(this.accountState);
    this.account.text = item.text;
    this.account.tooltip = item.tooltip;
    this.account.accessibilityInformation = { label: item.tooltip };
    void vscode.commands.executeCommand("setContext", "protoboard.signedIn", this.accountState.state === "signed-in");
  }

  /**
   * Ask the CLI who is signed in to the project's Protoboard library, and
   * whether the account may use Protoboard (`whoami`; PB-928). Without a
   * project it is the hosted library's account, asked through whatever CLI
   * this window can run (PB-931: Create Project asks before a template's
   * parts are fetched). `fresh` asks the service even when its last answer is
   * recent (`--check`): after a sign-in, or Check Again.
   */
  private accountQuestion = 0;
  async refreshAccount(fresh = true): Promise<AccountState> {
    const root = this.current;
    this.accountChecked = Date.now();
    const asked = ++this.accountQuestion;
    let next: AccountState;
    try {
      // The sign-in is the user's, not the project's (first builds review, item 23): a project that is not set up,
      // or whose packages are not there, is asked about with whatever CLI this window can run. The CLI then names
      // the service from the project's file as text, or the one this machine is signed in to; never localhost
      // because a project did not load.
      const cli = root && this.cliReady(root) ? this.cli(root) : this.cliOutside();
      next = accountFromWhoAmI(await runCli(cli, ["whoami", ...(fresh ? ["--check"] : []), "--format", "json"], { cwd: root ?? homedir(), env: this.library.cliEnv() }));
    } catch (e) {
      next = { state: "unknown", reason: (e as Error).message };
    }
    // an answer to an older question that comes after a newer one is stale: the newer one's stands
    if (asked !== this.accountQuestion) return this.accountState;
    const was = this.accountState;
    this.accountState = next;
    this.showAccount();
    this.applyLock();
    this.showCloud();
    this.library.accountChanged();
    this.settings.accountChanged();
    // the first sign-in is the other occasion for the offer to connect agents (shown once in all)
    if (was.state !== "signed-in" && next.state === "signed-in") void this.guard(() => this.settings.offer());
    // a new sign-in (or a sign-out) changes what the Library may download; signed out it shows its sign-in card instead
    if (was.state !== "unknown" && (was.state === "signed-in") !== (next.state === "signed-in") && !this.lock.locked) void this.library.reload();
    return next;
  }

  /** The status bar item: sign in, or the signed-in account's actions. */
  private async accountActions() {
    if (this.accountState.state === "open") {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(refresh) Check Again", detail: "Check the service again", id: "check" },
          { label: "$(cloud) Show the Cloud View", id: "cloud" },
        ],
        { title: "Protoboard Cloud: no account needed", placeHolder: this.accountState.service },
      );
      if (pick?.id === "check") await this.refreshAccount();
      else if (pick?.id === "cloud") await vscode.commands.executeCommand("protoboard.cloud.focus");
      return;
    }
    if (this.accountState.state !== "signed-in") {
      if (this.lock.locked && this.lock.reason === "not-invited") {
        const pick = await vscode.window.showQuickPick(
          [
            { label: "$(sign-in) Use Another Account", id: "in" },
            { label: "$(sign-out) Sign Out", id: "out" },
            { label: "$(refresh) Check Again", detail: "After you were invited", id: "check" },
          ],
          { title: "Protoboard: this account is not invited yet", placeHolder: this.lock.message },
        );
        if (pick?.id === "in") await this.signIn();
        else if (pick?.id === "out") await this.signOut();
        else if (pick?.id === "check") await this.refreshAccount(true);
        return;
      }
      return this.signIn();
    }
    const a = this.accountState;
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(sign-out) Sign Out", detail: `Forget the sign-in to ${a.service}`, id: "out" },
        { label: "$(refresh) Check Again", detail: "Check the service again", id: "check" },
        { label: "$(cloud) Show the Cloud View", id: "cloud" },
        { label: "$(settings-gear) Open Protoboard Settings", detail: "Account, version and agents", id: "settings" },
      ],
      { title: `Protoboard Cloud: ${a.email ?? a.uid ?? "signed in"}`, placeHolder: a.service },
    );
    if (pick?.id === "out") await this.signOut();
    else if (pick?.id === "check") await this.refreshAccount();
    else if (pick?.id === "cloud") await vscode.commands.executeCommand("protoboard.cloud.focus");
    else if (pick?.id === "settings") this.settings.open();
  }

  /**
   * Sign in with the CLI's `protoboard login`, in a terminal: it opens the
   * browser (or shows a device code where there is none), and the person sees
   * what it asks. The state refreshes while it runs and when it closes.
   */
  async signIn(device = false) {
    if (this.accountState.state === "open") return void vscode.window.showInformationMessage(`${this.accountState.service} signs no one in: everything there is open, with no account.`);
    // before there is a project, the sign-in is for the hosted Protoboard library (what a new project uses). The
    // sign-in is the user's, not a project's: a project whose packages are not installed yet (PB-931) signs in
    // through whatever CLI this window can run
    const root = this.current ?? (await this.roots())[0];
    if (this.signInTerminal) return this.signInTerminal.show();
    const found = root && !this.waiting.has(root) && this.cliReady(root) ? this.cli(root) : this.cliOutside();
    // a remote window (SSH, WSL, a container) has no browser of its own: the code, approved on any device
    const byCode = device || !!vscode.env.remoteName;
    const args = ["login", ...(byCode ? ["--device"] : [])];
    const cwd = root ?? this.baseFolder();
    if (!canRun(found)) {
      // no CLI this window can run (a build of the extension that carries no stack, and nothing installed): the
      // CLI of this version through npm, typed into a shell
      const line = npxCommand(String(this.context.extension.packageJSON.version), args);
      const t = vscode.window.createTerminal({ name: "Protoboard: Sign In", cwd, env: this.library.cliEnv() as Record<string, string>, iconPath: new vscode.ThemeIcon("account") });
      this.signInTerminal = t;
      this.log.info(`sign-in: no CLI found in this window; running ${line} in a terminal`);
      t.show();
      t.sendText(line);
      return this.watchSignIn(t);
    }
    const cli = found;
    await cli.prepare?.();
    // The terminal runs the login itself, not a shell: nothing is quoted for PowerShell, cmd or fish, and what
    // the CLI needs in its environment (ELECTRON_RUN_AS_NODE, when VS Code's runtime runs it) is given to that one
    // process, not to a shell someone types into afterwards. VS Code closes the terminal when the login succeeds
    // and keeps it, with the exit code, when it fails. A .cmd or .bat (protoboard.cliPath) needs a shell.
    const direct = !/\.(cmd|bat)$/i.test(cli.command);
    const env = { ...(this.library.cliEnv() as Record<string, string>), ...(direct ? (cli.env ?? {}) : {}) };
    const t = vscode.window.createTerminal({ name: "Protoboard: Sign In", cwd, env, iconPath: new vscode.ThemeIcon("account"), ...(direct ? { shellPath: cli.command, shellArgs: [...cli.args, ...args] } : {}) });
    this.signInTerminal = t;
    this.log.info(`sign-in: running ${terminalCommand(cli, args)} in a terminal`);
    t.show();
    if (!direct) t.sendText(terminalCommand(cli, args));
    this.watchSignIn(t);
  }

  /** Notice the sign-in as soon as it is saved, while its terminal is there. */
  private watchSignIn(t: vscode.Terminal) {
    const until = Date.now() + 10 * 60_000;
    const poll = async () => {
      if (this.signInTerminal !== t || Date.now() > until || this.disposed) return;
      if ((await this.refreshAccount()).state === "signed-in") return void vscode.window.setStatusBarMessage(this.lock.locked ? "$(account) Signed in; this account is not invited to the Protoboard library yet" : "$(account) Signed in to Protoboard", 4000);
      setTimeout(() => void poll(), 3000);
    };
    setTimeout(() => void poll(), 3000);
  }

  async signOut() {
    const root = this.current ?? (await this.roots())[0];
    const r = await runCli(root && this.cliReady(root) ? this.cli(root) : this.cliOutside(), ["logout", "--format", "json"], { cwd: root ?? homedir(), env: this.library.cliEnv() });
    if (r.code !== 0) throw new Error(`protoboard logout failed: ${(r.stderr || r.stdout).trim()}`);
    await this.refreshAccount();
  }

  // ---- check → Problems, Explorer, DRC

  /**
   * Check the project: `protoboard build` runs every validator (as `protoboard
   * check` does) and writes `.protoboard/build/resolved.json` and the UHD
   * bundle, so one run feeds the Problems panel, the DRC view and the
   * Explorer.
   */
  async check(given?: string, options: { reveal?: boolean; silent?: boolean } = {}) {
    // a check that runs by itself (on open, on save) of a project whose code may not run: nothing, said once (PB-1048)
    if (given && options.silent && !(await this.trust.ensure(given))) return this.untrustedNotice(given);
    const root = await this.project(given);
    this.checking.get(root)?.abort();
    const ctl = new AbortController();
    this.checking.set(root, ctl);
    this.failed.delete(root);
    void this.updateStatus(root, true);
    this.showCurrent();
    const run = async () => {
      const t0 = Date.now();
      const r = await runCli(this.trustedCli(root), ["build", "--format", "json"], { cwd: root, signal: ctl.signal, onStderr: (l) => this.cliSays(root, l) });
      parseJsonOutput(r, "protoboard build");
      const build = readBuild(root);
      if (!build) throw new Error(`protoboard build did not write ${RESOLVED_FILE} (is the CLI older than this extension?)`);
      return { build, ms: Date.now() - t0 };
    };
    try {
      const { build, ms } = options.silent
        ? await run()
        : await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Protoboard: checking ${basename(root)}` }, run);
      if (ctl.signal.aborted || this.disposed) return;
      const counts = this.applyBuild(root, build);
      this.log.info(`check ${basename(root)}: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info in ${(ms / 1000).toFixed(1)} s`);
      for (const s of this.results.get(root)?.skipped ?? []) this.log.info(`  skipped ${s}`);
      if (options.reveal && counts.error + counts.warning > 0) void vscode.commands.executeCommand("workbench.actions.view.problems");
    } catch (e) {
      if (ctl.signal.aborted || (e as Error).name === "AbortError") return;
      this.failed.add(root);
      if (options.silent) this.log.error(`check ${basename(root)}: ${(e as Error).message}`);
      else throw e;
    } finally {
      if (this.checking.get(root) === ctl) this.checking.delete(root);
      void this.updateStatus(root);
      this.showCurrent();
    }
  }

  /** A build's findings into the Problems panel, and its model into the Explorer and the DRC view. */
  private applyBuild(root: string, build: BuildOutput): Counts {
    const out = parseCheck(build.resolved);
    const mapped = mapDiagnostics(root, out, lineReader());
    const previous = this.results.get(root);
    for (const f of previous?.files ?? []) if (!mapped.has(f)) this.diagnostics.delete(vscode.Uri.file(f));
    for (const [file, list] of mapped) this.diagnostics.set(vscode.Uri.file(file), list.map(toDiagnostic));
    const counts = countDiagnostics(out);
    this.results.set(root, { counts, at: build.at, skipped: skippedChecks(out), files: new Set(mapped.keys()) });
    const index = indexProject(build.resolved, build.bundle);
    const codes = loadCodeReference(root);
    this.data.set(root, { build, index, tree: buildTree(index), findings: findings(index, out.diagnostics, codes), codes });
    if (root === this.current) this.showCurrent();
    // the lenses above the definitions follow the build, and so does the source path in the viewer tabs' headers
    this.lensChanged.fire();
    this.viewers.sourcesChanged(root);
    return counts;
  }

  /** resolved.json changed on disk; a build of our own is applied when it finishes. */
  private buildChanged(uri: vscode.Uri) {
    void this.roots().then((roots) => {
      const root = roots.find((r) => uri.fsPath === join(r, RESOLVED_FILE));
      if (!root || this.checking.has(root)) return;
      clearTimeout(this.buildTimers.get(root));
      this.buildTimers.set(
        root,
        setTimeout(() => {
          if (this.checking.has(root) || this.disposed) return;
          const build = readBuild(root);
          if (build && build.at.getTime() !== this.data.get(root)?.build.at.getTime()) this.applyBuild(root, build);
        }, 300),
      );
    });
  }

  /** The Explorer and the DRC view show the current project. */
  private showCurrent() {
    const root = this.current;
    const data = root ? this.data.get(root) : undefined;
    const running = !!root && this.checking.has(root);
    this.explorer.set(data?.tree ?? []);
    // the parts views ask the project's CLI: not before the project is set up (the Library shows its sign-in card signed out)
    const ready = this.readyProject();
    this.library.setProject(ready);
    this.partsViews.setProject(ready);
    this.drc.show(
      root
        ? {
            project: basename(root),
            state: running ? "running" : this.failed.has(root) ? "failed" : "idle",
            at: data?.build.at,
            findings: data?.findings,
            links: data?.build.resolved.links.length,
            checks: data?.build.resolved.checks,
          }
        : undefined,
    );
    this.showCloud();
  }

  private multipleRoots = false;

  /** The active editor moved to another project: the views follow. */
  private async followEditor(e: vscode.TextEditor | undefined) {
    if (!e || e.document.uri.scheme !== "file") return;
    const roots = await this.roots();
    this.multipleRoots = roots.length > 1;
    const root = projectOf(e.document.uri.fsPath, roots);
    if (!root || root === this.current) return;
    this.current = root;
    if (!this.data.has(root)) {
      const build = readBuild(root);
      if (build) this.applyBuild(root, build);
    }
    this.checkOnOpen(root);
    this.showCurrent();
  }

  private async switchProject() {
    const roots = await this.roots();
    const picked = await vscode.window.showQuickPick(
      roots.map((r) => ({ label: basename(r), description: vscode.workspace.asRelativePath(r), picked: r === this.current, root: r })),
      { placeHolder: "Project for the Explorer and DRC views" },
    );
    if (!picked) return;
    this.current = picked.root;
    this.multipleRoots = roots.length > 1;
    await this.context.workspaceState.update("protoboard.lastProject", picked.root);
    if (!this.data.has(picked.root)) {
      const build = readBuild(picked.root);
      if (build) this.applyBuild(picked.root, build);
    }
    this.checkOnOpen(picked.root);
    this.showCurrent();
  }

  /** Check again on save, for projects checked in this session. */
  private onSave(doc: vscode.TextDocument) {
    if (doc.uri.scheme !== "file") return;
    void this.roots().then((roots) => {
      const root = projectOf(doc.uri.fsPath, roots);
      if (!root || !this.results.has(root) || IGNORED_DIRS.test(relative(root, doc.uri.fsPath))) return;
      if (!vscode.workspace.getConfiguration("protoboard", doc.uri).get<boolean>("check.onSave", true)) return;
      clearTimeout(this.saveTimers.get(root));
      this.saveTimers.set(root, setTimeout(() => void this.check(root, { silent: true }), 400));
    });
  }

  private async updateStatus(root?: string, running = false) {
    const roots = await this.roots();
    if (!roots.length) return this.status.hide();
    const shown = projectOf(vscode.window.activeTextEditor?.document.uri.fsPath, roots) ?? (this.lastUsed && roots.includes(this.lastUsed) ? this.lastUsed : roots[0]);
    if (root && root !== shown) return;
    const result = this.results.get(shown);
    this.status.text = statusText(result?.counts, running || this.checking.has(shown) ? "running" : this.failed.has(shown) ? "failed" : "idle");
    this.status.accessibilityInformation = { label: statusLabel(result?.counts, running || this.checking.has(shown) ? "running" : this.failed.has(shown) ? "failed" : "idle") };
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Protoboard** · ${basename(shown)}\n\n`);
    if (result) md.appendMarkdown(`Checked ${result.at.toLocaleTimeString()}: ${result.counts.error} errors, ${result.counts.warning} warnings, ${result.counts.info} info${result.skipped.length ? ` (${result.skipped.length} validators skipped)` : ""}\n\n`);
    else if (this.failed.has(shown)) md.appendMarkdown("The last check failed: see the Protoboard log.\n\n");
    const dev = this.sessions.get(shown);
    if (dev?.endpoint) md.appendMarkdown(`Dev server: ${dev.endpoint.url} (${dev.process?.running ? "started here" : "attached"})\n\n`);
    md.appendMarkdown("Click to check.\n\n");
    md.appendMarkdown(helpMarkdown());
    md.isTrusted = { enabledCommands: helpCommands() };
    this.status.tooltip = md;
    this.status.show();
  }

  // ---- dev server (the viewer tabs read from it)

  private session(root: string): Session {
    let s = this.sessions.get(root);
    if (!s) this.sessions.set(root, (s = { root }));
    return s;
  }

  /** What a project's viewer tabs read from now, or why they cannot. */
  private devState(root: string): { dev?: DevEndpoint; message?: string; busy?: boolean } {
    const s = this.sessions.get(root);
    if (s?.external) return { dev: s.external };
    return s?.status ?? { message: "Starting the project's dev server…", busy: true };
  }

  /** Start or attach to the project's dev server for its viewer tabs; they follow it when it stops, restarts or moves. */
  async ensureDev(root: string): Promise<void> {
    const s = this.session(root);
    // notice a server that stops or restarts, here or elsewhere
    s.monitor ??= new DevMonitor(() => locateDev(root, s.process?.running ? s.process.url : undefined), s.endpoint, (found) => this.devMoved(s, found)).start();
    if (s.endpoint && s.external && (s.process?.running ?? true)) return;
    if (!s.endpoint) this.setDevStatus(s, { message: "Starting the project's dev server…", busy: true });
    try {
      await this.ensureEndpoint(s);
    } catch (e) {
      this.log.error(`dev server for ${basename(root)}: ${(e as Error).message}`);
      this.setDevStatus(s, { message: `The dev server did not start: ${(e as Error).message}` });
      throw e;
    }
    await this.publish(s);
  }

  /**
   * A viewer tab's Retry (PB-943): ask the server the extension knows whether
   * it still answers, forget it when it does not (a server it started is
   * stopped first), then find or start one and tell every tab again.
   */
  async retryDev(root: string): Promise<void> {
    const s = this.session(root);
    if (s.starting) {
      this.log.info(`retry for ${basename(root)}: the dev server is still starting`);
      await s.starting.catch(() => undefined);
    } else if (s.endpoint) {
      const why = await whyNoDev(s.endpoint.url, { timeoutMs: 4000 });
      if (why) {
        this.log.warn(`retry for ${basename(root)}: the dev server at ${s.endpoint.url} does not answer the extension (${why})${s.process?.running ? "; stopping the one started here and starting another" : ""}`);
        const proc = s.process;
        s.endpoint = undefined;
        s.external = undefined;
        if (proc?.running) await proc.stop();
      } else this.log.info(`retry for ${basename(root)}: the dev server at ${s.endpoint.url} answers the extension; telling the tabs again`);
    }
    await this.ensureDev(root);
    // the tabs hear where it is again even when nothing changed (a tab that missed it, or gave up)
    this.viewers.devChanged(root);
  }

  private setDevStatus(s: Session, status: Session["status"]) {
    s.external = undefined;
    s.status = status;
    this.viewers.devChanged(s.root);
  }

  /** The session's endpoint to the tabs, as a webview reaches it. */
  private async publish(s: Session) {
    const endpoint = s.endpoint;
    if (!endpoint) return this.setDevStatus(s, { message: "The dev server is not running." });
    // a remote window reaches the server through a forwarded port
    const external = (await vscode.env.asExternalUri(vscode.Uri.parse(endpoint.url))).toString(true);
    if (s.endpoint !== endpoint) return;
    s.external = { url: external.endsWith("/") ? external : `${external}/`, session: endpoint.session };
    s.status = undefined;
    const tabs = this.viewers.of(s.root).length;
    this.log.info(`dev server for ${basename(s.root)}: ${tabs} viewer tab${tabs === 1 ? "" : "s"} read${tabs === 1 ? "s" : ""} from ${s.external.url}${s.external.url === endpoint.url ? "" : ` (VS Code's address for ${endpoint.url})`}, session ${endpoint.session || "?"}`);
    this.viewers.devChanged(s.root);
  }

  private ensureEndpoint(s: Session): Promise<DevEndpoint> {
    if (s.endpoint && (s.process?.running ?? true)) return Promise.resolve(s.endpoint);
    s.starting ??= this.startOrAttach(s).finally(() => (s.starting = undefined));
    return s.starting;
  }

  private async startOrAttach(s: Session): Promise<DevEndpoint> {
    const { root } = s;
    const recorded = readDevRecord(root);
    const found = await locateDev(root);
    if (found) {
      s.endpoint = found;
      s.monitor?.set(found);
      this.log.info(`attached to protoboard dev for ${basename(root)} at ${found.url}${found.record ? ` (pid ${found.record.pid}, started ${found.record.startedAt})` : ""}`);
      void this.updateStatus(root);
      return found;
    }
    if (recorded) this.log.info(`${DEV_RECORD} names a dev server at ${recorded.url} (pid ${recorded.pid}) that is gone (${(await whyNoDev(recorded.url)) ?? "it answers with another session"}): starting a new one`);
    const port = vscode.workspace.getConfiguration("protoboard", vscode.Uri.file(root)).get<number | null>("dev.port", null);
    await this.requireTrust(root);
    const cli = this.trustedCli(root);
    await cli.prepare?.();
    this.log.info(`starting protoboard dev in ${root}${port ? ` on port ${port}` : " (port 5180, or the next free one)"}: ${[cli.command, ...cli.args, "dev", "--format", "json"].join(" ")}`);
    // a browser-hosted window reaches the server through its proxy (PB-861)
    const extraArgs = devArgs({ web: vscode.env.uiKind === vscode.UIKind.Web });
    if (extraArgs.length) this.log.info(`browser-hosted VS Code: protoboard dev ${extraArgs.join(" ")}`);
    const t0 = Date.now();
    const proc = new DevProcess({ cli, root, port, extraArgs, onLog: (line) => this.devLog(root, line) });
    s.process = proc;
    this.log.info(`protoboard dev for ${basename(root)}: process ${proc.proc.pid ?? "(not started)"}; the first build comes before it listens`);
    void proc.exited.then(({ code, signal }) => this.devExited(s, proc, code, signal));
    const { url, port: listening } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Protoboard: starting the dev server for ${basename(root)}`, cancellable: true },
      (_p, token) => {
        token.onCancellationRequested(() => void proc.stop());
        return proc.ready;
      },
    );
    const session = await probeDev(url);
    this.log.info(`protoboard dev for ${basename(root)} listens at ${url} (port ${listening}, pid ${proc.proc.pid}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!session) this.log.warn(`protoboard dev for ${basename(root)} says it listens at ${url}, but the extension gets no answer there: ${(await whyNoDev(url)) ?? "now it answers"}`);
    const endpoint = { url, session: session ?? readDevRecord(root)?.session ?? "" };
    if (s.process === proc) {
      s.endpoint = endpoint;
      s.monitor?.set(endpoint);
    }
    void this.updateStatus(root);
    return endpoint;
  }

  private devLog(root: string, line: DevLogLine) {
    const text = `[dev ${basename(root)}] ${line.message}`;
    if (line.level === "error") this.log.error(text);
    else if (line.level === "warn") this.log.warn(text);
    else this.log.info(text);
  }

  private devExited(s: Session, proc: DevProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (s.process !== proc || this.disposed) return;
    s.process = undefined;
    const wasServing = !!s.endpoint && s.endpoint.url === proc.url;
    if (wasServing) s.endpoint = undefined;
    s.monitor?.set(undefined);
    void this.updateStatus(s.root);
    if (proc.stopped) {
      this.log.info(`protoboard dev for ${basename(s.root)} stopped`);
      this.setDevStatus(s, { message: "The dev server was stopped (Protoboard: Stop Dev Server)." });
    } else if (wasServing) {
      this.log.error(`protoboard dev for ${basename(s.root)} exited (${signal ?? `code ${code}`})`);
      this.setDevStatus(s, { message: `The dev server exited (${signal ?? `code ${code}`}); the Protoboard log has its output.` });
    }
  }

  /** The monitor saw the server stop, come back, or restart with a new session or port. */
  private devMoved(s: Session, found: DevEndpoint | undefined) {
    if (this.disposed) return;
    if (found) {
      this.log.info(`protoboard dev for ${basename(s.root)} ${s.endpoint ? "restarted" : "is back"} at ${found.url}; the viewer tabs reload`);
      s.endpoint = found;
      void this.publish(s);
    } else if (!s.process?.running) {
      if (s.endpoint) this.log.warn(`protoboard dev for ${basename(s.root)} at ${s.endpoint.url} stopped`);
      s.endpoint = undefined;
      this.setDevStatus(s, { message: "The dev server stopped. The viewer reloads by itself when it is back.", busy: true });
    }
    void this.updateStatus(s.root);
  }

  async stopDev(given?: string) {
    const running = [...this.sessions.values()].filter((s) => s.process?.running || s.endpoint);
    const root = given ?? (running.length === 1 ? running[0].root : await this.project());
    const s = this.sessions.get(root);
    if (s?.process?.running) {
      await s.process.stop();
      return;
    }
    const record = readDevRecord(root);
    const live = record && (await probeDev(record.url)) === record.session;
    if (!live) {
      void vscode.window.showInformationMessage(`Protoboard: no dev server is running for ${basename(root)}.`);
      return;
    }
    const stop = `Stop process ${record.pid}`;
    const answer = await vscode.window.showWarningMessage(`The dev server for ${basename(root)} at ${record.url} was started outside VS Code (pid ${record.pid}).`, stop);
    if (answer === stop) {
      process.kill(record.pid, "SIGTERM");
      this.log.info(`sent SIGTERM to protoboard dev (pid ${record.pid})`);
    }
  }

  // ---- viewer tabs (PB-895, PB-896, PB-897)

  /**
   * Open a viewer tab: a project (its top-level system), or a module and view
   * of one. The same module and view is the same tab (revealed); `beside`
   * opens it in the next editor group.
   */
  /**
   * The Open Viewer command and a viewer tab's request for a view as its own
   * tab: the library and the BOM have editors of their own in VS Code
   * (PB-912), so those open there; every other view is a viewer tab.
   */
  async openViewOf(arg?: OpenViewerArg): Promise<ViewerEditor | undefined> {
    const view = typeof arg === "object" ? arg.view : undefined;
    if (view === "library") return void (await vscode.commands.executeCommand("protoboard.library.openPage"));
    if (view === "bom") return void (await vscode.commands.executeCommand("protoboard.openBom", await this.project(typeof arg === "object" ? arg.root : undefined)));
    return this.openViewer(arg);
  }

  async openViewer(arg?: OpenViewerArg): Promise<ViewerEditor> {
    const given = typeof arg === "string" ? { root: arg } : arg ?? {};
    const root = await this.project(given.root);
    const target: ViewerTarget = { root, path: given.path ?? "", view: given.view ?? "diagram", ...(given.params ? { params: given.params } : {}) };
    const uri = ViewerEditors.uri(target);
    const existing = [...this.viewers.editors].find((e) => e.document.uri.toString() === uri.toString());
    if (existing) {
      existing.panel.reveal(undefined, given.preserveFocus ?? false);
      // a server that stopped starts again
      void this.ensureDev(root).catch(() => undefined);
      return existing;
    }
    await vscode.commands.executeCommand("vscode.openWith", uri, VIEWER_TYPE, {
      viewColumn: given.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      preserveFocus: given.preserveFocus ?? false,
      preview: false,
    });
    const t0 = Date.now();
    for (;;) {
      const editor = [...this.viewers.editors].find((e) => e.document.uri.toString() === uri.toString());
      if (editor) return editor;
      if (Date.now() - t0 > 10_000) throw new Error(`the viewer tab for ${target.path || basename(root)} did not open`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** The hierarchy's "Open in New Tab": the module (or the module of an interface or link) as a viewer tab of its own. */
  private async openNodeAsTab(n?: NodeArg) {
    const node = this.nodeArg(n);
    await this.openViewer({ root: this.current!, path: node.path });
  }

  /** Send the viewer host messages: to the focused tab of the project, opening one first when asked to. */
  private async toViewer(root: string, messages: HostToViewer[], open: boolean) {
    let editor = this.viewers.of(root)[0];
    if (!editor) {
      if (!open) return;
      editor = await this.openViewer({ root, preserveFocus: true });
    } else if (open) editor.panel.reveal(undefined, true);
    for (const command of messages) editor.post({ type: "command", command });
  }

  private async fromViewer(editor: ViewerEditor, m: ViewerEvent) {
    const root = editor.root;
    const data = this.data.get(root);
    switch (m.type) {
      case "uhd-viewer:ready":
        return;
      case "uhd-viewer:selectionChanged": {
        // an interface picked in the hierarchy stays shown (and selected there) while the viewer selects its module
        const iface = this.pickedInterface;
        const keeps = !!iface && iface.root === root && m.selection?.kind === "node" && m.selection.id === iface.path;
        if (editor === this.viewers.focused) {
          this.picked = undefined;
          if (!keeps) this.pickedInterface = undefined;
          this.showInspector();
          // D6 (2026-10-11): a selection brings the Inspector to the front every time; the keyboard stays in the canvas
          if (m.selection) void this.inspector.reveal({ log: (text) => this.log.warn(text) });
        }
        // (the tab's own hierarchy panel follows its canvas by itself)
        if (m.selection?.kind === "node") this.selectedPath = m.selection.id;
        return;
      }
      case "uhd-viewer:openSource": {
        if (!data) return;
        const loc = m.instancePath !== undefined ? instanceSource(data.index, m.instancePath, (f) => readText(root, f)) : definitionSource(data.index, m.defId, (f) => readText(root, f));
        if (!loc) throw new Error(`no source recorded for ${m.instancePath ?? m.defId}`);
        await this.openLocation(root, loc.file, loc.line);
        return;
      }
      case "uhd-viewer:openArtifact": {
        const part = data && buildArtifacts(root, data.index, m.defId);
        const a = part?.artifacts.find((x) => x.id === m.artifactId);
        if (!a) throw new Error(`${m.defId} has no artifact ${m.artifactId} to open (run Protoboard: Check if it was just added)`);
        await this.openOne(root, a);
        return;
      }
      case "uhd-viewer:inspect":
        // INSPECT in a module's menu: the Inspector in front, with the keyboard (the module is selected already)
        await this.inspector.reveal({ focus: true, log: (text) => this.log.warn(text) });
        return;
      case "uhd-viewer:openModule":
        // double-click on a module (PB-897): a new viewer tab on it, next to this one
        await this.openViewer({ root, path: m.path });
        return;
      case "uhd-viewer:openPair": {
        // the pair view of a link (PB-894 §3, PB-905): an editor tab of its own, at the level that holds the link, beside this one
        const at = m.linkId.includes("/") ? m.linkId.slice(0, m.linkId.lastIndexOf("/")) : "";
        await this.openViewer({ root, path: at, view: "pair", params: { link: m.linkId, a: m.a, b: m.b }, beside: true });
        return;
      }
    }
  }

  /**
   * Show a module's row in the hierarchy of a project's viewer tab (PB-1042: each tab has its own, at its left):
   * the focused tab of the project, its panel opened and the row scrolled to. No tab: nothing to show it in.
   */
  private revealInHierarchy(root: string, path: string, open = true): boolean {
    const editor = this.viewers.of(root)[0];
    if (!editor) return false;
    editor.post({ type: "hierarchy", command: open ? "reveal" : "open", path });
    return true;
  }

  /** The focused viewer tab's hierarchy: its filter, or open and fold it. */
  private hierarchyCommand(command: "filter" | "toggle") {
    const editor = this.viewers.focused;
    if (!editor) throw new Error("Open a Protoboard viewer tab first: its hierarchy is at its left.");
    editor.panel.reveal(undefined, false);
    editor.post({ type: "hierarchy", command });
  }

  /** Reveal in Hierarchy: a module (given, else the focused tab's selection) in its project's viewer tab, opening one when there is none. */
  private async revealNode(n?: NodeArg) {
    const node = this.nodeArg(n);
    const root = this.current!;
    if (!this.viewers.of(root).length) await this.openViewer({ root, preserveFocus: true });
    this.revealInHierarchy(root, node.path);
  }

  /** A node selected in the hierarchy: by the user's click (`byUser`), or revealed there to follow the viewer. */
  treePicked(n: ExplorerNode, byUser: boolean) {
    this.selectedPath = n.path;
    if (byUser) {
      this.picked = undefined;
      // an interface has a card of its own (PB-940): it stays while the viewer selects its module
      this.pickedInterface = n.type === "interface" && this.current ? { root: this.current, key: n.key, path: n.path } : undefined;
      // a click in the hierarchy shows the module, interface or link in the focused viewer tab (PB-897)
      if (this.current) void this.guard(() => this.toViewer(this.current!, viewerMessages(n), false));
    }
    this.showInspector();
  }

  /** The focused viewer tab changed: the Inspector, the hierarchy and the DRC panel follow its project. */
  private viewerFocused(editor: ViewerEditor | undefined) {
    // a viewer tab coming to the front shows its own selection again (a part's detail tab taking the front does not)
    if (editor) this.picked = undefined;
    if (editor && this.pickedInterface && (editor.root !== this.pickedInterface.root || (editor.selection?.kind === "node" ? editor.selection.id !== this.pickedInterface.path : !!editor.selection))) this.pickedInterface = undefined;
    if (editor && editor.root !== this.current) {
      this.current = editor.root;
      if (!this.data.has(editor.root)) {
        const build = readBuild(editor.root);
        if (build) this.applyBuild(editor.root, build);
      }
      this.checkOnOpen(editor.root);
      this.showCurrent();
    }
    this.showInspector();
  }

  /** A tab closed: with the project's last tab, stop watching for its server (it keeps running). */
  private viewerClosed(root: string) {
    if (this.viewers.of(root).length) return;
    const s = this.sessions.get(root);
    s?.monitor?.dispose();
    if (s) s.monitor = undefined;
    this.showInspector();
  }

  private viewerStateChanged(editor: ViewerEditor) {
    if (editor === this.viewers.focused) this.showInspector();
  }

  /**
   * The Inspector's card (PB-1042: the only view of the right side bar, following the focused viewer tab): a part
   * picked in the Library or Project parts, else the focused tab's selection, else the level that tab shows. Focus
   * on another editor keeps the last tab's (`viewers.focused` stays on it while it is open); no tab open, a short
   * empty state.
   */
  private inspectorContent(): InspectorContent {
    if (this.picked) return this.picked;
    const editor = this.viewers.focused;
    if (!editor) return { empty: NO_VIEWER, ...(this.current ? { project: basename(this.current) } : {}) };
    const root = editor.root;
    const data = this.data.get(root);
    const project = basename(root);
    if (!data) return { empty: this.checking.has(root) ? `Checking ${project}…` : `${project} has no build yet: run Protoboard: Check.`, project };
    const sel = editor.selection;
    if (this.pickedInterface?.root === root && root === this.current) {
      const node = this.explorer.node(this.pickedInterface.key);
      const card = node && interfaceCard(data.index, node, node.defId && node.interfaceId ? interfaceArtifacts(root, data.index, node.defId, node.interfaceId) : []);
      if (card) return { card, project };
    }
    // the build's bundle: the page shows the selection from it, as the viewer does
    const bundle = data.index.bundle ? { bundle: { file: join(root, BUNDLE_FILE), version: String(data.build.at.getTime()) } } : {};
    // modules selected together: "3 selected" and the list of them (QA B10)
    if (sel?.kind === "node" && sel.ids && sel.ids.length > 1) {
      const nodes = sel.ids.map((p) => this.fullNode(data, p)).filter((n): n is ExplorerNode => !!n);
      if (nodes.length > 1) return { card: groupCard(nodes, data.findings), project };
    }
    if (sel?.kind === "link") {
      const card = linkCard(data.index, sel.id, data.findings, detailFiles(root, data.index, linkHarnessDefs(data.index, sel.id)));
      if (card) return { card, project, ...bundle };
    }
    const at = (path: string | undefined, level = false) => {
      const node = path !== undefined ? this.fullNode(data, path) : undefined;
      return node
        ? { card: moduleCard(data.index, node, data.findings, level, node.defId ? this.filesOf(root, data.index, node.defId) : undefined, level ? undefined : boardSection(data.index, node, (f) => this.readCached(root, f)), this.costLines(root)), project, ...bundle }
        : undefined;
    };
    if (sel?.kind === "node") return at(sel.id) ?? at(editor.path, true) ?? { empty: "Select a module or a link in the viewer.", project };
    return at(editor.path, true) ?? { empty: "Select a module or a link in the viewer.", project };
  }

  /** The project's bill's lines for the Inspector's prices (PB-1042), read once per build. */
  private readonly costCache = new Map<string, { at: number; lines: CostLine[] | undefined }>();
  private costLines(root: string): CostLine[] | undefined {
    const at = this.data.get(root)?.build.at.getTime() ?? 0;
    const had = this.costCache.get(root);
    if (had && had.at === at) return had.lines;
    let lines: CostLine[] | undefined;
    try {
      lines = this.costOf(root)?.lines;
    } catch (e) {
      this.log.warn(`cost ${basename(root)}: ${(e as Error).message}`);
    }
    this.costCache.set(root, { at, lines });
    return lines;
  }

  /**
   * An interface card's Open in source (PB-1042): a linked interface opens at its link's line in the module that
   * declares the link, an open one at its own line in its module's definition. Connect… opens the `links` of the
   * level's module, where a link from it is written.
   */
  private async openInterfaceSource(req: { path: string; interfaceId: string; owner: string; links: string[] }, connect: boolean) {
    const root = this.viewers.focused?.root ?? this.current;
    const index = root ? this.data.get(root)?.index : undefined;
    if (!root || !index) return;
    const read = (f: string) => this.readCached(root, f);
    const at = (defId: string | undefined, find: (text: string, from: number) => number | undefined) => {
      const src = defId ? definitionSource(index, defId, read) : undefined;
      if (!src) return undefined;
      const text = read(src.file);
      return { file: src.file, line: (text ? find(text, src.line ?? 1) : undefined) ?? src.line };
    };
    const ownerDef = index.instances.get(req.owner)?.definition;
    const target = connect
      ? at(ownerDef, (text, from) => {
          const lines = text.split(/\r?\n/);
          for (let i = Math.max(0, from - 1); i < lines.length; i++) if (/\blinks\s*:/.test(lines[i])) return i + 1;
          return undefined;
        })
      : req.links.length
        ? at(ownerDef, (text, from) => idLine(text, req.links[0], from))
        : at(index.instances.get(req.path)?.definition, (text, from) => idLine(text, req.interfaceId, from));
    if (target) await this.openLocation(root, target.file, target.line);
    else void vscode.window.showInformationMessage(`Protoboard: no source found for ${req.path ? `${req.path}:` : ""}${req.interfaceId}.`);
  }

  /** A module's node from the whole tree (the hierarchy may be filtered). */
  private fullNode(data: ProjectData, path: string): ExplorerNode | undefined {
    const find = (nodes: ExplorerNode[]): ExplorerNode | undefined => {
      for (const n of nodes) {
        if (n.type === "instance" && n.path === path) return n;
        const f = find(n.children);
        if (f) return f;
      }
      return undefined;
    };
    return find(data.tree);
  }

  private showInspector() {
    this.inspector.show(this.inspectorContent());
  }

  /** A project file's text, read again only when it changed (the routed board's files are large and read on every selection). */
  private readonly fileCache = new Map<string, { mtimeMs: number; text: string }>();
  private readCached(root: string, file: string): string | undefined {
    const full = join(root, file);
    try {
      const st = statSync(full);
      const had = this.fileCache.get(full);
      if (had && had.mtimeMs === st.mtimeMs) return had.text;
      const text = readFileSync(full, "utf8");
      this.fileCache.set(full, { mtimeMs: st.mtimeMs, text });
      return text;
    } catch {
      return undefined;
    }
  }

  /** What the Inspector's page may load for a definition and the parts below it (PB-940): pictures, small models, evidence. */
  private filesOf(root: string, index: ProjectIndex, defId: string): DetailFiles {
    return detailFiles(root, index, definitionsBelow(index, defId));
  }

  /** A part picked in Project parts: the Inspector shows it, the focus stays in the list (PB-919). */
  private projectPartPicked(root: string, part: Parameters<typeof partCard>[1]) {
    const data = this.data.get(root);
    if (!data) return;
    this.picked = {
      card: partCard(data.index, part, data.findings, this.filesOf(root, data.index, part.id)),
      project: basename(root),
      ...(data.index.bundle ? { bundle: { file: join(root, BUNDLE_FILE), version: String(data.build.at.getTime()) } } : {}),
    };
    this.showInspector();
  }

  /** A part shown from the Library: the Inspector shows its revision's definition, with its picture and model (PB-919, PB-940). */
  private libraryPartPicked(pick: LibraryPick) {
    const m = pick.model;
    const used = m.used && !m.used.elsewhere && m.used.revision !== undefined ? `used ${rev(m.used.revision)} here` : m.used?.elsewhere ? "here from another library" : undefined;
    // a large model is not loaded for a thumbnail
    const model = smallModel(pick.glb);
    const card = libraryPartCard({
      partId: m.partId,
      name: m.name,
      library: m.library,
      revision: m.revision,
      recommended: m.recommended === m.revision,
      ...(used ? { used } : {}),
      facts: m.facts.map((f) => ({ label: f.label, value: f.value })),
      interfaceCount: m.interfaceCount,
      ...(pick.thumbnail ? { thumbnail: pick.thumbnail } : {}),
      ...(model ? { model } : {}),
      ...(pick.definition ? { definition: pick.definition } : {}),
      ...(pick.trust ? { trust: pick.trust, ...(pick.trustBasis ? { trustBasis: pick.trustBasis } : {}) } : {}),
    });
    this.picked = { card, project: this.current ? basename(this.current) : m.library };
    this.showInspector();
  }

  /** An artifact's card, opened as Open Artifact opens it; an artifact that is only a web address of a part outside the build opens in the browser. */
  async openCardArtifact(card: InspectorCard, defId: string, artifactId: string) {
    const root = this.current;
    const data = root ? this.data.get(root) : undefined;
    const a = root && data ? buildArtifacts(root, data.index, defId)?.artifacts.find((x) => x.id === artifactId) : undefined;
    if (root && a) return this.openOne(root, a);
    // a library part's definition is not in the build: its artifacts that are web addresses open as links
    const def = (card.details?.definitions as { id?: string; artifacts?: { id?: string; url?: string }[] }[] | undefined)?.find((d) => d?.id === defId);
    const url = def?.artifacts?.find((x) => x?.id === artifactId)?.url;
    if (url && /^https?:\/\//i.test(url) && card.details?.links?.includes(url)) return void (await openWeb(url));
    if (card.part?.library) return this.library.showPart(card.part.library, card.part.partId);
    throw new Error(`${artifactId} is not an artifact of ${defId} in the last build; run Protoboard: Check`);
  }

  /** An icon button of the Inspector's card (the integration test presses them too). */
  async inspectorAction(card: InspectorCard, action: InspectorAction) {
    // a part's card: its page in the library, and its definition
    if (action === "detail" && card.part?.library) return this.library.showPart(card.part.library, card.part.partId);
    if (action === "source" && card.kind === "part" && card.part && this.library.usageOf(card.part.partId)?.file) return this.library.openDefinition(card.part.partId);
    const root = this.current;
    if (!root) return;
    const node = card.linkId ? this.explorer.node(`l:${card.linkId}`) : this.explorer.node(`i:${card.path}`) ?? this.fullNode(this.data.get(root)!, card.path);
    if (!node) throw new Error(`${card.title} is not in the last build; run Protoboard: Check`);
    if (action === "pair" && card.linkId) {
      // the link's pair view (PB-905): an editor tab of its own at the level that holds the link, beside the viewer
      const ends = node.description?.split(" ↔ ") ?? [];
      return this.openViewer({ root, path: card.path, view: "pair", params: { link: card.linkId, ...(ends.length === 2 ? { a: ends[0], b: ends[1] } : {}) }, beside: true });
    }
    if (action === "focus") return this.toViewer(root, viewerMessages(node), true);
    if (action === "source") return this.openNodeSource(node);
    if (action === "artifacts") return this.openNodeArtifact(node);
    return this.runNodeOperation(node);
  }

  private async explainFinding(key: string) {
    const f = this.current ? this.data.get(this.current)?.findings.find((x) => x.key === key) : undefined;
    if (f) await this.explain(f);
  }

  private async locateFinding(key: string) {
    const f = this.current ? this.data.get(this.current)?.findings.find((x) => x.key === key) : undefined;
    if (f) await this.locate(f);
  }

  /** Save a tab's layout edits into the project's display file (the dev server reports which file that is). */
  private async saveViewerLayout(target: ViewerTarget, layout: ViewerLayout, snapshot?: LayoutSnapshot) {
    const s = this.sessions.get(target.root);
    let reported: string | undefined;
    if (s?.endpoint) {
      try {
        const state = (await (await fetch(new URL(STATE_ROUTE, s.endpoint.url), { cache: "no-store" })).json()) as { display?: unknown };
        if (typeof state.display === "string") reported = state.display;
      } catch {
        reported = undefined;
      }
    }
    const result = saveLayout(target.root, displayFile(target.root, reported), layout, snapshot);
    for (const k of result.skipped) this.log.warn(`layout of ${k.level || "the top level"} not saved: ${k.reason}`);
    if (result.levels.length) this.log.info(`layout saved: ${result.levels.map((l) => (l === "" ? "top level" : `level ${l}`)).join(", ")} → ${result.file}`);
    if (result.skipped.length) void vscode.window.showWarningMessage(`Protoboard: part of the layout was not saved: ${result.skipped[0].reason}`, "Show Log").then((a) => a && this.log.show());
    else vscode.window.setStatusBarMessage(`$(check) Layout saved to ${result.file}`, 3000);
  }

  private notify(message: string, severity?: "info" | "warning" | "error") {
    if (severity === "error") void vscode.window.showErrorMessage(`Protoboard: ${message}`);
    else if (severity === "warning") void vscode.window.showWarningMessage(`Protoboard: ${message}`);
    else vscode.window.setStatusBarMessage(message, 3000);
  }

  // ---- Library

  /** Focus a part's instances in the viewer; a part no instance uses yet opens the viewer and says so. */
  private async openPartInViewer(root: string, partId: string) {
    let data = this.data.get(root);
    if (!data?.index.defs.has(partId)) {
      await this.check(root, { silent: true });
      data = this.data.get(root);
    }
    const instances = data?.index.usedBy.get(partId) ?? [];
    if (instances.length) {
      await this.toViewer(root, viewerMessages({ path: instances[0].path }), true);
      return;
    }
    await this.openViewer(root);
    const open = "Open Definition";
    const a = await vscode.window.showInformationMessage(
      `Protoboard: ${partId} is in the project's parts, but no module uses it yet. Add it to the system in a .uhd.ts file to see it in the viewer.`,
      open,
    );
    if (a === open) await this.library.openDefinition(partId);
  }

  /** Protoboard: Add Part…: `<id>[@<rev>]` from the first library that has it (the CLI chooses, as in a terminal). */
  private async addPartCommand(ref?: string) {
    const root = await this.project();
    const text = ref ?? (await vscode.window.showInputBox({ title: "Add a part to the project", prompt: "Part id, optionally @revision (protoboard parts add)", placeHolder: "bme280@2" }));
    if (!text?.trim()) return;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: adding ${text.trim()}` }, () =>
      runCli(this.trustedCli(root), ["parts", "add", text.trim(), "--format", "json"], { cwd: root, env: this.library.cliEnv() }),
    );
    const out = parseJsonOutput<{ results: { id: string; status: string; revision?: number; library?: string; message?: string }[] }>(r, "protoboard parts add");
    for (const x of out.results) this.log.info(`add: ${x.status} ${x.id}${x.revision ? `@${x.revision}` : ""}${x.library ? ` from ${x.library}` : ""}${x.message ? `: ${x.message}` : ""}`);
    const conflict = out.results.find((x) => x.status === "conflict");
    if (conflict) void vscode.window.showWarningMessage(`Protoboard: ${conflict.id}: ${conflict.message ?? "conflict"}`);
    else void vscode.window.showInformationMessage(`Protoboard: ${out.results.map((x) => `${x.id} ${rev(x.revision)} ${x.status}`).join(", ")}.`);
    void this.check(root, { silent: true });
  }

  // ---- a .uhd.ts file in the viewer (PB-931)

  private readonly lensChanged = new vscode.EventEmitter<void>();

  /** The modules a `.uhd.ts` file defines, in the project that holds it, as its last build knows them. */
  sourceModulesOf(uri: vscode.Uri, text?: string): { root: string; modules: SourceModule[] } | undefined {
    if (uri.scheme !== "file") return undefined;
    const root = projectOf(uri.fsPath, this.rootList);
    const data = root ? this.data.get(root) : undefined;
    const rel = root && projectRelative(root, uri.fsPath);
    if (!root || !data || !rel) return root ? { root, modules: [] } : undefined;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    return { root, modules: modulesInFile(data.index, rel, text ?? open?.getText() ?? readText(root, rel)) };
  }

  /** A lens above each definition the build knows in the file: Open in Viewer (`protoboard.editor.codeLens`). */
  private lenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration("protoboard", doc.uri).get<boolean>("editor.codeLens", true)) return [];
    const found = this.sourceModulesOf(doc.uri, doc.getText());
    if (!found) return [];
    return found.modules.map((m) => {
      const at = Math.max(0, Math.min(doc.lineCount - 1, m.line - 1));
      return new vscode.CodeLens(new vscode.Range(at, 0, at, 0), {
        title: lensTitle(m),
        tooltip: m.path === undefined ? `${m.name} (${m.defId}) is defined here, but no system of the last build uses it` : `Show ${m.name} in the Protoboard viewer${m.hasChildren ? "" : ", selected where it is used"}`,
        command: "protoboard.openSourceInViewer",
        arguments: [doc.uri, m.defId],
      });
    });
  }

  /**
   * Open the module a `.uhd.ts` file defines in the viewer, beside the file:
   * the definition named (a lens), else the one the cursor is in, else the
   * file's only one, else the one picked. A module with modules of its own
   * opens on its level; a part opens on its parent's level, selected.
   */
  async openSourceInViewer(given?: vscode.Uri, defId?: string): Promise<ViewerEditor | undefined> {
    const active = vscode.window.activeTextEditor;
    const uri = given instanceof vscode.Uri ? given : active?.document.uri;
    if (!uri || uri.scheme !== "file" || !/\.uhd\.ts$/i.test(uri.fsPath)) throw new Error("open a .uhd.ts file of a Protoboard project first");
    const roots = await this.roots();
    this.rootList = roots;
    const root = projectOf(uri.fsPath, roots);
    if (!root) throw new Error(`${basename(uri.fsPath)} is not in a Protoboard project of this workspace (no protoboard.config.ts above it)`);
    // a file saved since the last build, or a project never checked: build first, so the module is the one written now
    if (!this.data.has(root)) {
      const build = readBuild(root);
      if (build) this.applyBuild(root, build);
      else await this.check(root, { silent: false });
    }
    let found = this.sourceModulesOf(uri);
    if (!found?.modules.length) {
      await this.check(root, { silent: false });
      found = this.sourceModulesOf(uri);
    }
    const modules = found?.modules ?? [];
    if (!modules.length) {
      void vscode.window.showInformationMessage(`Protoboard: ${basename(uri.fsPath)} defines no module the system uses.`);
      return undefined;
    }
    const data = this.data.get(root)!;
    const editor = active?.document.uri.toString() === uri.toString() ? active : undefined;
    let m = defId ? modules.find((x) => x.defId === defId) : undefined;
    if (!m && editor) m = moduleAtLine(data.index, modules, editor.selection.active.line + 1, this.selectedPath);
    if (!m && modules.length === 1) m = modules[0];
    if (!m) {
      const pick = await vscode.window.showQuickPick(
        modules.map((x) => ({ label: x.name, description: x.defId, detail: x.path === undefined ? "not used in the system yet" : x.path === "" ? "the system" : `at ${x.path}${x.uses > 1 ? ` and ${x.uses - 1} more` : ""}`, module: x })),
        { title: `Modules defined in ${basename(uri.fsPath)}`, placeHolder: "Module to open in the viewer" },
      );
      if (!pick) return undefined;
      m = pick.module;
    }
    if (m.path === undefined) {
      void vscode.window.showInformationMessage(`Protoboard: ${m.name} is not in the system yet. Add it as a child of a module to see it.`);
      return undefined;
    }
    this.selectedPath = m.path;
    const tab = await this.openViewer({ root, path: m.path, beside: !!editor });
    // a part has no level of its own: its tab shows its parent's, and the part is selected there
    if (!m.hasChildren && m.path !== "") tab.post({ type: "command", command: { type: "uhd-viewer:focus", path: m.path } });
    return tab;
  }

  // ---- a new project (PB-931): what New Project asks and says

  /**
   * Before a template is made: is anyone signed in to the part library? When
   * not, offer to sign in first (and wait for it), or to go on without the
   * parts. False when the person backed out. A service that signs no one in,
   * or one that cannot be asked, does not hold the project up.
   */
  private async signedInForParts(cli: CliCommand, cwd: string, template: string): Promise<boolean> {
    const ask = async (): Promise<AccountState> => {
      try {
        return accountFromWhoAmI(await runCli(cli, ["whoami", "--check", "--format", "json"], { cwd, env: this.library.cliEnv(), signal: AbortSignal.timeout(15_000) }));
      } catch (e) {
        return { state: "unknown", reason: (e as Error).message };
      }
    };
    const state = await ask();
    if (state.state !== "signed-out" && state.state !== "expired") return true;
    const signIn = "Sign In First";
    const anyway = "Create Without Parts";
    const a = await vscode.window.showInformationMessage(
      `The ${template} template takes its catalog parts from ${state.service}, and you are not signed in there${state.state === "expired" ? " any more" : ""}.`,
      { modal: true, detail: "Without a sign-in the project is made with placeholders; fetch the parts after you sign in." },
      signIn,
      anyway,
    );
    if (a === anyway) return true;
    if (a !== signIn) return false;
    this.log.info("create project: signing in first (protoboard login in a terminal)");
    await this.signIn();
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Protoboard: waiting for the sign-in in the terminal; the project is made when it is done", cancellable: true }, async (_p, cancel) => {
      const until = Date.now() + 10 * 60_000;
      while (!cancel.isCancellationRequested && Date.now() < until && !this.disposed) {
        await new Promise((r) => setTimeout(r, 2500));
        if ((await ask()).state === "signed-in") return true;
      }
      return false;
    });
  }

  /**
   * A template's parts were not fetched (not signed in, or the service was
   * not reached): say so, with the way out. Fetch Parts runs the command
   * `init` printed with the project's own CLI, once `npm install` has put it
   * there, then checks the project again so the placeholders go.
   */
  private async partsNotFetched(root: string, why: string, command: string | undefined, inWorkspace: boolean) {
    const args = partsAddArgs(command);
    const fetch = "Fetch Parts";
    const signIn = "Sign In";
    const log = "Show Log";
    for (;;) {
      // Sign In only when the service asked for a sign-in (B7)
      const a = await vscode.window.showWarningMessage(partsNotFetchedMessage(why, command), ...(args && inWorkspace ? [fetch] : []), ...(partsFailure(why) === "sign-in" ? [signIn] : []), log);
      if (a === log) return this.log.show();
      if (a === signIn) {
        await this.guard(() => this.signIn());
        continue;
      }
      if (a !== fetch || !args) return;
      const ok = await this.guard(() => this.fetchParts(root, args));
      if (ok) return;
    }
  }

  /**
   * **Fetch Parts** for a project whose check names definitions nothing
   * defines (B6): the DRC row, the Problems quick fix and the viewer's banner
   * add them all from the library at once, then check again.
   */
  async fetchMissingParts(given?: string): Promise<boolean> {
    const root = await this.project(given);
    const ids = unfetchedParts(this.data.get(root)?.findings ?? []);
    if (!ids.length) {
      void vscode.window.showInformationMessage(`Protoboard: no missing parts in ${basename(root)}'s last check.`);
      return false;
    }
    this.log.info(`${basename(root)}: Fetch Parts: protoboard parts add ${ids.join(" ")}`);
    return this.fetchParts(root, ["parts", "add", ...ids]);
  }

  private async fetchParts(root: string, args: string[]): Promise<boolean> {
    // library parts are the cloud (PB-928): signed out, Fetch Parts asks to sign in instead
    if (await this.cloudLocked()) {
      void this.askSignIn();
      return false;
    }
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: fetching ${args.length - 2} part${args.length === 3 ? "" : "s"} for ${basename(root)}`, cancellable: true }, async (progress, cancel) => {
      // the project's own CLI does it: wait for the project to be set up
      const until = Date.now() + 30 * 60_000;
      while (!this.cliReady(root)) {
        progress.report({ message: "waiting for the project to be set up" });
        if (cancel.isCancellationRequested || this.disposed || Date.now() > until || !existsSync(join(root, "protoboard.config.ts"))) return false;
        await new Promise((r) => setTimeout(r, 2000));
      }
      progress.report({ message: "" });
      const ctl = new AbortController();
      cancel.onCancellationRequested(() => ctl.abort());
      const r = await runCli(this.trustedCli(root), [...args, "--format", "json"], { cwd: root, env: this.library.cliEnv(), signal: ctl.signal });
      if (r.code === ACCESS_EXIT_CODE) {
        // the CLI found no sign-in the service accepts (the extension's answer was older): say so the same way
        this.log.warn(`${basename(root)}: protoboard ${args.slice(0, 2).join(" ")}: the library needs a sign-in`);
        void this.refreshAccount(true).then(() => this.askSignIn());
        return false;
      }
      if (r.code !== 0) {
        const said = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-2).join(" ");
        this.log.warn(`${basename(root)}: protoboard ${args.slice(0, 3).join(" ")} … exited ${r.code}: ${said}`);
        void vscode.window.showErrorMessage(`Protoboard: the parts were not fetched (${said.slice(0, 240) || `exit ${r.code}`}).`);
        return false;
      }
      this.log.info(`${basename(root)}: fetched ${args.length - 2} catalog part(s)`);
      void this.check(root, { silent: true });
      return true;
    });
  }

  // ---- Explorer actions

  /**
   * The module a command is about: a node of the tree (the tests, the Inspector's buttons), a row of a viewer
   * tab's hierarchy (its right-click menu: the row's `data-vscode-context`), else the focused tab's selection.
   */
  private nodeArg(n?: NodeArg): ExplorerNode {
    const row = hierarchyRowArg(n);
    if (row) {
      // the menu was opened in the focused tab: its project
      const root = this.viewers.focused?.root ?? this.current;
      const data = root ? this.data.get(root) : undefined;
      const node = data ? this.fullNode(data, row.path) : undefined;
      if (!node || !root) throw new Error(`${row.path || "the system"} is not in the last build; run Protoboard: Check`);
      if (root !== this.current) this.viewerFocused(this.viewers.focused);
      return node;
    }
    if (n && typeof n === "object" && "key" in n) {
      if (!this.current) throw new Error("Open a Protoboard project first.");
      return n as ExplorerNode;
    }
    const editor = this.viewers.focused;
    const sel = editor?.selection;
    const data = editor ? this.data.get(editor.root) : undefined;
    const node = data && sel?.kind === "node" ? this.fullNode(data, sel.id) : data && editor ? this.fullNode(data, editor.module) : undefined;
    if (!node || !this.current) throw new Error("Select a module in a Protoboard viewer tab or its hierarchy first.");
    return node;
  }

  private async focusNode(n: NodeArg | undefined, open: boolean) {
    const node = this.nodeArg(n);
    this.selectedPath = node.path;
    await this.toViewer(this.current!, viewerMessages(node), open);
  }

  private async openNodeSource(n?: NodeArg) {
    const node = this.nodeArg(n);
    const root = this.current!;
    const data = this.data.get(root);
    if (!data) return;
    const loc = node.type === "instance" ? instanceSource(data.index, node.path, (f) => readText(root, f)) : definitionSource(data.index, data.index.instances.get(node.path)?.definition ?? "", (f) => readText(root, f));
    if (!loc) throw new Error(`no source recorded for ${node.path || node.label}`);
    let line = loc.line;
    // a link or an interface: its id, from the declaring module's line down
    const id = node.type === "link" && node.linkId ? localLinkId({ id: node.linkId, owner: node.path }) : node.type === "interface" ? node.interfaceId : undefined;
    if (id && node.type !== "instance") {
      const found = findIdLine(readText(root, loc.file), id, loc.line ?? 1);
      if (found) line = found;
    }
    await this.openLocation(root, loc.file, line);
  }

  private async openNodeArtifact(n?: NodeArg) {
    const node = this.nodeArg(n);
    const root = this.current!;
    const data = this.data.get(root);
    const part = data && node.defId ? buildArtifacts(root, data.index, node.defId) : undefined;
    if (!part) {
      void vscode.window.showInformationMessage(`Protoboard: ${node.label} has no artifact files or links to open.`);
      return;
    }
    await this.pickArtifact(root, part);
  }

  private async runNodeOperation(n?: NodeArg) {
    const node = this.nodeArg(n);
    const root = this.current!;
    if (!node.ops.length || !node.defId) {
      void vscode.window.showInformationMessage(`Protoboard: no capability operation applies to ${node.label}.`);
      return;
    }
    const caps = this.data.get(root)?.index.capabilities.get(node.defId) ?? [];
    const op =
      node.ops.length === 1
        ? node.ops[0]
        : (
            await vscode.window.showQuickPick(
              node.ops.map((o) => ({ label: o, description: caps.find((c) => o.startsWith(`${c.capability}:`))?.provider, op: o })),
              { placeHolder: `Operation on ${node.defId}` },
            )
          )?.op;
    if (!op) return;
    this.log.info(`run ${op} --module ${node.defId} in ${basename(root)}`);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: ${op} ${node.defId}`, cancellable: true }, (_p, token) => {
      const ctl = new AbortController();
      token.onCancellationRequested(() => ctl.abort());
      return runCli(this.trustedCli(root), ["run", op, "--module", node.defId!, "--format", "json"], { cwd: root, signal: ctl.signal });
    });
    const rec = parseJsonOutput<{ status: string; summary?: string; outputs?: { path: string }[] }>(r, `protoboard run ${op}`);
    this.log.info(`${op} ${node.defId}: ${rec.status}${rec.summary ? `: ${rec.summary}` : ""}`);
    for (const o of rec.outputs ?? []) this.log.info(`  → ${o.path}`);
    const text = `Protoboard: ${op} ${node.defId} ${rec.status}${rec.summary ? `: ${rec.summary}` : ""}`;
    if (rec.status === "succeeded") void vscode.window.showInformationMessage(text);
    else void vscode.window.showWarningMessage(text, "Show Log").then((a) => a && this.log.show());
    // an operation changes outputs and findings
    void this.check(root, { silent: true });
  }

  /** The cursor in a `.uhd.ts` file of the current project: the module it is in shows in the hierarchy of the project's viewer tab. */
  private cursorMoved(e: vscode.TextEditorSelectionChangeEvent) {
    const doc = e.textEditor.document;
    if (doc.uri.scheme !== "file" || !doc.fileName.endsWith(".uhd.ts") || !this.current || !this.viewers.of(this.current).length) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => {
      const root = this.current!;
      const data = this.data.get(root);
      const rel = data && projectRelative(root, doc.fileName);
      if (!rel) return;
      const line = e.textEditor.selection.active.line;
      const path = instanceAtCursor(data.index, rel, line + 1, doc.lineAt(line).text, this.selectedPath);
      const node = path !== undefined ? this.explorer.node(`i:${path}`) : undefined;
      if (!node || this.selectedPath === node.path) return;
      this.selectedPath = node.path;
      // shown, not selected: the tab's selection (and the Inspector) stay where the user put them
      this.revealInHierarchy(root, node.path);
    }, 200);
  }

  // ---- DRC actions

  private async locate(f: Finding) {
    if (f.target.path === undefined) {
      void vscode.window.showInformationMessage(`Protoboard: ${f.code} is about ${f.target.label}, which is not a module in the system.`);
      return;
    }
    await this.toViewer(this.current!, viewerMessages({ ...f.target, path: f.target.path }), true);
  }

  private async explain(f: Finding) {
    if (!f.reference) {
      const pick = await vscode.window.showInformationMessage(`Protoboard: no reference for ${f.code} (validator ${f.validator}).`, "Show Log");
      if (pick) this.log.show();
      return;
    }
    // the code's entry as a page to read (B15), not the reference file at a row of its table
    const uri = vscode.Uri.from({ scheme: EXPLAIN_SCHEME, path: `/${f.code}.md`, query: String(++this.explained) });
    this.explanations.set(uri.toString(), explainMarkdown(f));
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  }
  private explained = 0;
  /** The Explain pages, by URI (EXPLAIN_SCHEME's content). */
  readonly explanations = new Map<string, string>();

  /** A file (project-relative, or absolute) at a 1-based line. */
  private async openLocation(root: string | undefined, file: string, line?: number) {
    const uri = vscode.Uri.file(!root || isAbsolute(file) ? file : join(root, file));
    const at = Math.max(0, (line ?? 1) - 1);
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(at, 0, at, 0), preview: true, viewColumn: this.editorColumn() });
  }

  // ---- artifacts

  async openArtifact(arg?: string | { root?: string; instance?: string }) {
    const given = typeof arg === "string" ? { instance: arg } : arg ?? {};
    const root = await this.project(given.root);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Protoboard: listing artifacts" }, () =>
      runCli(this.trustedCli(root), ["artifacts", ...(given.instance ? [given.instance] : []), "--format", "json"], { cwd: root }),
    );
    const { artifacts } = parseJsonOutput<{ artifacts: ArtifactEntry[] }>(r, "protoboard artifacts");
    const parts = partChoices(artifacts);
    if (!parts.length) {
      void vscode.window.showInformationMessage(`Protoboard: ${given.instance ? `${given.instance} has` : "the parts in use have"} no artifact files or links to open.`);
      return;
    }
    const part =
      parts.length === 1
        ? parts[0]
        : (
            await vscode.window.showQuickPick(
              parts.map((p) => ({ label: p.label, description: p.definition, detail: `${describeInstances(p.instances)} · ${p.artifacts.length} artifact${p.artifacts.length === 1 ? "" : "s"}`, part: p })),
              { placeHolder: "Part (definition), with the instances that use it", matchOnDescription: true, matchOnDetail: true },
            )
          )?.part;
    if (!part) return;
    await this.pickArtifact(root, part);
  }

  private pickArtifact(root: string, part: PartChoice): Promise<void> {
    const inEditor: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("go-to-file"), tooltip: "Open in VS Code" };
    const reveal: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon("folder-opened"), tooltip: "Reveal in the file manager" };
    type Item = vscode.QuickPickItem & { artifact: ArtifactEntry };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = `${part.label} · artifacts`;
    qp.placeholder = "STEP and GLB open in the CAD viewer, PDF in its default application; sources and data in VS Code";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = sortArtifacts(part.artifacts).map((a) => ({
      label: a.id,
      description: describeArtifact(a),
      detail: openMode(a) === "url" ? a.url : vscode.workspace.asRelativePath(a.resolved!, false),
      buttons: openMode(a) === "url" ? [] : [inEditor, reveal],
      artifact: a,
    }));
    return new Promise((done) => {
      qp.onDidAccept(() => {
        const item = qp.selectedItems[0];
        qp.hide();
        if (item) void this.guard(() => this.openOne(root, item.artifact));
      });
      qp.onDidTriggerItemButton((e) => {
        qp.hide();
        const file = vscode.Uri.file(e.item.artifact.resolved!);
        void this.guard(() => (e.button === reveal ? vscode.commands.executeCommand("revealFileInOS", file) : vscode.commands.executeCommand("vscode.open", file, { viewColumn: this.editorColumn(), preview: true })));
      });
      qp.onDidHide(() => {
        qp.dispose();
        done();
      });
      qp.show();
    });
  }

  private async openOne(root: string, a: ArtifactEntry) {
    const mode = openMode(a);
    this.log.info(`open ${a.definition}#${a.id} (${mode}): ${a.resolved ?? a.url}`);
    if (mode === "url") {
      await openWeb(a.url!);
      return;
    }
    const file = vscode.Uri.file(a.resolved!);
    if (mode === "editor") {
      await vscode.commands.executeCommand("vscode.open", file, { viewColumn: this.editorColumn(), preview: true });
      return;
    }
    if (isCadFile(a.resolved!)) {
      await openCad(file, this.editorColumn());
      return;
    }
    // PDF, other CAD and fabrication files: the system's application for the type, when the type is one it may open (PB-1048)
    if ((await openOutside(file)) === "reveal") this.log.warn(`${relative(root, a.resolved!)} is not a type Protoboard hands to another application, or none opened it; shown in the file manager instead`);
  }

  // ---- Cloud view: cost, deployment artifacts (spec §2.4)

  /** The project's cost: its bill of materials, from the design as last built and the offers the project holds. */
  costOf(root: string): CostModel | undefined {
    return projectCost(root, basename(root), this.data.get(root)?.index);
  }

  cloudDrawn() {
    return this.cloud.drawn;
  }

  cloudModel() {
    const root = this.current;
    if (!root) return undefined;
    const releases = listReleases(root);
    let cost: CostModel | undefined;
    let costMissing: string | undefined;
    try {
      cost = this.costOf(root);
      if (!cost) costMissing = this.checking.has(root) ? `Checking ${basename(root)}…` : `${basename(root)} has no build yet: run Protoboard: Check.`;
    } catch (e) {
      costMissing = `The cost could not be read: ${(e as Error).message}`;
      this.log.warn(`cost ${basename(root)}: ${(e as Error).message}`);
    }
    this.shownCost = cost ? { root, cost } : undefined;
    const index = this.data.get(root)?.index;
    const rootDef = index?.bundle?.definitions.find((d) => d.id === index.resolved.project?.root) as { name?: string; description?: string } | undefined;
    const facts = {
      name: rootDef?.name ?? index?.resolved.project?.name ?? basename(root),
      ...(rootDef?.description ? { description: rootDef.description } : {}),
      ...(projectAuthor(root) ? { author: projectAuthor(root) } : {}),
      libraries: this.library.snapshot().libraries?.length ?? 0,
      ...(this.partsViews.parts() ? { parts: this.partsViews.parts()!.counts.total } : {}),
      ...(index?.resolved.project?.currency ? { currency: index.resolved.project.currency } : {}),
    };
    return cloudPageModel({ project: basename(root), cost, costMissing, releases, release: this.releasing.get(root) ?? { state: "idle" }, account: accountCard(this.accountState), accountState: this.accountState, facts });
  }

  private showCloud() {
    if (!this.cloud?.visible) return;
    this.cloud.show(this.cloudModel());
  }

  /** A release, offers or sourcing evidence changed on disk. */
  private cloudChanged() {
    clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => !this.disposed && this.showCloud(), 300);
  }

  private costLine(index: number) {
    const shown = this.shownCost;
    const line = shown ? pageOrder(shown.cost)[index] : undefined;
    if (!shown || !line) throw new Error("the cost changed since it was shown; look again");
    return { root: shown.root, line };
  }

  /** Instances of a part (a BOM line): the first revealed in the Hierarchy, and focused in the viewer when it is open. */
  async focusInstances(root: string, paths: string[]) {
    const path = paths[0];
    if (path === undefined) return;
    this.selectedPath = path;
    // the viewer tab selects it (one is opened when there is none), and its hierarchy shows the row
    await this.toViewer(root, viewerMessages({ path }), true);
    this.revealInHierarchy(root, path);
  }

  /** A cost line's module: revealed in the Explorer, and focused in the viewer when it is open. */
  private async focusCostLine(index: number) {
    const { root, line } = this.costLine(index);
    const path = line.instances[0];
    if (path === undefined) {
      void vscode.window.showInformationMessage(`Protoboard: ${line.definition} is not used by an instance of the system in the last build.`);
      return;
    }
    this.selectedPath = path;
    await this.toViewer(root, viewerMessages({ path }), true);
    this.revealInHierarchy(root, path);
  }

  private async openCostRow(index: number) {
    const { root, line } = this.costLine(index);
    if (!line.row) throw new Error(`${line.item} is not a line of an ordering list (a draft, before the first release)`);
    await this.openLocation(root, line.row.file, line.row.line);
  }

  private async openCostList() {
    const shown = this.shownCost;
    if (shown?.cost.source.kind !== "release") return;
    await this.openLocation(shown.root, shown.cost.source.file, 1);
  }

  /** `protoboard parts offers`: the library's offers for the vendored catalog parts, into parts/offers.json. */
  async fetchOffers(given?: string) {
    // offers come from the cloud (PB-928): signed out, this asks to sign in instead
    if (await this.cloudLocked()) return this.askSignIn();
    const root = await this.project(given);
    this.log.info(`parts offers in ${basename(root)}`);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: getting the catalog's offers for ${basename(root)}`, cancellable: true }, (_p, token) => {
      const ctl = new AbortController();
      token.onCancellationRequested(() => ctl.abort());
      return runCli(this.trustedCli(root), ["parts", "offers", "--format", "json"], { cwd: root, signal: ctl.signal });
    });
    const list = parseJsonOutput<{ id: string; offers: number; status: string }[]>(r, "protoboard parts offers");
    const offers = list.reduce((n, x) => n + x.offers, 0);
    for (const x of list) this.log.info(`  ${x.status} ${x.id}${x.status === "vendored" ? ` ${x.offers} offer(s)` : ""}`);
    void vscode.window.showInformationMessage(`Protoboard: ${offers} offer(s) for ${list.filter((x) => x.status === "vendored").length} catalog part(s), written to parts/offers.json.`);
    this.showCloud();
  }

  private setRelease(root: string, state: ReleaseState) {
    this.releasing.set(root, state);
    if (root === this.current) this.showCloud();
  }

  /**
   * Generate deployment artifacts: `protoboard release` (the Manufacturing
   * Package). The preconditions run first (`--check`, quick), so a refusal
   * says why at once; uncommitted changes can be released anyway, which the
   * manifest records. Progress in a notification, the CLI's output in the log.
   */
  async generate(given?: string, options: { allowDirty?: boolean; quiet?: boolean } = {}): Promise<ReleaseState> {
    const root = await this.project(given);
    if (this.releasing.get(root)?.state === "running") {
      void vscode.window.showInformationMessage(`Protoboard: a release of ${basename(root)} is already running.`);
      return this.releasing.get(root)!;
    }
    const cli = this.trustedCli(root);
    const flags = ["--format", "json", ...(options.allowDirty ? ["--allow-dirty"] : [])];
    const run = async (progress: vscode.Progress<{ message?: string }>, signal: AbortSignal): Promise<ReleaseState & { dirtyOnly?: boolean }> => {
      const step = (message: string) => {
        progress.report({ message });
        this.setRelease(root, { state: "running", step: message });
      };
      step("Checking the preconditions…");
      this.log.info(`release ${basename(root)}: protoboard release --check${options.allowDirty ? " --allow-dirty" : ""}`);
      const pre = releaseOutcome(parseJsonOutput<ReleaseRecord>(await runCli(cli, ["release", "--check", ...flags], { cwd: root, signal }), "protoboard release --check"));
      if (!pre.ok) return { state: "refused", message: pre.message, problems: pre.problems, dirtyOnly: pre.dirtyOnly };
      step("Writing the Manufacturing Package (figures, PDFs)…");
      this.log.info(`release ${basename(root)}: protoboard release${options.allowDirty ? " --allow-dirty" : ""}`);
      const t0 = Date.now();
      const r = await runCli(cli, ["release", ...flags], { cwd: root, signal, onStderr: (l) => this.log.info(`[release ${basename(root)}] ${l}`) });
      const rec = parseJsonOutput<ReleaseRecord>(r, "protoboard release");
      const out = releaseOutcome(rec);
      this.log.info(`release ${basename(root)}: ${rec.status}: ${out.message} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      for (const p of out.problems) this.log.warn(`  ${p.code}: ${p.message}`);
      return out.ok ? { state: "done", message: out.message } : { state: "failed", message: out.message, problems: out.problems };
    };
    let result: ReleaseState & { dirtyOnly?: boolean };
    try {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: generating deployment artifacts for ${basename(root)}`, cancellable: true }, (progress, token) => {
        const ctl = new AbortController();
        token.onCancellationRequested(() => ctl.abort());
        return run(progress, ctl.signal);
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      this.setRelease(root, { state: "failed", message: aborted ? "Cancelled." : (e as Error).message });
      if (aborted) return this.releasing.get(root)!;
      throw e;
    }
    const { dirtyOnly, ...state } = result;
    this.setRelease(root, state);
    if (options.quiet) return state;
    if (state.state === "done") {
      const latest = listReleases(root)[0];
      const actions = [latest?.index && "Open index.html", latest?.overview && "Open overview PDF", latest && "Show folder"].filter((x): x is string => !!x);
      void vscode.window.showInformationMessage(`Protoboard: ${state.message}`, ...actions).then((a) => {
        if (!a || !latest) return;
        void this.guard(() => this.openPackage(root, latest.version, a === "Open index.html" ? "index" : a === "Open overview PDF" ? "overview" : "folder"));
      });
    } else if (dirtyOnly) {
      const anyway = "Release anyway (recorded)";
      const a = await vscode.window.showWarningMessage(`Protoboard: ${state.message}`, anyway, "Show Log");
      if (a === anyway) return this.generate(root, { ...options, allowDirty: true });
      if (a) this.log.show();
    } else {
      void vscode.window.showWarningMessage(`Protoboard: ${state.message}`, "Show Log").then((a) => a && this.log.show());
    }
    return state;
  }

  /** The Manufacturing Package of a release (the newest when none is named): index.html in a webview or the browser, the overview PDF, or the folder. */
  async openPackage(given: string | undefined, version: string | undefined, what: "index" | "browser" | "overview" | "folder") {
    const root = await this.project(given);
    const releases = listReleases(root);
    const r = version ? releases.find((x) => x.version === version) : releases[0];
    if (!r) throw new Error(`${basename(root)} has no release${version ? ` ${version}` : ""} yet: generate the deployment artifacts first`);
    if (what === "folder") {
      await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(r.dir));
      if (!vscode.env.remoteName) await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(join(r.dir, "manifest.json")));
      return;
    }
    if (what === "overview") {
      if (!r.overview) throw new Error(`release ${r.version} has no 00-overview.pdf`);
      return this.openFile(r.overview);
    }
    if (!r.index) throw new Error(`release ${r.version} has no index.html`);
    if (what === "browser") {
      if (!(await vscode.env.openExternal(vscode.Uri.file(r.index)))) throw new Error(`no browser opened ${r.index}`);
      return;
    }
    const key = r.dir;
    const existing = this.packagePanels.get(key);
    if (existing) {
      existing.reveal();
      existing.webview.html = packageHtml(readFileSync(r.index, "utf8"), { base: existing.webview.asWebviewUri(vscode.Uri.file(r.dir)).toString(), cspSource: existing.webview.cspSource, nonce: nonce() });
      return;
    }
    const panel = vscode.window.createWebviewPanel("protoboard.package", `Package ${r.version} · ${basename(root)}`, this.editorColumn(), {
      enableScripts: true,
      enableFindWidget: true,
      localResourceRoots: [vscode.Uri.file(r.dir)],
    });
    this.packagePanels.set(key, panel);
    panel.onDidDispose(() => this.packagePanels.delete(key));
    panel.webview.onDidReceiveMessage((m: PackagePageMessage) => {
      if (m?.type !== "open" || typeof m.href !== "string") return;
      const target = packageLink(m.href);
      if (!target) return;
      void this.guard(() => (target.kind === "url" ? openWeb(target.url) : this.openFile(join(r.dir, target.path))));
    });
    panel.webview.html = packageHtml(readFileSync(r.index, "utf8"), { base: panel.webview.asWebviewUri(vscode.Uri.file(r.dir)).toString(), cspSource: panel.webview.cspSource, nonce: nonce() });
  }

  /** A file: text and data in VS Code (beside the viewer), STEP and GLB in the CAD viewer, PDFs and images in the system's application. */
  private async openFile(file: string) {
    const uri = vscode.Uri.file(file);
    if (isCadFile(file)) {
      await openCad(uri, this.editorColumn());
      return;
    }
    if (/^\.(csv|txt|json|md|html?|ts|kcl|py|cfg|ini|yaml|yml|xml)$/i.test(extname(file))) {
      await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: this.editorColumn(), preview: true });
      return;
    }
    if ((await openOutside(uri)) === "reveal") this.log.warn(`${file} is not a type Protoboard hands to another application, or none opened it; shown in the file manager instead`);
  }

  /**
   * Where a file opens: beside the viewer when the viewer is in the active
   * editor group (so opening an artifact or a source never hides it), else in
   * the active group.
   */
  private editorColumn(): vscode.ViewColumn {
    const group = vscode.window.tabGroups.activeTabGroup;
    const viewerHere = group.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === VIEWER_TYPE);
    return viewerHere ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  }

  // ---- shutdown

  async dispose() {
    this.disposed = true;
    for (const c of this.checking.values()) c.abort();
    for (const t of this.saveTimers.values()) clearTimeout(t);
    for (const t of this.buildTimers.values()) clearTimeout(t);
    clearTimeout(this.cursorTimer);
    clearTimeout(this.cloudTimer);
    for (const p of this.packagePanels.values()) p.dispose();
    const stops: Promise<void>[] = [];
    for (const s of this.sessions.values()) {
      s.monitor?.dispose();
      if (s.process?.running) stops.push(s.process.stop(3000));
    }
    await Promise.all(stops);
  }
}

function toDiagnostic(m: MappedDiagnostic): vscode.Diagnostic {
  const d = new vscode.Diagnostic(
    new vscode.Range(m.line, m.startCharacter, m.line, m.endCharacter),
    m.unlocated ? `${m.message} (${m.entity.kind} ${m.entity.id})` : m.message,
    SEVERITY[m.severity],
  );
  d.code = m.code;
  d.source = m.source;
  return d;
}

/** A file's line for diagnostic ranges, as checked: the file on disk. */
function lineReader() {
  const cache = new Map<string, string[] | undefined>();
  return (file: string, line: number) => {
    if (!cache.has(file)) {
      let text: string | undefined;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        text = undefined;
      }
      cache.set(file, text?.split(/\r?\n/));
    }
    return cache.get(file)?.[line];
  };
}

/** A project file's text, or undefined. */
function readText(root: string, file: string): string | undefined {
  try {
    return readFileSync(isAbsolute(file) ? file : join(root, file), "utf8");
  } catch {
    return undefined;
  }
}

/** The line where `id` is declared, from a line down. */
function findIdLine(text: string | undefined, id: string, from: number): number | undefined {
  return text ? idLine(text, id, from) : undefined;
}

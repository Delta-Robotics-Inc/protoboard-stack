/**
 * Getting started, in VS Code: the page (an editor tab, opened once by itself
 * at the first start after an install and from **Protoboard: Get Started**),
 * the Start view of a window with no project, **Protoboard: Open the
 * Quadcopter Example**, and the theme tiles. The pages are startPage.ts; this
 * gathers what they show and does what their buttons ask, through the
 * extension's own commands (signing in, connecting agents, a new project are
 * not done here).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { AgentState } from "@protoboardai/core/agents";
import { EXAMPLE, copyExample, exampleParts, exampleSource, exampleTarget, hasExample, type PreviewPart } from "./example.js";
import { nonce } from "./html.js";
import { START_TITLE, shouldOpenStart, startHtml, startSteps, startViewHtml, themeClick, type StartModel, type StartViewModel, type ThemeChoice } from "./startPage.js";
import { PROTOBOARD_THEMES, THEME_OFFERED_KEY } from "./themes.js";

export const START_VIEW = "protoboard.start.home";
export const START_PANEL = "protoboard.start";
/** The page was opened (by itself or asked for): it does not open by itself again. */
export const START_SHOWN_KEY = "protoboard.start.shown";
/** The example was copied and opened from here. */
export const EXAMPLE_OPENED_KEY = "protoboard.example.opened";
/** The folders the example was copied to: one of them open is the example, not a project of the person's own. */
export const EXAMPLE_COPIES_KEY = "protoboard.example.copies";
/** The theme in use before a Protoboard theme was chosen on the page. */
export const THEME_BEFORE_KEY = "protoboard.theme.before";
/** The folder of an example opened from the page: the window that opens on it shows the page again, behind the viewer. */
export const START_RESUME_KEY = "protoboard.start.resume";
/** What an earlier version remembers in a profile that had the extension before this page existed. */
const AGENTS_OFFERED_KEY = "protoboard.agents.offered";
const EARLIER_KEYS = [THEME_OFFERED_KEY, "protoboard.inspectorGathered", AGENTS_OFFERED_KEY] as const;

export interface StartHost {
  log: vscode.LogOutputChannel;
  guard(fn: () => unknown): Promise<unknown>;
  account(): { signedIn: boolean; email?: string };
  agents(): AgentState[];
  /** The `protoboard` command is on the user's PATH already. */
  onPath(): boolean;
  /** The folders of the projects found in this window. */
  projects(): string[];
  /** A project copied from the carried example: it is the user's, so it is trusted, set up (no npm) and opened. */
  adopt(dir: string, open: boolean): Promise<void>;
}

export interface OpenExampleArgs {
  /** The folder the copy goes into (asked when missing). */
  folder?: string;
  /** `false`: copy and set up, do not open it. */
  open?: boolean;
}

export class StartController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  private readonly subs: vscode.Disposable[] = [];
  private parts: PreviewPart[] | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: StartHost,
  ) {
    this.subs.push(
      vscode.commands.registerCommand("protoboard.start", () => this.open()),
      vscode.commands.registerCommand("protoboard.openExample", (given?: OpenExampleArgs) => this.host.guard(() => this.openExample(given))),
      vscode.window.registerWebviewViewProvider(START_VIEW, { resolveWebviewView: (v) => this.resolveView(v) }),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("workbench.colorTheme") && this.refresh()),
      // an agent connected from a terminal, a sign-in made elsewhere: seen when the window is used again
      vscode.window.onDidChangeWindowState((w) => w.focused && this.refresh()),
    );
  }

  dispose() {
    for (const s of this.subs.splice(0)) s.dispose();
    this.panel?.dispose();
  }

  // ---- what the pages show

  private themeChoices(): ThemeChoice[] {
    return [PROTOBOARD_THEMES.dark, PROTOBOARD_THEMES.light].map((id) => {
      let c: Record<string, string> = {};
      try {
        const file = join(this.context.extensionPath, "themes", `${id.toLowerCase().replace(/ /g, "-")}-color-theme.json`);
        c = (JSON.parse(readFileSync(file, "utf8")) as { colors?: Record<string, string> }).colors ?? {};
      } catch {
        // a theme file that cannot be read still gets a tile, in plain colours
      }
      const dark = id === PROTOBOARD_THEMES.dark;
      return {
        id,
        swatch: {
          editor: c["editor.background"] ?? (dark ? "#1a1a1a" : "#f0f0f0"),
          side: c["sideBar.background"] ?? (dark ? "#1f1f1f" : "#eaeaea"),
          bar: c["statusBar.background"] ?? "#ff5c00",
          line: dark ? "#3a3a3a" : "#c8c8c8",
        },
      };
    });
  }

  /** This workspace sets its own theme: a tile changes that value, not the user's. */
  private themeInWorkspace(): boolean {
    return vscode.workspace.getConfiguration("workbench").inspect<string>("colorTheme")?.workspaceValue !== undefined;
  }

  /** Where the theme to go back to is kept: with the setting a tile changes, so one workspace's does not replace another's or the user's. */
  private themeState(): vscode.Memento {
    return this.themeInWorkspace() ? this.context.workspaceState : this.context.globalState;
  }

  private currentTheme(): string {
    return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") ?? "";
  }

  private exampleModel(): StartModel["example"] {
    return { carried: hasExample(this.context.extensionPath), title: EXAMPLE.title, text: EXAMPLE.text };
  }

  /** The projects of this window that are not copies of the example: a copy is not a project of the person's own. */
  private ownProjects(): string[] {
    const copies = this.context.globalState.get<string[]>(EXAMPLE_COPIES_KEY) ?? [];
    return this.host.projects().filter((root) => !copies.includes(root));
  }

  model(): StartModel {
    const agents = this.host.agents().filter((a) => a.detected || a.status === "connected");
    const name = (a: AgentState) => a.name.replace(/ \(.*\)$/, "");
    const base = {
      account: this.host.account(),
      agents: {
        waiting: agents.filter((a) => a.status !== "connected").map(name),
        connected: agents.filter((a) => a.status === "connected").map(name),
        onPath: this.host.onPath(),
      },
      example: this.exampleModel(),
      theme: { choices: this.themeChoices(), current: this.currentTheme(), ...(this.themeState().get<string>(THEME_BEFORE_KEY) ? { previous: this.themeState().get<string>(THEME_BEFORE_KEY)! } : {}) },
      hasProject: this.ownProjects().length > 0,
    };
    return { ...base, steps: startSteps({ ...base, exampleOpened: !!this.context.globalState.get(EXAMPLE_OPENED_KEY) }) };
  }

  viewModel(): StartViewModel {
    this.parts ??= exampleParts(exampleSource(this.context.extensionPath));
    return { account: this.host.account(), example: this.exampleModel(), parts: this.parts };
  }

  /** Something the pages show changed (the account, an agent, a project, the theme). */
  refresh() {
    if (this.panel) void this.panel.webview.postMessage({ type: "model", model: this.model() });
    if (this.view) void this.view.webview.postMessage({ type: "model", model: this.viewModel() });
  }

  // ---- the pages

  private env(webview: vscode.Webview) {
    return { cspSource: webview.cspSource, nonce: nonce(), picture: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "start", "quadcopter.png")).toString() };
  }

  private options(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media", "start")] };
  }

  /** **Protoboard: Get Started**. `background`: opened without taking the focus (what opens next stays in front). */
  open(background = false): void {
    void this.context.globalState.update(START_SHOWN_KEY, true);
    if (this.panel) return this.panel.reveal(undefined, background);
    const panel = vscode.window.createWebviewPanel(START_PANEL, START_TITLE, { viewColumn: vscode.ViewColumn.Active, preserveFocus: background }, { ...this.options(), retainContextWhenHidden: true });
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "protoboard.svg");
    panel.webview.html = startHtml(this.env(panel.webview), this.model());
    panel.webview.onDidReceiveMessage((m) => this.message(m));
    panel.onDidChangeViewState(() => panel.visible && this.refresh());
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
    });
  }

  /** Whether the page is open (the tests read it). */
  get shown(): boolean {
    return !!this.panel;
  }

  /**
   * The first start after an install: the page opens by itself, once. A
   * profile that used the extension on a project before the page existed is
   * marked as shown without opening it; one that only installed it has no
   * mark of use, and is shown the page once, which is who the page is for. It replaces the one-off theme offer, which the page's
   * theme step is.
   */
  async auto(): Promise<"opened" | "not-opened"> {
    const state = this.context.globalState;
    const facts = {
      shown: !!state.get(START_SHOWN_KEY),
      hadBefore: EARLIER_KEYS.some((k) => state.get(k) !== undefined),
      test: this.context.extensionMode === vscode.ExtensionMode.Test && !process.env.PROTOBOARD_TEST_START,
      trusted: vscode.workspace.isTrusted,
    };
    // the example was opened from the page, and this is the window it opened in: the page is here too, for its next steps
    const resume = state.get<string>(START_RESUME_KEY);
    if (resume && facts.trusted && (vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.fsPath === resume)) {
      await state.update(START_RESUME_KEY, undefined);
      this.open(true);
      return "opened";
    }
    if (!shouldOpenStart(facts)) {
      if (!facts.shown && facts.hadBefore) await state.update(START_SHOWN_KEY, true);
      return "not-opened";
    }
    // the page is the offer of the themes and of the agents: neither is also asked in a notification
    await state.update(THEME_OFFERED_KEY, true);
    if (state.get(AGENTS_OFFERED_KEY) === undefined) await state.update(AGENTS_OFFERED_KEY, new Date().toISOString());
    this.open();
    return "opened";
  }

  private resolveView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = this.options();
    view.webview.html = startViewHtml(this.env(view.webview), this.viewModel());
    view.webview.onDidReceiveMessage((m) => this.message(m));
    view.onDidChangeVisibility(() => view.visible && this.refresh());
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  private message(m: { type?: unknown; action?: unknown; value?: unknown }) {
    if (m?.type !== "start" || typeof m.action !== "string") return;
    // a command may end long after what it changed (its last notification waits to be closed): the pages follow meanwhile
    const run = (command: string, ...args: unknown[]) => this.host.guard(async () => {
      const follow = setInterval(() => this.refresh(), 1500);
      try {
        await vscode.commands.executeCommand(command, ...args);
      } finally {
        clearInterval(follow);
        this.refresh();
      }
    });
    switch (m.action) {
      case "ready":
        return this.refresh();
      case "signIn":
        return void run("protoboard.signIn");
      case "connectAgents":
        return void run("protoboard.agents.connect");
      case "addToPath":
        return void run("protoboard.path.add");
      case "newProject":
        return void run("protoboard.newProject");
      case "openExample":
        return void run("protoboard.openExample");
      case "openStart":
        return this.open();
      case "theme":
        return void this.host.guard(() => this.chooseTheme(String(m.value ?? "")));
    }
  }

  // ---- the theme tiles

  /** A click on a theme tile: apply it, or (the applied one) put back the theme in use before. */
  async chooseTheme(clicked: string): Promise<string | undefined> {
    const choices = this.themeChoices();
    const current = this.currentTheme();
    const state = this.themeState();
    const fallback = clicked === PROTOBOARD_THEMES.light ? "Default Light Modern" : "Default Dark Modern";
    const change = themeClick(clicked, current, state.get<string>(THEME_BEFORE_KEY), choices, fallback);
    await state.update(THEME_BEFORE_KEY, change.previous);
    if (change.set !== undefined) {
      // a workspace that sets its own theme wins over the user's setting: the theme is changed where it is in effect
      await vscode.workspace.getConfiguration("workbench").update("colorTheme", change.set, this.themeInWorkspace() ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    }
    this.refresh();
    return change.set;
  }

  // ---- the example

  /**
   * **Protoboard: Open the Quadcopter Example**: a copy of the example the
   * extension carries, in a folder the user chooses, set up and opened. It
   * needs no account and no npm: the example holds its own parts.
   */
  async openExample(given: OpenExampleArgs = {}): Promise<string | undefined> {
    const source = exampleSource(this.context.extensionPath);
    if (!hasExample(this.context.extensionPath)) {
      void vscode.window.showInformationMessage("Protoboard: this build of the extension does not carry the example.");
      return undefined;
    }
    let parent = given.folder;
    if (!parent) {
      const home = homedir();
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(home),
        openLabel: "Copy Example Here",
        title: "Where to copy the quadcopter example",
      });
      if (!picked?.[0]) return undefined;
      parent = picked[0].fsPath;
    }
    if (!existsSync(parent)) throw new Error(`${parent} does not exist: choose a folder the example can be copied into`);
    const target = exampleTarget(parent);
    const copied = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Protoboard: copying the ${EXAMPLE.title} example to ${target}` }, () => copyExample(source, target));
    this.host.log.info(`the example: ${copied.files} files (${(copied.bytes / 1e6).toFixed(1)} MB) copied to ${copied.dir}`);
    await this.context.globalState.update(EXAMPLE_OPENED_KEY, true);
    await this.context.globalState.update(EXAMPLE_COPIES_KEY, [...(this.context.globalState.get<string[]>(EXAMPLE_COPIES_KEY) ?? []), copied.dir].slice(-20));
    if (this.panel && given.open !== false) await this.context.globalState.update(START_RESUME_KEY, copied.dir);
    this.refresh();
    await this.host.adopt(copied.dir, given.open !== false);
    return copied.dir;
  }
}

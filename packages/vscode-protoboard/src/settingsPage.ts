/**
 * The Protoboard settings page and the first-run offer to connect agents
 * (PB-930, docs/specs/agents-and-mcp.md §6). The page is @protoboardai/views'
 * SettingsPage in the extension's React webviews (appPage.ts), in an editor
 * tab; this file computes its model and does what its buttons ask.
 *
 * An agent's configuration is changed only by a Connect or Disconnect click
 * on that agent's row, or by the user checking that agent in the offer's
 * pick list. Looking never writes.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { agentMachine, listAgents, removeAgent, setupAgent, type AgentMachine, type AgentState } from "@protoboardai/core/agents";
import { launcherDir, type LauncherPlace } from "@protoboardai/core/agent-launcher";
import type { AccountModel, AgentRowModel, SettingsLinkModel, SettingsModel } from "@protoboardai/views/parts-model";
import { changeText, cliEntry, cliToRecord, launcherCommand, machineCli, offerText, offerable, recordCli, settingsModel, shouldOffer } from "./agents.js";
import { showApp, tabIcon } from "./appView.js";
import { runCli, type CliSettings } from "./cli.js";

/** Page → extension. */
export type SettingsPageMessage =
  | { type: "ready" }
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "manageAccount" }
  | { type: "connect"; id: string }
  | { type: "disconnect"; id: string }
  | { type: "refresh" }
  | { type: "openFile"; id: string }
  | { type: "copy"; text: string; what: string }
  | { type: "openVsCodeSettings" }
  | { type: "openLibraries" }
  | { type: "showLog" }
  | { type: "run"; id: string };

/** A row of the page that runs a command of the extension (what the other parts of it offer). */
export interface SettingsLink extends SettingsLinkModel {
  command: string;
  args?: unknown[];
}

export interface SettingsHost {
  log: vscode.LogOutputChannel;
  version: string;
  account(): AccountModel;
  signIn(): unknown;
  signOut(): unknown;
  /** Open the account page in the browser (PB-1089). */
  manageAccount(): unknown;
  /** The current project, when one is open. */
  project(): string | undefined;
  /**
   * `protoboard.cliPath` and the runtime the CLI runs with, for a folder.
   * `nodeFile` is that runtime's full path; `electron` says it is the
   * editor's own, which runs as Node only with ELECTRON_RUN_AS_NODE (PB-929).
   */
  cliSettings(folder: string): CliSettings & { nodeFile?: string; electron?: boolean };
  openLibraries(): unknown;
  /** What else is reached from the page, for the window as it is now (a project open or not, a stack carried or not). */
  links?(): SettingsLink[];
  guard(fn: () => unknown): Promise<unknown>;
}

/** Remembered in the extension's global state: the offer was shown (when). */
export const OFFERED_KEY = "protoboard.agents.offered";

export class SettingsController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private states: AgentState[] | undefined;
  private problem: string | undefined;
  private notes: Record<string, { text: string; tone: NonNullable<AgentRowModel["detailTone"]> }> = {};
  private readonly working = new Set<string>();
  private machine: AgentMachine = agentMachine();
  private place: LauncherPlace = {};
  /** The page's React app has drawn. */
  drawn = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: SettingsHost,
  ) {}

  dispose() {
    this.panel?.dispose();
  }

  /** For the integration test: another home folder, so no real agent's configuration is read or written. */
  useHome(home: string) {
    this.machine = agentMachine({ home, env: { HOME: home, PATH: "" }, which: () => undefined });
    this.place = { env: { HOME: home } };
    this.states = undefined;
    this.notes = {};
  }

  private folder(): string {
    return this.host.project() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
  }

  /** The entry an agent's configuration gets on this machine. */
  private command() {
    return launcherCommand(this.place);
  }

  /** Look for the agents and read their state. Reads only. */
  look(): AgentState[] {
    try {
      this.states = listAgents({ command: this.command() }, this.machine);
      this.problem = undefined;
    } catch (e) {
      this.states = undefined;
      this.problem = (e as Error).message;
    }
    return this.states ?? [];
  }

  model(): SettingsModel {
    const folder = this.folder();
    const settings = this.host.cliSettings(folder);
    const found = machineCli(folder, settings);
    return settingsModel({
      links: (this.host.links?.() ?? []).map(({ command: _command, args: _args, ...l }) => l),
      account: this.host.account(),
      version: this.host.version,
      cli: { command: found.cli, ...(found.origin ? { origin: found.origin } : {}) },
      ...(this.states ? { agents: this.states } : {}),
      ...(this.problem ? { agentsProblem: this.problem } : {}),
      command: this.command(),
      home: this.machine.home,
      notes: this.notes,
      working: this.working,
    });
  }

  /** **Protoboard: Open Settings**. */
  open() {
    if (this.panel) return this.panel.reveal(undefined, false);
    const panel = vscode.window.createWebviewPanel("protoboard.settings", "Protoboard Settings", { viewColumn: vscode.ViewColumn.Active }, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = tabIcon(this.context.extensionUri, "settings");
    showApp(panel.webview, this.context.extensionUri, "settings", "Protoboard Settings");
    panel.webview.onDidReceiveMessage((m: SettingsPageMessage) => void this.host.guard(() => this.receive(m)));
    panel.onDidChangeViewState(() => {
      if (!panel.visible) return;
      // an agent installed or configured elsewhere since the page was last looked at
      this.look();
      this.post();
    });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.drawn = false;
    });
    this.panel = panel;
    this.look();
  }

  /** The account changed: the page's card follows. */
  accountChanged() {
    this.post();
  }

  private post() {
    if (this.panel?.visible) void this.panel.webview.postMessage({ type: "model", model: this.model() });
  }

  private receive(m: SettingsPageMessage): unknown {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready":
        this.drawn = true;
        return this.post();
      case "signIn":
        return this.host.signIn();
      case "signOut":
        return this.host.signOut();
      case "manageAccount":
        return this.host.manageAccount();
      case "connect":
        return this.connect(m.id);
      case "disconnect":
        return this.disconnect(m.id);
      case "refresh":
        this.notes = {};
        this.look();
        return this.post();
      case "openFile":
        return this.openFile(m.id);
      case "copy":
        // an entry taken by hand starts the launcher too: it is written now (Protoboard's own folder; no agent's file)
        return this.ensureLauncher()
          .catch((e: Error) => this.host.log.warn(`agents: the launcher was not written for the copied ${m.what}: ${e.message}`))
          .then(() => vscode.env.clipboard.writeText(m.text))
          .then(() => vscode.window.setStatusBarMessage(`Protoboard: copied the ${m.what}`, 3000));
      case "openVsCodeSettings":
        return vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${this.context.extension.id}`);
      case "openLibraries":
        return this.host.openLibraries();
      case "showLog":
        return this.host.log.show();
      case "run": {
        // only what the host listed: the page names a row, never a command
        const link = this.host.links?.().find((l) => l.id === m.id);
        return link ? vscode.commands.executeCommand(link.command, ...(link.args ?? [])) : undefined;
      }
    }
  }

  /**
   * The launcher an entry points at, written or brought up to date, with the
   * CLI recorded: in process for a CLI that is a script (the project's, the
   * carried one, a `cliPath` file), else by the `protoboard` on PATH itself.
   */
  private async ensureLauncher(): Promise<void> {
    const folder = this.folder();
    const settings = this.host.cliSettings(folder);
    // the stack the extension carries is unpacked at its first use (PB-929): before its CLI is looked for
    await settings.carried?.prepare?.();
    const found = machineCli(folder, settings);
    const entry = cliEntry(found.cli);
    if (entry && existsSync(entry)) {
      const state = recordCli(entry, found.origin ?? "npm", settings.nodeFile, this.place, settings.electron);
      if (state.written.length) this.host.log.info(`agents: wrote ${state.written.join(", ")} in ${state.dir}; the launcher starts ${entry}`);
      return;
    }
    const failed = new Error("the Protoboard CLI was not found, so there is nothing for an agent to start: this build of the extension carries no stack. Open a Protoboard project (its CLI is used), install the Protoboard extension that carries the stack, or set protoboard.cliPath");
    let r;
    try {
      r = await runCli(found.cli, ["agents", "refresh", "--format", "json"], { cwd: folder, env: { ...process.env, ...(this.place.env ?? {}) } });
    } catch {
      throw failed;
    }
    if (r.code !== 0) throw failed;
    this.host.log.info(`agents: the launcher in ${launcherDir(this.place)} was written by the protoboard command on PATH`);
  }

  /**
   * On activation, in any window (a project open or not): when a launcher is
   * already there, record the CLI this extension now has (an update moved
   * it). Never creates one.
   */
  async refreshLauncher(): Promise<void> {
    if (!existsSync(join(launcherDir(this.place), "launcher.json"))) return;
    try {
      const found = cliToRecord(this.folder(), this.machine.home || homedir(), (folder) => this.host.cliSettings(folder));
      if (!found) return;
      const state = recordCli(found.entry, found.origin, found.settings.nodeFile, this.place, found.settings.electron);
      if (state.written.length) this.host.log.info(`agents: the launcher now starts ${found.entry} (wrote ${state.written.join(", ")} in ${state.dir})`);
    } catch (e) {
      this.host.log.warn(`agents: the launcher was not refreshed: ${(e as Error).message}`);
    }
  }

  /** Connect one agent: the user asked for this agent. Says what was written where. */
  async connect(id: string): Promise<AgentState | undefined> {
    return this.change(id, () => setupAgent(id, { command: this.command() }, this.machine), true);
  }

  /** Disconnect one agent: only Protoboard's entry goes. */
  async disconnect(id: string): Promise<AgentState | undefined> {
    return this.change(id, () => removeAgent(id, {}, this.machine), false);
  }

  private async change(id: string, run: () => ReturnType<typeof setupAgent>, launcher: boolean): Promise<AgentState | undefined> {
    this.working.add(id);
    delete this.notes[id];
    this.post();
    try {
      if (launcher) await this.ensureLauncher();
      const c = run();
      const text = changeText(c, this.machine.home);
      this.notes[id] = { text, tone: c.action === "removed" || c.action === "absent" ? "neutral" : "ok" };
      this.host.log.info(`agents: ${c.name}: ${c.action} (${c.method}) ${c.file}${c.backup ? `; backup ${c.backup}` : ""}`);
    } catch (e) {
      const message = (e as Error).message;
      this.notes[id] = { text: message.charAt(0).toUpperCase() + message.slice(1), tone: "error" };
      this.host.log.error(`agents: ${id}: ${message}`);
    } finally {
      this.working.delete(id);
    }
    this.look();
    this.post();
    return this.states?.find((a) => a.id === id);
  }

  private async openFile(id: string) {
    const a = (this.states ?? this.look()).find((x) => x.id === id);
    if (!a) return;
    if (!existsSync(a.file)) return void vscode.window.showInformationMessage(`Protoboard: ${a.name} has no configuration file yet. Connect creates it.`);
    await vscode.window.showTextDocument(vscode.Uri.file(a.file), { preview: true });
  }

  /**
   * The first-run offer: once, after the first sign-in or the first project,
   * when an agent found here is not connected. Showing it is remembered, so
   * "Not now" and closing it are both respected.
   */
  async offer(options: { force?: boolean } = {}): Promise<"shown" | "not-shown"> {
    const enabled = vscode.workspace.getConfiguration("protoboard").get<boolean>("agents.offerSetup", true);
    const offered = !!this.context.globalState.get(OFFERED_KEY);
    const agents = this.look();
    if (!options.force && !shouldOffer({ enabled, offered, occasion: true, agents })) return "not-shown";
    if (!offerable(agents).length) return "not-shown";
    await this.context.globalState.update(OFFERED_KEY, new Date().toISOString());
    void vscode.window.showInformationMessage(offerText(agents), "Connect…", "Open Settings", "Not now").then((pick) =>
      this.host.guard(() => {
        if (pick === "Connect…") return this.connectPicked();
        if (pick === "Open Settings") return this.open();
      }),
    );
    return "shown";
  }

  /** **Protoboard: Connect Agents**: the agents found here, none checked; the ones the user checks are connected. */
  async connectPicked(): Promise<void> {
    const agents = offerable(this.look());
    if (!agents.length) {
      const pick = await vscode.window.showInformationMessage("Protoboard: no agents to connect.", "Open Settings");
      if (pick) this.open();
      return;
    }
    const home = this.machine.home;
    const picks = await vscode.window.showQuickPick(
      agents.map((a) => ({ label: a.name, description: a.status === "outdated" ? "update needed" : undefined, detail: a.manual ? "Runs from a terminal: copy the command in Settings" : `Adds the ${a.serverName} MCP server to ${a.file.startsWith(home) ? `~${a.file.slice(home.length)}` : a.file}`, id: a.id, picked: false })),
      { canPickMany: true, title: "Connect agents to Protoboard", placeHolder: "Agents to connect" },
    );
    if (!picks?.length) return;
    const done: string[] = [];
    const failed: string[] = [];
    for (const p of picks) {
      const after = await this.connect(p.id);
      (after?.status === "connected" ? done : failed).push(p.label);
    }
    const pick = await (failed.length
      ? vscode.window.showWarningMessage(`Protoboard: ${done.length ? `connected ${done.join(", ")}; ` : ""}could not connect ${failed.join(", ")}.`, "Open Settings")
      : vscode.window.showInformationMessage(`Protoboard: connected ${done.join(", ")}. Each picks it up in its next session.`, "Open Settings"));
    if (pick) this.open();
  }
}

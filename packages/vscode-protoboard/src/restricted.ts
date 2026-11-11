/**
 * Restricted Mode. Protoboard checks, builds and serves a project by running
 * its code, so in a folder VS Code does not trust it runs nothing: no CLI, no
 * dev server, no check, no stack unpacked, no account asked. What it does do
 * there is say so. Its views carry one line and the way out (VS Code's own
 * trust page), every Protoboard command answers the same instead of
 * "command not found", and a folder that holds a Protoboard project gets a
 * tab with the line and the button where its viewer would be: a notification
 * leaves the screen after some seconds, the tab stays. When the folder is
 * trusted, the extension starts as in any trusted window, with no reload.
 *
 * The manifest declares `untrustedWorkspaces.supported: "limited"` for this
 * and nothing more: the settings that name a program to run
 * (`protoboard.cliPath`, `protoboard.nodePath`) and the personal libraries
 * are never read from a workspace (`restrictedConfigurations`), and no
 * project code path is reachable from here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { nonce } from "./html.js";
import { RESTRICTED_LINE, RESTRICTED_TITLE, restrictedHtml } from "./startPage.js";

/** VS Code's page where a folder is trusted. */
export const TRUST_COMMAND = "workbench.trust.manage";
export const TRUST_ACTION = "Trust This Folder";

/** Commands the extension registers that the manifest does not list: ids kept for keybindings and callers of an earlier version. */
export const UNLISTED_COMMANDS = ["protoboard.init"] as const;

/** The ids of the commands the manifest contributes. */
export function contributedCommands(manifest: { contributes?: { commands?: { command: string }[] } }): string[] {
  return (manifest.contributes?.commands ?? []).map((c) => c.command);
}

/** VS Code's trust page stays open over the window once the folder is trusted: it has said what it had to. */
function closeTrustPage(): void {
  const tabs = (vscode.window.tabGroups?.all ?? []).flatMap((g) => g.tabs).filter((t) => t.input === undefined && t.label === "Workspace Trust");
  if (tabs.length) void vscode.window.tabGroups.close(tabs).then(undefined, () => undefined);
}

export const RESTRICTED_PANEL = "protoboard.restricted";

/**
 * The tab of a Restricted Mode window with a Protoboard project in it. It
 * runs no script and reads nothing of the folder; its one link calls VS
 * Code's trust page. Opened without taking the focus.
 */
function openRestrictedPage(context: vscode.ExtensionContext): vscode.Disposable {
  const panel = vscode.window.createWebviewPanel(RESTRICTED_PANEL, RESTRICTED_TITLE, { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, { enableScripts: false, enableCommandUris: [TRUST_COMMAND], localResourceRoots: [] });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "protoboard.svg");
  panel.webview.html = restrictedHtml({ nonce: nonce() }, TRUST_ACTION, TRUST_COMMAND);
  return panel;
}

/**
 * What runs in an untrusted window: empty views (their welcome says the
 * line), and commands that say it. `start` is called once, when the folder is
 * trusted, after these are gone.
 */
export function activateRestricted(context: vscode.ExtensionContext, views: readonly string[], start: () => void, safe: { commands: readonly string[]; register: () => vscode.Disposable[] } = { commands: [], register: () => [] }): vscode.Disposable {
  const say = () => void vscode.window.showInformationMessage(RESTRICTED_LINE, TRUST_ACTION).then((a) => a === TRUST_ACTION && vscode.commands.executeCommand(TRUST_COMMAND));
  const subs: vscode.Disposable[] = [
    // what runs no code and reads nothing of the folder stays as it is (`safe`: the links to the documentation)
    ...safe.register(),
    ...[...contributedCommands(context.extension.packageJSON as { contributes?: { commands?: { command: string }[] } }), ...UNLISTED_COMMANDS]
      .filter((id) => !safe.commands.includes(id))
      .map((id) => vscode.commands.registerCommand(id, say)),
    ...views.map((id) => vscode.window.registerTreeDataProvider(id, { getChildren: () => [], getTreeItem: (x: vscode.TreeItem) => x })),
  ];
  // a Protoboard project in the folder (the example just opened, a clone), or in a folder inside it (a repository
  // with its projects below the root, found as a trusted window finds them): said unasked, with the way out, in a
  // tab that stays until the folder is trusted or the tab is closed (a notification is gone in ten seconds). Only
  // files' names are looked at; nothing of a project is read or run.
  let done = false;
  let over = false;
  let page: vscode.Disposable | undefined;
  const show = () => {
    if (over || page) return;
    try {
      page = openRestrictedPage(context);
    } catch {
      // a window that cannot show the tab is still told
      say();
    }
  };
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
  if (folders.some((f) => existsSync(join(f.uri.fsPath, "protoboard.config.ts")))) show();
  else if (folders.length) void Promise.resolve(vscode.workspace.findFiles("**/protoboard.config.ts", "**/{node_modules,.git,.protoboard}/**", 1)).then((found) => found.length && show(), () => undefined);
  const all = vscode.Disposable.from(...subs);
  const end = () => {
    over = true;
    all.dispose();
    page?.dispose();
  };
  const granted = vscode.workspace.onDidGrantWorkspaceTrust(() => {
    if (done) return;
    done = true;
    end();
    granted.dispose();
    closeTrustPage();
    start();
  });
  const handle = new vscode.Disposable(() => {
    if (!done) end();
    granted.dispose();
  });
  context.subscriptions.push(handle);
  return handle;
}

/**
 * Restricted Mode. Protoboard checks, builds and serves a project by running
 * its code, so in a folder VS Code does not trust it runs nothing: no CLI, no
 * dev server, no check, no stack unpacked, no account asked. What it does do
 * there is say so. Its views carry one line and the way out (VS Code's own
 * trust page), and every Protoboard command answers the same instead of
 * "command not found". When the folder is trusted, the extension starts as in
 * any trusted window, with no reload.
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
import { RESTRICTED_LINE } from "./startPage.js";

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
  // a Protoboard project in the folder (the example just opened, a clone): said once, where it is seen, with the way
  // out. Only a file's name is looked at; nothing of the project is read or run.
  const project = (vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.scheme === "file" && existsSync(join(f.uri.fsPath, "protoboard.config.ts")));
  if (project) say();
  let done = false;
  const all = vscode.Disposable.from(...subs);
  const granted = vscode.workspace.onDidGrantWorkspaceTrust(() => {
    if (done) return;
    done = true;
    all.dispose();
    granted.dispose();
    closeTrustPage();
    start();
  });
  const handle = new vscode.Disposable(() => {
    if (!done) all.dispose();
    granted.dispose();
  });
  context.subscriptions.push(handle);
  return handle;
}

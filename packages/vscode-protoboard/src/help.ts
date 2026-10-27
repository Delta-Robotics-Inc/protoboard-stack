/**
 * Documentation, feedback and Discord (PB-1070): project-level links, so not
 * in a viewer tab's header or its side. They live in the Protoboard Cloud
 * side bar as a small view of their own (Help and Feedback), whatever the
 * window's height, in the command palette, and in the Protoboard status bar
 * item's tooltip.
 */
import * as vscode from "vscode";

export interface HelpLink {
  /** The command that opens it: `protoboard.help.<id>`. */
  id: "docs" | "feedback" | "discord";
  label: string;
  /** A codicon. */
  icon: string;
  url: string;
}

export const HELP_LINKS: readonly HelpLink[] = [
  { id: "docs", label: "Documentation", icon: "book", url: "https://github.com/Delta-Robotics-Inc/protoboard-stack#documentation" },
  { id: "feedback", label: "Feedback and Issues", icon: "feedback", url: "https://github.com/Delta-Robotics-Inc/protoboard-stack/issues/new/choose" },
  { id: "discord", label: "Discord", icon: "comment-discussion", url: "https://discord.gg/Xh37xeNMAJ" },
];

export const HELP_VIEW = "protoboard.help";

export const helpCommand = (l: HelpLink) => `protoboard.help.${l.id}`;

/** The Help and Feedback view's rows: one per link, a click opens it. */
export function helpItems(): vscode.TreeItem[] {
  return HELP_LINKS.map((l) => {
    const item = new vscode.TreeItem(l.label);
    item.id = l.id;
    item.iconPath = new vscode.ThemeIcon(l.icon);
    item.tooltip = l.url;
    item.command = { command: helpCommand(l), title: l.label };
    return item;
  });
}

/** The view and the three commands. */
export function registerHelp(): vscode.Disposable[] {
  return [
    vscode.window.registerTreeDataProvider<vscode.TreeItem>(HELP_VIEW, { getChildren: (e) => (e ? [] : helpItems()), getTreeItem: (x) => x }),
    ...HELP_LINKS.map((l) => vscode.commands.registerCommand(helpCommand(l), () => vscode.env.openExternal(vscode.Uri.parse(l.url)))),
  ];
}

/** The links as one Markdown line, for a tooltip whose Markdown trusts these commands (`helpCommands`). */
export const helpMarkdown = (): string => HELP_LINKS.map((l) => `[$(${l.icon}) ${l.label}](command:${helpCommand(l)})`).join(" · ");

export const helpCommands = (): string[] => HELP_LINKS.map(helpCommand);

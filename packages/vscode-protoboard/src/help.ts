/**
 * Documentation, feedback and Discord (PB-1070): project-level links, so not
 * in a viewer tab's header or its side. They live in the Protoboard Cloud
 * side bar as a small view of their own (Help), whatever the
 * window's height, in the command palette, and in the Protoboard status bar
 * item's tooltip.
 *
 * The view also has one row for local crash and performance data (PB-1181):
 * whether Protoboard records it on this machine (`protoboard.telemetry.local`
 * and VS Code's own telemetry setting, ./telemetry.ts) and, on a click, what
 * is stored and where; nothing is ever sent from here.
 */
import * as vscode from "vscode";
import { TELEMETRY_COMMAND, extensionTelemetryMode, registerTelemetry, telemetryLabel, telemetryStatusText } from "./telemetry.js";

export interface HelpLink {
  /** The command that opens it: `protoboard.help.<id>`. */
  id: "docs" | "feedback" | "discord";
  label: string;
  /** A codicon, or an icon this extension contributes (package.json `icons`: Discord's mark). */
  icon: string;
  url: string;
}

export const HELP_LINKS: readonly HelpLink[] = [
  { id: "docs", label: "Documentation", icon: "book", url: "https://github.com/Delta-Robotics-Inc/protoboard-stack#documentation" },
  { id: "feedback", label: "Feedback and Issues", icon: "feedback", url: "https://github.com/Delta-Robotics-Inc/protoboard-stack/issues/new/choose" },
  { id: "discord", label: "Discord", icon: "protoboard-discord", url: "https://discord.gg/Xh37xeNMAJ" },
];

export const HELP_VIEW = "protoboard.help";

export const helpCommand = (l: HelpLink) => `protoboard.help.${l.id}`;

/** Get Started (start.ts): the page of a first install, kept within reach. */
export const START_COMMAND = "protoboard.start";

/** The Help view's rows: Get Started, then one per link, a click opens it; then the local telemetry row (`mode`: as recording is now). */
export function helpItems(mode: ReturnType<typeof extensionTelemetryMode> = extensionTelemetryMode()): vscode.TreeItem[] {
  const start = new vscode.TreeItem("Get Started");
  start.id = "start";
  start.iconPath = new vscode.ThemeIcon("star-empty");
  start.command = { command: START_COMMAND, title: "Get Started" };
  const links = HELP_LINKS.map((l) => {
    const item = new vscode.TreeItem(l.label);
    item.id = l.id;
    item.iconPath = new vscode.ThemeIcon(l.icon);
    item.tooltip = l.url;
    item.command = { command: helpCommand(l), title: l.label };
    return item;
  });
  const telemetry = new vscode.TreeItem(telemetryLabel(mode.mode));
  telemetry.id = "telemetry";
  telemetry.iconPath = new vscode.ThemeIcon(mode.mode === "off" ? "circle-slash" : "pulse");
  telemetry.tooltip = telemetryStatusText(mode);
  telemetry.command = { command: TELEMETRY_COMMAND, title: telemetryLabel(mode.mode) };
  return [start, ...links, telemetry];
}

/** The view, the three link commands and the telemetry status command; the telemetry row follows its settings. */
export function registerHelp(): vscode.Disposable[] {
  const changed = new vscode.EventEmitter<void>();
  return [
    changed,
    vscode.window.registerTreeDataProvider<vscode.TreeItem>(HELP_VIEW, { onDidChangeTreeData: changed.event, getChildren: (e) => (e ? [] : helpItems()), getTreeItem: (x) => x }),
    ...HELP_LINKS.map((l) => vscode.commands.registerCommand(helpCommand(l), () => vscode.env.openExternal(vscode.Uri.parse(l.url)))),
    ...registerTelemetry(() => changed.fire()),
  ];
}

/** The links as one Markdown line, for a tooltip whose Markdown trusts these commands (`helpCommands`). */
export const helpMarkdown = (): string => HELP_LINKS.map((l) => `[$(${l.icon}) ${l.label}](command:${helpCommand(l)})`).join(" · ");

/** The commands registerHelp registers: the links and the telemetry status (Restricted Mode keeps them, restricted.ts). */
export const helpCommands = (): string[] => [...HELP_LINKS.map(helpCommand), TELEMETRY_COMMAND];

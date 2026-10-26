/**
 * The Explorer view (Protoboard activity bar): the tree of tree.ts as VS Code
 * tree items, the filter, and badges. The worst finding colours the icon and
 * shows as a count (a file decoration on the node's own URI); tier and stale
 * outputs are in the description.
 */
import * as vscode from "vscode";
import { BLANK_BLOCK_TEXT } from "@protoboardai/views/part-status";
import { TIER_LABEL, filterTree, nodeMap, type ExplorerNode, type NodeKind } from "./tree.js";

const ICON: Record<NodeKind, string> = {
  system: "circuit-board",
  assembly: "package",
  group: "folder-library",
  part: "chip",
  board: "circuit-board",
  enclosure: "archive",
  structure: "layers",
  harness: "plug",
  fasteners: "wrench",
  interfaces: "symbol-interface",
  links: "link",
  interface: "debug-disconnect",
  link: "link",
};

const KIND_LABEL: Partial<Record<NodeKind, string>> = {
  system: "System",
  assembly: "Assembly",
  group: "Group",
  part: "Part",
  board: "Board (circuit)",
  enclosure: "Enclosure (cad)",
  structure: "Structure (cad)",
  harness: "Harness",
  fasteners: "Fastener stack",
};

const SEVERITY_COLOR = {
  error: "problemsErrorIcon.foreground",
  warning: "problemsWarningIcon.foreground",
  info: "problemsInfoIcon.foreground",
} as const;

/** The same severities as a row's words and badge: the list's text colours, which every theme keeps readable on its lists (the icon colours are marks, and too light for words on a light theme). */
const SEVERITY_TEXT = {
  error: "list.errorForeground",
  warning: "list.warningForeground",
  info: "problemsInfoIcon.foreground",
} as const;

export const DECORATION_SCHEME = "protoboard-node";

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.FileDecorationProvider {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  private readonly decorationsChanged = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly onDidChangeFileDecorations = this.decorationsChanged.event;

  private full: ExplorerNode[] = [];
  private shown: ExplorerNode[] = [];
  private nodes = new Map<string, ExplorerNode>();
  private expanded = new Set<string>();
  private filterText = "";

  get filter(): string {
    return this.filterText;
  }

  /** A new tree (a new build, or another project). */
  set(tree: ExplorerNode[]) {
    this.full = tree;
    this.apply();
  }

  setFilter(text: string) {
    this.filterText = text.trim();
    this.apply();
  }

  private apply() {
    const { nodes, expanded } = filterTree(this.full, this.filterText);
    this.shown = nodes;
    this.expanded = expanded;
    this.nodes = nodeMap(nodes);
    this.changed.fire(undefined);
    this.decorationsChanged.fire([...this.nodes.keys()].map(uriOf));
  }

  node(key: string): ExplorerNode | undefined {
    return this.nodes.get(key);
  }

  get roots(): ExplorerNode[] {
    return this.shown;
  }

  getChildren(element?: ExplorerNode): ExplorerNode[] {
    return element ? element.children : this.shown;
  }

  getParent(element: ExplorerNode): ExplorerNode | undefined {
    return element.parentKey ? this.nodes.get(element.parentKey) : undefined;
  }

  getTreeItem(n: ExplorerNode): vscode.TreeItem {
    const filtering = !!this.filterText;
    const state = !n.children.length
      ? vscode.TreeItemCollapsibleState.None
      : (filtering && this.expanded.has(n.key)) || n.kind === "system"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(n.label, state);
    // the id carries the filter, so expansion follows the filter rather than what was open before
    item.id = filtering ? `${n.key}\u0000${this.filterText}` : n.key;
    // a blank block says so beside its name (no part chosen yet: the tooltip says what that means)
    item.description = n.blank ? [BLANK_BLOCK_TEXT.label.toLowerCase(), n.description].filter(Boolean).join(" · ") : n.description;
    const color = n.worst && n.worst !== "info" ? new vscode.ThemeColor(SEVERITY_COLOR[n.worst]) : undefined;
    item.iconPath = new vscode.ThemeIcon(n.blank ? "circle-large-outline" : ICON[n.kind], color);
    item.resourceUri = uriOf(n.key);
    item.tooltip = tooltip(n);
    item.contextValue = [
      `pb-${n.type}`,
      n.type === "instance" || n.type === "link" ? "focus" : "",
      n.type === "instance" || n.type === "link" || n.type === "interface" ? "source" : "",
      n.hasArtifacts ? "artifacts" : "",
      n.ops.length ? "ops" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // a click selects in the viewer when it is open; it never opens it
    if (n.type === "instance" || n.type === "link") item.command = { command: "protoboard.explorer.select", title: "Select in viewer", arguments: [n] };
    return item;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== DECORATION_SCHEME) return undefined;
    const n = this.nodes.get(keyOf(uri));
    if (!n || !n.worst || n.worst === "info") return undefined;
    const own = n.counts.error + n.counts.warning;
    const d = new vscode.FileDecoration(own ? String(Math.min(own, 99)) : "•", own ? `${n.counts.error} errors, ${n.counts.warning} warnings here` : `findings below (${n.worst})`, new vscode.ThemeColor(SEVERITY_TEXT[n.worst]));
    return d;
  }

  dispose() {
    this.changed.dispose();
    this.decorationsChanged.dispose();
  }
}

const uriOf = (key: string) => vscode.Uri.from({ scheme: DECORATION_SCHEME, path: `/${encodeURIComponent(key)}` });
const keyOf = (uri: vscode.Uri) => decodeURIComponent(uri.path.slice(1));

function tooltip(n: ExplorerNode): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, false);
  md.appendMarkdown(`**${escapeMd(n.label)}**`);
  const kind = KIND_LABEL[n.kind];
  if (kind) md.appendMarkdown(` · ${kind}`);
  md.appendMarkdown("\n\n");
  if (n.type === "instance") {
    md.appendMarkdown(`\`${n.path || "(root)"}\` · \`${n.defId}\`${n.quantity && n.quantity > 1 ? ` ×${n.quantity}` : ""}\n\n`);
    if (n.blank) md.appendMarkdown(`**${BLANK_BLOCK_TEXT.label}.** ${escapeMd(BLANK_BLOCK_TEXT.meaning)}\n\n`);
    if (n.tier) md.appendMarkdown(`Tier: ${TIER_LABEL[n.tier]}\n\n`);
  } else if (n.type === "link") md.appendMarkdown(`\`${n.linkId}\`: ${escapeMd(n.description ?? "")}\n\n`);
  else if (n.type === "interface") md.appendMarkdown(`\`${n.path ? `${n.path}:` : ""}${n.interfaceId}\` ${escapeMd(n.description ?? "")}\n\n`);
  const own = n.counts;
  if (own.error + own.warning + own.info) md.appendMarkdown(`Findings: ${own.error} errors, ${own.warning} warnings, ${own.info} info\n\n`);
  else if (n.worst) md.appendMarkdown(`Findings below (worst: ${n.worst})\n\n`);
  if (n.stale) md.appendMarkdown("Generated outputs are stale: run the capability's `generate`/`export` again.\n\n");
  if (n.ops.length) md.appendMarkdown(`Operations: ${n.ops.map((o) => `\`${o}\``).join(", ")}`);
  return md;
}

const escapeMd = (s: string) => s.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, "\\$1");

/** The Library and Cloud views until their stage fills them: empty, so their welcome text shows. */
export class EmptyProvider implements vscode.TreeDataProvider<never> {
  getChildren(): never[] {
    return [];
  }
  getTreeItem(e: never): vscode.TreeItem {
    return e;
  }
}

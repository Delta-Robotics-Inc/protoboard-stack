/**
 * The DRC view in the panel area: a webview that draws drc.ts's model with
 * @protoboardai/views' DrcPanel (the extension's React page, appPage.ts) and
 * sends back the query and the row actions (Locate, Open source, Explain).
 * Its findings are the Problems panel's too: the extension puts every one on
 * its source line there (check.ts).
 */
import * as vscode from "vscode";
import { DEFAULT_QUERY, drcModel, pageModel, parseQuery, type DrcQuery, type Finding } from "./drc.js";
import { showApp } from "./appView.js";
import type { CheckRun } from "./check.js";

/** Page → extension. */
export type DrcPageMessage =
  | { type: "ready" }
  | { type: "query"; query: { groupBy?: string; text?: string; severity?: string; info?: boolean } }
  | { type: "locate" | "openSource" | "explain" | "fix"; key: string }
  | { type: "refresh" }
  | { type: "drawn"; lanes?: number; findings?: number; scrolls?: boolean; width?: number; height?: number };

export interface DrcContent {
  project: string;
  state: "idle" | "running" | "failed";
  /** When the findings were produced. */
  at?: Date;
  findings?: Finding[];
  links?: number;
  checks?: CheckRun[];
}

export interface DrcActions {
  locate(f: Finding): unknown;
  openSource(f: Finding): unknown;
  explain(f: Finding): unknown;
  /** The row's fix (B6: Fetch Parts). */
  fix(f: Finding): unknown;
  refresh(): unknown;
}

export class DrcViewProvider implements vscode.WebviewViewProvider {
  static readonly id = "protoboard.drc";
  private view: vscode.WebviewView | undefined;
  private content: DrcContent | undefined;
  private query: DrcQuery;
  /** What the page last said it drew (tests read it). */
  drawn: { lanes: number; findings: number; scrolls: boolean; width: number; height: number } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: vscode.Memento,
    private readonly actions: DrcActions,
  ) {
    this.query = parseQuery(state.get<Partial<DrcQuery>>("protoboard.drc.query"), DEFAULT_QUERY);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    showApp(view.webview, this.extensionUri, "drc", "DRC");
    view.webview.onDidReceiveMessage((m: DrcPageMessage) => this.receive(m));
    view.onDidChangeVisibility(() => view.visible && this.post());
    view.onDidDispose(() => (this.view = undefined));
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  /** New findings, or a new state of the check. */
  show(content: DrcContent | undefined) {
    this.content = content;
    this.updateBadge();
    this.post();
  }

  private updateBadge() {
    if (!this.view) return;
    const f = this.content?.findings;
    const blocking = f?.filter((x) => x.severity === "error").length ?? 0;
    const warnings = f?.filter((x) => x.severity === "warning").length ?? 0;
    this.view.badge = blocking + warnings ? { value: blocking + warnings, tooltip: `${blocking} blocking, ${warnings} warnings` } : undefined;
    this.view.description = this.content?.project;
  }

  /** What the page draws (tests read it). */
  pageState() {
    const c = this.content;
    return {
      state: c ? c.state : ("none" as const),
      project: c?.project ?? "",
      at: c?.at?.toLocaleTimeString(),
      query: this.query,
      model: c?.findings ? pageModel(drcModel(c.findings, this.query, { links: c.links, checks: c.checks })) : undefined,
    };
  }

  private post() {
    if (!this.view?.visible) return;
    this.updateBadge();
    const c = this.content;
    void this.view.webview.postMessage({ type: "model", model: this.pageState() });
  }

  /** Ask the page to say again what it drew, and its size (the integration test). */
  probe() {
    this.drawn = undefined;
    void this.view?.webview.postMessage({ type: "probe" });
  }

  private receive(m: DrcPageMessage) {
    const find = (key: string) => this.content?.findings?.find((f) => f.key === key);
    switch (m?.type) {
      case "ready":
        return this.post();
      case "query":
        this.query = parseQuery(m.query, this.query);
        void this.state.update("protoboard.drc.query", this.query);
        return this.post();
      case "refresh":
        return void this.actions.refresh();
      case "drawn":
        this.drawn = { lanes: Number(m.lanes) || 0, findings: Number(m.findings) || 0, scrolls: !!m.scrolls, width: Number(m.width) || 0, height: Number(m.height) || 0 };
        return;
      case "locate":
      case "openSource":
      case "explain":
      case "fix": {
        const f = find(m.key);
        if (f) void this.actions[m.type](f);
        return;
      }
    }
  }
}

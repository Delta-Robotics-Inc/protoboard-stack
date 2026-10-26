/**
 * The Cloud view, in its own container (PB-902: not stacked with the
 * Library): @protoboardai/views' CloudPanel in a webview, drawing the model
 * cloud.ts computes, and sending back the actions (cloudPage.ts).
 */
import * as vscode from "vscode";
import { showApp } from "./appView.js";
import type { CloudPageMessage, CloudPageModel } from "./cloudPage.js";

export type CloudActions = { [K in Exclude<CloudPageMessage["type"], "ready">]: (m: Extract<CloudPageMessage, { type: K }>) => unknown };

export class CloudViewProvider implements vscode.WebviewViewProvider {
  static readonly id = "protoboard.cloud";
  private view: vscode.WebviewView | undefined;
  private model: CloudPageModel | undefined;
  /** The panel's React app has drawn. */
  drawn = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: CloudActions,
    /** Asked for a fresh model when the view becomes visible. */
    private readonly refresh: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    showApp(view.webview, this.extensionUri, "cloud", "Cloud");
    view.webview.onDidReceiveMessage((m: CloudPageMessage) => this.receive(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
    view.onDidDispose(() => (this.view = undefined));
    this.refresh();
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  show(model: CloudPageModel | undefined) {
    this.model = model;
    if (this.view) this.view.description = model?.project;
    this.post();
  }

  private post() {
    if (this.view?.visible && this.model) void this.view.webview.postMessage({ type: "model", model: this.model.view });
  }

  private receive(m: CloudPageMessage) {
    if (!m || typeof m.type !== "string") return;
    if (m.type === "ready") {
      this.drawn = true;
      return this.post();
    }
    const fn = this.actions[m.type] as ((m: CloudPageMessage) => unknown) | undefined;
    if (fn) void fn(m);
  }
}

/**
 * The CAD viewer (PB-906): STEP and GLB files open in an editor tab of
 * VS Code, not in the system's default application. The tab is a read-only
 * custom editor whose webview draws the model with the 3D view's own scene,
 * lights and materials (uhd-viewer's ModelView) in the VS Code theme.
 *
 * A GLB is drawn as it is. A STEP the build exported together with a GLB
 * (the stack writes `body.step` and `body.glb`, `board.step` and `board.glb`
 * from the same model) is drawn from that GLB when it is as new;
 * any other STEP is converted in the webview (occt-import-js, bundled with
 * the extension). Kept apart from the rest of the extension so the shell
 * owns registration order and this file only adds the editor.
 *
 * Local work: a tab draws its file with no account (PB-928 as changed on
 * 2026-10-21).
 */
import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { openOutside } from "./openOutside.js";
import { CAD_VIEWER, cadSource, cadViewerHtml, type CadTabState } from "./cadFiles.js";
import { nonce } from "./html.js";

export { CAD_VIEWER, isCadFile } from "./cadFiles.js";

class CadDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose() {}
}

/**
 * The CAD tabs: a STEP or GLB file, drawn in the tab. Local work, so no
 * account is asked for (PB-928 as changed on 2026-10-21).
 */
export class CadEditorProvider implements vscode.CustomReadonlyEditorProvider<CadDocument> {
  readonly tabs = new Map<vscode.WebviewPanel, CadTabState>();

  constructor(private readonly extension: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): CadEditorProvider {
    const provider = new CadEditorProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(CAD_VIEWER, provider, { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
    return provider;
  }

  openCustomDocument(uri: vscode.Uri): CadDocument {
    return new CadDocument(uri);
  }

  resolveCustomEditor(document: CadDocument, panel: vscode.WebviewPanel): void {
    const file = document.uri.fsPath;
    const source = cadSource(file);
    const dist = vscode.Uri.joinPath(this.extension, "dist");
    const drawn = vscode.Uri.file(source.via ?? source.file);
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist, vscode.Uri.file(dirname(drawn.fsPath))] };
    const w = panel.webview;
    const state: CadTabState = { file, source };
    this.tabs.set(panel, state);
    panel.onDidDispose(() => this.tabs.delete(panel));
    w.onDidReceiveMessage(async (m: { type?: string; message?: string }) => {
      if (m?.type === "page" || m?.type === "ready" || m?.type === "error") {
        state.state = m.type;
        state.message = typeof m.message === "string" ? m.message : undefined;
      } else if (m?.type === "openExternal") {
        await openOutside(document.uri);
      } else if (m?.type === "reveal") await vscode.commands.executeCommand("revealFileInOS", document.uri);
    });
    w.html = cadViewerHtml({
      script: w.asWebviewUri(vscode.Uri.joinPath(dist, "cad-viewer.js")).toString(),
      style: w.asWebviewUri(vscode.Uri.joinPath(dist, "cad-viewer.css")).toString(),
      occt: w.asWebviewUri(vscode.Uri.joinPath(dist, "occt-import-js.js")).toString(),
      wasm: w.asWebviewUri(vscode.Uri.joinPath(dist, "occt-import-js.wasm")).toString(),
      model: w.asWebviewUri(drawn).toString(),
      source,
      name: basename(file),
      cspSource: w.cspSource,
      nonce: nonce(),
    });
  }
}

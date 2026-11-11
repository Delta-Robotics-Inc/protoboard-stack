/**
 * Opening a local file outside a text editor (PB-1048). Only the types in
 * `SYSTEM_OPENS` go to the system's application; an SVG goes to VS Code's
 * image preview; anything else is shown in the file manager, so a file from a
 * part or a project never runs through the system opener.
 *
 * R2-E (G2, 2026-11-02): a STEP file goes to the person's preferred STEP viewer
 * (stepViewer.ts, the `tools.stepViewer` setting, asked once) when the
 * extension has registered it (`setStepOpener`).
 */
import * as vscode from "vscode";
import { outsideOpen, type OutsideOpen } from "./artifacts.js";

let stepOpener: ((uri: vscode.Uri) => Promise<unknown>) | undefined;

/** The extension's preferred STEP viewer (stepViewer.ts `openStepFile`); unset, a STEP goes to the system like any type. */
export function setStepOpener(fn: ((uri: vscode.Uri) => Promise<unknown>) | undefined) {
  stepOpener = fn;
}

/** The system's application for a type it may open (else the file manager), as before R2-E. */
export async function openWithSystem(uri: vscode.Uri): Promise<OutsideOpen> {
  const how = outsideOpen(uri.fsPath);
  if (how === "image-preview") {
    await vscode.commands.executeCommand("vscode.openWith", uri, "imagePreview.previewEditor");
    return how;
  }
  if (how === "system" && (await vscode.env.openExternal(uri))) return how;
  await vscode.commands.executeCommand("revealFileInOS", uri);
  return "reveal";
}

/** Opens `uri` as `outsideOpen` says; a STEP with the preferred viewer; a type the system has no application for is shown in the file manager. Returns what was done. */
export async function openOutside(uri: vscode.Uri): Promise<OutsideOpen> {
  if (stepOpener && /\.(step|stp)$/i.test(uri.fsPath)) {
    await stepOpener(uri);
    return "system";
  }
  return openWithSystem(uri);
}

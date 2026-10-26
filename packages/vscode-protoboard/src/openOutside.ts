/**
 * Opening a local file outside a text editor (PB-1048). Only the types in
 * `SYSTEM_OPENS` go to the system's application; an SVG goes to VS Code's
 * image preview; anything else is shown in the file manager, so a file from a
 * part or a project never runs through the system opener.
 */
import * as vscode from "vscode";
import { outsideOpen, type OutsideOpen } from "./artifacts.js";

/** Opens `uri` as `outsideOpen` says; a type the system has no application for is shown in the file manager. Returns what was done. */
export async function openOutside(uri: vscode.Uri): Promise<OutsideOpen> {
  const how = outsideOpen(uri.fsPath);
  if (how === "image-preview") {
    await vscode.commands.executeCommand("vscode.openWith", uri, "imagePreview.previewEditor");
    return how;
  }
  if (how === "system" && (await vscode.env.openExternal(uri))) return how;
  await vscode.commands.executeCommand("revealFileInOS", uri);
  return "reveal";
}

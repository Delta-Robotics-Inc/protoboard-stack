/**
 * Export (R2-E, G3, 2026-11-02). Kevin: "export goes to the Downloads folder, don't even ask; importing goes to
 * whatever folder we have set". An export is written to `files.exportFolder` (core settings.ts; DEFAULT: the
 * Downloads folder) with no dialog, named `<project>-<view or part>-<date>.<ext>`, and a toast says where with a
 * Reveal button.
 *
 * - `png`: the 3D view as the viewer last drew it at rest (its save point, PB-1180: the tab posts one on every
 *   settle; the toolbar's button asks for a fresh one first, handoffs.md R2-E to R2-B);
 * - `step`, `stl`, `glb`: a part's model through `protoboard parts export` (W4-B, cli/src/parts-export.ts), so the
 *   file is the full-resolution body (never the view sidecar);
 * - anything the page itself would download (the BOM's Export CSV) arrives as bytes (`writeExport`).
 *
 * Import is unchanged (the project's own folder; `files.importFolder` is where a picker starts).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import * as vscode from "vscode";
import { exportFileName, safeName } from "@protoboardai/core/settings";

/**
 * Write bytes to the export folder under a free name; returns the file. Wave R2 gate: written with `wx`, so a file
 * that appeared between the free-name check and the write is never overwritten (the next free name is taken).
 */
export function writeExport(folder: string, project: string, what: string, ext: string, bytes: Uint8Array, now = new Date()): string {
  mkdirSync(folder, { recursive: true });
  const taken = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const name = exportFileName(project, what, ext, { now, exists: (n) => taken.has(n) || existsSync(join(folder, n)) });
    const file = join(folder, name);
    try {
      writeFileSync(file, bytes, { flag: "wx" });
      return file;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      taken.add(name);
    }
  }
  throw new Error(`no free name for ${what}.${ext} in ${folder}`);
}

/**
 * What a page may download into the export folder (wave R2 gate): data and pictures only, never a program, script
 * or shortcut a page could plant in Downloads. DEFAULT list.
 */
export const DOWNLOAD_TYPES = new Set(["csv", "tsv", "json", "txt", "md", "png", "svg", "pdf"]);

/** A file the page downloads (`download`): its own name's stem as the "what", the extension kept when it is allowed. */
export function downloadParts(name: string): { what: string; ext: string } | undefined {
  const ext = (extname(name).slice(1) || "bin").toLowerCase();
  if (!DOWNLOAD_TYPES.has(ext)) return undefined;
  return { what: safeName(basename(name, extname(name))) || "export", ext };
}

/** What an export of a module is called: its last path segment ("" is the system: the view's name). */
export function exportWhat(target: string | undefined, view: string): string {
  const last = target?.split("/").filter(Boolean).pop();
  return last ? last : view;
}

/** The toast after an export: where it went, and Reveal. */
export async function exportToast(file: string, log?: vscode.LogOutputChannel): Promise<void> {
  log?.info(`exported ${file}`);
  const reveal = "Reveal";
  const answer = await vscode.window.showInformationMessage(`Protoboard: exported ${basename(file)} to ${join(file, "..")}`, reveal);
  if (answer === reveal) await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file));
}

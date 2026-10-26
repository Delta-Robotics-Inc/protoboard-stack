/**
 * Saving a viewer tab's layout (PB-896): an explicit save (Ctrl+S on the
 * tab) folds the tab's layout edits into the project's display file,
 * `.protoboard/display.json` by default, which the project tracks in git
 * (only `.protoboard/build`, `cache`, `local`, `tools` and `evals` are
 * ignored). The folding is the dev server's own (`applyViewerLayout`), so a
 * save from VS Code writes exactly what the dev page would. No VS Code API
 * here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { applyViewerLayout, formatDisplay, type DisplayFile, type LayoutSnapshot, type ViewerLayout } from "../../cli/src/dev/layout.js";

export const DEFAULT_DISPLAY = join(".protoboard", "display.json");

export interface SaveResult {
  /** Project-relative display file. */
  file: string;
  /** Levels written ("" is the top level). */
  levels: string[];
  /** Levels not written, with why. */
  skipped: { level: string; reason: string }[];
}

/** The display file a project uses: what its dev server reports, else the default. */
export function displayFile(root: string, reported?: string): string {
  if (reported && !isAbsolute(reported) && !reported.split(/[\\/]/).includes("..")) return join(root, reported);
  return join(root, DEFAULT_DISPLAY);
}

/** Fold `layout` into the display file and write it (atomically); nothing is written when no level changes. */
export function saveLayout(root: string, file: string, layout: ViewerLayout, snapshot?: LayoutSnapshot): SaveResult {
  let current: DisplayFile = {};
  let previous: string | undefined;
  if (existsSync(file)) {
    previous = readFileSync(file, "utf8");
    try {
      current = JSON.parse(previous) as DisplayFile;
    } catch (e) {
      throw new Error(`${relative(root, file)} is not valid JSON (${(e as Error).message}); fix it before saving a layout`);
    }
  }
  const merged = applyViewerLayout(current, layout, snapshot);
  const rel = relative(root, file).split(sep).join("/");
  if (merged.levels.length) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, formatDisplay(merged.display, previous));
    renameSync(tmp, file);
  }
  return { file: rel, levels: merged.levels, skipped: merged.skipped };
}

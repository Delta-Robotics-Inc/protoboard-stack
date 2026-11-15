/**
 * Saving a viewer tab's layout (PB-896): an explicit save (Ctrl+S on the
 * tab) folds the tab's layout edits into the project's display file,
 * `.protoboard/display.json` by default, which the project tracks in git
 * (only `.protoboard/build`, `cache`, `local`, `tools` and `evals` are
 * ignored). The folding is the dev server's own (`applyViewerLayout`), so a
 * save from VS Code writes exactly what the dev page would. No VS Code API
 * here.
 *
 * The Atlas tab's positions are saved the same way, but at once, without
 * Ctrl+S (docs/specs/atlas.md): only the display file's `atlas` key changes
 * (`applyAtlasLayout`, the dev server's own). A file the Atlas opens must lie
 * inside the project (`projectFileOf`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { applyAtlasLayout, type AtlasPositions } from "../../cli/src/dev/atlas.js";
import { applyViewerLayout, formatDisplay, type DisplayFile, type LayoutSnapshot, type ViewerLayout } from "../../cli/src/dev/layout.js";
import { isInsideReal } from "../../core/src/paths.js";
import { isSensitiveName } from "@protoboardai/core/atlas";

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

/** Write a display file's new text through a temporary file and a rename. */
function writeDisplay(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** The display file as it is now (an empty one when there is none), and its text; throws when it is not JSON. */
function readDisplay(root: string, file: string): { current: DisplayFile; previous?: string } {
  if (!existsSync(file)) return { current: {} };
  const previous = readFileSync(file, "utf8");
  try {
    return { current: JSON.parse(previous) as DisplayFile, previous };
  } catch (e) {
    throw new Error(`${relative(root, file)} is not valid JSON (${(e as Error).message}); fix it before saving a layout`);
  }
}

/**
 * Keep the Atlas tab's positions: replace the display file's
 * `atlas.positions` (integers, sorted) and leave every other key as it is.
 * Nothing is written when the file already holds them.
 */
export function saveAtlasLayout(root: string, file: string, positions: AtlasPositions): { file: string; changed: boolean; nodes: number } {
  const { current, previous } = readDisplay(root, file);
  const merged = applyAtlasLayout(current, positions);
  if (merged.changed) writeDisplay(file, formatDisplay(merged.display, previous));
  return { file: relative(root, file).split(sep).join("/"), changed: merged.changed, nodes: Object.keys(positions).length };
}

/**
 * The file a project-relative path (as the Atlas names it, forward slashes)
 * opens, or undefined when it does not lie inside the project once every
 * link is followed, is the project folder itself, or has a name the index
 * never lists (keys, credentials, `.env`).
 */
export function projectFileOf(root: string, path: string): string | undefined {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((s) => s === "..")) return undefined;
  const file = resolve(root, ...path.split("/"));
  if (file === resolve(root) || !isInsideReal(root, file) || isSensitiveName(path)) return undefined;
  return file;
}

/** Whether a project file is there and is a file (not a folder). */
export function isProjectFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Fold `layout` into the display file and write it (atomically); nothing is written when no level changes. */
export function saveLayout(root: string, file: string, layout: ViewerLayout, snapshot?: LayoutSnapshot): SaveResult {
  const { current, previous } = readDisplay(root, file);
  const merged = applyViewerLayout(current, layout, snapshot);
  const rel = relative(root, file).split(sep).join("/");
  if (merged.levels.length) writeDisplay(file, formatDisplay(merged.display, previous));
  return { file: rel, levels: merged.levels, skipped: merged.skipped };
}

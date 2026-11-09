/**
 * Where a board's local state and derived data live (contract section 7). One rule for the service, the importers,
 * the checks and the renderer:
 *
 * - The project root is the nearest folder at or above the board folder holding `protoboard.config.ts`.
 * - Without one (a board outside any project, for example a freshly imported board), the root is the board folder's
 *   parent, so the state folder is a sibling `.protoboard` next to the board folder and never inside it. A board
 *   folder at the top of a drive (no parent) is its own root.
 * - `<board key>` is the board folder relative to the root, `/` replaced by `__` (a board outside its root gets
 *   `outside-<hash>`).
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha1Hex } from "./canonical.js";

/** The name of the state folder (journal, lock, service endpoint, derived data). Board loaders never read it. */
export const STATE_DIR = ".protoboard";

/** The nearest folder at or above `dir` holding protoboard.config.ts, else the parent of `dir` (never `dir` itself, unless it has no parent). */
export function findProjectRoot(dir: string): string {
  const start = resolve(dir);
  let d = start;
  for (;;) {
    if (existsSync(join(d, "protoboard.config.ts"))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  const parent = dirname(start);
  return parent === start ? start : parent;
}

/** `<board key>`: the board folder relative to the project root, `/` replaced by `__`. */
export function boardKey(projectRoot: string, dir: string): string {
  const rel = relative(resolve(projectRoot), resolve(dir)).split(/[\\/]+/).filter(Boolean).join("__");
  if (!rel) return "board";
  if (rel.startsWith("..") || isAbsolute(rel)) return `outside-${sha1Hex(resolve(dir)).slice(0, 12)}`;
  return rel.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** The local state folder of a board: `<root>/.protoboard/local/board/<board key>/`. */
export const boardLocalDir = (projectRoot: string, dir: string): string => join(projectRoot, STATE_DIR, "local", "board", boardKey(projectRoot, dir));

/** The derived data folder of a board: `<root>/.protoboard/build/board/<board key>/`. */
export const boardBuildDir = (projectRoot: string, dir: string): string => join(projectRoot, STATE_DIR, "build", "board", boardKey(projectRoot, dir));

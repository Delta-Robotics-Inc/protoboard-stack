/**
 * Paths the stack records in a project's files (PB-1018). A project made on
 * Windows is opened on macOS and Linux, so every path written into a
 * project file (parts/origins.json, operation records, the build, AGENTS.md)
 * uses forward slashes, whatever system wrote it; reading accepts the
 * backslashes an earlier stack wrote on Windows. Node's path functions take
 * forward slashes on every system, so a recorded path joins as it is.
 */
import { realpathSync } from "node:fs";
import * as nodePath from "node:path";

/** The parts of `node:path` a recorded path depends on: `path.win32` or `path.posix` in tests. */
export type PathFlavour = Pick<typeof nodePath, "relative" | "sep">;

/** `to` relative to `from`, with forward slashes on every system: what the stack writes into project files. */
export function projectRelative(from: string, to: string, flavour: PathFlavour = nodePath): string {
  return toForwardSlashes(flavour.relative(from, to), flavour);
}

/** A path from this system written with forward slashes. */
export function toForwardSlashes(path: string, flavour: Pick<PathFlavour, "sep"> = nodePath): string {
  return flavour.sep === "/" ? path : path.split(flavour.sep).join("/");
}

/**
 * A path as a project file records it, read on any system: backslashes (a
 * record written on Windows by stack 0.1.6 or earlier) become forward
 * slashes. A recorded path never holds a backslash of its own: the stack
 * writes none, and the parts library refuses one in a file name.
 */
export const recordedPath = (path: string): string => (path.includes("\\") ? path.replace(/\\/g, "/") : path);

/** Whether `child` is `parent` or lies below it, by the path's text (no link is followed). */
export function isInside(parent: string, child: string): boolean {
  const r = nodePath.relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(r));
}

/** The realpath of a path; for one not there (yet), its nearest existing ancestor's realpath joined with the rest. */
export function realpathOrAncestor(path: string): string {
  const abs = nodePath.resolve(path);
  try {
    return realpathSync.native(abs);
  } catch {
    const parent = nodePath.dirname(abs);
    return parent === abs ? abs : nodePath.join(realpathOrAncestor(parent), nodePath.basename(abs));
  }
}

/** Whether `child` lies inside `parent` once every link on either path is followed. */
export const isInsideReal = (parent: string, child: string): boolean => isInside(parent, child) && isInside(realpathOrAncestor(parent), realpathOrAncestor(child));

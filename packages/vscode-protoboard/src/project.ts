/**
 * Which Protoboard project a command is about. No VS Code API here.
 */
import { dirname, relative, resolve, sep } from "node:path";

/** Folders that are never projects of the workspace: dependencies, generated output, test scratch. */
export const IGNORED_DIRS = /(^|[\\/])(node_modules|\.git|\.protoboard|\.tmp[^\\/]*|dist|out)([\\/]|$)/;

/** Project roots from the `protoboard.config.ts` files found in workspace folders, outside ignored folders. */
export function projectRoots(found: { file: string; folder: string }[]): string[] {
  return [...new Set(found.filter((f) => !IGNORED_DIRS.test(relative(f.folder, f.file))).map((f) => dirname(resolve(f.file))))].sort();
}

const inside = (file: string, dir: string) => {
  const rel = relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
};

/** The innermost project that contains `file`. */
export function projectOf(file: string | undefined, roots: string[]): string | undefined {
  if (!file) return undefined;
  return roots.filter((r) => inside(resolve(file), r)).sort((a, b) => b.length - a.length)[0];
}

/**
 * The project a command applies to without asking: the one holding the
 * active editor's file, else the only one, else the last one used.
 * Undefined means ask.
 */
export function chooseProject(roots: string[], activeFile?: string, lastUsed?: string): string | undefined {
  return projectOf(activeFile, roots) ?? (roots.length === 1 ? roots[0] : undefined) ?? (lastUsed && roots.includes(lastUsed) ? lastUsed : undefined);
}

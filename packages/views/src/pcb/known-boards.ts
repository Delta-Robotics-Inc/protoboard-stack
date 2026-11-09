/**
 * Which board folders the shell's host knows of, for the `layout` tab's `applies` (tabs.ts). A view's `applies`
 * sees only the module and the bundle, and a board folder is not in the UHD bundle: the shell sets the list when
 * its host tells it (the dev server's board list, the VS Code extension's), and the tab is offered at the root
 * while the list is not empty. The command line's `views check` never sets it, so it never offers the tab.
 * No React and no DOM.
 */
import type { BoardEntry } from "./types.js";

let known: readonly BoardEntry[] = [];
const listeners = new Set<() => void>();

export function setKnownBoards(boards: readonly BoardEntry[]): void {
  const same = boards.length === known.length && boards.every((b, i) => b.key === known[i]?.key && b.name === known[i]?.name);
  known = [...boards];
  if (!same) for (const l of [...listeners]) l();
}

export const knownBoards = (): readonly BoardEntry[] => known;

/** Called after the list changes (shells re-render their tabs). */
export function onKnownBoards(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The `layout` tab applies at the root of a project whose host knows a board folder. */
export function layoutApplies(module: { id: string }, bundle: { root?: string }, at?: { path: string }): boolean {
  return known.length > 0 && (at ? at.path === "" : module.id === bundle.root);
}

/**
 * Which schematics the shell's host knows of (one per UHD board), for the `schematic` tab's `applies` (tabs.ts): a
 * view's `applies` sees only the module and the bundle, and the host's list of boards with a schematic is not in the
 * bundle. The shell sets it when its host tells it; the command line's `views check` never does. No React, no DOM.
 */
import type { SchematicEntry } from "./types.js";

let known: readonly SchematicEntry[] = [];
const listeners = new Set<() => void>();

export function setKnownSchematics(list: readonly SchematicEntry[]): void {
  const same = list.length === known.length && list.every((s, i) => s.key === known[i]?.key && s.name === known[i]?.name);
  known = [...list];
  if (!same) for (const l of [...listeners]) l();
}

export const knownSchematics = (): readonly SchematicEntry[] => known;

export function onKnownSchematics(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The schematic editor applies at the project's root, and at a board module the host has a schematic for. */
export function schematicEditorApplies(module: { id: string }, bundle: { root?: string }, at?: { path: string }): boolean {
  if (!known.length) return false;
  if (at ? at.path === "" : module.id === bundle.root) return true;
  return known.some((s) => s.board === module.id);
}

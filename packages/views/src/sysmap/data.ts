/**
 * Where the System Map view gets its map: a shell (the dev server's page,
 * a VS Code viewer tab, the extension's System Map panel) gives the view a
 * `SysmapData` through `SysmapDataProvider`, as the Atlas gets `AtlasData`.
 * A host without one (a static page) shows the view's empty state.
 *
 * The map is the stack's, not a project's: nothing here is written to a
 * project. Node positions are the person's own (local storage, settings.ts).
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { SysmapGraph } from "@protoboardai/core/sysmap";

export interface SysmapPayload {
  /** `sysmapGraph(map)` of the stack the host runs (docs/specs/system-map.md). */
  graph: SysmapGraph;
}

export interface SysmapData {
  load(): Promise<SysmapPayload>;
  /** Build the map again and tell the subscribers (the panel's Rebuild); absent: the host rebuilds on its own. */
  refresh?(): void;
  /** Called when the host has a new map; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
  /** Open a stack file by its stack-relative path (VS Code: an editor). Absent on the web: the inspector offers Copy path. */
  openFile?(path: string): void;
}

const Ctx = createContext<SysmapData | null>(null);

export function SysmapDataProvider({ data, children }: { data: SysmapData | null; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: data }, children);
}

export const useSysmapData = (): SysmapData | null => useContext(Ctx);

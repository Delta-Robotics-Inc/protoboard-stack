/**
 * Where the Atlas view gets its graph and keeps its positions: a shell
 * (the dev server's page, the VS Code webview) gives the view an `AtlasData`
 * through `AtlasDataProvider`, as the parts views get `PartsData`. A host
 * without one (a static page) shows the view's empty state.
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { AtlasGraph } from "@protoboardai/core/atlas";

/** What pulls nodes together besides their links: nothing more, their kind, or their folder. */
export type PullBy = "links" | "kind" | "folder";

/** Node positions kept between sessions (display.json `atlas.positions`), in integer graph units. */
export interface AtlasLayout {
  positions: Record<string, [number, number]>;
}

export interface AtlasPayload {
  graph: AtlasGraph;
  layout?: AtlasLayout;
  /**
   * The index no longer describes the project: why (`files`: files were
   * added, removed or changed, `changed` says how many; `stack`: another
   * version of the stack built it; `enumerator`: it listed the files with
   * git and now without, or the reverse; `history`: it was built before
   * creation times were recorded; none of these compares files, so
   * `changed` is 0), and whether a rebuild is under way.
   */
  stale?: { changed: number; rebuilding: boolean; reason?: "files" | "stack" | "enumerator" | "history" };
}

/** What the view's stale notice says: files changed, or an index from another version, file listing or without creation times (whose freshness names no files). */
export function staleMessage(stale: NonNullable<AtlasPayload["stale"]>): string {
  if (stale.reason === "stack") return "The project index was built by a different version of Protoboard";
  if (stale.reason === "enumerator") return "The project index listed the files another way (with or without git)";
  if (stale.reason === "history") return "The project index was built before creation times were recorded";
  return `${stale.changed} ${stale.changed === 1 ? "file" : "files"} changed since the last build`;
}

export interface AtlasData {
  load(): Promise<AtlasPayload>;
  /** Integer positions after a settle; absent: positions are not kept. */
  saveLayout?(layout: AtlasLayout): Promise<void>;
  /** Called after each rebuild (the shell's bundle event); returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
  /** Open a project file (VS Code: editor or CAD viewer). Absent on the web: the inspector offers Copy path. */
  openFile?(path: string): void;
  /**
   * Where the inspector's preview fetches an image of the project that no
   * artifact names (the dev server's image route: only images the index
   * lists). Absent: only images an artifact names are previewed.
   */
  imageUrl?(path: string): string | undefined;
}

const Ctx = createContext<AtlasData | null>(null);

export function AtlasDataProvider({ data, children }: { data: AtlasData | null; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: data }, children);
}

export const useAtlasData = (): AtlasData | null => useContext(Ctx);

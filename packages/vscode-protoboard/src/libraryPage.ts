/**
 * The messages of the Library's pages (the sidebar, the full-page library
 * and the libraries manager: @protoboardai/views' LibraryBrowser, LibraryPage
 * and LibrariesManager in the extension's React webviews, appPage.ts). The
 * extension computes every model (libraryView.ts) and posts it as
 * `{ type: "model", model, selected? }`; the pages post back what the user does.
 */
import type { PartDetailTab } from "@protoboardai/views/parts-model";
import type { LibraryQuery } from "./libraryModel.js";

/** A library as the manager shows it. */
export interface ManagedLibrary {
  id: string;
  url: string;
  scope: "project" | "default" | "personal";
  authEnv?: string;
  /** Whether `authEnv` is set in VS Code's environment (never its value). */
  tokenSet?: boolean;
  position: number;
  pinned: number;
  discovery?: { name: string; version: string; auth: string } | { error: string };
}

/** Page → extension. */
export type LibraryPageMessage =
  | { type: "ready" }
  | { type: "query"; query: Partial<LibraryQuery> }
  | { type: "loadMore" }
  | { type: "open"; key: string; tab?: PartDetailTab }
  | { type: "add" | "update" | "more"; key: string }
  | { type: "openPage" }
  /** A card asked for its part's pages (PB-918): answered with `{ type: "answer", ask, ... }`. */
  | { type: "pages"; ask: number; ref: { key: string; revision?: number } }
  | { type: "manage"; open: boolean }
  | { type: "libAdd"; url: string; id?: string; authEnv?: string; scope: "project" | "personal" }
  | { type: "libRemove" | "libUp" | "libDown"; id: string; scope: "project" | "default" | "personal"; steps?: number }
  | { type: "libCheck" }
  | { type: "retry" };

/**
 * What the Atlas remembers for each person, in this browser or webview
 * (local storage, `protoboard.atlas:ui`), for every project: which panels
 * show, "All links", and the appearance. Nothing of
 * it is written to the project. Read with `parseUi`, which keeps only valid
 * values (anything else falls back to its default); reading and writing
 * never throw (a sandboxed webview may refuse storage).
 */
import { ATLAS_KIND_TABLE, DEFAULT_APPEARANCE, defaultAppearance, parseAppearance, type AtlasAppearance, type KindTable } from "./appearance.js";

export interface AtlasUi {
  left: boolean;
  right: boolean;
  minimap: boolean;
  /** Draw every link, not only the core ones. Off by default. */
  allLinks: boolean;
  /** Colors and shapes (the Appearance popover). */
  appearance: AtlasAppearance;
}

export const UI_KEY = "protoboard.atlas:ui";
export const UI_DEFAULT: AtlasUi = { left: true, right: true, minimap: true, allLinks: false, appearance: DEFAULT_APPEARANCE };

/** The settings from their stored text (null: nothing stored); the appearance kept for `table`'s kinds (the System Map keeps its own, under its own key). */
export function parseUi(raw: string | null | undefined, table: KindTable = ATLAS_KIND_TABLE): AtlasUi {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    // not JSON: the defaults
  }
  return {
    left: v.left !== false,
    right: v.right !== false,
    minimap: v.minimap !== false,
    allLinks: v.allLinks === true,
    appearance: parseAppearance(v.appearance, table),
  };
}

export function readUi(key: string = UI_KEY, table: KindTable = ATLAS_KIND_TABLE): AtlasUi {
  try {
    return parseUi(globalThis.localStorage?.getItem(key), table);
  } catch {
    return { ...UI_DEFAULT, appearance: defaultAppearance(table) };
  }
}

export function writeUi(ui: AtlasUi, key: string = UI_KEY): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ui));
  } catch {
    // storage refused: the settings hold for this visit
  }
}

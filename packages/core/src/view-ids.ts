/**
 * The one rule for view ids, shared by the manifest check (contributes.views)
 * and the shells' view registry (@protoboardai/views). Browser-safe: no Node
 * imports, so a shell can use it (`@protoboardai/core/views`).
 *
 * Lowercase words with dashes, optionally "<extension>.<view>". A word may
 * start with a digit, as the built-in "3d" does.
 */
export const VIEW_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)?$/;

/** Whether `id` is a valid view id. */
export const isViewId = (id: unknown): id is string => typeof id === "string" && VIEW_ID.test(id);

/**
 * The files the built-in board views draw, found by file name among a
 * module's artifacts, never by the tool that wrote them
 * (docs/specs/tool-integrations.md §8). The views' `applies` and core's
 * check for outputs no view can reach (PB_VIEW_UNREACHABLE, PB-1030) share
 * this table.
 */
export const VIEW_FILES = {
  schematic: ["schematic.svg"],
  pcb: ["pcb-top.svg", "pcb-bottom.svg", "circuit.json"],
  bom: ["bom.csv"],
} as const satisfies Record<string, readonly string[]>;

/** The 3D view draws any GLB a module (or a module below it) has. */
export const isModelFile = (name: string): boolean => /\.glb$/i.test(name);

/** The tab titles of the built-in views that draw files, for messages. */
export const VIEW_TITLES: Record<string, string> = { schematic: "Schematic", pcb: "PCB", bom: "BOM", "3d": "3D" };

/**
 * The Atlas in `protoboard dev` (docs/specs/atlas.md): what the dev server
 * serves to the Atlas view, and how the view's node positions are kept.
 *
 * - `GET /__protoboard/atlas` answers the view projection of the project index
 *   (`.protoboard/build/atlas.json`, `atlasGraph`), the positions kept in the
 *   display file (`atlas.positions`) and, when files changed since the index
 *   was built, how many and whether a rebuild is under way. Paths and
 *   metadata only: no file's contents.
 * - `POST /__protoboard/atlas/layout` keeps the positions: the session token,
 *   a same-site origin and a JSON body, as a diagram layout save. Only the
 *   display file's `atlas` key changes. The UHD bundle never carries that key
 *   (`displayForBundle`), so a save neither rebuilds nor reloads anything.
 *
 * No Node and no core imports here: the VS Code extension saves the
 * positions with the same functions (packages/vscode-protoboard/src/display.ts).
 */
import { DISPLAY_SCHEMA, type DisplayFile } from "./layout.js";

/** The dev server's Atlas routes. */
export const ATLAS_ROUTES = { data: "/__protoboard/atlas", layout: "/__protoboard/atlas/layout", image: "/__protoboard/atlas/image" } as const;

/** The image types the image route serves (what a browser draws), by extension. */
export const ATLAS_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  apng: "image/apng",
};

/**
 * Whether the image route may serve `path` (project-relative, forward
 * slashes) of an index's census: an image a browser draws, that the census
 * lists and could read. The census never lists a sensitive name, a file out
 * of the project, `.protoboard/` or a dot-folder. Returns its content type,
 * or why not.
 */
export function atlasImageOf(census: readonly { path: string; ext: string; status: string }[], path: string): { type: string } | { error: string; status: number } {
  if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").some((s) => s === ".." || s === "." || s === "")) return { error: "not a project-relative path", status: 400 };
  const entry = census.find((c) => c.path === path);
  if (!entry) return { error: "not a file of the project index", status: 404 };
  const type = ATLAS_IMAGE_TYPES[entry.ext];
  if (!type) return { error: "not an image a browser draws", status: 415 };
  if (entry.status === "failed") return { error: "the index could not read this file", status: 404 };
  return { type };
}

/** The display file's key for the Atlas layout (core's `ATLAS_DISPLAY_KEY`). */
export const ATLAS_KEY = "atlas";

/** What a layout save may hold: node ids, their length, and how far from the origin a position may be. */
export const ATLAS_LAYOUT_LIMITS = { ids: 50_000, idLength: 512, coordinate: 1e9 } as const;

/** A stale index found by the read route triggers a rebuild at most this often. */
export const ATLAS_REBUILD_MS = 10_000;

/** Node positions by node id, in integer graph units. */
export type AtlasPositions = Record<string, [number, number]>;

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const coordinate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= ATLAS_LAYOUT_LIMITS.coordinate;
/** A node id as the index writes them (`def:`, `file:`, `dir:`, `url:` and a rest); never an object's own property names. */
const NODE_ID = /^[a-z][a-z0-9-]*:/;
export const isAtlasNodeId = (id: string): boolean => id.length > 0 && id.length <= ATLAS_LAYOUT_LIMITS.idLength && NODE_ID.test(id);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The positions of a layout save (`{ positions: { <node id>: [x, y] } }`), or why it is refused. */
export function parseAtlasLayoutRequest(body: unknown): { positions: AtlasPositions } | { error: string } {
  if (!record(body) || !record(body.positions)) return { error: "expected { positions: { <node id>: [x, y] } }" };
  const entries = Object.entries(body.positions);
  if (entries.length > ATLAS_LAYOUT_LIMITS.ids) return { error: `at most ${ATLAS_LAYOUT_LIMITS.ids} positions` };
  const positions: AtlasPositions = {};
  for (const [id, p] of entries) {
    if (!isAtlasNodeId(id)) return { error: `positions: ${JSON.stringify(id.slice(0, 80))} is not a node id` };
    if (!Array.isArray(p) || p.length !== 2 || !coordinate(p[0]) || !coordinate(p[1])) return { error: `positions[${JSON.stringify(id.slice(0, 80))}] must be [x, y], two finite numbers` };
    positions[id] = [p[0], p[1]];
  }
  return { positions };
}

/** The layout a display file holds (`atlas.positions`), read leniently: an entry that is not [x, y] is left out. */
export function atlasLayoutOf(display: unknown): { positions: AtlasPositions } | undefined {
  if (!record(display) || !record(display[ATLAS_KEY])) return undefined;
  const kept = (display[ATLAS_KEY] as Record<string, unknown>).positions;
  if (!record(kept)) return undefined;
  const positions: AtlasPositions = {};
  for (const [id, p] of Object.entries(kept)) {
    if (isAtlasNodeId(id) && Array.isArray(p) && p.length === 2 && coordinate(p[0]) && coordinate(p[1])) positions[id] = [Math.round(p[0]), Math.round(p[1])];
  }
  return { positions };
}

/**
 * The display file with `atlas.positions` replaced by `positions` (rounded to
 * integers, keys in code-unit order); every other key, and any other key of
 * `atlas`, stays as it was. The input is not modified. `changed` is false
 * when the file already holds these positions.
 */
export function applyAtlasLayout(input: DisplayFile, positions: AtlasPositions): { display: DisplayFile; changed: boolean } {
  const display: DisplayFile = structuredClone(record(input) ? input : {});
  // a new file says what it is; an existing one keeps its keys as they are
  if (!Object.keys(display).length) display.schema = DISPLAY_SCHEMA;
  const atlas = record(display[ATLAS_KEY]) ? (display[ATLAS_KEY] as Record<string, unknown>) : {};
  const next: AtlasPositions = {};
  for (const id of Object.keys(positions).sort(byCodeUnit)) {
    const [x, y] = positions[id];
    // -0 rounds to 0 in the file either way: keep the text stable
    next[id] = [Math.round(x) || 0, Math.round(y) || 0];
  }
  const changed = JSON.stringify(atlas.positions ?? null) !== JSON.stringify(next);
  display[ATLAS_KEY] = { ...atlas, positions: next };
  return { display, changed };
}

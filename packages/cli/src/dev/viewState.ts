/**
 * The 3D view's state on disk (PB-1178): what the dev server (and the VS Code
 * extension host, which imports this file) writes for the viewer.
 *
 * - `.protoboard/local/viewer-state.json` (git-ignored, per user): the live
 *   view state per scope (camera, selection, visibility, sections, explode),
 *   as the viewer hands it over 400 ms after it last changed. A save merges
 *   by scope (two tabs on two modules keep each other's), and the file is
 *   rewritten only when its content changes.
 * - The display file (committed): named views and annotations under
 *   `spatial.views` and `spatial.annotations`, written only on an explicit
 *   save, and only when they differ from what the file holds. A camera move
 *   never touches it.
 *
 * Formats as uhd-viewer `src/cad/state/serialize.ts` defines them; this side
 * checks the envelope and the sizes, the viewer checks every value it reads.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const VIEWER_STATE_FILE = join(".protoboard", "local", "viewer-state.json");
export const VIEWER_STATE_FILE_SCHEMA = "protoboard.viewer-state/v0";
export const VIEW_STATE_SCHEMA = "uhd-viewer.view-state/v1";
/** A saved file above this is refused (it holds a few cameras and selections per scope). DEFAULT 1 MiB. */
export const MAX_VIEWER_STATE_BYTES = 1 << 20;
/** DEFAULT: scopes (modules opened on their own) one file keeps. */
const MAX_SCOPES = 200;
/** DEFAULT, the viewer's caps (uhd-viewer `src/cad/state/schema.ts`): one annotation at most 4096 bytes of JSON, 500 of them, 512 kB in all. */
export const MAX_ANNOTATION_BYTES = 4096;
export const MAX_ANNOTATIONS = 500;
export const MAX_ANNOTATIONS_BYTES = 512 * 1024;

export interface ViewerStateFile {
  schema: typeof VIEWER_STATE_FILE_SCHEMA;
  viewState: typeof VIEW_STATE_SCHEMA;
  scope: string;
  scopes: Record<string, Record<string, unknown>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const LIVE_KEYS = ["camera", "selection", "highlight", "isolation", "visibility", "direction", "sections", "explode", "placements"];

/** A viewer-state file from the viewer, its envelope checked and its scopes reduced to the live keys; or why not. */
export function parseViewerStateFile(data: unknown): ViewerStateFile | { error: string } {
  if (!isObj(data)) return { error: "expected a viewer-state object" };
  if (data.schema !== VIEWER_STATE_FILE_SCHEMA || data.viewState !== VIEW_STATE_SCHEMA) return { error: `expected schema ${VIEWER_STATE_FILE_SCHEMA} with view state ${VIEW_STATE_SCHEMA}` };
  if (!isObj(data.scopes)) return { error: "scopes must be an object" };
  const entries = Object.entries(data.scopes);
  if (entries.length > MAX_SCOPES) return { error: `at most ${MAX_SCOPES} scopes` };
  const scopes: ViewerStateFile["scopes"] = {};
  for (const [scope, v] of entries) {
    if (scope.length > 512 || !isObj(v)) return { error: `scope "${scope.slice(0, 40)}" must be an object` };
    scopes[scope] = Object.fromEntries(Object.entries(v).filter(([k]) => LIVE_KEYS.includes(k)));
  }
  return { schema: VIEWER_STATE_FILE_SCHEMA, viewState: VIEW_STATE_SCHEMA, scope: typeof data.scope === "string" ? data.scope.slice(0, 512) : "", scopes };
}

function writeAtomic(file: string, data: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** The saved file of a project, or undefined (none, unreadable, another schema). */
export function readViewerState(root: string): ViewerStateFile | undefined {
  const file = join(root, VIEWER_STATE_FILE);
  try {
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, "utf8");
    if (text.length > MAX_VIEWER_STATE_BYTES) return undefined;
    const parsed = parseViewerStateFile(JSON.parse(text));
    return "error" in parsed ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/**
 * Merge a tab's live state into the project's file (by scope: the tab's
 * scopes replace those, others stay) and write it when it changed. Returns
 * whether the file was written.
 */
export function saveViewerState(root: string, incoming: ViewerStateFile): { written: boolean; file: string } {
  const file = join(root, VIEWER_STATE_FILE);
  const before = readViewerState(root);
  const merged: ViewerStateFile = { ...incoming, scopes: { ...(before?.scopes ?? {}), ...incoming.scopes } };
  const text = JSON.stringify(merged, null, 2) + "\n";
  if (text.length > MAX_VIEWER_STATE_BYTES) throw new Error("the viewer state is too large to save");
  let previous: string | undefined;
  try {
    previous = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  } catch {
    previous = undefined;
  }
  if (previous === text) return { written: false, file };
  writeAtomic(file, text);
  return { written: true, file };
}

/** The presentation a viewer saves (named views, annotations), checked as far as the display file needs. */
export function parsePresentation(data: unknown): { views: Record<string, unknown>; annotations: unknown[] } | { error: string } {
  if (!isObj(data)) return { error: "expected { namedViews, annotations }" };
  const views = data.namedViews ?? {};
  const annotations = data.annotations ?? [];
  if (!isObj(views) || Object.keys(views).length > 100) return { error: "namedViews must be an object of at most 100 views" };
  for (const [name, v] of Object.entries(views)) {
    if (!name.trim() || name.length > 80 || /[\u0000-\u001f]/.test(name)) return { error: `named view "${name.slice(0, 40)}" needs a name of 1 to 80 characters` };
    if (!isObj(v) || !isObj(v.camera)) return { error: `named view "${name}" needs a camera` };
  }
  if (!Array.isArray(annotations) || annotations.length > MAX_ANNOTATIONS) return { error: `annotations must be a list of at most ${MAX_ANNOTATIONS}` };
  let total = 0;
  for (const [i, a] of annotations.entries()) {
    const size = JSON.stringify(a ?? null).length;
    if (!isObj(a) || typeof a.id !== "string" || typeof a.author !== "string") return { error: `annotations[${i}] must be a record with an id and its author` };
    if (size > MAX_ANNOTATION_BYTES) return { error: `annotations[${i}] is ${size} bytes of JSON; one is at most ${MAX_ANNOTATION_BYTES}` };
    total += size;
  }
  if (total > MAX_ANNOTATIONS_BYTES) return { error: `annotations are ${total} bytes of JSON in all; at most ${MAX_ANNOTATIONS_BYTES}` };
  return { views, annotations };
}

/**
 * The presentation to write: named views always (they change only on an explicit save), annotations only when the
 * save says so (`saveAnnotations: true`). Callouts and marks an agent puts in the view are live until someone saves
 * them on purpose (collaboration D10; DEFAULT, W3-A): without the flag the display file keeps the annotations it
 * holds. Found in the W3-A exit test: every agent callout was written to the tracked display file.
 */
/**
 * Whether a save asks to write the annotations too: `saveAnnotations: true` beside the presentation (the extension's
 * relay), or inside it (W4-D: the viewer's "Save callouts" puts it in the presentation it posts, so a host that
 * forwards the presentation as it is carries the person's choice).
 */
export function wantsAnnotations(body: unknown): boolean {
  if (!isObj(body)) return false;
  if (body.saveAnnotations === true) return true;
  const p = body.presentation;
  return isObj(p) && p.saveAnnotations === true;
}

export function presentationToWrite(pres: { views: Record<string, unknown>; annotations: unknown[] }, display: { spatial?: Record<string, unknown> } | undefined, saveAnnotations: unknown): { views: Record<string, unknown>; annotations: unknown[] } {
  if (saveAnnotations === true) return pres;
  const kept = display?.spatial?.annotations;
  return { views: pres.views, annotations: Array.isArray(kept) ? kept : [] };
}

/**
 * The display file with the presentation in `spatial.views` and
 * `spatial.annotations` (empty ones removed); `changed` false when the file
 * already holds exactly that, so nothing is written.
 */
export function withPresentation<T extends { spatial?: Record<string, unknown> }>(display: T, presentation: { views: Record<string, unknown>; annotations: unknown[] }): { display: T; changed: boolean } {
  const next = structuredClone(display ?? ({} as T));
  const spatial: Record<string, unknown> = { ...(next.spatial ?? {}) };
  if (Object.keys(presentation.views).length) spatial.views = presentation.views;
  else delete spatial.views;
  if (presentation.annotations.length) spatial.annotations = presentation.annotations;
  else delete spatial.annotations;
  const changed = JSON.stringify(spatial.views ?? null) !== JSON.stringify(display?.spatial?.views ?? null) || JSON.stringify(spatial.annotations ?? null) !== JSON.stringify(display?.spatial?.annotations ?? null);
  if (Object.keys(spatial).length) next.spatial = spatial;
  else delete next.spatial;
  return { display: next, changed };
}

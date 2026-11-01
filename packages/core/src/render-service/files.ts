/**
 * Where the render service keeps things, all under the git-ignored
 * `.protoboard/local/` (init template):
 *
 *   .protoboard/local/render-service.json        the running service (URL, pid, session token)
 *   .protoboard/local/captures/<stamp>-<tab>.png    captures with no `out` (+ .overlay.svg, .capture.json)
 *   .protoboard/local/snapshots/<level>__<tab>.png  the last plain frame of each tab (the handoff save point)
 *   .protoboard/local/snapshots/<level>__<tab>.json its camera, view state, bundle hash, backend
 *
 * Every write goes through a temp file and a rename, so a reader (the visible
 * viewer, another CLI) never sees half a file.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isServiceRecord, type CameraState, type ServiceRecord, type ViewState } from "./schema.js";

export const LOCAL_DIR = join(".protoboard", "local");
export const SERVICE_RECORD = join(LOCAL_DIR, "render-service.json");
export const CAPTURES_DIR = join(LOCAL_DIR, "captures");
export const SNAPSHOTS_DIR = join(LOCAL_DIR, "snapshots");
export const SNAPSHOT_SCHEMA = "protoboard.snapshot/v0";

/** A file-name-safe slug: letters, digits, `_ . -`; never a character Windows refuses. */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[.]+|[. ]+$/g, "") || "root";

/** The snapshot key of a tab at a level: `root__3d`, `arm_fr_motor__3d`. */
export const snapshotKey = (level: string, view: string) => `${level ? slug(level.split("/").join("_")) : "root"}__${slug(view)}`;

/** Writes `data` to `file` through a temp file and a rename. */
export function writeAtomic(file: string, data: string | Buffer, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (mode !== undefined) {
    try {
      chmodSync(file, mode);
    } catch {
      /* Windows: the mode bits are advisory */
    }
  }
}

/** The handoff save point a visible viewer starts from (PB-1180; W2-A reads it). */
export interface SnapshotMeta {
  schema: typeof SNAPSHOT_SCHEMA;
  key: string;
  view: string;
  level: string;
  /** The PNG beside this file. */
  image: string;
  width: number;
  height: number;
  /** CSS px of the view it was drawn at, and the dpr. */
  css: { width: number; height: number; dpr: number };
  /** The camera as drawn: a visible viewer sets exactly this (no jump). */
  camera?: CameraState;
  /** The view state the frame was drawn with. */
  viewState: ViewState;
  bundleHash: string;
  revision: number;
  backend: "gpu" | "swiftshader";
  gpu: string;
  theme?: string;
  takenAt: string;
  /** Who drew it: the headless render service, or the visible viewer on settle and hide (W2-A writes the same files). */
  source: "render-service" | "viewer";
}

export function writeSnapshot(root: string, png: Buffer, meta: Omit<SnapshotMeta, "schema" | "image" | "key" | "source">): { png: string; json: string; meta: SnapshotMeta } {
  const key = snapshotKey(meta.level, meta.view);
  const dir = join(root, SNAPSHOTS_DIR);
  const full: SnapshotMeta = { schema: SNAPSHOT_SCHEMA, key, image: `${key}.png`, source: "render-service", ...meta };
  // the image first, then the record that points at it: a reader that finds the record finds its image
  writeAtomic(join(dir, `${key}.png`), png);
  writeAtomic(join(dir, `${key}.json`), `${JSON.stringify(full, null, 2)}\n`);
  return { png: join(dir, `${key}.png`), json: join(dir, `${key}.json`), meta: full };
}

export function readSnapshot(root: string, level: string, view: string): SnapshotMeta | undefined {
  const file = join(root, SNAPSHOTS_DIR, `${snapshotKey(level, view)}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as SnapshotMeta;
    // two levels can share a key (`arm_fr/motor` and `arm/fr_motor` both slug to `arm_fr_motor`): the record
    // must be this level's and view's, so one module's picture is never shown as another's (wave 2 gate)
    const norm = (l: unknown) => (typeof l === "string" ? l : "").split("/").filter(Boolean).join("/");
    return m.schema === SNAPSHOT_SCHEMA && norm(m.level) === norm(level) && m.view === view ? m : undefined;
  } catch {
    return undefined;
  }
}

export function readServiceRecord(root: string): ServiceRecord | undefined {
  const file = join(root, SERVICE_RECORD);
  if (!existsSync(file)) return undefined;
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return isServiceRecord(r) ? r : undefined;
  } catch {
    return undefined;
  }
}

export function writeServiceRecord(root: string, record: ServiceRecord): void {
  writeAtomic(join(root, SERVICE_RECORD), `${JSON.stringify(record, null, 2)}\n`, 0o600);
}

/** Removes the record if it is still this service's (another may have replaced it). */
export function removeServiceRecord(root: string, pid: number): void {
  const r = readServiceRecord(root);
  if (r && r.pid !== pid) return;
  rmSync(join(root, SERVICE_RECORD), { force: true });
}

/** A default capture path: `.protoboard/local/captures/<yyyymmdd-hhmmss>-<level>__<tab>.<ext>`. */
export function defaultCapturePath(root: string, level: string, view: string, ext: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return join(root, CAPTURES_DIR, `${stamp}-${snapshotKey(level, view)}.${ext}`);
}

/** The sidecar names of a capture image: `x.png` → `x.overlay.svg`, `x.capture.json` (not `x.view.json`: that name is the GLB view sidecar, which the init .gitignore ignores). */
export function captureSidecars(image: string): { svg: string; manifest: string } {
  const stem = image.replace(/\.(png|jpe?g|webp)$/i, "");
  return { svg: `${stem}.overlay.svg`, manifest: `${stem}.capture.json` };
}

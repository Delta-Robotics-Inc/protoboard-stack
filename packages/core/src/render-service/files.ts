/**
 * Where the render service keeps things, all under the git-ignored
 * `.protoboard/local/` (init template):
 *
 *   .protoboard/local/render-service.json        the running service (URL, pid, session token)
 *   .protoboard/local/captures/<stamp>-<tab>.png    captures with no `out` (+ .overlay.svg, .capture.json)
 *   .protoboard/local/snapshots/<key>.png           the last plain frame of each tab (the handoff save point)
 *   .protoboard/local/snapshots/<key>.json          its camera, view state, bundle hash, backend
 *
 * `<key>` is `snapshotKey(level, view)`: `root__3d`, `arm_fr.motor__3d`.
 *
 * Every write goes through a temp file and a rename, so a reader (the visible
 * viewer, another CLI) never sees half a file.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isServiceRecord, type CameraState, type ServiceRecord, type ViewState } from "./schema.js";

export const LOCAL_DIR = join(".protoboard", "local");
export const SERVICE_RECORD = join(LOCAL_DIR, "render-service.json");
export const CAPTURES_DIR = join(LOCAL_DIR, "captures");
export const SNAPSHOTS_DIR = join(LOCAL_DIR, "snapshots");
export const SNAPSHOT_SCHEMA = "protoboard.snapshot/v0";

/** A file-name-safe slug: letters, digits, `_ . -`; never a character Windows refuses. Lossy: for labels, not for keys (see `snapshotKey`). */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[.]+|[. ]+$/g, "") || "root";

/**
 * DEFAULT (W3-A, 2026-11-01): the longest encoded level and view in a snapshot key, in characters. Past
 * them the encoding is cut and a short sha256 of the original added, so a key plus `.json` and the
 * captures' 16-character stamp stay far below Windows' 255-character file name and 260-character path.
 */
export const SNAPSHOT_KEY_MAX_LEVEL = 96;
export const SNAPSHOT_KEY_MAX_VIEW = 48;

/** Windows' reserved device names: refused as a file name's stem (the part before the first dot). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * One level or view, encoded so that the encoding can be read back (and so two inputs never share a key):
 * lower-case letters, digits and `-` stay; `_` stays where `keepUnderscore`; `/` becomes `.` where
 * `slashAsDot`; every other byte (upper case, space, `.`, `:`, `~`, UTF-8) becomes `~` and two
 * lower-case hex digits. The result is all lower case (a case-insensitive file system cannot fold two
 * keys together) and never holds a character Windows refuses.
 */
function encodeKeyPart(s: string, o: { keepUnderscore: boolean; slashAsDot: boolean }): string {
  let out = "";
  for (const byte of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[a-z0-9-]/.test(c) || (o.keepUnderscore && c === "_")) out += c;
    else if (o.slashAsDot && c === "/") out += ".";
    else out += `~${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** Cuts an encoding to `max` characters (never inside a `~xx` escape) and adds `~~` and 16 hex of the original's sha256 (`~~` never occurs in an uncut encoding). */
function capKeyPart(encoded: string, original: string, max: number): string {
  if (encoded.length <= max) return encoded;
  let cut = max - 18;
  const esc = encoded.lastIndexOf("~", cut - 1);
  if (esc >= 0 && esc > cut - 3) cut = esc;
  return `${encoded.slice(0, cut)}~~${createHash("sha256").update(original).digest("hex").slice(0, 16)}`;
}

/** An instance path as one string: no leading, trailing or doubled `/` (`/arm_fr//motor/` is `arm_fr/motor`). */
export const normLevel = (level: unknown): string => (typeof level === "string" ? level : "").split("/").filter(Boolean).join("/");

/**
 * The snapshot key of a tab at a level: `root__3d`, `arm_fr.motor__3d` (wave 2 gate: collision-free).
 *
 * - The top level is `root` (existing callers and files keep working); a level that would itself encode
 *   to `root` has its first letter escaped (`~72oot`).
 * - A level's `/` is `.`, so `arm_fr/motor` (`arm_fr.motor`) and `arm/fr_motor` (`arm.fr_motor`) differ;
 *   `a b` is `a~20b`, never `a_b`. Upper case is escaped (`Arm` is `~41rm`), so the keys differ on
 *   a case-insensitive disk too.
 * - The view's `_` is escaped too, so the last `__` always separates level and view.
 * - Never a Windows device name as the stem (`con/x` is `~63on.x__3d`), never a trailing dot or space,
 *   never `< > : " / \ | ? *`; long levels and views are cut and get a sha256 suffix.
 */
export function snapshotKey(level: string, view: string): string {
  const l = normLevel(level);
  let lk = l ? capKeyPart(encodeKeyPart(l, { keepUnderscore: true, slashAsDot: true }), l, SNAPSHOT_KEY_MAX_LEVEL) : "root";
  // the stem before the first dot must be neither the top level's name nor a device name
  const stem = lk.split(".")[0];
  if (l && (lk === "root" || DEVICE_NAME.test(stem))) lk = `~${lk.charCodeAt(0).toString(16).padStart(2, "0")}${lk.slice(1)}`;
  const vk = capKeyPart(encodeKeyPart(view, { keepUnderscore: false, slashAsDot: false }), view, SNAPSHOT_KEY_MAX_VIEW) || "~";
  return `${lk}__${vk}`;
}

/** A Windows device name as a file's stem; exported for tests. */
export const isDeviceName = (stem: string) => DEVICE_NAME.test(stem);

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
    // the keys no longer collide, but a long level's key is cut and hashed, and a file can be hand-edited:
    // the record must still be this level's and view's, so one module's picture is never shown as another's
    return m.schema === SNAPSHOT_SCHEMA && normLevel(m.level) === normLevel(level) && m.view === view ? m : undefined;
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

// ---------------------------------------------------------------------------------------------
// A visible viewer's snapshot POST (W3-A's dev server calls these; wave 2 gate)

/** DEFAULT (W3-A, 2026-11-01): the largest snapshot a viewer may post, per side in pixels (8,000 CSS px at dpr 4). */
export const SNAPSHOT_MAX_SIDE_PX = 8000 * 4;
/** DEFAULT (W3-A, 2026-11-01): the largest view state a viewer may post with a snapshot, as JSON (1 MiB, like W2-A's viewer-state cap). */
export const SNAPSHOT_MAX_VIEW_STATE_BYTES = 1 << 20;
/** DEFAULT (W3-A, 2026-11-01): the longest renderer string kept with a snapshot. */
export const SNAPSHOT_MAX_GPU_CHARS = 200;

/** What a visible viewer may post with its snapshot (the server adds bundle hash, revision, backend and source). */
export interface SnapshotPostMeta {
  level: string;
  view: string;
  width: number;
  height: number;
  css: { width: number; height: number; dpr: number };
  camera?: CameraState;
  viewState: ViewState;
  gpu: string;
  theme?: string;
  takenAt?: string;
}

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(finite);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const show = (v: unknown) => (JSON.stringify(v) ?? String(v)).slice(0, 80);

/**
 * Checks a visible viewer's snapshot POST meta and returns only the fields a snapshot keeps (unknown
 * keys are dropped, DEFAULT: a newer viewer may send more). Every problem is named in one message.
 * The level and view follow the capture request's rules; `width`/`height` are pixels of the PNG.
 */
export function checkSnapshotMeta(m: unknown): { meta: SnapshotPostMeta } | { error: string } {
  if (!isPlain(m)) return { error: "snapshot meta: a JSON object { level, view, width, height, css, camera, viewState, gpu, theme, takenAt }" };
  const bad: string[] = [];
  const level = m.level;
  if (typeof level !== "string" || level.length > 512 || /(^|\/)\.\.?(\/|$)|\\|\0/.test(level)) bad.push(`level: an instance path such as "" or "arm_fr/motor", not ${show(level)}`);
  const view = m.view;
  if (typeof view !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(view)) bad.push(`view: a tab id such as 3d or diagram, not ${show(view)}`);
  for (const k of ["width", "height"] as const) {
    const v = m[k];
    if (!finite(v) || !Number.isInteger(v) || v < 1 || v > SNAPSHOT_MAX_SIDE_PX) bad.push(`${k}: a whole number of pixels, 1 to ${SNAPSHOT_MAX_SIDE_PX}`);
  }
  // DEFAULT: a viewer that sends no css drew at its own pixels (dpr 1), as the dev server assumed before this check
  let css = { width: m.width as number, height: m.height as number, dpr: 1 };
  if (m.css !== undefined) {
    const c = m.css;
    if (!isPlain(c) || !finite(c.width) || !finite(c.height) || !finite(c.dpr) || c.width <= 0 || c.height <= 0 || c.dpr < 0.25 || c.dpr > 4) bad.push("css: { width, height } above 0 and dpr 0.25 to 4");
    else css = { width: c.width, height: c.height, dpr: c.dpr };
  }
  let camera: CameraState | undefined;
  if (m.camera !== undefined) {
    const c = m.camera;
    if (!isPlain(c) || !vec3(c.position) || !vec3(c.target) || !vec3(c.up)) bad.push("camera: { position, target, up } as [x, y, z] finite numbers (mm), fov optional");
    else if (c.fov !== undefined && (!finite(c.fov) || c.fov <= 0 || c.fov >= 180)) bad.push("camera.fov: degrees, above 0 and below 180");
    else
      camera = {
        position: [...c.position],
        target: [...c.target],
        up: [...c.up],
        ...(c.fov !== undefined ? { fov: c.fov } : {}),
        ...(finite(c.distance) && c.distance > 0 ? { distance: c.distance } : {}),
      } as CameraState;
  }
  // DEFAULT: no view state is an empty one (the dev server's behaviour before this check)
  let viewState: ViewState = {};
  if (m.viewState !== undefined) {
    if (!isPlain(m.viewState)) bad.push("viewState: a plain JSON object");
    else {
      let text: string | undefined;
      try {
        text = JSON.stringify(m.viewState);
      } catch {
        bad.push("viewState: not JSON-serialisable");
      }
      if (text !== undefined && Buffer.byteLength(text, "utf8") > SNAPSHOT_MAX_VIEW_STATE_BYTES) bad.push(`viewState: over ${SNAPSHOT_MAX_VIEW_STATE_BYTES} bytes as JSON`);
      else if (text !== undefined) viewState = JSON.parse(text) as ViewState;
    }
  }
  let gpu = "";
  if (m.gpu !== undefined) {
    if (typeof m.gpu !== "string" || m.gpu.length > SNAPSHOT_MAX_GPU_CHARS) bad.push(`gpu: the renderer string, at most ${SNAPSHOT_MAX_GPU_CHARS} characters`);
    else gpu = m.gpu;
  }
  if (m.theme !== undefined && (typeof m.theme !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.theme))) bad.push("theme: a theme name such as protoboard-light");
  if (m.takenAt !== undefined && (typeof m.takenAt !== "string" || !ISO_TIME.test(m.takenAt) || !Number.isFinite(Date.parse(m.takenAt)))) bad.push("takenAt: an ISO 8601 time such as 2026-11-01T12:00:00Z");
  if (bad.length) return { error: `snapshot meta: ${bad.join("; ")}` };
  return {
    meta: {
      level: normLevel(level),
      view: view as string,
      width: m.width as number,
      height: m.height as number,
      css,
      ...(camera ? { camera } : {}),
      viewState,
      gpu,
      ...(m.theme !== undefined ? { theme: m.theme as string } : {}),
      ...(m.takenAt !== undefined ? { takenAt: m.takenAt as string } : {}),
    },
  };
}

/** The backend a renderer string names: SwiftShader when it says so, else the GPU (a visible viewer's snapshot records the real one). */
export function backendOf(gpu: string): "gpu" | "swiftshader" {
  return /swiftshader/i.test(gpu) ? "swiftshader" : "gpu";
}

// ---------------------------------------------------------------------------------------------
// Containment: where the render service may write (wave 2 gate)

/** `p` with the deepest part of it that exists replaced by its real path (symlinks and junctions resolved). */
function realExisting(p: string): string {
  let at = p;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(at), ...rest.reverse());
    } catch {
      const up = dirname(at);
      if (up === at) return join(at, ...rest.reverse());
      rest.push(basename(at));
      at = up;
    }
  }
}

const within = (root: string, p: string) => {
  const r = relative(root, p);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * `p` (absolute, or relative to the project) resolved inside the project `root`, else an Error saying
 * why and what to do. A `..` that climbs out, an absolute path elsewhere, another drive, and a symlink or
 * junction along the existing part of the path that leads out are all refused. `what` names the field
 * (`out`); `hint` says how to write elsewhere on purpose.
 */
export function resolveInsideProject(root: string, p: string, what: string, hint?: string): string {
  const base = resolve(root);
  const asked = isAbsolute(p) ? resolve(p) : resolve(base, p);
  const why = !within(base, asked) ? "is outside the project" : !within(realExisting(base), realExisting(asked)) ? "leads outside the project through a link (a symlink or junction)" : undefined;
  if (why) throw new Error(`${what}: ${asked} ${why} (${base}); write inside the project (a relative path such as docs/img/view.png)${hint ? `, or ${hint}` : ""}`);
  return asked;
}

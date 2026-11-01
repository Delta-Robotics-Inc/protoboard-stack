/**
 * The render service's request and response (PB-1180), and the record a
 * running service leaves in `.protoboard/local/render-service.json`.
 *
 * A capture request names a tab (`view`: `3d`, `diagram`, `pcb`, ...) at a
 * level (an instance path, "" for the top), the view state to set before the
 * frame (the 3D tab's `window.__cad.set` keys today; W2-A's view-state schema
 * when it lands: unknown keys are passed through), refs to annotate, the size
 * and the encoding. The response names the files written and the facts a
 * caller needs to trust the image: revision, bundle hash, backend and GPU,
 * stale and changed flags, the share of pixels that changed and the legend.
 *
 * No dependencies: the parser is hand-written so it runs in the CLI, the MCP
 * server and tests alike, and its messages say what to change.
 */

export const CAPTURE_REQUEST_SCHEMA = "protoboard.capture-request/v0";
export const CAPTURE_RESPONSE_SCHEMA = "protoboard.capture/v0";
export const SERVICE_RECORD_SCHEMA = "protoboard.render-service/v0";

export type ImageFormat = "png" | "jpeg" | "webp";
/** What is in the picture, for the encoder (transfer-limits.json `policy.pngFor` / `jpegFor`). */
export type ImageKind = "shaded" | "annotated" | "line" | "flat" | "diagram" | "contact-sheet";
export type OverlayMode = "burned+svg" | "svg" | "none";

/** A ref to annotate: an instance path (`arm_fr/motor`, `@board/u1`), optionally with its label. */
export interface AnnotateRef {
  ref: string;
  label?: string;
}

/**
 * The view state set before the frame. The 3D tab's keys today
 * (`window.__cad.set`): azimuth, elevation (degrees), distance (mm), target
 * ([x, y, z] mm, Z up), explode (0-1), labels. Any other key is passed to the
 * viewer unchanged (W2-A's `src/cad/state/` schema).
 */
export interface ViewState {
  azimuth?: number;
  elevation?: number;
  distance?: number;
  target?: [number, number, number];
  explode?: number;
  labels?: boolean;
  [key: string]: unknown;
}

export interface CaptureRequest {
  /** The tab's id (`3d` by default; `diagram`, `pcb`, `schematic`, `bom`, ...). */
  view: string;
  /** The level: an instance path ("" is the top). */
  level: string;
  state?: ViewState;
  annotate: AnnotateRef[];
  /** CSS pixels of the view, and the device pixel ratio. */
  size: { width: number; height: number; dpr: number };
  /** Default: png for annotated, line, flat and diagram images, jpeg for shaded (transfer-limits.json). */
  format?: ImageFormat;
  /** 0-100, jpeg and webp. */
  quality?: number;
  /** Only write a new image when the frame differs from the last one for the same request. */
  ifChanged: boolean;
  /** Chrome-free document mode: no header, panels, toolbars or toasts (PB-1109). Default true. */
  document: boolean;
  /** 2D tabs: the exact scale (screen px per diagram px; 1 = 100 %). Default: the viewer's own fit. */
  zoom?: number;
  /** 2D tabs with `zoom`: CSS px of margin around the drawing (default 24). */
  padding: number;
  /** The viewer theme (`protoboard-light`, `protoboard-dark`, ...). Default `protoboard-light` for documents. */
  theme?: string;
  /** How the annotations are delivered (default `burned+svg` when there is anything to annotate). */
  overlay: OverlayMode;
  /**
   * Where to write the image (relative to the project, or absolute inside it); default
   * `.protoboard/local/captures/`. It must resolve inside the project unless `allowOutsideProject` is set.
   */
  out?: string;
  /**
   * Let `out` point outside the project (wave 2 gate). Only the CLI's `views capture` sets it, and only when
   * the person passed `--out` themselves; the MCP server never does.
   */
  allowOutsideProject?: boolean;
  kind?: ImageKind;
  /** The long edge in output pixels; default `policy.defaultLongEdgePx` (2,576). Never above the route's limits. */
  maxLongEdge?: number;
  /** How many images go into the same send (above 20 the per-side limit drops to 3,000 px). */
  batch?: number;
}

export interface LegendEntry {
  n: number;
  ref: string;
  label: string;
  /** The instance path it resolved to, or undefined when no node matched. */
  instancePath?: string;
  found: boolean;
  /** Anchor in output image pixels (the bounds' centre projected), when found and in front of the camera. */
  anchorPx?: [number, number];
  /** The projected bounds in output image pixels: [x, y, width, height]. */
  boxPx?: [number, number, number, number];
  /** The anchor is hidden behind another part (a pick at the anchor hits something else). */
  occluded?: boolean;
}

export interface CaptureTimings {
  queueMs: number;
  pageMs: number;
  settleMs: number;
  captureMs: number;
  encodeMs: number;
  totalMs: number;
}

export interface CaptureResponse {
  schema: typeof CAPTURE_RESPONSE_SCHEMA;
  imagePath: string;
  svgPath?: string;
  manifestPath: string;
  /** The plain frame (no overlay) kept as the tab's handoff snapshot. */
  snapshotPath?: string;
  width: number;
  height: number;
  bytes: number;
  base64Bytes: number;
  format: ImageFormat;
  quality?: number;
  view: string;
  level: string;
  /** Bumps whenever the bundle the page shows changes. */
  revision: number;
  bundleHash: string;
  backend: "gpu" | "swiftshader";
  /** The WebGL renderer string (the GPU, or SwiftShader). */
  gpu: string;
  /** The bundle on disk is newer than what was drawn (a rebuild failed or is pending). */
  stale: boolean;
  /** The frame differs from the previous capture of the same request (always true for a first capture). */
  changed: boolean;
  /** Share of pixels that differ from the previous capture of the same request (0-1; 1 when there was none). */
  pixelsChangedShare: number;
  legend: LegendEntry[];
  /**
   * What the viewer's annotation layer drew for each record in the view state (W3-B's callouts, marks and arrows;
   * gate 3): `placed` or `pinned` are in the picture; `occluded` (its part is hidden behind another: the label
   * retracts, a ring shows only as a faint ghost), `offscreen`, `hidden` and `orphan` (no such part) are not. A
   * warning names each record not drawn. Absent when the viewer has no annotation layer or no records.
   */
  records?: DrawnRecord[];
  /** The view state as drawn: the request's state plus the camera the viewer reports. */
  viewState: ViewState & { camera?: CameraState };
  limits: { file: string; checked: string; applied: string[] };
  warnings: string[];
  timings: CaptureTimings;
}

/** One annotation record as the viewer's layer drew it (`window.__cad.annotations().records`). */
export interface DrawnRecord {
  id: string;
  kind: string;
  status: string;
  ref?: string;
  /** Where its anchor sits in the image (px). */
  anchorPx?: [number, number];
}

/** The camera as `window.__cad.observe()` reports it (mm, Z up). */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
  distance?: number;
}

/** `.protoboard/local/render-service.json`: where a running service listens. */
export interface ServiceRecord {
  schema: typeof SERVICE_RECORD_SCHEMA;
  url: string;
  port: number;
  pid: number;
  /**
   * The session token every request carries (`x-protoboard-render-token`). A
   * random loopback session value, not a credential to anything else; the
   * file is in the git-ignored `.protoboard/local/` and written owner-only.
   */
  token: string;
  root: string;
  startedAt: string;
  idleMs: number;
  /** The CLI version that started it (a newer CLI replaces an older service). */
  version: string;
}

/** DEFAULT (PB-1180): the view a capture draws when the request names no size. */
export const DEFAULT_SIZE = { width: 1600, height: 1000, dpr: 1 } as const;
/** DEFAULT (PB-1180): the largest view side in CSS px (the routes' 8,000 px per-side limit). */
export const MAX_CSS_SIDE = 8000;
/** DEFAULT (PB-1180): the most refs one capture annotates (more would not be legible). */
export const MAX_ANNOTATE = 40;
/** DEFAULT (PB-1180): the longest instance path a request may name, and the longest annotation label kept. */
export const MAX_LEVEL_CHARS = 512;
export const MAX_LABEL_CHARS = 80;
/** DEFAULT (PB-1180): CSS px of margin around a 2D drawing at an exact zoom. */
export const DEFAULT_PADDING = 24;

const FORMATS: ImageFormat[] = ["png", "jpeg", "webp"];
const KINDS: ImageKind[] = ["shaded", "annotated", "line", "flat", "diagram", "contact-sheet"];
const OVERLAYS: OverlayMode[] = ["burned+svg", "svg", "none"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/**
 * A capture request from JSON (an HTTP body, a CLI's flags, an MCP tool's
 * arguments): defaults filled, every problem named. Throws one Error listing
 * them all.
 */
export function parseCaptureRequest(input: unknown): CaptureRequest {
  const problems: string[] = [];
  const o = isObj(input) ? input : (problems.push("the request must be a JSON object"), {} as Record<string, unknown>);
  const known = new Set(["schema", "view", "level", "state", "annotate", "size", "format", "quality", "ifChanged", "document", "zoom", "padding", "theme", "overlay", "out", "allowOutsideProject", "kind", "maxLongEdge", "batch"]);
  for (const k of Object.keys(o)) if (!known.has(k)) problems.push(`unknown field "${k}"`);

  const view = o.view === undefined ? "3d" : o.view;
  if (typeof view !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(view)) problems.push(`view: a tab id such as 3d or diagram, not ${JSON.stringify(o.view)}`);
  const level = o.level === undefined ? "" : o.level;
  if (typeof level !== "string" || level.length > MAX_LEVEL_CHARS || /(^|\/)\.\.?(\/|$)|\\/.test(level)) problems.push(`level: an instance path such as "" or "arm_fr/motor", not ${JSON.stringify(o.level)}`);

  let state: ViewState | undefined;
  if (o.state !== undefined) {
    if (!isObj(o.state)) problems.push("state: an object of view-state keys (azimuth, elevation, distance, target, explode, labels, ...)");
    else {
      state = { ...o.state } as ViewState;
      for (const k of ["azimuth", "elevation", "distance", "explode"] as const) if (state[k] !== undefined && !num(state[k])) problems.push(`state.${k}: a number`);
      if (state.distance !== undefined && num(state.distance) && state.distance <= 0) problems.push("state.distance: above 0 (mm)");
      if (state.explode !== undefined && num(state.explode) && (state.explode < 0 || state.explode > 1)) problems.push("state.explode: 0 to 1");
      if (state.target !== undefined && !(Array.isArray(state.target) && state.target.length === 3 && state.target.every(num))) problems.push("state.target: [x, y, z] in mm");
      if (state.labels !== undefined && typeof state.labels !== "boolean") problems.push("state.labels: true or false");
    }
  }

  const annotate: AnnotateRef[] = [];
  if (o.annotate !== undefined) {
    if (!Array.isArray(o.annotate)) problems.push("annotate: a list of refs (strings, or {ref, label})");
    else
      for (const [i, a] of o.annotate.entries()) {
        if (typeof a === "string" && a.trim()) annotate.push({ ref: a.trim() });
        else if (isObj(a) && typeof a.ref === "string" && a.ref.trim() && (a.label === undefined || typeof a.label === "string")) annotate.push({ ref: a.ref.trim(), ...(a.label ? { label: String(a.label).slice(0, MAX_LABEL_CHARS) } : {}) });
        else problems.push(`annotate[${i}]: a ref string or {ref, label}`);
      }
    if (annotate.length > MAX_ANNOTATE) problems.push(`annotate: at most ${MAX_ANNOTATE} refs in one capture`);
  }

  const size = { ...DEFAULT_SIZE } as { width: number; height: number; dpr: number };
  if (o.size !== undefined) {
    if (!isObj(o.size)) problems.push("size: {width, height, dpr}");
    else {
      for (const k of ["width", "height"] as const) {
        const v = o.size[k];
        if (v === undefined) continue;
        if (!num(v) || (v as number) < 16 || (v as number) > MAX_CSS_SIDE) problems.push(`size.${k}: 16 to ${MAX_CSS_SIDE} CSS px`);
        else size[k] = Math.round(v as number);
      }
      if (o.size.dpr !== undefined) {
        if (!num(o.size.dpr) || (o.size.dpr as number) < 0.25 || (o.size.dpr as number) > 4) problems.push("size.dpr: 0.25 to 4");
        else size.dpr = o.size.dpr as number;
      }
    }
  }

  const format = o.format;
  if (format !== undefined && !FORMATS.includes(format as ImageFormat)) problems.push(`format: ${FORMATS.join(", ")}`);
  if (o.quality !== undefined && (!num(o.quality) || (o.quality as number) < 1 || (o.quality as number) > 100)) problems.push("quality: 1 to 100");
  if (o.kind !== undefined && !KINDS.includes(o.kind as ImageKind)) problems.push(`kind: ${KINDS.join(", ")}`);
  if (o.overlay !== undefined && !OVERLAYS.includes(o.overlay as OverlayMode)) problems.push(`overlay: ${OVERLAYS.join(", ")}`);
  if (o.zoom !== undefined && (!num(o.zoom) || (o.zoom as number) < 0.05 || (o.zoom as number) > 8)) problems.push("zoom: 0.05 to 8 (1 = 100 %)");
  if (o.padding !== undefined && (!num(o.padding) || (o.padding as number) < 0 || (o.padding as number) > 1000)) problems.push("padding: 0 to 1000 CSS px");
  if (o.maxLongEdge !== undefined && (!num(o.maxLongEdge) || (o.maxLongEdge as number) < 16)) problems.push("maxLongEdge: at least 16 px");
  if (o.batch !== undefined && (!num(o.batch) || (o.batch as number) < 1)) problems.push("batch: at least 1");
  for (const k of ["ifChanged", "document", "allowOutsideProject"] as const) if (o[k] !== undefined && typeof o[k] !== "boolean") problems.push(`${k}: true or false`);
  if (o.theme !== undefined && (typeof o.theme !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(o.theme))) problems.push("theme: a theme name such as protoboard-light");
  if (o.out !== undefined && (typeof o.out !== "string" || !o.out.trim() || /[<>"|?*]/.test(o.out.replace(/^[A-Za-z]:/, "")))) problems.push("out: a file path (no < > \" | ? *)");

  if (problems.length) throw new Error(`capture request: ${problems.join("; ")}`);
  return {
    view: view as string,
    level: (level as string).replace(/^\/+|\/+$/g, ""),
    ...(state ? { state } : {}),
    annotate,
    size,
    ...(format !== undefined ? { format: format as ImageFormat } : {}),
    ...(o.quality !== undefined ? { quality: Math.round(o.quality as number) } : {}),
    ifChanged: o.ifChanged === true,
    document: o.document !== false,
    ...(o.zoom !== undefined ? { zoom: o.zoom as number } : {}),
    padding: o.padding === undefined ? DEFAULT_PADDING : (o.padding as number),
    ...(o.theme !== undefined ? { theme: o.theme as string } : {}),
    overlay: (o.overlay as OverlayMode | undefined) ?? (annotate.length ? "burned+svg" : "none"),
    ...(o.out !== undefined ? { out: o.out as string } : {}),
    ...(o.allowOutsideProject === true ? { allowOutsideProject: true } : {}),
    ...(o.kind !== undefined ? { kind: o.kind as ImageKind } : {}),
    ...(o.maxLongEdge !== undefined ? { maxLongEdge: Math.round(o.maxLongEdge as number) } : {}),
    ...(o.batch !== undefined ? { batch: Math.round(o.batch as number) } : {}),
  };
}

/** The key two requests share when they would draw the same frame (for `ifChanged`). */
export function captureKey(r: CaptureRequest): string {
  return JSON.stringify([r.view, r.level, r.state ?? {}, r.annotate, r.size, r.document, r.zoom ?? null, r.padding, r.theme ?? null, r.overlay]);
}

/** The kind of image a request makes, for the encoder. */
export function imageKind(r: CaptureRequest): ImageKind {
  if (r.kind) return r.kind;
  if (r.annotate.length && r.overlay === "burned+svg") return "annotated";
  return r.view === "3d" ? "shaded" : "diagram";
}

/** A response is well formed (a client checks what a service sent; tests check the service). */
export function isCaptureResponse(v: unknown): v is CaptureResponse {
  if (!isObj(v) || v.schema !== CAPTURE_RESPONSE_SCHEMA) return false;
  const strings = ["imagePath", "manifestPath", "view", "level", "bundleHash", "gpu"];
  const numbers = ["width", "height", "bytes", "base64Bytes", "revision", "pixelsChangedShare"];
  const bools = ["stale", "changed"];
  return (
    strings.every((k) => typeof v[k] === "string") &&
    numbers.every((k) => num(v[k])) &&
    bools.every((k) => typeof v[k] === "boolean") &&
    (v.backend === "gpu" || v.backend === "swiftshader") &&
    FORMATS.includes(v.format as ImageFormat) &&
    Array.isArray(v.legend) &&
    isObj(v.viewState) &&
    isObj(v.limits) &&
    Array.isArray(v.warnings)
  );
}

/** A service record read from disk is well formed. */
export function isServiceRecord(v: unknown): v is ServiceRecord {
  return isObj(v) && v.schema === SERVICE_RECORD_SCHEMA && typeof v.url === "string" && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(v.url) && num(v.port) && num(v.pid) && typeof v.token === "string" && v.token.length >= 16 && typeof v.root === "string";
}

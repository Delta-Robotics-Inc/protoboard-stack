/**
 * Transfer limits (PB-1180): how big a capture may be so that it reaches
 * Claude (API, Bedrock, claude.ai, Claude Code) and the phone routes, read
 * from `docs/reference/transfer-limits.json`, and the two rules built on
 * them:
 *
 * - the size and encode plan: render at the policy's long edge (2,576 px),
 *   never above a route's side limit (8,000; 3,000 when a send carries more
 *   than 20 images), then step JPEG quality down and scale by 0.85 until the
 *   image is under the target bytes; annotated line art is scaled, never
 *   turned into JPEG;
 * - retry once: on a failed send the caller inspects the error, downscales
 *   or recompresses, and retries once; a second failure stops and reports.
 *
 * The docs file is the source of truth. A published CLI has no `docs/`
 * folder, so a built-in copy of the same values is used when the file is not
 * found (a test keeps the two equal).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageFormat, ImageKind } from "./schema.js";

export const TRANSFER_LIMITS_SCHEMA = "protoboard.transfer-limits/v1";

export interface RouteLimits {
  imageFormats?: string[];
  imageMaxBase64Bytes?: number;
  imageMaxBytes?: number;
  imageMaxSidePx?: number;
  manyImages?: { over: number; imageMaxSidePx: number };
  imagesPerRequest?: Record<string, number>;
  nativeLongEdgePx?: Record<string, number>;
  requestMaxBytes?: number;
  sources: string[];
  [key: string]: unknown;
}

export interface TransferLimits {
  schema: typeof TRANSFER_LIMITS_SCHEMA;
  checked: string;
  recheckAfterDays: number;
  note?: string;
  routes: Record<string, RouteLimits>;
  policy: {
    route: string;
    defaultLongEdgePx: number;
    targetBytes: number;
    hardMaxRawBytes: number;
    pngFor: string[];
    jpegFor: string[];
    jpegQuality: number[];
    scaleStep: number;
    maxSteps: number;
    maxImagesPerSend: number;
    retry: Record<string, string>;
  };
}

/** The built-in copy of docs/reference/transfer-limits.json (checked 2026-11-01). */
export const BUILT_IN_LIMITS: TransferLimits = {
  schema: TRANSFER_LIMITS_SCHEMA,
  checked: "2026-11-01",
  recheckAfterDays: 60,
  note: "Sizes in bytes use the smaller reading of MB (10^6). Byte limits on images are measured on the base64 data, which is 4/3 of the raw file. The render service (packages/core/src/render-service/limits.ts) reads this file; its built-in copy must match it (a test checks). Recheck the sources when `checked` is older than `recheckAfterDays`.",
  routes: {
    "claude-api": {
      imageFormats: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      imageMaxBase64Bytes: 10000000,
      imageMaxSidePx: 8000,
      manyImages: { over: 20, imageMaxSidePx: 3000 },
      imagesPerRequest: { default: 600, context200k: 100 },
      nativeLongEdgePx: { "claude-4.7-and-later": 2576, other: 1568 },
      requestMaxBytes: 128000000,
      sources: ["https://platform.claude.com/docs/en/build-with-claude/vision", "https://platform.claude.com/docs/en/api/overview"],
    },
    "google-managed": {
      imageMaxBase64Bytes: 10000000,
      requestMaxBytes: 30000000,
      sources: ["https://platform.claude.com/docs/en/build-with-claude/vision", "https://platform.claude.com/docs/en/api/overview"],
    },
    bedrock: {
      imageMaxBase64Bytes: 5000000,
      requestMaxBytes: 20000000,
      sources: ["https://platform.claude.com/docs/en/build-with-claude/vision", "https://platform.claude.com/docs/en/api/overview"],
    },
    "claude-code": {
      requestMaxBytes: 32000000,
      readImageMaxBytes: 128000000,
      resizesImagesOnRead: true,
      errors: { dimensions: "image dimensions exceed max allowed size", requestTooLarge: "Request too large (max 32MB)" },
      sources: ["https://code.claude.com/docs/en/errors", "https://code.claude.com/docs/en/tools-reference", "https://code.claude.com/docs/en/common-workflows"],
    },
    "claude-ai": {
      imageMaxBytes: 10000000,
      imagesPerTurn: 20,
      fileMaxBytes: 500000000,
      projectFileMaxBytes: 30000000,
      sources: ["https://platform.claude.com/docs/en/build-with-claude/vision", "https://support.claude.com/en/articles/8241126-upload-files-to-claude"],
    },
    telegram: { photoMaxBytes: 10000000, documentMaxBytes: 50000000, sources: ["https://core.telegram.org/bots/api"] },
  },
  policy: {
    route: "claude-api",
    defaultLongEdgePx: 2576,
    targetBytes: 2000000,
    hardMaxRawBytes: 3750000,
    pngFor: ["annotated", "line", "flat", "diagram"],
    jpegFor: ["shaded", "contact-sheet"],
    jpegQuality: [85, 75, 65],
    scaleStep: 0.85,
    maxSteps: 8,
    maxImagesPerSend: 20,
    retry: {
      rule: "On a failed send, inspect the error, fix the image, retry once; a second failure stops and reports the error, the sizes tried and the route.",
      dimensions: "scale to the route's max side (8000, or 3000 when more than 20 images)",
      manyImages: "scale every image of the batch to 3000 px per side, or split the batch to 20",
      tooLarge: "recompress (next JPEG quality) and scale by 0.75, or split the batch",
      other: "auth, rate limit, network: do not change the image; report",
    },
  },
};

export interface LoadedLimits {
  limits: TransferLimits;
  /** The file read, or `built-in`. */
  file: string;
  /** Days since `checked`. */
  ageDays: number;
  /** Older than `recheckAfterDays`: the doctor warns. */
  stale: boolean;
}

/** Where the docs file is: `PROTOBOARD_TRANSFER_LIMITS`, else the stack checkout's docs/reference (this file is packages/core/src/render-service/). */
export function limitsFileCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [...(env.PROTOBOARD_TRANSFER_LIMITS ? [resolve(env.PROTOBOARD_TRANSFER_LIMITS)] : []), join(here, "..", "..", "..", "..", "docs", "reference", "transfer-limits.json")];
}

/** Checks the shape of a limits file; throws naming what is wrong. */
export function validateLimits(v: unknown): TransferLimits {
  const o = v as TransferLimits;
  const bad: string[] = [];
  if (!o || typeof o !== "object") throw new Error("transfer limits: not a JSON object");
  if (o.schema !== TRANSFER_LIMITS_SCHEMA) bad.push(`schema is not ${TRANSFER_LIMITS_SCHEMA}`);
  if (typeof o.checked !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.checked)) bad.push("checked: a YYYY-MM-DD date");
  if (!o.routes || typeof o.routes !== "object") bad.push("routes: missing");
  const p = o.policy;
  if (!p || typeof p !== "object") bad.push("policy: missing");
  else {
    if (!o.routes?.[p.route]) bad.push(`policy.route "${p.route}" is not a route`);
    for (const k of ["defaultLongEdgePx", "targetBytes", "hardMaxRawBytes", "scaleStep", "maxSteps"] as const) if (typeof p[k] !== "number" || !(p[k] > 0)) bad.push(`policy.${k}: a positive number`);
    if (!(p.scaleStep < 1)) bad.push("policy.scaleStep: below 1");
    if (!Array.isArray(p.jpegQuality) || !p.jpegQuality.length) bad.push("policy.jpegQuality: a list");
  }
  for (const [name, r] of Object.entries(o.routes ?? {})) if (!Array.isArray(r.sources) || !r.sources.length) bad.push(`routes.${name}.sources: at least one URL`);
  if (bad.length) throw new Error(`transfer limits: ${bad.join("; ")}`);
  return o;
}

/** The limits: the first candidate file that exists, else the built-in copy. A file that exists but is broken is an error. */
export function loadTransferLimits(options: { files?: string[]; now?: Date; env?: NodeJS.ProcessEnv } = {}): LoadedLimits {
  const files = options.files ?? limitsFileCandidates(options.env);
  let limits = BUILT_IN_LIMITS;
  let file = "built-in";
  for (const f of files) {
    if (!existsSync(f)) continue;
    limits = validateLimits(JSON.parse(readFileSync(f, "utf8")));
    file = f;
    break;
  }
  const ageDays = Math.floor(((options.now ?? new Date()).getTime() - Date.parse(`${limits.checked}T00:00:00Z`)) / 86400000);
  return { limits, file, ageDays, stale: ageDays > limits.recheckAfterDays };
}

/** Base64 size of `n` raw bytes. */
export const base64Bytes = (n: number) => 4 * Math.ceil(n / 3);

/** The route's most a single image may be on the wire, in raw bytes (its base64 cap times 3/4, else its raw cap). */
export function routeMaxRawBytes(limits: TransferLimits, route = limits.policy.route): number {
  const r = limits.routes[route];
  if (r?.imageMaxBase64Bytes) return Math.floor((r.imageMaxBase64Bytes * 3) / 4);
  return (r?.imageMaxBytes as number | undefined) ?? limits.policy.hardMaxRawBytes;
}

/** The largest side a route takes for one image in a send of `batch` images. */
export function routeMaxSide(limits: TransferLimits, batch = 1, route = limits.policy.route): number {
  const r = limits.routes[route] ?? limits.routes[limits.policy.route];
  const side = r?.imageMaxSidePx ?? 8000;
  return r?.manyImages && batch > r.manyImages.over ? Math.min(side, r.manyImages.imageMaxSidePx) : side;
}

export interface SizePlan {
  /** CSS px of the page's view. */
  width: number;
  height: number;
  dpr: number;
  /** Factor applied to the output (`clip.scale`); 1 = the view's own pixels. */
  scale: number;
  /** Output pixels. */
  outWidth: number;
  outHeight: number;
  /** Which limits shaped it, for the response. */
  applied: string[];
}

/**
 * The output size: the view's CSS size times dpr, scaled down (never up) so
 * the long edge is at most `maxLongEdge` (default the policy's 2,576 px) and
 * never over the route's side limit for a send of `batch` images.
 */
export function planSize(size: { width: number; height: number; dpr: number }, limits: TransferLimits, opts: { maxLongEdge?: number; batch?: number } = {}): SizePlan {
  const applied: string[] = [];
  const sideLimit = routeMaxSide(limits, opts.batch ?? 1);
  let edge = opts.maxLongEdge ?? limits.policy.defaultLongEdgePx;
  if (opts.maxLongEdge === undefined) applied.push(`long edge ${edge} px (policy.defaultLongEdgePx)`);
  if (edge > sideLimit) {
    edge = sideLimit;
    applied.push(`${sideLimit} px per side (${limits.policy.route}${(opts.batch ?? 1) > 20 ? ", more than 20 images" : ""})`);
  }
  const w = size.width * size.dpr;
  const h = size.height * size.dpr;
  const long = Math.max(w, h);
  const scale = long > edge ? edge / long : 1;
  if (scale < 1) applied.push(`scaled ${round3(scale)} to fit ${edge} px`);
  return { width: size.width, height: size.height, dpr: size.dpr, scale, outWidth: Math.round(w * scale), outHeight: Math.round(h * scale), applied };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type EncodeVerdict = { action: "done" } | { action: "accept" } | { action: "fail" } | { action: "retry"; next: EncodeStep };

export interface EncodeStep {
  format: ImageFormat;
  quality?: number;
  /** Output scale relative to the size plan's (1 at the first step). */
  scale: number;
  step: number;
}

/** The first encoding for an image kind: PNG for annotated, line, flat and diagram images; JPEG at the first quality for shaded ones. */
export function firstEncode(kind: ImageKind, limits: TransferLimits, asked?: { format?: ImageFormat; quality?: number }): EncodeStep {
  if (asked?.format) return { format: asked.format, ...(asked.format !== "png" ? { quality: asked.quality ?? limits.policy.jpegQuality[0] } : {}), scale: 1, step: 0 };
  const jpeg = limits.policy.jpegFor.includes(kind) && !limits.policy.pngFor.includes(kind);
  return jpeg ? { format: "jpeg", quality: asked?.quality ?? limits.policy.jpegQuality[0], scale: 1, step: 0 } : { format: "png", scale: 1, step: 0 };
}

/** Kinds that stay PNG and are scaled rather than turned into JPEG (lines must stay crisp). */
const keepsPng = (kind: ImageKind) => kind === "annotated" || kind === "line" || kind === "diagram";

/**
 * After encoding at `step` gave `bytes`: the next step, or `done` (under the
 * target), or `accept` (steps used up, under the hard cap and the route's
 * limit), or `fail` (still over; the caller reports it).
 *
 * Order: JPEG and WebP step quality down the list, then scale by
 * `scaleStep`; a PNG over the hard cap becomes JPEG unless it is line art;
 * line art scales.
 */
export function nextEncodeStep(step: EncodeStep, bytes: number, kind: ImageKind, limits: TransferLimits): EncodeVerdict {
  const p = limits.policy;
  if (bytes <= p.targetBytes) return { action: "done" };
  const cap = Math.min(p.hardMaxRawBytes, routeMaxRawBytes(limits));
  if (step.step + 1 >= p.maxSteps) return bytes <= cap ? { action: "accept" } : { action: "fail" };
  const n = step.step + 1;
  if (step.format !== "png") {
    const qs = p.jpegQuality;
    const i = qs.indexOf(step.quality ?? qs[0]);
    if (i >= 0 && i < qs.length - 1) return { action: "retry", next: { ...step, quality: qs[i + 1], step: n } };
    return { action: "retry", next: { ...step, scale: step.scale * p.scaleStep, step: n } };
  }
  if (bytes > cap && !keepsPng(kind)) return { action: "retry", next: { format: "jpeg", quality: p.jpegQuality[0], scale: step.scale, step: n } };
  return { action: "retry", next: { ...step, scale: step.scale * p.scaleStep, step: n } };
}

// ---------------------------------------------------------------------------------------------
// Retry once on a failed send (runtime-and-workflows.md §4.3)

export interface SentImage {
  width: number;
  height: number;
  format: ImageFormat;
  quality?: number;
  bytes: number;
}

export interface SendError {
  status?: number;
  message: string;
}

export type RetryFix =
  | { action: "scale"; maxSide: number; reason: string }
  | { action: "recompress"; quality: number; scale: number; reason: string }
  | { action: "split"; maxImages: number; maxSide: number; reason: string }
  | { action: "report"; reason: string };

/**
 * What to change after a send failed: the error decides. Dimension errors
 * scale to the route's side limit; "many-image requests" scales to 3,000 px
 * (or splits to 20); 413 / request too large recompresses and scales by
 * 0.75; anything else (auth, rate limit, network) changes nothing.
 */
export function fixForSendError(err: SendError, image: SentImage, limits: TransferLimits, opts: { batch?: number; route?: string } = {}): RetryFix {
  const m = err.message.toLowerCase();
  const route = opts.route ?? limits.policy.route;
  if (/many-image/.test(m)) {
    const r = limits.routes[route] ?? limits.routes[limits.policy.route];
    const side = r?.manyImages?.imageMaxSidePx ?? 3000;
    return (opts.batch ?? 1) > limits.policy.maxImagesPerSend
      ? { action: "split", maxImages: limits.policy.maxImagesPerSend, maxSide: side, reason: "many-image request: split the batch and keep each image within 3,000 px" }
      : { action: "scale", maxSide: side, reason: "many-image request: every image within 3,000 px per side" };
  }
  if (/dimension|exceed[s]? max allowed size|too many pixels|image too large/.test(m) && err.status !== 413) {
    const side = routeMaxSide(limits, opts.batch ?? 1, route);
    return { action: "scale", maxSide: Math.min(side, Math.max(image.width, image.height) - 1), reason: `image dimensions: scale to ${side} px per side` };
  }
  if (err.status === 413 || /request too large|request_too_large|payload too large|too large/.test(m)) {
    const qs = limits.policy.jpegQuality;
    const i = qs.indexOf(image.quality ?? qs[0]);
    const quality = image.format === "png" ? qs[0] : qs[Math.min(qs.length - 1, Math.max(0, i) + 1)];
    return { action: "recompress", quality, scale: 0.75, reason: "request too large: recompress and scale by 0.75" };
  }
  return { action: "report", reason: "not an image-size error (auth, rate limit or network): the image is not changed" };
}

export interface RetryOutcome<T> {
  result: T;
  retried: boolean;
  fix?: RetryFix;
}

/**
 * Send, and on failure fix the image once and send again. `remake` makes the
 * fixed image (re-capture or re-encode) from the fix. A second failure, or a
 * failure the rule does not fix, throws with the route, the sizes tried and
 * both errors.
 */
export async function sendWithRetryOnce<T>(
  image: SentImage,
  send: (img: SentImage) => Promise<T>,
  remake: (fix: Exclude<RetryFix, { action: "report" }>, img: SentImage) => Promise<SentImage>,
  limits: TransferLimits,
  opts: { batch?: number; route?: string } = {},
): Promise<RetryOutcome<T>> {
  const route = opts.route ?? limits.policy.route;
  const describe = (i: SentImage) => `${i.width}x${i.height} ${i.format}${i.quality ? ` q${i.quality}` : ""} ${i.bytes} B`;
  try {
    return { result: await send(image), retried: false };
  } catch (e) {
    const err = toSendError(e);
    const fix = fixForSendError(err, image, limits, opts);
    if (fix.action === "report") throw new Error(`send failed on ${route} (${describe(image)}): ${err.message}; ${fix.reason}`);
    const second = await remake(fix, image);
    try {
      return { result: await send(second), retried: true, fix };
    } catch (e2) {
      throw new Error(`send failed twice on ${route}: first ${describe(image)}: ${err.message}; after "${fix.reason}", ${describe(second)}: ${toSendError(e2).message}. Stopped (retry once); check docs/reference/transfer-limits.json (checked ${limits.checked})`);
    }
  }
}

function toSendError(e: unknown): SendError {
  const o = e as { status?: unknown; statusCode?: unknown; message?: unknown };
  const status = typeof o?.status === "number" ? o.status : typeof o?.statusCode === "number" ? o.statusCode : undefined;
  return { ...(status !== undefined ? { status } : {}), message: String(o?.message ?? e) };
}

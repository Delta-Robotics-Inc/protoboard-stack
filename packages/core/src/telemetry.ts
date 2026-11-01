/**
 * Local-first crash and performance telemetry (PB-1181).
 *
 * Records stay on the machine, in the project: one JSON line per viewer
 * session (plus a partial line each time the page is hidden, so a crash still
 * leaves a record) and one line per crash, appended to
 * `.protoboard/local/telemetry/<yyyy-mm-dd>.jsonl` (UTC date). The folder is
 * git-ignored through `.protoboard/local/` (the init template's ignore list).
 * Nothing is sent: `protoboard telemetry export` assembles a redacted bundle
 * and prints it, and `--send` is a stub against the request shape documented
 * in docs/reference/telemetry.md (the cloud endpoint does not exist yet).
 *
 * Who writes: the VS Code extension host for its webviews (the webview posts,
 * the host appends), `protoboard dev` for the browser viewer (a POST from its
 * page), and the CLI for its own crashes.
 *
 * What is never recorded: source text, file contents, geometry, names of
 * parts, user text, full paths (hashed with a per-project salt), environment
 * variables, tokens. Every record passes through `sanitizeRecord`, which
 * rebuilds it from known fields only (unknown fields are dropped) and redacts
 * every string; a writer never appends what it was given as is.
 *
 * Retention: 30 days or 50 MB per project, whichever comes first, pruned on
 * every write (oldest day files first).
 *
 * The toggle (`telemetryMode`): on by default; off through
 * `PROTOBOARD_TELEMETRY=off`, `DO_NOT_TRACK=1`, the CLI's
 * `<config dir>/telemetry.json` (`protoboard telemetry off`), the extension's
 * `protoboard.telemetry.local`, or VS Code's own telemetry setting: VS Code's
 * telemetry off also stops local recording (DEFAULT, plan.md overnight
 * defaults), and VS Code's `crash` or `error` level keeps crash records only.
 *
 * No network, no VS Code API, no DOM here: the extension, the CLI and the dev
 * server import this file.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the records live, relative to the project root. */
export const TELEMETRY_DIR = join(".protoboard", "local", "telemetry");
/** Consents to send, one line each (never pruned, never exported). */
export const CONSENTS_FILE = "consents.jsonl";
/** The per-project salt for path hashes (never exported). */
export const SALT_FILE = "salt";
/** 30 days or 50 MB per project, whichever comes first (security-updates-telemetry.md D.1). */
export const RETENTION = { maxAgeDays: 30, maxBytes: 50 * 1024 * 1024 } as const;
/** One record never exceeds this as a JSON line; a larger one is refused. */
export const MAX_LINE_BYTES = 64 * 1024;
/** The frame-time histogram's bucket edges in ms (telemetry-headless-state.md 3.5): counts has one more entry (>= the last edge). */
export const FRAME_BUCKETS = [8, 16.7, 33, 50, 100] as const;

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type TelemetryHost = "vscode-webview" | "dev-web" | "vite-web" | "render-service" | "unknown";
export type SessionExit = "closed" | "hidden" | "crash" | "contextLost" | "unknown";

export interface TelemetryVersions {
  stack?: string;
  viewer?: string;
  extension?: string;
  cli?: string;
}

export interface TelemetryError {
  kind: "error" | "unhandledrejection" | "webglcontextlost" | "uncaughtException" | "other";
  /** The error's class (`TypeError`), when it has one. */
  name?: string;
  /** Redacted, at most 160 characters: paths, URLs, quoted strings and long tokens replaced. */
  message?: string;
  /** A hash of the stack (or the message, without one): groups the same crash without carrying it. */
  stackHash?: string;
}

/**
 * One viewer session (`pb.render-session/v0`, telemetry-headless-state.md
 * 3.5, the 15 fields): written when the session ends, and as a partial line
 * (`partial: true`) each time the page is hidden. A reader keeps the last
 * line of a session (`latestSessions`).
 */
export interface RenderSessionRecord {
  schema: "pb.render-session/v0";
  /** 1. A random id for this session (not derived from anything about the user). */
  session: string;
  partial?: boolean;
  /** 2. Timestamps: start, last update, duration. */
  start: string;
  end: string;
  durationMs: number;
  /** 3. Where the viewer ran. */
  host: TelemetryHost;
  /** 4. Stack, viewer and extension versions. */
  versions: TelemetryVersions;
  /** 5. The project as a salted hash of its path (`h:` + 16 hex), never the path. */
  project?: string;
  /** 6. GPU strings and backend (WEBGL_debug_renderer_info; may be blank under privacy settings). */
  gpu?: { backend?: string; vendor?: string; renderer?: string; software?: boolean };
  /** 7. Canvas size and device pixel ratio. */
  viewport?: { w: number; h: number; dpr: number };
  /** 8. Model load: GLB count and bytes; whole-load, fetch, parse, compile times (ms; the slowest load's for each) and first frame after the first model (ms from the session start). */
  load?: { glbs: number; glbBytes: number; loadMs?: number; fetchMs?: number; parseMs?: number; compileMs?: number; firstFrameMs?: number };
  /** 9. `renderer.info` counts, the most seen in one frame. */
  scene?: { calls?: number; triangles?: number; points?: number; lines?: number; programs?: number; geometries?: number; textures?: number };
  /** 10. Frame times: a histogram over FRAME_BUCKETS, p50 and p95 (ms), frames counted. */
  frameMs?: { buckets: number[]; counts: number[]; p50?: number; p95?: number; frames: number };
  /** 11. Long frames (over 50 ms) and the longest. */
  longFrames?: { count: number; maxMs?: number };
  /** 12. Memory where the browser allows (`performance.memory`), else none. */
  memory?: { method: "performance.memory" | "uaSpecific" | "none"; peakBytes?: number };
  /** 13. WebGL context lost and restored. */
  contextLost?: { lost: number; restored: number };
  /** 14. Errors: a count and the first few, hashed. */
  errors?: { count: number; first: TelemetryError[] };
  /** 15. Why the session ended (a partial line says `hidden`). */
  exit: SessionExit;
}

/** A crash outside a viewer session (`pb.crash/v0`): the CLI, the extension host, the dev server. */
export interface CrashRecord {
  schema: "pb.crash/v0";
  time: string;
  kind: "cli" | "extension-host" | "dev-server" | "webview" | "worker";
  /** The command or component that ran (`build`, `dev`); never its arguments. */
  component?: string;
  versions: TelemetryVersions;
  project?: string;
  platform?: { os?: string; arch?: string; node?: string };
  error: TelemetryError;
  session?: string;
}

export type TelemetryRecord = RenderSessionRecord | CrashRecord;

// ---------------------------------------------------------------------------
// Hashing and redaction
// ---------------------------------------------------------------------------

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** A path as the same string on every platform (forward slashes; case-folded on Windows-style drive paths). */
export function normalisePath(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s;
}

/** A salted hash of a path: `h:` and 16 hex characters. Without a salt (tests), a plain hash. */
export function hashPath(path: string, salt = ""): string {
  const n = normalisePath(path);
  return `h:${(salt ? createHmac("sha256", salt).update(n).digest("hex") : sha256(n)).slice(0, 16)}`;
}

/** The telemetry folder of a project root (or `dir` itself when given: the CLI's own folder outside a project). */
export const telemetryDir = (root: string, dir?: string) => dir ?? join(root, TELEMETRY_DIR);

/** The project's salt, created on first use (16 random bytes, hex) in its telemetry folder. */
export function projectSalt(root: string, dirOverride?: string): string {
  const dir = telemetryDir(root, dirOverride);
  const file = join(dir, SALT_FILE);
  try {
    const s = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{32}$/.test(s)) return s;
  } catch {
    // none yet
  }
  const s = randomBytes(16).toString("hex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, s + "\n");
  return s;
}

/** The project's id in records: its root path, hashed with its salt. */
export const projectHash = (root: string, salt = projectSalt(root)) => hashPath(root, salt);

const WIN_PATH = /\b[A-Za-z]:[\\/][^\s"'`<>|,;)]*/g;
const UNC_PATH = /\\\\[^\s"'`<>|,;)]+/g;
const POSIX_PATH = /(^|[\s(=:"'`[])(\/(?:[^\s"'`<>|,;)/]+\/)+[^\s"'`<>|,;)]*)/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()]+/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const QUOTED = /"[^"\n]{1,200}"|'[^'\n]{1,200}'|`[^`\n]{1,200}`/g;
const TOKEN = /\b[A-Za-z0-9_\-+/=]{32,}\b/g;

/**
 * Redacts a string for a record: paths become `<path:h…>` (salted hash),
 * URLs `<url>`, e-mail addresses `<email>`, quoted strings `<str>` (they
 * carry names: a part's, a file's, a user's), long tokens `<secret>`; control
 * characters go; the result is at most `max` characters.
 */
export function redactText(text: string, max = 160, salt = ""): string {
  let s = String(text);
  s = s.replace(URL_RE, "<url>");
  s = s.replace(EMAIL, "<email>");
  s = s.replace(UNC_PATH, (m) => `<path:${hashPath(m, salt).slice(2, 10)}>`);
  s = s.replace(WIN_PATH, (m) => `<path:${hashPath(m, salt).slice(2, 10)}>`);
  s = s.replace(POSIX_PATH, (_m, lead: string, p: string) => `${lead}<path:${hashPath(p, salt).slice(2, 10)}>`);
  s = s.replace(QUOTED, "<str>");
  s = s.replace(TOKEN, "<secret>");
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A stack (or anything identifying an error) as a short hash: groups crashes without carrying the frames. */
export function hashStack(stack: string): string {
  // line and column numbers stay (they tell versions apart); paths are folded so the same crash on two machines hashes alike
  const folded = stack
    .split(/\r?\n/)
    .map((l) => l.replace(/\(?(?:file:\/\/\/?)?(?:[A-Za-z]:)?[^\s()]*[\\/]((?:node_modules[\\/])?[^\s()\\/]+)(:\d+:\d+)\)?/g, "$1$2").trim())
    .filter(Boolean)
    .join("\n");
  return sha256(folded).slice(0, 16);
}

// ---------------------------------------------------------------------------
// Sanitising: every record is rebuilt from known fields
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, max = 1e12): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v * 100) / 100, max) : undefined);
const int = (v: unknown, max = 1e12): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : undefined);
const iso = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? v : undefined);
const version = (v: unknown): string | undefined => (typeof v === "string" && /^[0-9A-Za-z.+-]{1,64}$/.test(v) ? v : undefined);
const hashId = (v: unknown): string | undefined => (typeof v === "string" && /^(h:)?[0-9a-f]{6,64}$/.test(v) ? v : undefined);
const sessionId = (v: unknown): string | undefined => (typeof v === "string" && /^[0-9A-Za-z-]{6,64}$/.test(v) ? v : undefined);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | undefined => (all as readonly unknown[]).includes(v) ? (v as T) : undefined;
const compact = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

const HOSTS: readonly TelemetryHost[] = ["vscode-webview", "dev-web", "vite-web", "render-service", "unknown"];
const EXITS: readonly SessionExit[] = ["closed", "hidden", "crash", "contextLost", "unknown"];
const ERROR_KINDS: readonly TelemetryError["kind"][] = ["error", "unhandledrejection", "webglcontextlost", "uncaughtException", "other"];
const CRASH_KINDS: readonly CrashRecord["kind"][] = ["cli", "extension-host", "dev-server", "webview", "worker"];

function versionsOf(v: unknown): TelemetryVersions {
  if (!isObj(v)) return {};
  return compact({ stack: version(v.stack), viewer: version(v.viewer), extension: version(v.extension), cli: version(v.cli) });
}

function errorOf(v: unknown, salt: string): TelemetryError | undefined {
  if (!isObj(v)) return undefined;
  const kind = oneOf(v.kind, ERROR_KINDS) ?? "other";
  const name = typeof v.name === "string" && /^[A-Za-z_$][\w$]{0,40}$/.test(v.name) ? v.name : undefined;
  const message = typeof v.message === "string" && v.message ? redactText(v.message, 160, salt) : undefined;
  // a stack given in full is hashed here; a hash is kept as it came
  const stackHash = hashId(v.stackHash) ?? (typeof v.stack === "string" && v.stack ? hashStack(v.stack) : undefined);
  return compact({ kind, name, message, stackHash });
}

function counts(v: unknown, keys: readonly string[], max = 1e10): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = int(v[k], max);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Rebuilds a record from its known fields, every string redacted; undefined
 * for anything that is not a record of a known schema. Unknown fields are
 * dropped, so a record can never carry what this function does not name.
 */
export function sanitizeRecord(input: unknown, salt = ""): TelemetryRecord | undefined {
  if (!isObj(input)) return undefined;
  if (input.schema === "pb.render-session/v0") {
    const session = sessionId(input.session);
    const start = iso(input.start);
    if (!session || !start) return undefined;
    const r: RenderSessionRecord = {
      schema: "pb.render-session/v0",
      session,
      ...(input.partial === true ? { partial: true } : {}),
      start,
      end: iso(input.end) ?? start,
      durationMs: int(input.durationMs, 1e10) ?? 0,
      host: oneOf(input.host, HOSTS) ?? "unknown",
      versions: versionsOf(input.versions),
      exit: oneOf(input.exit, EXITS) ?? "unknown",
    };
    const project = hashId(input.project);
    if (project) r.project = project;
    if (isObj(input.gpu)) {
      const g = input.gpu;
      const gpu = compact({
        backend: typeof g.backend === "string" ? redactText(g.backend, 32, salt) : undefined,
        vendor: typeof g.vendor === "string" ? redactText(g.vendor, 120, salt) : undefined,
        renderer: typeof g.renderer === "string" ? redactText(g.renderer, 200, salt) : undefined,
        software: typeof g.software === "boolean" ? g.software : undefined,
      });
      if (Object.keys(gpu).length) r.gpu = gpu;
    }
    if (isObj(input.viewport)) {
      const w = int(input.viewport.w, 1e5), h = int(input.viewport.h, 1e5), dpr = num(input.viewport.dpr, 16);
      if (w !== undefined && h !== undefined && dpr !== undefined) r.viewport = { w, h, dpr };
    }
    if (isObj(input.load)) {
      const l = input.load;
      r.load = compact({ glbs: int(l.glbs, 1e6) ?? 0, glbBytes: int(l.glbBytes) ?? 0, loadMs: num(l.loadMs, 1e8), fetchMs: num(l.fetchMs, 1e8), parseMs: num(l.parseMs, 1e8), compileMs: num(l.compileMs, 1e8), firstFrameMs: num(l.firstFrameMs, 1e8) });
    }
    const scene = counts(input.scene, ["calls", "triangles", "points", "lines", "programs", "geometries", "textures"]);
    if (scene) r.scene = scene;
    if (isObj(input.frameMs) && Array.isArray(input.frameMs.counts)) {
      const f = input.frameMs;
      const c = (f.counts as unknown[]).slice(0, FRAME_BUCKETS.length + 1).map((x) => int(x, 1e10) ?? 0);
      while (c.length < FRAME_BUCKETS.length + 1) c.push(0);
      r.frameMs = compact({ buckets: [...FRAME_BUCKETS], counts: c, p50: num(f.p50, 1e6), p95: num(f.p95, 1e6), frames: int(f.frames, 1e10) ?? c.reduce((a, b) => a + b, 0) });
    }
    if (isObj(input.longFrames)) r.longFrames = compact({ count: int(input.longFrames.count, 1e10) ?? 0, maxMs: num(input.longFrames.maxMs, 1e8) });
    if (isObj(input.memory)) {
      const method = oneOf(input.memory.method, ["performance.memory", "uaSpecific", "none"] as const) ?? "none";
      r.memory = compact({ method, peakBytes: int(input.memory.peakBytes) });
    }
    if (isObj(input.contextLost)) r.contextLost = { lost: int(input.contextLost.lost, 1e6) ?? 0, restored: int(input.contextLost.restored, 1e6) ?? 0 };
    if (isObj(input.errors)) {
      const first = Array.isArray(input.errors.first) ? input.errors.first.slice(0, 5).map((e) => errorOf(e, salt)).filter((e): e is TelemetryError => Boolean(e)) : [];
      r.errors = { count: int(input.errors.count, 1e9) ?? first.length, first };
    }
    return r;
  }
  if (input.schema === "pb.crash/v0") {
    const time = iso(input.time);
    const error = errorOf(input.error, salt);
    if (!time || !error) return undefined;
    const r: CrashRecord = { schema: "pb.crash/v0", time, kind: oneOf(input.kind, CRASH_KINDS) ?? "worker", versions: versionsOf(input.versions), error };
    if (typeof input.component === "string" && /^[a-z][a-z0-9:_-]{0,40}$/.test(input.component)) r.component = input.component;
    const project = hashId(input.project);
    if (project) r.project = project;
    if (isObj(input.platform)) {
      const p = compact({ os: oneOf(input.platform.os, ["win32", "darwin", "linux", "freebsd", "openbsd", "aix", "sunos", "android"] as const), arch: typeof input.platform.arch === "string" && /^[a-z0-9_]{1,16}$/.test(input.platform.arch) ? input.platform.arch : undefined, node: version(input.platform.node) });
      if (Object.keys(p).length) r.platform = p;
    }
    const session = sessionId(input.session);
    if (session) r.session = session;
    return r;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The toggle
// ---------------------------------------------------------------------------

/** `all`: every record; `crash`: crash records and sessions that crashed or had errors; `off`: nothing. */
export type TelemetryMode = "all" | "crash" | "off";

export interface TelemetryInputs {
  /** The process environment (PROTOBOARD_TELEMETRY, DO_NOT_TRACK). */
  env?: Record<string, string | undefined>;
  /** The CLI's `<config dir>/telemetry.json` `local` value. */
  config?: boolean;
  /** The extension's `protoboard.telemetry.local` setting. */
  setting?: boolean;
  /** VS Code: `env.isTelemetryEnabled` and the `telemetry.telemetryLevel` setting (all, error, crash, off). */
  vscode?: { isTelemetryEnabled?: boolean; telemetryLevel?: string };
}

const OFF = /^(0|off|false|no|none|disabled?)$/i;

/**
 * Whether to record, and why. Any "off" wins: the environment
 * (`PROTOBOARD_TELEMETRY=off`, `DO_NOT_TRACK=1`), VS Code's telemetry level
 * `off` (DEFAULT: VS Code's telemetry off also stops local recording), the
 * extension's setting, the CLI's config. VS Code's `crash` or `error` level
 * keeps crash records only; `isTelemetryEnabled` false with no level known
 * counts as off. Nothing turns recording on against one of these.
 */
export function telemetryMode(inputs: TelemetryInputs = {}): { mode: TelemetryMode; reason: string } {
  const env = inputs.env ?? {};
  const pt = env.PROTOBOARD_TELEMETRY?.trim();
  if (pt && OFF.test(pt)) return { mode: "off", reason: "PROTOBOARD_TELEMETRY is off" };
  const dnt = env.DO_NOT_TRACK?.trim();
  if (dnt && dnt !== "0" && !OFF.test(dnt)) return { mode: "off", reason: "DO_NOT_TRACK is set" };
  if (inputs.vscode) {
    const level = inputs.vscode.telemetryLevel?.toLowerCase();
    if (level === "off") return { mode: "off", reason: "VS Code telemetry is off (telemetry.telemetryLevel: off)" };
    if (inputs.setting === false) return { mode: "off", reason: "protoboard.telemetry.local is off" };
    if (level === "crash" || level === "error") return { mode: "crash", reason: `VS Code telemetry level is ${level}: crash records only` };
    if (inputs.vscode.isTelemetryEnabled === false && level !== "all") return { mode: "off", reason: "VS Code telemetry is disabled" };
  }
  if (inputs.setting === false) return { mode: "off", reason: "protoboard.telemetry.local is off" };
  if (inputs.config === false) return { mode: "off", reason: "telemetry is off in the CLI's telemetry.json (protoboard telemetry off)" };
  if (pt && /^crash$/i.test(pt)) return { mode: "crash", reason: "PROTOBOARD_TELEMETRY is crash: crash records only" };
  return { mode: "all", reason: "on (the default): recorded locally only, never sent" };
}

/** Whether a record is kept under a mode. */
export function recordAllowed(record: TelemetryRecord, mode: TelemetryMode): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (record.schema === "pb.crash/v0") return true;
  return record.exit === "crash" || record.exit === "contextLost" || (record.errors?.count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Writing, pruning, reading
// ---------------------------------------------------------------------------

export interface WriteOptions {
  /** Write here instead of the project's folder (the CLI's `<config dir>/telemetry` outside a project). */
  dir?: string;
  now?: Date;
  mode?: TelemetryMode;
  maxBytes?: number;
  maxAgeDays?: number;
  /** The salt for redaction (default: the project's). */
  salt?: string;
}

export interface WriteResult {
  written: boolean;
  file?: string;
  /** Why nothing was written: off, refused (not a record), too large, over the cap. */
  reason?: "off" | "refused" | "too-large" | "cap";
  /** Day files removed by pruning. */
  pruned: string[];
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function dayFiles(dir: string): { name: string; day: string; bytes: number }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: { name: string; day: string; bytes: number }[] = [];
  for (const name of names) {
    const m = DAY_FILE.exec(name);
    if (!m) continue;
    try {
      out.push({ name, day: m[1], bytes: statSync(join(dir, name)).size });
    } catch {
      // gone meanwhile
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Removes day files older than `maxAgeDays`, then the oldest ones while the
 * folder holds more than `maxBytes` (plus `incoming` bytes about to be
 * written); today's file is kept. Returns the names removed.
 */
export function pruneTelemetry(root: string, options: { dir?: string; now?: Date; maxBytes?: number; maxAgeDays?: number; incoming?: number } = {}): string[] {
  const dir = telemetryDir(root, options.dir);
  const now = options.now ?? new Date();
  const maxAge = options.maxAgeDays ?? RETENTION.maxAgeDays;
  const maxBytes = options.maxBytes ?? RETENTION.maxBytes;
  const oldest = dayOf(new Date(now.getTime() - maxAge * 86_400_000));
  const today = dayOf(now);
  const removed: string[] = [];
  const remove = (name: string) => {
    try {
      unlinkSync(join(dir, name));
      removed.push(name);
    } catch {
      // already gone
    }
  };
  let files = dayFiles(dir);
  for (const f of files) if (f.day < oldest) remove(f.name);
  files = files.filter((f) => !removed.includes(f.name));
  let total = files.reduce((a, f) => a + f.bytes, 0) + (options.incoming ?? 0);
  for (const f of files) {
    if (total <= maxBytes) break;
    if (f.day >= today) continue;
    remove(f.name);
    total -= f.bytes;
  }
  return removed;
}

/**
 * Appends one record (sanitised first) to today's file in the project's
 * telemetry folder, pruning first. Never throws: telemetry must not break
 * what it observes, so a failure is a result with `written: false`.
 */
export function appendTelemetry(root: string, record: unknown, options: WriteOptions = {}): WriteResult {
  try {
    if ((options.mode ?? "all") === "off") return { written: false, reason: "off", pruned: [] };
    const salt = options.salt ?? projectSalt(root, options.dir);
    const clean = sanitizeRecord(record, salt);
    if (!clean) return { written: false, reason: "refused", pruned: [] };
    if (!recordAllowed(clean, options.mode ?? "all")) return { written: false, reason: "off", pruned: [] };
    const line = JSON.stringify(clean) + "\n";
    const bytes = Buffer.byteLength(line);
    if (bytes > MAX_LINE_BYTES) return { written: false, reason: "too-large", pruned: [] };
    const now = options.now ?? new Date();
    const dir = telemetryDir(root, options.dir);
    mkdirSync(dir, { recursive: true });
    const pruned = pruneTelemetry(root, { dir: options.dir, now, maxBytes: options.maxBytes, maxAgeDays: options.maxAgeDays, incoming: bytes });
    const left = dayFiles(dir).reduce((a, f) => a + f.bytes, 0);
    if (left + bytes > (options.maxBytes ?? RETENTION.maxBytes)) return { written: false, reason: "cap", pruned };
    const file = join(dir, `${dayOf(now)}.jsonl`);
    appendFileSync(file, line);
    return { written: true, file, pruned };
  } catch {
    return { written: false, reason: "refused", pruned: [] };
  }
}

/** Every record in the project's telemetry folder, oldest day first (lines that do not parse or sanitise are skipped). */
export function readTelemetry(root: string, options: { since?: Date } = {}): TelemetryRecord[] {
  const dir = join(root, TELEMETRY_DIR);
  const since = options.since ? dayOf(options.since) : undefined;
  const out: TelemetryRecord[] = [];
  for (const f of dayFiles(dir)) {
    if (since && f.day < since) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, f.name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        // already sanitised when written; again on the way out, in case the file was edited by hand
        const r = sanitizeRecord(JSON.parse(line));
        if (r) out.push(r);
      } catch {
        // a torn line (a crash mid-write): skipped
      }
    }
  }
  return out;
}

/** One record per viewer session (the last line written for it: the final one, else the latest partial), plus every crash record. */
export function latestSessions(records: TelemetryRecord[]): TelemetryRecord[] {
  const last = new Map<string, number>();
  records.forEach((r, i) => {
    if (r.schema !== "pb.render-session/v0") return;
    const prev = last.get(r.session);
    // the last final line wins; a partial line only replaces another partial one
    if (prev === undefined || !r.partial || (records[prev] as RenderSessionRecord).partial) last.set(r.session, i);
  });
  return records.filter((r, i) => r.schema !== "pb.render-session/v0" || last.get(r.session) === i);
}

/** Sizes and counts for `protoboard telemetry status`. */
export function telemetrySummary(root: string): { dir: string; files: number; bytes: number; sessions: number; crashes: number; oldest?: string; newest?: string } {
  const dir = join(root, TELEMETRY_DIR);
  const files = dayFiles(dir);
  const records = latestSessions(readTelemetry(root));
  return {
    dir,
    files: files.length,
    bytes: files.reduce((a, f) => a + f.bytes, 0),
    sessions: records.filter((r) => r.schema === "pb.render-session/v0").length,
    crashes: records.filter((r) => r.schema === "pb.crash/v0").length,
    ...(files.length ? { oldest: files[0].day, newest: files[files.length - 1].day } : {}),
  };
}

/** Removes every day file (and nothing else: consents and the salt stay). Returns the names removed. */
export function clearTelemetry(root: string): string[] {
  const dir = join(root, TELEMETRY_DIR);
  const removed: string[] = [];
  for (const f of dayFiles(dir)) {
    try {
      unlinkSync(join(dir, f.name));
      removed.push(f.name);
    } catch {
      // gone
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Export and consent to send
// ---------------------------------------------------------------------------

/** What is installed, for the bundle (versions only; no paths). */
export interface VersionInventory {
  stack?: string;
  cli?: string;
  viewer?: string;
  extension?: string;
  node?: string;
  os?: string;
  arch?: string;
}

/** The redacted bundle a person may choose to send (`pb.telemetry-bundle/v0`, docs/reference/telemetry.md). */
export interface TelemetryBundle {
  schema: "pb.telemetry-bundle/v0";
  createdAt: string;
  project: string;
  inventory: VersionInventory;
  range: { from?: string; to?: string };
  counts: { sessions: number; crashes: number };
  records: TelemetryRecord[];
}

/** The POST the `--send` stub would make (docs/reference/telemetry.md, "Send request"). */
export interface SendRequest {
  method: "POST";
  /** DEFAULT: the cloud endpoint does not exist yet (handoff to the cloud team in phase-1/handoffs.md). */
  url: string;
  headers: Record<string, string>;
  body: { kind: "telemetry"; bundleSha256: string; consent: { at: string; recordCount: number }; bundle: TelemetryBundle };
}

export const SEND_ENDPOINT = "https://api.protoboard.ai/v1/reports";

const cleanInventory = (v: VersionInventory): VersionInventory =>
  compact({ stack: version(v.stack), cli: version(v.cli), viewer: version(v.viewer), extension: version(v.extension), node: version(v.node), os: typeof v.os === "string" && /^[a-z0-9]{1,16}$/.test(v.os) ? v.os : undefined, arch: typeof v.arch === "string" && /^[a-z0-9_]{1,16}$/.test(v.arch) ? v.arch : undefined });

/** Canonical JSON (sorted keys) of a value, for hashing. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** The bundle's SHA-256 (hex) over its canonical JSON: what a consent names. */
export const bundleSha256 = (bundle: TelemetryBundle) => sha256(canonical(bundle));

/**
 * The redacted bundle: the project's records (the last line per session, every
 * crash; each sanitised again), the version inventory, counts and the date
 * range. Paths appear only as salted hashes, so nothing in it names a file,
 * a part or a person.
 */
export function buildTelemetryBundle(root: string, inventory: VersionInventory, options: { now?: Date; since?: Date } = {}): TelemetryBundle {
  const salt = projectSalt(root);
  const records = latestSessions(readTelemetry(root, { since: options.since })).map((r) => sanitizeRecord(r, salt)!).filter(Boolean);
  const times = records.map((r) => (r.schema === "pb.crash/v0" ? r.time : r.start)).sort();
  return {
    schema: "pb.telemetry-bundle/v0",
    createdAt: (options.now ?? new Date()).toISOString(),
    project: projectHash(root, salt),
    inventory: cleanInventory(inventory),
    range: compact({ from: times[0], to: times[times.length - 1] }),
    counts: { sessions: records.filter((r) => r.schema === "pb.render-session/v0").length, crashes: records.filter((r) => r.schema === "pb.crash/v0").length },
    records,
  };
}

/** The request `--send` describes (and, while the endpoint does not exist, does not make). */
export function sendRequest(bundle: TelemetryBundle, at = new Date()): SendRequest {
  const hash = bundleSha256(bundle);
  return {
    method: "POST",
    url: SEND_ENDPOINT,
    headers: { "content-type": "application/json", "x-protoboard-bundle-sha256": hash },
    body: { kind: "telemetry", bundleSha256: hash, consent: { at: at.toISOString(), recordCount: bundle.records.length }, bundle },
  };
}

export interface ConsentRecord {
  schema: "pb.telemetry-consent/v0";
  at: string;
  bundleSha256: string;
  recordCount: number;
  destination: string;
  /** False while the endpoint is a stub: the consent was given, nothing left the machine. */
  sent: boolean;
  /** The id the service returned, once there is one. */
  receipt?: string;
}

/** Appends a consent line to the project's `consents.jsonl` (kept through pruning and `clear`). */
export function recordConsent(root: string, consent: Omit<ConsentRecord, "schema">): ConsentRecord {
  const dir = join(root, TELEMETRY_DIR);
  mkdirSync(dir, { recursive: true });
  const line: ConsentRecord = { schema: "pb.telemetry-consent/v0", ...consent };
  appendFileSync(join(dir, CONSENTS_FILE), JSON.stringify(line) + "\n");
  return line;
}

/** The consents given in a project, oldest first. */
export function readConsents(root: string): ConsentRecord[] {
  const file = join(root, TELEMETRY_DIR, CONSENTS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const c = JSON.parse(l) as ConsentRecord;
        return c.schema === "pb.telemetry-consent/v0" ? [c] : [];
      } catch {
        return [];
      }
    });
}

/**
 * A viewer's record as a writer stores it: the writer (not the page) names
 * the host, the project (salted hash) and the versions it knows, so a page
 * never sees the project's path or salt. Anything else in `record` is kept
 * as it came and sanitised on write.
 */
export function enrichViewerRecord(root: string, record: unknown, writer: { host: TelemetryHost; versions?: TelemetryVersions; dir?: string }): unknown {
  if (!isObj(record) || record.schema !== "pb.render-session/v0") return record;
  const versions = { ...(isObj(record.versions) ? record.versions : {}), ...compact({ ...(writer.versions ?? {}) }) };
  return { ...record, host: writer.host, project: projectHash(root, projectSalt(root, writer.dir)), versions };
}

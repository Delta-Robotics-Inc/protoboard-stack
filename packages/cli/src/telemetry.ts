/**
 * `protoboard telemetry` (PB-1181): local crash and performance records, and
 * the consent-to-send flow. Records live in the project's
 * `.protoboard/local/telemetry/` (@protoboardai/core's telemetry.ts writes
 * and prunes them); nothing leaves the machine.
 *
 *   protoboard telemetry [status]     whether recording is on and why, what is stored
 *   protoboard telemetry show         the records (one line per session, every crash), as JSON lines
 *   protoboard telemetry export       the redacted bundle: printed whole, written to a file (--out)
 *   protoboard telemetry export --send
 *                                     the same, then the send STUB: prints the POST it would make
 *                                     (docs/reference/telemetry.md), records the consent (date,
 *                                     bundle SHA-256) in consents.jsonl, sends nothing
 *   protoboard telemetry clear        removes the records (consents stay)
 *   protoboard telemetry on|off       the CLI's own switch (<config dir>/telemetry.json)
 *
 * `PROTOBOARD_TELEMETRY=off` (or `DO_NOT_TRACK=1`) turns recording off for a
 * process, whatever the config says.
 *
 * Also the CLI's crash hook (`installCrashTelemetry`): an uncaught exception
 * appends a `pb.crash/v0` record (the command name, the error's class, a
 * redacted message and a hash of the stack; never arguments) to the project's
 * folder, or to `<config dir>/telemetry/` outside a project. It listens on
 * `uncaughtExceptionMonitor`, so Node's own handling (print, exit 1) is
 * unchanged: append only, synchronous, never blocks or changes the exit.
 *
 * The wiring into `cli/src/index.ts` (the `case "telemetry"`, the `--send`
 * and `--out` flags, the help lines, the crash hook at start-up) and the MCP
 * tool `telemetry_export` belong to W1-B; see phase-1/handoffs.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "@protoboardai/core/account";
// TODO(W1-B handoff): `@protoboardai/core/telemetry` once core/package.json exports it; the relative path
// works in the checkout and in an installed stack (node_modules/@protoboardai/{cli,core}) alike
import {
  TELEMETRY_DIR,
  appendTelemetry,
  buildTelemetryBundle,
  bundleSha256,
  clearTelemetry,
  latestSessions,
  readConsents,
  readTelemetry,
  recordConsent,
  redactText,
  sendRequest,
  telemetryMode,
  telemetrySummary,
  type ConsentRecord,
  type CrashRecord,
  type SendRequest,
  type TelemetryBundle,
  type TelemetryMode,
  type VersionInventory,
} from "@protoboardai/core/telemetry";

const require = createRequire(import.meta.url);

/** The CLI's switch file in the per-user config folder. */
export const CONFIG_FILE = "telemetry.json";

/** `<config dir>/telemetry.json`'s `local` (undefined: never set, so on). */
export function readCliSwitch(env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  try {
    const v = JSON.parse(readFileSync(join(configDir(env), CONFIG_FILE), "utf8")) as { local?: unknown };
    return typeof v.local === "boolean" ? v.local : undefined;
  } catch {
    return undefined;
  }
}

export function writeCliSwitch(on: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, CONFIG_FILE);
  writeFileSync(file, JSON.stringify({ local: on }, null, 2) + "\n");
  return file;
}

/** The mode for the CLI and the dev server: the environment, then the CLI's switch (no VS Code here). */
export function cliTelemetryMode(env: NodeJS.ProcessEnv = process.env): { mode: TelemetryMode; reason: string } {
  return telemetryMode({ env, config: readCliSwitch(env) });
}

const readVersion = (file: string): string | undefined => {
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
};

/** Versions only: the stack (core), the CLI, the viewer, Node, the platform. No paths. */
export function versionInventory(): VersionInventory {
  const here = dirname(fileURLToPath(import.meta.url));
  let viewer: string | undefined;
  try {
    viewer = readVersion(require.resolve("@deltarobotics/uhd-viewer/package.json"));
  } catch {
    viewer = undefined;
  }
  const inv: VersionInventory = {
    stack: readVersion(join(here, "..", "..", "core", "package.json")),
    cli: readVersion(join(here, "..", "package.json")),
    viewer,
    node: process.versions.node,
    os: process.platform,
    arch: process.arch,
  };
  for (const k of Object.keys(inv) as (keyof VersionInventory)[]) if (inv[k] === undefined) delete inv[k];
  return inv;
}

/** The project holding `from` (a folder with protoboard.config.ts), walking up; light, for the crash hook. */
export function projectRootOf(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "protoboard.config.ts"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

// ---------------------------------------------------------------------------
// Export and the send stub (shared with the MCP tool)
// ---------------------------------------------------------------------------

export interface TelemetryExportOptions {
  root: string;
  /** Only records from the last n days. */
  days?: number;
  /** Where to write the bundle (default `.protoboard/local/telemetry/export-<time>.json`). */
  out?: string;
  /** Go on to the send stub (records the consent). */
  send?: boolean;
  /** Required with `send` from the MCP tool: the person saw this bundle and agreed. The CLI's `--send` is that consent. */
  confirm?: boolean;
  now?: Date;
  inventory?: VersionInventory;
}

export interface TelemetryExportResult {
  bundle: TelemetryBundle;
  sha256: string;
  file: string;
  /** Present with `send`: the request the stub describes. */
  request?: SendRequest;
  consent?: ConsentRecord;
  /** Always false in phase 1: the endpoint is a stub. */
  sent: false;
  note: string;
}

/**
 * Builds the redacted bundle and writes it; with `send` and `confirm`,
 * records the consent and returns the request the stub would make. Never
 * touches the network.
 */
export function telemetryExport(options: TelemetryExportOptions): TelemetryExportResult {
  const now = options.now ?? new Date();
  const since = options.days ? new Date(now.getTime() - options.days * 86_400_000) : undefined;
  const bundle = buildTelemetryBundle(options.root, options.inventory ?? versionInventory(), { now, since });
  const sha256 = bundleSha256(bundle);
  const file = options.out ? resolve(options.out) : join(options.root, TELEMETRY_DIR, `export-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(bundle, null, 2) + "\n");
  if (!options.send) {
    return { bundle, sha256, file, sent: false, note: "Nothing was sent. This is exactly what a send would carry; send it with `protoboard telemetry export --send` (or the MCP tool telemetry_export with send and confirm)." };
  }
  if (!options.confirm) throw new Error("telemetry export: send needs confirm: show the person this bundle first, then call again with confirm: true");
  const request = sendRequest(bundle, now);
  // DEFAULT (plan.md): the cloud endpoint does not exist yet, so the stub records the consent and stops here
  const consent = recordConsent(options.root, { at: now.toISOString(), bundleSha256: sha256, recordCount: bundle.records.length, destination: request.url, sent: false });
  return { bundle, sha256, file, request, consent, sent: false, note: `Consent recorded (bundle sha256 ${sha256}). Nothing left this machine: the endpoint ${request.url} is not live yet (a stub).` };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export interface TelemetryCommandOptions {
  cwd: string;
  send?: boolean;
  out?: string;
  days?: number;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface TelemetryCommandResult {
  /** What `--json` prints. */
  data: unknown;
  /** What a person sees. */
  text: string;
  exitCode: number;
}

export const TELEMETRY_USAGE = "usage: protoboard telemetry [status|show|export|clear|on|off] [--days <n>] [--out <file>] [--send]";

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} kB` : `${(n / (1 << 20)).toFixed(1)} MB`);

/** Runs `protoboard telemetry <sub>`; the caller prints `text` or `data` (with --json). */
export function telemetryCommand(args: string[], options: TelemetryCommandOptions): TelemetryCommandResult {
  const env = options.env ?? process.env;
  const sub = args[0] ?? "status";
  if (sub === "on" || sub === "off") {
    const file = writeCliSwitch(sub === "on", env);
    const m = cliTelemetryMode(env);
    return { data: { local: sub === "on", file, mode: m.mode, reason: m.reason }, text: `telemetry ${sub} (${file}); recording now: ${m.mode} (${m.reason})`, exitCode: 0 };
  }
  const root = projectRootOf(options.cwd);
  if (!root) return { data: { error: "not in a Protoboard project" }, text: "not in a Protoboard project (no protoboard.config.ts here or above); telemetry is recorded per project", exitCode: 1 };
  switch (sub) {
    case "status": {
      const m = cliTelemetryMode(env);
      const s = telemetrySummary(root);
      const consents = readConsents(root);
      const text = [
        `recording: ${m.mode} (${m.reason})`,
        `stored: ${s.files} day file(s), ${kb(s.bytes)} in ${TELEMETRY_DIR.split("\\").join("/")}${s.oldest ? `, ${s.oldest} to ${s.newest}` : ""} (kept 30 days or 50 MB)`,
        `records: ${s.sessions} viewer session(s), ${s.crashes} crash(es)`,
        `consents to send: ${consents.length}${consents.length ? ` (last ${consents[consents.length - 1].at})` : ""}`,
        "nothing is sent; `protoboard telemetry export` shows what a report would carry",
      ].join("\n");
      return { data: { mode: m.mode, reason: m.reason, ...s, consents: consents.length }, text, exitCode: 0 };
    }
    case "show": {
      const now = options.now ?? new Date();
      const since = options.days ? new Date(now.getTime() - options.days * 86_400_000) : undefined;
      const records = latestSessions(readTelemetry(root, { since }));
      return { data: records, text: records.map((r) => JSON.stringify(r)).join("\n") || "no records", exitCode: 0 };
    }
    case "export": {
      const r = telemetryExport({ root, days: options.days, out: options.out, send: options.send, confirm: options.send, now: options.now });
      const lines = [
        "This is exactly what would be sent (nothing else is):",
        JSON.stringify(r.bundle, null, 2),
        "",
        `bundle: ${r.bundle.records.length} record(s), sha256 ${r.sha256}`,
        `written to ${r.file}`,
      ];
      if (r.request) lines.push("", "send (STUB, not made):", `${r.request.method} ${r.request.url}`, ...Object.entries(r.request.headers).map(([k, v]) => `${k}: ${v}`), `consent recorded: ${r.consent!.at}, sha256 ${r.consent!.bundleSha256}`);
      lines.push(r.note);
      return { data: { sha256: r.sha256, file: r.file, sent: r.sent, ...(r.request ? { request: { method: r.request.method, url: r.request.url, headers: r.request.headers } } : {}), ...(r.consent ? { consent: r.consent } : {}), bundle: r.bundle, note: r.note }, text: lines.join("\n"), exitCode: 0 };
    }
    case "clear": {
      const removed = clearTelemetry(root);
      return { data: { removed }, text: `removed ${removed.length} day file(s); consents kept`, exitCode: 0 };
    }
    default:
      return { data: { error: TELEMETRY_USAGE }, text: TELEMETRY_USAGE, exitCode: 2 };
  }
}

// ---------------------------------------------------------------------------
// The crash hook
// ---------------------------------------------------------------------------

/** The `pb.crash/v0` record for an error (exported for tests). */
export function crashRecord(error: unknown, options: { component?: string; origin?: string; now?: Date; versions?: VersionInventory } = {}): CrashRecord {
  const e = error instanceof Error ? error : undefined;
  const inv = options.versions ?? {};
  return {
    schema: "pb.crash/v0",
    time: (options.now ?? new Date()).toISOString(),
    kind: "cli",
    ...(options.component && /^[a-z][a-z0-9:_-]{0,40}$/.test(options.component) ? { component: options.component } : {}),
    versions: { ...(inv.stack ? { stack: inv.stack } : {}), ...(inv.cli ? { cli: inv.cli } : {}) },
    platform: { os: process.platform, arch: process.arch, node: process.versions.node },
    error: {
      kind: options.origin === "unhandledRejection" ? "unhandledrejection" : "uncaughtException",
      ...(e?.name && /^[A-Za-z_$][\w$]{0,40}$/.test(e.name) ? { name: e.name } : {}),
      message: redactText(e ? e.message : String(error), 160),
      // the stack is hashed by the writer (sanitizeRecord); it is never stored
      ...(e?.stack ? ({ stack: e.stack } as object) : {}),
    },
  } as CrashRecord;
}

/**
 * Appends a crash record when the process dies of an uncaught exception or
 * rejection. Returns the uninstall. `component` is the command name (never
 * its arguments).
 */
export function installCrashTelemetry(options: { component?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): () => void {
  const env = options.env ?? process.env;
  const listener = (error: unknown, origin: string) => {
    try {
      const { mode } = cliTelemetryMode(env);
      if (mode === "off") return;
      const root = projectRootOf(options.cwd ?? process.cwd());
      const record = crashRecord(error, { component: options.component, origin, versions: versionInventory() });
      if (root) appendTelemetry(root, record, { mode });
      else appendTelemetry(configDir(env), record, { mode, dir: join(configDir(env), "telemetry") });
    } catch {
      // never let telemetry change how the process dies
    }
  };
  process.on("uncaughtExceptionMonitor", listener);
  return () => void process.off("uncaughtExceptionMonitor", listener);
}

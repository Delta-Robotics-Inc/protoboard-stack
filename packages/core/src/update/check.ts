/**
 * The update and vulnerability check (PB-1168).
 *
 * Compares the inventory (inventory.ts) with the npm registry and OSV.dev
 * (sources.ts) and the lookalike deny list (lookalikes.ts), and classifies
 * every finding as one of:
 *
 *   - `vulnerable`        an OSV advisory (or a MAL- malicious-package report)
 *                         names an installed exact version;
 *   - `lookalike`         a deny-listed name is installed (critical), or a
 *                         watched or suspected one (a warning);
 *   - `update-available`  a newer release of a Protoboard package
 *                         (@protoboardai/*, @deltarobotics/*) is on npm;
 *
 * and the whole run as the worst of these, or `ok`. Newer versions of the
 * third-party libraries the stack pins are not end-user updates (a pin moves
 * only in a stack release, through the vetting gate) and are not reported.
 *
 * It never installs, upgrades, edits a lockfile or runs anything it
 * downloaded. The person runs the command the finding names.
 *
 * Cadence and state (DEFAULT, overnight build; the design note's 24 h + 0-4 h
 * became 24 h + 0-6 h per the PB-1168 brief):
 *   - at most once a day per project: next due = last success + 24 h + a
 *     random jitter of up to 6 h, so many machines do not hit the registries
 *     in the same minute; after a failure, retry in 1 h, then 4 h, then the
 *     normal day;
 *   - state in `<project>/.protoboard/local/update-check.json` (git-ignored
 *     by the init template); the toast and the CLI read the same file;
 *   - on by default; off with the setting (`protoboard.updates.check` in VS
 *     Code, `protoboard update off` for the CLI, which writes
 *     `<config dir>/update-check.json`), `PROTOBOARD_NO_UPDATE_CHECK=1`,
 *     `PROTOBOARD_UPDATE_CHECK=off` or `NO_UPDATE_NOTIFIER`; automatic runs
 *     are also off in CI and under a test runner. Off means nothing is sent.
 *   - no telemetry coupling: the telemetry setting neither enables nor
 *     disables it, and it records nothing in the telemetry folder;
 *   - never blocks a build: the automatic run is a background task whose
 *     errors are swallowed; the overall budget is MAX_CHECK_MS.
 */
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "../account.js";
import { compareVersions, isDevVersion } from "../stack.js";
import { queryablePackages, readInventory, type Inventory, type InventoryOptions } from "./inventory.js";
import { loadLookalikes, scanNames, type LookalikeList } from "./lookalikes.js";
import { npmDistTags, osvDetails, osvQueryBatch, severityRank, type Severity, type SourceContext, type UpdateFetcher, type VulnDetail } from "./sources.js";

export const STATE_SCHEMA = "protoboard.update-check/v0";
export const RESULT_SCHEMA = "protoboard.update-check-result/v0";
/** Relative to the project root. */
export const STATE_FILE = join(".protoboard", "local", "update-check.json");
/** The CLI's machine-wide switch, in `<config dir>`. */
export const SWITCH_FILE = "update-check.json";
export const DAY_MS = 24 * 60 * 60 * 1000;
/** DEFAULT: up to 6 h of random jitter after the day. */
export const MAX_JITTER_MS = 6 * 60 * 60 * 1000;
/** DEFAULT: retries after a failure. */
export const RETRY_MS = [60 * 60 * 1000, 4 * 60 * 60 * 1000];
/** DEFAULT: the whole check's budget (each request has its own 10 s). */
export const MAX_CHECK_MS = 30_000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;

export type FindingKind = "vulnerable" | "lookalike" | "update-available";
export type CheckStatus = "vulnerable" | "lookalike" | "update-available" | "ok" | "offline" | "off";

export interface UpdateFinding {
  kind: FindingKind;
  /** Stable across runs: what a dismissal is keyed on (`kind:ecosystem:name`). */
  key: string;
  ecosystem: "npm" | "PyPI";
  name: string;
  /** The installed version. */
  version?: string;
  /** update-available: the newer version. */
  latest?: string;
  severity: Severity | "info" | "warning";
  /** vulnerable: OSV ids (and aliases such as GHSA or CVE ids). */
  ids?: string[];
  summary?: string;
  /** vulnerable: versions that fix it, from the advisory. */
  fixed?: string[];
  role?: string;
  /** npm: a development dependency of the stack (a checkout's tooling; an installed stack has none). */
  dev?: boolean;
  /** One line a person reads. */
  message: string;
  /** What to run or do; never run by the check. */
  fix?: string;
  url?: string;
}

export interface UpdateCheckResult {
  schema: typeof RESULT_SCHEMA;
  at: string;
  status: CheckStatus;
  /** Why the status is off or offline. */
  reason?: string;
  findings: UpdateFinding[];
  counts: { components: number; queried: number; vulnerable: number; lookalikes: number; updates: number };
  sources: { npm: "ok" | "failed" | "skipped"; osv: "ok" | "failed" | "skipped"; lookalikes: "ok" | "failed" };
  errors: string[];
  /** Protoboard packages the public npm registry does not have (a private or beta build). */
  notPublished?: string[];
  network: { requests: number; hosts: string[] };
  durationMs: number;
  stack?: string;
}

export interface UpdateCheckState {
  schema: typeof STATE_SCHEMA;
  lastAttempt?: string;
  lastSuccess?: string;
  nextDue?: string;
  failures: number;
  result?: UpdateCheckResult;
  /** Finding key → the version (installed or latest) the person said not to show again. */
  dismissed: Record<string, string>;
  /** Finding key → when the CLI last printed it (so a line is printed once per finding and version). */
  shown?: Record<string, string>;
}

// ---------------------------------------------------------------- the switch

export interface EnabledInputs {
  env?: NodeJS.ProcessEnv;
  /** The VS Code setting `protoboard.updates.check` (undefined: not set, so on). */
  setting?: boolean;
  /** An automatic run (activation, after a CLI command), as opposed to `protoboard update check`. */
  auto?: boolean;
}

const OFF = /^(0|off|false|no)$/i;

/** Whether the check may use the network, and why not. */
export function updateCheckEnabled(inputs: EnabledInputs = {}): { enabled: boolean; reason: string } {
  const env = inputs.env ?? process.env;
  if (env.PROTOBOARD_NO_UPDATE_CHECK && !OFF.test(env.PROTOBOARD_NO_UPDATE_CHECK)) return { enabled: false, reason: "PROTOBOARD_NO_UPDATE_CHECK is set" };
  if (env.PROTOBOARD_UPDATE_CHECK && OFF.test(env.PROTOBOARD_UPDATE_CHECK)) return { enabled: false, reason: "PROTOBOARD_UPDATE_CHECK is off" };
  if (env.NO_UPDATE_NOTIFIER) return { enabled: false, reason: "NO_UPDATE_NOTIFIER is set" };
  if (inputs.setting === false) return { enabled: false, reason: "protoboard.updates.check is off" };
  const cli = readCliSwitch(env);
  if (cli === false) return { enabled: false, reason: "turned off with protoboard update off" };
  if (inputs.auto) {
    if (env.CI && !OFF.test(env.CI)) return { enabled: false, reason: "CI is set (automatic checks are off in CI)" };
    if (env.VITEST || env.NODE_ENV === "test") return { enabled: false, reason: "a test runner is running (automatic checks are off in tests)" };
  }
  return { enabled: true, reason: "on (the default)" };
}

/** `<config dir>/update-check.json`'s `enabled` (undefined: never set). */
export function readCliSwitch(env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  try {
    const file = join(configDir(env), SWITCH_FILE);
    if (statSync(file).size > 64 * 1024) return undefined;
    const v = JSON.parse(readFileSync(file, "utf8")) as { enabled?: unknown };
    return typeof v.enabled === "boolean" ? v.enabled : undefined;
  } catch {
    return undefined;
  }
}

export function writeCliSwitch(enabled: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, SWITCH_FILE);
  writeFileSync(file, JSON.stringify({ enabled }, null, 2) + "\n");
  return file;
}

// ---------------------------------------------------------------- state

export const statePath = (root: string) => join(root, STATE_FILE);

export function readState(root: string): UpdateCheckState {
  try {
    const file = statePath(root);
    if (statSync(file).size > MAX_STATE_BYTES) throw new Error("too big");
    const s = JSON.parse(readFileSync(file, "utf8")) as UpdateCheckState;
    if (s.schema === STATE_SCHEMA) return { ...s, failures: Number.isInteger(s.failures) ? s.failures : 0, dismissed: s.dismissed && typeof s.dismissed === "object" ? s.dismissed : {} };
  } catch {
    // absent, unreadable or not ours: a fresh state
  }
  return { schema: STATE_SCHEMA, failures: 0, dismissed: {} };
}

export function writeState(root: string, state: UpdateCheckState): void {
  const file = statePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

/** Whether an automatic check is due now. */
export function isDue(state: UpdateCheckState, now = new Date()): boolean {
  if (!state.nextDue) return true;
  const t = Date.parse(state.nextDue);
  return !Number.isFinite(t) || now.getTime() >= t;
}

/** The next due time after a success (day + jitter) or a failure (backoff). */
export function nextDueAfter(ok: boolean, failures: number, now = new Date(), jitter: (max: number) => number = (max) => randomInt(0, max + 1)): string {
  if (ok) return new Date(now.getTime() + DAY_MS + jitter(MAX_JITTER_MS)).toISOString();
  const wait = failures <= RETRY_MS.length ? RETRY_MS[Math.max(0, failures - 1)] : DAY_MS;
  return new Date(now.getTime() + wait).toISOString();
}

/** Records a dismissal ("Don't show for this version"). */
export function dismissFinding(root: string, finding: Pick<UpdateFinding, "key" | "version" | "latest">): void {
  const s = readState(root);
  s.dismissed[finding.key] = finding.latest ?? finding.version ?? "*";
  writeState(root, s);
}

/** Whether a finding was dismissed for the version it now names. */
export const isDismissed = (state: Pick<UpdateCheckState, "dismissed">, f: Pick<UpdateFinding, "key" | "version" | "latest">) => {
  const d = state.dismissed[f.key];
  return d !== undefined && (d === "*" || d === (f.latest ?? f.version));
};

// ---------------------------------------------------------------- the check

export interface CheckOptions {
  root?: string;
  /** Run even when not due (`--force`). The switch still applies: off means nothing is sent. */
  force?: boolean;
  /** An automatic run (see updateCheckEnabled). */
  auto?: boolean;
  /** The VS Code setting, when the extension runs it. */
  setting?: boolean;
  env?: NodeJS.ProcessEnv;
  fetcher?: UpdateFetcher;
  now?: Date;
  /** A precomputed inventory (else read here). */
  inventory?: Inventory;
  inventoryOptions?: Omit<InventoryOptions, "root" | "env">;
  lookalikes?: LookalikeList;
  /** Write the state file (default true when there is a root). */
  writeState?: boolean;
  jitter?: (max: number) => number;
}

const findingOrder = (a: UpdateFinding, b: UpdateFinding) => {
  const k = (f: UpdateFinding) => (f.kind === "vulnerable" ? 0 : f.kind === "lookalike" ? (f.severity === "critical" ? 0 : 1) : 2);
  const sev = (s: UpdateFinding["severity"]) => (s === "info" ? 7 : s === "warning" ? 4 : severityRank(s as Severity));
  return k(a) - k(b) || sev(a.severity) - sev(b.severity) || a.name.localeCompare(b.name);
};

function summarise(findings: UpdateFinding[]): CheckStatus {
  if (findings.some((f) => f.kind === "vulnerable" || (f.kind === "lookalike" && f.severity === "critical"))) return findings.some((f) => f.kind === "vulnerable") ? "vulnerable" : "lookalike";
  if (findings.some((f) => f.kind === "lookalike")) return "lookalike";
  if (findings.some((f) => f.kind === "update-available")) return "update-available";
  return "ok";
}

const ourPackage = (name: string) => name.startsWith("@protoboardai/") || name.startsWith("@deltarobotics/");

/** The command a person runs to update the stack (never run by the check). */
export function updateCommandFor(inv: Inventory): string {
  if (inv.vscodeExtension) return "update the Protoboard extension in VS Code (Extensions view), then reopen the project";
  // install scripts stay off for anything the person installs on our advice (security-updates-telemetry.md B.3)
  return "npm install -g @protoboardai/cli@latest --ignore-scripts (or update the project's @protoboardai packages)";
}

/**
 * Runs the check. Offline or with the check off it still returns the local
 * findings (the lookalike scan needs no network) and never throws.
 */
export async function runUpdateCheck(options: CheckOptions = {}): Promise<UpdateCheckResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const errors: string[] = [];
  const inv = options.inventory ?? readInventory({ ...(options.inventoryOptions ?? {}), ...(options.root ? { root: options.root } : {}), env, now });
  const findings: UpdateFinding[] = [];
  const sources: UpdateCheckResult["sources"] = { npm: "skipped", osv: "skipped", lookalikes: "ok" };
  const log = { requests: 0, hosts: new Set<string>() };
  const notPublished: string[] = [];

  // 1. lookalikes: local, always
  try {
    const list = options.lookalikes ?? loadLookalikes();
    const names = inv.components.filter((c) => c.kind === "npm" || c.kind === "pypi").map((c) => ({ name: c.name, ecosystem: c.kind === "npm" ? ("npm" as const) : ("PyPI" as const) }));
    for (const v of scanNames(names, list)) {
      const c = inv.components.find((x) => x.name === v.name);
      const critical = v.verdict === "deny";
      findings.push({
        kind: "lookalike",
        key: `lookalike:${v.ecosystem}:${v.name}`,
        ecosystem: v.ecosystem,
        name: v.name,
        ...(c?.version ? { version: c.version } : {}),
        severity: critical ? "critical" : "warning",
        ...(c?.role ? { role: c.role } : {}),
        message: critical ? `${v.name} is on the lookalike deny list${v.resembles ? ` (imitates ${v.resembles})` : ""}` : `${v.name} ${v.verdict === "watch" ? "is on the lookalike watch list" : `may be a lookalike of ${v.resembles}`}`,
        fix: critical ? `remove ${v.name}; find what installed it (npm ls ${v.name}); nothing was deleted` : `check that ${v.name} is the package you meant (its repository link and publisher)`,
        ...(v.reason ? { summary: v.reason } : {}),
      });
    }
  } catch (e) {
    sources.lookalikes = "failed";
    errors.push(`lookalike list: ${(e as Error).message}`);
  }

  const gate = updateCheckEnabled({ env, setting: options.setting, auto: options.auto });
  const queries = queryablePackages(inv);
  let status: CheckStatus | undefined;
  let reason: string | undefined;
  if (!gate.enabled) {
    status = "off";
    reason = gate.reason;
  } else {
    const fetcher = options.fetcher ?? (globalThis.fetch as unknown as UpdateFetcher | undefined);
    if (!fetcher) {
      status = "offline";
      reason = "no fetch in this runtime";
    } else {
      const budget = AbortSignal.timeout(MAX_CHECK_MS);
      const ctx: SourceContext = { fetcher, userAgent: `protoboard-update-check/${inv.stack.version ?? "unknown"}`, signal: budget, log };
      const ours = inv.components.filter((c) => c.kind === "npm" && ourPackage(c.name) && c.version);
      const [npm, osv] = await Promise.allSettled([npmDistTags(ctx, ours.map((c) => c.name)), osvQueryBatch(ctx, queries)]);

      // 2. npm: newer Protoboard releases
      if (npm.status === "fulfilled") {
        const failed = npm.value.filter((t) => t.status === "failed");
        sources.npm = failed.length === npm.value.length && npm.value.length ? "failed" : "ok";
        for (const f of failed) errors.push(`npm ${f.name}: ${f.error}`);
        for (const t of npm.value) if (t.status === "not-published") notPublished.push(t.name);
        for (const t of npm.value) {
          const c = ours.find((x) => x.name === t.name);
          const latest = t.tags?.latest;
          if (!c?.version || !latest) continue;
          // a development build is compared with the release it leads to only when that release is out
          if (compareVersions(latest, c.version) > 0) {
            findings.push({
              kind: "update-available",
              key: `update-available:npm:${t.name}`,
              ecosystem: "npm",
              name: t.name,
              version: c.version,
              latest,
              severity: "info",
              role: c.role,
              message: `${t.name} ${latest} is available (you have ${c.version}${isDevVersion(c.version) ? ", a development build" : ""})`,
              fix: updateCommandFor(inv),
              url: `https://www.npmjs.com/package/${t.name}`,
            });
          }
        }
      } else {
        sources.npm = "failed";
        errors.push(`npm: ${(npm.reason as Error)?.message ?? String(npm.reason)}`);
      }

      // 3. OSV: advisories for the exact installed versions
      if (osv.status === "fulfilled") {
        sources.osv = "ok";
        const ids = osv.value.flatMap((h) => h.ids);
        let details = new Map<string, VulnDetail>();
        try {
          if (ids.length) details = await osvDetails(ctx, ids);
        } catch (e) {
          errors.push(`osv details: ${(e as Error).message}`);
        }
        for (const h of osv.value) {
          const ds = h.ids.map((id) => details.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
          const worst = ds.map((d) => d.severity).sort((a, b) => severityRank(a) - severityRank(b))[0] ?? (h.ids.some((id) => /^MAL-/i.test(id)) ? "malicious" : "unknown");
          const fixed = [...new Set(ds.flatMap((d) => d.fixed[h.query.name] ?? []))].sort(compareVersions);
          const newer = fixed.filter((v) => compareVersions(v, h.query.version) > 0);
          const c = inv.components.find((x) => x.name === h.query.name && x.version === h.query.version);
          const allIds = [...new Set([...h.ids, ...ds.flatMap((d) => d.aliases)])];
          findings.push({
            kind: "vulnerable",
            key: `vulnerable:${h.query.ecosystem}:${h.query.name}`,
            ecosystem: h.query.ecosystem,
            name: h.query.name,
            version: h.query.version,
            severity: worst,
            ids: allIds,
            ...(ds.find((d) => d.summary)?.summary ? { summary: ds.find((d) => d.summary)!.summary } : {}),
            ...(newer.length ? { fixed: newer } : {}),
            ...(c?.role ? { role: c.role } : {}),
            ...(c?.dev ? { dev: true } : {}),
            message: `${worst === "malicious" ? "Malicious package" : "Security"}: ${h.query.name} ${h.query.version}${c?.role && c.role !== "dependency" ? ` (${c.role})` : c?.dev ? " (development tooling of the stack, not shipped)" : ""} has advisory ${h.ids.join(", ")}${worst !== "unknown" && worst !== "malicious" ? ` (${worst})` : ""}`,
            fix: worst === "malicious" ? `remove ${h.query.name} and rotate any token on this machine; see ${ds[0]?.url ?? `https://osv.dev/vulnerability/${h.ids[0]}`}` : newer.length ? `fixed in ${h.query.name} ${newer[0]}${ourPackage(h.query.name) || c?.role === "dependency" ? `: ${updateCommandFor(inv)} once a release carries it` : ""}` : "no fixed release listed yet: avoid the affected feature; watch the advisory",
            url: ds[0]?.url ?? `https://osv.dev/vulnerability/${h.ids[0]}`,
          });
        }
      } else {
        sources.osv = "failed";
        errors.push(`osv: ${(osv.reason as Error)?.message ?? String(osv.reason)}`);
      }
      if (sources.npm === "failed" && sources.osv === "failed") {
        status = "offline";
        reason = "neither registry.npmjs.org nor api.osv.dev answered";
      }
    }
  }

  findings.sort(findingOrder);
  const result: UpdateCheckResult = {
    schema: RESULT_SCHEMA,
    at: now.toISOString(),
    status: status === "off" || status === "offline" ? (summarise(findings) === "ok" ? status : summarise(findings)) : summarise(findings),
    ...(reason ? { reason } : {}),
    findings,
    counts: {
      components: inv.components.length,
      queried: gate.enabled ? queries.length : 0,
      vulnerable: findings.filter((f) => f.kind === "vulnerable").length,
      lookalikes: findings.filter((f) => f.kind === "lookalike").length,
      updates: findings.filter((f) => f.kind === "update-available").length,
    },
    sources,
    errors,
    ...(notPublished.length ? { notPublished } : {}),
    network: { requests: log.requests, hosts: [...log.hosts].sort() },
    durationMs: Date.now() - started,
    ...(inv.stack.version ? { stack: inv.stack.version } : {}),
  };

  if (options.root && options.writeState !== false) {
    try {
      const prev = readState(options.root);
      const networkRan = gate.enabled && result.network.requests > 0;
      const ok = networkRan && !(sources.npm === "failed" && sources.osv === "failed");
      const failures = networkRan ? (ok ? 0 : prev.failures + 1) : prev.failures;
      writeState(options.root, {
        ...prev,
        schema: STATE_SCHEMA,
        lastAttempt: now.toISOString(),
        ...(ok ? { lastSuccess: now.toISOString() } : {}),
        // with the check off, nothing is scheduled: the next automatic run asks the switch again
        ...(gate.enabled ? { nextDue: nextDueAfter(ok, failures, now, options.jitter) } : {}),
        failures,
        result,
      });
    } catch (e) {
      result.errors.push(`state: ${(e as Error).message}`);
    }
  }
  return result;
}

/**
 * The automatic run: only when enabled and due, never throws, never awaited
 * by a build. Returns undefined when it did not run.
 */
export async function maybeRunUpdateCheck(root: string, options: Omit<CheckOptions, "root" | "auto"> = {}): Promise<UpdateCheckResult | undefined> {
  try {
    if (!updateCheckEnabled({ env: options.env, setting: options.setting, auto: true }).enabled) return undefined;
    if (!options.force && !isDue(readState(root), options.now)) return undefined;
    return await runUpdateCheck({ ...options, root, auto: true });
  } catch {
    return undefined;
  }
}

/** The findings a person has not dismissed, worst first. */
export function openFindings(state: UpdateCheckState): UpdateFinding[] {
  return (state.result?.findings ?? []).filter((f) => !isDismissed(state, f));
}

/** Text for `protoboard update check` without --json. */
export function formatResult(r: UpdateCheckResult): string {
  const head =
    r.status === "off"
      ? `update check is off (${r.reason}); nothing was sent`
      : r.status === "offline"
        ? `update check could not reach the registries (${r.reason}); local checks only`
        : `checked ${r.counts.queried} packages against npm and OSV in ${r.durationMs} ms (${r.network.requests} requests to ${r.network.hosts.join(", ") || "no host"})`;
  const lines = [head];
  for (const f of r.findings) lines.push(`${f.kind.padEnd(16)} ${f.message}${f.fix ? `\n                 fix: ${f.fix}` : ""}${f.url ? `\n                 ${f.url}` : ""}`);
  if (!r.findings.length && r.status !== "off" && r.status !== "offline") lines.push("ok: no advisories, no lookalikes, Protoboard is up to date");
  for (const e of r.errors) lines.push(`warning: ${e}`);
  lines.push("nothing was installed or changed");
  return lines.join("\n");
}

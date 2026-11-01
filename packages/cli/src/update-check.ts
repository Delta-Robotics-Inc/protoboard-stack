/**
 * `protoboard update` (PB-1168): the update and vulnerability check.
 *
 *   protoboard update check [--json] [--force]
 *       the check for the project here: newer Protoboard releases (npm
 *       dist-tags), advisories for every installed npm and Python package
 *       (OSV.dev), and the lookalike deny list. Without --force a result from
 *       the last day is shown again (no network); --force checks now.
 *       Exit 1 when something installed is vulnerable or deny-listed.
 *   protoboard update status [--json]   the switch, the last run, when the next is due
 *   protoboard update on | off          the machine-wide switch (<config dir>/update-check.json)
 *
 * It never installs or changes anything: a finding names the command, and
 * the person runs it. Network: registry.npmjs.org and api.osv.dev only, 10 s
 * per request (DEFAULT). Off (the switch, PROTOBOARD_NO_UPDATE_CHECK=1,
 * NO_UPDATE_NOTIFIER) means nothing is sent, even with --force.
 *
 * Install scripts: this command runs no installer. The updates it suggests
 * carry `--ignore-scripts` (core/src/update/check.ts updateCommandFor), as
 * `protoboard stack install` already does (core/src/stack.ts). The managed
 * runtime install in core/src/tools.ts (node runtimes, `npm install` at about
 * line 625) is not this workstream's file: the `--ignore-scripts` change for
 * it is a handoff (phase-1/handoffs.md, 2026-11-01, W4-A).
 *
 * The automatic, once-a-day run after a CLI command (`afterCommand`) and the
 * `case "update"` / `case "inventory"` lines in cli/src/index.ts belong to
 * W4-D (shared files); see phase-1/handoffs.md.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// TODO(W4-D handoff): `@protoboardai/core/update` once core/package.json exports it
import { formatResult, isDismissed, isDue, maybeRunUpdateCheck, readState, runUpdateCheck, updateCheckEnabled, writeCliSwitch, writeState, type UpdateCheckResult, type UpdateFinding } from "../../core/src/update/check.js";
import type { UpdateFetcher } from "../../core/src/update/sources.js";
import { projectRootFrom } from "./inventory.js";

type Out = (data: unknown, text: () => string) => void;

export const UPDATE_USAGE = "usage: protoboard update check [--json] [--force] | status [--json] | on | off";

export interface UpdateCommandOptions {
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Tests pass a stub; the CLI uses Node's fetch. */
  fetcher?: UpdateFetcher;
  now?: Date;
  /** The detached background run (`--background`): quiet, only when due. */
  background?: boolean;
}

/** Exit code: 1 when something installed is vulnerable or on the deny list. */
export const exitCodeFor = (r: UpdateCheckResult) => (r.findings.some((f) => f.kind === "vulnerable" || (f.kind === "lookalike" && f.severity === "critical")) ? 1 : 0);

/** Runs `protoboard update <sub>`; returns the exit code. */
export async function updateCommand(cwd: string, args: string[], out: Out, options: UpdateCommandOptions = {}): Promise<number> {
  const [sub = "check"] = args;
  const env = options.env ?? process.env;
  const root = projectRootFrom(cwd);
  const background = options.background ?? process.argv.includes("--background");
  switch (sub) {
    case "check": {
      if (background) {
        if (root) await maybeRunUpdateCheck(root, { env, ...(options.fetcher ? { fetcher: options.fetcher } : {}), ...(options.now ? { now: options.now } : {}) });
        return 0;
      }
      // a result from the last day is shown again unless --force (no network)
      if (root && !options.force) {
        const state = readState(root);
        if (state.result && !isDue(state, options.now) && updateCheckEnabled({ env }).enabled) {
          const r = state.result;
          out({ ...r, cached: true, nextDue: state.nextDue }, () => `${formatResult(r)}\n(from ${r.at}; next check after ${state.nextDue}; --force to check now)`);
          return exitCodeFor(r);
        }
      }
      const r = await runUpdateCheck({ ...(root ? { root } : {}), force: options.force, env, ...(options.fetcher ? { fetcher: options.fetcher } : {}), ...(options.now ? { now: options.now } : {}) });
      out(r, () => formatResult(r));
      return exitCodeFor(r);
    }
    case "status": {
      const gate = updateCheckEnabled({ env });
      const state = root ? readState(root) : undefined;
      const data = { enabled: gate.enabled, reason: gate.reason, project: !!root, lastAttempt: state?.lastAttempt, lastSuccess: state?.lastSuccess, nextDue: state?.nextDue, status: state?.result?.status, findings: state?.result?.findings.length ?? 0 };
      out(data, () =>
        [
          `update check: ${gate.enabled ? "on" : "off"} (${gate.reason})`,
          root ? `last checked ${state?.lastSuccess ?? "never"}${state?.nextDue ? `; next after ${state.nextDue}` : ""}${state?.result ? `; ${state.result.status}, ${state.result.findings.length} finding(s)` : ""}` : "not in a project: no state is kept",
        ].join("\n"),
      );
      return 0;
    }
    case "on":
    case "off": {
      const file = writeCliSwitch(sub === "on", env);
      out({ enabled: sub === "on", file }, () => `update check ${sub === "on" ? "on" : "off"} for this machine (${file})${sub === "off" ? ": nothing is sent" : ""}`);
      return 0;
    }
    default:
      throw new Error(UPDATE_USAGE);
  }
}

/** Commands after which the CLI never prints a notice or starts a check. */
const QUIET_AFTER = new Set(["update", "inventory", "mcp", "dev", "telemetry", "help", "version"]);

/**
 * After a CLI command (W4-D wires it into index.ts): prints, on stderr and
 * never in --json stdout, one line per open finding not printed before, then
 * starts the once-a-day check as a detached child when it is due. Never
 * throws and never waits, so it cannot block or fail the command.
 */
export function afterCommand(cwd: string, command: string | undefined, options: { env?: NodeJS.ProcessEnv; stderr?: NodeJS.WritableStream; spawnCheck?: (root: string) => void; now?: Date } = {}): void {
  try {
    if (!command || QUIET_AFTER.has(command)) return;
    const env = options.env ?? process.env;
    const root = projectRootFrom(cwd);
    if (!root) return;
    const gate = updateCheckEnabled({ env, auto: true });
    // turned off (setting, variable or `protoboard update off`) also means quiet: no notice from an earlier result
    // (wave 4 gate; the CI and test-runner exemption applies to starting a check, not to showing one)
    if (!updateCheckEnabled({ env }).enabled) return;
    const state = readState(root);
    const shown = { ...(state.shown ?? {}) };
    const lines: string[] = [];
    for (const f of state.result?.findings ?? []) {
      if (isDismissed(state, f)) continue;
      const v = f.latest ?? f.version ?? "*";
      if (shown[f.key] === v) continue;
      shown[f.key] = v;
      lines.push(noticeLine(f));
    }
    if (lines.length) {
      (options.stderr ?? process.stderr).write(lines.join("\n") + "\n");
      writeState(root, { ...state, shown });
    }
    if (gate.enabled && isDue(state, options.now)) (options.spawnCheck ?? spawnBackgroundCheck)(root);
  } catch {
    // never fails the command
  }
}

/** One stderr line for a finding. */
export function noticeLine(f: UpdateFinding): string {
  if (f.kind === "update-available") return `Protoboard: ${f.message}. ${f.fix ?? ""}`.trim();
  return `Protoboard ${f.kind === "lookalike" ? "lookalike warning" : "security"}: ${f.message}${f.fix ? `; ${f.fix}` : ""}. Details: protoboard update check`;
}

/** Starts `protoboard update check --background` detached; the parent does not wait. */
export function spawnBackgroundCheck(root: string): void {
  const bin = fileURLToPath(new URL("../bin/protoboard.mjs", import.meta.url));
  const child = spawn(process.execPath, [bin, "update", "check", "--background"], { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

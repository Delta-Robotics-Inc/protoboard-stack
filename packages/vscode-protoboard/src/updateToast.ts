/**
 * The update and vulnerability toast (PB-1168).
 *
 * Reads the same state file as the CLI (`<project>/.protoboard/local/
 * update-check.json`, written by @protoboardai/core's update check) and shows
 * at most one toast:
 *   - a warning when something installed is vulnerable (any severity but
 *     `low`) or on the lookalike deny list;
 *   - otherwise an info toast for a newer Protoboard release, a lookalike
 *     warning or a low advisory, at most once a week (DEFAULT, the design
 *     note's "plain updates are batched into at most one info toast a week").
 * Buttons: "Show" (the details in a read-only Markdown preview), "Later"
 * (quiet for a day, DEFAULT) and "Don't show for this version" (recorded in
 * the state file, keyed on the finding and the version it names).
 *
 * It never installs, updates or runs anything: "Show" names the command and
 * the person runs it.
 *
 * The check itself runs from here once a day per project, 2 to 10 minutes
 * (random, DEFAULT) after activation, only when the setting
 * `protoboard.updates.check` (default on) and the environment allow it
 * (core's updateCheckEnabled). Off means nothing is sent. No telemetry
 * coupling: VS Code's telemetry level does not change it.
 *
 * Registration in extension.ts and the `protoboard.updates.check` setting and
 * `protoboard.updates.show` command contributions in package.json belong to
 * W4-D / the orchestrator (phase-1/handoffs.md, 2026-11-01, W4-A).
 */
import * as vscode from "vscode";
// TODO(W4-D handoff): `@protoboardai/core/update` once core/package.json exports it (esbuild bundles either way)
import { dismissFinding, isDismissed, maybeRunUpdateCheck, readState, updateCheckEnabled, type UpdateCheckState, type UpdateFinding } from "../../core/src/update/check.js";

export const UPDATE_SETTING = "protoboard.updates.check";
export const SHOW_COMMAND = "protoboard.updates.show";
/** globalState keys. */
export const SNOOZE_KEY = "protoboard.updates.snoozedUntil";
export const INFO_KEY = "protoboard.updates.lastInfoToast";
export const BUTTONS = { show: "Show", later: "Later", never: "Don't show for this version" } as const;
/** DEFAULT: "Later" keeps quiet for a day. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
/** DEFAULT: at most one info toast a week. */
export const INFO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** DEFAULT: the activation delay, 2 to 10 minutes. */
export const ACTIVATION_DELAY_MS = { min: 2 * 60 * 1000, max: 10 * 60 * 1000 };

export interface ToastPlan {
  level: "warning" | "info";
  findings: UpdateFinding[];
  message: string;
}

/** What a memento holds for the toast. */
export interface ToastMemory {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Whether a finding gets the warning toast. */
export const isUrgent = (f: UpdateFinding) => (f.kind === "vulnerable" && f.severity !== "low") || (f.kind === "lookalike" && f.severity === "critical");

/** Which toast to show now, if any (pure). */
export function planToast(state: UpdateCheckState, memory: { snoozedUntil?: string; lastInfoToast?: string }, now = new Date()): ToastPlan | undefined {
  const open = (state.result?.findings ?? []).filter((f) => !isDismissed(state, f));
  if (!open.length) return undefined;
  const snoozed = memory.snoozedUntil ? Date.parse(memory.snoozedUntil) : NaN;
  if (Number.isFinite(snoozed) && now.getTime() < snoozed) return undefined;
  const urgent = open.filter(isUrgent);
  const more = (n: number) => (n > 1 ? ` (and ${n - 1} more)` : "");
  if (urgent.length) {
    const f = urgent[0];
    const ids = f.ids?.length ? ` [${f.ids.slice(0, 3).join(", ")}]` : "";
    return { level: "warning", findings: urgent, message: `Protoboard ${f.kind === "lookalike" ? "lookalike warning" : "security"}: ${f.message}${ids}${more(urgent.length)}. ${f.fix ?? ""}`.trim() };
  }
  const last = memory.lastInfoToast ? Date.parse(memory.lastInfoToast) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < INFO_INTERVAL_MS) return undefined;
  const update = open.find((f) => f.kind === "update-available");
  const first = update ?? open[0];
  return { level: "info", findings: open, message: `Protoboard: ${first.message}${more(open.length)}.` };
}

/** The details "Show" opens: every open finding, with the fix and the link. */
export function detailsMarkdown(state: UpdateCheckState): string {
  const r = state.result;
  const lines = ["# Protoboard update and vulnerability check", "", r ? `Checked ${r.at} (${r.status}; ${r.counts.queried} packages; sources: npm ${r.sources.npm}, OSV ${r.sources.osv}).` : "Not checked yet.", "", "Nothing is installed or changed by Protoboard. Run the fix yourself when you are ready.", ""];
  for (const f of (r?.findings ?? []).filter((x) => !isDismissed(state, x))) {
    lines.push(`## ${f.kind === "vulnerable" ? "Vulnerable" : f.kind === "lookalike" ? "Lookalike" : "Update available"}: ${f.name}${f.version ? ` ${f.version}` : ""}`, "", f.message, "");
    if (f.ids?.length) lines.push(`Advisories: ${f.ids.join(", ")}`, "");
    if (f.summary) lines.push(f.summary, "");
    if (f.fix) lines.push(`Fix: ${f.fix}`, "");
    if (f.url) lines.push(f.url, "");
  }
  for (const e of r?.errors ?? []) lines.push(`Warning: ${e}`);
  return lines.join("\n") + "\n";
}

/** The parts of VS Code the toast uses (tests pass their own). */
export interface ToastHost {
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined> | Promise<string | undefined>;
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined> | Promise<string | undefined>;
  openDetails(markdown: string): Thenable<unknown> | Promise<unknown>;
}

const vscodeHost = (): ToastHost => ({
  showWarningMessage: (m, ...items) => vscode.window.showWarningMessage(m, ...items),
  showInformationMessage: (m, ...items) => vscode.window.showInformationMessage(m, ...items),
  openDetails: async (markdown) => vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content: markdown }), { preview: true }),
});

/** Shows the toast for the project at `root` when one is due; returns what was chosen. Never throws. */
export async function showUpdateToast(root: string, memory: ToastMemory, host: ToastHost = vscodeHost(), now = new Date()): Promise<{ plan?: ToastPlan; choice?: string }> {
  try {
    const state = readState(root);
    const plan = planToast(state, { snoozedUntil: memory.get<string>(SNOOZE_KEY), lastInfoToast: memory.get<string>(INFO_KEY) }, now);
    if (!plan) return {};
    if (plan.level === "info") await memory.update(INFO_KEY, now.toISOString());
    const show = plan.level === "warning" ? host.showWarningMessage.bind(host) : host.showInformationMessage.bind(host);
    const choice = await show(plan.message, BUTTONS.show, BUTTONS.later, BUTTONS.never);
    if (choice === BUTTONS.show) await host.openDetails(detailsMarkdown(state));
    else if (choice === BUTTONS.later) await memory.update(SNOOZE_KEY, new Date(now.getTime() + SNOOZE_MS).toISOString());
    else if (choice === BUTTONS.never) for (const f of plan.findings) dismissFinding(root, f);
    return { plan, ...(choice ? { choice } : {}) };
  } catch {
    return {};
  }
}

/** The setting (undefined: not set, so on). */
export const readUpdateSetting = (): boolean | undefined => vscode.workspace.getConfiguration("protoboard").get<boolean>("updates.check");

/**
 * Wires the toast (W4-D calls this from extension.ts activate): after a
 * random 2-10 minute delay, runs the check for each open project when due
 * and enabled, then shows at most one toast. Registers `protoboard.updates.show`.
 */
export function registerUpdateToast(context: { globalState: ToastMemory; subscriptions: { dispose(): unknown }[] }, roots: () => string[], options: { extensionVersion?: string; delayMs?: number } = {}): void {
  const run = async () => {
    for (const root of roots()) {
      const setting = readUpdateSetting();
      if (updateCheckEnabled({ setting, auto: true }).enabled) await maybeRunUpdateCheck(root, { setting, inventoryOptions: options.extensionVersion ? { extensionVersion: options.extensionVersion } : {} });
      const shown = await showUpdateToast(root, context.globalState);
      if (shown.plan) break; // one toast per activation
    }
  };
  const delay = options.delayMs ?? ACTIVATION_DELAY_MS.min + Math.floor(Math.random() * (ACTIVATION_DELAY_MS.max - ACTIVATION_DELAY_MS.min));
  const timer = setTimeout(() => void run().catch(() => undefined), delay);
  (timer as { unref?: () => void }).unref?.();
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_COMMAND, async () => {
      const root = roots()[0];
      if (!root) return void vscode.window.showInformationMessage("Protoboard: open a project to see its update check.");
      await vscodeHost().openDetails(detailsMarkdown(readState(root)));
    }),
  );
}

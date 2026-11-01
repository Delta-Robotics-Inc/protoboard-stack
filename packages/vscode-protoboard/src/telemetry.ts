/**
 * Local crash and performance records for the viewer tabs (PB-1181). The
 * webview posts each record (`telemetry`, web-viewer's protocol.ts); this
 * host appends it to the project's `.protoboard/local/telemetry/` through
 * @protoboardai/core's writer, which sanitises every field, hashes paths and
 * prunes to 30 days or 50 MB. Nothing is sent anywhere.
 *
 * Recording follows one setting, `protoboard.telemetry.local` (default on),
 * and VS Code's own telemetry choice: "If isTelemetryEnabled reports false,
 * even if your setting is enabled, telemetry must not be sent"
 * (code.visualstudio.com/api/extension-guides/telemetry). Local recording is
 * not sending, but VS Code's telemetry off also stops it here (DEFAULT,
 * phase-1/plan.md overnight defaults), and its `crash` or `error` level keeps
 * crash records only. `PROTOBOARD_TELEMETRY=off` in the environment wins too.
 */
import * as vscode from "vscode";
import { STACK_VERSION } from "./versions.js";
// TODO(W1-B handoff): `@protoboardai/core/telemetry` once core/package.json exports it (esbuild bundles either way)
import { TELEMETRY_DIR, appendTelemetry, enrichViewerRecord, telemetryMode, telemetrySummary, type TelemetryMode, type WriteResult } from "@protoboardai/core/telemetry";

/** The setting that switches local recording. */
export const TELEMETRY_SETTING = "protoboard.telemetry.local";
/** The command behind the Help view's telemetry row. */
export const TELEMETRY_COMMAND = "protoboard.telemetry.status";

/** What decides the mode, read from VS Code (a test passes its own). */
export interface TelemetryEnvironment {
  setting: boolean | undefined;
  isTelemetryEnabled: boolean | undefined;
  telemetryLevel: string | undefined;
  env: Record<string, string | undefined>;
}

export function readTelemetryEnvironment(): TelemetryEnvironment {
  return {
    setting: vscode.workspace.getConfiguration("protoboard").get<boolean>("telemetry.local"),
    isTelemetryEnabled: vscode.env.isTelemetryEnabled,
    telemetryLevel: vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel"),
    env: process.env,
  };
}

/** Whether to record, and why (the precedence is core's `telemetryMode`). */
export function extensionTelemetryMode(e: TelemetryEnvironment = readTelemetryEnvironment()): { mode: TelemetryMode; reason: string } {
  return telemetryMode({ env: e.env, setting: e.setting, vscode: { isTelemetryEnabled: e.isTelemetryEnabled, telemetryLevel: e.telemetryLevel } });
}

/**
 * Writes a viewer tab's record for the project at `root`, when recording is
 * on: the host (not the page) names the project, as a salted hash, and the
 * versions. Never throws.
 */
export function writeViewerTelemetry(root: string, record: unknown, e?: TelemetryEnvironment): WriteResult {
  try {
    const { mode } = extensionTelemetryMode(e);
    if (mode === "off") return { written: false, reason: "off", pruned: [] };
    const versions = STACK_VERSION ? { stack: STACK_VERSION, extension: STACK_VERSION } : {};
    return appendTelemetry(root, enrichViewerRecord(root, record, { host: "vscode-webview", versions }), { mode });
  } catch {
    return { written: false, reason: "refused", pruned: [] };
  }
}

/** The Help view's row for local telemetry: what it does now, in a few words. */
export function telemetryLabel(mode: TelemetryMode): string {
  return mode === "off" ? "Crash and Performance Data: Off" : mode === "crash" ? "Crash Data: Local Only" : "Crash and Performance Data: Local Only";
}

/** What the status command says (and the row's tooltip). */
export function telemetryStatusText(mode: { mode: TelemetryMode; reason: string }, roots: string[] = []): string {
  const where = TELEMETRY_DIR.split("\\").join("/");
  const lines = [
    mode.mode === "off" ? `Protoboard records nothing: ${mode.reason}.` : `Protoboard records ${mode.mode === "crash" ? "crashes" : "crash and performance data"} of the viewer tabs on this machine only, in each project's ${where} (kept 30 days or 50 MB). Nothing is sent.`,
  ];
  for (const root of roots) {
    try {
      const s = telemetrySummary(root);
      if (s.files) lines.push(`${root.split(/[\\/]/).pop()}: ${s.sessions} session(s), ${s.crashes} crash(es), ${(s.bytes / 1024).toFixed(1)} kB.`);
    } catch {
      // unreadable: left out
    }
  }
  lines.push("`protoboard telemetry export` shows exactly what a report would carry; nothing leaves the machine without your approval.");
  return lines.join(" ");
}

/** The status command, and a refresh signal when VS Code's telemetry or the setting changes. */
export function registerTelemetry(onChange: () => void): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(TELEMETRY_COMMAND, async () => {
      const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const pick = await vscode.window.showInformationMessage(telemetryStatusText(extensionTelemetryMode(), roots), "Settings");
      if (pick === "Settings") await vscode.commands.executeCommand("workbench.action.openSettings", TELEMETRY_SETTING);
    }),
    vscode.env.onDidChangeTelemetryEnabled(() => onChange()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(TELEMETRY_SETTING) || e.affectsConfiguration("telemetry.telemetryLevel")) onChange();
    }),
  ];
}

/**
 * Local telemetry in the extension (PB-1181): the mode from the setting and
 * VS Code's own telemetry choice (VS Code's off also stops local recording,
 * DEFAULT), the viewer tab's `telemetry` message, and the host writing it to
 * the project with the host and project hash it names itself.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: { isTelemetryEnabled: true, onDidChangeTelemetryEnabled: () => ({ dispose() {} }) },
  commands: { registerCommand: () => ({ dispose() {} }) },
  window: {},
}));

const { extensionTelemetryMode, telemetryLabel, telemetryStatusText, writeViewerTelemetry } = await import("../src/telemetry.js");
const { parseFromWebview } = await import("../../web-viewer/src/vscode/protocol.js");
const { projectHash, readTelemetry } = await import("../../core/src/telemetry.js");

const TMP = mkdtempSync(join(tmpdir(), "pb-ext-telemetry-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const record = {
  schema: "pb.render-session/v0",
  session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  start: "2026-11-01T10:00:00.000Z",
  end: "2026-11-01T10:01:00.000Z",
  durationMs: 60000,
  host: "unknown",
  versions: { viewer: "0.2.1" },
  exit: "hidden",
  partial: true,
};

const environment = (over: Partial<{ setting: boolean; isTelemetryEnabled: boolean; telemetryLevel: string; env: Record<string, string> }> = {}) => ({
  setting: undefined as boolean | undefined,
  isTelemetryEnabled: true,
  telemetryLevel: "all" as string | undefined,
  env: {} as Record<string, string>,
  ...over,
});

describe("the extension's telemetry mode", () => {
  it("records by default, follows the setting and VS Code's telemetry level", () => {
    expect(extensionTelemetryMode(environment()).mode).toBe("all");
    expect(extensionTelemetryMode(environment({ setting: false }))).toEqual({ mode: "off", reason: "protoboard.telemetry.local is off" });
    // DEFAULT (plan.md): VS Code's telemetry off also stops local recording
    expect(extensionTelemetryMode(environment({ telemetryLevel: "off", isTelemetryEnabled: false })).mode).toBe("off");
    expect(extensionTelemetryMode(environment({ telemetryLevel: "crash", isTelemetryEnabled: false })).mode).toBe("crash");
    expect(extensionTelemetryMode(environment({ telemetryLevel: "error", isTelemetryEnabled: false })).mode).toBe("crash");
    expect(extensionTelemetryMode(environment({ telemetryLevel: undefined, isTelemetryEnabled: false })).mode).toBe("off");
    expect(extensionTelemetryMode(environment({ env: { PROTOBOARD_TELEMETRY: "off" } })).mode).toBe("off");
    // the setting cannot turn it on against VS Code
    expect(extensionTelemetryMode(environment({ setting: true, telemetryLevel: "off", isTelemetryEnabled: false })).mode).toBe("off");
  });

  it("says what it does in the Help row and its message", () => {
    expect(telemetryLabel("all")).toBe("Crash and Performance Data: Local Only");
    expect(telemetryStatusText({ mode: "all", reason: "" })).toMatch(/on this machine only.*Nothing is sent\./);
    expect(telemetryStatusText({ mode: "off", reason: "VS Code telemetry is off" })).toMatch(/^Protoboard records nothing: VS Code telemetry is off\./);
  });
});

describe("a viewer tab's records", () => {
  it("the webview's message is checked as an envelope: a known schema, an object, not too large", () => {
    expect(parseFromWebview({ type: "telemetry", record })).toEqual({ type: "telemetry", record });
    expect(parseFromWebview({ type: "telemetry", record: { schema: "other" } })).toBeUndefined();
    expect(parseFromWebview({ type: "telemetry", record: [record] })).toBeUndefined();
    expect(parseFromWebview({ type: "telemetry", record: { ...record, pad: "x".repeat(70 * 1024) } })).toBeUndefined();
  });

  it("are written to the project with the host and project hash the extension names, when recording is on", () => {
    const root = join(TMP, "proj");
    expect(writeViewerTelemetry(root, { ...record, project: "h:0000000000000000" }, environment()).written).toBe(true);
    const [stored] = readTelemetry(root);
    expect(stored).toMatchObject({ host: "vscode-webview", project: projectHash(root), partial: true, exit: "hidden" });
    expect(JSON.stringify(stored)).not.toContain(root);
  });

  it("are dropped while recording is off, and in crash mode unless the session crashed", () => {
    const root = join(TMP, "quiet");
    expect(writeViewerTelemetry(root, record, environment({ telemetryLevel: "off", isTelemetryEnabled: false }))).toMatchObject({ written: false, reason: "off" });
    expect(writeViewerTelemetry(root, record, environment({ telemetryLevel: "crash", isTelemetryEnabled: false }))).toMatchObject({ written: false, reason: "off" });
    expect(writeViewerTelemetry(root, { ...record, exit: "crash", errors: { count: 1, first: [{ kind: "error", message: "boom" }] } }, environment({ telemetryLevel: "crash", isTelemetryEnabled: false })).written).toBe(true);
    expect(readTelemetry(root)).toHaveLength(1);
  });
});

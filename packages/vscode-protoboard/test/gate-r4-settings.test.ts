/**
 * Wave R4 gate (2026-11-02): R4-B's two viewer settings (`viewer.units`, `viewer.scaleReference`) through the
 * extension. The Settings page shows them as choices; the 3D toolbar's chooser saves them through
 * `uhd-viewer:setting` (only these two keys; logged as the person); a tab opened later gets them in its settings.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const ui = { picks: [] as unknown[] };
vi.mock("vscode", () => {
  class EventEmitter<T> {
    private ls = new Set<(v: T) => void>();
    event = (l: (v: T) => void) => (this.ls.add(l), { dispose: () => this.ls.delete(l) });
    fire(v: T) {
      for (const l of this.ls) l(v);
    }
    dispose() {
      this.ls.clear();
    }
  }
  return {
    EventEmitter,
    Uri: { file: (p: string) => ({ fsPath: p }) },
    window: { showQuickPick: async () => ui.picks.shift(), showInputBox: async () => undefined, showOpenDialog: async () => undefined },
  };
});

const { parseFromWebview, parseViewerSettings, DEFAULT_VIEWER_SETTINGS, VIEWER_SAVABLE_SETTINGS } = await import("../../web-viewer/src/vscode/protocol.js");
const { UserSettings, editSetting, settingText, viewerRows } = await import("../src/userSettings.js");
const { DEFAULT_SETTINGS, settingDef } = await import("@protoboardai/core/settings");

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const place = () => {
  const home = mkdtempSync(join(tmpdir(), "pb-gate-r4-"));
  dirs.push(home);
  return { home, place: { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv } };
};

describe("viewer settings of R4-B through the extension (wave R4 gate)", () => {
  it("the protocol carries units and the scale reference, DEFAULT mm and banana", () => {
    expect(DEFAULT_VIEWER_SETTINGS).toMatchObject({ units: "mm", scaleReference: "banana" });
    expect(parseViewerSettings({ units: "in", scaleReference: "benchy" })).toMatchObject({ units: "in", scaleReference: "benchy" });
    expect(parseViewerSettings({ units: "cm", scaleReference: "apple" })).toMatchObject({ units: "mm", scaleReference: "banana" });
  });

  it("takes the toolbar's setting event for the two keys only, with a string value", () => {
    const ev = (key: unknown, value: unknown) => parseFromWebview({ type: "event", event: { type: "uhd-viewer:setting", key, value } });
    expect(ev("viewer.scaleReference", "cube")).toEqual({ type: "event", event: { type: "uhd-viewer:setting", key: "viewer.scaleReference", value: "cube" } });
    expect(ev("viewer.units", "in")).toBeTruthy();
    // a tab never sets an app, a folder or another viewer setting
    expect(ev("tools.stepViewer", "C:/evil.exe")).toBeUndefined();
    expect(ev("files.exportFolder", "C:/")).toBeUndefined();
    expect(ev("viewer.zoomToCursor", "false")).toBeUndefined();
    expect(ev("viewer.units", 1)).toBeUndefined();
    expect(ev("viewer.units", "x".repeat(65))).toBeUndefined();
    expect([...VIEWER_SAVABLE_SETTINGS]).toEqual(["viewer.units", "viewer.scaleReference"]);
  });

  it("a choice saved as the person reaches a tab opened later (the reload) and is logged", () => {
    const { home, place: p } = place();
    const us = new UserSettings(log, p);
    us.set("viewer.scaleReference", "benchy");
    us.set("viewer.units", "in");
    expect(() => us.set("viewer.units", "cm")).toThrow(/one of mm, in/);
    const later = new UserSettings(log, p);
    expect(parseViewerSettings(JSON.parse(JSON.stringify(later.viewer)))).toMatchObject({ units: "in", scaleReference: "benchy" });
    const changes = readFileSync(join(home, "settings-changes.jsonl"), "utf8");
    expect(changes).toContain('"key":"viewer.scaleReference"');
    expect(changes).toContain('"actor":"person (VS Code)"');
    us.dispose();
    later.dispose();
  });

  it("the Settings page rows: a choice reads as its words and carries its options", () => {
    const def = settingDef("viewer.scaleReference")!;
    expect(settingText(def, DEFAULT_SETTINGS)).toBe("Banana");
    expect(settingText(settingDef("viewer.units")!, { ...DEFAULT_SETTINGS, "viewer.units": "in" })).toBe("in");
    const row = viewerRows(DEFAULT_SETTINGS).find((r) => r.key === "viewer.scaleReference")!;
    expect(row).toMatchObject({ kind: "choice", text: "Banana", isDefault: true, icon: "banana" });
    expect(row.options?.map((o) => o.value)).toEqual(["banana", "cube", "benchy"]);
    expect(viewerRows(DEFAULT_SETTINGS).find((r) => r.key === "viewer.units")?.icon).toBe("ruler");
  });

  it("the Command Palette's edit of a choice is a pick of its options", async () => {
    const { place: p } = place();
    const us = new UserSettings(log, p);
    ui.picks.push({ label: "Cube", value: "cube" });
    await editSetting(us, "viewer.scaleReference", async () => undefined);
    expect(us.values["viewer.scaleReference"]).toBe("cube");
    ui.picks.push(undefined);
    await editSetting(us, "viewer.scaleReference", async () => undefined);
    expect(us.values["viewer.scaleReference"]).toBe("cube");
    us.dispose();
  });
});

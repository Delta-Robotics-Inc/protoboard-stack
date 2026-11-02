/**
 * R2-E (J1, 2026-11-02): the user's settings file under the Protoboard home: defaults, checks, the atomic write
 * that keeps only what changed, the change log with its actor, export names and the Downloads folder.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA,
  SETTING_KEYS,
  agentActor,
  checkSetting,
  downloadsFolder,
  exportFileName,
  exportFolder,
  isAgentActor,
  lastChange,
  parseSettingText,
  readSettings,
  safeName,
  setSetting,
  settingChanges,
  settingsFile,
} from "../src/settings.js";

const homes: string[] = [];
const place = () => {
  const home = mkdtempSync(join(tmpdir(), "pb-settings-"));
  homes.push(home);
  return { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv, home };
};
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

describe("settings (R2-E)", () => {
  it("has the defaults Kevin asked for", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      "viewer.openModelsInPlace": true,
      "viewer.zoomToCursor": true,
      "viewer.modelInfo": true,
      "viewer.hoverLongDelayMs": 900,
      "tools.stepViewer": null,
      "files.exportFolder": null,
      "files.importFolder": null,
    });
    expect(SETTING_KEYS).toHaveLength(7);
  });

  it("reads every default when there is no file", () => {
    const p = place();
    const r = readSettings(p);
    expect(r.values).toEqual(DEFAULT_SETTINGS);
    expect(r.set).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.file).toBe(join(p.home, "settings.json"));
  });

  it("checks values by kind", () => {
    expect(checkSetting("viewer.zoomToCursor", false)).toEqual({ ok: true, value: false });
    expect(checkSetting("viewer.zoomToCursor", "no").ok).toBe(false);
    expect(checkSetting("viewer.hoverLongDelayMs", 1200.4)).toEqual({ ok: true, value: 1200 });
    expect(checkSetting("viewer.hoverLongDelayMs", 50).ok).toBe(false);
    expect(checkSetting("viewer.hoverLongDelayMs", 99999).ok).toBe(false);
    expect(checkSetting("tools.stepViewer", "fusion360")).toEqual({ ok: true, value: "fusion360" });
    expect(checkSetting("tools.stepViewer", "notepad").ok).toBe(false);
    expect(checkSetting("tools.stepViewer", "relative/viewer.exe").ok).toBe(false);
    const exe = join(tmpdir(), "viewer.exe");
    expect(checkSetting("tools.stepViewer", exe)).toEqual({ ok: true, value: exe });
    expect(checkSetting("files.exportFolder", "Downloads").ok).toBe(false);
    expect(checkSetting("files.exportFolder", `${tmpdir()}\u0000x`).ok).toBe(false);
    expect(checkSetting("files.exportFolder", null)).toEqual({ ok: true, value: null });
    expect(checkSetting("viewer.nope", true).ok).toBe(false);
  });

  it("parses command-line text", () => {
    expect(parseSettingText("viewer.modelInfo", "off")).toBe(false);
    expect(parseSettingText("viewer.modelInfo", "true")).toBe(true);
    expect(parseSettingText("viewer.hoverLongDelayMs", "1500")).toBe(1500);
    expect(parseSettingText("tools.stepViewer", "default")).toBeNull();
    expect(parseSettingText("files.exportFolder", " C:\\x ")).toBe("C:\\x");
  });

  it("writes only what changed, atomically, and logs the actor", () => {
    const p = place();
    const c = setSetting("viewer.openModelsInPlace", false, agentActor("Claude Code"), { ...p, now: new Date("2026-11-02T10:00:00Z") });
    expect(c).toEqual({ at: "2026-11-02T10:00:00.000Z", key: "viewer.openModelsInPlace", from: true, to: false, actor: "agent (Claude Code)" });
    const file = JSON.parse(readFileSync(settingsFile(p), "utf8"));
    expect(file).toEqual({ schema: SETTINGS_SCHEMA, "viewer.openModelsInPlace": false });
    expect(readSettings(p).values["viewer.openModelsInPlace"]).toBe(false);
    setSetting("viewer.hoverLongDelayMs", 1200, "person (VS Code)", p);
    // the same value again changes nothing and logs nothing
    setSetting("viewer.hoverLongDelayMs", 1200, "cli", p);
    expect(settingChanges(p).map((x) => [x.key, x.actor])).toEqual([
      ["viewer.openModelsInPlace", "agent (Claude Code)"],
      ["viewer.hoverLongDelayMs", "person (VS Code)"],
    ]);
    // a reset drops the key from the file
    setSetting("viewer.openModelsInPlace", null, "cli", p);
    expect(JSON.parse(readFileSync(settingsFile(p), "utf8"))).toEqual({ schema: SETTINGS_SCHEMA, "viewer.hoverLongDelayMs": 1200 });
    expect(lastChange("viewer.hoverLongDelayMs", p)?.actor).toBe("person (VS Code)");
    expect(lastChange("viewer.openModelsInPlace", p)?.actor).toBe("cli");
    expect(isAgentActor(agentActor())).toBe(true);
    expect(isAgentActor("person (VS Code)")).toBe(false);
    // no temporary file is left
    expect(existsSync(settingsFile(p))).toBe(true);
  });

  it("refuses a bad value without writing", () => {
    const p = place();
    expect(() => setSetting("viewer.hoverLongDelayMs", "slow", "cli", p)).toThrow(/number/);
    expect(existsSync(settingsFile(p))).toBe(false);
  });

  it("ignores a broken file and wrong values, and says so", () => {
    const p = place();
    writeFileSync(settingsFile(p), "{ not json");
    const a = readSettings(p);
    expect(a.values).toEqual(DEFAULT_SETTINGS);
    expect(a.problems[0].message).toMatch(/not read/);
    writeFileSync(settingsFile(p), JSON.stringify({ schema: SETTINGS_SCHEMA, "viewer.modelInfo": false, "viewer.zoomToCursor": "yes", other: 1 }));
    const b = readSettings(p);
    expect(b.values["viewer.modelInfo"]).toBe(false);
    expect(b.values["viewer.zoomToCursor"]).toBe(true);
    expect(b.set).toEqual(["viewer.modelInfo"]);
    expect(b.problems.map((x) => x.key)).toEqual(["viewer.zoomToCursor", "other"]);
    // a write drops the wrong keys
    setSetting("viewer.modelInfo", true, "cli", p);
    expect(JSON.parse(readFileSync(settingsFile(p), "utf8"))).toEqual({ schema: SETTINGS_SCHEMA, "viewer.modelInfo": true });
  });

  it("exports to the Downloads folder unless one is set", () => {
    const p = place();
    expect(downloadsFolder({}, "/home/k")).toBe(join("/home/k", "Downloads"));
    expect(downloadsFolder({ XDG_DOWNLOAD_DIR: "$HOME/Dl" }, "/home/k")).toBe("/home/k/Dl");
    expect(exportFolder(p)).toBe(join(p.home, "Downloads"));
    const out = join(tmpdir(), "exports-here");
    setSetting("files.exportFolder", out, "cli", p);
    expect(exportFolder(p)).toBe(out);
  });

  it("names exports <project>-<view or part>-<date>.<ext>, safe on every file system", () => {
    const now = new Date(2026, 10, 2, 9, 30);
    expect(exportFileName("quadcopter-5in", "3d", "png", { now })).toBe("quadcopter-5in-3d-2026-11-02.png");
    expect(exportFileName("ClientX", 'arm_fl/motor: "M3"', ".STEP", { now })).toBe("ClientX-arm_fl-motor-M3-2026-11-02.step");
    const taken = new Set(["p-x-2026-11-02.glb", "p-x-2026-11-02-2.glb"]);
    expect(exportFileName("p", "x", "glb", { now, exists: (n) => taken.has(n) })).toBe("p-x-2026-11-02-3.glb");
    expect(safeName("con")).toBe("con-file");
    expect(safeName("name. ")).toBe("name");
    expect(safeName('a<b>c:d"e|f?g*h')).toBe("a-b-c-d-e-f-g-h");
  });
});

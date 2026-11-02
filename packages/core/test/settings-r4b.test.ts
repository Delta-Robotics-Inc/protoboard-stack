/**
 * R4-B (2026-11-02): two viewer settings of a new kind, "choice": `viewer.units` (mm or in, DEFAULT mm) and
 * `viewer.scaleReference` (banana, cube or benchy, DEFAULT banana), checked, parsed from a command line, written and
 * read back like the others.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, checkSetting, parseSettingText, readSettings, setSetting, settingDef } from "../src/settings.js";

const homes: string[] = [];
const place = () => {
  const home = mkdtempSync(join(tmpdir(), "pb-settings-r4b-"));
  homes.push(home);
  return { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv, home };
};
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

describe("settings: units and the scale reference (R4-B)", () => {
  it("defaults to mm and the banana", () => {
    expect(DEFAULT_SETTINGS["viewer.units"]).toBe("mm");
    expect(DEFAULT_SETTINGS["viewer.scaleReference"]).toBe("banana");
    expect(settingDef("viewer.units")?.kind).toBe("choice");
    expect(settingDef("viewer.scaleReference")?.options?.map((o) => o.value)).toEqual(["banana", "cube", "benchy"]);
  });

  it("takes only the listed values", () => {
    expect(checkSetting("viewer.units", "in")).toEqual({ ok: true, value: "in" });
    expect(checkSetting("viewer.units", "cm")).toEqual({ ok: false, message: "viewer.units is one of mm, in" });
    expect(checkSetting("viewer.scaleReference", "benchy")).toEqual({ ok: true, value: "benchy" });
    expect(checkSetting("viewer.scaleReference", 3).ok).toBe(false);
    expect(checkSetting("viewer.scaleReference", null)).toEqual({ ok: true, value: "banana" });
    expect(parseSettingText("viewer.units", " in ")).toBe("in");
    expect(parseSettingText("viewer.units", "default")).toBe(null);
  });

  it("writes and reads a choice back, and ignores a wrong one in the file", () => {
    const p = place();
    const c = setSetting("viewer.scaleReference", "cube", "agent (test)", p);
    expect([c.from, c.to]).toEqual(["banana", "cube"]);
    setSetting("viewer.units", "in", "cli", p);
    const r = readSettings(p);
    expect(r.values["viewer.scaleReference"]).toBe("cube");
    expect(r.values["viewer.units"]).toBe("in");
    expect(() => setSetting("viewer.units", "furlong", "cli", p)).toThrow("viewer.units is one of mm, in");
  });
});

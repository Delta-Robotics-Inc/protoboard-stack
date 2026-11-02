/**
 * Wave R4 gate (2026-11-02): an agent sees a choice setting's values (R4-B's `viewer.units`, `viewer.scaleReference`)
 * in `protoboard settings get` and the MCP `settings_get`, and the tools name them.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingDef, type SettingDef } from "@protoboardai/core/settings";
import { describeSetting } from "../src/settings.js";
import { settingsTools } from "../src/mcp/settings-tools.js";

describe("choice settings for agents (wave R4 gate)", () => {
  it("a choice reports its values; other kinds do not carry options", () => {
    const units = describeSetting(settingDef("viewer.units") as SettingDef, DEFAULT_SETTINGS["viewer.units"], false);
    expect(units).toMatchObject({ key: "viewer.units", kind: "choice", value: "mm", options: ["mm", "in"] });
    const scale = describeSetting(settingDef("viewer.scaleReference") as SettingDef, "cube", true);
    expect(scale).toMatchObject({ options: ["banana", "cube", "benchy"], isDefault: false });
    expect(describeSetting(settingDef("viewer.zoomToCursor") as SettingDef, true, false)).not.toHaveProperty("options");
  });

  it("the tools' descriptions name the two keys and their values", () => {
    const [get] = settingsTools();
    expect(get.description).toContain("viewer.units (mm or in)");
    expect(get.description).toContain("viewer.scaleReference (banana, cube or benchy");
  });

  it("the person-facing descriptions carry no build markers", () => {
    for (const k of ["viewer.units", "viewer.scaleReference"] as const) expect(settingDef(k)?.description).not.toMatch(/R4-B|DEFAULT|Kevin/);
  });
});

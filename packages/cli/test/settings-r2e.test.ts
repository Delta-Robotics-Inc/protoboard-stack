/**
 * R2-E (J1, 2026-11-02): `protoboard settings get|set|reset|log` and the MCP tools `settings_get` / `settings_set`
 * on a scratch Protoboard home; the agent's change is logged with its client's name.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { settingChanges } from "@protoboardai/core/settings";
import { settingsCommand } from "../src/settings.js";
import { settingsTools } from "../src/mcp/settings-tools.js";
import type { ToolContext } from "../src/mcp/tools.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "protoboard.mjs");
const homes: string[] = [];
const newHome = () => {
  const h = mkdtempSync(join(tmpdir(), "pb-cli-settings-"));
  homes.push(h);
  return h;
};
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

describe("protoboard settings (R2-E)", () => {
  it("gets, sets, resets and logs through the command", () => {
    const home = newHome();
    const p = { env: { PROTOBOARD_HOME: home } as NodeJS.ProcessEnv };
    const said: unknown[] = [];
    const out = (data: unknown) => void said.push(data);
    expect(settingsCommand(["get"], out, p)).toBe(0);
    const all = said.pop() as { settings: { key: string; value: unknown; isDefault: boolean; effective?: string }[] };
    expect(all.settings.map((s) => s.key)).toContain("viewer.openModelsInPlace");
    expect(all.settings.every((s) => s.isDefault)).toBe(true);
    expect(all.settings.find((s) => s.key === "files.exportFolder")?.effective).toMatch(/Downloads$/);
    settingsCommand(["set", "viewer.hoverLongDelayMs", "1500"], out, p);
    expect((said.pop() as { change: { from: number; to: number; actor: string } }).change).toMatchObject({ from: 900, to: 1500, actor: "cli" });
    settingsCommand(["get", "viewer.hoverLongDelayMs"], out, p);
    expect((said.pop() as { settings: { value: number; isDefault: boolean }[] }).settings).toMatchObject([{ value: 1500, isDefault: false }]);
    settingsCommand(["reset", "viewer.hoverLongDelayMs"], out, p);
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8"))).toEqual({ schema: "protoboard.settings/v0" });
    settingsCommand(["log"], out, p);
    expect((said.pop() as { changes: unknown[] }).changes).toHaveLength(2);
    expect(() => settingsCommand(["set", "viewer.hoverLongDelayMs", "fast"], out, p)).toThrow(/number/);
    expect(() => settingsCommand(["set", "viewer.nope", "1"], out, p)).toThrow(/no setting/);
    expect(() => settingsCommand(["frob"], out, p)).toThrow(/usage/);
  });

  it("runs as `protoboard settings` with --json", () => {
    const home = newHome();
    const env = { ...process.env, PROTOBOARD_HOME: home };
    const set = JSON.parse(execFileSync(process.execPath, [CLI, "settings", "set", "tools.stepViewer", "fusion360", "--json"], { env, encoding: "utf8" }));
    expect(set.change).toMatchObject({ key: "tools.stepViewer", from: null, to: "fusion360", actor: "cli" });
    const text = execFileSync(process.execPath, [CLI, "settings", "get"], { env, encoding: "utf8" });
    expect(text).toMatch(/tools\.stepViewer\s+fusion360/);
    expect(text).toMatch(/viewer\.openModelsInPlace\s+true\s+\[default\]/);
  }, 60_000);

  it("the agent's tools read and change the same file, logged as the agent", async () => {
    const home = newHome();
    const before = process.env.PROTOBOARD_HOME;
    process.env.PROTOBOARD_HOME = home;
    try {
      const [get, set] = settingsTools();
      expect([get.name, set.name]).toEqual(["settings_get", "settings_set"]);
      const ctx = { clientName: () => "claude-code" } as unknown as ToolContext;
      const r = await set.handler({ key: "viewer.openModelsInPlace", value: false } as never, ctx);
      expect(r.isError).toBeFalsy();
      expect((r.data as { change: { actor: string } }).change.actor).toBe("agent (claude-code)");
      const g = await get.handler({ key: "viewer.openModelsInPlace" } as never, ctx);
      expect((g.data as { settings: { value: boolean }[] }).settings[0].value).toBe(false);
      const bad = await set.handler({ key: "viewer.hoverLongDelayMs", value: "x" } as never, ctx);
      expect(bad.isError).toBe(true);
      expect(settingChanges({ env: { PROTOBOARD_HOME: home } }).map((c) => c.actor)).toEqual(["agent (claude-code)"]);
    } finally {
      if (before === undefined) delete process.env.PROTOBOARD_HOME;
      else process.env.PROTOBOARD_HOME = before;
    }
  });
});

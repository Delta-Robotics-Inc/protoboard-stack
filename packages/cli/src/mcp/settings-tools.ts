/**
 * The agent's settings tools (R2-E, J1, 2026-11-02): `settings_get` and `settings_set` read and change the user's
 * Protoboard settings (core settings.ts, `<home>/settings.json`), the same ones the extension's Settings page and
 * `protoboard settings` change. Kevin: "maybe we can change that in the settings; the agent has access to those
 * settings".
 *
 * Every change is logged with the actor `agent (<client name>)` (`<home>/settings-changes.jsonl`). An executable an
 * agent chose for `tools.stepViewer` is not run until the person confirms it once in VS Code (the extension reads
 * the log). The tools run in the server's own process: no project code, nothing leaves the machine.
 */
import { z } from "zod";
import { SETTING_KEYS, agentActor, isSettingKey, setSetting, type SettingKey } from "@protoboardai/core/settings";
import { settingsReport } from "../settings.js";
import type { ToolSpec } from "./tools.js";

const tool = <S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec => spec as unknown as ToolSpec;

const KEY = z.enum(SETTING_KEYS as unknown as [SettingKey, ...SettingKey[]]);

export function settingsTools(): ToolSpec[] {
  return [
    tool({
      name: "settings_get",
      title: "Read Protoboard settings",
      description:
        "The user's Protoboard settings (one or all): viewer.openModelsInPlace (open a model in the same viewer tab, Ctrl+click for a new tab), viewer.zoomToCursor, viewer.modelInfo, viewer.hoverLongDelayMs, tools.stepViewer (the app STEP files open with), files.exportFolder (exports go there without asking; unset: Downloads), files.importFolder. Each with its value, default and meaning. Reads only. Runs no project code.",
      input: { key: KEY.optional().describe("One setting; omit for all.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async handler({ key }) {
        return { data: settingsReport({}, key) };
      },
    }),
    tool({
      name: "settings_set",
      title: "Change a Protoboard setting",
      description:
        "Change one of the user's Protoboard settings (see settings_get for the keys and values), or reset it with value null. Do this when the user asks for it: say what you change. The change is logged as yours; an executable you choose for tools.stepViewer runs only after the user confirms it once in VS Code. Runs no project code.",
      input: {
        key: KEY,
        value: z.union([z.boolean(), z.number(), z.string(), z.null()]).describe("true/false, a number, an app id (fusion360, onshape, kicad, freecad, protoboard, system) or an absolute path; null resets to the default."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async handler({ key, value }, ctx) {
        if (!isSettingKey(key)) return { data: { error: `no setting "${key}"` }, isError: true };
        try {
          const change = setSetting(key, value, agentActor(ctx.clientName?.()));
          return { data: { ok: true, change, setting: settingsReport({}, key).settings[0] } };
        } catch (e) {
          return { data: { error: (e as Error).message }, isError: true };
        }
      },
    }),
  ];
}

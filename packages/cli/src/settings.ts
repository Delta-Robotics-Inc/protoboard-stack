/**
 * `protoboard settings` (R2-E, J1, 2026-11-02): the user's Protoboard settings (core settings.ts, the file
 * `<home>/settings.json`), the same ones the VS Code extension's Settings page and the MCP tools `settings_get` and
 * `settings_set` change.
 *
 *   protoboard settings get [<key>]          every setting (or one), its value, whether it is the default
 *   protoboard settings set <key> <value>    `true`/`false`, a number, an app id or an absolute path; `default` resets
 *   protoboard settings reset <key>          back to the default
 *   protoboard settings log                  the recent changes and who made them
 *
 * A change from the CLI is logged with the actor `cli` (the CLI cannot tell a person from an agent running it).
 * Local work: no sign-in, nothing leaves the machine.
 */
import {
  CLI_ACTOR,
  SETTING_DEFS,
  downloadsFolder,
  isSettingKey,
  parseSettingText,
  readSettings,
  setSetting,
  settingChanges,
  type SettingDef,
  type SettingsPlace,
} from "@protoboardai/core/settings";

export type Out = (data: unknown, text: () => string) => void;

export const SETTINGS_USAGE = "usage: protoboard settings get [<key>] | set <key> <value> | reset <key> | log";

/** One setting as the CLI and the MCP tools report it. */
export function describeSetting(def: SettingDef, value: unknown, isSet: boolean, p: SettingsPlace = {}) {
  const effective = def.key === "files.exportFolder" && value === null ? downloadsFolder(p.env ?? process.env) : value;
  return {
    key: def.key,
    value,
    default: def.default,
    isDefault: !isSet,
    kind: def.kind,
    ...(def.min !== undefined ? { min: def.min, max: def.max } : {}),
    // a choice's values (R4-B's kind; wave R4 gate: an agent sees them before it sets one)
    ...(def.options ? { options: def.options.map((o) => o.value) } : {}),
    ...(effective !== value ? { effective } : {}),
    title: def.title,
    description: def.description,
  };
}

export function settingsReport(p: SettingsPlace = {}, key?: string) {
  const r = readSettings(p);
  const defs = (SETTING_DEFS as readonly SettingDef[]).filter((d) => !key || d.key === key);
  return {
    file: r.file,
    settings: defs.map((d) => describeSetting(d, r.values[d.key], r.set.includes(d.key), p)),
    ...(r.problems.length ? { problems: r.problems } : {}),
  };
}

const show = (v: unknown) => (v === null ? "(unset)" : typeof v === "string" ? v : JSON.stringify(v));

/** Runs the command; returns the exit code. */
export function settingsCommand(args: string[], out: Out, p: SettingsPlace = {}): number {
  const [sub, key, ...rest] = args;
  if (sub === "get" || sub === undefined) {
    if (key && !isSettingKey(key)) throw new Error(`no setting "${key}"; the settings are ${SETTING_DEFS.map((d) => d.key).join(", ")}`);
    const report = settingsReport(p, key);
    out(report, () =>
      [
        ...report.settings.map((s) => `${s.key.padEnd(26)} ${show(s.value)}${"effective" in s ? `  (${show(s.effective)})` : ""}${s.isDefault ? "  [default]" : ""}`),
        ...(report.problems ?? []).map((x) => `warning: ${x.message}`),
        `(${report.file})`,
      ].join("\n"),
    );
    return 0;
  }
  if (sub === "set" || sub === "reset") {
    if (!key) throw new Error(SETTINGS_USAGE);
    if (!isSettingKey(key)) throw new Error(`no setting "${key}"; the settings are ${SETTING_DEFS.map((d) => d.key).join(", ")}`);
    if (sub === "set" && !rest.length) throw new Error(`usage: protoboard settings set ${key} <value>  (\`default\` resets it)`);
    const value = sub === "reset" ? null : parseSettingText(key, rest.join(" "));
    const change = setSetting(key, value, CLI_ACTOR, p);
    out({ ok: true, change }, () => (change.from === change.to ? `${key} is already ${show(change.to)}` : `${key}: ${show(change.from)} -> ${show(change.to)}`));
    return 0;
  }
  if (sub === "log") {
    const changes = settingChanges(p);
    out({ changes }, () => (changes.length ? changes.map((c) => `${c.at}  ${c.key}  ${show(c.from)} -> ${show(c.to)}  by ${c.actor}`).join("\n") : "No setting was changed yet."));
    return 0;
  }
  throw new Error(SETTINGS_USAGE);
}

/**
 * The user's Protoboard settings (R2-E, J1, 2026-11-02): one JSON file under
 * the Protoboard home (`<home>/settings.json`, home = PROTOBOARD_HOME or
 * ~/.protoboard), read by the VS Code extension, the CLI
 * (`protoboard settings get|set|reset`) and the MCP tools (`settings_get`,
 * `settings_set`), so the person and their agent change the same values.
 *
 * Kevin's walkthrough (2026-11-01): "maybe we can change that in the
 * settings; the agent has access to those settings"; "export goes to the
 * downloads folder, don't even ask"; "ask one time: what's your preferred
 * tool for looking at STEP files; you can change it later in the settings,
 * or the agent can".
 *
 * - The file holds only what was changed (a key absent is its default), as
 *   flat dotted keys: `{ "schema": "protoboard.settings/v0",
 *   "viewer.openModelsInPlace": false }`. Unknown keys and values of the
 *   wrong type are reported and ignored, never guessed.
 * - Every change appends a line to `<home>/settings-changes.jsonl` with the
 *   time, the key, the old and new value and the actor ("person (VS Code)",
 *   "cli", "agent (Claude Code)"), so a change an agent made can be told
 *   from one the person made (the extension asks before it runs an
 *   executable an agent chose, see `lastChange`).
 * - Writes are atomic (a temporary file renamed over the old one); the file
 *   is capped at 64 kB when read (security basics: size caps on parsed files).
 *
 * No VS Code API here: the extension, the CLI and the tests import it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { stackHome } from "./stack.js";

export const SETTINGS_SCHEMA = "protoboard.settings/v0";
/** The settings file, in the Protoboard home. */
export const SETTINGS_FILE = "settings.json";
/** The change log, one JSON object per line, in the Protoboard home. */
export const SETTINGS_LOG = "settings-changes.jsonl";
/** DEFAULT (R2-E): a settings file larger than this is not read (it is a handful of keys). */
export const SETTINGS_MAX_BYTES = 64 * 1024;
/** DEFAULT (R2-E): the change log is trimmed to its last lines when it grows past this many bytes. */
export const SETTINGS_LOG_MAX_BYTES = 256 * 1024;

/** The STEP viewers the one-time question offers (`tools.stepViewer` also takes an absolute path to an executable). */
export const STEP_VIEWERS = [
  { id: "fusion360", label: "Fusion 360", detail: "Autodesk Fusion, installed on this computer" },
  { id: "onshape", label: "Onshape (browser)", detail: "Opens Onshape in the browser and shows the file to import" },
  { id: "kicad", label: "KiCad", detail: "KiCad's own program (it shows STEP models of boards and footprints)" },
  { id: "freecad", label: "FreeCAD", detail: "FreeCAD, installed on this computer" },
  { id: "protoboard", label: "Protoboard CAD viewer", detail: "The model in a VS Code tab" },
  { id: "system", label: "System default", detail: "Whatever the system opens .step files with" },
] as const;
export type StepViewerId = (typeof STEP_VIEWERS)[number]["id"];
export const STEP_VIEWER_IDS: readonly string[] = STEP_VIEWERS.map((v) => v.id);

/** Every setting, its kind and its default. Each default is a DEFAULT (R2-E, 2026-11-02): revisit with Kevin. */
export const SETTING_DEFS = [
  {
    key: "viewer.openModelsInPlace",
    kind: "boolean",
    default: true,
    title: "Open models in place",
    description: "Opening a model or a module's 3D view changes the current viewer tab (Back returns); Ctrl+click or a right-click's Open in New Tab opens a new tab. Off: every open is a new tab.",
  },
  {
    key: "viewer.zoomToCursor",
    kind: "boolean",
    default: true,
    title: "Zoom toward the pointer",
    description: "The mouse wheel zooms toward the point under the pointer in the 3D view. Off: toward the centre of the view.",
  },
  {
    key: "viewer.modelInfo",
    kind: "boolean",
    default: true,
    title: "Model info",
    description: "The 3D view's model info card (what is shown, its size, its parts) is open when a view opens.",
  },
  {
    key: "viewer.hoverLongDelayMs",
    kind: "number",
    default: 900,
    min: 200,
    max: 5000,
    title: "Long hover delay (ms)",
    description: "How long the pointer rests on a part or a finding before the larger tooltip shows (the short one shows at once).",
  },
  {
    key: "tools.stepViewer",
    kind: "app",
    default: null,
    title: "STEP files open with",
    description: `The application "Open in the system's application" uses for a STEP file: ${STEP_VIEWER_IDS.join(", ")}, or the absolute path of an executable. Unset: asked once, the first time.`,
  },
  {
    key: "files.exportFolder",
    kind: "folder",
    default: null,
    title: "Export folder",
    description: "Where exports (a picture of the view, a part's STEP, STL or GLB) are written, without asking. Unset: the Downloads folder.",
  },
  {
    key: "files.importFolder",
    kind: "folder",
    default: null,
    title: "Import folder",
    description: "Where a file picker for imports starts. Unset: the project's own folder for the import (today: the part's folder under parts/).",
  },
] as const;

export type SettingKey = (typeof SETTING_DEFS)[number]["key"];
export type SettingKind = "boolean" | "number" | "app" | "folder";
export interface SettingDef {
  key: SettingKey;
  kind: SettingKind;
  default: boolean | number | string | null;
  min?: number;
  max?: number;
  title: string;
  description: string;
}
export const SETTING_KEYS: readonly SettingKey[] = SETTING_DEFS.map((d) => d.key);

export interface ProtoboardSettings {
  "viewer.openModelsInPlace": boolean;
  "viewer.zoomToCursor": boolean;
  "viewer.modelInfo": boolean;
  "viewer.hoverLongDelayMs": number;
  /** A `STEP_VIEWERS` id or an absolute path to an executable; null: not chosen yet (asked once). */
  "tools.stepViewer": string | null;
  /** An absolute folder; null: the Downloads folder (`downloadsFolder`). */
  "files.exportFolder": string | null;
  /** An absolute folder; null: the project's configured folder. */
  "files.importFolder": string | null;
}

export type SettingValue = ProtoboardSettings[SettingKey];

export const DEFAULT_SETTINGS: ProtoboardSettings = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default])) as unknown as ProtoboardSettings;

export const settingDef = (key: string): SettingDef | undefined => (SETTING_DEFS as readonly SettingDef[]).find((d) => d.key === key);
export const isSettingKey = (key: string): key is SettingKey => SETTING_KEYS.includes(key as SettingKey);

/** Who changed a setting: the person in VS Code, the CLI, or an agent (its client's name when it gave one). */
export type SettingActor = string;
export const PERSON_ACTOR = "person (VS Code)";
export const CLI_ACTOR = "cli";
export const agentActor = (client?: string) => `agent${client ? ` (${client.replace(/[\r\n]/g, " ").slice(0, 80)})` : ""}`;
export const isAgentActor = (actor: string | undefined) => !!actor && actor.startsWith("agent");

export interface SettingsProblem {
  key?: string;
  message: string;
}

export interface SettingsRead {
  /** Every setting, the file's value where it holds a valid one, else the default. */
  values: ProtoboardSettings;
  /** The keys the file sets (valid ones). */
  set: SettingKey[];
  /** The file. */
  file: string;
  problems: SettingsProblem[];
}

export interface SettingsPlace {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** The Protoboard home (PROTOBOARD_HOME or ~/.protoboard). */
const homeOf = (p: SettingsPlace = {}) => stackHome(p.env ?? process.env, p.home ?? homedir());
export const settingsFile = (p: SettingsPlace = {}) => join(homeOf(p), SETTINGS_FILE);
export const settingsLogFile = (p: SettingsPlace = {}) => join(homeOf(p), SETTINGS_LOG);

/**
 * The Downloads folder: `XDG_DOWNLOAD_DIR` when the environment names one (Linux desktops), else `<home>/Downloads`.
 * DEFAULT (R2-E): a Windows profile whose Downloads was moved through the shell's known-folder setting is not read
 * (that needs the registry); set `files.exportFolder` to it.
 */
export function downloadsFolder(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env.XDG_DOWNLOAD_DIR?.replace(/^\$HOME/, home);
  if (xdg && isAbsolute(xdg)) return xdg;
  return join(home, "Downloads");
}

/** A value checked against its setting: the value to keep, or why it is refused. `null` resets to the default. */
export function checkSetting(key: string, value: unknown): { ok: true; value: SettingValue } | { ok: false; message: string } {
  const def = settingDef(key);
  if (!def) return { ok: false, message: `no setting "${key}"; the settings are ${SETTING_KEYS.join(", ")}` };
  if (value === null || value === undefined) return { ok: true, value: def.default as SettingValue };
  switch (def.kind) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, message: `${key} is true or false` };
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: `${key} is a number` };
      const v = Math.round(value);
      if ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) return { ok: false, message: `${key} is between ${def.min} and ${def.max}` };
      return { ok: true, value: v };
    }
    case "app": {
      if (typeof value !== "string" || !value.trim()) return { ok: false, message: `${key} is one of ${STEP_VIEWER_IDS.join(", ")}, or the absolute path of an executable` };
      const v = value.trim();
      if (STEP_VIEWER_IDS.includes(v)) return { ok: true, value: v };
      if (!safePath(v)) return { ok: false, message: `${key}: "${v}" is not one of ${STEP_VIEWER_IDS.join(", ")} nor an absolute path to an executable` };
      return { ok: true, value: resolve(v) };
    }
    case "folder": {
      if (typeof value !== "string" || !safePath(value.trim())) return { ok: false, message: `${key} is the absolute path of a folder` };
      return { ok: true, value: resolve(value.trim()) };
    }
  }
}

/** An absolute path with no control characters (a NUL or a newline is never part of a real path). */
const safePath = (p: string) => p.length > 0 && p.length <= 1024 && isAbsolute(p) && !/[\u0000-\u001f]/.test(p);

/** A value as typed on a command line (`true`, `900`, `fusion360`, `C:\\Tools\\viewer.exe`); `default` resets. */
export function parseSettingText(key: string, text: string): unknown {
  const def = settingDef(key);
  const t = text.trim();
  if (t === "default" || t === "unset" || t === "") return null;
  if (def?.kind === "boolean") return t === "true" || t === "on" || t === "1" ? true : t === "false" || t === "off" || t === "0" ? false : t;
  if (def?.kind === "number") return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  return t;
}

/** Read the settings: every value, the file's where valid. A missing file is every default; an unreadable one says so. */
export function readSettings(p: SettingsPlace = {}): SettingsRead {
  const file = settingsFile(p);
  const values: ProtoboardSettings = { ...DEFAULT_SETTINGS };
  const set: SettingKey[] = [];
  const problems: SettingsProblem[] = [];
  if (!existsSync(file)) return { values, set, file, problems };
  let raw: unknown;
  try {
    if (statSync(file).size > SETTINGS_MAX_BYTES) throw new Error(`larger than ${SETTINGS_MAX_BYTES} bytes`);
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problems.push({ message: `${file} was not read (${(e as Error).message}); every setting is its default` });
    return { values, set, file, problems };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push({ message: `${file} is not a JSON object; every setting is its default` });
    return { values, set, file, problems };
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "schema" || k === "$schema") continue;
    const r = checkSetting(k, v);
    if (!r.ok) {
      problems.push({ key: k, message: `${r.message}; ignored` });
      continue;
    }
    if (v === null) continue;
    (values as unknown as Record<string, unknown>)[k] = r.value;
    set.push(k as SettingKey);
  }
  return { values, set, file, problems };
}

export function getSetting<K extends SettingKey>(key: K, p: SettingsPlace = {}): ProtoboardSettings[K] {
  return readSettings(p).values[key];
}

export interface SettingChange {
  at: string;
  key: SettingKey;
  from: SettingValue;
  to: SettingValue;
  actor: SettingActor;
}

/**
 * Change one setting (`null` resets it to the default) and log who did it. Returns the change (`from` equal to `to`
 * when nothing changed: nothing is written then). Throws with the reason when the value is refused.
 */
export function setSetting(key: string, value: unknown, actor: SettingActor, p: SettingsPlace & { now?: Date } = {}): SettingChange {
  const r = checkSetting(key, value);
  if (!r.ok) throw new Error(r.message);
  const k = key as SettingKey;
  const before = readSettings(p);
  const from = before.values[k];
  const to = r.value;
  const change: SettingChange = { at: (p.now ?? new Date()).toISOString(), key: k, from, to, actor: actor.replace(/[\r\n]/g, " ").slice(0, 120) };
  const reset = value === null || value === undefined;
  const wasSet = before.set.includes(k);
  // nothing to write: a reset of a key the file does not hold, or the value the file holds already
  const unchanged = reset ? !wasSet : wasSet && from === to;
  if (unchanged) return change;
  // the file keeps only what differs from the defaults, and only valid keys (a key the file had wrong is dropped)
  const next: Record<string, unknown> = { schema: SETTINGS_SCHEMA };
  for (const s of before.set) if (s !== k) next[s] = before.values[s];
  if (!reset) next[k] = to;
  writeAtomic(before.file, JSON.stringify(next, null, 2) + "\n");
  appendLog(settingsLogFile(p), change);
  return change;
}

function writeAtomic(file: string, text: string) {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

function appendLog(file: string, change: SettingChange) {
  try {
    mkdirSync(join(file, ".."), { recursive: true });
    if (existsSync(file) && statSync(file).size > SETTINGS_LOG_MAX_BYTES) {
      // keep the newer half: the log is a record of recent changes, not an archive
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      writeAtomic(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
    }
    appendFileSync(file, JSON.stringify(change) + "\n", { mode: 0o600 });
  } catch {
    // the change is made; a log that cannot be written does not undo it
  }
}

/** The changes logged, newest last (at most `limit`, DEFAULT 50). */
export function settingChanges(p: SettingsPlace & { limit?: number } = {}): SettingChange[] {
  const file = settingsLogFile(p);
  if (!existsSync(file)) return [];
  try {
    if (statSync(file).size > SETTINGS_LOG_MAX_BYTES * 2) return [];
    const out: SettingChange[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line) as SettingChange;
        if (c && typeof c.key === "string" && typeof c.actor === "string") out.push(c);
      } catch {
        // a torn line is skipped
      }
    }
    return out.slice(-(p.limit ?? 50));
  } catch {
    return [];
  }
}

/** The last logged change of a key that matches the value it holds now (who set it), if any. */
export function lastChange(key: SettingKey, p: SettingsPlace = {}): SettingChange | undefined {
  const now = readSettings(p).values[key];
  const all = settingChanges({ ...p, limit: 1000 }).filter((c) => c.key === key);
  const last = all[all.length - 1];
  return last && last.to === now ? last : undefined;
}

/** Where an export goes now: `files.exportFolder`, else the Downloads folder. */
export function exportFolder(p: SettingsPlace = {}): string {
  return readSettings(p).values["files.exportFolder"] ?? downloadsFolder(p.env ?? process.env, p.home ?? homedir());
}

/**
 * An export's file name: `<project>-<view or part>-<date>.<ext>` (Kevin, G3), each part made safe for every file
 * system (no `< > : " / \ | ? *`, no control characters, no trailing dots or spaces, no reserved device names), and
 * `-2`, `-3`, ... added when the name is taken (`exists`).
 */
export function exportFileName(project: string, what: string, ext: string, o: { now?: Date; exists?: (name: string) => boolean } = {}): string {
  const d = o.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const base = [safeName(project) || "protoboard", safeName(what) || "export", date].join("-");
  const e = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const exists = o.exists ?? (() => false);
  for (let n = 1; n < 1000; n++) {
    const name = `${base}${n > 1 ? `-${n}` : ""}.${e}`;
    if (!exists(name)) return name;
  }
  return `${base}-${Date.now()}.${e}`;
}

/** One part of a file name, safe on Windows, macOS and Linux (CLAUDE.md file naming rules). */
export function safeName(s: string): string {
  const t = s
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-. ]+$/g, "")
    .slice(0, 80);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(t) ? `${t}-file` : t;
}

/**
 * The user's Protoboard settings in the extension (R2-E, J1, 2026-11-02): core settings.ts's file
 * (`<home>/settings.json`), the same one `protoboard settings` and the agent's `settings_set` change. Kevin: "maybe we
 * can change that in the settings; the agent has access to those settings".
 *
 * - The values are read at start and again whenever the file changes (a watch on the Protoboard home, so a change
 *   from the CLI or an agent reaches the open viewer tabs and the Settings page at once).
 * - The Settings page lists them as rows (`settingRows`, in its list of actions until the page has a Viewer section
 *   of its own: handoffs.md, R2-E to the views owner); a row's button toggles, asks for a number, a folder or an app.
 * - A change made here is logged with the actor "person (VS Code)".
 */
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { PERSON_ACTOR, SETTING_DEFS, downloadsFolder, readSettings, setSetting, settingDef, settingsFile, type ProtoboardSettings, type SettingDef, type SettingKey, type SettingsPlace } from "@protoboardai/core/settings";
import type { ViewerSettings } from "../../web-viewer/src/vscode/protocol.js";
import type { SettingsLink } from "./settingsPage.js";
import type { SettingRowModel } from "@protoboardai/views/parts-model";
import { stepViewerLabel } from "./stepViewer.js";

/** The viewer's part of the settings, as a tab takes them (protocol.ts `ViewerSettings`). */
export function viewerSettingsOf(v: ProtoboardSettings): ViewerSettings {
  return {
    openModelsInPlace: v["viewer.openModelsInPlace"],
    zoomToCursor: v["viewer.zoomToCursor"],
    modelInfo: v["viewer.modelInfo"],
    hoverLongDelayMs: v["viewer.hoverLongDelayMs"],
  };
}

/** A setting's value as a row shows it. */
export function settingText(def: SettingDef, v: ProtoboardSettings, place: SettingsPlace = {}): string {
  const value = v[def.key];
  switch (def.kind) {
    case "boolean":
      return value ? "On" : "Off";
    case "number":
      return `${value} ms`;
    case "app":
      return value === null ? "Not chosen yet (asked the first time)" : stepViewerLabel(value as string);
    case "folder":
      if (value !== null) return value as string;
      return def.key === "files.exportFolder" ? `Downloads (${downloadsFolder(place.env ?? process.env)})` : "The project's own folder for the import";
  }
}

/** Each setting's icon on the Settings page (lucide names). */
const SETTING_ICONS: Record<string, string> = {
  "viewer.openModelsInPlace": "square-arrow-out-up-right",
  "viewer.zoomToCursor": "zoom-in",
  "viewer.modelInfo": "info",
  "viewer.hoverLongDelayMs": "timer",
  "tools.stepViewer": "box",
  "files.exportFolder": "download",
  "files.importFolder": "folder-input",
};

/**
 * The Settings page's Viewer section (R2 integration, R2-E's handoff to the views owner): one row per setting, with
 * the value as words and whether it is the default. The page's switch and number box set a value; Choose… runs the
 * folder or app question (`editSetting`).
 */
export function viewerRows(v: ProtoboardSettings, place: SettingsPlace = {}): SettingRowModel[] {
  return (SETTING_DEFS as readonly SettingDef[]).map((def) => ({
    key: def.key,
    title: def.title,
    description: def.description,
    kind: def.kind,
    value: v[def.key],
    text: settingText(def, v, place),
    isDefault: v[def.key] === def.default,
    ...(def.min !== undefined ? { min: def.min } : {}),
    ...(def.max !== undefined ? { max: def.max } : {}),
    ...(def.kind === "number" ? { unit: "ms" } : {}),
    icon: SETTING_ICONS[def.key] ?? "settings",
  }));
}

/** The settings as rows of the page's More actions (R2-E's first form; the page now has a Viewer section: `viewerRows`). */
export function settingRows(v: ProtoboardSettings, place: SettingsPlace = {}): SettingsLink[] {
  const icon = SETTING_ICONS;
  return (SETTING_DEFS as readonly SettingDef[]).map((def) => ({
    id: `setting:${def.key}`,
    label: `${def.title}: ${settingText(def, v, place)}`,
    note: def.description,
    icon: icon[def.key] ?? "settings",
    action: def.kind === "boolean" ? (v[def.key] ? "Turn Off" : "Turn On") : def.kind === "number" ? "Change…" : "Choose…",
    command: "protoboard.settings.edit",
    args: [def.key],
  }));
}

/** The settings, kept current, and told to whoever listens when they change. */
export class UserSettings implements vscode.Disposable {
  private current: ProtoboardSettings;
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly changed = new vscode.EventEmitter<ProtoboardSettings>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly log: vscode.LogOutputChannel,
    readonly place: SettingsPlace = {},
  ) {
    this.current = this.read();
    this.watch();
  }

  get values(): ProtoboardSettings {
    return this.current;
  }

  get viewer(): ViewerSettings {
    return viewerSettingsOf(this.current);
  }

  private read(): ProtoboardSettings {
    const r = readSettings(this.place);
    for (const p of r.problems) this.log.warn(`settings: ${p.message}`);
    return r.values;
  }

  /** Read the file again; tell the listeners when anything changed. */
  reload() {
    const next = this.read();
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.changed.fire(next);
  }

  /** Watch the Protoboard home for the file (it may not exist yet: the folder is made, as a settings write would). */
  private watch() {
    const file = settingsFile(this.place);
    try {
      mkdirSync(dirname(file), { recursive: true });
      this.watcher = watch(dirname(file), (_event, name) => {
        if (name && basename(String(name)) !== basename(file)) return;
        clearTimeout(this.timer);
        // DEFAULT (R2-E): 150 ms after the last event (a write is a temporary file renamed over the old one)
        this.timer = setTimeout(() => this.reload(), 150);
      });
      this.watcher.on("error", (e) => this.log.warn(`settings: the watch on ${dirname(file)} stopped (${e.message}); changes made elsewhere show after a reload`));
    } catch (e) {
      this.log.warn(`settings: ${dirname(file)} is not watched (${(e as Error).message}); changes made elsewhere show after a reload`);
    }
  }

  /** Change a setting as the person (logged), and tell the listeners. */
  set(key: SettingKey, value: unknown) {
    const change = setSetting(key, value, PERSON_ACTOR, this.place);
    if (change.from !== change.to) this.log.info(`settings: ${key} ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)} (${PERSON_ACTOR})`);
    this.reload();
    return change;
  }

  dispose() {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.changed.dispose();
  }
}

/**
 * A row's button on the Settings page (`protoboard.settings.edit`): toggle a switch, ask for a number, a folder or the
 * STEP viewer. `pickApp` is the STEP viewer's question (stepViewer.ts).
 */
export async function editSetting(settings: UserSettings, key: unknown, pickApp: () => Promise<string | null | undefined>): Promise<void> {
  const def = typeof key === "string" ? settingDef(key) : undefined;
  if (!def) throw new Error(`no Protoboard setting ${String(key)}`);
  const v = settings.values;
  switch (def.kind) {
    case "boolean":
      settings.set(def.key, !v[def.key]);
      return;
    case "number": {
      const text = await vscode.window.showInputBox({
        title: def.title,
        prompt: `${def.description} Between ${def.min} and ${def.max}; empty for the default (${def.default}).`,
        value: String(v[def.key]),
        validateInput: (t) => (!t.trim() ? undefined : /^\d+$/.test(t.trim()) && Number(t) >= (def.min ?? 0) && Number(t) <= (def.max ?? Infinity) ? undefined : `A whole number between ${def.min} and ${def.max}`),
      });
      if (text === undefined) return;
      settings.set(def.key, text.trim() ? Number(text) : null);
      return;
    }
    case "app": {
      const choice = await pickApp();
      if (choice === undefined) return;
      settings.set(def.key, choice);
      return;
    }
    case "folder": {
      const now = v[def.key] as string | null;
      const fallback = def.key === "files.exportFolder" ? `Downloads (${downloadsFolder()})` : "the project's own folder";
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(folder-opened) Choose a folder…", id: "choose" },
          { label: `$(discard) Use the default: ${fallback}`, id: "default" },
        ],
        { title: def.title, placeHolder: now ?? fallback },
      );
      if (!pick) return;
      if (pick.id === "default") return void settings.set(def.key, null);
      const start = now && existsSync(now) ? now : def.key === "files.exportFolder" ? downloadsFolder() : undefined;
      const chosen = await vscode.window.showOpenDialog({ title: def.title, canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Use This Folder", ...(start ? { defaultUri: vscode.Uri.file(start) } : {}) });
      if (!chosen?.[0]) return;
      settings.set(def.key, chosen[0].fsPath);
      return;
    }
  }
}

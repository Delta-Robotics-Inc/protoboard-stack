/**
 * The preferred STEP viewer (R2-E, G2, 2026-11-02). Kevin: "ask whenever they add a STEP file, one time: what's your
 * preferred tool for looking at STEP files; that sets the default, you can change it later in the settings, or the
 * agent can". Windows showed "Select an app to open this .step file" (walkthrough 1446-1.png): no STEP viewer was
 * set on the machine.
 *
 * "Open in the system's application" on a STEP file (the CAD viewer tab's button, openOutside.ts) reads
 * `tools.stepViewer` (core settings.ts):
 * - unset: a small quick pick asks once (Fusion 360, Onshape in the browser, KiCad, FreeCAD, the Protoboard CAD
 *   viewer, the system default, or an executable), the answer is stored (the person's choice) and used;
 *   dismissed, nothing opens (the system's own "Select an app" chooser is what the question replaces) and the
 *   question comes again next time;
 * - an app id: that application, found where it installs (`stepLaunch`); not found, the person is told and the
 *   system default is offered;
 * - an executable's path: run with the file as its one argument (no shell). It runs only when the person picked it
 *   (the question's file dialog) or confirmed it once (wave R2 gate, fail closed): the confirmed programs are kept
 *   in VS Code's own global state (path, size, modified time), outside every file an agent can write, so a value
 *   set through `settings_set`, `protoboard settings set` run by an agent, or an edited settings file is asked
 *   about before it runs, and a confirmed program replaced on disk is asked about again.
 *
 * The full onboarding (asking when a project first gets a STEP file) is a FEATURE (handoffs.md).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { join } from "node:path";
import * as vscode from "vscode";
import { STEP_VIEWERS, isAgentActor, lastChange, type SettingsPlace } from "@protoboardai/core/settings";

/** How a choice opens a file. */
export type StepLaunch =
  | { kind: "exec"; command: string; args: string[]; app: string }
  | { kind: "url"; url: string; app: string }
  | { kind: "system" }
  | { kind: "protoboard" }
  | { kind: "missing"; app: string; message: string };

/** Onshape has no way to open a local file by address: its documents page opens and the file is shown to drag in. DEFAULT. */
export const ONSHAPE_URL = "https://cad.onshape.com/documents";

export interface FindOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  /** Folder entries (sorted by the caller's rule below). */
  list?: (dir: string) => string[];
  mtime?: (p: string) => number;
}

const listDir = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Versions as numbers for sorting ("9.0" after "8.0", "1.0.1" after "1.0"). */
const versionKey = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
const newestVersion = (names: string[]) =>
  [...names].sort((a, b) => {
    const x = versionKey(a);
    const y = versionKey(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  });

/**
 * Where an application installs, per platform (DEFAULT, R2-E: the vendors' default install folders; a copy elsewhere is
 * chosen as an executable instead):
 * - Fusion 360 on Windows: `%LOCALAPPDATA%\Autodesk\webdeploy\production\<build>\FusionLauncher.exe`, the newest
 *   build; on macOS `open -a "Autodesk Fusion"`.
 * - KiCad on Windows: `%ProgramFiles%\KiCad\<version>\bin\kicad.exe`, the newest version; macOS `open -a KiCad`;
 *   Linux `kicad`.
 * - FreeCAD on Windows: `%ProgramFiles%\FreeCAD <version>\bin\FreeCAD.exe`; macOS `open -a FreeCAD`; Linux `freecad`.
 */
export function stepLaunch(choice: string, file: string, o: FindOptions = {}): StepLaunch {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  const list = o.list ?? listDir;
  const mtime = o.mtime ?? ((p: string) => statSync(p).mtimeMs);
  const label = stepViewerLabel(choice);
  const macOpen = (app: string): StepLaunch => ({ kind: "exec", command: "open", args: ["-a", app, file], app: label });
  switch (choice) {
    case "system":
      return { kind: "system" };
    case "protoboard":
      return { kind: "protoboard" };
    case "onshape":
      return { kind: "url", url: ONSHAPE_URL, app: label };
    case "fusion360": {
      if (platform === "darwin") return macOpen("Autodesk Fusion");
      if (platform === "win32" && env.LOCALAPPDATA) {
        const base = join(env.LOCALAPPDATA, "Autodesk", "webdeploy", "production");
        const builds = list(base)
          .map((d) => join(base, d, "FusionLauncher.exe"))
          .filter((p) => exists(p))
          .sort((a, b) => mtime(b) - mtime(a));
        if (builds[0]) return { kind: "exec", command: builds[0], args: [file], app: label };
      }
      return { kind: "missing", app: label, message: "Fusion 360 was not found where it installs" };
    }
    case "kicad": {
      if (platform === "darwin") return macOpen("KiCad");
      if (platform === "win32") {
        const base = join(env.ProgramFiles ?? "C:\\Program Files", "KiCad");
        for (const v of newestVersion(list(base))) {
          const exe = join(base, v, "bin", "kicad.exe");
          if (exists(exe)) return { kind: "exec", command: exe, args: [file], app: label };
        }
        return { kind: "missing", app: label, message: "KiCad was not found where it installs" };
      }
      return { kind: "exec", command: "kicad", args: [file], app: label };
    }
    case "freecad": {
      if (platform === "darwin") return macOpen("FreeCAD");
      if (platform === "win32") {
        const base = env.ProgramFiles ?? "C:\\Program Files";
        for (const d of newestVersion(list(base).filter((n) => /^FreeCAD/i.test(n)))) {
          const exe = join(base, d, "bin", "FreeCAD.exe");
          if (exists(exe)) return { kind: "exec", command: exe, args: [file], app: label };
        }
        return { kind: "missing", app: label, message: "FreeCAD was not found where it installs" };
      }
      return { kind: "exec", command: "freecad", args: [file], app: label };
    }
    default:
      // an executable's absolute path (core settings.ts checked it is one)
      if (!exists(choice)) return { kind: "missing", app: label, message: `${choice} is not there any more` };
      return { kind: "exec", command: choice, args: [file], app: label };
  }
}

/** A choice as the person reads it. */
export function stepViewerLabel(choice: string): string {
  return STEP_VIEWERS.find((v) => v.id === choice)?.label ?? choice;
}

/** The question (once, and again from the Settings page): the app id or executable chosen, undefined when dismissed. */
export async function askStepViewer(current?: string | null): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { id: string };
  const items: Item[] = [
    ...STEP_VIEWERS.map((v) => ({ id: v.id as string, label: v.label, detail: v.detail, ...(current === v.id ? { description: "now" } : {}) })),
    { id: "exe", label: "Choose an executable…", detail: "Any program that opens a .step file given as its argument" },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: "Which app opens STEP files?",
    placeHolder: "Asked once; change it later in Protoboard: Open Settings (or ask your agent)",
    ignoreFocusOut: true,
  });
  if (!pick) return undefined;
  if (pick.id !== "exe") return pick.id;
  const exe = await vscode.window.showOpenDialog({
    title: "The program that opens STEP files",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Use This Program",
    // a program, not a script: it is started without a shell
    ...(process.platform === "win32" ? { filters: { Programs: ["exe"] } } : {}),
  });
  return exe?.[0]?.fsPath;
}

/** Where the confirmed programs are kept (VS Code's `context.globalState`; a Memento). */
export interface TrustStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | void;
}
/** The global-state key of the person-confirmed STEP programs (wave R2 gate). */
export const TRUSTED_STEP_PROGRAMS = "protoboard.trustedStepPrograms";
type TrustedEntry = { size: number; mtimeMs: number };
const exeKey = (exe: string) => {
  const p = resolvePath(exe);
  return process.platform === "win32" ? p.toLowerCase() : p;
};
const exeStamp = (exe: string): TrustedEntry | undefined => {
  try {
    const st = statSync(exe);
    return st.isFile() ? { size: st.size, mtimeMs: Math.round(st.mtimeMs) } : undefined;
  } catch {
    return undefined;
  }
};
/** The person confirmed this program, and it is the same file (size and modified time) as when they did. */
export function isTrustedProgram(store: TrustStore, exe: string): boolean {
  const e = store.get<Record<string, TrustedEntry>>(TRUSTED_STEP_PROGRAMS)?.[exeKey(exe)];
  const now = exeStamp(exe);
  return Boolean(e && now && e.size === now.size && e.mtimeMs === now.mtimeMs);
}
/** Record the person's confirmation (or their own pick in the file dialog). DEFAULT: at most 20 programs kept. */
export function trustProgram(store: TrustStore, exe: string): void {
  const now = exeStamp(exe);
  if (!now) return;
  const all = { ...(store.get<Record<string, TrustedEntry>>(TRUSTED_STEP_PROGRAMS) ?? {}), [exeKey(exe)]: now };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k];
  void store.update(TRUSTED_STEP_PROGRAMS, all);
}
const isApp = (choice: string) => STEP_VIEWERS.some((v) => v.id === choice);

export interface StepOpenHost {
  log: vscode.LogOutputChannel;
  /** The programs the person confirmed (absent: none is, every executable is asked about). Wave R2 gate. */
  trusted?(exe: string): boolean;
  /** Keep the person's confirmation of a program. */
  trust?(exe: string): void;
  /** The setting now. */
  choice(): string | null;
  /** Store the person's choice. */
  choose(value: string): void;
  /** Where the settings live (tests). */
  place?: SettingsPlace;
  /** Open in the Protoboard CAD viewer tab. */
  openInViewer(uri: vscode.Uri): Promise<unknown>;
  /** The system's own application (what "Open in the system's application" did before). */
  openSystem(uri: vscode.Uri): Promise<unknown>;
}

/** Start a program detached, the file as its argument, no shell. Resolves when it started (or fails). */
function launch(command: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false, shell: false });
      child.once("error", fail);
      child.once("spawn", () => {
        child.unref();
        ok();
      });
    } catch (e) {
      fail(e as Error);
    }
  });
}

/** "Open in the system's application" for a STEP file: the preferred viewer, asked once. */
export async function openStepFile(uri: vscode.Uri, host: StepOpenHost): Promise<string> {
  let choice = host.choice();
  if (choice === null) {
    const asked = await askStepViewer();
    if (!asked) {
      host.log.info("STEP viewer: the question was dismissed; nothing opened (asked again next time)");
      return "none";
    }
    host.choose(asked);
    // the person picked this program in the file dialog themselves
    if (!isApp(asked)) host.trust?.(asked);
    choice = asked;
  } else if (!isApp(choice) && !host.trusted?.(choice)) {
    // wave R2 gate (fail closed): a program the person has not confirmed runs only after they say so, whoever set it
    // (an agent through settings_set or the CLI, or an edited settings file; the change log is a hint, not a proof)
    const byAgent = isAgentActor(lastChange("tools.stepViewer", host.place)?.actor);
    const yes = "Run It";
    const answer = await vscode.window.showWarningMessage(`${byAgent ? "An agent set" : "Your settings set"} STEP files to open with ${choice}. Run that program?`, { modal: true, detail: "Protoboard runs it with the STEP file as its argument. Your answer is kept for this program; change it in Protoboard: Open Settings." }, yes);
    if (answer !== yes) {
      await host.openSystem(uri);
      return "system";
    }
    host.trust?.(choice);
  }
  const how = stepLaunch(choice, uri.fsPath);
  host.log.info(`STEP viewer: ${choice} -> ${how.kind}${how.kind === "exec" ? ` ${how.command}` : ""}`);
  switch (how.kind) {
    case "system":
      await host.openSystem(uri);
      return "system";
    case "protoboard":
      await host.openInViewer(uri);
      return "protoboard";
    case "url":
      await vscode.env.openExternal(vscode.Uri.parse(how.url));
      await vscode.commands.executeCommand("revealFileInOS", uri);
      void vscode.window.showInformationMessage(`Protoboard: ${how.app} is open in the browser; import ${uri.fsPath.split(/[\\/]/).pop()} there (the file manager shows it).`);
      return "url";
    case "exec":
      try {
        await launch(how.command, how.args);
        return "exec";
      } catch (e) {
        host.log.warn(`STEP viewer: ${how.command} did not start: ${(e as Error).message}`);
        return fallBack(uri, host, `${how.app} did not start (${(e as Error).message}).`);
      }
    case "missing":
      return fallBack(uri, host, `${how.message}.`);
  }
}

async function fallBack(uri: vscode.Uri, host: StepOpenHost, why: string): Promise<string> {
  const system = "Open With the System Default";
  const other = "Choose Another App";
  const answer = await vscode.window.showWarningMessage(`Protoboard: ${why}`, system, other);
  if (answer === other) {
    const asked = await askStepViewer(host.choice());
    if (asked) {
      host.choose(asked);
      if (!isApp(asked)) host.trust?.(asked);
      return openStepFile(uri, host);
    }
    return "none";
  }
  if (answer === system) {
    await host.openSystem(uri);
    return "system";
  }
  return "none";
}

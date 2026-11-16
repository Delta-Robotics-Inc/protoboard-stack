/**
 * Extension editors (`contributes.editors`, docs/specs/viewer-stack.md): the
 * messages between an editor's webview, the shell that hosts it (the VS Code
 * extension's custom editor) and the extension's own host process.
 *
 * No imports, Node or browser: an extension types its webview and its host
 * against this file (`@protoboardai/core/editor-protocol`), or carries a copy
 * of it.
 *
 *   webview  <-- postMessage -->  shell  <-- stdio, one JSON object per line -->  host process
 *
 * The shell owns the text document and the window: it reads and edits the
 * document, opens and reveals files, asks the person for files in the
 * system's open dialog, writes the clipboard, maps a file to a URI the
 * webview can load, and says when the theme changes. Those are the
 * services (`EditorServices`), offered to the webview and to the host alike.
 * Everything else an editor needs (previews, captures, its own file formats)
 * is the extension's own code, which runs in the host process: started by the
 * shell when the editor opens (`protoboard editors host`), only in a project
 * whose code may run, never inside the shell's own process, and ended when the
 * editor closes.
 *
 * Messages the shell does not recognize are relayed as they are: a webview
 * message that is not a shell envelope goes to the host (`{ t: "webview" }`),
 * and a host's `{ t: "webview" }` goes to the webview. Envelopes to and from
 * the webview carry a `protoboard` key and no `type`, so an editor whose
 * messages are `{ type: ... }` objects can ignore them by that rule.
 */

/** The protocol's version, sent in `init`. A host refuses an init of another major version. */
export const EDITOR_PROTOCOL = "protoboard.editor/v0";

// ---------------------------------------------------------------- shared shapes

export interface EditorTheme {
  kind: "dark" | "light" | "high-contrast" | "high-contrast-light";
  /** The color theme's id as the shell names it (VS Code: `workbench.colorTheme`). */
  id: string;
}

/** Why the document's text changed. `applied`: an edit made through `document.applyEdit` by this editor (its webview or its host). */
export type DocumentChangeReason = "applied" | "undo" | "redo" | "change";

export interface DocumentState {
  /** The whole text. */
  text: string;
  /** Increases with every change (VS Code's document version). */
  version: number;
  /** Unsaved changes. */
  dirty: boolean;
}

export interface DocumentChange extends DocumentState {
  reason: DocumentChangeReason;
}

/**
 * Where the editor runs and what it edits. Paths are absolute, in the
 * system's form. `webview` holds the URI prefixes the webview loads files of
 * the project and of the extension's package with: `webviewUri` joins a
 * relative path to one.
 */
export interface EditorContext {
  protocol: typeof EDITOR_PROTOCOL;
  /** The editor's id in its manifest, and the extension (manifest id) and npm package it comes from. */
  editor: string;
  extension: string;
  package: string;
  /** The extension package's folder. */
  packageRoot: string;
  /** The Protoboard project's folder (the one holding protoboard.config.ts). */
  root: string;
  /** The file the editor edits, and the same path relative to `root` with forward slashes. */
  file: string;
  relPath: string;
  /** The shell will not apply edits (a file it cannot write). */
  readOnly: boolean;
  theme: EditorTheme;
  webview: { root: string; package: string };
}

/** What the host process is told first: the context and the document. */
export interface EditorInit extends EditorContext {
  document: DocumentState;
}

/** Where `file.open` opens a file. `external`: the system's default application. */
export type OpenMode = "default" | "beside" | "preview" | "external";

/**
 * The services the shell offers, by name: their arguments and results. Paths
 * are project-relative (forward slashes) or absolute; a path outside the
 * project is refused, except `webview.uri` of a file in the extension's package.
 * `file.pick` is the one service whose result may name files outside the
 * project: the person chose them in the operating system's own dialog, and
 * only their paths come back, never their contents. Picking a file does not
 * widen what the webview may load (`webview.uri` stays inside the project and
 * the package).
 *
 * A name the shell does not offer is answered with the error
 * `no service <name>`: an editor detects an older shell by it.
 */
export interface EditorServices {
  /** Replace the document's whole text as one undoable edit, labeled for the undo stack. */
  "document.applyEdit": { args: { text: string; label?: string }; result: { applied: boolean; version: number } };
  "document.save": { args: Record<string, never>; result: { saved: boolean } };
  /** The shell's undo and redo for the document (the editor's own key handling may call these). */
  "document.undo": { args: Record<string, never>; result: null };
  "document.redo": { args: Record<string, never>; result: null };
  "file.open": { args: { path: string; mode?: OpenMode }; result: null };
  /** Show a file in the shell's file tree or in the system's file manager. */
  "file.reveal": { args: { path: string; where: "explorer" | "os" }; result: null };
  /**
   * Ask the person for files in the system's open dialog (files only, never
   * folders; it opens in the folder of the edited file). `filters` maps a label
   * to file extensions without the dot (`{ Images: ["png", "jpg"] }`). The
   * result is the absolute paths of the files picked, in the system's form,
   * and an empty array when the person cancels. The paths may be outside the
   * project (see above).
   */
  "file.pick": { args: { multiple?: boolean; title?: string; filters?: Record<string, string[]> }; result: { paths: string[] } };
  "clipboard.write": { args: { text: string }; result: null };
  /** Open an http(s) address in the system's browser; any other scheme is refused. */
  "external.open": { args: { url: string }; result: { opened: boolean } };
  /** A URI the webview can load the file with (null outside the project and the package). */
  "webview.uri": { args: { path: string }; result: { uri: string | null } };
  "ui.notify": { args: { level: "info" | "warning" | "error"; text: string }; result: null };
  /** A modal yes/no question: `confirmed` when the person chose `action`. */
  "ui.confirm": { args: { message: string; action: string }; result: { confirmed: boolean } };
}

export type EditorServiceName = keyof EditorServices;
export type ServiceArgs<K extends EditorServiceName> = EditorServices[K]["args"];
export type ServiceResult<K extends EditorServiceName> = EditorServices[K]["result"];

export const EDITOR_SERVICES: readonly EditorServiceName[] = [
  "document.applyEdit",
  "document.save",
  "document.undo",
  "document.redo",
  "file.open",
  "file.reveal",
  "file.pick",
  "clipboard.write",
  "external.open",
  "webview.uri",
  "ui.notify",
  "ui.confirm",
];

export const isEditorService = (s: unknown): s is EditorServiceName => typeof s === "string" && (EDITOR_SERVICES as readonly string[]).includes(s);

// ---------------------------------------------------------------- shell <-> host process (stdio JSON lines)

/** shell -> host. The first line is always `init`. */
export type ToHost =
  | ({ t: "init" } & EditorInit)
  /** A message from the webview that is not a shell envelope. */
  | { t: "webview"; message: unknown }
  | ({ t: "document" } & DocumentChange)
  | { t: "saved"; version: number }
  | { t: "theme"; theme: EditorTheme }
  | { t: "reply"; id: number; result?: unknown; error?: string }
  /** The editor closed: dispose and exit. The shell ends the process after a grace period. */
  | { t: "dispose" };

/** host -> shell. */
export type FromHost =
  /** Post this to the webview, as it is. */
  | { t: "webview"; message: unknown }
  | { t: "call"; id: number; service: EditorServiceName; args: unknown }
  | { t: "log"; level: "info" | "warning" | "error"; text: string }
  /** The host could not start (its entry failed): the shell shows `message` and ends the process. */
  | { t: "failed"; message: string };

// ---------------------------------------------------------------- shell <-> webview (postMessage envelopes)

/** webview -> shell. Anything else the webview posts goes to the host. */
export type FromWebviewEnvelope =
  /** Ask for the context (answered with `init`); a webview without a host also gets the document. */
  | { protoboard: "hello" }
  | { protoboard: "call"; id: number; service: EditorServiceName; args: unknown }
  /** A Content-Security-Policy violation, reported by the shell's own page script: logged by the shell. */
  | { protoboard: "csp"; directive: string; blocked: string; source?: string; line?: number };

/** shell -> webview. Besides these, the webview gets what its host posts. */
export type ToWebviewEnvelope =
  | ({ protoboard: "init" } & EditorContext & { document?: DocumentState; host: boolean })
  | { protoboard: "reply"; id: number; result?: unknown; error?: string }
  /** Only for an editor without a host: the host owns the document otherwise. */
  | ({ protoboard: "document" } & DocumentChange)
  | { protoboard: "theme"; theme: EditorTheme }
  /** The host process: started, or ended (with why, when it was not the editor closing). */
  | { protoboard: "host"; state: "running" | "exited"; message?: string };

export const isEnvelope = (m: unknown): m is { protoboard: string } =>
  typeof m === "object" && m !== null && typeof (m as { protoboard?: unknown }).protoboard === "string";

// ---------------------------------------------------------------- the host's entry

/** What a host entry is given. */
export interface EditorHostContext {
  init: EditorInit;
  /** Post a message to the webview. */
  post(message: unknown): void;
  /** Call a shell service; rejects with the shell's error. */
  call<K extends EditorServiceName>(service: K, args: ServiceArgs<K>): Promise<ServiceResult<K>>;
  /** A URI the webview can load an absolute path with (`init.webview`), or null outside the project and the package. */
  webviewUri(absPath: string): string | null;
  /** A line in the shell's log. */
  log(level: "info" | "warning" | "error", text: string): void;
}

/** What a host entry returns: handlers for what the shell says. */
export interface EditorHost {
  webview?(message: unknown): void | Promise<void>;
  document?(change: DocumentChange): void | Promise<void>;
  saved?(version: number): void | Promise<void>;
  theme?(theme: EditorTheme): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

/**
 * The function a manifest's `host` names (`"./host/editor-host.ts#createEditorHost"`;
 * the default export when no name is given). It runs in its own Node process,
 * with TypeScript loaded as the stack loads operations.
 */
export type EditorHostEntry = (context: EditorHostContext) => EditorHost | Promise<EditorHost>;

// ---------------------------------------------------------------- helpers

/** Join a relative path (forward slashes) to a webview URI prefix, each segment encoded. */
export function webviewUri(prefix: string, relPath: string): string {
  const segments = relPath.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) throw new Error(`path leaves its folder: ${relPath}`);
  return `${prefix.replace(/\/+$/, "")}/${segments.map(encodeURIComponent).join("/")}`;
}

/** The theme kind as the protocol names it, from VS Code's ColorThemeKind number (1 light, 2 dark, 3 high contrast, 4 high contrast light). */
export function themeKind(kind: number): EditorTheme["kind"] {
  return kind === 1 ? "light" : kind === 3 ? "high-contrast" : kind === 4 ? "high-contrast-light" : "dark";
}

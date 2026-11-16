/**
 * The pages of an extension's editor tab (extensionEditors.ts): the editor's
 * own page, its bundle loaded under a nonce Content-Security-Policy with no
 * network, and the page shown when no editor can open the file. No VS Code
 * API here.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { escapeHtml } from "./html.js";

/** The custom editor every extension editor opens in (package.json's customEditors). */
export const EXTENSION_EDITOR = "protoboard.extensionEditor";
/** Reopens the tab's file in VS Code's text editor (the fallback page's link). Not in the manifest: only the page calls it. */
export const REOPEN_AS_TEXT = "protoboard.extensionEditor.reopenAsText";

/**
 * The editor page's policy: nothing by default; scripts only with the page's
 * nonce; styles, fonts, images and media only from the webview's own
 * resources (the extension's package and the project), plus data: and blob:
 * images for what the editor makes itself; requests only to those resources.
 * No address outside the machine is reachable.
 */
export function editorCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `media-src ${cspSource} blob:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * Runs before the editor's bundle, with the same nonce: it takes the page's
 * one VS Code API handle and gives the same handle to the editor's own
 * `acquireVsCodeApi()`, and reports every Content-Security-Policy violation
 * to the extension (which logs it). In a test run it also keeps the
 * violations and errors on the page, for a test hook to read.
 */
const prelude = (test: boolean) => `(function(){var api=acquireVsCodeApi();window.acquireVsCodeApi=function(){return api;};
${test ? "var rec=window.__pbEditorTest={csp:[],errors:[],resourceErrors:[],loadedAt:performance.now()};" : "var rec=null;"}
document.addEventListener("securitypolicyviolation",function(e){var v={directive:e.violatedDirective,blocked:String(e.blockedURI),source:String(e.sourceFile||""),line:e.lineNumber};if(rec)rec.csp.push(v);api.postMessage({protoboard:"csp",directive:v.directive,blocked:v.blocked,source:v.source,line:v.line});});
${test ? `window.addEventListener("error",function(e){if(e.target&&e.target!==window){rec.resourceErrors.push(String(e.target.src||e.target.href||e.target.tagName));return;}rec.errors.push(String(e.error&&e.error.stack||e.message||"error"));},true);
window.addEventListener("unhandledrejection",function(e){rec.errors.push("unhandled rejection: "+String(e.reason&&e.reason.stack||e.reason));});` : ""}})();`;

export interface EditorPage {
  cspSource: string;
  nonce: string;
  /** Webview URIs of the bundle's script and stylesheet. */
  script: string;
  style?: string;
  title: string;
  /** A test run: the page keeps what the prelude records, and its body says so (`data-protoboard-editor-test`). */
  test?: boolean;
}

/** The editor's page: its stylesheet, an empty `#root`, and its script as a module. */
export function editorHtml(p: EditorPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(editorCsp(p.cspSource, p.nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<script nonce="${escapeHtml(p.nonce)}">${prelude(!!p.test)}</script>
${p.style ? `<link rel="stylesheet" href="${escapeHtml(p.style)}">\n` : ""}</head>
<body${p.test ? ' data-protoboard-editor-test="1"' : ""}>
<div id="root"></div>
<script type="module" nonce="${escapeHtml(p.nonce)}" src="${escapeHtml(p.script)}"></script>
</body>
</html>`;
}

const FALLBACK_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;line-height:1.45;padding:36px 48px 48px}
main{max-width:760px}
h1{margin:0 0 6px;font-size:20px;font-weight:600}
p{margin:0 0 14px}
.muted{color:var(--vscode-descriptionForeground)}
code{font-family:var(--vscode-editor-font-family);font-size:.95em}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
.btn{display:inline-flex;align-items:center;min-height:26px;padding:3px 14px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);text-decoration:none}
.btn:hover{background:var(--vscode-button-hoverBackground)}
.btn.second{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}`;

export interface FallbackAction {
  label: string;
  command: string;
  args?: unknown[];
}

/** Why no editor opens the file, and what to do: the commands as links (the page runs no script). */
export interface Fallback {
  title: string;
  lead: string;
  detail?: string;
  actions: FallbackAction[];
}

/** The commands a fallback page may call (`enableCommandUris`). */
export const FALLBACK_COMMANDS = [REOPEN_AS_TEXT, "protoboard.trustProject", "workbench.trust.manage"] as const;

export function fallbackHtml(nonce: string, f: Fallback): string {
  const link = (a: FallbackAction, i: number) =>
    `<a class="btn${i ? " second" : ""}" href="command:${escapeHtml(a.command)}${a.args ? `?${escapeHtml(encodeURIComponent(JSON.stringify(a.args)))}` : ""}">${escapeHtml(a.label)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(["default-src 'none'", `style-src 'nonce-${nonce}'`, "base-uri 'none'", "form-action 'none'"].join("; "))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(f.title)}</title>
<style nonce="${escapeHtml(nonce)}">${FALLBACK_CSS}</style>
</head>
<body>
<main><h1>${escapeHtml(f.title)}</h1><p>${escapeHtml(f.lead)}</p>${f.detail ? `<p class="muted">${escapeHtml(f.detail)}</p>` : ""}<div class="actions">${f.actions.map(link).join("")}</div></main>
</body>
</html>`;
}

/**
 * The fallback pages, by why the file cannot open in an extension's editor.
 * `uri` is the tab's file (the Open as Text link's argument).
 */
export const fallbacks = {
  restricted: (uri: string): Fallback => ({
    title: "Protoboard is off in Restricted Mode",
    lead: "This file opens in an editor that a Protoboard extension provides, which runs the extension's code. Protoboard runs nothing until you trust this folder.",
    actions: [
      { label: "Open as Text", command: REOPEN_AS_TEXT, args: [uri] },
      { label: "Trust This Folder", command: "workbench.trust.manage" },
    ],
  }),
  untrusted: (uri: string, project: string, root: string): Fallback => ({
    title: `${project}'s code is not run`,
    lead: "This file opens in an editor that one of the project's extensions provides, which runs the project's code. It was not trusted.",
    actions: [
      { label: "Open as Text", command: REOPEN_AS_TEXT, args: [uri] },
      { label: "Trust This Project's Code…", command: "protoboard.trustProject", args: [root] },
    ],
  }),
  unclaimed: (uri: string, project: string, name: string, enabled: string[]): Fallback => ({
    title: `No editor for ${name}`,
    lead: `No enabled extension of ${project} opens this file.`,
    detail: enabled.length
      ? `Its enabled extensions with editors: ${enabled.join(", ")}. An extension opens a file when its manifest's contributes.editors claims it and protoboard.config.ts lists the extension.`
      : "None of its enabled extensions contributes an editor. An extension opens a file when its manifest's contributes.editors claims it and protoboard.config.ts lists the extension.",
    actions: [{ label: "Open as Text", command: REOPEN_AS_TEXT, args: [uri] }],
  }),
  notBuilt: (uri: string, extension: string, missing: string[]): Fallback => ({
    title: `${extension}'s editor is not built`,
    lead: `Its page is missing: ${missing.join(", ")}.`,
    detail: "Build the extension's editor (its README says how), then reopen the file.",
    actions: [{ label: "Open as Text", command: REOPEN_AS_TEXT, args: [uri] }],
  }),
  failed: (uri: string, why: string): Fallback => ({
    title: "The editor could not open",
    lead: why,
    detail: "Protoboard: Show Log has the details.",
    actions: [{ label: "Open as Text", command: REOPEN_AS_TEXT, args: [uri] }],
  }),
};

/**
 * The absolute path of a path a webview or a host gave (project-relative
 * with forward slashes, or absolute): inside the project, or with
 * `packageRoot` inside the extension's package too. Throws otherwise.
 */
/** Whether `file` is inside `dir` (not `dir` itself). */
export function isInsideDir(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file));
  return !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function guardedPath(root: string, given: unknown, packageRoot?: string): string {
  if (typeof given !== "string" || !given.trim()) throw new Error("no path given");
  const abs = isAbsolute(given) ? resolve(given) : resolve(root, given);
  if (isInsideDir(root, abs) || (packageRoot && isInsideDir(packageRoot, abs))) return abs;
  throw new Error(`${given} is outside the project`);
}

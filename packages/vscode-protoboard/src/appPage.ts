/**
 * The page of the extension's React webviews (PB-912): the Library sidebar,
 * the full-page library, a part's detail, the libraries manager, the Project
 * Parts side bar and page, the Cloud view, the BOM editor, the Inspector's selection and the DRC panel are one
 * bundle (dist/views-app.js and .css, built
 * from webview/views-app with @protoboardai/views), told which screen to draw
 * by `data-screen`. Everything loads from the extension: the CSP allows its
 * own script by nonce, its stylesheet, images and models from the extension
 * and the library cache, and nothing from the network.
 */
import { escapeHtml } from "./html.js";

export type AppScreen = "library" | "library-page" | "part" | "libraries" | "project-parts" | "project-parts-page" | "cloud" | "bom" | "inspector" | "drc" | "settings";

export interface AppPage {
  screen: AppScreen;
  title: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** dist/views-app.js and dist/views-app.css as the webview reaches them (`asWebviewUri`). */
  script: string;
  style: string;
  nonce: string;
  /** A Library screen written while the library needs a sign-in (PB-928): it draws its sign-in card at once, before any message arrives. */
  signedOut?: { reason?: string; message?: string };
}

export function appCsp(p: Pick<AppPage, "cspSource" | "nonce">): string {
  return [
    "default-src 'none'",
    `img-src ${p.cspSource} data: blob:`,
    `font-src ${p.cspSource} data:`,
    // React sets style attributes; Radix's scroll area adds a style element
    `style-src ${p.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${p.nonce}'`,
    // the part detail's model preview fetches the GLB from the cache
    `connect-src ${p.cspSource} blob: data:`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function appHtml(p: AppPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(appCsp(p))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<link rel="stylesheet" href="${escapeHtml(p.style)}">
</head>
<body data-screen="${escapeHtml(p.screen)}" data-theme="vscode"${p.signedOut ? ` data-signed-out="${escapeHtml(p.signedOut.reason ?? "signed-out")}" data-signed-out-message="${escapeHtml(p.signedOut.message ?? "")}"` : ""}>
<div id="root"></div>
<script type="module" nonce="${escapeHtml(p.nonce)}" src="${escapeHtml(p.script)}"></script>
</body>
</html>`;
}

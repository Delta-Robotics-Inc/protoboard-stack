/**
 * The CAD viewer's files and page (PB-906), without the VS Code API: which
 * files it opens, what it draws for each, and its webview's HTML.
 */
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

export const CAD_VIEWER = "protoboard.cadViewer";

/** File extensions the CAD viewer opens. */
export const CAD_EXTENSIONS = ["step", "stp", "glb"] as const;

export const isCadFile = (file: string) => (CAD_EXTENSIONS as readonly string[]).includes(extname(file).slice(1).toLowerCase());

/** What the viewer draws for a file: the GLB itself, a GLB the build wrote beside a STEP, or the STEP converted. */
export interface CadSource {
  kind: "glb" | "step";
  /** The file drawn. */
  file: string;
  /** For a STEP drawn from its GLB: that GLB. */
  via?: string;
}

/** The GLB written with a STEP (same name, same folder), when it is as new (within the minute one export takes). */
export function cadSource(file: string, exists: (p: string) => boolean = existsSync, mtime: (p: string) => number = (p) => statSync(p).mtimeMs): CadSource {
  const ext = extname(file).toLowerCase();
  if (ext === ".glb") return { kind: "glb", file };
  const glb = join(dirname(file), `${basename(file, extname(file))}.glb`);
  // one export writes both, in either order: a GLB within a minute of the STEP is the same model
  if (exists(glb) && mtime(glb) >= mtime(file) - 60_000) return { kind: "glb", file, via: glb };
  return { kind: "step", file };
}

/** The open CAD tabs, for the integration test. */
export interface CadTabState {
  file: string;
  source: CadSource;
  /** What the webview said last: `page` (it runs), `ready` (the model is drawn), `error`. */
  state?: string;
  message?: string;
}


export function cadViewerHtml(o: { script: string; style: string; occt: string; wasm: string; model: string; source: CadSource; name: string; cspSource: string; nonce: string }): string {
  const config = { model: o.model, kind: o.source.kind, name: o.name, via: o.source.via ? basename(o.source.via) : undefined, occt: o.occt, wasm: o.wasm };
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${o.cspSource} data: blob:; style-src ${o.cspSource} 'unsafe-inline'; font-src ${o.cspSource} data:; script-src 'nonce-${o.nonce}' 'wasm-unsafe-eval'; connect-src ${o.cspSource} blob: data:; worker-src blob:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${o.style}">
<style>html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; background: var(--vscode-editor-background); }</style>
<title>${o.name.replace(/[<&]/g, "")}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${o.nonce}">window.pbCad = ${json};</script>
<script nonce="${o.nonce}" src="${o.script}"></script>
</body>
</html>`;
}

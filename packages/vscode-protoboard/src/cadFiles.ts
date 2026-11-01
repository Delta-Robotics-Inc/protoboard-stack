/**
 * The CAD viewer's files and page (PB-906), without the VS Code API: which
 * files it opens, what it draws for each, and its webview's HTML.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

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

/**
 * The GLB written with a STEP (same name, same folder), when it is as new (within the minute one export takes);
 * else the GLB the build's model table resolved for the same part (`resolvedGlb`), when the table is newer than
 * the STEP; else the STEP itself, converted.
 */
export function cadSource(
  file: string,
  exists: (p: string) => boolean = existsSync,
  mtime: (p: string) => number = (p) => statSync(p).mtimeMs,
  resolved: (step: string) => string | undefined = (step) => resolvedGlb(step, exists, mtime),
): CadSource {
  const ext = extname(file).toLowerCase();
  if (ext === ".glb") return { kind: "glb", file };
  const glb = join(dirname(file), `${basename(file, extname(file))}.glb`);
  // one export writes both, in either order: a GLB within a minute of the STEP is the same model
  if (exists(glb) && mtime(glb) >= mtime(file) - 60_000) return { kind: "glb", file, via: glb };
  const other = resolved(file);
  if (other) return { kind: "glb", file, via: other };
  return { kind: "step", file };
}

/** The build's model table is read only up to this size (security basics: size caps on parsed files). */
const MAX_RESOLVED_BYTES = 64 * 1024 * 1024;

/**
 * The GLB the stack's resolver chose for the part whose STEP `step` is (PB-1174): the project's
 * `.protoboard/build/resolved.json` (`models.instances[]`, schema protoboard.models/v0) lists, per drawn
 * instance, the GLB the 3D view draws and the STEP of the same part. The extension reads the table rather than
 * running the resolver: it is the build's record, and the CAD tab must not load a project to open a file.
 * Only a table written after the STEP counts, and only a GLB inside the project that exists.
 */
export function resolvedGlb(step: string, exists: (p: string) => boolean = existsSync, mtime: (p: string) => number = (p) => statSync(p).mtimeMs, read: (p: string) => string = (p) => readFileSync(p, "utf8")): string | undefined {
  const same = (a: string, b: string) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
  for (let dir = dirname(resolve(step)), i = 0; i < 32; i++) {
    const table = join(dir, ".protoboard", "build", "resolved.json");
    if (exists(table)) {
      try {
        if (statSync(table).size > MAX_RESOLVED_BYTES || mtime(table) < mtime(step)) return undefined;
        const rows = (JSON.parse(read(table)) as { models?: { instances?: { file?: string; format?: string; step?: { file?: string } }[] } }).models?.instances ?? [];
        for (const r of rows) {
          if (!r.step?.file || !r.file || r.format !== "glb" || /^(package|cache):/.test(r.file)) continue;
          if (!same(join(dir, r.step.file), step)) continue;
          const glb = resolve(dir, r.file);
          const inside = relative(dir, glb);
          if (!inside.startsWith("..") && !isAbsolute(inside) && exists(glb)) return glb;
        }
      } catch {
        // an unreadable table resolves nothing: the STEP is converted
      }
      return undefined;
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
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

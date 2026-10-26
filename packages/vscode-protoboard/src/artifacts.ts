/**
 * `protoboard artifacts --format json` (or the last build's artifacts) → what
 * to offer in "Open Artifact" and how to open each one. No VS Code API here.
 */
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { ProjectIndex } from "./model.js";

/** One artifact as the CLI prints it. */
export interface ArtifactEntry {
  definition: string;
  name?: string;
  id: string;
  role?: string;
  format?: string;
  filePath?: string;
  url?: string;
  /** Absolute file. */
  resolved?: string;
  present: boolean | "remote" | "provenance";
  instances: string[];
}

/** A part that has something to open: one definition with the instances using it. */
export interface PartChoice {
  definition: string;
  label: string;
  instances: string[];
  artifacts: ArtifactEntry[];
}

/**
 * - `editor`: a file VS Code shows itself (source, text, data, images);
 * - `external`: not a text file: STEP and GLB go to the CAD viewer (cadEditor.ts), PDF,
 *   other CAD and fabrication files to the system's default application;
 * - `url`: a web page or remote file, in the browser;
 * - `none`: nothing to open (a missing file, a reference without a file or URL).
 */
export type OpenMode = "editor" | "external" | "url" | "none";

/** Extensions VS Code opens in an editor without help. Everything else goes to the system. */
const EDITOR = new Set([
  "ts", "tsx", "js", "mjs", "cjs", "py", "kcl", "json", "jsonc", "md", "txt", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "css",
  "c", "h", "cpp", "hpp", "ino", "rs", "go", "sh", "ini", "cfg", "conf", "log", "svg",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico",
]);

export function openMode(a: ArtifactEntry): OpenMode {
  if (a.present === true && a.resolved) {
    const ext = (extname(a.resolved).slice(1) || a.format || "").toLowerCase();
    return EDITOR.has(ext) ? "editor" : "external";
  }
  if (a.url && /^https?:\/\//i.test(a.url)) return "url";
  return "none";
}

/**
 * File types the system's own application may open (PB-1048): documents,
 * images, CAD, KiCad files, a Gerber archive, tables and notes. A part or a
 * project is data from someone else, and the system opener runs whatever is
 * registered for a type (a script, an installer, a shortcut, a page that runs
 * script in the browser), so any other file is shown in the file manager
 * instead. An SVG is shown in VS Code's image preview (as an image, so its
 * script never runs), not in the system's browser.
 */
export const SYSTEM_OPENS: ReadonlySet<string> = new Set([
  "pdf", "png", "jpg", "jpeg",
  "step", "stp", "stl", "glb",
  "kicad_pcb", "kicad_sch", "kicad_pro", "kicad_prl", "kicad_sym", "kicad_mod", "kicad_dru", "kicad_wks",
  "zip", "csv", "md",
]);

/** How a local file is opened outside a text editor: the system's application, VS Code's image preview, or shown in the file manager. */
export type OutsideOpen = "system" | "image-preview" | "reveal";

export function outsideOpen(file: string): OutsideOpen {
  const ext = extname(file).slice(1).toLowerCase();
  if (ext === "svg") return "image-preview";
  return SYSTEM_OPENS.has(ext) ? "system" : "reveal";
}

/** Parts with at least one artifact to open, named and ordered for a picker. */
export function partChoices(entries: ArtifactEntry[]): PartChoice[] {
  const byDef = new Map<string, PartChoice>();
  for (const a of entries) {
    if (openMode(a) === "none") continue;
    const c = byDef.get(a.definition) ?? { definition: a.definition, label: a.name ?? a.definition, instances: a.instances, artifacts: [] };
    c.artifacts.push(a);
    byDef.set(a.definition, c);
  }
  return [...byDef.values()].sort((x, y) => x.label.localeCompare(y.label));
}

/** Files before links, then CAD (STEP, GLB) before the rest, so the usual target is near the top. */
export function sortArtifacts(list: ArtifactEntry[]): ArtifactEntry[] {
  const rank = (a: ArtifactEntry) => {
    const mode = openMode(a);
    const ext = (a.resolved ? extname(a.resolved).slice(1) : a.format ?? "").toLowerCase();
    const cad = ["step", "stp", "glb", "gltf", "stl", "3mf", "dxf"].includes(ext) ? 0 : ext === "pdf" ? 1 : 2;
    return (mode === "url" ? 10 : 0) + cad;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** One line describing an artifact in a picker: its format and role. */
export function describeArtifact(a: ArtifactEntry): string {
  const ext = a.resolved ? extname(a.resolved).slice(1).toUpperCase() : "";
  return [a.format ? a.format.toUpperCase() : ext, a.role].filter(Boolean).join(" · ") || (openMode(a) === "url" ? "link" : "file");
}

/** Instance paths, shortened when a part is used many times. */
export function describeInstances(instances: string[], max = 4): string {
  if (!instances.length) return "";
  return instances.length <= max ? instances.join(", ") : `${instances.slice(0, max).join(", ")} +${instances.length - max}`;
}

/**
 * A build's artifact path as a file: project-relative paths against the
 * project, `package:<name>/<path>` in that package as Node finds it from the
 * project (the nearest `node_modules` up).
 */
export function buildArtifactFile(root: string, resolvedPath: string, exists: (p: string) => boolean = existsSync): string | undefined {
  const m = /^package:((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(resolvedPath);
  if (!m) return isAbsolute(resolvedPath) ? resolvedPath : resolve(root, resolvedPath);
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const file = join(dir, "node_modules", m[1], m[2]);
    if (exists(file)) return file;
    if (dirname(dir) === dir) return undefined;
  }
}

/** A definition's artifacts from the last build, as "Open Artifact" offers them. */
export function buildArtifacts(root: string, index: ProjectIndex, defId: string, exists: (p: string) => boolean = existsSync): PartChoice | undefined {
  const def = index.defs.get(defId);
  const instances = (index.usedBy.get(defId) ?? []).map((i) => i.path);
  const artifacts: ArtifactEntry[] = (index.artifacts.get(defId) ?? []).map((a) => {
    const file = a.resolved ? buildArtifactFile(root, a.resolved, exists) : undefined;
    return {
      definition: a.definition,
      name: def?.name,
      id: a.id,
      role: a.role,
      format: a.format,
      filePath: a.filePath,
      url: a.url,
      resolved: file,
      present: a.present === true && !file ? false : a.present,
      instances,
    };
  });
  return partChoices(artifacts)[0];
}

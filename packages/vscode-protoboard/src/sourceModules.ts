/**
 * The modules a `.uhd.ts` file defines, as the last build knows them (PB-931):
 * where each definition is written, and the instance to show it as in the
 * viewer. For the editor's "Open in Protoboard Viewer" (the title button, the
 * context menu, the lens above a definition). No VS Code API here.
 */
import type { ProjectIndex } from "./model.js";
import { idLine } from "./source.js";

export interface SourceModule {
  defId: string;
  name: string;
  /** 1-based line of the definition in the file. */
  line: number;
  /** The instance to open: the first that uses the definition ("" is the root system). Absent: nothing in the system uses it yet. */
  path?: string;
  /** How many instances use it. */
  uses: number;
  /** It has modules of its own: the viewer opens on its level. Otherwise it is shown on its parent's, selected. */
  hasChildren: boolean;
}

/**
 * The definitions written in `file` (project-relative, forward slashes), top
 * to bottom. With the file's `text`, a definition's line is where its id is
 * written now when the recorded line no longer names it (the file was edited
 * since the build), so a lens stays on its definition.
 */
export function modulesInFile(index: ProjectIndex, file: string, text?: string): SourceModule[] {
  const lines = text?.split(/\r?\n/);
  const out: SourceModule[] = [];
  for (const d of index.defs.values()) {
    // a library part vendored with its source is written in that `.uhd.ts`, not in the pinned JSON beside it
    // a build made by an earlier CLI on Windows recorded the file with backslashes
    const src = [d.origin.definitionSource, d.origin.source].find((x) => x?.file.replace(/\\/g, "/") === file);
    if (!src) continue;
    let line = src.line;
    if (lines) {
      // the recorded line names the definition (or the lines just below it do: `module({` then `id:`)
      const near = line !== undefined && lines.slice(Math.max(0, line - 1), line + 6).some((l) => l.includes(d.id));
      if (!near) line = idLine(text!, d.id) ?? line;
    }
    if (line === undefined) continue;
    // the build records where the id is written; the definition starts at the declaration just above it
    if (lines) line = declarationLine(lines, line);
    const uses = index.usedBy.get(d.id) ?? [];
    const first = uses.map((u) => u.path).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
    out.push({
      defId: d.id,
      name: d.name ?? index.bundleDefs.get(d.id)?.name ?? d.id,
      line: Math.min(line, lines?.length ?? line),
      ...(first !== undefined ? { path: first } : {}),
      uses: uses.length,
      hasChildren: (index.bundleDefs.get(d.id)?.children?.length ?? 0) > 0 && d.kind !== "harness",
    });
  }
  return out.sort((a, b) => a.line - b.line || a.defId.localeCompare(b.defId));
}

/** The line a definition starts on: the `const X = {` (or `export default`) within two lines above its id, else the id's own. 1-based. */
export function declarationLine(lines: string[], idLine: number): number {
  for (let l = idLine; l >= Math.max(1, idLine - 2); l--) {
    if (/\b(const|let|var)\s+[\w$]+[^=]*=|\bexport\s+default\b/.test(lines[l - 1] ?? "")) return l;
  }
  return idLine;
}

/**
 * The module a line of the file is in: the definition written closest above
 * it, else the file's first. `prefer` (the instance selected now) decides
 * which instance of a definition used several times.
 */
export function moduleAtLine(index: ProjectIndex, modules: SourceModule[], line: number, prefer?: string): SourceModule | undefined {
  const at = [...modules].reverse().find((m) => m.line <= line) ?? modules[0];
  if (!at || prefer === undefined) return at;
  const same = (index.usedBy.get(at.defId) ?? []).find((u) => u.path === prefer || prefer.startsWith(`${u.path}/`));
  return same ? { ...at, path: same.path } : at;
}

/** What a lens above a definition says. */
export function lensTitle(m: SourceModule): string {
  // a codicon every VS Code has: an extension's own icon font is not certain to be drawn in a lens
  if (m.path === undefined) return "$(circle-slash) Not in the system yet";
  return `$(open-preview) Open in Viewer${m.uses > 1 ? ` (${m.uses} uses)` : ""}`;
}

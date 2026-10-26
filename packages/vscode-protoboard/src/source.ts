/**
 * Where a module is written: a definition at its source line, an instance at
 * its declaration in the parent system, and the reverse, the module a cursor
 * in a `.uhd.ts` file is in. No VS Code API here.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ProjectIndex, SourceLocation } from "./model.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `id: "x"`, `"id": "x"`, `id: 'x'` or `` id: `x` `` on a line. */
const idPattern = (id: string) => new RegExp(`["']?\\bid["']?\\s*:\\s*["'\`]${escapeRe(id)}["'\`]`);

/** The 1-based line declaring a child `id`, searching from a definition's line down. */
export function childDeclarationLine(text: string, childId: string, fromLine = 1): number | undefined {
  const lines = text.split(/\r?\n/);
  const re = idPattern(childId);
  for (let i = Math.max(0, fromLine - 1); i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return undefined;
}

/**
 * The 1-based line declaring a link or interface `id`: an `id: "x"` entry,
 * else the first line from the definition down that quotes it (a link
 * helper such as `link("battery_plug", …)`).
 */
export function idLine(text: string, id: string, fromLine = 1): number | undefined {
  const declared = childDeclarationLine(text, id, fromLine);
  if (declared) return declared;
  const lines = text.split(/\r?\n/);
  const quoted = new RegExp(`["'\`]${escapeRe(id)}["'\`]`);
  for (let i = Math.max(0, fromLine - 1); i < lines.length; i++) if (quoted.test(lines[i])) return i + 1;
  return undefined;
}

/**
 * A definition's source, as the build records it (project-relative file, 1-based line when known). A
 * catalog part vendored with its `.uhd.ts` (PB-910) opens at that readable source, not the pinned JSON;
 * with `readText`, a file without a line opens at the line that names the definition's id.
 */
export function definitionSource(index: ProjectIndex, defId: string, readText?: (file: string) => string | undefined): SourceLocation | undefined {
  const origin = index.defs.get(defId)?.origin;
  if (!origin) return undefined;
  const src = origin.definitionSource ?? origin.source;
  if (src.line !== undefined || !readText) return src;
  const text = readText(src.file);
  const line = text ? idLine(text, defId) : undefined;
  return line ? { ...src, line } : src;
}

/**
 * Where an instance is declared: the child entry in its parent's definition
 * (found from the parent's source line down), else the instance's own
 * definition. The root system is its definition.
 */
export function instanceSource(index: ProjectIndex, path: string, readText: (file: string) => string | undefined): SourceLocation | undefined {
  const inst = index.instances.get(path);
  if (!inst) return undefined;
  if (path === "" || inst.parent === undefined) return definitionSource(index, inst.definition, readText);
  const parent = index.instances.get(inst.parent);
  const src = parent && definitionSource(index, parent.definition, readText);
  const childId = path.split("/").pop()!;
  const text = src && readText(src.file);
  const line = text ? childDeclarationLine(text, childId, src.line ?? 1) : undefined;
  return line && src ? { file: src.file, line } : definitionSource(index, inst.definition, readText);
}

/**
 * The file a module is written in, for a viewer tab on it (its header's
 * path, Reveal in Explorer, Copy Path): the definition of the instance at
 * `path` ("" is the root system), at its line. A part written inside
 * another module's file (a block with no file of its own) is that file, at
 * the part's line.
 */
export function moduleSource(index: ProjectIndex, path: string, readText?: (file: string) => string | undefined): SourceLocation | undefined {
  const inst = index.instances.get(path);
  return inst ? definitionSource(index, inst.definition, readText) : undefined;
}

/** A file as the build names it (project-relative, forward slashes). */
export function projectRelative(root: string, file: string): string | undefined {
  const rel = relative(root, resolve(file));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

/**
 * The instance a cursor is in: the definition written closest above the
 * cursor in that file, and when the cursor's line declares one of its
 * children, that child. `prefer` (the instance selected now) wins when it is
 * of the same definition, so a module used several times stays where it is.
 */
export function instanceAtCursor(index: ProjectIndex, file: string, line: number, lineText: string, prefer?: string): string | undefined {
  let best: { id: string; line: number } | undefined;
  for (const d of index.defs.values()) {
    const s = d.origin.source;
    if (s.file !== file || s.line === undefined || s.line > line) continue;
    if (!best || s.line > best.line) best = { id: d.id, line: s.line };
  }
  if (!best) return undefined;
  const uses = index.usedBy.get(best.id) ?? [];
  if (!uses.length) return undefined;
  const preferred = prefer !== undefined ? uses.find((u) => u.path === prefer || prefer.startsWith(`${u.path}/`)) : undefined;
  const at = (preferred ?? uses[0]).path;
  const child = index.bundleDefs.get(best.id)?.children?.find((c) => idPattern(c.id).test(lineText));
  if (child) {
    const childPath = at === "" ? child.id : `${at}/${child.id}`;
    if (index.instances.has(childPath)) return childPath;
  }
  return at;
}

/**
 * Where the viewer's modules are written down, for its `openSource` event
 * (docs/specs/vscode-extension.md §3): each build of `protoboard dev` writes
 * an index of definition sources and instance declarations next to the
 * bundle, and the server answers `/__protoboard/source` from it, so a host
 * (the VS Code extension) can open the file at the line.
 *
 * - A definition: the file that declares it (a `.uhd.ts` source, or the
 *   vendored catalog JSON), at the line of its id.
 * - An instance: the child entry in its parent's definition, at the line of
 *   the child's id (searched from the parent's own line, so another module
 *   in the same file with a child of that name does not match first; then
 *   from the top, for children built from data above the definition).
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Project } from "@protoboardai/core";

export const SOURCES_SCHEMA = "protoboard.dev-sources/v0";
/** The index's file name, next to the bundle. */
export const SOURCES_FILE = "sources.json";

/** A place in a project file (project-relative). */
export interface SourcePlace {
  file: string;
  line?: number;
}

export interface SourceIndex {
  schema: typeof SOURCES_SCHEMA;
  /** Definition id → where it is declared, and its tier (catalog parts are vendored JSON). */
  definitions: Record<string, SourcePlace & { tier: string }>;
  /** Instance path ("arm_fl/motor") → its definition and where its parent declares it. */
  instances: Record<string, SourcePlace & { definition: string }>;
}

/** A resolved place, with the absolute path a host opens. */
export interface ResolvedPlace extends SourcePlace {
  path: string;
}

export interface ResolvedSource {
  defId: string;
  instancePath?: string;
  /** Where the definition is declared. */
  source?: ResolvedPlace;
  /** Where the instance is declared in its parent's definition. */
  instanceSource?: ResolvedPlace;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The 1-based line of `id: "<value>"` (TypeScript or JSON) in `text`, at or after line `from`. */
export function lineOf(text: string, value: string, from = 1, key = "id"): number | undefined {
  const needle = new RegExp(`(?:\\b${key}|"${key}")\\s*:\\s*["'\`]${escape(value)}["'\`]`);
  const lines = text.split("\n");
  for (let i = Math.max(0, from - 1); i < lines.length; i++) if (needle.test(lines[i])) return i + 1;
  return undefined;
}

/** The index for a loaded project. */
export function sourceIndex(p: Project): SourceIndex {
  const texts = new Map<string, string | undefined>();
  const text = (file: string) => {
    if (!texts.has(file)) {
      const abs = join(p.root, file);
      texts.set(file, existsSync(abs) ? readFileSync(abs, "utf8") : undefined);
    }
    return texts.get(file);
  };
  const definitions: SourceIndex["definitions"] = {};
  for (const [id, rec] of p.definitions) {
    // a catalog part vendored with its .uhd.ts (PB-910) opens at that source, not the pinned JSON
    const { file, line } = rec.origin.definitionSource ?? rec.origin.source;
    // a vendored catalog file carries no line: the line that names its id
    const content = line ? undefined : text(file);
    const at = line ?? (content === undefined ? undefined : lineOf(content, id));
    definitions[id] = { file, ...(at ? { line: at } : {}), tier: rec.origin.tier };
  }
  const instances: SourceIndex["instances"] = {};
  const definitionAt = new Map(p.instances.map((i) => [i.path, i.definition]));
  for (const inst of p.instances) {
    if (!inst.path) continue;
    const slash = inst.path.lastIndexOf("/");
    const parentPath = slash < 0 ? "" : inst.path.slice(0, slash);
    const childId = inst.path.slice(slash + 1);
    const parentDef = definitionAt.get(parentPath);
    const where = parentDef ? definitions[parentDef] : undefined;
    if (!where) continue;
    const content = text(where.file);
    // after the parent's own line first; children built from data (ARMS.map) are named earlier in the file
    const line = content === undefined ? undefined : (lineOf(content, childId, where.line ?? 1) ?? lineOf(content, childId));
    instances[inst.path] = { definition: inst.definition, file: where.file, ...(line ? { line } : {}) };
  }
  return { schema: SOURCES_SCHEMA, definitions, instances };
}

/**
 * Where a definition and an instance are written down. The definition named
 * by `defId` wins over the instance's when both are given; an instance alone
 * also names its definition. Files outside the project are not returned.
 */
export function resolveSource(index: SourceIndex, root: string, request: { defId?: string; instancePath?: string }): ResolvedSource | undefined {
  const instancePath = request.instancePath?.replace(/^\/+|\/+$/g, "") || undefined;
  const inst = instancePath ? index.instances[instancePath] : undefined;
  const defId = request.defId ?? inst?.definition;
  if (!defId) return undefined;
  const place = (p?: SourcePlace): ResolvedPlace | undefined => {
    if (!p) return undefined;
    const path = resolve(root, p.file);
    const rel = relative(resolve(root), path);
    if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
    return { file: p.file, ...(p.line ? { line: p.line } : {}), path };
  };
  const def = index.definitions[defId];
  const source = place(def && { file: def.file, line: def.line });
  const instanceSource = place(inst && { file: inst.file, line: inst.line });
  if (!source && !instanceSource) return undefined;
  return { defId, ...(instancePath ? { instancePath } : {}), ...(source ? { source } : {}), ...(instanceSource ? { instanceSource } : {}) };
}

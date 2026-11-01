/**
 * Loading the reference-tool registry (PB-1191): the built-in entries, then
 * the user's (`<home>/reference-tools/*.json`, home = PROTOBOARD_HOME or
 * ~/.protoboard), then the project's (`parts/reference-tools/*.json`); a
 * later entry with the same id replaces an earlier one (the project wins).
 *
 * DEFAULT (PB-1191; round 2 proposed protoboard.config.ts or
 * ~/.protoboard/tools.json): one JSON file per tool in a folder, so a tool is
 * added or reviewed as one file and no config type changes.
 *
 * Security basics: only `*.json` files directly in those folders, each under
 * MAX_RECORD_BYTES, read as JSON and validated (nothing in them runs); a
 * symlink out of the folder is refused; a model file is read only inside the
 * entry's own folder (the project root for project entries) and only to hash it.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJsonCapped, sha256OfFile } from "../part-files.js";
import { isInsideReal, recordedPath } from "../paths.js";
import { stackHome } from "../stack.js";
import { BUILTIN_REFERENCE_TOOLS } from "./builtin.js";
import type { ReferenceTool } from "./types.js";
import { validateReferenceTool } from "./validate.js";

/** Project folder of reference-tool records. */
export const PROJECT_REFERENCE_TOOLS_DIR = "parts/reference-tools";
/** One record's size cap (bytes). */
export const MAX_REFERENCE_TOOL_BYTES = 256 * 1024;

export interface LoadedReferenceTool {
  tool: ReferenceTool;
  /** The file it came from (absent for built-ins). */
  file?: string;
  origin: "builtin" | "user" | "project";
  /** For tools with a model: whether the file is there and still the pinned bytes. */
  model?: { file: string; status: "ok" | "missing" | "changed"; sha256?: string };
}

export interface ReferenceToolProblem {
  file: string;
  errors: string[];
}

export interface ReferenceToolRegistry {
  tools: Map<string, LoadedReferenceTool>;
  problems: ReferenceToolProblem[];
}

export interface LoadReferenceToolsOptions {
  /** The user's Protoboard folder (default PROTOBOARD_HOME or ~/.protoboard); `false` skips user records. */
  home?: string | false;
  /** Leave out the built-in entries (tests). */
  builtins?: boolean;
}

function readFolder(dir: string, origin: "user" | "project", modelBase: (file: string) => string, out: ReferenceToolRegistry) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const name of readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      if (!isInsideReal(dir, file)) throw new Error("a link out of the folder");
      if (!statSync(file).isFile()) continue;
      const data = readJsonCapped<unknown>(file, MAX_REFERENCE_TOOL_BYTES);
      const errors = validateReferenceTool(data);
      if (errors.length) {
        out.problems.push({ file, errors });
        continue;
      }
      const tool = data as ReferenceTool;
      const entry: LoadedReferenceTool = { tool: { ...tool, source: { ...tool.source, origin } }, file, origin };
      if (tool.model) entry.model = checkModel(modelBase(file), tool.model.path, tool.model.sha256);
      out.tools.set(tool.id, entry);
    } catch (e) {
      out.problems.push({ file, errors: [(e as Error).message] });
    }
  }
}

/** Whether a tool's model file is there and is the pinned bytes. Paths outside `base` are refused. */
export function checkModel(base: string, path: string, sha256: string): NonNullable<LoadedReferenceTool["model"]> {
  const file = resolve(base, recordedPath(path));
  if (!isInsideReal(base, file)) throw new Error(`model.path ${path} leaves ${base}`);
  if (!existsSync(file) || !statSync(file).isFile()) return { file, status: "missing" };
  const now = sha256OfFile(file);
  return now === sha256 ? { file, status: "ok", sha256: now } : { file, status: "changed", sha256: now };
}

/** The registry for a project (or, with no root, the built-ins and the user's). */
export function loadReferenceTools(root?: string, options: LoadReferenceToolsOptions = {}): ReferenceToolRegistry {
  const out: ReferenceToolRegistry = { tools: new Map(), problems: [] };
  if (options.builtins !== false) for (const t of BUILTIN_REFERENCE_TOOLS) out.tools.set(t.id, { tool: t, origin: "builtin" });
  const home = options.home === undefined ? stackHome() : options.home;
  if (home) {
    const dir = join(home, "reference-tools");
    readFolder(dir, "user", () => dir, out);
  }
  if (root) readFolder(join(root, PROJECT_REFERENCE_TOOLS_DIR), "project", () => root, out);
  return out;
}

/** One tool by id, or a clear error naming the ones there are. */
export function referenceTool(registry: ReferenceToolRegistry, id: string): LoadedReferenceTool {
  const t = registry.tools.get(id);
  if (t) return t;
  const bad = registry.problems.find((p) => p.file.replace(/\\/g, "/").endsWith(`/${id}.json`));
  if (bad) throw new Error(`the reference tool ${id} (${bad.file}) is not valid: ${bad.errors.join("; ")}`);
  throw new Error(`no reference tool "${id}" (known: ${[...registry.tools.keys()].join(", ") || "none"}); add parts/reference-tools/${id}.json (docs/reference/reference-tools.md)`);
}

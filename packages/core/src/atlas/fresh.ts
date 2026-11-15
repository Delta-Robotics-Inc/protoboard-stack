/**
 * Reading the Atlas index and telling whether it still describes the project
 * (docs/specs/atlas.md, "Freshness"). Read-only: nothing here writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAMEWORK_VERSION } from "../extensions.js";
import { sha256 } from "../load.js";
import { byCodeUnit, ATLAS_FILE, ATLAS_SCHEMA, type AtlasIndex } from "./model.js";
import { enumerateProject, nodeAtlasFs, statEntry, type AtlasFs, type AtlasGitRunner } from "./build.js";

export type AtlasRead = { index: AtlasIndex; digest: string } | { error: "INDEX_MISSING" | "INDEX_INVALID" | "INDEX_SCHEMA"; message: string };

/** The index at `file` (default `<root>/.protoboard/build/atlas.json`) and the sha256 of its bytes, or why it cannot be used. */
export function readAtlasIndex(root: string, file?: string): AtlasRead {
  const path = file ?? join(root, ATLAS_FILE);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { error: "INDEX_MISSING", message: `no project index at ${ATLAS_FILE}; run \`protoboard build\`` };
    return { error: "INDEX_INVALID", message: `the project index cannot be read: ${(e as Error).message}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { error: "INDEX_INVALID", message: `the project index is not valid JSON (${(e as Error).message}); run \`protoboard build\`` };
  }
  const index = data as Partial<AtlasIndex> | null;
  if (!index || typeof index !== "object" || Array.isArray(index)) return { error: "INDEX_INVALID", message: "the project index is not an object; run `protoboard build`" };
  if (index.schema !== ATLAS_SCHEMA) return { error: "INDEX_SCHEMA", message: `the project index has schema ${JSON.stringify(index.schema ?? null)}, not ${ATLAS_SCHEMA}; run \`protoboard build\`` };
  const shaped =
    typeof index.stack === "string" &&
    (index.enumerator === "git" || index.enumerator === "walk") &&
    !!index.project &&
    !!index.counts &&
    Array.isArray(index.nodes) &&
    Array.isArray(index.edges) &&
    Array.isArray(index.census) &&
    Array.isArray(index.inputs) &&
    Array.isArray(index.problems) &&
    !!index.instances &&
    typeof index.instances === "object";
  if (!shaped) return { error: "INDEX_INVALID", message: "the project index is missing fields; run `protoboard build`" };
  return { index: index as AtlasIndex, digest: sha256(bytes) };
}

export interface AtlasFreshness {
  fresh: boolean;
  /** stack: another stack version; history: built before creation times were recorded; enumerator: git appeared or went; files: a file was added, removed or changed. */
  reason?: "stack" | "history" | "enumerator" | "files";
  /** Up to 20 paths each. */
  added: string[];
  removed: string[];
  changed: string[];
  /** Files compared. */
  checked: number;
}

/** How many paths each list of a freshness result names. */
const LIST_CAP = 20;
/** Bytes re-hashed at most before a file whose size or mtime moved is taken as changed. */
const HASH_BUDGET = 64 * 1024 * 1024;

/**
 * Whether `index` still describes the project at `root`. A different stack
 * version is stale ("stack"); so is an index built before creation times
 * were recorded, with no `counts.created` ("history"), and a different
 * enumerator (git present or absent). Then every file is compared: size and
 * mtime equal, it is unchanged; otherwise it is re-hashed (within the budget,
 * default 64 MB; past it, the file counts as changed). A file only touched
 * (same bytes) stays fresh. Creation times are history, not content: a commit
 * that only records history (no file's bytes change) leaves the index fresh.
 */
export async function atlasFreshness(
  root: string,
  index: AtlasIndex,
  options: { fs?: AtlasFs; hashBudgetBytes?: number; git?: AtlasGitRunner; stack?: string } = {},
): Promise<AtlasFreshness> {
  const stale = (reason: AtlasFreshness["reason"]): AtlasFreshness => ({ fresh: false, reason, added: [], removed: [], changed: [], checked: 0 });
  if (index.stack !== (options.stack ?? FRAMEWORK_VERSION)) return stale("stack");
  if (!index.counts?.created) return stale("history");
  const fs = options.fs ?? nodeAtlasFs;
  const now = await enumerateProject(root, { fs, ...(options.git ? { git: options.git } : {}) });
  if (now.enumerator !== index.enumerator) return stale("enumerator");

  let rootReal = root;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    // keep the path as given
  }
  const before = new Map(index.inputs.map((i) => [i[0], i]));
  const current = new Set(now.files);
  const added = now.files.filter((f) => !before.has(f));
  const removed = [...before.keys()].filter((f) => !current.has(f)).sort(byCodeUnit);
  const changed: string[] = [];
  let budget = options.hashBudgetBytes ?? HASH_BUDGET;
  let checked = 0;
  for (const rel of now.files) {
    const input = before.get(rel);
    if (!input) continue;
    checked++;
    const [, size, mtimeMs, hash] = input;
    const st = await statEntry(fs, root, rootReal, rel);
    if (st.state === "gone" || st.state === "not-file") {
      removed.push(rel);
      continue;
    }
    if (st.size === size && st.mtimeMs === mtimeMs) continue;
    // moved: the same bytes are still fresh (a touched file), when the bytes can be read within the budget
    if (st.state !== "file" || hash === null || st.size !== size || st.size > budget) {
      changed.push(rel);
      continue;
    }
    budget -= st.size;
    try {
      if ((await fs.hashFile(join(root, rel))) !== hash) changed.push(rel);
    } catch {
      changed.push(rel);
    }
  }
  removed.sort(byCodeUnit);
  const fresh = !added.length && !removed.length && !changed.length;
  return {
    fresh,
    ...(fresh ? {} : { reason: "files" as const }),
    added: added.slice(0, LIST_CAP),
    removed: removed.slice(0, LIST_CAP),
    changed: changed.slice(0, LIST_CAP),
    checked,
  };
}

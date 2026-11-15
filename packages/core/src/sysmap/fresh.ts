/**
 * Reading a System Map and telling whether it still describes the stack
 * (docs/specs/system-map.md, "Freshness"). Read-only: nothing here writes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FRAMEWORK_VERSION } from "../extensions.js";
import { byCodeUnit, SYSMAP_SCHEMA, type SystemMap } from "./model.js";
import { collectStack, nodeSysmapFs, type SysmapFs } from "./build.js";
import { historyFingerprint, runGit, type SysmapGitRunner } from "./history.js";

export type SysmapRead = { map: SystemMap; digest: string } | { error: "MAP_MISSING" | "MAP_INVALID" | "MAP_SCHEMA"; message: string };

/** The map at `file` and the sha256 of its bytes, or why it cannot be used. */
export function readSystemMap(file: string): SysmapRead {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { error: "MAP_MISSING", message: `no System Map at ${file}` };
    return { error: "MAP_INVALID", message: `the System Map cannot be read: ${(e as Error).message}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { error: "MAP_INVALID", message: `the System Map is not valid JSON (${(e as Error).message})` };
  }
  const map = data as Partial<SystemMap> | null;
  if (!map || typeof map !== "object" || Array.isArray(map)) return { error: "MAP_INVALID", message: "the System Map is not an object" };
  if (map.schema !== SYSMAP_SCHEMA) return { error: "MAP_SCHEMA", message: `the System Map has schema ${JSON.stringify(map.schema ?? null)}, not ${SYSMAP_SCHEMA}` };
  const shaped =
    typeof map.stack === "string" &&
    (map.layout === "monorepo" || map.layout === "installed") &&
    !!map.counts &&
    Array.isArray(map.items) &&
    Array.isArray(map.links) &&
    Array.isArray(map.islands) &&
    Array.isArray(map.stages) &&
    Array.isArray(map.releases) &&
    Array.isArray(map.inputs) &&
    Array.isArray(map.problems) &&
    (map.history === null || (typeof map.history === "object" && Array.isArray(map.history?.tags)));
  if (!shaped) return { error: "MAP_INVALID", message: "the System Map is missing fields" };
  return { map: map as SystemMap, digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
}

export interface SysmapFreshness {
  fresh: boolean;
  /** stack: another stack version built it; layout: the root is now another kind of stack; history: a commit, a release tag or the set of files changed since the last tag moved; files: a file it was built from was added, removed or changed. */
  reason?: "stack" | "layout" | "history" | "files";
  /** Up to 20 paths each. */
  added: string[];
  removed: string[];
  changed: string[];
  /** Files compared. */
  checked: number;
}

const LIST_CAP = 20;

/**
 * Whether `map` still describes the stack at `root`. A different stack
 * version is stale ("stack"), as is another layout. The history is compared
 * next (HEAD, the release tags, the set of paths that differ from the last
 * tag): a map built with history goes stale when it moves, and one built
 * without stays without. Then the files are collected again, as the builder
 * would read them, and compared by content: one added, removed or with other
 * bytes is stale ("files"). A file only touched stays fresh.
 */
export async function sysmapFreshness(
  root: string,
  map: SystemMap,
  options: { fs?: SysmapFs; git?: SysmapGitRunner; stack?: string; history?: boolean } = {},
): Promise<SysmapFreshness> {
  const stale = (reason: SysmapFreshness["reason"]): SysmapFreshness => ({ fresh: false, reason, added: [], removed: [], changed: [], checked: 0 });
  if (map.stack !== (options.stack ?? FRAMEWORK_VERSION)) return stale("stack");
  const c = await collectStack(root, options.fs ?? nodeSysmapFs);
  if ((c.layout ?? "installed") !== map.layout) return stale("layout");
  if (options.history !== false && map.history !== null) {
    const now = await historyFingerprint(root, options.git ?? runGit);
    if (!now || now.head !== map.history.head || now.dirty !== map.history.dirty || now.tags.join("\n") !== map.history.tags.join("\n")) return stale("history");
  }
  const before = new Map(map.inputs.map((i) => [i[0], i[3]]));
  const now = new Map([...c.inputs.values()].map((i) => [i[0], i[3]]));
  const added = [...now.keys()].filter((p) => !before.has(p)).sort(byCodeUnit);
  const removed = [...before.keys()].filter((p) => !now.has(p)).sort(byCodeUnit);
  const changed = [...now.keys()].filter((p) => before.has(p) && before.get(p) !== now.get(p)).sort(byCodeUnit);
  const checked = [...now.keys()].filter((p) => before.has(p)).length;
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

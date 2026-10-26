/**
 * Where a catalog revision's files go in a project (PB-1018).
 *
 * A library lays a part's files out under its own folders, and the
 * definition names them that way: the Protoboard library's are
 * `library/parts/<id>/artifacts/cad/<id>.step`. Stack 0.1.6 put them under
 * `parts/catalog/<id>/` as they were, so a path held the part id three
 * times; in a project nested in a company workspace
 * (`projects/<group>/<yyyy-mm-dd-slug>/protoboard/`) one ran to 268
 * characters from the drive, past what Windows allows by default (260).
 *
 * Now the folder is the part id cut to 24 characters (with a short hash when
 * cut), and the library's own folders down to the part id are left out:
 * `parts/catalog/<short>/artifacts/cad/<id>.step`. The definition is never
 * changed (its bytes are digest-pinned); `artifactBase.strip` in
 * parts/origins.json records the prefix left out, and loading gives the
 * definition's artifacts the paths the files have here. A record without
 * `strip` is the earlier layout and is read as it always was;
 * `protoboard parts migrate` moves a project's parts to this layout.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import type { OriginRecord } from "./load.js";

/** The longest folder name a vendored part gets under the catalog folder. */
export const VENDORED_DIR_MAX = 24;

/**
 * The folder a part's files are vendored into, under the catalog folder: its
 * id when that is short enough, else the id cut short with four hex digits of
 * its hash (`rev-41-1625-ultrapla-3f2a`). `taken` holds the folders other
 * parts use; a clash takes more of the hash.
 */
export function vendoredDirName(id: string, taken: ReadonlySet<string> = new Set()): string {
  if (id.length <= VENDORED_DIR_MAX && !taken.has(id)) return id;
  const hash = createHash("sha256").update(id).digest("hex");
  for (let n = 4; n <= hash.length; n++) {
    const head = id.slice(0, Math.max(1, VENDORED_DIR_MAX - n - 1)).replace(/[-_.]+$/, "");
    const name = `${head}-${hash.slice(0, n)}`;
    if (!taken.has(name)) return name;
  }
  return hash;
}

/**
 * The library's folders a part's file paths start with, down to and
 * including the folder named after the part (`library/parts/<id>/`): left out
 * of the vendored paths. Undefined when no file is in such a folder, or when
 * leaving it out would give two files one path.
 */
export function stripPrefixFor(id: string, files: readonly string[], keep: readonly string[] = []): string | undefined {
  let prefix: string | undefined;
  for (const f of files) {
    const segments = f.split("/");
    const at = segments.slice(0, -1).indexOf(id);
    if (at === -1) continue;
    prefix = segments.slice(0, at + 1).join("/") + "/";
    break;
  }
  if (!prefix) return undefined;
  const seen = new Set<string>(keep);
  for (const f of files) {
    const stored = storedPath(f, prefix);
    if (seen.has(stored)) return undefined;
    seen.add(stored);
  }
  return prefix;
}

/** Where a file the definition names lies under the vendored folder. */
export const storedPath = (path: string, strip: string | undefined): string => (strip && path.startsWith(strip) ? path.slice(strip.length) : path);

/**
 * The definitions as the library pinned them, for each one loading gave the
 * vendored paths: what fingerprints compare (a board's digest does not change
 * because its parts' files moved).
 */
const pinned = new WeakMap<ModuleDef, ModuleDef>();

/** The definition as pinned, when loading gave it vendored paths; else itself. */
export const pinnedForm = (def: ModuleDef): ModuleDef => pinned.get(def) ?? def;

/** A catalog definition with its artifacts at the paths its files have in the project. */
export function withStoredPaths(def: ModuleDef, strip: string | undefined): ModuleDef {
  if (!strip || !def.artifacts?.some((a) => a.filePath?.startsWith(strip))) return def;
  const out: ModuleDef = { ...def, artifacts: def.artifacts.map((a) => (a.filePath?.startsWith(strip) ? { ...a, filePath: storedPath(a.filePath, strip) } : a)) };
  pinned.set(out, def);
  return out;
}

/** The layout a record is in: `current`, or `earlier` (the 0.1.6 layout, which `parts migrate` moves). */
export function recordLayout(id: string, rec: OriginRecord, catalog: string): { current: boolean; dir?: string; strip?: string } {
  if (rec.artifactBase?.kind !== "vendored") return { current: true };
  const files = Object.keys(rec.files ?? {});
  const strip = rec.artifactBase.strip ?? stripPrefixFor(id, files, Object.keys(rec.source?.files ?? {}));
  const current = rec.artifactBase.dir.split("/").pop()!.length <= VENDORED_DIR_MAX && (rec.artifactBase.strip !== undefined || !strip);
  return { current, ...(current ? {} : { dir: `${catalog}/${vendoredDirName(id)}`, ...(strip ? { strip } : {}) }) };
}

export interface MigrateResult {
  id: string;
  status: "moved" | "current";
  from?: string;
  to?: string;
  /** Where the files were: `from` and the nested path the earlier layout repeated (`library/parts/<id>`), when there was one. */
  fromFiles?: string;
  /** Files moved. */
  files?: number;
  /** Recorded files that were not there to move (`parts add` restores them). */
  missing?: string[];
  /** Files in the earlier folder that no record names, left where they are. */
  leftOver?: string[];
}

/** Remove the folders under `top` (and `top`) that are empty. */
function removeEmpty(top: string): void {
  if (!existsSync(top)) return;
  for (const e of readdirSync(top, { withFileTypes: true })) if (e.isDirectory()) removeEmpty(join(top, e.name));
  if (!readdirSync(top).length) rmdirSync(top);
}

const filesUnder = (top: string, base = top): string[] =>
  !existsSync(top) ? [] : readdirSync(top, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(top, e.name), base) : [join(top, e.name).slice(base.length + 1).split(/[\\/]/).join("/")]));

/**
 * Move one record's files from the earlier layout to the current one and
 * give the record the new paths. Every file keeps its bytes, so the digests
 * stay; a file that is missing stays missing (and `check` says so).
 */
export function migrateRecord(root: string, id: string, rec: OriginRecord, catalog: string, taken: Set<string>): MigrateResult {
  const layout = recordLayout(id, rec, catalog);
  if (layout.current || rec.artifactBase?.kind !== "vendored") return { id, status: "current" };
  const from = rec.artifactBase.dir;
  const name = vendoredDirName(id, new Set([...taken].filter((t) => t !== from.split("/").pop())));
  const to = `${catalog}/${name}`;
  const strip = layout.strip;
  const plan = [...Object.keys(rec.files ?? {}).map((path) => [path, storedPath(path, strip)] as const), ...Object.keys(rec.source?.files ?? {}).map((path) => [path, path] as const)];
  // checked before anything moves: the new folder holds nothing a moved file would land on
  const there = new Set(from === to ? [] : filesUnder(join(root, to)));
  if (there.size) throw new Error(`${to} already holds files that no record names; move them away and run \`protoboard parts migrate\` again`);
  const missing: string[] = [];
  let moved = 0;
  // through a staging folder: the new folder may be the old one (an id short enough), and a file's new path may be another's old one
  const staging = join(root, catalog, `.migrate-${name}`);
  for (const [src, dest] of plan) {
    const a = join(root, from, ...src.split("/"));
    if (!existsSync(a)) {
      missing.push(src);
      continue;
    }
    const b = join(staging, ...dest.split("/"));
    mkdirSync(dirname(b), { recursive: true });
    renameSync(a, b);
    moved++;
  }
  const leftOver = filesUnder(join(root, from));
  const clash = leftOver.filter((f) => from === to && plan.some(([, dest]) => dest === f));
  for (const f of filesUnder(staging)) {
    const b = join(root, to, ...f.split("/"));
    if (clash.includes(f)) continue;
    mkdirSync(dirname(b), { recursive: true });
    renameSync(join(staging, ...f.split("/")), b);
  }
  if (clash.length) throw new Error(`${from} holds files at the paths its part's files move to (${clash.slice(0, 3).join(", ")}); they were left in ${staging}`);
  removeEmpty(staging);
  removeEmpty(join(root, from));
  taken.delete(from.split("/").pop()!);
  taken.add(name);
  const restrip = <T>(o: Record<string, T> | undefined) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [storedPath(k, strip), v])) : undefined);
  rec.artifactBase = { kind: "vendored", dir: to, ...(strip ? { strip } : {}) };
  if (rec.files) rec.files = restrip(rec.files);
  if (rec.evidence) rec.evidence = rec.evidence.map((e) => ({ ...e, path: storedPath(e.path, strip) }));
  if (rec.missingArtifacts) rec.missingArtifacts = rec.missingArtifacts.map((m) => ({ ...m, path: storedPath(m.path, strip) }));
  const fromFiles = strip ? `${from}/${strip.replace(/\/+$/, "")}` : from;
  return { id, status: "moved", from, to, fromFiles, files: moved, ...(missing.length ? { missing } : {}), ...(leftOver.length ? { leftOver } : {}) };
}

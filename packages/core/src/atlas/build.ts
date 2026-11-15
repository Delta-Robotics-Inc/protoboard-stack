/**
 * Atlas index builder (docs/specs/atlas.md): enumerates the project's files,
 * hashes them (reusing the previous index's hashes when a file's size and
 * mtime are unchanged), counts the assets and assembles the definition-level
 * graph, then writes `.protoboard/build/atlas.json`.
 *
 * Read-only with respect to project files: the only file it writes is the
 * index. A failure on one file (locked, unreadable, a link out of the
 * project) is recorded on that file and never throws out of the build.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { lstat as fsLstat, readFile, readdir as fsReaddir, realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import type { ArtifactDef } from "@deltarobotics/uhd";
import { stableStringify } from "../build.js";
import { FRAMEWORK_VERSION } from "../extensions.js";
import { artifactBaseDir, sha256 } from "../load.js";
import { isInside, projectRelative, recordedPath } from "../paths.js";
import { artifactPathEscape, type Project } from "../project.js";
import { definitionTrust } from "../project-parts.js";
import {
  ATLAS_FILE,
  ATLAS_SCHEMA,
  artifactTypeKind,
  byCodeUnit,
  classifyFile,
  fileExtension,
  isSensitiveName,
  type ArtifactRef,
  type AtlasCounts,
  type AtlasCreated,
  type AtlasEdge,
  type AtlasIndex,
  type AtlasKind,
  type AtlasNode,
  type CensusEntry,
  type EdgeType,
  type FailReason,
  type FileKind,
  type KindSource,
} from "./model.js";

// ---------------------------------------------------------------------------
// File system access (injectable for tests)
// ---------------------------------------------------------------------------

/** The parts of a stat result the index uses. */
export interface AtlasStat {
  size: number;
  mtimeMs: number;
  /** The file's birth time; absent, 0 or not finite on file systems that keep none (the mtime is used then). */
  birthtimeMs?: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Everything the builder and the freshness check read through: injectable for tests. Nothing here writes. */
export interface AtlasFs {
  lstat(abs: string): Promise<AtlasStat>;
  stat(abs: string): Promise<AtlasStat>;
  realpath(abs: string): Promise<string>;
  /** The names in a directory. */
  readdir(abs: string): Promise<string[]>;
  /** Streams the file through sha256: "sha256:<hex>". */
  hashFile(abs: string): Promise<string>;
  /** The file as UTF-8 text, or null when it is larger than `max` bytes or cannot be read. */
  readText(abs: string, max: number): Promise<string | null>;
}

/** The real file system, read-only. */
export const nodeAtlasFs: AtlasFs = {
  lstat: (abs) => fsLstat(abs),
  stat: (abs) => fsStat(abs),
  realpath: (abs) => fsRealpath(abs),
  readdir: (abs) => fsReaddir(abs),
  hashFile: (abs) =>
    new Promise<string>((done, fail) => {
      const hash = createHash("sha256");
      const stream = createReadStream(abs);
      stream.on("error", fail);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => done("sha256:" + hash.digest("hex")));
    }),
  readText: async (abs, max) => {
    try {
      if ((await fsStat(abs)).size > max) return null;
      return await readFile(abs, "utf8");
    } catch {
      return null;
    }
  },
};

/** Runs git and gives its stdout, or null when git is absent or fails. */
export type AtlasGitRunner = (args: string[], cwd: string) => Promise<string | null>;

const runGit: AtlasGitRunner = (args, cwd) =>
  new Promise((done) => {
    execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true }, (err, stdout) => done(err ? null : stdout));
  });

const errorCode = (e: unknown): string | undefined => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : undefined);

/** The reason recorded for a file the builder could not stat or read. */
export function failReason(e: unknown, stage: "stat" | "read"): FailReason {
  const code = errorCode(e);
  if (code === "EBUSY" || code === "EPERM") return "LOCKED";
  if (code === "EACCES") return "PERMISSION_DENIED";
  return stage === "stat" ? "STAT_FAILED" : "READ_FAILED";
}

const GONE = new Set(["ENOENT", "ENOTDIR"]);

/** One enumerated path on disk: a regular file, a file the builder may not read (with why), or nothing to index. */
export type StatEntry =
  | { state: "file"; size: number; mtimeMs: number; birthtimeMs?: number }
  | { state: "failed"; reason: FailReason; size: number; mtimeMs: number; message: string }
  | { state: "gone" }
  | { state: "not-file" };

/**
 * Stat a project-relative path the way the index records it: a link is
 * followed only when its target stays inside the project (`rootReal` is the
 * project root's realpath); a link out of it is OUTSIDE_PROJECT and a
 * dangling one BROKEN_LINK, and neither target is read.
 */
export async function statEntry(fs: AtlasFs, root: string, rootReal: string, rel: string): Promise<StatEntry> {
  const abs = join(root, rel);
  let st: AtlasStat;
  try {
    st = await fs.lstat(abs);
  } catch (e) {
    if (GONE.has(errorCode(e) ?? "")) return { state: "gone" };
    return { state: "failed", reason: failReason(e, "stat"), size: 0, mtimeMs: 0, message: `cannot stat ${rel}: ${(e as Error).message}` };
  }
  if (st.isSymbolicLink()) {
    const link = { size: st.size, mtimeMs: st.mtimeMs };
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch (e) {
      const code = errorCode(e) ?? "";
      if (GONE.has(code) || code === "ELOOP") return { state: "failed", reason: "BROKEN_LINK", ...link, message: `${rel} is a link to nothing` };
      return { state: "failed", reason: failReason(e, "stat"), ...link, message: `cannot follow the link ${rel}: ${(e as Error).message}` };
    }
    if (!isInside(rootReal, real)) return { state: "failed", reason: "OUTSIDE_PROJECT", ...link, message: `${rel} is a link to a file outside the project; it is not read` };
    try {
      st = await fs.stat(abs);
    } catch (e) {
      return { state: "failed", reason: failReason(e, "stat"), ...link, message: `cannot stat ${rel}: ${(e as Error).message}` };
    }
  }
  if (!st.isFile()) return { state: "not-file" };
  return { state: "file", size: st.size, mtimeMs: st.mtimeMs, ...(st.birthtimeMs !== undefined ? { birthtimeMs: st.birthtimeMs } : {}) };
}

// ---------------------------------------------------------------------------
// Creation times (docs/specs/atlas.md, "Creation times")
// ---------------------------------------------------------------------------

/** The marker that opens each commit in the history pass: never a status letter, so it cannot be taken for one. */
const COMMIT_MARK = "\x01";

/**
 * The one `git log` of the history pass, run from the project folder: every
 * commit that added or deleted a file below it, newest first, with its author
 * time (seconds) and, per file, A or D and the path relative to the project.
 * `-z` keeps paths as they are (spaces, non-ASCII, even newlines); the
 * configuration that could change the output (follow, quoting, signatures)
 * is pinned.
 */
export const HISTORY_ARGS: readonly string[] = [
  "-c", "core.quotepath=off",
  "-c", "log.follow=false",
  "-c", "log.showRoot=true",
  "log", "--no-show-signature", "--no-renames", "--diff-filter=AD", "--name-status", "--relative", "-z",
  "--format=%x01%at",
  "--", ".",
];

/**
 * When each path was last added, from the output of HISTORY_ARGS (ms since
 * the epoch). The stream is NUL-separated tokens: a commit header
 * ("\x01<seconds>"), then (status, path) pairs, the first status after a
 * header carrying the newline git puts between a commit and its files. It is
 * read as a little state machine, so a path is never taken for a header or
 * a status, whatever it holds. Newest first: the first event seen for a path
 * is its current one, an add gives its time, a delete (the file left the
 * history; one there now is untracked) gives none.
 */
export function parseAddTimes(out: string): Map<string, number> {
  const added = new Map<string, number>();
  const settled = new Set<string>();
  let at: number | undefined;
  let status: string | undefined;
  for (const token of out.split("\0")) {
    if (status !== undefined) {
      // a path
      const path = recordedPath(token);
      if (path && at !== undefined && !settled.has(path)) {
        settled.add(path);
        if (status === "A") added.set(path, at);
      }
      status = undefined;
      continue;
    }
    const t = token.startsWith("\n") ? token.slice(1) : token;
    if (t.startsWith(COMMIT_MARK)) {
      const seconds = Number(t.slice(COMMIT_MARK.length));
      at = /^\d+$/.test(t.slice(COMMIT_MARK.length)) && Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : undefined;
    } else if (t === "A" || t === "D") status = t;
    // anything else (the empty token at the end) is skipped
  }
  return added;
}

/** The add time of every path the project's history holds, or null when git log fails. One git call for the whole project. */
export async function gitAddTimes(git: AtlasGitRunner, root: string): Promise<Map<string, number> | null> {
  const out = await git([...HISTORY_ARGS], root);
  return out === null ? null : parseAddTimes(out);
}

/** A file's creation time from the history pass, else its birth time, else its mtime (integer ms). */
export function createdOf(path: string, birthtimeMs: number | undefined, mtimeMs: number, history: Map<string, number> | null): AtlasCreated | undefined {
  const added = history?.get(path);
  if (added !== undefined) return { at: added, from: "git" };
  if (birthtimeMs !== undefined && Number.isFinite(birthtimeMs) && birthtimeMs > 0) return { at: Math.floor(birthtimeMs), from: "birthtime" };
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) return { at: Math.floor(mtimeMs), from: "mtime" };
  return undefined;
}

/** Runs `fn` over `items` with at most `limit` running at once, keeping the order of results. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

export interface Enumerated {
  enumerator: "git" | "walk";
  /** Project-relative, forward slashes, sorted (code-unit order). */
  files: string[];
  problems: AtlasIndex["problems"];
  /** Files left out because their names look sensitive (isSensitiveName): never listed, hashed or searched. */
  excluded: number;
}

/** Folders the walker never enters (git's own ignore rules do this job when git enumerates). */
const WALK_SKIP = new Set(["node_modules", "__pycache__", "dist", "build"]);
/** Top-level folders never indexed: the Manufacturing Package is rebuilt from the project. */
const NEVER_TOP = new Set(["release", "releases"]);

async function walkFiles(fs: AtlasFs, root: string, problems: AtlasIndex["problems"]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (relDir: string) => {
    let names: string[];
    try {
      names = await fs.readdir(relDir ? join(root, relDir) : root);
    } catch (e) {
      problems.push({ path: relDir, reason: failReason(e, "read"), message: `cannot list ${relDir || "the project folder"}: ${(e as Error).message}` });
      return;
    }
    for (const name of [...names].sort(byCodeUnit)) {
      const rel = relDir ? `${relDir}/${name}` : name;
      let st: AtlasStat;
      try {
        st = await fs.lstat(join(root, rel));
      } catch {
        out.push(rel); // recorded as failed when it is stat'ed again
        continue;
      }
      if (st.isDirectory()) {
        if (!name.startsWith(".") && !WALK_SKIP.has(name)) await visit(rel);
      } else out.push(rel);
    }
  };
  await visit("");
  return out;
}

/**
 * The project's files: `git ls-files --cached --others --exclude-standard`
 * from the project folder when it is in a git work tree (so a project nested
 * in a larger repository lists only its own files) and the repository does
 * not ignore the folder itself; otherwise a walk. Either
 * way `.protoboard/`, `release/`, `releases/`, dot-files and sensitive names
 * are left out, as are tracked files no longer on disk.
 */
export async function enumerateProject(root: string, options: { fs?: AtlasFs; git?: AtlasGitRunner } = {}): Promise<Enumerated> {
  const fs = options.fs ?? nodeAtlasFs;
  const git = options.git ?? runGit;
  const problems: AtlasIndex["problems"] = [];
  let enumerator: Enumerated["enumerator"] = "walk";
  let raw: string[] | undefined;
  const inside = await git(["rev-parse", "--is-inside-work-tree"], root);
  // a project in a folder the repository ignores has no files to git: walk it (check-ignore exits 0 when ignored)
  if (inside?.trim() === "true" && (await git(["check-ignore", "-q", "."], root)) === null) {
    const listed = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
    if (listed !== null) {
      enumerator = "git";
      raw = listed.split("\0").filter(Boolean);
    } else {
      problems.push({ reason: "ENUMERATION_FALLBACK", message: "git ls-files failed in a git work tree; the project folder was walked instead" });
    }
  }
  if (!raw) raw = await walkFiles(fs, root, problems);

  let rootReal = root;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    // keep the path as given
  }
  let excluded = 0;
  const candidates = new Set<string>();
  for (const entry of raw) {
    const rel = recordedPath(entry).replace(/^\.\//, "");
    // git and the file system give U+FFFD for bytes that are not valid UTF-8
    if (rel.includes(String.fromCharCode(0xfffd))) {
      problems.push({ path: rel, reason: "NAME_UNREADABLE", message: `a file name under ${posix.dirname(rel)} is not valid text; it is left out` });
      continue;
    }
    if (isSensitiveName(rel)) {
      excluded++;
      continue;
    }
    const segments = rel.split("/");
    if (segments.some((s) => s.startsWith(".")) || NEVER_TOP.has(segments[0])) continue;
    candidates.add(rel);
  }
  const list = [...candidates].sort(byCodeUnit);
  const states = await mapLimit(list, 16, (rel) => statEntry(fs, root, rootReal, rel));
  const files = list.filter((_, i) => states[i].state !== "gone" && states[i].state !== "not-file");
  return { enumerator, files, problems, excluded };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export interface AtlasBuildOptions {
  /** Folder the index is written to (default `.protoboard/build`); `atlas.json` inside it. */
  outDir?: string;
  /** The index to reuse hashes from; default: the one already at the output path (null: none). */
  previous?: AtlasIndex | null;
  fs?: AtlasFs;
  enumerate?: typeof enumerateProject;
  /** Runs git for the default enumerator. */
  git?: AtlasGitRunner;
}

export interface AtlasWriteResult {
  file: string;
  bytes: number;
  digest: string;
  counts: AtlasCounts;
  problems: number;
}

/** Operation records larger than this are not read. */
const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/** The output file for `outDir`. */
export const atlasFileFor = (root: string, outDir?: string): string => (outDir ? join(outDir, "atlas.json") : join(root, ATLAS_FILE));

/** The previous index at `file`, when it was built by this stack with this schema (otherwise no hash is reused). */
function readPrevious(file: string): AtlasIndex | null {
  try {
    if (!existsSync(file)) return null;
    const index = JSON.parse(readFileSync(file, "utf8")) as AtlasIndex;
    return index?.schema === ATLAS_SCHEMA && index.stack === FRAMEWORK_VERSION && Array.isArray(index.inputs) ? index : null;
  } catch {
    return null;
  }
}

interface FileFacts {
  path: string;
  size: number;
  mtimeMs: number;
  birthtimeMs?: number;
  sha256?: string;
  failed?: { reason: FailReason; message: string };
}

const folderOf = (path: string): string => {
  const d = posix.dirname(path);
  return d === "." ? "" : d;
};
const lastSegment = (path: string): string => path.replace(/\/+$/, "").split("/").pop() ?? path;
const pushUnique = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value);
};

/** The instance path a link end ("<path>/<child>:<iface>", "<path>/:<iface>", ":<iface>") sits on. */
const endInstance = (end: string): string => {
  const colon = end.indexOf(":");
  return (colon < 0 ? end : end.slice(0, colon)).replace(/\/+$/, "");
};

/** Build the index of a loaded project. Never throws for one file's failure. */
export async function buildAtlasIndex(p: Project, options: AtlasBuildOptions = {}): Promise<AtlasIndex> {
  const root = p.root;
  const fs = options.fs ?? nodeAtlasFs;
  const previous = options.previous !== undefined ? options.previous : readPrevious(atlasFileFor(root, options.outDir));
  const cache = new Map<string, [string, number, number, string | null]>();
  if (previous && previous.schema === ATLAS_SCHEMA && previous.stack === FRAMEWORK_VERSION) for (const input of previous.inputs ?? []) cache.set(input[0], input);

  const enumerated = await (options.enumerate ?? enumerateProject)(root, { fs, ...(options.git ? { git: options.git } : {}) });
  const problems: AtlasIndex["problems"] = [...enumerated.problems];
  let rootReal = root;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    // keep the path as given
  }

  // ---- 1-2. stat and hash every enumerated file
  const factsList = await mapLimit(enumerated.files, 8, async (rel): Promise<FileFacts | undefined> => {
    const st = await statEntry(fs, root, rootReal, rel);
    if (st.state === "gone" || st.state === "not-file") return undefined;
    if (st.state === "failed") return { path: rel, size: st.size, mtimeMs: st.mtimeMs, failed: { reason: st.reason, message: st.message } };
    const base = { path: rel, size: st.size, mtimeMs: st.mtimeMs, ...(st.birthtimeMs !== undefined ? { birthtimeMs: st.birthtimeMs } : {}) };
    const hit = cache.get(rel);
    if (hit && hit[1] === st.size && hit[2] === st.mtimeMs && hit[3]) return { ...base, sha256: hit[3] };
    try {
      return { ...base, sha256: await fs.hashFile(join(root, rel)) };
    } catch (e) {
      const reason = failReason(e, "read");
      return { ...base, failed: { reason, message: `cannot read ${rel}: ${(e as Error).message}` } };
    }
  });
  const facts = new Map<string, FileFacts>();
  for (const f of factsList) if (f) facts.set(f.path, f);
  for (const f of facts.values()) if (f.failed) problems.push({ path: f.path, reason: f.failed.reason, message: f.failed.message });

  // ---- creation times: one git log for the whole project when git listed it, else the file system
  let history: Map<string, number> | null = null;
  if (enumerated.enumerator === "git") {
    history = await gitAddTimes(options.git ?? runGit, root);
    if (history === null) problems.push({ reason: "HISTORY_FALLBACK", message: "git log failed in a git work tree; creation times came from the file system (birth times, or mtimes where there are none)" });
  }
  /** The creation time of an enumerated project file that is not failed. */
  const createdAt = (path: string | undefined): AtlasCreated | undefined => {
    const f = path ? facts.get(path) : undefined;
    return f && !f.failed ? createdOf(f.path, f.birthtimeMs, f.mtimeMs, history) : undefined;
  };

  // ---- operation records: which record produced which file (the newest one wins)
  const producedBy = new Map<string, string>();
  for (const rel of enumerated.files.filter((f) => /^operations\/[^/]+\.json$/.test(f))) {
    const f = facts.get(rel);
    if (!f || f.failed) continue;
    try {
      const text = await fs.readText(join(root, rel), MAX_RECORD_BYTES);
      if (text === null) throw new Error("it is too large or cannot be read");
      const record = JSON.parse(text) as { outputs?: unknown };
      const outputs = Array.isArray(record.outputs) ? record.outputs : [];
      for (const o of outputs) {
        const path = o && typeof o === "object" && typeof (o as { path?: unknown }).path === "string" ? (o as { path: string }).path : undefined;
        if (path) producedBy.set(posix.normalize(recordedPath(path)).replace(/^\.\//, ""), rel);
      }
    } catch (e) {
      problems.push({ path: rel, reason: "OPERATION_RECORD_UNREADABLE", message: `operation record ${rel} is not readable JSON: ${(e as Error).message}` });
    }
  }

  // ---- 3. graph
  const nodes = new Map<string, AtlasNode>();
  const edges = new Map<string, AtlasEdge>();
  const addEdge = (from: string, to: string, type: EdgeType, via?: string) => {
    const key = `${from}\0${to}\0${type}`;
    let e = edges.get(key);
    if (!e) edges.set(key, (e = { from, to, type }));
    if (via !== undefined) pushUnique((e.via ??= []), via);
  };
  /** Artifacts that name a file, by node id; and the census `linkedBy` of each enumerated file. */
  const fileArtifacts = new Map<string, ArtifactRef[]>();
  const fileOwners = new Map<string, string[]>();
  const linkedBy = new Map<string, string[]>();
  const link = (path: string, by: string) => {
    const list = linkedBy.get(path) ?? [];
    pushUnique(list, by);
    linkedBy.set(path, list);
  };

  let trust: Record<string, { trust: string }> = {};
  try {
    trust = definitionTrust(p);
  } catch {
    // trust is a hint for the view; an index without it is still whole
  }
  const usedBy = new Map<string, string[]>();
  for (const i of p.instances) {
    const list = usedBy.get(i.definition) ?? [];
    list.push(i.path);
    usedBy.set(i.definition, list);
  }

  const defIds = [...p.definitions.keys()].sort(byCodeUnit);
  for (const id of defIds) {
    const rec = p.definitions.get(id)!;
    const instances = (usedBy.get(id) ?? []).sort(byCodeUnit);
    const path = rec.origin.source?.file ? recordedPath(rec.origin.source.file) : undefined;
    nodes.set(`def:${id}`, {
      id: `def:${id}`,
      kind: rec.origin.tier === "project-specific" ? "module" : "part",
      label: rec.def.name || id,
      ...(path ? { path } : {}),
      folder: path ? folderOf(path) : "",
      status: instances.length ? "ok" : "unused",
      degree: 0,
      definition: {
        id,
        tier: rec.origin.tier,
        moduleKind: rec.def.kind ?? "module",
        ...(p.rootDef?.id === id ? { root: true as const } : {}),
        instances,
        ...(trust[id]?.trust ? { trust: trust[id].trust } : {}),
      },
    });
  }

  /** A file or folder node named by an artifact, created on first use. */
  const artifactNode = (id: string, init: () => Omit<AtlasNode, "degree">): AtlasNode => {
    let n = nodes.get(id);
    if (!n) nodes.set(id, (n = { ...init(), degree: 0 }));
    return n;
  };
  const dirFiles = new Map<string, { files: string[]; refs: ArtifactRef[]; owners: string[] }>();

  for (const id of defIds) {
    const rec = p.definitions.get(id)!;
    const base = rec.origin.artifactBase;
    const baseDir = artifactBaseDir(root, base);
    const confined = rec.origin.kind === "catalog" || base.kind === "vendored";
    /** artifact id -> node id, for made-from edges */
    const nodeOf = new Map<string, string>();
    const unsafe = new Set(p.diagnostics.filter((d) => d.code === "PB_ARTIFACT_PATH_UNSAFE" && d.entity.id.startsWith(`${id}#`)).map((d) => d.entity.id.slice(id.length + 1)));
    for (const a of (rec.def.artifacts ?? []) as ArtifactDef[]) {
      const ref: ArtifactRef = {
        definition: id,
        id: a.id,
        ...(a.name ? { name: a.name } : {}),
        ...(a.type ? { type: a.type } : {}),
        ...(a.role ? { role: a.role } : {}),
        ...(a.format ? { format: a.format } : {}),
        ...(a.tags?.length ? { tags: [...a.tags] } : {}),
      };
      let nodeId: string;
      if (!a.filePath) {
        if (!a.url) continue; // provenance only: a recorded reference, no file
        nodeId = `url:${id}#${a.id}`;
        const urlPath = (() => {
          try {
            return new URL(a.url!).pathname;
          } catch {
            return a.url!;
          }
        })();
        const byExt = classifyFile(urlPath);
        const kind: FileKind = byExt && byExt.kind !== "other" ? byExt.kind : (artifactTypeKind(a.type) ?? "other");
        artifactNode(nodeId, () => ({ id: nodeId, kind, label: a.name || a.id, folder: "(remote)", status: "remote", url: a.url }));
      } else {
        let escape: string | undefined;
        if (unsafe.has(a.id)) escape = "its path is unsafe";
        else if (confined) {
          try {
            escape = artifactPathEscape(root, base.kind === "vendored", baseDir, a.filePath)?.reason;
          } catch (e) {
            escape = (e as Error).message;
          }
        }
        const declared = recordedPath(a.filePath);
        if (escape) {
          // never resolved, read or opened: the node only names it
          const shown = base.kind === "package" ? `package:${base.package}/${declared}` : base.kind === "vendored" ? `${recordedPath(base.dir)}/${declared}` : declared;
          nodeId = `file:${shown}`;
          problems.push({ path: shown, reason: "UNSAFE_PATH", message: `${id} artifact ${a.id}: ${JSON.stringify(a.filePath)} ${escape}; it is not read` });
          artifactNode(nodeId, () => ({ id: nodeId, kind: classifyFile(shown, { artifacts: [ref] })?.kind ?? "other", label: lastSegment(shown), path: shown, folder: folderOf(shown), status: "failed", reason: "UNSAFE_PATH" }));
        } else if (base.kind === "package") {
          const shown = `package:${base.package}/${declared.replace(/\/+$/, "")}`;
          nodeId = `file:${shown}`;
          let present = false;
          if (baseDir) {
            try {
              await fs.stat(resolve(baseDir, declared));
              present = true;
            } catch {
              present = false;
            }
          }
          artifactNode(nodeId, () => ({ id: nodeId, kind: "other", label: lastSegment(shown), path: shown, folder: folderOf(shown), status: present ? "ok" : "missing" }));
        } else {
          const abs = resolve(baseDir ?? root, declared);
          const rel = projectRelative(root, abs);
          if (isSensitiveName(rel)) continue; // never listed
          let outside = !isInside(root, abs);
          let st: AtlasStat | undefined;
          if (!outside) {
            try {
              outside = !isInside(rootReal, await fs.realpath(abs));
            } catch {
              // not there (yet): reported as missing below
            }
          }
          if (outside) {
            nodeId = `file:${rel}`;
            problems.push({ path: rel, reason: "OUTSIDE_PROJECT", message: `${id} artifact ${a.id}: ${a.filePath} lies outside the project; it is not read` });
            artifactNode(nodeId, () => ({ id: nodeId, kind: classifyFile(rel, { artifacts: [ref] })?.kind ?? "other", label: lastSegment(rel), path: rel, folder: folderOf(rel), status: "failed", reason: "OUTSIDE_PROJECT" }));
          } else {
            try {
              st = facts.has(rel) ? undefined : await fs.stat(abs);
            } catch {
              st = undefined;
            }
            const isDir = declared.endsWith("/") || !!st?.isDirectory();
            if (isDir) {
              nodeId = `dir:${rel}/`;
              artifactNode(nodeId, () => ({ id: nodeId, kind: "other", label: `${lastSegment(rel)}/`, path: rel, folder: folderOf(rel), status: st ? "ok" : "missing" }));
              const d = dirFiles.get(nodeId) ?? { files: enumerated.files.filter((f) => f.startsWith(`${rel}/`)), refs: [], owners: [] };
              d.refs.push(ref);
              pushUnique(d.owners, id);
              dirFiles.set(nodeId, d);
              for (const f of d.files) link(f, `dir-artifact:${id}#${a.id}`);
            } else {
              nodeId = `file:${rel}`;
              const f = facts.get(rel);
              artifactNode(nodeId, () => ({
                id: nodeId,
                kind: "other",
                label: lastSegment(rel),
                path: rel,
                folder: folderOf(rel),
                status: f ? (f.failed ? "failed" : "ok") : st ? "ok" : "missing",
                ...(f?.failed ? { reason: f.failed.reason } : {}),
                file: { ext: fileExtension(rel), size: f?.size ?? st?.size ?? 0, ...(f?.sha256 ? { sha256: f.sha256 } : {}), kindFrom: "extension" as KindSource, artifacts: [], owners: [] },
              }));
              if (facts.has(rel)) link(rel, `artifact:${id}#${a.id}`);
            }
          }
        }
      }
      const refs = fileArtifacts.get(nodeId) ?? [];
      refs.push(ref);
      fileArtifacts.set(nodeId, refs);
      const owners = fileOwners.get(nodeId) ?? [];
      pushUnique(owners, id);
      fileOwners.set(nodeId, owners);
      nodeOf.set(a.id, nodeId);
      addEdge(`def:${id}`, nodeId, "has", a.id);
    }
    // made-from: a derived file to the file it was generated from (dropped when the source has no node)
    for (const a of (rec.def.artifacts ?? []) as ArtifactDef[]) {
      const from = nodeOf.get(a.id);
      const to = a.provenance?.generatedFrom ? nodeOf.get(a.provenance.generatedFrom) : undefined;
      if (from && to && from !== to) addEdge(from, to, "made-from", a.id);
    }
  }

  /** The folder artifacts' refs for each file below one. */
  const dirRefsOf = new Map<string, ArtifactRef[]>();
  for (const d of dirFiles.values()) for (const f of d.files) dirRefsOf.set(f, [...(dirRefsOf.get(f) ?? []), ...d.refs]);

  // ---- 4. census: every enumerated asset (an artifact-named non-asset, a manifest, gets a node only)
  const census: CensusEntry[] = [];
  for (const rel of enumerated.files) {
    const f = facts.get(rel);
    if (!f) continue;
    const made = producedBy.get(rel);
    if (made) link(rel, `operation:${made}`);
    const base = classifyFile(rel, made ? { producedBy: made } : undefined);
    const refs = fileArtifacts.get(`file:${rel}`) ?? [];
    const dirRefs = dirRefsOf.get(rel) ?? [];
    const kind = classifyFile(rel, { artifacts: [...refs, ...dirRefs], ...(made ? { producedBy: made } : {}) });
    if (!base || !kind) continue;
    const by = (linkedBy.get(rel) ?? []).sort(byCodeUnit);
    const created = createdAt(rel);
    census.push({
      path: rel,
      kind: kind.kind,
      kindFrom: kind.from,
      ext: fileExtension(rel),
      size: f.size,
      ...(f.sha256 ? { sha256: f.sha256 } : {}),
      status: f.failed ? "failed" : by.length ? "linked" : "unlinked",
      ...(f.failed ? { reason: f.failed.reason } : {}),
      ...(by.length ? { linkedBy: by } : {}),
      ...(created ? { created } : {}),
    });
    // every census file is a node; unlinked ones have no edges
    const nodeId = `file:${rel}`;
    artifactNode(nodeId, () => ({
      id: nodeId,
      kind: kind.kind,
      label: lastSegment(rel),
      path: rel,
      folder: folderOf(rel),
      status: f.failed ? "failed" : "ok",
      ...(f.failed ? { reason: f.failed.reason } : {}),
      file: { ext: fileExtension(rel), size: f.size, ...(f.sha256 ? { sha256: f.sha256 } : {}), kindFrom: kind.from, artifacts: [], owners: [] },
    }));
  }
  // files below a folder artifact: a `has` edge from the folder node (asset files only)
  for (const [dirId, d] of dirFiles) {
    for (const rel of d.files) {
      if (!nodes.has(`file:${rel}`)) continue;
      addEdge(dirId, `file:${rel}`, "has");
      const owners = fileOwners.get(`file:${rel}`) ?? [];
      for (const o of d.owners) pushUnique(owners, o);
      fileOwners.set(`file:${rel}`, owners);
    }
    const n = nodes.get(dirId)!;
    const kind = classifyFile(n.path ?? dirId, { artifacts: d.refs });
    if (kind) n.kind = kind.kind;
  }

  // finish file nodes: kind (artifacts and tags known now), artifacts, owners, producer
  for (const n of nodes.values()) {
    if (!n.id.startsWith("file:") || !n.path || n.path.startsWith("package:")) {
      if (n.id.startsWith("file:package:")) n.kind = classifyFile(n.path ?? "", { artifacts: fileArtifacts.get(n.id) ?? [] })?.kind ?? "other";
      continue;
    }
    if (n.status === "failed" && (n.reason === "UNSAFE_PATH" || n.reason === "OUTSIDE_PROJECT")) continue;
    const refs = (fileArtifacts.get(n.id) ?? []).sort((a, b) => byCodeUnit(a.definition, b.definition) || byCodeUnit(a.id, b.id));
    const dirRefs = dirRefsOf.get(n.path) ?? [];
    const made = producedBy.get(n.path);
    const kind = classifyFile(n.path, { artifacts: [...refs, ...dirRefs], ...(made ? { producedBy: made } : {}) }) ?? { kind: "other" as FileKind, from: "extension" as KindSource };
    n.kind = kind.kind;
    if (n.file) {
      n.file.kindFrom = kind.from;
      n.file.artifacts = refs;
      n.file.owners = (fileOwners.get(n.id) ?? []).sort(byCodeUnit);
      if (made) n.file.producedBy = made;
    }
  }

  // contains / uses: a parent definition to each child definition
  for (const id of defIds) {
    for (const ref of p.definitions.get(id)!.def.children ?? []) {
      const child = p.definitions.get(ref.moduleDefId);
      if (!child || ref.moduleDefId === id) continue;
      addEdge(`def:${id}`, `def:${ref.moduleDefId}`, child.origin.tier === "project-specific" ? "contains" : "uses");
    }
  }

  // link / harness: between the definitions of the two ends' instances, one edge per pair and type
  const instanceDef = new Map(p.instances.map((i) => [i.path, i.definition]));
  const defAt = (end: string, leaf?: string) => instanceDef.get(endInstance(end)) ?? (leaf ? instanceDef.get(endInstance(leaf)) : undefined);
  for (const l of p.links) {
    const a = defAt(l.a, l.aLeaf);
    const b = defAt(l.b, l.bLeaf);
    if (!a || !b || a === b) continue;
    const [from, to] = [`def:${a}`, `def:${b}`].sort(byCodeUnit);
    addEdge(from, to, l.harness ? "harness" : "link", l.id);
  }

  // creation times: a project file's own, a definition's source file's, a folder's earliest file's
  for (const n of nodes.values()) {
    let created: AtlasCreated | undefined;
    if (n.id.startsWith("def:") || (n.id.startsWith("file:") && !n.id.startsWith("file:package:"))) {
      if (n.status !== "failed" && n.status !== "missing") created = createdAt(n.path);
    } else if (n.id.startsWith("dir:")) {
      for (const rel of dirFiles.get(n.id)?.files ?? []) {
        const c = createdAt(rel);
        if (c && (!created || c.at < created.at)) created = c;
      }
    }
    if (created) n.created = created;
  }

  // ---- 5. output
  const edgeList = [...edges.values()]
    .map((e) => (e.via ? { ...e, via: e.via.sort(byCodeUnit), ...(e.type === "link" || e.type === "harness" ? { count: e.via.length } : {}) } : e))
    .sort((x, y) => byCodeUnit(x.from, y.from) || byCodeUnit(x.to, y.to) || byCodeUnit(x.type, y.type));
  for (const e of edgeList) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (from) from.degree++;
    if (to && to !== from) to.degree++;
  }
  const nodeList = [...nodes.values()].sort((x, y) => byCodeUnit(x.id, y.id));
  census.sort((x, y) => byCodeUnit(x.path, y.path));

  const byKind: Partial<Record<AtlasKind, number>> = {};
  for (const n of nodeList) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const created = { git: 0, birthtime: 0, mtime: 0, none: 0 };
  for (const n of nodeList) created[n.created?.from ?? "none"]++;
  const counts: AtlasCounts = {
    created,
    nodes: nodeList.length,
    edges: edgeList.length,
    byKind,
    census: {
      total: census.length,
      linked: census.filter((c) => c.status === "linked").length,
      unlinked: census.filter((c) => c.status === "unlinked").length,
      failed: census.filter((c) => c.status === "failed").length,
      excluded: enumerated.excluded ?? 0,
    },
  };
  const instances: Record<string, string> = {};
  for (const i of [...p.instances].sort((x, y) => byCodeUnit(x.path, y.path))) instances[i.path] = i.definition;

  return {
    schema: ATLAS_SCHEMA,
    stack: FRAMEWORK_VERSION,
    project: { name: p.name, root: p.rootDef?.id ?? null },
    enumerator: enumerated.enumerator,
    counts,
    nodes: nodeList,
    edges: edgeList,
    census,
    instances,
    inputs: [...facts.values()].sort((x, y) => byCodeUnit(x.path, y.path)).map((f) => [f.path, f.size, f.mtimeMs, f.sha256 ?? null]),
    problems: problems.sort((x, y) => byCodeUnit(x.path ?? "", y.path ?? "") || byCodeUnit(x.reason, y.reason) || byCodeUnit(x.message, y.message)),
  };
}

/** Build the index and write it (atomically) to `outDir/atlas.json`, default `.protoboard/build/atlas.json`. */
export async function writeAtlasIndex(p: Project, options: AtlasBuildOptions = {}): Promise<AtlasWriteResult> {
  const file = atlasFileFor(p.root, options.outDir);
  const index = await buildAtlasIndex(p, options);
  const data = stableStringify(index);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, data);
  return { file, bytes: Buffer.byteLength(data), digest: sha256(data), counts: index.counts, problems: index.problems.length };
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Write through a temporary file and a rename; the rename is retried 3 times on EPERM/EBUSY (a reader holding the file on Windows). */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = errorCode(e);
      if (attempt < 3 && (code === "EPERM" || code === "EBUSY")) {
        pause(50 * (attempt + 1));
        continue;
      }
      rmSync(tmp, { force: true });
      throw e;
    }
  }
}

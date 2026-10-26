/**
 * Keeping a trial away from the answers and from the checkout.
 *
 * `mirrorModules` builds the node_modules every trial links to: the
 * packages as an install from a registry would have them, never the
 * workspace itself. Third-party packages (any folder inside a node_modules,
 * also when the workspace's node_modules links to it in another install) are
 * hard links of their files, whole (copies across file systems); a linked package (a workspace member,
 * a sibling checkout) is copied, so a rebuild of it during the run (tsc
 * rewrites files in place) does not reach the mirror, and carries only its
 * published files and never its
 * `evals/` (the cases and their solutions); a linked package that is a
 * Protoboard project (the examples a fixture is copied from) is left out.
 * Nothing in the mirror is a symbolic link back into the workspace, so no
 * `..` from inside it reaches the workspace either.
 *
 * `snapshotTree` and `changedPaths` are the backstop for agent hosts: the
 * runner records the workspace, what the mirror took from sibling checkouts
 * (their published files; not their runtime data, which their own services
 * change), the fixture and the mirror before a trial and compares them
 * after it.
 * Anything that changed outside the trial's copy fails the trial.
 */
import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_FILE } from "../load.js";

export const isInside = (parent: string, child: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

export interface ModuleMirror {
  /** The mirrored node_modules: a trial's node_modules links here. */
  modules: string;
  /** Real folders of the linked packages it carries (workspace members, sibling checkouts). */
  linked: string[];
  /** Linked packages left out: Protoboard projects. */
  omitted: string[];
  /** The top-level files and folders it took from the linked packages (what the guard watches in a sibling checkout). */
  carried: string[];
  /** Files linked or copied. */
  files: number;
}

/** Always part of a published package, whatever its `files` say. */
const ALWAYS = /^(package\.json|readme|licen[cs]e|notice|changelog)/i;
/** Never mirrored from a linked package: the cases and their solutions, tests, VCS and tool state. */
const NEVER = new Set(["evals", "test", "tests", ".git", "node_modules"]);

export interface MirrorOptions {
  /**
   * The ablation arm: leave out the skills' documents (every `.md` under a linked package's `skills/`: SKILL.md and
   * its references), so an agent can neither be given nor find them. The skills' scripts stay, as tools.
   */
  withoutSkills?: boolean;
}

/** A package folder inside a node_modules folder: installed from a registry, not a workspace member or sibling checkout. */
const installed = (real: string): boolean => real.split(sep).slice(0, -1).includes("node_modules");

/** A folder, or a link to one (a scope folder linked from another install). */
const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

class Mirror {
  constructor(readonly options: MirrorOptions = {}) {}
  readonly done = new Map<string, string>();
  readonly linked: string[] = [];
  readonly omitted: string[] = [];
  readonly carried: string[] = [];
  files = 0;

  /** A hard link, or a copy (`copy`, or across file systems). */
  file(src: string, dst: string, copy = false): void {
    if (copy) {
      copyFileSync(src, dst, constants.COPYFILE_FICLONE);
      this.files++;
      return;
    }
    try {
      linkSync(src, dst);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EXDEV" && code !== "EPERM" && code !== "EMLINK") throw e;
      copyFileSync(src, dst);
    }
    this.files++;
  }

  /** A symbolic link inside a tree: kept when it stays inside `base`, else what it points at is mirrored. */
  link(src: string, dst: string, base: string, copy = false): void {
    const target = readlinkSync(src);
    if (!isAbsolute(target) && isInside(base, resolve(dirname(src), target))) {
      symlinkSync(target, dst);
      return;
    }
    let real: string;
    try {
      real = realpathSync(src);
    } catch {
      return; // dangling
    }
    if (statSync(real).isDirectory()) {
      if (existsSync(join(real, "package.json"))) this.pkg(real, dst, true);
      else this.tree(real, dst, real, undefined, copy);
    } else this.file(real, dst, copy);
  }

  /** Every entry under `src` (a third-party package, or a folder of one); `keep` filters by path relative to `base`. */
  tree(src: string, dst: string, base: string, keep?: (rel: string) => boolean, copy = false): void {
    mkdirSync(dst, { recursive: true });
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, e.name);
      const d = join(dst, e.name);
      if (e.name === "node_modules" && e.isDirectory()) {
        this.modules(s, d);
        continue;
      }
      if (keep && !keep(relative(base, s))) continue;
      if (e.isSymbolicLink()) this.link(s, d, base, copy);
      else if (e.isDirectory()) this.tree(s, d, base, keep, copy);
      else if (e.isFile()) this.file(s, d, copy);
    }
  }

  /** A node_modules folder: its packages (scoped ones too) and `.bin`; caches and lock state are left out. */
  modules(src: string, dst: string): void {
    mkdirSync(dst, { recursive: true });
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, e.name);
      const d = join(dst, e.name);
      if (e.name === ".bin") this.tree(s, d, src);
      else if (e.name.startsWith(".")) continue;
      else if (e.name.startsWith("@") && isDir(s)) {
        mkdirSync(d, { recursive: true });
        for (const p of readdirSync(s)) this.pkg(join(s, p), join(d, p));
      } else this.pkg(s, d);
    }
  }

  /** One package entry: a third-party folder is mirrored whole; a link to a package outside node_modules carries its published files. */
  pkg(src: string, dst: string, resolved = false): void {
    let real: string;
    try {
      real = realpathSync(src);
    } catch {
      return; // dangling link
    }
    if (!statSync(real).isDirectory()) return;
    const prior = this.done.get(real);
    if (prior) {
      symlinkSync(prior, dst, "dir");
      return;
    }
    // an installed package (a folder in node_modules) is third-party wherever it is reached from: a node_modules
    // whose entries link into another one (a worktree sharing a checkout's install, a pnpm store) still has it whole
    if ((!resolved && !lstatSync(src).isSymbolicLink()) || installed(real)) {
      this.done.set(real, dst);
      this.tree(real, dst, real);
      return;
    }
    if (existsSync(join(real, CONFIG_FILE))) {
      this.omitted.push(real);
      return;
    }
    this.done.set(real, dst);
    this.linked.push(real);
    let files: string[] | undefined;
    try {
      files = (JSON.parse(readFileSync(join(real, "package.json"), "utf8")) as { files?: string[] }).files;
    } catch {
      // no manifest: everything but the never-list
    }
    // `files` entries by their first path segment ("docs/**/*.md" keeps docs/); one whose first segment is a pattern
    // ("**/*.js", "*.mjs") can match at the top, so with one of those every top-level entry is kept
    const firsts = files?.map((f) => f.replace(/^\.\//, "").split("/")[0]);
    const tops = firsts && !firsts.some((t) => /[*?[{]/.test(t)) ? new Set(firsts) : undefined;
    this.tree(real, dst, real, (rel) => {
      const top = rel.split(sep)[0];
      if (NEVER.has(top) || top.startsWith(".")) return false;
      if (this.options.withoutSkills && top === "skills" && rel.toLowerCase().endsWith(".md")) return false;
      const keep = !tops || tops.has(top) || ALWAYS.test(top);
      if (keep && rel === top) this.carried.push(join(real, top));
      return keep;
    }, true);
  }
}

/** Build the mirror of `src` (a node_modules folder) at `<root>/node_modules`. */
export function mirrorModules(src: string, root: string, options: MirrorOptions = {}): ModuleMirror {
  const m = new Mirror(options);
  const modules = join(root, "node_modules");
  m.modules(src, modules);
  return { modules, linked: m.linked, omitted: m.omitted, carried: m.carried, files: m.files };
}

// ---------------------------------------------------------------------------
// The backstop: what changed outside the trial
// ---------------------------------------------------------------------------

export type TreeSnapshot = Map<string, string>;

export interface SnapshotOptions {
  /** Folder names not entered anywhere (`node_modules`, `.git`, `__pycache__`, `.venv*` by default). */
  skipNames?: (name: string) => boolean;
  /** Absolute paths not entered (the trial, the run folder). */
  exclude?: string[];
}

const defaultSkip = (name: string) => name === "node_modules" || name === ".git" || name === "__pycache__" || name.startsWith(".venv");

/** Size and modification time of every file and link under the roots. */
export function snapshotTree(roots: string[], o: SnapshotOptions = {}): TreeSnapshot {
  const skip = o.skipNames ?? defaultSkip;
  const exclude = new Set(o.exclude ?? []);
  const out: TreeSnapshot = new Map();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (exclude.has(p)) continue;
      if (e.isDirectory()) {
        if (!skip(e.name)) walk(p);
        continue;
      }
      try {
        const s = lstatSync(p);
        out.set(p, `${s.size}:${s.mtimeMs}`);
      } catch {
        // removed while walking
      }
    }
  };
  for (const r of new Set(roots)) if (existsSync(r)) walk(r);
  return out;
}

/** Paths added, removed or changed between two snapshots. */
export function changedPaths(before: TreeSnapshot, after: TreeSnapshot): string[] {
  const out: string[] = [];
  for (const [p, sig] of after) {
    const was = before.get(p);
    if (was === undefined) out.push(`${p} (added)`);
    else if (was !== sig) out.push(`${p} (changed)`);
  }
  for (const p of before.keys()) if (!after.has(p)) out.push(`${p} (removed)`);
  return out.sort();
}

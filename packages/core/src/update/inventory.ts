/**
 * What is installed (PB-1168): `protoboard inventory --json`, schema
 * `protoboard.inventory/v0` (round-2-notes/security-updates-telemetry.md A.2).
 *
 * Offline and read-only. It reads:
 *   - the stack the project uses: `@protoboardai/*` and `@deltarobotics/*` in
 *     the project's node_modules (through the stack copy's links), else this
 *     module's own stack;
 *   - the npm dependency set of that stack: npm's hidden lockfile
 *     (`node_modules/.package-lock.json`) when present, else a bounded scan of
 *     the package.json files in that node_modules;
 *   - the managed runtimes in `<project>/.protoboard/tools/tools.json`
 *     (every pip package of a python runtime, the pins of a node runtime);
 *   - Node's version, each runtime's interpreter version, and
 *     `PROTOBOARD_PYTHON --version` when that variable is set;
 *   - the VS Code extension's version: given by the extension itself, else
 *     discovered from the editors' extension folders (folder names only).
 *
 * Path containment and size caps: every file read is a package.json, a lock
 * file or tools.json under a known root, each capped (MAX_JSON_BYTES,
 * MAX_LOCK_BYTES); the scan stops at MAX_SCAN_PACKAGES. No path appears in
 * the inventory (the project is not named), so it is safe to show or attach.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readToolsRecord, TOOLS_DIR, TOOLS_SCHEMA, type ToolsRecord } from "../tools.js";

export const INVENTORY_SCHEMA = "protoboard.inventory/v0";
/** A package.json or tools.json over this is not read. */
export const MAX_JSON_BYTES = 1024 * 1024;
/** npm's hidden lockfile over this is not read (the scan runs instead). */
export const MAX_LOCK_BYTES = 32 * 1024 * 1024;
/** The scan of a node_modules stops after this many packages (DEFAULT). */
export const MAX_SCAN_PACKAGES = 20_000;
/** `PROTOBOARD_PYTHON --version` is given this long. */
const PYTHON_VERSION_TIMEOUT_MS = 3000;

export type ComponentKind = "npm" | "pypi" | "interpreter" | "vscode-extension";

export interface InventoryComponent {
  kind: ComponentKind;
  name: string;
  version?: string;
  /**
   * stack: a @protoboardai package the project uses; extension: an ext-*
   * package; uhd: @deltarobotics/*; dependency: something the stack pulls in;
   * runtime:<id>: inside a managed runtime; interpreter; editor.
   */
  role: string;
  /** Pinned exactly by the stack (a runtime pin). */
  pinned?: boolean;
  /** npm: from the public registry (only these are sent to a vulnerability source). */
  registry?: boolean;
  /** npm: a dev dependency of the stack (tooling, not shipped). */
  dev?: boolean;
}

export interface Inventory {
  schema: typeof INVENTORY_SCHEMA;
  at: string;
  stack: {
    version?: string;
    cli?: string;
    /** Where the stack's packages were read: the project's links, or the CLI running this. */
    from: "project" | "this-cli";
    /** The version in the project's link record (node_modules/.protoboard-stack.json), when the stack is linked. */
    linked?: string;
    /** How the dependency set was read. */
    dependencySource: "lockfile" | "scan" | "none";
  };
  node: string;
  python: { runtime: string; version: string }[];
  vscodeExtension?: { version: string; from: "host" | "editor-folder" };
  components: InventoryComponent[];
  counts: { npm: number; pypi: number; registry: number; runtimes: number };
  notes: string[];
}

export interface InventoryOptions {
  /** The project root (absent: the stack this CLI belongs to, no runtimes). */
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** The extension's own version, when the VS Code extension asks. */
  extensionVersion?: string;
  /** Home folder for the editors' extension folders (tests pass their own). */
  home?: string;
  /** Skip running `PROTOBOARD_PYTHON --version` (tests, speed). */
  noExec?: boolean;
  now?: Date;
}

const OUR_SCOPES = ["@protoboardai/", "@deltarobotics/"];
const isOurs = (name: string) => OUR_SCOPES.some((s) => name.startsWith(s));
const roleOf = (name: string) => (name.startsWith("@deltarobotics/") ? "uhd" : name.startsWith("@protoboardai/ext-") ? "extension" : name.startsWith("@protoboardai/") ? "stack" : "dependency");

/** Reads a small JSON file, or undefined (absent, too big, unreadable). */
export function readJsonCapped<T = unknown>(file: string, max = MAX_JSON_BYTES): T | undefined {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > max) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

const versionOf = (pkgDir: string) => readJsonCapped<{ version?: string }>(join(pkgDir, "package.json"))?.version;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/;
const cleanVersion = (v: unknown) => (typeof v === "string" && VERSION.test(v) ? v : undefined);
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** The node_modules folder holding `dir`, if `dir` sits inside one. */
function enclosingNodeModules(dir: string): string | undefined {
  let d = dir;
  for (;;) {
    if (basename(d) === "node_modules") return d;
    const up = dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

/** This module's own stack: `packages/core` in a checkout, `node_modules/@protoboardai/core` in a copy. */
function ownCoreDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Where the stack's dependency tree lives, in order of preference. */
function stackNodeModules(root: string | undefined, notes: string[]): string | undefined {
  const candidates: string[] = [];
  if (root) {
    const link = readJsonCapped<{ stack?: string }>(join(root, "node_modules", ".protoboard-stack.json"));
    if (link?.stack) candidates.push(join(link.stack, "node_modules"));
    try {
      const core = realpathSync(join(root, "node_modules", "@protoboardai", "core"));
      const nm = enclosingNodeModules(core);
      if (nm) candidates.push(nm);
    } catch {
      // not installed in the project
    }
  }
  const own = ownCoreDir();
  const nm = enclosingNodeModules(own);
  if (nm) candidates.push(nm);
  // a checkout: packages/core → the repository's node_modules
  candidates.push(join(own, "..", "..", "node_modules"));
  for (const c of candidates) {
    try {
      if (statSync(c).isDirectory()) return c;
    } catch {
      // next
    }
  }
  notes.push("no node_modules found for the stack: the npm dependency set is empty");
  return undefined;
}

interface NpmEntry {
  name: string;
  version: string;
  registry: boolean;
  dev?: boolean;
}

/** npm's hidden lockfile: every installed package with its version (links and workspace sources left out). */
export function readHiddenLockfile(nm: string): NpmEntry[] | undefined {
  const file = join(nm, ".package-lock.json");
  const lock = readJsonCapped<{ packages?: Record<string, { version?: string; resolved?: string; link?: boolean; dev?: boolean; name?: string }> }>(file, MAX_LOCK_BYTES);
  if (!lock?.packages) return undefined;
  const out: NpmEntry[] = [];
  for (const [key, v] of Object.entries(lock.packages)) {
    const at = key.lastIndexOf("node_modules/");
    if (at < 0 || v.link) continue; // a workspace source or a link to one
    const name = v.name ?? key.slice(at + "node_modules/".length);
    const version = cleanVersion(v.version);
    if (!NAME.test(name) || !version) continue;
    const registry = typeof v.resolved === "string" ? /^https:\/\/registry\.npmjs\.org\//.test(v.resolved) : true;
    out.push({ name, version, registry, ...(v.dev ? { dev: true } : {}) });
  }
  return out;
}

/**
 * A bounded walk of a node_modules (an installed stack copy has no hidden
 * lockfile): top-level and scoped packages and their nested node_modules.
 * Symbolic links are not followed except for our own scopes (the stack's
 * workspace links), and a package that says `"private": true` is left out.
 */
export function scanNodeModules(nm: string, max = MAX_SCAN_PACKAGES): { entries: NpmEntry[]; truncated: boolean } {
  const out: NpmEntry[] = [];
  let truncated = false;
  const stack: string[] = [nm];
  const seen = new Set<string>();
  while (stack.length) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const full = join(dir, n);
      if (n.startsWith("@")) {
        let inner: string[] = [];
        try {
          inner = readdirSync(full);
        } catch {
          // unreadable scope
        }
        for (const m of inner) visit(`${n}/${m}`, join(full, m));
      } else visit(n, full);
      if (out.length >= max) {
        truncated = true;
        return { entries: out, truncated };
      }
    }
  }
  return { entries: out, truncated };

  function visit(name: string, dir: string) {
    if (!NAME.test(name)) return;
    let link = false;
    try {
      link = lstatSync(dir).isSymbolicLink();
    } catch {
      return;
    }
    if (link && !isOurs(name)) return;
    const pkg = readJsonCapped<{ version?: string; private?: boolean; name?: string }>(join(dir, "package.json"));
    const version = cleanVersion(pkg?.version);
    if (!pkg || !version || pkg.private) return;
    const key = `${name}@${version}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ name, version, registry: !link });
    }
    if (!link) {
      const nested = join(dir, "node_modules");
      if (existsSync(nested)) stack.push(nested);
    }
  }
}

/** The extension's version from the editors' extension folders (names only, newest wins). */
export function discoverExtensionVersion(home = homedir()): string | undefined {
  // `deltarobotics.vscode-protoboard-0.2.2` or a per-platform build `...-0.2.2-win32-x64`
  const re = /^deltarobotics\.vscode-protoboard-(\d+\.\d+\.\d+(?:-(?!(?:win32|linux|darwin|alpine|web))[0-9A-Za-z.]+)?)(?:-(?:win32|linux|darwin|alpine|web)(?:-[a-z0-9]+)?)?$/;
  let best: string | undefined;
  for (const editor of [".vscode", ".vscode-insiders", ".cursor", ".windsurf", ".vscode-oss"]) {
    let names: string[] = [];
    try {
      names = readdirSync(join(home, editor, "extensions"));
    } catch {
      continue;
    }
    for (const n of names) {
      const v = re.exec(n)?.[1];
      if (v && (!best || cmp(v, best) > 0)) best = v;
    }
  }
  return best;
}

/** Plain x.y.z comparison, a prerelease below its release (enough for picking the newest folder). */
function cmp(a: string, b: string): number {
  const p = (s: string) => {
    const [core, pre] = s.split("-", 2);
    return { n: core.split(".").map(Number), pre };
  };
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) - (y.n[i] ?? 0);
  if (x.pre === y.pre) return 0;
  return !x.pre ? 1 : !y.pre ? -1 : x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/** `<python> --version` → `3.12.4`, or undefined. */
function pythonVersion(python: string): string | undefined {
  try {
    const r = spawnSync(python, ["--version"], { encoding: "utf8", timeout: PYTHON_VERSION_TIMEOUT_MS, windowsHide: true });
    return /Python\s+(\d+\.\d+\.\d+\S*)/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`)?.[1];
  } catch {
    return undefined;
  }
}

/** Reads what is installed. Offline, under a second on the drone example (progress.md, W4-A). */
export function readInventory(options: InventoryOptions = {}): Inventory {
  const env = options.env ?? process.env;
  const root = options.root ? resolve(options.root) : undefined;
  const notes: string[] = [];
  const components: InventoryComponent[] = [];
  const add = (c: InventoryComponent) => components.push(c);

  // the stack: the project's links first
  const projectNm = root ? join(root, "node_modules") : undefined;
  const ours = new Map<string, string>();
  let from: Inventory["stack"]["from"] = "this-cli";
  if (projectNm && existsSync(projectNm)) {
    for (const scope of ["@protoboardai", "@deltarobotics"]) {
      let names: string[] = [];
      try {
        names = readdirSync(join(projectNm, scope));
      } catch {
        continue;
      }
      for (const n of names) {
        const v = cleanVersion(versionOf(join(projectNm, scope, n)));
        if (v && NAME.test(`${scope}/${n}`)) ours.set(`${scope}/${n}`, v);
      }
    }
    if (ours.has("@protoboardai/core")) from = "project";
  }
  if (!ours.has("@protoboardai/core")) {
    const own = ownCoreDir();
    const v = cleanVersion(versionOf(own));
    if (v) ours.set("@protoboardai/core", v);
    const cli = cleanVersion(versionOf(join(own, "..", "cli")));
    if (cli) ours.set("@protoboardai/cli", cli);
    if (root) notes.push("the project has no @protoboardai/core in node_modules: the stack listed is the one running this command");
  }
  const linked = projectNm ? readJsonCapped<{ version?: string }>(join(projectNm, ".protoboard-stack.json"))?.version : undefined;
  for (const [name, version] of [...ours].sort(([a], [b]) => a.localeCompare(b))) add({ kind: "npm", name, version, role: roleOf(name), registry: true });

  // the stack's dependency set
  const nm = stackNodeModules(root, notes);
  let dependencySource: Inventory["stack"]["dependencySource"] = "none";
  if (nm) {
    let entries = readHiddenLockfile(nm);
    if (entries) dependencySource = "lockfile";
    else {
      const scan = scanNodeModules(nm);
      entries = scan.entries;
      dependencySource = "scan";
      if (scan.truncated) notes.push(`the node_modules scan stopped at ${MAX_SCAN_PACKAGES} packages`);
    }
    const listed = new Set(components.map((c) => `${c.name}@${c.version}`));
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
      const key = `${e.name}@${e.version}`;
      if (listed.has(key) || isOurs(e.name)) continue; // ours are listed above, from the project's own links
      listed.add(key);
      add({ kind: "npm", name: e.name, version: e.version, role: "dependency", registry: e.registry, ...(e.dev ? { dev: true } : {}) });
    }
  }

  // managed runtimes
  const python: Inventory["python"] = [];
  let runtimes = 0;
  if (root) {
    const toolsJson = join(root, TOOLS_DIR, "tools.json");
    let record: ToolsRecord = { schema: TOOLS_SCHEMA, runtimes: {} };
    try {
      if (existsSync(toolsJson) && statSync(toolsJson).size <= MAX_JSON_BYTES) record = readToolsRecord(root);
      else if (existsSync(toolsJson)) notes.push(`${TOOLS_DIR}/tools.json is over ${MAX_JSON_BYTES} bytes and was not read`);
    } catch {
      // unreadable: no runtimes
    }
    for (const [id, r] of Object.entries(record.runtimes)) {
      runtimes++;
      const pinned = new Set(r.packages.map((p) => (r.kind === "python" ? p.split("==")[0].toLowerCase().replace(/[-_.]+/g, "-") : p.replace(/@[^@]+$/, ""))));
      const iv = cleanVersion(r.interpreter?.version);
      if (r.kind === "python" && iv) python.push({ runtime: id, version: iv });
      add({ kind: "interpreter", name: r.kind === "python" ? "python" : "node", ...(iv ? { version: iv } : {}), role: `runtime:${id}` });
      for (const [name, version] of Object.entries(r.installed ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const v = cleanVersion(version) ?? (typeof version === "string" && /^\d[\w.!+-]*$/.test(version) ? version : undefined);
        if (!v) continue;
        const norm = r.kind === "python" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
        add({ kind: r.kind === "python" ? "pypi" : "npm", name: norm, version: v, role: `runtime:${id}`, registry: true, ...(pinned.has(norm) ? { pinned: true } : {}) });
      }
    }
  }

  // interpreters
  add({ kind: "interpreter", name: "node", version: process.versions.node, role: "interpreter" });
  const pyEnv = env.PROTOBOARD_PYTHON?.trim();
  if (pyEnv && !options.noExec) {
    const v = pythonVersion(pyEnv);
    if (v) {
      python.push({ runtime: "PROTOBOARD_PYTHON", version: v });
      add({ kind: "interpreter", name: "python", version: v, role: "PROTOBOARD_PYTHON" });
    } else notes.push("PROTOBOARD_PYTHON is set but did not answer --version");
  }

  // the VS Code extension
  let vscodeExtension: Inventory["vscodeExtension"];
  const hostV = cleanVersion(options.extensionVersion);
  if (hostV) vscodeExtension = { version: hostV, from: "host" };
  else {
    const found = discoverExtensionVersion(options.home ?? homedir());
    if (found) vscodeExtension = { version: found, from: "editor-folder" };
  }
  if (vscodeExtension) add({ kind: "vscode-extension", name: "deltarobotics.vscode-protoboard", version: vscodeExtension.version, role: "editor" });

  const npm = components.filter((c) => c.kind === "npm");
  return {
    schema: INVENTORY_SCHEMA,
    at: (options.now ?? new Date()).toISOString(),
    stack: { version: ours.get("@protoboardai/core"), cli: ours.get("@protoboardai/cli"), from, ...(linked ? { linked } : {}), dependencySource },
    node: process.versions.node,
    python,
    ...(vscodeExtension ? { vscodeExtension } : {}),
    components,
    counts: { npm: npm.length, pypi: components.filter((c) => c.kind === "pypi").length, registry: components.filter((c) => (c.kind === "npm" || c.kind === "pypi") && c.registry).length, runtimes },
    notes,
  };
}

/** Packages a vulnerability source may be asked about: names and versions only, from the public registries. */
export function queryablePackages(inv: Inventory): { ecosystem: "npm" | "PyPI"; name: string; version: string }[] {
  const out: { ecosystem: "npm" | "PyPI"; name: string; version: string }[] = [];
  const seen = new Set<string>();
  for (const c of inv.components) {
    if ((c.kind !== "npm" && c.kind !== "pypi") || !c.registry || !c.version) continue;
    const ecosystem = c.kind === "npm" ? "npm" : "PyPI";
    const key = `${ecosystem}:${c.name}@${c.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ecosystem, name: c.name, version: c.version });
  }
  return out;
}

/** Text for `protoboard inventory` without --json. */
export function formatInventory(inv: Inventory): string {
  const lines = [
    `stack ${inv.stack.version ?? "unknown"}${inv.stack.cli && inv.stack.cli !== inv.stack.version ? ` (cli ${inv.stack.cli})` : ""}, read from ${inv.stack.from === "project" ? "the project's packages" : "this CLI"}${inv.stack.linked ? `, linked copy ${inv.stack.linked}` : ""}`,
    `node ${inv.node}${inv.python.length ? `; python ${inv.python.map((p) => `${p.version} (${p.runtime})`).join(", ")}` : ""}`,
    `vs code extension ${inv.vscodeExtension ? `${inv.vscodeExtension.version} (${inv.vscodeExtension.from})` : "not found"}`,
  ];
  for (const c of inv.components.filter((x) => x.role !== "dependency" && x.kind !== "interpreter" && x.kind !== "vscode-extension")) lines.push(`  ${c.name.padEnd(36)} ${c.version ?? "?"}  ${c.role}${c.pinned ? " (pinned)" : ""}`);
  lines.push(`${inv.counts.npm} npm packages (dependency set from ${inv.stack.dependencySource}), ${inv.counts.pypi} python packages, ${inv.counts.runtimes} managed runtime(s)`);
  for (const n of inv.notes) lines.push(`note: ${n}`);
  return lines.join("\n");
}

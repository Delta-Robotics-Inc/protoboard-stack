/**
 * System Map builder (docs/specs/system-map.md): reads a stack root (the
 * stack's source repository, or a folder holding an installed stack under
 * node_modules/@protoboardai), enumerates what the stack can do from its own
 * files (package manifests, extension manifests, SKILL.md files, the CLI's
 * help and command switch, the MCP tool specs, the view tabs, templates,
 * example projects, docs), links the items by the references those files
 * make, and asks git which release each item last changed in.
 *
 * Read-only: it never writes, moves or deletes a stack file. The only file
 * `writeSystemMap` writes is the map. Whatever cannot be read or resolved is
 * listed in `problems`; nothing is guessed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { FRAMEWORK_VERSION } from "../extensions.js";
import {
  DISCIPLINES,
  DISCIPLINE_ORDER,
  DISCIPLINE_RULES,
  ITEM_TYPE_ORDER,
  SYSMAP_FILE,
  SYSMAP_SCHEMA,
  byCodeUnit,
  itemId,
  majorityDiscipline,
  stageDiscipline,
  type DisciplineId,
  type ItemStatus,
  type ItemType,
  type LinkKind,
  type SysmapCounts,
  type SysmapIsland,
  type SysmapItem,
  type SysmapLink,
  type SysmapProblem,
  type SysmapRelease,
  type SysmapStage,
  type SystemMap,
} from "./model.js";
import {
  boldIds,
  buildStages,
  bulletLine,
  builtinTabs,
  cliCases,
  cliHelp,
  cliMentions,
  docPaths,
  firstHeading,
  firstParagraph,
  frontmatter,
  importsOf,
  mcpTools,
  mdLines,
  normalize,
  operationMentions,
  releaseSections,
  short,
  specStatus,
  splitCode,
} from "./parse.js";
import { readHistory, runGit, type StackHistory, type SysmapGitRunner } from "./history.js";

// ---------------------------------------------------------------------------
// File access (injectable for tests)
// ---------------------------------------------------------------------------

/** Everything the builder reads through. Nothing here writes. */
export interface SysmapFs {
  /** The entries of a directory (links followed), or null when it is not one. */
  list(abs: string): Promise<{ name: string; dir: boolean }[] | null>;
  /** The bytes of a file and its stat, or null when it cannot be read. */
  read(abs: string): Promise<{ bytes: Buffer; size: number; mtimeMs: number } | null>;
}

export const nodeSysmapFs: SysmapFs = {
  async list(abs) {
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      const out: { name: string; dir: boolean }[] = [];
      for (const e of entries) {
        let dir = e.isDirectory();
        if (e.isSymbolicLink()) {
          try {
            dir = (await stat(join(abs, e.name))).isDirectory();
          } catch {
            continue; // a dangling link
          }
        }
        out.push({ name: e.name, dir });
      }
      return out;
    } catch {
      return null;
    }
  },
  async read(abs) {
    try {
      const st = await stat(abs);
      if (!st.isFile()) return null;
      return { bytes: await readFile(abs), size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  },
};

const sha256 = (bytes: Buffer | string): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// Collection: every file the map is built from
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A package of the stack, as found. */
interface FoundPackage {
  /** Folder, stack-relative ("packages/core", "node_modules/@protoboardai/core"). */
  dir: string;
  name: string;
  json: Json;
  manifest?: Json;
  /** An example project: a workspace folder holding protoboard.config.ts. */
  example: boolean;
}

/** The well-known sources inside packages: where commands, MCP tools and views are defined. */
export const SOURCES = {
  cli: { package: "@protoboardai/cli", commands: "src/index.ts", mcpTools: "src/mcp/tools.ts" },
  views: { package: "@protoboardai/views", tabs: "src/tabs.ts" },
  hub: "build-a-project",
  docSections: ["specs", "guides", "reference"] as const,
  releaseNotes: "docs/releases",
} as const;

export interface Collected {
  root: string;
  layout: "monorepo" | "installed" | null;
  packages: FoundPackage[];
  /** Outside packages (@deltarobotics/*) a stack package depends on, with the installed package.json when there is one. */
  outside: { name: string; dir: string; json: Json | null }[];
  /** Text of every file read, by stack-relative path. */
  text: Map<string, string>;
  /** [path, size, mtimeMs, sha256] of every file read. */
  inputs: Map<string, [string, number, number, string]>;
  /** Top-level entries of the stack root (to tell whether planned folders exist). */
  rootEntries: Set<string>;
  problems: SysmapProblem[];
}

class Reader {
  readonly text = new Map<string, string>();
  readonly inputs = new Map<string, [string, number, number, string]>();
  constructor(
    readonly root: string,
    readonly fs: SysmapFs,
  ) {}
  async read(rel: string): Promise<string | null> {
    if (this.text.has(rel)) return this.text.get(rel)!;
    const r = await this.fs.read(join(this.root, rel));
    if (!r) return null;
    const text = normalize(r.bytes.toString("utf8"));
    this.text.set(rel, text);
    this.inputs.set(rel, [rel, r.size, r.mtimeMs, sha256(r.bytes)]);
    return text;
  }
  async json(rel: string): Promise<{ json: Json } | { error: string } | null> {
    const t = await this.read(rel);
    if (t === null) return null;
    try {
      const j = JSON.parse(t) as unknown;
      return isObj(j) ? { json: j } : { error: "not a JSON object" };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  async list(rel: string): Promise<{ name: string; dir: boolean }[] | null> {
    const l = await this.fs.list(rel ? join(this.root, rel) : this.root);
    return l ? [...l].sort((a, b) => byCodeUnit(a.name, b.name)) : null;
  }
}

/** Workspace patterns ("packages/core", "packages/*") as folders. */
async function expandWorkspaces(reader: Reader, patterns: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of patterns) {
    const clean = p.replace(/\\/g, "/").replace(/\/+$/, "");
    if (clean.endsWith("/*")) {
      const base = clean.slice(0, -2);
      for (const e of (await reader.list(base)) ?? []) if (e.dir) out.push(`${base}/${e.name}`);
    } else out.push(clean);
  }
  return [...new Set(out)].sort(byCodeUnit);
}

/**
 * Reads every file the map is built from. Deterministic: folders are listed
 * in code-unit order. Never throws for a file: what cannot be read is a
 * problem.
 */
export async function collectStack(root: string, fs: SysmapFs = nodeSysmapFs): Promise<Collected> {
  const reader = new Reader(root, fs);
  const problems: SysmapProblem[] = [];
  const rootEntries = new Set(((await reader.list("")) ?? []).map((e) => e.name));
  const rootPkg = await reader.json("package.json");
  let layout: Collected["layout"] = null;
  let dirs: string[] = [];
  if (rootPkg && "json" in rootPkg && Array.isArray(rootPkg.json.workspaces)) {
    layout = "monorepo";
    // the workspaces, and every package under packages/ (the VS Code extension is built apart from them)
    const workspaces = await expandWorkspaces(reader, rootPkg.json.workspaces.filter((w): w is string => typeof w === "string"));
    const conventional: string[] = [];
    for (const e of (await reader.list("packages")) ?? []) if (e.dir && (await fs.read(join(root, "packages", e.name, "package.json")))) conventional.push(`packages/${e.name}`);
    dirs = [...new Set([...workspaces, ...conventional])].sort(byCodeUnit);
  } else if ((await reader.list("node_modules/@protoboardai")) !== null) {
    layout = "installed";
    dirs = ((await reader.list("node_modules/@protoboardai")) ?? []).filter((e) => e.dir).map((e) => `node_modules/@protoboardai/${e.name}`);
  } else {
    problems.push({ reason: "STACK_NOT_FOUND", message: "no stack here: the root's package.json has no workspaces and there is no node_modules/@protoboardai", path: "package.json" });
  }

  const packages: FoundPackage[] = [];
  for (const dir of dirs) {
    const pj = await reader.json(`${dir}/package.json`);
    if (pj === null) {
      problems.push({ reason: "PACKAGE_UNREADABLE", message: `${dir} has no readable package.json`, path: `${dir}/package.json` });
      continue;
    }
    if ("error" in pj) {
      problems.push({ reason: "PACKAGE_UNREADABLE", message: `${dir}/package.json is not valid JSON (${pj.error})`, path: `${dir}/package.json` });
      continue;
    }
    const name = str(pj.json.name);
    if (!name) {
      problems.push({ reason: "PACKAGE_UNREADABLE", message: `${dir}/package.json has no name`, path: `${dir}/package.json` });
      continue;
    }
    const entries = new Set(((await reader.list(dir)) ?? []).map((e) => e.name));
    const found: FoundPackage = { dir, name, json: pj.json, example: layout === "monorepo" && entries.has("protoboard.config.ts") };
    if (entries.has("protoboard-extension.json")) {
      const m = await reader.json(`${dir}/protoboard-extension.json`);
      if (m === null || "error" in m) problems.push({ reason: "MANIFEST_UNREADABLE", message: `${dir}/protoboard-extension.json cannot be read${m && "error" in m ? ` (${m.error})` : ""}`, path: `${dir}/protoboard-extension.json` });
      else found.manifest = m.json;
    }
    if (entries.has("README.md")) await reader.read(`${dir}/README.md`);
    // skill folders, declared or not
    if (entries.has("skills")) for (const e of (await reader.list(`${dir}/skills`)) ?? []) if (e.dir) await reader.read(`${dir}/skills/${e.name}/SKILL.md`);
    // templates
    if (entries.has("templates")) for (const e of (await reader.list(`${dir}/templates`)) ?? []) if (e.dir) await reader.read(`${dir}/templates/${e.name}/template.json`);
    packages.push(found);
  }

  // the well-known sources
  const cli = packages.find((p) => p.name === SOURCES.cli.package);
  if (cli) {
    const index = await reader.read(`${cli.dir}/${SOURCES.cli.commands}`);
    await reader.read(`${cli.dir}/${SOURCES.cli.mcpTools}`);
    // the modules the command switch imports, one level (how `mcp` reaches the tool specs)
    if (index) {
      for (const spec of importsOf(index)) {
        if (!spec.startsWith("./")) continue;
        const rel = posix.normalize(posix.join(posix.dirname(`${cli.dir}/${SOURCES.cli.commands}`), spec.replace(/\.js$/, ".ts")));
        if (rel.startsWith(`${cli.dir}/src/`)) await reader.read(rel);
      }
    }
  }
  const views = packages.find((p) => p.name === SOURCES.views.package);
  if (views) await reader.read(`${views.dir}/${SOURCES.views.tabs}`);

  // packages outside the stack that stack packages depend on, and the skills they ship that manifests declare
  const outsideNames = new Set<string>();
  for (const p of packages) {
    if (p.example) continue;
    for (const dep of Object.keys({ ...(isObj(p.json.dependencies) ? p.json.dependencies : {}), ...(isObj(p.json.peerDependencies) ? p.json.peerDependencies : {}) })) {
      if (dep.startsWith("@deltarobotics/")) outsideNames.add(dep);
    }
    for (const s of arr(p.manifest?.skills)) if (isObj(s) && str(s.package)) outsideNames.add(str(s.package)!);
  }
  const outside: Collected["outside"] = [];
  for (const name of [...outsideNames].sort(byCodeUnit)) {
    if (packages.some((p) => p.name === name)) continue;
    const dir = `node_modules/${name}`;
    const pj = await reader.json(`${dir}/package.json`);
    outside.push({ name, dir, json: pj && "json" in pj ? pj.json : null });
  }
  for (const p of packages) {
    for (const s of arr(p.manifest?.skills)) {
      if (!isObj(s) || !str(s.package)) continue;
      await reader.read(`node_modules/${str(s.package)}/${str(s.path) ?? `skills/${str(s.id)}/SKILL.md`}`);
    }
  }

  // docs and release notes (the stack's source repository only)
  if (layout === "monorepo") {
    for (const section of [...SOURCES.docSections, "releases"]) {
      for (const e of (await reader.list(`docs/${section}`)) ?? []) if (!e.dir && e.name.endsWith(".md")) await reader.read(`docs/${section}/${e.name}`);
    }
  }

  return { root, layout, packages, outside, text: reader.text, inputs: reader.inputs, rootEntries, problems };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** What history compares for an item: whole files, folders, and entries inside a file. */
interface Track {
  files: string[];
  dirs: string[];
  entries: { file: string; key: string }[];
  /** Whether the item exists at a release is told by its entries, or by its first file. */
  exists: "entries" | "files";
}

/** An item while it is assembled. */
interface Draft extends Omit<SysmapItem, "degree" | "discipline" | "disciplineFrom" | "status" | "changed"> {
  discipline: DisciplineId | null;
  disciplineFrom: SysmapItem["disciplineFrom"];
  status: ItemStatus;
  changed: SysmapItem["changed"];
  track?: Track;
  /** The extension item it belongs to. */
  ext?: string;
  /** Text references are read from (SKILL.md, a doc). */
  refText?: { path: string; text: string };
  /** A discipline the manifest declares. */
  declared?: string;
}

export interface SysmapBuildOptions {
  fs?: SysmapFs;
  git?: SysmapGitRunner;
  /** The stack version recorded (default: this stack's FRAMEWORK_VERSION). */
  stack?: string;
  /** false: do not read git (status from the files alone, no `changed`). */
  history?: boolean;
}

/** Keys of the entries history compares, by the file that holds them. */
function manifestEntries(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text === null) return out;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return out;
  }
  if (!isObj(m)) return out;
  const put = (key: string, v: unknown) => out.set(key, JSON.stringify(v));
  for (const s of arr(m.skills)) if (isObj(s) && str(s.id)) put(`skill:${s.id}`, s);
  for (const t of arr(m.tools)) if (isObj(t) && str(t.id)) put(`tool:${t.id}`, t);
  for (const c of arr(m.capabilities)) {
    if (!isObj(c) || !str(c.id)) continue;
    put(`cap:${c.id}`, { ...c, operations: Object.keys(isObj(c.operations) ? c.operations : {}) });
    for (const [k, v] of Object.entries(isObj(c.operations) ? c.operations : {})) put(`capop:${c.id}:${k}`, v);
  }
  for (const o of arr(m.operations)) if (isObj(o) && str(o.id)) put(`op:${o.id}`, o);
  for (const c of arr(m.checks)) if (isObj(c) && str(c.id)) put(`check:${c.id}`, c);
  return out;
}

function cliEntries(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text === null) return out;
  for (const [k, v] of cliCases(text) ?? new Map()) out.set(`case:${k}`, v.trim());
  for (const [k, v] of cliHelp(text)) out.set(`help:${k}`, JSON.stringify(v));
  return out;
}

function mcpEntries(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text !== null) for (const t of mcpTools(text)) out.set(`tool:${t.name}`, t.block.trim());
  return out;
}

function tabEntries(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text !== null) for (const t of builtinTabs(text) ?? []) out.set(`view:${t.id}`, t.block.trim());
  return out;
}

/** Builds the System Map of the stack at `root`. */
export async function buildSystemMap(root: string, options: SysmapBuildOptions = {}): Promise<SystemMap> {
  const c = await collectStack(root, options.fs ?? nodeSysmapFs);
  const problems: SysmapProblem[] = [...c.problems];
  const items = new Map<string, Draft>();
  const linkMap = new Map<string, SysmapLink>();
  const text = (p: string) => c.text.get(p) ?? null;

  const add = (d: Omit<Draft, "discipline" | "disciplineFrom" | "status" | "changed" | "stage"> & Partial<Pick<Draft, "status" | "stage">>): Draft | undefined => {
    if (items.has(d.id)) {
      problems.push({ reason: "DUPLICATE_ID", message: `${d.id} is defined twice: in ${items.get(d.id)!.source} and in ${d.source}; the first is kept`, path: d.source.split("#")[0], item: d.id });
      return undefined;
    }
    const draft: Draft = { stage: null, discipline: null, disciplineFrom: "none", status: "released", changed: null, ...d };
    items.set(d.id, draft);
    return draft;
  };
  const link = (from: string, to: string, kind: LinkKind, via: string) => {
    if (from === to || !items.has(from) || !items.has(to)) return;
    const key = `${from}\0${to}\0${kind}`;
    if (!linkMap.has(key)) linkMap.set(key, { from, to, kind, via });
  };
  const problem = (p: SysmapProblem) => problems.push(p);
  // references resolved once everything they can point to exists
  const pendingRequires: { from: string; tool: string; via: string }[] = [];
  const pendingDerived: { template: string; dir: string; via: string }[] = [];
  const pendingCites: { from: string; doc: string; via: string }[] = [];
  const requireLink = (from: string, r: unknown, via: string) => {
    if (typeof r === "string") pendingRequires.push({ from, tool: r, via });
  };
  const citeDoc = (from: string, doc: string, via: string) => {
    if (c.layout !== "monorepo" || !/^docs\/(specs|guides|reference)\//.test(doc)) return;
    if (items.has(itemId("doc", doc))) link(from, itemId("doc", doc), "cites", via);
    else pendingCites.push({ from, doc, via });
  };

  // ---- packages (not extensions, not examples) ----
  const pkgVersion = new Map<string, string>();
  for (const p of c.packages) {
    const version = str(p.json.version);
    if (version) pkgVersion.set(p.name, version);
    if (p.manifest || p.example) continue;
    add({
      id: itemId("package", p.name),
      type: "package",
      name: p.name,
      version: version ?? null,
      versionFrom: version ? "own" : "none",
      purpose: short(str(p.json.description)),
      ...(str(p.json.description) && short(str(p.json.description)) !== str(p.json.description) ? { detail: str(p.json.description) } : {}),
      source: `${p.dir}/package.json`,
      package: p.name,
      ...(p.json.private === true ? { facts: { private: true } } : {}),
      track: { files: [`${p.dir}/package.json`], dirs: [p.dir], entries: [], exists: "files" },
    });
    if (!version) problem({ reason: "VERSION_MISSING", message: `${p.name} has no version in its package.json`, path: `${p.dir}/package.json`, item: itemId("package", p.name) });
  }
  // the toolchain pins the core package records (protoboard.toolchain: { uhd: "0.3.1" })
  const pins = new Map<string, { pin: string; from: string }>();
  for (const p of c.packages) {
    const tc = isObj(p.json.protoboard) && isObj(p.json.protoboard.toolchain) ? p.json.protoboard.toolchain : undefined;
    if (tc) for (const [k, v] of Object.entries(tc)) if (typeof v === "string") pins.set(k, { pin: v, from: `${p.dir}/package.json` });
  }
  for (const o of c.outside) {
    const version = o.json ? str(o.json.version) : undefined;
    const pin = pins.get(o.name.split("/").pop()!);
    const id = itemId("package", o.name);
    add({
      id,
      type: "package",
      name: o.name,
      version: version ?? null,
      versionFrom: version ? "installed" : "none",
      purpose: short(o.json ? str(o.json.description) : undefined),
      source: o.json ? `${o.dir}/package.json` : `${o.dir}/package.json (not installed)`,
      package: o.name,
      status: "outside",
      ...(pin ? { facts: { pinned: pin.pin } } : {}),
    });
    if (!o.json) problem({ reason: "OUTSIDE_NOT_INSTALLED", message: `${o.name} is used by the stack but not installed at ${o.dir}: its version and description are unknown`, path: `${o.dir}/package.json`, item: id });
    else if (pin && version && pin.pin !== version) problem({ reason: "OUTSIDE_VERSION_DRIFT", message: `${o.name} ${version} is installed; ${pin.from} pins ${pin.pin}`, path: pin.from, item: id });
  }

  // ---- extensions and what their manifests declare ----
  const tools = new Map<string, { draft: Draft; versions: Map<string, string> }>();
  const capProviders = new Map<string, string[]>();
  for (const p of c.packages) {
    const m = p.manifest;
    if (!m) continue;
    const mPath = `${p.dir}/protoboard-extension.json`;
    const extName = str(m.id);
    if (!extName) {
      problem({ reason: "MANIFEST_INVALID", message: `${mPath} has no id`, path: mPath });
      continue;
    }
    if (extName !== p.name) problem({ reason: "MANIFEST_INVALID", message: `${mPath} has id ${extName}, its package is ${p.name}`, path: mPath });
    const mVersion = str(m.version);
    const pVersion = str(p.json.version);
    if (mVersion && pVersion && mVersion !== pVersion) problem({ reason: "VERSION_MISMATCH", message: `${extName}: the manifest says ${mVersion}, package.json ${pVersion}`, path: mPath });
    const version = mVersion ?? pVersion ?? null;
    const ext = itemId("extension", extName);
    const pdesc = str(p.json.description)?.replace(/^Protoboard extension:\s*/i, "");
    add({
      id: ext,
      type: "extension",
      name: extName,
      version,
      versionFrom: mVersion ? "own" : pVersion ? "package" : "none",
      purpose: short(pdesc ?? str(m.description)),
      ...(str(m.description) ? { detail: str(m.description) } : {}),
      source: mPath,
      package: p.name,
      ...(isObj(m.compatibility) && str(m.compatibility.protoboard) ? { facts: { protoboard: str(m.compatibility.protoboard)! } } : {}),
      track: { files: [mPath], dirs: [p.dir], entries: [], exists: "files" },
      ...(str(m.discipline) ? { declared: str(m.discipline) } : {}),
    });
    const entry = (key: string) => ({ file: mPath, key });
    const own = { version, versionFrom: (version ? "manifest" : "none") as SysmapItem["versionFrom"], package: p.name, ext };

    // skills
    const declaredFolders = new Set<string>();
    for (const s of arr(m.skills)) {
      if (!isObj(s) || !str(s.id)) {
        problem({ reason: "MANIFEST_INVALID", message: `${mPath}: a skill without an id`, path: mPath });
        continue;
      }
      const sid = str(s.id)!;
      const rel = str(s.path) ?? `skills/${sid}/SKILL.md`;
      const shipper = str(s.package);
      const file = shipper ? `node_modules/${shipper}/${rel}` : `${p.dir}/${rel}`;
      if (!shipper) declaredFolders.add(posix.dirname(rel));
      const md = text(file);
      const fm = md !== null ? frontmatter(md) : null;
      const shipperPkg = shipper ? c.outside.find((o) => o.name === shipper) : undefined;
      const sVersion = fm?.fields.version ?? (shipper ? (shipperPkg?.json ? str(shipperPkg.json.version) : undefined) : version ?? undefined);
      const summary = str(s.summary) ?? fm?.fields.description;
      const d = add({
        id: itemId("skill", sid),
        type: "skill",
        name: sid,
        version: sVersion ?? null,
        versionFrom: fm?.fields.version ? "own" : sVersion ? (shipper ? "installed" : "manifest") : "none",
        purpose: short(summary),
        ...(summary && short(summary) !== summary ? { detail: summary } : {}),
        source: md !== null ? file : `${mPath}#skills/${sid}`,
        package: shipper ?? p.name,
        ext,
        ...(shipper ? { status: "outside" as const } : {}),
        facts: { file, ...(str(s.verifiedBy) ? { verifiedBy: str(s.verifiedBy)! } : {}) },
        ...(md !== null ? { refText: { path: file, text: fm?.body ?? md } } : {}),
        ...(shipper ? {} : { track: { files: [file], dirs: [posix.dirname(file)], entries: [entry(`skill:${sid}`)], exists: "entries" as const } }),
        ...(str(s.discipline) ? { declared: str(s.discipline) } : {}),
      });
      if (!d) continue;
      if (md === null) problem({ reason: "SKILL_FILE_MISSING", message: `${extName} declares the skill ${sid} at ${file}, which cannot be read`, path: file, item: d.id });
      else if (!fm) problem({ reason: "FRONTMATTER_MISSING", message: `${file} has no frontmatter (name, description)`, path: file, item: d.id });
      else if (fm.fields.name !== sid) problem({ reason: "SKILL_NAME_MISMATCH", message: `${file} is named ${JSON.stringify(fm.fields.name ?? null)}; ${extName} declares it as ${sid}`, path: file, item: d.id });
    }
    for (const [path] of c.inputs) {
      const m2 = new RegExp(`^${p.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(skills/[^/]+)/SKILL\\.md$`).exec(path);
      if (m2 && !declaredFolders.has(m2[1])) problem({ reason: "SKILL_UNDECLARED", message: `${path} is not declared in ${mPath}, so it is never installed`, path });
    }

    // tools
    for (const t of arr(m.tools)) {
      if (!isObj(t) || !str(t.id)) continue;
      const tid = str(t.id)!;
      const pinsOf = isObj(t.runtime) ? arr(t.runtime.packages).filter((x): x is string => typeof x === "string") : [];
      const tVersion = pinsOf.length ? pinsOf.map((x) => x.replace(/==/, " ")).join(", ") : undefined;
      const known = tools.get(tid);
      if (known) {
        known.versions.set(extName, tVersion ?? "");
        link(ext, known.draft.id, "needs", mPath);
        continue;
      }
      const d = add({
        id: itemId("tool", tid),
        type: "tool",
        name: tid,
        version: tVersion ?? null,
        versionFrom: tVersion ? "own" : "none",
        purpose: short(str(t.purpose)),
        ...(str(t.purpose) && short(str(t.purpose)) !== str(t.purpose) ? { detail: str(t.purpose) } : {}),
        source: `${mPath}#tools/${tid}`,
        ...(str(t.install) ? { facts: { install: str(t.install)! } } : {}),
        track: { files: [], dirs: [], entries: [entry(`tool:${tid}`)], exists: "entries" },
      });
      if (d) {
        tools.set(tid, { draft: d, versions: new Map([[extName, tVersion ?? ""]]) });
        link(ext, d.id, "needs", mPath);
      }
    }

    // capabilities and their operations
    for (const cap of arr(m.capabilities)) {
      if (!isObj(cap) || !str(cap.id)) continue;
      const cid = str(cap.id)!;
      const capItem = itemId("capability", cid);
      if (!items.has(capItem)) {
        add({ id: capItem, type: "capability", name: cid, version: null, versionFrom: "none", purpose: "", source: `${mPath}#capabilities/${cid}`, track: { files: [], dirs: [], entries: [], exists: "entries" } });
      }
      items.get(capItem)!.track!.entries.push(entry(`cap:${cid}`));
      capProviders.set(cid, [...(capProviders.get(cid) ?? []), extName]);
      link(ext, capItem, "provides", mPath);
      for (const [opId, op] of Object.entries(isObj(cap.operations) ? cap.operations : {})) {
        if (!isObj(op)) continue;
        const summary = str(op.summary);
        const d = add({
          id: itemId("capability-operation", `${extName}#${cid}:${opId}`),
          type: "capability-operation",
          name: `${cid}:${opId}`,
          ...own,
          purpose: short(summary),
          ...(summary && short(summary) !== summary ? { detail: summary } : {}),
          source: `${mPath}#capabilities/${cid}/operations/${opId}`,
          facts: {
            ...(str(cap.native) ? { native: str(cap.native)! } : {}),
            ...(str(op.effect) ? { effect: str(op.effect)! } : {}),
            ...(/human decision/i.test(summary ?? "") ? { human: true } : {}),
          },
          track: { files: [], dirs: [], entries: [entry(`capop:${cid}:${opId}`)], exists: "entries" },
          ...(str(op.discipline) ? { declared: str(op.discipline) } : {}),
        });
        if (!d) continue;
        link(ext, d.id, "ships", mPath);
        link(d.id, capItem, "operation-of", mPath);
        for (const r of arr(op.requires)) requireLink(d.id, r, mPath);
      }
    }
    for (const o of arr(m.operations)) {
      if (!isObj(o) || !str(o.id)) continue;
      const oid = str(o.id)!;
      const summary = str(o.summary);
      const d = add({
        id: itemId("operation", `${extName}#${oid}`),
        type: "operation",
        name: oid,
        ...own,
        purpose: short(summary),
        ...(summary && short(summary) !== summary ? { detail: summary } : {}),
        source: `${mPath}#operations/${oid}`,
        ...(str(o.effect) ? { facts: { effect: str(o.effect)! } } : {}),
        track: { files: [], dirs: [], entries: [entry(`op:${oid}`)], exists: "entries" },
        ...(str(o.discipline) ? { declared: str(o.discipline) } : {}),
      });
      if (!d) continue;
      link(ext, d.id, "ships", mPath);
      for (const r of arr(o.requires)) requireLink(d.id, r, mPath);
    }
    for (const ch of arr(m.checks)) {
      if (!isObj(ch) || !str(ch.id)) continue;
      const kid = str(ch.id)!;
      const summary = str(ch.summary);
      const d = add({
        id: itemId("check", `${extName}#${kid}`),
        type: "check",
        name: kid,
        ...own,
        purpose: short(summary),
        ...(summary && short(summary) !== summary ? { detail: summary } : {}),
        source: `${mPath}#checks/${kid}`,
        track: { files: [], dirs: [], entries: [entry(`check:${kid}`)], exists: "entries" },
        ...(str(ch.discipline) ? { declared: str(ch.discipline) } : {}),
      });
      if (d) link(ext, d.id, "ships", mPath);
    }
  }
  // `requires` names tools of any extension: resolved once every manifest is read
  for (const r of pendingRequires) {
    if (tools.has(r.tool)) link(r.from, itemId("tool", r.tool), "needs", r.via);
    else problem({ reason: "REFERENCE_UNRESOLVED", message: `${r.from} requires the tool ${r.tool}, which no manifest declares`, path: r.via, item: r.from });
  }
  for (const [tid, t] of tools) {
    const distinct = new Set(t.versions.values());
    if (distinct.size > 1) problem({ reason: "VERSION_MISMATCH", message: `the tool ${tid} is declared with different pins: ${[...t.versions].map(([e, v]) => `${e}: ${v || "none"}`).join("; ")}`, item: t.draft.id });
  }
  for (const [cid, providers] of capProviders) {
    const d = items.get(itemId("capability", cid))!;
    d.purpose = `The ${cid} capability, provided by ${providers.join(", ")}`;
  }
  // skills shipped by a package and declared by an extension; verifiedBy pairs
  for (const d of [...items.values()].filter((x) => x.type === "skill")) {
    const shipper = d.package && d.status === "outside" ? itemId("package", d.package) : undefined;
    if (shipper && items.has(shipper)) {
      link(shipper, d.id, "ships", d.facts!.file as string);
      link(d.ext!, d.id, "declares", items.get(d.ext!)!.source);
    } else link(d.ext!, d.id, "ships", items.get(d.ext!)!.source);
    const vb = d.facts?.verifiedBy;
    if (typeof vb === "string") {
      if (items.has(itemId("skill", vb))) link(d.id, itemId("skill", vb), "verified-by", items.get(d.ext!)!.source);
      else problem({ reason: "REFERENCE_UNRESOLVED", message: `${d.id} is verified by ${vb}, which no extension declares`, path: items.get(d.ext!)!.source, item: d.id });
    }
  }

  // ---- CLI commands ----
  const cliPkg = c.packages.find((p) => p.name === SOURCES.cli.package);
  const cliFile = cliPkg ? `${cliPkg.dir}/${SOURCES.cli.commands}` : undefined;
  const mcpFile = cliPkg ? `${cliPkg.dir}/${SOURCES.cli.mcpTools}` : undefined;
  const cliBlocks = new Map<string, string>();
  if (cliPkg && cliFile) {
    const src = text(cliFile);
    const cases = src !== null ? cliCases(src) : null;
    const help = src !== null ? cliHelp(src) : new Map();
    if (!cases) problem({ reason: "SOURCE_UNPARSED", message: `no \`switch (command)\` in ${cliFile}: no CLI commands are listed`, path: cliFile });
    else {
      const cliVersion = pkgVersion.get(cliPkg.name) ?? null;
      for (const [name, block] of [...cases].sort((a, b) => byCodeUnit(a[0], b[0]))) {
        const h = help.get(name);
        if (!h) problem({ reason: "CLI_UNDOCUMENTED", message: `protoboard ${name} is a command in ${cliFile} with no line in its help text`, path: cliFile, item: itemId("cli-command", name) });
        const d = add({
          id: itemId("cli-command", name),
          type: "cli-command",
          name: `protoboard ${name}`,
          version: cliVersion,
          versionFrom: cliVersion ? "package" : "none",
          purpose: short(h?.description),
          ...(h?.description && short(h.description) !== h.description ? { detail: h.description } : {}),
          source: `${cliFile}#case:${name}`,
          package: cliPkg.name,
          ...(h ? { facts: { forms: h.forms } } : {}),
          track: { files: [], dirs: [], entries: [{ file: cliFile, key: `case:${name}` }, { file: cliFile, key: `help:${name}` }], exists: "entries" },
        });
        if (!d) continue;
        cliBlocks.set(d.id, block);
        link(itemId("package", cliPkg.name), d.id, "ships", cliFile);
      }
      for (const name of [...help.keys()].sort(byCodeUnit)) {
        if (!cases.has(name)) problem({ reason: "CLI_HELP_ORPHAN", message: `the help text of ${cliFile} lists protoboard ${name}, which the command switch does not handle`, path: cliFile });
      }
    }
  }

  // ---- MCP tools ----
  if (cliPkg && mcpFile) {
    const src = text(mcpFile);
    const specs = src !== null ? mcpTools(src) : [];
    if (src !== null && !specs.length) problem({ reason: "SOURCE_UNPARSED", message: `no tool specs (name, title) found in ${mcpFile}`, path: mcpFile });
    const cliVersion = pkgVersion.get(cliPkg.name) ?? null;
    for (const t of specs) {
      const d = add({
        id: itemId("mcp-tool", t.name),
        type: "mcp-tool",
        name: t.name,
        version: cliVersion,
        versionFrom: cliVersion ? "package" : "none",
        purpose: short(t.title),
        ...(t.description ? { detail: t.description } : {}),
        source: `${mcpFile}#tool:${t.name}`,
        package: cliPkg.name,
        track: { files: [], dirs: [], entries: [{ file: mcpFile, key: `tool:${t.name}` }], exists: "entries" },
      });
      if (!d) continue;
      link(itemId("package", cliPkg.name), d.id, "ships", mcpFile);
      for (const cmd of t.commands) {
        if (items.has(itemId("cli-command", cmd))) link(d.id, itemId("cli-command", cmd), "wraps", mcpFile);
        else problem({ reason: "REFERENCE_UNRESOLVED", message: `the MCP tool ${t.name} runs protoboard ${cmd}, which the CLI does not have`, path: mcpFile, item: d.id });
      }
      for (const doc of docPaths(t.block)) citeDoc(d.id, doc, mcpFile);
    }
    // the command whose block imports the module that serves the tool specs
    for (const [cmdId, block] of cliBlocks) {
      for (const spec of importsOf(block)) {
        if (!spec.startsWith("./")) continue;
        const rel = posix.normalize(posix.join(posix.dirname(cliFile!), spec.replace(/\.js$/, ".ts")));
        const served = rel === mcpFile || (text(rel) !== null && importsOf(text(rel)!).some((s) => s.startsWith("./") && posix.normalize(posix.join(posix.dirname(rel), s.replace(/\.js$/, ".ts"))) === mcpFile));
        if (served) for (const t of specs) link(cmdId, itemId("mcp-tool", t.name), "serves", rel);
      }
    }
  }

  // ---- views ----
  const viewsPkg = c.packages.find((p) => p.name === SOURCES.views.package);
  if (viewsPkg) {
    const file = `${viewsPkg.dir}/${SOURCES.views.tabs}`;
    const src = text(file);
    const tabs = src !== null ? builtinTabs(src) : null;
    if (!tabs) problem({ reason: "SOURCE_UNPARSED", message: `no BUILTIN_TABS array in ${file}: no views are listed`, path: file });
    const vVersion = pkgVersion.get(viewsPkg.name) ?? null;
    for (const t of tabs ?? []) {
      const d = add({
        id: itemId("view", t.id),
        type: "view",
        name: `${t.title} view`,
        version: vVersion,
        versionFrom: vVersion ? "package" : "none",
        purpose: short(t.description),
        source: `${file}#view:${t.id}`,
        package: viewsPkg.name,
        track: { files: [], dirs: [], entries: [{ file, key: `view:${t.id}` }], exists: "entries" },
      });
      if (d) link(itemId("package", viewsPkg.name), d.id, "ships", file);
    }
  }

  // ---- templates ----
  for (const p of c.packages) {
    const prefix = `${p.dir}/templates/`;
    for (const [path] of [...c.inputs].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^/]+)/template\\.json$`).exec(path);
      if (!m) continue;
      let j: unknown;
      try {
        j = JSON.parse(text(path)!);
      } catch (e) {
        problem({ reason: "MANIFEST_INVALID", message: `${path} is not valid JSON (${(e as Error).message})`, path });
        continue;
      }
      if (!isObj(j)) continue;
      const v = pkgVersion.get(p.name) ?? null;
      const d = add({
        id: itemId("template", m[1]),
        type: "template",
        name: `${m[1]} template`,
        version: v,
        versionFrom: v ? "package" : "none",
        purpose: short(str(j.title)),
        ...(str(j.description) ? { detail: str(j.description) } : {}),
        source: path,
        package: p.name,
        track: { files: [path], dirs: [`${p.dir}/templates/${m[1]}`], entries: [], exists: "files" },
      });
      if (!d) continue;
      link(itemId(p.manifest ? "extension" : "package", p.name), d.id, "ships", path);
      for (const e of arr(j.extensions)) {
        if (typeof e !== "string") continue;
        if (items.has(itemId("extension", e))) link(d.id, itemId("extension", e), "installs", path);
        else problem({ reason: "REFERENCE_UNRESOLVED", message: `the ${m[1]} template installs ${e}, which is not in the stack`, path, item: d.id });
      }
      const from = str(j.derivedFrom);
      if (from) pendingDerived.push({ template: d.id, dir: from.replace(/\/+$/, ""), via: path });
    }
  }

  // ---- example projects ----
  for (const p of c.packages.filter((x) => x.example)) {
    const id = itemId("example", p.dir.split("/").pop()!);
    const version = str(p.json.version);
    const readme = text(`${p.dir}/README.md`);
    const purpose = str(p.json.description) ?? (readme ? firstParagraph(readme) : undefined);
    const d = add({
      id,
      type: "example",
      name: p.dir.split("/").pop()!,
      version: version ?? null,
      versionFrom: version ? "own" : "none",
      purpose: short(purpose?.replace(/^Protoboard reference project:\s*/i, "Reference project: ")),
      source: `${p.dir}/package.json`,
      package: p.name,
      track: { files: [`${p.dir}/package.json`], dirs: [p.dir], entries: [], exists: "files" },
    });
    if (!d) continue;
    if (!version) problem({ reason: "VERSION_MISSING", message: `the example ${d.name} has no version in its package.json`, path: `${p.dir}/package.json`, item: id });
    const deps = { ...(isObj(p.json.dependencies) ? p.json.dependencies : {}), ...(isObj(p.json.devDependencies) ? p.json.devDependencies : {}), ...(isObj(p.json.peerDependencies) ? p.json.peerDependencies : {}) };
    for (const dep of Object.keys(deps).sort(byCodeUnit)) {
      const to = items.has(itemId("extension", dep)) ? itemId("extension", dep) : itemId("package", dep);
      link(id, to, "uses", `${p.dir}/package.json`);
    }
  }
  for (const r of pendingDerived) {
    const ex = c.packages.find((p) => p.example && p.dir === r.dir);
    if (ex) link(r.template, itemId("example", ex.dir.split("/").pop()!), "derived-from", r.via);
    else if (c.layout === "monorepo") problem({ reason: "REFERENCE_UNRESOLVED", message: `${r.template} is derived from ${r.dir}, which is not an example project of the stack`, path: r.via, item: r.template });
  }

  // ---- dependencies between stack packages ----
  for (const p of c.packages) {
    if (p.example) continue;
    const from = itemId(p.manifest ? "extension" : "package", p.name);
    if (!items.has(from)) continue;
    const deps = { ...(isObj(p.json.dependencies) ? p.json.dependencies : {}), ...(isObj(p.json.peerDependencies) ? p.json.peerDependencies : {}) };
    for (const dep of Object.keys(deps).sort(byCodeUnit)) {
      const to = items.has(itemId("extension", dep)) ? itemId("extension", dep) : itemId("package", dep);
      link(from, to, "depends-on", `${p.dir}/package.json`);
    }
    const readme = text(`${p.dir}/README.md`);
    if (readme) for (const doc of docPaths(readme)) citeDoc(from, doc, `${p.dir}/README.md`);
  }

  // ---- docs ----
  if (c.layout === "monorepo") {
    let any = false;
    for (const [path, t] of [...c.text].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      const m = /^docs\/(specs|guides|reference)\/([^/]+)\.md$/.exec(path);
      if (!m) continue;
      any = true;
      const status = specStatus(t);
      add({
        id: itemId("doc", path),
        type: "doc",
        name: firstHeading(t) ?? m[2],
        version: null,
        versionFrom: "none",
        purpose: short(firstParagraph(t)),
        source: path,
        facts: { section: m[1], ...(status ? { specStatus: status } : {}) },
        refText: { path, text: t },
        track: { files: [path], dirs: [], entries: [], exists: "files" },
      });
    }
    if (!any) problem({ reason: "DOCS_ABSENT", message: "the stack has no docs/specs, docs/guides or docs/reference" });
  }

  // ---- references in skills and docs ----
  const cmdIds = new Set([...items.values()].filter((d) => d.type === "cli-command").map((d) => d.id.slice(4)));
  const mcpNames = new Set([...items.values()].filter((d) => d.type === "mcp-tool").map((d) => d.name));
  const skillIds = new Set([...items.values()].filter((d) => d.type === "skill").map((d) => d.name));
  const opsById = new Map<string, Draft[]>();
  const capOps = new Map<string, Draft[]>();
  for (const d of items.values()) {
    if (d.type === "operation") opsById.set(d.name, [...(opsById.get(d.name) ?? []), d]);
    if (d.type === "capability-operation") capOps.set(d.name, [...(capOps.get(d.name) ?? []), d]);
  }
  const capIds = new Set(capProviders.keys());
  /** An operation named in a text: the one of the item's own extension, else the only one; a capability operation many providers have resolves to the capability. */
  const resolveOp = (from: Draft, ref: string, qualified: boolean): { to?: string; problem?: SysmapProblem } => {
    const cap = qualified ? ref.split(":")[0] : undefined;
    if (cap && cap !== "package" && !capIds.has(cap)) return {}; // not an operation reference ("node:fs")
    const pool = cap && cap !== "package" ? capOps.get(ref) ?? [] : opsById.get(ref) ?? [];
    if (!pool.length) {
      if (cap && cap !== "package" && capIds.has(cap)) return { problem: { reason: "REFERENCE_UNRESOLVED", message: `${from.refText!.path} names ${ref}; no provider of ${cap} has that operation`, path: from.refText!.path, item: from.id } };
      if (!cap && !qualified) return { problem: { reason: "REFERENCE_UNRESOLVED", message: `${from.refText!.path} runs the operation ${ref}, which no extension declares`, path: from.refText!.path, item: from.id } };
      if (cap === "package") return { problem: { reason: "REFERENCE_UNRESOLVED", message: `${from.refText!.path} names ${ref}, which no extension declares`, path: from.refText!.path, item: from.id } };
      return {};
    }
    const mine = pool.filter((o) => o.ext && o.ext === from.ext);
    if (mine.length === 1) return { to: mine[0].id };
    if (pool.length === 1) return { to: pool[0].id };
    if (cap && cap !== "package") return { to: itemId("capability", cap) };
    return { problem: { reason: "REFERENCE_AMBIGUOUS", message: `${from.refText!.path} runs ${ref}, which ${pool.map((o) => o.ext!.slice(4)).join(", ")} all declare; none is linked`, path: from.refText!.path, item: from.id } };
  };
  const skills = [...items.values()].filter((d) => d.type === "skill" && d.refText).sort((a, b) => byCodeUnit(a.id, b.id));
  for (const s of skills) {
    const { path, text: body } = s.refText!;
    const { code, prose } = splitCode(body);
    for (const b of boldIds(prose)) if (skillIds.has(b) && b !== s.name) link(s.id, itemId("skill", b), "refers-to", path);
    for (const piece of code) {
      for (const cmd of cliMentions(piece)) {
        if (cmdIds.has(cmd)) link(s.id, itemId("cli-command", cmd), "runs-command", path);
        else if (cmdIds.size) problems.push({ reason: "REFERENCE_UNRESOLVED", message: `${path} runs protoboard ${cmd}, which the CLI does not have`, path, item: s.id });
      }
      const runPlain = [...piece.matchAll(/\b(?:protoboard|pb)\s+run\s+([a-z][\w-]*)(?![\w:-])/g)].map((m) => m[1]);
      for (const ref of runPlain) {
        const r = resolveOp(s, ref, false);
        if (r.to) link(s.id, r.to, "runs", path);
        if (r.problem) problems.push(r.problem);
      }
      if (mcpNames.has(piece.trim())) link(s.id, itemId("mcp-tool", piece.trim()), "calls", path);
    }
    // `<capability>:<operation>` is unambiguous syntax: read from the whole file, its description and prose included
    for (const ref of operationMentions(text(path) ?? body).qualified) {
      const r = resolveOp(s, ref, true);
      if (r.to) link(s.id, r.to, "runs", path);
      if (r.problem) problems.push(r.problem);
    }
    for (const doc of docPaths(body)) citeDoc(s.id, doc, path);
  }
  for (const r of pendingCites) {
    if (items.has(itemId("doc", r.doc))) link(r.from, itemId("doc", r.doc), "cites", r.via);
    else problems.push({ reason: "REFERENCE_UNRESOLVED", message: `${r.via} cites ${r.doc}, which is not in the stack`, path: r.via, item: r.from });
  }
  const extNames = new Map([...items.values()].filter((d) => d.type === "extension" || d.type === "package").map((d) => [d.name, d.id]));
  for (const d of [...items.values()].filter((x) => x.type === "doc").sort((a, b) => byCodeUnit(a.id, b.id))) {
    const { path, text: body } = d.refText!;
    const { code, prose } = splitCode(body);
    for (const b of boldIds(prose)) if (skillIds.has(b)) link(d.id, itemId("skill", b), "mentions", path);
    for (const piece of code) {
      const p = piece.trim();
      if (skillIds.has(p)) link(d.id, itemId("skill", p), "mentions", path);
      if (mcpNames.has(p)) link(d.id, itemId("mcp-tool", p), "mentions", path);
      if (extNames.has(p)) link(d.id, extNames.get(p)!, "mentions", path);
      for (const cmd of cliMentions(piece)) if (cmdIds.has(cmd)) link(d.id, itemId("cli-command", cmd), "mentions", path);
    }
    // relative markdown links to other docs ([x](tool-integrations.md), [y](../reference/display.md))
    for (const m of prose.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1]) || m[1].startsWith("/")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), m[1]));
      if (target !== path && items.has(itemId("doc", target))) link(d.id, itemId("doc", target), "cites", path);
    }
    for (const doc of docPaths(body)) {
      if (doc === path) continue;
      if (items.has(itemId("doc", doc))) link(d.id, itemId("doc", doc), "cites", path);
      else problems.push({ reason: "REFERENCE_UNRESOLVED", message: `${path} cites ${doc}, which is not in the stack`, path, item: d.id });
    }
  }
  // the command blocks' own citations
  for (const [id, block] of cliBlocks) for (const doc of docPaths(block)) if (items.has(itemId("doc", doc))) link(id, itemId("doc", doc), "cites", cliFile!);

  // ---- stages (build-a-project) ----
  // An item's stage is the stage section that names it most (a table row counts half: tables list, prose hands off), ties to the earliest.
  const stages: SysmapStage[] = [];
  const hub = items.get(itemId("skill", SOURCES.hub));
  const weight = new Map<string, Map<number, number>>();
  const mention = (id: string, n: number, w: number) => {
    const m = weight.get(id) ?? new Map<number, number>();
    m.set(n, (m.get(n) ?? 0) + w);
    weight.set(id, m);
  };
  if (!hub?.refText) problem({ reason: "STAGES_MISSING", message: `no ${SOURCES.hub} skill to read the stages from: no item has a stage` });
  else {
    const parsed = buildStages(hub.refText.text);
    if (!parsed.length) problem({ reason: "STAGES_MISSING", message: `${hub.refText.path} has no "### <n>. <title>" stages under "## Steps"`, path: hub.refText.path });
    for (const s of parsed) {
      const disc = stageDiscipline(s.title) ?? null;
      if (!disc) problem({ reason: "STAGE_UNCLASSIFIED", message: `stage ${s.n} (${s.title}) of ${hub.refText.path} matches no discipline rule`, path: hub.refText.path });
      stages.push({ n: s.n, title: s.title, discipline: disc });
      for (const line of mdLines(s.text)) {
        const w = line.table ? 0.5 : 1;
        for (const b of boldIds(line.prose)) if (skillIds.has(b) && b !== SOURCES.hub) mention(itemId("skill", b), s.n, w);
        for (const piece of line.code) {
          for (const cmd of cliMentions(piece)) if (cmdIds.has(cmd)) mention(itemId("cli-command", cmd), s.n, w);
          for (const m of piece.matchAll(/\b(?:protoboard|pb)\s+run\s+([a-z][\w-]*(?::[a-z][\w-]*)?)(?![\w-])/g)) {
            const pool = m[1].includes(":") && !m[1].startsWith("package:") ? capOps.get(m[1]) ?? [] : opsById.get(m[1]) ?? [];
            if (pool.length === 1) mention(pool[0].id, s.n, w);
          }
        }
      }
    }
  }
  const stageTitle = new Map(stages.map((s) => [s.n, s]));
  for (const [id, byStage] of [...weight].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const d = items.get(id)!;
    const ranked = [...byStage].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    d.stage = ranked[0][0];
    d.stageFrom = "build-a-project";
    d.stages = [...byStage.keys()].sort((a, b) => a - b);
  }
  for (const d of items.values()) {
    if (d.type !== "extension") continue;
    const own = [...items.values()].filter((x) => x.type === "skill" && x.ext === d.id && x.stage !== null);
    if (own.length) {
      d.stage = Math.min(...own.map((x) => x.stage!));
      d.stageFrom = "skills";
    }
  }
  for (const d of items.values()) {
    if ((d.type === "operation" || d.type === "capability-operation" || d.type === "check") && d.stage === null && d.ext && items.get(d.ext)!.stage !== null) {
      d.stage = items.get(d.ext)!.stage;
      d.stageFrom = "extension";
    }
  }

  // ---- disciplines ----
  const valid = new Set<string>(DISCIPLINE_ORDER);
  const fromStage = (d: Draft): DisciplineId | undefined => (d.stage !== null && d.stageFrom === "build-a-project" ? stageTitle.get(d.stage)?.discipline ?? undefined : undefined);
  const set = (d: Draft, disc: DisciplineId | undefined, from: SysmapItem["disciplineFrom"]): boolean => {
    if (!disc) return false;
    d.discipline = disc;
    d.disciplineFrom = from;
    return true;
  };
  const declared = (d: Draft): boolean => {
    if (!d.declared) return false;
    if (valid.has(d.declared)) return set(d, d.declared as DisciplineId, "declared");
    problem({ reason: "MANIFEST_INVALID", message: `${d.id} declares the discipline ${JSON.stringify(d.declared)}, which is not one of ${DISCIPLINE_ORDER.join(", ")}`, path: d.source.split("#")[0], item: d.id });
    return false;
  };
  const all = [...items.values()].sort((a, b) => byCodeUnit(a.id, b.id));
  const linksOf = (id: string) => [...linkMap.values()].filter((l) => l.from === id || l.to === id);
  const of = (type: ItemType) => all.filter((d) => d.type === type);
  for (const d of of("skill")) declared(d) || set(d, DISCIPLINE_RULES.skill[d.name], "rule") || set(d, fromStage(d), "stage");
  for (const d of of("extension")) {
    if (declared(d)) continue;
    // the disciplines of the stages that name what it ships (skills, operations, checks)
    const own = all.filter((s) => s.ext === d.id && s.stageFrom === "build-a-project").sort((a, b) => a.stage! - b.stage! || byCodeUnit(a.id, b.id));
    set(d, majorityDiscipline(own.map(fromStage), "first"), "stage") || set(d, DISCIPLINE_RULES.packageDefault, "rule");
  }
  for (const d of of("skill")) if (!d.discipline && d.ext) set(d, items.get(d.ext)!.discipline ?? undefined, "inherited");
  for (const t of ["operation", "capability-operation", "check"] as const) {
    for (const d of of(t)) declared(d) || set(d, fromStage(d), "stage") || set(d, d.ext ? items.get(d.ext)!.discipline ?? undefined : undefined, "inherited");
  }
  for (const d of of("capability")) {
    const providers = linksOf(d.id).filter((l) => l.kind === "provides").map((l) => items.get(l.from)!.discipline);
    set(d, majorityDiscipline(providers), "inherited");
  }
  for (const d of of("tool")) {
    const needers = linksOf(d.id).filter((l) => l.kind === "needs" && l.to === d.id).map((l) => items.get(l.from)!.discipline);
    set(d, majorityDiscipline(needers), "inherited");
  }
  for (const d of of("cli-command")) set(d, DISCIPLINE_RULES.cliCommand[d.id.slice(4)] ?? DISCIPLINE_RULES.cliDefault, "rule");
  for (const d of of("mcp-tool")) {
    const wrapped = linksOf(d.id).filter((l) => l.kind === "wraps" && l.from === d.id).map((l) => items.get(l.to)!.discipline);
    set(d, majorityDiscipline(wrapped), "inherited") || set(d, DISCIPLINE_RULES.cliDefault, "rule");
  }
  for (const d of of("view")) set(d, DISCIPLINE_RULES.view[d.id.slice(5)] ?? DISCIPLINE_RULES.viewDefault, "rule");
  for (const d of of("package")) set(d, DISCIPLINE_RULES.package[d.name] ?? DISCIPLINE_RULES.packageDefault, "rule");
  for (const d of of("template")) set(d, DISCIPLINE_RULES.template, "rule");
  for (const d of of("example")) set(d, DISCIPLINE_RULES.example, "rule");
  for (const d of of("doc")) {
    const near = linksOf(d.id)
      .map((l) => items.get(l.from === d.id ? l.to : l.from)!)
      .filter((x) => x.type !== "doc")
      .map((x) => x.discipline);
    set(d, majorityDiscipline(near), "links");
  }
  // a doc that names no item takes the docs it cites or is cited by
  for (const d of of("doc")) {
    if (d.discipline) continue;
    const near = linksOf(d.id)
      .map((l) => items.get(l.from === d.id ? l.to : l.from)!)
      .filter((x) => x.type === "doc")
      .map((x) => x.discipline);
    set(d, majorityDiscipline(near), "links");
  }
  for (const d of all) {
    if (!d.discipline) problem({ reason: "DISCIPLINE_UNRESOLVED", message: `${d.id}: nothing gives it a discipline (no stage, no rule, no linked item with one)`, path: d.source.split("#")[0], item: d.id });
  }

  // ---- status and changes (history) ----
  let releases: SysmapRelease[] = [];
  let fingerprint: SystemMap["history"] = null;
  if (options.history !== false) {
    const h = await readHistory(root, options.git ?? runGit);
    if ("unavailable" in h) problem({ reason: "HISTORY_UNAVAILABLE", message: `${h.unavailable}: every item in the stack is taken as released, and no item says when it changed` });
    else {
      releases = h.releases.map((r) => ({ version: r.version, tag: r.tag, date: r.date }));
      fingerprint = h.fingerprint;
      await applyHistory(all, h, c);
    }
  }
  for (const d of all) {
    if (d.status === "wip") {
      d.version = null;
      d.versionFrom = "unreleased";
    }
  }

  // ---- output ----
  const links = [...linkMap.values()].sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind));
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
    degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  }
  const out: SysmapItem[] = all.map((d) => {
    const { track: _t, ext: _e, refText: _r, declared: _d, ...rest } = d;
    return sortKeys({ ...rest, degree: degree.get(d.id) ?? 0 }) as SysmapItem;
  });
  const counts = countAll(out, links, problems.length);
  const islands: SysmapIsland[] = DISCIPLINES.map((def) => {
    const n = counts.byDiscipline[def.id];
    const island: SysmapIsland = { id: def.id, name: def.name, gloss: def.gloss, items: n, empty: n === 0 };
    if (n === 0) {
      const specs = (def.planned?.specs ?? []).filter((s) => c.text.has(s));
      const missing = (def.planned?.folders ?? []).filter((f) => !c.rootEntries.has(f));
      const notes = ["No item in the stack resolves to this discipline"];
      if (specs.length) notes.push(`planned in ${specs.join(", ")}`);
      if (missing.length) notes.push(`no ${missing.map((f) => `${f}/`).join(", ")} folder at the stack root`);
      island.note = notes.join("; ") + ".";
    }
    return island;
  });
  problems.sort((a, b) => byCodeUnit(a.reason, b.reason) || byCodeUnit(a.path ?? "", b.path ?? "") || byCodeUnit(a.item ?? "", b.item ?? "") || byCodeUnit(a.message, b.message));
  const uniqueProblems = problems.filter((p, i) => i === 0 || JSON.stringify(p) !== JSON.stringify(problems[i - 1]));
  counts.problems = uniqueProblems.length;
  return {
    schema: SYSMAP_SCHEMA,
    stack: options.stack ?? FRAMEWORK_VERSION,
    layout: c.layout ?? "installed",
    counts,
    islands,
    stages,
    releases,
    items: out,
    links,
    inputs: [...c.inputs.values()].sort((a, b) => byCodeUnit(a[0], b[0])),
    history: fingerprint,
    problems: uniqueProblems,
  };
}

/** Object keys in code-unit order, recursively (so equal maps give equal bytes). */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort(byCodeUnit)
      .filter((k) => v[k] !== undefined)
      .map((k) => [k, sortKeys(v[k])]),
  );
}

function countAll(items: SysmapItem[], links: SysmapLink[], problems: number): SysmapCounts {
  const byType = Object.fromEntries(ITEM_TYPE_ORDER.map((t) => [t, 0])) as SysmapCounts["byType"];
  const byDiscipline = Object.fromEntries([...DISCIPLINE_ORDER, "none"].map((d) => [d, 0])) as SysmapCounts["byDiscipline"];
  const byStatus: SysmapCounts["byStatus"] = { released: 0, wip: 0, outside: 0 };
  const byLinkKind: SysmapCounts["byLinkKind"] = {};
  for (const i of items) {
    byType[i.type]++;
    byDiscipline[i.discipline ?? "none"]++;
    byStatus[i.status]++;
  }
  for (const l of links) byLinkKind[l.kind] = (byLinkKind[l.kind] ?? 0) + 1;
  return { items: items.length, links: links.length, byType, byDiscipline, byStatus, byLinkKind: sortKeys(byLinkKind) as SysmapCounts["byLinkKind"], problems };
}

// ---------------------------------------------------------------------------
// History: status and the last change of every item
// ---------------------------------------------------------------------------

/** The patterns that say a release-notes bullet names an item. */
function mentionTest(d: Draft): ((bullet: string) => boolean) | undefined {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const has = (re: RegExp) => (b: string) => re.test(b);
  switch (d.type) {
    case "skill":
      return has(new RegExp(`(\\*\\*|\`)${esc(d.name)}(\\*\\*|\`)`));
    case "extension":
    case "package":
      return has(new RegExp(`\`(${esc(d.name)}|${esc(d.name.replace(/^@[^/]+\//, ""))})\``));
    case "cli-command":
      return has(new RegExp(`\`(?:npx )?${esc(d.name)}(?:[\\s\`])`));
    case "mcp-tool":
      return has(new RegExp(`\`${esc(d.name)}\``));
    case "view":
      return has(new RegExp(`\\*\\*${esc(d.name.replace(/ view$/, ""))}\\*\\* (tab|view)`, "i"));
    case "operation":
    case "capability-operation":
      return has(new RegExp(`\`(?:protoboard run )?${esc(d.name)}[\\s\`]`));
    case "template":
      return has(new RegExp(`--template[ =]${esc(d.id.slice(9))}\\b`));
    case "doc":
      return has(new RegExp(esc(d.source)));
    default:
      return undefined;
  }
}

async function applyHistory(all: Draft[], h: StackHistory, c: Collected): Promise<void> {
  const n = h.releases.length; // states 0..n-1 are releases, n is the working tree
  // entries of every tracked file, per state, read only where the file changed
  const files = new Set<string>();
  for (const d of all) for (const e of d.track?.entries ?? []) files.add(e.file);
  const reader = (file: string) => (file.endsWith("protoboard-extension.json") ? manifestEntries : file.endsWith("tools.ts") ? mcpEntries : file.endsWith("tabs.ts") ? tabEntries : cliEntries);
  const entries = new Map<string, Map<string, string>[]>();
  for (const file of [...files].sort(byCodeUnit)) {
    const parse = reader(file);
    const states: Map<string, string>[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && !h.changed[i].has(file) && h.present[i].has(file) === h.present[i - 1].has(file)) states.push(states[i - 1]);
      else states.push(parse(await h.show(i, file)));
    }
    states.push(parse(c.text.get(file) ?? null));
    entries.set(file, states);
  }
  // release notes: bullets by version
  const notes = new Map<string, string[]>();
  for (const [path, t] of [...c.text].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    if (!path.startsWith(`${SOURCES.releaseNotes}/`)) continue;
    for (const s of releaseSections(t)) notes.set(s.version, [...(notes.get(s.version) ?? []), ...s.bullets]);
  }
  const label = (i: number) => (i === n ? "unreleased" : h.releases[i].version);

  for (const d of all) {
    const t = d.track;
    if (!t || d.status === "outside") continue;
    const exists = (i: number): boolean => {
      if (i === n) return true;
      if (t.exists === "entries") return t.entries.some((e) => entries.get(e.file)![i].has(e.key));
      return t.files.length ? h.present[i].has(t.files[0]) : t.dirs.some((dir) => [...h.present[i]].some((p) => p.startsWith(`${dir}/`)));
    };
    const why = (i: number): { line: string; from: "history" | "release-notes" } | null => {
      if (!exists(i)) return null;
      const prev = i - 1;
      const test = mentionTest(d);
      const bullet = test ? (notes.get(label(i)) ?? []).find(test) : undefined;
      const fromNotes = (fallback: string) => (bullet ? { line: bulletLine(bullet), from: "release-notes" as const } : { line: fallback, from: "history" as const });
      if (!exists(prev)) return fromNotes(i === n ? `New since ${h.releases[n - 1].tag}, not released yet` : `New in ${h.releases[i].tag}`);
      for (const e of t.entries) {
        const a = entries.get(e.file)![prev].get(e.key);
        const b = entries.get(e.file)![i].get(e.key);
        if (a !== b) return fromNotes(`Its ${entryLabel(e.file, e.key)} changed`);
      }
      for (const f of t.files) if (h.changed[i].has(f)) return fromNotes(`${posix.basename(f)} changed`);
      for (const dir of t.dirs) {
        const under = [...h.changed[i]].filter((p) => p.startsWith(`${dir}/`)).sort(byCodeUnit);
        if (under.length) return fromNotes(`${under[0].slice(dir.length + 1)}${under.length > 1 ? ` and ${under.length - 1} more file${under.length > 2 ? "s" : ""}` : ""} changed`);
      }
      return null;
    };
    d.status = exists(n - 1) ? "released" : "wip";
    let last: { i: number; line: string; from: "history" | "release-notes" } | undefined;
    for (let i = n; i >= 1 && !last; i--) {
      const w = why(i);
      if (w) last = { i, ...w };
    }
    if (last) d.changed = { in: label(last.i), ...(last.i < n && h.releases[last.i].date ? { date: h.releases[last.i].date } : {}), why: last.line, from: last.from };
    else if (exists(0)) d.changed = { in: h.releases[0].version, ...(h.releases[0].date ? { date: h.releases[0].date } : {}), why: `In ${h.releases[0].tag}, the earliest release tag; unchanged since`, from: "history" };
  }
}

function entryLabel(file: string, key: string): string {
  if (file.endsWith("protoboard-extension.json")) return "entry in protoboard-extension.json";
  if (key.startsWith("case:")) return "code in the CLI";
  if (key.startsWith("help:")) return "help text";
  if (key.startsWith("tool:")) return "spec in tools.ts";
  if (key.startsWith("view:")) return "registration in tabs.ts";
  return `entry in ${posix.basename(file)}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** The map as the bytes a writer stores: keys sorted, two-space indent, a final newline. */
export function serializeSystemMap(map: SystemMap): string {
  return JSON.stringify(sortKeys(map), null, 2) + "\n";
}

/** Builds the map and writes it (default `<root>/.protoboard/build/sysmap.json`) through a temporary file and a rename. */
export async function writeSystemMap(root: string, options: SysmapBuildOptions & { file?: string } = {}): Promise<{ file: string; map: SystemMap }> {
  const map = await buildSystemMap(root, options);
  const file = options.file ?? join(root, SYSMAP_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, serializeSystemMap(map));
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return { file, map };
}

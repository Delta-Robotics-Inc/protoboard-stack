/**
 * Extension contract v0 (docs/specs/core-cli-v0.md "Extensions and operations").
 *
 * An extension is an ordinary npm package with a `protoboard-extension.json`
 * manifest at its root. The framework discovers only the extensions a project
 * lists in `protoboard.config.ts`, validates their manifests and version
 * compatibility, probes their tool requirements, and exposes their skills,
 * checks and operations. Installing a package does not make its external
 * tools available; `doctor` reports what is actually present.
 */
import { isViewId } from "./view-ids.js";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importTs, packageRoot } from "./load.js";
import { renamedPackage } from "./scope.js";
import type { Project } from "./project.js";
import { probeTool, toolEnvironment, validateRuntime, type ToolRuntimeDecl } from "./tools.js";
import type { ProjectDiagnostic, SourceLocation } from "./types.js";
import type { ArtifactDef } from "@deltarobotics/uhd";
import { projectRelative } from "./paths.js";

export const EXTENSION_SCHEMA = "protoboard.extension/v0";
/**
 * The stack version: this package's own (`@protoboardai/core`), which the CLI
 * and the extensions share. An extension states the versions it works with
 * as a range (`compatibility.protoboard`, "^0.1.0": any 0.1.x), and builds,
 * bundles, releases and eval reports record it as what produced them.
 */
export const FRAMEWORK_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface SkillDecl {
  id: string;
  summary: string;
  /** SKILL.md path, relative to this extension's root, or to `package` when given. */
  path: string;
  /** Skills may live in another package (e.g. UHD ships its authoring skills). */
  package?: string;
  /** Companion verification skill id, if any. */
  verifiedBy?: string;
}

export interface ToolDecl {
  id: string;
  purpose: string;
  /** Command whose zero exit means the tool is usable; probed by `doctor`. */
  probe: string[];
  /** Hint shown when missing. */
  install?: string;
  /**
   * The managed runtime that provides this tool (PB-817): `protoboard tools
   * install <runtime id>` creates it in the project, and probes, checks and
   * operations then find it without environment setup.
   */
  runtime?: ToolRuntimeDecl;
}

export type Effect = "pure" | "export" | "external" | "physical";

export interface OperationDecl {
  id: string;
  summary: string;
  /** "./ops/bom.ts#bom": module path (relative to the extension) and export name. */
  entry: string;
  /**
   * pure: reads the project only. export: writes project files. external:
   * talks to a service. physical: operates a device. external/physical need
   * explicit authorization and are never retried automatically.
   */
  effect: Effect;
  requires?: string[];
  /** Named inputs with a one-line description (validated as present/unknown). */
  inputs?: Record<string, { description: string; required?: boolean; default?: string }>;
}

export interface CheckDecl {
  id: string;
  summary: string;
  entry: string;
}

/** The four operations every provider of a capability implements (tool-integrations.md §2). */
export const CAPABILITY_OPERATIONS = ["generate", "export", "extract", "check"] as const;
export type CapabilityOperation = (typeof CAPABILITY_OPERATIONS)[number];

/** Capabilities this framework version defines a contract (standard outputs) for. */
export const CAPABILITIES = ["circuit", "cad", "firmware"] as const;
export type CapabilityId = (typeof CAPABILITIES)[number];

/** One capability operation: an entry, or an entry with the same options as an ordinary operation. */
export type CapabilityOperationDecl =
  | string
  | {
      entry: string;
      summary?: string;
      requires?: string[];
      inputs?: OperationDecl["inputs"];
      /** A provider's own operation (beyond the four): pure or export (default export). */
      effect?: Extract<Effect, "pure" | "export">;
    };

export interface CapabilityDecl {
  id: CapabilityId;
  summary?: string;
  /**
   * Entries for all four operations, e.g. `{ generate: "./ops/circuit.ts#generate", … }`,
   * and any of the provider's own (`lock`), each an object with an entry and a summary.
   */
  operations: Record<CapabilityOperation, CapabilityOperationDecl> & Record<string, CapabilityOperationDecl>;
  /**
   * Folder for the provider's native files inside each module's provider
   * directory (`src/boards/<module>/<native>/`). Default: the package name
   * without scope and `ext-` prefix (`@protoboardai/ext-tscircuit` → `tscircuit`).
   */
  native?: string;
  /** Design constraints the provider understands; unknown keys in a module config are reported. */
  constraints?: Record<string, { description: string; required?: boolean }>;
  /**
   * The files the provider makes for each bound module, as the module's
   * artifacts (PB-1030): core attaches each one whose file exists to the
   * bound module when the project loads, so the viewer's tabs (schematic,
   * PCB, 3D, BOM) find a board's outputs without the project listing them.
   * An artifact the module itself lists with the same id or file path wins
   * (explicit artifacts are the override).
   */
  artifacts?: DeclaredArtifact[];
}

/**
 * One file a capability provider declares for its modules. `path` starts
 * with `{out}/` (the standard outputs folder), `{native}/` (the provider's
 * native folder) or `{dir}/` (the provider directory), and may name the
 * module with `{module}`: `{out}/pcb-top.svg`, `{dir}/kicad/{module}.kicad_pro`.
 */
export interface DeclaredArtifact {
  id: string;
  name: string;
  type: ArtifactDef["type"];
  path: string;
  role?: ArtifactDef["role"];
  format?: string;
  units?: ArtifactDef["units"];
  /** The id of the declared artifact this file is made from (its provenance): a geometry manifest names the body it describes. */
  generatedFrom?: string;
}

/**
 * Which modules a view applies to, as data: shells test it against the
 * focused module before loading any of the extension's code. Every condition
 * given must hold; none given: every module.
 */
export interface ViewAppliesTo {
  /** Only the top-level system (`true`), or only modules below it (`false`). */
  root?: boolean;
  /**
   * The module has an artifact with one of these standard-output file names
   * (`schematic.svg`, `pcb-top.svg`, `bom.csv`; docs/specs/tool-integrations.md §8).
   * Matched by file name, never by the tool that wrote it.
   */
  files?: string[];
  /** With `files`: an artifact of the module or of any module below it counts. */
  descendants?: boolean;
  /** The module's taxonomy categories start with one of these (`electronics.board`). */
  categories?: string[];
}

/**
 * A view an extension contributes (`contributes.views`, docs/specs/viewer-stack.md):
 * a tab the viewer shells (web, VS Code, desktop) offer for the modules it
 * applies to. The component itself is registered with @protoboardai/views by
 * the extension's `entry`; without one the shells show the view as planned.
 */
export interface ViewDecl {
  /** Unique across extensions: a plain id for the stack's own views (`schematic`), `<extension>.<view>` for others. */
  id: string;
  title: string;
  /** A Lucide icon name (kebab-case), shown in the tab and its tooltip. */
  icon: string;
  appliesTo?: ViewAppliesTo;
  /** `./views/schematic.js#SchematicView`: the module and export of the view's component (optional). */
  entry?: string;
  /** Sort key among a module's tabs (lower first; built-in diagram 0, 3d 10). */
  order?: number;
}

/** What an extension adds to the shells (beyond operations and checks). */
export interface ContributesDecl {
  views?: ViewDecl[];
}

export interface ExtensionManifest {
  schema: typeof EXTENSION_SCHEMA;
  id: string;
  version: string;
  description?: string;
  compatibility: { protoboard: string; uhd?: string };
  skills?: SkillDecl[];
  tools?: ToolDecl[];
  operations?: OperationDecl[];
  checks?: CheckDecl[];
  /** Capabilities this extension provides (optional; v0 manifests without it are unchanged). */
  capabilities?: CapabilityDecl[];
  /** Views and other shell contributions (optional). */
  contributes?: ContributesDecl;
}

export interface LoadedExtension {
  manifest: ExtensionManifest;
  root: string;
  /** The npm package it was loaded from (what configs name). */
  package?: string;
}

export interface ResolvedSkill extends SkillDecl {
  extension: string;
  /** The npm package of the extension that declares it (two packages may carry the same manifest id). */
  provider?: string;
  /** Absolute path of SKILL.md (undefined if it could not be found). */
  file?: string;
}

/** Caret/greater-equal ranges over x.y.z, enough for v0 compatibility checks. */
export function satisfies(version: string, range: string): boolean {
  const parse = (v: string) => v.replace(/^[^\d]*/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b, c] = parse(version);
  const cmp = (x: number[]) => a - x[0] || b - x[1] || c - x[2];
  return range
    .split(/\s+/)
    .filter(Boolean)
    .every((r) => {
      const v = parse(r);
      if (r.startsWith("^")) return a === v[0] && (v[0] !== 0 || b === v[1]) && cmp(v) >= 0;
      if (r.startsWith(">=")) return cmp(v) >= 0;
      if (r.startsWith("<")) return cmp(v) < 0;
      return cmp(v) === 0;
    });
}

function uhdVersionOf(root: string): string | undefined {
  const dir = packageRoot(root, "@deltarobotics/uhd");
  return dir ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version : undefined;
}

/**
 * An extension to load: one listed in protoboard.config.ts, or a capability
 * provider named by a module's config (`implicit`; a missing one is reported
 * by the module's binding, not here).
 */
export interface ExtensionRequest {
  name: string;
  source: SourceLocation;
  implicit?: boolean;
}

export function loadExtensions(p: Project, providers: ExtensionRequest[] = []): { extensions: LoadedExtension[]; diagnostics: ProjectDiagnostic[] } {
  const extensions: LoadedExtension[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  let source: SourceLocation = { file: "protoboard.config.ts" };
  const diag = (id: string, code: string, message: string, severity: ProjectDiagnostic["severity"] = "error") =>
    diagnostics.push({ code, severity, entity: { kind: "project", id }, message, source, validator: "protoboard/extensions" });
  const uhd = uhdVersionOf(p.root);
  const configured = p.config.extensions ?? [];
  const requests: ExtensionRequest[] = [
    ...configured.map((name) => ({ name, source: { file: "protoboard.config.ts" } })),
    ...providers.filter((r, i) => !configured.includes(r.name) && providers.findIndex((x) => x.name === r.name) === i),
  ];
  for (const { name, source: from, implicit } of requests) {
    source = from;
    const root = packageRoot(p.root, name);
    if (!root) {
      // a name under the former npm scope is reported once for the project (PB_PACKAGE_SCOPE_RENAMED), never with "npm install" advice
      if (!implicit && !renamedPackage(name)) diag(name, "PB_EXTENSION_NOT_INSTALLED", `extension ${name} is configured but not installed (npm install ${name})`);
      continue;
    }
    const file = join(root, "protoboard-extension.json");
    if (!existsSync(file)) {
      diag(name, "PB_EXTENSION_NO_MANIFEST", `${name} has no protoboard-extension.json`);
      continue;
    }
    let m: ExtensionManifest;
    try {
      m = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      diag(name, "PB_EXTENSION_MANIFEST_INVALID", `${name}: ${(e as Error).message}`);
      continue;
    }
    const missing = (["schema", "id", "version", "compatibility"] as const).filter((k) => !m[k]);
    if (missing.length || m.schema !== EXTENSION_SCHEMA) {
      diag(name, "PB_EXTENSION_MANIFEST_INVALID", `${name}: manifest ${missing.length ? `lacks ${missing.join(", ")}` : `schema is ${m.schema}, expected ${EXTENSION_SCHEMA}`}`);
      continue;
    }
    if (!satisfies(FRAMEWORK_VERSION, m.compatibility.protoboard)) {
      diag(name, "PB_EXTENSION_INCOMPATIBLE", `${m.id}@${m.version} needs protoboard ${m.compatibility.protoboard}; this is ${FRAMEWORK_VERSION}`);
      continue;
    }
    if (m.compatibility.uhd && uhd && !satisfies(uhd, m.compatibility.uhd)) {
      diag(name, "PB_EXTENSION_INCOMPATIBLE", `${m.id}@${m.version} needs @deltarobotics/uhd ${m.compatibility.uhd}; the project has ${uhd}`);
      continue;
    }
    const ids = [...(m.operations ?? []).map((o) => `op:${o.id}`), ...(m.skills ?? []).map((s) => `skill:${s.id}`), ...(m.checks ?? []).map((c) => `check:${c.id}`)];
    const dup = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dup) diag(name, "PB_EXTENSION_MANIFEST_INVALID", `${m.id}: duplicate ${dup}`);
    for (const o of m.operations ?? []) {
      for (const t of o.requires ?? []) {
        if (!(m.tools ?? []).some((x) => x.id === t)) diag(name, "PB_EXTENSION_MANIFEST_INVALID", `${m.id}: operation ${o.id} requires undeclared tool ${t}`);
      }
    }
    const capabilityProblems = [...validateCapabilities(m), ...validateContributes(m), ...(Array.isArray(m.tools) ? m.tools.flatMap(validateRuntime) : [])];
    if (capabilityProblems.length) {
      for (const problem of capabilityProblems) diag(name, "PB_EXTENSION_MANIFEST_INVALID", `${m.id}: ${problem}`);
      continue;
    }
    extensions.push({ manifest: m, root, package: name });
  }
  // A skill id is unique inside one manifest (above), and must be across the installed extensions too: `skills read
  // <id>` and the agent export address a skill by its bare id, so two extensions' `part-search` would be read or
  // exported by discovery order, one silently in place of the other. Both stay loaded; the id is refused.
  source = { file: "protoboard.config.ts" };
  for (const [id, owners] of skillOwners(extensions)) {
    if (owners.length < 2) continue;
    const named = owners.map((e) => (e.package && e.package !== e.manifest.id ? `${e.manifest.id} (${e.package})` : e.manifest.id));
    diag(
      owners[0].package ?? owners[0].manifest.id,
      "PB_EXTENSION_SKILL_DUPLICATE",
      `skill ${id} is declared by ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}: \`protoboard skills read ${id}\` and the agent export refuse it until one of these extensions is removed`,
    );
  }
  return { extensions, diagnostics };
}

/** Each skill id with the extensions that declare it, in load order. */
function skillOwners(extensions: LoadedExtension[]): Map<string, LoadedExtension[]> {
  const owners = new Map<string, LoadedExtension[]>();
  for (const e of extensions) for (const s of e.manifest.skills ?? []) if (!owners.get(s.id)?.includes(e)) owners.set(s.id, [...(owners.get(s.id) ?? []), e]);
  return owners;
}

/** Problems with a manifest's `capabilities` (empty when valid or absent). */
export function validateCapabilities(m: ExtensionManifest): string[] {
  if (m.capabilities === undefined) return [];
  if (!Array.isArray(m.capabilities)) return ["capabilities must be an array"];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of m.capabilities) {
    if (!c || typeof c !== "object" || typeof c.id !== "string") {
      problems.push("every capability needs an id");
      continue;
    }
    if (!(CAPABILITIES as readonly string[]).includes(c.id)) {
      problems.push(`capability "${c.id}" is not defined by protoboard ${FRAMEWORK_VERSION} (known: ${CAPABILITIES.join(", ")})`);
      continue;
    }
    if (seen.has(c.id)) problems.push(`duplicate capability ${c.id}`);
    seen.add(c.id);
    const ops = c.operations && typeof c.operations === "object" ? c.operations : ({} as CapabilityDecl["operations"]);
    const missing = CAPABILITY_OPERATIONS.filter((o) => ops[o] === undefined);
    if (missing.length) problems.push(`capability ${c.id} lacks operation(s) ${missing.join(", ")}; a provider implements all of ${CAPABILITY_OPERATIONS.join(", ")}`);
    for (const k of Object.keys(ops).filter((k) => !(CAPABILITY_OPERATIONS as readonly string[]).includes(k))) {
      // a provider's own operation: an object with an entry and a summary, pure or export
      const d = ops[k] as unknown as Exclude<CapabilityOperationDecl, string> | undefined;
      if (!/^[a-z][a-z0-9-]*$/.test(k) || !d || typeof d !== "object" || typeof d.summary !== "string") problems.push(`capability ${c.id} has unknown operation ${k} (a provider's own operation is { entry, summary, effect? } under a lowercase id)`);
      else if (d.effect !== undefined && d.effect !== "pure" && d.effect !== "export") problems.push(`capability ${c.id} operation ${k}: effect must be pure or export`);
    }
    for (const o of Object.keys(ops).filter((o) => ops[o] !== undefined)) {
      const raw = ops[o] as unknown;
      const d = typeof raw === "string" ? { entry: raw } : raw && typeof raw === "object" ? (raw as Exclude<CapabilityOperationDecl, string>) : { entry: undefined, requires: [] };
      if (typeof d.entry !== "string" || !/^[^#]+(#\w+)?$/.test(d.entry)) problems.push(`capability ${c.id} operation ${o} needs an entry like "./ops/${c.id}.ts#${o}"`);
      for (const t of d.requires ?? []) if (!(m.tools ?? []).some((x) => x.id === t)) problems.push(`capability ${c.id} operation ${o} requires undeclared tool ${t}`);
    }
    if (c.native !== undefined && (typeof c.native !== "string" || !/^\w[\w.-]*$/.test(c.native) || c.native === "out")) problems.push(`capability ${c.id}: native must be a plain folder name other than "out"`);
    if (c.artifacts !== undefined) {
      if (!Array.isArray(c.artifacts)) problems.push(`capability ${c.id}: artifacts must be an array`);
      else {
        const ids = new Set<string>();
        for (const a of c.artifacts as Partial<DeclaredArtifact>[]) {
          const what = `capability ${c.id} artifact ${JSON.stringify(a?.id)}`;
          if (!a || typeof a.id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(a.id)) problems.push(`capability ${c.id}: every declared artifact needs an id (letters, digits, _ . -)`);
          else if (ids.has(a.id)) problems.push(`${what} is declared twice`);
          else ids.add(a.id);
          if (!a || typeof a.name !== "string" || typeof a.type !== "string") problems.push(`${what} needs a name and a type`);
          if (!a || typeof a.path !== "string" || !DECLARED_PATH.test(a.path) || a.path.split("/").includes("..")) problems.push(`${what}: path must start with {out}/, {native}/ or {dir}/ and stay inside it (e.g. "{out}/pcb-top.svg")`);
        }
      }
    }
  }
  return problems;
}

/** A declared artifact's path: inside the module's provider directory, by one of its folders. */
export const DECLARED_PATH = /^\{(out|native|dir)\}\/[^\\]+$/;

const ICON = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_NAME = /^[^/\\]+$/;

/** Problems with a manifest's `contributes` (empty when valid or absent). */
export function validateContributes(m: ExtensionManifest): string[] {
  const c = m.contributes as unknown;
  if (c === undefined) return [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["contributes must be an object"];
  const problems: string[] = [];
  for (const k of Object.keys(c)) if (k !== "views") problems.push(`contributes has unknown section ${k}`);
  const views = (c as ContributesDecl).views as unknown;
  if (views === undefined) return problems;
  if (!Array.isArray(views)) return [...problems, "contributes.views must be an array"];
  const seen = new Set<string>();
  for (const v of views as Partial<ViewDecl>[]) {
    if (!v || typeof v !== "object" || !isViewId(v.id)) {
      problems.push(`every view needs an id like "schematic" or "${m.id}.schematic" (lowercase, dashes)`);
      continue;
    }
    const at = `view ${v.id}`;
    if (seen.has(v.id)) problems.push(`duplicate ${at}`);
    seen.add(v.id);
    if (typeof v.title !== "string" || !v.title.trim()) problems.push(`${at} needs a title`);
    if (typeof v.icon !== "string" || !ICON.test(v.icon)) problems.push(`${at} needs an icon: a Lucide icon name in kebab-case`);
    if (v.entry !== undefined && (typeof v.entry !== "string" || !/^\.{1,2}\/[^#]+(#\w+)?$/.test(v.entry))) problems.push(`${at}: entry must be a relative module path, like "./views/${v.id}.js#View"`);
    if (v.order !== undefined && (typeof v.order !== "number" || !Number.isFinite(v.order))) problems.push(`${at}: order must be a number`);
    const a = v.appliesTo as unknown;
    if (a === undefined) continue;
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      problems.push(`${at}: appliesTo must be an object`);
      continue;
    }
    const known = ["root", "files", "descendants", "categories"];
    for (const k of Object.keys(a)) if (!known.includes(k)) problems.push(`${at}: appliesTo has unknown condition ${k} (known: ${known.join(", ")})`);
    const ap = a as ViewAppliesTo;
    if (ap.root !== undefined && typeof ap.root !== "boolean") problems.push(`${at}: appliesTo.root must be true or false`);
    if (ap.descendants !== undefined && typeof ap.descendants !== "boolean") problems.push(`${at}: appliesTo.descendants must be true or false`);
    if (ap.descendants !== undefined && ap.files === undefined) problems.push(`${at}: appliesTo.descendants needs files`);
    const strings = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && s.length > 0);
    if (ap.files !== undefined && (!strings(ap.files) || !ap.files.every((f) => FILE_NAME.test(f)))) problems.push(`${at}: appliesTo.files must be file names (no folders), like "schematic.svg"`);
    if (ap.categories !== undefined && !strings(ap.categories)) problems.push(`${at}: appliesTo.categories must be taxonomy category ids`);
  }
  return problems;
}

/** A capability operation with its options spelled out. */
export function capabilityOperation(c: CapabilityDecl, op: string): Exclude<CapabilityOperationDecl, string> {
  const d = c.operations[op];
  return typeof d === "string" ? { entry: d } : d;
}

/** A view an extension contributes, with the extension it comes from. */
export interface ResolvedView extends ViewDecl {
  extension: string;
  /** The npm package of the extension (shells import `entry` from it). */
  package?: string;
}

/**
 * The views the loaded extensions contribute, in declaration order. A view
 * id declared by two extensions is kept once, from the first; the second is
 * reported (the registry would refuse it at runtime anyway).
 */
export function resolveViews(extensions: LoadedExtension[]): { views: ResolvedView[]; diagnostics: ProjectDiagnostic[] } {
  const views: ResolvedView[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  for (const e of extensions) {
    for (const v of e.manifest.contributes?.views ?? []) {
      const first = views.find((x) => x.id === v.id);
      if (first) {
        diagnostics.push({
          code: "PB_EXTENSION_VIEW_DUPLICATE",
          severity: "warning",
          entity: { kind: "project", id: e.package ?? e.manifest.id },
          message: `${e.manifest.id}: view ${v.id} is already contributed by ${first.extension}; this one is ignored`,
          source: { file: "protoboard.config.ts" },
          validator: "protoboard/extensions",
        });
        continue;
      }
      views.push({ ...v, extension: e.manifest.id, ...(e.package ? { package: e.package } : {}) });
    }
  }
  return { views, diagnostics };
}

export function resolveSkills(p: Project, extensions: LoadedExtension[]): ResolvedSkill[] {
  return extensions.flatMap((e) =>
    (e.manifest.skills ?? []).map((s) => {
      const base = s.package ? packageRoot(p.root, s.package) : e.root;
      const file = base ? join(base, s.path) : undefined;
      return { ...s, extension: e.manifest.id, ...(e.package ? { provider: e.package } : {}), file: file && existsSync(file) ? file : undefined };
    }),
  );
}

export interface ToolStatus {
  extension: string;
  id: string;
  purpose: string;
  available: boolean;
  detail?: string;
  install?: string;
  /** The managed runtime that provides it, when the tool declares one. */
  runtime?: string;
  /**
   * For a tool with a runtime: where the probe found it. `environment`: the
   * runtime's variable is set by the user (it overrides the project runtime);
   * `runtime`: the project runtime is installed; `system`: neither.
   */
  source?: "environment" | "runtime" | "system";
  /** Something to know about an available tool (a slow first run). */
  note?: string;
}

/**
 * Probe every tool the extensions declare. With `root`, the project's
 * installed runtimes are visible to the probes (`toolEnvironment`).
 */
export function probeTools(extensions: LoadedExtension[], options: { root?: string; log?: (line: string) => void } = {}): ToolStatus[] {
  const te = options.root ? toolEnvironment(options.root) : undefined;
  const env = te ? { ...process.env, ...te.overrides } : process.env;
  return extensions.flatMap((e) =>
    (e.manifest.tools ?? []).map((t) => {
      const r = probeTool(t, env, { ...(options.root ? { root: options.root } : {}), ...(options.log ? { log: options.log } : {}) });
      const status: ToolStatus = { extension: e.manifest.id, id: t.id, purpose: t.purpose, available: r.available, ...(r.detail !== undefined ? { detail: r.detail } : {}) };
      // a slow first run, said where the result is read
      if (r.available && r.firstRun && (r.ms ?? 0) >= 5000) status.note = `first run took ${Math.round(r.ms! / 1000)} s; later runs are faster`;
      if (!r.available && t.install) status.install = t.install;
      if (t.runtime) {
        const rt = t.runtime;
        status.runtime = rt.id;
        status.source = rt.env && process.env[rt.env] ? "environment" : te?.runtimes.includes(rt.id) ? "runtime" : "system";
      }
      return status;
    }),
  );
}

/** Load "./ops/x.ts#name" from an extension. */
export async function loadEntry<T>(ext: LoadedExtension, entry: string): Promise<T> {
  const [file, name = "default"] = entry.split("#");
  const mod = await importTs(join(ext.root, file));
  const fn = (mod as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`${ext.manifest.id}: ${entry} is not a function export`);
  return fn as T;
}

// ---------------------------------------------------------------------------
// Extension checks: contribute diagnostics to `protoboard check`
// ---------------------------------------------------------------------------

export type ExtensionCheck = (p: Project) => Promise<Omit<ProjectDiagnostic, "validator">[]> | Omit<ProjectDiagnostic, "validator">[];

export async function runExtensionChecks(p: Project, extensions: LoadedExtension[]): Promise<void> {
  for (const ext of extensions) {
    for (const c of ext.manifest.checks ?? []) {
      const validator = `ext:${ext.manifest.id}/${c.id}`;
      try {
        const fn = await loadEntry<ExtensionCheck>(ext, c.entry);
        const found = await fn(p);
        for (const d of found) p.diagnostics.push({ ...d, validator });
        p.checks.push({
          validator,
          status: "ran",
          counts: {
            error: found.filter((d) => d.severity === "error").length,
            warning: found.filter((d) => d.severity === "warning").length,
            info: found.filter((d) => d.severity === "info").length,
          },
        });
      } catch (e) {
        p.checks.push({ validator, status: "skipped", reason: (e as Error).message.split("\n")[0], counts: { error: 0, warning: 0, info: 0 } });
      }
    }
  }
}

export const relPath = (p: Project, abs: string) => projectRelative(p.root, abs);

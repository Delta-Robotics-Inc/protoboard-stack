/**
 * Capabilities (docs/specs/tool-integrations.md §2–§4): contracts that any
 * number of tool providers implement, chosen per custom module by a config
 * file next to it.
 *
 *   src/boards/<module>/
 *     <module>.uhd.ts       the module (UHD, tool-neutral)
 *     circuit.config.ts     provider + constraints (this file selects the tool)
 *     <native>/             provider-owned design files
 *     out/                  standard outputs, the only files downstream reads
 *
 * A provider is an ordinary extension whose manifest declares the capability
 * with entries for generate, export, extract and check. The framework runs
 * them as operations (records, effects, tool probes), validates what export
 * writes against the standard outputs, checks the facts extract returns, and
 * merges the provider's check into `protoboard check` under its own name.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { reachableDefinitions, type ArtifactDef, type GeometryFrame, type ModuleDef, type ModuleLookup } from "@deltarobotics/uhd";
import { stableStringify } from "./build.js";
import {
  CAPABILITIES,
  CAPABILITY_OPERATIONS,
  capabilityOperation,
  loadEntry,
  probeTools,
  type CapabilityDecl,
  type CapabilityId,
  type CapabilityOperation,
  type DeclaredArtifact,
  type ExtensionRequest,
  type LoadedExtension,
} from "./extensions.js";
import { expandGlob, importTs, locateId, outsideCatalog, packageRoot, sha256 } from "./load.js";
import { invokeOperation, listOperationRecords, type OperationContext, type OperationFn, type OperationRecord, type OperationResult, type RunOptions } from "./operations.js";
import { ownedOutputs, PROCESS_EXPORTS, STANDARD_OUTPUTS, validateOutputs, type CadProcess } from "./outputs.js";
import type { Project } from "./project.js";
import { boardNetlist, boardOptions } from "./board-netlist.js";
import { pinnedForm } from "./vendored-layout.js";
import { VIEW_FILES, VIEW_TITLES, isModelFile } from "./view-ids.js";
import { importFailure, renamedPackage } from "./scope.js";
import { withToolEnvironment } from "./tools.js";
import type { EntityRef, ProjectDiagnostic, Severity, SourceLocation } from "./types.js";

/** Default export of `<capability>.config.ts`. */
export interface CapabilityConfig {
  /** npm package of the provider extension, e.g. "@protoboardai/ext-tscircuit". */
  provider: string;
  /** Module id this config designs. Optional when exactly one module is declared in this folder. */
  module?: string;
  /** Provider design constraints (board size limit, layer count, fab profile; wall, clearance, material). */
  constraints?: Record<string, unknown>;
  /** cad: manufacturing process, which decides the required manufacturing exports (print: STL or 3MF; cut: DXF). */
  process?: CadProcess;
}

export function defineCapabilityConfig(config: CapabilityConfig): CapabilityConfig {
  return config;
}

/** A module bound to a provider by its config file. Paths are project-relative with forward slashes. */
export interface CapabilityBinding {
  capability: CapabilityId;
  /** The config file. */
  config: string;
  configDigest: string;
  /** Provider directory: the config's folder. */
  dir: string;
  /** Standard outputs folder (`<dir>/out`). */
  out: string;
  /** Provider-owned native folder (`<dir>/<native>`), when the provider is loaded. */
  native?: string;
  provider: string;
  constraints: Record<string, unknown>;
  process?: CadProcess;
  /** Module id, when resolved. */
  module?: string;
  /** Instance paths of the module in the system. */
  instances: string[];
  /** Why operations cannot run (provider not installed, module unresolved, …). Undefined when ready. */
  problem?: string;
  /** Ids of the artifacts the provider declares that were attached to the module at load (PB-1030). */
  attached?: string[];
}

/** What a capability operation receives: an operation context plus the module it works on. */
export interface CapabilityContext extends OperationContext {
  capability: CapabilityId;
  /** One of the four, or an operation the provider declares beside them (circuit:lock). */
  operation: CapabilityOperation | (string & {});
  module: {
    id: string;
    definition: ModuleDef;
    /** The instance path the operation was invoked with, if it was invoked by path. */
    instance?: string;
    /** Every instance path of the module in the system. */
    instances: string[];
    dir: string;
    out: string;
    native: string;
  };
  constraints: Record<string, unknown>;
  process?: CadProcess;
}

/** What a capability operation returns. `check` must return `diagnostics` (an empty array when clean). */
export interface CapabilityResult extends OperationResult {
  diagnostics?: Omit<ProjectDiagnostic, "validator">[];
}

export type CapabilityOperationFn = (ctx: CapabilityContext) => Promise<CapabilityResult> | CapabilityResult;

/**
 * What `extract` returns as `data`: facts read back from the native design,
 * in the module's own terms, ready to be written into UHD by an explicit
 * re-binding step.
 */
export interface ExtractedFacts {
  /** Frames of the module's interfaces and exports, by id (mm, module coordinates). */
  frames?: Record<string, GeometryFrame>;
  /** Artifacts the module should reference: standard outputs and the native source. */
  artifacts?: ArtifactDef[];
}

const VALIDATOR = "protoboard/capabilities";
const OUTPUTS_VALIDATOR = "protoboard/standard-outputs";
const posix = (p: string) => p.split("\\").join("/");
const checkValidator = (ext: LoadedExtension, capability: string) => `ext:${ext.manifest.id}/${capability}:check`;

// ---------------------------------------------------------------------------
// Discovery and binding
// ---------------------------------------------------------------------------

export interface DiscoveredConfig {
  capability: CapabilityId;
  file: string;
  digest: string;
  config?: CapabilityConfig;
}

/**
 * Find `<capability>.config.ts` files where the project's sources live (the
 * folders of the `sources` globs) and evaluate them. Edited configs are read
 * again on the next load.
 */
export async function discoverCapabilityConfigs(p: Project): Promise<{ configs: DiscoveredConfig[]; diagnostics: ProjectDiagnostic[] }> {
  const diagnostics: ProjectDiagnostic[] = [];
  const names = new Map(CAPABILITIES.map((c) => [`${c}.config.ts`, c]));
  const files = new Set<string>();
  for (const pattern of p.config.sources ?? ["src/**/*.uhd.ts"]) {
    const glob = /^(.*?)\/?\*\*\/\*(\.[\w.]+)$/.exec(pattern);
    if (glob) for (const f of expandGlob(p.root, `${glob[1] ? glob[1] + "/" : ""}**/*.config.ts`)) files.add(f);
    else for (const name of names.keys()) if (existsSync(join(p.root, dirname(pattern), name))) files.add(join(p.root, dirname(pattern), name));
  }
  const configs: DiscoveredConfig[] = [];
  // never a config in the catalog folder: vendored files are not the project's code (PB-1048)
  for (const abs of outsideCatalog(p.root, p.config, [...files].sort())) {
    const capability = names.get(basename(abs));
    if (!capability) continue;
    const file = posix(relative(p.root, abs));
    const found: DiscoveredConfig = { capability, file, digest: sha256(readFileSync(abs)) };
    const bad = (message: string, line?: number) =>
      diagnostics.push({ code: "PB_CAPABILITY_CONFIG_INVALID", severity: "error", entity: { kind: "project", id: file }, message: `${file}: ${message}`, source: { file, ...(line ? { line } : {}) }, validator: VALIDATOR });
    let config: unknown;
    try {
      config = (await importTs<{ default?: unknown }>(abs, { fresh: true })).default;
    } catch (e) {
      bad(`could not evaluate: ${importFailure(e)}`);
      configs.push(found);
      continue;
    }
    const c = config as Partial<CapabilityConfig> & { capability?: unknown };
    if (!c || typeof c !== "object") bad("no default export; export default defineCapabilityConfig({ provider: \"<package>\", constraints: { … } })");
    else if (typeof c.provider !== "string" || !c.provider) bad("names no provider (the npm package of the extension that designs this module)");
    else if (c.module !== undefined && typeof c.module !== "string") bad("module must be a module id");
    else if (c.constraints !== undefined && (typeof c.constraints !== "object" || Array.isArray(c.constraints))) bad("constraints must be an object");
    else if (c.process !== undefined && (capability !== "cad" || !(c.process in PROCESS_EXPORTS))) {
      bad(capability === "cad" ? `process must be one of ${Object.keys(PROCESS_EXPORTS).join(", ")}` : "process applies to cad configs only", locateId(abs, String(c.process), p.root, "process").line);
    } else {
      const known = ["provider", "module", "constraints", "process"];
      for (const k of Object.keys(c).filter((k) => !known.includes(k))) {
        diagnostics.push({ code: "PB_CAPABILITY_CONFIG_UNKNOWN_KEY", severity: "warning", entity: { kind: "project", id: file }, message: `${file}: unknown key ${k} (provider settings go in constraints)`, source: { file }, validator: VALIDATOR });
      }
      found.config = c as CapabilityConfig;
    }
    configs.push(found);
  }
  return { configs, diagnostics };
}

/** Providers named by module configs: loaded like configured extensions, reported by the binding when missing. */
export function providerRequests(p: Project, configs: DiscoveredConfig[]): ExtensionRequest[] {
  return configs
    .filter((c) => c.config)
    .map((c) => ({ name: c.config!.provider, source: locateId(join(p.root, c.file), c.config!.provider, p.root, "provider"), implicit: true }));
}

/** The loaded extension published as `pkg`. */
export function providerExtension(p: Project, pkg: string): LoadedExtension | undefined {
  return p.extensions.find((e) => e.package === pkg);
}

export function capabilityDecl(ext: LoadedExtension, capability: string): CapabilityDecl | undefined {
  return (ext.manifest.capabilities ?? []).find((c) => c.id === capability);
}

const nativeFolder = (ext: LoadedExtension, decl: CapabilityDecl) => decl.native ?? (ext.package ?? ext.manifest.id).replace(/^@[^/]+\//, "").replace(/^ext-/, "");

/**
 * Resolve each config to its module and provider. Sets `p.capabilities` and
 * adds the `protoboard/capabilities` diagnostics and check run.
 */
export function bindCapabilities(p: Project, found: { configs: DiscoveredConfig[]; diagnostics: ProjectDiagnostic[] }): void {
  const diagnostics = [...found.diagnostics];
  const bindings: CapabilityBinding[] = [];
  for (const c of found.configs) {
    if (!c.config) continue;
    const abs = join(p.root, c.file);
    const dir = posix(dirname(c.file));
    const config = c.config;
    const at = (key: string, value: string): SourceLocation => locateId(abs, value, p.root, key);
    const keyAt = (key: string): SourceLocation => {
      const line = readFileSync(abs, "utf8").split("\n").findIndex((l) => new RegExp(`\\b${key.replace(/\W/g, "")}\\s*:`).test(l));
      return { file: c.file, ...(line >= 0 ? { line: line + 1 } : {}) };
    };
    const b: CapabilityBinding = {
      capability: c.capability,
      config: c.file,
      configDigest: c.digest,
      dir,
      out: `${dir}/out`,
      provider: config.provider,
      constraints: config.constraints ?? {},
      ...(config.process ? { process: config.process } : {}),
      instances: [],
    };
    const report = (code: string, message: string, source: SourceLocation, severity: Severity = "error", fatal = severity === "error") => {
      const entity: EntityRef = b.module ? { kind: "definition", id: b.module } : { kind: "project", id: c.file };
      diagnostics.push({ code, severity, entity, message, source, validator: VALIDATOR });
      if (fatal && !b.problem) b.problem = message;
    };

    // ---- module: named, or the one declared next to the config
    if (config.module) {
      if (p.definitions.has(config.module)) b.module = config.module;
      else report("PB_CAPABILITY_MODULE_NOT_FOUND", `${c.file} names module ${config.module}, which no source or catalog entry defines`, at("module", config.module));
    } else {
      const here = [...p.definitions.values()].filter((r) => r.origin.kind === "local" && posix(dirname(r.origin.source.file)) === dir).map((r) => r.def.id);
      if (here.length === 1) b.module = here[0];
      else if (!here.length) report("PB_CAPABILITY_MODULE_NOT_FOUND", `no module is declared in ${dir}/ for ${c.file}; add ${basename(dir)}.uhd.ts there or name it with module: "<id>"`, { file: c.file });
      else report("PB_CAPABILITY_MODULE_AMBIGUOUS", `${dir}/ declares ${here.join(", ")}; name the one ${c.file} designs with module: "<id>"`, { file: c.file });
    }
    if (b.module) b.instances = p.instances.filter((i) => i.definition === b.module).map((i) => i.path);

    // ---- provider: installed, loaded, and providing this capability
    const ext = providerExtension(p, config.provider);
    const providerAt = at("provider", config.provider);
    if (!ext) {
      if (packageRoot(p.root, config.provider)) report("PB_PROVIDER_UNAVAILABLE", `${c.capability} provider ${config.provider} is installed but did not load (see its PB_EXTENSION_* diagnostic)`, providerAt);
      else if (renamedPackage(config.provider)) report("PB_PROVIDER_NOT_INSTALLED", `${c.capability} provider ${config.provider} (named by ${c.file}) is not installed: it was renamed to ${renamedPackage(config.provider)}; name that in ${c.file} (see PB_PACKAGE_SCOPE_RENAMED)`, providerAt);
      else report("PB_PROVIDER_NOT_INSTALLED", `${c.capability} provider ${config.provider} (named by ${c.file}) is not installed; run npm install ${config.provider}`, providerAt);
    } else {
      const decl = capabilityDecl(ext, c.capability);
      if (!decl) {
        const offers = (ext.manifest.capabilities ?? []).map((x) => x.id);
        report("PB_PROVIDER_LACKS_CAPABILITY", `${config.provider} does not provide ${c.capability} (it provides ${offers.join(", ") || "no capabilities"}); name a ${c.capability} provider in ${c.file}`, providerAt);
      } else {
        b.native = `${dir}/${nativeFolder(ext, decl)}`;
        if (decl.constraints) {
          for (const k of Object.keys(b.constraints).filter((k) => !decl.constraints![k])) {
            report("PB_CAPABILITY_CONSTRAINT_UNKNOWN", `${config.provider} has no constraint ${k} (it takes ${Object.keys(decl.constraints).join(", ") || "none"})`, keyAt(k), "warning");
          }
          for (const [k, spec] of Object.entries(decl.constraints)) {
            if (spec.required && b.constraints[k] === undefined) report("PB_CAPABILITY_CONSTRAINT_MISSING", `${config.provider} needs constraint ${k}: ${spec.description}`, { file: c.file });
          }
        }
      }
    }
    const twin = b.module && bindings.find((x) => x.capability === b.capability && x.module === b.module);
    if (twin) report("PB_CAPABILITY_DUPLICATE", `${b.module} has two ${b.capability} configs (${twin.config} and ${c.file}); keep one`, { file: c.file });
    bindings.push(b);
  }
  p.capabilities = bindings;
  p.diagnostics.push(...diagnostics);
  if (found.configs.length) {
    const n = (s: Severity) => diagnostics.filter((d) => d.severity === s).length;
    p.checks.push({ validator: VALIDATOR, status: "ran", counts: { error: n("error"), warning: n("warning"), info: n("info") } });
  }
}

// ---------------------------------------------------------------------------
// Outputs no view can reach (PB-1030)
// ---------------------------------------------------------------------------

const VIEWS_VALIDATOR = "protoboard/views";

/**
 * A bound module's files on disk that a viewer tab would draw (out/'s
 * schematic.svg, pcb-top.svg, pcb-bottom.svg, bom.csv and GLBs, the native
 * circuit.json) while the module has no artifact for them: the tab does not
 * appear, as a large field board's PCB tab did not. A warning on a board (a circuit
 * config), info otherwise. With the provider's declared artifacts attached
 * this happens only when the provider is not loaded or declares none, or the
 * module's own artifact of that id points elsewhere; it says which.
 */
export function viewReachDiagnostics(p: Project, b: CapabilityBinding): ProjectDiagnostic[] {
  if (!b.module) return [];
  const rec = p.definitions.get(b.module);
  if (!rec) return [];
  const def = rec.def;
  const listed = new Set((def.artifacts ?? []).flatMap((a) => (a.filePath ? [posix(a.filePath).replace(/\/+$/, "")] : [])));
  const onDisk: { file: string; view: string }[] = [];
  const at = (file: string, view: string) => existsSync(join(p.root, file)) && !listed.has(file) && onDisk.push({ file, view });
  for (const [view, names] of Object.entries(VIEW_FILES)) for (const name of names) at(`${b.out}/${name}`, view);
  if (b.native) at(`${b.native}/circuit.json`, "pcb");
  const outDir = join(p.root, b.out);
  // the 3D tab draws any GLB: a model in out/ is unreachable only when the module has none at all (a part's interface GLBs beside its body are fine)
  const hasModel = (def.artifacts ?? []).some((a) => isModelFile(a.filePath ?? a.url ?? ""));
  if (!hasModel && existsSync(outDir) && statSync(outDir).isDirectory()) for (const name of readdirSync(outDir).filter(isModelFile).sort()) at(`${b.out}/${name}`, "3d");
  if (!onDisk.length) return [];
  const ext = providerExtension(p, b.provider);
  const declared = ext ? (capabilityDecl(ext, b.capability)?.artifacts ?? []) : [];
  const resolved = ext ? declaredArtifacts(b, { artifacts: declared }, ext.manifest.id) : [];
  // the module's own artifact of a declared id that names another file (explicit artifacts win)
  const shadowed = resolved.flatMap((a) => {
    const own = onDisk.some((f) => f.file === a.filePath) ? (def.artifacts ?? []).find((o) => o.id === a.id && o.filePath !== a.filePath) : undefined;
    return own ? [`its own artifact ${own.id} names ${own.filePath ?? own.url ?? "no file"}`] : [];
  });
  const why = !ext
    ? `its ${b.capability} provider ${b.provider} is not loaded (${b.problem ?? "see its diagnostic"}), so nothing attaches its outputs`
    : shadowed.length
      ? `the module overrides the provider's artifacts: ${shadowed.join("; ")}`
      : !declared.length
        ? `its provider ${b.provider} declares no artifacts for its outputs`
        : `no artifact of the module names them`;
  const tabs = [...new Set(onDisk.map((f) => VIEW_TITLES[f.view] ?? f.view))];
  return [
    {
      code: "PB_VIEW_UNREACHABLE",
      severity: b.capability === "circuit" ? "warning" : "info",
      entity: { kind: "definition", id: def.id },
      message: `${def.id} has ${onDisk.map((f) => f.file).join(", ")} on disk, but no artifact of the module names ${onDisk.length === 1 ? "it" : "them"}, so the viewer shows no ${tabs.join(", ")} ${tabs.length === 1 ? "tab" : "tabs"} for them: ${why}. List them in the module's artifacts, or let the provider attach them (\`protoboard views check --module ${def.id}\` shows the tabs)`,
      source: rec.origin.kind === "local" ? locateId(join(p.root, rec.origin.source.file), def.id, p.root) : { file: b.config },
      validator: VIEWS_VALIDATOR,
    },
  ];
}

// ---------------------------------------------------------------------------
// Declared artifacts (PB-1030)
// ---------------------------------------------------------------------------

/** The definition as the project declared it, for a definition core gave the provider's artifacts. */
const DECLARED_FROM = new WeakMap<ModuleDef, ModuleDef>();

/** The definition without the artifacts its provider declared: what the project itself states. */
export const asDeclared = (def: ModuleDef): ModuleDef => DECLARED_FROM.get(def) ?? def;

/** A provider's declared artifacts for one binding, with their paths resolved (project-relative). */
export function declaredArtifacts(b: Pick<CapabilityBinding, "dir" | "out" | "native" | "module">, decl: Pick<CapabilityDecl, "artifacts">, provider: string): ArtifactDef[] {
  if (!b.native || !b.module) return [];
  const folders: Record<string, string> = { out: b.out, native: b.native, dir: b.dir };
  return (decl.artifacts ?? []).map((a: DeclaredArtifact) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    ...(a.role ? { role: a.role } : {}),
    ...(a.format ? { format: a.format } : {}),
    ...(a.units ? { units: a.units } : {}),
    filePath: a.path.replace(/^\{(out|native|dir)\}/, (_, k: string) => folders[k]).split("{module}").join(b.module!),
    provenance: { tool: provider, ...(a.generatedFrom ? { generatedFrom: a.generatedFrom } : {}) },
  }));
}

/** The artifacts core attached to a definition from its provider's declaration (none for a definition as written). */
export function attachedArtifacts(def: ModuleDef): ArtifactDef[] {
  const was = DECLARED_FROM.get(def);
  if (!was) return [];
  const own = new Set(was.artifacts ?? []);
  return (def.artifacts ?? []).filter((a) => !own.has(a));
}

/** `def` with `extra` artifacts added, except those it lists itself by id or file path. */
export function withArtifacts(def: ModuleDef, extra: ArtifactDef[]): ModuleDef {
  const own = def.artifacts ?? [];
  const add = extra.filter((a) => !own.some((o) => o.id === a.id || (o.filePath !== undefined && posix(o.filePath).replace(/\/+$/, "") === a.filePath)));
  return add.length ? { ...def, artifacts: [...own, ...add] } : def;
}

/**
 * Give each bound module the artifacts its provider declares whose files
 * exist (its standard outputs, the native build, a locked board's KiCad
 * project), so the viewer's tabs and the model checks find them without the
 * project listing them. An artifact the module lists itself with the same id
 * or file path is kept as it is: explicit artifacts override. The module's
 * definition is replaced by a copy (the source's object is never changed);
 * `asDeclared` gives the definition as written, for digests.
 */
export function attachDeclaredArtifacts(p: Project): void {
  const used = new Set(p.instances.map((i) => i.definition));
  for (const b of p.capabilities) {
    if (!b.module || !b.native) continue;
    const ext = providerExtension(p, b.provider);
    const decl = ext && capabilityDecl(ext, b.capability);
    if (!ext || !decl?.artifacts?.length) continue;
    const rec = p.definitions.get(b.module);
    // project-relative paths: only a definition whose artifacts resolve against the project
    if (!rec || rec.origin.artifactBase.kind !== "project") continue;
    const def = withArtifacts(rec.def, declaredArtifacts(b, decl, ext.manifest.id).filter((a) => existsSync(join(p.root, a.filePath!))));
    if (def === rec.def) continue;
    const add = (def.artifacts ?? []).slice((rec.def.artifacts ?? []).length);
    DECLARED_FROM.set(def, asDeclared(rec.def));
    rec.def = def;
    if (p.rootDef?.id === def.id) p.rootDef = def;
    b.attached = add.map((a) => a.id);
    if (used.has(def.id))
      for (const a of add) p.artifacts.push({ definition: def.id, id: a.id, role: a.role, format: a.format, filePath: a.filePath, resolved: join(p.root, a.filePath!), base: "project", present: true });
  }
}

/**
 * The binding for `<capability>` of a module given by instance path or
 * module id. Throws an actionable error when there is none or it cannot run.
 */
export function findBinding(p: Project, capability: string, moduleRef: string): { binding: CapabilityBinding; ext: LoadedExtension; decl: CapabilityDecl; def: ModuleDef; instance?: string } {
  if (!(CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`unknown capability "${capability}" (known: ${CAPABILITIES.join(", ")})`);
  const inst = p.instances.find((i) => i.path === moduleRef && i.path !== "");
  const id = inst ? inst.definition : moduleRef;
  const bound = p.capabilities.filter((b) => b.capability === capability);
  if (!p.definitions.has(id)) {
    throw new Error(`no instance path or module "${moduleRef}"; modules with a ${capability} config: ${bound.map((b) => b.module ?? b.config).join(", ") || "none"}`);
  }
  const binding = bound.find((b) => b.module === id);
  if (!binding) throw new Error(`${id} has no ${capability}.config.ts next to it; modules with a ${capability} config: ${bound.map((b) => b.module ?? b.config).join(", ") || "none"}`);
  if (binding.problem) throw new Error(binding.problem);
  const ext = providerExtension(p, binding.provider)!;
  return { binding, ext, decl: capabilityDecl(ext, capability)!, def: p.definitions.get(id)!.def, ...(inst ? { instance: inst.path } : {}) };
}

function capabilityContext(base: OperationContext, b: CapabilityBinding, def: ModuleDef, operation: CapabilityOperation, instance?: string): CapabilityContext {
  return {
    ...base,
    capability: b.capability,
    operation,
    module: { id: def.id, definition: def, ...(instance ? { instance } : {}), instances: b.instances, dir: b.dir, out: b.out, native: b.native! },
    constraints: b.constraints,
    ...(b.process ? { process: b.process } : {}),
  };
}

/** A provider's check findings, attributed to it; a finding without a source points at the module's config. */
function attribute(b: CapabilityBinding, ext: LoadedExtension, found: unknown): { diagnostics: ProjectDiagnostic[]; invalid?: string } {
  if (!Array.isArray(found)) return { diagnostics: [], invalid: "check returned no diagnostics array (return [] when the design matches)" };
  const validator = checkValidator(ext, b.capability);
  const diagnostics: ProjectDiagnostic[] = [];
  for (const d of found as Partial<ProjectDiagnostic>[]) {
    if (!d || typeof d.code !== "string" || typeof d.message !== "string" || !["error", "warning", "info"].includes(d.severity as string)) {
      return { diagnostics, invalid: `check returned a malformed diagnostic: ${JSON.stringify(d).slice(0, 120)}` };
    }
    const { entity, source, ...rest } = d as ProjectDiagnostic;
    diagnostics.push({ ...rest, entity: entity ?? { kind: "definition", id: b.module! }, source: source ?? { file: b.config }, validator });
  }
  return { diagnostics };
}

/** Problems with the facts extract returned. */
export function checkExtractedFacts(p: Project, def: ModuleDef, data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["extract returned no facts (data must be { frames?, artifacts? })"];
  const facts = data as ExtractedFacts;
  const problems: string[] = [];
  const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  for (const [id, f] of Object.entries(facts.frames ?? {})) {
    if (!def.interfaces.some((i) => i.id === id) && !(def.exports ?? []).some((e) => e.id === id)) problems.push(`frame for ${id}, which is not an interface or export of ${def.id}`);
    else if (!f || !vec(f.origin) || !vec(f.normal) || (f.xAxis !== undefined && !vec(f.xAxis))) problems.push(`frame ${id}: origin and normal must be [x, y, z] in mm`);
    else if (Math.hypot(...f.normal) < 1e-9) problems.push(`frame ${id}: normal is zero`);
  }
  for (const a of facts.artifacts ?? []) {
    if (!a || typeof a.id !== "string" || typeof a.filePath !== "string") problems.push(`artifact ${JSON.stringify(a?.id)} needs an id and a filePath`);
    else if (!existsSync(join(p.root, a.filePath))) problems.push(`artifact ${a.id}: ${a.filePath} does not exist`);
  }
  return problems;
}

/**
 * Digest of a module's definition and every definition it contains, sorted
 * by id: what a capability operation designed from. Equal definitions give
 * equal digests on any machine.
 */
export function moduleDigest(def: ModuleDef, lookup: ModuleLookup): string {
  // as pinned: a catalog part whose files moved (parts migrate) is the same part
  // the provider's declared artifacts come and go with its outputs: not part of what was designed from (PB-1030)
  const defs = reachableDefinitions(def, lookup).map(asDeclared).map(pinnedForm).sort((a, b) => a.id.localeCompare(b.id));
  return sha256(stableStringify(defs));
}

const errorSummary = (ds: { severity: Severity; message: string }[]) => {
  const errors = ds.filter((d) => d.severity === "error");
  return `${errors.length} error(s), first: ${errors[0]?.message}`;
};

/** Capabilities bound in the same provider directory as `b` (they share its `out/`). */
const neighbours = (p: Project, b: CapabilityBinding): CapabilityId[] => p.capabilities.filter((o) => o !== b && o.dir === b.dir).map((o) => o.capability);

/** Remove what `b`'s capability owns in its `out/`, before an export's outputs go in. */
function clearOwnedOutputs(p: Project, b: CapabilityBinding): void {
  const out = join(p.root, b.out);
  for (const entry of ownedOutputs(out, b.capability, neighbours(p, b))) rmSync(join(out, entry), { recursive: true, force: true });
}

/**
 * An export writes its `out/` files into a staging folder beside `out/` (`.out.staging`), and only
 * when it succeeds are the capability's old outputs removed and the staged ones renamed into
 * `out/`. A failed or crashed export leaves the last good `out/` as it was, and nothing reading
 * `out/` meanwhile (a viewer, a file watcher) sees it half written.
 */
export function exportStaging(p: Project, b: CapabilityBinding) {
  const staged = `${dirname(b.out)}/.${basename(b.out)}.staging`;
  const abs = join(p.root, staged);
  const drop = () => rmSync(abs, { recursive: true, force: true });
  return {
    staged,
    prepare: drop,
    redirect: (path: string) => (path === b.out || path.startsWith(`${b.out}/`) ? staged + path.slice(b.out.length) : undefined),
    commit: () => {
      clearOwnedOutputs(p, b);
      const out = join(p.root, b.out);
      mkdirSync(out, { recursive: true });
      if (existsSync(abs)) {
        for (const entry of readdirSync(abs)) {
          rmSync(join(out, entry), { recursive: true, force: true });
          renameSync(join(abs, entry), join(out, entry));
        }
      }
      drop();
    },
    abort: drop,
  };
}

/**
 * Standard-output findings for one bound module, as project diagnostics. A
 * module that was never exported gets one info finding, unless `exported`
 * says an export just ran (then everything missing is an error).
 */
export function standardOutputDiagnostics(p: Project, b: CapabilityBinding, exported = false, records?: { file: string; record: OperationRecord }[]): ProjectDiagnostic[] {
  const def = p.definitions.get(b.module!)!.def;
  if (!exported && !ownedOutputs(join(p.root, b.out), b.capability, neighbours(p, b)).length) {
    // name the capability: a board may have its circuit outputs and not yet its firmware's, in one out/
    const others = neighbours(p, b).filter((c) => ownedOutputs(join(p.root, b.out), c, [b.capability, ...neighbours(p, b)].filter((x) => x !== c)).length);
    return [
      {
        code: "PB_OUTPUT_NOT_EXPORTED",
        severity: "info",
        entity: { kind: "definition", id: def.id },
        message: `${def.id} has no ${b.capability} outputs yet (${b.out}/${others.length ? `, which holds its ${others.join(" and ")} outputs` : ""}); run \`protoboard run ${b.capability}:export --module ${def.id}\``,
        source: { file: b.config },
        validator: OUTPUTS_VALIDATOR,
      },
    ];
  }
  const found: ProjectDiagnostic[] = validateOutputs({ capability: b.capability, outDir: join(p.root, b.out), module: def, lookup: p.lookup, process: b.process, ...(b.capability === "circuit" ? { components: boardNetlist(def, p.lookup, boardOptions(p)).components.map((c) => c.instance) } : {}) }).map((f) => ({
    code: f.code,
    severity: f.severity,
    entity: { kind: "definition", id: def.id },
    message: `${b.out}/${f.file ? f.file : ""}: ${f.message}`,
    source: { file: f.file ? `${b.out}/${f.file}` : b.out, ...(f.line ? { line: f.line } : {}) },
    validator: OUTPUTS_VALIDATOR,
  }));
  return exported ? found : [...found, ...editedOutputDiagnostics(p, b, def, records ?? listOperationRecords(p))];
}

/** Files under `rel` (a file, or a directory with a trailing slash), project-relative. */
const filesUnder = (root: string, rel: string): string[] => {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [rel.replace(/\/$/, "")];
  return readdirSync(abs).sort().flatMap((n) => filesUnder(root, `${rel.replace(/\/$/, "")}/${n}${statSync(join(abs, n)).isDirectory() ? "/" : ""}`));
};

/**
 * A module's standard outputs against the latest export that wrote them
 * (PB-869): a file whose bytes differ from what the export wrote was edited
 * by hand; a file the export did not write, or one it wrote that is gone,
 * is not that export's output. Warnings (`PB_OUTPUT_STALE`), as stale
 * findings are: release refuses them. A module with no export record (a
 * copied project) is left to release, which refuses it.
 */
function editedOutputDiagnostics(p: Project, b: CapabilityBinding, def: ModuleDef, records: { file: string; record: OperationRecord }[]): ProjectDiagnostic[] {
  const done = records.filter((r) => r.record.status === "succeeded");
  let at = -1;
  done.forEach((r, i) => {
    if (r.record.operation === `${b.capability}:export` && r.record.capability?.module === b.module) at = i;
  });
  if (at < 0) return [];
  const rec = done[at];
  const owned = ownedOutputs(join(p.root, b.out), b.capability, neighbours(p, b));
  const present = owned.flatMap((e) => filesUnder(p.root, `${b.out}/${e}`)).map(posix);
  // an export writes only what its capability owns in out/ (it clears that first), so all it wrote there is this capability's
  const wrote = new Map(rec.record.outputs.filter((o) => o.path.startsWith(`${b.out}/`)).map((o) => [o.path, o.digest]));
  // a later operation may write into out/ too (the latest writer of each file is the one to compare with)
  const later = new Map<string, { file: string; digest: string; operation: string }>();
  for (const r of done.slice(at + 1)) for (const o of r.record.outputs) if (o.path.startsWith(`${b.out}/`)) later.set(o.path, { file: r.file, digest: o.digest, operation: r.record.operation });
  const rerun = `protoboard run ${b.capability}:export --module ${def.id}`;
  const out: ProjectDiagnostic[] = [];
  const add = (file: string, message: string) =>
    out.push({
      code: "PB_OUTPUT_STALE",
      severity: "warning",
      entity: { kind: "definition", id: def.id },
      message: `${file}: ${message}`,
      source: { file },
      validator: OUTPUTS_VALIDATOR,
    });
  for (const f of present) {
    const w = later.get(f) ?? (wrote.has(f) ? { file: rec.file, digest: wrote.get(f)!, operation: `${b.capability}:export` } : undefined);
    if (!w) add(f, `not written by the last ${b.capability}:export of ${def.id} (${rec.file}); remove it or run \`${rerun}\``);
    else if (sha256(readFileSync(join(p.root, f))) !== w.digest) add(f, `edited after ${w.operation} wrote it (${w.file}); re-run \`${w.operation === `${b.capability}:export` ? rerun : `protoboard run ${w.operation} --module ${def.id}`}\` instead of editing generated outputs`);
  }
  for (const f of [...wrote.keys()].sort()) {
    if (!present.includes(f)) add(f, `written by the last ${b.capability}:export of ${def.id} (${rec.file}) and since removed; run \`${rerun}\``);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running capability operations
// ---------------------------------------------------------------------------

/**
 * `protoboard run <capability>:<operation> --module <instance path or module id>`.
 * generate, export and extract write only inside the module's provider
 * directory and leave an operation record; check is pure. export first
 * removes what the capability owns in `out/` (`OWNED_OUTPUTS`), so `out/`
 * holds exactly the latest export of each capability bound in the module's
 * directory. export's standard
 * outputs and extract's facts are validated, and a run whose results fail
 * validation is recorded as failed with the findings attached.
 */
export async function runCapabilityOperation(
  p: Project,
  capability: string,
  operation: string,
  moduleRef: string,
  inputs: Record<string, string> = {},
  options: RunOptions = {},
): Promise<OperationRecord> {
  return runCapability(p, capability, operation, moduleRef, inputs, options);
}

/**
 * One module's capability operation run in-process by `fn` in place of the
 * provider's entry, with everything else as `runCapabilityOperation` gives it:
 * the write guard, `out/` emptied before an export, the outputs validated and
 * a `<capability>:<operation>` record for that module. An alias that does
 * several modules' work in one run (a routing run over every harness) uses it
 * to leave each module the record it would get from its own run.
 */
export async function runCapabilityStep(
  p: Project,
  capability: string,
  operation: string,
  moduleRef: string,
  fn: CapabilityOperationFn,
  inputs: Record<string, string> = {},
  options: RunOptions = {},
): Promise<OperationRecord> {
  return runCapability(p, capability, operation, moduleRef, inputs, options, fn);
}

async function runCapability(
  p: Project,
  capability: string,
  operation: string,
  moduleRef: string,
  inputs: Record<string, string>,
  options: RunOptions,
  fn?: CapabilityOperationFn,
): Promise<OperationRecord> {
  const standard = (CAPABILITY_OPERATIONS as readonly string[]).includes(operation);
  if (!standard && !(CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`unknown operation ${capability}:${operation} (operations: ${CAPABILITY_OPERATIONS.join(", ")})`);
  const op = operation as CapabilityOperation;
  const { binding: b, ext, decl, def, instance } = findBinding(p, capability, moduleRef);
  // a provider's own operation (circuit:lock): declared beside the four, with its own effect
  const own = Object.keys(decl.operations).filter((k) => !(CAPABILITY_OPERATIONS as readonly string[]).includes(k));
  if (!standard && !own.includes(operation)) throw new Error(`unknown operation ${capability}:${operation} (operations: ${[...CAPABILITY_OPERATIONS, ...own].join(", ")})`);
  const spec = capabilityOperation(decl, op);
  return invokeOperation(
    p,
    ext,
    {
      id: `${capability}:${op}`,
      entry: spec.entry,
      ...(fn ? { fn: fn as OperationFn } : {}),
      effect: op === "check" ? "pure" : standard ? "export" : (spec.effect ?? "export"),
      requires: spec.requires,
      inputs: spec.inputs,
      capability: { id: capability, operation: op, provider: ext.manifest.id, module: def.id, ...(instance ? { instance } : {}), config: b.config, configDigest: b.configDigest, moduleDigest: moduleDigest(def, p.lookup) },
      guardWrite: (path) => {
        const r = relative(join(p.root, b.dir), join(p.root, path));
        return r.startsWith("..") || isAbsolute(r) ? `${capability}:${op} writes only inside the module's provider directory ${b.dir}/ (not ${path})` : undefined;
      },
      context: (ctx) => capabilityContext(ctx, b, def, op, instance),
      // out/ holds exactly the last export of each capability: nothing from an earlier export or another provider survives it,
      // and another capability's outputs in the same out/ (a board's circuit and firmware) are left alone
      // staged (exportStaging), so a failed export leaves the last good out/ in place
      ...(op === "export" ? (({ prepare, redirect, commit, abort }) => ({ prepare, stage: { redirect, commit, abort } }))(exportStaging(p, b)) : {}),
      after: (result) => {
        if (op === "check") {
          const { diagnostics, invalid } = attribute(b, ext, (result as CapabilityResult).diagnostics);
          return { result: invalid ? { ...result, status: "failed", summary: invalid } : result, diagnostics };
        }
        if (result.status !== "succeeded") return { result };
        if (op === "export") {
          const diagnostics = standardOutputDiagnostics(p, b, true);
          const failed = diagnostics.some((d) => d.severity === "error");
          return { result: failed ? { ...result, status: "failed", summary: `${result.summary}; standard outputs invalid: ${errorSummary(diagnostics)}` } : result, diagnostics };
        }
        if (op === "extract") {
          const problems = checkExtractedFacts(p, def, result.data);
          const diagnostics = problems.map((message) => ({ code: "PB_EXTRACT_INVALID", severity: "error" as const, entity: { kind: "definition" as const, id: def.id }, message, source: { file: b.config }, validator: VALIDATOR }));
          return { result: problems.length ? { ...result, status: "failed", summary: `${result.summary}; extracted facts invalid: ${problems[0]}` } : result, ...(problems.length ? { diagnostics } : {}) };
        }
        return { result };
      },
    },
    inputs,
    options,
  );
}

/** The definition ids a module uses, at any depth, that the project does not define (B6). */
export function undefinedParts(p: Project, module: string): string[] {
  const missing = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const def = p.definitions.get(id)?.def;
    if (!def) return void missing.add(id);
    for (const c of def.children ?? []) walk(c.moduleDefId);
  };
  walk(module);
  return [...missing].sort();
}

/**
 * `protoboard check`: standard outputs of every bound module, then each
 * provider's check, merged into the project's diagnostics. A check whose
 * tools are missing, or that throws, is recorded as skipped: unknown, not
 * passed.
 */
export async function runCapabilityChecks(p: Project): Promise<void> {
  const reach = p.capabilities.flatMap((b) => viewReachDiagnostics(p, b));
  p.diagnostics.push(...reach);
  if (p.capabilities.some((b) => b.module)) p.checks.push({ validator: VIEWS_VALIDATOR, status: "ran", counts: { error: 0, warning: reach.filter((d) => d.severity === "warning").length, info: reach.filter((d) => d.severity === "info").length } });
  const ready = p.capabilities.filter((b) => !b.problem);
  if (!ready.length) return;
  const records = listOperationRecords(p);
  const outputs = ready.flatMap((b) => standardOutputDiagnostics(p, b, false, records));
  p.diagnostics.push(...outputs);
  const n = (ds: ProjectDiagnostic[], s: Severity) => ds.filter((d) => d.severity === s).length;
  p.checks.push({ validator: OUTPUTS_VALIDATOR, status: "ran", counts: { error: n(outputs, "error"), warning: n(outputs, "warning"), info: n(outputs, "info") } });

  for (const b of ready) {
    const ext = providerExtension(p, b.provider)!;
    const decl = capabilityDecl(ext, b.capability)!;
    const spec = capabilityOperation(decl, "check");
    const validator = checkValidator(ext, b.capability);
    const skip = (reason: string) => p.checks.push({ validator, subject: b.module, status: "skipped", reason, counts: { error: 0, warning: 0, info: 0 } });
    // a module that uses parts that are not defined (library parts not fetched) cannot be read: its check is skipped,
    // and PB_UNRESOLVED_DEFINITION says why once per part (B6), instead of one finding per component and link
    const missing = b.module ? undefinedParts(p, b.module) : [];
    if (missing.length) {
      skip(`${missing.length} part${missing.length === 1 ? " it uses is" : "s it uses are"} not defined (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}): see PB_UNRESOLVED_DEFINITION`);
      continue;
    }
    const tools = probeTools([{ ...ext, manifest: { ...ext.manifest, tools: (ext.manifest.tools ?? []).filter((t) => spec.requires?.includes(t.id)) } }], { root: p.root }).filter((t) => !t.available);
    if (tools.length) {
      skip(`required tool(s) unavailable: ${tools.map((t) => t.id).join(", ")}`);
      continue;
    }
    const def = p.definitions.get(b.module!)!.def;
    const base: OperationContext = {
      project: p,
      inputs: {},
      writeOutput: (path) => {
        throw new Error(`${b.capability}:check is pure and cannot write ${path}`);
      },
      log: () => {},
    };
    try {
      const fn = await loadEntry<CapabilityOperationFn>(ext, spec.entry);
      const result = await withToolEnvironment(p.root, () => fn(capabilityContext(base, b, def, "check")));
      const { diagnostics, invalid } = attribute(b, ext, result.diagnostics);
      if (invalid) {
        skip(invalid);
        continue;
      }
      p.diagnostics.push(...diagnostics);
      p.checks.push({ validator, subject: def.id, status: "ran", counts: { error: n(diagnostics, "error"), warning: n(diagnostics, "warning"), info: n(diagnostics, "info") } });
    } catch (e) {
      skip((e as Error).message.split("\n")[0]);
    }
  }
}

// ---------------------------------------------------------------------------
// Listing and the provider contract
// ---------------------------------------------------------------------------

/** `protoboard capabilities`: the capabilities, who provides them, and which modules use which provider. */
export function listCapabilities(p: Project) {
  return {
    capabilities: CAPABILITIES.map((id) => ({
      id,
      operations: [...CAPABILITY_OPERATIONS],
      outputs: [...new Set(STANDARD_OUTPUTS[id].map((o) => o.path))],
      providers: p.extensions
        .filter((e) => capabilityDecl(e, id))
        .map((e) => ({ extension: e.manifest.id, package: e.package, version: e.manifest.version, native: nativeFolder(e, capabilityDecl(e, id)!), summary: capabilityDecl(e, id)!.summary })),
    })),
    modules: p.capabilities.map((b) => ({
      capability: b.capability,
      module: b.module ?? null,
      instances: b.instances,
      provider: b.provider,
      config: b.config,
      dir: b.dir,
      status: b.problem ? "unavailable" : "ready",
      ...(b.problem ? { problem: b.problem } : {}),
    })),
  };
}

export interface ContractStep {
  operation: CapabilityOperation;
  status: OperationRecord["status"];
  summary: string;
  /** Contract violations found in this step. */
  problems: string[];
  record: OperationRecord;
}

export interface ContractReport {
  capability: string;
  module: string;
  provider: string;
  passed: boolean;
  steps: ContractStep[];
}

/**
 * The provider contract, for a provider's own tests: generate, export,
 * extract and check on one module, in order. Each must succeed; generate must
 * write native files, export must write standard outputs that validate,
 * extract must return valid facts, and check must find no errors in a design
 * it has just generated.
 */
export async function runProviderContract(p: Project, capability: string, moduleRef: string, options: RunOptions = {}): Promise<ContractReport> {
  const { binding: b, ext, def } = findBinding(p, capability, moduleRef);
  const steps: ContractStep[] = [];
  const under = (rec: OperationRecord, dir: string) => rec.outputs.some((o) => o.path.startsWith(dir + "/"));
  for (const op of CAPABILITY_OPERATIONS) {
    const record = await runCapabilityOperation(p, capability, op, moduleRef, {}, options);
    const problems: string[] = [];
    if (record.status !== "succeeded") problems.push(`${op} ${record.status}: ${record.summary}`);
    if (op === "generate" && !under(record, b.native!)) problems.push(`generate wrote no native files under ${b.native}/`);
    if (op === "export" && !under(record, b.out)) problems.push(`export wrote nothing under ${b.out}/`);
    if (op === "check") for (const d of (record.diagnostics ?? []).filter((d) => d.severity === "error")) problems.push(`check reports ${d.code} on a design it just generated: ${d.message}`);
    steps.push({ operation: op, status: record.status, summary: record.summary, problems, record });
  }
  return { capability, module: def.id, provider: ext.manifest.id, passed: steps.every((s) => !s.problems.length), steps };
}

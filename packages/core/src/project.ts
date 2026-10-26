/**
 * Loaded and resolved project: registry, instance tree, links, artifacts, and
 * aggregated diagnostics from every validator that could run.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve as resolvePath } from "node:path";
import {
  assemble,
  checkGeometryBindings,
  checkSystem,
  isNet,
  resolveEndpoint,
  resolveLeafEndpoint,
  type GeometryManifest,
  type Mat4,
  type ModuleDef,
  type ModuleLookup,
} from "@deltarobotics/uhd";
import { isSafePath } from "@protoboardai/cloud/client";
import { bomFileDiagnostics } from "./bom-files.js";
import { formerScopeDiagnostics } from "./scope.js";
import { isInsideReal } from "./paths.js";
import { artifactBaseDir, artifactBaseLabel, findProjectRoot, freshImporter, importTs, loadConfig, loadDefinitions, locateId, originEntry, type TsImporter } from "./load.js";
import type {
  CheckRun,
  DefinitionRecord,
  Instance,
  ProjectDiagnostic,
  ProtoboardConfig,
  ResolvedArtifact,
  ResolvedLink,
  Severity,
  SourceLocation,
} from "./types.js";

export interface Project {
  root: string;
  name: string;
  config: ProtoboardConfig;
  /** Definitions by id (the first one wins when ids collide; the collision is an error). */
  definitions: Map<string, DefinitionRecord>;
  lookup: ModuleLookup;
  rootDef?: ModuleDef;
  instances: Instance[];
  links: ResolvedLink[];
  artifacts: ResolvedArtifact[];
  diagnostics: ProjectDiagnostic[];
  checks: CheckRun[];
  /** Configured extensions that loaded and passed compatibility checks. */
  extensions: import("./extensions.js").LoadedExtension[];
  /** Modules bound to capability providers by their `<capability>.config.ts` (tool-integrations.md §4). */
  capabilities: import("./capabilities.js").CapabilityBinding[];
}

const count = (ds: ProjectDiagnostic[], validator: string): Record<Severity, number> => ({
  error: ds.filter((d) => d.validator === validator && d.severity === "error").length,
  warning: ds.filter((d) => d.validator === validator && d.severity === "warning").length,
  info: ds.filter((d) => d.validator === validator && d.severity === "info").length,
});

export interface LoadOptions {
  /** Run the UHD model validators (link DRC, system rules, assembly, geometry). Default true. */
  checks?: boolean;
  /** Load configured extensions and run their checks. Default true (when checks run). */
  extensions?: boolean;
  /**
   * Evaluate the project's sources anew (`freshImporter`) instead of reusing
   * the modules this process already imported: a definition that reads files
   * (a harness's route) then reflects what is on disk now. Default false.
   */
  fresh?: boolean;
}

export async function loadProject(dir = process.cwd(), options: LoadOptions = {}): Promise<Project> {
  const root = findProjectRoot(dir);
  if (!root) throw new Error(`no protoboard.config.ts in ${resolvePath(dir)} or its parents (run \`protoboard init\`)`);
  const config = await loadConfig(root);
  const importer: TsImporter = options.fresh ? freshImporter() : importTs;
  const { records, diagnostics } = await loadDefinitions(root, config, importer);
  const runs: CheckRun[] = [];

  // ---- registry: one definition per id
  const definitions = new Map<string, DefinitionRecord>();
  for (const r of records) {
    const prev = definitions.get(r.def.id);
    if (!prev) {
      definitions.set(r.def.id, r);
      continue;
    }
    if (prev.def === r.def) continue;
    const where = (x: DefinitionRecord) => `${x.origin.kind} ${x.origin.source.file}${x.origin.source.line ? `:${x.origin.source.line}` : ""}`;
    diagnostics.push({
      code: "PB_DUPLICATE_DEFINITION",
      severity: "error",
      entity: { kind: "definition", id: r.def.id },
      message: `"${r.def.id}" is defined twice (${where(prev)} and ${where(r)}); give a local variant its own id with a derived-from origin`,
      source: r.origin.source,
      validator: "protoboard/registry",
    });
  }
  const lookup: ModuleLookup = (id) => definitions.get(id)?.def;
  const sourceOf = (id: string) => definitions.get(id)?.origin.source;

  // ---- root and instance tree
  let rootDef: ModuleDef | undefined;
  try {
    rootDef = (await importer(join(root, config.root.source)))[config.root.export] as ModuleDef | undefined;
  } catch {
    rootDef = undefined;
  }
  if (!rootDef) {
    diagnostics.push({
      code: "PB_ROOT_NOT_FOUND",
      severity: "error",
      entity: { kind: "project", id: config.name ?? basename(root) },
      message: `root "${config.root.export}" is not exported by ${config.root.source}`,
      source: { file: config.root.source },
      validator: "protoboard/registry",
    });
  }

  const instances: Instance[] = [];
  const links: ResolvedLink[] = [];
  // a definition used by several instances reports each problem once (the first instance path is named)
  const reported = new Set<string>();
  const once = (key: string) => (reported.has(key) ? false : (reported.add(key), true));
  /** Missing definition id → the instances that use it (B6). */
  const unresolvedUsers = new Map<string, string[]>();
  if (rootDef) {
    instances.push({ path: "", definition: rootDef.id, name: rootDef.name, kind: rootDef.kind ?? "module", quantity: 1 });
    const walk = (def: ModuleDef, path: string, stack: string[]) => {
      for (const link of def.links ?? []) {
        const owner = path;
        const end = (e: (typeof link)["a"]) => `${path ? path + "/" : ""}${"child" in e ? e.child + ":" : ":"}${e.interfaceId}`;
        const prefix = path ? path.split("/") : [];
        const leaf = (e: (typeof link)["a"]) => {
          try {
            const r = resolveLeafEndpoint(def, e, lookup, prefix);
            return r ? `${r.path.join("/")}:${r.iface.id}` : undefined;
          } catch {
            return undefined;
          }
        };
        // a link-scoped composition (PB-805) lands on several leaves: one per composed position
        const composedLeaves = (e: (typeof link)["a"]) => {
          if (!("child" in e) || !e.compose) return undefined;
          try {
            const r = resolveEndpoint(def, e, lookup);
            return Object.values(r.composed ?? {}).map((c) => `${[...prefix, ...c.ownerPath].join("/")}:${c.iface.id}`);
          } catch {
            return undefined;
          }
        };
        const linkId = owner ? `${owner}:${link.id}` : link.id;
        const aLeaves = composedLeaves(link.a);
        const bLeaves = composedLeaves(link.b);
        links.push({
          id: linkId,
          owner,
          a: end(link.a),
          b: end(link.b),
          aLeaf: leaf(link.a),
          bLeaf: leaf(link.b),
          ...(aLeaves ? { aLeaves } : {}),
          ...(bLeaves ? { bLeaves } : {}),
          ...(link.harness ? { harness: link.harness } : {}),
        });
        for (const [side, e] of [["a", link.a], ["b", link.b]] as const) {
          try {
            resolveEndpoint(def, e, lookup);
          } catch (err) {
            // an unresolved child is reported once as PB_UNRESOLVED_DEFINITION; don't repeat it per link end
            if (/references unknown module/.test((err as Error).message)) continue;
            if (!once(`endpoint:${def.id}:${link.id}:${side}`)) continue;
            diagnostics.push({
              code: "PB_INVALID_ENDPOINT",
              severity: "error",
              entity: { kind: "link", id: owner ? `${owner}:${link.id}` : link.id },
              message: `link ${link.id} end ${side}: ${(err as Error).message}`,
              source: sourceOf(def.id) && locateIn(root, sourceOf(def.id)!, link.id),
              validator: "protoboard/resolve",
            });
          }
        }
        if (link.harness && !(def.children ?? []).some((c) => c.id === link.harness)) {
          diagnostics.push({
            code: "PB_UNKNOWN_HARNESS",
            severity: "error",
            entity: { kind: "link", id: owner ? `${owner}:${link.id}` : link.id },
            message: `link ${link.id} names harness "${link.harness}", which is not a child of ${def.id}`,
            source: sourceOf(def.id) && locateIn(root, sourceOf(def.id)!, link.id),
            validator: "protoboard/resolve",
          });
        }
      }
      for (const ref of def.children ?? []) {
        const childPath = path ? `${path}/${ref.id}` : ref.id;
        const child = lookup(ref.moduleDefId);
        if (!child) {
          // one finding per missing definition (B6): a library part that was not fetched is one cause, however
          // many resistors use it; the finding counts the instances
          const users = unresolvedUsers.get(ref.moduleDefId);
          if (users) {
            if (!users.includes(childPath)) users.push(childPath);
            continue;
          }
          unresolvedUsers.set(ref.moduleDefId, [childPath]);
          diagnostics.push({
            code: "PB_UNRESOLVED_DEFINITION",
            severity: "error",
            entity: { kind: "instance", id: childPath },
            message: unresolvedMessage(ref.moduleDefId, [childPath]),
            source: sourceOf(def.id) && locateIn(root, sourceOf(def.id)!, ref.moduleDefId, "moduleDefId"),
            validator: "protoboard/resolve",
          });
          continue;
        }
        if (stack.includes(child.id)) {
          diagnostics.push({
            code: "PB_CONTAINMENT_CYCLE",
            severity: "error",
            entity: { kind: "instance", id: childPath },
            message: `containment cycle: ${[...stack, child.id].join(" → ")}`,
            source: sourceOf(def.id),
            validator: "protoboard/resolve",
          });
          continue;
        }
        instances.push({ path: childPath, definition: child.id, name: ref.name ?? child.name, kind: child.kind ?? "module", quantity: ref.quantity ?? 1, parent: path, ...(ref.overrides && Object.keys(ref.overrides).length ? { overrides: ref.overrides } : {}) });
        walk(child, childPath, [...stack, child.id]);
      }
    };
    walk(rootDef, "", [rootDef.id]);
    for (const d of diagnostics) {
      const id = d.code === "PB_UNRESOLVED_DEFINITION" ? /references "([^"]+)"/.exec(d.message)?.[1] : undefined;
      const users = id && unresolvedUsers.get(id);
      if (id && users && users.length > 1) d.message = unresolvedMessage(id, users);
    }
  }
  runs.push({ validator: "protoboard/registry", status: "ran", counts: count(diagnostics, "protoboard/registry") });
  runs.push({ validator: "protoboard/resolve", status: rootDef ? "ran" : "skipped", ...(rootDef ? {} : { reason: "no root" }), counts: count(diagnostics, "protoboard/resolve") });

  // ---- artifacts: resolve each against its origin's base
  const artifacts: ResolvedArtifact[] = [];
  const used = new Set(instances.map((i) => i.definition));
  for (const id of [...used].sort()) {
    const rec = definitions.get(id);
    if (!rec) continue;
    const baseDir = artifactBaseDir(root, rec.origin.artifactBase);
    const baseLabel = artifactBaseLabel(rec.origin.artifactBase);
    for (const a of rec.def.artifacts ?? []) {
      if (!a.filePath) {
        artifacts.push({ definition: id, id: a.id, role: a.role, format: a.format, url: a.url, base: baseLabel, present: a.url ? "remote" : "provenance" });
        continue;
      }
      // a part from the catalog or vendored into the project is someone else's data: its files stay in its folder (PB-1048)
      const confined = rec.origin.kind === "catalog" || rec.origin.artifactBase.kind === "vendored";
      const escape = confined ? artifactPathEscape(root, rec.origin.artifactBase.kind === "vendored", baseDir, a.filePath) : undefined;
      if (escape) {
        artifacts.push({ definition: id, id: a.id, role: a.role, format: a.format, filePath: a.filePath, url: a.url, base: baseLabel, present: false });
        diagnostics.push({
          code: "PB_ARTIFACT_PATH_UNSAFE",
          severity: escape.severity,
          entity: { kind: "artifact", id: `${id}#${a.id}` },
          message: `${id} artifact ${a.id}: ${JSON.stringify(a.filePath)} ${escape.reason}, so it is not read or opened`,
          source: rec.origin.kind === "catalog" ? originEntry(root, config.catalog, id) : rec.origin.kind === "local" ? locateIn(root, rec.origin.source, a.id) : rec.origin.source,
          validator: "protoboard/artifacts",
        });
        continue;
      }
      const resolved = baseDir ? resolvePath(baseDir, a.filePath) : undefined;
      const present = !!resolved && existsSync(resolved);
      artifacts.push({ definition: id, id: a.id, role: a.role, format: a.format, filePath: a.filePath, url: a.url, resolved, base: baseLabel, present });
      if (!present) {
        // local artifacts and generated bodies are required; vendor/research files and remote-backed ones are optional
        const optional = /\/(vendor|\.research)\//.test(a.filePath) || !!a.url || rec.origin.kind === "catalog";
        // a catalog revision says why it does not carry a file (redistribution not cleared, not in the source)
        const notCarried = rec.origin.missingArtifacts?.find((m) => m.path === a.filePath);
        diagnostics.push({
          code: optional ? "PB_ARTIFACT_UNAVAILABLE" : "PB_MISSING_ARTIFACT",
          severity: optional ? "warning" : "error",
          entity: { kind: "artifact", id: `${id}#${a.id}` },
          message: `${id} artifact ${a.id}: ${a.filePath} not found under ${baseLabel}${notCarried ? ` (the catalog revision does not carry it: ${notCarried.reason})` : optional ? " (optional here: vendor/research file or catalog-held)" : ""}`,
          source: rec.origin.kind === "local" ? locateIn(root, rec.origin.source, a.id) : rec.origin.kind === "catalog" ? originEntry(root, config.catalog, id) : rec.origin.source,
          validator: "protoboard/artifacts",
        });
      }
    }
  }
  runs.push({ validator: "protoboard/artifacts", status: "ran", counts: count(diagnostics, "protoboard/artifacts") });

  const project: Project = {
    root,
    name: config.name ?? basename(root),
    config,
    definitions,
    lookup,
    rootDef,
    instances,
    links,
    artifacts,
    diagnostics,
    checks: runs,
    extensions: [],
    capabilities: [],
  };
  project.diagnostics.push(...bomFileDiagnostics(root));
  if (options.extensions === false) {
    project.diagnostics.push(...formerScopeDiagnostics(root, config));
    if (options.checks !== false) runModelChecks(project);
  } else {
    const { loadExtensions, runExtensionChecks } = await import("./extensions.js");
    const capabilities = await import("./capabilities.js");
    // module configs name their providers, which load like configured extensions
    const found = await capabilities.discoverCapabilityConfigs(project);
    project.diagnostics.push(...formerScopeDiagnostics(root, config, found.configs.flatMap((c) => (c.config ? [{ file: c.file, provider: c.config.provider }] : []))));
    const { extensions, diagnostics: extDiags } = loadExtensions(project, capabilities.providerRequests(project, found.configs));
    project.diagnostics.push(...extDiags);
    project.extensions = extensions;
    project.checks.push({
      validator: "protoboard/extensions",
      status: "ran",
      counts: { error: extDiags.filter((d) => d.severity === "error").length, warning: extDiags.filter((d) => d.severity === "warning").length, info: 0 },
    });
    capabilities.bindCapabilities(project, found);
    // the providers' declared outputs become the bound modules' artifacts before anything reads them (PB-1030)
    capabilities.attachDeclaredArtifacts(project);
    if (options.checks !== false) {
      runModelChecks(project);
      await runExtensionChecks(project, extensions);
      await capabilities.runCapabilityChecks(project);
    }
  }
  return project;
}

/**
 * Line of an id-like key inside a known source file. An `id` is also found as
 * the first argument of a helper call (`link("battery_plug", …)`), the way
 * projects often declare links and children.
 */
function locateIn(root: string, src: SourceLocation, value: string, key = "id"): SourceLocation {
  const file = join(root, src.file);
  if (!existsSync(file) || !src.file.endsWith(".ts")) return src;
  const loc = locateId(file, value, root, key);
  if (loc.line) return loc;
  if (key === "id") {
    const lines = readFileSync(file, "utf8").split("\n");
    const call = new RegExp(`\\b[A-Za-z_$][\\w$]*\\(\\s*["'\`]${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
    const i = lines.findIndex((l) => call.test(l));
    if (i >= 0) return { file: src.file, line: i + 1 };
  }
  return src;
}

/** The instance whose path is the longest prefix of `id` (`path/…` or `path:…`), and the rest. */
function ownerOf(p: Project, id: string): { path: string; rest: string } {
  let owner = "";
  for (const i of p.instances) if (i.path && i.path.length > owner.length && (id.startsWith(`${i.path}/`) || id.startsWith(`${i.path}:`))) owner = i.path;
  return { path: owner, rest: owner ? id.slice(owner.length + 1) : id };
}

/** The source of the module an instance path names (local definitions only carry lines). */
function sourceOfPath(p: Project, path: string): SourceLocation | undefined {
  const def = p.instances.find((i) => i.path === path)?.definition;
  return def ? p.definitions.get(def)?.origin.source : undefined;
}

/**
 * Where a system-level finding is declared: a link at its declaration in the
 * module that owns it (a derived link `a+b~net~net` at its first link that is
 * found), an instance or an interface `child:iface` at the child's
 * declaration in its parent; the root system's line otherwise.
 */
export function entitySource(p: Project, entity: { kind: string; id: string }, fallback: SourceLocation | undefined): SourceLocation | undefined {
  const at = (src: SourceLocation | undefined, ids: string[]) => {
    if (!src) return undefined;
    for (const id of ids) {
      const loc = locateIn(p.root, src, id);
      if (loc.line && loc !== src) return loc;
    }
    return undefined;
  };
  if (entity.kind === "link") {
    const { path, rest } = ownerOf(p, entity.id);
    const ids = [...new Set([rest, ...rest.split("+").map((s) => s.split("~")[0])])].filter(Boolean);
    return at(sourceOfPath(p, path), ids) ?? fallback;
  }
  const path = entity.kind === "instance" ? entity.id : entity.kind === "interface" && entity.id.includes(":") ? entity.id.slice(0, entity.id.lastIndexOf(":")) : undefined;
  const inst = path ? p.instances.find((i) => i.path === path) : undefined;
  if (inst && inst.parent !== undefined) return at(sourceOfPath(p, inst.parent), [path!.split("/").pop()!]) ?? fallback;
  return fallback;
}

/**
 * The board modules below a system: every definition in its tree, other than
 * the system itself, that declares nets. UHD derives a module's functional
 * links per module (docs/boards-and-nets.md), so a board's nets, pull-ups,
 * supplies and placements are checked with `checkSystem(board)`, not by the
 * system's check. Each comes with the first instance path that uses it.
 */
export function boardModules(root: ModuleDef, lookup: ModuleLookup): { def: ModuleDef; path: string }[] {
  const out = new Map<string, { def: ModuleDef; path: string }>();
  const seen = new Set<string>([root.id]);
  const walk = (def: ModuleDef, prefix: string[]) => {
    for (const c of def.children ?? []) {
      const child = lookup(c.moduleDefId);
      if (!child) continue;
      const path = [...prefix, c.id];
      if (child.interfaces.some(isNet) && !out.has(child.id)) out.set(child.id, { def: child, path: path.join("/") });
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      walk(child, path);
    }
  };
  walk(root, []);
  return [...out.values()];
}

/**
 * PB_UNRESOLVED_DEFINITION's message: the first instance, the definition,
 * and how many instances use it (B6: one finding per missing definition).
 */
export function unresolvedMessage(id: string, users: string[]): string {
  const [first] = users;
  const shown = users.length > 6 ? `${users.slice(0, 5).join(", ")} and ${users.length - 5} more` : users.join(", ");
  const used = users.length > 1 ? `; ${users.length} instances use it (${shown})` : "";
  return `${first} references "${id}", which no local source or catalog entry defines${used}. If it is a library part, fetch it: \`protoboard parts add ${id}\` (in VS Code: Fetch Parts); otherwise author it locally`;
}

/** Whether `ref` (`<child>:<interface>`, as UHD's diagnostics name an interface) is a child's net port on `def`. */
function netPortRef(def: ModuleDef, ref: string | undefined, lookup: ModuleLookup): boolean {
  const at = ref?.indexOf(":") ?? -1;
  if (!ref || at < 1 || ref.slice(0, at).includes("/")) return false;
  try {
    return resolveEndpoint(def, { child: ref.slice(0, at), interfaceId: ref.slice(at + 1) }, lookup).netPort === true;
  } catch {
    return false;
  }
}

/** UHD validators: system rules (incl. link DRC), assembly, geometry bindings. */
export function runModelChecks(p: Project): void {
  const blocking = p.diagnostics.some((d) => d.severity === "error" && ["PB_INVALID_ENDPOINT", "PB_UNRESOLVED_DEFINITION", "PB_CONTAINMENT_CYCLE"].includes(d.code));
  const skip = (validator: string, reason: string) => p.checks.push({ validator, status: "skipped", reason, counts: { error: 0, warning: 0, info: 0 } });
  const rootSource = p.rootDef ? p.definitions.get(p.rootDef.id)?.origin.source : undefined;

  if (!p.rootDef || blocking) {
    const why = !p.rootDef ? "no root" : "unresolved definitions or invalid endpoints";
    skip("uhd/checkSystem", why);
    skip("uhd/assemble", why);
  } else {
    const sys = checkSystem(p.rootDef, p.lookup);
    for (const d of sys.diagnostics) {
      const linkRef = d.refs.find((r) => r.startsWith("link:"))?.slice(5);
      p.diagnostics.push({
        code: `UHD_${d.rule.toUpperCase()}`,
        severity: d.severity,
        entity: linkRef ? { kind: "link", id: linkRef } : { kind: "interface", id: d.refs[0] ?? p.rootDef.id },
        message: d.message,
        source: entitySource(p, linkRef ? { kind: "link", id: linkRef } : { kind: "interface", id: d.refs[0] ?? p.rootDef.id }, rootSource),
        validator: "uhd/checkSystem",
      });
    }
    // each board below the system (a definition that declares nets: docs/boards-and-nets.md in UHD): its
    // own nets, pull-ups and the links derived over them, which checkSystem on the root does not descend
    // into. Reported once per definition, at its first instance.
    for (const { def, path } of boardModules(p.rootDef, p.lookup)) {
      const src = p.definitions.get(def.id)?.origin.source;
      for (const d of checkSystem(def, p.lookup).diagnostics) {
        // a board is often supplied through its edge (a rail net it exports): on its own, every pin on that
        // rail looks unpowered. Whether the edge is fed is the system check's question. A sub-module's net
        // port that nothing on the board feeds (UHD 0.3.0, `unpowered:<child>:<port>`) is the board's own
        // question, though: UHD takes the sub-module's ported nets as fed from outside and asks it here
        if (d.rule === "unpowered" && !netPortRef(def, d.refs[0], p.lookup)) continue;
        // the root's check covers the whole tree for these
        if (d.rule === "unknown_category" || d.rule === "passive_override") continue;
        // already reported by the system check (rules that descend into children)
        if (sys.diagnostics.some((x) => x.rule === d.rule && (x.message === d.message || x.message === `${path}/${d.message}`))) continue;
        const linkRef = d.refs.find((r) => r.startsWith("link:"))?.slice(5);
        p.diagnostics.push({
          code: `UHD_${d.rule.toUpperCase()}`,
          severity: d.severity,
          entity: linkRef ? { kind: "link", id: `${path}/${linkRef}` } : { kind: "interface", id: d.refs[0] ? `${path}/${d.refs[0]}` : path },
          message: `${path} (${def.id}): ${d.message}`,
          source: src && linkRef ? locateIn(p.root, src, linkRef) : src,
          validator: "uhd/checkSystem",
        });
      }
    }
    p.checks.push({ validator: "uhd/checkSystem", status: "ran", counts: count(p.diagnostics, "uhd/checkSystem") });

    const firstStructure = p.instances.find((i) => i.parent === "" && p.lookup(i.definition)?.interfaces.some((f) => f.geometry?.frame));
    if (!firstStructure) skip("uhd/assemble", "no instance with interface frames");
    else {
      // the project's display placements (parts held, bonded or strapped, which no mate places), as the viewer uses them
      const displayFile = join(p.root, p.config.display ?? ".protoboard/display.json");
      let fixed: Record<string, Mat4> | undefined;
      try {
        const spatial = existsSync(displayFile) ? (JSON.parse(readFileSync(displayFile, "utf8")) as { spatial?: { root?: string; placements?: Record<string, { matrix?: Mat4 }> } }).spatial : undefined;
        if (spatial?.root === firstStructure.path && spatial.placements)
          fixed = Object.fromEntries(Object.entries(spatial.placements).filter(([, v]) => Array.isArray(v.matrix) && v.matrix.length === 16).map(([k, v]) => [k, v.matrix!]));
      } catch {
        // an unreadable display file only loses the hints
      }
      const asm = assemble(p.rootDef, p.lookup, { root: [firstStructure.path], ...(fixed ? { fixed } : {}) });
      // instances inside a placed module that has a body of its own (a board's components in its
      // board.glb) are drawn by that body, as the viewer does: not reported as unplaced one by one
      const defAt = (path: string[]) => path.reduce<ModuleDef | undefined>((d, id) => (d ? p.lookup(d.children?.find((c) => c.id === id)?.moduleDefId ?? "") : undefined), p.rootDef);
      const holders = asm.placements
        .filter((pl) => !pl.body && defAt(pl.path)?.artifacts?.some((a) => a.role === "body" && a.format === "glb"))
        .map((pl) => `${pl.path.join("/")}/`);
      for (const i of asm.issues) {
        if (i.severity === "info" && holders.some((h) => i.subject.startsWith(h))) continue;
        p.diagnostics.push({
          code: i.severity === "info" ? "UHD_UNPLACED" : "UHD_ASSEMBLY",
          severity: i.severity,
          entity: { kind: "instance", id: i.subject },
          message: i.message,
          source: entitySource(p, { kind: "instance", id: i.subject }, rootSource),
          validator: "uhd/assemble",
        });
      }
      p.checks.push({ validator: "uhd/assemble", status: "ran", counts: count(p.diagnostics, "uhd/assemble") });
    }
  }

  // geometry bindings against generator manifests, per used definition
  let checked = 0;
  let unchecked = 0;
  for (const id of new Set(p.instances.map((i) => i.definition))) {
    const rec = p.definitions.get(id);
    if (!rec || !rec.def.interfaces.some((i) => i.geometry?.refs?.length)) continue;
    const manifestFor = (artifactId: string): GeometryManifest | undefined => {
      const art = (rec.def.artifacts ?? []).find((a) => a.format === "json" && a.provenance?.generatedFrom === artifactId);
      const hit = art && p.artifacts.find((x) => x.definition === id && x.id === art.id);
      return hit?.present === true && hit.resolved ? (JSON.parse(readFileSync(hit.resolved, "utf8")) as GeometryManifest) : undefined;
    };
    for (const issue of checkGeometryBindings(rec.def, manifestFor)) {
      if (issue.severity === "warning") {
        unchecked++;
        continue; // "no manifest" is reported as the check's coverage, not as a finding per ref
      }
      p.diagnostics.push({
        code: "UHD_GEOMETRY_BINDING",
        severity: issue.severity,
        entity: { kind: "interface", id: `${id}:${issue.interfaceId}` },
        message: issue.message,
        source: rec.origin.kind === "local" ? locateIn(p.root, rec.origin.source, issue.interfaceId) : rec.origin.source,
        validator: "uhd/geometryBindings",
      });
    }
    checked++;
  }
  p.checks.push({
    validator: "uhd/geometryBindings",
    status: checked ? "ran" : "skipped",
    ...(checked ? {} : { reason: "no definitions with geometry refs" }),
    ...(unchecked ? { reason: `${unchecked} ref(s) have no manifest available (e.g. KCL sources); those are unknown, not passed` } : {}),
    counts: count(p.diagnostics, "uhd/geometryBindings"),
  });
}

export const errorCount = (p: Project) => p.diagnostics.filter((d) => d.severity === "error").length;

/**
 * Why a catalog or vendored artifact's `filePath` may not be used, or
 * undefined when it may (PB-1048): it must be a normalised relative path
 * (UHD `isSafePath`) and, links followed, stay inside the part's folder (and
 * a vendored folder inside the project). A path that could leave the folder
 * (absolute, `..`, a backslash, a drive, NUL, a link out) is an error; one
 * that only is not written normally (`./x`, `a//b`) a warning. Neither is
 * resolved, so nothing reads, serves or opens it.
 */
export function artifactPathEscape(root: string, vendored: boolean, baseDir: string | undefined, filePath: string): { reason: string; severity: "error" | "warning" } | undefined {
  // a drive (`C:/x`) is a relative folder name to POSIX and the root of a disk to Windows
  if (!isSafePath(filePath) || /^[A-Za-z]:/.test(filePath)) {
    const escapes = filePath.startsWith("/") || /[\\\0]/.test(filePath) || /^[A-Za-z]:/.test(filePath) || filePath.split("/").includes("..");
    return { reason: escapes ? "could lead outside the part's folder" : "is not a normalised relative path (forward slashes, no `.` or empty segments)", severity: escapes ? "error" : "warning" };
  }
  if (!baseDir) return undefined;
  if (vendored && !isInsideReal(root, baseDir)) return { reason: "belongs to a part folder outside the project", severity: "error" };
  if (!isInsideReal(baseDir, resolvePath(baseDir, filePath))) return { reason: "leads outside the part's folder through a link", severity: "error" };
  return undefined;
}

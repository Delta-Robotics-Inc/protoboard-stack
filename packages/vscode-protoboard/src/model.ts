/**
 * The project as `protoboard build` leaves it: `.protoboard/build/resolved.json`
 * (instances, links, origins, capabilities, diagnostics) and, next to it, the
 * UHD bundle (definitions with their interfaces, exports and fastener stacks).
 * Indexed here for the Explorer and the DRC view. No VS Code API here.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CheckDiagnostic, CheckRun, Severity } from "./check.js";
import type { PartTrust } from "@protoboardai/views/part-status";
import type { ViewerCommand as HostToViewer } from "../../web-viewer/src/vscode/protocol.js";

export const BUILD_DIR = join(".protoboard", "build");
export const RESOLVED_FILE = join(BUILD_DIR, "resolved.json");
export const BUNDLE_FILE = join(BUILD_DIR, "uhd-bundle.json");
export const RESOLVED_SCHEMA = "protoboard.resolved/v0";

export type PartTier = "catalog" | "project-researched" | "project-specific";

export interface SourceLocation {
  /** Project-relative (or absolute) file. */
  file: string;
  /** 1-based. */
  line?: number;
}

/** `resolved.json` (`resolvedProject` in @protoboardai/core), the parts the extension reads. */
export interface ResolvedProject {
  schema: string;
  project: { name: string; root: string | null; currency?: string };
  definitions: { id: string; name?: string; kind: string; origin: { kind: string; tier: PartTier; source: SourceLocation; definitionSource?: SourceLocation; revision?: string | number; library?: string }; /** The part's status (PB-932); absent from builds made before it was recorded. */ partStatus?: { trust: PartTrust; basis: string; /** A blank block: a module of the project with no part chosen yet (core's part-trust.ts). */ blank?: boolean } }[];
  instances: ResolvedInstance[];
  links: ResolvedLink[];
  artifacts: ResolvedArtifact[];
  capabilities?: { capability: string; module?: string; provider: string; config: string; problem?: string }[];
  checks: CheckRun[];
  diagnostics: CheckDiagnostic[];
}

export interface ResolvedInstance {
  path: string;
  definition: string;
  name?: string;
  /** UHD `ModuleKind`; a `board` (UHD 0.3.0, one PCB) behaves as a `module`. */
  kind: "module" | "group" | "harness" | "board";
  quantity: number;
  parent?: string;
}

export interface ResolvedLink {
  id: string;
  owner: string;
  a: string;
  b: string;
  harness?: string;
}

export interface ResolvedArtifact {
  definition: string;
  id: string;
  role?: string;
  format?: string;
  filePath?: string;
  url?: string;
  /** Project-relative, or `package:<name>/<path>`. */
  resolved?: string;
  base: string;
  present: boolean | "remote" | "provenance";
}

/** The parts of a UHD bundle definition the Explorer shows. */
export interface BundleDefinition {
  id: string;
  name?: string;
  kind?: string;
  interfaces?: { id: string; name?: string; domain?: string; protocols?: { type: string }[] }[];
  /** `from` is a child's interface, or (UHD 0.3.0) a net port: the module's own net, `{ self: true, interfaceId }`. */
  exports?: { id: string; name?: string; from?: { child: string; interfaceId: string } | { self: true; interfaceId: string } }[];
  links?: { id: string; name?: string }[];
  fastenerStack?: unknown[];
  children?: { id: string; moduleDefId: string; name?: string }[];
}

export interface UhdBundle {
  root: string;
  definitions: BundleDefinition[];
}

export interface BuildOutput {
  resolved: ResolvedProject;
  bundle?: UhdBundle;
  /** When resolved.json was written. */
  at: Date;
}

/** The project's last build, or why there is none to read. */
export function readBuild(root: string, read: (file: string) => string = (f) => readFileSync(f, "utf8"), mtime: (file: string) => Date = (f) => statSync(f).mtime): BuildOutput | undefined {
  let resolved: ResolvedProject;
  try {
    resolved = JSON.parse(read(join(root, RESOLVED_FILE)));
  } catch {
    return undefined;
  }
  if (resolved?.schema !== RESOLVED_SCHEMA || !Array.isArray(resolved.instances) || !Array.isArray(resolved.diagnostics)) return undefined;
  let bundle: UhdBundle | undefined;
  try {
    const b = JSON.parse(read(join(root, BUNDLE_FILE)));
    if (Array.isArray(b?.definitions)) bundle = b;
  } catch {
    bundle = undefined;
  }
  let at: Date;
  try {
    at = mtime(join(root, RESOLVED_FILE));
  } catch {
    at = new Date(0);
  }
  return { resolved, bundle, at };
}

/** What a finding is about, in the Explorer's terms. */
export interface Target {
  /** Instance path to focus ("" is the root system). */
  path?: string;
  defId?: string;
  /** A link of resolved.json. */
  linkId?: string;
  /** A derived link's own id, within the module that declares its links (`linkId` is its first link). */
  derivedId?: string;
  /** For display: the instance, definition, link or entity id. */
  label: string;
  /** The module it belongs to, for grouping (a link: the module that declares it). */
  module?: string;
}

export interface ProjectIndex {
  resolved: ResolvedProject;
  bundle?: UhdBundle;
  defs: Map<string, ResolvedProject["definitions"][number]>;
  bundleDefs: Map<string, BundleDefinition>;
  instances: Map<string, ResolvedInstance>;
  /** Child instances by parent path, in declaration order. */
  children: Map<string, ResolvedInstance[]>;
  /** Instances of each definition, in tree order. */
  usedBy: Map<string, ResolvedInstance[]>;
  links: Map<string, ResolvedLink>;
  linksByOwner: Map<string, ResolvedLink[]>;
  capabilities: Map<string, NonNullable<ResolvedProject["capabilities"]>>;
  artifacts: Map<string, ResolvedArtifact[]>;
  rootPath: string;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

export function indexProject(resolved: ResolvedProject, bundle?: UhdBundle): ProjectIndex {
  const index: ProjectIndex = {
    resolved,
    bundle,
    defs: new Map(resolved.definitions.map((d) => [d.id, d])),
    bundleDefs: new Map((bundle?.definitions ?? []).map((d) => [d.id, d])),
    instances: new Map(),
    children: new Map(),
    usedBy: new Map(),
    links: new Map(),
    linksByOwner: new Map(),
    capabilities: new Map(),
    artifacts: new Map(),
    rootPath: "",
  };
  for (const i of resolved.instances) {
    index.instances.set(i.path, i);
    if (i.path !== "" && i.parent !== undefined) push(index.children, i.parent, i);
    push(index.usedBy, i.definition, i);
  }
  for (const l of resolved.links ?? []) {
    index.links.set(l.id, l);
    push(index.linksByOwner, l.owner, l);
  }
  for (const c of resolved.capabilities ?? []) if (c.module) push(index.capabilities, c.module, c);
  for (const a of resolved.artifacts ?? []) push(index.artifacts, a.definition, a);
  return index;
}

/** The instance a path names, with its definition's name. */
export const instanceLabel = (index: ProjectIndex, path: string): string => {
  const i = index.instances.get(path);
  if (!i) return path || "root";
  const name = i.name ?? index.defs.get(i.definition)?.name ?? i.definition;
  return path === "" ? name : `${name} (${path})`;
};

/**
 * What a diagnostic is about: an instance, a definition (focused at its first
 * instance), a link (at the module that declares it), an artifact (its
 * definition), or the project (the root system). A derived link's id joins
 * the links it runs through (`battery_pads+battery_plug~…`); the first one
 * that exists names it.
 */
export function diagnosticTarget(index: ProjectIndex, d: Pick<CheckDiagnostic, "entity">): Target {
  const { kind, id } = d.entity;
  const ofDef = (defId: string): Target => {
    const first = index.usedBy.get(defId)?.[0];
    return { defId, path: first?.path, label: index.defs.get(defId)?.name ?? defId };
  };
  const ofPath = (path: string): Target => ({ path, defId: index.instances.get(path)?.definition, label: instanceLabel(index, path) });
  switch (kind) {
    case "instance":
      return index.instances.has(id) ? ofPath(id) : { label: id };
    case "definition":
      return ofDef(id);
    case "artifact":
      return ofDef(id.split("#")[0]);
    case "link": {
      const candidates = [id, ...id.split("+").map((s) => s.split("~")[0])];
      const link = candidates.map((c) => index.links.get(c) ?? [...index.links.values()].find((l) => l.id.endsWith(`:${c}`))).find(Boolean);
      if (!link) return { ...ofPath(index.rootPath), label: id, module: instanceLabel(index, index.rootPath) };
      const derived = link.id === id ? undefined : localId(link.owner, id);
      return { path: link.owner, defId: index.instances.get(link.owner)?.definition, linkId: link.id, ...(derived ? { derivedId: derived } : {}), label: link.id, module: instanceLabel(index, link.owner) };
    }
    case "interface": {
      const colon = id.lastIndexOf(":");
      if (colon >= 0 && index.instances.has(id.slice(0, colon))) return { ...ofPath(id.slice(0, colon)), label: id, module: instanceLabel(index, id.slice(0, colon)) };
      if (index.instances.has(id)) return ofPath(id);
      if (index.defs.has(id)) return ofDef(id);
      return { label: id };
    }
    case "project":
      return ofPath(index.rootPath);
    default:
      return { label: id };
  }
}

/** An id within the module at `owner` ("" is the root): without its `owner:` or `owner/` prefix. */
const localId = (owner: string, id: string): string => (owner && (id.startsWith(`${owner}:`) || id.startsWith(`${owner}/`)) ? id.slice(owner.length + 1) : id);

/** A link's id within the module that declares it (resolved.json names it `owner:local`). */
export const localLinkId = (link: Pick<ResolvedLink, "id" | "owner">): string => localId(link.owner, link.id);

/**
 * The host messages that show a module, or a link, in the viewer. A module is
 * focused (the viewer drills to the level that holds it and selects it). A
 * link is drawn on its owner's level, so the viewer drills to the owner and
 * selects the link by its canonical path (`owner/local`, as the viewer reports
 * selections); a derived link goes first by its own id, and the owner itself
 * comes last, for a harness, which the viewer does not drill into and whose
 * links show only when it is expanded in place. The viewer selects the first
 * id it draws. Root links keep their plain ids.
 */
export function viewerMessages(t: { path: string; linkId?: string; derivedId?: string }): HostToViewer[] {
  if (!t.linkId) return [{ type: "uhd-viewer:focus", path: t.path }];
  const owner = t.path;
  const local = localId(owner, t.linkId);
  const ids = [...(t.derivedId ? [t.derivedId] : []), local];
  if (!owner) return [{ type: "uhd-viewer:focus", path: "" }, { type: "uhd-viewer:select", ids }];
  return [
    { type: "uhd-viewer:drill", path: owner },
    { type: "uhd-viewer:select", ids: [...ids.map((id) => `${owner}/${id}`), owner] },
  ];
}

/**
 * The resolved.json link a viewer selection names. The viewer reports a link
 * by its canonical path (`owner/local`, `local` at the root); a derived link
 * (`a+b~net~net`) is named by its first link.
 */
export function linkFromViewer(index: ProjectIndex, id: string): ResolvedLink | undefined {
  // the owner: the longest instance path the id starts with
  let owner = "";
  for (const p of index.instances.keys()) if (p && p.length > owner.length && id.startsWith(`${p}/`)) owner = p;
  const local = localId(owner, id);
  const key = (l: string) => (owner ? `${owner}:${l}` : l);
  for (const c of [local, ...local.split("+").map((s) => s.split("~")[0])]) {
    const link = index.links.get(key(c));
    if (link) return link;
  }
  return undefined;
}

/** Codes that say a provider's generated outputs no longer match the model (sourcing's offer age is not one). */
export const isStaleCode = (code: string): boolean => (/_STALE$/.test(code) && !code.startsWith("SRC_")) || code === "PB_OUTPUT_NOT_EXPORTED" || code === "PB_OUTPUT_MISSING";

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const worse = (a: Severity | undefined, b: Severity | undefined): Severity | undefined => (a === undefined ? b : b === undefined ? a : SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b);

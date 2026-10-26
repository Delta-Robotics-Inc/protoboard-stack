/**
 * `build`: the resolved project contract (core-cli-v0.md "Resolved project
 * contract"). Derived data only; stable for fixed inputs (sorted, no clocks).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Project } from "./project.js";
import { definitionTrust } from "./project-parts.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { FRAMEWORK_VERSION } from "./extensions.js";
import { packageRoot, revisionLabel } from "./load.js";
import { formatPassive, placementPart } from "./placement.js";
import { projectRelative } from "./paths.js";

export const RESOLVED_SCHEMA = "protoboard.resolved/v0";

/** JSON with object keys sorted, so equal data gives equal bytes. */
export function stableStringify(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2) + "\n";
}

export function uhdVersion(root: string): { package: string; version?: string; revision?: string } {
  const dir = packageRoot(root, "@deltarobotics/uhd");
  const version = dir && existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version : undefined;
  let revision: string | undefined;
  try {
    if (dir) revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    revision = undefined;
  }
  return { package: "@deltarobotics/uhd", version, revision };
}

export interface BomLine {
  definition: string;
  name?: string;
  manufacturer?: string;
  partNumber?: string;
  /** A passive's value at these placements, e.g. "4.7 kΩ ±1 %" (a series passive has one line per value). */
  value?: string;
  quantity: number;
  instances: string[];
  origin: string;
}

/**
 * Quantities multiplied through the instance tree; groups and harness kits
 * are expanded. One line per definition, or per definition and MPN where
 * placements differ (a series passive placed at several values).
 */
export function bom(p: Project): BomLine[] {
  const byPath = new Map(p.instances.map((i) => [i.path, i]));
  const total = (path: string): number => {
    const inst = byPath.get(path);
    if (!inst) return 1;
    return inst.quantity * (inst.parent !== undefined && inst.parent !== "" ? total(inst.parent) : 1);
  };
  const lines = new Map<string, BomLine>();
  for (const inst of p.instances) {
    if (inst.path === "") continue;
    const def = p.lookup(inst.definition);
    if (!def || def.children?.length) continue; // assemblies: their contents are the line items
    const rec = p.definitions.get(inst.definition)!;
    const placed = placementPart(def, inst.overrides);
    const value = placed.value ? formatPassive(placed.value) : undefined;
    const key = `${def.id}\u0000${placed.mpn ?? value ?? ""}`;
    const line = lines.get(key) ?? {
      definition: def.id,
      name: def.name,
      manufacturer: def.manufacturer,
      partNumber: placed.mpn,
      ...(value ? { value } : {}),
      quantity: 0,
      instances: [],
      origin: rec.origin.kind === "catalog" ? `catalog:${rec.origin.provider}@${revisionLabel(rec.origin.revision) ?? rec.origin.version}` : `local:${rec.origin.source.file}`,
    };
    line.quantity += total(inst.path);
    line.instances.push(inst.path);
    lines.set(key, line);
  }
  return [...lines.values()].sort((a, b) => a.definition.localeCompare(b.definition) || (a.partNumber ?? "").localeCompare(b.partNumber ?? ""));
}

export function resolvedProject(p: Project) {
  const used = new Set(p.instances.map((i) => i.definition));
  const trust = definitionTrust(p);
  return {
    schema: RESOLVED_SCHEMA,
    tools: { protoboard: FRAMEWORK_VERSION, uhd: uhdVersion(p.root) },
    project: { name: p.name, root: p.rootDef?.id ?? null, ...(p.config.currency ? { currency: p.config.currency } : {}) },
    definitions: [...p.definitions.values()]
      .filter((r) => used.has(r.def.id))
      .map((r) => ({
        id: r.def.id,
        name: r.def.name,
        kind: r.def.kind ?? "module",
        origin: {
          kind: r.origin.kind,
          tier: r.origin.tier,
          source: r.origin.source,
          provider: r.origin.provider,
          service: r.origin.service,
          library: r.origin.library,
          revision: r.origin.revision,
          envelopeDigest: r.origin.envelopeDigest,
          digest: r.origin.digest ?? "sha256:" + createHash("sha256").update(JSON.stringify(r.def)).digest("hex"),
          artifactBase: r.origin.artifactBase,
          // a catalog part vendored with its .uhd.ts (PB-910): the readable source it was evaluated from
          ...(r.origin.definitionSource ? { definitionSource: r.origin.definitionSource } : {}),
        },
        // the part's status (PB-932, part-trust.ts): local, unverified, verified or official, and why
        partStatus: trust[r.def.id],
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    instances: p.instances,
    links: p.links,
    // machine-independent: project files (vendored ones included) relative to the root, package files as package:<name>/<path>
    artifacts: p.artifacts.map((a) => ({ ...a, resolved: a.resolved ? (a.base.startsWith("package:") ? `${a.base}/${a.filePath}` : projectRelative(p.root, a.resolved)) : undefined })),
    bom: bom(p),
    // which provider designs which module (present only when a module has a capability config)
    ...(p.capabilities.length
      ? { capabilities: p.capabilities.map((b) => ({ capability: b.capability, module: b.module, provider: b.provider, config: b.config, configDigest: b.configDigest, ...(b.problem ? { problem: b.problem } : {}) })) }
      : {}),
    checks: p.checks,
    diagnostics: p.diagnostics,
  };
}

export function writeBuild(p: Project, outDir = join(p.root, ".protoboard", "build")) {
  const data = stableStringify(resolvedProject(p));
  const file = join(outDir, "resolved.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return { file, digest: "sha256:" + createHash("sha256").update(data).digest("hex"), bytes: data.length };
}

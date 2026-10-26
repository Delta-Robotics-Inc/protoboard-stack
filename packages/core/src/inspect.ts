/**
 * `inspect`: project summary or one instance's context.
 */
import type { Project } from "./project.js";

export function inspectProject(p: Project) {
  const byOrigin = { local: 0, catalog: 0 };
  const tiers = { catalog: 0, "project-researched": 0, "project-specific": 0 };
  const used = new Set(p.instances.map((i) => i.definition));
  for (const r of p.definitions.values()) {
    if (!used.has(r.def.id)) continue;
    byOrigin[r.origin.kind]++;
    tiers[r.origin.tier]++;
  }
  return {
    project: p.name,
    root: p.rootDef?.id,
    instances: p.instances.length,
    definitions: { used: used.size, ...byOrigin, tiers, available: p.definitions.size },
    links: p.links.length,
    artifacts: {
      total: p.artifacts.length,
      present: p.artifacts.filter((a) => a.present === true).length,
      remote: p.artifacts.filter((a) => a.present === "remote").length,
      missing: p.artifacts.filter((a) => a.present === false).length,
      provenanceOnly: p.artifacts.filter((a) => a.present === "provenance").length,
    },
    checks: p.checks,
    diagnostics: {
      error: p.diagnostics.filter((d) => d.severity === "error").length,
      warning: p.diagnostics.filter((d) => d.severity === "warning").length,
      info: p.diagnostics.filter((d) => d.severity === "info").length,
    },
    children: p.instances.filter((i) => i.parent === "").map((i) => ({ path: i.path, definition: i.definition, kind: i.kind, quantity: i.quantity })),
  };
}

export function inspectInstance(p: Project, path: string) {
  const inst = p.instances.find((i) => i.path === path);
  if (!inst) return undefined;
  const rec = p.definitions.get(inst.definition)!;
  const def = rec.def;
  const mine = (s: string) => s === path || s.startsWith(`${path}:`) || s.startsWith(`${path}/`);
  return {
    path,
    definition: def.id,
    name: inst.name ?? def.name,
    kind: inst.kind,
    quantity: inst.quantity,
    origin: rec.origin,
    manufacturer: def.manufacturer,
    partNumber: def.part_number,
    interfaces: def.interfaces.map((i) => ({
      id: i.id,
      name: i.name,
      domain: i.domain,
      protocols: i.protocols?.map((x) => x.type),
      geometry: i.geometry ? { frame: !!i.geometry.frame, refs: i.geometry.refs?.map((r) => r.kind) ?? [], logical: !!i.geometry.logical } : undefined,
    })),
    children: p.instances.filter((i) => i.parent === path).map((i) => i.path),
    links: p.links.filter((l) => [l.a, l.b, l.aLeaf, l.bLeaf, ...(l.aLeaves ?? []), ...(l.bLeaves ?? [])].some((e) => e?.startsWith(`${path}:`)) || l.owner === path),
    artifacts: p.artifacts.filter((a) => a.definition === def.id),
    diagnostics: p.diagnostics.filter((d) => mine(d.entity.id) || d.entity.id === def.id || d.entity.id.startsWith(`${def.id}#`) || d.entity.id.startsWith(`${def.id}:`)),
  };
}

/**
 * `artifacts`: every artifact of the definitions in use, with the instances
 * that use each definition and the file it resolves to (absolute), so an
 * editor can open it. With `path`, only that instance's definition.
 */
export function listArtifacts(p: Project, path?: string) {
  let defs: Set<string> | undefined;
  if (path !== undefined) {
    const inst = p.instances.find((i) => i.path === path);
    if (!inst) return undefined;
    defs = new Set([inst.definition]);
  }
  const users = new Map<string, string[]>();
  for (const i of p.instances) users.set(i.definition, [...(users.get(i.definition) ?? []), i.path]);
  return p.artifacts
    .filter((a) => !defs || defs.has(a.definition))
    .map((a) => ({
      definition: a.definition,
      name: p.definitions.get(a.definition)?.def.name,
      id: a.id,
      role: a.role,
      format: a.format,
      filePath: a.filePath,
      url: a.url,
      resolved: a.resolved,
      present: a.present,
      instances: users.get(a.definition) ?? [],
    }));
}

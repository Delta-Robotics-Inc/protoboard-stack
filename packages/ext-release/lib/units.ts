/**
 * Package units (release-package-and-evals.md §2, "Splitting by module"):
 * the root system is always a unit; each `release.units` entry (an instance
 * path, or a module id meaning every instance of that module) is another;
 * every other instance folds into the nearest unit above it.
 */
import type { Instance, Project } from "@protoboardai/core";
import type { SectionDiagnostic, Unit, UnitMember } from "./types.ts";

export const ROOT_UNIT = "system";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const relTo = (base: string, path: string) => (base === "" ? path : path.slice(base.length + 1));

/** Units in the order of work: units inside other units first, the root (final assembly) last. */
export function resolveUnits(p: Project, entries: string[] = []): { units: Unit[]; diagnostics: SectionDiagnostic[] } {
  const diagnostics: SectionDiagnostic[] = [];
  const err = (message: string) => diagnostics.push({ code: "REL_UNIT_INVALID", severity: "error", message });
  if (!p.rootDef) return { units: [], diagnostics: [{ code: "REL_NO_ROOT", severity: "error", message: "the project has no root system" }] };
  const byPath = new Map(p.instances.map((i) => [i.path, i]));

  // ---- which instance roots which unit
  const unitAt = new Map<string, string>([["", ROOT_UNIT]]);
  const declared: { id: string; entry: string; kind: Unit["kind"]; instances: string[] }[] = [];
  for (const entry of entries) {
    if (entry === "" || entry === p.rootDef.id) {
      diagnostics.push({ code: "REL_UNIT_ROOT", severity: "info", message: `release.units names the root (${entry || '""'}); the root system is always a unit` });
      continue;
    }
    const inst = byPath.get(entry);
    const instances = inst ? [inst.path] : p.instances.filter((i) => i.path !== "" && i.definition === entry).map((i) => i.path);
    if (!instances.length) {
      err(p.definitions.has(entry) ? `release.units names module ${entry}, which the system does not use` : `release.units names ${entry}, which is neither an instance path nor a module id in the system`);
      continue;
    }
    const id = entry.split("/").join(".");
    if (id === ROOT_UNIT || declared.some((d) => d.id === id)) {
      err(`release.units: ${entry} gives the unit folder "${id}", which is taken`);
      continue;
    }
    const taken = instances.filter((i) => unitAt.has(i));
    if (taken.length) {
      err(`release.units: ${taken.join(", ")} ${taken.length > 1 ? "are" : "is"} already in unit ${unitAt.get(taken[0])}; name each instance once (by path or by module id)`);
      continue;
    }
    for (const i of instances) unitAt.set(i, id);
    declared.push({ id, entry, kind: inst ? "instance" : "module", instances });
  }

  const ownerOf = (path: string): string => {
    for (let at = parentOf(path); ; at = parentOf(at)) {
      if (unitAt.has(at)) return unitAt.get(at)!;
      if (at === "") return ROOT_UNIT;
    }
  };

  // a unit named by path may not sit inside one build of a module unit built several times: the builds would differ
  for (const d of declared.filter((x) => x.kind === "instance")) {
    for (let at = parentOf(d.instances[0]); at !== ""; at = parentOf(at)) {
      const outer = declared.find((x) => x.instances.includes(at));
      if (outer?.kind === "module" && outer.instances.length > 1) {
        err(`release.units: ${d.entry} is inside ${at}, one of ${outer.instances.length} builds of unit ${outer.id}; name it by module id (${byPath.get(d.instances[0])!.definition}) so every build is the same`);
        break;
      }
    }
  }

  // ---- quantities through the tree
  const total = (path: string): number => {
    const inst = byPath.get(path);
    if (!inst || path === "") return 1;
    return inst.quantity * total(inst.parent ?? "");
  };
  /** Quantity of `path` per build of the unit rooted at `base` (base excluded). */
  const within = (base: string, path: string): number => {
    let q = 1;
    for (let at = path; at !== base && at !== ""; at = parentOf(at)) q *= byPath.get(at)?.quantity ?? 1;
    return q;
  };

  const make = (id: string, kind: Unit["kind"], entry: string, instances: string[]): Unit => {
    const representative = instances[0];
    const repInst = byPath.get(representative)!;
    const def = p.lookup(repInst.definition)!;
    const members: UnitMember[] = [];
    const walk = (path: string) => {
      for (const child of p.instances.filter((i: Instance) => i.parent === path && i.path !== "")) {
        const sub = unitAt.get(child.path);
        members.push({
          path: relTo(representative, child.path),
          instance: child.path,
          parent: relTo(representative, path),
          definition: child.definition,
          name: child.name ?? p.lookup(child.definition)?.name ?? child.definition,
          kind: child.kind,
          quantity: within(representative, child.path),
          ...(sub ? { unit: sub } : {}),
          depth: relTo(representative, child.path).split("/").length - 1,
        });
        if (!sub) walk(child.path);
      }
    };
    walk(representative);
    const parents = kind === "root" ? [] : [...new Set(instances.map(ownerOf))];
    return {
      id,
      folder: kind === "root" ? ROOT_UNIT : `units/${id}`,
      kind,
      entry,
      name: kind === "root" ? (def.name ?? def.id) : kind === "instance" ? (repInst.name ?? def.name ?? def.id) : (def.name ?? def.id),
      definition: def.id,
      instances,
      representative,
      perProduct: kind === "root" ? 1 : instances.reduce((s, i) => s + total(i), 0),
      parents,
      members,
    };
  };

  const units = [make(ROOT_UNIT, "root", "", [""]), ...declared.map((d) => make(d.id, d.kind, d.entry, d.instances))];
  // order of work: a unit is built after every unit assembled into it
  const level = new Map<string, number>();
  const levelOf = (u: Unit): number => {
    if (level.has(u.id)) return level.get(u.id)!;
    const subs = units.filter((x) => x.parents.includes(u.id));
    const l = subs.length ? 1 + Math.max(...subs.map(levelOf)) : 0;
    level.set(u.id, l);
    return l;
  };
  const order = units.map((u, i) => ({ u, i, l: levelOf(u) })).sort((a, b) => a.l - b.l || (a.u.kind === "root" ? 1 : 0) - (b.u.kind === "root" ? 1 : 0) || a.i - b.i);
  return { units: order.map((x) => x.u), diagnostics };
}

/** The unit an instance path belongs to (its own unit when it roots one). */
export function unitOfInstance(units: Unit[], path: string): Unit | undefined {
  for (let at = path; ; at = parentOf(at)) {
    const u = units.find((x) => x.instances.includes(at));
    if (u) return u;
    if (at === "") return units.find((x) => x.kind === "root");
  }
}

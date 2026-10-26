/**
 * What section contributors share with the release (`@protoboardai/ext-release/helpers`):
 * which custom modules a unit builds, how many per build, the files collected
 * for them, a module's standard outputs, and the model-derived cut list and
 * bill of materials. Providers import this when the release calls them, so
 * it is only loaded where ext-release is installed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityBinding, Project } from "@protoboardai/core";
import { unitModules } from "./collect.ts";
import type { PackageFile, Unit } from "./types.ts";

export { fileGroup, unitModules } from "./collect.ts";
export { CUT_COLUMNS, cutList, cutListCsv, isCable, type CutRow } from "./cutlist.ts";
export { classify, includedWith, orderingList, unitBom, type OrderLine, type UnitBomRow } from "./bom.ts";
export { glbBox, type GlbBox } from "./glb.ts";
export { unitLinks, type UnitLink } from "./sections/model.ts";
export { toCsv } from "./util.ts";

/** Instances of `module` in one build of the unit (the unit's own module counts once). */
export function perBuild(unit: Unit, module: string): number {
  const own = unit.kind !== "root" && unit.definition === module ? 1 : 0;
  return own + unit.members.filter((m) => !m.unit && m.definition === module).reduce((s, m) => s + m.quantity, 0);
}

/** Files the release collected for a module in this unit (package paths under files/<group>/<module>/). */
export function moduleFiles(files: PackageFile[], unit: Unit, module: string): PackageFile[] {
  return files.filter((f) => f.unit === unit.id && new RegExp(`^${unit.folder}/files/[^/]+/${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`).test(f.path));
}

/** Unit-relative form of a package path ("files/mechanical/frame/frame.dxf"). */
export const inUnit = (unit: Unit, path: string) => (path.startsWith(unit.folder + "/") ? path.slice(unit.folder.length + 1) : path);

/** A JSON standard output of a bound module (`out/<file>`), if present and readable. */
export function readOutput<T>(p: Project, b: CapabilityBinding, file: string): T | undefined {
  const f = join(p.root, b.out, file);
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The unit's bound modules of one provider (the provider's own contributions). */
export function providerModules(p: Project, unit: Unit, provider: string): CapabilityBinding[] {
  return unitModules(p, unit).filter((b) => b.provider === provider);
}

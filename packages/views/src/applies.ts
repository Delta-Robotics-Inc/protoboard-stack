/**
 * `applies` predicates: from a manifest's declarative `appliesTo`
 * (core's ViewAppliesTo), and the helpers the built-in views use.
 */
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import type { ViewAppliesTo } from "@protoboardai/core";

/** An artifact's file name (the last path segment, without query or hash). */
export const fileName = (a: { filePath?: string; url?: string }): string => (a.filePath ?? a.url ?? "").split(/[?#]/)[0].split("/").pop() ?? "";

/** A definition by id in the bundle. */
export const definition = (bundle: UhdBundle, id: string | undefined): ModuleDef | undefined => (id ? bundle.definitions.find((d) => d.id === id) : undefined);

/** The module and every module below it, each definition once. */
export function* subtree(module: ModuleDef, bundle: UhdBundle): Generator<ModuleDef> {
  const seen = new Set<string>();
  const stack: ModuleDef[] = [module];
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    yield d;
    for (const c of d.children ?? []) {
      const child = definition(bundle, c.moduleDefId);
      if (child) stack.push(child);
    }
  }
}

/** The module (or, with `descendants`, any module below it) has an artifact named one of `names`. */
export function hasFile(module: ModuleDef, bundle: UhdBundle, names: readonly string[], descendants = false): boolean {
  const own = (d: ModuleDef) => (d.artifacts ?? []).some((a) => names.includes(fileName(a)));
  if (!descendants) return own(module);
  for (const d of subtree(module, bundle)) if (own(d)) return true;
  return false;
}

/** The module or any module below it has an artifact matching `test` (`.glb` models for the 3D view). */
export function hasArtifact(module: ModuleDef, bundle: UhdBundle, test: (name: string) => boolean): boolean {
  for (const d of subtree(module, bundle)) if ((d.artifacts ?? []).some((a) => test(fileName(a)))) return true;
  return false;
}

/** The predicate a manifest's `appliesTo` declares: every given condition holds. */
export function appliesFromDecl(decl: ViewAppliesTo | undefined): (module: ModuleDef, bundle: UhdBundle, at?: { path: string }) => boolean {
  if (!decl) return () => true;
  return (module, bundle, at) => {
    const root = at ? at.path === "" : module.id === bundle.root;
    if (decl.root !== undefined && decl.root !== root) return false;
    if (decl.files && !hasFile(module, bundle, decl.files, decl.descendants)) return false;
    if (decl.categories && !(module.categories ?? []).some((c) => decl.categories!.some((p) => c === p || c.startsWith(`${p}.`)))) return false;
    return true;
  };
}

/**
 * The npm scope of the stack's packages, and a helpful failure for a project
 * that still names the former one (PB-941).
 *
 * Until 2026-10-06 the packages were `@protoboard/…`. That organisation on
 * npmjs belongs to someone else, so a machine without the private-registry
 * line in its npm configuration could have installed that owner's code under
 * our names; the stack moved to `@protoboardai/…` before 0.1.1 was published.
 * A project written for 0.1.0 names the old packages in package.json,
 * protoboard.config.ts, its capability configs and its imports. Instead of a
 * bare "module not found", it gets one diagnostic that says what to change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectDiagnostic, ProtoboardConfig } from "./types.js";

export const PACKAGE_SCOPE = "@protoboardai";
export const FORMER_PACKAGE_SCOPE = "@protoboard";

export const SCOPE_RENAMED = "PB_PACKAGE_SCOPE_RENAMED";

/** The new name of a package named under the former scope (`@protoboard/core` → `@protoboardai/core`), else undefined. */
export const renamedPackage = (name: string): string | undefined =>
  name.startsWith(`${FORMER_PACKAGE_SCOPE}/`) ? `${PACKAGE_SCOPE}/${name.slice(FORMER_PACKAGE_SCOPE.length + 1)}` : undefined;

/** What to do about it; ends every message that reports the former scope. */
export const SCOPE_RENAME_FIX =
  `the Protoboard packages were renamed from ${FORMER_PACKAGE_SCOPE}/… to ${PACKAGE_SCOPE}/… (stack 0.1.1). ` +
  `Replace \`${FORMER_PACKAGE_SCOPE}/\` with \`${PACKAGE_SCOPE}/\` in package.json, protoboard.config.ts, the capability configs (*.config.ts) and the project's imports, ` +
  `point \`${PACKAGE_SCOPE}:registry\` in .npmrc at the registry, then run \`npm install\`. ` +
  `Do not install ${FORMER_PACKAGE_SCOPE}/… packages: that name on npmjs is not Protoboard's`;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides"] as const;

/** Packages under the former scope that the project's package.json lists, sorted. */
export function formerScopeDependencies(root: string): string[] {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const names = DEPENDENCY_FIELDS.flatMap((f) => (manifest[f] && typeof manifest[f] === "object" ? Object.keys(manifest[f] as object) : []));
  return [...new Set(names.filter((n) => renamedPackage(n)))].sort();
}

/**
 * One error for a project that names packages under the former scope: in
 * package.json, in `extensions` of protoboard.config.ts, or as the provider
 * of a capability config. Empty when it names none.
 */
export function formerScopeDiagnostics(root: string, config: ProtoboardConfig, providers: { file: string; provider: string }[] = []): ProjectDiagnostic[] {
  const list = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "));
  const dependencies = formerScopeDependencies(root);
  const extensions = (config.extensions ?? []).filter((n) => renamedPackage(n));
  const configs = providers.filter((c) => renamedPackage(c.provider));
  const where = [
    ...(dependencies.length ? [`package.json lists ${list(dependencies)}`] : []),
    ...(extensions.length ? [`protoboard.config.ts lists the extension${extensions.length > 1 ? "s" : ""} ${list(extensions)}`] : []),
    ...(configs.length ? [`${list(configs.map((c) => c.file))} name${configs.length > 1 ? "" : "s"} the provider${configs.length > 1 ? "s" : ""} ${list([...new Set(configs.map((c) => c.provider))])}`] : []),
  ];
  if (!where.length) return [];
  return [
    {
      code: "PB_PACKAGE_SCOPE_RENAMED",
      severity: "error",
      entity: { kind: "project", id: dependencies.length ? "package.json" : extensions.length ? "protoboard.config.ts" : configs[0].file },
      message: `${where.join("; ")}: ${SCOPE_RENAME_FIX}`,
      source: { file: dependencies.length ? "package.json" : extensions.length ? "protoboard.config.ts" : configs[0].file },
      validator: "protoboard/loader",
    },
  ];
}

/** Whether an error is Node failing to resolve a package under the former scope (`Cannot find package '@protoboard/core' imported from …`). */
export const isFormerScopeImport = (e: unknown): boolean => new RegExp(`['"]${FORMER_PACKAGE_SCOPE}/[^'"]+['"]`).test((e as Error)?.message ?? "");

/** The first line of an import failure, with the rename spelled out when the missing package is under the former scope. */
export function importFailure(e: unknown): string {
  const first = ((e as Error)?.message ?? String(e)).split("\n")[0];
  return isFormerScopeImport(e) ? `${first}: ${SCOPE_RENAME_FIX}` : first;
}

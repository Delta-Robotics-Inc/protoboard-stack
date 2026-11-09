/**
 * The importer registry: the importers this package carries (KiCad, Circuit JSON) plus those of optional importer
 * packages that are installed (EasyEDA Pro). A host loads this one package and calls `availableImporters()`
 * (index.ts); an optional package that is absent is skipped without an error.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Importer } from "@protoboardai/board";

/** An optional importer package: its name, and its source file when this package runs from the repository. */
export interface OptionalImporterPackage {
  package: string;
  /** Relative to this file; used only when the package name does not resolve and the file exists. */
  repoPath?: string;
}

export const OPTIONAL_IMPORTER_PACKAGES: readonly OptionalImporterPackage[] = [{ package: "@protoboardai/board-import-easyeda", repoPath: "../../board-import-easyeda/src/index.ts" }];

const isImporter = (v: unknown): v is Importer => !!v && typeof v === "object" && typeof (v as Importer).id === "string" && typeof (v as Importer).title === "string" && typeof (v as Importer).accepts === "function" && typeof (v as Importer).import === "function";

async function loadModule(p: OptionalImporterPackage): Promise<Record<string, unknown> | undefined> {
  const name = p.package;
  try {
    return (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
  } catch {
    if (!p.repoPath) return undefined;
    const file = fileURLToPath(new URL(p.repoPath, import.meta.url));
    if (!existsSync(file)) return undefined;
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
  }
}

/** The importers exported by the optional packages that are installed (exported importer values and arrays of them), first of each id. */
export async function loadOptionalImporters(packages: readonly OptionalImporterPackage[] = OPTIONAL_IMPORTER_PACKAGES): Promise<Importer[]> {
  const found: Importer[] = [];
  for (const p of packages) {
    const mod = await loadModule(p);
    if (!mod) continue;
    for (const v of Object.values(mod)) {
      if (isImporter(v)) found.push(v);
      else if (Array.isArray(v)) for (const x of v) if (isImporter(x)) found.push(x);
    }
  }
  const byId = new Map<string, Importer>();
  for (const i of found) if (!byId.has(i.id)) byId.set(i.id, i);
  return [...byId.values()];
}

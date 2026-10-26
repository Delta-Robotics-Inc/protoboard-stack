/**
 * Where a purchased part's files are. Two layouts hold the same files:
 *
 *   project (project-researched tier, docs/specs/tool-integrations.md §6)
 *     parts/local/<id>.uhd.ts        the ModuleDef (or wherever the project's
 *                                    sources declare it, e.g. src/modules/…)
 *     parts/evidence/<id>/           sources.json, verification.json, .research/
 *     parts/local/<id>/              the part's own artifacts (CAD, thumbnail)
 *
 *   library (the cloud catalog's curated source, protoboard-cloud library/)
 *     library/parts/<id>.ts          the ModuleDef, exported from library/parts/index.ts
 *     library/parts/<id>/            sources.json, verification.json, .research/
 *     library/parts/<id>/artifacts/  the part's own artifacts
 *
 * A root with protoboard.config.ts is a project; one with
 * library/parts/index.ts is a library.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleDef, Taxonomy, TaxonomyExtension } from "@deltarobotics/uhd";
import { UHD_TAXONOMY_DOCUMENT, buildTaxonomy } from "@deltarobotics/uhd";
import { loadProject, type Project } from "@protoboardai/core";

export type PartLayout = "project" | "library";

export interface PartFiles {
  layout: PartLayout;
  /** Absolute root: artifact file paths in the definitions are relative to it. */
  root: string;
  id: string;
  /** Root-relative paths. */
  definition: string;
  evidence: string;
  research: string;
  artifacts: string;
}

export function detectLayout(root: string): PartLayout | undefined {
  if (existsSync(join(root, "protoboard.config.ts"))) return "project";
  if (existsSync(join(root, "library", "parts", "index.ts"))) return "library";
  return undefined;
}

export function partFiles(root: string, id: string, layout: PartLayout, definition?: string): PartFiles {
  const abs = resolve(root);
  if (layout === "library") {
    const dir = `library/parts/${id}`;
    return { layout, root: abs, id, definition: `library/parts/${id}.ts`, evidence: dir, research: `${dir}/.research`, artifacts: `${dir}/artifacts` };
  }
  const evidence = `parts/evidence/${id}`;
  return { layout, root: abs, id, definition: definition ?? `parts/local/${id}.uhd.ts`, evidence, research: `${evidence}/.research`, artifacts: `parts/local/${id}` };
}

/** The parts a verification can see: the part itself and its peers (vocabulary, mates). */
export interface PartSet {
  layout: PartLayout;
  root: string;
  defs: Map<string, ModuleDef>;
  files: (id: string) => PartFiles;
  /** Project layout: the loaded project. */
  project?: Project;
  /** The taxonomy categories are checked against: UHD's, with a library's extension (library/taxonomy.json) when it has one. */
  taxonomy?: Taxonomy;
  /** A library's kit manifests (library/kits/<kit>.json): kit path → the part ids each lists. */
  kits?: Map<string, Set<string>>;
}

/**
 * The kit memberships a library's manifests declare (library/kits/*.json,
 * each { kit, items: [{ part_id? }] }), or undefined when it has none.
 */
export function libraryKits(root: string): Map<string, Set<string>> | undefined {
  const dir = join(root, "library", "kits");
  if (!existsSync(dir)) return undefined;
  const kits = new Map<string, Set<string>>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const m = readJson<{ kit: string; items?: { part_id?: string }[] }>(join(dir, file));
    if (m?.kit) kits.set(m.kit, new Set((m.items ?? []).flatMap((i) => (i.part_id ? [i.part_id] : []))));
  }
  return kits;
}

/** UHD's taxonomy with the library's own extension (library/taxonomy.json), if the library declares one. */
export function libraryTaxonomy(root: string): Taxonomy | undefined {
  const ext = readJson<TaxonomyExtension>(join(root, "library", "taxonomy.json"));
  return ext ? buildTaxonomy(UHD_TAXONOMY_DOCUMENT, [ext]) : undefined;
}

const isModuleDef = (v: unknown): v is ModuleDef =>
  !!v && typeof v === "object" && typeof (v as ModuleDef).id === "string" && Array.isArray((v as ModuleDef).interfaces);

/** A project's definitions (local and catalog); local parts' files follow their source. */
export function projectParts(p: Project): PartSet {
  const defs = new Map([...p.definitions.entries()].map(([id, rec]) => [id, rec.def]));
  const files = (id: string) => {
    const rec = p.definitions.get(id);
    return partFiles(p.root, id, "project", rec?.origin.kind === "local" ? rec.origin.source.file : undefined);
  };
  return { layout: "project", root: p.root, defs, files, project: p };
}

/**
 * Load the parts under `root`. A library is imported through its
 * library/parts/index.ts (needs a TS loader: run the scripts with tsx); a
 * project through @protoboardai/core.
 */
export async function loadParts(root: string): Promise<PartSet> {
  const abs = resolve(root);
  const layout = detectLayout(abs);
  if (layout === "project") return projectParts(await loadProject(abs));
  if (layout !== "library") throw new Error(`${abs} is neither a Protoboard project (protoboard.config.ts) nor a part library (library/parts/index.ts)`);
  const mod = (await import(pathToFileURL(join(abs, "library", "parts", "index.ts")).href)) as Record<string, unknown>;
  const defs = new Map(Object.values(mod).filter(isModuleDef).map((d) => [d.id, d]));
  const taxonomy = libraryTaxonomy(abs);
  const kits = libraryKits(abs);
  return { layout, root: abs, defs, files: (id) => partFiles(abs, id, "library"), ...(taxonomy ? { taxonomy } : {}), ...(kits ? { kits } : {}) };
}

/**
 * The definition exported from the part's own source file, imported fresh
 * (so `defineModule` runs on it): the file must export a ModuleDef with the id.
 */
export async function importPart(f: PartFiles): Promise<ModuleDef> {
  const file = join(f.root, f.definition);
  if (!existsSync(file)) throw new Error(`No part file at ${f.definition}`);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const defs = Object.values(mod).filter(isModuleDef);
  const def = defs.find((d) => d.id === f.id);
  if (!def) throw new Error(`${f.definition} exports no ModuleDef with id "${f.id}" (found: ${defs.map((d) => d.id).join(", ") || "none"})`);
  return def;
}

export const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined);

export const rel = (f: PartFiles, abs: string) => relative(f.root, abs).split("\\").join("/");

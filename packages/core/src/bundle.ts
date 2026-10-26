/**
 * UHD bundle export (docs/specs/uhd-boundary.md, "The viewer contract"): the
 * project as a neutral UHD bundle for UHD-only consumers such as the UHD
 * viewer. Origins are resolved here: each definition's artifact base is the
 * absolute directory its relative artifact paths resolve against.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UHD_BUNDLE_SCHEMA, reachableDefinitions, type ModuleDef, type UhdBundle, type UhdBundleScenario } from "@deltarobotics/uhd";
import { stableStringify } from "./build.js";
import { FRAMEWORK_VERSION } from "./extensions.js";
import { artifactBaseDir, importTs } from "./load.js";
import { attachedArtifacts, withArtifacts } from "./capabilities.js";
import type { Project } from "./project.js";

interface ProjectScenario {
  id: string;
  label: string;
  description?: string;
  system?: ModuleDef;
  overrides?: ModuleDef[];
}

export async function uhdBundle(p: Project): Promise<UhdBundle> {
  if (!p.rootDef) throw new Error("project has no root system");
  const defs = reachableDefinitions(p.rootDef, p.lookup);
  const scenarios: UhdBundleScenario[] = [];
  if (p.config.scenarios) {
    const mod = await importTs(join(p.root, p.config.scenarios.source));
    for (const s of ((mod as Record<string, unknown>)[p.config.scenarios.export] as ProjectScenario[] | undefined) ?? []) {
      scenarios.push({
        id: s.id,
        label: s.label,
        ...(s.description ? { description: s.description } : {}),
        ...(s.system ? { root: s.system } : {}),
        ...(s.overrides?.length ? { definitions: s.overrides } : {}),
      });
    }
  }
  // a scenario's variant of a board keeps the outputs its provider attached to the board (PB-1030)
  for (const s of scenarios) if (s.definitions) s.definitions = s.definitions.map((d) => withArtifacts(d, attachedArtifacts(p.lookup(d.id) ?? d)));
  // definitions only a scenario reaches (e.g. a second GNSS) travel with it
  const known = new Set(defs.map((d) => d.id));
  for (const s of scenarios) {
    if (!s.root) continue;
    const extra = reachableDefinitions(s.root, (id) => s.definitions?.find((d) => d.id === id) ?? p.lookup(id)).filter((d) => !known.has(d.id) && !s.definitions?.some((x) => x.id === d.id));
    if (extra.length) s.definitions = [...(s.definitions ?? []), ...extra];
  }

  const artifactBases: Record<string, string> = {};
  for (const d of [...defs, ...scenarios.flatMap((s) => s.definitions ?? [])]) {
    const rec = p.definitions.get(d.id);
    const base = rec ? artifactBaseDir(p.root, rec.origin.artifactBase) : p.root;
    if (base) artifactBases[d.id] = base;
  }

  const displayFile = join(p.root, p.config.display ?? ".protoboard/display.json");
  const display = existsSync(displayFile) ? (JSON.parse(readFileSync(displayFile, "utf8")) as Record<string, unknown>) : undefined;

  return {
    schema: UHD_BUNDLE_SCHEMA,
    root: p.rootDef.id,
    definitions: defs.sort((a, b) => a.id.localeCompare(b.id)),
    artifactBases,
    ...(scenarios.length ? { scenarios } : {}),
    diagnostics: p.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message, entity: d.entity, ...(d.source ? { source: d.source } : {}), validator: d.validator })),
    ...(display ? { display } : {}),
    meta: { name: p.name, producer: "@protoboardai/core", producerVersion: FRAMEWORK_VERSION },
  };
}

export async function writeBundle(p: Project, outDir = join(p.root, ".protoboard", "build")) {
  const file = join(outDir, "uhd-bundle.json");
  mkdirSync(dirname(file), { recursive: true });
  const data = stableStringify(await uhdBundle(p));
  writeFileSync(file, data);
  return { file, bytes: data.length };
}

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
import { modelTable, projectHas3d, writeModelFiles, type ModelTable } from "./part-files.js";
import { projectRelative } from "./paths.js";
import { annotateFindings, projectNames } from "./findings-text.js";

interface ProjectScenario {
  id: string;
  label: string;
  description?: string;
  system?: ModuleDef;
  overrides?: ModuleDef[];
}

export async function uhdBundle(p: Project, models?: ModelTable): Promise<UhdBundle> {
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

  // bodies the resolver found outside a definition's own artifacts (PB-1174): a placeholder box, a vendor
  // model fetched into parts/files. They join the definition as one more body GLB, so a viewer that draws
  // a definition's body draws them; a definition whose base is not the project is re-based on it (its paths
  // prefixed) so the file is inside the base the viewer serves
  const table = models ?? modelTable(p);
  const extra = new Map<string, string>();
  // a project that draws nothing in 3D gets no boxes either (as check reports no missing model there)
  for (const e of projectHas3d(p) ? table.instances : []) {
    if (e.drawnBy || !e.file || e.format !== "glb" || e.file.startsWith("cache:") || e.file.startsWith("package:")) continue;
    if (e.source !== "placeholder" && e.source !== "vendor" && e.source !== "pin") continue;
    extra.set(e.part, e.file);
  }
  for (let i = 0; i < defs.length; i++) {
    const file = extra.get(defs[i].id);
    if (!file) continue;
    const d = defs[i];
    const base = artifactBases[d.id];
    const prefix = base && base !== p.root ? projectRelative(p.root, base) : "";
    if (prefix.startsWith("..")) continue; // a package's definition: its base is outside the project
    const rebased = prefix ? (d.artifacts ?? []).map((a) => (a.filePath ? { ...a, filePath: `${prefix}/${a.filePath}` } : a)) : (d.artifacts ?? []);
    const placeholder = table.instances.some((e) => e.part === d.id && e.source === "placeholder");
    defs[i] = {
      ...d,
      artifacts: [
        ...rebased.map((a) => (a.role === "body" && a.format === "glb" ? { ...a, role: "source" as const } : a)),
        { id: "resolved_glb", name: placeholder ? `${d.name ?? d.id} (placeholder)` : `${d.name ?? d.id} (vendor model)`, type: "3d_model", role: "body", format: "glb", units: "m", filePath: file, provenance: { tool: "@protoboardai/core part-files" } },
      ],
    };
    artifactBases[d.id] = p.root;
  }

  const displayFile = join(p.root, p.config.display ?? ".protoboard/display.json");
  const display = existsSync(displayFile) ? (JSON.parse(readFileSync(displayFile, "utf8")) as Record<string, unknown>) : undefined;

  return {
    schema: UHD_BUNDLE_SCHEMA,
    root: p.rootDef.id,
    definitions: defs.sort((a, b) => a.id.localeCompare(b.id)),
    artifactBases,
    ...(scenarios.length ? { scenarios } : {}),
    // `location` (a provider's finding on a design: board mm, pads, vias) is kept so the viewer pins the finding to
    // the 3D model (W3-B, PB-1184). It is an extra field beyond UHD's `UhdBundleDiagnostic` (UHD is read only: the
    // field is noted in for-mark.md); readers that do not know it ignore it.
    // `title` and `summary` (wave R2, D3: plain words for people, findings-text.ts) are extra fields too: the 3D view's
    // callouts show them, `message` stays the raw detail; a finding added after loading (the diagram's layout) gets
    // them here. Additive: readers that do not know them ignore them.
    diagnostics: annotateFindings(p.diagnostics, projectNames(p)).map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      ...(d.title ? { title: d.title } : {}),
      ...(d.summary ? { summary: d.summary } : {}),
      entity: d.entity,
      ...(d.source ? { source: d.source } : {}),
      ...(d.location ? { location: d.location } : {}),
      validator: d.validator,
    })),
    ...(display ? { display } : {}),
    meta: { name: p.name, producer: "@protoboardai/core", producerVersion: FRAMEWORK_VERSION },
  };
}

export async function writeBundle(p: Project, outDir = join(p.root, ".protoboard", "build")) {
  const file = join(outDir, "uhd-bundle.json");
  mkdirSync(dirname(file), { recursive: true });
  const models = modelTable(p);
  writeModelFiles(p, models);
  const data = stableStringify(await uhdBundle(p, models));
  writeFileSync(file, data);
  return { file, bytes: data.length };
}

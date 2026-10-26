/**
 * Loading a Protoboard project's system for documentation, and turning its
 * assembly into renderable bodies. Everything here is read from the model at
 * run time: `assemble()` placements and hardware, artifacts, manifests.
 * Artifact paths resolve against each definition's artifact base (the
 * project, the parts/catalog/<id> directory a catalog revision was vendored
 * into, or an older pin's package), never against a repository.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import type { ArtifactDef, GeometryFrame, GeometryManifest, ModuleDef } from "@deltarobotics/uhd";
import type { ModuleLookup } from "@deltarobotics/uhd";
import { applyMat4, assemble, bodyKey, multiplyMat4, type Assembly, type Mat4 } from "@deltarobotics/uhd";
import { packageRoot, type Project } from "@protoboardai/core";
import { packagePath, projectPath, type ServerRoots } from "./render/server.ts";
import type { DocConfig } from "./types.ts";

/** Project-relative folder of the documents and their spec (`docs/docspec.ts`). */
export const DOCS_DIR = "docs";

export interface LoadedSystem {
  /** Project name, shown in the documents. */
  name: string;
  /** Absolute project root. */
  root: string;
  /** The documents folder: project-relative and absolute. */
  docsDir: string;
  absDocs: string;
  system: ModuleDef;
  lookup: ModuleLookup;
  scenarios: { id: string; label: string; description: string; system: ModuleDef; lookup: ModuleLookup }[];
  config: DocConfig;
  /** What the doc server serves: the project, and packages by name. */
  roots: ServerRoots;
  /** The absolute file of an artifact path `def` declares (resolved against its origin), if it can be placed. */
  file: (def: ModuleDef, filePath: string) => string | undefined;
  /** The same file as a served path (server.ts). */
  served: (def: ModuleDef, filePath: string) => string | undefined;
  /** Folders that may hold a definition's sources.json and verification.json. */
  evidenceDirs: (id: string) => string[];
}

interface ProjectScenario {
  id: string;
  label: string;
  description?: string;
  system?: ModuleDef;
  overrides?: ModuleDef[];
}

/** The project's root system, its scenarios and `docs/docspec.ts`, with artifact and evidence resolution. */
export async function loadSystem(p: Project, docsDir = DOCS_DIR): Promise<LoadedSystem> {
  if (!p.rootDef) throw new Error("the project has no root system (protoboard.config.ts root)");
  const system = p.rootDef;
  const lookup: ModuleLookup = (id) => p.lookup(id);
  const packages = new Map<string, string | undefined>();
  const pkgRoot = (name: string) => {
    if (!packages.has(name)) packages.set(name, packageRoot(p.root, name));
    return packages.get(name);
  };
  // A definition's artifact base (core ArtifactBase): the project, a directory in it the
  // catalog revision was vendored into (parts/catalog/<id>), or an installed package.
  type Base = { kind: "project"; dir: string } | { kind: "package"; name: string; root: string };
  const base = (def: ModuleDef): Base | undefined => {
    const rec = p.definitions.get(def.id);
    const ab = rec?.origin.artifactBase;
    if (!ab || ab.kind === "project") return { kind: "project", dir: "" };
    if (ab.kind === "vendored") return { kind: "project", dir: ab.dir };
    const root = pkgRoot(ab.package);
    return root ? { kind: "package", name: ab.package, root } : undefined;
  };
  const file = (def: ModuleDef, filePath: string) => {
    const b = base(def);
    return b ? join(b.kind === "project" ? join(p.root, b.dir) : b.root, filePath) : undefined;
  };
  const served = (def: ModuleDef, filePath: string) => {
    const b = base(def);
    return b ? (b.kind === "project" ? projectPath(b.dir ? `${b.dir}/${filePath}` : filePath) : packagePath(b.name, filePath)) : undefined;
  };
  const evidenceDirs = (id: string) => {
    const rec = p.definitions.get(id);
    const dirs = [join(p.root, "parts", "evidence", id)];
    // evidence files vendored with the catalog revision (parts/catalog/<id>/…)
    for (const e of rec?.origin.evidence ?? []) {
      const dir = dirname(join(p.root, e.file));
      if (!dirs.includes(dir)) dirs.push(dir);
    }
    // catalog parts vendored from a package keep their evidence at library/parts/<id> in it
    if (rec?.origin.kind === "catalog" && rec.origin.package) {
      const root = pkgRoot(rec.origin.package);
      if (root) dirs.push(join(root, "library", "parts", id));
    }
    return dirs;
  };

  let scenarios: LoadedSystem["scenarios"] = [];
  if (p.config.scenarios) {
    const mod = (await import(pathToFileURL(join(p.root, p.config.scenarios.source)).href)) as Record<string, unknown>;
    scenarios = ((mod[p.config.scenarios.export] as ProjectScenario[] | undefined) ?? []).map((s) => {
      const overrides = new Map((s.overrides ?? []).map((d) => [d.id, d]));
      return { id: s.id, label: s.label, description: s.description ?? "", system: s.system ?? system, lookup: (id: string) => overrides.get(id) ?? p.lookup(id) };
    });
  }
  let config: DocConfig = {};
  const spec = join(p.root, docsDir, "docspec.ts");
  if (existsSync(spec)) config = ((await import(pathToFileURL(spec).href)) as { default?: DocConfig }).default ?? {};
  return {
    name: p.name,
    root: p.root,
    docsDir,
    absDocs: join(p.root, docsDir),
    system,
    lookup,
    scenarios,
    config,
    roots: { project: p.root, packageRoot: pkgRoot },
    file,
    served,
    evidenceDirs,
  };
}

/** The generator manifest for one of a module's CAD artifacts (the JSON artifact generated from it). */
export function manifestFor(sys: LoadedSystem, def: ModuleDef, artifactId: string): GeometryManifest | undefined {
  const art = (def.artifacts ?? []).find((a) => a.format === "json" && a.provenance?.generatedFrom === artifactId && a.filePath);
  const f = art?.filePath ? sys.file(def, art.filePath) : undefined;
  if (!f || !existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as GeometryManifest;
  } catch {
    return undefined;
  }
}

/** Solid volume (mm³) of a module's generated CAD body: the `volume_mm3` its generator records (UHD systemMass input). */
export const cadVolume = (sys: LoadedSystem) => (def: ModuleDef): number | undefined => manifestFor(sys, def, "cad_step")?.volume_mm3;

// ---------------------------------------------------------------------------
// Classification (drawing palette only; never shown as data)
// ---------------------------------------------------------------------------

/**
 * UHD taxonomy paths (docs/taxonomy.md) and the drawing class of a part
 * filed at or under them. Matched by whole segments, so
 * `actuator.motor_controller` (an ESC) is not under `actuator.motor`.
 */
const TAXONOMY_CLASSES: [string, string][] = [
  ["actuator.motor", "motor"],
  ["actuator.motor_controller", "esc"],
  ["mechanical.propeller", "prop"],
  ["microcontroller.flight_controller", "fc"],
  ["connectivity.wireless.video", "video"],
  ["power.battery", "battery"],
  ["sensor.gnss", "gnss"],
  ["component.passive.capacitor", "capacitor"],
];

export function category(def: ModuleDef): string {
  const id = def.id;
  const tags = new Set(def.tags ?? []);
  const paths = def.categories ?? [];
  const cats = paths.join(" ");
  if (tags.has("screw")) return "screw";
  if (tags.has("nut")) return "nut";
  if (tags.has("standoff")) return "standoff";
  if (tags.has("spacer")) return "spacer";
  if (id.includes("top-plate")) return "top_plate";
  if (tags.has("frame") || cats.includes("structure") && id.includes("frame")) return "frame";
  // taxonomy paths, in the definition's order: its first category is what it is
  for (const path of paths) for (const [root, cls] of TAXONOMY_CLASSES) if (path === root || path.startsWith(`${root}.`)) return cls;
  if (tags.has("receiver")) return "receiver";
  // categories from before the UHD taxonomy (PB-849)
  if (cats.includes("motor")) return "motor";
  if (cats.includes("propeller") || tags.has("propeller")) return "prop";
  if (cats.includes("esc")) return "esc";
  if (cats.includes("flight_controller")) return "fc";
  if (cats.includes("video")) return "video";
  if (cats.includes("battery")) return "battery";
  if (cats.includes("gnss")) return "gnss";
  if (cats.includes("receiver")) return "receiver";
  if (cats.includes("capacitor")) return "capacitor";
  return "generic";
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/** Body GLB for a module (or for one of its bodies, by the STEP/vendor artifact id). */
export function glbFor(def: ModuleDef, bodyArtifact?: string): ArtifactDef | undefined {
  const arts = def.artifacts ?? [];
  if (bodyArtifact) return arts.find((a) => a.format === "glb" && (a.id === bodyArtifact || a.provenance?.generatedFrom === bodyArtifact));
  return arts.find((a) => a.role === "body" && a.format === "glb");
}

/** Feature names in the manifest of the STEP a GLB was generated from (sub-shapes to hide or call out). */
export function featureNames(sys: LoadedSystem, def: ModuleDef, glb?: ArtifactDef): string[] {
  const src = glb?.provenance?.generatedFrom;
  return src ? Object.keys(manifestFor(sys, def, src)?.features ?? {}) : [];
}

// ---------------------------------------------------------------------------
// Scene bodies from the assembly
// ---------------------------------------------------------------------------

export interface SceneBody {
  key: string;
  path: string[];
  def: ModuleDef;
  glb?: string;
  matrix: Mat4;
  category: string;
  features: string[];
  vendor: boolean;
  /** Link that placed it; "hint:<note>" for doc-config placements. */
  via?: string;
  /** Hardware only. */
  harness?: string;
  child?: string;
  linkId?: string;
}

export interface SceneModel {
  assembly: Assembly;
  bodies: SceneBody[];
  hardware: SceneBody[];
  byKey: Map<string, SceneBody>;
}

export function buildScene(sys: LoadedSystem): SceneModel {
  const fixed: Record<string, Mat4> = {};
  for (const h of sys.config.placementHints ?? []) fixed[bodyKey(h.path)] = h.matrix;
  const assembly = assemble(sys.system, sys.lookup, { root: sys.config.root ?? [], fixed });
  const defs = new Map(assembly.instances.map((i) => [bodyKey(i.path), i.def]));
  // A module with children is flattened into its leaves by assemble(), but one with its own body
  // (a circuit board: its GLB carries every component) is drawn whole when a hint places it.
  const walk = (d: ModuleDef, prefix: string[]) => {
    for (const ref of d.children ?? []) {
      const child = sys.lookup(ref.moduleDefId);
      if (!child?.children?.length || child.kind === "harness") continue;
      const path = [...prefix, ref.id];
      if (glbFor(child) && fixed[bodyKey(path)]) defs.set(bodyKey(path), child);
      walk(child, path);
    }
  };
  walk(sys.system, []);
  const bodies: SceneBody[] = [];
  // a placed module with children (a designed board carrying its components) is not a leaf instance; it is a body when it has its own GLB
  const defAt = (path: string[]): ModuleDef | undefined => {
    let d: ModuleDef | undefined = sys.system;
    for (const id of path) {
      const ref: { moduleDefId: string } | undefined = d?.children?.find((c) => c.id === id);
      d = ref ? sys.lookup(ref.moduleDefId) : undefined;
    }
    return d;
  };
  for (const p of assembly.placements) {
    const leaf = defs.get(bodyKey(p.path));
    const inner = leaf ? undefined : defAt(p.path);
    const def = leaf ?? (inner && glbFor(inner, p.body) ? inner : undefined);
    if (!def) continue;
    const glb = glbFor(def, p.body);
    const hint = (sys.config.placementHints ?? []).find((h) => bodyKey(h.path) === p.key);
    bodies.push({
      key: p.key,
      path: p.path,
      def,
      glb: glb?.filePath ? sys.served(def, glb.filePath) : undefined,
      matrix: p.matrix,
      category: category(def),
      features: featureNames(sys, def, glb),
      vendor: Boolean(glb?.id.startsWith("cad_vendor")),
      via: p.via ?? (hint ? `hint:${hint.note}` : undefined),
    });
  }
  const counters = new Map<string, number>();
  const hardware: SceneBody[] = assembly.hardware.map((h) => {
    const base = `${h.harness}/${h.child}`;
    const n = (counters.get(base) ?? 0) + 1;
    counters.set(base, n);
    const glb = glbFor(h.def);
    return {
      key: `${base}#${n}`,
      path: [...h.harness.split("/"), h.child],
      def: h.def,
      glb: glb?.filePath ? sys.served(h.def, glb.filePath) : undefined,
      matrix: h.matrix,
      category: category(h.def),
      features: featureNames(sys, h.def, glb),
      vendor: false,
      harness: h.harness,
      child: h.child,
      linkId: h.linkId,
    };
  });
  const byKey = new Map([...bodies, ...hardware].map((b) => [b.key, b]));
  return { assembly, bodies, hardware, byKey };
}

/** World position and direction of an interface frame on a placed body. */
export function worldFrame(matrix: Mat4, frame: GeometryFrame): { origin: number[]; normal: number[] } {
  const o = applyMat4(matrix, frame.origin);
  const tip = applyMat4(matrix, [frame.origin[0] + frame.normal[0], frame.origin[1] + frame.normal[1], frame.origin[2] + frame.normal[2]]);
  const n = [tip[0] - o[0], tip[1] - o[1], tip[2] - o[2]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return { origin: o, normal: n.map((x) => x / len) };
}

export const translate = (v: number[]): Mat4 => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];
export const offsetMatrix = (m: Mat4, v: number[]): Mat4 => multiplyMat4(translate(v), m);
export const matTranslation = (m: Mat4): number[] => [m[3], m[7], m[11]];

/**
 * The build step: a view sidecar for every body GLB a project's bundle
 * references (PB-1173). Runs after `writeBundle` (it reads
 * `.protoboard/build/uhd-bundle.json`), so it covers project modules, local
 * parts, harnesses, vendored catalog bodies and boards alike.
 *
 * Pre-flight counts: what one frame of the 3D view would cost before and
 * after, as draw calls and triangles, estimated from each file's counts
 * times the instances drawn with it: the build's model table
 * (resolved.json models.instances) when there is one, else the placements of
 * its definition in the instance tree. Fastener-stack hardware placements
 * are in neither, so they are counted once at most: an estimate, not a
 * measurement of the viewer.
 *
 * Paths: an artifact path resolves against its definition's artifact base
 * (bundle.artifactBases) and must stay inside it; a path that leaves it is
 * skipped (zip-slip rule). Until the W1-B resolver (part-files.ts) owns the
 * model table, this reads the bundle's artifacts directly.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { partKindOf } from "./materials.js";
import { isCoarseSourceFile, isViewSidecarFile } from "./names.js";
import { writeViewSidecar, type ViewSidecarResult } from "./sidecar.js";
import type { ViewComponent, ViewContext, ViewCounts, ViewOwner } from "./types.js";

interface BundleArtifact {
  id?: string;
  role?: string;
  format?: string;
  type?: string;
  filePath?: string;
  url?: string;
  name?: string;
  description?: string;
  provenance?: { generatedFrom?: string };
}
interface BundleChild {
  id: string;
  moduleDefId: string;
  name?: string;
  overrides?: Record<string, unknown>;
}
interface BundleDef {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  categories?: unknown[];
  manufacturer?: string;
  part_number?: string;
  artifacts?: BundleArtifact[];
  children?: BundleChild[];
}
interface Bundle {
  root: string;
  definitions: BundleDef[];
  artifactBases?: Record<string, string>;
}

export interface ProjectViewFile {
  /** Project-relative path of the body GLB (forward slashes). */
  file: string;
  definition: string;
  placements: number;
  cached: boolean;
  before?: ViewCounts;
  after?: ViewCounts;
  coarseTriangles?: number;
  error?: string;
}

export interface ProjectViewSummary {
  files: ProjectViewFile[];
  written: number;
  cached: number;
  failed: number;
  /** One frame of the 3D view, every placement drawn: before (X.glb) and after (X.view.glb). */
  totals: { before: { draws: number; triangles: number; nodes: number }; after: { draws: number; triangles: number; nodes: number }; coarseTriangles: number };
  /** One line for `protoboard build` and the MCP `project_build` result. */
  line: string;
}

export interface ProjectViewOptions {
  force?: boolean;
  log?: (line: string) => void;
  /** Bundle path; default `<root>/.protoboard/build/uhd-bundle.json`. */
  bundle?: string;
}

/** An LCSC part number (C and digits) not inside a longer word; case-sensitive, so a package code like c0603 is not one. */
const LCSC = /(?:^|[^A-Za-z0-9])(C\d{3,9})(?!\d)/;

/** `lcsc:C25804` from an LCSC product-page artifact, else `mpn:<manufacturer> <part number>`. */
export function vendorKeyOf(def: BundleDef | undefined, overrides?: Record<string, unknown>): string | undefined {
  if (!def) return undefined;
  for (const a of def.artifacts ?? []) {
    const text = `${a.name ?? ""} ${a.url ?? ""}`;
    if (/lcsc/i.test(text)) {
      const m = LCSC.exec(text);
      if (m) return `lcsc:${m[1]}`;
    }
  }
  const pn = (typeof overrides?.part_number === "string" && overrides.part_number) || def.part_number;
  if (pn) return `mpn:${def.manufacturer ? `${def.manufacturer} ` : ""}${pn}`;
  return undefined;
}

const words = (def: BundleDef | undefined) => (def ? [...(def.tags ?? []), ...(def.categories ?? []).map((c) => (typeof c === "string" ? c : JSON.stringify(c))), def.name, def.id] : []);
const isPlaceholder = (def: BundleDef | undefined) => !!def && ((def.tags ?? []).some((t) => /placeholder|stand-?in/i.test(t)) || /\bplaceholder\b|\bstand-?in\b/i.test(`${def.name ?? ""} ${def.id}`));

function ownerOf(def: BundleDef): ViewOwner {
  const kind = partKindOf(words(def));
  const vk = vendorKeyOf(def);
  return { definition: def.id, ...(kind ? { partKind: kind } : {}), ...(vk ? { vendorKey: vk } : {}), ...(isPlaceholder(def) ? { placeholder: true } : {}) };
}

/** Components below a definition, keyed by lower-case instance id and instance path; ambiguous ids are left out. */
export function componentsOf(def: BundleDef, defs: Map<string, BundleDef>): Map<string, ViewComponent> {
  const out = new Map<string, ViewComponent>();
  const clash = new Set<string>();
  const add = (k: string, c: ViewComponent) => {
    if (clash.has(k)) return;
    if (out.has(k) && out.get(k)!.instancePath !== c.instancePath) {
      out.delete(k);
      clash.add(k);
      return;
    }
    out.set(k, c);
  };
  const walk = (d: BundleDef, prefix: string, depth: number) => {
    for (const ch of d.children ?? []) {
      const path = prefix ? `${prefix}/${ch.id}` : ch.id;
      const cd = defs.get(ch.moduleDefId);
      const kind = partKindOf([...words(cd), ch.name]);
      const vk = vendorKeyOf(cd, ch.overrides);
      const comp: ViewComponent = { instancePath: path, definition: ch.moduleDefId, ...(vk ? { vendorKey: vk } : {}), ...(kind ? { partKind: kind } : {}), ...(isPlaceholder(cd) ? { placeholder: true } : {}) };
      add(ch.id.toLowerCase(), comp);
      add(path.toLowerCase(), comp);
      // the designator as the instance's name starts with it ("12V_DCJ DC barrel jack ..."), when the id could not
      // carry it (ids are lower-case identifiers: n12v_dcj)
      const token = /^([A-Za-z0-9][A-Za-z0-9_+.-]*)\s/.exec(ch.name ?? "")?.[1]?.toLowerCase();
      if (token && /\d|_|-/.test(token)) byName.push([token, comp]);
      if (cd && depth < 32) walk(cd, path, depth + 1);
    }
  };
  const byName: [string, ViewComponent][] = [];
  walk(def, "", 0);
  const named = new Map<string, ViewComponent | null>();
  for (const [k, c] of byName) named.set(k, named.has(k) && named.get(k)?.instancePath !== c.instancePath ? null : c);
  for (const [k, c] of named) if (c && !out.has(k) && !clash.has(k)) out.set(k, c);
  return out;
}

/** How many times each definition is placed in the instance tree from the root. */
export function placementCounts(bundle: Bundle): Map<string, number> {
  const defs = new Map(bundle.definitions.map((d) => [d.id, d]));
  const counts = new Map<string, number>();
  const walk = (id: string, depth: number) => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (depth > 64) return;
    for (const c of defs.get(id)?.children ?? []) walk(c.moduleDefId, depth + 1);
  };
  walk(bundle.root, 0);
  return counts;
}

const posix = (p: string) => p.split("\\").join("/");

/** Body GLBs the bundle references, resolved and contained, one entry per file. */
export function bodyGlbs(root: string, bundle: Bundle): { abs: string; rel: string; def: BundleDef; artifact?: BundleArtifact }[] {
  const seen = new Set<string>();
  const out: { abs: string; rel: string; def: BundleDef; artifact?: BundleArtifact }[] = [];
  for (const def of bundle.definitions) {
    for (const a of def.artifacts ?? []) {
      if (!a.filePath || a.role === "interface") continue;
      if (!(a.format === "glb" || /\.glb$/i.test(a.filePath))) continue;
      if (isViewSidecarFile(a.filePath) || isCoarseSourceFile(a.filePath)) continue;
      if (a.role && a.role !== "body") continue;
      const base = bundle.artifactBases?.[def.id] ?? root;
      const abs = resolve(base, a.filePath);
      const inside = relative(base, abs);
      if (inside.startsWith("..") || isAbsolute(inside)) continue;
      if (seen.has(abs) || !existsSync(abs)) continue;
      seen.add(abs);
      out.push({ abs, rel: posix(relative(root, abs)), def, artifact: a });
    }
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Geometry manifests over this size are not read (security basics: size caps on parsed files). */
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

/**
 * The node names a body GLB's geometry manifest gives: `features` (interface pads) and `bodies` (named bodies).
 * The manifest is found as the viewer finds it (uhd-viewer model.ts loadManifests): a JSON artifact of the same
 * definition generated from the same source as the GLB (or from the GLB); else `X.manifest.json` beside `X.glb`.
 */
export function manifestNames(root: string, bundle: Bundle, def: BundleDef, glb: { abs: string; artifact?: BundleArtifact }): { features: string[]; bodies: string[] } {
  const base = bundle.artifactBases?.[def.id] ?? root;
  const from = glb.artifact?.provenance?.generatedFrom;
  const files: string[] = [];
  for (const a of def.artifacts ?? []) {
    const g = a.provenance?.generatedFrom;
    if (a.format !== "json" || !g || !a.filePath || !(g === from || g === glb.artifact?.id)) continue;
    const abs = resolve(base, a.filePath);
    const inside = relative(base, abs);
    if (!inside.startsWith("..") && !isAbsolute(inside)) files.push(abs);
  }
  files.push(glb.abs.replace(/.glb$/i, ".manifest.json"));
  const features = new Set<string>();
  const bodies = new Set<string>();
  for (const f of files) {
    try {
      if (!existsSync(f) || statSync(f).size > MAX_MANIFEST_BYTES) continue;
      const m = JSON.parse(readFileSync(f, "utf8")) as { features?: Record<string, unknown>; bodies?: Record<string, unknown> };
      for (const k of Object.keys(m.features && typeof m.features === "object" ? m.features : {})) features.add(k);
      for (const k of Object.keys(m.bodies && typeof m.bodies === "object" ? m.bodies : {})) bodies.add(k);
    } catch {
      // an unreadable manifest names nothing; the body is merged as one node
    }
  }
  return { features: [...features].sort(), bodies: [...bodies].sort() };
}

interface ModelRow {
  file?: string;
  format?: string;
  part?: string;
  instance?: string;
  placeholder?: boolean;
}

/**
 * The build's model table (`resolved.json` → models.instances, written by the W1-B resolver): one row per drawn
 * instance with the body file it resolved to. Absent before the resolver ran; then the bundle alone is used.
 */
function modelRows(root: string): ModelRow[] {
  const file = join(root, ".protoboard", "build", "resolved.json");
  if (!existsSync(file)) return [];
  try {
    const rows = (JSON.parse(readFileSync(file, "utf8")) as { models?: { instances?: ModelRow[] } }).models?.instances;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Write the view sidecars of every body GLB of the project at `root` (after `protoboard build` wrote the bundle). */
export async function writeProjectViewSidecars(root: string, options: ProjectViewOptions = {}): Promise<ProjectViewSummary> {
  const bundlePath = options.bundle ?? join(root, ".protoboard", "build", "uhd-bundle.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
  const defs = new Map(bundle.definitions.map((d) => [d.id, d]));
  const placements = placementCounts(bundle);
  // drawn instances per body file from the model table when the build wrote one (exact, placeholders included);
  // else placements of the definition in the instance tree
  const rows = modelRows(root).filter((r) => r.file && (r.format === "glb" || /.glb$/i.test(r.file)));
  const drawn = new Map<string, number>();
  for (const r of rows) drawn.set(posix(r.file!), (drawn.get(posix(r.file!)) ?? 0) + 1);
  const glbs = bodyGlbs(root, bundle);
  const known = new Set(glbs.map((g) => g.rel));
  for (const r of rows) {
    // files the resolver chose that the bundle does not list (placeholders, restored vendor files), inside the project only
    const rel = posix(r.file!);
    const abs = resolve(root, rel);
    const inside = relative(root, abs);
    if (known.has(rel) || inside.startsWith("..") || isAbsolute(inside) || !existsSync(abs) || isViewSidecarFile(rel)) continue;
    const def = defs.get(r.part ?? "") ?? { id: r.part ?? rel };
    glbs.push({ abs, rel, def: r.placeholder ? { ...def, tags: [...(def.tags ?? []), "placeholder"] } : def });
    known.add(rel);
  }
  const files: ProjectViewFile[] = [];
  for (const g of glbs) {
    const context: ViewContext = { owner: ownerOf(g.def) };
    if (g.def.children?.length) context.components = componentsOf(g.def, defs);
    const named = manifestNames(root, bundle, g.def, g);
    if (named.features.length) context.features = named.features;
    if (named.bodies.length) context.bodies = named.bodies;
    const n = rows.length ? (drawn.get(g.rel) ?? 0) : (placements.get(g.def.id) ?? 0);
    try {
      const r: ViewSidecarResult = await writeViewSidecar(g.abs, { context, force: options.force });
      files.push({ file: g.rel, definition: g.def.id, placements: n, cached: r.cached, before: r.index.counts.before, after: r.index.counts.after, coarseTriangles: r.index.tiers.coarse.triangles });
      if (!r.cached) options.log?.(`view: ${g.rel}: draws ${fmt(r.index.counts.before.draws)} → ${fmt(r.index.counts.after.draws)}, triangles ${fmt(r.index.counts.before.triangles)} → ${fmt(r.index.counts.after.triangles)} (coarse ${fmt(r.index.tiers.coarse.triangles)}), nodes ${fmt(r.index.counts.before.nodes)} → ${fmt(r.index.counts.after.nodes)}`);
    } catch (e) {
      const error = (e as Error).message.split("\n")[0];
      files.push({ file: g.rel, definition: g.def.id, placements: n, cached: false, error });
      options.log?.(`view: ${g.rel}: no view sidecar (${error}); the viewer draws ${g.rel} itself`);
    }
  }
  const ok = files.filter((f) => !f.error);
  const sum = (pick: (f: ProjectViewFile) => number) => ok.reduce((s, f) => s + pick(f) * f.placements, 0);
  const totals = {
    before: { draws: sum((f) => f.before!.draws), triangles: sum((f) => f.before!.triangles), nodes: sum((f) => f.before!.nodes) },
    after: { draws: sum((f) => f.after!.draws), triangles: sum((f) => f.after!.triangles), nodes: sum((f) => f.after!.nodes) },
    coarseTriangles: sum((f) => f.coarseTriangles ?? 0),
  };
  const written = ok.filter((f) => !f.cached).length;
  const cached = ok.length - written;
  const failed = files.length - ok.length;
  const line = `view sidecars: ${files.length} body GLB(s) (${written} written, ${cached} up to date${failed ? `, ${failed} failed` : ""}); one frame, every placement: draws ${fmt(totals.before.draws)} → ${fmt(totals.after.draws)}, triangles ${fmt(totals.before.triangles)} → ${fmt(totals.after.triangles)} (coarse ${fmt(totals.coarseTriangles)}), nodes ${fmt(totals.before.nodes)} → ${fmt(totals.after.nodes)}`;
  // the summary is returned (`line`), not logged: the build prints it once in its own output
  return { files, written, cached, failed, totals, line };
}

/**
 * What the Inspector's page may load for a selection (PB-940), named by
 * files on disk; the view turns them into webview URLs (inspectorView.ts).
 * Only pictures are handed out: an artifact that is an image, a model's
 * exported preview where the project has one (`docs/images/part-<id>.png`,
 * written with the project's documents), else the model itself only when it
 * is small enough to draw as a thumbnail. A large model is never loaded for
 * the Inspector: its card shows an icon and opens the CAD viewer.
 * No VS Code API here.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { InspectorArtifact, InspectorDetails, InspectorPreview } from "@protoboardai/views/inspector-model";
import { buildArtifactFile } from "./artifacts.js";
import type { ProjectIndex } from "./model.js";

/** A model larger than this is not loaded for a thumbnail. */
export const MODEL_THUMB_MAX = 2 * 1024 * 1024;
/** An evidence file larger than this is not read for the Inspector. */
const EVIDENCE_MAX = 512 * 1024;
/** How many definitions one selection may bring files for (a module, the parts below it). */
const MAX_DEFS = 80;

const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);
const MODEL = new Set(["glb", "gltf", "step", "stp"]);

const ext = (file: string) => extname(file).slice(1).toLowerCase();

export interface FileSystem {
  exists(file: string): boolean;
  size(file: string): number | undefined;
  read(file: string): string;
}

export const DISK: FileSystem = {
  exists: existsSync,
  size: (f) => {
    try {
      return statSync(f).size;
    } catch {
      return undefined;
    }
  },
  read: (f) => readFileSync(f, "utf8"),
};

/** The key of a definition's artifact file in `InspectorDetails.files`. */
export const fileKey = (defId: string, filePath: string) => `${defId}\n${filePath}`;
/** The key of an artifact's picture in `InspectorDetails.previews`. */
export const previewKey = (defId: string, artifactId: string) => `${defId}#${artifactId}`;

/** A part's picture exported with the project's documents, when it is there. */
export function exportedPreview(root: string, defId: string, fs: FileSystem = DISK): string | undefined {
  // the id is a file name here: nothing that leaves docs/images
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(defId)) return undefined;
  const file = join(root, "docs", "images", `part-${defId}.png`);
  return fs.exists(file) ? file : undefined;
}

/** A model small enough to draw as a thumbnail, or undefined. */
export function smallModel(file: string | undefined, fs: FileSystem = DISK): string | undefined {
  if (!file || !["glb", "gltf"].includes(ext(file))) return undefined;
  const size = fs.size(file);
  return size !== undefined && size <= MODEL_THUMB_MAX ? file : undefined;
}

/**
 * The definition and the definitions of the parts below it (the viewer shows
 * an assembly's parts' artifacts when it has none of its own), nearest first.
 */
export function definitionsBelow(index: ProjectIndex, defId: string, depth = 3, max = MAX_DEFS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let level = [defId];
  for (let d = 0; d <= depth && level.length && out.length < max; d++) {
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id) || out.length >= max) continue;
      seen.add(id);
      out.push(id);
      for (const c of index.bundleDefs.get(id)?.children ?? []) next.push(c.moduleDefId);
    }
    level = next;
  }
  return out;
}

/** The pictures of the definitions' artifacts, and the web addresses they name. */
export function artifactFiles(root: string, index: ProjectIndex, defIds: string[], fs: FileSystem = DISK): Pick<InspectorDetails, "files" | "previews" | "links"> {
  const files: Record<string, string> = {};
  const previews: Record<string, InspectorPreview> = {};
  const links = new Set<string>();
  for (const defId of defIds) {
    const arts = index.artifacts.get(defId) ?? [];
    const local = arts.flatMap((a) => {
      const file = a.present === true && a.resolved ? buildArtifactFile(root, a.resolved, fs.exists) : undefined;
      return file ? [{ a, file }] : [];
    });
    const glbByStem = new Map(local.filter((x) => ext(x.file) === "glb").map((x) => [basename(x.file, extname(x.file)), x.file]));
    const exported = exportedPreview(root, defId, fs);
    for (const a of arts) if (a.url && /^https?:\/\//i.test(a.url)) links.add(a.url);
    for (const { a, file } of local) {
      const e = ext(file);
      if (IMAGE.has(e) && a.filePath) files[fileKey(defId, a.filePath)] = file;
      // a model: the part's exported picture for its body, else the model drawn small. The marker of a single interface
      // is not the part, so never its picture: its own small model, drawn when its card comes into view like any other
      else if (MODEL.has(e)) {
        const model = smallModel(e === "glb" || e === "gltf" ? file : glbByStem.get(basename(file, extname(file))), fs);
        if (exported && a.role !== "interface") previews[previewKey(defId, a.id)] = { kind: "image", src: exported };
        else if (model) previews[previewKey(defId, a.id)] = { kind: "model", src: model };
      }
    }
  }
  return { files, previews, links: [...links] };
}

/** An interface's own artifacts (the geometry of its mating face) as cards; a small model is drawn as its picture. */
export function interfaceArtifacts(root: string, index: ProjectIndex, defId: string, interfaceId: string, fs: FileSystem = DISK): InspectorArtifact[] {
  const declared = (index.bundleDefs.get(defId) as { artifacts?: { id: string; name?: string; interfaceId?: string; role?: string }[] } | undefined)?.artifacts ?? [];
  const out: InspectorArtifact[] = [];
  for (const d of declared) {
    if (d.interfaceId !== interfaceId) continue;
    const a = (index.artifacts.get(defId) ?? []).find((x) => x.id === d.id);
    const file = a?.present === true && a.resolved ? buildArtifactFile(root, a.resolved, fs.exists) : undefined;
    if (!a || !file) continue;
    const model = smallModel(file, fs);
    out.push({ defId, artifactId: a.id, title: d.name ?? basename(file), kindLabel: "Interface geometry", format: ext(file).toUpperCase(), source: basename(file), icon: "scan", ...(model ? { preview: { kind: "model", src: model } } : {}) });
  }
  return out;
}

interface Origins {
  definitions?: Record<string, { artifactBase?: { kind?: string; dir?: string; package?: string }; evidence?: { kind?: string; path?: string }[] }>;
}

/** A file below `root` (never outside it), or undefined. */
function inside(root: string, ...parts: string[]): string | undefined {
  const base = resolve(root);
  const file = resolve(base, ...parts);
  return file === base || file.startsWith(base + sep) ? file : undefined;
}

function readJson(file: string | undefined, fs: FileSystem): unknown {
  if (!file || !fs.exists(file)) return undefined;
  const size = fs.size(file);
  if (size === undefined || size > EVIDENCE_MAX) return undefined;
  try {
    return JSON.parse(fs.read(file));
  } catch {
    return undefined;
  }
}

/**
 * A part's evidence files: a researched part's are in `parts/evidence/<id>/`,
 * a catalog part's where `parts/origins.json` says its revision carries them
 * (below the part's own folder or package, never outside it).
 */
export function evidenceFiles(root: string, defIds: string[], fs: FileSystem = DISK): Pick<InspectorDetails, "evidence" | "links"> {
  const origins = (readJson(join(root, "parts", "origins.json"), fs) ?? {}) as Origins;
  const evidence: NonNullable<InspectorDetails["evidence"]> = {};
  const links = new Set<string>();
  for (const id of defIds) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) continue;
    const o = origins.definitions?.[id];
    // the files a catalog revision carries are below its artifact base: a folder of the project, or the package the part
    // came in, found as Node finds it from the project (it may be hoisted above it; the page's roots allow that package)
    const carried = (kind: string) => {
      const path = o?.evidence?.find((e) => e.kind === kind)?.path;
      const base = o?.artifactBase;
      if (!path || !base) return undefined;
      if (base.kind === "package") {
        const manifest = base.package && /^(?:@[^/\\.][^/\\]*\/)?[^/\\.][^/\\]*$/.test(base.package) ? buildArtifactFile(root, `package:${base.package}/package.json`, fs.exists) : undefined;
        return manifest ? inside(dirname(manifest), path) : undefined;
      }
      const dir = base.dir ? inside(root, base.dir) : undefined;
      return dir ? inside(dir, path) : undefined;
    };
    const sources = readJson(carried("sources") ?? join(root, "parts", "evidence", id, "sources.json"), fs);
    const verification = readJson(carried("verification") ?? join(root, "parts", "evidence", id, "verification.json"), fs);
    const rows = Array.isArray(sources) ? sources.filter((s) => s && typeof s === "object" && typeof (s as { url?: unknown }).url === "string" && typeof (s as { title?: unknown }).title === "string") : undefined;
    if (!rows?.length && !(verification && typeof verification === "object")) continue;
    evidence[id] = { ...(rows?.length ? { sources: rows } : {}), ...(verification && typeof verification === "object" ? { verification } : {}) };
    for (const s of rows ?? []) if (/^https?:\/\//i.test((s as { url: string }).url)) links.add((s as { url: string }).url);
  }
  return { evidence, links: [...links] };
}

/** Everything the page may load and open for these definitions. */
export function detailFiles(root: string, index: ProjectIndex, defIds: string[], fs: FileSystem = DISK): Omit<InspectorDetails, "target"> {
  const a = artifactFiles(root, index, defIds, fs);
  const e = evidenceFiles(root, defIds, fs);
  return { files: a.files, previews: a.previews, ...(Object.keys(e.evidence ?? {}).length ? { evidence: e.evidence } : {}), links: [...new Set([...(a.links ?? []), ...(e.links ?? [])])] };
}

/**
 * The folders the page may load from: the projects themselves, the packages
 * their artifacts are in (`package:<name>/…`, as Node finds them from the
 * project) and the library's download cache. Nothing wider: not the
 * workspace, not a whole `node_modules`.
 */
export function resourceRoots(projects: { root: string; index?: ProjectIndex }[], cacheDir: string, exists: (p: string) => boolean = existsSync): string[] {
  const roots = new Set<string>();
  for (const p of projects) {
    roots.add(resolve(p.root));
    const packages = new Set<string>();
    for (const list of p.index?.artifacts.values() ?? [])
      for (const a of list) {
        const m = a.resolved ? /^package:((?:@[^/]+\/)?[^/]+)\//.exec(a.resolved) : null;
        if (m) packages.add(m[1]);
      }
    for (const name of packages) {
      const probe = buildArtifactFile(p.root, `package:${name}/package.json`, exists);
      if (probe) roots.add(resolve(probe, ".."));
    }
  }
  roots.add(resolve(cacheDir));
  return [...roots].sort();
}

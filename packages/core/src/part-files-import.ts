/**
 * The import provider's core half (PB-1143, PB-1174): record an existing
 * CAD file (STEP, STL, 3MF) as a module's body, and map a
 * whole-board ECAD STEP's component nodes onto the board's UHD instances.
 *
 *   protoboard parts import <file> --part <id> [--board] [--replace]
 *
 * The file stays where the project keeps it (a path inside the project);
 * parts/sources.json records it with provenance `imported`, its sha256,
 * size and units. The module is bound to @protoboardai/ext-parts' `cad`
 * capability with `constraints.import` (no hand-written script), so
 * `protoboard run cad:export --module <id>` writes out/body.step,
 * out/body.glb and out/body.manifest.json from it (ext-parts
 * lib/import-cad.ts). For a board, the STEP's product structure is read here
 * (text, streamed, size-capped; nothing in it is executed) and each component
 * node is matched to an instance by designator, then by LCSC C-number.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { lcscNumberOf, readProjectOffers } from "./part-offers.js";
import { isoToday, readPartSources, recordSourceEntry, sha256OfFile, writePartSources, type BoardStepMap, type SourceEntry } from "./part-files.js";
import { isInsideReal, projectRelative, recordedPath } from "./paths.js";
import { placementPart } from "./placement.js";
import type { Project } from "./project.js";

/** Formats the import provider takes, with the size cap for each (bytes; PROTOBOARD_MAX_IMPORT_BYTES overrides). */
export const IMPORT_FORMATS: Record<string, { format: string; cap: number; units: string }> = {
  ".step": { format: "step", cap: 1024 ** 3, units: "mm" },
  ".stp": { format: "step", cap: 1024 ** 3, units: "mm" },
  ".stl": { format: "stl", cap: 512 * 1024 ** 2, units: "mm" },
  ".3mf": { format: "3mf", cap: 512 * 1024 ** 2, units: "mm" },
};

const capFor = (ext: string) => Number(process.env.PROTOBOARD_MAX_IMPORT_BYTES) || IMPORT_FORMATS[ext]?.cap || 0;

/** A file the import reads: inside the project (links followed), a known format, under its size cap. */
export function importableFile(root: string, given: string): { abs: string; rel: string; format: string; units: string; size: number } {
  const abs = isAbsolute(given) ? given : resolvePath(root, recordedPath(given));
  if (!isInsideReal(root, abs)) throw new Error(`${given} is outside the project; keep the file inside the project (e.g. cad/) and import it from there`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`no file ${given}`);
  const ext = extname(abs).toLowerCase();
  const kind = IMPORT_FORMATS[ext];
  if (!kind) throw new Error(`${given}: import takes ${Object.keys(IMPORT_FORMATS).join(", ")} files`);
  const size = statSync(abs).size;
  if (size > capFor(ext)) throw new Error(`${given} is ${size} bytes, over the ${capFor(ext)}-byte import limit for ${ext} (PROTOBOARD_MAX_IMPORT_BYTES raises it)`);
  return { abs, rel: projectRelative(root, abs), format: kind.format, units: kind.units, size };
}

// ---------------------------------------------------------------------------
// STEP product structure
// ---------------------------------------------------------------------------

/** The names in a STEP's product structure: PRODUCT names and assembly occurrence names, in file order. Streamed; never evaluated. */
export function stepProductNames(file: string, cap = capFor(".step")): { products: string[]; occurrences: string[] } {
  const size = statSync(file).size;
  if (size > cap) throw new Error(`${file} is ${size} bytes, over the ${cap}-byte limit`);
  const products: string[] = [];
  const occurrences: string[] = [];
  const fd = openSync(file, "r");
  const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
  let carry = "";
  // a statement: `#12 = PRODUCT('name','name','',(#8));` (it may run over several lines)
  const product = /#\d+\s*=\s*PRODUCT\s*\(\s*'((?:[^']|'')*)'/g;
  const nauo = /#\d+\s*=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*'(?:[^']|'')*'\s*,\s*'((?:[^']|'')*)'/g;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      const text = carry + (n ? buf.toString("latin1", 0, n) : "");
      const end = n ? text.lastIndexOf(";") + 1 : text.length;
      const chunk = text.slice(0, end);
      carry = text.slice(end);
      for (const m of chunk.matchAll(product)) products.push(m[1].replace(/''/g, "'").replace(/\s*\r?\n\s*/g, ""));
      for (const m of chunk.matchAll(nauo)) occurrences.push(m[1].replace(/''/g, "'").replace(/\s*\r?\n\s*/g, ""));
      if (!n) break;
      if (carry.length > 1024 * 1024) carry = carry.slice(-1024 * 1024); // a malformed file with no `;`: keep memory bounded
    }
  } finally {
    closeSync(fd);
  }
  return { products, occurrences };
}

/**
 * A component node's designator: EasyEDA names a component product
 * `<designator>~<footprint>~<footprint>~<board tag>`; KiCad and others name
 * the occurrence by its reference (`R12`). Layer and board products
 * (`TopCopper~BqNV`) and the shapes components share (`R0603~R0603~BqNV`)
 * have no designator.
 */
export function nodeDesignator(name: string): string | undefined {
  const parts = name.split("~").map((x) => x.trim());
  // a component: designator, footprint, model, board tag
  if (parts.length >= 4) return parts[0] || undefined;
  // a model put in by hand (`FH1~XF-154 (Littelfuse 0154 model)`), or an occurrence named by its reference (`R12`):
  // a designator has a letter, a digit and no space; the shapes components share (footprint~model~tag), the
  // layers and numbered occurrences (`2079`) have none
  const d = parts.length <= 2 ? parts[0] : undefined;
  return d && /\d/.test(d) && /[A-Za-z]/.test(d) && /^[A-Za-z0-9_.+-]{1,32}$/.test(d) ? d : undefined;
}

/** A designator compared without case or punctuation: `ESP32-S3`, `esp32_s3` and `ESP32S3` are one. */
export const designatorKey = (d: string) => d.toUpperCase().replace(/[^A-Z0-9]/g, "");

const LCSC_IN_NAME = /(?:^|[^A-Za-z0-9])(C[1-9]\d{2,8})(?![0-9])/;

/** The board's component instances: leaf parts below it, with their designators (the child id, else the name's first word) and LCSC numbers. */
export function boardComponents(p: Project, boardPath: string): { path: string; rel: string; part: string; designators: string[]; nameWords?: string[]; lcsc?: string }[] {
  const below = p.instances.filter((i) => i.path.startsWith(`${boardPath}/`));
  const parents = new Set(below.map((i) => i.parent));
  const offers = (() => {
    try {
      return readProjectOffers(p.root, { catalog: p.config.catalog });
    } catch {
      return undefined;
    }
  })();
  return below
    .filter((i) => !parents.has(i.path))
    .map((i) => {
      const id = i.path.split("/").pop()!;
      const first = i.name?.trim().split(/\s+/)[0];
      const def = p.lookup(i.definition);
      const lcsc = offers && def ? lcscNumberOf(offers, i.definition, placementPart(def, i.overrides).mpn) : undefined;
      // a designator that is not a valid id is spelled with `_` (ESP32-S3 → esp32_s3) or prefixed (12V_DCJ → n12v_dcj)
      const ids = [id, first, /^n\d/.test(id) ? id.slice(1) : undefined];
      const words = (i.name ?? "").split(/[\s,;:()]+/).filter((w) => /\d/.test(w)).map(designatorKey);
      return { path: i.path, rel: i.path.slice(boardPath.length + 1), part: i.definition, designators: [...new Set(ids.filter((x): x is string => !!x).map(designatorKey))], ...(words.length ? { nameWords: [...new Set(words)] } : {}), ...(lcsc ? { lcsc } : {}) };
    });
}

/**
 * Match a board STEP's component nodes to the board's instances: by
 * designator first (unique on both sides), then by an LCSC C-number in the
 * node name against each remaining instance's offers (unique only).
 */
export function mapBoardStep(names: string[], components: ReturnType<typeof boardComponents>, step: string): BoardStepMap {
  const nodes = [...new Set(names)].filter((n) => nodeDesignator(n) || LCSC_IN_NAME.test(n));
  const out: BoardStepMap = { step, components: {}, unmatchedNodes: [], unmatchedInstances: [] };
  const taken = new Set<string>();
  // pass 1: the instance's own designator (its id, its name's first word); pass 2: a word of its name
  // with a digit (`LED 12V rail indicator` is the node `12V~LED0603…`); unique on both sides each time
  const pass = (nodesLeft: string[], keysOf: (c: (typeof components)[number]) => string[] | undefined): string[] => {
    const byKey = new Map<string, typeof components>();
    for (const c of components) if (!taken.has(c.path)) for (const k of keysOf(c) ?? []) byKey.set(k, [...(byKey.get(k) ?? []), c]);
    // the nodes of one designator: a component product and its occurrence (`R1~R0603~…` and `R1`) are one
    // component, so the most descriptive name stands for it; two products with one designator are ambiguous
    const byNode = new Map<string, string[]>();
    for (const n of nodesLeft) {
      const raw = nodeDesignator(n);
      if (raw) byNode.set(designatorKey(raw), [...(byNode.get(designatorKey(raw)) ?? []), n]);
    }
    const left: string[] = [];
    const done = new Set<string>();
    for (const n of nodesLeft) {
      const raw = nodeDesignator(n);
      const d = raw ? designatorKey(raw) : undefined;
      if (d && done.has(d)) continue;
      const group = d ? byNode.get(d)! : [n];
      const products = group.filter((x) => x.includes("~"));
      const node = products.length === 1 ? products[0] : group.length === 1 ? group[0] : undefined;
      const hits = d && node ? (byKey.get(d) ?? []).filter((c) => !taken.has(c.path)) : [];
      if (hits.length === 1) {
        out.components[hits[0].rel] = { node: node!, by: "designator", ...(hits[0].lcsc ? { lcsc: hits[0].lcsc } : {}) };
        taken.add(hits[0].path);
        done.add(d!);
      } else left.push(n);
    }
    return left;
  };
  let left = pass(nodes, (c) => c.designators);
  left = pass(left, (c) => c.nameWords);
  for (const n of left) {
    const c = LCSC_IN_NAME.exec(n)?.[1];
    const hits = c ? components.filter((x) => !taken.has(x.path) && x.lcsc === c) : [];
    if (hits.length === 1) {
      out.components[hits[0].rel] = { node: n, by: "lcsc", lcsc: c! };
      taken.add(hits[0].path);
    } else out.unmatchedNodes.push(n);
  }
  out.unmatchedInstances = components.filter((c) => !taken.has(c.path)).map((c) => c.rel);
  return out;
}

// ---------------------------------------------------------------------------
// Recording an import
// ---------------------------------------------------------------------------

export interface ImportResult {
  part: string;
  entry: SourceEntry;
  /** The cad.config.ts written (absent when one was kept). */
  config?: string;
  /** A config that already binds the module and was kept (pass replace to rebind it). */
  keptConfig?: string;
  board?: BoardStepMap & { instance: string };
  sources: string;
}

/** The folder a local definition lives in (its source file's folder, project-relative). */
export function definitionDir(p: Project, part: string): string {
  const rec = p.definitions.get(part);
  if (!rec) throw new Error(`no definition "${part}" in the project`);
  if (rec.origin.kind !== "local") throw new Error(`${part} is a library part: its body comes with its revision; import bodies for the project's own modules and parts`);
  const file = rec.origin.source.file;
  const dir = dirname(file);
  // parts/local/<id>.uhd.ts keeps its files in parts/local/<id>/
  return dir === "parts/local" ? `parts/local/${part}` : dir;
}

/**
 * Record an existing CAD file as a module's body: an `imported` entry in
 * parts/sources.json, and the module bound to ext-parts' cad capability
 * with `constraints.import`. With `board`, also map the STEP's component
 * nodes onto the board's instances. Writes nothing else; the caller runs
 * cad:generate and cad:export.
 */
export function importPartFile(p: Project, given: string, part: string, options: { board?: boolean; replace?: boolean; who?: string } = {}): ImportResult {
  const f = importableFile(p.root, given);
  const dir = definitionDir(p, part);
  const sha256 = sha256OfFile(f.abs);
  const entry: SourceEntry = {
    id: `imported-${sha256.slice(7, 15)}`,
    kind: "model",
    format: f.format,
    sha256,
    size: f.size,
    units: f.units,
    source: { type: "imported", retrieved: isoToday() },
    path: f.rel,
    tier: p.definitions.get(part)!.origin.tier === "project-specific" ? "design" : "M4",
    chosenBy: { kind: options.who ? "agent" : "person", ...(options.who ? { who: options.who } : {}), at: new Date().toISOString() },
  };
  const data = readPartSources(p.root);
  // one imported body per part: a re-import replaces the earlier record
  if (data.parts[part]) data.parts[part].files = data.parts[part].files.filter((e) => e.source.type !== "imported" || e.id === entry.id);
  recordSourceEntry(data, part, entry);
  let board: ImportResult["board"];
  const def = p.lookup(part)!;
  if (options.board || (f.format === "step" && (def.kind === "board" || !!def.children?.length))) {
    if (f.format !== "step") throw new Error(`--board maps a STEP's component nodes; ${given} is ${f.format}`);
    const inst = p.instances.find((i) => i.definition === part);
    if (!inst) throw new Error(`${part} is not used in the system, so there are no instances to map the board's nodes to`);
    const names = stepProductNames(f.abs);
    const map = mapBoardStep([...names.products, ...names.occurrences], boardComponents(p, inst.path), entry.id);
    data.parts[part].board = map;
    board = { ...map, instance: inst.path };
  }
  const sources = writePartSources(p.root, data);

  const configFile = join(p.root, dir, "cad.config.ts");
  const binding = p.capabilities.find((b) => b.capability === "cad" && b.module === part);
  let config: string | undefined;
  let keptConfig: string | undefined;
  if (existsSync(configFile) && !options.replace) keptConfig = projectRelative(p.root, configFile);
  else if (binding && binding.config !== projectRelative(p.root, configFile) && !options.replace) keptConfig = binding.config;
  else {
    const rel = projectRelative(join(p.root, dir), f.abs);
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(
      configFile,
      [
        `// ${part}'s body is an existing CAD file, imported (\`protoboard parts import\`; PB-1143): no script.`,
        `// The source and its sha256 are recorded in parts/sources.json; cad:export writes out/body.step, body.glb and body.manifest.json from it.`,
        `import { defineCapabilityConfig } from "@protoboardai/core";`,
        ``,
        `export default defineCapabilityConfig({`,
        `  provider: "@protoboardai/ext-parts",`,
        `  module: ${JSON.stringify(part)},`,
        `  constraints: { import: ${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)}, sha256: ${JSON.stringify(sha256)}, units: ${JSON.stringify(f.units)} },`,
        `});`,
        ``,
      ].join("\n"),
    );
    config = projectRelative(p.root, configFile);
  }
  return { part, entry, ...(config ? { config } : {}), ...(keptConfig ? { keptConfig } : {}), ...(board ? { board } : {}), sources: projectRelative(p.root, sources) };
}

/**
 * The provider directory `src/boards/<module>/tscircuit/`:
 *
 *   board.gen.tsx     generated source, rewritten by every generate
 *   board.tsx         entry, written once, never overwritten (hand edits)
 *   layout.json       positions for parts the config does not fix (hand-owned)
 *   footprints.json   land-pattern overrides (hand-owned, optional)
 *   circuit.json      the built board (circuit JSON), with the source digest in build.json
 *   build.json        name map (tscircuit names ↔ UHD), digests (source, netlist,
 *                     generate inputs), versions, routing totals
 *   models/           box bodies for parts without a body artifact, and part bodies
 *                     without their interface feature shapes
 *   export.json       what the last export read (built board, UHD module, constraints,
 *                     body files, provider code, converter versions): fingerprint.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { CapabilityContext } from "@protoboardai/core";
import type { Placement } from "./config.ts";
import { entryProblems, type FootprintOverrides } from "./footprints.ts";
import { applyPaste } from "./paste.ts";
import { addSilkscreen } from "./silk.ts";
import { buildCircuit, coreVersion, type CircuitElement } from "./runtime.ts";
import type { NameMap } from "./source.ts";

export const BUILD_SCHEMA = "protoboard.tscircuit-build/v0";

export interface BuildRecord {
  schema: typeof BUILD_SCHEMA;
  map: NameMap;
  /** Digest of the native source: the folder's .tsx/.ts/.jsx/.js files and every file the build read (sourceFiles). */
  sourceDigest: string;
  /**
   * Project-relative paths of the files the build read besides the folder's own sources: JSON a hand
   * file imports, a hand file shared from another board's folder. Absent in builds before 0.1.7.
   */
  sourceFiles?: string[];
  /** Digest of the board netlist generate started from (detects a changed UHD module). */
  netlistDigest: string;
  /** Digest of what else generate bakes into board.gen.tsx: layout.json, footprints.json and the config's constraints. */
  inputsDigest: string;
  tscircuit: { core: string };
  build_ms: number;
  /** The router's own progress notes, last lines only. */
  log: string[];
}

export const files = (native: string) => ({
  gen: `${native}/board.gen.tsx`,
  entry: `${native}/board.tsx`,
  layout: `${native}/layout.json`,
  footprints: `${native}/footprints.json`,
  circuit: `${native}/circuit.json`,
  build: `${native}/build.json`,
});

export const digestOf = (s: string | Buffer) => "sha256:" + createHash("sha256").update(s).digest("hex");

/**
 * Digest of the native source: every .tsx/.ts/.jsx/.js file in the native folder, and each of
 * `loaded` (project-relative paths the last build read: JSON a hand file imports, a hand file in
 * another folder). A file that is gone digests as missing, so deleting one is a change too.
 */
export function sourceDigest(root: string, native: string, loaded: string[] = []): string {
  const dir = join(root, native);
  const own = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f)).map((f) => `${native}/${f}`) : [];
  // when the build read nothing else, the digest is the one builds before 0.1.7 recorded (folder sources by file name)
  if (!loaded.length) return digestOf(own.sort().map((f) => `${f.slice(native.length + 1)}\n${readFileSync(join(root, f), "utf8")}`).join("\n\0"));
  const names = [...new Set([...own, ...loaded])].sort();
  return digestOf(names.map((f) => `${f}\n${existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : "\0missing"}`).join("\n\0"));
}

/** The files a build read, project-relative with forward slashes, less the native folder's own sources (always digested). */
export function loadedFiles(root: string, native: string, files: string[]): string[] {
  const rel = files.map((f) => relative(root, f).split(sep).join("/"));
  return rel.filter((f) => !(dirname(f) === native && /\.(tsx|ts|jsx|js)$/.test(f))).sort();
}

/**
 * Digest of generate's other inputs: layout.json, footprints.json and the
 * circuit.config.ts constraints. Generate writes them into board.gen.tsx, so
 * after a change only generate (not a rebuild) brings the board up to date.
 */
export function inputsDigest(root: string, native: string, constraints: Record<string, unknown>, suppliers: Record<string, unknown> = {}): string {
  const f = files(native);
  const text = (path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);
  // supplier part numbers (from the project's offers) are baked in too; a board with none digests as before 0.1.7
  return digestOf(JSON.stringify({ constraints, layout: text(f.layout), footprints: text(f.footprints), ...(Object.keys(suppliers).length ? { suppliers } : {}) }));
}

const readJson = <T>(root: string, path: string): T | undefined => (existsSync(join(root, path)) ? (JSON.parse(readFileSync(join(root, path), "utf8")) as T) : undefined);

/** `layout.json`: { <instance>: { at, rotation_deg?, side? } }; keys starting with `$` are comments. */
export function readLayout(root: string, native: string): { layout: Record<string, Placement>; problems: string[] } {
  const raw = readJson<Record<string, unknown>>(root, files(native).layout) ?? {};
  const layout: Record<string, Placement> = {};
  const problems: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("$")) continue;
    const p = v as { at?: unknown; rotation_deg?: unknown; side?: unknown };
    const ok = Array.isArray(p?.at) && p.at.length === 2 && p.at.every((n) => typeof n === "number") && (p.rotation_deg === undefined || typeof p.rotation_deg === "number") && (p.side === undefined || p.side === "top" || p.side === "bottom");
    if (!ok) problems.push(`layout.json: ${k} needs at: [x, y] (mm), optional rotation_deg and side (top|bottom)`);
    else layout[k] = { at: p.at as [number, number], rotation_deg: (p.rotation_deg as number | undefined) ?? 0, side: (p.side as "top" | "bottom" | undefined) ?? "top" };
  }
  return { layout, problems };
}

/** `footprints.json`: project overrides of the land-pattern table. */
export function readOverrides(root: string, native: string): { overrides: FootprintOverrides; problems: string[] } {
  const raw = readJson<FootprintOverrides>(root, files(native).footprints) ?? {};
  const problems: string[] = [];
  for (const e of raw.packages ?? []) for (const p of entryProblems(e)) problems.push(`footprints.json packages ${e?.id ?? "?"}: ${p}`);
  for (const [k, e] of Object.entries(raw.instances ?? {})) for (const p of entryProblems(e)) problems.push(`footprints.json instances.${k}: ${p}`);
  return { overrides: { packages: raw.packages ?? [], instances: raw.instances ?? {} }, problems };
}

export interface Native {
  circuitJson: CircuitElement[];
  build: BuildRecord;
}

/** The last build, if there is one. */
export function readNative(root: string, native: string): Native | undefined {
  const f = files(native);
  const build = readJson<BuildRecord>(root, f.build);
  const circuitJson = readJson<CircuitElement[]>(root, f.circuit);
  return build && circuitJson ? { build, circuitJson } : undefined;
}

/** Build the native source and record it (circuit.json + build.json). */
export async function buildAndRecord(ctx: CapabilityContext, map: NameMap, netlistDigest: string, generateInputs: string, designators: Record<string, string> = {}): Promise<Native> {
  const root = ctx.project.root;
  const f = files(ctx.module.native);
  const result = await buildCircuit(join(root, f.entry));
  // the stencil from the land patterns, not tscircuit's 70 % default (paste.ts)
  const paste = applyPaste(result.circuitJson, map);
  // references (designators) and pin-1 marks for authored land patterns (tscircuit draws silkscreen only for its own strings)
  const silk = addSilkscreen(paste.circuitJson, map, designators);
  // the straight joins between a multi-pad pin's pads, after routing (source.ts padJoins)
  result.circuitJson = joinPads(silk.circuitJson, map);
  for (const p of paste.problems) ctx.log(`warning: ${p}`);
  if (silk.omitted.length) ctx.log(`silkscreen: no room for the reference of ${silk.omitted.join(", ")}`);
  const sourceFiles = loadedFiles(root, ctx.module.native, result.files);
  const build: BuildRecord = {
    schema: BUILD_SCHEMA,
    map,
    sourceDigest: sourceDigest(root, ctx.module.native, sourceFiles),
    ...(sourceFiles.length ? { sourceFiles } : {}),
    netlistDigest,
    inputsDigest: generateInputs,
    tscircuit: { core: coreVersion() },
    build_ms: result.ms,
    log: result.log.slice(-20),
  };
  ctx.writeOutput(f.circuit, JSON.stringify(result.circuitJson) + "\n", "built board (tscircuit circuit JSON)");
  ctx.writeOutput(f.build, JSON.stringify(build, null, 2) + "\n", "build record: name map, digests, versions");
  return { circuitJson: result.circuitJson, build };
}

/** Errors tscircuit wrote into the circuit JSON while building (placement, routing, connectivity). */
export const buildErrors = (cj: CircuitElement[]): { type: string; message: string }[] => cj.filter((e) => /_error$/.test(e.type)).map((e) => ({ type: e.type, message: String(e.message ?? "") }));

/**
 * Lay the straight joins generate planned between the pads of a pin with several (NameMap padJoins):
 * a pcb_trace from pad centre to pad centre on the pads' layer, tied to both ports. Added after
 * routing, so the router never saw them; generate keeps them clear of the component's other pads.
 */
export function joinPads(cj: CircuitElement[], map: NameMap): CircuitElement[] {
  const sources = new Map(cj.filter((e) => e.type === "source_component").map((s) => [s.source_component_id, s.name as string]));
  const sourcePorts = new Map(cj.filter((e) => e.type === "source_port").map((p) => [p.source_port_id, p]));
  const pads = new Map(cj.filter((e) => e.type === "pcb_smtpad" && e.pcb_port_id).map((p) => [p.pcb_port_id, p]));
  const portOf = new Map<string, CircuitElement>(); // "<component name>/<port name>" → pcb_port
  for (const p of cj.filter((e) => e.type === "pcb_port")) {
    const sp = sourcePorts.get(p.source_port_id);
    const comp = sp && sources.get(sp.source_component_id);
    if (comp) portOf.set(`${comp}/${sp.name}`, p);
  }
  const added: CircuitElement[] = [];
  for (const [name, c] of Object.entries(map.components)) {
    for (const j of c.padJoins ?? []) {
      // a labelled pin's port is named by its label; its pads still carry the hint pinN
      const find = (port: string) => portOf.get(`${name}/${port}`) ?? [...portOf].find(([k, p]) => k.startsWith(`${name}/`) && sourcePorts.get(p.source_port_id)?.port_hints?.[0] === port)?.[1] ?? [...portOf].find(([k, p]) => k.startsWith(`${name}/`) && !/_internal_/.test(k) && sourcePorts.get(p.source_port_id)?.port_hints?.includes(port))?.[1];
      const [a, b] = [find(j.a), find(j.b)];
      const [pa, pb] = [a && pads.get(a.pcb_port_id), b && pads.get(b.pcb_port_id)];
      if (!a || !b || !pa || !pb) continue;
      added.push({
        type: "pcb_trace",
        pcb_trace_id: `pcb_trace_pad_join_${added.length}`,
        pcb_component_id: pa.pcb_component_id,
        route: [
          { route_type: "wire", x: pa.x, y: pa.y, width: j.width, layer: pa.layer, start_pcb_port_id: a.pcb_port_id },
          { route_type: "wire", x: pb.x, y: pb.y, width: j.width, layer: pb.layer, end_pcb_port_id: b.pcb_port_id },
        ],
      });
    }
  }
  return added.length ? [...cj, ...added] : cj;
}

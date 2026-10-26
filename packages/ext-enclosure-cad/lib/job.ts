/**
 * UHD project → enclosure job.
 *
 * The job is everything the build123d generator needs and nothing it has to
 * know about UHD:
 *
 *   - what goes inside: every body the assembly places, other than the
 *     enclosure itself and what its outside features hold (a bottle on the
 *     thread, spring bars in the lugs), as a GLB with a matrix into the
 *     enclosure's coordinates. A module designed by a capability provider
 *     contributes its standard output (a board's out/board.glb); any other
 *     module its body artifact.
 *   - the features, from the module's interfaces (lib/features.ts), with the
 *     frame of the part each one serves resolved into the enclosure's
 *     coordinates: from the served module's standard geometry manifest when
 *     it has one (a board's connectors and switches), else from its UHD frame.
 *   - the design values from cad.config.ts.
 *
 * Placement is the assembly the viewer draws and ext-harness-cad routes
 * through (UHD `assemble` with the project's display placements), imported
 * from that package rather than re-implemented.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  applyMat4,
  bodyKey,
  boltPatternHoles,
  frameMatrix,
  multiplyMat4,
  resolveLeafEndpoint,
  type Assembly,
  type GeometryFrame,
  type GeometryManifest,
  type Mat4,
  type ModuleDef,
  type Vec3,
} from "@deltarobotics/uhd";
import { stableStringify, type CadProcess, type CapabilityBinding, type Project } from "@protoboardai/core";
import { projectAssembly } from "@protoboardai/ext-harness-cad/job";
import { EXTERNAL_KINDS, readFeatures, type FeatureSpec } from "./features.ts";
import { glandRow, type ORing } from "./standards.ts";

export const JOB_SCHEMA = "protoboard.enclosure-cad.job/v0";

export interface Design {
  shape: "box" | "round";
  wall: number;
  floor: number;
  lid: number;
  clearance: number;
  clearance_top: number;
  min_wall: number;
  cavity: null | { min: Vec3; max: Vec3 } | { centre: [number, number]; radius: number; z: [number, number] };
  split_z: number | null;
  joint: { style: "rabbet" | "flat" | "twist"; lip_height: number; clearance: number };
  fasteners: "screws" | "none";
  resolution: number;
}

export interface JobContent {
  key: string;
  label: string;
  /** Project-relative GLB. */
  glb: string;
  digest: string;
  /** Body coordinates → enclosure coordinates (row-major 4×4). */
  matrix: Mat4;
  /** GLB nodes that are not the body: a UHD part's interface feature markers (thin solids on the faces its interfaces bind to). */
  skip_nodes?: string[];
}

export interface JobFeature {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  /** The declared frame (module coordinates), when the module states one. */
  frame?: GeometryFrame;
  served?: { key: string; label: string; frame: GeometryFrame; from: "manifest" | "model" };
  /** Content keys mated to this feature (contact there is by design). */
  mates?: string[];
}

export interface Job {
  schema: typeof JOB_SCHEMA;
  module: string;
  name: string;
  /** Project root, relative to the native folder (the generator resolves GLBs against it). */
  root: string;
  process: CadProcess;
  material: string | null;
  inputsDigest: string;
  design: Design;
  contents: JobContent[];
  features: JobFeature[];
}

/** Where the module sits, and how to get from the assembly root into its coordinates. */
export interface Placement {
  path: string;
  matrix: Mat4;
  toLocal: Mat4;
}

// ---------------------------------------------------------------------------
// Rigid transforms
// ---------------------------------------------------------------------------

/** Inverse of a rigid row-major 4×4 (rotation + translation). */
export function invertRigid(m: Mat4): Mat4 {
  const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const t = [m[3], m[7], m[11]];
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const ti = [0, 1, 2].map((i) => -(rt[i * 3] * t[0] + rt[i * 3 + 1] * t[1] + rt[i * 3 + 2] * t[2]));
  return [rt[0], rt[1], rt[2], ti[0], rt[3], rt[4], rt[5], ti[1], rt[6], rt[7], rt[8], ti[2], 0, 0, 0, 1];
}

const rotate = (m: Mat4, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]];
const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

export function transformFrame(m: Mat4, f: GeometryFrame): GeometryFrame {
  return {
    origin: applyMat4(m, f.origin as Vec3).map(r6) as Vec3,
    normal: rotate(m, f.normal as Vec3).map(r6) as Vec3,
    ...(f.xAxis ? { xAxis: rotate(m, f.xAxis as Vec3).map(r6) as Vec3 } : {}),
  };
}

// ---------------------------------------------------------------------------
// Design values
// ---------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Minimum wall by process: two extrusion widths of a 0.4 mm nozzle for
 * printing (assumption: the common FDM nozzle); 0.5 mm for machining
 * (assumption: a typical small-end-mill limit for plastics).
 */
export const MIN_WALL: Record<CadProcess, number> = { print: 0.8, machine: 0.5, cut: 0 };

/** cad.config.ts constraints → design values. */
export function designOf(constraints: Record<string, unknown>, process: CadProcess, features: FeatureSpec[]): { design: Design; problems: string[] } {
  const problems: string[] = [];
  const wall = num(constraints.wall_mm);
  if (wall === undefined || wall <= 0) problems.push("constraint wall_mm (wall thickness) is required and must be positive");
  const clearance = num(constraints.clearance_mm) ?? 0.3;
  const shape = (constraints.shape as string) ?? "box";
  if (shape !== "box" && shape !== "round") problems.push(`shape must be "box" or "round", not ${JSON.stringify(shape)}`);
  const j = (constraints.joint ?? {}) as Record<string, unknown>;
  const style = (j.style as string) ?? "rabbet";
  if (style !== "rabbet" && style !== "flat" && style !== "twist") problems.push(`joint.style must be "rabbet", "flat" or "twist" (with a TwistLid)`);
  const joint = features.find((f) => f.kind === "joint");
  const twist = features.find((f) => f.kind === "twist_lid");
  if (twist && joint) problems.push("a twist lid closes without screws: give the module a TwistLid or a Joint, not both");
  if (twist && shape !== "round") problems.push(`a twist lid needs a round enclosure (shape "round"), not ${JSON.stringify(shape)}`);
  if (twist && j.style !== undefined && j.style !== "twist") problems.push(`joint.style ${JSON.stringify(j.style)}: a twist lid makes the joint a twist joint`);
  const lock = twist?.params.lock;
  if (twist && lock !== "thread" && lock !== "bayonet") problems.push(`${twist.id}: lock must be "thread" or "bayonet", not ${JSON.stringify(lock)}`);
  const fasteners = (constraints.fasteners as string) ?? (joint ? "screws" : "none");
  if (twist && fasteners === "screws") problems.push('a twist lid needs no screws: fasteners must be "none"');
  if (!twist && style === "twist") problems.push('joint.style "twist" needs a TwistLid interface in the module');
  if (fasteners !== "screws" && fasteners !== "none") problems.push(`fasteners must be "screws" or "none" (snap fits are not generated yet), not ${JSON.stringify(fasteners)}`);
  if (fasteners === "screws" && !joint) problems.push('fasteners "screws" needs a joint interface stating its screw and insert (Joint({ … }) in the module)');
  const w = wall ?? 1;
  return {
    problems,
    design: {
      shape: shape as Design["shape"],
      wall: w,
      floor: num(constraints.floor_mm) ?? w,
      lid: num(constraints.lid_mm) ?? w,
      clearance,
      clearance_top: num(constraints.clearance_top_mm) ?? clearance,
      min_wall: num(constraints.min_wall_mm) ?? MIN_WALL[process],
      cavity: (constraints.cavity_mm as Design["cavity"]) ?? null,
      split_z: num(constraints.split_z_mm) ?? null,
      joint: { style: (twist ? "twist" : style) as Design["joint"]["style"], lip_height: num(j.lip_height_mm) ?? 1.5, clearance: num(j.clearance_mm) ?? 0.15 },
      fasteners: fasteners as Design["fasteners"],
      resolution: num(constraints.resolution_mm) ?? 0.25,
    },
  };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export const sha256File = (file: string) => "sha256:" + createHash("sha256").update(readFileSync(file)).digest("hex");
const posix = (s: string) => s.split("\\").join("/");

/** A module's body GLB: its capability provider's standard output, else its body artifact. */
export function bodyGlb(p: Project, def: ModuleDef, body?: string): string | undefined {
  const bound = p.capabilities.find((b) => b.module === def.id && !b.problem);
  if (bound) {
    const f = join(p.root, bound.out, bound.capability === "circuit" ? "board.glb" : "body.glb");
    if (existsSync(f)) return f;
  }
  const glb = (def.artifacts ?? []).find((a) => a.format === "glb" && a.role === "body" && (body ? a.id === body || a.provenance?.generatedFrom === body : true));
  const file = glb && p.artifacts.find((a) => a.definition === def.id && a.id === glb.id)?.resolved;
  return file && existsSync(file) ? file : undefined;
}

/**
 * A module's geometry manifest: its provider's standard output (a board's
 * board.manifest.json, a part's body.manifest.json), else a manifest it
 * references as an artifact.
 */
export function standardManifest(p: Project, defId: string): { manifest: GeometryManifest & { frames?: Record<string, GeometryFrame> }; file: string } | undefined {
  const b = p.capabilities.find((x) => x.module === defId && !x.problem);
  let file = b ? join(b.out, b.capability === "circuit" ? "board.manifest.json" : "body.manifest.json") : undefined;
  if (!file || !existsSync(join(p.root, file))) {
    const a = (p.lookup(defId)?.artifacts ?? []).find((x) => x.format === "json" && x.filePath?.endsWith("manifest.json"));
    const resolved = a && p.artifacts.find((x) => x.definition === defId && x.id === a.id)?.resolved;
    file = resolved ? posix(relative(p.root, resolved)) : undefined;
  }
  if (!file || !existsSync(join(p.root, file))) return undefined;
  try {
    return { manifest: JSON.parse(readFileSync(join(p.root, file), "utf8")), file };
  } catch {
    return undefined;
  }
}

/**
 * The nodes of a part's body GLB that are its interface feature markers, not
 * its body: UHD CAD bodies carry a thin named solid per interface feature (on
 * the face the interface binds to, 0.25 mm proud), which is no part of what
 * the enclosure holds. A node that is also a body of the part (its manifest's
 * `bodies`) stays. Provider outputs (a board's out/board.glb) have none.
 */
export function markerNodes(p: Project, def: ModuleDef): string[] {
  if (p.capabilities.some((b) => b.module === def.id && !b.problem)) return [];
  const bodies = new Set(Object.keys((standardManifest(p, def.id)?.manifest as { bodies?: Record<string, number> } | undefined)?.bodies ?? {}));
  return def.interfaces.map((i) => i.id).filter((id) => !bodies.has(id)).sort();
}

/** The enclosure instance and its placement in the assembly. */
export function enclosurePlacement(asm: Assembly, instance: string): Placement | undefined {
  const pl = asm.placements.find((x) => x.key === instance);
  return pl && { path: instance, matrix: pl.matrix, toLocal: invertRigid(pl.matrix) };
}

/** The frame a feature serves, in the enclosure's coordinates. */
export function servedFrame(p: Project, asm: Assembly, enc: Placement, f: FeatureSpec): { result?: JobFeature["served"]; problem?: string } {
  if (!f.serves) return {};
  const segments = enc.path.split("/");
  const parentPath = segments.slice(0, -1);
  const parentDef = parentPath.length ? p.lookup(p.instances.find((i) => i.path === parentPath.join("/"))!.definition) : p.rootDef;
  if (!parentDef) return { problem: `${f.id}: cannot find the module the enclosure sits in` };
  const path = [...parentPath, f.serves.child].join("/");
  const inst = p.instances.find((i) => i.path === path);
  if (!inst) return { problem: `${f.id} serves ${f.serves.child}.${f.serves.interfaceId}, but ${parentDef.id} has no child ${f.serves.child}` };
  const label = `${path}.${f.serves.interfaceId}`;
  const placed = (key: string) => asm.placements.find((x) => x.key === key)?.matrix;

  // 1. the served module's standard geometry manifest (a provider's view of where the connector is)
  const std = standardManifest(p, inst.definition);
  const m = placed(path);
  if (std && m) {
    const own = std.manifest.frames?.[f.serves.interfaceId];
    const feat = std.manifest.features?.[f.serves.interfaceId];
    const local: GeometryFrame | undefined = own ?? (feat?.normal ? { origin: feat.centroid, normal: feat.normal } : undefined);
    if (local) return { result: { key: path, label, from: "manifest", frame: transformFrame(multiplyMat4(enc.toLocal, m), local) } };
  }
  // 2. the model: the interface's own frame, through exports to the leaf that owns it
  const leaf = resolveLeafEndpoint(parentDef, { child: f.serves.child, interfaceId: f.serves.interfaceId }, p.lookup, parentPath);
  if (!leaf) return { problem: `${f.id} serves ${label}, which does not exist` };
  const frame = leaf.iface.geometry?.frame;
  const lm = placed(bodyKey(leaf.path, frame?.artifact));
  if (!frame) return { problem: `${f.id} serves ${label}, which has no frame${std ? ` and no feature with a normal in ${std.file}` : ""}` };
  if (!lm) return { problem: `${f.id} serves ${label}, but ${leaf.path.join("/")} is not placed in the assembly` };
  return { result: { key: leaf.path.join("/"), label, from: "model", frame: transformFrame(multiplyMat4(enc.toLocal, lm), frame) } };
}

export interface BuiltJob {
  job?: Job;
  /** Problems that stop generation (feature problems included). */
  problems: string[];
  /** The problems that are not about a feature's own declaration. */
  input: string[];
  /** Findings worth reporting that do not stop it. */
  notes: string[];
}

/** Build the generator job for an enclosure bound by a cad config. */
export function buildJob(p: Project, binding: Pick<CapabilityBinding, "constraints" | "process" | "native"> & { module: string; instances: string[] }, def: ModuleDef, instance?: string): BuiltJob {
  const problems: string[] = [];
  const notes: string[] = [];
  const process = binding.process ?? "print";
  if (process === "cut") problems.push('process "cut" is not supported by this provider (enclosures are printed or machined; use a plate provider for cut panels)');
  const { features, problems: featureProblems } = readFeatures(def);
  const declared = featureProblems.map((x) => `${def.id}.${x.interface}: ${x.message}`);
  if (!features.length) problems.push(`${def.id} has no enclosure features (interfaces with an enclosure_feature trait)`);
  const { design, problems: designProblems } = designOf(binding.constraints, process, features);
  problems.push(...designProblems);
  const at = instance ?? binding.instances[0];
  if (!at) {
    problems.push(`${def.id} is not used in the system, so nothing says what goes inside it`);
    return { problems: [...declared, ...problems], input: problems, notes };
  }
  if (!p.rootDef) return { problems: [...declared, ...problems, "the project has no root system"], input: [...problems, "the project has no root system"], notes };
  const asm = projectAssembly(p);
  const enc = enclosurePlacement(asm, at);
  if (!enc) {
    problems.push(`${at} is not placed in the assembly (mate it, or make it the display root)`);
    return { problems: [...declared, ...problems], input: problems, notes };
  }

  // features: frames, served parts, mates
  const external = new Set<string>();
  const jobFeatures: JobFeature[] = [];
  for (const f of features) {
    const jf: JobFeature = { id: f.id, kind: f.kind, params: { ...f.params }, ...(f.frame ? { frame: f.frame } : {}) };
    const mates = asm.mates
      .filter((m) => (m.a.path.join("/") === at && m.a.iface.id === f.id) || (m.b.path.join("/") === at && m.b.iface.id === f.id))
      .map((m) => (m.a.path.join("/") === at ? bodyKey(m.b.path, m.b.frame.artifact) : bodyKey(m.a.path, m.a.frame.artifact)));
    if (mates.length) jf.mates = mates;
    if (EXTERNAL_KINDS.includes(f.kind)) for (const k of mates) external.add(k);
    if (f.serves) {
      const s = servedFrame(p, asm, enc, f);
      if (s.problem) problems.push(s.problem);
      if (s.result) jf.served = s.result;
    }
    if (f.kind === "boss" && f.frame) {
      const fm = frameMatrix(f.frame);
      jf.params.holes = boltPatternHoles(f.iface).map(([x, y]) => applyMat4(fm, [x, y, 0]).slice(0, 2).map(r6));
      if (!(jf.params.holes as unknown[]).length) problems.push(`${def.id}.${f.id}: the bolt pattern gives no holes (hole_spacing missing?)`);
    }
    if (f.kind === "seal_gland") {
      const o = f.params.oring as ORing;
      const row = o && glandRow(f.params.type as "face" | "radial", o.w_mm);
      if (row) jf.params.table = { depth_mm: row.depth_mm, width_mm: row.width_mm, squeeze_pct: row.squeeze_pct, ...(row.clearance_mm ? { clearance_mm: row.clearance_mm } : {}), source: row.source };
    }
    jobFeatures.push(jf);
  }

  // contents: everything placed, except the enclosure, what its outside features hold, and exclusions
  const exclude = ((binding.constraints.exclude ?? []) as string[]).map(String);
  const under = (key: string, path: string) => key === path || key.startsWith(path + "/") || key.startsWith(path + "#");
  const contents: JobContent[] = [];
  const defAt = new Map(p.instances.map((i) => [i.path, i.definition]));
  for (const pl of [...asm.placements].sort((a, b) => a.key.localeCompare(b.key))) {
    const path = pl.path.join("/");
    if (!path || under(pl.key, at) || exclude.some((x) => under(pl.key, x)) || external.has(pl.key)) continue;
    const defId = defAt.get(path);
    const d = defId && p.lookup(defId);
    if (!d) continue;
    // a module placed with its parent's body (a board's components) is inside that body already
    const parentBody = (o: (typeof asm.placements)[number]) => {
      const pd = p.lookup(defAt.get(o.path.join("/")) ?? "");
      return !!pd && !!bodyGlb(p, pd);
    };
    if (asm.placements.some((o) => o !== pl && o.path.length && o.path.length < pl.path.length && path.startsWith(o.path.join("/") + "/") && parentBody(o))) continue;
    const file = bodyGlb(p, d, pl.body);
    if (!file) {
      notes.push(`${pl.key} (${d.id}) is placed but has no GLB body, so the fit check cannot see it`);
      continue;
    }
    const skip = markerNodes(p, d);
    contents.push({ key: pl.key, label: d.name ?? d.id, glb: posix(relative(p.root, file)), digest: sha256File(file), matrix: multiplyMat4(enc.toLocal, pl.matrix).map(r6), ...(skip.length ? { skip_nodes: skip } : {}) });
  }
  for (const h of asm.harnesses) {
    if (exclude.some((x) => under(h.key, x))) continue;
    const glb = (h.def.artifacts ?? []).find((a) => a.format === "glb" && a.role === "body");
    const file = glb && p.artifacts.find((a) => a.definition === h.def.id && a.id === glb.id)?.resolved;
    if (file && existsSync(file)) contents.push({ key: h.key, label: h.def.name ?? h.def.id, glb: posix(relative(p.root, file)), digest: sha256File(file), matrix: multiplyMat4(enc.toLocal, h.matrix).map(r6) });
  }
  if (!contents.length && !design.cavity) problems.push(`nothing is placed inside ${at}: mate the parts it holds to it, or give them display placements`);

  const material = typeof binding.constraints.material === "string" ? binding.constraints.material : null;
  const inputs = { process, material, design, contents: contents.map(({ label: _l, ...c }) => c), features: jobFeatures };
  const native = binding.native ?? "";
  const job: Job = {
    schema: JOB_SCHEMA,
    module: def.id,
    name: def.id,
    root: posix(relative(join(p.root, native), p.root)) || ".",
    process,
    material,
    inputsDigest: "sha256:" + createHash("sha256").update(stableStringify(inputs)).digest("hex"),
    design,
    contents,
    features: jobFeatures,
  };
  return { job, problems: [...declared, ...problems], input: problems, notes };
}

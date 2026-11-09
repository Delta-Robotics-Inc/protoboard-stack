/**
 * Supplied part models: a part's own 3D model (from its UHD definition, or a model a footprint names), loaded as a
 * mesh in the footprint frame for the scene, the mesh formats, the images and the seating check. STL and GLB are read
 * here; STEP is tessellated by OCCT through the CAD runtime (`py/board3d.py mesh`), and missing that, the part keeps
 * its parametric body and says why.
 *
 * In the STEP export a model body is written as the box of its mesh by this package's writer; `composeStepModels`
 * then places the model's own STEP geometry into that product through OCCT (fused into one solid per part unless
 * asked otherwise). Placement: model file frame -> T(offset) R(rotate, degrees about X, Y, Z applied Z first) S(scale)
 * -> footprint frame (mm, Z up from the seating plane), the convention KiCad libraries and `parts/sources.json`'s
 * `placement` slot use.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardDocument, FootprintRec } from "@protoboardai/board";
import { PART_COLORS } from "./bodies.js";
import { boxUnion, type Mesh, type Solid } from "./brep.js";
import { apply, compose, rotationXYZ, translation, type Affine, type Vec3 } from "./math.js";
import { runCadPython } from "./python.js";
import type { ModelMesh } from "./scene.js";
import { readGlb } from "./validate.js";

export interface ModelRef {
  path: string;
  format?: "step" | "stl" | "glb";
  /** mm */
  offset?: Vec3;
  /** degrees about X, Y, Z */
  rotate?: Vec3;
  scale?: Vec3;
  /** Units of the file (default: mm for STEP and STL; GLB is meters, Y up). */
  units?: "mm" | "m" | "in";
  terms?: "redistributable" | "internal" | "unknown";
  /** Where the reference came from, in words. */
  source?: string;
  color?: string;
}

/** Map a footprint to its model, or undefined to use a parametric body. */
export type ModelResolver = (fp: FootprintRec) => ModelRef | undefined;

export interface LoadedModels {
  models: Map<string, ModelMesh>;
  /** Per footprint id: the model placement (model file frame to footprint frame) for STEP composition. */
  placements: Map<string, { ref: ModelRef; matrix: Affine }>;
  report: { id: string; ref: string; path: string; ok: boolean; message: string; solids?: number; triangles?: number; ms?: number }[];
}

const formatOf = (r: ModelRef) => r.format ?? (/\.(step|stp)$/i.test(r.path) ? "step" : /\.stl$/i.test(r.path) ? "stl" : /\.glb$/i.test(r.path) ? "glb" : undefined);

function stlMesh(buf: Buffer): number[] {
  const ascii = buf.subarray(0, 5).toString("ascii").toLowerCase() === "solid" && buf.includes(Buffer.from("facet"));
  const pos: number[] = [];
  if (ascii) {
    for (const m of buf.toString("utf8").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pos.push(Number(m[1]), Number(m[2]), Number(m[3]));
    return pos;
  }
  const n = buf.readUInt32LE(80);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) pos.push(buf.readFloatLE(84 + t * 50 + 12 + k * 4));
  return pos;
}

function glbMesh(buf: Buffer): number[] {
  // every primitive's triangles through the node tree, then glTF meters Y up -> mm Z up
  const jlen = buf.readUInt32LE(12);
  const g = JSON.parse(buf.toString("utf8", 20, 20 + jlen)) as {
    nodes: { mesh?: number; matrix?: number[]; children?: number[]; translation?: number[]; scale?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number; mode?: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    scenes: { nodes: number[] }[];
  };
  readGlb(buf); // validates the container
  const binStart = 20 + jlen + 8;
  const read = (ai: number): number[] => {
    const a = g.accessors[ai];
    const v = g.bufferViews[a.bufferView];
    const comps = a.type === "VEC3" ? 3 : 1;
    const size = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = v.byteStride ?? comps * size;
    const out: number[] = [];
    const base = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < comps; c++) {
        const o = base + i * stride + c * size;
        out.push(a.componentType === 5126 ? buf.readFloatLE(o) : a.componentType === 5125 ? buf.readUInt32LE(o) : a.componentType === 5123 ? buf.readUInt16LE(o) : buf.readUInt8(o));
      }
    }
    return out;
  };
  const pos: number[] = [];
  const walk = (ni: number, m: number[]) => {
    const n = g.nodes[ni];
    let local = n.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (!n.matrix && (n.translation || n.scale)) {
      const t = n.translation ?? [0, 0, 0];
      const s = n.scale ?? [1, 1, 1];
      local = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1];
    }
    const w = new Array<number>(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) w[j * 4 + i] += m[k * 4 + i] * local[j * 4 + k];
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        const P = read(p.attributes.POSITION);
        const I = p.indices !== undefined ? read(p.indices) : P.map((_, i) => i).filter((i) => i < P.length / 3);
        for (const idx of I) {
          const x = P[idx * 3];
          const y = P[idx * 3 + 1];
          const z = P[idx * 3 + 2];
          const X = w[0] * x + w[4] * y + w[8] * z + w[12];
          const Y = w[1] * x + w[5] * y + w[9] * z + w[13];
          const Z = w[2] * x + w[6] * y + w[10] * z + w[14];
          pos.push(X * 1000, -Z * 1000, Y * 1000);
        }
      }
    }
    for (const c of n.children ?? []) walk(c, w);
  };
  for (const r of g.scenes[0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return pos;
}

/** The model placement as an affine map (scale included). */
export function modelMatrix(ref: ModelRef): Affine {
  const u = ref.units === "in" ? 25.4 : ref.units === "m" && formatOf(ref) !== "glb" ? 1000 : 1;
  const s = ref.scale ?? [1, 1, 1];
  const S: Affine = [s[0] * u, 0, 0, 0, 0, s[1] * u, 0, 0, 0, 0, s[2] * u, 0];
  return compose(translation(ref.offset ?? [0, 0, 0]), compose(rotationXYZ(ref.rotate ?? [0, 0, 0]), S));
}

/** A solid for a model mesh: the mesh as given, and the box of it as the B-rep (until a STEP composition replaces it). */
export function modelSolid(pos: number[], color: string): Solid {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]);
    x1 = Math.max(x1, pos[i]);
    y0 = Math.min(y0, pos[i + 1]);
    y1 = Math.max(y1, pos[i + 1]);
    z0 = Math.min(z0, pos[i + 2]);
    z1 = Math.max(z1, pos[i + 2]);
  }
  const box = boxUnion([{ min: [x0, y0, z0], max: [x1, y1, z1], color: 0 }], [color])!;
  const mesh: Mesh = { pos, color: new Array(pos.length / 9).fill(0) };
  return { brep: box.brep, mesh, palette: [color] };
}

/**
 * Load the models the resolver names. Identical files are read once. `python` is the CAD runtime (needed for STEP).
 */
export async function loadModels(doc: BoardDocument, resolve: ModelResolver, options: { python?: string; tolerance?: number } = {}): Promise<LoadedModels> {
  const models = new Map<string, ModelMesh>();
  const placements = new Map<string, { ref: ModelRef; matrix: Affine }>();
  const report: LoadedModels["report"] = [];
  const cache = new Map<string, { pos: number[]; solids?: number; sha256: string; ms: number } | Error>();
  const tmp = mkdtempSync(join(tmpdir(), "board-3d-models-"));
  try {
    const wanted: { fp: FootprintRec; ref: ModelRef }[] = [];
    for (const rec of doc.records.values()) {
      if (rec.kind !== "footprint") continue;
      const ref = resolve(rec as FootprintRec);
      if (ref) wanted.push({ fp: rec as FootprintRec, ref });
    }
    // STEP files are tessellated by OCCT in one run of the CAD runtime
    const steps = [...new Set(wanted.filter((w) => formatOf(w.ref) === "step").map((w) => w.ref.path))];
    if (steps.length) {
      if (!options.python) for (const p of steps) cache.set(p, new Error("STEP models need the CAD runtime (protoboard tools install cad)"));
      else {
        const t = performance.now();
        const jobs = steps.map((path, i) => ({ path, out: join(tmp, `m${i}.bin`) }));
        writeFileSync(join(tmp, "jobs.json"), JSON.stringify(jobs));
        try {
          const r = await runCadPython<{ results: { file: string; solids?: number; error?: string }[] }>(options.python, ["meshes", join(tmp, "jobs.json"), "--tolerance", String(options.tolerance ?? 0.02)], 1_800_000);
          const each = Math.round((performance.now() - t) / steps.length);
          r.results.forEach((res, i) => {
            if (res.error) return cache.set(steps[i], new Error(res.error));
            const raw = readFileSync(jobs[i].out);
            const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
            cache.set(steps[i], { pos: Array.from(f), solids: res.solids, sha256: `sha256:${createHash("sha256").update(readFileSync(steps[i])).digest("hex")}`, ms: each });
          });
        } catch (e) {
          for (const p of steps) cache.set(p, e as Error);
        }
      }
    }
    for (const { fp, ref } of wanted) {
      const fmt = formatOf(ref);
      let got = cache.get(ref.path);
      if (!got) {
        const t = performance.now();
        try {
          const bytes = readFileSync(ref.path);
          const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
          if (fmt === "stl") got = { pos: stlMesh(bytes), sha256, ms: 0 };
          else if (fmt === "glb") got = { pos: glbMesh(bytes), sha256, ms: 0 };
          else throw new Error(`unknown model format: ${ref.path}`);
          got.ms = Math.round(performance.now() - t);
        } catch (e) {
          got = e as Error;
        }
        cache.set(ref.path, got);
      }
      if (got instanceof Error) {
        report.push({ id: fp.id, ref: fp.ref, path: ref.path, ok: false, message: got.message });
        continue;
      }
      const m = modelMatrix(ref);
      const pos = new Array<number>(got.pos.length);
      for (let i = 0; i < got.pos.length; i += 3) {
        const q = apply(m, [got.pos[i], got.pos[i + 1], got.pos[i + 2]]);
        pos[i] = q[0];
        pos[i + 1] = q[1];
        pos[i + 2] = q[2];
      }
      if (!pos.length) {
        report.push({ id: fp.id, ref: fp.ref, path: ref.path, ok: false, message: "the model has no triangles" });
        continue;
      }
      models.set(fp.id, { solid: modelSolid(pos, ref.color ?? PART_COLORS.icBody), ...(ref.color ? { colored: true } : {}), source: `${ref.source ?? "model"}: ${ref.path.split(/[\\/]/).pop()}`, path: ref.path, sha256: got.sha256, ...(got.solids !== undefined ? { solids: got.solids } : {}), ...(ref.terms ? { terms: ref.terms } : {}) });
      placements.set(fp.id, { ref, matrix: m });
      report.push({ id: fp.id, ref: fp.ref, path: ref.path, ok: true, message: "loaded", ...(got.solids !== undefined ? { solids: got.solids } : {}), triangles: pos.length / 9, ms: got.ms });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { models, placements, report };
}

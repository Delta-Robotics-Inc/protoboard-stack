/**
 * The radial explode, tooling side (R2-E, walkthrough H2, 2026-11-02). Kevin: explode "all parts at once, each along
 * the outward normal of its mounting face as if pushed from the cube's centre; inner parts outward"; "the agent can
 * create the assembly script".
 *
 * When the assembly script asks for it (`"explode": "radial"` in `src/assembly.sequence.json`, or
 * `export const sequenceExplode = "radial"` in `src/assembly.uhd.ts`), the build writes on every moving member of
 * the sequence an `explode: { direction, distance }` (types.ts `ExplodeOverride`), so `.protoboard/build/sequence.json`
 * shows each part's way out and an agent can adjust any of them with an `explode` patch edit (patch.ts). The viewer
 * (R2-B) reads the field; without it the viewer computes the same rule at view time (uhd-viewer `cad/explode.ts`).
 *
 * The rule, kept the same as the viewer's (R2-B's handoff, 2026-11-02), each number a DEFAULT:
 * - centre and radius: the sphere around the assembled bounds of every placed body (half the box diagonal);
 * - a part's direction: the area-weighted mean normal of its largest facing (triangle normals binned at 20 steps per
 *   unit, about 3 degrees) whose dot with the unit line from the centre to the part's own bounds centre is at least
 *   0.3 (the mounting face that looks away from the centre); else that line; else up (+Z) when the part's centre is
 *   within 0.05 of the radius from the centre (a part at the middle);
 * - distance: 0.6 x the radius at explode amount 1, the same for every part;
 * - fasteners (hardware) get none: they ride the body they hold, as in the viewer.
 *
 * Units: mm and Z up, the assembly root's frame (UHD's). Body meshes come from mates/mesh.ts `readBodyMesh` (already
 * in UHD mm, Z up, the body's own frame) and are placed with the placement's row-major matrix.
 */
import type { Assembly } from "@deltarobotics/uhd";
import { placedBodies } from "../mates/project.js";
import { readBodyMesh } from "../mates/mesh.js";
import type { Project } from "../project.js";
import { hardwareKeys } from "./generate.js";
import type { SequenceFile, Vec3 } from "./types.js";

/** DEFAULTs of the rule (R2-B's viewer rule, 2026-11-02). */
export const RADIAL = { binsPerUnit: 20, minDot: 0.3, centreShare: 0.05, distanceShare: 0.6 } as const;

/** One part's triangles in the assembly frame (mm, Z up): xyz per corner, three corners per triangle. */
export interface RadialPart {
  ref: string;
  triangles: Float32Array;
}

export interface RadialResult {
  ref: string;
  direction: Vec3;
  distance: number;
  /** Where the direction came from: the mounting face, the line from the centre, or up for a part at the middle. */
  from: "face" | "centre" | "up";
}

type Box = { min: Vec3; max: Vec3 };

function boxOf(t: Float32Array): Box | undefined {
  if (t.length < 3) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < t.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = t[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

const centreOf = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d || 0;
const unit = (v: number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * The largest facing of a part whose normal looks along `away` (dot at least `minDot`): its area-weighted mean
 * normal, or undefined.
 */
export function mountingNormal(triangles: Float32Array, away: Vec3, o: { binsPerUnit?: number; minDot?: number } = {}): Vec3 | undefined {
  const steps = o.binsPerUnit ?? RADIAL.binsPerUnit;
  const minDot = o.minDot ?? RADIAL.minDot;
  const bins = new Map<string, { area: number; n: [number, number, number] }>();
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const ax = triangles[i + 3] - triangles[i], ay = triangles[i + 4] - triangles[i + 1], az = triangles[i + 5] - triangles[i + 2];
    const bx = triangles[i + 6] - triangles[i], by = triangles[i + 7] - triangles[i + 1], bz = triangles[i + 8] - triangles[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const twice = Math.hypot(cx, cy, cz);
    if (!(twice > 1e-12)) continue;
    const nx = cx / twice, ny = cy / twice, nz = cz / twice;
    const key = `${Math.round(nx * steps)},${Math.round(ny * steps)},${Math.round(nz * steps)}`;
    const area = twice / 2;
    const b = bins.get(key) ?? { area: 0, n: [0, 0, 0] };
    b.area += area;
    b.n[0] += nx * area;
    b.n[1] += ny * area;
    b.n[2] += nz * area;
    bins.set(key, b);
  }
  const ranked = [...bins.values()].sort((a, b) => b.area - a.area);
  for (const b of ranked) {
    const n = unit(b.n);
    if (n[0] * away[0] + n[1] * away[1] + n[2] * away[2] >= minDot) return n;
  }
  return undefined;
}

/**
 * Directions and distances for parts (`parts`), about the centre of everything placed (`all`: the parts and the
 * bodies that do not move, such as the base).
 */
export function radialDirections(parts: RadialPart[], all: RadialPart[] = parts, o: Partial<typeof RADIAL> = {}): RadialResult[] {
  const rule = { ...RADIAL, ...o };
  const boxes = all.map((p) => boxOf(p.triangles)).filter((b): b is Box => !!b);
  if (!boxes.length) return [];
  const whole: Box = {
    min: [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k]))) as Vec3,
  };
  const centre = centreOf(whole);
  const radius = Math.hypot(whole.max[0] - whole.min[0], whole.max[1] - whole.min[1], whole.max[2] - whole.min[2]) / 2;
  const distance = round(rule.distanceShare * radius, 1);
  const out: RadialResult[] = [];
  for (const p of parts) {
    const b = boxOf(p.triangles);
    if (!b) continue;
    const c = centreOf(b);
    const line = [c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]];
    const far = Math.hypot(line[0], line[1], line[2]);
    if (far <= rule.centreShare * radius) {
      out.push({ ref: p.ref, direction: [0, 0, 1], distance, from: "up" });
      continue;
    }
    const away = unit(line);
    const face = mountingNormal(p.triangles, away, rule);
    const d = face ?? away;
    out.push({ ref: p.ref, direction: [round(d[0], 4), round(d[1], 4), round(d[2], 4)], distance, from: face ? "face" : "centre" });
  }
  return out;
}

/** Every moving member of a sequence file (hardware left out: it rides its body), by ref. */
export function movingMembers(file: SequenceFile, hardware: ReadonlySet<string> = new Set()): string[] {
  const refs = new Set<string>();
  for (const s of file.sequences) for (const step of s.steps) for (const m of step.members) if (!hardware.has(m.ref) && !m.ref.startsWith("@")) refs.add(m.ref);
  return [...refs];
}

/** Write the results on the members they name (a member's own `explode` from a patch is applied later and wins). */
export function applyRadial(file: SequenceFile, results: readonly RadialResult[]): SequenceFile {
  const by = new Map(results.map((r) => [r.ref, r]));
  const out = JSON.parse(JSON.stringify(file)) as SequenceFile;
  for (const s of out.sequences)
    for (const step of s.steps)
      for (const m of step.members) {
        const r = by.get(m.ref);
        if (r) m.explode = { direction: [...r.direction] as Vec3, distance: r.distance };
      }
  return out;
}

/** Place a body-frame mesh (mm, Z up) with a row-major UHD matrix: the triangles' corners in the assembly frame. */
export function placeTriangles(positions: Float32Array, indices: Uint32Array, m: readonly number[]): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    const x = positions[v], y = positions[v + 1], z = positions[v + 2];
    out[i * 3] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/**
 * The radial explode of a project's sequence: each moving member's body read (its GLB, the view sidecar when
 * current), placed, and given its way out. Members without a model (a placeholder, no file) are left to the viewer
 * and listed in `skipped`.
 */
export async function projectRadialExplode(p: Project, asm: Assembly, file: SequenceFile): Promise<{ file: SequenceFile; results: RadialResult[]; skipped: { ref: string; reason: string }[] }> {
  const hardware = new Set(hardwareKeys(asm.hardware));
  const moving = new Set(movingMembers(file, hardware));
  const { bodies, skipped: noModel } = placedBodies(p, asm);
  const meshes = new Map<string, { positions: Float32Array; indices: Uint32Array } | Error>();
  const placed: RadialPart[] = [];
  const skipped: { ref: string; reason: string }[] = noModel.filter((s) => moving.has(s.instance)).map((s) => ({ ref: s.instance, reason: s.reason }));
  for (const b of bodies) {
    let mesh = meshes.get(b.file);
    if (!mesh) {
      try {
        const r = await readBodyMesh(b.file, p.root);
        mesh = { positions: r.positions, indices: r.indices };
      } catch (e) {
        mesh = e as Error;
      }
      meshes.set(b.file, mesh);
    }
    if (mesh instanceof Error) {
      if (moving.has(b.key)) skipped.push({ ref: b.key, reason: mesh.message.split("\n")[0] });
      continue;
    }
    placed.push({ ref: b.key, triangles: placeTriangles(mesh.positions, mesh.indices, b.matrix) });
  }
  const results = radialDirections(
    placed.filter((x) => moving.has(x.ref)),
    placed,
  );
  return { file: applyRadial(file, results), results, skipped };
}

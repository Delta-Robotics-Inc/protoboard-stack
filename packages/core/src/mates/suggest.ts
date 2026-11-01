/**
 * Heuristic auto-mate suggestions (PB-1185; research mates-joints-animation.md
 * D.3 stage 1, deterministic, before any learned ranker). Pure over face
 * geometry: every face (a view sidecar face-range entry, i.e. one B-rep face)
 * is fitted as a plane or a cylinder, then faces of two different placed
 * bodies are paired by three rules:
 *
 *   coaxial        two cylinders on one axis (parallel within AXIS_DEG, lines
 *                  within AXIS_MM), radii within FIT_MM, overlapping along the
 *                  axis: a shaft in a bore, a pin in a hole, two aligned holes;
 *   hole pattern   two sets of at least PATTERN_MIN parallel holes of one radius
 *                  whose axis points are congruent (pairwise distances within
 *                  PATTERN_MM): a bolt pattern; aligned when the axes coincide;
 *   planar contact two planes facing each other (normals opposed within
 *                  AXIS_DEG, offsets within CONTACT_MM) whose outlines overlap
 *                  by at least CONTACT_AREA_MM2: a part sitting on another.
 *
 * Every suggestion has provenance `inferred`, a confidence in [0, 1] and the
 * faces it saw as evidence; its frames are in each instance's own body frame
 * (mm, Z up). All thresholds are DEFAULTs, listed in `TOLERANCES` and written
 * into mates-suggested.json, to be tuned against confirmed mates later.
 *
 * Geometry comes in already in world mm, Z up (mesh.ts converts at the glTF
 * boundary, the caller applies the placement).
 */
import { add, applyDir, applyPoint, cross, dot, eigenSym3, invertRigid, len, perpendicular, scale, sub, unit } from "./frames.js";
import type { FaceGeom } from "./mesh.js";
import type { Mate, MateEvidence, MateFrame, Vec3 } from "./types.js";

/** DEFAULT tolerances (mm and degrees), revisit with confirmed mates. */
export const TOLERANCES = {
  /** A face is a plane when every triangle normal is within this of the mean (deg). */
  PLANE_DEG: 1,
  /** A face is a cylinder when its normals lie in one plane: smallest eigenvalue share of the normal scatter. */
  CYL_FLATNESS: 0.003,
  /** Circle fit residual allowed: max(CYL_RES_MM, CYL_RES_REL x radius). */
  CYL_RES_MM: 0.03,
  CYL_RES_REL: 0.02,
  /** A cylinder must cover at least this arc (deg) to count (fillets and chamfer bands do not). */
  CYL_MIN_ARC: 90,
  /** A hole: an inner cylinder covering at least this arc (deg). */
  HOLE_MIN_ARC: 300,
  /** Radii above this are near-flat and left out (mm). */
  CYL_MAX_R: 200,
  /** Two axes are parallel within this (deg); two normals opposed within it. */
  AXIS_DEG: 1,
  /** Two axes are one line within this (mm). */
  AXIS_MM: 0.1,
  /** Shaft and bore radii within this (mm): a clearance fit; an M3 clearance hole over a 2.5 mm tapped hole is 0.45. */
  FIT_MM: 0.6,
  /** Planes in contact: offsets within this (mm). */
  CONTACT_MM: 0.05,
  /** Contact patches smaller than this are left out (mm²). */
  CONTACT_AREA_MM2: 1,
  /** Planes smaller than this are not compared (mm²). */
  MIN_PLANE_AREA_MM2: 0.5,
  /** Hole patterns: at least this many holes; congruent when every pairwise distance agrees within PATTERN_MM. */
  PATTERN_MIN: 3,
  PATTERN_MM: 0.1,
  /** Aligned pattern: each hole axis within this of its partner (mm). */
  PATTERN_ALIGN_MM: 0.25,
  /** Bodies whose world bounds are farther apart than this are not compared (mm). */
  NEAR_MM: 1,
  /** Evidence entries kept per suggestion. */
  EVIDENCE_MAX: 6,
};

export interface PlaneFit {
  kind: "plane";
  normal: Vec3;
  /** normal · point on the plane (mm). */
  offset: number;
  centroid: Vec3;
  area: number;
  /** In-plane basis and the face's 2D bounds in it (mm). */
  u: Vec3;
  v: Vec3;
  min: [number, number];
  max: [number, number];
}
export interface CylinderFit {
  kind: "cylinder";
  axis: Vec3;
  /** A point on the axis (mm). */
  point: Vec3;
  radius: number;
  /** Arc covered by the face (deg). */
  arc: number;
  /** Normals point toward the axis: a hole or bore. */
  inner: boolean;
  /** Extent along the axis from `point` (mm). */
  t0: number;
  t1: number;
  residual: number;
  area: number;
}
export type FaceFit = PlaneFit | CylinderFit;

export interface FittedFace {
  body: string;
  node: string;
  feature: number;
  fit: FaceFit;
}

export interface SuggestBody {
  /** Placement key ("arm_fl/motor", "video#cad_camera_step"). */
  key: string;
  /** Instance path and body artifact. */
  instance: string;
  body?: string;
  /** Placement, row-major, body frame to world (mm, Z up). */
  matrix: number[];
  /** Faces in the body frame (mm, Z up). */
  faces: FaceGeom[];
}

const COS = (deg: number) => Math.cos((deg * Math.PI) / 180);

/** Fit one face (world mm) as a plane or a cylinder; undefined for anything else. */
export function fitFace(positions: Float32Array, indices: Uint32Array, tol = TOLERANCES): FaceFit | undefined {
  const tris = indices.length / 3;
  if (!tris) return undefined;
  const ns: number[][] = [];
  const as: number[] = [];
  const first: number[] = []; // the triangle each kept normal belongs to (degenerate ones are skipped)
  let area = 0;
  const centroid: Vec3 = [0, 0, 0];
  for (let t = 0; t < tris; t++) {
    const i = indices[t * 3] * 3, j = indices[t * 3 + 1] * 3, k = indices[t * 3 + 2] * 3;
    const a: Vec3 = [positions[i], positions[i + 1], positions[i + 2]];
    const b: Vec3 = [positions[j], positions[j + 1], positions[j + 2]];
    const c: Vec3 = [positions[k], positions[k + 1], positions[k + 2]];
    const n = cross(sub(b, a), sub(c, a));
    const ar = len(n) / 2;
    if (ar < 1e-12) continue;
    ns.push(scale(n, 1 / (2 * ar)));
    as.push(ar);
    first.push(indices[t * 3]);
    area += ar;
    for (let q = 0; q < 3; q++) centroid[q] += ((a[q] + b[q] + c[q]) / 3) * ar;
  }
  if (!area) return undefined;
  for (let q = 0; q < 3; q++) centroid[q] /= area;
  // plane: every normal near the mean
  const mean: Vec3 = [0, 0, 0];
  ns.forEach((n, i) => {
    mean[0] += n[0] * as[i];
    mean[1] += n[1] * as[i];
    mean[2] += n[2] * as[i];
  });
  if (len(mean) > 1e-9) {
    const m = unit(mean);
    const cosTol = COS(tol.PLANE_DEG);
    if (ns.every((n) => dot(n, m) >= cosTol)) {
      const u = perpendicular(m);
      const v = cross(m, u);
      const min: [number, number] = [Infinity, Infinity];
      const max: [number, number] = [-Infinity, -Infinity];
      for (let i = 0; i < positions.length; i += 3) {
        const p = [positions[i], positions[i + 1], positions[i + 2]];
        const x = dot(p, u), y = dot(p, v);
        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
      }
      return { kind: "plane", normal: m, offset: dot(m, centroid), centroid, area, u, v, min, max };
    }
  }
  // cylinder: normals spread in one plane; the axis is the direction they do not spread along
  const s = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  ns.forEach((n, i) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s[r * 3 + c] += n[r] * n[c] * as[i];
  });
  const { values, vectors } = eigenSym3(s);
  const total = values[0] + values[1] + values[2];
  if (total <= 0 || values[0] / total > tol.CYL_FLATNESS || values[1] / total < 0.02) return undefined;
  const axis = vectors[0];
  const e1 = perpendicular(axis);
  const e2 = cross(axis, e1);
  // circle through the vertices projected on the plane across the axis (algebraic least squares)
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0, nPts = 0;
  const pts: [number, number][] = [];
  let t0 = Infinity, t1 = -Infinity;
  // coordinates relative to the face centroid: the algebraic circle fit loses precision far from the origin
  const ox = dot(centroid, e1), oy = dot(centroid, e2);
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i], positions[i + 1], positions[i + 2]];
    const x = dot(p, e1) - ox, y = dot(p, e2) - oy, z = x * x + y * y;
    const t = dot(p, axis);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
    pts.push([x, y]);
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z; nPts++;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] [A B C]' = [sxz syz sz]', circle x^2 + y^2 = A x + B y + C
  const M = [sxx, sxy, sx, sxy, syy, sy, sx, sy, nPts];
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det3(M);
  if (Math.abs(D) < 1e-18) return undefined;
  const col = (k: number, v: number[]) => M.map((x, i) => (i % 3 === k ? v[Math.floor(i / 3)] : x));
  const rhs = [sxz, syz, sz];
  const A = det3(col(0, rhs)) / D, B = det3(col(1, rhs)) / D, C = det3(col(2, rhs)) / D;
  const cx = A / 2, cy = B / 2;
  const r2 = C + cx * cx + cy * cy;
  if (!(r2 > 0)) return undefined;
  const radius = Math.sqrt(r2);
  if (radius > tol.CYL_MAX_R) return undefined;
  let res = 0;
  for (const [x, y] of pts) res = Math.max(res, Math.abs(Math.hypot(x - cx, y - cy) - radius));
  if (res > Math.max(tol.CYL_RES_MM, tol.CYL_RES_REL * radius)) return undefined;
  const point = add(scale(e1, cx + ox), scale(e2, cy + oy));
  // arc: the largest gap between normal directions around the axis
  const angles = ns.map((n) => Math.atan2(dot(n, e2), dot(n, e1))).sort((a, b) => a - b);
  let gap = angles.length ? angles[0] + 2 * Math.PI - angles[angles.length - 1] : 2 * Math.PI;
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  const arc = 360 - (gap * 180) / Math.PI;
  if (arc < tol.CYL_MIN_ARC) return undefined;
  // inner when the normals point at the axis
  let inward = 0;
  const c3 = point;
  ns.forEach((n, k) => {
    const i = first[k] * 3;
    const p: Vec3 = [positions[i], positions[i + 1], positions[i + 2]];
    const radial = sub(p, add(c3, scale(axis, dot(sub(p, c3), axis))));
    inward += dot(n, radial) < 0 ? as[k] : -as[k];
  });
  const base = add(point, scale(axis, -dot(point, axis))); // the axis point nearest the origin
  return { kind: "cylinder", axis, point: base, radius, arc, inner: inward > 0, t0, t1, residual: res, area };
}

/** A face's geometry carried to world (placement applied) as a new face. */
function toWorld(f: FaceGeom, m: number[]): Float32Array {
  const out = new Float32Array(f.positions.length);
  for (let i = 0; i < f.positions.length; i += 3) {
    const p = applyPoint(m, [f.positions[i], f.positions[i + 1], f.positions[i + 2]]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}

interface Box {
  min: Vec3;
  max: Vec3;
}
const boxOf = (faces: { positions: Float32Array }[]): Box => {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const f of faces)
    for (let i = 0; i < f.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], f.positions[i + k]);
        max[k] = Math.max(max[k], f.positions[i + k]);
      }
  return { min, max };
};
const near = (a: Box, b: Box, pad: number) => [0, 1, 2].every((k) => a.min[k] - pad <= b.max[k] && b.min[k] - pad <= a.max[k]);

/** Distance between two parallel lines (point, unit direction). */
const lineGap = (p: Vec3, d: Vec3, q: Vec3) => {
  const w = sub(q, p);
  return len(sub(w, scale(d, dot(w, d))));
};

export interface SuggestResult {
  suggestions: Mate[];
  fitted: { faces: number; planes: number; cylinders: number; patterns: number };
  /** Body pairs compared. */
  pairs: number;
}

/** A frame given in world, expressed in a body's own frame (inverse placement). */
const localFrame = (matrix: number[], f: MateFrame): MateFrame => {
  const inv = invertRigid(matrix);
  return { origin: applyPoint(inv, f.origin), zAxis: unit(applyDir(inv, f.zAxis)), ...(f.xAxis ? { xAxis: unit(applyDir(inv, f.xAxis)) } : {}) };
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ev = (body: SuggestBody, f: FittedFace, extra: Record<string, number | string | boolean> = {}): MateEvidence => {
  const d: Record<string, number | string | boolean> = { ...extra };
  if (f.fit.kind === "cylinder") Object.assign(d, { radius: r3(f.fit.radius), arc: Math.round(f.fit.arc), inner: f.fit.inner, residual: r3(f.fit.residual) });
  else Object.assign(d, { area: r3(f.fit.area) });
  return { instance: body.instance, node: f.node, feature: f.feature, surface: f.fit.kind, detail: d };
};

interface HoleGroup {
  axis: Vec3;
  radius: number;
  holes: { point: Vec3; faces: FittedFace[] }[];
}

/**
 * Holes of one body grouped by axis direction and radius. Faces on one axis
 * line are merged first: a STEP kernel often splits a hole's wall into two
 * half-cylinders at its seam, so a hole is a line whose faces together cover
 * at least HOLE_MIN_ARC (their arcs summed, capped at 360).
 */
function holeGroups(fitted: readonly FittedFace[], tol: typeof TOLERANCES): HoleGroup[] {
  const cosAxis = COS(tol.AXIS_DEG);
  const groups: (HoleGroup & { arcs: number[] })[] = [];
  for (const h of fitted) {
    if (h.fit.kind !== "cylinder" || !h.fit.inner) continue;
    const c = h.fit;
    let g = groups.find((x) => Math.abs(dot(x.axis, c.axis)) >= cosAxis && Math.abs(x.radius - c.radius) <= 0.05);
    if (!g) {
      g = { axis: c.axis, radius: c.radius, holes: [], arcs: [] };
      groups.push(g);
    }
    const k = g.holes.findIndex((x) => lineGap(x.point, g!.axis, c.point) <= tol.AXIS_MM);
    if (k >= 0) {
      g.holes[k].faces.push(h);
      g.arcs[k] += c.arc;
    } else {
      g.holes.push({ point: c.point, faces: [h] });
      g.arcs.push(c.arc);
    }
  }
  return groups
    .map((g) => ({ axis: g.axis, radius: g.radius, holes: g.holes.filter((_, k) => Math.min(360, g.arcs[k]) >= tol.HOLE_MIN_ARC) }))
    .filter((g) => g.holes.length);
}

interface PairFindings {
  /** Hole patterns: aligned (every hole of the smaller set on an axis of the other) or only congruent. */
  patterns: { a: HoleGroup; b: HoleGroup; aligned: boolean; holes: number; offset: number }[];
  /** Coaxial lines no aligned pattern took. */
  lines: { point: Vec3; axis: Vec3; pairs: [FittedFace, FittedFace][] }[];
  contacts: { x: FittedFace; y: FittedFace; area: number }[];
}

/** What two bodies' faces say about each other (world mm). */
function pairFindings(fa: readonly FittedFace[], fb: readonly FittedFace[], ga: readonly HoleGroup[], gb: readonly HoleGroup[], tol: typeof TOLERANCES): PairFindings {
  const cosAxis = COS(tol.AXIS_DEG);
  const used = new Set<FittedFace>();
  const patterns: PairFindings["patterns"] = [];
  // 1. hole patterns: a group of one body whose every hole lies on an axis of a group of the other (aligned), or
  //    two groups of equal count with the same pairwise distances (congruent, not aligned)
  for (const x of ga)
    for (const y of gb) {
      if (Math.abs(dot(x.axis, y.axis)) < cosAxis || Math.abs(x.radius - y.radius) > tol.FIT_MM) continue;
      const [small, big] = x.holes.length <= y.holes.length ? [x, y] : [y, x];
      if (small.holes.length < 2) continue;
      const onAxis = (h: { point: Vec3 }) => big.holes.some((k) => lineGap(h.point, x.axis, k.point) <= tol.PATTERN_ALIGN_MM);
      if (small.holes.every(onAxis)) {
        patterns.push({ a: x, b: y, aligned: true, holes: small.holes.length, offset: 0 });
        for (const h of small.holes) for (const f of h.faces) used.add(f);
        for (const k of big.holes) if (small.holes.some((h) => lineGap(h.point, x.axis, k.point) <= tol.PATTERN_ALIGN_MM)) for (const f of k.faces) used.add(f);
        continue;
      }
      if (x.holes.length !== y.holes.length || x.holes.length < tol.PATTERN_MIN) continue;
      const sig = (g: HoleGroup) => {
        const d: number[] = [];
        for (let i = 0; i < g.holes.length; i++) for (let j = i + 1; j < g.holes.length; j++) d.push(lineGap(g.holes[i].point, x.axis, g.holes[j].point));
        return d.sort((p, q) => p - q);
      };
      const sx = sig(x), sy = sig(y);
      if (!sx.every((d, k) => Math.abs(d - sy[k]) <= tol.PATTERN_MM)) continue;
      const centre = (g: HoleGroup) => scale(g.holes.reduce((s, h) => add(s, h.point), [0, 0, 0] as Vec3), 1 / g.holes.length);
      patterns.push({ a: x, b: y, aligned: false, holes: x.holes.length, offset: lineGap(centre(x), x.axis, centre(y)) });
    }
  // 2. coaxial cylinders, one entry per shared axis line
  const lines: PairFindings["lines"] = [];
  for (const x of fa) {
    if (x.fit.kind !== "cylinder" || used.has(x)) continue;
    const cx = x.fit;
    for (const y of fb) {
      if (y.fit.kind !== "cylinder" || used.has(y)) continue;
      const cy = y.fit;
      if (Math.abs(dot(cx.axis, cy.axis)) < cosAxis || Math.abs(cx.radius - cy.radius) > tol.FIT_MM || lineGap(cx.point, cx.axis, cy.point) > tol.AXIS_MM) continue;
      // overlap along the axis, both extents measured on x's axis
      const s = dot(cx.axis, cy.axis) >= 0 ? 1 : -1;
      const shift = dot(sub(cy.point, cx.point), cx.axis);
      const y0 = (s > 0 ? cy.t0 : -cy.t1) + shift, y1 = (s > 0 ? cy.t1 : -cy.t0) + shift;
      if (Math.min(cx.t1, y1) - Math.max(cx.t0, y0) < -tol.CONTACT_MM) continue;
      let line = lines.find((l) => Math.abs(dot(l.axis, cx.axis)) >= cosAxis && lineGap(l.point, l.axis, cx.point) <= tol.AXIS_MM);
      if (!line) {
        line = { point: cx.point, axis: cx.axis, pairs: [] };
        lines.push(line);
      }
      line.pairs.push([x, y]);
    }
  }
  // 3. planar contact: planes facing each other at one offset, bucketed by offset along a canonical normal
  const canon = (n: Vec3) => {
    const k = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
    return n[k] < 0 ? -1 : 1;
  };
  const keyOf = (n: Vec3, off: number) => [Math.round(n[0] * 8), Math.round(n[1] * 8), Math.round(n[2] * 8), Math.round(off / 0.1)];
  const bucket = new Map<string, FittedFace[]>();
  for (const f of fb) {
    if (f.fit.kind !== "plane") continue;
    const sg = canon(f.fit.normal);
    const k = keyOf(scale(f.fit.normal, sg), f.fit.offset * sg).join(",");
    bucket.set(k, [...(bucket.get(k) ?? []), f]);
  }
  const contacts: PairFindings["contacts"] = [];
  for (const x of fa) {
    if (x.fit.kind !== "plane") continue;
    const px = x.fit;
    const sg = canon(px.normal);
    const kx = keyOf(scale(px.normal, sg), px.offset * sg);
    const seen = new Set<FittedFace>();
    for (let d0 = -1; d0 <= 1; d0++)
      for (let d1 = -1; d1 <= 1; d1++)
        for (let d2 = -1; d2 <= 1; d2++)
          for (let d3 = -1; d3 <= 1; d3++)
            for (const y of bucket.get(`${kx[0] + d0},${kx[1] + d1},${kx[2] + d2},${kx[3] + d3}`) ?? []) {
              if (seen.has(y)) continue;
              seen.add(y);
              const py = y.fit as PlaneFit;
              if (dot(px.normal, py.normal) > -cosAxis || Math.abs(px.offset + py.offset) > tol.CONTACT_MM) continue;
              // overlap of the two outlines' bounds, in x's plane basis
              const corners = [[py.min[0], py.min[1]], [py.max[0], py.min[1]], [py.min[0], py.max[1]], [py.max[0], py.max[1]]].map(([a, b]) => add(scale(py.u, a), scale(py.v, b)));
              const xs = corners.map((c) => dot(c, px.u)), ys = corners.map((c) => dot(c, px.v));
              const w = Math.min(px.max[0], Math.max(...xs)) - Math.max(px.min[0], Math.min(...xs));
              const h = Math.min(px.max[1], Math.max(...ys)) - Math.max(px.min[1], Math.min(...ys));
              if (w <= 0 || h <= 0) continue;
              const area = Math.min(w * h, px.area, py.area);
              if (area >= tol.CONTACT_AREA_MM2) contacts.push({ x, y, area });
            }
  }
  contacts.sort((p, q) => q.area - p.area);
  return { patterns, lines, contacts };
}

/**
 * Suggest mates between every two bodies whose world bounds come within
 * NEAR_MM: one suggestion per body pair, the strongest reading of the faces
 * (DEFAULT rules):
 *
 * - an aligned hole pattern (or two or more parallel coaxial hole lines) is a
 *   bolted joint: `fixed`, more confident with a seating face across its axis;
 * - one shaft-in-bore line with a seating face across it is `revolute` (a prop
 *   on a motor shaft); without the face, `coaxial`;
 * - holes only congruent (not aligned in the assembled pose) are a weak
 *   `fixed` that says how far apart they are;
 * - a face contact alone is `planar`.
 */
export function suggestMates(bodies: readonly SuggestBody[], tol = TOLERANCES): SuggestResult {
  const cosAxis = COS(tol.AXIS_DEG);
  const fitted = new Map<string, FittedFace[]>();
  const boxes = new Map<string, Box>();
  const groups = new Map<string, HoleGroup[]>();
  let faces = 0, planes = 0, cylinders = 0, patternsTotal = 0;
  for (const b of bodies) {
    const world = b.faces.map((f) => ({ f, positions: toWorld(f, b.matrix) }));
    boxes.set(b.key, boxOf(world));
    const list: FittedFace[] = [];
    for (const { f, positions } of world) {
      faces++;
      const fit = fitFace(positions, f.indices, tol);
      if (!fit) continue;
      if (fit.kind === "plane") {
        if (fit.area < tol.MIN_PLANE_AREA_MM2) continue;
        planes++;
      } else cylinders++;
      list.push({ body: b.key, node: f.node, feature: f.feature, fit });
    }
    fitted.set(b.key, list);
    const g = holeGroups(list, tol);
    patternsTotal += g.filter((x) => x.holes.length >= tol.PATTERN_MIN).length;
    groups.set(b.key, g);
  }
  const suggestions: Mate[] = [];
  let pairs = 0;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i], B = bodies[j];
      if (A.instance === B.instance && (A.body ?? "") === (B.body ?? "")) continue;
      const ba = boxes.get(A.key)!, bb = boxes.get(B.key)!;
      if (!near(ba, bb, tol.NEAR_MM)) continue;
      pairs++;
      const f = pairFindings(fitted.get(A.key)!, fitted.get(B.key)!, groups.get(A.key)!, groups.get(B.key)!, tol);
      if (!f.patterns.length && !f.lines.length && !f.contacts.length) continue;
      const centre = (b: Box) => scale(add(b.min, b.max), 0.5);
      const toward = (axis: Vec3): Vec3 => (dot(sub(centre(bb), centre(ba)), axis) >= 0 ? axis : (scale(axis, -1) as Vec3));
      const seatOn = (axis: Vec3) => f.contacts.filter((c) => Math.abs(dot((c.x.fit as PlaneFit).normal, axis)) >= cosAxis);
      const contactArea = f.contacts.reduce((s, c) => s + c.area, 0);
      const aligned = f.patterns.filter((p) => p.aligned);
      const holeLines = f.lines.filter((l) => l.pairs.every(([p, q]) => (p.fit as CylinderFit).inner && (q.fit as CylinderFit).inner));
      const evidence: (MateEvidence | string)[] = [];
      let kind: Mate["kind"];
      let confidence: number;
      let frame: MateFrame;
      let note: string;
      if (aligned.length || holeLines.length >= 2) {
        // a bolted joint
        const axis = aligned.length ? aligned[0].a.axis : holeLines[0].axis;
        const pts = aligned.length ? aligned[0].a.holes.map((h) => h.point) : holeLines.map((l) => l.point);
        const c = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
        const seat = seatOn(axis);
        const origin = seat.length ? add(c, scale(axis, dot(sub((seat[0].x.fit as PlaneFit).centroid, c), axis))) : c;
        frame = { origin, zAxis: toward(axis), ...(len(sub(pts[0], c)) > 1e-6 ? { xAxis: unit(sub(pts[0], c)) } : {}) };
        kind = "fixed";
        const holes = aligned.length ? Math.max(...aligned.map((p) => p.holes)) : holeLines.length;
        confidence = 0.6 + 0.06 * Math.min(holes, 4) + (seat.length ? 0.1 : 0);
        note = `${holes}-hole pattern${aligned.length ? `, r ${r3(aligned[0].a.radius)} / ${r3(aligned[0].b.radius)} mm` : ""}, aligned${seat.length ? `, seated face to face (about ${r3(seat.reduce((s, x) => s + x.area, 0))} mm²)` : ""}`;
        for (const p of aligned.slice(0, 2)) evidence.push({ instance: A.instance, surface: "hole-pattern", detail: { holes: p.a.holes.length, radius: r3(p.a.radius) } }, { instance: B.instance, surface: "hole-pattern", detail: { holes: p.b.holes.length, radius: r3(p.b.radius) } });
        for (const l of holeLines.slice(0, 2)) evidence.push(ev(A, l.pairs[0][0]), ev(B, l.pairs[0][1]));
        for (const s of seat.slice(0, 1)) evidence.push(ev(A, s.x, { contact_mm2: r3(s.area) }), ev(B, s.y));
      } else if (f.lines.length) {
        const line = [...f.lines].sort((p, q) => q.pairs.length - p.pairs.length)[0];
        const [x, y] = line.pairs[0];
        const cx = x.fit as CylinderFit, cy = y.fit as CylinderFit;
        const shaftBore = line.pairs.some(([p, q]) => (p.fit as CylinderFit).inner !== (q.fit as CylinderFit).inner);
        const seat = seatOn(line.axis);
        const dr = Math.min(...line.pairs.map(([p, q]) => Math.abs((p.fit as CylinderFit).radius - (q.fit as CylinderFit).radius)));
        const mid = (Math.max(cx.t0, cy.t0) + Math.min(cx.t1, cy.t1)) / 2;
        const at = seat.length ? dot((seat[0].x.fit as PlaneFit).centroid, line.axis) : mid;
        frame = { origin: add(line.point, scale(line.axis, at - dot(line.point, line.axis))), zAxis: toward(line.axis) };
        kind = shaftBore && seat.length ? "revolute" : "coaxial";
        confidence = (shaftBore ? 0.55 : 0.4) + 0.2 * (1 - dr / tol.FIT_MM) + (seat.length ? 0.15 : 0) + Math.min(0.05, 0.01 * line.pairs.length);
        note = `${shaftBore ? "shaft in bore" : cx.inner ? "aligned hole" : "coaxial cylinders"}, r ${r3(cx.radius)} / ${r3(cy.radius)} mm, ${line.pairs.length} face pair(s)${seat.length ? ", seated on a face across the axis" : ""}${kind === "revolute" ? " (read as a turning joint; a key, a nut or a press fit may hold it fixed)" : ""}`;
        for (const [p, q] of line.pairs.slice(0, 2)) evidence.push(ev(A, p), ev(B, q));
        for (const s of seat.slice(0, 1)) evidence.push(ev(A, s.x, { contact_mm2: r3(s.area) }), ev(B, s.y));
      } else if (f.patterns.length) {
        const p = f.patterns[0];
        const c = scale(p.a.holes.reduce((s, h) => add(s, h.point), [0, 0, 0] as Vec3), 1 / p.a.holes.length);
        frame = { origin: c, zAxis: toward(p.a.axis) };
        kind = "fixed";
        confidence = Math.min(0.45, 0.2 + 0.05 * p.holes);
        note = `${p.holes}-hole pattern, r ${r3(p.a.radius)} / ${r3(p.b.radius)} mm, congruent but ${r3(p.offset)} mm apart in the assembled pose`;
        evidence.push({ instance: A.instance, surface: "hole-pattern", detail: { holes: p.a.holes.length, radius: r3(p.a.radius), aligned: false } }, { instance: B.instance, surface: "hole-pattern", detail: { holes: p.b.holes.length, radius: r3(p.b.radius), aligned: false } });
      } else {
        const px = f.contacts[0].x.fit as PlaneFit;
        const c = scale(f.contacts.reduce((s, x) => add(s, scale((x.x.fit as PlaneFit).centroid, x.area)), [0, 0, 0] as Vec3), 1 / contactArea);
        frame = { origin: c, zAxis: px.normal, xAxis: px.u };
        kind = "planar";
        confidence = 0.3 + 0.12 * Math.log10(1 + contactArea);
        note = `planar contact, about ${r3(contactArea)} mm² over ${f.contacts.length} face pair(s) (outline bounds, an upper estimate)`;
        for (const s of f.contacts.slice(0, 3)) evidence.push(ev(A, s.x, { contact_mm2: r3(s.area) }), ev(B, s.y));
      }
      const end = (body: SuggestBody, fr: MateFrame) => ({ instance: body.instance, ...(body.body ? { body: body.body } : {}), frame: localFrame(body.matrix, fr) });
      suggestions.push({
        id: `inferred:${kind}:${A.key}~${B.key}`,
        kind,
        a: end(A, frame),
        b: end(B, { origin: frame.origin, zAxis: scale(frame.zAxis, -1) as Vec3, ...(frame.xAxis ? { xAxis: frame.xAxis } : {}) }),
        provenance: "inferred",
        confidence: r3(Math.max(0.05, Math.min(0.95, confidence))),
        evidence: evidence.slice(0, tol.EVIDENCE_MAX),
        note,
      });
    }
  return { suggestions, fitted: { faces, planes, cylinders, patterns: patternsTotal }, pairs };
}

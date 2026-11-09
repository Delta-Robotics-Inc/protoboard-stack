/**
 * Exact solids for the board and its parts, built in code without a CAD kernel. Two builders cover what a board model
 * needs, each giving one closed, manifold boundary (a B-rep with planes, cylinders, lines and circles) and a triangle
 * mesh tessellated from the same faces, so every format agrees:
 *
 * - `extrudeRegion`: a planar area (outer loop and holes, straight and circular edges) swept along its normal. The
 *   board with its cutouts and drilled holes, round and oval bodies, a USB-C shell with its mouth.
 * - `boxUnion`: the union of axis-aligned boxes, as an orthogonal solid on the grid of the boxes' coordinates. Package
 *   bodies with gull-wing leads, headers with pins, modules with shield cans. Cells take the color of the first box
 *   that covers them and `paints` recolor surface patches (pin 1 marks, terminations), so one solid carries several
 *   face colors.
 */
import { apply, applyDir, cross, det, normalize, sub, type Affine, type Bounds, type Vec2, type Vec3, emptyBounds, growBounds } from "./math.js";
import { arcPieces, arcSweep, orient, tessellateLoop, type Loop, type Region } from "./profile.js";
import { triangulate } from "./triangulate.js";

export type Curve = { kind: "line" } | { kind: "circle"; center: Vec3; axis: Vec3; ref: Vec3; radius: number };
export interface Edge {
  a: number;
  b: number;
  curve: Curve;
  /** For a circle: true when a to b runs counterclockwise about `axis`. Always true for a line. */
  sense: boolean;
}
export type Surface = { kind: "plane"; origin: Vec3; normal: Vec3; ref: Vec3 } | { kind: "cylinder"; origin: Vec3; axis: Vec3; ref: Vec3; radius: number };
export interface FaceLoop {
  edges: { e: number; fwd: boolean }[];
  outer: boolean;
}
export interface Face {
  surface: Surface;
  /** True when the face's outward normal agrees with the surface normal (planes: `normal`; cylinders: away from the axis). */
  sense: boolean;
  loops: FaceLoop[];
  /** Index into the solid's palette. */
  color: number;
}
export interface Brep {
  vertices: Vec3[];
  edges: Edge[];
  faces: Face[];
}
/** Triangles as corner positions (x, y, z per corner, 9 numbers per triangle), outward counterclockwise, with a palette index per triangle. */
export interface Mesh {
  pos: number[];
  color: number[];
}
export interface Solid {
  brep: Brep;
  mesh: Mesh;
  /** sRGB hex colors (`#rrggbb`); index 0 is the solid's main color. */
  palette: string[];
}

const NO_REF: Vec3 = [1, 0, 0];

// ---------------------------------------------------------------- extrusion

/**
 * Sweep `region` (in the XY plane) from z0 to z1 along +Z. `tol` is the chord tolerance of the mesh. One solid with
 * planar caps, planar sides for straight edges and cylindrical sides for arcs.
 */
export function extrudeRegion(region: Region, z0: number, z1: number, color = 0, palette: string[] = ["#808080"], tol = 0.01): Solid {
  const r = orient(region);
  const loops = [r.outer, ...r.holes];
  const brep: Brep = { vertices: [], edges: [], faces: [] };
  const mesh: Mesh = { pos: [], color: [] };
  const top: FaceLoop[] = [];
  const bottom: FaceLoop[] = [];
  const loops2d: Vec2[][] = [];
  loops.forEach((loop, li) => {
    const n = loop.pts.length;
    const vb: number[] = [];
    const vt: number[] = [];
    for (const p of loop.pts) {
      vb.push(brep.vertices.push([p[0], p[1], z0]) - 1);
      vt.push(brep.vertices.push([p[0], p[1], z1]) - 1);
    }
    const vertical: number[] = vb.map((b, i) => brep.edges.push({ a: b, b: vt[i], curve: { kind: "line" }, sense: true }) - 1);
    const bEdges: number[] = [];
    const tEdges: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const arc = loop.arcs[i];
      const curveAt = (z: number): Curve => (arc ? { kind: "circle", center: [arc.center[0], arc.center[1], z], axis: [0, 0, 1], ref: refFrom(loop.pts[i], arc.center), radius: arc.radius } : { kind: "line" });
      bEdges.push(brep.edges.push({ a: vb[i], b: vb[j], curve: curveAt(z0), sense: arc ? arc.ccw : true }) - 1);
      tEdges.push(brep.edges.push({ a: vt[i], b: vt[j], curve: curveAt(z1), sense: arc ? arc.ccw : true }) - 1);
      const side: FaceLoop = {
        outer: true,
        edges: [
          { e: bEdges[i], fwd: true },
          { e: vertical[j], fwd: true },
          { e: tEdges[i], fwd: false },
          { e: vertical[i], fwd: false },
        ],
      };
      const p = loop.pts[i];
      const q = loop.pts[j];
      if (arc) {
        brep.faces.push({ surface: { kind: "cylinder", origin: [arc.center[0], arc.center[1], z0], axis: [0, 0, 1], ref: refFrom(p, arc.center), radius: arc.radius }, sense: arc.ccw, loops: [side], color });
        // mesh: the arc in pieces
        const s = arcSweep(p, q, arc);
        const k = arcPieces(arc.radius, s, tol);
        const a0 = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
        let prev: Vec2 = p;
        for (let t = 1; t <= k; t++) {
          const cur: Vec2 = t === k ? q : [arc.center[0] + arc.radius * Math.cos(a0 + (s * t) / k), arc.center[1] + arc.radius * Math.sin(a0 + (s * t) / k)];
          quad(mesh, [prev[0], prev[1], z0], [cur[0], cur[1], z0], [cur[0], cur[1], z1], [prev[0], prev[1], z1], color);
          prev = cur;
        }
      } else {
        const d = normalize([q[0] - p[0], q[1] - p[1], 0]);
        const nrm = cross(d, [0, 0, 1]);
        brep.faces.push({ surface: { kind: "plane", origin: [p[0], p[1], z0], normal: nrm, ref: d }, sense: true, loops: [side], color });
        quad(mesh, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], color);
      }
    }
    top.push({ outer: li === 0, edges: tEdges.map((e) => ({ e, fwd: true })) });
    bottom.push({ outer: li === 0, edges: [...bEdges].reverse().map((e) => ({ e, fwd: false })) });
    loops2d.push(tessellateLoop(loop, tol));
  });
  brep.faces.push({ surface: { kind: "plane", origin: [0, 0, z1], normal: [0, 0, 1], ref: NO_REF }, sense: true, loops: top, color });
  brep.faces.push({ surface: { kind: "plane", origin: [0, 0, z0], normal: [0, 0, -1], ref: NO_REF }, sense: true, loops: bottom, color });
  // caps
  const flat = loops2d.flat();
  const tris = triangulate(loops2d[0], loops2d.slice(1), true);
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [flat[tris[k]], flat[tris[k + 1]], flat[tris[k + 2]]];
    tri(mesh, [a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], color);
    tri(mesh, [a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0], color);
  }
  return { brep, mesh, palette };
}

function refFrom(p: Vec2, c: Vec2): Vec3 {
  return normalize([p[0] - c[0], p[1] - c[1], 0]);
}

function tri(m: Mesh, a: Vec3, b: Vec3, c: Vec3, color: number): void {
  m.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  m.color.push(color);
}
function quad(m: Mesh, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number): void {
  tri(m, a, b, c, color);
  tri(m, a, c, d, color);
}

// ---------------------------------------------------------------- box union

export interface Box3 {
  min: Vec3;
  max: Vec3;
  /** Palette index. */
  color: number;
}

function uniq(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) if (!out.length || v - out[out.length - 1] > 1e-7) out.push(v);
  return out;
}
function indexOf(arr: readonly number[], v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v - 1e-7) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** In-plane axes (u, v) for a face normal along axis a with sign s, chosen so u x v points along the normal. */
const BASIS: Record<string, [number, number]> = { "0+": [1, 2], "0-": [2, 1], "1+": [2, 0], "1-": [0, 2], "2+": [0, 1], "2-": [1, 0] };

/**
 * The union of boxes as one solid. Boxes must overlap or share faces where they join (not only an edge or a corner),
 * so the result is manifold. Returns undefined for no boxes.
 */
export function boxUnion(boxes: readonly Box3[], palette: string[], paints: readonly Box3[] = []): Solid | undefined {
  if (!boxes.length) return undefined;
  const coords: number[][] = [[], [], []];
  for (const b of boxes) for (let a = 0; a < 3; a++) coords[a].push(b.min[a], b.max[a]);
  for (const p of paints) for (let a = 0; a < 3; a++) if (p.max[a] - p.min[a] > 1e-6) coords[a].push(p.min[a], p.max[a]);
  const g = coords.map(uniq);
  const n = [g[0].length - 1, g[1].length - 1, g[2].length - 1];
  const occ = new Int32Array(n[0] * n[1] * n[2]);
  const at = (i: number, j: number, k: number) => i + n[0] * (j + n[1] * k);
  for (const b of boxes) {
    const lo = [0, 1, 2].map((a) => indexOf(g[a], b.min[a]));
    const hi = [0, 1, 2].map((a) => indexOf(g[a], b.max[a]));
    for (let k = lo[2]; k < hi[2]; k++) for (let j = lo[1]; j < hi[1]; j++) for (let i = lo[0]; i < hi[0]; i++) if (!occ[at(i, j, k)]) occ[at(i, j, k)] = b.color + 1;
  }
  const occAt = (c: number[]): number => (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= n[0] || c[1] >= n[1] || c[2] >= n[2] ? 0 : occ[at(c[0], c[1], c[2])]);
  const brep: Brep = { vertices: [], edges: [], faces: [] };
  const mesh: Mesh = { pos: [], color: [] };
  const vid = new Map<number, number>();
  const NX = g[0].length;
  const NY = g[1].length;
  const vertex = (p: number[]): number => {
    const key = p[0] + NX * (p[1] + NY * p[2]);
    let v = vid.get(key);
    if (v === undefined) {
      v = brep.vertices.push([g[0][p[0]], g[1][p[1]], g[2][p[2]]]) - 1;
      vid.set(key, v);
    }
    return v;
  };
  const eid = new Map<string, number>();
  const edge = (va: number, vb: number): { e: number; fwd: boolean } => {
    const lo = Math.min(va, vb);
    const hi = Math.max(va, vb);
    const key = `${lo},${hi}`;
    let e = eid.get(key);
    if (e === undefined) {
      e = brep.edges.push({ a: lo, b: hi, curve: { kind: "line" }, sense: true }) - 1;
      eid.set(key, e);
    }
    return { e, fwd: va === lo };
  };
  const paintOf = (center: Vec3, base: number): number => {
    for (const p of paints) if (center[0] >= p.min[0] - 1e-7 && center[0] <= p.max[0] + 1e-7 && center[1] >= p.min[1] - 1e-7 && center[1] <= p.max[1] + 1e-7 && center[2] >= p.min[2] - 1e-7 && center[2] <= p.max[2] + 1e-7) return p.color;
    return base;
  };
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const [ua, va] = BASIS[`${a}${s > 0 ? "+" : "-"}`];
      const nu = n[ua];
      const nv = n[va];
      const normal: Vec3 = [0, 0, 0];
      normal[a] = s;
      const refAxis: Vec3 = [0, 0, 0];
      refAxis[ua] = 1;
      for (let p = 0; p <= n[a]; p++) {
        const label = new Int32Array(nu * nv);
        let any = false;
        const cell = [0, 0, 0];
        for (let iv = 0; iv < nv; iv++) {
          for (let iu = 0; iu < nu; iu++) {
            cell[ua] = iu;
            cell[va] = iv;
            cell[a] = p - 1;
            const below = occAt(cell);
            cell[a] = p;
            const above = occAt(cell);
            const inside = s > 0 ? below : above;
            const outside = s > 0 ? above : below;
            if (!inside || outside) continue;
            const center: Vec3 = [0, 0, 0];
            center[a] = g[a][p];
            center[ua] = (g[ua][iu] + g[ua][iu + 1]) / 2;
            center[va] = (g[va][iv] + g[va][iv + 1]) / 2;
            label[iu + iv * nu] = paintOf(center, inside - 1) + 1;
            any = true;
          }
        }
        if (!any) continue;
        const seen = new Uint8Array(nu * nv);
        for (let start = 0; start < nu * nv; start++) {
          if (!label[start] || seen[start]) continue;
          const lab = label[start];
          // flood fill one region of one color
          const cells: number[] = [];
          const stack = [start];
          seen[start] = 1;
          while (stack.length) {
            const c = stack.pop()!;
            cells.push(c);
            const iu = c % nu;
            const iv = (c / nu) | 0;
            for (const [du, dv] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const u2 = iu + du;
              const v2 = iv + dv;
              if (u2 < 0 || v2 < 0 || u2 >= nu || v2 >= nv) continue;
              const c2 = u2 + v2 * nu;
              if (!seen[c2] && label[c2] === lab) {
                seen[c2] = 1;
                stack.push(c2);
              }
            }
          }
          const inRegion = new Set(cells);
          const has = (iu: number, iv: number) => iu >= 0 && iv >= 0 && iu < nu && iv < nv && inRegion.has(iu + iv * nu);
          // directed boundary edges, counterclockwise around the region in (u, v)
          const out = new Map<number, number[]>();
          const key = (u: number, v: number) => u + (nu + 1) * v;
          const addE = (u0: number, v0: number, u1: number, v1: number) => {
            const k0 = key(u0, v0);
            const list = out.get(k0);
            if (list) list.push(key(u1, v1));
            else out.set(k0, [key(u1, v1)]);
          };
          for (const c of cells) {
            const iu = c % nu;
            const iv = (c / nu) | 0;
            if (!has(iu, iv - 1)) addE(iu, iv, iu + 1, iv);
            if (!has(iu + 1, iv)) addE(iu + 1, iv, iu + 1, iv + 1);
            if (!has(iu, iv + 1)) addE(iu + 1, iv + 1, iu, iv + 1);
            if (!has(iu - 1, iv)) addE(iu, iv + 1, iu, iv);
          }
          const loops: { pts: number[]; area: number }[] = [];
          const W = nu + 1;
          for (const [k0, list0] of out) {
            while (list0.length) {
              const pts = [k0];
              let cur = k0;
              let next = list0.shift()!;
              let dir: Vec2 = [(next % W) - (cur % W), ((next / W) | 0) - ((cur / W) | 0)];
              while (next !== k0) {
                pts.push(next);
                cur = next;
                const list = out.get(cur)!;
                // leftmost turn first
                let pick = 0;
                if (list.length > 1) {
                  let best = -Infinity;
                  list.forEach((cand, idx) => {
                    const d: Vec2 = [(cand % W) - (cur % W), ((cand / W) | 0) - ((cur / W) | 0)];
                    const turn = dir[0] * d[1] - dir[1] * d[0];
                    const straight = dir[0] * d[0] + dir[1] * d[1];
                    const score = turn > 0 ? 2 : straight > 0 ? 1 : 0;
                    if (score > best) {
                      best = score;
                      pick = idx;
                    }
                  });
                }
                const nx = list.splice(pick, 1)[0];
                dir = [(nx % W) - (cur % W), ((nx / W) | 0) - ((cur / W) | 0)];
                next = nx;
              }
              let area = 0;
              for (let i = 0; i < pts.length; i++) {
                const p0 = pts[i];
                const p1 = pts[(i + 1) % pts.length];
                area += g[ua][p0 % W] * g[va][(p1 / W) | 0] - g[ua][p1 % W] * g[va][(p0 / W) | 0];
              }
              loops.push({ pts, area });
            }
          }
          const idx3 = (k: number): number[] => {
            const c = [0, 0, 0];
            c[a] = p;
            c[ua] = k % W;
            c[va] = (k / W) | 0;
            return c;
          };
          const faceLoops: FaceLoop[] = loops.map((l) => {
            const vs = l.pts.map((k) => vertex(idx3(k)));
            return { outer: l.area > 0, edges: vs.map((v, i) => edge(v, vs[(i + 1) % vs.length])) };
          });
          // a region has one outer boundary; keep the largest as outer
          let maxA = -Infinity;
          let outerIdx = 0;
          loops.forEach((l, i) => {
            if (l.area > maxA) {
              maxA = l.area;
              outerIdx = i;
            }
          });
          faceLoops.forEach((fl, i) => (fl.outer = i === outerIdx));
          const origin: Vec3 = [0, 0, 0];
          origin[a] = g[a][p];
          const color = lab - 1;
          brep.faces.push({ surface: { kind: "plane", origin, normal, ref: refAxis }, sense: true, loops: faceLoops, color });
          // mesh: triangulate in (u, v), counterclockwise there is outward
          const uv = loops.map((l) => l.pts.map((k): Vec2 => [g[ua][k % W], g[va][(k / W) | 0]]));
          const order = [outerIdx, ...loops.map((_, i) => i).filter((i) => i !== outerIdx)];
          const rings = order.map((i) => uv[i]);
          const flat = rings.flat();
          const tris = triangulate(rings[0], rings.slice(1), true);
          const to3 = (q: Vec2): Vec3 => {
            const v: Vec3 = [0, 0, 0];
            v[a] = g[a][p];
            v[ua] = q[0];
            v[va] = q[1];
            return v;
          };
          for (let t = 0; t < tris.length; t += 3) tri(mesh, to3(flat[tris[t]]), to3(flat[tris[t + 1]]), to3(flat[tris[t + 2]]), color);
        }
      }
    }
  }
  return { brep, mesh, palette };
}

// ---------------------------------------------------------------- transforms and measures

/** A rigid transform of a solid (rotations and translations). A mirror is refused: it would turn the faces inside out. */
export function transformSolid(s: Solid, m: Affine): Solid {
  if (det(m) < 0) throw new Error("transformSolid: a mirror is not a rigid transform");
  const P = (p: Vec3) => apply(m, p);
  const D = (d: Vec3) => normalize(applyDir(m, d));
  const curve = (c: Curve): Curve => (c.kind === "line" ? c : { kind: "circle", center: P(c.center), axis: D(c.axis), ref: D(c.ref), radius: c.radius });
  const surface = (f: Surface): Surface => (f.kind === "plane" ? { kind: "plane", origin: P(f.origin), normal: D(f.normal), ref: D(f.ref) } : { kind: "cylinder", origin: P(f.origin), axis: D(f.axis), ref: D(f.ref), radius: f.radius });
  const brep: Brep = {
    vertices: s.brep.vertices.map(P),
    edges: s.brep.edges.map((e) => ({ ...e, curve: curve(e.curve) })),
    faces: s.brep.faces.map((f) => ({ ...f, surface: surface(f.surface) })),
  };
  const pos = new Array<number>(s.mesh.pos.length);
  for (let i = 0; i < s.mesh.pos.length; i += 3) {
    const q = P([s.mesh.pos[i], s.mesh.pos[i + 1], s.mesh.pos[i + 2]]);
    pos[i] = q[0];
    pos[i + 1] = q[1];
    pos[i + 2] = q[2];
  }
  return { brep, mesh: { pos, color: s.mesh.color }, palette: s.palette };
}

export function meshBounds(m: Mesh, xf?: Affine): Bounds {
  const b = emptyBounds();
  for (let i = 0; i < m.pos.length; i += 3) {
    const p: Vec3 = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
    growBounds(b, xf ? apply(xf, p) : p);
  }
  return b;
}

/** Enclosed volume of a closed mesh (mm^3); positive when the triangles face out. */
export function meshVolume(m: Mesh): number {
  let v = 0;
  const p = m.pos;
  for (let i = 0; i < p.length; i += 9) {
    v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return v / 6;
}

/** The loops of a region as one: a convenience for a solid that is a plain extrusion of one loop. */
export const regionOf = (outer: Loop, holes: Loop[] = []): Region => ({ outer, holes });

/** Count of boundary edges used by other than exactly two faces (0 for a closed manifold B-rep). */
export function brepDefects(b: Brep): number {
  const uses = new Array<number>(b.edges.length).fill(0);
  for (const f of b.faces) for (const l of f.loops) for (const u of l.edges) uses[u.e]++;
  return uses.filter((u) => u !== 2).length;
}

/** Direction from a to b. */
export const dirOf = (a: Vec3, b: Vec3): Vec3 => normalize(sub(b, a));

/**
 * The measurement contract shared by the viewer's mesh tier and the CLI's
 * exact tier (PB-1187). This file is byte-identical in uhd-viewer
 * `src/cad/measure/protocol.ts` and protoboard-stack
 * `packages/core/src/geometry-service/protocol.ts` (a core test compares
 * them, as the sequence files are compared): keep it free of imports.
 *
 * Units: mm, Z up (UHD). A ref's `point`, `signature` and the B-rep face it
 * names are in the part's own frame (its CAD file's frame, the STEP's mm);
 * `transform` (row-major, UHD Mat4) places the part in the assembly, and a
 * result is in assembly mm when every ref carries one, else in the part's
 * frame. Every result says its tier: "mesh" (measured on the display mesh,
 * with a tolerance from the mesh) or "exact" (measured on the B-rep through
 * build123d/OCCT).
 */

export type Vec3 = [number, number, number];

export const GEOMETRY_REQUEST_SCHEMA = "protoboard.geometry-request/v0";
export const GEOMETRY_RESULT_SCHEMA = "protoboard.geometry-result/v0";

export type MeasureKind = "point-point" | "point-face" | "face-face" | "cylinder" | "bounds";
export const MEASURE_KINDS: readonly MeasureKind[] = ["point-point", "point-face", "face-face", "cylinder", "bounds"];

export type SurfaceType = "plane" | "cylinder" | "other";

/** What a face looks like from the mesh, in the part's frame: how the exact tier finds it on the B-rep. */
export interface FaceSignature {
  type: SurfaceType;
  /** Area-weighted centroid of the face's surface, mm. */
  centroid: Vec3;
  /** Plane normal (outward, from the triangles' winding). */
  normal?: Vec3;
  /** Cylinder axis direction and a point on it, and the radius, mm. */
  axis?: Vec3;
  axisPoint?: Vec3;
  radius?: number;
  /** Surface area, mm^2 (the mesh's, a little under the B-rep's on curved faces). */
  area?: number;
}

export interface GeometryRef {
  /** The body's instance path from the root ("" is the root system's own body): the part whose CAD file is measured. */
  part: string;
  /** A component drawn inside that body (a board's part), by instance path: informational. */
  component?: string;
  /** The viewer's face id (sidecar feature id or primitive ordinal): informational, never an index into the STEP. */
  face?: number;
  /** The face to find on the B-rep. */
  signature?: FaceSignature;
  /** A B-rep face index (build123d `faces()` order), when already known (a previous match). */
  brepFace?: number;
  /** A picked point, part frame mm. */
  point?: Vec3;
  /** Part to assembly, row-major 4x4, mm (rigid). */
  transform?: number[];
}

export interface GeometryRequest {
  schema: typeof GEOMETRY_REQUEST_SCHEMA;
  kind: MeasureKind;
  a: GeometryRef;
  b?: GeometryRef;
}

export interface Tolerance {
  /** How far the true value may be from the reported one, mm (from the mesh: chord error, fit residual, position grid). */
  mm: number;
  /** For angles, degrees. */
  deg?: number;
  /** What the bound is made of, in words. */
  basis: string[];
}

export interface FaceMatch {
  /** The B-rep face (build123d `faces()` order). */
  brepFace: number;
  /** OCCT surface type of the face (PLANE, CYLINDER, BSPLINE, ...). */
  type: string;
  /** "signature" (matched by centroid, normal, radius, area) or "index" (given). */
  method: "signature" | "index";
  /** How far the matched face's centroid is from the signature's, mm, and the normal or axis angle, degrees. */
  centroidOffset?: number;
  angleDeg?: number;
  /** The next best candidate's score over the best's (larger: more certain; under 1.5 is ambiguous). */
  margin?: number;
}

export interface MeasureResult {
  schema?: typeof GEOMETRY_RESULT_SCHEMA;
  tier: "mesh" | "exact";
  kind: MeasureKind;
  /** "assembly" when every ref was placed, else "part". */
  frame: "assembly" | "part";
  /** How the number was taken: "parallel-planes", "axis-to-axis", "nearest", "plane-fit", "circle-fit", ... */
  method: string;
  distance?: number;
  angleDeg?: number;
  radius?: number;
  diameter?: number;
  axis?: { point: Vec3; direction: Vec3 };
  /** Bounds: min, max and size (x, y, z), mm. */
  min?: Vec3;
  max?: Vec3;
  size?: Vec3;
  /** The points the distance runs between. */
  points?: { a?: Vec3; b?: Vec3 };
  tolerance: Tolerance;
  faces?: { a?: FaceMatch; b?: FaceMatch };
  /** Surface types the measurement saw. */
  surfaces?: { a?: SurfaceType; b?: SurfaceType };
  notes?: string[];
  ms?: number;
}

/** One number from both tiers: the difference, and whether the exact value lies within the mesh tier's tolerance. */
export interface TierComparison {
  field: "distance" | "angleDeg" | "diameter" | "radius" | "size";
  mesh: number;
  exact: number;
  difference: number;
  tolerance: number;
  withinTolerance: boolean;
}

/** Compare a mesh-tier result with an exact one, field by field (size: per axis, largest difference). */
export function compareTiers(mesh: MeasureResult, exact: MeasureResult): TierComparison[] {
  const out: TierComparison[] = [];
  const fields: ("distance" | "angleDeg" | "diameter" | "radius")[] = ["distance", "angleDeg", "diameter", "radius"];
  for (const f of fields) {
    const m = mesh[f];
    const e = exact[f];
    if (typeof m !== "number" || typeof e !== "number") continue;
    const tol = f === "angleDeg" ? (mesh.tolerance.deg ?? 0) : mesh.tolerance.mm;
    out.push({ field: f, mesh: m, exact: e, difference: m - e, tolerance: tol, withinTolerance: Math.abs(m - e) <= tol + 1e-9 });
  }
  if (mesh.size && exact.size) {
    let worst = 0;
    for (let i = 0; i < 3; i++) if (Math.abs(mesh.size[i] - exact.size[i]) > Math.abs(mesh.size[worst] - exact.size[worst])) worst = i;
    const d = mesh.size[worst] - exact.size[worst];
    out.push({ field: "size", mesh: mesh.size[worst], exact: exact.size[worst], difference: d, tolerance: mesh.tolerance.mm, withinTolerance: Math.abs(d) <= mesh.tolerance.mm + 1e-9 });
  }
  return out;
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const isMat4 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 16 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Check a request's shape; returns the reason it is refused, or undefined. Instance paths are at most 512 characters. */
export function checkGeometryRequest(r: unknown): string | undefined {
  if (!r || typeof r !== "object") return "a request is an object";
  const q = r as Partial<GeometryRequest>;
  if (q.schema !== GEOMETRY_REQUEST_SCHEMA) return `schema must be ${GEOMETRY_REQUEST_SCHEMA}`;
  if (!q.kind || !MEASURE_KINDS.includes(q.kind)) return `kind must be one of ${MEASURE_KINDS.join(", ")}`;
  const refs: [string, unknown][] = [["a", q.a]];
  if (q.kind === "point-point" || q.kind === "point-face" || q.kind === "face-face") refs.push(["b", q.b]);
  else if (q.b !== undefined) refs.push(["b", q.b]);
  for (const [name, ref] of refs) {
    if (!ref || typeof ref !== "object") return `${name} is missing`;
    const x = ref as GeometryRef;
    if (typeof x.part !== "string" || x.part.length > 512) return `${name}.part must be an instance path`;
    if (x.component !== undefined && (typeof x.component !== "string" || x.component.length > 512)) return `${name}.component must be an instance path`;
    if (x.point !== undefined && !isVec3(x.point)) return `${name}.point must be three numbers`;
    if (x.transform !== undefined && !isMat4(x.transform)) return `${name}.transform must be 16 numbers`;
    if (x.brepFace !== undefined && !(Number.isInteger(x.brepFace) && x.brepFace >= 0)) return `${name}.brepFace must be a face index`;
    if (x.signature !== undefined) {
      const s = x.signature;
      if (!s || !isVec3(s.centroid) || !["plane", "cylinder", "other"].includes(s.type)) return `${name}.signature needs a type and a centroid`;
      for (const k of ["normal", "axis", "axisPoint"] as const) if (s[k] !== undefined && !isVec3(s[k])) return `${name}.signature.${k} must be three numbers`;
    }
  }
  const needsFace = (x?: GeometryRef) => !!x && (x.signature !== undefined || x.brepFace !== undefined);
  const needsPoint = (x?: GeometryRef) => !!x && x.point !== undefined;
  if (q.kind === "point-point" && !(needsPoint(q.a) && needsPoint(q.b))) return "point-point needs a.point and b.point";
  if (q.kind === "point-face" && !(needsPoint(q.a) && needsFace(q.b))) return "point-face needs a.point and a face on b";
  if (q.kind === "face-face" && !(needsFace(q.a) && needsFace(q.b))) return "face-face needs a face on a and on b";
  if (q.kind === "cylinder" && !needsFace(q.a)) return "cylinder needs a face on a";
  return undefined;
}

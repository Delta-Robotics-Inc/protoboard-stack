/**
 * Board layer separation for the view sidecar (fix wave R1, C1: z-fighting).
 *
 * An ECAD board export (EasyEDA, KiCad) writes each layer as a zero-thickness
 * sheet a hair above the substrate: on the ClientX board the substrate's top
 * face is at 1.6001 mm, TopCopper at 1.6101 mm, TopSilkscreen at 1.6201 mm
 * (and the bottom layers mirrored below 0). Sheets 0.01 mm apart fight in the
 * depth buffer as soon as the camera backs off (the viewer's near plane is
 * 1 mm, so a 24-bit depth step is about z^2 / (1 mm * 2^24): 0.03 mm at
 * 700 mm), drawn as grey streaks and moire over the board.
 *
 * The sidecar moves each layer face outward from the substrate along the
 * board normal by `rank * LAYER_STEP_MM`: copper one step, solder mask and
 * paste two, silkscreen three. `X.glb` itself is never changed; only
 * `X.view.glb`, `X.view.coarse.glb` and `X.view.json` carry the offsets.
 *
 * Units: UHD is mm and Z-up, glTF is metres and Y-up. The step is given in
 * model millimetres and converted to the part frame's own units before it is
 * applied (a glTF part frame is metres, so 0.02 mm is 2e-5; a frame under a
 * scaled wrapper gets the step divided by that scale along the normal).
 *
 * Direction: the board normal is the principal axis of the substrate's
 * triangle normals (else of the layer faces' own), so any board orientation
 * in the GLB works. The side is the face's position against the substrate's
 * mid-plane along that axis when the name gives no side (Top/Bottom, F./B. decide first: gate R1). The triangle
 * winding is not used for the side:
 * EasyEDA winds the top and the bottom layers alike (every TopCopper and
 * BottomCopper triangle faces -Y in the ClientX export).
 */
import type { Face, Mat4 } from "./geometry.js";

/** Offset per layer rank, in model millimetres (DEFAULT: 0.02 mm; see the R1 handoff on why the render side must also help). */
export const LAYER_STEP_MM = 0.02;

/** Rank of each layer class: how many steps it moves outward from the substrate (DEFAULT). */
export const LAYER_RANKS = { copper: 1, mask: 2, paste: 2, silkscreen: 3 } as const;

export type LayerKind = keyof typeof LAYER_RANKS;

/** What a node name says about a board layer. */
export interface LayerClass {
  /** "substrate" for the board body itself, "inner" for an inner layer (never moved), else a layer kind. */
  kind: LayerKind | "substrate" | "inner";
  side?: "top" | "bottom";
}

/** The base of an ECAD node name: the part before EasyEDA's `~` suffix, lower case. */
const baseName = (name: string) => name.split("~")[0].trim().toLowerCase();

/**
 * The board layer a node name names, or undefined. EasyEDA: `Board`,
 * `TopCopper`, `BottomSilkscreen`, `TopSolderMask`, `TopPasteMask`; KiCad:
 * `F.Cu`, `B.SilkS`, `F.Mask`, `F.Paste`, `In1.Cu`, a `..._PCB` body.
 */
export function layerClassOf(name: string | undefined): LayerClass | undefined {
  if (!name) return undefined;
  const n = baseName(name);
  if (!n) return undefined;
  const side: LayerClass["side"] = /^(top|f[._]|front)/.test(n) ? "top" : /^(bottom|bot[._]|b[._]|back)/.test(n) ? "bottom" : undefined;
  const withSide = (kind: LayerClass["kind"]): LayerClass => (side ? { kind, side } : { kind });
  if (/^(inner|in\d+[._])/.test(n)) return { kind: "inner" };
  if (/silk/.test(n)) return withSide("silkscreen");
  if (/paste/.test(n)) return withSide("paste");
  if (/mask/.test(n)) return withSide("mask");
  if (/copper|(^|[._\s-])cu($|[._\s-])/.test(n)) return withSide("copper");
  if (/^(board|pcb|substrate)$|[._\s-](pcb|board|substrate)$/.test(n)) return { kind: "substrate" };
  return undefined;
}

/** The step of a layer kind, or 0 (substrate, inner layers). */
export const rankOf = (c: LayerClass | undefined): number => (c && c.kind in LAYER_RANKS ? LAYER_RANKS[c.kind as LayerKind] : 0);

/**
 * True when a GLB's JSON names a layer the sidecar moves. Read from the
 * GLB's JSON chunk alone (no geometry), so the cache key can say whether
 * the layer offsets apply before the file is parsed.
 */
export function glbNamesLayers(glb: Uint8Array): boolean {
  try {
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return false; // "glTF"
    const len = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || 20 + len > glb.byteLength) return false; // "JSON"
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as { nodes?: { name?: string }[] };
    return (json.nodes ?? []).some((n) => rankOf(layerClassOf(n.name)) > 0);
  } catch {
    return false;
  }
}

/** The options a layer offset depends on, for the cache key. */
export const layerOptions = () => ({ stepMm: LAYER_STEP_MM, ranks: LAYER_RANKS, sides: "name-first" });

/** One layer's offset as applied, for the index (`X.view.json` `layers`). */
export interface LayerOffset {
  layer: LayerKind;
  side: "top" | "bottom";
  rank: number;
  /** Outward offset in model millimetres. */
  offsetMm: number;
  /** Source primitives (faces) moved. */
  faces: number;
}

/** A face read from a node of a board layer. */
export interface LayerFace {
  face: Face;
  layer: LayerClass;
}

// ---------------------------------------------------------------------------
// The board normal
// ---------------------------------------------------------------------------

/** Area-weighted normal covariance of faces' triangles (sign-free: n n^T). */
function covariance(faces: Face[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const f of faces) {
    const p = f.positions;
    const ix = f.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, d = ix[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (!l) continue;
      // weight by area (l / 2); n n^T / l^2 * l = n n^T / l
      const w = 1 / l;
      c[0] += nx * nx * w; c[1] += nx * ny * w; c[2] += nx * nz * w;
      c[4] += ny * ny * w; c[5] += ny * nz * w; c[8] += nz * nz * w;
    }
  }
  c[3] = c[1]; c[6] = c[2]; c[7] = c[5];
  return c;
}

/** The principal axis of the faces' normals (power iteration), with its largest component positive; undefined when they have no area. */
export function boardAxis(faces: Face[]): [number, number, number] | undefined {
  const c = covariance(faces);
  if (!(c[0] + c[4] + c[8] > 0)) return undefined;
  // start from the coordinate axis with the most weight, so the iteration never starts orthogonal to the answer
  let v = [c[0], c[4], c[8]].map((x, i, a) => (x === Math.max(...a) ? 1 : 0.01 * (i + 1)));
  for (let k = 0; k < 64; k++) {
    const w = [c[0] * v[0] + c[1] * v[1] + c[2] * v[2], c[3] * v[0] + c[4] * v[1] + c[5] * v[2], c[6] * v[0] + c[7] * v[1] + c[8] * v[2]];
    const l = Math.hypot(w[0], w[1], w[2]);
    if (!l) return undefined;
    v = w.map((x) => x / l);
  }
  const big = v.reduce((m, x, i) => (Math.abs(x) > Math.abs(v[m]) ? i : m), 0);
  if (v[big] < 0) v = v.map((x) => -x);
  return v as [number, number, number];
}

const project = (f: Face, a: number[]) => {
  let min = Infinity, max = -Infinity, sum = 0;
  const p = f.positions;
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    const d = p[i] * a[0] + p[i + 1] * a[1] + p[i + 2] * a[2];
    if (d < min) min = d;
    if (d > max) max = d;
    sum += d;
  }
  return { min, max, mean: n ? sum / n : 0 };
};

// ---------------------------------------------------------------------------
// Applying the offsets
// ---------------------------------------------------------------------------

/**
 * Move every layer face of one part outward from the substrate, in place
 * (the faces are the part's own copies, already in the part frame).
 * `world` is the part frame's world matrix: its scale along the board
 * normal converts the step from model millimetres to frame units.
 * Returns the offsets applied (empty when the part has no layer faces).
 */
export function offsetLayers(layerFaces: LayerFace[], substrate: Face[], world: Mat4): LayerOffset[] {
  const moving = layerFaces.filter((l) => rankOf(l.layer) > 0 && l.face.positions.length);
  if (!moving.length) return [];
  const axis = boardAxis(substrate.length ? substrate : moving.map((l) => l.face));
  if (!axis) return [];
  let mid: number | undefined;
  if (substrate.length) {
    let lo = Infinity, hi = -Infinity;
    for (const f of substrate) {
      const r = project(f, axis);
      lo = Math.min(lo, r.min);
      hi = Math.max(hi, r.max);
    }
    if (lo <= hi) mid = (lo + hi) / 2;
  }
  // model mm → glTF metres (÷1000) → the part frame's units (÷ the frame's world scale along the normal)
  const wa = [world[0] * axis[0] + world[4] * axis[1] + world[8] * axis[2], world[1] * axis[0] + world[5] * axis[1] + world[9] * axis[2], world[2] * axis[0] + world[6] * axis[1] + world[10] * axis[2]];
  const scale = Math.hypot(wa[0], wa[1], wa[2]) || 1;
  const stepFrame = LAYER_STEP_MM / 1000 / scale;
  const applied = new Map<string, LayerOffset>();
  for (const { face, layer } of moving) {
    const rank = rankOf(layer);
    let side = layer.side;
    // the name decides (Top/Bottom, F./B.); the substrate's mid-plane only for a layer whose name has no side (gate
    // R1, DEFAULT): a module's own board in the same part (`ESP32-WROOM_PCB`) also reads as substrate and moves the
    // mid-plane, which put the main board's top layers on the bottom side, inside the board
    if (side === undefined && mid !== undefined) {
      const m = project(face, axis).mean;
      if (m > mid) side = "top";
      else if (m < mid) side = "bottom";
    }
    // no substrate and no side in the name: every such layer moves the same way, so ranks still separate them (DEFAULT)
    const dir = side === "bottom" ? -1 : 1;
    const d = dir * rank * stepFrame;
    const p = face.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += axis[0] * d;
      p[i + 1] += axis[1] * d;
      p[i + 2] += axis[2] * d;
    }
    const kind = layer.kind as LayerKind;
    const key = `${kind}:${side ?? "top"}`;
    const rec = applied.get(key) ?? { layer: kind, side: side ?? "top", rank, offsetMm: rank * LAYER_STEP_MM, faces: 0 };
    rec.faces++;
    applied.set(key, rec);
  }
  return [...applied.values()].sort((a, b) => (a.side < b.side ? 1 : a.side > b.side ? -1 : 0) || a.rank - b.rank || (a.layer < b.layer ? -1 : 1));
}

/**
 * Annotations from scene ids, not pixels (PB-1180, README §18, generative-UI
 * note §G): a ref resolves to a node of `window.__cad.observe()`, its bounds
 * (mm, Z up, as drawn now) are projected through the camera the viewer
 * reports, and the overlay is drawn from those projections. The same numbers
 * go into the burned PNG, the SVG overlay and the manifest's legend.
 *
 * The projection is three.js's PerspectiveCamera with `lookAt` (camera looks
 * down its local -Z, `up` fixes the roll) and `fov` vertical, aspect from the
 * canvas, zoom 1 and no view offset: what CadView sets up. When the viewer
 * offers `__cad.project(points)` (requested from W2-A) the service uses that
 * instead and this stays as the fallback and the reference for tests.
 */
import type { CameraState, LegendEntry } from "./schema.js";

export type Vec3 = [number, number, number];
export type Bounds = [Vec3, Vec3];

/** The canvas the camera draws into, in the coordinates the result should use (CSS px of the page, or image px). */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance in front of the camera along its view axis (mm); <= 0 is behind it. */
  depth: number;
  inFront: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera's basis (three's lookAt for a camera: z from target to eye, x = up × z, y = z × x). */
export function cameraBasis(cam: CameraState): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = norm(sub(cam.position, cam.target));
  let x = cross(cam.up, z);
  // up parallel to the view direction: three nudges z; any perpendicular axis gives the same picture up to roll
  if (Math.hypot(...x) < 1e-9) x = cross(Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], z);
  x = norm(x);
  const y = cross(z, x);
  return { x, y, z };
}

/** A world point (mm) to viewport coordinates. */
export function projectPoint(cam: CameraState, vp: Viewport, p: Vec3): Projected {
  const { x, y, z } = cameraBasis(cam);
  const v = sub(p, cam.position);
  const xc = dot(v, x);
  const yc = dot(v, y);
  const depth = -dot(v, z);
  const f = 1 / Math.tan(((cam.fov ?? 50) * Math.PI) / 360);
  const aspect = vp.width / vp.height;
  const d = depth > 1e-6 ? depth : 1e-6;
  const nx = ((f / aspect) * xc) / d;
  const ny = (f * yc) / d;
  return { x: vp.x + ((nx + 1) / 2) * vp.width, y: vp.y + ((1 - ny) / 2) * vp.height, depth, inFront: depth > 1e-6 };
}

/** The eight corners of a box. */
export function corners([a, b]: Bounds): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) out.push([x, y, z]);
  return out;
}

export const centre = ([a, b]: Bounds): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** A box's centre and its projected screen rectangle (over the corners in front of the camera). */
export function projectBounds(cam: CameraState, vp: Viewport, bounds: Bounds): { anchor: Projected; rect?: [number, number, number, number] } {
  const anchor = projectPoint(cam, vp, centre(bounds));
  const pts = corners(bounds)
    .map((c) => projectPoint(cam, vp, c))
    .filter((p) => p.inFront);
  if (!pts.length) return { anchor };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { anchor, rect: [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0] };
}

/** What `observe()` lists, as far as a ref needs it. */
export interface RefNode {
  id: string;
  instancePath: string;
  bounds: Bounds | null;
  visible?: boolean;
}

/**
 * The node a ref names: an exact id or instance path (`@` and slashes at the
 * ends ignored), else the one node whose path ends with it (`u1` for
 * `board/u1`), else undefined (ambiguous or unknown).
 */
export function resolveRef(ref: string, nodes: RefNode[]): RefNode | undefined {
  const r = ref.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
  if (!r) return undefined;
  const exact = nodes.find((n) => n.id === r) ?? nodes.find((n) => n.instancePath === r);
  if (exact) return exact;
  const tail = nodes.filter((n) => n.instancePath.endsWith(`/${r}`));
  return tail.length === 1 ? tail[0] : undefined;
}

/** A short label for a ref: the given one, else the last segment of its path. */
export const labelOf = (ref: string, given?: string) => given ?? ref.replace(/^@/, "").split("/").filter(Boolean).pop() ?? ref;

export interface OverlayTheme {
  accent: string;
  occluded: string;
  ink: string;
  paper: string;
  halo: string;
}

/** DEFAULT (plan.md overnight defaults): the selection blue as the accent; orange is kept for DRC risk. */
export const OVERLAY_LIGHT: OverlayTheme = { accent: "#339fee", occluded: "#7c8aa0", ink: "#0f172a", paper: "#ffffff", halo: "#ffffff" };
export const OVERLAY_DARK: OverlayTheme = { accent: "#339fee", occluded: "#94a3b8", ink: "#f8fafc", paper: "#0f172a", halo: "#0b1020" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The overlay as SVG, in image pixels: per found entry a ring around its
 * projected box (dashed when occluded), a numbered badge at the box's top
 * left, and a label card beside the box (right when it fits, else left),
 * nudged down past cards already placed. White halo under every mark so it
 * reads on any background. Entries not found or behind the camera are left
 * to the legend.
 */
export function overlaySvg(width: number, height: number, legend: LegendEntry[], theme: OverlayTheme = OVERLAY_LIGHT, scale = 1): string {
  const s = Math.max(0.6, Math.min(3, scale));
  const r = 11 * s;
  const font = 13 * s;
  const placed: [number, number, number, number][] = [];
  const parts: string[] = [];
  const marks = legend.filter((e) => e.found && e.anchorPx).sort((a, b) => (a.boxPx?.[1] ?? a.anchorPx![1]) - (b.boxPx?.[1] ?? b.anchorPx![1]));
  for (const e of marks) {
    const [ax, ay] = e.anchorPx!;
    const pad = 6 * s;
    const box = e.boxPx ?? [ax - 12 * s, ay - 12 * s, 24 * s, 24 * s];
    const bx = clamp(box[0] - pad, 0, width - 2);
    const by = clamp(box[1] - pad, 0, height - 2);
    const bw = Math.max(4, Math.min(width - bx, box[2] + 2 * pad));
    const bh = Math.max(4, Math.min(height - by, box[3] + 2 * pad));
    const colour = e.occluded ? theme.occluded : theme.accent;
    const dash = e.occluded ? ` stroke-dasharray="${6 * s} ${4 * s}"` : "";
    parts.push(`<rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" rx="${f(6 * s)}" fill="none" stroke="${theme.halo}" stroke-width="${f(5 * s)}" opacity="0.9"/>`);
    parts.push(`<rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" rx="${f(6 * s)}" fill="none" stroke="${colour}" stroke-width="${f(2 * s)}"${dash}/>`);
    // the badge on the ring's top-left corner, inside the image
    const cx = clamp(bx, r + 1, width - r - 1);
    const cy = clamp(by, r + 1, height - r - 1);
    parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + 2 * s)}" fill="${theme.halo}"/>`);
    parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${colour}"/>`);
    parts.push(`<text x="${f(cx)}" y="${f(cy + font * 0.36)}" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${f(font)}" font-weight="700" fill="#ffffff">${e.n}</text>`);
    // the label card: beside the ring, never over another card
    const text = `${e.n}  ${e.label}${e.occluded ? " (hidden)" : ""}`;
    const tw = text.length * font * 0.58 + 16 * s;
    const th = font + 12 * s;
    let lx = bx + bw + 10 * s;
    if (lx + tw > width) lx = Math.max(0, bx - 10 * s - tw);
    let ly = clamp(by, 0, height - th);
    for (let guard = 0; guard < 50 && placed.some((p) => overlaps(p, [lx, ly, tw, th])); guard++) ly = Math.min(height - th, ly + th + 4 * s);
    placed.push([lx, ly, tw, th]);
    const linkX = lx > bx ? lx : lx + tw;
    parts.push(`<line x1="${f(lx > bx ? bx + bw : bx)}" y1="${f(Math.min(by + bh, Math.max(by, ly + th / 2)))}" x2="${f(linkX)}" y2="${f(ly + th / 2)}" stroke="${theme.halo}" stroke-width="${f(4 * s)}"/>`);
    parts.push(`<line x1="${f(lx > bx ? bx + bw : bx)}" y1="${f(Math.min(by + bh, Math.max(by, ly + th / 2)))}" x2="${f(linkX)}" y2="${f(ly + th / 2)}" stroke="${colour}" stroke-width="${f(1.5 * s)}"/>`);
    parts.push(`<rect x="${f(lx)}" y="${f(ly)}" width="${f(tw)}" height="${f(th)}" rx="${f(5 * s)}" fill="${theme.paper}" stroke="${colour}" stroke-width="${f(1.5 * s)}"/>`);
    parts.push(`<text x="${f(lx + 8 * s)}" y="${f(ly + th / 2 + font * 0.36)}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${f(font)}" font-weight="600" fill="${theme.ink}">${esc(text)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-protoboard="capture-overlay">${parts.join("")}</svg>`;
}

const f = (n: number) => String(Math.round(n * 10) / 10);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * The legend for a frame: each ref resolved, projected into image pixels
 * (`vp` is the canvas in image pixels), numbered from 1 in request order.
 * `occludedAt` says whether the point is hidden (the service asks the
 * viewer's own pick); without it nothing is marked hidden.
 */
export async function buildLegend(
  refs: { ref: string; label?: string }[],
  nodes: RefNode[],
  cam: CameraState,
  vp: Viewport,
  occludedAt?: (node: RefNode, px: [number, number]) => Promise<boolean | undefined>,
): Promise<LegendEntry[]> {
  const out: LegendEntry[] = [];
  for (const [i, a] of refs.entries()) {
    const node = resolveRef(a.ref, nodes);
    const entry: LegendEntry = { n: i + 1, ref: a.ref, label: labelOf(a.ref, a.label), found: !!node?.bounds };
    if (node) entry.instancePath = node.instancePath;
    if (node?.bounds) {
      const { anchor, rect } = projectBounds(cam, vp, node.bounds);
      if (anchor.inFront) {
        entry.anchorPx = [Math.round(anchor.x), Math.round(anchor.y)];
        if (rect) entry.boxPx = rect.map((v) => Math.round(v)) as [number, number, number, number];
        const hidden = occludedAt ? await occludedAt(node, entry.anchorPx) : undefined;
        if (hidden !== undefined) entry.occluded = hidden;
      }
    }
    out.push(entry);
  }
  return out;
}

/** Rotates `v` by the rotation that takes `from` onto `to` (both unit; Rodrigues). */
function rotateOnto(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = Math.hypot(...axis);
  const c = dot(from, to);
  if (s < 1e-9) return c > 0 ? v : [-v[0], v[1], -v[2]];
  const k = norm(axis);
  const kv = cross(k, v);
  const kdv = dot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kdv * (1 - c)) as Vec3;
}

/**
 * A camera that frames `bounds` from the direction the camera looks now, as
 * `__cad.set` keys (azimuth and elevation in the view's own up frame, the
 * distance, the target): the box's bounding sphere fills the narrower field
 * of view with `margin` to spare. Used when a document capture gives no
 * camera of its own (DEFAULT: frame the model, PB-1180).
 */
export function fitState(cam: CameraState, boxes: Bounds[], aspect: number, margin = 1.08): { azimuth: number; elevation: number; distance: number; target: Vec3 } | undefined {
  if (!boxes.length) return undefined;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const [a, b] of boxes)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], a[i], b[i]);
      hi[i] = Math.max(hi[i], a[i], b[i]);
    }
  const target = centre([lo, hi]);
  const radius = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  const dirWorld = norm(sub(cam.position, cam.target));
  // the viewer's azimuth and elevation are in a Z-up frame turned onto its up axis: turn back
  const local = rotateOnto(dirWorld, norm(cam.up), [0, 0, 1]);
  const elevation = (Math.asin(Math.max(-1, Math.min(1, local[2]))) * 180) / Math.PI;
  const azimuth = (Math.atan2(local[1], local[0]) * 180) / Math.PI;
  const halfV = ((cam.fov ?? 50) * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  let distance = (radius / Math.sin(Math.min(halfV, halfH))) * margin;
  // the sphere is loose for a flat or long model: pull in until the box's projection fills `fill` of the view
  const fill = 0.94 / margin;
  const vp = { x: 0, y: 0, width: 1000 * aspect, height: 1000 };
  for (let i = 0; i < 3; i++) {
    const position: Vec3 = [target[0] + dirWorld[0] * distance, target[1] + dirWorld[1] * distance, target[2] + dirWorld[2] * distance];
    // every box's corners (tighter than the union box's for a model of separate parts)
    const pts = boxes.flatMap((bx) => corners(bx)).map((c) => projectPoint({ ...cam, position, target }, vp, c)).filter((p) => p.inFront);
    if (!pts.length) break;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const rect = [0, 0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const used = Math.max(rect[2] / vp.width, rect[3] / vp.height);
    if (!(used > 0)) break;
    // never so close that a corner goes behind the camera
    distance = Math.max(radius * 1.05, distance * (used / fill));
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { azimuth: r3(azimuth), elevation: r3(elevation), distance: r3(distance), target: target.map(r3) as Vec3 };
}

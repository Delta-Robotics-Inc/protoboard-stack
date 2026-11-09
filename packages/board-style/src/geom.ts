/**
 * Geometry helpers on the board's integer nanometer grid: rings (flat x, y arrays), polygon booleans through
 * `@protoboardai/board-fill`'s clip engine, stroked text through `@protoboardai/board-scene`'s stroke font, knockout
 * tags, and conversion to board vertices (a polygon with holes becomes one contour with zero-width cuts, which every
 * renderer and the Gerber path fill correctly).
 */
import { mm, type Vertex } from "@protoboardai/board";
import { flattenContour } from "@protoboardai/board-checks";
import { clip, type Polygon, type Ring } from "@protoboardai/board-fill";
import { textPath, textWidth } from "@protoboardai/board-scene";

export type { Polygon, Ring };

export const round = (v: number): number => Math.round(v);

/** A rectangle ring (counterclockwise) centered on (cx, cy), `rot` in degrees counterclockwise. */
export function rectRing(cx: number, cy: number, w: number, h: number, rot = 0): Ring {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: number[] = [];
  for (const [x, y] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ])
    out.push(round(cx + x * c - y * s), round(cy + x * s + y * c));
  return out;
}

/** A ring from a box. */
export const boxRing = (b: { minX: number; minY: number; maxX: number; maxY: number }): Ring => [b.minX, b.minY, b.maxX, b.minY, b.maxX, b.maxY, b.minX, b.maxY];

/** A stroke from a to b of radius r as a closed ring (round caps, `steps` points per cap). */
export function capsuleRing(ax: number, ay: number, bx: number, by: number, r: number, steps = 6): Ring {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const base = len > 0 ? Math.atan2(dy, dx) : 0;
  const out: number[] = [];
  const cap = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + (Math.PI * i) / steps;
      out.push(round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a)));
    }
  };
  cap(bx, by, base - Math.PI / 2);
  cap(ax, ay, base + Math.PI / 2);
  return out;
}

/** Signed area (twice) of a ring: positive when counterclockwise. */
export function ringArea2(r: ArrayLike<number>): number {
  let s = 0;
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return s;
}

/** Union of rings (nonzero). */
export const union = (rings: Ring[]): Polygon[] => (rings.length ? clip([{ rings }], (i) => i[0]) : []);
/** a minus b. */
export const difference = (a: Ring[], b: Ring[]): Polygon[] => (a.length ? clip([{ rings: a }, { rings: b }], (i) => i[0] && !i[1]) : []);
/** a and b. */
export const intersection = (a: Ring[], b: Ring[]): Polygon[] => (a.length && b.length ? clip([{ rings: a }, { rings: b }], (i) => i[0] && i[1]) : []);
/** Rings of polygons (outer then holes). */
export const ringsOf = (ps: readonly Polygon[]): Ring[] => ps.flatMap((p) => [p.outer, ...p.holes]);

/** Polygon area in square nanometers. */
export const polygonArea = (p: Polygon): number => (ringArea2(p.outer) + p.holes.reduce((s, h) => s + ringArea2(h), 0)) / 2;

/**
 * One contour for a polygon with holes: each hole is joined to the outer ring by a zero-width cut from its nearest
 * outer vertex, so a nonzero or even-odd fill shows the hole.
 */
export function keyhole(p: Polygon): Ring {
  let outer = [...p.outer];
  const holes = [...p.holes].sort((a, b) => Math.max(...xs(b)) - Math.max(...xs(a)));
  for (const h of holes) {
    const hn = h.length >> 1;
    const on = outer.length >> 1;
    let best = Infinity;
    let bi = 0;
    let bj = 0;
    for (let j = 0; j < hn; j++)
      for (let i = 0; i < on; i++) {
        const d = (outer[2 * i] - h[2 * j]) ** 2 + (outer[2 * i + 1] - h[2 * j + 1]) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    const loop: number[] = [];
    for (let k = 0; k <= hn; k++) {
      const j = (bj + k) % hn;
      loop.push(h[2 * j], h[2 * j + 1]);
    }
    outer = [...outer.slice(0, 2 * bi + 2), ...loop, outer[2 * bi], outer[2 * bi + 1], ...outer.slice(2 * bi + 2)];
  }
  return outer;
}
const xs = (r: Ring) => r.filter((_, i) => i % 2 === 0);

/** Board vertices from a ring. */
export const ringToVertices = (r: Ring): Vertex[] => {
  const out: Vertex[] = [];
  for (let i = 0; i < r.length; i += 2) out.push({ x: r[i], y: r[i + 1] });
  return out;
};

/** A flat ring from board vertices (arcs flattened). */
export const verticesToRing = (v: readonly Vertex[]): Ring => flattenContour(v);

/** Drop repeated and collinear points of a closed ring. */
export function simplifyRing(r: Ring, tol = 2): Ring {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if ((b[0] === a[0] && b[1] === a[1]) || (len > 0 && cross / len <= tol)) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts.flat();
}

// ---------------------------------------------------------------- text

export interface TextPlacement {
  x: number;
  y: number;
  /** nm, cap height. */
  height: number;
  /** millidegrees, counterclockwise. */
  rotation?: number;
  anchor?: "left" | "center" | "right";
  /** Read from the bottom: mirrored left to right about the anchor. */
  mirrored?: boolean;
}

/** Text width at a cap height (both nm), in the stroke font every render and knockout uses. */
export const textAdvance = (text: string, height: number): number => textWidth(text, height);

/**
 * The strokes of `text` as polylines in board coordinates (nm, +Y up). The anchor point is the vertical middle of
 * the capitals, as board text records place text.
 */
export function textStrokes(text: string, p: TextPlacement): [number, number][][] {
  const unit = 1000; // draw at 1000 units per mm of height so the font's 0.01 rounding is 10 nm
  const hUnits = (p.height / 1e6) * unit;
  const d = textPath(text, 0, 0, hUnits, p.anchor ?? "center", 0);
  const scale = 1e6 / unit;
  const a = ((p.rotation ?? 0) / 1000) * (Math.PI / 180);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lines: [number, number][][] = [];
  let cur: [number, number][] | undefined;
  for (const m of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
    let lx = Number(m[2]) * scale;
    const ly = -Number(m[3]) * scale;
    if (p.mirrored) lx = -lx;
    const pt: [number, number] = [round(p.x + lx * c - ly * s), round(p.y + lx * s + ly * c)];
    if (m[1] === "M") {
      cur = [pt];
      lines.push(cur);
    } else cur!.push(pt);
  }
  return lines;
}

/** The box of a text's ink in its own frame grown by half the stroke: width and height in nm. */
export function textSize(text: string, height: number, stroke: number): { w: number; h: number } {
  return { w: textWidth(text, height) + stroke, h: height + stroke };
}

/** Stroked text as rings (each segment a capsule). */
export function textRings(text: string, p: TextPlacement, stroke: number): Ring[] {
  const rings: Ring[] = [];
  for (const line of textStrokes(text, p)) {
    if (line.length === 1) rings.push(capsuleRing(line[0][0], line[0][1], line[0][0], line[0][1], stroke / 2));
    for (let i = 1; i < line.length; i++) rings.push(capsuleRing(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], stroke / 2));
  }
  return rings;
}

/**
 * A knockout tag: a solid box with the text cut out of it, as filled contours (holes joined by cuts). `pad` is the
 * margin around the text (nm). The tag is centered on (x, y); bottom-side tags are mirrored so they read from below.
 */
export function knockoutTag(text: string, o: { x: number; y: number; height: number; stroke: number; pad: number; rotation?: number; mirrored?: boolean }): { contours: Ring[]; w: number; h: number; ring: Ring } {
  const size = textSize(text, o.height, o.stroke);
  const w = size.w + 2 * o.pad;
  const h = size.h + 2 * o.pad;
  const ring = rectRing(o.x, o.y, w, h, (o.rotation ?? 0) / 1000);
  const glyphs = textRings(text, { x: o.x, y: o.y, height: o.height, rotation: o.rotation ?? 0, anchor: "center", ...(o.mirrored ? { mirrored: true } : {}) }, o.stroke);
  const polys = difference([ring], glyphs);
  return { contours: polys.map((p) => simplifyRing(keyhole(p))), w, h, ring };
}

/** mm to nm. */
export const nm = (v: number): number => mm(v);

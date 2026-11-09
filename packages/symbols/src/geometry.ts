/**
 * Just enough SVG geometry for the checker: parse path data, turn each element into polylines (curves sampled),
 * and measure distances between them. No dependencies.
 */
import type { BodyElement } from "./types.ts";

export type Pt = [number, number];

const CURVE_STEPS = 24;

/** The path data's tokens: command letters and numbers (handles `1.5.5`, `-` as a separator, compact arc flags). */
export function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Every number written in an element's geometry (for the decimals and half-pixel rules). Arc flags are left out. */
export function numbersOf(el: BodyElement): number[] {
  if (el.el === "path") {
    const nums: number[] = [];
    const toks = tokenize(el.d ?? "");
    let cmd = "";
    let i = 0;
    let argIndex = 0;
    for (const t of toks) {
      if (typeof t === "string") {
        cmd = t;
        argIndex = 0;
        continue;
      }
      const isArc = cmd === "A" || cmd === "a";
      const slot = argIndex % 7;
      // arc: rx ry rotation large-arc sweep x y; the flags are not coordinates
      if (!(isArc && (slot === 3 || slot === 4))) nums.push(t);
      argIndex++;
      i++;
    }
    void i;
    return nums;
  }
  if (el.el === "polyline" || el.el === "polygon") return (el.points ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const keys = ["x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height"] as const;
  return keys.filter((k) => el[k] !== undefined).map((k) => el[k] as number);
}

function arcToPoints(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number): Pt[] {
  // SVG implementation notes, endpoint to center parameterization
  if (rxIn === 0 || ryIn === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const pts: Pt[] = [];
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = t1 + (dt * i) / CURVE_STEPS;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
  return pts;
}

/** A path's subpaths as polylines, curves sampled. */
export function pathToPolylines(d: string): Pt[][] {
  const toks = tokenize(d);
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null;
  let lastCmd = "";
  let i = 0;
  let cmd = "";
  const num = () => toks[i++] as number;
  const flush = () => {
    if (cur.length) lines.push(cur);
    cur = [];
  };
  while (i < toks.length) {
    if (typeof toks[i] === "string") cmd = toks[i++] as string;
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      cur.push([sx, sy]);
      x = sx;
      y = sy;
      flush();
      lastCtrl = null;
      lastCmd = C;
      continue;
    }
    if (C === "M") {
      flush();
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      sx = x;
      sy = y;
      cur.push([x, y]);
      lastCtrl = null;
    } else if (C === "L") {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      cur.push([x, y]);
      lastCtrl = null;
    } else if (C === "H") {
      x = (rel ? x : 0) + num();
      cur.push([x, y]);
      lastCtrl = null;
    } else if (C === "V") {
      y = (rel ? y : 0) + num();
      cur.push([x, y]);
      lastCtrl = null;
    } else if (C === "C" || C === "S" || C === "Q" || C === "T") {
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let c1: Pt;
      let c2: Pt;
      let e: Pt;
      if (C === "C") {
        c1 = [ox + num(), oy + num()];
        c2 = [ox + num(), oy + num()];
        e = [ox + num(), oy + num()];
      } else if (C === "S") {
        c1 = lastCtrl && (lastCmd === "C" || lastCmd === "S") ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        c2 = [ox + num(), oy + num()];
        e = [ox + num(), oy + num()];
      } else if (C === "Q") {
        const q: Pt = [ox + num(), oy + num()];
        e = [ox + num(), oy + num()];
        c1 = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        c2 = [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])];
        lastCtrl = q;
      } else {
        const q: Pt = lastCtrl && (lastCmd === "Q" || lastCmd === "T") ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        e = [ox + num(), oy + num()];
        c1 = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        c2 = [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])];
        lastCtrl = q;
      }
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
          u * u * u * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
        ]);
      }
      if (C === "C" || C === "S") lastCtrl = c2;
      x = e[0];
      y = e[1];
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num();
      const sweep = num();
      const ex = (rel ? x : 0) + num();
      const ey = (rel ? y : 0) + num();
      cur.push(...arcToPoints(x, y, rx, ry, rot, large, sweep, ex, ey));
      x = ex;
      y = ey;
      lastCtrl = null;
    } else {
      throw new Error(`unknown path command ${cmd}`);
    }
    lastCmd = C;
  }
  flush();
  return lines;
}

/** The vertices of a path made only of straight segments (M L H V Z), or null when it has curves. */
export function straightVertices(d: string): Pt[][] | null {
  if (/[CcSsQqTtAa]/.test(d)) return null;
  return pathToPolylines(d);
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (2 * Math.PI * k) / 48;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

/** An element as polylines in frame pixels (text: its approximate box, for bounds only). */
export function elementPolylines(el: BodyElement): Pt[][] {
  switch (el.el) {
    case "path":
      return pathToPolylines(el.d ?? "");
    case "line":
      return [
        [
          [el.x1!, el.y1!],
          [el.x2!, el.y2!],
        ],
      ];
    case "polyline":
    case "polygon": {
      const n = (el.points ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: Pt[] = [];
      for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]]);
      if (el.el === "polygon" && pts.length) pts.push(pts[0]);
      return [pts];
    }
    case "circle":
      return [ellipsePts(el.cx!, el.cy!, el.r!, el.r!)];
    case "ellipse":
      return [ellipsePts(el.cx!, el.cy!, el.rx!, el.ry!)];
    case "rect": {
      const { x = 0, y = 0, width = 0, height = 0 } = el;
      const r = Math.min(el.rx ?? 0, width / 2, height / 2);
      if (!r)
        return [
          [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height],
            [x, y],
          ],
        ];
      const pts: Pt[] = [];
      const corner = (cx: number, cy: number, a0: number) => {
        for (let k = 0; k <= 6; k++) {
          const t = a0 + (Math.PI / 2) * (k / 6);
          pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        }
      };
      corner(x + width - r, y + r, -Math.PI / 2);
      corner(x + width - r, y + height - r, 0);
      corner(x + r, y + height - r, Math.PI / 2);
      corner(x + r, y + r, Math.PI);
      pts.push(pts[0]);
      return [pts];
    }
    case "text": {
      const size = el.size ?? 3;
      const w = (el.text ?? "").length * size * 0.6;
      const x0 = el.anchor === "end" ? el.x! - w : el.anchor === "middle" ? el.x! - w / 2 : el.x!;
      const y0 = el.y! - size * 0.75;
      return [
        [
          [x0, y0],
          [x0 + w, y0],
          [x0 + w, y0 + size],
          [x0, y0 + size],
          [x0, y0],
        ],
      ];
    }
  }
}

function segPointDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segPointDist(a, c, d), segPointDist(b, c, d), segPointDist(c, a, b), segPointDist(d, a, b));
}

/** Smallest distance between two sets of polylines (a single point counts as a zero-length segment). */
export function polyDistance(A: Pt[][], B: Pt[][]): number {
  let best = Infinity;
  for (const pa of A)
    for (const pb of B) {
      const sa = pa.length === 1 ? [pa[0], pa[0]] : pa;
      const sb = pb.length === 1 ? [pb[0], pb[0]] : pb;
      for (let i = 0; i + 1 < sa.length; i++)
        for (let j = 0; j + 1 < sb.length; j++) {
          const v = segSegDist(sa[i], sa[i + 1], sb[j], sb[j + 1]);
          if (v < best) best = v;
          if (best === 0) return 0;
        }
    }
  return best;
}

/** Smallest distance from a point to a set of polylines. */
export function pointDistance(p: Pt, B: Pt[][]): number {
  return polyDistance([[p]], B);
}

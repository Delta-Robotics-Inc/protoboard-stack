/**
 * Orthogonal wire paths (pure, browser and Node): repeated and collinear points dropped, an end moved with one elbow,
 * a hand-drawn path made orthogonal. The host's gestures and the page's drag preview use the same functions.
 */
import type { Dir, XY } from "./types.js";

const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

/** Drop repeated points and middle points on a straight line through their neighbors (a wire stays orthogonal). */
export function simplifyPath(points: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of points) if (!out.length || !same(out[out.length - 1], p)) out.push([p[0], p[1]]);
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
    for (let i = 1; i < out.length; i++)
      if (same(out[i - 1], out[i])) {
        out.splice(i, 1);
        changed = true;
        break;
      }
  }
  return out;
}

/** The path with its first point moved to `to`, joined to the next vertex by one elbow leaving along `dir`. */
export function reattach(points: readonly XY[], to: XY, dir: Dir): XY[] {
  const rest = points.slice(1);
  const next = rest[0];
  const horizontal = dir === "left" || dir === "right";
  const elbow: XY = horizontal ? [next[0], to[1]] : [to[0], next[1]];
  return simplifyPath([to, elbow, ...rest]);
}

/** Whether every segment is horizontal or vertical. */
export const orthogonal = (points: readonly XY[]): boolean => points.slice(1).every((p, i) => p[0] === points[i][0] || p[1] === points[i][1]);

/** A wire drawn by hand: its path made orthogonal (an elbow between any two points that are not in line). */
export function orthogonalize(points: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of points) {
    const q: XY = [Math.round(p[0]), Math.round(p[1])];
    const last = out[out.length - 1];
    if (last && last[0] !== q[0] && last[1] !== q[1]) out.push([q[0], last[1]]);
    out.push(q);
  }
  return simplifyPath(out);
}

/** Where wires would go while symbols are dragged (the page's preview of the host's follow rule). */
export function followPreview(wires: readonly { id: string; net: string; points: readonly XY[] }[], moved: ReadonlyMap<string, { to: XY; dir: Dir }>, d: XY): { id: string; net: string; points: XY[] }[] {
  const k = (p: readonly number[]) => `${p[0]},${p[1]}`;
  const out: { id: string; net: string; points: XY[] }[] = [];
  for (const w of wires) {
    const pts = w.points as XY[];
    const a0 = moved.get(k(pts[0]));
    const an = moved.get(k(pts[pts.length - 1]));
    if (!a0 && !an) continue;
    if (a0 && an) {
      out.push({ id: w.id, net: w.net, points: pts.map((p) => [p[0] + d[0], p[1] + d[1]] as XY) });
      continue;
    }
    let next = pts;
    if (a0) next = reattach(next, a0.to, a0.dir);
    if (an) next = reattach([...next].reverse(), an.to, an.dir).reverse();
    out.push({ id: w.id, net: w.net, points: next });
  }
  return out;
}

/** A wire with one segment moved across itself (its neighbors stretch; the end points stay on their pins). */
export function moveSegment(points: readonly XY[], seg: number, d: XY): XY[] {
  const pts = points.map((p) => [p[0], p[1]] as XY);
  const a = pts[seg];
  const b = pts[seg + 1];
  const horizontal = a[1] === b[1];
  const shift: XY = horizontal ? [0, d[1]] : [d[0], 0];
  if (!shift[0] && !shift[1]) return pts;
  const na: XY = [a[0] + shift[0], a[1] + shift[1]];
  const nb: XY = [b[0] + shift[0], b[1] + shift[1]];
  const out: XY[] = [...pts.slice(0, seg + 1)];
  // an end segment keeps its end where it was: a new leg joins the end to the moved segment
  if (seg === 0) out.splice(1, 0, na);
  else out[seg] = na;
  if (seg + 1 === pts.length - 1) out.push(nb, b);
  else out.push(nb, ...pts.slice(seg + 2));
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

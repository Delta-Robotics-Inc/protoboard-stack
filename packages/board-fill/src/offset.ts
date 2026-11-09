/**
 * Growing polygons by a radius (Minkowski sum with a disc), for minimum width (the outward half of an opening)
 * and for keeping clear of higher-priority fills.
 *
 * Every ring of a polygon set has its copper on the left (outer rings counterclockwise, holes clockwise), so the
 * growth direction is always to the right of the ring. The raw offset ring follows each edge moved right by the
 * radius; at a corner the copper turns around (a left turn) it adds a round join, circumscribed so the join contains
 * the true arc; at a corner the copper fills (a right turn) it passes through the vertex itself. Read with the
 * positive fill rule together with the polygons, the raw rings give the grown set; the joins overshoot the radius
 * by at most the stated error, never undershoot it.
 */
import { clip, polygonRings, type Polygon, type Ring } from "./clip.js";
import { arcOutside, TAU } from "./shapes.js";

/** Raw offset rings of a polygon set grown by `rho` (read them with the positive rule). */
export function growRings(polys: readonly Polygon[], rho: number, err: number): Ring[] {
  const out: Ring[] = [];
  for (const ring of polygonRings(polys)) {
    const n = ring.length >> 1;
    if (n < 3) continue;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      const vx = ring[2 * i];
      const vy = ring[2 * i + 1];
      const d1x = vx - ring[2 * p];
      const d1y = vy - ring[2 * p + 1];
      const d2x = ring[2 * q] - vx;
      const d2y = ring[2 * q + 1] - vy;
      const a1 = Math.atan2(d1y, d1x) - Math.PI / 2;
      const a2 = Math.atan2(d2y, d2x) - Math.PI / 2;
      const cr = d1x * d2y - d1y * d2x;
      const dot = d1x * d2x + d1y * d2y;
      if (cr > 0 || (cr === 0 && dot < 0)) {
        let sw = a2 - a1;
        while (sw <= 0) sw += TAU;
        while (sw > TAU) sw -= TAU;
        arcOutside(pts, vx, vy, rho, a1, sw, err);
      } else if (cr < 0) {
        pts.push(vx + rho * Math.cos(a1), vy + rho * Math.sin(a1), vx, vy, vx + rho * Math.cos(a2), vy + rho * Math.sin(a2));
      } else pts.push(vx + rho * Math.cos(a1), vy + rho * Math.sin(a1));
    }
    const r: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = Math.round(pts[i]);
      const y = Math.round(pts[i + 1]);
      const m = r.length;
      if (m && r[m - 2] === x && r[m - 1] === y) continue;
      r.push(x, y);
    }
    if (r.length >= 6) out.push(r);
  }
  return out;
}

/**
 * Raw rings of a region shrunk by `rho` (its counterclockwise outline moved inward), read with the positive rule:
 * the outline is grown as if it were a hole in surrounding copper, then turned back. Round joins at the outline's
 * concave corners are circumscribed, so the shrunk region is never larger than the exact one.
 */
export function shrinkRings(ring: Ring, rho: number, err: number): Ring[] {
  if (rho <= 0) return [ring];
  const rev = (r: Ring): Ring => {
    const out: number[] = [];
    for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
    return out;
  };
  return growRings([{ outer: rev(ring), holes: [] }], rho, err).map(rev);
}

/** A polygon set grown by `rho` (round corners, circumscribed within `err`). */
export function grow(polys: readonly Polygon[], rho: number, err: number): Polygon[] {
  if (rho <= 0 || !polys.length) return [...polys];
  return clip([{ rings: polygonRings(polys) }, { rings: growRings(polys, rho, err), rule: "positive" }], (i) => i[0] || i[1]);
}

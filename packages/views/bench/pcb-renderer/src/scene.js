/**
 * Renderer-neutral scene for the benchmark: the parsed board turned into drawable objects,
 * one object per layer it is drawn on, each with simple geometry parts every candidate can
 * draw natively, plus a Flatbush index for picking. Millimeters, y down.
 *
 * Geometry parts:
 *   { k: "seg",  x1, y1, x2, y2, w }              round-capped segment (track, line)
 *   { k: "path", pts: [x, y, ...], w, closed }      round-joined polyline (arc, outline)
 *   { k: "box",  cx, cy, hx, hy, a, c }             rotated rounded box (pad); a in radians, c corner radius
 *   { k: "ring", cx, cy, r, ri }                    disk (ri = 0) or annulus
 *   { k: "poly", rings: [[x, y, ...], ...] }        filled polygon, even-odd
 *   { k: "text", paths: [[x, y, ...], ...], w }    stroke-font text
 */
import Flatbush from "flatbush";
import { strokeText } from "./font.js";

export const COLORS = {
  bg: [0.075, 0.078, 0.086],
  "F.Cu": [0.78, 0.2, 0.2],
  "In1.Cu": [0.76, 0.76, 0.0],
  "In2.Cu": [0.76, 0.0, 0.76],
  "In3.Cu": [0.0, 0.76, 0.76],
  "In4.Cu": [0.45, 0.45, 1.0],
  "B.Cu": [0.3, 0.5, 0.77],
  Vias: [0.7, 0.7, 0.7],
  Holes: [0.06, 0.06, 0.07],
  "F.SilkS": [0.95, 0.93, 0.63],
  "B.SilkS": [0.91, 0.7, 0.65],
  "F.Fab": [0.69, 0.69, 0.69],
  "B.Fab": [0.35, 0.4, 0.69],
  "Edge.Cuts": [0.82, 0.82, 0.8],
  Keepout: [0.9, 0.3, 0.9],
  Designators: [0.8, 0.85, 0.9],
  highlight: [1.0, 1.0, 1.0],
  select: [0.0, 0.9, 1.0],
};

/** Layer opacity, applied to the layer as a group (no double blending inside a layer). */
const ALPHA = { copper: 0.78, Vias: 1, Holes: 1, "F.SilkS": 0.95, "B.SilkS": 0.5, "F.Fab": 0.45, "B.Fab": 0.3, "Edge.Cuts": 1, Keepout: 0.6, Designators: 0.9 };

const DEG = Math.PI / 180;

/** Tessellate a three-point arc into a polyline, at most `step` radians per piece. */
export function arcPoints(a, m, b, step = 4 * DEG) {
  const [ax, ay] = a, [mx, my] = m, [bx, by] = b;
  const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
  if (Math.abs(d) < 1e-12) return [ax, ay, bx, by];
  const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
  const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const t0 = Math.atan2(ay - uy, ax - ux), tm = Math.atan2(my - uy, mx - ux), t1 = Math.atan2(by - uy, bx - ux);
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // sweep direction: does going counterclockwise (increasing angle) from t0 reach tm before t1?
  const ccw = norm(tm - t0) < norm(t1 - t0);
  const sweep = ccw ? norm(t1 - t0) : -norm(t0 - t1);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    out.push(ux + r * Math.cos(t), uy + r * Math.sin(t));
  }
  return out;
}

function circlePoly(cx, cy, r, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI));
  return out;
}

export function partBox(p) {
  switch (p.k) {
    case "seg": {
      const h = p.w / 2;
      return [Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h];
    }
    case "box": {
      const c = Math.abs(Math.cos(p.a)), s = Math.abs(Math.sin(p.a));
      const ex = p.hx * c + p.hy * s, ey = p.hx * s + p.hy * c;
      return [p.cx - ex, p.cy - ey, p.cx + ex, p.cy + ey];
    }
    case "ring":
      return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
    default: {
      const lists = p.k === "poly" ? p.rings : p.k === "text" ? p.paths : [p.pts];
      const h = (p.w ?? 0) / 2;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const l of lists) for (let i = 0; i < l.length; i += 2) {
        if (l[i] < x0) x0 = l[i];
        if (l[i] > x1) x1 = l[i];
        if (l[i + 1] < y0) y0 = l[i + 1];
        if (l[i + 1] > y1) y1 = l[i + 1];
      }
      return [x0 - h, y0 - h, x1 + h, y1 + h];
    }
  }
}

/** Build the scene. Returns { board, layers, objects, byNet, byFp, index, stats }. */
export function buildScene(board) {
  const copperTopDown = board.copper; // F.Cu, In1.., B.Cu
  // draw order for the top view, bottom-most first
  const order = ["B.Fab", "B.SilkS", ...copperTopDown.slice().reverse(), "Vias", "Holes", "F.Fab", "F.SilkS", "Designators", "Keepout", "Edge.Cuts"];
  const layers = order.map((name) => ({
    name,
    copper: copperTopDown.includes(name),
    color: COLORS[name] ?? [0.6, 0.6, 0.6],
    alpha: copperTopDown.includes(name) ? ALPHA.copper : (ALPHA[name] ?? 0.8),
    objects: [],
  }));
  const L = new Map(layers.map((l, i) => [l.name, i]));
  const objects = [];
  const add = (type, layer, n, fp, parts, item) => {
    const li = L.get(layer);
    if (li === undefined || !parts.length) return;
    let box = partBox(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      const b = partBox(parts[i]);
      box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
    }
    const o = { id: objects.length, item: item ?? objects.length, type, L: li, n: n ?? 0, fp: fp ?? -1, parts, box };
    objects.push(o);
    layers[li].objects.push(o.id);
    return o;
  };

  // zones first (under tracks and pads on the same layer)
  for (const z of board.zones) add("zone", z.l, z.n, -1, [{ k: "poly", rings: [z.pts.flat()] }]);
  for (const t of board.tracks) add("track", t.l, t.n, -1, [{ k: "seg", x1: t.a[0], y1: t.a[1], x2: t.b[0], y2: t.b[1], w: t.w }]);
  for (const t of board.arcs) add("track", t.l, t.n, -1, [{ k: "path", pts: arcPoints(t.a, t.m, t.b), w: t.w, closed: false }]);
  let item = 1e7;
  for (const p of board.pads) {
    const a = -p.r * DEG; // KiCad counterclockwise on a y-down screen
    const hx = p.w / 2, hy = p.h / 2;
    let parts;
    switch (p.shape) {
      case "circle": parts = [{ k: "ring", cx: p.p[0], cy: p.p[1], r: hx, ri: 0 }]; break;
      case "oval": parts = [{ k: "box", cx: p.p[0], cy: p.p[1], hx, hy, a, c: Math.min(hx, hy) }]; break;
      case "roundrect": parts = [{ k: "box", cx: p.p[0], cy: p.p[1], hx, hy, a, c: Math.min(hx, hy) * 2 * (p.rr ?? 0.25) }]; break;
      case "custom": {
        parts = (p.polys ?? []).map((r) => ({ k: "poly", rings: [r.flat()] }));
        parts.push(p.anchor === "circle" ? { k: "ring", cx: p.p[0], cy: p.p[1], r: hx, ri: 0 } : { k: "box", cx: p.p[0], cy: p.p[1], hx, hy, a, c: 0 });
        break;
      }
      default: parts = [{ k: "box", cx: p.p[0], cy: p.p[1], hx, hy, a, c: 0 }]; // rect, trapezoid (drawn as its box)
    }
    const it = item++;
    for (const l of p.ls) add("pad", l, p.n, p.fp, parts, it);
    if (p.drill) {
      const [dx, dy] = p.drill;
      add("hole", "Holes", p.n, p.fp, [dx === dy ? { k: "ring", cx: p.p[0], cy: p.p[1], r: dx / 2, ri: 0 } : { k: "box", cx: p.p[0], cy: p.p[1], hx: dx / 2, hy: dy / 2, a, c: Math.min(dx, dy) / 2 }], it);
    }
  }
  for (const v of board.vias) {
    const it = item++;
    add("via", "Vias", v.n, -1, [{ k: "ring", cx: v.p[0], cy: v.p[1], r: v.d / 2, ri: 0 }], it);
    add("hole", "Holes", v.n, -1, [{ k: "ring", cx: v.p[0], cy: v.p[1], r: v.drill / 2, ri: 0 }], it);
  }
  for (const g of board.graphics) {
    let parts;
    if (g.k === "line") parts = [{ k: "seg", x1: g.pts[0][0], y1: g.pts[0][1], x2: g.pts[1][0], y2: g.pts[1][1], w: g.w || 0.05 }];
    else if (g.k === "arc") parts = [{ k: "path", pts: arcPoints(g.a, g.m, g.b), w: g.w || 0.05, closed: false }];
    else if (g.k === "circle") parts = g.fill ? [{ k: "ring", cx: g.c[0], cy: g.c[1], r: g.r + g.w / 2, ri: 0 }] : [{ k: "ring", cx: g.c[0], cy: g.c[1], r: g.r + (g.w || 0.05) / 2, ri: Math.max(0, g.r - (g.w || 0.05) / 2) }];
    else if (g.k === "poly") parts = g.fill ? [{ k: "poly", rings: [g.pts.flat()] }, ...(g.w > 0 ? [{ k: "path", pts: g.pts.flat(), w: g.w, closed: true }] : [])] : [{ k: "path", pts: g.pts.flat(), w: g.w || 0.05, closed: true }];
    if (parts) add("graphic", g.l, 0, g.fp ?? -1, parts);
  }
  for (const t of board.texts) {
    const layer = t.designator ? "Designators" : t.l;
    if (!t.designator && t.hidden) continue;
    const paths = strokeText(t.t, t.p[0], t.p[1], t.s, -t.r * DEG, t.mirror);
    const o = paths.length ? add("text", layer, 0, t.fp ?? -1, [{ k: "text", paths, w: Math.max(t.th, t.s * 0.1) }]) : undefined;
    if (o) o.label = { t: t.t, x: t.p[0], y: t.p[1], s: t.s, r: -t.r };
  }

  const byNet = new Map();
  const byFp = new Map();
  for (const o of objects) {
    if (o.n) (byNet.get(o.n) ?? byNet.set(o.n, []).get(o.n)).push(o.id);
    if (o.fp >= 0) (byFp.get(o.fp) ?? byFp.set(o.fp, []).get(o.fp)).push(o.id);
  }
  const pickable = objects.filter((o) => o.type !== "graphic" && o.type !== "text" && o.type !== "hole");
  const index = new Flatbush(pickable.length);
  for (const o of pickable) index.add(o.box[0], o.box[1], o.box[2], o.box[3]);
  index.finish();
  const [bx0, by0, bx1, by1] = board.box;
  return { board, box: [bx0, by0, bx1, by1], layers, objects, byNet, byFp, index, pickable, nets: board.nets };
}

// ---------- picking ----------
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
function inRings(px, py, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
export function partHit(p, x, y) {
  switch (p.k) {
    case "seg": return segDist(x, y, p.x1, p.y1, p.x2, p.y2) <= p.w / 2;
    case "path": {
      const q = p.pts;
      for (let i = 0; i + 3 < q.length; i += 2) if (segDist(x, y, q[i], q[i + 1], q[i + 2], q[i + 3]) <= p.w / 2) return true;
      return false;
    }
    case "box": {
      const c = Math.cos(-p.a), s = Math.sin(-p.a);
      const lx = (x - p.cx) * c - (y - p.cy) * s, ly = (x - p.cx) * s + (y - p.cy) * c;
      const qx = Math.abs(lx) - p.hx + p.c, qy = Math.abs(ly) - p.hy + p.c;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - p.c <= 0;
    }
    case "ring": {
      const d = Math.hypot(x - p.cx, y - p.cy);
      return d <= p.r && d >= p.ri;
    }
    case "poly": return inRings(x, y, p.rings);
    default: return false;
  }
}
export const objectHit = (o, x, y) => o.parts.some((p) => partHit(p, x, y));

const TYPE_RANK = { via: 3, pad: 2, track: 1, zone: 0 };
/** The topmost pickable object under (x, y) mm: highest drawn layer, then via > pad > track > zone. */
export function pick(scene, x, y, visible) {
  const ids = scene.index.search(x, y, x, y);
  let best;
  for (const k of ids) {
    const o = scene.pickable[k];
    if (visible && !visible[o.L]) continue;
    if (best && !above(o, best)) continue;
    if (objectHit(o, x, y)) best = o;
  }
  return best;
}
const above = (o, b) => o.L !== b.L ? o.L > b.L : TYPE_RANK[o.type] !== TYPE_RANK[b.type] ? TYPE_RANK[o.type] > TYPE_RANK[b.type] : o.id > b.id;
/** The same answer by testing every object (to check the index). */
export function pickBrute(scene, x, y) {
  let best;
  for (const o of scene.pickable) {
    if (best && !above(o, best)) continue;
    if (objectHit(o, x, y)) best = o;
  }
  return best;
}

/** Flatten to rotated rounded boxes (for instanced renderers): capsules become boxes with c = w/2. */
export function toBoxes(part, out, fp, n) {
  const push = (cx, cy, hx, hy, a, c, ri) => out.push(cx, cy, hx, hy, a, c, ri, n, fp);
  switch (part.k) {
    case "seg": {
      const dx = part.x2 - part.x1, dy = part.y2 - part.y1;
      const len = Math.hypot(dx, dy), h = part.w / 2;
      push((part.x1 + part.x2) / 2, (part.y1 + part.y2) / 2, len / 2 + h, h, Math.atan2(dy, dx), h, 0);
      return;
    }
    case "path": case "text": {
      const lists = part.k === "text" ? part.paths : [part.closed ? [...part.pts, part.pts[0], part.pts[1]] : part.pts];
      for (const q of lists) for (let i = 0; i + 3 < q.length; i += 2) toBoxes({ k: "seg", x1: q[i], y1: q[i + 1], x2: q[i + 2], y2: q[i + 3], w: part.w }, out, fp, n);
      return;
    }
    case "box": push(part.cx, part.cy, part.hx, part.hy, part.a, part.c, 0); return;
    case "ring": push(part.cx, part.cy, part.r, part.r, 0, part.r, part.ri); return;
    default: return;
  }
}

export { circlePoly };

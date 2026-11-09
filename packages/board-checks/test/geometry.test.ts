/** The geometry kernel: exact primitive distances, grown shapes, polygons with holes, the grid. Property tests compare against brute force. */
import { describe, expect, it } from "vitest";
import { mm } from "@protoboardai/board";
import {
  arcShape,
  circleOutline,
  closest,
  coreDistance,
  flattenContour,
  GridIndex,
  makeArc,
  ovalShape,
  pointInPoly,
  pointShape,
  polyCore,
  polygonsOverlap,
  primDist,
  rectShape,
  segShape,
  shape,
  shapeGap,
  type Core,
  type PolyCore,
} from "../src/index.js";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- brute-force reference (independent of src)

/** Points sampled on a core (boundary, and interior for polygons), with the sampling spacing. */
function samples(c: Core, n: number): { pts: [number, number][]; spacing: number } {
  const pts: [number, number][] = [];
  let spacing = 0;
  const seg = (ax: number, ay: number, bx: number, by: number, k: number) => {
    for (let i = 0; i <= k; i++) pts.push([ax + ((bx - ax) * i) / k, ay + ((by - ay) * i) / k]);
    spacing = Math.max(spacing, Math.hypot(bx - ax, by - ay) / k);
  };
  if (c.t === "pt") pts.push([c.x, c.y]);
  else if (c.t === "seg") seg(c.ax, c.ay, c.bx, c.by, n);
  else if (c.t === "arc") {
    for (let i = 0; i <= n; i++) {
      const a = c.a0 + (c.sw * i) / n;
      pts.push([c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)]);
    }
    spacing = (Math.abs(c.sw) * c.r) / n;
  } else {
    for (const r of c.rings)
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        seg(r[i], r[i + 1], r[j], r[j + 1], Math.max(4, Math.ceil(n / 8)));
      }
  }
  return { pts, spacing };
}

function refPtSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax,
    vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
function refInside(p: PolyCore, x: number, y: number): boolean {
  let inside = false;
  for (const r of p.rings)
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const [ax, ay, bx, by] = [r[i], r[i + 1], r[j], r[j + 1]];
      if (ay > y !== by > y && ax + ((y - ay) * (bx - ax)) / (by - ay) > x) inside = !inside;
    }
  return inside;
}
/** Distance from a point to a core: exact for points, segments and polygons; dense sampling for arcs (an upper bound). */
function refPointCore(x: number, y: number, c: Core): number {
  if (c.t === "pt") return Math.hypot(x - c.x, y - c.y);
  if (c.t === "seg") return refPtSeg(x, y, c.ax, c.ay, c.bx, c.by);
  if (c.t === "arc") {
    let best = Infinity;
    const n = 2000;
    for (let i = 0; i <= n; i++) {
      const a = c.a0 + (c.sw * i) / n;
      best = Math.min(best, Math.hypot(x - c.cx - c.r * Math.cos(a), y - c.cy - c.r * Math.sin(a)));
    }
    return best;
  }
  if (refInside(c, x, y)) return 0;
  let best = Infinity;
  for (const r of c.rings)
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      best = Math.min(best, refPtSeg(x, y, r[i], r[i + 1], r[j], r[j + 1]));
    }
  return best;
}
function refDistance(a: Core, b: Core): { d: number; err: number } {
  const sa = samples(a, 300);
  const sb = samples(b, 300);
  let d = Infinity;
  for (const [x, y] of sa.pts) d = Math.min(d, refPointCore(x, y, b));
  for (const [x, y] of sb.pts) d = Math.min(d, refPointCore(x, y, a));
  const arcErr = (c: Core) => (c.t === "arc" ? (Math.abs(c.sw) * c.r) / 2000 : 0);
  // a polygon's interior is not sampled; containment shows as zero through refInside
  return { d, err: Math.max(sa.spacing, sb.spacing) + arcErr(a) + arcErr(b) + 2 };
}

// ---------------------------------------------------------------- random cores

const R = 5_000_000;
function randCore(rand: () => number, kind: "pt" | "seg" | "arc" | "poly" | "holed"): Core {
  const c = () => Math.round((rand() * 2 - 1) * R);
  if (kind === "pt") return { t: "pt", x: c(), y: c() };
  if (kind === "seg") return { t: "seg", ax: c(), ay: c(), bx: c(), by: c() };
  if (kind === "arc") {
    const cx = c(),
      cy = c();
    const r = 100_000 + rand() * 3_000_000;
    const a0 = rand() * Math.PI * 2;
    const sw = (rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 5.8);
    return makeArc(cx, cy, r, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a0 + sw), cy + r * Math.sin(a0 + sw), sw);
  }
  const cx = c(),
    cy = c();
  const n = 3 + Math.floor(rand() * 7);
  const star = (scale: number) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = (0.5 + rand()) * 2_000_000 * scale;
      pts.push(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
    }
    return pts;
  };
  if (kind === "poly") return polyCore([star(1)]);
  // a hole well inside the outer star (the outer's smallest radius is 0.5 x 2 mm)
  const outer = star(1);
  const hole: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    hole.push(Math.round(cx + 600_000 * Math.cos(a)), Math.round(cy + 600_000 * Math.sin(a)));
  }
  return polyCore([outer, hole]);
}

describe("primitive distances", () => {
  const out = closest();
  it("point, segment and arc cases with known answers", () => {
    expect(primDist({ t: "pt", x: 0, y: 0 }, { t: "seg", ax: -10, ay: 5, bx: 10, by: 5 }, out)).toBe(5);
    expect(primDist({ t: "seg", ax: 0, ay: 0, bx: 10, by: 10 }, { t: "seg", ax: 0, ay: 10, bx: 10, by: 0 }, out)).toBe(0);
    expect(out).toMatchObject({ ax: 5, ay: 5 });
    const quarter = makeArc(0, 0, 10, 10, 0, 0, 10, Math.PI / 2);
    expect(primDist({ t: "pt", x: 20, y: 0 }, quarter, out)).toBeCloseTo(10, 9);
    // a point opposite the arc: nearest is an endpoint
    expect(primDist({ t: "pt", x: -20, y: 0 }, quarter, out)).toBeCloseTo(Math.hypot(20, 10), 9);
    // the center is r from every arc point
    expect(primDist({ t: "pt", x: 0, y: 0 }, quarter, out)).toBe(10);
    // a segment crossing the arc
    expect(primDist({ t: "seg", ax: 5, ay: 5, bx: 20, by: 20 }, quarter, out)).toBe(0);
    // a segment tangent-near the arc, outside: the foot of the perpendicular
    expect(primDist({ t: "seg", ax: 0, ay: 15, bx: 15, by: 0 }, quarter, out)).toBeCloseTo(15 / Math.SQRT2 - 10, 9);
    // a segment inside the circle, not touching
    expect(primDist({ t: "seg", ax: 1, ay: 1, bx: 2, by: 2 }, quarter, out)).toBeCloseTo(10 - Math.hypot(2, 2), 9);
    // two concentric arcs with overlapping spans
    expect(primDist(quarter, makeArc(0, 0, 13, 0, 13, -13, 0, Math.PI / 2), out)).toBeCloseTo(3, 9);
    // two arcs facing along the center line
    const left = makeArc(0, 0, 5, 0, -5, 0, 5, Math.PI);
    const right = makeArc(20, 0, 5, 20, 5, 20, -5, Math.PI);
    expect(primDist(left, right, out)).toBeCloseTo(10, 9);
  });

  it("full circles (stroked circle graphics) span every direction", () => {
    const c = circleOutline(0, 0, mm(1), 0);
    expect(coreDistance(c.core, { t: "pt", x: mm(3), y: 0 })).toBeCloseTo(mm(2), 3);
    expect(coreDistance(c.core, { t: "pt", x: 0, y: -mm(3) })).toBeCloseTo(mm(2), 3);
  });

  const kinds = ["pt", "seg", "arc", "poly", "holed"] as const;
  for (const ka of kinds)
    for (const kb of kinds) {
      if (kinds.indexOf(kb) < kinds.indexOf(ka)) continue;
      it(`matches brute force: ${ka} to ${kb}`, () => {
        const rand = rng(1000 + kinds.indexOf(ka) * 10 + kinds.indexOf(kb));
        for (let trial = 0; trial < 30; trial++) {
          const a = randCore(rand, ka);
          const b = randCore(rand, kb);
          const ours = coreDistance(a, b);
          const ref = refDistance(a, b);
          // the reference samples, so it can only be at or above the true distance, by at most its spacing
          expect(ours).toBeLessThanOrEqual(ref.d + 1e-6);
          expect(ours).toBeGreaterThanOrEqual(ref.d - ref.err);
          expect(coreDistance(b, a)).toBeCloseTo(ours, 3);
        }
      });
    }
});

function translate(c: Core, dx: number, dy: number): Core {
  if (c.t === "pt") return { t: "pt", x: c.x + dx, y: c.y + dy };
  if (c.t === "seg") return { t: "seg", ax: c.ax + dx, ay: c.ay + dy, bx: c.bx + dx, by: c.by + dy };
  if (c.t === "arc") return makeArc(c.cx + dx, c.cy + dy, c.r, c.sx + dx, c.sy + dy, c.ex + dx, c.ey + dy, c.sw);
  return polyCore(c.rings.map((r) => Array.from(r, (v, i) => v + (i % 2 ? dy : dx))));
}

describe("primitive distances near contact", () => {
  // shapes placed within half a millimeter of each other, where a wrong candidate set would show
  const kinds = ["pt", "seg", "arc", "poly", "holed"] as const;
  for (const ka of kinds)
    for (const kb of kinds) {
      if (kinds.indexOf(kb) < kinds.indexOf(ka)) continue;
      it(`matches brute force when close: ${ka} to ${kb}`, () => {
        const rand = rng(5000 + kinds.indexOf(ka) * 10 + kinds.indexOf(kb));
        for (let trial = 0; trial < 20; trial++) {
          const a = randCore(rand, ka);
          let b = randCore(rand, kb);
          const sa = samples(a, 50).pts;
          const sb = samples(b, 50).pts;
          const [px, py] = sa[Math.floor(rand() * sa.length)];
          const [qx, qy] = sb[Math.floor(rand() * sb.length)];
          const ang = rand() * Math.PI * 2;
          const off = rand() * 500_000;
          b = translate(b, px - qx + off * Math.cos(ang), py - qy + off * Math.sin(ang));
          const ours = coreDistance(a, b);
          const ref = refDistance(a, b);
          expect(ours).toBeLessThanOrEqual(ref.d + 1e-6);
          expect(ours).toBeGreaterThanOrEqual(ref.d - ref.err);
        }
      });
    }
});

describe("grown shapes", () => {
  it("subtracts both radii and clamps at zero", () => {
    const a = segShape(0, 0, mm(10), 0, mm(0.1));
    const b = pointShape(mm(5), mm(1), mm(0.2));
    expect(shapeGap(a, b)).toBeCloseTo(mm(0.7), 6);
    expect(shapeGap(a, pointShape(mm(5), mm(0.25), mm(0.2)))).toBe(0);
  });

  it("a gap above the limit is not measured", () => {
    const a = pointShape(0, 0, 0);
    const b = pointShape(mm(10), 0, 0);
    expect(shapeGap(a, b, mm(1))).toBeGreaterThan(mm(1));
    expect(shapeGap(a, b, mm(20))).toBe(mm(10));
  });

  it("rotated rectangles, rounded rectangles and ovals", () => {
    const r = rectShape(0, 0, mm(2), mm(1), Math.PI / 2);
    // rotated a quarter turn: 1 wide, 2 tall
    expect(shapeGap(r, pointShape(mm(1.5), 0, 0))).toBeCloseTo(mm(1), 3);
    expect(shapeGap(r, pointShape(0, mm(1.5), 0))).toBeCloseTo(mm(0.5), 3);
    const rr = rectShape(0, 0, mm(1.6), mm(0.6), 0, mm(0.2));
    // the corner is rounded: a point on the diagonal is farther than from a sharp corner
    const corner = pointShape(mm(1.0 + 0.1), mm(0.5 + 0.1), 0);
    expect(shapeGap(rr, corner)).toBeCloseTo(Math.hypot(mm(0.3), mm(0.3)) - mm(0.2), 0);
    const ov = ovalShape(0, 0, mm(1), mm(3), 0);
    expect(ov.r).toBe(mm(0.5));
    expect(shapeGap(ov, pointShape(0, mm(2), 0))).toBeCloseTo(mm(0.5), 3);
  });

  it("a polygon with a hole: inside the hole is outside the copper", () => {
    const p = polyCore([
      [0, 0, mm(10), 0, mm(10), mm(10), 0, mm(10)],
      [mm(4), mm(4), mm(6), mm(4), mm(6), mm(6), mm(4), mm(6)],
    ]);
    expect(pointInPoly(p, mm(5), mm(5))).toBe(false);
    expect(pointInPoly(p, mm(2), mm(5))).toBe(true);
    expect(shapeGap(shape(p), pointShape(mm(5), mm(5), mm(0.5)))).toBeCloseTo(mm(0.5), 3);
    expect(shapeGap(shape(p), pointShape(mm(5), mm(5), mm(1.5)))).toBe(0);
    // a segment fully inside the copper
    expect(shapeGap(shape(p), segShape(mm(1), mm(1), mm(2), mm(1), 0))).toBe(0);
  });

  it("large polygons use the edge grid and agree with the plain scan", () => {
    const n = 400;
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = mm(10) + (i % 2 ? mm(1) : 0);
      ring.push(Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)));
    }
    const big = polyCore([ring]);
    const rand = rng(7);
    for (let k = 0; k < 200; k++) {
      const x = (rand() * 2 - 1) * mm(14);
      const y = (rand() * 2 - 1) * mm(14);
      const ours = coreDistance(big, { t: "pt", x, y });
      expect(ours).toBeCloseTo(refPointCore(x, y, big), 3);
    }
  });

  it("arc tracks are exact (not flattened)", () => {
    const a = arcShape(P(10, 0), P(0, 10), 90_000, mm(0.1));
    // a point at the arc's middle direction, 1 mm outside the centerline
    const m = Math.SQRT1_2 * mm(11);
    expect(shapeGap(a, pointShape(m, m, 0))).toBeCloseTo(mm(0.9), 0);
  });

  it("flattens contour arcs within the tolerance", () => {
    // a half disc: an arc below the x axis from (-5, 0) to (5, 0), then the straight edge back
    const pts = flattenContour([{ ...P(-5, 0), sweep: 180_000 }, P(5, 0)], undefined, true, 500);
    expect(pts.length / 2).toBeGreaterThan(20);
    const r = mm(5);
    for (let i = 0; i < pts.length; i += 2) {
      expect(Math.abs(Math.hypot(pts[i], pts[i + 1]) - r)).toBeLessThan(2);
      expect(pts[i + 1]).toBeLessThanOrEqual(1);
      if (i + 2 < pts.length) {
        const c = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        expect(r - Math.sqrt(r * r - (c / 2) ** 2)).toBeLessThanOrEqual(500.5);
      }
    }
  });

  it("positive-area overlap: crossing and nesting count, touching does not", () => {
    const sq = (x: number, y: number, s: number) => polyCore([[mm(x), mm(y), mm(x + s), mm(y), mm(x + s), mm(y + s), mm(x), mm(y + s)]]);
    expect(polygonsOverlap(sq(0, 0, 2), sq(1, 1, 2))).toBeDefined();
    expect(polygonsOverlap(sq(0, 0, 2), sq(2, 0, 2))).toBeUndefined();
    expect(polygonsOverlap(sq(0, 0, 2), sq(2, 2, 2))).toBeUndefined();
    expect(polygonsOverlap(sq(0, 0, 4), sq(1, 1, 1))).toBeDefined();
    expect(polygonsOverlap(sq(0, 0, 2), sq(0, 0, 2))).toBeDefined();
  });
});

function P(x: number, y: number) {
  return { x: mm(x), y: mm(y) };
}

describe("grid index", () => {
  it("returns exactly the boxes that meet the query, through inserts and removes", () => {
    const rand = rng(3);
    const g = new GridIndex(mm(1), 64);
    const boxes = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (let i = 0; i < 2000; i++) {
      const x = rand() * mm(50),
        y = rand() * mm(50);
      const big = rand() < 0.02;
      const w = big ? mm(30) : rand() * mm(2);
      const h = big ? mm(30) : rand() * mm(2);
      const b = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      boxes.set(i, b);
      g.insert(i, b);
    }
    for (let i = 0; i < 2000; i += 3) {
      g.remove(i);
      boxes.delete(i);
    }
    for (let q = 0; q < 200; q++) {
      const x = rand() * mm(50),
        y = rand() * mm(50);
      const qb = { minX: x, minY: y, maxX: x + rand() * mm(5), maxY: y + rand() * mm(5) };
      const want = [...boxes].filter(([, b]) => b.minX <= qb.maxX && qb.minX <= b.maxX && b.minY <= qb.maxY && qb.minY <= b.maxY).map(([i]) => i).sort((a, b) => a - b);
      expect(g.search(qb)).toEqual(want);
    }
    expect(g.size).toBe(boxes.size);
  });
});


/** The integer polygon boolean engine and growth by a radius: known answers and area identities. */
import { describe, expect, it } from "vitest";
import { clip, grow, polygonsArea, ringArea, unionRings, type Polygon, type Ring } from "../src/index.js";
import { prng } from "./helpers.js";

const sq = (x: number, y: number, s: number): Ring => [x, y, x + s, y, x + s, y + s, x, y + s];
const A = (p: Polygon[]) => polygonsArea(p);

describe("clip", () => {
  it("unites overlapping squares and keeps the outer ring counterclockwise", () => {
    const u = unionRings([sq(0, 0, 10), sq(5, 5, 10)]);
    expect(u).toHaveLength(1);
    expect(A(u)).toBe(175);
    expect(ringArea(u[0].outer)).toBeGreaterThan(0);
  });

  it("cuts a hole, clockwise, owned by its outer ring", () => {
    const d = clip([{ rings: [sq(0, 0, 10)] }, { rings: [sq(3, 3, 4)] }], (i) => i[0] && !i[1]);
    expect(d).toHaveLength(1);
    expect(d[0].holes).toHaveLength(1);
    expect(ringArea(d[0].holes[0])).toBe(-16);
    expect(A(d)).toBe(84);
  });

  it("merges squares sharing an edge and separates squares touching at a corner", () => {
    expect(unionRings([sq(0, 0, 10), sq(10, 0, 10)])).toHaveLength(1);
    expect(A(unionRings([sq(0, 0, 10), sq(10, 0, 10)]))).toBe(200);
    const corner = unionRings([sq(0, 0, 10), sq(10, 10, 10)]);
    expect(corner).toHaveLength(2);
    expect(A(corner)).toBe(200);
  });

  it("handles collinear overlaps, T-junctions and repeated rings", () => {
    const u = unionRings([sq(0, 0, 10), [0, 0, 10, 0, 10, 4, 0, 4], sq(0, 0, 10), [4, 10, 6, 10, 6, 14, 4, 14]]);
    expect(A(u)).toBe(108);
    expect(u).toHaveLength(1);
  });

  it("reads the positive rule: a clockwise ring alone is outside", () => {
    const cw = [0, 0, 0, 10, 10, 10, 10, 0];
    expect(clip([{ rings: [cw], rule: "positive" }], (i) => i[0])).toHaveLength(0);
    expect(A(clip([{ rings: [cw], rule: "nonzero" }], (i) => i[0]))).toBe(100);
  });

  it("intersection, union, difference and exclusive or agree on random polygons (area identities)", () => {
    const rnd = prng(11);
    const star = (cx: number, cy: number): Ring => {
      const n = 5 + Math.floor(rnd() * 20);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        const r = 2e6 + rnd() * 6e6;
        out.push(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
      }
      return out;
    };
    for (let k = 0; k < 40; k++) {
      const a = [star(rnd() * 4e6, rnd() * 4e6), star(rnd() * 4e6, rnd() * 4e6)];
      const b = [star(rnd() * 4e6, rnd() * 4e6)];
      const u = A(clip([{ rings: a }, { rings: b }], (i) => i[0] || i[1]));
      const n = A(clip([{ rings: a }, { rings: b }], (i) => i[0] && i[1]));
      const da = A(clip([{ rings: a }, { rings: b }], (i) => i[0] && !i[1]));
      const x = A(clip([{ rings: a }, { rings: b }], (i) => i[0] !== i[1]));
      const aa = A(unionRings(a));
      const bb = A(unionRings(b));
      // rounding moves a crossing by under a nanometer: allow a nanometer per micrometer of boundary
      const tol = 1e-6 * (aa + bb) + 1e8;
      expect(Math.abs(u + n - aa - bb)).toBeLessThan(tol);
      expect(Math.abs(da + n - aa)).toBeLessThan(tol);
      expect(Math.abs(x - (u - n))).toBeLessThan(tol);
    }
  });

  it("is deterministic: the same input gives the same output", () => {
    const rings = [sq(0, 0, 1000), sq(333, 217, 1001), [100, 100, 900, 150, 400, 950]];
    expect(JSON.stringify(unionRings(rings))).toBe(JSON.stringify(unionRings(rings)));
  });
});

describe("grow", () => {
  it("grows a square by a radius with round corners (circumscribed: never less than exact)", () => {
    const s = 10_000_000;
    const r = 1_000_000;
    const g = grow(unionRings([sq(0, 0, s)]), r, 5000);
    const exact = s * s + 4 * s * r + Math.PI * r * r;
    expect(A(g)).toBeGreaterThanOrEqual(exact - 4 * s);
    expect(A(g)).toBeLessThan(exact + 2 * Math.PI * (r + 5000) * 5000 + 4 * s);
  });

  it("shrinks holes and closes holes narrower than twice the radius", () => {
    const p = clip([{ rings: [sq(0, 0, 20_000_000)] }, { rings: [sq(5_000_000, 5_000_000, 4_000_000), sq(12_000_000, 12_000_000, 1_000_000)] }], (i) => i[0] && !i[1]);
    const g = grow(p, 1_000_000, 5000);
    expect(g).toHaveLength(1);
    expect(g[0].holes).toHaveLength(1);
    expect(Math.abs(ringArea(g[0].holes[0]))).toBe(2_000_000 * 2_000_000);
  });
});

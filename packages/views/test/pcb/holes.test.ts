/**
 * Areas with holes (a ring keep-out, a zone around a cut-out): the renderer's scene draws the holes, hatches only
 * the ring, and does not pick inside a hole; an area that blocks nothing (a rule area) is drawn as its outline.
 */
import { describe, expect, it } from "vitest";
import { createDocument, mm, type BoardRecord } from "@protoboardai/board";
import { buildScene } from "../../src/pcb/scene.js";

const sq = (h: number) => [
  { x: mm(-h), y: mm(-h) },
  { x: mm(h), y: mm(-h) },
  { x: mm(h), y: mm(h) },
  { x: mm(-h), y: mm(h) },
];
const P = { by: "hand" as const };
const base: BoardRecord[] = [
  { kind: "board", id: "board", name: "Holes", thickness: mm(1.6), copper_layers: 2, origin: "center" },
  { kind: "outline", id: "outline", outline: sq(20), source: { kind: "board" }, provenance: P },
];
const keepout = (id: string, blocks: boolean, holes?: ReturnType<typeof sq>[]): BoardRecord =>
  ({ kind: "keepout", id, layers: ["top"], outline: sq(10), ...(holes ? { holes } : {}), blocks: { tracks: blocks, vias: blocks, pours: blocks, footprints: false }, tier: "no_go", provenance: P }) as BoardRecord;

describe("areas with holes", () => {
  it("hatch only the ring of a ring keep-out, and draw the hole's edge", () => {
    const scene = buildScene(createDocument([...base, keepout("kpo:ring", true, [sq(5)])]));
    const parts = scene.objects.get("kpo:ring")!.items[0].parts;
    expect(parts.filter((p) => p.k === "path")).toHaveLength(2);
    const segs = parts.filter((p): p is Extract<typeof p, { k: "seg" }> => p.k === "seg");
    expect(segs.length).toBeGreaterThan(0);
    // no hatch segment's midpoint lies inside the hole (mm)
    for (const s of segs) {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      expect(Math.abs(mx) < 4.99 && Math.abs(my) < 4.99).toBe(false);
    }
    // the hatch covers the ring: three quarters of the full square's hatch length
    const length = (ps: typeof parts) => ps.reduce((n, p) => n + (p.k === "seg" ? Math.hypot(p.x2 - p.x1, p.y2 - p.y1) : 0), 0);
    const plain = buildScene(createDocument([...base, keepout("kpo:full", true)]));
    expect(length(parts) / length(plain.objects.get("kpo:full")!.items[0].parts)).toBeCloseTo(0.75, 1);
  });
  it("draw a rule area that blocks nothing as its outline, without hatch", () => {
    const scene = buildScene(createDocument([...base, keepout("kpo:rule", false)]));
    expect(scene.objects.get("kpo:rule")!.items[0].parts.every((p) => p.k === "path")).toBe(true);
  });
  it("draw a zone's holes and leave them out of its pick shape", () => {
    const zone = { kind: "zone", id: "zone:ring", net: "GND", layers: ["top"], outline: sq(10), holes: [sq(5)], priority: 0, fill_mode: "solid", pad_connection: "solid", provenance: P } as unknown as BoardRecord;
    const scene = buildScene(createDocument([...base, zone]));
    const o = scene.objects.get("zone:ring")!;
    expect(o.items.at(-1)!.parts.filter((p) => p.k === "path")).toHaveLength(2);
    expect(o.pick?.[0]).toMatchObject({ k: "poly" });
    expect((o.pick![0] as { rings: number[][] }).rings).toHaveLength(2);
  });
});

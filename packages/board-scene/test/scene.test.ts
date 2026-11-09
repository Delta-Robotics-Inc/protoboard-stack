/** The scene and its image together: determinism, budgets, ids, shared markers, filters, focus, diffs. */
import { describe, expect, it } from "vitest";
import { findingId, HUMAN, mm, openBoardService, type Finding } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { syntheticSixLayer } from "../src/fixtures/synthetic.js";
import { BUDGETS, buildModel, describeBoard, describeWalkthrough, diffScene, type DescribeOptions } from "../src/index.js";

const doc = airnodeC3();
const big = syntheticSixLayer().doc;

const finding: Finding = {
  id: findingId("clearance", "rule:target.clearance", ["trk:f.i2c_sda.2", "pad:mcu/module:4"], { x: mm(3.6), y: mm(4.1), layer: "top" }),
  check: "clearance",
  rule: "rule:target.clearance",
  tier: "target",
  severity: "warning",
  objects: ["pad:mcu/module:4", "trk:f.i2c_sda.2"],
  location: { x: mm(3.6), y: mm(4.1), layer: "top" },
  measured: mm(0.15),
  required: mm(0.2),
  message: "clearance 0.15 mm, target 0.2 mm",
};

const views: [string, DescribeOptions][] = [
  ["overview", {}],
  ["region", { region: [-18, 4, 0, 14], corridors: [{ from: "pad:sensor/r_sda:2", to: "pad:sensor/ic:1", layer: "top" }] }],
  ["object", { object: "fp:sensor/ic" }],
  ["net", { net: "I2C_SCL" }],
  ["finding", { finding: finding.id, findings: [finding] }],
  ["track", { object: "trk:f.usb_dp.1" }],
  ["keepout", { object: "kpo:f.antenna" }],
  ["net object", { object: "net:VBUS" }],
];

/** Every marker drawn in the image: [number, id]. */
const drawnMarkers = (svg: string): [number, string][] => [...svg.matchAll(/data-marker="(\d+)" data-id="([^"]+)"/g)].map((m) => [Number(m[1]), m[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")]);

/** Whether the scene holds an item with this id (an object with `id`, or a row whose first cell is the id). */
function holds(scene: unknown, id: string): boolean {
  if (Array.isArray(scene)) return scene[0] === id || scene.some((x) => holds(x, id));
  if (scene && typeof scene === "object") {
    const o = scene as Record<string, unknown>;
    if (o.id === id) return true;
    return Object.entries(o).some(([k, v]) => k !== "markers" && holds(v, id));
  }
  return false;
}

describe("describeBoard on the Airnode C3 fixture", () => {
  for (const [name, o] of views) {
    it(`${name}: same input, same bytes`, () => {
      const a = describeBoard(doc, o);
      const b = describeBoard(airnodeC3(), o);
      expect(b.json).toBe(a.json);
      expect(b.svg).toBe(a.svg);
    });
    it(`${name}: every marker in the image is an item in the JSON with the same number`, () => {
      const r = describeBoard(doc, o);
      const drawn = drawnMarkers(r.svg!);
      expect(drawn).toEqual(r.scene.markers);
      expect(drawn.map(([n]) => n)).toEqual(drawn.map((_, i) => i + 1));
      for (const [n, id] of drawn) {
        expect(holds(r.scene, id), `marker ${n} ${id}`).toBe(true);
        const item = JSON.stringify(r.scene).includes(`"m":${n}`) || !!(r.scene.rats as unknown[] | undefined)?.some((x) => Array.isArray(x) && x[0] === id);
        expect(item, `marker ${n} carried on its item`).toBe(true);
      }
    });
    it(`${name}: within its budget, ids from the core`, () => {
      const r = describeBoard(doc, o);
      expect(r.json.length).toBeLessThanOrEqual(BUDGETS[r.scene.detail as keyof typeof BUDGETS]);
      for (const f of (r.scene.footprints as ({ id: string } | string[])[] | undefined) ?? []) expect(doc.records.has(Array.isArray(f) ? f[0] : f.id)).toBe(true);
    });
  }

  it("answers the questions an agent asks", () => {
    const ov = describeBoard(doc).scene as { nets: { name: string; status: string; missing?: number }[]; footprints: { ref: string; near: Record<string, [string, number]> }[] };
    // unrouted nets: no copper at all
    expect(ov.nets.filter((n) => n.status === "unrouted").map((n) => n.name)).toEqual(["BOOT", "CC1", "CC2", "EN", "LED1", "LED1_A", "LED2", "LED2_A"]);
    // the I2C clock runs on the bottom between two top pads with no vias: partial
    expect(ov.nets.find((n) => n.name === "I2C_SCL")).toMatchObject({ status: "partial", missing: 2 });
    // nearest part left of U3: R3, 1.5 mm edge to edge (U3's courtyard starts at x = -5.2, R3's ends at -6.7)
    expect(ov.footprints.find((f) => f.ref === "U3")!.near.left).toEqual(["R3", 1.5]);
    // a free channel on the top layer from R3 pad 2 to U3 pad 1
    const region = describeBoard(doc, views[1][1]).scene as { corridors: { found: boolean; len: number; maxWidth: number }[] };
    expect(region.corridors[0].found).toBe(true);
    expect(region.corridors[0].len).toBeGreaterThan(2.2);
    expect(region.corridors[0].len).toBeLessThan(2.5);
  });

  it("filters by net and layer", () => {
    const r = describeBoard(doc, { net: "I2C_SDA", layers: ["top"] }).scene as { tracks: { net: string; layer: string }[]; nets: { name: string }[] };
    expect(r.tracks.every((t) => t.net === "I2C_SDA" && t.layer === "top")).toBe(true);
    expect(r.nets.map((n) => n.name)).toEqual(["I2C_SDA"]);
    const k = describeBoard(doc, { kinds: ["footprint"] }).scene;
    expect(k.nets).toBeUndefined();
    expect(k.footprints).toBeDefined();
  });

  it("gives every track segment on request", () => {
    const r = describeBoard(doc, { region: [-20, -15, 20, 15], tracks: "segments" }).scene as { tracks: { id: string }[] };
    expect(r.tracks.map((t) => t.id).sort()).toEqual([...doc.records.values()].filter((x) => x.kind === "track").map((x) => x.id).sort());
  });

  it("describes a finding with its objects and rings it in the image", () => {
    const r = describeBoard(doc, { finding: finding.id, findings: [finding] });
    expect(r.scene.focus).toMatchObject({ kind: "finding", check: "clearance", measured: 0.15, required: 0.2 });
    expect(r.scene.markers).toContainEqual([1, finding.id]);
    expect(r.svg).toContain(`data-marker="1" data-id="${finding.id}"`);
  });

  it("walks the board in tiles", () => {
    const tiles = describeWalkthrough(doc, { cols: 3, rows: 2, image: "none" });
    expect(tiles.map((t) => t.tile.name)).toEqual(["A1", "B1", "C1", "A2", "B2", "C2"]);
    for (const t of tiles) expect(t.result.json.length).toBeLessThanOrEqual(BUDGETS.region);
  });
});

describe("the synthetic six-layer board", () => {
  const m = buildModel(big);
  it("is about a thousand segments on six layers", () => {
    expect(m.copper).toEqual(["top", "inner1", "inner2", "inner3", "inner4", "bottom"]);
    expect(m.tracks.length).toBeGreaterThanOrEqual(950);
    expect(m.tracks.length).toBeLessThanOrEqual(1100);
  });
  for (const [name, o] of [
    ["overview", {}],
    ["region", { region: [-40, 5, -20, 25] }],
    ["object", { object: "fp:U2" }],
    ["net", { net: "SIG010" }],
  ] as [string, DescribeOptions][]) {
    it(`${name}: stays in its budget, says what it cut, and is deterministic`, () => {
      const a = describeBoard(m, o);
      const b = describeBoard(buildModel(syntheticSixLayer().doc), o);
      expect(b.json).toBe(a.json);
      expect(b.svg).toBe(a.svg);
      expect(a.json.length).toBeLessThanOrEqual(BUDGETS[a.scene.detail as keyof typeof BUDGETS]);
      const drawn = drawnMarkers(a.svg!);
      expect(drawn).toEqual(a.scene.markers);
      for (const [, id] of drawn) expect(holds(a.scene, id)).toBe(true);
    });
  }
});

describe("diffScene", () => {
  it("describes a move and a new track, with an image of the change", () => {
    const svc = openBoardService({ document: airnodeC3() });
    const before = svc.snapshot();
    const reply = svc.apply(
      {
        batchId: "t1",
        label: "move sensor and route a pull-up",
        ops: [
          { op: "footprint.move", ids: ["fp:sensor/ic"], dx: mm(1), dy: mm(-0.5), tracks: "stay" },
          { op: "track.add", segments: [{ handle: "a", net: "I2C_SDA", layer: "top", width: mm(0.2), start: { x: mm(-7.02), y: mm(9.5) }, end: { x: mm(-5.5), y: mm(9.5) } }] },
        ],
      },
      HUMAN,
    );
    expect(reply.status).toBe("applied");
    const after = svc.snapshot();
    const d = diffScene(before, after);
    const fp = (d.diff.footprints as Record<string, unknown>[])[0];
    expect(fp).toMatchObject({ id: "fp:sensor/ic", ref: "U3", change: "moved", from: [-4, 9], to: [-3, 8.5], dx: 1, dy: -0.5, m: 1 });
    expect(fp.distance).toBeCloseTo(Math.hypot(1, 0.5), 3);
    const cu = (d.diff.copper as Record<string, unknown>[]).find((c) => c.net === "I2C_SDA")!;
    expect(cu.added).toHaveLength(1);
    expect(cu.len).toEqual([{ top: 17.61 }, { top: 19.13 }]);
    expect(d.svg).toContain('data-role="ghost-before"');
    expect(drawnMarkers(d.svg!)).toEqual(d.diff.markers);
    expect(diffScene(before, after).json).toBe(d.json);
    svc.close();
  });
});

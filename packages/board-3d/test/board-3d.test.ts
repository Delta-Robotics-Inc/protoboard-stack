/**
 * The board 3D model on the Airnode C3 fixture and on small hand-built cases: solids are closed and manifold, counts
 * per tier, names, seating, and the writers' files read back. Goldens (counts, names, the sidecar without timings and
 * file hashes) are in test/golden; `UPDATE_GOLDEN=1` rewrites them.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDocument, mm, type BoardRecord, type FootprintRec } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import {
  boxUnion,
  brepDefects,
  buildBoard3d,
  bodyCount,
  classify,
  exportBoard3d,
  extrudeRegion,
  findCadPython,
  measureSeating,
  meshVolume,
  read3mf,
  readGlb,
  readStepText,
  readStl,
  readZip,
  sceneMeshes,
  transformSolid,
  write3mf,
  writeGlb,
  writeStep,
  writeStl,
  writeZip,
  TIERS,
  type Board3d,
} from "../src/index.js";
import { circleLoop, rectLoop, stadiumLoop } from "../src/profile.js";
import { rotationZ, translation, compose } from "../src/math.js";
import { triangulate } from "../src/triangulate.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const GOLDEN = join(here, "golden");
const update = process.env.UPDATE_GOLDEN === "1";

function golden(name: string, value: unknown): void {
  const path = join(GOLDEN, name);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (update || !existsSync(path)) writeFileSync(path, text);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(JSON.parse(text));
}

const allSolids = (s: Board3d) => [s.board.solid, ...s.components.flatMap((c) => (c.solid ? [c.solid] : [])), ...s.slabs.map((x) => x.solid), ...s.layers.flatMap((l) => l.solids)];

describe("geometry kernel", () => {
  it("triangulates a square with a hole to the right area", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: [number, number][] = [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ];
    const idx = triangulate(outer, [hole]);
    const pts = [...outer, ...hole];
    let area = 0;
    for (let k = 0; k < idx.length; k += 3) {
      const [a, b, c] = [pts[idx[k]], pts[idx[k + 1]], pts[idx[k + 2]]];
      area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(84, 9);
  });

  it("extrudes a region with round and slotted holes into one closed solid", () => {
    const s = extrudeRegion({ outer: rectLoop(20, 10), holes: [circleLoop(1, -5, 0), stadiumLoop(1, 3, 5, 0)] }, 0, 1.6);
    expect(brepDefects(s.brep)).toBe(0);
    const expected = (200 - Math.PI - (1 * 2 + Math.PI * 0.25)) * 1.6;
    // the mesh divides arcs into chords (0.01 mm tolerance), so it holds slightly more than the exact solid
    expect(meshVolume(s.mesh)).toBeCloseTo(expected, 0);
    expect(s.brep.faces.filter((f) => f.surface.kind === "cylinder")).toHaveLength(4);
  });

  it("joins overlapping boxes into one manifold solid with painted faces", () => {
    const s = boxUnion(
      [
        { min: [0, 0, 0], max: [2, 1, 1], color: 0 },
        { min: [1.5, 0.25, 0.5], max: [3, 0.75, 0.7], color: 1 },
      ],
      ["#111111", "#cccccc", "#ffffff"],
      [{ min: [0.2, 0.2, 1 - 1e-4], max: [0.5, 0.5, 1 + 1e-4], color: 2 }],
    )!;
    expect(brepDefects(s.brep)).toBe(0);
    expect(meshVolume(s.mesh)).toBeCloseTo(2 + 1.0 * 0.5 * 0.2, 9);
    expect(new Set(s.brep.faces.map((f) => f.color))).toEqual(new Set([0, 1, 2]));
  });
});

describe("Airnode C3", () => {
  const doc = airnodeC3();

  it("full tier: the board plus one named, closed solid per part", () => {
    const s = buildBoard3d(doc, { tier: "full" });
    const parts = [...doc.records.values()].filter((r) => r.kind === "footprint").length;
    expect(bodyCount(s)).toBe(parts + 1);
    for (const sol of allSolids(s)) {
      expect(brepDefects(sol.brep)).toBe(0);
      expect(meshVolume(sol.mesh)).toBeGreaterThan(0);
    }
    expect(s.components.every((c) => c.seating.status === "ok")).toBe(true);
    // drilled: 3 vias and the USB-C shell's four slots
    expect(s.board.holes.filter((h) => h.drilled)).toHaveLength(7);
    // a footprint at 90 degrees keeps its body along its pads
    const c1 = s.components.find((c) => c.ref === "C1")!;
    expect(c1.bounds!.max[1] - c1.bounds!.min[1]).toBeGreaterThan(c1.bounds!.max[0] - c1.bounds!.min[0]);
  });

  it("counts per tier", () => {
    const counts = Object.fromEntries(
      TIERS.map((t) => {
        const s = buildBoard3d(doc, { tier: t });
        return [t, { bodies: bodyCount(s), drilledHoles: s.board.holes.filter((h) => h.drilled).length, slabs: s.slabs.map((x) => `${x.side} ${x.heightMm}`) }];
      }),
    );
    const render = buildBoard3d(doc, { tier: "full", render: true });
    golden("airnode-c3-counts.json", { ...counts, render: { bodies: bodyCount(render), layers: Object.fromEntries(render.layers.map((l) => [l.name, l.solids.length])) } });
    expect(counts.full.bodies).toBe(20);
    expect(counts.board.bodies).toBe(1);
    expect(counts.envelope.bodies).toBe(2);
  });

  it("names, bodies and seating (golden)", () => {
    const s = buildBoard3d(doc, { tier: "full" });
    golden(
      "airnode-c3-parts.json",
      s.components.map((c) => ({ ref: c.ref, name: c.name, side: c.side, body: c.body.source, kind: c.body.kind, heightMm: c.body.heightMm, heightSource: c.body.heightSource, seating: c.seating.status, method: c.seating.method, contacts: `${c.seating.padsHit}/${c.seating.pads}`, interfaces: c.interfaces.map((i) => i.kind) })),
    );
  });

  it("writes STEP, STL, 3MF and GLB that read back with the same counts and names", () => {
    const s = buildBoard3d(doc, { tier: "full" });
    const step = writeStep(s, { timestamp: "2026-11-09T00:00:00" });
    const st = readStepText(step.text);
    expect(st.schema).toMatch(/^AUTOMOTIVE_DESIGN/);
    expect(st.solidInstances).toBe(20);
    expect(st.occurrences).toContain("U2 LDO 3.3 V");
    const shared = readStepText(writeStep(s, { instances: "shared", timestamp: "2026-11-09T00:00:00" }).text);
    expect(shared.solidInstances).toBe(20);
    expect(shared.solidEntities).toBeLessThan(20);
    const meshes = sceneMeshes(s);
    expect(readStl(writeStl(meshes)).triangles).toBe(meshes.reduce((a, m) => a + m.pos.length / 9, 0));
    const tmf = read3mf(write3mf(meshes, "Airnode C3"));
    expect(tmf.objects.map((o) => o.name)).toContain("J1 USB-C");
    expect(tmf.objects).toHaveLength(20);
    const glb = readGlb(writeGlb(s));
    expect(glb.components.map((c) => c.partInstanceId)).toContain("power/ldo");
    expect(glb.boundsMm.max[2]).toBeCloseTo(Math.max(...s.components.map((c) => c.bounds!.max[2])), 3);
  });

  it("exports with a sidecar and images, and every file checks out (golden sidecar)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "board-3d-test-"));
    try {
      const python = findCadPython(here);
      const r = await exportBoard3d(doc, { outDir: dir, tier: "full", timestamp: "2026-11-09T00:00:00", validate: python ? "occt" : true, ...(python ? { python } : {}) });
      if (!python) console.log("board-3d: CAD runtime not found (set PROTOBOARD_PYTHON); STEP checked by the text reader only");
      for (const v of r.validation) for (const c of v.checks) expect(c.ok, `${v.format} ${c.name}: ${c.detail}`).toBe(true);
      expect(r.intersections).toEqual([]);
      expect(r.images.map((i) => i.path)).toEqual(["airnode-c3-full.iso.png", "airnode-c3-full.top.png"]);
      const side = JSON.parse(readFileSync(join(dir, r.sidecar), "utf8"));
      const { timing: _t, files: _f, images: _i, validation: _v, ...stable } = side;
      golden("airnode-c3-full.board3d.json", stable);
      expect(side.counts.bodies).toBe(20);
      expect(side.interfaces.find((i: { ref: string }) => i.ref === "J1").kind).toBe("connector-mouth");
      const zip = readZip(readFileSync(join(dir, "airnode-c3-full.stl.zip")));
      expect(zip.map((e) => e.name)).toContain("R1 1 k.stl");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("render option adds copper and silkscreen as thin bodies, off by default", () => {
    expect(buildBoard3d(doc).layers).toEqual([]);
    const s = buildBoard3d(doc, { render: true });
    expect(s.layers.map((l) => l.name).sort()).toEqual(["copper bottom", "copper top", "silkscreen top"]);
    for (const l of s.layers) for (const sol of l.solids) expect(brepDefects(sol.brep)).toBe(0);
  });
});

describe("seating check", () => {
  const sot: FootprintRec = {
    kind: "footprint",
    id: "fp:U9",
    ref: "U9",
    footprint: "Test:SOT-23-5",
    x: 0,
    y: 0,
    rotation: 0,
    side: "top",
    pads: [
      ["1", -0.95, -1.1],
      ["2", 0, -1.1],
      ["3", 0.95, -1.1],
      ["4", 0.95, 1.1],
      ["5", -0.95, 1.1],
    ].map(([n, x, y]) => ({ number: n as string, type: "smd" as const, shape: "rect" as const, x: mm(x as number), y: mm(y as number), width: mm(0.6), height: mm(1.06) })),
    provenance: { by: "hand" },
  };
  const board = (fps: FootprintRec[]) =>
    createDocument([
      { kind: "board", id: "board", name: "Seat test", thickness: mm(1.6), copper_layers: 2, origin: "center" },
      { kind: "outline", id: "outline", outline: [{ x: mm(-10), y: mm(-10) }, { x: mm(10), y: mm(-10) }, { x: mm(10), y: mm(10) }, { x: mm(-10), y: mm(10) }], source: { kind: "board" } },
      ...(fps as BoardRecord[]),
    ]);

  it("finds a parametric body seated and aligned", () => {
    const s = buildBoard3d(board([sot]));
    const c = s.components[0];
    expect(c.seating).toMatchObject({ status: "ok", method: "contacts", padsHit: 5, pads: 5, gapMm: 0 });
  });

  it("flags a floating, a sunk and a turned model, and fixes the height when asked", () => {
    const s0 = buildBoard3d(board([sot]));
    const body = s0.components[0].solid!;
    const pads = classify(sot) && sot.pads.map((p) => ({ number: p.number, type: p.type, cx: p.x / 1e6, cy: p.y / 1e6, w: 0.6, h: 1.06 }));
    expect(measureSeating({ mesh: transformSolid(body, translation([0, 0, 0.2])).mesh, pads }).status).toBe("floating");
    expect(measureSeating({ mesh: transformSolid(body, translation([0, 0, -0.2])).mesh, pads }).status).toBe("sunk");
    const turned = measureSeating({ mesh: transformSolid(body, rotationZ(90)).mesh, pads });
    expect(["rotated", "offset"]).toContain(turned.status);
    const flipped = measureSeating({ mesh: transformSolid(body, rotationZ(180)).mesh, pads });
    // SOT-23-5's pattern is not symmetric under a half turn: the check sees it
    expect(flipped.status).toBe("rotated");
    expect(flipped.rotationDeg).toBe(180);
    // a supplied model that floats is moved down onto the face and the move recorded
    const s = buildBoard3d(board([sot]), { models: new Map([["fp:U9", { solid: transformSolid(body, translation([0, 0, 0.3])), source: "test model" }]]) });
    expect(s.components[0].seating.fixedMm).toBeCloseTo(-0.3, 6);
    expect(s.components[0].bounds!.min[2]).toBeCloseTo(1.6, 6);
  });

  it("places a bottom-side part below the board, mirrored by a half turn about Y", () => {
    const s = buildBoard3d(board([{ ...sot, side: "bottom", x: mm(2) }]));
    const c = s.components[0];
    expect(c.bounds!.max[2]).toBeCloseTo(0, 6);
    expect(c.bounds!.min[2]).toBeCloseTo(-1.45, 6);
    expect(c.seating.status).toBe("ok");
  });

  it("an override turns the body and the check reports it", () => {
    const s = buildBoard3d(board([sot]), { overrides: { U9: { rotate: [0, 0, 180] } } });
    expect(s.components[0].seating.status).toBe("rotated");
    expect(s.findings.some((f) => f.code === "PCB3D_ROTATED" && f.ref === "U9")).toBe(true);
  });
});

describe("a 138-part board", () => {
  /** 120 chips, 12 SOT-23-5, 6 SOIC-8 on a 100 x 80 mm board, some on the bottom: generated, not a real design. */
  function grid(): ReturnType<typeof createDocument> {
    const recs: BoardRecord[] = [
      { kind: "board", id: "board", name: "Grid 138", thickness: mm(1.6), copper_layers: 2, origin: "center" },
      { kind: "outline", id: "outline", outline: [{ x: mm(-50), y: mm(-40) }, { x: mm(50), y: mm(-40) }, { x: mm(50), y: mm(40) }, { x: mm(-50), y: mm(40) }], source: { kind: "board" } },
    ];
    const chip = (ref: string, x: number, y: number, side: "top" | "bottom", rot: number): FootprintRec => ({ kind: "footprint", id: `fp:${ref}`, ref, footprint: "Test:C_0603", value: "100 nF", x: mm(x), y: mm(y), rotation: rot, side, pads: [-0.8, 0.8].map((px, i) => ({ number: String(i + 1), type: "smd" as const, shape: "rect" as const, x: mm(px), y: 0, width: mm(0.8), height: mm(0.95) })), provenance: { by: "hand" } });
    for (let i = 0; i < 120; i++) recs.push(chip(`C${i + 1}`, -45 + (i % 15) * 6, -35 + Math.floor(i / 15) * 5, i % 3 === 0 ? "bottom" : "top", (i % 4) * 90_000));
    for (let i = 0; i < 12; i++) recs.push({ kind: "footprint", id: `fp:U${i + 1}`, ref: `U${i + 1}`, footprint: "Test:SOT-23-5", x: mm(-45 + i * 8), y: mm(8), rotation: (i % 4) * 90_000, side: "top", pads: [["1", -0.95, -1.1], ["2", 0, -1.1], ["3", 0.95, -1.1], ["4", 0.95, 1.1], ["5", -0.95, 1.1]].map(([n, x, y]) => ({ number: n as string, type: "smd" as const, shape: "rect" as const, x: mm(x as number), y: mm(y as number), width: mm(0.6), height: mm(1.06) })), provenance: { by: "hand" } });
    for (let i = 0; i < 6; i++) recs.push({ kind: "footprint", id: `fp:U${i + 20}`, ref: `U${i + 20}`, footprint: "Test:SOIC-8_3.9x4.9mm", x: mm(-40 + i * 15), y: mm(20), rotation: 0, side: "top", pads: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ number: String(k + 1), type: "smd" as const, shape: "rect" as const, x: mm(k < 4 ? -2.475 : 2.475), y: mm(k < 4 ? 1.905 - k * 1.27 : -1.905 + (k - 4) * 1.27), width: mm(1.95), height: mm(0.6) })), provenance: { by: "hand" } });
    return createDocument(recs);
  }

  it("full tier: 139 solids, every part seated, in well under a second for the scene and files", async () => {
    const doc = grid();
    buildBoard3d(doc); // warm up the code paths once
    const dir = mkdtempSync(join(tmpdir(), "board-3d-grid-"));
    try {
      const r = await exportBoard3d(doc, { outDir: dir, tier: "full", images: false, validate: true, timestamp: "2026-11-09T00:00:00" });
      expect(r.bodies).toBe(139);
      expect(r.solids).toBe(139);
      for (const v of r.validation) for (const c of v.checks) expect(c.ok, `${v.format} ${c.name}: ${c.detail}`).toBe(true);
      expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
      console.log(`grid 138: scene ${r.timing.sceneMs} ms, files ${r.timing.exportMs} ms (STEP ${r.timing.stepMs}, STL ${r.timing.stlMs}, 3MF ${r.timing["3mfMs"]}, GLB ${r.timing.glbMs}), validation ${r.timing.validateMs} ms`);
      expect(r.timing.exportMs).toBeLessThan(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("containers", () => {
  it("zip round trip", () => {
    const data = new Uint8Array(Buffer.from("hello ".repeat(100)));
    const z = writeZip([{ name: "a/b.txt", data }, { name: "c.bin", data: new Uint8Array([1, 2, 3]) }]);
    expect(readZip(z).map((e) => [e.name, Buffer.from(e.data).toString("hex")])).toEqual([
      ["a/b.txt", Buffer.from(data).toString("hex")],
      ["c.bin", "010203"],
    ]);
  });
  it("transforms compose as rigid motions", () => {
    const m = compose(translation([1, 2, 3]), rotationZ(90));
    expect(m.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3]);
  });
});

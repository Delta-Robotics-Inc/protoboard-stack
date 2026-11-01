/**
 * Mates (PB-1185): frames and the glTF boundary, the BVH and triangle tests,
 * face fitting and the suggestion rules, the `protoboard.mate` trait (module
 * and interface forms), the sidecar bound by sha256 (stale, containment, size,
 * glTF-space frames), the merge rule (trait beats sidecar beats inferred), the
 * validator, the GLB face reader, and the interference pair test.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import type { Assembly, Mat4, ModuleDef } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import {
  MATES_SCHEMA,
  MATE_TRAIT,
  TriBVH,
  fitFace,
  gltfPointToUhd,
  matesSidecarPath,
  mergeMates,
  normalizeLimit,
  readBodyFaces,
  readMatesSidecar,
  sidecarMates,
  suggestMates,
  testPair,
  traitMates,
  triTri,
  validateMates,
  type InterferenceBody,
  type Mate,
  type SuggestBody,
} from "../src/mates/index.ts";
import type { FaceGeom } from "../src/mates/mesh.ts";

const tmp = mkdtempSync(join(tmpdir(), "pb-mates-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

/** A cylinder wall along z through (cx, cy), radius r, z0..z1, from a0 to a1 degrees; inner: normals toward the axis. */
function cylinder(cx: number, cy: number, r: number, z0: number, z1: number, inner: boolean, a0 = 0, a1 = 360, n = 32): FaceGeom {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pos.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0, cx + r * Math.cos(a), cy + r * Math.sin(a), z1);
  }
  for (let i = 0; i < n; i++) {
    const [p, q, s, t] = [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3];
    // outward winding (normal away from the axis); flipped for a hole
    if (inner) idx.push(p, q, s, s, q, t);
    else idx.push(p, s, q, s, t, q);
  }
  return { node: ".", feature: 0, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
/** A rectangle in the plane z = z, normal +z (up) or -z. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number, up: boolean): FaceGeom {
  const pos = [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
  const idx = up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  return { node: ".", feature: 0, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
const numbered = (faces: FaceGeom[]) => faces.map((f, i) => ({ ...f, feature: i }));
/** A closed box mesh (12 triangles), outward normals. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { positions: Float32Array; indices: Uint32Array } {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { positions: Float32Array.from(v.flat()), indices: Uint32Array.from(f.flat()) };
}

describe("frames and units", () => {
  it("converts glTF (m, Y up) to UHD (mm, Z up) as the viewer's cadWrapper does", () => {
    expect(gltfPointToUhd([0.001, 0.002, 0.003])).toEqual([1, -3, 2]);
  });
  it("normalizes limits to degrees and mm, and refuses a unit that does not fit the dof", () => {
    expect(normalizeLimit({ dof: "rotate", min: 0, max: Math.PI / 2, unit: "rad" })!.max).toBeCloseTo(90, 9);
    expect(normalizeLimit({ dof: "slide", min: 0, max: 0.012, rest: 0.002, unit: "m" })).toMatchObject({ min: 0, max: 12, rest: 2 });
    expect(normalizeLimit({ dof: "slide", max: 5, unit: "deg" })).toBeUndefined();
  });
});

describe("triangles and the BVH", () => {
  it("tells crossing, touching, coplanar-overlapping and separate triangles apart", () => {
    expect(triTri([0, 0, 0], [2, 0, 0], [0, 2, 0], [0.5, 0.5, -1], [0.5, 0.5, 1], [1.5, 0.5, 0])).toBe(true); // crossing
    expect(triTri([0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 1], [2, 0, 1], [0, 2, 1])).toBe(false); // parallel, apart
    expect(triTri([0, 0, 0], [2, 0, 0], [0, 2, 0], [0.5, 0.5, 0], [3, 0.5, 0], [0.5, 3, 0])).toBe(true); // coplanar overlap
    expect(triTri([0, 0, 0], [2, 0, 0], [0, 2, 0], [5, 5, 0], [6, 5, 0], [5, 6, 0])).toBe(false); // coplanar apart
  });
  it("finds two overlapping boxes, misses two apart, and measures inside and distance", () => {
    const a = box(0, 0, 0, 10, 10, 10);
    const bvh = new TriBVH(a.positions, a.indices);
    const b = new TriBVH(box(0, 0, 0, 4, 4, 4).positions, box(0, 0, 0, 4, 4, 4).indices);
    expect(bvh.intersects(b, T(8, 3, 3), 1).hits).toBe(1);
    expect(bvh.intersects(b, T(20, 0, 0), 1).hits).toBe(0);
    expect(bvh.inside([5, 5, 5])).toBe(true);
    expect(bvh.inside([15, 5, 5])).toBe(false);
    expect(bvh.closest([5, 5, 7])).toBeCloseTo(3, 6);
  });
  it("splits a large mesh into a tree and still answers the same", () => {
    // 4000 tiny boxes in a row: the tree has many levels
    const pos: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k < 4000; k++) {
      const b = box(k, 0, 0, k + 0.5, 0.5, 0.5);
      idx.push(...Array.from(b.indices, (i) => i + pos.length / 3));
      pos.push(...b.positions);
    }
    const bvh = new TriBVH(Float32Array.from(pos), Uint32Array.from(idx));
    expect(bvh.nodes).toBeGreaterThan(1000);
    const probe = new TriBVH(box(0, 0, 0, 0.2, 0.2, 0.2).positions, box(0, 0, 0, 0.2, 0.2, 0.2).indices);
    expect(bvh.intersects(probe, T(3999.4, 0.4, 0.4), 1).hits).toBe(1);
    expect(bvh.intersects(probe, T(3999.6, 0.1, 0.1), 1).hits).toBe(0);
  });
});

describe("face fitting", () => {
  it("fits a plane and a hole with its radius, arc and side, also far from the origin", () => {
    const p = fitFace(rect(0, 0, 10, 5, 2, true).positions, rect(0, 0, 10, 5, 2, true).indices)!;
    expect(p.kind).toBe("plane");
    if (p.kind === "plane") expect(p.area).toBeCloseTo(50, 6);
    const h = cylinder(500, -300, 1.6, 0, 3, true);
    const c = fitFace(h.positions, h.indices)!;
    expect(c.kind).toBe("cylinder");
    if (c.kind === "cylinder") {
      expect(c.radius).toBeCloseTo(1.6, 2);
      expect(c.inner).toBe(true);
      expect(c.arc).toBeGreaterThan(340);
    }
    const shaft = cylinder(0, 0, 2.5, 0, 10, false);
    const s = fitFace(shaft.positions, shaft.indices)!;
    expect(s.kind === "cylinder" && !s.inner).toBe(true);
    // a 60 degree band (a fillet) is not a cylinder for mating
    const band = cylinder(0, 0, 2, 0, 1, false, 0, 60, 8);
    expect(fitFace(band.positions, band.indices)).toBeUndefined();
  });
});

describe("suggestions", () => {
  const holes = (z0: number, z1: number, r: number, split = false) =>
    [[-8, -8], [8, -8], [8, 8], [-8, 8]].flatMap(([x, y]) => (split ? [cylinder(x, y, r, z0, z1, true, 0, 180, 16), cylinder(x, y, r, z0, z1, true, 180, 360, 16)] : [cylinder(x, y, r, z0, z1, true)]));
  const plate: SuggestBody = { key: "plate", instance: "plate", matrix: I4, faces: numbered([...holes(-2, 0, 1.6), rect(-15, -15, 15, 15, 0, true)]) };
  // the motor's tapped holes split in halves at the seam, as STEP kernels write them
  const motor: SuggestBody = { key: "arm/motor", instance: "arm/motor", matrix: T(0, 0, 0), faces: numbered([...holes(0, 4, 1.25, true), rect(-12, -12, 12, 12, 0, false), cylinder(0, 0, 2.5, 0, 30, false)]) };
  const prop: SuggestBody = { key: "arm/prop", instance: "arm/prop", matrix: T(0, 0, 25), faces: numbered([cylinder(0, 0, 2.5, 0, 6, true), rect(-4, -4, 4, 4, 0, false)]) };
  // the motor's top face, where the prop seats
  motor.faces.push({ ...rect(-4, -4, 4, 4, 25, true), feature: motor.faces.length });
  const battery: SuggestBody = { key: "battery", instance: "battery", matrix: T(0, 40, 0), faces: numbered([rect(-10, -5, 10, 5, 0, false)]) };
  const deck: SuggestBody = { key: "deck", instance: "deck", matrix: T(0, 40, 0), faces: numbered([rect(-20, -20, 20, 20, 0, true)]) };

  it("reads a bolted joint, a prop on its shaft and a part sitting on a deck, each inferred with confidence and evidence", () => {
    const r = suggestMates([plate, motor, prop, battery, deck]);
    const by = (a: string, b: string) => r.suggestions.find((s) => [s.a.instance, s.b.instance].sort().join("~") === [a, b].sort().join("~"));
    const bolt = by("plate", "arm/motor")!;
    expect(bolt.kind).toBe("fixed");
    expect(bolt.note).toMatch(/4-hole pattern.*aligned.*seated/);
    expect(bolt.confidence).toBeGreaterThan(0.8);
    const spin = by("arm/motor", "arm/prop")!;
    expect(spin.kind).toBe("revolute");
    expect(spin.note).toMatch(/shaft in bore/);
    const sit = by("battery", "deck")!;
    expect(sit.kind).toBe("planar");
    for (const s of r.suggestions) {
      expect(s.provenance).toBe("inferred");
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.evidence!.length).toBeGreaterThan(0);
    }
    // frames are in each body's own frame: the prop's end sits at its own z = 0 (world 25)
    expect(spin.b.instance === "arm/prop" ? spin.b.frame.origin[2] : spin.a.frame.origin[2]).toBeCloseTo(0, 3);
    expect(r.fitted.patterns).toBeGreaterThanOrEqual(2);
  });
  it("leaves bodies that do not come near each other alone", () => {
    const far = { ...battery, key: "far", instance: "far", matrix: T(500, 0, 0) };
    expect(suggestMates([plate, far]).suggestions).toEqual([]);
  });
});

/** A two-part assembly: a base with a hinge interface, a lid placed by link "lid_hinge". */
function hingeFixture() {
  const hingeTrait = { type: MATE_TRAIT, params: { kind: "revolute", limits: [{ dof: "rotate", min: 0, max: 110, unit: "deg", source: "test" }] } };
  const base = { id: "base", name: "base", interfaces: [{ id: "hinge", domain: "mechanical", geometry: { frame: { origin: [0, 40, 12], normal: [1, 0, 0] } }, traits: [hingeTrait] }] } as unknown as ModuleDef;
  const lid = { id: "lid", name: "lid", interfaces: [{ id: "hinge", domain: "mechanical", geometry: { frame: { origin: [0, 0, 0], normal: [-1, 0, 0] } } }] } as unknown as ModuleDef;
  const box = {
    id: "box",
    name: "box",
    interfaces: [],
    traits: [
      { type: MATE_TRAIT, params: { id: "lid_slide", kind: "prismatic", a: { instance: "base", interface: "hinge" }, b: { instance: "lid", frame: { origin: [0, 0, 0], zAxis: [0, 0, 1] } }, limits: [{ dof: "slide", min: 0, max: 8, unit: "mm", source: "test" }] } },
      { type: MATE_TRAIT, params: { link: "lid_hinge", kind: "fixed" } },
      { type: MATE_TRAIT, params: { kind: "teleport", a: { instance: "base" }, b: { instance: "lid" } } },
    ],
  } as unknown as ModuleDef;
  const defs = new Map([base, lid, box].map((d) => [d.id, d]));
  const instances = [{ path: "", definition: "sys" }, { path: "box", definition: "box" }, { path: "box/base", definition: "base" }, { path: "box/lid", definition: "lid" }];
  const asm = {
    placements: [
      { key: "box/base", path: ["box", "base"], matrix: T(0, 0, 0) as unknown as Mat4 },
      { key: "box/lid", path: ["box", "lid"], matrix: T(0, 40, 12) as unknown as Mat4, via: "box/lid_hinge" },
    ],
    mates: [{ linkId: "box/lid_hinge", a: { path: ["box", "base"], def: base, iface: base.interfaces[0], frame: base.interfaces[0].geometry!.frame! }, b: { path: ["box", "lid"], def: lid, iface: lid.interfaces[0], frame: lid.interfaces[0].geometry!.frame! } }],
    hardware: [],
  } as unknown as Assembly;
  return { ctx: { instances, lookup: (id: string) => defs.get(id), asm }, asm };
}

describe("the protoboard.mate trait", () => {
  it("reads module traits with instance paths prefixed, frames from interfaces, the link form, and interface hints", () => {
    const { ctx } = hingeFixture();
    const r = traitMates(ctx);
    const slide = r.mates.find((m) => m.id === "box/lid_slide")!;
    expect(slide).toMatchObject({ kind: "prismatic", from: "trait", provenance: "declared", a: { instance: "box/base", interface: "hinge" }, b: { instance: "box/lid" } });
    expect(slide.a.frame).toEqual({ origin: [0, 40, 12], zAxis: [1, 0, 0] });
    // the link form wins over the interface hint for the same link (one id: link:<id>)
    const link = r.mates.find((m) => m.id === "link:box/lid_hinge")!;
    expect(link.kind).toBe("fixed");
    expect(link.b.instance).toBe("box/lid");
    expect(r.problems.map((q) => q.code)).toEqual(["MATE_KIND_UNKNOWN"]);
  });
  it("turns an interface trait into a hint for the link that mates it", () => {
    const { ctx } = hingeFixture();
    const lookup = (id: string) => (id === "box" ? ({ ...ctx.lookup("box")!, traits: [] } as ModuleDef) : ctx.lookup(id));
    const r = traitMates({ ...ctx, lookup });
    expect(r.mates).toHaveLength(1);
    expect(r.mates[0]).toMatchObject({ id: "link:box/lid_hinge", kind: "revolute", link: "box/lid_hinge", a: { instance: "box/base" }, b: { instance: "box/lid" } });
    expect(r.mates[0].limits![0]).toMatchObject({ dof: "rotate", max: 110 });
  });
});

describe("the mates sidecar", () => {
  const model = join(tmp, "model.lcsc-C393939.step");
  writeFileSync(model, "ISO-10303-21; fake model bytes");
  const sha = "sha256:" + createHash("sha256").update("ISO-10303-21; fake model bytes").digest("hex");
  const side = matesSidecarPath(model);
  const write = (s: unknown) => writeFileSync(side, JSON.stringify(s));
  const mate = { id: "usb", kind: "prismatic", a: { instance: ".", frame: { origin: [0.001, 0.002, 0.003], zAxis: [0, 1, 0] } }, b: { instance: "plug", frame: { origin: [0, 0, 0], zAxis: [0, -1, 0] } }, provenance: "measured" };

  it("sits beside the model as <name>.mates.json", () => {
    expect(side).toBe(join(tmp, "model.lcsc-C393939.mates.json"));
  });
  it("is used while its sha256 matches, its glTF-space frames brought to mm and Z up", () => {
    write({ schema: MATES_SCHEMA, target: { file: "model.lcsc-C393939.step", sha256: sha, units: "m", upAxis: "+Y" }, mates: [mate] });
    const r = readMatesSidecar(side);
    expect(r.problems).toEqual([]);
    const m = sidecarMates(r.sidecar!, "board/usb_c", "x.mates.json").mates[0];
    expect(m.id).toBe("board/usb_c/usb");
    expect(m.a.instance).toBe("board/usb_c");
    expect(m.b.instance).toBe("board/usb_c/plug");
    expect(m.a.frame.origin.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([1, -3, 2]);
    expect(m.a.frame.zAxis).toEqual([0, -0, 1]);
    expect(m.from).toBe("sidecar");
  });
  it("is reported stale and ignored when the model changed", () => {
    write({ schema: MATES_SCHEMA, target: { file: "model.lcsc-C393939.step", sha256: "sha256:" + "0".repeat(64) }, mates: [mate] });
    const r = readMatesSidecar(side);
    expect(r.sidecar).toBeUndefined();
    expect(r.problems.map((q) => q.code)).toEqual(["MATES_SIDECAR_STALE"]);
  });
  it("refuses a target that is a path (containment) and a file over the size cap", () => {
    write({ schema: MATES_SCHEMA, target: { file: "../elsewhere/model.step", sha256: sha } });
    expect(readMatesSidecar(side).problems.map((q) => q.code)).toEqual(["MATES_SIDECAR_TARGET"]);
    writeFileSync(side, " ".repeat(1024 * 1024 + 1));
    expect(readMatesSidecar(side).problems.map((q) => q.code)).toEqual(["MATES_SIDECAR_INVALID"]);
  });
});

describe("merge rule and validator", () => {
  const frame = { origin: [0, 0, 0] as [number, number, number], zAxis: [0, 0, 1] as [number, number, number] };
  const m = (id: string, from: Mate["from"], kind: Mate["kind"] = "fixed", a = "a", b = "b"): Mate => ({ id, kind, a: { instance: a, frame }, b: { instance: b, frame }, provenance: from === "inferred" ? "inferred" : "declared", ...(from === "inferred" ? { confidence: 0.5 } : {}), from });

  it("trait beats sidecar beats inferred, and an inferred mate between already mated instances is shadowed", () => {
    const r = mergeMates([m("x", "trait", "revolute")], [m("x", "sidecar", "fixed"), m("y", "sidecar")], [m("x", "inferred"), m("z", "inferred", "planar", "b", "a"), m("w", "inferred", "planar", "a", "c")]);
    expect(r.mates.map((x) => `${x.id}:${x.from}`).sort()).toEqual(["w:inferred", "x:trait"].concat(["y:sidecar"]).sort());
    expect(r.mates.find((x) => x.id === "x")!.kind).toBe("revolute");
    expect(r.shadowed.map((s) => `${s.id}:${s.from}>${s.byFrom}`).sort()).toEqual(["x:inferred>trait", "x:sidecar>trait", "z:inferred>trait"].sort());
  });
  it("reports bad kinds, frames, limits, units, instances and confidence", () => {
    const bad: Mate[] = [
      { ...m("k", "trait"), kind: "hinge" as Mate["kind"] },
      { ...m("f", "trait"), a: { instance: "a", frame: { origin: [0, 0, 0], zAxis: [0, 0, 0] } } },
      { ...m("u", "trait", "revolute"), limits: [{ dof: "rotate", min: 0, max: 5, unit: "mm" }] },
      { ...m("d", "trait", "fixed"), limits: [{ dof: "rotate", max: 5, unit: "deg", source: "s" }] },
      { ...m("r", "trait", "revolute"), limits: [{ dof: "rotate", min: 10, max: 5, unit: "deg", source: "s" }] },
      { ...m("o", "trait", "revolute"), limits: [{ dof: "rotate", min: 10, max: 50, rest: 0, unit: "deg", source: "s" }] },
      m("i", "trait", "fixed", "a", "ghost"),
      m("s", "trait", "fixed", "a", "a"),
      { ...m("c", "inferred"), confidence: undefined },
      { ...m("l", "trait"), link: "nope" },
    ];
    const codes = validateMates(bad, { instances: new Set(["a", "b"]), links: new Set(["yes"]) }).map((q) => `${q.mate}:${q.code}`);
    for (const want of ["k:MATE_KIND_UNKNOWN", "f:MATE_FRAME_INVALID", "u:MATE_LIMIT_UNIT", "d:MATE_LIMIT_DOF", "r:MATE_LIMIT_RANGE", "o:MATE_REST_OUTSIDE", "i:MATE_INSTANCE_UNKNOWN", "s:MATE_SAME_INSTANCE", "c:MATE_CONFIDENCE", "l:MATE_LINK_UNKNOWN"]) expect(codes).toContain(want);
    expect(validateMates([m("ok", "trait", "revolute")], { instances: new Set(["a", "b"]) })).toEqual([]);
  });
});

describe("reading a GLB's faces", () => {
  it("takes one face per source primitive, in mm and Z up", async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const mesh = doc.createMesh();
    for (const z of [0, 0.002]) {
      const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, z, 0, 0.01, z, 0, 0, z, 0.01])).setBuffer(buf);
      mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos));
    }
    doc.getRoot().getDefaultScene() ?? doc.createScene();
    const scene = doc.getRoot().listScenes()[0] ?? doc.createScene();
    scene.addChild(doc.createNode("part").setMesh(mesh));
    const file = join(tmp, "two-faces.glb");
    writeFileSync(file, await new NodeIO().writeBinary(doc));
    const r = await readBodyFaces(file);
    expect(r.via).toBe("source");
    expect(r.faces.map((f) => f.feature)).toEqual([0, 1]);
    // glTF y (up) 0.002 m is UHD z 2 mm; glTF z 0.01 m is UHD y -10 mm
    expect(Array.from(r.faces[1].positions)).toEqual([0, -0, 2, 10, -0, 2, 0, -10, 2]);
  });
});

describe("interference pair test", () => {
  const body = (key: string, b: { positions: Float32Array; indices: Uint32Array }): InterferenceBody => ({ key, instance: key, file: key, matrix: I4, bvh: new TriBVH(b.positions, b.indices), via: "source" });
  const a = body("a", box(0, 0, 0, 10, 10, 10));
  const b = body("b", box(0, 0, 0, 4, 4, 4));
  it("reports an overlap as interference with a depth estimate, a touch as contact, and nothing apart", () => {
    const hit = testPair(a, b, I4, T(8, 3, 3))!; // b reaches 2 mm into a
    expect(hit.status).toBe("interference");
    expect(hit.depthMm).toBeGreaterThan(1.5);
    expect(hit.depthMm).toBeLessThanOrEqual(2.0001);
    const touch = testPair(a, b, I4, T(10, 3, 3))!;
    expect(touch.status).toBe("contact");
    expect(testPair(a, b, I4, T(30, 0, 0))).toBeUndefined();
    // wholly inside, no surfaces crossing: still found
    const inside = testPair(a, body("c", box(0, 0, 0, 2, 2, 2)), I4, T(4, 4, 4))!;
    expect(inside.status).toBe("interference");
    expect(inside.depthMm).toBeGreaterThan(3);
  });
});

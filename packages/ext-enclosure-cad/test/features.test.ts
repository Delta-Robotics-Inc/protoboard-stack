/**
 * ext-enclosure-cad: the feature kinds the device fixture does not use, and
 * the check rules on their facts.
 *
 *   - check rules, without Python: a fabricated build report run through
 *     checkEnclosure (seal squeeze and fit against Parker's tables, thin
 *     walls, plunger reach and retention, plunger collisions, the plug a
 *     socket takes, envelope, missing features, frame drift);
 *   - the generator, with Python and build123d (skipped, and said so,
 *     otherwise): a round case (display and sensor windows, a light pipe,
 *     strap lugs, a joint O-ring, lid screws) and a bottle cap (an internal
 *     thread, a face seal on the bottle lip, a radial seal on a probe tube),
 *     and a box case whose openings cross the lid joint (the slivers they
 *     would leave are cut away inside the wall, and reported on the outside).
 *     The built parts are probed exactly with test/probe.py.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleDef } from "@deltarobotics/uhd";
import type { Project } from "@protoboardai/core";
import { checkEnclosure, type Report } from "../lib/check.ts";
import { Button, Joint, Opening, SealGland, TwistLid, readFeatures } from "../lib/features.ts";
import { designOf, type Job, type JobFeature } from "../lib/job.ts";
import { ESSLINGER_82_2225, M2X6_PAN, RUTHEX_RX_M2X4, USB_C_PLUG, as568, glandRow, lugHole } from "../lib/standards.ts";
import { glbBoxes } from "./fixture.ts";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const TMP = join(HERE, ".tmp", "features");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const PYTHON = cadPython();
const hasPy = !!PYTHON && spawnSync(PYTHON, ["-c", "import build123d, scipy"]).status === 0;
if (!hasPy) console.warn("enclosure-cad: no Python with build123d + scipy (set PROTOBOARD_PYTHON); the generator feature tests are skipped");

const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const table = (type: "face" | "radial", w: number) => {
  const r = glandRow(type, w)!;
  return { depth_mm: r.depth_mm, width_mm: r.width_mm, squeeze_pct: r.squeeze_pct, ...(r.clearance_mm ? { clearance_mm: r.clearance_mm } : {}), source: r.source };
};
const design = (o: Partial<Job["design"]>): Job["design"] => ({
  shape: "round", wall: 1.6, floor: 1.6, lid: 1.6, clearance: 0.3, clearance_top: 0.3, min_wall: 0.8, cavity: null, split_z: null,
  joint: { style: "rabbet", lip_height: 1.5, clearance: 0.15 }, fasteners: "none", resolution: 0.3, ...o,
});
const job = (name: string, d: Job["design"], contents: Job["contents"], features: JobFeature[]): Job => ({ schema: "protoboard.enclosure-cad.job/v0", module: name, name, root: ".", process: "print", material: "PETG", inputsDigest: `sha256:${name}`, design: d, contents, features });

/** The generator, asynchronously: a build takes tens of seconds and must not hold the worker's event loop (vitest's RPC times out at 60 s). */
async function build(dir: string, j: Job): Promise<Report> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "job.json"), JSON.stringify(j));
  const child = spawn(PYTHON!, [join(HERE, "../py/enclosure_cad.py"), "build", join(dir, "job.json"), join(dir, "build"), "--root", dir], { timeout: 600000, env: { ...process.env, PYTHONHASHSEED: "0" } });
  let stderr = "";
  child.stdout.resume();
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  if (status !== 0) throw new Error(stderr.split("\n").slice(-4).join("\n"));
  return JSON.parse(readFileSync(join(dir, "build/report.json"), "utf8"));
}

/** Just enough of a project for checkEnclosure: the module, its source, and the native files on disk. */
function fakeProject(root: string, def: ModuleDef): Project {
  return { root, definitions: new Map([[def.id, { def, origin: { kind: "local", source: { file: "src/case.uhd.ts" } } }]]) } as unknown as Project;
}

describe("check rules on a build report", () => {
  const root = join(TMP, "rules");
  const def: ModuleDef = {
    id: "c",
    name: "C",
    interfaces: [
      SealGland({ id: "seal", type: "face", oring: "AS568-033", at: "joint" }),
      SealGland({ id: "probe", type: "radial", oring: "AS568-010", rodDiameterMm: 6.5, frame: { origin: [0, 0, 0], normal: [0, 0, -1] } }),
      SealGland({ id: "edited", type: "face", oring: "AS568-033", frame: { origin: [0, 0, 0], normal: [0, 0, -1] } }),
      Button({ id: "btn", serves: { child: "board", interfaceId: "sw" }, holeDiameterMm: 2.5, travelMm: 0.2, protrudeMm: 0.25 }),
      Button({ id: "btn2", serves: { child: "board", interfaceId: "sw2" }, holeDiameterMm: 2.5, travelMm: 0.2 }),
      Opening({ id: "usb", serves: { child: "board", interfaceId: "usb" }, widthMm: 8, heightMm: 3, plug: USB_C_PLUG }),
      Joint({ id: "joint", screw: M2X6_PAN, insert: RUTHEX_RX_M2X4, frame: { origin: [0, 0, 5], normal: [0, 0, 1] } }),
      { id: "vent", name: "Vent", domain: "mechanical", exposed: true, protocols: [], traits: [{ type: "enclosure_feature", params: { kind: "light_pipe", diameter_mm: 2, serves: { child: "board", interfaceId: "led" } } }] },
    ],
    traits: [{ type: "design_envelope", params: { max_mm: { length: 40, height: 20 } } }],
  };
  const o033 = as568("AS568-033")!;
  const o010 = as568("AS568-010")!;
  const recorded = job("c", design({}), [], [
    { id: "seal", kind: "seal_gland", params: { oring: o033, table: table("face", 1.78) } },
    { id: "probe", kind: "seal_gland", params: { oring: o010, rod_d_mm: 6.5, table: table("radial", 1.78) } },
    // a hand-edited job: the table copied into it widened, and the groove made shallower to match
    { id: "edited", kind: "seal_gland", params: { oring: o033, table: { ...table("face", 1.78), squeeze_pct: [10, 60] } } },
    { id: "btn", kind: "button", params: { protrude_mm: 0.25 }, served: { key: "board", label: "board.sw", from: "manifest", frame: { origin: [0, 10, 3], normal: [0, 1, 0] } } },
    { id: "btn2", kind: "button", params: {}, served: { key: "board", label: "board.sw2", from: "manifest", frame: { origin: [5, 10, 3], normal: [0, 1, 0] } } },
    { id: "usb", kind: "opening", params: {}, served: { key: "board", label: "board.usb", from: "manifest", frame: { origin: [-10, 0, 3], normal: [-1, 0, 0] } } },
  ]);
  const report: Report = {
    schema: "protoboard.enclosure-cad.report/v0", module: "c", inputsDigest: recorded.inputsDigest, sourceDigest: "x", toolVersion: "0.13.0",
    cavity: { shape: "round", min: [-26, -26, 0], max: [26, 26, 8], centre: [0, 0], radius: 26 }, outer: { min: [-28, -28, -2], max: [28, 28, 10] }, overall: { min: [-28, -32, -2], max: [28, 32, 10] },
    levels: {}, parts: { base: { volume_mm3: 1, printed: true }, lid: { volume_mm3: 1, printed: true } },
    features: {
      // 1.78 mm O-ring in a 1.10 mm deep groove: 38 % squeeze, over Design Chart 4-2's 32 %; groove 7 % longer than the O-ring
      seal: { kind: "seal_gland", type: "face", oring: "AS568-033", w_mm: 1.78, gland_depth_mm: 1.1, gap_mm: 0, groove_inner_perimeter_mm: 170.0, oring_inner_perimeter_mm: 158.71, pressure: "external", parts: ["base"], frame: { origin: [0, 0, 6], normal: [0, 0, 1] } },
      // the rod off centre by its 0.1 mm radial clearance: 1.2 to 1.4 mm deep, 21.3 to 32.6 % squeeze, past Design Chart 4-1's 32 %
      probe: { kind: "seal_gland", type: "radial", oring: "AS568-010", w_mm: 1.78, gland_depth_mm: 1.3, gap_mm: 0, rod_offset_mm: 0.1, gap_basis: "the rod is the sealing surface, off centre by up to the radial clearance", rod_d_mm: 6.5, parts: ["base"], frame: { origin: [0, 0, 0], normal: [0, 0, -1] } },
      edited: { kind: "seal_gland", type: "face", oring: "AS568-033", w_mm: 1.78, gland_depth_mm: 0.9, gap_mm: 0, gap_basis: "assumed contact", groove_inner_perimeter_mm: 159.5, oring_inner_perimeter_mm: 158.71, pressure: "external", parts: ["base"], frame: { origin: [0, 0, 0], normal: [0, 0, -1] } },
      btn: { kind: "button", tip: [0, 10.1, 3], gap_mm: 0.1, travel_mm: 0.2, parts: ["base"], frame: { origin: [0, 12, 3], normal: [0, 1, 0] } },
      // trimmed so far to clear the board that only a third of its edge still overlaps the wall
      btn2: { kind: "button", tip: [5, 10.1, 3], gap_mm: 0.1, travel_mm: 0.2, parts: ["base"], frame: { origin: [5, 12, 3], normal: [0, 1, 0] }, flange_hold_pct: 33.3, flange_hold_rule: { overlap_mm: 0.5, pct: 50 }, flange_trimmed_by: ["board"] },
      usb: { kind: "opening", size_mm: [8, 3], parts: ["base"], frame: { origin: [-10, 0, 3], normal: [-1, 0, 0] }, plug: { name: "USB Type-C plug", passes: false, plug_mm: [8.25, 2.4], overmold_mm: [12.35, 6.5], seat_mm: -0.4 } },
      joint: { kind: "joint", parts: ["base"], frame: { origin: [0, 0, 6], normal: [0, 0, 1] } },
      gone: { kind: "opening", parts: ["base"] },
    },
    walls: [{ feature: "joint", what: "column wall around the insert", mm: 1.1, min_mm: 1.3 }],
    problems: ["btn: something the generator noticed"],
    fit: {
      resolution_mm: 0.3,
      bodies: [{ key: "board", label: "Board", min_clearance_mm: 0.1, at: [0, 0, 5], near: "lid (cavity ceiling)", basis: "exact", outside_cavity_mm: 0, status: "tight" }],
      plungers: [
        { key: "plunger_btn", feature: "btn", min_clearance_mm: -0.6, at: [0, 11.5, 1.4], near: "board", status: "collision", wall_overlap_mm3: { base: 0, lid: 0.25 } },
        { key: "plunger_btn2", feature: "btn2", min_clearance_mm: 0.4, near: "board", status: "clear", wall_overlap_mm3: { base: 0, lid: 0 } },
      ],
      walls: {},
    },
  };
  mkdirSync(join(root, "n"), { recursive: true });
  writeFileSync(join(root, "n/c.job.json"), JSON.stringify(recorded));
  writeFileSync(join(root, "n/c.report.json"), JSON.stringify(report));
  let ds: Awaited<ReturnType<typeof checkEnclosure>> = [];
  beforeAll(async () => {
    ds = await checkEnclosure({ p: fakeProject(root, def), def, native: "n", config: "cad.config.ts", current: { job: recorded, problems: [], input: [], notes: [] } });
  });
  const by = (code: string) => ds.filter((d) => d.code === code).map((d) => [d.entity.id, d.severity, d.message]);

  it("squeeze outside the gland chart's row is an error, citing the chart, whatever table the job carries", () => {
    expect(by("ENCLOSURE_SEAL_SQUEEZE")).toEqual([
      ["c:seal", "error", expect.stringMatching(/^seal: AS568-033 squeezed 38\.2 %, outside 19–32 % \(Parker O-Ring Handbook .*Design Chart 4-2\)$/)],
      ["c:probe", "error", expect.stringMatching(/^probe: AS568-010 squeezed 21\.3–32\.6 %, outside 22–32 % \(.*Design Chart 4-1\); the rod is/)],
      ["c:edited", "error", expect.stringMatching(/^edited: AS568-033 squeezed 49\.4 %, outside 19–32 % \(.*Design Chart 4-2\); assumed contact$/)],
    ]);
  });

  it("plungers: a flange that no longer holds, and collisions with the walls (exact) and with what is inside", () => {
    expect(by("ENCLOSURE_PLUNGER").filter((x) => x[0] === "c:btn2")).toEqual([["c:btn2", "error", "btn2: trimmed to clear board, the plunger's flange overlaps the wall by 0.5 mm over only 33 % of its edge (it needs 50 % to stay in); move the switch away from what is near it, or retain the plunger another way"]]);
    expect(by("ENCLOSURE_COLLISION")).toEqual([
      ["c:btn", "error", "plunger_btn intersects the lid (0.25 mm³, exact): it cannot be assembled"],
      ["c:btn", "error", "plunger_btn intersects board by 0.6 mm at [0, 11.5, 1.4] (±0.3 mm voxels)"],
    ]);
    expect(by("ENCLOSURE_CLEARANCE")).toEqual([["c", "warning", "board (Board) is 0.1 mm from the lid (cavity ceiling) at [0, 0, 5], under the 0.3 mm design clearance (exact)"]]);
  });

  it("a socket opening the plug does not pass, and an overmold with no flat seat", () => {
    expect(by("ENCLOSURE_PLUG_FIT")).toEqual([
      ["c:usb", "error", "usb: USB Type-C plug (8.25 × 2.4 mm) does not pass through the 8 × 3 mm opening"],
      ["c:usb", "warning", "usb: the overmold of USB Type-C plug (12.35 × 6.5 mm) overhangs the flat face around the opening by 0.4 mm; it will not seat against the wall"],
    ]);
  });

  it("a groove that stretches the O-ring past 5 %, or a rod that does, is an error", () => {
    expect(by("ENCLOSURE_SEAL_FIT")).toEqual([
      ["c:seal", "error", expect.stringMatching(/^seal: the groove stretches AS568-033 7\.1 % \(more than 5 %, .*§3\.3 Assembly\)/)],
      ["c:probe", "error", expect.stringMatching(/^probe: the rod stretches AS568-010 7\.1 %/)],
    ]);
  });

  it("walls, plunger reach, envelope, generator problems, missing features and frame drift", () => {
    expect(by("ENCLOSURE_THIN_WALL")).toEqual([["c:joint", "error", "joint: column wall around the insert is 1.1 mm, below the 1.3 mm minimum"]]);
    expect(by("ENCLOSURE_PLUNGER").filter((x) => x[0] === "c:btn")).toEqual([["c:btn", "error", "btn: 0.1 mm gap + 0.2 mm travel is more than the 0.25 mm the plunger stands out; it cannot press board.sw"]]);
    expect(by("ENCLOSURE_ENVELOPE")).toEqual([["c", "error", "c is bigger than its design envelope: length 56 mm > 40 mm"]]);
    expect(by("ENCLOSURE_GENERATOR")).toEqual([["c:btn", "error", "c: btn: something the generator noticed"]]);
    expect(by("ENCLOSURE_FEATURE_MISSING").map((x) => x[2])).toEqual(["c.vent (light_pipe) has no generated feature; regenerate", "the generated design has feature gone, which c does not have (renamed or removed? regenerate)"]);
    expect(by("ENCLOSURE_FRAME_MISMATCH")).toEqual([["c:joint", "error", expect.stringMatching(/^joint: origin \[0, 0, 5\] vs generated \[0, 0, 6\]/)]]);
    expect(by("ENCLOSURE_STALE")).toEqual([]);
  });
});

describe.skipIf(!hasPy)("generator: round case and bottle cap", () => {
  it("a round case: windows, a light pipe, strap lugs, a joint O-ring and lid screws", async () => {
    const dir = join(TMP, "round");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "board.glb"), glbBoxes([{ name: "pcb", min: [-15, -15, 0], max: [15, 15, 1] }, { name: "hr", min: [-3, -3, -1.2], max: [3, 3, 0] }, { name: "led", min: [13.4, -1, 1], max: [15, 1, 2.6] }]));
    writeFileSync(join(dir, "display.glb"), glbBoxes([{ name: "display", min: [-17.8, -18.9, 0], max: [17.8, 18.9, 1.5] }]));
    const o = as568("AS568-034")!;
    const h = lugHole(ESSLINGER_82_2225);
    const r = await build(dir, job("round", design({ wall: 4.5, fasteners: "screws" }), [
      { key: "board", label: "Board", glb: "board.glb", digest: "-", matrix: T(0, 0, 2) },
      { key: "display", label: "Display", glb: "display.glb", digest: "-", matrix: T(0, 0, 5.5) },
    ], [
      { id: "display_window", kind: "window", params: { aperture: { diameter_mm: 33 }, cover: { diameter_mm: 38, thickness_mm: 0.8 } }, served: { key: "display", label: "display", from: "model", frame: { origin: [0, 0, 7], normal: [0, 0, 1] } } },
      { id: "hr_window", kind: "window", params: { aperture: { diameter_mm: 5 }, cover: { diameter_mm: 8, thickness_mm: 0.5 } }, served: { key: "board", label: "board.hr", from: "model", frame: { origin: [0, 0, 0.8], normal: [0, 0, -1] } } },
      { id: "led_pipe", kind: "light_pipe", params: { diameter_mm: 1.5 }, served: { key: "board", label: "board.led", from: "model", frame: { origin: [15, 0, 3.8], normal: [1, 0, 0] } } },
      { id: "lugs_12", kind: "strap_lugs", params: { end: "+y", strap_width_mm: 22, bar_d_mm: 1.5, ...h } },
      { id: "lugs_6", kind: "strap_lugs", params: { end: "-y", strap_width_mm: 22, bar_d_mm: 1.5, ...h } },
      { id: "case_seal", kind: "seal_gland", params: { type: "face", at: "joint", oring: o, table: table("face", o.w_mm) } },
      { id: "back_joint", kind: "joint", params: { count: 4, insert: RUTHEX_RX_M2X4, screw: M2X6_PAN } },
    ]));
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.parts)).toEqual(["base", "lid"]);
    for (const w of r.walls) expect(w.mm, `${w.feature}: ${w.what}`).toBeGreaterThanOrEqual(w.min_mm);
    expect(r.fit.bodies.map((b) => b.status)).toEqual(["clear", "clear"]);
    const f = r.features;
    expect(f.display_window).toMatchObject({ parts: ["lid"], ledge_mm: 2.6, frame: { origin: [0, 0, r.levels.top], normal: [0, 0, 1] } });
    expect(f.hr_window).toMatchObject({ parts: ["base"], frame: { normal: [0, 0, -1] } });
    expect(f.led_pipe).toMatchObject({ hole_d_mm: 1.7, frame: { normal: [1, 0, 0] } });
    // the strap clears the case where it passes under the bar: bar axis at case radius + 2 mm + bar radius
    const rOut = (r.cavity.radius as number) + 4.5;
    expect(f.lugs_12.frame!.origin[1]).toBeCloseTo(rOut + 2 + 0.75, 3);
    expect(f.lugs_6.frame!.origin[1]).toBeCloseTo(-(rOut + 2 + 0.75), 3);
    // the joint groove: Design Chart 4-2 depth, inner edge on the O-ring's ID (within +1 %), flat joint
    expect(f.case_seal).toMatchObject({ groove_depth_mm: 1.321, groove_width_mm: 2.641 });
    const stretch = (f.case_seal.groove_inner_perimeter_mm as number) / (f.case_seal.oring_inner_perimeter_mm as number) - 1;
    expect(stretch).toBeGreaterThanOrEqual(0);
    expect(stretch).toBeLessThanOrEqual(0.01);
    expect(f.back_joint).toMatchObject({ style: "flat", scheme: "screws", column_d_mm: 5.8 });
    expect(f.back_joint.screw_reach_mm as number).toBeLessThanOrEqual(RUTHEX_RX_M2X4.hole_depth_mm);
  });

  it("a flat seat for a plug on a round wall, and window covers as parts of their own", async () => {
    const dir = join(TMP, "seat");
    mkdirSync(dir, { recursive: true });
    // a 30 mm disc board with a receptacle at its -x edge, its mouth facing out at z 4
    writeFileSync(join(dir, "board.glb"), glbBoxes([{ name: "pcb", min: [-15, -15, 0], max: [15, 15, 1] }, { name: "usb", min: [-15.5, -4.5, 1], max: [-8, 4.5, 4.2] }, { name: "tall", min: [5, 5, 1], max: [8, 8, 7] }]));
    const r = await build(dir, job("seat", design({ wall: 1.4, joint: { style: "flat", lip_height: 0, clearance: 0 }, fasteners: "none" }), [{ key: "board", label: "Board", glb: "board.glb", digest: "-", matrix: T(0, 0, 0) }], [
      { id: "usb", kind: "opening", params: { shape: "rect", width_mm: 9.5, height_mm: 3.6, corner_radius_mm: 1.2, plug: USB_C_PLUG, seat: "flat" }, served: { key: "board", label: "board.usb", from: "model", frame: { origin: [-15.5, 0, 2.6], normal: [-1, 0, 0], xAxis: [0, -1, 0] } } },
      { id: "lens", kind: "window", params: { aperture: { diameter_mm: 20 }, cover: { diameter_mm: 24, thickness_mm: 0.5, material: "PMMA" } }, served: { key: "board", label: "board.top", from: "model", frame: { origin: [0, 0, 1], normal: [0, 0, 1] } } },
    ]));
    expect(r.problems).toEqual([]);
    const plug = r.features.usb.plug as { seat_gap_mm: number; seat?: { kind: string; proud_mm: number } };
    // the curve fell away under the overmold's ends; the seat fills it out to the plane through the opening
    expect(plug.seat_gap_mm).toBe(0);
    expect(plug.seat).toMatchObject({ kind: "flat", width_mm: 12.95 });
    expect(plug.seat!.proud_mm).toBeGreaterThan(0.5);
    for (const w of r.walls) expect(w.mm, `${w.feature}: ${w.what}`).toBeGreaterThanOrEqual(w.min_mm);
    // the cover: its own STEP, GLB and DXF outline, in its own frame (outer face at z 0, body along +z)
    expect(r.covers?.lens).toMatchObject({ part: "cover_lens", shape: "round", size_mm: [24], thickness_mm: 0.5, material: "PMMA", frame: { origin: [0, 0, 0], normal: [0, 0, 1] } });
    expect(r.covers!.lens.volume_mm3).toBeCloseTo(Math.PI * 12 * 12 * 0.5, 0);
    for (const ext of ["step", "glb", "dxf"]) expect(existsSync(join(dir, "build/covers", `cover_lens.${ext}`)), ext).toBe(true);
    // the section draws the case cut and the board
    expect(readFileSync(join(dir, "build/section.svg"), "utf8")).toMatch(/Board/);
  });

  it("openings across the lid joint: a sliver inside the wall is cut away, one on the outer face is reported", async () => {
    const dir = join(TMP, "joint");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "block.glb"), glbBoxes([{ name: "block", min: [-10, -8, 0], max: [10, 8, 6] }]));
    // cavity z 0.3 below the block to 6.3 above it; rabbet split at 4.8, tongue to 6.3, the lid over it from 6.4 (joint clearance 0.1)
    const d = design({ shape: "box", wall: 1.8, joint: { style: "rabbet", lip_height: 1.5, clearance: 0.1 } });
    const r = await build(dir, job("joint", d, [{ key: "block", label: "Block", glb: "block.glb", digest: "-", matrix: T(0, 0, 0) }], [
      // top at 5.75: the tongue would keep 0.55 mm over it
      { id: "high", kind: "opening", params: { shape: "rect", width_mm: 4, height_mm: 1 }, frame: { origin: [0, 0, 5.25], normal: [1, 0, 0] } },
      // top at 4.4: the base would keep 0.4 mm under the split on the outer face
      { id: "low", kind: "opening", params: { shape: "rect", width_mm: 4, height_mm: 1.8 }, frame: { origin: [0, 0, 3.5], normal: [-1, 0, 0] } },
    ]));
    expect(r.levels).toMatchObject({ split: 4.8, cavity_top: 6.3 });
    expect(r.features.high.margins_mm).toMatchObject({ cleared: [{ part: "base", band: "tongue", side: "above", mm: 0.55 }] });
    expect(r.walls.filter((w) => w.mm < w.min_mm)).toEqual([{ feature: "low", what: "base above the opening (lid skirt)", mm: 0.4, min_mm: 0.8 }]);
    const spec = {
      bridges: ["high", "low"].map((id) => {
        const f = r.features[id];
        const [w, h] = f.size_mm as number[];
        return { feature: id, parts: { base: join(dir, "build/parts/base.step"), lid: join(dir, "build/parts/lid.step") }, origin: f.frame!.origin, normal: f.frame!.normal, width: w, height: h, wall: 1.8, z_bottom: r.levels.bottom, z_top: r.levels.top };
      }),
    };
    writeFileSync(join(dir, "probe.json"), JSON.stringify(spec));
    const pr = spawnSync(PYTHON!, [join(HERE, "probe.py"), join(dir, "probe.json")], { encoding: "utf8", timeout: 300000 });
    const bridges = JSON.parse(pr.stdout).bridges as { feature: string; part: string; side: string; solids: number[] }[];
    const above = (id: string, part: string) => bridges.find((x) => x.feature === id && x.part === part && x.side === "above")!.solids;
    expect(above("high", "base")).toEqual([]);
    // the ledge left on the outer face is 0.4 mm; behind it the tongue keeps 1.9 mm
    expect(Math.min(...above("low", "base"))).toBe(0.4);
    expect(Math.max(...above("low", "base"))).toBe(1.9);
  });

  it("a bottle cap: internal thread, a lip face seal and a radial seal on the probe tube", async () => {
    const dir = join(TMP, "cap");
    mkdirSync(dir, { recursive: true });
    // the board has a cutout around the probe tube's gland boss (x 15, Ø11.0 boss)
    writeFileSync(join(dir, "board.glb"), glbBoxes([
      { name: "pcb_w", min: [-25, -25, 0], max: [9, 25, 1.6] },
      { name: "pcb_e", min: [21, -25, 0], max: [25, 25, 1.6] },
      { name: "pcb_s", min: [9, -25, 0], max: [21, -6, 1.6] },
      { name: "pcb_n", min: [9, 6, 0], max: [21, 25, 1.6] },
    ]));
    const lip = as568("AS568-138")!;
    const rod = as568("AS568-010")!;
    // thread values: SPI 63 mm finish as the smart-bottle project read it (T 61.62–62.51, E 59.23–60.12, 6 TPI), taken at their midpoints
    const r = await build(dir, job("cap", design({ wall: 3, floor: 3, lid: 2, clearance: 0.5, clearance_top: 0.5 }), [{ key: "board", label: "Board", glb: "board.glb", digest: "-", matrix: T(0, 0, 4.5) }], [
      { id: "neck", kind: "thread", params: { major_d_mm: 62.07, root_d_mm: 59.68, pitch_mm: 4.233, length_mm: 12 } },
      { id: "lip_seal", kind: "seal_gland", params: { type: "face", oring: lip, table: table("face", lip.w_mm) }, frame: { origin: [0, 0, 1], normal: [0, 0, -1] } },
      { id: "probe_seal", kind: "seal_gland", params: { type: "radial", rod_d_mm: 6.0, oring: rod, table: table("radial", rod.w_mm) }, frame: { origin: [15, 0, 1], normal: [0, 0, -1] } },
    ]));
    expect(r.levels.bottom).toBe(1);
    expect(r.problems).toEqual([]);
    expect(r.features.neck).toMatchObject({ pitch_mm: 4.233, skirt_length_mm: 12, frame: { origin: [0, 0, -11], normal: [0, 0, -1] } });
    expect(r.features.neck.turns as number).toBeGreaterThan(1.9);
    expect(r.features.neck.minor_d_mm as number).toBeGreaterThan(59.68);
    expect(r.features.lip_seal).toMatchObject({ parts: ["base"], groove_depth_mm: 1.956 });
    const squeeze = ((2.62 - 1.956) / 2.62) * 100;
    expect(squeeze).toBeGreaterThanOrEqual(20);
    expect(squeeze).toBeLessThanOrEqual(30);
    expect(r.features.probe_seal).toMatchObject({ bore_d_mm: 6.089, groove_d_mm: 8.591, parts: ["base"] });
    expect(r.fit.bodies[0].status).toBe("clear");
  });

  // a twist lid on a round shell: the radial collar seal and the lock, inside the shell's diameter
  const twistJob = (name: string, lock: Record<string, unknown>) => {
    const o = as568("AS568-040")!;
    return job(name, design({ wall: 4.3, floor: 3, lid: 2.5, clearance: 0.5, cavity: { centre: [0, 0], radius: 35.7, z: [3, 16] }, joint: { style: "twist", lip_height: 1.5, clearance: 0.15 } }), [], [
      { id: "lid_seal", kind: "seal_gland", params: { type: "radial", at: "joint", oring: o, table: table("radial", o.w_mm) } },
      { id: "lid_joint", kind: "twist_lid", params: lock },
    ]);
  };
  /** Volume shared by the built base and lid (they must not interfere), exactly. */
  const shared = (dir: string) => {
    const code = "import sys,build123d as bd; a=bd.import_step(sys.argv[1]); b=bd.import_step(sys.argv[2]); c=a & b; print(sum(s.volume for s in c.solids()) if c else 0.0)";
    const r = spawnSync(PYTHON!, ["-c", code, join(dir, "build/parts/base.step"), join(dir, "build/parts/lid.step")], { encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-3).join("\n"));
    return Number(r.stdout.trim());
  };

  /**
   * Volume of the base's lugs, pushed straight up through the lid's skirt, that the lid (turned by deg
   * about the axis, from its locked angle) would cut: none where every lug meets its slot's open end.
   */
  const lugsThroughLid = (dir: string, t: Record<string, unknown>, deg: number) => {
    const code = [
      "import sys,json,math,build123d as bd",
      "t=json.loads(sys.argv[2]); lid=bd.import_step(sys.argv[1]); deg=float(sys.argv[3])",
      "r0=t['bore_d_mm']/2+0.05; r1=t['collar_d_mm']/2+t['lug_depth_mm']-0.05; z0=t['collar_z_mm'][0]-1; z1=t['lug_z_mm'][1]",
      "lid=lid.rotate(bd.Axis.Z, deg); tot=0.0",
      "for a,w in zip(t['lug_angles_deg'], t['lug_widths_mm']):",
      "  sp=math.degrees(w/r1)-0.5",
      "  ring=bd.Pos(0,0,z0)*(bd.Cylinder(r1,z1-z0,align=(bd.Align.CENTER,bd.Align.CENTER,bd.Align.MIN))-bd.Cylinder(r0,z1-z0,align=(bd.Align.CENTER,bd.Align.CENTER,bd.Align.MIN)))",
      "  pts=[(0,0)]+[(2*r1*math.cos(math.radians(a-sp/2+sp*i/8)),2*r1*math.sin(math.radians(a-sp/2+sp*i/8))) for i in range(9)]",
      "  wedge=bd.Pos(0,0,z0)*bd.extrude(bd.Polygon(*pts,align=None),amount=z1-z0)",
      "  c=ring&wedge&lid",
      "  tot+=sum(s.volume for s in c.solids()) if c else 0.0",
      "print(tot)",
    ].join("\n");
    const r = spawnSync(PYTHON!, ["-c", code, join(dir, "build/parts/lid.step"), JSON.stringify(t), String(deg)], { encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-3).join("\n"));
    return Number(r.stdout.trim());
  };
  /** How many positions a bayonet's lid goes on in (the generator's own count). */
  const positions = (angles: number[], widths: number[], clr: number) => {
    const code = `import sys; sys.path.insert(0, sys.argv[1]); import enclosure_cad as m; print(m.bayonet_positions(${JSON.stringify(angles)}, ${JSON.stringify(widths)}, ${clr}, 38.0))`;
    const r = spawnSync(PYTHON!, ["-c", code, join(HERE, "../py")], { encoding: "utf8", timeout: 120000 });
    if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-3).join("\n"));
    return Number(r.stdout.trim());
  };

  it("a bayonet's lid goes on in one position only when one lug is a key", () => {
    const at = [90, 210, 330];
    expect(positions(at, [6, 6, 6], 0.2)).toBe(3);
    expect(positions(at, [10, 6, 6], 0.2)).toBe(1);
    // a key no wider than a slot for the others (6 + 2 x 0.2) enters any slot
    expect(positions(at, [6.4, 6, 6], 0.2)).toBe(3);
    expect(positions([90, 180, 270, 0], [6, 6, 6, 6], 0.2)).toBe(4);
  });

  it("a bayonet lid: lugs on the base's collar, L-slots in the lid's skirt, a radial O-ring on the collar, all inside the shell's Ø", async () => {
    const dir = join(TMP, "bayonet");
    const r = await build(dir, twistJob("bayonet", { lock: "bayonet", lugs: 3, lug_width_mm: 6, key_lug_width_mm: 10, lug_depth_mm: 1, lug_height_mm: 2, twist_deg: 30, bore_allowance_mm: 0.1 }));
    expect(r.problems).toEqual([]);
    // the shell stays Ø80: no screw lugs, no columns
    expect(r.overall.max[0] - r.overall.min[0]).toBeCloseTo(80, 3);
    expect(r.overall.max[1] - r.overall.min[1]).toBeCloseTo(80, 3);
    const t = r.features.lid_joint;
    expect(t).toMatchObject({ kind: "twist_lid", lock: "bayonet", lugs: 3, lug_angles_deg: [90, 210, 330], lug_widths_mm: [10, 6, 6], keyed: true, lid_positions: 1, twist_deg: 30, outer_d_mm: 80, collar_d_mm: 76, skirt_behind_slot_mm: 0.8, parts: ["base"] });
    // the bore is drawn 0.1 mm (radial) over the size it prints at; the O-ring's fit is Parker's at the printed bore
    expect(t).toMatchObject({ bore_d_mm: 76.289, printed_bore_d_mm: 76.089, bore_allowance_mm: 0.1, seal_fit_mm: 0.089 });
    // the lid goes down over the lugs at its unlocked angle (turned back by the twist), and at no other
    // angle a lug meets a slot: turned a third of a turn, the key meets a narrow slot
    expect(lugsThroughLid(dir, t, 30)).toBeLessThan(1e-3);
    expect(lugsThroughLid(dir, t, 150)).toBeGreaterThan(0.5);
    expect(lugsThroughLid(dir, t, 270)).toBeGreaterThan(0.5);
    expect(String((t.print as Record<string, string>).lid)).toMatch(/upside down, its top on the bed/);
    // collar levels: the lugs low, the O-ring's groove above them (the slots never cross the sealing bore)
    const seal = r.features.lid_seal;
    expect((seal.groove_z_mm as number[])[0]).toBeGreaterThan((t.lug_z_mm as number[])[1]);
    expect(seal).toMatchObject({ type: "radial", at: "joint", oring: "AS568-040", bore_d_mm: 76.289, printed_bore_d_mm: 76.089, parts: ["base"] });
    expect(seal.stretch_pct as number).toBeGreaterThan(0);
    expect(seal.stretch_pct as number).toBeLessThan(5);
    // the check passes the seal against Parker's radial chart, and the walls
    const def: ModuleDef = { id: "bayonet", name: "bayonet", interfaces: [SealGland({ id: "lid_seal", type: "radial", oring: "AS568-040", at: "joint" }), TwistLid({ id: "lid_joint", lock: "bayonet" })] };
    const recorded = twistJob("bayonet", { lock: "bayonet", lugs: 3, lug_width_mm: 6, key_lug_width_mm: 10, lug_depth_mm: 1, lug_height_mm: 2, twist_deg: 30, bore_allowance_mm: 0.1 });
    mkdirSync(join(dir, "n"), { recursive: true });
    writeFileSync(join(dir, "n/bayonet.job.json"), JSON.stringify(recorded));
    writeFileSync(join(dir, "n/bayonet.report.json"), JSON.stringify(r));
    const found = await checkEnclosure({ p: fakeProject(dir, def), def, native: "n", config: "cad.config.ts", current: { job: recorded, problems: [], input: [], notes: [] } });
    expect(found.filter((d) => /SEAL|THIN_WALL|GENERATOR/.test(d.code) && d.severity !== "info")).toEqual([]);
    // the risk of the allowance is stated: a bore that prints true leaves the O-ring squeezed less
    expect(found.find((d) => d.code === "ENCLOSURE_SEAL_SQUEEZE" && d.severity === "info")?.message).toMatch(/drawn 0.1 mm \(radial\).*if it prints at its drawn Ø76.289/);
    // the lid locks on the lugs without interfering with the base
    expect(shared(dir)).toBeLessThan(1e-3);
  });

  it("a threaded lid: an external thread on the collar, the lid's inside it, the O-ring under the thread", async () => {
    const dir = join(TMP, "threaded");
    const r = await build(dir, twistJob("threaded", { lock: "thread", pitch_mm: 2, turns: 2 }));
    expect(r.problems).toEqual([]);
    expect(r.overall.max[0] - r.overall.min[0]).toBeCloseTo(80, 3);
    const t = r.features.lid_joint;
    expect(t).toMatchObject({ lock: "thread", pitch_mm: 2, turns: 2, flank_angle_deg: 30 });
    // the skirt's bore clears the base's thread on the way down to the O-ring
    expect(t.bore_d_mm as number).toBeGreaterThan(t.major_d_mm as number);
    expect((r.features.lid_seal.groove_z_mm as number[])[1]).toBeLessThan((t.thread_z_mm as number[])[0]);
    expect(shared(dir)).toBeLessThan(1e-3);
  });

  it("a twist lid is round, takes no screws, and is the only lid joint", () => {
    const tl = readFeatures({ id: "x", name: "x", version: "0", interfaces: [TwistLid({ id: "lid_joint", lock: "bayonet" })] } as ModuleDef).features;
    expect(designOf({ wall_mm: 3, shape: "round" }, "print", tl).problems).toEqual([]);
    expect(designOf({ wall_mm: 3, shape: "round" }, "print", tl).design.joint.style).toBe("twist");
    expect(designOf({ wall_mm: 3, shape: "box" }, "print", tl).problems).toEqual(['a twist lid needs a round enclosure (shape "round"), not "box"']);
    expect(designOf({ wall_mm: 3, shape: "round", fasteners: "screws" }, "print", tl).problems).toContain('a twist lid needs no screws: fasteners must be "none"');
    expect(designOf({ wall_mm: 3, shape: "round", joint: { style: "twist" } }, "print", []).problems).toEqual(['joint.style "twist" needs a TwistLid interface in the module']);
  });
});


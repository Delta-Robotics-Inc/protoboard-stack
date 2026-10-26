/**
 * ext-enclosure-cad (PB-821): a `cad` provider for enclosures.
 *
 * Without Python: the cited tables, the feature vocabulary, and the job the
 * provider builds from a synthetic device (test/fixture.ts: a board on four
 * insert bosses, a cell under it, a USB-C opening and two buttons).
 *
 * With Python and build123d (PROTOBOARD_PYTHON, or a fallback:
 * core/test/cad-python.ts; skipped, and said so, otherwise):
 *   - the provider passes core's contract on the device: a two-part printed
 *     case (base and lid, plus the two plungers) whose fit checks pass; the
 *     built STEP files are probed exactly: the plungers clear the board and
 *     the cell, and no cut leaves a bridge thinner than the minimum wall;
 *   - a board 1 mm larger than the cavity is caught (collision and
 *     containment, plus the stale warning);
 *   - a served connector that moved is caught as misaligned.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkManifest, checkStl, checkThreeMf, loadProject, runCapabilityOperation, runProviderContract, type Project } from "@protoboardai/core";
import { Button, Opening, SealGland, StrapLugs, readFeatures } from "../lib/features.ts";
import { buildJob, designOf, invertRigid } from "../lib/job.ts";
import { axisOffset, jobChanges, type Report } from "../lib/check.ts";
import { ESSLINGER_82_2225, FACE_GLANDS, RADIAL_GLANDS, USB_C_PLUG, as568, glandRow, lugHole } from "../lib/standards.ts";
import { BOARD, BOSS_TOP, LED, boardBoxes, boardManifest, glbBoxes, writeFixture } from "./fixture.ts";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
// its own folder: features.test.ts uses .tmp/features, and the files run in parallel
const TMP = join(HERE, ".tmp", "provider");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PYTHON = cadPython();
const hasPy = !!PYTHON && spawnSync(PYTHON, ["-c", "import build123d, scipy"]).status === 0;
if (!hasPy) console.warn("enclosure-cad: no Python with build123d + scipy (set PROTOBOARD_PYTHON); the generator tests are skipped");

function fixture(name: string, overrides: Record<string, string | Buffer> = {}) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  writeFixture(dir, overrides);
  return dir;
}
const CASE = "src/enclosures/case";
const errors = (ds: { severity: string }[]) => ds.filter((d) => d.severity === "error");
const binding = (p: Project) => p.capabilities.find((b) => b.module === "fixture-case")!;

/** Exact probes of built STEP files (test/probe.py): part ∩ box volumes, and what each part keeps above and below a cut. */
function probe(dir: string, spec: unknown): { overlaps: number[]; bridges: { feature: string; part: string; side: string; solids: number[] }[] } {
  const file = join(dir, "probe.json");
  writeFileSync(file, JSON.stringify(spec));
  const r = spawnSync(PYTHON!, [join(HERE, "probe.py"), file], { encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-4).join("\n"));
  return JSON.parse(r.stdout);
}

describe("cited tables", () => {
  it("AS568 sizes match the Parker size table (metric columns)", () => {
    expect(as568("AS568-138")).toMatchObject({ size: "AS568-138", id_mm: 53.64, id_tol_mm: 0.43, w_mm: 2.62, w_tol_mm: 0.08 });
    expect(as568("-010")).toMatchObject({ id_mm: 6.07, w_mm: 1.78 });
    expect(as568("2-475")).toMatchObject({ id_mm: 658.88, w_mm: 6.99 });
    expect(as568("AS568-999")).toBeUndefined();
  });

  it("gland rows are Parker Design Charts 4-2 (face) and 4-1 (radial), converted from inches", () => {
    expect(glandRow("face", 1.78)).toMatchObject({ depth_mm: [1.27, 1.372], squeeze_pct: [19, 32], width_mm: [2.565, 2.718] });
    expect(glandRow("radial", 1.78)).toMatchObject({ depth_mm: [1.27, 1.321], squeeze_pct: [22, 32], clearance_mm: [0.051, 0.127] });
    expect(glandRow("face", 2.62)?.source).toMatch(/Design Chart 4-2/);
    expect(glandRow("face", 2.0)).toBeUndefined();
    // the stated squeeze range follows from W and L: (W − L) / W at the extremes
    for (const r of [...FACE_GLANDS, ...RADIAL_GLANDS]) {
      const lo = ((r.w_mm - r.w_tol_mm - r.depth_mm[1]) / (r.w_mm - r.w_tol_mm)) * 100;
      const hi = ((r.w_mm + r.w_tol_mm - r.depth_mm[0]) / (r.w_mm + r.w_tol_mm)) * 100;
      expect(Math.abs(lo - r.squeeze_pct[0])).toBeLessThan(3);
      expect(Math.abs(hi - r.squeeze_pct[1])).toBeLessThan(3);
    }
  });

  it("lug holes follow the spring bar's tips", () => {
    expect(lugHole(ESSLINGER_82_2225)).toEqual({ hole_d_mm: 1.0, hole_depth_mm: 1.8 });
  });
});

describe("feature vocabulary", () => {
  it("builds tool-neutral interfaces and reads them back", () => {
    const def = {
      id: "c",
      name: "C",
      interfaces: [
        Opening({ id: "usb", serves: { child: "board", interfaceId: "usb" }, widthMm: 9, heightMm: 3.5 }),
        SealGland({ id: "seal", type: "face", oring: "AS568-033", at: "joint" }),
        StrapLugs({ id: "lugs", end: "+y", springBar: ESSLINGER_82_2225 }),
        Button({ id: "b", serves: { child: "board", interfaceId: "sw" }, holeDiameterMm: 0 }),
        { id: "odd", name: "Odd", domain: "mechanical" as const, exposed: true, protocols: [], traits: [{ type: "enclosure_feature", params: { kind: "hinge" } }] },
      ],
    };
    const text = JSON.stringify(def);
    for (const tool of ["build123d", "onshape", "kicad", "tscircuit", "footprint"]) expect(text.toLowerCase()).not.toContain(tool);
    const { features, problems } = readFeatures(def);
    expect(features.map((f) => [f.id, f.kind])).toEqual([["usb", "opening"], ["seal", "seal_gland"], ["lugs", "strap_lugs"], ["b", "button"]]);
    expect(features[1].params.oring).toMatchObject({ size: "AS568-033", id_mm: 50.52 });
    // the lugs link to a spring bar part's bar (custom peer, capability strap_bar)
    expect(def.interfaces[2]).toMatchObject({ protocols: [{ type: "custom", roles: ["peer"] }], capabilities: ["strap_bar"] });
    expect(problems).toEqual([
      { interface: "b", message: "button needs hole_d_mm" },
      { interface: "odd", message: 'unknown feature kind "hinge" (known: opening, button, window, light_pipe, boss, seal_gland, thread, strap_lugs, joint, twist_lid)' },
    ]);
    expect(() => SealGland({ id: "x", type: "face", oring: "AS568-999", at: "joint" })).toThrow(/unknown O-ring/);
  });

  it("design values: defaults by process, and what the config must state", () => {
    expect(designOf({ wall_mm: 2 }, "print", []).design).toMatchObject({ wall: 2, floor: 2, lid: 2, clearance: 0.3, min_wall: 0.8, fasteners: "none", joint: { style: "rabbet" } });
    expect(designOf({}, "print", []).problems).toEqual(["constraint wall_mm (wall thickness) is required and must be positive"]);
    expect(designOf({ wall_mm: 2, fasteners: "screws" }, "print", []).problems[0]).toMatch(/needs a joint interface/);
    expect(designOf({ wall_mm: 2, fasteners: "snap" }, "print", []).problems[0]).toMatch(/snap fits are not generated yet/);
  });

  it("rigid transforms invert", () => {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    const m = [c, -s, 0, 4, s, c, 0, -2, 0, 0, 1, 7, 0, 0, 0, 1];
    const i = invertRigid(m);
    const back = [0, 1, 2].map((r) => [0, 1, 2, 3].map((k) => m[r * 4] * i[k] + m[r * 4 + 1] * i[4 + k] + m[r * 4 + 2] * i[8 + k] + m[r * 4 + 3] * (k === 3 ? 1 : 0)));
    expect(back.flat().map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(axisOffset({ origin: [0, 0, 0], normal: [1, 0, 0] }, { origin: [-2, 0.4, 0], normal: [1, 0, 0] })).toMatchObject({ lateral: 0.4, along: -2, angleDeg: 0 });
  });
});

describe("job from the synthetic device", async () => {
  const p = await loadProject(fixture("job"));
  const b = binding(p);
  const built = buildJob(p, { ...b, module: b.module! }, p.definitions.get("fixture-case")!.def);

  it("binds the case to the provider, with no model errors", () => {
    expect(b).toMatchObject({ capability: "cad", provider: "@protoboardai/ext-enclosure-cad", native: `${CASE}/build123d`, process: "print", instances: ["case"] });
    expect(errors(p.diagnostics.filter((d) => !d.validator.startsWith("ext:")))).toEqual([]);
    expect(built.problems).toEqual([]);
  });

  it("puts the board (its exported body) and the cell inside, in the case's coordinates", () => {
    const job = built.job!;
    expect(job.contents.map((c) => [c.key, c.glb])).toEqual([
      ["battery", "src/parts/cell.glb"],
      ["board", "src/boards/mainboard/out/board.glb"],
    ]);
    expect(job.contents.find((c) => c.key === "board")!.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 6, 0, 0, 0, 1]);
    expect(job.root).toBe("../../../..");
  });

  it("resolves what each feature serves from the board's manifest, and the boss holes from the bolt pattern", () => {
    const f = new Map(built.job!.features.map((x) => [x.id, x]));
    expect(f.get("usb_opening")!.served).toEqual({ key: "board", label: "board.usb", from: "manifest", frame: { origin: [15.5, 0, 9.23], normal: [1, 0, 0] } });
    expect(f.get("btn_b")!.served!.frame.origin).toEqual([8, 10.5, 9.25]);
    expect(f.get("board_mount")!.params.holes).toEqual([[-12.5, -9.5], [12.5, -9.5], [12.5, 9.5], [-12.5, 9.5]]);
    expect(f.get("board_mount")!.mates).toEqual(["board"]);
  });

  it("states what changed between two jobs", () => {
    const was = built.job!;
    const now = { ...was, contents: was.contents.map((c) => (c.key === "board" ? { ...c, digest: "sha256:other" } : c)), features: was.features.filter((x) => x.id !== "btn_b") };
    expect(jobChanges(was, now)).toEqual(["board body changed", "feature btn_b removed"]);
  });

  it("reports the case as not generated yet", () => {
    expect(p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check").map((d) => d.code)).toEqual(["ENCLOSURE_NOT_GENERATED"]);
  });
});

describe("job from the other builders: window, light pipe, strap lugs, thread, seal glands", async () => {
  // the same device, its case rewritten as a round case using the builders the device's own case does not
  const round = `import { InsertBosses, LightPipe, SealGland, StrapLugs, Thread, Window, ESSLINGER_82_2225, RUTHEX_RX_M2X4 } from "@protoboardai/ext-enclosure-cad/lib/index.ts";
export const CASE = {
  id: "fixture-case",
  name: "Fixture case",
  interfaces: [
    LightPipe({ id: "led_pipe", serves: { child: "board", interfaceId: "led" }, diameterMm: 1.5, clearanceMm: 0.1 }),
    Window({ id: "status_window", aperture: { diameterMm: 3 }, cover: { diameterMm: 5, thicknessMm: 0.5, material: "PMMA" }, side: "inside", frame: { origin: [0, 0, 12], normal: [0, 0, 1] } }),
    StrapLugs({ id: "lugs", end: "+y", springBar: ESSLINGER_82_2225, strapGapMm: 1.5 }),
    Thread({ id: "neck", majorDiameterMm: 62.07, rootDiameterMm: 59.68, pitchMm: 4.233, lengthMm: 12, assumption: "SPI 63 mm finish, mid-tolerance" }),
    SealGland({ id: "seal", type: "face", oring: "AS568-034", at: "joint" }),
    SealGland({ id: "probe_seal", type: "radial", oring: "AS568-010", rodDiameterMm: 6, frame: { origin: [15, 0, 1], normal: [0, 0, -1] } }),
    InsertBosses({ id: "board_mount", shape: "rectangle", spacingMm: 25, spacingYmm: 19, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2, insert: RUTHEX_RX_M2X4, frame: { origin: [0, 0, 6], normal: [0, 0, 1] } }),
  ],
};
`;
  const config = `import { defineCapabilityConfig } from "@protoboardai/core";
export default defineCapabilityConfig({ provider: "@protoboardai/ext-enclosure-cad", process: "machine", constraints: { wall_mm: 3, shape: "round", fasteners: "none" } });
`;
  const p = await loadProject(fixture("builders", { [`${CASE}/case.uhd.ts`]: round, [`${CASE}/cad.config.ts`]: config }));
  const b = binding(p);
  const built = buildJob(p, { ...b, module: b.module! }, p.definitions.get("fixture-case")!.def);
  const f = new Map((built.job?.features ?? []).map((x) => [x.id, x]));

  it("reads every feature, with nothing wrong", () => {
    expect(built.problems).toEqual([]);
    expect(built.job!.process).toBe("machine");
    expect(built.job!.design).toMatchObject({ shape: "round", wall: 3, fasteners: "none" });
    expect([...f.keys()]).toEqual(["led_pipe", "status_window", "lugs", "neck", "seal", "probe_seal", "board_mount"]);
  });

  it("light pipe: its size, on the axis of the LED from the board's manifest", () => {
    expect(f.get("led_pipe")).toMatchObject({ kind: "light_pipe", params: { diameter_mm: 1.5, clearance_mm: 0.1 } });
    expect(f.get("led_pipe")!.served).toEqual({ key: "board", label: "board.led", from: "manifest", frame: { origin: [LED.x, LED.y, BOSS_TOP + BOARD.t + LED.h], normal: [0, 0, 1] } });
  });

  it("window: aperture, cover and pocket side as the generator reads them", () => {
    expect(f.get("status_window")).toMatchObject({ kind: "window", frame: { origin: [0, 0, 12], normal: [0, 0, 1] }, params: { aperture: { diameter_mm: 3 }, cover: { diameter_mm: 5, thickness_mm: 0.5, material: "PMMA" }, side: "inside" } });
  });

  it("strap lugs: the strap and bar from the cited spring bar, the holes from its tips", () => {
    expect(f.get("lugs")!.params).toMatchObject({ end: "+y", strap_width_mm: 22, bar_d_mm: 1.5, ...lugHole(ESSLINGER_82_2225), strap_gap_mm: 1.5, spring_bar: { name: ESSLINGER_82_2225.name } });
  });

  it("thread: the neck's values and their assumption", () => {
    expect(f.get("neck")!.params).toEqual({ major_d_mm: 62.07, root_d_mm: 59.68, pitch_mm: 4.233, length_mm: 12, assumption: "SPI 63 mm finish, mid-tolerance" });
  });

  it("seal glands: the AS568 O-ring and the gland chart row for its cross-section", () => {
    const row = (type: "face" | "radial", w: number) => {
      const r = glandRow(type, w)!;
      return { depth_mm: r.depth_mm, width_mm: r.width_mm, squeeze_pct: r.squeeze_pct, ...(r.clearance_mm ? { clearance_mm: r.clearance_mm } : {}), source: r.source };
    };
    expect(f.get("seal")!.params).toEqual({ type: "face", at: "joint", oring: as568("AS568-034"), table: row("face", as568("AS568-034")!.w_mm) });
    expect(f.get("probe_seal")!.params).toEqual({ type: "radial", rod_d_mm: 6, oring: as568("AS568-010"), table: row("radial", 1.78) });
    expect(f.get("probe_seal")!.frame).toEqual({ origin: [15, 0, 1], normal: [0, 0, -1] });
  });
});

describe.skipIf(!hasPy)("enclosure generation with build123d", () => {
  const prev = process.env.PROTOBOARD_PYTHON;
  beforeAll(() => {
    process.env.PROTOBOARD_PYTHON = PYTHON;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PROTOBOARD_PYTHON;
    else process.env.PROTOBOARD_PYTHON = prev;
  });
  const dir = fixture("gen");
  let report: Report;

  it("passes the cad provider contract: a two-part printed case whose fit checks pass", async () => {
    const p = await loadProject(dir);
    const r = await runProviderContract(p, "cad", "case", { record: false });
    expect(r.steps.flatMap((s) => s.problems)).toEqual([]);
    expect(r.passed).toBe(true);

    report = JSON.parse(readFileSync(join(dir, CASE, "build123d/fixture-case.report.json"), "utf8"));
    expect(Object.keys(report.parts)).toEqual(["base", "lid", "plunger_btn_a", "plunger_btn_b"]);
    expect(Object.values(report.parts).every((x) => x.printed)).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.fit.bodies.map((b) => [b.key, b.status, b.basis, b.outside_cavity_mm])).toEqual([
      ["battery", "clear", "exact", 0],
      ["board", "clear", "exact", 0],
    ]);
    // the cavity is the contents plus the clearance, so the closest any body comes is the clearance itself
    expect(Math.min(...report.fit.bodies.map((b) => b.min_clearance_mm!))).toBeCloseTo(0.3, 3);
    // the rabbet's tongue and the lid's skirt are each (1.7 - 0.1) / 2 mm: the minimum wall
    expect(report.walls.filter((w) => w.feature === "lid_joint" && /tongue|skirt/.test(w.what)).map((w) => w.mm)).toEqual([0.8, 0.8]);
    for (const w of report.walls) expect(w.mm, `${w.feature}: ${w.what}`).toBeGreaterThanOrEqual(w.min_mm);

    // the plungers: their flanges trimmed to clear the board and the lid, still held by the wall, and clear of every body inside and of the walls
    for (const b of ["btn_a", "btn_b"]) {
      expect(report.features[b]).toMatchObject({ flange_trimmed_by: ["board", "lid"], wall_overlap_mm3: { base: 0, lid: 0 } });
      expect(report.features[b].flange_hold_pct as number).toBeGreaterThanOrEqual(50);
    }
    expect(report.fit.plungers!.map((x) => [x.key, x.status, x.near])).toEqual([
      ["plunger_btn_a", "clear", "board"],
      ["plunger_btn_b", "clear", "board"],
    ]);
    const build = join(dir, CASE, "build123d/build/parts");
    const pcb = { min: [-BOARD.w / 2, -BOARD.h / 2, BOSS_TOP], max: [BOARD.w / 2, BOARD.h / 2, BOSS_TOP + BOARD.t] };
    const cell = { min: [-10, -7, 1], max: [10, 7, 5] };
    const exact = probe(dir, {
      overlaps: ["btn_a", "btn_b"].flatMap((b) => [pcb, cell].map((box) => ({ part: join(build, `plunger_${b}.step`), box }))),
      // every cut through a side wall: no part keeps a bridge thinner than the minimum wall above or below it
      bridges: ["usb_opening", "btn_a", "btn_b"].map((id) => {
        const f = report.features[id];
        const [w, h] = f.kind === "opening" ? (f.size_mm as number[]) : [f.hole_d_mm as number, f.hole_d_mm as number];
        return { feature: id, parts: { base: join(build, "base.step"), lid: join(build, "lid.step") }, origin: f.frame!.origin, normal: f.frame!.normal, width: w, height: h, wall: f.wall_mm, z_bottom: report.levels.bottom, z_top: report.levels.top };
      }),
    });
    expect(exact.overlaps).toEqual([0, 0, 0, 0]);
    for (const b of exact.bridges) for (const dz of b.solids) expect(dz, `${b.feature}: ${b.part} ${b.side}`).toBeGreaterThanOrEqual(0.8 - 1e-3);
    // over the opening and the bores the base's tongue was cut back (it would have kept 0.02 mm and 0.7 mm), so the base keeps nothing above them
    expect(exact.bridges.filter((b) => b.part === "base" && b.side === "above").map((b) => b.solids)).toEqual([[], [], []]);
    expect((report.features.usb_opening.margins_mm as { cleared: unknown[] }).cleared).toEqual([{ part: "base", band: "tongue", side: "above", mm: 0.02 }]);
    expect((report.features.btn_a.margins_mm as { cleared: unknown[] }).cleared).toEqual([{ part: "base", band: "tongue", side: "above", mm: 0.7 }]);
    // the USB-C plug passes the opening and its overmold seats on the flat face
    expect(report.features.usb_opening.plug).toMatchObject({ name: USB_C_PLUG.name, passes: true });
    expect((report.features.usb_opening.plug as { seat_mm: number }).seat_mm).toBeGreaterThan(0);

    // standard outputs: body, manifest bound to the interfaces, STL and 3MF per printed part
    const out = join(dir, CASE, "out");
    const manifest = JSON.parse(readFileSync(join(out, "body.manifest.json"), "utf8"));
    expect(checkManifest(manifest)).toEqual([]);
    expect(Object.keys(manifest.features).sort()).toEqual(["board_mount", "btn_a", "btn_b", "lid_joint", "usb_opening"]);
    for (const part of ["base", "lid", "plunger_btn_a", "plunger_btn_b"]) {
      expect(checkStl(readFileSync(join(out, `${part}.stl`)))).toEqual([]);
      expect(checkThreeMf(readFileSync(join(out, `${part}.3mf`)))).toEqual([]);
    }

    // extract: generated frames by interface id; the opening sits on the +X wall on the receptacle's axis
    const ex = r.steps.find((s) => s.operation === "extract")!.record.data as { frames: Record<string, { origin: number[]; normal: number[] }>; artifacts: { id: string }[] };
    expect(ex.frames.usb_opening).toMatchObject({ origin: [report.outer.max[0], 0, 9.23], normal: [1, 0, 0] });
    expect(ex.frames.board_mount).toMatchObject({ origin: [0, 0, 6], normal: [0, 0, 1] });
    expect(ex.artifacts.map((a) => a.id)).toEqual(expect.arrayContaining(["cad_source", "cad_step", "cad_glb", "cad_manifest", "base_stl", "lid_3mf"]));

    // recess and plunger facts the checks read
    expect(report.features.usb_opening.recess_mm).toBeCloseTo(1.7 + 0.3, 6);
    expect(report.features.btn_a).toMatchObject({ gap_mm: 0.1, plunger: "plunger_btn_a" });
  });

  it("check, through the project, finds nothing wrong with the design it generated", async () => {
    const p = await loadProject(dir);
    const run = p.checks.find((c) => c.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check");
    expect(run).toMatchObject({ status: "ran", subject: "fixture-case", counts: { error: 0, warning: 0 } });
    expect(errors(p.diagnostics)).toEqual([]);
  });

  it("a board 1 mm larger than the cavity is caught", async () => {
    // the cavity is asymmetric about the board (the receptacle overhangs +X), so the -X side reaches furthest
    const big = report.cavity.max[0] - report.cavity.min[0] + 1;
    const outside = Math.round((big / 2 + report.cavity.min[0]) * 100) / 100;
    writeFileSync(join(dir, "src/boards/mainboard/out/board.glb"), glbBoxes(boardBoxes(big, BOARD.h)));
    try {
      const p = await loadProject(dir);
      const ds = p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check");
      expect(ds.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["ENCLOSURE_NOT_CONTAINED", "ENCLOSURE_COLLISION"]);
      expect(ds.find((d) => d.code === "ENCLOSURE_NOT_CONTAINED")!.message).toBe(`board (Fixture mainboard) reaches ${outside} mm outside the cavity at [${-big / 2}, -12, 6] (re-analysed against the current contents)`);
      expect(ds.find((d) => d.code === "ENCLOSURE_COLLISION")!.message).toMatch(/^board \(Fixture mainboard\) intersects the base \(cavity side\) by 0\.\d+ mm at .* \(exact\)$/);
      expect(ds.find((d) => d.code === "ENCLOSURE_STALE")!.message).toMatch(/\(board body changed\)/);
    } finally {
      writeFileSync(join(dir, "src/boards/mainboard/out/board.glb"), glbBoxes(boardBoxes()));
    }
  });

  it("a connector that moved is caught as misaligned with its opening", async () => {
    const m = boardManifest();
    m.features.usb.centroid = [m.features.usb.centroid[0], 1.0, m.features.usb.centroid[2]];
    writeFileSync(join(dir, "src/boards/mainboard/out/board.manifest.json"), JSON.stringify(m));
    try {
      const p = await loadProject(dir);
      const ds = p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check");
      expect(ds.filter((d) => d.severity === "error").map((d) => [d.code, d.entity, d.message])).toEqual([
        ["ENCLOSURE_MISALIGNED", { kind: "interface", id: "fixture-case:usb_opening" }, "usb_opening is 1 mm / 0.0° off the axis of board.usb (allowed 0.3 mm / 2°)"],
      ]);
      expect(ds.find((d) => d.code === "ENCLOSURE_STALE")!.message).toMatch(/feature usb_opening changed \(what it serves moved\)/);
    } finally {
      writeFileSync(join(dir, "src/boards/mainboard/out/board.manifest.json"), JSON.stringify(boardManifest(), null, 2));
    }
  });

  it("generates the same files again from the same model", async () => {
    const p = await loadProject(dir);
    const rec = await runCapabilityOperation(p, "cad", "generate", "case", {}, { record: false });
    expect(rec.status).toBe("succeeded");
    const build = join(dir, CASE, "build123d/build");
    const out = join(dir, CASE, "out");
    for (const [b, o] of [["body.step", "body.step"], ["body.glb", "body.glb"], ["body.manifest.json", "body.manifest.json"], ["parts/base.stl", "base.stl"], ["parts/lid.3mf", "lid.3mf"]]) {
      expect(readFileSync(join(build, b)).equals(readFileSync(join(out, o))), b).toBe(true);
    }
  });

  it("export rebuilds from a hand-edited native design, and check reports the drift", async () => {
    const jobFile = join(dir, CASE, "build123d/fixture-case.job.json");
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    job.design.wall = 2.0;
    writeFileSync(jobFile, JSON.stringify(job, null, 2));
    let p = await loadProject(dir);
    const rec = await runCapabilityOperation(p, "cad", "export", "case", {}, { record: false });
    expect(rec.status).toBe("succeeded");
    expect(rec.summary).toMatch(/rebuilt from the edited native design/);
    p = await loadProject(dir);
    const codes = p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-enclosure-cad/cad:check").map((d) => d.code);
    expect(codes).toContain("ENCLOSURE_STALE");
  });
});

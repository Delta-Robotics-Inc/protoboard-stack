/**
 * M4 exit criteria for the frame-cad extension (PB-798), as a provider of the
 * `cad` capability (PB-822), exercised through the CLI on copies of the
 * quadcopter project:
 *   - a missing CAD runtime is reported by `doctor` and refuses `run`;
 *   - with build123d present, `run cad:generate` and `cad:export` regenerate
 *     the frame and top plate byte for byte into each module's out/, the
 *     `frame-cad` alias writes the same files, the provider passes core's
 *     contract, and `check` stays at 0 errors (the bindings still match);
 *   - a design change makes the CAD stale, an export older than the design
 *     is reported, regenerating shows the changed bindings, and explicit
 *     re-binding brings `check` back to 0 errors;
 *   - a plate module with no cad.config.ts is reported, and the alias says
 *     how to add one.
 * The runtime-present tests need Python with build123d: PROTOBOARD_PYTHON, or
 * a fallback (core/test/cad-python.ts); they are skipped (and say so) otherwise.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BoltPattern, type ModuleDef } from "@deltarobotics/uhd";
import { loadProject, runProviderContract } from "@protoboardai/core";
import { buildParams, type PlateParams } from "../lib/params.ts";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const QUAD = join(REPO, "examples/quadcopter-5in");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
// its own folder: other test files here work in .tmp at the same time, and this one removes TMP when it ends
const TMP = join(HERE, ".tmp/frame-cad");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PYTHON = cadPython();
const hasBuild123d = !!PYTHON && spawnSync(PYTHON, ["-c", "import build123d"]).status === 0;
if (!hasBuild123d) console.warn("frame-cad: no Python with build123d (set PROTOBOARD_PYTHON); runtime-present tests are skipped");

/** A copy of the quadcopter project (its packages resolve from the repo's node_modules). */
function copyQuad(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.protoboard|\.claude)$/.test(src) && !/[/\\]operations[/\\]/.test(src) });
  // extend the repo's base by absolute path, so the copy also loads in-process
  writeFileSync(join(dir, "tsconfig.json"), readFileSync(join(QUAD, "tsconfig.json"), "utf8").replace("../../tsconfig.base.json", join(REPO, "tsconfig.base.json")));
  return dir;
}

/** The CLI in a child process, without blocking the test worker (each CAD run takes seconds). */
function pb(dir: string, args: string[], env: Record<string, string | undefined> = {}): Promise<{ status: number | null; json: any; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => resolve({ status, json: JSON.parse(out || "null"), stderr: err }));
  });
}
const errors = (check: { diagnostics: { severity: string; code: string }[] }) => check.diagnostics.filter((d) => d.severity === "error");

const FRAME = "src/modules/frame";
const TOP = "src/modules/top-plate";
/** Every file the cad capability writes for a plate: its native design and its standard outputs. */
const plateFiles = (dir: string, interfaces: string[]) => [
  `${dir}/frame-cad/params.json`,
  `${dir}/frame-cad/frames.json`,
  ...["body.step", "body.glb", "body.dxf", "body.manifest.json"].map((f) => `${dir}/out/${f}`),
  ...interfaces.map((i) => `${dir}/out/interfaces/${i}.glb`),
];
const FRAME_INTERFACES = ["camera_mount", "motor_mount_fl", "motor_mount_fr", "motor_mount_rl", "motor_mount_rr", "stack_mount", "standoff_mount", "vtx_mount"];
const ALL_FILES = [...plateFiles(FRAME, FRAME_INTERFACES), ...plateFiles(TOP, ["gps_mount", "standoff_mount"])].sort();
const differs = (dir: string, paths: string[]) => paths.filter((p) => !readFileSync(join(dir, p)).equals(readFileSync(join(QUAD, p))));
const tree = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort() : []);

describe("missing CAD runtime", () => {
  const dir = copyQuad("missing");
  const bad = { PROTOBOARD_PYTHON: "/nonexistent/python3" };

  it("doctor reports python-build123d as missing, with an install hint", async () => {
    const { json } = await pb(dir, ["doctor"], bad);
    // several extensions declare the tool (ext-parts, ext-frame-cad, ext-harness-cad): each is reported missing
    const tools = json.tools.filter((t: { id: string }) => t.id === "python-build123d");
    expect(tools.find((t: { extension: string }) => t.extension === "@protoboardai/ext-frame-cad")).toMatchObject({ available: false });
    for (const tool of tools) expect(tool).toMatchObject({ available: false, install: expect.stringMatching(/build123d/) });
  });

  it("cad:generate and the frame-cad alias are refused before anything runs: no CAD written, no operation record", async () => {
    const before = tree(join(dir, FRAME));
    for (const args of [["run", "cad:generate", "--module", "quadcopter-5in-frame"], ["run", "frame-cad"]]) {
      const { status, json } = await pb(dir, args, bad);
      expect(status).toBe(1);
      expect(json).toMatchObject({ status: "refused", outputs: [], tools: [{ id: "python-build123d", available: false }] });
      expect(json.summary).toMatch(/required tool\(s\) unavailable: python-build123d/);
    }
    expect(tree(join(dir, FRAME))).toEqual(before);
    expect(existsSync(join(dir, "operations")) ? readdirSync(join(dir, "operations")) : []).toEqual([]);
  });

  it("check still runs the provider's check (it needs no runtime)", async () => {
    const check = (await pb(dir, ["check"], bad)).json;
    expect(errors(check)).toEqual([]);
    const runs = check.checks.filter((c: { validator: string }) => c.validator === "ext:@protoboardai/ext-frame-cad/cad:check");
    // the two plates and the twelve pieces of mounting hardware (parts/local)
    const ran = runs.map((c: { subject: string; status: string }) => `${c.subject} ${c.status}`);
    expect(ran).toHaveLength(14);
    expect(ran).toEqual(expect.arrayContaining(["quadcopter-5in-frame ran", "quadcopter-5in-top-plate ran", "iso-4762-m3x8 ran", "meps-m5-flanged-lock-nut ran"]));
  });
});

describe.skipIf(!hasBuild123d)("frame generation with build123d", () => {
  const env = { PROTOBOARD_PYTHON: PYTHON };

  it("doctor reports the runtime", async () => {
    const { json } = await pb(copyQuad("doctor"), ["doctor"], env);
    expect(json.tools.find((t: { id: string }) => t.id === "python-build123d")).toMatchObject({ available: true, detail: expect.stringMatching(/^build123d \d/) });
  });

  it("cad:generate and cad:export regenerate the frame and top plate byte for byte; check stays at 0 errors", async () => {
    const dir = copyQuad("regen");
    for (const dir_ of [FRAME, TOP]) rmSync(join(dir, dir_, "out"), { recursive: true, force: true }), rmSync(join(dir, dir_, "frame-cad"), { recursive: true, force: true });
    const written: string[] = [];
    for (const module of ["quadcopter-5in-frame", "quadcopter-5in-top-plate"]) {
      const gen = (await pb(dir, ["run", "cad:generate", "--module", module], env)).json;
      expect(gen).toMatchObject({ status: "succeeded", capability: { id: "cad", operation: "generate", provider: "@protoboardai/ext-frame-cad", module } });
      expect(gen.data.rebind).toEqual({ signatures: [], frames: [] });
      const exp = (await pb(dir, ["run", "cad:export", "--module", module], env)).json;
      expect(exp.status).toBe("succeeded");
      written.push(...[...gen.outputs, ...exp.outputs].map((o: { path: string }) => o.path));
    }
    expect(written.sort()).toEqual(ALL_FILES);
    expect(differs(dir, ALL_FILES)).toEqual([]);

    const check = (await pb(dir, ["check"])).json;
    expect(errors(check)).toEqual([]);
    for (const v of ["ext:@protoboardai/ext-frame-cad/cad:check", "protoboard/standard-outputs", "uhd/geometryBindings"]) {
      for (const c of check.checks.filter((x: { validator: string }) => x.validator === v)) expect(c, v).toMatchObject({ status: "ran", counts: { error: 0, warning: 0 } });
    }
  });

  it("the frame-cad alias writes the same files as generate and export", async () => {
    const dir = copyQuad("alias");
    const { status, json } = await pb(dir, ["run", "frame-cad"], env);
    expect(status).toBe(0);
    expect(json.status).toBe("succeeded");
    const modules = json.data.modules as { module: string; features: Record<string, unknown>; rebind: { signatures: unknown[]; frames: unknown[] } }[];
    expect(modules.map((m) => m.module)).toEqual(["quadcopter-5in-frame", "quadcopter-5in-top-plate"]);
    expect(Object.keys(modules[0].features).sort()).toEqual(FRAME_INTERFACES);
    for (const m of modules) expect(m.rebind).toEqual({ signatures: [], frames: [] });
    // the alias's own record writes nothing: each plate has its own cad:generate and cad:export record
    expect(json.outputs).toEqual([]);
    const steps = json.data.steps as { module: string; operation: string; record: string; outputs: string[] }[];
    expect(steps.map((s) => `${s.operation} ${s.module}`)).toEqual([
      "cad:generate quadcopter-5in-frame",
      "cad:generate quadcopter-5in-top-plate",
      "cad:export quadcopter-5in-frame",
      "cad:export quadcopter-5in-top-plate",
    ]);
    for (const s of steps) expect(JSON.parse(readFileSync(join(dir, s.record), "utf8"))).toMatchObject({ operation: s.operation, status: "succeeded", capability: { module: s.module } });
    const paths = steps.flatMap((s) => s.outputs).sort();
    expect(paths).toEqual(ALL_FILES);
    expect(differs(dir, paths)).toEqual([]);
  });

  it("passes the provider contract on both plates", async () => {
    const dir = copyQuad("contract");
    const p = await loadProject(dir);
    process.env.PROTOBOARD_PYTHON ??= PYTHON;
    for (const module of ["quadcopter-5in-frame", "quadcopter-5in-top-plate"]) {
      const report = await runProviderContract(p, "cad", module, { record: false });
      expect(report.steps.flatMap((s) => s.problems), module).toEqual([]);
      expect(report).toMatchObject({ passed: true, provider: "@protoboardai/ext-frame-cad" });
      const facts = report.steps.find((s) => s.operation === "extract")!.record.data as { frames: Record<string, { origin: number[] }>; artifacts: { id: string }[] };
      if (module === "quadcopter-5in-frame") {
        expect(facts.frames.stack_mount.origin).toEqual([0, 0, 5]);
        expect(facts.artifacts.map((a) => a.id)).toEqual(expect.arrayContaining(["cad_step", "cad_glb", "cad_manifest", "cad_dxf", "cad_params", "cad_frames", "cad_if_stack_mount"]));
      }
    }
    expect(differs(dir, ALL_FILES)).toEqual([]);
  });

  it("a design change: stale CAD, an export older than the design, changed bindings, explicit re-binding back to 0 errors", async () => {
    const dir = copyQuad("rebind");
    const src = join(dir, "src/modules/frame/frame.uhd.ts");
    const top = readFileSync(join(dir, TOP, "top-plate.uhd.ts"), "utf8");
    writeFileSync(src, readFileSync(src, "utf8").replace("plate_thickness_mm: 5,", "plate_thickness_mm: 6,"));

    // 1. the model changed, the CAD did not: a warning, not a silent pass
    let check = (await pb(dir, ["check"])).json;
    expect(check.diagnostics.find((d: { code: string }) => d.code === "FRAME_CAD_STALE")).toMatchObject({ validator: "ext:@protoboardai/ext-frame-cad/cad:check", severity: "warning" });
    expect(errors(check)).toEqual([]);

    // 2. regenerate the design only: out/ is now older than it
    const run = (await pb(dir, ["run", "cad:generate", "--module", "quadcopter-5in-frame"], env)).json;
    expect(run.status).toBe("succeeded");
    const rebind = run.data.rebind;
    expect(rebind.frames.find((f: { interface: string }) => f.interface === "stack_mount")).toMatchObject({ declared: [0, 0, 5], generated: [0, 0, 6] });
    expect(rebind.signatures.length).toBe(8);
    check = (await pb(dir, ["check"])).json;
    expect(check.diagnostics.map((d: { code: string }) => d.code)).toContain("FRAME_CAD_EXPORT_STALE");

    // 3. export: check refuses the stale bindings instead of accepting the new faces
    expect((await pb(dir, ["run", "cad:export", "--module", "quadcopter-5in-frame"], env)).json.status).toBe("succeeded");
    check = (await pb(dir, ["check"])).json;
    const codes = new Set(errors(check).map((d: { code: string }) => d.code));
    expect([...codes].sort()).toEqual(["FRAME_CAD_FRAME_MISMATCH", "UHD_GEOMETRY_BINDING"]);
    expect(check.diagnostics.map((d: { code: string }) => d.code)).not.toContain("FRAME_CAD_EXPORT_STALE");

    // 4. explicit re-binding, scoped to the frame (the top plate is untouched)
    const reb = (await pb(dir, ["run", "frame-cad-rebind", "--input", "module=quadcopter-5in-frame"])).json;
    expect(reb.status).toBe("succeeded");
    expect(reb.data.changes).toHaveLength(16);
    expect(reb.data.changes.every((c: { module: string }) => c.module === "quadcopter-5in-frame")).toBe(true);
    expect(readFileSync(src, "utf8")).toContain('feature("stack_mount", { area_mm2: 241.274, centroid: [0, 0, 3] })');
    expect(readFileSync(join(dir, TOP, "top-plate.uhd.ts"), "utf8")).toBe(top);

    check = (await pb(dir, ["check"])).json;
    expect(errors(check)).toEqual([]);
    expect(check.diagnostics.map((d: { code: string }) => d.code)).not.toContain("FRAME_CAD_STALE");
  });

  it("a plate module with no cad.config.ts is reported, and the alias says how to add one", async () => {
    const dir = copyQuad("unconfigured");
    rmSync(join(dir, TOP, "cad.config.ts"));
    const check = (await pb(dir, ["check"])).json;
    expect(check.diagnostics.find((d: { code: string }) => d.code === "FRAME_CAD_NOT_CONFIGURED")).toMatchObject({ severity: "info", entity: { id: "quadcopter-5in-top-plate" }, validator: "ext:@protoboardai/ext-frame-cad/frames" });
    const run = await pb(dir, ["run", "frame-cad"], env);
    expect(run.status).toBe(1);
    expect(run.json.summary).toMatch(/^quadcopter-5in-top-plate has no cad\.config\.ts naming @protoboardai\/ext-frame-cad.*defineCapabilityConfig/);
  });
});

describe("params from interfaces", () => {
  it("are derived from bolt patterns and frames, not from a vehicle", () => {
    const def = {
      id: "bracket",
      name: "Bracket",
      interfaces: [
        { ...BoltPattern({ id: "a", role: "structure", shape: "rectangle", spacingMm: 40, spacingYmm: 20, holeCount: 4, fastener: "M4", fastenerDiameterMm: 4 }), geometry: { frame: { origin: [10, 0, 3], normal: [0, 0, 1], xAxis: [0, 1, 0] } } },
        { ...BoltPattern({ id: "b", role: "structure", shape: "circle", spacingMm: 12, holeCount: 3, fastener: "M2", fastenerDiameterMm: 2 }), geometry: { frame: { origin: [60, 0, 3.5], normal: [0, 0, 1] } } },
        BoltPattern({ id: "c", role: "structure", shape: "square", spacingMm: 10, holeCount: 4, fastener: "M3", fastenerDiameterMm: 3 }),
      ],
      domains: [{ domain: "mechanical", metadata: { plate_thickness_mm: 3 } }],
    } as ModuleDef;
    const { params, problems } = buildParams(def, "bracket", { hole_clearance_mm: 0.15, outline_mm: { x: [-20, 80], y: [-30, 30] } }) as { params: PlateParams; problems: string[] };
    expect(problems).toEqual(["bracket.c: bolt pattern has no frame, so it cannot be placed (add geometry.frame)"]);
    const [a, b] = params.interfaces;
    expect(a).toMatchObject({ placement: "holes_top", fastener_d: 4, origin: [10, 0] });
    // rectangle rotated by its xAxis (+Y): 40 mm along Y, 20 mm along X
    expect(a.holes).toEqual([[20, -20], [20, 20], [0, 20], [0, -20]]);
    expect(b).toMatchObject({ placement: "pad", height: 0.5, hole_count: 3 });
    // design values come from the module config's constraints; the rest are the defaults
    expect(params.plate).toMatchObject({ thickness: 3, hole_clearance: 0.15, margin: 3, outline: { x: [-20, 80], y: [-30, 30] } });
  });
});

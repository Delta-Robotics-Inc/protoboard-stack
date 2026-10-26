/**
 * ext-harness-cad, a provider of the `cad` capability (PB-822): the routing
 * job is built from the assembled model, every routed harness in the
 * reference quadcopter is placed by the parts it lands on with each end still
 * meeting its part, its cad:check finds drift between the model, the route
 * and the export, and the generator lays a cable of a given length between
 * two pads clear of an obstacle. Through the CLI on copies of the quadcopter:
 * the provider passes core's contract, `cad:generate` and `cad:export`
 * reproduce the committed outputs byte for byte, with no other route on file,
 * and the harness-cad alias writes the same files.
 * The generator tests need Python with build123d (PROTOBOARD_PYTHON, or a
 * fallback: core/test/cad-python.ts); they are skipped, and say so, otherwise.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject, moduleDigest, runProviderContract } from "@protoboardai/core";
import { freshness } from "../../ext-release/lib/preconditions.ts";
import { buildJob, projectAssembly } from "../lib/job.ts";
import { routes } from "../checks/routes.ts";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const QUAD = join(REPO, "examples/quadcopter-5in");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/**
 * A copy of the quadcopter project (its packages resolve from the repo's
 * node_modules). It keeps .protoboard/display.json, which places the parts
 * no mechanical link reaches (battery, receiver, capacitor), and its
 * tsconfig extends the repo's base by absolute path, so it also loads
 * in-process.
 */
function copyQuad(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.claude|\.protoboard[/\\](cache|build))$/.test(src) && !/[/\\]operations[/\\]/.test(src) });
  return dir;
}
/** A child process that does not block the test worker (routing a cable can take a minute). */
function run(cmd: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...(PYTHON ? { PROTOBOARD_PYTHON: PYTHON } : {}) } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function pb(dir: string, args: string[]) {
  const r = await run(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir]);
  return { status: r.status, json: JSON.parse(r.stdout || "null"), stderr: r.stderr };
}
const generator = (args: string[]) => run(PYTHON!, [join(HERE, "../py/harness_cad.py"), ...args]);

const WIRE_HARNESSES = [
  "dji-o4-3in1-cable",
  "dolphinrc-sh8-fc-esc-cable",
  "dolphinrc-xt60-battery-lead",
  "matek-gh6p-gnss-lead",
  "meps-phase-leads-m1",
  "meps-phase-leads-m2",
  "meps-phase-leads-m3",
  "meps-phase-leads-m4",
  "panasonic-eeu-fr1v471-leads",
  "radiomaster-rp1-crsf-wire",
];
/** Every file the cad capability writes for a harness: its route and its standard outputs. */
const harnessFiles = (id: string) => [`src/harnesses/${id}/harness-cad/route.json`, ...["body.glb", "body.step", "body.manifest.json"].map((f) => `src/harnesses/${id}/out/${f}`)];
const differs = (dir: string, paths: string[]) => paths.filter((p) => !readFileSync(join(dir, p)).equals(readFileSync(join(QUAD, p))));
const codes = (ds: { code: string }[]) => ds.map((d) => d.code);

const PYTHON = cadPython();
const hasPy = !!PYTHON && spawnSync(PYTHON, ["-c", "import build123d, scipy"]).status === 0;
if (!hasPy) console.warn("harness-cad: no Python with build123d + scipy (set PROTOBOARD_PYTHON); the generator test is skipped");

describe("routing job from the quadcopter", async () => {
  const p = await loadProject(QUAD);
  const job = buildJob(p);
  // The GNSS body is Matek's vendor GLB, which its catalog revision does not
  // carry (terms not stated; see packages/core/test/project.test.ts), so the
  // routing job has no GNSS obstacle. Only that problem is tolerated, and only while the file is
  // a vendor artifact the project reports as unavailable.
  const missingVendorBody = (problem: string) => {
    const m = /: no GLB body to route around \((.+)\)$/.exec(problem);
    return !!m && /\/vendor\//.test(m[1]) && p.artifacts.some((a) => a.filePath === m[1] && a.present === false);
  };

  it("resolves every wire harness to two ends with one landing point per conductor", () => {
    expect(job.problems.filter((x) => !missingVendorBody(x))).toEqual([]);
    expect(job.harnesses.map((h) => h.path).sort()).toEqual(
      ["arm_fl_leads", "arm_fr_leads", "arm_rl_leads", "arm_rr_leads", "bulk_cap_leads", "dji_cable", "gnss_lead", "rx_wire", "stack/sh8_cable", "xt60_lead"].sort(),
    );
    for (const h of job.harnesses) {
      expect(h.ends).toHaveLength(2);
      for (const e of h.ends) expect(e.pins).toHaveLength(h.conductors.length);
    }
  });

  it("lands a soldered end on each composed pad, in slot order", () => {
    const rx = job.harnesses.find((h) => h.path === "rx_wire")!;
    const fc = rx.ends.find((e) => e.interfaceId === "end_fc")!;
    expect(fc.counterpart).toBe("stack.rx_fc_pads");
    // RX2 and TX2 on the FC's rear edge, 5 V and GND on its right edge
    expect(fc.pins.map((q) => q.at[0] < -30 || q.at[1] < -30)).toEqual([false, false, false, false]);
    expect(fc.termination.kind).toBe("solder");
  });

  it("places every routed harness from its parts, each end meeting its part", () => {
    const asm = projectAssembly(p);
    expect(asm.harnesses.length).toBe(job.harnesses.length);
    for (const h of asm.harnesses) {
      for (const e of h.ends) expect(["anchor", "matches"]).toContain(e.status);
    }
  });

  it("every wire harness is bound to this provider, and each one's cad:check finds nothing", async () => {
    expect(await routes(p)).toEqual([]);
    expect(p.capabilities.filter((b) => b.provider === "@protoboardai/ext-harness-cad").map((b) => b.module).sort()).toEqual(WIRE_HARNESSES);
    const runs = p.checks.filter((c) => c.validator === "ext:@protoboardai/ext-harness-cad/cad:check");
    expect(runs.map((c) => c.subject).sort()).toEqual(WIRE_HARNESSES);
    for (const c of runs) expect(c, c.subject).toMatchObject({ status: "ran", counts: { error: 0, warning: 0, info: 0 } });
    expect(p.diagnostics.filter((d) => d.validator === "protoboard/standard-outputs")).toEqual([]);
  });
});

describe("cad:check finds drift", () => {
  const SH8 = "src/harnesses/dolphinrc-sh8-fc-esc-cable";

  it("a model change: the route was generated for another length", async () => {
    const dir = copyQuad("drift-model");
    const src = join(dir, "src/harnesses/harnesses.uhd.ts");
    writeFileSync(src, readFileSync(src, "utf8").replace('cable(50, 8, undefined, { length_basis: "wire between the plug housings" })', 'cable(60, 8, undefined, { length_basis: "wire between the plug housings" })'));
    const p = await loadProject(dir);
    const found = p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-harness-cad/cad:check");
    expect(codes(found).sort()).toEqual(["HARNESS_ROUTE_LENGTH", "HARNESS_ROUTE_STALE"]);
    expect(found.find((d) => d.code === "HARNESS_ROUTE_STALE")!.message).toMatch(/^stack\/sh8_cable: the route was generated for a different length_mm; regenerate/);
  });

  it("an export older than the route, and a harness never routed", async () => {
    const dir = copyQuad("drift-files");
    const route = join(dir, SH8, "harness-cad/route.json");
    writeFileSync(route, readFileSync(route, "utf8").replace('"notes":[]', '"notes":["edited"]'));
    rmSync(join(dir, "src/harnesses/radiomaster-rp1-crsf-wire/harness-cad"), { recursive: true });
    const p = await loadProject(dir);
    const found = p.diagnostics.filter((d) => d.validator === "ext:@protoboardai/ext-harness-cad/cad:check");
    expect(found.map((d) => `${d.code} ${d.entity.id}`).sort()).toEqual(["HARNESS_EXPORT_STALE stack/sh8_cable", "HARNESS_NOT_ROUTED rx_wire"]);
  });

  it("a wire harness with no cad.config.ts is reported by the routes check", async () => {
    const dir = copyQuad("unconfigured");
    rmSync(join(dir, "src/harnesses/radiomaster-rp1-crsf-wire/cad.config.ts"));
    const found = await routes(await loadProject(dir));
    expect(found.map((d) => `${d.code} ${d.severity} ${d.entity.id}`)).toEqual(["HARNESS_NOT_CONFIGURED info rx_wire"]);
  });
});

describe.skipIf(!hasPy)("generator", () => {
  it("routes a 60 mm two-wire lead between two pads around a standoff, to length", async () => {
    mkdirSync(TMP, { recursive: true });
    const standoff = join(QUAD, "parts/local/m3-aluminium-standoff-30mm/out/body.glb");
    const pin = (x: number, y: number) => ({ position: "", at: [x, y, 2], out: [0, 0, 1] });
    const end = (id: string, x: number) => ({
      interfaceId: id,
      linkId: id,
      counterpart: id,
      connector: "solder_leads",
      termination: { kind: "solder" },
      pins: [{ ...pin(x, -2), position: "p1" }, { ...pin(x, 2), position: "p2" }],
      frame: { origin: [x, 0, 2], normal: [0, 0, -1], xAxis: [0, 1, 0] },
      counterpartFrame: { origin: [x, 0, 2], normal: [0, 0, 1], xAxis: [0, 1, 0] },
    });
    const job = {
      schema: "protoboard.harness-cad.job/v0",
      bodies: [{ key: "standoff", glb: standoff, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
      harnesses: [
        {
          id: "test-lead",
          path: "test_lead",
          name: "test lead",
          length_mm: 60,
          awg: 20,
          conductors: [
            { position: "p1", color: "#c8202a", od: 1.7, bare: false },
            { position: "p2", color: "#1a1a1a", od: 1.7, bare: false },
          ],
          pairs: [0, 1],
          build: { colors: ["red", "black"], bundle: "twisted", twist_pitch_mm: 20 },
          ends: [end("end_a", -25), end("end_b", 25)],
        },
      ],
      problems: [],
    };
    const jobFile = join(TMP, "job.json");
    writeFileSync(jobFile, JSON.stringify(job));
    const r = await generator([jobFile, TMP, "--no-step"]);
    expect(r.status, r.stderr).toBe(0);
    const summary = JSON.parse(r.stdout.trim().split("\n").pop()!);
    expect(summary.harnesses[0].status).not.toBe("failed");
    const m = JSON.parse(readFileSync(join(TMP, "test-lead.manifest.json"), "utf8"));
    expect(Math.abs(m.route_length_mm - 60)).toBeLessThan(1.5);
    expect(m.clearance_mm.min_conductor_surface).toBeGreaterThan(-0.2);
    expect(Object.keys(m.ends).sort()).toEqual(["end_a", "end_b"]);
    expect(existsSync(join(TMP, "test-lead.glb"))).toBe(true);
  }, 300000);

  it("routes in the system's order: a target is routed around the cables before it, which are routed again but not written", async () => {
    const dir = join(TMP, "order");
    mkdirSync(dir, { recursive: true });
    const pinAt = (p: number[]) => ({ position: "", at: p, out: [0, 0, 1] });
    const end = (id: string, at: number[]) => ({
      interfaceId: id,
      linkId: id,
      counterpart: id,
      connector: "solder_leads",
      termination: { kind: "solder" },
      pins: [{ ...pinAt(at), position: "p1" }],
      frame: { origin: at, normal: [0, 0, -1] },
      counterpartFrame: { origin: at, normal: [0, 0, 1] },
    });
    const lead = (id: string, od: number, a: number[], b: number[]) => ({
      id,
      path: id,
      name: id,
      length_mm: 52,
      conductors: [{ position: "p1", color: "#c8202a", od, bare: false }],
      pairs: [0],
      build: { colors: ["red"], bundle: "parallel" },
      ends: [end("end_a", a), end("end_b", b)],
    });
    // the thick lead runs along X, the thin one crosses it along Y: thickest is routed first
    const thick = lead("thick", 3, [-25, 0, 2], [25, 0, 2]);
    const thin = lead("thin", 1, [0, -25, 2], [0, 25, 2]);
    // a standoff well clear of both, so the map has a body in it
    const bodies = [{ key: "standoff", glb: join(QUAD, "parts/local/m3-aluminium-standoff-30mm/out/body.glb"), matrix: [1, 0, 0, 40, 0, 1, 0, 40, 0, 0, 1, 0, 0, 0, 0, 1] }];
    const route = async (name: string, harnesses: object[], targets: string[]) => {
      const job = { schema: "protoboard.harness-cad.job/v0", bodies, harnesses, targets, problems: [] };
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(job));
      const r = await generator(["route", join(dir, `${name}.json`), join(dir, name)]);
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout.trim().split("\n").pop()!);
    };
    const both = await route("both", [thin, thick], ["thin", "thick"]);
    const onlyThin = await route("only-thin", [thin, thick], ["thin"]);
    const alone = await route("alone", [thin], ["thin"]);
    expect(both.harnesses.map((h: { id: string }) => h.id)).toEqual(["thick", "thin"]);
    expect(onlyThin.harnesses.map((h: { id: string }) => h.id)).toEqual(["thin"]);
    expect(onlyThin.context.map((h: { id: string }) => h.id)).toEqual(["thick"]);
    expect(existsSync(join(dir, "only-thin", "thick.route.json"))).toBe(false);
    const thinRoute = (name: string) => readFileSync(join(dir, name, "thin.route.json"), "utf8");
    // the same route whether or not the cable before it is written; a different one without it
    expect(thinRoute("only-thin")).toBe(thinRoute("both"));
    expect(thinRoute("alone")).not.toBe(thinRoute("both"));

    // a route file exported later gives the bodies one run gives
    const exp = await generator(["export", join(dir, "exported"), join(dir, "only-thin", "thin.route.json"), "--no-step"]);
    expect(exp.status, exp.stderr).toBe(0);
    writeFileSync(join(dir, "all.json"), JSON.stringify({ schema: "protoboard.harness-cad.job/v0", bodies, harnesses: [thin, thick], problems: [] }));
    const all = await generator([join(dir, "all.json"), join(dir, "all"), "--no-step"]);
    expect(all.status, all.stderr).toBe(0);
    expect(readFileSync(join(dir, "exported", "thin.glb")).equals(readFileSync(join(dir, "all", "thin.glb")))).toBe(true);
  }, 300000);
});

describe.skipIf(!hasPy)("the quadcopter's harnesses through the cad capability", () => {
  it("the SH8 cable passes the provider contract and its outputs are the committed ones", async () => {
    const dir = copyQuad("contract");
    const p = await loadProject(dir);
    process.env.PROTOBOARD_PYTHON ??= PYTHON;
    const report = await runProviderContract(p, "cad", "stack/sh8_cable", { record: false });
    expect(report.steps.flatMap((s) => s.problems)).toEqual([]);
    expect(report).toMatchObject({ passed: true, provider: "@protoboardai/ext-harness-cad", module: "dolphinrc-sh8-fc-esc-cable" });
    const facts = report.steps.find((s) => s.operation === "extract")!.record.data as { frames: Record<string, unknown>; artifacts: { id: string }[] };
    expect(Object.keys(facts.frames).sort()).toEqual(["end_esc", "end_fc"]);
    expect(facts.artifacts.map((a) => a.id)).toEqual(["cad_source", "cad_step", "cad_glb", "cad_manifest"]);
    expect(differs(dir, harnessFiles("dolphinrc-sh8-fc-esc-cable"))).toEqual([]);
  }, 600000);

  it("a cable later in the routing order regenerates byte for byte with no other route on file", async () => {
    const dir = copyQuad("order");
    for (const id of WIRE_HARNESSES) for (const f of ["harness-cad", "out"]) rmSync(join(dir, "src/harnesses", id, f), { recursive: true, force: true });
    // the XT60 lead is routed fourth, after the SH8 cable, the DJI cable and the capacitor leads
    const gen = (await pb(dir, ["run", "cad:generate", "--module", "dolphinrc-xt60-battery-lead"])).json;
    expect(gen.status).toBe("succeeded");
    expect(gen.data.context.map((h: { id: string }) => h.id)).toEqual(["dolphinrc-sh8-fc-esc-cable", "dji-o4-3in1-cable", "panasonic-eeu-fr1v471-leads"]);
    expect(gen.outputs.map((o: { path: string }) => o.path)).toEqual(["src/harnesses/dolphinrc-xt60-battery-lead/harness-cad/route.json"]);
    expect((await pb(dir, ["run", "cad:export", "--module", "xt60_lead"])).json.status).toBe("succeeded");
    expect(differs(dir, harnessFiles("dolphinrc-xt60-battery-lead"))).toEqual([]);
  }, 600000);

  it("the harness-cad alias writes the same files as generate and export", async () => {
    const dir = copyQuad("alias");
    const alias = (await pb(dir, ["run", "harness-cad", "--input", "harness=dolphinrc-sh8-fc-esc-cable"])).json;
    expect(alias.status).toBe("succeeded");
    // the cable's own cad:generate and cad:export records, the alias's record writing nothing
    expect(alias.outputs).toEqual([]);
    const steps = alias.data.steps as { module: string; operation: string; record: string; outputs: string[] }[];
    expect(steps.map((s) => s.operation)).toEqual(["cad:generate", "cad:export"]);
    const paths = steps.flatMap((s) => s.outputs).sort();
    expect(paths).toEqual(harnessFiles("dolphinrc-sh8-fc-esc-cable").sort());
    expect(differs(dir, paths)).toEqual([]);
    // the export's record is of the module as it now loads: the release finds nothing stale
    const exp = JSON.parse(readFileSync(join(dir, steps[1].record), "utf8"));
    const p = await loadProject(dir, { checks: false });
    const def = p.definitions.get("dolphinrc-sh8-fc-esc-cable")!.def;
    expect(exp.capability.moduleDigest).toBe(moduleDigest(def, p.lookup));
    expect(freshness(p).diagnostics.filter((d) => d.message.includes("dolphinrc-sh8-fc-esc-cable"))).toEqual([]);
  }, 600000);
});

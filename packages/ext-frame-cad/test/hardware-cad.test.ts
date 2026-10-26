/**
 * hardware-cad (PB-801): the mounting-hardware generator that UHD's library
 * held (library/cad/py/hardware.py), as an operation on any project's
 * fastener modules, through the `cad` capability (PB-836): each part has a
 * cad.config.ts, its params in frame-cad/ and its body in out/. Exercised
 * through the CLI on copies of the quadcopter:
 *   - params come from the modules' sizes, never from defaults;
 *   - with build123d present, `run hardware-cad` (the alias of cad:generate
 *     and cad:export) regenerates the quadcopter's twelve hardware bodies
 *     byte for byte, and a size change is reported stale until it is
 *     regenerated.
 * The runtime-present tests need Python with build123d (PROTOBOARD_PYTHON, or
 * a fallback: core/test/cad-python.ts); they are skipped otherwise.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ModuleDef } from "@deltarobotics/uhd";
import { buildHardwareParams } from "../lib/hardware.ts";
import { hardwareCadArtifacts } from "../lib/artifacts.ts";
import { cadPython } from "../../core/test/cad-python.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const QUAD = join(REPO, "examples/quadcopter-5in");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const TMP = join(HERE, ".tmp-hw");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const PYTHON = cadPython();
const hasBuild123d = !!PYTHON && spawnSync(PYTHON, ["-c", "import build123d"]).status === 0;

function copyQuad(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.protoboard|\.claude)$/.test(src) && !/[/\\]operations[/\\]/.test(src) });
  return dir;
}
/** The CLI, asynchronously: a CAD run takes tens of seconds and must not hold the worker's event loop (vitest's RPC times out at 60 s). */
function pb(dir: string, args: string[], env: Record<string, string | undefined> = {}): Promise<{ status: number | null; json: any; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--format", "json", "--cwd", dir], { env: { ...process.env, ...env }, timeout: 300000 });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("close", (status) => resolve({ status, json: JSON.parse(stdout || "null"), stderr }));
  });
}

const HW = "parts/local/m4x10";
const QUAD_HARDWARE = [
  "dolphinrc-m3-grommet-esc",
  "dolphinrc-m3-grommet-fc",
  "iso-10511-m2-nyloc-nut",
  "iso-4762-m2x12",
  "iso-4762-m2x18",
  "iso-4762-m2x5",
  "iso-4762-m3x8",
  "m2-nylon-spacer-3mm",
  "m2-nylon-spacer-5mm",
  "m3-aluminium-standoff-30mm",
  "meps-m5-flanged-lock-nut",
  "motor-screw-m3x8",
];

const screw = (meta: Record<string, unknown>): ModuleDef =>
  ({
    id: "m4x10",
    name: "M4 x 10",
    tags: ["fastener", "screw"],
    interfaces: [{ id: "thread", domain: "mechanical", exposed: true, protocols: [{ type: "custom", roles: ["peer"] }], parameters: [{ id: "fastener_diameter", unit: "mm", value: 4 }, { id: "length", unit: "mm", value: 10 }] }],
    domains: [{ domain: "mechanical", metadata: meta }],
  }) as ModuleDef;

describe("params from the module", () => {
  it("read the kind from the tags and every size from the module", () => {
    const { params, problems } = buildHardwareParams(screw({ head_diameter_mm: 7, head_height_mm: 4 }), "m4x10");
    expect(problems).toEqual([]);
    expect(params!.part).toEqual({ kind: "screw", diameter: 4, length: 10, head_diameter: 7, head_height: 4, outer: null });
  });

  it("refuse to guess a missing size", () => {
    expect(buildHardwareParams(screw({ head_diameter_mm: 7 }), "m4x10").problems).toEqual(["m4x10: a screw needs mechanical metadata head_diameter_mm and head_height_mm"]);
    const nut = { ...screw({}), tags: ["fastener", "nut"] } as ModuleDef;
    expect(buildHardwareParams(nut, "nut").problems).toEqual(["m4x10: a nut needs mechanical metadata outer_mm"]);
  });

  it("take a bore the maker states, and refuse one that is not inside the part", () => {
    const spacer = (meta: Record<string, unknown>) => ({ ...screw(meta), tags: ["fastener", "spacer"] }) as ModuleDef;
    expect(buildHardwareParams(spacer({ outer_mm: 8 }), "s").params!.part).not.toHaveProperty("bore");
    expect(buildHardwareParams(spacer({ outer_mm: 8, bore_mm: 4.3 }), "s").params!.part).toMatchObject({ kind: "spacer", outer: 8, bore: 4.3 });
    expect(buildHardwareParams(spacer({ outer_mm: 8, bore_mm: 8 }), "s").problems).toEqual(["m4x10: bore_mm 8 is not inside outer_mm 8"]);
    expect(buildHardwareParams(screw({ head_diameter_mm: 7, head_height_mm: 4, bore_mm: 2 }), "m4x10").problems).toEqual(["m4x10: bore_mm 2 does not apply to a screw"]);
  });

  it("the declared artifacts are the files the operation writes", () => {
    expect(hardwareCadArtifacts({ dir: HW, name: "m4x10" }).map((a) => a.filePath).filter(Boolean)).toEqual([
      `${HW}/out/body.step`,
      `${HW}/out/body.glb`,
      `${HW}/out/body.manifest.json`,
      `${HW}/frame-cad/params.json`,
    ]);
  });
});

describe.skipIf(!hasBuild123d)("hardware generation with build123d", () => {
  const env = { PROTOBOARD_PYTHON: PYTHON };

  it("regenerates the quadcopter's mounting hardware byte for byte, with the same volumes", async () => {
    const dir = copyQuad("regen");
    const { status, json } = await pb(dir, ["run", "hardware-cad"], env);
    expect(status).toBe(0);
    const modules = json.data.modules as { module: string; volume_mm3: number; previousVolume_mm3: number }[];
    expect(modules.map((m) => m.module)).toEqual(QUAD_HARDWARE);
    for (const m of modules) expect(m.volume_mm3).toBe(m.previousVolume_mm3);
    expect(json.outputs).toEqual([]);
    const steps = json.data.steps as { module: string; operation: string; outputs: string[] }[];
    expect(steps.filter((s) => s.operation === "cad:export").map((s) => s.module)).toEqual(QUAD_HARDWARE);
    const paths = steps.flatMap((s) => s.outputs);
    expect(paths).toHaveLength(QUAD_HARDWARE.length * 4);
    expect(paths.filter((p) => !readFileSync(join(dir, p)).equals(readFileSync(join(QUAD, p))))).toEqual([]);
    const check = (await pb(dir, ["check"])).json;
    expect(check.checks.find((c: { validator: string }) => c.validator === "ext:@protoboardai/ext-frame-cad/hardware")).toMatchObject({ status: "ran", counts: { error: 0, warning: 0 } });
    expect(check.diagnostics.filter((d: { code: string }) => d.code.startsWith("HARDWARE_CAD"))).toEqual([]);
  }, 600000);

  it("a size change is stale until regenerated, and the new volume is reported", async () => {
    const dir = copyQuad("stale");
    const src = join(dir, "parts/local/hardware.ts");
    const text = readFileSync(src, "utf8");
    expect(text).toContain("m3: { dk: 5.5, k: 3.0,");
    writeFileSync(src, text.replace("m3: { dk: 5.5, k: 3.0,", "m3: { dk: 5.5, k: 3.5,"));

    let check = (await pb(dir, ["check"])).json;
    const stale = check.diagnostics.filter((d: { code: string }) => d.code === "HARDWARE_CAD_STALE").map((d: { entity: { id: string } }) => d.entity.id);
    expect(stale.sort()).toEqual(["iso-4762-m3x8", "motor-screw-m3x8"]);

    const run = (await pb(dir, ["run", "hardware-cad", "--input", "module=iso-4762-m3x8"], env)).json;
    expect(run.status).toBe("succeeded");
    const [m] = run.data.modules;
    expect(m.volume_mm3).toBeGreaterThan(m.previousVolume_mm3);
    check = (await pb(dir, ["check"])).json;
    expect(check.diagnostics.filter((d: { code: string }) => d.code === "HARDWARE_CAD_STALE").map((d: { entity: { id: string } }) => d.entity.id)).toEqual(["motor-screw-m3x8"]);
  }, 600000);
});

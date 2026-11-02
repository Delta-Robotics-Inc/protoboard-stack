/**
 * PB_MODEL_SIZE_MISMATCH (model-size.ts): a placed 3D model compared with
 * the package body its part states, read from the build's view sidecar
 * index. Synthetic projects: the sidecar indexes are written by hand (only
 * the fields the check reads), bounds in glTF metres, Y-up.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, placeholderGlb, sha256 } from "../src/index.js";
import { MODEL_SIZE_CODE, MODEL_SIZE_VALIDATOR, compareSize, modelSizeDiagnostics, toUhdMm } from "../src/model-size.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/model-size");
let n = 0;
let savedCache: string | undefined;
beforeAll(() => {
  savedCache = process.env.PROTOBOARD_CACHE_DIR;
  process.env.PROTOBOARD_CACHE_DIR = join(TMP, "cache");
});
afterAll(() => {
  if (savedCache === undefined) delete process.env.PROTOBOARD_CACHE_DIR;
  else process.env.PROTOBOARD_CACHE_DIR = savedCache;
  rmSync(TMP, { recursive: true, force: true });
});

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;

type Mm = [number, number, number];
/** A package part: mechanical domain with a package and its body size (mm: length, width, height). */
const part = (id: string, size: Mm | undefined, extra = "") =>
  `{ id: "${id}", name: "${id}", kind: "module", interfaces: []${size ? `, domains: [{ domain: "mechanical", dimensions_mm: { length: ${size[0]}, width: ${size[1]}, height: ${size[2]} }, package: { name: "TEST-${id}", pin_count: 0, exposed_pad: false } }]` : ""}${extra} }`;
const body = (id: string, file: string) => `, artifacts: [{ id: "${id}_glb", name: "${id}", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "${file}" }]`;

/** glTF bounds (metres, Y-up) of a box `size` mm (UHD length on X, width on Y, height on Z) at `at` (glTF metres). */
const box = (size: Mm, at: Mm = [0, 0, 0]) => ({ min: at, max: [at[0] + size[0] / 1000, at[1] + size[2] / 1000, at[2] + size[1] / 1000] as Mm });
const node = (id: string, instancePath: string, bounds: { min: Mm; max: Mm }, extra: Record<string, unknown> = {}) => ({ id, instancePath, node: 0, bounds, tier: "fine", triangles: { fine: 12, coarse: 12 }, featureCount: 1, faces: [], ...extra });
const index = (glb: Buffer, nodes: unknown[], owner: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: "protoboard.view-sidecar/v0", pipeline: 1, idScope: "relative-to-owner", owner, source: { file: "x.glb", sha256: sha256(glb), bytes: glb.length }, nodes });

const BOARD_TOP = 0.0016; // a 1.6 mm board from glTF y = 0 to 0.0016
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export const OK: ModuleDef = ${part("chip-ok", [12, 8, 3], body("ok", "parts/local/ok/body.glb"))};
export const BIG: ModuleDef = ${part("usb-big", [7.35, 8.94, 3.16], body("big", "parts/local/big/body.glb"))};
export const PH: ModuleDef = ${part("chip-ph", [5, 5, 1], `, tags: ["placeholder"]${body("ph", "parts/local/ph/body.glb")}`)};
export const NOMODEL: ModuleDef = ${part("chip-nomodel", [5, 5, 1])};
export const NOSIDE: ModuleDef = ${part("chip-noside", [5, 5, 1], body("noside", "parts/local/noside/body.glb"))};
export const STALE: ModuleDef = ${part("chip-stale", [5, 5, 1], body("stale", "parts/local/stale/body.glb"))};
export const NOPKG: ModuleDef = ${part("mech-nopkg", undefined, body("nopkg", "parts/local/nopkg/body.glb"))};
export const RES: ModuleDef = ${part("res-0603", [1.6, 0.8, 0.45])};
export const USB: ModuleDef = ${part("usb-c", [7.35, 8.94, 3.16])};
export const HDR: ModuleDef = ${part("header", [10, 2.54, 10])};
export const BOARD: ModuleDef = { id: "board", name: "Board", kind: "module", interfaces: [], children: [
  { id: "r1", moduleDefId: "res-0603" }, { id: "r2", moduleDefId: "res-0603" }, { id: "j1", moduleDefId: "usb-c" }, { id: "j2", moduleDefId: "usb-c" }, { id: "h1", moduleDefId: "header" },
]${body("board", "src/board/out/body.glb")} };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [
  { id: "ok", moduleDefId: "chip-ok" }, { id: "big", moduleDefId: "usb-big" }, { id: "ph", moduleDefId: "chip-ph" }, { id: "nomodel", moduleDefId: "chip-nomodel" },
  { id: "noside", moduleDefId: "chip-noside" }, { id: "stale", moduleDefId: "chip-stale" }, { id: "nopkg", moduleDefId: "mech-nopkg" }, { id: "pcb", moduleDefId: "board" },
] };
`;

function project(withSidecars = true) {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string | Buffer> = { "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS };
  const glb = (rel: string, name: string) => (files[rel] = placeholderGlb({ name, size_mm: [1, 1, 1] }));
  const g = {
    ok: glb("parts/local/ok/body.glb", "ok"),
    big: glb("parts/local/big/body.glb", "big"),
    ph: glb("parts/local/ph/body.glb", "ph"),
    noside: glb("parts/local/noside/body.glb", "noside"),
    stale: glb("parts/local/stale/body.glb", "stale"),
    nopkg: glb("parts/local/nopkg/body.glb", "nopkg"),
    board: glb("src/board/out/body.glb", "board"),
  };
  if (withSidecars) {
    // matches: 12 x 8 x 3 mm, the remainder plus a named feature node (the union is the model)
    files["parts/local/ok/body.view.json"] = index(g.ok, [node(".", "", box([12, 8, 2.5])), node("feature:pad", "", box([1, 1, 3]), { role: "feature" })]);
    // 4.9 times the package (a model exported at the wrong scale)
    files["parts/local/big/body.view.json"] = index(g.big, [node(".", "", box([7.35 * 4.9, 8.94 * 4.9, 3.16 * 4.9]))]);
    // a declared placeholder, wildly off: never reported
    files["parts/local/ph/body.view.json"] = index(g.ph, [node(".", "", box([50, 50, 50]))], { placeholder: true });
    // a sidecar of another version of the GLB: stale, never read
    files["parts/local/stale/body.view.json"] = index(Buffer.from("an older body.glb"), [node(".", "", box([50, 50, 50]))]);
    files["parts/local/nopkg/body.view.json"] = index(g.nopkg, [node(".", "", box([500, 500, 500]))]);
    files["src/board/out/body.view.json"] = index(g.board, [
      node(".", "", box([50, 50, 1.6])),
      // r1 as placed; r2 turned 90 degrees on the board (length along glTF Z)
      node("r1", "r1", box([1.6, 0.8, 0.45], [0.01, BOARD_TOP, 0.01])),
      node("r2", "r2", box([0.8, 1.6, 0.45], [0.02, BOARD_TOP, 0.01])),
      // j1: ClientX's case, about 5 times too big, partly through the board
      node("j1", "j1", { min: [0.03, -0.0026, -0.0103], max: [0.0743, 0.0177, 0.0288] }),
      // j2: an honest receptacle whose shell legs go 1.6 mm through the board and 1.7 mm below it: 6.46 mm overall
      node("j2", "j2", { min: [0.01, -0.0017, 0.03], max: [0.01894, BOARD_TOP + 0.00316, 0.03735] }),
      // h1: a header model 6.5 mm tall where the drawing says 10 mm overall
      node("h1", "h1", { min: [0.04, -0.0014, 0.02], max: [0.0425, 0.0051, 0.03017] }),
    ]);
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("compareSize", () => {
  it("converts glTF metres Y-up to mm Z-up at the boundary", () => {
    expect(toUhdMm(box([12, 8, 3])).map((v) => +v.toFixed(6))).toEqual([12, 8, 3]);
  });

  it("matches sorted sides, so a part's own model in any 90-degree orientation fits", () => {
    expect(compareSize(box([3, 12, 8]), { length: 12, width: 8, height: 3 }).off).toEqual([]);
    const c = compareSize(box([60, 40, 15]), { length: 12, width: 8, height: 3 });
    expect(c.uniform).toBe(true);
    expect(c.longest).toBeCloseTo(5, 6);
  });

  it("on a board: legs through and under the board do not fail an honest model, a too-big body does", () => {
    const slab = { bottom: 0, top: 0.0016 };
    const legs = compareSize({ min: [0, -0.0017, 0], max: [0.00894, 0.0016 + 0.00316, 0.00735] }, { length: 7.35, width: 8.94, height: 3.16 }, slab);
    expect(legs.off).toEqual([]);
    expect(legs.sides[2].model).toBeCloseTo(3.16, 6); // the mounting side's height was the closer one
    const big = compareSize({ min: [0, 0.0016, 0], max: [0.045, 0.0016 + 0.016, 0.039] }, { length: 7.35, width: 8.94, height: 3.16 }, slab);
    expect(big.uniform).toBe(true);
  });
});

describe("PB_MODEL_SIZE_MISMATCH", () => {
  it("flags a model 4.9 times its package and a board component about 5 times; passes matching, rotated and legged models; skips placeholders, stale sidecars and parts without a package size", async () => {
    const p = await loadProject(project());
    const found = p.diagnostics.filter((d) => d.code === MODEL_SIZE_CODE);
    expect(found.map((d) => d.entity.id).sort()).toEqual(["big", "pcb/h1", "pcb/j1"]);
    for (const d of found) expect(d).toMatchObject({ severity: "warning", entity: { kind: "instance" }, validator: MODEL_SIZE_VALIDATOR });
    expect(p.checks.find((c) => c.validator === MODEL_SIZE_VALIDATOR)).toMatchObject({ status: "ran", counts: { error: 0, warning: 3, info: 0 } });

    const big = found.find((d) => d.entity.id === "big")!.message;
    expect(big).toContain("big (usb-big): the 3D model is 4.9 times the package body on its longest side; the model's scale may be wrong");
    expect(big).toContain("package body is 7.35 x 8.94 x 3.16 mm");
    expect(big).toContain("43.81 x 36.02 x 15.48 mm");

    const j1 = found.find((d) => d.entity.id === "pcb/j1")!.message;
    expect(j1).toMatch(/^pcb\/j1 \(usb-c\): the 3D model is 5\.0 times the package body on its longest side; the model's scale may be wrong/);
    expect(j1).toContain("on the board and 16.1 mm high");
    expect(j1).toContain("drawn inside pcb's body");

    // a shape mismatch on one side is reported as such, not as a scale error
    const h1 = found.find((d) => d.entity.id === "pcb/h1")!.message;
    expect(h1).toContain("pcb/h1 (header): the 3D model does not match the package body: its height is 0.65 times the package's (6.5 mm against 10 mm)");
    expect(h1).not.toContain("scale may be wrong");
  });

  it("stays silent before a build (no view sidecars) and still runs", async () => {
    const p = await loadProject(project(false));
    expect(p.diagnostics.filter((d) => d.code === MODEL_SIZE_CODE)).toEqual([]);
    expect(p.checks.find((c) => c.validator === MODEL_SIZE_VALIDATOR)?.status).toBe("ran");
  });

  it("does not read a sidecar index over the size cap", async () => {
    const p = await loadProject(project(), { checks: false });
    expect(modelSizeDiagnostics(p).diagnostics).toHaveLength(3);
    expect(modelSizeDiagnostics(p, { maxIndexBytes: 64 }).diagnostics).toEqual([]);
  });

  it("does not read a sidecar index that a link places outside the project", async () => {
    const dir = project();
    const outside = join(TMP, `outside-${n}`);
    mkdirSync(outside, { recursive: true });
    const idx = join(dir, "parts/local/big/body.view.json");
    writeFileSync(join(outside, "body.view.json"), readFileSync(idx));
    rmSync(join(dir, "parts/local/big"), { recursive: true, force: true });
    // the whole folder a link to one outside the project: the GLB and its sidecar are then outside too
    const { symlinkSync } = await import("node:fs");
    writeFileSync(join(outside, "body.glb"), readFileSync(join(dir, "parts/local/ok/body.glb")));
    try {
      symlinkSync(outside, join(dir, "parts/local/big"), "junction");
    } catch {
      return; // links not permitted here: nothing to test
    }
    const p = await loadProject(dir, { checks: false });
    expect(modelSizeDiagnostics(p).diagnostics.map((d) => d.entity.id)).not.toContain("big");
  });
});

/**
 * PB_MODEL_ORIENTATION (model-orientation.ts, wave R2 I2): a board part's 3D model measured along the board normal
 * against the board slab, read from the build's view sidecar index. Synthetic project as in model-size.test.ts:
 * the sidecar index is written by hand, bounds in glTF metres, Y-up (the board normal).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject, placeholderGlb, sha256 } from "../src/index.js";
import { uhdBundle } from "../src/bundle.js";
import { MODEL_ORIENTATION_CODE, MODEL_ORIENTATION_VALIDATOR, SUNK_SHARE, THROUGH_MAX_MM, modelOrientationDiagnostics, orientationOf } from "../src/model-orientation.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/model-orientation");
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

type Mm = [number, number, number];
const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const body = (id: string, file: string) => `, artifacts: [{ id: "${id}_glb", name: "${id}", type: "3d_model", role: "body", format: "glb", units: "m", filePath: "${file}" }]`;
const node = (id: string, instancePath: string, bounds: { min: Mm; max: Mm }, extra: Record<string, unknown> = {}) => ({ id, instancePath, node: 0, bounds, tier: "fine", triangles: { fine: 12, coarse: 12 }, featureCount: 1, faces: [], ...extra });
const index = (glb: Buffer, nodes: unknown[]) =>
  JSON.stringify({ schema: "protoboard.view-sidecar/v0", pipeline: 1, idScope: "relative-to-owner", owner: {}, source: { file: "x.glb", sha256: sha256(glb), bytes: glb.length }, nodes });
/** A part's bounds along the board normal: `lo` to `hi` mm (glTF Y), a 2.54 x 10 mm footprint at x, z. */
const along = (lo: number, hi: number, x = 0.01): { min: Mm; max: Mm } => ({ min: [x, lo / 1000, 0.01], max: [x + 0.00254, hi / 1000, 0.02] });

// a 1.6 mm board from glTF y = 0 to 0.0016 (mm 0 to 1.6)
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export const HDR: ModuleDef = { id: "header", name: "4-pin header", kind: "module", interfaces: [] };
export const BOARD: ModuleDef = { id: "board", name: "Board", kind: "module", interfaces: [], children: [
  { id: "h_ok", moduleDefId: "header" }, { id: "h_long", moduleDefId: "header" }, { id: "jack", moduleDefId: "header" },
  { id: "sunk", moduleDefId: "header" }, { id: "smd", moduleDefId: "header" }, { id: "ph", moduleDefId: "header" },
]${body("board", "src/board/out/body.glb")} };
export const BLOCK: ModuleDef = { id: "block", name: "Block", kind: "module", interfaces: [], children: [{ id: "c1", moduleDefId: "header" }]${body("block", "src/block/out/body.glb")} };
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "pcb", moduleDefId: "board" }, { id: "blk", moduleDefId: "block" }] };
`;

function project() {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string | Buffer> = { "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS };
  const board = (files["src/board/out/body.glb"] = placeholderGlb({ name: "board", size_mm: [1, 1, 1] }));
  const block = (files["src/block/out/body.glb"] = placeholderGlb({ name: "block", size_mm: [1, 1, 1] }));
  files["src/board/out/body.view.json"] = index(board, [
    node(".", "", { min: [0, 0, 0], max: [0.05, 0.0016, 0.05] }),
    // an honest through-hole header: body 9.9 mm above the top, tails 1.8 mm below the bottom (ClientX's FAN headers)
    node("h_ok", "h_ok", along(-1.8, 1.6 + 9.9)),
    // long pins 6 mm through the bottom under a body on top: flagged
    node("h_long", "h_long", along(-6, 1.6 + 9), { refdes: "H2" }),
    // a jack mounted on the bottom (ClientX's 12V_DCJ: 13.4 mm below, 1.9 mm through the top): not flagged
    node("jack", "jack", along(-13.4, 1.6 + 1.9, 0.03)),
    // a part buried in the board: flagged as sunk
    node("sunk", "sunk", along(0.2, 1.5, 0.04)),
    // an SMD resistor on the top copper
    node("smd", "smd", along(1.52, 1.97, 0.02)),
    // a placeholder node: never measured
    node("ph", "ph", along(-20, 20, 0.045), { placeholder: true }),
  ]);
  // a holder whose remainder is no board (a 20 mm cube): nothing on it is measured
  files["src/block/out/body.view.json"] = index(block, [node(".", "", { min: [0, 0, 0], max: [0.02, 0.02, 0.02] }), node("c1", "c1", along(-30, 1))]);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("orientationOf", () => {
  const slab = { bottom: 0, top: 0.0016 };
  it("infers the mounting side from where most of the model is, and measures in mm along the normal", () => {
    const o = orientationOf(along(-1.8, 11.5), slab)!;
    expect(o.side).toBe("top");
    expect(o.above).toBeCloseTo(9.9, 6);
    expect(o.below).toBeCloseTo(1.8, 6);
    expect(o.far).toBeCloseTo(1.8, 6);
    expect(o.through || o.sunken).toBe(false);
    const jack = orientationOf(along(-13.4, 3.5), slab)!;
    expect(jack.side).toBe("bottom");
    expect(jack.far).toBeCloseTo(1.9, 6);
    expect(jack.through || jack.sunken).toBe(false);
  });
  it("flags pins more than 4 mm through the far face, and a model mostly inside the board (DEFAULTs)", () => {
    expect(THROUGH_MAX_MM).toBe(4);
    expect(SUNK_SHARE).toBe(0.4);
    expect(orientationOf(along(-3.9, 10), slab)!.through).toBe(false);
    expect(orientationOf(along(-4.1, 10), slab)!.through).toBe(true);
    const sunk = orientationOf(along(0.2, 1.5), slab)!;
    expect(sunk.sunken).toBe(true);
    expect(sunk.sunk).toBeGreaterThan(0.4);
    // the limits are options
    expect(orientationOf(along(-4.1, 10), slab, { throughMaxMm: 5 })!.through).toBe(false);
    expect(orientationOf(along(0, 0), slab)).toBeUndefined();
  });
});

describe("PB_MODEL_ORIENTATION on a project", () => {
  it("flags the long-pinned header and the buried part only; skips the bottom jack, honest parts, placeholders and non-boards", async () => {
    const dir = project();
    const p = await loadProject(dir, { extensions: false });
    const found = p.diagnostics.filter((d) => d.code === MODEL_ORIENTATION_CODE);
    expect(found.map((d) => d.entity.id).sort()).toEqual(["pcb/h_long", "pcb/sunk"]);
    for (const d of found) {
      expect(d.severity).toBe("warning");
      expect(d.validator).toBe(MODEL_ORIENTATION_VALIDATOR);
      // plain words for people (findings-text.ts)
      expect(d.title).toBe("Model may be upside down");
      expect(d.summary!.length).toBeLessThanOrEqual(160);
    }
    const long = found.find((d) => d.entity.id === "pcb/h_long")!;
    expect(long.message).toContain("passes 6 mm through the board's bottom face");
    expect(long.message).toContain("drawn inside pcb's body");
    expect(long.summary).toBe("The 3D model of 4-pin header passes 6 mm through the board's bottom face; it may be upside down or mirrored.");
    expect(found.find((d) => d.entity.id === "pcb/sunk")!.message).toMatch(/sits \d+% of its height inside the board/);
    const run = p.checks.find((c) => c.validator === MODEL_ORIENTATION_VALIDATOR)!;
    expect(run.status).toBe("ran");
    expect(run.counts.warning).toBe(2);
    // five board parts measured: the placeholder and the block's part are not
    expect(modelOrientationDiagnostics(p).measured).toBe(5);
    // the bundle carries the plain words to the 3D view's callouts (additive fields beside message)
    const b = await uhdBundle(p);
    const inBundle = (b.diagnostics ?? []).find((d) => d.code === MODEL_ORIENTATION_CODE && (d as { entity?: { id: string } }).entity?.id === "pcb/h_long") as { title?: string; summary?: string; message: string };
    expect(inBundle).toMatchObject({ title: "Model may be upside down", summary: long.summary, message: long.message });
  });
});

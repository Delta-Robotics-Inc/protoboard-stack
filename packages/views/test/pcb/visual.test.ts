/**
 * Visual smoke test of the board renderer: the Airnode C3 fixture rendered headless (SwiftShader WebGL through the
 * stack's DevTools client) is non-empty, renders the same twice, and stays within a tolerance of the stored golden.
 * Skipped when no Chromium-family browser is installed.
 *
 * Update the golden after an intended change: PCB_UPDATE_GOLDEN=1 npx vitest run packages/views/test/pcb/visual.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBrowser } from "@protoboardai/core/browser";
import { airnodeC3 } from "../../../board/src/fixtures/airnode-c3.js";
import { createHeadlessRenderer, type HeadlessRenderer } from "../../src/pcb/headless/render.js";

const GOLDEN = fileURLToPath(new URL("./airnode-c3.golden.png", import.meta.url));
/** The golden render: the whole board, the screen's default layers, the origin mark and one finding marker. */
const OPTIONS = {
  width: 800,
  height: 600,
  origin: true,
  findings: [{ id: "f:clearance:000000000001", check: "clearance", severity: "error" as const, objects: ["trk:f.i2c_scl.1"], location: { x: -4_000_000, y: 11_500_000 }, message: "sample" }],
};
/** Pixels differing by more than 24 of 255 in a channel: at most this fraction (antialiasing differs a little between GPUs and SwiftShader builds). */
const TOLERANCE = 0.01;

const browser = findBrowser();

describe.skipIf(!browser)("board renderer, headless", () => {
  let r: HeadlessRenderer;
  beforeAll(async () => {
    r = await createHeadlessRenderer({ backend: "swiftshader" });
  }, 120000);
  afterAll(async () => {
    await r?.close();
  });

  it("renders the Airnode C3 fixture: not empty, stable, and like the golden", async () => {
    const doc = airnodeC3();
    const a = await r.render(doc, OPTIONS);
    const b = await r.render(doc, OPTIONS);
    const out = join(tmpdir(), "protoboard-pcb-visual");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "airnode-c3.png"), a);
    const same = await r.diff(a, b);
    expect(same.ratio).toBe(0);
    // the board covers most of the frame: far more than background
    expect(same.nonBackground).toBeGreaterThan(0.3);
    if (process.env.PCB_UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, a);
      console.log(`wrote the golden ${GOLDEN}`);
      return;
    }
    const d = await r.diff(a, readFileSync(GOLDEN));
    expect(d.sameSize).toBe(true);
    expect(d.ratio, `render differs from the golden in ${(d.ratio * 100).toFixed(2)}% of pixels (render in ${out})`).toBeLessThanOrEqual(TOLERANCE);
  }, 120000);

  it("renders a region on chosen layers, flipped, with a net lit", async () => {
    const png = await r.render(airnodeC3(), { width: 400, height: 300, region: { minX: -15_000_000, minY: -8_000_000, maxX: -3_000_000, maxY: 2_000_000 }, layers: ["cu:bottom", "pads", "outline"], flip: true, active: "bottom", highlightNets: ["VBUS"] });
    const stats = await r.diff(png, png);
    expect(stats.sameSize).toBe(true);
    expect(stats.nonBackground).toBeGreaterThan(0.05);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  }, 120000);
});

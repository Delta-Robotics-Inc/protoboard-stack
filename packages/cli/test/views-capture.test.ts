/**
 * `protoboard views capture` (PB-1180, PB-1109): the flags read from the
 * command line into a capture request, `--from` a manifest, and one real
 * capture of the drone example's 3D tab with two annotated parts (skipped
 * without a Chromium-family browser, without the drone's built bundle, or
 * with PROTOBOARD_SKIP_RENDER_IT set).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findBrowser } from "@protoboardai/core";
import { parseCaptureRequest } from "@protoboardai/core/render-service";
import { captureArgs, parseViewsArgv, viewsCapture } from "../src/views-capture.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-views-capture");
const DRONE = join(HERE, "..", "..", "..", "examples", "quadcopter-5in");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("views capture: flags to a request", () => {
  it("reads values, repeats, `=` forms and --no- switches", () => {
    const { values, bools } = parseViewsArgv(["--view", "3d", "--annotate", "a,b", "--annotate=c", "--no-document", "--if-changed", "--zoom=1.5"]);
    expect(values.get("view")).toEqual(["3d"]);
    expect(values.get("annotate")).toEqual(["a,b", "c"]);
    expect(values.get("zoom")).toEqual(["1.5"]);
    expect(bools.get("document")).toBe(false);
    expect(bools.get("if-changed")).toBe(true);
    expect(() => parseViewsArgv(["--state"])).toThrow(/--state needs a value/);
  });
  it("builds a request the service accepts: state JSON, refs with labels, size, jpg, out relative to the cwd", () => {
    const { request, noService } = captureArgs(["--view", "3d", "--state", '{"azimuth":-58,"elevation":28,"explode":0.5}', "--annotate", "battery=Battery,receiver", "--size", "1200x800", "--dpr", "2", "--format", "jpg", "--quality", "80", "--out", "shots/a.jpg", "--no-service"], TMP);
    expect(noService).toBe(true);
    expect(request).toMatchObject({ view: "3d", state: { azimuth: -58, elevation: 28, explode: 0.5 }, annotate: [{ ref: "battery", label: "Battery" }, "receiver"], size: { width: 1200, height: 800, dpr: 2 }, format: "jpeg", quality: 80, out: join(TMP, "shots", "a.jpg") });
    expect(parseCaptureRequest(request)).toMatchObject({ view: "3d", document: true });
    // the CLI's output switch is not an image format
    expect(captureArgs(["--format", "json"], TMP).request.format).toBeUndefined();
    expect(() => captureArgs(["--size", "big"], TMP)).toThrow(/WIDTHxHEIGHT/);
    expect(() => captureArgs(["--state", "{nope"], TMP)).toThrow(/--state: not JSON/);
  });
  it("--from a manifest draws the same request again, where it was", () => {
    mkdirSync(TMP, { recursive: true });
    const m = join(TMP, "x.capture.json");
    writeFileSync(m, JSON.stringify({ schema: "protoboard.capture-manifest/v0", request: { view: "diagram", zoom: 1, padding: 32 }, image: "docs/x.png" }));
    expect(captureArgs(["--from", m], TMP).request).toMatchObject({ view: "diagram", zoom: 1, padding: 32, out: "docs/x.png" });
    expect(captureArgs(["--from", m, "--zoom", "2"], TMP).request.zoom).toBe(2);
    writeFileSync(m, "{}");
    expect(() => captureArgs(["--from", m], TMP)).toThrow(/not a capture manifest/);
  });
});

const skip = !findBrowser() || !existsSync(join(DRONE, ".protoboard", "build", "uhd-bundle.json")) || !!process.env.PROTOBOARD_SKIP_RENDER_IT;
describe.skipIf(skip)("views capture: the drone's 3D tab, for real", () => {
  it("a chrome-free PNG with two annotated parts, an SVG overlay and a manifest, naming its backend", async () => {
    const out = join(TMP, "drone-3d.png");
    const { response: r } = await viewsCapture(["--view", "3d", "--annotate", "battery,receiver", "--out", out, "--no-service"], DRONE, "test");
    expect(r.imagePath).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2576);
    expect(["gpu", "swiftshader"]).toContain(r.backend);
    expect(r.gpu.length).toBeGreaterThan(0);
    expect(r.legend.map((e) => e.found)).toEqual([true, true]);
    for (const e of r.legend) expect(e.anchorPx![0]).toBeGreaterThan(0);
    expect(readFileSync(r.svgPath!, "utf8")).toContain("battery");
    expect(JSON.parse(readFileSync(r.manifestPath, "utf8")).viewState.camera.fov).toBeGreaterThan(0);
    expect(r.warnings.filter((w) => /blank|page error/.test(w))).toEqual([]);
  }, 240000);
});

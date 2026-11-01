/**
 * The render service (PB-1180) without a browser: the request and response
 * schemas, the transfer-limits file and the downscale and retry-once rules,
 * the one-at-a-time queue and the idle timeout, the projection and the
 * overlay, the handoff files, the doctor against a fake CDP browser, and a
 * whole capture through the service and its loopback server with a fake
 * browser and page host.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Browser } from "../src/cdp.js";
import {
  BUILT_IN_LIMITS,
  IdleTimer,
  PROBE_RGB,
  RenderService,
  SerialQueue,
  TOKEN_HEADER,
  backendOf,
  base64Bytes,
  buildLegend,
  checkSnapshotMeta,
  drawnRecords,
  isDeviceName,
  resolveInsideProject,
  shippedReferenceDir,
  captureKey,
  captureSidecars,
  connectRenderService,
  ensureRenderService,
  firstEncode,
  fitState,
  fixForSendError,
  formatDoctor,
  imageKind,
  imageSize,
  isCaptureResponse,
  isServiceRecord,
  loadTransferLimits,
  nextEncodeStep,
  overlaySvg,
  parseCaptureRequest,
  planSize,
  projectBounds,
  projectPoint,
  readServiceRecord,
  readSnapshot,
  resolveRef,
  runDoctor,
  sendWithRetryOnce,
  serveRenderService,
  snapshotKey,
  validateLimits,
  writeServiceRecord,
  writeSnapshot,
  type CameraState,
  type EncodeStep,
  type PageHost,
} from "../src/render-service/index.js";
import { gpuFlags, isSoftwareRenderer, requestedBackend } from "../src/cdp.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOCS_LIMITS = join(HERE, "..", "..", "..", "docs", "reference", "transfer-limits.json");
const SHIPPED_LIMITS = join(HERE, "..", "reference", "transfer-limits.json");
const TMP = mkdtempSync(join(tmpdir(), "pb-render-service-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A PNG's first 24 bytes are enough for imageSize; the rest is filler sized like a picture. */
function fakePng(width: number, height: number, bytes = 2000): Buffer {
  const b = Buffer.alloc(Math.max(33, bytes));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
function fakeJpeg(width: number, height: number, bytes = 1500): Buffer {
  const b = Buffer.alloc(Math.max(20, bytes));
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xc0;
  b.writeUInt16BE(17, 4);
  b[6] = 8;
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}

describe("capture request and response schemas", () => {
  it("fills the defaults: the 3D tab at the top, 1600 x 1000, document mode, no overlay without refs", () => {
    const r = parseCaptureRequest({});
    expect(r).toMatchObject({ view: "3d", level: "", annotate: [], size: { width: 1600, height: 1000, dpr: 1 }, ifChanged: false, document: true, padding: 24, overlay: "none" });
    expect(imageKind(r)).toBe("shaded");
  });
  it("refs as strings or {ref, label}; an overlay is burned and drawn as SVG by default when there are refs", () => {
    const r = parseCaptureRequest({ annotate: ["battery", { ref: "@arm_fr/motor", label: "Motor FR" }], level: "/arm_fr/" });
    expect(r.annotate).toEqual([{ ref: "battery" }, { ref: "@arm_fr/motor", label: "Motor FR" }]);
    expect(r.overlay).toBe("burned+svg");
    expect(r.level).toBe("arm_fr");
    expect(imageKind(r)).toBe("annotated");
    expect(imageKind(parseCaptureRequest({ view: "diagram" }))).toBe("diagram");
  });
  it("names every problem at once", () => {
    let msg = "";
    try {
      parseCaptureRequest({ view: "3d tab", size: { width: 9, dpr: 9 }, format: "bmp", state: { explode: 2, target: [1, 2] }, zoom: 0, annotate: [3], bogus: 1, level: "../x" });
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const bit of ["view:", "size.width", "size.dpr", "format:", "state.explode", "state.target", "zoom:", "annotate[0]", 'unknown field "bogus"', "level:"]) expect(msg).toContain(bit);
  });
  it("refuses an out path with characters Windows forbids", () => {
    expect(() => parseCaptureRequest({ out: 'shots/"top".png' })).toThrow(/out:/);
  });
  it("allowOutsideProject is a known boolean, kept only when true, and not part of the frame's key", () => {
    expect(parseCaptureRequest({ out: "/x.png", allowOutsideProject: true }).allowOutsideProject).toBe(true);
    expect("allowOutsideProject" in parseCaptureRequest({ allowOutsideProject: false })).toBe(false);
    expect(() => parseCaptureRequest({ allowOutsideProject: "yes" })).toThrow(/allowOutsideProject: true or false/);
    expect(captureKey(parseCaptureRequest({ out: "a.png", allowOutsideProject: true }))).toBe(captureKey(parseCaptureRequest({})));
  });
  it("two requests that draw the same frame share a key; a different state does not", () => {
    const a = parseCaptureRequest({ state: { azimuth: 10 }, annotate: ["x"] });
    expect(captureKey(a)).toBe(captureKey(parseCaptureRequest({ state: { azimuth: 10 }, annotate: ["x"], out: "elsewhere.png" })));
    expect(captureKey(a)).not.toBe(captureKey(parseCaptureRequest({ state: { azimuth: 11 }, annotate: ["x"] })));
  });
  it("checks a response and a service record", () => {
    expect(isCaptureResponse({})).toBe(false);
    expect(isServiceRecord({ schema: "protoboard.render-service/v0", url: "http://127.0.0.1:5000/", port: 5000, pid: 1, token: "x".repeat(32), root: "/p" })).toBe(true);
    expect(isServiceRecord({ schema: "protoboard.render-service/v0", url: "http://evil.example:5000/", port: 5000, pid: 1, token: "x".repeat(32), root: "/p" })).toBe(false);
  });
});

describe("transfer limits", () => {
  it("the built-in copy equals docs/reference/transfer-limits.json", () => {
    expect(JSON.parse(readFileSync(DOCS_LIMITS, "utf8"))).toEqual(BUILT_IN_LIMITS);
  });
  it("loads the copy shipped in the package first, else the built-in copy; says when it is due a recheck", () => {
    const l = loadTransferLimits({ now: new Date("2026-11-02T00:00:00Z"), env: {} });
    expect(l.file).toBe(join(shippedReferenceDir(), "transfer-limits.json"));
    expect(l.file).toBe(SHIPPED_LIMITS);
    expect(readFileSync(l.file)).toEqual(readFileSync(DOCS_LIMITS));
    expect(l.limits.routes["claude-api"].imageMaxBase64Bytes).toBe(10_000_000);
    expect(l.limits.routes.bedrock.imageMaxBase64Bytes).toBe(5_000_000);
    expect(l.stale).toBe(false);
    const old = loadTransferLimits({ files: [join(TMP, "none.json")], now: new Date("2027-03-01T00:00:00Z") });
    expect(old.file).toBe("built-in");
    expect(old.stale).toBe(true);
  });
  it("every route cites a source; a broken file is an error, not a silent default", () => {
    for (const r of Object.values(BUILT_IN_LIMITS.routes)) expect(r.sources.every((s) => s.startsWith("https://"))).toBe(true);
    const bad = join(TMP, "bad-limits.json");
    writeFileSync(bad, JSON.stringify({ ...BUILT_IN_LIMITS, policy: { ...BUILT_IN_LIMITS.policy, scaleStep: 1.2 } }));
    expect(() => loadTransferLimits({ files: [bad] })).toThrow(/scaleStep/);
    expect(() => validateLimits({ schema: "x" })).toThrow(/schema/);
  });
  it("sizes: never scaled up, 2,576 px on the long edge by default, 8,000 a side at most, 3,000 above 20 images", () => {
    expect(planSize({ width: 1600, height: 1000, dpr: 1 }, BUILT_IN_LIMITS)).toMatchObject({ scale: 1, outWidth: 1600, outHeight: 1000 });
    expect(planSize({ width: 2000, height: 1000, dpr: 2 }, BUILT_IN_LIMITS)).toMatchObject({ outWidth: 2576, outHeight: 1288 });
    expect(planSize({ width: 8000, height: 4000, dpr: 2 }, BUILT_IN_LIMITS, { maxLongEdge: 20000 })).toMatchObject({ outWidth: 8000, outHeight: 4000 });
    const many = planSize({ width: 4000, height: 2000, dpr: 1 }, BUILT_IN_LIMITS, { maxLongEdge: 8000, batch: 25 });
    expect(many).toMatchObject({ outWidth: 3000, outHeight: 1500 });
    expect(many.applied.join(" ")).toMatch(/more than 20 images/);
  });
  it("encode: shaded starts JPEG q85, then q75, q65, then scales by 0.85; line art stays PNG and scales", () => {
    let step: EncodeStep = firstEncode("shaded", BUILT_IN_LIMITS);
    expect(step).toMatchObject({ format: "jpeg", quality: 85 });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const v = nextEncodeStep(step, 5_000_000, "shaded", BUILT_IN_LIMITS);
      if (v.action !== "retry") break;
      step = v.next;
      seen.push(`${step.format}:${step.quality}:${step.scale.toFixed(4)}`);
    }
    expect(seen).toEqual(["jpeg:75:1.0000", "jpeg:65:1.0000", "jpeg:65:0.8500", "jpeg:65:0.7225"]);
    const png = firstEncode("annotated", BUILT_IN_LIMITS);
    expect(png.format).toBe("png");
    const v = nextEncodeStep(png, 9_000_000, "annotated", BUILT_IN_LIMITS);
    expect(v.action === "retry" && v.next).toMatchObject({ format: "png", scale: 0.85 });
    // a flat PNG over the hard cap becomes JPEG instead
    const flat = nextEncodeStep(firstEncode("flat", BUILT_IN_LIMITS), 9_000_000, "flat", BUILT_IN_LIMITS);
    expect(flat.action === "retry" && flat.next).toMatchObject({ format: "jpeg", quality: 85 });
    expect(nextEncodeStep(png, 1_000_000, "annotated", BUILT_IN_LIMITS).action).toBe("done");
    // steps used up: under the hard cap is kept, over it fails
    expect(nextEncodeStep({ ...png, step: 7 }, 3_000_000, "annotated", BUILT_IN_LIMITS).action).toBe("accept");
    expect(nextEncodeStep({ ...png, step: 7 }, 9_000_000, "annotated", BUILT_IN_LIMITS).action).toBe("fail");
    expect(base64Bytes(3)).toBe(4);
    expect(base64Bytes(7_500_000)).toBe(10_000_000);
  });
  it("a failed send: the error decides the fix", () => {
    const img = { width: 9000, height: 3000, format: "png" as const, bytes: 6_000_000 };
    expect(fixForSendError({ status: 400, message: "image dimensions exceed max allowed size" }, img, BUILT_IN_LIMITS)).toMatchObject({ action: "scale", maxSide: 8000 });
    expect(fixForSendError({ status: 400, message: "Image exceeds the limit for many-image requests (2000 px)" }, img, BUILT_IN_LIMITS)).toMatchObject({ action: "scale", maxSide: 3000 });
    expect(fixForSendError({ status: 400, message: "many-image requests" }, img, BUILT_IN_LIMITS, { batch: 40 })).toMatchObject({ action: "split", maxImages: 20 });
    expect(fixForSendError({ status: 413, message: "request_too_large" }, { ...img, format: "jpeg", quality: 85 }, BUILT_IN_LIMITS)).toMatchObject({ action: "recompress", quality: 75, scale: 0.75 });
    expect(fixForSendError({ message: "Request too large (max 32MB)" }, img, BUILT_IN_LIMITS).action).toBe("recompress");
    expect(fixForSendError({ status: 401, message: "authentication_error" }, img, BUILT_IN_LIMITS).action).toBe("report");
    expect(fixForSendError({ status: 429, message: "rate_limit_error" }, img, BUILT_IN_LIMITS).action).toBe("report");
  });
  it("retries once: a fixed image is sent again; a second failure stops and reports both", async () => {
    const img = { width: 9000, height: 3000, format: "png" as const, bytes: 6_000_000 };
    const smaller = { ...img, width: 8000, height: 2667, bytes: 5_000_000 };
    const remake = vi.fn(async () => smaller);
    let n = 0;
    const ok = await sendWithRetryOnce(img, async (i) => (n++ === 0 ? Promise.reject(Object.assign(new Error("image dimensions exceed max allowed size"), { status: 400 })) : `sent ${i.width}`), remake, BUILT_IN_LIMITS);
    expect(ok).toMatchObject({ result: "sent 8000", retried: true, fix: { action: "scale" } });
    expect(remake).toHaveBeenCalledTimes(1);
    const always = async () => Promise.reject(Object.assign(new Error("image dimensions exceed max allowed size"), { status: 400 }));
    await expect(sendWithRetryOnce(img, always, remake, BUILT_IN_LIMITS)).rejects.toThrow(/failed twice.*9000x3000.*8000x2667/);
    const auth = vi.fn(async () => smaller);
    await expect(sendWithRetryOnce(img, () => Promise.reject(Object.assign(new Error("invalid x-api-key"), { status: 401 })), auth, BUILT_IN_LIMITS)).rejects.toThrow(/not an image-size error/);
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("one job at a time, and the idle timeout", () => {
  it("runs jobs in order, never two at once; a failed job does not stop the next", async () => {
    const q = new SerialQueue();
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const job = (i: number, fail = false) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5 + (3 - i)));
      running--;
      order.push(i);
      if (fail) throw new Error(`job ${i}`);
      return i;
    };
    const results = await Promise.allSettled([q.run(job(0)), q.run(job(1, true)), q.run(job(2)), q.run(job(3))]);
    expect(most).toBe(1);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    expect(q.busy).toBe(false);
    expect(q.pending).toBe(0);
  });
  it("fires once after the quiet period; held work and touches put it off; stop cancels", () => {
    vi.useFakeTimers();
    try {
      const fired = vi.fn();
      const t = new IdleTimer(1000, fired, { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
      vi.advanceTimersByTime(900);
      t.touch();
      vi.advanceTimersByTime(900);
      expect(fired).not.toHaveBeenCalled();
      t.hold();
      vi.advanceTimersByTime(5000);
      expect(fired).not.toHaveBeenCalled();
      t.release();
      vi.advanceTimersByTime(999);
      expect(fired).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fired).toHaveBeenCalledTimes(1);
      t.touch();
      vi.advanceTimersByTime(5000);
      expect(fired).toHaveBeenCalledTimes(1);
      const s = vi.fn();
      const t2 = new IdleTimer(1000, s, { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
      t2.stop();
      vi.advanceTimersByTime(5000);
      expect(s).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

const CAM: CameraState = { position: [0, -500, 0], target: [0, 0, 0], up: [0, 0, 1], fov: 30 };
const VP = { x: 0, y: 0, width: 1600, height: 1000 };

describe("annotations come from the scene, projected through the viewer's camera", () => {
  it("the target lands in the middle; right is right, up is up; behind the camera is flagged", () => {
    const c = projectPoint(CAM, VP, [0, 0, 0]);
    expect(c.x).toBeCloseTo(800, 6);
    expect(c.y).toBeCloseTo(500, 6);
    expect(c.depth).toBeCloseTo(500, 6);
    // three's lookAt from -Y towards the origin with Z up: +X is screen right, +Z screen up
    const r = projectPoint(CAM, VP, [50, 0, 0]);
    const u = projectPoint(CAM, VP, [0, 0, 50]);
    expect(r.x).toBeGreaterThan(800);
    expect(u.y).toBeLessThan(500);
    // a point at the edge of a 30° vertical field of view sits on the top edge
    const top = projectPoint(CAM, VP, [0, 0, 500 * Math.tan((15 * Math.PI) / 180)]);
    expect(top.y).toBeCloseTo(0, 6);
    expect(projectPoint(CAM, VP, [0, -600, 0]).inFront).toBe(false);
    const box = projectBounds(CAM, VP, [[-10, -10, -10], [10, 10, 10]]);
    expect(box.rect![0]).toBeLessThan(800);
    expect(box.rect![0] + box.rect![2]).toBeGreaterThan(800);
  });
  it("refs resolve by id, by instance path, by a unique tail; `@` is ignored", () => {
    const nodes = [
      { id: "board", instancePath: "board", bounds: null },
      { id: "board/u1", instancePath: "board/u1", bounds: null },
      { id: "arm_fr/motor", instancePath: "arm_fr/motor", bounds: null },
      { id: "arm_fl/motor", instancePath: "arm_fl/motor", bounds: null },
    ];
    expect(resolveRef("@board/u1", nodes)?.id).toBe("board/u1");
    expect(resolveRef("u1", nodes)?.id).toBe("board/u1");
    expect(resolveRef("motor", nodes)).toBeUndefined();
    expect(resolveRef("nothing", nodes)).toBeUndefined();
  });
  it("the legend numbers refs in order, places found ones, asks whether each is hidden", async () => {
    const nodes = [
      { id: "a", instancePath: "a", bounds: [[-10, -10, -10], [10, 10, 10]] as [[number, number, number], [number, number, number]] },
      { id: "b", instancePath: "b", bounds: [[0, -700, 0], [1, -699, 1]] as [[number, number, number], [number, number, number]] },
    ];
    const legend = await buildLegend([{ ref: "a", label: "Alpha" }, { ref: "b" }, { ref: "c" }], nodes, CAM, VP, async (n) => n.id === "a");
    expect(legend.map((e) => [e.n, e.label, e.found])).toEqual([[1, "Alpha", true], [2, "b", true], [3, "c", false]]);
    expect(legend[0]).toMatchObject({ anchorPx: [800, 500], occluded: true });
    expect(legend[1].anchorPx).toBeUndefined();
    const svg = overlaySvg(1600, 1000, [...legend, { n: 4, ref: "x", label: "<b>&", found: true, anchorPx: [100, 100] }]);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1600" height="1000"/);
    expect(svg).toContain(">1</text>");
    expect(svg).toContain("Alpha (hidden)");
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).not.toContain(">3</text>");
  });
  it("a fit frames the boxes from the direction the camera looks, with the box filling most of the view", () => {
    const cam: CameraState = { position: [300, -300, 200], target: [1000, 1000, 0], up: [0, 0, 1], fov: 32 };
    const boxes: [[number, number, number], [number, number, number]][] = [[[-100, -100, 0], [100, 100, 50]]];
    const fit = fitState(cam, boxes, 1.6)!;
    expect(fit.target).toEqual([0, 0, 25]);
    // the view direction is kept: from the target back towards where the camera was
    const dir = [300 - 1000, -300 - 1000, 200].map((v) => v / Math.hypot(700, 1300, 200));
    expect(Math.cos((fit.elevation * Math.PI) / 180) * Math.cos((fit.azimuth * Math.PI) / 180)).toBeCloseTo(dir[0], 3);
    expect(Math.sin((fit.elevation * Math.PI) / 180)).toBeCloseTo(dir[2], 3);
    const az = (fit.azimuth * Math.PI) / 180;
    const el = (fit.elevation * Math.PI) / 180;
    const position: [number, number, number] = [0 + Math.cos(el) * Math.cos(az) * fit.distance, Math.cos(el) * Math.sin(az) * fit.distance, 25 + Math.sin(el) * fit.distance];
    const { rect } = projectBounds({ ...cam, position, target: fit.target }, { x: 0, y: 0, width: 1600, height: 1000 }, boxes[0]);
    const used = Math.max(rect![2] / 1600, rect![3] / 1000);
    expect(used).toBeGreaterThan(0.8);
    expect(used).toBeLessThan(0.95);
  });
});

describe("the handoff files", () => {
  it("snapshot keys are safe file names; a snapshot is written image first, then its record", () => {
    expect(snapshotKey("", "3d")).toBe("root__3d");
    expect(snapshotKey("arm_fr/motor", "3d")).toBe("arm_fr.motor__3d");
    expect(snapshotKey("/arm_fr//motor/", "3d")).toBe("arm_fr.motor__3d");
    expect(snapshotKey("a:b", 'x"y')).toBe("a~3ab__x~22y");
    const root = join(TMP, "snap");
    const w = writeSnapshot(root, fakePng(32, 20), { view: "3d", level: "", width: 32, height: 20, css: { width: 32, height: 20, dpr: 1 }, camera: CAM, viewState: { explode: 0 }, bundleHash: "sha256:ab", revision: 3, backend: "gpu", gpu: "ANGLE", takenAt: "2026-11-01T00:00:00Z" });
    expect(existsSync(w.png)).toBe(true);
    expect(readSnapshot(root, "", "3d")).toMatchObject({ schema: "protoboard.snapshot/v0", key: "root__3d", image: "root__3d.png", camera: CAM, revision: 3, source: "render-service" });
    expect(readSnapshot(root, "", "diagram")).toBeUndefined();
  });
  it("the service record round-trips; a capture's sidecars sit beside it and are not named like a GLB view sidecar", () => {
    const root = join(TMP, "rec");
    mkdirSync(root, { recursive: true });
    const rec = { schema: "protoboard.render-service/v0" as const, url: "http://127.0.0.1:1234/", port: 1234, pid: 42, token: "t".repeat(32), root, startedAt: "", idleMs: 1, version: "0" };
    writeServiceRecord(root, rec);
    expect(readServiceRecord(root)).toEqual(rec);
    expect(captureSidecars("/x/shot.png")).toEqual({ svg: "/x/shot.overlay.svg", manifest: "/x/shot.capture.json" });
    expect(imageSize(fakePng(7, 9))).toEqual({ width: 7, height: 9 });
    expect(imageSize(fakeJpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });
});

describe("snapshot keys never collide (wave 2 gate)", () => {
  const WINDOWS_BAD = /[<>:"/\\|?*\x00-\x1f]/;
  const levels = ["", "root", "Root", "arm_fr/motor", "arm/fr_motor", "arm_fr_motor", "a b", "a_b", "a.b", "a/b", "A/b", "a~2fb", "con", "con/x", "nul", "com1/motor", "lpt9", "aux.x", "café/π", "x__y", "x_", "x".repeat(300), "x".repeat(299) + "y", "é".repeat(200)];
  const views = ["3d", "diagram", "pcb", "my_view", "my.view", "a:b", "x".repeat(64), "x".repeat(63) + "y"];
  it("distinct (level, view) pairs give distinct keys, also folded to one case", () => {
    const seen = new Map<string, string>();
    for (const l of levels)
      for (const v of views) {
        const k = snapshotKey(l, v).toLowerCase();
        const was = seen.get(k);
        expect(was, `${JSON.stringify([l, v])} and ${was} share ${k}`).toBeUndefined();
        seen.set(k, JSON.stringify([l, v]));
      }
    expect(snapshotKey("arm_fr/motor", "3d")).not.toBe(snapshotKey("arm/fr_motor", "3d"));
    expect(snapshotKey("a b", "3d")).not.toBe(snapshotKey("a_b", "3d"));
    expect(snapshotKey("root", "3d")).not.toBe(snapshotKey("", "3d"));
    // the separator stays unambiguous: a level ending in _ and a view starting with _
    expect(snapshotKey("x_", "y")).not.toBe(snapshotKey("x", "_y"));
    expect(snapshotKey("x__y", "3d")).not.toBe(snapshotKey("x", "y__3d"));
  });
  it("every key is a Windows-safe file name of bounded length; device names are escaped", () => {
    for (const l of levels)
      for (const v of views) {
        const k = snapshotKey(l, v);
        expect(k).not.toMatch(WINDOWS_BAD);
        expect(k).not.toMatch(/[. ]$/);
        expect(isDeviceName(k)).toBe(false);
        expect(isDeviceName(k.split(".")[0])).toBe(false);
        expect(k.length).toBeLessThanOrEqual(96 + 2 + 48);
      }
    expect(snapshotKey("con/x", "3d")).toBe("~63on.x__3d");
    expect(snapshotKey("x".repeat(300), "3d")).toMatch(/^x+~~[0-9a-f]{16}__3d$/);
  });
  it("readSnapshot still checks the level and view in the record", () => {
    const root = join(TMP, "snap-check");
    writeSnapshot(root, fakePng(4, 4), { view: "3d", level: "arm/fr_motor", width: 4, height: 4, css: { width: 4, height: 4, dpr: 1 }, viewState: {}, bundleHash: "", revision: 1, backend: "gpu", gpu: "", takenAt: "2026-11-01T00:00:00Z" });
    expect(readSnapshot(root, "arm/fr_motor", "3d")).toBeDefined();
    expect(readSnapshot(root, "arm_fr/motor", "3d")).toBeUndefined();
    writeSnapshot(root, fakePng(4, 4), { view: "3d", level: "arm_fr/motor", width: 4, height: 4, css: { width: 4, height: 4, dpr: 1 }, viewState: {}, bundleHash: "", revision: 2, backend: "gpu", gpu: "", takenAt: "2026-11-01T00:00:00Z" });
    // two levels, two files: neither overwrote the other
    expect(readSnapshot(root, "arm/fr_motor", "3d")?.revision).toBe(1);
    expect(readSnapshot(root, "arm_fr/motor", "3d")?.revision).toBe(2);
  });
});

describe("a visible viewer's snapshot meta", () => {
  const good = { level: "/arm_fr/motor", view: "3d", width: 1600, height: 1000, css: { width: 800, height: 500, dpr: 2 }, camera: { ...CAM, extra: 1 }, viewState: { schema: "uhd-viewer.view-state/v0", explode: 0.2 }, gpu: "ANGLE (Intel, D3D11)", theme: "protoboard-dark", takenAt: "2026-11-01T12:00:00.123Z", bundleHash: "ignored" };
  it("keeps the known fields, normalises the level, drops unknown keys", () => {
    const r = checkSnapshotMeta(good);
    expect("meta" in r).toBe(true);
    if (!("meta" in r)) return;
    expect(r.meta).toEqual({ level: "arm_fr/motor", view: "3d", width: 1600, height: 1000, css: { width: 800, height: 500, dpr: 2 }, camera: CAM, viewState: { schema: "uhd-viewer.view-state/v0", explode: 0.2 }, gpu: "ANGLE (Intel, D3D11)", theme: "protoboard-dark", takenAt: "2026-11-01T12:00:00.123Z" });
    const min = checkSnapshotMeta({ level: "", view: "diagram", width: 10, height: 20 });
    expect(min).toEqual({ meta: { level: "", view: "diagram", width: 10, height: 20, css: { width: 10, height: 20, dpr: 1 }, viewState: {}, gpu: "" } });
  });
  it("names every problem: level, view, sizes, css, camera, viewState, gpu, theme, takenAt", () => {
    const r = checkSnapshotMeta({ level: "../x", view: "3d tab", width: 0, height: 32001.5, css: { width: 1, height: 1, dpr: 9 }, camera: { position: [0, 0], target: [0, 0, 0], up: [0, 0, 1] }, viewState: [1], gpu: "g".repeat(201), theme: "a b", takenAt: "yesterday" });
    expect("error" in r).toBe(true);
    const msg = "error" in r ? r.error : "";
    for (const bit of ["level:", "view:", "width:", "height:", "css:", "camera:", "viewState:", "gpu:", "theme:", "takenAt:"]) expect(msg).toContain(bit);
    expect(checkSnapshotMeta({ ...good, camera: { ...CAM, fov: 180 } })).toMatchObject({ error: expect.stringContaining("camera.fov") });
    expect(checkSnapshotMeta({ ...good, camera: { ...CAM, position: [0, NaN, 0] } })).toMatchObject({ error: expect.stringContaining("camera:") });
    expect(checkSnapshotMeta({ ...good, width: 32001 })).toMatchObject({ error: expect.stringContaining("width:") });
    expect(checkSnapshotMeta({ ...good, viewState: { blob: "x".repeat(1 << 20) } })).toMatchObject({ error: expect.stringContaining("viewState: over") });
    expect(checkSnapshotMeta({ ...good, viewState: new Date() })).toMatchObject({ error: expect.stringContaining("viewState: a plain") });
    expect(checkSnapshotMeta(null)).toMatchObject({ error: expect.stringContaining("snapshot meta") });
  });
  it("the backend a renderer string names", () => {
    expect(backendOf("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("swiftshader");
    expect(backendOf("ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("gpu");
    expect(backendOf("")).toBe("gpu");
  });
});

describe("the service writes only inside the project unless opted out (wave 2 gate)", () => {
  const root = join(TMP, "contain");
  const outside = join(TMP, "outside");
  mkdirSync(join(root, "shots"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  it("resolveInsideProject: relative and absolute paths inside pass; .. out, elsewhere and other drives are refused", () => {
    expect(resolveInsideProject(root, "shots/a.png", "out")).toBe(join(root, "shots", "a.png"));
    expect(resolveInsideProject(root, join(root, "new", "deep", "a.png"), "out")).toBe(join(root, "new", "deep", "a.png"));
    expect(() => resolveInsideProject(root, "../outside/a.png", "out", "use --out")).toThrow(/out: .* is outside the project .*; write inside the project.*, or use --out/);
    expect(() => resolveInsideProject(root, join(outside, "a.png"), "out")).toThrow(/outside the project/);
    expect(() => resolveInsideProject(root, "shots/../../x.png", "out")).toThrow(/outside the project/);
    if (process.platform === "win32") expect(() => resolveInsideProject("C:\\p", "D:\\x.png", "out")).toThrow(/outside the project/);
    // a name that merely starts with two dots is inside
    expect(resolveInsideProject(root, "..shots/a.png", "out")).toBe(join(root, "..shots", "a.png"));
  });
  it("a symlink or junction inside the project that leads out is refused", () => {
    const link = join(root, "escape");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      return; // no permission to make links here: nothing to check
    }
    expect(() => resolveInsideProject(root, "escape/a.png", "out")).toThrow(/through a link/);
    expect(() => resolveInsideProject(root, "escape/new/dir/a.png", "out")).toThrow(/through a link/);
  });
  it("a capture with an out outside the project is refused before it is drawn (400 over HTTP); the CLI's opt-in allows it", async () => {
    const f = fakeBrowser();
    mkdirSync(join(root, ".protoboard", "build"), { recursive: true });
    const bundleFile = join(root, ".protoboard", "build", "uhd-bundle.json");
    writeFileSync(bundleFile, "{}");
    const host = (): PageHost => ({ url: "http://127.0.0.1:9/", bundleFile, version: 1, async rebuild() {}, async close() {} });
    const s = new RenderService({ root, launch: async () => f.b, startHost: async () => host() });
    expect(() => s.capture({ view: "3d", out: "../outside/x.png" })).toThrow(/capture request: out: .* is outside the project.*protoboard views capture --out/);
    expect(() => s.capture({ view: "3d", out: join(outside, "x.png") })).toThrow(/outside the project/);
    expect(f.calls.length).toBe(0);
    const ok = await s.capture({ view: "3d", out: join(outside, "x.png"), allowOutsideProject: true });
    expect(ok.imagePath).toBe(join(outside, "x.png"));
    expect(existsSync(ok.imagePath)).toBe(true);
    const manifest = JSON.parse(readFileSync(ok.manifestPath, "utf8"));
    expect(manifest.request.allowOutsideProject).toBeUndefined();
    const served = await serveRenderService(s, root, { version: "test" });
    try {
      const r = await fetch(new URL("capture", served.record.url), { method: "POST", headers: { [TOKEN_HEADER]: served.record.token, "content-type": "application/json" }, body: JSON.stringify({ view: "3d", out: "../outside/y.png" }) });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/outside the project/);
      expect(existsSync(join(outside, "y.png"))).toBe(false);
    } finally {
      await served.close();
    }
  });
});

describe("the CDP launcher's backend choice", () => {
  it("GPU flags per platform; software renderers are recognised; the environment wins over the caller", () => {
    expect(gpuFlags("win32")).toContain("--use-angle=d3d11");
    expect(gpuFlags("darwin")).toContain("--use-angle=metal");
    expect(gpuFlags("linux")).toContain("--use-angle=vulkan");
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(requestedBackend("auto", {})).toBe("auto");
    expect(requestedBackend(undefined, {})).toBe("swiftshader");
    expect(requestedBackend("auto", { PROTOBOARD_RENDER_BACKEND: "SwiftShader" })).toBe("swiftshader");
  });
});

// ---------------------------------------------------------------------------------------------
// A fake CDP browser: answers the page scripts by what they ask for

interface FakeOptions {
  backend?: "gpu" | "swiftshader";
  centre?: number[];
  captured?: number[];
  webgl2?: boolean;
  frameBytes?: number;
}

function fakeBrowser(o: FakeOptions = {}) {
  let active = "Diagram";
  let viewport = { width: 1440, height: 900, scale: 1 };
  let inFlight = 0;
  let most = 0;
  const calls: string[] = [];
  const sets: unknown[] = [];
  const b: Browser = {
    send: async () => ({}),
    navigate: async (url) => {
      calls.push(`navigate ${url}`);
    },
    setViewport: async (width, height, scale = 1) => {
      viewport = { width, height, scale };
    },
    printToPdf: async () => Buffer.alloc(0),
    screenshot: async () => fakePng(viewport.width, viewport.height),
    capture: async (c = {}) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      const s = (c.clip?.scale ?? 1) * viewport.scale;
      const w = Math.round((c.clip?.width ?? viewport.width) * s);
      const h = Math.round((c.clip?.height ?? viewport.height) * s);
      return c.format === "jpeg" ? fakeJpeg(w, h) : fakePng(w, h, o.frameBytes ?? 4000);
    },
    gl: async () => ({ webgl2: o.webgl2 ?? true, webgl1: true, renderer: o.backend === "swiftshader" ? "ANGLE (Google, Vulkan (SwiftShader Device), SwiftShader driver)" : "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11, D3D11)", vendor: "Google Inc.", webgpu: false }),
    evaluate: async <T>(expr: string): Promise<T> => {
      calls.push(expr.slice(0, 60));
      const r = (v: unknown) => v as T;
      if (expr.includes("[role=tablist] [role=tab]')].map")) return r(["Diagram", "3D", "BOM"]);
      if (expr.includes(".click()")) {
        active = /=== "([^"]+)"/.exec(expr)?.[1] ?? active;
        return r(true);
      }
      if (expr.startsWith("(document.querySelector('[role=tabpanel]')?.getAttribute('aria-label')")) return r(active);
      if (expr.includes("const panel = document.querySelector('[role=tabpanel]');\n  if (!panel) return { panel: false };")) return r({ panel: true, drawings: 1, rows: 0, empties: [], cad: active === "3D" });
      if (expr.includes("window.__cad.ready")) return r(true);
      if (expr.includes("window.__cad.set(")) {
        sets.push(JSON.parse(/__cad\.set\((\{.*?\})\); return/s.exec(expr)![1]));
        return r(true);
      }
      if (expr.includes("window.__cad.observe ?")) return r({ camera: CAM, nodes: [{ id: "a", instancePath: "a", kind: "body", visible: true, bounds: [[-10, -10, -10], [10, 10, 10]] }] });
      if (expr.includes("window.__cad.get")) return r({ schema: "uhd-viewer.view-state/v0", camera: CAM });
      if (expr.includes("window.__cad.project")) return r(undefined);
      if (expr.includes("window.__cad.pick")) return r({ instancePath: "a", distance: 490 });
      if (expr.includes("const cs = panel ?")) return r({ x: 0, y: 0, width: viewport.width, height: viewport.height });
      if (expr.includes("const load = async (src)")) return r({ changed: expr.includes('(""') ? 1 : 0, ink: 0.3 });
      if (expr.includes("gl.clearColor")) return r(o.webgl2 === false ? { ok: false, why: "no WebGL 2 context" } : { ok: true, centre: o.centre ?? [...PROBE_RGB], corner: [255, 255, 255], error: 0 });
      if (expr.includes("getImageData(x, y, 1, 1)")) return r(o.captured ?? [...PROBE_RGB]);
      return r(true);
    },
    takeErrors: () => [],
    alive: () => true,
    backend: { kind: o.backend ?? "gpu", requested: "auto", flags: ["--use-angle=d3d11"], startMs: 5, ...(o.backend === "swiftshader" ? { fallback: "the GPU flags gave a software renderer" } : {}) },
    close: async () => {},
  };
  return { b, calls, sets, most: () => most };
}

describe("views doctor against a fake CDP browser", () => {
  const base = { findBrowser: () => ({ path: "chrome.exe", name: "Google Chrome", from: "installed" }), limits: () => loadTransferLimits() };
  it("passes rendering and capture separately and names the backend", async () => {
    const f = fakeBrowser();
    const r = await runDoctor({ ...base, launch: async () => f.b });
    expect(r.ok).toBe(true);
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.backend).toMatchObject({ group: "rendering", level: "pass" });
    expect(by.backend.detail).toMatch(/GPU: ANGLE \(Intel/);
    expect(by.render.level).toBe("pass");
    expect(by.capture).toMatchObject({ group: "capture", level: "pass" });
    expect(by["capture-scale"].detail).toMatch(/32 x 32/);
    expect(by.webgpu.detail).toMatch(/captures black/);
    expect(formatDoctor(r)).toMatch(/^Rendering\n/);
  });
  it("SwiftShader is a warning; a capture that misses the WebGL frame fails capture only", async () => {
    const r = await runDoctor({ ...base, launch: async () => fakeBrowser({ backend: "swiftshader", captured: [0, 0, 0] }).b });
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.backend.level).toBe("warn");
    expect(by.backend.detail).toMatch(/GPU not used/);
    expect(by.render.level).toBe("pass");
    expect(by.capture.level).toBe("fail");
    expect(r.ok).toBe(false);
  });
  it("no WebGL 2 fails rendering; no browser stops at the first check", async () => {
    const r = await runDoctor({ ...base, launch: async () => fakeBrowser({ webgl2: false }).b });
    expect(r.checks.find((c) => c.id === "webgl2")?.level).toBe("fail");
    expect(r.checks.find((c) => c.id === "render")?.level).toBe("fail");
    const none = await runDoctor({ ...base, findBrowser: () => undefined, launch: async () => fakeBrowser().b });
    expect(none.checks.map((c) => c.id)).toEqual(["limits", "browser"]);
    expect(none.ok).toBe(false);
  });
});

describe("a capture through the service, with a fake browser and page host", () => {
  const root = join(TMP, "project");
  mkdirSync(join(root, ".protoboard", "build"), { recursive: true });
  const bundleFile = join(root, ".protoboard", "build", "uhd-bundle.json");
  writeFileSync(bundleFile, '{"v":1}');
  const host = (): PageHost & { rebuilds: number } => ({ url: "http://127.0.0.1:9/", bundleFile, version: 1, rebuilds: 0, async rebuild() { this.rebuilds++; }, async close() {} });

  it("writes the image, the overlay, the manifest and the tab's snapshot; the legend comes from observe()", async () => {
    const f = fakeBrowser();
    const h = host();
    const s = new RenderService({ root, launch: async () => f.b, startHost: async () => h });
    const r = await s.capture({ view: "3d", annotate: ["a", "missing"], state: { azimuth: 30, elevation: 20, distance: 400 }, out: "shots/one.png" });
    expect(isCaptureResponse(r)).toBe(true);
    expect(r).toMatchObject({ view: "3d", width: 1600, height: 1000, format: "png", backend: "gpu", revision: 1, changed: true, pixelsChangedShare: 1, stale: false });
    expect(r.imagePath).toBe(join(root, "shots", "one.png"));
    expect(existsSync(r.svgPath!)).toBe(true);
    expect(r.legend[0]).toMatchObject({ n: 1, ref: "a", found: true, anchorPx: [800, 500], occluded: false });
    expect(r.legend[1]).toMatchObject({ n: 2, found: false });
    expect(r.warnings.join(" ")).toMatch(/no part "missing"/);
    expect(r.viewState.camera).toEqual(CAM);
    // the view state was set with the labels off (marks are drawn by the overlay) and as a still
    expect(f.sets[0]).toMatchObject({ azimuth: 30, labels: false, snap: true });
    const manifest = JSON.parse(readFileSync(r.manifestPath, "utf8"));
    expect(manifest).toMatchObject({ schema: "protoboard.capture-manifest/v0", image: "shots/one.png", overlay: "shots/one.overlay.svg", request: { view: "3d", state: { azimuth: 30 } }, rerender: "protoboard views capture --from shots/one.capture.json" });
    expect(manifest.request.out).toBeUndefined();
    expect(readSnapshot(root, "", "3d")).toMatchObject({ camera: CAM, viewState: { camera: CAM }, backend: "gpu", revision: 1 });
    await s.close();
  });

  it("a document capture without a camera frames the model; ifChanged returns the last image when nothing changed", async () => {
    const f = fakeBrowser();
    const s = new RenderService({ root, launch: async () => f.b, startHost: async () => host() });
    const first = await s.capture({ view: "3d" });
    // the fit comes after the rest of the state is drawn (an explode moves the parts)
    const fit = f.sets.find((x) => (x as { target?: unknown }).target) as { target: number[]; distance: number };
    expect(fit.target).toEqual([0, 0, 0]);
    expect(typeof fit.distance).toBe("number");
    expect(first.format).toBe("jpeg");
    const again = await s.capture({ view: "3d", ifChanged: true });
    expect(again).toMatchObject({ changed: false, imagePath: first.imagePath });
    await s.close();
  });

  it("serializes concurrent captures; a bundle changed on disk is rebuilt and bumps the revision", async () => {
    const f = fakeBrowser();
    const h = host();
    const s = new RenderService({ root, launch: async () => f.b, startHost: async () => h });
    const all = await Promise.all([s.capture({ view: "3d", out: "c1.png" }), s.capture({ view: "diagram", out: "c2.png" }), s.capture({ view: "3d", out: "c3.png", format: "png" })]);
    expect(f.most()).toBe(1);
    expect(all.map((r) => r.revision)).toEqual([1, 1, 1]);
    writeFileSync(bundleFile, '{"v":2}');
    const next = await s.capture({ view: "3d", out: "c4.png" });
    expect(h.rebuilds).toBe(1);
    expect(next.revision).toBe(2);
    expect(next.bundleHash).not.toBe(all[0].bundleHash);
    await expect(s.capture({ view: "schematic" })).rejects.toThrow(/no schematic tab/);
    await s.close();
  });

  it("the loopback server: token and loopback Host required; a client finds the running service and captures", async () => {
    const f = fakeBrowser();
    const s = new RenderService({ root, launch: async () => f.b, startHost: async () => host() });
    const served = await serveRenderService(s, root, { version: "test" });
    try {
      const url = served.record.url;
      expect((await fetch(new URL("health", url))).status).toBe(403);
      expect((await fetch(new URL("health", url), { headers: { [TOKEN_HEADER]: "wrong" } })).status).toBe(403);
      const ok = await fetch(new URL("health", url), { headers: { [TOKEN_HEADER]: served.record.token } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, root });
      const bad = await fetch(new URL("capture", url), { method: "POST", headers: { [TOKEN_HEADER]: served.record.token, "content-type": "application/json" }, body: JSON.stringify({ view: 3 }) });
      expect(bad.status).toBe(400);
      const spawn = vi.fn();
      const client = await ensureRenderService(root, { spawn, version: "test" });
      expect(spawn).not.toHaveBeenCalled();
      expect(client.started).toBe(false);
      const r = await client.capture({ view: "3d", out: "via-http.png" });
      expect(r.imagePath).toBe(join(root, "via-http.png"));
      expect((await client.health()).captures).toBeGreaterThanOrEqual(1);
    } finally {
      await served.close();
    }
    expect(readServiceRecord(root)).toBeUndefined();
    expect(await connectRenderService(root)).toBeUndefined();
  });

  it("starts a service when none answers (the caller's spawn), and waits for its record", async () => {
    const f = fakeBrowser();
    let served: Awaited<ReturnType<typeof serveRenderService>> | undefined;
    const spawn = () => {
      const s = new RenderService({ root, launch: async () => f.b, startHost: async () => host() });
      void serveRenderService(s, root, { version: "v2" }).then((x) => (served = x));
    };
    try {
      const client = await ensureRenderService(root, { spawn, version: "v2", timeoutMs: 5000 });
      expect(client.started).toBe(true);
      expect((await client.health()).ok).toBe(true);
    } finally {
      await served?.close();
    }
  });
});

describe("drawnRecords (gate 3)", () => {
  it("reads the annotation layer's per-record status from the page, and nothing when the viewer has no layer", async () => {
    const run = (cad: unknown) => ({
      evaluate: async <T>(expr: string): Promise<T> => new Function("window", `return ${expr}`)({ __cad: cad }) as T,
    });
    const records = [
      { id: "a.e.1", kind: "mark", status: "placed", anchorPx: [10, 20, 99], extra: "dropped" },
      { id: "a.e.2", kind: "callout", status: "occluded", ref: "stack/fc", anchorPx: [10, 20] },
    ];
    const got = await drawnRecords(run({ annotations: () => ({ records, findings: [] }) }) as never);
    expect(got).toEqual([
      { id: "a.e.1", kind: "mark", status: "placed", anchorPx: [10, 20] },
      { id: "a.e.2", kind: "callout", status: "occluded", ref: "stack/fc", anchorPx: [10, 20] },
    ]);
    expect(await drawnRecords(run({}) as never)).toBeUndefined();
    expect(await drawnRecords(run(undefined) as never)).toBeUndefined();
  });
});

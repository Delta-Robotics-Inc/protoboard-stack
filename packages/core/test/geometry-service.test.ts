/**
 * The exact measurement tier (PB-1187): which STEP a part resolves to
 * (resolved.json, on disk, inside the project, under the cap), the worker
 * over JSON lines in the CAD runtime (faces, bounds, a hole's diameter and
 * axis found by signature, two faces), timeouts and restarts, the protocol
 * file shared with the viewer, and the atomic sequence write.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { GEOMETRY_REQUEST_SCHEMA, GeometryService, checkGeometryRequest, resolvePartStep } from "../src/geometry-service/index.js";
import { writeAtomic } from "../src/sequence/project.js";
import { cadPython } from "./cad-python.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const stackRoot = join(here, "..", "..", "..");
const TMP_PARENT = join(here, ".tmp");
mkdirSync(TMP_PARENT, { recursive: true });
// per run: other vitest processes run these packages at the same time (wave 2 gate)
const TMP = mkdtempSync(join(TMP_PARENT, "geometry-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const SCREW = join(stackRoot, "examples", "quadcopter-5in", "parts", "local", "iso-4762-m3x8", "out", "body.step");
const PYTHON = cadPython();

/** A project folder holding resolved.json rows and the files they name. */
function project(name: string, rows: Record<string, unknown>[], files: Record<string, string | Buffer> = {}): string {
  const dir = join(TMP, name);
  mkdirSync(join(dir, ".protoboard", "build"), { recursive: true });
  writeFileSync(join(dir, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(dir, ".protoboard", "build", "resolved.json"), JSON.stringify({ models: { instances: rows } }));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

describe("which STEP a part is measured on", () => {
  it("reads resolved.json: the instance's step, a component's holder, on disk and inside the project", () => {
    const dir = project("resolve", [
      { instance: "frame", step: { file: "src/frame/body.step", sha256: "sha256:abc" } },
      { instance: "pcb", step: { file: "src/pcb/body.step" } },
      { instance: "pcb/u1", drawnBy: "pcb" },
      { instance: "gps", file: "parts/gps.glb" },
      { instance: "fan", placeholder: true, step: { file: "src/fan/body.step" } },
      { instance: "vendor", step: { file: "parts/catalog/vendor/model.step" } },
      { instance: "escape", step: { file: "../outside.step" } },
    ], { "src/frame/body.step": "ISO-10303-21;", "src/pcb/body.step": "ISO-10303-21;", "src/fan/body.step": "ISO-10303-21;" });
    writeFileSync(join(TMP, "outside.step"), "ISO-10303-21;");
    const f = resolvePartStep(dir, "frame");
    expect(f.relative).toBe("src/frame/body.step");
    expect(f.file).toBe(realpathSync(join(dir, "src/frame/body.step")));
    expect(f.sha256).toBe("sha256:abc");
    expect(resolvePartStep(dir, "pcb/u1").holder).toBe("pcb");
    // a component path the table does not list rides on the body that holds it
    expect(resolvePartStep(dir, "pcb/power/u13").holder).toBe("pcb");
    expect(resolvePartStep(dir, "fan").placeholder).toBe(true);
    expect(() => resolvePartStep(dir, "gps")).toThrow(/no source STEP/);
    expect(() => resolvePartStep(dir, "vendor")).toThrow(/not on disk/);
    expect(() => resolvePartStep(dir, "escape")).toThrow(/outside the project/);
    expect(() => resolvePartStep(dir, "nope")).toThrow(/not in the model table/);
    expect(() => resolvePartStep(dir, "frame", { maxBytes: 4 })).toThrow(/cap/);
    expect(() => resolvePartStep(join(TMP, "none"), "frame")).toThrow(/resolved.json is missing/);
  });
});

describe("the protocol shared with the viewer", () => {
  const viewerLink = join(stackRoot, "node_modules", "@deltarobotics", "uhd-viewer");
  const viewer = existsSync(viewerLink) ? realpathSync(viewerLink) : undefined;
  const theirs = viewer ? join(viewer, "src", "cad", "measure", "protocol.ts") : undefined;
  it.skipIf(!theirs || !existsSync(theirs))("is identical in core and the linked uhd-viewer checkout", () => {
    const a = readFileSync(join(here, "..", "src", "geometry-service", "protocol.ts"), "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(theirs!, "utf8").replace(/\r\n/g, "\n");
    expect(b).toBe(a);
  });
  it("checks request shapes", () => {
    expect(checkGeometryRequest({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "bounds", a: { part: "frame" } })).toBeUndefined();
    expect(checkGeometryRequest({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "point-point", a: { part: "a", point: [0, 0, 0] }, b: { part: "b" } })).toMatch(/point/);
    expect(checkGeometryRequest({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "bounds", a: { part: "a", transform: [1, 2] } })).toMatch(/16 numbers/);
  });
});

describe.skipIf(!PYTHON || !existsSync(SCREW))("the build123d worker", () => {
  const dir = () => project("worker", [{ instance: "screw", step: { file: "parts/screw/body.step" } }], { "parts/screw/body.step": readFileSync(SCREW) });
  let svc: GeometryService | undefined;
  afterAll(() => svc?.close());

  it("lists faces, measures bounds and finds a round face by its signature", async () => {
    const root = dir();
    svc = new GeometryService(root, { python: PYTHON });
    const info = await svc.start();
    expect(info.build123d).toMatch(/^\d+\.\d+/);
    const faces = await svc.faces("screw", 1000);
    expect(faces.faces).toBeGreaterThan(3);
    const cyl = (faces.listed as { index: number; type: string; radius?: number; axis?: number[]; axisPoint?: number[]; centroid: number[]; area: number }[]).find((f) => f.type === "CYLINDER")!;
    expect(cyl).toBeDefined();
    const b = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "bounds", a: { part: "screw" } });
    expect(b.tier).toBe("exact");
    expect(b.frame).toBe("part");
    expect(b.size!.every((x) => x > 0)).toBe(true);
    expect(b.files).toEqual({ screw: "parts/screw/body.step" });
    // a signature a little off (as a mesh gives it): the same face comes back
    const sig = { type: "cylinder" as const, centroid: cyl.centroid.map((x) => x + 0.01) as [number, number, number], axis: cyl.axis as [number, number, number], axisPoint: cyl.axisPoint as [number, number, number], radius: cyl.radius! * 0.999, area: cyl.area * 0.99 };
    const c = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "cylinder", a: { part: "screw", signature: sig } });
    expect(c.faces!.a!.brepFace).toBe(cyl.index);
    expect(c.radius).toBeCloseTo(cyl.radius!, 3);
    expect(c.diameter).toBeCloseTo(2 * cyl.radius!, 3);
    // placed in the assembly: the axis moves with the transform
    const moved = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "cylinder", a: { part: "screw", signature: sig, transform: [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1] } });
    expect(moved.frame).toBe("assembly");
    expect(moved.axis!.point[0]).toBeCloseTo(c.axis!.point[0] + 10, 3);
    // a placement written with rounded numbers (off orthonormal by ~1e-4) is squared up, and the result says so
    const c45 = 0.7071;
    const rounded = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "cylinder", a: { part: "screw", signature: sig, transform: [c45, -c45, 0, 0, c45, c45, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } });
    expect(rounded.notes!.join(" ")).toMatch(/squared up/);
    expect(rounded.diameter).toBeCloseTo(c.diameter!, 4);
    // a scaled transform is refused (a placement is rigid)
    await expect(svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "bounds", a: { part: "screw", transform: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1] } })).rejects.toThrow(/no scale/);
    // two faces, by index
    const ff = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "face-face", a: { part: "screw", brepFace: cyl.index }, b: { part: "screw", brepFace: cyl.index } });
    expect(ff.distance).toBeCloseTo(0, 6);
  }, 120_000);

  it("stops a worker that takes too long and starts a new one for the next request", async () => {
    const root = dir();
    const s = new GeometryService(root, { python: PYTHON, timeoutMs: 1, loadTimeoutMs: 1 });
    await s.start();
    await expect(s.load("screw")).rejects.toThrow(/longer than/);
    const ok = new GeometryService(root, { python: PYTHON });
    expect((await ok.load("screw")).faces).toBeGreaterThan(3);
    expect((await ok.load("screw")).cached).toBe(true);
    ok.close();
    s.close();
  }, 120_000);

  it("after a timeout, the same instance starts a new worker that the old one's exit does not stop (gate 3)", async () => {
    const root = dir();
    const s = new GeometryService(root, { python: PYTHON });
    await s.start();
    await expect(s.call({ op: "load", file: s.resolve("screw").file }, 1)).rejects.toThrow(/longer than/);
    expect((await s.load("screw")).faces).toBeGreaterThan(3);
    // a little later (the old worker's exit has long fired): the new worker still answers
    await new Promise((r) => setTimeout(r, 300));
    expect((await s.load("screw")).cached).toBe(true);
    s.close();
  }, 120_000);
});

describe("writeAtomic (sequence.json while the dev server reads it)", () => {
  it("replaces the file whole and leaves no temporary file behind", () => {
    const d = mkdtempSync(join(TMP, "atomic-"));
    const f = join(d, "sequence.json");
    writeAtomic(f, "one\n");
    writeAtomic(f, "two\n");
    expect(readFileSync(f, "utf8")).toBe("two\n");
    expect(readdirSync(d)).toEqual(["sequence.json"]);
    expect(() => writeAtomic(join(d, "missing", "x.json"), "x")).toThrow();
    expect(readdirSync(d)).toEqual(["sequence.json"]);
  });
});

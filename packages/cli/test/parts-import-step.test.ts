/**
 * `protoboard parts import-step` (PB-1191, W4-B): a STEP inside the project
 * becomes a part's body (recorded with its sha256, bound to ext-parts'
 * import), with an evidence session when it came through a reference tool.
 * The conversion through scripts/import_cad.py runs only when a CAD runtime
 * is there (PROTOBOARD_PYTHON with build123d); the rest needs none.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { readPartSources } from "@protoboardai/core";
import { partsImportStep } from "../src/parts-import-step.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/parts-import-step");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const project = (files: Record<string, string | Buffer>) => {
  const dir = join(TMP, `p${n++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const CONFIG = `import { defineConfig } from "@protoboardai/core";
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"], extensions: ["@protoboardai/ext-parts"] });
`;
const WIDGET = `import type { ModuleDef } from "@deltarobotics/uhd";
export const WIDGET: ModuleDef = { id: "widget", name: "Widget", kind: "module", interfaces: [], domains: [{ domain: "mechanical", dimensions_mm: { length: 10, width: 6, height: 2 } }] };
`;
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export { WIDGET } from "../parts/local/widget.uhd.ts";
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "w", moduleDefId: "widget" }] };
`;
const STEP = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
const TOOL = JSON.stringify({
  schema: "protoboard.reference-tool/v0",
  id: "scan-bar-100",
  name: "Scan ruler 100 mm",
  kind: "scan-ruler",
  nominal: [{ name: "length", value: 100, unit: "mm", tolerance: { plus: 0.05, minus: 0.05 }, source: "test" }],
  source: { maker: "test" },
  evidence: { layout: "parts/local/<part>/evidence/<date>-<tool>/", photos: true },
});
const base = (extra: Record<string, string | Buffer> = {}) =>
  project({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS, "parts/local/widget.uhd.ts": WIDGET, "parts/local/widget/scan/body.step": STEP, "parts/reference-tools/scan-bar-100.json": TOOL, ...extra });

const run = async (dir: string, rest: string[], flags: Record<string, unknown>) => {
  let data: Record<string, unknown> = {};
  let text = "";
  const code = await partsImportStep(dir, rest, flags, (d, t) => {
    data = d as Record<string, unknown>;
    text = t();
  });
  return { code, data, text };
};

describe("parts import-step: recording", () => {
  it("records the STEP with its sha256, binds the import, and writes the tool's evidence session", async () => {
    const dir = base();
    const r = await run(dir, ["parts/local/widget/scan/body.step"], { part: "widget", tool: "scan-bar-100", run: false });
    expect(r.code).toBe(0);
    const src = readPartSources(dir).parts.widget.files[0];
    expect(src).toMatchObject({ format: "step", path: "parts/local/widget/scan/body.step", source: { type: "imported" } });
    expect(src.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, "parts/local/widget/cad.config.ts"), "utf8")).toMatch(/constraints: \{ import: ".\/scan\/body.step", sha256: "sha256:/);
    const ev = (r.data as { evidence: { file: string } }).evidence;
    expect(ev.file).toMatch(/^parts\/local\/widget\/evidence\/\d{4}-\d{2}-\d{2}-scan-bar-100\/evidence.json$/);
    const rec = JSON.parse(readFileSync(join(dir, ev.file), "utf8"));
    expect(rec.imported).toMatchObject({ file: "parts/local/widget/scan/body.step", sha256: src.sha256, format: "step", provenance: { method: "measured-from-reference-tool", tool: "scan-bar-100" } });
    expect(r.text).toMatch(/next: protoboard run cad:generate --module widget/);
  });

  it("refuses files outside the project, files that are not STEP, unknown tools, and missing arguments", async () => {
    const dir = base();
    const outside = join(TMP, "outside.step");
    writeFileSync(outside, STEP);
    await expect(run(dir, [outside], { part: "widget" })).rejects.toThrow(/outside the project/);
    writeFileSync(join(dir, "parts/local/widget/scan/body.stl"), "solid x\nendsolid x\n");
    await expect(run(dir, ["parts/local/widget/scan/body.stl"], { part: "widget" })).rejects.toThrow(/takes a STEP file/);
    await expect(run(dir, ["parts/local/widget/scan/body.step"], { part: "widget", tool: "nope", run: false })).rejects.toThrow(/no reference tool "nope"/);
    await expect(run(dir, ["parts/local/widget/scan/body.step"], {})).rejects.toThrow(/usage: protoboard parts import-step/);
    // nothing was recorded by the refused calls
    expect(existsSync(join(dir, "parts/sources.json"))).toBe(false);
  });

  it("applies the import size cap", async () => {
    const dir = base();
    process.env.PROTOBOARD_MAX_IMPORT_BYTES = "10";
    try {
      await expect(run(dir, ["parts/local/widget/scan/body.step"], { part: "widget", run: false })).rejects.toThrow(/over the 10-byte import limit/);
    } finally {
      delete process.env.PROTOBOARD_MAX_IMPORT_BYTES;
    }
  });
});

const PY = process.env.PROTOBOARD_PYTHON;
const hasBuild123d = (() => {
  if (!PY || !existsSync(PY)) return false;
  try {
    execFileSync(PY, ["-c", "import build123d"], { stdio: "ignore", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasBuild123d)("parts import-step: conversion on the CAD runtime (PROTOBOARD_PYTHON with build123d)", () => {
  it("makes out/body.step, body.glb and body.manifest.json through import_cad.py", async () => {
    const dir = base();
    const step = join(dir, "parts/local/widget/scan/box.step");
    execFileSync(PY!, ["-c", "import sys\nfrom build123d import Box, export_step\nexport_step(Box(10, 6, 2), sys.argv[1])", step], { timeout: 120_000 });
    const r = await run(dir, ["parts/local/widget/scan/box.step"], { part: "widget" });
    expect(r.text).toMatch(/SUCCEEDED cad:export/);
    expect(r.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "parts/local/widget/out/body.manifest.json"), "utf8"));
    expect(manifest.source).toMatchObject({ file: "box.step", format: "step", provenance: "imported" });
    expect(manifest.bbox_mm.size).toEqual([10, 6, 2]);
    expect(existsSync(join(dir, "parts/local/widget/out/body.glb"))).toBe(true);
  }, 300_000);
});

/**
 * The reference-tool registry and the evidence layout (PB-1191, W4-B):
 * protoboard.reference-tool/v0 records, their loader (built in, user,
 * project; the project wins) and validator, model pinning by sha256, and the
 * evidence writer with its scale check.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sha256OfFile } from "../src/part-files.js";
import {
  BUILTIN_REFERENCE_TOOLS,
  MANUAL_TOOL,
  MEASURED_FROM_REFERENCE_TOOL,
  REFERENCE_TOOL_SCHEMA,
  evidenceDirName,
  loadReferenceTools,
  parseMeasurement,
  referenceTool,
  safeRelativePath,
  scaleCheck,
  validateReferenceTool,
  writeReferenceEvidence,
  type ReferenceTool,
} from "../src/reference-tool/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/reference-tool");
let n = 0;
const dir = () => {
  const d = join(TMP, `p${n++}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
};
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const block = (over: Partial<ReferenceTool> = {}): ReferenceTool => ({
  schema: REFERENCE_TOOL_SCHEMA,
  id: "gauge-25",
  name: "Gauge block 25 mm",
  kind: "gauge-block",
  nominal: [{ name: "length", value: 25, unit: "mm", tolerance: { plus: 0.001, minus: 0.001 }, source: "test certificate" }],
  source: { maker: "test" },
  evidence: { layout: "parts/local/<part>/evidence/<date>-<tool>/", photos: true },
  ...over,
});

describe("the record and its validator", () => {
  it("accepts the built-in entries (ScanRuler and BumpMesh, references only, pinned MCP)", () => {
    for (const t of BUILTIN_REFERENCE_TOOLS) expect(validateReferenceTool(t), t.id).toEqual([]);
    const sr = BUILTIN_REFERENCE_TOOLS.find((t) => t.id === "scanruler")!;
    expect(sr.software?.relationship).toBe("reference");
    expect(sr.software?.license).toBe("AGPL-3.0-only");
    expect(sr.software?.mcp?.args).toContain("--no-update");
    expect(sr.software?.mcp?.args.some((a) => /@\d+\.\d+\.\d+$/.test(a))).toBe(true);
    expect(sr.software?.provenanceMethod).toBe(MEASURED_FROM_REFERENCE_TOOL);
  });

  it("accepts a physical reference with sourced nominal values", () => {
    expect(validateReferenceTool(block())).toEqual([]);
  });

  it("says what is wrong, in words a person can act on", () => {
    const errs = (x: unknown) => validateReferenceTool(x).join(" | ");
    expect(errs({ ...block(), schema: "x" })).toMatch(/schema must be/);
    expect(errs({ ...block(), id: "Bad Id" })).toMatch(/id must be/);
    expect(errs({ ...block(), id: "con" })).toMatch(/id must be/);
    expect(errs({ ...block(), kind: "laser" })).toMatch(/kind must be/);
    expect(errs({ ...block(), nominal: [] })).toMatch(/at least one nominal/);
    expect(errs(block({ nominal: [{ name: "length", value: 25, unit: "mm", tolerance: { plus: 0.001, minus: 0.001 } }] }))).toMatch(/needs a source/);
    expect(errs(block({ nominal: [{ name: "length", value: 25, unit: "mm", tolerance: { plus: 0.001, minus: 0.001 }, assumption: true, note: "nominal from the drawing" }] }))).toBe("");
    expect(errs(block({ nominal: [{ name: "length", value: -1, unit: "ft" as never, tolerance: { plus: -1, minus: 0 }, source: "x" }] }))).toMatch(/positive number.*unit must be.*tolerance/);
    expect(errs(block({ source: { lcsc: "12345" } }))).toMatch(/LCSC C number/);
    expect(errs(block({ model: { path: "../outside.stl", sha256: "sha256:00", format: "stl", units: "mm" } }))).toMatch(/model.path.*model.sha256/);
    expect(errs(block({ evidence: { layout: "evidence/", photos: true } }))).toMatch(/<part>, <date> and <tool>/);
    const sw = { ...BUILTIN_REFERENCE_TOOLS[0], software: { ...BUILTIN_REFERENCE_TOOLS[0].software!, relationship: "bundled", mcp: { command: "npx", args: ["-y", "scanruler-mcp"], transport: "stdio" } } };
    expect(errs(sw)).toMatch(/relationship must be "reference".*pin it to an exact version/);
    expect(errs({ ...block(), software: BUILTIN_REFERENCE_TOOLS[0].software })).toMatch(/only for kind software/);
  });

  it("keeps relative paths where they are put", () => {
    for (const ok of ["a.stl", "parts/reference-tools/cube.stl"]) expect(safeRelativePath(ok), ok).toBe(true);
    for (const bad of ["../a.stl", "/abs.stl", "C:/x.stl", "a/../../b", "a/b./c", 'a"b.stl', "nul.stl", "a//b"]) expect(safeRelativePath(bad), bad).toBe(false);
  });
});

describe("the loader", () => {
  it("reads built-in, user and project entries; the project wins; bad files are reported, not fatal", () => {
    const root = dir();
    const home = dir();
    mkdirSync(join(home, "reference-tools"), { recursive: true });
    writeFileSync(join(home, "reference-tools", "gauge-25.json"), JSON.stringify(block({ name: "from the user" })));
    mkdirSync(join(root, "parts/reference-tools"), { recursive: true });
    writeFileSync(join(root, "parts/reference-tools", "gauge-25.json"), JSON.stringify(block({ name: "from the project" })));
    writeFileSync(join(root, "parts/reference-tools", "broken.json"), "{ not json");
    writeFileSync(join(root, "parts/reference-tools", "invalid.json"), JSON.stringify({ ...block(), id: "invalid", nominal: [] }));
    writeFileSync(join(root, "parts/reference-tools", "notes.txt"), "ignored");
    const r = loadReferenceTools(root, { home });
    expect([...r.tools.keys()].sort()).toEqual(["bumpmesh", "gauge-25", "scanruler"]);
    expect(r.tools.get("gauge-25")).toMatchObject({ origin: "project", tool: { name: "from the project", source: { origin: "project" } } });
    expect(r.problems.map((p) => p.file.split(/[\\/]/).pop()).sort()).toEqual(["broken.json", "invalid.json"]);
    expect(() => referenceTool(r, "invalid")).toThrow(/is not valid: a physical reference needs at least one nominal/);
    expect(() => referenceTool(r, "nope")).toThrow(/no reference tool "nope".*parts\/reference-tools\/nope.json/);
    expect(loadReferenceTools(root, { home: false, builtins: false }).tools.size).toBe(1);
  });

  it("refuses oversized records", () => {
    const root = dir();
    mkdirSync(join(root, "parts/reference-tools"), { recursive: true });
    writeFileSync(join(root, "parts/reference-tools", "big.json"), JSON.stringify({ ...block(), description: "x".repeat(300 * 1024) }));
    const r = loadReferenceTools(root, { home: false });
    expect(r.problems[0].errors[0]).toMatch(/over the 262144-byte limit/);
  });

  it("checks a model file against its pinned sha256: ok, changed, missing", () => {
    const root = dir();
    mkdirSync(join(root, "parts/reference-tools"), { recursive: true });
    const stl = join(root, "parts/reference-tools/cube.stl");
    writeFileSync(stl, "solid cube\nendsolid cube\n");
    const sha = sha256OfFile(stl);
    const cube = (id: string, path: string, sha256: string) => block({ id, kind: "calibration-cube", model: { path, sha256, format: "stl", units: "mm" } });
    writeFileSync(join(root, "parts/reference-tools/a.json"), JSON.stringify(cube("cube-a", "parts/reference-tools/cube.stl", sha)));
    writeFileSync(join(root, "parts/reference-tools/b.json"), JSON.stringify(cube("cube-b", "parts/reference-tools/cube.stl", `sha256:${"0".repeat(64)}`)));
    writeFileSync(join(root, "parts/reference-tools/c.json"), JSON.stringify(cube("cube-c", "parts/reference-tools/gone.stl", sha)));
    const r = loadReferenceTools(root, { home: false });
    expect(r.tools.get("cube-a")!.model).toMatchObject({ status: "ok", sha256: sha });
    expect(r.tools.get("cube-b")!.model).toMatchObject({ status: "changed", sha256: sha });
    expect(r.tools.get("cube-c")!.model?.status).toBe("missing");
  });
});

describe("measurements and the scale check", () => {
  it("parses name=value<unit>, an uncertainty, and ref: for the tool itself", () => {
    expect(parseMeasurement("hole-diameter=3.02mm")).toEqual({ name: "hole-diameter", value: 3.02, unit: "mm" });
    expect(parseMeasurement("od = 0.5in+-0.001")).toEqual({ name: "od", value: 0.5, unit: "in", uncertainty: 0.001 });
    expect(parseMeasurement("ref:length=25.0004mm")).toEqual({ name: "length", value: 25.0004, unit: "mm", reference: "length" });
    expect(() => parseMeasurement("length 25")).toThrow(/name=value<unit>/);
    expect(() => parseMeasurement("length=25ft")).toThrow(/name=value<unit>/);
  });

  it("checks the tool measured in the same photo against its nominal and tolerance, across units", () => {
    const t = block();
    expect(scaleCheck(t, { name: "length", value: 25.0004, unit: "mm", reference: "length" })).toMatchObject({ withinTolerance: true, deviation: expect.closeTo(0.0004, 9) });
    const off = scaleCheck(t, { name: "length", value: 25.1, unit: "mm", reference: "length" });
    expect(off.withinTolerance).toBe(false);
    expect(off.factor).toBeCloseTo(25 / 25.1, 9);
    expect(scaleCheck(t, { name: "length", value: 25000.5, unit: "um", reference: "length" }).withinTolerance).toBe(true);
    expect(() => scaleCheck(t, { name: "width", value: 1, unit: "mm", reference: "width" })).toThrow(/no nominal dimension "width"/);
    expect(() => scaleCheck(t, { name: "length", value: 1, unit: "deg", reference: "length" })).toThrow(/cannot be checked/);
  });
});

describe("the evidence layout writer", () => {
  it("writes parts/local/<part>/evidence/<date>-<tool>/ with the photos, the values and their provenance", () => {
    const root = dir();
    const k = n;
    const photo = join(root, "..", `photo ${k}.JPG`);
    writeFileSync(photo, "jpeg bytes");
    const w = writeReferenceEvidence(root, {
      part: "bracket",
      partDir: "parts/local/bracket",
      tool: block(),
      date: "2026-11-01",
      photos: [photo],
      measurements: [parseMeasurement("ref:length=25.0002mm"), parseMeasurement("slot-width=6.11mm+-0.02")],
      by: { kind: "agent", who: "w4b-test" },
    });
    expect(w.dir).toBe("parts/local/bracket/evidence/2026-11-01-gauge-25");
    expect(evidenceDirName("2026-11-01", "gauge-25")).toBe("2026-11-01-gauge-25");
    const rec = JSON.parse(readFileSync(join(root, w.file), "utf8"));
    expect(rec.schema).toBe("protoboard.reference-evidence/v0");
    expect(rec.tool).toMatchObject({ id: "gauge-25", kind: "gauge-block", nominal: [{ name: "length", value: 25 }] });
    expect(rec.files).toEqual([{ file: `parts/local/bracket/evidence/2026-11-01-gauge-25/photo-${k}.jpg`, sha256: sha256OfFile(photo), bytes: 10, from: `photo ${k}.JPG` }]);
    expect(rec.measurements[1]).toMatchObject({ name: "slot-width", value: 6.11, unit: "mm", uncertainty: 0.02, provenance: { method: MEASURED_FROM_REFERENCE_TOOL, tool: "gauge-25", evidence: w.dir } });
    expect(rec.measurements[0].check.withinTolerance).toBe(true);
    expect(rec.scale).toMatchObject({ reference: "length", withinTolerance: true });
    // no absolute path of this machine in the record
    expect(JSON.stringify(rec)).not.toContain(root.replace(/\\/g, "\\\\"));
    // a second session the same day: a new folder, nothing overwritten
    const again = writeReferenceEvidence(root, { part: "bracket", partDir: "parts/local/bracket", tool: block(), date: "2026-11-01", measurements: [parseMeasurement("slot-width=6.10mm")] });
    expect(again.dir).toBe("parts/local/bracket/evidence/2026-11-01-gauge-25-2");
  });

  it("refuses what it must: runnable files, oversized files, folders outside the project, nothing to record, bad dates", () => {
    const root = dir();
    const exe = join(root, "..", "tool.exe");
    writeFileSync(exe, "MZ");
    const base = { part: "p", partDir: "parts/local/p", tool: MANUAL_TOOL, date: "2026-11-01" };
    expect(() => writeReferenceEvidence(root, { ...base, photos: [exe] })).toThrow(/files that can run/);
    expect(() => writeReferenceEvidence(root, { ...base, partDir: "../elsewhere", measurements: [parseMeasurement("a=1mm")] })).toThrow(/outside the project/);
    expect(() => writeReferenceEvidence(root, base)).toThrow(/nothing to record/);
    expect(() => writeReferenceEvidence(root, { ...base, date: "1 Nov", measurements: [parseMeasurement("a=1mm")] })).toThrow(/YYYY-MM-DD/);
    // a scale check against a tool with no such nominal fails before anything is written
    expect(() => writeReferenceEvidence(root, { ...base, measurements: [parseMeasurement("ref:length=1mm")] })).toThrow(/no nominal dimension/);
    expect(existsSync(join(root, "parts/local/p/evidence"))).toBe(false);
    const big = join(root, "..", "big.png");
    writeFileSync(big, Buffer.alloc(2048));
    process.env.PROTOBOARD_MAX_EVIDENCE_BYTES = "1024";
    try {
      expect(() => writeReferenceEvidence(root, { ...base, photos: [big] })).toThrow(/over the 1024-byte limit/);
    } finally {
      delete process.env.PROTOBOARD_MAX_EVIDENCE_BYTES;
    }
  });
});

/**
 * `protoboard drawing` end to end (PB-1190): the CLI module spawns the `drawing` Python package on the CAD
 * runtime against two fixtures the package generates itself (a DXF written with ezdxf and a hand-written vector
 * PDF of the same plate, plus three STEP models: right, 2 mm too wide with 10 mm holes, and 5x too large).
 * Needs PROTOBOARD_PYTHON (a CAD runtime with build123d, ezdxf and pdfplumber); skips without it.
 * The Python side's own tests: scripts/drawing/tests (unittest).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAWING_USAGE, drawingCommand, drawingPackage, formatDrawing } from "../../cli/src/drawing.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PY = process.env.PROTOBOARD_PYTHON || undefined;
const PKG = fileURLToPath(new URL("../scripts/drawing", import.meta.url));

if (!PY) console.warn("drawing.test.ts: PROTOBOARD_PYTHON is not set, so the drawing tests that run Python are skipped (set it to a CAD runtime with build123d, ezdxf and pdfplumber)");

type Reply = { ok: boolean; file: { path: string; sha256: string }; result: Record<string, any>; resolvedModel?: { part: string; file: string }; written?: string };

const capture = () => {
  const got: { data: Reply; text: string }[] = [];
  return { got, out: (data: unknown, text: () => string) => got.push({ data: data as Reply, text: text() }) };
};

describe("protoboard drawing: without the runtime", () => {
  it("says how to use it", async () => {
    await expect(drawingCommand(HERE, ["nope", "x.pdf"], capture().out)).rejects.toThrow(/usage: protoboard drawing/);
    await expect(drawingCommand(HERE, ["views"], capture().out)).rejects.toThrow(DRAWING_USAGE);
  });

  it("finds the package beside this checkout", () => {
    expect(drawingPackage(HERE)).toBe(PKG);
  });

  it("says when there is no CAD runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drawing-nopy-"));
    try {
      await expect(drawingCommand(dir, ["inspect", "x.pdf"], capture().out, { env: {} })).rejects.toThrow(/no CAD runtime/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!PY)("protoboard drawing: on the CAD runtime", () => {
  let dir = "";
  const run = async (...args: string[]) => {
    const c = capture();
    expect(await drawingCommand(dir, args, c.out)).toBe(0);
    return c.got[0];
  };

  beforeAll(() => {
    mkdirSync(join(HERE, ".tmp"), { recursive: true });
    dir = mkdtempSync(join(HERE, ".tmp", "drawing-"));
    writeFileSync(join(dir, "protoboard.config.ts"), "export default {};\n");
    execFileSync(PY!, ["-I", join(PKG, "tests", "make_fixtures.py"), join(dir, "fx"), "--models"], { stdio: "pipe", timeout: 120_000 });
    // the model table the resolver writes (W1-B): `plate` is drawn by the 2 mm too wide STEP
    mkdirSync(join(dir, ".protoboard", "build"), { recursive: true });
    writeFileSync(join(dir, ".protoboard", "build", "resolved.json"), JSON.stringify({ models: { instances: [{ instance: "plate", step: { file: "fx/plate-wrong.step" } }] } }));
  }, 180_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

  it("inspect: a vector PDF at 1:1, third angle, with its title block", async () => {
    const { data, text } = await run("inspect", "fx/plate.pdf");
    expect(data.ok).toBe(true);
    expect(data.file.path).toBe("fx/plate.pdf");
    const s = data.result.sheets[0];
    expect(s).toMatchObject({ vector: true, scale: { ratio: "1:1" }, projection: { guess: "third" } });
    expect(s.titleBlock.text).toContain("TITLE: PLATE-01");
    expect(text).toMatch(/^inspect fx\/plate\.pdf \(pdf, sha256 [0-9a-f]{12}\)/);
  }, 120_000);

  it("views: top and front on both formats", async () => {
    for (const f of ["fx/plate.pdf", "fx/plate.dxf"]) {
      const { data } = await run("views", f);
      expect(data.result.views.map((v: { role: string }) => v.role).sort()).toEqual(["front", "top"]);
    }
  }, 120_000);

  it("dimensions --part --write: the table lands in parts/evidence with provenance", async () => {
    const { data } = await run("dimensions", "fx/plate.dxf", "--part", "plate-01", "--write");
    expect(data.written).toBe("parts/evidence/plate-01/drawing-dimensions.json");
    const table = JSON.parse(readFileSync(join(dir, data.written!), "utf8"));
    expect(table.schema).toBe("protoboard.drawing-dimensions/v0");
    expect(table.dimensions.map((d: { value: number }) => d.value).sort((a: number, b: number) => a - b)).toEqual([8, 60, 100]);
    for (const d of table.dimensions) expect(d.provenance).toMatchObject({ method: "measured-from-drawing", sha256: data.file.sha256, file: "fx/plate.dxf" });
    const pdf = await run("dimensions", "fx/plate.pdf");
    expect(pdf.data.result.dimensions).toHaveLength(3);
  }, 120_000);

  it("crop: a view as PNG in the cache, with an overview", async () => {
    const { data } = await run("crop", "fx/plate.pdf", "--view", "v1", "--dpi", "100");
    expect(existsSync(join(dir, data.result.png))).toBe(true);
    expect(existsSync(join(dir, data.result.overview))).toBe(true);
    expect(data.result.partMmPerPx).toBeCloseTo(0.254, 4);
  }, 120_000);

  it("compare --part: the resolved STEP is re-projected and the wrong numbers are named", async () => {
    const { data, text } = await run("compare", "fx/plate.pdf", "--part", "plate", "--no-overlay");
    expect(data.resolvedModel).toMatchObject({ part: "plate", file: "fx/plate-wrong.step" });
    expect(data.result.verdict).toBe("disagrees");
    const wide = data.result.perDimension.find((d: { drawing: number }) => d.drawing === 100);
    expect(wide.delta).toBeCloseTo(2, 3);
    expect(text).toMatch(/verdict: disagrees/);
    const right = await run("compare", "fx/plate.dxf", "--model", "fx/plate.step", "--no-overlay");
    expect(right.data.result.verdict).toBe("agrees");
    expect(formatDrawing("compare", right.data as never)).toMatch(/delta 0 \(within\)/);
  }, 300_000);

  it("refuses a file outside the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "drawing-outside-"));
    try {
      writeFileSync(join(outside, "x.pdf"), readFileSync(join(dir, "fx", "plate.pdf")));
      await expect(drawingCommand(dir, ["inspect", join(outside, "x.pdf")], capture().out)).rejects.toThrow(/outside the project root/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, 120_000);
});

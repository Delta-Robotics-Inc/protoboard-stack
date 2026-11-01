/**
 * `protoboard geometry` (PB-1187): the exact tier from the command line,
 * through the module the CLI registers (`geometryCommand`): usage, a
 * request read from stdin, bounds and faces of a part's STEP, and the JSON
 * lines server. The worker cases need the CAD runtime (PROTOBOARD_PYTHON).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { formatMeasure, geometryCommand } from "../src/geometry.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
mkdirSync(join(HERE, ".tmp"), { recursive: true });
const TMP = mkdtempSync(join(HERE, ".tmp", "geometry-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
const SCREW = join(HERE, "..", "..", "..", "examples", "quadcopter-5in", "parts", "local", "iso-4762-m3x8", "out", "body.step");
const PYTHON = process.env.PROTOBOARD_PYTHON;

function project(): string {
  const dir = mkdtempSync(join(TMP, "p-"));
  mkdirSync(join(dir, ".protoboard", "build"), { recursive: true });
  mkdirSync(join(dir, "parts", "screw"), { recursive: true });
  writeFileSync(join(dir, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(dir, ".protoboard", "build", "resolved.json"), JSON.stringify({ models: { instances: [{ instance: "screw", step: { file: "parts/screw/body.step" } }] } }));
  if (existsSync(SCREW)) writeFileSync(join(dir, "parts", "screw", "body.step"), readFileSync(SCREW));
  return dir;
}

const capture = () => {
  const got: { data: unknown; text: string }[] = [];
  return { got, out: (data: unknown, text: () => string) => got.push({ data, text: text() }) };
};

describe("protoboard geometry", () => {
  it("says how to use it, and refuses outside a project", async () => {
    const { out } = capture();
    await expect(geometryCommand(project(), ["nope"], out)).rejects.toThrow(/usage: protoboard geometry/);
    await expect(geometryCommand(project(), ["faces"], out)).rejects.toThrow(/usage/);
    const bare = mkdtempSync(join(TMP, "bare-"));
    await expect(geometryCommand(bare, ["bounds", "x"], out)).rejects.toThrow(/not in a Protoboard project/);
  });

  it("formats a result on one line, with the tier and, for the mesh tier, its tolerance", () => {
    const line = formatMeasure({ tier: "mesh", kind: "face-face", frame: "part", method: "axis-to-axis", distance: 16.0012, angleDeg: 0, tolerance: { mm: 0.02, basis: [] } });
    expect(line).toBe("mesh face-face (axis-to-axis, part mm); distance 16.0012 mm; angle 0.0000 deg; tolerance ±0.0200 mm");
  });

  it.skipIf(!PYTHON || !existsSync(SCREW))("measures a part's STEP: bounds, faces, a request on stdin, and the JSON lines server", async () => {
    const dir = project();
    const a = capture();
    expect(await geometryCommand(dir, ["bounds", "screw"], a.out)).toBe(0);
    const b = a.got[0].data as { tier: string; size: number[] };
    expect(b.tier).toBe("exact");
    expect(b.size[2]).toBeGreaterThan(5);
    expect(a.got[0].text).toMatch(/^exact bounds \(optimal-box, part mm\); size/);
    const f = capture();
    expect(await geometryCommand(dir, ["faces", "screw", "--limit", "2"], f.out)).toBe(0);
    expect((f.got[0].data as { listed: unknown[] }).listed).toHaveLength(2);
    const m = capture();
    const req = { schema: "protoboard.geometry-request/v0", kind: "face-face", a: { part: "screw", brepFace: 0 }, b: { part: "screw", brepFace: 1 } };
    expect(await geometryCommand(dir, ["measure", "-"], m.out, { stdin: Readable.from([JSON.stringify(req)]) })).toBe(0);
    expect((m.got[0].data as { tier: string; kind: string }).kind).toBe("face-face");
    const sink = new PassThrough();
    let text = "";
    sink.on("data", (d) => (text += d));
    const lines = [JSON.stringify({ ...req, kind: "bounds", b: undefined }), "not json", JSON.stringify({ schema: "x" })].join("\n") + "\n";
    expect(await geometryCommand(dir, ["serve"], capture().out, { stdin: Readable.from([lines]), stdout: sink })).toBe(0);
    const replies = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(replies.map((r) => r.ok)).toEqual([true, false, false]);
    expect(replies[2].error).toMatch(/schema/);
  }, 120_000);
});

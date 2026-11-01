/**
 * `protoboard parts attach` (PB-1191, W4-B): drawings, datasheets and evidence
 * copied into the part's folder with their sha256 and terms; datasheets kept
 * out of git unless redistributable; evidence sessions with measured values
 * and the scale check against a registered reference tool.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sha256OfFile } from "@protoboardai/core";
import { partsAttach } from "../src/parts-attach.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/parts-attach");
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
export default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });
`;
const WIDGET = `import type { ModuleDef } from "@deltarobotics/uhd";
export const WIDGET: ModuleDef = { id: "widget", name: "Widget", kind: "module", interfaces: [] };
`;
const SYS = `import type { ModuleDef } from "@deltarobotics/uhd";
export { WIDGET } from "../parts/local/widget.uhd.ts";
export const SYS: ModuleDef = { id: "sys", name: "Sys", kind: "module", interfaces: [], children: [{ id: "w", moduleDefId: "widget" }] };
`;
const TOOL = JSON.stringify({
  schema: "protoboard.reference-tool/v0",
  id: "gauge-25",
  name: "Gauge block 25 mm",
  kind: "gauge-block",
  nominal: [{ name: "length", value: 25, unit: "mm", tolerance: { plus: 0.01, minus: 0.01 }, source: "test certificate" }],
  source: { maker: "test" },
  evidence: { layout: "parts/local/<part>/evidence/<date>-<tool>/", photos: true },
});
const base = () => project({ "protoboard.config.ts": CONFIG, "src/sys.uhd.ts": SYS, "parts/local/widget.uhd.ts": WIDGET, "parts/reference-tools/gauge-25.json": TOOL });
const file = (name: string, content: string | Buffer) => {
  const f = join(TMP, "inbox", `${n}-${name}`);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, content);
  return f;
};

const run = async (dir: string, rest: string[], flags: Record<string, unknown>) => {
  let data: Record<string, unknown> = {};
  let text = "";
  const code = await partsAttach(dir, rest, flags, (d, t) => {
    data = d as Record<string, unknown>;
    text = t();
  });
  return { code, data, text };
};
const list = (dir: string) => JSON.parse(readFileSync(join(dir, "parts/local/widget/attachments.json"), "utf8"));

describe("parts attach", () => {
  it("copies a drawing into the part's folder and lists it with its sha256 and terms", async () => {
    const dir = base();
    // spaces, brackets and a trailing dot in the stem: the copy gets a name that is safe everywhere
    const src = file("Widget drawing (rev A) [final]..pdf", "%PDF-1.7 drawing");
    const r = await run(dir, ["widget", src], { kind: "drawing", license: "CC-BY-4.0", url: "https://example.com/widget.pdf", terms: "redistributable" });
    expect(r.code).toBe(0);
    const l = list(dir);
    expect(l.schema).toBe("protoboard.part-attachments/v0");
    expect(l.files).toHaveLength(1);
    const e = l.files[0];
    expect(e.file).toMatch(/^parts\/local\/widget\/drawings\/\d+-Widget-drawing-\(rev-A\)-\[final\]\.pdf$/);
    expect(e).toMatchObject({ kind: "drawing", sha256: sha256OfFile(src), bytes: 16, url: "https://example.com/widget.pdf", terms: { distribution: "redistributable", license: "CC-BY-4.0" } });
    // attaching the same file again changes nothing but the date
    await run(dir, ["widget", src], { kind: "drawing", terms: "redistributable" });
    expect(list(dir).files).toHaveLength(1);
  });

  it("keeps a datasheet out of git unless its terms allow it", async () => {
    const dir = base();
    await run(dir, ["widget", file("ds.pdf", "%PDF datasheet")], { kind: "datasheet" });
    expect(readFileSync(join(dir, "parts/local/widget/datasheets/.gitignore"), "utf8")).toMatch(/^\*$/m);
    expect(list(dir).files[0].terms.distribution).toBe("unknown");
    const dir2 = base();
    await run(dir2, ["widget", file("ds.pdf", "%PDF datasheet")], { kind: "datasheet", terms: "redistributable" });
    expect(existsSync(join(dir2, "parts/local/widget/datasheets/.gitignore"))).toBe(false);
  });

  it("records evidence against a reference tool: the photo, the values, the scale check", async () => {
    const dir = base();
    const photo = file("caliper.jpg", "jpeg");
    const r = await run(dir, ["widget", photo], { kind: "evidence", tool: "gauge-25", measure: ["ref:length=25.004mm", "slot=6.10mm+-0.02"], date: "2026-11-01" });
    expect(r.code).toBe(0);
    const ev = JSON.parse(readFileSync(join(dir, "parts/local/widget/evidence/2026-11-01-gauge-25/evidence.json"), "utf8"));
    expect(ev.files[0].file).toBe(`parts/local/widget/evidence/2026-11-01-gauge-25/${n}-caliper.jpg`);
    expect(ev.measurements.map((m: { name: string; provenance: { method: string } }) => [m.name, m.provenance.method])).toEqual([
      ["length", "measured-from-reference-tool"],
      ["slot", "measured-from-reference-tool"],
    ]);
    expect(ev.scale).toMatchObject({ reference: "length", withinTolerance: true });
    expect(list(dir).files[0]).toMatchObject({ kind: "evidence", evidence: "parts/local/widget/evidence/2026-11-01-gauge-25" });
    // without a tool: a "manual" session, no scale check
    await run(dir, ["widget", file("photo2.png", "png")], { kind: "evidence", date: "2026-11-01" });
    expect(existsSync(join(dir, "parts/local/widget/evidence/2026-11-01-manual/evidence.json"))).toBe(true);
  });

  it("refuses runnable files, oversized files, unknown kinds and terms, and measures outside evidence", async () => {
    const dir = base();
    await expect(run(dir, ["widget", file("setup.exe", "MZ")], { kind: "drawing" })).rejects.toThrow(/files that can run/);
    // wave 4 gate: a .uhd.ts under parts/local/<id>/ would be loaded by the next check (default source glob)
    await expect(run(dir, ["widget", file("notes.uhd.ts", "export const X = 1;")], { kind: "drawing" })).rejects.toThrow(/files that can run \(\.ts\)/);
    await expect(run(dir, ["widget", file("a.pdf", "x")], { kind: "photo" })).rejects.toThrow(/--kind is one of evidence, drawing, datasheet/);
    await expect(run(dir, ["widget", file("a.pdf", "x")], { kind: "drawing", terms: "free" })).rejects.toThrow(/--terms is one of/);
    await expect(run(dir, ["widget", file("a.pdf", "x")], { kind: "drawing", measure: ["a=1mm"] })).rejects.toThrow(/go with --kind evidence/);
    await expect(run(dir, ["nope", file("a.pdf", "x")], { kind: "drawing" })).rejects.toThrow(/no definition "nope"/);
    process.env.PROTOBOARD_MAX_ATTACH_BYTES = "4";
    try {
      await expect(run(dir, ["widget", file("big.pdf", "123456")], { kind: "drawing" })).rejects.toThrow(/over the 4-byte limit/);
    } finally {
      delete process.env.PROTOBOARD_MAX_ATTACH_BYTES;
    }
    expect(existsSync(join(dir, "parts/local/widget/attachments.json"))).toBe(false);
  });
});

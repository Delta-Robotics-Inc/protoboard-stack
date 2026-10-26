/**
 * ext-enclosure-cad's Manufacturing Package contributions, on a printed case
 * whose build report is written by the test (no Python): the print order in
 * the work order (profile, each part's orientation and supports,
 * post-processing) and the enclosure's checks in the test plan (seal
 * squeeze against the gland table, buttons, the plug, the lid joint, a tight
 * fit).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import type { SectionContribution } from "@protoboardai/ext-release";
import { testContexts, type TestContexts } from "@protoboardai/ext-release/testing";
import { testPlan, workOrder } from "../ops/package.ts";

// its own folder: the other test files clear .tmp/<theirs> when they finish
const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp", "package");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const mech = (id: string, normal: number[]) => ({ id, name: id, domain: "mechanical", exposed: true, protocols: [{ type: "mechanical", roles: ["mount"] }], geometry: { frame: { origin: [0, 0, 0], normal } } });
const CASE = { id: "fixture-case", name: "Fixture case", interfaces: ["usb", "slot", "btn", "seal", "bosses", "lid_joint"].map((id) => mech(id, [1, 0, 0])) };
const SYSTEM = { id: "device", name: "Device", interfaces: [], children: [{ id: "case", moduleDefId: "fixture-case" }] };
const feature = (kind: string, parts: string[], normal: number[], extra: Record<string, unknown> = {}) => ({ kind, parts, frame: { origin: [0, 0, 5], normal }, ...extra });
const REPORT = {
  schema: "protoboard.enclosure-cad.report/v0",
  module: "fixture-case",
  overall: { min: [-20, -15, 0], max: [20, 15, 12.5] },
  parts: { base: { volume_mm3: 5200, printed: true }, lid: { volume_mm3: 2100, printed: true }, plunger_btn: { volume_mm3: 30, printed: true } },
  features: {
    usb: feature("opening", ["base"], [1, 0, 0], { size_mm: [9.6, 3.9], plug: { name: "USB Type-C plug", passes: true, plug_mm: [8.25, 2.4] } }),
    slot: feature("opening", ["base"], [0, 1, 0], { size_mm: [14, 3] }),
    btn: feature("button", ["base"], [0, -1, 0], { hole_d_mm: 2.5, gap_mm: 0.2 }),
    seal: feature("seal_gland", ["base"], [0, 0, 1], { type: "face", oring: "AS568-024", w_mm: 1.78, gland_depth_mm: 1.3, gap_mm: 0 }),
    bosses: feature("boss", ["base"], [0, 0, 1], { holes: [[0, 0], [1, 0], [0, 1], [1, 1]], insert: { name: "ruthex RX-M2x4" } }),
    lid_joint: feature("joint", ["base"], [0, 0, 1], { columns: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], screw: { name: "M2 × 6 pan head screw" }, insert: { name: "ruthex RX-M2x4" } }),
  },
  walls: [],
  problems: [],
  fit: { resolution_mm: 0.25, bodies: [{ key: "cell", label: "Pouch cell", status: "tight", min_clearance_mm: 0.12, near: "lid" }, { key: "board", label: "Board", status: "clear", min_clearance_mm: 0.4 }], walls: {} },
};

let t: TestContexts;
beforeAll(async () => {
  const dir = join(TMP, "device");
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, s: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), s);
  };
  write("package.json", JSON.stringify({ name: "device", type: "module" }));
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "device", root: { source: "src/device.uhd.ts", export: "DEVICE" } });\n`);
  write("src/device.uhd.ts", `export const DEVICE = ${JSON.stringify(SYSTEM)};\nexport const CASE = ${JSON.stringify(CASE)};\n`);
  write("src/enclosures/case/cad.config.ts", `import { defineCapabilityConfig } from "@protoboardai/core";\nexport default defineCapabilityConfig({ provider: "@protoboardai/ext-enclosure-cad", module: "fixture-case", process: "print", constraints: { wall_mm: 1.7, material: "PETG" } });\n`);
  write("src/enclosures/case/build123d/fixture-case.report.json", JSON.stringify(REPORT));
  const p = await loadProject(dir, { checks: false });
  expect(p.capabilities.map((b) => [b.module, b.problem])).toEqual([["fixture-case", undefined]]);
  t = testContexts(p, {}, "1.0.0");
});

const one = (x: SectionContribution | SectionContribution[] | undefined) => (Array.isArray(x) ? x[0] : x)!;

describe("package:work-order", () => {
  it("orders the print: material, profile, each part's orientation and supports, inserts set; O-ring, plunger and lid screws left to assembly", async () => {
    const c = one(await workOrder(t.context("system", "work-order")));
    expect(c).toMatchObject({ title: "Printed parts", order: 30 });
    const kv = c.blocks.find((b) => b.kind === "keyvalues");
    const rows = Object.fromEntries((kv?.kind === "keyvalues" ? kv.rows : []).map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Process: "FDM printing", Material: "PETG", Profile: "0.4 mm nozzle, 0.2 mm layers, 4 perimeters (walls 1.7 mm), solid infill", Quantity: "1 set of 3 parts", Overall: "40 × 30 × 12.5 mm" });
    const parts = c.blocks.find((b) => b.kind === "table");
    expect(parts?.kind === "table" && parts.rows).toEqual([
      { part: "base", vol: "5.2 cm³", orient: "floor on the bed, open side up", sup: "under slot (wider than 10 mm)", file: "files/mechanical/fixture-case/base.3mf" },
      { part: "lid", vol: "2.1 cm³", orient: "outer face on the bed", sup: "none", file: "files/mechanical/fixture-case/lid.3mf" },
      { part: "plunger_btn", vol: "0.03 cm³", orient: "flange on the bed", sup: "none", file: "files/mechanical/fixture-case/plunger_btn.3mf" },
    ]);
    const post = c.blocks.find((b) => b.kind === "list");
    expect(post?.kind === "list" && post.items).toEqual([
      "Remove brim and any supports; deburr every opening and bore.",
      "Set 8 heat-set inserts (ruthex RX-M2x4) with a soldering iron and insert tip at the material's insert temperature; each flush and square.",
      "Keep the parts open and unassembled: the O-ring (AS568-024), the button plunger, the lid and its 4 × M2 × 6 pan head screw are fitted during assembly, once what the enclosure holds is inside (the assembly operations).",
    ]);
  });
});

describe("package:test-plan", () => {
  it("checks the seal squeeze against the gland table, the button, the plug, the lid joint and the tight fit", async () => {
    const c = one(await testPlan(t.context("system", "test-plan")));
    const table = c.blocks.find((b) => b.kind === "table");
    const rows = (table?.kind === "table" ? table.rows : []) as Record<string, string>[];
    expect(rows.map((r) => r.check)).toEqual(["Opening usb: Fixture case", "Button btn: Fixture case", "Seal seal: Fixture case", "Lid joint: Fixture case", "Fit of Pouch cell: Fixture case"]);
    expect(rows[2].pass).toMatch(/^O-ring seated all round, not pinched; design squeeze 27 % \(\d+–\d+ %, Parker/);
    expect(rows[4].pass).toBe("no contact near lid (the design leaves 0.12 mm here)");
  });
});

describe("an enclosure built as its own unit", () => {
  it("ends the print order at the bare housing and leaves the assembled checks to the unit it goes into", async () => {
    const u = testContexts(t.context("system", "work-order").project, { units: ["case"] }, "1.0.0");
    const wo = one(await workOrder(u.context("case", "work-order")));
    const post = wo.blocks.find((b) => b.kind === "list");
    expect(post?.kind === "list" && post.items.at(-1)).toMatch(/fitted at assembly in final assembly \(system\/\)\.$/);
    // the bare housing: only the plug through its opening
    const own = one(await testPlan(u.context("case", "test-plan")));
    const ownRows = (own.blocks.find((b) => b.kind === "table") as { rows: Record<string, string>[] }).rows;
    expect(ownRows.map((r) => r.check)).toEqual(["Opening usb: Fixture case"]);
    // the system, where it is assembled: the seal, the button, the lid joint and the fit
    const sys = one(await testPlan(u.context("system", "test-plan")));
    const sysRows = (sys.blocks.find((b) => b.kind === "table") as { rows: Record<string, string>[] }).rows;
    expect(sysRows.map((r) => r.check)).toEqual(["Button btn: Fixture case", "Seal seal: Fixture case", "Lid joint: Fixture case", "Fit of Pouch cell: Fixture case"]);
  });
});

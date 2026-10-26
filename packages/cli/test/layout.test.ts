/**
 * `protoboard layout` (PB-1007): the diagram's layout measured headless,
 * written to the display file when asked, and reported by `check`. On a copy
 * of the UNO motor bench (three modules, no saved layout).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { formatLayout, layoutDiagnostics, runLayout } from "../src/layout.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-layout");
const EXAMPLE = join(HERE, "../../../examples/uno-motor-bench");
const dir = join(TMP, "bench");
const displayFile = join(dir, ".protoboard/display.json");

/** A saved top level with every card on one spot, and something else in the file to keep. */
const piled = {
  schema: "uhd.display/v0",
  diagram: { layouts: { "": { nodes: { uno: { x: 100, y: 100 }, shield: { x: 120, y: 110 }, tof: { x: 140, y: 120 } } } } },
  spatial: { root: "uno" },
};

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  cpSync(EXAMPLE, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.protoboard[\\/](build|cache|tools))([\\/]|$)/.test(src) });
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const load = () => loadProject(dir, { checks: false });

describe("protoboard layout", () => {
  it("reports a level with no saved layout as the viewer draws it, and writes nothing", async () => {
    rmSync(displayFile, { force: true });
    const r = await runLayout(await load());
    expect(r.levels.map((l) => l.level)).toEqual([""]);
    const top = r.levels[0];
    expect(top.saved).toBe(false);
    expect(top.metrics.cards).toBe(3);
    expect(top.metrics.overlaps).toBe(0);
    expect(top.metrics.crossings).toBe(0);
    expect(top.findings.filter((f) => f.severity === "warning")).toEqual([]);
    expect(r.warnings).toBe(0);
    // --apply on an automatic level: the viewer draws that already; saved only with --force
    const applied = await runLayout(await load(), { apply: "default" });
    expect(applied.written).toEqual([]);
    expect(existsSync(displayFile)).toBe(false);
    expect(formatLayout(applied)).toMatch(/no saved layout/);
  });

  it("finds a pile of cards, fixes it with --apply, keeps the rest of the file, and is deterministic", async () => {
    mkdirSync(join(dir, ".protoboard"), { recursive: true });
    writeFileSync(displayFile, JSON.stringify(piled, null, 2) + "\n");
    const before = await runLayout(await load());
    expect(before.levels[0].saved).toBe(true);
    expect(before.levels[0].metrics.overlaps).toBeGreaterThan(0);
    expect(before.levels[0].findings.map((f) => f.code)).toContain("overlaps");
    expect(before.warnings).toBe(1);
    expect(formatLayout(before)).toMatch(/pairs? of boxes overlap/);

    const r = await runLayout(await load(), { apply: "default" });
    expect(r.written).toEqual([""]);
    expect(r.levels[0].proposed!.metrics.overlaps).toBe(0);
    expect(r.warnings).toBe(0);
    const text = readFileSync(displayFile, "utf8");
    const saved = JSON.parse(text);
    expect(saved.spatial).toEqual({ root: "uno" });
    expect(Object.keys(saved.diagram.layouts[""].nodes).sort()).toEqual(["shield", "tof", "uno"]);
    // measured again from the file: what was proposed
    const after = await runLayout(await load());
    expect(after.levels[0].metrics.overlaps).toBe(0);
    expect(after.levels[0].metrics.crossings).toBe(r.levels[0].proposed!.metrics.crossings);
    // the same model and file give the same layout
    writeFileSync(displayFile, JSON.stringify(piled, null, 2) + "\n");
    await runLayout(await load(), { apply: "default" });
    expect(readFileSync(displayFile, "utf8")).toBe(text);
  });

  it("keeps pinned cards where they are, and remembers them", async () => {
    writeFileSync(displayFile, JSON.stringify(piled, null, 2) + "\n");
    const r = await runLayout(await load(), { apply: "tidy", pin: ["uno"] });
    expect(r.written).toEqual([""]);
    const saved = JSON.parse(readFileSync(displayFile, "utf8"));
    expect(saved.diagram.layouts[""].nodes.uno).toEqual({ x: 100, y: 100 });
    expect(saved.diagram.layouts[""].pinned).toEqual(["uno"]);
    expect(r.levels[0].proposed!.metrics.overlaps).toBe(0);
    // a later run keeps it pinned without being told
    const again = await runLayout(await load(), { apply: "default", force: true });
    expect(again.levels[0].proposed!.pinned).toEqual(["uno"]);
    expect(JSON.parse(readFileSync(displayFile, "utf8")).diagram.layouts[""].nodes.uno).toEqual({ x: 100, y: 100 });
  });

  it("refuses a level that is not there, naming the ones that are", async () => {
    await expect(runLayout(await load(), { level: "nope" })).rejects.toThrow(/no level "nope"; the levels are "" \(the top\)/);
  });

  it("gives check an info finding for a level of modules that is hard to read", async () => {
    writeFileSync(displayFile, JSON.stringify(piled, null, 2) + "\n");
    const found = await layoutDiagnostics(await load());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "PB_DIAGRAM_LAYOUT", severity: "info", validator: "protoboard/layout" });
    expect(found[0].message).toMatch(/protoboard layout/);
    rmSync(displayFile);
    expect(await layoutDiagnostics(await load())).toEqual([]);
  });
});

/**
 * The PCB regression set (test/pcb-regression, run by `npm run
 * test:pcb-regression`): its comparison rules, and the tracked board's
 * numbers read from the file against its baseline. No KiCad needed; the
 * KiCad half (DRC, stats, golden images) runs in the runner only.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareNumbers, differencesTable, FAILING, type Baseline } from "./pcb-regression/compare.ts";
import { arcBoundPoints, drcCounts, fileMetrics, normalizeSvg, type Measurement } from "./pcb-regression/measure.ts";
import { FIXTURES, resolveBoards } from "./pcb-regression/run.ts";

const baseline = (): Baseline => JSON.parse(readFileSync(join(FIXTURES, "baselines", "airnode-c3", "baseline.json"), "utf8")) as Baseline;
const measured = (b: Baseline, edit: (m: Measurement) => void = () => {}): Measurement => {
  const m: Measurement = structuredClone({ board: b.board, pcbSha256: b.pcbSha256, file: b.file, kicad: b.kicad, seconds: 0 });
  edit(m);
  return m;
};

describe("PCB regression set", () => {
  it("reads the tracked board's numbers as its baseline recorded them", () => {
    const b = baseline();
    const m = fileMetrics(readFileSync(join(FIXTURES, "airnode-c3", "airnode-c3.kicad_pcb"), "utf8"));
    expect(m).toEqual(b.file);
    expect(m).toMatchObject({ copperLayers: 2, footprints: 20, boardWidthMm: 40, boardHeightMm: 30 });
  });

  it("lists the tracked board, adds the local manifest's boards and skips a local one it cannot find, with the reason", () => {
    const prev = process.env.PB_PCB_REGRESSION_LOCAL;
    const local = mkdtempSync(join(tmpdir(), "pcb-regression-local-"));
    try {
      process.env.PB_PCB_REGRESSION_LOCAL = join(local, "no-such-folder");
      const none = resolveBoards();
      expect(none.boards.map((b) => b.id)).toEqual(["airnode-c3"]);
      expect(none.skipped).toEqual([]);

      mkdirSync(join(local, "boards", "sample-a"), { recursive: true });
      writeFileSync(join(local, "boards", "sample-a", "a.kicad_pcb"), "(kicad_pcb)");
      writeFileSync(join(local, "manifest.json"), JSON.stringify({ boards: { "sample-a": { root: "boards/sample-a", pcb: "a.kicad_pcb", name: "Sample A" }, "sample-b": { root: "boards/sample-b", pcb: "b.kicad_pcb" } } }));
      process.env.PB_PCB_REGRESSION_LOCAL = local;
      const { boards, skipped } = resolveBoards();
      expect(boards.map((b) => [b.id, b.tracked])).toEqual([["airnode-c3", true], ["sample-a", false]]);
      expect(boards[1].baselineDir).toBe(join(local, "baselines", "sample-a"));
      expect(skipped.map((s) => s.id)).toEqual(["sample-b"]);
      expect(skipped[0].reason).toMatch(/board file not found/);
    } finally {
      if (prev === undefined) delete process.env.PB_PCB_REGRESSION_LOCAL;
      else process.env.PB_PCB_REGRESSION_LOCAL = prev;
      rmSync(local, { recursive: true, force: true });
    }
  });

  it("passes an unchanged board, fails a structural change or more findings, and lets findings go down", () => {
    const b = baseline();
    expect(compareNumbers(b, measured(b)).filter((r) => r.status !== "same")).toEqual([]);

    const moreVias = compareNumbers(b, measured(b, (m) => (m.file.vias += 1)));
    expect(moreVias.find((r) => r.metric === "vias")?.status).toBe("changed");

    if (!b.kicad) return;
    const worse = compareNumbers(b, measured(b, (m) => (m.kicad!.drc.unconnected += 2)));
    expect(worse.find((r) => r.metric === "DRC unconnected")?.status).toBe("regressed");
    expect(worse.some((r) => FAILING.has(r.status))).toBe(true);
    expect(differencesTable(worse)).toMatch(/DRC unconnected\s+75\s+77\s+REGRESSED/);

    const better = compareNumbers(b, measured(b, (m) => (m.kicad!.drc.warnings -= 1)));
    expect(better.find((r) => r.metric === "DRC warnings")?.status).toBe("improved");
    expect(better.some((r) => FAILING.has(r.status))).toBe(false);
  });

  it("counts DRC findings by severity and type", () => {
    const c = drcCounts({ violations: [{ severity: "error", type: "clearance", description: "" }, { severity: "warning", type: "silk_overlap", description: "" }, { severity: "error", type: "clearance", description: "" }], unconnected_items: [1, 2], schematic_parity: [] });
    expect(c).toEqual({ errors: 2, warnings: 1, unconnected: 2, parity: 0, byType: { "error clearance": 2, "warning silk_overlap": 1 } });
  });

  it("bounds an arc by the extremes it sweeps, and ignores the SVG export date", () => {
    // a half circle of radius 1 through the top: x from -1 to 1, y up to 1
    const pts = arcBoundPoints([1, 0], [0, 1], [-1, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(1);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0);
    expect(normalizeSvg("<svg><title>SVG Image created as a.svg date 2026-11-09T01:27:59 </title></svg>")).toBe(normalizeSvg("<svg><title>other date</title></svg>"));
  });
});

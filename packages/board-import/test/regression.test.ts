/**
 * The PCB regression set through the importers. The tracked sample (Airnode C3) is imported from both its KiCad
 * board and its Circuit JSON and checked against its tracked baseline. Local boards (Git-ignored, listed only in
 * the local manifest) are imported when present and checked against their recorded KiCad baselines; without the
 * manifest, or without a board's file, that board is skipped. Local boards are named here only by letter.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importBoard, type BoardImportResult } from "../src/index.js";
import { head, isList, kids, parseSexpr } from "../src/sexpr.js";
import { kicadWorldPads, padWorldError, saveAndReload } from "./helpers.js";

const REG = fileURLToPath(new URL("../../ext-tscircuit/test/fixtures/pcb-regression/", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(REG, "local");

interface Baseline {
  file: { footprints: number; tracks: number; vias: number; zones: number; nets: number };
  kicad?: { stats?: { smdPads: number; thPads: number; npthPads: number } };
}
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** Zones written inside footprints (the baseline counts top-level zones only). */
const footprintZones = (text: string) => kids(parseSexpr(text), "footprint").reduce((s, f) => s + f.filter((x) => isList(x) && head(x) === "zone").length, 0);

describe("regression set: Airnode C3 (tracked)", () => {
  const base = readJson<Baseline>(join(REG, "baselines", "airnode-c3", "baseline.json"));
  const pads = base.kicad!.stats!.smdPads + base.kicad!.stats!.thPads + base.kicad!.stats!.npthPads;
  const check = (r: BoardImportResult) => {
    expect(r.stats.footprints).toBe(base.file.footprints);
    expect(r.stats.pads).toBe(pads);
    expect(r.stats.nets).toBe(base.file.nets);
    expect(r.stats.tracks).toBe(base.file.tracks);
    expect(r.stats.vias).toBe(base.file.vias);
    expect(saveAndReload(r).equal).toBe(true);
  };
  it("its KiCad board matches the baseline's footprints, pads and nets", async () => {
    const path = join(REG, "airnode-c3", "airnode-c3.kicad_pcb");
    const r = await importBoard({ path });
    check(r);
    const e = padWorldError(r.document, r.offset, kicadWorldPads(readFileSync(path, "utf8")));
    expect(e.checked).toBe(pads);
    expect(e.maxNm).toBeLessThanOrEqual(1);
    expect(e.angleMismatches).toBe(0);
  });
  it("its Circuit JSON matches the same baseline", async () => {
    const r = await importBoard({ path: join(REG, "airnode-c3", "airnode-c3.circuit.json") });
    check(r);
  });
  it("both sources give the same nets and pins", async () => {
    const a = await importBoard({ path: join(REG, "airnode-c3", "airnode-c3.kicad_pcb") });
    const b = await importBoard({ path: join(REG, "airnode-c3", "airnode-c3.circuit.json") });
    expect(b.netlist.nets.map((n) => [n.name, n.pins])).toEqual(a.netlist.nets.map((n) => [n.name, n.pins]));
  });
});

// ---------------------------------------------------------------- local boards (Git-ignored)
const manifestPath = join(LOCAL, "manifest.json");
const manifest = existsSync(manifestPath) ? readJson<{ boards: Record<string, { root: string; pcb: string }> }>(manifestPath) : undefined;
const local = Object.entries(manifest?.boards ?? {}).map(([id, b], i) => {
  const root = isAbsolute(b.root) ? b.root : join(LOCAL, b.root);
  return { id, label: `board ${String.fromCharCode(65 + i)}`, pcb: join(root, b.pcb), baseline: join(LOCAL, "baselines", id, "baseline.json") };
});

describe.skipIf(!manifest)("regression set: local boards (Git-ignored manifest)", () => {
  for (const b of local) {
    const present = existsSync(b.pcb) && existsSync(b.baseline);
    it.skipIf(!present)(`${b.label}: footprint, track, via, zone and net counts equal the KiCad baseline`, async () => {
      const text = readFileSync(b.pcb, "utf8");
      const base = readJson<Baseline>(b.baseline).file;
      const t0 = performance.now();
      const r = await importBoard({ path: b.pcb, name: b.label });
      const ms = performance.now() - t0;
      const topZones = r.stats.zones + r.stats.keepouts - footprintZones(text);
      const pads = padWorldError(r.document, r.offset, kicadWorldPads(text));
      const reload = saveAndReload(r);
      const got = { footprints: r.stats.footprints, tracks: r.stats.tracks, vias: r.stats.vias, zones: topZones, nets: r.stats.nets };
      const want = { footprints: base.footprints, tracks: base.tracks, vias: base.vias, zones: base.zones, nets: base.nets };
      console.log(
        `[board-import] ${b.label}: ${JSON.stringify({ got, want, ms: Math.round(ms), pads: r.stats.pads, padWorldMaxNm: pads.maxNm, padAngleMismatches: pads.angleMismatches, reloadEqual: reload.equal, fillPolygons: r.stats.fillPolygons, rules: r.stats.rules, netclasses: r.stats.netclasses, dropped: Object.values(r.summary.dropped).reduce((s, n) => s + n, 0), approximated: Object.values(r.summary.approximated).reduce((s, n) => s + n, 0) })}`,
      );
      expect(got).toEqual(want);
      expect(pads.maxNm).toBeLessThanOrEqual(1);
      expect(pads.angleMismatches).toBe(0);
      expect(reload.equal).toBe(true);
    });
  }
});

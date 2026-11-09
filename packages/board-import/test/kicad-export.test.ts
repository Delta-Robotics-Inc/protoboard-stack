/**
 * The KiCad exporter by round trip: import a KiCad board, export it (`.kicad_pcb`, `.kicad_pro`, `.kicad_dru`),
 * import the export, and compare the two documents record by record. Every difference must be one of the explained
 * ones (each is also in the exporter's or the importer's report); anything else fails the test with the record.
 * Runs on the tracked Airnode C3 sample and the hand-written sample, and on the local boards of the Git-ignored
 * regression manifest when it is present (named here only by letter). With kicad-cli installed, KiCad's DRC on the
 * export of the tracked sample gives the same counts as on the source.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalRecord, recordsOfKind, withChanges, type BoardDocument, type BoardRecord, type FootprintRec, type Point, type RuleRec } from "@protoboardai/board";
import { findKicadCli, runKicadDrc } from "@protoboardai/board-checks";
import { exportKicadBoard, fracture, importBoard, mmExact, parseSexpr, unfracture, type BoardImportResult } from "../src/index.js";

const REG = fileURLToPath(new URL("../../ext-tscircuit/test/fixtures/pcb-regression/", import.meta.url));
const AIRNODE = join(REG, "airnode-c3", "airnode-c3.kicad_pcb");
const SAMPLE = fileURLToPath(new URL("./fixtures/sample/sample.kicad_pcb", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(REG, "local");

interface RoundTrip {
  a: BoardImportResult;
  b: BoardImportResult;
  dir: string;
  ex: ReturnType<typeof exportKicadBoard>;
}

/** Import, export beside a temporary folder, import the export. */
async function roundTrip(path: string, keep = false): Promise<RoundTrip> {
  const a = await importBoard({ path, name: "board" });
  const ex = exportKicadBoard(a.document, { offset: a.offset, fills: a.fill, name: "board", ...(a.rulesNotEvaluated?.length ? { notEvaluated: a.rulesNotEvaluated } : {}), ...(a.sharedSourceIds?.length ? { sharedIds: a.sharedSourceIds } : {}) });
  const dir = mkdtempSync(join(tmpdir(), "pb-kicad-export-"));
  writeFileSync(join(dir, "board.kicad_pcb"), ex.pcb);
  writeFileSync(join(dir, "board.kicad_pro"), ex.pro);
  writeFileSync(join(dir, "board.kicad_dru"), ex.dru ?? "(version 1)\n");
  const b = await importBoard({ path: join(dir, "board.kicad_pcb"), name: "board" });
  if (!keep) rmSync(dir, { recursive: true, force: true });
  return { a, b, dir, ex };
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
/** Whether two vertex lists are the same ring started at another vertex. */
function sameRing(x: readonly Point[], y: readonly Point[]): boolean {
  if (x.length !== y.length) return false;
  const k = y.findIndex((p) => same(p, x[0]));
  return k >= 0 && x.every((p, i) => same(p, y[(i + k) % y.length]));
}
/** A rule without what its place in the custom rules file gives it (its id's position and its priority). */
const ruleShape = (r: RuleRec) => {
  const { id, priority, ...rest } = r;
  return JSON.stringify(canonicalRecord({ ...rest, id: id.replace(/^rule:kicad\.dru\.\d+\./, "rule:kicad.dru.#."), priority: priority !== undefined && priority > 1000 ? "custom" : priority } as unknown as BoardRecord));
};

/**
 * The differences between two documents, sorted into the explained ones (with why) and the rest:
 * - a polygon pad's ring starts at another vertex (the importer unites a KiCad custom pad's anchor and primitives,
 *   and the union starts the ring where it likes) or has its arcs in straight steps (the importer tessellates the
 *   curves of a custom pad's primitives; KiCad keeps them as arcs);
 * - custom rules renumbered because a source rule the import could not express is not in the export.
 */
function compareDocs(a: BoardDocument, b: BoardDocument): { explained: Record<string, number>; unexplained: string[] } {
  const explained: Record<string, number> = {};
  const unexplained: string[] = [];
  const explain = (why: string) => (explained[why] = (explained[why] ?? 0) + 1);
  const ruleA = new Map<string, RuleRec>();
  const ruleB = new Map<string, RuleRec>();
  for (const [id, r] of a.records) {
    const s = b.records.get(id);
    if (!s) {
      if (r.kind === "rule") ruleA.set(ruleShape(r), r);
      else unexplained.push(`only in the original: ${id}`);
      continue;
    }
    if (same(canonicalRecord(r), canonicalRecord(s))) continue;
    if (r.kind === "footprint" && s.kind === "footprint") {
      const { pads: pa, ...ra } = r as FootprintRec;
      const { pads: pb, ...rb } = s as FootprintRec;
      if (!same(canonicalRecord(ra as unknown as BoardRecord), canonicalRecord(rb as unknown as BoardRecord)) || pa.length !== pb.length) {
        unexplained.push(`footprint ${id} differs outside its pads`);
        continue;
      }
      pa.forEach((p, i) => {
        const q = pb[i];
        if (same(p, q)) return;
        const { points: xa, ...restA } = p;
        const { points: xb, ...restB } = q;
        if (p.shape === "polygon" && q.shape === "polygon" && same(restA, restB) && xa && xb) {
          if (sameRing(xa, xb)) return explain("polygon pad ring starts at another vertex");
          if (xa.some((v) => v.sweep !== undefined)) return explain("polygon pad arcs read back in straight steps");
        }
        unexplained.push(`pad ${i} of ${id}: ${JSON.stringify(p).slice(0, 200)} -> ${JSON.stringify(q).slice(0, 200)}`);
      });
      continue;
    }
    unexplained.push(`${id} changed: ${JSON.stringify(canonicalRecord(r)).slice(0, 200)} -> ${JSON.stringify(canonicalRecord(s)).slice(0, 200)}`);
  }
  for (const [id, r] of b.records) {
    if (a.records.has(id)) continue;
    if (r.kind === "rule") ruleB.set(ruleShape(r), r);
    else unexplained.push(`only in the export: ${id}`);
  }
  for (const [k, r] of ruleA) {
    if (ruleB.has(k)) {
      explain("custom rule renumbered");
      ruleB.delete(k);
    } else unexplained.push(`rule only in the original: ${r.id}`);
  }
  for (const r of ruleB.values()) unexplained.push(`rule only in the export: ${r.id}`);
  if (!same(a.netlist, b.netlist)) unexplained.push("the netlists differ");
  return { explained, unexplained };
}

const fillPolygons = (r: BoardImportResult) => r.fill.fills.reduce((n, f) => n + f.polygons.length, 0);
const fillHoles = (r: BoardImportResult) => r.fill.fills.reduce((n, f) => n + f.polygons.reduce((m, p) => m + p.holes.length, 0), 0);

describe("KiCad export: numbers and fill", () => {
  it("writes nanometers as exact millimeters", () => {
    expect(mmExact(0)).toBe("0");
    expect(mmExact(1_600_000)).toBe("1.6");
    expect(mmExact(-12_345_678)).toBe("-12.345678");
    expect(mmExact(1)).toBe("0.000001");
    expect(mmExact(-500)).toBe("-0.0005");
  });

  it("joins a fill polygon's holes to its outline by bridges that read back as the same holes", () => {
    const square = (x: number, y: number, s: number, ccw: boolean): Point[] => {
      const r = [
        { x, y },
        { x: x + s, y },
        { x: x + s, y: y + s },
        { x, y: y + s },
      ];
      return ccw ? r : r.reverse();
    };
    const outer = square(0, 0, 100, true);
    const holes = [square(60, 20, 20, false), square(10, 10, 20, false), square(20, 60, 20, false)];
    const fr = fracture(outer, holes);
    expect(fr.unbridged).toBe(0);
    const back = unfracture(fr.ring);
    expect(back.holes.length).toBe(3);
    const ring = (a: number[]) => {
      const pts: Point[] = [];
      for (let i = 0; i < a.length; i += 2) pts.push({ x: a[i], y: a[i + 1] });
      return pts;
    };
    // the outline keeps the points where the bridges landed (on its edges): the same area, every corner still there
    const area = (r: Point[]) => r.reduce((t, p, i) => t + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2;
    expect(area(ring(back.outer))).toBe(area(outer));
    for (const c of outer) expect(ring(back.outer).some((q) => same(q, c))).toBe(true);
    // each hole comes back (one that took another hole's bridge keeps that landing point too)
    for (const h of holes) expect(back.holes.some((x) => area(ring(x)) === area(h) && h.every((c) => ring(x).some((q) => same(q, c))))).toBe(true);
  });
});

describe("KiCad export: round trip on the tracked boards", () => {
  it("the Airnode C3 sample comes back record by record (only explained differences)", async () => {
    const { a, b, ex } = await roundTrip(AIRNODE);
    expect(b.document.records.size).toBe(a.document.records.size);
    const d = compareDocs(a.document, b.document);
    expect(d.unexplained).toEqual([]);
    expect(ex.stats).toMatchObject({ footprints: a.stats.footprints, pads: a.stats.pads, tracks: a.stats.tracks, vias: a.stats.vias, nets: a.stats.nets });
    // the export lands where the source was: footprint for footprint at the same KiCad position, to the nanometer
    const at = (text: string) =>
      parseSexpr(text)
        .filter((x) => Array.isArray(x) && x[0] === "footprint")
        .map((f) => {
          const a = (f as unknown[]).find((y) => Array.isArray(y) && y[0] === "at") as string[];
          return [Math.round(Number(a[1]) * 1e6), Math.round(Number(a[2]) * 1e6), Number(a[3] ?? 0)].join(" ");
        })
        .sort();
    expect(at(ex.pcb)).toEqual(at(readFileSync(AIRNODE, "utf8")));
    // what is approximated or dropped is in the report, by name
    expect(ex.report.some((r) => r.level === "approximated" && /polygon pad/.test(r.message))).toBe(true);
    expect(ex.report.every((r) => r.count === undefined || r.count > 0)).toBe(true);
  });

  it("the hand-written sample (zones and fill, a rule area, blind vias, net classes, custom rules) comes back record by record", async () => {
    const { a, b, ex } = await roundTrip(SAMPLE);
    const d = compareDocs(a.document, b.document);
    expect(d.unexplained).toEqual([]);
    expect(d.explained["custom rule renumbered"]).toBeGreaterThan(0);
    expect(fillPolygons(b)).toBe(fillPolygons(a));
    expect(fillHoles(b)).toBe(fillHoles(a));
    expect(recordsOfKind(b.document, "rule").length).toBe(recordsOfKind(a.document, "rule").length);
    // the project carries the board setup and the classes; the rules file the custom rules, last one winning
    const pro = JSON.parse(ex.pro);
    expect(pro.board.design_settings.rules).toMatchObject({ min_track_width: 0.127, min_copper_edge_clearance: 0.3 });
    expect(pro.net_settings.classes.map((c: { name: string }) => c.name)).toEqual(["Default", "Power Rail", "Signal"]);
    expect(pro.net_settings.netclass_assignments).toMatchObject({ GND: "Power Rail" });
    expect(ex.dru).toMatch(/\(rule "power wide"\n\t\(condition "A.NetClass == 'Power Rail'"\)\n\t\(constraint track_width \(min 0.4mm\) \(opt 0.6mm\)\)\)/);
    expect(ex.dru).toMatch(/\(layer outer\)/);
    // the source rules the import could not express are reported as not in the export
    expect(ex.report.some((r) => r.level === "dropped" && /custom rule 'skew'/.test(r.message))).toBe(true);
    expect(ex.pcb).toMatch(/\(via blind /);
    expect(ex.pcb).toMatch(/\(keepout \(tracks not_allowed\) \(vias not_allowed\) \(pads allowed\) \(copperpour not_allowed\) \(footprints allowed\)\)/);
  });

  it("a board with no import record goes to (150, 100) mm and says so", async () => {
    const a = await importBoard({ path: AIRNODE, name: "board" });
    const ex = exportKicadBoard(a.document);
    expect(ex.report.some((r) => /no import record offset/.test(r.message))).toBe(true);
    const b = await importBoard({ text: ex.pcb, kind: "kicad_pcb", name: "board" });
    expect(b.offset).toEqual({ x: 150_000_000, y: -100_000_000 });
    expect(compareDocs(a.document, b.document).unexplained).toEqual([]);
  });

  it("keeps objects the source gave one UUID on one UUID, unless told not to", async () => {
    const a = await importBoard({ path: AIRNODE, name: "board" });
    const pads = recordsOfKind(a.document, "footprint").find((f) => f.pads.length >= 2)!;
    const group = [`pad:${pads.id.slice(3)}:${pads.pads[0].number}`, `pad:${pads.id.slice(3)}:${pads.pads[1].number}`];
    const kept = exportKicadBoard(a.document, { offset: a.offset, sharedIds: [group] });
    expect((await importBoard({ text: kept.pcb, kind: "kicad_pcb" })).sharedSourceIds).toEqual([group]);
    expect(kept.report.some((r) => /kept sharing one UUID/.test(r.message))).toBe(true);
    const own = exportKicadBoard(a.document, { offset: a.offset, sharedIds: [group], keepSharedIds: false });
    expect((await importBoard({ text: own.pcb, kind: "kicad_pcb" })).sharedSourceIds ?? []).toEqual([]);
  });

  it("reports a waiver (a record KiCad has no counterpart for) as not written", async () => {
    const a = await importBoard({ path: AIRNODE, name: "board" });
    const waiver = { kind: "waiver", id: "waiver:test", finding: "f:unconnected:0123456789ab", objects: [], reason: "checked by hand", by: { kind: "human", id: "human" }, provenance: { by: "hand" } } as unknown as BoardRecord;
    const ex = exportKicadBoard(withChanges(a.document, [waiver]), { offset: a.offset });
    expect(ex.report).toContainEqual(expect.objectContaining({ level: "dropped", count: 1, message: expect.stringMatching(/^1 waiver: KiCad keeps DRC exclusions/) }));
  });
});

// ---------------------------------------------------------------- local boards (Git-ignored)
const manifestPath = join(LOCAL, "manifest.json");
const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { boards: Record<string, { root: string; pcb: string }> }) : undefined;
const local = Object.entries(manifest?.boards ?? {}).map(([, b], i) => {
  const root = isAbsolute(b.root) ? b.root : join(LOCAL, b.root);
  return { label: `board ${String.fromCharCode(65 + i)}`, pcb: join(root, b.pcb) };
});

describe.skipIf(!manifest)("KiCad export: round trip on the local boards (Git-ignored manifest)", () => {
  for (const l of local) {
    it.skipIf(!existsSync(l.pcb))(`${l.label} comes back record by record (only explained differences)`, async () => {
      const { a, b } = await roundTrip(l.pcb);
      const d = compareDocs(a.document, b.document);
      console.log(`${l.label}: ${a.document.records.size} records; explained ${JSON.stringify(d.explained)}`);
      expect(d.unexplained).toEqual([]);
      expect(fillPolygons(b)).toBe(fillPolygons(a));
      expect(fillHoles(b)).toBe(fillHoles(a));
      // objects the source gave one UUID share one in the export too
      const groups = (r: BoardImportResult) => (r.sharedSourceIds ?? []).map((g) => [...g].sort().join(" ")).sort();
      expect(groups(b)).toEqual(groups(a));
    }, 120_000);
  }
});

// ---------------------------------------------------------------- KiCad's DRC on the export
const cli = findKicadCli();
describe.skipIf(!cli)("KiCad export: KiCad's DRC (kicad-cli installed)", () => {
  it("gives the same counts on the export of the Airnode C3 sample as on the source", async () => {
    const { dir } = await roundTrip(AIRNODE, true);
    try {
      const count = (r: ReturnType<typeof runKicadDrc>["report"]) => {
        const by: Record<string, number> = {};
        for (const v of r.violations ?? []) if (v.type !== "lib_footprint_issues" && v.type !== "lib_footprint_mismatch") by[`${v.type}:${v.severity}`] = (by[`${v.type}:${v.severity}`] ?? 0) + 1;
        return { unconnected: (r.unconnected_items ?? []).length, by };
      };
      const source = count(runKicadDrc(AIRNODE, { cli }).report);
      const exported = count(runKicadDrc(join(dir, "board.kicad_pcb"), { cli }).report);
      expect(exported).toEqual(source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

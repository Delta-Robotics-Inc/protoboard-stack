/**
 * The Airnode C3 sample with a ground pour on each layer: fill, verification, determinism, staleness after edits,
 * and incremental refill against a full fill.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDocument, mm, withChanges, type BoardDocument, type RuleRec, type TrackRec, type ViaRec, type ZoneRec } from "@protoboardai/board";
import { AIRNODE_C3_NETLIST, airnodeC3Records } from "@protoboardai/board/fixtures/airnode-c3";
import { clip, fillZones, polygonRings, polygonsArea, refillZones, staleZones, verifyFill, writeComputedFill, type FillZonesResult, type Polygon } from "../src/index.js";
import { GEN, prng } from "./helpers.js";

function airnodeTwoPours(shuffle?: number): BoardDocument {
  const recs = airnodeC3Records();
  const bottom = recs.find((r) => r.id === "zone:f.gnd_bottom") as ZoneRec;
  const all = [...recs, { ...bottom, id: "zone:f.gnd_top", layers: ["top"], name: "GND top" } as ZoneRec];
  if (shuffle !== undefined) {
    const rnd = prng(shuffle);
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
  }
  return createDocument(all, AIRNODE_C3_NETLIST);
}

const polysOf = (r: FillZonesResult, zone: string, layer: string) => (r.fill.fills.find((f) => f.zone === zone && f.layer === layer)?.polygons ?? []) as Polygon[];
const xorArea = (a: Polygon[], b: Polygon[]) => polygonsArea(clip([{ rings: polygonRings(a) }, { rings: polygonRings(b) }], (i) => i[0] !== i[1]));

describe("Airnode C3 with a ground pour on each layer", () => {
  const doc = airnodeTwoPours();
  const r = fillZones(doc);
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("fills both layers and passes verification (clearances, edge, keep-out, islands)", () => {
    expect(r.fill.source).toBe("computed");
    expect(r.fill.fills.map((f) => `${f.zone}@${f.layer}`)).toEqual(["zone:f.gnd_bottom@bottom", "zone:f.gnd_top@top"]);
    const v = verifyFill(doc, r.fill, { tolerance: 0 });
    expect(v.violations).toEqual([]);
    const top = polygonsArea(polysOf(r, "zone:f.gnd_top", "top")) / 1e12;
    const bottom = polygonsArea(polysOf(r, "zone:f.gnd_bottom", "bottom")) / 1e12;
    console.log(`[board-fill] Airnode C3: top ${top.toFixed(3)} mm2 in ${polysOf(r, "zone:f.gnd_top", "top").length} pieces, bottom ${bottom.toFixed(3)} mm2; ${r.stats["zone:f.gnd_top@top"].spokes + r.stats["zone:f.gnd_bottom@bottom"].spokes} spokes; ${r.ms.toFixed(0)} ms`);
    // 39 x 29 mm zone less the antenna keep-out (13.2 x 5.2) and the copper of other nets
    expect(bottom).toBeGreaterThan(1000);
    expect(bottom).toBeLessThan(39 * 29 - 13.2 * 5.2);
    expect(top).toBeLessThan(bottom);
  });

  it("is deterministic: same input, same bytes (also from records in another order, and on disk)", () => {
    const again = fillZones(airnodeTwoPours());
    expect(JSON.stringify(again.fill)).toBe(JSON.stringify(r.fill));
    expect(JSON.stringify(again.inputs)).toBe(JSON.stringify(r.inputs));
    const shuffled = fillZones(airnodeTwoPours(42));
    expect(JSON.stringify(shuffled.fill)).toBe(JSON.stringify(r.fill));
    const root = mkdtempSync(join(tmpdir(), "board-fill-"));
    dirs.push(root);
    const a = writeComputedFill(join(root, "board"), r, root);
    const first = readFileSync(a.fill);
    const firstInputs = readFileSync(a.inputs);
    writeComputedFill(join(root, "board"), again, root);
    expect(readFileSync(a.fill).equals(first)).toBe(true);
    expect(readFileSync(a.inputs).equals(firstInputs)).toBe(true);
  });

  it("knows when it is stale and why", () => {
    expect(staleZones(doc, r.fill, r.inputs)).toEqual({ current: true, stale: [], notes: [] });
    const v = doc.records.get("via:f.gnd.1") as ViaRec;
    const moved = withChanges(doc, [{ ...v, x: v.x + mm(0.5) }]);
    const s = staleZones(moved, r.fill, r.inputs);
    expect(s.current).toBe(false);
    expect(s.stale.map((x) => [x.zone, x.reason, x.ids])).toEqual([
      ["zone:f.gnd_bottom", "inputs-changed", ["via:f.gnd.1"]],
      ["zone:f.gnd_top", "inputs-changed", ["via:f.gnd.1"]],
    ]);
    // silkscreen is not read
    const txt = doc.records.get("txt:f.title")!;
    expect(staleZones(withChanges(doc, [{ ...txt, x: (txt as { x: number }).x + 1 } as typeof txt]), r.fill, r.inputs).current).toBe(true);
    // new copper under a zone
    const added: TrackRec = { kind: "track", id: "trk:new", net: "LED1", layer: "bottom", width: mm(0.2), start: { x: mm(5), y: mm(-10) }, end: { x: mm(8), y: mm(-10) }, provenance: GEN };
    const sn = staleZones(withChanges(doc, [added]), r.fill, r.inputs);
    expect(sn.stale).toEqual([{ zone: "zone:f.gnd_bottom", layer: "bottom", reason: "new-copper", ids: ["trk:new"] }]);
    // a rule, a zone
    const rule = doc.records.get("rule:target.clearance") as RuleRec;
    expect(new Set(staleZones(withChanges(doc, [{ ...rule, min: mm(0.25) }]), r.fill, r.inputs).stale.map((x) => x.reason))).toEqual(new Set(["rules-changed"]));
    const z = doc.records.get("zone:f.gnd_top") as ZoneRec;
    expect(staleZones(withChanges(doc, [{ ...z, priority: 3 }]), r.fill, r.inputs).stale).toEqual([{ zone: "zone:f.gnd_top", layer: "top", reason: "zone-changed", ids: ["zone:f.gnd_top"] }]);
    // a fill without an inputs record (an importer's): only zone edits are seen, and it says so
    const imported = { ...r.fill, source: "kicad" as const };
    const si = staleZones(moved, imported);
    expect(si.current).toBe(true);
    expect(si.notes.join(" ")).toMatch(/not tracked/);
    expect(staleZones(withChanges(doc, [{ ...z, priority: 3 }]), imported).stale.every((x) => x.reason === "zones-changed")).toBe(true);
  });

  it("refills only the zone layers a change touches, and matches a full fill", () => {
    // a bottom-only track: only the bottom pour is refilled
    const t = doc.records.get("trk:f.i2c_scl.1") as TrackRec;
    const moved = withChanges(doc, [{ ...t, start: { x: t.start.x, y: t.start.y - mm(0.3) }, end: { x: t.end.x, y: t.end.y - mm(0.3) } }]);
    const inc = refillZones(moved, r, [t.id]);
    expect(inc.recomputed).toEqual([{ zone: "zone:f.gnd_bottom", layer: "bottom" }]);
    expect(staleZones(moved, inc.fill, inc.inputs).current).toBe(true);
    expect(verifyFill(moved, inc.fill).violations).toEqual([]);
    const full = fillZones(moved);
    for (const [z, l] of [["zone:f.gnd_bottom", "bottom"], ["zone:f.gnd_top", "top"]]) expect(xorArea(polysOf(inc, z, l), polysOf(full, z, l))).toBeLessThan(1e6); // under 1 um2 of grid rounding
    // a through via: both pours
    const v = moved.records.get("via:f.gnd.2") as ViaRec;
    const moved2 = withChanges(moved, [{ ...v, x: v.x + mm(0.4), y: v.y - mm(0.2) }]);
    const inc2 = refillZones(moved2, inc, [v.id]);
    expect(inc2.recomputed.map((x) => x.layer).sort()).toEqual(["bottom", "top"]);
    expect(verifyFill(moved2, inc2.fill).violations).toEqual([]);
    const full2 = fillZones(moved2);
    for (const [z, l] of [["zone:f.gnd_bottom", "bottom"], ["zone:f.gnd_top", "top"]]) expect(xorArea(polysOf(inc2, z, l), polysOf(full2, z, l))).toBeLessThan(1e6);
    // nothing relevant changed: nothing refilled
    const txt = moved2.records.get("txt:f.title")!;
    expect(refillZones(withChanges(moved2, [{ ...txt, x: (txt as { x: number }).x + 1 } as typeof txt]), inc2, [txt.id]).recomputed).toEqual([]);
  });

  it("refills whole without the in-memory cache (a fill loaded from disk), with the same result", () => {
    const v = doc.records.get("via:f.gnd.3") as ViaRec;
    const moved = withChanges(doc, [{ ...v, x: v.x - mm(1) }]);
    const inc = refillZones(moved, { fill: r.fill, inputs: r.inputs }, [v.id]);
    expect(JSON.stringify(inc.fill)).toBe(JSON.stringify(fillZones(moved).fill));
  });
});

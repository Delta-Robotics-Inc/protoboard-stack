/**
 * Our fill against the fill KiCad stored, on the real boards of the Git-ignored regression manifest (skipped when
 * it is absent). Each board is imported with @protoboardai/board-import (as a library), filled here, and compared
 * per zone and layer: the area difference, and whether our fill has copper closer to any copper of another net
 * than KiCad's stored fill came where that object alone shaped the stored boundary (the clearance KiCad applied there), beyond 10 micrometers of curve approximation.
 * Our fill is also proven with verifyFill against the imported rules. Boards are named only by letter.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importBoard } from "@protoboardai/board-import";
import type { BoardDocument, DerivedZoneFill, ZoneRec } from "@protoboardai/board";
import { clip, collectBoardShapes, exact, fillZones, polygonRings, polygonsArea, SegIndex, verifyFill, type Polygon } from "../src/index.js";

const REG = fileURLToPath(new URL("../../ext-tscircuit/test/fixtures/pcb-regression/", import.meta.url));
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(REG, "local");
const manifestPath = join(LOCAL, "manifest.json");
const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { boards: Record<string, { root: string; pcb: string }> }) : undefined;
const boards = Object.entries(manifest?.boards ?? {}).map(([, b], i) => {
  const root = isAbsolute(b.root) ? b.root : join(LOCAL, b.root);
  return { label: `board ${String.fromCharCode(65 + i)}`, pcb: join(root, b.pcb) };
});

interface ZoneComparison {
  zone: string;
  layer: string;
  net?: string;
  ours: number;
  theirs: number;
  diffPct: number;
  oursOnly: number;
  theirsOnly: number;
  piecesOurs: number;
  piecesTheirs: number;
  closerThanKicad: number;
  /** Our area that the stored fill of a same-net zone of higher priority covers. */
  sameNetOverlap: number;
  zoneInfo: string;
}

/** Per zone and layer, compare our polygons with the stored ones. */
function compare(doc: BoardDocument, ours: DerivedZoneFill, theirs: DerivedZoneFill): ZoneComparison[] {
  const shapes = collectBoardShapes(doc);
  const out: ZoneComparison[] = [];
  for (const t of theirs.fills) {
    if (!t.zone) continue;
    const o = ours.fills.find((f) => f.zone === t.zone && f.layer === t.layer);
    const op = (o?.polygons ?? []) as Polygon[];
    const tp = t.polygons as Polygon[];
    const a = polygonsArea(op);
    const b = polygonsArea(tp);
    const oursOnly = op.length && tp.length ? polygonsArea(clip([{ rings: polygonRings(op) }, { rings: polygonRings(tp) }], (i) => i[0] && !i[1])) : a;
    const theirsOnly = op.length && tp.length ? polygonsArea(clip([{ rings: polygonRings(op) }, { rings: polygonRings(tp) }], (i) => !i[0] && i[1])) : b;
    // where the stored fill's boundary was shaped by one copper object of another net (no other object, edge or fill
    // within 10 um as close), its distance is the clearance KiCad applied there; ours must not come closer
    const z = doc.records.get(t.zone) as ZoneRec | undefined;
    let closer = 0;
    if (op.length && tp.length) {
      const io = new SegIndex(op);
      const it = new SegIndex(tp);
      const others = theirs.fills.filter((f) => f !== t && f.layer === t.layer && f.net !== z?.net).flatMap((f) => f.polygons as Polygon[]);
      const io2 = others.length ? new SegIndex(others) : undefined;
      const near = (ix: SegIndex, s: exact.Shape, r: number) => {
        let d = Infinity;
        let at = { x: 0, y: 0 };
        ix.query(exact.inflateBox(exact.shapeBox(s), r), (k) => {
          const [x0, y0, x1, y1] = [ix.segs[4 * k], ix.segs[4 * k + 1], ix.segs[4 * k + 2], ix.segs[4 * k + 3]];
          const dk = exact.distSegShape(x0, y0, x1, y1, s);
          if (dk < d) {
            d = dk;
            // the closest point of the segment, by ternary search
            let lo = 0;
            let hi = 1;
            for (let n = 0; n < 40; n++) {
              const m1 = lo + (hi - lo) / 3;
              const m2 = hi - (hi - lo) / 3;
              if (exact.distPointShape(x0 + m1 * (x1 - x0), y0 + m1 * (y1 - y0), s) < exact.distPointShape(x0 + m2 * (x1 - x0), y0 + m2 * (y1 - y0), s)) hi = m2;
              else lo = m1;
            }
            at = { x: x0 + lo * (x1 - x0), y: y0 + lo * (y1 - y0) };
          }
        });
        return { d, at };
      };
      const edges = [...(shapes.outline ? [shapes.outline.shape] : []), ...shapes.cutouts.map((c) => c.shape)];
      const zr = z ? exact.regionShape(exact.contourEdges(z.outline)) : undefined;
      const items = shapes.items.filter((i) => i.layers.includes(t.layer));
      for (const item of items) {
        if (z?.net !== undefined && item.net === z.net) continue;
        const k = near(it, item.shape, 1_500_000);
        if (!(k.d < 1_500_000)) continue;
        const shapedBy = items.every((o) => o === item || exact.distPointShape(k.at.x, k.at.y, o.shape) >= k.d + 10_000) && shapes.holes.every((h) => exact.distPointShape(k.at.x, k.at.y, h.shape) >= k.d + 10_000);
        if (!shapedBy) continue;
        if (edges.some((e) => e.t === "region" && Math.min(...e.edges.map((g) => exact.distPointEdge(k.at.x, k.at.y, g))) < k.d + 10_000)) continue;
        if (zr && zr.t === "region" && Math.min(...zr.edges.map((g) => exact.distPointEdge(k.at.x, k.at.y, g))) < 10_000) continue;
        if (io2) {
          let dz = Infinity;
          io2.query({ minX: k.at.x - k.d - 20_000, minY: k.at.y - k.d - 20_000, maxX: k.at.x + k.d + 20_000, maxY: k.at.y + k.d + 20_000 }, (s) => {
            dz = Math.min(dz, exact.distPointSeg(k.at.x, k.at.y, io2.segs[4 * s], io2.segs[4 * s + 1], io2.segs[4 * s + 2], io2.segs[4 * s + 3]));
          });
          if (dz < k.d + 10_000) continue;
        }
        const o = near(io, item.shape, 1_500_000);
        if (o.d < k.d - 10_000) {
          closer++;
          if (process.env.PB_FILL_COMPARE_DETAIL) console.log(`[board-fill]     closer: ${item.kind} on ${t.layer}: ours ${(o.d / 1e6).toFixed(4)} mm, stored ${(k.d / 1e6).toFixed(4)} mm`);
        }
      }
    }
    // the stored fill of a lower-priority zone leaves out the area of a higher-priority zone of the same net; ours overlaps it
    let sameNetOverlap = 0;
    for (const f of theirs.fills) {
      if (f === t || f.layer !== t.layer || !f.zone || !op.length) continue;
      const oz = doc.records.get(f.zone) as ZoneRec | undefined;
      if (!oz || !z || oz.net !== z.net || oz.priority <= z.priority) continue;
      sameNetOverlap += polygonsArea(clip([{ rings: polygonRings(op) }, { rings: polygonRings(f.polygons as Polygon[]) }], (i) => i[0] && i[1]));
    }
    out.push({
      zone: t.zone,
      layer: t.layer,
      ...(z?.net !== undefined ? { net: z.net } : {}),
      ours: a / 1e12,
      theirs: b / 1e12,
      diffPct: b > 0 ? (100 * (a - b)) / b : a > 0 ? 100 : 0,
      oursOnly: oursOnly / 1e12,
      theirsOnly: theirsOnly / 1e12,
      piecesOurs: op.length,
      piecesTheirs: tp.length,
      closerThanKicad: closer,
      sameNetOverlap: sameNetOverlap / 1e12,
      zoneInfo: z ? `priority ${z.priority}, ${z.pad_connection}, min width ${(z.min_width ?? 0) / 1e6} mm, islands ${z.remove_islands}, clearance ${(z.clearance ?? 0) / 1e6} mm, ${z.fill_mode}` : "",
    });
  }
  return out;
}

describe.skipIf(!manifest)("comparison with KiCad's stored fills (local boards, Git-ignored manifest)", () => {
  for (const b of boards) {
    it.skipIf(!existsSync(b.pcb))(`${b.label}: our fill against the stored fill`, async () => {
      const imp = await importBoard({ path: b.pcb, name: b.label });
      const zones = [...imp.document.records.values()].filter((r) => r.kind === "zone");
      if (!zones.length || !imp.fill.fills.length) {
        console.log(`[board-fill] ${b.label}: no zones with stored fill; skipped`);
        return;
      }
      const t0 = performance.now();
      const r = fillZones(imp.document);
      const ms = performance.now() - t0;
      const v = verifyFill(imp.document, r.fill, { checks: ["clearance", "zone_clearance", "edge_clearance", "keepout", "outside_zone", "island"] });
      const rows = compare(imp.document, r.fill, imp.fill);
      const tot = rows.reduce((s, x) => ({ ours: s.ours + x.ours, theirs: s.theirs + x.theirs }), { ours: 0, theirs: 0 });
      const big = rows.filter((x) => Math.abs(x.diffPct) > 2 && Math.abs(x.ours - x.theirs) > 0.01);
      console.log(
        `[board-fill] ${b.label}: ${rows.length} zone layers with stored fill, filled in ${ms.toFixed(0)} ms; total area ours ${tot.ours.toFixed(2)} mm2, stored ${tot.theirs.toFixed(2)} mm2 (${((100 * (tot.ours - tot.theirs)) / tot.theirs).toFixed(2)} %); ${big.length} zone layers differ by more than 2 %; closer than the stored fill: ${rows.reduce((s, x) => s + x.closerThanKicad, 0)} objects; verifyFill violations: ${v.violations.length} (${[...new Set(v.violations.map((x) => x.kind))].join(", ")})`,
      );
      // why: a thin inset (ours a few micrometers inside along the outline), a same-net zone above it, or other
      const why = (x: ZoneComparison) => (x.ours > x.theirs && x.sameNetOverlap > 0.5 * x.oursOnly ? "same-net zone of higher priority" : x.ours < x.theirs && x.oursOnly < 0.001 && x.theirsOnly < 0.03 ? "thin inset" : "other");
      const counts: Record<string, number> = {};
      for (const x of big) counts[why(x)] = (counts[why(x)] ?? 0) + 1;
      console.log(`[board-fill] ${b.label}: zone layers over 2 %: ${JSON.stringify(counts)}`);
      for (const x of big.filter((y) => why(y) !== "thin inset")) console.log(`[board-fill]   ${b.label} ${x.zone} ${x.layer}: ours ${x.ours.toFixed(3)} mm2 (${x.piecesOurs} pieces), stored ${x.theirs.toFixed(3)} mm2 (${x.piecesTheirs} pieces), ${x.diffPct.toFixed(1)} %; ours only ${x.oursOnly.toFixed(3)}, stored only ${x.theirsOnly.toFixed(3)}; ${why(x)}; ${x.zoneInfo}`);
      if (process.env.PB_FILL_COMPARE_DETAIL) for (const vi of v.violations.slice(0, 20)) console.log(`[board-fill]   violation ${JSON.stringify(vi)}`);
      expect(v.violations.filter((x) => x.kind === "clearance" || x.kind === "edge_clearance" || x.kind === "zone_clearance" || x.kind === "keepout")).toEqual([]);
      expect(rows.reduce((s, x) => s + x.closerThanKicad, 0)).toBe(0);
    });
  }
});

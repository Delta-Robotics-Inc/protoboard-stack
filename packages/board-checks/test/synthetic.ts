/**
 * A synthetic, deterministic 6-layer board for the performance test: 84 eight-pad footprints, 336 two-pin nets
 * routed on the top layer or through two vias and an inner layer, and two inner-layer ground planes given as fill
 * with an antipad hole around every via. The routes are not design-rule clean (lanes cross pads and each other),
 * which makes it a harder case for the checks than a finished board: many shorts and clearance findings.
 */
import type { BoardRecord, CopperLayer } from "@protoboardai/board";
import type { ZoneFill } from "../src/index.js";
import { boardRecords, fp, P, rectV, rule, smd, trk, via, zone } from "./helpers.js";

export function syntheticSixLayer(): { records: BoardRecord[]; nets: Record<string, string[]>; fills: ZoneFill[] } {
  const records: BoardRecord[] = [...boardRecords({ layers: 6, w: 84, h: 64 })];
  const nets: Record<string, string[]> = { GND: [] };
  const fps: { ref: string; x: number; y: number }[] = [];
  for (let row = 0; row < 7; row++)
    for (let col = 0; col < 12; col++) {
      const ref = `U${row * 12 + col + 1}`;
      const x = -36 + col * 6.5;
      const y = -24 + row * 8;
      fps.push({ ref, x, y });
      const pads = [];
      for (let k = 0; k < 4; k++) pads.push(smd(String(k + 1), -1.5, -1.5 + k, 0.8, 0.5));
      for (let k = 0; k < 4; k++) pads.push(smd(String(k + 5), 1.5, 1.5 - k, 0.8, 0.5));
      records.push(fp(ref, x, y, pads, { courtyard: rectV(4.4, 4.6) }));
    }
  const inner: CopperLayer[] = ["inner1", "inner4"];
  let netNo = 0;
  const antipads: number[][] = [];
  for (let m = 0; m + 1 < fps.length; m += 2) {
    const a = fps[m];
    const b = fps[m + 1];
    for (let r = 0; r < 8; r++) {
      const name = `N${++netNo}`;
      // pad r+1 of the left footprint (its right column for r >= 4) to the same pad of the right one
      const pa = r < 4 ? { x: a.x - 1.5, y: a.y - 1.5 + r } : { x: a.x + 1.5, y: a.y + 1.5 - (r - 4) };
      const pb = r < 4 ? { x: b.x - 1.5, y: b.y - 1.5 + r } : { x: b.x + 1.5, y: b.y + 1.5 - (r - 4) };
      nets[name] = [`${a.ref}.${r + 1}`, `${b.ref}.${r + 1}`];
      const lane = 2.3 + 0.2 * r;
      if ((netNo * 115) % 336 < 115) {
        const x1 = pa.x + (r < 4 ? -0.9 : 0.9);
        const x2 = pb.x + (r < 4 ? -0.9 : 0.9);
        const layer = inner[netNo % 2];
        records.push(trk(`${name}.1`, name, "top", 0.15, [pa.x, pa.y], [x1, pa.y]));
        records.push(via(`${name}.a`, name, x1, pa.y, 0.45, 0.2));
        records.push(trk(`${name}.2`, name, layer, 0.15, [x1, pa.y], [x2, pb.y]));
        records.push(via(`${name}.b`, name, x2, pb.y, 0.45, 0.2));
        records.push(trk(`${name}.3`, name, "top", 0.15, [x2, pb.y], [pb.x, pb.y]));
        antipads.push([x1, pa.y], [x2, pb.y]);
      } else {
        const ym = a.y + (r < 4 ? -lane : lane);
        records.push(trk(`${name}.1`, name, "top", 0.15, [pa.x, pa.y], [pa.x, ym]));
        records.push(trk(`${name}.2`, name, "top", 0.15, [pa.x, ym], [pb.x, ym]));
        records.push(trk(`${name}.3`, name, "top", 0.15, [pb.x, ym], [pb.x, pb.y]));
      }
    }
  }
  const plane = (key: string, layer: CopperLayer): ZoneFill => {
    const holes = antipads.map(([x, y]) => {
      const pts = [];
      for (let k = 0; k < 8; k++) pts.push(P(x + 0.5 * Math.cos((k * Math.PI) / 4), y + 0.5 * Math.sin((k * Math.PI) / 4)));
      return pts;
    });
    records.push(zone(key, "GND", [layer], rectV(82, 62)));
    return { zone: `zone:${key}`, layer, polygons: [{ outline: rectV(81, 61), holes }] };
  };
  const fills = [plane("gnd2", "inner2"), plane("gnd3", "inner3")];
  records.push(
    rule("clr", "floor", "clearance", 0.1),
    rule("clr_t", "target", "clearance", 0.15),
    rule("tw", "floor", "track_width", 0.1),
    rule("vd", "floor", "via_diameter", 0.4),
    rule("vh", "floor", "via_hole", 0.2),
    rule("ar", "floor", "annular_ring", 0.1),
    rule("hh", "floor", "hole_to_hole", 0.25),
    rule("hc", "floor", "hole_clearance", 0.2),
    rule("edge", "floor", "edge_clearance", 0.3),
  );
  return { records, nets, fills };
}


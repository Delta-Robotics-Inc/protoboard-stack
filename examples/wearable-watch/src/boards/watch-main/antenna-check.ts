/**
 * No copper near the BLE module's antenna (docs/decisions.md D-W8).
 *
 * Raytac MDBT50Q-1MV2 §2.3: no copper in any layer under the antenna end of
 * the module, and as wide as possible beyond it. The circuit config's
 * keepout covers the strip between the module and the board edge; the
 * router does not see the area under the module itself as a keepout (the
 * module's courtyard keeps other parts out, not traces or vias). This reads
 * the routed board (tscircuit/circuit.json) and fails if any trace, via or
 * pad lies in the antenna zone: the module's antenna end beyond its last
 * row of pads (the module is 15.5 mm long; its pads stop about 3.75 mm from
 * the antenna end), across the keepout's 14 mm width, out to the board edge.
 * Traces to U1's own pads stop at the pads' edge; copper there is the
 * module's pad field, not the antenna. The inner-layer ground pours are
 * checked the same way: no filled point in the zone.
 *
 *   npx tsx src/boards/watch-main/antenna-check.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "./circuit.config.ts";

type El = Record<string, any>;
const here = dirname(fileURLToPath(import.meta.url));
const circuit: El[] = JSON.parse(readFileSync(join(here, "tscircuit", "circuit.json"), "utf8"));

const u1 = (config.constraints as any).placements.u1 as { at: [number, number]; rotation_deg: number };
if (u1.rotation_deg !== 180) throw new Error("antenna-check assumes U1 rotated 180° (antenna end towards -y)");
const u1Id = circuit.find((e) => e.type === "source_component" && e.name === "u1")?.source_component_id;
const u1Pcb = circuit.find((e) => e.type === "pcb_component" && e.source_component_id === u1Id)?.pcb_component_id;
if (!u1Pcb) throw new Error("u1 is not on the routed board");
// the antenna side of U1's pad field: its pads' lowest edge (antenna towards -y)
const padEdge = Math.min(...circuit.filter((e) => e.type === "pcb_smtpad" && e.pcb_component_id === u1Pcb).map((e) => e.y - e.height / 2));
const boardEdge = -20.5;
const zone = { x: [u1.at[0] - 7, u1.at[0] + 7], y: [boardEdge, padEdge] };

const inZone = (x: number, y: number, r = 0) => x + r > zone.x[0] && x - r < zone.x[1] && y + r > zone.y[0] && y - r < zone.y[1];

const hits: string[] = [];
for (const e of circuit) {
  if (e.type === "pcb_trace")
    // every wire segment, sampled every 0.05 mm (a segment can cross the zone with both ends outside it)
    (e.route ?? []).forEach((p: El, k: number, r: El[]) => {
      const q = r[k + 1];
      if (!q || p.route_type !== "wire" || q.route_type !== "wire") return;
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.05));
      for (let t = 0; t <= n; t++) {
        const x = p.x + ((q.x - p.x) * t) / n;
        const y = p.y + ((q.y - p.y) * t) / n;
        if (inZone(x, y, (p.width ?? 0) / 2)) return void hits.push(`trace ${e.pcb_trace_id} at (${x.toFixed(2)}, ${y.toFixed(2)}) on ${p.layer}`);
      }
    });
  if (e.type === "pcb_via" && inZone(e.x, e.y, (e.outer_diameter ?? 0.3) / 2)) hits.push(`via at (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`);
  if (e.type === "pcb_smtpad" && inZone(e.x, e.y)) hits.push(`pad ${e.pcb_smtpad_id} at (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`);
  // the ground pours: any filled point of the zone (on a 0.1 mm grid)
  if (e.type === "pcb_copper_pour") {
    const ring = (vs: El[]) => vs.map((v) => [v.x, v.y] as [number, number]);
    const outer = ring(e.brep_shape?.outer_ring?.vertices ?? []);
    const holes = (e.brep_shape?.inner_rings ?? []).map((r: El) => ring(r.vertices));
    const inPoly = (x: number, y: number, poly: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    let found: string | undefined;
    for (let x = zone.x[0] + 0.05; x < zone.x[1] && !found; x += 0.1)
      for (let y = zone.y[0] + 0.05; y < zone.y[1] && !found; y += 0.1)
        if (inPoly(x, y, outer) && !holes.some((h: [number, number][]) => inPoly(x, y, h))) found = `copper pour ${e.pcb_copper_pour_id} on ${e.layer} at (${x.toFixed(2)}, ${y.toFixed(2)})`;
    if (found) hits.push(found);
  }
}
console.log(`antenna zone x ${zone.x.join("..")} y ${zone.y.map((v) => v.toFixed(2)).join("..")} mm (board frame)`);
if (hits.length) {
  for (const h of hits) console.log(`FAIL  ${h}`);
  process.exit(1);
}
const moduleEnd = u1.at[1] - 15.5 / 2;
console.log(`PASS  no trace, via, pad or pour in the antenna zone (${(padEdge - moduleEnd).toFixed(2)} mm of the module beyond its pads, then ${(moduleEnd - boardEdge).toFixed(2)} mm to the board edge)`);

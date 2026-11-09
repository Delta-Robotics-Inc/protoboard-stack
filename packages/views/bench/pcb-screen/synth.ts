/**
 * A synthetic board built in code for the renderer's performance script: 6 copper layers, about 1,000 track
 * segments, 230 vias, a few hundred pads in QFN-like and chip footprints, inner-layer zones and silkscreen.
 * Deterministic (a seeded generator), so runs compare. Not a real design: shapes and nets are arbitrary.
 */
import { createDocument, type BoardDocument } from "../../../board/src/document.js";
import type { BoardRecord, CopperLayer, FootprintRec, Netlist, Pad } from "../../../board/src/schema.js";
import { mm } from "../../../board/src/units.js";

export interface SynthOptions {
  tracks?: number;
  vias?: number;
  seed?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const LAYERS: CopperLayer[] = ["top", "inner1", "inner2", "inner3", "inner4", "bottom"];

export function synthBoard(o: SynthOptions = {}): BoardDocument {
  const rand = rng(o.seed ?? 7);
  const W = 100;
  const H = 80;
  const TRACKS = o.tracks ?? 1000;
  const VIAS = o.vias ?? 230;
  const recs: BoardRecord[] = [
    { kind: "board", id: "board", name: "Synthetic 6-layer", thickness: mm(1.6), copper_layers: 6, origin: "center" },
    ...LAYERS.map((name, i): BoardRecord => ({ kind: "layer", id: `layer:${name}`, name, type: "copper", order: i * 2, thickness: mm(0.035) })),
    ...LAYERS.slice(0, -1).map((_, i): BoardRecord => ({ kind: "layer", id: `layer:core${i + 1}`, name: `core${i + 1}`, type: "dielectric", order: i * 2 + 1, thickness: mm(0.25) })),
    { kind: "outline", id: "outline", outline: [{ x: mm(-W / 2), y: mm(-H / 2) }, { x: mm(W / 2), y: mm(-H / 2) }, { x: mm(W / 2), y: mm(H / 2) }, { x: mm(-W / 2), y: mm(H / 2) }], source: { kind: "board" } },
  ];
  const fps: FootprintRec[] = [];
  const pins: { ref: string; num: string; x: number; y: number }[] = [];
  // 6 QFN-like parts with 48 pads and an exposed pad
  for (let q = 0; q < 6; q++) {
    const cx = -35 + (q % 3) * 35;
    const cy = q < 3 ? 18 : -18;
    const pads: Pad[] = [];
    for (let side = 0; side < 4; side++)
      for (let i = 0; i < 12; i++) {
        const t = -2.75 + i * 0.5;
        const [x, y, w, h] = side === 0 ? [-3.6, t, 0.8, 0.25] : side === 1 ? [t, -3.6, 0.25, 0.8] : side === 2 ? [3.6, -t, 0.8, 0.25] : [-t, 3.6, 0.25, 0.8];
        const num = String(side * 12 + i + 1);
        pads.push({ number: num, type: "smd", shape: "roundrect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), corner_radius: mm(0.06), layer: "top" });
        pins.push({ ref: `U${q + 1}`, num, x: cx + x, y: cy + y });
      }
    pads.push({ number: "49", type: "smd", shape: "rect", x: 0, y: 0, width: mm(4.2), height: mm(4.2), layer: "top" });
    fps.push({ kind: "footprint", id: `fp:U${q + 1}`, ref: `U${q + 1}`, footprint: "Synth:QFN-48", x: mm(cx), y: mm(cy), rotation: q * 15_000, side: "top", pads, courtyard: [{ x: mm(-4.5), y: mm(-4.5) }, { x: mm(4.5), y: mm(-4.5) }, { x: mm(4.5), y: mm(4.5) }, { x: mm(-4.5), y: mm(4.5) }], graphics: [{ layer: "top_silkscreen", shape: "rect", center: { x: 0, y: 0 }, width: mm(7.6), height: mm(7.6), stroke_width: mm(0.12) }], texts: [{ layer: "top_silkscreen", text: "REF", x: 0, y: mm(5.2), height: mm(0.8), role: "ref" }], provenance: { by: "generated", tool: "synth" } });
  }
  // 120 chip parts, a fifth on the bottom
  for (let c = 0; c < 120; c++) {
    const x = -46 + (c % 15) * 6.5;
    const y = -36 + Math.floor(c / 15) * 9.6 + (rand() - 0.5);
    const side = c % 5 === 0 ? "bottom" : "top";
    const ref = `${c % 2 ? "R" : "C"}${c + 1}`;
    fps.push({ kind: "footprint", id: `fp:${ref}`, ref, footprint: "Synth:0603", x: mm(x), y: mm(y), rotation: (c % 4) * 90_000, side, pads: [{ number: "1", type: "smd", shape: "roundrect", x: mm(-0.8), y: 0, width: mm(0.8), height: mm(0.95), corner_radius: mm(0.1), layer: "top" }, { number: "2", type: "smd", shape: "roundrect", x: mm(0.8), y: 0, width: mm(0.8), height: mm(0.95), corner_radius: mm(0.1), layer: "top" }], courtyard: [{ x: mm(-1.5), y: mm(-0.8) }, { x: mm(1.5), y: mm(-0.8) }, { x: mm(1.5), y: mm(0.8) }, { x: mm(-1.5), y: mm(0.8) }], texts: [{ layer: "top_silkscreen", text: "REF", x: 0, y: mm(1.4), height: mm(0.7), role: "ref" }], provenance: { by: "generated", tool: "synth" } });
  }
  recs.push(...fps);
  // nets: 120 of them, the QFN pins in groups
  const nets: Netlist["nets"] = [];
  for (let n = 0; n < 120; n++) nets.push({ name: `N${n}`, pins: pins.filter((_, i) => i % 120 === n).map((p) => `${p.ref}.${p.num}`) });
  // tracks: short Manhattan walks with occasional 45s, spread over the layers
  let t = 0;
  while (t < TRACKS) {
    const layer = LAYERS[Math.floor(rand() * LAYERS.length)];
    let x = -45 + rand() * 90;
    let y = -35 + rand() * 70;
    const net = `N${Math.floor(rand() * 120)}`;
    const width = [0.15, 0.2, 0.25, 0.4][Math.floor(rand() * 4)];
    const steps = 3 + Math.floor(rand() * 5);
    for (let s = 0; s < steps && t < TRACKS; s++) {
      const len = 2 + rand() * 10;
      const dir = Math.floor(rand() * 8);
      const nx = Math.max(-48, Math.min(48, x + Math.round(Math.cos((dir * Math.PI) / 4) * len * 100) / 100));
      const ny = Math.max(-38, Math.min(38, y + Math.round(Math.sin((dir * Math.PI) / 4) * len * 100) / 100));
      recs.push({ kind: "track", id: `trk:s${t}`, net, layer, width: mm(width), start: { x: mm(x), y: mm(y) }, end: { x: mm(nx), y: mm(ny) }, ...(t % 7 === 0 ? { locked: true as const } : {}), provenance: t % 7 === 0 ? { by: "hand" } : { by: "routed", tool: "synth" } });
      x = nx;
      y = ny;
      t++;
    }
  }
  for (let v = 0; v < VIAS; v++) {
    const blind = v % 10 === 0;
    recs.push({ kind: "via", id: `via:s${v}`, net: `N${v % 120}`, x: mm(-46 + rand() * 92), y: mm(-36 + rand() * 72), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: blind ? "inner2" : "bottom", provenance: { by: "routed", tool: "synth" } });
  }
  // two inner planes and a top pour outline
  for (const [i, l] of (["inner1", "inner4"] as const).entries())
    recs.push({ kind: "zone", id: `zone:plane${i}`, net: `N${i}`, layers: [l], outline: [{ x: mm(-49), y: mm(-39) }, { x: mm(49), y: mm(-39) }, { x: mm(49), y: mm(39) }, { x: mm(-49), y: mm(39) }], priority: 0, pad_connection: "thermal", fill_mode: "solid", remove_islands: "always", provenance: { by: "generated", tool: "synth" } });
  recs.push({ kind: "keepout", id: "kpo:corner", outline: [{ x: mm(38), y: mm(28) }, { x: mm(49), y: mm(28) }, { x: mm(49), y: mm(39) }, { x: mm(38), y: mm(39) }], layers: ["top", "bottom"], blocks: { tracks: true, vias: true, pours: true, footprints: false }, tier: "no_go", provenance: { by: "generated", tool: "synth" } });
  return createDocument(recs, { source: "fixture", nets: nets.filter((n) => n.pins.length) });
}

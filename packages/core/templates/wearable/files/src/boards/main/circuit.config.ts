import { defineCapabilityConfig } from "@protoboardai/core";

/** USB-C position: GCT's recommended layout for the USB4105 puts the board edge 3.675 mm in front of the footprint origin. */
const J1_X = -13.845;

/**
 * Outline: a Ø36 mm disc with a flat at the USB-C receptacle (as the wearable watch's board has),
 * so the receptacle's mouth meets the board edge without overhanging the disc.
 */
function outline(): [number, number][] {
  const R = 18;
  const edge = J1_X - 3.675;
  const alpha = Math.asin(Math.sqrt(R * R - edge * edge) / R); // the chord's half angle seen from the centre
  const pts: [number, number][] = [];
  const from = -Math.PI + alpha;
  const to = Math.PI - alpha;
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([Math.round(R * Math.cos(a) * 1000) / 1000, Math.round(R * Math.sin(a) * 1000) / 1000]);
  }
  return pts; // the chord closes the polygon back to the first point
}

/**
 * The main board's PCB (@protoboardai/ext-tscircuit): `protoboard run circuit:generate --module
 * main-board`, then `circuit:export`, writes the native design to tscircuit/ and the standard outputs
 * (board GLB/STEP and manifest, Gerbers, BOM, pick-and-place, schematic) to out/.
 *
 * A starting outline: a Ø36 mm disc with a flat for the USB-C receptacle, four layers (Raytac asks for an unbroken ground under the
 * module except at the antenna, §2.3). Set the outline, the placements the case fixes and the
 * keep-outs from your enclosure, as the wearable-watch reference project's circuit.config.ts does.
 */
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  module: "main-board",
  constraints: {
    layers: 4,
    thickness_mm: 0.8,
    outline: { polygon: outline() },
    placements: {
      // the BLE module with its antenna end at the board edge (6 o'clock): the module is 15.5 mm long
      u1: { at: [0, -8.25], rotation_deg: 180 },
      // USB-C at 9 o'clock, its mouth at the edge (the footprint origin is 3.675 mm behind the mouth)
      j1: { at: [J1_X, 0], rotation_deg: 270 },
    },
    keepouts: [
      {
        name: "antenna",
        rect: { at: [0, -17.25], size: [14, 1.8] },
        allow_bodies: ["u1"],
        reason: "Raytac MDBT50Q-1MV2 §2.3: no copper in any layer at the antenna end, kept clear beyond the module width, out to the board edge",
      },
    ],
    // 0.3 / 0.15 mm vias and 0.127 mm traces, as the wearable watch's board (to confirm with the fab)
    rules: { trace_width_mm: 0.127, power_trace_width_mm: 0.25, via_drill_mm: 0.15, via_pad_mm: 0.3, edge_clearance_mm: 0.3 },
    pours: [{ net: "gnd", layers: ["inner1", "inner2"], reason: "Raytac MDBT50Q-1MV2 §2.3: unbroken ground under the module except at the antenna" }],
  },
});

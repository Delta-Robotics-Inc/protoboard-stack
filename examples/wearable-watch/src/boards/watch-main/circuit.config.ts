import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * Outline: the Ø41 mm disc with a flat at the USB-C receptacle. GCT's recommended layout for the
 * USB4105 (drawing rev B4) puts the board edge 2.60 mm in front of the front stake slots, so the
 * plug's overmold meets the receptacle; j1 at x = -16.345 (turned 270°, its slots 1.075 mm in front
 * of its origin) puts that edge at x = -20.02, where the disc reached -20.5 (a 0.48 mm lip under
 * the mouth). The flat is the chord at x = -20.02 (|y| ≤ 4.41).
 */
function outline(): [number, number][] {
  const R = 20.5;
  const edge = -16.345 - 3.675;
  const alpha = Math.asin(Math.sqrt(R * R - edge * edge) / R); // the chord's half angle seen from the centre
  const pts: [number, number][] = [];
  const from = -Math.PI + alpha; // the chord's lower end
  const to = Math.PI - alpha; // its upper end, counter-clockwise through 0
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([Math.round(R * Math.cos(a) * 1000) / 1000, Math.round(R * Math.sin(a) * 1000) / 1000]);
  }
  return pts; // the chord closes the polygon back to the first point
}

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  module: "watch-main-board",
  constraints: {
    // 4 layers: the BLE module asks for an unbroken ground under its pads except at the
    // antenna (Raytac §2.3), and 47 components in a 41 mm disc route on 2 only with long detours
    layers: 4,
    thickness_mm: 0.8,
    // the disc under the round display: the display's tab and FPC fold reach 20.5 mm from its
    // centre; a 41 mm board fills the case cavity under it
    outline: { polygon: outline() },
    // positions the case and the display fix
    placements: {
      // USB-C at 9 o'clock seen from the back (3 o'clock from the front). The footprint origin is the
      // part's mounting origin, 3.675 mm behind its mouth: mouth at x -20.02, at the board edge, where
      // the receptacle's corners (y +-4.47) keep the case's 0.25 mm clearance to its round wall
      j1: { at: [-16.345, 0], rotation_deg: 270 },
      // side-push buttons either side of it, their stems radial to the round case (from the cavity
      // centre at x 0.5, at 150° and 210°) so the plungers cut square through the wall: stem tip 19.45 mm
      // from that centre (19.6 less 0.15 mm to keep the rotated courtyard on the board), the footprint
      // origin (the part's mounting origin) 2.05 mm behind the tip
      sw1: { at: [-14.57, 8.7], rotation_deg: 240 },
      sw2: { at: [-14.57, -8.7], rotation_deg: 300 },
      // the display on the rear face, its FPC contacts on their land: the footprint origin is the
      // display's mounting frame (its FPC contact plane, x 15.41 in the display's own frame); bottom
      // side, rotated 180°, so the display's centre is the board's centre and contact 1 is at -y
      ds1: { at: [15.41, 0], rotation_deg: 180, side: "bottom" },
      // under the cell's lead stubs (cell rotated 90°, PCM end towards +y; + lead at x -7)
      j3: { at: [-5.9, 16.2], rotation_deg: 180, side: "bottom" },
      // the heart-rate sensor behind the back window
      u3: { at: [3, 4], rotation_deg: 0 },
      // the BLE module with its antenna end at the board edge (6 o'clock seen from the back)
      u1: { at: [0, -10.75], rotation_deg: 180 },
    },
    keepouts: [
      {
        name: "antenna",
        rect: { at: [0, -19.75], size: [14, 1.8] },
        allow_bodies: ["u1"],
        reason: "Raytac MDBT50Q-1MV2 §2.3: no copper in any layer at the antenna end, kept clear as wide as possible beyond the module width, out to the board edge. Under the module itself its courtyard keeps parts away; that no trace or via runs under the antenna is checked on the routed board (docs/decisions.md D-W8)",
      },
      {
        // the module's antenna end beyond its last row of pads (15.5 mm module, pads stop 3.75 mm from the end), as wide as the strip beyond it,
        // on the inner layers: no trace there, and the ground pours stay out of it. The outer layers carry the
        // module's own pads and courtyard; antenna-check.ts checks them on the routed board
        name: "antenna_inner",
        rect: { at: [0, -16.85], size: [14, 4.2] },
        allow_bodies: ["u1"],
        layers: ["inner1", "inner2"],
        reason: "Raytac MDBT50Q-1MV2 §2.3: no copper in any layer under the antenna end of the module",
      },
    ],
    // ground on both inner layers, poured after routing around the other nets: Raytac asks for an unbroken
    // ground under the module (§2.3) and the rails return through it. The pour stays out of the antenna keep-out.
    pours: [{ net: "gnd", layers: ["inner1", "inner2"], reason: "Raytac MDBT50Q-1MV2 §2.3: unbroken ground under the module except at the antenna" }],
    // 0.3 / 0.15 mm vias: the local autorouter plans its vias at 0.3 mm, so larger pads land within 0.1 mm of
    // neighbouring pads (DRC errors); 0.15 mm drills are within common 4-layer fab capability (to confirm with the fab)
    rules: { trace_width_mm: 0.127, power_trace_width_mm: 0.25, via_drill_mm: 0.15, via_pad_mm: 0.3, edge_clearance_mm: 0.3 },
    // fabrication order (ext-release work order): ENIG for the leadless parts and the FPC land
    finish: "ENIG",
    assembly: "fab",
    // notes the fabrication order gives the fab after the provider's own (D-W19)
    fab_notes: [
      "J1's four stake slots (0.60 x 1.40 and 0.60 x 1.70 mm) are plated; its two Ø0.65 mm peg holes and SW1/SW2's Ø0.90 mm guide-boss holes are not plated. The guide-boss holes sit 0.075 mm from the switches' terminal lands, as Alps' recommended land pattern draws them (SKRT catalog, Drawing No.1): keep them as drawn.",
    ],
  },
});

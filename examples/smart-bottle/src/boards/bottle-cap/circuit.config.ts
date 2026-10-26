import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * The cap board's circuit provider and its design constraints (board frame:
 * mm, +X right and +Y up seen from the lid, the cap's axis at the origin; the
 * board sits on the cap's insert bosses without rotation, so these are the
 * cap's X and Y).
 *
 * Outline: a Ø70 mm disc (the cap's Ø71.4 mm cavity less 0.7 mm a side) with
 *  - the USB4720's mid-mount cut-out at +Y, as GCT's recommended PCB layout
 *    (drawing USB4720 rev B) places it: 9.05 mm wide, its rear edge 0.55 mm
 *    in front of the tail line (y = 28.30), and the board edge 1.28 mm in
 *    front of the front stake slots (y = 33.33) over ±5 mm, so the
 *    receptacle's 9.54 mm gasket stands in front of the board. GCT draws
 *    the cut-out's two rear inside corners R0.25; the outline keeps them
 *    square (rounding them moved the autorouter's result onto 77 faults)
 *    and a fab note limits the router's radius there;
 *  - a slot at -X for the temperature probe: the probe's stainless tube and
 *    its stiff heat-shrink end rise through the board plane at (-20.5, 0).
 *
 * Fixed placements (the cap's features are aligned to them):
 *  - j1 USB-C: facing +Y, gasket face at y = 34.2 (mount frame 4.15 mm behind
 *    it), 1.5 mm inside the cavity wall so the tongue (0.8 mm in front of the
 *    gasket, 6.7 mm wide) clears the curved wall by the cap's 0.5 mm design clearance
 *    (docs/decisions.md D-B10: the port's seal);
 *  - sw1: stem tip 3 mm inside the wall at y = -32.7, for the plunger's flange;
 *  - u1 ESP32-C3 module: at the +X rim, antenna end outward (OQ-B6), with a
 *    copper keep-out under the antenna area [B1] §3;
 *  - u2 VL53L4CD: underside, 3 mm from the axis over the floor window, so its
 *    18° cone (±9°) reaches the floor 210 mm down within Ø73 mm, clear of the
 *    bottle's Ø89 wall (it stood 18.4 mm off the axis before, where the cone
 *    met the wall above the floor: OQ-B1, review finding);
 *  - d1-d8: a ring of radius 29 mm under the lid's light pipes;
 *  - pads for the cell leads and the probe wires, where the harnesses land.
 */
const R = 35.0;
const STEP_DEG = 3;
// j1 at y = 30.05, turned 180°: its land pattern's tail line (2.30) at 27.75, front slots (-2.0) at 32.05
const usb = { half: 9.05 / 2, back: 30.05 - (2.3 - 0.55), gasketHalf: 5.0, gasketY: 30.05 + 2.0 + 1.28 };
const probe = { half: 4.2, endX: -16.3 };

function outline(): [number, number][] {
  const pts: [number, number][] = [];
  const yAt = (x: number) => Math.sqrt(R * R - x * x);
  const xAt = (y: number) => -Math.sqrt(R * R - y * y);
  const a0 = (Math.atan2(yAt(usb.gasketHalf), usb.gasketHalf) * 180) / Math.PI; // right edge of the USB cut
  const a1 = 180 - a0;
  const p0 = 180 - (Math.asin(probe.half / R) * 180) / Math.PI; // top edge of the probe slot
  const p1 = 360 - p0;
  const arc = (from: number, to: number) => {
    for (let a = from; a < to - 1e-9; a += STEP_DEG) pts.push([R * Math.cos((a * Math.PI) / 180), R * Math.sin((a * Math.PI) / 180)]);
    pts.push([R * Math.cos((to * Math.PI) / 180), R * Math.sin((to * Math.PI) / 180)]);
  };
  arc(p1 - 360, a0); // from below the probe slot round through 0° to the USB cut
  pts.push([usb.gasketHalf, usb.gasketY], [usb.half, usb.gasketY], [usb.half, usb.back], [-usb.half, usb.back], [-usb.half, usb.gasketY], [-usb.gasketHalf, usb.gasketY]);
  arc(a1, p0);
  pts.push([probe.endX, probe.half], [probe.endX, -probe.half], [xAt(-probe.half), -probe.half]);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  // round, and drop repeated points and the closing point (it repeats the first)
  const out = pts.map(([x, y]) => [r3(x), r3(y)] as [number, number]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  const [f, l] = [out[0], out[out.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? out.slice(0, -1) : out;
}

// LED k at 157.5° + 45°(k - 1), counter-clockwise: the order of the LP5024's outputs round its
// package (OUT0 at the top of its left side, counter-clockwise), so the 24 traces fan out without crossing
const ring = (k: number) => {
  const a = ((157.5 + 45 * (k - 1)) * Math.PI) / 180;
  return [Math.round(29 * Math.cos(a) * 100) / 100, Math.round(29 * Math.sin(a) * 100) / 100] as [number, number];
};
const hole = (deg: number) => [Math.round(27 * Math.cos((deg * Math.PI) / 180) * 100) / 100, Math.round(27 * Math.sin((deg * Math.PI) / 180) * 100) / 100] as [number, number];

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  constraints: {
    // four layers: on two, the autorouter left 60-150 clearance faults, most at the LP5024's 0.4 mm-pitch
    // pads, which fan out 24 traces to the ring (the circuit-board SOP's rule: 4 when 2 cannot route cleanly)
    layers: 4,
    thickness_mm: 0.6,
    outline: { polygon: outline() },
    mounting_holes: [
      { id: "mount_ne", at: hole(45), diameter_mm: 2.2 },
      { id: "mount_nw", at: hole(135), diameter_mm: 2.2 },
      { id: "mount_sw", at: hole(225), diameter_mm: 2.2 },
      { id: "mount_se", at: hole(315), diameter_mm: 2.2 },
    ],
    placements: {
      j1: { at: [0, 30.05], rotation_deg: 180 },
      sw1: { at: [0, -30.65], rotation_deg: 0 },
      u1: { at: [25.5, 0], rotation_deg: -90 },
      u2: { at: [0, -3], rotation_deg: 0, side: "bottom" },
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((k) => [`d${k}`, { at: ring(k), rotation_deg: k === 2 ? 90 : 0 }])), // d2 turned: the autorouter dropped a via between its pads
      jbat: { at: [16.75, -26.75], rotation_deg: 180 },
      jprb: { at: [-21.4, 11], rotation_deg: 0 }, // 0.1 mm off the LED ring: their courtyards (IPC-7351B) touched at -21.5
    },
    keepouts: [
      { name: "antenna", rect: { at: [31.8, 0], size: [6.8, 14] }, reason: "ESP32-C3-MINI-1 PCB antenna: no copper under or beside it ([B1] §3 pin-layout note); the module's antenna area starts 11.2 mm from its pad end (datasheet Figure 10-1)", allow_bodies: ["u1"] },
    ],
    // the USB4720's tail lands end 0.15 mm before the cut-out's edge (GCT layout): 0.15 mm copper-to-edge instead of the provider's 0.3 mm default,
    // so no trace fits between them and the edge.
    // Power traces 0.25 mm (default 0.3): two leaving adjacent 0.4 mm-pitch pins of the LP5024 (VCC, ADDR1) must clear each other;
    // 0.25 mm carries the 350 mA Wi-Fi peak on 3V3 and the ~0.6 A VBAT worst case (assumption from the IPC-2221 charts, 1 oz outer layers)
    rules: { edge_clearance_mm: 0.15, power_trace_width_mm: 0.25 },
    // order values (ext-tscircuit README, "In the Manufacturing Package"); defaults stated by the work order
    assembly: "fab",
    // vias stay out of SMD pads (the provider's default, via_in_pad: "avoid"), so none needs filling (D-B14).
    // Notes the fabrication order gives the fab, after the provider's own (ext-tscircuit fab_notes; docs/decisions.md D-B07)
    fab_notes: [
      "Finished thickness 0.6 mm ± 0.1 mm: the USB4720 mid-mount receptacle needs it (GCT drawing USB4720 rev B).",
      "J1's cut-out (9.05 mm wide, at the board's +Y edge): its two rear inside corners R0.25 mm max, as GCT draws them (USB4720 rev B recommended PCB layout); mill them with a Ø0.5 mm tool or smaller, or relieve them; do not leave the router's larger radius there, it would stand under the receptacle's body.",
      "J1's four stake slots (0.50 x 1.65 mm) and two Ø0.50 mm tag holes are plated; SW1's two Ø0.90 mm guide-boss holes are not plated and sit 0.075 mm from its terminal lands, as Alps' recommended land pattern draws them (SKRT catalog, Drawing No.1): keep them as drawn.",
    ],
  },
});

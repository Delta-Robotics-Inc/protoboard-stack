import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * The main board's PCB (@protoboardai/ext-tscircuit): `protoboard run circuit:generate --module
 * main-board`, then `circuit:export`, writes the native design to tscircuit/ and the standard outputs
 * (board GLB/STEP and manifest, Gerbers, BOM, pick-and-place, schematic) to out/.
 *
 * A starting outline (board frame: mm, +X right, +Y up seen from the top): a Ø50 mm disc with
 *  - the USB4720's mid-mount cut-out at +Y, as GCT's recommended PCB layout (drawing USB4720 rev B)
 *    places it and the smart-bottle board has it: 9.05 mm wide, its rear edge 0.55 mm in front of the
 *    tail line, the board edge 1.28 mm in front of the front stake slots over ±5 mm, so the
 *    receptacle's 9.54 mm gasket stands in front of the board;
 *  - the ESP32-C3 module at the +X rim, antenna end outward, with a copper keep-out under the antenna.
 * The USB4720 needs a 0.6 ± 0.1 mm board (GCT drawing). Set the outline, the placements the
 * enclosure fixes and the mounting holes from your housing, as smart-bottle's circuit.config.ts does.
 */
const R = 25.0;
const STEP_DEG = 3;
// j1 turned 180°: its land pattern's tail line (2.30) and front slots (-2.0) set the cut-out and the edge
const J1_Y = R - 4.95;
const usb = { half: 9.05 / 2, back: J1_Y - (2.3 - 0.55), gasketHalf: 5.0, gasketY: J1_Y + 2.0 + 1.28 };

function outline(): [number, number][] {
  const pts: [number, number][] = [];
  const yAt = (x: number) => Math.sqrt(R * R - x * x);
  const a0 = (Math.atan2(yAt(usb.gasketHalf), usb.gasketHalf) * 180) / Math.PI; // right edge of the USB cut
  const a1 = 180 - a0;
  const arc = (from: number, to: number) => {
    for (let a = from; a < to - 1e-9; a += STEP_DEG) pts.push([R * Math.cos((a * Math.PI) / 180), R * Math.sin((a * Math.PI) / 180)]);
    pts.push([R * Math.cos((to * Math.PI) / 180), R * Math.sin((to * Math.PI) / 180)]);
  };
  arc(a1 - 360, a0); // from the USB cut's left edge round through 270° and 0° to its right edge
  pts.push([usb.gasketHalf, usb.gasketY], [usb.half, usb.gasketY], [usb.half, usb.back], [-usb.half, usb.back], [-usb.half, usb.gasketY], [-usb.gasketHalf, usb.gasketY]);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const out = pts.map(([x, y]) => [r3(x), r3(y)] as [number, number]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  const [f, l] = [out[0], out[out.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? out.slice(0, -1) : out;
}

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  module: "main-board",
  constraints: {
    layers: 4,
    thickness_mm: 0.6,
    outline: { polygon: outline() },
    placements: {
      j1: { at: [0, J1_Y], rotation_deg: 180 },
      // the module (16.6 mm long) with its antenna end at the +X rim
      u1: { at: [R - 9.5, 0], rotation_deg: -90 },
    },
    keepouts: [
      {
        name: "antenna",
        rect: { at: [R - 3.2, 0], size: [6.8, 14] },
        reason: "ESP32-C3-MINI-1 PCB antenna: no copper under or beside it (datasheet pin-layout note); the module's antenna area starts 11.2 mm from its pad end (datasheet Figure 10-1)",
        allow_bodies: ["u1"],
      },
    ],
    // the USB4720's tail lands end 0.15 mm before the cut-out's edge (GCT layout): 0.15 mm copper-to-edge
    // 0.127 mm traces and 0.3 / 0.15 mm vias (as the wearable watch's board) to fan out of the receptacle's 0.5 mm-pitch pads
    rules: { edge_clearance_mm: 0.15, trace_width_mm: 0.127, power_trace_width_mm: 0.25, via_drill_mm: 0.15, via_pad_mm: 0.3 },
    fab_notes: ["Finished thickness 0.6 mm ± 0.1 mm: the USB4720 mid-mount receptacle needs it (GCT drawing USB4720 rev B)."],
  },
});

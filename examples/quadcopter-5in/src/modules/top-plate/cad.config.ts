/**
 * The top plate's cad provider (tool-integrations §4). The constraints are
 * the plate generator's design values: the plate covers the 75 x 39.5 mm pack
 * (x -70 … 50) and has two strap slots for the 20 mm strap. CNC-cut carbon
 * plate, so the manufacturing export is DXF.
 *
 * Strap slots (PB-836): the strap goes round the pack's 39.5 x 35 mm
 * cross-section (the HGLRC part's fit check), so it runs across the plate
 * (Y) and its 20 mm width lies along X. Each slot is 22 x 3 mm, long in X,
 * centred on the pack (frame BATTERY_PAD, x = 7.5) and just outside the
 * pack's sides (y = ±19.75): inner edges at ±21.5, outer edges at ±24.5,
 * leaving 3.5 mm of plate to the ±28 outline. The earlier slots (long in Y,
 * at x = -14 and 28) lay under the pack, so the strap could only pass
 * between the pack and the plate.
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-frame-cad",
  process: "cut",
  constraints: {
    outline_mm: { x: [-70, 50], y: [-28, 28] },
    corner_radius_mm: 4,
    slots_mm: [
      { center: [7.5, -23], size: [22, 3] },
      { center: [7.5, 23], size: [22, 3] },
    ],
  },
});

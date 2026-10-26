import { defineCapabilityConfig } from "@protoboardai/core";

// TEST FIXTURE: a 32 × 24 mm board. The LED channels are placed by frame
// (tscircuit/layout.json): each channel's parts in its own coordinates, the
// second channel turned half round.
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  // the folder also declares the sub-modules (power, sensor, LED channel): name the board
  module: "fx-lamp-board",
  constraints: {
    layers: 2,
    thickness_mm: 1.0,
    outline: { rect: { width_mm: 32, height_mm: 24 } },
    placements: {
      j1: { at: [-12, 8], rotation_deg: 0 },
    },
  },
});

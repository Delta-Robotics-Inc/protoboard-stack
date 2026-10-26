import { defineCapabilityConfig } from "@protoboardai/core";

// TEST FIXTURE: a 30 mm round tile. The header's position stands in for what
// the enclosure's manifest will supply later; the keep-out stands in for an
// antenna clearance.
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-tscircuit",
  constraints: {
    layers: 2,
    thickness_mm: 1.0,
    outline: { circle: { diameter_mm: 30 } },
    mounting_holes: [
      { id: "mount_left", at: [-11, -6], diameter_mm: 2.2 },
      { id: "mount_right", at: [11, -6], diameter_mm: 2.2 },
    ],
    placements: {
      j1: { at: [0, 11.5], rotation_deg: 0 },
      u2: { at: [5, 5], rotation_deg: 0 },
    },
    keepouts: [{ name: "antenna", rect: { at: [0, -12], size: [8, 3] }, reason: "fixture: clearance for a future chip antenna" }],
  },
});

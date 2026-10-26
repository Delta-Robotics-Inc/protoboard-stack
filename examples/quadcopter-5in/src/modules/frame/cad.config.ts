/**
 * The frame's cad provider (tool-integrations §4). The constraints are the
 * plate generator's design values for this frame; every other value is the
 * generator's default (packages/ext-frame-cad/lib/params.ts DEFAULTS).
 * CNC-cut carbon plate, so the manufacturing export is DXF.
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-frame-cad",
  process: "cut",
  constraints: {
    // camera side clamps: frame origin 10 mm above the plate top
    clamp_height_mm: 10,
    // motor pads 0.5 mm proud, so each motor face is its own planar face
    pad_height_mm: 0.5,
    arm_width_mm: 14,
  },
});

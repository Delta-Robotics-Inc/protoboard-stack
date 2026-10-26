import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * The cap's cad provider and design values (cap frame: mm, z = 0 on the
 * floor's underside where it meets the bottle's lip, +Z up toward the lid,
 * the bottle's axis at the origin).
 *
 * - Round, cavity fixed at Ø71.4 mm (the Ø70 board with 0.7 mm a side) from
 *   z 4 (floor top) to 20.6. The bayonet lid's collar (its O-ring groove and
 *   lugs, 8.3 mm) starts at z 12.3, above the USB-C counterbore (to z 11.3)
 *   and the button bore, so nothing passes through both the base and the
 *   turning lid; the cavity top went up from 16.8 for it (D-B09).
 * - Wall 4.3 mm: the shell's Ø80 mm outside, which the brief allows. On the
 *   collar the base keeps 1.05 mm behind the O-ring groove and the lid's
 *   skirt 0.8 mm behind its bayonet slots (min_wall_mm 0.8, two 0.4 mm
 *   extrusions): both at or near the limit on a part twisted against the
 *   O-ring, to check on the first print (OQ-B16). Floor 4 mm under the bosses' 6 mm insert holes; lid 2.5 mm.
 * - PETG, printed (OQ-B5: no food-contact claim).
 * - Outside the fit analysis: the bottle (on the thread), the probe (it goes
 *   through the floor by design) and the O-rings (in their grooves). Inside
 *   it: the board, the cell and the two cables.
 */
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-enclosure-cad",
  process: "print",
  constraints: {
    shape: "round",
    cavity_mm: { centre: [0, 0], radius: 35.7, z: [4, 20.6] },
    wall_mm: 4.3,
    floor_mm: 4,
    lid_mm: 2.5,
    clearance_mm: 0.5,
    material: "PETG",
    fasteners: "none",
    joint: { style: "twist" },
    exclude: ["bottle", "probe", "lip_oring", "lid_oring", "probe_oring"],
  },
});

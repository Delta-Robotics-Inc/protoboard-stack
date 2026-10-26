/**
 * M3 x 8 mm motor screw, included with the MEPS NEON 2207 V2.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/motor-screw-m3x8/cad.config.ts).
 *
 * Sources (parts/evidence/motor-screw-m3x8/sources.json):
 *   - src_package_photo: MEPS NEON 2207 V2 package contents photo (product page image)
 *     https://img-meps.mepsking.top/material/1/meps-neon-2207-v2-motor-package.jpg
 *   - src_size_chart: MEPS NEON 2207 V2 size chart (product page image)
 *     https://img-meps.mepsking.top/material/1/neon-2207-v2-motor-size-chart-pc.jpg
 *   - src_head_dims: Westfield Fasteners WF2344 technical summary (ISO 4762 M3 head, used as the nominal head of the included screws)
 *     https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Stainless-Socket-Cap-Screw-M3x8mm.html
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { WESTFIELD_ISO_4762, screw } from "./hardware.js";

export const MOTOR_SCREW_M3X8: ModuleDef = screw({
  id: "motor-screw-m3x8",
  name: "M3 x 8 mm motor screw (included with the motor)",
  size: 3,
  length: 8,
  head: WESTFIELD_ISO_4762.m3,
  includedWith: { part: "meps-neon-2207-v2-1950kv", quote: "the package photo shows eight M3 socket-head screws in two lengths with each motor; MEPS states neither length.", source: "https://img-meps.mepsking.top/material/1/meps-neon-2207-v2-motor-package.jpg" },
  why: "5.5 mm through the arm and pad leaves 2.5 mm in the motor base's M3 holes (16 mm circle, MEPS size chart): pick the four screws of the length that gives this, and check it at kitting.",
});

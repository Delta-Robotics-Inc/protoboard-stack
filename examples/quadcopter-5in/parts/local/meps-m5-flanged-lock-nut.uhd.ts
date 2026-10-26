/**
 * M5 flanged nylon-insert prop nut, included with the MEPS NEON 2207 V2.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/meps-m5-flanged-lock-nut/cad.config.ts).
 *
 * Sources (parts/evidence/meps-m5-flanged-lock-nut/sources.json):
 *   - src_package_photo: MEPS NEON 2207 V2 package contents photo (product page image)
 *     https://img-meps.mepsking.top/material/1/meps-neon-2207-v2-motor-package.jpg
 *   - src_size_chart: MEPS NEON 2207 V2 size chart (product page image)
 *     https://img-meps.mepsking.top/material/1/neon-2207-v2-motor-size-chart-pc.jpg
 *   - src_din985_spec: Westfield Fasteners product specification: DIN 985 nyloc nuts, low type (Type T), Table 1 dimensions
 *     https://www.westfieldfasteners.co.uk/Standards/Nut-HexNy-M.pdf
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { A2_NYLOC, hexPart } from "./hardware.js";

export const MEPS_M5_FLANGED_LOCK_NUT: ModuleDef = hexPart({
  id: "meps-m5-flanged-lock-nut",
  name: "M5 flanged lock nut (prop nut, included with the motor)",
  kind: "nut",
  size: 5,
  length: 5,
  od: 8,
  threaded: true,
  material: "steel with nylon insert (not stated)",
  manufacturer: "Included (unbranded)",
  partNumber: "MEPS NEON 2207 V2 prop nut",
  includedWith: { part: "meps-neon-2207-v2-1950kv", quote: "the package photo shows one flanged nylon-insert lock nut for the M5 shaft with each motor.", source: "https://img-meps.mepsking.top/material/1/meps-neon-2207-v2-motor-package.jpg" },
  massMaterial: A2_NYLOC,
  tags: ["prop-nut", "lock-nut"],
  why: "Holds the propeller on the motor's M5 shaft (8 mm of thread, MEPS size chart): the hub sits on the bell, the nut on the hub.",
  gaps: { fields: ["height", "across flats", "flange diameter", "thread hand"], note: "MEPS states none. The body is the DIN 985 M5 nyloc nominal (h 5, s 8; Westfield's DIN 985 table) without the flange. A right-hand thread is assumed (no hand is stated; the motor's shaft thread hand is a data gap on the motor)." },
});

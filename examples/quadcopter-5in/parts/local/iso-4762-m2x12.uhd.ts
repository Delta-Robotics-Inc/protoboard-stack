/**
 * M2 x 12 mm socket head cap screw, ISO 4762 (Westfield WF2332).
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/iso-4762-m2x12/cad.config.ts).
 *
 * Sources (parts/evidence/iso-4762-m2x12/sources.json):
 *   - src_supplier: Westfield Fasteners WF2332: 304 DIN 912 Cap Screw M2 x 12mm (listing and technical summary)
 *     https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/304-DIN-912-Cap-Screw-M2x12mm.html
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { WESTFIELD_ISO_4762, screw } from "./hardware.js";

export const ISO_4762_M2X12: ModuleDef = screw({
  id: "iso-4762-m2x12",
  name: "M2 x 12 mm socket head cap screw, ISO 4762, A2 stainless",
  size: 2,
  length: 12,
  head: WESTFIELD_ISO_4762.m2,
  supplier: { name: "Westfield Fasteners", partNumber: "WF2332", url: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/304-DIN-912-Cap-Screw-M2x12mm.html", title: "304 DIN 912 Cap Screw M2 x 12mm" },
  why: "GPS: 0.62 mm board + 5 mm spacer + 2 mm top plate + 2.8 mm nut = 10.4 mm (M2 x 10 would stop inside the nut).",
});

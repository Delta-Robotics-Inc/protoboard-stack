/**
 * M2 x 18 mm socket head cap screw, ISO 4762, A2 stainless (Westfield WF17972).
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/iso-4762-m2x18/cad.config.ts).
 *
 * Sources (parts/evidence/iso-4762-m2x18/sources.json):
 *   - src_supplier: Westfield Fasteners WF17972: M2 x 18mm Socket Head Cap Screw in A2 Stainless - ISO 4762 (DIN 912)
 *     https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Socket-Head-Cap-Screw-M2x18-A2-Stainless.html
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { WESTFIELD_ISO_4762, screw } from "./hardware.js";

export const ISO_4762_M2X18: ModuleDef = screw({
  id: "iso-4762-m2x18",
  name: "M2 x 18 mm socket head cap screw, ISO 4762, A2 stainless",
  size: 2,
  length: 18,
  head: WESTFIELD_ISO_4762.m2,
  supplier: { name: "Westfield Fasteners", partNumber: "WF17972", url: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Socket-Head-Cap-Screw-M2x18-A2-Stainless.html", title: "M2 x 18mm Socket Head Cap Screw in A2 Stainless - ISO 4762 (DIN 912)" },
  why: "Air unit: 5 mm bottom plate + 3 mm airflow spacer + 6 mm module + 2.8 mm nut = 16.8 mm.",
});

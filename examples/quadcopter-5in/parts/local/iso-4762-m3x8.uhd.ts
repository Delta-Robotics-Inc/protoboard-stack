/**
 * M3 x 8 mm socket head cap screw, ISO 4762, A2 stainless (Westfield WF2344).
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/iso-4762-m3x8/cad.config.ts).
 *
 * Sources (parts/evidence/iso-4762-m3x8/sources.json):
 *   - src_supplier: Westfield Fasteners WF2344: M3 x 8mm Socket Head Cap Screw in A2 Stainless (listing and technical summary)
 *     https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Stainless-Socket-Cap-Screw-M3x8mm.html
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { WESTFIELD_ISO_4762, screw } from "./hardware.js";

export const ISO_4762_M3X8: ModuleDef = screw({
  id: "iso-4762-m3x8",
  name: "M3 x 8 mm socket head cap screw, ISO 4762, A2 stainless",
  size: 3,
  length: 8,
  head: WESTFIELD_ISO_4762.m3,
  supplier: { name: "Westfield Fasteners", partNumber: "WF2344", url: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Stainless-Socket-Cap-Screw-M3x8mm.html", title: "M3 x 8mm Socket Head Cap Screw in A2 Stainless" },
  why: "Top-plate standoff screws: 5 mm bottom plate (or 2 mm top plate) plus 3–6 mm into the standoff's 7 mm thread.",
});

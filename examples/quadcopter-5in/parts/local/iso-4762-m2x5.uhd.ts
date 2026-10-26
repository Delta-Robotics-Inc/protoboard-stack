/**
 * M2 x 5 mm socket head cap screw, ISO 4762, A2 stainless (Westfield WF2328).
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/iso-4762-m2x5/cad.config.ts).
 *
 * Sources (parts/evidence/iso-4762-m2x5/sources.json):
 *   - src_supplier: Westfield Fasteners WF2328: M2 x 5mm Socket Head Cap Screw in A2 Stainless - ISO 4762 (DIN 912)
 *     https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Socket-Head-Cap-Screw-M2x5-A2-Stainless.html
 *   - src_o4_manual: DJI O4 Air Unit User Manual v1.0, p.6 (camera mounting holes)
 *     https://dl.djicdn.com/downloads/DJI_O4_Air_Unit_Series/UM/DJI_O4_Air_Unit_Series_User_Manual_v1.0_en.pdf
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { WESTFIELD_ISO_4762, screw } from "./hardware.js";

export const ISO_4762_M2X5: ModuleDef = screw({
  id: "iso-4762-m2x5",
  name: "M2 x 5 mm socket head cap screw, ISO 4762, A2 stainless",
  size: 2,
  length: 5,
  head: WESTFIELD_ISO_4762.m2,
  supplier: { name: "Westfield Fasteners", partNumber: "WF2328", url: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Socket-Head-Cap-Screw-M2x5-A2-Stainless.html", title: "M2 x 5mm Socket Head Cap Screw in A2 Stainless - ISO 4762 (DIN 912)" },
  why: "O4 camera between the 2 mm side plates: 5 − 2 = 3.0 mm into the camera, within DJI's 3.10 mm maximum engagement (O4 manual p.6). The screws DJI includes 'can only be used for frames thicker than 2 mm' (same page), so this frame needs its own.",
});

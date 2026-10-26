/**
 * M2 nyloc nut, DIN 985, A2 stainless (Westfield WF16826).
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/iso-10511-m2-nyloc-nut/cad.config.ts).
 *
 * Sources (parts/evidence/iso-10511-m2-nyloc-nut/sources.json):
 *   - src_supplier: Westfield Fasteners WF16826: M2 Nyloc Nut Type T (Standard) in A2 Stainless - DIN 985
 *     https://www.westfieldfasteners.co.uk/Metric-Nuts/Nyloc-Nut-Type-T-Standard-M2-A2-Stainless.html
 *   - src_din985_spec: Westfield Fasteners product specification: DIN 985 nyloc nuts, low type (Type T), Table 1 dimensions
 *     https://www.westfieldfasteners.co.uk/Standards/Nut-HexNy-M.pdf
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { A2_NYLOC, hexPart } from "./hardware.js";

export const ISO_10511_M2_NYLOC: ModuleDef = hexPart({
  id: "iso-10511-m2-nyloc-nut",
  name: "M2 nyloc nut, DIN 985, A2 stainless",
  kind: "nut",
  size: 2,
  length: 2.8,
  od: 4,
  threaded: true,
  material: "A2 stainless / nylon insert",
  massMaterial: A2_NYLOC,
  supplier: {
    name: "Westfield Fasteners",
    partNumber: "WF16826",
    url: "https://www.westfieldfasteners.co.uk/Metric-Nuts/Nyloc-Nut-Type-T-Standard-M2-A2-Stainless.html",
    title: "M2 Nyloc Nut Type T (Standard) in A2 Stainless - DIN 985",
    note: "The listing gives no dimensions for M2, and DIN 985's table starts at M3; 4 mm across flats and 2.8 mm height are nominal, not verified.",
  },
  why: "Locks the GPS and air-unit screws.",
  gaps: { fields: ["height", "across flats"], note: "Not stated for M2 by the listing; DIN 985 Table 1 has no M2 row. 2.8 mm and 4 mm are assumed." },
});

/**
 * Ettinger 005.03.308 aluminium standoff SW5.5 x 30 mm, M3 x 7 both ends.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/m3-aluminium-standoff-30mm/cad.config.ts).
 *
 * Sources (parts/evidence/m3-aluminium-standoff-30mm/sources.json):
 *   - src_supplier: Ettinger 005.03.308 product page: Abstandsbolzen Aluminium passiviert I/I SW5,5x30, Gewinde M3x7 / M3x7
 *     https://www.ettinger.de/p/abstandsbolzen-aluminium-passiviert-i-i-sw5-5x30-gewinde-m3x7-m3x7/005.03.308
 *   - src_datasheet: Ettinger 005.03.308 Artikeldatenblatt (PDF)
 *     https://www.ettinger.de/product-datasheet/00b5b66f70a7b486195837da0e75aef6/create
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { hexPart } from "./hardware.js";

export const M3_STANDOFF_30: ModuleDef = hexPart({
  id: "m3-aluminium-standoff-30mm",
  name: "M3 aluminium standoff, 30 mm, female–female, 5.5 mm AF",
  kind: "standoff",
  size: 3,
  length: 30,
  od: 5.5,
  threaded: true,
  material: "aluminium 3.1655, passivated",
  supplier: {
    name: "Ettinger",
    partNumber: "005.03.308",
    url: "https://www.ettinger.de/p/abstandsbolzen-aluminium-passiviert-i-i-sw5-5x30-gewinde-m3x7-m3x7/005.03.308",
    title: "Abstandsbolzen Aluminium passiviert I/I SW5,5x30 | Gewinde M3x7 / M3x7",
    packQuantity: 100,
    note: "Blind M3 threads 7 mm deep at each end.",
    weight: { g: 1.82, source: "https://www.ettinger.de/product-datasheet/00b5b66f70a7b486195837da0e75aef6/create", quote: "Material: Aluminium 3.1655 / Gewicht: 1.82g" },
  },
  why: "Sets the 30 mm plate spacing that clears the flight stack and the camera plates. The M3 x 8 screws engage 3 mm (through the 5 mm bottom plate) and 6 mm (through the 2 mm top plate) of the 7 mm threads.",
});

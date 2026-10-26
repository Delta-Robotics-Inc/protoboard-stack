/**
 * Ettinger 007.02.403 spacer Ø2.7/4.0 x 3.0 mm PA6.0 GF25.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/m2-nylon-spacer-3mm/cad.config.ts).
 *
 * Sources (parts/evidence/m2-nylon-spacer-3mm/sources.json):
 *   - src_supplier: Ettinger 007.02.403 product page: Distanzhülse Ø2,7/4,0 x 3,0 PA6.0 GV25 schwarz
 *     https://www.ettinger.de/p/distanzhuelse-oe2-7-4-0-x-3-0-pa6.0-gv25-schwarz/007.02.403
 *   - src_datasheet: Ettinger 007.02.403 Artikeldatenblatt (PDF)
 *     https://www.ettinger.de/product-datasheet/1462c93e0bc370857bb3fbeaf80ee590/create
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { hexPart } from "./hardware.js";

export const M2_NYLON_SPACER_3: ModuleDef = hexPart({
  id: "m2-nylon-spacer-3mm",
  name: "M2 nylon spacer, Ø2.7/4.0 x 3 mm",
  kind: "spacer",
  size: 2,
  length: 3,
  od: 4,
  threaded: false,
  bore: 2.7,
  material: "PA 6.0 GF25",
  supplier: {
    name: "Ettinger",
    partNumber: "007.02.403",
    url: "https://www.ettinger.de/p/distanzhuelse-oe2-7-4-0-x-3-0-pa6.0-gv25-schwarz/007.02.403",
    title: "Distanzhülse Ø2,7/4,0 x 3,0 PA6.0 GV25 schwarz",
    packQuantity: 100,
    note: "Ettinger's datasheet lists it 'Für Gewinde: M2,5' (2.7 mm bore); used here on M2 screws, which it clears.",
    weight: { g: 0.05, source: "https://www.ettinger.de/product-datasheet/1462c93e0bc370857bb3fbeaf80ee590/create", quote: "Gewicht: 0.05g" },
  },
  why: "Airflow gap under the O4 transmission module (DJI: mount in airflow).",
});

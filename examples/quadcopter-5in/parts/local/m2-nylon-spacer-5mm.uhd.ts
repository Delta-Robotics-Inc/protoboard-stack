/**
 * Ettinger 007.02.405 spacer Ø2.7/4.0 x 5.0 mm PA6.0 GF25.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/m2-nylon-spacer-5mm/cad.config.ts).
 *
 * Sources (parts/evidence/m2-nylon-spacer-5mm/sources.json):
 *   - src_supplier: Ettinger 007.02.405 product page: Distanzhülse Ø2,7/4,0 x 5,0 PA6.0 GV25 schwarz
 *     https://www.ettinger.de/p/distanzhuelse-oe2-7-4-0-x-5-0-pa6.0-gv25-schwarz/007.02.405
 *   - src_datasheet: Ettinger 007.02.405 Artikeldatenblatt (PDF)
 *     https://www.ettinger.de/product-datasheet/b2045fb72487819453bc4ccca9932442/create
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { hexPart } from "./hardware.js";

export const M2_NYLON_SPACER_5: ModuleDef = hexPart({
  id: "m2-nylon-spacer-5mm",
  name: "M2 nylon spacer, Ø2.7/4.0 x 5 mm",
  kind: "spacer",
  size: 2,
  length: 5,
  od: 4,
  threaded: false,
  bore: 2.7,
  material: "PA 6.0 GF25",
  supplier: {
    name: "Ettinger",
    partNumber: "007.02.405",
    url: "https://www.ettinger.de/p/distanzhuelse-oe2-7-4-0-x-5-0-pa6.0-gv25-schwarz/007.02.405",
    title: "Distanzhülse Ø2,7/4,0 x 5,0 PA6.0 GV25 schwarz",
    packQuantity: 100,
    note: "Ettinger's datasheet lists it 'Für Gewinde: M2,5' (2.7 mm bore); used here on M2 screws, which it clears.",
    weight: { g: 0.05, source: "https://www.ettinger.de/product-datasheet/b2045fb72487819453bc4ccca9932442/create", quote: "Gewicht: 0.05g" },
  },
  why: "Lifts the GPS so its JST-GH sockets (4.35 mm tall, measured on Matek's M9N-5883 model) clear the top plate.",
});

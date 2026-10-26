/**
 * M3 x 8.1 mm rubber grommet for the AM32 ESC, included with the DolphinRC stack.
 *
 * Project-researched purchased part (parts/local; tool-integrations §6 in the
 * Protoboard Stack): mounting hardware not in the cloud catalog (searched
 * 2026-10-03). Built with parts/local/hardware.ts; its nominal body comes
 * through the `cad` capability (parts/local/dolphinrc-m3-grommet-esc/cad.config.ts).
 *
 * Sources (parts/evidence/dolphinrc-m3-grommet-esc/sources.json):
 *   - src_product: DolphinRC F405 V3 50A 60A STACK product page (package list)
 *     https://dolphinrc.com/products/dolphinrc-f405-v3-50a-60a-stack
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { RUBBER, hexPart } from "./hardware.js";

export const DOLPHINRC_M3_GROMMET_ESC: ModuleDef = hexPart({
  id: "dolphinrc-m3-grommet-esc",
  name: "M3 rubber grommet, ESC (included with the stack)",
  kind: "spacer",
  size: 3,
  length: 4,
  od: 8.1,
  threaded: false,
  material: "rubber (not stated)",
  manufacturer: "DolphinRC",
  partNumber: "M3*8.1mm Rubber (for ESC)",
  includedWith: { part: "dolphinrc-am32-60a-4in1-esc", quote: "'5x M3*8.1mm Rubber(for ESC)' in the stack's package list (four used, one spare).", source: "https://dolphinrc.com/products/dolphinrc-f405-v3-50a-60a-stack" },
  massMaterial: RUBBER,
  tags: ["grommet", "vibration-isolation"],
  why: "Seats the ESC on the stack bolts: one grommet in each of the board's Φ4 mm holes, clamped by the stack bolts.",
  gaps: { fields: ["height", "outer diameter", "compound"], note: "DolphinRC gives only 'M3*8.1mm'. 8.1 mm is read as the outer diameter and 4 mm as the clamped height (the stack-up's assumption); the compound is not stated." },
});

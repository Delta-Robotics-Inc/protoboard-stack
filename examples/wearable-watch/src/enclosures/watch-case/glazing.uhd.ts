/**
 * The case's two window covers as parts of their own (review of PB-829): the
 * display lens and the heart-rate window cover. They are cut from clear PMMA
 * sheet, not printed, so they are BOM lines with their own cutting outline.
 *
 * Their geometry comes from the cad capability: ext-enclosure-cad builds each
 * outside window's cover from the window's `cover` (watch-case.uhd.ts) and
 * writes it to src/enclosures/watch-case/out/cover_<window>.step|glb|dxf, in
 * the cover's own frame (outer face at z 0, body along +z). Each cover mates
 * flush with its window (watch.uhd.ts, links `lens_seat` and `hr_cover_seat`).
 *
 * Sizes are the windows' cover sizes; the material and thickness are this
 * project's choice (docs/decisions.md D-W5, D-W16) and the lens is not yet
 * sourced as a finished part (OQ-W11): it is cut from sheet.
 */
import type { InterfaceDef, MaterialSpec, ModuleDef } from "@deltarobotics/uhd";
import { coverArtifacts } from "@protoboardai/ext-enclosure-cad/lib/index.ts";

const OUT = "src/enclosures/watch-case/out";

const PMMA: MaterialSpec = {
  name: "Cast PMMA (acrylic), clear",
  density_g_cm3: 1.19,
  assumption: "Typical density of cast PMMA sheet; the sheet supplier is not chosen yet (OQ-W11). The body is the generator's nominal outline at the sheet's nominal thickness.",
};

/** The seat: the cover's outer face, mating flush with its window's outer face. */
const seat = (note: string): InterfaceDef => ({
  id: "seat",
  name: "Seat in the window pocket (outer face)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  max_instances: 1,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["window_cover"],
  geometry: { frame: { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] } },
  traits: [{ type: "usage_note", params: { note } }],
});

function cover(o: { id: string; name: string; window: string; dims: { length: number; width: number; height: number }; description: string; fit: string; why: string }): ModuleDef {
  return {
    id: o.id,
    name: o.name,
    kind: "module",
    version: "0.1.0",
    manufacturer: "Laser cut for this project (custom)",
    description: o.description,
    categories: ["mechanical.enclosure"],
    tags: ["cover", "window", "pmma", "laser-cut", "made-part"],
    display: { icon: "circle" },
    interfaces: [seat(o.fit)],
    domains: [{ domain: "mechanical", dimensions_mm: o.dims, material: PMMA }],
    traits: [
      { type: "assumption", params: { field: "material and thickness", value: `clear cast PMMA, ${o.dims.height} mm`, reason: o.why } },
      {
        type: "usage_note",
        params: {
          topic: "manufacture",
          note: `Laser cut from ${o.dims.height} mm clear cast PMMA sheet to ${OUT}/cover_${o.window}.dxf (the case provider's outline, the window's cover size). Keep the protective film on until assembly; deburr the edge.`,
        },
      },
      { type: "data_gap", params: { fields: ["supplier", "sheet grade"], note: "No sheet supplier or grade is chosen yet (OQ-W11); the release's ordering list leaves it open." } },
    ],
    artifacts: coverArtifacts(OUT, o.window),
  };
}

export const WATCH_DISPLAY_LENS = cover({
  id: "watch-display-lens",
  name: "Display lens, 38 × 0.5 mm PMMA",
  window: "display_window",
  dims: { length: 38, width: 38, height: 0.5 },
  description: "Clear 38 mm × 0.5 mm PMMA disc over the display's polarizer, in the case's lens pocket (flush with the front face). The display datasheet asks for a transparent protective plate (ER-TFT1.28-1 §7.2).",
  fit: "Sits flush in the 38.2 mm × 0.5 mm pocket of the case front over the 33.6 mm aperture; bonded at its rim (the same adhesive as the display, OQ-W11).",
  why: "The display datasheet asks for a protective plate (§7.2) and states no material; 0.5 mm PMMA is this project's choice for a printed case (D-W5).",
});

export const WATCH_HR_COVER = cover({
  id: "watch-hr-cover",
  name: "Heart-rate window cover, 4.0 × 8.2 × 0.5 mm PMMA",
  window: "hr_window",
  dims: { length: 8.2, width: 4.0, height: 0.5 },
  description: "Clear 4.0 × 8.2 × 0.5 mm PMMA plate over the MAX30102's windows, flush in the back cover's pocket.",
  fit: "Sits flush in the 4.2 × 8.4 mm pocket of the back cover over the 2.4 × 6.6 mm aperture; bonded at its rim.",
  why: "The MAX30102 needs a clear path for its LEDs and photodetector; the cover material and the optical barrier are open (OQ-W7). 0.5 mm PMMA matches the lens.",
});

export const GLAZING = [WATCH_DISPLAY_LENS, WATCH_HR_COVER];

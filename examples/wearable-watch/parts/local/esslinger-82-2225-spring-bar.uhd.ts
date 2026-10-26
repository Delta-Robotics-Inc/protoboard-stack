/**
 * Esslinger 82.2225 spring bar: 22 mm, ø1.50 mm, double flange, stainless
 * steel — datasheet-honest UHD part.
 *
 * Sources (see parts/evidence/esslinger-82-2225-spring-bar/sources.json):
 *   - src_size_table: Esslinger 1.5 mm double flange spring bar assortment (82.2005), size table — https://www.esslinger.com/stainless-steel-1-5mm-double-flange-watch-band-spring-bar-assortment-900-pc/
 *   - src_product:    Esslinger 1.50 mm thin double flanged spring bars, package of 10 — https://www.esslinger.com/watch-band-pin-1-50mm-thin-double-flanged-stainless-steel-spring-bars-package-of-10/
 *   - src_photo:      Esslinger product photo of the 1.50 mm double flanged bar — https://cdn11.bigcommerce.com/s-iic0hc/products/44289/images/87836/82.2185-main-image__37464.1659985844.500.750.gif
 *   - src_density:    thyssenkrupp Materials 304 / 1.4301 data (density) — https://www.thyssenkrupp-materials.co.uk/stainless-steel-304-14301.html
 *
 * Modelling notes:
 *   - Esslinger is the seller of record that owns part number 82.2225 and
 *     publishes its size table; the mill is not named. sources.json marks
 *     Esslinger as manufacturer authority on that basis and says so.
 *   - Sizes are named by compressed length; the table gives fits-lug 22 mm,
 *     compressed 21.8, overall 25.0, body 18.6, tip ø0.80, bar ø1.50 (mm).
 *     Esslinger says sizes are approximate.
 *   - Two interfaces, both protocol "custom" / role "peer" (no spring bar or
 *     pin-in-hole protocol exists; vocabulary gap in .research/gaps.json):
 *       `lug_fit`   the two spring-loaded ø0.80 tips that go into a pair of
 *                   lug holes 22 mm apart (one interface for the pair, since
 *                   the spring sets the end positions, not the bar);
 *       `strap_bar` the ø1.50 x 18.6 mm tube a strap's spring-bar tunnel
 *                   slides over. The strap is user-supplied and not modelled.
 *     Nothing pairs in DRC until the watch case declares its lug interface;
 *     the fit arithmetic is in the module usage_note.
 *   - Flange, groove, shank and tip-length dimensions are not in the table;
 *     they are estimated from Esslinger's photo (`assumption` trait). The
 *     photo-measured tip ø agrees with the table's 0.80.
 *   - No electrical, thermal or network domains: a passive steel part, and
 *     Esslinger states no temperature range (data_gap). This justifies
 *     verify's "no thermal domain" warning.
 *   - Mass is not stated: computed from the CAD volume x 304 density
 *     (material.assumption).
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { connectorTrait, defineModule } from "@deltarobotics/uhd";
import { feature, own, withGeometry } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which parts/local/cadkit/partkit.py follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  sizeTable: "https://www.esslinger.com/stainless-steel-1-5mm-double-flange-watch-band-spring-bar-assortment-900-pc/",
  product: "https://www.esslinger.com/watch-band-pin-1-50mm-thin-double-flanged-stainless-steel-spring-bars-package-of-10/",
  photo: "https://cdn11.bigcommerce.com/s-iic0hc/products/44289/images/87836/82.2185-main-image__37464.1659985844.500.750.gif",
  density: "https://www.thyssenkrupp-materials.co.uk/stainless-steel-304-14301.html",
} as const;

// src_size_table, row 82.2225 (mm)
const LUG_WIDTH_MM = 22;
const COMPRESSED_MM = 21.8;
const OVERALL_MM = 25.0;
const BODY_MM = 18.6;
const TIP_D_MM = 0.8;
const BAR_D_MM = 1.5; // "1.50mm bar diameter"

// Derived from the table
const EXTENSION_MM = (OVERALL_MM - BODY_MM) / 2; // 3.2 per end, free
const TRAVEL_MM = (OVERALL_MM - COMPRESSED_MM) / 2; // 1.6 per end

// Estimated from src_photo (assumption trait below)
const TIP_L_MM = 0.8;
const FLANGE_D_MM = 1.2;
const SHOULDER_SPAN_MM = OVERALL_MM - 2 * TIP_L_MM; // 23.4: outer-flange faces, free
const PRELOAD_MM = (SHOULDER_SPAN_MM - LUG_WIDTH_MM) / 2; // 0.7 per end when fitted

const ESSLINGER_82_2225_SPRING_BAR_BASE: ModuleDef = defineModule({
  id: "esslinger-82-2225-spring-bar",
  name: "Esslinger 82.2225 spring bar, 22 mm, ø1.50 mm, double flange",
  version: "1.0.0",
  manufacturer: "Esslinger",
  part_number: "82.2225",
  description:
    "Stainless steel watch strap spring bar for 22 mm lugs: ø1.50 mm bar, double-flanged spring-loaded ends with ø0.80 mm tips. Compressed length 21.8 mm, overall 25.0 mm, body 18.6 mm. Sold in packages of 10. Two per watch, one at each pair of lugs.",
  tags: ["hardware", "spring-bar", "watch-strap", "22mm", "double-flange", "stainless", "wearable"],
  categories: ["mechanical.mounting"],

  interfaces: [
    {
      id: "lug_fit",
      name: "Spring-loaded tips into a 22 mm lug pair",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      max_instances: 1,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["spring_bar", "lug_pin"],
      parameters: [
        { id: "lug_width", unit: "mm", value: LUG_WIDTH_MM },
        { id: "tip_diameter", unit: "mm", value: TIP_D_MM },
        { id: "compressed_length", unit: "mm", value: COMPRESSED_MM },
        { id: "overall_length", unit: "mm", value: OVERALL_MM },
      ],
      traits: [
        connectorTrait("watch_spring_bar_tips", {
          gender: "male",
          note: `Two spring-loaded plungers, one each end, each ending in a ø${TIP_D_MM} mm tip behind a double flange. Fits lugs ${LUG_WIDTH_MM} mm apart: the bar compresses to ${COMPRESSED_MM} mm to pass between the lugs, and the tips spring out into the two lug holes.`,
        }),
        {
          type: "pin_functions",
          params: {
            description:
              "Part Number 82.2225; Fits Lug Width 22mm; Compressed Length 21.8mm; Overall Length 25.0mm; Body Length 18.6mm; Tip Diameter .80mm. Sizes are determined by the compressed length of the spring bar. Double flanged.",
            source: SRC.sizeTable,
          },
        },
      ],
    },
    {
      id: "strap_bar",
      name: "ø1.50 mm bar for the strap's spring-bar tunnel",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      max_instances: 1,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["strap_bar"],
      parameters: [
        { id: "bar_diameter", unit: "mm", value: BAR_D_MM },
        { id: "bar_length", unit: "mm", value: BODY_MM },
      ],
      traits: [
        {
          type: "pin_functions",
          params: {
            description: "1.50mm bar diameter; Body Length 18.6mm (82.2225). Stainless steel spring bars.",
            source: [SRC.sizeTable, SRC.product],
          },
        },
      ],
    },
  ],

  domains: [
    {
      domain: "mechanical",
      // PB-797: no stated weight, so mass = CAD volume x density (an assumption)
      material: {
        name: "Stainless steel (grade not stated; 304 / 1.4301 density used)",
        density_g_cm3: 8.0,
        source: SRC.density,
        assumption:
          "Esslinger states only 'stainless steel', so the 304 density is assumed. The CAD body is representative (hollow tube with an assumed 0.2 mm wall, solid plungers, spring omitted), not a measured part; Esslinger states no weight.",
      },
      dimensions_mm: { length: OVERALL_MM, width: BAR_D_MM, height: BAR_D_MM },
      metadata: {
        fits_lug_width_mm: LUG_WIDTH_MM,
        compressed_length_mm: COMPRESSED_MM,
        overall_length_mm: OVERALL_MM,
        body_length_mm: BODY_MM,
        tip_diameter_mm: TIP_D_MM,
        bar_diameter_mm: BAR_D_MM,
        end_type: "double flange",
        material: "stainless steel",
        plunger_extension_per_end_mm: EXTENSION_MM,
        compression_travel_per_end_mm: TRAVEL_MM,
        dimensions_note:
          "Envelope = overall (free) length x bar diameter. Extension and travel per end are derived: (overall - body) / 2 and (overall - compressed) / 2. Esslinger: 'Sizes are approximate as measurements may vary slightly by gauge.'",
        source: [SRC.sizeTable, SRC.product],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "spring_bar",
        fits_lug_width_mm: LUG_WIDTH_MM,
        bar_diameter_mm: BAR_D_MM,
        end_type: "double flange",
        material: "stainless steel",
        pack: "package of 10",
        source: [SRC.sizeTable, SRC.product],
      },
    },
    {
      type: "usage_note",
      params: {
        note: `Fit in a ${LUG_WIDTH_MM} mm lug pair. Fully compressed the bar is ${COMPRESSED_MM} mm, ${((LUG_WIDTH_MM - COMPRESSED_MM) / 2).toFixed(1)} mm clear of each lug face, so it passes between the lugs. Released, each plunger travels out until its outer flange seats on the lug's inner face; the free shoulder span is about ${SHOULDER_SPAN_MM.toFixed(1)} mm (overall ${OVERALL_MM} minus two ~${TIP_L_MM} mm tips, assumed), so each end stays compressed about ${PRELOAD_MM.toFixed(1)} mm of its ${TRAVEL_MM.toFixed(1)} mm travel, and about ${TIP_L_MM} mm of tip sits in each lug hole. So the lug holes need a diameter above ø${TIP_D_MM} and below the ~ø${FLANGE_D_MM} flange (the watch brief's blind ø0.9-1.0 holes qualify) and a depth of at least ${TIP_L_MM} mm. Fit the strap's spring-bar tunnel (for 1.5 mm bars) over strap_bar before installing. Two per watch.`,
        quantity_per_watch: 2,
        source: SRC.sizeTable,
      },
    },
    {
      type: "assumption",
      params: {
        field: "end-feature dimensions",
        value: `tip length ${TIP_L_MM} mm beyond the outer flange; flanges ø${FLANGE_D_MM} x 0.25 mm with a ø0.9 x 0.25 mm groove between; plunger shank ø1.0 mm; tube ends tapered over 0.3 mm to ø1.2; tube wall 0.2 mm`,
        reason:
          "Esslinger dimensions only the tip diameter, bar diameter and lengths. The rest is measured from its product photo (the 18 mm size, scaled by the 1.50 mm body); the tube wall is not visible in any source. The photo's tip (ø0.75) agrees with the table's ø0.80, and the 1.65 mm of shank outside the tube matches the 1.6 mm travel.",
        source: SRC.photo,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD state",
        value: "free (as supplied): plungers fully extended, overall 25.0 mm",
        reason:
          "The cited dimensions are for the free bar. Fitted in 22 mm lugs each plunger sits about 0.7 mm further in (usage_note); the lug_fit frame is at the bar centre so it does not depend on that.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Esslinger's spring bar pages (82.2005 and 82.2015 assortments, the 1.50 mm package of 10) carry photos and the size table only, no STEP or drawing, and the mill is not named. Geometry is generated from the size table and photo (parts/local/esslinger-82-2225-spring-bar/esslinger-82-2225-spring-bar.py).",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["mass", "stainless grade", "spring force", "operating temperature", "flange dimensions"],
        note: "Not stated in the Esslinger sources.",
      },
    },
  ],

  artifacts: [
    { id: "art_size_table", name: "Esslinger 1.5 mm double flange spring bar assortment: size table (82.2225 row)", type: "documentation", url: SRC.sizeTable },
    { id: "art_product_page", name: "Esslinger 1.50 mm thin double flanged spring bars, package of 10", type: "documentation", url: SRC.product },
    { id: "art_photo", name: "Esslinger 1.50 mm double flanged spring bar photo", type: "documentation", url: SRC.photo },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD generated from the size table and photo by
// parts/local/esslinger-82-2225-spring-bar/esslinger-82-2225-spring-bar.py — not manufacturer
// CAD. Bar axis on X, centred on the origin, free state; end "a" at +X.
// ---------------------------------------------------------------------------

export const ESSLINGER_82_2225_SPRING_BAR: ModuleDef = withGeometry(
  ESSLINGER_82_2225_SPRING_BAR_BASE,
  {
    // the bar centre between the lugs, on the axis; the tips and the outer-flange
    // shoulders (which seat on the lug faces) at both ends
    lug_fit: {
      frame: { origin: [0, 0, 0], normal: [1, 0, 0] },
      refs: [
        feature("tip_a", { area_mm2: 2.011, centroid: [12.1, 0.0, 0.0] }),
        feature("tip_b", { area_mm2: 2.011, centroid: [-12.1, 0.0, 0.0] }),
        feature("flange_a", { area_mm2: 0.628, centroid: [11.7, 0.0, 0.0], normal: [1.0, 0.0, 0.0] }),
        feature("flange_b", { area_mm2: 0.628, centroid: [-11.7, 0.0, 0.0], normal: [-1.0, 0.0, 0.0] }),
      ],
    },
    // the bar as a mating frame: origin on its centre, xAxis along its axis, normal across it (-y), the
    // convention of the lugs that hold it (their frame's normal points out of the case end, its xAxis
    // along the bar), so a link from the lugs places the bar along them
    strap_bar: {
      frame: { origin: [0, 0, 0], normal: [0, -1, 0], xAxis: [1, 0, 0] },
      refs: [feature("strap_bar", { area_mm2: 84.823, centroid: [0.0, 0.0, 0.0] }), own("strap_bar")],
    },
  },
  cadArtifacts({
    dir: "parts/local/esslinger-82-2225-spring-bar",
    name: "esslinger-82-2225",
    generator: "parts/local/esslinger-82-2225-spring-bar/esslinger-82-2225-spring-bar.py",
    tool: "build123d 0.13.0",
    interfaces: ["strap_bar"],
  }),
);

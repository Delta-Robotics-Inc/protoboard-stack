/**
 * AS568-040 O-ring, silicone 70 Shore A (Marco S1000-040, FDA) — datasheet-honest UHD part.
 *
 * Sources (see ./as568-040-silicone/sources.json):
 *   - src_parker_handbook: Parker O-Ring Handbook ORD 5700A (AS568A size table, face gland chart) — https://www.macroseal.com/pdf/Parker%20O-rings.pdf
 *   - src_marco_product:   Marco S1000-040 O-ring, AS568-040, silicone 70A — https://www.marcorubber.com/product/S1000-040
 *   - src_marco_datasheet: Marco S1000 material summary (Rev 1, 04-2021) — https://www.marcorubber.com/downloads/Marco-Material-Datasheet-S1000.pdf
 *   - src_arc_chart:       American Rubber Corp AS568 size chart — https://www.americanrubbercorp.com/products/standard-o-rings/as568-o-ring-size-chart/
 *   - src_handbook_chart:  oringhandbook.com AS568 size chart — https://oringhandbook.com/as568-o-ring-size-chart/
 *
 * Modelling notes:
 *   - Generic standard part. manufacturer = "Generic (SAE AS568)"; the size is
 *     the standard's dash -040 and part_number is Marco's S1000-040, a
 *     documented FDA silicone 70A ring of that size. The smart-bottle brief
 *     allows any AS568 supplier; any AS568-040 in a 70A silicone is
 *     equivalent within the shrinkage note below. SAE AS568 itself is paid
 *     and was not read: the size is Parker's AS568A table, corroborated by
 *     two charts that agree to the digit.
 *   - Two mechanical interfaces, both protocol "custom" / role "peer": no
 *     seal or gland protocol exists (vocabulary gap in .research/gaps.json;
 *     the bottle's `lip_seal` makes the same choice). Ids, frames and the
 *     `o_ring_*` parameter ids follow as568-138-silicone, so the three
 *     smart-bottle rings read alike:
 *       `face_seal` the ring's -Z side, which bears on the flat counterface
 *                   (in the smart bottle, the cap body rim);
 *       `gland`     the ring's seat in the host's face groove: the +Z side on
 *                   the groove bottom, and the inner and outer flanks on the
 *                   groove walls. With water outside a lid the groove is
 *                   sized by its ID (Parker: groove ID = ring ID), so the
 *                   inner flank is the locating one.
 *     The ring is symmetric, so which side is the seal face is a naming
 *     convention. The `o_ring_*` ids keep DRC from range-checking the ring
 *     against a host's own `inner_diameter` and similar. `gland_depth` and
 *     `groove_width` carry Parker's .070 face-gland ranges, so a lid groove
 *     that declares them range-checks in DRC.
 *   - Size tolerances are for AN-shrinkage compounds. Silicone from standard
 *     tooling can run small (Parker's S0604-70, class I: ID 2.847 ± .023 in);
 *     Marco states the nominal size for S1000-040 without a class. Usage
 *     note, not modelled.
 *   - Mass is not stated. It is the CAD volume (582.7 mm³; Parker's table
 *     gives .0355 in³ = 581.7 mm³) times Parker's S0604-70 silicone density,
 *     1.43 (material.assumption): about 0.83 g.
 *   - Temperature is Marco's -60 to 205 °C service range (thermal domain and
 *     operating_conditions). No electrical, network or fluid-port domain.
 *   - In the smart bottle this is the electronics lid face seal, with the
 *     lid closed by six M2 screws (examples/smart-bottle/docs). The
 *     usage_note flags that the brief's screw circle and 80 mm cap do not fit
 *     around this ring's gland; the enclosure track decides.
 *   - Geometry is generated, exact to nominal (an O-ring is a torus defined
 *     by ID and CS): library/cad/py/catalog/as568-040-silicone.py.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { connectorTrait, defineModule } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  parker: "https://www.macroseal.com/pdf/Parker%20O-rings.pdf",
  product: "https://www.marcorubber.com/product/S1000-040",
  datasheet: "https://www.marcorubber.com/downloads/Marco-Material-Datasheet-S1000.pdf",
  arcChart: "https://www.americanrubbercorp.com/products/standard-o-rings/as568-o-ring-size-chart/",
  sizeChart: "https://oringhandbook.com/as568-o-ring-size-chart/",
} as const;

const IN = 25.4;
const r2 = (x: number) => Math.round(x * 100) / 100;

// src_parker_handbook AS568A table, row 2-040 (mm columns as printed); src_marco_product
const ID_MM = 72.75; // 2.864 in
const ID_TOL_MM = 0.51; // ±.020 in
const CS_MM = 1.78; // .070 in
const CS_TOL_MM = 0.08; // ±.003 in
const OD_MM = 76.31; // 3.004 in (src_marco_product, src_handbook_chart)
const VOLUME_MM3 = r2(0.0355 * IN ** 3); // .0355 in³ = 581.74

// src_parker_handbook Design Chart 4-2, .070 cross section (sizes 004-050), in → mm
const GLAND_DEPTH_MM: [number, number] = [r2(0.05 * IN), r2(0.054 * IN)]; // 1.27-1.37
const SQUEEZE_MM: [number, number] = [r2(0.013 * IN), r2(0.023 * IN)]; // 0.33-0.58
const SQUEEZE_PCT: [number, number] = [19, 32];
const WIDTH_LIQUID_MM: [number, number] = [r2(0.101 * IN), r2(0.107 * IN)]; // 2.57-2.72
const WIDTH_GAS_MM: [number, number] = [r2(0.084 * IN), r2(0.089 * IN)]; // 2.13-2.26
const GROOVE_RADIUS_MM: [number, number] = [r2(0.005 * IN), r2(0.015 * IN)]; // 0.13-0.38

// src_marco_product / src_marco_datasheet
const TEMP_C: [number, number] = [-60, 205];
const DENSITY = 1.43; // Parker S0604-70 (assumption: S1000 states none)

const mid = (r: [number, number]) => r2((r[0] + r[1]) / 2);
const MEAN_D_MM = r2(ID_MM + CS_MM); // 74.53, centre-line diameter

const SIZE_TEXT =
  "Parker AS568A table, 2-040 (AS568 -040): nominal 2 7/8 x 3 x 1/16 in; I.D. 2.864 ± .020 in (72,75 ± 0,51 mm); W .070 ± .003 in (1,78 ± 0,08 mm); volume .0355 in³. Marco S1000-040: Size Code 040; Cross Section 0.070 in (1.78 mm); Inside Diameter 2.864 in (72.75 mm); Outside Diameter 3.004 in (76.31 mm).";

const FACE_GLAND_TEXT =
  "Parker Design Chart 4-2, face seal glands, O-ring sizes 004 through 050 (W .070 ± .003): gland depth .050 to .054; squeeze actual .013 to .023, 19 to 32 %; groove width .101 to .107 (liquids), .084 to .089 (vacuum and gases); groove radius .005 to .015 (in). Surface finish 32 for liquids, 16 for vacuum and gases (RMS). 'For External Pressure (inward pressure direction) dimension the groove by its inside diameter (H)i and width: (H)i = Mean I.D. of O-ring; Tolerance = Plus 1% of Mean I.D., but not more than +.060.' 'For Internal Pressure (outward pressure direction) dimension the groove by its outside diameter (HO) and width: (HO) = Mean O.D. of O-ring; Tolerance = Minus 1% of Mean O.D., but not more than -.060.'";

const CS_RANGE: [number, number] = [r2(CS_MM - CS_TOL_MM), r2(CS_MM + CS_TOL_MM)];

const AS568_040_SILICONE_BASE: ModuleDef = defineModule({
  id: "as568-040-silicone",
  name: "O-ring AS568-040, silicone 70A (72.75 x 1.78 mm)",
  version: "1.0.0",
  manufacturer: "Generic (SAE AS568)",
  part_number: "S1000-040 (Marco Sealing Solutions, AS568-040 silicone 70A, FDA)",
  description:
    "AS568 dash -040 O-ring in FDA silicone (VMQ), 70 Shore A: ID 72.75 ± 0.51 mm (2.864 in), cross section 1.78 ± 0.08 mm (0.070 in), OD 76.31 mm. -60 to 205 °C, static seals only. Documented SKU Marco S1000-040 (orange, FDA 21 CFR 177.2600). Smart bottle: the electronics lid face seal.",
  tags: ["standard-part", "seal", "o-ring", "as568", "as568-040", "silicone", "vmq", "70a", "fda", "face-seal", "smart-bottle"],
  categories: ["mechanical.seal"],

  interfaces: [
    {
      id: "face_seal",
      name: "Sealing face (bears on the counterface)",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["face_seal", "static_seal", "o_ring"],
      parameters: [
        { id: "o_ring_mean_diameter", name: "Centre-line diameter (ID + CS)", unit: "mm", value: MEAN_D_MM },
        { id: "o_ring_cross_section", unit: "mm", value: CS_MM, range: CS_RANGE },
        { id: "squeeze_static", name: "Face-gland squeeze (Parker Design Chart 4-2)", unit: "%", value: mid(SQUEEZE_PCT), range: SQUEEZE_PCT },
        { id: "hardness", unit: "Shore A", value: 70, range: [65, 75] },
      ],
      traits: [
        connectorTrait("o_ring_face_seal", {
          note: `The ring's -Z side in its CAD (frame origin on the axis at z = 0, normal -Z): it bears on a flat counterface, in the smart bottle the cap body rim under the lid. Uncompressed contact is a line on the Ø${MEAN_D_MM} centre line; squeezed ${SQUEEZE_PCT[0]}-${SQUEEZE_PCT[1]} % the footprint widens about it. The ring is symmetric, so the side is a naming convention.`,
        }),
        {
          type: "pin_functions",
          params: {
            description: `${SIZE_TEXT} Marco S1000: 'Hardness, Shore A 70 +/- 5'; 'Silicones are excellent seal materials for extreme temperature in static applications.' Parker Design Chart 4-2 (.070): squeeze actual .013 to .023 in, 19 to 32 %.`,
            source: [SRC.parker, SRC.product, SRC.datasheet],
          },
        },
      ],
    },
    {
      id: "gland",
      name: "Seat in the host's face groove (groove bottom and walls)",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["o_ring_gland", "as568_040"],
      parameters: [
        { id: "o_ring_inner_diameter", unit: "mm", value: ID_MM, range: [r2(ID_MM - ID_TOL_MM), r2(ID_MM + ID_TOL_MM)] },
        { id: "o_ring_cross_section", unit: "mm", value: CS_MM, range: CS_RANGE },
        { id: "o_ring_outer_diameter", name: "OD (ID + 2 x CS)", unit: "mm", value: OD_MM },
        { id: "gland_depth", name: "Face-gland depth (Parker Design Chart 4-2)", unit: "mm", value: mid(GLAND_DEPTH_MM), range: GLAND_DEPTH_MM },
        { id: "groove_width", name: "Face-groove width, liquids (Parker Design Chart 4-2)", unit: "mm", value: mid(WIDTH_LIQUID_MM), range: WIDTH_LIQUID_MM },
      ],
      traits: [
        connectorTrait("as568_o_ring_gland", {
          note: `The ring's +Z side and both flanks in its CAD (frame origin on the axis at z = ${CS_MM}, normal +Z): the bottom and walls of the host's face groove. With water outside (a lid) size the groove by its ID = ${ID_MM} mm (+1 %), so the inner flank locates; with pressure inside, by its OD = ${OD_MM} mm (-1 %). See the gland usage note.`,
        }),
        { type: "pin_functions", params: { description: `${SIZE_TEXT} ${FACE_GLAND_TEXT}`, source: [SRC.parker, SRC.product] } },
      ],
    },
  ],

  domains: [
    {
      domain: "mechanical",
      dimensions_mm: { length: OD_MM, width: OD_MM, height: CS_MM },
      // PB-797: no stated weight, so mass = CAD volume x density (an assumption)
      material: {
        name: "Silicone (VMQ) 70 Shore A, Marco compound S1000 (density of Parker S0604-70 used)",
        density_g_cm3: DENSITY,
        source: SRC.parker,
        assumption:
          "Marco's S1000 datasheet gives no specific gravity; Parker's 70A silicone S0604-70 (specific gravity 1.43, ORD 5700 p. 3-26) is used. Silicone compounds vary with filler, so the mass (about 0.83 g) is an estimate.",
      },
      metadata: {
        standard: "SAE AS568 (dash -040); Parker 2-040",
        nominal_size_in: "2 7/8 x 3 x 1/16",
        inner_diameter_mm: ID_MM,
        inner_diameter_tolerance_mm: ID_TOL_MM,
        cross_section_mm: CS_MM,
        cross_section_tolerance_mm: CS_TOL_MM,
        outer_diameter_mm: OD_MM,
        inner_diameter_in: 2.864,
        cross_section_in: 0.07,
        outer_diameter_in: 3.004,
        volume_mm3: VOLUME_MM3,
        hardness_shore_a: [65, 75],
        hardness_typical_shore_a: 68,
        colour: "orange (Marco S1000)",
        astm_d2000: "M7GE705 A19 B37 EA14 EO16 EO36 F19",
        cure: "peroxide",
        food_contact: "FDA 21 CFR 177.2600 (compound S1000)",
        dimensions_note: "Envelope = OD x OD x cross section, free state. Tolerances are for standard (AN) shrinkage compounds (Parker table note b).",
        source: [SRC.parker, SRC.product, SRC.datasheet],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: TEMP_C,
      metadata: {
        service_temperature_F: [-75, 400],
        low_temperature_test: "ASTM D2137 Method A (F19): non-brittle after 3 min at -55 °C, pass",
        heat_ageing: "ASTM D573 (A19), 70 h at 225 °C: hardness +3, tensile -9 %, elongation -26 % (typical)",
        source: [SRC.product, SRC.datasheet],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "seal",
        seal_type: "O-ring, static",
        standard_size: "AS568-040",
        material: "silicone (VMQ), 70 Shore A",
        compound: "Marco S1000",
        tensile_strength_psi: { min: 725, typical: 899 },
        ultimate_elongation_pct: { min: 150, typical: 219 },
        compression_set_pct: { max: 30, typical: 12, test: "ASTM D395 Method B (B37), 22 h at 175 °C; the datasheet prints 'ASTM D 325 Method B', read as D395, the compression-set method that B37 calls up" },
        water_resistance: { test: "ASTM D471 (EA14), 70 h at 100 °C water", hardness_change_typical: -2, volume_change_pct_typical: 3, limits: "±5 points, ±5 %" },
        source: [SRC.datasheet, SRC.product],
      },
    },
    {
      type: "operating_conditions",
      params: {
        temperature_C: TEMP_C,
        temperature_F: [-75, 400],
        service: "static seals only: 'Silicones are excellent seal materials for extreme temperature in static applications.' Parker: silicones have poor tear and wear resistance.",
        not_compatible: "superheated steam over 121 °C, acids and alkalis, low molecular weight chlorinated hydrocarbons (trichloroethylene), aromatic mineral oil, hydrocarbon based fuels, aromatic hydrocarbons (benzene, toluene) (Parker 2.2.17, silicone)",
        food_contact: "FDA 21 CFR 177.2600 for food and beverage contact (compound S1000)",
        source: [SRC.product, SRC.datasheet, SRC.parker],
      },
    },
    {
      type: "usage_note",
      params: {
        note: `Face seal gland for this ring (Parker Design Chart 4-2, .070 section): depth ${GLAND_DEPTH_MM[0]}-${GLAND_DEPTH_MM[1]} mm, giving ${SQUEEZE_MM[0]}-${SQUEEZE_MM[1]} mm (${SQUEEZE_PCT[0]}-${SQUEEZE_PCT[1]} %) squeeze; width ${WIDTH_LIQUID_MM[0]}-${WIDTH_LIQUID_MM[1]} mm for liquids (${WIDTH_GAS_MM[0]}-${WIDTH_GAS_MM[1]} mm for vacuum and gases); groove corner radius ${GROOVE_RADIUS_MM[0]}-${GROOVE_RADIUS_MM[1]} mm; 32 RMS finish for liquids. Water from outside (a lid): size the groove by its ID = ${ID_MM} mm (+1 %), so the groove OD is ${r2(ID_MM + 2 * WIDTH_LIQUID_MM[0])}-${r2(ID_MM + 2 * WIDTH_LIQUID_MM[1])} mm. Pressure from inside: size it by its OD = ${OD_MM} mm (-1 %). A rectangular face groove needs inside corner radii of at least 3 x the cross section (${r2(3 * CS_MM)} mm).`,
        source: SRC.parker,
      },
    },
    {
      type: "usage_note",
      params: {
        note: `AS568 tolerances are for standard (AN) shrinkage compounds. A silicone moulded in standard tooling can come out smaller: Parker's S0604-70 is shrinkage class I, which gives a 2-040 ID of 2.847 ± .023 in (${r2(2.847 * IN)} ± ${r2(0.023 * IN)} mm). Marco states the nominal ${ID_MM} x ${CS_MM} mm for S1000-040 without a class. Measure the rings bought before freezing a groove sized on the ID.`,
        source: [SRC.parker, SRC.product],
      },
    },
    {
      type: "usage_note",
      params: {
        note: `Smart bottle (examples/smart-bottle/docs component-selection.md, system.md): the electronics lid face seal, in a groove in the lid, squeezed against the cap body rim; six M2 screws into heat-set inserts close the lid, inside a cap of at most 80 mm diameter. With the groove sized for water from outside, its OD is about ${r2(ID_MM + 2 * WIDTH_LIQUID_MM[1])} mm, leaving about ${r2((80 - (ID_MM + 2 * WIDTH_LIQUID_MM[1])) / 2)} mm of wall to an 80 mm outside, and the brief's screw circle (76 mm) falls inside the groove band (${ID_MM}-${r2(ID_MM + 2 * WIDTH_LIQUID_MM[1])} mm). Either the screws move inside the seal, where each lid hole opens into the sealed space and needs its own seal (for example a sealing washer under the head), or the cap grows to put them outside it, or a smaller dash size is used. The enclosure track decides; nothing here is a sourced fact about the bottle.`,
        quantity_per_bottle: 1,
      },
    },
    {
      type: "assumption",
      params: {
        field: "supplier and compound",
        value: "Marco S1000-040 (FDA silicone 70A) as the representative SKU",
        reason: "The brief names no supplier ('any AS568 supplier', grade chosen by the enclosure track, OQ-B5). S1000-040 is a documented ring of the right size and material with a stated temperature range and FDA compliance; another supplier's 70A silicone -040 needs its own temperature and food-contact facts.",
        source: SRC.product,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD state",
        value: "free (uncompressed, unstretched) at nominal ID and CS",
        reason: "The cited dimensions are for the free ring. In the gland the section squeezes 19-32 % axially; the frames sit on the free faces and the axis, so they do not depend on that.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Marco's S1000-040 page has a specification table and a material datasheet, no CAD download; no other vendor CAD was sought. An O-ring is a torus fully defined by ID and CS, so the body is generated at nominal size (library/cad/py/catalog/as568-040-silicone.py).",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["density of compound S1000", "shrinkage class of S1000", "SAE AS568 document"],
        note: "Marco states no specific gravity or shrinkage class for S1000. SAE AS568 is paywalled; the size comes from Parker's AS568A table and two corroborating charts.",
      },
    },
  ],

  artifacts: [
    { id: "art_parker_handbook", name: "Parker O-Ring Handbook ORD 5700A (AS568A sizes, face seal glands)", type: "datasheet", url: SRC.parker },
    { id: "art_product_page", name: "Marco S1000-040 O-ring, AS568-040, silicone 70A, FDA", type: "documentation", url: SRC.product },
    { id: "art_material_datasheet", name: "Marco S1000 material summary", type: "datasheet", url: SRC.datasheet },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the AS568 size by
// library/cad/py/catalog/as568-040-silicone.py — exact to nominal, not
// manufacturer CAD. Ring axis on Z, lying on z = 0 (spans z 0..1.78), as
// as568-138-silicone.
// ---------------------------------------------------------------------------

export const AS568_040_SILICONE: ModuleDef = withGeometry(
  AS568_040_SILICONE_BASE,
  {
    // the counterface comes from -Z onto the seal face
    face_seal: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1] },
      refs: [feature("seal_face", { area_mm2: 327.334, centroid: [0.0, 0.0, 0.089] }), own("seal_face")],
    },
    // the groove bottom comes from +Z; the inner flank locates on the groove's inner wall
    gland: {
      frame: { origin: [0, 0, CS_MM], normal: [0, 0, 1] },
      refs: [
        feature("gland_face", { area_mm2: 327.334, centroid: [0.0, 0.0, 1.691] }),
        feature("inner_face", { area_mm2: 320.295, centroid: [0.0, 0.0, 0.89] }),
        feature("outer_face", { area_mm2: 334.372, centroid: [0.0, 0.0, 0.89] }),
        own("gland_face"),
        own("inner_face"),
        own("outer_face"),
      ],
    },
  },
  cadArtifacts({
    dir: "library/parts/as568-040-silicone/artifacts/cad",
    name: "as568-040-silicone",
    generator: "library/cad/py/catalog/as568-040-silicone.py",
    tool: "build123d 0.13.0",
    interfaces: ["seal_face", "gland_face", "inner_face", "outer_face"],
  }),
);

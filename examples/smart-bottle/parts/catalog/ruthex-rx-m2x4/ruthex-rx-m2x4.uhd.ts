/**
 * ruthex RX-M2x4 brass heat-set thread insert, M2 x 4.0 mm (order no.
 * GE-M2x04-001, pack of 70) — datasheet-honest UHD part.
 *
 * Sources (see ./ruthex-rx-m2x4/sources.json):
 *   - src_product:    ruthex RX-M2x4 product page — https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen
 *                     (its Shopify JSON, src_product_json, is the hashed copy)
 *   - src_drawing:    ruthex dimension drawing and size table (product image) — https://cdn.shopify.com/s/files/1/0567/7019/9760/files/1Tabelle.PT05_eb2a30fa-5c34-46f8-b557-a6c432354560.jpg?v=1748341911
 *   - src_pack_label: ruthex M2 pack label (product image) — https://cdn.shopify.com/s/files/1/0567/7019/9760/files/out-50xGE-M2x04-001.jpg?v=1784916330
 *   - src_dimensions: 3DJake listing, the ruthex table as text (cross-check) — https://www.3djake.com/ruthex/threaded-insert-m2-70-pieces
 *   - src_cad:        ruthex RX-M2x4 STEP (measured, not redistributed) — https://cdn.shopify.com/s/files/1/0567/7019/9760/files/ruthex_RX-M2x4.step?v=1621264078
 *   - src_cad_page:   ruthex CAD data page — https://www.ruthex.de/en/pages/cad-daten
 *
 * Modelling notes:
 *   - Two interfaces, both protocol "custom", role "peer": no fastener or
 *     heat-set protocol exists in the vocabulary (gap in .research/gaps.json),
 *     the same approach as iso-10511-m3-nyloc-nut.
 *       `thread`: the M2 internal thread a screw enters, with
 *       fastener_diameter 2 and `length` 4.0 (the insert length L; the thread
 *       runs through). Pitch 0.4 is measured from the ruthex STEP; ruthex
 *       states only "M2".
 *       `seat`: the knurled body melted into a Ø3.2 hole in a thermoplastic
 *       part. The ruthex drawing defines Ød1 as the insert's outer diameter,
 *       Ød2 as its far-end (pilot) diameter, Ød3 as the hole in the plastic
 *       part, min. w as the wall around it and the blind-hole depth as
 *       L + 1 mm min (5.0 mm on the M2 pack label).
 *   - The dimension table (D1 3.6, D2 3.1, D3 3.2, L 4.0, W min 1.3) is from
 *     the ruthex drawing image; the 3DJake listing gives the same values as
 *     text. The ruthex STEP agrees on D1 and L, but its pilot is Ø3.20, not
 *     the drawn D2 3.1 (source_discrepancy trait); the body follows the STEP.
 *   - CAD: ruthex publishes a STEP but states no terms on its pages; its CC BY
 *     4.0 Thingiverse upload could not be fetched and compared, so the STEP is
 *     not redistributed. The body is generated (library/cad/py/catalog/
 *     ruthex-rx-m2x4.py) from the table and the STEP's measured profile, entry
 *     face at z = 0 and body along +Z like the library's nut (data_gap and
 *     assumption traits).
 *   - Not electrical: brass, but no source treats it as a conductor, so there
 *     are no pins, package or pin table.
 *   - Mass: not stated; CAD volume x brass density (material.assumption).
 *   - No operating temperature in the sources (data_gap); the verify
 *     "coverage" thermal warning is expected.
 *   - Role: 4 in the wearable watch (back cover fastening) and 6 in the smart
 *     bottle cap (lid fastening), each with an M2 x 6 pan-head screw
 *     (iso-7045-m2x6-a2).
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { connectorTrait, defineModule, fastenerDiameterMm } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  product: "https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen",
  productJson: "https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen.json",
  drawing: "https://cdn.shopify.com/s/files/1/0567/7019/9760/files/1Tabelle.PT05_eb2a30fa-5c34-46f8-b557-a6c432354560.jpg?v=1748341911",
  packLabel: "https://cdn.shopify.com/s/files/1/0567/7019/9760/files/out-50xGE-M2x04-001.jpg?v=1784916330",
  dimensions: "https://www.3djake.com/ruthex/threaded-insert-m2-70-pieces",
  cad: "https://cdn.shopify.com/s/files/1/0567/7019/9760/files/ruthex_RX-M2x4.step?v=1621264078",
  cadPage: "https://www.ruthex.de/en/pages/cad-daten",
  cadThingiverse: "https://www.thingiverse.com/thing:4682424",
  installGuide: "https://www.cnckitchen.com/blog/tipps-amp-tricks-fr-gewindeeinstze-im-3d-druck-3awey",
  density: "https://www.engineeringtoolbox.com/metal-alloys-densities-d_50.html",
} as const;

const RUTHEX_RX_M2X4_BASE: ModuleDef = defineModule({
  id: "ruthex-rx-m2x4",
  name: "ruthex RX-M2x4 brass heat-set insert, M2 x 4.0 mm",
  version: "1.0.0",
  manufacturer: "ruthex",
  part_number: "GE-M2x04-001",
  description:
    "Brass thread insert RX-M2x4 for 3D-printed thermoplastic parts, set by heat (soldering iron) or ultrasound into blind or through holes. M2 internal thread, length 4.0 mm, outer Ø3.6 mm (D1) with opposed spiral knurls, far-end pilot Ø3.1 mm (D2), for a Ø3.2 mm hole (D3) at least 5.0 mm deep (L + 1) with a 1.3 mm minimum wall. Lead-free, cadmium-free brass. Sold 70 per pack (GE-M2x04-001). Used 4 per wearable watch and 6 per smart-bottle cap with M2 x 6 screws.",
  tags: ["fastener", "insert", "heat-set-insert", "threaded-insert", "m2", "brass", "3d-printing"],
  categories: ["mechanical.fastener.insert"],

  interfaces: [
    {
      id: "thread",
      name: "M2 internal thread",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["fastener", "internal_thread"],
      parameters: [fastenerDiameterMm(2), { id: "length", unit: "mm", value: 4 }],
      traits: [
        connectorTrait("metric_thread_internal", {
          gender: "female",
          note: "M2 internal thread through the full 4.0 mm length (pitch 0.4, coarse, measured from the ruthex STEP). `length` is the insert length L. The screw enters at the entry face (frame origin), which is left flush with the host part's surface. Mates with an M2 screw such as iso-7045-m2x6-a2; thread engagement is the screw length past the clamped part, up to 4.0 mm.",
        }),
        {
          type: "pin_functions",
          params: {
            description: "Thread size M2; L 4.0 (mm). 'RX-M2x4 with a M2 internal thread and one Length of 4.0 mm.'",
            source: [SRC.product, SRC.drawing, SRC.dimensions],
          },
        },
      ],
    },
    {
      id: "seat",
      name: "Knurled body in a Ø3.2 mm hole",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["heat_set_insert", "thermoplastic_host"],
      parameters: [
        { id: "hole_diameter", unit: "mm", value: 3.2 },
        { id: "hole_depth_min", unit: "mm", value: 5 },
        { id: "outer_diameter", unit: "mm", value: 3.6 },
        { id: "wall_thickness_min", unit: "mm", value: 1.3 },
        { id: "insert_length", unit: "mm", value: 4 },
      ],
      traits: [
        {
          type: "pin_functions",
          params: {
            description:
              "ruthex size table, M2: Ød1 3.6 (outer), Ød2 3.1 (far-end pilot), Ød3 3.2 (hole in the plastic part, blind or through), L 4.0, W 1.3 (min. wall around the hole) (mm). Blind-hole depth L + 1 mm min; the M2 pack label gives 5.0 mm min. Opposite spiral knurled surfaces. Inserted by heat or ultrasound into blind and through holes in PLA, PETG, ABS, PP, PPS and other thermoplastics.",
            source: [SRC.drawing, SRC.packLabel, SRC.product, SRC.dimensions],
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
        name: "Brass (lead-free, cadmium-free; alloy not stated)",
        density_g_cm3: 8.5,
        source: SRC.density,
        assumption:
          "ruthex names no alloy; 8.5 g/cm³ is within the table's rolled-and-drawn brass range (8.43-8.73) and near 60/40 brass (8.52). The CAD body is the generated nominal shape (19.23 mm³, plain Ø2.0 bore), about 8 % less than the ruthex STEP's 20.95 mm³ with its thread form, so the computed mass (≈ 0.16 g) is about 0.02 g low. Sanity check: ruthex lists a 15 g shipping weight per 70-pack, packaging included, so at most about 0.21 g per insert.",
      },
      dimensions_mm: { length: 3.6, width: 3.6, height: 4 },
      metadata: {
        thread: "M2 (pitch 0.4 from the ruthex STEP)",
        d1_outer_mm: 3.6,
        d2_mm: 3.1, // far-end (pilot) diameter, ruthex drawing
        d3_hole_mm: 3.2,
        hole_depth_min_mm: 5.0,
        length_l_mm: 4.0,
        wall_min_w_mm: 1.3,
        material: "brass, lead-free and cadmium-free (RoHS, REACH)",
        knurl: "opposed spiral knurls, two bands",
        pack_quantity: 70,
        pack_shipping_weight_g: 15,
        ean: "4260528721122",
        source: [SRC.drawing, SRC.packLabel, SRC.productJson, SRC.dimensions, SRC.cad],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "fastener",
        fastener_type: "heat-set threaded insert for thermoplastics",
        thread: "M2",
        length_mm: 4.0,
        material: "brass",
        installation: "heat (soldering iron) or ultrasound; blind or through holes; reusable (can be removed and reinserted)",
        source: [SRC.product, SRC.productJson, SRC.dimensions],
      },
    },
    {
      type: "usage_note",
      params: {
        note:
          "Host design: Ø3.2 mm hole (D3) with at least 1.3 mm of wall around it (W min), blind or through. ruthex gives the blind-hole depth as L + 1 mm min, 5.0 mm for this insert. ruthex gives no iron temperature; general heat-set guidance from CNC Kitchen (a different insert maker) is an iron 10-20 °C above the print temperature (about 245 °C for PETG). Set the insert with its entry face flush with the host face. With an M2 x 6 screw, a clamped part thinner than 2.0 mm lets the screw pass the insert's far end, which needs that clearance below it.",
        source: [SRC.drawing, SRC.packLabel, SRC.product, SRC.installGuide],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Wearable watch: 4 inserts for the back cover fastening. Smart bottle: 6 inserts for the cap lid, on a 76 mm circle (the brief's assumption). Both with iso-7045-m2x6-a2 screws.",
        quantity_watch: 4,
        quantity_bottle: 6,
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "D2",
        values: ["D2 3.1 mm (the far-end pilot, ruthex drawing and pack label)", "pilot Ø3.20 in the ruthex STEP (z 3.4-3.9, chamfered to Ø3.0 at the far end)"],
        sources: [SRC.drawing, SRC.packLabel, SRC.cad],
        resolution: "D2 3.1 is recorded as the drawn pilot diameter (metadata.d2_mm and the seat trait). The generated body uses Ø3.20, as in the STEP, because the STEP is ruthex's own 3D model of this insert and gives the whole profile the body is built from, while the drawing gives one nominal value; Ø3.1 sits between the STEP's Ø3.20 pilot and its Ø3.0 end chamfer. The 0.1 mm does not change the host design, which uses D3.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "ruthex publishes a STEP (src_cad, from the product page and the CAD data page), but neither page states terms. ruthex's Thingiverse upload of its insert STEP set (thing:4682424) is CC BY 4.0, but its files need a login and were not compared, so the STEP was used as measured evidence only. Generated body: library/cad/py/catalog/ruthex-rx-m2x4.py.",
        source: [SRC.cad, SRC.cadPage, SRC.cadThingiverse],
      },
    },
    {
      type: "assumption",
      params: {
        field: "generated body",
        value: "12-tooth knurl bands with a 4° flat crest and a V root at a constant twist (upper -50° over 1.0 mm, lower +40° over 0.9 mm, then a plain cone); plain Ø2.0 bore with no thread form",
        reason: "Tooth count, crest and root diameters and twist rates are measured from the ruthex STEP; the tooth shape is simplified. The bore is nominal M2 (the STEP's thread runs Ø1.62 minor to Ø2.07 major) so a modelled screw shank fits it, as the library's nut does.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["mass", "brass alloy", "pull-out force", "torque-out", "tightening torque", "operating temperature", "installation temperature"],
        note: "Not stated by ruthex or on the 3DJake listing (a 3DJake customer question about the weight is unanswered; the ruthex 15 g per 70-pack is a shipping weight with packaging).",
      },
    },
  ],

  artifacts: [
    { id: "art_product_page", name: "ruthex RX-M2x4 product page", type: "documentation", url: SRC.product },
    { id: "art_drawing", name: "ruthex insert dimension drawing and size table", type: "datasheet", url: SRC.drawing },
    { id: "art_dimensions", name: "3DJake ruthex M2 insert listing (dimension table, cross-check)", type: "documentation", url: SRC.dimensions },
    { id: "art_vendor_step", name: "ruthex RX-M2x4 STEP (not redistributed)", type: "cad", url: SRC.cad },
  ],
});

// ---------------------------------------------------------------------------
// Geometry (PB-775): representative CAD generated by
// library/cad/py/catalog/ruthex-rx-m2x4.py from the ruthex drawing and the
// ruthex STEP's measured profile — not the manufacturer file. Frames are in
// the body's coordinates (mm): axis Z, entry face at z = 0, body z 0..4.
// Both frames sit on the entry face with the normal out of it (-Z), the
// direction the screw comes from and the side the host's surface faces.
// ---------------------------------------------------------------------------

export const RUTHEX_RX_M2X4: ModuleDef = withGeometry(
  RUTHEX_RX_M2X4_BASE,
  {
    thread: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1] },
      refs: [feature("thread", { area_mm2: 24.662, centroid: [0.0, 0.0, 2.037] }), own("thread")],
    },
    seat: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1] },
      refs: [
        feature("seat", { area_mm2: 5.027, centroid: [0.0, 0.0, 3.65] }),
        feature("entry_face", { area_mm2: 5.16, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
        own("seat"),
      ],
    },
  },
  cadArtifacts({
    dir: "library/parts/ruthex-rx-m2x4/artifacts/cad",
    name: "ruthex-rx-m2x4",
    generator: "library/cad/py/catalog/ruthex-rx-m2x4.py",
    tool: "build123d 0.13.0",
    interfaces: ["thread", "seat", "entry_face"],
  }),
);

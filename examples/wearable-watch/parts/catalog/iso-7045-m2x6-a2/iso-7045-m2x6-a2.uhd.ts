/**
 * ISO 7045 (DIN 7985 Z) M2 x 6 mm pan head screw, type Z (Pozi) cross
 * recess, A2 stainless (Accu SPP-M2-6-A2) — datasheet-honest UHD part.
 *
 * Sources (see ./iso-7045-m2x6-a2/sources.json):
 *   - src_product:  Accu SPP-M2-6-A2 product page — https://www.accu.co.uk/pozi-pan-head-screws/9242-SPP-M2-6-A2
 *   - src_spec:     Accu technical data sheet, SPP-M2-6-A2 — https://www.accu.co.uk/api/product-datasheet?id=9242
 *   - src_iso:      ISO 7045:1994 Table 1 and Figure 1 (iTeh preview) — https://cdn.standards.iteh.ai/samples/13608/caed16a7f73145ffab7712aa5196142c/ISO-7045-1994.pdf
 *   - src_farnell:  Farnell PoziDriv pan head table (DIN 7985 / ISO 7045) — https://www.farnell.com/datasheets/11792.pdf
 *   - src_material: thyssenkrupp 304 / 1.4301 data sheet (density) — https://www.thyssenkrupp-materials.co.uk/stainless-steel-304-14301.html
 *
 * Modelling notes:
 *   - Generic standard part. manufacturer = "Generic (ISO 7045 / DIN 7985 Z)";
 *     part_number is the Accu product code named in the watch and bottle
 *     briefs. Any ISO 7045 / DIN 7985 Z M2 x 6 A2 Pozi pan head screw is
 *     equivalent, within the head height difference below.
 *   - Three mechanical interfaces, all protocol "custom" because the
 *     vocabulary has no fastener / threaded-joint protocol (vocabulary gap in
 *     .research/gaps.json; same choice as iso-4762-m3x30-socket-head-cap-screw):
 *       `thread`       the M2 x 0.4 external thread, 6 mm under the head (role peer);
 *       `head_bearing` the annular under-head face that clamps the fastened part (role peer);
 *       `drive`        the PZ0 cross recess the screwdriver engages (role input).
 *     `thread` carries the canonical fastener_diameter and the `length`
 *     parameter that fastener stacks read; it is the first interface on
 *     purpose.
 *   - Head height: Accu states 1.72 mm (+0/-0.26) while ISO 7045 gives
 *     1.60 mm max. Accu stocks to DIN 7985 Z, whose M2 head is taller (Farnell:
 *     DIN 1.7, ISO 1.6). The part models the screw bought (source_discrepancy
 *     trait).
 *   - Mass is Accu's 19 g per 100 (weight_g 0.19), not the CAD volume: the
 *     CAD shank is a plain Ø2.0 cylinder, heavier than a rolled thread.
 *     ISO's informative 0.233 g is for steel and the ISO head
 *     (source_discrepancy trait).
 *   - Used 4 per watch (back cover) and 6 per bottle (lid), each into a
 *     ruthex RX-M2x4 heat-set insert (examples/wearable-watch and
 *     examples/smart-bottle component-selection.md). The joint harnesses
 *     (watch-back-cover-screws, bottle-lid-screws) own the stack-up.
 *   - Not electrical: no package, pins or pin table.
 *   - No torque, proof load or temperature rating in the sources (data_gap);
 *     the verify "coverage" thermal warning is expected.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { connectorTrait, defineModule, fastenerDiameterMm } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  product: "https://www.accu.co.uk/pozi-pan-head-screws/9242-SPP-M2-6-A2",
  spec: "https://www.accu.co.uk/api/product-datasheet?id=9242",
  iso: "https://cdn.standards.iteh.ai/samples/13608/caed16a7f73145ffab7712aa5196142c/ISO-7045-1994.pdf",
  farnell: "https://www.farnell.com/datasheets/11792.pdf",
  material: "https://www.thyssenkrupp-materials.co.uk/stainless-steel-304-14301.html",
} as const;

const D_MM = 2; // M2 (src_spec)
const PITCH_MM = 0.4; // src_spec, src_iso P
const L_MM = 6; // under the head (src_spec)
const DK_MM = 4; // head diameter, +0/-0.3 (src_spec); ISO 4.0 max, 3.7 min
const K_MM = 1.72; // head height of the part bought, +0/-0.26 (src_spec); ISO 1.60 max
const A_MAX_MM = 0.8; // thread runout under the head (src_iso a max)

const ISO_7045_M2X6_A2_BASE: ModuleDef = defineModule({
  id: "iso-7045-m2x6-a2",
  name: "M2 x 6 mm Pozi pan head screw, ISO 7045 / DIN 7985 Z, A2 stainless",
  version: "1.0.0",
  manufacturer: "Generic (ISO 7045 / DIN 7985 Z)",
  part_number: "SPP-M2-6-A2",
  description:
    "Pan head machine screw with type Z (Pozi) cross recess, ISO 7045 / DIN 7985 Z, M2 x 0.4 x 6 mm, A2 stainless steel. Head Ø4.0 mm (+0/-0.3) x 1.72 mm (+0/-0.26), PZ0 drive, threaded up to the head, 0.19 g. Used 4 per wearable watch (back cover) and 6 per smart bottle (lid), into M2 heat-set inserts.",
  tags: ["standard-part", "fastener", "screw", "pan-head-screw", "pozi", "pz0", "m2", "iso-7045", "din-7985", "stainless", "a2"],
  categories: ["mechanical.fastener.screw"],

  interfaces: [
    {
      id: "thread",
      name: "M2 x 0.4 external thread, 6 mm",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["fastener", "external_thread"],
      parameters: [fastenerDiameterMm(D_MM), { id: "length", unit: "mm", value: L_MM, range: [5.76, 6.24] }],
      traits: [
        connectorTrait("metric_thread_external", {
          gender: "male",
          note: `M${D_MM} x ${PITCH_MM} coarse thread; nominal length ${L_MM} mm measured under the head (ISO limits 5.76-6.24). Threaded up to the head: the full thread runs at least b = l - a = ${L_MM - A_MAX_MM} mm from the end (a max ${A_MAX_MM} mm runout). Mates with an M2 internal thread: a heat-set insert (ruthex-rx-m2x4), a nut or a tapped M2 hole.`,
        }),
        {
          type: "pin_functions",
          params: {
            description:
              "Thread Size M2 (2 mm); Length (L) 6 mm; Thread Pitch 0.4 mm. ISO 7045 Table 1, M2: P 0,4; a max 0,8; b min 25; l = 6: min 5,76, max 6,24; footnote 3: screws with nominal lengths above the bold dotted line are threaded up to the head; b = l - a.",
            source: [SRC.spec, SRC.iso],
          },
        },
      ],
    },
    {
      id: "head_bearing",
      name: "Under-head bearing face, Ø4.0 pan head",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["fastener", "bearing_face"],
      parameters: [{ id: "head_diameter", unit: "mm", value: DK_MM, range: [3.7, 4.0] }],
      traits: [
        {
          type: "pin_functions",
          params: {
            description:
              "Head Diameter (D) 4 mm, Tolerance: +0/-0.3 mm; Head Height (H) 1.72 mm, Tolerance: +0/-0.26 mm. ISO 7045 Table 1, M2: dk nom. = max. 4,0, min. 3,7; da max 2,6; r min 0,1.",
            source: [SRC.spec, SRC.iso],
          },
        },
      ],
    },
    {
      id: "drive",
      name: "PZ0 Pozi cross recess",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["input"] }],
      capabilities: ["drive_recess", "pozidriv"],
      traits: [
        {
          type: "pin_functions",
          params: {
            description:
              "Drive Size PZ0. ISO 7045 Table 1, M2: Recess No. 0; Type Z: m ref. 2,1, penetration max. 1,42, min. 1,17.",
            source: [SRC.spec, SRC.iso],
          },
        },
      ],
    },
  ],

  domains: [
    {
      domain: "mechanical",
      dimensions_mm: { length: L_MM + K_MM, width: DK_MM, height: DK_MM },
      weight_g: 0.19,
      material: {
        name: "A2 stainless steel (304 / 1.4301 family)",
        density_g_cm3: 8.0,
        source: SRC.material,
        assumption:
          "Accu states only 'Stainless Steel - (A2)'; A2 is taken as the 304 / 1.4301 family for the density (ISO 3506 not consulted). weight_g (Accu, 19 g per 100) is the mass; the CAD body is nominal geometry with a plain Ø2.0 shank and is heavier.",
      },
      metadata: {
        thread: "M2 x 0.4",
        nominal_length_mm: L_MM,
        length_limits_mm: [5.76, 6.24],
        threaded_to_head: true,
        head_diameter_mm: DK_MM,
        head_diameter_tolerance_mm: "+0/-0.3",
        head_height_mm: K_MM,
        head_height_tolerance_mm: "+0/-0.26",
        head_height_iso_max_mm: 1.6,
        head_top_radius_rf_mm: 3.2,
        drive: "PZ0 (type Z cross recess No. 0)",
        recess_m_ref_mm: 2.1,
        recess_penetration_mm: [1.17, 1.42],
        thread_runout_a_max_mm: A_MAX_MM,
        standard: "ISO 7045 / DIN 7985 Z",
        material: "A2 stainless steel, natural finish",
        weight_per_100_g: 19,
        compliance: ["RoHS", "REACH", "certificate of conformity supplied"],
        dimensions_note: "Envelope = 6 mm length + 1.72 mm head height; width = head diameter 4.0 mm.",
        source: [SRC.product, SRC.spec, SRC.iso],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "fastener",
        fastener_type: "pan head screw, type Z (Pozi) cross recess",
        standard: "ISO 7045 / DIN 7985 Z",
        thread: "M2 x 0.4",
        length_mm: L_MM,
        drive: "PZ0",
        material: "A2 stainless steel",
        source: [SRC.product, SRC.spec],
      },
    },
    {
      type: "usage_note",
      params: {
        note:
          "Wearable watch: 4 per back cover. Smart bottle: 6 per lid, compressing the lid face seal. Each screw goes into a ruthex RX-M2x4 heat-set insert; the fastened part sits between head_bearing and the insert, so its thickness plus the engaged thread equals the 6 mm under-head length. Drive with a PZ0 Pozi bit (Drive Size PZ0). Quantities are from the project briefs (examples/wearable-watch/docs/component-selection.md, examples/smart-bottle/docs/component-selection.md); the joint harnesses own the stack-up and torque.",
        quantity_per_watch: 4,
        quantity_per_bottle: 6,
        source: SRC.spec,
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "head height",
        values: ["1.72 mm +0/-0.26 (Accu SPP-M2-6-A2)", "1.60 mm max, 1.46 mm min (ISO 7045 Table 1)"],
        sources: [SRC.spec, SRC.iso, SRC.farnell],
        resolution:
          "Accu stocks to DIN 7985 Z, whose M2 head is taller (Farnell: head H max DIN 1.7, ISO 1.6). The part and its CAD use Accu's 1.72 mm, the envelope of the screw bought; an ISO-dimensioned screw is up to 0.12 mm lower, which only adds clearance.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "mass",
        values: ["0.19 g (Accu: 19 g per 100 units)", "0.233 g (ISO 7045 Table 1: 0,233 kg per 1000 pieces, steel at 7,85 kg/dm3, for information only)"],
        sources: [SRC.spec, SRC.iso],
        resolution: "weight_g uses Accu's stated mass for the part bought. ISO's figure is informative only.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "ISO 7045 edition",
        value: "M2 dimensions from ISO 7045:1994 (second edition)",
        reason:
          "ISO 7045:2011 is the current edition and was not fetched; only the 1994 text is available as a free preview. The 2011 M2 values are taken to be the same. The Accu data sheet agrees with the 1994 table on thread, pitch, head diameter and recess size.",
        source: SRC.iso,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD simplifications",
        value:
          "plain Ø2.0 shank (thread major diameter, no thread form) with a flat end; under-head radius (r min 0.1) and transition diameter (da max 2.6) not modelled; head top radius rf = 3.2 (ISO 'approximately'); Pozi recess modelled as a plain cross of two 2.1 x 0.45 mm slots, 1.3 mm deep from the crown",
        reason:
          "ISO 7045 shows an 'as rolled end' with no dimensions, gives only m (2.1 ref) and penetration (1.17-1.42) for the type Z recess, and leaves the full recess form to ISO 4757 (not consulted). The slot width is assumed; the depth is the middle of the penetration range. None of these change the thread, bearing face or envelope the interfaces use.",
        source: SRC.iso,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note:
          "Accu offers STL / STP / IGS models only after signing in to an Accu account; no supplier account may be used, so they were not downloaded and their terms are unknown. ISO and Farnell publish drawings only. Geometry is generated from ISO 7045 Table 1 and the Accu data sheet (library/cad/py/catalog/iso-7045-m2x6-a2.py).",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["tightening torque", "proof load / property class", "operating temperature", "recess form (ISO 4757)"],
        note: "Not stated by Accu, Farnell or the ISO 7045 preview (mechanical properties are by reference to ISO 3506, not consulted).",
      },
    },
  ],

  artifacts: [
    { id: "art_product_page", name: "Accu SPP-M2-6-A2 M2 x 6 Pozi pan head screw, A2", type: "documentation", url: SRC.product },
    { id: "art_spec", name: "Accu technical data sheet, SPP-M2-6-A2", type: "datasheet", url: SRC.spec },
    { id: "art_standard", name: "ISO 7045:1994 pan head screws, type H or type Z cross recess (preview)", type: "documentation", url: SRC.iso },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD generated from ISO 7045 Table 1 and the Accu
// data sheet by library/cad/py/catalog/iso-7045-m2x6-a2.py — not
// manufacturer CAD. Screw axis on Z, origin on the axis in the under-head
// plane, shank in +Z (0..6), head in -Z (crown at z = -1.72), as the other
// fasteners, so a fastener stack places it by its origin and +Z.
// ---------------------------------------------------------------------------

export const ISO_7045_M2X6_A2: ModuleDef = withGeometry(
  ISO_7045_M2X6_A2_BASE,
  {
    // same frame convention as iso-4762-m3x30-socket-head-cap-screw's thread
    thread: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1] },
      refs: [feature("thread", { area_mm2: 37.699, centroid: [0.0, 0.0, 3.0] }), own("thread")],
    },
    // the clamped part's top face meets this one: normal out of the bearing face, toward the shank
    head_bearing: {
      frame: { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("head_bearing", { area_mm2: 9.425, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0] }), own("head_bearing")],
    },
    // the driver comes from -Z onto the crown; xAxis along one recess arm, the cross repeats every 90°
    drive: {
      frame: { origin: [0, 0, -K_MM], normal: [0, 0, -1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("drive", { area_mm2: 11.744, centroid: [0.0, 0.0, -0.934] }), own("drive")],
    },
  },
  cadArtifacts({
    dir: "library/parts/iso-7045-m2x6-a2/artifacts/cad",
    name: "iso-7045-m2x6",
    generator: "library/cad/py/catalog/iso-7045-m2x6-a2.py",
    tool: "build123d 0.13.0",
    interfaces: ["thread", "head_bearing", "drive"],
  }),
);

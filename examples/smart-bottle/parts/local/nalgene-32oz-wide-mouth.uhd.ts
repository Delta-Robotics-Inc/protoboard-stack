/**
 * Nalgene 32oz Wide Mouth Bottle, Tritan Renew, 63 mm cap (2020-xx32 for most colours) — datasheet-honest UHD part.
 *
 * Project-researched part (parts/local; docs/specs/tool-integrations.md §6 in the
 * Protoboard Stack), copied from the parts library workspace (commit 9a80317) with
 * its evidence (parts/evidence/nalgene-32oz-wide-mouth/) and generated CAD (parts/local/nalgene-32oz-wide-mouth/).
 *
 * Sources (see parts/evidence/nalgene-32oz-wide-mouth/sources.json):
 *   - src_product:    Nalgene 32oz Wide Mouth Bottle product page — https://nalgene.com/product/32oz-wide-mouth-bottle/
 *   - src_cap:        Nalgene Wide Mouth Cap product page — https://nalgene.com/product/wide-mouth-cap/
 *   - src_faq:        Nalgene FAQ — https://nalgene.com/faq/
 *   - src_hot_water:  Nalgene "Can You Put Boiling Water in a Nalgene?" — https://nalgene.com/hot-water-in-a-nalgene/
 *   - src_brochure:   Thermo Scientific Nalgene Bottles and Carboys brochure D01705 — https://assets.thermofisher.com/TFS-Assets/LSG/brochures/D01705.pdf
 *   - src_closure:    Thermo Scientific Nalgene 63 mm replacement closure 712150-0630 — https://www.thermofisher.com/order/catalog/product/712150-0630
 *   - src_lab_bottle: Thermo Scientific Nalgene 1 L wide-mouth HDPE bottle 312104-0032 — https://www.thermofisher.com/order/catalog/product/312104-0032
 *   - src_spi:        SPI neck finish table for standard closures — https://www.plastcaps.com/spi-neck-finish-specifications-for-standard-closures-2-4.htm
 *
 * Modelling notes:
 *   - A purchased mechanical part. Its interfaces are what a closure mates
 *     with: `neck_thread` (the external 63 mm thread), `lip_seal` (the top
 *     land and the inner chamfer a seal bears on), `mouth` (the bore a probe
 *     or a sensor's view passes through) and `base` (the standing face).
 *     There is no electrical, network or fluid-port function.
 *   - Nalgene gives the body size, mass, the 63 mm cap size and the thread
 *     form ("continuous, straight shouldered semi-buttress") but no neck
 *     dimensions. The thread numbers are the SPI 63 mm finish [src_spi] and
 *     the bore is Thermo's lab bottle with the same finish [src_lab_bottle];
 *     the seal and torque facts are Thermo's Nalgene lab line
 *     [src_brochure]. That the consumer bottle shares the lab 63 mm finish is
 *     itself an assumption: Thermo's 63 mm closure fits narrow- and
 *     wide-mouth Nalgene bottles [src_closure], which supports it but does
 *     not prove it. Every such value is an `assumption` trait. Measure the
 *     purchased bottle (T, E, H, S, I, pitch, thread start, turns, profile,
 *     lip) before a cap thread is frozen (smart-bottle OQ-B4) and record the
 *     measurements as evidence here.
 *   - The SPI table gives H only for the 400 series at 63 mm and no 415 H,
 *     while the brochure names the closure "63-415". The 400 H is used
 *     (assumption trait "finish height H").
 *   - No fastener, closure-thread or seal protocol exists in the vocabulary
 *     (.research/gaps.json): `neck_thread` and `lip_seal` are `custom` peer
 *     with a `connector` trait, like the fasteners. `fastener_diameter` 63
 *     is the nominal closure size, so a cap declaring the same id pairs in
 *     DRC; the measured-style diameters are separate parameters.
 *   - Mass is stated (177.25 g), so no material density is declared.
 *   - Temperature: Nalgene gives a maximum liquid temperature of 100 °C
 *     (boiling water poured in, never heated in the bottle) and says the
 *     bottle handles "freezing" temperatures without a value [src_hot_water].
 *     That page calls the material both "Tritan Renew" and "Sustain® Renew"
 *     for the same bottles; the product page's "Tritan Renew" is used. The
 *     minimum temperature is a data_gap.
 *   - The stock cap's leash and the neck below the finish are not described
 *     by any source; the CAD's plain neck and shoulder are representative.
 *   - Geometry is generated (no manufacturer CAD): see the generator header
 *     for every dimension and assumption.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { connectorTrait, defineModule, fastenerDiameterMm } from "@deltarobotics/uhd";
import { feature, own, withGeometry } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which the copied generator follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  product: "https://nalgene.com/product/32oz-wide-mouth-bottle/",
  cap: "https://nalgene.com/product/wide-mouth-cap/",
  faq: "https://nalgene.com/faq/",
  hotWater: "https://nalgene.com/hot-water-in-a-nalgene/",
  brochure: "https://assets.thermofisher.com/TFS-Assets/LSG/brochures/D01705.pdf",
  closure: "https://www.thermofisher.com/order/catalog/product/712150-0630",
  labBottle: "https://www.thermofisher.com/order/catalog/product/312104-0032",
  spi: "https://www.plastcaps.com/spi-neck-finish-specifications-for-standard-closures-2-4.htm",
} as const;

const IN = 25.4;
const r2 = (x: number) => Math.round(x * 100) / 100;

// src_product spec table
const BODY_D_MM = r2(3.5 * IN); // 88.9
const HEIGHT_MM = r2(8.25 * IN); // 209.55
const MASS_G = 177.25;
const VOLUME_ML = r2(32 * 29.5735); // 32 US fl oz = 946.35 mL

// src_spi, 63 mm row (inches → mm)
const T_MM: [number, number] = [r2(2.426 * IN), r2(2.461 * IN)]; // 61.62-62.51
const E_MM: [number, number] = [r2(2.332 * IN), r2(2.367 * IN)]; // 59.23-60.12
const H400_MM: [number, number] = [r2(0.393 * IN), r2(0.423 * IN)]; // 9.98-10.74
const S_MM: [number, number] = [r2(0.031 * IN), r2(0.061 * IN)]; // 0.79-1.55
const I_MIN_MM = r2(1.972 * IN); // 50.09
const PITCH_MM = r2(IN / 6); // 4.23 (6 threads per inch)

// assumptions (also in the generator)
const BORE_MM = 53; // src_lab_bottle inner neck
const CHAMFER_MM = 1.0;
const TURNS = 1.5;

const mid = (r: [number, number]) => r2((r[0] + r[1]) / 2);
const LIP: [number, number, number] = [0, 0, HEIGHT_MM];

const NALGENE_32OZ_WIDE_MOUTH_BASE: ModuleDef = defineModule({
  id: "nalgene-32oz-wide-mouth",
  name: "Nalgene 32oz Wide Mouth Bottle, Tritan Renew",
  version: "1.0.0",
  manufacturer: "Nalgene",
  part_number: "2020-3732 (Clear; most colours 2020-xx32, gray-black 682021-0333)",
  description:
    "32 oz (946 mL) wide-mouth drinking bottle in Tritan Renew, Ø3.5 in (89 mm) x 8.25 in (210 mm), 177 g, with a 63 mm neck finish (continuous, straight shouldered semi-buttress thread). In the smart-bottle project the stock cap is replaced by the sensor cap, which screws onto `neck_thread` and seals on `lip_seal`.",
  tags: ["bottle", "water-bottle", "wide-mouth", "63mm-finish", "tritan", "closure-finish", "purchased-mechanical", "smart-bottle"],
  categories: ["mechanical.enclosure"],

  interfaces: [
    {
      id: "neck_thread",
      name: "63 mm neck finish, external semi-buttress thread",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["closure_finish", "external_thread"],
      parameters: [
        fastenerDiameterMm(63),
        { id: "thread_major_diameter", name: "T (thread OD)", unit: "mm", value: mid(T_MM), range: T_MM },
        { id: "thread_root_diameter", name: "E (root diameter)", unit: "mm", value: mid(E_MM), range: E_MM },
        { id: "thread_pitch", unit: "mm", value: PITCH_MM },
        { id: "finish_height", name: "H (assumed: SPI 400 series)", unit: "mm", value: mid(H400_MM), range: H400_MM },
        { id: "thread_start_depth", name: "S (lip to first thread)", unit: "mm", value: mid(S_MM), range: S_MM },
        { id: "closing_torque", unit: "Nm", value: 6.33, range: [4.52, 6.33] },
      ],
      traits: [
        connectorTrait("closure_finish_63mm", {
          gender: "male",
          note: `External 63 mm closure finish: continuous, straight shouldered semi-buttress thread, ${PITCH_MM} mm pitch (6 TPI). Mates with an internal 63 mm closure thread: the stock Nalgene Wide Mouth Cap (fits 32 and 48 oz Wide Mouth) or a printed cap. Frame: origin on the axis at the top of the lip, normal +Z (the cap comes from above), xAxis toward the thread lead-in (assumed).`,
        }),
        {
          type: "pin_functions",
          params: {
            description:
              "Nalgene: 'Cap Diameter 2.5 inches (63mm)'; 'Continuous, straight shouldered semi-buttress threads keep the bottle sealed tight.' SPI 63 mm: T 2.461 max / 2.426 min in; E 2.367 / 2.332 in; 400 H .423 / .393 in (no 410/415 H); S .061 / .031 in; I min 1.972 in; 6 threads per inch.",
            source: [SRC.product, SRC.cap, SRC.spi],
          },
        },
        {
          type: "usage_note",
          params: {
            note: "Recommended application torque for Nalgene 63-415 closures: minimum 40 in-lb (46 cm-kg, 4.52 N·m), maximum 56 in-lb (64 cm-kg, 6.33 N·m), not to be exceeded; threads dry. A cap's thread must carry the maximum (`closing_torque`). Lab-line figure, applied to this bottle as an assumption.",
            source: SRC.brochure,
          },
        },
      ],
    },
    {
      id: "lip_seal",
      name: "Neck lip: top land and inner chamfer (seal seat)",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["face_seal_land", "seal_seat"],
      parameters: [
        { id: "land_inner_diameter", unit: "mm", value: BORE_MM + 2 * CHAMFER_MM },
        { id: "land_outer_diameter", unit: "mm", value: mid(E_MM) },
        { id: "chamfer", unit: "mm", value: CHAMFER_MM },
      ],
      traits: [
        connectorTrait("bottle_lip_seal_land", {
          note: `Flat annular land at the top of the neck, Ø${BORE_MM + 2 * CHAMFER_MM}-Ø${mid(E_MM)} (assumed), with a ${CHAMFER_MM} x 45° inner chamfer. Nalgene's linerless closure seals with a ring moulded inside the cap against the bevelled inner edge (chamfer); a replacement cap may instead compress a face O-ring on the land (smart bottle: AS568-138, centre line Ø56.3, which lands on it). Frame: origin on the axis at the land, normal +Z.`,
        }),
        {
          type: "pin_functions",
          params: {
            description:
              "'Seal Ring is molded inside the closure. It fits tightly against the beveled inner edge (chamfer) of the bottle neck. No closure liner to wear, crease or cause contamination.' 'Closure is one-piece linerless.'",
            source: SRC.brochure,
          },
        },
      ],
    },
    {
      id: "mouth",
      name: "Wide mouth: Ø53 neck bore",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["opening", "bore"],
      parameters: [{ id: "inner_diameter", unit: "mm", value: BORE_MM, range: [I_MIN_MM, BORE_MM] }],
      traits: [
        {
          type: "pin_functions",
          params: {
            description: `Inner neck 53 mm on Thermo's 1 L wide-mouth bottle with the same 63 mm finish; SPI I (inner neck) min 1.972 in (${I_MIN_MM} mm). Nalgene: 'The wide opening fits most filtration devices and ice cubes.'`,
            source: [SRC.labBottle, SRC.spi, SRC.product],
          },
        },
        {
          type: "usage_note",
          params: {
            note: "Anything hanging from a cap into the bottle (the smart bottle's Ø6 temperature probe) or looking down into it (the time-of-flight sensor) passes through this bore. Frame: origin on the axis at the lip, normal +Z (out of the bottle).",
          },
        },
      ],
    },
    {
      id: "base",
      name: "Standing face",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "custom", roles: ["peer"] }],
      capabilities: ["rest_surface"],
      parameters: [{ id: "diameter", unit: "mm", value: BODY_D_MM }],
      traits: [
        {
          type: "pin_functions",
          params: { description: "Body 'Diameter 3.5 inches (89mm)'; the bottle stands on its base.", source: SRC.product },
        },
      ],
    },
  ],

  domains: [
    {
      domain: "mechanical",
      dimensions_mm: { length: BODY_D_MM, width: BODY_D_MM, height: HEIGHT_MM },
      weight_g: MASS_G,
      metadata: {
        capacity_ml: VOLUME_ML,
        capacity: "32 oz",
        material: "Tritan Renew (BPA/BPS-free)",
        cap_size_mm: 63,
        neck_finish: "63 mm (63-415 per the Thermo lab-line torque table)",
        thread_form: "continuous, straight shouldered semi-buttress",
        spi_63mm_in: { T: [2.426, 2.461], E: [2.332, 2.367], H_400: [0.393, 0.423], S: [0.031, 0.061], I_min: 1.972, threads_per_inch: 6 },
        stock_cap: "Nalgene Wide Mouth Cap: LDPE / PP, 45.25 g, fits 32 and 48 oz Wide Mouth",
        source: [SRC.product, SRC.cap, SRC.spi, SRC.brochure],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "container",
        capacity_ml: VOLUME_ML,
        capacity: "32 oz",
        leakproof: "Leak-Proof Guarantee (with the Nalgene cap)",
        dishwasher_safe: true,
        source: SRC.product,
      },
    },
    {
      type: "operating_conditions",
      params: {
        max_liquid_temperature_C: 100,
        max_liquid_temperature_F: 212,
        heating: "pour-in only: boiling water may be poured in, but the bottle must not be heated (no boiling water in it, no flame or stove contact)",
        minimum_temperature: "'made to handle both freezing and boiling temps'; no minimum value stated",
        material_naming_note: "The source names the material both 'Tritan Renew' and 'Sustain® Renew' for the same bottles; the limit is stated for 'Sustain® Renew bottles'.",
        note: "'Sustain® Renew bottles: Safe for hot liquids, including boiling water (up to 212°F / 100°C) in everyday use.' A liquid limit, not an ambient rating.",
        source: SRC.hotWater,
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Hot liquids: you can pour boiling water into the bottle but should never boil water in it; avoid direct flame or stove contact, which can warp the plastic. After pouring in boiling water, wait a few seconds before screwing on the cap: steam builds pressure, and tightening the cap too soon can make a seal that is hard to open or that leaks later. Do not overtighten. Sudden temperature swings can stress the plastic.",
        source: SRC.hotWater,
      },
    },
    {
      type: "usage_note",
      params: {
        note: "All Nalgene bottles are dishwasher safe; place them on the top rack away from the heating element. The bottle can be frozen if filled only about 2/3 full, to allow for expansion. The stock cap is tethered by a leash; a replacement cap does not use it.",
        source: [SRC.faq, SRC.cap],
      },
    },
    {
      type: "assumption",
      params: {
        field: "neck finish of the consumer bottle",
        value: "the SPI 63 mm finish (T, E, S, I, 6 TPI) and Nalgene's lab-line 63-415 closure facts",
        reason: "Nalgene states only '63mm' and the thread form; Thermo's 63 mm replacement closure fits narrow- and wide-mouth Nalgene bottles (src_closure), which supports a shared finish but does not prove it. Measure the bottle (OQ-B4).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "finish height H",
        value: `${mid(H400_MM)} mm (SPI 400-series 63 mm, ${H400_MM[0]}-${H400_MM[1]})`,
        reason: "The SPI table read gives no 415-series H at 63 mm although the brochure calls the closure 63-415.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "inner neck (bore) diameter",
        value: `${BORE_MM} mm`,
        reason: "Stated for Thermo's 1 L HDPE wide-mouth bottle 312104-0032 with the same 63 mm finish, not for this bottle; above the SPI minimum I of 50.09 mm.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "thread start, turns and profile",
        value: `right-hand single start, ${TURNS} turns, lead-in on +X; upper flank 10° from radial, lower flank 45°, crest 0.8 mm, depth (T - E) / 2 = 1.2 mm; no run-out`,
        reason: "No source dimensions the semi-buttress form or the number of turns. Representative only.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "lip, neck, shoulder and wall",
        value: `flat land Ø${BORE_MM + 2 * CHAMFER_MM}-Ø${mid(E_MM)}, ${CHAMFER_MM} x 45° inner chamfer; plain neck 8 mm below the finish; conical shoulder 28 mm; walls 2.5 mm (body) and 3.33 mm (neck); base 4 x 4 mm chamfer`,
        reason: "Not stated by any source; chosen to look like the moulded bottle. The CAD volume (156.8 cm³) with a copolyester density of about 1.2 g/cm³ (not sourced) gives about 188 g against the stated 177 g, so the wall is about right.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "height datum",
        value: `${HEIGHT_MM} mm (8.25 in) from the base to the top of the lip, without the cap`,
        reason: "Nalgene gives 'Height 8.25 in (21cm)' without saying whether the cap is fitted.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "closing torque",
        value: "40-56 in-lb (4.52-6.33 N·m)",
        reason: "Thermo's figure for Nalgene lab 63-415 closures (src_brochure); Nalgene Outdoor states none for this bottle.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "outer dimensions",
        values: ["Ø3.5 in x 8.25 in (spec table)", "3.25 x 3.25 x 9.5 in, 0.39 lb (page variation data)"],
        sources: [SRC.product],
        resolution: "The variation data are shipping attributes; the spec table is used.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["manufacturer CAD"],
        note: "nalgene.com product and cap pages carry photos and a spec table only, no drawing or CAD; Thermo's lab-line pages give no CAD. Community cap models (Printables 356142, 1069682; Thingiverse 3302538) could not be fetched and are caps, not the bottle. The body is generated from the cited dimensions by parts/local/nalgene-32oz-wide-mouth/nalgene-32oz-wide-mouth.py.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["neck finish dimensions (T, E, H, S, I) of this bottle", "thread start and turns", "lip geometry", "minimum temperature"],
        note: "Not in any Nalgene source read. For temperature, Nalgene gives only the 100 °C liquid maximum and 'freezing' with no value (src_hot_water).",
      },
    },
  ],

  artifacts: [
    { id: "art_product_page", name: "Nalgene 32oz Wide Mouth Bottle", type: "documentation", url: SRC.product },
    { id: "art_cap_page", name: "Nalgene Wide Mouth Cap", type: "documentation", url: SRC.cap },
    { id: "art_hot_water_page", name: "Nalgene: Can You Put Boiling Water in a Nalgene?", type: "documentation", url: SRC.hotWater },
    { id: "art_brochure", name: "Thermo Scientific Nalgene Bottles and Carboys brochure (D01705)", type: "datasheet", url: SRC.brochure },
    { id: "art_spi", name: "SPI neck finish specifications for standard closures", type: "documentation", url: SRC.spi },
  ],
});

// ---------------------------------------------------------------------------
// Geometry (PB-796): representative CAD generated from the cited dimensions
// by parts/local/nalgene-32oz-wide-mouth/nalgene-32oz-wide-mouth.py — not manufacturer
// CAD. Z up on the bottle axis, base at z = 0, lip at z = 209.55 (mm).
// ---------------------------------------------------------------------------

export const NALGENE_32OZ_WIDE_MOUTH: ModuleDef = withGeometry(
  NALGENE_32OZ_WIDE_MOUTH_BASE,
  {
    // a cap screws on from +Z; xAxis toward the thread lead-in (assumed angle)
    neck_thread: {
      frame: { origin: LIP, normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("neck_thread", { area_mm2: 5151.434, centroid: [0.0, -2.131, 201.652] }), own("neck_thread")],
    },
    lip_seal: {
      frame: { origin: LIP, normal: [0, 0, 1] },
      refs: [feature("lip_seal", { area_mm2: 661.188, centroid: [0.0, 0.0, 209.37] }), own("lip_seal")],
    },
    mouth: {
      frame: { origin: LIP, normal: [0, 0, 1] },
      refs: [feature("mouth", { area_mm2: 3057.554, centroid: [0.0, 0.0, 199.368] }), own("mouth")],
    },
    base: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1] },
      refs: [feature("base", { area_mm2: 5140.282, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("base")],
    },
  },
  cadArtifacts({
    dir: "parts/local/nalgene-32oz-wide-mouth",
    name: "nalgene-32oz-wide-mouth",
    generator: "parts/local/nalgene-32oz-wide-mouth/nalgene-32oz-wide-mouth.py",
    tool: "build123d 0.13.0",
    interfaces: ["neck_thread", "lip_seal", "mouth", "base"],
  }),
);

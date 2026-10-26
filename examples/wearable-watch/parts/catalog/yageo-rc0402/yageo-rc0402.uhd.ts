/**
 * Yageo RC0402 thick-film chip resistor (RC_L series, 0402 / 1005 metric,
 * standard power) — datasheet-honest UHD part, parametric per placement.
 *
 * Sources (see ./yageo-rc0402/sources.json):
 *   - src_datasheet: Yageo "General purpose chip resistors, RC_L series",
 *     product specification V.14 (2025-11-14) —
 *     https://yageogroup.com/content/datasheet/asset/file/PYU-RC_GROUP_51_ROHS_L
 *
 * Modelling notes:
 *   - One catalog part for the RC0402 standard-power range, not one per
 *     value. The `passive` trait states the default instance in UHD's fields
 *     (10 kΩ ±1 %, RC0402FR-0710KL) and the series: typed `parameters`, the
 *     tolerance grades with the resistance range each is made in (Table 2),
 *     and the ordering-code rule. A board sets `resistance` and `tolerance`
 *     per placement in `ChildModuleRef.overrides`; the MPN follows from them
 *     (`resolvePassive`, ./chip-passive.ts). See the library README.
 *   - Standard power only (reel code 07, 1/16 W). The double-power 1/8 W
 *     variant (reel code 7W) has other ranges and is not this part; its MPNs
 *     do not decode here. Zero-ohm jumpers are not modelled.
 *   - Two `passive` terminals, `pin_1` and `pin_2`: Yageo numbers neither end
 *     and the part has no polarity (assumption trait "terminal designators").
 *   - Max working voltage 50 V, overload 100 V and rated power at 70 °C are
 *     typed parameters; the continuous working voltage is the lesser of
 *     √(P·R) and the max working voltage (usage note).
 *   - Geometry: generated from Table 1 (L 1.00, W 0.50, H 0.35, bottom
 *     termination I2 0.25 mm); Yageo publishes no 3D model with the data
 *     sheet. `pcb_mount` refs both terminations with a frame on the seating
 *     plane; each terminal refs its own termination's underside.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";
import { chipMount, chipTerminals, seriesTrait } from "./chip-passive.js";

const SRC = {
  datasheet: "https://yageogroup.com/content/datasheet/asset/file/PYU-RC_GROUP_51_ROHS_L",
} as const;

const DS = (section: string) => `${SRC.datasheet} (${section})`;

const YAGEO_RC0402_BASE: ModuleDef = defineModule({
  id: "yageo-rc0402",
  name: "Yageo RC0402 Chip Resistor (RC_L, 0402)",
  version: "1.0.0",
  manufacturer: "Yageo",
  part_number: "RC0402FR-0710KL",
  description:
    "Yageo RC_L series thick-film chip resistor, size 0402 (1.00 x 0.50 x 0.35 mm), standard power 1/16 W at 70 °C, max working voltage 50 V, -55 to +155 °C. Parametric: resistance and tolerance are set per placement (±0.1 % 10 Ω–1 MΩ, ±0.5 % 1 Ω–1 MΩ, ±1 % 1 Ω–10 MΩ, ±5 % 1 Ω–100 MΩ); the default instance is 10 kΩ ±1 % (RC0402FR-0710KL).",
  tags: ["yageo", "rc0402", "rc_l", "resistor", "chip-resistor", "thick-film", "0402", "1005-metric", "smd", "passive", "parametric"],
  categories: ["component.passive.resistor"],

  interfaces: [
    ...chipTerminals(DS("Fig. 9 outline; the chip has no polarity")),
    chipMount(
      "0402 chip terminations",
      "Two wrap-around terminations (matte tin on Ni barrier), bottom length I2 0.25 ±0.10 mm, top length I1 0.20 ±0.10 mm, on a 1.00 ±0.05 x 0.50 ±0.05 x 0.35 ±0.05 mm chip. Land pattern: Yageo's separate \"Chip resistors mounting\" data sheet; footprints are the PCB tool's choice. MSL 1.",
      DS("Construction, Fig. 9, Table 1; Features"),
    ),
  ],

  domains: [
    {
      domain: "electrical",
      metadata: {
        technology: "thick film, laser trimmed, on a ceramic substrate",
        rated_power_W_at_70C: 1 / 16,
        max_working_voltage_V: 50,
        max_overload_voltage_V: 100,
        dielectric_withstanding_voltage_V: 100,
        source: DS("Table 2, RC0402 1/16 W row; Power rating"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 1.0, width: 0.5, height: 0.35 },
      package: {
        name: "0402",
        code: "1005 metric (Yageo RC0402)",
        pin_count: 2,
        exposed_pad: false,
        source: DS("Table 1: RC0402 L 1.00 ±0.05, W 0.50 ±0.05, H 0.35 ±0.05, I1 0.20 ±0.10, I2 0.25 ±0.10 mm"),
      },
      metadata: {
        termination_mm: { top_I1: 0.2, bottom_I2: 0.25, tolerance: 0.1 },
        terminations: "matte tin on nickel barrier",
        marking: "none (RC0402)",
        mounting_method: "surface_mount",
        msl: "1",
        packing: "paper tape on 7 in reels (reel code 07: 10,000 per reel in the ordering example)",
        source: [DS("Table 1; Construction; Marking; Features"), DS("Ordering example")],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-55, 155],
      metadata: {
        power_derating: "full rated power to 70 °C, derated linearly to 0 at 155 °C (Fig. 10-1)",
        source: DS("Operating temperature range, Fig. 10-1"),
      },
    },
  ],

  traits: [
    seriesTrait({
      kind: "resistor",
      value: 10e3,
      unit: "Ω",
      tolerance: 0.01,
      source: DS("Ordering information; Table 2 RC0402 1/16 W"),
      series: "Yageo RC_L RC0402, standard power",
      parameters: [
        { id: "resistance", name: "Resistance", unit: "Ω", value: 10e3, range: [1, 100e6] },
        { id: "tolerance", name: "Resistance tolerance (fraction)", unit: "dimensionless", value: 0.01, range: [0.001, 0.05] },
        { id: "rated_power", name: "Rated power at 70 °C", unit: "W", value: 1 / 16 },
        { id: "max_working_voltage", name: "Maximum working voltage", unit: "V", value: 50 },
        { id: "max_overload_voltage", name: "Maximum overload voltage", unit: "V", value: 100 },
      ],
      overridable: ["resistance", "tolerance", "part_number"],
      tolerances: [
        { tolerance: 0.001, code: "B", range: [10, 1e6] },
        { tolerance: 0.005, code: "D", range: [1, 1e6] },
        { tolerance: 0.01, code: "F", range: [1, 10e6] },
        { tolerance: 0.05, code: "J", range: [1, 100e6] },
      ],
      part_number: {
        default: "RC0402FR-0710KL",
        pattern: "RC0402{tolerance}R-07{value}L",
        value_code: "rkm",
        decode: "^RC0402(?<tolerance>[BDFJ])(?<packing>[RK])-(?<reel>07|10|13|7D)(?<value>[0-9]*[RKM][0-9]*)L$",
        codes: { tolerance: { B: 0.001, D: 0.005, F: 0.01, J: 0.05 } },
        source: DS("Ordering information: RC size, tolerance B/D/F/J, packing R/K, reel 07/10/13/7D, value with R/K/M as decimal point, L"),
      },
    }),
    {
      type: "performance",
      params: {
        kind: "resistor",
        temperature_coefficient_ppm_per_C: { "1-10 Ω": 200, "10 Ω-10 MΩ": 100, "10-100 MΩ": 200 },
        jumper: "a zero-ohm jumper (< 50 mΩ, rated 1 A, max 2 A) is ordered as J tolerance; not modelled by this part",
        source: DS("Table 2, RC0402 1/16 W row"),
      },
    },
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-55, 155],
        voltage_V: 50,
        note: "Rated power 1/16 W at 70 °C ambient, derated linearly to zero at 155 °C. The continuous DC or AC (rms) working voltage is √(P x R) or 50 V, whichever is less.",
        source: DS("Table 2; Power rating; Rated voltage; Fig. 10-1"),
      },
    },
    {
      type: "absolute_maximum",
      params: {
        overload_voltage_V: 100,
        dielectric_withstanding_voltage_V: 100,
        source: DS("Table 2, RC0402 1/16 W row"),
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "instance",
        note: "Set the value per placement: overrides { resistance: <Ω>, tolerance: 0.001 | 0.005 | 0.01 | 0.05 } on the board's child. The MPN is RC0402<B|D|F|J>R-07<value>L with R, K or M as the decimal point (4K7 = 4.7 kΩ); name part_number only for another packing or reel (K embossed tape; 10, 13 or 7D reels).",
        source: DS("Ordering information"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "terminal designators",
        value: "pin_1 = the -X termination, pin_2 = the +X termination",
        reason: "Yageo numbers neither termination and the resistor has no polarity; two designators are needed for pin tables and footprints.",
        source: DS("Fig. 9"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal 1.00 x 0.50 x 0.35 mm chip; each termination one block 0.25 mm long (I2) over the full width and height; overcoat and marking layer not modelled",
        reason: "Table 1 gives the outline and the top and bottom termination lengths (I1 0.20, I2 0.25); the model uses the bottom length, which is what lands on the pad, at the nominal size.",
        source: DS("Table 1"),
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The RC_L data sheet links no 3D model and no vendor STEP was sought for a series part, whose one body stands for every value. Geometry is generated from Table 1 (library/cad/py/catalog/yageo-rc0402.py).",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "The RC_L data sheet states no unit mass.", source: SRC.datasheet },
    },
  ],

  artifacts: [{ id: "art_datasheet", name: "Yageo RC_L series data sheet, V.14", type: "datasheet", url: SRC.datasheet }],
});

// ---------------------------------------------------------------------------
// Geometry: generated from Table 1. Seating plane z = 0, chip along X,
// pin 1 at -X.
// ---------------------------------------------------------------------------

export const YAGEO_RC0402: ModuleDef = withGeometry(
  YAGEO_RC0402_BASE,
  {
    pin_1: { refs: [feature("pin_1", { area_mm2: 0.125, centroid: [-0.375, 0.0, 0.0], normal: [0.0, 0.0, -1.0] })] },
    pin_2: { refs: [feature("pin_2", { area_mm2: 0.125, centroid: [0.375, 0.0, 0.0], normal: [0.0, 0.0, -1.0] })] },
    // the terminations onto the board: frame on the seating plane, normal out of the underside, x from pin 1 to pin 2
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.25, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/yageo-rc0402/artifacts/cad",
    name: "yageo-rc0402",
    generator: "library/cad/py/catalog/yageo-rc0402.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

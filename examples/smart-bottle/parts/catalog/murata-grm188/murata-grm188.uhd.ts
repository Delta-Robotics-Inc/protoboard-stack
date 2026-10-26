/**
 * Murata GRM188 multilayer ceramic chip capacitor (GRM series, 1608M / 0603,
 * 0.8 mm thick, X5R or X7R) — datasheet-honest UHD part, parametric per
 * placement.
 *
 * Sources (see ./murata-grm188/sources.json):
 *   - src_default: Murata reference sheet GRM188R71C104KA01-01 (the default
 *     instance: X7R, 0.1 µF, 16 V, ±10 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R71C104KA01-01.pdf
 *   - src_x5r_10v: GRM188R61A106ME69-01A (X5R, 10 µF, 10 V, ±20 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R61A106ME69-01A.pdf
 *   - src_x5r_25v: GRM188R61E106MA73-01A (X5R, 10 µF, 25 V, ±20 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R61E106MA73-01A.pdf
 *   - src_x5r_25v_1u: GRM188R61E105KA12-01 (X5R, 1 µF, 25 V, ±10 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R61E105KA12-01.pdf
 *   - src_code_6v3, src_code_50v: GRM155R60J106ME15-01A and
 *     GRM155R71H103KA88-01A, cited only for the 0J (6.3 V) and 1H (50 V)
 *     voltage codes of the same part-number system —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R60J106ME15-01A.pdf
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R71H103KA88-01A.pdf
 *
 * Modelling notes:
 *   - One catalog part for GRM188 X5R and X7R capacitors, as murata-grm155
 *     is for 0402: the `passive` trait states the default instance in UHD's
 *     fields (0.1 µF ±10 %, GRM188R71C104KA01D) and the series (typed
 *     `parameters`, the `dielectric` choice, tolerance grades, part-number
 *     code tables). A board sets `capacitance`, `tolerance`, `rated_voltage`
 *     and `dielectric` per placement in `ChildModuleRef.overrides` and names
 *     the exact Murata `part_number` (its ⑧ control code is decided by no
 *     parameter); the MPN is decoded and must agree (`resolvePassive`,
 *     ./chip-passive.ts). See the library README.
 *   - The lineup is not encoded; the named part's reference sheet is its
 *     evidence. The cited 0603 sheets cover 0.1 to 10 µF at 10 to 25 V.
 *   - Dielectric: X7R (R7) -15 to +15 % over -55 to 125 °C; X5R (R6) -15 to
 *     +15 % over -55 to 85 °C. The thermal domain states the default (X7R).
 *   - Two `passive` terminals, `pin_1` and `pin_2`: no polarity, and Murata
 *     numbers neither end (assumption trait).
 *   - Geometry: generated from the default sheet's Type & Dimensions table
 *     (L 1.6, W 0.8, T 0.8 ±0.1, e 0.2 to 0.5 mm); one nominal body stands
 *     for the series. `pcb_mount` refs both terminations with a frame on the
 *     seating plane.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";
import { chipMount, chipTerminals, seriesTrait } from "./chip-passive.js";

const CERAMY = "https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG";
const SRC = {
  default: `${CERAMY}/GRM188R71C104KA01-01.pdf`,
  x5r10v: `${CERAMY}/GRM188R61A106ME69-01A.pdf`,
  x5r25v: `${CERAMY}/GRM188R61E106MA73-01A.pdf`,
  x5r25v1u: `${CERAMY}/GRM188R61E105KA12-01.pdf`,
  code6v3: `${CERAMY}/GRM155R60J106ME15-01A.pdf`,
  code50v: `${CERAMY}/GRM155R71H103KA88-01A.pdf`,
} as const;

const DS = (section: string) => `${SRC.default} (${section})`;

const MURATA_GRM188_BASE: ModuleDef = defineModule({
  id: "murata-grm188",
  name: "Murata GRM188 MLCC (1608M / 0603, X5R / X7R)",
  version: "1.0.0",
  manufacturer: "Murata",
  part_number: "GRM188R71C104KA01D",
  description:
    "Murata GRM series multilayer ceramic chip capacitor, size 1608M (0603), 1.6 x 0.8 x 0.8 mm, class II dielectric X7R (-55 to 125 °C, ±15 %) or X5R (-55 to 85 °C, ±15 %). Parametric: capacitance, tolerance (K ±10 %, M ±20 %), rated voltage (6.3 to 50 V) and dielectric are set per placement with the exact Murata part number; the default instance is 0.1 µF ±10 % 16 V X7R (GRM188R71C104KA01D).",
  tags: ["murata", "grm", "grm188", "mlcc", "capacitor", "ceramic-capacitor", "x7r", "x5r", "0603", "1608-metric", "smd", "passive", "parametric"],
  categories: ["component.passive.capacitor"],

  interfaces: [
    ...chipTerminals(DS("3. Type & Dimensions; the capacitor has no polarity")),
    chipMount(
      "1608M (0603) chip terminations",
      "Two end terminations, each e 0.2 to 0.5 mm long, at least g 0.5 mm apart, on a 1.6 ±0.1 x 0.8 ±0.1 x 0.8 ±0.1 mm chip (default instance; GRM188R61A106ME69 is ±0.15, GRM188R61E106MA73 ±0.2). Flow or reflow soldering. Land pattern: the PCB tool's choice.",
      DS("3. Type & Dimensions; 4. Rated value"),
    ),
  ],

  domains: [
    {
      domain: "electrical",
      metadata: {
        default_instance: "0.1 µF ±10 %, DC 16 V, X7R (R7)",
        insulation_resistance: "more than 500 Ω·F (C > 0.047 µF) at rated voltage, room temperature",
        dissipation_factor_max: 0.035,
        voltage_proof: "250 % of rated voltage for 1 to 5 s (high dielectric constant type)",
        source: DS("4. Rated value; Specifications and Test Methods 4, 5, 7"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 1.6, width: 0.8, height: 0.8 },
      package: {
        name: "0603",
        code: "1608M (Murata GRM18 size code, T code 8)",
        pin_count: 2,
        exposed_pad: false,
        source: DS("3. Type & Dimensions: L 1.6 ±0.1, W 0.8 ±0.1, T 0.8 ±0.1, e 0.2 to 0.5, g 0.5 min (mm)"),
      },
      metadata: {
        termination_length_mm: [0.2, 0.5],
        termination_gap_min_mm: 0.5,
        mounting_method: "surface_mount (flow or reflow)",
        packaging_codes: { D: "180 mm reel, paper tape W8P4, 4000 pcs", J: "330 mm reel, paper tape W8P4, 10000 pcs" },
        source: DS("3. Type & Dimensions; 5. Package"),
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-55, 125],
      metadata: {
        note: "Default (X7R) instance. An X5R instance operates from -55 to 85 °C.",
        source: [DS("4. Rated value"), `${SRC.x5r25v1u} (4. Rated value)`],
      },
    },
  ],

  traits: [
    seriesTrait({
      kind: "capacitor",
      value: 0.1e-6,
      unit: "F",
      tolerance: 0.1,
      source: DS("4. Rated value"),
      series: "Murata GRM188 (GRM series, 1608M, T 0.8 mm), X5R / X7R",
      parameters: [
        { id: "capacitance", name: "Capacitance", unit: "F", value: 0.1e-6 },
        { id: "tolerance", name: "Capacitance tolerance (fraction)", unit: "dimensionless", value: 0.1 },
        { id: "rated_voltage", name: "Rated voltage (DC)", unit: "V", value: 16, range: [6.3, 50] },
      ],
      choices: {
        dielectric: {
          values: ["X5R", "X7R"],
          default: "X7R",
          source: `${SRC.default} (R7, X7R, -15 to 15 %, -55 to 125 °C); ${SRC.x5r10v} (R6, X5R(EIA), -15 to 15 %, -55 to 85 °C)`,
        },
      },
      overridable: ["capacitance", "tolerance", "rated_voltage", "dielectric", "part_number"],
      tolerances: [
        { tolerance: 0.1, code: "K" },
        { tolerance: 0.2, code: "M" },
      ],
      part_number: {
        default: "GRM188R71C104KA01D",
        pattern: null,
        value_code: "eia3_pf",
        decode: "^GRM18(?<thickness>8)(?<dielectric>R6|R7)(?<rated_voltage>0J|1A|1C|1E|1H)(?<value>\\d{3})(?<tolerance>[KM])(?<control>[A-Z0-9]{3})(?<package>[DJ])?$",
        codes: {
          dielectric: { R6: "X5R", R7: "X7R" },
          rated_voltage: { "0J": 6.3, "1A": 10, "1C": 16, "1E": 25, "1H": 50 },
          tolerance: { K: 0.1, M: 0.2 },
        },
        source: `${DS("2. MURATA Part No. System: GRM 18 8 R7 1C 104 K A01 D")}; codes R6/1A/M from ${SRC.x5r10v}, 1E from ${SRC.x5r25v}, 0J from ${SRC.code6v3}, 1H from ${SRC.code50v}`,
      },
    }),
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-55, 125],
        voltage_V: 16,
        note: "Default instance (X7R, DC 16 V). The rated voltage is the maximum continuously applied; with AC superimposed, the peak-to-peak or zero-to-peak voltage, whichever is larger, stays within it. An X5R instance operates from -55 to 85 °C.",
        source: [DS("4. Rated value; Specifications and Test Methods 1"), `${SRC.x5r25v1u} (4. Rated value)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "dc_bias",
        note: "Class II (X5R, X7R) capacitance falls with applied DC voltage, more steeply as the voltage rises, even below the rated voltage. Check the effective capacitance at the circuit's bias, and do not use these where a tight capacitance tolerance matters.",
        source: `${SRC.x5r25v} (Caution 5, DC voltage and AC voltage characteristic)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "lifetime",
        note: "Murata's general MLCCs are designed for about 10 years in use; the estimated useful life extends beyond that at 80 % of rated voltage or less and a maximum operating temperature 20 °C or more below the rated maximum.",
        source: `${SRC.x5r25v} (estimated useful life)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "instance",
        note: "Set the value per placement: overrides { capacitance: <F>, tolerance: 0.1 | 0.2, rated_voltage: <V>, dielectric: \"X5R\" | \"X7R\", part_number: \"GRM188…\" } on the board's child, naming a Murata part whose reference sheet states those values. Several high-capacitance GRM188 parts have looser dimensions (±0.15 or ±0.2 mm).",
        source: [DS("2. MURATA Part No. System"), `${SRC.x5r10v} (Type & Dimension)`, `${SRC.x5r25v} (Type & Dimension)`],
      },
    },
    {
      type: "assumption",
      params: {
        field: "terminal designators",
        value: "pin_1 = the -X termination, pin_2 = the +X termination",
        reason: "Murata numbers neither termination and the capacitor has no polarity; two designators are needed for pin tables and footprints.",
        source: DS("3. Type & Dimensions"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal 1.6 x 0.8 x 0.8 mm chip; each termination one block 0.35 mm long (middle of e 0.2 to 0.5) over the full width and height",
        reason: "The sheet gives e as a range; the model takes the middle, which leaves a 0.9 mm gap above the 0.5 mm minimum g. One nominal body stands for every GRM188 instance.",
        source: DS("3. Type & Dimensions"),
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Murata's reference sheets link no 3D model, and no vendor STEP was sought for a series part, whose one body stands for every value. Geometry is generated from the default sheet's dimensions (library/cad/py/catalog/murata-grm188.py).",
        source: SRC.default,
      },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "The reference sheets state no unit mass.", source: SRC.default },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "Murata reference sheet GRM188R71C104KA01-01 (default instance)", type: "datasheet", url: SRC.default },
    { id: "art_x5r_10v", name: "Murata reference sheet GRM188R61A106ME69-01A", type: "datasheet", url: SRC.x5r10v },
    { id: "art_x5r_25v", name: "Murata reference sheet GRM188R61E106MA73-01A", type: "datasheet", url: SRC.x5r25v },
    { id: "art_x5r_25v_1u", name: "Murata reference sheet GRM188R61E105KA12-01", type: "datasheet", url: SRC.x5r25v1u },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the default sheet. Seating plane z = 0, chip along
// X, pin 1 at -X.
// ---------------------------------------------------------------------------

export const MURATA_GRM188: ModuleDef = withGeometry(
  MURATA_GRM188_BASE,
  {
    pin_1: { refs: [feature("pin_1", { area_mm2: 0.28, centroid: [-0.625, 0.0, 0.0], normal: [0.0, 0.0, -1.0] })] },
    pin_2: { refs: [feature("pin_2", { area_mm2: 0.28, centroid: [0.625, 0.0, 0.0], normal: [0.0, 0.0, -1.0] })] },
    // the terminations onto the board: frame on the seating plane, normal out of the underside, x from pin 1 to pin 2
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.56, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/murata-grm188/artifacts/cad",
    name: "murata-grm188-1608",
    generator: "library/cad/py/catalog/murata-grm188.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

/**
 * Murata GRM155 multilayer ceramic chip capacitor (GRM series, 1005M / 0402,
 * 0.5 mm thick, X5R or X7R) — datasheet-honest UHD part, parametric per
 * placement.
 *
 * Sources (see ./murata-grm155/sources.json):
 *   - src_default: Murata reference sheet GRM155R71C104KA88-01A (the default
 *     instance: X7R, 0.1 µF, 16 V, ±10 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R71C104KA88-01A.pdf
 *   - src_x5r_6v3: GRM155R60J106ME15-01A (X5R, 10 µF, 6.3 V, ±20 %) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R60J106ME15-01A.pdf
 *   - src_x5r_25v: GRM155R61E104KA87-01A (X5R, 0.1 µF, 25 V) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R61E104KA87-01A.pdf
 *   - src_x7r_25v: GRM155R71E103KA01-01A (X7R, 10 nF, 25 V) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R71E103KA01-01A.pdf
 *   - src_x7r_50v: GRM155R71H103KA88-01A (X7R, 10 nF, 50 V) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R71H103KA88-01A.pdf
 *   - src_x7r_50v_1n: GRM155R71H102KA01-01A (X7R, 1 nF, 50 V) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM155R71H102KA01-01A.pdf
 *   - src_x5r_10v_0603: GRM188R61A106ME69-01A, cited only for the 1A (10 V)
 *     voltage code of the same part-number system —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R61A106ME69-01A.pdf
 *
 * Modelling notes:
 *   - One catalog part for GRM155 X5R and X7R capacitors, not one per value.
 *     The `passive` trait states the default instance in UHD's fields
 *     (0.1 µF ±10 %, GRM155R71C104KA88D) and the series: typed `parameters`
 *     (capacitance, tolerance, rated voltage), the `dielectric` choice, the
 *     tolerance grades and the part-number code tables. A board sets
 *     `capacitance`, `tolerance`, `rated_voltage` and `dielectric` per
 *     placement in `ChildModuleRef.overrides`, and names the exact Murata
 *     `part_number`: its ⑧ individual-specification code is a Murata control
 *     code no parameter decides, so the MPN cannot be formed. The MPN is
 *     decoded and must agree with the parameters (`resolvePassive`,
 *     ./chip-passive.ts). See the library README.
 *   - Which capacitance exists at which voltage and dielectric (the lineup)
 *     is not encoded; the named part's own reference sheet is its evidence.
 *     The cited sheets cover 1 nF to 10 µF and 6.3 to 50 V.
 *   - Dielectric: X7R (Murata R7) -15 to +15 % over -55 to 125 °C; X5R (R6)
 *     -15 to +15 % over -55 to 85 °C, which is also the X5R operating range.
 *     The thermal domain states the default (X7R) instance.
 *   - Two `passive` terminals, `pin_1` and `pin_2`: the capacitor has no
 *     polarity and Murata numbers neither end (assumption trait).
 *   - Geometry: generated from the default sheet's Type & Dimension table
 *     (L 1.0, W 0.5, T 0.5 ±0.05, e 0.15 to 0.35 mm); one nominal body
 *     stands for the series. `pcb_mount` refs both terminations with a frame
 *     on the seating plane.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";
import { chipMount, chipTerminals, seriesTrait } from "./chip-passive.js";

const CERAMY = "https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG";
const SRC = {
  default: `${CERAMY}/GRM155R71C104KA88-01A.pdf`,
  x5r6v3: `${CERAMY}/GRM155R60J106ME15-01A.pdf`,
  x5r25v: `${CERAMY}/GRM155R61E104KA87-01A.pdf`,
  x7r25v: `${CERAMY}/GRM155R71E103KA01-01A.pdf`,
  x7r50v: `${CERAMY}/GRM155R71H103KA88-01A.pdf`,
  x7r50v1n: `${CERAMY}/GRM155R71H102KA01-01A.pdf`,
  code10v: `${CERAMY}/GRM188R61A106ME69-01A.pdf`,
} as const;

const DS = (section: string) => `${SRC.default} (${section})`;

const MURATA_GRM155_BASE: ModuleDef = defineModule({
  id: "murata-grm155",
  name: "Murata GRM155 MLCC (1005M / 0402, X5R / X7R)",
  version: "1.0.0",
  manufacturer: "Murata",
  part_number: "GRM155R71C104KA88D",
  description:
    "Murata GRM series multilayer ceramic chip capacitor, size 1005M (0402), 1.0 x 0.5 x 0.5 mm, class II dielectric X7R (-55 to 125 °C, ±15 %) or X5R (-55 to 85 °C, ±15 %). Parametric: capacitance, tolerance (K ±10 %, M ±20 %), rated voltage (6.3 to 50 V) and dielectric are set per placement with the exact Murata part number; the default instance is 0.1 µF ±10 % 16 V X7R (GRM155R71C104KA88D).",
  tags: ["murata", "grm", "grm155", "mlcc", "capacitor", "ceramic-capacitor", "x7r", "x5r", "0402", "1005-metric", "smd", "passive", "parametric"],
  categories: ["component.passive.capacitor"],

  interfaces: [
    ...chipTerminals(DS("Type & Dimension; the capacitor has no polarity")),
    chipMount(
      "1005M (0402) chip terminations",
      "Two end terminations, each e 0.15 to 0.35 mm long, at least g 0.3 mm apart, on a 1.0 ±0.05 x 0.5 ±0.05 x 0.5 ±0.05 mm chip (default instance; GRM155R60J106ME15 is ±0.15). Flow or reflow soldering. Land pattern: the PCB tool's choice.",
      DS("Type & Dimension; Rated Value (mounting method)"),
    ),
  ],

  domains: [
    {
      domain: "electrical",
      metadata: {
        default_instance: "0.1 µF ±10 %, DC 16 V, X7R (R7)",
        insulation_resistance: "more than 500 Ω·F at rated voltage, room temperature",
        dissipation_factor_max: 0.035,
        capacitance_measurement: "1.0 ±0.1 kHz, 1.0 ±0.2 Vrms, room temperature",
        voltage_proof: "250 % of rated voltage for 1 to 5 s",
        source: DS("Rated Value; Specifications and Test Methods 4-7"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 1.0, width: 0.5, height: 0.5 },
      package: {
        name: "0402",
        code: "1005M (Murata GRM15 size code, T code 5)",
        pin_count: 2,
        exposed_pad: false,
        source: DS("Type & Dimension: L 1.0 ±0.05, W 0.5 ±0.05, T 0.5 ±0.05, e 0.15 to 0.35, g 0.3 min (mm)"),
      },
      metadata: {
        termination_length_mm: [0.15, 0.35],
        termination_gap_min_mm: 0.3,
        mounting_method: "surface_mount (flow or reflow)",
        packaging_codes: { D: "180 mm reel, paper tape W8P2, 10000 pcs", W: "180 mm reel, paper tape W8P1, 20000 pcs", J: "330 mm reel, paper tape W8P2, 50000 pcs", V: "330 mm reel, paper tape W8P1, 100000 pcs" },
        source: DS("Type & Dimension; Package"),
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-55, 125],
      metadata: {
        note: "Default (X7R) instance. An X5R instance operates from -55 to 85 °C.",
        source: [DS("Rated Value"), `${SRC.x5r25v} (Rated Value)`],
      },
    },
  ],

  traits: [
    seriesTrait({
      kind: "capacitor",
      value: 0.1e-6,
      unit: "F",
      tolerance: 0.1,
      source: DS("Rated Value"),
      series: "Murata GRM155 (GRM series, 1005M, T 0.5 mm), X5R / X7R",
      parameters: [
        { id: "capacitance", name: "Capacitance", unit: "F", value: 0.1e-6 },
        { id: "tolerance", name: "Capacitance tolerance (fraction)", unit: "dimensionless", value: 0.1 },
        { id: "rated_voltage", name: "Rated voltage (DC)", unit: "V", value: 16, range: [6.3, 50] },
      ],
      choices: {
        dielectric: {
          values: ["X5R", "X7R"],
          default: "X7R",
          source: `${SRC.default} (R7, X7R(EIA), -15 to 15 %, -55 to 125 °C); ${SRC.x5r25v} (R6, X5R(EIA), -15 to 15 %, -55 to 85 °C)`,
        },
      },
      overridable: ["capacitance", "tolerance", "rated_voltage", "dielectric", "part_number"],
      tolerances: [
        { tolerance: 0.1, code: "K" },
        { tolerance: 0.2, code: "M" },
      ],
      part_number: {
        default: "GRM155R71C104KA88D",
        pattern: null,
        value_code: "eia3_pf",
        decode: "^GRM15(?<thickness>5)(?<dielectric>R6|R7)(?<rated_voltage>0J|1A|1C|1E|1H)(?<value>\\d{3})(?<tolerance>[KM])(?<control>[A-Z0-9]{3})(?<package>[DWJV])?$",
        codes: {
          dielectric: { R6: "X5R", R7: "X7R" },
          rated_voltage: { "0J": 6.3, "1A": 10, "1C": 16, "1E": 25, "1H": 50 },
          tolerance: { K: 0.1, M: 0.2 },
        },
        source: `${DS("MURATA Part No. System: ① GRM ② 15 ③ 5 ④ R7 ⑤ 1C ⑥ 104 ⑦ K ⑧ A88 ⑨ D")}; codes R6/0J/M from ${SRC.x5r6v3}, 1E from ${SRC.x7r25v}, 1H from ${SRC.x7r50v}, 1A from ${SRC.code10v}`,
      },
    }),
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-55, 125],
        voltage_V: 16,
        note: "Default instance (X7R, DC 16 V). The rated voltage is the maximum continuously applied; with AC superimposed, the peak-to-peak or zero-to-peak voltage, whichever is larger, stays within it. An X5R instance operates from -55 to 85 °C.",
        source: [DS("Rated Value; Specifications and Test Methods 1"), `${SRC.x5r25v} (Rated Value)`],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "dc_bias",
        note: "Class II (X5R, X7R) capacitance falls with applied DC voltage, more steeply as the voltage rises, even below the rated voltage. Check the effective capacitance at the circuit's bias, and do not use these where a tight capacitance tolerance matters (a time constant).",
        source: DS("Caution 5, DC voltage and AC voltage characteristic"),
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "instance",
        note: "Set the value per placement: overrides { capacitance: <F>, tolerance: 0.1 | 0.2, rated_voltage: <V>, dielectric: \"X5R\" | \"X7R\", part_number: \"GRM155…\" } on the board's child, naming a Murata part whose reference sheet states those values. Some GRM155 parts are limited to consumer equipment (GRM155R60J106ME15) or have ±0.15 mm dimensions.",
        source: [DS("MURATA Part No. System"), `${SRC.x5r6v3} (Rated Value: Limited Application; Type & Dimension)`],
      },
    },
    {
      type: "assumption",
      params: {
        field: "terminal designators",
        value: "pin_1 = the -X termination, pin_2 = the +X termination",
        reason: "Murata numbers neither termination and the capacitor has no polarity; two designators are needed for pin tables and footprints.",
        source: DS("Type & Dimension"),
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal 1.0 x 0.5 x 0.5 mm chip; each termination one block 0.25 mm long (middle of e 0.15 to 0.35) over the full width and height",
        reason: "The sheet gives e as a range; the model needs one value and takes the middle, which leaves the 0.5 mm gap above the 0.3 mm minimum g. One nominal body stands for every GRM155 instance.",
        source: DS("Type & Dimension"),
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Murata's reference sheets link no 3D model, and no vendor STEP was sought for a series part, whose one body stands for every value. Geometry is generated from the default sheet's dimensions (library/cad/py/catalog/murata-grm155.py).",
        source: SRC.default,
      },
    },
    {
      type: "data_gap",
      params: { field: "mass", note: "The reference sheets state no unit mass.", source: SRC.default },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "Murata reference sheet GRM155R71C104KA88-01A (default instance)", type: "datasheet", url: SRC.default },
    { id: "art_x5r_6v3", name: "Murata reference sheet GRM155R60J106ME15-01A", type: "datasheet", url: SRC.x5r6v3 },
    { id: "art_x5r_25v", name: "Murata reference sheet GRM155R61E104KA87-01A", type: "datasheet", url: SRC.x5r25v },
    { id: "art_x7r_25v", name: "Murata reference sheet GRM155R71E103KA01-01A", type: "datasheet", url: SRC.x7r25v },
    { id: "art_x7r_50v", name: "Murata reference sheet GRM155R71H103KA88-01A", type: "datasheet", url: SRC.x7r50v },
    { id: "art_x7r_50v_1n", name: "Murata reference sheet GRM155R71H102KA01-01A", type: "datasheet", url: SRC.x7r50v1n },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the default sheet. Seating plane z = 0, chip along
// X, pin 1 at -X.
// ---------------------------------------------------------------------------

export const MURATA_GRM155: ModuleDef = withGeometry(
  MURATA_GRM155_BASE,
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
    dir: "library/parts/murata-grm155/artifacts/cad",
    name: "murata-grm155-1005",
    generator: "library/cad/py/catalog/murata-grm155.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

/**
 * Murata GRM1555C1H200JA01D: 20 pF ±5 % C0G (EIA) 50 V multilayer ceramic
 * chip capacitor, 1005M (0402) — datasheet-honest UHD part.
 *
 * Project-researched part (parts/local; docs/specs/tool-integrations.md §6 in
 * the Protoboard Stack). The load capacitors of the watch's 32.768 kHz
 * crystal (Y1) need a class I (C0G) dielectric: the catalog's Murata series
 * parts (murata-grm155, murata-grm188) cover X5R and X7R only, and their
 * part-number rule does not decode a C0G code (5C), so a placement override
 * cannot name this part.
 *
 * Sources (parts/evidence/murata-grm1555c1h200ja01/sources.json):
 *   - src_reference_sheet: Murata reference sheet GRM1555C1H200JA01-01A
 *     (product specifications as of 2026-06-13) —
 *     https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM1555C1H200JA01-01A.pdf
 *     (Part No. System, Type & Dimension, Rated Value, Package,
 *     Specifications and Test Methods 5-8)
 *
 * Modelling notes:
 *   - Two passive terminals (Murata numbers neither end; pin_1 is the -X
 *     termination in the CAD), a `passive` trait with the value, tolerance
 *     and the rated voltage as a parameter-free usage fact, and the
 *     mechanical package "0402" (the EIA code Murata prints with 1005M), so
 *     a circuit provider's chip land pattern fits it.
 *   - Geometry is generated from the Type & Dimension table
 *     (parts/local/murata-grm1555c1h200ja01/murata-grm1555c1h200ja01.py):
 *     no manufacturer CAD is linked from the sheet (data_gap).
 */
import { Passive, feature, own, withGeometry, type ModuleDef } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which parts/local/cadkit/partkit.py follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SHEET = "https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM1555C1H200JA01-01A.pdf";
const DIR = "parts/local/murata-grm1555c1h200ja01";

const base = Passive({
  id: "murata-grm1555c1h200ja01",
  name: "Murata GRM1555C1H200JA01D 20 pF C0G 50 V 0402",
  kind: "capacitor",
  value: 20e-12,
  unit: "F",
  tolerance: 0.05,
  manufacturer: "Murata",
  part_number: "GRM1555C1H200JA01D",
  description:
    "Murata GRM series multilayer ceramic chip capacitor, 1005M (0402), 1.0 x 0.5 x 0.5 mm, 20 pF ±5 % (J), C0G (EIA) 0 ±30 ppm/°C, DC 50 V, -55 to 125 °C, 180 mm paper-tape reel (D, 10000 pcs).",
  package: {
    name: "0402",
    code: "1005M (Murata GRM15 size code, T code 5)",
    pin_count: 2,
    exposed_pad: false,
    source: `${SHEET} (Type & Dimension: L 1.0 ±0.05, W 0.5 ±0.05, T 0.5 ±0.05, e 0.15 to 0.35, g 0.3 min (mm))`,
  },
  dimensions_mm: { length: 1.0, width: 0.5, height: 0.5 },
  source: `${SHEET} (Rated Value: 20 pF, ±5 %, C0G(EIA), DC 50 V)`,
});

const def: ModuleDef = {
  ...base,
  version: "1.0.0",
  tags: ["murata", "grm", "mlcc", "capacitor", "c0g", "np0", "0402", "1005-metric", "smd", "passive", "crystal-load"],
  interfaces: [
    ...base.interfaces,
    {
      id: "pcb_mount",
      name: "1005M (0402) chip terminations",
      domain: "mechanical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
      capabilities: ["surface_mount"],
      traits: [{ type: "connector", params: { connector_type: "smd_chip_terminations", note: "Two end terminations, e 0.15-0.35 mm, gap g 0.3 mm min; flow or reflow mounting.", source: `${SHEET} (Type & Dimension; Rated Value: Mounting Method)` } }],
    },
  ],
  artifacts: [{ id: "reference_sheet", name: "Murata reference sheet GRM1555C1H200JA01-01A", type: "datasheet", url: SHEET }],
  domains: [
    ...(base.domains ?? []),
    {
      domain: "electrical",
      metadata: {
        temperature_coefficient: "0 ±30 ppm/°C (25 to 125 °C, reference 25 °C)",
        rated_voltage_V: 50,
        q_min: "Q ≥ 400 + 20 C (C in pF): 800 at 20 pF, 1.0 MHz",
        insulation_resistance: "more than 10000 MΩ",
        capacitance_measurement: "1.0 ±0.1 MHz, room temperature",
        source: `${SHEET} (Rated Value; Specifications and Test Methods 5-8)`,
      },
    },
    { domain: "thermal", operating_temperature_C: [-55, 125], metadata: { source: `${SHEET} (Rated Value: Operating Temp. Range)` } },
  ],
  traits: [
    ...(base.traits ?? []),
    {
      type: "operating_conditions",
      params: { temperature_C: [-55, 125], max_voltage_V: 50, note: "Rated voltage DC 50 V; class I (C0G) capacitance does not fall with DC bias.", source: `${SHEET} (Rated Value)` },
    },
    {
      type: "usage_note",
      params: {
        topic: "ordering",
        note: "MPN GRM1555C1H200JA01D: GRM series, 15 = 1.0 x 0.5 mm, 5 = T 0.5 mm, 5C = C0G(EIA), 1H = DC 50 V, 200 = 20 pF, J = ±5 %, A01 = Murata control code, D = 180 mm reel, paper tape W8P2, 10000 pcs. Packaging W, J and V are the same capacitor on other reels.",
        source: `${SHEET} (Part No. System; Package)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "application",
        note: "Specific applications: consumer and industrial equipment, medical equipment GHTF A/B/C except implants, automotive infotainment and comfort; not for applications listed under 'Limitation of applications'.",
        source: `${SHEET} (Scope)`,
      },
    },
    {
      type: "assumption",
      params: {
        field: "terminal designators",
        value: "pin_1 = the -X termination, pin_2 = the +X termination",
        reason: "Murata numbers neither termination and the capacitor has no polarity; two designators are needed for pin tables and land patterns.",
        source: `${SHEET} (Type & Dimension)`,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal 1.0 x 0.5 x 0.5 mm chip; each termination one 0.25 mm block over the full width and height",
        reason: "The sheet gives e as a 0.15-0.35 mm range; the model takes the middle, which leaves a 0.5 mm gap above the 0.3 mm minimum g.",
        source: `${SHEET} (Type & Dimension)`,
      },
    },
    { type: "data_gap", params: { field: "manufacturer CAD", note: "The reference sheet links no 3D model; geometry is generated from its dimension table (parts/local/murata-grm1555c1h200ja01/murata-grm1555c1h200ja01.py).", source: SHEET } },
    { type: "data_gap", params: { field: "mass", note: "The reference sheet states no unit mass.", source: SHEET } },
  ],
};

const MOUNT = { normal: [0, 0, -1] as [number, number, number] };

export const MURATA_GRM1555C1H200JA01: ModuleDef = withGeometry(
  def,
  {
    pin_1: { refs: [feature("pin_1", { area_mm2: 0.125, centroid: [-0.375, 0, 0], normal: MOUNT.normal }), own("pin_1")] },
    pin_2: { refs: [feature("pin_2", { area_mm2: 0.125, centroid: [0.375, 0, 0], normal: MOUNT.normal }), own("pin_2")] },
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.25, centroid: [0, 0, 0], normal: MOUNT.normal }), own("pcb_mount")],
    },
  },
  cadArtifacts({ dir: DIR, name: "murata-grm1555c1h200ja01", generator: `${DIR}/murata-grm1555c1h200ja01.py`, tool: "build123d 0.13.0", interfaces: ["pin_1", "pin_2", "pcb_mount"] }),
);

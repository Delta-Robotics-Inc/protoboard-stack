/**
 * Kingbright APTF1616LSEEZGKQBKC 1.6 x 1.6 mm full-colour (RGB) SMD LED,
 * common anode — datasheet-honest UHD part.
 *
 * Sources (see ./kingbright-aptf1616lseezgkqbkc/sources.json):
 *   - src_datasheet: Kingbright spec DSAO4453 Rev V.9B (2025-03-19) —
 *     https://www.kingbrightusa.com/images/catalog/SPEC/APTF1616LSEEZGKQBKC.pdf
 *   - src_product:   Kingbright USA product page —
 *     https://www.kingbrightusa.com/product.asp?catalog_name=LED&product_id=APTF1616LSEEZGKQBKC
 *   - src_cad:       Kingbright APTF1616 STEP (evidence only, not redistributed) —
 *     https://www.kingbrightusa.com/images/catalog/3D/STEP/APTF1616.STEP
 *   - src_jlc:       JLCPCB/LCSC C3019103 through jlcsearch (distributor) —
 *     https://jlcsearch.tscircuit.com/components/list.json?search=C3019103
 *
 * Modelling notes:
 *   - Variant: APTF1616LSEEZGKQBKC, Hyper Red (AlGaInP) / Green (InGaN) /
 *     Blue (InGaN) chips under a water clear lens, common anode. Kingbright
 *     makes a common-cathode version on request (product page); that is a
 *     separate part.
 *   - All 4 pads are leaves `pin_1`..`pin_4` from the page 1 circuit
 *     diagram: pin 1 is common to the three chips (the anode side of each
 *     diode), pins 2/3/4 are the Red/Green/Blue cathodes. This confirms the
 *     common-anode pinout the bottle brief took from the JLC listing. The
 *     datasheet names no pins, so the names are descriptive (data_gap).
 *   - The pads are `passive` terminals: no protocol pairs an LED cathode with
 *     a constant-current driver output, and the anode is not a supply input
 *     with a voltage range of its own (vocabulary gap in .research/gaps.json).
 *     On a board the nets carry the connections (anode to the LED supply,
 *     each cathode to a driver channel). Each cathode carries the colour's
 *     DC forward current rating as `max_current` and its forward voltage in
 *     a usage note; the anode carries the sum of the three channel currents,
 *     which no source states as a rating.
 *   - `light_output` is the lens top (the emitting face), custom/peer with
 *     capability optical_aperture as st-vl53l4cdv0dh-1 does, so a light
 *     guide or window can be placed against it. Optical figures are a
 *     `performance` trait (kind "led").
 *   - `pcb_mount` is the four castellated pads on the seating plane. The
 *     underside centre mark is a polarity mark, not a terminal (the
 *     recommended soldering pattern has four pads only), so the package has
 *     no exposed pad. The recommended pattern itself is a land pattern and
 *     is not recorded here.
 *   - Optical and electrical values from the JLC listing that differ from
 *     the datasheet (green 50 mcd, 120 deg) are a source_discrepancy trait;
 *     the manufacturer values are used.
 *   - Geometry: generated from the page 1 drawing (the vendor STEP has no
 *     licence; data_gap trait). It matches the STEP's substrate, lens and
 *     pad volumes and areas. Undimensioned details are an assumption trait.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { defineModule, maxCurrentA, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.kingbrightusa.com/images/catalog/SPEC/APTF1616LSEEZGKQBKC.pdf",
  product: "https://www.kingbrightusa.com/product.asp?catalog_name=LED&product_id=APTF1616LSEEZGKQBKC",
  cad: "https://www.kingbrightusa.com/images/catalog/3D/STEP/APTF1616.STEP",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=C3019103",
} as const;

const DS = (where: string) => `${SRC.datasheet} (${where})`;

/** Per-colour ratings, datasheet page 2 (TA = 25 C, IF = 2 mA for the characteristics). */
const CHANNEL = {
  red: { vfTyp: 1.8, vfMax: 2.1, ifMaxA: 0.03, ifpA: 0.195, pdmW: 75, irMaxUA: 10, esdV: 3000, peakNm: 630, domNm: 621, ivMcd: [6, 15] },
  green: { vfTyp: 2.65, vfMax: 3.1, ifMaxA: 0.025, ifpA: 0.15, pdmW: 102.5, irMaxUA: 50, esdV: 450, peakNm: 515, domNm: 525, ivMcd: [30, 80] },
  blue: { vfTyp: 2.65, vfMax: 3.1, ifMaxA: 0.03, ifpA: 0.15, pdmW: 120, irMaxUA: 50, esdV: 250, peakNm: 460, domNm: 465, ivMcd: [6, 14] },
} as const;

type Colour = keyof typeof CHANNEL;

const channelNote = (colour: Colour, chip: string): TraitDef => {
  const c = CHANNEL[colour];
  return {
    type: "usage_note",
    params: {
      topic: "drive",
      note: `${chip}: VF ${c.vfTyp} V typ / ${c.vfMax} V max at 2 mA (+-0.1 V). IF ${c.ifMaxA * 1000} mA DC max, ${c.ifpA * 1000} mA peak (1/10 duty, 0.1 ms); PD ${c.pdmW} mW; VR 5 V; IR ${c.irMaxUA} uA max at 5 V; ESD ${c.esdV} V HBM. Drive from a current-limited sink (constant-current driver or series resistor); the anode supply must exceed VF plus the sink's headroom.`,
      source: DS("p.2 Electrical / optical characteristics; Absolute maximum ratings"),
    },
  };
};

// ---------------------------------------------------------------------------
// Pins — page 1 circuit diagram and package drawing (pins 1-4)
// ---------------------------------------------------------------------------

const cathode = (pin: number, colour: Colour, chip: string) => ({
  pin,
  name: `${chip} cathode`,
  type: "passive" as const,
  capabilities: ["led_cathode", `led_${colour}`],
  description: `Pin ${pin}: ${chip} chip, cathode (the circuit diagram's diode from pin 1 to pin ${pin}).`,
  traits: [channelNote(colour, chip)],
});

const pins = pinTable(
  [
    {
      pin: 1,
      name: "Common anode",
      type: "passive",
      capabilities: ["led_anode"],
      description: "Pin 1: common to the Red, Green and Blue chips (the anode side of all three diodes in the circuit diagram).",
      traits: [
        {
          type: "usage_note",
          params: {
            topic: "drive",
            note: "Carries the sum of the three channel currents. No combined anode rating is stated; each chip is rated on its own (Red 30, Green 25, Blue 30 mA DC).",
            source: DS("p.1 circuit diagram; p.2 Absolute maximum ratings"),
          },
        },
      ],
    },
    cathode(2, "red", "Hyper Red (AlGaInP)"),
    cathode(3, "green", "Green (InGaN)"),
    cathode(4, "blue", "Blue (InGaN)"),
  ],
  { source: DS("p.1 Package dimensions and circuit diagram") },
).map((p): InterfaceDef => {
  const colour = ({ pin_2: "red", pin_3: "green", pin_4: "blue" } as Record<string, Colour | undefined>)[p.id];
  return colour ? { ...p, parameters: [...(p.parameters ?? []), maxCurrentA(CHANNEL[colour].ifMaxA)] } : p;
});

// ---------------------------------------------------------------------------
// Mechanical and optical interfaces
// ---------------------------------------------------------------------------

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "Castellated pads (SMD, 4)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "smd_castellated_4_pad",
        note: "4 pads 0.35 x 0.65 mm at the corners of the 1.6 x 1.6 mm underside, outer edges on the body edge with castellations; pad centres 0.85 mm apart along each side. Single mounting surface. Reflow only (lead-free profile 260 C max for 10 s, above 217 C for 60-150 s), 2 passes max; MSL 3.",
        source: DS("p.1 Package dimensions, notes; p.1 Features; p.4 Reflow soldering profile"),
      },
    },
  ],
};

const lightOutput: InterfaceDef = {
  id: "light_output",
  name: "Light output (lens top)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["optical_aperture"],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "Water clear lens 1.1 x 1.6 mm at the top, 0.70 mm above the seating plane; 130 deg viewing angle (2 theta 1/2). Green and Blue chips sit on the pin 3/4 half, Red on the pin 1/2 half, so a diffuser or light guide over the lens mixes the colours.",
        source: DS("p.1 Package dimensions; Selection guide"),
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const KINGBRIGHT_APTF1616LSEEZGKQBKC_BASE: ModuleDef = defineModule({
  id: "kingbright-aptf1616lseezgkqbkc",
  name: "Kingbright APTF1616LSEEZGKQBKC RGB LED (1.6 x 1.6 mm, common anode)",
  version: "1.0.0",
  manufacturer: "Kingbright",
  part_number: "APTF1616LSEEZGKQBKC",
  description:
    "Kingbright 1.6 x 1.6 x 0.7 mm full-colour SMD LED: Hyper Red (AlGaInP, 621 nm), Green (InGaN, 525 nm) and Blue (InGaN, 465 nm) chips under a water clear lens, 130 deg viewing angle, common anode on pin 1 and cathodes on pins 2 (Red), 3 (Green), 4 (Blue). At 2 mA: VF 1.8 / 2.65 / 2.65 V typ (2.1 / 3.1 / 3.1 max), 15 / 80 / 14 mcd typ. DC forward current 30 / 25 / 30 mA max. -40 to +85 C. 4 castellated pads, MSL 3, 2000 per reel.",
  tags: ["kingbright", "aptf1616", "aptf1616lseezgkqbkc", "led", "rgb-led", "common-anode", "smd", "1616", "indicator", "c3019103"],
  categories: ["component.led"],

  interfaces: [...pins, pcbMount, lightOutput],

  domains: [
    {
      domain: "electrical",
      metadata: {
        configuration: "common anode (pin 1), cathodes Red pin 2, Green pin 3, Blue pin 4",
        forward_voltage_V_at_2mA: { red: { typ: 1.8, max: 2.1 }, green: { typ: 2.65, max: 3.1 }, blue: { typ: 2.65, max: 3.1 }, tolerance: 0.1 },
        dc_forward_current_mA_max: { red: 30, green: 25, blue: 30 },
        peak_forward_current_mA: { red: 195, green: 150, blue: 150, condition: "1/10 duty cycle, 0.1 ms pulse" },
        power_dissipation_mW: { red: 75, green: 102.5, blue: 120 },
        reverse_voltage_V: 5,
        reverse_current_uA_max_at_5V: { red: 10, green: 50, blue: 50 },
        vf_temperature_coefficient_mV_per_C: { red: -2.0, green: -3.0, blue: -3.0, condition: "IF 2 mA, -10 to 85 C" },
        source: DS("p.2"),
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 1.6, width: 1.6, height: 0.7 },
      package: {
        name: "1.6 x 1.6 mm SMD LED, 4 castellated pads",
        pin_count: 4,
        pitch_mm: 0.85,
        exposed_pad: false,
        source: `${DS("p.1 title, Features and Package dimensions: 1.6 x 1.6, 0.7 thick, pads 1-4, 0.85 pad pitch")}; ${SRC.jlc} (package 'SMD-4P,1.6x1.6mm')`,
      },
      metadata: {
        substrate_mm: 0.25,
        lens_mm: "1.2 at the base, 1.1 at the top (across the pad columns) x 1.6; 0.45 tall",
        pads_mm: "0.35 x 0.65 at the corners, castellated, outer edges on the body edge",
        pin_positions_top_view: "3 upper left, 2 lower left, 4 upper right, 1 lower right (bottom view mirrored top to bottom)",
        polarity_mark: "on the top under the lens near pin 2, and a hatched mark at the underside centre",
        tolerance_mm: 0.2,
        mounting_method: "surface_mount",
        packing: "tape and reel, 2000",
        moisture_sensitivity_level: 3,
        source: DS("p.1 Package dimensions, notes 1-4; Features"),
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: {
        storage_C: [-40, 85],
        junction_C_max: 115,
        rth_ja_C_per_W: { red: 780, green: 790, blue: 790 },
        rth_js_C_per_W: { red: 640, green: 650, blue: 650 },
        rth_condition: "FR4 PC board, pad size >= 16 mm2 per pad",
        reflow: "lead-free profile: 260 C max for 10 s max, above 255 C 30 s max, above 217 C 60-150 s, preheat 150-200 C 60-120 s; 2 passes max",
        source: DS("p.2 Absolute maximum ratings, note 2; p.4"),
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        power_dissipation_mW: { red: 75, green: 102.5, blue: 120 },
        reverse_voltage_V: 5,
        junction_temperature_C: 115,
        operating_temperature_C: [-40, 85],
        storage_temperature_C: [-40, 85],
        dc_forward_current_mA: { red: 30, green: 25, blue: 30 },
        peak_forward_current_mA: { red: 195, green: 150, blue: 150, condition: "1/10 duty cycle, 0.1 ms pulse width" },
        esd_hbm_V: { red: 3000, green: 450, blue: 250 },
        source: DS("p.2 Absolute maximum ratings at TA = 25 C"),
      },
    },
    {
      type: "operating_conditions",
      params: {
        operating_temperature_C: [-40, 85],
        characterised_at: "TA = 25 C, IF = 2 mA",
        note: "No recommended operating current is stated; the characteristics are given at 2 mA and the derating curves (p.3) reduce the permissible forward current at high ambient temperature.",
        source: DS("p.2; p.3 Forward current derating curves"),
      },
    },
    {
      type: "performance",
      params: {
        kind: "led",
        colours: "Hyper Red, Green, Blue",
        peak_wavelength_nm: { red: 630, green: 515, blue: 460 },
        dominant_wavelength_nm: { red: 621, green: 525, blue: 465, tolerance: 1 },
        spectral_bandwidth_nm: { red: 20, green: 35, blue: 25 },
        luminous_intensity_mcd_at_2mA: { red: { min: 6, typ: 15 }, green: { min: 30, typ: 80 }, blue: { min: 6, typ: 14 }, tolerance: "+-15 %" },
        viewing_angle_deg: 130,
        lens: "water clear",
        source: [DS("p.1 Selection guide; p.2"), SRC.product],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "handling",
        note: "Electrostatic discharge sensitive (Blue 250 V, Green 450 V HBM): use a wrist band or anti-static gloves and grounded equipment. Keep production-area humidity at 40-60 %. Reflow only; do not stress the LED while hot.",
        source: DS("p.1 Descriptions, Attention; p.2 note 3; p.4 notes"),
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "APTF1616LSEEZGKQBKC is the common-anode part; a common-cathode version is available from Kingbright on request and is a separate part. LCSC C3019103.",
        source: [SRC.product, SRC.jlc],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "green luminous intensity and viewing angle",
        values: ["80 mcd typ at 2 mA, 130 deg (datasheet, product page)", "50 mcd, 120 deg (JLC listing)"],
        sources: [SRC.datasheet, SRC.product, SRC.jlc],
        resolution: "Manufacturer values used.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "pin names",
        note: "The datasheet numbers the pads 1-4 and shows their chips in the circuit diagram but prints no pin names; the leaf names are descriptive.",
        source: DS("p.1"),
      },
    },
    {
      type: "data_gap",
      params: {
        field: "mass",
        note: "Not stated in the datasheet or on the product page.",
        source: [SRC.datasheet, SRC.product],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Kingbright publishes a STEP (SolidWorks 2008 export) on its 3D spec page with no licence, and the datasheet says its contents may not be reproduced or re-transmitted without permission, so it is not redistributed. It was measured as evidence: substrate 1.6 x 1.6 x 0.25, lens 1.2/1.1 x 1.6 x 0.45, pads 0.35 x 0.65 at +-0.425 agree with the drawing. Geometry is generated from the datasheet (library/cad/py/catalog/kingbright-aptf1616lseezgkqbkc.py).",
        source: [SRC.cad, DS("p.1; p.4 note 5")],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD details not dimensioned",
        value: "castellation dia 0.26 mm with its centre 0.054 mm outside the body edge; pad metal 0.01 mm thick; lens flush with the two pad-free edges, sharp-edged; polarity marks and chips not modelled",
        reason: "The drawing shows castellations, pad metal and the lens outline without these values; the castellation and pad values are measured from Kingbright's STEP, which the datasheet supersedes where they differ.",
        source: [DS("p.1 Package dimensions"), SRC.cad],
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "Kingbright APTF1616LSEEZGKQBKC spec DSAO4453 Rev V.9B", type: "datasheet", url: SRC.datasheet },
    { id: "art_product", name: "Kingbright USA APTF1616LSEEZGKQBKC product page", type: "documentation", url: SRC.product },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the page 1 drawing. Seating plane z = 0, body
// centred on the origin, top-view axes: pin 1 (+x, -y), pin 2 (-x, -y),
// pin 3 (-x, +y), pin 4 (+x, +y); lens top at z = 0.70.
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.215, centroid: [0.616, -0.425, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.215, centroid: [-0.616, -0.425, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.215, centroid: [-0.616, 0.425, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.215, centroid: [0.616, 0.425, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const KINGBRIGHT_APTF1616LSEEZGKQBKC: ModuleDef = withGeometry(
  KINGBRIGHT_APTF1616LSEEZGKQBKC_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    // the pads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.858, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
    // emitting face: frame on the lens top, normal up towards the light guide
    light_output: {
      frame: { origin: [0, 0, 0.7], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("light_output", { area_mm2: 1.76, centroid: [0.0, 0.0, 0.7], normal: [0.0, 0.0, 1.0] }), own("light_output")],
    },
  },
  cadArtifacts({
    dir: "library/parts/kingbright-aptf1616lseezgkqbkc/artifacts/cad",
    name: "kingbright-aptf1616-smd-1616",
    generator: "library/cad/py/catalog/kingbright-aptf1616lseezgkqbkc.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount", "light_output"],
  }),
);

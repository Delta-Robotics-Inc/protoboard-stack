/**
 * Epson FC-135 32.768 kHz crystal unit, 12.5 pF, ±20 ppm (Q13FC13500004)
 * — datasheet-honest UHD part.
 *
 * Sources (see ./epson-fc-135-32k768-12p5/sources.json):
 *   - src_datasheet: Epson FC-135 data sheet FC-135_E_Ver2.0 —
 *     https://download.epsondevice.com/td/pdf/app/FC-135_en.pdf
 *   - src_brief:     Epson FC-135R / FC-135 / FC-135 TYPE brief sheet —
 *     https://download.epsondevice.com/td/pdf/brief/FC-135_en.pdf
 *   - src_product:   Epson FC-135 product page —
 *     https://www.epsondevice.com/crystal/en/products/crystal-unit/fc135.html
 *   - src_partlist:  Epson kHz crystal product search data (per product
 *     number) — https://download.epsondevice.com/td/ps/xtal_32khz.json
 *   - src_cad:       Epson 3D CAD licence page (model not downloaded) —
 *     https://www.epsondevice.com/crystal/en/designsupport/tool/3dcad/?model=FC-135
 *   - src_jlc:       JLCPCB/LCSC catalog through jlcsearch (distributor) —
 *     https://jlcsearch.tscircuit.com/components/list.json?search=Q13FC13500004
 *
 * Modelling notes:
 *   - Variant: Q13FC13500004 is "FC-135 32.768000 kHz 12.5 +20.0-20.0"
 *     in Epson's per-number data: CL 12.5 pF, ±20 x10^-6 at +25 °C,
 *     -40 to +85 °C. The 7 pF (Q13FC13500002), 9 pF (Q13FC13500003) and
 *     ±10 ppm (Q13FC13500005) numbers, the FC-135R and the FC-135 TYPE are
 *     separate parts (usage_note).
 *   - Pins: the data sheet's pin table has #1 X'tal and #2 X'tal, with the
 *     crystal between them. Both are `passive` terminals `pin_1`/`pin_2`
 *     (the same ids `Passive()` uses): on a board net they pair with
 *     nothing, and the MCU's XL1/XL2 pins carry the oscillator. The crystal
 *     is not polarised.
 *   - The `passive` trait has no crystal kind (vocabulary gap in
 *     .research/gaps.json), so the module is built with `pinTable` and
 *     `defineModule` under category `passive.crystal`, and the crystal's
 *     electrical values (frequency, CL, tolerance, ESR, C0, C1, drive level)
 *     are a `performance` trait with kind `crystal`.
 *   - ESR: the data sheet says 70 kΩ "Typ.", the brief sheet and Epson's
 *     per-number data say 70 kΩ max. The model uses 70 kΩ as the maximum
 *     (source_discrepancy trait).
 *   - Package: Epson names no package code, only "3.2 x 1.5 mm"; the
 *     package name is that size, with LCSC's "SMD3215-2P" label as a
 *     distributor note. Two numbered terminals, no exposed pad, pitch 2.35
 *     mm between terminal centres (derived from the drawing: 1.7 + 0.65).
 *   - Geometry: generated from the outline drawing (section [7]); Epson's
 *     model is under a non-redistributable click-through licence
 *     (data_gap trait). Each pin leaf refs its bottom terminal, and
 *     `pcb_mount` refs both with a frame on the seating plane. Heights the
 *     drawing does not dimension are an assumption trait. The end and side
 *     views show the 0.35 mm high metallization only at the two corner
 *     castellations of each end, with the middle of the end face bare; the
 *     CAD lines those castellations and each bottom pad runs into them, so
 *     the model stays inside the 3.2 x 1.5 x 0.9 outline.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://download.epsondevice.com/td/pdf/app/FC-135_en.pdf",
  brief: "https://download.epsondevice.com/td/pdf/brief/FC-135_en.pdf",
  product: "https://www.epsondevice.com/crystal/en/products/crystal-unit/fc135.html",
  partlist: "https://download.epsondevice.com/td/ps/xtal_32khz.json",
  cad: "https://www.epsondevice.com/crystal/en/designsupport/tool/3dcad/?model=FC-135",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=Q13FC13500004",
} as const;

const note = (text: string, where: string, topic?: string): TraitDef => ({
  type: "usage_note",
  params: { ...(topic ? { topic } : {}), note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — data sheet [7], pin table and internal connection diagram
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    { pin: 1, name: "X'tal", type: "passive", capabilities: ["crystal_terminal"], description: "#1 X'tal — crystal terminal; the crystal is connected between #1 and #2 (Internal Connection)." },
    { pin: 2, name: "X'tal", type: "passive", capabilities: ["crystal_terminal"], description: "#2 X'tal — crystal terminal; the crystal is connected between #1 and #2 (Internal Connection)." },
  ],
  { source: `${SRC.datasheet} ([7] Outline Drawing, pin table and Internal Connection)` },
);

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "3.2 x 1.5 mm SMD terminals",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "smd_2_terminal",
        note: "Two bottom terminals #1 and #2, each 0.65 (along the length) x 1.3 mm, 1.7 mm apart and 0.1 mm in from the body ends; each pad runs out to the two corner castellations at its end, which are metallized 0.35 mm up from the base (the middle of the end face is bare); Au plating. Body 3.2 ± 0.1 x 1.5 ± 0.1 x 0.9 max. Reflow 260 C max, at most three reflows; iron 350 C max within 5 s.",
        source: `${SRC.datasheet} ([7]; [9]; [11])`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const EPSON_FC_135_32K768_12P5_BASE: ModuleDef = defineModule({
  id: "epson-fc-135-32k768-12p5",
  name: "Epson FC-135 32.768 kHz Crystal, 12.5 pF ±20 ppm",
  version: "1.0.0",
  manufacturer: "Seiko Epson",
  part_number: "Q13FC13500004",
  description:
    "Epson FC-135 32.768 kHz fundamental tuning-fork crystal unit in a 3.2 x 1.5 x 0.9 mm (max) SMD package with two terminals. Product number Q13FC13500004: load capacitance 12.5 pF, frequency tolerance ±20 x10^-6 at +25 °C, ESR 70 kΩ, C0 1.0 pF typ, drive level 0.5 µW max, -40 to +85 °C. For MCU sub-clocks and BLE sleep clocks.",
  tags: ["epson", "fc-135", "q13fc13500004", "crystal", "xtal", "32.768khz", "32khz", "tuning-fork", "lfxo", "rtc", "smd", "passive"],
  categories: ["component.passive.crystal"],

  interfaces: [...pins, pcbMount],

  domains: [
    {
      domain: "electrical",
      metadata: {
        nominal_frequency_Hz: 32768,
        overtone: "fundamental",
        load_capacitance_pF: 12.5,
        frequency_tolerance_ppm: 20,
        motional_resistance_kOhm_max: 70,
        motional_capacitance_fF_typ: 3.4,
        shunt_capacitance_pF_typ: 1.0,
        isolation_resistance_MOhm_min: 500,
        drive_level_uW: { min: 0.01, typ: 0.1, max: 0.5 },
        source: [`${SRC.datasheet} ([3], [4])`, SRC.partlist],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 3.2, width: 1.5, height: 0.9 },
      weight_g: 0.011,
      package: {
        name: "3.2 x 1.5 mm SMD",
        pin_count: 2,
        pitch_mm: 2.35,
        exposed_pad: false,
        source: `${SRC.datasheet} ([7] Outline Drawing: 3.2 ± 0.1 x 1.5 ± 0.1, 0.9 max; terminals 0.65 x 1.3, 1.7 apart, 0.1 from the ends)`,
      },
      metadata: {
        body_mm: "3.2 ± 0.1 x 1.5 ± 0.1, height 0.9 max",
        terminals_mm: "0.65 x 1.3 each, inner gap 1.7, 0.1 from each end; metallization 0.35 high in the two corner castellations of each end (end view)",
        pitch_note: "pitch_mm is the distance between terminal centres, 1.7 + 0.65 = 2.35 mm, derived from the drawing",
        distributor_package_label: "SMD3215-2P (LCSC)",
        mounting_method: "surface_mount",
        terminal_plating: "Au",
        reference_weight_mg: 11,
        marking: "frequency symbol A (32.768 kHz), last digit of the year, weekly code, internal ID",
        msl: "Level 1 (IPC/JEDEC J-STD-020D.01)",
        packing: "3000 per reel; 12 mm carrier tape, 4.0 mm pocket pitch; reel diameter 180 mm",
        source: [`${SRC.datasheet} ([6], [7], [8], [10])`, SRC.jlc],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 85],
      metadata: {
        extended_note: "-40 to +105 C is available on request to Epson.",
        storage_C: [-55, 125],
        reflow_peak_C: 260,
        source: `${SRC.datasheet} ([2], [3], [9])`,
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "crystal",
        nominal_frequency_Hz: 32768,
        overtone: "fundamental",
        load_capacitance_pF: 12.5,
        frequency_tolerance_ppm: { value: 20, condition: "+25 ± 3 C, DL = 0.1 uW, excluding aging" },
        turnover_temperature_C: { value: 25, tolerance: 5 },
        parabolic_coefficient_ppm_per_C2_max: -0.04,
        motional_resistance_kOhm_max: 70,
        motional_capacitance_fF_typ: 3.4,
        shunt_capacitance_pF_typ: 1.0,
        isolation_resistance_MOhm_min: 500,
        aging_ppm_first_year_max: 3,
        drive_level_uW: { min: 0.01, typ: 0.1, max: 0.5 },
        source: [`${SRC.datasheet} ([3], [4])`, SRC.partlist],
      },
    },
    {
      type: "absolute_maximum",
      params: {
        level_of_drive_uW: 1.0,
        level_of_drive_note: "maximum level of drive at which the unit is not destroyed (0.5 typ)",
        storage_temperature_C: [-55, 125],
        source: `${SRC.datasheet} ([2])`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        temperature_C: [-40, 85],
        drive_level_uW: { min: 0.01, typ: 0.1, max: 0.5 },
        note: "+85 to +105 C and 0.5-1.0 uW drive are available on request to Epson.",
        source: `${SRC.datasheet} ([3])`,
      },
    },
    note(
      "Keep the PCB lines to the crystal as short as possible; long lines can cause abnormal oscillation. Do not place signal, power or GND lines in the mounting area, its inner layers or its back side, and keep signal lines away from the part. Design the oscillator so its negative resistance is at least five times the crystal's ESR, and keep the drive level within the specification.",
      "[11] items 3, 7, 9, 10",
      "layout",
    ),
    note(
      "Frequency drifts parabolically with temperature: Δf = B (Ti - T)^2 with B = -0.04 x10^-6/C^2 max and Ti = +25 ± 5 C (at B max and Ti = 25 C: -169 x10^-6 at -40 C and -144 x10^-6 at +85 C; the data sheet's simulation figure shows the curve).",
      "[4]; [5]",
      "temperature",
    ),
    note(
      "At most three reflows (standard profile: 170 C preheat 100 s, 220 C for 35 s, 260 C max). Rework with a soldering iron at 350 C max within 5 s. Ultrasonic cleaning may damage the crystal; avoid condensation and excessive shock.",
      "[9]; [11] items 1, 2, 5, 6",
      "assembly",
    ),
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Q13FC13500004 is FC-135 32.768 kHz, CL 12.5 pF, ±20 x10^-6. Other FC-135 numbers: Q13FC13500002 (7 pF), Q13FC13500003 (9 pF; LCSC C99010, extended part), Q13FC13500005 (12.5 pF, ±10 x10^-6). The FC-135R (X1A000141..., 50 kΩ max) and the FC-135 TYPE (Q14FC1350..., 32-76.8 kHz) are separate products. LCSC C32346 is this number (JLCPCB basic part). Load capacitors on the board are chosen for CL = 12.5 pF.",
        source: [SRC.partlist, `${SRC.brief} (product numbers)`, SRC.jlc],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "motional resistance (ESR)",
        values: ["70 kΩ Typ. (data sheet p.1 features and [4] static characteristics)", "70 kΩ Max. (brief sheet table; Epson product data esrMax 70 for Q13FC13500004; LCSC listing 70 kΩ)"],
        sources: [SRC.datasheet, SRC.brief, SRC.partlist, SRC.jlc],
        resolution: "Use 70 kΩ as the maximum: Epson's per-number data and the brief sheet state it as a limit, and an oscillator sized for a 70 kΩ maximum also covers a 70 kΩ typical. Oscillator margin is checked against 5 x 70 kΩ = 350 kΩ.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "Epson publishes FC-135 3D CAD data behind a click-through licence: a personal, non-transferable licence to design boards that use Epson crystals, with no copying, modification or distribution. It is not redistributable, and the agreement was not accepted, so nothing was downloaded. Geometry is generated from the data sheet outline drawing [7] (library/cad/py/catalog/epson-fc-135-32k768-12p5.py).",
        source: [SRC.cad, SRC.datasheet],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "package code",
        note: "Epson gives no package code or outline name beyond '3.2 x 1.5 mm'. LCSC's 'SMD3215-2P' is a distributor label.",
        source: [SRC.datasheet, SRC.jlc],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "thermal resistance",
        note: "Not stated; a crystal unit at under 1 uW drive dissipates no meaningful heat.",
        source: SRC.datasheet,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal body 3.2 x 1.5 at the 0.9 mm maximum height; terminal thickness 0.03; ceramic base top at z = 0.6; lid 2.7 x 1.1 with 0.15 corner radius from z = 0.6 to 0.9; corner castellation radius 0.2; castellation lining 0.02 thick and 0.35 high, in the two corner castellations of each end only; each bottom pad the full 0.65 x 1.3 rectangle, its outer corners running into the two linings at its end; terminal #1 at -X",
        reason: "The drawing dimensions the body, the pads and the 0.35 metallization height only. The end and side views show that metallization only at the corner castellations (blocks about 0.2 wide), with the middle of the end face bare, and the bottom view runs each pad out to those castellations; the castellation radius and lining thickness are scaled from those views so the representative model has single values. The pad is kept as the dimensioned rectangle, so its outer corners overlap the castellation openings slightly. The model uses the maximum height so clearance checks are conservative. The bottom view is a third-angle projection about the length axis, so #1 is on the -X end; the crystal is not polarised.",
        source: `${SRC.datasheet} ([7])`,
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "Epson FC-135 data sheet FC-135_E_Ver2.0", type: "datasheet", url: SRC.datasheet },
    { id: "art_brief", name: "Epson FC-135R / FC-135 / FC-135 TYPE brief sheet", type: "datasheet", url: SRC.brief },
    { id: "art_product", name: "Epson FC-135 product page", type: "documentation", url: SRC.product },
    { id: "art_partlist", name: "Epson kHz crystal product data (Q13FC13500004 row)", type: "documentation", url: SRC.partlist },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the data sheet outline [7]. Seating plane z = 0,
// body centred on the origin, length along X, terminal #1 at -X.
// ---------------------------------------------------------------------------

const PIN_1 = feature("pin_1", { area_mm2: 0.845, centroid: [-1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] });
const PIN_2 = feature("pin_2", { area_mm2: 0.845, centroid: [1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] });

export const EPSON_FC_135_32K768_12P5: ModuleDef = withGeometry(
  EPSON_FC_135_32K768_12P5_BASE,
  {
    pin_1: { refs: [PIN_1] },
    pin_2: { refs: [PIN_2] },
    // the terminals onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 1.69, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/epson-fc-135-32k768-12p5/artifacts/cad",
    name: "epson-fc-135-32k768-12p5-smd3215",
    generator: "library/cad/py/catalog/epson-fc-135-32k768-12p5.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

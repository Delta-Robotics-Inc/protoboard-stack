/**
 * STMicroelectronics USBLC6-2SC6 very low capacitance ESD protection for two
 * data lines and VBUS (SOT23-6L) — datasheet-honest UHD part.
 *
 * Sources (see ./st-usblc6-2sc6/sources.json):
 *   - src_datasheet: ST USBLC6-2 datasheet DS4260 Rev 6 (October 2020), read
 *     from a mirror because st.com refused the connection —
 *     https://static.chipdip.ru/lib/697/DOC028697137.pdf
 *     (canonical https://www.st.com/resource/en/datasheet/usblc6-2.pdf)
 *   - src_datasheet_rev5: the same datasheet, Doc ID 11265 Rev 5 (October
 *     2011), as LCSC attaches it to C7519; cross-check only —
 *     https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/1810101111_STMicroelectronics-USBLC6-2SC6_C7519.pdf
 *   - src_estore: ST eStore USBLC6-2SC6 page (status, package size) —
 *     https://estore.st.com/en/usblc6-2sc6-cpn.html
 *   - src_jlc: JLCPCB/LCSC catalog through jlcsearch (distributor) —
 *     https://jlcsearch.tscircuit.com/components/list.json?search=USBLC6-2SC6
 *
 * Modelling notes:
 *   - Variant: USBLC6-2SC6, SOT23-6L, marking UL26 (Table 6), Active
 *     (eStore). USBLC6-2P6 (SOT-666), the automotive USBLC6-2SC6Y and the
 *     4-line USBLC6-4SC6 are separate parts. LCSC also lists other makers'
 *     parts under the same part number with different specifications; the
 *     ST device is C7519 (usage_note).
 *   - All 6 pins are leaves `pin_1`..`pin_6` from the cover's top-view
 *     functional diagram, with designators and pin_functions traits. The
 *     datasheet has no pin-function table, so each description quotes the
 *     diagram label and the role the PSpice cell (Figure 15) and layout
 *     figure (Figure 17) give the pin.
 *   - I/O pins (1, 3, 4, 6) are `passive` terminals: they are clamp diodes
 *     hung on a line, not signal sources or sinks, so on a board net they
 *     pair with nothing and the line's real ends (connector and MCU) still
 *     pair with each other. Pins 1/6 are D+in/D+out and 3/4 are D-in/D-out
 *     of one line each (Figures 15, 17); the datasheet does not say whether
 *     they are bonded inside, so the interface groups `io1_line` and
 *     `io2_line` ask for both pins of a line and the gap is a data_gap trait.
 *   - VBUS (pin 5) is the upper clamp rail and the 6 V transil to GND; it
 *     is modelled as a power input so a VBUS net checks its voltage against
 *     it. No recommended operating voltage is stated: the 0-5.25 V range is
 *     an assumption trait built on VRM = 5.25 V (Table 2) and VBR >= 6 V.
 *     Its current_draw is the 10 nA typical leakage (150 nA max).
 *   - Composed interface: `vbus_clamp` (VBUS 5 + GND 2), a power input like
 *     a regulator's supply pair, so a connector's VBUS/GND port can reach
 *     it as one interface.
 *   - Contact ESD: 15 kV is the absolute rating (Table 1, eStore title);
 *     the cover's "8 kV (contact discharge)" is the IEC 61000-4-2 level 4
 *     test level. Both are kept (source_discrepancy trait).
 *   - Package dimensions from Rev 6 Table 3; Rev 5 differs in three rows
 *     (source_discrepancy trait).
 *   - Geometry: generated from Table 3 (no reachable manufacturer CAD;
 *     data_gap trait). Bare IC: no bolt pattern. Each pin leaf refs its
 *     foot (`pin_N`), `vbus_clamp` refs feet 5 and 2, and `pcb_mount` refs
 *     all six feet with a frame on the seating plane. Midpoint dimensions;
 *     the assumed values are an assumption trait.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { PowerIn, currentDrawA, defineModule, pinTable } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://static.chipdip.ru/lib/697/DOC028697137.pdf",
  datasheetRev5: "https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/1810101111_STMicroelectronics-USBLC6-2SC6_C7519.pdf",
  estore: "https://estore.st.com/en/usblc6-2sc6-cpn.html",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=USBLC6-2SC6",
} as const;

const VBUS: [number, number] = [0, 5.25]; // assumption: VRM = 5.25 V (Table 2), VBR >= 6 V
const VBUS_NOM = 5.0;
const LEAKAGE_TYP_A = 10e-9; // Table 2: IRM 10 nA typ, 150 nA max at VRM 5.25 V

const note = (text: string, where: string, topic?: string): TraitDef => ({
  type: "usage_note",
  params: { ...(topic ? { topic } : {}), note: text, source: `${SRC.datasheet} (${where})` },
});

const ioNote = note(
  "Clamp to GND (forward diode, VF 1.1 V max at 10 mA) and to the VBUS rail. VCL 12 V max at IPP 1 A and 17 V max at IPP 5 A (8/20 us, any I/O to GND). Line capacitance to GND 2.5 pF typ / 3.5 pF max, line to line 1.2 / 1.7 pF (VR 1.65 V), matching 0.015 / 0.04 pF. Leakage 150 nA max at 5.25 V. Suits USB 2.0 up to 480 Mb/s.",
  "Table 2; cover",
);

// ---------------------------------------------------------------------------
// Pins — cover, Functional diagram (top view); roles from §2.6 Figure 15
// (PSpice model of one cell) and Figure 17 (PCB layout considerations)
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    {
      pin: 1,
      name: "I/O1",
      type: "passive",
      capabilities: ["esd_clamp"],
      description: "I/O1 (pin 1) — protected data line 1. D+in in the PSpice cell (Figure 15) and the layout figure (Figure 17); pin 6 is the same line's other end (D+out).",
      traits: [ioNote],
    },
    {
      pin: 2,
      name: "GND",
      type: "ground",
      description: "GND (pin 2) — ground. Connect to the PCB ground plane with a track as short as possible (§2.3).",
    },
    {
      pin: 3,
      name: "I/O2",
      type: "passive",
      capabilities: ["esd_clamp"],
      description: "I/O2 (pin 3) — protected data line 2. D-in in the PSpice cell (Figure 15) and the layout figure (Figure 17); pin 4 is the same line's other end (D-out).",
      traits: [ioNote],
    },
    {
      pin: 4,
      name: "I/O2",
      type: "passive",
      capabilities: ["esd_clamp"],
      description: "I/O2 (pin 4) — protected data line 2. D-out in the PSpice cell (Figure 15) and the layout figure (Figure 17); pin 3 is the same line's other end (D-in).",
      traits: [ioNote],
    },
    {
      pin: 5,
      name: "VBUS",
      type: "power_in",
      voltageV: VBUS,
      nominalV: VBUS_NOM,
      description: "VBUS (pin 5) — protected supply rail: upper rail of the I/O clamps and the 6 V breakdown to GND (Dzener in Figure 15). Connect to VCC (the USB VBUS) with a short track (§2.3); CBUS = 100 nF in Figure 17.",
    },
    {
      pin: 6,
      name: "I/O1",
      type: "passive",
      capabilities: ["esd_clamp"],
      description: "I/O1 (pin 6) — protected data line 1. D+out in the PSpice cell (Figure 15) and the layout figure (Figure 17); pin 1 is the same line's other end (D+in).",
      traits: [ioNote],
    },
  ],
  { source: `${SRC.datasheet} (cover, Functional diagram (top view); §2.6 Figures 15, 17)` },
).map((p) => (p.id === "pin_5" ? { ...p, parameters: [...(p.parameters ?? []), currentDrawA(LEAKAGE_TYP_A)] } : p));

const pinId = (n: number) => `pin_${n}`;

// ---------------------------------------------------------------------------
// Composed interfaces
// ---------------------------------------------------------------------------

const vbusClamp: InterfaceDef = {
  ...PowerIn({ id: "vbus_clamp", name: "VBUS clamp (VBUS + GND)", voltageV: VBUS, nominalV: VBUS_NOM, parameters: [currentDrawA(LEAKAGE_TYP_A)] }),
  slots: [
    { id: "vbus", required: true, match: { protocol: "power", role: "input" } },
    { id: "gnd", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
  ],
  profiles: [{ id: "vbus_gnd", label: "VBUS 5, GND 2", default_active: true, bindings: { vbus: pinId(5), gnd: pinId(2) } }],
  traits: [
    note(
      "Breakdown VBR 6 V min (IR 1 mA) between VBUS and GND. Leakage IRM 10 nA typ / 150 nA max at VRM = 5.25 V (25 C), rising with junction temperature (Figure 3). Decouple VBUS with 100 nF (CBUS, Figure 17).",
      "Table 2; Figure 3; Figure 17",
    ),
  ],
};

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "SOT23-6L leads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "sot23_6l",
        note: "6 gull-wing leads, pitch 0.95 mm (pins 1-3 span 1.9 mm), width 0.30-0.5, thickness 0.09-0.2, foot 0.3-0.6 mm; body 2.8-3.05 x 1.5-1.75 mm, span 2.6-3.0 mm, height 0.9-1.45 mm; no exposed pad. Lead solder temperature 260 C for 10 s.",
        source: `${SRC.datasheet} (§3.1 Table 3; Table 1)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ST_USBLC6_2SC6_BASE: ModuleDef = defineModule({
  id: "st-usblc6-2sc6",
  name: "ST USBLC6-2SC6 USB ESD Protection (SOT23-6L)",
  version: "1.0.0",
  manufacturer: "STMicroelectronics",
  part_number: "USBLC6-2SC6",
  description:
    "STMicroelectronics USBLC6-2 very low capacitance ESD protection array in SOT23-6L: two protected data lines (I/O1 on pins 1/6, I/O2 on pins 3/4, flow-through) and VBUS (pin 5), rail-to-rail clamp topology. 3.5 pF max line capacitance, 150 nA max leakage at 5.25 V, 6 V min VBUS breakdown, 17 V max clamping at 5 A (8/20 us). IEC 61000-4-2 level 4 (15 kV air, 8 kV contact; 15 kV contact absolute rating). For USB 2.0 up to 480 Mb/s, Ethernet 10/100 and video lines.",
  tags: ["usblc6-2", "usblc6-2sc6", "stmicroelectronics", "st", "esd", "tvs", "esd-protection", "usb", "usb-2.0", "sot23-6l", "ic"],
  categories: ["component.protection"],

  interfaces: [...pins, vbusClamp, pcbMount],

  interfaceGroups: [
    { id: "io1_line", label: "I/O1 line (pins 1 and 6: D+in / D+out)", members: [pinId(1), pinId(6)], policy: "all_of" },
    { id: "io2_line", label: "I/O2 line (pins 3 and 4: D-in / D-out)", members: [pinId(3), pinId(4)], policy: "all_of" },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "vbus", name: "Protected supply rail (VBUS)", nominal_voltage_V: VBUS_NOM, voltage_range_V: VBUS }],
      metadata: {
        topology: "rail-to-rail steering diodes per I/O line plus a transil (VBUS to GND), monolithic",
        protected_lines: 2,
        leakage_nA: { typ: 10, max: 150, at_V: 5.25 },
        breakdown_V_min: 6,
        forward_voltage_V_max: 1.1,
        clamping_V_max: { at_1A_8_20us: 12, at_5A_8_20us: 17 },
        capacitance_pF: { io_gnd_typ: 2.5, io_gnd_max: 3.5, io_io_typ: 1.2, io_io_max: 1.7, io_gnd_matching: 0.015, io_io_matching: 0.04, at_VR_V: 1.65 },
        source: `${SRC.datasheet} (Table 2)`,
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.9, width: 2.8, height: 1.45 },
      weight_g: 0.0167,
      package: {
        name: "SOT23-6L",
        pin_count: 6,
        pitch_mm: 0.95,
        exposed_pad: false,
        source: `${SRC.datasheet} (§3.1 Figure 18 and Table 3: D 2.8-3.05, E 1.5-1.75, H 2.6-3.0, A 0.9-1.45, e 0.95; Table 6: SOT23-6L); ${SRC.estore} (Package Size 2.9 x 2.8 x 1.18)`,
      },
      metadata: {
        body_mm: "D 2.8-3.05 x E 1.5-1.75; lead span H 2.6-3.0; height A 0.9-1.45",
        dimensions_note: "length and width are ST's stated package size (body length x lead span); height is the Table 3 maximum",
        mounting_method: "surface_mount",
        marking: "UL26 (may be rotated by 90 deg to show the assembly location)",
        mass_mg: 16.7,
        packing: "tape and reel, 3000",
        source: `${SRC.datasheet} (Table 3, Table 6)`,
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-40, 125],
      metadata: {
        temperature_note: "The datasheet gives the operating junction range (Table 1); no ambient range.",
        storage_C: [-55, 150],
        lead_solder_C: { temperature: 260, duration_s: 10, at_mm: 5 },
        source: `${SRC.datasheet} (Table 1)`,
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        esd_iec_61000_4_2_air_kV: 15,
        esd_iec_61000_4_2_contact_kV: 15,
        esd_mil_std_883g_3015_7_kV: 25,
        junction_temperature_C: [-40, 125],
        storage_temperature_C: [-55, 150],
        lead_solder_temperature_C: "260 for 10 s at 5 mm",
        source: `${SRC.datasheet} (Table 1)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        vbus_V: VBUS,
        junction_temperature_C: [-40, 125],
        note: "VBUS range is an assumption (see the assumption trait); electrical characteristics are at Tamb = 25 C.",
        source: `${SRC.datasheet} (Table 1, Table 2)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "esd_protection",
        protected_lines: 2,
        protects_vbus: true,
        standards: "IEC 61000-4-2 level 4 (15 kV air, 8 kV contact), guaranteed at device level",
        line_capacitance_pF_max: 3.5,
        leakage_nA_max: 150,
        clamping_V_max_at_5A: 17,
        data_rate: "USB 2.0 up to 480 Mb/s (high speed); USB 1.1 low and full speed; Ethernet 10/100 Mb/s",
        crosstalk: "below -55 dB up to 240 MHz (§2.4)",
        source: `${SRC.datasheet} (cover; Table 2; §2.4)`,
      },
    },
    note(
      "Place the device as close as possible to the disturbance source (generally the connector). Keep the tracks from the data lines to the I/O pins, from VCC to VBUS and from the GND plane to GND as short as possible: with 10 mm x 0.5 mm tracks (about 6 nH each) an 8 kV contact strike adds about 144 V per track to the clamping voltage (§2.2). Route each line through its pin pair (D+in pin 1 to D+out pin 6, D-in pin 3 to D-out pin 4) and decouple VBUS with 100 nF (Figure 17).",
      "§2.2, §2.3, Figure 17",
      "layout",
    ),
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Order code USBLC6-2SC6: SOT23-6L, marking UL26, 16.7 mg, 3000 per reel; Active, Industrial grade, Ecopack2. USBLC6-2P6 (SOT-666, marking F) is the same function in another package and a separate part. LCSC C7519 is the ST device; other LCSC entries under the part number USBLC6-2SC6 (C2687116, C2827654, C5261088) state different capacitance, leakage and surge figures and are other makers' parts.",
        source: [`${SRC.datasheet} (Table 6)`, SRC.estore, SRC.jlc],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "contact discharge ESD",
        values: ["15 kV (Table 1 absolute rating; eStore title '15kV contact ESD protection capability')", "8 kV (cover: IEC 61000-4-2 level 4, contact discharge)"],
        sources: [SRC.datasheet, SRC.estore],
        resolution: "Both hold: 8 kV contact is the level 4 test level the device is guaranteed to meet; 15 kV contact is its absolute rating. absolute_maximum carries 15 kV, performance carries the level 4 figures.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "SOT23-6L package dimensions",
        values: ["Rev 6 Table 3: A1 0-0.15, b 0.30-0.5, L 0.3-0.6", "Rev 5 Table 4: A1 0-0.10, b 0.35-0.50, L 0.10-0.60"],
        sources: [SRC.datasheet, SRC.datasheetRev5],
        resolution: "Rev 6 (the later revision) used. A Rev 7 (December 2021) is named on st.com but could not be fetched.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "VBUS working voltage",
        value: "0-5.25 V, nominal 5 V",
        reason: "The datasheet states no recommended operating voltage. Leakage is specified at VRM = 5.25 V, which the Rev 4 change note ties to the USB standard, and VBR is 6 V min; 5.25 V is therefore the highest VBUS the stated figures cover.",
        source: `${SRC.datasheet} (Table 2; Table 7 Rev 4)`,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "internal I/O pin connection",
        note: "No pin-function table says whether pins 1 and 6 (both I/O1) and pins 3 and 4 (both I/O2) are bonded together. The PSpice cell (Figure 15) joins D+in to D+out through the line's series RI/O-LI/O, and Figure 17 routes the line in on one pin and out on the other. The interface groups ask for both pins of each line.",
        source: `${SRC.datasheet} (cover; Figures 15, 17)`,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "thermal resistance",
        note: "Not stated in the datasheet or on the eStore page.",
        source: [SRC.datasheet, SRC.estore],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "st.com (product page CAD resources and the datasheet) refused every fetch (HTTP/2 stream error or timeout), so ST's own models could not be reached; SnapEDA returns HTTP 403 and Ultra Librarian needs a login. Geometry is generated from datasheet Table 3 (library/cad/py/catalog/st-usblc6-2sc6.py).",
        source: SRC.datasheet,
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "midpoint of each Table 3 range (body 2.9 x 1.6, span 2.8, lead 0.4 wide x 0.15 thick, foot 0.45, standoff 0.075, body thickness 1.1 so the top is at 1.175 mm); lead shoulder top 0.6 mm; pin-1 dimple 0.4 mm",
        reason: "Table 3 gives only min/max limits and no shoulder height or pin-1 mark size; the representative model needs single values. The 1.175 mm top agrees with the eStore package size (1.18).",
        source: [`${SRC.datasheet} (Table 3)`, SRC.estore],
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "ST USBLC6-2 datasheet DS4260 Rev 6", type: "datasheet", url: SRC.datasheet },
    { id: "art_datasheet_rev5", name: "ST USBLC6-2 datasheet Doc ID 11265 Rev 5 (LCSC copy)", type: "datasheet", url: SRC.datasheetRev5 },
    { id: "art_estore", name: "ST eStore USBLC6-2SC6", type: "documentation", url: SRC.estore },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from Table 3. Seating plane z = 0, body centred on the
// origin, pins 1-3 on -X (pin 1 at +Y), pins 4-6 on +X (pin 6 at +Y).
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.18, centroid: [-1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.18, centroid: [-1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.18, centroid: [-1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_4: feature("pin_4", { area_mm2: 0.18, centroid: [1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_5: feature("pin_5", { area_mm2: 0.18, centroid: [1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_6: feature("pin_6", { area_mm2: 0.18, centroid: [1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const ST_USBLC6_2SC6: ModuleDef = withGeometry(
  ST_USBLC6_2SC6_BASE,
  {
    ...Object.fromEntries(Object.entries(PIN_FEATURES).map(([id, ref]) => [id, { refs: [ref] }])),
    vbus_clamp: { refs: [PIN_FEATURES.pin_5, PIN_FEATURES.pin_2] },
    // the leads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 1.08, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/st-usblc6-2sc6/artifacts/cad",
    name: "st-usblc6-2sc6-sot23-6l",
    generator: "library/cad/py/catalog/st-usblc6-2sc6.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);
